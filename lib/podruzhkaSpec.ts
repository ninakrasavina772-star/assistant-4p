/** ТЗ Podruzhka Global для Ozon (из референса) */
export const PODRUZHKA_SPEC = {
  size: { w: 1080, h: 1350 },
  colors: {
    bg: "#F7F7F7",
    loop: "#EDEDED",
    text: "#000000",
    muted: "#7A7A7A",
    accent: "#FF1E6E",
    separator: "#E0E0E0"
  },
  margins: {
    logoTop: 60,
    contentLeft: 80,
    belowLogo: 80,
    contentBottom: 80
  },
  fonts: {
    brand: { size: 72, weight: 800 },
    productType: { size: 20, weight: 400 },
    model: { size: 36, weight: 800 },
    noteTitle: { size: 18, weight: 700 },
    noteDesc: { size: 16, weight: 400 },
    ml: { size: 24, weight: 500, italic: true }
  },
  accentLine: { length: 40, width: 2 },
  logo: { height: 68, maxWidth: 520 },
  noteBlockHeight: 118,
  separatorWidth: 400
} as const;
