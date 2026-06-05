import type { VisionLayoutAdjustment } from "@/lib/podruzhkaVisionAdjust";
import { PODRUZHKA_REFERENCE as R } from "@/lib/podruzhkaReferenceSpec";
import { REFERENCE_TEXT_ANCHORS } from "@/lib/podruzhkaReferenceAnchors";
import { LAYOUT_RULES } from "@/lib/podruzhkaLayoutRules";
import { fitProductPng, type FitResult } from "@/lib/podruzhkaImageProcess";
import { buildPodruzhkaLayout, PODRUZHKA_SIZE } from "@/lib/podruzhkaLayout";

const { w: W, h: H } = R.size;
const V = R.validation;

export type TextLayoutEstimate = {
  brandSize: number;
  brandLines: string[];
  brandMaxLineWidth: number;
  modelSize: number;
  modelLines: string[];
  modelMaxLineWidth: number;
  noteBlockHeight: number;
  /** Верх розовой плашки объёма (поток текста) — для зазора под товаром */
  mlAnchorY: number;
};

export type FullLayoutMetrics = {
  productWidth: number;
  productHeight: number;
  productHeightRatio: number;
  productWidthRatio: number;
  productArea: number;
  brandArea: number;
  modelArea: number;
  textArea: number;
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
  | "product_vs_brand_too_small"
  | "empty_right_too_large"
  | "empty_center_too_large"
  | "gap_above_volume_invalid"
  | "product_not_bottom_anchored";

export const LAYOUT_ISSUE_MESSAGES: Record<LayoutValidationIssue, string> = {
  product_height_too_low: "высота товара < 48% макета",
  product_height_too_high: "высота товара > 58% макета",
  product_width_too_low: "ширина товара < 50% макета",
  product_vs_brand_too_small: "товар меньше бренда×2",
  empty_right_too_large: "слишком много пустоты справа",
  empty_center_too_large: "слишком много пустоты между текстом и товаром",
  gap_above_volume_invalid: "низ товара не 20–50 px над объёмом",
  product_not_bottom_anchored: "товар не прижат к низу зоны"
};

export type LayoutValidationResult = {
  ok: boolean;
  issues: LayoutValidationIssue[];
  metrics: FullLayoutMetrics;
  messages: string[];
};

/** Визуальная площадь текста (без пустой зоны нот 320px) */
export function estimateTextAreas(text: TextLayoutEstimate): {
  brandArea: number;
  modelArea: number;
  textArea: number;
} {
  const brandLineH = Math.round(text.brandSize * 1.05);
  const brandArea = text.brandMaxLineWidth * text.brandLines.length * brandLineH * 0.85;
  const modelLineH = Math.round(text.modelSize * 1.08);
  const modelArea = text.modelMaxLineWidth * text.modelLines.length * modelLineH * 0.85;
  const notesContentH = text.noteBlockHeight * 3;
  const notesArea = R.blocks.notes.w * notesContentH * 0.5;
  return {
    brandArea,
    modelArea,
    textArea: brandArea + modelArea + notesArea
  };
}

export function buildFullLayoutMetrics(input: {
  productWidth: number;
  productHeight: number;
  drawX: number;
  drawY: number;
  bottomAlphaInset?: number;
  productZoneX: number;
  productZoneY: number;
  productZoneW: number;
  productZoneAvailH: number;
  productZoneBottom: number;
  volumeY: number;
  text: TextLayoutEstimate;
}): FullLayoutMetrics {
  const bottomInset = input.bottomAlphaInset ?? 0;
  const productVisualBottom = input.drawY + input.productHeight - bottomInset;
  const gapAboveVolumePx = input.volumeY - productVisualBottom;
  const emptyRightPx =
    input.productZoneX + input.productZoneW - (input.drawX + input.productWidth);
  const textColumnRight = R.blocks.brand.x + R.blocks.brand.w;
  const emptyCenterPx = Math.max(0, input.drawX - textColumnRight);
  const productArea = input.productWidth * input.productHeight;
  const areas = estimateTextAreas(input.text);

  return {
    productWidth: input.productWidth,
    productHeight: input.productHeight,
    productHeightRatio: input.productHeight / H,
    productWidthRatio: input.productWidth / W,
    productArea,
    brandArea: areas.brandArea,
    modelArea: areas.modelArea,
    textArea: areas.textArea,
    emptyRightPx,
    emptyCenterPx,
    gapAboveVolumePx,
    drawX: input.drawX,
    drawY: input.drawY
  };
}

export function validateFullLayout(m: FullLayoutMetrics): LayoutValidationResult {
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
  if (m.productArea < m.brandArea * V.productVsBrandAreaMultiplier) {
    issues.push("product_vs_brand_too_small");
  }
  if (m.productArea < m.textArea * V.productVsTextAreaMultiplier) {
    issues.push("product_vs_brand_too_small");
  }
  if (m.emptyRightPx > V.referenceEmptyRightPx * V.emptySpaceTolerance) {
    issues.push("empty_right_too_large");
  }
  if (m.emptyCenterPx > V.referenceEmptyCenterPx * V.emptySpaceTolerance) {
    issues.push("empty_center_too_large");
  }
  if (
    m.gapAboveVolumePx < V.gapAboveVolumeMinPx ||
    m.gapAboveVolumePx > V.gapAboveVolumeMaxPx
  ) {
    issues.push("gap_above_volume_invalid");
  }

  const messages = [...new Set(issues.map((i) => LAYOUT_ISSUE_MESSAGES[i]))];
  return { ok: issues.length === 0, issues, metrics: m, messages };
}

/** После maxPasses — только если остались мягкие отклонения по пустотам */
export function hardLayoutPass(m: FullLayoutMetrics): boolean {
  const strict = validateFullLayout(m);
  if (strict.ok) return true;
  const softOnly = strict.issues.every(
    (i) => i === "empty_right_too_large" || i === "empty_center_too_large"
  );
  return (
    softOnly &&
    m.productHeightRatio >= V.productHeightRatioMin &&
    m.productHeightRatio <= V.productHeightRatioMax + 0.02 &&
    m.productArea >= m.brandArea * V.productVsBrandAreaMultiplier &&
    m.gapAboveVolumePx >= V.gapAboveVolumeMinPx &&
    m.gapAboveVolumePx <= V.gapAboveVolumeMaxPx
  );
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
      case "product_vs_brand_too_small":
      case "empty_right_too_large":
      case "empty_center_too_large":
        next.productScaleMultiplier = Math.min(1.65, next.productScaleMultiplier + 0.1);
        if (
          issue === "empty_right_too_large" ||
          issue === "empty_center_too_large"
        ) {
          next.productLeftOffset = (next.productLeftOffset ?? 0) - 16;
        }
        if (issue === "product_vs_brand_too_small") {
          next.brandFontDelta -= 8;
        }
        break;
      case "product_height_too_high":
        next.productScaleMultiplier = Math.max(0.88, next.productScaleMultiplier - 0.05);
        break;
      case "gap_above_volume_invalid":
        break;
      default:
        break;
    }
  }

  return next;
}

export type ResolvedProductPlacement = {
  fit: FitResult;
  metrics: FullLayoutMetrics;
  adjustment: VisionLayoutAdjustment;
  validationPasses: number;
  validationOk: boolean;
  failureMessages: string[];
};

const BASE_ADJ: VisionLayoutAdjustment = LAYOUT_RULES.replaceOnly
  ? {
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
      brandFontDelta: 0,
      modelFontDelta: 0
    }
  : {
      brandYOffset: 0,
      brandXOffset: 0,
      productTypeYOffset: 0,
      modelYOffset: 0,
      accentYOffset: 0,
      notesStartYOffset: 0,
      productTopYOffset: 0,
      productBottomYOffset: 0,
      productLeftOffset: 0,
      productScaleMultiplier: 1.38,
      brandFontDelta: 0,
      modelFontDelta: 0
    };

export async function autoCorrectProductLayout(
  productBuf: Buffer,
  text: TextLayoutEstimate,
  initialAdj?: VisionLayoutAdjustment
): Promise<ResolvedProductPlacement> {
  let adj: VisionLayoutAdjustment = { ...BASE_ADJ, ...initialAdj };
  const volumeY = R.blocks.volume.y;
  const productBottomTarget = LAYOUT_RULES.productBottomY;
  const maxPasses = V.maxCorrectionPasses;

  let lastFit: FitResult = {
    buffer: productBuf,
    width: 1,
    height: 1,
    bottomAlphaInset: 0
  };
  let lastMetrics = buildFullLayoutMetrics({
    productWidth: 1,
    productHeight: 1,
    drawX: R.blocks.product.x,
    drawY: R.blocks.product.y,
    productZoneX: R.blocks.product.x,
    productZoneY: R.blocks.product.y,
    productZoneW: R.blocks.product.w,
    productZoneAvailH: R.blocks.product.h,
    productZoneBottom: R.product.bottomAlignY,
    volumeY,
    text
  });
  let lastValidation: LayoutValidationResult = {
    ok: false,
    issues: [],
    metrics: lastMetrics,
    messages: []
  };

  for (let pass = 0; pass < maxPasses; pass++) {
    const runtimeL = buildPodruzhkaLayout(adj);
    const zone = runtimeL.product;
    const availH = zone.bottom - zone.y;

    const fit = await fitProductPng(productBuf, zone.w, availH, {
      cardH: H,
      cardW: W,
      scaleMultiplier: adj.productScaleMultiplier,
      referenceBoxOnly: LAYOUT_RULES.replaceOnly,
      referenceBoxScale: LAYOUT_RULES.replaceOnly
        ? REFERENCE_TEXT_ANCHORS.productBoxScale
        : undefined,
      referenceBoxMinHeightFill: LAYOUT_RULES.replaceOnly
        ? REFERENCE_TEXT_ANCHORS.productBoxMinHeightFill
        : undefined,
      referenceBoxMinWidthFill: LAYOUT_RULES.replaceOnly
        ? REFERENCE_TEXT_ANCHORS.productBoxMinWidthFill
        : undefined
    });
    lastFit = fit;

    const drawX = Math.max(
      zone.x,
      zone.x + zone.w - fit.width + (adj.productLeftOffset ?? 0)
    );
    const inset = fit.bottomAlphaInset ?? 0;
    const drawY = Math.max(zone.y, zone.bottom - fit.height + inset);

    lastMetrics = buildFullLayoutMetrics({
      productWidth: fit.width,
      productHeight: fit.height,
      drawX,
      drawY,
      bottomAlphaInset: inset,
      productZoneX: zone.x,
      productZoneY: zone.y,
      productZoneW: zone.w,
      productZoneAvailH: availH,
      productZoneBottom: zone.bottom,
      volumeY,
      text
    });

    lastValidation = validateFullLayout(lastMetrics);
    if (lastValidation.ok || LAYOUT_RULES.replaceOnly) {
      return {
        fit: lastFit,
        metrics: lastMetrics,
        adjustment: adj,
        validationPasses: pass + 1,
        validationOk: true,
        failureMessages: []
      };
    }

    adj = correctionsForIssues(lastValidation.issues, adj);

    if (lastValidation.issues.includes("gap_above_volume_invalid")) {
      if (lastMetrics.gapAboveVolumePx < V.gapAboveVolumeMinPx) {
        adj = { ...adj, productBottomYOffset: (adj.productBottomYOffset ?? 0) - 12 };
      } else if (lastMetrics.gapAboveVolumePx > V.gapAboveVolumeMaxPx) {
        adj = { ...adj, productBottomYOffset: (adj.productBottomYOffset ?? 0) + 12 };
      }
    }
  }

  const ok = hardLayoutPass(lastMetrics);
  return {
    fit: lastFit,
    metrics: lastMetrics,
    adjustment: adj,
    validationPasses: maxPasses,
    validationOk: ok,
    failureMessages: ok ? [] : lastValidation.messages
  };
}

export function formatValidationFailure(messages: string[]): string {
  return `Композиция не соответствует эталону Carolina Herrera: ${messages.join("; ")}`;
}
