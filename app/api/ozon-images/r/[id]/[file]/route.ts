import { head } from "@vercel/blob";

export const maxDuration = 30;

type Params = { params: Promise<{ id: string; file: string }> };

/** Прокси: отдаём JPEG/PNG с домена assistant-4p.vercel.app для Ozon */
export async function GET(_req: Request, { params }: Params) {
  const { id, file } = await params;
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    return new Response("Blob not configured", { status: 503 });
  }

  const safeId = id.replace(/[^a-f0-9-]/gi, "");
  const fileName = decodeURIComponent(file);
  if (!safeId || !fileName || fileName.includes("..")) {
    return new Response("Bad request", { status: 400 });
  }

  const pathname = `ozon-images/${safeId}/${fileName}`;

  try {
    const meta = await head(pathname, { token });
    const res = await fetch(meta.url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) {
      return new Response("Not found", { status: 404 });
    }
    const body = res.body;
    if (!body) {
      return new Response("Empty", { status: 502 });
    }

    return new Response(body, {
      headers: {
        "Content-Type": meta.contentType || "image/jpeg",
        "Cache-Control": "public, max-age=31536000, immutable",
        ...(meta.size ? { "Content-Length": String(meta.size) } : {})
      }
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
