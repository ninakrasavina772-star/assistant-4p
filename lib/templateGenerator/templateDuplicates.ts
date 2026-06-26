import type ExcelJS from "exceljs";
import { expandEanDigitsForIndex } from "@/lib/product";
import { normSku } from "@/lib/templateGenerator/csvIndex";
import { parseImageUrls } from "@/lib/templateGenerator/photos";
import { isImageHeader } from "@/lib/templateGenerator/presets";
import { normVariationSku } from "@/lib/templateGenerator/parseVariationIds";
import type { TemplateRowContext, TemplateSheetScan } from "@/lib/templateGenerator/types";

export type TemplateDuplicateItem = {
  row: number;
  sku: string;
  productName: string;
  brand: string;
  ean: string | null;
  imageUrl: string | null;
};

export type TemplateDuplicateGroup = {
  key: string;
  rowNumbers: number[];
  skus: string[];
  reason: string;
  items: TemplateDuplicateItem[];
};

export function findEanHeader(scan: TemplateSheetScan): string | null {
  for (const c of scan.columns) {
    const h = c.header.toLowerCase();
    if (/штрих|barcode|ean|gtin/i.test(h)) return c.header;
  }
  return null;
}

function pickCell(cells: Record<string, string>, patterns: RegExp[]): string {
  for (const [header, raw] of Object.entries(cells)) {
    const h = header.toLowerCase();
    if (patterns.some((p) => p.test(h)) && raw.trim()) return raw.trim();
  }
  return "";
}

function buildDuplicateItem(
  row: number,
  sku: string,
  ctx: TemplateRowContext | undefined,
  eanHeader: string | null,
  imageHeader: string | null
): TemplateDuplicateItem {
  const cells = ctx?.cells ?? {};
  const eanRaw = eanHeader ? String(cells[eanHeader] ?? "").trim() : "";
  const imageText = imageHeader ? cells[imageHeader] ?? "" : pickCell(cells, [/ссылка на изображение/i]);
  return {
    row,
    sku,
    productName:
      pickCell(cells, [/название товара/i, /^наименование/i, /^name$/i]) || "—",
    brand: pickCell(cells, [/^бренд/i, /^brand$/i]) || "",
    ean: eanRaw || null,
    imageUrl: parseImageUrls(imageText)[0] ?? null
  };
}

function imageHeaderFromScan(scan: TemplateSheetScan | null | undefined): string | null {
  if (!scan) return null;
  const hit = scan.columns.find((c) => isImageHeader(c.header));
  return hit?.header ?? null;
}

export function enrichTemplateDuplicateGroups(
  groups: Omit<TemplateDuplicateGroup, "items">[],
  contexts: TemplateRowContext[],
  scan: TemplateSheetScan | null
): TemplateDuplicateGroup[] {
  const byRow = new Map(contexts.map((c) => [c.row, c]));
  const eanHeader = scan ? findEanHeader(scan) : null;
  const imageHeader = imageHeaderFromScan(scan);

  return groups.map((g) => ({
    ...g,
    items: g.rowNumbers.map((row, idx) =>
      buildDuplicateItem(row, g.skus[idx] ?? byRow.get(row)?.sku ?? "", byRow.get(row), eanHeader, imageHeader)
    )
  }));
}

function skuIndexKey(raw: string): string | null {
  const variation = normVariationSku(raw);
  if (variation != null) return `v:${variation}`;
  const norm = normSku(raw);
  return norm ? `s:${norm}` : null;
}

function normalizeProductName(name: string, brand: string): string {
  return `${brand} ${name}`
    .toLowerCase()
    .replace(/\b\d+\s*(?:мл|ml|g|г)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function nameIndexKey(raw: string, brand: string): string | null {
  const norm = normalizeProductName(raw, brand);
  if (norm.length < 12) return null;
  return `n:${norm}`;
}

/** Группы строк шаблона с одинаковым EAN, SKU или названием */
export function findTemplateDuplicateGroups(
  contexts: TemplateRowContext[],
  eanHeader: string | null,
  scan?: TemplateSheetScan | null
): TemplateDuplicateGroup[] {
  type Ref = { row: number; sku: string };
  const bareGroups: Omit<TemplateDuplicateGroup, "items">[] = [];
  const seenRowSets = new Set<string>();

  const pushGroup = (key: string, refs: Ref[], reason: string) => {
    const byRow = new Map<number, string>();
    for (const r of refs) byRow.set(r.row, r.sku);
    if (byRow.size < 2) return;
    const rowNumbers = [...byRow.keys()].sort((a, b) => a - b);
    const rowKey = rowNumbers.join(",");
    if (seenRowSets.has(rowKey)) return;
    seenRowSets.add(rowKey);
    bareGroups.push({
      key,
      rowNumbers,
      skus: rowNumbers.map((n) => byRow.get(n)!),
      reason
    });
  };

  if (eanHeader) {
    const keyToRefs = new Map<string, Ref[]>();
    for (const ctx of contexts) {
      const sku = ctx.sku.trim();
      const digits = String(ctx.cells[eanHeader] ?? "").replace(/\D/g, "");
      const keys = expandEanDigitsForIndex(digits);
      if (!sku || keys.length === 0) continue;
      for (const key of keys) {
        if (!keyToRefs.has(key)) keyToRefs.set(key, []);
        keyToRefs.get(key)!.push({ row: ctx.row, sku });
      }
    }
    for (const [eanKey, refs] of keyToRefs) {
      pushGroup(eanKey, refs, `Дубль по EAN ${eanKey}`);
    }
  }

  const skuToRefs = new Map<string, Ref[]>();
  for (const ctx of contexts) {
    const sku = ctx.sku.trim();
    const key = skuIndexKey(sku);
    if (!key) continue;
    if (!skuToRefs.has(key)) skuToRefs.set(key, []);
    skuToRefs.get(key)!.push({ row: ctx.row, sku });
  }
  for (const [skuKey, refs] of skuToRefs) {
    const label = skuKey.startsWith("v:") ? skuKey.slice(2) : skuKey.slice(2);
    pushGroup(
      skuKey,
      refs,
      skuKey.startsWith("v:")
        ? `Дубль: один variation_id (${label}) в нескольких строках`
        : `Дубль: один артикул (${label}) в нескольких строках`
    );
  }

  const nameToRefs = new Map<string, Ref[]>();
  for (const ctx of contexts) {
    const sku = ctx.sku.trim();
    const brand = pickCell(ctx.cells, [/^бренд/i, /^brand$/i]);
    const name = pickCell(ctx.cells, [/название товара/i, /^наименование/i, /^name$/i]);
    const key = nameIndexKey(name, brand);
    if (!key || !sku) continue;
    if (!nameToRefs.has(key)) nameToRefs.set(key, []);
    nameToRefs.get(key)!.push({ row: ctx.row, sku });
  }
  for (const [nameKey, refs] of nameToRefs) {
    pushGroup(nameKey, refs, "Дубль: одинаковое название товара в нескольких строках");
  }

  return enrichTemplateDuplicateGroups(
    bareGroups.sort((a, b) => b.rowNumbers.length - a.rowNumbers.length),
    contexts,
    scan ?? null
  );
}

/** Удалить строки из листа (снизу вверх, чтобы не сбивать индексы) */
export function deleteWorksheetRows(
  wb: ExcelJS.Workbook,
  scan: TemplateSheetScan,
  rowNumbers: number[]
): number {
  const ws = wb.getWorksheet(scan.sheetName);
  if (!ws || rowNumbers.length === 0) return 0;
  const sorted = [...new Set(rowNumbers)].sort((a, b) => b - a);
  for (const r of sorted) {
    if (r >= scan.dataStartRow) ws.spliceRows(r, 1);
  }
  return sorted.length;
}
