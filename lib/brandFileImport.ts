import { mergeBrandLists, parseBrandListFromText } from "./brand-filter";

/**
 * Клиентский импорт: Excel/CSV/текст. Первый столбец первого листа — список брендов.
 */
export async function extractBrandsFromFile(file: File): Promise<string[]> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv") || name.endsWith(".txt")) {
    return parseBrandListFromText(await file.text());
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
    const col: string[] = [];
    for (const row of rows) {
      if (!row || !row.length) continue;
      const c0 = row[0];
      if (c0 == null || c0 === "") continue;
      col.push(String(c0).trim());
    }
    return mergeBrandLists(col);
  }
  return parseBrandListFromText(await file.text());
}
