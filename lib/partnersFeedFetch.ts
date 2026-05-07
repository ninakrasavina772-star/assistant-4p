const MAX_FEED_BYTES = 25 * 1024 * 1024;

/**
 * Только https на доменах 4Partners (как публичные фиды my/feed/*.csv).
 */
export function assertSafePartnersFeedUrl(urlStr: string): URL {
  let u: URL;
  try {
    u = new URL(urlStr.trim());
  } catch {
    throw new Error("Некорректная ссылка на фид");
  }
  if (u.protocol !== "https:") {
    throw new Error("Разрешён только https");
  }
  const h = u.hostname.toLowerCase();
  if (
    h === "localhost" ||
    h.endsWith(".localhost") ||
    h.startsWith("127.") ||
    h === "0.0.0.0"
  ) {
    throw new Error("Запрещённый хост");
  }
  const ok =
    h === "4partners.io" ||
    h.endsWith(".4partners.io");
  if (!ok) {
    throw new Error(
      "Разрешены только URL на домене 4partners.io (например *.4partners.io/my/feed/…)"
    );
  }
  return u;
}

export async function fetchPartnersFeedText(urlStr: string): Promise<string> {
  const u = assertSafePartnersFeedUrl(urlStr);
  const res = await fetch(u.toString(), {
    headers: { "User-Agent": "rubric-compare/feed" },
    cache: "no-store",
    redirect: "follow"
  });
  if (!res.ok) {
    throw new Error(`Не удалось скачать фид: HTTP ${res.status}`);
  }
  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_FEED_BYTES) {
    throw new Error(
      `Фид больше ${Math.round(MAX_FEED_BYTES / (1024 * 1024))} МБ — сузьте выгрузку или загрузите файл`
    );
  }
  return new TextDecoder("utf-8").decode(buf);
}
