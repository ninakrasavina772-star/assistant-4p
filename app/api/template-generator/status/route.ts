import { NextResponse } from "next/server";
import { openaiIsConfigured } from "@/lib/openaiServerKey";
import { metabaseProductIsConfigured } from "@/lib/templateGenerator/metabaseProduct";
import { getOzonStorageBackend } from "@/lib/ozonImageStorage";

export async function GET() {
  const openaiEnv = Boolean(process.env.OPENAI_API_KEY?.trim());
  const metabaseEnv = metabaseProductIsConfigured();
  const storage = getOzonStorageBackend();

  return NextResponse.json({
    openai: openaiEnv,
    openaiViaUi: !openaiEnv,
    metabase: metabaseEnv,
    storage: storage ?? null
  });
}
