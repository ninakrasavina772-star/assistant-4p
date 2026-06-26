import { isContentDefaultColumn } from "@/lib/templateGenerator/presets";
import type { ColumnSelection } from "@/lib/templateGenerator/types";
import type { FillBatchIn } from "@/lib/templateGenerator/aiFill";

/** На сервере: для ЯМ этап 2 всегда дополняем контентными столбцами шаблона */
export function mergeYandexContentFillBatch(batch: FillBatchIn): FillBatchIn {
  if (batch.marketplace !== "yandex" || batch.fillStage !== "content_only") {
    return batch;
  }

  const editable = batch.editableColumns ?? [];
  if (!editable.length) return batch;

  const colByHeader = new Map(batch.columns.map((c) => [c.header, c]));
  const metaByHeader = new Map(batch.columnMeta.map((m) => [m.header, m]));

  for (const col of editable) {
    if (!isContentDefaultColumn(col.header) || colByHeader.has(col.header)) continue;
    colByHeader.set(col.header, col);
    if (!metaByHeader.has(col.header)) {
      metaByHeader.set(col.header, {
        header: col.header,
        hint: "",
        dropdownValues: [],
        mode: col.mode === "dropdown_strict" ? "dropdown_strict" : "ai"
      });
    }
  }

  return {
    ...batch,
    columns: [...colByHeader.values()],
    columnMeta: [...metaByHeader.values()]
  };
}

export function hasFillColumns(batch: FillBatchIn): boolean {
  return batch.columns.length > 0;
}
