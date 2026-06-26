/** OpenAI HTTP helpers: optional proxy base URL for servers in blocked regions. */
export function openaiApiBase(): string {
  const raw = (process.env.OPENAI_BASE_URL ?? process.env.OPENAI_API_BASE ?? "https://api.openai.com").trim();
  return raw.replace(/\/+$/, "");
}

export function openaiChatCompletionsUrl(): string {
  return `${openaiApiBase()}/v1/chat/completions`;
}

export function openaiImagesUrl(): string {
  return `${openaiApiBase()}/v1/images/generations`;
}

export function formatOpenAiError(raw: string, status?: number): string {
  const text = raw.trim();
  if (!text) return status ? `OpenAI HTTP ${status}` : "Ошибка OpenAI";

  try {
    const j = JSON.parse(text) as {
      error?: { code?: string; message?: string; type?: string };
    };
    const code = j.error?.code ?? j.error?.type;
    const msg = j.error?.message?.trim();
    if (code === "unsupported_country_region_territory") {
      return (
        "OpenAI блокирует запросы с российского сервера (unsupported_country_region_territory). " +
        "AI-заполнение не работает, пока на сервере не настроен OPENAI_BASE_URL — URL прокси к api.openai.com " +
        "(зарубежный VPS, Cloudflare Worker и т.п.)."
      );
    }
    if (msg) return msg;
  } catch {
    /* not json */
  }

  if (text.includes("unsupported_country_region_territory")) {
    return (
      "OpenAI блокирует запросы с российского сервера. " +
      "Настройте OPENAI_BASE_URL на сервере (прокси к api.openai.com)."
    );
  }

  return text.length > 280 ? `${text.slice(0, 280)}…` : text;
}

export async function readOpenAiError(res: Response): Promise<string> {
  const t = await res.text();
  return formatOpenAiError(t, res.status);
}
