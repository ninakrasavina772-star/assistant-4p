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

/** contain + upscale; минимальная высота — чтобы флакон всегда крупный у низа */
export async function fitProductPng(
  input: Buffer,
  maxW: number,
  maxH: number,
  fillHeightRatio = 0.98,
  minHeightRatio = 0.88
): Promise<{ buffer: Buffer; width: number; height: number }> {
  const stripped = await stripNearWhiteBackground(input);
  const trimmed = await trimTransparent(stripped);
  const meta = await sharp(trimmed).metadata();
  const srcW = meta.width ?? 1;
  const srcH = meta.height ?? 1;

  const targetH = Math.round(maxH * fillHeightRatio);
  const minH = Math.round(maxH * minHeightRatio);
  let scale = Math.min(targetH / srcH, maxW / srcW);
  let width = Math.max(1, Math.round(srcW * scale));
  let height = Math.max(1, Math.round(srcH * scale));

  if (height < minH) {
    scale = minH / srcH;
    width = Math.round(srcW * scale);
    height = minH;
    if (width > maxW) {
      const s = maxW / width;
      width = maxW;
      height = Math.max(1, Math.round(height * s));
    }
  }

  const buffer = await sharp(trimmed)
    .resize(width, height, { fit: "inside" })
    .png()
    .toBuffer();

  return { buffer, width, height };
}
