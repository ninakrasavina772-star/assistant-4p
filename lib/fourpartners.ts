import { filterFpProductsActiveOffers } from "./activeOfferVariations";
import { filterFpProductsByBrands, type BrandMatchMode } from "./brand-filter";
import { filterFpProductsByModels, type ModelMatchMode } from "./model-filter";
import { filterSiteAByExcludedProductIds } from "./excludeProductIds";
import type { FpProduct } from "./types";

const DEFAULT_BASE = "https://api.4partners.io/v1";
const USER_AGENT = "rubric-compare/0.1";
const MAX_RUBRIC_PAGES = 5000;

export type FpRubric = {
  id: number;
  parent_id: number | null;
  name: string;
  level: number;
  is_active: boolean;
  is_leaf: boolean;
  is_ban?: boolean;
  position?: number;
};

type ApiEnvelope<T> = { status?: string; status_code?: number; result?: T };

function apiBase(): string {
  return (process.env.FOURPARTNERS_API_BASE || DEFAULT_BASE).replace(/\/+$/, "");
}

async function fpFetch(token: string, path: string, init?: RequestInit): Promise<Response> {
  const url = `${apiBase()}${path.startsWith("/") ? path : `/${path}`}`;
  return fetch(url, {
    ...init,
    headers: {
      "X-Auth-Token": token,
      "User-Agent": USER_AGENT,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers as Record<string, string>)
    },
    cache: "no-store"
  });
}

function httpErr(path: string, res: Response, text: string): never {
  throw new Error(`4Partners ${path} → HTTP ${res.status}: ${text.slice(0, 500)}`);
}

export type RubricFetchPipeline = {
  brands?: string[];
  brandMatch?: BrandMatchMode;
  models?: string[];
  modelMatch?: ModelMatchMode;
  excludeIds?: Set<number>;
  excludeIdsRaw?: number[];
};

export type FetchRubricProductsResult = {
  products: FpProduct[];
  excludeMeta?: { removedFromA: number; listIdsNotFoundInRubric: number };
  brandExcludedMissing: number;
  brandExcludedNotInList: number;
  modelExcludedNotInList: number;
};

export type FetchRubricIdsResult = {
  ids: number[];
  excludeMeta?: { removedFromA: number; listIdsNotFoundInRubric: number };
  brandExcludedMissing: number;
  brandExcludedNotInList: number;
  modelExcludedNotInList: number;
};

function normalizeRubrics(raw: FpRubric[]): FpRubric[] {
  return raw
    .filter((r) => r.is_active !== false && r.is_ban !== true)
    .sort((a, b) => {
      const d = (a.position ?? 0) - (b.position ?? 0);
      return d !== 0 ? d : String(a.name).localeCompare(String(b.name), "ru");
    });
}

export async function fetchMainRubrics(token: string): Promise<FpRubric[]> {
  const res = await fpFetch(token, "/rubric/main", { method: "GET" });
  const text = await res.text();
  if (!res.ok) httpErr("/rubric/main", res, text);
  const json = JSON.parse(text) as ApiEnvelope<{ rubrics?: FpRubric[] }>;
  return normalizeRubrics(json.result?.rubrics ?? []);
}

export async function fetchRubricChildren(token: string, parentId: number): Promise<FpRubric[]> {
  const path = `/rubric/child/${parentId}`;
  const res = await fpFetch(token, path, { method: "GET" });
  const text = await res.text();
  if (!res.ok) httpErr(path, res, text);
  const json = JSON.parse(text) as ApiEnvelope<{ rubrics?: FpRubric[] }>;
  return normalizeRubrics(json.result?.rubrics ?? []);
}

function readPagination(result: Record<string, unknown>) {
  const pg =
    (result.pagination_info as Record<string, unknown> | undefined) ||
    (result.pager as Record<string, unknown> | undefined) ||
    {};
  return {
    hasMore: Boolean(pg.has_more ?? pg.hasMore ?? false),
    page: Number(pg.page ?? 1),
    perPage: Number(pg.per_page ?? pg.perPage ?? 0)
  };
}

function readProducts(result: Record<string, unknown>): FpProduct[] {
  const raw =
    (result.products as FpProduct[] | undefined) ||
    (result.product as FpProduct[] | undefined) ||
    [];
  return Array.isArray(raw) ? raw : [];
}

async function fetchProductListRawPage(
  token: string,
  variation: string,
  rubricId: number,
  page: number
) {
  const path = `/product/list/${encodeURIComponent(variation)}/products`;
  const res = await fpFetch(token, path, {
    method: "POST",
    body: JSON.stringify({ page, filter_rubrics: [rubricId], order: "popular" })
  });
  const text = await res.text();
  if (!res.ok) httpErr(path, res, text);
  const json = JSON.parse(text) as ApiEnvelope<Record<string, unknown>>;
  const result = (json.result ?? {}) as Record<string, unknown>;
  const products = filterFpProductsActiveOffers(readProducts(result));
  const pag = readPagination(result);
  return {
    products,
    hasMore: pag.hasMore,
    page: pag.page,
    perPage: pag.perPage
  };
}

export function applyRubricFetchPipeline(products: FpProduct[], pipe: RubricFetchPipeline, leg: "A" | "B") {
  let working = products;
  let excludeRemovedFromA = 0;

  if (leg === "A" && pipe.excludeIds && pipe.excludeIds.size > 0) {
    const ex = filterSiteAByExcludedProductIds(
      working,
      pipe.excludeIdsRaw?.length ? pipe.excludeIdsRaw : [...pipe.excludeIds]
    );
    excludeRemovedFromA = ex.removedFromA;
    working = ex.products;
  }

  let brandExcludedMissing = 0;
  let brandExcludedNotInList = 0;
  if (pipe.brands?.length) {
    const r = filterFpProductsByBrands(working, pipe.brands, pipe.brandMatch ?? "exact");
    brandExcludedMissing = r.excludedMissingBrand;
    brandExcludedNotInList = r.excludedNotInList;
    working = r.products;
  }

  let modelExcludedNotInList = 0;
  if (pipe.models?.length) {
    const r = filterFpProductsByModels(working, pipe.models, pipe.modelMatch ?? "exact");
    modelExcludedNotInList = r.excludedNotInList;
    working = r.products;
  }

  return {
    out: working,
    excludeRemovedFromA,
    brandExcludedMissing,
    brandExcludedNotInList,
    modelExcludedNotInList
  };
}

export async function fetchNoveltyIdsSlicePage(
  token: string,
  variation: string,
  rubricId: number,
  page: number,
  pipe: RubricFetchPipeline,
  leg: "A" | "B"
) {
  const { products: raw, hasMore, page: pg, perPage } = await fetchProductListRawPage(
    token,
    variation,
    rubricId,
    page
  );
  const rawCatalogIdsBeforeExclude = raw.map((p) => p.id);
  const applied = applyRubricFetchPipeline(raw, pipe, leg);
  return {
    ids: applied.out.map((p) => p.id),
    rawCatalogIdsBeforeExclude,
    hasMore,
    page: pg,
    perPage,
    brandExcludedMissing: applied.brandExcludedMissing,
    brandExcludedNotInList: applied.brandExcludedNotInList,
    modelExcludedNotInList: applied.modelExcludedNotInList,
    excludeRemovedFromA: applied.excludeRemovedFromA
  };
}

export async function fetchAllProductsInRubric(
  token: string,
  variation: string,
  rubricId: number,
  pipe: RubricFetchPipeline
): Promise<FetchRubricProductsResult> {
  const merged = new Map<number, FpProduct>();
  const rawSeen = new Set<number>();
  let pageReq = 1;
  let brandExcludedMissing = 0;
  let brandExcludedNotInList = 0;
  let modelExcludedNotInList = 0;
  let excludeRemovedFromA = 0;

  for (let iter = 0; iter < MAX_RUBRIC_PAGES; iter++) {
    const { products: raw, hasMore, page: pg } = await fetchProductListRawPage(
      token,
      variation,
      rubricId,
      pageReq
    );
    for (const p of raw) rawSeen.add(p.id);
    const applied = applyRubricFetchPipeline(raw, pipe, "A");
    excludeRemovedFromA += applied.excludeRemovedFromA;
    brandExcludedMissing += applied.brandExcludedMissing;
    brandExcludedNotInList += applied.brandExcludedNotInList;
    modelExcludedNotInList += applied.modelExcludedNotInList;
    for (const p of applied.out) merged.set(p.id, p);
    if (!hasMore || raw.length === 0) break;
    pageReq = pg + 1;
  }

  let excludeMeta: FetchRubricProductsResult["excludeMeta"];
  if (pipe.excludeIdsRaw?.length) {
    let nf = 0;
    for (const id of pipe.excludeIdsRaw) if (!rawSeen.has(id)) nf++;
    excludeMeta = { removedFromA: excludeRemovedFromA, listIdsNotFoundInRubric: nf };
  }

  return {
    products: [...merged.values()],
    excludeMeta,
    brandExcludedMissing,
    brandExcludedNotInList,
    modelExcludedNotInList
  };
}

async function fetchAllProductIdsInRubric(
  token: string,
  variation: string,
  rubricId: number,
  pipe: RubricFetchPipeline,
  leg: "A" | "B"
): Promise<FetchRubricIdsResult> {
  const merged = new Set<number>();
  const rawSeen = new Set<number>();
  let pageReq = 1;
  let brandExcludedMissing = 0;
  let brandExcludedNotInList = 0;
  let modelExcludedNotInList = 0;
  let excludeRemovedFromA = 0;

  for (let iter = 0; iter < MAX_RUBRIC_PAGES; iter++) {
    const { products: raw, hasMore, page: pg } = await fetchProductListRawPage(
      token,
      variation,
      rubricId,
      pageReq
    );
    for (const p of raw) rawSeen.add(p.id);
    const applied = applyRubricFetchPipeline(raw, pipe, leg);
    excludeRemovedFromA += applied.excludeRemovedFromA;
    brandExcludedMissing += applied.brandExcludedMissing;
    brandExcludedNotInList += applied.brandExcludedNotInList;
    modelExcludedNotInList += applied.modelExcludedNotInList;
    for (const p of applied.out) merged.add(p.id);
    if (!hasMore || raw.length === 0) break;
    pageReq = pg + 1;
  }

  let excludeMeta: FetchRubricIdsResult["excludeMeta"];
  if (leg === "A" && pipe.excludeIdsRaw?.length) {
    let nf = 0;
    for (const id of pipe.excludeIdsRaw) if (!rawSeen.has(id)) nf++;
    excludeMeta = { removedFromA: excludeRemovedFromA, listIdsNotFoundInRubric: nf };
  }

  return {
    ids: [...merged].sort((a, b) => a - b),
    excludeMeta,
    brandExcludedMissing,
    brandExcludedNotInList,
    modelExcludedNotInList
  };
}

export async function fetchMergedRubricsProducts(
  token: string,
  variation: string,
  rubricIds: number[],
  pipe: RubricFetchPipeline
): Promise<FetchRubricProductsResult> {
  const maps = await Promise.all(
    rubricIds.map((rid) => fetchAllProductsInRubric(token, variation, rid, pipe))
  );
  const merged = new Map<number, FpProduct>();
  let brandExcludedMissing = 0;
  let brandExcludedNotInList = 0;
  let modelExcludedNotInList = 0;
  let excludeMeta: FetchRubricProductsResult["excludeMeta"];

  for (const m of maps) {
    for (const p of m.products) merged.set(p.id, p);
    brandExcludedMissing += m.brandExcludedMissing;
    brandExcludedNotInList += m.brandExcludedNotInList;
    modelExcludedNotInList += m.modelExcludedNotInList;
    if (m.excludeMeta) excludeMeta = m.excludeMeta;
  }

  return {
    products: [...merged.values()],
    excludeMeta,
    brandExcludedMissing,
    brandExcludedNotInList,
    modelExcludedNotInList
  };
}

export async function fetchMergedRubricsProductIds(
  token: string,
  variation: string,
  rubricIds: number[],
  pipe: RubricFetchPipeline,
  leg: "A" | "B"
): Promise<FetchRubricIdsResult> {
  const maps = await Promise.all(
    rubricIds.map((rid) => fetchAllProductIdsInRubric(token, variation, rid, pipe, leg))
  );
  const merged = new Set<number>();
  let brandExcludedMissing = 0;
  let brandExcludedNotInList = 0;
  let modelExcludedNotInList = 0;
  let excludeMeta: FetchRubricIdsResult["excludeMeta"];

  for (const m of maps) {
    for (const id of m.ids) merged.add(id);
    brandExcludedMissing += m.brandExcludedMissing;
    brandExcludedNotInList += m.brandExcludedNotInList;
    modelExcludedNotInList += m.modelExcludedNotInList;
    if (m.excludeMeta) excludeMeta = m.excludeMeta;
  }

  return {
    ids: [...merged].sort((a, b) => a - b),
    excludeMeta,
    brandExcludedMissing,
    brandExcludedNotInList,
    modelExcludedNotInList
  };
}

export async function fetchProductsByIds(
  token: string,
  variation: string,
  ids: number[]
): Promise<FpProduct[]> {
  if (!ids.length) return [];
  const out: FpProduct[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const path = `/product/info/${chunk.join(",")}/${encodeURIComponent(variation)}`;
    const res = await fpFetch(token, path, { method: "GET" });
    const text = await res.text();
    if (!res.ok) httpErr(path, res, text);
    const json = JSON.parse(text) as ApiEnvelope<{ product?: FpProduct | FpProduct[] }>;
    const prod = json.result?.product;
    const arr = Array.isArray(prod) ? prod : prod ? [prod] : [];
    out.push(...filterFpProductsActiveOffers(arr));
  }
  return out;
}
