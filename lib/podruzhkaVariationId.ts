import type ExcelJS from "exceljs";
import type { PodruzhkaColumnMapping } from "@/lib/podruzhkaColumnMapping";
import { cellPlainValue } from "@/lib/ozonImageExcel";

/** tpv_222102726 → 222102726 */
export function parseVariationId(raw: string): number | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const m = s.match(/^(?:tpv_)?(\d{5,})$/i);
  if (m) return Number(m[1]);
  const digits = s.replace(/\D/g, "");
  if (digits.length >= 5) return Number(digits);
  return null;
}

/** ID вариации: колонка id в маппинге или колонка A (tpv_…). */
export function readVariationId(
  ws: ExcelJS.Worksheet,
  row: number,
  mapping: PodruzhkaColumnMapping
): number | null {
  const col = mapping.id && mapping.id > 0 ? mapping.id : 1;
  const raw = cellPlainValue(ws.getCell(row, col).value);
  return parseVariationId(raw);
}

/** Если id не сопоставлен — колонка A с tpv_… в первых строках данных. */
export function ensureVariationIdMapping(
  ws: ExcelJS.Worksheet,
  headerRow: number,
  mapping: PodruzhkaColumnMapping
): PodruzhkaColumnMapping {
  if (mapping.id && mapping.id > 0) return mapping;
  const last = Math.min(ws.rowCount || headerRow + 1, headerRow + 12);
  for (let r = headerRow + 1; r <= last; r++) {
    if (parseVariationId(cellPlainValue(ws.getCell(r, 1).value))) {
      return { ...mapping, id: 1 };
    }
  }
  return mapping;
}
