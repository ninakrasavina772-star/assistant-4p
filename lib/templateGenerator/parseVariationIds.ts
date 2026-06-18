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
