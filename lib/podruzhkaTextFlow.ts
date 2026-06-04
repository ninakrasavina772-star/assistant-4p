import { LAYOUT_RULES as LR } from "@/lib/podruzhkaLayoutRules";

const G = LR.gaps;

export type TextFlowLayout = {
  brandTopY: number;
  brandLineStep: number;
  brandFirstBaseline: number;
  brandLastBaseline: number;
  productTypeBaseline: number;
  modelLineStep: number;
  modelFirstBaseline: number;
  accentY: number;
  notesStartY: number;
  notesEndY: number;
  mlAccentY: number;
  mlBaseline: number;
  productGroundY: number;
};

export function computeTextFlowLayout(input: {
  brandSize: number;
  brandLineCount: number;
  productTypeSize: number;
  modelSize: number;
  modelLineCount: number;
  noteBlockHeight: number;
  mlFontSize: number;
  brandYOffset?: number;
  productTypeYOffset?: number;
  modelYOffset?: number;
  accentYOffset?: number;
  notesStartYOffset?: number;
}): TextFlowLayout {
  const brandTopY = LR.headerBottomY + G.headerToBrandTop + (input.brandYOffset ?? 0);
  const brandLineStep = Math.round(input.brandSize * 1.05);
  const brandFirstBaseline = brandTopY + input.brandSize;
  const brandLastBaseline =
    brandFirstBaseline + Math.max(0, input.brandLineCount - 1) * brandLineStep;

  const productTypeBaseline =
    brandLastBaseline + G.afterBrand + (input.productTypeYOffset ?? 0);

  const modelFirstBaseline =
    productTypeBaseline +
    G.afterProductType +
    input.modelSize +
    (input.modelYOffset ?? 0);
  const modelLineStep = Math.round(input.modelSize * 1.08);
  const modelLastBaseline =
    modelFirstBaseline + Math.max(0, input.modelLineCount - 1) * modelLineStep;

  const accentY = modelLastBaseline + G.afterModel + (input.accentYOffset ?? 0);
  const flowNotesStart = accentY + LR.accentBar.h + G.afterAccentToNotes;
  const notesStartY = flowNotesStart + (input.notesStartYOffset ?? 0);
  const notesEndY = notesStartY + 3 * input.noteBlockHeight;

  const mlAccentY = notesEndY + G.afterNotesToMl;
  const mlBaseline = mlAccentY + LR.accentBar.h + Math.round(input.mlFontSize * 0.85);
  const productGroundY = LR.product.bottomAlignY;

  return {
    brandTopY,
    brandLineStep,
    brandFirstBaseline,
    brandLastBaseline,
    productTypeBaseline,
    modelLineStep,
    modelFirstBaseline,
    accentY,
    notesStartY,
    notesEndY,
    mlAccentY,
    mlBaseline,
    productGroundY
  };
}
