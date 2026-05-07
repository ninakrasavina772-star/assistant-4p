import { nameSimilarity, normalizeComparableName } from "./nameSimilarity";

/**
 * Тип товара (концентрация / категория парфюмерии и т.п.), часто в конце после « — ».
 * Без снятия этого хвоста «Historic Olmeda» и «Historic Doria» дают высокое сходство из‑за общего
 * «Eau de Parfum», а короткая модель выглядит как префикс длинной («9 PM» vs «9 PM Rebel»).
 */
const PRODUCT_TYPE_PHRASE =
  "туалетная\\s+вода|парфюм(?:ная\\s+вода|ерная\\s+вода)?|" +
  "тестер|парфюмный\\s+набор|" +
  "eau\\s+de\\s+toilette|eau\\s+de\\s+parfum|eau\\s+de\\s+cologne|eau\\s+de\\s+col|" +
  "extrait\\s+de\\s+parfum|" +
  "edt|edp|edc|" +
  "одеколон|парфюм(?:ерная)?\\s+вода";

/**
 * Снимаем с начала/из названия тип товара и дубли бренда — остаётся «линейка/модель»
 * (например: «Jimmy Choo Man», «Man Aqua»), что стабильнее сырого заголовка.
 */
const LEADING_PRODUCT_TYPE = new RegExp(`^(?:${PRODUCT_TYPE_PHRASE})\\s*`, "iu");

function escapeReg(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Хвост « — Eau de Parfum» / « - EDT» или просто « … eau de parfum» в конце строки. */
function stripTrailingProductTypes(raw: string): string {
  let s = raw.trim();
  const dashed = new RegExp(
    `(?:\\s*[-–—]\\s+|\\s+-\\s+)(?:${PRODUCT_TYPE_PHRASE})(?:\\b\\s*)?$`,
    "iu"
  );
  const trailingBare = new RegExp(`(?:\\s+|^)(?:${PRODUCT_TYPE_PHRASE})(?:\\b\\s*)?$`, "iu");
  for (let i = 0; i < 5; i++) {
    const next = s.replace(dashed, "").replace(trailingBare, "").trim();
    if (next === s) break;
    s = next;
  }
  return s;
}

/**
 * Одна модель — явное расширение другой (те же токены сначала + ещё слова): «9 pm» vs «9 pm rebel».
 * Не считаем конфликтом разную длину без префикса (Olmeda vs Doria).
 */
export function modelLineStrictPrefixExtensionConflict(modelA: string, modelB: string): boolean {
  const ta = normalizeComparableName(modelA).split(/\s+/).filter(Boolean);
  const tb = normalizeComparableName(modelB).split(/\s+/).filter(Boolean);
  let shortTok = ta;
  let longTok = tb;
  if (tb.length < ta.length) {
    shortTok = tb;
    longTok = ta;
  }
  if (longTok.length <= shortTok.length) return false;
  for (let i = 0; i < shortTok.length; i++) {
    if (shortTok[i] !== longTok[i]) return false;
  }
  const extra = longTok.slice(shortTok.length);
  const noise = new Set([
    "edition",
    "limited",
    "exclusive",
    "collector",
    "spray",
    "vapo",
    "vaporisateur",
    "natural",
    "разлив",
    "tester",
    "тестер",
  ]);
  const substantive = extra.filter(
    (w) => !noise.has(w) && !/^\d+(?:ml|мл|l|г|g)?$/iu.test(w)
  );
  return substantive.length > 0;
}

export function extractModelLine(name: string, brand: string): string {
  let s = name.replace(/ё/g, "е");
  const br = (brand || "").trim();
  if (br) {
    s = s.replace(new RegExp(escapeReg(br), "gi"), " ");
  }
  s = stripTrailingProductTypes(s);
  s = s.replace(LEADING_PRODUCT_TYPE, " ");
  s = s.replace(/\b(?:spray|спрей|тестер|tester|в\\s*спрее|vapo)\b/gi, " ");
  s = s.replace(/[^\p{L}\p{N}\s.]/gu, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

/** Сходство с учётом «модельной» строки (сильный сигнал при разном оформлении заголовка) */
export function nameAndModelScore(fullA: string, fullB: string, brandA: string, brandB: string) {
  const mA = extractModelLine(fullA, brandA);
  const mB = extractModelLine(fullB, brandB);
  const full = nameSimilarity(fullA, fullB);
  const model = mA && mB ? nameSimilarity(mA, mB) : 0;
  return { full, model, modelA: mA, modelB: mB, combined: Math.max(full, model) };
}
