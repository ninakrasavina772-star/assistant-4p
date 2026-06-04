/**
 * Сетка 1000×1400 — координаты под reference-target.png (Xerjoff).
 * Шаблон template-base.png только как подложка (шапка + петля), данные поверх.
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
  text: {
    x: 52,
    brandY: 228,
    brandMaxWidthRatio: 0.47,
    brandMaxHeightRatio: 0.09,
    brandFontMax: 54,
    brandFontMin: 36,
    productTypeY: 268,
    productTypeSize: 26,
    modelY: 318,
    modelSize: 50,
    accentY: 388,
    notesStartY: 448,
    noteBlockHeight: 106,
    noteTitleSize: 22,
    noteDescSize: 16,
    noteTitleDy: 22,
    noteDescDy: 46,
    mlY: 1298,
    mlAccentY: 1258
  },
  product: {
    xRatio: 0.34,
    topY: 240,
    wRatio: 0.6,
    bottomY: 1320,
    minHeightRatio: 0.9,
    fillHeight: 0.98
  },
  accentBar: { x: 57, w: 50, h: 6 },
  separatorWidth: 200
} as const;
