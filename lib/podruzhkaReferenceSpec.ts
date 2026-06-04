/**
 * Сетка 1000×1400 — замеры с reference-target.png (Xerjoff).
 * Шаблон = подложка; текст и фото — по этим координатам.
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
    /** top anchor; baseline = brandY + brandFont */
    brandY: 198,
    brandMaxWidthRatio: 0.47,
    brandMaxHeightRatio: 0.09,
    brandFontMax: 54,
    brandFontMin: 36,
    productTypeY: 308,
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
    xRatio: 0.32,
    topY: 270,
    wRatio: 0.64,
    bottomY: 1330,
    minHeightRatio: 0.92,
    fillHeight: 0.96
  },
  accentBar: { x: 57, w: 50, h: 6 },
  separatorWidth: 200
} as const;
