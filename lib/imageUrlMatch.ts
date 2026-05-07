/**
 * Сопоставление «одной и той же» картинки в фиде без загрузки файлов:
 * нормализация URL и совпадение path+query (в т.ч. с разных CDN-хостов).
 * Пиксели не сравниваются — только структура ссылки.
 */

const NOISE_QUERY_KEYS = new Set([
  "w",
  "h",
  "width",
  "height",
  "q",
  "quality",
  "fmt",
  "format",
  "resize",
  "fit",
  "crop",
  "mode",
  "blur",
  "sharp",
  "auto"
]);

function stripWwwHost(host: string): string {
  const h = host.toLowerCase();
  return h.startsWith("www.") ? h.slice(4) : h;
}

/** Path + отфильтрованный query для сравнения «одного ресурса» с разных зеркал. */
function pathAndQueryKey(u: URL): string {
  let path = u.pathname || "/";
  try {
    path = decodeURIComponent(path);
  } catch {
    // keep raw
  }
  if (path.length > 1 && path.endsWith("/")) {
    path = path.slice(0, -1);
  }
  const sp = new URLSearchParams(u.search);
  const pairs: string[] = [];
  for (const [k, v] of sp.entries()) {
    if (NOISE_QUERY_KEYS.has(k.toLowerCase())) continue;
    pairs.push(`${k.toLowerCase()}=${v}`);
  }
  pairs.sort();
  const q = pairs.length ? `?${pairs.join("&")}` : "";
  return `${path}${q}`;
}

function normalizedFullUrl(u: URL): string {
  const proto = u.protocol.toLowerCase();
  const host = stripWwwHost(u.hostname);
  const port = u.port ? `:${u.port}` : "";
  return `${proto}//${host}${port}${pathAndQueryKey(u)}`;
}

/**
 * true, если обе непустые и с высокой вероятностью указывают на тот же ассет в фиде.
 */
export function firstImageRefEquivalent(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  const sa = (a ?? "").trim();
  const sb = (b ?? "").trim();
  if (!sa || !sb) return false;
  if (sa === sb) return true;

  try {
    const ua = new URL(sa);
    const ub = new URL(sb);
    if (normalizedFullUrl(ua) === normalizedFullUrl(ub)) return true;
    return pathAndQueryKey(ua) === pathAndQueryKey(ub);
  } catch {
    return sa.toLowerCase() === sb.toLowerCase();
  }
}
