import type ExcelJS from "exceljs";
import { cellPlainValue } from "@/lib/ozonImageExcel";
import { normVariationSku } from "@/lib/templateGenerator/parseVariationIds";
import type { TemplateSheetScan, TemplateRowContext } from "@/lib/templateGenerator/types";
import type { YandexMarketPriceRow } from "@/lib/templateGenerator/yandexMarketPrices";

function findHeader(scan: TemplateSheetScan, patterns: RegExp[]): string | null {
  for (const c of scan.columns) {
    const h = c.header.toLowerCase();
    if (patterns.some((p) => p.test(h))) return c.header;
  }
  return null;
}

function colForHeader(scan: TemplateSheetScan, header: string | null): number | null {
  if (!header) return null;
  return scan.columns.find((c) => c.header === header)?.col ?? null;
}

export function findYandexPriceHeaders(scan: TemplateSheetScan): {
  priceHeader: string | null;
  currencyHeader: string | null;
  priceCol: number | null;
  currencyCol: number | null;
} {
  const priceHeader = findHeader(scan, [/^цена$/i, /^price$/i]);
  const currencyHeader = findHeader(scan, [/^валюта$/i, /^currency$/i]);
  return {
    priceHeader,
    currencyHeader,
    priceCol: colForHeader(scan, priceHeader),
    currencyCol: colForHeader(scan, currencyHeader)
  };
}

function formatPriceCell(price: number): string {
  if (Number.isInteger(price)) return String(price);
  return String(price);
}

/** Записать цену USD из калькулятора в строки шаблона */
export function applyYandexPricesToWorksheet(
  ws: ExcelJS.Worksheet,
  scan: TemplateSheetScan,
  contexts: TemplateRowContext[],
  prices: Map<number, YandexMarketPriceRow>,
  opts?: { overwrite?: boolean }
): { filled: number; missing: number[] } {
  const overwrite = opts?.overwrite ?? false;
  const { priceCol, currencyCol } = findYandexPriceHeaders(scan);
  if (!priceCol) return { filled: 0, missing: [] };

  let filled = 0;
  const missing: number[] = [];

  for (const ctx of contexts) {
    const id = normVariationSku(ctx.sku);
    if (!id) continue;
    const row = prices.get(id);
    if (!row) {
      missing.push(id);
      continue;
    }

    if (!overwrite) {
      const existing = cellPlainValue(ws.getCell(ctx.row, priceCol).value).trim();
      if (existing) continue;
    }

    ws.getCell(ctx.row, priceCol).value = formatPriceCell(row.price);
    if (currencyCol) {
      ws.getCell(ctx.row, currencyCol).value = row.currency || "USD";
    }
    filled++;
  }

  return { filled, missing };
}
