import { createHash } from "crypto";
import sharp from "sharp";
import { LETUAL_CANVAS_SIZE, LETUAL_JPEG_QUALITY } from "@/lib/letualMainPhotoConstants";
import { processLetualMainPhotoFromUrl } from "@/lib/letualMainPhotoProcess";
import { compositeFlatImageToLetualCanvas } from "@/lib/letualMainPhotoLayout";
import { fetchLetualImageDetailed } from "@/lib/letualFotoQuality";
import { fetchPodruzhkaProductImageDetailed } from "@/lib/podruzhkaImageFetch";
import { getOzonStorageBackend, uploadOzonImage, uploadOzonImageAtKey } from "@/lib/ozonImageStorage";
import {
  fetchMetabaseProductBySku,
  sortImagesForComposite
} from "@/lib/templateGenerator/metabaseProduct";
import {
  dedupeImageUrlsSemantic,
  imageUrlIdentityKey,
  isYandexProcessedStorageUrl,
  uniqueUrlsForImageCell
} from "@/lib/templateGenerator/imageUrlDedupe";
import { parseImageUrls } from "@/lib/templateGenerator/photos";
import { normVariationSku } from "@/lib/templateGenerator/parseVariationIds";
import { rehostImageUrls, type RehostCache } from "@/lib/templateGenerator/rehostImageUrl";
import { isLowQualityImageUrl } from "@/lib/templateGenerator/yandexImageFilter";
import { preferAdminFotoUrls } from "@/lib/templateGenerator/yandexImageSources";
import { selectYandexGalleryFromUrls } from "@/lib/templateGenerator/yandexImageSelect.server";

const MAX_BACKGROUND = 4;
const PACKSHOT_CONCURRENCY = 3;

function isThumbOrSmallUrl(url: string): boolean {
  return isLowQualityImageUrl(url);
}

async function downloadImageBuffer(url: string): Promise<Buffer | null> {
  const podruzhka = await fetchPodruzhkaProductImageDetailed(url);
  if (podruzhka.buf?.length && podruzhka.buf.length >= 512) return podruzhka.buf;

  const letual = await fetchLetualImageDetailed(url);
  if (letual?.buf?.length && letual.buf.length >= 512) return letual.buf;

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(20_000),
      headers: { Accept: "image/*", "User-Agent": "assistant-4p-yandex-photos/1.0" }
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length >= 512 ? buf : null;
  } catch {
    return null;
  }
}

async function uploadYandexPhoto(buf: Buffer, sku: string, tag: string): Promise<string> {
  const safeSku = sku.replace(/[^\w.-]+/g, "_").slice(0, 48) || "sku";
  const safeTag = tag.replace(/[^\w.-]+/g, "_").slice(0, 32);
  const fileName = `ym-${safeSku}-${safeTag}.jpg`;

  if (getOzonStorageBackend() === "yandex") {
    const id = crypto.randomUUID();
    const prefix = process.env.YANDEX_S3_PREFIX?.trim().replace(/^\/+|\/+$/g, "") || "ozon-images";
    const key = `${prefix}/template-generator/yandex/${id}/${fileName}`;
    return uploadOzonImageAtKey(buf, key, "image/jpeg");
  }

  return uploadOzonImage(buf, fileName);
}

async function enhanceBackgroundPhotoTo1000(buf: Buffer): Promise<Buffer> {
  const meta = await sharp(buf).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;

  if (w >= LETUAL_CANVAS_SIZE && h >= LETUAL_CANVAS_SIZE) {
    return sharp(buf).jpeg({ quality: LETUAL_JPEG_QUALITY, mozjpeg: true }).toBuffer();
  }

  return sharp(buf)
    .resize(LETUAL_CANVAS_SIZE, LETUAL_CANVAS_SIZE, {
      fit: "inside",
      withoutEnlargement: false,
      kernel: sharp.kernel.lanczos3
    })
    .jpeg({ quality: LETUAL_JPEG_QUALITY, mozjpeg: true })
    .toBuffer();
}

type PackshotState = {
  sourceKeys: Set<string>;
  contentHashes: Set<string>;
  results: string[];
};

async function packshotTo1000Buffer(src: string): Promise<Buffer> {
  try {
    return await processLetualMainPhotoFromUrl(src);
  } catch {
    const raw = await downloadImageBuffer(src);
    if (!raw) throw new Error("не скачалось");
    return compositeFlatImageToLetualCanvas(raw);
  }
}

async function assert1000x1000(buf: Buffer): Promise<Buffer> {
  const meta = await sharp(buf).metadata();
  if (meta.width === LETUAL_CANVAS_SIZE && meta.height === LETUAL_CANVAS_SIZE) {
    return buf;
  }
  return compositeFlatImageToLetualCanvas(buf);
}

async function processOnePackshot(
  src: string,
  sku: string,
  state: PackshotState
): Promise<void> {
  const srcKey = imageUrlIdentityKey(src);
  if (state.sourceKeys.has(srcKey)) return;
  state.sourceKeys.add(srcKey);

  try {
    let buf = await packshotTo1000Buffer(src);
    buf = await assert1000x1000(buf);
    const contentHash = createHash("sha256").update(buf).digest("hex").slice(0, 24);
    if (state.contentHashes.has(contentHash)) return;
    state.contentHashes.add(contentHash);

    const url = await uploadYandexPhoto(buf, sku, `p${state.results.length + 1}`);
    state.results.push(url);
  } catch {
    /* skip failed source */
  }
}

async function processPackshotsParallel(
  urls: string[],
  sku: string,
  maxUnique: number
): Promise<string[]> {
  const state: PackshotState = {
    sourceKeys: new Set(),
    contentHashes: new Set(),
    results: []
  };

  let cursor = 0;
  const workers = Array.from({ length: PACKSHOT_CONCURRENCY }, async () => {
    while (cursor < urls.length && state.results.length < maxUnique) {
      const idx = cursor++;
      await processOnePackshot(urls[idx]!, sku, state);
    }
  });
  await Promise.all(workers);
  return state.results;
}

async function rehostList(urls: string[], sku: string, cache: RehostCache): Promise<string[]> {
  if (!urls.length) return [];
  const rehosted = await rehostImageUrls(urls, sku, cache);
  return urls.map((u, i) => rehosted[i] ?? u);
}

export type YandexRowPhotosOpts = {
  imageText: string;
  sku: string;
  targetCount: number;
  metabaseEnabled?: boolean;
};

export type YandexRowPhotosResult = {
  imageUrls: string[];
  processed: string[];
  note?: string;
};

export async function resolveYandexRowPhotos(
  opts: YandexRowPhotosOpts
): Promise<YandexRowPhotosResult> {
  const parsed = dedupeImageUrlsSemantic(parseImageUrls(opts.imageText));
  const alreadyDone = parsed.filter(isYandexProcessedStorageUrl);
  let sourceUrls = parsed.filter((u) => !isThumbOrSmallUrl(u) && !isYandexProcessedStorageUrl(u));

  let mainImageUrl: string | null = null;

  if (opts.metabaseEnabled !== false && normVariationSku(opts.sku)) {
    try {
      const mb = await fetchMetabaseProductBySku(opts.sku);
      if (mb) {
        mainImageUrl = mb.mainImageUrl;
        if (mb.imageUrls.length) {
          sourceUrls = preferAdminFotoUrls(sortImagesForComposite(mb.imageUrls));
        }
      }
    } catch {
      /* optional */
    }
  }

  sourceUrls = preferAdminFotoUrls(sourceUrls);
  sourceUrls = sourceUrls.filter((u) => !isThumbOrSmallUrl(u));

  const maxWhite = Math.min(2, Math.max(1, opts.targetCount));
  const gallery = await selectYandexGalleryFromUrls({
    urls: sourceUrls,
    mainImageUrl,
    maxWhiteTotal: maxWhite,
    maxLifestyle: MAX_BACKGROUND
  });

  let packshotSources = [
    ...(gallery.main ? [gallery.main] : []),
    ...gallery.whiteExtras
  ];
  let lifestyleSources = gallery.lifestyles;

  const rehostCache: RehostCache = new Map();
  packshotSources = await rehostList(packshotSources, opts.sku, rehostCache);
  lifestyleSources = await rehostList(lifestyleSources, opts.sku, rehostCache);

  if (!packshotSources.length && !lifestyleSources.length && !alreadyDone.length) {
    return {
      imageUrls: [],
      processed: [],
      note: gallery.note ? `${gallery.note} · нет foto` : "нет исходных foto"
    };
  }

  if (!getOzonStorageBackend()) {
    const fallback = uniqueUrlsForImageCell([
      ...alreadyDone,
      ...packshotSources,
      ...lifestyleSources
    ]);
    return {
      imageUrls: fallback,
      processed: alreadyDone,
      note: fallback.length
        ? `${gallery.note ?? ""} · S3 не настроен — rehost без 1000×1000`.trim()
        : "хранилище S3/Blob не настроено — нет foto"
    };
  }

  let whitePhotos = uniqueUrlsForImageCell(alreadyDone);

  if (packshotSources.length) {
    const processed = await processPackshotsParallel(
      packshotSources,
      opts.sku,
      packshotSources.length
    );
    whitePhotos = uniqueUrlsForImageCell([...whitePhotos, ...processed]);
  }

  const backgroundUrls: string[] = [];
  const seenOut = new Set(whitePhotos.map(imageUrlIdentityKey));

  for (const src of lifestyleSources) {
    const srcKey = imageUrlIdentityKey(src);
    if (seenOut.has(srcKey)) continue;

    try {
      const raw = await downloadImageBuffer(src);
      if (!raw) continue;

      const contentHash = createHash("sha256").update(raw).digest("hex").slice(0, 24);
      if (seenOut.has(`hash:${contentHash}`)) continue;

      const enhanced = await enhanceBackgroundPhotoTo1000(raw);
      const uploadHash = createHash("sha256").update(enhanced).digest("hex").slice(0, 24);
      if (seenOut.has(`hash:${uploadHash}`)) continue;

      const url = await uploadYandexPhoto(enhanced, opts.sku, `bg-${backgroundUrls.length + 1}`);
      const urlKey = imageUrlIdentityKey(url);
      if (seenOut.has(urlKey)) continue;

      backgroundUrls.push(url);
      seenOut.add(srcKey);
      seenOut.add(urlKey);
      seenOut.add(`hash:${uploadHash}`);
    } catch {
      /* skip */
    }
  }

  const finalUrls = uniqueUrlsForImageCell([...whitePhotos, ...backgroundUrls]).filter((u) =>
    isYandexProcessedStorageUrl(u)
  );

  const parts: string[] = [];
  if (gallery.note) parts.push(gallery.note);
  if (whitePhotos.length) parts.push(`${whitePhotos.length} packshot 1000×1000`);
  if (backgroundUrls.length) parts.push(`${backgroundUrls.length} с фоном`);

  if (!finalUrls.length && (packshotSources.length || lifestyleSources.length)) {
    const fallback = uniqueUrlsForImageCell([...alreadyDone, ...packshotSources, ...lifestyleSources]);
    if (fallback.length) {
      return {
        imageUrls: fallback,
        processed: alreadyDone,
        note: (parts.length ? parts.join(" · ") + " · " : "") + "обработка packshot не удалась — исходные ссылки"
      };
    }
    parts.push("не удалось обработать foto — проверьте S3 и доступность исходников");
  }

  return {
    imageUrls: finalUrls,
    processed: finalUrls,
    note: parts.length ? parts.join(" · ") : "нет foto"
  };
}
