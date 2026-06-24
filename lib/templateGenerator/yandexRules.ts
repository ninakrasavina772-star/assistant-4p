/** Правила контента для витрины Яндекс Маркет */

export const YANDEX_TITLE_MIN_LEN = 60;
export const YANDEX_TITLE_MAX_LEN = 80;
const DESCRIPTION_MIN_LEN = 600;

const GENERIC_ADJ_RE =
  /\b(?:премиальн\w*|популярн\w*|оригинальн\w*|элегантн\w*|стильн\w*|эксклюзивн\w*|уникальн\w*|качественн\w*|шикарн\w*|надёжн\w*|надежн\w*|лучш\w*|топов\w*|бестселлер\w*|новинк\w*|рекомендуем\w*|профессиональн\w*)\b/gi;

const VOLUME_RE =
  /\b\d+[\s.,]?\d*\s*(?:мл|ml|мл\.|л|l|г|g|кг|kg|шт\.?|pcs|уп\.?)\b/gi;
const SHADE_RE =
  /\b(?:оттенок|тон|shade|color|цвет|colou?rway)\s*[#№]?\s*[\w\d./-]+\b/gi;
const SPF_RE = /\bspf\s*\d+\b/gi;
const PAREN_NOISE_RE = /\([^)]*(?:мл|ml|оттенок|тон|spf|объ[её]м)[^)]*\)/gi;
const TRAILING_NOISE_RE =
  /[,;]\s*(?:объ[её]м|оттенок|тон|размер|spf)\b.*$/i;

export function isYandexTitleHeader(header: string): boolean {
  const h = header.toLowerCase();
  return /название товара/.test(h);
}

export function isYandexDescriptionHeader(header: string): boolean {
  const h = header.toLowerCase();
  return /описание/.test(h) && !/кратк|short|seo/i.test(h);
}

export const YANDEX_SYSTEM_APPEND = `
Дополнительные правила для Яндекс Маркета. Действуй как опытный категорийный менеджер: на совесть, без лени, без «галочки ради галочки».

ОБЩИЕ ПРИНЦИПЫ:
- Заполняй КАЖДОЕ поле из списка. Не пропускай строки и не оставляй пустым то, что можно вывести из названия, бренда, CSV, сайта бренда или типа товара.
- Пиши для покупателя: живо, убедительно, по делу — как человек, а не как шаблонный генератор.
- Не подставляй одно и то же слово во все карточки (особенно «увлажняющий» для парфюма, декоративки и т.п.).

НАЗВАНИЕ ТОВАРА (если поле в списке):
- Структура: ТИП товара на русском + бренд + модель/линейка + при необходимости ровно 1 прилагательное о СВОЙСТВЕ товара.
- Длина: ${YANDEX_TITLE_MIN_LEN}–${YANDEX_TITLE_MAX_LEN} символов. Не длиннее ${YANDEX_TITLE_MAX_LEN}!
- Прилагательное — только если оно правда про товар: «увлажняющий» для крема, «стойкий» для парфюма, «морской» для аромата с морскими нотами. Если не уместно — не добавляй.
- ЗАПРЕЩЕНО: премиальный, популярный, оригинальный, элегантный, стильный, лучший, топовый, эксклюзивный и любой маркетинговый шум.
- ЗАПРЕЩЕНО: объём, оттенок, SPF, артикул, EAN.
- Примеры:
  • Крем для лица BIOTHERM Aquasource Night Spa питательный
  • Туалетная вода для мужчин Ferrari Scuderia Black морской
  • Помада для губ MAC Ruby Woo матовая

ОПИСАНИЕ ТОВАРА (если поле в списке):
- Минимум ${DESCRIPTION_MIN_LEN} символов, лучше 800–1500.
- Структура по блокам (абзацы через пустую строку): название → описание и особенности → бренд → уникальный факт → оригинальность → кому подойдёт.
- Для парфюма — пирамида нот. Без выдуманных оттенков и цен.`;

export function buildYandexFieldHint(header: string): string | null {
  if (isYandexTitleHeader(header)) {
    return `Яндекс: тип + бренд + модель/линейка + 0–1 прилагательное по смыслу товара (не шаблонное), ${YANDEX_TITLE_MIN_LEN}–${YANDEX_TITLE_MAX_LEN} символов`;
  }
  if (isYandexDescriptionHeader(header)) {
    return `Яндекс: продающее описание по блокам, минимум ${DESCRIPTION_MIN_LEN} символов, как у категорийного менеджера`;
  }
  return null;
}

export function stripYandexTitleNoise(title: string): string {
  let t = title.trim();
  for (const re of [PAREN_NOISE_RE, VOLUME_RE, SHADE_RE, SPF_RE]) {
    t = t.replace(re, " ");
  }
  t = t.replace(TRAILING_NOISE_RE, "");
  return t.replace(/\s+/g, " ").replace(/^[\s,.-]+|[\s,.-]+$/g, "").trim();
}

export function stripGenericTitleAdjectives(title: string): string {
  return title.replace(GENERIC_ADJ_RE, " ").replace(/\s+/g, " ").trim();
}

function truncateAtWord(title: string, maxLen: number): string {
  if (title.length <= maxLen) return title;
  const cut = title.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(" ");
  if (lastSpace >= YANDEX_TITLE_MIN_LEN - 15) return cut.slice(0, lastSpace).trim();
  return cut.trim();
}

/** Нормализация названия без автоподстановки шаблонных прилагательных */
export function padYandexTitle(title: string): string {
  let t = stripGenericTitleAdjectives(stripYandexTitleNoise(title));
  if (!t) return title.trim();
  if (t.length > YANDEX_TITLE_MAX_LEN) {
    t = truncateAtWord(t, YANDEX_TITLE_MAX_LEN);
  }
  return t;
}

export function yandexTitleNeedsFix(text: string): boolean {
  const raw = stripYandexTitleNoise(text);
  if (GENERIC_ADJ_RE.test(raw)) {
    GENERIC_ADJ_RE.lastIndex = 0;
    return true;
  }
  const t = stripGenericTitleAdjectives(raw);
  return t.length < YANDEX_TITLE_MIN_LEN || t.length > YANDEX_TITLE_MAX_LEN;
}

export function yandexDescriptionTooShort(text: string): boolean {
  return text.trim().length < DESCRIPTION_MIN_LEN;
}
