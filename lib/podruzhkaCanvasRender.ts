import { createCanvas, loadImage, GlobalFonts } from "@napi-rs/canvas";
import path from "path";
import fs from "fs";
import sharp from "sharp";
import type { PodruzhkaInfographicData } from "@/lib/podruzhkaTypes";
import { fetchPodruzhkaProductImageDetailed } from "@/lib/podruzhkaImageFetch";
import { fitProductPng } from "@/lib/podruzhkaImageProcess";
import { PODRUZHKA_LAYOUT, PODRUZHKA_SIZE } from "@/lib/podruzhkaLayout";
import { PODRUZHKA_SPEC as S } from "@/lib/podruzhkaSpec";

const { w: W, h: H } = PODRUZHKA_SIZE;
const L = PODRUZHKA_LAYOUT;
const C = S.colors;

const TEMPLATE_PATH = path.join(process.cwd(), "public", "podruzhka", "template-base.png");

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
  if (!fs.existsSync(TEMPLATE_PATH)) {
    throw new Error("Не найден шаблон public/podruzhka/template-base.png");
  }
  const raw = await fs.promises.readFile(TEMPLATE_PATH);
  const meta = await sharp(raw).metadata();
  const buf =
    meta.width === W && meta.height === H
      ? raw
      : await sharp(raw).resize(W, H, { fit: "fill" }).png().toBuffer();
  const base = await loadImage(buf);
  ctx.drawImage(base, 0, 0, W, H);
}

/** Текст по фиксированным координатам макета 1000×1400 */
function overlayDynamicText(
  ctx: ReturnType<ReturnType<typeof createCanvas>["getContext"]>,
  data: PodruzhkaInfographicData
): void {
  const fBrand = `800 ${S.fonts.brand.size}px MontserratExtraBold, MontserratBold, sans-serif`;
  const fType = `400 ${S.fonts.productType.size}px Montserrat, NotoSans, sans-serif`;
  const fModel = `800 ${S.fonts.model.size}px MontserratExtraBold, MontserratBold, sans-serif`;
  const fNoteTitle = `700 ${S.fonts.noteTitle.size}px MontserratBold, Montserrat, sans-serif`;
  const fNoteDesc = `400 ${S.fonts.noteDesc.size}px Montserrat, NotoSans, sans-serif`;
  const fMl = `500 italic ${S.fonts.ml.size}px MontserratMediumItalic, Montserrat, sans-serif`;

  const bx = L.brand.x;
  let brandY = L.brand.y + S.fonts.brand.size;
  ctx.fillStyle = C.text;
  ctx.font = fBrand;
  for (const line of wrapLines(
    ctx,
    data.brandName.toUpperCase(),
    L.brand.w,
    fBrand,
    S.fonts.brand.maxLines
  )) {
    ctx.fillText(line, bx, brandY);
    brandY += Math.round(S.fonts.brand.size * 1.05);
  }

  ctx.fillStyle = C.productType;
  ctx.font = fType;
  const typeLines = wrapLines(
    ctx,
    data.productType.trim(),
    L.productType.w,
    fType,
    S.fonts.productType.maxLines
  );
  if (typeLines[0]) {
    ctx.fillText(typeLines[0], L.productType.x, L.productType.y + S.fonts.productType.size);
  }

  ctx.fillStyle = C.text;
  ctx.font = fModel;
  let modelY = L.model.y + S.fonts.model.size;
  for (const line of wrapLines(ctx, data.model, L.model.w, fModel, S.fonts.model.maxLines)) {
    ctx.fillText(line, L.model.x, modelY);
    modelY += Math.round(S.fonts.model.size * 1.08);
  }

  drawFilledBar(ctx, L.accentBar.x, L.accentBar.y, L.accentBar.w, L.accentBar.h, C.accent);

  const notes = data.notes.slice(0, 3);
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i]!;
    const blockY = L.notes.y + i * L.notes.blockH;

    ctx.fillStyle = C.accent;
    ctx.font = fNoteTitle;
    ctx.fillText(n.title.toUpperCase(), L.notes.x, blockY + S.fonts.noteTitle.size);

    ctx.fillStyle = C.muted;
    ctx.font = fNoteDesc;
    ctx.fillText(n.desc, L.notes.x, blockY + 40);

    if (i < 2) {
      const sepY = blockY + L.notes.blockH - 1;
      drawFilledBar(ctx, L.notes.x, sepY, L.separator.width, 1, C.separator);
    }
  }

  drawFilledBar(ctx, L.mlAccent.x, L.mlAccent.y, L.mlAccent.w, L.mlAccent.h, C.accent);
  ctx.fillStyle = C.text;
  ctx.font = fMl;
  ctx.fillText(formatMl(data.ml), L.ml.x, L.ml.y);
}

/** Фото: contain, 90% высоты зоны, низ + центр, без белого фона */
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
    const maxH = Math.round(zone.h * S.productMaxHeightRatio);
    const { buffer, width, height } = await fitProductPng(productBuf, zone.w, maxH);

    const prodImg = await loadImage(buffer);
    const drawX = zone.x + (zone.w - width) / 2;
    const drawY = zone.y + zone.h - height;

    ctx.drawImage(prodImg, drawX, drawY, width, height);
    return { loaded: true };
  } catch (e) {
    return {
      loaded: false,
      error: e instanceof Error ? e.message : "Ошибка обработки foto"
    };
  }
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

  const png = canvas.toBuffer("image/png");
  const buffer = await sharp(png).jpeg({ quality: 92 }).toBuffer();
  return {
    buffer,
    fotoLoaded: foto.loaded,
    fotoError: foto.error
  };
}
