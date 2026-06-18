import { getOzonStorageBackend, uploadOzonImage, uploadOzonImageAtKey } from "@/lib/ozonImageStorage";
import {
  BACKGROUND_STYLES,
  compositeOnBackground,
  cutPackshotBackground,
  fetchProductImage,
  renderBackground,
  type BackgroundStyle
} from "@/lib/templateGenerator/photoCompose";
import { mergeImageUrls, parseImageUrls } from "@/lib/templateGenerator/photos";

const MAX_VARIANTS_PER_ROW = 5;

async function uploadGeneratedPhoto(buf: Buffer, sku: string, style: BackgroundStyle): Promise<string> {
  const safeSku = sku.replace(/[^\w.-]+/g, "_").slice(0, 48) || "sku";
  const fileName = `tpl-${safeSku}-${style}.jpg`;

  if (getOzonStorageBackend() === "yandex") {
    const id = crypto.randomUUID();
    const prefix = process.env.YANDEX_S3_PREFIX?.trim().replace(/^\/+|\/+$/g, "") || "ozon-images";
    const key = `${prefix}/template-generator/${id}/${fileName}`;
    return uploadOzonImageAtKey(buf, key, "image/jpeg");
  }

  return uploadOzonImage(buf, fileName);
}

export type GenerateRowPhotosOpts = {
  imageText: string;
  sku: string;
  minCount: number;
  targetCount: number;
  generateBackgrounds: boolean;
};

export type GenerateRowPhotosResult = {
  imageUrls: string[];
  generated: string[];
  note?: string;
};

/**
 * Если фото мало — композитим товар с основного packshot на разные фоны и заливаем в хранилище.
 */
export async function resolveRowPhotos(opts: GenerateRowPhotosOpts): Promise<GenerateRowPhotosResult> {
  const existing = parseImageUrls(opts.imageText);
  const target = Math.max(opts.minCount, opts.targetCount);

  if (!opts.generateBackgrounds) {
    return { imageUrls: existing, generated: [] };
  }

  if (existing.length >= target) {
    return { imageUrls: existing, generated: [] };
  }

  const primary = existing[0];
  if (!primary) {
    return { imageUrls: existing, generated: [], note: "нет исходного foto в шаблоне/фиде" };
  }

  if (!getOzonStorageBackend()) {
    return {
      imageUrls: existing,
      generated: [],
      note: "хранилище фото не настроено (Yandex S3 или Vercel Blob)"
    };
  }

  const need = Math.min(target - existing.length, MAX_VARIANTS_PER_ROW);
  const styles = BACKGROUND_STYLES.slice(0, need);

  let source: Buffer;
  try {
    source = await fetchProductImage(primary);
  } catch (e) {
    return {
      imageUrls: existing,
      generated: [],
      note: e instanceof Error ? e.message : "ошибка загрузки foto"
    };
  }

  let cutout: Buffer;
  try {
    cutout = await cutPackshotBackground(source);
  } catch {
    cutout = source;
  }

  const generated: string[] = [];
  for (const style of styles) {
    try {
      const bg = await renderBackground(style);
      const composed = await compositeOnBackground(cutout, bg);
      const url = await uploadGeneratedPhoto(composed, opts.sku, style);
      generated.push(url);
    } catch (e) {
      console.warn("template photo variant failed:", style, e);
    }
  }

  if (!generated.length) {
    return { imageUrls: existing, generated: [], note: "не удалось сгенерировать варианты фона" };
  }

  return {
    imageUrls: mergeImageUrls(existing, generated),
    generated
  };
}
