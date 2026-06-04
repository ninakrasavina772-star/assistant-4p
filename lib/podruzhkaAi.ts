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
  notes?: { title?: string; desc?: string }[];
  found?: boolean;
  sources?: string[];
  error?: string;
};

const EX = PODRUZHKA_AI_OBRAZEC;

const SYSTEM = `Ты эксперт по парфюмерии. Заполняешь ТОЛЬКО model и три ноты (note 1–3) для инфографики Ozon «Подружка Global» 1024×1365 (3:4).

ЭТАЛОН КОМПОЗИЦИИ — Carolina Herrera «212 Sexy» (reference-target.png). Слева сверху вниз:
1) brand name (крупно) — это НЕ model, берётся из Excel отдельно
2) product_type (серый, мелко) — из Excel, ты не меняешь
3) model — короткое имя аромата: «212 Sexy», «Duro», «Red Hoba» (без бренда, без «мл»)
4) три ноты — блок по центру-низу листа (title КАПС + desc серым)
5) ml — объём внизу слева

На макете одна розовая черта — только под блоком нот, перед ml. Под model черты нет.
Справа — большое foto товара без отдельной тени.

ОБРАЗЕЦ ТЕКСТА (Nasomatto):
- model: «${EX.model}»
- note 1: ${EX.excelCells[0]}
- note 2: ${EX.excelCells[1]}
- note 3: ${EX.excelCells[2]}

Правила:
1. model — коммерческое имя из product name / name. Не SKU, не бренд.
2. notes — 3 блока: title одно слово КАПС из списка ${allowedNoteTitlesPrompt()}; desc 2–6 слов, с маленькой буквы.
3. ЗАПРЕЩЕНО: цветучий, цветение, цветочная, англ. в title, выдуманные термины.
4. Источники: Fragrantica / сайт бренда. Иначе found: false.
5. Три title — разные слова.

JSON: {"found":true,"model":"...","notes":[...],"sources":[...]} или {"found":false,...}`;

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

  if (!modelName || notes.length < 3 || noteErr) {
    return {
      row: row.row,
      ok: false,
      model: modelName,
      notes,
      sources: Array.isArray(parsed.sources) ? parsed.sources.map(String) : [],
      error: noteErr ?? "Неполные данные от модели"
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
