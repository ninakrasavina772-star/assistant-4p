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
import {
  DEFAULT_PHOTO_REVIEW_COLUMN,
  normHeader,
  pickProductNameFromCells
} from "@/lib/templateGenerator/presets";
import { isYandexTitleHeader, padYandexTitle, yandexTitleNeedsFix } from "@/lib/templateGenerator/yandexRules";
import { buildYandexTitleFromRow } from "@/lib/templateGenerator/yandexTitleBuilder";
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
        const badTitle =
          existing && isYandexTitleHeader(header) && yandexTitleNeedsFix(existing);
        if (existing && !isPlaceholderCellValue(existing) && !badTitle) continue;
      }
      ws.getCell(res.row, col).value = value;
      filled++;
    }
    if (!photoCol) {
      photoCol = findPhotoReviewCol(scan, photoReviewHeader);
    }
    if (res.extraPhotos.length) {
      if (!photoCol) {
        photoCol = ensurePhotoReviewColumn(ws, scan.headerRow, photoReviewHeader);
      }
      ws.getCell(res.row, photoCol).value = formatPhotoReviewValue(
        uniqueUrlsForImageCell(res.extraPhotos)
      );
    } else if (overwriteFilled && photoCol && res.imageUrls?.length) {
      ws.getCell(res.row, photoCol).value = "";
    }
    if (res.imageUrls?.length && imageCol) {
      ws.getCell(res.row, imageCol).value = formatImageCellValue(res.imageUrls);
    }
  }
  return filled;
}

/** Локально: русские названия ЯМ без ожидания AI (английский тип в колонке «Название товара») */
export function applyYandexTitleFixes(
  ws: ExcelJS.Worksheet,
  scan: TemplateSheetScan,
  contexts: TemplateRowContext[]
): number {
  const titleCol = scan.columns.find((c) => isYandexTitleHeader(c.header))?.col;
  if (!titleCol) return 0;

  let filled = 0;
  for (const ctx of contexts) {
    const existing = cellPlainValue(ws.getCell(ctx.row, titleCol).value).trim();
    if (existing) {
      const cleaned = padYandexTitle(existing);
      if (cleaned && cleaned !== existing && !yandexTitleNeedsFix(cleaned)) {
        ws.getCell(ctx.row, titleCol).value = cleaned;
        filled++;
        continue;
      }
      if (!yandexTitleNeedsFix(existing)) continue;
    }

    const productName = pickProductNameFromCells(ctx.cells);
    if (!productName.trim()) continue;

    const brand = ctx.cells["Бренд *"] ?? ctx.cells["Бренд"] ?? "";
    const built = buildYandexTitleFromRow({
      productName,
      brand,
      typeRu: ctx.cells["Тип"] ?? ctx.cells["тип"],
      family: ctx.cells["Семейство"] ?? ctx.cells["семейство"],
      pol: ctx.cells["Пол"] ?? ctx.cells["пол"]
    });
    if (!built.trim() || yandexTitleNeedsFix(built)) continue;

    ws.getCell(ctx.row, titleCol).value = padYandexTitle(built);
    filled++;
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
