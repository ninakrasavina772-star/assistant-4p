import { NextResponse } from "next/server";
import { renderInfographicDetailed } from "@/lib/podruzhkaCanvasRender";
import { uploadOzonImage, getOzonStorageBackend } from "@/lib/ozonImageStorage";
import type { PodruzhkaInfographicData, PodruzhkaNoteBlock } from "@/lib/podruzhkaTypes";

export const maxDuration = 60;

type Body = {
  brandName?: string;
  productType?: string;
  model?: string;
  ml?: string;
  fotoUrl?: string;
  notes?: PodruzhkaNoteBlock[];
  openaiKey?: string;
};

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  }

  if (!getOzonStorageBackend()) {
    return NextResponse.json(
      {
        error:
          "Хранилище не настроено (Yandex Object Storage или BLOB_READ_WRITE_TOKEN)"
      },
      { status: 503 }
    );
  }

  const brandName = String(body.brandName ?? "").trim();
  const productType = String(body.productType ?? "").trim();
  const model = String(body.model ?? "").trim();
  const ml = String(body.ml ?? "").trim();
  const fotoUrl = String(body.fotoUrl ?? "").trim();
  const notes = Array.isArray(body.notes) ? body.notes.slice(0, 3) : [];
  const openaiKey = typeof body.openaiKey === "string" ? body.openaiKey.trim() : undefined;

  if (!brandName || !model || notes.length < 3) {
    return NextResponse.json(
      { error: "Нужны brandName, model и 3 блока нот" },
      { status: 400 }
    );
  }

  for (const n of notes) {
    if (!n.title?.trim() || !n.desc?.trim()) {
      return NextResponse.json({ error: "Пустой блок нот" }, { status: 400 });
    }
  }

  try {
    const data: PodruzhkaInfographicData = {
      brandName,
      productType,
      model,
      ml,
      fotoUrl,
      notes: notes.map((n) => ({
        title: n.title.trim(),
        desc: n.desc.trim()
      }))
    };

    const rendered = await renderInfographicDetailed({ data }, openaiKey);
    const fileName = `podruzhka-${crypto.randomUUID().slice(0, 8)}.jpg`;
    const url = await uploadOzonImage(rendered.buffer, fileName);

    return NextResponse.json({
      ok: true,
      url,
      fotoLoaded: rendered.fotoLoaded,
      ...(rendered.fotoError ? { fotoError: rendered.fotoError } : {}),
      ...(rendered.visionUsed ? { visionUsed: true, visionReasoning: rendered.visionReasoning } : {})
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Ошибка рендера";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
