import { prefillFromCsvData } from "@/lib/templateGenerator/csvPrefill";
import { guessBrandDomain, fetchPageTextSnippet } from "@/lib/templateGenerator/webContext";
import { resolveRowPhotos, productPhotoContextFromRow } from "@/lib/templateGenerator/photoGenerate";
import type { ColumnSelection, FillRowInput, FillRowResult, TemplateWorkMode } from "@/lib/templateGenerator/types";
import { rowNeedsAiForHeaders } from "@/lib/templateGenerator/workMode";

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
    /** Композит товара на разные фоны, если URL в ячейке меньше цели */
    generateBackgrounds?: boolean;
    /** themed — lifestyle-фоны в тему товара (OpenAI Images); gradient — только градиенты */
    photoStyle?: "themed" | "gradient";
  };
  model?: string;
  /** Не ходить на сайт бренда — быстрее, но хуже для нот/описания */
  skipWebContext?: boolean;
  /** Приоритет контентных полей: не просить AI искать фото в интернете */
  contentFocus?: boolean;
  workMode?: TemplateWorkMode;
  /** Перезаписывать уже заполненные ячейки (режим «дополнить») */
  overwriteFilled?: boolean;
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
  opts: {
    contentFocus: boolean;
    onlyHeaders?: string[];
    prefilled?: Record<string, string>;
  }
): string {
  const activeFields = opts.onlyHeaders?.length
    ? fields.filter((f) => opts.onlyHeaders!.includes(f.header))
    : fields;

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

  if (opts.prefilled && Object.keys(opts.prefilled).length) {
    lines.push("Уже заполнено из CSV/шаблона (не меняй без необходимости):");
    lines.push(JSON.stringify(opts.prefilled, null, 0), "");
  }

  if (officialSnippet) {
    lines.push("Фрагмент официального сайта бренда:", officialSnippet.slice(0, 3500), "");
  }

  if (userPrompt.trim()) {
    lines.push("Задание от контент-менеджера:", userPrompt.trim(), "");
  }

  if (opts.contentFocus && !opts.onlyHeaders?.length) {
    lines.push(
      "Заполни ВСЕ поля ниже — пользователь отметил их для генерации. Не оставляй пустыми, если данные можно вывести из названия, CSV или сайта бренда:"
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

  renderFields(activeFields, "Поля для заполнения (выбраны пользователем):");

  return lines.join("\n");
}

const SYSTEM = `Ты умный помощник контент-отдела маркетплейса. Заполняешь КОНТЕНТНЫЕ характеристики товаров для Excel-шаблона витрины (Ozon, Яндекс Маркет и др.).

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

function missingSelectedHeaders(fields: AiFieldSpec[], values: Record<string, string>): string[] {
  return fields.filter((f) => !values[f.header]?.trim()).map((f) => f.header);
}

function imageCellText(row: FillRowInput, imageHeader: string | null): string {
  if (imageHeader) {
    const fromCell = row.cells[imageHeader]?.trim();
    if (fromCell) return fromCell;
    const fromCsv = row.csvData[imageHeader]?.trim();
    if (fromCsv) return fromCsv;
  }
  for (const [k, v] of Object.entries(row.csvData)) {
    if (/изображ|image|фото/i.test(k) && v.trim()) return v.trim();
  }
  return row.cells["Ссылка на изображение *"] ?? row.cells["Ссылка на изображение"] ?? "";
}

async function resolveExtraPhotos(
  row: FillRowInput,
  batch: FillBatchIn
): Promise<{ extraPhotos: string[]; imageUrls?: string[]; sources: string[] }> {
  if (!batch.photoSettings.enabled) {
    return { extraPhotos: [], sources: [] };
  }

  const imageText = imageCellText(row, batch.photoSettings.imageHeader);
  const photo = await resolveRowPhotos({
    imageText,
    sku: row.sku,
    minCount: batch.photoSettings.minCount,
    targetCount: batch.photoSettings.targetCount,
    generateBackgrounds: batch.photoSettings.generateBackgrounds !== false,
    openaiApiKey: batch.openaiApiKey,
    productContext: productPhotoContextFromRow(row),
    photoStyle: batch.photoSettings.photoStyle ?? "themed"
  });

  const sources: string[] = [];
  if (photo.generated.length) {
    const styleNote =
      batch.photoSettings.photoStyle === "gradient" ? "градиенты" : "lifestyle в тему";
    sources.push(`фото: +${photo.generated.length} (${styleNote})`);
    if (photo.note && !photo.note.startsWith("темы:")) sources.push(`фото: ${photo.note}`);
    else if (photo.note) sources.push(photo.note);
  } else if (photo.note) {
    sources.push(`фото: ${photo.note}`);
  }

  return {
    extraPhotos: photo.generated,
    imageUrls: photo.imageUrls.length ? photo.imageUrls : undefined,
    sources
  };
}

async function getBrandSnippet(
  domain: string | null,
  skipWeb: boolean,
  cache: Map<string, string>
): Promise<string> {
  if (!domain || skipWeb) return "";
  const hit = cache.get(domain);
  if (hit !== undefined) return hit;
  const snippet = await fetchPageTextSnippet(domain);
  cache.set(domain, snippet);
  return snippet;
}

export async function fillTemplateRows(batch: FillBatchIn): Promise<FillRowResult[]> {
  const fields = buildFieldSpecs(batch.columns, batch.columnMeta);
  const contentFocus = batch.contentFocus !== false;
  const workMode = batch.workMode ?? "supplement";
  const keepTemplateFilled = workMode === "supplement" && batch.overwriteFilled !== true;
  const out: FillRowResult[] = [];
  const brandSnippetCache = new Map<string, string>();

  for (const row of batch.rows) {
    const brand = pickBrand(row);
    const domain = guessBrandDomain(brand);

    const photoResolved = await resolveExtraPhotos(row, batch);
    const extraPhotos = photoResolved.extraPhotos;
    const imageUrls = photoResolved.imageUrls;
    const photoSources = photoResolved.sources;

    try {
      const csvPrefill = prefillFromCsvData(row.csvData, fields, row.cells, {
        keepTemplateFilled
      });
      const values: Record<string, string> = { ...csvPrefill.values };
      const sources = [...csvPrefill.sources, ...photoSources];

      const aiHeaders = rowNeedsAiForHeaders(
        row.cells,
        fields.map((f) => f.header),
        workMode === "from_scratch" || batch.overwriteFilled === true
      );
      let missing = fields
        .filter((f) => aiHeaders.includes(f.header) && !values[f.header]?.trim())
        .map((f) => f.header)
        .slice(0, 14);

      if (missing.length === 0) {
        out.push({
          row: row.row,
          ok: true,
          values,
          extraPhotos,
          imageUrls,
          sources
        });
        continue;
      }

      const officialSnippet = await getBrandSnippet(
        domain,
        batch.skipWebContext === true,
        brandSnippetCache
      );
      if (officialSnippet) sources.push("сайт бренда");

      const user = buildUserMessage(row, fields, batch.userPrompt, officialSnippet, {
        contentFocus,
        onlyHeaders: missing,
        prefilled: values
      });
      const json = await callOpenAi(batch.openaiApiKey, user, batch.model);
      Object.assign(values, parseAiFields(json, fields));
      sources.push(...(json.sources ?? []).map((s) => `AI: ${s}`));

      missing = fields
        .filter((f) => aiHeaders.includes(f.header) && !values[f.header]?.trim())
        .map((f) => f.header)
        .slice(0, 14);
      if (missing.length > 0) {
        const retryUser =
          buildUserMessage(row, fields, batch.userPrompt, officialSnippet, {
            contentFocus: true,
            onlyHeaders: missing,
            prefilled: values
          }) +
          "\n\nЭти поля остались пустыми — заполни их обязательно на основе названия, CSV и сайта бренда. Не оставляй пустыми.";
        const json2 = await callOpenAi(batch.openaiApiKey, retryUser, batch.model);
        Object.assign(values, parseAiFields(json2, fields));
        sources.push(...(json2.sources ?? []).map((s) => `AI retry: ${s}`));
      }

      const stillMissing = fields
        .filter((f) => aiHeaders.includes(f.header) && !values[f.header]?.trim())
        .map((f) => f.header);
      if (stillMissing.length > 0) {
        out.push({
          row: row.row,
          ok: false,
          values,
          extraPhotos,
          imageUrls,
          sources,
          error: `Не заполнены: ${stillMissing.join(", ")}`
        });
        continue;
      }

      out.push({
        row: row.row,
        ok: true,
        values,
        extraPhotos,
        imageUrls,
        sources
      });
    } catch (e) {
      out.push({
        row: row.row,
        ok: false,
        values: {},
        extraPhotos,
        imageUrls,
        sources: photoSources,
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
    "Сопоставь колонки CSV с колонками шаблона витрины.",
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
