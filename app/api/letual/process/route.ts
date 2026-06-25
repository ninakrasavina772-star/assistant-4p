import { NextResponse } from "next/server";
import { LETUAL_API_CHUNK } from "@/lib/letualMainPhotoConstants";
import {
  generateLetualFromSourcesBatch,
  pickLetualVariationPhotosBatch
} from "@/lib/letualMainPhotoServer";

export const maxDuration = 300;

type ProcessBody = {
  mode?: "variation" | "url";
  openaiApiKey?: string;
  metabaseApiKey?: string;
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

    const picks = await pickLetualVariationPhotosBatch(
      ids,
      body.openaiApiKey,
      body.metabaseApiKey
    );

    const toGen = picks
      .filter((p) => p.sourceUrl && !p.error)
      .map((p) => ({ variationId: p.variationId, sourceUrl: p.sourceUrl }));

    const genRows = await generateLetualFromSourcesBatch(toGen);
    const genById = new Map(genRows.map((g) => [g.variationId, g]));

    const results = picks.map((pick) => {
      const gen = genById.get(pick.variationId);
      if (!gen) {
        return {
          variationId: pick.variationId,
          resultUrl: "",
          comment: pick.comment,
          ok: false,
          error: pick.error ?? (pick.sourceUrl ? "Ошибка генерации" : "Нет фото")
        };
      }
      return {
        variationId: pick.variationId,
        sourceUrl: gen.sourceUrl,
        resultUrl: gen.resultUrl,
        comment: pick.comment,
        previewUrl: gen.previewUrl,
        ok: gen.ok,
        error: gen.error
      };
    });

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

  const results = await generateLetualFromSourcesBatch(
    urls.map((sourceUrl) => ({ sourceUrl }))
  );
  return NextResponse.json({ results });
}
