/** Как в колонке результата Apps Script для дублей по названию/ссылке */
export const NAME_PHOTO_DUP_NONE_RU = "дубль не найден";

export type NamePhotoDupInputRow = {
  article: string;
  /** Как в таблице; для группировки используется trim + toLowerCase */
  name: string;
  /** «ссылка на админку» — в результат попадают только непустые ссылки других строк */
  link: string;
};

type RowRef = { rowIndex: number; link: string; article: string };

function normNameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Группировка по нормализованному названию; в ячейку — уникальные ссылки с других строк той же группы
 * (как в скрипте: только если у соседа есть link). Разделитель — перевод строки (в скрипте join был пустым).
 */
export function labelsForNamePhotoDuplicates(
  rows: NamePhotoDupInputRow[],
  linkSeparator = "\n"
): string[] {
  const nameMap = new Map<string, RowRef[]>();
  for (let i = 0; i < rows.length; i++) {
    const nameKey = normNameKey(rows[i]!.name);
    const link = rows[i]!.link.trim();
    const article = rows[i]!.article.trim();
    if (!nameKey || !article) continue;
    if (!nameMap.has(nameKey)) nameMap.set(nameKey, []);
    nameMap.get(nameKey)!.push({ rowIndex: i, link, article });
  }

  const out: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    const article = rows[i]!.article.trim();
    const nameKey = normNameKey(rows[i]!.name);
    if (!article || !nameKey) {
      out.push(NAME_PHOTO_DUP_NONE_RU);
      continue;
    }
    const group = nameMap.get(nameKey);
    if (!group || group.length < 2) {
      out.push(NAME_PHOTO_DUP_NONE_RU);
      continue;
    }
    const duplicates: string[] = [];
    const seen = new Set<string>();
    for (const g of group) {
      if (g.rowIndex === i) continue;
      const token = g.link.trim() || g.article;
      if (!token || seen.has(token)) continue;
      seen.add(token);
      duplicates.push(g.link.trim() || g.article);
    }
    if (duplicates.length > 0) {
      out.push(duplicates.join(linkSeparator));
    } else {
      out.push(NAME_PHOTO_DUP_NONE_RU);
    }
  }
  return out;
}
