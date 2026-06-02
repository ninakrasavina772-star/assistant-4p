/** Публичный URL картинки через домен ассистента (Ozon лучше принимает, чем vercel-storage.com). */
export function ozonPublicBaseUrl(): string {
  const fromEnv = process.env.OZON_IMAGE_PUBLIC_BASE?.trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, "");
  const auth = process.env.NEXTAUTH_URL?.trim();
  if (auth) return auth.replace(/\/+$/, "");
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL.replace(/^https?:\/\//, "")}`;
  }
  return "https://assistant-4p.vercel.app";
}

export function buildOzonPublicImageUrl(blobId: string, fileName: string): string {
  const base = ozonPublicBaseUrl();
  return `${base}/api/ozon-images/r/${blobId}/${encodeURIComponent(fileName)}`;
}

export function blobPathname(blobId: string, fileName: string): string {
  return `ozon-images/${blobId}/${fileName}`;
}
