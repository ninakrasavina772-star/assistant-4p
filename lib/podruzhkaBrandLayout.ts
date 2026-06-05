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

function brandLineCandidates(words: string[]): string[][] {
  const candidates: string[][] = [];
  if (words.length === 1) {
    candidates.push([words[0]!]);
    return candidates;
  }
  if (words.length === 2) {
    candidates.push([words[0]!, words[1]!]);
    return candidates;
  }
  for (let i = 1; i < words.length; i++) {
    candidates.push([words.slice(0, i).join(" "), words.slice(i).join(" ")]);
  }
  return candidates;
}

function scoreLines(m: TextMeasure, size: number, lines: string[], font: string): number {
  m.setFont(font);
  return Math.max(...lines.map((ln) => m.textWidth(ln)), 0);
}

/**
 * Бренд: 2 слова — по слову на строку; 3+ — только 2 строки, без одной длинной.
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

  const candidates = brandLineCandidates(words);
  let best: { size: number; lines: string[]; score: number } | null = null;

  for (const lines of candidates) {
    for (let size = input.maxSize; size >= input.minSize; size -= 2) {
      if (!fitsLines(m, size, lines, input)) continue;
      const font = input.fontForSize(size);
      const score = scoreLines(m, size, lines, font);
      if (!best || size > best.size || (size === best.size && score < best.score)) {
        best = { size, lines, score };
      }
      break;
    }
  }

  if (best) return { size: best.size, lines: best.lines };

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
