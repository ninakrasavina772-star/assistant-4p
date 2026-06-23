import sharp from "sharp";
import { fetchSiblingVariationPhotos } from "@/lib/letualMetabase";
import { LETUAL_CANVAS_SIZE, LETUAL_JPEG_QUALITY } from "@/lib/letualMainPhotoConstants";
import { processLetualMainPhotoFromUrl } from "@/lib/letualMainPhotoProcess";
import {
  fetchLetualImageDetailed,
  normalizeLetualFotoUrls,
  rankLetualUrlsByTechnicalQuality
} from "@/lib/letualFotoQuality";
import { getOzonStorageBackend, uploadOzonImage, uploadOzonImageAtKey } from "@/lib/ozonImageStorage";
import { fetchMetabaseProductBySku } from "@/lib/templateGenerator/metabaseProduct";
import {
  formatImageCellValue,
  mergeImageUrls,
  parseImageUrls
} from "@/lib/templateGenerator/photos";
import { normVariationSku } from "@/lib/templateGenerator/parseVariationIds";

const MIN_PIXELS = 250_000;
const MAX_PACKSHOT_PROCESS = 10;
const MAX_BACKGROUND = 6;

function isThumbOrSmallUrl(url: string): boolean {
  const u = url.toLowerCase();
  return /thumb|_small|_mini|preview|icon|multimedia-1-s\/|\/s\.jpg|50x50|100x100|150x150/.test(
    u
  );
}

/** CDN packshot из hash (4stand /huge/) — кандидат на белый фон Летуаль */
function isCdnPackshotUrl(url: string): boolean {
  const u = url.toLowerCase();
  return /cdnru\.4stand\.com\/huge\/|\/huge\/[0-9a-f]{40,}/i.test(u);
}

/**
 * Фото с фоном из админки (image_load.url): lifestyle, сцены, внешние ссылки.
 * На Летуаль такие не идут — на Яндекс Маркет добавляем в конец как есть.
 */
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
  // Внешняя ссылка из админки, не CDN каталога
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
    const key = u.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    if (isAdminBackgroundUrl(u)) backgrounds.push(u);
    else packshots.push(u);
  }

  return { packshots, backgrounds };
}

function prioritizeMainPackshot(packshots: string[], mainImageUrl: string | null): string[] {
  if (!mainImageUrl?.trim()) return packshots;
  const main = mainImageUrl.trim();
  const rest = packshots.filter((u) => u.toLowerCase() !== main.toLowerCase());
  return [main, ...rest];
}

async function uploadYandexPhoto(
  buf: Buffer,
  sku: string,
  tag: string
): Promise<string> {
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

/** Улучшить до ~1000×1000 без снятия фона (для lifestyle из админки) */
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
      signal: AbortSignal.timeout(25_000),
      headers: { Accept: "image/*", "User-Agent": "assistant-4p-yandex-photos/1.0" }
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length >= 512 ? buf : null;
  } catch {
    return null;
  }
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

/**
 * Яндекс Маркет:
 * — главное и packshot-фото: белый фон 1000×1000 по правилам Летуаль (processLetualMainPhotoFromUrl);
 * — фото с фоном из админки: в конец, улучшаем до 1000×1000 без снятия фона.
 */
export async function resolveYandexRowPhotos(
  opts: YandexRowPhotosOpts
): Promise<YandexRowPhotosResult> {
  let allUrls = normalizeLetualFotoUrls(parseImageUrls(opts.imageText));
  allUrls = allUrls.filter((u) => !isThumbOrSmallUrl(u));

  let mainImageUrl: string | null = null;
  const variationId = normVariationSku(opts.sku);

  if (opts.metabaseEnabled !== false && variationId) {
    try {
      const mb = await fetchMetabaseProductBySku(opts.sku);
      if (mb) {
        mainImageUrl = mb.mainImageUrl;
        if (mb.imageUrls.length) {
          allUrls = mergeImageUrls(allUrls, mb.imageUrls);
        }
      }
    } catch {
      /* Metabase optional */
    }

    try {
      const siblings = await fetchSiblingVariationPhotos(variationId, undefined, undefined, 24);
      const siblingUrls = siblings
        .map((s) => s.mainImageUrl)
        .filter((u): u is string => Boolean(u));
      allUrls = mergeImageUrls(allUrls, siblingUrls);
    } catch {
      /* siblings optional */
    }
  }

  allUrls = normalizeLetualFotoUrls(allUrls).filter((u) => !isThumbOrSmallUrl(u));

  if (!allUrls.length) {
    return { imageUrls: [], processed: [], note: "нет исходных foto" };
  }

  const { packshots: rawPackshots, backgrounds: rawBackgrounds } = splitYandexImageUrls(allUrls);
  let packshots = prioritizeMainPackshot(rawPackshots, mainImageUrl);

  if (!getOzonStorageBackend()) {
    const fallback = [...packshots, ...rawBackgrounds].slice(0, opts.targetCount);
    return {
      imageUrls: fallback,
      processed: [],
      note: "хранилище не настроено — исходные URL (packshot + фон)"
    };
  }

  const ranked = await rankLetualUrlsByTechnicalQuality(packshots.slice(0, 16));
  const filtered = ranked.filter((r) => r.pixels >= MIN_PIXELS && !isThumbOrSmallUrl(r.url));
  const rankedUrls = (filtered.length ? filtered : ranked)
    .sort((a, b) => b.technicalScore - a.technicalScore)
    .map((r) => r.url);

  const packshotOrder: string[] = [];
  const seenPack = new Set<string>();
  const pushPack = (u: string) => {
    const k = u.toLowerCase();
    if (seenPack.has(k)) return;
    seenPack.add(k);
    packshotOrder.push(u);
  };
  for (const u of packshots) pushPack(u);
  for (const u of rankedUrls) pushPack(u);

  const targetPackshots = Math.max(1, Math.min(opts.targetCount, MAX_PACKSHOT_PROCESS));
  const toProcess = packshotOrder.slice(0, targetPackshots);

  const whitePhotos: string[] = [];
  const errors: string[] = [];

  for (let i = 0; i < toProcess.length; i++) {
    const src = toProcess[i]!;
    try {
      const buf = await processLetualMainPhotoFromUrl(src);
      const url = await uploadYandexPhoto(buf, opts.sku, `main-${i + 1}`);
      whitePhotos.push(url);
    } catch (e) {
      errors.push(e instanceof Error ? e.message : "ошибка packshot");
    }
  }

  if (!whitePhotos.length && packshotOrder.length) {
    try {
      const buf = await processLetualMainPhotoFromUrl(packshotOrder[0]!);
      const url = await uploadYandexPhoto(buf, opts.sku, "main-fallback");
      whitePhotos.push(url);
    } catch {
      /* last resort below */
    }
  }

  const backgroundUrls: string[] = [];
  const seenBg = new Set(whitePhotos.map((u) => u.toLowerCase()));

  for (const src of rawBackgrounds.slice(0, MAX_BACKGROUND)) {
    if (seenBg.has(src.toLowerCase())) continue;
    try {
      const raw = await downloadBackgroundImage(src);
      if (!raw) {
        backgroundUrls.push(src);
        continue;
      }
      const enhanced = await enhanceBackgroundPhotoTo1000(raw);
      const url = await uploadYandexPhoto(enhanced, opts.sku, `bg-${backgroundUrls.length + 1}`);
      if (!seenBg.has(url.toLowerCase())) {
        backgroundUrls.push(url);
        seenBg.add(url.toLowerCase());
      }
    } catch {
      backgroundUrls.push(src);
    }
  }

  const finalUrls = [...whitePhotos, ...backgroundUrls];
  const parts: string[] = [];
  if (whitePhotos.length) parts.push(`${whitePhotos.length} packshot (белый фон)`);
  if (backgroundUrls.length) parts.push(`${backgroundUrls.length} с фоном (админка)`);
  if (errors.length) parts.push(`ошибки packshot: ${errors.slice(0, 1).join("; ")}`);

  const note = parts.length ? parts.join(" · ") : "нет обработанных foto";

  return {
    imageUrls: finalUrls.length ? finalUrls : [...packshotOrder, ...rawBackgrounds].slice(0, opts.targetCount),
    processed: finalUrls,
    note
  };
}

export function formatYandexImageCell(urls: string[]): string {
  return formatImageCellValue(urls);
}
