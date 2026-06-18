import sharp from "sharp";
import { preferOzonFullSizeUrl } from "@/lib/podruzhkaImageFetch";
import {
  dedupeAndNormalizeFotoUrls,
  normalize4standHugeWebp
} from "@/lib/podruzhkaFotoPick";
import { fetchPodruzhkaProductImageDetailed } from "@/lib/podruzhkaImageFetch";

export type LetualTechnicalScore = {
  url: string;
  width: number;
  height: number;
  pixels: number;
  bytes: number;
  sharpness: number;
  technicalScore: number;
};

/** Максимальное разрешение: 4stand huge, Ozon -f. */
export function normalizeLetualSourceUrl(url: string): string {
  let u = url.trim();
  u = preferOzonFullSizeUrl(u);
  u = normalize4standHugeWebp(u);
  return u;
}

export function normalizeLetualFotoUrls(urls: string[]): string[] {
  const normalized = urls.map(normalizeLetualSourceUrl);
  return dedupeAndNormalizeFotoUrls(normalized);
}

function urlResolutionHint(url: string): number {
  const u = url.toLowerCase();
  let s = 0;
  if (/\/huge\//.test(u)) s += 1200;
  if (/multimedia-1-f\//.test(u)) s += 900;
  if (/900x900/.test(u)) s += 700;
  if (/1200x|1500x|2000x/.test(u)) s += 800;
  if (/thumb|_small|_mini|preview|icon/.test(u)) s -= 800;
  if (/multimedia-1-s\//.test(u)) s -= 200;
  return s;
}

/** Laplacian variance на уменьшенной копии — выше = резче. */
export async function measureImageSharpness(buf: Buffer): Promise<number> {
  const { data, info } = await sharp(buf)
    .greyscale()
    .resize(360, 360, { fit: "inside", withoutEnlargement: true })
    .convolve({
      width: 3,
      height: 3,
      kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0]
    })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const n = info.width * info.height;
  if (!n) return 0;

  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < data.length; i++) {
    const v = data[i]!;
    sum += v;
    sumSq += v * v;
  }
  const mean = sum / data.length;
  const variance = sumSq / data.length - mean * mean;
  return Math.max(0, variance);
}

export async function measureLetualTechnicalScore(url: string): Promise<LetualTechnicalScore | null> {
  const norm = normalizeLetualSourceUrl(url);
  const fetched = await fetchPodruzhkaProductImageDetailed(norm);
  if (!fetched.buf?.length) return null;

  const meta = await sharp(fetched.buf).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  const pixels = width * height;
  const sharpness = await measureImageSharpness(fetched.buf);
  const bytes = fetched.buf.length;

  const technicalScore =
    Math.min(pixels / 2500, 400) +
    Math.min(sharpness / 4, 120) +
    Math.min(bytes / 8000, 80) +
    urlResolutionHint(norm);

  return {
    url: norm,
    width,
    height,
    pixels,
    bytes,
    sharpness,
    technicalScore
  };
}

/** Предварительный ранжир по разрешению и резкости (без AI). */
export async function rankLetualUrlsByTechnicalQuality(
  urls: string[]
): Promise<LetualTechnicalScore[]> {
  const list = normalizeLetualFotoUrls(urls);
  const measured = (
    await Promise.all(list.map((url) => measureLetualTechnicalScore(url)))
  ).filter((x): x is LetualTechnicalScore => x !== null);

  measured.sort((a, b) => b.technicalScore - a.technicalScore);
  return measured;
}
