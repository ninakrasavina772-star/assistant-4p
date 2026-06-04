/**
 * Фиксированная геометрия с reference-target.png (Carolina Herrera).
 */
import { PODRUZHKA_REFERENCE as R } from "@/lib/podruzhkaReferenceSpec";
import type { TextFlowLayout } from "@/lib/podruzhkaTextFlow";

const B = R.blocks;
const SY = 1365 / 1400;
const sy = (y: number) => Math.round(y * SY);

/** Версия вёрстки — меняйте при деплое, чтобы видеть что прод обновился */
export const PODRUZHKA_LAYOUT_VERSION = "ref-v3-ch";

export const REFERENCE_TEXT_ANCHORS = {
  brandFirstBaseline: sy(378),
  brandLineStep: sy(80),
  productTypeBaseline: sy(448),
  productTypeShortExtraDy: sy(10),
  productTypeShortMaxLen: 14,
  modelFirstBaseline: sy(508),
  modelLineStep: sy(63),
  gapAfterModel: sy(40),
  noteBlockHeight: sy(90),
  mlBarGapAfterNotes: sy(18),
  /** ml и розовая черта — как на эталоне, внизу карточки */
  mlAccentY: B.volume.y - sy(8),
  productBoxScale: 1.42,
  productBoxMinHeightFill: 0.94,
  productBoxMinWidthFill: 0.92,
  /** Закраска левой колонки поверх «хвостов» из template-base (CH) */
  textColumnErase: { x: 52, y: sy(115), w: 300, h: sy(1120) }
} as const;

export const REFERENCE_PRODUCT_SHADOW = {
  centerX: Math.round(640 * (1024 / 1000)),
  groundY: R.product.bottomAlignY,
  rx: Math.round(252 * (1024 / 1000)),
  ry: Math.round(15 * (1365 / 1400))
} as const;

export function getReferenceFixedTextLayout(
  brandSize: number,
  modelSize: number,
  modelLineCount: number
): TextFlowLayout {
  const a = REFERENCE_TEXT_ANCHORS;
  const modelLastBaseline =
    a.modelFirstBaseline + Math.max(0, modelLineCount - 1) * a.modelLineStep;
  const modelBottom = modelLastBaseline + Math.round(modelSize * 0.12);

  const mlAccentY = a.mlAccentY;
  const notesEndY = mlAccentY - a.mlBarGapAfterNotes;
  const notesBlockH = 3 * a.noteBlockHeight;
  const regionTop = modelBottom + a.gapAfterModel;
  const regionBottom = notesEndY;
  const free = regionBottom - regionTop - notesBlockH;
  const notesStartY = regionTop + Math.max(0, Math.round(free / 2));

  const mlBaseline = mlAccentY + R.accentBar.h + Math.round(R.fonts.ml.max * 0.85);

  return {
    brandTopY: a.brandFirstBaseline - brandSize,
    brandLineStep: a.brandLineStep,
    brandFirstBaseline: a.brandFirstBaseline,
    brandLastBaseline: a.brandFirstBaseline,
    productTypeBaseline: a.productTypeBaseline,
    modelLineStep: a.modelLineStep,
    modelFirstBaseline: a.modelFirstBaseline,
    accentY: 0,
    notesStartY,
    notesEndY: notesStartY + notesBlockH,
    mlAccentY,
    mlBaseline,
    productGroundY: R.product.bottomAlignY
  };
}
