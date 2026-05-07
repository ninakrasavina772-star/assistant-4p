import { productBrandName } from "./brand-filter";
import { extractProductAttributes } from "./productAttributes";
import type { CompareProduct, FpProduct, NameLocale } from "./types";

/** Норм. артикул для сопоставления (без пробелов, нижний регистр) */
export function normArticleKey(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, "");
}

/**
 * Семейство одной витринной карточки: хвост slug …-a1182822 в URL 4p.
 * Два дубля с разными id, но одной карточкой, часто дают один и тот же суффикс.
 */
export function productBaseKeyFromLink(link: string | undefined | null): string | null {
  if (!link || typeof link !== "string") return null;
  try {
    const path = new URL(link).pathname;
    const m = path.match(/-a(\d+)(?:\/?|$)/i);
    if (m) return `a${m[1]}`;
  } catch {
    // ignore
  }
  return null;
}

export function collectArticleKeys(p: FpProduct): string[] {
  const set = new Set<string>();
  for (const x of [p.article, p.code, p.vendor_code] as (string | undefined)[]) {
    if (x == null || x === "") continue;
    const k = normArticleKey(String(x));
    if (k) set.add(k);
  }
  /* Тот же «хвост карточки» a123…, что в UI как «карточка:» — на витрине часто совпадает между A/B, даже если article/code в JSON различаются. */
  const lb = productBaseKeyFromLink(p.link);
  if (lb) {
    const k = normArticleKey(lb);
    if (k) set.add(k);
  }
  return [...set];
}

/**
 * EAN: объединяем корневой список и варианты, без пустых строк.
 */
export function collectEans(p: FpProduct): string[] {
  const set = new Set<string>();
  (p.eans || []).forEach((e) => {
    if (e == null || e === "") return;
    set.add(String(e).trim());
  });
  const pv = p.product_variation;
  if (pv) {
    for (const v of Object.values(pv)) {
      if (v?.ean) set.add(String(v.ean).trim());
    }
  }
  return [...set];
}

function displayNames(p: FpProduct) {
  const base = p.name || "";
  const ru = p.i18n?.ru?.name?.trim() || base;
  const en = p.i18n?.en?.name?.trim() || base;
  return { nameEn: en || base, nameRu: ru || base };
}

export function firstImageUrl(p: FpProduct): string | null {
  const pv = p.product_variation;
  if (!pv) return null;
  for (const v of Object.values(pv)) {
    if (v?.images?.[0]) return v.images[0];
  }
  return null;
}

export function toCompareProduct(p: FpProduct): CompareProduct {
  const { nameEn, nameRu } = displayNames(p);
  const eans = collectEans(p);
  const attr = extractProductAttributes(p);
  const artKeys = collectArticleKeys(p);
  const lb = productBaseKeyFromLink(p.link);
  return {
    id: p.id,
    nameEn,
    nameRu,
    link: p.link,
    eans,
    firstImage: firstImageUrl(p),
    brand: productBrandName(p),
    ...(lb ? { linkBaseKey: lb } : {}),
    ...(artKeys[0] ? { articleKey: artKeys[0] } : {}),
    ...(attr.attrVolume ? { attrVolume: attr.attrVolume } : {}),
    ...(attr.attrColor ? { attrColor: attr.attrColor } : {}),
    ...(attr.attrShade ? { attrShade: attr.attrShade } : {})
  };
}

export function pickComparableName(
  c: CompareProduct,
  nameLocale: NameLocale
): string {
  if (nameLocale === "ru") return c.nameRu;
  return c.nameEn;
}
