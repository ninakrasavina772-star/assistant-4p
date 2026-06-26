import { NextResponse } from "next/server";
import { LETUAL_API_CHUNK } from "@/lib/letualMainPhotoConstants";
import { autoPickPhotoReviewUrls } from "@/lib/templateGenerator/photoReviewAi";

export const maxDuration = 300;

type AutoPickBody = {
  rows?: { variationId: number; urls: string[] }[];
  openaiApiKey?: string;
  /** false = только быстрый технический отбор без Vision */
  useAi?: boolean;
};

export async function POST(req: Request) {
  let body: AutoPickBody;
  try {
    body = (await req.json()) as AutoPickBody;
  } catch {
    return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  }

  const rows = Array.isArray(body.rows) ? body.rows : [];
  if (!rows.length || rows.length > LETUAL_API_CHUNK) {
    return NextResponse.json(
      { error: `Передайте от 1 до ${LETUAL_API_CHUNK} позиций за запрос` },
      { status: 400 }
    );
  }

  const openaiApiKey = body.openaiApiKey?.trim() || process.env.OPENAI_API_KEY?.trim() || "";
  const useAi = body.useAi !== false && Boolean(openaiApiKey);
  const picks: Record<number, { mainUrl: string; extraUrls: string[] }> = {};

  try {
    for (const row of rows) {
      const vid = Number(row.variationId);
      if (!vid) continue;
      const pick = await autoPickPhotoReviewUrls(row.urls ?? [], { openaiApiKey, useAi });
      picks[vid] = { mainUrl: pick.mainUrl, extraUrls: pick.extraUrls };
    }
    return NextResponse.json({ picks, useAi });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
