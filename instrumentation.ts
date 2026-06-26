export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const proxy = (
    process.env.OPENAI_HTTP_PROXY ??
    process.env.HTTPS_PROXY ??
    process.env.HTTP_PROXY ??
    ""
  ).trim();

  if (!proxy) return;

  const { ProxyAgent, setGlobalDispatcher } = await import("undici");
  setGlobalDispatcher(new ProxyAgent(proxy));
}
