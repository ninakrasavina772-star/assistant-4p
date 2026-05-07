/**
 * Отсекает пары типа парфюм ↔ тушь/ресницы, где визуальный (aHash) слой часто ошибается на белом фоне.
 */

function fragrancedRetailTitle(n: string): boolean {
  if (/(?:мицелляр|micellar|thermal water|thermal\s+care|\beau\b.*(?:термальная|демакияж))/i.test(n)) {
    return false;
  }
  return (
    /\beau\s+de\s+(?:toilette|parfum|parfüm|cologne|col)\b/i.test(n) ||
    /\b(?:туалетная|парфюмерная|парфюм(?:ная))\s+вода\b/i.test(n) ||
    /\b(?:одеколон|духи)\b/i.test(n) ||
    /(^|[\s,;])(?:парфюм(?:ерная\s+вод[аы])|духи)([\s,.;]|$)/i.test(n) ||
    /\b(?:edt|edp)\b[^\n]{0,48}(?:ml|\sмл\b)/i.test(n)
  );
}

function eyeLashCosmeticTitle(n: string): boolean {
  return (
    /\bтушь\b/i.test(n) ||
    /\bресниц\b/i.test(n) ||
    /\bmascara\b/i.test(n) ||
    /\b(?:cils?|cil)\b/i.test(n) ||
    /(?:volume|volume|водостойк).{0,20}\bресниц\b/i.test(n)
  );
}

/** true: заголовки явно описывают несовместимые классы «ароматика» vs «тушь для ресниц» */
export function incompatibleBeautyTitles(a: string, b: string): boolean {
  const na = String(a ?? "")
    .toLowerCase()
    .replace(/ё/g, "е");
  const nb = String(b ?? "")
    .toLowerCase()
    .replace(/ё/g, "е");
  if (!na.trim() || !nb.trim()) return false;
  const fa = fragrancedRetailTitle(na);
  const fb = fragrancedRetailTitle(nb);
  const ea = eyeLashCosmeticTitle(na);
  const eb = eyeLashCosmeticTitle(nb);
  return Boolean((fa && eb) || (fb && ea));
}
