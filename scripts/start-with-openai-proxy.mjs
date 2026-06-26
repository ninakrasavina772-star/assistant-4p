/** Boot Next standalone server with optional OpenAI HTTP proxy (runtime only). */
const proxy = (
  process.env.OPENAI_HTTP_PROXY ??
  process.env.HTTPS_PROXY ??
  process.env.HTTP_PROXY ??
  ""
).trim();

if (proxy) {
  try {
    process.env.HTTP_PROXY = proxy;
    process.env.HTTPS_PROXY = proxy;
    const { ProxyAgent, setGlobalDispatcher } = await import("undici");
    setGlobalDispatcher(new ProxyAgent(proxy));
    console.log("[openai-proxy] enabled:", proxy);
  } catch (e) {
    console.error("[openai-proxy] setup failed, starting without proxy:", e);
  }
}

await import("./server.js");
