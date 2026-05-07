import type { FpProduct } from "./types";

/** Маркер строки заголовков в экспортном CSV 4Partners */
const HEADER_MARKERS = ["Id товара", "ID товара"];

export function stripPartnersFeedPreamble(fullText: string): string {
  const t = fullText.replace(/^\uFEFF/, "");
  const lines = t.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (
      HEADER_MARKERS.some((m) => line.includes(m)) &&
      (line.includes("Артикул") || line.includes("EAN"))
    ) {
      return lines.slice(i).join("\n");
    }
  }
  throw new Error(
    `В тексте не найдена строка заголовка CSV с «${HEADER_MARKERS[0]}» и колонкой артикула/EAN`
  );
}

function normCell(h: unknown): string {
  return String(h ?? "")
    .replace(/^\uFEFF/, "")
    .trim();
}

function findColIdx(headers: string[], ...names: string[]): number {
  const row = headers.map(normCell);
  for (const name of names) {
    const want = normCell(name).toLowerCase();
    const i = row.findIndex((h) => h.toLowerCase() === want);
    if (i >= 0) return i;
  }
  return -1;
}

type Agg = {
  id: number;
  name: string;
  link: string;
  brand: string;
  article: string;
  eans: Set<string>;
  images: string[];
};

function parseImageUrls(cell: string): string[] {
  const raw = cell.trim();
  if (!raw) return [];
  const parts = raw.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of parts) {
    if (!/^https?:\/\//i.test(p)) continue;
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(p);
    if (out.length >= 40) break;
  }
  return out;
}

function mergeAggs(aggs: Map<number, Agg>): FpProduct[] {
  const list: FpProduct[] = [];
  for (const a of aggs.values()) {
    const eans = [...a.eans].filter(Boolean);
    const imgs = a.images;
    const pv =
      imgs.length > 0
        ? {
            feed: {
              images: imgs.slice(0, 20)
            }
          }
        : undefined;
    list.push({
      id: a.id,
      name: a.name || `Товар ${a.id}`,
      link: a.link || "",
      brand: a.brand ? { name: a.brand } : undefined,
      article: a.article || undefined,
      ...(eans.length ? { eans } : {}),
      ...(pv ? { product_variation: pv as FpProduct["product_variation"] } : {})
    });
  }
  list.sort((x, y) => x.id - y.id);
  return list;
}

/**
 * Разбор CSV из личного кабинета 4Partners (лидер строк с Source URL допускается).
 */
export async function parsePartnersFeedCsv(csvText: string): Promise<FpProduct[]> {
  const stripped = stripPartnersFeedPreamble(csvText);
  const XLSX = await import("xlsx");
  const wb = XLSX.read(stripped, { type: "string" });
  const sh = wb.SheetNames[0];
  if (!sh) throw new Error("Пустой CSV после заголовка");
  const sheet = wb.Sheets[sh];
  const rows = XLSX.utils.sheet_to_json<(string | number | null | undefined)[]>(sheet, {
    header: 1,
    defval: "",
    raw: false
  });
  if (!rows.length) throw new Error("Нет строк данных");

  const headers = (rows[0] ?? []).map(normCell);
  const idIdx = findColIdx(headers, "Id товара", "ID товара");
  const artIdx = findColIdx(headers, "Артикул");
  const eanIdx = findColIdx(headers, "EAN");
  const brandIdx = findColIdx(headers, "Бренд");
  const urlIdx = findColIdx(headers, "Url", "URL");
  const nameIdx = findColIdx(headers, "Название товара");
  const imgIdx = findColIdx(headers, "Изображения варианта");

  if (idIdx < 0) throw new Error("Нет колонки «Id товара»");
  if (nameIdx < 0) throw new Error("Нет колонки «Название товара»");

  const aggs = new Map<number, Agg>();

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || !row.length) continue;
    const idRaw = row[idIdx];
    const id = typeof idRaw === "number" ? idRaw : Number(String(idRaw ?? "").trim());
    if (!Number.isFinite(id) || id < 1) continue;

    const article =
      artIdx >= 0 ? normCell(row[artIdx]) : "";
    const ean =
      eanIdx >= 0 ? normCell(row[eanIdx]) : "";
    const brand =
      brandIdx >= 0 ? normCell(row[brandIdx]) : "";
    const url =
      urlIdx >= 0 ? normCell(row[urlIdx]) : "";
    const title =
      nameIdx >= 0 ? normCell(row[nameIdx]) : "";
    const imgs =
      imgIdx >= 0 ? parseImageUrls(normCell(row[imgIdx])) : [];

    let agg = aggs.get(id);
    if (!agg) {
      agg = {
        id,
        name: title,
        link: url,
        brand,
        article,
        eans: new Set<string>(),
        images: []
      };
      aggs.set(id, agg);
    }
    if (title && !agg.name) agg.name = title;
    if (title && agg.name !== title && agg.name.length < title.length) agg.name = title;
    if (url && (!agg.link || url.length > agg.link.length)) agg.link = url;
    if (brand && !agg.brand) agg.brand = brand;
    if (article && !agg.article) agg.article = article;
    if (ean) agg.eans.add(ean);
    for (const im of imgs) {
      if (!agg.images.includes(im)) agg.images.push(im);
    }
  }

  if (!aggs.size) throw new Error("Не удалось прочитать ни одной строки с валидным Id товара");
  return mergeAggs(aggs);
}
