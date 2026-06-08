import type ExcelJS from "exceljs";
import {
  guessColumnMapping,
  NOTES_AI_FIELDS,
  type ExcelHeaderOption,
  type PodruzhkaColumnMapping,
  type PodruzhkaSheetInfo
} from "@/lib/podruzhkaColumnMapping";
import { sanitizeNoteTitle } from "@/lib/podruzhkaAiNotes";
import { resolveProductTypeForRender } from "@/lib/podruzhkaProductType";
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
import { resolveFeedFotoUrl, type FeedFotoResolveMode } from "@/lib/podruzhkaFeedFoto";

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
    const foto = resolveFeedFotoUrl(ws, row, m, "perfume");
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

  const titleRaw = cellPlainValue(ws.getCell(row, mainCol).value);
  const descRaw = descCol ? cellPlainValue(ws.getCell(row, descCol).value) : "";

  if (descCol) {
    if (titleRaw.trim()) {
      return { title: titleRaw, desc: descRaw };
    }
    if (descRaw.trim()) {
      const parsed = parseNoteCellText(descRaw);
      return parsed.title.trim() ? parsed : { title: descRaw, desc: "" };
    }
    return { title: "", desc: "" };
  }

  return parseNoteCellText(titleRaw);
}

/** model из колонки model, иначе product name / name */
export function resolveModelForRender(model: string, feedRow: PodruzhkaFeedRow): string {
  const m = model.trim();
  if (m) return m;
  const productName = feedRow.productName.trim();
  if (productName) return productName;
  return feedRow.name.trim();
}

function normalizeNoteDesc(s: string): string {
  const t = s.trim().replace(/\.$/, "");
  if (!t) return "";
  return t.charAt(0).toLowerCase() + t.slice(1);
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

  const title = n?.title ? sanitizeNoteTitle(n.title) : "";
  const desc = n?.desc ? normalizeNoteDesc(n.desc) : "";
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

export type RowRenderEligibility = {
  ok: boolean;
  model: string;
  notes: PodruzhkaNoteBlock[];
  status: string;
  reasons: string[];
};

function noteIsComplete(n: PodruzhkaNoteBlock): boolean {
  return Boolean(n.title.trim());
}

/** Можно ли рисовать инфографику (model + 3 ноты; статус «ok» не обязателен) */
export function getRowRenderEligibility(
  ws: ExcelJS.Worksheet,
  info: PodruzhkaSheetInfo,
  feedRow: PodruzhkaFeedRow,
  fotoMode: FeedFotoResolveMode = "auto"
): RowRenderEligibility {
  const ai = readAiFromSheet(ws, info, feedRow);
  const model = resolveModelForRender(ai.model, feedRow);
  const reasons: string[] = [];

  if (!feedRow.brandName.trim()) reasons.push("нет brand name");
  const foto = resolveFeedFotoUrl(ws, feedRow.row, info.mapping, "perfume", fotoMode).trim();
  if (!foto) reasons.push("нет foto");
  if (!model) reasons.push("нет model");
  for (let i = 0; i < 3; i++) {
    const n = ai.notes[i]!;
    if (!n.title.trim()) reasons.push(`пустой note ${i + 1}`);
  }

  const ok =
    reasons.length === 0 &&
    model.length > 0 &&
    ai.notes.length >= 3 &&
    ai.notes.every(noteIsComplete);

  return { ok, model, notes: ai.notes, status: ai.status, reasons };
}

/** Почему строку нельзя отправить в AI (пустой brand и т.п.) */
export function getFeedRowAiSkipReason(row: PodruzhkaFeedRow): string | null {
  if (typeof row.row !== "number" || row.row < 1) return "Некорректный номер строки Excel";
  if (!row.brandName.trim()) return "Нет brand name — заполните в Excel";
  return null;
}

export function makeFeedRowAiErrorResult(
  row: PodruzhkaFeedRow,
  error: string
): PodruzhkaAiResult {
  return {
    row: row.row,
    ok: false,
    model: "",
    notes: [],
    productTypeCard: "",
    productTypeMismatch: false,
    sources: [],
    error
  };
}

/** Нужен ли запуск AI: нет model или неполные ноты, либо force */
export function rowNeedsAiGeneration(
  ws: ExcelJS.Worksheet,
  info: PodruzhkaSheetInfo,
  feedRow: PodruzhkaFeedRow,
  force = false
): boolean {
  if (force) return true;
  return !getRowRenderEligibility(ws, info, feedRow).ok;
}

export function countAiReadyRows(
  ws: ExcelJS.Worksheet,
  info: PodruzhkaSheetInfo,
  fotoMode: FeedFotoResolveMode = "auto"
): number {
  return info.rows.filter((r) => getRowRenderEligibility(ws, info, r, fotoMode).ok).length;
}

/** Сводка причин, почему строки не готовы к инфографике */
export function summarizeRenderBlockers(
  ws: ExcelJS.Worksheet,
  info: PodruzhkaSheetInfo,
  fotoMode: FeedFotoResolveMode = "auto"
): { reason: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const row of info.rows) {
    const el = getRowRenderEligibility(ws, info, row, fotoMode);
    if (el.ok) continue;
    for (const reason of el.reasons) {
      counts.set(reason, (counts.get(reason) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);
}

export function applyAiResults(
  ws: ExcelJS.Worksheet,
  info: PodruzhkaSheetInfo,
  results: PodruzhkaAiResult[]
): { written: number; typeMismatch: number } {
  const aiCols = ensureAiColumns(ws, info.headerRow);
  let written = 0;
  let typeMismatch = 0;

  for (const r of results) {
    const row = r.row;
    if (aiCols.model) ws.getCell(row, aiCols.model).value = r.model;
    for (let i = 0; i < 3; i++) {
      writeNoteBlock(ws, row, aiCols, (i + 1) as 1 | 2 | 3, r.notes[i]);
    }
    if (aiCols.product_type_card) {
      if (r.productTypeMismatch && r.productTypeCard) {
        ws.getCell(row, aiCols.product_type_card).value = r.productTypeCard;
        if (r.ok) typeMismatch++;
      } else {
        ws.getCell(row, aiCols.product_type_card).value = "";
      }
    }
    if (aiCols.notes_status) {
      ws.getCell(row, aiCols.notes_status).value = r.ok
        ? "ok"
        : r.error ?? "не найдено";
    }
    written++;
  }

  return { written, typeMismatch };
}

/** Тип для серой строки: product type card → иначе product_type / name */
export function readProductTypeForCard(
  ws: ExcelJS.Worksheet,
  info: PodruzhkaSheetInfo,
  feedRow: PodruzhkaFeedRow,
  model?: string
): string {
  const aiCols = ensureAiColumns(ws, info.headerRow);
  const cardCol = aiCols.product_type_card;
  const fromCard = cardCol
    ? cellPlainValue(ws.getCell(feedRow.row, cardCol).value).trim()
    : "";
  return resolveProductTypeForRender({
    productTypeCard: fromCard,
    productType: feedRow.productType,
    productName: feedRow.productName,
    name: feedRow.name,
    model
  });
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
  suffix: "notes" | "infographic" | "foto3",
  part?: number
): string {
  const base = (baseFileName ?? "feed").replace(/\.xlsx?$/i, "");
  const partTag = part && part > 0 ? `-part${part}` : "";
  return `${base}-${suffix}${partTag}.xlsx`;
}
