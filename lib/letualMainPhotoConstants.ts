/** Квадратное главное фото Летуаль (мин. 845×845; используем 1000×1000). */
export const LETUAL_CANVAS_SIZE = 1000;

export const LETUAL_JPEG_QUALITY = 92;

/** Высота/ширина силуэта > 1.15 → вертикальный (тип A). */
export const LETUAL_ASPECT_VERTICAL_MIN = 1.15;

/** Ширина/высота силуэта > 1.15 → широкий низкий (тип C). */
export const LETUAL_ASPECT_WIDE_LOW_MIN = 1.15;

export const LETUAL_SIDE_MARGIN_SQUARE = 130;
export const LETUAL_SIDE_MARGIN_WIDE_LOW = 50;
/** Верхний и нижний отступ для вертикальных флаконов (тип A). */
export const LETUAL_VERTICAL_MARGIN = 100;

export const LETUAL_BATCH_MAX = 20;
export const LETUAL_API_CHUNK = 3;

export type LetualLayoutType = "vertical" | "square_wide" | "wide_low";
