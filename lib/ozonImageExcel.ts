import * as XLSX from "xlsx";

export const FOTO2_HEADER = "foto 2";
export const FOTO3_HEADER = "Foto 3";

export type Foto2ColumnInfo = {
  sheetName: string;
  headerRow: number;
  foto2Col: number;
  /** Строка данных → исходный URL из Foto 2 */
  rows: { row: number; url: string }[];
};

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

/** URL из ячейки: текст или гиперссылка Excel */
export function cellAsUrl(cell: XLSX.CellObject | undefined): string {
  if (!cell) return "";
  const link = cell.l?.Target;
  if (typeof link === "string" && link.trim()) return link.trim();
  const v = cell.v;
  if (typeof v === "string") {
    const t = v.trim();
    if (/^https?:\/\//i.test(t)) return t;
    const m = t.match(/https?:\/\/\S+/i);
    if (m) return m[0]!;
  }
  return "";
}

export function findFoto2Column(ws: XLSX.WorkSheet): Omit<Foto2ColumnInfo, "sheetName" | "rows"> | null {
  const ref = ws["!ref"];
  if (!ref) return null;
  const range = XLSX.utils.decode_range(ref);
  const maxScanRow = Math.min(range.e.r, range.s.r + 10);

  for (let r = range.s.r; r <= maxScanRow; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = ws[addr];
      if (!isFoto2Header(cell?.v)) continue;
      return { headerRow: r, foto2Col: c };
    }
  }
  return null;
}

export function collectFoto2Urls(
  ws: XLSX.WorkSheet,
  info: Omit<Foto2ColumnInfo, "sheetName" | "rows">
): { row: number; url: string }[] {
  const ref = ws["!ref"];
  if (!ref) return [];
  const range = XLSX.utils.decode_range(ref);
  const out: { row: number; url: string }[] = [];

  for (let r = info.headerRow + 1; r <= range.e.r; r++) {
    const addr = XLSX.utils.encode_cell({ r, c: info.foto2Col });
    const url = cellAsUrl(ws[addr]);
    if (url) out.push({ row: r, url });
  }
  return out;
}

/** Вставить столбец на позицию insertAt, сдвинув существующие ячейки вправо */
function insertColumnAt(ws: XLSX.WorkSheet, insertAt: number): void {
  const ref = ws["!ref"];
  if (!ref) return;
  const range = XLSX.utils.decode_range(ref);

  for (let c = range.e.c; c >= insertAt; c--) {
    for (let r = range.s.r; r <= range.e.r; r++) {
      const src = XLSX.utils.encode_cell({ r, c });
      const dst = XLSX.utils.encode_cell({ r, c: c + 1 });
      if (ws[src]) {
        ws[dst] = { ...ws[src] };
      }
    }
  }

  for (let r = range.s.r; r <= range.e.r; r++) {
    delete ws[XLSX.utils.encode_cell({ r, c: insertAt })];
  }

  range.e.c += 1;
  ws["!ref"] = XLSX.utils.encode_range(range);
}

export type UrlConversion = Pick<
  import("@/lib/ozonImageUrls").OzonUrlRow,
  "input" | "output" | "ok" | "error"
>;

/** Добавляет столбец Foto 3 сразу после Foto 2 */
export function applyFoto3Column(
  ws: XLSX.WorkSheet,
  info: Omit<Foto2ColumnInfo, "sheetName" | "rows">,
  conversions: Map<string, UrlConversion>
): number {
  const foto3Col = info.foto2Col + 1;
  insertColumnAt(ws, foto3Col);

  const headerAddr = XLSX.utils.encode_cell({ r: info.headerRow, c: foto3Col });
  ws[headerAddr] = { t: "s", v: FOTO3_HEADER };

  const ref = ws["!ref"];
  if (!ref) return 0;
  const range = XLSX.utils.decode_range(ref);
  let filled = 0;

  for (let r = info.headerRow + 1; r <= range.e.r; r++) {
    const srcAddr = XLSX.utils.encode_cell({ r, c: info.foto2Col });
    const url = cellAsUrl(ws[srcAddr]);
    if (!url) continue;

    const conv = conversions.get(url);
    const dstAddr = XLSX.utils.encode_cell({ r, c: foto3Col });
    if (conv?.ok && conv.output) {
      ws[dstAddr] = { t: "s", v: conv.output, l: { Target: conv.output } };
      filled += 1;
    } else if (conv?.error) {
      ws[dstAddr] = { t: "s", v: `# ${conv.error}` };
    }
  }

  return filled;
}

export async function readWorkbookFromFile(file: File): Promise<XLSX.WorkBook> {
  return XLSX.read(await file.arrayBuffer(), { type: "array" });
}

export async function writeWorkbookToBlob(wb: XLSX.WorkBook): Promise<Blob> {
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  return new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });
}

export function analyzeWorkbook(wb: XLSX.WorkBook): Foto2ColumnInfo | null {
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const col = findFoto2Column(ws);
    if (!col) continue;
    const rows = collectFoto2Urls(ws, col);
    return { sheetName, ...col, rows };
  }
  return null;
}
