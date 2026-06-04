/**
 * Единый источник правил ТЗ (Carolina Herrera / Подружка 1000×1400).
 * Все модули (render, validation, flow) должны импортировать отсюда.
 */
import { PODRUZHKA_REFERENCE as R } from "@/lib/podruzhkaReferenceSpec";

export const LAYOUT_RULES = {
  canvas: R.size,
  colors: R.colors,
  gaps: R.gaps,
  blocks: R.blocks,
  fonts: R.fonts,
  product: R.product,
  validation: R.validation,
  /** низ товара = верх блока объёма − зазор 20–50 px */
  productBottomY: R.blocks.volume.y - 32,
  headerBottomY: R.blocks.header.y + R.blocks.header.h,
  separatorWidth: R.separatorWidth,
  noteBlockHeight: R.noteBlockHeight,
  noteTitleDy: R.noteTitleDy,
  noteDescDy: R.noteDescDy,
  accentBar: R.accentBar
} as const;

export function assertLayoutRules(): void {
  const gap = LAYOUT_RULES.blocks.volume.y - LAYOUT_RULES.productBottomY;
  if (gap < 20 || gap > 50) {
    throw new Error(`productBottomY: зазор до объёма ${gap}px вне 20–50`);
  }
}

assertLayoutRules();
