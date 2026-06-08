import type { PodruzhkaFeedRow } from "@/lib/podruzhkaTypes";

export type PodruzhkaCosmeticsFieldKey =
  | "brandName"
  | "productType"
  | "productName"
  | "name"
  | "foto"
  | "fotoImages"
  | "ml"
  | "id"
  | "foto2";

export const PODRUZHKA_COSMETICS_FIELD_LABELS: Record<PodruzhkaCosmeticsFieldKey, string> = {
  brandName: "Бренд на карточке",
  productType: "Тип товара (серый текст)",
  productName: "Название продукта (необязательно)",
  name: "Полное название SKU (name)",
  foto: "Фото товара — одна ссылка",
  fotoImages: "Несколько ссылок на фото (CSV 4Partners)",
  ml: "Объём — не нужен для косметики",
  id: "ID товара (необязательно)",
  foto2: "foto 2 — ссылка на готовую инфографику"
};

export const PODRUZHKA_COSMETICS_FIELD_HINTS: Record<PodruzhkaCosmeticsFieldKey, string> = {
  brandName: "Крупно вверху слева (brand name)",
  productType: "Серая строка на карточке (product_type из Excel)",
  productName: "Колонка product name (если нет — берём name)",
  name: "Колонка name — полное название SKU",
  foto: "Одна ссылка JPG/PNG/WebP",
  fotoImages: "«Изображения варианта» из CSV — выберем лучшее (стандарт косметики уточним)",
  ml: "Не используется на карточке косметики (необязательно)",
  id: "Только для вашего учёта",
  foto2: "Если пусто — программа создаст столбец «foto 2»"
};

export const COSMETICS_SOURCE_EXCEL_FIELDS: PodruzhkaCosmeticsFieldKey[] = [
  "brandName",
  "productType",
  "name",
  "foto",
  "fotoImages",
  "productName",
  "id",
  "foto2"
];

export const COSMETICS_REQUIRED_FEED_FIELDS: PodruzhkaCosmeticsFieldKey[] = [
  "brandName",
  "productType",
  "name",
  "foto"
];

export type PodruzhkaCosmeticsColumnMapping = Partial<
  Record<PodruzhkaCosmeticsFieldKey, number>
>;

export type ExcelHeaderOption = { col: number; label: string };

const GUESS: Record<PodruzhkaCosmeticsFieldKey, string[]> = {
  brandName: ["brand name", "brand", "бренд", "brand_name"],
  productType: ["product_type", "product type", "тип", "категория"],
  productName: ["product name", "product_name", "название продукта"],
  name: ["name", "название", "title"],
  foto: ["foto", "фото", "image url", "картинка"],
  fotoImages: [
    "изображения варианта",
    "variant images",
    "product images",
    "изображение",
    "изображения",
    "images"
  ],
  ml: ["ml", "мл", "г", "gr", "объем", "объём", "volume"],
  id: ["id", "id товара", "sku", "tpv", "tpv_", "артикул", "артикул вариации"],
  foto2: ["foto 2", "foto2", "фото 2"]
};

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

export function guessCosmeticsColumnMapping(
  headers: ExcelHeaderOption[]
): PodruzhkaCosmeticsColumnMapping {
  const map: PodruzhkaCosmeticsColumnMapping = {};
  const used = new Set<number>();

  for (const field of Object.keys(GUESS) as PodruzhkaCosmeticsFieldKey[]) {
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

export function cosmeticsMappingIsComplete(m: PodruzhkaCosmeticsColumnMapping): string | null {
  for (const k of COSMETICS_REQUIRED_FEED_FIELDS) {
    if (k === "foto") {
      const hasFoto = (m.foto && m.foto > 0) || (m.fotoImages && m.fotoImages > 0);
      if (!hasFoto) {
        return "Выберите колонку foto или «Несколько ссылок на фото» (Изображения варианта)";
      }
      continue;
    }
    if (!m[k] || m[k]! < 1) {
      return `Выберите колонку: ${PODRUZHKA_COSMETICS_FIELD_LABELS[k]}`;
    }
  }
  return null;
}

export type PodruzhkaCosmeticsSheetInfo = {
  sheetName: string;
  headerRow: number;
  mapping: PodruzhkaCosmeticsColumnMapping;
  foto2Col: number | null;
  rows: PodruzhkaFeedRow[];
};
