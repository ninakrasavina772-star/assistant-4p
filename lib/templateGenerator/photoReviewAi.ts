import {
  imageUrlIdentityKey,
  dedupeImageUrlsSemantic
} from "@/lib/templateGenerator/imageUrlDedupe";
import {
  isGoodPackshotSource,
  pickBestFromRanked,
  pickLetualPhotoFast,
  pickLetualPhotoWithFallback,
  type LetualPhotoScore
} from "@/lib/letualPhotoAi";

export type PhotoReviewAutoPick = {
  mainUrl: string;
  extraUrls: string[];
  ranked: LetualPhotoScore[];
};

const MAX_EXTRAS = 5;

function samePhoto(a: string, b: string): boolean {
  return imageUrlIdentityKey(a) === imageUrlIdentityKey(b);
}

function isExtraCandidate(r: LetualPhotoScore, mainUrl: string): boolean {
  if (samePhoto(r.url, mainUrl)) return false;
  if (!r.hasProduct || r.hasInfographic) return false;
  if (r.hasBox) return false;
  return r.suitable || isGoodPackshotSource(r) || (r.isFrontal && r.hasWhiteBackground && r.quality >= 45);
}

/** Выбрать главное + доп. фото без дублей (fast или AI). */
export async function autoPickPhotoReviewUrls(
  urls: string[],
  opts?: { openaiApiKey?: string; useAi?: boolean }
): Promise<PhotoReviewAutoPick> {
  const unique = dedupeImageUrlsSemantic(urls.filter((u) => /^https?:\/\//i.test(u.trim())));
  if (!unique.length) {
    return { mainUrl: "", extraUrls: [], ranked: [] };
  }

  const useAi = opts?.useAi !== false && Boolean(opts?.openaiApiKey?.trim());
  const { best, ranked } = useAi
    ? await pickLetualPhotoWithFallback(unique, opts!.openaiApiKey!.trim())
    : await pickLetualPhotoFast(unique);

  const mainUrl = best?.url ?? pickBestFromRanked(ranked)?.url ?? unique[0]!;
  const extras: string[] = [];
  const seen = new Set<string>([imageUrlIdentityKey(mainUrl)]);

  for (const r of ranked) {
    if (extras.length >= MAX_EXTRAS) break;
    if (!isExtraCandidate(r, mainUrl)) continue;
    const key = imageUrlIdentityKey(r.url);
    if (seen.has(key)) continue;
    seen.add(key);
    extras.push(r.url);
  }

  if (!extras.length) {
    for (const url of unique) {
      if (extras.length >= MAX_EXTRAS) break;
      if (samePhoto(url, mainUrl)) continue;
      const key = imageUrlIdentityKey(url);
      if (seen.has(key)) continue;
      seen.add(key);
      extras.push(url);
    }
  }

  return { mainUrl, extraUrls: extras, ranked };
}

export function applyAutoPickToCandidates(
  candidates: { url: string; selected: boolean; isMain?: boolean }[],
  pick: PhotoReviewAutoPick
): typeof candidates {
  if (!pick.mainUrl) return candidates;
  const mainKey = imageUrlIdentityKey(pick.mainUrl);
  const extraKeys = new Set(pick.extraUrls.map(imageUrlIdentityKey));

  return candidates.map((c) => {
    const key = imageUrlIdentityKey(c.url);
    const isMain = key === mainKey;
    return {
      ...c,
      isMain,
      selected: !isMain && extraKeys.has(key)
    };
  });
}
