import { NextResponse } from "next/server";
import { resolvePerfumeFotoServer } from "@/lib/podruzhkaFotoResolveServer";
import { parseVariationId } from "@/lib/podruzhkaVariationId";

export const maxDuration = 90;

export async function POST(req: Request) {
  let body: {
    variationId?: unknown;
    variationRaw?: unknown;
    templateFoto?: unknown;
    csvUrls?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  }

  const csvUrls = Array.isArray(body.csvUrls)
    ? body.csvUrls.filter((u): u is string => typeof u === "string")
    : [];

  const variationId =
    typeof body.variationId === "number" && body.variationId > 0
      ? body.variationId
      : typeof body.variationRaw === "string"
        ? parseVariationId(body.variationRaw)
        : null;

  const result = await resolvePerfumeFotoServer({
    variationId,
    templateFoto: typeof body.templateFoto === "string" ? body.templateFoto : "",
    csvUrls
  });

  if (!result.url) {
    return NextResponse.json(
      { error: "Не найдено подходящее фото", ...result },
      { status: 422 }
    );
  }

  return NextResponse.json(result);
}
