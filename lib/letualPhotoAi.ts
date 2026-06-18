import { fetchPodruzhkaProductImageDetailed } from "@/lib/podruzhkaImageFetch";

export type LetualPhotoScore = {
  url: string;
  score: number;
  suitable: boolean;
  hasBox: boolean;
  hasInfographic: boolean;
  isFrontal: boolean;
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

Оцени изображение:
- suitable: подходит как главное фото (флакон/тюбик/банка БЕЗ коробки, фронтальный ракурс, без инфографики, желательно белый/светлый фон)
- has_box: видна картонная коробка рядом или товар в коробке
- has_infographic: есть текст, бейджи, коллаж, lifestyle, модель, инфографика
- is_frontal: товар стоит прямо, фронтально
- quality: 0-100 (резкость, читаемость товара)
- reason: кратко по-русски

JSON: {"suitable":true,"has_box":false,"has_infographic":false,"is_frontal":true,"quality":85,"reason":"..."}`;

async function imageToDataUrl(url: string): Promise<string | null> {
  const fetched = await fetchPodruzhkaProductImageDetailed(url);
  if (!fetched.buf?.length) return null;
  const b64 = fetched.buf.toString("base64");
  const mime = url.toLowerCase().includes(".png") ? "image/png" : "image/jpeg";
  return `data:${mime};base64,${b64}`;
}

async function scoreOneUrl(
  url: string,
  openaiApiKey: string,
  model: string
): Promise<LetualPhotoScore> {
  const dataUrl = await imageToDataUrl(url);
  if (!dataUrl) {
    return {
      url,
      score: 0,
      suitable: false,
      hasBox: true,
      hasInfographic: true,
      isFrontal: false,
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
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: [
            { type: "text", text: "Оцени это фото для главного фото Летуаль." },
            { type: "image_url", image_url: { url: dataUrl, detail: "low" } }
          ]
        }
      ]
    }),
    signal: AbortSignal.timeout(45_000)
  });

  if (!res.ok) {
    const err = await res.text().catch(() => "");
    return {
      url,
      score: 0,
      suitable: false,
      hasBox: true,
      hasInfographic: true,
      isFrontal: false,
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

  const quality = Math.max(0, Math.min(100, Number(parsed.quality) || 0));
  const suitable = Boolean(parsed.suitable);
  const hasBox = Boolean(parsed.has_box);
  const hasInfographic = Boolean(parsed.has_infographic);
  const isFrontal = Boolean(parsed.is_frontal);

  let score = quality;
  if (suitable) score += 40;
  if (!hasBox) score += 15;
  if (!hasInfographic) score += 15;
  if (isFrontal) score += 10;
  if (hasBox) score -= 50;
  if (hasInfographic) score -= 60;

  return {
    url,
    score,
    suitable,
    hasBox,
    hasInfographic,
    isFrontal,
    reason: String(parsed.reason ?? "").trim() || (suitable ? "Подходит" : "Не подходит")
  };
}

function heuristicScore(url: string): number {
  const u = url.toLowerCase();
  let s = 10;
  if (/\/huge\//.test(u)) s += 25;
  if (/4stand\.com|4partners/i.test(u)) s += 10;
  if (/\.webp(?:\?|$)/.test(u)) s += 5;
  if (/lifestyle|model|banner|infographic|collage|set|gift|box/i.test(u)) s -= 40;
  if (/thumb|_small|_mini|preview/i.test(u)) s -= 30;
  return s;
}

/** Выбрать лучшее фото из списка URL с помощью OpenAI Vision. */
export async function pickBestLetualPhoto(
  urls: string[],
  openaiApiKey: string,
  model = "gpt-4o-mini"
): Promise<{ url: string; ranked: LetualPhotoScore[] }> {
  const list = [...new Set(urls.map((u) => u.trim()).filter((u) => u.startsWith("http")))];
  if (!list.length) return { url: "", ranked: [] };
  if (list.length === 1) {
    const one = await scoreOneUrl(list[0]!, openaiApiKey, model);
    return { url: one.suitable ? one.url : list[0]!, ranked: [one] };
  }

  const prelim =
    list.length <= 8
      ? list
      : [...list].sort((a, b) => heuristicScore(b) - heuristicScore(a)).slice(0, 8);

  const ranked = await Promise.all(
    prelim.map((url) => scoreOneUrl(url, openaiApiKey, model))
  );
  ranked.sort((a, b) => b.score - a.score);

  const best = ranked.find((r) => r.suitable && !r.hasBox && !r.hasInfographic) ?? ranked[0];
  return { url: best?.url ?? "", ranked };
}
