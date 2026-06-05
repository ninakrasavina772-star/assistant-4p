/**
 * Координаты с reference-target.png (Carolina Herrera 212 Sexy), 1024×1365.
 */
import { PODRUZHKA_REFERENCE as R } from "@/lib/podruzhkaReferenceSpec";
import type { TextFlowLayout } from "@/lib/podruzhkaTextFlow";

const B = R.blocks;
const SX = 1024 / 1000;
const SY = 1365 / 1400;
const s = (x: number) => Math.round(x * SX);
const sy = (y: number) => Math.round(y * SY);

export const PODRUZHKA_LAYOUT_VERSION = "ref-v8-figma-fit";

/** Позиции как на эталоне 1000×1400 (масштаб 1024×1365) */
export const REFERENCE_TEXT_ANCHORS = {
  brandFirstBaseline: sy(348),
  brandLineStep: sy(80),
  productTypeBaseline: sy(402),
  productTypeShortExtraDy: sy(12),
  productTypeShortMaxLen: 14,
  modelFirstBaseline: sy(458),
  modelLineStep: sy(63),
  /** Блок нот — середина-низ листа (reference y=668) */
  notesStartY: sy(668),
  noteBlockHeight: sy(92),
  /** Одна розовая черта только под нотами, перед ml */
  mlBarGapAfterNotes: sy(16),
  mlAccentY: B.volume.y - sy(8),
  /** Вписать foto в рамку Figma без перекрупнения */
  productBoxScale: 1,
  productBoxMinHeightFill: 0.72,
  productBoxMinWidthFill: 0.68,
  textColumnErase: { x: 52, y: sy(115), w: 300, h: sy(1120) },
  /** Стереть «хвост» розовой черты под model с template-base */
  modelAccentErase: { x: 52, y: sy(498), w: 56, h: sy(14) },
  /** Стереть тень товара с template-base и зону под foto */
  productShadowErase: { x: s(280), y: sy(980), w: s(720), h: sy(200) }
} as const;

export function eraseReferenceGhostMarks(
  ctx: { fillStyle: unknown; fillRect(x: number, y: number, w: number, h: number): void },
  bg: string
): void {
  ctx.fillStyle = bg;
  const z = REFERENCE_TEXT_ANCHORS.textColumnErase;
  ctx.fillRect(z.x, z.y, z.w, z.h);
  const m = REFERENCE_TEXT_ANCHORS.modelAccentErase;
  ctx.fillRect(m.x, m.y, m.w, m.h);
  const sh = REFERENCE_TEXT_ANCHORS.productShadowErase;
  ctx.fillRect(sh.x, sh.y, sh.w, sh.h);
}

export function getReferenceFixedTextLayout(
  brandSize: number,
  _modelSize: number,
  _modelLineCount: number,
  brandLineCount: number,
  _productTypeLineCount: number
): TextFlowLayout {
  const a = REFERENCE_TEXT_ANCHORS;
  const brandLastBaseline =
    a.brandFirstBaseline + Math.max(0, brandLineCount - 1) * a.brandLineStep;

  const notesStartY = a.notesStartY;
  const notesBlockH = 3 * a.noteBlockHeight;
  const notesEndY = notesStartY + notesBlockH;
  const mlAccentY = a.mlAccentY;
  const mlBaseline = mlAccentY + R.accentBar.h + Math.round(R.fonts.ml.max * 0.85);

  return {
    brandTopY: a.brandFirstBaseline - brandSize,
    brandLineStep: a.brandLineStep,
    brandFirstBaseline: a.brandFirstBaseline,
    brandLastBaseline,
    productTypeBaseline: a.productTypeBaseline,
    modelLineStep: a.modelLineStep,
    modelFirstBaseline: a.modelFirstBaseline,
    accentY: 0,
    notesStartY,
    notesEndY,
    mlAccentY,
    mlBaseline,
    productGroundY: R.product.bottomAlignY
  };
}
