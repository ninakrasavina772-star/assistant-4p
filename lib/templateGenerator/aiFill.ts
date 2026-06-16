import { guessBrandDomain, fetchPageTextSnippet } from "@/lib/templateGenerator/webContext";
import { countRowPhotos, parseImageUrls } from "@/lib/templateGenerator/photos";
import type { ColumnSelection, FillRowInput, FillRowResult } from "@/lib/templateGenerator/types";

export type FillBatchIn = {
  openaiApiKey: string;
  userPrompt: string;
  columns: ColumnSelection[];
  columnMeta: {
    header: string;
    hint: string;
    dropdownValues: string[];
    mode: "ai" | "dropdown_strict";
  }[];
  rows: FillRowInput[];
  photoSettings: {
    enabled: boolean;
    minCount: number;
    targetCount: number;
    imageHeader: string | null;
  };
  model?: string;
  /** Не ходить на сайт бренда — быстрее и стабильнее при пакетной обработке */
  skipWebContext?: boolean;
};

type AiFieldSpec = {
  header: string;
  mode: "ai" | "dropdown_strict";
  hint: string;
  allowed?: string[];
};

type AiJson = {
  fields?: Record<string, string>;
  extra_photo_urls?: string[];
  sources?: string[];
  error?: string;
};

const MAX_DROPDOWN_IN_PROMPT = 120;

function dropdownSample(values: string[], brand: string): string[] {
  if (values.length <= MAX_DROPDOWN_IN_PROMPT) return values;
  const b = brand.toLowerCase();
  const matched = values.filter((v) => v.toLowerCase().includes(b.slice(0, 4)));
  const head = values.slice(0, 40);
  const merged = [...new Set([...matched.slice(0, 40), ...head])];
  return merged.slice(0, MAX_DROPDOWN_IN_PROMPT);
}

function buildFieldSpecs(
  columns: ColumnSelection[],
  meta: FillBatchIn["columnMeta"]
): AiFieldSpec[] {
  return columns
    .filter((c) => c.mode !== "skip")
    .map((c) => {
      const m = meta.find((x) => x.header === c.header);
      const strict = c.mode === "dropdown_strict";
      return {
        header: c.header,
        mode: strict ? "dropdown_strict" : "ai",
        hint: m?.hint ?? "",
        allowed: strict ? m?.dropdownValues : undefined
      };
    });
}

function buildUserMessage(
  row: FillRowInput,
  fields: AiFieldSpec[],
  userPrompt: string,
  officialSnippet: string,
  photoNeed: number
): string {
  const lines = [
    `Артикул SKU: ${row.sku}`,
    `Название: ${row.productName}`,
    `Бренд: ${row.brand}`,
    "",
    "Текущие данные в шаблоне:",
    JSON.stringify(row.cells, null, 0),
    "",
    "Данные из CSV (если есть):",
    JSON.stringify(row.csvData, null, 0),
    ""
  ];

  if (officialSnippet) {
    lines.push("Фрагмент официального сайта бренда:", officialSnippet.slice(0, 3500), "");
  }

  if (userPrompt.trim()) {
    lines.push("Задание от контент-менеджера:", userPrompt.trim(), "");
  }

  lines.push("Заполни поля (JSON fields):");
  for (const f of fields) {
    if (f.mode === "dropdown_strict" && f.allowed?.length) {
      const sample = dropdownSample(f.allowed, row.brand);
      lines.push(
        `- ${f.header}: ТОЛЬКО одно значение из списка (${f.allowed.length} вариантов, фрагмент): ${JSON.stringify(sample)}`
      );
    } else {
      lines.push(`- ${f.header}: ${f.hint || "свободный текст"}`);
    }
  }

  if (photoNeed > 0) {
    lines.push(
      "",
      `Нужно ещё ${photoNeed} прямых URL изображений товара (https, packshot на белом/прозрачном фоне).`,
      "Верни их в extra_photo_urls — только реальные прямые ссылки на jpg/png/webp."
    );
  }

  return lines.join("\n");
}

const SYSTEM = `Ты умный помощник контент-отдела маркетплейса. Заполняешь характеристики товаров для Excel-шаблона Ozon по заданию контент-менеджера.

Правила достоверности:
1. Приоритет — официальный сайт бренда/производителя (домен бренда, например chanel.com). Если фрагмент передан — считай его источником истины.
2. Если на официальном сайте данных нет — ищи в CSV и других источниках; для спорных фактов нужно совпадение 2–3 независимых логических выводов (не выдумывай).
3. Не выдумывай штрихкоды, артикулы, цены, вес, габариты.
4. dropdown_strict — значение СТРОГО из переданного списка (ближайшее допустимое). Если нет подходящего — оставь поле пустым.
5. Описание товара — до 6000 символов, без КАПСА целиком, без сравнения с конкурентами.
6. Ноты парфюма — на русском, без выдуманных терминов.

Ответ — JSON:
{"fields":{"Заголовок столбца":"значение",...},"extra_photo_urls":["https://..."],"sources":["кратко: откуда взято"]}`;

async function callOpenAi(apiKey: string, user: string, model?: string): Promise<AiJson> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 75_000);
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: model?.trim() || "gpt-4o-mini",
        temperature: 0.25,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: user }
        ]
      })
    });

    if (!res.ok) {
      const t = await res.text();
      throw new Error(t.slice(0, 300) || `OpenAI HTTP ${res.status}`);
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const raw = data.choices?.[0]?.message?.content ?? "{}";
    return JSON.parse(raw) as AiJson;
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      throw new Error("OpenAI: превышено время ожидания (75 с)");
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function pickProductName(row: FillRowInput): string {
  return (
    row.cells["Название товара *"] ??
    row.cells["Название товара"] ??
    row.productName ??
    row.cells["name"] ??
    ""
  );
}

function pickBrand(row: FillRowInput): string {
  return row.cells["Бренд *"] ?? row.cells["Бренд"] ?? row.brand ?? "";
}

export async function fillTemplateRows(batch: FillBatchIn): Promise<FillRowResult[]> {
  const fields = buildFieldSpecs(batch.columns, batch.columnMeta);
  const out: FillRowResult[] = [];

  for (const row of batch.rows) {
    const brand = pickBrand(row);
    const productName = pickProductName(row) || row.productName;
    const domain = guessBrandDomain(brand);
    let officialSnippet = "";
    if (domain && batch.skipWebContext !== true) {
      officialSnippet = await fetchPageTextSnippet(domain);
    }

    const existingPhotos = batch.photoSettings.imageHeader
      ? countRowPhotos(row.cells, batch.photoSettings.imageHeader)
      : parseImageUrls(row.cells["Ссылка на изображение *"] ?? row.cells["Ссылка на изображение"] ?? "").length;

    const photoNeed =
      batch.photoSettings.enabled && existingPhotos < batch.photoSettings.minCount
        ? Math.max(0, batch.photoSettings.targetCount - existingPhotos)
        : 0;

    try {
      const user = buildUserMessage(row, fields, batch.userPrompt, officialSnippet, photoNeed);
      const json = await callOpenAi(batch.openaiApiKey, user, batch.model);
      const values: Record<string, string> = {};
      for (const f of fields) {
        const v = String(json.fields?.[f.header] ?? "").trim();
        if (!v) continue;
        if (f.mode === "dropdown_strict" && f.allowed?.length) {
          const exact = f.allowed.find((a) => a.toLowerCase() === v.toLowerCase());
          if (exact) values[f.header] = exact;
          else {
            const partial = f.allowed.find(
              (a) => a.toLowerCase().includes(v.toLowerCase()) || v.toLowerCase().includes(a.toLowerCase())
            );
            if (partial) values[f.header] = partial;
          }
        } else {
          values[f.header] = v;
        }
      }

      const extraPhotos = (json.extra_photo_urls ?? [])
        .map((u) => String(u).trim())
        .filter((u) => /^https?:\/\//i.test(u))
        .slice(0, photoNeed || 8);

      out.push({
        row: row.row,
        ok: true,
        values,
        extraPhotos,
        sources: json.sources ?? []
      });
    } catch (e) {
      out.push({
        row: row.row,
        ok: false,
        values: {},
        extraPhotos: [],
        sources: [],
        error: e instanceof Error ? e.message : "Ошибка AI"
      });
    }
  }

  return out;
}

export async function mapCsvColumnsWithAi(
  apiKey: string,
  csvHeaders: string[],
  templateHeaders: string[],
  sampleRows: string[][],
  model?: string
): Promise<{ skuColumn: string; columns: Record<string, string> }> {
  const user = [
    "Сопоставь колонки CSV с колонками шаблона Ozon.",
    "SKU для матчинга — артикул вариации товара (Артикул товара SKU).",
    `CSV headers: ${JSON.stringify(csvHeaders)}`,
    `Template headers: ${JSON.stringify(templateHeaders)}`,
    `Sample rows: ${JSON.stringify(sampleRows.slice(0, 3))}`,
    'JSON: {"skuColumn":"...","columns":{"Template header":"CSV header"}}'
  ].join("\n");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: model?.trim() || "gpt-4o-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "Сопоставляешь колонки CSV и Excel-шаблона. Только валидный JSON."
        },
        { role: "user", content: user }
      ]
    })
  });

  if (!res.ok) throw new Error(`OpenAI ${res.status}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const json = JSON.parse(data.choices?.[0]?.message?.content ?? "{}") as {
    skuColumn?: string;
    columns?: Record<string, string>;
  };
  return {
    skuColumn: json.skuColumn ?? csvHeaders[0] ?? "",
    columns: json.columns ?? {}
  };
}
