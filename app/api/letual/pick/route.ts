import { NextResponse } from "next/server";
import { LETUAL_API_CHUNK } from "@/lib/letualMainPhotoConstants";
import { pickLetualVariationPhoto } from "@/lib/letualMainPhotoServer";

export const maxDuration = 300;

type PickBody = {
  openaiApiKey?: string;
  metabaseApiKey?: string;
  variationIds?: number[];
};

export async function POST(req: Request) {
  let body: PickBody;
  try {
    body = (await req.json()) as PickBody;
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

  const results = [];
  for (const variationId of ids) {
    results.push(
      await pickLetualVariationPhoto(
        variationId,
        body.openaiApiKey,
        body.metabaseApiKey
      )
    );
  }
  return NextResponse.json({ results });
}
