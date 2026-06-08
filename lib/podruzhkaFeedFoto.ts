import type ExcelJS from "exceljs";
import type { PodruzhkaRenderProfile } from "@/lib/podruzhkaCosmeticsLayout";
import { cellAsUrlFromCell, cellPlainValue } from "@/lib/ozonImageExcel";
import {
  parseFotoUrlsFromText,
  pickBestFotoUrl,
  pickBestPerfumeFotoAsync,
  dedupeAndNormalizeFotoUrls,
  normalize4standHugeWebp
} from "@/lib/podruzhkaFotoPick";

export type FeedFotoMapping = {
  foto?: number;
  fotoImages?: number;
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
  if (mode === "file") {
    return resolveFeedFotoUrlFromFile(ws, row, mapping);
  }
  const candidates = getFeedFotoCandidates(ws, row, mapping, "auto");
  if (!candidates.length) return "";
  if (profile === "perfume" && candidates.length > 1) {
    return pickBestPerfumeFotoAsync(candidates);
  }
  if (candidates.length === 1) return normalize4standHugeWebp(candidates[0]!);
  return pickBestFotoUrl(candidates, profile);
}
