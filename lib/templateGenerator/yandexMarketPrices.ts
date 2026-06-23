import {
  resolveMetabaseCredentials,
  type MetabaseCredentials
} from "@/lib/letualMetabaseConfig";

export type YandexMarketPriceSource = "yandex_market" | "calculator";

export type YandexMarketPriceRow = {
  variationId: number;
  price: number;
  currency: string;
  source?: YandexMarketPriceSource;
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

function parseSource(value: unknown): YandexMarketPriceSource | undefined {
  const s = String(value ?? "").trim().toLowerCase();
  if (s === "yandex_market" || s === "calculator") return s;
  return undefined;
}

/**
 * Цены калькулятора Яндекс Маркет (https://4stand.com/yandex-market/calculator/price):
 * 1) yandex_market.product — уже выгруженные на Маркет (USD или RUB→USD)
 * 2) Расчёт как в калькуляторе: оффер EUR + наценка + DE-PL-RU(YM) + склад → RUB → USD
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
      SELECT
        (SELECT value FROM marketplace.setting_rate_history
         WHERE original = 'EUR' AND destination = 'RUB' ORDER BY date DESC LIMIT 1) AS eur_rub,
        (SELECT value FROM marketplace.setting_rate_history
         WHERE original = 'RUB' AND destination = 'USD' ORDER BY date DESC LIMIT 1) AS rub_usd
    ),
    cfg AS (
      SELECT
        COALESCE((SELECT margin FROM yandex_market.seller WHERE is_active LIMIT 1), 10)::numeric AS margin_pct,
        COALESCE((SELECT fee FROM public.site WHERE id = 4574), 29)::numeric AS mp_fee_pct,
        9::numeric AS currency_rate_margin_pct,
        2.1::numeric AS store_eur
    ),
    ym AS (
      SELECT DISTINCT ON (product_variation_id)
        product_variation_id,
        CASE
          WHEN UPPER(COALESCE(NULLIF(TRIM(price_currency), ''), 'USD')) = 'RUB'
            THEN ROUND((price * rate.rub_usd)::numeric, 2)
          ELSE ROUND(price::numeric, 2)
        END AS price_usd,
        'yandex_market' AS price_source
      FROM yandex_market.product
      CROSS JOIN rate
      WHERE product_variation_id IN (${inList})
        AND price IS NOT NULL AND price > 0
        AND rate.rub_usd IS NOT NULL AND rate.rub_usd > 0
      ORDER BY product_variation_id, stock_price_date DESC NULLS LAST, id DESC
    ),
    pv AS (
      SELECT
        id AS product_variation_id,
        GREATEST(COALESCE(weight_kg, 0.1), 0.05) AS weight_kg,
        CEIL(GREATEST(COALESCE(weight_kg, 0.1), 0.05) * 1000)::int AS weight_g
      FROM public.product_variation
      WHERE id IN (${inList})
    ),
    ym_ship AS (
      SELECT rates::jsonb AS rates_json
      FROM marketplace.delivery_rate
      WHERE id = 169
      LIMIT 1
    ),
    last_buyout AS (
      SELECT DISTINCT ON (s.product_variation_id)
        s.product_variation_id,
        s.price_per_item::numeric AS source_eur
      FROM marketplace.sku s
      WHERE s.product_variation_id IN (${inList})
        AND s.currency = 'EUR'
        AND s.price_per_item IS NOT NULL
        AND s.price_per_item::numeric > 0
      ORDER BY s.product_variation_id, s.create_date DESC
    ),
    min_xborder AS (
      SELECT DISTINCT ON (o.product_variation_id)
        o.product_variation_id,
        o.price::numeric AS source_eur
      FROM public.offer o
      JOIN public.vendor v ON v.id = o.vendor_id
      WHERE o.product_variation_id IN (${inList})
        AND COALESCE(o.quantity, 0) > 0
        AND o.price_currency = 'EUR'
        AND v.is_active = true
        AND COALESCE(v.banned_for_letu, false) = false
        AND v.name ILIKE '%XBorder%'
      ORDER BY o.product_variation_id, o.price ASC
    ),
    source AS (
      SELECT
        pv.product_variation_id,
        COALESCE(lb.source_eur, mx.source_eur) AS source_eur,
        pv.weight_g
      FROM pv
      LEFT JOIN last_buyout lb ON lb.product_variation_id = pv.product_variation_id
      LEFT JOIN min_xborder mx ON mx.product_variation_id = pv.product_variation_id
    ),
    ship AS (
      SELECT
        s.product_variation_id,
        COALESCE(
          (
            SELECT (elem->'prices'->>'ru')::numeric
            FROM ym_ship ys
            CROSS JOIN LATERAL jsonb_array_elements(ys.rates_json) elem
            WHERE (elem->>'weight')::int >= s.weight_g
            ORDER BY (elem->>'weight')::int ASC
            LIMIT 1
          ),
          12.33
        ) AS ship_eur
      FROM source s
    ),
    calc AS (
      SELECT
        s.product_variation_id,
        CEIL(
          (
            s.source_eur * (1 + cfg.margin_pct / 100.0)
            + sh.ship_eur
            + cfg.store_eur
          )
          * rate.eur_rub
          * (1 + cfg.currency_rate_margin_pct / 100.0)
          / (1 - cfg.mp_fee_pct / 100.0)
        )::numeric AS total_rub
      FROM source s
      JOIN ship sh ON sh.product_variation_id = s.product_variation_id
      CROSS JOIN cfg
      CROSS JOIN rate
      WHERE s.source_eur IS NOT NULL
        AND rate.eur_rub IS NOT NULL AND rate.eur_rub > 0
        AND rate.rub_usd IS NOT NULL AND rate.rub_usd > 0
    ),
    calc_usd AS (
      SELECT
        product_variation_id,
        ROUND((total_rub * rate.rub_usd)::numeric, 2) AS price_usd,
        'calculator' AS price_source
      FROM calc
      CROSS JOIN rate
      WHERE total_rub IS NOT NULL AND total_rub > 0
    ),
    picked AS (
      SELECT product_variation_id, price_usd, price_source FROM ym
      UNION ALL
      SELECT c.product_variation_id, c.price_usd, c.price_source
      FROM calc_usd c
      WHERE c.product_variation_id NOT IN (SELECT product_variation_id FROM ym)
    )
    SELECT DISTINCT ON (product_variation_id)
      product_variation_id,
      price_usd AS price,
      'USD' AS price_currency,
      price_source
    FROM picked
    WHERE price_usd IS NOT NULL AND price_usd > 0
    ORDER BY product_variation_id,
      CASE price_source WHEN 'yandex_market' THEN 1 ELSE 2 END
  `;

  const rows = await metabaseQuery<{
    product_variation_id: number;
    price: number;
    price_currency: string | null;
    price_source: string | null;
  }>(sql, creds);

  const out = new Map<number, YandexMarketPriceRow>();
  for (const r of rows) {
    const price = formatPrice(r.price);
    if (price == null) continue;
    const variationId = Number(r.product_variation_id);
    out.set(variationId, {
      variationId,
      price,
      currency: "USD",
      source: parseSource(r.price_source)
    });
  }
  return out;
}
