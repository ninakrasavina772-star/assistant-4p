import type { FpProduct } from "./types";

const MAX_EXCLUDE_IDS = 50_000;

/**
 * Текст: id в столбик или через запятую/точку с запятой.
 */
export function parseExcludeProductIdsFromText(text: string): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const part of text.split(/[\n\r,;|\t]+/u)) {
    const t = part.trim();
    if (!t) continue;
    const n = Number(String(t).replace(/\s/g, ""));
    if (!Number.isFinite(n) || n < 1 || n > Number.MAX_SAFE_INTEGER) continue;
    const id = Math.floor(n);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= MAX_EXCLUDE_IDS) break;
  }
  return out;
}

/** Тело POST: массив чисел или строк, приводимых к id */
export function parseExcludeIdsFromRequest(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<number>();
  const out: number[] = [];
  for (const x of raw) {
    const n =
      typeof x === "number" ? x : typeof x === "string" ? Number(x.trim()) : NaN;
    if (!Number.isFinite(n) || n < 1) continue;
    const id = Math.floor(n);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= MAX_EXCLUDE_IDS) break;
  }
  return out;
}

export type ExcludeIdsResult = {
  products: FpProduct[];
  /** Сколько позиций убрали из A (id был и в рубрике, и в списке) */
  removedFromA: number;
  /** Сколько уникальных id из списка не встретилось в выгруженной рубрике A */
  listIdsNotFoundInRubric: number;
};

/**
 * Убираем из каталога A товары, чей id в списке исключений.
 */
export function filterSiteAByExcludedProductIds(
  productsA: FpProduct[],
  excludeIds: number[]
): ExcludeIdsResult {
  if (excludeIds.length === 0) {
    return {
      products: productsA,
      removedFromA: 0,
      listIdsNotFoundInRubric: 0
    };
  }
  const excludeSet = new Set(excludeIds);
  const catalogIds = new Set(productsA.map((p) => p.id));
  let notFound = 0;
  for (const id of excludeSet) {
    if (!catalogIds.has(id)) {
      notFound += 1;
    }
  }
  const products = productsA.filter((p) => !excludeSet.has(p.id));
  const removedFromA = productsA.length - products.length;
  return {
    products,
    removedFromA,
    listIdsNotFoundInRubric: notFound
  };
}
