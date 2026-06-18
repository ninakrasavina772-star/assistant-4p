import {
  normalizeProductType,
  productTypesDiffer
} from "@/lib/podruzhkaProductType";
import {
  isCosmeticsModelRejected,
  resolveCosmeticsModelForRender
} from "@/lib/podruzhkaCosmeticsModel";
import type { PodruzhkaAiResult, PodruzhkaFeedRow, PodruzhkaNoteBlock } from "@/lib/podruzhkaTypes";

export type CosmeticsBenefitsBatchIn = {
  openaiApiKey: string;
  rows: PodruzhkaFeedRow[];
  model?: string;
};

type AiJson = {
  model?: string;
  benefits?: { title?: string; desc?: string }[];
  notes?: { title?: string; desc?: string }[];
  product_type_card?: string;
  found?: boolean;
  sources?: string[];
  error?: string;
};

const SYSTEM = `Ты категорийный менеджер косметики для маркетплейса Ozon (ЛК «Подружка Global»).
По каждому SKU заполняешь model и три пары «свойство + описание» для инфографики 1024×1365.

СТРУКТУРА (как у парфюмерии, но вместо нот — свойства товара):
- benefit 1 → title (заголовок, 1–2 слова КАПС), benefit 1 (2) → desc (2–6 слов, с маленькой буквы)
- benefit 2 → title, benefit 2 (1) → desc
- benefit 3 → title, benefit 3 (1) → desc

Ты САМ выбираешь три самых продающих характеристики для данного product_type и конкретного товара.
Примеры по категориям (ориентир, не копируй слепо):
- Карандаш для губ: СТОЙКОСТЬ / НАСЫЩЕННЫЙ ЦВЕТ / КОМФОРТ
- Консилер: ПОКРЫТИЕ / ОСВЕТЛЕНИЕ / ЛЁГКОСТЬ
- Тональный крем: СТОЙКОСТЬ / ЕСТЕСТВЕННОСТЬ / УВЛАЖНЕНИЕ
- Тени: СТОЙКОСТЬ / НАСЫЩЕННОСТЬ / СМЫВАЕМОСТЬ

Правила:
1. model — короткое имя линейки/продукта из name (без brand name, без объёма «4 ml», «1.5 g», SKU).
2. benefits — ровно 3 объекта {title, desc}:
   - title: 1–2 слова по-русски, КАПС, без точки; отражает свойство (не бренд, не тип товара)
   - desc: 2–6 слов по-русски, с маленькой буквы, без точки; поясняет выгоду; коротко — должно помещаться в 2 строки слева на карточке
3. Три title — РАЗНЫЕ по смыслу. Повторы запрещены.
4. product_type_card — только если тип на карточке должен отличаться от product_type в Excel; иначе "".
5. Опирайся на знания о продукте/линейке. Если не уверен — found: false.
6. model НЕ ДОЛЖЕН совпадать с product_type и не быть общим названием категории (пудра, помада, тональный крем, основа под макияж).
7. ЗАПРЕЩЕНО: медицинские обещания, «лечит», «100%», выдуманные SPF/состав, английский в title.

Если model совпал с product_type — found: false.

JSON: {"found":true,"model":"...","product_type_card":"","benefits":[{"title":"СТОЙКОСТЬ","desc":"дольше держится макияж"},...],"sources":[]} или {"found":false,"error":"..."}`;

function buildUserMessage(row: PodruzhkaFeedRow): string {
  const productName = row.productName.trim() || row.name.trim();
  return [
    `brand name: ${row.brandName}`,
    `product_type: ${row.productType}`,
    `name: ${row.name}`,
    `product name: ${productName}`
  ].join("\n");
}

function normalizeDesc(s: string): string {
  const t = s.trim().replace(/\.$/, "");
  if (!t) return "";
  return t.charAt(0).toLowerCase() + t.slice(1);
}

export function sanitizeBenefitTitle(s: string): string {
  const words = s
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);
  return words.join(" ").toUpperCase();
}

function parseBenefits(raw: AiJson): PodruzhkaNoteBlock[] {
  const arr = Array.isArray(raw.benefits)
    ? raw.benefits
    : Array.isArray(raw.notes)
      ? raw.notes
      : [];
  return arr.slice(0, 3).map((n) => ({
    title: sanitizeBenefitTitle(String(n.title ?? "")),
    desc: normalizeDesc(String(n.desc ?? ""))
  }));
}

function validateBenefits(benefits: PodruzhkaNoteBlock[]): string | null {
  if (benefits.length < 3) return "Меньше трёх свойств";
  const titles = benefits.map((n) => n.title);
  if (new Set(titles).size < 3) return "Повторяющиеся свойства (benefit 1–3 должны быть разными)";
  for (const n of benefits) {
    if (!n.title || !n.desc) return "Пустой блок: нужны заголовок и описание";
    if (n.title.split(/\s+/).length > 3) return `Слишком длинный заголовок: ${n.title}`;
    if (n.desc.toUpperCase() === n.title) return `Описание не должно повторять заголовок: ${n.title}`;
  }
  return null;
}

function normalizeProductTypeCard(s: string): string {
  return normalizeProductType(s);
}

function resultFromParsed(row: PodruzhkaFeedRow, parsed: AiJson): PodruzhkaAiResult {
  const productTypeCard = normalizeProductTypeCard(String(parsed.product_type_card ?? ""));
  const mismatch = productTypesDiffer(row.productType, productTypeCard);

  if (!parsed.found) {
    return {
      row: row.row,
      ok: false,
      model: "",
      notes: [],
      productTypeCard,
      productTypeMismatch: mismatch,
      sources: Array.isArray(parsed.sources) ? parsed.sources.map(String) : [],
      error: parsed.error ?? "Свойства/model не подтверждены"
    };
  }

  let modelName = String(parsed.model ?? "").trim();
  if (isCosmeticsModelRejected(modelName, row.productType)) {
    const fallback = resolveCosmeticsModelForRender({
      model: modelName,
      productType: row.productType,
      brandName: row.brandName,
      name: row.name,
      productName: row.productName
    });
    if (!isCosmeticsModelRejected(fallback, row.productType)) {
      modelName = fallback;
    }
  }
  const benefits = parseBenefits(parsed).filter((n) => n.title && n.desc);
  const benefitErr = validateBenefits(benefits);

  if (!modelName || isCosmeticsModelRejected(modelName, row.productType) || benefits.length < 3 || benefitErr) {
    return {
      row: row.row,
      ok: false,
      model: modelName,
      notes: benefits,
      productTypeCard,
      productTypeMismatch: mismatch,
      sources: Array.isArray(parsed.sources) ? parsed.sources.map(String) : [],
      error: benefitErr ?? "Неполные данные от модели"
    };
  }

  return {
    row: row.row,
    ok: true,
    model: modelName,
    notes: benefits,
    productTypeCard,
    productTypeMismatch: mismatch,
    sources: Array.isArray(parsed.sources) ? parsed.sources.map(String) : []
  };
}

async function callOpenAi(
  apiKey: string,
  model: string,
  row: PodruzhkaFeedRow,
  extraUser?: string
): Promise<AiJson> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      temperature: 0.15,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: extraUser ? `${buildUserMessage(row)}\n\n${extraUser}` : buildUserMessage(row)
        }
      ]
    }),
    signal: AbortSignal.timeout(50_000)
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(text.slice(0, 300) || `OpenAI HTTP ${res.status}`);
  }

  let content = "";
  try {
    const j = JSON.parse(text) as { choices?: { message?: { content?: string } }[] };
    content = j.choices?.[0]?.message?.content ?? "";
  } catch {
    throw new Error("OpenAI: некорректный ответ");
  }

  try {
    return JSON.parse(content) as AiJson;
  } catch {
    throw new Error("OpenAI: не JSON");
  }
}

async function fetchOne(
  apiKey: string,
  model: string,
  row: PodruzhkaFeedRow
): Promise<PodruzhkaAiResult> {
  const parsed = await callOpenAi(apiKey, model, row);
  let result = resultFromParsed(row, parsed);
  if (result.ok) return result;

  const retry = await callOpenAi(
    apiKey,
    model,
    row,
    "Переделай: три РАЗНЫХ свойства, короткий model, title 1–2 слова КАПС, desc 2–6 слов."
  );
  result = resultFromParsed(row, retry);
  return result;
}

export async function fetchCosmeticsBenefitsForRows(
  input: CosmeticsBenefitsBatchIn
): Promise<PodruzhkaAiResult[]> {
  const key = input.openaiApiKey.trim();
  if (!key.startsWith("sk-")) {
    throw new Error("Нужен ключ OpenAI (sk-…)");
  }

  const model = input.model?.trim() || "gpt-4o-mini";

  return Promise.all(
    input.rows.map(async (row) => {
      try {
        return await fetchOne(key, model, row);
      } catch (e) {
        return {
          row: row.row,
          ok: false,
          model: "",
          notes: [],
          productTypeCard: "",
          productTypeMismatch: false,
          sources: [],
          error: e instanceof Error ? e.message : "Ошибка OpenAI"
        } satisfies PodruzhkaAiResult;
      }
    })
  );
}

/** Ключ для дедупликации вариантов одного SKU */
export function cosmeticsRowSignature(row: PodruzhkaFeedRow): string {
  return `${row.brandName.trim()}\u0001${row.name.trim()}\u0001${row.productType.trim()}`;
}

/** Размножить результат AI на все строки-дубликаты одного SKU */
export function expandCosmeticsAiResults(
  results: PodruzhkaAiResult[],
  repRowToAllRows: Map<number, number[]>
): PodruzhkaAiResult[] {
  const expanded: PodruzhkaAiResult[] = [];
  for (const r of results) {
    for (const rowNum of repRowToAllRows.get(r.row) ?? [r.row]) {
      expanded.push({ ...r, row: rowNum });
    }
  }
  return expanded;
}
