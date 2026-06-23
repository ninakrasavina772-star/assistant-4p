import { createHash } from "crypto";
import sharp from "sharp";
import { fetchSiblingVariationPhotos } from "@/lib/letualMetabase";
import { LETUAL_CANVAS_SIZE, LETUAL_JPEG_QUALITY } from "@/lib/letualMainPhotoConstants";
import { processLetualMainPhotoFromUrl } from "@/lib/letualMainPhotoProcess";
import { compositeFlatImageToLetualCanvas } from "@/lib/letualMainPhotoLayout";
import { fetchLetualImageDetailed } from "@/lib/letualFotoQuality";
import { getOzonStorageBackend, uploadOzonImage, uploadOzonImageAtKey } from "@/lib/ozonImageStorage";
import { fetchMetabaseProductBySku } from "@/lib/templateGenerator/metabaseProduct";
import {
  dedupeImageUrlsSemantic,
  imageUrlIdentityKey,
  isYandexProcessedStorageUrl,
  uniqueUrlsForImageCell
} from "@/lib/templateGenerator/imageUrlDedupe";
import { mergeImageUrls, parseImageUrls } from "@/lib/templateGenerator/photos";
import { normVariationSku } from "@/lib/templateGenerator/parseVariationIds";
import { rehostImageUrls, type RehostCache } from "@/lib/templateGenerator/rehostImageUrl";

const MAX_PACKSHOT_PROCESS = 5;
const MAX_BACKGROUND = 4;
const PACKSHOT_CONCURRENCY = 2;

function isThumbOrSmallUrl(url: string): boolean {
  const u = url.toLowerCase();
  return /thumb|_small|_mini|preview|icon|multimedia-1-s\/|\/s\.jpg|50x50|100x100|150x150/.test(
    u
  );
}

function isCdnPackshotUrl(url: string): boolean {
  return /cdnru\.4stand\.com\/huge\/|\/huge\/[0-9a-f]{40,}/i.test(url);
}

function isAdminBackgroundUrl(url: string): boolean {
  if (isThumbOrSmallUrl(url)) return false;
  if (isCdnPackshotUrl(url)) return false;
  const u = url.toLowerCase();
  if (
    /lifestyle|lookbook|model|banner|ingredient|flower|scene|interior|flacon|cdnbigbuy|_r10|_r20|_r30|makeupstore|notino/i.test(
      u
    )
  ) {
    return true;
  }
  if (!/4stand|cdnru\.4partners|deloox\.com|ozon\.ru|goldapple|letu\.ru/i.test(u)) {
    return true;
  }
  return false;
}

function splitYandexImageUrls(urls: string[]): { packshots: string[]; backgrounds: string[] } {
  const packshots: string[] = [];
  const backgrounds: string[] = [];
  const seen = new Set<string>();

  for (const raw of urls) {
    const u = raw.trim();
    if (!/^https?:\/\//i.test(u)) continue;
    const key = imageUrlIdentityKey(u);
    if (seen.has(key)) continue;
    seen.add(key);

    if (isAdminBackgroundUrl(u)) backgrounds.push(u);
    else packshots.push(u);
  }

  return { packshots, backgrounds };
}

function prioritizeMainPackshot(packshots: string[], mainImageUrl: string | null): string[] {
  if (!mainImageUrl?.trim()) return packshots;
  const mainKey = imageUrlIdentityKey(mainImageUrl);
  const rest = packshots.filter((u) => imageUrlIdentityKey(u) !== mainKey);
  const main =
    packshots.find((u) => imageUrlIdentityKey(u) === mainKey) ?? mainImageUrl.trim();
  return [main, ...rest];
}

async function uploadYandexPhoto(buf: Buffer, sku: string, tag: string): Promise<string> {
  const safeSku = sku.replace(/[^\w.-]+/g, "_").slice(0, 48) || "sku";
  const safeTag = tag.replace(/[^\w.-]+/g, "_").slice(0, 32);
  const fileName = `ym-${safeSku}-${safeTag}.jpg`;

  if (getOzonStorageBackend() === "yandex") {
    const id = crypto.randomUUID();
    const prefix = process.env.YANDEX_S3_PREFIX?.trim().replace(/^\/+|\/+$/g, "") || "ozon-images";
    const key = `${prefix}/template-generator/yandex/${id}/${fileName}`;
    return uploadOzonImageAtKey(buf, key, "image/jpeg");
  }

  return uploadOzonImage(buf, fileName);
}

async function enhanceBackgroundPhotoTo1000(buf: Buffer): Promise<Buffer> {
  const meta = await sharp(buf).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;

  if (w >= LETUAL_CANVAS_SIZE && h >= LETUAL_CANVAS_SIZE) {
    return sharp(buf).jpeg({ quality: LETUAL_JPEG_QUALITY, mozjpeg: true }).toBuffer();
  }

  return sharp(buf)
    .resize(LETUAL_CANVAS_SIZE, LETUAL_CANVAS_SIZE, {
      fit: "inside",
      withoutEnlargement: false,
      kernel: sharp.kernel.lanczos3
    })
    .jpeg({ quality: LETUAL_JPEG_QUALITY, mozjpeg: true })
    .toBuffer();
}

async function downloadBackgroundImage(url: string): Promise<Buffer | null> {
  const fetched = await fetchLetualImageDetailed(url);
  if (fetched?.buf?.length) return fetched.buf;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(20_000),
      headers: { Accept: "image/*", "User-Agent": "assistant-4p-yandex-photos/1.0" }
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length >= 512 ? buf : null;
  } catch {
    return null;
  }
}

type PackshotState = {
  sourceKeys: Set<string>;
  contentHashes: Set<string>;
  results: string[];
};

function isRawCdnPackshotUrl(url: string): boolean {
  return isCdnPackshotUrl(url) && !isYandexProcessedStorageUrl(url);
}

async function packshotTo1000Buffer(src: string): Promise<Buffer> {
  try {
    return await processLetualMainPhotoFromUrl(src);
  } catch {
    const fetched = await fetchLetualImageDetailed(src);
    if (!fetched?.buf?.length) {
      throw new Error("не скачалось");
    }
    return compositeFlatImageToLetualCanvas(fetched.buf);
  }
}

async function assert1000x1000(buf: Buffer): Promise<Buffer> {
  const meta = await sharp(buf).metadata();
  if (meta.width === LETUAL_CANVAS_SIZE && meta.height === LETUAL_CANVAS_SIZE) {
    return buf;
  }
  return compositeFlatImageToLetualCanvas(buf);
}

async function processOnePackshot(
  src: string,
  sku: string,
  state: PackshotState
): Promise<void> {
  const srcKey = imageUrlIdentityKey(src);
  if (state.sourceKeys.has(srcKey)) return;
  state.sourceKeys.add(srcKey);

  try {
    let buf = await packshotTo1000Buffer(src);
    buf = await assert1000x1000(buf);
    const contentHash = createHash("sha256").update(buf).digest("hex").slice(0, 24);
    if (state.contentHashes.has(contentHash)) return;
    state.contentHashes.add(contentHash);

    const url = await uploadYandexPhoto(buf, sku, `p${state.results.length + 1}`);
    state.results.push(url);
  } catch {
    /* skip failed source */
  }
}

async function processPackshotsParallel(
  urls: string[],
  sku: string,
  maxUnique: number
): Promise<string[]> {
  const state: PackshotState = {
    sourceKeys: new Set(),
    contentHashes: new Set(),
    results: []
  };

  let cursor = 0;
  const workers = Array.from({ length: PACKSHOT_CONCURRENCY }, async () => {
    while (cursor < urls.length && state.results.length < maxUnique) {
      const idx = cursor++;
      await processOnePackshot(urls[idx]!, sku, state);
    }
  });
  await Promise.all(workers);
  return state.results;
}

export type YandexRowPhotosOpts = {
  imageText: string;
  sku: string;
  targetCount: number;
  metabaseEnabled?: boolean;
};

export type YandexRowPhotosResult = {
  imageUrls: string[];
  processed: string[];
  note?: string;
};

export async function resolveYandexRowPhotos(
  opts: YandexRowPhotosOpts
): Promise<YandexRowPhotosResult> {
  const parsed = dedupeImageUrlsSemantic(parseImageUrls(opts.imageText));
  const alreadyDone = parsed.filter(isYandexProcessedStorageUrl);
  let sourceUrls = parsed.filter((u) => !isThumbOrSmallUrl(u) && !isYandexProcessedStorageUrl(u));

  let mainImageUrl: string | null = null;
  const variationId = normVariationSku(opts.sku);

  if (opts.metabaseEnabled !== false && variationId) {
    try {
      const mb = await fetchMetabaseProductBySku(opts.sku);
      if (mb) {
        mainImageUrl = mb.mainImageUrl;
        if (mb.imageUrls.length) {
          sourceUrls = dedupeImageUrlsSemantic(mergeImageUrls(sourceUrls, mb.imageUrls));
          sourceUrls = sourceUrls.filter((u) => !isYandexProcessedStorageUrl(u));
        }
      }
    } catch {
      /* optional */
    }

    try {
      const siblings = await fetchSiblingVariationPhotos(variationId, undefined, undefined, 12);
      const siblingUrls = siblings
        .map((s) => s.mainImageUrl)
        .filter((u): u is string => Boolean(u));
      sourceUrls = dedupeImageUrlsSemantic(mergeImageUrls(sourceUrls, siblingUrls));
      sourceUrls = sourceUrls.filter((u) => !isYandexProcessedStorageUrl(u));
    } catch {
      /* optional */
    }
  }

  sourceUrls = sourceUrls.filter((u) => !isThumbOrSmallUrl(u));

  const rehostCache: RehostCache = new Map();
  if (sourceUrls.length) {
    sourceUrls = await rehostImageUrls(sourceUrls, opts.sku, rehostCache);
  }

  if (!sourceUrls.length && !alreadyDone.length) {
    return { imageUrls: [], processed: [], note: "нет исходных foto" };
  }

  if (!getOzonStorageBackend()) {
    const kept = uniqueUrlsForImageCell(alreadyDone);
    return {
      imageUrls: kept,
      processed: kept,
      note: kept.length
        ? "только ранее загруженные foto (хранилище S3 недоступно)"
        : "хранилище не настроено — packshot не приведены к 1000×1000"
    };
  }

  const { packshots: rawPackshots, backgrounds: rawBackgrounds } =
    splitYandexImageUrls(sourceUrls);
  const packshots = prioritizeMainPackshot(rawPackshots, mainImageUrl);
  const packshotKeys = new Set(packshots.map(imageUrlIdentityKey));

  const targetUnique = Math.max(1, Math.min(opts.targetCount, MAX_PACKSHOT_PROCESS));
  let whitePhotos = uniqueUrlsForImageCell(alreadyDone);

  if (packshots.length) {
    const need = Math.max(0, targetUnique - whitePhotos.length);
    if (need > 0) {
      const processed = await processPackshotsParallel(packshots, opts.sku, need);
      whitePhotos = uniqueUrlsForImageCell([...whitePhotos, ...processed]);
    }
  }

  const backgroundUrls: string[] = [];
  const seenOut = new Set(whitePhotos.map(imageUrlIdentityKey));

  for (const src of rawBackgrounds.slice(0, MAX_BACKGROUND)) {
    const srcKey = imageUrlIdentityKey(src);
    if (seenOut.has(srcKey) || packshotKeys.has(srcKey)) continue;

    try {
      const raw = await downloadBackgroundImage(src);
      if (!raw) continue;

      const contentHash = createHash("sha256").update(raw).digest("hex").slice(0, 24);
      if (seenOut.has(`hash:${contentHash}`)) continue;

      const enhanced = await enhanceBackgroundPhotoTo1000(raw);
      const uploadHash = createHash("sha256").update(enhanced).digest("hex").slice(0, 24);
      if (seenOut.has(`hash:${uploadHash}`)) continue;

      const url = await uploadYandexPhoto(enhanced, opts.sku, `bg-${backgroundUrls.length + 1}`);
      const urlKey = imageUrlIdentityKey(url);
      if (seenOut.has(urlKey)) continue;

      backgroundUrls.push(url);
      seenOut.add(srcKey);
      seenOut.add(urlKey);
      seenOut.add(`hash:${uploadHash}`);
    } catch {
      /* skip */
    }
  }

  const finalUrls = uniqueUrlsForImageCell([...whitePhotos, ...backgroundUrls]).filter(
    (u) => !isRawCdnPackshotUrl(u)
  );
  const skippedDupes =
    packshots.length + rawBackgrounds.length + alreadyDone.length - finalUrls.length;

  const parts: string[] = [];
  if (whitePhotos.length) parts.push(`${whitePhotos.length} packshot 1000×1000`);
  if (backgroundUrls.length) parts.push(`${backgroundUrls.length} с фоном`);
  if (skippedDupes > 0) parts.push(`дублей отброшено: ${skippedDupes}`);
  if (packshots.length && !whitePhotos.filter((u) => !isYandexProcessedStorageUrl(u)).length) {
    parts.push("исходники CDN не попали в ячейку — не удалось обработать");
  }

  return {
    imageUrls: finalUrls,
    processed: finalUrls,
    note: parts.length ? parts.join(" · ") : "нет foto"
  };
}
