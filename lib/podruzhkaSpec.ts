import { PODRUZHKA_REFERENCE as R } from "@/lib/podruzhkaReferenceSpec";

/** Макет 1000×1400 — копия пропорций AI-референса */
export const PODRUZHKA_SPEC = {
  size: R.size,
  colors: R.colors,
  header: R.header,
  margins: { bottom: R.product.bottomMargin },
  ratios: {
    brandMaxWidth: R.text.brandMaxWidthRatio,
    brandMaxHeight: R.text.brandMaxHeightRatio,
    productX: R.product.xRatio,
    productY: R.product.yRatio,
    productW: R.product.wRatio,
    productFillHeight: R.product.fillHeight,
    loopFadeX: 0.48,
    loopFadeY: 200,
    loopFadeOpacity: 0.68
  },
  gaps: R.gaps,
  fonts: {
    brand: {
      maxSize: R.text.brandFontMax,
      minSize: R.text.brandFontMin,
      weight: 800,
      maxLines: 2
    },
    productType: { size: R.text.productTypeSize },
    model: { size: R.text.modelSize, weight: 800, maxLines: 2 },
    noteTitle: { size: R.text.noteTitleSize, weight: 700 },
    noteDesc: { size: R.text.noteDescSize, weight: 400 },
    ml: { size: 30, weight: 500, italic: true }
  },
  accentBar: R.accentBar,
  textStartY: R.text.startY,
  textX: R.text.x,
  noteBlockHeight: R.text.noteBlockHeight,
  noteDescOffset: 48,
  separatorWidth: R.separatorWidth,
  ml: { x: R.text.x + 5, y: R.text.mlY },
  mlAccent: { x: 60, y: R.text.mlAccentY, w: 50, h: 6 }
} as const;
