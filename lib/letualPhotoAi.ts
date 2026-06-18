import { fetchPodruzhkaProductImageDetailed } from "@/lib/podruzhkaImageFetch";
import {
  normalizeLetualSourceUrl,
  normalizeLetualFotoUrls,
  rankLetualUrlsByTechnicalQuality,
  type LetualTechnicalScore
} from "@/lib/letualFotoQuality";

export type LetualPhotoScore = {
  url: string;
  score: number;
  suitable: boolean;
  hasBox: boolean;
  hasInfographic: boolean;
  isFrontal: boolean;
  quality: number;
  sharpness: number;
  pixels: number;
  reason: string;
};

type VisionJson = {
  suitable?: boolean;
  has_box?: boolean;
  has_infographic?: boolean;
  is_frontal?: boolean;
  quality?: number;
  reason?: string;
};

const SYSTEM = `Ты эксперт по требованиям маркетплейса Летуаль к главному фото товара.

Оцени изображение СТРОГО:

is_frontal — true ТОЛЬКО если товар стоит прямо к зрителю:
- лицевая сторона параллельна камере, этикетка/логотип по центру;
- флакон НЕ повёрнут влево/вправо, НЕ в ракурсе 3/4, не видна боковая грань шире 10%;
- если видно, что товар развёрнут вправо или влево — is_frontal: false.

has_box — картонная коробка рядом или товар в коробке.
has_infographic — текст, бейджи, коллаж, lifestyle, модель, инфографика.
quality — 0–100: резкость и чёткость (мутное, размытое, JPEG-артефакты → ниже 45; чёткий packshot → 75+).

suitable — true ТОЛЬКО если: is_frontal=true, has_box=false, has_infographic=false, quality>=50.

JSON: {"suitable":true,"has_box":false,"has_infographic":false,"is_frontal":true,"quality":82,"reason":"..."}`;

const MIN_QUALITY = 50;
const MIN_SHARPNESS = 18;
const VISION_TOP = 10;

async function imageToDataUrl(url: string): Promise<string | null> {
  const norm = normalizeLetualSourceUrl(url);
  const fetched = await fetchPodruzhkaProductImageDetailed(norm);
  if (!fetched.buf?.length) return null;
  const b64 = fetched.buf.toString("base64");
  const mime = norm.toLowerCase().includes(".png") ? "image/png" : "image/jpeg";
  return `data:${mime};base64,${b64}`;
}

function combineScore(
  vision: VisionJson,
  technical: LetualTechnicalScore | undefined
): LetualPhotoScore {
  const quality = Math.max(0, Math.min(100, Number(vision.quality) || 0));
  const hasBox = Boolean(vision.has_box);
  const hasInfographic = Boolean(vision.has_infographic);
  const isFrontal = Boolean(vision.is_frontal);
  const sharpness = technical?.sharpness ?? 0;
  const pixels = technical?.pixels ?? 0;

  const suitable =
    isFrontal &&
    !hasBox &&
    !hasInfographic &&
    quality >= MIN_QUALITY &&
    sharpness >= MIN_SHARPNESS;

  let score = quality * 4;
  score += Math.min(sharpness / 2, 60);
  score += Math.min(pixels / 5000, 50);
  if (isFrontal) score += 80;
  else score -= 150;
  if (!hasBox) score += 15;
  if (!hasInfographic) score += 15;
  if (hasBox) score -= 80;
  if (hasInfographic) score -= 100;
  if (quality < MIN_QUALITY) score -= 40;
  if (sharpness < MIN_SHARPNESS) score -= 30;

  let reason = String(vision.reason ?? "").trim();
  if (!isFrontal && !reason.includes("фронт")) {
    reason = reason ? `${reason}; не фронтальный ракурс` : "Не фронтальный ракурс";
  }
  if (quality < MIN_QUALITY) {
    reason = reason ? `${reason}; низкое качество` : "Низкое качество / мутное";
  }

  return {
    url: technical?.url ?? "",
    score,
    suitable,
    hasBox,
    hasInfographic,
    isFrontal,
    quality,
    sharpness,
    pixels,
    reason: reason || (suitable ? "Подходит" : "Не подходит")
  };
}

async function scoreOneUrl(
  url: string,
  technical: LetualTechnicalScore | undefined,
  openaiApiKey: string,
  model: string
): Promise<LetualPhotoScore> {
  const norm = normalizeLetualSourceUrl(url);
  const dataUrl = await imageToDataUrl(norm);
  if (!dataUrl) {
    return {
      url: norm,
      score: 0,
      suitable: false,
      hasBox: true,
      hasInfographic: true,
      isFrontal: false,
      quality: 0,
      sharpness: technical?.sharpness ?? 0,
      pixels: technical?.pixels ?? 0,
      reason: "Не удалось скачать"
    };
  }

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openaiApiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      temperature: 0.05,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Оцени packshot для главного фото Летуаль. Фронтальный ракурс обязателен."
            },
            { type: "image_url", image_url: { url: dataUrl, detail: "high" } }
          ]
        }
      ]
    }),
    signal: AbortSignal.timeout(60_000)
  });

  if (!res.ok) {
    const err = await res.text().catch(() => "");
    return {
      url: norm,
      score: 0,
      suitable: false,
      hasBox: true,
      hasInfographic: true,
      isFrontal: false,
      quality: 0,
      sharpness: technical?.sharpness ?? 0,
      pixels: technical?.pixels ?? 0,
      reason: `OpenAI ${res.status}: ${err.slice(0, 120)}`
    };
  }

  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  let parsed: VisionJson = {};
  try {
    parsed = JSON.parse(json.choices?.[0]?.message?.content ?? "{}") as VisionJson;
  } catch {
    parsed = {};
  }

  const merged = combineScore(parsed, technical);
  merged.url = norm;
  return merged;
}

export function pickBestFromRanked(ranked: LetualPhotoScore[]): LetualPhotoScore | undefined {
  const frontalOk = ranked.filter((r) => r.suitable && r.isFrontal);
  if (frontalOk.length) {
    return [...frontalOk].sort((a, b) => b.score - a.score)[0];
  }

  const frontalAny = ranked.filter((r) => r.isFrontal && !r.hasBox && !r.hasInfographic);
  if (frontalAny.length) {
    return [...frontalAny].sort((a, b) => b.score - a.score)[0];
  }

  return [...ranked].sort((a, b) => b.score - a.score)[0];
}

/** Выбрать лучшее фото: сначала тех. качество, затем AI (фронт + резкость). */
export async function pickBestLetualPhoto(
  urls: string[],
  openaiApiKey: string,
  model = "gpt-4o-mini"
): Promise<{ url: string; ranked: LetualPhotoScore[] }> {
  const list = normalizeLetualFotoUrls(urls);
  if (!list.length) return { url: "", ranked: [] };

  const technicalRanked = await rankLetualUrlsByTechnicalQuality(list);
  const technicalByUrl = new Map(technicalRanked.map((t) => [t.url, t]));

  const forVision =
    technicalRanked.length > 0
      ? technicalRanked.slice(0, VISION_TOP).map((t) => t.url)
      : list.slice(0, VISION_TOP);

  const ranked = await Promise.all(
    forVision.map((url) =>
      scoreOneUrl(url, technicalByUrl.get(normalizeLetualSourceUrl(url)), openaiApiKey, model)
    )
  );
  ranked.sort((a, b) => b.score - a.score);

  const best = pickBestFromRanked(ranked);
  return { url: best?.url ?? forVision[0] ?? "", ranked };
}
