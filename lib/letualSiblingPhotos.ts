import { fetchSiblingVariationPhotos, type SiblingPhotoCandidate } from "@/lib/letualMetabase";
import { pickSuitableLetualPhoto, pickBestFromRanked, type LetualPhotoScore } from "@/lib/letualPhotoAi";
import { validateImageUrl } from "@/lib/letualWebSearch";

function matchLabel(type: SiblingPhotoCandidate["matchType"]): string {
  if (type === "same_ean") return "тот же EAN";
  return "та же карточка";
}

function findSuitableInRanked(ranked: LetualPhotoScore[]): LetualPhotoScore | undefined {
  const suitable = ranked.filter((r) => r.suitable);
  if (!suitable.length) return undefined;
  return [...suitable].sort((a, b) => b.score - a.score)[0];
}

/** Подобрать фото среди других вариаций каталога (тот же EAN / та же карточка). */
export async function pickFromSiblingCatalogPhotos(
  variationId: number,
  openaiKey: string,
  seed: { brandName: string; productName: string },
  excludeUrls: string[] = [],
  metabaseApiKey?: string
): Promise<{ sourceUrl: string; comment: string; candidates: string[] }> {
  const siblings = await fetchSiblingVariationPhotos(
    variationId,
    metabaseApiKey,
    seed,
    20
  );

  const exclude = new Set(excludeUrls.map((u) => u.trim()).filter(Boolean));
  const urls = siblings
    .map((s) => ({ ...s, url: s.mainImageUrl }))
    .filter((s) => s.url && !exclude.has(s.url));

  if (!urls.length) {
    return { sourceUrl: "", comment: "", candidates: [] };
  }

  const allRanked: LetualPhotoScore[] = [];
  const metaByUrl = new Map<string, SiblingPhotoCandidate>();

  for (const item of urls) {
    if (!(await validateImageUrl(item.url))) continue;
    const scored = await pickSuitableLetualPhoto([item.url], openaiKey);
    for (const r of scored.ranked) {
      metaByUrl.set(r.url, item);
      allRanked.push(r);
    }
  }

  const suitable = findSuitableInRanked(allRanked);
  if (suitable?.url) {
    const meta = metaByUrl.get(suitable.url);
    return {
      sourceUrl: suitable.url,
      comment: `Фото из каталога (вариация ${meta?.variationId}, ${matchLabel(meta?.matchType ?? "same_product")})`,
      candidates: []
    };
  }

  const best = pickBestFromRanked(allRanked);
  if (best?.url) {
    const meta = metaByUrl.get(best.url);
    return {
      sourceUrl: "",
      comment: `Фото из каталога (вариация ${meta?.variationId}, ${matchLabel(meta?.matchType ?? "same_product")}): ${best.reason || "проверить"}`,
      candidates: [best.url]
    };
  }

  return { sourceUrl: "", comment: "", candidates: [] };
}
