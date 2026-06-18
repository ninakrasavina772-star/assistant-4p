/**
 * Визуальный подбор масштаба foto — как ручная подгонка в Figma.
 * contain-only: без crop по бокам (коробка+флакон не режем).
 */
import {
  fitProductPng,
  prepareProductImage,
  type FitResult,
  type PreparedProductImage
} from "@/lib/podruzhkaImageProcess";
import { PODRUZHKA_FIGMA as F } from "@/lib/podruzhkaFigmaLayout";
import { PODRUZHKA_REFERENCE as R } from "@/lib/podruzhkaReferenceSpec";
import {
  clampProductDrawPlacement,
  computeAdaptiveBottomLift,
  computeProductDrawY,
  liftCandidates,
  PODRUZHKA_PRODUCT_VISUAL,
  PODRUZHKA_TEXT_COLUMN_RIGHT,
  productVisualHeight
} from "@/lib/podruzhkaProductPlacement";

import type { PodruzhkaRenderProfile } from "@/lib/podruzhkaCosmeticsLayout";
import {
  PODRUZHKA_COSMETICS_FOTO_MODE,
  PODRUZHKA_COSMETICS_PRODUCT_SCALE,
  PODRUZHKA_COSMETICS_TARGET_ZONE_HEIGHT_FILL,
  PODRUZHKA_COSMETICS_TARGET_ZONE_WIDTH_FILL,
  PODRUZHKA_COSMETICS_VERTICAL_CENTER_BIAS
} from "@/lib/podruzhkaCosmeticsLayout";

type VerticalAlign = "bottom" | "lower-third";

type FitStrategy = {
  id: string;
  scaleMultiplier: number;
  referenceBoxMinHeightFill: number;
  referenceBoxMinWidthFill: number;
  referenceBoxMinCardHeightFill: number;
  verticalAlign: VerticalAlign;
};

export type AdaptiveProductResult = {
  fit: FitResult;
  drawX: number;
  drawY: number;
  strategyId: string;
  visualScore: number;
};

const TARGET_H = R.product.heightRatioTarget;
const TARGET_W = R.product.widthRatioTarget;
const WIDE_ASPECT = 1.08;

function buildStrategies(prepared: PreparedProductImage): FitStrategy[] {
  const { aspect, maxDim } = prepared;
  const isWide = aspect >= WIDE_ASPECT;

  const strategies: FitStrategy[] = [
    {
      id: isWide ? "wide-balanced" : "balanced",
      scaleMultiplier: 1,
      referenceBoxMinHeightFill: isWide ? 0.86 : 0.94,
      referenceBoxMinWidthFill: isWide ? 0.94 : 0.88,
      referenceBoxMinCardHeightFill: isWide ? 0 : TARGET_H,
      verticalAlign: "bottom"
    },
    {
      id: isWide ? "wide-width-first" : "height-priority",
      scaleMultiplier: isWide ? 1.02 : 1.04,
      referenceBoxMinHeightFill: isWide ? 0.82 : 0.97,
      referenceBoxMinWidthFill: isWide ? 0.96 : 0.82,
      referenceBoxMinCardHeightFill: isWide ? 0 : TARGET_H,
      verticalAlign: "bottom"
    }
  ];

  if (isWide) {
    strategies.push({
      id: "wide-set-compact",
      scaleMultiplier: 1.05,
      referenceBoxMinHeightFill: 0.8,
      referenceBoxMinWidthFill: 0.98,
      referenceBoxMinCardHeightFill: 0,
      verticalAlign: "lower-third"
    });
  }

  if (aspect <= 0.75) {
    strategies.push({
      id: "tall-bottle",
      scaleMultiplier: 1.03,
      referenceBoxMinHeightFill: 0.98,
      referenceBoxMinWidthFill: 0.78,
      referenceBoxMinCardHeightFill: 0.6,
      verticalAlign: "bottom"
    });
  }

  if (maxDim < 520) {
    strategies.push(
      {
        id: "small-source-upscale",
        scaleMultiplier: 1.12,
        referenceBoxMinHeightFill: isWide ? 0.86 : 0.94,
        referenceBoxMinWidthFill: 0.92,
        referenceBoxMinCardHeightFill: isWide ? 0 : TARGET_H,
        verticalAlign: "bottom"
      },
      {
        id: "small-source-upscale-strong",
        scaleMultiplier: 1.2,
        referenceBoxMinHeightFill: isWide ? 0.88 : 0.96,
        referenceBoxMinWidthFill: 0.94,
        referenceBoxMinCardHeightFill: isWide ? 0 : TARGET_H,
        verticalAlign: "bottom"
      }
    );
  }

  return strategies;
}

function isValidPlacement(drawX: number, drawY: number, fit: FitResult): boolean {
  if (drawX < PODRUZHKA_TEXT_COLUMN_RIGHT - 0.5) return false;
  if (drawY < PODRUZHKA_PRODUCT_VISUAL.y - 2) return false;
  if (drawY + fit.height > F.frame.h + 1) return false;
  if (fit.width > PODRUZHKA_PRODUCT_VISUAL.w + 2) return false;
  return true;
}

function scorePlacement(
  fit: FitResult,
  drawX: number,
  drawY: number,
  cardW: number,
  cardH: number,
  zoneW: number,
  zoneH: number,
  aspect: number
): number {
  const isWide = aspect >= WIDE_ASPECT;
  const hTarget = isWide ? 0.42 : TARGET_H;
  const hRatio = fit.height / cardH;
  const wRatio = fit.width / cardW;
  const zoneFillH = fit.height / zoneH;
  const zoneFillW = fit.width / zoneW;

  let score = 100;

  if (drawX < PODRUZHKA_TEXT_COLUMN_RIGHT) score -= 500;

  score -= Math.abs(hRatio - hTarget) * (isWide ? 180 : 300);
  if (hRatio < (isWide ? 0.28 : R.product.heightRatioMin)) {
    score -= 200;
  }

  score -= Math.abs(wRatio - TARGET_W) * 130;
  if (wRatio < R.product.widthRatioMin) {
    score -= (R.product.widthRatioMin - wRatio) * 220;
  }

  if (isWide) {
    if (zoneFillW < 0.88) score -= (0.88 - zoneFillW) * 250;
    if (zoneFillH < 0.38) score -= (0.38 - zoneFillH) * 320;
    score += Math.min(zoneFillW, 0.98) * 55;
  } else {
    if (zoneFillH < 0.7) score -= (0.7 - zoneFillH) * 200;
    score += Math.min(zoneFillH, 0.98) * 45;
  }

  const emptyRight = PODRUZHKA_PRODUCT_VISUAL.x + zoneW - (drawX + fit.width);
  score -= Math.max(0, emptyRight - 18) * 1.5;

  const slackTop = drawY - PODRUZHKA_PRODUCT_VISUAL.y;
  if (slackTop > zoneH * 0.38) score -= (slackTop - zoneH * 0.38) * 0.45;

  const inset = fit.bottomAlphaInset ?? 0;
  const visualBottom = drawY + fit.height - inset;
  const gapFromBottom = PODRUZHKA_PRODUCT_VISUAL.bottom - visualBottom;
  const targetGap = isWide ? 14 : aspect <= 0.78 ? 32 : 20;
  score -= Math.abs(gapFromBottom - targetGap) * 2.8;
  if (gapFromBottom < 10) score -= 90;
  if (gapFromBottom > 52) score -= (gapFromBottom - 52) * 2.5;

  score += Math.min((fit.width * fit.height) / 400000, 40);

  return score;
}

async function tryStrategy(
  prepared: PreparedProductImage,
  strategy: FitStrategy,
  zoneW: number,
  zoneH: number,
  cardW: number,
  cardH: number
): Promise<AdaptiveProductResult | null> {
  const fit = await fitProductPng(prepared.buffer, zoneW, zoneH, {
    cardW,
    cardH,
    referenceBoxOnly: true,
    preparedInput: prepared.buffer,
    fitMode: "contain",
    scaleMultiplier: strategy.scaleMultiplier,
    referenceBoxMinHeightFill: strategy.referenceBoxMinHeightFill,
    referenceBoxMinWidthFill: strategy.referenceBoxMinWidthFill,
    referenceBoxMinCardHeightFill: strategy.referenceBoxMinCardHeightFill
  });

  const rawX = PODRUZHKA_PRODUCT_VISUAL.x + zoneW - fit.width;
  const baseLift = computeAdaptiveBottomLift(fit, prepared);
  const zoneFillH = fit.height / zoneH;
  const alignments: VerticalAlign[] =
    prepared.aspect >= WIDE_ASPECT && zoneFillH < 0.48
      ? ["bottom", "lower-third"]
      : [strategy.verticalAlign];
  let bestLocal: AdaptiveProductResult | null = null;

  for (const align of alignments) {
    for (const lift of liftCandidates(baseLift)) {
      const rawY = computeProductDrawY(fit, align, lift);
      const { drawX, drawY } = clampProductDrawPlacement(fit, rawX, rawY, lift);
      if (!isValidPlacement(drawX, drawY, fit)) continue;

      const visualScore = scorePlacement(
        fit,
        drawX,
        drawY,
        cardW,
        cardH,
        zoneW,
        zoneH,
        prepared.aspect
      );

      const candidate: AdaptiveProductResult = {
        fit,
        drawX,
        drawY,
        strategyId: `${strategy.id}+${align}+lift${lift}`,
        visualScore
      };
      if (!bestLocal || visualScore > bestLocal.visualScore) {
        bestLocal = candidate;
      }
    }
  }

  return bestLocal;
}

/** Косметика: фиксированная целевая площадь товара (как на макете с рамкой). */
async function resolveCosmeticsUniformPlacement(
  prepared: PreparedProductImage,
  zoneW: number,
  zoneH: number,
  cardW: number,
  cardH: number
): Promise<AdaptiveProductResult> {
  const isNarrow = prepared.aspect < 0.55;
  const fotoMode = PODRUZHKA_COSMETICS_FOTO_MODE;
  const useCutoutPlacement = fotoMode === "edge" || fotoMode === "ai";
  const cosmeticsTopMargin = useCutoutPlacement ? 12 : 0;
  const fitMaxH =
    useCutoutPlacement ? Math.max(1, zoneH - cosmeticsTopMargin - 8) : zoneH;

  const fit = await fitProductPng(prepared.buffer, zoneW, fitMaxH, {
    cardW,
    cardH,
    referenceBoxOnly: true,
    preparedInput: prepared.buffer,
    fitMode: "contain",
    scaleMultiplier:
      isNarrow && fotoMode !== "raw"
        ? PODRUZHKA_COSMETICS_PRODUCT_SCALE * 1.14
        : PODRUZHKA_COSMETICS_PRODUCT_SCALE,
    referenceBoxMinHeightFill: isNarrow
      ? 0.9
      : PODRUZHKA_COSMETICS_TARGET_ZONE_HEIGHT_FILL,
    referenceBoxMinWidthFill: isNarrow ? PODRUZHKA_COSMETICS_TARGET_ZONE_WIDTH_FILL : 0,
    referenceBoxMinCardHeightFill: 0.52,
    renderProfile: "cosmetics"
  });

  let width = fit.width;
  let height = fit.height;

  const targetH = Math.round(zoneH * PODRUZHKA_COSMETICS_TARGET_ZONE_HEIGHT_FILL);
  const targetW = Math.round(zoneW * PODRUZHKA_COSMETICS_TARGET_ZONE_WIDTH_FILL);
  const scaleUp = Math.min(
    targetH / height,
    targetW / width,
    Math.max(1, zoneH - cosmeticsTopMargin) / height,
    zoneW / width
  );
  if (scaleUp > 1.01) {
    width = Math.max(1, Math.round(width * scaleUp));
    height = Math.max(1, Math.round(height * scaleUp));
  }

  const cappedFit: FitResult = { ...fit, width, height };
  const rawX = PODRUZHKA_PRODUCT_VISUAL.x + zoneW - width;
  const zoneTop = PODRUZHKA_PRODUCT_VISUAL.y;
  const zoneBottom = PODRUZHKA_PRODUCT_VISUAL.bottom;
  const idealY =
    zoneTop +
    cosmeticsTopMargin +
    (zoneH - cosmeticsTopMargin) * PODRUZHKA_COSMETICS_VERTICAL_CENTER_BIAS -
    height / 2;
  const rawY = Math.max(
    zoneTop + cosmeticsTopMargin,
    Math.min(zoneBottom - height, Math.round(idealY))
  );
  const { drawX, drawY } = clampProductDrawPlacement(cappedFit, rawX, rawY, 0);

  if (!isValidPlacement(drawX, drawY, cappedFit)) {
    throw new Error("Не удалось разместить foto (косметика)");
  }

  return {
    fit: cappedFit,
    drawX,
    drawY,
    strategyId:
      fotoMode === "raw"
        ? `cosmetics-raw-v1${isNarrow ? "-narrow" : ""}`
        : fotoMode === "ai"
          ? `cosmetics-ai-v1${isNarrow ? "-narrow" : ""}`
          : fotoMode === "edge"
            ? `cosmetics-edge-v3${isNarrow ? "-narrow" : ""}`
            : `cosmetics-uniform-v3${isNarrow ? "-narrow" : ""}`,
    visualScore: 100
  };
}

/** Подбирает масштаб и позицию foto под конкретный исходник. */
export async function resolveAdaptiveProductPlacement(
  input: Buffer,
  profile: PodruzhkaRenderProfile = "perfume",
  sourceUrl?: string
): Promise<AdaptiveProductResult> {
  const prepared = await prepareProductImage(input, profile, { sourceUrl });
  const zoneW = PODRUZHKA_PRODUCT_VISUAL.w;
  const zoneH = productVisualHeight();
  const cardW = R.size.w;
  const cardH = R.size.h;

  if (profile === "cosmetics") {
    return resolveCosmeticsUniformPlacement(prepared, zoneW, zoneH, cardW, cardH);
  }

  const strategies = buildStrategies(prepared);
  let best: AdaptiveProductResult | null = null;

  for (const strategy of strategies) {
    const candidate = await tryStrategy(
      prepared,
      strategy,
      zoneW,
      zoneH,
      cardW,
      cardH
    );
    if (candidate && (!best || candidate.visualScore > best.visualScore)) {
      best = candidate;
    }
  }

  if (!best) {
    throw new Error("Не удалось подобрать масштаб foto");
  }

  const base = strategies[0]!;
  for (const mul of [1.03, 1.06, 1.08]) {
    const tuned = await tryStrategy(
      prepared,
      { ...base, id: `fine-${mul}`, scaleMultiplier: mul },
      zoneW,
      zoneH,
      cardW,
      cardH
    );
    if (tuned && tuned.visualScore > best.visualScore) {
      best = tuned;
    }
  }

  return best;
}
