import { NextResponse } from "next/server";
import { metabaseProductIsConfigured } from "@/lib/templateGenerator/metabaseProduct";
import { parseVariationIdsFromList } from "@/lib/templateGenerator/parseVariationIds";
import { fetchYandexMarketPrices } from "@/lib/templateGenerator/yandexMarketPrices";

export const maxDuration = 90;

export async function POST(req: Request) {
  if (!metabaseProductIsConfigured()) {
    return NextResponse.json({ error: "Metabase не настроен на сервере" }, { status: 503 });
  }

  let body: { variationIds?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  }

  const ids = parseVariationIdsFromList(body.variationIds, 200);
  if (!ids.length) {
    return NextResponse.json({ error: "Передайте variationIds" }, { status: 400 });
  }

  try {
    const map = await fetchYandexMarketPrices(ids);
    const prices = [...map.values()];
    const missing = ids.filter((id) => !map.has(id));
    return NextResponse.json({ prices, missing });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Ошибка Metabase";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
