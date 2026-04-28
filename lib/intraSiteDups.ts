import { collectEans, toCompareProduct } from "./product";
import {
  PAIR_MIN,
  normBrand,
  scoreNameAndPhoto,
  scoreUnlikelyPhotoAndModel
} from "./pairScoring";
import type {
  AttrMatchOptions,
  CompareProduct,
  FpProduct,
  NameLocale
} from "./types";

export type IntraSiteDupResult = {
  eanGroups: { ean: string; products: CompareProduct[] }[];
  namePhotoPairs: { a: CompareProduct; b: CompareProduct; score: number; matchReasons: string[] }[];
  unlikelyPairs: { a: CompareProduct; b: CompareProduct; score: number; matchReasons: string[] }[];
};

/** Как sameBrandForFuzzy: пара возможна только внутри одного нормализованного бренда или оба без бренда. */
function brandFuzzyGroupKey(p: FpProduct): string {
  const n = normBrand(p.brand?.name || "");
  return n || "__empty_brand__";
}

/**
 * Дубли в одной выгрузке (один сайт, одна рубрика): 2 «колонки» = две карточки в строке.
 */
export function findIntraSiteDuplicates(
  products: FpProduct[],
  nameLocale: NameLocale,
  attrOpts?: AttrMatchOptions
): IntraSiteDupResult {
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
  const eanGroups: { ean: string; products: CompareProduct[] }[] = [];
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

  type Cand = { pa: FpProduct; pb: FpProduct; sc: number; re: string[] };
  const cands: Cand[] = [];
  for (const [, list] of byFuzzyBrand) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const pi = list[i]!;
        const pj = list[j]!;
        const cI = toCompareProduct(pi);
        const cJ = toCompareProduct(pj);
        const { score, reasons } = scoreNameAndPhoto(
          cI,
          cJ,
          nameLocale,
          attrOpts
        );
        if (score < PAIR_MIN || !reasons.length) continue;
        cands.push({ pa: pi, pb: pj, sc: score, re: reasons });
      }
    }
  }
  cands.sort((a, b) => b.sc - a.sc);
  const used = new Set(usedInEan);
  const namePhotoPairs: IntraSiteDupResult["namePhotoPairs"] = [];
  for (const c of cands) {
    const I = c.pa.id;
    const J = c.pb.id;
    if (used.has(I) || used.has(J)) continue;
    used.add(I);
    used.add(J);
    namePhotoPairs.push({
      a: toCompareProduct(c.pa),
      b: toCompareProduct(c.pb),
      score: c.sc,
      matchReasons: c.re
    });
  }
  const usedUn = new Set(used);
  type UC = { pa: FpProduct; pb: FpProduct; sc: number; re: string[] };
  const unc: UC[] = [];
  for (const [, list] of byFuzzyBrand) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const pi = list[i]!;
        const pj = list[j]!;
        const cI = toCompareProduct(pi);
        const cJ = toCompareProduct(pj);
        const { score, reasons } = scoreUnlikelyPhotoAndModel(
          cI,
          cJ,
          nameLocale,
          attrOpts
        );
        if (score < PAIR_MIN || !reasons.length) continue;
        unc.push({ pa: pi, pb: pj, sc: score, re: reasons });
      }
    }
  }
  unc.sort((a, b) => b.sc - a.sc);
  const unlikelyPairs: IntraSiteDupResult["unlikelyPairs"] = [];
  for (const c of unc) {
    const I = c.pa.id;
    const J = c.pb.id;
    if (usedUn.has(I) || usedUn.has(J)) continue;
    usedUn.add(I);
    usedUn.add(J);
    unlikelyPairs.push({
      a: toCompareProduct(c.pa),
      b: toCompareProduct(c.pb),
      score: c.sc,
      matchReasons: c.re
    });
  }
  return { eanGroups, namePhotoPairs, unlikelyPairs };
}
