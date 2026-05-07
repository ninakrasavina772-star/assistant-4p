import { collectEans } from "./product";
import type { FpProduct } from "./types";

/**
 * В Partner Site API у ProductVariation поле quantity — «Active offer quantity».
 * Отсекаем варианты без активного оффера (0 или null). Если quantity нет в JSON —
 * считаем вариант активным (старые/укороченные ответы), чтобы не выкидывать каталог целиком.
 */
export function variationHasActiveOffer(v: unknown): boolean {
  if (!v || typeof v !== "object") return false;
  const q = (v as { quantity?: number | null }).quantity;
  if (q === null) return false;
  if (typeof q === "number") return q > 0;
  return true;
}

export function filterFpProductKeepActiveOfferVariations(p: FpProduct): FpProduct | null {
  const pv = p.product_variation;
  if (!pv || Object.keys(pv).length === 0) return p;

  const next: NonNullable<FpProduct["product_variation"]> = {};
  for (const [k, v] of Object.entries(pv)) {
    if (variationHasActiveOffer(v)) next[k] = v;
  }
  if (Object.keys(next).length === 0) return null;

  const trimmed: FpProduct = {
    ...p,
    product_variation: next,
    eans: [],
  };
  const eans = collectEans(trimmed);
  return {
    ...trimmed,
    ...(eans.length ? { eans } : { eans: undefined }),
  };
}

export function filterFpProductsActiveOffers(products: FpProduct[]): FpProduct[] {
  const out: FpProduct[] = [];
  for (const p of products) {
    const q = filterFpProductKeepActiveOfferVariations(p);
    if (q) out.push(q);
  }
  return out;
}
