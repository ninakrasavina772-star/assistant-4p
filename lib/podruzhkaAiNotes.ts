/** Допустимые заголовки нот для инфографики — только стандартная парфюмерная лексика */
export const ALLOWED_NOTE_TITLES = new Set([
  "ЦВЕТОЧНЫЙ",
  "ДРЕВЕСНЫЙ",
  "ПРЯНЫЙ",
  "ВОСТОЧНЫЙ",
  "АМБРОВЫЙ",
  "ЦИТРУСОВЫЙ",
  "ФРУКТОВЫЙ",
  "ШИПРОВЫЙ",
  "КОЖАНЫЙ",
  "МУСКУСНЫЙ",
  "ПУДРОВЫЙ",
  "СВЕЖИЙ",
  "МОРСКОЙ",
  "ГУРМАНСКИЙ",
  "ФУНКЕРНЫЙ",
  "АЛДЕГИДНЫЙ",
  "ТРАВЯНОЙ",
  "ТАБАЧНЫЙ",
  "ВАНИЛЬНЫЙ",
  "ПАЧУЛИ",
  "УДОВЫЙ",
  "КОФЕЙНЫЙ",
  "КОНДИТЕРСКИЙ",
  "ПРЯНОСТИ",
  "ПЕРСИКОВЫЙ",
  "ЯГОДНЫЙ"
]);

const TITLE_TYPOS: Record<string, string> = {
  ЦВЕТУЧИЙ: "ЦВЕТОЧНЫЙ",
  ЦВЕТУЧНАЯ: "ЦВЕТОЧНЫЙ",
  ЦВЕТУЧНОЕ: "ЦВЕТОЧНЫЙ",
  ЦВЕТОЧНАЯ: "ЦВЕТОЧНЫЙ",
  ЦВЕТОЧНОЕ: "ЦВЕТОЧНЫЙ",
  ЦВЕТУШИЙ: "ЦВЕТОЧНЫЙ",
  ДРЕВЕСНАЯ: "ДРЕВЕСНЫЙ",
  ПРЯНАЯ: "ПРЯНЫЙ",
  ФРУКТОВАЯ: "ФРУКТОВЫЙ",
  ЦИТРУСОВАЯ: "ЦИТРУСОВЫЙ"
};

const ALLOWED_LIST = [...ALLOWED_NOTE_TITLES].join(", ");

export function allowedNoteTitlesPrompt(): string {
  return ALLOWED_LIST;
}

/** Нормализация заголовка: опечатки AI → каноническое слово */
export function sanitizeNoteTitle(raw: string): string {
  let t = raw
    .trim()
    .toUpperCase()
    .replace(/[^А-ЯЁ]/g, "");

  if (TITLE_TYPOS[t]) return TITLE_TYPOS[t];
  if (/ЦВЕТУЧ/.test(t)) return "ЦВЕТОЧНЫЙ";

  const words = raw.trim().toUpperCase().split(/\s+/).filter(Boolean);
  if (words.length > 1) {
    const first = words[0]!.replace(/[^А-ЯЁ]/g, "");
    if (TITLE_TYPOS[first]) return TITLE_TYPOS[first];
    if (/ЦВЕТУЧ/.test(first)) return "ЦВЕТОЧНЫЙ";
    if (ALLOWED_NOTE_TITLES.has(first)) return first;
  }

  return t;
}

export function isAllowedNoteTitle(title: string): boolean {
  return ALLOWED_NOTE_TITLES.has(sanitizeNoteTitle(title));
}
