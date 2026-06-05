import sharp from "sharp";
import { PODRUZHKA_REFERENCE as R } from "@/lib/podruzhkaReferenceSpec";

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

/** Обрезка до bbox видимого товара (не прозрачный и не белый фон). */
export async function cropToVisibleProduct(
  input: Buffer,
  whiteThreshold = 242
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

  const isVisible = (pi: number): boolean => {
    const a = data[pi + 3]!;
    if (a < 14) return false;
    const r = data[pi]!;
    const g = data[pi + 1]!;
    const b = data[pi + 2]!;
    const avg = (r + g + b) / 3;
    const spread = Math.max(r, g, b) - Math.min(r, g, b);
    return !(avg >= whiteThreshold && spread <= 28);
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!isVisible((y * w + x) * 4)) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (maxX < minX || maxY < minY) return input;

  const padX = Math.max(2, Math.round((maxX - minX + 1) * 0.02));
  const padY = Math.max(2, Math.round((maxY - minY + 1) * 0.02));
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

/** Убрать серую «половую» тень под флаконом (часто в foto с Ozon). */
export async function stripGrayFloorShadow(input: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const w = info.width;
  const h = info.height;
  if (!w || !h) return input;

  const pixels = Buffer.from(data);
  const shadowStart = Math.floor(h * 0.52);

  for (let y = shadowStart; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const a = pixels[i + 3]!;
      if (a < 12) continue;
      const r = pixels[i]!;
      const g = pixels[i + 1]!;
      const b = pixels[i + 2]!;
      const avg = (r + g + b) / 3;
      const spread = Math.max(r, g, b) - Math.min(r, g, b);
      if (spread <= 38 && avg >= 110 && avg <= 242) {
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
};

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
  const scaleMul = referenceBoxOnly ? 1 : (opts.scaleMultiplier ?? 1);

  const trimmed = referenceBoxOnly
    ? await cropToVisibleProduct(
        await trimTransparentSafe(
          await stripGrayFloorShadow(await stripEdgeNearWhiteBackground(input))
        )
      )
    : await trimTransparentSafe(
        await stripGrayFloorShadow(await stripNearWhiteBackground(input))
      );
  const meta = await sharp(trimmed).metadata();
  const srcW = meta.width ?? 1;
  const srcH = meta.height ?? 1;
  const aspect = srcW / srcH;

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

  const buffer = await sharp(trimmed)
    .resize(width, height, { fit: "inside" })
    .png()
    .toBuffer();

  const bottomAlphaInset = await measureBottomAlphaInset(buffer);

  return { buffer, width, height, bottomAlphaInset };
}

