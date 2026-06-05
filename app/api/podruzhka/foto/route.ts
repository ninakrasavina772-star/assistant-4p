import { NextResponse } from "next/server";
import { fetchPodruzhkaProductImageDetailed } from "@/lib/podruzhkaImageFetch";

export const maxDuration = 60;

function guessContentType(buf: Buffer): string {
  if (buf[0] === 0x89 && buf[1] === 0x50) return "image/png";
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if (buf[0] === 0x47 && buf[1] === 0x49) return "image/gif";
  if (buf.length > 12 && buf.slice(8, 12).toString() === "WEBP") return "image/webp";
  return "application/octet-stream";
}

export async function GET(req: Request) {
  const url = new URL(req.url).searchParams.get("url")?.trim() ?? "";
  if (!url) {
    return NextResponse.json({ error: "Параметр url обязателен" }, { status: 400 });
  }

  const fetched = await fetchPodruzhkaProductImageDetailed(url);
  if (!fetched.buf?.length) {
    return NextResponse.json(
      { error: fetched.error ?? "Не удалось скачать foto" },
      { status: 422 }
    );
  }

  return new NextResponse(new Uint8Array(fetched.buf), {
    headers: {
      "Content-Type": guessContentType(fetched.buf),
      "Cache-Control": "private, max-age=300"
    }
  });
}
