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

/**
 * Один Excel с тремя листами:
 *  1) Новинки B — все товары B, нет id на A. С колонкой «Статус» (дубль/чистая/не проверено).
 *  2) Найденные дубли — одна строка на пару (новинка B ↔ карточка A).
 *  3) Чистые + не проверено — товары B без дубля на A. Колонка «Статус проверки».
 */
export async function downloadCleanNoveltiesExcel(
  result: TwoFeedsCleanNoveltiesResult,
  nameLocale: NameLocale
): Promise<void> {
  if (typeof window === "undefined") return;
  const XLSX = await import("xlsx");

  /** id → статус (дубль/чистая/не проверено) и список id на A. */
  const statusById = new Map<
    number,
    { status: string; aIds: number[]; kinds: Set<string> }
  >();
  for (const dn of result.duplicateNovelties) {
    statusById.set(dn.novelty.id, {
      status: "дубль на A",
      aIds: dn.matches.map((m) => m.productOnAId),
      kinds: new Set(dn.matches.map((m) => kindRu(m.kind)))
    });
  }
  for (const cn of result.cleanNovelties) {
    statusById.set(cn.product.id, {
      status: cn.unverifiable
        ? "не удалось проверить (нет EAN и фото)"
        : "чистая (нет дубля на A)",
      aIds: [],
      kinds: new Set()
    });
  }

  // --- Лист 1: все новинки B ---
  const sheet1Rows = result.noveltiesAll.map((p) => {
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

  // --- Лист 2: найденные дубли (одна строка на пару) ---
  const idToNovelty = new Map<number, FpProduct>();
  for (const p of result.noveltiesAll) idToNovelty.set(p.id, p);

  const sheet2Rows = result.duplicatePairs.map((pair) => {
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
    /** На листе «Дубли» — префикс «B» к id, чтобы не путать с A. */
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

  // --- Лист 3: чистые + не проверено ---
  const sheet3Rows = result.cleanNovelties.map((c) =>
    clipRow({
      "Статус проверки": c.unverifiable
        ? "⚠ не удалось проверить (нет EAN и нет фото)"
        : "✓ дубля на A не найдено",
      ...baseColsForB(c.product, nameLocale)
    })
  );

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      sheet1Rows.length > 0 ? sheet1Rows : [{ Сообщение: "Новинки не найдены" }]
    ),
    "1. Новинки B"
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      sheet2Rows.length > 0 ? sheet2Rows : [{ Сообщение: "Дубли не найдены" }]
    ),
    "2. Найденные дубли"
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      sheet3Rows.length > 0 ? sheet3Rows : [{ Сообщение: "Чистых новинок нет" }]
    ),
    "3. Чистые + не проверено"
  );

  const sanitize = (s: string) =>
    (s || "").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 40);
  XLSX.writeFile(
    wb,
    `чистый_фид_${sanitize(result.siteBLabel || "B")}_vs_${sanitize(result.siteALabel || "A")}_${new Date().toISOString().slice(0, 10)}.xlsx`
  );
}
