import "server-only";

import {
  phash64FromUrl,
  visualSimilarFromPhash,
  type PhashCache
} from "@/lib/imagePhash";
import { imageUrlIdentityKey } from "@/lib/templateGenerator/imageUrlDedupe";
import { urlResolutionScore } from "@/lib/templateGenerator/yandexImageFilter";

/** Один ракурс товара: строже, чем кросс-каталожный поиск дублей */
export const YANDEX_POSE_HAMMING_MAX = 9;

/**
 * Убрать визуальные дубли: один и тот же ракурс с разных CDN/размеров.
 * Оставляем лучшее по urlResolutionScore из каждой группы похожих кадров.
 */
export async function dedupeProductImagesByPose(
  urls: string[],
  opts?: { maxCount?: number; hammingMax?: number; cache?: PhashCache }
): Promise<string[]> {
  const maxCount = opts?.maxCount ?? 8;
  const hammingMax = opts?.hammingMax ?? YANDEX_POSE_HAMMING_MAX;
  const cache = opts?.cache ?? new Map<string, bigint | null>();

  const sorted = urls
    .map((u) => u.trim())
    .filter((u) => /^https?:\/\//i.test(u));
  sorted.sort((a, b) => urlResolutionScore(b) - urlResolutionScore(a));

  const urlSeen = new Set<string>();
  const uniq: string[] = [];
  for (const url of sorted) {
    const key = imageUrlIdentityKey(url);
    if (urlSeen.has(key)) continue;
    urlSeen.add(key);
    uniq.push(url);
  }

  const kept: { url: string; phash: bigint | null }[] = [];
  for (const url of uniq) {
    if (kept.length >= maxCount) break;
    const phash = await phash64FromUrl(url, cache);
    const isSamePose = kept.some((item) =>
      visualSimilarFromPhash(phash, item.phash, hammingMax)
    );
    if (!isSamePose) kept.push({ url, phash });
  }

  return kept.map((item) => item.url);
}
