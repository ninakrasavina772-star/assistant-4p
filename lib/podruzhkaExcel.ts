import type ExcelJS from "exceljs";
import {
  guessColumnMapping,
  NOTES_AI_FIELDS,
  type ExcelHeaderOption,
  type PodruzhkaColumnMapping,
  type PodruzhkaSheetInfo
} from "@/lib/podruzhkaColumnMapping";
import {
  PODRUZHKA_AI_COLUMN_DEFS,
  type PodruzhkaAiColumnKey,
  type PodruzhkaAiResult,
  type PodruzhkaFeedRow,
  type PodruzhkaNoteBlock
} from "@/lib/podruzhkaTypes";
import {
  cellAsUrl,
  cellAsUrlFromCell,
  cellPlainValue,
  isFoto2Header,
  isFoto3Header,
  type Foto2ColumnInfo
} from "@/lib/ozonImageExcel";

export { readWorkbookFromFile, writeWorkbookToBlob } from "@/lib/ozonImageExcel";
export type { PodruzhkaSheetInfo, PodruzhkaColumnMapping, ExcelHeaderOption } from "@/lib/podruzhkaColumnMapping";
export { autoDetectPodruzhkaMapping, type AutoDetectResult } from "@/lib/podruzhkaAutoMapping";
export {
  guessColumnMapping,
  mappingIsComplete,
  mappingIsCompleteForNotes,
  NOTES_AI_FIELDS,
  PODRUZHKA_FIELD_HINTS,
  PODRUZHKA_FIELD_LABELS,
  REQUIRED_FEED_FIELDS,
  SOURCE_EXCEL_FIELDS
} from "@/lib/podruzhkaColumnMapping";
export type { PodruzhkaFieldKey } from "@/lib/podruzhkaColumnMapping";

export type WorkbookScan = {
  sheetName: string;
  headerRow: number;
  headers: ExcelHeaderOption[];
};

function normHeader(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Последний занятый столбец (заголовок или любая строка данных) */
export function findLastUsedColumn(
  ws: ExcelJS.Worksheet,
  headerRow: number,
  maxScanCol = 150
): number {
  const lastRow = Math.min(ws.rowCount || headerRow + 1, headerRow + 800);
  let maxC = 0;
  for (let r = headerRow; r <= lastRow; r++) {
    for (let c = 1; c <= maxScanCol; c++) {
      const v = cellPlainValue(ws.getCell(r, c).value).trim();
      if (v) maxC = Math.max(maxC, c);
    }
  }
  return maxC;
}

/** Список заголовков первого листа для сопоставления полей */
export function scanWorkbookHeaders(wb: ExcelJS.Workbook): WorkbookScan | null {
  const ws = wb.worksheets[0];
  if (!ws) return null;

  const maxRow = Math.min(ws.rowCount || 8, 8);
  const maxCol = Math.max(findLastUsedColumn(ws, 1, 80), 50);

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

export function refreshWorkbookScan(wb: ExcelJS.Workbook, prev: WorkbookScan): WorkbookScan | null {
  const fresh = scanWorkbookHeaders(wb);
  if (!fresh) return null;
  return { ...fresh, sheetName: prev.sheetName };
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
    const foto = m.foto ? cellAsUrlFromCell(ws.getCell(row, m.foto)) : "";
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
    const maxC = findLastUsedColumn(ws, scan.headerRow);
    for (let c = 1; c <= maxC; c++) {
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

function colIndexByAliases(
  ws: ExcelJS.Worksheet,
  headerRow: number,
  maxColN: number,
  aliases: string[]
): number | null {
  const wants = aliases.map(normHeader);
  for (let c = 1; c <= maxColN; c++) {
    const v = normHeader(cellPlainValue(ws.getCell(headerRow, c).value));
    if (wants.includes(v)) return c;
  }
  return null;
}

export type AiColumnMap = Record<PodruzhkaAiColumnKey, number | undefined>;

/** Использует столбцы из образца (note 1, model…) или создаёт справа */
export function ensureAiColumns(ws: ExcelJS.Worksheet, headerRow: number): AiColumnMap {
  let lastUsed = findLastUsedColumn(ws, headerRow);
  const map = {} as AiColumnMap;

  for (const def of PODRUZHKA_AI_COLUMN_DEFS) {
    let c = colIndexByAliases(ws, headerRow, lastUsed, def.aliases);
    if (c == null && def.optional) {
      map[def.key] = undefined;
      continue;
    }
    if (c == null) {
      lastUsed += 1;
      c = lastUsed;
      ws.getCell(headerRow, c).value = def.header;
    }
    map[def.key] = c;
    if (c > lastUsed) lastUsed = c;
  }
  return map;
}

/** Какие столбцы AI уже есть / будут созданы (для подсказки в UI) */
export function listAiColumnsOnSheet(
  ws: ExcelJS.Worksheet,
  headerRow: number
): { key: string; header: string; col: number }[] {
  const cols = ensureAiColumns(ws, headerRow);
  return PODRUZHKA_AI_COLUMN_DEFS.filter((d) => cols[d.key] != null).map((d) => ({
    key: d.key,
    header: d.header,
    col: cols[d.key]!
  }));
}

/** Как в образец.xlsx: «ПРЯНЫЙ Пикантный характер» или «Древесный  Теплый…» */
export function parseNoteCellText(combined: string): PodruzhkaNoteBlock {
  const t = combined.trim();
  if (!t) return { title: "", desc: "" };

  const lines = t.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (lines.length >= 2) {
    return { title: lines[0]!, desc: lines.slice(1).join(" ") };
  }

  const multiSpace = t.split(/\s{2,}/).map((s) => s.trim()).filter(Boolean);
  if (multiSpace.length >= 2) {
    return { title: multiSpace[0]!, desc: multiSpace.slice(1).join(" ") };
  }

  const dash = t.match(/^(.+?)\s*[—–-]\s*(.+)$/);
  if (dash) return { title: dash[1]!.trim(), desc: dash[2]!.trim() };

  const words = t.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    if (words[0] === words[0]!.toUpperCase()) {
      return { title: words[0]!, desc: words.slice(1).join(" ") };
    }
    const idx = words.findIndex(
      (w, i) => i > 0 && w[0] === w[0]!.toUpperCase() && w !== w.toUpperCase()
    );
    if (idx > 0) {
      return { title: words.slice(0, idx).join(" "), desc: words.slice(idx).join(" ") };
    }
  }

  return { title: t, desc: "" };
}

function readNoteBlock(
  ws: ExcelJS.Worksheet,
  row: number,
  cols: AiColumnMap,
  i: 1 | 2 | 3
): PodruzhkaNoteBlock {
  const mainCol = cols[`note${i}` as PodruzhkaAiColumnKey];
  const descCol = cols[`note${i}_desc` as PodruzhkaAiColumnKey];
  if (!mainCol) return { title: "", desc: "" };

  if (descCol) {
    return {
      title: cellPlainValue(ws.getCell(row, mainCol).value),
      desc: cellPlainValue(ws.getCell(row, descCol).value)
    };
  }

  return parseNoteCellText(cellPlainValue(ws.getCell(row, mainCol).value));
}

function writeNoteBlock(
  ws: ExcelJS.Worksheet,
  row: number,
  cols: AiColumnMap,
  i: 1 | 2 | 3,
  n: PodruzhkaNoteBlock | undefined
): void {
  const mainCol = cols[`note${i}` as PodruzhkaAiColumnKey];
  const descCol = cols[`note${i}_desc` as PodruzhkaAiColumnKey];
  if (!mainCol) return;

  const title = n?.title ?? "";
  const desc = n?.desc ?? "";
  if (descCol) {
    ws.getCell(row, mainCol).value = title;
    ws.getCell(row, descCol).value = desc;
  } else {
    ws.getCell(row, mainCol).value = formatNoteCellForExcel({ title, desc });
  }
}

/** Одна ячейка как в образец.xlsx: «ПРЯНЫЙ  пикантный характер» */
export function formatNoteCellForExcel(note: PodruzhkaNoteBlock): string {
  const title = note.title.trim().toUpperCase();
  const desc = note.desc.trim();
  if (!title) return desc;
  if (!desc) return title;
  return `${title}  ${desc}`;
}

/** Нужен ли запуск AI: только если статус ещё не ok после прошлой генерации */
export function rowNeedsAiGeneration(
  ws: ExcelJS.Worksheet,
  info: PodruzhkaSheetInfo,
  feedRow: PodruzhkaFeedRow,
  force = false
): boolean {
  if (force) return true;
  const ai = readAiFromSheet(ws, info, feedRow);
  return ai.status !== "ok";
}

export function countAiReadyRows(
  ws: ExcelJS.Worksheet,
  info: PodruzhkaSheetInfo
): number {
  return info.rows.filter((r) => readAiFromSheet(ws, info, r).status === "ok").length;
}

export function readAiFromSheet(
  ws: ExcelJS.Worksheet,
  info: PodruzhkaSheetInfo,
  feedRow: PodruzhkaFeedRow
): { model: string; notes: PodruzhkaNoteBlock[]; status: string } {
  const aiCols = ensureAiColumns(ws, info.headerRow);
  const row = feedRow.row;
  const modelCol = aiCols.model;
  const model = modelCol ? cellPlainValue(ws.getCell(row, modelCol).value) : "";
  const notes = [
    readNoteBlock(ws, row, aiCols, 1),
    readNoteBlock(ws, row, aiCols, 2),
    readNoteBlock(ws, row, aiCols, 3)
  ];
  const statusCol = aiCols.notes_status;
  const status = statusCol ? cellPlainValue(ws.getCell(row, statusCol).value).trim() : "";
  return { model, notes, status };
}

export function applyAiResults(
  ws: ExcelJS.Worksheet,
  info: PodruzhkaSheetInfo,
  results: PodruzhkaAiResult[]
): number {
  const aiCols = ensureAiColumns(ws, info.headerRow);
  let written = 0;

  for (const r of results) {
    const row = r.row;
    if (aiCols.model) ws.getCell(row, aiCols.model).value = r.model;
    for (let i = 0; i < 3; i++) {
      writeNoteBlock(ws, row, aiCols, (i + 1) as 1 | 2 | 3, r.notes[i]);
    }
    if (aiCols.notes_status) {
      ws.getCell(row, aiCols.notes_status).value = r.ok
      ? "ok"
        : r.error ?? "не найдено";
    }
    written++;
  }

  return written;
}

function ensureFoto2Column(ws: ExcelJS.Worksheet, info: PodruzhkaSheetInfo): number {
  if (info.foto2Col) return info.foto2Col;
  const next = findLastUsedColumn(ws, info.headerRow) + 1;
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
  const maxColN = findLastUsedColumn(ws, info.headerRow);
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
