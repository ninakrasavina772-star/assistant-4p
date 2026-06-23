import type ExcelJS from "exceljs";
import { cellPlainValue } from "@/lib/ozonImageExcel";
import {
  isContentDefaultColumn,
  isImageHeader,
  isReadonlyColumn,
  isSkuHeader,
  listSheetNameForHeader,
  LIST_VALUES_SHEET,
  OZON_DATA_SHEET,
  normHeader
} from "@/lib/templateGenerator/presets";
import type { WorkbookListValidations } from "@/lib/templateGenerator/xlsxValidations";
import type { TemplateColumnMeta, TemplateSheetScan } from "@/lib/templateGenerator/types";
import { findListSheetValues } from "@/lib/templateGenerator/fieldValues";
import { extractListValidationValues } from "@/lib/templateGenerator/validation";

function resolveHintRow(ws: ExcelJS.Worksheet, headerRow: number, maxCol: number): number {
  for (let r = headerRow + 1; r <= headerRow + 5; r++) {
    if (looksLikeHintRow(ws, r, maxCol)) return r;
  }
  return headerRow + 1;
}

function findHeaderRow(ws: ExcelJS.Worksheet): { headerRow: number; hintRow: number } {
  const maxRow = Math.min(ws.rowCount || 20, 20);
  const maxCol = Math.min(ws.columnCount || 80, 80);

  const isHeaderMarker = (v: string): boolean =>
    /ваш\s*sku|артикул\s*товара|^артикул$|^sku$|shop.?sku|название\s*товара|наименование/i.test(v);

  for (let r = 1; r <= maxRow; r++) {
    for (let c = 1; c <= maxCol; c++) {
      const v = normHeader(cellPlainValue(ws.getCell(r, c).value));
      if (isHeaderMarker(v)) {
        return { headerRow: r, hintRow: resolveHintRow(ws, r, maxCol) };
      }
    }
  }
  return { headerRow: 1, hintRow: 2 };
}

function looksLikeHintRow(ws: ExcelJS.Worksheet, row: number, maxCol: number): boolean {
  let hintish = 0;
  let filled = 0;
  for (let c = 1; c <= maxCol; c++) {
    const v = cellPlainValue(ws.getCell(row, c).value).trim();
    if (!v) continue;
    filled++;
    if (
      /значение поля|обязатель|укажите|пример|не будет изменено|заполняется автоматически|можно указать|уникальный идентификатор|скачайте|перечислите|не более/i.test(
        v
      )
    ) {
      hintish++;
    }
  }
  return filled > 0 && hintish >= Math.max(1, Math.floor(filled / 3));
}

function readRowHeaders(ws: ExcelJS.Worksheet, row: number, maxCol: number): Map<number, string> {
  const out = new Map<number, string>();
  for (let c = 1; c <= maxCol; c++) {
    const h = cellPlainValue(ws.getCell(row, c).value).replace(/\n/g, " ").trim();
    if (h) out.set(c, h);
  }
  return out;
}

function looksLikeHintSkuCell(value: string): boolean {
  const v = String(value ?? "").trim();
  if (!v) return true;
  if (v.length > 72) return true;
  return /уникальный идентификатор|заполняется автоматически|значение поля|не будет изменено|можно указать|ссылка \(url\)|скачайте|перечислите через запятую/i.test(
    v
  );
}

function isPlausibleProductSku(value: string): boolean {
  if (looksLikeHintSkuCell(value)) return false;
  const v = String(value ?? "").trim();
  if (!v || v === "-") return false;
  if (/^-\d+$/.test(v)) return false;
  if (/^\d{6,}$/.test(v.replace(/\s/g, ""))) return true;
  if (/^[A-Za-z0-9][A-Za-z0-9._-]{2,}$/.test(v)) return true;
  return v.length >= 4;
}

/** Строка-пример Яндекс-шаблона между заголовком и подсказками (часто ID параметров) */
function looksLikeYandexExampleRow(ws: ExcelJS.Worksheet, row: number, maxCol: number): boolean {
  let numericIds = 0;
  let filled = 0;
  for (let c = 1; c <= maxCol; c++) {
    const v = cellPlainValue(ws.getCell(row, c).value).trim();
    if (!v) continue;
    filled++;
    if (/^\d{5,}$/.test(v)) numericIds++;
  }
  return filled >= 4 && numericIds >= 3;
}

function detectDataStartRow(
  ws: ExcelJS.Worksheet,
  headerRow: number,
  hintRow: number,
  skuCol: number | null,
  maxCol: number
): number {
  const col = skuCol ?? 1;
  const last = ws.rowCount || hintRow + 1;

  for (let r = headerRow + 1; r <= last; r++) {
    if (looksLikeHintRow(ws, r, maxCol)) continue;
    if (looksLikeYandexExampleRow(ws, r, maxCol)) continue;
    const v = cellPlainValue(ws.getCell(r, col).value);
    if (!v || v === "-") continue;
    if (/^значение поля/i.test(v)) continue;
    if (looksLikeHintSkuCell(v)) continue;
    if (!isPlausibleProductSku(v)) continue;
    if (v.length > 0 && v.length < 120) return r;
  }

  return hintRow + 1;
}

function effectiveLastRow(ws: ExcelJS.Worksheet, startRow: number, skuCol: number | null): number {
  const col = skuCol ?? 1;
  const hardMax = Math.min(ws.rowCount || startRow + 5000, startRow + 50000);
  let last = startRow;
  let emptyStreak = 0;
  for (let r = startRow; r <= hardMax; r++) {
    const v = cellPlainValue(ws.getCell(r, col).value);
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

function countDataRows(ws: ExcelJS.Worksheet, dataStart: number, skuCol: number | null): number {
  const col = skuCol ?? 1;
  let n = 0;
  const last = effectiveLastRow(ws, dataStart, skuCol);
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
  listValues: Map<string, string[]>,
  columnFormulae?: Map<number, string>
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
  if (!skuCol) {
    for (const c of columns) {
      if (isSkuHeader(c.header)) {
        skuCol = c.col;
        break;
      }
    }
  }

  const dataStartRow = detectDataStartRow(ws, headerRow, hintRow, skuCol, maxCol);
  const validationSampleRow = dataStartRow;

  for (const col of columns) {
    col.templateValidationValues = extractListValidationValues(
      wb,
      ws,
      validationSampleRow,
      col.col,
      columnFormulae
    );
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

export function scanTemplateWorkbook(
  wb: ExcelJS.Workbook,
  listValidations?: WorkbookListValidations
): {
  sheetNames: string[];
  listValues: Map<string, string[]>;
  scans: Record<string, TemplateSheetScan>;
} {
  const listValues = loadListSheetValues(wb);
  const sheetNames = wb.worksheets.map((w) => w.name);
  const scans: Record<string, TemplateSheetScan> = {};

  const skipNames = new Set(
    ["инструкция", "требования", "meta", "список значений", "list values"].map((s) => s.toLowerCase())
  );

  for (const name of sheetNames) {
    if (skipNames.has(name.trim().toLowerCase())) continue;
    const ws = wb.getWorksheet(name);
    if (!ws) continue;
    if (name !== OZON_DATA_SHEET && !sheetLooksLikeProductData(ws)) continue;
    const formulae = listValidations?.get(name);
    const scan = scanTemplateSheet(wb, name, listValues, formulae);
    if (scan && scan.columns.length > 0) scans[name] = scan;
  }

  if (!scans[OZON_DATA_SHEET]) {
    for (const name of sheetNames) {
      if (scans[name]) continue;
      const formulae = listValidations?.get(name);
      const scan = scanTemplateSheet(wb, name, listValues, formulae);
      if (scan && scan.columns.length > 0 && scan.dataRowCount > 0) {
        scans[name] = scan;
      }
    }
  }

  return { sheetNames, listValues, scans };
}

function sheetLooksLikeProductData(ws: ExcelJS.Worksheet): boolean {
  const { headerRow } = findHeaderRow(ws);
  const headers = readRowHeaders(ws, headerRow, 40);
  for (const h of headers.values()) {
    const n = normHeader(h);
    if (
      n.includes("название товара") ||
      n.includes("наименование") ||
      n.includes("артикул товара") ||
      n.includes("ваш sku") ||
      n === "артикул" ||
      n === "sku"
    ) {
      return true;
    }
  }
  return false;
}

export function collectRowContexts(
  ws: ExcelJS.Worksheet,
  scan: TemplateSheetScan
): { row: number; sku: string; cells: Record<string, string> }[] {
  const out: { row: number; sku: string; cells: Record<string, string> }[] = [];
  const last = effectiveLastRow(ws, scan.dataStartRow, scan.skuCol);
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
