import { parseExcludeProductIdsFromText } from "./excludeProductIds";

function pushNum(
  raw: string | number | null | undefined,
  seen: Set<number>,
  out: number[]
): void {
  if (raw == null || raw === "") return;
  const n = typeof raw === "number" ? raw : Number(String(raw).trim().replace(/\s/g, ""));
  if (!Number.isFinite(n) || n < 1) return;
  const id = Math.floor(n);
  if (seen.has(id)) return;
  seen.add(id);
  out.push(id);
}

/**
 * Excel/CSV/TXT: первый столбец — id товаров (числа).
 */
export async function extractProductIdsFromFile(file: File): Promise<number[]> {
  const name = file.name.toLowerCase();
  const seen = new Set<number>();
  const out: number[] = [];

  if (name.endsWith(".csv") || name.endsWith(".txt")) {
    const text = await file.text();
    return parseExcludeProductIdsFromText(text);
  }
  if (name.endsWith(".xlsx") || name.endsWith(".xls") || name.endsWith(".xlsm")) {
    const XLSX = await import("xlsx");
    const data = await file.arrayBuffer();
    const wb = XLSX.read(data, { type: "array" });
    const sh = wb.SheetNames[0];
    if (!sh) return [];
    const sheet = wb.Sheets[sh];
    const rows = XLSX.utils.sheet_to_json<(string | number | null | undefined)[]>(
      sheet,
      { header: 1, defval: null, raw: false }
    );
    for (const row of rows) {
      if (!row || !row.length) continue;
      pushNum(row[0], seen, out);
      if (out.length >= 50_000) break;
    }
    return out;
  }
  return parseExcludeProductIdsFromText(await file.text());
}
