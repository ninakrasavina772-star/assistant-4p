import type { PodruzhkaRenderProfile } from "@/lib/podruzhkaCosmeticsLayout";

/** Несколько URL в одной ячейке CSV/Excel (пробел, перевод строки, запятая). */
export function parseFotoUrlsFromText(text: string): string[] {
  const raw = text.trim();
  if (!raw) return [];
  const urls = [...raw.matchAll(/https?:\/\/[^\s,;<>"]+/gi)].map((m) =>
    m[0]!.replace(/[),.;]+$/g, "")
  );
  return [...new Set(urls.filter(Boolean))];
}

/** Собрать CDN URL из image_load_hash / url_hash (hex 40+ символов). */
export function build4standCdnUrlFromHash(hash: string): string | null {
  const h = hash.trim().toLowerCase();
  if (!/^[0-9a-f]{40,}$/.test(h)) return null;
  return `https://cdnru.4stand.com/huge/${h.slice(0, 2)}/${h.slice(2, 4)}/${h}.webp`;
}

/** 900x900 jpg → huge webp (тот же hash на CDN 4stand). */
export function normalize4standHugeWebp(url: string): string {
  const m = url.match(
    /^(https?:\/\/cdnru\.4stand\.com)\/(?:900x900|huge)\/([0-9a-f]{2})\/([0-9a-f]{2})\/([0-9a-f]+)\.(webp|jpe?g|png)(\?.*)?$/i
  );
  if (!m) return url;
  return `${m[1]}/huge/${m[2]}/${m[3]}/${m[4]}.webp`;
}

export function extractFotoContentHash(url: string): string | null {
  const norm = normalize4standHugeWebp(url.trim());
  const m40 = norm.match(/\/([0-9a-f]{2})\/([0-9a-f]{2})\/([0-9a-f]{40})(?:\.|$|\?)/i);
  if (m40) return m40[3]!.toLowerCase();
  const m32upload = norm.match(/\/uploads\/images\/[0-9a-f]{2}\/[0-9a-f]{2}\/([0-9a-f]{32})(?:\.|$|\?)/i);
  if (m32upload) return m32upload[1]!.toLowerCase();
  const m32 = norm.match(/\/([0-9a-f]{32})\.(?:webp|jpe?g|png)(?:\?|$)/i);
  if (m32) return m32[1]!.toLowerCase();
  return null;
}

/** Ключ файла на CDN: 32-символьный префикс hash (cdnru huge ↔ api.4stand uploads). */
export function fotoUrlHashKey(url: string): string {
  const content = extractFotoContentHash(url);
  if (content) return content.slice(0, 32);
  const m = url.match(/\/([0-9a-f]{2})\/([0-9a-f]{2})\/([0-9a-f]{40,})/i);
  return m ? `${m[1]}/${m[2]}/${m[3]}` : url;
}

/** Ссылки на уже сгенерированную инфографику — не источник foto. */
export function isGeneratedInfographicFotoUrl(url: string): boolean {
  const u = url.toLowerCase();
  return (
    /storage\.yandexcloud\.net\/assistant/i.test(u) ||
    /\/ozon-images\//i.test(u) ||
    /podruzhka-[a-f0-9]+\.(?:jpg|png|webp)/i.test(u)
  );
}

export function dedupeAndNormalizeFotoUrls(urls: string[]): string[] {
  const byKey = new Map<string, string>();
  for (const raw of urls) {
    const t = raw.trim();
    if (!/^https?:\/\//i.test(t)) continue;
    if (isGeneratedInfographicFotoUrl(t)) continue;
    const norm = normalize4standHugeWebp(t);
    const key = fotoUrlHashKey(norm);
    if (!byKey.has(key)) byKey.set(key, norm);
  }
  const list = [...byKey.values()];
  if (list.length) return list;
  // fallback: если только «выходные» URL — оставляем как есть
  for (const raw of urls) {
    const t = raw.trim();
    if (!/^https?:\/\//i.test(t)) continue;
    const norm = normalize4standHugeWebp(t);
    const key = fotoUrlHashKey(norm);
    if (!byKey.has(key)) byKey.set(key, norm);
  }
  return [...byKey.values()];
}

function scorePerfumeFotoUrl(url: string): number {
  const u = url.toLowerCase();
  let score = 20;
  if (/\/huge\//.test(u)) score += 30;
  if (/4stand\.com|4partners/i.test(u)) score += 8;
  if (/\.webp(?:\?|$)/.test(u)) score += 10;
  if (/\.(?:jpg|jpeg|png)(?:\?|$)/.test(u)) score += 3;
  if (/\/(?:thumb|small|mini|icon|preview)\//.test(u)) score -= 50;
  if (/thumb|_small|_mini|_icon|preview|lifestyle|model|banner/i.test(u)) score -= 20;
  return score;
}

function scoreCosmeticsFotoUrl(url: string, index: number): number {
  const u = url.toLowerCase();
  let score = 40;
  if (/\/huge\//.test(u)) score += 30;
  if (/4stand\.com|4partners/i.test(u)) score += 8;
  if (/thumb|small|mini|icon|preview/i.test(u)) score -= 35;
  if (index === 0) score += 3;
  return score;
}

/** Быстрый выбор по URL (без загрузки картинки). */
export function pickBestFotoUrl(
  urls: string[],
  profile: PodruzhkaRenderProfile = "perfume"
): string {
  const list = dedupeAndNormalizeFotoUrls(urls);
  if (!list.length) return "";
  if (list.length === 1) return list[0]!;

  if (profile === "cosmetics") {
    let best = list[0]!;
    let bestScore = -Infinity;
    for (let i = 0; i < list.length; i++) {
      const score = scoreCosmeticsFotoUrl(list[i]!, i);
      if (score > bestScore) {
        bestScore = score;
        best = list[i]!;
      }
    }
    return best;
  }

  let best = list[0]!;
  let bestScore = -Infinity;
  for (const url of list) {
    const score = scorePerfumeFotoUrl(url);
    if (score > bestScore) {
      bestScore = score;
      best = url;
    }
  }
  return best;
}

/** Парфюм: визуальный выбор через API (duo на белом → один флакон). */
export async function pickBestPerfumeFotoAsync(urls: string[]): Promise<string> {
  const list = dedupeAndNormalizeFotoUrls(urls);
  if (!list.length) return "";
  if (list.length === 1) return list[0]!;

  try {
    const res = await fetch("/api/podruzhka/foto/pick", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ urls: list })
    });
    const data = (await res.json()) as { url?: string; error?: string };
    if (res.ok && data.url) return data.url;
  } catch {
    /* fallback */
  }

  return pickBestFotoUrl(list, "perfume");
}
