import { mergeBrandLists, normalizeBrandName, parseBrandListFromText } from "./brand-filter";
import { extractModelLine } from "./nameModel";
import type { FpProduct } from "./types";

/** Список моделей: те же разделители, что у брендов (столбик, запятая, …) */
export { parseBrandListFromText as parseModelListFromText, mergeBrandLists as mergeModelLists };

export type ModelMatchMode = "exact" | "contains";

function displayNameRu(p: FpProduct): string {
  const base = p.name || "";
  return p.i18n?.ru?.name?.trim() || base;
}

function displayNameEn(p: FpProduct): string {
  const base = p.name || "";
  return p.i18n?.en?.name?.trim() || base;
}

const norm = normalizeBrandName;

/**
 * Сводная нормализованная строка по названиям (RU+EN) и «модельным» срезам — для вхождений.
 */
export function productModelHaystackNorm(p: FpProduct): string {
  const brand = p.brand?.name || "";
  const ru = displayNameRu(p);
  const en = displayNameEn(p);
  const base = p.name || "";
  return norm(
    [
      extractModelLine(ru, brand),
      extractModelLine(en, brand),
      ru,
      en,
      base
    ]
      .filter((s) => s && s.trim())
      .join(" ")
  );
}

/**
 * Оставляем товары, у которых в названии/модельной части совпала хотя бы одна строка из списка.
 * Пустой список — без фильтра.
 */
export function filterFpProductsByModels(
  products: FpProduct[],
  modelLabels: string[],
  matchMode: ModelMatchMode = "contains"
): { products: FpProduct[]; excludedNotInList: number } {
  if (modelLabels.length === 0) {
    return { products: [...products], excludedNotInList: 0 };
  }
  const listQ = modelLabels
    .map((m) => norm(m))
    .filter((s) => s.length > 0);
  if (listQ.length === 0) {
    return { products: [...products], excludedNotInList: 0 };
  }
  const out: FpProduct[] = [];
  let excludedNotInList = 0;
  for (const p of products) {
    const brand = p.brand?.name || "";
    const ru = displayNameRu(p);
    const en = displayNameEn(p);
    const mRu = norm(extractModelLine(ru, brand));
    const mEn = norm(extractModelLine(en, brand));
    const hay = productModelHaystackNorm(p);
    const fullRu = norm(ru);
    const fullEn = norm(en);
    const fullBase = norm(p.name || "");
    let ok = false;
    if (matchMode === "contains") {
      for (const q of listQ) {
        if (!q) continue;
        if (
          hay.includes(q) ||
          mRu.includes(q) ||
          mEn.includes(q) ||
          fullRu.includes(q) ||
          fullEn.includes(q) ||
          fullBase.includes(q)
        ) {
          ok = true;
          break;
        }
      }
    } else {
      for (const q of listQ) {
        if (!q) continue;
        if (
          mRu === q ||
          mEn === q ||
          fullRu === q ||
          fullEn === q ||
          fullBase === q
        ) {
          ok = true;
          break;
        }
      }
    }
    if (ok) {
      out.push(p);
    } else {
      excludedNotInList += 1;
    }
  }
  return { products: out, excludedNotInList };
}
