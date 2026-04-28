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

export async function fetchAllProductsInRubric(
  token: string,
  siteVariation: string,
  rubricId: number
): Promise<FpProduct[]> {
  const all: FpProduct[] = [];
  for (let page = 1; ; page++) {
    const chunk = await fetchProductListPage(token, siteVariation, rubricId, page);
    if (!chunk.length) break;
    all.push(...chunk);
    if (chunk.length < PAGE_SIZE_HINT) break;
  }
  return all;
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
