import {
  dedupeAndNormalizeFotoUrls,
  normalize4standHugeWebp
} from "@/lib/podruzhkaFotoPick";
import { uniqueUrlsForImageCell } from "@/lib/templateGenerator/imageUrlDedupe";

/** URL-паттерны миниатюр, заглушек и превью — не использовать как packshot */
export function isLowQualityImageUrl(url: string): boolean {
  const u = url.toLowerCase();
  if (!/^https?:\/\//i.test(u)) return true;
  if (
    /thumb|_small|_mini|preview|icon|placeholder|noimage|no-image|default-image|dummy|multimedia-1-s\//.test(
      u
    )
  ) {
    return true;
  }
  if (/\b(50x50|100x100|150x150|200x200|250x250)\b/.test(u)) return true;
  return false;
}

export function urlResolutionScore(url: string): number {
  let s = 0;
  const u = url.toLowerCase();
  if (/\/huge\//.test(u)) s += 1200;
  if (/multimedia-1-f\//.test(u)) s += 800;
  if (/900x900/.test(u)) s += 500;
  if (/1200x|1500x|2000x/.test(u)) s += 600;
  if (/thumb|small|mini|preview|icon/.test(u)) s -= 900;
  if (/multimedia-1-s\//.test(u)) s -= 400;
  return s;
}

/** Клиент-безопасный отбор URL без sharp (для UI-инъекции вариаций). */
export function filterYandexProductImageUrlsByUrl(urls: string[]): string[] {
  const candidates = dedupeAndNormalizeFotoUrls(
    urls.map((u) => normalize4standHugeWebp(u.trim())).filter((u) => !isLowQualityImageUrl(u))
  );
  if (!candidates.length) return [];
  candidates.sort((a, b) => urlResolutionScore(b) - urlResolutionScore(a));
  return uniqueUrlsForImageCell(candidates);
}
