import { getOzonStorageBackend, uploadOzonImage, uploadOzonImageAtKey } from "@/lib/ozonImageStorage";
import { generateThemedBackground } from "@/lib/templateGenerator/photoBackgroundAi";
import {
  compositeOnBackground,
  cutPackshotBackground,
  fetchProductImage,
  renderBackground,
  type BackgroundStyle
} from "@/lib/templateGenerator/photoCompose";
import { mergeImageUrls, parseImageUrls } from "@/lib/templateGenerator/photos";
import {
  pickThemedScenes,
  productPhotoContextFromRow,
  type ProductPhotoContext
} from "@/lib/templateGenerator/photoThemes";

/** AI lifestyle-фоны — дороже и дольше, но «в тему» */
const MAX_THEMED_VARIANTS = 3;
const MAX_GRADIENT_FALLBACK = 2;

async function uploadGeneratedPhoto(buf: Buffer, sku: string, tag: string): Promise<string> {
  const safeSku = sku.replace(/[^\w.-]+/g, "_").slice(0, 48) || "sku";
  const safeTag = tag.replace(/[^\w.-]+/g, "_").slice(0, 32);
  const fileName = `tpl-${safeSku}-${safeTag}.jpg`;

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
  /** OpenAI key — для тематических lifestyle-фонов */
  openaiApiKey?: string;
  productContext?: ProductPhotoContext;
  /** themed = AI сцены в тему; gradient = только градиенты */
  photoStyle?: "themed" | "gradient";
};

export type GenerateRowPhotosResult = {
  imageUrls: string[];
  generated: string[];
  note?: string;
};

/**
 * Если фото мало — композитим товар с тематическими lifestyle-фонами (AI) или градиентами.
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

  const need = Math.min(target - existing.length, MAX_THEMED_VARIANTS + MAX_GRADIENT_FALLBACK);
  const useThemed = opts.photoStyle !== "gradient" && Boolean(opts.openaiApiKey?.trim());
  const ctx = opts.productContext ?? {
    brand: "",
    productName: opts.sku
  };

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
  const themedCount = useThemed ? Math.min(need, MAX_THEMED_VARIANTS) : 0;
  const scenes = useThemed ? pickThemedScenes(ctx, themedCount) : [];

  for (const scene of scenes) {
    try {
      const bg = await generateThemedBackground(opts.openaiApiKey!, scene.prompt);
      const composed = await compositeOnBackground(cutout, bg);
      const url = await uploadGeneratedPhoto(composed, opts.sku, scene.id);
      generated.push(url);
    } catch (e) {
      console.warn("themed photo failed:", scene.id, e);
    }
  }

  const gradientNeed = Math.min(need - generated.length, MAX_GRADIENT_FALLBACK);
  const gradientStyles: BackgroundStyle[] = ["warm-beige", "blush", "marble", "cool-gray", "dark-luxury"];
  for (let i = 0; i < gradientNeed; i++) {
    const style = gradientStyles[i % gradientStyles.length]!;
    try {
      const bg = await renderBackground(style);
      const composed = await compositeOnBackground(cutout, bg);
      const url = await uploadGeneratedPhoto(composed, opts.sku, style);
      generated.push(url);
    } catch (e) {
      console.warn("gradient photo failed:", style, e);
    }
  }

  if (!generated.length) {
    return {
      imageUrls: existing,
      generated: [],
      note: useThemed
        ? "не удалось сгенерировать тематические фото (проверьте OpenAI Images)"
        : "не удалось сгенерировать варианты фона"
    };
  }

  const themeLabels = scenes.map((s) => s.label).join(", ");
  return {
    imageUrls: mergeImageUrls(existing, generated),
    generated,
    note: useThemed && themeLabels ? `темы: ${themeLabels}` : undefined
  };
}

export { productPhotoContextFromRow };
