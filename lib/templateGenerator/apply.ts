import type ExcelJS from "exceljs";
import { cellPlainValue } from "@/lib/ozonImageExcel";
import type { ColumnSelection, FillRowResult, TemplateSheetScan, TemplateRowContext } from "@/lib/templateGenerator/types";
import {
  collectReviewPhotosFromImageCell,
  ensurePhotoReviewColumn,
  formatImageCellValue,
  formatPhotoReviewValue
} from "@/lib/templateGenerator/photos";
import { uniqueUrlsForImageCell } from "@/lib/templateGenerator/imageUrlDedupe";
import { DEFAULT_PHOTO_REVIEW_COLUMN, normHeader } from "@/lib/templateGenerator/presets";
import { rehostImageUrls, type RehostCache } from "@/lib/templateGenerator/rehostImageUrl";
import { parseImageUrls } from "@/lib/templateGenerator/photos";

export function applyFillResults(
  ws: ExcelJS.Worksheet,
  scan: TemplateSheetScan,
  selection: ColumnSelection[],
  results: FillRowResult[],
  photoReviewHeader: string = DEFAULT_PHOTO_REVIEW_COLUMN,
  overwriteFilled = false,
  imageCol: number | null = null
): number {
  const colByHeader = new Map(selection.map((s) => [s.header, s.col]));
  let photoCol: number | null = null;
  let filled = 0;

  for (const res of results) {
    const hasValues = Object.keys(res.values).length > 0;
    const hasPhotos =
      (res.extraPhotos?.length ?? 0) > 0 || (res.imageUrls?.length ?? 0) > 0;
    if (!res.ok && !hasValues && !hasPhotos) continue;
    for (const [header, value] of Object.entries(res.values)) {
      const col = colByHeader.get(header);
      if (!col || !value) continue;
      if (!overwriteFilled) {
        const existing = cellPlainValue(ws.getCell(res.row, col).value).trim();
        if (existing) continue;
      }
      ws.getCell(res.row, col).value = value;
      filled++;
    }
    if (res.extraPhotos.length) {
      if (!photoCol) {
        photoCol = ensurePhotoReviewColumn(ws, scan.headerRow, photoReviewHeader);
      }
      ws.getCell(res.row, photoCol).value = formatPhotoReviewValue(
        uniqueUrlsForImageCell(res.extraPhotos)
      );
    }
    if (res.imageUrls?.length && imageCol) {
      ws.getCell(res.row, imageCol).value = formatImageCellValue(res.imageUrls);
    }
  }
  return filled;
}

function findPhotoReviewCol(scan: TemplateSheetScan, header = DEFAULT_PHOTO_REVIEW_COLUMN): number | null {
  const want = normHeader(header);
  for (const c of scan.columns) {
    if (normHeader(c.header) === want) return c.col;
  }
  return null;
}

/**
 * До этапа Letual: rehost приватных URL и заполнить «Доп. фото (проверка)».
 */
export async function prefillPhotoReviewColumn(
  ws: ExcelJS.Worksheet,
  scan: TemplateSheetScan,
  contexts: TemplateRowContext[],
  opts: { minCount: number; targetCount: number },
  imageHeader: string | null,
  reviewHeader = DEFAULT_PHOTO_REVIEW_COLUMN
): Promise<number> {
  if (!imageHeader || !contexts.length) return 0;
  let reviewCol = findPhotoReviewCol(scan, reviewHeader);
  if (!reviewCol) {
    reviewCol = ensurePhotoReviewColumn(ws, scan.headerRow, reviewHeader);
  }
  const rehostCache: RehostCache = new Map();
  let n = 0;
  for (const ctx of contexts) {
    const imageText =
      ctx.cells[imageHeader] ??
      (scan.imageCol ? cellPlainValue(ws.getCell(ctx.row, scan.imageCol).value) : "");
    const parsed = parseImageUrls(imageText);
    if (!parsed.length) continue;

    const rehosted = await rehostImageUrls(parsed, ctx.sku, rehostCache);
    if (scan.imageCol && rehosted.join(",") !== parsed.join(",")) {
      ws.getCell(ctx.row, scan.imageCol).value = formatImageCellValue(rehosted);
    }

    const extras = collectReviewPhotosFromImageCell(formatImageCellValue(rehosted), opts);
    if (!extras.length) continue;
    ws.getCell(ctx.row, reviewCol).value = formatPhotoReviewValue(uniqueUrlsForImageCell(extras));
    n++;
  }
  return n;
}
