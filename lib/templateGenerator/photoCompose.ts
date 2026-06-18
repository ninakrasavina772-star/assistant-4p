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
  const noise = `<filter id="n" x="0" y="0" width="100%" height="100%">
    <feTurbulence type="fractalNoise" baseFrequency="0.75" numOctaves="3" stitchTiles="stitch"/>
    <feColorMatrix type="saturate" values="0"/>
    <feComponentTransfer><feFuncA type="linear" slope="0.07"/></feComponentTransfer>
  </filter>`;

  const presets: Record<BackgroundStyle, { grad: string; decor: string }> = {
    "warm-beige": {
      grad: `<linearGradient id="g" x1="0" y1="0" x2="0.2" y2="1">
        <stop offset="0%" stop-color="#faf6f0"/><stop offset="55%" stop-color="#e9ddd0"/><stop offset="100%" stop-color="#d8c8b6"/></linearGradient>`,
      decor: `<ellipse cx="${w * 0.2}" cy="${h * 0.18}" rx="${w * 0.35}" ry="${h * 0.12}" fill="#fff" opacity="0.35"/>
        <rect x="0" y="${h * 0.72}" width="${w}" height="${h * 0.28}" fill="#000" opacity="0.04"/>`
    },
    "cool-gray": {
      grad: `<linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#f8fafc"/><stop offset="50%" stop-color="#e2e8f0"/><stop offset="100%" stop-color="#cbd5e1"/></linearGradient>`,
      decor: `<circle cx="${w * 0.82}" cy="${h * 0.15}" r="${w * 0.22}" fill="#fff" opacity="0.25"/>
        <rect x="0" y="${h * 0.74}" width="${w}" height="${h * 0.26}" fill="#1e293b" opacity="0.05"/>`
    },
    blush: {
      grad: `<linearGradient id="g" x1="0" y1="0" x2="0.3" y2="1">
        <stop offset="0%" stop-color="#fff8fa"/><stop offset="45%" stop-color="#f5e0e8"/><stop offset="100%" stop-color="#e8c8d4"/></linearGradient>`,
      decor: `<ellipse cx="${w * 0.75}" cy="${h * 0.2}" rx="${w * 0.3}" ry="${h * 0.14}" fill="#fff" opacity="0.4"/>
        <ellipse cx="${w * 0.15}" cy="${h * 0.65}" rx="${w * 0.2}" ry="${h * 0.08}" fill="#fbcfe8" opacity="0.2"/>
        <rect x="0" y="${h * 0.73}" width="${w}" height="${h * 0.27}" fill="#831843" opacity="0.04"/>`
    },
    marble: {
      grad: `<linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#fafafa"/><stop offset="40%" stop-color="#ececec"/><stop offset="100%" stop-color="#e2e2e2"/></linearGradient>`,
      decor: `<path d="M0 ${h * 0.7} Q ${w * 0.3} ${h * 0.68} ${w * 0.55} ${h * 0.72} T ${w} ${h * 0.7} L ${w} ${h} L 0 ${h} Z" fill="#000" opacity="0.06"/>
        <ellipse cx="${w * 0.5}" cy="${h * 0.25}" rx="${w * 0.4}" ry="${h * 0.15}" fill="#fff" opacity="0.5"/>`
    },
    "dark-luxury": {
      grad: `<linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#2d2d32"/><stop offset="60%" stop-color="#141418"/><stop offset="100%" stop-color="#0a0a0c"/></linearGradient>`,
      decor: `<ellipse cx="${w * 0.7}" cy="${h * 0.22}" rx="${w * 0.35}" ry="${h * 0.18}" fill="#d4af37" opacity="0.08"/>
        <rect x="0" y="${h * 0.75}" width="${w}" height="${h * 0.25}" fill="#000" opacity="0.35"/>`
    }
  };

  const p = presets[style];
  return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
    <defs>${noise}${p.grad}</defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <rect width="100%" height="100%" filter="url(#n)"/>
    ${p.decor}
  </svg>`;
}

/** Лёгкая цветокоррекция и виньетка — «дороже» на выходе */
export async function applyLuxuryFinish(input: Buffer): Promise<Buffer> {
  const vignette = `<svg width="${PRODUCT_CARD_W}" height="${PRODUCT_CARD_H}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="v" cx="50%" cy="42%" r="72%">
        <stop offset="50%" stop-color="#000000" stop-opacity="0"/>
        <stop offset="100%" stop-color="#000000" stop-opacity="0.2"/>
      </radialGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#v)"/>
  </svg>`;

  return sharp(input)
    .modulate({ brightness: 1.03, saturation: 1.08 })
    .sharpen({ sigma: 0.55, m1: 0.5, m2: 0.3 })
    .composite([{ input: Buffer.from(vignette), blend: "multiply" }])
    .jpeg({ quality: 93, mozjpeg: true })
    .toBuffer();
}

async function buildShadowLayer(width: number, tight: boolean): Promise<Buffer> {
  const h = tight ? 32 : 56;
  const rx = tight ? width * 0.2 : width * 0.36;
  const op = tight ? 0.42 : 0.16;
  const svg = `<svg width="${width}" height="${h}" xmlns="http://www.w3.org/2000/svg">
    <ellipse cx="${width / 2}" cy="${h / 2}" rx="${rx}" ry="${h * 0.32}" fill="#000" opacity="${op}"/>
  </svg>`;
  return sharp(Buffer.from(svg)).blur(tight ? 0.3 : 1.2).png().toBuffer();
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

  const maxH = Math.round(PRODUCT_CARD_H * 0.62);
  const maxW = Math.round(PRODUCT_CARD_W * 0.52);
  const scale = Math.min(maxW / pw, maxH / ph);
  const nw = Math.max(1, Math.round(pw * scale));
  const nh = Math.max(1, Math.round(ph * scale));

  const product = await sharp(productCutout)
    .resize(nw, nh, { fit: "inside", kernel: sharp.kernel.lanczos3 })
    .png()
    .toBuffer();

  const surfaceY = Math.round(PRODUCT_CARD_H * 0.76);
  const left = Math.round((PRODUCT_CARD_W - nw) / 2);
  const top = surfaceY - nh;

  const tightShadow = await buildShadowLayer(nw, true);
  const softShadow = await buildShadowLayer(Math.round(nw * 1.15), false);

  const bg = await sharp(background)
    .resize(PRODUCT_CARD_W, PRODUCT_CARD_H, { fit: "cover" })
    .jpeg({ quality: 94 })
    .toBuffer();

  const softLeft = Math.round((PRODUCT_CARD_W - Math.round(nw * 1.15)) / 2);
  const shadowTop = surfaceY - 8;

  const composed = await sharp(bg)
    .composite([
      { input: softShadow, left: softLeft, top: shadowTop + 6 },
      { input: tightShadow, left, top: shadowTop },
      { input: product, left, top }
    ])
    .jpeg({ quality: 92, mozjpeg: true })
    .toBuffer();

  return applyLuxuryFinish(composed);
}
