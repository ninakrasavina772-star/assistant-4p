import { NextResponse } from "next/server";
import { fetchPodruzhkaProductImageDetailed } from "@/lib/podruzhkaImageFetch";
import { fitProductPng } from "@/lib/podruzhkaImageProcess";
import { PODRUZHKA_REFERENCE as R } from "@/lib/podruzhkaReferenceSpec";
import {
  computeProductDrawPlacement,
  PODRUZHKA_PRODUCT_FIT,
  PODRUZHKA_PRODUCT_VISUAL,
  productVisualHeight
} from "@/lib/podruzhkaProductPlacement";

export const maxDuration = 60;

export async function GET(req: Request) {
  const url = new URL(req.url).searchParams.get("url")?.trim() ?? "";
  if (!url) {
    return NextResponse.json({ error: "Параметр url обязателен" }, { status: 400 });
  }

  const fetched = await fetchPodruzhkaProductImageDetailed(url);
  if (!fetched.buf?.length) {
    return NextResponse.json(
      { error: fetched.error ?? "Не удалось скачать foto" },
      { status: 422 }
    );
  }

  const zoneW = PODRUZHKA_PRODUCT_VISUAL.w;
  const zoneH = productVisualHeight();

  const fit = await fitProductPng(fetched.buf, zoneW, zoneH, {
    cardW: R.size.w,
    cardH: R.size.h,
    referenceBoxOnly: true,
    referenceBoxScale: PODRUZHKA_PRODUCT_FIT.referenceBoxScale,
    referenceBoxMinHeightFill: PODRUZHKA_PRODUCT_FIT.referenceBoxMinHeightFill,
    referenceBoxMinWidthFill: PODRUZHKA_PRODUCT_FIT.referenceBoxMinWidthFill,
    referenceBoxMinCardHeightFill: PODRUZHKA_PRODUCT_FIT.referenceBoxMinCardHeightFill
  });

  const { drawX, drawY } = computeProductDrawPlacement(fit);

  return new NextResponse(new Uint8Array(fit.buffer), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "private, max-age=300",
      "X-Podruzhka-Draw-X": String(drawX),
      "X-Podruzhka-Draw-Y": String(drawY),
      "X-Podruzhka-Width": String(fit.width),
      "X-Podruzhka-Height": String(fit.height)
    }
  });
}
