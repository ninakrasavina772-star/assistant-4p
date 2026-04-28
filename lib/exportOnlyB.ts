import { collectEans, firstImageUrl, toCompareProduct } from "./product";
import type { FpProduct, NameLocale } from "./types";

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
  const rows = items.map((p) => flattenProductForExport(p, nameLocale));
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
  const rows = items.map((p) => flattenEntireProduct(p, nameLocale));
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
