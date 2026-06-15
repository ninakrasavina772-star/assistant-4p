/** Угадываем домен бренда для приоритетного поиска */
export function guessBrandDomain(brand: string): string | null {
  const b = brand
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  if (!b || b.length < 2) return null;
  return `https://www.${b}.com`;
}

export async function fetchPageTextSnippet(url: string, maxChars = 4000): Promise<string> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; Assistant4P/1.0)" }
    });
    clearTimeout(t);
    if (!res.ok) return "";
    const html = await res.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return text.slice(0, maxChars);
  } catch {
    return "";
  }
}
