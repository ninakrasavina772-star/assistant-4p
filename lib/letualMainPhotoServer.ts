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
  fetchSiblingVariationPhotosBatch,
  type LetualVariationRow
} from "@/lib/letualMetabase";
import { prioritizeLetualPickUrls } from "@/lib/letualPhotoAi";
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
  pickLetualPhotoFast,
  pickLetualPhotoWithFallback,
  scoreLetualPhotoUrls,
  type LetualPhotoScore
} from "@/lib/letualPhotoAi";

function resolveOpenAiKeyOptional(clientKey?: string): string | undefined {
  const k = (clientKey ?? "").trim() || (process.env.OPENAI_API_KEY ?? "").trim();
  return k || undefined;
}

function resolveOpenAiKey(clientKey?: string): string {
  const k = resolveOpenAiKeyOptional(clientKey);
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
  metabaseApiKey?: string,
  quickPick = true
): Promise<LetualPickRow | null> {
  const gallery = await getLetualVariationGallery(variationId, metabaseApiKey);
  const siblingUrls = gallery.photos
    .filter((p) => p.matchType !== "own")
    .map((p) => p.url);
  if (!siblingUrls.length) return null;

  const sample = prioritizeLetualPickUrls(siblingUrls);

  try {
    const { best, ranked } = quickPick
      ? await pickLetualPhotoFast(sample)
      : await pickLetualPhotoWithFallback(sample, resolveOpenAiKey(openaiApiKey));
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
  openaiApiKey: string | undefined,
  metabaseApiKey?: string,
  quickPick = true
): Promise<LetualPickRow> {
  if (!row.imageUrls.length) {
    const fromSibling = await pickFromSiblingUrls(
      row.variationId,
      row,
      openaiApiKey ?? "",
      metabaseApiKey,
      quickPick
    );
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
    const { best, ranked } = quickPick
      ? await pickLetualPhotoFast(row.imageUrls)
      : await pickLetualPhotoWithFallback(row.imageUrls, resolveOpenAiKey(openaiApiKey));
    const picked = pickRowFromVariation(row, best, ranked);
    if (picked.status === "ok") return picked;

    const fromSibling = await pickFromSiblingUrls(
      row.variationId,
      row,
      openaiApiKey ?? "",
      metabaseApiKey,
      quickPick
    );
    if (fromSibling && (fromSibling.status === "ok" || !picked.sourceUrl)) return fromSibling;

    return picked;
  } catch {
    const fromSibling = await pickFromSiblingUrls(
      row.variationId,
      row,
      openaiApiKey ?? "",
      metabaseApiKey,
      quickPick
    );
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
  metabaseApiKey?: string,
  quickPick = true
): Promise<LetualPickRow> {
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

    return await pickFromVariationRow(row, openaiApiKey, metabaseApiKey, quickPick);
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

export type LetualPickOptions = {
  quickPick?: boolean;
};

/** Пакетный подбор: один запрос Metabase + параллельная обработка. */
export async function pickLetualVariationPhotosBatch(
  variationIds: number[],
  openaiApiKey?: string,
  metabaseApiKey?: string,
  options: LetualPickOptions = {}
): Promise<LetualPickRow[]> {
  const quickPick = options.quickPick !== false;
  if (!quickPick) resolveOpenAiKey(openaiApiKey);

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
        return await pickFromVariationRow(row, openaiApiKey, metabaseApiKey, quickPick);
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

function assembleGalleryPhotos(
  seed: LetualVariationRow,
  siblings: Awaited<ReturnType<typeof fetchSiblingVariationPhotos>>,
  siblingRows: LetualVariationRow[]
): LetualGalleryPhoto[] {
  const seen = new Set<string>();
  const photos: LetualGalleryPhoto[] = [];
  const siblingRowById = new Map(siblingRows.map((r) => [r.variationId, r]));

  const push = (url: string, vid: number, matchType: LetualGalleryPhoto["matchType"]) => {
    const u = url.trim();
    if (!u || seen.has(u)) return;
    seen.add(u);
    photos.push({ url: u, variationId: vid, matchType });
  };

  for (const url of seed.imageUrls) push(url, seed.variationId, "own");

  for (const s of siblings) {
    const sr = siblingRowById.get(s.variationId);
    if (!sr) continue;
    for (const url of sr.imageUrls) push(url, sr.variationId, s.matchType);
  }

  return photos;
}

/** Массовая подгрузка галерей из Metabase (без скачивания и AI). */
export async function getLetualGalleriesBatch(
  variationIds: number[],
  metabaseApiKey?: string
): Promise<Record<number, LetualGalleryPhoto[]>> {
  const uniqueIds = [...new Set(variationIds.filter((id) => id > 0))];
  if (!uniqueIds.length) return {};

  const seedRows = await fetchLetualVariations(uniqueIds, metabaseApiKey);
  const rowById = new Map(seedRows.map((r) => [r.variationId, r]));

  const siblingsBySeed = await fetchSiblingVariationPhotosBatch(
    uniqueIds,
    metabaseApiKey,
    12
  );

  const allSiblingIds = new Set<number>();
  for (const list of siblingsBySeed.values()) {
    for (const s of list) allSiblingIds.add(s.variationId);
  }

  const siblingRows = allSiblingIds.size
    ? await fetchLetualVariations([...allSiblingIds], metabaseApiKey)
    : [];

  const siblingRowById = new Map(siblingRows.map((r) => [r.variationId, r]));
  const out: Record<number, LetualGalleryPhoto[]> = {};

  for (const vid of uniqueIds) {
    const seed = rowById.get(vid);
    if (!seed) {
      out[vid] = [];
      continue;
    }

    const siblings = (siblingsBySeed.get(vid) ?? []).map((s) => ({
      variationId: s.variationId,
      matchType: s.matchType
    }));

    out[vid] = assembleGalleryPhotos(
      seed,
      siblings as Awaited<ReturnType<typeof fetchSiblingVariationPhotos>>,
      siblingRows
    );
  }

  return out;
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
