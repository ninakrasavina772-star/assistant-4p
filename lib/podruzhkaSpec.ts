/** Макет 1000×1400 — пропорции по эталону Carolina Herrera */
export const PODRUZHKA_SPEC = {
  size: { w: 1000, h: 1400 },
  colors: {
    bg: "#F7F7F7",
    text: "#111111",
    muted: "#666666",
    accent: "#E6007E",
    separator: "#D9D9D9"
  },
  /** Доли холста */
  header: { x: 250, y: 35, w: 500, h: 85 },
  ratios: {
    brandMaxWidth: 0.5,
    brandMaxHeight: 0.13,
    productX: 0.34,
    productY: 0.24,
    productW: 0.58,
    productH: 0.64,
    productFillHeight: 0.97,
    loopFadeX: 0.44,
    loopFadeY: 220,
    loopFadeOpacity: 0.55
  },
  fonts: {
    brand: { maxSize: 68, minSize: 44, weight: 800, maxLines: 2 },
    productTypeRatioOfModel: 0.55,
    model: { size: 67, weight: 800, maxLines: 2 },
    noteTitle: { size: 22, weight: 700 },
    noteDesc: { size: 16, weight: 400 },
    ml: { size: 30, weight: 500, italic: true }
  },
  accentBar: { x: 60, y: 565, w: 50, h: 6 },
  noteBlockHeight: 118,
  noteDescOffset: 46,
  separatorWidth: 200
} as const;
