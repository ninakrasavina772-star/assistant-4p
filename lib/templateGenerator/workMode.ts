import { normSku } from "@/lib/templateGenerator/csvIndex";
import type { TemplateRowContext, TemplateWorkMode } from "@/lib/templateGenerator/types";

export type FillScopeOptions = {
  workMode: TemplateWorkMode;
  selectedHeaders: string[];
  feedSkuSet: Set<string> | null;
  /** В режиме «дополнить» — перезаписывать уже заполненные ячейки */
  overwriteFilled: boolean;
};

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
    return contexts.filter((c) =>
      selectedHeaders.some((h) => !String(c.cells[h] ?? "").trim())
    );
  }

  return contexts;
}

export function rowNeedsAiForHeaders(
  cells: Record<string, string>,
  headers: string[],
  overwriteFilled: boolean
): string[] {
  return headers.filter((h) => overwriteFilled || !String(cells[h] ?? "").trim());
}
