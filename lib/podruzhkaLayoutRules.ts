/**
 * Единый источник правил ТЗ (Carolina Herrera / Подружка 1024×1365, 3:4).
 * Все модули (render, validation, flow) должны импортировать отсюда.
 */
import {
  PODRUZHKA_REFERENCE as R,
  PODRUZHKA_REPLACE_ONLY
} from "@/lib/podruzhkaReferenceSpec";

export const LAYOUT_RULES = {
  replaceOnly: PODRUZHKA_REPLACE_ONLY,  canvas: R.size,
  colors: R.colors,
  gaps: R.gaps,
  blocks: R.blocks,
  fonts: R.fonts,
  product: R.product,
  validation: R.validation,
  productBottomY: R.product.bottomAlignY,
  headerBottomY: R.blocks.header.y + R.blocks.header.h,
  separatorWidth: R.separatorWidth,
  noteBlockHeight: R.noteBlockHeight,
  noteTitleDy: R.noteTitleDy,
  noteDescDy: R.noteDescDy,
  accentBar: R.accentBar
} as const;

export function assertLayoutRules(): void {
  if (LAYOUT_RULES.replaceOnly) return;
  const gap = LAYOUT_RULES.blocks.volume.y - LAYOUT_RULES.productBottomY;
  if (gap < 18 || gap > 48) {
    throw new Error(`productBottomY: зазор до объёма ${gap}px вне 18–48`);
  }
}

assertLayoutRules();
