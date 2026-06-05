/**
 * Зона товара на карточке — правая колонка от типа продукта до низа (как на референсе).
 */
import { PODRUZHKA_FIGMA as F } from "@/lib/podruzhkaFigmaLayout";
import type { PreparedProductImage } from "@/lib/podruzhkaImageProcess";

const CARD_MARGIN_RIGHT = 32;

export const PODRUZHKA_PRODUCT_VISUAL = {
  x: F.product.x,
  y: F.productType.y - 44,
  w: F.frame.w - F.product.x - CARD_MARGIN_RIGHT,
  bottom: F.product.y + F.product.h
} as const;

/** Левая граница — не заезжать на текст/разделители (x=433). */
export const PODRUZHKA_TEXT_COLUMN_RIGHT = F.product.x;

export function productVisualHeight(): number {
  return PODRUZHKA_PRODUCT_VISUAL.bottom - PODRUZHKA_PRODUCT_VISUAL.y;
}

export type ProductDrawPlacement = {
  drawX: number;
  drawY: number;
  zoneW: number;
  zoneH: number;
  bottomLift: number;
};

/** Подбор зазора снизу: Burberry (низко в кадре) — выше; Gucci/наборы — как сейчас. */
export function computeAdaptiveBottomLift(
  fit: { height: number; bottomAlphaInset?: number },
  hints: Pick<PreparedProductImage, "aspect" | "bottomPadRatio" | "topPadRatio">
): number {
  const inset = fit.bottomAlphaInset ?? 0;
  const zoneH = productVisualHeight();
  const zoneFill = fit.height / zoneH;

  if (hints.aspect >= 1.08) {
    return Math.max(6, Math.min(14, Math.round(10 - inset * 0.12)));
  }

  const tightBottom = hints.bottomPadRatio < 0.07;
  const looseTop = hints.topPadRatio > 0.12;

  let lift = 18;

  if (hints.aspect <= 0.78 && zoneFill > 0.68) {
    lift = tightBottom ? 38 : 30;
  } else if (tightBottom && looseTop) {
    lift = 34;
  } else if (hints.bottomPadRatio > 0.11 || inset > 18) {
    lift = Math.max(8, Math.round(14 - inset * 0.2));
  } else if (zoneFill < 0.52) {
    lift = 12;
  }

  return Math.max(6, Math.min(44, Math.round(lift - inset * 0.3)));
}

export function liftCandidates(baseLift: number): number[] {
  const raw = [baseLift - 10, baseLift - 4, baseLift, baseLift + 4, baseLift + 10, 0];
  const uniq = [...new Set(raw.map((n) => Math.round(n)))].filter((n) => n >= 0 && n <= 48);
  return uniq.sort((a, b) => a - b);
}

export function clampProductDrawPlacement(
  fit: { width: number; height: number; bottomAlphaInset?: number },
  drawX: number,
  drawY: number,
  bottomLift: number
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
  y = Math.min(y, z.bottom - height + inset - bottomLift);
  y = Math.max(z.y, Math.min(y, F.frame.h - height));

  return { drawX: x, drawY: y, zoneW: z.w, zoneH, bottomLift };
}

export function computeProductDrawY(
  fit: { width: number; height: number; bottomAlphaInset?: number },
  verticalAlign: "bottom" | "lower-third",
  bottomLift: number
): number {
  const z = PODRUZHKA_PRODUCT_VISUAL;
  const zoneH = productVisualHeight();
  const inset = fit.bottomAlphaInset ?? 0;
  const floorY = z.bottom - fit.height + inset - bottomLift;

  if (verticalAlign === "lower-third") {
    const slack = zoneH - fit.height + inset - bottomLift;
    if (slack <= 0) return Math.max(z.y, floorY);
    return z.y + slack * 0.22;
  }

  return Math.max(z.y, floorY);
}

export function computeProductDrawPlacement(
  fit: { width: number; height: number; bottomAlphaInset?: number },
  hints: Pick<PreparedProductImage, "aspect" | "bottomPadRatio" | "topPadRatio">
): ProductDrawPlacement {
  const bottomLift = computeAdaptiveBottomLift(fit, hints);
  const drawX = PODRUZHKA_PRODUCT_VISUAL.x + PODRUZHKA_PRODUCT_VISUAL.w - fit.width;
  const drawY = computeProductDrawY(fit, "bottom", bottomLift);
  return clampProductDrawPlacement(fit, drawX, drawY, bottomLift);
}

export const PODRUZHKA_PRODUCT_FIT = {
  referenceBoxScale: 1,
  referenceBoxMinHeightFill: 0.94,
  referenceBoxMinWidthFill: 0.92,
  referenceBoxMinCardHeightFill: 0.54
} as const;
