"use client";

import {
  formatMlHtml,
  PODRUZHKA_HTML_LAYOUT_VERSION,
  PODRUZHKA_HTML_SPEC as S
} from "@/lib/podruzhkaHtmlSpec";
import { PODRUZHKA_FIGMA as F } from "@/lib/podruzhkaFigmaLayout";
import {
  DEFAULT_BRAND_BOX,
  measureFromCanvas2D,
  resolveBrandLines
} from "@/lib/podruzhkaBrandLayout";
import type { PodruzhkaInfographicData } from "@/lib/podruzhkaTypes";

const FONT_DIR = "/podruzhka/fonts";

const FONT_FILES: { family: string; weight: string; style: string; file: string }[] = [
  { family: "Libre Franklin", weight: "800", style: "normal", file: "libre-franklin-latin-800-normal.woff2" },
  { family: "Inter", weight: "400", style: "normal", file: "inter-latin-400-normal.woff2" },
  { family: "Inter", weight: "500", style: "normal", file: "inter-latin-500-normal.woff2" },
  { family: "Inter", weight: "500", style: "italic", file: "inter-latin-500-italic.woff2" },
  { family: "Inter", weight: "700", style: "normal", file: "inter-latin-700-normal.woff2" },
  { family: "Inter", weight: "800", style: "normal", file: "inter-latin-800-normal.woff2" }
];

let fontsReady = false;

async function ensurePodruzhkaFonts(): Promise<void> {
  if (fontsReady || typeof document === "undefined") return;
  await Promise.all(
    FONT_FILES.map(async (def) => {
      const url = `${FONT_DIR}/${def.file}`;
      const face = new FontFace(def.family, `url(${url})`, {
        weight: def.weight,
        style: def.style
      });
      await face.load();
      document.fonts.add(face);
    })
  );
  await document.fonts.ready;
  const ok = document.fonts.check('800 95px "Libre Franklin"') && document.fonts.check("400 26px Inter");
  if (!ok) {
    throw new Error("Шрифты Inter/Libre Franklin не загрузились — обновите страницу (Ctrl+F5)");
  }
  fontsReady = true;
}

function wrapLines(
  ctx: CanvasRenderingContext2D,
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

function fitFontSize(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxSize: number,
  minSize: number,
  fontStr: (size: number) => string,
  maxWidth: number,
  maxLines: number
): { size: number; lines: string[] } {
  for (let size = maxSize; size >= minSize; size -= 2) {
    const font = fontStr(size);
    const lines = wrapLines(ctx, text, maxWidth, font, maxLines);
    ctx.font = font;
    const widest = Math.max(...lines.map((ln) => ctx.measureText(ln).width), 0);
    if (widest <= maxWidth) return { size, lines };
  }
  const size = minSize;
  return { size, lines: wrapLines(ctx, text, maxWidth, fontStr(size), maxLines) };
}

function brandFont(size: number): string {
  return `800 ${size}px "Libre Franklin", sans-serif`;
}

function interFont(size: number, weight: number, italic = false): string {
  return `${italic ? "italic " : ""}${weight} ${size}px Inter, sans-serif`;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Не загрузилось изображение"));
    img.src = src;
  });
}

export type ProcessedFoto = {
  dataUrl: string;
  drawX: number;
  drawY: number;
  width: number;
  height: number;
};

export async function fetchProcessedFoto(fotoUrl: string): Promise<ProcessedFoto> {
  const q = encodeURIComponent(fotoUrl.trim());
  const res = await fetch(`/api/podruzhka/foto?url=${q}`);
  if (!res.ok) {
    let msg = `foto: HTTP ${res.status}`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j.error) msg = j.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }

  const drawX = Number(res.headers.get("X-Podruzhka-Draw-X") ?? F.product.x);
  const drawY = Number(res.headers.get("X-Podruzhka-Draw-Y") ?? F.product.y);
  const width = Number(res.headers.get("X-Podruzhka-Width") ?? F.product.w);
  const height = Number(res.headers.get("X-Podruzhka-Height") ?? F.product.h);
  const blob = await res.blob();
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("foto: blob"));
    reader.readAsDataURL(blob);
  });

  return { dataUrl, drawX, drawY, width, height };
}

function drawBar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string
): void {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

export async function drawPodruzhkaCard(
  ctx: CanvasRenderingContext2D,
  data: PodruzhkaInfographicData,
  foto: ProcessedFoto,
  templateImg: HTMLImageElement,
  productImg: HTMLImageElement
): Promise<void> {
  const { w, h } = S.frame;
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(templateImg, 0, 0, w, h);

  drawBar(ctx, F.notesPinkBar.x, F.notesPinkBar.y, F.notesPinkBar.w, F.notesPinkBar.h, S.colors.accent);
  drawBar(ctx, F.mlPinkBar.x, F.mlPinkBar.y, F.mlPinkBar.w, F.mlPinkBar.h, S.colors.accent);

  const brand = resolveBrandLines(measureFromCanvas2D(ctx), {
    brandName: data.brandName,
    maxSize: S.fonts.brand.max,
    minSize: S.fonts.brand.min,
    maxWidth: DEFAULT_BRAND_BOX.maxWidth,
    maxHeight: DEFAULT_BRAND_BOX.maxHeight,
    maxLines: DEFAULT_BRAND_BOX.maxLines,
    lineHeight: S.fonts.brand.lineHeight,
    fontForSize: brandFont
  });

  const model = fitFontSize(
    ctx,
    data.model,
    S.fonts.model.max,
    S.fonts.model.min,
    (size) => interFont(size, 800),
    F.model.w,
    2
  );

  const typeSize = S.fonts.productType.size;
  const typeText = data.productType.trim().toLowerCase();
  const typeLines = typeText
    ? wrapLines(ctx, typeText, F.productType.w, interFont(typeSize, 400), 2)
    : [];

  ctx.fillStyle = S.colors.text;
  ctx.font = brandFont(brand.size);
  ctx.textBaseline = "top";
  let brandY = F.brand.y;
  for (const line of brand.lines) {
    ctx.fillText(line, F.brand.x, brandY);
    brandY += Math.round(brand.size * S.fonts.brand.lineHeight);
  }

  if (typeLines.length) {
    ctx.fillStyle = S.colors.muted;
    ctx.font = interFont(typeSize, 400);
    let typeY = F.productType.y;
    for (const line of typeLines) {
      ctx.fillText(line, F.productType.x, typeY);
      typeY += Math.round(typeSize * S.fonts.productType.lineHeight);
    }
  }

  ctx.fillStyle = S.colors.text;
  ctx.font = interFont(model.size, 800);
  let modelY = F.model.y;
  for (const line of model.lines) {
    ctx.fillText(line, F.model.x, modelY);
    modelY += Math.round(model.size * S.fonts.model.lineHeight);
  }

  const notes = data.notes.slice(0, 3);
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i]!;
    const slot = F.notes[i]!;

    ctx.fillStyle = S.colors.accent;
    ctx.font = interFont(S.fonts.noteTitle.size, 700);
    ctx.fillText(n.title.toUpperCase(), F.textX, slot.titleY);

    ctx.fillStyle = S.colors.muted;
    ctx.font = interFont(S.fonts.noteDesc.size, 400);
    ctx.fillText(n.desc, F.textX, slot.descY);

    if (slot.sepY != null) {
      drawBar(ctx, F.textX, slot.sepY, F.separator.w, F.separator.h, S.colors.separator);
    }
  }

  const ml = formatMlHtml(data.ml);
  if (ml) {
    ctx.fillStyle = S.colors.text;
    ctx.font = interFont(S.fonts.ml.size, 500, true);
    ctx.fillText(ml, F.ml.x, F.ml.y);
  }

  // шаблон → черты → текст → фото
  ctx.drawImage(productImg, foto.drawX, foto.drawY, foto.width, foto.height);
}

export type ClientRenderResult = {
  blob: Blob;
  layoutVersion: string;
};

export async function renderPodruzhkaCardClient(
  data: PodruzhkaInfographicData
): Promise<ClientRenderResult> {
  if (!data.fotoUrl?.trim()) throw new Error("Колонка foto пуста");

  await ensurePodruzhkaFonts();

  const foto = await fetchProcessedFoto(data.fotoUrl);
  const [templateImg, productImg] = await Promise.all([
    loadImage(S.templateUrl),
    loadImage(foto.dataUrl)
  ]);

  const canvas = document.createElement("canvas");
  canvas.width = S.frame.w;
  canvas.height = S.frame.h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D недоступен");

  await drawPodruzhkaCard(ctx, data, foto, templateImg, productImg);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Не удалось собрать JPEG"))),
      "image/jpeg",
      0.92
    );
  });

  return { blob, layoutVersion: PODRUZHKA_HTML_LAYOUT_VERSION };
}
