import { createCanvas, loadImage, GlobalFonts } from "@napi-rs/canvas";
import fs from "fs";
import path from "path";
import sharp from "sharp";
import type { PodruzhkaInfographicData } from "@/lib/podruzhkaTypes";
import { fetchPodruzhkaProductImageDetailed } from "@/lib/podruzhkaImageFetch";
import { fitProductPng } from "@/lib/podruzhkaImageProcess";
import { getFullTemplateBuffer } from "@/lib/podruzhkaTemplateAssets";
import { PODRUZHKA_LAYOUT, PODRUZHKA_SIZE } from "@/lib/podruzhkaLayout";
import { PODRUZHKA_SPEC as S } from "@/lib/podruzhkaSpec";

const { w: W, h: H } = PODRUZHKA_SIZE;
const L = PODRUZHKA_LAYOUT;
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
  brandName: string
): { size: number; lines: string[] } {
  const maxW = L.brand.w;
  const maxH = L.brand.h;
  const maxLines = S.fonts.brand.maxLines;

  for (let size = S.fonts.brand.maxSize; size >= S.fonts.brand.minSize; size -= 2) {
    const font = brandFont(size);
    const lines = wrapLines(ctx, brandName.toUpperCase(), maxW, font, maxLines);
    const lineH = Math.round(size * 1.05);
    const totalH = lines.length * lineH;
    const widest = Math.max(0, ...lines.map((ln) => ctx.measureText(ln).width));
    if (widest <= maxW && totalH <= maxH) {
      return { size, lines };
    }
  }

  const size = S.fonts.brand.minSize;
  return {
    size,
    lines: wrapLines(ctx, brandName.toUpperCase(), maxW, brandFont(size), maxLines)
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

/** Слой 0: полный template-base.png (шапка как в макете) */
async function drawTemplateBase(
  ctx: ReturnType<ReturnType<typeof createCanvas>["getContext"]>
): Promise<void> {
  const buf = await getFullTemplateBuffer();
  const base = await loadImage(buf);
  ctx.drawImage(base, 0, 0, W, H);
}

/** Левая колонка под текст — чистый фон, шапку не затираем */
function clearTextColumn(ctx: ReturnType<ReturnType<typeof createCanvas>["getContext"]>): void {
  const top = S.contentClearTop;
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, top, Math.round(W * 0.52), H - top - 100);
}

/** Фиксированная сетка как в референсе — ноты не «плывут» */
function overlayDynamicText(
  ctx: ReturnType<ReturnType<typeof createCanvas>["getContext"]>,
  data: PodruzhkaInfographicData
): void {
  const x = L.textX;
  const modelSize = S.fonts.model.size;
  const typeSize = S.fonts.productType.size;

  const { size: brandSize, lines: brandLines } = resolveBrandFontSize(ctx, data.brandName);
  ctx.fillStyle = C.text;
  ctx.font = brandFont(brandSize);
  let brandBaseline = L.brand.y + brandSize;
  for (const line of brandLines) {
    ctx.fillText(line, x, brandBaseline);
    brandBaseline += Math.round(brandSize * 1.05);
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
    ctx.fillText(typeLine, L.productType.x, L.productType.y + typeSize);
  }

  ctx.fillStyle = C.text;
  ctx.font = `800 ${modelSize}px MontserratExtraBold, MontserratBold, sans-serif`;
  const modelLines = wrapLines(ctx, data.model, L.model.w, ctx.font, S.fonts.model.maxLines);
  let modelBaseline = L.model.y + modelSize;
  for (const line of modelLines) {
    ctx.fillText(line, L.model.x, modelBaseline);
    modelBaseline += Math.round(modelSize * 1.08);
  }

  drawFilledBar(ctx, L.accent.x, L.accent.y, L.accent.w, L.accent.h, C.accent);

  const fNoteTitle = `700 ${S.fonts.noteTitle.size}px MontserratBold, Montserrat, sans-serif`;
  const fNoteDesc = `400 ${S.fonts.noteDesc.size}px Montserrat, NotoSans, sans-serif`;
  const notes = data.notes.slice(0, 3);

  for (let i = 0; i < notes.length; i++) {
    const n = notes[i]!;
    const blockY = L.notes.startY + i * L.notes.blockH;

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

async function overlayProductPhoto(
  ctx: ReturnType<ReturnType<typeof createCanvas>["getContext"]>,
  fotoUrl: string
): Promise<{ loaded: boolean; error?: string }> {
  const url = fotoUrl?.trim();
  if (!url) return { loaded: false, error: "Колонка foto пуста" };

  const { buf: productBuf, error } = await fetchPodruzhkaProductImageDetailed(url);
  if (!productBuf?.length) return { loaded: false, error: error ?? "Не скачалось foto" };

  try {
    const zone = L.product;
    const availH = zone.bottom - zone.y;
    const { buffer, width, height } = await fitProductPng(
      productBuf,
      zone.w,
      availH,
      S.product.fillHeight,
      S.product.minHeightRatio
    );

    const prodImg = await loadImage(buffer);
    const drawX = zone.x + (zone.w - width) / 2;
    const drawY = zone.bottom - height;

    drawProductShadow(ctx, drawX + width / 2, drawY + height, width);
    ctx.drawImage(prodImg, drawX, drawY, width, height);
    return { loaded: true };
  } catch (e) {
    return {
      loaded: false,
      error: e instanceof Error ? e.message : "Ошибка обработки foto"
    };
  }
}

function overlayMl(ctx: ReturnType<ReturnType<typeof createCanvas>["getContext"]>, ml: string): void {
  drawFilledBar(ctx, L.mlAccent.x, L.mlAccent.y, L.mlAccent.w, L.mlAccent.h, C.accent);
  ctx.fillStyle = C.text;
  ctx.font = `500 italic ${S.fonts.ml.size}px MontserratMediumItalic, Montserrat, sans-serif`;
  ctx.fillText(formatMl(ml), L.ml.x, L.ml.y);
}

export type RenderInfographicResult = {
  buffer: Buffer;
  fotoLoaded: boolean;
  fotoError?: string;
};

export type RenderInfographicOptions = {
  data: PodruzhkaInfographicData;
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

export async function renderInfographicDetailed(
  dataOrOpts: PodruzhkaInfographicData | RenderInfographicOptions
): Promise<RenderInfographicResult> {
  const opts: RenderInfographicOptions = isRenderOptions(dataOrOpts)
    ? dataOrOpts
    : { data: dataOrOpts };

  ensureFonts();

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  await drawTemplateBase(ctx);
  clearTextColumn(ctx);
  overlayDynamicText(ctx, opts.data);
  const foto = await overlayProductPhoto(ctx, opts.data.fotoUrl);
  overlayMl(ctx, opts.data.ml);

  const png = canvas.toBuffer("image/png");
  const buffer = await sharp(png).jpeg({ quality: 92 }).toBuffer();
  return {
    buffer,
    fotoLoaded: foto.loaded,
    fotoError: foto.error
  };
}
