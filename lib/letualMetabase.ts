import {
  DEFAULT_METABASE_DB_ID,
  DEFAULT_METABASE_URL,
  metabaseIsConfigured,
  resolveMetabaseCredentials,
  type MetabaseCredentials
} from "@/lib/letualMetabaseConfig";
import {
  build4standCdnUrlFromHash,
  dedupeAndNormalizeFotoUrls,
  normalize4standHugeWebp
} from "@/lib/podruzhkaFotoPick";

export type LetualVariationRow = {
  variationId: number;
  ean: string | null;
  productName: string;
  brandName: string;
  /** Главное фото из product_variation_main_image */
  mainImageUrl: string | null;
  imageUrls: string[];
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

function parseImageUrls(raw: unknown): string[] {
  if (!raw) return [];
  const s = String(raw).trim();
  if (!s) return [];
  return [...new Set(s.split(/\s+/).filter((u) => /^https?:\/\//i.test(u)))];
}

function parseImageHashes(raw: unknown): string[] {
  if (!raw) return [];
  const s = String(raw).trim();
  if (!s) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const h of s.split(/\s+/)) {
    const t = h.trim().toLowerCase();
    if (!/^[0-9a-f]{40,}$/.test(t) || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/** Lifestyle-кадры поставщика (цветы, ингредиенты) — не packshot товара. */
function isLifestyleSupplierUrl(url: string): boolean {
  return /cdnbigbuy\.com\/images\/\d+_R(?:10|20|30)\b/i.test(url);
}

/** CDN из hash: main первым, затем остальные фото вариации (по position). */
function mergeLetualImageUrls(
  mainImageHash: string | null,
  linkHashes: string[],
  linkUrls: string[]
): { mainImageUrl: string | null; imageUrls: string[] } {
  const orderedHashes: string[] = [];
  const seenHashKeys = new Set<string>();

  const pushHash = (hash?: string | null) => {
    if (!hash) return;
    const cdn = build4standCdnUrlFromHash(hash);
    if (!cdn) return;
    const key = cdn.slice(cdn.indexOf("/huge/") + 6);
    if (seenHashKeys.has(key)) return;
    seenHashKeys.add(key);
    orderedHashes.push(hash.trim().toLowerCase());
  };

  pushHash(mainImageHash);
  for (const h of linkHashes) pushHash(h);

  const cdnUrls = orderedHashes
    .map((h) => build4standCdnUrlFromHash(h))
    .filter((u): u is string => Boolean(u));

  const filteredLinks = linkUrls
    .map((u) => normalize4standHugeWebp(u))
    .filter((u) => !isLifestyleSupplierUrl(u));

  const mainImageUrl = cdnUrls[0] ?? null;
  const merged = dedupeAndNormalizeFotoUrls([...cdnUrls, ...filteredLinks]);
  return { mainImageUrl, imageUrls: merged };
}

export type SiblingPhotoCandidate = {
  variationId: number;
  mainImageUrl: string;
  matchType: "same_ean" | "same_product";
};

function hashToMainImageUrl(hash: string | null | undefined): string | null {
  if (!hash) return null;
  return build4standCdnUrlFromHash(String(hash).trim());
}

/** Другие вариации: тот же EAN или та же карточка (product). Без «линейки» — объём может отличаться. */
export async function fetchSiblingVariationPhotos(
  variationId: number,
  metabaseApiKey?: string,
  _seed?: { brandName: string; productName: string },
  limit = 24
): Promise<SiblingPhotoCandidate[]> {
  const creds = resolveMetabaseCredentials(metabaseApiKey);
  if (!creds || variationId <= 0) return [];

  const sql = `
    WITH seed AS (
      SELECT
        pv.id,
        NULLIF(TRIM(pv.ean), '') AS ean,
        pv.product_id
      FROM public.product_variation pv
      WHERE pv.id = ${Number(variationId)}
    ),
    candidates AS (
      SELECT pv2.id AS variation_id, 'same_ean' AS match_type, 1 AS priority
      FROM seed s
      JOIN public.product_variation pv2
        ON NULLIF(TRIM(pv2.ean), '') = s.ean AND pv2.id != s.id
      WHERE s.ean IS NOT NULL

      UNION ALL

      SELECT pv2.id, 'same_product', 2
      FROM seed s
      JOIN public.product_variation pv2
        ON pv2.product_id = s.product_id AND pv2.id != s.id
    )
    SELECT c.variation_id, c.match_type, c.priority, pvmi.image_load_hash
    FROM candidates c
    JOIN public.product_variation_main_image pvmi ON pvmi.product_variation_id = c.variation_id
    WHERE NULLIF(TRIM(pvmi.image_load_hash), '') IS NOT NULL
    ORDER BY c.priority, c.variation_id
    LIMIT ${Math.min(Math.max(limit, 1), 40)}
  `;

  const rows = await metabaseQuery<{
    variation_id: number;
    match_type: string;
    priority: number;
    image_load_hash: string;
  }>(sql, creds);

  const seenUrls = new Set<string>();
  const out: SiblingPhotoCandidate[] = [];

  for (const r of rows) {
    const url = hashToMainImageUrl(r.image_load_hash);
    if (!url || seenUrls.has(url)) continue;
    seenUrls.add(url);
    const matchType =
      r.match_type === "same_ean" || r.match_type === "same_product"
        ? r.match_type
        : "same_product";
    out.push({
      variationId: Number(r.variation_id),
      mainImageUrl: url,
      matchType
    });
  }

  return out;
}

export async function fetchLetualVariations(
  ids: number[],
  metabaseApiKey?: string
): Promise<LetualVariationRow[]> {
  const creds = resolveMetabaseCredentials(metabaseApiKey);
  if (!creds) {
    throw new Error(
      "Metabase не настроен: добавьте METABASE_API_KEY на сервере (Vercel env)"
    );
  }

  if (!ids.length) return [];
  const inList = ids.map((id) => Number(id)).filter((id) => id > 0).join(",");
  if (!inList) return [];

  const sql = `
    SELECT
      pv.id AS variation_id,
      NULLIF(TRIM(pv.ean), '') AS ean,
      COALESCE(NULLIF(TRIM(pv.name), ''), p.name) AS product_name,
      b.name AS brand_name,
      NULLIF(TRIM(pvmi.image_load_hash), '') AS main_image_hash,
      STRING_AGG(NULLIF(TRIM(il.url_hash), ''), ' ' ORDER BY pvil.position, il.id) AS image_hashes,
      STRING_AGG(il.url, ' ' ORDER BY pvil.position, il.id) AS image_urls
    FROM public.product_variation pv
    JOIN public.product p ON p.id = pv.product_id
    JOIN public.brand b ON b.id = p.brand_id
    LEFT JOIN public.product_variation_main_image pvmi ON pvmi.product_variation_id = pv.id
    LEFT JOIN public.product_variation_image_load_link pvil ON pvil.product_variation_id = pv.id
    LEFT JOIN public.image_load il ON il.id = pvil.image_load_id AND il.is_active = true
    WHERE pv.id IN (${inList})
    GROUP BY pv.id, pv.ean, pv.name, p.name, b.name, pvmi.image_load_hash
  `;

  const rows = await metabaseQuery<{
    variation_id: number;
    ean: string | null;
    product_name: string;
    brand_name: string;
    main_image_hash: string | null;
    image_hashes: string | null;
    image_urls: string | null;
  }>(sql, creds);

  return rows.map((r) => {
    const merged = mergeLetualImageUrls(
      r.main_image_hash ? String(r.main_image_hash).trim() : null,
      parseImageHashes(r.image_hashes),
      parseImageUrls(r.image_urls)
    );
    return {
      variationId: Number(r.variation_id),
      ean: r.ean ? String(r.ean).trim() : null,
      productName: String(r.product_name ?? "").trim(),
      brandName: String(r.brand_name ?? "").trim(),
      mainImageUrl: merged.mainImageUrl,
      imageUrls: merged.imageUrls
    };
  });
}



export type VariationProductIdRow = {
  variationId: number;
  productId: number;
};

/** variation_id (SKU) → product_id для загрузки карточек через Partner API */
export async function fetchProductIdsByVariationIds(
  ids: number[],
  metabaseApiKey?: string
): Promise<VariationProductIdRow[]> {
  const creds = resolveMetabaseCredentials(metabaseApiKey);
  if (!creds) {
    throw new Error(
      "Metabase не настроен: нужен METABASE_API_KEY на сервере для поиска по id вариации"
    );
  }
  if (!ids.length) return [];
  const inList = [...new Set(ids.filter((id) => id > 0))].join(",");
  if (!inList) return [];

  const sql = `
    SELECT pv.id AS variation_id, pv.product_id
    FROM public.product_variation pv
    WHERE pv.id IN (${inList})
  `;

  const rows = await metabaseQuery<{
    variation_id: number;
    product_id: number;
  }>(sql, creds);

  return rows.map((r) => ({
    variationId: Number(r.variation_id),
    productId: Number(r.product_id)
  }));
}

export { metabaseIsConfigured, DEFAULT_METABASE_URL, DEFAULT_METABASE_DB_ID };
