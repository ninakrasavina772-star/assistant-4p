import { createHash } from "crypto";
import { readFileSync } from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { ASSISTANT_TOOL_UPDATES } from "@/lib/assistantToolUpdates";

export const dynamic = "force-dynamic";

function readBuildInfo(): { buildId?: string; buildTime?: string } | null {
  try {
    const filePath = path.join(process.cwd(), "public", "build-info.json");
    return JSON.parse(readFileSync(filePath, "utf8")) as { buildId?: string; buildTime?: string };
  } catch {
    return null;
  }
}

function buildContentRevision(buildId: string, buildTime: string): string {
  const payload = JSON.stringify({
    buildId,
    buildTime,
    toolUpdates: ASSISTANT_TOOL_UPDATES
  });
  return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

/** Откройте в браузере: /api/version — видно, какая сборка на сервере. */
export async function GET() {
  const fromFile = readBuildInfo();
  const buildTime = fromFile?.buildTime ?? process.env.BUILD_TIME ?? "dev";
  const buildId = fromFile?.buildId ?? process.env.BUILD_ID ?? "local";
  const contentRevision = buildContentRevision(buildId, buildTime);

  const body = {
    ok: true,
    service: "assistant-4p",
    buildTime,
    buildId,
    contentRevision,
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
