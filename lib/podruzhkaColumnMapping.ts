import type { PodruzhkaFeedRow } from "@/lib/podruzhkaTypes";

/** Поля фида → колонки Excel (номер столбца 1-based) */
export type PodruzhkaFieldKey =
  | "brandName"
  | "productType"
  | "productName"
  | "name"
  | "foto"
  | "ml"
  | "id"
  | "foto2";

export const PODRUZHKA_FIELD_LABELS: Record<PodruzhkaFieldKey, string> = {
  brandName: "Бренд (CAROLINA HERRERA)",
  productType: "Тип товара (туалетная вода мужская)",
  productName: "Название в фиде (product name)",
  name: "Полное name (для AI)",
  foto: "Фото товара (foto)",
  ml: "Объём (ml)",
  id: "ID (необязательно)",
  foto2: "foto 2 — куда писать инфографику (необязательно)"
};

export const REQUIRED_FEED_FIELDS: PodruzhkaFieldKey[] = [
  "brandName",
  "productType",
  "productName",
  "name",
  "foto",
  "ml"
];

export type PodruzhkaColumnMapping = Partial<Record<PodruzhkaFieldKey, number>>;

export type ExcelHeaderOption = { col: number; label: string };

const GUESS: Record<PodruzhkaFieldKey, string[]> = {
  brandName: ["brand name", "brand", "бренд", "brand_name"],
  productType: ["product_type", "product type", "тип", "описание товара"],
  productName: ["product name", "product_name", "название аромата"],
  name: ["name", "название", "title"],
  foto: ["foto", "фото", "image", "картинка"],
  ml: ["ml", "мл", "объем", "объём", "volume"],
  id: ["id", "id товара", "sku"],
  foto2: ["foto 2", "foto2", "фото 2"]
};

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

export function guessColumnMapping(headers: ExcelHeaderOption[]): PodruzhkaColumnMapping {
  const map: PodruzhkaColumnMapping = {};
  const used = new Set<number>();

  for (const field of Object.keys(GUESS) as PodruzhkaFieldKey[]) {
    for (const h of headers) {
      if (used.has(h.col)) continue;
      const n = norm(h.label);
      if (GUESS[field].some((g) => n === g || n.includes(g))) {
        map[field] = h.col;
        used.add(h.col);
        break;
      }
    }
  }
  return map;
}

export function mappingIsComplete(m: PodruzhkaColumnMapping): string | null {
  for (const k of REQUIRED_FEED_FIELDS) {
    if (!m[k] || m[k]! < 1) {
      return `Выберите колонку: ${PODRUZHKA_FIELD_LABELS[k]}`;
    }
  }
  return null;
}

export type PodruzhkaSheetInfo = {
  sheetName: string;
  headerRow: number;
  mapping: PodruzhkaColumnMapping;
  foto2Col: number | null;
  rows: PodruzhkaFeedRow[];
};
