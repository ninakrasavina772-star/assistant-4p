import {
  resolveMetabaseCredentials,
  type MetabaseCredentials
} from "@/lib/letualMetabaseConfig";

export type YandexMarketPriceRow = {
  variationId: number;
  price: number;
  currency: string;
};

async function metabaseQuery<T = Record<string, unknown>>(
  sql: string,
  creds: MetabaseCredentials
): Promise<T[]> {
  const res = await fetch(`${creds.url}/api/dataset`, {
    method: "POST",
    headers: {
      "X-API-KEY": creds.apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      type: "native",
      native: { query: sql },
      database: creds.databaseId
    }),
    signal: AbortSignal.timeout(90_000)
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Metabase HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    data?: { rows?: unknown[][]; cols?: { name?: string }[] };
  };
  const rows = json.data?.rows ?? [];
  const cols = json.data?.cols ?? [];
  return rows.map((row) => {
    const obj: Record<string, unknown> = {};
    cols.forEach((c, i) => {
      const key = (c.name ?? `col_${i}`).toLowerCase();
      obj[key] = row[i];
    });
    return obj as T;
  });
}

function formatPrice(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

/** Цены калькулятора Яндекс Маркет (4stand) из yandex_market.product, валюта USD */
export async function fetchYandexMarketPrices(
  ids: number[],
  metabaseApiKey?: string
): Promise<Map<number, YandexMarketPriceRow>> {
  const creds = resolveMetabaseCredentials(metabaseApiKey);
  if (!creds || !ids.length) return new Map();

  const inList = [...new Set(ids.filter((id) => id > 0))].join(",");
  if (!inList) return new Map();

  const sql = `
    SELECT DISTINCT ON (product_variation_id)
      product_variation_id,
      price,
      price_currency
    FROM yandex_market.product
    WHERE product_variation_id IN (${inList})
      AND price IS NOT NULL
      AND price > 0
    ORDER BY product_variation_id, stock_price_date DESC NULLS LAST, id DESC
  `;

  const rows = await metabaseQuery<{
    product_variation_id: number;
    price: number;
    price_currency: string | null;
  }>(sql, creds);

  const out = new Map<number, YandexMarketPriceRow>();
  for (const r of rows) {
    const price = formatPrice(r.price);
    if (price == null) continue;
    const variationId = Number(r.product_variation_id);
    const currency = String(r.price_currency ?? "USD").trim().toUpperCase() || "USD";
    out.set(variationId, { variationId, price, currency });
  }
  return out;
}
