import { NextResponse } from "next/server";
import { fetchPodruzhkaProductImageDetailed } from "@/lib/podruzhkaImageFetch";
import { fitProductPng } from "@/lib/podruzhkaImageProcess";
import { PODRUZHKA_FIGMA as F } from "@/lib/podruzhkaFigmaLayout";
import { PODRUZHKA_REFERENCE as R } from "@/lib/podruzhkaReferenceSpec";

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

  const fit = await fitProductPng(fetched.buf, F.product.w, F.product.h, {
    cardW: R.size.w,
    cardH: R.size.h,
    referenceBoxOnly: true
  });

  const drawX = F.product.x + F.product.w - fit.width;
  const inset = fit.bottomAlphaInset ?? 0;
  const drawY = Math.max(F.product.y, F.product.y + F.product.h - fit.height + inset);

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
