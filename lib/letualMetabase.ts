export type LetualVariationRow = {
  variationId: number;
  ean: string | null;
  productName: string;
  brandName: string;
  imageUrls: string[];
};

function metabaseConfigured(): boolean {
  return Boolean(
    process.env.METABASE_URL?.trim() &&
      process.env.METABASE_API_KEY?.trim() &&
      process.env.METABASE_DB_ID?.trim()
  );
}

function metabaseDbId(): number {
  return Number(process.env.METABASE_DB_ID?.trim() || "2");
}

async function metabaseQuery<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  if (!metabaseConfigured()) {
    throw new Error("Metabase не настроен: METABASE_URL, METABASE_API_KEY, METABASE_DB_ID");
  }
  const base = process.env.METABASE_URL!.trim().replace(/\/+$/, "");
  const res = await fetch(`${base}/api/dataset`, {
    method: "POST",
    headers: {
      "X-API-KEY": process.env.METABASE_API_KEY!.trim(),
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      type: "native",
      native: { query: sql },
      database: metabaseDbId()
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

function parseImageUrls(raw: unknown): string[] {
  if (!raw) return [];
  const s = String(raw).trim();
  if (!s) return [];
  return [...new Set(s.split(/\s+/).filter((u) => /^https?:\/\//i.test(u)))];
}

export async function fetchLetualVariations(ids: number[]): Promise<LetualVariationRow[]> {
  if (!ids.length) return [];
  const inList = ids.map((id) => Number(id)).filter((id) => id > 0).join(",");
  if (!inList) return [];

  const sql = `
    SELECT
      pv.id AS variation_id,
      NULLIF(TRIM(pv.ean), '') AS ean,
      COALESCE(NULLIF(TRIM(pv.name), ''), p.name) AS product_name,
      b.name AS brand_name,
      STRING_AGG(il.url, ' ' ORDER BY pvil.position, il.id) AS image_urls
    FROM public.product_variation pv
    JOIN public.product p ON p.id = pv.product_id
    JOIN public.brand b ON b.id = p.brand_id
    LEFT JOIN public.product_variation_image_load_link pvil ON pvil.product_variation_id = pv.id
    LEFT JOIN public.image_load il ON il.id = pvil.image_load_id AND il.is_active = true
    WHERE pv.id IN (${inList})
    GROUP BY pv.id, pv.ean, pv.name, p.name, b.name
  `;

  const rows = await metabaseQuery<{
    variation_id: number;
    ean: string | null;
    product_name: string;
    brand_name: string;
    image_urls: string | null;
  }>(sql);

  return rows.map((r) => ({
    variationId: Number(r.variation_id),
    ean: r.ean ? String(r.ean).trim() : null,
    productName: String(r.product_name ?? "").trim(),
    brandName: String(r.brand_name ?? "").trim(),
    imageUrls: parseImageUrls(r.image_urls)
  }));
}

export function metabaseIsConfigured(): boolean {
  return metabaseConfigured();
}
