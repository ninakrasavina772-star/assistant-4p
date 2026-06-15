import { NextResponse } from "next/server";

export const maxDuration = 60;

const MAX_BYTES = 40 * 1024 * 1024;

function filenameFromUrl(url: string): string {
  try {
    const p = new URL(url).pathname;
    const base = p.split("/").filter(Boolean).pop();
    return base || "feed.csv";
  } catch {
    return "feed.csv";
  }
}

export async function POST(req: Request) {
  let body: { url?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  }

  const raw = String(body.url ?? "").trim();
  if (!raw) {
    return NextResponse.json({ error: "Укажите ссылку на CSV" }, { status: 400 });
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return NextResponse.json({ error: "Некорректная ссылка" }, { status: 400 });
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return NextResponse.json({ error: "Допустимы только http/https ссылки" }, { status: 400 });
  }

  try {
    const res = await fetch(parsed.toString(), {
      redirect: "follow",
      signal: AbortSignal.timeout(55_000),
      headers: {
        Accept: "text/csv,text/plain,application/csv,*/*",
        "User-Agent": "assistant-4p-template-generator/1.0"
      }
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `Не удалось скачать CSV: HTTP ${res.status}` },
        { status: 502 }
      );
    }

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) {
      return NextResponse.json({ error: "Файл пустой" }, { status: 502 });
    }
    if (buf.length > MAX_BYTES) {
      return NextResponse.json({ error: "CSV больше 40 МБ" }, { status: 413 });
    }

    const text = buf.toString("utf8");
    return NextResponse.json({
      text,
      label: filenameFromUrl(parsed.toString()),
      bytes: buf.length
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Ошибка загрузки";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
