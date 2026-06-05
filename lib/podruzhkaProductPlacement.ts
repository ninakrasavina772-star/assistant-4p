/**
 * Зона товара на карточке — правая колонка от типа продукта до низа (как на референсе).
 */
import { PODRUZHKA_FIGMA as F } from "@/lib/podruzhkaFigmaLayout";

const CARD_MARGIN_RIGHT = 32;

export const PODRUZHKA_PRODUCT_VISUAL = {
  x: F.product.x,
  y: F.productType.y - 44,
  w: F.frame.w - F.product.x - CARD_MARGIN_RIGHT,
  bottom: F.product.y + F.product.h
} as const;

/** Левая граница — не заезжать на текст/разделители (x=433). */
export const PODRUZHKA_TEXT_COLUMN_RIGHT = F.product.x;

/** Зазор от низа зоны — товар не «висит» на краю карточки (≈ Figma). */
export const PRODUCT_BOTTOM_LIFT = 32;

export function productVisualHeight(): number {
  return PODRUZHKA_PRODUCT_VISUAL.bottom - PODRUZHKA_PRODUCT_VISUAL.y;
}

export type ProductDrawPlacement = {
  drawX: number;
  drawY: number;
  zoneW: number;
  zoneH: number;
};

export function clampProductDrawPlacement(
  fit: { width: number; height: number; bottomAlphaInset?: number },
  drawX: number,
  drawY: number
): ProductDrawPlacement {
  const z = PODRUZHKA_PRODUCT_VISUAL;
  const zoneH = productVisualHeight();
  const inset = fit.bottomAlphaInset ?? 0;

  const maxW = z.w;
  let width = fit.width;
  let height = fit.height;
  if (width > maxW) {
    const s = maxW / width;
    width = maxW;
    height = Math.max(1, Math.round(height * s));
  }

  let x = Math.max(PODRUZHKA_TEXT_COLUMN_RIGHT, drawX);
  x = Math.min(x, z.x + z.w - width);
  let y = Math.max(z.y, drawY);
  y = Math.min(y, z.bottom - height + inset - PRODUCT_BOTTOM_LIFT);
  y = Math.max(z.y, Math.min(y, F.frame.h - height));

  return { drawX: x, drawY: y, zoneW: z.w, zoneH };
}

export function computeProductDrawY(
  fit: { width: number; height: number; bottomAlphaInset?: number },
  verticalAlign: "bottom" | "lower-third" = "bottom"
): number {
  const z = PODRUZHKA_PRODUCT_VISUAL;
  const zoneH = productVisualHeight();
  const inset = fit.bottomAlphaInset ?? 0;
  const floorY = z.bottom - fit.height + inset - PRODUCT_BOTTOM_LIFT;

  if (verticalAlign === "lower-third") {
    const slack = zoneH - fit.height + inset - PRODUCT_BOTTOM_LIFT;
    if (slack <= 0) return Math.max(z.y, floorY);
    return z.y + slack * 0.22;
  }

  return Math.max(z.y, floorY);
}

export function computeProductDrawPlacement(fit: {
  width: number;
  height: number;
  bottomAlphaInset?: number;
}): ProductDrawPlacement {
  const z = PODRUZHKA_PRODUCT_VISUAL;
  const inset = fit.bottomAlphaInset ?? 0;
  const drawX = z.x + z.w - fit.width;
  const drawY = computeProductDrawY(fit, "bottom");
  return clampProductDrawPlacement(fit, drawX, drawY);
}

export const PODRUZHKA_PRODUCT_FIT = {
  referenceBoxScale: 1,
  referenceBoxMinHeightFill: 0.94,
  referenceBoxMinWidthFill: 0.92,
  referenceBoxMinCardHeightFill: 0.54
} as const;
