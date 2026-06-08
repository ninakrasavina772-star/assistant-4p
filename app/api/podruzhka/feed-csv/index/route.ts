import { NextResponse } from "next/server";
import { fetchPartnersFeedText } from "@/lib/partnersFeedFetch";
import { buildVariantImagesIndex } from "@/lib/podruzhkaFeedCsvMerge";

export const maxDuration = 300;

const MAX_CSV_CHARS = 100 * 1024 * 1024;

export async function POST(req: Request) {
  let body: { url?: unknown; csvText?: unknown };
  try {
    body = (await req.json()) as { url?: unknown; csvText?: unknown };
  } catch {
    return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  }

  const url = typeof body.url === "string" ? body.url.trim() : "";
  const csvTextRaw = typeof body.csvText === "string" ? body.csvText : "";

  if (url && csvTextRaw.trim()) {
    return NextResponse.json(
      { error: "Укажите либо ссылку на CSV, либо текст из файла — не оба сразу" },
      { status: 400 }
    );
  }

  let csvText = "";
  if (url) {
    try {
      csvText = await fetchPartnersFeedText(url);
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "Не удалось скачать CSV" },
        { status: 422 }
      );
    }
  } else {
    csvText = csvTextRaw.trim();
    if (!csvText) {
      return NextResponse.json(
        {
          error:
            "Нужна ссылка вида https://….4partners.io/my/feed/….csv или загрузите CSV-файл"
        },
        { status: 400 }
      );
    }
    if (csvText.length > MAX_CSV_CHARS) {
      return NextResponse.json({ error: "CSV слишком большой" }, { status: 413 });
    }
  }

  try {
    const { byArticle, variantRows } = await buildVariantImagesIndex(csvText);
    const byArticleObj = Object.fromEntries(byArticle);
    return NextResponse.json({
      byArticle: byArticleObj,
      variantRows,
      bytes: csvText.length
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Ошибка разбора CSV" },
      { status: 422 }
    );
  }
}
