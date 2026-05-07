import { productBrandName } from "./brand-filter";
import {
  classifyCrossSoftPair,
  combinedNameSimilarity,
  computeIntraSoftDupTiers,
  pairKeyIds,
  prefetchOnlyACrossPhashes,
  prefetchOnlyBCrossPhashes
} from "./dupTiers";
import { type PhashCache } from "./imagePhash";
import { collectArticleKeys, collectEans, toCompareProduct } from "./product";
import { normBrand, sameBrandForFuzzy } from "./pairScoring";
import type {
  AttrMatchOptions,
  FpProduct,
  NameLocale,
  OnlyACrossWithBRow,
  OnlyBCrossWithARow,
  OnlyBInternalDupRow
} from "./types";

function normBrandKeyStr(p: FpProduct): string {
  const n = normBrand(productBrandName(p));
  return n || "__no_brand__";
}

/**
 * «Только на B» сопоставить с полным каталогом A: EAN, артикул, затем уровни 90/60/маловероятные.
 */
export async function buildOnlyBCrossWithA(
  rawOnlyB: FpProduct[],
  allA: FpProduct[],
  nameLocale: NameLocale,
  attrOpts?: AttrMatchOptions
): Promise<OnlyBCrossWithARow[]> {
  const rows: OnlyBCrossWithARow[] = [];
  const eanToA = new Map<string, FpProduct[]>();
  const artToA = new Map<string, FpProduct[]>();
  const byBrandA = new Map<string, FpProduct[]>();
  for (const pA of allA) {
    const bk = normBrandKeyStr(pA);
    if (!byBrandA.has(bk)) byBrandA.set(bk, []);
    byBrandA.get(bk)!.push(pA);
    for (const e of collectEans(pA)) {
      if (!e) continue;
      if (!eanToA.has(e)) eanToA.set(e, []);
      eanToA.get(e)!.push(pA);
    }
    for (const art of collectArticleKeys(pA)) {
      if (!artToA.has(art)) artToA.set(art, []);
      artToA.get(art)!.push(pA);
    }
  }

  const phashCache: PhashCache = new Map();
  await prefetchOnlyBCrossPhashes(rawOnlyB, byBrandA, nameLocale, phashCache);

  for (const pB of rawOnlyB) {
    const cB = toCompareProduct(pB);
    const hitA = new Set<number>();
    for (const e of collectEans(pB)) {
      if (!e) continue;
      for (const pA of eanToA.get(e) || []) {
        if (pA.id === pB.id) continue;
        if (hitA.has(pA.id)) continue;
        hitA.add(pA.id);
        rows.push({
          kind: "ean_diff_id",
          productOnA: toCompareProduct(pA),
          productFromOnlyB: cB,
          ean: e
        });
      }
    }
    for (const art of collectArticleKeys(pB)) {
      for (const pA of artToA.get(art) || []) {
        if (pA.id === pB.id) continue;
        if (hitA.has(pA.id)) continue;
        hitA.add(pA.id);
        rows.push({
          kind: "article",
          productOnA: toCompareProduct(pA),
          productFromOnlyB: cB,
          article: art
        });
      }
    }
    const keyB = normBrandKeyStr(pB);
    const listA = (byBrandA.get(keyB) || []).filter(
      (pA) => pA.id !== pB.id && !hitA.has(pA.id)
    );
    const sorted = [...listA].sort(
      (a, b) =>
        combinedNameSimilarity(toCompareProduct(b), cB, nameLocale) -
        combinedNameSimilarity(toCompareProduct(a), cB, nameLocale)
    );
    for (const pA of sorted) {
      const cA = toCompareProduct(pA);
      if (!sameBrandForFuzzy(cA, cB)) continue;
      const r = await classifyCrossSoftPair(
        cA,
        cB,
        nameLocale,
        attrOpts,
        phashCache
      );
      if (!r) continue;
      hitA.add(pA.id);
      if (r.kind === "name_photo") {
        rows.push({
          kind: "name_photo",
          productOnA: cA,
          productFromOnlyB: cB,
          score: r.score,
          matchReasons: r.matchReasons
        });
      } else if (r.kind === "brand_visual") {
        rows.push({
          kind: "brand_visual",
          productOnA: cA,
          productFromOnlyB: cB,
          score: r.score,
          matchReasons: r.matchReasons
        });
      } else {
        rows.push({
          kind: "unlikely",
          productOnA: cA,
          productFromOnlyB: cB,
          score: r.score,
          matchReasons: r.matchReasons
        });
      }
    }
  }
  return rows;
}

/**
 * «Только на A» сопоставить с полным каталогом B (симметрично buildOnlyBCrossWithA).
 */
export async function buildOnlyACrossWithB(
  rawOnlyA: FpProduct[],
  allB: FpProduct[],
  nameLocale: NameLocale,
  attrOpts?: AttrMatchOptions
): Promise<OnlyACrossWithBRow[]> {
  const rows: OnlyACrossWithBRow[] = [];
  const eanToB = new Map<string, FpProduct[]>();
  const artToB = new Map<string, FpProduct[]>();
  const byBrandB = new Map<string, FpProduct[]>();
  for (const pB of allB) {
    const bk = normBrandKeyStr(pB);
    if (!byBrandB.has(bk)) byBrandB.set(bk, []);
    byBrandB.get(bk)!.push(pB);
    for (const e of collectEans(pB)) {
      if (!e) continue;
      if (!eanToB.has(e)) eanToB.set(e, []);
      eanToB.get(e)!.push(pB);
    }
    for (const art of collectArticleKeys(pB)) {
      if (!artToB.has(art)) artToB.set(art, []);
      artToB.get(art)!.push(pB);
    }
  }

  const phashCache: PhashCache = new Map();
  await prefetchOnlyACrossPhashes(rawOnlyA, byBrandB, nameLocale, phashCache);

  for (const pA of rawOnlyA) {
    const cA = toCompareProduct(pA);
    const hitB = new Set<number>();
    for (const e of collectEans(pA)) {
      if (!e) continue;
      for (const pB of eanToB.get(e) || []) {
        if (pA.id === pB.id) continue;
        if (hitB.has(pB.id)) continue;
        hitB.add(pB.id);
        rows.push({
          kind: "ean_diff_id",
          productOnB: toCompareProduct(pB),
          productFromOnlyA: cA,
          ean: e
        });
      }
    }
    for (const art of collectArticleKeys(pA)) {
      for (const pB of artToB.get(art) || []) {
        if (pA.id === pB.id) continue;
        if (hitB.has(pB.id)) continue;
        hitB.add(pB.id);
        rows.push({
          kind: "article",
          productOnB: toCompareProduct(pB),
          productFromOnlyA: cA,
          article: art
        });
      }
    }
    const keyA = normBrandKeyStr(pA);
    const listB = (byBrandB.get(keyA) || []).filter(
      (pB) => pA.id !== pB.id && !hitB.has(pB.id)
    );
    const sorted = [...listB].sort(
      (a, b) =>
        combinedNameSimilarity(cA, toCompareProduct(b), nameLocale) -
        combinedNameSimilarity(cA, toCompareProduct(a), nameLocale)
    );
    for (const pB of sorted) {
      const cB = toCompareProduct(pB);
      if (!sameBrandForFuzzy(cA, cB)) continue;
      const r = await classifyCrossSoftPair(
        cA,
        cB,
        nameLocale,
        attrOpts,
        phashCache
      );
      if (!r) continue;
      hitB.add(pB.id);
      if (r.kind === "name_photo") {
        rows.push({
          kind: "name_photo",
          productOnB: cB,
          productFromOnlyA: cA,
          score: r.score,
          matchReasons: r.matchReasons
        });
      } else if (r.kind === "brand_visual") {
        rows.push({
          kind: "brand_visual",
          productOnB: cB,
          productFromOnlyA: cA,
          score: r.score,
          matchReasons: r.matchReasons
        });
      } else {
        rows.push({
          kind: "unlikely",
          productOnB: cB,
          productFromOnlyA: cA,
          score: r.score,
          matchReasons: r.matchReasons
        });
      }
    }
  }
  return rows;
}

/** Дубли внутри «неразмещённого» списка A (та же логика, что для B). */
export async function buildOnlyAInternalDups(
  rawOnlyA: FpProduct[],
  nameLocale: NameLocale,
  attrOpts?: AttrMatchOptions
): Promise<OnlyBInternalDupRow[]> {
  return buildOnlyBInternalDups(rawOnlyA, nameLocale, attrOpts);
}

export async function buildOnlyBInternalDups(
  rawOnlyB: FpProduct[],
  nameLocale: NameLocale,
  attrOpts?: AttrMatchOptions
): Promise<OnlyBInternalDupRow[]> {
  const out: OnlyBInternalDupRow[] = [];
  const eanToProducts = new Map<string, FpProduct[]>();
  for (const p of rawOnlyB) {
    for (const e of collectEans(p)) {
      if (!e) continue;
      if (!eanToProducts.has(e)) eanToProducts.set(e, []);
      eanToProducts.get(e)!.push(p);
    }
  }
  const usedPairEan = new Set<string>();
  const bannedEanPairKeys = new Set<string>();
  for (const [ean, prods] of eanToProducts) {
    const byId = new Map<number, FpProduct>();
    for (const p of prods) {
      if (!byId.has(p.id)) byId.set(p.id, p);
    }
    const uniq = [...byId.values()];
    if (uniq.length < 2) continue;
    for (let i = 0; i < uniq.length; i++) {
      for (let j = i + 1; j < uniq.length; j++) {
        const a = uniq[i]!;
        const b = uniq[j]!;
        const k = pairKeyIds(a.id, b.id);
        bannedEanPairKeys.add(k);
        if (usedPairEan.has(k)) continue;
        usedPairEan.add(k);
        out.push({
          kind: "ean",
          first: toCompareProduct(a),
          second: toCompareProduct(b),
          ean
        });
      }
    }
  }

  const byFuzzyBrand = new Map<string, FpProduct[]>();
  for (const p of rawOnlyB) {
    const n = normBrand(productBrandName(p));
    const key = n || "__empty_brand__";
    if (!byFuzzyBrand.has(key)) byFuzzyBrand.set(key, []);
    byFuzzyBrand.get(key)!.push(p);
  }

  const soft = await computeIntraSoftDupTiers(
    byFuzzyBrand,
    new Set(),
    nameLocale,
    attrOpts,
    bannedEanPairKeys
  );

  const pushPair = (
    kind: "name_photo" | "brand_visual" | "unlikely",
    a: (typeof soft.namePhotoPairs)[0]
  ) => {
    const I = a.a.id;
    const J = a.b.id;
    const k = pairKeyIds(I, J);
    if (usedPairEan.has(k)) return;
    usedPairEan.add(k);
    out.push({
      kind,
      first: a.a,
      second: a.b,
      score: a.score,
      matchReasons: a.matchReasons
    });
  };

  for (const row of soft.namePhotoPairs) pushPair("name_photo", row);
  for (const row of soft.brandVisualPairs) pushPair("brand_visual", row);
  for (const row of soft.unlikelyPairs) pushPair("unlikely", row);

  return out;
}
