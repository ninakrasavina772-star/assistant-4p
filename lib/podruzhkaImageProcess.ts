import sharp from "sharp";

/** Убирает белый / почти белый фон Ozon (без белого квадрата при вставке) */
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

/** Вписать в зону contain, вернуть PNG с альфой */
export async function fitProductPng(
  input: Buffer,
  maxW: number,
  maxH: number
): Promise<{ buffer: Buffer; width: number; height: number }> {
  const stripped = await stripNearWhiteBackground(input);
  const meta = await sharp(stripped).metadata();
  const srcW = meta.width ?? 1;
  const srcH = meta.height ?? 1;
  const scale = Math.min(maxW / srcW, maxH / srcH);
  const width = Math.max(1, Math.round(srcW * scale));
  const height = Math.max(1, Math.round(srcH * scale));

  const buffer = await sharp(stripped)
    .resize(width, height, { fit: "inside" })
    .png()
    .toBuffer();

  return { buffer, width, height };
}
