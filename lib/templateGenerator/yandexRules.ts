/** Правила контента для витрины Яндекс Маркет */

export const YANDEX_TITLE_MIN_LEN = 60;
export const YANDEX_TITLE_MAX_LEN = 80;
const DESCRIPTION_MIN_LEN = 600;

/** Только свойства товара — для добивки длины, если AI не дотянул */
const TITLE_PRODUCT_ADJECTIVES = [
  "увлажняющий",
  "питательный",
  "восстанавливающий",
  "очищающий",
  "тонизирующий",
  "антивозрастной",
  "древесный",
  "цветочный",
  "морской",
  "стойкий"
];

/** Маркетинговый шум — убираем из названия */
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
Дополнительные правила для Яндекс Маркета:

НАЗВАНИЕ ТОВАРА (если поле в списке):
- Структура: ТИП товара на русском + бренд + модель/линейка + при необходимости ровно 1 прилагательное о свойстве товара.
- Длина: от ${YANDEX_TITLE_MIN_LEN} до ${YANDEX_TITLE_MAX_LEN} символов включительно. Не длиннее ${YANDEX_TITLE_MAX_LEN}!
- Прилагательное только одно и только про товар: увлажняющий, питательный, древесный, матовый, стойкий и т.п.
- ЗАПРЕЩЕНО в названии: премиальный, популярный, оригинальный, элегантный, стильный, лучший, топовый, эксклюзивный и любой маркетинговый шум.
- НЕ указывать: объём (мл, г, л), оттенок, номер тона, SPF, размер, артикул, EAN.
- Пример: Крем для лица BIOTHERM Night Spa увлажняющий
- Пример (парфюм): Туалетная вода для мужчин Ferrari Scuderia Black морской

ОПИСАНИЕ ТОВАРА (если поле в списке):
- Минимум ${DESCRIPTION_MIN_LEN} символов, лучше 800–1500.
- Строго по блокам (каждый блок — отдельный абзац, пустая строка между блоками):
  Блок 1: Название товара (одна строка)
  Блок 2: Описание товара и отличительные особенности (2–4 предложения)
  Блок 3: 2–3 преимущества о бренде
  Блок 4: Один уникальный факт о товаре (1 предложение)
  Блок 5: Краткий финал про оригинальность (без гарантий и юридических обещаний)
  Блок 6: Как использовать и кому подойдёт
- Для парфюм после блоков о бренде можно добавить пирамиду аромата (верх/сердце/база) и настроение нот.
- Без сухой цепочки, без выдуманных оттенков и цен.`;

export function buildYandexFieldHint(header: string): string | null {
  if (isYandexTitleHeader(header)) {
    return `Яндекс Маркет: тип + бренд + модель + 1 прилагательное о товаре (увлажняющий и т.п.), без «премиальный/популярный», ${YANDEX_TITLE_MIN_LEN}–${YANDEX_TITLE_MAX_LEN} символов`;
  }
  if (isYandexDescriptionHeader(header)) {
    return `Яндекс Маркет: структурированное описание по 6 блокам, минимум ${DESCRIPTION_MIN_LEN} символов`;
  }
  return null;
}

/** Убрать объём, оттенок и прочий шум из названия */
export function stripYandexTitleNoise(title: string): string {
  let t = title.trim();
  for (const re of [PAREN_NOISE_RE, VOLUME_RE, SHADE_RE, SPF_RE]) {
    t = t.replace(re, " ");
  }
  t = t.replace(TRAILING_NOISE_RE, "");
  return t.replace(/\s+/g, " ").replace(/^[\s,.-]+|[\s,.-]+$/g, "").trim();
}

/** Убрать маркетинговые прилагательные */
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

/** Привести название к правилам Яндекс Маркета (60–80 символов) */
export function padYandexTitle(title: string): string {
  let t = stripGenericTitleAdjectives(stripYandexTitleNoise(title));
  if (!t) return title.trim();

  if (t.length < YANDEX_TITLE_MIN_LEN) {
    const hasProductAdj = TITLE_PRODUCT_ADJECTIVES.some((adj) =>
      t.toLowerCase().includes(adj.toLowerCase())
    );
    if (!hasProductAdj) {
      for (const adj of TITLE_PRODUCT_ADJECTIVES) {
        const candidate = `${t} ${adj}`.trim();
        if (candidate.length <= YANDEX_TITLE_MAX_LEN) {
          t = candidate;
          break;
        }
      }
    }
  }

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
  const t = padYandexTitle(text);
  return t.length < YANDEX_TITLE_MIN_LEN || t.length > YANDEX_TITLE_MAX_LEN;
}

export function yandexDescriptionTooShort(text: string): boolean {
  return text.trim().length < DESCRIPTION_MIN_LEN;
}
