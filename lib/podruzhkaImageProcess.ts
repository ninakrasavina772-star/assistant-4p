import sharp from "sharp";

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

/** trim только если не «съел» товар (иначе — как на Ozon, целиком) */
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

export type FitResult = {
  buffer: Buffer;
  width: number;
  height: number;
};

/**
 * Весь товар целиком в зоне (contain), без обрезки краёв.
 * Как в референсе: крупно, но не вылезает за границы.
 */
export async function fitProductPng(
  input: Buffer,
  maxW: number,
  maxH: number,
  fillHeightRatio = 0.96,
  minHeightRatio = 0.88
): Promise<FitResult> {
  const stripped = await stripNearWhiteBackground(input);
  const trimmed = await trimTransparentSafe(stripped);
  const meta = await sharp(trimmed).metadata();
  const srcW = meta.width ?? 1;
  const srcH = meta.height ?? 1;

  const targetH = Math.round(maxH * fillHeightRatio);
  const minH = Math.round(maxH * minHeightRatio);

  let scale = Math.min(maxW / srcW, targetH / srcH);
  let width = Math.max(1, Math.round(srcW * scale));
  let height = Math.max(1, Math.round(srcH * scale));

  if (height < minH) {
    const scaleH = minH / srcH;
    const w2 = Math.round(srcW * scaleH);
    if (w2 <= maxW) {
      scale = scaleH;
      width = w2;
      height = minH;
    }
  }

  const buffer = await sharp(trimmed)
    .resize(width, height, { fit: "inside" })
    .png()
    .toBuffer();

  return { buffer, width, height };
}
