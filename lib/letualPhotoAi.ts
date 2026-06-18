import {
  fetchLetualImageDetailed,
  normalizeLetualSourceUrl,
  filterDownloadableLetualUrls,
  rankLetualUrlsByTechnicalQuality,
  type LetualTechnicalScore
} from "@/lib/letualFotoQuality";

export type LetualPhotoScore = {
  url: string;
  score: number;
  suitable: boolean;
  hasBox: boolean;
  hasInfographic: boolean;
  hasProduct: boolean;
  isFrontal: boolean;
  hasWhiteBackground: boolean;
  quality: number;
  sharpness: number;
  pixels: number;
  reason: string;
};

type VisionJson = {
  suitable?: boolean;
  has_box?: boolean;
  has_infographic?: boolean;
  has_product?: boolean;
  is_frontal?: boolean;
  has_white_background?: boolean;
  quality?: number;
  reason?: string;
};

const SYSTEM = `Ты эксперт по требованиям маркетплейса Летуаль к главному фото товара.

Оцени изображение:

is_frontal — true если товар смотрит на зрителя: этикетка/лицевая сторона обращена к камере.
Симметричный круглый или цилиндрический флакон/тюбик по центру — это фронтальный ракурс.
false ТОЛЬКО при явном 3/4 или профиле, когда заметно видна боковая грань корпуса (не крышечка).
Лёгкий наклон крышки, блики или тень НЕ делают кадр нефронтальным.

has_white_background — true если фон белый #FFFFFF или очень светлый однотонный студийный (не цветной, не градиент, не интерьер).
has_box — true если в кадре видна картонная коробка/упаковка товара (прямоугольная коробка рядом с флаконом, за ним или под ним), даже частично. Один флакон/тюбик без коробки = false.
has_product — true если в кадре виден флакон/тюбик/баночка товара. false для цветов, листьев, ткани, lifestyle без товара.
has_infographic — текст, бейджи, коллаж, lifestyle с моделью.
quality — 0–100: резкость (мутное < 45, чёткий packshot 75+).

suitable — true ТОЛЬКО если: has_product=true, is_frontal=true, has_white_background=true, has_box=false, has_infographic=false, quality>=50.

JSON: {"suitable":true,"has_box":false,"has_infographic":false,"has_product":true,"is_frontal":true,"has_white_background":true,"quality":82,"reason":"..."}`;

const MIN_QUALITY = 50;
const MIN_SHARPNESS = 18;
const VISION_TOP = 12;

async function imageToDataUrl(rawUrl: string): Promise<{ dataUrl: string; usedUrl: string } | null> {
  const fetched = await fetchLetualImageDetailed(rawUrl);
  if (!fetched) return null;
  const b64 = fetched.buf.toString("base64");
  const mime = fetched.usedUrl.toLowerCase().includes(".png") ? "image/png" : "image/jpeg";
  return { dataUrl: `data:${mime};base64,${b64}`, usedUrl: fetched.usedUrl };
}

function combineScore(
  vision: VisionJson,
  technical: LetualTechnicalScore | undefined,
  usedUrl: string
): LetualPhotoScore {
  const quality = Math.max(0, Math.min(100, Number(vision.quality) || 0));
  const hasBox = Boolean(vision.has_box);
  const hasInfographic = Boolean(vision.has_infographic);
  const hasProduct = vision.has_product !== false;
  const isFrontal = Boolean(vision.is_frontal);
  const hasWhiteBackground = Boolean(vision.has_white_background);
  const sharpness = technical?.sharpness ?? 0;
  const pixels = technical?.pixels ?? 0;

  const suitable =
    hasProduct &&
    isFrontal &&
    hasWhiteBackground &&
    !hasBox &&
    !hasInfographic &&
    quality >= MIN_QUALITY &&
    sharpness >= MIN_SHARPNESS;

  let score = quality * 4;
  score += Math.min(sharpness / 2, 60);
  score += Math.min(pixels / 5000, 50);
  if (isFrontal) score += 80;
  else score -= 150;
  if (hasWhiteBackground) score += 70;
  else score -= 120;
  if (!hasBox) score += 15;
  if (!hasInfographic) score += 15;
  if (!hasProduct) score -= 500;
  if (hasBox) score -= 80;
  if (hasInfographic) score -= 100;
  if (quality < MIN_QUALITY) score -= 40;
  if (sharpness < MIN_SHARPNESS) score -= 30;

  let reason = String(vision.reason ?? "").trim();
  if (!hasProduct) {
    reason = reason ? `${reason}; нет товара в кадре` : "Нет товара в кадре (lifestyle)";
  }
  if (!hasWhiteBackground) {
    reason = reason ? `${reason}; фон не белый` : "Фон не белый/светлый";
  }
  if (!isFrontal && !reason.includes("фронт")) {
    reason = reason ? `${reason}; не фронтальный ракурс` : "Не фронтальный ракурс";
  }
  if (quality < MIN_QUALITY) {
    reason = reason ? `${reason}; низкое качество` : "Низкое качество / мутное";
  }

  return {
    url: usedUrl,
    score,
    suitable,
    hasBox,
    hasInfographic,
    hasProduct,
    isFrontal,
    hasWhiteBackground,
    quality,
    sharpness,
    pixels,
    reason: reason || (suitable ? "Подходит" : "Не подходит")
  };
}

async function scoreOneUrl(
  rawUrl: string,
  technical: LetualTechnicalScore | undefined,
  openaiApiKey: string,
  model: string
): Promise<LetualPhotoScore | null> {
  const img = await imageToDataUrl(rawUrl);
  if (!img) return null;

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
              text: "Оцени packshot для главного фото Летуаль. Белый фон и фронтальный ракурс обязательны."
            },
            { type: "image_url", image_url: { url: img.dataUrl, detail: "high" } }
          ]
        }
      ]
    }),
    signal: AbortSignal.timeout(60_000)
  });

  if (!res.ok) return null;

  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  let parsed: VisionJson = {};
  try {
    parsed = JSON.parse(json.choices?.[0]?.message?.content ?? "{}") as VisionJson;
  } catch {
    parsed = {};
  }

  return combineScore(parsed, technical, img.usedUrl);
}

export function pickBestFromRanked(ranked: LetualPhotoScore[]): LetualPhotoScore | undefined {
  const clean = ranked.filter((r) => r.hasProduct && !r.hasInfographic);
  if (!clean.length) return undefined;

  const suitable = clean.filter((r) => r.suitable);
  if (suitable.length) {
    return [...suitable].sort((a, b) => b.score - a.score)[0];
  }

  const bottleOnly = clean.filter((r) => !r.hasBox);
  const pool = bottleOnly.length ? bottleOnly : clean;

  const whiteFrontal = pool.filter(
    (r) => r.isFrontal && r.hasWhiteBackground
  );
  if (whiteFrontal.length) {
    return [...whiteFrontal].sort((a, b) => b.score - a.score)[0];
  }

  const frontal = pool.filter((r) => r.isFrontal);
  if (frontal.length) {
    return [...frontal].sort((a, b) => b.score - a.score)[0];
  }

  const whiteBg = pool.filter((r) => r.hasWhiteBackground);
  if (whiteBg.length) {
    return [...whiteBg].sort((a, b) => b.score - a.score)[0];
  }

  return [...pool].sort((a, b) => b.score - a.score)[0];
}

/** Выбрать лучшее фото среди скачиваемых URL. */
export async function pickBestLetualPhoto(
  urls: string[],
  openaiApiKey: string,
  model = "gpt-4o-mini"
): Promise<{ url: string; ranked: LetualPhotoScore[]; downloadableCount: number }> {
  const downloadable = await filterDownloadableLetualUrls(urls);
  if (!downloadable.length) {
    return { url: "", ranked: [], downloadableCount: 0 };
  }

  const technicalRanked = await rankLetualUrlsByTechnicalQuality(downloadable);
  const technicalByRaw = new Map(
    technicalRanked.map((t) => [t.originalUrl, t])
  );

  const forVision = downloadable.slice(0, VISION_TOP);

  const ranked = (
    await Promise.all(
      forVision.map((raw) =>
        scoreOneUrl(raw, technicalByRaw.get(raw), openaiApiKey, model)
      )
    )
  ).filter((x): x is LetualPhotoScore => x !== null);

  ranked.sort((a, b) => b.score - a.score);

  const best = pickBestFromRanked(ranked);
  return {
    url: best?.url ?? "",
    ranked,
    downloadableCount: downloadable.length
  };
}

export async function pickSuitableLetualPhoto(
  urls: string[],
  openaiApiKey: string
): Promise<{ url: string; ranked: LetualPhotoScore[]; best?: LetualPhotoScore }> {
  const picked = await pickBestLetualPhoto(urls, openaiApiKey);
  const best = pickBestFromRanked(picked.ranked);
  const suitableUrl = best?.suitable ? best.url : "";
  return {
    url: suitableUrl,
    ranked: picked.ranked,
    best
  };
}
