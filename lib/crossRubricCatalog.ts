import { collectProductVariations } from "./productVariations";
import type { CrossRubricVariationCatalog, FpProduct, OnlyACrossWithBRow, OnlyBCrossWithARow } from "./types";

export function buildCrossRubricVariationCatalog(
  productsA: FpProduct[],
  productsB: FpProduct[],
  rowsBvsA: OnlyBCrossWithARow[],
  rowsAvsB: OnlyACrossWithBRow[] = []
): CrossRubricVariationCatalog {
  const idsA = new Set<number>();
  const idsB = new Set<number>();
  for (const r of rowsBvsA) {
    idsA.add(r.productOnA.id);
    idsB.add(r.productFromOnlyB.id);
  }
  for (const r of rowsAvsB) {
    idsA.add(r.productFromOnlyA.id);
    idsB.add(r.productOnB.id);
  }

  const a: CrossRubricVariationCatalog["a"] = {};
  const b: CrossRubricVariationCatalog["b"] = {};

  for (const p of productsA) {
    if (!idsA.has(p.id)) continue;
    a[p.id] = collectProductVariations(p);
  }
  for (const p of productsB) {
    if (!idsB.has(p.id)) continue;
    b[p.id] = collectProductVariations(p);
  }

  return { a, b };
}
