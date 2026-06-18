import { NextResponse } from "next/server";
import { fetchPodruzhkaProductImageDetailed } from "@/lib/podruzhkaImageFetch";
import { resolveAdaptiveProductPlacement } from "@/lib/podruzhkaProductAdaptive";
import { PODRUZHKA_COSMETICS_LAYOUT_VERSION } from "@/lib/podruzhkaCosmeticsLayout";

export const maxDuration = 120;

export async function GET(req: Request) {
  const url = new URL(req.url).searchParams.get("url")?.trim() ?? "";
  if (!url) {
    return NextResponse.json({ error: "Параметр url обязателен" }, { status: 400 });
  }

  const profile = (new URL(req.url).searchParams.get("profile")?.trim() ??
    "perfume") as "perfume" | "cosmetics";
  const safeProfile = profile === "cosmetics" ? "cosmetics" : "perfume";

  const fetched = await fetchPodruzhkaProductImageDetailed(url);
  if (!fetched.buf?.length) {
    return NextResponse.json(
      { error: fetched.error ?? "Не удалось скачать foto" },
      { status: 422 }
    );
  }

  const placement = await resolveAdaptiveProductPlacement(fetched.buf, safeProfile, url);

  return new NextResponse(new Uint8Array(placement.fit.buffer), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "private, max-age=300",
      "X-Podruzhka-Draw-X": String(placement.drawX),
      "X-Podruzhka-Draw-Y": String(placement.drawY),
      "X-Podruzhka-Width": String(placement.fit.width),
      "X-Podruzhka-Height": String(placement.fit.height),
      "X-Podruzhka-Fit-Strategy": placement.strategyId,
      ...(safeProfile === "cosmetics"
        ? { "X-Podruzhka-Layout-Version": PODRUZHKA_COSMETICS_LAYOUT_VERSION }
        : {})
    }
  });
}
