export type ChatRole = "user" | "assistant";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  at: number;
};

export type TemplateChatContext = {
  templateFile?: string;
  sheetName?: string;
  rowCount?: number;
  csvLabel?: string;
  csvRowCount?: number;
  skuColumn?: string;
  selectedColumns?: string[];
  enabledColCount?: number;
  photoEnabled?: boolean;
  photoMin?: number;
  photoTarget?: number;
};

const CHAT_SYSTEM = `Ты ассистент «Генератор шаблонов» для контент-отдела маркетплейса Ozon.

Твоя роль:
- Общаться с контент-менеджером на русском, кратко и по делу.
- Запоминать ВСЕ указания из диалога — они станут заданием при массовом заполнении Excel.
- Когда загружают файлы — подтверди что получил, перечисли факты (вкладка, строки, CSV) и спроси что делать дальше.
- Подсказывай: ниже на странице — таблица столбцов с галочками и кнопка «Запустить AI для всех строк».
- Не выдумывай что заполнение уже запущено — запуск только по кнопке пользователя.
- Можешь рекомендовать какие столбцы включить (описание, ноты, тип, пол и т.д.), стиль текста, проверку по официальному сайту бренда.
- Не проси прислать файлы повторно, если в контексте они уже есть.

Отвечай обычным текстом, без JSON.`;

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
    content:
      "Привет! Загрузите Excel-шаблон Ozon (.xlsx) — CSV не обязателен. Напишите, какие столбцы заполнять; я запомню до конца сессии."
  };
}

export function buildContextBlock(ctx: TemplateChatContext): string {
  const lines: string[] = ["Текущее состояние сессии:"];
  if (ctx.templateFile) {
    lines.push(
      `- Шаблон Excel: «${ctx.templateFile}»`,
      `  Вкладка: ${ctx.sheetName ?? "?"}`,
      `  Строк товаров: ${ctx.rowCount ?? "?"}`,
      `  Отмечено столбцов для генерации: ${ctx.enabledColCount ?? "?"}`
    );
  } else {
    lines.push("- Шаблон Excel: ещё не загружен");
  }
  if (ctx.csvLabel) {
    lines.push(
      `- CSV: ${ctx.csvLabel}`,
      `  Строк в фиде: ${ctx.csvRowCount ?? "?"}`,
      `  Колонка SKU: ${ctx.skuColumn ?? "?"}`
    );
  } else {
    lines.push("- CSV: не прикреплён");
  }
  if (ctx.selectedColumns?.length) {
    lines.push(`- Выбранные столбцы: ${ctx.selectedColumns.slice(0, 25).join("; ")}`);
  }
  if (ctx.photoEnabled) {
    lines.push(`- Доп. фото: да, минимум ${ctx.photoMin}, цель ${ctx.photoTarget}`);
  }
  return lines.join("\n");
}

export function buildFillPromptFromChat(messages: ChatMessage[]): string {
  const dialog = messages
    .filter((m) => m.content.trim())
    .map((m) => (m.role === "user" ? `Контент-менеджер: ${m.content}` : `Ассистент: ${m.content}`));
  if (!dialog.length) {
    return "Заполняй контентные характеристики по данным CSV и официальному сайту бренда.";
  }
  return [
    "Договорённости из диалога с контент-менеджером (выполни при заполнении каждой строки):",
    "",
    dialog.join("\n\n")
  ].join("\n");
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
