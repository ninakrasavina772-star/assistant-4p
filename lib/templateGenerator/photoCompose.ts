import sharp from "sharp";

export const PRODUCT_CARD_W = 1200;
export const PRODUCT_CARD_H = 1600;

export const BACKGROUND_STYLES = [
  "warm-beige",
  "cool-gray",
  "blush",
  "marble",
  "dark-luxury"
] as const;

export type BackgroundStyle = (typeof BACKGROUND_STYLES)[number];

export async function fetchProductImage(url: string): Promise<Buffer> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(25_000),
    headers: { Accept: "image/*", "User-Agent": "assistant-4p-template-generator/1.0" }
  });
  if (!res.ok) throw new Error(`Не скачалось foto: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 512) throw new Error("Пустой файл изображения");
  return buf;
}

function isPackshotBackground(r: number, g: number, b: number): boolean {
  const avg = (r + g + b) / 3;
  const spread = Math.max(r, g, b) - Math.min(r, g, b);
  const warmth = r - b;
  if (avg < 228 || spread > 42) return false;
  if (warmth > 14) return false;
  return true;
}

/** Снять белый/серый фон Ozon с краёв (без тяжёлой AI-модели). */
export async function cutPackshotBackground(input: Buffer): Promise<Buffer> {
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

  const tryPush = (idx: number) => {
    if (idx < 0 || idx >= w * h || visited[idx]) return;
    const pi = idx * 4;
    if (!isPackshotBackground(pixels[pi]!, pixels[pi + 1]!, pixels[pi + 2]!)) return;
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
    if (!isPackshotBackground(pixels[pi]!, pixels[pi + 1]!, pixels[pi + 2]!)) continue;
    pixels[pi + 3] = 0;

    const x = idx % w;
    const y = (idx - x) / w;
    if (x > 0) tryPush(idx - 1);
    if (x < w - 1) tryPush(idx + 1);
    if (y > 0) tryPush(idx - w);
    if (y < h - 1) tryPush(idx + w);
  }

  return sharp(pixels, { raw: { width: w, height: h, channels: 4 } })
    .png()
    .toBuffer();
}

function backgroundSvg(style: BackgroundStyle, w: number, h: number): string {
  const presets: Record<BackgroundStyle, string> = {
    "warm-beige": `<linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#f7f0e8"/><stop offset="100%" stop-color="#e8d8c8"/></linearGradient>`,
    "cool-gray": `<linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#f4f6f8"/><stop offset="100%" stop-color="#d5dbe3"/></linearGradient>`,
    blush: `<linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#fdf2f4"/><stop offset="100%" stop-color="#f0d4dc"/></linearGradient>`,
    marble: `<linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#fafafa"/><stop offset="45%" stop-color="#ececec"/><stop offset="100%" stop-color="#f5f5f5"/></linearGradient>`,
    "dark-luxury": `<linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#3a3a3e"/><stop offset="100%" stop-color="#1a1a1e"/></linearGradient>`
  };

  const accent =
    style === "dark-luxury"
      ? `<ellipse cx="${w * 0.72}" cy="${h * 0.28}" rx="${w * 0.35}" ry="${h * 0.22}" fill="#ffffff" opacity="0.06"/>`
      : `<ellipse cx="${w * 0.78}" cy="${h * 0.22}" rx="${w * 0.28}" ry="${h * 0.18}" fill="#ffffff" opacity="0.35"/>`;

  return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
    <defs>${presets[style]}</defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    ${accent}
  </svg>`;
}

export async function renderBackground(style: BackgroundStyle): Promise<Buffer> {
  const svg = backgroundSvg(style, PRODUCT_CARD_W, PRODUCT_CARD_H);
  return sharp(Buffer.from(svg)).jpeg({ quality: 92 }).toBuffer();
}

export async function compositeOnBackground(
  productCutout: Buffer,
  background: Buffer
): Promise<Buffer> {
  const meta = await sharp(productCutout).metadata();
  const pw = meta.width ?? 1;
  const ph = meta.height ?? 1;

  const maxH = Math.round(PRODUCT_CARD_H * 0.68);
  const maxW = Math.round(PRODUCT_CARD_W * 0.58);
  const scale = Math.min(maxW / pw, maxH / ph);
  const nw = Math.max(1, Math.round(pw * scale));
  const nh = Math.max(1, Math.round(ph * scale));

  const product = await sharp(productCutout)
    .resize(nw, nh, { fit: "inside", kernel: sharp.kernel.lanczos3 })
    .png()
    .toBuffer();

  const left = Math.round((PRODUCT_CARD_W - nw) / 2);
  const top = Math.round(PRODUCT_CARD_H * 0.42 - nh / 2);

  const shadowW = Math.round(nw * 0.72);
  const shadowSvg = `<svg width="${shadowW}" height="36" xmlns="http://www.w3.org/2000/svg">
    <ellipse cx="${shadowW / 2}" cy="18" rx="${shadowW * 0.46}" ry="10" fill="#000000" opacity="0.28"/>
  </svg>`;
  const shadowBuf = await sharp(Buffer.from(shadowSvg)).png().toBuffer();

  const bg = await sharp(background)
    .resize(PRODUCT_CARD_W, PRODUCT_CARD_H, { fit: "cover" })
    .jpeg({ quality: 92 })
    .toBuffer();

  const shadowLeft = Math.round((PRODUCT_CARD_W - shadowW) / 2);
  const shadowTop = top + nh - 12;

  return sharp(bg)
    .composite([
      { input: shadowBuf, left: shadowLeft, top: shadowTop },
      { input: product, left, top }
    ])
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();
}
