/**
 * Сетка 1000×1400 — подогнана по reference-target.png (Xerjoff), не Carolina Herrera.
 */
export const PODRUZHKA_REFERENCE = {
  size: { w: 1000, h: 1400 },
  colors: {
    bg: "#F0F0F0",
    text: "#111111",
    muted: "#666666",
    accent: "#E6007E",
    separator: "#D9D9D9"
  },
  header: { x: 250, y: 35, w: 500, h: 85 },
  /** Ниже шапки — зона очистки перед текстом (шапку не трогаем) */
  contentClearTop: 140,
  text: {
    x: 55,
    brandY: 195,
    brandMaxWidthRatio: 0.47,
    brandMaxHeightRatio: 0.08,
    brandFontMax: 56,
    brandFontMin: 38,
    productTypeY: 278,
    productTypeSize: 26,
    modelY: 332,
    modelSize: 52,
    accentY: 400,
    notesStartY: 458,
    noteBlockHeight: 108,
    noteTitleSize: 22,
    noteDescSize: 16,
    noteTitleDy: 22,
    noteDescDy: 46,
    mlY: 1295,
    mlAccentY: 1255
  },
  product: {
    xRatio: 0.36,
    topY: 260,
    wRatio: 0.58,
    bottomY: 1310,
    minHeightRatio: 0.88,
    fillHeight: 0.98
  },
  gaps: {
    afterBrand: 0,
    afterType: 0,
    afterModel: 0,
    afterAccent: 0
  },
  accentBar: { x: 60, w: 50, h: 6 },
  separatorWidth: 200
} as const;
