import { normSku } from "@/lib/templateGenerator/csvIndex";
import type { TemplateRowContext, TemplateWorkMode } from "@/lib/templateGenerator/types";
import { isYandexTitleHeader, yandexTitleNeedsFix } from "@/lib/templateGenerator/yandexRules";

export type FillScopeOptions = {
  workMode: TemplateWorkMode;
  selectedHeaders: string[];
  feedSkuSet: Set<string> | null;
  /** В режиме «дополнить» — перезаписывать уже заполненные ячейки */
  overwriteFilled: boolean;
  /** ЯМ: английское название в «Название товара» считаем пустым (только для этой колонки) */
  yandex?: boolean;
};

export function isPlaceholderCellValue(v: string): boolean {
  const t = v.trim().toLowerCase();
  return !t || t === "-" || t === "—" || t === "–" || t === "n/a" || t === "нет";
}

function cellNeedsFill(
  cells: Record<string, string>,
  header: string,
  yandex: boolean
): boolean {
  const v = String(cells[header] ?? "").trim();
  if (!v) return true;
  if (yandex && isYandexTitleHeader(header) && yandexTitleNeedsFix(v)) return true;
  return false;
}

/** Какие строки шаблона обрабатывать в текущем режиме */
export function filterRowsForFill(
  contexts: TemplateRowContext[],
  opts: FillScopeOptions
): TemplateRowContext[] {
  const { workMode, selectedHeaders, feedSkuSet, overwriteFilled } = opts;

  if (workMode === "from_scratch") {
    if (!feedSkuSet?.size) return contexts;
    return contexts.filter((c) => feedSkuSet.has(normSku(c.sku)));
  }

  if (!overwriteFilled && selectedHeaders.length) {
    const yandex = opts.yandex === true;
    return contexts.filter((c) =>
      selectedHeaders.some((h) => cellNeedsFill(c.cells, h, yandex))
    );
  }

  return contexts;
}

export function rowNeedsAiForHeaders(
  cells: Record<string, string>,
  headers: string[],
  overwriteFilled: boolean,
  opts?: { yandex?: boolean }
): string[] {
  const yandex = opts?.yandex === true;
  return headers.filter((h) => {
    if (overwriteFilled) return true;
    return cellNeedsFill(cells, h, yandex);
  });
}