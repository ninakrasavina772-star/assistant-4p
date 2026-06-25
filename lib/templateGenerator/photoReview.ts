import type ExcelJS from "exceljs";
import { cellPlainValue } from "@/lib/ozonImageExcel";
import {
  ensurePhotoReviewColumn,
  formatImageCellValue,
  formatPhotoReviewValue,
  parseImageUrls
} from "@/lib/templateGenerator/photos";
import { DEFAULT_PHOTO_REVIEW_COLUMN, normHeader } from "@/lib/templateGenerator/presets";
import type { TemplateSheetScan } from "@/lib/templateGenerator/types";

export type PhotoReviewExtra = {
  url: string;
  selected: boolean;
};

export type PhotoReviewItem = {
  row: number;
  sku: string;
  productName: string;
  mainUrl: string | null;
  extras: PhotoReviewExtra[];
};

function findCol(scan: TemplateSheetScan, header: string): number | null {
  const want = normHeader(header);
  for (const c of scan.columns) {
    if (normHeader(c.header) === want) return c.col;
  }
  return null;
}

function pickProductName(cells: Record<string, string>): string {
  return (
    cells["Название товара *"] ??
    cells["Название товара"] ??
    cells["name"] ??
    ""
  ).trim();
}

function reviewTextFromCell(ws: ExcelJS.Worksheet, row: number, col: number | null): string {
  if (!col) return "";
  return cellPlainValue(ws.getCell(row, col).value).trim();
}

/** Собрать строки с доп. фото из текущего workbook (после этапа фото). */
export function loadPhotoReviewFromWorkbook(
  ws: ExcelJS.Worksheet,
  scan: TemplateSheetScan,
  opts: {
    imageHeader: string;
    reviewHeader?: string;
    rows?: number[];
  }
): PhotoReviewItem[] {
  const imageCol = findCol(scan, opts.imageHeader) ?? scan.imageCol;
  const reviewHeader = opts.reviewHeader ?? DEFAULT_PHOTO_REVIEW_COLUMN;
  const reviewCol = findCol(scan, reviewHeader);
  const rowSet = opts.rows?.length ? new Set(opts.rows) : null;
  const out: PhotoReviewItem[] = [];

  for (let row = scan.dataStartRow; row <= ws.rowCount; row++) {
    if (rowSet && !rowSet.has(row)) continue;
    const sku = scan.skuCol
      ? cellPlainValue(ws.getCell(row, scan.skuCol).value).trim()
      : "";
    if (!sku) continue;

    const imageText = imageCol ? cellPlainValue(ws.getCell(row, imageCol).value).trim() : "";
    const gallery = parseImageUrls(imageText);
    const reviewUrls = parseImageUrls(reviewTextFromCell(ws, row, reviewCol).replace(/\n/g, " "));

    let mainUrl = gallery[0] ?? null;
    let extraUrls: string[] = [];

    if (reviewUrls.length) {
      extraUrls = reviewUrls;
    } else if (gallery.length > 1) {
      extraUrls = gallery.slice(1);
    }

    if (!mainUrl && !extraUrls.length) continue;

    const cells: Record<string, string> = {};
    for (const c of scan.columns) {
      const v = cellPlainValue(ws.getCell(row, c.col).value).trim();
      if (v) cells[c.header] = v;
    }

    out.push({
      row,
      sku,
      productName: pickProductName(cells),
      mainUrl,
      extras: extraUrls.map((url) => ({ url, selected: true }))
    });
  }

  return out;
}

/** Применить отмеченные галочками доп. фото обратно в шаблон. */
export function applyPhotoReviewToWorkbook(
  ws: ExcelJS.Worksheet,
  scan: TemplateSheetScan,
  items: PhotoReviewItem[],
  opts: { imageHeader: string; reviewHeader?: string }
): number {
  const imageCol = findCol(scan, opts.imageHeader) ?? scan.imageCol;
  if (!imageCol) return 0;
  const reviewHeader = opts.reviewHeader ?? DEFAULT_PHOTO_REVIEW_COLUMN;
  let reviewCol = findCol(scan, reviewHeader);
  if (!reviewCol) {
    reviewCol = ensurePhotoReviewColumn(ws, scan.headerRow, reviewHeader);
  }

  let n = 0;
  for (const item of items) {
    const selected = item.extras.filter((e) => e.selected).map((e) => e.url);
    const gallery = item.mainUrl
      ? [item.mainUrl, ...selected.filter((u) => u !== item.mainUrl)]
      : selected;
    const unique = [...new Set(gallery.filter(Boolean))];
    if (!unique.length) continue;

    ws.getCell(item.row, imageCol).value = formatImageCellValue(unique);
    ws.getCell(item.row, reviewCol).value = selected.length
      ? formatPhotoReviewValue(selected)
      : "";
    n++;
  }
  return n;
}
