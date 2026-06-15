import { cellPlainValue } from "@/lib/ozonImageExcel";
import type ExcelJS from "exceljs";
import { DEFAULT_PHOTO_REVIEW_COLUMN } from "@/lib/templateGenerator/presets";

const URL_SPLIT = /[\s,;|]+/;

export function parseImageUrls(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of text.split(URL_SPLIT)) {
    const u = part.trim().replace(/^["']|["']$/g, "");
    if (!/^https?:\/\//i.test(u)) continue;
    const key = u.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(u);
  }
  return out;
}

export function countRowPhotos(cells: Record<string, string>, imageHeader: string | null): number {
  if (!imageHeader) return 0;
  return parseImageUrls(cells[imageHeader] ?? "").length;
}

export function ensurePhotoReviewColumn(
  ws: ExcelJS.Worksheet,
  headerRow: number,
  headerName: string
): number {
  const maxCol = ws.columnCount || 60;
  for (let c = 1; c <= maxCol; c++) {
    if (cellPlainValue(ws.getCell(headerRow, c).value) === headerName) return c;
  }
  let last = 1;
  for (let c = 1; c <= maxCol + 5; c++) {
    const v = cellPlainValue(ws.getCell(headerRow, c).value);
    if (v) last = c;
  }
  const col = last + 1;
  ws.getCell(headerRow, col).value = headerName;
  ws.getColumn(col).width = 70;
  return col;
}

export function formatPhotoReviewValue(urls: string[]): string {
  return urls.filter(Boolean).join("\n");
}

export { DEFAULT_PHOTO_REVIEW_COLUMN };
