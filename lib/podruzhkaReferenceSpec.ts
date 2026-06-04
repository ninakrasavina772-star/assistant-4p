/**
 * ТЗ 1000×1400 + эталон reference-target.png (Carolina Herrera / Xerjoff).
 * Координаты блоков фиксированы; масштаб товара — автопроверка podruzhkaLayoutValidation.
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
  blocks: {
    header: { x: 250, y: 35, w: 500, h: 85 },
    /** +35px к референсу CH: зазор шапка → бренд */
    brand: { x: 55, y: 215, w: 480, h: 150 },
    productType: { x: 55, y: 415, w: 350, h: 40 },
    model: { x: 55, y: 485, w: 350, h: 80 },
    notes: { x: 55, y: 655, w: 250, h: 320 },
    volume: { x: 55, y: 1195, w: 180, h: 60 },
    product: { x: 350, y: 335, w: 580, h: 760 }
  },
  fonts: {
    /** целевой диапазон 72–92; min 52 — только чтобы влезть в блок 480×150 */
    brand: { max: 92, min: 52, weight: 800, maxLines: 2 },
    productType: { size: 22, weight: 400 },
    model: { max: 64, min: 48, weight: 800, maxLines: 2 },
    noteTitle: { max: 22, min: 18, weight: 700 },
    noteDesc: { max: 16, min: 14, weight: 400 },
    ml: { max: 32, min: 26, weight: 500, italic: true }
  },
  accentBar: { x: 55, y: 573, w: 50, h: 6 },
  noteTitleDy: 22,
  noteDescDy: 46,
  /** 3 группы нот в 320px; между группами ~48–60 px (внутри blockH) */
  noteBlockHeight: 107,
  separatorWidth: 200,
  product: {
    /** низ товара: 20–50 px над блоком объёма (Y=1160) */
    bottomAlignY: 1165,
    heightRatioMin: 0.48,
    heightRatioMax: 0.58,
    heightRatioTarget: 0.53,
    widthRatioMin: 0.5,
    widthRatioTarget: 0.55,
    narrowAspectBoost: 1.28,
    alignRight: true
  },
  validation: {
    productHeightRatioMin: 0.48,
    productHeightRatioMax: 0.58,
    productWidthRatioMin: 0.5,
    minProductAreaShareOfContent: 0.45,
    maxBrandToProductAreaRatio: 0.45,
    gapAboveVolumeMinPx: 20,
    gapAboveVolumeMaxPx: 50,
    referenceEmptyRightPx: 28,
    referenceEmptyCenterPx: 42,
    emptySpaceTolerance: 1.15,
    contentRect: { x: 55, y: 215, w: 875, h: 965 }
  }
} as const;
