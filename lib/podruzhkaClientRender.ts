"use client";

import {
  formatMlHtml,
  PODRUZHKA_HTML_LAYOUT_VERSION,
  PODRUZHKA_HTML_SPEC as S
} from "@/lib/podruzhkaHtmlSpec";
import { PODRUZHKA_FIGMA as F } from "@/lib/podruzhkaFigmaLayout";
import { measureFromCanvas2D } from "@/lib/podruzhkaBrandLayout";
import { computeHeaderStack, drawTextBlock } from "@/lib/podruzhkaHeaderLayout";
import { PODRUZHKA_PRODUCT_VISUAL } from "@/lib/podruzhkaProductPlacement";
import {
  PODRUZHKA_COSMETICS_LAYOUT_VERSION,
  PODRUZHKA_COSMETICS_NOTE_DESC_SIZE,
  PODRUZHKA_COSMETICS_NOTE_TITLE_SIZE,
  type PodruzhkaRenderProfile
} from "@/lib/podruzhkaCosmeticsLayout";
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

export async function fetchProcessedFoto(
  fotoUrl: string,
  profile: PodruzhkaRenderProfile = "perfume"
): Promise<ProcessedFoto> {
  const q = encodeURIComponent(fotoUrl.trim());
  const p = profile === "cosmetics" ? "&profile=cosmetics" : "";
  const res = await fetch(`/api/podruzhka/foto?url=${q}${p}`);
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

  const drawX = Number(res.headers.get("X-Podruzhka-Draw-X") ?? PODRUZHKA_PRODUCT_VISUAL.x);
  const drawY = Number(res.headers.get("X-Podruzhka-Draw-Y") ?? PODRUZHKA_PRODUCT_VISUAL.y);
  const width = Number(res.headers.get("X-Podruzhka-Width") ?? PODRUZHKA_PRODUCT_VISUAL.w);
  const height = Number(
    res.headers.get("X-Podruzhka-Height") ??
      PODRUZHKA_PRODUCT_VISUAL.bottom - PODRUZHKA_PRODUCT_VISUAL.y
  );
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

  const header = computeHeaderStack(measureFromCanvas2D(ctx), {
    brandName: data.brandName,
    productType: data.productType,
    model: data.model,
    brandFontForSize: brandFont,
    bodyFontForSize: interFont,
    brandLineHeight: S.fonts.brand.lineHeight,
    typeLineHeight: S.fonts.productType.lineHeight,
    modelLineHeight: S.fonts.model.lineHeight,
    typeSize: S.fonts.productType.size,
    modelMaxSize: S.fonts.model.max,
    modelMinSize: S.fonts.model.min
  });

  drawTextBlock(ctx, header.brand, F.brand.x, brandFont(header.brand.size), S.colors.text);
  if (header.productType.lines.length) {
    drawTextBlock(
      ctx,
      header.productType,
      F.productType.x,
      interFont(S.fonts.productType.size, 400),
      S.colors.muted
    );
  }
  drawTextBlock(
    ctx,
    header.model,
    F.model.x,
    interFont(header.model.size, 800),
    S.colors.text
  );

  drawBar(
    ctx,
    F.notesPinkBar.x,
    header.notesPinkBarY,
    F.notesPinkBar.w,
    F.notesPinkBar.h,
    S.colors.accent
  );
  const mlFormatted = formatMlHtml(data.ml);
  if (mlFormatted) {
    drawBar(ctx, F.mlPinkBar.x, F.mlPinkBar.y, F.mlPinkBar.w, F.mlPinkBar.h, S.colors.accent);
  }

  const notes = data.notes.slice(0, 3);
  const profile = data.renderProfile ?? "perfume";
  const noteTitleSize =
    profile === "cosmetics" ? PODRUZHKA_COSMETICS_NOTE_TITLE_SIZE : S.fonts.noteTitle.size;
  const noteDescSize =
    profile === "cosmetics" ? PODRUZHKA_COSMETICS_NOTE_DESC_SIZE : S.fonts.noteDesc.size;

  for (let i = 0; i < notes.length; i++) {
    const n = notes[i]!;
    const slot = F.notes[i]!;

    ctx.fillStyle = S.colors.accent;
    ctx.font = interFont(noteTitleSize, 700);
    ctx.textBaseline = "top";
    ctx.fillText(n.title.toUpperCase(), F.textX, slot.titleY);

    ctx.fillStyle = S.colors.muted;
    ctx.font = interFont(noteDescSize, 400);
    ctx.fillText(n.desc, F.textX, slot.descY);

    if (slot.sepY != null) {
      drawBar(ctx, F.textX, slot.sepY, F.separator.w, F.separator.h, S.colors.separator);
    }
  }

  const ml = formatMlHtml(data.ml);
  if (ml) {
    ctx.fillStyle = S.colors.text;
    ctx.font = interFont(S.fonts.ml.size, 500, true);
    ctx.textBaseline = "top";
    ctx.fillText(ml, F.ml.x, F.ml.y);
  }

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

  const profile = data.renderProfile ?? "perfume";
  const foto = await fetchProcessedFoto(data.fotoUrl, profile);
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

  return {
    blob,
    layoutVersion:
      profile === "cosmetics" ? PODRUZHKA_COSMETICS_LAYOUT_VERSION : PODRUZHKA_HTML_LAYOUT_VERSION
  };
}
