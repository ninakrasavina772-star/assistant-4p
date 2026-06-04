/**
 * Кандидаты для AI-проверки чистых новинок — без sharp/imagePhash (можно импортировать из client).
 */
import { normalizeBrandName, productBrandName } from "./brand-filter";
import { nameAndModelScore } from "./nameModel";
import { pickComparableName, toCompareProduct } from "./product";
import type { CompareProduct, FpProduct, NameLocale } from "./types";

/** Максимум кандидатов с A на одну чистую новинку для AI-проверки. */
const MAX_AI_CANDIDATES_PER_NOVELTY = 4;

function titleTokens(s: string): Set<string> {
  return new Set(
    (s || "")
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length > 2)
  );
}

function tokenJaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union > 0 ? inter / union : 0;
}

export type NoveltyAiCandidate = {
  productOnA: CompareProduct;
  productOnAId: number;
  /** 0..1 — max(jaccard токенов, model nameAndModelScore) */
  textScore: number;
};

function brandBucketKey(p: FpProduct): string {
  return normalizeBrandName(productBrandName(p)) || "__empty_brand__";
}

function rankPoolForAi(
  b: FpProduct,
  cB: CompareProduct,
  pool: FpProduct[],
  nameLocale: NameLocale,
  maxScan: number
): { p: FpProduct; score: number }[] {
  const slice = pool.length > maxScan ? pool.slice(0, maxScan) : pool;
  const na = pickComparableName(cB, nameLocale);
  const tokB = titleTokens(cB.nameRu + " " + cB.nameEn + " " + (b.name || ""));
  const scored: { p: FpProduct; score: number }[] = [];
  for (const other of slice) {
    if (other.id === b.id) continue;
    const cO = toCompareProduct(other);
    const nb = pickComparableName(cO, nameLocale);
    const tokO = titleTokens(
      cO.nameRu + " " + cO.nameEn + " " + (other.name || "")
    );
    const jac = tokenJaccard(tokO, tokB);
    const { model } = nameAndModelScore(na, nb, cB.brand, cO.brand);
    scored.push({ p: other, score: Math.max(jac, model) });
  }
  scored.sort((x, y) => y.score - x.score);
  return scored;
}

function scoredToAiCandidates(
  scored: { p: FpProduct; score: number }[]
): NoveltyAiCandidate[] {
  return scored.slice(0, MAX_AI_CANDIDATES_PER_NOVELTY).map(({ p, score }) => {
    const c = toCompareProduct(p);
    return { productOnA: c, productOnAId: p.id, textScore: score };
  });
}

/** Кандидаты для AI (серверная классификация чистых). */
export function buildAiCandidatesForClean(
  b: FpProduct,
  cB: CompareProduct,
  aByBrand: Map<string, FpProduct[]>,
  productsA: FpProduct[],
  bByBrand: Map<string, FpProduct[]>,
  noveltiesB: FpProduct[],
  nameLocale: NameLocale
): NoveltyAiCandidate[] {
  const brandKey = brandBucketKey(b);
  const pools: { items: FpProduct[]; maxScan: number }[] = [
    { items: aByBrand.get(brandKey) ?? [], maxScan: 10_000 },
    { items: productsA, maxScan: 500 },
    { items: bByBrand.get(brandKey) ?? [], maxScan: 10_000 },
    { items: noveltiesB, maxScan: 200 }
  ];
  for (const { items, maxScan } of pools) {
    if (!items.length) continue;
    const scored = rankPoolForAi(b, cB, items, nameLocale, maxScan);
    if (scored.length > 0) return scoredToAiCandidates(scored);
  }
  return [];
}

/** Для UI без перезапуска сравнения: кандидаты только среди новинок B. */
export function buildAiCandidatesAmongNovelties(
  novelty: FpProduct,
  noveltiesPool: FpProduct[],
  nameLocale: NameLocale
): NoveltyAiCandidate[] {
  const cB = toCompareProduct(novelty);
  const byBrand = new Map<string, FpProduct[]>();
  for (const p of noveltiesPool) {
    const k = brandBucketKey(p);
    const arr = byBrand.get(k) ?? [];
    arr.push(p);
    byBrand.set(k, arr);
  }
  return buildAiCandidatesForClean(
    novelty,
    cB,
    new Map(),
    [],
    byBrand,
    noveltiesPool,
    nameLocale
  );
}
