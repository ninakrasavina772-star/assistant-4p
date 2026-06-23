import { cellPlainValue } from "@/lib/ozonImageExcel";
import type ExcelJS from "exceljs";
import { DEFAULT_PHOTO_REVIEW_COLUMN } from "@/lib/templateGenerator/presets";

const URL_SPLIT = /[\s,;|]+/;

const FAKE_HOST_RE =
  /example\.com|placeholder\.com|dummyimage\.com|via\.placeholder|placehold\.co|picsum\.photos/i;

/** Нормализует URL картинки для Ozon (https, без фейковых доменов) */
export function normalizeImageUrl(raw: string): string | null {
  let u = raw.trim().replace(/^["']|["']$/g, "");
  if (!u) return null;
  if (u.startsWith("//")) u = `https:${u}`;
  if (!/^https?:\/\//i.test(u)) return null;
  try {
    const host = new URL(u).hostname;
    if (FAKE_HOST_RE.test(host)) return null;
  } catch {
    return null;
  }
  return u;
}

export function parseImageUrls(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of text.split(URL_SPLIT)) {
    const u = normalizeImageUrl(part);
    if (!u) continue;
    const key = u.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(u);
  }
  return out;
}

export function mergeImageUrls(existing: string[], extra: string[]): string[] {
  const seen = new Set(existing.map((u) => u.toLowerCase()));
  const out = [...existing];
  for (const u of extra) {
    const key = u.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(u);
  }
  return out;
}

import { uniqueUrlsForImageCell } from "@/lib/templateGenerator/imageUrlDedupe";

/** Яндекс/Ozon: несколько URL через запятую в одной ячейке */
export function formatImageCellValue(urls: string[]): string {
  return uniqueUrlsForImageCell(urls.filter(Boolean)).join(",");
}

export function countRowPhotos(cells: Record<string, string>, imageHeader: string | null): number {
  if (!imageHeader) return 0;
  return parseImageUrls(cells[imageHeader] ?? "").length;
}

/**
 * Доп. фото для колонки проверки — из ячейки «Ссылка на изображение» (до Letual-обработки).
 * Главное фото остаётся в основной колонке, сюда — остальные уникальные URL.
 */
export function collectReviewPhotosFromImageCell(
  imageText: string,
  opts: { minCount: number; targetCount: number }
): string[] {
  const urls = uniqueUrlsForImageCell(parseImageUrls(imageText));
  if (!urls.length) return [];
  if (urls.length >= opts.minCount) {
    return urls.slice(1, opts.targetCount + 1);
  }
  return urls.slice(1);
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
