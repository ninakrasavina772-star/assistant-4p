/**
 * AI-референс Carolina Herrera 212 Sexy — фиксированная сетка 1000×1400.
 * Все карточки рисуются по одним координатам (не «плывут» от длины текста).
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
  headerMaskHeight: 145,
  text: {
    x: 55,
    brandY: 200,
    brandMaxWidthRatio: 0.47,
    brandMaxHeightRatio: 0.12,
    brandFontMax: 60,
    brandFontMin: 40,
    productTypeY: 348,
    productTypeSize: 30,
    modelY: 410,
    modelSize: 60,
    accentY: 498,
    notesStartY: 548,
    noteBlockHeight: 120,
    noteTitleSize: 22,
    noteDescSize: 16,
    noteTitleDy: 22,
    noteDescDy: 48,
    mlY: 1255,
    mlAccentY: 1215
  },
  product: {
    xRatio: 0.36,
    topY: 280,
    wRatio: 0.58,
    bottomY: 1300,
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
