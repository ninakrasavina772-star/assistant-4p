/**
 * ТЗ 3:4 — 1024×1365 px (Ozon). Координаты из Ozon Card для cursor.fig.
 */
import { PODRUZHKA_FIGMA as F } from "@/lib/podruzhkaFigmaLayout";

export const PODRUZHKA_REPLACE_ONLY = true;

export const PODRUZHKA_REFERENCE = {
  size: { w: F.frame.w, h: F.frame.h },
  colors: {
    bg: "#F5F5F5",
    loop: "#EFEFEF",
    text: "#111111",
    muted: "#666666",
    accent: "#E6007E",
    separator: "#D9D9D9"
  },
  gaps: {
    headerToBrandTop: F.brand.y - 206,
    afterBrand: F.productType.y - (F.brand.y + F.brand.h),
    afterProductType: F.model.y - (F.productType.y + F.productType.h),
    afterModel: F.notesPinkBar.y - (F.model.y + F.model.h),
    afterAccentToNotes: F.notes[0]!.titleY - (F.notesPinkBar.y + F.notesPinkBar.h),
    afterNotesToMl: F.mlPinkBar.y - (F.notes[2]!.descY + F.notes[2]!.descH)
  },
  blocks: {
    header: { x: 268, y: 101, w: 467, h: 105 },
    brand: { x: F.brand.x, y: F.brand.y, w: F.brand.w, h: F.brand.h },
    productType: { x: F.productType.x, y: F.productType.y, w: F.productType.w, h: F.productType.h },
    model: { x: F.model.x, y: F.model.y, w: F.model.w, h: F.model.h },
    notes: {
      x: F.textX,
      y: F.notes[0]!.titleY,
      w: F.model.w,
      h: F.mlPinkBar.y - F.notes[0]!.titleY
    },
    volume: { x: F.ml.x, y: F.ml.y, w: F.ml.w, h: F.ml.h },
    product: { x: F.product.x, y: F.product.y, w: F.product.w, h: F.product.h }
  },
  fonts: {
    brand: { max: F.brand.fontSize, min: 52, weight: 800, maxLines: 2 },
    productType: { size: F.productType.fontSize, weight: 400 },
    model: { max: F.model.fontSize, min: 44, weight: 800, maxLines: 2, ratioOfBrand: 0.68 },
    noteTitle: { max: F.fonts.noteTitle, min: 18, weight: 700 },
    noteDesc: { max: F.fonts.noteDesc, min: 14, weight: 400 },
    ml: { max: F.ml.fontSize, min: 26, weight: 500, italic: true }
  },
  accentBar: { x: F.notesPinkBar.x, y: F.notesPinkBar.y, w: F.notesPinkBar.w, h: F.notesPinkBar.h },
  mlAccentBar: { x: F.mlPinkBar.x, y: F.mlPinkBar.y, w: F.mlPinkBar.w, h: F.mlPinkBar.h },
  noteTitleDy: 0,
  noteDescDy: 0,
  noteBlockHeight: F.notes[1]!.titleY - F.notes[0]!.titleY,
  notesMinHeight: 280,
  noteSpacingMin: 48,
  noteSpacingMax: 60,
  separatorWidth: F.separator.w,
  product: {
    bottomAlignY: F.product.y + F.product.h,
    heightRatioMin: 0.45,
    heightRatioMax: 0.65,
    heightRatioTarget: 0.58,
    widthRatioMin: 0.45,
    widthRatioTarget: 0.52,
    narrowAspectBoost: 1,
    alignRight: true
  },
  validation: {
    productHeightRatioMin: 0.4,
    productHeightRatioMax: 0.65,
    productWidthRatioMin: 0.4,
    productVsBrandAreaMultiplier: 1.5,
    productVsTextAreaMultiplier: 1.1,
    gapAboveVolumeMinPx: 8,
    gapAboveVolumeMaxPx: 80,
    referenceEmptyRightPx: 20,
    referenceEmptyCenterPx: 30,
    emptySpaceTolerance: 1.25,
    contentRect: { x: F.textX, y: F.brand.y, w: 960, h: F.ml.y + F.ml.h - F.brand.y },
    maxCorrectionPasses: 1
  }
} as const;
