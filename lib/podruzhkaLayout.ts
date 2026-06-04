import { PODRUZHKA_SPEC as S } from "@/lib/podruzhkaSpec";

const { w: W, h: H } = S.size;
const R = S.ratios;

export const PODRUZHKA_SIZE = S.size;

export const PODRUZHKA_LAYOUT = {
  brand: {
    x: 55,
    y: 210,
    w: Math.round(W * R.brandMaxWidth),
    h: Math.round(H * R.brandMaxHeight)
  },
  productType: { x: 55, y: 380, w: Math.round(W * 0.45), h: 56 },
  model: { x: 55, y: 468, w: Math.round(W * 0.45), h: 80 },
  accentBar: S.accentBar,
  notes: { x: 55, y: 618, w: 280, blockH: S.noteBlockHeight },
  ml: { x: 60, y: 1180 },
  mlAccent: { x: 60, y: 1140, w: 50, h: 6 },
  product: {
    x: Math.round(W * R.productX),
    y: Math.round(H * R.productY),
    w: Math.round(W * R.productW),
    h: Math.round(H * R.productH)
  },
  separator: { width: S.separatorWidth }
} as const;
