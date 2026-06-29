import sharp from "sharp";
import { cropToVisibleProduct } from "@/lib/podruzhkaImageProcess";
import {
  LETUAL_ASPECT_VERTICAL_MIN,
  LETUAL_ASPECT_WIDE_LOW_MIN,
  LETUAL_CANVAS_SIZE,
  LETUAL_SIDE_MARGIN_SQUARE,
  LETUAL_SIDE_MARGIN_WIDE_LOW,
  type LetualLayoutType
} from "@/lib/letualMainPhotoConstants";

export function classifyLetualLayout(width: number, height: number): LetualLayoutType {
  if (width <= 0 || height <= 0) return "square_wide";
  const hOverW = height / width;
  const wOverH = width / height;
  if (hOverW > LETUAL_ASPECT_VERTICAL_MIN) return "vertical";
  if (wOverH > LETUAL_ASPECT_WIDE_LOW_MIN) return "wide_low";
  return "square_wide";
}

export type LetualPlacement = {
  layout: LetualLayoutType;
  left: number;
  top: number;
  width: number;
  height: number;
};

/**
 * Рассчитать размер и позицию товара на квадратном полотне.
 * A (vertical): от верхней до нижней границы, без отступов сверху/снизу.
 * B (square_wide): по нижней границе, боковые отступы не меньше 130px.
 * C (wide_low): по нижней границе, боковые отступы не меньше 50px.
 */
export function computeLetualPlacement(
  productW: number,
  productH: number,
  canvasW = LETUAL_CANVAS_SIZE,
  canvasH = canvasW
): LetualPlacement {
  const layout = classifyLetualLayout(productW, productH);
  const marginScale = canvasW / LETUAL_CANVAS_SIZE;

  if (layout === "vertical") {
    const scale = canvasH / productH;
    const w = Math.round(productW * scale);
    const h = canvasH;
    const left = Math.round((canvasW - w) / 2);
    return { layout, left, top: 0, width: w, height: h };
  }

  const sideMargin = Math.round(
    (layout === "wide_low" ? LETUAL_SIDE_MARGIN_WIDE_LOW : LETUAL_SIDE_MARGIN_SQUARE) *
      marginScale
  );
  const maxW = canvasW - sideMargin * 2;
  const scale = Math.min(maxW / productW, canvasH / productH);
  const w = Math.round(productW * scale);
  const h = Math.round(productH * scale);
  const left = Math.round((canvasW - w) / 2);
  const top = canvasH - h;
  return { layout, left, top, width: w, height: h };
}

/** Скомпоновать PNG с альфой на белом квадратном JPEG. */
export async function compositeLetualMainPhoto(
  productPng: Buffer,
  canvas = LETUAL_CANVAS_SIZE
): Promise<Buffer> {
  const cropped = await cropToVisibleProduct(productPng, 8, 0.02, 4);
  const silhouette = await measureProductSilhouette(cropped);
  const placement = computeLetualPlacement(silhouette.width, silhouette.height, canvas);

  const resized = await sharp(cropped)
    .resize(placement.width, placement.height, { fit: "fill" })
    .png()
    .toBuffer();

  return sharp({
    create: {
      width: canvas,
      height: canvas,
      channels: 3,
      background: { r: 255, g: 255, b: 255 }
    }
  })
    .composite([{ input: resized, left: placement.left, top: placement.top }])
    .jpeg({ quality: 92, mozjpeg: true })
    .toBuffer();
}

/**
 * Фото уже на белом (CDN /huge/) — без cutout pipeline, только вписать в квадрат 1000×1000.
 * Для Яндекс Маркета, если полный pipeline Летуаль не сработал.
 */
export async function compositeFlatImageToLetualCanvas(
  raw: Buffer,
  canvas = LETUAL_CANVAS_SIZE
): Promise<Buffer> {
  const meta = await sharp(raw).metadata();
  const pw = meta.width ?? 1;
  const ph = meta.height ?? 1;
  const placement = computeLetualPlacement(pw, ph, canvas, canvas);
  const resized = await sharp(raw)
    .resize(placement.width, placement.height, { fit: "fill" })
    .toBuffer();

  return sharp({
    create: {
      width: canvas,
      height: canvas,
      channels: 3,
      background: { r: 255, g: 255, b: 255 }
    }
  })
    .composite([{ input: resized, left: placement.left, top: placement.top }])
    .jpeg({ quality: 92, mozjpeg: true })
    .toBuffer();
}

export async function measureProductSilhouette(
  png: Buffer
): Promise<{ width: number; height: number; layout: LetualLayoutType }> {
  const { data, info } = await sharp(png)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3]! < 14) continue;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < minX) return { width: w, height: h, layout: "square_wide" };
  const bw = maxX - minX + 1;
  const bh = maxY - minY + 1;
  return { width: bw, height: bh, layout: classifyLetualLayout(bw, bh) };
}
