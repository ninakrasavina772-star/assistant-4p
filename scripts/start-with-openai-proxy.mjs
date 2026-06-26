/** Boot Next standalone server with optional OpenAI HTTP proxy (runtime only, not webpack). */
const proxy = (
  process.env.OPENAI_HTTP_PROXY ??
  process.env.HTTPS_PROXY ??
  process.env.HTTP_PROXY ??
  ""
).trim();

if (proxy) {
  process.env.HTTP_PROXY = proxy;
  process.env.HTTPS_PROXY = proxy;
  const { ProxyAgent, setGlobalDispatcher } = await import("undici");
  setGlobalDispatcher(new ProxyAgent(proxy));
}

await import("./server.js");
