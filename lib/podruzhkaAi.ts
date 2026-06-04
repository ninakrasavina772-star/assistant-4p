import { PODRUZHKA_AI_OBRAZEC } from "@/lib/podruzhkaAiExamples";
import type { PodruzhkaAiResult, PodruzhkaFeedRow, PodruzhkaNoteBlock } from "@/lib/podruzhkaTypes";

export type NotesBatchIn = {
  openaiApiKey: string;
  rows: PodruzhkaFeedRow[];
  model?: string;
};

type AiJson = {
  model?: string;
  notes?: { title?: string; desc?: string }[];
  found?: boolean;
  sources?: string[];
  error?: string;
};

const EX = PODRUZHKA_AI_OBRAZEC;

const SYSTEM = `Ты эксперт по парфюмерии. Заполняешь ТОЛЬКО поля model и три ноты (note 1–3) для инфографики Ozon «Подружка Global» 1080×1350.
Текст попадёт на карточку крупным шрифтом — стиль должен совпадать с эталоном.

ЭТАЛОН (Nasomatto, образец.xlsx):
- model: «${EX.model}» (короткое имя аромата, не SKU)
- note 1: ${EX.excelCells[0]}
- note 2: ${EX.excelCells[1]}
- note 3: ${EX.excelCells[2]}

Правила оформления (обязательно):
1. model — 1–3 слова, коммерческое имя аромата (из product name / name, без бренда и без «мл»).
2. notes — ровно 3 блока. title: 1–2 слова ЗАГЛАВНЫМИ по-русски (ДРЕВЕСНЫЙ, ПРЯНЫЙ). desc: 2–6 слов, с маленькой буквы, без точки в конце (тёплый и глубокий, пикантный характер).
3. Ноты — доминирующие семейства/характер, подтверждённые Fragrantica, официальным сайтом бренда, Parfumista и т.п. Не выдумывай редкие ноты.
4. Если аромат или ноты не находятся в источниках — found: false.

Ответ строго JSON:
{"found":true,"model":"...","notes":[{"title":"ДРЕВЕСНЫЙ","desc":"тёплый и глубокий"},...],"sources":["url1",...]}
или {"found":false,"model":"","notes":[],"sources":[],"error":"причина"}`;

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
    title: String(n.title ?? "").trim().toUpperCase(),
    desc: normalizeDesc(String(n.desc ?? ""))
  }));
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
      temperature: 0.2,
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

  if (!modelName || notes.length < 3) {
    return {
      row: row.row,
      ok: false,
      model: modelName,
      notes,
      sources: Array.isArray(parsed.sources) ? parsed.sources.map(String) : [],
      error: "Неполные данные от модели"
    };
  }

  return {
    row: row.row,
    ok: true,
    model: modelName,
    notes,
    sources: Array.isArray(parsed.sources) ? parsed.sources.map(String) : []
  };
}
