import { isContentDefaultColumn } from "@/lib/templateGenerator/presets";
import type { ColumnSelection } from "@/lib/templateGenerator/types";
import type { FillBatchIn } from "@/lib/templateGenerator/aiFill";

function contentHeadersFromRows(batch: FillBatchIn): string[] {
  const headers = new Set<string>();
  for (const row of batch.rows) {
    for (const key of Object.keys(row.cells)) {
      if (isContentDefaultColumn(key)) headers.add(key);
    }
  }
  return [...headers];
}

function mergeContentColumn(
  colByHeader: Map<string, ColumnSelection>,
  metaByHeader: Map<string, FillBatchIn["columnMeta"][number]>,
  col: ColumnSelection
): void {
  if (!isContentDefaultColumn(col.header) || colByHeader.has(col.header)) return;
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

/** На сервере: для ЯМ этап 2 всегда дополняем контентными столбцами шаблона */
export function mergeYandexContentFillBatch(batch: FillBatchIn): FillBatchIn {
  if (batch.marketplace !== "yandex" || batch.fillStage !== "content_only") {
    return batch;
  }

  const colByHeader = new Map(batch.columns.map((c) => [c.header, c]));
  const metaByHeader = new Map(batch.columnMeta.map((m) => [m.header, m]));

  for (const col of batch.editableColumns ?? []) {
    mergeContentColumn(colByHeader, metaByHeader, col);
  }

  const editableByHeader = new Map(
    (batch.editableColumns ?? []).map((c) => [c.header, c])
  );
  for (const header of contentHeadersFromRows(batch)) {
    if (colByHeader.has(header)) continue;
    const fromEditable = editableByHeader.get(header);
    mergeContentColumn(
      colByHeader,
      metaByHeader,
      fromEditable ?? {
        header,
        col: 0,
        mode: "ai",
        dropdownSource: "list_sheet"
      }
    );
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
