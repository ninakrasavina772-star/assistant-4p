import { PODRUZHKA_SPEC as S } from "@/lib/podruzhkaSpec";

const { w: W } = S.size;

export const PODRUZHKA_SIZE = S.size;

export const PODRUZHKA_LAYOUT = {
  textX: S.textX,
  brand: {
    x: S.textX,
    y: S.fixed.brandY,
    w: Math.round(W * S.ratios.brandMaxWidth),
    h: Math.round(S.size.h * S.ratios.brandMaxHeight)
  },
  productType: { x: S.textX, y: S.fixed.productTypeY, w: Math.round(W * 0.46) },
  model: { x: S.textX, y: S.fixed.modelY, w: Math.round(W * 0.46) },
  accent: { x: S.accentBar.x, y: S.fixed.accentY, w: S.accentBar.w, h: S.accentBar.h },
  notes: {
    x: S.textX,
    startY: S.fixed.notesStartY,
    w: 300,
    blockH: S.noteBlockHeight
  },
  ml: S.ml,
  mlAccent: S.mlAccent,
  product: {
    x: Math.round(W * S.product.xRatio),
    y: S.product.topY,
    w: Math.round(W * S.product.wRatio),
    bottom: S.product.bottomY
  },
  separator: { width: S.separatorWidth }
} as const;
