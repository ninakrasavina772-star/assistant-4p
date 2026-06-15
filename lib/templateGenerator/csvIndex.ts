import * as XLSX from "xlsx";
import { normHeader } from "@/lib/templateGenerator/presets";
import type { CsvColumnMap } from "@/lib/templateGenerator/types";

export type CsvTable = {
  headers: string[];
  rows: string[][];
};

export function parseCsvText(text: string): CsvTable {
  const t = text.replace(/^\uFEFF/, "");
  const wb = XLSX.read(t, { type: "string", raw: false });
  const sheet = wb.Sheets[wb.SheetNames[0]!];
  if (!sheet) return { headers: [], rows: [] };
  const data = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: "" }) as string[][];
  if (!data.length) return { headers: [], rows: [] };
  const headers = (data[0] ?? []).map((h) => String(h ?? "").trim());
  const rows = data.slice(1).filter((r) => r.some((c) => String(c ?? "").trim()));
  return { headers, rows };
}

export function normSku(s: string): string {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

function rowToRecord(headers: string[], row: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((h, i) => {
    const v = String(row[i] ?? "").trim();
    if (h && v) out[h] = v;
  });
  return out;
}

export function guessSkuColumn(headers: string[]): string | null {
  for (const h of headers) {
    const n = normHeader(h);
    if (n.includes("артикул") && (n.includes("sku") || n.includes("вариац"))) return h;
    if (n === "sku" || n === "article" || n === "артикул") return h;
  }
  for (const h of headers) {
    if (normHeader(h).includes("артикул")) return h;
  }
  return null;
}

export function buildCsvIndex(
  table: CsvTable,
  map: CsvColumnMap
): Map<string, Record<string, string>> {
  const idx = new Map<string, Record<string, string>>();
  const skuCol = map.skuColumn;
  if (!skuCol) return idx;

  const skuIdx = table.headers.indexOf(skuCol);
  if (skuIdx < 0) return idx;

  for (const row of table.rows) {
    const sku = normSku(String(row[skuIdx] ?? ""));
    if (!sku) continue;
    idx.set(sku, rowToRecord(table.headers, row));
  }
  return idx;
}

export function mergeCsvMapHeuristic(
  table: CsvTable,
  templateHeaders: string[]
): CsvColumnMap {
  const skuColumn = guessSkuColumn(table.headers) ?? table.headers[0] ?? "";
  const columns: Record<string, string> = {};

  for (const th of templateHeaders) {
    const tn = normHeader(th);
    let best: string | null = null;
    for (const ch of table.headers) {
      const cn = normHeader(ch);
      if (cn === tn || cn.includes(tn) || tn.includes(cn)) {
        best = ch;
        break;
      }
    }
    if (best) columns[th] = best;
  }

  return { skuColumn, columns };
}

export function lookupCsvRow(
  index: Map<string, Record<string, string>>,
  sku: string,
  map: CsvColumnMap
): Record<string, string> {
  const raw = index.get(normSku(sku));
  if (!raw) return {};
  const out: Record<string, string> = {};
  for (const [templateHeader, csvHeader] of Object.entries(map.columns)) {
    const v = raw[csvHeader];
    if (v) out[templateHeader] = v;
  }
  for (const [k, v] of Object.entries(raw)) {
    if (!Object.values(out).includes(v)) out[`csv:${k}`] = v;
  }
  return out;
}
