/** id рубрик из текста поля или каскада (Б — можно несколько). */
const MAX_RUBRIC_IDS = 40;

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
    if (out.length >= MAX_RUBRIC_IDS) break;
  }
  return out;
}

export function mergeUniqueSortedRubricId(
  currentText: string,
  rubricId: number
): string {
  if (!Number.isFinite(rubricId) || rubricId < 1) return currentText;
  const xs = parseRubricIdsFromText(currentText);
  if (!xs.includes(rubricId)) xs.push(rubricId);
  return xs
    .sort((a, b) => a - b)
    .join("\n");
}
