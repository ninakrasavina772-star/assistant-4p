import type { VisionLayoutAdjustment } from "@/lib/podruzhkaVisionAdjust";
import { PODRUZHKA_REFERENCE as R } from "@/lib/podruzhkaReferenceSpec";
import { fitProductPng, type FitResult } from "@/lib/podruzhkaImageProcess";
import { buildPodruzhkaLayout, PODRUZHKA_SIZE, type PodruzhkaRuntimeLayout } from "@/lib/podruzhkaLayout";

const { w: W, h: H } = R.size;
const V = R.validation;

export type ProductLayoutMetrics = {
  productWidth: number;
  productHeight: number;
  productHeightRatio: number;
  productWidthRatio: number;
  productArea: number;
  productAreaShareOfContent: number;
  brandVisualArea: number;
  emptyRightPx: number;
  emptyCenterPx: number;
  gapAboveVolumePx: number;
  drawX: number;
  drawY: number;
};

export type LayoutValidationIssue =
  | "product_height_too_low"
  | "product_height_too_high"
  | "product_width_too_low"
  | "product_area_too_low"
  | "empty_right_too_large"
  | "empty_center_too_large"
  | "brand_dominates_product"
  | "product_too_high_above_volume";

export type LayoutValidationResult = {
  ok: boolean;
  issues: LayoutValidationIssue[];
  metrics: ProductLayoutMetrics;
};

export function estimateBrandVisualArea(
  brandSize: number,
  lineCount: number,
  maxLineWidth: number
): number {
  const lineH = Math.round(brandSize * 1.05);
  return maxLineWidth * lineCount * lineH * 0.85;
}

export function buildProductLayoutMetrics(input: {
  productWidth: number;
  productHeight: number;
  drawX: number;
  drawY: number;
  brandVisualArea: number;
  productZoneX: number;
  productZoneW: number;
  volumeY: number;
}): ProductLayoutMetrics {
  const productBottom = input.drawY + input.productHeight;
  const gapAboveVolumePx = input.volumeY - productBottom;
  const emptyRightPx = input.productZoneX + input.productZoneW - (input.drawX + input.productWidth);
  const textColumnRight = R.blocks.brand.x + R.blocks.brand.w;
  const emptyCenterPx = Math.max(0, input.drawX - textColumnRight);

  const productArea = input.productWidth * input.productHeight;
  const contentArea = V.contentRect.w * V.contentRect.h;

  return {
    productWidth: input.productWidth,
    productHeight: input.productHeight,
    productHeightRatio: input.productHeight / H,
    productWidthRatio: input.productWidth / W,
    productArea,
    productAreaShareOfContent: productArea / contentArea,
    brandVisualArea: input.brandVisualArea,
    emptyRightPx,
    emptyCenterPx,
    gapAboveVolumePx,
    drawX: input.drawX,
    drawY: input.drawY
  };
}

export function validateLayoutMetrics(m: ProductLayoutMetrics): LayoutValidationResult {
  const issues: LayoutValidationIssue[] = [];

  if (m.productHeightRatio < V.productHeightRatioMin) {
    issues.push("product_height_too_low");
  }
  if (m.productHeightRatio > V.productHeightRatioMax) {
    issues.push("product_height_too_high");
  }
  if (m.productWidthRatio < V.productWidthRatioMin) {
    issues.push("product_width_too_low");
  }
  if (m.productAreaShareOfContent < V.minProductAreaShareOfContent) {
    issues.push("product_area_too_low");
  }
  if (m.emptyRightPx > V.referenceEmptyRightPx * V.emptySpaceTolerance) {
    issues.push("empty_right_too_large");
  }
  if (m.emptyCenterPx > V.referenceEmptyCenterPx * V.emptySpaceTolerance) {
    issues.push("empty_center_too_large");
  }
  if (m.brandVisualArea > m.productArea * V.maxBrandToProductAreaRatio) {
    issues.push("brand_dominates_product");
  }
  if (
    m.gapAboveVolumePx < V.gapAboveVolumeMinPx ||
    m.gapAboveVolumePx > V.gapAboveVolumeMaxPx + 80
  ) {
    if (m.gapAboveVolumePx > V.gapAboveVolumeMaxPx + 40) {
      issues.push("product_too_high_above_volume");
    }
  }

  return { ok: issues.length === 0, issues, metrics: m };
}

export function correctionsForIssues(
  issues: LayoutValidationIssue[],
  adj: VisionLayoutAdjustment
): VisionLayoutAdjustment {
  const next = { ...adj };

  for (const issue of issues) {
    switch (issue) {
      case "product_height_too_low":
      case "product_width_too_low":
      case "product_area_too_low":
        next.productScaleMultiplier = Math.min(1.45, next.productScaleMultiplier + 0.08);
        break;
      case "empty_right_too_large":
      case "empty_center_too_large":
        next.productScaleMultiplier = Math.min(1.45, next.productScaleMultiplier + 0.06);
        next.productLeftOffset = (next.productLeftOffset ?? 0) - 12;
        break;
      case "product_height_too_high":
        next.productScaleMultiplier = Math.max(0.85, next.productScaleMultiplier - 0.05);
        break;
      case "brand_dominates_product":
        next.brandFontDelta -= 5;
        next.productScaleMultiplier = Math.min(1.45, next.productScaleMultiplier + 0.05);
        break;
      case "product_too_high_above_volume":
        next.productBottomYOffset += 18;
        break;
      default:
        break;
    }
  }

  return next;
}

export const MAX_LAYOUT_CORRECTION_PASSES = 10;

export type ResolvedProductPlacement = {
  fit: FitResult;
  metrics: ProductLayoutMetrics;
  adjustment: VisionLayoutAdjustment;
  validationPasses: number;
  validationOk: boolean;
};

const BASE_ADJ: VisionLayoutAdjustment = {
  brandYOffset: 0,
  brandXOffset: 0,
  productTypeYOffset: 0,
  modelYOffset: 0,
  accentYOffset: 0,
  notesStartYOffset: 0,
  productTopYOffset: 0,
  productBottomYOffset: 0,
  productLeftOffset: 0,
  productScaleMultiplier: 1,
  brandFontDelta: 0
};

export async function autoCorrectProductLayout(
  productBuf: Buffer,
  L: PodruzhkaRuntimeLayout,
  brandInfo: { size: number; lines: string[]; maxLineWidth: number },
  initialAdj?: VisionLayoutAdjustment
): Promise<ResolvedProductPlacement> {
  const { h: H } = PODRUZHKA_SIZE;
  let adj: VisionLayoutAdjustment = { ...BASE_ADJ, ...initialAdj };
  const volumeY = R.blocks.volume.y;

  let lastFit: FitResult = { buffer: productBuf, width: 1, height: 1 };
  let lastMetrics = buildProductLayoutMetrics({
    productWidth: 1,
    productHeight: 1,
    drawX: L.product.x,
    drawY: L.product.y,
    brandVisualArea: 0,
    productZoneX: L.product.x,
    productZoneW: L.product.w,
    volumeY
  });
  let lastValidation: LayoutValidationResult = { ok: false, issues: [], metrics: lastMetrics };

  for (let pass = 0; pass < MAX_LAYOUT_CORRECTION_PASSES; pass++) {
    const runtimeL = buildPodruzhkaLayout(adj);
    const zone = runtimeL.product;
    const availH = zone.bottom - zone.y;

    const fit = await fitProductPng(productBuf, zone.w, availH, {
      cardH: H,
      cardW: PODRUZHKA_SIZE.w,
      scaleMultiplier: adj.productScaleMultiplier
    });
    lastFit = fit;

    const drawX = zone.x + zone.w - fit.width + (adj.productLeftOffset ?? 0);
    const drawY = zone.bottom - fit.height;

    const brandArea = estimateBrandVisualArea(
      brandInfo.size,
      brandInfo.lines.length,
      brandInfo.maxLineWidth
    );

    lastMetrics = buildProductLayoutMetrics({
      productWidth: fit.width,
      productHeight: fit.height,
      drawX,
      drawY,
      brandVisualArea: brandArea,
      productZoneX: zone.x,
      productZoneW: zone.w,
      volumeY
    });

    lastValidation = validateLayoutMetrics(lastMetrics);
    if (lastValidation.ok) {
      return {
        fit: lastFit,
        metrics: lastMetrics,
        adjustment: adj,
        validationPasses: pass + 1,
        validationOk: true
      };
    }

    adj = correctionsForIssues(lastValidation.issues, adj);
  }

  return {
    fit: lastFit,
    metrics: lastMetrics,
    adjustment: adj,
    validationPasses: MAX_LAYOUT_CORRECTION_PASSES,
    validationOk: lastValidation.ok
  };
}
