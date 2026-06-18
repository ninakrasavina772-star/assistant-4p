/** Вёрстка косметики — v5: новый template-base (петля) */
export const PODRUZHKA_COSMETICS_LAYOUT_VERSION = "html-figma-cosmetics-v55-clean-grid";

export type PodruzhkaCosmeticsFotoMode = "raw" | "edge" | "cutout" | "ai";

/**
 * ai — локальная модель снятия фона (бесплатно, кэш в Yandex).
 * edge — эвристика; raw — foto как на Ozon; cutout — старый pipeline.
 */
export const PODRUZHKA_COSMETICS_FOTO_MODE: PodruzhkaCosmeticsFotoMode = "cutout";

/** Серые описания benefit: +2px к парфюму (20 → 22) */
export const PODRUZHKA_COSMETICS_NOTE_DESC_SIZE = 22;

/** Заголовки benefit — как у парфюма */
export const PODRUZHKA_COSMETICS_NOTE_TITLE_SIZE = 28;

/** Базовый множитель масштаба (единый для всех SKU) */
export const PODRUZHKA_COSMETICS_PRODUCT_SCALE = 1.12;

/** Целевая высота — доля зоны foto справа (~как зелёная рамка на макете) */
export const PODRUZHKA_COSMETICS_TARGET_ZONE_HEIGHT_FILL = 0.82;

/** Мин. ширина в зоне — чтобы узкие ручки/карандаши не были «точкой» */
export const PODRUZHKA_COSMETICS_TARGET_ZONE_WIDTH_FILL = 0.46;

/** Вертикальный центр в зоне (0.5 = ровно по центру текста слева) */
export const PODRUZHKA_COSMETICS_VERTICAL_CENTER_BIAS = 0.52;

export type PodruzhkaRenderProfile = "perfume" | "cosmetics";
