/** Нормализация заголовка столбца для сопоставления */
export function normHeader(s: string): string {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\*+$/, "")
    .trim();
}

const READONLY_HINT = /не будет изменено при загрузке/i;

const READONLY_HEADERS = new Set(
  [
    "критичные ошибки",
    "некритичные ошибки",
    "качество карточки",
    "рекомендации по заполнению",
    "в архиве",
    "param_names",
    "csku на маркете",
    "дата дополнения карточки",
    "цена",
    "цена до скидки",
    "валюта",
    "ндс",
    "вес, г",
    "вес, кг",
    "ширина, мм",
    "высота, мм",
    "длина, мм",
    "габариты",
    "штрихкод",
    "штрих-код",
    "ean",
    "gtin"
  ].map(normHeader)
);

const CONTENT_DEFAULT_HEADERS = new Set(
  [
    "название товара",
    "описание товара",
    "тип",
    "пол",
    "семейство",
    "объем флакона, мл",
    "объём флакона, мл",
    "верхние ноты",
    "средние ноты",
    "базовые ноты",
    "ноты",
    "линейка",
    "год",
    "состав",
    "тестер",
    "особенности флакона",
    "состав набора",
    "дополнительная информация",
    "прочие характеристики"
  ].map(normHeader)
);

const SKU_HEADERS = ["артикул товара (sku)", "ваш sku", "артикул", "sku", "shop-sku", "shop sku"].map(
  normHeader
);

const IMAGE_HEADERS = ["ссылка на изображение", "изображение для миниатюры"].map(normHeader);

export function isReadonlyColumn(header: string, hint: string): boolean {
  const h = normHeader(header);
  if (READONLY_HEADERS.has(h)) return true;
  if (READONLY_HINT.test(hint)) return true;
  if (isSkuHeader(header)) return true;
  if (isImageHeader(header)) return true;
  if (/цена|валют|штрих|barcode|ean|gtin/i.test(h)) return true;
  if (/вес|габарит|ширин|высот|длин/i.test(h) && /мм|кг|г\b|см/i.test(h)) return true;
  return false;
}

export function isContentDefaultColumn(header: string): boolean {
  return CONTENT_DEFAULT_HEADERS.has(normHeader(header));
}

/** Ключевые контентные поля карточки (описание, ноты, тип…) — приоритет при генерации */
const CORE_CONTENT_PATTERNS: RegExp[] = [
  /^название товара/,
  /^описание товара/,
  /^тип$/,
  /^бренд/,
  /^пол$/,
  /^семейство$/,
  /^верхние ноты/,
  /^средние ноты/,
  /^базовые ноты/,
  /^ноты$/,
  /^объем флакона/,
  /^объём флакона/,
  /^линейка$/,
  /^год$/,
  /^тестер$/,
  /^дополнительная информация$/,
  /^прочие характеристики$/
];

export function isCoreContentColumn(header: string): boolean {
  const h = normHeader(header);
  return CORE_CONTENT_PATTERNS.some((re) => re.test(h));
}

export function isSkuHeader(header: string): boolean {
  const h = normHeader(header);
  if (SKU_HEADERS.some((x) => h === x || h.includes("артикул товара"))) return true;
  if (h === "sku" || h === "артикул" || h.includes("shop sku") || h.includes("shop-sku")) return true;
  if (/^ваш\s+sku/.test(h)) return true;
  if (h.includes("артикул") && !/маркет|market|csku|на\s+маркете/.test(h)) return true;
  return false;
}

export function isImageHeader(header: string): boolean {
  return IMAGE_HEADERS.some((x) => normHeader(header).startsWith(x));
}

/** Сопоставление заголовка данных с колонкой на листе «Список значений» */
export function listSheetNameForHeader(header: string): string | null {
  const h = normHeader(header).replace(/\*+$/, "").trim();
  const map: Record<string, string> = {
    бренд: "Бренд",
    валюта: "Валюта",
    тип: "Тип",
    тестер: "Тестер",
    пол: "Пол",
    семейство: "Семейство",
    "особенности флакона": "Особенности флакона",
    линейка: "Линейка",
    год: "Год",
    "страна производства": "Страна производства"
  };
  return map[h] ?? null;
}

export const DEFAULT_PHOTO_REVIEW_COLUMN = "Доп. фото (проверка)";

export const LIST_VALUES_SHEET = "Список значений";

export const DEFAULT_PRODUCT_DATA_SHEET = "Данные о товарах";

/** @deprecated используйте DEFAULT_PRODUCT_DATA_SHEET — лист по умолчанию в шаблонах Ozon/Яндекс и др. */
export const OZON_DATA_SHEET = DEFAULT_PRODUCT_DATA_SHEET;
