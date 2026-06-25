import { NextResponse } from "next/server";
import { LETUAL_API_CHUNK } from "@/lib/letualMainPhotoConstants";
import { generateLetualFromSource } from "@/lib/letualMainPhotoServer";
import type { LetualGenerateItem } from "@/lib/letualPickTypes";

export const maxDuration = 300;

type GenerateBody = {
  items?: LetualGenerateItem[];
};

export async function POST(req: Request) {
  let body: GenerateBody;
  try {
    body = (await req.json()) as GenerateBody;
  } catch {
    return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  }

  const items = Array.isArray(body.items)
    ? body.items.filter((i) => i?.sourceUrl?.startsWith("http"))
    : [];
  if (!items.length || items.length > LETUAL_API_CHUNK) {
    return NextResponse.json(
      { error: `Передайте от 1 до ${LETUAL_API_CHUNK} позиций за запрос` },
      { status: 400 }
    );
  }

  const results = [];
  for (const item of items) {
    results.push(await generateLetualFromSource(item));
  }
  return NextResponse.json({ results });
}
