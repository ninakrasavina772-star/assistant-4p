import sharp from "sharp";

/** Убирает белый / почти белый фон Ozon */
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

/**
 * contain + upscaling: обрезка пустых полей, приоритет высоты (~97% зоны).
 * Без trim маленький флакон в центре большого PNG Ozon не увеличивался.
 */
export async function fitProductPng(
  input: Buffer,
  maxW: number,
  maxH: number,
  fillHeightRatio = 0.97
): Promise<{ buffer: Buffer; width: number; height: number }> {
  const stripped = await stripNearWhiteBackground(input);
  const trimmed = await trimTransparent(stripped);
  const meta = await sharp(trimmed).metadata();
  const srcW = meta.width ?? 1;
  const srcH = meta.height ?? 1;

  const targetH = Math.round(maxH * fillHeightRatio);
  const scale = Math.min(targetH / srcH, maxW / srcW);
  const width = Math.max(1, Math.round(srcW * scale));
  const height = Math.max(1, Math.round(srcH * scale));

  const buffer = await sharp(trimmed)
    .resize(width, height, { fit: "inside" })
    .png()
    .toBuffer();

  return { buffer, width, height };
}
