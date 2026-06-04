/**
 * ТЗ 1000×1400 — эталон reference-target.png (Carolina Herrera).
 * Сохранение JPG только после прохождения podruzhkaLayoutValidation.
 */
export const PODRUZHKA_REFERENCE = {
  size: { w: 1000, h: 1400 },
  colors: {
    bg: "#F7F7F7",
    loop: "#EFEFEF",
    text: "#111111",
    muted: "#666666",
    accent: "#E6007E",
    separator: "#D9D9D9"
  },
  gaps: {
    headerToBrandTop: 152,
    afterBrand: 22,
    afterProductType: 12,
    afterModel: 14,
    afterAccentToNotes: 36
  },
  blocks: {
    header: { x: 250, y: 35, w: 500, h: 85 },
    brand: { x: 55, y: 272, w: 480, h: 150 },
    productType: { x: 55, y: 0, w: 350, h: 40 },
    model: { x: 55, y: 0, w: 350, h: 80 },
    notes: { x: 55, y: 668, w: 250, h: 320 },
    volume: { x: 55, y: 1195, w: 180, h: 60 },
    product: { x: 350, y: 348, w: 580, h: 760 }
  },
  fonts: {
    /** CH-эталон: крупный, но товар всё равно доминирует */
    brand: { max: 76, min: 52, weight: 800, maxLines: 2 },
    productType: { size: 22, weight: 400 },
    model: { max: 64, min: 48, weight: 800, maxLines: 2, ratioOfBrand: 0.75 },
    noteTitle: { max: 22, min: 18, weight: 700 },
    noteDesc: { max: 16, min: 14, weight: 400 },
    ml: { max: 32, min: 26, weight: 500, italic: true }
  },
  accentBar: { x: 55, y: 0, w: 50, h: 6 },
  noteTitleDy: 22,
  noteDescDy: 46,
  /** интервал между группами нот 48–60 px */
  noteBlockHeight: 100,
  notesMinHeight: 280,
  noteSpacingMin: 48,
  noteSpacingMax: 60,
  separatorWidth: 200,
  product: {
    bottomAlignY: 1178,
    heightRatioMin: 0.48,
    heightRatioMax: 0.58,
    heightRatioTarget: 0.55,
    widthRatioMin: 0.5,
    widthRatioTarget: 0.55,
    narrowAspectBoost: 1.28,
    alignRight: true
  },
  validation: {
    productHeightRatioMin: 0.48,
    productHeightRatioMax: 0.58,
    productWidthRatioMin: 0.5,
    /** product_area >= brand_area * N */
    productVsBrandAreaMultiplier: 2,
    /** product_area >= textArea * N */
    productVsTextAreaMultiplier: 1.5,
    gapAboveVolumeMinPx: 20,
    gapAboveVolumeMaxPx: 50,
    referenceEmptyRightPx: 28,
    referenceEmptyCenterPx: 42,
    emptySpaceTolerance: 1.15,
    contentRect: { x: 55, y: 272, w: 875, h: 908 },
    maxCorrectionPasses: 18
  }
} as const;

