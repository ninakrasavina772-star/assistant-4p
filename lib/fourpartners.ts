import { filterFpProductKeepActiveOfferVariations, filterFpProductsActiveOffers } from "./activeOfferVariations";
import { filterFpProductsByBrands, type BrandMatchMode } from "./brand-filter";
import { filterFpProductsByModels, type ModelMatchMode } from "./model-filter";
import { filterSiteAByExcludedProductIds } from "./excludeProductIds";
import {
  collectEans,
  countProductsWithEanIndexKeys,
  countVariationSlots,
  fpProductWithMergedEans,
  mergeFeedRowWithApiInfo,
  normalizeFpProductListShape
} from "./product";
import type { FpProduct } from "./types";

const DEFAULT_BASE = "https://api.4partners.io/v1";
const USER_AGENT = "rubric-compare/0.1";
const MAX_RUBRIC_PAGES = 5000;
/** Запрашиваем у /product/list — по swagger до 500 на страницу */
const LIST_PER_PAGE = 500;

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

/** Как собирать каталог рубрики для поиска дублей */
export type RubricCatalogScope = "active_offers" | "full_catalog";

export type RubricFetchDiagnostics = {
  /** Карточек в ответе API до отсечения неактивных офферов */
  listedFromApi: number;
  /** Не попали в расчёт: нет активного quantity ни у одного варианта */
  droppedNoActiveOffer: number;
  /** Уникальных id после объединения страниц, до бренд/модель/исключений */
  uniqueBeforePipeline: number;
  /** Сколько рубрик реально опрошено (родитель + дочерние) */
  rubricIdsQueried: number[];
  infoBatchesTotal?: number;
  infoBatchesFailed?: number;
  /** Сколько id реально вернул /product/info */
  infoIdsReturned?: number;
  withEanAfterEnrich?: number;
  /** Сколько страниц list реально загрузили */
  listPagesLoaded?: number;
  /** total_items из pagination API (если отдал) */
  apiTotalItemsReported?: number;
  /** Сумма вариаций (SKU) в product_variation */
  variationSlotsTotal?: number;
};

export type FetchRubricProductsResult = {
  products: FpProduct[];
  excludeMeta?: { removedFromA: number; listIdsNotFoundInRubric: number };
  brandExcludedMissing: number;
  brandExcludedNotInList: number;
  modelExcludedNotInList: number;
  fetchDiagnostics?: RubricFetchDiagnostics;
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

function readPagination(
  result: Record<string, unknown>,
  productsOnPage: number,
  requestedPerPage = LIST_PER_PAGE
): {
  hasMore: boolean;
  page: number;
  perPage: number;
  apiTotalItems?: number;
  apiTotalPages?: number;
} {
  // Try all known pagination container field names
  const pg =
    (result.pagination_info as Record<string, unknown> | undefined) ||
    (result.pager as Record<string, unknown> | undefined) ||
    (result.pagination as Record<string, unknown> | undefined) ||
    (result.meta as Record<string, unknown> | undefined) ||
    {};

  const currentPage = Number(
    pg.page ?? pg.current_page ?? result.page ?? result.current_page ?? 1
  );
  const perPage = Number(
    pg.per_page ??
      pg.perPage ??
      pg.items_per_page ??
      result.per_page ??
      result.perPage ??
      result.items_per_page ??
      0
  );
  const total = Number(
    pg.total ??
      pg.total_count ??
      pg.count ??
      pg.total_items ??
      result.total ??
      result.total_count ??
      result.count ??
      result.total_items ??
      NaN
  );
  const totalPages = Number(
    pg.pages ?? pg.total_pages ?? pg.last_page ??
    result.pages ?? result.total_pages ?? result.last_page ??
    NaN
  );

  // Explicit has_more field
  let hasMore = Boolean(pg.has_more ?? pg.hasMore ?? result.has_more ?? result.hasMore ?? false);

  const effectivePerPage = perPage > 0 ? perPage : requestedPerPage;

  if (!hasMore && Number.isFinite(total) && total > 0 && effectivePerPage > 0) {
    hasMore = currentPage * effectivePerPage < total;
  }
  if (!hasMore && Number.isFinite(totalPages) && totalPages > currentPage) {
    hasMore = true;
  }
  if (!hasMore && productsOnPage >= effectivePerPage) {
    hasMore = true;
  }

  return {
    hasMore,
    page: currentPage,
    perPage: effectivePerPage,
    apiTotalItems: Number.isFinite(total) && total > 0 ? total : undefined,
    apiTotalPages: Number.isFinite(totalPages) && totalPages > 0 ? totalPages : undefined
  };
}

function readProducts(result: Record<string, unknown>): FpProduct[] {
  const raw =
    (result.products as FpProduct[] | undefined) ||
    (result.product as FpProduct[] | undefined) ||
    [];
  return Array.isArray(raw) ? raw : [];
}

/** Ответ GET /product/info/{ids}/{variation} — product или products. */
function parseProductsFromInfoEnvelope(
  json: ApiEnvelope<Record<string, unknown>>
): FpProduct[] {
  const result = (json.result ?? {}) as Record<string, unknown>;
  const prod = result.product;
  if (Array.isArray(prod)) return prod as FpProduct[];
  if (prod && typeof prod === "object") return [prod as FpProduct];
  const products = result.products;
  if (Array.isArray(products)) return products as FpProduct[];
  return [];
}

function mergeListProductWithInfoFull(listRow: FpProduct, full: FpProduct): FpProduct {
  const merged = fpProductWithMergedEans(normalizeFpProductListShape(full));
  const eans = [...new Set([...collectEans(merged), ...collectEans(listRow)])];
  return {
    ...merged,
    id: listRow.id,
    name: listRow.name || merged.name,
    link: listRow.link || merged.link,
    brand: listRow.brand ?? merged.brand,
    ...(eans.length ? { eans } : {})
  };
}

const ENRICH_BATCH = 50;
const ENRICH_CONCURRENCY = 5;
const ENRICH_SINGLE_CONCURRENCY = 8;

async function fetchProductInfoChunk(
  token: string,
  variation: string,
  chunk: number[]
): Promise<{ products: FpProduct[]; failed: boolean }> {
  if (!chunk.length) return { products: [], failed: false };
  const path = `/product/info/${chunk.join(",")}/${encodeURIComponent(variation)}`;
  try {
    const res = await fpFetch(token, path, { method: "GET" });
    if (!res.ok) return { products: [], failed: true };
    const text = await res.text();
    const json = JSON.parse(text) as ApiEnvelope<Record<string, unknown>>;
    return { products: parseProductsFromInfoEnvelope(json), failed: false };
  } catch {
    return { products: [], failed: true };
  }
}

async function enrichProductsWithInfo(
  token: string,
  variation: string,
  listProducts: FpProduct[],
  catalogScope: RubricCatalogScope
): Promise<{
  products: FpProduct[];
  infoBatchesTotal: number;
  infoBatchesFailed: number;
  infoIdsReturned: number;
}> {
  const ids = listProducts.map((p) => p.id);
  const fullByIds = new Map<number, FpProduct>();
  const chunks: number[][] = [];
  for (let i = 0; i < ids.length; i += ENRICH_BATCH) {
    chunks.push(ids.slice(i, i + ENRICH_BATCH));
  }
  let infoBatchesFailed = 0;

  for (let i = 0; i < chunks.length; i += ENRICH_CONCURRENCY) {
    const slice = chunks.slice(i, i + ENRICH_CONCURRENCY);
    await Promise.all(
      slice.map(async (chunk) => {
        const { products, failed } = await fetchProductInfoChunk(
          token,
          variation,
          chunk
        );
        if (failed) infoBatchesFailed += 1;
        for (const p of products) fullByIds.set(p.id, p);

        /** В батче часто приходит 1 карточка — догружаем остальные id по одному */
        const missing = chunk.filter((id) => !fullByIds.has(id));
        for (let m = 0; m < missing.length; m += ENRICH_SINGLE_CONCURRENCY) {
          const part = missing.slice(m, m + ENRICH_SINGLE_CONCURRENCY);
          await Promise.all(
            part.map(async (id) => {
              const one = await fetchProductInfoChunk(token, variation, [id]);
              if (one.failed) infoBatchesFailed += 1;
              for (const p of one.products) fullByIds.set(p.id, p);
            })
          );
        }
      })
    );
  }

  const enriched: FpProduct[] = [];
  for (const lp of listProducts) {
    const full = fullByIds.get(lp.id);
    if (full) {
      const merged = mergeListProductWithInfoFull(lp, full);
      if (catalogScope === "full_catalog") {
        enriched.push(merged);
      } else {
        const kept = filterFpProductKeepActiveOfferVariations(merged);
        enriched.push(kept ?? merged);
      }
    } else {
      enriched.push(fpProductWithMergedEans(lp));
    }
  }

  return {
    products: enriched,
    infoBatchesTotal: chunks.length,
    infoBatchesFailed,
    infoIdsReturned: fullByIds.size
  };
}

async function fetchProductListRawPage(
  token: string,
  variation: string,
  rubricIds: number[],
  page: number,
  catalogScope: RubricCatalogScope = "active_offers"
) {
  const path = `/product/list/${encodeURIComponent(variation)}/products`;
  const res = await fpFetch(token, path, {
    method: "POST",
    body: JSON.stringify({
      page,
      per_page: LIST_PER_PAGE,
      filter_rubrics: rubricIds,
      order: "popular"
    })
  });
  const text = await res.text();
  if (!res.ok) {
    // On page 1 this is a real error; on subsequent pages treat as end of list
    if (page === 1) httpErr(path, res, text);
    return { products: [], hasMore: false, page, perPage: 0, listedCount: 0 };
  }
  const json = JSON.parse(text) as ApiEnvelope<Record<string, unknown>>;
  const result = (json.result ?? {}) as Record<string, unknown>;
  const listed = readProducts(result).map(normalizeFpProductListShape);
  const products =
    catalogScope === "full_catalog" ? listed : filterFpProductsActiveOffers(listed);
  const pag = readPagination(result, listed.length, LIST_PER_PAGE);

  if (page <= 2) {
    const pagRaw =
      (result.pagination_info as Record<string, unknown> | undefined) ??
      (result.pager as Record<string, unknown> | undefined) ??
      (result.pagination as Record<string, unknown> | undefined) ??
      (result.meta as Record<string, unknown> | undefined) ??
      null;
    const resultKeys = Object.keys(result).filter((k) => k !== "products" && k !== "product");
    console.log(
      `[4P page=${page} rubrics=${rubricIds.length}] keys=[${resultKeys.join(",")}]` +
        ` pag=${JSON.stringify(pagRaw)}` +
        ` hasMore=${pag.hasMore} curPage=${pag.page} perPage=${pag.perPage}` +
        ` totalItems=${pag.apiTotalItems ?? "?"} listed=${listed.length} active=${products.length}`
    );
  }

  return {
    products,
    hasMore: pag.hasMore,
    page: pag.page,
    perPage: pag.perPage,
    listedCount: listed.length,
    apiTotalItems: pag.apiTotalItems
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
    [rubricId],
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
  pipe: RubricFetchPipeline,
  catalogScope: RubricCatalogScope = "active_offers"
): Promise<FetchRubricProductsResult> {
  return fetchAllProductsForRubrics(token, variation, [rubricId], pipe, catalogScope);
}

/** Одна пагинация по всем рубрикам сразу (filter_rubrics: [...]) — полнее, чем 9 отдельных запросов. */
async function fetchAllProductsForRubrics(
  token: string,
  variation: string,
  rubricIds: number[],
  pipe: RubricFetchPipeline,
  catalogScope: RubricCatalogScope
): Promise<FetchRubricProductsResult> {
  const uniqueRubrics = [...new Set(rubricIds.filter((id) => Number.isFinite(id) && id >= 1))];
  if (!uniqueRubrics.length) {
    return {
      products: [],
      brandExcludedMissing: 0,
      brandExcludedNotInList: 0,
      modelExcludedNotInList: 0,
      fetchDiagnostics: {
        listedFromApi: 0,
        droppedNoActiveOffer: 0,
        uniqueBeforePipeline: 0,
        rubricIdsQueried: []
      }
    };
  }

  const merged = new Map<number, FpProduct>();
  const rawSeen = new Set<number>();
  let pageReq = 1;
  let brandExcludedMissing = 0;
  let brandExcludedNotInList = 0;
  let modelExcludedNotInList = 0;
  let excludeRemovedFromA = 0;
  let listedFromApi = 0;
  let droppedNoActiveOffer = 0;
  let listPagesLoaded = 0;
  let apiTotalItemsReported = 0;

  for (let iter = 0; iter < MAX_RUBRIC_PAGES; iter++) {
    const {
      products: raw,
      hasMore,
      listedCount,
      apiTotalItems
    } = await fetchProductListRawPage(
      token,
      variation,
      uniqueRubrics,
      pageReq,
      catalogScope
    );
    listPagesLoaded += 1;
    if (apiTotalItems != null) {
      apiTotalItemsReported = Math.max(apiTotalItemsReported, apiTotalItems);
    }
    listedFromApi += listedCount;
    droppedNoActiveOffer += Math.max(0, listedCount - raw.length);
    for (const p of raw) rawSeen.add(p.id);
    const applied = applyRubricFetchPipeline(raw, pipe, "A");
    excludeRemovedFromA += applied.excludeRemovedFromA;
    brandExcludedMissing += applied.brandExcludedMissing;
    brandExcludedNotInList += applied.brandExcludedNotInList;
    modelExcludedNotInList += applied.modelExcludedNotInList;
    for (const p of applied.out) merged.set(p.id, p);
    if (raw.length === 0) break;
    if (!hasMore) break;
    pageReq += 1;
  }

  let excludeMeta: FetchRubricProductsResult["excludeMeta"];
  if (pipe.excludeIdsRaw?.length) {
    let nf = 0;
    for (const id of pipe.excludeIdsRaw) if (!rawSeen.has(id)) nf++;
    excludeMeta = { removedFromA: excludeRemovedFromA, listIdsNotFoundInRubric: nf };
  }

  const listProducts = [...merged.values()];
  const {
    products: enriched,
    infoBatchesTotal,
    infoBatchesFailed,
    infoIdsReturned
  } = await enrichProductsWithInfo(token, variation, listProducts, catalogScope);

  const variationSlotsTotal = countVariationSlots(enriched);

  return {
    products: enriched,
    excludeMeta,
    brandExcludedMissing,
    brandExcludedNotInList,
    modelExcludedNotInList,
    fetchDiagnostics: {
      listedFromApi,
      droppedNoActiveOffer,
      uniqueBeforePipeline: merged.size,
      rubricIdsQueried: uniqueRubrics,
      infoBatchesTotal,
      infoBatchesFailed,
      infoIdsReturned,
      withEanAfterEnrich: countProductsWithEanIndexKeys(enriched),
      listPagesLoaded,
      apiTotalItemsReported: apiTotalItemsReported || undefined,
      variationSlotsTotal
    }
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
      [rubricId],
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
    pageReq = pg > pageReq ? pg + 1 : pageReq + 1;
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

/**
 * Returns child rubric IDs for a given parent rubric.
 * Returns [] if the rubric has no children or on error.
 */
export async function fetchChildRubricIds(token: string, parentId: number): Promise<number[]> {
  try {
    const children = await fetchRubricChildren(token, parentId);
    return children.map((r) => r.id);
  } catch {
    return [];
  }
}

/**
 * Expands a single rubric ID to include itself + all direct children.
 * Used so that selecting a parent rubric automatically covers sub-rubrics.
 */
export async function expandRubricWithChildren(token: string, rubricId: number): Promise<number[]> {
  const children = await fetchChildRubricIds(token, rubricId);
  if (children.length === 0) return [rubricId];
  return [rubricId, ...children];
}

export async function fetchMergedRubricsProducts(
  token: string,
  variation: string,
  rubricIds: number[],
  pipe: RubricFetchPipeline,
  catalogScope: RubricCatalogScope = "active_offers"
): Promise<FetchRubricProductsResult> {
  return fetchAllProductsForRubrics(token, variation, rubricIds, pipe, catalogScope);
}

/**
 * Рубрика + прямые дочерние (если у родителя в API нет своих карточек — типично для «весь ассортимент»).
 */
export async function fetchAllProductsInRubricTree(
  token: string,
  variation: string,
  rubricId: number,
  pipe: RubricFetchPipeline,
  catalogScope: RubricCatalogScope = "full_catalog"
): Promise<FetchRubricProductsResult> {
  const rubricIds = await expandRubricWithChildren(token, rubricId);
  console.log(
    `[fetchRubricTree] root=${rubricId} → query rubrics [${rubricIds.join(",")}] scope=${catalogScope}`
  );
  return fetchMergedRubricsProducts(token, variation, rubricIds, pipe, catalogScope);
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

/** Для CSV-фида: подтянуть i18n/названия из API, EAN и картинки оставить из фида. */
export async function enrichFeedProductsFromApi(
  token: string,
  variation: string,
  feedProducts: FpProduct[]
): Promise<{
  products: FpProduct[];
  infoIdsReturned: number;
  infoBatchesFailed: number;
}> {
  if (!feedProducts.length) {
    return { products: [], infoIdsReturned: 0, infoBatchesFailed: 0 };
  }
  const ids = feedProducts.map((p) => p.id);
  const feedById = new Map(feedProducts.map((p) => [p.id, p]));
  const fullByIds = new Map<number, FpProduct>();
  const chunks: number[][] = [];
  for (let i = 0; i < ids.length; i += ENRICH_BATCH) {
    chunks.push(ids.slice(i, i + ENRICH_BATCH));
  }
  let infoBatchesFailed = 0;
  for (let i = 0; i < chunks.length; i += ENRICH_CONCURRENCY) {
    const slice = chunks.slice(i, i + ENRICH_CONCURRENCY);
    await Promise.all(
      slice.map(async (chunk) => {
        const { products, failed } = await fetchProductInfoChunk(
          token,
          variation,
          chunk
        );
        if (failed) infoBatchesFailed += 1;
        for (const p of products) fullByIds.set(p.id, p);
        const missing = chunk.filter((id) => !fullByIds.has(id));
        for (let m = 0; m < missing.length; m += ENRICH_SINGLE_CONCURRENCY) {
          const part = missing.slice(m, m + ENRICH_SINGLE_CONCURRENCY);
          await Promise.all(
            part.map(async (id) => {
              const one = await fetchProductInfoChunk(token, variation, [id]);
              if (one.failed) infoBatchesFailed += 1;
              for (const p of one.products) fullByIds.set(p.id, p);
            })
          );
        }
      })
    );
  }
  const out: FpProduct[] = [];
  for (const feed of feedProducts) {
    const full = fullByIds.get(feed.id);
    out.push(full ? mergeFeedRowWithApiInfo(feed, full) : fpProductWithMergedEans(feed));
  }
  return {
    products: out,
    infoIdsReturned: fullByIds.size,
    infoBatchesFailed
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
    const json = JSON.parse(text) as ApiEnvelope<Record<string, unknown>>;
    for (const p of parseProductsFromInfoEnvelope(json)) {
      const merged = fpProductWithMergedEans(normalizeFpProductListShape(p));
      const kept = filterFpProductKeepActiveOfferVariations(merged);
      out.push(kept ?? merged);
    }
  }
  return out;
}
