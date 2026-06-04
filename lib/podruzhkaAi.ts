import { PODRUZHKA_AI_OBRAZEC } from "@/lib/podruzhkaAiExamples";
import {
  allowedNoteTitlesPrompt,
  isAllowedNoteTitle,
  sanitizeNoteTitle
} from "@/lib/podruzhkaAiNotes";
import type { PodruzhkaAiResult, PodruzhkaFeedRow, PodruzhkaNoteBlock } from "@/lib/podruzhkaTypes";

export type NotesBatchIn = {
  openaiApiKey: string;
  rows: PodruzhkaFeedRow[];
  model?: string;
};

type AiJson = {
  model?: string;
  product_type_corrected?: string;
  notes?: { title?: string; desc?: string }[];
  found?: boolean;
  sources?: string[];
  error?: string;
};

const VAGUE_PRODUCT_TYPES = /^(духи|парфюм|аромат|парфюмерия|fragrance)\s*$/i;

function normalizeProductTypeLine(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ").replace(/\.$/, "");
}

/** Подставлять в Excel только если AI дал конкретный тип, отличный от ячейки */
export function resolveCorrectedProductType(
  tableValue: string,
  aiValue: string | undefined
): string | undefined {
  const corrected = normalizeProductTypeLine(aiValue ?? "");
  if (!corrected) return undefined;
  const table = normalizeProductTypeLine(tableValue);
  if (corrected === table) return undefined;
  if (VAGUE_PRODUCT_TYPES.test(corrected) && VAGUE_PRODUCT_TYPES.test(table)) {
    return undefined;
  }
  return corrected;
}

const EX = PODRUZHKA_AI_OBRAZEC;

const SYSTEM = `Ты эксперт по парфюмерии. Заполняешь model, три ноты (note 1–3) и при необходимости исправляешь product_type для инфографики Ozon «Подружка Global» 1080×1350.
Текст попадёт на карточку крупным шрифтом — стиль должен совпадать с эталоном.

ЭТАЛОН (Nasomatto, образец.xlsx):
- model: «${EX.model}» (короткое имя аромата, не SKU)
- note 1: ${EX.excelCells[0]}
- note 2: ${EX.excelCells[1]}
- note 3: ${EX.excelCells[2]}

Правила оформления (обязательно):
1. model — 1–3 слова, коммерческое имя аромата (из product name / name, без бренда и без «мл»). Не выдумывай название.
2. notes — ровно 3 блока.
   - title: ОДНО слово ЗАГЛАВНЫМИ — только из списка допустимых семейств (ничего другого):
     ${allowedNoteTitlesPrompt()}
   - desc: 2–6 слов, с маленькой буквы, без точки (тёплый и глубокий, пикантный характер).
3. ЗАПРЕЩЕНО придумывать слова и «похожие» формулировки: цветучий, цветение, цветочная, романтичный (в title), любые прилагательные в title, английские слова, выдуманные термины.
   - Для цветочного аромата: «${EX.floralExample.title}  ${EX.floralExample.desc}» — НИКОГДА «цветучий», «цветение», «цветочная».
4. title и desc бери только из Fragrantica / официального сайта бренда / Parfumista. Если нельзя подтвердить три семейства — found: false.
5. Три title должны быть разными словами из списка.
6. product_type_corrected — серая строка под брендом (1–6 слов, с маленькой буквы). Сверь product_type из таблицы с product name и name.
   - Если в таблице только «духи», «парфюм» или тип явно неверен — укажи точный тип: парфюмерная вода, туалетная вода, парфюм, одеколон, духи (масляные), набор и т.п. (eau de parfum → парфюмерная вода, eau de toilette → туалетная вода).
   - Если product_type в таблице уже верный — верни пустую строку "".

Ответ строго JSON:
{"found":true,"model":"...","product_type_corrected":"","notes":[{"title":"ДРЕВЕСНЫЙ","desc":"тёплый и глубокий"},...],"sources":["url1",...]}
или {"found":false,"model":"","product_type_corrected":"","notes":[],"sources":[],"error":"причина"}`;

function buildUserMessage(row: PodruzhkaFeedRow): string {
  return [
    `brand name: ${row.brandName}`,
    `product name: ${row.productName}`,
    `name: ${row.name}`,
    `product_type: ${row.productType}`,
    `ml: ${row.ml}`
  ].join("\n");
}

function normalizeDesc(s: string): string {
  const t = s.trim().replace(/\.$/, "");
  if (!t) return "";
  return t.charAt(0).toLowerCase() + t.slice(1);
}

function parseNotes(raw: AiJson): PodruzhkaNoteBlock[] {
  const notes = Array.isArray(raw.notes) ? raw.notes : [];
  return notes.slice(0, 3).map((n) => ({
    title: sanitizeNoteTitle(String(n.title ?? "")),
    desc: normalizeDesc(String(n.desc ?? ""))
  }));
}

function validateNotes(notes: PodruzhkaNoteBlock[]): string | null {
  if (notes.length < 3) return "Меньше трёх нот";
  const titles = notes.map((n) => n.title);
  if (new Set(titles).size < 3) return "Повторяющиеся семейства нот";
  for (const n of notes) {
    if (!n.title || !n.desc) return "Пустой блок нот";
    if (!isAllowedNoteTitle(n.title)) {
      return `Недопустимый заголовок ноты: ${n.title}`;
    }
  }
  return null;
}

export async function fetchNotesForRows(
  input: NotesBatchIn
): Promise<PodruzhkaAiResult[]> {
  const key = input.openaiApiKey.trim();
  if (!key.startsWith("sk-")) {
    throw new Error("Нужен ключ OpenAI (sk-…)");
  }

  const model = input.model?.trim() || "gpt-4o-mini";
  const results: PodruzhkaAiResult[] = [];

  for (const row of input.rows) {
    try {
      const one = await fetchOne(key, model, row);
      results.push(one);
    } catch (e) {
      results.push({
        row: row.row,
        ok: false,
        model: "",
        notes: [],
        sources: [],
        error: e instanceof Error ? e.message : "Ошибка OpenAI"
      });
    }
  }

  return results;
}

async function fetchOne(
  apiKey: string,
  model: string,
  row: PodruzhkaFeedRow
): Promise<PodruzhkaAiResult> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: buildUserMessage(row) }
      ]
    }),
    signal: AbortSignal.timeout(90_000)
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

  let parsed: AiJson;
  try {
    parsed = JSON.parse(content) as AiJson;
  } catch {
    throw new Error("OpenAI: не JSON");
  }

  if (!parsed.found) {
    return {
      row: row.row,
      ok: false,
      model: "",
      notes: [],
      sources: Array.isArray(parsed.sources) ? parsed.sources.map(String) : [],
      error: parsed.error ?? "Ноты/model не подтверждены источниками"
    };
  }

  const modelName = String(parsed.model ?? "").trim();
  const notes = parseNotes(parsed).filter((n) => n.title && n.desc);
  const noteErr = validateNotes(notes);

  const productTypeCorrected = resolveCorrectedProductType(
    row.productType,
    String(parsed.product_type_corrected ?? "")
  );

  if (!modelName || notes.length < 3 || noteErr) {
    return {
      row: row.row,
      ok: false,
      model: modelName,
      notes,
      productTypeCorrected,
      sources: Array.isArray(parsed.sources) ? parsed.sources.map(String) : [],
      error: noteErr ?? "Неполные данные от модели"
    };
  }

  return {
    row: row.row,
    ok: true,
    model: modelName,
    notes,
    productTypeCorrected,
    sources: Array.isArray(parsed.sources) ? parsed.sources.map(String) : []
  };
}
