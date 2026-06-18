import { NextResponse } from "next/server";
import {
  getOzonStorageBackend,
  storageBackendLabel
} from "@/lib/ozonImageStorage";
import { metabaseIsConfigured } from "@/lib/letualMetabase";

export async function GET() {
  const backend = getOzonStorageBackend();
  return NextResponse.json({
    configured: Boolean(backend),
    label: storageBackendLabel(),
    backend,
    metabase: metabaseIsConfigured(),
    serpapi: Boolean(process.env.SERPAPI_KEY?.trim()),
    openai: Boolean(process.env.OPENAI_API_KEY?.trim())
  });
}
