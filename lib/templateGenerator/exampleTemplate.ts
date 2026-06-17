import type ExcelJS from "exceljs";
import { readWorkbookFromBuffer } from "@/lib/ozonImageExcel";
import { DEFAULT_PRODUCT_DATA_SHEET } from "@/lib/templateGenerator/presets";
import { collectRowContexts, scanTemplateWorkbook } from "@/lib/templateGenerator/scan";
import type { TemplateProductSample } from "@/lib/templateGenerator/chat";
import { extractWorkbookListValidations, sanitizeOzonXlsxBuffer } from "@/lib/templateGenerator/xlsxValidations";

const CONTENT_KEY =
  /бренд|название|тип|пол|семейство|описание|нот|объем|объём|линейка|год|состав|тестер|характеристик/i;

function trimVal(s: string, max = 200): string {
  const t = s.trim();
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

export function rowsToExampleSamples(
  rows: { sku: string; cells: Record<string, string> }[],
  limit = 8
): TemplateProductSample[] {
  return rows.slice(0, limit).map((r) => {
    const brand = r.cells["Бренд *"] ?? r.cells["Бренд"] ?? "";
    const name =
      r.cells["Название товара *"] ?? r.cells["Название товара"] ?? r.cells["name"] ?? "";
    const preview: Record<string, string> = {};
    for (const [k, v] of Object.entries(r.cells)) {
      if (!v.trim()) continue;
      if (CONTENT_KEY.test(k)) preview[k] = trimVal(v);
    }
    return { sku: r.sku, name, brand, preview };
  });
}

export function buildExampleReferenceText(samples: TemplateProductSample[]): string {
  if (!samples.length) return "";
  const lines = [
    "Эталон заполнения (образец — копируй стиль, формат и полноту, не выдумывай другие значения для конкретных SKU):"
  ];
  for (const s of samples) {
    lines.push(`SKU ${s.sku} | ${s.brand} | ${s.name}`);
    lines.push(JSON.stringify(s.preview));
  }
  return lines.join("\n");
}

export async function loadExampleTemplateSamples(
  buf: ArrayBuffer,
  preferredSheet?: string
): Promise<{ samples: TemplateProductSample[]; sheetName: string; rowCount: number }> {
  const listValidations = await extractWorkbookListValidations(buf);
  const safeBuf = await sanitizeOzonXlsxBuffer(buf);
  const workbook = await readWorkbookFromBuffer(safeBuf);
  const scanned = scanTemplateWorkbook(workbook, listValidations);
  const names = Object.keys(scanned.scans);

  let sheet =
    (preferredSheet && scanned.scans[preferredSheet] ? preferredSheet : null) ??
    (scanned.scans[DEFAULT_PRODUCT_DATA_SHEET] ? DEFAULT_PRODUCT_DATA_SHEET : null) ??
    names.sort(
      (a, b) => (scanned.scans[b]?.dataRowCount ?? 0) - (scanned.scans[a]?.dataRowCount ?? 0)
    )[0];

  if (!sheet) {
    return { samples: [], sheetName: "", rowCount: 0 };
  }

  const scan = scanned.scans[sheet]!;
  const ws = workbook.getWorksheet(sheet);
  if (!ws) return { samples: [], sheetName: sheet, rowCount: 0 };

  const rows = collectRowContexts(ws, scan).filter((r) =>
    Object.values(r.cells).some((v) => v.trim().length > 2)
  );
  return {
    samples: rowsToExampleSamples(rows),
    sheetName: sheet,
    rowCount: rows.length
  };
}
