import { productBrandName } from "./brand-filter";
import {
  computeIntraNameTabDupPairs,
  computeIntraSoftDupTiers,
  type NameTabStats
} from "./dupTiers";
import {
  collectEanIndexKeys,
  pickComparableName,
  toCompareProduct
} from "./product";
import { normBrand } from "./pairScoring";
import type {
  AttrMatchOptions,
  CompareProduct,
  EanGroupsSummary,
  FpProduct,
  IntraEanGroupRow,
  IntraNameGroupRow,
  NameLocale
} from "./types";

export function summarizeIntraEanGroups(
  eanGroups: { products: { id: number }[] }[]
): EanGroupsSummary {
  const ids = new Set<number>();
  let rowSlotsInGroups = 0;
  for (const g of eanGroups) {
    rowSlotsInGroups += g.products.length;
    for (const c of g.products) ids.add(c.id);
  }
  return {
    groupCount: eanGroups.length,
    uniqueProductCount: ids.size,
    rowSlotsInGroups
  };
}

export const summarizeIntraNameGroups = summarizeIntraEanGroups;

export type IntraSiteDupResult = {
  eanGroups: IntraEanGroupRow[];
  eanGroupsSummary: EanGroupsSummary;
  /** Зарезервировано; вкладка «по названию» = namePhotoPairs по бренду/модели/объёму/фото */
  nameGroups: IntraNameGroupRow[];
  nameGroupsSummary: EanGroupsSummary;
  namePhotoPairs: {
    a: CompareProduct;
    b: CompareProduct;
    score: number;
    matchReasons: string[];
  }[];
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
  /** Диагностика вкладки «по названию» */
  nameTabStats?: NameTabStats;
};

/**
 * Одна группа = один нормализованный EAN и все id, у которых он есть.
 * Не склеиваем разные EAN транзитивно (иначе карточка с несколькими SKU/EAN
 * из фида тянет в одну группу товары с разными штрихкодами).
 */
function buildEanClusters(
  products: FpProduct[],
  idToP: Map<number, FpProduct>
): IntraEanGroupRow[] {
  const keyToIds = new Map<string, Set<number>>();
  for (const p of products) {
    for (const key of collectEanIndexKeys(p)) {
      if (!keyToIds.has(key)) keyToIds.set(key, new Set());
      keyToIds.get(key)!.add(p.id);
    }
  }

  const groups: IntraEanGroupRow[] = [];
  for (const [ean, ids] of keyToIds) {
    if (ids.size < 2) continue;
    groups.push({
      ean,
      products: [...ids]
        .sort((a, b) => a - b)
        .map((id) => toCompareProduct(idToP.get(id)!))
        .filter(Boolean)
    });
  }

  groups.sort((a, b) => {
    const d = b.products.length - a.products.length;
    if (d !== 0) return d;
    return a.ean.localeCompare(b.ean, "ru");
  });
  return groups;
}

/** Как sameBrandForFuzzy: пара возможна только внутри одного нормализованного бренда или оба без бренда. */
function brandFuzzyGroupKey(p: FpProduct): string {
  const n = normBrand(productBrandName(p));
  return n || "__empty_brand__";
}

/**
 * Дубли в одной выгрузке (один сайт, одна рубрика).
 * EAN — только по штрихкоду. «По названию» — бренд + модель + объём + фото (названия из API i18n);
 * карточки из EAN-групп во вкладку по названию не попадают.
 */
export async function findIntraSiteDuplicates(
  products: FpProduct[],
  nameLocale: NameLocale,
  attrOpts?: AttrMatchOptions
): Promise<IntraSiteDupResult> {
  const idToP = new Map<number, FpProduct>();
  for (const p of products) idToP.set(p.id, p);

  const eanGroups = buildEanClusters(products, idToP);

  const excludedFromEanTab = new Set<number>();
  for (const g of eanGroups) {
    for (const c of g.products) excludedFromEanTab.add(c.id);
  }

  const byFuzzyBrand = new Map<string, FpProduct[]>();
  for (const p of products) {
    const k = brandFuzzyGroupKey(p);
    if (!byFuzzyBrand.has(k)) byFuzzyBrand.set(k, []);
    byFuzzyBrand.get(k)!.push(p);
  }

  const { rows: namePhotoPairs, stats: nameTabStats } =
    await computeIntraNameTabDupPairs(byFuzzyBrand, excludedFromEanTab, nameLocale);

  const soft = await computeIntraSoftDupTiers(
    byFuzzyBrand,
    excludedFromEanTab,
    nameLocale,
    attrOpts
  );

  return {
    eanGroups,
    eanGroupsSummary: summarizeIntraEanGroups(eanGroups),
    nameGroups: [],
    nameGroupsSummary: {
      groupCount: 0,
      uniqueProductCount: 0,
      rowSlotsInGroups: 0
    },
    namePhotoPairs,
    brandVisualPairs: [],
    unlikelyPairs: soft.unlikelyPairs,
    nameTabStats
  };
}
