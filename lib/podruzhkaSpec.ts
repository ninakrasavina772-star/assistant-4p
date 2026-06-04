/** Макет 1000×1400 — согласованная спецификация Подружka Global */
export const PODRUZHKA_SPEC = {
  size: { w: 1000, h: 1400 },
  colors: {
    bg: "#F7F7F7",
    text: "#111111",
    muted: "#666666",
    productType: "#555555",
    accent: "#E6007E",
    separator: "#D9D9D9"
  },
  fonts: {
    brand: { size: 80, weight: 800, maxLines: 2 },
    productType: { size: 28, weight: 400, maxLines: 1 },
    model: { size: 56, weight: 800, maxLines: 2 },
    noteTitle: { size: 22, weight: 700 },
    noteDesc: { size: 16, weight: 400 },
    ml: { size: 30, weight: 500, italic: true }
  },
  accentBar: { x: 60, y: 565, w: 50, h: 6 },
  noteBlockHeight: 90,
  separatorWidth: 200,
  productMaxHeightRatio: 0.9
} as const;
