import { fetchLetualVariations } from "@/lib/letualMetabase";
import { metabaseIsConfigured } from "@/lib/letualMetabaseConfig";

export type MetabaseProductRow = {
  variationId: number;
  productName: string;
  brandName: string;
  imageUrls: string[];
};

function parseVariationId(sku: string): number | null {
  const digits = String(sku ?? "").replace(/\D/g, "");
  if (!digits) return null;
  const id = Number(digits);
  return id > 0 ? id : null;
}

/** Все foto вариации из Metabase (4Partners DB) по SKU = variation_id */
export async function fetchMetabaseProductBySku(
  sku: string,
  metabaseApiKey?: string
): Promise<MetabaseProductRow | null> {
  if (!metabaseIsConfigured(metabaseApiKey)) return null;
  const id = parseVariationId(sku);
  if (!id) return null;

  const rows = await fetchLetualVariations([id], metabaseApiKey);
  const row = rows[0];
  if (!row) return null;

  return {
    variationId: row.variationId,
    productName: row.productName,
    brandName: row.brandName,
    imageUrls: row.imageUrls
  };
}

/** Lifestyle / крупные кадры — приоритет для композита */
export function sortImagesForComposite(urls: string[]): string[] {
  const score = (u: string): number => {
    const l = u.toLowerCase();
    let s = 0;
    if (/large2x|large\//.test(l)) s += 40;
    if (/webp|jpg|jpeg/.test(l)) s += 5;
    if (/4stand|cdnru/.test(l)) s += 10;
    if (/pack|white|_w\./.test(l)) s -= 15;
    return s;
  };
  return [...urls].sort((a, b) => score(b) - score(a));
}

export function metabaseProductIsConfigured(): boolean {
  return metabaseIsConfigured();
}
