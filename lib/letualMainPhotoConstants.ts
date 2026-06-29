/** Квадратное главное фото Летуаль (мин. 845×845; используем 1000×1000). */
export const LETUAL_CANVAS_SIZE = 1000;

export const LETUAL_JPEG_QUALITY = 92;

/** Высота/ширина силуэта > 1.15 → вертикальный (тип A). */
export const LETUAL_ASPECT_VERTICAL_MIN = 1.15;

/** Ширина/высота силуэта > 1.15 → широкий низкий (тип C). */
export const LETUAL_ASPECT_WIDE_LOW_MIN = 1.15;

/** Боковые отступы для квадратных/широких (тип B) — не меньше этого зазора. */
export const LETUAL_SIDE_MARGIN_SQUARE = 130;
/** Боковые отступы для широких низких (тип C). */
export const LETUAL_SIDE_MARGIN_WIDE_LOW = 50;

/** Максимум variation_id за одну сессию в UI. */
export const LETUAL_BATCH_MAX = 50;

/** Сколько позиций за один HTTP-запрос к API. */
export const LETUAL_API_CHUNK = 10;

/** Параллельный подбор фото (вариаций) на сервере. */
export const LETUAL_PICK_CONCURRENCY = 8;

/** Параллельная подгрузка галерей Metabase (только SQL, без AI). */
export const LETUAL_GALLERY_CONCURRENCY = 10;

/** Параллельная генерация JPG на сервере. */
export const LETUAL_GENERATE_CONCURRENCY = 5;

/** Параллельное скачивание URL. */
export const LETUAL_DOWNLOAD_CONCURRENCY = 12;

/** Сколько URL скачивать и анализировать при быстром подборе (CDN первыми). */
export const LETUAL_PICK_URL_MAX = 8;

/** Сколько лучших URL отправлять в OpenAI Vision (после техоценки). */
export const LETUAL_VISION_TOP = 6;

/** Сколько vision-запросов одновременно внутри одной вариации. */
export const LETUAL_VISION_BATCH = 3;

export type LetualLayoutType = "vertical" | "square_wide" | "wide_low";
