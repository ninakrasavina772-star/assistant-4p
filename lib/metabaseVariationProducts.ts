import { fetchLetualVariations, type LetualVariationRow } from "@/lib/letualMetabase";
import type { FpProduct } from "@/lib/types";

const METABASE_VARIATION_BATCH = 150;

/** Одна вариация из Metabase → карточка для findIntraSiteDuplicates (id = variation_id). */
export function fpProductFromLetualVariation(row: LetualVariationRow): FpProduct {
  const images =
    row.imageUrls.length > 0
      ? row.imageUrls
      : row.mainImageUrl
        ? [row.mainImageUrl]
        : [];
  const sku = String(row.variationId);
  return {
    id: row.variationId,
    name: row.productName,
    link: "",
    brand: { name: row.brandName },
    article: sku,
    code: sku,
    vendor_code: sku,
    ...(row.ean ? { eans: [row.ean] } : {}),
    product_variation: {
      [sku]: {
        id: row.variationId,
        ...(row.ean ? { ean: row.ean } : {}),
        ...(images.length ? { images } : {})
      }
    }
  };
}

/** Загрузка товаров по списку variation_id только из Metabase (пакетами). */
export async function fetchFpProductsByVariationIdsFromMetabase(
  requestedIds: number[]
): Promise<{ products: FpProduct[]; missingInMetabase: number }> {
  const unique = [...new Set(requestedIds.filter((id) => id > 0))];
  const byVarId = new Map<number, FpProduct>();

  for (let i = 0; i < unique.length; i += METABASE_VARIATION_BATCH) {
    const chunk = unique.slice(i, i + METABASE_VARIATION_BATCH);
    const rows = await fetchLetualVariations(chunk);
    for (const row of rows) {
      byVarId.set(row.variationId, fpProductFromLetualVariation(row));
    }
  }

  const products: FpProduct[] = [];
  const seen = new Set<number>();
  for (const id of requestedIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const p = byVarId.get(id);
    if (p) products.push(p);
  }

  const missingInMetabase = unique.filter((id) => !byVarId.has(id)).length;
  return { products, missingInMetabase };
}
