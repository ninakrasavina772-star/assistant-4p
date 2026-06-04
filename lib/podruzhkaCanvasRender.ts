import { createCanvas, loadImage, GlobalFonts } from "@napi-rs/canvas";
import path from "path";
import fs from "fs";
import sharp from "sharp";
import type { PodruzhkaInfographicData } from "@/lib/podruzhkaTypes";
import { fetchPodruzhkaProductImageDetailed } from "@/lib/podruzhkaImageFetch";
import { PODRUZHKA_LAYOUT, PODRUZHKA_SIZE } from "@/lib/podruzhkaLayout";
import { PODRUZHKA_SPEC as S } from "@/lib/podruzhkaSpec";

const { w: W, h: H } = PODRUZHKA_SIZE;
const L = PODRUZHKA_LAYOUT;
const C = S.colors;
const BG_RGB = { r: 247, g: 247, b: 247 };

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
  font: string
): string[] {
  ctx.font = font;
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return [text.slice(0, 80)];
  const lines: string[] = [];
  let line = words[0]!;
  for (let i = 1; i < words.length; i++) {
    const w = words[i]!;
    const test = `${line} ${w}`;
    if (ctx.measureText(test).width > maxWidth) {
      lines.push(line);
      line = w;
    } else line = test;
  }
  lines.push(line);
  return lines;
}

function drawAccentLine(
  ctx: ReturnType<ReturnType<typeof createCanvas>["getContext"]>,
  x: number,
  y: number
): void {
  ctx.strokeStyle = C.accent;
  ctx.lineWidth = S.accentLine.width;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + S.accentLine.length, y);
  ctx.stroke();
}

/** Неизменяемый слой: фон, петля, шапка Global (ваш PNG) */
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

/** Текст и акценты поверх шаблона — без заливки зон */
function overlayDynamicText(
  ctx: ReturnType<ReturnType<typeof createCanvas>["getContext"]>,
  data: PodruzhkaInfographicData
): void {
  const fBrand = `800 ${L.brand.fontSize}px MontserratExtraBold, MontserratBold, sans-serif`;
  const fType = `400 ${L.productType.fontSize}px Montserrat, NotoSans, sans-serif`;
  const fModel = `800 ${L.model.fontSize}px MontserratExtraBold, MontserratBold, sans-serif`;
  const fNoteTitle = `700 ${S.fonts.noteTitle.size}px MontserratBold, Montserrat, sans-serif`;
  const fNoteDesc = `400 ${S.fonts.noteDesc.size}px Montserrat, NotoSans, sans-serif`;
  const fMl = `500 italic ${L.ml.fontSize}px MontserratMediumItalic, Montserrat, sans-serif`;

  const x = L.contentLeft;
  let y = L.contentTop;

  ctx.fillStyle = C.text;
  ctx.font = fBrand;
  for (const line of wrapLines(ctx, data.brandName.toUpperCase(), L.brand.maxWidth, fBrand).slice(0, 2)) {
    y += L.brand.lineHeight;
    ctx.fillText(line, x, y);
  }

  y += L.productType.gapAfterBrand;
  ctx.fillStyle = C.muted;
  ctx.font = fType;
  const productTypeText = data.productType.trim().toLowerCase();
  for (const line of wrapLines(ctx, productTypeText, L.productType.maxWidth, fType).slice(0, 2)) {
    y += L.productType.lineHeight;
    ctx.fillText(line, x, y);
  }

  y += L.model.gapAfterType;
  ctx.fillStyle = C.text;
  ctx.font = fModel;
  for (const line of wrapLines(ctx, data.model, L.model.maxWidth, fModel).slice(0, 2)) {
    y += L.model.lineHeight;
    ctx.fillText(line, x, y);
  }

  y += L.gapAfterModel;
  drawAccentLine(ctx, x, y);
  y += L.gapAfterAccent;

  const notes = data.notes.slice(0, 3);
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i]!;
    ctx.fillStyle = C.accent;
    ctx.font = fNoteTitle;
    ctx.fillText(n.title.toUpperCase(), x, y + L.noteTitleOffsetY);

    ctx.fillStyle = C.muted;
    ctx.font = fNoteDesc;
    ctx.fillText(n.desc, x, y + L.noteDescOffsetY);

    y += L.noteLineHeight;
    if (i < 2) {
      ctx.strokeStyle = C.separator;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y - 28);
      ctx.lineTo(x + L.separator.width, y - 28);
      ctx.stroke();
    }
  }

  const mlY = L.ml.y;
  drawAccentLine(ctx, x, mlY - L.accentBeforeMlOffset);
  ctx.fillStyle = C.text;
  ctx.font = fMl;
  ctx.fillText(formatMl(data.ml), x, mlY);
}

/** Фото товара поверх шаблона (петля и фон из PNG не трогаем) */
async function overlayProductPhoto(
  ctx: ReturnType<ReturnType<typeof createCanvas>["getContext"]>,
  fotoUrl: string
): Promise<{ loaded: boolean; error?: string }> {
  const url = fotoUrl?.trim();
  if (!url) return { loaded: false, error: "Колонка foto пуста" };

  const { buf: productBuf, error } = await fetchPodruzhkaProductImageDetailed(url);
  if (!productBuf?.length) return { loaded: false, error: error ?? "Не скачалось foto" };

  try {
    const pw = L.product.w;
    const ph = L.product.h;
    const tile = await sharp(productBuf)
      .resize(pw, ph, {
        fit: "contain",
        background: { ...BG_RGB, alpha: 1 }
      })
      .flatten({ background: BG_RGB })
      .png()
      .toBuffer();

    const prodImg = await loadImage(tile);
    ctx.drawImage(prodImg, L.product.x, L.product.y, pw, ph);
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

/**
 * Шаблон PNG (фон + петля + шапка) → поверх текст из Excel/AI → поверх foto.
 */
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

  const data = opts.data;
  ensureFonts();

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  await drawTemplateBase(ctx);
  overlayDynamicText(ctx, data);
  const foto = await overlayProductPhoto(ctx, data.fotoUrl);

  const png = canvas.toBuffer("image/png");
  const buffer = await sharp(png).jpeg({ quality: 92 }).toBuffer();
  return {
    buffer,
    fotoLoaded: foto.loaded,
    fotoError: foto.error
  };
}
