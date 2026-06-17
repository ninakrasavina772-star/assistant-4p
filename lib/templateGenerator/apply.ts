import type ExcelJS from "exceljs";
import { cellPlainValue } from "@/lib/ozonImageExcel";
import type { ColumnSelection, FillRowResult, TemplateSheetScan } from "@/lib/templateGenerator/types";
import { ensurePhotoReviewColumn, formatPhotoReviewValue } from "@/lib/templateGenerator/photos";
import { DEFAULT_PHOTO_REVIEW_COLUMN } from "@/lib/templateGenerator/presets";

export function applyFillResults(
  ws: ExcelJS.Worksheet,
  scan: TemplateSheetScan,
  selection: ColumnSelection[],
  results: FillRowResult[],
  photoReviewHeader: string = DEFAULT_PHOTO_REVIEW_COLUMN,
  overwriteFilled = false
): number {
  const colByHeader = new Map(selection.map((s) => [s.header, s.col]));
  let photoCol: number | null = null;
  let filled = 0;

  for (const res of results) {
    const hasValues = res.ok || Object.keys(res.values).length > 0;
    if (!hasValues) continue;
    for (const [header, value] of Object.entries(res.values)) {
      const col = colByHeader.get(header);
      if (!col || !value) continue;
      if (!overwriteFilled) {
        const existing = cellPlainValue(ws.getCell(res.row, col).value).trim();
        if (existing) continue;
      }
      ws.getCell(res.row, col).value = value;
      filled++;
    }
    if (res.extraPhotos.length) {
      if (!photoCol) {
        photoCol = ensurePhotoReviewColumn(ws, scan.headerRow, photoReviewHeader);
      }
      ws.getCell(res.row, photoCol).value = formatPhotoReviewValue(res.extraPhotos);
    }
  }
  return filled;
}
