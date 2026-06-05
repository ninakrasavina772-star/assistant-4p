/**
 * Визуальный подбор масштаба foto — как ручная подгонка в Figma.
 * Жёстко: зона, порядок блоков, шрифты. Подгоняется: scale, crop, вертикаль.
 */
import {
  fitProductPng,
  prepareProductImage,
  type FitResult,
  type PreparedProductImage
} from "@/lib/podruzhkaImageProcess";
import { PODRUZHKA_REFERENCE as R } from "@/lib/podruzhkaReferenceSpec";
import {
  PODRUZHKA_PRODUCT_VISUAL,
  productVisualHeight
} from "@/lib/podruzhkaProductPlacement";

type VerticalAlign = "bottom" | "lower-third";

type FitStrategy = {
  id: string;
  fitMode: "contain" | "cover-height";
  referenceBoxScale: number;
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

function buildStrategies(prepared: PreparedProductImage): FitStrategy[] {
  const { aspect, maxDim } = prepared;
  const strategies: FitStrategy[] = [
    {
      id: "balanced",
      fitMode: "contain",
      referenceBoxScale: 1,
      scaleMultiplier: 1,
      referenceBoxMinHeightFill: 0.94,
      referenceBoxMinWidthFill: 0.88,
      referenceBoxMinCardHeightFill: TARGET_H,
      verticalAlign: "bottom"
    },
    {
      id: "height-priority",
      fitMode: "contain",
      referenceBoxScale: 1,
      scaleMultiplier: 1.04,
      referenceBoxMinHeightFill: 0.97,
      referenceBoxMinWidthFill: 0.82,
      referenceBoxMinCardHeightFill: TARGET_H,
      verticalAlign: "bottom"
    },
    {
      id: "width-priority",
      fitMode: "contain",
      referenceBoxScale: 1,
      scaleMultiplier: 1,
      referenceBoxMinHeightFill: 0.88,
      referenceBoxMinWidthFill: 0.94,
      referenceBoxMinCardHeightFill: 0.5,
      verticalAlign: "lower-third"
    }
  ];

  if (aspect >= 1.12) {
    strategies.push(
      {
        id: "wide-cover-height",
        fitMode: "cover-height",
        referenceBoxScale: 1,
        scaleMultiplier: 1,
        referenceBoxMinHeightFill: 0.9,
        referenceBoxMinWidthFill: 0.92,
        referenceBoxMinCardHeightFill: TARGET_H,
        verticalAlign: "bottom"
      },
      {
        id: "wide-contain-lifted",
        fitMode: "contain",
        referenceBoxScale: 1.06,
        scaleMultiplier: 1,
        referenceBoxMinHeightFill: 0.86,
        referenceBoxMinWidthFill: 0.96,
        referenceBoxMinCardHeightFill: 0.48,
        verticalAlign: "lower-third"
      }
    );
  }

  if (aspect <= 0.75) {
    strategies.push({
      id: "tall-bottle",
      fitMode: "contain",
      referenceBoxScale: 1.02,
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
        fitMode: "contain",
        referenceBoxScale: 1,
        scaleMultiplier: 1.14,
        referenceBoxMinHeightFill: 0.94,
        referenceBoxMinWidthFill: 0.9,
        referenceBoxMinCardHeightFill: TARGET_H,
        verticalAlign: "bottom"
      },
      {
        id: "small-source-upscale-strong",
        fitMode: "contain",
        referenceBoxScale: 1,
        scaleMultiplier: 1.24,
        referenceBoxMinHeightFill: 0.96,
        referenceBoxMinWidthFill: 0.92,
        referenceBoxMinCardHeightFill: TARGET_H,
        verticalAlign: "bottom"
      }
    );
  }

  if (maxDim > 1400) {
    strategies.push({
      id: "large-source",
      fitMode: "contain",
      referenceBoxScale: 1,
      scaleMultiplier: 1.02,
      referenceBoxMinHeightFill: 0.92,
      referenceBoxMinWidthFill: 0.9,
      referenceBoxMinCardHeightFill: TARGET_H,
      verticalAlign: "bottom"
    });
  }

  return strategies;
}

function scorePlacement(
  fit: FitResult,
  drawX: number,
  drawY: number,
  cardW: number,
  cardH: number,
  zoneW: number,
  zoneH: number,
  verticalAlign: VerticalAlign
): number {
  const hRatio = fit.height / cardH;
  const wRatio = fit.width / cardW;
  const zoneFill = fit.height / zoneH;

  let score = 100;
  score -= Math.abs(hRatio - TARGET_H) * 300;
  if (hRatio < R.product.heightRatioMin) {
    score -= (R.product.heightRatioMin - hRatio) * 450;
  }
  if (hRatio < 0.36) score -= 150;

  score -= Math.abs(wRatio - TARGET_W) * 130;
  if (wRatio < R.product.widthRatioMin) {
    score -= (R.product.widthRatioMin - wRatio) * 220;
  }

  if (zoneFill < 0.7) score -= (0.7 - zoneFill) * 200;
  score += Math.min(zoneFill, 0.98) * 45;

  const emptyRight = PODRUZHKA_PRODUCT_VISUAL.x + zoneW - (drawX + fit.width);
  score -= Math.max(0, emptyRight - 22) * 1.4;

  const slackTop = drawY - PODRUZHKA_PRODUCT_VISUAL.y;
  if (verticalAlign === "bottom" && slackTop > zoneH * 0.32) {
    score -= (slackTop - zoneH * 0.32) * 0.5;
  }

  score += Math.min((fit.width * fit.height) / 400000, 40);

  return score;
}

function computeDrawY(fit: FitResult, verticalAlign: VerticalAlign): number {
  const z = PODRUZHKA_PRODUCT_VISUAL;
  const zoneH = productVisualHeight();
  const inset = fit.bottomAlphaInset ?? 0;

  if (verticalAlign === "lower-third") {
    const slack = zoneH - fit.height + inset;
    if (slack <= 0) return Math.max(z.y, z.bottom - fit.height + inset);
    return z.y + slack * 0.22;
  }

  return Math.max(z.y, z.bottom - fit.height + inset);
}

async function tryStrategy(
  prepared: PreparedProductImage,
  strategy: FitStrategy,
  zoneW: number,
  zoneH: number,
  cardW: number,
  cardH: number
): Promise<AdaptiveProductResult> {
  const fit = await fitProductPng(prepared.buffer, zoneW, zoneH, {
    cardW,
    cardH,
    referenceBoxOnly: true,
    preparedInput: prepared.buffer,
    fitMode: strategy.fitMode,
    referenceBoxScale: strategy.referenceBoxScale,
    scaleMultiplier: strategy.scaleMultiplier,
    referenceBoxMinHeightFill: strategy.referenceBoxMinHeightFill,
    referenceBoxMinWidthFill: strategy.referenceBoxMinWidthFill,
    referenceBoxMinCardHeightFill: strategy.referenceBoxMinCardHeightFill
  });

  const drawX = PODRUZHKA_PRODUCT_VISUAL.x + zoneW - fit.width;
  const drawY = computeDrawY(fit, strategy.verticalAlign);
  const visualScore = scorePlacement(
    fit,
    drawX,
    drawY,
    cardW,
    cardH,
    zoneW,
    zoneH,
    strategy.verticalAlign
  );

  return { fit, drawX, drawY, strategyId: strategy.id, visualScore };
}

/** Подбирает масштаб и позицию foto под конкретный исходник. */
export async function resolveAdaptiveProductPlacement(
  input: Buffer
): Promise<AdaptiveProductResult> {
  const prepared = await prepareProductImage(input);
  const zoneW = PODRUZHKA_PRODUCT_VISUAL.w;
  const zoneH = productVisualHeight();
  const cardW = R.size.w;
  const cardH = R.size.h;

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
    if (!best || candidate.visualScore > best.visualScore) {
      best = candidate;
    }
  }

  if (!best) {
    throw new Error("Не удалось подобрать масштаб foto");
  }

  const baseStrategy = strategies.find((s) => s.id === "balanced")!;
  for (const mul of [1.05, 1.1, 1.15]) {
    const tuned = await tryStrategy(
      prepared,
      { ...baseStrategy, id: `fine-${mul}`, scaleMultiplier: mul },
      zoneW,
      zoneH,
      cardW,
      cardH
    );
    if (tuned.visualScore > best.visualScore) {
      best = tuned;
    }
  }

  return best;
}
