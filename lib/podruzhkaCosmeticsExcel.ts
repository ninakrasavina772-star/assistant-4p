import type ExcelJS from "exceljs";
import {
  cellAsUrl,
  cellAsUrlFromCell,
  cellPlainValue,
  isFoto2Header,
  isFoto3Header,
  type Foto2ColumnInfo
} from "@/lib/ozonImageExcel";
import { resolveProductTypeForRender } from "@/lib/podruzhkaProductType";
import {
  findLastUsedColumn,
  formatNoteCellForExcel,
  parseNoteCellText,
  readWorkbookFromFile,
  refreshWorkbookScan,
  scanWorkbookHeaders,
  writeWorkbookToBlob,
  type WorkbookScan
} from "@/lib/podruzhkaExcel";
import type { PodruzhkaFeedRow, PodruzhkaNoteBlock } from "@/lib/podruzhkaTypes";
import {
  autoDetectCosmeticsMapping,
  type CosmeticsAutoDetectResult
} from "@/lib/podruzhkaCosmeticsAutoMapping";
import {
  cosmeticsMappingIsComplete,
  guessCosmeticsColumnMapping,
  type PodruzhkaCosmeticsColumnMapping,
  type PodruzhkaCosmeticsSheetInfo
} from "@/lib/podruzhkaCosmeticsColumnMapping";
import {
  PODRUZHKA_COSMETICS_AI_COLUMN_DEFS,
  type PodruzhkaCosmeticsAiColumnKey
} from "@/lib/podruzhkaCosmeticsTypes";

export {
  readWorkbookFromFile,
  writeWorkbookToBlob,
  scanWorkbookHeaders,
  refreshWorkbookScan,
  guessCosmeticsColumnMapping,
  cosmeticsMappingIsComplete,
  autoDetectCosmeticsMapping,
  type WorkbookScan,
  type CosmeticsAutoDetectResult
};
export {
  COSMETICS_REQUIRED_FEED_FIELDS,
  COSMETICS_SOURCE_EXCEL_FIELDS,
  PODRUZHKA_COSMETICS_FIELD_HINTS,
  PODRUZHKA_COSMETICS_FIELD_LABELS,
  type PodruzhkaCosmeticsColumnMapping,
  type PodruzhkaCosmeticsSheetInfo,
  type ExcelHeaderOption,
  type PodruzhkaCosmeticsFieldKey
} from "@/lib/podruzhkaCosmeticsColumnMapping";

function normHeader(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

export type CosmeticsAiColumnMap = Record<
  PodruzhkaCosmeticsAiColumnKey,
  number | undefined
>;

function colIndexByAliases(
  ws: ExcelJS.Worksheet,
  headerRow: number,
  maxColN: number,
  aliases: string[]
): number | null {
  const wants = aliases.map(normHeader);
  for (let c = 1; c <= maxColN; c++) {
    const v = normHeader(cellPlainValue(ws.getCell(headerRow, c).value));
    if (wants.includes(v)) return c;
  }
  return null;
}

export function ensureCosmeticsAiColumns(
  ws: ExcelJS.Worksheet,
  headerRow: number
): CosmeticsAiColumnMap {
  let lastUsed = findLastUsedColumn(ws, headerRow);
  const map = {} as CosmeticsAiColumnMap;

  for (const def of PODRUZHKA_COSMETICS_AI_COLUMN_DEFS) {
    let c = colIndexByAliases(ws, headerRow, lastUsed, def.aliases);
    if (c == null && def.optional) {
      map[def.key] = undefined;
      continue;
    }
    if (c == null) {
      lastUsed += 1;
      c = lastUsed;
      ws.getCell(headerRow, c).value = def.header;
    }
    map[def.key] = c;
    if (c > lastUsed) lastUsed = c;
  }
  return map;
}

export function listCosmeticsTextColumnsOnSheet(
  ws: ExcelJS.Worksheet,
  headerRow: number
): { key: string; header: string; col: number }[] {
  const cols = ensureCosmeticsAiColumns(ws, headerRow);
  return PODRUZHKA_COSMETICS_AI_COLUMN_DEFS.filter((d) => cols[d.key] != null).map((d) => ({
    key: d.key,
    header: d.header,
    col: cols[d.key]!
  }));
}

function readBenefitBlock(
  ws: ExcelJS.Worksheet,
  row: number,
  cols: CosmeticsAiColumnMap,
  i: 1 | 2 | 3
): PodruzhkaNoteBlock {
  const mainKey = `benefit${i}` as PodruzhkaCosmeticsAiColumnKey;
  const descKey = `benefit${i}_desc` as PodruzhkaCosmeticsAiColumnKey;
  const mainCol = cols[mainKey];
  const descCol = cols[descKey];
  if (!mainCol) return { title: "", desc: "" };

  if (descCol) {
    return {
      title: cellPlainValue(ws.getCell(row, mainCol).value),
      desc: cellPlainValue(ws.getCell(row, descCol).value)
    };
  }

  return parseNoteCellText(cellPlainValue(ws.getCell(row, mainCol).value));
}

export function readCosmeticsTextsFromSheet(
  ws: ExcelJS.Worksheet,
  info: PodruzhkaCosmeticsSheetInfo,
  feedRow: PodruzhkaFeedRow
): { model: string; benefits: PodruzhkaNoteBlock[]; status: string } {
  const aiCols = ensureCosmeticsAiColumns(ws, info.headerRow);
  const row = feedRow.row;
  const modelCol = aiCols.model;
  const model = modelCol ? cellPlainValue(ws.getCell(row, modelCol).value) : "";
  const benefits = [
    readBenefitBlock(ws, row, aiCols, 1),
    readBenefitBlock(ws, row, aiCols, 2),
    readBenefitBlock(ws, row, aiCols, 3)
  ];
  const statusCol = aiCols.benefits_status;
  const status = statusCol ? cellPlainValue(ws.getCell(row, statusCol).value).trim() : "";
  return { model, benefits, status };
}

function blockComplete(n: PodruzhkaNoteBlock): boolean {
  return Boolean(n.title.trim() && n.desc.trim());
}

export type CosmeticsRowRenderEligibility = {
  ok: boolean;
  model: string;
  benefits: PodruzhkaNoteBlock[];
  status: string;
  reasons: string[];
};

export function getCosmeticsRowRenderEligibility(
  ws: ExcelJS.Worksheet,
  info: PodruzhkaCosmeticsSheetInfo,
  feedRow: PodruzhkaFeedRow
): CosmeticsRowRenderEligibility {
  const ai = readCosmeticsTextsFromSheet(ws, info, feedRow);
  const reasons: string[] = [];

  if (!feedRow.brandName.trim()) reasons.push("нет brand name");
  if (!feedRow.foto.trim()) reasons.push("нет foto");
  if (!ai.model.trim()) reasons.push("нет model");
  for (let i = 0; i < 3; i++) {
    const b = ai.benefits[i]!;
    if (!b.title.trim()) reasons.push(`пустой benefit ${i + 1}`);
    else if (!b.desc.trim()) reasons.push(`нет описания в benefit ${i + 1}`);
  }

  const ok =
    reasons.length === 0 &&
    ai.model.trim().length > 0 &&
    ai.benefits.length >= 3 &&
    ai.benefits.every(blockComplete);

  return { ok, model: ai.model, benefits: ai.benefits, status: ai.status, reasons };
}

export function countCosmeticsReadyRows(
  ws: ExcelJS.Worksheet,
  info: PodruzhkaCosmeticsSheetInfo
): number {
  return info.rows.filter((r) => getCosmeticsRowRenderEligibility(ws, info, r).ok).length;
}

export function readCosmeticsProductTypeForCard(
  ws: ExcelJS.Worksheet,
  info: PodruzhkaCosmeticsSheetInfo,
  feedRow: PodruzhkaFeedRow,
  model?: string
): string {
  const aiCols = ensureCosmeticsAiColumns(ws, info.headerRow);
  const cardCol = aiCols.product_type_card;
  const fromCard = cardCol
    ? cellPlainValue(ws.getCell(feedRow.row, cardCol).value).trim()
    : "";
  return resolveProductTypeForRender({
    productTypeCard: fromCard,
    productType: feedRow.productType,
    productName: feedRow.productName,
    name: feedRow.name,
    model
  });
}

export function buildCosmeticsSheetFromMapping(
  wb: ExcelJS.Workbook,
  scan: WorkbookScan,
  mapping: PodruzhkaCosmeticsColumnMapping
): PodruzhkaCosmeticsSheetInfo | null {
  const ws = wb.getWorksheet(scan.sheetName);
  if (!ws) return null;

  const m = mapping;
  const brandCol = m.brandName!;
  const rows: PodruzhkaFeedRow[] = [];
  const lastRow = ws.rowCount || scan.headerRow;

  for (let row = scan.headerRow + 1; row <= lastRow; row++) {
    const brandName = cellPlainValue(ws.getCell(row, brandCol).value);
    const foto = m.foto ? cellAsUrlFromCell(ws.getCell(row, m.foto)) : "";
    if (!brandName && !foto) continue;

    rows.push({
      row,
      id: m.id ? cellPlainValue(ws.getCell(row, m.id).value) : "",
      name: m.name ? cellPlainValue(ws.getCell(row, m.name).value) : "",
      brandName,
      productType: m.productType ? cellPlainValue(ws.getCell(row, m.productType).value) : "",
      productName: m.productName ? cellPlainValue(ws.getCell(row, m.productName).value) : "",
      foto,
      ml: m.ml ? cellPlainValue(ws.getCell(row, m.ml).value) : ""
    });
  }

  if (rows.length === 0) return null;

  let foto2Col: number | null = m.foto2 ?? null;
  if (!foto2Col) {
    const maxC = findLastUsedColumn(ws, scan.headerRow);
    for (let c = 1; c <= maxC; c++) {
      const raw = cellPlainValue(ws.getCell(scan.headerRow, c).value);
      if (isFoto2Header(raw)) foto2Col = c;
    }
  }

  return {
    sheetName: scan.sheetName,
    headerRow: scan.headerRow,
    mapping: m,
    foto2Col,
    rows
  };
}

function ensureFoto2Column(ws: ExcelJS.Worksheet, info: PodruzhkaCosmeticsSheetInfo): number {
  if (info.foto2Col) return info.foto2Col;
  const last = findLastUsedColumn(ws, info.headerRow) + 1;
  ws.getCell(info.headerRow, last).value = "foto 2";
  return last;
}

export function applyCosmeticsFoto2Urls(
  ws: ExcelJS.Worksheet,
  info: PodruzhkaCosmeticsSheetInfo,
  urls: Map<number, string>
): { foto2Col: number } {
  const foto2Col = ensureFoto2Column(ws, info);
  for (const [row, url] of urls) {
    ws.getCell(row, foto2Col).value = url;
  }
  return { foto2Col };
}

export function buildCosmeticsFoto2ColumnInfo(
  ws: ExcelJS.Worksheet,
  info: PodruzhkaCosmeticsSheetInfo
): Foto2ColumnInfo | null {
  const foto2Col = ensureFoto2Column(ws, info);
  const rows: { row: number; url: string }[] = [];

  for (const feed of info.rows) {
    const url = cellAsUrl(ws.getCell(feed.row, foto2Col).value);
    if (url) rows.push({ row: feed.row, url });
  }
  if (rows.length === 0) return null;

  let foto3Col = foto2Col + 1;
  const maxColN = findLastUsedColumn(ws, info.headerRow);
  for (let c = 1; c <= maxColN; c++) {
    const v = ws.getCell(info.headerRow, c).value;
    if (isFoto3Header(v) || isFoto3Header(cellPlainValue(v))) {
      foto3Col = c;
      break;
    }
  }

  return {
    sheetName: info.sheetName,
    headerRow: info.headerRow,
    foto2Col,
    foto3Col,
    rows
  };
}

export function defaultCosmeticsDownloadName(
  baseFileName: string | null,
  suffix: "texts" | "infographic" | "foto3"
): string {
  const base = (baseFileName ?? "feed").replace(/\.xlsx?$/i, "");
  return `${base}-cosmetics-${suffix}.xlsx`;
}
