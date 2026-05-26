import { flattenProductForExport } from "./exportOnlyB";
import type { NameLocale, TwoFeedsCleanNoveltiesResult } from "./types";

const XLSX_MAX_CELL_CHARS = 32767;

function clip(s: string): string {
  if (s.length <= XLSX_MAX_CELL_CHARS) return s;
  return s.slice(0, XLSX_MAX_CELL_CHARS - 30) + "…[обрезано лимитом Excel]";
}

function clipRow(row: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) out[k] = clip(v);
  return out;
}

function kindRu(kind: "ean" | "name_photo"): string {
  return kind === "ean" ? "EAN" : "название + фото";
}

/**
 * Один Excel с тремя листами:
 *  1) Новинки B (все, без id на A)
 *  2) Найденные дубли (пары новинка ↔ карточка A)
 *  3) Чистые новинки + не удалось проверить
 */
export async function downloadCleanNoveltiesExcel(
  result: TwoFeedsCleanNoveltiesResult,
  nameLocale: NameLocale
): Promise<void> {
  if (typeof window === "undefined") return;
  const XLSX = await import("xlsx");

  const idToNovelty = new Map<number, (typeof result.noveltiesAll)[number]>();
  for (const p of result.noveltiesAll) idToNovelty.set(p.id, p);

  // --- Лист 1: Все новинки B ---
  const sheet1Rows = result.noveltiesAll.map((p) =>
    clipRow(flattenProductForExport(p, nameLocale))
  );

  // --- Лист 2: Найденные дубли (одна строка на пару) ---
  const sheet2Rows = result.duplicatePairs.map((pair) => {
    const base = clipRow(flattenProductForExport(
      idToNovelty.get(pair.novelty.id) ?? ({ id: pair.novelty.id, name: "", link: "" } as never),
      nameLocale
    ));
    return clipRow({
      "Тип совпадения": kindRu(pair.kind),
      "Общий EAN (если есть)": pair.ean ?? "",
      "Вариация B (артикул) с этим EAN": pair.variantArticleOnB ?? "",
      "Совпадение (причины)": pair.reasons.join(" + "),
      [`ID товара на A (${result.siteALabel})`]: String(pair.productOnAId),
      [`Артикул на A (${result.siteALabel})`]: pair.productOnA.articleKey ?? "",
      [`Название на A (${result.siteALabel})`]:
        (nameLocale === "ru" ? pair.productOnA.nameRu : pair.productOnA.nameEn) ||
        pair.productOnA.nameRu ||
        pair.productOnA.nameEn ||
        "",
      [`Ссылка на A (${result.siteALabel})`]: pair.productOnA.link,
      [`EAN на A (${result.siteALabel})`]: pair.productOnA.eans.join(", "),
      ...base
    });
  });

  // --- Лист 3: Чистые + «не удалось проверить» ---
  const sheet3Rows = result.cleanNovelties.map((c) =>
    clipRow({
      "Не удалось проверить": c.unverifiable ? "да (нет EAN и фото)" : "",
      ...flattenProductForExport(c.product, nameLocale)
    })
  );

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(sheet1Rows.length ? sheet1Rows : [{ "Нет данных": "" }]),
    "Новинки B (по id)"
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(sheet2Rows.length ? sheet2Rows : [{ "Нет данных": "Дубли не найдены" }]),
    "Найденные дубли"
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(sheet3Rows.length ? sheet3Rows : [{ "Нет данных": "" }]),
    "Чистые + не проверено"
  );

  const safe = (result.siteBLabel || "B")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .slice(0, 40);
  XLSX.writeFile(
    wb,
    `чистый_фид_${safe}_vs_${(result.siteALabel || "A").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 40)}_${new Date().toISOString().slice(0, 10)}.xlsx`
  );
}
