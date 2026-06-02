import { put } from "@vercel/blob";
import sharp from "sharp";
import { NextResponse } from "next/server";
import {
  buildOzonPublicImageUrl,
  blobPathname
} from "@/lib/ozonImagePublicUrl";
import {
  assertFetchableImageUrl,
  defaultAllowedHosts,
  filenameFromUrl,
  parseUrlList,
  type OzonUrlRow,
  replaceUrlList
} from "@/lib/ozonImageUrls";

export const maxDuration = 60;

type Body = {
  mode?: "replace" | "rehost";
  text?: string;
  urls?: string[];
  oldBase?: string;
  newBase?: string;
};

async function fetchImageBuffer(url: string, allowedHosts: string[]): Promise<Buffer> {
  assertFetchableImageUrl(url, allowedHosts);
  const res = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(45_000)
  });
  if (!res.ok) {
    throw new Error(`Не скачалось: HTTP ${res.status}`);
  }
  const ct = (res.headers.get("content-type") ?? "").toLowerCase();
  if (!ct.includes("image/jpeg") && !ct.includes("image/jpg") && !ct.includes("image/png")) {
    throw new Error(`Не картинка (Content-Type: ${ct || "нет"})`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) {
    throw new Error("Пустой файл");
  }
  if (buf.length > 10 * 1024 * 1024) {
    throw new Error("Файл больше 10 МБ (лимит Ozon)");
  }
  return buf;
}

/** Минимум 900 px по ширине — требование Ozon для части категорий */
async function ensureMinWidth(buf: Buffer, minWidth = 900): Promise<Buffer> {
  const img = sharp(buf);
  const meta = await img.metadata();
  const w = meta.width ?? 0;
  if (w >= minWidth) return buf;
  return img
    .resize({ width: minWidth, withoutEnlargement: false })
    .jpeg({ quality: 90 })
    .toBuffer();
}

async function rehostOne(
  input: string,
  allowedHosts: string[]
): Promise<OzonUrlRow> {
  try {
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    if (!token) {
      return {
        input,
        output: "",
        ok: false,
        error:
          "Облако не настроено: добавьте BLOB_READ_WRITE_TOKEN в Vercel (Storage → Blob)"
      };
    }

    let buf = await fetchImageBuffer(input, allowedHosts);
    buf = await ensureMinWidth(buf);

    const blobId = crypto.randomUUID();
    const name = filenameFromUrl(input);
    const pathname = blobPathname(blobId, name);
    const blob = await put(pathname, buf, {
      access: "public",
      contentType: name.toLowerCase().endsWith(".png")
        ? "image/png"
        : "image/jpeg",
      token
    });

    const storedName = blob.pathname.split("/").pop() ?? name;
    const output = buildOzonPublicImageUrl(blobId, storedName);

    return { input, output, ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Ошибка загрузки";
    return { input, output: "", ok: false, error: msg };
  }
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Неверный JSON" }, { status: 400 });
  }

  const mode = body.mode === "rehost" ? "rehost" : "replace";
  const urls =
    Array.isArray(body.urls) && body.urls.length > 0
      ? body.urls
      : parseUrlList(body.text ?? "");

  if (urls.length === 0) {
    return NextResponse.json({ error: "Вставьте хотя бы одну ссылку" }, { status: 400 });
  }
  if (urls.length > 500) {
    return NextResponse.json(
      { error: "Не больше 500 ссылок за один запрос" },
      { status: 400 }
    );
  }

  const allowedHosts = defaultAllowedHosts();

  if (mode === "replace") {
    const oldBase = body.oldBase?.trim();
    const newBase = body.newBase?.trim();
    if (!oldBase || !newBase) {
      return NextResponse.json(
        { error: "Укажите старый и новый адрес (https)" },
        { status: 400 }
      );
    }
    const rows = replaceUrlList(urls, oldBase, newBase);
    return NextResponse.json({
      mode,
      rows,
      okCount: rows.filter((r) => r.ok).length,
      failCount: rows.filter((r) => !r.ok).length
    });
  }

  const concurrency = 4;
  const rows: OzonUrlRow[] = [];
  for (let i = 0; i < urls.length; i += concurrency) {
    const chunk = urls.slice(i, i + concurrency);
    const part = await Promise.all(
      chunk.map((u) => rehostOne(u, allowedHosts))
    );
    rows.push(...part);
  }

  return NextResponse.json({
    mode,
    rows,
    okCount: rows.filter((r) => r.ok).length,
    failCount: rows.filter((r) => !r.ok).length
  });
}
