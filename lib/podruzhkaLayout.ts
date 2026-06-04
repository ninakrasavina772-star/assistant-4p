import { PODRUZHKA_SPEC as S } from "@/lib/podruzhkaSpec";

export const PODRUZHKA_SIZE = S.size;

const logoBottom = S.margins.logoTop + S.logo.height;

/** Верх текстового блока: 80px под логотипом (ТЗ) */
export const PODRUZHKA_CONTENT_TOP = logoBottom + S.margins.belowLogo;

export const PODRUZHKA_LAYOUT = {
  logo: {
    y: S.margins.logoTop,
    h: S.logo.height,
    maxW: S.logo.maxWidth
  },
  contentLeft: S.margins.contentLeft,
  contentTop: PODRUZHKA_CONTENT_TOP,
  brand: {
    maxWidth: 480,
    fontSize: S.fonts.brand.size,
    lineHeight: Math.round(S.fonts.brand.size * 1.05)
  },
  productType: {
    maxWidth: 480,
    fontSize: S.fonts.productType.size,
    lineHeight: 26,
    gapAfterBrand: 14
  },
  model: {
    maxWidth: 480,
    fontSize: S.fonts.model.size,
    lineHeight: 40,
    gapAfterType: 12
  },
  gapAfterModel: 22,
  gapAfterAccent: 28,
  noteLineHeight: S.noteBlockHeight,
  noteTitleOffsetY: 20,
  noteDescOffsetY: 44,
  ml: {
    y: S.size.h - S.margins.contentBottom - 8,
    fontSize: S.fonts.ml.size
  },
  accentBeforeMlOffset: 36,
  product: { x: 468, y: 210, w: 572, h: 1080 },
  separator: { width: S.separatorWidth },
  /** Зоны полной замены (не наложение) */
  zones: {
    text: { x: 0, y: PODRUZHKA_CONTENT_TOP - 12, w: 520, h: S.size.h - PODRUZHKA_CONTENT_TOP - 24 },
    product: { x: 448, y: 188, w: 632, h: S.size.h - 188 }
  }
} as const;
