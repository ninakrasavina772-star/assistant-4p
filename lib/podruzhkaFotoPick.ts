import type { PodruzhkaRenderProfile } from "@/lib/podruzhkaCosmeticsLayout";

/** Несколько URL в одной ячейке CSV/Excel (пробел, перевод строки, запятая). */
export function parseFotoUrlsFromText(text: string): string[] {
  const raw = text.trim();
  if (!raw) return [];
  const urls = [...raw.matchAll(/https?:\/\/[^\s,;<>"]+/gi)].map((m) => m[0]!.replace(/[),.;]+$/g, ""));
  return [...new Set(urls.filter(Boolean))];
}

function scorePerfumeFotoUrl(url: string, index: number, total: number): number {
  const u = url.toLowerCase();
  let score = 40;

  if (/\/huge\//.test(u)) score += 35;
  if (/4stand\.com|4partners/i.test(u)) score += 10;
  if (/\.webp(?:\?|$)/.test(u)) score += 8;
  if (/\.(?:jpg|jpeg|png)(?:\?|$)/.test(u)) score += 4;

  if (/\/(?:thumb|small|mini|icon|preview)\//.test(u)) score -= 40;
  if (/thumb|_small|_mini|_icon|preview/i.test(u)) score -= 25;
  if (/lifestyle|model|banner|slide|packshot-only/i.test(u)) score -= 12;

  /** Частый порядок в фиде 4Partners: 1 — мелко/флакон, 2 — флакон+коробка, 3 — lifestyle */
  if (total === 3 && index === 1) score += 12;
  if (total >= 2 && index === 0 && !/\/huge\//.test(u)) score -= 8;

  return score;
}

/** Косметика: стандарт уточним; пока — крупное фото без thumb. */
function scoreCosmeticsFotoUrl(url: string, index: number): number {
  const u = url.toLowerCase();
  let score = 40;
  if (/\/huge\//.test(u)) score += 30;
  if (/4stand\.com|4partners/i.test(u)) score += 8;
  if (/thumb|small|mini|icon|preview/i.test(u)) score -= 35;
  if (index === 0) score += 3;
  return score;
}

export function pickBestFotoUrl(
  urls: string[],
  profile: PodruzhkaRenderProfile = "perfume"
): string {
  const list = urls.map((u) => u.trim()).filter((u) => /^https?:\/\//i.test(u));
  if (!list.length) return "";
  if (list.length === 1) return list[0]!;

  const scoreFn =
    profile === "cosmetics" ? scoreCosmeticsFotoUrl : scorePerfumeFotoUrl;

  let best = list[0]!;
  let bestScore = -Infinity;
  for (let i = 0; i < list.length; i++) {
    const url = list[i]!;
    const score = scoreFn(url, i, list.length);
    if (score > bestScore) {
      bestScore = score;
      best = url;
    }
  }
  return best;
}
