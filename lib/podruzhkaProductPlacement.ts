/**
 * Зона товара на карточке — правая колонка от типа продукта до низа (как на референсе).
 * Выше Figma product.y=616: фото заполняет высоту, а не «прилипает» мелким к углу.
 */
import { PODRUZHKA_FIGMA as F } from "@/lib/podruzhkaFigmaLayout";

const CARD_MARGIN_RIGHT = 32;

export const PODRUZHKA_PRODUCT_VISUAL = {
  x: F.product.x,
  /** ~480 px — верх зелёной рамки (под брендом, у типа) */
  y: F.productType.y - 44,
  w: F.frame.w - F.product.x - CARD_MARGIN_RIGHT,
  bottom: F.product.y + F.product.h
} as const;

export function productVisualHeight(): number {
  return PODRUZHKA_PRODUCT_VISUAL.bottom - PODRUZHKA_PRODUCT_VISUAL.y;
}

export type ProductDrawPlacement = {
  drawX: number;
  drawY: number;
  zoneW: number;
  zoneH: number;
};

export function computeProductDrawPlacement(fit: {
  width: number;
  height: number;
  bottomAlphaInset?: number;
}): ProductDrawPlacement {
  const z = PODRUZHKA_PRODUCT_VISUAL;
  const zoneH = productVisualHeight();
  const inset = fit.bottomAlphaInset ?? 0;
  const drawX = z.x + z.w - fit.width;
  const drawY = Math.max(z.y, z.bottom - fit.height + inset);

  return { drawX, drawY, zoneW: z.w, zoneH };
}

/** Параметры fit для API / валидации */
export const PODRUZHKA_PRODUCT_FIT = {
  referenceBoxScale: 1,
  referenceBoxMinHeightFill: 0.96,
  referenceBoxMinWidthFill: 0.88,
  referenceBoxMinCardHeightFill: 0.54
} as const;
