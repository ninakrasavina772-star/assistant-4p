/**
 * ТЗ 3:4 — 1024×1365 px (Ozon). Эталон: reference-target.png (Carolina Herrera).
 *
 * replaceOnly: меняются только переменные (бренд, тип, аромат, ноты, ml, foto).
 * Шаблон template-base.png = референс без этих слоёв; цвета/декор/координаты — с эталона.
 */
export const PODRUZHKA_REPLACE_ONLY = true;
const SX = 1024 / 1000;
const SY = 1365 / 1400;
const s = (x: number) => Math.round(x * SX);
const sy = (y: number) => Math.round(y * SY);

export const PODRUZHKA_REFERENCE = {
  size: { w: 1024, h: 1365 },
  colors: {
    bg: "#F7F7F7",
    loop: "#EFEFEF",
    text: "#111111",
    muted: "#666666",
    accent: "#E6007E",
    separator: "#D9D9D9"
  },
  gaps: {
    headerToBrandTop: sy(118),
    afterBrand: sy(22),
    afterProductType: sy(10),
    afterModel: sy(10),
    afterAccentToNotes: sy(14),
    afterNotesToMl: sy(28)
  },
  blocks: {
    header: { x: s(250), y: sy(35), w: s(500), h: sy(85) },
    brand: { x: s(55), y: sy(272), w: s(480), h: sy(150) },
    productType: { x: s(55), y: 0, w: s(350), h: sy(40) },
    model: { x: s(55), y: 0, w: s(350), h: sy(80) },
    notes: { x: s(55), y: sy(668), w: s(250), h: sy(320) },
    volume: { x: s(55), y: sy(1195), w: s(180), h: sy(60) },
    product: { x: s(340), y: sy(285), w: s(600), h: sy(800) }
  },
  fonts: {
    brand: { max: sy(76), min: sy(52), weight: 800, maxLines: 2 },
    productType: { size: sy(22), weight: 400 },
    model: { max: sy(58), min: sy(44), weight: 800, maxLines: 2, ratioOfBrand: 0.68 },
    noteTitle: { max: sy(22), min: sy(18), weight: 700 },
    noteDesc: { max: sy(16), min: sy(14), weight: 400 },
    ml: { max: sy(32), min: sy(26), weight: 500, italic: true }
  },
  accentBar: { x: s(55), y: 0, w: s(50), h: sy(6) },
  noteTitleDy: sy(22),
  noteDescDy: sy(46),
  noteBlockHeight: sy(92),
  notesMinHeight: sy(280),
  noteSpacingMin: sy(48),
  noteSpacingMax: sy(60),
  separatorWidth: s(200),
  product: {
    bottomAlignY: sy(1163),
    heightRatioMin: 0.52,
    heightRatioMax: 0.6,
    heightRatioTarget: 0.58,
    widthRatioMin: 0.52,
    widthRatioTarget: 0.56,
    narrowAspectBoost: 1.3,
    alignRight: true
  },
  validation: {
    productHeightRatioMin: 0.5,
    productHeightRatioMax: 0.6,
    productWidthRatioMin: 0.52,
    productVsBrandAreaMultiplier: 2,
    productVsTextAreaMultiplier: 1.3,
    gapAboveVolumeMinPx: 18,
    gapAboveVolumeMaxPx: 48,
    referenceEmptyRightPx: sy(28),
    referenceEmptyCenterPx: sy(42),
    emptySpaceTolerance: 1.15,
    contentRect: { x: s(55), y: sy(272), w: s(875), h: sy(900) },
    /** В replaceOnly — одна посадка в рамку эталона, без автоподгонки композиции */
    maxCorrectionPasses: 1
  }
} as const;
