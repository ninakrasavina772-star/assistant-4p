/**
 * Координаты из «Ozon Card для cursor.fig» (Frame 1, 1024×1365).
 * Парсер: node scripts/parse-fig-coords.mjs
 */
export const PODRUZHKA_FIGMA = {
  frame: { w: 1024, h: 1365 },
  textX: 64,
  brand: { x: 64, y: 328, w: 895, h: 184, fontSize: 95 },
  productType: { x: 64, y: 524, w: 895, h: 25, fontSize: 26 },
  model: { x: 64, y: 605, w: 369, h: 61, fontSize: 66 },
  notesPinkBar: { x: 64, y: 719, w: 47, h: 8 },
  notes: [
    { titleY: 780, titleH: 26, descY: 814, descH: 19, sepY: 863 },
    { titleY: 895, titleH: 26, descY: 929, descH: 19, sepY: 978 },
    { titleY: 1010, titleH: 26, descY: 1044, descH: 19, sepY: null as number | null }
  ],
  mlPinkBar: { x: 64, y: 1116, w: 47, h: 8 },
  ml: { x: 64, y: 1177, w: 369, h: 33, fontSize: 37 },
  product: { x: 433, y: 616, w: 526, h: 654 },
  fonts: {
    noteTitle: 28,
    noteDesc: 20
  },
  separator: { w: 369, h: 2 }
} as const;

/** Figma text box top → canvas fillText baseline */
export function figmaTextBaseline(boxY: number, fontSize: number): number {
  return boxY + Math.round(fontSize * 0.82);
}
