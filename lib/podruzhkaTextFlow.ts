import { PODRUZHKA_REFERENCE as R } from "@/lib/podruzhkaReferenceSpec";

const HEADER_BOTTOM = R.blocks.header.y + R.blocks.header.h;
const G = R.gaps;

export type TextFlowLayout = {
  brandTopY: number;
  brandLineStep: number;
  productTypeBaseline: number;
  modelLineStep: number;
  modelFirstBaseline: number;
  accentY: number;
  notesStartY: number;
  brandBottomY: number;
  modelBottomY: number;
};

/** Вертикальный поток как на CH: широкий зазор шапка→бренд, плотно бренд→тип→модель */
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
  const brandTopY = HEADER_BOTTOM + G.headerToBrandTop + (input.brandYOffset ?? 0);
  const brandLineStep = Math.round(input.brandSize * 1.05);
  const brandBottomY = brandTopY + input.brandLineCount * brandLineStep;

  const productTypeBaseline =
    brandBottomY +
    G.afterBrand +
    input.productTypeSize +
    (input.productTypeYOffset ?? 0);

  const modelFirstBaseline =
    productTypeBaseline +
    G.afterProductType +
    input.modelSize +
    (input.modelYOffset ?? 0);
  const modelLineStep = Math.round(input.modelSize * 1.08);
  const modelBottomY = modelFirstBaseline + (input.modelLineCount - 1) * modelLineStep;

  const accentY = modelBottomY + G.afterModel + (input.accentYOffset ?? 0);
  const flowNotesStart = accentY + R.accentBar.h + G.afterAccentToNotes;
  const notesStartY = Math.max(
    R.blocks.notes.y,
    flowNotesStart + (input.notesStartYOffset ?? 0)
  );

  return {
    brandTopY,
    brandLineStep,
    productTypeBaseline,
    modelLineStep,
    modelFirstBaseline,
    accentY,
    notesStartY,
    brandBottomY,
    modelBottomY
  };
}
