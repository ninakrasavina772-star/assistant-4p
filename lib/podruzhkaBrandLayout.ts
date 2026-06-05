import { PODRUZHKA_FIGMA as F } from "@/lib/podruzhkaFigmaLayout";

export type TextMeasure = {
  setFont(font: string): void;
  textWidth(text: string): number;
};

export type BrandLayoutInput = {
  brandName: string;
  maxSize: number;
  minSize: number;
  maxWidth: number;
  maxHeight: number;
  maxLines?: number;
  lineHeight?: number;
  fontForSize: (size: number) => string;
};

function wrapByWidth(
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

function fitsLines(
  m: TextMeasure,
  size: number,
  lines: string[],
  opts: BrandLayoutInput
): boolean {
  const maxLines = opts.maxLines ?? 2;
  const lineHeight = opts.lineHeight ?? 1.05;
  if (lines.length > maxLines) return false;
  m.setFont(opts.fontForSize(size));
  const lineH = Math.round(size * lineHeight);
  if (lines.length * lineH > opts.maxHeight) return false;
  return lines.every((ln) => m.textWidth(ln) <= opts.maxWidth);
}

/**
 * Как reference-target: двухсловный бренд — по одному слову на строку (CAROLINA / HERRERA).
 */
export function resolveBrandLines(
  m: TextMeasure,
  input: BrandLayoutInput
): { size: number; lines: string[] } {
  const words = input.brandName.toUpperCase().trim().split(/\s+/).filter(Boolean);
  const maxLines = input.maxLines ?? 2;

  if (!words.length) {
    return { size: input.maxSize, lines: [] };
  }

  const candidates: string[][] = [];

  if (words.length === 2) {
    candidates.push([words[0]!, words[1]!]);
  } else if (words.length > 2) {
    const mid = Math.ceil(words.length / 2);
    candidates.push([words.slice(0, mid).join(" "), words.slice(mid).join(" ")]);
  }

  for (const lines of candidates) {
    for (let size = input.maxSize; size >= input.minSize; size -= 2) {
      if (fitsLines(m, size, lines, input)) {
        return { size, lines };
      }
    }
  }

  const text = words.join(" ");
  for (let size = input.maxSize; size >= input.minSize; size -= 2) {
    const font = input.fontForSize(size);
    const lines = wrapByWidth(m, text, font, input.maxWidth, maxLines);
    if (lines.length && fitsLines(m, size, lines, input)) {
      return { size, lines };
    }
  }

  const size = input.minSize;
  const font = input.fontForSize(size);
  return {
    size,
    lines: wrapByWidth(m, text, font, input.maxWidth, maxLines)
  };
}

export const DEFAULT_BRAND_BOX = {
  maxWidth: F.brand.w,
  maxHeight: F.brand.h,
  maxSize: F.brand.fontSize,
  minSize: 52,
  lineHeight: 1.05,
  maxLines: 2
} as const;

export function measureFromCanvas2D(ctx: CanvasRenderingContext2D): TextMeasure {
  return {
    setFont(font) {
      ctx.font = font;
    },
    textWidth(text) {
      return ctx.measureText(text).width;
    }
  };
}

/** @napi-rs/canvas и браузерный Canvas2D */
export function measureFromCanvasCtx(ctx: {
  font: string;
  measureText(text: string): { width: number };
}): TextMeasure {
  return {
    setFont(font) {
      ctx.font = font;
    },
    textWidth(text) {
      return ctx.measureText(text).width;
    }
  };
}
