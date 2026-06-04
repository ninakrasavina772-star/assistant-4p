/** Макет 1000×1400 — координаты из Figma / эталона */
export const PODRUZHKA_SPEC = {
  size: { w: 1000, h: 1400 },
  colors: {
    bg: "#F7F7F7",
    text: "#111111",
    muted: "#666666",
    accent: "#E6007E",
    separator: "#D9D9D9"
  },
  header: { x: 250, y: 35, w: 500, h: 85 },
  ratios: {
    brandMaxWidth: 0.48,
    brandMaxHeight: 0.12,
    productX: 0.32,
    productY: 0.2,
    productW: 0.62,
    productH: 0.72,
    productFillHeight: 1,
    loopFadeX: 0.46,
    loopFadeY: 240,
    loopFadeOpacity: 0.62
  },
  gaps: {
    afterBrand: 22,
    afterType: 16,
    afterModel: 14,
    afterAccent: 30
  },
  fonts: {
    brand: { maxSize: 64, minSize: 42, weight: 800, maxLines: 2 },
    productType: { size: 36 },
    model: { size: 67, weight: 800, maxLines: 2 },
    noteTitle: { size: 22, weight: 700 },
    noteDesc: { size: 16, weight: 400 },
    ml: { size: 30, weight: 500, italic: true }
  },
  accentBar: { x: 60, w: 50, h: 6 },
  textStartY: 210,
  textX: 55,
  noteBlockHeight: 118,
  noteDescOffset: 46,
  separatorWidth: 200,
  ml: { x: 60, y: 1180 },
  mlAccent: { x: 60, y: 1140, w: 50, h: 6 }
} as const;
