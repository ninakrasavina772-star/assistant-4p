/** Вёрстка косметики — фиксированный лаконичный масштаб (v2). */
export const PODRUZHKA_COSMETICS_LAYOUT_VERSION = "html-figma-cosmetics-v2";

/** Серые описания benefit: +2px к парфюму (20 → 22) */
export const PODRUZHKA_COSMETICS_NOTE_DESC_SIZE = 22;

/** Заголовки benefit — как у парфюма */
export const PODRUZHKA_COSMETICS_NOTE_TITLE_SIZE = 28;

/** Единый масштаб foto для всех SKU косметики */
export const PODRUZHKA_COSMETICS_PRODUCT_SCALE = 1.05;

/** Единый отступ снизу (px) — одинаковая «посадка» на всех карточках */
export const PODRUZHKA_COSMETICS_BOTTOM_LIFT_PX = 24;

/** Макс. доля высоты зоны foto — не поджимаем к блокам свойств слева */
export const PODRUZHKA_COSMETICS_MAX_ZONE_HEIGHT_FILL = 0.48;

export type PodruzhkaRenderProfile = "perfume" | "cosmetics";
