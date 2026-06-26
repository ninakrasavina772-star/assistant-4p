import fs from "fs";
import path from "path";
import { PODRUZHKA_COMPOSITION_VISION_PROMPT } from "@/lib/podruzhkaCompositionPrompt";
import { openaiChatCompletionsUrl, openaiFetch, readOpenAiError } from "@/lib/openaiFetch";

const REFERENCE_PATH = path.join(process.cwd(), "public", "podruzhka", "reference-target.png");

export type VisionLayoutAdjustment = {
  brandYOffset: number;
  brandXOffset: number;
  productTypeYOffset: number;
  modelYOffset: number;
  accentYOffset: number;
  notesStartYOffset: number;
  noteBlockHeight?: number;
  productTopYOffset: number;
  productBottomYOffset: number;
  productLeftOffset?: number;
  productScaleMultiplier: number;
  brandFontDelta: number;
  modelFontDelta?: number;
};

export type VisionReviewResult = {
  overallScore: number;
  needsAdjustment: boolean;
  productDominanceVerdict: "product_too_small" | "product_ok" | "brand_too_large";
  photoPositionVerdict: "too_high" | "too_low" | "ok";
  textSpacingVerdict: "too_tight" | "too_loose" | "ok";
  reasoning: string;
  adjustment: VisionLayoutAdjustment;
};

const BASE_ADJ: VisionLayoutAdjustment = {
  brandYOffset: 0,
  brandXOffset: 0,
  productTypeYOffset: 0,
  modelYOffset: 0,
  accentYOffset: 0,
  notesStartYOffset: 0,
  productTopYOffset: 0,
  productBottomYOffset: 0,
  productLeftOffset: 0,
  productScaleMultiplier: 1,
  brandFontDelta: 0,
  modelFontDelta: 0
};

async function callGPT4VisionLayout(
  renderedBuffer: Buffer,
  openaiKey: string
): Promise<Omit<VisionReviewResult, "adjustment">> {
  const refBuffer = fs.existsSync(REFERENCE_PATH)
    ? await fs.promises.readFile(REFERENCE_PATH)
    : null;

  const contentParts: object[] = [
    { type: "text", text: PODRUZHKA_COMPOSITION_VISION_PROMPT }
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

  const resp = await openaiFetch(openaiChatCompletionsUrl(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openaiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4o",
      max_tokens: 400,
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

  if (v.productDominanceVerdict === "product_too_small") {
    a.productScaleMultiplier = Math.min(1.35, a.productScaleMultiplier + 0.12);
    a.productTopYOffset -= 15;
  } else if (v.productDominanceVerdict === "brand_too_large") {
    a.brandFontDelta -= 6;
    a.productScaleMultiplier = Math.min(1.35, a.productScaleMultiplier + 0.08);
  }

  if (v.photoPositionVerdict === "too_high") {
    a.productBottomYOffset += 25;
  } else if (v.photoPositionVerdict === "too_low") {
    a.productBottomYOffset -= 25;
  }

  if (v.textSpacingVerdict === "too_loose") {
    a.productTypeYOffset -= 8;
    a.modelYOffset -= 8;
  } else if (v.textSpacingVerdict === "too_tight") {
    a.productTypeYOffset += 8;
    a.modelYOffset += 8;
  }

  return a;
}

export async function reviewAgainstReference(
  renderedBuffer: Buffer,
  openaiKey: string,
  prevAdj?: VisionLayoutAdjustment
): Promise<VisionReviewResult> {
  const verdict = await callGPT4VisionLayout(renderedBuffer, openaiKey);
  const adjustment = verdictToAdjustment(verdict, prevAdj);
  const needsAdjustment =
    verdict.needsAdjustment ||
    verdict.overallScore < 8 ||
    verdict.productDominanceVerdict !== "product_ok";

  return {
    ...verdict,
    needsAdjustment,
    adjustment
  };
}
