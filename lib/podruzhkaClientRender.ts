"use client";

import {
  formatMlHtml,
  PODRUZHKA_HTML_LAYOUT_VERSION,
  PODRUZHKA_HTML_SPEC as S
} from "@/lib/podruzhkaHtmlSpec";
import type { PodruzhkaInfographicData } from "@/lib/podruzhkaTypes";

declare global {
  interface Window {
    html2canvas?: (
      el: HTMLElement,
      opts?: Record<string, unknown>
    ) => Promise<HTMLCanvasElement>;
  }
}

let fontsLinked = false;
let html2canvasPromise: Promise<void> | null = null;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function ensureGoogleFonts(): void {
  if (fontsLinked || typeof document === "undefined") return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = S.googleFontsUrl;
  document.head.appendChild(link);
  fontsLinked = true;
}

function loadHtml2Canvas(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("html2canvas только в браузере"));
  }
  if (window.html2canvas) return Promise.resolve();
  if (html2canvasPromise) return html2canvasPromise;

  html2canvasPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src =
      "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
    script.crossOrigin = "anonymous";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Не загрузился html2canvas"));
    document.head.appendChild(script);
  });
  return html2canvasPromise;
}

function fitFontSize(
  text: string,
  maxSize: number,
  minSize: number,
  weight: number,
  family: string,
  maxWidth: number,
  maxLines: number
): { size: number; lines: string[] } {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return { size: maxSize, lines: [text] };

  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return { size: maxSize, lines: [] };

  const wrap = (size: number): string[] => {
    ctx.font = `${weight} ${size}px ${family}`;
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
  };

  for (let size = maxSize; size >= minSize; size -= 2) {
    const lines = wrap(size);
    ctx.font = `${weight} ${size}px ${family}`;
    const widest = Math.max(...lines.map((ln) => ctx.measureText(ln).width), 0);
    if (widest <= maxWidth) return { size, lines };
  }

  const size = minSize;
  return { size, lines: wrap(size) };
}

function barStyle(x: number, y: number, w: number, h: number, color: string): string {
  return `position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;background:${color};`;
}

function textBlockStyle(
  x: number,
  y: number,
  w: number,
  fontSize: number,
  weight: number,
  family: string,
  color: string,
  lineHeight: number,
  extra = ""
): string {
  return [
    `position:absolute`,
    `left:${x}px`,
    `top:${y}px`,
    `width:${w}px`,
    `margin:0`,
    `padding:0`,
    `font:${weight} ${fontSize}px ${family}`,
    `line-height:${lineHeight}`,
    `color:${color}`,
    `white-space:pre-wrap`,
    `word-break:break-word`,
    extra
  ].join(";");
}

export async function fetchFotoDataUrl(fotoUrl: string): Promise<string> {
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
  const blob = await res.blob();
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("foto: не прочитался blob"));
    reader.readAsDataURL(blob);
  });
}

export function buildPodruzhkaCardElement(
  data: PodruzhkaInfographicData,
  fotoDataUrl: string
): HTMLDivElement {
  const brand = fitFontSize(
    data.brandName.toUpperCase(),
    S.fonts.brand.max,
    S.fonts.brand.min,
    S.fonts.brand.weight,
    S.fonts.brandFamily,
    S.brand.w,
    2
  );

  const model = fitFontSize(
    data.model,
    S.fonts.model.max,
    S.fonts.model.min,
    S.fonts.model.weight,
    S.fonts.bodyFamily,
    S.model.w,
    2
  );

  const typeText = data.productType.trim().toLowerCase();
  const typeFit = typeText
    ? fitFontSize(
        typeText,
        S.fonts.productType.size,
        20,
        S.fonts.productType.weight,
        S.fonts.bodyFamily,
        S.productType.w,
        2
      )
    : { size: S.fonts.productType.size, lines: [] as string[] };

  const notes = data.notes.slice(0, 3);
  const root = document.createElement("div");
  root.className = "podruzhka-card-export";
  root.style.cssText = [
    `position:relative`,
    `width:${S.frame.w}px`,
    `height:${S.frame.h}px`,
    `overflow:hidden`,
    `background:${S.colors.bg}`,
    `font-family:${S.fonts.bodyFamily}`
  ].join(";");

  const parts: string[] = [
    `<img src="${S.templateUrl}" alt="" crossorigin="anonymous" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;" />`,
    `<div style="${barStyle(S.notesPinkBar.x, S.notesPinkBar.y, S.notesPinkBar.w, S.notesPinkBar.h, S.colors.accent)}"></div>`,
    `<div style="${barStyle(S.mlPinkBar.x, S.mlPinkBar.y, S.mlPinkBar.w, S.mlPinkBar.h, S.colors.accent)}"></div>`
  ];

  parts.push(
    `<div style="${textBlockStyle(S.brand.x, S.brand.y, S.brand.w, brand.size, S.fonts.brand.weight, S.fonts.brandFamily, S.colors.text, S.fonts.brand.lineHeight, "text-transform:uppercase;")}">${brand.lines.map(escapeHtml).join("<br/>")}</div>`
  );

  if (typeFit.lines.length) {
    parts.push(
      `<div style="${textBlockStyle(S.productType.x, S.productType.y, S.productType.w, typeFit.size, S.fonts.productType.weight, S.fonts.bodyFamily, S.colors.muted, S.fonts.productType.lineHeight)}">${typeFit.lines.map(escapeHtml).join("<br/>")}</div>`
    );
  }

  parts.push(
    `<div style="${textBlockStyle(S.model.x, S.model.y, S.model.w, model.size, S.fonts.model.weight, S.fonts.bodyFamily, S.colors.text, S.fonts.model.lineHeight)}">${model.lines.map(escapeHtml).join("<br/>")}</div>`
  );

  for (let i = 0; i < notes.length; i++) {
    const n = notes[i]!;
    const slot = S.notes[i]!;
    parts.push(
      `<div style="${textBlockStyle(S.textX, slot.titleY, S.model.w, S.fonts.noteTitle.size, S.fonts.noteTitle.weight, S.fonts.bodyFamily, S.colors.accent, S.fonts.noteTitle.lineHeight, "text-transform:uppercase;")}">${escapeHtml(n.title)}</div>`,
      `<div style="${textBlockStyle(S.textX, slot.descY, S.model.w, S.fonts.noteDesc.size, S.fonts.noteDesc.weight, S.fonts.bodyFamily, S.colors.muted, S.fonts.noteDesc.lineHeight)}">${escapeHtml(n.desc)}</div>`
    );
    if (slot.sepY != null) {
      parts.push(
        `<div style="${barStyle(S.textX, slot.sepY, S.separator.w, S.separator.h, S.colors.separator)}"></div>`
      );
    }
  }

  const ml = formatMlHtml(data.ml);
  if (ml) {
    parts.push(
      `<div style="${textBlockStyle(S.ml.x, S.ml.y, S.ml.w, S.fonts.ml.size, S.fonts.ml.weight, S.fonts.bodyFamily, S.colors.text, S.fonts.ml.lineHeight, "font-style:italic;")}">${escapeHtml(ml)}</div>`
    );
  }

  parts.push(
    `<div style="position:absolute;left:${S.product.x}px;top:${S.product.y}px;width:${S.product.w}px;height:${S.product.h}px;overflow:hidden;">` +
      `<img src="${fotoDataUrl}" alt="" crossorigin="anonymous" style="width:100%;height:100%;object-fit:contain;object-position:right bottom;display:block;" />` +
      `</div>`
  );

  root.innerHTML = parts.join("");
  return root;
}

async function waitForImages(el: HTMLElement): Promise<void> {
  const imgs = Array.from(el.querySelectorAll("img"));
  await Promise.all(
    imgs.map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete && img.naturalWidth > 0) {
            resolve();
            return;
          }
          img.onload = () => resolve();
          img.onerror = () => resolve();
        })
    )
  );
  await document.fonts.ready;
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

export type ClientRenderResult = {
  blob: Blob;
  layoutVersion: string;
};

export async function renderPodruzhkaCardClient(
  data: PodruzhkaInfographicData
): Promise<ClientRenderResult> {
  if (!data.fotoUrl?.trim()) throw new Error("Колонка foto пуста");

  ensureGoogleFonts();
  await loadHtml2Canvas();

  const fotoDataUrl = await fetchFotoDataUrl(data.fotoUrl);
  const card = buildPodruzhkaCardElement(data, fotoDataUrl);

  const mount = document.createElement("div");
  mount.style.cssText =
    "position:fixed;left:-10000px;top:0;z-index:-1;pointer-events:none;";
  mount.appendChild(card);
  document.body.appendChild(mount);

  try {
    await waitForImages(card);
    const canvas = await window.html2canvas!(card, {
      scale: 1,
      backgroundColor: S.colors.bg,
      useCORS: true,
      logging: false,
      width: S.frame.w,
      height: S.frame.h,
      scrollX: 0,
      scrollY: 0,
      windowWidth: S.frame.w,
      windowHeight: S.frame.h
    });

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("Не удалось собрать JPEG"))),
        "image/jpeg",
        0.92
      );
    });

    return { blob, layoutVersion: PODRUZHKA_HTML_LAYOUT_VERSION };
  } finally {
    document.body.removeChild(mount);
  }
}
