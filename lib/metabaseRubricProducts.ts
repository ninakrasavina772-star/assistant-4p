import {
  applyRubricFetchPipeline,
  type RubricFetchPipeline
} from "@/lib/fourpartners";
import {
  fetchLetualProducts,
  fetchProductIdsByRubricIds,
  type LetualProductRow
} from "@/lib/letualMetabase";
import type { FpProduct } from "@/lib/types";

function fpProductFromLetualProduct(row: LetualProductRow): FpProduct {
  const images =
    row.imageUrls.length > 0
      ? row.imageUrls
      : row.mainImageUrl
        ? [row.mainImageUrl]
        : [];
  const pid = row.productId;
  const sku = String(row.variationId);
  return {
    id: pid,
    name: row.productName,
    link: `https://catalog.local/product-a${pid}`,
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

function filterExcluded(products: FpProduct[], exclude?: Set<number>): FpProduct[] {
  if (!exclude?.size) return products;
  return products.filter((p) => !exclude.has(p.id));
}

export type MetabaseRubricFetchResult = {
  products: FpProduct[];
  totalInRubrics: number;
  brandExcludedMissing: number;
  brandExcludedNotInList: number;
  modelExcludedNotInList: number;
  excludeRemoved: number;
};

/** Каталог рубрики из Metabase (без Partner API) */
export async function fetchFpProductsByRubricIdsFromMetabase(
  rubricIds: number[],
  pipe: RubricFetchPipeline,
  leg: "A" | "B",
  metabaseApiKey?: string,
  batchLimit?: number
): Promise<MetabaseRubricFetchResult> {
  const allIds = await fetchProductIdsByRubricIds(rubricIds, metabaseApiKey);
  const totalInRubrics = allIds.length;

  let idList = allIds;
  if (pipe.excludeIds?.size) {
    idList = idList.filter((id) => !pipe.excludeIds!.has(id));
  }
  idList.sort((a, b) => a - b);
  const limit =
    typeof batchLimit === "number" && batchLimit > 0
      ? Math.min(Math.floor(batchLimit), idList.length)
      : idList.length;
  const sliceIds = idList.slice(0, limit);

  const rows = await fetchLetualProducts(sliceIds, metabaseApiKey);
  const byId = new Map(rows.map((r) => [r.productId, r]));
  const products: FpProduct[] = [];
  for (const id of sliceIds) {
    const row = byId.get(id);
    if (row) products.push(fpProductFromLetualProduct(row));
  }

  const applied = applyRubricFetchPipeline(products, pipe, leg);
  const afterExclude = filterExcluded(applied.out, pipe.excludeIds);
  const excludeRemoved =
    (leg === "A" ? applied.excludeRemovedFromA : 0) +
    (products.length - afterExclude.length);

  return {
    products: afterExclude,
    totalInRubrics,
    brandExcludedMissing: applied.brandExcludedMissing,
    brandExcludedNotInList: applied.brandExcludedNotInList,
    modelExcludedNotInList: applied.modelExcludedNotInList,
    excludeRemoved
  };
}
