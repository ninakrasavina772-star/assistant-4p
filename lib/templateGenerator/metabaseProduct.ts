import { fetchLetualVariations } from "@/lib/letualMetabase";
import { metabaseIsConfigured } from "@/lib/letualMetabaseConfig";
import { fetchYandexMarketPrices } from "@/lib/templateGenerator/yandexMarketPrices";

export type MetabaseProductRow = {
  variationId: number;
  productName: string;
  brandName: string;
  ean: string | null;
  mainImageUrl: string | null;
  imageUrls: string[];
  priceUsd?: number | null;
  priceCurrency?: string | null;
};

function parseVariationId(sku: string): number | null {
  const digits = String(sku ?? "").replace(/\D/g, "");
  if (!digits) return null;
  const id = Number(digits);
  return id > 0 ? id : null;
}

function attachPrices(
  products: MetabaseProductRow[],
  prices: Map<number, { price: number; currency: string }>
): MetabaseProductRow[] {
  return products.map((p) => {
    const row = prices.get(p.variationId);
    if (!row) return p;
    return {
      ...p,
      priceUsd: row.price,
      priceCurrency: row.currency
    };
  });
}

/** Все foto вариации из Metabase (4Partners DB) по SKU = variation_id */
export async function fetchMetabaseProductBySku(
  sku: string,
  metabaseApiKey?: string,
  opts?: { includeYandexPrices?: boolean }
): Promise<MetabaseProductRow | null> {
  if (!metabaseIsConfigured(metabaseApiKey)) return null;
  const id = parseVariationId(sku);
  if (!id) return null;

  const rows = await fetchLetualVariations([id], metabaseApiKey);
  const row = rows[0];
  if (!row) return null;

  let product: MetabaseProductRow = {
    variationId: row.variationId,
    productName: row.productName,
    brandName: row.brandName,
    ean: row.ean ? String(row.ean).trim() : null,
    mainImageUrl: row.mainImageUrl,
    imageUrls: row.imageUrls
  };

  if (opts?.includeYandexPrices) {
    const prices = await fetchYandexMarketPrices([id], metabaseApiKey);
    [product] = attachPrices([product], prices);
  }

  return product;
}

/** Lifestyle / вторичные кадры — приоритет для композита */
export function sortImagesForComposite(urls: string[]): string[] {
  const score = (u: string): number => {
    const l = u.toLowerCase();
    let s = 0;
    if (/cdnru\.4stand|api\.4stand\.com\/uploads/.test(l)) s += 2000;
    if (/\/huge\//.test(l)) s += 1200;
    if (/multimedia-1-f\//.test(l)) s += 900;
    if (/large2x|large\//.test(l)) s += 40;
    if (/webp|jpg|jpeg/.test(l)) s += 5;
    if (/lyko\.com|douglas\.|bigbuy|makeupstore|notino|goldapple|cdnbigbuy/.test(l)) s -= 1500;
    if (/pack|white|_w\./.test(l)) s -= 15;
    return s;
  };
  return [...urls].sort((a, b) => score(b) - score(a));
}

export function metabaseProductIsConfigured(): boolean {
  return metabaseIsConfigured();
}

/** Пакетная загрузка товаров по variation_id */
export async function fetchMetabaseProductsByIds(
  ids: number[],
  metabaseApiKey?: string,
  opts?: { includeYandexPrices?: boolean }
): Promise<MetabaseProductRow[]> {
  if (!ids.length) return [];
  const unique = [...new Set(ids.filter((id) => id > 0))];
  const rows = await fetchLetualVariations(unique, metabaseApiKey);
  const byId = new Map(
    rows.map((r) => [
      r.variationId,
      {
        variationId: r.variationId,
        productName: r.productName,
        brandName: r.brandName,
        ean: r.ean ? String(r.ean).trim() : null,
        mainImageUrl: r.mainImageUrl,
        imageUrls: r.imageUrls
      } satisfies MetabaseProductRow
    ])
  );
  let products = unique.map((id) => byId.get(id)).filter((x): x is MetabaseProductRow => Boolean(x));

  if (opts?.includeYandexPrices && products.length) {
    const prices = await fetchYandexMarketPrices(
      products.map((p) => p.variationId),
      metabaseApiKey
    );
    products = attachPrices(products, prices);
  }

  return products;
}
