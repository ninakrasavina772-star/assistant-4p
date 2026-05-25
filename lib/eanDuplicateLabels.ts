import { expandEanDigitsForIndex } from "./product";

/** Как в таблице «Новинки» из Apps Script — текст для строки без конфликта по EAN */
export const EAN_DUP_NONE_RU = "нет дубля по еан";

export type EanDupInputRow = {
  article: string;
  ean: string;
};

type ArticleRef = { rowIndex: number; article: string };

function eanIndexKeys(raw: string): string[] {
  const d = String(raw ?? "").replace(/\D/g, "");
  if (!d) return [];
  return expandEanDigitsForIndex(d);
}

/**
 * Для каждой строки: список артикулов других строк с тем же EAN (нормализация 12/13/14 и ведущих нулей).
 * Пустой артикул или пустой EAN → нет проверки (как в скрипте).
 */
export function labelsForEanDuplicates(
  rows: EanDupInputRow[],
  dupArticleSeparator = ", "
): string[] {
  const eanMap = new Map<string, ArticleRef[]>();
  for (let i = 0; i < rows.length; i++) {
    const article = rows[i]!.article.trim();
    const keys = eanIndexKeys(rows[i]!.ean);
    if (!article || keys.length === 0) continue;
    for (const key of keys) {
      if (!eanMap.has(key)) eanMap.set(key, []);
      eanMap.get(key)!.push({ rowIndex: i, article });
    }
  }

  const out: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    const article = rows[i]!.article.trim();
    const keys = eanIndexKeys(rows[i]!.ean);
    if (!article || keys.length === 0) {
      out.push(EAN_DUP_NONE_RU);
      continue;
    }
    const seen = new Set<string>();
    const duplicates: string[] = [];
    for (const key of keys) {
      const group = eanMap.get(key);
      if (!group) continue;
      for (const g of group) {
        if (g.rowIndex === i || !g.article || seen.has(g.article)) continue;
        seen.add(g.article);
        duplicates.push(g.article);
      }
    }
    if (duplicates.length > 0) {
      out.push(duplicates.join(dupArticleSeparator));
    } else {
      out.push(EAN_DUP_NONE_RU);
    }
  }
  return out;
}
