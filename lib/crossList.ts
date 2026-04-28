import { collectArticleKeys, collectEans, toCompareProduct } from "./product";
import {
  PAIR_MIN,
  sameBrandForFuzzy,
  scoreNameAndPhoto,
  scoreUnlikelyPhotoAndModel
} from "./pairScoring";
import type {
  AttrMatchOptions,
  FpProduct,
  NameLocale,
  OnlyACrossWithBRow,
  OnlyBCrossWithARow,
  OnlyBInternalDupRow
} from "./types";

function normBrand(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * «Только на B» сопоставить с полным каталогом A: EAN или имя+фото (индекс по EAN и бренду).
 */
export function buildOnlyBCrossWithA(
  rawOnlyB: FpProduct[],
  allA: FpProduct[],
  nameLocale: NameLocale,
  attrOpts?: AttrMatchOptions
): OnlyBCrossWithARow[] {
  const rows: OnlyBCrossWithARow[] = [];
  const eanToA = new Map<string, FpProduct[]>();
  const artToA = new Map<string, FpProduct[]>();
  const byBrandA = new Map<string, FpProduct[]>();
  for (const pA of allA) {
    const bk = normBrand(pA.brand?.name || "") || "__no_brand__";
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
    const keyB = normBrand(pB.brand?.name || "") || "__no_brand__";
    for (const pA of byBrandA.get(keyB) || []) {
      if (pA.id === pB.id || hitA.has(pA.id)) continue;
      const cA = toCompareProduct(pA);
      if (!sameBrandForFuzzy(cA, cB)) continue;
      const { score, reasons } = scoreNameAndPhoto(
        cA,
        cB,
        nameLocale,
        attrOpts
      );
      if (score < PAIR_MIN || !reasons.length) continue;
      hitA.add(pA.id);
      rows.push({
        kind: "name_photo",
        productOnA: cA,
        productFromOnlyB: cB,
        score,
        matchReasons: reasons
      });
    }
    for (const pA of byBrandA.get(keyB) || []) {
      if (pA.id === pB.id || hitA.has(pA.id)) continue;
      const cA = toCompareProduct(pA);
      if (!sameBrandForFuzzy(cA, cB)) continue;
      const u = scoreUnlikelyPhotoAndModel(cA, cB, nameLocale, attrOpts);
      if (u.score < PAIR_MIN || !u.reasons.length) continue;
      hitA.add(pA.id);
      rows.push({
        kind: "unlikely",
        productOnA: cA,
        productFromOnlyB: cB,
        score: u.score,
        matchReasons: u.reasons
      });
    }
  }
  return rows;
}

/**
 * «Только на A» сопоставить с полным каталогом B (симметрично buildOnlyBCrossWithA).
 */
export function buildOnlyACrossWithB(
  rawOnlyA: FpProduct[],
  allB: FpProduct[],
  nameLocale: NameLocale,
  attrOpts?: AttrMatchOptions
): OnlyACrossWithBRow[] {
  const rows: OnlyACrossWithBRow[] = [];
  const eanToB = new Map<string, FpProduct[]>();
  const artToB = new Map<string, FpProduct[]>();
  const byBrandB = new Map<string, FpProduct[]>();
  for (const pB of allB) {
    const bk = normBrand(pB.brand?.name || "") || "__no_brand__";
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
    const keyA = normBrand(pA.brand?.name || "") || "__no_brand__";
    for (const pB of byBrandB.get(keyA) || []) {
      if (pA.id === pB.id || hitB.has(pB.id)) continue;
      const cB = toCompareProduct(pB);
      if (!sameBrandForFuzzy(cA, cB)) continue;
      const { score, reasons } = scoreNameAndPhoto(
        cA,
        cB,
        nameLocale,
        attrOpts
      );
      if (score < PAIR_MIN || !reasons.length) continue;
      hitB.add(pB.id);
      rows.push({
        kind: "name_photo",
        productOnB: cB,
        productFromOnlyA: cA,
        score,
        matchReasons: reasons
      });
    }
    for (const pB of byBrandB.get(keyA) || []) {
      if (pA.id === pB.id || hitB.has(pB.id)) continue;
      const cB = toCompareProduct(pB);
      if (!sameBrandForFuzzy(cA, cB)) continue;
      const u = scoreUnlikelyPhotoAndModel(cA, cB, nameLocale, attrOpts);
      if (u.score < PAIR_MIN || !u.reasons.length) continue;
      hitB.add(pB.id);
      rows.push({
        kind: "unlikely",
        productOnB: cB,
        productFromOnlyA: cA,
        score: u.score,
        matchReasons: u.reasons
      });
    }
  }
  return rows;
}

/** Дубли внутри «неразмещённого» списка A (та же логика, что для B). */
export function buildOnlyAInternalDups(
  rawOnlyA: FpProduct[],
  nameLocale: NameLocale,
  attrOpts?: AttrMatchOptions
): OnlyBInternalDupRow[] {
  return buildOnlyBInternalDups(rawOnlyA, nameLocale, attrOpts);
}

export function buildOnlyBInternalDups(
  rawOnlyB: FpProduct[],
  nameLocale: NameLocale,
  attrOpts?: AttrMatchOptions
): OnlyBInternalDupRow[] {
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
        const k = a.id < b.id ? `${a.id}-${b.id}` : `${b.id}-${a.id}`;
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
  type NCand = { i: number; j: number; sc: number; re: string[] };
  const nc: NCand[] = [];
  for (let i = 0; i < rawOnlyB.length; i++) {
    for (let j = i + 1; j < rawOnlyB.length; j++) {
      const pi = rawOnlyB[i]!;
      const pj = rawOnlyB[j]!;
      const cI = toCompareProduct(pi);
      const cJ = toCompareProduct(pj);
      if (!sameBrandForFuzzy(cI, cJ)) continue;
      const { score, reasons } = scoreNameAndPhoto(
        cI,
        cJ,
        nameLocale,
        attrOpts
      );
      if (score < PAIR_MIN || !reasons.length) continue;
      const k = pi.id < pj.id ? `${pi.id}-${pj.id}` : `${pj.id}-${pi.id}`;
      if (usedPairEan.has(k)) continue;
      nc.push({ i, j, sc: score, re: reasons });
    }
  }
  nc.sort((a, b) => b.sc - a.sc);
  const usedId = new Set<number>();
  for (const c of nc) {
    const I = rawOnlyB[c.i]!.id;
    const J = rawOnlyB[c.j]!.id;
    const k = I < J ? `${I}-${J}` : `${J}-${I}`;
    if (usedPairEan.has(k)) continue;
    if (usedId.has(I) || usedId.has(J)) continue;
    usedId.add(I);
    usedId.add(J);
    out.push({
      kind: "name_photo",
      first: toCompareProduct(rawOnlyB[c.i]!),
      second: toCompareProduct(rawOnlyB[c.j]!),
      score: c.sc,
      matchReasons: c.re
    });
  }
  const nu: NCand[] = [];
  for (let i = 0; i < rawOnlyB.length; i++) {
    for (let j = i + 1; j < rawOnlyB.length; j++) {
      const pi = rawOnlyB[i]!;
      const pj = rawOnlyB[j]!;
      const cI = toCompareProduct(pi);
      const cJ = toCompareProduct(pj);
      if (!sameBrandForFuzzy(cI, cJ)) continue;
      const { score, reasons } = scoreUnlikelyPhotoAndModel(
        cI,
        cJ,
        nameLocale,
        attrOpts
      );
      if (score < PAIR_MIN || !reasons.length) continue;
      const k = pi.id < pj.id ? `${pi.id}-${pj.id}` : `${pj.id}-${pi.id}`;
      if (usedPairEan.has(k)) continue;
      nu.push({ i, j, sc: score, re: reasons });
    }
  }
  nu.sort((a, b) => b.sc - a.sc);
  for (const c of nu) {
    const I = rawOnlyB[c.i]!.id;
    const J = rawOnlyB[c.j]!.id;
    const k = I < J ? `${I}-${J}` : `${J}-${I}`;
    if (usedPairEan.has(k)) continue;
    if (usedId.has(I) || usedId.has(J)) continue;
    usedId.add(I);
    usedId.add(J);
    usedPairEan.add(k);
    out.push({
      kind: "unlikely",
      first: toCompareProduct(rawOnlyB[c.i]!),
      second: toCompareProduct(rawOnlyB[c.j]!),
      score: c.sc,
      matchReasons: c.re
    });
  }
  return out;
}
