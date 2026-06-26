import { NextResponse } from "next/server";
import { openaiIsConfigured } from "@/lib/openaiServerKey";
import { openaiApiBase, openaiHttpProxy, openaiUsesProxy } from "@/lib/openaiFetch";
import { metabaseProductIsConfigured } from "@/lib/templateGenerator/metabaseProduct";
import { getOzonStorageBackend } from "@/lib/ozonImageStorage";

export async function GET() {
  const openaiEnv = Boolean(process.env.OPENAI_API_KEY?.trim());
  const metabaseEnv = metabaseProductIsConfigured();
  const storage = getOzonStorageBackend();
  const openaiBase = openaiApiBase();
  const httpProxy = openaiHttpProxy();
  const openaiProxy = openaiUsesProxy();

  return NextResponse.json({
    openai: openaiEnv,
    openaiViaUi: !openaiEnv,
    openaiProxy,
    openaiBase: openaiBase !== "https://api.openai.com" ? openaiBase : undefined,
    openaiHttpProxy: httpProxy ? httpProxy.replace(/:[^:@/]+@/, ":***@") : undefined,
    openaiGeoBlockedRisk: openaiEnv && !openaiProxy,
    metabase: metabaseEnv,
    storage: storage ?? null
  });
}
