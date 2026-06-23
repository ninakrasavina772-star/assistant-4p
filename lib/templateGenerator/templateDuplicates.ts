import type ExcelJS from "exceljs";
import { expandEanDigitsForIndex } from "@/lib/product";
import type { TemplateRowContext, TemplateSheetScan } from "@/lib/templateGenerator/types";

export type TemplateDuplicateGroup = {
  key: string;
  rowNumbers: number[];
  skus: string[];
  reason: string;
};

export function findEanHeader(scan: TemplateSheetScan): string | null {
  for (const c of scan.columns) {
    const h = c.header.toLowerCase();
    if (/штрих|barcode|ean|gtin/i.test(h)) return c.header;
  }
  return null;
}

/** Группы строк шаблона с одинаковым EAN (как в «Сравнение витрин») */
export function findTemplateDuplicateGroups(
  contexts: TemplateRowContext[],
  eanHeader: string | null
): TemplateDuplicateGroup[] {
  if (!eanHeader) return [];

  type Ref = { row: number; sku: string };
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

  const groups: TemplateDuplicateGroup[] = [];
  const seenRowSets = new Set<string>();

  for (const [eanKey, refs] of keyToRefs) {
    const byRow = new Map<number, string>();
    for (const r of refs) byRow.set(r.row, r.sku);
    if (byRow.size < 2) continue;
    const rowNumbers = [...byRow.keys()].sort((a, b) => a - b);
    const rowKey = rowNumbers.join(",");
    if (seenRowSets.has(rowKey)) continue;
    seenRowSets.add(rowKey);
    groups.push({
      key: eanKey,
      rowNumbers,
      skus: rowNumbers.map((n) => byRow.get(n)!),
      reason: `Дубль по EAN ${eanKey}`
    });
  }

  return groups.sort((a, b) => b.rowNumbers.length - a.rowNumbers.length);
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
