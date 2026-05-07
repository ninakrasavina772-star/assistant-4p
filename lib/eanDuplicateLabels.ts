/** Как в таблице «Новинки» из Apps Script — текст для строки без конфликта по EAN */
export const EAN_DUP_NONE_RU = "нет дубля по еан";

export type EanDupInputRow = {
  article: string;
  ean: string;
};

type ArticleRef = { rowIndex: number; article: string };

/**
 * Для каждой строки: список артикулов других строк с тем же EAN (порядок как в скрипте —
 * все «соседи» по штрихкоду). Пустой артикул или пустой EAN → нет проверки (как в скрипте).
 */
export function labelsForEanDuplicates(
  rows: EanDupInputRow[],
  dupArticleSeparator = ", "
): string[] {
  const eanMap = new Map<string, ArticleRef[]>();
  for (let i = 0; i < rows.length; i++) {
    const ean = rows[i]!.ean.trim();
    const article = rows[i]!.article.trim();
    if (!ean || !article) continue;
    if (!eanMap.has(ean)) eanMap.set(ean, []);
    eanMap.get(ean)!.push({ rowIndex: i, article });
  }

  const out: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    const article = rows[i]!.article.trim();
    const ean = rows[i]!.ean.trim();
    if (!article || !ean) {
      out.push(EAN_DUP_NONE_RU);
      continue;
    }
    const group = eanMap.get(ean);
    if (!group || group.length < 2) {
      out.push(EAN_DUP_NONE_RU);
      continue;
    }
    const duplicates = group
      .filter((g) => g.rowIndex !== i)
      .map((g) => g.article);
    if (duplicates.length > 0) {
      out.push(duplicates.join(dupArticleSeparator));
    } else {
      out.push(EAN_DUP_NONE_RU);
    }
  }
  return out;
}
