/** Boot Next standalone server. OpenAI proxy — только в openaiFetch, не глобально. */
const proxy = (
  process.env.OPENAI_HTTP_PROXY ??
  process.env.HTTPS_PROXY ??
  process.env.HTTP_PROXY ??
  ""
).trim();

if (proxy) {
  console.log("[openai-proxy] configured (per-request OpenAI only):", proxy);
}

await import("./server.js");
