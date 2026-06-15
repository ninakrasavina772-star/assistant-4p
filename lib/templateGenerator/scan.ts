import type ExcelJS from "exceljs";
import { cellPlainValue } from "@/lib/ozonImageExcel";
import {
  isContentDefaultColumn,
  isImageHeader,
  isReadonlyColumn,
  isSkuHeader,
  listSheetNameForHeader,
  LIST_VALUES_SHEET,
  normHeader
} from "@/lib/templateGenerator/presets";
import type { TemplateColumnMeta, TemplateSheetScan } from "@/lib/templateGenerator/types";
import { extractListValidationValues } from "@/lib/templateGenerator/validation";

function findHeaderRow(ws: ExcelJS.Worksheet): { headerRow: number; hintRow: number } {
  const maxRow = Math.min(ws.rowCount || 20, 20);
  const maxCol = Math.min(ws.columnCount || 80, 80);

  for (let r = 1; r <= maxRow; r++) {
    for (let c = 1; c <= maxCol; c++) {
      const v = normHeader(cellPlainValue(ws.getCell(r, c).value));
      if (v.includes("ваш sku") || v.includes("название товара")) {
        return { headerRow: r, hintRow: r + 2 };
      }
    }
  }
  return { headerRow: 1, hintRow: 2 };
}

function readRowHeaders(ws: ExcelJS.Worksheet, row: number, maxCol: number): Map<number, string> {
  const out = new Map<number, string>();
  for (let c = 1; c <= maxCol; c++) {
    const h = cellPlainValue(ws.getCell(row, c).value).replace(/\n/g, " ").trim();
    if (h) out.set(c, h);
  }
  return out;
}

function detectDataStartRow(
  ws: ExcelJS.Worksheet,
  hintRow: number,
  skuCol: number | null
): number {
  const col = skuCol ?? 1;
  const last = ws.rowCount || hintRow + 1;
  for (let r = hintRow + 1; r <= last; r++) {
    const v = cellPlainValue(ws.getCell(r, col).value);
    if (!v || v === "-") continue;
    if (/^значение поля/i.test(v)) continue;
    if (v.length > 0 && v.length < 120) return r;
  }
  return hintRow + 2;
}

function countDataRows(ws: ExcelJS.Worksheet, dataStart: number, skuCol: number | null): number {
  const col = skuCol ?? 1;
  let n = 0;
  const last = ws.rowCount || dataStart;
  for (let r = dataStart; r <= last; r++) {
    const v = cellPlainValue(ws.getCell(r, col).value);
    if (v && v !== "-") n++;
  }
  return n;
}

export function loadListSheetValues(wb: ExcelJS.Workbook): Map<string, string[]> {
  const ws = wb.getWorksheet(LIST_VALUES_SHEET);
  const out = new Map<string, string[]>();
  if (!ws) return out;

  const maxCol = Math.min(ws.columnCount || 30, 30);
  const headers = new Map<number, string>();
  for (let c = 1; c <= maxCol; c++) {
    const h = cellPlainValue(ws.getCell(1, c).value).trim();
    if (h) headers.set(c, h);
  }

  const lastRow = Math.min(ws.rowCount || 5000, 8000);
  for (const [col, name] of headers) {
    const values: string[] = [];
    const seen = new Set<string>();
    for (let r = 2; r <= lastRow; r++) {
      const v = cellPlainValue(ws.getCell(r, col).value).trim();
      if (!v || seen.has(v.toLowerCase())) continue;
      seen.add(v.toLowerCase());
      values.push(v);
      if (values.length >= 6000) break;
    }
    out.set(name, values);
  }
  return out;
}

export function scanTemplateSheet(
  wb: ExcelJS.Workbook,
  sheetName: string,
  listValues: Map<string, string[]>
): TemplateSheetScan | null {
  const ws = wb.getWorksheet(sheetName);
  if (!ws) return null;

  const { headerRow, hintRow } = findHeaderRow(ws);
  const maxCol = Math.min(ws.columnCount || 80, 80);
  const headers = readRowHeaders(ws, headerRow, maxCol);

  let skuCol: number | null = null;
  let imageCol: number | null = null;
  const columns: TemplateColumnMeta[] = [];

  for (const [col, header] of headers) {
    const hint = cellPlainValue(ws.getCell(hintRow, col).value).replace(/\n/g, " ").trim();
    const readonly = isReadonlyColumn(header, hint);
    const listName = listSheetNameForHeader(header);
    const dropdownValues = listName ? (listValues.get(listName) ?? []) : [];

    if (isSkuHeader(header) && !skuCol) skuCol = col;
    if (isImageHeader(header) && !imageCol) imageCol = col;

    columns.push({
      col,
      header,
      hint,
      readonly,
      contentDefault: isContentDefaultColumn(header) && !readonly,
      listSheetName: listName,
      dropdownValues,
      templateValidationValues: []
    });
  }

  if (!skuCol) {
    for (const c of columns) {
      if (normHeader(c.header).includes("артикул товара")) {
        skuCol = c.col;
        break;
      }
    }
  }

  const dataStartRow = detectDataStartRow(ws, hintRow, skuCol);
  const validationSampleRow = dataStartRow;

  for (const col of columns) {
    col.templateValidationValues = extractListValidationValues(wb, ws, validationSampleRow, col.col);
  }

  return {
    sheetName,
    headerRow,
    hintRow,
    dataStartRow,
    columns,
    dataRowCount: countDataRows(ws, dataStartRow, skuCol),
    skuCol,
    imageCol,
    listSheetAvailable: listValues.size > 0
  };
}

export function scanTemplateWorkbook(wb: ExcelJS.Workbook): {
  sheetNames: string[];
  listValues: Map<string, string[]>;
  scans: Record<string, TemplateSheetScan>;
} {
  const listValues = loadListSheetValues(wb);
  const sheetNames = wb.worksheets.map((w) => w.name);
  const scans: Record<string, TemplateSheetScan> = {};
  for (const name of sheetNames) {
    const scan = scanTemplateSheet(wb, name, listValues);
    if (scan && scan.columns.length > 0) scans[name] = scan;
  }
  return { sheetNames, listValues, scans };
}

export function collectRowContexts(
  ws: ExcelJS.Worksheet,
  scan: TemplateSheetScan
): { row: number; sku: string; cells: Record<string, string> }[] {
  const out: { row: number; sku: string; cells: Record<string, string> }[] = [];
  const last = ws.rowCount || scan.dataStartRow;
  const skuCol = scan.skuCol ?? 1;

  for (let r = scan.dataStartRow; r <= last; r++) {
    const sku = cellPlainValue(ws.getCell(r, skuCol).value);
    if (!sku || sku === "-") continue;
    const cells: Record<string, string> = {};
    for (const col of scan.columns) {
      const v = cellPlainValue(ws.getCell(r, col.col).value);
      if (v) cells[col.header] = v;
    }
    out.push({ row: r, sku, cells });
  }
  return out;
}
