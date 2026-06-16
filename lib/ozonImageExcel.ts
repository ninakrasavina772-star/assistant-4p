import type ExcelJS from "exceljs";

export const FOTO2_HEADER = "foto 2";
export const FOTO3_HEADER = "Foto 3";

export type Foto2ColumnInfo = {
  sheetName: string;
  headerRow: number;
  foto2Col: number;
  foto3Col: number;
  rows: { row: number; url: string }[];
};

async function loadExcelJS(): Promise<typeof ExcelJS> {
  const mod = await import("exceljs");
  return mod.default ?? mod;
}

function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function isFoto2Header(value: unknown): boolean {
  const n = normalizeHeader(value);
  return n === "foto 2" || n === "foto2";
}

export function isFoto3Header(value: unknown): boolean {
  const n = normalizeHeader(value);
  return n === "foto 3" || n === "foto3";
}

export function cellPlainValue(value: ExcelJS.CellValue): string {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value).trim();
  }
  if (typeof value === "object") {
    if ("hyperlink" in value && typeof value.hyperlink === "string") {
      return value.hyperlink.trim();
    }
    if ("text" in value && value.text != null) {
      return String(value.text).trim();
    }
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((p) => p.text ?? "").join("").trim();
    }
    if (value instanceof Date) return "";
  }
  return "";
}

/** URL из ячейки: текст или гиперссылка */
export function cellAsUrl(value: ExcelJS.CellValue): string {
  const t = cellPlainValue(value);
  if (/^https?:\/\//i.test(t)) return t;
  const m = t.match(/https?:\/\/\S+/i);
  return m ? m[0]! : "";
}

/** URL из ячейки Excel (в т.ч. hyperlink на ячейке, не только текст) */
export function cellAsUrlFromCell(cell: {
  value?: ExcelJS.CellValue;
  hyperlink?: string | { text?: string; hyperlink?: string };
  text?: string;
}): string {
  const raw = cell.hyperlink;
  if (typeof raw === "string" && /^https?:\/\//i.test(raw.trim())) return raw.trim();
  if (raw && typeof raw === "object" && typeof raw.hyperlink === "string") {
    const h = raw.hyperlink.trim();
    if (/^https?:\/\//i.test(h)) return h;
  }
  const fromValue = cellAsUrl(cell.value ?? null);
  if (fromValue) return fromValue;
  const text = String(cell.text ?? "").trim();
  const m = text.match(/https?:\/\/\S+/i);
  return m ? m[0]! : "";
}

function findHeaderColumns(ws: ExcelJS.Worksheet): Omit<Foto2ColumnInfo, "sheetName" | "rows"> | null {
  const maxRow = Math.min(ws.rowCount || 10, 10);
  const maxCol = ws.columnCount || 30;

  for (let r = 1; r <= maxRow; r++) {
    let foto2Col: number | null = null;
    let foto3Col: number | null = null;

    for (let c = 1; c <= maxCol; c++) {
      const v = ws.getCell(r, c).value;
      if (isFoto2Header(v) || isFoto2Header(cellPlainValue(v))) foto2Col = c;
      if (isFoto3Header(v) || isFoto3Header(cellPlainValue(v))) foto3Col = c;
    }

    if (foto2Col != null) {
      return {
        headerRow: r,
        foto2Col,
        foto3Col: foto3Col ?? foto2Col + 1
      };
    }
  }
  return null;
}

function collectFoto2Urls(
  ws: ExcelJS.Worksheet,
  info: Omit<Foto2ColumnInfo, "sheetName" | "rows">
): { row: number; url: string }[] {
  const out: { row: number; url: string }[] = [];
  const lastRow = ws.rowCount || info.headerRow;

  for (let r = info.headerRow + 1; r <= lastRow; r++) {
    const url = cellAsUrl(ws.getCell(r, info.foto2Col).value);
    if (url) out.push({ row: r, url });
  }
  return out;
}

export type UrlConversion = Pick<
  import("@/lib/ozonImageUrls").OzonUrlRow,
  "input" | "output" | "ok" | "error"
>;

function headerAt(ws: ExcelJS.Worksheet, row: number, col: number): string {
  return normalizeHeader(cellPlainValue(ws.getCell(row, col).value));
}

/** Добавляет или обновляет Foto 3 сразу после Foto 2, остальные колонки не трогаем */
export function applyFoto3Column(
  ws: ExcelJS.Worksheet,
  info: Omit<Foto2ColumnInfo, "sheetName" | "rows">,
  conversions: Map<string, UrlConversion>
): number {
  let foto3Col = info.foto3Col;

  const headerNext = headerAt(ws, info.headerRow, info.foto2Col + 1);
  const hasFoto3 =
    headerNext === "foto 3" ||
    headerNext === "foto3" ||
    isFoto3Header(ws.getCell(info.headerRow, foto3Col).value);

  if (!hasFoto3) {
    // Вставка столбца — ExcelJS сдвигает существующие данные и медиа вправо
    ws.spliceColumns(info.foto2Col + 1, 0, []);
    foto3Col = info.foto2Col + 1;
  }

  ws.getCell(info.headerRow, foto3Col).value = FOTO3_HEADER;
  ws.getColumn(foto3Col).width = 85;

  let filled = 0;
  const lastRow = ws.rowCount || info.headerRow;

  for (let r = info.headerRow + 1; r <= lastRow; r++) {
    const url = cellAsUrl(ws.getCell(r, info.foto2Col).value);
    if (!url) continue;

    const conv = conversions.get(url);
    const cell = ws.getCell(r, foto3Col);
    if (conv?.ok && conv.output) {
      cell.value = conv.output;
      filled += 1;
    } else if (conv?.error) {
      cell.value = `# ${conv.error}`;
    }
  }

  return filled;
}

export type WorkbookLoadOptions = {
  /**
   * Ozon-шаблоны часто задают data validation на целый столбец (до 1 048 576 строк).
   * ExcelJS разворачивает каждую ячейку → «Too many properties to enumerate».
   * По умолчанию пропускаем; списки для dropdown читаем из XML отдельно.
   */
  skipDataValidations?: boolean;
};

export async function readWorkbookFromBuffer(
  buf: ArrayBuffer,
  options?: WorkbookLoadOptions
): Promise<ExcelJS.Workbook> {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  const skipDv = options?.skipDataValidations !== false;
  await wb.xlsx.load(
    buf,
    skipDv
      ? {
          ignoreNodes: ["dataValidations", "conditionalFormatting"]
        }
      : undefined
  );
  return wb;
}

export async function readWorkbookFromFile(
  file: File,
  options?: WorkbookLoadOptions
): Promise<ExcelJS.Workbook> {
  return readWorkbookFromBuffer(await file.arrayBuffer(), options);
}

export async function writeWorkbookToBlob(wb: ExcelJS.Workbook): Promise<Blob> {
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });
}

export function analyzeWorkbook(wb: ExcelJS.Workbook): Foto2ColumnInfo | null {
  for (const ws of wb.worksheets) {
    const col = findHeaderColumns(ws);
    if (!col) continue;
    const rows = collectFoto2Urls(ws, col);
    return { sheetName: ws.name, ...col, rows };
  }
  return null;
}
