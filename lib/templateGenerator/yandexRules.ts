/** Правила контента для витрины Яндекс Маркет */

export const YANDEX_TITLE_MIN_LEN = 60;
export const YANDEX_TITLE_MAX_LEN = 80;
const DESCRIPTION_MIN_LEN = 600;

/** Субъективные / маркетинговые прилагательные — не свойства товара */
const GENERIC_ADJ_RE =
  /\b(?:премиальн\w*|популярн\w*|оригинальн\w*|элегантн\w*|стильн\w*|эксклюзивн\w*|уникальн\w*|качественн\w*|шикарн\w*|надёжн\w*|надежн\w*|лучш\w*|топов\w*|бестселлер\w*|новинк\w*|рекомендуем\w*|профессиональн\w*|стойк\w*|загадочн\w*|солнечн\w*|насыщенн\w*|таинственн\w*|чувственн\w*|соблазнительн\w*|роскошн\w*|изысканн\w*|волшебн\w*|идеальн\w*|совершенн\w*|невероятн\w*|потрясающ\w*|божественн\w*|восхитительн\w*|завораживающ\w*|чарующ\w*|утонченн\w*|нежн\w*|ярк\w*|замечательн\w*)\b/gi;

/** Английские типы/формулировки вместо русского типа товара */
const EN_PRODUCT_TYPE_RE =
  /\b(?:eau de parfum|eau de toilette|eau de cologne|edt|edp|extrait de parfum|parfum spray|parfum\b|toilette\b|for women|for men|for her|for him|\bwomen\b|\bmen\b|\bfemme\b|\bhomme\b|women eau|men eau|unisex eau|vapo(?:risateur)?|vaporisateur|deodorant spray|body spray|eau fra[iî]che|\bspray\b)\b/i;

const RU_PRODUCT_TYPE_START =
  /^(?:парфюмерная вода|туалетная вода|духи|одеколон|парфюмированный спрей|парфюмерия|женская парфюмерия|мужская парфюмерия|парфюмерия унисекс|эмульсия|крем|гель|лосьон|шампунь|маска|сыворотка|тональный крем|помада|тушь|пудра|консилер|бальзам|масло|скраб|пенка|спрей|дезодорант)/i;

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


export const YANDEX_PHOTO_MANAGER_APPEND = `
ФОТО — отбирай как категорийный менеджер. Это так же важно, как название и описание.

ИСТОЧНИК:
- Приоритет — только foto из нашей админки (cdnru.4stand.com, api.4stand.com/uploads).
- Supplier (Lyko, Douglas, BigBuy, Notino и т.п.) — НЕ использовать, если в админке есть foto.
- Инфографика, before/after, promo, баннеры, GIF — НИКОГДА в витрину.

СТРУКТУРА ГАЛЕРЕИ (для каждого SKU):
1. Главное — packshot на белом: полный товар, чёткий, без текста. Стандарт LetuAl: 1000×1000 на белом.
2. Доп. packshot на белом — другой ракурс: упаковка+товар, оттенок/swatch, другой угол. НЕ дубль главного.
3. Доп. на фоне — 1–4 качественных lifestyle из админки (сцена, пропсы, атмосфера). Чёткие, не мутные.

ДУБЛИ И ОТБРАКОВКА:
- Дубль = тот же ракурс (товар в одном положении), даже если другой URL или размер.
- Мелкие превью, мутные, обрезанные, повторы ракурса — выбрасывать.
- Не «набирать ради количества» — лучше 3–6 сильных кадра, чем 15 слабых.

ПРИМЕРЫ (ориентир):
- V99409819: главное 8a871822 (белый); доп белый 03a23a03; доп на фоне 4f2a9b34.
- V134774375: главное a738df67; доп оттенок 5c560e3a; lifestyle 5ffbf9a8, 7c5b15e9, adeeb331.
- НЕ брать: мелкое 29a1bc65; дубли e1510ee2/3ae39eaa; Lyko _22 (promo before/after).`;

export const YANDEX_SYSTEM_APPEND = `
Дополнительные правила для Яндекс Маркета. Действуй как опытный категорийный менеджер: на совесть, без лени, без «галочки ради галочки».

ОБЩИЕ ПРИНЦИПЫ:
- Заполняй КАЖДОЕ поле из списка. Не пропускай строки и не оставляй пустым то, что можно вывести из названия, бренда, CSV, сайта бренда или типа товара.
- Пиши для покупателя: живо, убедительно, по делу — как человек, а не как шаблонный генератор.
- Не подставляй одно и то же слово во все карточки (особенно «увлажняющий» для парфюма, декоративки и т.п.).

НАЗВАНИЕ ТОВАРА (если поле в списке):
- Язык: название на РУССКОМ. Английские слова допустимы ТОЛЬКО в бренде и модели/линейке (Calvin Klein, Si Passione, La Vie Est Belle).
- Структура (строго): ТИП товара на русском + бренд + модель/линейка + ровно 1 прилагательное об ОБЪЕКТИВНОМ свойстве.
- Тип товара — только по-русски: «Парфюмерная вода», «Туалетная вода», «Духи», «Парфюмированный спрей», «Крем для лица» и т.п.
- ЗАПРЕЩЕНО в названии: Eau de Parfum, Eau de Toilette, EDT, EDP, for women, for men, Women, Men, Vapo, Spray как тип товара.
- Длина: ${YANDEX_TITLE_MIN_LEN}–${YANDEX_TITLE_MAX_LEN} символов. Не длиннее ${YANDEX_TITLE_MAX_LEN}!
- Допустимое свойство — только факт о товаре, не реклама:
  • Парфюм: семейство аромата (цветочный, восточный, древесный, фруктовый, свежий, морской, пряный, амбровый, шипровый, цитрусовый).
  • Косметика: функция или текстура (увлажняющий, питательный, матовый).
  • Если свойство неочевидно — не добавляй прилагательное, расширяй модель/линейкой.
- ЗАПРЕЩЕНО (маркетинг): стойкий, уникальный, загадочный, солнечный, насыщенный, премиальный, популярный, оригинальный, элегантный, лучший, топовый, эксклюзивный.
- ЗАПРЕЩЕНО: объём, оттенок, SPF, артикул, EAN.
- Примеры ПРАВИЛЬНО:
  • Парфюмерная вода Giorgio Armani Si Passione цветочная
  • Туалетная вода для женщин Lancôme La Vie Est Belle цветочная
  • Парфюмерная вода Calvin Klein Eternity свежая
  • Крем для лица BIOTHERM Aquasource Night Spa питательный
- Примеры НЕПРАВИЛЬНО (так нельзя):
  • Calvin Klein Women Eau de Parfum
  • Lancome La Vie Est Belle - Eau de Parfum
  • BOSS FEMME eau de parfum spray

ОПИСАНИЕ ТОВАРА (если поле в списке):
- Минимум ${DESCRIPTION_MIN_LEN} символов, лучше 800–1500.
- Структура по блокам (абзацы через пустую строку): название → описание и особенности → бренд → уникальный факт → оригинальность → кому подойдёт.
- Для парфюма — пирамида нот. Без выдуманных оттенков и цен.`;

export function buildYandexFieldHint(header: string): string | null {
  if (isYandexTitleHeader(header)) {
    return `Яндекс: тип на русском + бренд + модель + 1 свойство (цветочный/восточный…), ${YANDEX_TITLE_MIN_LEN}–${YANDEX_TITLE_MAX_LEN} симв.; без Eau de Parfum/for women`;
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
  GENERIC_ADJ_RE.lastIndex = 0;
  return title.replace(GENERIC_ADJ_RE, " ").replace(/\s+/g, " ").trim();
}

export function hasBannedTitleAdjectives(title: string): boolean {
  GENERIC_ADJ_RE.lastIndex = 0;
  return GENERIC_ADJ_RE.test(title);
}

export function titleHasEnglishProductType(title: string): boolean {
  return EN_PRODUCT_TYPE_RE.test(title);
}

export function yandexTitleLanguageNeedsFix(title: string): boolean {
  const t = stripYandexTitleNoise(title).trim();
  if (!t) return true;
  if (titleHasEnglishProductType(t)) return true;
  if (!RU_PRODUCT_TYPE_START.test(t)) return true;
  const head = t.slice(0, 48);
  if (!/[а-яё]/i.test(head)) return true;
  return false;
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
  if (hasBannedTitleAdjectives(raw)) return true;
  if (yandexTitleLanguageNeedsFix(raw)) return true;
  const t = stripGenericTitleAdjectives(raw);
  return t.length < YANDEX_TITLE_MIN_LEN || t.length > YANDEX_TITLE_MAX_LEN;
}

export function yandexDescriptionTooShort(text: string): boolean {
  return text.trim().length < DESCRIPTION_MIN_LEN;
}
