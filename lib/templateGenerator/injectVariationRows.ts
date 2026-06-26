import type ExcelJS from "exceljs";
import { cellPlainValue } from "@/lib/ozonImageExcel";
import { collectRowContexts } from "@/lib/templateGenerator/scan";
import type { MetabaseProductRow } from "@/lib/templateGenerator/metabaseProduct";
import { fetchMetabaseProductBySku, sortImagesForComposite } from "@/lib/templateGenerator/metabaseProduct";
import { formatImageCellValue, parseImageUrls } from "@/lib/templateGenerator/photos";
import { rehostImageUrls, type RehostCache } from "@/lib/templateGenerator/rehostImageUrl";
import { filterYandexProductImageUrlsByUrl } from "@/lib/templateGenerator/yandexImageFilter";
import { preferAdminFotoUrls } from "@/lib/templateGenerator/yandexImageSources";
import { findEanHeader } from "@/lib/templateGenerator/templateDuplicates";
import { normVariationSku } from "@/lib/templateGenerator/parseVariationIds";
import type { TemplateSheetScan } from "@/lib/templateGenerator/types";
import { findYandexPriceHeaders } from "@/lib/templateGenerator/applyYandexPrices";

function headerMatch(header: string, patterns: RegExp[]): boolean {
  const h = header.toLowerCase();
  return patterns.some((p) => p.test(h));
}

function findHeader(scan: TemplateSheetScan, patterns: RegExp[]): string | null {
  for (const c of scan.columns) {
    if (headerMatch(c.header, patterns)) return c.header;
  }
  return null;
}

function colForHeader(scan: TemplateSheetScan, header: string | null): number | null {
  if (!header) return null;
  return scan.columns.find((c) => c.header === header)?.col ?? null;
}

function lastDataRow(ws: ExcelJS.Worksheet, scan: TemplateSheetScan): number {
  const skuCol = scan.skuCol ?? 1;
  let last = scan.dataStartRow;
  const hardMax = Math.min(ws.rowCount || scan.dataStartRow + 5000, scan.dataStartRow + 50000);
  let emptyStreak = 0;
  for (let r = scan.dataStartRow; r <= hardMax; r++) {
    const v = cellPlainValue(ws.getCell(r, skuCol).value);
    if (v && v !== "-") {
      last = r;
      emptyStreak = 0;
    } else {
      emptyStreak++;
      if (emptyStreak >= 40) break;
    }
  }
  return last;
}

function findEmptyRows(
  ws: ExcelJS.Worksheet,
  scan: TemplateSheetScan,
  need: number
): number[] {
  const skuCol = scan.skuCol ?? 1;
  const out: number[] = [];
  const last = lastDataRow(ws, scan);
  const hardMax = last + need + 20;
  for (let r = scan.dataStartRow; r <= hardMax && out.length < need; r++) {
    const v = cellPlainValue(ws.getCell(r, skuCol).value);
    if (!v || v === "-") out.push(r);
  }
  return out;
}

function setCell(ws: ExcelJS.Worksheet, row: number, col: number | null, value: string) {
  if (!col || !value.trim()) return;
  ws.getCell(row, col).value = value;
}

function formatPriceCell(price: number): string {
  if (Number.isInteger(price)) return String(price);
  return String(price);
}

/** Записать variation_id в шаблон и вернуть контексты строк для заполнения */

/** Заполнить пустую колонку «Ссылка на изображение» из Metabase (rehost). */
export async function prefillYandexImageCells(
  ws: ExcelJS.Worksheet,
  scan: TemplateSheetScan,
  contexts: { row: number; sku: string }[]
): Promise<number> {
  const imageCol = scan.imageCol;
  if (!imageCol || !contexts.length) return 0;

  const rehostCache: RehostCache = new Map();
  let filled = 0;

  for (const ctx of contexts) {
    const existing = cellPlainValue(ws.getCell(ctx.row, imageCol).value).trim();
    if (existing) continue;

    const variationId = normVariationSku(ctx.sku);
    if (!variationId) continue;

    try {
      const mb = await fetchMetabaseProductBySku(ctx.sku);
      if (!mb?.imageUrls.length) continue;
      let images = preferAdminFotoUrls(sortImagesForComposite(mb.imageUrls));
      images = filterYandexProductImageUrlsByUrl(images);
      images = await rehostImageUrls(images, ctx.sku, rehostCache);
      if (!images.length) continue;
      setCell(ws, ctx.row, imageCol, formatImageCellValue(images));
      filled++;
    } catch {
      /* skip */
    }
  }

  return filled;
}


export async function injectVariationProducts(
  ws: ExcelJS.Worksheet,
  scan: TemplateSheetScan,
  products: MetabaseProductRow[],
  opts?: { skipImages?: boolean }
): Promise<{ row: number; sku: string; cells: Record<string, string> }[]> {
  if (!products.length) return [];
  const skipImages = opts?.skipImages === true;

  const skuCol = scan.skuCol ?? 1;
  const modelHeader = findHeader(scan, [/название модели/i]);
  const titleHeader =
    findHeader(scan, [/название товара/i]) ??
    findHeader(scan, [/name/i]);
  const brandHeader = findHeader(scan, [/бренд/i, /brand/i]);
  const modelCol = colForHeader(scan, modelHeader);
  const titleCol = colForHeader(scan, titleHeader);
  const brandCol = colForHeader(scan, brandHeader);
  const imageCol = scan.imageCol;
  const eanHeader = findEanHeader(scan);
  const eanCol = colForHeader(scan, eanHeader);
  const { priceCol, currencyCol } = findYandexPriceHeaders(scan);

  const existing = collectRowContexts(ws, scan);
  const byId = new Map<number, { row: number; sku: string; cells: Record<string, string> }>();
  for (const ctx of existing) {
    const id = normVariationSku(ctx.sku);
    if (id) byId.set(id, ctx);
  }

  const emptyRows = findEmptyRows(ws, scan, products.length);
  let emptyIdx = 0;
  let appendRow = lastDataRow(ws, scan) + 1;
  const rehostCache: RehostCache = new Map();

  for (const p of products) {
    const sku = String(p.variationId);
    let images = preferAdminFotoUrls(sortImagesForComposite(p.imageUrls));
    if (images.length) {
      images = filterYandexProductImageUrlsByUrl(images);
      images = await rehostImageUrls(images, sku, rehostCache);
    }
    const imageText = images.length ? formatImageCellValue(images) : "";

    let row: number;
    const hit = byId.get(p.variationId);
    if (hit) {
      row = hit.row;
    } else if (emptyIdx < emptyRows.length) {
      row = emptyRows[emptyIdx]!;
      emptyIdx++;
    } else {
      row = appendRow;
      appendRow++;
    }

    setCell(ws, row, skuCol, sku);
    if (modelCol) {
      setCell(ws, row, modelCol, p.productName);
    } else if (titleCol) {
      setCell(ws, row, titleCol, p.productName);
    }
    setCell(ws, row, brandCol, p.brandName);
    if (p.ean) setCell(ws, row, eanCol, p.ean);
    if (!skipImages && imageText && imageCol) setCell(ws, row, imageCol, imageText);

    if (p.priceUsd != null && p.priceUsd > 0 && priceCol) {
      setCell(ws, row, priceCol, formatPriceCell(p.priceUsd));
      if (currencyCol) {
        setCell(ws, row, currencyCol, p.priceCurrency?.trim() || "USD");
      }
    }
  }

  const idSet = new Set(products.map((p) => p.variationId));
  return collectRowContexts(ws, scan).filter((ctx) => {
    const id = normVariationSku(ctx.sku);
    return id != null && idSet.has(id);
  });
}

