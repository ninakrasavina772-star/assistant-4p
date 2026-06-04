import { createCanvas, loadImage, GlobalFonts } from "@napi-rs/canvas";
import fs from "fs";
import path from "path";
import sharp from "sharp";
import type { PodruzhkaInfographicData } from "@/lib/podruzhkaTypes";
import { fetchPodruzhkaProductImageDetailed } from "@/lib/podruzhkaImageFetch";
import { fitProductPng } from "@/lib/podruzhkaImageProcess";
import { getResizedTemplateBuffer } from "@/lib/podruzhkaTemplateAssets";
import { PODRUZHKA_LAYOUT, PODRUZHKA_SIZE } from "@/lib/podruzhkaLayout";
import { PODRUZHKA_SPEC as S } from "@/lib/podruzhkaSpec";

const { w: W, h: H } = PODRUZHKA_SIZE;
const L = PODRUZHKA_LAYOUT;
const C = S.colors;

const LOGO_PATH = path.join(process.cwd(), "public", "podruzhka", "logo-global.png");

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

function roundRectPath(
  ctx: ReturnType<ReturnType<typeof createCanvas>["getContext"]>,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

async function drawTemplateBase(
  ctx: ReturnType<ReturnType<typeof createCanvas>["getContext"]>
): Promise<void> {
  const buf = await getResizedTemplateBuffer(W, H);
  const base = await loadImage(buf);
  ctx.drawImage(base, 0, 0, W, H);

  const hdr = S.header;
  ctx.fillStyle = C.bg;
  ctx.fillRect(hdr.x - 20, hdr.y - 12, hdr.w + 40, hdr.h + 24);

  const fadeX = Math.round(W * S.ratios.loopFadeX);
  ctx.fillStyle = `rgba(247, 247, 247, ${S.ratios.loopFadeOpacity})`;
  ctx.fillRect(fadeX, S.ratios.loopFadeY, W - fadeX, H - S.ratios.loopFadeY - 100);
}

/** Чистая плашка из Figma (чёрный pill), без артефактов шаблона */
async function drawHeaderSolid(
  ctx: ReturnType<ReturnType<typeof createCanvas>["getContext"]>
): Promise<void> {
  const hdr = S.header;
  const r = hdr.h / 2;

  ctx.fillStyle = "#000000";
  roundRectPath(ctx, hdr.x, hdr.y, hdr.w, hdr.h, r);
  ctx.fill();

  if (fs.existsSync(LOGO_PATH)) {
    try {
      const logoBuf = await fs.promises.readFile(LOGO_PATH);
      const logo = await loadImage(logoBuf);
      const maxW = hdr.w - 40;
      const scale = Math.min(maxW / logo.width, (hdr.h - 16) / logo.height, 1);
      const lw = logo.width * scale;
      const lh = logo.height * scale;
      ctx.drawImage(logo, hdr.x + (hdr.w - lw) / 2, hdr.y + (hdr.h - lh) / 2, lw, lh);
      return;
    } catch {
      /* fallback text */
    }
  }

  ctx.fillStyle = "#ffffff";
  ctx.font = "600 17px MontserratBold, Montserrat, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("✈   подружка Global", hdr.x + hdr.w / 2, hdr.y + hdr.h / 2 + 2);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

/** Вертикальный поток как в Figma: розовая черта сразу после модели (не между строками) */
function overlayDynamicText(
  ctx: ReturnType<ReturnType<typeof createCanvas>["getContext"]>,
  data: PodruzhkaInfographicData
): number {
  const x = L.textX;
  const modelSize = S.fonts.model.size;
  const typeSize = S.fonts.productType.size;

  const { size: brandSize, lines: brandLines } = resolveBrandFontSize(ctx, data.brandName);
  ctx.fillStyle = C.text;
  ctx.font = brandFont(brandSize);
  let y = L.textStartY + brandSize;
  for (const line of brandLines) {
    ctx.fillText(line, x, y);
    y += Math.round(brandSize * 1.05);
  }
  y += S.gaps.afterBrand;

  ctx.fillStyle = C.muted;
  ctx.font = `400 ${typeSize}px Montserrat, NotoSans, sans-serif`;
  const typeLine = wrapLines(ctx, data.productType.trim(), L.productType.w, ctx.font, 1)[0];
  if (typeLine) {
    ctx.fillText(typeLine, x, y + typeSize);
    y += typeSize + S.gaps.afterType;
  }

  ctx.fillStyle = C.text;
  ctx.font = `800 ${modelSize}px MontserratExtraBold, MontserratBold, sans-serif`;
  const modelLines = wrapLines(ctx, data.model, L.model.w, ctx.font, S.fonts.model.maxLines);
  for (const line of modelLines) {
    ctx.fillText(line, x, y + modelSize);
    y += Math.round(modelSize * 1.08);
  }
  y += S.gaps.afterModel;

  drawFilledBar(ctx, S.accentBar.x, y, S.accentBar.w, S.accentBar.h, C.accent);
  y += S.accentBar.h + S.gaps.afterAccent;

  const fNoteTitle = `700 ${S.fonts.noteTitle.size}px MontserratBold, Montserrat, sans-serif`;
  const fNoteDesc = `400 ${S.fonts.noteDesc.size}px Montserrat, NotoSans, sans-serif`;
  const notes = data.notes.slice(0, 3);

  for (let i = 0; i < notes.length; i++) {
    const n = notes[i]!;
    const blockY = y + i * L.notes.blockH;

    ctx.fillStyle = C.accent;
    ctx.font = fNoteTitle;
    ctx.fillText(n.title.toUpperCase(), L.notes.x, blockY + S.fonts.noteTitle.size);

    ctx.fillStyle = C.muted;
    ctx.font = fNoteDesc;
    ctx.fillText(n.desc, L.notes.x, blockY + S.noteDescOffset);

    if (i < 2) {
      drawFilledBar(ctx, L.notes.x, blockY + L.notes.blockH - 1, L.separator.width, 1, C.separator);
    }
  }

  return y + notes.length * L.notes.blockH;
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
    const { buffer, width, height } = await fitProductPng(
      productBuf,
      zone.w,
      zone.h,
      S.ratios.productFillHeight
    );

    const prodImg = await loadImage(buffer);
    const drawX = zone.x + (zone.w - width) / 2;
    const bottomTarget = L.ml.y - 8;
    const drawY = Math.max(zone.y, bottomTarget - height);

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
  overlayDynamicText(ctx, opts.data);
  const foto = await overlayProductPhoto(ctx, opts.data.fotoUrl);
  overlayMl(ctx, opts.data.ml);
  await drawHeaderSolid(ctx);

  const png = canvas.toBuffer("image/png");
  const buffer = await sharp(png).jpeg({ quality: 92 }).toBuffer();
  return {
    buffer,
    fotoLoaded: foto.loaded,
    fotoError: foto.error
  };
}
