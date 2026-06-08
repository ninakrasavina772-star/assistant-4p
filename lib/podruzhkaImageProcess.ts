import sharp from "sharp";
import { PODRUZHKA_REFERENCE as R } from "@/lib/podruzhkaReferenceSpec";
import type { PodruzhkaRenderProfile } from "@/lib/podruzhkaCosmeticsLayout";

/** Мин. длинная сторона исходника перед cut-out (Ozon часто отдаёт 600×800). */
const PRODUCT_SOURCE_MIN_LONG_EDGE = 1400;
const PRODUCT_UPSCALE_SHARPEN = { sigma: 0.38, m1: 0.42, m2: 0.16 } as const;

/**
 * Убирает только белый фон, связанный с краями кадра (типичный JPEG с Ozon).
 * Белые детали внутри товара (светлая коробка) не трогаем.
 */
export async function stripEdgeNearWhiteBackground(
  input: Buffer,
  threshold = 242
): Promise<Buffer> {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const w = info.width;
  const h = info.height;
  if (!w || !h) return input;

  const pixels = Buffer.from(data);
  const visited = new Uint8Array(w * h);
  const queue: number[] = [];

  const nearWhiteAt = (pi: number): boolean => {
    const r = pixels[pi]!;
    const g = pixels[pi + 1]!;
    const b = pixels[pi + 2]!;
    const avg = (r + g + b) / 3;
    const spread = Math.max(r, g, b) - Math.min(r, g, b);
    return avg >= threshold && spread <= 28;
  };

  const tryPush = (idx: number) => {
    if (idx < 0 || idx >= w * h || visited[idx]) return;
    if (!nearWhiteAt(idx * 4)) return;
    queue.push(idx);
  };

  for (let x = 0; x < w; x++) {
    tryPush(x);
    tryPush((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    tryPush(y * w);
    tryPush(y * w + (w - 1));
  }

  while (queue.length) {
    const idx = queue.pop()!;
    if (visited[idx]) continue;
    visited[idx] = 1;
    const pi = idx * 4;
    if (!nearWhiteAt(pi)) continue;
    pixels[pi + 3] = 0;
    const x = idx % w;
    const y = (idx - x) / w;
    if (x > 0) tryPush(idx - 1);
    if (x < w - 1) tryPush(idx + 1);
    if (y > 0) tryPush(idx - w);
    if (y < h - 1) tryPush(idx + w);
  }

  return sharp(pixels, {
    raw: { width: w, height: h, channels: 4 }
  })
    .png()
    .toBuffer();
}

/** Белый фон с краёв: не заходим в тёплые/бежевые края товара (r−b). */
export async function stripProductEdgeBackground(input: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const w = info.width;
  const h = info.height;
  if (!w || !h) return input;

  const pixels = Buffer.from(data);
  const visited = new Uint8Array(w * h);
  const queue: number[] = [];

  const isBackgroundWhite = (pi: number): boolean => {
    const r = pixels[pi]!;
    const g = pixels[pi + 1]!;
    const b = pixels[pi + 2]!;
    const avg = (r + g + b) / 3;
    const spread = Math.max(r, g, b) - Math.min(r, g, b);
    const warmth = r - b;
    if (avg < 251 || spread > 18) return false;
    if (warmth > 9) return false;
    if (warmth > 5 && avg < 249) return false;
    return true;
  };

  const tryPush = (idx: number) => {
    if (idx < 0 || idx >= w * h || visited[idx]) return;
    if (!isBackgroundWhite(idx * 4)) return;
    queue.push(idx);
  };

  for (let x = 0; x < w; x++) {
    tryPush(x);
    tryPush((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    tryPush(y * w);
    tryPush(y * w + (w - 1));
  }

  while (queue.length) {
    const idx = queue.pop()!;
    if (visited[idx]) continue;
    visited[idx] = 1;
    const pi = idx * 4;
    if (!isBackgroundWhite(pi)) continue;
    pixels[pi + 3] = 0;
    const x = idx % w;
    const y = (idx - x) / w;
    if (x > 0) tryPush(idx - 1);
    if (x < w - 1) tryPush(idx + 1);
    if (y > 0) tryPush(idx - w);
    if (y < h - 1) tryPush(idx + w);
  }

  return sharp(pixels, {
    raw: { width: w, height: h, channels: 4 }
  })
    .png()
    .toBuffer();
}

/** @deprecated alias */
export const stripCosmeticsEdgeBackground = stripProductEdgeBackground;

export async function stripNearWhiteBackground(
  input: Buffer,
  threshold = 238
): Promise<Buffer> {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixels = Buffer.from(data);
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i]!;
    const g = pixels[i + 1]!;
    const b = pixels[i + 2]!;
    const avg = (r + g + b) / 3;
    const spread = Math.max(r, g, b) - Math.min(r, g, b);
    if (avg >= threshold && spread <= 28) {
      pixels[i + 3] = 0;
    }
  }

  return sharp(pixels, {
    raw: { width: info.width, height: info.height, channels: 4 }
  })
    .png()
    .toBuffer();
}

/** Обрезка до bbox непрозрачного товара (белая коробка Dior и т.п. сохраняется). */
export async function cropToVisibleProduct(
  input: Buffer,
  alphaThreshold = 14,
  padRatio = 0.015
): Promise<Buffer> {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const w = info.width;
  const h = info.height;
  if (!w || !h) return input;

  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = data[(y * w + x) * 4 + 3]!;
      if (a < alphaThreshold) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (maxX < minX || maxY < minY) return input;

  const padX = Math.max(3, Math.round((maxX - minX + 1) * padRatio));
  const padY = Math.max(3, Math.round((maxY - minY + 1) * padRatio));
  const left = Math.max(0, minX - padX);
  const top = Math.max(0, minY - padY);
  const width = Math.min(w - left, maxX - minX + 1 + padX * 2);
  const height = Math.min(h - top, maxY - minY + 1 + padY * 2);

  if (width < 8 || height < 8) return input;

  return sharp(input)
    .extract({ left, top, width, height })
    .png()
    .toBuffer();
}

async function trimTransparentSafe(input: Buffer): Promise<Buffer> {
  const before = await sharp(input).metadata();
  const origW = before.width ?? 1;
  const origH = before.height ?? 1;
  const origArea = origW * origH;
  const origAspect = origW / origH;

  try {
    const trimmed = await sharp(input).trim({ threshold: 8 }).png().toBuffer();
    const after = await sharp(trimmed).metadata();
    const newW = after.width ?? 1;
    const newH = after.height ?? 1;
    const newArea = newW * newH;
    const newAspect = newW / newH;

    if (newArea < origArea * 0.4) return input;
    if (Math.abs(Math.log(origAspect / newAspect)) > 0.45) return input;
    if (newW < origW * 0.45 || newH < origH * 0.45) return input;

    return trimmed;
  } catch {
    return input;
  }
}

/** Убрать серую contact-тень под товаром (низ кадра, нейтральный серый). */
export async function stripGrayFloorShadow(input: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const w = info.width;
  const h = info.height;
  if (!w || !h) return input;

  const pixels = Buffer.from(data);
  const shadowStart = Math.floor(h * 0.58);

  for (let y = shadowStart; y < h; y++) {
    const rowWeight = (y - shadowStart) / Math.max(1, h - shadowStart);
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const a = pixels[i + 3]!;
      if (a < 8) continue;
      const r = pixels[i]!;
      const g = pixels[i + 1]!;
      const b = pixels[i + 2]!;
      const avg = (r + g + b) / 3;
      const spread = Math.max(r, g, b) - Math.min(r, g, b);
      if (spread >= 36) continue;
      // Нейтральная серая тень (сильнее к низу кадра)
      if (avg >= 78 && avg <= 228 && (rowWeight > 0.08 || avg >= 100)) {
        pixels[i + 3] = 0;
      }
    }
  }

  return sharp(pixels, {
    raw: { width: w, height: h, channels: 4 }
  })
    .png()
    .toBuffer();
}

/** Убрать белый/серый ореол по краям cut-out (Acqua di Parma, стекло). */
export async function cleanProductAlphaFringe(input: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const w = info.width;
  const h = info.height;
  if (!w || !h) return input;

  const pixels = Buffer.from(data);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const a = pixels[i + 3]!;
      if (a === 0 || a === 255) continue;

      const r = pixels[i]!;
      const g = pixels[i + 1]!;
      const b = pixels[i + 2]!;
      const avg = (r + g + b) / 3;
      const spread = Math.max(r, g, b) - Math.min(r, g, b);

      if (avg >= 205 && spread <= 40) {
        pixels[i + 3] = 0;
        continue;
      }

      // Полупрозрачная серая/белая contact-тень и ореол cut-out — убираем
      if (a < 248 && spread <= 38 && avg >= 78) {
        pixels[i + 3] = 0;
        continue;
      }

      // Тёмные края товара — оставляем непрозрачными; светлый полупрозрачный ореол не «заливаем»
      if (a >= 48 && a < 255 && avg < 115 && spread > 28) {
        pixels[i + 3] = 255;
      }
    }
  }

  return sharp(pixels, {
    raw: { width: w, height: h, channels: 4 }
  })
    .png()
    .toBuffer();
}

async function resizeProductForCard(
  trimmed: Buffer,
  width: number,
  height: number,
  srcW: number,
  srcH: number,
  profile: PodruzhkaRenderProfile = "perfume"
): Promise<Buffer> {
  const scaleUp = width > srcW || height > srcH;
  let pipeline = sharp(trimmed).resize(width, height, {
    fit: "inside",
    kernel: sharp.kernel.lanczos3
  });
  if (scaleUp) {
    pipeline = pipeline.sharpen(PRODUCT_UPSCALE_SHARPEN);
  }
  const resized = await pipeline.png({ compressionLevel: 6 }).toBuffer();
  return finalizeProductCutout(resized);
}

/**
 * Склеивает коробку и флакон, если между ними «провал» прозрачности (Dior Homme и т.п.).
 */
export async function collapseInternalHorizontalGaps(input: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const w = info.width;
  const h = info.height;
  if (!w || !h) return input;

  const colHasPixel = (x: number): boolean => {
    for (let y = 0; y < h; y++) {
      if (data[(y * w + x) * 4 + 3]! >= 14) return true;
    }
    return false;
  };

  let first = 0;
  let last = w - 1;
  while (first < w && !colHasPixel(first)) first++;
  while (last > first && !colHasPixel(last)) last--;
  if (last - first < 40) return input;

  let bestGapStart = -1;
  let bestGapLen = 0;
  let gapStart = -1;
  for (let x = first + 8; x < last; x++) {
    if (!colHasPixel(x)) {
      if (gapStart < 0) gapStart = x;
    } else if (gapStart >= 0) {
      const len = x - gapStart;
      if (len > bestGapLen) {
        bestGapLen = len;
        bestGapStart = gapStart;
      }
      gapStart = -1;
    }
  }
  if (gapStart >= 0) {
    const len = last + 1 - gapStart;
    if (len > bestGapLen) {
      bestGapLen = len;
      bestGapStart = gapStart;
    }
  }

  if (bestGapLen < 14 || bestGapLen > 200 || bestGapStart < 0) return input;

  const gapEnd = bestGapStart + bestGapLen;
  const leftW = bestGapStart - first;
  const rightW = last + 1 - gapEnd;
  if (leftW < 24 || rightW < 24) return input;

  const pad = 8;
  const newW = leftW + pad + rightW;
  const leftBuf = await sharp(input)
    .extract({ left: first, top: 0, width: leftW, height: h })
    .png()
    .toBuffer();
  const rightBuf = await sharp(input)
    .extract({ left: gapEnd, top: 0, width: rightW, height: h })
    .png()
    .toBuffer();

  return sharp({
    create: {
      width: newW,
      height: h,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  })
    .composite([
      { input: leftBuf, left: 0, top: 0 },
      { input: rightBuf, left: leftW + pad, top: 0 }
    ])
    .png()
    .toBuffer();
}

/** Апскейл маленьких JPEG с Ozon до cut-out — меньше «лесенки» на светлых флаконах. */
export async function enhanceSourceForProcessing(
  input: Buffer,
  minLongEdge = PRODUCT_SOURCE_MIN_LONG_EDGE
): Promise<Buffer> {
  const meta = await sharp(input).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (!w || !h) return input;

  const long = Math.max(w, h);
  let pipeline = sharp(input);

  if (long < minLongEdge) {
    const scale = minLongEdge / long;
    pipeline = pipeline.resize(Math.round(w * scale), Math.round(h * scale), {
      fit: "fill",
      kernel: sharp.kernel.lanczos3
    });
  }

  return pipeline.sharpen(PRODUCT_UPSCALE_SHARPEN).png({ compressionLevel: 6 }).toBuffer();
}

/** Снять только полупрозрачный белый ореол — непрозрачное тело товара не трогаем. */
export async function removeSemiTransparentWhiteFringe(input: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const w = info.width;
  const h = info.height;
  if (!w || !h) return input;

  const pixels = Buffer.from(data);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const a = pixels[i + 3]!;
      if (a >= 250) continue;

      const r = pixels[i]!;
      const g = pixels[i + 1]!;
      const b = pixels[i + 2]!;
      const avg = (r + g + b) / 3;
      const spread = Math.max(r, g, b) - Math.min(r, g, b);

      if (a < 250 && avg >= 241 && spread <= 28) {
        pixels[i + 3] = 0;
      }
    }
  }

  return sharp(pixels, {
    raw: { width: w, height: h, channels: 4 }
  })
    .png()
    .toBuffer();
}

type ProductFloorShadowOpts = {
  avgMin?: number;
  avgMax?: number;
  maxSpread?: number;
  maxWarmth?: number;
};

/** Contact-тень снизу — flood от нижнего края, только нейтрально-серый фон. */
export async function stripProductFloorShadow(
  input: Buffer,
  opts: ProductFloorShadowOpts = {}
): Promise<Buffer> {
  const avgMin = opts.avgMin ?? 95;
  const avgMax = opts.avgMax ?? 175;
  const maxSpread = opts.maxSpread ?? 16;
  const maxWarmth = opts.maxWarmth ?? 6;

  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const w = info.width;
  const h = info.height;
  if (!w || !h) return input;

  const pixels = Buffer.from(data);
  const visited = new Uint8Array(w * h);
  const queue: number[] = [];

  const isFloorGray = (pi: number): boolean => {
    const a = pixels[pi + 3]!;
    if (a < 8) return false;
    const r = pixels[pi]!;
    const g = pixels[pi + 1]!;
    const b = pixels[pi + 2]!;
    const avg = (r + g + b) / 3;
    const spread = Math.max(r, g, b) - Math.min(r, g, b);
    if (spread > maxSpread) return false;
    if (r - b > maxWarmth) return false;
    return avg >= avgMin && avg <= avgMax;
  };

  const tryPush = (idx: number) => {
    if (idx < 0 || idx >= w * h || visited[idx]) return;
    queue.push(idx);
  };

  for (let x = 0; x < w; x++) {
    tryPush((h - 1) * w + x);
  }

  while (queue.length) {
    const idx = queue.pop()!;
    if (visited[idx]) continue;
    visited[idx] = 1;
    const pi = idx * 4;
    const a = pixels[pi + 3]!;

    if (a < 8) {
      const x = idx % w;
      const y = (idx - x) / w;
      if (x > 0) tryPush(idx - 1);
      if (x < w - 1) tryPush(idx + 1);
      if (y > 0) tryPush(idx - w);
      continue;
    }

    if (!isFloorGray(pi)) continue;
    pixels[pi + 3] = 0;

    const x = idx % w;
    const y = (idx - x) / w;
    if (x > 0) tryPush(idx - 1);
    if (x < w - 1) tryPush(idx + 1);
    if (y > 0) tryPush(idx - w);
    if (y < h - 1) tryPush(idx + w);
  }

  return sharp(pixels, {
    raw: { width: w, height: h, channels: 4 }
  })
    .png()
    .toBuffer();
}

export async function stripCosmeticsFloorShadow(input: Buffer): Promise<Buffer> {
  return stripProductFloorShadow(input, { avgMin: 95, avgMax: 175, maxSpread: 14, maxWarmth: 6 });
}

/** Вернуть 1 px контура, если flood-fill съел anti-alias. */
export async function dilateProductAlpha(input: Buffer, radius = 1): Promise<Buffer> {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const w = info.width;
  const h = info.height;
  if (!w || !h) return input;

  const pixels = Buffer.from(data);
  const alpha = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    alpha[i] = pixels[i * 4 + 3]!;
  }

  const out = new Uint8Array(alpha);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (alpha[idx] >= 128) continue;
      let maxA = alpha[idx]!;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          maxA = Math.max(maxA, alpha[ny * w + nx]!);
        }
      }
      if (maxA > alpha[idx]!) out[idx] = maxA;
    }
  }

  for (let i = 0; i < w * h; i++) {
    pixels[i * 4 + 3] = out[i]!;
  }

  return sharp(pixels, {
    raw: { width: w, height: h, channels: 4 }
  })
    .png()
    .toBuffer();
}

/** Сгладить «лесенку» на контуре cut-out без съедания товара. */
export async function featherProductAlpha(input: Buffer, sigma = 0.85): Promise<Buffer> {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const w = info.width;
  const h = info.height;
  if (!w || !h) return input;

  const pixels = Buffer.from(data);
  const alphaPlane = Buffer.alloc(w * h);
  for (let i = 0; i < w * h; i++) {
    alphaPlane[i] = pixels[i * 4 + 3]!;
  }

  const blurred = await sharp(alphaPlane, {
    raw: { width: w, height: h, channels: 1 }
  })
    .blur(sigma)
    .raw()
    .toBuffer();

  for (let i = 0; i < w * h; i++) {
    pixels[i * 4 + 3] = blurred[i]!;
  }

  return sharp(pixels, {
    raw: { width: w, height: h, channels: 4 }
  })
    .png()
    .toBuffer();
}

/** Снять 1px белого JPEG-ореола на контуре (не трогаем тело товара). */
export async function removeBoundaryWhiteHalo(input: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const w = info.width;
  const h = info.height;
  if (!w || !h) return input;

  const src = Buffer.from(data);
  const pixels = Buffer.from(data);

  const alphaAt = (x: number, y: number) => src[(y * w + x) * 4 + 3]!;
  const isOpaque = (x: number, y: number) => alphaAt(x, y) >= 20;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (src[i + 3]! < 20) continue;

      let touchesTransparent = false;
      for (let dy = -1; dy <= 1 && !touchesTransparent; dy++) {
        for (let dx = -1; dx <= 1 && !touchesTransparent; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) {
            touchesTransparent = true;
            continue;
          }
          if (!isOpaque(nx, ny)) touchesTransparent = true;
        }
      }
      if (!touchesTransparent) continue;

      const r = src[i]!;
      const g = src[i + 1]!;
      const b = src[i + 2]!;
      const avg = (r + g + b) / 3;
      const spread = Math.max(r, g, b) - Math.min(r, g, b);
      if (avg >= 249 && spread <= 14 && r - b <= 8) {
        pixels[i + 3] = 0;
      } else if (src[i + 3]! < 255 && avg >= 246 && spread <= 16 && r - b <= 8) {
        pixels[i + 3] = 0;
      }
    }
  }

  return sharp(pixels, {
    raw: { width: w, height: h, channels: 4 }
  })
    .png()
    .toBuffer();
}

/** После resize: полупрозрачные цветные пиксели внутри bbox → непрозрачные. */
export async function solidifyProductInterior(input: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const w = info.width;
  const h = info.height;
  if (!w || !h) return input;

  const pixels = Buffer.from(data);
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (pixels[(y * w + x) * 4 + 3]! >= 20) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }
  if (maxX < minX || maxY < minY) return input;

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const i = (y * w + x) * 4;
      const a = pixels[i + 3]!;
      if (a < 40 || a === 255) continue;
      const r = pixels[i]!;
      const g = pixels[i + 1]!;
      const b = pixels[i + 2]!;
      const avg = (r + g + b) / 3;
      const spread = Math.max(r, g, b) - Math.min(r, g, b);
      if (avg >= 248 && spread <= 12) continue;
      pixels[i + 3] = 255;
    }
  }

  return sharp(pixels, {
    raw: { width: w, height: h, channels: 4 }
  })
    .png()
    .toBuffer();
}

/** Финальная зачистка PNG перед композитом на серый макет. */
export async function finalizeProductCutout(input: Buffer): Promise<Buffer> {
  let buf = await removeBoundaryWhiteHalo(input);
  buf = await solidifyProductInterior(buf);
  buf = await removeSemiTransparentWhiteFringe(buf);
  return buf;
}

/** @deprecated alias */
export const removeCosmeticsWhiteFringe = removeSemiTransparentWhiteFringe;

/** Мягкий defringe для парфюма — только полупрозрачный ореол и серая contact-тень. */
export async function cleanPerfumeAlphaFringe(input: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const w = info.width;
  const h = info.height;
  if (!w || !h) return input;

  const pixels = Buffer.from(data);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const a = pixels[i + 3]!;
      if (a === 0 || a === 255) continue;

      const r = pixels[i]!;
      const g = pixels[i + 1]!;
      const b = pixels[i + 2]!;
      const avg = (r + g + b) / 3;
      const spread = Math.max(r, g, b) - Math.min(r, g, b);

      if (a < 250 && avg >= 244 && spread <= 22) {
        pixels[i + 3] = 0;
        continue;
      }

      if (a >= 48 && a < 255 && avg < 115 && spread > 28) {
        pixels[i + 3] = 255;
      }
    }
  }

  return sharp(pixels, {
    raw: { width: w, height: h, channels: 4 }
  })
    .png()
    .toBuffer();
}

/** @deprecated Используйте removeSemiTransparentWhiteFringe */
export async function defringeLightProductHalo(input: Buffer): Promise<Buffer> {
  return removeSemiTransparentWhiteFringe(input);
}

/** Предобработка PNG перед fit (парфюм): апскейл → мягкий cut-out → duo-gap. */
export async function preprocessProductBuffer(input: Buffer): Promise<Buffer> {
  let buf = await enhanceSourceForProcessing(input);
  buf = await stripProductEdgeBackground(buf);
  buf = await stripProductFloorShadow(buf, {
    avgMin: 90,
    avgMax: 172,
    maxSpread: 14,
    maxWarmth: 6
  });
  buf = await dilateProductAlpha(buf, 1);
  buf = await removeSemiTransparentWhiteFringe(buf);
  buf = await cleanPerfumeAlphaFringe(buf);
  buf = await collapseInternalHorizontalGaps(buf);
  buf = await trimTransparentSafe(buf);
  buf = await cropToVisibleProduct(buf, 8, 0.028);
  return finalizeProductCutout(buf);
}

/**
 * Косметика на белом (Ozon): апскейл → мягкий cut-out → dilate.
 * Не вызываем cleanProductAlphaFringe — он «съедал» бежевые края.
 */
export async function preprocessCosmeticsProductBuffer(input: Buffer): Promise<Buffer> {
  let buf = await enhanceSourceForProcessing(input);
  buf = await stripProductEdgeBackground(buf);
  buf = await stripCosmeticsFloorShadow(buf);
  buf = await dilateProductAlpha(buf, 1);
  buf = await removeSemiTransparentWhiteFringe(buf);
  buf = await trimTransparentSafe(buf);
  buf = await cropToVisibleProduct(buf, 8, 0.032);
  return finalizeProductCutout(buf);
}

export type FitProductOptions = {
  cardH?: number;
  cardW?: number;
  minHeightRatio?: number;
  maxHeightRatio?: number;
  targetHeightRatio?: number;
  minWidthRatio?: number;
  narrowAspectBoost?: number;
  scaleMultiplier?: number;
  /** Вписать только в рамку эталона (без «доминанты» по % макета) */
  referenceBoxOnly?: boolean;
  /** Доп. масштаб внутри рамки (replaceOnly, ≈1.12–1.16) */
  referenceBoxScale?: number;
  /** Доля высоты рамки, которую должен занять товар (0.85–0.96) */
  referenceBoxMinHeightFill?: number;
  /** Доля ширины рамки (наборы, коробка+флакон) */
  referenceBoxMinWidthFill?: number;
  /** Доля высоты всей карточки (широкие наборы коробка+флакон) */
  referenceBoxMinCardHeightFill?: number;
  /** Уже обработанный PNG (без повторного strip/crop) */
  preparedInput?: Buffer;
  /** contain — вписать; cover-height — заполнить высоту зоны, обрезать по бокам */
  fitMode?: "contain" | "cover-height";
  renderProfile?: PodruzhkaRenderProfile;
};

export type PreparedProductImage = {
  buffer: Buffer;
  srcW: number;
  srcH: number;
  aspect: number;
  maxDim: number;
  /** Доля высоты PNG: прозрачный отступ снизу/сверху bbox */
  bottomPadRatio: number;
  topPadRatio: number;
};

/** Отступы внутри обрезанного PNG — товар «сидит» низко или по центру. */
export async function measureVerticalPadding(
  input: Buffer,
  alphaThreshold = 14
): Promise<{ bottomPadRatio: number; topPadRatio: number }> {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  if (!w || !h) return { bottomPadRatio: 0, topPadRatio: 0 };

  let minY = h;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = data[(y * w + x) * 4 + 3]!;
      if (a < alphaThreshold) continue;
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxY < minY) return { bottomPadRatio: 0, topPadRatio: 0 };

  return {
    topPadRatio: minY / h,
    bottomPadRatio: (h - 1 - maxY) / h
  };
}

/** Единая предобработка foto с Ozon перед fit/подбором. */
export async function prepareProductImage(
  input: Buffer,
  profile: PodruzhkaRenderProfile = "perfume"
): Promise<PreparedProductImage> {
  const buffer =
    profile === "cosmetics"
      ? await preprocessCosmeticsProductBuffer(input)
      : await preprocessProductBuffer(input);
  const meta = await sharp(buffer).metadata();
  const srcW = meta.width ?? 1;
  const srcH = meta.height ?? 1;
  const padding = await measureVerticalPadding(buffer);
  return {
    buffer,
    srcW,
    srcH,
    aspect: srcW / srcH,
    maxDim: Math.max(srcW, srcH),
    bottomPadRatio: padding.bottomPadRatio,
    topPadRatio: padding.topPadRatio
  };
}

export type FitResult = {
  buffer: Buffer;
  width: number;
  height: number;
  /** Прозрачные пиксели снизу PNG — без учёта товар «висит» над тенью */
  bottomAlphaInset: number;
};

/** Сколько пустых строк снизу у обрезанного PNG (alpha < порога). */
export async function measureBottomAlphaInset(
  input: Buffer,
  alphaThreshold = 14
): Promise<number> {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  if (!w || !h) return 0;

  for (let y = h - 1; y >= 0; y--) {
    for (let x = 0; x < w; x++) {
      const a = data[(y * w + x) * 4 + 3]!;
      if (a >= alphaThreshold) return h - 1 - y;
    }
  }
  return 0;
}

/**
 * Товар — доминанта: высота 48–58% макета, ширина 50–60% макета (Carolina Herrera).
 */
export async function fitProductPng(
  input: Buffer,
  maxW: number,
  maxH: number,
  opts: FitProductOptions = {}
): Promise<FitResult> {
  const cardH = opts.cardH ?? R.size.h;
  const cardW = opts.cardW ?? R.size.w;
  const minH = Math.round(cardH * (opts.minHeightRatio ?? R.product.heightRatioMin));
  const maxHRatio = opts.maxHeightRatio ?? R.product.heightRatioMax;
  const maxHCap = Math.round(cardH * maxHRatio);
  const targetH = Math.round(
    cardH * (opts.targetHeightRatio ?? R.product.heightRatioTarget)
  );
  const minW = Math.round(cardW * (opts.minWidthRatio ?? R.product.widthRatioMin));
  const referenceBoxOnly = opts.referenceBoxOnly === true;
  const narrowBoost = referenceBoxOnly
    ? 1
    : (opts.narrowAspectBoost ?? R.product.narrowAspectBoost);
  const scaleMul = referenceBoxOnly
    ? (opts.scaleMultiplier ?? 1)
    : (opts.scaleMultiplier ?? 1);
  const fitMode = opts.fitMode ?? "contain";
  const profile = opts.renderProfile ?? "perfume";

  const trimmed = opts.preparedInput
    ? opts.preparedInput
    : referenceBoxOnly
      ? await preprocessProductBuffer(input)
      : await preprocessProductBuffer(input);
  const meta = await sharp(trimmed).metadata();
  const srcW = meta.width ?? 1;
  const srcH = meta.height ?? 1;
  const aspect = srcW / srcH;

  if (referenceBoxOnly && fitMode === "cover-height") {
    const minHFill = opts.referenceBoxMinHeightFill ?? 0.92;
    const cardFill = opts.referenceBoxMinCardHeightFill ?? R.product.heightRatioTarget;
    let targetPx = Math.round(Math.max(maxH * minHFill, cardH * cardFill));
    targetPx = Math.min(maxH, Math.max(1, Math.round(targetPx * (opts.referenceBoxScale ?? 1) * scaleMul)));

    let width = Math.max(1, Math.round((srcW * targetPx) / srcH));
    let height = targetPx;
    let buffer: Buffer;

    if (width > maxW) {
      let scaled = sharp(trimmed).resize(width, height, {
        fit: "fill",
        kernel: sharp.kernel.lanczos3
      });
      if (profile === "cosmetics") {
        scaled = scaled.sharpen(PRODUCT_UPSCALE_SHARPEN);
      }
      const scaledBuf = await scaled.png().toBuffer();
      const left = Math.max(0, Math.round((width - maxW) / 2));
      buffer = await finalizeProductCutout(
        await sharp(scaledBuf)
          .extract({ left, top: 0, width: maxW, height })
          .png()
          .toBuffer()
      );
      width = maxW;
    } else {
      buffer = await resizeProductForCard(trimmed, width, height, srcW, srcH, profile);
    }

    const bottomAlphaInset = await measureBottomAlphaInset(buffer);
    return { buffer, width, height, bottomAlphaInset };
  }

  const maxAllowedH = Math.min(maxH, maxHCap);
  let scale = Math.min(maxW / srcW, maxAllowedH / srcH);

  if (!referenceBoxOnly && aspect < 0.55) {
    scale *= narrowBoost;
  }
  scale *= scaleMul;
  if (referenceBoxOnly) {
    scale *= opts.referenceBoxScale ?? 1;
  }

  let width = Math.max(1, Math.round(srcW * scale));
  let height = Math.max(1, Math.round(srcH * scale));

  const pushToTarget = () => {
    if (referenceBoxOnly || height >= targetH || height >= maxH) return;
    const s = Math.min(targetH / height, maxW / width, maxH / height);
    width = Math.round(width * s);
    height = Math.round(height * s);
  };
  pushToTarget();

  if (width > maxW) {
    const s = maxW / width;
    width = maxW;
    height = Math.max(1, Math.round(height * s));
  }
  if (height > maxH) {
    const s = maxH / height;
    height = maxH;
    width = Math.max(1, Math.round(width * s));
  }

  if (referenceBoxOnly) {
    const minHFill = opts.referenceBoxMinHeightFill ?? 0;
    if (minHFill > 0) {
      const targetH = Math.round(maxH * minHFill);
      if (height < targetH && height < maxH) {
        const s = Math.min(targetH / height, maxW / width, maxH / height);
        width = Math.round(width * s);
        height = Math.round(height * s);
      }
    }
    const minWFill = opts.referenceBoxMinWidthFill ?? 0;
    if (minWFill > 0) {
      const targetW = Math.round(maxW * minWFill);
      if (width < targetW && width < maxW) {
        const s = Math.min(targetW / width, maxH / height, maxW / width);
        width = Math.round(width * s);
        height = Math.round(height * s);
      }
    }
    const cardMinHFill = opts.referenceBoxMinCardHeightFill ?? 0;
    if (cardMinHFill > 0) {
      const cardTargetH = Math.round(cardH * cardMinHFill);
      const cappedTarget = Math.min(cardTargetH, maxH);
      if (height < cappedTarget) {
        const s = Math.min(cappedTarget / height, maxW / width, maxH / height);
        width = Math.round(width * s);
        height = Math.round(height * s);
      }
    }
    if (width > maxW) {
      const s = maxW / width;
      width = maxW;
      height = Math.max(1, Math.round(height * s));
    }
    if (height > maxH) {
      const s = maxH / height;
      height = maxH;
      width = Math.max(1, Math.round(width * s));
    }
  } else {
    if (height < minH) {
      const s = Math.min(minH / height, maxW / width);
      width = Math.round(width * s);
      height = Math.round(height * s);
      if (width > maxW) {
        width = maxW;
        height = Math.min(maxH, Math.round(srcH * (maxW / srcW)));
      }
    }

    if (width < minW) {
      const s = Math.min(minW / width, maxH / height);
      width = Math.round(width * s);
      height = Math.round(height * s);
      if (height > maxH) {
        height = maxH;
        width = Math.min(maxW, Math.round(srcW * (maxH / srcH)));
      }
    }

    pushToTarget();
    if (width > maxW) {
      width = maxW;
      height = Math.min(maxH, Math.round(srcH * (maxW / srcW)));
    }
  }

  const buffer = await resizeProductForCard(trimmed, width, height, srcW, srcH, profile);

  const bottomAlphaInset = await measureBottomAlphaInset(buffer);

  return { buffer, width, height, bottomAlphaInset };
}

