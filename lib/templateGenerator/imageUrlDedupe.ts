import {
  dedupeAndNormalizeFotoUrls,
  fotoUrlHashKey,
  normalize4standHugeWebp
} from "@/lib/podruzhkaFotoPick";

/** Уже загруженные нами фото — не гонять через cutout повторно */
export function isYandexProcessedStorageUrl(url: string): boolean {
  const u = url.toLowerCase();
  return (
    /template-generator\/yandex\//i.test(u) ||
    /\/ym-[^/]+\.jpg(?:\?|$)/i.test(u) ||
    /storage\.yandexcloud\.net.*template-generator/i.test(u)
  );
}

/** Ключ одного и того же файла (hash CDN, путь без query) */
export function imageUrlIdentityKey(url: string): string {
  const t = url.trim();
  if (!t) return "";
  const norm = normalize4standHugeWebp(t);
  const hashKey = fotoUrlHashKey(norm);
  if (hashKey !== norm) return `4stand:${hashKey}`;
  try {
    const u = new URL(norm);
    return `url:${u.hostname.toLowerCase()}${u.pathname.toLowerCase()}`;
  } catch {
    return `raw:${norm.toLowerCase()}`;
  }
}

/** Семантическая дедупликация: 900x900 и /huge/ с одним hash → одна ссылка */
export function dedupeImageUrlsSemantic(urls: string[]): string[] {
  const normalized = dedupeAndNormalizeFotoUrls(urls);
  const byKey = new Map<string, string>();

  for (const raw of urls) {
    const t = raw.trim();
    if (!/^https?:\/\//i.test(t)) continue;
    const key = imageUrlIdentityKey(t);
    if (!byKey.has(key)) {
      const prefer =
        normalized.find((n) => imageUrlIdentityKey(n) === key) ??
        normalize4standHugeWebp(t);
      byKey.set(key, prefer);
    }
  }

  for (const n of normalized) {
    const key = imageUrlIdentityKey(n);
    if (!byKey.has(key)) byKey.set(key, n);
  }

  return [...byKey.values()];
}

/** Финальный список для ячейки — без повторов по identity */
export function uniqueUrlsForImageCell(urls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of urls) {
    const t = u.trim();
    if (!t) continue;
    const key = imageUrlIdentityKey(t);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}
