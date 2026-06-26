/** OpenAI HTTP helpers + proxy env detection (proxy applied in instrumentation.ts). */
export function openaiApiBase(): string {
  const raw = (process.env.OPENAI_BASE_URL ?? process.env.OPENAI_API_BASE ?? "https://api.openai.com").trim();
  return raw.replace(/\/+$/, "");
}

export function openaiHttpProxy(): string | undefined {
  const raw = (
    process.env.OPENAI_HTTP_PROXY ??
    process.env.HTTPS_PROXY ??
    process.env.HTTP_PROXY ??
    ""
  ).trim();
  return raw || undefined;
}

export function openaiUsesProxy(): boolean {
  return openaiApiBase() !== "https://api.openai.com" || Boolean(openaiHttpProxy());
}

export function openaiChatCompletionsUrl(): string {
  return `${openaiApiBase()}/v1/chat/completions`;
}

export function openaiImagesUrl(): string {
  return `${openaiApiBase()}/v1/images/generations`;
}

/** Server fetch to OpenAI (global HTTP proxy when OPENAI_HTTP_PROXY is set). */
export function openaiFetch(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, init);
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
        "OpenAI блокирует запросы с российского сервера (unsupported_country_region_territory). "
        + "Настройте OPENAI_HTTP_PROXY или OPENAI_BASE_URL на сервере."
      );
    }
    if (msg) return msg;
  } catch {
    /* not json */
  }

  if (text.includes("unsupported_country_region_territory")) {
    return (
      "OpenAI блокирует запросы с российского сервера. "
      + "Настройте OPENAI_HTTP_PROXY или OPENAI_BASE_URL на сервере."
    );
  }

  return text.length > 280 ? `${text.slice(0, 280)}…` : text;
}

export async function readOpenAiError(res: Response): Promise<string> {
  const t = await res.text();
  return formatOpenAiError(t, res.status);
}
