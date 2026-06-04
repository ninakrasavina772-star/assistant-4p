import { PODRUZHKA_SPEC as S } from "@/lib/podruzhkaSpec";

const { w: W, h: H } = S.size;
const R = S.ratios;

export const PODRUZHKA_SIZE = S.size;

export const PODRUZHKA_LAYOUT = {
  textX: S.textX,
  textStartY: S.textStartY,
  brand: {
    x: S.textX,
    y: S.textStartY,
    w: Math.round(W * R.brandMaxWidth),
    h: Math.round(H * R.brandMaxHeight)
  },
  productType: { x: S.textX, w: Math.round(W * 0.46) },
  model: { x: S.textX, w: Math.round(W * 0.46) },
  notes: { x: S.textX, w: 280, blockH: S.noteBlockHeight },
  ml: S.ml,
  mlAccent: S.mlAccent,
  product: {
    x: Math.round(W * R.productX),
    y: Math.round(H * R.productY),
    w: Math.round(W * R.productW),
    h: Math.round(H * R.productH)
  },
  separator: { width: S.separatorWidth }
} as const;
