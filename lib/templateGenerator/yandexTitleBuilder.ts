import {
  hasBannedTitleAdjectives,
  padYandexTitle,
  stripGenericTitleAdjectives,
  stripYandexTitleNoise,
  yandexTitleLanguageNeedsFix,
  YANDEX_TITLE_MAX_LEN,
  YANDEX_TITLE_MIN_LEN
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
  { re: /glow|сиян/i, adj: "сияющая" },
  { re: /night|ночн/i, adj: "ночная" },
  { re: /day|дневн|tages/i, adj: "дневная" }
];

const FAMILY_ADJ: [string, string][] = [
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

function genderSuffix(pol: string, name: string): string {
  const s = `${pol} ${name}`.toLowerCase();
  if (/жен|female|women|woman|for her|for women|\bfemme\b/.test(s)) return " для женщин";
  if (/муж|male|\bmen\b|for him|for men|\bhomme\b/.test(s)) return " для мужчин";
  if (/унисекс|unisex/.test(s)) return " унисекс";
  return "";
}

function familyToAdjective(family: string): string {
  const f = family.trim().toLowerCase();
  if (!f) return "";
  for (const [key, adj] of FAMILY_ADJ) {
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
  if (g) return `Парфумерная вода${g}`.replace("Парфум", "Парфюм");
  return "Парфюмерная вода";
}

function objectivePad(productName: string, title: string): string {
  const blob = `${productName} ${title}`.toLowerCase();
  for (const rule of OBJECTIVE_PAD) {
    if (rule.re.test(blob)) return rule.adj;
  }
  return "";
}

function extendToMinLen(title: string, productName: string): string {
  let t = title.trim();
  if (t.length >= YANDEX_TITLE_MIN_LEN) return t;
  const pad = objectivePad(productName, t);
  if (pad && !t.toLowerCase().includes(pad.slice(0, 6))) {
    t = `${t} ${pad}`.trim();
  }
  if (t.length < YANDEX_TITLE_MIN_LEN) {
    t = `${t} для ухода за кожей`.trim();
  }
  if (t.length > YANDEX_TITLE_MAX_LEN) {
    t = t.slice(0, YANDEX_TITLE_MAX_LEN);
    const sp = t.lastIndexOf(" ");
    if (sp >= YANDEX_TITLE_MIN_LEN - 10) t = t.slice(0, sp);
  }
  return t;
}

function extractModel(productName: string, brand: string): string {
  let m = productName.trim();
  const b = brand.trim();
  if (b && m.toLowerCase().startsWith(b.toLowerCase())) {
    m = m.slice(b.length).trim();
  }
  m = m.replace(
    /\b(?:eau de parfum|eau de toilette|eau de cologne|extrait|edt|edp|for women|for men|for her|for him|women|men|unisex|vapo(?:risateur)?|spray|parfum|toilette|femme|homme|eau)\b/gi,
    " "
  );
  m = m.replace(/\b\d+[\s.,]?\d*\s*(?:ml|мл|g|г|l|л)\b/gi, " ");
  m = m.replace(/[,;:\-–—]+/g, " ");
  m = m.replace(/\s+/g, " ").trim();
  return m.slice(0, 48).trim();
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
  const adj = familyToAdjective(input.family || "") || objectivePad(input.productName, type);
  let title = [type, brand, model, adj].filter(Boolean).join(" ");
  title = stripGenericTitleAdjectives(stripYandexTitleNoise(title));
  title = extendToMinLen(title, input.productName);
  if (title.length > YANDEX_TITLE_MAX_LEN) {
    title = title.slice(0, YANDEX_TITLE_MAX_LEN);
    const sp = title.lastIndexOf(" ");
    if (sp >= YANDEX_TITLE_MIN_LEN - 12) title = title.slice(0, sp);
  }
  return title.trim();
}

export function finalizeYandexTitle(
  raw: string,
  row: { productName: string; brand: string; cells: Record<string, string> }
): string {
  let title = padYandexTitle(raw);
  const okLen = title.length >= YANDEX_TITLE_MIN_LEN && title.length <= YANDEX_TITLE_MAX_LEN;
  if (okLen && !yandexTitleLanguageNeedsFix(title) && !hasBannedTitleAdjectives(title)) {
    return title;
  }

  const rebuilt = buildYandexTitleFromRow({
    productName: row.productName,
    brand: row.cells["Бренд *"] ?? row.cells["Бренд"] ?? row.brand,
    typeRu: row.cells["Тип"] ?? row.cells["тип"],
    family: row.cells["Семейство"] ?? row.cells["семейство"],
    pol: row.cells["Пол"] ?? row.cells["пол"]
  });

  if (rebuilt && !yandexTitleLanguageNeedsFix(rebuilt) && !hasBannedTitleAdjectives(rebuilt)) {
    return padYandexTitle(rebuilt);
  }
  return title;
}
