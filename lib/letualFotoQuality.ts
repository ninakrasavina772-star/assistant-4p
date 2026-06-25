import sharp from "sharp";
import { preferOzonFullSizeUrl, fetchPodruzhkaProductImageDetailed } from "@/lib/podruzhkaImageFetch";
import {
  dedupeAndNormalizeFotoUrls,
  normalize4standHugeWebp
} from "@/lib/podruzhkaFotoPick";
import { mapPool } from "@/lib/letualAsyncPool";
import { LETUAL_DOWNLOAD_CONCURRENCY } from "@/lib/letualMainPhotoConstants";

export type LetualTechnicalScore = {
  url: string;
  originalUrl: string;
  width: number;
  height: number;
  pixels: number;
  bytes: number;
  sharpness: number;
  technicalScore: number;
  downloadable: true;
};

export type LetualFetchedImage = {
  originalUrl: string;
  usedUrl: string;
  buf: Buffer;
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

function urlCandidates(raw: string): string[] {
  const t = raw.trim();
  const out: string[] = [];
  const add = (u: string) => {
    if (u && !out.includes(u)) out.push(u);
  };
  add(normalizeLetualSourceUrl(t));
  add(preferOzonFullSizeUrl(t));
  add(t);
  return out;
}

/** Скачать фото: нормализованный URL, затем оригинал из БД. */
export async function fetchLetualImageDetailed(
  rawUrl: string
): Promise<{ buf: Buffer; usedUrl: string; originalUrl: string } | null> {
  const originalUrl = rawUrl.trim();
  for (const candidate of urlCandidates(originalUrl)) {
    const fetched = await fetchPodruzhkaProductImageDetailed(candidate);
    if (fetched.buf?.length) {
      return { buf: fetched.buf, usedUrl: candidate, originalUrl };
    }
  }
  return null;
}

export function hostPriorityScore(url: string): number {
  const u = url.toLowerCase();
  if (/cdnru\.4stand|4partners|deloox\.com/.test(u)) return 250;
  if (/ozon|goldapple|letu\.ru/.test(u)) return 120;
  if (/makeupstore|parfimo|notino|douglas/.test(u)) return -80;
  return 0;
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

/** Только URL, которые реально скачиваются (параллельно). */
export async function filterDownloadableLetualUrls(urls: string[]): Promise<string[]> {
  const fetched = await fetchLetualImagesParallel(urls);
  return fetched.map((f) => f.originalUrl);
}

/** Скачать URL параллельно, один раз на URL. */
export async function fetchLetualImagesParallel(
  urls: string[],
  concurrency = LETUAL_DOWNLOAD_CONCURRENCY
): Promise<LetualFetchedImage[]> {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const raw of urls) {
    const t = raw.trim();
    if (!t.startsWith("http") || seen.has(t)) continue;
    seen.add(t);
    unique.push(t);
  }

  const results = await mapPool(unique, concurrency, async (url) => {
    const fetched = await fetchLetualImageDetailed(url);
    if (!fetched?.buf?.length) return null;
    return {
      originalUrl: fetched.originalUrl,
      usedUrl: fetched.usedUrl,
      buf: fetched.buf
    };
  });

  return results.filter((x): x is LetualFetchedImage => x !== null);
}

export async function technicalScoreFromBuffer(
  fetched: LetualFetchedImage
): Promise<LetualTechnicalScore> {
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
    urlResolutionHint(fetched.usedUrl) +
    hostPriorityScore(fetched.usedUrl);

  return {
    url: fetched.usedUrl,
    originalUrl: fetched.originalUrl,
    width,
    height,
    pixels,
    bytes,
    sharpness,
    technicalScore,
    downloadable: true
  };
}

/** Предварительный ранжир по разрешению и резкости (без AI), одно скачивание на URL. */
export async function rankLetualUrlsByTechnicalQuality(
  urls: string[]
): Promise<{ ranked: LetualTechnicalScore[]; fetched: LetualFetchedImage[] }> {
  const fetched = await fetchLetualImagesParallel(urls);
  const measured = (
    await Promise.all(fetched.map((f) => technicalScoreFromBuffer(f)))
  ).filter((x): x is LetualTechnicalScore => x !== null);

  measured.sort((a, b) => b.technicalScore - a.technicalScore);
  return { ranked: measured, fetched };
}

/** @deprecated Используйте rankLetualUrlsByTechnicalQuality — оставлено для совместимости. */
export async function measureLetualTechnicalScore(
  rawUrl: string
): Promise<LetualTechnicalScore | null> {
  const fetched = await fetchLetualImageDetailed(rawUrl);
  if (!fetched) return null;
  return technicalScoreFromBuffer({
    originalUrl: fetched.originalUrl,
    usedUrl: fetched.usedUrl,
    buf: fetched.buf
  });
}
