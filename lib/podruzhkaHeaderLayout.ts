/**
 * Верхний блок: brand → type → model с зазорами из Figma.
 * Нижние блоки (ноты, ml, foto) — фиксированные координаты.
 */
import { PODRUZHKA_FIGMA as F } from "@/lib/podruzhkaFigmaLayout";
import {
  DEFAULT_BRAND_BOX,
  type TextMeasure,
  resolveBrandLines,
  type BrandLayoutInput
} from "@/lib/podruzhkaBrandLayout";

export const FIGMA_HEADER_GAPS = {
  brandTop: F.brand.y,
  afterBrand: F.productType.y - (F.brand.y + F.brand.h),
  afterProductType: F.model.y - (F.productType.y + F.productType.h),
  afterModel: F.notesPinkBar.y - (F.model.y + F.model.h),
  maxModelBottom: F.model.y + F.model.h
} as const;

export type TextBlock = {
  y: number;
  size: number;
  lines: string[];
  lineHeight: number;
};

export type HeaderStackLayout = {
  brand: TextBlock;
  productType: TextBlock;
  model: TextBlock;
  notesPinkBarY: number;
};

function blockHeight(lines: number, fontSize: number, lineHeight: number): number {
  if (lines <= 0) return 0;
  return lines * Math.round(fontSize * lineHeight);
}

function wrapLines(
  m: TextMeasure,
  text: string,
  font: string,
  maxWidth: number,
  maxLines: number
): string[] {
  m.setFont(font);
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines: string[] = [];
  let line = words[0]!;
  for (let i = 1; i < words.length; i++) {
    const w = words[i]!;
    const test = `${line} ${w}`;
    if (m.textWidth(test) > maxWidth) {
      lines.push(line);
      line = w;
      if (lines.length >= maxLines) return lines;
    } else line = test;
  }
  lines.push(line);
  return lines.slice(0, maxLines);
}

function fitModel(
  m: TextMeasure,
  model: string,
  fontForSize: (size: number) => string,
  maxWidth: number,
  maxSize: number,
  minSize: number,
  maxLines: number,
  lineHeight: number
): { size: number; lines: string[] } {
  for (let size = maxSize; size >= minSize; size -= 2) {
    const font = fontForSize(size);
    const lines = wrapLines(m, model, font, maxWidth, maxLines);
    m.setFont(font);
    const widest = Math.max(...lines.map((ln) => m.textWidth(ln)), 0);
    if (widest <= maxWidth) return { size, lines };
  }
  const size = minSize;
  return {
    size,
    lines: wrapLines(m, model, fontForSize(size), maxWidth, maxLines)
  };
}

export type HeaderLayoutInput = {
  brandName: string;
  productType: string;
  model: string;
  brandFontForSize: (size: number) => string;
  bodyFontForSize: (size: number, weight: number) => string;
  brandLineHeight: number;
  typeLineHeight: number;
  modelLineHeight: number;
  typeSize: number;
  modelMaxSize: number;
  modelMinSize: number;
};

export function computeHeaderStack(
  m: TextMeasure,
  input: HeaderLayoutInput
): HeaderStackLayout {
  const brandInput: BrandLayoutInput = {
    brandName: input.brandName,
    maxSize: DEFAULT_BRAND_BOX.maxSize,
    minSize: DEFAULT_BRAND_BOX.minSize,
    maxWidth: DEFAULT_BRAND_BOX.maxWidth,
    maxHeight: DEFAULT_BRAND_BOX.maxHeight,
    maxLines: DEFAULT_BRAND_BOX.maxLines,
    lineHeight: input.brandLineHeight,
    fontForSize: input.brandFontForSize
  };

  let brand = resolveBrandLines(m, brandInput);
  let model = fitModel(
    m,
    input.model,
    (s) => input.bodyFontForSize(s, 800),
    F.model.w,
    input.modelMaxSize,
    input.modelMinSize,
    2,
    input.modelLineHeight
  );

  const typeText = input.productType.trim().toLowerCase();
  const typeSize = input.typeSize;
  let typeLines = typeText
    ? wrapLines(m, typeText, input.bodyFontForSize(typeSize, 400), F.productType.w, 2)
    : [];

  const stack = (): HeaderStackLayout => {
    let y = FIGMA_HEADER_GAPS.brandTop;
    const brandBlock: TextBlock = {
      y,
      size: brand.size,
      lines: brand.lines,
      lineHeight: input.brandLineHeight
    };
    y += blockHeight(brand.lines.length, brand.size, input.brandLineHeight);
    y += FIGMA_HEADER_GAPS.afterBrand;

    const typeBlock: TextBlock = {
      y,
      size: typeSize,
      lines: typeLines,
      lineHeight: input.typeLineHeight
    };
    if (typeLines.length) {
      y += blockHeight(typeLines.length, typeSize, input.typeLineHeight);
    }
    y += FIGMA_HEADER_GAPS.afterProductType;

    const modelBlock: TextBlock = {
      y,
      size: model.size,
      lines: model.lines,
      lineHeight: input.modelLineHeight
    };
    const modelBottom =
      y + blockHeight(model.lines.length, model.size, input.modelLineHeight);
    const notesPinkBarY = modelBottom + FIGMA_HEADER_GAPS.afterModel;

    return {
      brand: brandBlock,
      productType: typeBlock,
      model: modelBlock,
      notesPinkBarY
    };
  };

  let layout = stack();
  let modelBottom =
    layout.model.y +
    blockHeight(layout.model.lines.length, layout.model.size, layout.model.lineHeight);

  while (modelBottom > FIGMA_HEADER_GAPS.maxModelBottom && brand.size > DEFAULT_BRAND_BOX.minSize) {
    brand = resolveBrandLines(m, { ...brandInput, maxSize: brand.size - 2 });
    layout = stack();
    modelBottom =
      layout.model.y +
      blockHeight(layout.model.lines.length, layout.model.size, layout.model.lineHeight);
  }

  while (modelBottom > FIGMA_HEADER_GAPS.maxModelBottom && model.size > input.modelMinSize) {
    model = fitModel(
      m,
      input.model,
      (s) => input.bodyFontForSize(s, 800),
      F.model.w,
      model.size - 2,
      input.modelMinSize,
      2,
      input.modelLineHeight
    );
    layout = stack();
    modelBottom =
      layout.model.y +
      blockHeight(layout.model.lines.length, layout.model.size, layout.model.lineHeight);
  }

  return layout;
}

export function drawTextBlock(
  ctx: CanvasRenderingContext2D,
  block: TextBlock,
  x: number,
  font: string,
  color: string
): void {
  ctx.fillStyle = color;
  ctx.font = font;
  ctx.textBaseline = "top";
  let y = block.y;
  for (const line of block.lines) {
    ctx.fillText(line, x, y);
    y += Math.round(block.size * block.lineHeight);
  }
}
