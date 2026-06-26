import { sanitizeTemplateFieldValue } from "@/lib/templateGenerator/fieldValues";
import { yandexTitleLanguageNeedsFix } from "@/lib/templateGenerator/yandexRules";
import { normHeader } from "@/lib/templateGenerator/presets";
import type { CsvColumnMap, FillRowResult } from "@/lib/templateGenerator/types";
import {
  buildCsvIndex,
  normSku,
  type CsvTable
} from "@/lib/templateGenerator/csvIndex";

export type CsvFieldSpec = {
  header: string;
  mode: "ai" | "dropdown_strict";
  allowed?: string[];
};

export type CsvPrefillOutcome = {
  values: Record<string, string>;
  sources: string[];
  csvHeaders: string[];
};

/** Синонимы колонок фида → заголовок шаблона витрины (нормализованный) */
const CSV_SYNONYM_PATTERNS: { template: string; patterns: RegExp[] }[] = [
  {
    template: "верхние ноты",
    patterns: [/верхн.*нот/, /^top\s*note/, /^note\s*1\b/, /^нота\s*1\b/, /note1(?!_desc)/]
  },
  {
    template: "средние ноты",
    patterns: [/средн.*нот/, /heart/, /^middle/, /^note\s*2\b/, /^нота\s*2\b/, /note2(?!_desc)/]
  },
  {
    template: "базовые ноты",
    patterns: [/базов.*нот/, /^base/, /^note\s*3\b/, /^нота\s*3\b/, /note3(?!_desc)/]
  },
  {
    template: "ноты",
    patterns: [/^ноты$/, /^notes$/, /fragrance\s*notes/, /ароматическ.*нот/]
  },
  {
    template: "описание товара",
    patterns: [/^описан/, /^description/, /^desc\b/, /product\s*desc/, /полное\s*описан/]
  },
  {
    template: "семейство",
    patterns: [/^семейств/, /^family/, /olfactory\s*family/, /ароматическ.*семейств/]
  },
  {
    template: "тип",
    patterns: [/^тип$/, /^type$/, /^product\s*type$/, /^product_type$/]
  },
  {
    template: "пол",
    patterns: [/^пол$/, /^gender$/, /^sex$/]
  },
  {
    template: "название товара",
    patterns: [/^название/, /^name$/, /^product\s*name$/, /^product_name$/]
  },
  {
    template: "бренд",
    patterns: [/^бренд$/, /^brand/]
  },
  {
    template: "линейка",
    patterns: [/^линейк/, /^line$/, /^collection$/]
  },
  {
    template: "объем флакона, мл",
    patterns: [/^объем/, /^объём/, /^volume/, /^ml\b/, /\bмл\b/]
  }
];

function normTemplateKey(header: string): string {
  return normHeader(header);
}

function isModelNameTemplate(header: string): boolean {
  return /^название модели/.test(normTemplateKey(header));
}

function pickCsvValue(csvData: Record<string, string>, csvHeader: string): string {
  const direct = csvData[csvHeader]?.trim();
  if (direct) return direct;
  const prefixed = csvData[`csv:${csvHeader}`]?.trim();
  if (prefixed) return prefixed;
  return "";
}

function findCsvKeyForTemplate(
  templateHeader: string,
  csvData: Record<string, string>
): string | null {
  const tn = normTemplateKey(templateHeader);
  if (pickCsvValue(csvData, templateHeader)) return templateHeader;

  for (const [k, v] of Object.entries(csvData)) {
    if (!v.trim()) continue;
    const rawKey = k.startsWith("csv:") ? k.slice(4) : k;
    const cn = normHeader(rawKey);
    if (cn === tn) return rawKey;
    if (isModelNameTemplate(templateHeader)) {
      if (/^модель/.test(cn) || cn === "model" || cn === "model name") return rawKey;
      continue;
    }
    if (tn.includes("товара") && (cn === "название" || cn === "name" || cn === "product name")) {
      return rawKey;
    }
    if (cn.includes(tn) || (tn.includes(cn) && cn.length >= 8)) return rawKey;
  }

  const syn = CSV_SYNONYM_PATTERNS.find((s) => s.template === tn || tn.startsWith(s.template));
  if (syn) {
    for (const [k, v] of Object.entries(csvData)) {
      if (!v.trim()) continue;
      const rawKey = k.startsWith("csv:") ? k.slice(4) : k;
      const cn = normHeader(rawKey);
      if (syn.patterns.some((re) => re.test(cn) || re.test(rawKey))) return rawKey;
    }
  }

  return null;
}

function applyDropdownValue(value: string, allowed?: string[], header = ""): string | null {
  return sanitizeTemplateFieldValue(header, value, {
    allowed,
    dropdownStrict: true
  });
}

/** Попытка вытащить ноты из одного текстового поля (описание в фиде) */
function parseNotesFromBlob(
  text: string,
  fields: CsvFieldSpec[]
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!text.trim()) return out;

  const byNorm = new Map(fields.map((f) => [normTemplateKey(f.header), f.header]));

  const rules: { template: string; re: RegExp }[] = [
    { template: "верхние ноты", re: /верхн(?:ие|я)\s+нот[ыа]?\s*[:\-—]\s*([^\n;|]+)/i },
    { template: "средние ноты", re: /(?:средн(?:ие|яя)\s+нот[ыа]?|нот[ыа]?\s+сердца)\s*[:\-—]\s*([^\n;|]+)/i },
    { template: "базовые ноты", re: /(?:базов(?:ые|ая)\s+нот[ыа]?|шлейф)\s*[:\-—]\s*([^\n;|]+)/i },
    { template: "ноты", re: /^(?:ноты|notes)\s*[:\-—]\s*([^\n;|]+)/im }
  ];

  for (const rule of rules) {
    const header = byNorm.get(rule.template);
    if (!header || out[header]) continue;
    const m = text.match(rule.re);
    const val = m?.[1]?.trim();
    if (val && val.length >= 2) out[header] = val;
  }

  return out;
}

export function prefillFromCsvData(
  csvData: Record<string, string>,
  fields: CsvFieldSpec[],
  templateCells: Record<string, string>,
  opts?: { keepTemplateFilled?: boolean }
): CsvPrefillOutcome {
  const keepTemplate = opts?.keepTemplateFilled !== false;
  const values: Record<string, string> = {};
  const sources: string[] = [];
  const csvHeaders: string[] = [];

  for (const field of fields) {
    if (isModelNameTemplate(field.header)) continue;

    const existing = templateCells[field.header]?.trim();
    if (existing && keepTemplate) {
      values[field.header] = existing;
      sources.push(`${field.header}: шаблон`);
      continue;
    }

    const csvKey = findCsvKeyForTemplate(field.header, csvData);
    if (csvKey) {
      const raw = pickCsvValue(csvData, csvKey);
      if (raw) {
        const v =
          field.mode === "dropdown_strict"
            ? applyDropdownValue(raw, field.allowed, field.header) ?? ""
            : raw;
        if (v) {
          if (
            normTemplateKey(field.header) === "название товара" &&
            yandexTitleLanguageNeedsFix(v)
          ) {
            continue;
          }
          values[field.header] = v;
          csvHeaders.push(field.header);
          sources.push(`${field.header}: CSV «${csvKey}»`);
        }
      }
    }
  }

  const descKey = findCsvKeyForTemplate("Описание товара", csvData);
  const desc =
    (descKey ? pickCsvValue(csvData, descKey) : "") ||
    Object.entries(csvData).find(([k]) => /описан|description|desc/i.test(k))?.[1]?.trim() ||
    "";

  if (desc) {
    const parsed = parseNotesFromBlob(desc, fields);
    for (const [header, val] of Object.entries(parsed)) {
      if (values[header]?.trim()) continue;
      values[header] = val;
      csvHeaders.push(header);
      sources.push(`${header}: из описания в CSV`);
    }
  }

  return { values, sources, csvHeaders };
}

export function collectTemplateSkus(skus: string[]): Set<string> {
  const out = new Set<string>();
  for (const s of skus) {
    const n = normSku(s);
    if (n) out.add(n);
  }
  return out;
}

export function filterCsvTableToSkus(
  table: CsvTable,
  map: CsvColumnMap,
  skus: Set<string>
): { table: CsvTable; matchedSkus: number; totalTemplateSkus: number } {
  if (!map.skuColumn || skus.size === 0) {
    return { table, matchedSkus: 0, totalTemplateSkus: skus.size };
  }
  const skuIdx = table.headers.indexOf(map.skuColumn);
  if (skuIdx < 0) {
    return { table, matchedSkus: 0, totalTemplateSkus: skus.size };
  }

  const need = new Set(skus);
  const rows: string[][] = [];
  const seen = new Set<string>();

  for (const row of table.rows) {
    const sku = normSku(String(row[skuIdx] ?? ""));
    if (!sku || !need.has(sku)) continue;
    rows.push(row);
    seen.add(sku);
  }

  return {
    table: { headers: table.headers, rows },
    matchedSkus: seen.size,
    totalTemplateSkus: skus.size
  };
}

export function summarizeCsvCoverage(
  table: CsvTable,
  map: CsvColumnMap,
  templateSkus: Set<string>
): { found: number; total: number; missing: number } {
  if (!templateSkus.size || !map.skuColumn) {
    return { found: 0, total: templateSkus.size, missing: templateSkus.size };
  }
  const idx = buildCsvIndex(table, map);
  let found = 0;
  for (const sku of templateSkus) {
    if (idx.has(sku)) found++;
  }
  return { found, total: templateSkus.size, missing: templateSkus.size - found };
}

export function countFillModes(results: FillRowResult[]): {
  csvOnly: number;
  mixed: number;
  aiOnly: number;
} {
  let csvOnly = 0;
  let mixed = 0;
  let aiOnly = 0;
  for (const r of results) {
    const modes = r.sources.filter((s) => s.includes(": CSV") || s.includes(": из описания"));
    const hasCsv = modes.length > 0;
    const hasAi = r.sources.some((s) => s.includes("AI") || s.includes("сайт бренда"));
    if (hasCsv && !hasAi) csvOnly++;
    else if (hasCsv && hasAi) mixed++;
    else aiOnly++;
  }
  return { csvOnly, mixed, aiOnly };
}

/** Улучшенное сопоставление колонок фида с шаблоном (дополняет эвристику) */
export function enhanceCsvColumnMap(
  table: CsvTable,
  templateHeaders: string[],
  base: CsvColumnMap
): CsvColumnMap {
  const columns = { ...base.columns };

  for (const th of templateHeaders) {
    if (columns[th]) continue;
    const tn = normTemplateKey(th);
    const syn = CSV_SYNONYM_PATTERNS.find((s) => tn === s.template || tn.startsWith(s.template));
    if (!syn) continue;

    for (const ch of table.headers) {
      const cn = normHeader(ch);
      if (syn.patterns.some((re) => re.test(cn) || re.test(ch))) {
        columns[th] = ch;
        break;
      }
    }
  }

  return { skuColumn: base.skuColumn, columns };
}
