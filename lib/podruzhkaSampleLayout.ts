/**
 * Структура как в файлах «образец.xlsx» / «дляинфографики подружка образец.xlsx»
 * (порядок столбцов важен для понимания, поиск — по имени заголовка).
 */
export const PODRUZHKA_SAMPLE_COLUMNS = [
  { col: 2, header: "name", role: "Полное название (для AI)" },
  { col: 3, header: "brand name", role: "Бренд на карточке" },
  { col: 4, header: "product_type", role: "Тип товара (серый текст)" },
  { col: 5, header: "product name", role: "Название в фиде" },
  { col: 6, header: "foto", role: "Фото товара (ссылка)" },
  { col: 7, header: "ml", role: "Объём" },
  { col: 8, header: "note 1", role: "Нота 1 — пишет AI (как в образце)" },
  { col: 9, header: "note 2", role: "Нота 2 — пишет AI" },
  { col: 10, header: "note 3", role: "Нота 3 — пишет AI" },
  { col: 11, header: "model", role: "Имя аромата — пишет AI (Pardon)" },
  { col: 12, header: "foto 2", role: "Готовая инфографика (JPG)" },
  { col: 13, header: "foto 3", role: "Публичный https для Ozon" }
] as const;
