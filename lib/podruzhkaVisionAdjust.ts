import fs from "fs";
import path from "path";

const REFERENCE_PATH = path.join(process.cwd(), "public", "podruzhka", "reference-target.png");

export type VisionPhotoAdjustment = {
  fillHeightRatio: number;
  minHeightRatio: number;
  /** true = масштабировать по высоте зоны (для landscape коробок) */
  forceHeightFill: boolean;
  /** смещение нижней точки фото, px (+100 = поднять выше) */
  bottomOffsetPx: number;
};

type VisionResult = {
  photoScore: number; // 1-10
  photoSizeVerdict: "too_small" | "too_large" | "ok";
  photoPositionVerdict: "too_high" | "too_low" | "ok";
  reasoning: string;
};

async function callGPT4Vision(
  renderedBuffer: Buffer,
  openaiKey: string
): Promise<VisionResult> {
  const refBuffer = fs.existsSync(REFERENCE_PATH)
    ? await fs.promises.readFile(REFERENCE_PATH)
    : null;

  const renderedB64 = renderedBuffer.toString("base64");

  const contentParts: object[] = [];

  if (refBuffer) {
    contentParts.push({
      type: "text",
      text: "REFERENCE (эталонный макет — сюда должно быть похоже):"
    });
    contentParts.push({
      type: "image_url",
      image_url: { url: `data:image/png;base64,${refBuffer.toString("base64")}`, detail: "low" }
    });
  }

  contentParts.push({ type: "text", text: "ТЕКУЩИЙ РЕНДЕР (оцени):" });
  contentParts.push({
    type: "image_url",
    image_url: { url: `data:image/jpeg;base64,${renderedB64}`, detail: "low" }
  });

  contentParts.push({
    type: "text",
    text: `Ты эксперт по верстке карточек товаров. Сравни текущий рендер с референсом.
Оцени только фото товара (справа).
Верни ТОЛЬКО валидный JSON без markdown:
{
  "photoScore": 1-10,
  "photoSizeVerdict": "too_small" | "too_large" | "ok",
  "photoPositionVerdict": "too_high" | "too_low" | "ok",
  "reasoning": "кратко 1 предложение"
}
Критерии:
- too_small: фото занимает менее 55% высоты карточки
- too_large: фото выходит за пределы / обрезано неожиданно
- too_high: основная масса фото в верхней половине
- too_low: фото прижато к самому низу с большим пустым верхом`
  });

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openaiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4o",
      max_tokens: 200,
      temperature: 0,
      messages: [{ role: "user", content: contentParts }]
    })
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`GPT-4o Vision error ${resp.status}: ${err.slice(0, 200)}`);
  }

  const json = (await resp.json()) as { choices: { message: { content: string } }[] };
  const raw = json.choices[0]?.message?.content ?? "{}";
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Vision: не удалось разобрать JSON: " + raw.slice(0, 100));

  return JSON.parse(match[0]) as VisionResult;
}

/**
 * По результату Vision возвращает скорректированные параметры фото.
 * Вызывается после первого рендера, перед вторым.
 */
export async function getVisionAdjustment(
  renderedBuffer: Buffer,
  openaiKey: string
): Promise<{ adjustment: VisionPhotoAdjustment; verdict: VisionResult }> {
  const verdict = await callGPT4Vision(renderedBuffer, openaiKey);

  const adjustment: VisionPhotoAdjustment = {
    fillHeightRatio: 0.98,
    minHeightRatio: 0.88,
    forceHeightFill: false,
    bottomOffsetPx: 0
  };

  if (verdict.photoSizeVerdict === "too_small") {
    // Разрешить масштаб по высоте (landscape коробки)
    adjustment.forceHeightFill = true;
    adjustment.minHeightRatio = 0.92;
  } else if (verdict.photoSizeVerdict === "too_large") {
    adjustment.fillHeightRatio = 0.80;
    adjustment.minHeightRatio = 0.70;
  }

  if (verdict.photoPositionVerdict === "too_high") {
    adjustment.bottomOffsetPx = -60;
  } else if (verdict.photoPositionVerdict === "too_low") {
    adjustment.bottomOffsetPx = 60;
  }

  return { adjustment, verdict };
}
