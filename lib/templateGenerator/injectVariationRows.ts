import type ExcelJS from "exceljs";
import { cellPlainValue } from "@/lib/ozonImageExcel";
import { collectRowContexts } from "@/lib/templateGenerator/scan";
import type { MetabaseProductRow } from "@/lib/templateGenerator/metabaseProduct";
import { sortImagesForComposite } from "@/lib/templateGenerator/metabaseProduct";
import { formatImageCellValue } from "@/lib/templateGenerator/photos";
import { normVariationSku } from "@/lib/templateGenerator/parseVariationIds";
import type { TemplateSheetScan } from "@/lib/templateGenerator/types";

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

/** Записать variation_id в шаблон и вернуть контексты строк для заполнения */
export function injectVariationProducts(
  ws: ExcelJS.Worksheet,
  scan: TemplateSheetScan,
  products: MetabaseProductRow[]
): { row: number; sku: string; cells: Record<string, string> }[] {
  if (!products.length) return [];

  const skuCol = scan.skuCol ?? 1;
  const nameHeader =
    findHeader(scan, [/название товара/i]) ??
    findHeader(scan, [/name/i]);
  const brandHeader = findHeader(scan, [/бренд/i, /brand/i]);
  const nameCol = colForHeader(scan, nameHeader);
  const brandCol = colForHeader(scan, brandHeader);
  const imageCol = scan.imageCol;

  const existing = collectRowContexts(ws, scan);
  const byId = new Map<number, { row: number; sku: string; cells: Record<string, string> }>();
  for (const ctx of existing) {
    const id = normVariationSku(ctx.sku);
    if (id) byId.set(id, ctx);
  }

  const emptyRows = findEmptyRows(ws, scan, products.length);
  let emptyIdx = 0;
  let appendRow = lastDataRow(ws, scan) + 1;

  for (const p of products) {
    const sku = String(p.variationId);
    const images = sortImagesForComposite(p.imageUrls);
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
    setCell(ws, row, nameCol, p.productName);
    setCell(ws, row, brandCol, p.brandName);
    if (imageText && imageCol) setCell(ws, row, imageCol, imageText);
  }

  const idSet = new Set(products.map((p) => p.variationId));
  return collectRowContexts(ws, scan).filter((ctx) => {
    const id = normVariationSku(ctx.sku);
    return id != null && idSet.has(id);
  });
}
