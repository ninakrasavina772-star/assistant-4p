import {
  mergeBrandLists,
  normalizeBrandName,
  parseBrandListFromText,
  productBrandName
} from "./brand-filter";
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

/** Все текстовые названия товара для поиска модели (витрина + оригинал поставщика). */
function allProductTitleSources(p: FpProduct): string[] {
  const raw = [
    displayNameRu(p),
    displayNameEn(p),
    p.name,
    p.original_name,
    p.name_original,
    p.supplier_name
  ];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of raw) {
    if (x == null || typeof x !== "string") continue;
    const t = x.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/**
 * Нормализованные фрагменты: полные названия и «модельная» часть после снятия бренда.
 */
function modelNormTokensForProduct(p: FpProduct): string[] {
  const brand = productBrandName(p);
  const tokens = new Set<string>();
  for (const raw of allProductTitleSources(p)) {
    const full = norm(raw);
    if (full) tokens.add(full);
    const line = norm(extractModelLine(raw, brand));
    if (line) tokens.add(line);
  }
  return [...tokens];
}

/**
 * Сводная строка для вхождений (совместимость с прежней логикой).
 */
export function productModelHaystackNorm(p: FpProduct): string {
  return norm(modelNormTokensForProduct(p).join(" "));
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
    const tokens = modelNormTokensForProduct(p);
    const hay = tokens.join(" ");
    let ok = false;
    if (matchMode === "contains") {
      for (const q of listQ) {
        if (!q) continue;
        for (const t of tokens) {
          if (t.includes(q) || q.includes(t)) {
            ok = true;
            break;
          }
        }
        if (ok) break;
        if (hay.includes(q)) {
          ok = true;
          break;
        }
      }
    } else {
      for (const q of listQ) {
        if (!q) continue;
        if (tokens.some((t) => t === q)) {
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
