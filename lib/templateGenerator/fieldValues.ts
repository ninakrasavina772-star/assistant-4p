import { normHeader } from "@/lib/templateGenerator/presets";

/** Числовой ID параметра маркетплейса / фида (не значение для ячейки) */
export function isLikelyMarketplaceParamId(value: string): boolean {
  const v = String(value ?? "").trim();
  return /^\d{4,}$/.test(v);
}

export function valuesLookLikeMarketplaceIds(values: string[]): boolean {
  const sample = values.filter(Boolean).slice(0, 40);
  if (sample.length < 3) return false;
  const numeric = sample.filter((v) => isLikelyMarketplaceParamId(v)).length;
  return numeric / sample.length >= 0.75;
}

export function isSkuLikeValue(value: string, sku: string): boolean {
  const v = String(value ?? "").replace(/\D/g, "");
  const s = String(sku ?? "").replace(/\D/g, "");
  if (!v || !s) return false;
  return v === s || (v.length >= 5 && s.includes(v)) || (s.length >= 5 && v.includes(s));
}

const FREE_TEXT_HEADERS = new Set(
  [
    "состав",
    "состав набора",
    "описание товара",
    "название товара",
    "дополнительная информация",
    "прочие характеристики"
  ].map(normHeader)
);

/** Отбраковать артикулы и ID в характеристиках с выпадающим списком */
export function sanitizeTemplateFieldValue(
  header: string,
  value: string,
  opts?: {
    sku?: string;
    allowed?: string[];
    dropdownStrict?: boolean;
  }
): string | null {
  const v = String(value ?? "").trim();
  if (!v) return null;

  const h = normHeader(header);
  const allowed = opts?.allowed?.filter(Boolean) ?? [];
  const hasAllowed = allowed.length > 0;
  const allowedAreIds = hasAllowed && valuesLookLikeMarketplaceIds(allowed);

  if (opts?.sku && isSkuLikeValue(v, opts.sku) && !isSkuHeaderName(h)) {
    return null;
  }

  if (isLikelyMarketplaceParamId(v)) {
    if (hasAllowed && !allowedAreIds) {
      const exact = allowed.find((a) => a.trim() === v);
      if (!exact) return null;
    } else if (!FREE_TEXT_HEADERS.has(h)) {
      return null;
    }
  }

  if (hasAllowed && !allowedAreIds && opts?.dropdownStrict !== false) {
    const exact = allowed.find((a) => a.toLowerCase() === v.toLowerCase());
    if (exact) return exact;
    const partial = allowed.find(
      (a) =>
        a.toLowerCase().includes(v.toLowerCase()) ||
        v.toLowerCase().includes(a.toLowerCase())
    );
    if (partial) return partial;
    if (opts?.dropdownStrict) return null;
  }

  return v;
}

function isSkuHeaderName(h: string): boolean {
  return /^(ваш\s+)?sku|артикул|shop[-\s]?sku/.test(h) || h.includes("артикул товара");
}

/** Найти колонку на листе «Список значений» по заголовку шаблона */
export function findListSheetValues(
  header: string,
  listValues: Map<string, string[]>,
  mappedName: string | null
): string[] {
  if (mappedName) {
    const hit = listValues.get(mappedName);
    if (hit?.length) return hit;
  }
  const nh = normHeader(header);
  for (const [name, vals] of listValues) {
    if (normHeader(name) === nh && vals.length) return vals;
  }
  return [];
}

/** Excel validation иногда ссылается на ID — для AI нужны текстовые значения */
export function filterHumanDropdownValues(values: string[]): string[] {
  if (!values.length) return [];
  if (valuesLookLikeMarketplaceIds(values)) return [];
  return values;
}
