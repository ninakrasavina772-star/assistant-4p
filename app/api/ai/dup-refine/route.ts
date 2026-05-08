import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import {
  looksLikeOpenAiApiKey,
  refineDupPairsOpenAiBatch,
  refineDupPairsOpenAiVisionBatch,
  type DupPairRefineIn,
  type DupPairVerdict
} from "@/lib/openaiDupRefine";

export const maxDuration = 300;

function devSkipAuth(): boolean {
  return process.env.NODE_ENV === "development" && process.env.COMPARE_SKIP_AUTH === "1";
}

const MAX_PAIRS_TEXT = 80;
const MAX_PAIRS_VISION = 40;
const CHUNK_TEXT = 12;
const CHUNK_VISION = 4;

function safeHttpsUrl(raw: unknown, maxLen: number): string | undefined {
  if (typeof raw !== "string") return undefined;
  const u = raw.trim().slice(0, maxLen);
  if (!u || !/^https:\/\//i.test(u)) return undefined;
  return u;
}

function parsePairsBody(raw: unknown): DupPairRefineIn[] | null {
  if (!Array.isArray(raw)) return null;
  const out: DupPairRefineIn[] = [];
  for (const x of raw) {
    if (!x || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    const idA = typeof o.idA === "number" ? o.idA : Number(o.idA);
    const idB = typeof o.idB === "number" ? o.idB : Number(o.idB);
    if (!Number.isFinite(idA) || !Number.isFinite(idB)) continue;
    const titleA = typeof o.titleA === "string" ? o.titleA.slice(0, 500) : "";
    const titleB = typeof o.titleB === "string" ? o.titleB.slice(0, 500) : "";
    const brandA = typeof o.brandA === "string" ? o.brandA.slice(0, 200) : "";
    const brandB = typeof o.brandB === "string" ? o.brandB.slice(0, 200) : "";
    const layer = typeof o.layer === "string" ? o.layer.slice(0, 120) : "";
    const imageUrlA = safeHttpsUrl(o.imageUrlA, 2000);
    const imageUrlB = safeHttpsUrl(o.imageUrlB, 2000);
    out.push({
      idA: Math.floor(idA),
      idB: Math.floor(idB),
      titleA,
      titleB,
      brandA,
      brandB,
      layer,
      imageUrlA: imageUrlA ?? null,
      imageUrlB: imageUrlB ?? null
    });
  }
  return out;
}

export async function POST(req: NextRequest) {
  if (!devSkipAuth()) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Нужен вход" }, { status: 401 });
    }
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Некорректное тело запроса" }, { status: 400 });
  }

  const apiKey =
    typeof body.openaiApiKey === "string" ? body.openaiApiKey.trim() : "";
  if (!looksLikeOpenAiApiKey(apiKey)) {
    return NextResponse.json(
      { error: "Укажите ключ OpenAI API (начинается с sk-)" },
      { status: 400 }
    );
  }

  const pairs = parsePairsBody(body.pairs);
  if (!pairs || pairs.length === 0) {
    return NextResponse.json({ error: "Нет пар для проверки" }, { status: 400 });
  }

  const useVision =
    body.useVision === true ||
    body.vision === true ||
    body.mode === "vision";

  const maxPairs = useVision ? MAX_PAIRS_VISION : MAX_PAIRS_TEXT;
  if (pairs.length > maxPairs) {
    return NextResponse.json(
      { error: useVision ? `В режиме с фото не более ${MAX_PAIRS_VISION} пар за запрос` : `Не более ${MAX_PAIRS_TEXT} пар за один запрос` },
      { status: 400 }
    );
  }

  const model =
    typeof process.env.OPENAI_DUP_MODEL === "string" &&
    process.env.OPENAI_DUP_MODEL.trim()
      ? process.env.OPENAI_DUP_MODEL.trim()
      : "gpt-4o-mini";

  try {
    const verdicts: DupPairVerdict[] = [];
    const chunkSize = useVision ? CHUNK_VISION : CHUNK_TEXT;
    const refine = useVision ? refineDupPairsOpenAiVisionBatch : refineDupPairsOpenAiBatch;
    for (let i = 0; i < pairs.length; i += chunkSize) {
      const chunk = pairs.slice(i, i + chunkSize);
      const part = await refine(apiKey, chunk, model);
      verdicts.push(...part);
    }
    return NextResponse.json({ verdicts, model, useVision });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Ошибка OpenAI";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
