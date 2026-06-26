import type ExcelJS from "exceljs";
import { cellPlainValue } from "@/lib/ozonImageExcel";
import type { LetualGalleryPhoto } from "@/lib/letualPickTypes";
import {
  ensurePhotoReviewColumn,
  formatImageCellValue,
  formatPhotoReviewValue,
  parseImageUrls
} from "@/lib/templateGenerator/photos";
import { DEFAULT_PHOTO_REVIEW_COLUMN, normHeader } from "@/lib/templateGenerator/presets";
import { normVariationSku } from "@/lib/templateGenerator/parseVariationIds";
import type { TemplateRowContext, TemplateSheetScan } from "@/lib/templateGenerator/types";

export type PhotoReviewCandidate = {
  url: string;
  selected: boolean;
  variationId: number;
  matchType: LetualGalleryPhoto["matchType"];
  /** URL после обработки Летуаль (1000×1000) */
  processedUrl?: string;
};

export type PhotoReviewItem = {
  row: number;
  sku: string;
  variationId: number;
  productName: string;
  brandName: string;
  ean: string | null;
  mainUrl: string | null;
  candidates: PhotoReviewCandidate[];
};

const MATCH_LABEL: Record<LetualGalleryPhoto["matchType"], string> = {
  own: "эта вариация",
  same_ean: "тот же EAN",
  same_product: "та же карточка"
};

export function photoMatchLabel(matchType: LetualGalleryPhoto["matchType"]): string {
  return MATCH_LABEL[matchType];
}

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

function pickBrand(cells: Record<string, string>): string {
  return (cells["Бренд *"] ?? cells["Бренд"] ?? "").trim();
}

function selectedUrlsFromWorkbook(
  gallery: string[],
  reviewUrls: string[]
): Set<string> {
  const selected = new Set<string>();
  if (reviewUrls.length) {
    for (const u of reviewUrls) selected.add(u);
    return selected;
  }
  for (const u of gallery.slice(1)) selected.add(u);
  return selected;
}

/** Собрать карточки для UI из Metabase-галерей + текущего шаблона. */
export function buildPhotoReviewItems(
  contexts: TemplateRowContext[],
  galleries: Record<number, LetualGalleryPhoto[]>,
  ws: ExcelJS.Worksheet,
  scan: TemplateSheetScan,
  imageHeader: string
): PhotoReviewItem[] {
  const imageCol = findCol(scan, imageHeader) ?? scan.imageCol;
  const reviewCol = findCol(scan, DEFAULT_PHOTO_REVIEW_COLUMN);
  const out: PhotoReviewItem[] = [];

  for (const ctx of contexts) {
    const variationId = normVariationSku(ctx.sku);
    if (!variationId) continue;

    const galleryPhotos = galleries[variationId] ?? [];
    if (!galleryPhotos.length) continue;

    const imageText = imageCol
      ? cellPlainValue(ws.getCell(ctx.row, imageCol).value).trim()
      : "";
    const gallery = parseImageUrls(imageText);
    const reviewText = reviewCol
      ? cellPlainValue(ws.getCell(ctx.row, reviewCol).value).trim()
      : "";
    const reviewUrls = parseImageUrls(reviewText.replace(/\n/g, " "));

    const selectedSet = selectedUrlsFromWorkbook(gallery, reviewUrls);
    const mainUrl = gallery[0] ?? galleryPhotos.find((p) => p.matchType === "own")?.url ?? null;

    const candidates: PhotoReviewCandidate[] = galleryPhotos
      .filter((p) => p.url !== mainUrl)
      .map((p) => ({
        url: p.url,
        variationId: p.variationId,
        matchType: p.matchType,
        selected: selectedSet.size ? selectedSet.has(p.url) : p.matchType === "own"
      }));

    if (!mainUrl && !candidates.length) continue;

    out.push({
      row: ctx.row,
      sku: ctx.sku,
      variationId,
      productName: pickProductName(ctx.cells),
      brandName: pickBrand(ctx.cells),
      ean: null,
      mainUrl,
      candidates
    });
  }

  return out;
}

/** Fallback: только из ячеек Excel (без Metabase). */
export function loadPhotoReviewFromWorkbook(
  ws: ExcelJS.Worksheet,
  scan: TemplateSheetScan,
  opts: { imageHeader: string; reviewHeader?: string; rows?: number[] }
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
    const variationId = normVariationSku(sku);
    if (!variationId) continue;

    const imageText = imageCol ? cellPlainValue(ws.getCell(row, imageCol).value).trim() : "";
    const gallery = parseImageUrls(imageText);
    const reviewUrls = parseImageUrls(
      (reviewCol ? cellPlainValue(ws.getCell(row, reviewCol).value) : "").replace(/\n/g, " ")
    );

    const mainUrl = gallery[0] ?? null;
    const extraUrls = reviewUrls.length ? reviewUrls : gallery.slice(1);
    if (!mainUrl && !extraUrls.length) continue;

    const cells: Record<string, string> = {};
    for (const c of scan.columns) {
      const v = cellPlainValue(ws.getCell(row, c.col).value).trim();
      if (v) cells[c.header] = v;
    }

    out.push({
      row,
      sku,
      variationId,
      productName: pickProductName(cells),
      brandName: pickBrand(cells),
      ean: null,
      mainUrl,
      candidates: extraUrls.map((url) => ({
        url,
        variationId,
        matchType: "own" as const,
        selected: true
      }))
    });
  }

  return out;
}

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
    const selected = item.candidates
      .filter((c) => c.selected)
      .map((c) => c.processedUrl || c.url);
    const gallery = item.mainUrl
      ? [item.mainUrl, ...selected.filter((u) => u && u !== item.mainUrl)]
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
