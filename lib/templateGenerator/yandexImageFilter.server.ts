import "server-only";

import sharp from "sharp";
import { fetchPodruzhkaProductImageDetailed } from "@/lib/podruzhkaImageFetch";
import {
  dedupeAndNormalizeFotoUrls,
  fotoUrlHashKey,
  normalize4standHugeWebp
} from "@/lib/podruzhkaFotoPick";
import {
  filterYandexProductImageUrlsByUrl,
  isLowQualityImageUrl
} from "@/lib/templateGenerator/yandexImageFilter";

const MIN_EDGE_PX = 480;
const MIN_BYTES = 16_000;
const PROBE_LIMIT = 10;

export { isLowQualityImageUrl };

/**
 * Оставить только качественные packshot URL: без заглушек и мелких дублей.
 * При нескольких фото одного товара — приоритет крупному (по пикселям/байтам).
 */
export async function filterYandexProductImageUrls(urls: string[]): Promise<string[]> {
  const candidates = filterYandexProductImageUrlsByUrl(urls);
  if (!candidates.length) return [];

  const probed: { url: string; pixels: number; bytes: number; key: string }[] = [];

  await Promise.all(
    candidates.slice(0, PROBE_LIMIT).map(async (raw) => {
      const url = normalize4standHugeWebp(raw);
      try {
        const fetched = await fetchPodruzhkaProductImageDetailed(url);
        const buf = fetched.buf;
        if (!buf?.length || buf.length < MIN_BYTES) return;

        const meta = await sharp(buf).metadata();
        const w = meta.width ?? 0;
        const h = meta.height ?? 0;
        if (w < MIN_EDGE_PX || h < MIN_EDGE_PX) return;

        const finalUrl = url;
        probed.push({
          url: finalUrl,
          pixels: w * h,
          bytes: buf.length,
          key: fotoUrlHashKey(normalize4standHugeWebp(finalUrl))
        });
      } catch {
        /* skip broken source */
      }
    })
  );

  if (!probed.length) {
    return candidates;
  }

  probed.sort((a, b) => b.pixels - a.pixels || b.bytes - a.bytes);

  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of probed) {
    if (seen.has(item.key)) continue;
    seen.add(item.key);
    out.push(item.url);
  }
  return out;
}
