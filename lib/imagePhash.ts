import sharp from "sharp";

/** Порог Хэмминга для 64-бит average hash (чем больше — тем мягче «похоже»). */
export const DEFAULT_VISUAL_HAMMING_MAX = 13;

function popcount64(x: bigint): number {
  let n = 0;
  let v = x;
  const z = BigInt(0);
  const one = BigInt(1);
  while (v !== z) {
    n++;
    v &= v - one;
  }
  return n;
}

export function hamming64(a: bigint, b: bigint): number {
  return popcount64(a ^ b);
}

export type PhashCache = Map<string, bigint | null>;

/**
 * Average hash 8×8 по первому изображению (без пиксельного «AI», классический aHash).
 */
export async function phash64FromUrl(
  url: string,
  cache: PhashCache,
  timeoutMs = 12000
): Promise<bigint | null> {
  const u = url.trim();
  if (!u) return null;
  if (cache.has(u)) return cache.get(u)!;

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(u, {
      signal: ac.signal,
      headers: { Accept: "image/*,*/*" }
    });
    if (!res.ok) {
      cache.set(u, null);
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const { data, info } = await sharp(buf)
      .resize(8, 8, { fit: "fill" })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const ch = info.channels;
    const lum: number[] = [];
    let sum = 0;
    for (let i = 0; i < data.length; i += ch) {
      const r = data[i] ?? 0;
      const g = data[i + 1] ?? r;
      const b = data[i + 2] ?? r;
      const y = 0.299 * r + 0.587 * g + 0.114 * b;
      lum.push(y);
      sum += y;
    }
    const avg = sum / Math.max(lum.length, 1);
    let hash = BigInt(0);
    const one = BigInt(1);
    for (let i = 0; i < 64; i++) {
      if ((lum[i] ?? 0) >= avg) hash |= one << BigInt(i);
    }
    cache.set(u, hash);
    return hash;
  } catch {
    cache.set(u, null);
    return null;
  } finally {
    clearTimeout(t);
  }
}

export async function prefetchPhashes(
  urls: Iterable<string>,
  cache: PhashCache,
  batchSize = 8
): Promise<void> {
  const uniq = [...new Set([...urls].map((s) => s.trim()).filter(Boolean))];
  for (let i = 0; i < uniq.length; i += batchSize) {
    const chunk = uniq.slice(i, i + batchSize);
    await Promise.all(chunk.map((u) => phash64FromUrl(u, cache)));
  }
}

export function visualSimilarFromPhash(
  ha: bigint | null,
  hb: bigint | null,
  maxDist = DEFAULT_VISUAL_HAMMING_MAX
): boolean {
  if (ha == null || hb == null) return false;
  return hamming64(ha, hb) <= maxDist;
}
