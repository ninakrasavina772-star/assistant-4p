import type { CsvColumnMap, TemplateWorkMode } from "@/lib/templateGenerator/types";
import type { CsvTable } from "@/lib/templateGenerator/csvIndex";

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
  photoMin?: number;
  photoTarget?: number;
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
};

const CHAT_SYSTEM = `Ты ассистент «Генератор шаблонов» для контент-отдела (любая витрина: Ozon, Яндекс Маркет, Wildberries и др.).

ЗАЧЕМ ТЫ НУЖЕН:
- Ты НЕ заполняешь Excel сам — это кнопка «Запустить AI» на странице.
- Два сценария:
  1) «Дополнить» — в шаблоне уже есть товары и часть полей; заполняем только пустое (фид → AI для пробелов).
  2) «С нуля» — шаблон витрины + фид; сопоставляешь колонки, задаёшь правила (язык названия, стиль нот и т.д.), затем массовое заполнение.
- Всё, что пользователь напишет или продиктует — станет заданием для AI на каждой строке.

ВАЖНО — данные в контексте ниже:
- Если есть примеры товаров — НЕ проси бренд/SKU заново.
- Если фид включён — подскажи сопоставление колонок фида и шаблона.
- Если фид выключен — допустимо только AI по названию и бренду.
- Если есть «Эталон заполнения» — ориентируйся на стиль и формат образца.
- Если пользователь просит проверить сопоставление — перечисли неясные поля и задай конкретные вопросы ДО запуска.

Твоя роль:
- Русский язык, кратко. Порядок: шаблон → (фид) → режим → столбцы → задание в чате → запуск партиями.
- Помогай с правилами полей: «название на русском», «ноты кратко», «описание до N символов».
- Напоминай про галочки столбцов и партии по ~50 строк.
- Не выдумывай, что заполнение уже идёт.

Отвечай обычным текстом, без JSON.`;

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
• Помогаю спланировать заполнение ДО кнопки «Запустить AI».
• Запоминаю ваши правила — они уйдут в задание для AI на каждой строке.
• Можно писать или нажать 🎤 и продиктовать (например: «название на русском, ноты кратко»).

Два режима работы:
1. Дополнить — шаблон уже с товарами, часть полей заполнена. Берём фид где есть, пустое добиваем AI. Готовые ячейки не трогаем.
2. С нуля — шаблон витрины + фид. Сопоставляем колонки, вы задаёте правила в чате, заполняем товары из фида.

Как начать:
1. Загрузите Excel-шаблон витрины.
2. При необходимости включите фид и загрузите CSV.
3. Выберите режим и опишите правила в чате.
4. Отметьте столбцы → запуск партиями по ~50 строк.

Я не заполняю файл сам — только консультирую. С чего начнём?`
  };
}

export function buildContextBlock(ctx: TemplateChatContext): string {
  const lines: string[] = ["=== КОНТЕКСТ ЗАГРУЖЕННЫХ ФАЙЛОВ (используй при ответе) ==="];

  if (ctx.templateFile) {
    lines.push(
      "",
      `Шаблон Excel: «${ctx.templateFile}»`,
      `Вкладка: ${ctx.sheetName ?? "?"}`,
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

  if (ctx.photoEnabled) {
    const mode =
      ctx.photoStyle === "gradient"
        ? "градиенты"
        : "lifestyle в тему (OpenAI Images)";
    lines.push(`Фото: цель ${ctx.photoTarget}, мин ${ctx.photoMin}, режим ${mode}`);
  }

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

export async function runTemplateAssistantChat(
  apiKey: string,
  messages: ChatMessage[],
  context: TemplateChatContext,
  model?: string
): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: model?.trim() || "gpt-4o-mini",
      temperature: 0.4,
      messages: [
        { role: "system", content: `${CHAT_SYSTEM}\n\n${buildContextBlock(context)}` },
        ...messages.map((m) => ({ role: m.role, content: m.content }))
      ]
    })
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(t.slice(0, 280) || `OpenAI HTTP ${res.status}`);
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return String(data.choices?.[0]?.message?.content ?? "").trim() || "Понял. Что ещё уточнить перед запуском?";
}
