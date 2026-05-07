/**
 * Загрузка листа «Новинки»: колонки Артикул / EAN / опционально Дубль по eан (как в Apps Script).
 */

export const COL_ARTICLE = "Артикул";
export const COL_EAN = "EAN";
/** Заголовок результата в вашей таблице */
export const COL_DUP_RESULT = "Дубль по eан";
export const COL_DUP_RESULT_ALT = "Дубль по EAN";

/** Лист «Новинки»: дубли по одинаковому названию → ссылки админки других строк */
export const COL_PRODUCT_NAME = "Название товара";
export const COL_ADMIN_LINK = "ссылка на админку";
export const COL_DUP_NAME_OR_PHOTO = "Дубль по названию или фото";

export type NoveltiesSheetForEanDup = {
  sheetName: string;
  /** Первая строка — заголовки, далее данные */
  rows: string[][];
};

function normHeader(h: unknown): string {
  return String(h ?? "").trim();
}

function findCol(headers: string[], ...candidates: string[]): number {
  for (const name of candidates) {
    const i = headers.findIndex((h) => h === name);
    if (i >= 0) return i;
  }
  return -1;
}

export function parseNoveltiesSheetForEanDup(
  matrix: (string | number | null | undefined)[][]
): NoveltiesSheetForEanDup {
  if (!matrix.length) throw new Error("Файл пустой или нет строк.");
  const headerCells = matrix[0]!.map(normHeader);
  const art = findCol(headerCells, COL_ARTICLE);
  const ean = findCol(headerCells, COL_EAN);
  if (art < 0) throw new Error(`Не найдена колонка «${COL_ARTICLE}».`);
  if (ean < 0) throw new Error(`Не найдена колонка «${COL_EAN}».`);
  const rows: string[][] = [headerCells];
  for (let r = 1; r < matrix.length; r++) {
    const line = matrix[r] ?? [];
    const cells = headerCells.map((_, c) =>
      line[c] == null || line[c] === "" ? "" : String(line[c]).trim()
    );
    rows.push(cells);
  }
  return { sheetName: "", rows };
}

export function parseNoveltiesSheetForNamePhotoDup(
  matrix: (string | number | null | undefined)[][]
): NoveltiesSheetForEanDup {
  if (!matrix.length) throw new Error("Файл пустой или нет строк.");
  const headerCells = matrix[0]!.map(normHeader);
  const art = findCol(headerCells, COL_ARTICLE);
  const nm = findCol(headerCells, COL_PRODUCT_NAME);
  const lk = findCol(headerCells, COL_ADMIN_LINK);
  if (art < 0) throw new Error(`Не найдена колонка «${COL_ARTICLE}».`);
  if (nm < 0) throw new Error(`Не найдена колонка «${COL_PRODUCT_NAME}».`);
  if (lk < 0) throw new Error(`Не найдена колонка «${COL_ADMIN_LINK}».`);
  const rows: string[][] = [headerCells];
  for (let r = 1; r < matrix.length; r++) {
    const line = matrix[r] ?? [];
    const cells = headerCells.map((_, c) =>
      line[c] == null || line[c] === "" ? "" : String(line[c]).trim()
    );
    rows.push(cells);
  }
  return { sheetName: "", rows };
}

async function loadWorkbookMatrix(
  file: File
): Promise<{ sheetName: string; matrix: (string | number | null | undefined)[][] }> {
  const name = file.name.toLowerCase();
  const XLSX = await import("xlsx");

  if (name.endsWith(".csv") || name.endsWith(".txt")) {
    const wb = XLSX.read(await file.text(), { type: "string" });
    const sh = wb.SheetNames[0];
    if (!sh) throw new Error("Не удалось прочитать CSV.");
    const sheet = wb.Sheets[sh];
    const matrix = XLSX.utils.sheet_to_json<(string | number | null | undefined)[]>(sheet, {
      header: 1,
      defval: "",
      raw: false
    });
    return { sheetName: sh, matrix };
  }

  if (name.endsWith(".xlsx") || name.endsWith(".xls") || name.endsWith(".xlsm")) {
    const data = await file.arrayBuffer();
    const wb = XLSX.read(data, { type: "array" });
    const preferred = wb.SheetNames.includes("Новинки") ? "Новинки" : wb.SheetNames[0];
    if (!preferred) throw new Error("В книге нет листов.");
    const sheet = wb.Sheets[preferred];
    if (!sheet) throw new Error("Не удалось прочитать лист.");
    const matrix = XLSX.utils.sheet_to_json<(string | number | null | undefined)[]>(sheet, {
      header: 1,
      defval: "",
      raw: false
    });
    return { sheetName: preferred, matrix };
  }

  throw new Error("Поддерживаются CSV, TXT и Excel (.xlsx, .xls, .xlsm).");
}

/** Предпочитать лист «Новинки», иначе первый лист книги */
export async function loadNoveltiesMatrixFromFile(file: File): Promise<NoveltiesSheetForEanDup> {
  const { sheetName, matrix } = await loadWorkbookMatrix(file);
  const parsed = parseNoveltiesSheetForEanDup(matrix);
  parsed.sheetName = sheetName;
  return parsed;
}

/** Те же правила листа; нужны колонки Артикул / Название товара / ссылка на админку */
export async function loadNoveltiesNamePhotoMatrixFromFile(
  file: File
): Promise<NoveltiesSheetForEanDup> {
  const { sheetName, matrix } = await loadWorkbookMatrix(file);
  const parsed = parseNoveltiesSheetForNamePhotoDup(matrix);
  parsed.sheetName = sheetName;
  return parsed;
}

export function extractArticleEanColumns(sheet: NoveltiesSheetForEanDup): {
  articles: string[];
  eans: string[];
} {
  const headers = sheet.rows[0]!.map(normHeader);
  const art = findCol(headers, COL_ARTICLE);
  const ean = findCol(headers, COL_EAN);
  const articles: string[] = [];
  const eans: string[] = [];
  for (let i = 1; i < sheet.rows.length; i++) {
    const row = sheet.rows[i]!;
    articles.push(row[art] ?? "");
    eans.push(row[ean] ?? "");
  }
  return { articles, eans };
}

export function extractArticleNameLinkColumns(sheet: NoveltiesSheetForEanDup): {
  articles: string[];
  names: string[];
  links: string[];
} {
  const headers = sheet.rows[0]!.map(normHeader);
  const art = findCol(headers, COL_ARTICLE);
  const nm = findCol(headers, COL_PRODUCT_NAME);
  const lk = findCol(headers, COL_ADMIN_LINK);
  const articles: string[] = [];
  const names: string[] = [];
  const links: string[] = [];
  for (let i = 1; i < sheet.rows.length; i++) {
    const row = sheet.rows[i]!;
    articles.push(row[art] ?? "");
    names.push(row[nm] ?? "");
    links.push(row[lk] ?? "");
  }
  return { articles, names, links };
}

/** Добавить или перезаписать колонку результата; заголовок — COL_DUP_RESULT */
export function sheetWithDupColumn(
  sheet: NoveltiesSheetForEanDup,
  labels: string[]
): string[][] {
  const headers = sheet.rows[0]!.map(normHeader);
  let dupIdx = findCol(headers, COL_DUP_RESULT, COL_DUP_RESULT_ALT);
  const width = Math.max(...sheet.rows.map((r) => r.length), dupIdx >= 0 ? dupIdx + 1 : headers.length + 1);

  const headerRow = [...sheet.rows[0]!];
  while (headerRow.length < width) headerRow.push("");
  if (dupIdx < 0) {
    dupIdx = headerRow.length;
    headerRow.push(COL_DUP_RESULT);
  } else {
    headerRow[dupIdx] = COL_DUP_RESULT;
  }

  const dataRowCount = sheet.rows.length - 1;
  if (labels.length !== dataRowCount) {
    throw new Error(`Число меток (${labels.length}) не совпадает со строками данных (${dataRowCount}).`);
  }

  const out: string[][] = [headerRow];
  for (let i = 1; i < sheet.rows.length; i++) {
    const src = [...sheet.rows[i]!];
    while (src.length <= dupIdx) src.push("");
    src[dupIdx] = labels[i - 1] ?? "";
    while (src.length < headerRow.length) src.push("");
    out.push(src);
  }
  return out;
}

/** Колонка «Дубль по названию или фото»: добавить или перезаписать */
export function sheetWithNamePhotoDupColumn(
  sheet: NoveltiesSheetForEanDup,
  labels: string[]
): string[][] {
  const headers = sheet.rows[0]!.map(normHeader);
  let dupIdx = findCol(headers, COL_DUP_NAME_OR_PHOTO);
  const width = Math.max(...sheet.rows.map((r) => r.length), dupIdx >= 0 ? dupIdx + 1 : headers.length + 1);

  const headerRow = [...sheet.rows[0]!];
  while (headerRow.length < width) headerRow.push("");
  if (dupIdx < 0) {
    dupIdx = headerRow.length;
    headerRow.push(COL_DUP_NAME_OR_PHOTO);
  } else {
    headerRow[dupIdx] = COL_DUP_NAME_OR_PHOTO;
  }

  const dataRowCount = sheet.rows.length - 1;
  if (labels.length !== dataRowCount) {
    throw new Error(`Число меток (${labels.length}) не совпадает со строками данных (${dataRowCount}).`);
  }

  const out: string[][] = [headerRow];
  for (let i = 1; i < sheet.rows.length; i++) {
    const src = [...sheet.rows[i]!];
    while (src.length <= dupIdx) src.push("");
    src[dupIdx] = labels[i - 1] ?? "";
    while (src.length < headerRow.length) src.push("");
    out.push(src);
  }
  return out;
}

export async function downloadSheetMatrixAsExcel(
  rows: string[][],
  fileBase: string,
  sheetName: string,
  /** Суффикс имени файла перед .xlsx */
  fileTag = "export"
): Promise<void> {
  const XLSX = await import("xlsx");
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31) || "Новинки");
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  const safe = fileBase.replace(/[\\/:*?"<>|]+/g, "_").slice(0, 80);
  const tag = fileTag.replace(/[\\/:*?"<>|]+/g, "_").slice(0, 40);
  a.download = `${safe}_${tag}.xlsx`;
  a.click();
  URL.revokeObjectURL(a.href);
}
