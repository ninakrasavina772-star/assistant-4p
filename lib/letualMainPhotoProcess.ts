import {
  cropToVisibleProduct,
  preprocessCosmeticsProductBufferEdge
} from "@/lib/podruzhkaImageProcess";
import { fetchPodruzhkaProductImageDetailed } from "@/lib/podruzhkaImageFetch";
import { compositeLetualMainPhoto } from "@/lib/letualMainPhotoLayout";

export async function downloadImageBuffer(url: string): Promise<Buffer> {
  const fetched = await fetchPodruzhkaProductImageDetailed(url);
  if (!fetched.buf?.length) {
    throw new Error(fetched.error ?? "Не удалось скачать изображение");
  }
  return fetched.buf;
}

/** Снять фон и подогнать под требования Летуаль. */
export async function processLetualMainPhotoFromUrl(sourceUrl: string): Promise<Buffer> {
  const raw = await downloadImageBuffer(sourceUrl);
  const cutout = await preprocessCosmeticsProductBufferEdge(raw);
  const cropped = await cropToVisibleProduct(cutout, 8, 0.02, 4);
  return compositeLetualMainPhoto(cropped);
}

export async function processLetualMainPhotoFromBuffer(raw: Buffer): Promise<Buffer> {
  const cutout = await preprocessCosmeticsProductBufferEdge(raw);
  const cropped = await cropToVisibleProduct(cutout, 8, 0.02, 4);
  return compositeLetualMainPhoto(cropped);
}
