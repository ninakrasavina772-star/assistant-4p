import { createHash } from "crypto";
import {
  buildYandexPublicUrl,
  getOzonStorageBackend,
  uploadOzonImageAtKey
} from "@/lib/ozonImageStorage";
import { preferOzonFullSizeUrl } from "@/lib/podruzhkaImageFetch";

const REMOVEBG_ENDPOINT = "https://api.remove.bg/v1.0/removebg";
const CACHE_SUBDIR = "cosmetics-cutout";

export function removeBgConfigured(): boolean {
  return Boolean(process.env.REMOVEBG_API_KEY?.trim());
}

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

async function callRemoveBgApi(input: Buffer): Promise<Buffer> {
  const apiKey = process.env.REMOVEBG_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("REMOVEBG_API_KEY не задан");
  }

  const form = new FormData();
  form.append("image_file", new Blob([new Uint8Array(input)]), "product.jpg");
  form.append("size", "auto");
  form.append("type", "product");
  form.append("format", "png");

  const res = await fetch(REMOVEBG_ENDPOINT, {
    method: "POST",
    headers: { "X-Api-Key": apiKey },
    body: form,
    signal: AbortSignal.timeout(90_000)
  });

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const j = (await res.json()) as { errors?: { title?: string }[] };
      const t = j.errors?.[0]?.title;
      if (t) detail = t;
    } catch {
      /* ignore */
    }
    throw new Error(`remove.bg: ${detail}`);
  }

  const out = Buffer.from(await res.arrayBuffer());
  if (out.length < 4096) {
    throw new Error("remove.bg: пустой ответ");
  }
  return out;
}

/**
 * PNG без фона через remove.bg. Результат кэшируется в Yandex S3 по hash URL.
 */
export async function fetchRemoveBgCutout(
  sourceUrl: string,
  input: Buffer
): Promise<Buffer> {
  const cachedUrl = cosmeticsCutoutPublicUrl(sourceUrl);
  if (cachedUrl) {
    const cached = await fetchCachedCutout(cachedUrl);
    if (cached) return cached;
  }

  const cutout = await callRemoveBgApi(input);

  if (cachedUrl) {
    try {
      await uploadOzonImageAtKey(cutout, cosmeticsCutoutCacheKey(sourceUrl), "image/png");
    } catch (e) {
      console.warn("cutout cache upload failed", e);
    }
  }

  return cutout;
}
