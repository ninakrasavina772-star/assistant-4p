import { createCanvas, loadImage, GlobalFonts } from "@napi-rs/canvas";
import path from "path";
import fs from "fs";
import sharp from "sharp";
import type { PodruzhkaInfographicData } from "@/lib/podruzhkaTypes";
import { assertFetchableImageUrl, defaultAllowedHosts } from "@/lib/ozonImageUrls";

const W = 900;
const H = 1200;
const PINK = "#E91E8C";

let fontsReady = false;

function ensureFonts(): void {
  if (fontsReady) return;
  const dir = path.join(process.cwd(), "public", "fonts");
  const regular = path.join(dir, "NotoSans-Regular.ttf");
  const bold = path.join(dir, "NotoSans-Bold.ttf");
  if (fs.existsSync(regular)) {
    GlobalFonts.registerFromPath(regular, "NotoSans");
  }
  if (fs.existsSync(bold)) {
    GlobalFonts.registerFromPath(bold, "NotoSansBold");
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
  if (!words.length) return [];
  const lines: string[] = [];
  let line = words[0]!;
  for (let i = 1; i < words.length; i++) {
    const w = words[i]!;
    const test = `${line} ${w}`;
    if (ctx.measureText(test).width > maxWidth) {
      lines.push(line);
      line = w;
    } else {
      line = test;
    }
  }
  lines.push(line);
  return lines;
}

async function fetchProductImage(url: string): Promise<Buffer | null> {
  try {
    const allowed = defaultAllowedHosts();
    assertFetchableImageUrl(url, allowed);
    const res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(45_000)
    });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

export type RenderInfographicOptions = {
  data: PodruzhkaInfographicData;
  /** PNG/JPG референс 900×1200 — фон шаблона без текста или полный макет */
  templateBuffer?: Buffer | null;
};

export async function renderInfographicPng(
  dataOrOpts: PodruzhkaInfographicData | RenderInfographicOptions
): Promise<Buffer> {
  const opts: RenderInfographicOptions =
    "data" in dataOrOpts && dataOrOpts.data
      ? (dataOrOpts as RenderInfographicOptions)
      : { data: dataOrOpts as PodruzhkaInfographicData };

  const data = opts.data;
  ensureFonts();

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  if (opts.templateBuffer?.length) {
    const img = await loadImage(opts.templateBuffer);
    ctx.drawImage(img, 0, 0, W, H);
  } else {
    ctx.fillStyle = "#e8e8e8";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.beginPath();
    ctx.ellipse(780, 180, 220, 200, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#0a0a0a";
    ctx.fillRect(225, 36, 450, 52);
    ctx.fillStyle = "#ffffff";
    ctx.font = "600 18px NotoSansBold, NotoSans, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("подружка Global", 450, 70);
    ctx.textAlign = "left";
  }

  const fontBold = "700 38px NotoSansBold, NotoSans, sans-serif";
  const fontGray = "400 17px NotoSans, sans-serif";
  const fontModel = "700 28px NotoSansBold, NotoSans, sans-serif";
  const fontNoteTitle = "700 22px NotoSansBold, NotoSans, sans-serif";
  const fontNoteDesc = "400 16px NotoSans, sans-serif";
  const fontMl = "600 26px NotoSansBold, NotoSans, sans-serif";

  ctx.fillStyle = "#0a0a0a";
  ctx.font = fontBold;
  const brandLines = wrapLines(ctx, data.brandName.toUpperCase(), 340, fontBold);
  let y = 130;
  for (const line of brandLines.slice(0, 2)) {
    y += 36;
    ctx.fillText(line, 48, y);
  }

  ctx.fillStyle = "#7a7a7a";
  ctx.font = fontGray;
  y += 28;
  const ptypeLines = wrapLines(ctx, data.productType, 340, fontGray);
  for (const line of ptypeLines.slice(0, 2)) {
    ctx.fillText(line, 48, y);
    y += 22;
  }

  ctx.fillStyle = "#0a0a0a";
  ctx.font = fontModel;
  y += 12;
  const modelLines = wrapLines(ctx, data.model, 340, fontModel);
  for (const line of modelLines.slice(0, 2)) {
    ctx.fillText(line, 48, y);
    y += 32;
  }

  ctx.strokeStyle = PINK;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(48, y + 8);
  ctx.lineTo(128, y + 8);
  ctx.stroke();

  y += 36;
  const notes = data.notes.slice(0, 3);
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i]!;
    ctx.strokeStyle = PINK;
    ctx.beginPath();
    ctx.moveTo(48, y - 8);
    ctx.lineTo(128, y - 8);
    ctx.stroke();

    ctx.fillStyle = PINK;
    ctx.font = fontNoteTitle;
    ctx.fillText(n.title.toUpperCase(), 48, y + 20);

    ctx.fillStyle = "#6b6b6b";
    ctx.font = fontNoteDesc;
    ctx.fillText(n.desc, 48, y + 44);

    y += 88;
    if (i < 2) {
      ctx.strokeStyle = "#d0d0d0";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(48, y - 16);
      ctx.lineTo(320, y - 16);
      ctx.stroke();
    }
  }

  ctx.strokeStyle = PINK;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(48, 1080);
  ctx.lineTo(128, 1080);
  ctx.stroke();

  ctx.fillStyle = "#0a0a0a";
  ctx.font = fontMl;
  ctx.fillText(formatMl(data.ml), 48, 1125);

  const productBuf = data.fotoUrl ? await fetchProductImage(data.fotoUrl) : null;
  if (productBuf) {
    try {
      const resized = await sharp(productBuf)
        .resize({ width: 480, height: 880, fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer();
      const prodImg = await loadImage(resized);
      ctx.drawImage(prodImg, 400, 260, 480, 880);
    } catch {
      /* без фото */
    }
  }

  const png = canvas.toBuffer("image/png");
  return sharp(png).jpeg({ quality: 92 }).toBuffer();
}
