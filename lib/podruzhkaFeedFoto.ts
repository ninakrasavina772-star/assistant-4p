import type ExcelJS from "exceljs";
import type { PodruzhkaColumnMapping } from "@/lib/podruzhkaColumnMapping";
import type { PodruzhkaRenderProfile } from "@/lib/podruzhkaCosmeticsLayout";
import { cellAsUrlFromCell, cellPlainValue } from "@/lib/ozonImageExcel";
import {
  filterPerfumeFotoCandidates,
  isGoodPerfumePackshotUrl,
  isLikelyBadPerfumeFotoUrl
} from "@/lib/podruzhkaFotoQuality";
import type { PerfumeFotoResolveSource } from "@/lib/podruzhkaFotoResolveServer";
import {
  parseFotoUrlsFromText,
  pickBestFotoUrl,
  pickBestPerfumeFotoAsync,
  dedupeAndNormalizeFotoUrls,
  normalize4standHugeWebp
} from "@/lib/podruzhkaFotoPick";
import { readVariationId } from "@/lib/podruzhkaVariationId";

export type FeedFotoMapping = {
  foto?: number;
  fotoImages?: number;
  id?: number;
};

export type PerfumeFotoResolveOutcome = {
  url: string;
  source?: PerfumeFotoResolveSource;
  metabaseUsed?: boolean;
};

/** auto — галерея CSV + умный выбор; file — только колонка foto из Excel */
export type FeedFotoResolveMode = "auto" | "file";

export function isFeedFotoMapped(m: FeedFotoMapping): boolean {
  return Boolean((m.foto && m.foto > 0) || (m.fotoImages && m.fotoImages > 0));
}

export function isFeedFotoMappedForMode(
  m: FeedFotoMapping,
  mode: FeedFotoResolveMode = "auto"
): boolean {
  if (mode === "file") return Boolean(m.foto && m.foto > 0);
  return isFeedFotoMapped(m);
}

function readFotoCellUrls(ws: ExcelJS.Worksheet, row: number, col: number): string[] {
  const cell = ws.getCell(row, col);
  const text = [cellPlainValue(cell.value), cellAsUrlFromCell(cell)].filter(Boolean).join(" ");
  return parseFotoUrlsFromText(text);
}

/** Только колонка foto — первая ссылка, без «Изображения варианта» и без pick. */
export function resolveFeedFotoUrlFromFile(
  ws: ExcelJS.Worksheet,
  row: number,
  mapping: FeedFotoMapping
): string {
  if (!mapping.foto || mapping.foto <= 0) return "";
  const urls = dedupeAndNormalizeFotoUrls(readFotoCellUrls(ws, row, mapping.foto));
  return urls[0] ?? "";
}

/** Все кандидаты: приоритет «Изображения варианта», иначе одиночная foto. */
export function getFeedFotoCandidates(
  ws: ExcelJS.Worksheet,
  row: number,
  mapping: FeedFotoMapping,
  mode: FeedFotoResolveMode = "auto"
): string[] {
  if (mode === "file") {
    const one = resolveFeedFotoUrlFromFile(ws, row, mapping);
    return one ? [one] : [];
  }
  if (mapping.fotoImages && mapping.fotoImages > 0) {
    const fromGallery = readFotoCellUrls(ws, row, mapping.fotoImages);
    if (fromGallery.length) return dedupeAndNormalizeFotoUrls(fromGallery);
  }
  if (mapping.foto && mapping.foto > 0) {
    return dedupeAndNormalizeFotoUrls(readFotoCellUrls(ws, row, mapping.foto));
  }
  return [];
}

export function resolveFeedFotoUrl(
  ws: ExcelJS.Worksheet,
  row: number,
  mapping: FeedFotoMapping,
  profile: PodruzhkaRenderProfile = "perfume",
  mode: FeedFotoResolveMode = "auto"
): string {
  if (mode === "file") {
    return resolveFeedFotoUrlFromFile(ws, row, mapping);
  }
  const candidates = getFeedFotoCandidates(ws, row, mapping, "auto");
  if (candidates.length > 1) return pickBestFotoUrl(candidates, profile);
  if (candidates.length === 1) return candidates[0]!;
  return "";
}

/** Перед рендером парфюма — визуальный выбор (duo на белом → один флакон). */
export async function resolveFeedFotoUrlAsync(
  ws: ExcelJS.Worksheet,
  row: number,
  mapping: FeedFotoMapping,
  profile: PodruzhkaRenderProfile = "perfume",
  mode: FeedFotoResolveMode = "auto"
): Promise<string> {
  if (profile === "perfume") {
    const out = await resolvePerfumeFotoForRenderAsync(ws, row, mapping, mode);
    return out.url;
  }
  if (mode === "file") {
    return resolveFeedFotoUrlFromFile(ws, row, mapping);
  }
  const candidates = getFeedFotoCandidates(ws, row, mapping, "auto");
  if (!candidates.length) return "";
  if (candidates.length > 1) {
    return pickBestFotoUrl(candidates, profile);
  }
  return normalize4standHugeWebp(candidates[0]!);
}

async function resolvePerfumeFotoViaApi(input: {
  variationId: number | null;
  templateFoto: string;
  csvUrls: string[];
}): Promise<PerfumeFotoResolveOutcome> {
  try {
    const res = await fetch("/api/podruzhka/foto/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        variationId: input.variationId ?? undefined,
        templateFoto: input.templateFoto || undefined,
        csvUrls: input.csvUrls
      })
    });
    const data = (await res.json()) as PerfumeFotoResolveOutcome & { error?: string };
    if (res.ok && data.url) {
      return {
        url: data.url,
        source: data.source,
        metabaseUsed: data.metabaseUsed
      };
    }
  } catch {
    /* fallback */
  }
  const fallback = filterPerfumeFotoCandidates(
    [...input.csvUrls, input.templateFoto].filter(Boolean)
  );
  if (fallback.length > 1) {
    return { url: await pickBestPerfumeFotoAsync(fallback), source: "pick" };
  }
  return { url: fallback[0] ?? "", source: fallback[0] ? "template" : "none" };
}

/**
 * Парфюм: CSV-галерея → при плохом foto из шаблона Metabase по variation_id (кол. A, tpv_…).
 */
export async function resolvePerfumeFotoForRenderAsync(
  ws: ExcelJS.Worksheet,
  row: number,
  mapping: PodruzhkaColumnMapping,
  mode: FeedFotoResolveMode = "auto"
): Promise<PerfumeFotoResolveOutcome> {
  const variationId = readVariationId(ws, row, mapping);
  const templateFoto = resolveFeedFotoUrlFromFile(ws, row, mapping);
  const csvCandidates = getFeedFotoCandidates(ws, row, mapping, mode);
  const csvUrls =
    mode === "file"
      ? templateFoto
        ? [templateFoto]
        : []
      : filterPerfumeFotoCandidates(csvCandidates);

  if (mode === "file") {
    if (templateFoto && !isLikelyBadPerfumeFotoUrl(templateFoto)) {
      return { url: templateFoto, source: "template" };
    }
    return resolvePerfumeFotoViaApi({ variationId, templateFoto, csvUrls });
  }

  const hasGallery = csvUrls.length > 1;
  const hasGoodHuge = csvUrls.some(isGoodPerfumePackshotUrl);
  const singleGood =
    csvUrls.length === 1 && !isLikelyBadPerfumeFotoUrl(csvUrls[0]!) && hasGoodHuge;

  if (hasGallery) {
    return {
      url: await pickBestPerfumeFotoAsync(csvUrls),
      source: "csv_gallery"
    };
  }

  if (singleGood) {
    return { url: normalize4standHugeWebp(csvUrls[0]!), source: "csv_gallery" };
  }

  const needsFallback =
    !csvUrls.length ||
    csvUrls.every(isLikelyBadPerfumeFotoUrl) ||
    (!hasGoodHuge && Boolean(variationId));

  if (needsFallback) {
    return resolvePerfumeFotoViaApi({ variationId, templateFoto, csvUrls });
  }

  if (csvUrls.length === 1) {
    return { url: normalize4standHugeWebp(csvUrls[0]!), source: "template" };
  }

  return { url: "", source: "none" };
}
