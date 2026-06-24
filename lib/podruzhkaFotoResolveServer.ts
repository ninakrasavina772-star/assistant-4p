import { fetchLetualVariations } from "@/lib/letualMetabase";
import { metabaseProductIsConfigured } from "@/lib/templateGenerator/metabaseProduct";
import { normalize4standHugeWebp } from "@/lib/podruzhkaFotoPick";
import { pickBestPerfumeFotoServer } from "@/lib/podruzhkaFotoPickServer";
import {
  filterPerfumeFotoCandidates,
  isGoodPerfumePackshotUrl,
  isLikelyBadPerfumeFotoUrl
} from "@/lib/podruzhkaFotoQuality";

export type PerfumeFotoResolveSource =
  | "csv_gallery"
  | "metabase"
  | "template"
  | "pick"
  | "none";

export type PerfumeFotoResolveResult = {
  url: string;
  source: PerfumeFotoResolveSource;
  metabaseUsed: boolean;
  candidateCount: number;
};

function detectSource(
  url: string,
  ctx: {
    metabaseUrls: string[];
    csvUrls: string[];
    templateFoto: string;
  }
): PerfumeFotoResolveSource {
  const norm = normalize4standHugeWebp(url);
  if (ctx.metabaseUrls.some((u) => normalize4standHugeWebp(u) === norm)) return "metabase";
  if (ctx.csvUrls.some((u) => normalize4standHugeWebp(u) === norm)) return "csv_gallery";
  if (ctx.templateFoto && normalize4standHugeWebp(ctx.templateFoto) === norm) return "template";
  return "pick";
}

/**
 * Выбор лучшего packshot для парфюма: CSV/шаблон → Metabase при плохом foto.
 */
export async function resolvePerfumeFotoServer(input: {
  variationId?: number | null;
  templateFoto?: string;
  csvUrls?: string[];
}): Promise<PerfumeFotoResolveResult> {
  const csvUrls = (input.csvUrls ?? []).map((u) => u.trim()).filter(Boolean);
  const templateFoto = (input.templateFoto ?? "").trim();
  const variationId = input.variationId && input.variationId > 0 ? input.variationId : null;

  let metabaseUrls: string[] = [];
  let metabaseUsed = false;

  let pool = filterPerfumeFotoCandidates([...csvUrls, templateFoto].filter(Boolean));
  const poolHasHuge = pool.some(isGoodPerfumePackshotUrl);
  const poolAllBad = !pool.length || pool.every(isLikelyBadPerfumeFotoUrl);

  const needMetabase =
    metabaseProductIsConfigured() &&
    variationId &&
    (poolAllBad || !poolHasHuge);

  if (needMetabase) {
    try {
      const rows = await fetchLetualVariations([variationId]);
      metabaseUrls = rows[0]?.imageUrls ?? [];
      if (metabaseUrls.length) {
        metabaseUsed = true;
        pool = filterPerfumeFotoCandidates([...metabaseUrls, ...csvUrls]);
      }
    } catch (e) {
      console.warn("podruzhka metabase foto:", e);
    }
  }

  if (!pool.length) {
    return { url: "", source: "none", metabaseUsed, candidateCount: 0 };
  }

  let url = pool.length === 1 ? pool[0]! : (await pickBestPerfumeFotoServer(pool)).url;
  if (isLikelyBadPerfumeFotoUrl(url)) {
    const alt = pool.find(isGoodPerfumePackshotUrl);
    if (alt) url = alt;
  }

  return {
    url,
    source: detectSource(url, { metabaseUrls, csvUrls, templateFoto }),
    metabaseUsed,
    candidateCount: pool.length
  };
}
