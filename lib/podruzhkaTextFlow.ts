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
};

/**
 * Вертикальный поток: шапка → зазор → бренд → тип → модель → акцент → ноты.
 * Baseline canvas: fillText(y) = базовая линия символов.
 */
export function computeTextFlowLayout(input: {
  brandSize: number;
  brandLineCount: number;
  productTypeSize: number;
  modelSize: number;
  modelLineCount: number;
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
  const notesStartY = Math.max(
    LR.blocks.notes.y,
    flowNotesStart + (input.notesStartYOffset ?? 0)
  );

  return {
    brandTopY,
    brandLineStep,
    brandFirstBaseline,
    brandLastBaseline,
    productTypeBaseline,
    modelLineStep,
    modelFirstBaseline,
    accentY,
    notesStartY
  };
}
