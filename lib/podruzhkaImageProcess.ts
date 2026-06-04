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

async function trimTransparent(input: Buffer): Promise<Buffer> {
  try {
    return await sharp(input).trim({ threshold: 12 }).png().toBuffer();
  } catch {
    return input;
  }
}

export type FitResult = {
  buffer: Buffer;
  width: number;
  height: number;
  overflowsWidth: boolean;
};

/**
 * Масштаб товара под референс:
 * - portrait / square: contain в maxW × maxH
 * - landscape (коробки): по высоте minHeightRatio, ширина может выходить за maxW (clip при рендере)
 */
export async function fitProductPng(
  input: Buffer,
  maxW: number,
  maxH: number,
  fillHeightRatio = 0.96,
  minHeightRatio = 0.92
): Promise<FitResult> {
  const stripped = await stripNearWhiteBackground(input);
  const trimmed = await trimTransparent(stripped);
  const meta = await sharp(trimmed).metadata();
  const srcW = meta.width ?? 1;
  const srcH = meta.height ?? 1;
  const aspect = srcW / srcH;

  const targetH = Math.round(maxH * fillHeightRatio);
  const minH = Math.round(maxH * minHeightRatio);
  const isLandscape = aspect > 1.15;

  let width: number;
  let height: number;

  if (isLandscape) {
    height = Math.max(minH, Math.min(targetH, Math.round(maxH * 0.98)));
    const scale = height / srcH;
    width = Math.round(srcW * scale);
  } else {
    let scale = Math.min(targetH / srcH, maxW / srcW);
    width = Math.max(1, Math.round(srcW * scale));
    height = Math.max(1, Math.round(srcH * scale));
    if (height < minH) {
      scale = minH / srcH;
      width = Math.round(srcW * scale);
      height = minH;
      if (width > maxW) {
        width = maxW;
        height = Math.max(1, Math.round(srcH * (maxW / srcW)));
      }
    }
  }

  const buffer = await sharp(trimmed)
    .resize(width, height, { fit: "fill" })
    .png()
    .toBuffer();

  return { buffer, width, height, overflowsWidth: width > maxW };
}
