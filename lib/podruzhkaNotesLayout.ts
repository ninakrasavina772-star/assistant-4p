/**
 * Блоки benefit/нот: перенос в левую колонку, без заезда под foto справа.
 */
import { PODRUZHKA_FIGMA as F } from "@/lib/podruzhkaFigmaLayout";
import type { TextMeasure } from "@/lib/podruzhkaBrandLayout";
import type { PodruzhkaNoteBlock } from "@/lib/podruzhkaTypes";

/** Ширина текста = ширина разделителя (левая колонка до x=433). */
export const PODRUZHKA_NOTE_TEXT_MAX_WIDTH = F.separator.w;

const NOTE_DESC_LINE_HEIGHT = 1.12;
const NOTE_DESC_MIN_SIZE = 17;

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
      if (lines.length >= maxLines) break;
    } else line = test;
  }
  if (lines.length < maxLines) lines.push(line);
  return lines.slice(0, maxLines);
}

function truncateLine(m: TextMeasure, text: string, font: string, maxWidth: number): string {
  m.setFont(font);
  if (m.textWidth(text) <= maxWidth) return text;
  const ell = "…";
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (m.textWidth(text.slice(0, mid) + ell) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo) + ell;
}

function slotDescMaxHeight(slotIndex: number): number {
  const slot = F.notes[slotIndex]!;
  if (slot.sepY != null) return slot.sepY - slot.descY - 4;
  return F.mlPinkBar.y - slot.descY - 12;
}

function maxDescLinesForSize(fontSize: number, slotIndex: number): number {
  const lineH = Math.round(fontSize * NOTE_DESC_LINE_HEIGHT);
  return Math.max(1, Math.floor(slotDescMaxHeight(slotIndex) / lineH));
}

export type NoteBlockLayout = {
  titleY: number;
  descY: number;
  sepY: number | null;
  titleSize: number;
  descSize: number;
  titleLines: string[];
  descLines: string[];
  descLineHeight: number;
  truncated: boolean;
};

export type NotesLayoutResult = {
  blocks: NoteBlockLayout[];
  truncated: boolean;
};

function layoutDesc(
  m: TextMeasure,
  desc: string,
  fontForSize: (size: number, weight: number) => string,
  preferredSize: number,
  slotIndex: number
): { size: number; lines: string[]; lineHeight: number; truncated: boolean } {
  const maxW = PODRUZHKA_NOTE_TEXT_MAX_WIDTH;

  for (let size = preferredSize; size >= NOTE_DESC_MIN_SIZE; size -= 1) {
    const font = fontForSize(size, 400);
    m.setFont(font);
    const maxLines = maxDescLinesForSize(size, slotIndex);
    const lines = wrapByWidth(m, desc, font, maxW, maxLines);
    const lineH = Math.round(size * NOTE_DESC_LINE_HEIGHT);
    const heightOk = lines.length * lineH <= slotDescMaxHeight(slotIndex);
    const widthOk = lines.every((ln) => m.textWidth(ln) <= maxW);
    const needsMoreLines = wrapByWidth(m, desc, font, maxW, maxLines + 4).length > maxLines;
    if (heightOk && widthOk && !needsMoreLines) {
      return { size, lines, lineHeight: lineH, truncated: false };
    }
  }

  const size = NOTE_DESC_MIN_SIZE;
  const font = fontForSize(size, 400);
  m.setFont(font);
  const maxLines = maxDescLinesForSize(size, slotIndex);
  const lines = wrapByWidth(m, desc, font, maxW, maxLines);
  const last = lines.length - 1;
  if (last >= 0 && wrapByWidth(m, desc, font, maxW, maxLines + 4).length > maxLines) {
    lines[last] = truncateLine(m, lines[last]!, font, maxW);
  }
  return {
    size,
    lines,
    lineHeight: Math.round(size * NOTE_DESC_LINE_HEIGHT),
    truncated: wrapByWidth(m, desc, font, maxW, maxLines + 4).length > maxLines
  };
}

export function layoutNoteBlocks(
  m: TextMeasure,
  notes: PodruzhkaNoteBlock[],
  titleSize: number,
  descSize: number,
  fontForSize: (size: number, weight: number) => string
): NotesLayoutResult {
  const blocks: NoteBlockLayout[] = [];
  let truncated = false;

  for (let i = 0; i < Math.min(notes.length, 3); i++) {
    const n = notes[i]!;
    const slot = F.notes[i]!;
    m.setFont(fontForSize(titleSize, 700));
    const titleLines = wrapByWidth(m, n.title.toUpperCase(), fontForSize(titleSize, 700), PODRUZHKA_NOTE_TEXT_MAX_WIDTH, 2);
    const desc = layoutDesc(m, n.desc, fontForSize, descSize, i);
    if (desc.truncated) truncated = true;

    blocks.push({
      titleY: slot.titleY,
      descY: slot.descY,
      sepY: slot.sepY,
      titleSize,
      descSize: desc.size,
      titleLines,
      descLines: desc.lines,
      descLineHeight: desc.lineHeight,
      truncated: desc.truncated
    });
  }

  return { blocks, truncated };
}

type NoteDrawCtx = {
  fillStyle: string | CanvasGradient | CanvasPattern;
  font: string;
  textBaseline: CanvasTextBaseline;
  fillText(text: string, x: number, y: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
};

export function drawNoteBlocks(
  ctx: NoteDrawCtx,
  layout: NotesLayoutResult,
  textX: number,
  fontForSize: (size: number, weight: number) => string,
  colors: { accent: string; muted: string; separator: string },
  separatorW: number,
  separatorH: number
): void {
  ctx.textBaseline = "top";

  for (const block of layout.blocks) {
    ctx.fillStyle = colors.accent;
    ctx.font = fontForSize(block.titleSize, 700);
    let y = block.titleY;
    for (const line of block.titleLines) {
      ctx.fillText(line, textX, y);
      y += Math.round(block.titleSize * 1.05);
    }

    ctx.fillStyle = colors.muted;
    ctx.font = fontForSize(block.descSize, 400);
    y = block.descY;
    for (const line of block.descLines) {
      ctx.fillText(line, textX, y);
      y += block.descLineHeight;
    }

    if (block.sepY != null) {
      ctx.fillStyle = colors.separator;
      ctx.fillRect(textX, block.sepY, separatorW, separatorH);
    }
  }
}
