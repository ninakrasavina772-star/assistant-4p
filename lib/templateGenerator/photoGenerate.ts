import { getOzonStorageBackend, uploadOzonImage, uploadOzonImageAtKey } from "@/lib/ozonImageStorage";
import { generateThemedBackground } from "@/lib/templateGenerator/photoBackgroundAi";
import {
  compositeOnBackground,
  fetchBestProductSource,
  prepareLetualProductCutout,
  renderBackground,
  type BackgroundStyle
} from "@/lib/templateGenerator/photoCompose";
import { mergeImageUrls, parseImageUrls } from "@/lib/templateGenerator/photos";
import {
  pickThemedScenes,
  productPhotoContextFromRow,
  type ProductPhotoContext
} from "@/lib/templateGenerator/photoThemes";

const MAX_THEMED_VARIANTS = 3;

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

async function generateThemedWithRetry(apiKey: string, prompt: string): Promise<Buffer> {
  try {
    return await generateThemedBackground(apiKey, prompt);
  } catch {
    return generateThemedBackground(apiKey, `${prompt}, softer lighting, more depth`);
  }
}

export type GenerateRowPhotosOpts = {
  imageText: string;
  sku: string;
  minCount: number;
  targetCount: number;
  generateBackgrounds: boolean;
  openaiApiKey?: string;
  productContext?: ProductPhotoContext;
  photoStyle?: "themed" | "gradient";
};

export type GenerateRowPhotosResult = {
  imageUrls: string[];
  generated: string[];
  note?: string;
};

export async function resolveRowPhotos(opts: GenerateRowPhotosOpts): Promise<GenerateRowPhotosResult> {
  const existing = parseImageUrls(opts.imageText);
  const target = Math.max(opts.minCount, opts.targetCount);

  if (!opts.generateBackgrounds) {
    return { imageUrls: existing, generated: [] };
  }

  if (existing.length >= target) {
    return { imageUrls: existing, generated: [] };
  }

  const urls = parseImageUrls(opts.imageText);
  if (!urls.length) {
    return { imageUrls: existing, generated: [], note: "нет исходного foto в шаблоне/фиде" };
  }

  if (!getOzonStorageBackend()) {
    return {
      imageUrls: existing,
      generated: [],
      note: "хранилище фото не настроено (Yandex S3 или Vercel Blob)"
    };
  }

  const need = Math.min(target - existing.length, MAX_THEMED_VARIANTS);
  const useThemed = opts.photoStyle !== "gradient" && Boolean(opts.openaiApiKey?.trim());
  const ctx = opts.productContext ?? { brand: "", productName: opts.sku };

  let source: Buffer;
  try {
    source = await fetchBestProductSource(urls);
  } catch (e) {
    return {
      imageUrls: existing,
      generated: [],
      note: e instanceof Error ? e.message : "ошибка загрузки foto"
    };
  }

  let cutout: Buffer;
  try {
    cutout = await prepareLetualProductCutout(source);
  } catch {
    cutout = source;
  }

  const generated: string[] = [];
  const aiErrors: string[] = [];
  const themedCount = useThemed ? need : 0;
  const scenes = useThemed ? pickThemedScenes(ctx, themedCount) : [];

  for (const scene of scenes) {
    try {
      const bg = await generateThemedWithRetry(opts.openaiApiKey!, scene.prompt);
      const composed = await compositeOnBackground(cutout, bg);
      const url = await uploadGeneratedPhoto(composed, opts.sku, scene.id);
      generated.push(url);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "ошибка AI";
      aiErrors.push(msg);
      console.warn("themed photo failed:", scene.id, e);
    }
  }

  // SVG-градиенты только при явном выборе «Простые градиенты» в UI
  if (!generated.length && opts.photoStyle === "gradient") {
    const fallbackStyles: BackgroundStyle[] = ["marble", "warm-beige", "dark-luxury"];
    for (const style of fallbackStyles.slice(0, need)) {
      try {
        const bg = await renderBackground(style);
        const composed = await compositeOnBackground(cutout, bg);
        const url = await uploadGeneratedPhoto(composed, opts.sku, `gradient-${style}`);
        generated.push(url);
      } catch (e) {
        console.warn("gradient photo failed:", style, e);
      }
    }
  }

  if (!generated.length) {
    const hint = aiErrors[0] ? ` (${aiErrors[0].slice(0, 120)})` : "";
    if (useThemed) {
      return {
        imageUrls: existing,
        generated: [],
        note: `DALL·E не сгенерировал фон${hint}. Проверьте OPENAI_API_KEY на Vercel и баланс OpenAI.`
      };
    }
    if (opts.photoStyle !== "gradient") {
      return {
        imageUrls: existing,
        generated: [],
        note: "Для AI-фонов нужен OpenAI API key (в форме или OPENAI_API_KEY на Vercel)."
      };
    }
    return {
      imageUrls: existing,
      generated: [],
      note: `Не удалось сгенерировать фото${hint}`
    };
  }

  const themeLabels = scenes.slice(0, generated.length).map((s) => s.label).join(", ");
  return {
    imageUrls: mergeImageUrls(existing, generated),
    generated,
    note: themeLabels ? `темы: ${themeLabels}` : undefined
  };
}

export { productPhotoContextFromRow };
