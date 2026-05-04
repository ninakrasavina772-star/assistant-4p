import { collectEans, firstImageUrl, toCompareProduct } from "./product";
import type { FpProduct, NameLocale, OnlyBCrossWithARow } from "./types";

/** Один текст в ячейке .xlsx не длиннее этого (иначе SheetJS бросает ошибку). */
const XLSX_MAX_CELL_CHARS = 32767;

function clipExcelCell(s: string): string {
  if (s.length <= XLSX_MAX_CELL_CHARS) return s;
  const tail = "…[обрезано: лимит Excel 32767 симв.]";
  const n = XLSX_MAX_CELL_CHARS - tail.length;
  return (n > 0 ? s.slice(0, n) : "") + tail;
}

function clipExcelRow(row: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = clipExcelCell(v);
  }
  return out;
}

function crossKindRu(kind: string): string {
  switch (kind) {
    case "ean_diff_id":
      return "EAN (разный id)";
    case "article":
      return "артикул";
    case "name_photo":
      return "название + фото";
    case "brand_visual":
      return "бренд + фото (~60%)";
    case "unlikely":
      return "мало: фото + характеристики";
    default:
      return kind;
  }
}

function articleHintsFromCrossRow(r: OnlyBCrossWithARow): string[] {
  const xs: string[] = [];
  if (r.article) xs.push(String(r.article));
  if (r.productOnA.articleKey) xs.push(String(r.productOnA.articleKey));
  return [...new Set(xs.filter(Boolean))];
}

/**
 * По строкам кросс-дублей: id товара B → виды совпадения и артикулы найденной карточки на A.
 */
export function aggregateCrossDupHintsByB(
  rows: OnlyBCrossWithARow[]
): Map<number, { kindsRu: Set<string>; articlesOnA: Set<string> }> {
  const m = new Map<number, { kindsRu: Set<string>; articlesOnA: Set<string> }>();
  for (const r of rows) {
    const idB = r.productFromOnlyB.id;
    if (!m.has(idB)) m.set(idB, { kindsRu: new Set(), articlesOnA: new Set() });
    const e = m.get(idB)!;
    e.kindsRu.add(crossKindRu(r.kind));
    for (const a of articleHintsFromCrossRow(r)) {
      e.articlesOnA.add(a);
    }
  }
  return m;
}

export async function downloadNoveltiesByArticleExcel(
  noveltiesFromB: FpProduct[],
  nameLocale: NameLocale,
  fileBase: string
): Promise<void> {
  return downloadFpListAsExcel(noveltiesFromB, nameLocale, fileBase, {
    sheetName: "новинки_B_артикул",
    fileSuffix: "новинки_B_по_артикулу"
  });
}

function sanitizeLabel(s: string): string {
  return s.replace(/[\\/:*?"<>|]+/g, "_").slice(0, 40);
}

/**
 * Новинки с B одним листом: колонки дубль на A, типы совпадения, артикулы на A.
 */
export async function downloadNoveltiesByArticleWithDupColumnsExcel(
  noveltiesFromB: FpProduct[],
  crossRows: OnlyBCrossWithARow[],
  nameLocale: NameLocale,
  fileBase: string,
  siteALabel: string
): Promise<void> {
  if (typeof window === "undefined" || !noveltiesFromB.length) return;
  const XLSX = await import("xlsx");
  const hints = aggregateCrossDupHintsByB(crossRows);
  const aShort = sanitizeLabel(siteALabel);
  const rows = noveltiesFromB.map((p) => {
    const base = flattenProductForExport(p, nameLocale);
    const agg = hints.get(p.id);
    const hasDup = agg && (agg.kindsRu.size > 0 || agg.articlesOnA.size > 0);
    return clipExcelRow({
      "Дубль на A (найден вторым контуром)": hasDup ? "да" : "нет",
      "Как нашли совпадение на A": hasDup ? [...agg!.kindsRu].join(", ") : "",
      "Артикулы на сайте A (кандидаты, через запятую)":
        agg && agg.articlesOnA.size > 0 ? [...agg.articlesOnA].join(", ") : "",
      ...base
    });
  });
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  const safe = fileBase.replace(/[\\/:*?"<>|]+/g, "_").slice(0, 80);
  XLSX.utils.book_append_sheet(wb, ws, "новинки+дубль");
  XLSX.writeFile(
    wb,
    `${safe}_новинки_B_плюс_дубль_на_${aShort}_${new Date().toISOString().slice(0, 10)}.xlsx`
  );
}

/** По одной строке на каждую пару «новинка B ↔ карточка A». */
export async function downloadCrossDuplicatePairsExcel(
  rows: OnlyBCrossWithARow[],
  nameLocale: NameLocale,
  fileBase: string,
  siteALabel: string,
  siteBLabel: string
): Promise<void> {
  if (typeof window === "undefined" || !rows.length) return;
  const XLSX = await import("xlsx");
  const out: Record<string, string>[] = rows.map((r) => {
    const a = r.productOnA;
    const b = r.productFromOnlyB;
    const pick = (c: typeof a) =>
      (nameLocale === "ru" ? c.nameRu : c.nameEn) || c.nameRu || c.nameEn;
    return {
      "Тип совпадения": crossKindRu(r.kind),
      "Общий EAN (если есть)": r.ean ?? "",
      "Ключ артикула при совпадении": r.article ?? "",
      Совпадение: r.matchReasons?.join(" + ") ?? "",
      [`ID (${siteALabel})`]: String(a.id),
      [`Артикул (${siteALabel})`]: a.articleKey ?? "",
      [`Название (${siteALabel})`]: pick(a),
      [`Ссылка (${siteALabel})`]: a.link,
      [`EAN (${siteALabel})`]: a.eans.join(", "),
      [`ID (${siteBLabel}) — новинка`]: String(b.id),
      [`Артикул (${siteBLabel})`]: b.articleKey ?? "",
      [`Название (${siteBLabel})`]: pick(b),
      [`Ссылка (${siteBLabel})`]: b.link,
      [`EAN (${siteBLabel})`]: b.eans.join(", ")
    };
  }).map(clipExcelRow);
  const ws = XLSX.utils.json_to_sheet(out);
  const wb = XLSX.utils.book_new();
  const safe = fileBase.replace(/[\\/:*?"<>|]+/g, "_").slice(0, 80);
  XLSX.utils.book_append_sheet(wb, ws, "дубли_пары");
  XLSX.writeFile(
    wb,
    `${safe}_дубли_новинок_B_${new Date().toISOString().slice(0, 10)}.xlsx`
  );
}

const SKIP_KEYS = new Set([
  "id",
  "name",
  "link",
  "eans",
  "brand",
  "i18n",
  "product_variation",
  "article",
  "code",
  "vendor_code",
  "original_name",
  "name_original",
  "supplier_name"
]);

/** Одна строка для Excel: фиксированные колонки + остальные поля из JSON, характеристики — в JSON-столбцах. */
export function flattenProductForExport(p: FpProduct, nameLocale: NameLocale): Record<string, string> {
  const eans = collectEans(p);
  const img = firstImageUrl(p) || "";
  const c = toCompareProduct(p);
  const trName =
    (nameLocale === "ru" ? c.nameRu : c.nameEn) || c.nameRu || c.nameEn;
  const row: Record<string, string> = {
    "ID товара": String(p.id),
    Артикул: String(p.article ?? p.code ?? p.vendor_code ?? ""),
    "Наименование (база / поставщик)": p.name || "",
    "Наименование (перевод, выбранный язык)": trName,
    "Наименование RU": c.nameRu,
    "Наименование EN": c.nameEn,
    "Наименование (original / supplier)": String(
      p.original_name ?? p.name_original ?? p.supplier_name ?? ""
    ),
    Бренд: c.brand,
    "EAN (все)": eans.join(", "),
    "Ссылка на карточку": p.link,
    "Изображение варианта (первое)": img
  };
  const raw = p as Record<string, unknown>;
  for (const k of Object.keys(p)) {
    if (SKIP_KEYS.has(k)) continue;
    const v = raw[k];
    if (v == null) continue;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      row[k] = String(v);
    } else {
      try {
        row[k] = JSON.stringify(v);
      } catch {
        row[k] = String(v);
      }
    }
  }
  if (p.i18n) {
    try {
      row["i18n (JSON)"] = JSON.stringify(p.i18n);
    } catch {
      /* ignore */
    }
  }
  if (p.product_variation) {
    try {
      row["product_variation (JSON)"] = JSON.stringify(p.product_variation);
    } catch {
      /* ignore */
    }
  }
  return row;
}

export async function downloadFpListAsExcel(
  items: FpProduct[],
  nameLocale: NameLocale,
  fileBase: string,
  options?: { sheetName?: string; fileSuffix?: string }
): Promise<void> {
  if (typeof window === "undefined" || !items.length) return;
  const XLSX = await import("xlsx");
  const rows = items.map((p) =>
    clipExcelRow(flattenProductForExport(p, nameLocale))
  );
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  const safe = fileBase.replace(/[\\/:*?"<>|]+/g, "_").slice(0, 80);
  const sheet =
    (options?.sheetName && options.sheetName.slice(0, 28)) || "list";
  const suffix = options?.fileSuffix || "list";
  XLSX.utils.book_append_sheet(
    wb,
    ws,
    sheet.length >= 1 ? sheet : "list"
  );
  XLSX.writeFile(
    wb,
    `${safe}_${suffix}_${new Date().toISOString().slice(0, 10)}.xlsx`
  );
}

export async function downloadOnlyBAsExcel(
  items: FpProduct[],
  nameLocale: NameLocale,
  fileBase: string
): Promise<void> {
  return downloadFpListAsExcel(items, nameLocale, fileBase, {
    sheetName: "только_на_B",
    fileSuffix: "only_B"
  });
}

/**
 * Каждое поле JSON товара — в колонку; вложенные объекты/массивы — в JSON-строку.
 * Плюс колонка с полным объектом.
 */
function flattenEntireProduct(p: FpProduct, nameLocale: NameLocale): Record<string, string> {
  const base = flattenProductForExport(p, nameLocale);
  const row: Record<string, string> = { ...base, "Полный JSON (товар)": "" };
  try {
    row["Полный JSON (товар)"] = JSON.stringify(p);
  } catch {
    row["Полный JSON (товар)"] = "[ошибка сериализации]";
  }
  return row;
}

export async function downloadNerazmeshennyeSiteAExcel(
  items: FpProduct[],
  nameLocale: NameLocale,
  fileBase: string
): Promise<void> {
  if (typeof window === "undefined" || !items.length) return;
  const XLSX = await import("xlsx");
  const rows = items.map((p) =>
    clipExcelRow(flattenEntireProduct(p, nameLocale))
  );
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  const safe = fileBase.replace(/[\\/:*?"<>|]+/g, "_").slice(0, 80);
  XLSX.utils.book_append_sheet(
    wb,
    ws,
    "неразмещен_A".slice(0, 28)
  );
  XLSX.writeFile(
    wb,
    `${safe}_неразмещенные_сайт_A_${new Date().toISOString().slice(0, 10)}.xlsx`
  );
}
