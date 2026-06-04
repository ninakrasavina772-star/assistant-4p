import { PODRUZHKA_SPEC as S } from "@/lib/podruzhkaSpec";
import { LAYOUT_RULES } from "@/lib/podruzhkaLayoutRules";
import type { VisionLayoutAdjustment } from "@/lib/podruzhkaVisionAdjust";

const B = S.blocks;

export type PodruzhkaRuntimeLayout = {
  textX: number;
  brand: { x: number; y: number; w: number; h: number };
  productType: { x: number; y: number; w: number; h: number };
  model: { x: number; y: number; w: number; h: number };
  accent: { x: number; y: number; w: number; h: number };
  notes: { x: number; startY: number; w: number; h: number; blockH: number };
  ml: { x: number; y: number };
  mlAccent: { x: number; y: number; w: number; h: number };
  product: { x: number; y: number; w: number; bottom: number };
  separator: { width: number };
};

export const PODRUZHKA_SIZE = S.size;

export function buildPodruzhkaLayout(adj?: VisionLayoutAdjustment): PodruzhkaRuntimeLayout {
  const n = (v: number | undefined, fallback: number) =>
    typeof v === "number" ? v : fallback;

  const noteBlockH = adj?.noteBlockHeight ?? S.noteBlockHeight;

  return {
    textX: B.brand.x,
    brand: {
      x: B.brand.x + n(adj?.brandXOffset, 0),
      y: B.brand.y + n(adj?.brandYOffset, 0),
      w: B.brand.w,
      h: B.brand.h
    },
    productType: {
      x: B.productType.x,
      y: B.productType.y + n(adj?.productTypeYOffset, 0),
      w: B.productType.w,
      h: B.productType.h
    },
    model: {
      x: B.model.x,
      y: B.model.y + n(adj?.modelYOffset, 0),
      w: B.model.w,
      h: B.model.h
    },
    accent: {
      x: S.accentBar.x,
      y: S.accentBar.y + n(adj?.accentYOffset, 0),
      w: S.accentBar.w,
      h: S.accentBar.h
    },
    notes: {
      x: B.notes.x,
      startY: B.notes.y + n(adj?.notesStartYOffset, 0),
      w: B.notes.w,
      h: B.notes.h,
      blockH: noteBlockH
    },
    ml: S.ml,
    mlAccent: S.mlAccent,
    product: {
      x: B.product.x + n(adj?.productLeftOffset, 0),
      y: B.product.y + n(adj?.productTopYOffset, 0),
      w: B.product.w,
      bottom: LAYOUT_RULES.productBottomY + n(adj?.productBottomYOffset, 0)
    },
    separator: { width: S.separatorWidth }
  };
}
