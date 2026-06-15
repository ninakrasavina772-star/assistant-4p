import { NextResponse } from "next/server";
import { fillTemplateRows, type FillBatchIn } from "@/lib/templateGenerator/aiFill";

export const maxDuration = 120;

const MAX_ROWS = 2;

export async function POST(req: Request) {
  let body: FillBatchIn;
  try {
    body = (await req.json()) as FillBatchIn;
  } catch {
    return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  }

  if (!body.openaiApiKey?.trim()) {
    return NextResponse.json({ error: "Нужен openaiApiKey" }, { status: 400 });
  }

  const rows = Array.isArray(body.rows) ? body.rows : [];
  if (rows.length === 0 || rows.length > MAX_ROWS) {
    return NextResponse.json(
      { error: `Передайте от 1 до ${MAX_ROWS} строк за запрос` },
      { status: 400 }
    );
  }

  try {
    const results = await fillTemplateRows(body);
    return NextResponse.json({ results });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Ошибка";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
