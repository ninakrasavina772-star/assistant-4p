/** Серверный или клиентский OpenAI key — как в Letual main photo */
export function resolveOpenAiKey(clientKey?: string): string {
  const k = (clientKey ?? "").trim() || (process.env.OPENAI_API_KEY ?? "").trim();
  if (!k) {
    throw new Error(
      "Нужен OpenAI API key: введите в форме или задайте OPENAI_API_KEY на сервере (Vercel / .env.local)"
    );
  }
  return k;
}

export function openaiIsConfigured(clientKey?: string): boolean {
  try {
    resolveOpenAiKey(clientKey);
    return true;
  } catch {
    return false;
  }
}
