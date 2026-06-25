import { appOriginOrLegacy } from "@/lib/appOrigin";

/** Публичный URL картинки через домен ассистента (Ozon лучше принимает, чем vercel-storage.com). */
export function ozonPublicBaseUrl(): string {
  const fromEnv = process.env.OZON_IMAGE_PUBLIC_BASE?.trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, "");
  return appOriginOrLegacy();
}

export function buildOzonPublicImageUrl(blobId: string, fileName: string): string {
  const base = ozonPublicBaseUrl();
  return `${base}/api/ozon-images/r/${blobId}/${encodeURIComponent(fileName)}`;
}

export function blobPathname(blobId: string, fileName: string): string {
  return `ozon-images/${blobId}/${fileName}`;
}
