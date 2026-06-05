import { NextResponse } from "next/server";
import { PODRUZHKA_HTML_LAYOUT_VERSION } from "@/lib/podruzhkaHtmlSpec";
import { uploadOzonImage, getOzonStorageBackend } from "@/lib/ozonImageStorage";

export const maxDuration = 60;

export async function POST(req: Request) {
  if (!getOzonStorageBackend()) {
    return NextResponse.json(
      {
        error:
          "Хранилище не настроено (Yandex Object Storage или BLOB_READ_WRITE_TOKEN)"
      },
      { status: 503 }
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Ожидается multipart/form-data" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof Blob) || file.size < 1024) {
    return NextResponse.json({ error: "Файл file обязателен (JPEG)" }, { status: 400 });
  }

  try {
    const buf = Buffer.from(await file.arrayBuffer());
    const fileName = `podruzhka-${crypto.randomUUID().slice(0, 8)}.jpg`;
    const url = await uploadOzonImage(buf, fileName);

    return NextResponse.json({
      ok: true,
      url,
      layoutVersion: PODRUZHKA_HTML_LAYOUT_VERSION,
      fotoLoaded: true,
      layoutValidationOk: true
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Ошибка загрузки";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
