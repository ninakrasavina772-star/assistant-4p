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
  /** Rendered width — может быть шире зоны для landscape продуктов */
  width: number;
  height: number;
  /** true если ширина превышает maxW (нужна clip-зона при рендере) */
  overflowsWidth: boolean;
};

/**
 * Fit product into zone:
 * - Для portrait/square: contain внутри maxW × (maxH * fillHeightRatio)
 * - Для landscape (широкие коробки): масштаб по высоте minHeightRatio,
 *   разрешаем ширину больше maxW — рендерер сам отрежет края при drawImage
 */
export async function fitProductPng(
  input: Buffer,
  maxW: number,
  maxH: number,
  fillHeightRatio = 0.98,
  minHeightRatio = 0.88
): Promise<FitResult> {
  const stripped = await stripNearWhiteBackground(input);
  const trimmed = await trimTransparent(stripped);
  const meta = await sharp(trimmed).metadata();
  const srcW = meta.width ?? 1;
  const srcH = meta.height ?? 1;

  const targetH = Math.round(maxH * fillHeightRatio);
  const minH = Math.round(maxH * minHeightRatio);

  // Шаг 1: стандартный contain (не превышаем maxW и targetH)
  let scale = Math.min(targetH / srcH, maxW / srcW);
  let width = Math.max(1, Math.round(srcW * scale));
  let height = Math.max(1, Math.round(srcH * scale));

  // Шаг 2: если высота меньше минимальной — масштабируем по высоте
  // и РАЗРЕШАЕМ ширину превысить maxW (обрезка будет при рендере)
  if (height < minH) {
    scale = minH / srcH;
    width = Math.round(srcW * scale);
    height = minH;
    // Только если ширина не больше чем в 2 раза превышает — иначе оставляем contain
    if (width > maxW * 2) {
      const s = maxW / srcW;
      width = maxW;
      height = Math.max(1, Math.round(srcH * s));
    }
  }

  const buffer = await sharp(trimmed)
    .resize(width, height, { fit: "fill" })
    .png()
    .toBuffer();

  return { buffer, width, height, overflowsWidth: width > maxW };
}
