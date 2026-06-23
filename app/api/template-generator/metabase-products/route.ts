import { NextResponse } from "next/server";
import {
  fetchMetabaseProductsByIds,
  metabaseProductIsConfigured
} from "@/lib/templateGenerator/metabaseProduct";
import { parseVariationIdsFromList } from "@/lib/templateGenerator/parseVariationIds";

export const maxDuration = 90;

export async function POST(req: Request) {
  if (!metabaseProductIsConfigured()) {
    return NextResponse.json({ error: "Metabase не настроен на сервере" }, { status: 503 });
  }

  let body: { variationIds?: unknown; includeYandexPrices?: boolean };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  }

  const ids = parseVariationIdsFromList(body.variationIds, 50);
  if (!ids.length) {
    return NextResponse.json({ error: "Передайте variationIds — массив числовых ID" }, { status: 400 });
  }

  const includeYandexPrices = body.includeYandexPrices !== false;

  try {
    const products = await fetchMetabaseProductsByIds(ids, undefined, {
      includeYandexPrices
    });
    const found = new Set(products.map((p) => p.variationId));
    const missing = ids.filter((id) => !found.has(id));
    const missingPrices = includeYandexPrices
      ? products.filter((p) => p.priceUsd == null).map((p) => p.variationId)
      : [];
    return NextResponse.json({ products, missing, missingPrices });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Ошибка Metabase";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
