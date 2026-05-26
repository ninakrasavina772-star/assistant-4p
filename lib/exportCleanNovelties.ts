import { productBrandName } from "./brand-filter";
import { collectEans, firstImageUrl, toCompareProduct } from "./product";
import type {
  CompareProduct,
  FpProduct,
  NameLocale,
  TwoFeedsCleanNoveltiesResult
} from "./types";

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

function pickName(p: FpProduct, locale: NameLocale): string {
  const ru = p.i18n?.ru?.name?.trim();
  const en = p.i18n?.en?.name?.trim();
  if (locale === "ru") return ru || p.name || en || "";
  return en || p.name || ru || "";
}

function pickDescription(p: FpProduct, locale: NameLocale): string {
  const ru = p.i18n?.ru?.description?.trim();
  const en = p.i18n?.en?.description?.trim();
  const base = p.description?.trim() || "";
  if (locale === "ru") return ru || base || en || "";
  return en || base || ru || "";
}

function nameFromCompare(c: CompareProduct, locale: NameLocale): string {
  return (locale === "ru" ? c.nameRu : c.nameEn) || c.nameRu || c.nameEn || "";
}

/** Базовый блок колонок для одной карточки B (используется в листах 1 и 3). */
function baseColsForB(p: FpProduct, locale: NameLocale): Record<string, string> {
  const eans = collectEans(p);
  const img = firstImageUrl(p) || "";
  const brand = productBrandName(p) || "";
  const extras = p.feedExtras ?? {};
  return {
    "ID товара": String(p.id),
    Артикул: String(p.article ?? ""),
    Название: pickName(p, locale),
    Бренд: brand,
    Объём: extras.volume ?? "",
    "EAN (все)": eans.join(", "),
    Ссылка: p.link || "",
    "Фото (первое)": img,
    Цена: extras.price ?? "",
    Остаток: extras.stock ?? "",
    Описание: pickDescription(p, locale)
  };
}

/** Блок колонок для карточки A (в листе «Найденные дубли»). */
function colsForA(
  c: CompareProduct,
  locale: NameLocale,
  siteA: string
): Record<string, string> {
  return {
    [`ID товара на A (${siteA})`]: String(c.id),
    [`Артикул A (${siteA})`]: c.articleKey ?? "",
    [`Название A (${siteA})`]: nameFromCompare(c, locale),
    [`Бренд A (${siteA})`]: c.brand,
    [`Объём A (${siteA})`]: c.attrVolume ?? "",
    [`EAN A (${siteA})`]: c.eans.join(", "),
    [`Ссылка A (${siteA})`]: c.link,
    [`Фото A (${siteA})`]: c.firstImage ?? ""
  };
}

function kindRu(kind: "ean" | "name_photo"): string {
  return kind === "ean" ? "EAN (один штрихкод)" : "название + фото";
}

function statusByIdMap(
  result: TwoFeedsCleanNoveltiesResult
): Map<number, { status: string; aIds: number[]; kinds: Set<string> }> {
  const m = new Map<
    number,
    { status: string; aIds: number[]; kinds: Set<string> }
  >();
  for (const dn of result.duplicateNovelties) {
    m.set(dn.novelty.id, {
      status: "дубль на A",
      aIds: dn.matches.map((mm) => mm.productOnAId),
      kinds: new Set(dn.matches.map((mm) => kindRu(mm.kind)))
    });
  }
  for (const cn of result.cleanNovelties) {
    m.set(cn.product.id, {
      status: cn.unverifiable
        ? "не удалось проверить (нет EAN и фото)"
        : "чистая (нет дубля на A)",
      aIds: [],
      kinds: new Set()
    });
  }
  return m;
}

function buildSheet1Rows(
  result: TwoFeedsCleanNoveltiesResult,
  nameLocale: NameLocale
): Record<string, string>[] {
  const statusById = statusByIdMap(result);
  return result.noveltiesAll.map((p) => {
    const st = statusById.get(p.id);
    return clipRow({
      Статус: st?.status ?? "—",
      "Тип совпадения":
        st && st.kinds.size > 0 ? [...st.kinds].join(", ") : "",
      "ID товара дубля на A":
        st && st.aIds.length > 0 ? st.aIds.join(", ") : "",
      ...baseColsForB(p, nameLocale)
    });
  });
}

function buildSheet2Rows(
  result: TwoFeedsCleanNoveltiesResult,
  nameLocale: NameLocale
): Record<string, string>[] {
  const idToNovelty = new Map<number, FpProduct>();
  for (const p of result.noveltiesAll) idToNovelty.set(p.id, p);
  return result.duplicatePairs.map((pair) => {
    const noveltyFp = idToNovelty.get(pair.novelty.id);
    const bBlock = noveltyFp
      ? baseColsForB(noveltyFp, nameLocale)
      : {
          "ID товара": String(pair.novelty.id),
          Артикул: pair.novelty.articleKey ?? "",
          Название: nameFromCompare(pair.novelty, nameLocale),
          Бренд: pair.novelty.brand,
          Объём: pair.novelty.attrVolume ?? "",
          "EAN (все)": pair.novelty.eans.join(", "),
          Ссылка: pair.novelty.link,
          "Фото (первое)": pair.novelty.firstImage ?? "",
          Цена: "",
          Остаток: "",
          Описание: ""
        };
    const bWithPrefix: Record<string, string> = {};
    for (const [k, v] of Object.entries(bBlock)) {
      const key =
        k === "ID товара"
          ? `ID товара на B (${result.siteBLabel})`
          : `${k} (B / ${result.siteBLabel})`;
      bWithPrefix[key] = v;
    }
    return clipRow({
      "Тип совпадения": kindRu(pair.kind),
      "Общий EAN": pair.ean ?? "",
      "Артикул вариации B по EAN": pair.variantArticleOnB ?? "",
      "Причины совпадения": pair.reasons.join(" + "),
      ...bWithPrefix,
      ...colsForA(pair.productOnA, nameLocale, result.siteALabel)
    });
  });
}

function buildSheet3Rows(
  result: TwoFeedsCleanNoveltiesResult,
  nameLocale: NameLocale,
  filter: "all" | "clean_only" | "unverifiable_only"
): Record<string, string>[] {
  return result.cleanNovelties
    .filter((c) => {
      if (filter === "clean_only") return !c.unverifiable;
      if (filter === "unverifiable_only") return c.unverifiable;
      return true;
    })
    .map((c) =>
      clipRow({
        "Статус проверки": c.unverifiable
          ? "⚠ не удалось проверить (нет EAN и нет фото)"
          : "✓ дубля на A не найдено",
        ...baseColsForB(c.product, nameLocale)
      })
    );
}

function sanitize(s: string): string {
  return (s || "").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 40);
}

function dateStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

function fileBase(result: TwoFeedsCleanNoveltiesResult): string {
  return `${sanitize(result.siteBLabel || "B")}_vs_${sanitize(result.siteALabel || "A")}_${dateStamp()}`;
}

async function writeSingleSheet(
  rows: Record<string, string>[],
  sheetName: string,
  fileName: string,
  emptyMessage: string
): Promise<void> {
  if (typeof window === "undefined") return;
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(rows.length > 0 ? rows : [{ Сообщение: emptyMessage }]),
    sheetName.slice(0, 28)
  );
  XLSX.writeFile(wb, fileName);
}

/** Один Excel с тремя листами: все новинки, дубли, чистые+не проверено. */
export async function downloadCleanNoveltiesExcel(
  result: TwoFeedsCleanNoveltiesResult,
  nameLocale: NameLocale
): Promise<void> {
  if (typeof window === "undefined") return;
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  const s1 = buildSheet1Rows(result, nameLocale);
  const s2 = buildSheet2Rows(result, nameLocale);
  const s3 = buildSheet3Rows(result, nameLocale, "all");
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(s1.length > 0 ? s1 : [{ Сообщение: "Новинки не найдены" }]),
    "1. Новинки B"
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(s2.length > 0 ? s2 : [{ Сообщение: "Дубли не найдены" }]),
    "2. Найденные дубли"
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(s3.length > 0 ? s3 : [{ Сообщение: "Чистых новинок нет" }]),
    "3. Чистые + не проверено"
  );
  XLSX.writeFile(wb, `чистый_фид_${fileBase(result)}.xlsx`);
}

/** Только лист «Все новинки B (по id)». */
export async function downloadNoveltiesAllOnlyExcel(
  result: TwoFeedsCleanNoveltiesResult,
  nameLocale: NameLocale
): Promise<void> {
  await writeSingleSheet(
    buildSheet1Rows(result, nameLocale),
    "Новинки B",
    `новинки_B_${fileBase(result)}.xlsx`,
    "Новинки не найдены"
  );
}

/** Только лист «Найденные дубли». */
export async function downloadDuplicatesOnlyExcel(
  result: TwoFeedsCleanNoveltiesResult,
  nameLocale: NameLocale
): Promise<void> {
  await writeSingleSheet(
    buildSheet2Rows(result, nameLocale),
    "Дубли",
    `дубли_${fileBase(result)}.xlsx`,
    "Дубли не найдены"
  );
}

/** Только «Чистые новинки» (без «не удалось проверить»). */
export async function downloadCleanOnlyExcel(
  result: TwoFeedsCleanNoveltiesResult,
  nameLocale: NameLocale
): Promise<void> {
  await writeSingleSheet(
    buildSheet3Rows(result, nameLocale, "clean_only"),
    "Чистые",
    `чистые_${fileBase(result)}.xlsx`,
    "Нет чистых новинок"
  );
}

/** Только «Не удалось проверить». */
export async function downloadUnverifiableOnlyExcel(
  result: TwoFeedsCleanNoveltiesResult,
  nameLocale: NameLocale
): Promise<void> {
  await writeSingleSheet(
    buildSheet3Rows(result, nameLocale, "unverifiable_only"),
    "Не проверено",
    `не_проверено_${fileBase(result)}.xlsx`,
    "Нет позиций «не удалось проверить»"
  );
}
