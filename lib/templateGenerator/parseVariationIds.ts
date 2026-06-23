/** Извлечь variation_id из текста: строки, запятые, пробелы, точки с запятой */
export function parseVariationIdsFromText(text: string, max = 50): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  const chunks = text.split(/[\s,;]+/);
  for (const chunk of chunks) {
    const t = chunk.trim().replace(/^[Vv#]/, "");
    if (!/^\d+$/.test(t)) continue;
    const n = Number(t);
    if (n <= 0 || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
    if (out.length >= max) break;
  }
  return out;
}

export function parseVariationIdsFromList(raw: unknown, max = 50): number[] {
  if (!Array.isArray(raw)) return [];
  const out: number[] = [];
  const seen = new Set<number>();
  for (const item of raw) {
    const n = typeof item === "number" ? item : Number(String(item).replace(/\D/g, ""));
    if (!Number.isFinite(n) || n <= 0 || seen.has(n)) continue;
    seen.add(n);
    out.push(Math.trunc(n));
    if (out.length >= max) break;
  }
  return out;
}

export function normVariationSku(sku: string): number | null {
  const digits = String(sku ?? "").replace(/\D/g, "");
  if (!digits) return null;
  const n = Number(digits);
  return n > 0 ? n : null;
}

const MAX_VARIATION_IDS_BULK = 50_000;

/** Как parseVariationIdsFromText, но для больших списков (сравнение каталогов). */
export function parseVariationIdsFromTextBulk(text: string): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  for (const part of text.split(/[\n\r,;|\t]+/u)) {
    const t = part.trim().replace(/^[Vv#]/, "");
    if (!t) continue;
    const digits = t.replace(/\D/g, "");
    if (!digits) continue;
    const n = Number(digits);
    if (!Number.isFinite(n) || n < 1) continue;
    const id = Math.floor(n);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= MAX_VARIATION_IDS_BULK) break;
  }
  return out;
}
