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
  ratios: {
    brandMaxWidth: 0.55,
    brandMaxHeight: 0.14,
    productX: 0.38,
    productY: 0.28,
    productW: 0.55,
    productH: 0.58,
    loopFadeRight: 0.42,
    loopFadeOpacity: 0.52
  },
  fonts: {
    brand: { maxSize: 72, minSize: 48, weight: 800, maxLines: 2 },
    productTypeRatioOfModel: 0.48,
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
