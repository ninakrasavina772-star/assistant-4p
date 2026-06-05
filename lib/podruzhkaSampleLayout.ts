/**
 * Структура как в «дляинфографики подружка образец таблицы.xlsx»
 * (порядок столбцов важен для понимания, поиск — по имени заголовка).
 */
export const PODRUZHKA_SAMPLE_COLUMNS = [
  { col: 2, header: "name", role: "Полное название (для AI)" },
  { col: 3, header: "brand name", role: "Бренд на карточке" },
  { col: 4, header: "product_type", role: "Тип товара в фиде" },
  { col: 5, header: "product name", role: "Название в фиде" },
  { col: 6, header: "foto", role: "Фото товара (ссылка)" },
  { col: 7, header: "ml", role: "Объём" },
  { col: 8, header: "foto 2", role: "Готовая инфографика (JPG)" },
  { col: 9, header: "note 1", role: "Нота 1 — заголовок (AI), напр. ДРЕВЕСНЫЙ" },
  { col: 10, header: "note 1 (2)", role: "Нота 1 — описание (AI), напр. тёплый и глубокий" },
  { col: 11, header: "note 2", role: "Нота 2 — заголовок (AI)" },
  { col: 12, header: "note 2 (1)", role: "Нота 2 — описание (AI)" },
  { col: 13, header: "note 3", role: "Нота 3 — заголовок (AI)" },
  { col: 14, header: "note 3 (1)", role: "Нота 3 — описание (AI)" },
  { col: 15, header: "model", role: "Имя аромата — пишет AI (212 Sexy)" },
  {
    col: 0,
    header: "product type card",
    role: "Тип на карточке — AI, только если не совпал с product_type"
  },
  { col: 16, header: "foto 3", role: "Публичный https для Ozon" }
] as const;
