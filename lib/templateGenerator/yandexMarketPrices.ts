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

/**
 * Цены калькулятора Яндекс Маркет (https://4stand.com/yandex-market/calculator/price).
 * Источник в Metabase: yandex_market.product (выгруженные на Маркет позиции).
 * Если price_currency = RUB — конвертируем в USD по курсу RUB→USD.
 */
export async function fetchYandexMarketPrices(
  ids: number[],
  metabaseApiKey?: string
): Promise<Map<number, YandexMarketPriceRow>> {
  const creds = resolveMetabaseCredentials(metabaseApiKey);
  if (!creds || !ids.length) return new Map();

  const inList = [...new Set(ids.filter((id) => id > 0))].join(",");
  if (!inList) return new Map();

  const sql = `
    WITH rate AS (
      SELECT value AS rub_usd
      FROM marketplace.setting_rate_history
      WHERE original = 'RUB' AND destination = 'USD'
      ORDER BY date DESC
      LIMIT 1
    )
    SELECT DISTINCT ON (product_variation_id)
      product_variation_id,
      CASE
        WHEN UPPER(COALESCE(NULLIF(TRIM(price_currency), ''), 'USD')) = 'RUB'
          THEN ROUND((price * rate.rub_usd)::numeric, 2)
        ELSE ROUND(price::numeric, 2)
      END AS price,
      'USD' AS price_currency
    FROM yandex_market.product
    CROSS JOIN rate
    WHERE product_variation_id IN (${inList})
      AND price IS NOT NULL
      AND price > 0
      AND rate.rub_usd IS NOT NULL
      AND rate.rub_usd > 0
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
    out.set(variationId, {
      variationId,
      price,
      currency: "USD"
    });
  }
  return out;
}
