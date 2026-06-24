import {
  dedupeAndNormalizeFotoUrls,
  normalize4standHugeWebp
} from "@/lib/podruzhkaFotoPick";
import { type PerfumeImageKind } from "@/lib/podruzhkaFotoAnalyzeCore";
import {
  filterPerfumeFotoCandidates,
  perfumeFotoUrlTechnicalScore
} from "@/lib/podruzhkaFotoQuality";
import { analyzePerfumeFotoUrlServer } from "@/lib/podruzhkaFotoScoreServer";

function scorePerfumeFotoUrl(url: string): number {
  const u = url.toLowerCase();
  let score = perfumeFotoUrlTechnicalScore(url);
  if (/cdn1\.ozone\.ru|ozon\.ru\/s3\/multimedia-1-[0-9a-g]\//i.test(u)) score -= 2000;
  if (/4stand\.com|4partners/i.test(u)) score += 8;
  if (/\.webp(?:\?|$)/.test(u)) score += 10;
  if (/\.(?:jpg|jpeg|png)(?:\?|$)/.test(u)) score += 3;
  if (/\/(?:thumb|small|mini|icon|preview)\//.test(u)) score -= 50;
  if (/thumb|_small|_mini|_icon|preview|lifestyle|model|banner/i.test(u)) score -= 20;
  return score;
}

export type PerfumeFotoPickResult = {
  url: string;
  kind: PerfumeImageKind;
  score: number;
  whiteRatio: number;
};

const KIND_RANK: Record<PerfumeImageKind, number> = {
  single_white: 3,
  duo_white: 2,
  other: 1
};

/** Сколько URL анализировать визуально (все типичные галереи 4Partners ≤ 20). */
const VISUAL_ANALYZE_MAX = 17;

/** Серверный выбор: один флакон на белом → duo (коробка+флакон) → прочее. */
export async function pickBestPerfumeFotoServer(urls: string[]): Promise<{
  url: string;
  ranked: PerfumeFotoPickResult[];
}> {
  const list = filterPerfumeFotoCandidates(urls);
  if (!list.length) return { url: "", ranked: [] };
  if (list.length === 1) return { url: list[0]!, ranked: [] };

  const prelim =
    list.length <= VISUAL_ANALYZE_MAX
      ? [...list].sort((a, b) => scorePerfumeFotoUrl(b) - scorePerfumeFotoUrl(a))
      : [...list]
          .sort((a, b) => scorePerfumeFotoUrl(b) - scorePerfumeFotoUrl(a))
          .slice(0, VISUAL_ANALYZE_MAX);

  const results: PerfumeFotoPickResult[] = await Promise.all(
    prelim.map(async (url) => {
      try {
        const analysis = await analyzePerfumeFotoUrlServer(url);
        return { url, ...analysis };
      } catch {
        return {
          url,
          kind: "other" as const,
          score: scorePerfumeFotoUrl(url),
          whiteRatio: 0
        };
      }
    })
  );

  results.sort((a, b) => {
    const tech = scorePerfumeFotoUrl(b.url) - scorePerfumeFotoUrl(a.url);
    if (Math.abs(tech) > 400) return tech > 0 ? 1 : -1;
    const kd = KIND_RANK[b.kind] - KIND_RANK[a.kind];
    if (kd !== 0) return kd;
    return b.score - a.score;
  });

  return { url: results[0]?.url ?? normalize4standHugeWebp(list[0]!), ranked: results };
}
