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
import { dedupeProductImagesByPose } from "@/lib/templateGenerator/yandexImageVisualDedupe.server";

const MIN_EDGE_PX = 700;
const MIN_BYTES = 20_000;
const PROBE_LIMIT = 12;

export { isLowQualityImageUrl };

/**
 * Оставить только качественные packshot URL: без заглушек, мелких и визуальных дублей.
 */
export async function filterYandexProductImageUrls(
  urls: string[],
  maxCount = 8
): Promise<string[]> {
  const candidates = filterYandexProductImageUrlsByUrl(urls);
  if (!candidates.length) return [];

  const poseUnique = await dedupeProductImagesByPose(candidates, {
    maxCount: Math.max(maxCount + 2, 12)
  });
  if (!poseUnique.length) return [];

  const probed: { url: string; pixels: number; bytes: number; key: string }[] = [];

  await Promise.all(
    poseUnique.slice(0, PROBE_LIMIT).map(async (raw) => {
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
    return poseUnique.slice(0, maxCount);
  }

  probed.sort((a, b) => b.pixels - a.pixels || b.bytes - a.bytes);

  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of probed) {
    if (seen.has(item.key)) continue;
    seen.add(item.key);
    out.push(item.url);
    if (out.length >= maxCount) break;
  }
  return out.length ? out : poseUnique.slice(0, maxCount);
}
