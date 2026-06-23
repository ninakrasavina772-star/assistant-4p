import { fetchGcsObjectAuthenticated } from "@/lib/gcsAuthenticatedFetch";
import { fetchPodruzhkaProductImageDetailed } from "@/lib/podruzhkaImageFetch";
import { getOzonStorageBackend, uploadOzonImage, uploadOzonImageAtKey } from "@/lib/ozonImageStorage";
import {
  imageUrlIdentityKey,
  isYandexProcessedStorageUrl,
  uniqueUrlsForImageCell
} from "@/lib/templateGenerator/imageUrlDedupe";

const MIN_BYTES = 512;

/** Уже публичные CDN / наше хранилище — rehost не нужен */
export function isPublicImageCatalogUrl(url: string): boolean {
  const u = url.toLowerCase();
  if (isYandexProcessedStorageUrl(url)) return true;
  if (/cdnru\.4stand\.com|4partners|deloox\.com/i.test(u)) return true;
  if (/storage\.yandexcloud\.net|\.blob\.vercel-storage\.com/i.test(u)) return true;
  if (/ozon\.ru|ozone\.ru|goldapple|letu\.ru/i.test(u)) return true;
  return false;
}

/** Приватные бакеты поставщиков — нужен rehost на публичное S3 */
export function needsPublicRehost(url: string): boolean {
  const t = url.trim();
  if (!/^https?:\/\//i.test(t)) return false;
  if (isPublicImageCatalogUrl(t)) return false;

  const u = t.toLowerCase();
  if (/storage\.googleapis\.com/i.test(u)) return true;
  if (/tradeinn-images/i.test(u)) return true;
  if (/amazonaws\.com.*(?:private|internal)/i.test(u)) return true;

  return false;
}

async function downloadForRehost(url: string): Promise<Buffer | null> {
  const normal = await fetchPodruzhkaProductImageDetailed(url);
  if (normal.buf?.length && normal.buf.length >= MIN_BYTES) return normal.buf;

  if (/storage\.googleapis\.com/i.test(url)) {
    const gcs = await fetchGcsObjectAuthenticated(url);
    if (gcs?.length) return gcs;
  }

  return null;
}

async function uploadRehosted(buf: Buffer, sku: string, tag: string): Promise<string> {
  const safeSku = sku.replace(/[^\w.-]+/g, "_").slice(0, 48) || "sku";
  const safeTag = tag.replace(/[^\w.-]+/g, "_").slice(0, 32);
  const fileName = `rehost-${safeSku}-${safeTag}.jpg`;

  if (getOzonStorageBackend() === "yandex") {
    const id = crypto.randomUUID();
    const prefix = process.env.YANDEX_S3_PREFIX?.trim().replace(/^\/+|\/+$/g, "") || "ozon-images";
    const key = `${prefix}/template-generator/rehost/${id}/${fileName}`;
    return uploadOzonImageAtKey(buf, key, "image/jpeg");
  }

  return uploadOzonImage(buf, fileName);
}

export type RehostCache = Map<string, string>;

/**
 * Скачать приватное фото на сервере и вернуть публичный URL (Yandex S3 / Vercel Blob).
 * При ошибке возвращает исходный URL.
 */
export async function rehostImageUrlIfNeeded(
  url: string,
  opts: { sku?: string; tag?: string; cache?: RehostCache } = {}
): Promise<string> {
  const t = url.trim();
  if (!t || !needsPublicRehost(t)) return t;
  if (!getOzonStorageBackend()) return t;

  const idKey = imageUrlIdentityKey(t);
  const hit = opts.cache?.get(idKey);
  if (hit) return hit;

  const buf = await downloadForRehost(t);
  if (!buf) return t;

  try {
    const publicUrl = await uploadRehosted(buf, opts.sku ?? "img", opts.tag ?? "r");
    opts.cache?.set(idKey, publicUrl);
    return publicUrl;
  } catch {
    return t;
  }
}

export async function rehostImageUrls(
  urls: string[],
  sku: string,
  cache?: RehostCache
): Promise<string[]> {
  const out: string[] = [];
  let i = 0;
  for (const raw of urls) {
    const u = raw.trim();
    if (!u) continue;
    const rehosted = await rehostImageUrlIfNeeded(u, {
      sku,
      tag: `u${++i}`,
      cache
    });
    out.push(rehosted);
  }
  return uniqueUrlsForImageCell(out);
}
