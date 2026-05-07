import { productBrandName } from "./brand-filter";
import { computeIntraSoftDupTiers } from "./dupTiers";
import { collectEans, toCompareProduct } from "./product";
import { normBrand } from "./pairScoring";
import type {
  AttrMatchOptions,
  CompareProduct,
  FpProduct,
  NameLocale
} from "./types";

export type IntraSiteDupResult = {
  eanGroups: { ean: string; products: CompareProduct[] }[];
  /** ~90%: частичное название + эквивалентный URL фото */
  namePhotoPairs: {
    a: CompareProduct;
    b: CompareProduct;
    score: number;
    matchReasons: string[];
  }[];
  /** ~60%: точный бренд + частичное название + визуально похожее фото */
  brandVisualPairs: {
    a: CompareProduct;
    b: CompareProduct;
    score: number;
    matchReasons: string[];
  }[];
  unlikelyPairs: {
    a: CompareProduct;
    b: CompareProduct;
    score: number;
    matchReasons: string[];
  }[];
};

/** Как sameBrandForFuzzy: пара возможна только внутри одного нормализованного бренда или оба без бренда. */
function brandFuzzyGroupKey(p: FpProduct): string {
  const n = normBrand(productBrandName(p));
  return n || "__empty_brand__";
}

/**
 * Дубли в одной выгрузке (один сайт, одна рубрика): 2 «колонки» = две карточки в строке.
 * Уровни: EAN (100%) → 90% / 60% / маловероятные — см. dupTiers.
 */
export async function findIntraSiteDuplicates(
  products: FpProduct[],
  nameLocale: NameLocale,
  attrOpts?: AttrMatchOptions
): Promise<IntraSiteDupResult> {
  const eanToIds = new Map<string, Set<number>>();
  const idToP = new Map<number, FpProduct>();
  for (const p of products) {
    idToP.set(p.id, p);
    for (const e of collectEans(p)) {
      if (!e) continue;
      if (!eanToIds.has(e)) eanToIds.set(e, new Set());
      eanToIds.get(e)!.add(p.id);
    }
  }
  const eanGroups: IntraSiteDupResult["eanGroups"] = [];
  for (const [ean, ids] of eanToIds) {
    if (ids.size < 2) continue;
    eanGroups.push({
      ean,
      products: [...ids]
        .map((id) => toCompareProduct(idToP.get(id)!))
        .filter(Boolean)
    });
  }
  const usedInEan = new Set<number>();
  for (const g of eanGroups) for (const c of g.products) usedInEan.add(c.id);

  const byFuzzyBrand = new Map<string, FpProduct[]>();
  for (const p of products) {
    const k = brandFuzzyGroupKey(p);
    if (!byFuzzyBrand.has(k)) byFuzzyBrand.set(k, []);
    byFuzzyBrand.get(k)!.push(p);
  }

  const soft = await computeIntraSoftDupTiers(
    byFuzzyBrand,
    usedInEan,
    nameLocale,
    attrOpts
  );

  return {
    eanGroups,
    namePhotoPairs: soft.namePhotoPairs,
    brandVisualPairs: soft.brandVisualPairs,
    unlikelyPairs: soft.unlikelyPairs
  };
}
