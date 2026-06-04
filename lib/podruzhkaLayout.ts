import { PODRUZHKA_SPEC as S } from "@/lib/podruzhkaSpec";
import type { VisionLayoutAdjustment } from "@/lib/podruzhkaVisionAdjust";

const { w: W } = S.size;

export type PodruzhkaRuntimeLayout = {
  textX: number;
  brand: { x: number; y: number; w: number; h: number };
  productType: { x: number; y: number; w: number };
  model: { x: number; y: number; w: number };
  accent: { x: number; y: number; w: number; h: number };
  notes: { x: number; startY: number; w: number; blockH: number };
  ml: { x: number; y: number };
  mlAccent: { x: number; y: number; w: number; h: number };
  product: { x: number; y: number; w: number; bottom: number };
  separator: { width: number };
};

export const PODRUZHKA_SIZE = S.size;

export function buildPodruzhkaLayout(adj?: VisionLayoutAdjustment): PodruzhkaRuntimeLayout {
  const dy = (k: keyof VisionLayoutAdjustment, fallback = 0) =>
    typeof adj?.[k] === "number" ? (adj[k] as number) : fallback;

  const brandY = S.fixed.brandY + dy("brandYOffset");
  const productTypeY = S.fixed.productTypeY + dy("productTypeYOffset");
  const modelY = S.fixed.modelY + dy("modelYOffset");
  const accentY = S.fixed.accentY + dy("accentYOffset");
  const notesStartY = S.fixed.notesStartY + dy("notesStartYOffset");
  const noteBlockH = adj?.noteBlockHeight ?? S.noteBlockHeight;
  const productTopY = S.product.topY + dy("productTopYOffset");
  const productBottom = S.product.bottomY + dy("productBottomYOffset");

  return {
    textX: S.textX,
    brand: {
      x: S.textX,
      y: brandY,
      w: Math.round(W * S.ratios.brandMaxWidth),
      h: Math.round(S.size.h * S.ratios.brandMaxHeight)
    },
    productType: { x: S.textX, y: productTypeY, w: Math.round(W * 0.46) },
    model: { x: S.textX, y: modelY, w: Math.round(W * 0.46) },
    accent: { x: S.accentBar.x, y: accentY, w: S.accentBar.w, h: S.accentBar.h },
    notes: { x: S.textX, startY: notesStartY, w: 300, blockH: noteBlockH },
    ml: S.ml,
    mlAccent: S.mlAccent,
    product: {
      x: Math.round(W * S.product.xRatio),
      y: productTopY,
      w: Math.round(W * S.product.wRatio),
      bottom: productBottom
    },
    separator: { width: S.separatorWidth }
  };
}

/** @deprecated используйте buildPodruzhkaLayout() */
export const PODRUZHKA_LAYOUT = buildPodruzhkaLayout();
