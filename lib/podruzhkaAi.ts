import { PODRUZHKA_AI_OBRAZEC } from "@/lib/podruzhkaAiExamples";
import {
  allowedNoteTitlesPrompt,
  isAllowedNoteTitle,
  sanitizeNoteTitle
} from "@/lib/podruzhkaAiNotes";
import {
  normalizeProductType,
  productTypesDiffer
} from "@/lib/podruzhkaProductType";
import type { PodruzhkaAiResult, PodruzhkaFeedRow, PodruzhkaNoteBlock } from "@/lib/podruzhkaTypes";
import { openaiChatCompletionsUrl, openaiFetch, readOpenAiError } from "@/lib/openaiFetch";

export type NotesBatchIn = {
  openaiApiKey: string;
  rows: PodruzhkaFeedRow[];
  model?: string;
};

type AiJson = {
  model?: string;
  notes?: { title?: string; desc?: string }[];
  product_type_card?: string;
  found?: boolean;
  sources?: string[];
  error?: string;
};

const EX = PODRUZHKA_AI_OBRAZEC;

const SYSTEM = `Ты эксперт по парфюмерии. Заполняешь model и три пары «название ноты + описание» для инфографики Ozon «Подружка Global».

СТРУКТУРА EXCEL (строго):
- note 1 → title (название, одно слово КАПС), note 1 (2) → desc (описание, 2–6 слов, lowercase)
- note 2 → title, note 2 (1) → desc
- note 3 → title, note 3 (1) → desc

Пример: note 1 = «ДРЕВЕСНЫЙ», note 1 (2) = «тёплый и глубокий».

В JSON: notes[0].title → note 1, notes[0].desc → note 1 (2); notes[1] → note 2 / note 2 (1); notes[2] → note 3 / note 3 (1).
НЕ объединяй title и desc в одну строку. НЕ копируй title в desc.

ОБРАЗЕЦ (Nasomatto):
- model: «${EX.model}»
- note 1 / note 1 (2): ${EX.notes[0]!.title} / ${EX.notes[0]!.desc}
- note 2 / note 2 (1): ${EX.notes[1]!.title} / ${EX.notes[1]!.desc}
- note 3 / note 3 (1): ${EX.notes[2]!.title} / ${EX.notes[2]!.desc}

Правила:
1. model — короткое имя аромата из product name / name («Duro», «212 Sexy»). Без бренда, без «мл», без SKU.
2. notes — ровно 3 объекта {title, desc}:
   - title: одно слово из списка: ${allowedNoteTitlesPrompt()}
   - desc: 2–6 слов по-русски, с маленькой буквы, без точки в конце
3. Три title — РАЗНЫЕ семейства. Повторы запрещены.
4. product_type_card — только если тип на карточке ≠ product_type в Excel; иначе "".
5. Источники: Fragrantica / сайт бренда. Если не нашёл — found: false.
6. ЗАПРЕЩЕНО: цветучий, цветение, англ. в title, выдуманные термины.

JSON: {"found":true,"model":"...","product_type_card":"","notes":[{"title":"ДРЕВЕСНЫЙ","desc":"тёплый и глубокий"},...],"sources":["..."]} или {"found":false,...}`;

function buildUserMessage(row: PodruzhkaFeedRow): string {
  return [
    `brand name: ${row.brandName}`,
    `product name: ${row.productName}`,
    `name: ${row.name}`,
    `product_type: ${row.productType}`,
    `ml: ${row.ml}`
  ].join("\n");
}

function normalizeProductTypeCard(s: string): string {
  return normalizeProductType(s);
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
  if (new Set(titles).size < 3) return "Повторяющиеся названия нот (note 1–3 должны быть разными)";
  for (const n of notes) {
    if (!n.title || !n.desc) return "Пустой блок: нужны и название (note N), и описание (note N desc)";
    if (!isAllowedNoteTitle(n.title)) {
      return `Недопустимое название ноты: ${n.title}`;
    }
    if (n.desc.toUpperCase() === n.title) {
      return `Описание не должно повторять название: ${n.title}`;
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

async function callOpenAi(
  apiKey: string,
  model: string,
  row: PodruzhkaFeedRow,
  extraUser?: string
): Promise<AiJson> {
  const res = await openaiFetch(openaiChatCompletionsUrl(), {
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
      error: parsed.error ?? "Ноты/model не подтверждены источниками"
    };
  }

  const modelName = String(parsed.model ?? "").trim();
  const notes = parseNotes(parsed).filter((n) => n.title && n.desc);
  const noteErr = validateNotes(notes);

  if (!modelName || notes.length < 3 || noteErr) {
    return {
      row: row.row,
      ok: false,
      model: modelName,
      notes,
      productTypeCard,
      productTypeMismatch: mismatch,
      sources: Array.isArray(parsed.sources) ? parsed.sources.map(String) : [],
      error: noteErr ?? "Неполные данные от модели"
    };
  }

  return {
    row: row.row,
    ok: true,
    model: modelName,
    notes,
    productTypeCard,
    productTypeMismatch: mismatch,
    sources: Array.isArray(parsed.sources) ? parsed.sources.map(String) : []
  };
}

async function fetchOne(
  apiKey: string,
  model: string,
  row: PodruzhkaFeedRow
): Promise<PodruzhkaAiResult> {
  let parsed = await callOpenAi(apiKey, model, row);
  let result = resultFromParsed(row, parsed);

  if (!result.ok && result.error?.includes("Повтор")) {
    parsed = await callOpenAi(
      apiKey,
      model,
      row,
      `ОШИБКА: ${result.error}. Верни три РАЗНЫХ title из списка семейств.`
    );
    result = resultFromParsed(row, parsed);
  }

  return result;
}
