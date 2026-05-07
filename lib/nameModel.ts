import { nameSimilarity } from "./nameSimilarity";

/**
 * Снимаем с начала/из названия тип товара и дубли бренда — остаётся «линейка/модель»
 * (например: «Jimmy Choo Man», «Man Aqua»), что стабильнее сырого заголовка.
 */
const LEADING_PRODUCT_TYPE = new RegExp(
  "^(?:туалетная\\s+вода|парфюм(?:ная\\s+вода|ерная\\s+вода)?|" +
    "тестер|парфюмный\\s+набор|eau\\s+de\\s+toilette|eau\\s+de\\s+parfum|" +
    "edt|edp|eau\\s+de\\s+col|одеколон|парфюм(?:ерная)?\\s+вода)\\s*",
  "i"
);

function escapeReg(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function extractModelLine(name: string, brand: string): string {
  let s = name.replace(/ё/g, "е");
  const br = (brand || "").trim();
  if (br) {
    s = s.replace(new RegExp(escapeReg(br), "gi"), " ");
  }
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
