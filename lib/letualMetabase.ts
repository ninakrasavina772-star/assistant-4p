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
  return [...new Set(s.split(/\s+/).filter((h) => /^[0-9a-f]{40,}$/i.test(h)))];
}

/** CDN из hash (карточка) + свои ссылки; parfimo только если hash нет. */
function mergeLetualImageUrls(
  mainImageHash: string | null,
  linkHashes: string[],
  linkUrls: string[]
): string[] {
  const fromHashes: string[] = [];
  const seenHashKeys = new Set<string>();

  const addHash = (hash?: string | null) => {
    if (!hash) return;
    const cdn = build4standCdnUrlFromHash(hash);
    if (!cdn) return;
    const key = cdn.slice(cdn.indexOf("/huge/") + 6);
    if (seenHashKeys.has(key)) return;
    seenHashKeys.add(key);
    fromHashes.push(cdn);
  };

  addHash(mainImageHash);
  for (const h of linkHashes) addHash(h);

  if (fromHashes.length) {
    const ownCdn = linkUrls
      .map((u) => normalize4standHugeWebp(u))
      .filter((u) => /cdnru\.4stand|deloox/i.test(u));
    return dedupeAndNormalizeFotoUrls([...fromHashes, ...ownCdn]);
  }

  return dedupeAndNormalizeFotoUrls(linkUrls);
}

export async function fetchLetualVariations(
  ids: number[],
  metabaseApiKey?: string
): Promise<LetualVariationRow[]> {
  const creds = resolveMetabaseCredentials(metabaseApiKey);
  if (!creds) {
    throw new Error(
      "Metabase не настроен: укажите METABASE API key в форме или добавьте METABASE_API_KEY на сервере"
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
      STRING_AGG(DISTINCT NULLIF(TRIM(il.url_hash), ''), ' ') AS image_hashes,
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

  return rows.map((r) => ({
    variationId: Number(r.variation_id),
    ean: r.ean ? String(r.ean).trim() : null,
    productName: String(r.product_name ?? "").trim(),
    brandName: String(r.brand_name ?? "").trim(),
    imageUrls: mergeLetualImageUrls(
      r.main_image_hash ? String(r.main_image_hash).trim() : null,
      parseImageHashes(r.image_hashes),
      parseImageUrls(r.image_urls)
    )
  }));
}

export { metabaseIsConfigured, DEFAULT_METABASE_URL, DEFAULT_METABASE_DB_ID };
