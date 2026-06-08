import { NextResponse } from "next/server";
import { pickBestPerfumeFotoServer } from "@/lib/podruzhkaFotoPickServer";

export const maxDuration = 60;

export async function POST(req: Request) {
  let body: { urls?: unknown };
  try {
    body = (await req.json()) as { urls?: unknown };
  } catch {
    return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  }

  const urls = Array.isArray(body.urls)
    ? body.urls.filter((u): u is string => typeof u === "string")
    : [];

  if (!urls.length) {
    return NextResponse.json({ error: "urls обязателен" }, { status: 400 });
  }

  const { url, ranked } = await pickBestPerfumeFotoServer(urls);
  if (!url) {
    return NextResponse.json({ error: "Нет валидных URL" }, { status: 422 });
  }

  return NextResponse.json({ url, ranked });
}
