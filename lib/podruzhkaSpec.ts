import { figmaTextBaseline, PODRUZHKA_FIGMA as F } from "@/lib/podruzhkaFigmaLayout";
import { PODRUZHKA_REFERENCE as R } from "@/lib/podruzhkaReferenceSpec";

const B = R.blocks;

export const PODRUZHKA_SPEC = {
  size: R.size,
  colors: R.colors,
  blocks: R.blocks,
  margins: { bottom: R.size.h - B.product.y - B.product.h },
  fonts: R.fonts,
  product: R.product,
  accentBar: R.accentBar,
  textX: B.brand.x,
  noteBlockHeight: R.noteBlockHeight,
  noteTitleDy: R.noteTitleDy,
  noteDescDy: R.noteDescDy,
  separatorWidth: R.separatorWidth,
  ml: { x: F.ml.x, y: figmaTextBaseline(F.ml.y, F.ml.fontSize) },
  mlAccent: {
    x: R.mlAccentBar.x,
    y: R.mlAccentBar.y,
    w: R.mlAccentBar.w,
    h: R.mlAccentBar.h
  }
} as const;
