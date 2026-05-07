import { filterFpProductsByBrands, type BrandMatchMode } from "./brand-filter";
import {
  filterFpProductsByModels,
  type ModelMatchMode
} from "./model-filter";
import type { FpProduct } from "./types";

const DEFAULT_BASE = "https://api.4partners.io/v1";

const USER_AGENT = "rubric-compare/0.1";

type ApiResponse<T> = {
  status?: string;
  status_code?: number;
  message?: string;
  result?: T;
};

function baseUrl() {
  return (process.env.FOURPARTNERS_API_BASE || DEFAULT_BASE).replace(/\/$/, "");
}

export async function fetchProductListPage(
  token: string,
  siteVariation: string,
  rubricId: number,
  page: number
): Promise<FpProduct[]> {
  const url = `${baseUrl()}/product/list/${encodeURIComponent(siteVariation)}/products`;
  const body = JSON.stringify({
    page,
    filter_rubrics: [rubricId],
    order: "popular"
  });
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-Auth-Token": token,
      "User-Agent": USER_AGENT
    },
    body,
    cache: "no-store"
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`4Partners ${res.status}: ${t.slice(0, 500)}`);
  }
  const json = (await res.json()) as ApiResponse<{ products?: FpProduct[] }>;
  if (json.status && json.status !== "ok" && json.status_code && json.status_code >= 400) {
    throw new Error(json.message || `4Partners: ${String(json.status_code)}`);
  }
  return json.result?.products || [];
}

/** Один и тот же page size, что в ответе API (обычно до 500 за запрос). */
const PAGE_SIZE_HINT = 500;

/**
 * Пайплайн на каждой странице выгрузки: меньше держим в памяти и быстрее match,
 * чем «скачать всю рубрику → потом отфильтровать».
 * Число запросов к API то же; пик RAM и работа runCompare снижаются.
 */
export type RubricFetchPipeline = {
  excludeIds?: Set<number>;
  /** Для счётчика «id из списка не встретился в рубрике» */
  excludeIdsRaw?: number[];
  brands?: string[];
  brandMatch?: BrandMatchMode;
  models?: string[];
  modelMatch?: ModelMatchMode;
};

export type FetchAllProductsResult = {
  products: FpProduct[];
  brandExcludedMissing: number;
  brandExcludedNotInList: number;
  modelExcludedNotInList: number;
  excludeMeta?: {
    removedFromA: number;
    listIdsNotFoundInRubric: number;
  };
};

export async function fetchAllProductsInRubric(
  token: string,
  siteVariation: string,
  rubricId: number,
  pipeline?: RubricFetchPipeline
): Promise<FetchAllProductsResult> {
  const excludeSet = pipeline?.excludeIds;
  const excludeRaw = pipeline?.excludeIdsRaw;
  const brands = pipeline?.brands?.length ? pipeline.brands : null;
  const brandMatch: BrandMatchMode = pipeline?.brandMatch === "contains" ? "contains" : "exact";
  const models = pipeline?.models?.length ? pipeline.models : null;
  const modelMatch: ModelMatchMode = pipeline?.modelMatch === "exact" ? "exact" : "contains";

  const all: FpProduct[] = [];
  let brandExcludedMissing = 0;
  let brandExcludedNotInList = 0;
  let modelExcludedNotInList = 0;
  let removedFromA = 0;
  const idsSeenInRubric = new Set<number>();

  for (let page = 1; ; page++) {
    const chunk = await fetchProductListPage(token, siteVariation, rubricId, page);
    if (!chunk.length) break;
    for (const p of chunk) {
      idsSeenInRubric.add(p.id);
    }
    let working = chunk;
    if (excludeSet && excludeSet.size > 0) {
      for (const p of chunk) {
        if (excludeSet.has(p.id)) removedFromA += 1;
      }
      working = working.filter((p) => !excludeSet.has(p.id));
    }
    if (brands) {
      const r = filterFpProductsByBrands(working, brands, brandMatch);
      brandExcludedMissing += r.excludedMissingBrand;
      brandExcludedNotInList += r.excludedNotInList;
      working = r.products;
    }
    if (models) {
      const r = filterFpProductsByModels(working, models, modelMatch);
      modelExcludedNotInList += r.excludedNotInList;
      working = r.products;
    }
    all.push(...working);
    if (chunk.length < PAGE_SIZE_HINT) break;
  }

  let excludeMeta: FetchAllProductsResult["excludeMeta"];
  if (excludeSet && excludeRaw && excludeRaw.length > 0) {
    let listIdsNotFoundInRubric = 0;
    for (const id of excludeSet) {
      if (!idsSeenInRubric.has(id)) listIdsNotFoundInRubric += 1;
    }
    excludeMeta = { removedFromA, listIdsNotFoundInRubric };
  }

  return {
    products: all,
    brandExcludedMissing,
    brandExcludedNotInList,
    modelExcludedNotInList,
    excludeMeta
  };
}

/** Только уникальные id товаров по рубрике (после того же пайплайна, что fetchAllProductsInRubric — мало RAM). */
export type FetchRubricIdsResult = Omit<FetchAllProductsResult, "products"> & {
  ids: number[];
};

export async function fetchRubricProductIds(
  token: string,
  siteVariation: string,
  rubricId: number,
  pipeline?: RubricFetchPipeline
): Promise<FetchRubricIdsResult> {
  const excludeSet = pipeline?.excludeIds;
  const excludeRaw = pipeline?.excludeIdsRaw;
  const brands = pipeline?.brands?.length ? pipeline.brands : null;
  const brandMatch: BrandMatchMode =
    pipeline?.brandMatch === "contains" ? "contains" : "exact";
  const models = pipeline?.models?.length ? pipeline.models : null;
  const modelMatch: ModelMatchMode =
    pipeline?.modelMatch === "exact" ? "exact" : "contains";

  const idSet = new Set<number>();
  let brandExcludedMissing = 0;
  let brandExcludedNotInList = 0;
  let modelExcludedNotInList = 0;
  let removedFromA = 0;
  const idsSeenInRubric = new Set<number>();

  for (let page = 1; ; page++) {
    const chunk = await fetchProductListPage(token, siteVariation, rubricId, page);
    if (!chunk.length) break;
    for (const p of chunk) {
      idsSeenInRubric.add(p.id);
    }
    let working = chunk;
    if (excludeSet && excludeSet.size > 0) {
      for (const p of chunk) {
        if (excludeSet.has(p.id)) removedFromA += 1;
      }
      working = working.filter((p) => !excludeSet.has(p.id));
    }
    if (brands) {
      const r = filterFpProductsByBrands(working, brands, brandMatch);
      brandExcludedMissing += r.excludedMissingBrand;
      brandExcludedNotInList += r.excludedNotInList;
      working = r.products;
    }
    if (models) {
      const r = filterFpProductsByModels(working, models, modelMatch);
      modelExcludedNotInList += r.excludedNotInList;
      working = r.products;
    }
    for (const p of working) {
      idSet.add(p.id);
    }
    if (chunk.length < PAGE_SIZE_HINT) break;
  }

  let excludeMeta: FetchAllProductsResult["excludeMeta"];
  if (excludeSet && excludeRaw && excludeRaw.length > 0) {
    let listIdsNotFoundInRubric = 0;
    for (const id of excludeSet) {
      if (!idsSeenInRubric.has(id)) listIdsNotFoundInRubric += 1;
    }
    excludeMeta = { removedFromA, listIdsNotFoundInRubric };
  }

  const ids = [...idSet].sort((a, b) => a - b);

  return {
    ids,
    brandExcludedMissing,
    brandExcludedNotInList,
    modelExcludedNotInList,
    excludeMeta
  };
}

/** Несколько рубрик B: id объединяются без дублей. */
export async function fetchMergedRubricsProductIds(
  token: string,
  siteVariation: string,
  rubricIds: number[],
  pipeline?: RubricFetchPipeline
): Promise<FetchRubricIdsResult> {
  const uniqIds = [...new Set(rubricIds.filter((id) => id > 0))];
  if (uniqIds.length === 0) {
    return {
      ids: [],
      brandExcludedMissing: 0,
      brandExcludedNotInList: 0,
      modelExcludedNotInList: 0
    };
  }
  if (uniqIds.length === 1) {
    return fetchRubricProductIds(token, siteVariation, uniqIds[0]!, pipeline);
  }
  const batches = await Promise.all(
    uniqIds.map((rubricId) =>
      fetchRubricProductIds(token, siteVariation, rubricId, pipeline)
    )
  );
  const merged = new Set<number>();
  let brandExcludedMissing = 0;
  let brandExcludedNotInList = 0;
  let modelExcludedNotInList = 0;
  for (const batch of batches) {
    brandExcludedMissing += batch.brandExcludedMissing;
    brandExcludedNotInList += batch.brandExcludedNotInList;
    modelExcludedNotInList += batch.modelExcludedNotInList;
    for (const id of batch.ids) {
      merged.add(id);
    }
  }
  return {
    ids: [...merged].sort((a, b) => a - b),
    brandExcludedMissing,
    brandExcludedNotInList,
    modelExcludedNotInList
  };
}

/** GET /product/info/{ids}/{siteVariation} — до 50 id за запрос (Partner Site API). */
const PRODUCT_INFO_BATCH = 50;

function pushProductsFromInfoPayload(result: unknown, out: FpProduct[]): void {
  if (!result || typeof result !== "object") return;
  const r = result as Record<string, unknown>;
  const arr = r.products;
  if (Array.isArray(arr)) {
    out.push(...(arr as FpProduct[]));
    return;
  }
  const prod = r.product;
  if (Array.isArray(prod)) {
    out.push(...(prod as FpProduct[]));
    return;
  }
  if (prod && typeof prod === "object" && "id" in prod) {
    out.push(prod as FpProduct);
  }
}

export async function fetchProductsByIds(
  token: string,
  siteVariation: string,
  ids: number[]
): Promise<FpProduct[]> {
  const uniq = [
    ...new Set(
      ids
        .map((n) => Math.floor(Number(n)))
        .filter((n) => Number.isFinite(n) && n > 0)
    )
  ].sort((a, b) => a - b);
  const out: FpProduct[] = [];
  const seen = new Set<number>();

  for (let i = 0; i < uniq.length; i += PRODUCT_INFO_BATCH) {
    const batch = uniq.slice(i, i + PRODUCT_INFO_BATCH);
    const idsPath = batch.join(",");
    const url = `${baseUrl()}/product/info/${idsPath}/${encodeURIComponent(siteVariation)}`;
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "X-Auth-Token": token,
        "User-Agent": USER_AGENT
      },
      cache: "no-store"
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`4Partners product/info ${res.status}: ${t.slice(0, 500)}`);
    }
    const json = (await res.json()) as ApiResponse<unknown>;
    if (
      json.status &&
      json.status !== "ok" &&
      json.status_code &&
      json.status_code >= 400
    ) {
      throw new Error(json.message || `4Partners: ${String(json.status_code)}`);
    }
    pushProductsFromInfoPayload(json.result, out);
  }

  const deduped: FpProduct[] = [];
  for (const p of out) {
    if (!seen.has(p.id)) {
      seen.add(p.id);
      deduped.push(p);
    }
  }
  return deduped;
}

/** Несколько рубрик на одной витрине B: параллельная выгрузка, склейка по id без дублей (первое вхождение). */
export async function fetchMergedRubricsProducts(
  token: string,
  siteVariation: string,
  rubricIds: number[],
  pipeline?: RubricFetchPipeline
): Promise<FetchAllProductsResult> {
  const uniqIds = [...new Set(rubricIds.filter((id) => id > 0))];
  if (uniqIds.length === 0) {
    return {
      products: [],
      brandExcludedMissing: 0,
      brandExcludedNotInList: 0,
      modelExcludedNotInList: 0
    };
  }
  if (uniqIds.length === 1) {
    return fetchAllProductsInRubric(token, siteVariation, uniqIds[0]!, pipeline);
  }
  const batches = await Promise.all(
    uniqIds.map((rubricId) =>
      fetchAllProductsInRubric(token, siteVariation, rubricId, pipeline)
    )
  );
  const byId = new Map<number, FpProduct>();
  let brandExcludedMissing = 0;
  let brandExcludedNotInList = 0;
  let modelExcludedNotInList = 0;
  for (const batch of batches) {
    brandExcludedMissing += batch.brandExcludedMissing;
    brandExcludedNotInList += batch.brandExcludedNotInList;
    modelExcludedNotInList += batch.modelExcludedNotInList;
    for (const p of batch.products) {
      if (!byId.has(p.id)) byId.set(p.id, p);
    }
  }
  return {
    products: [...byId.values()],
    brandExcludedMissing,
    brandExcludedNotInList,
    modelExcludedNotInList
  };
}

/** Категория из /rubric/main и /rubric/child (Partner Site API V1) */
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

async function readRubricListResponse(
  res: Response
): Promise<FpRubric[]> {
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`4Partners ${res.status}: ${t.slice(0, 500)}`);
  }
  const json = (await res.json()) as ApiResponse<{ rubrics?: FpRubric[] }>;
  if (json.status && json.status !== "ok" && json.status_code && json.status_code >= 400) {
    throw new Error(json.message || `4Partners: ${String(json.status_code)}`);
  }
  return json.result?.rubrics || [];
}

/** Активные витринные рубрики (без бана) — для выпадающих списков */
export function filterActiveRubricsForUi(rubrics: FpRubric[]): FpRubric[] {
  return rubrics.filter(
    (r) => r.is_active === true && r.is_ban !== true
  );
}

export function sortRubricsForUi(rubrics: FpRubric[]): FpRubric[] {
  return [...rubrics].sort(
    (a, b) =>
      (a.position ?? 0) - (b.position ?? 0) ||
      a.name.localeCompare(b.name, "ru", { sensitivity: "base" })
  );
}

export async function fetchMainRubrics(token: string): Promise<FpRubric[]> {
  const url = `${baseUrl()}/rubric/main`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "X-Auth-Token": token,
      "User-Agent": USER_AGENT
    },
    cache: "no-store"
  });
  const list = await readRubricListResponse(res);
  return sortRubricsForUi(filterActiveRubricsForUi(list));
}

export async function fetchRubricChildren(
  token: string,
  parentId: number
): Promise<FpRubric[]> {
  const url = `${baseUrl()}/rubric/child/${encodeURIComponent(String(parentId))}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "X-Auth-Token": token,
      "User-Agent": USER_AGENT
    },
    cache: "no-store"
  });
  const list = await readRubricListResponse(res);
  return sortRubricsForUi(filterActiveRubricsForUi(list));
}
