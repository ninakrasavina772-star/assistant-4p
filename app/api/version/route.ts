import { NextResponse } from "next/server";
import { ASSISTANT_TOOL_UPDATES } from "@/lib/assistantToolUpdates";

export const dynamic = "force-dynamic";

/** Откройте в браузере: /api/version — видно, какая сборка на сервере. */
export async function GET() {
  const body = {
    ok: true,
    service: "assistant-4p",
    buildTime: process.env.BUILD_TIME ?? "dev",
    buildId: process.env.BUILD_ID ?? "local",
    toolUpdates: ASSISTANT_TOOL_UPDATES,
    features: {
      templateGeneratorYandexFill: "2025-06-25",
      infographicReview: "2025-06-25",
      perfumeRaw: "2025-06-25"
    },
    urls: {
      site: "https://assistant4p.ru",
      health: "/api/health",
      ozonPerfume: "/ozon-images",
      ozonCosmetics: "/ozon-images-cosmetics"
    }
  };

  return NextResponse.json(body, {
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
      Pragma: "no-cache"
    }
  });
}
