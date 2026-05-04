import { filterFpProductsByBrands, type BrandMatchMode } from "./brand-filter";
import {
  filterFpProductsByModels,
  type ModelMatchMode
} from "./model-filter";
import type { FpProduct } from "./types";

const DEFAULT_BASE = "https://api.4partners.io/v1";

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
      "User-Agent": "rubric-compare/0.1"
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

const USER_AGENT = "rubric-compare/0.1";

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
