import { collectEans } from "./product";
import type { FpProduct } from "./types";

export type ProductVariationRow = {
  variationId: string;
  article?: string;
  ean?: string;
  size?: string;
};

function normSizeKey(raw: string | undefined): string {
  if (!raw?.trim()) return "";
  return raw
    .trim()
    .toLowerCase()
    .replace(/,/g, ".")
    .replace(/\s+/g, " ");
}

export function normSizeLabel(raw: string | undefined): string {
  return raw?.trim() || "";
}

export { normSizeKey };

function variationIdFromUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const m = url.match(/[?&]v=(\d+)/i);
  return m ? m[1] : undefined;
}

/** Все SKU/вариации карточки: из feedVariants, product_variation или одна строка на товар. */
export function collectProductVariations(p: FpProduct): ProductVariationRow[] {
  const out: ProductVariationRow[] = [];
  const seen = new Set<string>();

  const push = (row: ProductVariationRow) => {
    const vid = row.variationId.trim();
    if (!vid || seen.has(vid)) return;
    seen.add(vid);
    out.push({
      variationId: vid,
      ...(row.article ? { article: row.article } : {}),
      ...(row.ean ? { ean: row.ean } : {}),
      ...(row.size ? { size: row.size } : {})
    });
  };

  for (const v of p.feedVariants ?? []) {
    const vid = (v.variationId || v.article || "").trim();
    if (!vid) continue;
    push({
      variationId: vid,
      article: v.article,
      ean: v.ean,
      size: v.size
    });
  }

  const pv = p.product_variation;
  if (pv && typeof pv === "object") {
    for (const [key, val] of Object.entries(pv)) {
      if (key === "feed") continue;
      if (!val || typeof val !== "object") continue;
      const vo = val as Record<string, unknown>;
      const vid = String(vo.id ?? key).trim();
      if (!vid) continue;
      const eanRaw = vo.ean ?? vo.barcode ?? vo.gtin ?? vo.upc;
      push({
        variationId: vid,
        ean: eanRaw != null ? String(eanRaw) : undefined
      });
    }
  }

  if (!out.length) {
    const art = p.article ?? p.code ?? p.vendor_code;
    const eans = collectEans(p);
    push({
      variationId: art ? String(art) : String(p.id),
      article: art ? String(art) : undefined,
      ean: eans[0]
    });
  }

  return out;
}

export function variationIdFromProductLink(link: string | undefined): string | undefined {
  return variationIdFromUrl(link);
}

export type SizeAlignedVariationPair = {
  size: string;
  sizeKey: string;
  a?: ProductVariationRow;
  b?: ProductVariationRow;
};

/** Строки Excel: объединение размеров A и B, сопоставление по нормализованному size. */
export function alignVariationsBySize(
  varsA: ProductVariationRow[],
  varsB: ProductVariationRow[]
): SizeAlignedVariationPair[] {
  const mapA = new Map<string, ProductVariationRow[]>();
  const mapB = new Map<string, ProductVariationRow[]>();
  const noSizeA: ProductVariationRow[] = [];
  const noSizeB: ProductVariationRow[] = [];

  for (const v of varsA) {
    const k = normSizeKey(v.size);
    if (!k) {
      noSizeA.push(v);
      continue;
    }
    if (!mapA.has(k)) mapA.set(k, []);
    mapA.get(k)!.push(v);
  }
  for (const v of varsB) {
    const k = normSizeKey(v.size);
    if (!k) {
      noSizeB.push(v);
      continue;
    }
    if (!mapB.has(k)) mapB.set(k, []);
    mapB.get(k)!.push(v);
  }

  const keys = new Set([...mapA.keys(), ...mapB.keys()]);
  const rows: SizeAlignedVariationPair[] = [];

  for (const k of [...keys].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
    const la = mapA.get(k) ?? [];
    const lb = mapB.get(k) ?? [];
    const n = Math.max(la.length, lb.length, 1);
    for (let i = 0; i < n; i++) {
      rows.push({
        size: normSizeLabel(la[i]?.size || lb[i]?.size) || k,
        sizeKey: k,
        a: la[i],
        b: lb[i]
      });
    }
  }

  if (!rows.length && (noSizeA.length || noSizeB.length)) {
    const n = Math.max(noSizeA.length, noSizeB.length, 1);
    for (let i = 0; i < n; i++) {
      rows.push({
        size: "",
        sizeKey: "",
        a: noSizeA[i],
        b: noSizeB[i]
      });
    }
  }

  if (!rows.length) {
    rows.push({ size: "", sizeKey: "", a: varsA[0], b: varsB[0] });
  }

  return rows;
}
