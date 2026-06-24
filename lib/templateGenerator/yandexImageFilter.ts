import sharp from "sharp";
import { fetchPodruzhkaProductImageDetailed } from "@/lib/podruzhkaImageFetch";
import {
  dedupeAndNormalizeFotoUrls,
  fotoUrlHashKey,
  normalize4standHugeWebp
} from "@/lib/podruzhkaFotoPick";

const MIN_EDGE_PX = 480;
const MIN_BYTES = 16_000;
const PROBE_LIMIT = 10;

/** URL-паттерны миниатюр, заглушек и превью — не использовать как packshot */
export function isLowQualityImageUrl(url: string): boolean {
  const u = url.toLowerCase();
  if (!/^https?:\/\//i.test(u)) return true;
  if (
    /thumb|_small|_mini|preview|icon|placeholder|noimage|no-image|default-image|dummy|multimedia-1-s\//.test(
      u
    )
  ) {
    return true;
  }
  if (/\b(50x50|100x100|150x150|200x200|250x250)\b/.test(u)) return true;
  return false;
}

function urlResolutionScore(url: string): number {
  let s = 0;
  const u = url.toLowerCase();
  if (/\/huge\//.test(u)) s += 1200;
  if (/multimedia-1-f\//.test(u)) s += 800;
  if (/900x900/.test(u)) s += 500;
  if (/1200x|1500x|2000x/.test(u)) s += 600;
  if (/thumb|small|mini|preview|icon/.test(u)) s -= 900;
  if (/multimedia-1-s\//.test(u)) s -= 400;
  return s;
}

/**
 * Оставить только качественные packshot URL: без заглушек и мелких дублей.
 * При нескольких фото одного товара — приоритет крупному (по пикселям/байтам).
 */
export async function filterYandexProductImageUrls(urls: string[]): Promise<string[]> {
  const candidates = dedupeAndNormalizeFotoUrls(
    urls.map((u) => normalize4standHugeWebp(u.trim())).filter((u) => !isLowQualityImageUrl(u))
  );
  if (!candidates.length) return [];

  candidates.sort((a, b) => urlResolutionScore(b) - urlResolutionScore(a));

  const probed: { url: string; pixels: number; bytes: number; key: string }[] = [];

  await Promise.all(
    candidates.slice(0, PROBE_LIMIT).map(async (raw) => {
      const url = normalize4standHugeWebp(raw);
      try {
        const fetched = await fetchPodruzhkaProductImageDetailed(url);
        const buf = fetched.buf;
        if (!buf?.length || buf.length < MIN_BYTES) return;

        const meta = await sharp(buf).metadata();
        const w = meta.width ?? 0;
        const h = meta.height ?? 0;
        if (w < MIN_EDGE_PX || h < MIN_EDGE_PX) return;

        const finalUrl = url;
        probed.push({
          url: finalUrl,
          pixels: w * h,
          bytes: buf.length,
          key: fotoUrlHashKey(normalize4standHugeWebp(finalUrl))
        });
      } catch {
        /* skip broken source */
      }
    })
  );

  if (!probed.length) {
    return candidates.slice(0, 1);
  }

  probed.sort((a, b) => b.pixels - a.pixels || b.bytes - a.bytes);

  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of probed) {
    if (seen.has(item.key)) continue;
    seen.add(item.key);
    out.push(item.url);
  }
  return out;
}
