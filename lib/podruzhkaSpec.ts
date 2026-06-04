import { PODRUZHKA_REFERENCE as R } from "@/lib/podruzhkaReferenceSpec";

export const PODRUZHKA_SPEC = {
  size: R.size,
  colors: R.colors,
  header: R.header,
  contentClearTop: R.contentClearTop,
  margins: { bottom: R.size.h - R.product.bottomY },
  ratios: {
    brandMaxWidth: R.text.brandMaxWidthRatio,
    brandMaxHeight: R.text.brandMaxHeightRatio
  },
  product: R.product,
  fixed: R.text,
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
  textX: R.text.x,
  noteBlockHeight: R.text.noteBlockHeight,
  noteTitleDy: R.text.noteTitleDy,
  noteDescDy: R.text.noteDescDy,
  separatorWidth: R.separatorWidth,
  ml: { x: R.text.x + 5, y: R.text.mlY },
  mlAccent: { x: 60, y: R.text.mlAccentY, w: 50, h: 6 }
} as const;
