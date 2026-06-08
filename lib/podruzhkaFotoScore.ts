"use client";

import { analyzePerfumePixels, type PerfumeImageAnalysis } from "@/lib/podruzhkaFotoAnalyzeCore";

export type { PerfumeImageKind, PerfumeImageAnalysis } from "@/lib/podruzhkaFotoAnalyzeCore";

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image load failed"));
    img.src = src;
  });
}

/** Клиентский анализ (fallback; основной путь — API /api/podruzhka/foto/pick). */
export async function analyzePerfumeFotoImage(url: string): Promise<PerfumeImageAnalysis> {
  const img = await loadImage(url);
  const canvas = document.createElement("canvas");
  const w = 180;
  const h = Math.max(1, Math.round((w * img.height) / img.width));
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return { kind: "other", score: 0, whiteRatio: 0, leftShare: 0, rightShare: 0, peakCount: 0 };
  }

  ctx.drawImage(img, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  return analyzePerfumePixels(data, w, h);
}
