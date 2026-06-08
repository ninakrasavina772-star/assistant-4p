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

export function isFeedFotoMapped(m: FeedFotoMapping): boolean {
  return Boolean((m.foto && m.foto > 0) || (m.fotoImages && m.fotoImages > 0));
}

function readFotoCellUrls(ws: ExcelJS.Worksheet, row: number, col: number): string[] {
  const cell = ws.getCell(row, col);
  const text = [cellPlainValue(cell.value), cellAsUrlFromCell(cell)].filter(Boolean).join(" ");
  return parseFotoUrlsFromText(text);
}

/** Все кандидаты из колонок foto / «Изображения варианта». */
export function getFeedFotoCandidates(
  ws: ExcelJS.Worksheet,
  row: number,
  mapping: FeedFotoMapping
): string[] {
  const urls: string[] = [];
  if (mapping.fotoImages && mapping.fotoImages > 0) {
    urls.push(...readFotoCellUrls(ws, row, mapping.fotoImages));
  }
  if (mapping.foto && mapping.foto > 0) {
    urls.push(...readFotoCellUrls(ws, row, mapping.foto));
  }
  return dedupeAndNormalizeFotoUrls(urls);
}

export function resolveFeedFotoUrl(
  ws: ExcelJS.Worksheet,
  row: number,
  mapping: FeedFotoMapping,
  profile: PodruzhkaRenderProfile = "perfume"
): string {
  const candidates = getFeedFotoCandidates(ws, row, mapping);
  if (candidates.length > 1) return pickBestFotoUrl(candidates, profile);
  if (candidates.length === 1) return candidates[0]!;
  return "";
}

/** Перед рендером парфюма — визуальный выбор (duo на белом → один флакон). */
export async function resolveFeedFotoUrlAsync(
  ws: ExcelJS.Worksheet,
  row: number,
  mapping: FeedFotoMapping,
  profile: PodruzhkaRenderProfile = "perfume"
): Promise<string> {
  const candidates = getFeedFotoCandidates(ws, row, mapping);
  if (!candidates.length) return "";
  if (profile === "perfume" && candidates.length > 1) {
    return pickBestPerfumeFotoAsync(candidates);
  }
  if (candidates.length === 1) return normalize4standHugeWebp(candidates[0]!);
  return pickBestFotoUrl(candidates, profile);
}
