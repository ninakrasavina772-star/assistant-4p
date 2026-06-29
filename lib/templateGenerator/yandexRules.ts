/** Правила контента для витрины Яндекс Маркет */

export const YANDEX_TITLE_MIN_LEN = 60;
export const YANDEX_TITLE_MIN_LEN_PERFUME = 55;
export const YANDEX_TITLE_MAX_LEN = 80;
export const YANDEX_TITLE_TARGET_LEN = 75;
const DESCRIPTION_MIN_LEN = 600;

/** Субъективные / маркетинговые прилагательные — не свойства товара */
const GENERIC_ADJ_RE =
  /\b(?:премиальн\w*|популярн\w*|оригинальн\w*|элегантн\w*|стильн\w*|эксклюзивн\w*|уникальн\w*|качественн\w*|шикарн\w*|надёжн\w*|надежн\w*|лучш\w*|топов\w*|бестселлер\w*|новинк\w*|рекомендуем\w*|профессиональн\w*|стойк\w*|загадочн\w*|солнечн\w*|насыщенн\w*|таинственн\w*|чувственн\w*|соблазнительн\w*|роскошн\w*|изысканн\w*|волшебн\w*|идеальн\w*|совершенн\w*|невероятн\w*|потрясающ\w*|божественн\w*|восхитительн\w*|завораживающ\w*|чарующ\w*|утонченн\w*|нежн\w*|ярк\w*|замечательн\w*|фирменн\w*|брендов\w*|культов\w*|легендарн\w*|знаменит\w*|именит\w*|бесподобн\w*|чудесн\w*|восхитительн\w*|безупречн\w*|непревзойд\w*|неповторим\w*|исключительн\w*|фантастическ\w*|гипнотизирующ\w*|магическ\w*|божественн\w*|безупречн\w*|вдохновляющ\w*|завораживающ\w*|обольстительн\w*|манящ\w*|пленительн\w*|волнующ\w*|страстн\w*|романтичн\w*|дерзк\w*|соблазнительн\w*|натуральн\w*|органическ\w*|аутентичн\w*|настоящ\w*|подлинн\w*)\b/gi;

/** Допустимые объективные свойства в конце названия (семейство аромата, функция косметики) */
const ALLOWED_TITLE_PROPERTY_RE =
  /^(?:цветочн[а-яё]*|восточн[а-яё]*|древесн[а-яё]*|фруктов[а-яё]*|свеж[а-яё]*|морск[а-яё]*|прян[а-яё]*|амбров[а-яё]*|шипров[а-яё]*|цитрусов[а-яё]*|акватическ[а-яё]*|альдегидн[а-яё]*|кожан[а-яё]*|гурманск[а-яё]*|фужер[а-яё]*|увлажняющ[а-яё]*|питательн[а-яё]*|матов[а-яё]*|активн[а-яё]*|ночн[а-яё]*|дневн[а-яё]*|антивозрастн[а-яё]*|тонизирующ[а-яё]*|очищающ[а-яё]*|успокаивающ[а-яё]*|лифтинг[а-яё]*|себорегулирующ[а-яё]*|укрепляющ[а-яё]*|восстанавливающ[а-яё]*|разглаживающ[а-яё]*|осветляющ[а-яё]*)$/i;

const ALLOWED_AROMA_COMPOUND_RE =
  /^[а-яё]+(?:-[а-яё]+)*(?:ый|ий|ой)$/i;

/** Примеры плохих названий — для промпта AI */
export const YANDEX_TITLE_BAD_EXAMPLES = [
  "Парфюмерная вода Giorgio Armani Si Passione стойкая",
  "Духи Escentric Molecules Molecule 04 уникальные",
  "Парфюмерная вода LANCOME LA NUIT TRÉSOR загадочная",
  "Парфюмированный спрей SOL DE JANEIRO Cheirosa 62 солнечный"
] as const;

/** Англ. фразы типа товара — удаляем из названия (не трогаем Women/Men в названии линейки) */
const EN_TITLE_STRIP_RE =
  /\b(?:eau de parfum|eau de toilette|eau de cologne|edt|edp|extrait de parfum|parfum spray|toilette spray|for women|for men|for her|for him|women eau|men eau|unisex eau|vapo(?:risateur)?|vaporisateur|deodorant spray|body spray|eau fra[iî]che)\b/gi;

/** Для проверки языка — шире strip, но без Women/Men как части линейки */
const EN_PRODUCT_TYPE_CHECK_RE =
  /\b(?:eau de parfum|eau de toilette|eau de cologne|edt|edp|extrait de parfum|parfum spray|parfum\b|toilette\b|for women|for men|for her|for him|women eau|men eau|unisex eau|vapo(?:risateur)?|vaporisateur|deodorant spray|body spray|eau fra[iî]che|\bspray\b|\bfemme\b|\bhomme\b)\b/i;

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

/** Обрывки англ. типа/предлогов — не должны оставаться в конце (de, eau…) */
const DANGLING_EN_WORD =
  /^(?:de|du|des|d|eau|et|la|le|les|the|for|and|of|in|to|a|an|or|with|parfum|toilette|cologne|spray|vapo|vaporisateur|femme|homme|women|men|unisex|edt|edp)$/i;

const MIN_LEN_PROPERTY_PAD = [
  "цветочный аромат",
  "древесный аромат",
  "восточный аромат",
  "свежий аромат",
  "морской аромат",
  "увлажняющая",
  "питательная"
];

export function titleHasAromaPhrase(title: string): boolean {
  return /[а-яё]+(?:-[а-яё]+)*(?:ый|ий|ой)\s+аромат\s*$/i.test(title.trim());
}

export function effectiveTitleMinLen(title: string): number {
  return titleHasAromaPhrase(title) ? YANDEX_TITLE_MIN_LEN_PERFUME : YANDEX_TITLE_MIN_LEN;
}

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
- Структура (строго): ТИП товара на русском + бренд + модель/линейка + семейство аромата (для парфюма) или 1 свойство (для косметики).
- Тип товара — только по-русски: «Парфюмерная вода», «Туалетная вода», «Духи», «Парфюмированный спрей», «Крем для лица» и т.п.
- ЗАПРЕЩЕНО в названии: Eau de Parfum, Eau de Toilette, EDT, EDP, for women, for men, Women, Men, Vapo, Spray как тип товара.
- Длина: строго ${YANDEX_TITLE_MIN_LEN}–${YANDEX_TITLE_MAX_LEN} символов. Не короче ${YANDEX_TITLE_MIN_LEN}! Не длиннее ${YANDEX_TITLE_MAX_LEN}!
- НИКОГДА не оставляй обрывки в конце: «de», «eau», «for», «du» и т.п. Если не хватает длины — дополняй моделью/линейкой, а не урезай название.
- Семейство аромата для парфюма — ТОЛЬКО в формате «… аромат»:
  • одно семейство: «древесный аромат», «цветочный аромат», «свежий аромат»;
  • два семейства через дефис: «цветочно-восточный аромат», «древесно-пряный аромат».
  • ЗАПРЕЩЕНО: «цветочная восточная», «древесная…» — не ставь голые прилагательные и не обрывай на «…».
- Косметика: функция/текстура (увлажняющая, питательная, матовая, очищающая, тонизирующая).
  • НЕЛЬЗЯ: оценочные и рекламные слова — «стойкая», «уникальная», «загадочная», «солнечная», «фирменная», «премиальная», «лучшая», «культовая» и любые синонимы.
  • Если семейство неизвестно — расширяй модель/линейкой до 60 символов, не выдумывай маркетинг.
- ЗАПРЕЩЕНО (маркетинг, примеры с ошибками):
  • Парфюмерная вода Giorgio Armani Si Passione стойкая
  • Духи Escentric Molecules Molecule 04 уникальные
  • Парфюмерная вода LANCOME LA NUIT TRÉSOR загадочная
  • Парфюмированный спрей SOL DE JANEIRO Cheirosa 62 солнечный
- ЗАПРЕЩЕНО: объём, оттенок, SPF, артикул, EAN.
- Примеры ПРАВИЛЬНО:
  • Парфюмерная вода для женщин Calvin Klein цветочно-восточный аромат
  • Туалетная вода для мужчин BOSS Bottled древесный аромат
  • Парфюмерная вода Giorgio Armani Si Passione цветочный аромат
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
    return `Яндекс: тип + бренд + модель + «древесный/цветочный аромат»; мин. ${YANDEX_TITLE_MIN_LEN} симв.; без de/eau и без «…»`;
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

export function stripEnglishProductTypeFragments(title: string): string {
  let t = title.replace(EN_TITLE_STRIP_RE, " ");
  return t.replace(/\s+/g, " ").trim();
}

/** Убирает висящие англ. предлоги/обрывки типа «de», «eau» в начале и конце */
export function stripDanglingTitleTokens(title: string): string {
  const parts = title.trim().split(/\s+/).filter(Boolean);
  while (parts.length && DANGLING_EN_WORD.test(parts[parts.length - 1]!.replace(/[.,;]+$/g, ""))) {
    parts.pop();
  }
  while (parts.length && DANGLING_EN_WORD.test(parts[0]!.replace(/[.,;]+$/g, ""))) {
    parts.shift();
  }
  return parts.join(" ").trim();
}

export function stripGenericTitleAdjectives(title: string): string {
  GENERIC_ADJ_RE.lastIndex = 0;
  return title.replace(GENERIC_ADJ_RE, " ").replace(/\s+/g, " ").trim();
}

function looksLikeRussianAdjective(word: string): boolean {
  return /(?:ный|ная|ное|ные|ной|ную|ным|ных|ными|ый|ая|ое|ие|ий|яя|ой|ую|ем|ам|ом|ые|их|ыми)$/i.test(word);
}

/** Убирает недопустимое прилагательное в конце (маркетинг вместо семейства/свойства) */
export function stripDisallowedTrailingProperty(title: string): string {
  const parts = title.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2 && /^аромат$/i.test(parts[parts.length - 1] ?? "")) {
    const adj = parts[parts.length - 2]?.replace(/[.,;]+$/g, "") ?? "";
    if (ALLOWED_AROMA_COMPOUND_RE.test(adj) || ALLOWED_TITLE_PROPERTY_RE.test(adj)) {
      return parts.join(" ").trim();
    }
  }
  while (parts.length >= 4) {
    const last = parts[parts.length - 1]!.replace(/[.,;]+$/g, "");
    if (!looksLikeRussianAdjective(last)) break;
    if (ALLOWED_TITLE_PROPERTY_RE.test(last)) break;
    parts.pop();
  }
  return parts.join(" ").trim();
}

/** Полная очистка названия от шума и маркетинговых прилагательных */
export function sanitizeYandexTitle(title: string): string {
  let t = stripYandexTitleNoise(title);
  t = stripEnglishProductTypeFragments(t);
  t = stripGenericTitleAdjectives(t);
  t = stripDisallowedTrailingProperty(t);
  t = stripDanglingTitleTokens(t);
  return t.replace(/\s+/g, " ").trim();
}

export function hasBannedTitleAdjectives(title: string): boolean {
  GENERIC_ADJ_RE.lastIndex = 0;
  if (GENERIC_ADJ_RE.test(title)) return true;
  const parts = title.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2 && /^аромат$/i.test(parts[parts.length - 1] ?? "")) {
    const adj = parts[parts.length - 2]?.replace(/[.,;]+$/g, "") ?? "";
    return !(ALLOWED_AROMA_COMPOUND_RE.test(adj) || ALLOWED_TITLE_PROPERTY_RE.test(adj));
  }
  const last = parts[parts.length - 1]?.replace(/[.,;]+$/g, "") ?? "";
  if (!last || !looksLikeRussianAdjective(last)) return false;
  return !ALLOWED_TITLE_PROPERTY_RE.test(last);
}

export function titleHasEnglishProductType(title: string): boolean {
  return EN_PRODUCT_TYPE_CHECK_RE.test(title);
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

export function truncateAtWord(title: string, maxLen: number): string {
  if (title.length <= maxLen) return stripDanglingTitleTokens(title);
  let cut = title.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(" ");
  if (lastSpace >= YANDEX_TITLE_MIN_LEN - 8) {
    cut = cut.slice(0, lastSpace).trim();
  } else {
    cut = cut.trim();
  }
  while (cut.length > YANDEX_TITLE_MIN_LEN && /[,;.-]$/.test(cut)) {
    cut = cut.replace(/[,;.-]+$/, "").trim();
  }
  cut = stripDanglingTitleTokens(cut);
  while (cut.length > maxLen) {
    const sp = cut.lastIndexOf(" ");
    if (sp < YANDEX_TITLE_MIN_LEN - 12) break;
    cut = stripDanglingTitleTokens(cut.slice(0, sp).trim());
  }
  return cut.trim();
}

function padTitleToMinLen(t: string): string {
  if (t.length >= YANDEX_TITLE_MIN_LEN) return t;
  const pads = /\bаромат\b/i.test(t)
    ? MIN_LEN_PROPERTY_PAD.filter((p) => !/\bаромат\b/i.test(p))
    : MIN_LEN_PROPERTY_PAD;
  for (const adj of pads) {
    if (t.toLowerCase().includes(adj.slice(0, 6))) continue;
    const candidate = `${t} ${adj}`.trim();
    if (candidate.length <= YANDEX_TITLE_MAX_LEN) return candidate;
  }
  return t;
}

/** Нормализация названия: очистка, при необходимости одно свойство, обрезка по словам */
export function padYandexTitle(title: string): string {
  let t = sanitizeYandexTitle(title);
  if (!t) return stripDanglingTitleTokens(title.trim());
  if (t.length > YANDEX_TITLE_MAX_LEN) {
    t = truncateAtWord(t, YANDEX_TITLE_MAX_LEN);
  }
  t = stripDanglingTitleTokens(t);
  if (t.length < YANDEX_TITLE_MIN_LEN) {
    t = padTitleToMinLen(t);
  }
  return stripDanglingTitleTokens(t);
}

export function yandexTitleNeedsFix(text: string): boolean {
  const t = stripDanglingTitleTokens(sanitizeYandexTitle(text).trim());
  if (!t) return true;
  const minLen = effectiveTitleMinLen(t);
  if (t.length < minLen || t.length > YANDEX_TITLE_MAX_LEN) return true;
  if (yandexTitleLanguageNeedsFix(t)) return true;
  if (hasBannedTitleAdjectives(t)) return true;
  const parts = t.split(/\s+/);
  const last = parts[parts.length - 1]?.replace(/[.,;]+$/g, "") ?? "";
  if (DANGLING_EN_WORD.test(last)) return true;
  return false;
}

export function yandexDescriptionTooShort(text: string): boolean {
  return text.trim().length < DESCRIPTION_MIN_LEN;
}
