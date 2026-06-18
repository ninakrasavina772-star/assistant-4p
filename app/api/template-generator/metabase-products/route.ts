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

  let body: { variationIds?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  }

  const ids = parseVariationIdsFromList(body.variationIds, 50);
  if (!ids.length) {
    return NextResponse.json({ error: "Передайте variationIds — массив числовых ID" }, { status: 400 });
  }

  try {
    const products = await fetchMetabaseProductsByIds(ids);
    const found = new Set(products.map((p) => p.variationId));
    const missing = ids.filter((id) => !found.has(id));
    return NextResponse.json({ products, missing });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Ошибка Metabase";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
