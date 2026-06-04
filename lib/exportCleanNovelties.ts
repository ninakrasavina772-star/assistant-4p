import { collectProductsForCleanFeedAiLookup } from "./cleanFeedAiPairs";
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

/** Один Excel с четырьмя листами: все новинки, дубли с A, чистые, дубли внутри B. */
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
  const s4 = buildInternalDupRows(result, nameLocale);
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(s1.length > 0 ? s1 : [{ Сообщение: "Новинки не найдены" }]),
    "1. Новинки B"
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(s2.length > 0 ? s2 : [{ Сообщение: "Дубли не найдены" }]),
    "2. Дубли с A"
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(s3.length > 0 ? s3 : [{ Сообщение: "Чистых новинок нет" }]),
    "3. Чистые + не проверено"
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      s4.length > 0 ? s4 : [{ Сообщение: "Внутренних дублей не найдено" }]
    ),
    "4. Дубли среди новинок"
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

function buildInternalDupRows(
  result: TwoFeedsCleanNoveltiesResult,
  nameLocale: NameLocale
): Record<string, string>[] {
  const idToNovelty = new Map<number, FpProduct>();
  for (const p of result.noveltiesAll) idToNovelty.set(p.id, p);
  const pairs = result.internalDuplicatePairs ?? [];
  return pairs.map((pair) => {
    const fpA = idToNovelty.get(pair.aId);
    const fpB = idToNovelty.get(pair.bId);
    const aBlock = fpA
      ? baseColsForB(fpA, nameLocale)
      : {
          "ID товара": String(pair.aId),
          Артикул: pair.a.articleKey ?? "",
          Название: nameFromCompare(pair.a, nameLocale),
          Бренд: pair.a.brand,
          Объём: pair.a.attrVolume ?? "",
          "EAN (все)": pair.a.eans.join(", "),
          Ссылка: pair.a.link,
          "Фото (первое)": pair.a.firstImage ?? "",
          Цена: "",
          Остаток: "",
          Описание: ""
        };
    const bBlock = fpB
      ? baseColsForB(fpB, nameLocale)
      : {
          "ID товара": String(pair.bId),
          Артикул: pair.b.articleKey ?? "",
          Название: nameFromCompare(pair.b, nameLocale),
          Бренд: pair.b.brand,
          Объём: pair.b.attrVolume ?? "",
          "EAN (все)": pair.b.eans.join(", "),
          Ссылка: pair.b.link,
          "Фото (первое)": pair.b.firstImage ?? "",
          Цена: "",
          Остаток: "",
          Описание: ""
        };
    const renamed = (
      block: Record<string, string>,
      tag: "A" | "B"
    ): Record<string, string> => {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(block)) {
        const key =
          k === "ID товара"
            ? `ID товара (${tag} / ${result.siteBLabel})`
            : `${k} (${tag} / ${result.siteBLabel})`;
        out[key] = v;
      }
      return out;
    };
    return clipRow({
      "Тип совпадения": kindRu(pair.kind),
      "Общий EAN": pair.ean ?? "",
      "Причины совпадения": pair.reasons.join(" + "),
      ...renamed(aBlock, "A"),
      ...renamed(bBlock, "B")
    });
  });
}

/** Только лист «Дубли среди новинок» (внутренние дубли B ↔ B). */
export async function downloadInternalDupsOnlyExcel(
  result: TwoFeedsCleanNoveltiesResult,
  nameLocale: NameLocale
): Promise<void> {
  await writeSingleSheet(
    buildInternalDupRows(result, nameLocale),
    "Дубли среди новинок",
    `дубли_среди_новинок_${fileBase(result)}.xlsx`,
    "Внутренних дублей не найдено"
  );
}

/** AI-вердикт по одной паре «чистая новинка B ↔ кандидат с A». */
export type CleanAiVerdictForExport = {
  noveltyBId: number;
  productOnAId: number;
  duplicate: boolean;
  confidence: number;
  note?: string;
};

/** Строки листа «AI-дубли»: только положительные вердикты. */
function buildAiDupRows(
  result: TwoFeedsCleanNoveltiesResult,
  nameLocale: NameLocale,
  verdicts: CleanAiVerdictForExport[]
): Record<string, string>[] {
  const byId = collectProductsForCleanFeedAiLookup(result);
  const fpById = new Map<number, FpProduct>();
  for (const p of result.noveltiesAll) fpById.set(p.id, p);
  const positives = verdicts
    .filter((v) => v.duplicate)
    .sort((a, b) => b.confidence - a.confidence);
  const rows: Record<string, string>[] = [];
  for (const v of positives) {
    const idLo = Math.min(v.noveltyBId, v.productOnAId);
    const idHi = Math.max(v.noveltyBId, v.productOnAId);
    const cardLo = byId.get(idLo);
    const cardHi = byId.get(idHi);
    const fpLo = fpById.get(idLo);
    const fpHi = fpById.get(idHi);
    if (!cardLo || !cardHi) continue;
    const bFp = fpLo ?? fpHi;
    const aCard = cardLo.id === idLo ? cardLo : cardHi;
    const bCard = cardLo.id === idLo ? cardHi : cardLo;
    const bBlock = bFp
      ? baseColsForB(bFp, nameLocale)
      : {
          "ID товара": String(bCard.id),
          Название: nameLocale === "ru" ? bCard.nameRu : bCard.nameEn,
          Бренд: bCard.brand
        };
    const bWithPrefix: Record<string, string> = {};
    for (const [k, val] of Object.entries(bBlock)) {
      const key =
        k === "ID товара"
          ? `ID товара на B (${result.siteBLabel})`
          : `${k} (B / ${result.siteBLabel})`;
      bWithPrefix[key] = val;
    }
    const aLabel =
      result.stats.countA > 0 ? result.siteALabel : result.siteBLabel;
    rows.push(
      clipRow({
        "AI вердикт": "дубль",
        "AI уверенность %": String(Math.round(v.confidence * 100)),
        "AI комментарий": v.note ?? "",
        "ID карточки 1": String(idLo),
        "ID карточки 2": String(idHi),
        ...bWithPrefix,
        ...colsForA(aCard, nameLocale, aLabel)
      })
    );
  }
  return rows;
}

/** Только лист «AI-дубли» (положительные вердикты). */
export async function downloadAiDuplicatesOnlyExcel(
  result: TwoFeedsCleanNoveltiesResult,
  nameLocale: NameLocale,
  verdicts: CleanAiVerdictForExport[]
): Promise<void> {
  await writeSingleSheet(
    buildAiDupRows(result, nameLocale, verdicts),
    "AI дубли",
    `AI_дубли_${fileBase(result)}.xlsx`,
    "AI пока не нашёл дублей или проверка не запускалась"
  );
}
