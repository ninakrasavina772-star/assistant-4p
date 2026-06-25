import { NextResponse } from "next/server";
import { LETUAL_API_CHUNK } from "@/lib/letualMainPhotoConstants";
import { pickLetualVariationPhotosBatch } from "@/lib/letualMainPhotoServer";

export const maxDuration = 300;

type PickBody = {
  openaiApiKey?: string;
  metabaseApiKey?: string;
  variationIds?: number[];
  /** false = полная AI-оценка (медленно). По умолчанию быстрый подбор из Metabase. */
  quickPick?: boolean;
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

  const quickPick = body.quickPick !== false;
  if (!quickPick && !body.openaiApiKey?.trim() && !process.env.OPENAI_API_KEY?.trim()) {
    return NextResponse.json(
      { error: "Для AI-подбора укажите OpenAI API key" },
      { status: 400 }
    );
  }

  const results = await pickLetualVariationPhotosBatch(
    ids,
    body.openaiApiKey,
    body.metabaseApiKey,
    { quickPick }
  );
  return NextResponse.json({ results });
}
