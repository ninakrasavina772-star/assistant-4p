import { productBrandName } from "./brand-filter";
import { computeIntraSoftDupTiers, namePhotoMatchingAllowed } from "./dupTiers";
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
  /** Полное совпадение нормализованного названия (все карточки рубрики, как EAN) */
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
};

function normExactNameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

class UnionFind {
  private parent = new Map<number, number>();

  ensure(id: number): void {
    if (!this.parent.has(id)) this.parent.set(id, id);
  }

  find(id: number): number {
    this.ensure(id);
    let r = this.parent.get(id)!;
    while (r !== this.parent.get(r)) {
      r = this.parent.get(r)!;
    }
    let x = id;
    while (x !== r) {
      const next = this.parent.get(x)!;
      this.parent.set(x, r);
      x = next;
    }
    return r;
  }

  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

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

/**
 * Одно название — несколько id, только если по правилам EAN можно сопоставлять по имени
 * (нет EAN у обоих или EAN только у одной карточки в паре).
 */
function buildExactNameGroups(
  products: FpProduct[],
  nameLocale: NameLocale,
  idToP: Map<number, FpProduct>
): IntraNameGroupRow[] {
  const nameToIds = new Map<string, number[]>();
  for (const p of products) {
    const c = toCompareProduct(p);
    const key = normExactNameKey(pickComparableName(c, nameLocale));
    if (!key) continue;
    if (!nameToIds.has(key)) nameToIds.set(key, []);
    nameToIds.get(key)!.push(p.id);
  }

  const groups: IntraNameGroupRow[] = [];
  for (const [name, idList] of nameToIds) {
    if (idList.length < 2) continue;

    const uf = new UnionFind();
    for (const id of idList) uf.ensure(id);
    for (let i = 0; i < idList.length; i++) {
      const cI = toCompareProduct(idToP.get(idList[i]!)!);
      for (let j = i + 1; j < idList.length; j++) {
        const cJ = toCompareProduct(idToP.get(idList[j]!)!);
        if (namePhotoMatchingAllowed(cI, cJ)) uf.union(idList[i]!, idList[j]!);
      }
    }

    const rootToIds = new Map<number, Set<number>>();
    for (const id of idList) {
      const r = uf.find(id);
      if (!rootToIds.has(r)) rootToIds.set(r, new Set());
      rootToIds.get(r)!.add(id);
    }

    for (const clusterIds of rootToIds.values()) {
      if (clusterIds.size < 2) continue;
      groups.push({
        name,
        products: [...clusterIds]
          .sort((a, b) => a - b)
          .map((id) => toCompareProduct(idToP.get(id)!))
          .filter(Boolean)
      });
    }
  }

  groups.sort((a, b) => {
    const d = b.products.length - a.products.length;
    if (d !== 0) return d;
    return a.name.localeCompare(b.name, "ru");
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
 * EAN и точное название — по всем переданным товарам (уже с учётом фильтров пайплайна).
 * Мягкие слои (~90% / ~60%) — только если у пары нет двух разных EAN; иначе только блок «По EAN».
 */
export async function findIntraSiteDuplicates(
  products: FpProduct[],
  nameLocale: NameLocale,
  attrOpts?: AttrMatchOptions
): Promise<IntraSiteDupResult> {
  const idToP = new Map<number, FpProduct>();
  for (const p of products) idToP.set(p.id, p);

  const eanGroups = buildEanClusters(products, idToP);
  const nameGroups = buildExactNameGroups(products, nameLocale, idToP);

  const usedInExactDup = new Set<number>();
  for (const g of eanGroups) for (const c of g.products) usedInExactDup.add(c.id);
  for (const g of nameGroups) for (const c of g.products) usedInExactDup.add(c.id);

  const byFuzzyBrand = new Map<string, FpProduct[]>();
  for (const p of products) {
    const k = brandFuzzyGroupKey(p);
    if (!byFuzzyBrand.has(k)) byFuzzyBrand.set(k, []);
    byFuzzyBrand.get(k)!.push(p);
  }

  const soft = await computeIntraSoftDupTiers(
    byFuzzyBrand,
    usedInExactDup,
    nameLocale,
    attrOpts
  );

  return {
    eanGroups,
    eanGroupsSummary: summarizeIntraEanGroups(eanGroups),
    nameGroups,
    nameGroupsSummary: summarizeIntraNameGroups(nameGroups),
    namePhotoPairs: soft.namePhotoPairs,
    brandVisualPairs: soft.brandVisualPairs,
    unlikelyPairs: soft.unlikelyPairs
  };
}
