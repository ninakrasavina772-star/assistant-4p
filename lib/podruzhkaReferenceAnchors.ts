/**
 * Якоря текста — из Ozon Card для cursor.fig (1024×1365).
 */
import { PODRUZHKA_REFERENCE as R } from "@/lib/podruzhkaReferenceSpec";
import {
  PODRUZHKA_FIGMA as F,
  figmaTextBaseline
} from "@/lib/podruzhkaFigmaLayout";
import type { TextFlowLayout } from "@/lib/podruzhkaTextFlow";

export const PODRUZHKA_LAYOUT_VERSION = "figma-cursor-v1";

export const REFERENCE_TEXT_ANCHORS = {
  brandFirstBaseline: figmaTextBaseline(F.brand.y, F.brand.fontSize),
  brandLineStep: Math.round(F.brand.fontSize * 1.05),
  productTypeBaseline: figmaTextBaseline(F.productType.y, F.productType.fontSize),
  productTypeShortExtraDy: 0,
  productTypeShortMaxLen: 99,
  modelFirstBaseline: figmaTextBaseline(F.model.y, F.model.fontSize),
  modelLineStep: Math.round(F.model.fontSize * 1.05),
  notesStartY: F.notes[0]!.titleY,
  noteBlockHeight: F.notes[1]!.titleY - F.notes[0]!.titleY,
  mlBarGapAfterNotes: F.mlPinkBar.y - (F.notes[2]!.descY + F.notes[2]!.descH),
  mlAccentY: F.mlPinkBar.y,
  productBoxScale: 1.12,
  productBoxMinHeightFill: 0.92,
  productBoxMinWidthFill: 0.82,
  figmaNotes: F.notes,
  figmaNotesPinkBar: F.notesPinkBar,
  figmaMlPinkBar: F.mlPinkBar,
  figmaSeparator: F.separator
} as const;

export function eraseReferenceGhostMarks(): void {
  /* пустой template-base — не затираем */
}

export function getReferenceFixedTextLayout(
  brandSize: number,
  _modelSize: number,
  _modelLineCount: number,
  brandLineCount: number,
  _productTypeLineCount: number
): TextFlowLayout {
  const a = REFERENCE_TEXT_ANCHORS;
  const brandLastBaseline =
    a.brandFirstBaseline + Math.max(0, brandLineCount - 1) * a.brandLineStep;
  const notesEndY = F.notes[2]!.descY + F.notes[2]!.descH;
  const mlAccentY = a.mlAccentY;
  const mlBaseline = figmaTextBaseline(F.ml.y, F.ml.fontSize);

  return {
    brandTopY: F.brand.y,
    brandLineStep: a.brandLineStep,
    brandFirstBaseline: a.brandFirstBaseline,
    brandLastBaseline,
    productTypeBaseline: a.productTypeBaseline,
    modelLineStep: a.modelLineStep,
    modelFirstBaseline: a.modelFirstBaseline,
    accentY: 0,
    notesStartY: a.notesStartY,
    notesEndY,
    mlAccentY,
    mlBaseline,
    productGroundY: R.product.bottomAlignY
  };
}
