import { guessBrandDomain, fetchPageTextSnippet } from "@/lib/templateGenerator/webContext";
import { collectReviewPhotosFromImageCell } from "@/lib/templateGenerator/photos";
import { isCoreContentColumn } from "@/lib/templateGenerator/presets";
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
  /** Не ходить на сайт бренда — быстрее, но хуже для нот/описания */
  skipWebContext?: boolean;
  /** Приоритет контентных полей: не просить AI искать фото в интернете */
  contentFocus?: boolean;
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
  opts: { contentFocus: boolean; onlyHeaders?: string[] }
): string {
  const activeFields = opts.onlyHeaders?.length
    ? fields.filter((f) => opts.onlyHeaders!.includes(f.header))
    : fields;

  const core = activeFields.filter((f) => isCoreContentColumn(f.header));
  const other = activeFields.filter((f) => !isCoreContentColumn(f.header));

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

  if (opts.contentFocus && !opts.onlyHeaders?.length) {
    lines.push(
      "ОБЯЗАТЕЛЬНО заполни все контентные поля ниже (не оставляй пустыми, если данные можно вывести из названия, CSV или сайта бренда):"
    );
  }

  const renderFields = (list: AiFieldSpec[], title: string) => {
    if (!list.length) return;
    lines.push(title);
    for (const f of list) {
      if (f.mode === "dropdown_strict" && f.allowed?.length) {
        const sample = dropdownSample(f.allowed, row.brand);
        lines.push(
          `- ${f.header}: ТОЛЬКО одно значение из списка (${f.allowed.length} вариантов, фрагмент): ${JSON.stringify(sample)}`
        );
      } else {
        lines.push(`- ${f.header}: ${f.hint || "свободный текст"}`);
      }
    }
    lines.push("");
  };

  if (opts.contentFocus && core.length) {
    renderFields(core, "Контентные поля (приоритет):");
    renderFields(other, "Прочие поля:");
  } else {
    renderFields(activeFields, "Заполни поля (JSON fields):");
  }

  return lines.join("\n");
}

const SYSTEM = `Ты умный помощник контент-отдела маркетплейса. Заполняешь КОНТЕНТНЫЕ характеристики товаров для Excel-шаблона Ozon.

Правила:
1. Приоритет — официальный сайт бренда (если фрагмент передан), затем CSV, затем логический вывод из названия товара.
2. Контентные поля (название, описание, тип, пол, семейство, ноты, объём) — заполняй по возможности полностью. Не оставляй пустыми ноты и семейство, если аромат узнаваем по названию.
3. Не выдумывай штрихкоды, артикулы, цены, вес, габариты.
4. dropdown_strict — значение СТРОГО из переданного списка. Если нет точного — выбери ближайшее по смыслу из списка.
5. Описание — до 6000 символов, информативное, без КАПСА целиком.
6. Ноты парфюма — на русском, конкретные (цитрус, жасмин, амбра…), не выдумывай несуществующие термины.
7. НЕ придумывай URL изображений — поле extra_photo_urls всегда оставляй пустым массивом [].

Ответ — JSON:
{"fields":{"Заголовок столбца":"значение",...},"extra_photo_urls":[],"sources":["кратко: откуда взято"]}`;

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

function parseAiFields(json: AiJson, fields: AiFieldSpec[]): Record<string, string> {
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
  return values;
}

function missingCoreHeaders(fields: AiFieldSpec[], values: Record<string, string>): string[] {
  return fields
    .filter((f) => isCoreContentColumn(f.header) && !values[f.header]?.trim())
    .map((f) => f.header);
}

function imageCellText(row: FillRowInput, imageHeader: string | null): string {
  if (imageHeader && row.cells[imageHeader]) return row.cells[imageHeader]!;
  return row.cells["Ссылка на изображение *"] ?? row.cells["Ссылка на изображение"] ?? "";
}

export async function fillTemplateRows(batch: FillBatchIn): Promise<FillRowResult[]> {
  const fields = buildFieldSpecs(batch.columns, batch.columnMeta);
  const contentFocus = batch.contentFocus !== false;
  const out: FillRowResult[] = [];

  for (const row of batch.rows) {
    const brand = pickBrand(row);
    const domain = guessBrandDomain(brand);
    let officialSnippet = "";
    if (domain && batch.skipWebContext !== true) {
      officialSnippet = await fetchPageTextSnippet(domain);
    }

    const extraPhotos = batch.photoSettings.enabled
      ? collectReviewPhotosFromImageCell(imageCellText(row, batch.photoSettings.imageHeader), {
          minCount: batch.photoSettings.minCount,
          targetCount: batch.photoSettings.targetCount
        })
      : [];

    try {
      const user = buildUserMessage(row, fields, batch.userPrompt, officialSnippet, {
        contentFocus
      });
      const json = await callOpenAi(batch.openaiApiKey, user, batch.model);
      const values = parseAiFields(json, fields);
      const sources = [...(json.sources ?? [])];

      const missing = contentFocus ? missingCoreHeaders(fields, values) : [];
      if (missing.length > 0) {
        const retryUser =
          buildUserMessage(row, fields, batch.userPrompt, officialSnippet, {
            contentFocus: true,
            onlyHeaders: missing
          }) +
          "\n\nЭти поля остались пустыми после первого прохода — заполни их обязательно на основе названия, CSV и сайта бренда.";
        const json2 = await callOpenAi(batch.openaiApiKey, retryUser, batch.model);
        Object.assign(values, parseAiFields(json2, fields));
        sources.push(...(json2.sources ?? []));
      }

      out.push({
        row: row.row,
        ok: true,
        values,
        extraPhotos,
        sources
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
