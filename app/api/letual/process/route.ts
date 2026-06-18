import { NextResponse } from "next/server";
import { LETUAL_API_CHUNK } from "@/lib/letualMainPhotoConstants";
import {
  processLetualByUrl,
  processLetualByVariationId
} from "@/lib/letualMainPhotoServer";

export const maxDuration = 300;

type ProcessBody = {
  mode?: "variation" | "url";
  openaiApiKey?: string;
  variationIds?: number[];
  urls?: string[];
};

export async function POST(req: Request) {
  let body: ProcessBody;
  try {
    body = (await req.json()) as ProcessBody;
  } catch {
    return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  }

  const mode = body.mode === "url" ? "url" : "variation";

  if (mode === "variation") {
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
      results.push(await processLetualByVariationId(variationId, body.openaiApiKey));
    }
    return NextResponse.json({ results });
  }

  const urls = Array.isArray(body.urls)
    ? body.urls.filter((u): u is string => typeof u === "string" && u.startsWith("http"))
    : [];
  if (!urls.length || urls.length > LETUAL_API_CHUNK) {
    return NextResponse.json(
      { error: `Передайте от 1 до ${LETUAL_API_CHUNK} URL за запрос` },
      { status: 400 }
    );
  }

  const results = [];
  for (const sourceUrl of urls) {
    results.push(await processLetualByUrl(sourceUrl, body.openaiApiKey));
  }
  return NextResponse.json({ results });
}
