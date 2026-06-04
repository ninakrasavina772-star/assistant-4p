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

const SYSTEM = `Ты эксперт по парфюмерии. Заполняешь поля для фиксированной инфографики Ozon (бренд Подружка).
Нельзя выдумывать факты. Название аромата (model) и три блока нот — только если их можно подтвердить несколькими источниками.

Правила:
1. model — короткое коммерческое имя аромата (например «212 Sexy»), не полное название SKU. Опирайся на brand name, product name и name.
2. notes — ровно 3 пары: title (одно слово или короткая фраза ЗАГЛАВНЫМИ на русском, как «ДРЕВЕСНЫЙ») и desc (2–5 слов, строчными, как «тёплый и глубокий»).
3. Бери семейства/характеры, которые повторяются минимум на 3 независимых сайтах (официальный сайт бренда, Fragrantica, Parfumista и т.п.).
4. Если model или ноты не подтверждаются — found: false, не заполняй выдумками.

Ответ строго JSON:
{"found":true,"model":"...","notes":[{"title":"...","desc":"..."},...],"sources":["url1",...]}
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

function parseNotes(raw: AiJson): PodruzhkaNoteBlock[] {
  const notes = Array.isArray(raw.notes) ? raw.notes : [];
  return notes.slice(0, 3).map((n) => ({
    title: String(n.title ?? "").trim().toUpperCase(),
    desc: String(n.desc ?? "").trim()
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
