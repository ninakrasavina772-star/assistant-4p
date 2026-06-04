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
  ml: { x: B.volume.x + 5, y: B.volume.y + 28 },
  mlAccent: { x: B.volume.x, y: B.volume.y - 8, w: 50, h: 6 }
} as const;
