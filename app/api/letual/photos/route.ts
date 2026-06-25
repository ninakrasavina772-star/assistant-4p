import { NextResponse } from "next/server";
import { getLetualVariationGallery } from "@/lib/letualMainPhotoServer";
import { scoreLetualPhotoUrls } from "@/lib/letualPhotoAi";

export const maxDuration = 300;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const variationId = Number(searchParams.get("variationId") ?? searchParams.get("id"));
  const openaiKey = searchParams.get("openaiApiKey") ?? undefined;
  const score = searchParams.get("score") === "1";

  if (!variationId || variationId <= 0) {
    return NextResponse.json({ error: "Укажите variationId" }, { status: 400 });
  }

  try {
    const { variation, photos } = await getLetualVariationGallery(variationId);
    if (!variation) {
      return NextResponse.json({ error: `Вариация ${variationId} не найдена` }, { status: 404 });
    }

    let scored: Awaited<ReturnType<typeof scoreLetualPhotoUrls>> | undefined;
    if (score && openaiKey?.trim()) {
      const urls = photos.map((p) => p.url);
      scored = await scoreLetualPhotoUrls(urls, openaiKey.trim());
    }

    const scoreByUrl = new Map(scored?.map((s) => [s.url, s]) ?? []);

    return NextResponse.json({
      variation: {
        variationId: variation.variationId,
        productName: variation.productName,
        brandName: variation.brandName,
        ean: variation.ean
      },
      photos: photos.map((p) => ({
        ...p,
        score: scoreByUrl.get(p.url)
      }))
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
