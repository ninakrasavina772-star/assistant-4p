import { pickComparableName } from "./product";
import { normAttrValue } from "./productAttributes";
import type { CompareProduct, NameLocale } from "./types";

/** Канонический id оттенка для сравнения пар в режиме «2 рубрики». */
export type CrossRubricColorVerdict = "match" | "conflict" | "unknown";

/** Многословные цвета — проверяем раньше одиночных слов. */
const COLOR_PHRASES: { pattern: string; id: string }[] = [
  { pattern: "sky blue", id: "sky_blue" },
  { pattern: "light blue", id: "light_blue" },
  { pattern: "dark blue", id: "dark_blue" },
  { pattern: "navy blue", id: "navy" },
  { pattern: "royal blue", id: "royal_blue" },
  { pattern: "ice blue", id: "light_blue" },
  { pattern: "powder blue", id: "light_blue" },
  { pattern: "hot pink", id: "pink" },
  { pattern: "light pink", id: "pink" },
  { pattern: "dark pink", id: "pink" },
  { pattern: "rose gold", id: "rose_gold" },
  { pattern: "off white", id: "white" },
  { pattern: "dark green", id: "dark_green" },
  { pattern: "light green", id: "light_green" },
  { pattern: "dark grey", id: "grey" },
  { pattern: "dark gray", id: "grey" },
  { pattern: "light grey", id: "grey" },
  { pattern: "light gray", id: "grey" }
];

/** Одиночные токены (EN / ES / RU) → канонический id. */
const COLOR_WORD_TO_ID: Record<string, string> = {
  pink: "pink",
  rose: "pink",
  rosa: "pink",
  fucsia: "pink",
  fuchsia: "pink",
  magenta: "magenta",
  розовый: "pink",
  розовая: "pink",
  розовое: "pink",
  розовые: "pink",
  роза: "pink",
  blue: "blue",
  azul: "blue",
  синий: "blue",
  синяя: "blue",
  синее: "blue",
  синие: "blue",
  celeste: "sky_blue",
  голубой: "sky_blue",
  голубая: "sky_blue",
  голубое: "sky_blue",
  голубые: "sky_blue",
  navy: "navy",
  marino: "navy",
  red: "red",
  rojo: "red",
  красный: "red",
  красная: "red",
  black: "black",
  negro: "black",
  noir: "black",
  черный: "black",
  черная: "black",
  white: "white",
  blanco: "white",
  blanc: "white",
  белый: "white",
  белая: "white",
  green: "green",
  verde: "green",
  зеленый: "green",
  зелёный: "green",
  зеленая: "green",
  зелёная: "green",
  yellow: "yellow",
  amarillo: "yellow",
  желтый: "yellow",
  жёлтый: "yellow",
  orange: "orange",
  naranja: "orange",
  оранжевый: "orange",
  purple: "purple",
  morado: "purple",
  violet: "purple",
  violeta: "purple",
  фиолетовый: "purple",
  grey: "grey",
  gray: "grey",
  gris: "grey",
  серый: "grey",
  beige: "beige",
  brown: "brown",
  marron: "brown",
  коричневый: "brown",
  gold: "gold",
  dorado: "gold",
  золотой: "gold",
  silver: "silver",
  plateado: "silver",
  серебряный: "silver",
  turquoise: "turquoise",
  бирюзовый: "turquoise",
  coral: "coral",
  коралловый: "coral",
  burgundy: "burgundy",
  бордовый: "burgundy",
  khaki: "khaki",
  хаки: "khaki",
  olive: "olive",
  оливковый: "olive",
  cream: "cream",
  кремовый: "cream",
  ivory: "ivory",
  nude: "nude",
  телесный: "nude",
  tan: "tan",
  bronze: "bronze",
  бронзовый: "bronze",
  copper: "copper",
  lavender: "lavender",
  лавандовый: "lavender",
  lilac: "lilac",
  сиреневый: "lilac",
  mint: "mint",
  мятный: "mint",
  peach: "peach",
  персиковый: "peach",
  salmon: "salmon",
  лососевый: "salmon",
  wine: "wine",
  charcoal: "charcoal",
  graphite: "graphite"
};

function normalizeColorText(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[/_-]+/g, " ")
    .replace(/\s+/g, " ");
}

function colorIdsFromFreeText(text: string): Set<string> {
  const out = new Set<string>();
  const norm = normalizeColorText(text);
  if (!norm) return out;

  let masked = ` ${norm} `;
  for (const { pattern, id } of COLOR_PHRASES) {
    const re = new RegExp(`\\b${pattern.replace(/\s+/g, "\\s+")}\\b`, "gi");
    if (!re.test(masked)) continue;
    out.add(id);
    masked = masked.replace(re, " ");
  }

  for (const [word, id] of Object.entries(COLOR_WORD_TO_ID)) {
    const re = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (re.test(masked)) out.add(id);
  }
  return out;
}

function colorIdsFromAttrValue(raw: string | undefined): Set<string> {
  if (!raw?.trim()) return new Set();
  const norm = normAttrValue(raw);
  if (!norm) return new Set();
  const fromText = colorIdsFromFreeText(norm);
  if (fromText.size) return fromText;
  /** Значение атрибута целиком — например «Sky Blue» без отдельного словарного токена. */
  const compact = norm.replace(/\s+/g, "_");
  if (compact.length >= 3) fromText.add(compact);
  return fromText;
}

function toneOrColorLabel(c: CompareProduct): string | undefined {
  const s = c.attrShade?.trim() || c.attrColor?.trim();
  return s || undefined;
}

/** Собрать канонические id цветов из атрибутов и названия. */
export function collectCrossRubricColorIds(
  c: CompareProduct,
  rawName?: string,
  nameLocale?: NameLocale
): Set<string> {
  const out = new Set<string>();
  for (const id of colorIdsFromAttrValue(c.attrShade)) out.add(id);
  for (const id of colorIdsFromAttrValue(c.attrColor)) out.add(id);
  const attrLabel = toneOrColorLabel(c);
  if (attrLabel) {
    for (const id of colorIdsFromFreeText(attrLabel)) out.add(id);
  }
  const name = rawName?.trim() || pickComparableName(c, nameLocale ?? "ru");
  for (const id of colorIdsFromFreeText(name)) out.add(id);
  return out;
}

/**
 * Совпадение / конфликт / неизвестно по цвету (бренд+модель могут совпасть, цвет — нет).
 * unknown — цвет явно указан только с одной стороны или нигде.
 */
export function crossRubricColorVerdict(
  cA: CompareProduct,
  cB: CompareProduct,
  nameA?: string,
  nameB?: string,
  nameLocale?: NameLocale
): CrossRubricColorVerdict {
  const idsA = collectCrossRubricColorIds(cA, nameA, nameLocale);
  const idsB = collectCrossRubricColorIds(cB, nameB, nameLocale);
  if (!idsA.size || !idsB.size) return "unknown";
  for (const id of idsA) {
    if (idsB.has(id)) return "match";
  }
  return "conflict";
}

export function crossRubricPairBlockedByColor(
  cA: CompareProduct,
  cB: CompareProduct,
  nameA?: string,
  nameB?: string,
  nameLocale?: NameLocale
): boolean {
  return crossRubricColorVerdict(cA, cB, nameA, nameB, nameLocale) === "conflict";
}
