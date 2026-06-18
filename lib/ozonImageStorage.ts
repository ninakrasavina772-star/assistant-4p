import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { put } from "@vercel/blob";
import { buildOzonPublicImageUrl, blobPathname } from "@/lib/ozonImagePublicUrl";

export type OzonStorageBackend = "yandex" | "vercel-blob";

export function getOzonStorageBackend(): OzonStorageBackend | null {
  if (yandexConfigured()) return "yandex";
  if (process.env.BLOB_READ_WRITE_TOKEN?.trim()) return "vercel-blob";
  return null;
}

function yandexConfigured(): boolean {
  return Boolean(
    process.env.YANDEX_S3_BUCKET?.trim() &&
      process.env.YANDEX_S3_ACCESS_KEY_ID?.trim() &&
      process.env.YANDEX_S3_SECRET_ACCESS_KEY?.trim()
  );
}

function yandexPrefix(): string {
  const p = process.env.YANDEX_S3_PREFIX?.trim();
  return p ? p.replace(/^\/+|\/+$/g, "") : "ozon-images";
}

function yandexClient(): S3Client {
  const region = process.env.YANDEX_S3_REGION?.trim() || "ru-central1";
  const endpoint =
    process.env.YANDEX_S3_ENDPOINT?.trim() || "https://storage.yandexcloud.net";

  return new S3Client({
    region,
    endpoint,
    credentials: {
      accessKeyId: process.env.YANDEX_S3_ACCESS_KEY_ID!.trim(),
      secretAccessKey: process.env.YANDEX_S3_SECRET_ACCESS_KEY!.trim()
    },
    forcePathStyle: true
  });
}

export function buildYandexPublicUrl(objectKey: string): string {
  const custom = process.env.YANDEX_S3_PUBLIC_BASE_URL?.trim().replace(/\/+$/, "");
  if (custom) return `${custom}/${objectKey}`;

  const bucket = process.env.YANDEX_S3_BUCKET!.trim();
  const endpoint = (
    process.env.YANDEX_S3_ENDPOINT?.trim() || "https://storage.yandexcloud.net"
  ).replace(/\/+$/, "");
  return `${endpoint}/${bucket}/${objectKey}`;
}

function contentTypeForName(name: string): string {
  return name.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
}

async function uploadToYandex(buf: Buffer, fileName: string): Promise<string> {
  const id = crypto.randomUUID();
  const key = `${yandexPrefix()}/${id}/${fileName}`;
  const client = yandexClient();

  await client.send(
    new PutObjectCommand({
      Bucket: process.env.YANDEX_S3_BUCKET!.trim(),
      Key: key,
      Body: buf,
      ContentType: contentTypeForName(fileName),
      ACL: "public-read",
      CacheControl: "public, max-age=31536000, immutable"
    })
  );

  return buildYandexPublicUrl(key);
}

async function uploadToVercelBlob(buf: Buffer, fileName: string): Promise<string> {
  const token = process.env.BLOB_READ_WRITE_TOKEN!.trim();
  const blobId = crypto.randomUUID();
  const pathname = blobPathname(blobId, fileName);
  const blob = await put(pathname, buf, {
    access: "public",
    contentType: contentTypeForName(fileName),
    token
  });
  const storedName = blob.pathname.split("/").pop() ?? fileName;
  return buildOzonPublicImageUrl(blobId, storedName);
}

export async function uploadOzonImage(buf: Buffer, fileName: string): Promise<string> {
  const backend = getOzonStorageBackend();
  if (backend === "yandex") return uploadToYandex(buf, fileName);
  if (backend === "vercel-blob") return uploadToVercelBlob(buf, fileName);
  throw new Error(
    "Хранилище не настроено: добавьте Yandex Object Storage (рекомендуется для Ozon) или BLOB_READ_WRITE_TOKEN"
  );
}

/** Загрузка главного фото Летуаль (подпапка letual-main-photo). */
export async function uploadLetualMainPhoto(buf: Buffer, fileName = "main.jpg"): Promise<string> {
  const backend = getOzonStorageBackend();
  if (backend === "yandex") {
    const id = crypto.randomUUID();
    const base = yandexPrefix();
    const key = `${base}/letual-main-photo/${id}/${fileName}`;
    const client = yandexClient();
    await client.send(
      new PutObjectCommand({
        Bucket: process.env.YANDEX_S3_BUCKET!.trim(),
        Key: key,
        Body: buf,
        ContentType: contentTypeForName(fileName),
        ACL: "public-read",
        CacheControl: "public, max-age=31536000, immutable"
      })
    );
    return buildYandexPublicUrl(key);
  }
  if (backend === "vercel-blob") return uploadToVercelBlob(buf, fileName);
  throw new Error("Хранилище не настроено для загрузки фото Летуаль");
}

/** Загрузка по фиксированному ключу (кэш cut-out и т.п.). */
export async function uploadOzonImageAtKey(
  buf: Buffer,
  objectKey: string,
  contentType = "image/png"
): Promise<string> {
  if (getOzonStorageBackend() !== "yandex") {
    throw new Error("uploadOzonImageAtKey: нужен Yandex Object Storage");
  }
  const key = objectKey.replace(/^\/+/, "");
  const client = yandexClient();
  await client.send(
    new PutObjectCommand({
      Bucket: process.env.YANDEX_S3_BUCKET!.trim(),
      Key: key,
      Body: buf,
      ContentType: contentType,
      ACL: "public-read",
      CacheControl: "public, max-age=31536000, immutable"
    })
  );
  return buildYandexPublicUrl(key);
}

export function storageBackendLabel(): string {
  const b = getOzonStorageBackend();
  if (b === "yandex") return "Yandex Object Storage";
  if (b === "vercel-blob") return "Vercel Blob (запасной)";
  return "не настроено";
}
