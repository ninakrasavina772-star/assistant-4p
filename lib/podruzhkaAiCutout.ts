import { createHash } from "crypto";
import {
  buildYandexPublicUrl,
  getOzonStorageBackend,
  uploadOzonImageAtKey
} from "@/lib/ozonImageStorage";
import { preferOzonFullSizeUrl } from "@/lib/podruzhkaImageFetch";

const CACHE_SUBDIR = "cosmetics-cutout";

function yandexPrefix(): string {
  const p = process.env.YANDEX_S3_PREFIX?.trim();
  return p ? p.replace(/^\/+|\/+$/g, "") : "ozon-images";
}

/** Стабильный ключ кэша по URL foto с Ozon. */
export function cosmeticsCutoutCacheKey(sourceUrl: string): string {
  const norm = preferOzonFullSizeUrl(sourceUrl.trim());
  const hash = createHash("sha256").update(norm).digest("hex");
  return `${yandexPrefix()}/${CACHE_SUBDIR}/${hash}.png`;
}

export function cosmeticsCutoutPublicUrl(sourceUrl: string): string | null {
  if (getOzonStorageBackend() !== "yandex") return null;
  return buildYandexPublicUrl(cosmeticsCutoutCacheKey(sourceUrl));
}

async function fetchCachedCutout(publicUrl: string): Promise<Buffer | null> {
  try {
    const res = await fetch(publicUrl, {
      signal: AbortSignal.timeout(20_000),
      headers: { Accept: "image/png" }
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 4096) return null;
    return buf;
  } catch {
    return null;
  }
}

/** Сохранить готовый cut-out в Yandex (скрипт precompute-cutouts). */
export async function saveCutoutToCache(sourceUrl: string, png: Buffer): Promise<string | null> {
  if (getOzonStorageBackend() !== "yandex") return null;
  const key = cosmeticsCutoutCacheKey(sourceUrl);
  return uploadOzonImageAtKey(png, key, "image/png");
}

/**
 * На Vercel — только чтение кэша из Yandex (без тяжёлой AI-модели).
 * Если кэша нет — бросает AI_CUTOUT_CACHE_MISS → fallback на edge.
 */
export async function fetchAiCutout(sourceUrl: string): Promise<Buffer> {
  const cachedUrl = cosmeticsCutoutPublicUrl(sourceUrl);
  if (!cachedUrl) {
    throw new Error("AI_CUTOUT_CACHE_MISS");
  }
  const cached = await fetchCachedCutout(cachedUrl);
  if (cached) return cached;
  throw new Error("AI_CUTOUT_CACHE_MISS");
}
