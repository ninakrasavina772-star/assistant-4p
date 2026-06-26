import { NextResponse } from "next/server";
import { openaiIsConfigured } from "@/lib/openaiServerKey";
import { openaiApiBase } from "@/lib/openaiFetch";
import { metabaseProductIsConfigured } from "@/lib/templateGenerator/metabaseProduct";
import { getOzonStorageBackend } from "@/lib/ozonImageStorage";

export async function GET() {
  const openaiEnv = Boolean(process.env.OPENAI_API_KEY?.trim());
  const metabaseEnv = metabaseProductIsConfigured();
  const storage = getOzonStorageBackend();
  const openaiBase = openaiApiBase();
  const openaiProxy = openaiBase !== "https://api.openai.com";

  return NextResponse.json({
    openai: openaiEnv,
    openaiViaUi: !openaiEnv,
    openaiProxy,
    openaiBase: openaiProxy ? openaiBase : undefined,
    /** На Yandex VM без прокси OpenAI отвечает unsupported_country_region_territory */
    openaiGeoBlockedRisk: openaiEnv && !openaiProxy,
    metabase: metabaseEnv,
    storage: storage ?? null
  });
}
