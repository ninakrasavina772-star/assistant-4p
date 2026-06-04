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
import { computeTextFlowLayout } from "@/lib/podruzhkaTextFlow";

const { w: W, h: H } = PODRUZHKA_SIZE;
const C = S.colors;

let fontsReady = false;

function ensureFonts(): void {
  if (fontsReady) return;
  const dir = path.join(process.cwd(), "public", "fonts");
  const pairs: [string, string][] = [
    ["Montserrat-Regular.ttf", "Montserrat"],
    ["Montserrat-Bold.ttf", "MontserratBold"],
    ["Montserrat-ExtraBold.ttf", "MontserratExtraBold"],
    ["Montserrat-MediumItalic.ttf", "MontserratMediumItalic"],
    ["NotoSans-Regular.ttf", "NotoSans"],
    ["NotoSans-Bold.ttf", "NotoSansBold"]
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
  return `800 ${size}px MontserratExtraBold, MontserratBold, sans-serif`;
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
  const maxH = L.brand.h;
  const maxLines = S.fonts.brand.maxLines;
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
  const maxH = L.model.h;
  const ratio = S.fonts.model.ratioOfBrand ?? 0.75;
  const target = Math.round(brandSize * ratio);
  const cap = Math.min(S.fonts.model.max, Math.round(brandSize * 0.85));
  const minSize = Math.max(S.fonts.model.min, target);

  for (let size = cap; size >= minSize; size -= 2) {
    const font = `800 ${size}px MontserratExtraBold, MontserratBold, sans-serif`;
    const lines = wrapLines(ctx, model, maxW, font, S.fonts.model.maxLines);
    const totalH = lines.length * Math.round(size * 1.08);
    if (totalH <= maxH) return { size, lines };
  }

  const size = minSize;
  const lines = wrapLines(
    ctx,
    model,
    maxW,
    `800 ${size}px MontserratExtraBold, MontserratBold, sans-serif`,
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
  const modelFontStr = `800 ${modelSize}px MontserratExtraBold, MontserratBold, sans-serif`;
  const typeSize = S.fonts.productType.size;
  const flow = computeTextFlowLayout({
    brandSize: brand.size,
    brandLineCount: brand.lines.length,
    productTypeSize: typeSize,
    modelSize,
    modelLineCount: model.lines.length,
    brandYOffset: layoutAdj?.brandYOffset,
    productTypeYOffset: layoutAdj?.productTypeYOffset,
    modelYOffset: layoutAdj?.modelYOffset
  });
  void flow;
  return {
    brandSize: brand.size,
    brandLines: brand.lines,
    brandMaxLineWidth: maxLineWidth(ctx, brand.lines, brandFontStr),
    modelSize,
    modelLines: model.lines,
    modelMaxLineWidth: maxLineWidth(ctx, model.lines, modelFontStr),
    noteBlockHeight: L.notes.blockH
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

async function drawTemplateBase(
  ctx: ReturnType<ReturnType<typeof createCanvas>["getContext"]>
): Promise<void> {
  const buf = await getFullTemplateBuffer();
  const base = await loadImage(buf);
  ctx.drawImage(base, 0, 0, W, H);
}

function overlayDynamicText(
  ctx: ReturnType<ReturnType<typeof createCanvas>["getContext"]>,
  data: PodruzhkaInfographicData,
  L: PodruzhkaRuntimeLayout,
  layoutAdj?: VisionLayoutAdjustment
): void {
  const fontDelta = layoutAdj?.brandFontDelta ?? 0;
  const { size: brandSize, lines: brandLines } = resolveBrandFontSize(
    ctx,
    data.brandName,
    L,
    fontDelta
  );

  const typeSize = S.fonts.productType.size;
  const modelDelta = layoutAdj?.modelFontDelta ?? 0;
  const { size: modelSizeBase, lines: modelLines } = resolveModelFontSize(
    ctx,
    data.model,
    L,
    brandSize
  );
  const modelSize = Math.min(S.fonts.model.max, modelSizeBase + modelDelta);

  const flow = computeTextFlowLayout({
    brandSize,
    brandLineCount: brandLines.length,
    productTypeSize: typeSize,
    modelSize,
    modelLineCount: modelLines.length,
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
  ctx.font = `400 ${typeSize}px Montserrat, NotoSans, sans-serif`;
  const typeLine = wrapLines(
    ctx,
    data.productType.trim().toLowerCase(),
    L.productType.w,
    ctx.font,
    1
  )[0];
  if (typeLine) {
    ctx.fillText(typeLine, L.productType.x, flow.productTypeBaseline);
  }

  ctx.fillStyle = C.text;
  ctx.font = `800 ${modelSize}px MontserratExtraBold, MontserratBold, sans-serif`;
  let modelBaseline = flow.modelFirstBaseline;
  for (const line of modelLines) {
    ctx.fillText(line, L.model.x, modelBaseline);
    modelBaseline += flow.modelLineStep;
  }

  drawFilledBar(ctx, L.accent.x, flow.accentY, L.accent.w, L.accent.h, C.accent);
  drawFilledBar(ctx, L.notes.x, flow.notesStartY - 14, L.accent.w, L.accent.h, C.accent);

  const fNoteTitle = `700 ${S.fonts.noteTitle.max}px MontserratBold, Montserrat, sans-serif`;
  const fNoteDesc = `400 ${S.fonts.noteDesc.max}px Montserrat, NotoSans, sans-serif`;
  const notes = data.notes.slice(0, 3);

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

function drawProductShadow(
  ctx: ReturnType<ReturnType<typeof createCanvas>["getContext"]>,
  centerX: number,
  baseY: number,
  width: number
): void {
  ctx.save();
  ctx.fillStyle = "rgba(0, 0, 0, 0.06)";
  ctx.beginPath();
  ctx.ellipse(centerX, baseY + 4, width * 0.36, 10, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
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
  const anchorY = drawY + placement.fit.height;
  drawProductShadow(ctx, drawX + placement.fit.width / 2, anchorY + 4, placement.fit.width);
  ctx.drawImage(prodImg, drawX, drawY, placement.fit.width, placement.fit.height);
}

function overlayMl(
  ctx: ReturnType<ReturnType<typeof createCanvas>["getContext"]>,
  ml: string,
  L: PodruzhkaRuntimeLayout
): void {
  drawFilledBar(ctx, L.mlAccent.x, L.mlAccent.y, L.mlAccent.w, L.mlAccent.h, C.accent);
  ctx.fillStyle = C.text;
  ctx.font = `500 italic ${S.fonts.ml.max}px MontserratMediumItalic, Montserrat, sans-serif`;
  ctx.fillText(formatMl(ml), L.ml.x, L.ml.y);
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
  if (!placement?.validationOk) {
    const msg = formatValidationFailure(placement?.failureMessages ?? []);
    return {
      buffer: Buffer.alloc(0),
      fotoLoaded: true,
      layoutValidationOk: false,
      layoutValidationPasses: placement?.validationPasses,
      layoutValidationError: msg
    };
  }

  adj = { ...adj, ...placement.adjustment };
  const Lfinal = buildPodruzhkaLayout(adj);
  textEst = buildTextLayoutEstimate(ctx, data, Lfinal, adj);

  const placementFinal = await resolveProductPlacement(data.fotoUrl, textEst, adj);
  const finalPlacement = placementFinal.placement;
  if (!finalPlacement?.validationOk) {
    const msg = formatValidationFailure(finalPlacement?.failureMessages ?? []);
    return {
      buffer: Buffer.alloc(0),
      fotoLoaded: true,
      layoutValidationOk: false,
      layoutValidationPasses: finalPlacement?.validationPasses,
      layoutValidationError: msg
    };
  }

  await drawTemplateBase(ctx);
  overlayDynamicText(ctx, data, Lfinal, adj);
  await drawProductPlacementAsync(ctx, finalPlacement);
  overlayMl(ctx, data.ml, Lfinal);

  const png = canvas.toBuffer("image/png");
  const buffer = await sharp(png).jpeg({ quality: 92 }).toBuffer();
  return {
    buffer,
    fotoLoaded: true,
    layoutValidationOk: true,
    layoutValidationPasses: finalPlacement.validationPasses
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
