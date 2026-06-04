import { PODRUZHKA_SPEC as S } from "@/lib/podruzhkaSpec";

export const PODRUZHKA_SIZE = S.size;

/** Фиксированные координаты (px) — одинаково для всех товаров */
export const PODRUZHKA_LAYOUT = {
  brand: { x: 55, y: 210, w: 500, h: 140 },
  productType: { x: 55, y: 380, w: 400, h: 50 },
  model: { x: 55, y: 470, w: 400, h: 70 },
  accentBar: S.accentBar,
  notes: { x: 55, y: 620, w: 260, blockH: S.noteBlockHeight },
  ml: { x: 60, y: 1180 },
  mlAccent: { x: 60, y: 1140, w: 50, h: 6 },
  product: { x: 360, y: 340, w: 560, h: 760 },
  separator: { width: S.separatorWidth }
} as const;
