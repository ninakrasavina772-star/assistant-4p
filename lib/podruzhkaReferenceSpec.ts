/**
 * Визуальный эталон (AI-референс Carolina Herrera 212 Sexy).
 * Все значения — доли/px для макета 1000×1400; рендер подстраивается под этот файл.
 */
export const PODRUZHKA_REFERENCE = {
  size: { w: 1000, h: 1400 },
  /** ~55% внимания — фото; ~18% бренд; ~10% модель; ~10% ноты */
  visualWeight: {
    product: 0.55,
    brand: 0.18,
    model: 0.1,
    notes: 0.1,
    ml: 0.02
  },
  colors: {
    bg: "#F0F0F0",
    text: "#111111",
    muted: "#666666",
    accent: "#E6007E",
    separator: "#D9D9D9"
  },
  header: { x: 250, y: 35, w: 500, h: 85 },
  text: {
    x: 55,
    startY: 200,
    brandMaxWidthRatio: 0.47,
    brandMaxHeightRatio: 0.13,
    brandFontMax: 60,
    brandFontMin: 40,
    productTypeSize: 30,
    modelSize: 60,
    noteBlockHeight: 128,
    noteTitleSize: 22,
    noteDescSize: 16,
    mlY: 1240,
    mlAccentY: 1200
  },
  product: {
    xRatio: 0.36,
    yRatio: 0.24,
    wRatio: 0.58,
    bottomMargin: 100,
    fillHeight: 0.98
  },
  gaps: {
    afterBrand: 20,
    afterType: 14,
    afterModel: 16,
    afterAccent: 34
  },
  accentBar: { x: 60, w: 50, h: 6 },
  separatorWidth: 200
} as const;
