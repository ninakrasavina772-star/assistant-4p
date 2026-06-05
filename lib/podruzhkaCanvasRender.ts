import { createCanvas, loadImage, GlobalFonts } from "@napi-rs/canvas";
import fs from "fs";
import path from "path";
import sharp from "sharp";
import type { PodruzhkaInfographicData } from "@/lib/podruzhkaTypes";
import { fetchPodruzhkaProductImageDetailed } from "@/lib/podruzhkaImageFetch";
import {
  autoCorrectProductLayout,
  formatValidationFailure,
  type ResolvedProductPlacement,
  type TextLayoutEstimate
} from "@/lib/podruzhkaLayoutValidation";
import type { VisionLayoutAdjustment } from "@/lib/podruzhkaVisionAdjust";
import { getFullTemplateBuffer } from "@/lib/podruzhkaTemplateAssets";
import { buildPodruzhkaLayout, type PodruzhkaRuntimeLayout } from "@/lib/podruzhkaLayout";
import { PODRUZHKA_SIZE } from "@/lib/podruzhkaLayout";
import { PODRUZHKA_SPEC as S } from "@/lib/podruzhkaSpec";
import { LAYOUT_RULES } from "@/lib/podruzhkaLayoutRules";
import {
  figmaTextBaseline,
  PODRUZHKA_FIGMA as FIGMA
} from "@/lib/podruzhkaFigmaLayout";
import {
  getReferenceFixedTextLayout,
  REFERENCE_TEXT_ANCHORS
} from "@/lib/podruzhkaReferenceAnchors";
import { computeTextFlowLayout, type TextFlowLayout } from "@/lib/podruzhkaTextFlow";

const { w: W, h: H } = PODRUZHKA_SIZE;
const C = S.colors;

let fontsReady = false;

function ensureFonts(): void {
  if (fontsReady) return;
  const dir = path.join(process.cwd(), "public", "podruzhka", "fonts");
  const pairs: [string, string][] = [
    ["libre-franklin-latin-800-normal.woff2", "Libre Franklin"],
    ["inter-latin-400-normal.woff2", "Inter"],
    ["inter-latin-500-normal.woff2", "Inter"],
    ["inter-latin-500-italic.woff2", "Inter"],
    ["inter-latin-700-normal.woff2", "Inter"],
    ["inter-latin-800-normal.woff2", "Inter"]
  ];
  for (const [file, family] of pairs) {
    const p = path.join(dir, file);
    if (fs.existsSync(p)) GlobalFonts.registerFromPath(p, family);
  }
  fontsReady = true;
}

function formatMl(ml: string): string {
  const t = ml.trim();
  if (!t) return "";
  if (/мл|ml/i.test(t)) return t.replace(/\s*ml\b/i, " мл");
  const n = t.replace(/[^\d.,]/g, "");
  return n ? `${n} мл` : t;
}

function brandFont(size: number): string {
  return `800 ${size}px "Libre Franklin", Inter, sans-serif`;
}

function interFont(size: number, weight: number, italic = false): string {
  return `${italic ? "italic " : ""}${weight} ${size}px Inter, sans-serif`;
}

function wrapLines(
  ctx: ReturnType<ReturnType<typeof createCanvas>["getContext"]>,
  text: string,
  maxWidth: number,
  font: string,
  maxLines: number
): string[] {
  ctx.font = font;
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines: string[] = [];
  let line = words[0]!;
  for (let i = 1; i < words.length; i++) {
    const w = words[i]!;
    const test = `${line} ${w}`;
    if (ctx.measureText(test).width > maxWidth) {
      lines.push(line);
      line = w;
      if (lines.length >= maxLines) return lines;
    } else line = test;
  }
  lines.push(line);
  return lines.slice(0, maxLines);
}

function resolveBrandFontSize(
  ctx: ReturnType<ReturnType<typeof createCanvas>["getContext"]>,
  brandName: string,
  L: PodruzhkaRuntimeLayout,
  fontDelta = 0
): { size: number; lines: string[] } {
  const maxW = L.brand.w;
  const maxLines = S.fonts.brand.maxLines;

  if (LAYOUT_RULES.replaceOnly) {
    const text = brandName.toUpperCase();
    const cap = Math.max(S.fonts.brand.min, S.fonts.brand.max + fontDelta);
    for (let size = cap; size >= S.fonts.brand.min; size -= 2) {
      const font = brandFont(size);
      const lines = wrapLines(ctx, text, maxW, font, maxLines);
      if (maxLineWidth(ctx, lines, font) <= maxW) {
        return { size, lines };
      }
    }
    const size = S.fonts.brand.min;
    return {
      size,
      lines: wrapLines(ctx, text, maxW, brandFont(size), maxLines)
    };
  }

  const maxH = L.brand.h;
  const maxSize = Math.max(S.fonts.brand.min, S.fonts.brand.max + fontDelta);
  const minSize = S.fonts.brand.min;

  for (let size = maxSize; size >= minSize; size -= 2) {
    const font = brandFont(size);
    const lines = wrapLines(ctx, brandName.toUpperCase(), maxW, font, maxLines);
    const lineH = Math.round(size * 1.05);
    const totalH = lines.length * lineH;
    const widest = Math.max(0, ...lines.map((ln) => ctx.measureText(ln).width));
    if (widest <= maxW && totalH <= maxH) {
      return { size, lines };
    }
  }

  const size = minSize;
  return {
    size,
    lines: wrapLines(ctx, brandName.toUpperCase(), maxW, brandFont(size), maxLines)
  };
}

function resolveModelFontSize(
  ctx: ReturnType<ReturnType<typeof createCanvas>["getContext"]>,
  model: string,
  L: PodruzhkaRuntimeLayout,
  brandSize: number
): { size: number; lines: string[] } {
  const maxW = L.model.w;
  const maxLines = S.fonts.model.maxLines;

  if (LAYOUT_RULES.replaceOnly) {
    for (let size = S.fonts.model.max; size >= S.fonts.model.min; size -= 2) {
      const font = interFont(size, 800);
      const lines = wrapLines(ctx, model, maxW, font, maxLines);
      if (maxLineWidth(ctx, lines, font) <= maxW) {
        return { size, lines };
      }
    }
    const size = S.fonts.model.min;
    return {
      size,
      lines: wrapLines(
        ctx,
        model,
        maxW,
        interFont(size, 800),
        maxLines
      )
    };
  }

  const maxH = L.model.h;
  const ratio = S.fonts.model.ratioOfBrand ?? 0.68;
  const target = Math.round(brandSize * ratio);
  const cap = Math.min(S.fonts.model.max, Math.round(brandSize * 0.72));
  const minSize = Math.max(S.fonts.model.min, Math.round(brandSize * 0.62));

  for (let size = cap; size >= minSize; size -= 2) {
    const font = interFont(size, 800);
    const lines = wrapLines(ctx, model, maxW, font, S.fonts.model.maxLines);
    const totalH = lines.length * Math.round(size * 1.08);
    if (totalH <= maxH) return { size, lines };
  }

  const size = minSize;
  const lines = wrapLines(
    ctx,
    model,
    maxW,
    interFont(size, 800),
    S.fonts.model.maxLines
  );
  return { size, lines };
}

function buildTextLayoutEstimate(
  ctx: ReturnType<ReturnType<typeof createCanvas>["getContext"]>,
  data: PodruzhkaInfographicData,
  L: PodruzhkaRuntimeLayout,
  layoutAdj?: VisionLayoutAdjustment
): TextLayoutEstimate {
  const fontDelta = layoutAdj?.brandFontDelta ?? 0;
  const modelDelta = layoutAdj?.modelFontDelta ?? 0;
  const brand = resolveBrandFontSize(ctx, data.brandName, L, fontDelta);
  const model = resolveModelFontSize(ctx, data.model, L, brand.size);
  const modelSize = Math.min(S.fonts.model.max, model.size + modelDelta);
  const brandFontStr = brandFont(brand.size);
  const modelFontStr = interFont(modelSize, 800);
  const typeSize = S.fonts.productType.size;
  const typeFont = interFont(typeSize, 400);
  const typeText = data.productType.trim().toLowerCase();
  const typeLinesEst = typeText
    ? wrapLines(ctx, typeText, L.productType.w, typeFont, 2)
    : [];
  const flow = LAYOUT_RULES.replaceOnly
    ? getReferenceFixedTextLayout(
        brand.size,
        modelSize,
        model.lines.length,
        brand.lines.length,
        typeLinesEst.length
      )
    : computeTextFlowLayout({
        brandSize: brand.size,
        brandLineCount: brand.lines.length,
        productTypeSize: typeSize,
        modelSize,
        modelLineCount: model.lines.length,
        noteBlockHeight: L.notes.blockH,
        mlFontSize: S.fonts.ml.max,
        brandYOffset: layoutAdj?.brandYOffset,
        productTypeYOffset: layoutAdj?.productTypeYOffset,
        modelYOffset: layoutAdj?.modelYOffset
      });
  return {
    brandSize: brand.size,
    brandLines: brand.lines,
    brandMaxLineWidth: maxLineWidth(ctx, brand.lines, brandFontStr),
    modelSize,
    modelLines: model.lines,
    modelMaxLineWidth: maxLineWidth(ctx, model.lines, modelFontStr),
    noteBlockHeight: L.notes.blockH,
    mlAnchorY: flow.mlAccentY
  };
}

function drawFilledBar(
  ctx: ReturnType<ReturnType<typeof createCanvas>["getContext"]>,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string
): void {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

/** Пустой template-base.png без выжженного текста — зоны не затираем. */
function eraseTemplateTextGhost(
  _ctx: ReturnType<ReturnType<typeof createCanvas>["getContext"]>
): void {
  // Раньше стирали textColumnErase 300×1120 под старый шаблон с призраками текста.
}

async function drawTemplateBase(
  ctx: ReturnType<ReturnType<typeof createCanvas>["getContext"]>
): Promise<void> {
  const buf = await getFullTemplateBuffer();
  const base = await loadImage(buf);
  ctx.drawImage(base, 0, 0, W, H);
  eraseTemplateTextGhost(ctx);
}

function overlayDynamicText(
  ctx: ReturnType<ReturnType<typeof createCanvas>["getContext"]>,
  data: PodruzhkaInfographicData,
  L: PodruzhkaRuntimeLayout,
  layoutAdj?: VisionLayoutAdjustment
): TextFlowLayout {
  const fontDelta = layoutAdj?.brandFontDelta ?? 0;
  const { size: brandSize, lines: brandLines } = resolveBrandFontSize(
    ctx,
    data.brandName,
    L,
    fontDelta
  );

  const typeSize = S.fonts.productType.size;
  const typeFont = interFont(typeSize, 400);
  const typeText = data.productType.trim().toLowerCase();
  const typeLines = typeText
    ? wrapLines(ctx, typeText, L.productType.w, typeFont, 2)
    : [];

  const modelDelta = layoutAdj?.modelFontDelta ?? 0;
  const { size: modelSizeBase, lines: modelLines } = resolveModelFontSize(
    ctx,
    data.model,
    L,
    brandSize
  );
  const modelSize = Math.min(S.fonts.model.max, modelSizeBase + modelDelta);

  const mlSize = S.fonts.ml.max;
  const flow = LAYOUT_RULES.replaceOnly
    ? getReferenceFixedTextLayout(
        brandSize,
        modelSize,
        modelLines.length,
        brandLines.length,
        typeLines.length
      )
    : computeTextFlowLayout({
        brandSize,
        brandLineCount: brandLines.length,
        productTypeSize: typeSize,
        modelSize,
        modelLineCount: modelLines.length,
        noteBlockHeight: L.notes.blockH,
        mlFontSize: mlSize,
        brandYOffset: layoutAdj?.brandYOffset,
        productTypeYOffset: layoutAdj?.productTypeYOffset,
        modelYOffset: layoutAdj?.modelYOffset,
        accentYOffset: layoutAdj?.accentYOffset,
        notesStartYOffset: layoutAdj?.notesStartYOffset
      });

  ctx.fillStyle = C.text;
  ctx.font = brandFont(brandSize);
  let brandBaseline = flow.brandFirstBaseline;
  for (const line of brandLines) {
    ctx.fillText(line, L.brand.x, brandBaseline);
    brandBaseline += flow.brandLineStep;
  }

  ctx.fillStyle = C.muted;
  ctx.font = typeFont;
  if (typeLines.length) {
    let typeBaseline = flow.productTypeBaseline;
    for (const line of typeLines) {
      ctx.fillText(line, L.productType.x, typeBaseline);
      typeBaseline += Math.round(typeSize * 1.12);
    }
  }

  ctx.fillStyle = C.text;
  ctx.font = interFont(modelSize, 800);
  let modelBaseline = flow.modelFirstBaseline;
  for (const line of modelLines) {
    ctx.fillText(line, L.model.x, modelBaseline);
    modelBaseline += flow.modelLineStep;
  }

  const fNoteTitle = interFont(S.fonts.noteTitle.max, 700);
  const fNoteDesc = interFont(S.fonts.noteDesc.max, 400);
  const notes = data.notes.slice(0, 3);

  if (LAYOUT_RULES.replaceOnly) {
    const bar = FIGMA.notesPinkBar;
    drawFilledBar(ctx, bar.x, bar.y, bar.w, bar.h, C.accent);

    for (let i = 0; i < notes.length; i++) {
      const n = notes[i]!;
      const slot = FIGMA.notes[i]!;

      ctx.fillStyle = C.accent;
      ctx.font = fNoteTitle;
      ctx.fillText(
        n.title.toUpperCase(),
        FIGMA.textX,
        figmaTextBaseline(slot.titleY, FIGMA.fonts.noteTitle)
      );

      ctx.fillStyle = C.muted;
      ctx.font = fNoteDesc;
      ctx.fillText(
        n.desc,
        FIGMA.textX,
        figmaTextBaseline(slot.descY, FIGMA.fonts.noteDesc)
      );

      if (slot.sepY != null) {
        drawFilledBar(
          ctx,
          FIGMA.textX,
          slot.sepY,
          FIGMA.separator.w,
          FIGMA.separator.h,
          C.separator
        );
      }
    }
  } else {
    drawFilledBar(ctx, L.accent.x, flow.accentY, L.accent.w, L.accent.h, C.accent);
    drawFilledBar(ctx, L.notes.x, flow.notesStartY - 14, L.accent.w, L.accent.h, C.accent);

    for (let i = 0; i < notes.length; i++) {
      const n = notes[i]!;
      const blockY = flow.notesStartY + i * L.notes.blockH;

      ctx.fillStyle = C.accent;
      ctx.font = fNoteTitle;
      ctx.fillText(n.title.toUpperCase(), L.notes.x, blockY + S.noteTitleDy);

      ctx.fillStyle = C.muted;
      ctx.font = fNoteDesc;
      ctx.fillText(n.desc, L.notes.x, blockY + S.noteDescDy);

      if (i < 2) {
        const sepY = blockY + L.notes.blockH - 10;
        drawFilledBar(ctx, L.notes.x, sepY, L.separator.width, 1, C.separator);
      }
    }
  }

  return flow;
}

function maxLineWidth(
  ctx: ReturnType<ReturnType<typeof createCanvas>["getContext"]>,
  lines: string[],
  font: string
): number {
  ctx.font = font;
  return Math.max(0, ...lines.map((ln) => ctx.measureText(ln).width));
}

async function resolveProductPlacement(
  fotoUrl: string,
  text: TextLayoutEstimate,
  layoutAdj?: VisionLayoutAdjustment
): Promise<{
  loaded: boolean;
  error?: string;
  placement?: ResolvedProductPlacement;
}> {
  const url = fotoUrl?.trim();
  if (!url) return { loaded: false, error: "Колонка foto пуста" };

  const { buf: productBuf, error } = await fetchPodruzhkaProductImageDetailed(url);
  if (!productBuf?.length) return { loaded: false, error: error ?? "Не скачалось foto" };

  try {
    const placement = await autoCorrectProductLayout(productBuf, text, layoutAdj);
    return { loaded: true, placement };
  } catch (e) {
    return {
      loaded: false,
      error: e instanceof Error ? e.message : "Ошибка обработки foto"
    };
  }
}

async function drawProductPlacementAsync(
  ctx: ReturnType<ReturnType<typeof createCanvas>["getContext"]>,
  placement: ResolvedProductPlacement
): Promise<void> {
  const prodImg = await loadImage(placement.fit.buffer);
  const { drawX, drawY } = placement.metrics;
  const w = placement.fit.width;
  const h = placement.fit.height;

  ctx.drawImage(prodImg, drawX, drawY, w, h);
}

function overlayMl(
  ctx: ReturnType<ReturnType<typeof createCanvas>["getContext"]>,
  ml: string,
  flow: TextFlowLayout
): void {
  const x = S.mlAccent.x;
  drawFilledBar(ctx, x, flow.mlAccentY, S.mlAccent.w, S.mlAccent.h, C.accent);
  ctx.fillStyle = C.text;
  ctx.font = interFont(S.fonts.ml.max, 500, true);
  ctx.fillText(formatMl(ml), S.ml.x, flow.mlBaseline);
}

export type RenderInfographicResult = {
  buffer: Buffer;
  fotoLoaded: boolean;
  fotoError?: string;
  layoutValidationOk?: boolean;
  layoutValidationPasses?: number;
  layoutValidationError?: string;
  visionUsed?: boolean;
  visionPasses?: number;
  visionScore?: number;
  visionReasoning?: string;
  visionError?: string;
};

export type RenderInfographicOptions = {
  data: PodruzhkaInfographicData;
  layoutAdj?: VisionLayoutAdjustment;
};

export function isRenderOptions(v: unknown): v is RenderInfographicOptions {
  return Boolean(v && typeof v === "object" && "data" in v && (v as RenderInfographicOptions).data);
}

export async function renderInfographicPng(
  dataOrOpts: PodruzhkaInfographicData | RenderInfographicOptions
): Promise<Buffer> {
  const r = await renderInfographicDetailed(dataOrOpts);
  return r.buffer;
}

async function renderOnce(
  data: PodruzhkaInfographicData,
  layoutAdj?: VisionLayoutAdjustment
): Promise<RenderInfographicResult> {
  ensureFonts();
  let adj = layoutAdj;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  const L0 = buildPodruzhkaLayout(adj);
  let textEst = buildTextLayoutEstimate(ctx, data, L0, adj);

  const resolved = await resolveProductPlacement(data.fotoUrl, textEst, adj);

  if (!resolved.loaded) {
    return {
      buffer: Buffer.alloc(0),
      fotoLoaded: false,
      fotoError: resolved.error ?? "Фото товара обязательно",
      layoutValidationOk: false,
      layoutValidationError: resolved.error ?? "Нет фото товара"
    };
  }

  const placement = resolved.placement;
  if (!placement?.fit?.buffer?.length) {
    return {
      buffer: Buffer.alloc(0),
      fotoLoaded: true,
      layoutValidationOk: false,
      layoutValidationError: formatValidationFailure(placement?.failureMessages ?? [])
    };
  }

  adj = { ...adj, ...placement.adjustment };
  const Lfinal = buildPodruzhkaLayout(adj);
  textEst = buildTextLayoutEstimate(ctx, data, Lfinal, adj);

  const placementFinal = await resolveProductPlacement(data.fotoUrl, textEst, adj);
  const finalPlacement = placementFinal.placement;
  if (!finalPlacement?.fit?.buffer?.length) {
    const msg = formatValidationFailure(finalPlacement?.failureMessages ?? ["нет placement"]);
    return {
      buffer: Buffer.alloc(0),
      fotoLoaded: true,
      layoutValidationOk: false,
      layoutValidationPasses: finalPlacement?.validationPasses,
      layoutValidationError: msg
    };
  }

  const validationWarning = finalPlacement.validationOk
    ? undefined
    : formatValidationFailure(finalPlacement.failureMessages);

  await drawTemplateBase(ctx);
  const flow = overlayDynamicText(ctx, data, Lfinal, adj);
  await drawProductPlacementAsync(ctx, finalPlacement);
  overlayMl(ctx, data.ml, flow);

  const png = canvas.toBuffer("image/png");
  const buffer = await sharp(png).jpeg({ quality: 92 }).toBuffer();
  return {
    buffer,
    fotoLoaded: true,
    layoutValidationOk: finalPlacement.validationOk,
    layoutValidationPasses: finalPlacement.validationPasses,
    layoutValidationError: validationWarning
  };
}

export async function renderInfographicDetailed(
  dataOrOpts: PodruzhkaInfographicData | RenderInfographicOptions,
  openaiKey?: string
): Promise<RenderInfographicResult> {
  const opts: RenderInfographicOptions = isRenderOptions(dataOrOpts)
    ? dataOrOpts
    : { data: dataOrOpts };

  if (!opts.data.fotoUrl?.trim()) {
    return {
      buffer: Buffer.alloc(0),
      fotoLoaded: false,
      fotoError: "Колонка foto обязательна",
      layoutValidationOk: false,
      layoutValidationError: "Карточка без фото товара не сохраняется"
    };
  }

  let layoutAdj = opts.layoutAdj;
  let result = await renderOnce(opts.data, layoutAdj);

  if (!result.layoutValidationOk || !result.fotoLoaded || result.buffer.length === 0) {
    return result;
  }

  /** Vision отключён: ломал согласованность текст/товар после программной валидации */
  void openaiKey;
  return result;
}
