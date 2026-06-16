import type ExcelJS from "exceljs";
import { cellPlainValue } from "@/lib/ozonImageExcel";

function parseInlineList(formula: string): string[] {
  const raw = String(formula ?? "").trim();
  if (!raw) return [];
  const quoted = raw.match(/^"([\s\S]*)"/);
  const inner = quoted ? quoted[1] : raw;
  return inner
    .split(/[,;]/)
    .map((s) => s.replace(/^["']|["']$/g, "").trim())
    .filter(Boolean);
}

function colLettersToIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) {
    n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return n;
}

function parseA1Range(ref: string): {
  sheet?: string;
  r1: number;
  c1: number;
  r2: number;
  c2: number;
} | null {
  const bang = ref.indexOf("!");
  let sheet: string | undefined;
  let range = ref;
  if (bang > 0) {
    sheet = ref.slice(0, bang).replace(/^'|'$/g, "");
    range = ref.slice(bang + 1);
  }
  const m = range.match(/^\$?([A-Z]+)\$?(\d+):\$?([A-Z]+)\$?(\d+)$/i);
  if (!m) return null;
  return {
    sheet,
    r1: Number(m[2]),
    c1: colLettersToIndex(m[1]!),
    r2: Number(m[4]),
    c2: colLettersToIndex(m[3]!)
  };
}

function readRangeValues(wb: ExcelJS.Workbook, ws: ExcelJS.Worksheet, ref: string): string[] {
  const parsed = parseA1Range(ref);
  if (!parsed) return [];
  const sheet = parsed.sheet ? wb.getWorksheet(parsed.sheet) : ws;
  if (!sheet) return [];

  const out: string[] = [];
  const seen = new Set<string>();
  const rowEnd = Math.min(parsed.r2, parsed.r1 + 8000);
  const colEnd = Math.min(parsed.c2, parsed.c1 + 40);
  for (let r = parsed.r1; r <= rowEnd; r++) {
    for (let c = parsed.c1; c <= colEnd; c++) {
      const v = cellPlainValue(sheet.getCell(r, c).value).trim();
      if (!v || seen.has(v.toLowerCase())) continue;
      seen.add(v.toLowerCase());
      out.push(v);
      if (out.length >= 6000) return out;
    }
  }
  return out;
}

export function extractListValidationValues(
  wb: ExcelJS.Workbook,
  ws: ExcelJS.Worksheet,
  row: number,
  col: number,
  columnFormulae?: Map<number, string>
): string[] {
  let formula = columnFormulae?.get(col)?.trim() ?? "";
  if (!formula) {
    const cell = ws.getCell(row, col);
    const dv = cell.dataValidation;
    if (!dv || dv.type !== "list" || !dv.formulae?.length) return [];
    formula = String(dv.formulae[0] ?? "").trim();
  }
  if (!formula) return [];

  if (formula.startsWith('"') || (!formula.includes("!") && !formula.includes("$"))) {
    return parseInlineList(formula);
  }

  return readRangeValues(wb, ws, formula);
}
