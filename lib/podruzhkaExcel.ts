import type ExcelJS from "exceljs";
import {
  guessColumnMapping,
  type ExcelHeaderOption,
  type PodruzhkaColumnMapping,
  type PodruzhkaSheetInfo
} from "@/lib/podruzhkaColumnMapping";
import {
  PODRUZHKA_AI_COLUMNS,
  type PodruzhkaAiResult,
  type PodruzhkaFeedRow,
  type PodruzhkaNoteBlock
} from "@/lib/podruzhkaTypes";
import {
  cellAsUrl,
  cellPlainValue,
  isFoto2Header,
  isFoto3Header,
  type Foto2ColumnInfo
} from "@/lib/ozonImageExcel";

export { readWorkbookFromFile, writeWorkbookToBlob } from "@/lib/ozonImageExcel";
export type { PodruzhkaSheetInfo, PodruzhkaColumnMapping, ExcelHeaderOption } from "@/lib/podruzhkaColumnMapping";
export {
  guessColumnMapping,
  mappingIsComplete,
  PODRUZHKA_FIELD_LABELS,
  REQUIRED_FEED_FIELDS
} from "@/lib/podruzhkaColumnMapping";
export type { PodruzhkaFieldKey } from "@/lib/podruzhkaColumnMapping";

export type WorkbookScan = {
  sheetName: string;
  headerRow: number;
  headers: ExcelHeaderOption[];
};

/** Список заголовков первого листа для сопоставления полей */
export function scanWorkbookHeaders(wb: ExcelJS.Workbook): WorkbookScan | null {
  const ws = wb.worksheets[0];
  if (!ws) return null;

  const maxRow = Math.min(ws.rowCount || 8, 8);
  const maxCol = ws.columnCount || 50;

  for (let r = 1; r <= maxRow; r++) {
    const headers: ExcelHeaderOption[] = [];
    for (let c = 1; c <= maxCol; c++) {
      const label = cellPlainValue(ws.getCell(r, c).value);
      if (label) headers.push({ col: c, label });
    }
    if (headers.length >= 4) {
      return { sheetName: ws.name, headerRow: r, headers };
    }
  }
  return null;
}

export function buildSheetFromMapping(
  wb: ExcelJS.Workbook,
  scan: WorkbookScan,
  mapping: PodruzhkaColumnMapping
): PodruzhkaSheetInfo | null {
  const ws = wb.getWorksheet(scan.sheetName);
  if (!ws) return null;

  const m = mapping;
  const brandCol = m.brandName!;
  const rows: PodruzhkaFeedRow[] = [];
  const lastRow = ws.rowCount || scan.headerRow;

  for (let row = scan.headerRow + 1; row <= lastRow; row++) {
    const brandName = cellPlainValue(ws.getCell(row, brandCol).value);
    const foto = m.foto ? cellAsUrl(ws.getCell(row, m.foto).value) : "";
    if (!brandName && !foto) continue;

    rows.push({
      row,
      id: m.id ? cellPlainValue(ws.getCell(row, m.id).value) : "",
      name: m.name ? cellPlainValue(ws.getCell(row, m.name).value) : "",
      brandName,
      productType: m.productType ? cellPlainValue(ws.getCell(row, m.productType).value) : "",
      productName: m.productName ? cellPlainValue(ws.getCell(row, m.productName).value) : "",
      foto,
      ml: m.ml ? cellPlainValue(ws.getCell(row, m.ml).value) : ""
    });
  }

  if (rows.length === 0) return null;

  let foto2Col: number | null = m.foto2 ?? null;
  if (!foto2Col) {
    for (let c = 1; c <= maxCol(ws); c++) {
      const raw = cellPlainValue(ws.getCell(scan.headerRow, c).value);
      if (isFoto2Header(raw)) foto2Col = c;
    }
  }

  return {
    sheetName: scan.sheetName,
    headerRow: scan.headerRow,
    mapping: m,
    foto2Col,
    rows
  };
}

function maxCol(ws: ExcelJS.Worksheet): number {
  return ws.columnCount || 40;
}

export function analyzePodruzhkaWorkbook(wb: ExcelJS.Workbook): PodruzhkaSheetInfo | null {
  const scan = scanWorkbookHeaders(wb);
  if (!scan) return null;
  const mapping = guessColumnMapping(scan.headers);
  return buildSheetFromMapping(wb, scan, mapping);
}

function colIndexByHeader(
  ws: ExcelJS.Worksheet,
  headerRow: number,
  maxColN: number,
  name: string
): number | null {
  const want = name.trim().toLowerCase();
  for (let c = 1; c <= maxColN; c++) {
    const v = cellPlainValue(ws.getCell(headerRow, c).value).trim().toLowerCase();
    if (v === want) return c;
  }
  return null;
}

function ensureAiColumns(ws: ExcelJS.Worksheet, headerRow: number): Record<string, number> {
  const maxColN = maxCol(ws);
  const map: Record<string, number> = {};

  for (const colName of PODRUZHKA_AI_COLUMNS) {
    let c = colIndexByHeader(ws, headerRow, maxColN, colName);
    if (c == null) {
      const next = maxColN + 1;
      ws.getCell(headerRow, next).value = colName;
      map[colName] = next;
    } else {
      map[colName] = c;
    }
  }
  return map;
}

function noteFromCells(
  ws: ExcelJS.Worksheet,
  row: number,
  cols: Record<string, number>,
  i: 1 | 2 | 3
): PodruzhkaNoteBlock {
  return {
    title: cellPlainValue(ws.getCell(row, cols[`note${i}_title`]!).value),
    desc: cellPlainValue(ws.getCell(row, cols[`note${i}_desc`]!).value)
  };
}

export function readAiFromSheet(
  ws: ExcelJS.Worksheet,
  info: PodruzhkaSheetInfo,
  feedRow: PodruzhkaFeedRow
): { model: string; notes: PodruzhkaNoteBlock[]; status: string } {
  const aiCols = ensureAiColumns(ws, info.headerRow);
  const row = feedRow.row;
  const model = cellPlainValue(ws.getCell(row, aiCols.model!).value);
  const notes = [
    noteFromCells(ws, row, aiCols, 1),
    noteFromCells(ws, row, aiCols, 2),
    noteFromCells(ws, row, aiCols, 3)
  ];
  const status = cellPlainValue(ws.getCell(row, aiCols.notes_status!).value);
  return { model, notes, status };
}

export function applyAiResults(
  ws: ExcelJS.Worksheet,
  info: PodruzhkaSheetInfo,
  results: PodruzhkaAiResult[]
): number {
  const aiCols = ensureAiColumns(ws, info.headerRow);
  const byRow = new Map(results.map((r) => [r.row, r]));
  let written = 0;

  for (const r of results) {
    const row = r.row;
    ws.getCell(row, aiCols.model!).value = r.model;
    for (let i = 0; i < 3; i++) {
      const n = r.notes[i];
      ws.getCell(row, aiCols[`note${i + 1}_title` as keyof typeof aiCols]!).value =
        n?.title ?? "";
      ws.getCell(row, aiCols[`note${i + 1}_desc` as keyof typeof aiCols]!).value =
        n?.desc ?? "";
    }
    ws.getCell(row, aiCols.notes_status!).value = r.ok
      ? "ok"
      : r.error ?? "не найдено";
    written++;
  }

  return written;
}

function ensureFoto2Column(ws: ExcelJS.Worksheet, info: PodruzhkaSheetInfo): number {
  if (info.foto2Col) return info.foto2Col;
  const mc = maxCol(ws);
  const next = mc + 1;
  ws.getCell(info.headerRow, next).value = "foto 2";
  return next;
}

export function applyFoto2Urls(
  ws: ExcelJS.Worksheet,
  info: PodruzhkaSheetInfo,
  urls: Map<number, string>
): { filled: number; foto2Col: number } {
  const col = ensureFoto2Column(ws, info);
  let n = 0;
  for (const [row, url] of urls) {
    if (!url) continue;
    ws.getCell(row, col).value = url;
    n++;
  }
  return { filled: n, foto2Col: col };
}

export function buildFoto2ColumnInfo(
  ws: ExcelJS.Worksheet,
  info: PodruzhkaSheetInfo
): Foto2ColumnInfo | null {
  const foto2Col = ensureFoto2Column(ws, info);
  const rows: { row: number; url: string }[] = [];

  for (const feed of info.rows) {
    const url = cellAsUrl(ws.getCell(feed.row, foto2Col).value);
    if (url) rows.push({ row: feed.row, url });
  }
  if (rows.length === 0) return null;

  let foto3Col = foto2Col + 1;
  const maxColN = maxCol(ws);
  for (let c = 1; c <= maxColN; c++) {
    const v = ws.getCell(info.headerRow, c).value;
    if (isFoto3Header(v) || isFoto3Header(cellPlainValue(v))) {
      foto3Col = c;
      break;
    }
  }

  return {
    sheetName: info.sheetName,
    headerRow: info.headerRow,
    foto2Col,
    foto3Col,
    rows
  };
}

export function defaultPodruzhkaDownloadName(
  baseFileName: string | null,
  suffix: "notes" | "infographic" | "foto3"
): string {
  const base = (baseFileName ?? "feed").replace(/\.xlsx?$/i, "");
  return `${base}-${suffix}.xlsx`;
}
