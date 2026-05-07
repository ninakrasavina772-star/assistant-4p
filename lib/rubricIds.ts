/** Максимум узких рубрик на витрине B (API + UI). */
export const MAX_RUBRICS_B = 6;

/** Защита от огромной вставки в поле: после стольки уникальных id дальше не читаем. */
const MAX_RUBRIC_IDS_PARSED = 64;

export function parseRubricIdsFromText(text: string): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const part of text.split(/[\n\r,;|\t\s]+/u)) {
    const t = part.trim();
    if (!t) continue;
    const n = Number(String(t).replace(/[^\d]/g, ""));
    if (!Number.isFinite(n) || n < 1 || n > Number.MAX_SAFE_INTEGER) continue;
    const id = Math.floor(n);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= MAX_RUBRIC_IDS_PARSED) break;
  }
  return out;
}

export function mergeUniqueSortedRubricId(
  currentText: string,
  rubricId: number,
  options?: { max?: number }
): { text: string; limitReached: boolean } {
  const max = options?.max ?? MAX_RUBRICS_B;
  if (!Number.isFinite(rubricId) || rubricId < 1) {
    return { text: currentText, limitReached: false };
  }
  const xs = parseRubricIdsFromText(currentText);
  if (xs.includes(rubricId)) {
    return {
      text: xs.sort((a, b) => a - b).join("\n"),
      limitReached: false
    };
  }
  if (xs.length >= max) {
    return { text: currentText, limitReached: true };
  }
  xs.push(rubricId);
  return {
    text: xs.sort((a, b) => a - b).join("\n"),
    limitReached: false
  };
}
