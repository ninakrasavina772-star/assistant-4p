import type { FpProduct } from "./types";

const MAX_BRANDS = 2000;
const MAX_BRAND_LEN = 200;

export function normalizeBrandName(s: string): string {
  return s
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[\u00A0]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Список из поля, разделители: перенос строки, запятая, точка с запятой.
 */
export function parseBrandListFromText(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const parts = text.split(/[\n\r\t,;|]+/u);
  for (const raw of parts) {
    const t = raw.trim();
    if (!t) continue;
    if (t.length > MAX_BRAND_LEN) continue;
    const n = normalizeBrandName(t);
    if (!n) continue;
    if (seen.has(n)) continue;
    if (out.length >= MAX_BRANDS) break;
    seen.add(n);
    out.push(t);
  }
  return out;
}

/** Несколько источников (текст + файл) — одна нормализованная таблица без дублей */
export function mergeBrandLists(...lists: string[][]): string[] {
  const text = lists
    .flat()
    .map((s) => s.trim())
    .filter(Boolean)
    .join("\n");
  return parseBrandListFromText(text);
}

/** Строка бренда из произвольного фрагмента JSON (name / title / label). */
function pickBrandString(x: unknown): string {
  if (x == null) return "";
  if (typeof x === "string") return x.trim();
  if (typeof x === "object") {
    const o = x as Record<string, unknown>;
    for (const k of ["name", "title", "label"]) {
      const v = o[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  }
  return "";
}

/**
 * Единая точка: бренд из /product/list (разные формы у 4Partners и витрин).
 */
export function productBrandName(p: FpProduct): string {
  return (
    pickBrandString(p.brand_name) ||
    pickBrandString(p.brand) ||
    pickBrandString(p.manufacturer) ||
    pickBrandString(p.vendor) ||
    ""
  );
}

export type BrandMatchMode = "exact" | "contains";

/**
 * true, если product brand в allowlist: точное сравнение нормализованных строк.
 */
function brandMatchesExact(productBrand: string, listNorm: Set<string>): boolean {
  const pn = normalizeBrandName(productBrand);
  if (!pn) return false;
  return listNorm.has(pn);
}

/**
 * Вхождение: у каждого токена из списка (после normalize) — проверяем,
 * встречается ли он в нормализованном бренде товара. Точное совпадение тоже срабатывает.
 */
function brandMatchesContains(
  productBrand: string,
  listNormStrings: string[]
): boolean {
  const pn = normalizeBrandName(productBrand);
  if (!pn) return false;
  for (const t of listNormStrings) {
    if (!t) continue;
    if (pn === t || pn.includes(t) || t.includes(pn)) return true;
  }
  return false;
}

export type BrandFilterResult = {
  products: FpProduct[];
  excludedMissingBrand: number;
  excludedNotInList: number;
};

/**
 * Пустой allowlist = не фильтруем. Иначе оставляем товары по бренду:
 * `exact` — brand.name (норм.) = одной из строк; `contains` — строка — подстрока
 * (или наоборот, если вручную ввели длинное имя, а в API короче).
 * Без бренда в API — товар отбрасывается.
 */
export function filterFpProductsByBrands(
  products: FpProduct[],
  brandLabels: string[],
  matchMode: BrandMatchMode = "exact"
): BrandFilterResult {
  if (brandLabels.length === 0) {
    return {
      products: [...products],
      excludedMissingBrand: 0,
      excludedNotInList: 0
    };
  }
  const listNorm = brandLabels
    .map((b) => normalizeBrandName(b))
    .filter((s) => s.length > 0);
  const listSet = new Set(listNorm);
  let excludedMissingBrand = 0;
  let excludedNotInList = 0;
  const out: FpProduct[] = [];
  for (const p of products) {
    const bn = productBrandName(p);
    if (!bn) {
      excludedMissingBrand += 1;
      continue;
    }
    const ok =
      matchMode === "contains"
        ? brandMatchesContains(bn, listNorm)
        : brandMatchesExact(bn, listSet);
    if (ok) {
      out.push(p);
    } else {
      excludedNotInList += 1;
    }
  }
  return { products: out, excludedMissingBrand, excludedNotInList };
}
