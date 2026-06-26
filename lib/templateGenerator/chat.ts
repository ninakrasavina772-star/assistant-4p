import type { CsvColumnMap, TemplateWorkMode } from "@/lib/templateGenerator/types";
import type { CsvTable } from "@/lib/templateGenerator/csvIndex";
import { parseVariationIdsFromList } from "@/lib/templateGenerator/parseVariationIds";
import { YANDEX_PHOTO_MANAGER_APPEND } from "@/lib/templateGenerator/yandexRules";
import { openaiChatCompletionsUrl, openaiFetch, readOpenAiError } from "@/lib/openaiFetch";

export type ChatRole = "user" | "assistant";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  at: number;
};

export type TemplateColumnBrief = {
  header: string;
  hint: string;
  enabled: boolean;
  readonly: boolean;
};

export type TemplateProductSample = {
  sku: string;
  name: string;
  brand: string;
  preview: Record<string, string>;
};

export type TemplateChatContext = {
  templateFile?: string;
  sheetName?: string;
  rowCount?: number;
  feedEnabled?: boolean;
  workMode?: TemplateWorkMode;
  overwriteFilled?: boolean;
  csvLabel?: string;
  csvRowCount?: number;
  skuColumn?: string;
  selectedColumns?: string[];
  enabledColCount?: number;
  photoEnabled?: boolean;
  photoGenerateBackgrounds?: boolean;
  photoStyle?: "themed" | "gradient";
  metabaseEnabled?: boolean;
  photoMin?: number;
  photoTarget?: number;
  marketplace?: "ozon" | "yandex";
  columns?: TemplateColumnBrief[];
  productSamples?: TemplateProductSample[];
  uniqueBrands?: string[];
  csvHeaders?: string[];
  csvSampleRows?: Record<string, string>[];
  csvMappedColumns?: Record<string, string>;
  exampleFile?: string;
  exampleSheet?: string;
  exampleRowCount?: number;
  exampleSamples?: TemplateProductSample[];
  headerRow?: number;
  headerRowCandidates?: { row: number; label: string }[];
};

export type AssistantFillAction = {
  type: "start_fill";
  /** Если пусто — заполнить текущую партию шаблона как кнопка «Запустить AI» */
  variationIds?: number[];
  strictExample: boolean;
};

export type ChatAssistantResult = {
  reply: string;
  action?: AssistantFillAction;
};

const START_FILL_TOOL = {
  type: "function" as const,
  function: {
    name: "start_template_fill",
    description:
      "Запустить AI-заполнение Excel-шаблона. Товары по variation_id подтягиваются из Metabase. " +
      "Вызывай, когда пользователь просит заполнить/сгенерировать шаблон или даёт список ID вариаций.",
    parameters: {
      type: "object",
      properties: {
        variation_ids: {
          type: "array",
          items: { type: "integer" },
          description:
            "Список variation_id (числовые ID). Если пользователь не указал ID — передай пустой массив."
        },
        strict_example: {
          type: "boolean",
          description:
            "true — строго копировать стиль эталона заполнения (если образец загружен). По умолчанию true."
        }
      },
      required: ["variation_ids"]
    }
  }
};

const CHAT_SYSTEM = `Ты ассистент «Генератор шаблонов» для контент-отдела (любая витрина: Ozon, Яндекс Маркет, Wildberries и др.).

ЗАЧЕМ ТЫ НУЖЕН:
- Помогаешь спланировать заполнение и ЗАПУСКАЕШЬ его по команде через инструмент start_template_fill.
- Всё, что пользователь напишет в чате — попадает в задание для AI при заполнении КАЖДОЙ строки.
- Подсвечивай акценты: какие поля важнее, тон описания, что проверить, особые правила для бренда/категории.

ЧТО ТЫ МОЖЕШЬ:
- Объяснить назначение столбцов по подсказкам (hint) из шаблона.
- Подсказать, какие галочки включить для парфюма/косметики.
- Запустить AI-заполнение (start_template_fill) — текущая партия или список variation_id.
- Учесть эталон (образец): strict_example копирует СТИЛЬ, не значения — каждая строка уникальна.

ЧТО ТЫ НЕ МОЖЕШЬ (скажи пользователю сделать в интерфейсе):
- Загрузить Excel, CSV, образец — только кнопки на странице.
- Переключить вкладку или строку заголовков — пользователь выбирает в блоке «Шаблон».
- Отметить галочки столбцов — только в таблице «Столбцы».
- Удалить дубли — этап 1, галочка «Удалить из шаблона» у каждого товара.
- Выбрать фото — отдельный блок «Проверка фото».

Два сценария заполнения:
  1) «Дополнить» — в шаблоне уже есть товары; фид CSV → AI для пробелов в отмеченных столбцах.
  2) «По списку variation_id» — Metabase найдёт товар, строки появятся в шаблоне, AI заполнит поля.

ЗАПУСК ЗАПОЛНЕНИЯ (инструмент start_template_fill):
- Команды: «заполни», «запусти генерацию», «сделай шаблон», «заполни ID 123 456», список чисел.
- variation_ids — числовые ID из Metabase (variation_id). Извлекай из сообщения все числа.
- Если ID не указаны, но просят запустить — передай variation_ids: [].
- strict_example: true если загружен эталон (образец) — копируем стиль образца.
- Перед запуском: шаблон должен быть загружен. Если нет — попроси загрузить, инструмент не вызывай.
- Metabase подключён — foto, название и бренд подтягиваются автоматически.

ВАЖНО — данные в контексте ниже:
- Если есть примеры товаров — НЕ проси бренд/SKU заново.
- Если есть «Эталон заполнения» — при запуске strict_example=true, AI копирует формат образца.
- Если пользователь просит проверить сопоставление — задай вопросы ДО запуска (без инструмента).

Твоя роль:
- Русский язык, кратко.
- Помогай с правилами полей: «название на русском», «ноты кратко».
- После вызова инструмента кратко подтверди: сколько ID, что будет сделано, что Excel скачается автоматически.

Отвечай обычным текстом (кроме вызова инструмента).`;

const PREVIEW_KEYS = [
  "бренд",
  "название",
  "тип",
  "пол",
  "семейство",
  "описание",
  "объем",
  "объём",
  "ноты",
  "линейка"
];

function trimVal(s: string, max = 160): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

function pickPreviewFields(cells: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(cells)) {
    if (!v.trim()) continue;
    const n = k.toLowerCase();
    if (PREVIEW_KEYS.some((p) => n.includes(p))) {
      out[k] = trimVal(v);
    }
    if (Object.keys(out).length >= 8) break;
  }
  return out;
}

export function buildCsvSampleRows(
  table: CsvTable,
  map: CsvColumnMap | null,
  limit = 3
): Record<string, string>[] {
  const out: Record<string, string>[] = [];
  const skuCol = map?.skuColumn ?? "";
  for (const row of table.rows.slice(0, limit)) {
    const rec: Record<string, string> = {};
    table.headers.forEach((h, i) => {
      const v = String(row[i] ?? "").trim();
      if (v) rec[h] = trimVal(v, 120);
    });
    if (skuCol && rec[skuCol]) rec["__sku"] = rec[skuCol]!;
    out.push(rec);
  }
  return out;
}

export function chatStorageKey(apiKey: string): string {
  const tail = apiKey.trim().slice(-12) || "anon";
  return `fp_template_gen_chat_${tail}`;
}

export function newChatId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function welcomeMessage(): ChatMessage {
  return {
    id: "welcome",
    role: "assistant",
    at: Date.now(),
    content: `Привет! Я ассистент генератора шаблонов для любой витрины.

Зачем я здесь:
• Помогаю спланировать заполнение и **запускаю его по вашей команде**.
• Запоминаю правила — они уйдут в задание для AI на каждой строке.
• Можно писать или нажать 🎤 и продиктовать.

Как запустить заполнение:
1. Загрузите Excel-шаблон (и при необходимости **эталон заполнения**).
2. Напишите в чат, например:
   «Заполни variation_id: 7127308278, 7127308279»
   или «Запусти генерацию для этих ID: …»
3. Я найду товары в Metabase, заполню шаблон по образцу и **скачайте Excel** автоматически.

Без списка ID можно сказать «запусти заполнение» — обработаю текущую партию шаблона.

С чего начнём?`
  };
}

export function buildContextBlock(ctx: TemplateChatContext): string {
  const lines: string[] = ["=== КОНТЕКСТ ЗАГРУЖЕННЫХ ФАЙЛОВ (используй при ответе) ==="];

  if (ctx.templateFile) {
    lines.push(
      "",
      `Шаблон Excel: «${ctx.templateFile}»`,
      `Вкладка: ${ctx.sheetName ?? "?"}`,
      `Строка заголовков: ${ctx.headerRow ?? "авто"}`,
      `Строк товаров: ${ctx.rowCount ?? "?"}`,
      `Отмечено для генерации: ${ctx.enabledColCount ?? 0} столбцов`
    );
  } else {
    lines.push("", "Шаблон Excel: НЕ ЗАГРУЖЕН — попроси пользователя нажать «Загрузить шаблон Excel»");
  }

  if (ctx.columns?.length) {
    lines.push("", "Столбцы шаблона (заголовок | подсказка | заполнять?):");
    for (const c of ctx.columns.slice(0, 55)) {
      const flag = c.readonly ? "readonly" : c.enabled ? "ДА" : "нет";
      lines.push(`  · ${c.header} | ${trimVal(c.hint, 80) || "—"} | ${flag}`);
    }
    if (ctx.columns.length > 55) lines.push(`  … ещё ${ctx.columns.length - 55} столбцов`);
  }

  if (ctx.productSamples?.length) {
    lines.push("", "Примеры товаров из шаблона (уже загружены, не спрашивай бренд заново):");
    for (const p of ctx.productSamples) {
      lines.push(`  SKU ${p.sku} | ${p.brand || "?"} | ${trimVal(p.name, 100)}`);
      const prev = Object.entries(p.preview)
        .map(([k, v]) => `${k}: ${v}`)
        .join("; ");
      if (prev) lines.push(`    ${prev}`);
    }
  }

  if (ctx.uniqueBrands?.length) {
    lines.push("", `Бренды в шаблоне (фрагмент): ${ctx.uniqueBrands.slice(0, 20).join(", ")}`);
  }

  lines.push(
    "",
    `Режим: ${ctx.workMode === "from_scratch" ? "заполнить с нуля (фид + шаблон)" : "дополнить пустые поля"}`,
    ctx.overwriteFilled ? "Перезапись заполненных ячеек: ДА" : "Перезапись заполненных ячеек: НЕТ",
    `CSV-фид при заполнении: ${ctx.feedEnabled ? "ВКЛЮЧЁН" : "ВЫКЛЮЧЕН (только AI + шаблон)"}`
  );

  if (ctx.feedEnabled && ctx.csvLabel) {
    lines.push(
      `CSV-фид: ${ctx.csvLabel}`,
      `Строк в фиде: ${ctx.csvRowCount ?? "?"}`,
      `Колонка SKU: ${ctx.skuColumn ?? "?"}`
    );
  } else if (ctx.feedEnabled && !ctx.csvLabel) {
    lines.push("CSV-фид включён, но файл ещё не загружен.");
  }

  if (ctx.csvHeaders?.length) {
    lines.push("", `Колонки CSV: ${ctx.csvHeaders.slice(0, 40).join(" | ")}`);
  }

  if (ctx.csvMappedColumns && Object.keys(ctx.csvMappedColumns).length) {
    lines.push("", "Сопоставление CSV → шаблон:");
    for (const [tpl, csv] of Object.entries(ctx.csvMappedColumns).slice(0, 20)) {
      lines.push(`  ${tpl} ← ${csv}`);
    }
  }

  if (ctx.csvSampleRows?.length) {
    lines.push("", "Примеры строк CSV:");
    ctx.csvSampleRows.forEach((row, i) => {
      lines.push(`  [${i + 1}] ${JSON.stringify(row)}`);
    });
  }

  if (ctx.exampleSamples?.length) {
    lines.push(
      "",
      `Эталон заполнения: «${ctx.exampleFile ?? "образец"}»`,
      `Вкладка образца: ${ctx.exampleSheet ?? "?"}`,
      `Строк с данными: ${ctx.exampleRowCount ?? ctx.exampleSamples.length}`
    );
    lines.push("", "Примеры эталонного заполнения (стиль и формат):");
    for (const s of ctx.exampleSamples) {
      lines.push(`  SKU ${s.sku} | ${s.brand} | ${trimVal(s.name, 80)}`);
      const prev = Object.entries(s.preview)
        .map(([k, v]) => `${k}: ${v}`)
        .join("; ");
      if (prev) lines.push(`    ${prev}`);
    }
  }

  if (ctx.selectedColumns?.length) {
    lines.push("", `Сейчас отмечены для AI: ${ctx.selectedColumns.join("; ")}`);
  }

  if (ctx.marketplace === "yandex") {
    lines.push("", "Яндекс Маркет — правила foto (категорийный менеджер):", YANDEX_PHOTO_MANAGER_APPEND.trim());
  }

  if (ctx.photoEnabled) {
    const mode =
      ctx.photoStyle === "gradient"
        ? "градиенты"
        : "lifestyle в тему (OpenAI Images)";
    lines.push(`Фото: цель ${ctx.photoTarget}, мин ${ctx.photoMin}, режим ${mode}`);
  }

  lines.push(
    "",
    "Metabase: подключён — по variation_id можно искать товар и foto.",
    "Запуск заполнения: через инструмент start_template_fill (список variation_id или текущая партия)."
  );

  return lines.join("\n");
}

export function buildFillPromptFromChat(
  messages: ChatMessage[],
  exampleReference?: string
): string {
  const parts: string[] = [];
  if (exampleReference?.trim()) {
    parts.push(exampleReference.trim(), "");
  }
  const dialog = messages
    .filter((m) => m.content.trim() && m.id !== "welcome")
    .map((m) => (m.role === "user" ? `Контент-менеджер: ${m.content}` : `Ассистент: ${m.content}`));
  if (dialog.length) {
    parts.push(
      "Договорённости из диалога с контент-менеджером (выполни при заполнении каждой строки):",
      "",
      dialog.join("\n\n")
    );
  } else if (!exampleReference?.trim()) {
    parts.push(
      "Заполняй контентные характеристики по названию товара, официальному сайту бренда и CSV (если передан в строке). Не оставляй выбранные поля пустыми."
    );
  }
  return parts.join("\n");
}

export function buildStrictExampleInstructions(hasExample: boolean): string {
  if (!hasExample) {
    return (
      "Заполняй профессионально по данным Metabase, названию и бренду. " +
      "Эталон не загружен — придерживайся стандартного стиля маркетплейса."
    );
  }
  return (
    "СТРОГИЙ РЕЖИМ ЭТАЛОНА:\n" +
    "- Копируй ТОЧНО формат, стиль, длину и структуру полей как в образце.\n" +
    "- Не выдумывай факты — только данные товара, Metabase и официальный сайт бренда.\n" +
    "- Тон, пунктуация, регистр, разделители — как в эталоне."
  );
}

export async function runTemplateAssistantChat(
  apiKey: string,
  messages: ChatMessage[],
  context: TemplateChatContext,
  model?: string
): Promise<ChatAssistantResult> {
  const res = await openaiFetch(openaiChatCompletionsUrl(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: model?.trim() || "gpt-4o-mini",
      temperature: 0.35,
      messages: [
        { role: "system", content: `${CHAT_SYSTEM}\n\n${buildContextBlock(context)}` },
        ...messages.map((m) => ({ role: m.role, content: m.content }))
      ],
      tools: [START_FILL_TOOL],
      tool_choice: "auto"
    })
  });

  if (!res.ok) {
    throw new Error(await readOpenAiError(res));
  }

  const data = (await res.json()) as {
    choices?: {
      message?: {
        content?: string | null;
        tool_calls?: {
          id: string;
          type: string;
          function?: { name?: string; arguments?: string };
        }[];
      };
    }[];
  };

  const message = data.choices?.[0]?.message;
  const toolCall = message?.tool_calls?.find((t) => t.function?.name === "start_template_fill");

  if (toolCall?.function?.arguments) {
    let args: { variation_ids?: unknown; strict_example?: boolean } = {};
    try {
      args = JSON.parse(toolCall.function.arguments) as typeof args;
    } catch {
      args = {};
    }

    const variationIds = parseVariationIdsFromList(args.variation_ids, 50);
    const hasExample = Boolean(context.exampleSamples?.length);
    const strictExample = args.strict_example !== false && hasExample;

    if (!context.templateFile) {
      return {
        reply:
          "Сначала загрузите Excel-шаблон на странице (кнопка «Загрузить шаблон»), затем повторите команду с ID вариаций."
      };
    }

    const action: AssistantFillAction = {
      type: "start_fill",
      variationIds: variationIds.length ? variationIds : undefined,
      strictExample
    };

    const idLine = variationIds.length
      ? `${variationIds.length} variation_id: ${variationIds.slice(0, 8).join(", ")}${variationIds.length > 8 ? "…" : ""}`
      : "текущая партия строк шаблона";

    const reply =
      message?.content?.trim() ||
      `Запускаю заполнение (${idLine}).` +
        `${hasExample && strictExample ? " Стиль — строго по эталону." : ""}` +
        " Metabase подтянет foto и данные. Excel скачается автоматически по готовности.";

    return { reply, action };
  }

  const text = String(message?.content ?? "").trim();
  return {
    reply: text || "Понял. Что ещё уточнить перед запуском?"
  };
}
