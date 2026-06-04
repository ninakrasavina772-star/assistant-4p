import fs from "fs";
import path from "path";
import { PODRUZHKA_REFERENCE } from "@/lib/podruzhkaReferenceSpec";

const REFERENCE_PATH = path.join(process.cwd(), "public", "podruzhka", "reference-target.png");

/** Смещения от базовой сетки (reference spec) — возвращает GPT-4o Vision */
export type VisionLayoutAdjustment = {
  brandYOffset: number;
  productTypeYOffset: number;
  modelYOffset: number;
  accentYOffset: number;
  notesStartYOffset: number;
  noteBlockHeight?: number;
  productTopYOffset: number;
  productBottomYOffset: number;
  fillHeightRatio: number;
  minHeightRatio: number;
  bottomOffsetPx: number;
};

export type VisionReviewResult = {
  overallScore: number;
  needsAdjustment: boolean;
  brandVerdict: "too_high" | "too_low" | "ok";
  textSpacingVerdict: "too_tight" | "too_loose" | "ok";
  photoSizeVerdict: "too_small" | "too_large" | "ok";
  photoPositionVerdict: "too_high" | "too_low" | "ok";
  reasoning: string;
  adjustment: VisionLayoutAdjustment;
};

const BASE_ADJ: VisionLayoutAdjustment = {
  brandYOffset: 0,
  productTypeYOffset: 0,
  modelYOffset: 0,
  accentYOffset: 0,
  notesStartYOffset: 0,
  productTopYOffset: 0,
  productBottomYOffset: 0,
  fillHeightRatio: PODRUZHKA_REFERENCE.product.fillHeight,
  minHeightRatio: PODRUZHKA_REFERENCE.product.minHeightRatio,
  bottomOffsetPx: 0
};

async function callGPT4VisionLayout(
  renderedBuffer: Buffer,
  openaiKey: string
): Promise<Omit<VisionReviewResult, "adjustment">> {
  const refBuffer = fs.existsSync(REFERENCE_PATH)
    ? await fs.promises.readFile(REFERENCE_PATH)
    : null;

  const contentParts: object[] = [
    {
      type: "text",
      text: `ЭТАЛОН (reference) — идеальная карточка 1000×1400. ТЕКУЩИЙ РЕНДЕР — нужно приблизить к эталону.
Сравни ВСЁ: отступ бренда от шапки, плотность текстового блока слева, размер и вертикаль фото справа, блок нот, «мл» внизу.
Верни ТОЛЬКО JSON (без markdown):
{
  "overallScore": 1-10,
  "needsAdjustment": true/false,
  "brandVerdict": "too_high"|"too_low"|"ok",
  "textSpacingVerdict": "too_tight"|"too_loose"|"ok",
  "photoSizeVerdict": "too_small"|"too_large"|"ok",
  "photoPositionVerdict": "too_high"|"too_low"|"ok",
  "reasoning": "одно предложение по-русски"
}
needsAdjustment=true если overallScore < 8.`
    }
  ];

  if (refBuffer) {
    contentParts.push({
      type: "image_url",
      image_url: { url: `data:image/png;base64,${refBuffer.toString("base64")}`, detail: "high" }
    });
  }

  contentParts.push({
    type: "image_url",
    image_url: { url: `data:image/jpeg;base64,${renderedBuffer.toString("base64")}`, detail: "high" }
  });

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openaiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4o",
      max_tokens: 350,
      temperature: 0,
      messages: [{ role: "user", content: contentParts }]
    })
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`GPT-4o Vision ${resp.status}: ${err.slice(0, 300)}`);
  }

  const json = (await resp.json()) as { choices: { message: { content: string } }[] };
  const raw = json.choices[0]?.message?.content ?? "{}";
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Vision JSON: " + raw.slice(0, 120));

  return JSON.parse(match[0]) as Omit<VisionReviewResult, "adjustment">;
}

function verdictToAdjustment(
  v: Omit<VisionReviewResult, "adjustment">,
  prev?: VisionLayoutAdjustment
): VisionLayoutAdjustment {
  const a: VisionLayoutAdjustment = { ...BASE_ADJ, ...prev };

  if (v.brandVerdict === "too_high") a.brandYOffset += 28;
  else if (v.brandVerdict === "too_low") a.brandYOffset -= 20;

  if (v.textSpacingVerdict === "too_loose") {
    a.productTypeYOffset -= 12;
    a.modelYOffset -= 16;
    a.accentYOffset -= 20;
    a.notesStartYOffset -= 24;
    if (!a.noteBlockHeight) a.noteBlockHeight = PODRUZHKA_REFERENCE.text.noteBlockHeight - 8;
  } else if (v.textSpacingVerdict === "too_tight") {
    a.productTypeYOffset += 10;
    a.modelYOffset += 12;
    a.accentYOffset += 14;
    a.notesStartYOffset += 16;
  }

  if (v.photoSizeVerdict === "too_small") {
    a.minHeightRatio = Math.min(0.97, a.minHeightRatio + 0.04);
    a.fillHeightRatio = Math.min(0.99, a.fillHeightRatio + 0.03);
    a.productTopYOffset -= 20;
  } else if (v.photoSizeVerdict === "too_large") {
    a.minHeightRatio = Math.max(0.82, a.minHeightRatio - 0.06);
    a.fillHeightRatio = Math.max(0.85, a.fillHeightRatio - 0.05);
  }

  if (v.photoPositionVerdict === "too_high") a.bottomOffsetPx += 50;
  else if (v.photoPositionVerdict === "too_low") a.bottomOffsetPx -= 50;

  return a;
}

/**
 * Сравнение с reference-target + корректировки всей сетки (текст + фото).
 */
export async function reviewAgainstReference(
  renderedBuffer: Buffer,
  openaiKey: string,
  prevAdj?: VisionLayoutAdjustment
): Promise<VisionReviewResult> {
  const verdict = await callGPT4VisionLayout(renderedBuffer, openaiKey);
  const adjustment = verdictToAdjustment(verdict, prevAdj);
  return { ...verdict, adjustment };
}

/** @deprecated */
export type VisionPhotoAdjustment = Pick<
  VisionLayoutAdjustment,
  "fillHeightRatio" | "minHeightRatio" | "bottomOffsetPx"
> & { forceHeightFill?: boolean };

export async function getVisionAdjustment(
  renderedBuffer: Buffer,
  openaiKey: string
): Promise<{ adjustment: VisionPhotoAdjustment; verdict: { reasoning: string } }> {
  const r = await reviewAgainstReference(renderedBuffer, openaiKey);
  return {
    adjustment: {
      fillHeightRatio: r.adjustment.fillHeightRatio,
      minHeightRatio: r.adjustment.minHeightRatio,
      bottomOffsetPx: r.adjustment.bottomOffsetPx,
      forceHeightFill: r.photoSizeVerdict === "too_small"
    },
    verdict: { reasoning: r.reasoning }
  };
}
