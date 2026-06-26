import { NextResponse } from "next/server";
import { resolveOpenAiKey } from "@/lib/openaiServerKey";
import { fillTemplateRows, type FillBatchIn } from "@/lib/templateGenerator/aiFill";
import {
  hasFillColumns,
  mergeYandexContentFillBatch
} from "@/lib/templateGenerator/mergeFillColumns";
import { logActivity } from "@/lib/logActivity";

export const maxDuration = 300;

const MAX_ROWS = 1;

type FillBody = FillBatchIn & { activityTool?: string };

export async function POST(req: Request) {
  let body: FillBody;
  try {
    body = (await req.json()) as FillBody;
  } catch {
    return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  }

  try {
    body.openaiApiKey = resolveOpenAiKey(body.openaiApiKey);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Нужен openaiApiKey";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  const batch = mergeYandexContentFillBatch(body);
  if (!hasFillColumns(batch)) {
    return NextResponse.json(
      {
        error:
          "Не выбраны столбцы для заполнения. Обновите страницу (Ctrl+F5), отметьте поля или загрузите шаблон заново."
      },
      { status: 400 }
    );
  }
  const rows = Array.isArray(batch.rows) ? batch.rows : [];
  if (rows.length === 0 || rows.length > MAX_ROWS) {
    return NextResponse.json(
      { error: `Передайте от 1 до ${MAX_ROWS} строк за запрос` },
      { status: 400 }
    );
  }

  try {
    const results = await fillTemplateRows(batch);
    void logActivity({
      tool: body.activityTool?.trim() || "template-generator",
      action: "fill",
      items: rows.length,
      meta: { marketplace: body.marketplace }
    });
    return NextResponse.json({ results });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Ошибка";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
