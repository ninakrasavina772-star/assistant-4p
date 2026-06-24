import "server-only";

import sharp from "sharp";
import { phash64FromUrl, visualSimilarFromPhash, type PhashCache } from "@/lib/imagePhash";
import {
  measureImageSharpness,
  fetchLetualImageDetailed,
  hostPriorityScore
} from "@/lib/letualFotoQuality";
import { fetchPodruzhkaProductImageDetailed } from "@/lib/podruzhkaImageFetch";
import { normalize4standHugeWebp } from "@/lib/podruzhkaFotoPick";
import { imageUrlIdentityKey } from "@/lib/templateGenerator/imageUrlDedupe";
import { urlResolutionScore } from "@/lib/templateGenerator/yandexImageFilter";
import { isPromoOrInfographicUrl } from "@/lib/templateGenerator/yandexImageSources";

export type YandexImageKind = "white_packshot" | "lifestyle" | "reject";

export type YandexAnalyzedImage = {
  url: string;
  kind: YandexImageKind;
  width: number;
  height: number;
  pixels: number;
  bytes: number;
  sharpness: number;
  whiteBorderRatio: number;
  technicalScore: number;
  phash: bigint | null;
  rejectReason?: string;
};

export type YandexGallerySelection = {
  main: string | null;
  whiteExtras: string[];
  lifestyles: string[];
  analyzed: YandexAnalyzedImage[];
  note?: string;
};

const MIN_EDGE_PX = 700;
const MIN_BYTES = 20_000;
const MIN_SHARPNESS = 14;
const WHITE_BORDER_MIN = 0.72;
const PACKSHOT_POSE_HAMMING = 7;
const LIFESTYLE_POSE_HAMMING = 9;

async function fetchImageBuf(url: string): Promise<Buffer | null> {
  const norm = normalize4standHugeWebp(url.trim());
  const pod = await fetchPodruzhkaProductImageDetailed(norm);
  if (pod.buf?.length) return pod.buf;
  const letu = await fetchLetualImageDetailed(norm);
  if (letu?.buf?.length) return letu.buf;
  return null;
}

async function measureWhiteBorderRatio(buf: Buffer): Promise<number> {
  const { data, info } = await sharp(buf)
    .resize(160, 160, { fit: "cover" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const w = info.width;
  const h = info.height;
  const ch = info.channels || 3;
  let white = 0;
  let border = 0;

  const isWhite = (idx: number) => {
    const r = data[idx] ?? 0;
    const g = data[idx + 1] ?? r;
    const b = data[idx + 2] ?? r;
    return r >= 232 && g >= 232 && b >= 232;
  };

  for (let x = 0; x < w; x++) {
    for (const y of [0, h - 1]) {
      const i = (y * w + x) * ch;
      border++;
      if (isWhite(i)) white++;
    }
  }
  for (let y = 1; y < h - 1; y++) {
    for (const x of [0, w - 1]) {
      const i = (y * w + x) * ch;
      border++;
      if (isWhite(i)) white++;
    }
  }
  return border ? white / border : 0;
}

function classifyKind(whiteBorderRatio: number): Exclude<YandexImageKind, "reject"> {
  return whiteBorderRatio >= WHITE_BORDER_MIN ? "white_packshot" : "lifestyle";
}

export async function analyzeYandexSourceImage(
  rawUrl: string,
  cache: PhashCache
): Promise<YandexAnalyzedImage | null> {
  const url = normalize4standHugeWebp(rawUrl.trim());
  if (!/^https?:\/\//i.test(url) || isPromoOrInfographicUrl(url)) return null;

  const buf = await fetchImageBuf(url);
  if (!buf?.length || buf.length < MIN_BYTES) return null;

  const meta = await sharp(buf).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  const pixels = width * height;

  if (width < MIN_EDGE_PX || height < MIN_EDGE_PX) {
    return {
      url,
      kind: "reject",
      width,
      height,
      pixels,
      bytes: buf.length,
      sharpness: 0,
      whiteBorderRatio: 0,
      technicalScore: 0,
      phash: null,
      rejectReason: "мелкое"
    };
  }

  const sharpness = await measureImageSharpness(buf);
  if (sharpness < MIN_SHARPNESS) {
    return {
      url,
      kind: "reject",
      width,
      height,
      pixels,
      bytes: buf.length,
      sharpness,
      whiteBorderRatio: 0,
      technicalScore: 0,
      phash: null,
      rejectReason: "мутное"
    };
  }

  const whiteBorderRatio = await measureWhiteBorderRatio(buf);
  const kind = classifyKind(whiteBorderRatio);
  const phash = await phash64FromUrl(url, cache);

  const technicalScore =
    Math.min(pixels / 2500, 400) +
    Math.min(sharpness / 4, 120) +
    Math.min(buf.length / 8000, 80) +
    urlResolutionScore(url) +
    hostPriorityScore(url) +
    (kind === "white_packshot" ? whiteBorderRatio * 40 : 0);

  return {
    url,
    kind,
    width,
    height,
    pixels,
    bytes: buf.length,
    sharpness,
    whiteBorderRatio,
    technicalScore,
    phash
  };
}

function isSamePose(a: bigint | null, b: bigint | null, max: number): boolean {
  return visualSimilarFromPhash(a, b, max);
}

function pickMainPackshot(
  candidates: YandexAnalyzedImage[],
  mainImageUrl: string | null
): YandexAnalyzedImage | null {
  const packshots = candidates.filter((c) => c.kind === "white_packshot");
  if (!packshots.length) return null;

  if (mainImageUrl?.trim()) {
    const mainKey = imageUrlIdentityKey(mainImageUrl);
    const hit = packshots.find((p) => imageUrlIdentityKey(p.url) === mainKey);
    if (hit) return hit;
  }

  packshots.sort((a, b) => b.technicalScore - a.technicalScore);
  return packshots[0] ?? null;
}

function pickWhiteExtras(
  candidates: YandexAnalyzedImage[],
  main: YandexAnalyzedImage | null,
  maxExtras: number
): YandexAnalyzedImage[] {
  if (!main || maxExtras <= 0) return [];
  const out: YandexAnalyzedImage[] = [];

  const rest = candidates
    .filter((c) => c.kind === "white_packshot" && c.url !== main.url)
    .sort((a, b) => b.technicalScore - a.technicalScore);

  for (const c of rest) {
    if (out.length >= maxExtras) break;
    if (isSamePose(c.phash, main.phash, PACKSHOT_POSE_HAMMING)) continue;
    if (out.some((x) => isSamePose(x.phash, c.phash, PACKSHOT_POSE_HAMMING))) continue;
    out.push(c);
  }
  return out;
}

function pickLifestyles(
  candidates: YandexAnalyzedImage[],
  taken: YandexAnalyzedImage[],
  max: number
): YandexAnalyzedImage[] {
  const out: YandexAnalyzedImage[] = [];
  const takenPhashes = taken.map((t) => t.phash);

  const rest = candidates
    .filter((c) => c.kind === "lifestyle")
    .sort((a, b) => b.technicalScore - a.technicalScore);

  for (const c of rest) {
    if (out.length >= max) break;
    if (takenPhashes.some((p) => isSamePose(p, c.phash, LIFESTYLE_POSE_HAMMING))) continue;
    if (out.some((x) => isSamePose(x.phash, c.phash, LIFESTYLE_POSE_HAMMING))) continue;
    out.push(c);
  }
  return out;
}

export async function selectYandexGalleryFromUrls(opts: {
  urls: string[];
  mainImageUrl?: string | null;
  maxWhiteTotal?: number;
  maxLifestyle?: number;
}): Promise<YandexGallerySelection> {
  const maxWhiteTotal = Math.max(1, opts.maxWhiteTotal ?? 2);
  const maxLifestyle = Math.max(0, opts.maxLifestyle ?? 4);
  const maxExtras = Math.max(0, maxWhiteTotal - 1);

  const cache: PhashCache = new Map();
  const seen = new Set<string>();
  const sorted = [...opts.urls]
    .map((u) => normalize4standHugeWebp(u.trim()))
    .filter((u) => /^https?:\/\//i.test(u))
    .sort((a, b) => urlResolutionScore(b) - urlResolutionScore(a));

  const analyzed: YandexAnalyzedImage[] = [];
  for (const url of sorted.slice(0, 24)) {
    const key = imageUrlIdentityKey(url);
    if (seen.has(key)) continue;
    seen.add(key);
    const row = await analyzeYandexSourceImage(url, cache);
    if (row) analyzed.push(row);
  }

  const usable = analyzed.filter((a) => a.kind !== "reject");
  const rejected = analyzed.filter((a) => a.kind === "reject");

  const main = pickMainPackshot(usable, opts.mainImageUrl ?? null);
  const whiteExtras = pickWhiteExtras(usable, main, maxExtras);
  const lifestyles = pickLifestyles(usable, main ? [main, ...whiteExtras] : whiteExtras, maxLifestyle);

  const parts: string[] = [];
  if (rejected.length) parts.push(`отброшено: ${rejected.length}`);
  if (main) parts.push("1 главное");
  if (whiteExtras.length) parts.push(`${whiteExtras.length} белый ракурс`);
  if (lifestyles.length) parts.push(`${lifestyles.length} на фоне`);

  return {
    main: main?.url ?? null,
    whiteExtras: whiteExtras.map((x) => x.url),
    lifestyles: lifestyles.map((x) => x.url),
    analyzed,
    note: parts.length ? parts.join(" · ") : undefined
  };
}
