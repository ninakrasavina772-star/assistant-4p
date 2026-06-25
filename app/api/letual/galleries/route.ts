import { NextResponse } from "next/server";
import { LETUAL_API_CHUNK } from "@/lib/letualMainPhotoConstants";
import { getLetualGalleriesBatch } from "@/lib/letualMainPhotoServer";

export const maxDuration = 300;

type GalleriesBody = {
  variationIds?: number[];
  metabaseApiKey?: string;
};

export async function POST(req: Request) {
  let body: GalleriesBody;
  try {
    body = (await req.json()) as GalleriesBody;
  } catch {
    return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  }

  const ids = Array.isArray(body.variationIds)
    ? body.variationIds.map((id) => Number(id)).filter((id) => id > 0)
    : [];
  if (!ids.length || ids.length > LETUAL_API_CHUNK) {
    return NextResponse.json(
      { error: `Передайте от 1 до ${LETUAL_API_CHUNK} variation_id за запрос` },
      { status: 400 }
    );
  }

  try {
    const galleries = await getLetualGalleriesBatch(ids, body.metabaseApiKey);
    return NextResponse.json({ galleries });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
