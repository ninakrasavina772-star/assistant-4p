import sharp from "sharp";
import { PRODUCT_CARD_H, PRODUCT_CARD_W } from "@/lib/templateGenerator/photoCompose";

/** Сгенерировать тематический фон через OpenAI Images (без флакона на картинке). */
export async function generateThemedBackground(
  apiKey: string,
  prompt: string,
  model = "dall-e-3"
): Promise<Buffer> {
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    signal: AbortSignal.timeout(120_000),
    body: JSON.stringify({
      model,
      prompt,
      n: 1,
      size: "1024x1792",
      quality: "hd",
      response_format: "b64_json"
    })
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`OpenAI Images ${res.status}${errText ? `: ${errText.slice(0, 200)}` : ""}`);
  }

  const data = (await res.json()) as {
    data?: { b64_json?: string }[];
  };
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) throw new Error("OpenAI Images: пустой ответ");

  const raw = Buffer.from(b64, "base64");
  return sharp(raw)
    .resize(PRODUCT_CARD_W, PRODUCT_CARD_H, { fit: "cover", position: "centre" })
    .jpeg({ quality: 92, mozjpeg: true })
    .toBuffer();
}
