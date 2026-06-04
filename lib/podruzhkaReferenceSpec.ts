/**
 * Сетка 1000×1400 — по reference-target.png (Xerjoff).
 * Верхний блок (бренд → тип) считается от низа шапки; model/ноты — фикс. Y.
 */
export const PODRUZHKA_REFERENCE = {
  size: { w: 1000, h: 1400 },
  colors: {
    bg: "#F3F1F2",
    text: "#111111",
    muted: "#666666",
    accent: "#E6007E",
    separator: "#D9D9D9"
  },
  /** Низ чёрной плашки в template-base.png (не сжимать шаблон fit:fill) */
  headerBottomY: 168,
  gaps: {
    afterHeader: 56,
    afterBrand: 10,
    afterType: 14
  },
  text: {
    x: 52,
    brandY: 224,
    brandMaxWidthRatio: 0.47,
    brandMaxHeightRatio: 0.09,
    brandFontMax: 54,
    brandFontMin: 36,
    productTypeY: 0,
    productTypeSize: 26,
    modelY: 368,
    modelSize: 50,
    accentY: 541,
    notesStartY: 573,
    noteBlockHeight: 118,
    noteTitleSize: 22,
    noteDescSize: 16,
    noteTitleDy: 22,
    noteDescDy: 46,
    mlY: 1281,
    mlAccentY: 1241
  },
  product: {
    xRatio: 0.3,
    topY: 300,
    wRatio: 0.66,
    bottomY: 1340,
    minHeightRatio: 0.9,
    fillHeight: 0.94
  },
  accentBar: { x: 57, w: 50, h: 6 },
  separatorWidth: 200
} as const;
