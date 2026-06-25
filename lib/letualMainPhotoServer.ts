import { mapPool } from "@/lib/letualAsyncPool";
import {
  LETUAL_GENERATE_CONCURRENCY,
  LETUAL_PICK_CONCURRENCY,
  LETUAL_VISION_TOP
} from "@/lib/letualMainPhotoConstants";
import { processLetualMainPhotoFromUrl } from "@/lib/letualMainPhotoProcess";
import {
  fetchLetualVariations,
  fetchSiblingVariationPhotos,
  type LetualVariationRow
} from "@/lib/letualMetabase";
import { uploadLetualMainPhoto } from "@/lib/ozonImageStorage";
import type { LetualResultRow } from "@/lib/letualMainPhotoExcel";
import type {
  LetualGalleryPhoto,
  LetualGenerateItem,
  LetualGenerateRow,
  LetualPickRow,
  LetualPickStatus
} from "@/lib/letualPickTypes";
import { searchLetualWebImages, validateImageUrl } from "@/lib/letualWebSearch";
import {
  derivePickStatus,
  pickLetualPhotoWithFallback,
  scoreLetualPhotoUrls,
  type LetualPhotoScore
} from "@/lib/letualPhotoAi";

function resolveOpenAiKey(clientKey?: string): string {
  const k = (clientKey ?? "").trim() || (process.env.OPENAI_API_KEY ?? "").trim();
  if (!k) throw new Error("Нужен OpenAI API key (в интерфейсе или OPENAI_API_KEY на сервере)");
  return k;
}

function buildDbComment(best: LetualPhotoScore | undefined): string {
  if (!best) return "";
  if (best.suitable || derivePickStatus(best) === "ok") return best.reason || "Подходит";
  const notes: string[] = [];
  if (best.hasBox) notes.push("в кадре коробка");
  if (!best.hasWhiteBackground) notes.push("фон не белый/прозрачный");
  if (!best.isFrontal) notes.push("не фронтальный ракурс");
  if (best.quality < 50) notes.push("низкое качество");
  if (!best.hasProduct) notes.push("нет товара в кадре");
  if (best.hasInfographic) notes.push("инфографика/lifestyle");
  if (!notes.length && best.reason) notes.push(best.reason);
  return notes.join("; ") || "Требует проверки";
}

async function processAndUpload(sourceUrl: string): Promise<string> {
  const jpeg = await processLetualMainPhotoFromUrl(sourceUrl);
  return uploadLetualMainPhoto(jpeg, "main.jpg");
}

function pickRowFromVariation(
  row: LetualVariationRow,
  best: LetualPhotoScore,
  ranked: LetualPhotoScore[],
  statusOverride?: LetualPickStatus
): LetualPickRow {
  const status = statusOverride ?? derivePickStatus(best);
  return {
    variationId: row.variationId,
    productName: row.productName,
    brandName: row.brandName,
    ean: row.ean,
    sourceUrl: best.url,
    sourceLabel: "auto",
    status: status === "no_photo" ? "review" : status,
    comment: buildDbComment(best),
    previewUrl: best.url,
    ranked
  };
}

async function pickFromSiblingUrls(
  variationId: number,
  row: LetualVariationRow,
  openaiApiKey: string,
  metabaseApiKey?: string
): Promise<LetualPickRow | null> {
  const gallery = await getLetualVariationGallery(variationId, metabaseApiKey);
  const siblingUrls = gallery.photos
    .filter((p) => p.matchType !== "own")
    .map((p) => p.url);
  if (!siblingUrls.length) return null;

  try {
    const { best, ranked } = await pickLetualPhotoWithFallback(siblingUrls, openaiApiKey);
    const match = gallery.photos.find((p) => p.url === best.url);
    return {
      variationId: row.variationId,
      productName: row.productName,
      brandName: row.brandName,
      ean: row.ean,
      sourceUrl: best.url,
      sourceLabel: match?.matchType === "same_ean" ? "same_ean" : "same_product",
      status: derivePickStatus(best) === "ok" ? "ok" : "review",
      comment: `Из другой вариации (${match?.variationId ?? "?"}): ${buildDbComment(best)}`,
      previewUrl: best.url,
      ranked
    };
  } catch {
    return null;
  }
}

async function pickFromVariationRow(
  row: LetualVariationRow,
  openaiApiKey: string,
  metabaseApiKey?: string
): Promise<LetualPickRow> {
  if (!row.imageUrls.length) {
    const fromSibling = await pickFromSiblingUrls(row.variationId, row, openaiApiKey, metabaseApiKey);
    if (fromSibling) return fromSibling;

    return {
      variationId: row.variationId,
      productName: row.productName,
      brandName: row.brandName,
      ean: row.ean,
      sourceUrl: "",
      sourceLabel: "auto",
      status: "no_photo",
      comment: "В карточке нет фото",
      ranked: []
    };
  }

  try {
    const { best, ranked } = await pickLetualPhotoWithFallback(row.imageUrls, openaiApiKey);
    const picked = pickRowFromVariation(row, best, ranked);
    if (picked.status === "ok") return picked;

    const fromSibling = await pickFromSiblingUrls(row.variationId, row, openaiApiKey, metabaseApiKey);
    if (fromSibling && fromSibling.status === "ok") return fromSibling;

    return picked;
  } catch {
    const fromSibling = await pickFromSiblingUrls(row.variationId, row, openaiApiKey, metabaseApiKey);
    if (fromSibling) return fromSibling;

    return {
      variationId: row.variationId,
      productName: row.productName,
      brandName: row.brandName,
      ean: row.ean,
      sourceUrl: "",
      sourceLabel: "auto",
      status: "no_photo",
      comment: "Не удалось подобрать фото",
      ranked: []
    };
  }
}

/** Фаза A: только подбор фото из Metabase, без генерации. */
export async function pickLetualVariationPhoto(
  variationId: number,
  openaiApiKey?: string,
  metabaseApiKey?: string
): Promise<LetualPickRow> {
  const key = resolveOpenAiKey(openaiApiKey);

  try {
    const rows = await fetchLetualVariations([variationId], metabaseApiKey);
    const row = rows[0];
    if (!row) {
      return {
        variationId,
        productName: "",
        brandName: "",
        ean: null,
        sourceUrl: "",
        sourceLabel: "auto",
        status: "no_photo",
        comment: "",
        error: `Вариация ${variationId} не найдена в БД`
      };
    }

    return await pickFromVariationRow(row, key, metabaseApiKey);
  } catch (e) {
    return {
      variationId,
      productName: "",
      brandName: "",
      ean: null,
      sourceUrl: "",
      sourceLabel: "auto",
      status: "no_photo",
      comment: "",
      error: e instanceof Error ? e.message : String(e)
    };
  }
}

/** Пакетный подбор: один запрос Metabase + параллельный AI. */
export async function pickLetualVariationPhotosBatch(
  variationIds: number[],
  openaiApiKey?: string,
  metabaseApiKey?: string
): Promise<LetualPickRow[]> {
  const key = resolveOpenAiKey(openaiApiKey);
  const uniqueIds = [...new Set(variationIds.filter((id) => id > 0))];

  try {
    const rows = await fetchLetualVariations(uniqueIds, metabaseApiKey);
    const rowById = new Map(rows.map((r) => [r.variationId, r]));

    return mapPool(uniqueIds, LETUAL_PICK_CONCURRENCY, async (variationId) => {
      const row = rowById.get(variationId);
      if (!row) {
        return {
          variationId,
          productName: "",
          brandName: "",
          ean: null,
          sourceUrl: "",
          sourceLabel: "auto",
          status: "no_photo" as const,
          comment: "",
          error: `Вариация ${variationId} не найдена в БД`
        };
      }
      try {
        return await pickFromVariationRow(row, key, metabaseApiKey);
      } catch (e) {
        return {
          variationId,
          productName: row.productName,
          brandName: row.brandName,
          ean: row.ean,
          sourceUrl: "",
          sourceLabel: "auto",
          status: "no_photo" as const,
          comment: "",
          error: e instanceof Error ? e.message : String(e)
        };
      }
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return uniqueIds.map((variationId) => ({
      variationId,
      productName: "",
      brandName: "",
      ean: null,
      sourceUrl: "",
      sourceLabel: "auto",
      status: "no_photo" as const,
      comment: "",
      error: msg
    }));
  }
}

/** Все фото вариации + same EAN для галереи. */
export async function getLetualVariationGallery(
  variationId: number,
  metabaseApiKey?: string
): Promise<{
  variation: LetualVariationRow | null;
  photos: LetualGalleryPhoto[];
}> {
  const rows = await fetchLetualVariations([variationId], metabaseApiKey);
  const row = rows[0] ?? null;
  if (!row) return { variation: null, photos: [] };

  const seen = new Set<string>();
  const photos: LetualGalleryPhoto[] = [];

  const push = (url: string, vid: number, matchType: LetualGalleryPhoto["matchType"]) => {
    const u = url.trim();
    if (!u || seen.has(u)) return;
    seen.add(u);
    photos.push({ url: u, variationId: vid, matchType });
  };

  for (const url of row.imageUrls) push(url, row.variationId, "own");

  const siblings = await fetchSiblingVariationPhotos(
    variationId,
    metabaseApiKey,
    { brandName: row.brandName, productName: row.productName },
    30
  );

  const eanIds = siblings.filter((s) => s.matchType === "same_ean").map((s) => s.variationId);
  const productIds = siblings
    .filter((s) => s.matchType === "same_product" && !eanIds.includes(s.variationId))
    .map((s) => s.variationId);

  if (eanIds.length) {
    const eanRows = await fetchLetualVariations(eanIds, metabaseApiKey);
    for (const er of eanRows) {
      for (const url of er.imageUrls) push(url, er.variationId, "same_ean");
    }
  }

  if (productIds.length) {
    const prodRows = await fetchLetualVariations(productIds, metabaseApiKey);
    for (const pr of prodRows) {
      for (const url of pr.imageUrls) push(url, pr.variationId, "same_product");
    }
  }

  return { variation: row, photos };
}

export type LetualSearchResult = {
  url: string;
  source: string;
  score?: LetualPhotoScore;
};

/** Поиск фото в интернете + AI-оценка (параллельно). */
export async function searchLetualPhotosWithAi(
  ean: string | null,
  productName: string,
  brandName: string,
  openaiApiKey?: string
): Promise<LetualSearchResult[]> {
  const key = resolveOpenAiKey(openaiApiKey);
  const images = await searchLetualWebImages(ean, productName, brandName);
  const validated = await mapPool(images.slice(0, 18), 6, async (img) => {
    if (!(await validateImageUrl(img.url))) return null;
    return img;
  });
  const ok = validated.filter((x): x is NonNullable<typeof x> => x !== null).slice(0, 12);

  const scored = await mapPool(ok, 4, async (img) => {
    const ranked = await scoreLetualPhotoUrls([img.url], key, LETUAL_VISION_TOP);
    return { url: img.url, source: img.source, score: ranked[0] };
  });

  scored.sort((a, b) => (b.score?.score ?? 0) - (a.score?.score ?? 0));
  return scored;
}

/** Пакетная генерация с параллелизмом. */
export async function generateLetualFromSourcesBatch(
  items: LetualGenerateItem[]
): Promise<LetualGenerateRow[]> {
  return mapPool(items, LETUAL_GENERATE_CONCURRENCY, (item) =>
    generateLetualFromSource(item)
  );
}

/** Фаза C: генерация по утверждённому sourceUrl. */
export async function generateLetualFromSource(
  item: LetualGenerateItem
): Promise<LetualGenerateRow> {
  const sourceUrl = item.sourceUrl?.trim();
  if (!sourceUrl?.startsWith("http")) {
    return {
      variationId: item.variationId,
      sourceUrl: sourceUrl ?? "",
      resultUrl: "",
      comment: "",
      ok: false,
      error: "Нет URL источника"
    };
  }

  try {
    const resultUrl = await processAndUpload(sourceUrl);
    return {
      variationId: item.variationId,
      sourceUrl,
      resultUrl,
      comment: "",
      previewUrl: resultUrl,
      ok: true
    };
  } catch (e) {
    return {
      variationId: item.variationId,
      sourceUrl,
      resultUrl: "",
      comment: "",
      ok: false,
      error: e instanceof Error ? e.message : String(e)
    };
  }
}

export async function processLetualByUrl(
  sourceUrl: string,
  _openaiApiKey?: string
): Promise<LetualResultRow> {
  const r = await generateLetualFromSource({ sourceUrl });
  return {
    sourceUrl: r.sourceUrl,
    resultUrl: r.resultUrl,
    comment: r.comment,
    previewUrl: r.previewUrl,
    ok: r.ok,
    error: r.error
  };
}

/** Legacy: pick + generate в одном шаге. */
export async function processLetualByVariationId(
  variationId: number,
  openaiApiKey?: string,
  metabaseApiKey?: string
): Promise<LetualResultRow> {
  const pick = await pickLetualVariationPhoto(variationId, openaiApiKey, metabaseApiKey);

  if (pick.error) {
    return { variationId, resultUrl: "", comment: "", ok: false, error: pick.error };
  }

  if (!pick.sourceUrl) {
    return {
      variationId,
      resultUrl: "",
      comment: pick.comment,
      ok: false,
      error: pick.status === "no_photo" ? "Нет подходящего фото" : "Выберите фото вручную"
    };
  }

  const gen = await generateLetualFromSource({
    variationId,
    sourceUrl: pick.sourceUrl
  });

  return {
    variationId,
    sourceUrl: gen.sourceUrl,
    resultUrl: gen.resultUrl,
    comment: pick.comment,
    previewUrl: gen.previewUrl,
    ok: gen.ok,
    error: gen.error
  };
}
