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

async function runLocalAiCutout(input: Buffer): Promise<Buffer> {
  const { rmbg } = await import("rmbg");
  const out = await rmbg(input);
  const buf = Buffer.isBuffer(out) ? out : Buffer.from(out);
  if (buf.length < 4096) {
    throw new Error("ai cutout: пустой результат");
  }
  return buf;
}

/**
 * PNG без фона — локальная модель (rmbg), без API-ключей.
 * Результат кэшируется в Yandex S3: каждый URL Ozon обрабатывается один раз.
 */
export async function fetchAiCutout(sourceUrl: string, input: Buffer): Promise<Buffer> {
  const cachedUrl = cosmeticsCutoutPublicUrl(sourceUrl);
  if (cachedUrl) {
    const cached = await fetchCachedCutout(cachedUrl);
    if (cached) return cached;
  }

  const cutout = await runLocalAiCutout(input);

  if (cachedUrl) {
    try {
      await uploadOzonImageAtKey(cutout, cosmeticsCutoutCacheKey(sourceUrl), "image/png");
    } catch (e) {
      console.warn("cutout cache upload failed", e);
    }
  }

  return cutout;
}
