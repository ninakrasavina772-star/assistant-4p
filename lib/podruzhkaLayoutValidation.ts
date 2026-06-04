import type { VisionLayoutAdjustment } from "@/lib/podruzhkaVisionAdjust";
import { PODRUZHKA_REFERENCE as R } from "@/lib/podruzhkaReferenceSpec";
import { fitProductPng, type FitResult } from "@/lib/podruzhkaImageProcess";
import { buildPodruzhkaLayout, PODRUZHKA_SIZE, type PodruzhkaRuntimeLayout } from "@/lib/podruzhkaLayout";

const { w: W, h: H } = R.size;
const V = R.validation;

export type TextLayoutEstimate = {
  brandSize: number;
  brandLines: string[];
  brandMaxLineWidth: number;
  modelSize: number;
  modelLines: string[];
  modelMaxLineWidth: number;
  notesBlockH: number;
  noteBlockHeight: number;
};

export type FullLayoutMetrics = {
  productWidth: number;
  productHeight: number;
  productHeightRatio: number;
  productWidthRatio: number;
  productArea: number;
  brandArea: number;
  modelArea: number;
  notesArea: number;
  textArea: number;
  brandWidthRatio: number;
  emptyRightPx: number;
  emptyCenterPx: number;
  gapAboveVolumePx: number;
  drawX: number;
  drawY: number;
  productZoneMidY: number;
};

export type LayoutValidationIssue =
  | "product_height_too_low"
  | "product_height_too_high"
  | "product_width_too_low"
  | "product_vs_brand_too_small"
  | "product_vs_text_too_small"
  | "empty_right_too_large"
  | "empty_center_too_large"
  | "brand_dominates_product"
  | "brand_width_out_of_range"
  | "gap_above_volume_invalid"
  | "product_in_upper_half"
  | "notes_block_too_short"
  | "note_spacing_invalid"
  | "model_smaller_than_brand_ratio";

export const LAYOUT_ISSUE_MESSAGES: Record<LayoutValidationIssue, string> = {
  product_height_too_low: "высота товара < 48% макета",
  product_height_too_high: "высота товара > 58% макета",
  product_width_too_low: "ширина товара < 50% макета",
  product_vs_brand_too_small: "товар меньше бренда×2 (не доминирует)",
  product_vs_text_too_small: "товар меньше текста×1.5",
  empty_right_too_large: "слишком много пустоты справа",
  empty_center_too_large: "слишком много пустоты между текстом и товаром",
  brand_dominates_product: "бренд визуально крупнее товара",
  brand_width_out_of_range: "ширина бренда вне 40–55% макета",
  gap_above_volume_invalid: "низ товара не 20–50 px над объёмом",
  product_in_upper_half: "товар в верхней половине зоны (нужен низ)",
  notes_block_too_short: "блок нот < 280 px",
  note_spacing_invalid: "интервал между нотами вне 48–60 px",
  model_smaller_than_brand_ratio: "модель < 75% размера бренда"
};

export type LayoutValidationResult = {
  ok: boolean;
  issues: LayoutValidationIssue[];
  metrics: FullLayoutMetrics;
  messages: string[];
};

export function estimateTextArea(
  brandSize: number,
  brandLineCount: number,
  brandMaxW: number,
  modelSize: number,
  modelLineCount: number,
  modelMaxW: number,
  notesBlockH: number
): { brandArea: number; modelArea: number; notesArea: number; textArea: number } {
  const brandLineH = Math.round(brandSize * 1.05);
  const brandArea = brandMaxW * brandLineCount * brandLineH * 0.85;
  const modelLineH = Math.round(modelSize * 1.08);
  const modelArea = modelMaxW * modelLineCount * modelLineH * 0.85;
  const notesArea = R.blocks.notes.w * notesBlockH;
  return {
    brandArea,
    modelArea,
    notesArea,
    textArea: brandArea + modelArea + notesArea
  };
}

export function buildFullLayoutMetrics(input: {
  productWidth: number;
  productHeight: number;
  drawX: number;
  drawY: number;
  productZoneX: number;
  productZoneY: number;
  productZoneW: number;
  productZoneAvailH: number;
  volumeY: number;
  text: TextLayoutEstimate;
}): FullLayoutMetrics {
  const productBottom = input.drawY + input.productHeight;
  const gapAboveVolumePx = input.volumeY - productBottom;
  const emptyRightPx =
    input.productZoneX + input.productZoneW - (input.drawX + input.productWidth);
  const textColumnRight = R.blocks.brand.x + R.blocks.brand.w;
  const emptyCenterPx = Math.max(0, input.drawX - textColumnRight);
  const productArea = input.productWidth * input.productHeight;

  const areas = estimateTextArea(
    input.text.brandSize,
    input.text.brandLines.length,
    input.text.brandMaxLineWidth,
    input.text.modelSize,
    input.text.modelLines.length,
    input.text.modelMaxLineWidth,
    input.text.notesBlockH
  );

  return {
    productWidth: input.productWidth,
    productHeight: input.productHeight,
    productHeightRatio: input.productHeight / H,
    productWidthRatio: input.productWidth / W,
    productArea,
    brandArea: areas.brandArea,
    modelArea: areas.modelArea,
    notesArea: areas.notesArea,
    textArea: areas.textArea,
    brandWidthRatio: input.text.brandMaxLineWidth / W,
    emptyRightPx,
    emptyCenterPx,
    gapAboveVolumePx,
    drawX: input.drawX,
    drawY: input.drawY,
    productZoneMidY: input.productZoneY + input.productZoneAvailH / 2
  };
}

export function validateFullLayout(
  m: FullLayoutMetrics,
  text: TextLayoutEstimate
): LayoutValidationResult {
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
    issues.push("product_vs_text_too_small");
  }
  if (m.brandArea * 2 > m.productArea && !issues.includes("product_vs_brand_too_small")) {
    issues.push("brand_dominates_product");
  }
  if (
    m.brandWidthRatio < V.brandWidthRatioMin ||
    m.brandWidthRatio > V.brandWidthRatioMax
  ) {
    issues.push("brand_width_out_of_range");
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
  if (m.drawY + m.productHeight / 2 < m.productZoneMidY) {
    issues.push("product_in_upper_half");
  }
  if (text.notesBlockH < R.notesMinHeight) {
    issues.push("notes_block_too_short");
  }
  if (
    text.noteBlockHeight < R.noteSpacingMin + 40 ||
    text.noteBlockHeight > R.noteSpacingMax + 70
  ) {
    issues.push("note_spacing_invalid");
  }
  const minModel = Math.round(text.brandSize * R.fonts.model.ratioOfBrand);
  if (text.modelSize < minModel) {
    issues.push("model_smaller_than_brand_ratio");
  }

  const messages = issues.map((i) => LAYOUT_ISSUE_MESSAGES[i]);
  return { ok: issues.length === 0, issues, metrics: m, messages };
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
      case "product_vs_text_too_small":
      case "empty_right_too_large":
      case "empty_center_too_large":
      case "brand_dominates_product":
        next.productScaleMultiplier = Math.min(1.55, next.productScaleMultiplier + 0.09);
        if (
          issue === "empty_right_too_large" ||
          issue === "empty_center_too_large"
        ) {
          next.productLeftOffset = (next.productLeftOffset ?? 0) - 14;
        }
        break;
      case "product_height_too_high":
        next.productScaleMultiplier = Math.max(0.82, next.productScaleMultiplier - 0.04);
        break;
      case "brand_width_out_of_range":
        if (issue === "brand_width_out_of_range") next.brandFontDelta -= 6;
        break;
      case "brand_dominates_product":
        next.brandFontDelta -= 6;
        next.productScaleMultiplier = Math.min(1.55, next.productScaleMultiplier + 0.06);
        break;
      case "gap_above_volume_invalid":
        next.productBottomYOffset += 10;
        break;
      case "product_in_upper_half":
        next.productBottomYOffset += 14;
        break;
      case "model_smaller_than_brand_ratio":
        next.modelFontDelta = (next.modelFontDelta ?? 0) + 4;
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
  const maxPasses = V.maxCorrectionPasses;

  let lastFit: FitResult = { buffer: productBuf, width: 1, height: 1 };
  let lastMetrics = buildFullLayoutMetrics({
    productWidth: 1,
    productHeight: 1,
    drawX: R.blocks.product.x,
    drawY: R.blocks.product.y,
    productZoneX: R.blocks.product.x,
    productZoneY: R.blocks.product.y,
    productZoneW: R.blocks.product.w,
    productZoneAvailH: R.blocks.product.h,
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
      scaleMultiplier: adj.productScaleMultiplier
    });
    lastFit = fit;

    const drawX = zone.x + zone.w - fit.width + (adj.productLeftOffset ?? 0);
    const drawY = zone.bottom - fit.height;

    lastMetrics = buildFullLayoutMetrics({
      productWidth: fit.width,
      productHeight: fit.height,
      drawX,
      drawY,
      productZoneX: zone.x,
      productZoneY: zone.y,
      productZoneW: zone.w,
      productZoneAvailH: availH,
      volumeY,
      text
    });

    lastValidation = validateFullLayout(lastMetrics, text);
    if (lastValidation.ok) {
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
        adj = { ...adj, productBottomYOffset: (adj.productBottomYOffset ?? 0) - 14 };
      } else if (lastMetrics.gapAboveVolumePx > V.gapAboveVolumeMaxPx) {
        adj = { ...adj, productBottomYOffset: (adj.productBottomYOffset ?? 0) + 14 };
      }
    }
  }

  return {
    fit: lastFit,
    metrics: lastMetrics,
    adjustment: adj,
    validationPasses: maxPasses,
    validationOk: false,
    failureMessages: lastValidation.messages
  };
}

export function formatValidationFailure(messages: string[]): string {
  return `Композиция не прошла проверку по эталону CH: ${messages.join("; ")}`;
}
