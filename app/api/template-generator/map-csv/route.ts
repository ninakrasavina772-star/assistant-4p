import { NextResponse } from "next/server";
import { mapCsvColumnsWithAi } from "@/lib/templateGenerator/aiFill";
import { mergeCsvMapHeuristic } from "@/lib/templateGenerator/csvIndex";

export const maxDuration = 60;

export async function POST(req: Request) {
  let body: {
    openaiApiKey?: string;
    csvHeaders?: string[];
    templateHeaders?: string[];
    sampleRows?: string[][];
    model?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  }

  const csvHeaders = body.csvHeaders ?? [];
  const templateHeaders = body.templateHeaders ?? [];
  const sampleRows = body.sampleRows ?? [];

  if (!csvHeaders.length || !templateHeaders.length) {
    return NextResponse.json({ error: "Нужны csvHeaders и templateHeaders" }, { status: 400 });
  }

  const heuristic = mergeCsvMapHeuristic({ headers: csvHeaders, rows: sampleRows }, templateHeaders);

  if (!body.openaiApiKey?.trim()) {
    return NextResponse.json({ map: heuristic });
  }

  try {
    const map = await mapCsvColumnsWithAi(
      body.openaiApiKey,
      csvHeaders,
      templateHeaders,
      sampleRows,
      body.model
    );
    return NextResponse.json({
      map: {
        skuColumn: map.skuColumn || heuristic.skuColumn,
        columns: { ...heuristic.columns, ...map.columns }
      }
    });
  } catch {
    return NextResponse.json({ map: heuristic });
  }
}
