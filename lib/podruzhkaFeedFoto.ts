import type ExcelJS from "exceljs";
import type { PodruzhkaRenderProfile } from "@/lib/podruzhkaCosmeticsLayout";
import { cellAsUrlFromCell, cellPlainValue } from "@/lib/ozonImageExcel";
import { parseFotoUrlsFromText, pickBestFotoUrl } from "@/lib/podruzhkaFotoPick";

export type FeedFotoMapping = {
  foto?: number;
  fotoImages?: number;
};

export function isFeedFotoMapped(m: FeedFotoMapping): boolean {
  return Boolean((m.foto && m.foto > 0) || (m.fotoImages && m.fotoImages > 0));
}

export function resolveFeedFotoUrl(
  ws: ExcelJS.Worksheet,
  row: number,
  mapping: FeedFotoMapping,
  profile: PodruzhkaRenderProfile = "perfume"
): string {
  const multiCol = mapping.fotoImages;
  if (multiCol && multiCol > 0) {
    const cell = ws.getCell(row, multiCol);
    const text = [cellPlainValue(cell.value), cellAsUrlFromCell(cell)].filter(Boolean).join(" ");
    const urls = parseFotoUrlsFromText(text);
    const picked = pickBestFotoUrl(urls, profile);
    if (picked) return picked;
  }

  const singleCol = mapping.foto;
  if (!singleCol || singleCol < 1) return "";

  const cell = ws.getCell(row, singleCol);
  const single = cellAsUrlFromCell(cell);
  const multiInSingle = parseFotoUrlsFromText(
    [cellPlainValue(cell.value), single].filter(Boolean).join(" ")
  );
  if (multiInSingle.length > 1) return pickBestFotoUrl(multiInSingle, profile);
  return single;
}
