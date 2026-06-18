import { NextResponse } from "next/server";
import { getOzonStorageBackend, storageBackendLabel } from "@/lib/ozonImageStorage";
import { metabaseIsConfigured } from "@/lib/letualMetabaseConfig";

export async function GET() {
  const backend = getOzonStorageBackend();
  const metabaseEnv = metabaseIsConfigured();
  return NextResponse.json({
    configured: Boolean(backend),
    label: storageBackendLabel(),
    backend,
    metabase: metabaseEnv,
    metabaseViaUi: !metabaseEnv,
    serpapi: Boolean(process.env.SERPAPI_KEY?.trim()),
    openai: Boolean(process.env.OPENAI_API_KEY?.trim())
  });
}
