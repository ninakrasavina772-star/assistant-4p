import sharp from "sharp";
import { PODRUZHKA_REFERENCE as R } from "@/lib/podruzhkaReferenceSpec";
import type { PodruzhkaRenderProfile } from "@/lib/podruzhkaCosmeticsLayout";
import { PODRUZHKA_COSMETICS_FOTO_MODE } from "@/lib/podruzhkaCosmeticsLayout";
import { fetchAiCutout } from "@/lib/podruzhkaAiCutout";

/** Мин. длинная сторона исходника перед cut-out (Ozon часто отдаёт 600×800). */
const PRODUCT_SOURCE_MIN_LONG_EDGE = 1400;
const OZON_COSMETICS_GRID = { w: 600, h: 800 } as const;
const OZON_COSMETICS_GRID_BG = { r: 255, g: 255, b: 255, alpha: 1 } as const;

/** Ozon packshot grid: contain (не crop), иначе fill срезает колпачок на full-size foto. */
async function fitCosmeticsOzonGrid(input: Buffer): Promise<Buffer> {
  return sharp(input)
    .resize(OZON_COSMETICS_GRID.w, OZON_COSMETICS_GRID.h, {
      fit: "contain",
      background: OZON_COSMETICS_GRID_BG,
      kernel: sharp.kernel.lanczos3
    })
    .png()
    .toBuffer();
}


const PRODUCT_UPSCALE_SHARPEN = { sigma: 0.38, m1: 0.42, m2: 0.16 } as const;

/**
 * Убирает только белый фон, связанный с краями кадра (типичный JPEG с Ozon).
 * Белые детали внутри товара (светлая коробка) не трогаем.
 */
export async function stripEdgeNearWhiteBackground(
  input: Buffer,
  threshold = 242,
  opts?: { skipTopEdge?: boolean }
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
    if (!opts?.skipTopEdge) tryPush(x);
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

type OpaqueFootprint = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  x0: number;
  x1: number;
};

function readNearWhiteRgb(
  pixels: Buffer,
  pi: number,
  threshold = 236,
  maxSpread = 28
): boolean {
  const r = pixels[pi]!;
  const g = pixels[pi + 1]!;
  const b = pixels[pi + 2]!;
  const avg = (r + g + b) / 3;
  const spread = Math.max(r, g, b) - Math.min(r, g, b);
  return avg >= threshold && spread <= maxSpread;
}

function computeOpaqueFootprint(
  pixels: Buffer,
  w: number,
  h: number,
  alphaMin = 20
): OpaqueFootprint | null {
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (pixels[(y * w + x) * 4 + 3]! < alphaMin) continue;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < minX) return null;

  const colW = maxX - minX + 1;
  const padX = Math.max(4, Math.round(colW * 0.12));
  return {
    minX,
    minY,
    maxX,
    maxY,
    x0: Math.max(0, minX - padX),
    x1: Math.min(w - 1, maxX + padX)
  };
}

function isSubstantiveSourcePixel(pixels: Buffer, pi: number): boolean {
  const r = pixels[pi]!;
  const g = pixels[pi + 1]!;
  const b = pixels[pi + 2]!;
  const avg = (r + g + b) / 3;
  const spread = Math.max(r, g, b) - Math.min(r, g, b);
  const warmth = r - b;
  if (!readNearWhiteRgb(pixels, pi, 242, 30)) return true;
  if (warmth >= 4 && spread >= 6 && avg < 250) return true;
  if (spread >= 14 && avg < 248) return true;
  return false;
}

function isColorfulOpaquePixel(pixels: Buffer, pi: number): boolean {
  if (pixels[pi + 3]! < 20) return false;
  return !readNearWhiteRgb(pixels, pi, 236, 28);
}

function isProductAnchorPixel(pixels: Buffer, pi: number, source?: Buffer): boolean {
  if (pixels[pi + 3]! >= 20) {
    if (!readNearWhiteRgb(pixels, pi, 242, 30)) return true;
    if (source && isSubstantiveSourcePixel(source, pi)) return true;
    return false;
  }
  return source ? isSubstantiveSourcePixel(source, pi) : false;
}

function hasOpaqueAnchorInColumn(
  pixels: Buffer,
  w: number,
  h: number,
  x: number,
  y: number,
  dir: -1 | 1,
  x0: number,
  x1: number,
  alphaMin = 20,
  maxStep = 220
): boolean {
  for (let step = 1; step <= maxStep; step++) {
    const ny = y + dir * step;
    if (ny < 0 || ny >= h) return false;
    if (x < x0 || x > x1) return false;
    if (pixels[(ny * w + x) * 4 + 3]! >= alphaMin) return true;
  }
  return false;
}

function hasColorfulOpaqueInColumn(
  pixels: Buffer,
  w: number,
  h: number,
  x: number,
  y: number,
  dir: -1 | 1,
  x0: number,
  x1: number,
  maxStep = 220
): boolean {
  for (let step = 1; step <= maxStep; step++) {
    const ny = y + dir * step;
    if (ny < 0 || ny >= h) return false;
    if (x < x0 || x > x1) return false;
    const pi = (ny * w + x) * 4;
    if (isColorfulOpaquePixel(pixels, pi)) return true;
  }
  return false;
}

function isWhiteProductInteriorPixel(
  pixels: Buffer,
  w: number,
  h: number,
  x: number,
  y: number,
  footprint: OpaqueFootprint,
  alphaMin = 20
): boolean {
  if (x < footprint.x0 || x > footprint.x1) return false;
  if (y > footprint.maxY + 2) return false;
  const pi = (y * w + x) * 4;
  if (!readNearWhiteRgb(pixels, pi, 236, 28)) return false;

  const opaque = pixels[pi + 3]! >= alphaMin;
  if (opaque) {
    const above =
      hasColorfulOpaqueInColumn(pixels, w, h, x, y, -1, footprint.x0, footprint.x1) ||
      hasOpaqueAnchorInColumn(pixels, w, h, x, y, -1, footprint.x0, footprint.x1, alphaMin);
    const below =
      hasColorfulOpaqueInColumn(pixels, w, h, x, y, 1, footprint.x0, footprint.x1) ||
      hasOpaqueAnchorInColumn(pixels, w, h, x, y, 1, footprint.x0, footprint.x1, alphaMin);
    return above || below;
  }

  const above =
    hasColorfulOpaqueInColumn(pixels, w, h, x, y, -1, footprint.x0, footprint.x1) ||
    hasOpaqueAnchorInColumn(pixels, w, h, x, y, -1, footprint.x0, footprint.x1, alphaMin);
  const below =
    hasColorfulOpaqueInColumn(pixels, w, h, x, y, 1, footprint.x0, footprint.x1) ||
    hasOpaqueAnchorInColumn(pixels, w, h, x, y, 1, footprint.x0, footprint.x1, alphaMin);
  if (above && below) return true;

  let leftColor = false;
  let rightColor = false;
  for (let dx = 1; dx <= 48 && x - dx >= footprint.x0; dx++) {
    const opi = (y * w + (x - dx)) * 4;
    if (isProductAnchorPixel(pixels, opi)) {
      leftColor = true;
      break;
    }
  }
  for (let dx = 1; dx <= 48 && x + dx <= footprint.x1; dx++) {
    const opi = (y * w + (x + dx)) * 4;
    if (isProductAnchorPixel(pixels, opi)) {
      rightColor = true;
      break;
    }
  }
  return leftColor && rightColor;
}

function isPaddingRow(
  src: Buffer,
  w: number,
  y: number,
  x0: number,
  x1: number
): boolean {
  let inside = 0;
  let outside = 0;
  for (let x = 0; x < w; x++) {
    const pi = (y * w + x) * 4;
    if (!readNearWhiteRgb(src, pi, 236, 28)) continue;
    if (x >= x0 && x <= x1) inside++;
    else outside++;
  }
  return outside > Math.max(8, inside * 1.2);
}

/** Белый фон Ozon, достижимый с края кадра (только near-white). */
function buildExteriorNearWhiteMask(
  src: Buffer,
  w: number,
  h: number,
  threshold = 235
): Uint8Array {
  const exterior = new Uint8Array(w * h);
  const visited = new Uint8Array(w * h);
  const queue: number[] = [];

  const tryPush = (idx: number) => {
    if (idx < 0 || idx >= w * h || visited[idx]) return;
    if (!readNearWhiteRgb(src, idx * 4, threshold, 32)) return;
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
    exterior[idx] = 1;
    const x = idx % w;
    const y = (idx - x) / w;
    if (x > 0) tryPush(idx - 1);
    if (x < w - 1) tryPush(idx + 1);
    if (y > 0) tryPush(idx - w);
    if (y < h - 1) tryPush(idx + w);
  }

  return exterior;
}

function isBodyAnchorPixel(src: Buffer, pi: number): boolean {
  if (!readNearWhiteRgb(src, pi, 242, 30)) return true;
  return isSubstantiveSourcePixel(src, pi);
}

type ColumnSpan = { yTop: number; yBot: number };

/**
 * Белые колпачки: вертикально от якорей тела, без прямоугольной заливки всего bbox
 * (она оставляла белый фон Ozon по бокам).
 */
function reclaimProductWhiteInColumns(
  src: Buffer,
  exterior: Uint8Array,
  w: number,
  h: number
): Uint8Array {
  const isExterior = Uint8Array.from(exterior);

  let coreMinX = w;
  let coreMaxX = -1;
  let globalMinAnchorY = h;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!isBodyAnchorPixel(src, (y * w + x) * 4)) continue;
      coreMinX = Math.min(coreMinX, x);
      coreMaxX = Math.max(coreMaxX, x);
      globalMinAnchorY = Math.min(globalMinAnchorY, y);
    }
  }
  if (coreMaxX < coreMinX) return isExterior;

  const productW = coreMaxX - coreMinX + 1;
  const padX = Math.max(4, Math.round(productW * 0.05));
  const x0 = Math.max(0, coreMinX - padX);
  const x1 = Math.min(w - 1, coreMaxX + padX);
  const maxCapRise = Math.round(productW * 0.88);
  const capBridge = Math.max(20, Math.round(productW * 0.52));
  const columnSpans = new Map<number, ColumnSpan>();

  const markProduct = (x: number, y: number) => {
    if (x < x0 || x > x1 || y < 0 || y >= h) return;
    isExterior[y * w + x] = 0;
  };

  const extendWhiteStack = (x: number, yTop: number, yBot: number): ColumnSpan => {
    const capFloorY = Math.max(0, globalMinAnchorY - maxCapRise);
    for (let y = yTop - 1; y >= capFloorY; y--) {
      const pi = (y * w + x) * 4;
      if (!readNearWhiteRgb(src, pi, 234, 34)) break;
      markProduct(x, y);
      yTop = y;
    }
    for (let y = yBot + 1; y < h; y++) {
      const pi = (y * w + x) * 4;
      if (!readNearWhiteRgb(src, pi, 234, 34)) break;
      markProduct(x, y);
      yBot = y;
    }
    return { yTop, yBot };
  };

  for (let x = x0; x <= x1; x++) {
    const anchorY: number[] = [];
    for (let y = 0; y < h; y++) {
      if (isBodyAnchorPixel(src, (y * w + x) * 4)) anchorY.push(y);
    }
    if (!anchorY.length) continue;
    columnSpans.set(x, extendWhiteStack(x, Math.min(...anchorY), Math.max(...anchorY)));
    for (const y of anchorY) markProduct(x, y);
  }

  for (let x = x0; x <= x1; x++) {
    if (columnSpans.has(x)) continue;
    let bestDist = capBridge + 1;
    let bestSpan: ColumnSpan | null = null;
    for (const [nx, span] of columnSpans) {
      const dist = Math.abs(nx - x);
      if (dist > capBridge || dist >= bestDist) continue;
      bestDist = dist;
      bestSpan = span;
    }
    if (!bestSpan) continue;
    for (let y = bestSpan.yTop; y <= bestSpan.yBot; y++) {
      const pi = (y * w + x) * 4;
      if (!readNearWhiteRgb(src, pi, 234, 34)) continue;
      markProduct(x, y);
    }
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const pi = (y * w + x) * 4;
      if (isBodyAnchorPixel(src, pi)) markProduct(x, y);
    }
  }

  return isExterior;
}

/** Убрать белые поля Ozon слева/справа от силуэта (колпачок внутри ширины товара сохраняем). */
function trimHorizontalWhiteMargins(
  pixels: Buffer,
  src: Buffer,
  w: number,
  h: number,
  whiteCapKeep?: Uint8Array
): void {
  let bodyLeft = w;
  let bodyRight = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const pi = (y * w + x) * 4;
      if (pixels[pi + 3]! < 128) continue;
      if (readNearWhiteRgb(src, pi, 236, 30)) continue;
      bodyLeft = Math.min(bodyLeft, x);
      bodyRight = Math.max(bodyRight, x);
    }
  }
  if (bodyRight < bodyLeft) return;

  const trimPad = Math.max(3, Math.round((bodyRight - bodyLeft + 1) * 0.035));
  const l = bodyLeft - trimPad;
  const r = bodyRight + trimPad;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x >= l && x <= r) continue;
      const idx = y * w + x;
      if (whiteCapKeep?.[idx]) continue;
      const pi = idx * 4;
      if (pixels[pi + 3]! < 128) continue;
      if (!readNearWhiteRgb(src, pi, 236, 30)) continue;
      pixels[pi + 3] = 0;
    }
  }
}

/** Белый колпачок: только вверх от верхнего якоря + узкий bridge в cap-зоне. */
function buildVerticalWhiteCapKeepMask(src: Buffer, w: number, h: number): Uint8Array {
  const keep = new Uint8Array(w * h);

  let coreMinX = w;
  let coreMaxX = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!isBodyAnchorPixel(src, (y * w + x) * 4)) continue;
      coreMinX = Math.min(coreMinX, x);
      coreMaxX = Math.max(coreMaxX, x);
    }
  }
  if (coreMaxX < coreMinX) return keep;

  const productW = coreMaxX - coreMinX + 1;
  const padX = Math.max(4, Math.round(productW * 0.05));
  const x0 = Math.max(0, coreMinX - padX);
  const x1 = Math.min(w - 1, coreMaxX + padX);
  /** Маска колпачка — узкая; полный колпачок добирает reclaim ниже. */
  const maxCapRise = Math.min(220, Math.max(60, Math.round(productW * 0.35)));
  const maxReflectionDrop = Math.min(14, Math.max(6, Math.round(productW * 0.03)));

  const mark = (x: number, y: number) => {
    if (x < x0 || x > x1 || y < 0 || y >= h) return;
    keep[y * w + x] = 1;
  };

  for (let x = x0; x <= x1; x++) {
    const anchorY: number[] = [];
    for (let y = 0; y < h; y++) {
      if (isBodyAnchorPixel(src, (y * w + x) * 4)) anchorY.push(y);
    }
    if (!anchorY.length) continue;

    const topY = Math.min(...anchorY);
    const botY = Math.max(...anchorY);
    const capFloorY = Math.max(0, topY - maxCapRise);
    /** Отдельная нижняя деталь (золотая крышка) — не тянем белый Ozon над ней. */
    const skipUpwardCap =
      botY > Math.round(h * 0.62) && topY > Math.round(h * 0.42);

    if (!skipUpwardCap) {
      for (let y = topY - 1; y >= capFloorY; y--) {
        const pi = (y * w + x) * 4;
        if (!readNearWhiteRgb(src, pi, 228, 40)) break;
        mark(x, y);
      }
    }

    for (let y = botY + 1; y <= Math.min(h - 1, botY + maxReflectionDrop); y++) {
      const pi = (y * w + x) * 4;
      if (!readNearWhiteRgb(src, pi, 234, 34)) break;
      mark(x, y);
    }
  }

  return keep;
}

function shouldKeepCosmeticsProductPixel(
  src: Buffer,
  whiteCapKeep: Uint8Array,
  idx: number
): boolean {
  const pi = idx * 4;
  if (whiteCapKeep[idx] === 1) return true;
  return isBodyAnchorPixel(src, pi);
}

/** Белый фон Ozon, связанный с краями кадра — прозрачный; колпачки из whiteCapKeep сохраняем. */
function purgeExteriorNearWhiteExceptCap(
  pixels: Buffer,
  src: Buffer,
  exterior: Uint8Array,
  whiteCapKeep: Uint8Array,
  w: number,
  h: number
): void {
  for (let idx = 0; idx < w * h; idx++) {
    if (whiteCapKeep[idx] === 1) continue;
    if (!exterior[idx]) continue;
    const pi = idx * 4;
    if (pixels[pi + 3]! < 128) continue;
    if (!readNearWhiteRgb(src, pi, 234, 34)) continue;
    pixels[pi + 3] = 0;
  }
}

/** Колонки без единого цветного пикселя — чистый белый Ozon (промежуток между частями). */
function cullWhiteOnlyOpaqueColumns(pixels: Buffer, w: number, h: number): void {
  for (let x = 0; x < w; x++) {
    let hasColor = false;
    let hasOpaque = false;
    for (let y = 0; y < h; y++) {
      const pi = (y * w + x) * 4;
      if (pixels[pi + 3]! < 128) continue;
      hasOpaque = true;
      if (!readNearWhiteRgb(pixels, pi, 234, 34)) {
        hasColor = true;
        break;
      }
    }
    if (!hasOpaque || hasColor) continue;
    for (let y = 0; y < h; y++) {
      const pi = (y * w + x) * 4;
      if (pixels[pi + 3]! < 128) continue;
      if (readNearWhiteRgb(pixels, pi, 234, 34)) pixels[pi + 3] = 0;
    }
  }
}

/** Восстановить белый колпачок только там, где strip сделал прозрачным. */
function restoreStrippedWhiteCaps(pixels: Buffer, src: Buffer, w: number, h: number): void {
  let coreMinX = w;
  let coreMaxX = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const pi = (y * w + x) * 4;
      if (pixels[pi + 3]! < 128) continue;
      if (readNearWhiteRgb(src, pi, 234, 34)) continue;
      coreMinX = Math.min(coreMinX, x);
      coreMaxX = Math.max(coreMaxX, x);
    }
  }
  if (coreMaxX < coreMinX) return;

  const padX = Math.max(3, Math.round((coreMaxX - coreMinX + 1) * 0.04));
  const x0 = Math.max(0, coreMinX - padX);
  const x1 = Math.min(w - 1, coreMaxX + padX);
  const minColoredRows = Math.max(24, Math.round(h * 0.08));
  const productW = coreMaxX - coreMinX + 1;
  const maxRise = Math.min(96, Math.max(36, Math.round(productW * 0.2)));

  const isPureWhiteSrc = (pi: number) => {
    const r = src[pi]!;
    const g = src[pi + 1]!;
    const b = src[pi + 2]!;
    const avg = (r + g + b) / 3;
    const spread = Math.max(r, g, b) - Math.min(r, g, b);
    return avg >= 252 && spread <= 8;
  };

  for (let x = x0; x <= x1; x++) {
    let bodyRows = 0;
    let minBodyY = h;
    for (let y = 0; y < h; y++) {
      const pi = (y * w + x) * 4;
      if (pixels[pi + 3]! < 128) continue;
      if (isPureWhiteSrc(pi)) continue;
      if (!isBodyAnchorPixel(src, pi)) continue;
      bodyRows++;
      minBodyY = Math.min(minBodyY, y);
    }
    if (bodyRows < minColoredRows) continue;

    for (let y = minBodyY - 1, rise = 0; y >= 0 && rise < maxRise; y--, rise++) {
      const pi = (y * w + x) * 4;
      if (!readNearWhiteRgb(src, pi, 228, 40)) break;
      if (isPaddingRow(src, w, y, x0, x1)) break;
      if (pixels[pi + 3]! >= 128) continue;
      pixels[pi] = src[pi]!;
      pixels[pi + 1] = src[pi + 1]!;
      pixels[pi + 2] = src[pi + 2]!;
      pixels[pi + 3] = 255;
    }
  }
}

/** Восстановить отдельные белые части (колпачок рядом со stick) в расширенном bbox кластера. */
function restoreNearbyWhiteSatellites(
  pixels: Buffer,
  src: Buffer,
  w: number,
  h: number
): void {
  const visited = new Uint8Array(w * h);
  const isSeed = (idx: number): boolean => {
    const pi = idx * 4;
    if (pixels[pi + 3]! < 128) return false;
    return !readNearWhiteRgb(src, pi, 234, 34);
  };

  for (let idx = 0; idx < w * h; idx++) {
    if (visited[idx] || !isSeed(idx)) continue;

    let minX = w;
    let maxX = -1;
    let minY = h;
    let maxY = -1;
    const queue = [idx];
    visited[idx] = 1;

    while (queue.length) {
      const cur = queue.pop()!;
      const x = cur % w;
      const y = (cur - x) / w;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);

      if (x > 0) {
        const n = cur - 1;
        if (!visited[n] && isSeed(n)) {
          visited[n] = 1;
          queue.push(n);
        }
      }
      if (x < w - 1) {
        const n = cur + 1;
        if (!visited[n] && isSeed(n)) {
          visited[n] = 1;
          queue.push(n);
        }
      }
      if (y > 0) {
        const n = cur - w;
        if (!visited[n] && isSeed(n)) {
          visited[n] = 1;
          queue.push(n);
        }
      }
      if (y < h - 1) {
        const n = cur + w;
        if (!visited[n] && isSeed(n)) {
          visited[n] = 1;
          queue.push(n);
        }
      }
    }

    const productW = maxX - minX + 1;
    const productH = maxY - minY + 1;
    const padX = Math.max(14, Math.round(productW * 0.22));
    const padY = Math.max(10, Math.round(productH * 0.1));
    const x0 = Math.max(0, minX - padX);
    const x1 = Math.min(w - 1, maxX + padX);
    const y0 = Math.max(0, minY - padY);
    const y1 = Math.min(h - 1, maxY + padY);

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const pi = (y * w + x) * 4;
        if (pixels[pi + 3]! >= 128) continue;
        if (!readNearWhiteRgb(src, pi, 228, 42)) continue;
        pixels[pi] = src[pi]!;
        pixels[pi + 1] = src[pi + 1]!;
        pixels[pi + 2] = src[pi + 2]!;
        pixels[pi + 3] = 255;
      }
    }
  }
}

/** Колонки только с белым (отдельный колпачок) — без полос Ozon сверху/снизу. */
function clampWhiteOnlyColumnsToOpaqueSpan(
  pixels: Buffer,
  w: number,
  h: number
): void {
  for (let x = 0; x < w; x++) {
    let hasColor = false;
    let minY = h;
    let maxY = -1;
    for (let y = 0; y < h; y++) {
      const pi = (y * w + x) * 4;
      if (pixels[pi + 3]! < 128) continue;
      const avg = (pixels[pi]! + pixels[pi + 1]! + pixels[pi + 2]!) / 3;
      if (avg < 236) hasColor = true;
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    if (hasColor || maxY < minY) continue;

    for (let y = 0; y < h; y++) {
      const pi = (y * w + x) * 4;
      if (pixels[pi + 3]! < 128) continue;
      if (y >= minY && y <= maxY) continue;
      pixels[pi + 3] = 0;
    }
  }
}

/** Полосы чистого белого Ozon над силуэтом (остаток после skipTopEdge / duo). */
function clearFullWidthTopWhiteBands(
  pixels: Buffer,
  src: Buffer,
  w: number,
  h: number
): void {
  let minColoredY = h;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const pi = (y * w + x) * 4;
      if (pixels[pi + 3]! < 128) continue;
      if (readNearWhiteRgb(src, pi, 236, 30)) continue;
      minColoredY = Math.min(minColoredY, y);
    }
  }
  if (minColoredY >= h) return;

  const capRise = Math.min(160, Math.max(72, Math.round(w * 0.14)));
  const clearUntil = Math.max(0, minColoredY - capRise);

  for (let y = 0; y < clearUntil; y++) {
    for (let x = 0; x < w; x++) {
      const pi = (y * w + x) * 4;
      if (pixels[pi + 3]! < 128) continue;
      if (!readNearWhiteRgb(pixels, pi, 234, 34)) continue;
      pixels[pi + 3] = 0;
    }
  }
}

/** В каждой колонке оставляем белый только над/под цветным телом (без полос Ozon сверху/снизу). */
function clampColumnWhiteToProductSpan(
  pixels: Buffer,
  src: Buffer,
  w: number,
  h: number
): void {
  let coreMinX = w;
  let coreMaxX = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const pi = (y * w + x) * 4;
      if (pixels[pi + 3]! < 128) continue;
      if (readNearWhiteRgb(src, pi, 234, 34)) continue;
      coreMinX = Math.min(coreMinX, x);
      coreMaxX = Math.max(coreMaxX, x);
    }
  }
  const productW = coreMaxX >= coreMinX ? coreMaxX - coreMinX + 1 : w;
  const maxCapRise = Math.min(118, Math.max(52, Math.round(productW * 0.17)));
  const maxReflection = Math.min(42, Math.max(14, Math.round(productW * 0.08)));

  for (let x = 0; x < w; x++) {
    let minColorY = h;
    let maxColorY = -1;
    for (let y = 0; y < h; y++) {
      const pi = (y * w + x) * 4;
      if (pixels[pi + 3]! < 128) continue;
      if (readNearWhiteRgb(src, pi, 234, 34)) continue;
      minColorY = Math.min(minColorY, y);
      maxColorY = Math.max(maxColorY, y);
    }
    if (maxColorY < minColorY) continue;

    const keepTop = Math.max(0, minColorY - maxCapRise);
    const keepBot = Math.min(h - 1, maxColorY + maxReflection);

    for (let y = 0; y < h; y++) {
      const pi = (y * w + x) * 4;
      if (pixels[pi + 3]! < 128) continue;
      if (!readNearWhiteRgb(src, pi, 234, 34)) continue;
      if (y >= keepTop && y <= keepBot) continue;
      pixels[pi + 3] = 0;
    }
  }
}

function finalizeEdgeCosmeticsPixels(
  pixels: Buffer,
  src: Buffer,
  w: number,
  h: number
): void {
  restoreStrippedWhiteCaps(pixels, src, w, h);
  purgeUnconnectedExteriorWhite(pixels, src, w, h);
  clampColumnWhiteToProductSpan(pixels, src, w, h);
  restoreNearbyWhiteSatellites(pixels, src, w, h);
  clampColumnWhiteToProductSpan(pixels, src, w, h);
  clampWhiteOnlyColumnsToOpaqueSpan(pixels, w, h);
  cullWhiteOnlyOpaqueColumns(pixels, w, h);
  trimHorizontalWhiteMargins(pixels, src, w, h);
  trimHorizontalWhiteMargins(pixels, src, w, h);
}

/** Убрать белый прямоугольник Ozon в центре — всё, что не связано с цветным телом через белые детали товара. */
function purgeUnconnectedExteriorWhite(
  pixels: Buffer,
  src: Buffer,
  w: number,
  h: number
): void {
  const product = new Uint8Array(w * h);
  const queue: number[] = [];

  const isOpaque = (idx: number): boolean => pixels[idx * 4 + 3]! >= 128;
  const isBridgeWhite = (idx: number): boolean => {
    const pi = idx * 4;
    return readNearWhiteRgb(src, pi, 228, 42);
  };
  const isColoredOpaque = (idx: number): boolean => {
    if (!isOpaque(idx)) return false;
    return !readNearWhiteRgb(src, idx * 4, 234, 34);
  };

  for (let idx = 0; idx < w * h; idx++) {
    if (!isColoredOpaque(idx)) continue;
    product[idx] = 1;
    queue.push(idx);
  }

  while (queue.length) {
    const idx = queue.pop()!;
    const x = idx % w;
    const y = (idx - x) / w;
    const neighbors = [
      x > 0 ? idx - 1 : -1,
      x < w - 1 ? idx + 1 : -1,
      y > 0 ? idx - w : -1,
      y < h - 1 ? idx + w : -1
    ];
    for (const n of neighbors) {
      if (n < 0 || product[n]) continue;
      if (!isOpaque(n)) continue;
      if (!isBridgeWhite(n) && !isColoredOpaque(n)) continue;
      product[n] = 1;
      queue.push(n);
    }
  }

  for (let idx = 0; idx < w * h; idx++) {
    if (product[idx]) continue;
    const pi = idx * 4;
    if (pixels[pi + 3]! < 128) continue;
    if (!readNearWhiteRgb(src, pi, 234, 34)) continue;
    pixels[pi + 3] = 0;
  }
}

/**
 * Непрозрачный белый колпачок над цветным телом (колонки с достаточным телом).
 * Нижние детали (золотая крышка) не трогаем.
 */
function reclaimOpaqueWhiteCapAboveBody(
  pixels: Buffer,
  src: Buffer,
  whiteCapKeep: Uint8Array,
  w: number,
  h: number
): void {
  let coreMinX = w;
  let coreMaxX = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const pi = (y * w + x) * 4;
      if (pixels[pi + 3]! < 128) continue;
      if (readNearWhiteRgb(src, pi, 234, 34)) continue;
      coreMinX = Math.min(coreMinX, x);
      coreMaxX = Math.max(coreMaxX, x);
    }
  }
  if (coreMaxX < coreMinX) return;

  const padX = Math.max(3, Math.round((coreMaxX - coreMinX + 1) * 0.04));
  const x0 = Math.max(0, coreMinX - padX);
  const x1 = Math.min(w - 1, coreMaxX + padX);
  const minColoredRows = Math.max(24, Math.round(h * 0.1));
  const productW = coreMaxX - coreMinX + 1;
  const maxRise = Math.min(72, Math.max(28, Math.round(productW * 0.16)));

  const isPureWhiteSrc = (pi: number) => {
    const r = src[pi]!;
    const g = src[pi + 1]!;
    const b = src[pi + 2]!;
    const avg = (r + g + b) / 3;
    const spread = Math.max(r, g, b) - Math.min(r, g, b);
    return avg >= 252 && spread <= 8;
  };

  for (let x = x0; x <= x1; x++) {
    let bodyRows = 0;
    let minBodyY = h;
    for (let y = 0; y < h; y++) {
      const pi = (y * w + x) * 4;
      if (pixels[pi + 3]! < 128) continue;
      if (isPureWhiteSrc(pi)) continue;
      if (!isBodyAnchorPixel(src, pi)) continue;
      bodyRows++;
      minBodyY = Math.min(minBodyY, y);
    }
    if (bodyRows < minColoredRows) continue;

    for (let y = minBodyY - 1, rise = 0; y >= 0 && rise < maxRise; y--, rise++) {
      const idx = y * w + x;
      const pi = idx * 4;
      if (!readNearWhiteRgb(src, pi, 228, 40)) break;
      if (isPaddingRow(src, w, y, x0, x1)) break;
      pixels[pi] = src[pi]!;
      pixels[pi + 1] = src[pi + 1]!;
      pixels[pi + 2] = src[pi + 2]!;
      pixels[pi + 3] = 255;
      whiteCapKeep[idx] = 1;
    }
  }
}

/** Убрать белый Ozon между частями товара (не связан с цветным телом). */
function purgeUnreachableWhiteOpaque(
  pixels: Buffer,
  whiteCapKeep: Uint8Array,
  w: number,
  h: number
): void {
  const n = w * h;
  const reach = new Uint8Array(n);
  const q: number[] = [];

  const isColoredOpaque = (idx: number) => {
    const pi = idx * 4;
    if (pixels[pi + 3]! < 128) return false;
    return !readNearWhiteRgb(pixels, pi, 234, 34);
  };

  for (let idx = 0; idx < n; idx++) {
    if (!isColoredOpaque(idx)) continue;
    reach[idx] = 1;
    q.push(idx);
  }

  while (q.length) {
    const idx = q.pop()!;
    const x = idx % w;
    const y = (idx - x) / w;
    const neighbors = [idx - 1, idx + 1, idx - w, idx + w];
    for (const j of neighbors) {
      if (j < 0 || j >= n) continue;
      if (reach[j]) continue;
      const pi = j * 4;
      if (pixels[pi + 3]! < 128) continue;
      if (isColoredOpaque(j)) {
        reach[j] = 1;
        q.push(j);
        continue;
      }
      if (readNearWhiteRgb(pixels, pi, 234, 34) && whiteCapKeep[j] === 1) {
        reach[j] = 1;
        q.push(j);
      }
    }
  }

  for (let idx = 0; idx < n; idx++) {
    const pi = idx * 4;
    if (pixels[pi + 3]! < 128) continue;
    if (!readNearWhiteRgb(pixels, pi, 234, 34)) continue;
    if (reach[idx]) continue;
    pixels[pi + 3] = 0;
  }
}

/**
 * Косметика на белом Ozon: маска из исходника — белые колпачки остаются непрозрачными,
 * без dilate/halo (нет «мазни» и дыр в белом).
 */
export async function extractCosmeticsPackshotFromWhite(input: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const w = info.width;
  const h = info.height;
  if (!w || !h) return input;

  const src = Buffer.from(data);
  const whiteCapKeep = buildVerticalWhiteCapKeepMask(src, w, h);
  const exterior = buildExteriorNearWhiteMask(src, w, h, 232);

  const pixels = Buffer.alloc(src.length);
  for (let idx = 0; idx < w * h; idx++) {
    const pi = idx * 4;
    pixels[pi] = src[pi]!;
    pixels[pi + 1] = src[pi + 1]!;
    pixels[pi + 2] = src[pi + 2]!;
    pixels[pi + 3] = shouldKeepCosmeticsProductPixel(src, whiteCapKeep, idx) ? 255 : 0;
  }

  purgeUnreachableWhiteOpaque(pixels, whiteCapKeep, w, h);

  for (let idx = 0; idx < w * h; idx++) {
    if (whiteCapKeep[idx] !== 1) continue;
    const pi = idx * 4;
    pixels[pi] = src[pi]!;
    pixels[pi + 1] = src[pi + 1]!;
    pixels[pi + 2] = src[pi + 2]!;
    pixels[pi + 3] = 255;
  }

  trimHorizontalWhiteMargins(pixels, src, w, h, whiteCapKeep);
  cullWhiteOnlyOpaqueColumns(pixels, w, h);
  reclaimOpaqueWhiteCapAboveBody(pixels, src, whiteCapKeep, w, h);
  purgeExteriorNearWhiteExceptCap(pixels, src, exterior, whiteCapKeep, w, h);
  trimHorizontalWhiteMargins(pixels, src, w, h, whiteCapKeep);

  return sharp(pixels, {
    raw: { width: w, height: h, channels: 4 }
  })
    .png()
    .toBuffer();
}

/** Жёсткая альфа: без полупрозрачного ореола вокруг товара. */
export async function binarizeProductAlpha(input: Buffer, threshold = 64): Promise<Buffer> {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixels = Buffer.from(data);
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i + 3] = pixels[i + 3]! >= threshold ? 255 : 0;
  }

  return sharp(pixels, {
    raw: { width: info.width, height: info.height, channels: 4 }
  })
    .png()
    .toBuffer();
}

/** Финал для косметики — без halo/fringe/dilate. */
export async function finalizeCosmeticsCutout(input: Buffer): Promise<Buffer> {
  return binarizeProductAlpha(input, 32);
}

/**
 * Восстанавливает белые детали товара (колпачки, перемычки) только в колонках над/между
 * цветным телом — без горизонтального заливания белого фона Ozon по бокам.
 */
export async function rebuildProductAlphaByColumn(
  cutout: Buffer,
  source: Buffer
): Promise<Buffer> {
  const { data, info } = await sharp(cutout)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const src = Buffer.from(await sharp(source).ensureAlpha().raw().toBuffer());

  const w = info.width;
  const h = info.height;
  if (!w || !h) return cutout;

  const pixels = Buffer.from(data);

  let coreMinX = w;
  let coreMaxX = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const pi = (y * w + x) * 4;
      if (!isProductAnchorPixel(pixels, pi, src)) continue;
      coreMinX = Math.min(coreMinX, x);
      coreMaxX = Math.max(coreMaxX, x);
    }
  }
  if (coreMaxX < coreMinX) return cutout;

  const padX = Math.max(2, Math.round((coreMaxX - coreMinX + 1) * 0.06));
  const x0 = Math.max(0, coreMinX - padX);
  const x1 = Math.min(w - 1, coreMaxX + padX);

  const restoreAt = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    pixels[i] = src[i]!;
    pixels[i + 1] = src[i + 1]!;
    pixels[i + 2] = src[i + 2]!;
    pixels[i + 3] = 255;
  };

  const opaqueAt = (x: number, y: number) => pixels[(y * w + x) * 4 + 3]! >= 20;

  const productW = coreMaxX - coreMinX + 1;
  const maxCapRise = Math.min(180, Math.max(56, Math.round(productW * 0.72)));

  for (let x = x0; x <= x1; x++) {
    const anchorY: number[] = [];
    const coloredAnchorY: number[] = [];
    for (let y = 0; y < h; y++) {
      const pi = (y * w + x) * 4;
      if (!isProductAnchorPixel(pixels, pi, src)) continue;
      anchorY.push(y);
      if (pixels[pi + 3]! >= 20 && !readNearWhiteRgb(pixels, pi, 242, 30)) {
        coloredAnchorY.push(y);
      }
    }
    if (!coloredAnchorY.length) continue;

    const yTopColored = Math.min(...coloredAnchorY);
    const yBot = Math.max(...anchorY);
    const yFillFrom = Math.max(0, yTopColored - maxCapRise);

    for (let y = yFillFrom; y <= yBot; y++) {
      const pi = (y * w + x) * 4;
      if (opaqueAt(x, y)) continue;
      if (!readNearWhiteRgb(src, pi, 236, 28)) continue;
      if (isPaddingRow(src, w, y, x0, x1)) continue;
      restoreAt(x, y);
    }

  }

  return sharp(pixels, {
    raw: { width: w, height: h, channels: 4 }
  })
    .png()
    .toBuffer();
}

/** Убрать непрозрачный белый фон, связанный с краем кадра (не через прозрачные «мосты»). */
export async function stripEdgeConnectedOpaqueWhite(input: Buffer): Promise<Buffer> {
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

  const isOpaqueWhite = (pi: number) =>
    pixels[pi + 3]! >= 20 && readNearWhiteRgb(pixels, pi, 240, 24);

  const tryPush = (idx: number) => {
    if (idx < 0 || idx >= w * h || visited[idx]) return;
    if (!isOpaqueWhite(idx * 4)) return;
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
    if (!isOpaqueWhite(pi)) continue;
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
export const restoreAttachedWhiteProductRegions = rebuildProductAlphaByColumn;

/** Ozon packshot: сначала серо-белый (#F5F5F5) с краёв, затем строгий белый. */

/** Ozon grid 600×800: не снимаем белый сверху (колпачок), потом чистим боковые поля. */

async function stripCosmeticsGridBackground(input: Buffer): Promise<Buffer> {
  let buf = await stripEdgeNearWhiteBackground(input, 236, { skipTopEdge: true });
  buf = await rebuildProductAlphaByColumn(buf, input);

  const { data: srcData, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const src = Buffer.from(srcData);
  const w = info.width;
  const h = info.height;
  const { data: cutData } = await sharp(buf)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixels = Buffer.from(cutData);
  if (w && h && src.length === pixels.length) {
    purgeUnconnectedExteriorWhite(pixels, src, w, h);
    purgeMultiPackshotInteriorGutters(pixels, src, w, h);
    clampColumnWhiteToProductSpan(pixels, src, w, h);
    clearFullWidthTopWhiteBands(pixels, src, w, h);
    buf = await sharp(pixels, {
      raw: { width: w, height: h, channels: 4 }
    })
      .png()
      .toBuffer();
  }

  return buf;
}

async function stripProductPackshotBackground(input: Buffer): Promise<Buffer> {
  let buf = await stripEdgeNearWhiteBackground(input, 236);
  buf = await stripProductEdgeBackground(buf);
  buf = await rebuildProductAlphaByColumn(buf, input);
  return buf;
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
  padRatio = 0.015,
  extraTopPad = 0
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
  const top = Math.max(0, minY - padY - extraTopPad);
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
  if (profile === "cosmetics" && PODRUZHKA_COSMETICS_FOTO_MODE === "raw") {
    return resized;
  }
  return profile === "cosmetics"
    ? finalizeCosmeticsCutout(resized)
    : finalizeProductCutout(resized);
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

  const footprint = computeOpaqueFootprint(pixels, w, h);

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
        if (footprint && isWhiteProductInteriorPixel(pixels, w, h, x, y, footprint)) {
          pixels[i + 3] = 255;
        } else {
          pixels[i + 3] = 0;
        }
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
      const pi = idx * 4;
      if (alpha[idx]! < 20 && readNearWhiteRgb(pixels, pi, 236, 28)) continue;
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

/** Колонки с товаром: белый колпачок и перемычки → alpha=255 (после resize/halo). */
export async function solidifyProductColumnStacks(input: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const w = info.width;
  const h = info.height;
  if (!w || !h) return input;

  const pixels = Buffer.from(data);
  const footprint = computeOpaqueFootprint(pixels, w, h);
  if (!footprint) return input;

  for (let x = footprint.x0; x <= footprint.x1; x++) {
    const anchorY: number[] = [];
    for (let y = 0; y < h; y++) {
      const pi = (y * w + x) * 4;
      if (isProductAnchorPixel(pixels, pi)) anchorY.push(y);
    }
    if (!anchorY.length) continue;

    const yTop = Math.min(...anchorY);
    const yBot = Math.max(...anchorY);

    for (let y = yTop; y <= yBot; y++) {
      const pi = (y * w + x) * 4;
      if (!readNearWhiteRgb(pixels, pi, 236, 30)) continue;
      if (pixels[pi + 3]! >= 250) continue;
      pixels[pi + 3] = 255;
    }

    for (let y = yTop - 1; y >= 0; y--) {
      const pi = (y * w + x) * 4;
      if (!readNearWhiteRgb(pixels, pi, 236, 30)) break;
      if (isPaddingRow(pixels, w, y, footprint.x0, footprint.x1)) break;
      pixels[pi + 3] = 255;
    }
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
  const footprint = computeOpaqueFootprint(src, w, h);

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
      if (
        footprint &&
        avg >= 238 &&
        spread <= 18 &&
        r - b <= 8 &&
        (isWhiteProductInteriorPixel(src, w, h, x, y, footprint) ||
          (x >= footprint.x0 &&
            x <= footprint.x1 &&
            (hasOpaqueAnchorInColumn(src, w, h, x, y, -1, footprint.x0, footprint.x1) ||
              hasOpaqueAnchorInColumn(src, w, h, x, y, 1, footprint.x0, footprint.x1))))
      ) {
        continue;
      }
      if (avg >= 242 && spread <= 16 && r - b <= 8) {
        pixels[i + 3] = 0;
      } else if (src[i + 3]! < 255 && avg >= 238 && spread <= 18 && r - b <= 8) {
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
      const neutral = r - b <= 12;
      // Светлый полупрозрачный ореол (белый Ozon / серая петля макета) — непрозрачный, иначе просвечивает фон
      if (neutral && avg >= 228 && spread <= 20) {
        pixels[i + 3] = 255;
        continue;
      }
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
  let buf = await solidifyProductColumnStacks(input);
  buf = await removeBoundaryWhiteHalo(buf);
  buf = await solidifyProductInterior(buf);
  buf = await solidifyProductColumnStacks(buf);
  buf = await removeSemiTransparentWhiteFringe(buf);
  buf = await stripEdgeConnectedOpaqueWhite(buf);
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
  buf = await stripProductPackshotBackground(buf);
  buf = await stripProductFloorShadow(buf, {
    avgMin: 90,
    avgMax: 172,
    maxSpread: 14,
    maxWarmth: 6
  });
  buf = await dilateProductAlpha(buf, 1);
  buf = await stripEdgeConnectedOpaqueWhite(buf);
  buf = await removeSemiTransparentWhiteFringe(buf);
  buf = await cleanPerfumeAlphaFringe(buf);
  buf = await collapseInternalHorizontalGaps(buf);
  buf = await trimTransparentSafe(buf);
  buf = await cropToVisibleProduct(buf, 8, 0.028);
  return finalizeProductCutout(buf);
}

/**
 * Косметика: апскейл + strip белого/серого Ozon от всех краёв, затем восстановление колпачков.
 */

/** Essie: белый колпачок на белом Ozon — cut-out на сетке 600×800, без AI и без edge-flood. */
async function preprocessEssieWhiteCapPackshot(input: Buffer): Promise<Buffer> {
  if (await isMultiProductPackshot(input)) return preprocessCosmeticsGridPackshot(input);
  if (await shouldUseExtractWhitePath(input)) return preprocessWhiteOnWhitePackshot(input);
  return preprocessCosmeticsGridPackshot(input);
}

export async function preprocessCosmeticsProductBufferEdge(input: Buffer): Promise<Buffer> {
  let buf = await enhanceSourceForProcessing(input);
  const { data: srcData, info } = await sharp(buf)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const src = Buffer.from(srcData);
  const w = info.width;
  const h = info.height;

  // Ozon packshot: белый/серый #F5F5F5 с краёв (fallback при промахе AI-кэша).
  buf = await stripProductPackshotBackground(buf);
  buf = await stripEdgeNearWhiteBackground(buf, 232);

  const { data: cutData } = await sharp(buf)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixels = Buffer.from(cutData);
  if (w && h && src.length === pixels.length) {
    finalizeEdgeCosmeticsPixels(pixels, src, w, h);
    buf = await sharp(pixels, {
      raw: { width: w, height: h, channels: 4 }
    })
      .png()
      .toBuffer();
  }

  buf = await trimTransparentSafe(buf);
  buf = await cropToVisibleProduct(buf, 8, 0.024, 8);
  return finalizeCosmeticsCutout(buf);
}


function measureNearWhiteOpaqueRatio(pixels: Buffer, w: number, h: number): number {
  let tot = 0;
  let white = 0;
  for (let idx = 0; idx < w * h; idx++) {
    const pi = idx * 4;
    if (pixels[pi + 3]! < 128) continue;
    tot++;
    if (readNearWhiteRgb(pixels, pi, 234, 34)) white++;
  }
  return tot ? white / tot : 0;
}

/** Убрать белый прямоугольник Ozon из AI cut-out (Essie и др. white-on-white). */

/** Белый колпачок на белом Ozon (Essie и др.) — AI оставляет белый прямоугольник. */
/** Essie nail lacquer on Ozon — white cap on white bg, AI leaves white box. */
const ESSIE_OZON_FOTO_RE = /\/1061258\d+\.jpg/i;


/** Несколько товаров в одном Ozon foto (3-in-1 румяна и т.п.). */
async function isMultiProductPackshot(input: Buffer): Promise<boolean> {
  const buf = await enhanceSourceForProcessing(input);
  const { data, info } = await sharp(buf)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const w = info.width ?? 0;
  const h = info.height ?? 0;
  if (!w || !h) return false;

  const colColor = new Uint16Array(w);
  for (let x = 0; x < w; x++) {
    let n = 0;
    for (let y = 0; y < h; y++) {
      const pi = (y * w + x) * 4;
      if (!readNearWhiteRgb(data, pi, 236, 32) && isSubstantiveSourcePixel(data, pi)) n++;
    }
    colColor[x] = n;
  }

  const minCol = Math.max(12, Math.round(h * 0.02));
  const minRun = Math.max(28, Math.round(w * 0.06));
  const minGap = Math.max(10, Math.round(w * 0.012));
  const maxRunFrac = 0.34;

  const runs: { x0: number; x1: number }[] = [];
  let runStart = -1;
  for (let x = 0; x < w; x++) {
    const active = colColor[x]! >= minCol;
    if (active && runStart < 0) runStart = x;
    if (!active && runStart >= 0) {
      if (x - runStart >= minRun) runs.push({ x0: runStart, x1: x - 1 });
      runStart = -1;
    }
  }
  if (runStart >= 0 && w - runStart >= minRun) runs.push({ x0: runStart, x1: w - 1 });
  if (runs.length < 2) return false;

  for (const run of runs) {
    const runW = run.x1 - run.x0 + 1;
    if (runW / w > maxRunFrac) return false;
  }

  let wideGaps = 0;
  for (let i = 1; i < runs.length; i++) {
    const gap = runs[i]!.x0 - runs[i - 1]!.x1 - 1;
    if (gap >= minGap) wideGaps++;
  }
  return wideGaps >= runs.length - 1;
}

/** Убрать белые/серые «прослойки» между несколькими товарами в одном foto. */
function purgeMultiPackshotInteriorGutters(
  pixels: Buffer,
  src: Buffer,
  w: number,
  h: number
): void {
  const colColor = new Uint16Array(w);
  for (let x = 0; x < w; x++) {
    let n = 0;
    for (let y = 0; y < h; y++) {
      const pi = (y * w + x) * 4;
      if (!readNearWhiteRgb(src, pi, 236, 32) && isSubstantiveSourcePixel(src, pi)) n++;
    }
    colColor[x] = n;
  }

  const minCol = Math.max(12, Math.round(h * 0.02));
  const minRun = Math.max(28, Math.round(w * 0.06));
  const minGap = Math.max(8, Math.round(w * 0.01));

  const runs: { x0: number; x1: number }[] = [];
  let runStart = -1;
  for (let x = 0; x < w; x++) {
    const active = colColor[x]! >= minCol;
    if (active && runStart < 0) runStart = x;
    if (!active && runStart >= 0) {
      if (x - runStart >= minRun) runs.push({ x0: runStart, x1: x - 1 });
      runStart = -1;
    }
  }
  if (runStart >= 0 && w - runStart >= minRun) runs.push({ x0: runStart, x1: w - 1 });
  if (runs.length < 2) return;

  const isGutterPixel = (pi: number) => {
    if (!readNearWhiteRgb(src, pi, 238, 34)) return false;
    const r = src[pi]!;
    const g = src[pi + 1]!;
    const b = src[pi + 2]!;
    const avg = (r + g + b) / 3;
    const spread = Math.max(r, g, b) - Math.min(r, g, b);
    return avg >= 168 && spread <= 28;
  };

  for (let i = 1; i < runs.length; i++) {
    const gapX0 = runs[i - 1]!.x1 + 1;
    const gapX1 = runs[i]!.x0 - 1;
    if (gapX1 - gapX0 + 1 < minGap) continue;
    for (let x = gapX0; x <= gapX1; x++) {
      let coloredOpaque = 0;
      for (let y = 0; y < h; y++) {
        const pi = (y * w + x) * 4;
        if (pixels[pi + 3]! < 128) continue;
        if (!readNearWhiteRgb(src, pi, 236, 32)) coloredOpaque++;
      }
      for (let y = 0; y < h; y++) {
        const pi = (y * w + x) * 4;
        if (pixels[pi + 3]! < 128) continue;
        if (coloredOpaque >= 8 && !isGutterPixel(pi)) continue;
        pixels[pi + 3] = 0;
      }
    }
  }
}

async function finalizeExtractCosmeticsPixels(
  buf: Buffer,
  srcFitBuf: Buffer
): Promise<Buffer> {
  const { data: srcData, info } = await sharp(srcFitBuf)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const src = Buffer.from(srcData);
  const w = info.width;
  const h = info.height;
  const { data: cutData } = await sharp(buf)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixels = Buffer.from(cutData);
  if (!w || !h || src.length !== pixels.length) return buf;

  purgeUnconnectedExteriorWhite(pixels, src, w, h);
  clampColumnWhiteToProductSpan(pixels, src, w, h);
  clearFullWidthTopWhiteBands(pixels, src, w, h);

  buf = await sharp(pixels, {
    raw: { width: w, height: h, channels: 4 }
  })
    .png()
    .toBuffer();

  buf = await stripEdgeConnectedOpaqueWhite(buf);
  buf = await removeSemiTransparentWhiteFringe(buf);
  return buf;
}

async function preprocessCosmeticsGridPackshot(input: Buffer): Promise<Buffer> {
  const source = await enhanceSourceForProcessing(input);
  const srcMeta = await sharp(source).metadata();
  const sw = srcMeta.width ?? 0;
  const sh = srcMeta.height ?? 0;

  const srcFitBuf = await fitCosmeticsOzonGrid(input);

  let buf = await stripCosmeticsGridBackground(srcFitBuf);
  buf = await trimTransparentSafe(buf);
  buf = await cropToVisibleProduct(buf, 8, 0.024, 12);

  if (sw && sh && (sw !== 600 || sh !== 800)) {
    buf = await sharp(buf)
      .resize(sw, sh, { fit: "inside", kernel: sharp.kernel.lanczos3 })
      .png()
      .toBuffer();
  }

  buf = await stripEdgeConnectedOpaqueWhite(buf);
  buf = await removeSemiTransparentWhiteFringe(buf);
  buf = await trimTransparentSafe(buf);
  return finalizeCosmeticsCutout(buf);
}

async function preprocessWhiteOnWhitePackshot(input: Buffer): Promise<Buffer> {
  const source = await enhanceSourceForProcessing(input);
  const srcMeta = await sharp(source).metadata();
  const sw = srcMeta.width ?? 0;
  const sh = srcMeta.height ?? 0;

  const srcFitBuf = await fitCosmeticsOzonGrid(input);

  let buf = await extractCosmeticsPackshotFromWhite(srcFitBuf);
  buf = await finalizeExtractCosmeticsPixels(buf, srcFitBuf);
  buf = await trimTransparentSafe(buf);
  buf = await cropToVisibleProduct(buf, 8, 0.024, 12);

  if (sw && sh && (sw !== 600 || sh !== 800)) {
    buf = await sharp(buf)
      .resize(sw, sh, { fit: "inside", kernel: sharp.kernel.lanczos3 })
      .png()
      .toBuffer();
  }

  buf = await trimTransparentSafe(buf);
  return finalizeCosmeticsCutout(buf);
}


/** Узкий товар на белом (тюбик) — extract; широкие с декором — grid strip. */
async function shouldUseExtractWhitePath(input: Buffer): Promise<boolean> {
  const buf = await enhanceSourceForProcessing(input);
  const { data, info } = await sharp(buf)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const w = info.width ?? 0;
  const h = info.height ?? 0;
  if (!w || !h) return false;

  let minX = w;
  let maxX = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const pi = (y * w + x) * 4;
      if (!readNearWhiteRgb(data, pi, 236, 32) && isSubstantiveSourcePixel(data, pi)) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
      }
    }
  }
  if (maxX < minX) return false;
  return (maxX - minX + 1) / w < 0.72;
}

async function isWhiteOnWhitePackshot(input: Buffer): Promise<boolean> {
  const buf = await enhanceSourceForProcessing(input);
  const { data, info } = await sharp(buf)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const w = info.width ?? 0;
  const h = info.height ?? 0;
  if (!w || !h) return false;

  const topRows = Math.max(8, Math.round(h * 0.14));
  let whiteTop = 0;
  let colored = 0;
  let minX = w;
  let maxX = -1;
  let minY = h;
  let maxY = -1;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const pi = (y * w + x) * 4;
      const nearWhite = readNearWhiteRgb(data, pi, 240, 34);
      if (y < topRows && nearWhite) whiteTop++;
      if (!nearWhite && isSubstantiveSourcePixel(data, pi)) {
        colored++;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  }

  const topWhiteRatio = whiteTop / (topRows * w);
  const coloredRatio = colored / (w * h);
  if (maxX < minX || maxY < minY) return false;

  const productAspect = (maxX - minX + 1) / (maxY - minY + 1);
  const touchesTop = minY <= Math.max(2, Math.round(h * 0.02));
  const narrowOnWhite =
    productAspect < 0.52 && touchesTop && topWhiteRatio > 0.65 && coloredRatio > 0.03;
  const classicWhiteBg =
    topWhiteRatio > 0.75 && coloredRatio > 0.04 && coloredRatio < 0.6;

  return narrowOnWhite || classicWhiteBg;
}


async function scrubAiCosmeticsWhiteFringe(
  cutout: Buffer,
  srcFitBuf: Buffer
): Promise<Buffer> {
  const [{ data, info }, srcFit] = await Promise.all([
    sharp(cutout).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(srcFitBuf).ensureAlpha().raw().toBuffer()
  ]);
  const w = info.width;
  const h = info.height;
  if (!w || !h || srcFit.length !== data.length) return cutout;

  const pixels = Buffer.from(data);
  clearFullWidthTopWhiteBands(pixels, srcFit, w, h);
  finalizeEdgeCosmeticsPixels(pixels, srcFit, w, h);
  return sharp(pixels, {
    raw: { width: w, height: h, channels: 4 }
  })
    .png()
    .toBuffer();
}

/** Подогнать AI cut-out под размер апскейленного исходника (кэш rmbg — с сырого Ozon). */
async function alignCutoutToSource(cutout: Buffer, source: Buffer): Promise<Buffer> {
  const srcMeta = await sharp(source).metadata();
  const cutMeta = await sharp(cutout).metadata();
  const sw = srcMeta.width ?? 0;
  const sh = srcMeta.height ?? 0;
  const cw = cutMeta.width ?? 0;
  const ch = cutMeta.height ?? 0;
  if (!sw || !sh || (sw === cw && sh === ch)) return cutout;
  return sharp(cutout)
    .resize(sw, sh, { fit: "fill", kernel: sharp.kernel.lanczos3 })
    .png()
    .toBuffer();
}

/**
 * AI cut-out часто «съедает» колпачки. В сетке rmbg (600×800) объединяем AI с edge-маской
 * из исходника — edge заполняет пропуски над телом, AI сохраняет чистые боковые края.
 */
async function repairAiCosmeticsCutout(cutout: Buffer, source: Buffer): Promise<Buffer> {
  const cutMeta = await sharp(cutout).metadata();
  const cw = cutMeta.width ?? 0;
  const ch = cutMeta.height ?? 0;
  if (!cw || !ch) return cutout;

  const srcFitBuf = await sharp(source)
    .resize(cw, ch, { fit: "fill", kernel: sharp.kernel.lanczos3 })
    .png()
    .toBuffer();
  const edgeBuf = await extractCosmeticsPackshotFromWhite(srcFitBuf);

  const [{ data: aiData, info }, edgeRaw, srcFit] = await Promise.all([
    sharp(cutout).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(edgeBuf).ensureAlpha().raw().toBuffer(),
    sharp(srcFitBuf).ensureAlpha().raw().toBuffer()
  ]);

  const w = info.width;
  const h = info.height;
  if (w !== cw || h !== ch || srcFit.length !== aiData.length || edgeRaw.length !== aiData.length) {
    return alignCutoutToSource(cutout, source);
  }

  let minX = w;
  let maxX = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (aiData[(y * w + x) * 4 + 3]! < 128) continue;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
    }
  }
  if (maxX < minX) return alignCutoutToSource(cutout, source);

  const padX = Math.max(4, Math.round((maxX - minX + 1) * 0.05));
  const x0 = Math.max(0, minX - padX);
  const x1 = Math.min(w - 1, maxX + padX);
  const capPad = Math.max(20, Math.round(h * 0.035));
  const capMaxRows = Math.max(capPad, Math.round(h * 0.14));

  const aiTop = new Int32Array(w);
  aiTop.fill(h);
  for (let x = x0; x <= x1; x++) {
    for (let y = 0; y < h; y++) {
      if (aiData[(y * w + x) * 4 + 3]! >= 128) {
        aiTop[x] = y;
        break;
      }
    }
  }

  const pixels = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const pi = (y * w + x) * 4;
      const aa = aiData[pi + 3]!;
      const ea = edgeRaw[pi + 3]!;
      const inX = x >= x0 && x <= x1;
      const top = aiTop[x]!;
      const inCapZone =
        inX && top < h && y < top && y >= Math.max(0, top - capMaxRows);

      if (aa >= 128) {
        pixels[pi] = aiData[pi]!;
        pixels[pi + 1] = aiData[pi + 1]!;
        pixels[pi + 2] = aiData[pi + 2]!;
        pixels[pi + 3] = 255;
      } else if (inCapZone && ea >= 128) {
        pixels[pi] = srcFit[pi]!;
        pixels[pi + 1] = srcFit[pi + 1]!;
        pixels[pi + 2] = srcFit[pi + 2]!;
        pixels[pi + 3] = 255;
      }
    }
  }

  let buf = await sharp(pixels, {
    raw: { width: w, height: h, channels: 4 }
  })
    .png()
    .toBuffer();

  buf = await rebuildProductAlphaByColumn(buf, srcFitBuf);
  buf = await scrubAiCosmeticsWhiteFringe(buf, srcFitBuf);

  const srcMeta = await sharp(source).metadata();
  const sw = srcMeta.width ?? 0;
  const sh = srcMeta.height ?? 0;
  if (sw && sh && (sw !== w || sh !== h)) {
    buf = await sharp(buf)
      .resize(sw, sh, { fit: "fill", kernel: sharp.kernel.lanczos3 })
      .png()
      .toBuffer();
  }
  return buf;
}


/**
 * Косметика: локальная AI-модель (rmbg) + кэш в Yandex. При ошибке — edge.
 */
export async function preprocessCosmeticsProductBufferAi(
  input: Buffer,
  sourceUrl: string
): Promise<Buffer> {
  if (!sourceUrl.trim()) {
    return preprocessCosmeticsProductBufferEdge(input);
  }

  if (ESSIE_OZON_FOTO_RE.test(sourceUrl) || (await isWhiteOnWhitePackshot(input))) {
    return preprocessEssieWhiteCapPackshot(input);
  }

  const source = await enhanceSourceForProcessing(input);
  let buf: Buffer;
  try {
    buf = await fetchAiCutout(sourceUrl);
  } catch (e) {
    console.warn("ai cutout failed, fallback to edge:", e);
    return preprocessCosmeticsProductBufferEdge(input);
  }

  buf = await repairAiCosmeticsCutout(buf, source);
  buf = await trimTransparentSafe(buf);
  buf = await cropToVisibleProduct(buf, 8, 0.022, 14);

  const { data: scrubCheck, info: scrubInfo } = await sharp(buf)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const sw = scrubInfo.width ?? 0;
  const sh = scrubInfo.height ?? 0;
  if (sw && sh) {
    const whiteRatio = measureNearWhiteOpaqueRatio(Buffer.from(scrubCheck), sw, sh);
    if (whiteRatio > 0.18) {
      console.warn(`ai cutout near-white ratio ${whiteRatio.toFixed(2)}, edge fallback`);
      return preprocessCosmeticsProductBufferEdge(input);
    }
  }

  return finalizeCosmeticsCutout(buf);
}

/**
 * Косметика: только апскейл исходника — foto вставляется в шаблон как на Ozon.
 */
export async function preprocessCosmeticsProductBufferRaw(input: Buffer): Promise<Buffer> {
  const buf = await enhanceSourceForProcessing(input);
  return sharp(buf).png({ compressionLevel: 6 }).toBuffer();
}

/**
 * Косметика на белом (Ozon): апскейл → мягкий cut-out → dilate.
 * Не вызываем cleanProductAlphaFringe — он «съедал» бежевые края.
 */

/** Белый ореол (255/255/255 с alpha) на сером фоне — снимаем у границы с прозрачностью. */
async function purgeNearWhiteOpaqueFringe(input: Buffer, threshold = 236): Promise<Buffer> {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const w = info.width ?? 0;
  const h = info.height ?? 0;
  if (!w || !h) return input;

  const pixels = Buffer.from(data);
  const isOpaque = (pi: number) => pixels[pi + 3]! >= 128;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const pi = (y * w + x) * 4;
      if (!isOpaque(pi) || !readNearWhiteRgb(pixels, pi, threshold, 34)) continue;
      let touches = x === 0 || y === 0 || x === w - 1 || y === h - 1;
      if (!touches && x > 0 && !isOpaque(pi - 4)) touches = true;
      if (!touches && x < w - 1 && !isOpaque(pi + 4)) touches = true;
      if (!touches && y > 0 && !isOpaque(pi - w * 4)) touches = true;
      if (!touches && y < h - 1 && !isOpaque(pi + w * 4)) touches = true;
      if (touches) pixels[pi + 3] = 0;
    }
  }

  return sharp(pixels, {
    raw: { width: w, height: h, channels: 4 }
  })
    .png()
    .toBuffer();
}

export async function preprocessCosmeticsProductBuffer(input: Buffer): Promise<Buffer> {
  if (await isMultiProductPackshot(input)) {
    return preprocessCosmeticsGridPackshot(input);
  }
  if (
    (await isWhiteOnWhitePackshot(input)) &&
    (await shouldUseExtractWhitePath(input))
  ) {
    return preprocessWhiteOnWhitePackshot(input);
  }
  return preprocessCosmeticsGridPackshot(input);
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
  profile: PodruzhkaRenderProfile = "perfume",
  opts?: { sourceUrl?: string }
): Promise<PreparedProductImage> {
  const buffer =
    profile === "cosmetics"
      ? PODRUZHKA_COSMETICS_FOTO_MODE === "raw"
        ? await preprocessCosmeticsProductBufferRaw(input)
        : PODRUZHKA_COSMETICS_FOTO_MODE === "ai"
          ? await preprocessCosmeticsProductBufferAi(input, opts?.sourceUrl ?? "")
          : PODRUZHKA_COSMETICS_FOTO_MODE === "edge"
            ? await preprocessCosmeticsProductBufferEdge(input)
            : await preprocessCosmeticsProductBuffer(input)
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
      const extracted = await sharp(scaledBuf)
        .extract({ left, top: 0, width: maxW, height })
        .png()
        .toBuffer();
      buffer =
        profile === "cosmetics" && PODRUZHKA_COSMETICS_FOTO_MODE === "raw"
          ? extracted
          : await (profile === "cosmetics" ? finalizeCosmeticsCutout : finalizeProductCutout)(
              extracted
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

