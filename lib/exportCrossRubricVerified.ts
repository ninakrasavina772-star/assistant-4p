import { alignVariationsBySize } from "./productVariations";
import type { CrossRubricVariationCatalog, NameLocale } from "./types";

export type VerifiedCrossRubricPair = {
  idA: number;
  idB: number;
};

function clipExcelRow(row: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = v.length > 32000 ? `${v.slice(0, 32000)}…` : v;
  }
  return out;
}

/**
 * Excel для контента: верные дубли с вариациями A и B, выровненными по размеру.
 */
export async function downloadVerifiedCrossRubricDupExcel(
  pairs: VerifiedCrossRubricPair[],
  catalog: CrossRubricVariationCatalog,
  siteALabel: string,
  siteBLabel: string,
  fileBase: string,
  _nameLocale: NameLocale = "ru"
): Promise<void> {
  if (typeof window === "undefined" || !pairs.length) return;
  const XLSX = await import("xlsx");
  const out: Record<string, string>[] = [];

  for (const { idA, idB } of pairs) {
    const varsA = catalog.a[idA] ?? [];
    const varsB = catalog.b[idB] ?? [];
    const aligned = alignVariationsBySize(varsA, varsB);

    for (const row of aligned) {
      out.push(
        clipExcelRow({
          "ID товара (сайт A)": String(idA),
          "ID вариации (сайт A)": row.a?.variationId ?? "",
          "Артикул вариации (A)": row.a?.article ?? "",
          "EAN вариации (A)": row.a?.ean ?? "",
          Размер: row.size,
          "ID товара (сайт B)": String(idB),
          "ID вариации (сайт B)": row.b?.variationId ?? "",
          "Артикул вариации (B)": row.b?.article ?? "",
          "EAN вариации (B)": row.b?.ean ?? "",
          [`Метка (${siteALabel})`]: siteALabel,
          [`Метка (${siteBLabel})`]: siteBLabel,
          "Верный дубль": "да"
        })
      );
    }
  }

  const ws = XLSX.utils.json_to_sheet(out);
  const wb = XLSX.utils.book_new();
  const safe = fileBase.replace(/[\\/:*?"<>|]+/g, "_").slice(0, 80);
  XLSX.utils.book_append_sheet(wb, ws, "верные_дубли");
  XLSX.writeFile(
    wb,
    `${safe}_верные_дубли_${new Date().toISOString().slice(0, 10)}.xlsx`
  );
}
