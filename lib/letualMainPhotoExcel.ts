import ExcelJS from "exceljs";

export type LetualVariationInputRow = {
  variationId: number;
  row: number;
};

export async function readVariationIdsFromExcel(file: File): Promise<LetualVariationInputRow[]> {
  const buf = await file.arrayBuffer();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.worksheets[0];
  if (!ws) return [];

  const headerRow = ws.getRow(1);
  let idCol = 1;
  headerRow.eachCell((cell, col) => {
    const h = String(cell.value ?? "")
      .trim()
      .toLowerCase();
    if (h === "variation_id" || h === "id" || h === "вариация" || h === "variation id") {
      idCol = col;
    }
  });

  const out: LetualVariationInputRow[] = [];
  ws.eachRow((row, rowNum) => {
    if (rowNum === 1) return;
    const raw = row.getCell(idCol).value;
    const n = parseVariationId(raw);
    if (n) out.push({ variationId: n, row: rowNum });
  });
  return out;
}

export function parseVariationId(raw: unknown): number | null {
  if (raw == null) return null;
  const s = String(raw).trim().replace(/^[Vv]/, "");
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n > 0 ? n : null;
}

export function parseVariationIdsFromText(text: string): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  for (const line of text.split(/\r?\n/)) {
    const n = parseVariationId(line.trim());
    if (n && !seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  return out;
}

export type LetualResultRow = {
  variationId?: number;
  sourceUrl?: string;
  resultUrl: string;
  comment: string;
  previewUrl?: string;
  ok: boolean;
  error?: string;
};

export async function buildLetualVariationResultWorkbook(
  rows: LetualResultRow[]
): Promise<Blob> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("letual_main_photo");
  ws.columns = [
    { header: "variation_id", key: "variationId", width: 16 },
    { header: "main_photo_url", key: "resultUrl", width: 72 },
    { header: "source_url", key: "sourceUrl", width: 72 },
    { header: "comment", key: "comment", width: 48 },
    { header: "error", key: "error", width: 40 }
  ];
  for (const r of rows) {
    ws.addRow({
      variationId: r.variationId ?? "",
      resultUrl: r.ok ? r.resultUrl : "",
      sourceUrl: r.sourceUrl ?? "",
      comment: r.comment,
      error: r.ok ? "" : (r.error ?? "ошибка")
    });
  }
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });
}

export async function buildLetualUrlResultWorkbook(rows: LetualResultRow[]): Promise<Blob> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("letual_urls");
  ws.columns = [
    { header: "source_url", key: "sourceUrl", width: 72 },
    { header: "result_url", key: "resultUrl", width: 72 },
    { header: "comment", key: "comment", width: 48 }
  ];
  for (const r of rows) {
    ws.addRow({
      sourceUrl: r.sourceUrl ?? "",
      resultUrl: r.resultUrl,
      comment: r.comment
    });
  }
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });
}

export function parseUrlsFromText(text: string): string[] {
  return [...new Set(text.split(/\r?\n/).map((l) => l.trim()).filter((u) => /^https?:\/\//i.test(u)))];
}
