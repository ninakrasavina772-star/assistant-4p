import { parseExcludeProductIdsFromText } from "./excludeProductIds";
import { parseVariationIdsFromTextBulk } from "./templateGenerator/parseVariationIds";

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

function findProductIdColumnIndex(headerRow: (string | number | null | undefined)[]): number {
  const cells = headerRow.map((x) =>
    String(x ?? "")
      .trim()
      .toLowerCase()
  );
  for (let c = 0; c < cells.length; c++) {
    const h = cells[c]!;
    if (!h) continue;
    if (h === "id" || /\bid\s+товара\b/.test(h) || /\bтовара\s+id\b/.test(h)) return c;
    if (h.includes("product id") || /^product\s*id$/.test(h)) return c;
  }
  return 0;
}

/**
 * Excel/CSV/TXT: столбец с id товаров — по заголовку (Id товара, Product id, …) или первый столбец.
 * Лист Excel: предпочтительно «Новинки», иначе первый лист.
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
    const preferred = wb.SheetNames.includes("Новинки") ? "Новинки" : wb.SheetNames[0];
    if (!preferred) return [];
    const sheet = wb.Sheets[preferred];
    if (!sheet) return [];
    const rows = XLSX.utils.sheet_to_json<(string | number | null | undefined)[]>(
      sheet,
      { header: 1, defval: null, raw: false }
    );
    if (!rows.length) return [];

    let dataStart = 0;
    let colIdx = 0;
    const r0 = rows[0];
    const firstLooksLikeId =
      r0?.[0] != null &&
      r0[0] !== "" &&
      (() => {
        const raw = r0[0];
        const n =
          typeof raw === "number"
            ? raw
            : Number(String(raw).trim().replace(/\s/g, ""));
        return Number.isFinite(n) && n >= 1;
      })();

    if (firstLooksLikeId) {
      colIdx = 0;
      dataStart = 0;
    } else {
      colIdx = findProductIdColumnIndex(r0 ?? []);
      dataStart = 1;
    }

    for (let i = dataStart; i < rows.length; i++) {
      const row = rows[i];
      if (!row || !row.length) continue;
      pushNum(row[colIdx], seen, out);
      if (out.length >= 50_000) break;
    }
    return out;
  }
  return parseExcludeProductIdsFromText(await file.text());
}

function findVariationIdColumnIndex(headerRow: (string | number | null | undefined)[]): number {
  const cells = headerRow.map((x) =>
    String(x ?? "")
      .trim()
      .toLowerCase()
  );
  for (let c = 0; c < cells.length; c++) {
    const h = cells[c]!;
    if (!h) continue;
    if (h.includes("variation") && h.includes("id")) return c;
    if (/артикул/.test(h) && /sku|товар/.test(h)) return c;
    if (h === "sku" || h.includes("артикул товара")) return c;
    if (h.includes("id вариац")) return c;
  }
  return findProductIdColumnIndex(headerRow);
}

/** Excel/CSV/TXT: id вариации (SKU) — по заголовку или первый столбец. */
export async function extractVariationIdsFromFile(file: File): Promise<number[]> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv") || name.endsWith(".txt")) {
    return parseVariationIdsFromTextBulk(await file.text());
  }
  if (name.endsWith(".xlsx") || name.endsWith(".xls") || name.endsWith(".xlsm")) {
    const XLSX = await import("xlsx");
    const data = await file.arrayBuffer();
    const wb = XLSX.read(data, { type: "array" });
    const preferred = wb.SheetNames.includes("Новинки") ? "Новинки" : wb.SheetNames[0];
    if (!preferred) return [];
    const sheet = wb.Sheets[preferred];
    if (!sheet) return [];
    const rows = XLSX.utils.sheet_to_json<(string | number | null | undefined)[]>(
      sheet,
      { header: 1, defval: null, raw: false }
    );
    if (!rows.length) return [];

    const seen = new Set<number>();
    const out: number[] = [];
    let dataStart = 0;
    let colIdx = 0;
    const r0 = rows[0];
    const firstLooksLikeId =
      r0?.[0] != null &&
      r0[0] !== "" &&
      (() => {
        const raw = r0[0];
        const n =
          typeof raw === "number"
            ? raw
            : Number(String(raw).trim().replace(/\D/g, ""));
        return Number.isFinite(n) && n >= 1;
      })();

    if (firstLooksLikeId) {
      colIdx = 0;
      dataStart = 0;
    } else {
      colIdx = findVariationIdColumnIndex(r0 ?? []);
      dataStart = 1;
    }

    for (let i = dataStart; i < rows.length; i++) {
      const row = rows[i];
      if (!row || !row.length) continue;
      const raw = row[colIdx];
      if (raw == null || raw === "") continue;
      const digits = String(raw).trim().replace(/\D/g, "");
      if (!digits) continue;
      const n = Number(digits);
      if (!Number.isFinite(n) || n < 1) continue;
      const id = Math.floor(n);
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
      if (out.length >= 50_000) break;
    }
    return out;
  }
  return parseVariationIdsFromTextBulk(await file.text());
}
