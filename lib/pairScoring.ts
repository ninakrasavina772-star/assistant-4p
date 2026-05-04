import { firstImageRefEquivalent } from "./imageUrlMatch";
import { nameAndModelScore } from "./nameModel";
import { pickComparableName, productBaseKeyFromLink } from "./product";
import { normAttrValue } from "./productAttributes";
import { attrPairHint, volumePairHint } from "./volumeMatch";
import { volumeStringsEquivalentForGate } from "./volumeFromText";
import type { AttrMatchOptions, CompareProduct, NameLocale } from "./types";
import { wordFollowedByConflictingDigit } from "./variantNameGuard";

export const PAIR_MIN = 0.66;
const NAME_ALONE_MIN = 0.66;
/** С одной витринной карточкой (-aID в URL) и обоим объёмам — допускаем разные URL фото */
const LINK_FAMILY_MODEL_MIN = 0.48;

/**
 * При включённых опциях: если на обоих товарах задана характеристика и
 * значения различаются — пара не подходит. Фото остаётся важной частью: при
 * неэквивалентных ссылках на первое фото (после нормализации URL) ветка «то же фото» не срабатывает.
 */
export function applyAttrGate(
  a: CompareProduct,
  b: CompareProduct,
  attrOpts: AttrMatchOptions | undefined,
  baseScore: number,
  baseReasons: string[]
): { score: number; reasons: string[] } {
  if (
    !attrOpts ||
    (!attrOpts.volume && !attrOpts.shade && !attrOpts.color)
  ) {
    return { score: baseScore, reasons: baseReasons };
  }
  if (baseReasons.length === 0) {
    return { score: baseScore, reasons: baseReasons };
  }
  const extra: string[] = [];
  if (attrOpts.volume) {
    const av = a.attrVolume?.trim();
    const bv = b.attrVolume?.trim();
    if (av && bv && !volumeStringsEquivalentForGate(av, bv)) {
      return { score: 0, reasons: [] };
    }
    if (av && bv) extra.push("объём");
  }
  if (attrOpts.shade) {
    const av = a.attrShade?.trim();
    const bv = b.attrShade?.trim();
    if (av && bv && normAttrValue(av) !== normAttrValue(bv)) {
      return { score: 0, reasons: [] };
    }
    if (av && bv) extra.push("оттенок");
  }
  if (attrOpts.color) {
    const av = a.attrColor?.trim();
    const bv = b.attrColor?.trim();
    if (av && bv && normAttrValue(av) !== normAttrValue(bv)) {
      return { score: 0, reasons: [] };
    }
    if (av && bv) extra.push("цвет");
  }
  const reasons = [...new Set([...baseReasons, ...extra])];
  return { score: baseScore, reasons };
}

function linkFamilyWithBothVolumes(
  a: CompareProduct,
  b: CompareProduct
): boolean {
  const k1 = a.linkBaseKey || productBaseKeyFromLink(a.link);
  const k2 = b.linkBaseKey || productBaseKeyFromLink(b.link);
  if (!k1 || !k2 || k1 !== k2) return false;
  const v1 = a.attrVolume?.trim();
  const v2 = b.attrVolume?.trim();
  return Boolean(
    v1 && v2 && volumeStringsEquivalentForGate(v1, v2)
  );
}

export function scoreNameAndPhoto(
  a: CompareProduct,
  b: CompareProduct,
  nameLocale: NameLocale,
  attrOpts?: AttrMatchOptions
): { score: number; reasons: string[] } {
  const na = pickComparableName(a, nameLocale);
  const nb = pickComparableName(b, nameLocale);
  if (wordFollowedByConflictingDigit(na, nb)) {
    return { score: 0, reasons: [] };
  }
  const { full, model, combined: nameSim } = nameAndModelScore(
    na,
    nb,
    a.brand,
    b.brand
  );
  const imgA = a.firstImage || "";
  const imgB = b.firstImage || "";
  const sameImg = Boolean(imgA && imgB && firstImageRefEquivalent(imgA, imgB));
  if (imgA && imgB && !sameImg) {
    if (
      linkFamilyWithBothVolumes(a, b) &&
      model >= LINK_FAMILY_MODEL_MIN
    ) {
      const score = Math.min(
        0.92,
        0.3 * nameSim + 0.3 * model + 0.38
      );
      return applyAttrGate(
        a,
        b,
        attrOpts,
        score,
        ["модель", "карточка+объём"]
      );
    }
    return { score: 0, reasons: [] };
  }
  if (sameImg) {
    const score = 0.5 * nameSim + 0.5;
    const reasons: string[] = ["фото"];
    if (nameSim >= 0.4) {
      if (model > full) reasons.unshift("модель");
      else reasons.unshift("название");
    }
    return applyAttrGate(a, b, attrOpts, score, [...new Set(reasons)]);
  }
  if (nameSim >= NAME_ALONE_MIN) {
    return applyAttrGate(
      a,
      b,
      attrOpts,
      nameSim,
      model > full ? ["модель"] : ["название"]
    );
  }
  if (model >= 0.72 && full >= 0.42) {
    return applyAttrGate(a, b, attrOpts, 0.66, ["модель"]);
  }
  return applyAttrGate(a, b, attrOpts, nameSim, []);
}

/** Порог сходства «модельных» строк (nameAndModelScore.model) для секции «маловероятные» */
export const UNLIKELY_MODEL_MIN = 0.6;

/**
 * Маловероятный дубль: **то же** первое фото (эквивалентные URL после нормализации) +
 * сходство модельной части ≥ порога.
 * Галочки объём/оттенок/цвет — только **подписи** к паре (сравнение нормализованных
 * значений, в т.ч. 50 мл ≈ 50ml); несовпадение объёма не убирает пару.
 */
export function scoreUnlikelyPhotoAndModel(
  a: CompareProduct,
  b: CompareProduct,
  nameLocale: NameLocale,
  attrOpts?: AttrMatchOptions
): { score: number; reasons: string[] } {
  const imgA = a.firstImage || "";
  const imgB = b.firstImage || "";
  if (!imgA || !imgB || !firstImageRefEquivalent(imgA, imgB)) {
    return { score: 0, reasons: [] };
  }
  const na = pickComparableName(a, nameLocale);
  const nb = pickComparableName(b, nameLocale);
  const { model } = nameAndModelScore(na, nb, a.brand, b.brand);
  if (model < UNLIKELY_MODEL_MIN) {
    return { score: 0, reasons: [] };
  }
  const span = 1 - UNLIKELY_MODEL_MIN;
  const t = span > 0 ? (model - UNLIKELY_MODEL_MIN) / span : 0;
  const score = Math.min(0.92, PAIR_MIN + t * (0.92 - PAIR_MIN));
  const reasons: string[] = [
    "фото",
    `модель~${Math.round(model * 100)}%`
  ];
  if (attrOpts?.volume) {
    const h = volumePairHint(a.attrVolume, b.attrVolume);
    if (h === "equal") {
      reasons.push("объём (сходится)");
    } else if (h === "different") {
      reasons.push("объём: различается");
    } else {
      reasons.push("объём: не в обеих карточках");
    }
  }
  if (attrOpts?.shade) {
    const h = attrPairHint(a.attrShade, b.attrShade);
    if (h === "equal") {
      reasons.push("оттенок (совп.)");
    } else if (h === "different") {
      reasons.push("оттенок: разн.");
    } else {
      reasons.push("оттенок: не везде");
    }
  }
  if (attrOpts?.color) {
    const h = attrPairHint(a.attrColor, b.attrColor);
    if (h === "equal") {
      reasons.push("цвет (совп.)");
    } else if (h === "different") {
      reasons.push("цвет: разн.");
    } else {
      reasons.push("цвет: не везде");
    }
  }
  return { score, reasons };
}

export function normBrand(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function sameBrandForFuzzy(cA: CompareProduct, cB: CompareProduct): boolean {
  const a = normBrand(cA.brand);
  const b = normBrand(cB.brand);
  if (a && b) return a === b;
  if (!a && !b) return true;
  return false;
}
