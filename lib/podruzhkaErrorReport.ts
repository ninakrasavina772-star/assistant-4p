import type { PodruzhkaFeedRow } from "@/lib/podruzhkaTypes";

export type PodruzhkaErrorRow = {
  row: number;
  id: string;
  brand: string;
  name: string;
  stage: string;
  reason: string;
};

async function loadExcelJS() {
  const mod = await import("exceljs");
  return mod.default ?? mod;
}

export function defaultPodruzhkaErrorsDownloadName(baseFileName: string | null): string {
  const base = (baseFileName ?? "feed").replace(/\.xlsx?$/i, "");
  return `${base}-errors.xlsx`;
}

export function defaultCosmeticsErrorsDownloadName(baseFileName: string | null): string {
  const base = (baseFileName ?? "feed").replace(/\.xlsx?$/i, "");
  return `${base}-cosmetics-errors.xlsx`;
}

function lookupFeedRow(rows: PodruzhkaFeedRow[] | undefined, rowNum: number): PodruzhkaFeedRow | undefined {
  return rows?.find((r) => r.row === rowNum);
}

/** Собирает все ошибки подготовки и рендера в один список для Excel. */
export function buildPodruzhkaErrorRows(
  feedRows: PodruzhkaFeedRow[] | undefined,
  skipped: { row: number; brand: string; reasons: string }[],
  renderErrors: { row: number; brand: string; error: string }[]
): PodruzhkaErrorRow[] {
  const out: PodruzhkaErrorRow[] = [];

  for (const s of skipped) {
    const feed = lookupFeedRow(feedRows, s.row);
    out.push({
      row: s.row,
      id: feed?.id ?? "",
      brand: s.brand || feed?.brandName || "",
      name: feed?.name ?? "",
      stage: "подготовка",
      reason: s.reasons
    });
  }

  for (const e of renderErrors) {
    const feed = lookupFeedRow(feedRows, e.row);
    out.push({
      row: e.row,
      id: feed?.id ?? "",
      brand: e.brand || feed?.brandName || "",
      name: feed?.name ?? "",
      stage: "рендер",
      reason: e.error
    });
  }

  out.sort((a, b) => a.row - b.row);
  return out;
}

export async function buildPodruzhkaErrorsWorkbook(rows: PodruzhkaErrorRow[]): Promise<Blob> {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("ошибки");

  ws.columns = [
    { header: "строка Excel", key: "row", width: 12 },
    { header: "артикул", key: "id", width: 18 },
    { header: "бренд", key: "brand", width: 22 },
    { header: "название", key: "name", width: 44 },
    { header: "этап", key: "stage", width: 14 },
    { header: "ошибка", key: "reason", width: 64 }
  ];

  const header = ws.getRow(1);
  header.font = { bold: true };

  for (const r of rows) {
    ws.addRow(r);
  }

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });
}
