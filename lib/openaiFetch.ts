/** OpenAI HTTP helpers. Прокси только для запросов к OpenAI, не для foto/CDN. */

type UndiciModule = typeof import("undici");

let proxyAgentPromise: Promise<InstanceType<UndiciModule["ProxyAgent"]> | null> | null =
  null;

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

async function getOpenAiProxyAgent(): Promise<InstanceType<UndiciModule["ProxyAgent"]> | null> {
  const proxy = openaiHttpProxy();
  if (!proxy) return null;
  if (!proxyAgentPromise) {
    proxyAgentPromise = (async () => {
      const { ProxyAgent } = await import("undici");
      return new ProxyAgent(proxy);
    })();
  }
  return proxyAgentPromise;
}

/** Server fetch to OpenAI через прокси; остальные fetch в приложении — напрямую. */
export async function openaiFetch(url: string, init?: RequestInit): Promise<Response> {
  const agent = await getOpenAiProxyAgent();
  if (!agent) return fetch(url, init);
  const { fetch: undiciFetch } = await import("undici");
  return undiciFetch(url, { ...init, dispatcher: agent } as RequestInit);
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
