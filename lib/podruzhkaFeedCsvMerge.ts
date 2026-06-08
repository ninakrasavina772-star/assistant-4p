import type ExcelJS from "exceljs";
import { stripPartnersFeedPreamble } from "@/lib/partnersFeedCsv";
import { cellPlainValue } from "@/lib/ozonImageExcel";
import type { PodruzhkaColumnMapping } from "@/lib/podruzhkaColumnMapping";
import { findLastUsedColumn, type WorkbookScan } from "@/lib/podruzhkaExcel";

function normCell(h: unknown): string {
  return String(h ?? "")
    .replace(/^\uFEFF/, "")
    .trim();
}

function normHeader(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function findColIdx(headers: string[], ...names: string[]): number {
  const row = headers.map(normCell);
  for (const name of names) {
    const want = normCell(name).toLowerCase();
    const i = row.findIndex((h) => h.toLowerCase() === want);
    if (i >= 0) return i;
  }
  return -1;
}

function findColIdxByTokens(headers: string[], tokens: string[]): number {
  if (!tokens.length) return -1;
  const row = headers.map((h) =>
    normCell(h)
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
  );
  for (let i = 0; i < row.length; i++) {
    const key = row[i]!;
    if (key && tokens.every((t) => key.includes(t))) return i;
  }
  return -1;
}

/** Артикул из Excel/Ozon: tpv_124944302 → 124944302 */
export function normArticleKey(raw: string): string {
  const t = String(raw ?? "").trim();
  if (!t) return "";
  const tpv = t.match(/^tpv[_-]?(\d+)$/i);
  if (tpv) return tpv[1]!;
  return t.replace(/^tpv_/i, "").toLowerCase();
}

export type VariantImagesIndex = {
  byArticle: Map<string, string>;
  variantRows: number;
};

/** Индекс «Артикул → ячейка Изображения варианта» (без слияния по id товара). */
export async function buildVariantImagesIndex(csvText: string): Promise<VariantImagesIndex> {
  const stripped = stripPartnersFeedPreamble(csvText);
  const XLSX = await import("xlsx");
  const wb = XLSX.read(stripped, { type: "string" });
  const sh = wb.SheetNames[0];
  if (!sh) throw new Error("Пустой CSV после заголовка");

  const sheet = wb.Sheets[sh];
  const rows = XLSX.utils.sheet_to_json<(string | number | null | undefined)[]>(sheet, {
    header: 1,
    defval: "",
    raw: false
  });
  if (!rows.length) throw new Error("Нет строк данных в CSV");

  const headers = (rows[0] ?? []).map(normCell);
  const artIdx = findColIdx(headers, "Артикул", "SKU", "Article", "Vendor code");
  let imgIdx = findColIdx(
    headers,
    "Изображения варианта",
    "Variant Images",
    "Product Images"
  );
  if (imgIdx < 0) imgIdx = findColIdxByTokens(headers, ["variant", "image"]);

  if (artIdx < 0) {
    throw new Error("В CSV нет колонки «Артикул» — нужен экспорт 4Partners");
  }
  if (imgIdx < 0) {
    throw new Error("В CSV нет колонки «Изображения варианта»");
  }

  const byArticle = new Map<string, string>();
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row?.length) continue;
    const article = normCell(row[artIdx]);
    const imgCell = normCell(row[imgIdx]);
    if (!article || !imgCell) continue;
    const key = normArticleKey(article);
    if (!key) continue;
    const prev = byArticle.get(key);
    if (!prev || imgCell.length > prev.length) byArticle.set(key, imgCell);
  }

  if (!byArticle.size) {
    throw new Error("В CSV не найдено строк с артикулом и фото");
  }

  return { byArticle, variantRows: byArticle.size };
}

const ARTICLE_HEADER_RE =
  /артикул|offer.?id|^sku$|vendor.?code|tpv|код.?товара|article/i;

function articleKeysForRow(
  ws: ExcelJS.Worksheet,
  row: number,
  mapping: PodruzhkaColumnMapping,
  scan: WorkbookScan
): string[] {
  const keys = new Set<string>();
  const add = (raw: string) => {
    const k = normArticleKey(raw);
    if (k) keys.add(k);
  };

  if (mapping.id && mapping.id > 0) {
    add(cellPlainValue(ws.getCell(row, mapping.id).value));
  }

  for (const h of scan.headers) {
    if (!ARTICLE_HEADER_RE.test(normHeader(h.label))) continue;
    add(cellPlainValue(ws.getCell(row, h.col).value));
  }

  return [...keys];
}

export type CsvImagesMergeResult = {
  mapping: PodruzhkaColumnMapping;
  merged: number;
  notFound: number;
  skippedEmpty: number;
  fotoImagesCol: number;
};

/** Записывает «Изображения варианта» из CSV в Excel по артикулу. */
export function mergeCsvImagesIntoWorkbook(
  ws: ExcelJS.Worksheet,
  scan: WorkbookScan,
  mapping: PodruzhkaColumnMapping,
  byArticle: Map<string, string>
): CsvImagesMergeResult {
  const nextMapping = { ...mapping };
  let fotoImagesCol = nextMapping.fotoImages ?? 0;

  if (!fotoImagesCol) {
    fotoImagesCol = findLastUsedColumn(ws, scan.headerRow) + 1;
    ws.getCell(scan.headerRow, fotoImagesCol).value = "Изображения варианта";
    nextMapping.fotoImages = fotoImagesCol;
  }

  let merged = 0;
  let notFound = 0;
  let skippedEmpty = 0;
  const lastRow = ws.rowCount || scan.headerRow;

  for (let row = scan.headerRow + 1; row <= lastRow; row++) {
    const brand = mapping.brandName
      ? cellPlainValue(ws.getCell(row, mapping.brandName).value).trim()
      : "";
    const keys = articleKeysForRow(ws, row, mapping, scan);
    if (!keys.length && !brand) {
      skippedEmpty++;
      continue;
    }

    let imgCell: string | undefined;
    for (const k of keys) {
      const hit = byArticle.get(k);
      if (hit) {
        imgCell = hit;
        break;
      }
    }

    if (imgCell) {
      ws.getCell(row, fotoImagesCol).value = imgCell;
      merged++;
    } else if (keys.length || brand) {
      notFound++;
    }
  }

  return {
    mapping: nextMapping,
    merged,
    notFound,
    skippedEmpty,
    fotoImagesCol
  };
}
