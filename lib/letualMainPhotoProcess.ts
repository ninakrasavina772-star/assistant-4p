import sharp from "sharp";
import {
  cropToVisibleProduct,
  preprocessCosmeticsProductBufferEdge
} from "@/lib/podruzhkaImageProcess";
import { fetchLetualImageDetailed } from "@/lib/letualFotoQuality";
import { compositeLetualMainPhoto } from "@/lib/letualMainPhotoLayout";

export async function downloadImageBuffer(url: string): Promise<Buffer> {
  const fetched = await fetchLetualImageDetailed(url);
  if (!fetched?.buf?.length) {
    throw new Error("Не удалось скачать изображение");
  }
  return fetched.buf;
}

async function hasSignificantTransparency(buf: Buffer): Promise<boolean> {
  const meta = await sharp(buf).metadata();
  if (!meta.hasAlpha) return false;
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const total = info.width * info.height;
  if (!total) return false;
  let transparent = 0;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i]! < 128) transparent++;
  }
  return transparent / total > 0.12;
}

/** Снять фон и подогнать под требования Летуаль. */
export async function processLetualMainPhotoFromUrl(sourceUrl: string): Promise<Buffer> {
  const raw = await downloadImageBuffer(sourceUrl);

  if (await hasSignificantTransparency(raw)) {
    const png = await sharp(raw).ensureAlpha().png().toBuffer();
    return compositeLetualMainPhoto(png);
  }

  const cutout = await preprocessCosmeticsProductBufferEdge(raw);
  const cropped = await cropToVisibleProduct(cutout, 8, 0.02, 4);
  return compositeLetualMainPhoto(cropped);
}

export async function processLetualMainPhotoFromBuffer(raw: Buffer): Promise<Buffer> {
  const cutout = await preprocessCosmeticsProductBufferEdge(raw);
  const cropped = await cropToVisibleProduct(cutout, 8, 0.02, 4);
  return compositeLetualMainPhoto(cropped);
}
