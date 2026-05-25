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
 * Собираем возможные штрихкоды из полей ответа /product/list (имена полей в API 4Partners/поставщиков плавают).
 */
function addEanTokens(set: Set<string>, raw: unknown, depth = 0): void {
  if (raw == null || raw === "" || depth > 5) return;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    const t = String(raw).trim();
    if (t) set.add(t);
    return;
  }
  if (typeof raw === "string") {
    const t = raw.trim();
    if (!t) return;
    if (/[,;|]/.test(t)) {
      for (const part of t.split(/[,;|]+/)) {
        const w = part.trim();
        if (w) set.add(w);
      }
    } else {
      set.add(t);
    }
    return;
  }
  if (Array.isArray(raw)) {
    for (const x of raw) addEanTokens(set, x, depth + 1);
    return;
  }
  if (typeof raw === "object") {
    for (const v of Object.values(raw as Record<string, unknown>)) {
      addEanTokens(set, v, depth + 1);
    }
  }
}

const ROOT_BARCODE_KEYS = [
  "ean",
  "barcode",
  "barcode_ean",
  "gtin",
  "ean13",
  "ean_13",
  "upc",
  "product_ean",
  "product_barcode"
] as const;

const VAR_BARCODE_KEYS = ["ean", "barcode", "gtin", "upc", "eans"] as const;

/** EAN в HTML-описании карточки (часто в /product/info, когда в variation.ean пусто). */
const EAN_IN_TEXT_RE =
  /\bean\s*[:\s>]*\*?\*?([\d][\d\s\-]{7,18})\*?\*?/gi;

function addEansFromDescriptions(set: Set<string>, p: FpProduct): void {
  const chunks = [
    p.description,
    p.short_description,
    p.text,
    p.i18n?.ru?.description,
    p.i18n?.en?.description
  ];
  for (const raw of chunks) {
    if (!raw || typeof raw !== "string") continue;
    EAN_IN_TEXT_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = EAN_IN_TEXT_RE.exec(raw)) !== null) {
      const d = m[1]!.replace(/\D/g, "");
      if (d.length >= MIN_EAN_INDEX_DIGITS && d.length <= 14) set.add(d);
    }
  }
}

/**
 * EAN: корень + вариации, плюс типичные синонимы полей в JSON.
 */
export function collectEans(p: FpProduct): string[] {
  const set = new Set<string>();
  addEanTokens(set, p.eans);
  const ext = p as Record<string, unknown>;
  for (const k of ROOT_BARCODE_KEYS) {
    if (k in ext) addEanTokens(set, ext[k]);
  }
  const pv = p.product_variation;
  if (pv) {
    for (const v of Object.values(pv)) {
      if (!v || typeof v !== "object") continue;
      const vo = v as Record<string, unknown>;
      for (const k of VAR_BARCODE_KEYS) {
        if (k in vo) addEanTokens(set, vo[k]);
      }
    }
  }
  addEansFromDescriptions(set, p);
  return [...set].filter((s) => s.length > 0);
}

/**
 * Swagger описывает `product_variation` как array; в ответе так и приходит.
 * Приводим к Record, чтобы весь код одинаково обходил варианты (в т.ч. офферы/EAN).
 */
export function normalizeFpProductListShape(p: FpProduct): FpProduct {
  const pv = p.product_variation as unknown;
  if (!Array.isArray(pv)) return p;
  const record: NonNullable<FpProduct["product_variation"]> = {};
  for (let i = 0; i < pv.length; i++) {
    const item = pv[i];
    if (!item || typeof item !== "object") continue;
    const id = (item as { id?: number }).id;
    const key =
      id != null && Number.isFinite(Number(id)) ? String(id) : `_i${i}`;
    record[key] = item as NonNullable<FpProduct["product_variation"]>[string];
  }
  return {
    ...p,
    product_variation: Object.keys(record).length ? record : null
  };
}

/** Минимальная длина цифр для ключа штрихкода (после удаления нецифровых символов). 8 — классический EAN‑8+; 6 — не отсекаем короткие внутренние коды в фиде. */
export const MIN_EAN_INDEX_DIGITS = 6;

/**
 * Ключ для индексов/групп EAN: только цифры; убираем пробелы и дефисы из фида.
 * Иначе одна и та же позиция с «460053…» и «460 053 …» не сходилась.
 * Для полного набора вариантов (нули, 12/13/14) см. {@link expandEanDigitsForIndex}.
 */
export function eanKeyForIndex(raw: string | null | undefined): string | null {
  if (raw == null || raw === "") return null;
  const d = String(raw).replace(/\D/g, "");
  if (d.length < MIN_EAN_INDEX_DIGITS) return null;
  return d;
}

/**
 * Варианты одной записи штрихкода для склейки дублей: ведущие нули, типичные длины 12/13/14,
 * у 14-значного кода — ещё правые 13 и 12 цифр (приставка упаковки).
 */
export function expandEanDigitsForIndex(digits: string): string[] {
  const d = String(digits).replace(/\D/g, "");
  if (d.length < MIN_EAN_INDEX_DIGITS) return [];
  const out = new Set<string>();
  const add = (s: string) => {
    if (s.length >= MIN_EAN_INDEX_DIGITS) out.add(s);
  };
  add(d);
  const trimmed = d.replace(/^0+/, "") || "0";
  add(trimmed);
  for (const len of [12, 13, 14] as const) {
    if (trimmed.length <= len) add(trimmed.padStart(len, "0"));
  }
  if (d.length <= 14) add(d.padStart(14, "0"));
  if (d.length >= 14) {
    add(d.slice(-13));
    add(d.slice(-12));
  }
  return [...out];
}

/**
 * Собирает все штрихкоды с карточки (включая неактивные варианты) в корневое `eans`
 * — чтобы индекс дублей не зависел от фильтра офферов.
 */
export function fpProductWithMergedEans(p: FpProduct): FpProduct {
  const eans = collectEans(p);
  if (!eans.length) return p;
  return { ...p, eans };
}

/** Уникальные ключи штрихкодов карточки для индекса (несколько форм одного GTIN/EAN). */
export function collectEanIndexKeys(p: FpProduct): string[] {
  const keys = new Set<string>();
  for (const raw of collectEans(p)) {
    const d = String(raw ?? "").replace(/\D/g, "");
    if (d.length < MIN_EAN_INDEX_DIGITS) continue;
    for (const k of expandEanDigitsForIndex(d)) {
      keys.add(k);
    }
  }
  return [...keys];
}

/** Сумма строк product_variation (SKU) по всем карточкам — ближе к «N вариаций» в админке. */
export function countVariationSlots(products: FpProduct[]): number {
  let n = 0;
  for (const p of products) {
    const pv = p.product_variation;
    if (pv && typeof pv === "object") {
      const c = Object.keys(pv).length;
      n += c > 0 ? c : 1;
    } else {
      n += 1;
    }
  }
  return n;
}

/** Сколько карточек после фильтров имеют хотя бы один ключ штрихкода для индекса дублей. */
export function countProductsWithEanIndexKeys(products: FpProduct[]): number {
  let n = 0;
  for (const p of products) {
    if (collectEanIndexKeys(p).length > 0) n++;
  }
  return n;
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

/** Слияние строки фида с карточкой /product/info: названия и i18n из API, EAN и фото из фида. */
export function mergeFeedRowWithApiInfo(feed: FpProduct, api: FpProduct): FpProduct {
  const merged = fpProductWithMergedEans(normalizeFpProductListShape(api));
  const eans = [...new Set([...collectEans(merged), ...collectEans(feed)])];
  const feedPv = feed.product_variation;
  const apiPv = merged.product_variation;
  return {
    ...merged,
    id: feed.id,
    name: merged.name || feed.name,
    link: feed.link || merged.link,
    brand: feed.brand ?? merged.brand,
    ...(eans.length ? { eans } : {}),
    ...(feedPv || apiPv
      ? { product_variation: (feedPv ?? apiPv) as FpProduct["product_variation"] }
      : {})
  };
}
