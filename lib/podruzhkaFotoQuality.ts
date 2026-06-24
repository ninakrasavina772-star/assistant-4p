import { dedupeAndNormalizeFotoUrls } from "@/lib/podruzhkaFotoPick";
import {
  isLowQualityImageUrl,
  urlResolutionScore
} from "@/lib/templateGenerator/yandexImageFilter";

/**
 * URL из шаблона/Ozon, с которым cut-out и upscale дают размытие или белые квадраты.
 * Предпочитаем /huge/ webp из 4stand/Metabase.
 */
export function isLikelyBadPerfumeFotoUrl(url: string): boolean {
  const u = url.trim();
  if (!u || isLowQualityImageUrl(u)) return true;
  const l = u.toLowerCase();
  if (/cdn1\.ozone\.ru|ozon\.ru\/s3\/multimedia-1-[0-9a-g]\//i.test(l)) return true;
  if (/\/900x900\//i.test(l)) return true;
  if (urlResolutionScore(u) < 200) return true;
  return false;
}

export function isGoodPerfumePackshotUrl(url: string): boolean {
  const u = url.trim();
  if (!u || isLowQualityImageUrl(u)) return false;
  return urlResolutionScore(u) >= 500 || /\/huge\//i.test(u);
}

/** Оставить /huge/ и прочие нормальные URL; Ozon-thumb выкинуть, если есть альтернатива. */
export function filterPerfumeFotoCandidates(urls: string[]): string[] {
  const list = dedupeAndNormalizeFotoUrls(urls);
  if (!list.length) return [];
  const good = list.filter((u) => !isLikelyBadPerfumeFotoUrl(u));
  return good.length ? good : list;
}

export function perfumeFotoUrlTechnicalScore(url: string): number {
  return urlResolutionScore(url);
}
