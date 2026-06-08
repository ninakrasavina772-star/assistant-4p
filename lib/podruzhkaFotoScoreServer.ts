import sharp from "sharp";
import { fetchPodruzhkaProductImageDetailed } from "@/lib/podruzhkaImageFetch";
import { analyzePerfumePixels, type PerfumeImageAnalysis } from "@/lib/podruzhkaFotoAnalyzeCore";

export async function analyzePerfumeFotoUrlServer(url: string): Promise<PerfumeImageAnalysis> {
  const fetched = await fetchPodruzhkaProductImageDetailed(url);
  if (!fetched.buf?.length) {
    throw new Error(fetched.error ?? "Не удалось скачать foto");
  }

  const { data, info } = await sharp(fetched.buf)
    .resize(180, undefined, { fit: "inside" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return analyzePerfumePixels(data, info.width, info.height);
}
