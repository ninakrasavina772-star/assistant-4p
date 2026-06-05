import { NextResponse } from "next/server";
import { fetchNotesForRows, type NotesBatchIn } from "@/lib/podruzhkaAi";
import type { PodruzhkaFeedRow } from "@/lib/podruzhkaTypes";

export const maxDuration = 60;

/** Параллельно внутри запроса; укладываемся в maxDuration 60 с */
const MAX_ROWS = 5;

export async function POST(req: Request) {
  let body: NotesBatchIn;
  try {
    body = (await req.json()) as NotesBatchIn;
  } catch {
    return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  }

  const rows = Array.isArray(body.rows) ? body.rows : [];
  if (rows.length === 0 || rows.length > MAX_ROWS) {
    return NextResponse.json(
      { error: `Передайте от 1 до ${MAX_ROWS} строк за запрос` },
      { status: 400 }
    );
  }

  for (const r of rows) {
    if (typeof r.row !== "number" || !r.brandName) {
      return NextResponse.json({ error: "Некорректная строка фида" }, { status: 400 });
    }
  }

  try {
    const results = await fetchNotesForRows({
      openaiApiKey: body.openaiApiKey ?? "",
      rows: rows as PodruzhkaFeedRow[],
      model: body.model
    });
    return NextResponse.json({ results });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Ошибка";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
