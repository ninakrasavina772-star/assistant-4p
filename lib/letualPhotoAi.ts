import sharp from "sharp";
import {
  filterDownloadableLetualUrls,
  measurePackshotSignals,
  rankLetualUrlsByTechnicalQuality,
  type LetualFetchedImage,
  type LetualTechnicalScore,
  type PackshotSignals
} from "@/lib/letualFotoQuality";
import {
  LETUAL_VISION_BATCH,
  LETUAL_VISION_TOP
} from "@/lib/letualMainPhotoConstants";

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

has_white_background — true если фон белый #FFFFFF, очень светлый однотонный студийный, ИЛИ прозрачный PNG (только флакон без фона — типичный packshot с CDN).
has_box — true если в кадре видна картонная коробка/упаковка (прямоугольная коробка рядом с флаконом, за ним или под ним), даже частично. Флакон + коробка в одном кадре = true. Один флакон/тюбик без коробки = false.
has_product — true если в кадре виден флакон/тюбик/баночка товара. false для цветов, листьев, ткани, lifestyle без товара.
has_infographic — текст, бейджи, коллаж, lifestyle с моделью.
quality — 0–100: резкость (мутное < 45, чёткий packshot 75+).

suitable — true ТОЛЬКО если: has_product=true, is_frontal=true, has_white_background=true, has_box=false, has_infographic=false, quality>=50.
Прозрачный фон (PNG packshot) считается подходящим фоном.

JSON: {"suitable":true,"has_box":false,"has_infographic":false,"has_product":true,"is_frontal":true,"has_white_background":true,"quality":82,"reason":"..."}`;

const MIN_QUALITY = 50;
const MIN_SHARPNESS = 18;
const VISION_PREVIEW_PX = 512;

async function bufferToVisionDataUrl(buf: Buffer, usedUrl: string): Promise<string> {
  const meta = await sharp(buf).metadata();
  const w = meta.width ?? 1;
  const h = meta.height ?? 1;
  const resized = await sharp(buf)
    .resize({
      width: w >= h ? VISION_PREVIEW_PX : undefined,
      height: h > w ? VISION_PREVIEW_PX : undefined,
      fit: "inside",
      withoutEnlargement: true
    })
    .jpeg({ quality: 82 })
    .toBuffer();
  const b64 = resized.toString("base64");
  return `data:image/jpeg;base64,${b64}`;
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
  if (!hasBox) score += 120;
  if (!hasInfographic) score += 15;
  if (!hasProduct) score -= 500;
  if (hasBox) score -= 400;
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

async function scoreOneFetched(
  fetched: LetualFetchedImage,
  technical: LetualTechnicalScore | undefined,
  openaiApiKey: string,
  model: string
): Promise<LetualPhotoScore | null> {
  const dataUrl = await bufferToVisionDataUrl(fetched.buf, fetched.usedUrl);

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
            { type: "image_url", image_url: { url: dataUrl, detail: "low" } }
          ]
        }
      ]
    }),
    signal: AbortSignal.timeout(45_000)
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

  return combineScore(parsed, technical, fetched.usedUrl);
}

function fetchedByOriginal(
  fetched: LetualFetchedImage[]
): Map<string, LetualFetchedImage> {
  const map = new Map<string, LetualFetchedImage>();
  for (const f of fetched) {
    map.set(f.originalUrl, f);
    map.set(f.usedUrl, f);
  }
  return map;
}

function isGoodEnoughToStop(ranked: LetualPhotoScore[]): boolean {
  const best = pickBestFromRanked(ranked);
  return Boolean(best && (best.suitable || isGoodPackshotSource(best)));
}

async function scoreWithEarlyExit(
  orderedOriginalUrls: string[],
  fetchedMap: Map<string, LetualFetchedImage>,
  technicalByRaw: Map<string, LetualTechnicalScore>,
  openaiApiKey: string,
  model: string,
  visionTop: number
): Promise<LetualPhotoScore[]> {
  const ranked: LetualPhotoScore[] = [];
  const pool = orderedOriginalUrls.slice(0, visionTop);

  for (let i = 0; i < pool.length; i += LETUAL_VISION_BATCH) {
    const batch = pool.slice(i, i + LETUAL_VISION_BATCH);
    const batchResults = await Promise.all(
      batch.map(async (originalUrl) => {
        const fetched = fetchedMap.get(originalUrl);
        if (!fetched) return null;
        const technical =
          technicalByRaw.get(originalUrl) ?? technicalByRaw.get(fetched.usedUrl);
        return scoreOneFetched(fetched, technical, openaiApiKey, model);
      })
    );

    for (const r of batchResults) {
      if (r) ranked.push(r);
    }
    ranked.sort((a, b) => b.score - a.score);

    if (isGoodEnoughToStop(ranked)) break;
  }

  return ranked;
}

/** Флакон без коробки, фронт, достаточное качество — можно генерировать (в т.ч. прозрачный PNG). */
export function isGoodPackshotSource(r: LetualPhotoScore): boolean {
  return (
    r.hasProduct &&
    !r.hasBox &&
    !r.hasInfographic &&
    r.isFrontal &&
    r.hasWhiteBackground &&
    r.quality >= MIN_QUALITY &&
    r.sharpness >= MIN_SHARPNESS
  );
}

export function derivePickStatus(best: LetualPhotoScore | undefined): "ok" | "review" | "no_photo" {
  if (!best || !best.hasProduct) return "no_photo";
  if (best.suitable || isGoodPackshotSource(best)) return "ok";
  return "review";
}

export function pickBestFromRanked(ranked: LetualPhotoScore[]): LetualPhotoScore | undefined {
  const clean = ranked.filter((r) => r.hasProduct && !r.hasInfographic);
  if (!clean.length) return undefined;

  const bottleOnly = clean.filter((r) => !r.hasBox);
  const pool = bottleOnly.length ? bottleOnly : clean;

  const suitable = pool.filter((r) => r.suitable);
  if (suitable.length) {
    return [...suitable].sort((a, b) => b.score - a.score)[0];
  }

  const goodPackshot = pool.filter((r) => isGoodPackshotSource(r));
  if (goodPackshot.length) {
    return [...goodPackshot].sort((a, b) => b.score - a.score)[0];
  }

  const whiteFrontal = pool.filter((r) => r.isFrontal && r.hasWhiteBackground);
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
  model = "gpt-4o-mini",
  visionTop = LETUAL_VISION_TOP
): Promise<{
  url: string;
  ranked: LetualPhotoScore[];
  downloadableCount: number;
  technicalTop?: LetualTechnicalScore;
}> {
  const { ranked: technicalRanked, fetched } = await rankLetualUrlsByTechnicalQuality(urls);
  if (!technicalRanked.length) {
    return { url: "", ranked: [], downloadableCount: 0 };
  }

  const technicalByRaw = new Map(
    technicalRanked.map((t) => [t.originalUrl, t])
  );
  const fetchedMap = fetchedByOriginal(fetched);
  const orderedUrls = technicalRanked.map((t) => t.originalUrl);

  const ranked = await scoreWithEarlyExit(
    orderedUrls,
    fetchedMap,
    technicalByRaw,
    openaiApiKey,
    model,
    visionTop
  );

  const best = pickBestFromRanked(ranked) ?? pickLooseFromRanked(ranked);
  return {
    url: best?.url ?? "",
    ranked,
    downloadableCount: technicalRanked.length,
    technicalTop: technicalRanked[0]
  };
}

/** Если строгий отбор ничего не дал — взять лучшее из того, что оценил AI. */
function pickLooseFromRanked(ranked: LetualPhotoScore[]): LetualPhotoScore | undefined {
  if (!ranked.length) return undefined;
  const withProduct = ranked.filter((r) => r.hasProduct);
  const pool = withProduct.length ? withProduct : ranked;
  const noBox = pool.filter((r) => !r.hasBox);
  const finalPool = noBox.length ? noBox : pool;
  return [...finalPool].sort((a, b) => b.score - a.score)[0];
}

export function scoreFromPackshotAnalysis(
  t: LetualTechnicalScore,
  signals: PackshotSignals | null
): LetualPhotoScore {
  const hasTransparentBg = signals?.hasTransparentBg ?? false;
  const hasWhiteBackground =
    Boolean(signals && (signals.whiteRatio >= 0.42 || hasTransparentBg)) ||
    /cdnru\.4stand|deloox/i.test(t.url);
  const hasBox = signals?.likelyHasBox ?? false;
  const isSingle = signals?.likelySingleBottle ?? false;

  let score = t.technicalScore;
  if (isSingle && !hasBox && hasWhiteBackground) score += 220;
  if (hasBox) score -= 400;
  if (hasWhiteBackground) score += 50;
  if (hasTransparentBg) score += 40;

  const suitable =
    isSingle &&
    !hasBox &&
    hasWhiteBackground &&
    !signals?.likelyHasBox &&
    t.sharpness >= MIN_SHARPNESS;

  let reason = "Автовыбор по качеству файла";
  if (isSingle && !hasBox && hasWhiteBackground) reason = "Флакон на белом фоне";
  else if (hasBox) reason = "В кадре коробка — есть варианты без неё";

  return {
    url: t.url,
    score,
    suitable,
    hasBox,
    hasInfographic: false,
    hasProduct: true,
    isFrontal: true,
    hasWhiteBackground,
    quality: Math.min(80, Math.max(50, Math.round(t.sharpness / 2))),
    sharpness: t.sharpness,
    pixels: t.pixels,
    reason
  };
}

export function scoreFromTechnicalFallback(
  t: LetualTechnicalScore,
  signals?: PackshotSignals | null
): LetualPhotoScore {
  return scoreFromPackshotAnalysis(t, signals ?? null);
}

function preferCdnUrl(urls: string[]): string {
  const cdn = urls.find((u) => /cdnru\.4stand\.com\/huge\//i.test(u));
  return cdn ?? urls.find((u) => /^https?:\/\//i.test(u)) ?? "";
}

function scoreFromUrlHeuristic(url: string, reason: string): LetualPhotoScore {
  const isCdnHuge = /cdnru\.4stand\.com\/huge\//i.test(url);
  const hasWhiteBg = isCdnHuge || /deloox/i.test(url);
  return {
    url,
    score: isCdnHuge ? 85 : 45,
    suitable: false,
    hasBox: true,
    hasInfographic: false,
    hasProduct: true,
    isFrontal: true,
    hasWhiteBackground: hasWhiteBg,
    quality: isCdnHuge ? 72 : 50,
    sharpness: 0,
    pixels: 0,
    reason
  };
}

/** Мгновенный подбор по URL из Metabase — без скачивания и без OpenAI. */
export function pickLetualPhotoInstant(urls: string[]): {
  best: LetualPhotoScore;
  ranked: LetualPhotoScore[];
} {
  const url = preferCdnUrl(urls);
  if (!url) throw new Error("Нет URL");
  const best = scoreFromUrlHeuristic(url, isCdnPackshotUrl(url) ? "CDN packshot из Metabase" : "Первое фото из карточки");
  return { best, ranked: [best] };
}

/** Быстрый подбор: скачать все URL, выбрать флакон на белом фоне без коробки. */
export async function pickLetualPhotoFast(
  urls: string[]
): Promise<{ best: LetualPhotoScore; ranked: LetualPhotoScore[] }> {
  const { ranked: technicalRanked, fetched } = await rankLetualUrlsByTechnicalQuality(urls);
  const bufByOriginal = new Map(fetched.map((f) => [f.originalUrl, f.buf]));

  const ranked: LetualPhotoScore[] = [];
  for (const t of technicalRanked) {
    const buf = bufByOriginal.get(t.originalUrl);
    const signals = buf ? await measurePackshotSignals(buf) : null;
    ranked.push(scoreFromPackshotAnalysis(t, signals));
  }
  ranked.sort((a, b) => b.score - a.score);

  let best = pickBestFromRanked(ranked) ?? pickLooseFromRanked(ranked);

  if (!best && technicalRanked[0]) {
    const buf = bufByOriginal.get(technicalRanked[0].originalUrl);
    const signals = buf ? await measurePackshotSignals(buf) : null;
    best = scoreFromPackshotAnalysis(technicalRanked[0], signals);
  }

  if (!best) {
    const url = preferCdnUrl(urls);
    if (url) {
      best = scoreFromUrlHeuristic(url, "Первое фото из карточки");
      best.hasBox = true;
      best.suitable = false;
      best.reason = "Не удалось проверить кадры — проверьте вручную";
    }
  }

  if (!best) throw new Error("Нет URL для подбора");
  return { best, ranked };
}

function isCdnPackshotUrl(url: string): boolean {
  return /cdnru\.4stand\.com\/huge\//i.test(url);
}

/** Подбор с гарантированным fallback: в карточке есть URL → почти всегда будет sourceUrl. */
export async function pickLetualPhotoWithFallback(
  urls: string[],
  openaiApiKey: string
): Promise<{ best: LetualPhotoScore; ranked: LetualPhotoScore[] }> {
  const [fast, picked] = await Promise.all([
    pickLetualPhotoFast(urls),
    pickBestLetualPhoto(urls, openaiApiKey)
  ]);

  const aiBest = pickBestFromRanked(picked.ranked) ?? pickLooseFromRanked(picked.ranked);
  const candidates = [fast.best, aiBest].filter((c): c is LetualPhotoScore => Boolean(c));
  const noBox = candidates.filter((c) => !c.hasBox);
  const pool = noBox.length ? noBox : candidates;
  const best = [...pool].sort((a, b) => b.score - a.score)[0];

  if (!best) {
    throw new Error("Нет URL для подбора");
  }

  return {
    best,
    ranked: picked.ranked.length >= fast.ranked.length ? picked.ranked : fast.ranked
  };
}

export async function pickSuitableLetualPhoto(
  urls: string[],
  openaiApiKey: string
): Promise<{ url: string; ranked: LetualPhotoScore[]; best?: LetualPhotoScore }> {
  const { best, ranked } = await pickLetualPhotoWithFallback(urls, openaiApiKey);
  return {
    url: best.url,
    ranked,
    best
  };
}

/** Оценить список URL (топ по техоценке, с early exit). */
export async function scoreLetualPhotoUrls(
  urls: string[],
  openaiApiKey: string,
  visionTop = LETUAL_VISION_TOP
): Promise<LetualPhotoScore[]> {
  const picked = await pickBestLetualPhoto(urls, openaiApiKey, "gpt-4o-mini", visionTop);
  return picked.ranked;
}

// Re-export for callers that only need downloadable check
export { filterDownloadableLetualUrls };
