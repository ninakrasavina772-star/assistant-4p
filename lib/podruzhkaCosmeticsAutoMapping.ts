import {
  COSMETICS_REQUIRED_FEED_FIELDS,
  PODRUZHKA_COSMETICS_FIELD_LABELS,
  type ExcelHeaderOption,
  type PodruzhkaCosmeticsColumnMapping,
  type PodruzhkaCosmeticsFieldKey
} from "@/lib/podruzhkaCosmeticsColumnMapping";
import { PODRUZHKA_COSMETICS_AI_COLUMN_DEFS } from "@/lib/podruzhkaCosmeticsTypes";

const TEMPLATE_HEADERS: Record<PodruzhkaCosmeticsFieldKey, string[]> = {
  name: ["name"],
  brandName: ["brand name"],
  productType: ["product_type", "product type"],
  productName: ["product name"],
  foto: ["foto"],
  ml: ["ml"],
  id: ["id", "sku", "offer id"],
  foto2: ["foto 2", "foto2"]
};

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

export type CosmeticsDetectedColumn = {
  role: string;
  header: string;
  col: number;
};

export type CosmeticsAutoDetectResult = {
  mapping: PodruzhkaCosmeticsColumnMapping;
  feedColumns: CosmeticsDetectedColumn[];
  textColumns: CosmeticsDetectedColumn[];
  missing: PodruzhkaCosmeticsFieldKey[];
  isReady: boolean;
};

export function autoDetectCosmeticsMapping(
  headers: ExcelHeaderOption[]
): CosmeticsAutoDetectResult {
  const mapping: PodruzhkaCosmeticsColumnMapping = {};
  const used = new Set<number>();
  const feedColumns: CosmeticsDetectedColumn[] = [];
  const textColumns: CosmeticsDetectedColumn[] = [];

  const fields: PodruzhkaCosmeticsFieldKey[] = [
    "name",
    "brandName",
    "productType",
    "productName",
    "foto",
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
          role: PODRUZHKA_COSMETICS_FIELD_LABELS[field],
          header: h.label,
          col: h.col
        });
        break;
      }
    }
  }

  for (const def of PODRUZHKA_COSMETICS_AI_COLUMN_DEFS) {
    const wants = def.aliases.map(norm);
    for (const h of headers) {
      if (used.has(h.col)) continue;
      if (wants.includes(norm(h.label))) {
        used.add(h.col);
        textColumns.push({ role: def.header, header: h.label, col: h.col });
        break;
      }
    }
  }

  const missing = COSMETICS_REQUIRED_FEED_FIELDS.filter((k) => !mapping[k]);
  return {
    mapping,
    feedColumns,
    textColumns,
    missing,
    isReady: missing.length === 0
  };
}
