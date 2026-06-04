import type ExcelJS from "exceljs";
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

function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

const HEADER_ALIASES: Record<string, keyof Omit<PodruzhkaFeedRow, "row">> = {
  id: "id",
  name: "name",
  "brand name": "brandName",
  brand: "brandName",
  product_type: "productType",
  "product type": "productType",
  "product name": "productName",
  product_name: "productName",
  foto: "foto",
  ml: "ml"
};

export type PodruzhkaSheetInfo = {
  sheetName: string;
  headerRow: number;
  cols: Record<keyof Omit<PodruzhkaFeedRow, "row">, number>;
  foto2Col: number | null;
  rows: PodruzhkaFeedRow[];
};

async function loadExcelJS(): Promise<typeof ExcelJS> {
  const mod = await import("exceljs");
  return mod.default ?? mod;
}

function findFeedSheet(ws: ExcelJS.Worksheet): PodruzhkaSheetInfo | null {
  const maxRow = Math.min(ws.rowCount || 15, 15);
  const maxCol = ws.columnCount || 40;

  for (let r = 1; r <= maxRow; r++) {
    const cols: Partial<Record<keyof Omit<PodruzhkaFeedRow, "row">, number>> = {};
    let foto2Col: number | null = null;

    for (let c = 1; c <= maxCol; c++) {
      const raw = cellPlainValue(ws.getCell(r, c).value);
      const n = normalizeHeader(raw);
      if (isFoto2Header(raw) || n === "foto 2" || n === "foto2") foto2Col = c;
      const key = HEADER_ALIASES[n];
      if (key) cols[key] = c;
    }

    if (cols.brandName && cols.foto) {
      const required = ["brandName", "productType", "productName", "name", "foto", "ml"] as const;
      const missing = required.filter((k) => !cols[k]);
      if (missing.length > 0) continue;

      const headerRow = r;
      const lastRow = ws.rowCount || headerRow;
      const rows: PodruzhkaFeedRow[] = [];

      for (let row = headerRow + 1; row <= lastRow; row++) {
        const brandName = cellPlainValue(ws.getCell(row, cols.brandName!).value);
        const foto = cellAsUrl(ws.getCell(row, cols.foto!).value);
        if (!brandName && !foto) continue;

        rows.push({
          row,
          id: cols.id ? cellPlainValue(ws.getCell(row, cols.id).value) : "",
          name: cellPlainValue(ws.getCell(row, cols.name!).value),
          brandName,
          productType: cellPlainValue(ws.getCell(row, cols.productType!).value),
          productName: cellPlainValue(ws.getCell(row, cols.productName!).value),
          foto,
          ml: cellPlainValue(ws.getCell(row, cols.ml!).value)
        });
      }

      return {
        sheetName: ws.name,
        headerRow,
        cols: cols as Record<keyof Omit<PodruzhkaFeedRow, "row">, number>,
        foto2Col,
        rows
      };
    }
  }
  return null;
}

export function analyzePodruzhkaWorkbook(wb: ExcelJS.Workbook): PodruzhkaSheetInfo | null {
  for (const ws of wb.worksheets) {
    const info = findFeedSheet(ws);
    if (info) return info;
  }
  return null;
}

function colIndexByHeader(
  ws: ExcelJS.Worksheet,
  headerRow: number,
  maxCol: number,
  name: string
): number | null {
  const want = normalizeHeader(name);
  for (let c = 1; c <= maxCol; c++) {
    if (normalizeHeader(cellPlainValue(ws.getCell(headerRow, c).value)) === want) return c;
  }
  return null;
}

function ensureAiColumns(ws: ExcelJS.Worksheet, headerRow: number): Record<string, number> {
  const maxCol = ws.columnCount || 50;
  const map: Record<string, number> = {};

  for (const colName of PODRUZHKA_AI_COLUMNS) {
    let c = colIndexByHeader(ws, headerRow, maxCol, colName);
    if (c == null) {
      const next = (ws.columnCount || maxCol) + 1;
      ws.getCell(headerRow, next).value = colName;
      c = next;
    }
    map[colName] = c;
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
): void {
  const aiCols = ensureAiColumns(ws, info.headerRow);
  const byRow = new Map(results.map((r) => [r.row, r]));

  for (const feed of info.rows) {
    const r = byRow.get(feed.row);
    if (!r) continue;
    const row = feed.row;
    ws.getCell(row, aiCols.model!).value = r.model;
    for (let i = 0; i < 3; i++) {
      const n = r.notes[i];
      ws.getCell(row, aiCols[`note${i + 1}_title` as keyof typeof aiCols]!).value = n?.title ?? "";
      ws.getCell(row, aiCols[`note${i + 1}_desc` as keyof typeof aiCols]!).value = n?.desc ?? "";
    }
    ws.getCell(row, aiCols.notes_status!).value = r.ok
      ? "ok"
      : r.error ?? "не найдено";
  }
}

function ensureFoto2Column(ws: ExcelJS.Worksheet, info: PodruzhkaSheetInfo): number {
  if (info.foto2Col) return info.foto2Col;
  const maxCol = (ws.columnCount || info.cols.ml) + 1;
  ws.getCell(info.headerRow, maxCol).value = "foto 2";
  return maxCol;
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

/** Для шага 3: foto 2 → Foto 3 (тот же формат, что у OzonImageConverter). */
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
  const maxCol = ws.columnCount || foto2Col + 5;
  for (let c = 1; c <= maxCol; c++) {
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
