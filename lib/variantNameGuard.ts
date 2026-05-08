/**
 * Отсекаем пары вроде «Escentric 02» vs «Escentric 01»: одно и то же слово + разные числа
 * (типовая линейка, разные SKU), даже при высоком Levenshtein по всей строке.
 */
const WORD_THEN_NUM = /([A-Za-zА-Яа-яЁё]{2,})\s+0*(\d{1,2})\b/gu;

export function wordFollowedByConflictingDigit(nameA: string, nameB: string): boolean {
  const lowA = nameA.toLowerCase();
  const lowB = nameB.toLowerCase();
  const byWordA = new Map<string, Set<string>>();
  for (const m of lowA.matchAll(WORD_THEN_NUM)) {
    const w = m[1]!;
    const d = m[2]!;
    if (!byWordA.has(w)) byWordA.set(w, new Set());
    byWordA.get(w)!.add(d);
  }
  for (const m of lowB.matchAll(WORD_THEN_NUM)) {
    const w = m[1]!;
    const d = m[2]!;
    const setA = byWordA.get(w);
    if (setA && setA.size > 0 && !setA.has(d)) {
      return true;
    }
  }
  const byWordB = new Map<string, Set<string>>();
  for (const m of lowB.matchAll(WORD_THEN_NUM)) {
    const w = m[1]!;
    const d = m[2]!;
    if (!byWordB.has(w)) byWordB.set(w, new Set());
    byWordB.get(w)!.add(d);
  }
  for (const m of lowA.matchAll(WORD_THEN_NUM)) {
    const w = m[1]!;
    const d = m[2]!;
    const setB = byWordB.get(w);
    if (setB && setB.size > 0 && !setB.has(d)) {
      return true;
    }
  }
  return false;
}
