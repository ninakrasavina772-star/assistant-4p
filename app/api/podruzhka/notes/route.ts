import { NextResponse } from "next/server";
import { fetchNotesForRows, type NotesBatchIn } from "@/lib/podruzhkaAi";
import {
  getFeedRowAiSkipReason,
  makeFeedRowAiErrorResult
} from "@/lib/podruzhkaExcel";
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

  const skipped: PodruzhkaFeedRow[] = [];
  const valid: PodruzhkaFeedRow[] = [];

  for (const r of rows) {
    const feedRow = r as PodruzhkaFeedRow;
    const skipReason = getFeedRowAiSkipReason(feedRow);
    if (skipReason) skipped.push(feedRow);
    else valid.push(feedRow);
  }

  const skippedResults = skipped.map((row) =>
    makeFeedRowAiErrorResult(row, getFeedRowAiSkipReason(row) ?? "Некорректная строка фида")
  );

  try {
    const aiResults =
      valid.length > 0
        ? await fetchNotesForRows({
            openaiApiKey: body.openaiApiKey ?? "",
            rows: valid,
            model: body.model
          })
        : [];

    return NextResponse.json({ results: [...skippedResults, ...aiResults] });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Ошибка";
    const fallback = valid.map((row) => makeFeedRowAiErrorResult(row, msg));
    return NextResponse.json({ results: [...skippedResults, ...fallback] });
  }
}
