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
  brandName: "Бренд на карточке",
  productType: "Тип товара (серый текст)",
  productName: "Название аромата в фиде",
  name: "Полное название (для AI)",
  foto: "Фото товара — исходная ссылка",
  ml: "Объём (мл)",
  id: "ID товара (необязательно)",
  foto2: "foto 2 — ссылка на готовую инфографику"
};

/** Подсказка: какая колонка Excel → что на картинке */
export const PODRUZHKA_FIELD_HINTS: Record<PodruzhkaFieldKey, string> = {
  brandName: "Крупно вверху слева (brand name)",
  productType: "Серая строка на карточке (product_type из Excel)",
  productName: "Колонка product name в вашем фиде",
  name: "Колонка name — по ней AI ищет аромат в интернете",
  foto: "Ссылка на JPG/PNG товара (текст или гиперссылка в ячейке)",
  ml: "Например 60 или 100 мл — внизу карточки",
  id: "Только для вашего учёта",
  foto2: "Если пусто — программа создаст столбец «foto 2»"
};

/** Сопоставляете один раз — колонки из вашего Excel */
export const SOURCE_EXCEL_FIELDS: PodruzhkaFieldKey[] = [
  "brandName",
  "productType",
  "productName",
  "name",
  "foto",
  "ml",
  "id",
  "foto2"
];

/** Для AI на шаге 1 */
export const NOTES_AI_FIELDS: PodruzhkaFieldKey[] = [
  "brandName",
  "productType",
  "productName",
  "name"
];

export const REQUIRED_FEED_FIELDS: PodruzhkaFieldKey[] = [
  "brandName",
  "productType",
  "productName",
  "name",
  "foto",
  "ml"
];

export function mappingIsCompleteForNotes(m: PodruzhkaColumnMapping): string | null {
  for (const k of NOTES_AI_FIELDS) {
    if (!m[k] || m[k]! < 1) {
      return `Для шага 1 выберите колонку: ${PODRUZHKA_FIELD_LABELS[k]}`;
    }
  }
  return null;
}

export type PodruzhkaColumnMapping = Partial<Record<PodruzhkaFieldKey, number>>;

export type ExcelHeaderOption = { col: number; label: string };

const GUESS: Record<PodruzhkaFieldKey, string[]> = {
  brandName: ["brand name", "brand", "бренд", "brand_name"],
  productType: ["product_type", "product type", "тип", "описание товара"],
  productName: ["product name", "product_name", "название аромата"],
  name: ["name", "название", "title"],
  foto: ["foto", "фото", "image", "картинка"],
  ml: ["ml", "мл", "объем", "объём", "volume"],
  id: ["id", "id товара", "sku", "tpv", "артикул", "offer id"],
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
      if (GUESS[field].some((g) => n === norm(g))) {
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
