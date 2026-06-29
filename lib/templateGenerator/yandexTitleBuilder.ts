import {
  hasBannedTitleAdjectives,
  padYandexTitle,
  sanitizeYandexTitle,
  stripDanglingTitleTokens,
  stripYandexTitleNoise,
  yandexTitleLanguageNeedsFix,
  yandexTitleNeedsFix,
  YANDEX_TITLE_MAX_LEN,
  YANDEX_TITLE_MIN_LEN,
  YANDEX_TITLE_MIN_LEN_PERFUME,
  YANDEX_TITLE_TARGET_LEN,
  effectiveTitleMinLen,
  titleHasAromaPhrase,
  truncateAtWord
} from "@/lib/templateGenerator/yandexRules";

const EN_TYPE_RULES: { re: RegExp; type: string }[] = [
  { re: /eau de parfum|eau de parfum spray|\bedp\b/i, type: "Парфюмерная вода" },
  { re: /eau de toilette|\bedt\b/i, type: "Туалетная вода" },
  { re: /extrait de parfum|\bparfum\b(?!\s*spray)/i, type: "Духи" },
  { re: /parfum spray|parfum\b/i, type: "Парфюмерная вода" },
  { re: /body spray|deodorant spray/i, type: "Парфюмированный спрей" },
  { re: /emulsion|эмульс/i, type: "Эмульсия" },
  { re: /cream|creme|tagescreme|moistur|крем/i, type: "Крем" },
  { re: /serum|сыворот/i, type: "Сыворотка" },
  { re: /lotion|лосьон/i, type: "Лосьон" },
  { re: /cleanser|cleansing|пенк|гель для умыван/i, type: "Гель" },
  { re: /mask|маск/i, type: "Маска" },
  { re: /shampoo|шампун/i, type: "Шампунь" },
  { re: /deodorant|дезодорант/i, type: "Дезодорант" }
];

const OBJECTIVE_PAD: { re: RegExp; adj: string }[] = [
  { re: /emulsion|эмульс|moist/i, adj: "питательная" },
  { re: /cream|creme|крем|moistur/i, adj: "увлажняющая" },
  { re: /serum|сыворот/i, adj: "активная" },
  { re: /hydra|hydrat|увлажн/i, adj: "увлажняющая" },
  { re: /night|ночн/i, adj: "ночная" },
  { re: /day|дневн|tages/i, adj: "дневная" }
];

/** Ключ в фиде → муж. род для «… аромат» */
const FAMILY_STEMS: [string, string][] = [
  ["цветоч", "цветочный"],
  ["восточ", "восточный"],
  ["древес", "древесный"],
  ["фрукт", "фруктовый"],
  ["свеж", "свежий"],
  ["морск", "морской"],
  ["прян", "пряной"],
  ["амбров", "амбровый"],
  ["шипр", "шипровый"],
  ["цитрус", "цитрусовый"],
  ["акват", "акватический"],
  ["гурман", "гурманский"],
  ["фужер", "фужерный"]
];

const FAMILY_FEM: [string, string][] = [
  ["цветоч", "цветочная"],
  ["древес", "древесная"],
  ["восточ", "восточная"],
  ["фрукт", "фруктовая"],
  ["свеж", "свежая"],
  ["морск", "морская"],
  ["прян", "пряная"],
  ["амбров", "амбровая"],
  ["шипр", "шипровая"],
  ["цитрус", "цитрусовая"]
];

const DEFAULT_AROMA_PHRASES = [
  "цветочный аромат",
  "древесный аромат",
  "восточный аромат",
  "свежий аромат",
  "морской аромат"
];

function genderSuffix(pol: string, name: string): string {
  const s = `${pol} ${name}`.toLowerCase();
  if (/жен|female|women|woman|for her|for women|\bfemme\b/.test(s)) return " для женщин";
  if (/муж|male|\bmen\b|for him|for men|\bhomme\b/.test(s)) return " для мужчин";
  if (/унисекс|unisex/.test(s)) return " унисекс";
  return "";
}

function isPerfumeContext(type: string, productName: string): boolean {
  const blob = `${type} ${productName}`.toLowerCase();
  return /парфюм|туалетн|духи|одеколон|parfum|toilette|eau de/.test(blob);
}

function detectFamilyStems(family: string): string[] {
  const f = family.toLowerCase().replace(/-/g, " ");
  const found: string[] = [];
  for (const [key, masc] of FAMILY_STEMS) {
    if (f.includes(key) && !found.includes(masc)) found.push(masc);
  }
  return found;
}

/** «древесный аромат», «цветочно-восточный аромат» */
export function familyToAromaPhrase(family: string): string {
  const raw = family.trim();
  if (!raw) return "";

  const withAroma = raw.match(/([а-яё-]+(?:ый|ий|ой))\s+аромат/i);
  if (withAroma) return `${withAroma[1]} аромат`;

  const hyphenAdj = raw.match(/([а-яё]+(?:-[а-яё]+)+(?:ый|ий|ой))/i);
  if (hyphenAdj) return `${hyphenAdj[1]} аромат`;

  const stems = detectFamilyStems(raw);
  if (!stems.length) return "";

  if (stems.length === 1) return `${stems[0]} аромат`;

  const compound =
    stems
      .slice(0, -1)
      .map((s) => s.replace(/(?:ый|ий|ой)$/, "о"))
      .join("-") +
    "-" +
    stems[stems.length - 1];
  return `${compound} аромат`;
}

function familyToAdjective(family: string): string {
  const f = family.trim().toLowerCase();
  if (!f) return "";
  for (const [key, adj] of FAMILY_FEM) {
    if (f.includes(key)) return adj;
  }
  return "";
}

function inferTypeFromName(productName: string, pol: string): string {
  for (const rule of EN_TYPE_RULES) {
    if (rule.re.test(productName)) {
      const g = genderSuffix(pol, productName);
      if (g && !rule.type.includes("для")) return `${rule.type}${g}`;
      return rule.type;
    }
  }
  const g = genderSuffix(pol, productName);
  if (g) return `Парфюмерная вода${g}`.replace("Парфум", "Парфюм");
  return "Парфюмерная вода";
}

function objectivePad(productName: string, title: string): string {
  const blob = `${productName} ${title}`.toLowerCase();
  for (const rule of OBJECTIVE_PAD) {
    if (rule.re.test(blob)) return rule.adj;
  }
  return "";
}

function titleTailProperty(
  type: string,
  productName: string,
  family: string
): string {
  if (isPerfumeContext(type, productName)) {
    return familyToAromaPhrase(family);
  }
  return familyToAdjective(family) || objectivePad(productName, type);
}

/** Убирает голые «цветочная восточная» без слова «аромат» */
function stripBareFamilyAdjectives(title: string): string {
  let t = title.trim();
  const bareRe =
    /\s+(?:цветочн|восточн|древесн|фруктов|морск|амбров|шипров|цитрусов|свеж|прян|акват|гурман|фужер)[а-яё]*(?!\s+аромат)(?=\s*(?:$|\s+(?:цветочн|восточн|древесн|фруктов|морск|амбров|шипров|цитрусов|свеж|прян|акват|гурман|фужер)[а-яё]*(?!\s+аромат)\s*$))/gi;
  for (let i = 0; i < 4; i++) {
    const next = t.replace(bareRe, "").replace(/\s+/g, " ").trim();
    if (next === t) break;
    t = next;
  }
  return t;
}

function keepSingleAromaPhrase(title: string): string {
  const re = /[а-яё]+(?:-[а-яё]+)*(?:ый|ий|ой)\s+аромат/gi;
  const matches = [...title.matchAll(re)];
  if (matches.length <= 1) return title.trim();
  const first = matches[0]![0];
  const head = title.slice(0, matches[0]!.index!).trim();
  return `${head} ${first}`.replace(/\s+/g, " ").trim();
}

function appendModelTail(title: string, productName: string, brand: string): string {
  const model = extractModel(productName, brand);
  if (!model || model.length < 3) return title;
  const lowTitle = title.toLowerCase();
  const tokens = model.split(/\s+/).filter(Boolean);
  let tail = "";
  for (const tok of tokens) {
    if (lowTitle.includes(tok.toLowerCase())) continue;
    const next = tail ? `${tail} ${tok}` : tok;
    const candidate = `${title} ${next}`.trim();
    if (candidate.length > YANDEX_TITLE_MAX_LEN) break;
    tail = next;
    title = candidate;
  }
  return sanitizeYandexTitle(title);
}

function appendAromaPhraseIfMissing(
  title: string,
  family: string,
  type: string,
  productName: string
): string {
  if (!isPerfumeContext(type, productName)) return title;
  if (/\bаромат\b/i.test(title)) return title;
  const phrase = familyToAromaPhrase(family);
  if (!phrase) return title;
  const low = title.toLowerCase();
  if (low.includes(phrase.toLowerCase())) return title;
  const candidate = sanitizeYandexTitle(`${stripBareFamilyAdjectives(title)} ${phrase}`.trim());
  return candidate.length <= YANDEX_TITLE_MAX_LEN ? candidate : title;
}

function extendToMinLen(
  title: string,
  productName: string,
  family: string,
  brand = "",
  pol = "",
  type = ""
): string {
  let t = stripBareFamilyAdjectives(title.trim());
  t = appendAromaPhraseIfMissing(t, family, type, productName);

  if (t.length < YANDEX_TITLE_MIN_LEN) {
    t = appendModelTail(t, productName, brand);
  }
  if (t.length < YANDEX_TITLE_MIN_LEN) {
    const g = genderSuffix(pol, productName);
    if (g && !t.toLowerCase().includes(g.trim().slice(0, 6))) {
      const candidate = sanitizeYandexTitle(`${t}${g}`.trim());
      if (candidate.length <= YANDEX_TITLE_MAX_LEN) t = candidate;
    }
  }
  if (t.length < YANDEX_TITLE_MIN_LEN && /крем|лосьон|сыворот|маска|шампун/i.test(productName)) {
    const candidate = sanitizeYandexTitle(`${t} для ухода за кожей`.trim());
    if (candidate.length <= YANDEX_TITLE_MAX_LEN) t = candidate;
  }
  if (t.length < YANDEX_TITLE_MIN_LEN && isPerfumeContext(type, productName)) {
    t = appendAromaPhraseIfMissing(t, family, type, productName);
  }
  if (t.length < YANDEX_TITLE_MIN_LEN && !isPerfumeContext(type, productName)) {
    const pad = objectivePad(productName, t);
    if (pad && !t.toLowerCase().includes(pad.slice(0, 6))) {
      const candidate = sanitizeYandexTitle(`${t} ${pad}`.trim());
      if (candidate.length <= YANDEX_TITLE_MAX_LEN) t = candidate;
    }
  }
  if (t.length < YANDEX_TITLE_MIN_LEN) {
    t = appendModelTail(t, productName, brand);
  }
  if (t.length > YANDEX_TITLE_MAX_LEN) {
    t = truncateAtWord(t, YANDEX_TITLE_MAX_LEN);
  }
  return stripDanglingTitleTokens(t);
}

const EN_MODEL_PHRASE_RE =
  /\b(?:eau de parfum|eau de toilette|eau de cologne|extrait de parfum|parfum spray|deodorant spray|body spray)\b/gi;

const EN_MODEL_TOKEN_RE =
  /\b(?:extrait|edt|edp|for women|for men|for her|for him|vapo(?:risateur)?|parfum|toilette|femme|homme|spray)\b/gi;

function cleanModelString(m: string): string {
  m = m.replace(/\b(?:парфюмерная вода|парфюмированная вода|туалетная вода|духи|парфюмерия|perfume)\b/gi, " ");
  m = m.replace(EN_MODEL_PHRASE_RE, " ");
  m = m.replace(EN_MODEL_TOKEN_RE, " ");
  m = m.replace(/\b\d+[\s.,]?\d*\s*(?:ml|мл|g|г|l|л)\b/gi, " ");
  m = m.replace(/[,;:\---]+/g, " ");
  return stripDanglingTitleTokens(m.replace(/\s+/g, " ").trim());
}

function extractModel(productName: string, brand: string): string {
  let m = productName.trim();
  const b = brand.trim();
  if (b && m.toLowerCase().startsWith(b.toLowerCase())) {
    m = m.slice(b.length).trim();
  }
  let cleaned = cleanModelString(m);
  if (cleaned.length < 3) {
    cleaned = cleanModelString(
      m.replace(EN_MODEL_PHRASE_RE, " ").replace(/\b\d+[\s.,]?\d*\s*(?:ml|мл|g|г|l|л)\b/gi, " ")
    );
  }
  return cleaned.slice(0, 55).trim();
}

function dedupeTitleParts(type: string, brand: string, model: string, tail: string): string {
  const typeWords = new Set(type.toLowerCase().split(/\s+/).filter(Boolean));
  const brandWords = new Set(brand.toLowerCase().split(/\s+/).filter(Boolean));
  const modelTokens = model
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => {
      const low = w.toLowerCase();
      if (typeWords.has(low)) return false;
      if (brandWords.has(low)) return false;
      return true;
    });
  let title = [type, brand, modelTokens.join(" "), tail].filter(Boolean).join(" ");
  title = title.replace(/\b(\S+(?:\s+\S+){0,4})\s+\1\b/gi, "$1");
  return title.replace(/\s+/g, " ").trim();
}

function rowInput(row: { productName: string; brand: string; cells: Record<string, string> }) {
  return {
    productName: row.productName,
    brand: row.cells["Бренд *"] ?? row.cells["Бренд"] ?? row.brand,
    typeRu: row.cells["Тип"] ?? row.cells["тип"],
    family: row.cells["Семейство"] ?? row.cells["семейство"],
    pol: row.cells["Пол"] ?? row.cells["пол"]
  };
}

function enforceAbsoluteMinTitle(
  title: string,
  productName: string,
  family: string,
  brand: string,
  pol: string,
  type: string
): string {
  let t = stripDanglingTitleTokens(stripBareFamilyAdjectives(title));
  const minLen = effectiveTitleMinLen(t);
  if (t.length >= minLen && titleHasAromaPhrase(t)) return keepSingleAromaPhrase(t);

  t = extendToMinLen(t, productName, family, brand, pol, type);
  t = keepSingleAromaPhrase(t);
  const minLenAfter = effectiveTitleMinLen(t);
  if (t.length >= minLenAfter && titleHasAromaPhrase(t)) return stripDanglingTitleTokens(t);

  if (t.length < YANDEX_TITLE_MIN_LEN && isPerfumeContext(type, productName) && !/\bаромат\b/i.test(t)) {
    for (const phrase of DEFAULT_AROMA_PHRASES) {
      if (t.length >= YANDEX_TITLE_MIN_LEN) break;
      if (t.toLowerCase().includes(phrase)) continue;
      const candidate = sanitizeYandexTitle(`${stripBareFamilyAdjectives(t)} ${phrase}`.trim());
      if (candidate.length <= YANDEX_TITLE_MAX_LEN) t = candidate;
    }
  }

  let guard = 0;
  while (t.length < YANDEX_TITLE_MIN_LEN && guard++ < 8) {
    const prev = t;
    t = appendModelTail(t, productName, brand);
    if (t.length === prev.length) break;
  }

  if (t.length > YANDEX_TITLE_MAX_LEN) {
    t = truncateAtWord(t, YANDEX_TITLE_MAX_LEN);
  }

  return stripDanglingTitleTokens(keepSingleAromaPhrase(t));
}

function polishBuiltTitle(
  title: string,
  input: {
    productName: string;
    brand: string;
    typeRu?: string;
    family?: string;
    pol?: string;
  }
): string {
  const type = (input.typeRu || "").trim() || inferTypeFromName(input.productName, input.pol || "");
  let t = stripDanglingTitleTokens(sanitizeYandexTitle(title));
  t = stripBareFamilyAdjectives(t);
  t = appendAromaPhraseIfMissing(t, input.family || "", type, input.productName);
  t = enforceAbsoluteMinTitle(
    t,
    input.productName,
    input.family || "",
    input.brand,
    input.pol || "",
    type
  );
  return keepSingleAromaPhrase(stripDanglingTitleTokens(t));
}

export function buildYandexTitleFromRow(input: {
  productName: string;
  brand: string;
  typeRu?: string;
  family?: string;
  pol?: string;
}): string {
  const brand = (input.brand || "").trim();
  const type = (input.typeRu || "").trim() || inferTypeFromName(input.productName, input.pol || "");
  const model = extractModel(input.productName, brand) || extractModel(input.productName, "");
  const tail = titleTailProperty(type, input.productName, input.family || "");
  const title = dedupeTitleParts(type, brand, model, tail);
  return polishBuiltTitle(title, input);
}

export function finalizeYandexTitle(
  raw: string,
  row: { productName: string; brand: string; cells: Record<string, string> }
): string {
  const input = rowInput(row);
  const built = buildYandexTitleFromRow(input);
  const cleanedRaw = padYandexTitle(raw);

  const rawOk =
    cleanedRaw.length >= YANDEX_TITLE_MIN_LEN &&
    cleanedRaw.length <= YANDEX_TITLE_MAX_LEN &&
    !yandexTitleLanguageNeedsFix(cleanedRaw) &&
    !hasBannedTitleAdjectives(cleanedRaw) &&
    !yandexTitleNeedsFix(cleanedRaw);

  if (rawOk) return cleanedRaw;
  if (built.length >= YANDEX_TITLE_MIN_LEN) return built;
  const type = (input.typeRu || "").trim() || inferTypeFromName(input.productName, input.pol || "");
  return enforceAbsoluteMinTitle(
    cleanedRaw,
    input.productName,
    input.family || "",
    input.brand,
    input.pol || "",
    type
  );
}
