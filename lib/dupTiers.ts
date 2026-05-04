import { incompatibleBeautyTitles } from "./beautyCategoryConflict";
import { productBrandName } from "./brand-filter";
import { firstImageRefEquivalent } from "./imageUrlMatch";
import {
  DEFAULT_VISUAL_HAMMING_MAX,
  prefetchPhashes,
  type PhashCache,
  visualSimilarFromPhash
} from "./imagePhash";
import { nameAndModelScore } from "./nameModel";
import { applyAttrGate, normBrand, sameBrandForFuzzy } from "./pairScoring";
import { pickComparableName, toCompareProduct } from "./product";
import type {
  AttrMatchOptions,
  CompareProduct,
  FpProduct,
  IntraNamePhotoPairRow,
  IntraUnlikelyPairRow,
  NameLocale
} from "./types";
import { wordFollowedByConflictingDigit } from "./variantNameGuard";

/** ~90%: частичное совпадение названия + эквивалентная ссылка на фото */
export const PARTIAL_NAME_MIN_90 = 0.42;
/** ~60%: точный бренд + модельная линия в названии + визуально похожее фото */
/** Выше минимум — меньше ложных пар вроде разных линеек Hermes при похожем флаконе. */
export const PARTIAL_NAME_MIN_60 = 0.46;
/** Маловероятный: тот же бренд (fuzzy), слабее название */
export const SLIGHT_NAME_UNLIKELY = 0.24;

/**
 * Порог aHash для слоя «маловероятно»: жёстче {@link DEFAULT_VISUAL_HAMMING_MAX}, иначе студийные
 * фото на белом фоне дают ложные «похожие фото» (флакон vs тушь и т.п.).
 */
const UNLIKELY_VISUAL_HAMMING_MAX = 8;

/** Для слоя «бренд + визуально ~60%» смотрим сходство **модельной** строки (линейка аромата и т.п.), не max(полное, модель). */
const MIN_MODEL_CHARS_FOR_VISUAL = 3;
export const MODEL_SIM_MIN_FOR_BRAND_VISUAL = 0.52;
/** Если обе модельные строки длинные, а сходство низкое — не считаем даже маловероятным дублем. */
const SUBSTANTIAL_MODEL_CHARS = 5;
const MAX_MODEL_SIM_FOR_WEAK_PAIR = 0.38;

function normEanKey(s: string): string {
  return String(s).replace(/\D/g, "");
}

/** Оба товара имеют валидные штрихкоды, но множества не пересекаются → не может быть «мягкого» дубля. */
export function softDupBlockedByDisjointEans(
  a: CompareProduct,
  b: CompareProduct
): boolean {
  const ea = new Set(
    (a.eans || [])
      .map(normEanKey)
      .filter((x) => x.length >= 8)
  );
  const eb = new Set(
    (b.eans || [])
      .map(normEanKey)
      .filter((x) => x.length >= 8)
  );
  if (ea.size === 0 || eb.size === 0) return false;
  for (const x of ea) {
    if (eb.has(x)) return false;
  }
  return true;
}

/**
 * Условие для ~60% (бренд + фото): достаточно похожа **линейка/модель**, а не только полный заголовок
 * («Hermès + туалетная вода» без совпадения Equipage vs Bel Ami).
 */
function qualifiesForBrandVisualTier(
  mA: string,
  mB: string,
  modelSim: number
): boolean {
  const la = mA.trim().length;
  const lb = mB.trim().length;
  if (la < MIN_MODEL_CHARS_FOR_VISUAL || lb < MIN_MODEL_CHARS_FOR_VISUAL) {
    return false;
  }
  return modelSim >= MODEL_SIM_MIN_FOR_BRAND_VISUAL;
}

function substantialModelConflict(
  mA: string,
  mB: string,
  modelSim: number
): boolean {
  if (mA.trim().length < SUBSTANTIAL_MODEL_CHARS) return false;
  if (mB.trim().length < SUBSTANTIAL_MODEL_CHARS) return false;
  return modelSim <= MAX_MODEL_SIM_FOR_WEAK_PAIR;
}

export function brandsExactForDup(a: CompareProduct, b: CompareProduct): boolean {
  const x = normBrand(a.brand);
  const y = normBrand(b.brand);
  return Boolean(x && y && x === y);
}

export function combinedNameSimilarity(
  cA: CompareProduct,
  cB: CompareProduct,
  nameLocale: NameLocale
): number {
  const na = pickComparableName(cA, nameLocale);
  const nb = pickComparableName(cB, nameLocale);
  const { full, model } = nameAndModelScore(na, nb, cA.brand, cB.brand);
  return Math.max(full, model);
}

function visualFromCache(
  urlA: string,
  urlB: string,
  cache: PhashCache,
  maxDist = DEFAULT_VISUAL_HAMMING_MAX
): boolean {
  if (firstImageRefEquivalent(urlA, urlB)) return true;
  const a = cache.get(urlA.trim());
  const b = cache.get(urlB.trim());
  return visualSimilarFromPhash(
    a === undefined ? null : a,
    b === undefined ? null : b,
    maxDist
  );
}

type ResolvedTier =
  | { kind: "90"; reasons: string[]; score: number }
  | { kind: "60"; reasons: string[]; score: number }
  | { kind: "un"; reasons: string[]; score: number };

function resolveTierForPair(
  cI: CompareProduct,
  cJ: CompareProduct,
  nameLocale: NameLocale,
  attrOpts: AttrMatchOptions | undefined,
  cache: PhashCache
): ResolvedTier | null {
  const na = pickComparableName(cI, nameLocale);
  const nb = pickComparableName(cJ, nameLocale);
  if (wordFollowedByConflictingDigit(na, nb)) return null;
  if (softDupBlockedByDisjointEans(cI, cJ)) return null;
  if (incompatibleBeautyTitles(na, nb)) return null;

  const { full, model: modelSim, modelA: mA, modelB: mB } = nameAndModelScore(
    na,
    nb,
    cI.brand,
    cJ.brand
  );
  const comb = Math.max(full, modelSim);
  const imgI = cI.firstImage || "";
  const imgJ = cJ.firstImage || "";
  const urlEq = firstImageRefEquivalent(imgI, imgJ);

  if (urlEq && comb >= PARTIAL_NAME_MIN_90) {
    const g = applyAttrGate(cI, cJ, attrOpts, 0.9, [
      "~90% дубль: частичное название + эквивалентное фото (URL)"
    ]);
    if (g.score >= 0.89 && g.reasons.length) {
      return { kind: "90", reasons: g.reasons, score: 0.9 };
    }
  }

  if (
    brandsExactForDup(cI, cJ) &&
    qualifiesForBrandVisualTier(mA, mB, modelSim) &&
    imgI &&
    imgJ
  ) {
    if (visualFromCache(imgI, imgJ, cache)) {
      const g = applyAttrGate(cI, cJ, attrOpts, 0.6, [
        "~60% дубль: бренд (точно) + модельная линия + похожее фото (визуально)",
        `модель~${Math.round(modelSim * 100)}%${full >= PARTIAL_NAME_MIN_60 ? ` · полное название~${Math.round(full * 100)}%` : ""}`
      ]);
      if (g.score >= 0.59 && g.reasons.length) {
        return { kind: "60", reasons: g.reasons, score: 0.6 };
      }
    }
  }

  if (sameBrandForFuzzy(cI, cJ) && comb >= SLIGHT_NAME_UNLIKELY && imgI && imgJ) {
    if (substantialModelConflict(mA, mB, modelSim)) return null;
    if (visualFromCache(imgI, imgJ, cache, UNLIKELY_VISUAL_HAMMING_MAX)) {
      return {
        kind: "un",
        reasons: [
          "~45% кандидат: бренд + слабее название + узкое сходство превью первого фото (строже, чем ~60%)",
          `сходство названия~${Math.round(comb * 100)}%`
        ],
        score: 0.45
      };
    }
  }

  return null;
}

type PairWork = {
  pa: FpProduct;
  pb: FpProduct;
  cI: CompareProduct;
  cJ: CompareProduct;
  comb: number;
  imgI: string;
  imgJ: string;
  urlEq: boolean;
};

export function pairKeyIds(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

function collectPairWork(
  byFuzzyBrand: Map<string, FpProduct[]>,
  usedInEan: Set<number>,
  nameLocale: NameLocale,
  bannedPairKeys?: Set<string>
): PairWork[] {
  const out: PairWork[] = [];
  for (const [, list] of byFuzzyBrand) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const pi = list[i]!;
        const pj = list[j]!;
        if (pi.id === pj.id) continue;
        if (bannedPairKeys?.has(pairKeyIds(pi.id, pj.id))) continue;
        if (usedInEan.has(pi.id) || usedInEan.has(pj.id)) continue;
        const cI = toCompareProduct(pi);
        const cJ = toCompareProduct(pj);
        if (!sameBrandForFuzzy(cI, cJ)) continue;
        const na = pickComparableName(cI, nameLocale);
        const nb = pickComparableName(cJ, nameLocale);
        if (wordFollowedByConflictingDigit(na, nb)) continue;
        if (softDupBlockedByDisjointEans(cI, cJ)) continue;
        const { full, model } = nameAndModelScore(
          na,
          nb,
          cI.brand,
          cJ.brand
        );
        const comb = Math.max(full, model);
        const imgI = cI.firstImage || "";
        const imgJ = cJ.firstImage || "";
        const urlEq = firstImageRefEquivalent(imgI, imgJ);
        out.push({ pa: pi, pb: pj, cI, cJ, comb, imgI, imgJ, urlEq });
      }
    }
  }
  return out;
}

function urlsNeedingPhash(pairs: PairWork[]): string[] {
  const urls: string[] = [];
  for (const p of pairs) {
    if (!p.imgI || !p.imgJ) continue;
    if (p.urlEq) continue;
    const need60 =
      brandsExactForDup(p.cI, p.cJ) && p.comb >= SLIGHT_NAME_UNLIKELY;
    const needUn =
      sameBrandForFuzzy(p.cI, p.cJ) && p.comb >= SLIGHT_NAME_UNLIKELY;
    if (need60 || needUn) {
      urls.push(p.imgI, p.imgJ);
    }
  }
  return urls;
}

const TIER_WEIGHT: Record<ResolvedTier["kind"], number> = {
  "90": 3,
  "60": 2,
  un: 1
};

export async function computeIntraSoftDupTiers(
  byFuzzyBrand: Map<string, FpProduct[]>,
  usedInEan: Set<number>,
  nameLocale: NameLocale,
  attrOpts?: AttrMatchOptions,
  bannedPairKeys?: Set<string>
): Promise<{
  namePhotoPairs: IntraNamePhotoPairRow[];
  brandVisualPairs: IntraNamePhotoPairRow[];
  unlikelyPairs: IntraUnlikelyPairRow[];
}> {
  const pairs = collectPairWork(
    byFuzzyBrand,
    usedInEan,
    nameLocale,
    bannedPairKeys
  );
  const cache: PhashCache = new Map();
  await prefetchPhashes(urlsNeedingPhash(pairs), cache);

  type Scored = PairWork & { res: ResolvedTier };
  const scored: Scored[] = [];
  for (const p of pairs) {
    const res = resolveTierForPair(p.cI, p.cJ, nameLocale, attrOpts, cache);
    if (res) scored.push({ ...p, res });
  }

  scored.sort((a, b) => {
    const dw = TIER_WEIGHT[b.res.kind] - TIER_WEIGHT[a.res.kind];
    if (dw !== 0) return dw;
    const dc = b.comb - a.comb;
    if (dc !== 0) return dc;
    const ia = Math.min(a.pa.id, a.pb.id);
    const ib = Math.min(b.pa.id, b.pb.id);
    if (ia !== ib) return ia - ib;
    return Math.max(a.pa.id, a.pb.id) - Math.max(b.pa.id, b.pb.id);
  });

  const used = new Set<number>();
  const namePhotoPairs: IntraNamePhotoPairRow[] = [];
  const brandVisualPairs: IntraNamePhotoPairRow[] = [];
  const unlikelyPairs: IntraUnlikelyPairRow[] = [];

  for (const s of scored) {
    const I = s.pa.id;
    const J = s.pb.id;
    if (used.has(I) || used.has(J)) continue;
    used.add(I);
    used.add(J);
    const row = {
      a: toCompareProduct(s.pa),
      b: toCompareProduct(s.pb),
      score: s.res.score,
      matchReasons: s.res.reasons
    };
    if (s.res.kind === "90") namePhotoPairs.push(row);
    else if (s.res.kind === "60") brandVisualPairs.push(row);
    else unlikelyPairs.push(row);
  }

  return { namePhotoPairs, brandVisualPairs, unlikelyPairs };
}

export async function classifyCrossSoftPair(
  cA: CompareProduct,
  cB: CompareProduct,
  nameLocale: NameLocale,
  attrOpts: AttrMatchOptions | undefined,
  cache: PhashCache
): Promise<
  | { kind: "name_photo"; score: number; matchReasons: string[] }
  | { kind: "brand_visual"; score: number; matchReasons: string[] }
  | { kind: "unlikely"; score: number; matchReasons: string[] }
  | null
> {
  const r = resolveTierForPair(cA, cB, nameLocale, attrOpts, cache);
  if (!r) return null;
  if (r.kind === "90")
    return { kind: "name_photo", score: r.score, matchReasons: r.reasons };
  if (r.kind === "60")
    return { kind: "brand_visual", score: r.score, matchReasons: r.reasons };
  return { kind: "unlikely", score: r.score, matchReasons: r.reasons };
}

/** Собрать URL для предзагрузки phash в кросс-сценарии (пары в одной бренд-корзине). */
export function collectCrossPhashUrls(
  listA: FpProduct[],
  listB: FpProduct[],
  nameLocale: NameLocale
): string[] {
  const urls: string[] = [];
  for (const pA of listA) {
    const cA = toCompareProduct(pA);
    for (const pB of listB) {
      if (pA.id === pB.id) continue;
      const cB = toCompareProduct(pB);
      if (!sameBrandForFuzzy(cA, cB)) continue;
      const na = pickComparableName(cA, nameLocale);
      const nb = pickComparableName(cB, nameLocale);
      if (wordFollowedByConflictingDigit(na, nb)) continue;
      if (softDupBlockedByDisjointEans(cA, cB)) continue;
      const { full, model } = nameAndModelScore(
        na,
        nb,
        cA.brand,
        cB.brand
      );
      const comb = Math.max(full, model);
      const imgI = cA.firstImage || "";
      const imgJ = cB.firstImage || "";
      if (!imgI || !imgJ) continue;
      if (firstImageRefEquivalent(imgI, imgJ)) continue;
      const need60 =
        brandsExactForDup(cA, cB) && comb >= SLIGHT_NAME_UNLIKELY;
      const needUn =
        sameBrandForFuzzy(cA, cB) && comb >= SLIGHT_NAME_UNLIKELY;
      if (need60 || needUn) {
        urls.push(imgI, imgJ);
      }
    }
  }
  return urls;
}

function normBrandKey(p: FpProduct): string {
  const n = normBrand(productBrandName(p));
  return n || "__no_brand__";
}

/** Предзагрузка phash для всех потенциальных пар (B × A в одной бренд-корзине). */
export async function prefetchOnlyBCrossPhashes(
  rawOnlyB: FpProduct[],
  byBrandA: Map<string, FpProduct[]>,
  nameLocale: NameLocale,
  cache: PhashCache
): Promise<void> {
  const urls: string[] = [];
  for (const pB of rawOnlyB) {
    const keyB = normBrandKey(pB);
    const listA = byBrandA.get(keyB) || [];
    urls.push(...collectCrossPhashUrls(listA, [pB], nameLocale));
  }
  await prefetchPhashes(urls, cache);
}

export async function prefetchOnlyACrossPhashes(
  rawOnlyA: FpProduct[],
  byBrandB: Map<string, FpProduct[]>,
  nameLocale: NameLocale,
  cache: PhashCache
): Promise<void> {
  const urls: string[] = [];
  for (const pA of rawOnlyA) {
    const keyA = normBrandKey(pA);
    const listB = byBrandB.get(keyA) || [];
    urls.push(...collectCrossPhashUrls([pA], listB, nameLocale));
  }
  await prefetchPhashes(urls, cache);
}
