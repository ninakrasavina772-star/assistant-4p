import {
  PODRUZHKA_FIELD_LABELS,
  REQUIRED_FEED_FIELDS,
  type ExcelHeaderOption,
  type PodruzhkaColumnMapping,
  type PodruzhkaFieldKey
} from "@/lib/podruzhkaColumnMapping";

/** Заголовки как в образец.xlsx — точное совпадение */
const TEMPLATE_HEADERS: Record<PodruzhkaFieldKey, string[]> = {
  name: ["name"],
  brandName: ["brand name"],
  productType: ["product_type", "product type"],
  productName: ["product name"],
  foto: ["foto"],
  fotoImages: [
    "изображения варианта",
    "variant images",
    "product images",
    "изображение",
    "изображения"
  ],
  ml: ["ml"],
  id: ["id", "sku", "offer id", "variation_id", "variation id", "tpv"],
  foto2: ["foto 2", "foto2"]
};

const AI_TEMPLATE_HEADERS = [
  "note 1",
  "note 1 (2)",
  "note 2",
  "note 2 (1)",
  "note 3",
  "note 3 (1)",
  "model",
  "foto 3"
] as const;

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

export type DetectedColumn = {
  role: string;
  header: string;
  col: number;
};

export type AutoDetectResult = {
  mapping: PodruzhkaColumnMapping;
  feedColumns: DetectedColumn[];
  aiColumns: DetectedColumn[];
  missing: PodruzhkaFieldKey[];
  isReady: boolean;
};

/**
 * Распознаёт фид по шаблону Подружка (без ручного сопоставления).
 * Каждый столбец — только точное имя заголовка, чтобы foto ≠ foto 2.
 */
export function autoDetectPodruzhkaMapping(headers: ExcelHeaderOption[]): AutoDetectResult {
  const mapping: PodruzhkaColumnMapping = {};
  const used = new Set<number>();
  const feedColumns: DetectedColumn[] = [];
  const aiColumns: DetectedColumn[] = [];

  const fields: PodruzhkaFieldKey[] = [
    "name",
    "brandName",
    "productType",
    "productName",
    "foto",
    "fotoImages",
    "ml",
    "foto2",
    "id"
  ];

  for (const field of fields) {
    const wants = (TEMPLATE_HEADERS[field] ?? []).map(norm);
    for (const h of headers) {
      if (used.has(h.col)) continue;
      if (wants.includes(norm(h.label))) {
        mapping[field] = h.col;
        used.add(h.col);
        feedColumns.push({
          role: PODRUZHKA_FIELD_LABELS[field],
          header: h.label,
          col: h.col
        });
        break;
      }
    }
  }

  for (const want of AI_TEMPLATE_HEADERS) {
    const w = norm(want);
    for (const h of headers) {
      if (used.has(h.col)) continue;
      if (norm(h.label) === w) {
        used.add(h.col);
        aiColumns.push({ role: want, header: h.label, col: h.col });
        break;
      }
    }
  }

  const missing = REQUIRED_FEED_FIELDS.filter((k) => !mapping[k]);
  return {
    mapping,
    feedColumns,
    aiColumns,
    missing,
    isReady: missing.length === 0
  };
}
