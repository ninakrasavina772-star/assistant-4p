import type {
  ArticleMatchRow,
  AttrMatchOptions,
  CompareProduct,
  CompareResult,
  DuplicateEanEnrichedRow,
  EanMatchRow,
  FpProduct,
  IdMatchRow,
  NameLocale,
  NameMatchRow
} from "./types";
import { productBrandName } from "./brand-filter";
import {
  buildOnlyACrossWithB,
  buildOnlyAInternalDups,
  buildOnlyBCrossWithA,
  buildOnlyBInternalDups
} from "./crossList";
import { classifyCrossSoftPair, prefetchOnlyBCrossPhashes } from "./dupTiers";
import type { PhashCache } from "./imagePhash";
import { findIntraSiteDuplicates } from "./intraSiteDups";
import { sameBrandForFuzzy } from "./pairScoring";
import {
  collectArticleKeys,
  collectEans,
  pickComparableName,
  toCompareProduct
} from "./product";

export { PAIR_MIN } from "./pairScoring";

function enrichDuplicateEanForUi(
  warnings: { site: "A" | "B"; ean: string; productIds: number[] }[],
  productsA: FpProduct[],
  productsB: FpProduct[]
): DuplicateEanEnrichedRow[] {
  const mapA = new Map<number, FpProduct>();
  const mapB = new Map<number, FpProduct>();
  for (const p of productsA) mapA.set(p.id, p);
  for (const p of productsB) mapB.set(p.id, p);
  return warnings.map((w) => {
    const m = w.site === "A" ? mapA : mapB;
    const products = w.productIds
      .map((id) => {
        const p = m.get(id);
        return p ? toCompareProduct(p) : null;
      })
      .filter((x): x is CompareProduct => x != null);
    return { site: w.site, ean: w.ean, products };
  });
}

/**
 * EAN → id первого встреченного товара; дубликаты EAN (разные id) — в warnings.
 */
function buildEanIndex(products: FpProduct[], site: "A" | "B") {
  const map = new Map<string, number>();
  const dups: { ean: string; productIds: number[]; site: "A" | "B" }[] = [];
  const eanToIds = new Map<string, Set<number>>();
  for (const p of products) {
    for (const ean of collectEans(p)) {
      if (!ean) continue;
      if (!eanToIds.has(ean)) eanToIds.set(ean, new Set());
      eanToIds.get(ean)!.add(p.id);
      if (!map.has(ean)) map.set(ean, p.id);
    }
  }
  for (const [ean, ids] of eanToIds) {
    if (ids.size > 1) {
      dups.push({ ean, site, productIds: [...ids] });
    }
  }
  return { map, dups };
}

function buildArticleIndex(products: FpProduct[], site: "A" | "B") {
  const map = new Map<string, number>();
  const dups: { article: string; productIds: number[]; site: "A" | "B" }[] = [];
  const keyToIds = new Map<string, Set<number>>();
  for (const p of products) {
    for (const art of collectArticleKeys(p)) {
      if (!art) continue;
      if (!keyToIds.has(art)) keyToIds.set(art, new Set());
      keyToIds.get(art)!.add(p.id);
      if (!map.has(art)) map.set(art, p.id);
    }
  }
  for (const [art, ids] of keyToIds) {
    if (ids.size > 1) {
      dups.push({ article: art, site, productIds: [...ids] });
    }
  }
  return { map, dups };
}

function normBrand(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * Товары из `catalogB`, у которых **ни один** нормализованный ключ не встречается в `catalogA`.
 * Ключи: article, code, vendor_code и суффикс карточки из ссылки (`…-a123…` → `a123`, как в UI).
 * Если у позиции B нет ни одного ключа — её нельзя проверить по артикулу/карточке;
 * такие строки включаются в новинки (см. `countMissingArticleKeysOnCatalogB`).
 */
export function computeNoveltiesByArticle(
  catalogA: FpProduct[],
  catalogB: FpProduct[],
  nameLocale: NameLocale
): {
  noveltiesFromB: FpProduct[];
  countMissingArticleKeysOnCatalogB: number;
} {
  const keysOnA = new Set<string>();
  for (const p of catalogA) {
    for (const k of collectArticleKeys(p)) keysOnA.add(k);
  }
  let missingKeysOnB = 0;
  const noveltiesFromB = catalogB.filter((p) => {
    const kb = collectArticleKeys(p);
    if (kb.length === 0) {
      missingKeysOnB += 1;
      return true;
    }
    return !kb.some((k) => keysOnA.has(k));
  });
  noveltiesFromB.sort((a, b) =>
    pickComparableName(toCompareProduct(a), nameLocale).localeCompare(
      pickComparableName(toCompareProduct(b), nameLocale),
      "ru"
    )
  );
  return {
    noveltiesFromB,
    countMissingArticleKeysOnCatalogB: missingKeysOnB
  };
}

export async function runCompare(
  productsA: FpProduct[],
  productsB: FpProduct[],
  nameLocale: NameLocale,
  siteALabel: string,
  siteBLabel: string,
  attrOpts?: AttrMatchOptions
): Promise<CompareResult> {
  const idxA = buildEanIndex(productsA, "A");
  const idxB = buildEanIndex(productsB, "B");
  const artIdxA = buildArticleIndex(productsA, "A");
  const artIdxB = buildArticleIndex(productsB, "B");
  const duplicateEanWarnings = [
    ...idxA.dups.map((d) => ({ site: d.site, ean: d.ean, productIds: d.productIds })),
    ...idxB.dups.map((d) => ({ site: d.site, ean: d.ean, productIds: d.productIds }))
  ];
  const duplicateArticleWarnings = [
    ...artIdxA.dups.map((d) => ({
      site: d.site,
      article: d.article,
      productIds: d.productIds
    })),
    ...artIdxB.dups.map((d) => ({
      site: d.site,
      article: d.article,
      productIds: d.productIds
    }))
  ];

  const eanMatches: EanMatchRow[] = [];
  const usedA = new Set<number>();
  const usedB = new Set<number>();
  let eanTrivialSameId = 0;

  const idSetA = new Set(productsA.map((p) => p.id));
  const idSetB = new Set(productsB.map((p) => p.id));
  const productByIdA = new Map(productsA.map((p) => [p.id, p]));
  const productByIdB = new Map(productsB.map((p) => [p.id, p]));
  const idMatches: IdMatchRow[] = [];
  for (const pB of productsB) {
    if (!idSetA.has(pB.id)) continue;
    const pA = productByIdA.get(pB.id);
    if (!pA) continue;
    usedA.add(pA.id);
    usedB.add(pB.id);
    idMatches.push({
      id: pB.id,
      a: toCompareProduct(pA),
      b: toCompareProduct(pB)
    });
  }

  for (const [ean, idA] of idxA.map) {
    if (usedA.has(idA)) continue;
    const idB = idxB.map.get(ean);
    if (idB === undefined) continue;
    if (usedB.has(idB)) continue;
    const pA = productByIdA.get(idA);
    const pB = productByIdB.get(idB);
    if (!pA || !pB) continue;
    if (pA.id === pB.id) {
      eanTrivialSameId += 1;
    } else {
      eanMatches.push({
        ean,
        a: toCompareProduct(pA),
        b: toCompareProduct(pB)
      });
    }
    usedA.add(pA.id);
    usedB.add(pB.id);
  }

  const articleMatches: ArticleMatchRow[] = [];
  let articleTrivialSameId = 0;
  for (const [art, idA] of artIdxA.map) {
    const idB = artIdxB.map.get(art);
    if (idB === undefined) continue;
    if (usedA.has(idA) || usedB.has(idB)) continue;
    const pA = productByIdA.get(idA);
    const pB = productByIdB.get(idB);
    if (!pA || !pB) continue;
    if (pA.id === pB.id) {
      articleTrivialSameId += 1;
    } else {
      articleMatches.push({
        article: art,
        a: toCompareProduct(pA),
        b: toCompareProduct(pB)
      });
    }
    usedA.add(pA.id);
    usedB.add(pB.id);
  }

  const restA = productsA.filter((p) => !usedA.has(p.id));
  const restB = productsB.filter((p) => !usedB.has(p.id));

  const byBrandB = new Map<string, FpProduct[]>();
  for (const p of restB) {
    const key = normBrand(productBrandName(p)) || "__no_brand__";
    if (!byBrandB.has(key)) byBrandB.set(key, []);
    byBrandB.get(key)!.push(p);
  }

  type Cand = {
    a: FpProduct;
    b: FpProduct;
    cA: CompareProduct;
    cB: CompareProduct;
    score01: number;
    matchReasons: string[];
  };
  const candidates: Cand[] = [];

  const byBrandArest = new Map<string, FpProduct[]>();
  for (const p of restA) {
    const key = normBrand(productBrandName(p)) || "__no_brand__";
    if (!byBrandArest.has(key)) byBrandArest.set(key, []);
    byBrandArest.get(key)!.push(p);
  }
  const phashCache: PhashCache = new Map();
  await prefetchOnlyBCrossPhashes(restB, byBrandArest, nameLocale, phashCache);

  for (const pA of restA) {
    const cA = toCompareProduct(pA);
    const keyA = normBrand(productBrandName(pA)) || "__no_brand__";
    const list = byBrandB.get(keyA);
    if (!list) continue;
    for (const pB of list) {
      if (pA.id === pB.id) continue;
      const cB = toCompareProduct(pB);
      if (!sameBrandForFuzzy(cA, cB)) continue;
      const r = await classifyCrossSoftPair(
        cA,
        cB,
        nameLocale,
        attrOpts,
        phashCache
      );
      if (!r) continue;
      candidates.push({
        a: pA,
        b: pB,
        cA,
        cB,
        score01: r.score,
        matchReasons: r.matchReasons
      });
    }
  }
  candidates.sort((x, y) => y.score01 - x.score01 || x.a.id - x.b.id);

  const usedA2 = new Set<number>();
  const usedB2 = new Set<number>();
  const nameMatches: NameMatchRow[] = [];
  for (const c of candidates) {
    if (usedA2.has(c.a.id) || usedB2.has(c.b.id)) continue;
    usedA2.add(c.a.id);
    usedB2.add(c.b.id);
    nameMatches.push({
      a: c.cA,
      b: c.cB,
      score: c.score01,
      matchReasons: c.matchReasons
    });
  }

  const compA = restA.map((p) => toCompareProduct(p));
  const compB = restB.map((p) => toCompareProduct(p));
  const onlyA = compA.filter((c) => !usedA2.has(c.id));
  const onlyB = compB.filter((c) => !usedB2.has(c.id));

  const rawOnlyB = restB
    .filter((p) => !usedB2.has(p.id))
    .sort((a, b) =>
      pickComparableName(toCompareProduct(a), nameLocale).localeCompare(
        pickComparableName(toCompareProduct(b), nameLocale),
        "ru"
      )
    );

  const rawOnlyA = restA
    .filter((p) => !usedA2.has(p.id))
    .sort((a, b) =>
      pickComparableName(toCompareProduct(a), nameLocale).localeCompare(
        pickComparableName(toCompareProduct(b), nameLocale),
        "ru"
      )
    );

  nameMatches.sort((x, y) => y.score - x.score);

  const unplacedBByIdRaw = productsB
    .filter((p) => !idSetA.has(p.id))
    .sort((a, b) =>
      pickComparableName(toCompareProduct(a), nameLocale).localeCompare(
        pickComparableName(toCompareProduct(b), nameLocale),
        "ru"
      )
    );
  const unplacedAByIdRaw = productsA
    .filter((p) => !idSetB.has(p.id))
    .sort((a, b) =>
      pickComparableName(toCompareProduct(a), nameLocale).localeCompare(
        pickComparableName(toCompareProduct(b), nameLocale),
        "ru"
      )
    );
  const intraSiteADups = await findIntraSiteDuplicates(
    productsA,
    nameLocale,
    attrOpts
  );
  const intraSiteBDups = await findIntraSiteDuplicates(
    productsB,
    nameLocale,
    attrOpts
  );

  const {
    noveltiesFromB,
    countMissingArticleKeysOnCatalogB
  } = computeNoveltiesByArticle(productsA, productsB, nameLocale);
  const {
    noveltiesFromB: noveltiesFromAsPerspective,
    countMissingArticleKeysOnCatalogB: countMissingArticleKeysOnCatalogA
  } = computeNoveltiesByArticle(productsB, productsA, nameLocale);

  const onlyBCrossWithA = await buildOnlyBCrossWithA(
    noveltiesFromB,
    productsA,
    nameLocale,
    attrOpts
  );
  const onlyACrossWithB = await buildOnlyACrossWithB(
    noveltiesFromAsPerspective,
    productsB,
    nameLocale,
    attrOpts
  );
  const onlyBInternalDups = await buildOnlyBInternalDups(
    noveltiesFromB,
    nameLocale,
    attrOpts
  );
  const onlyAInternalDups = await buildOnlyAInternalDups(
    noveltiesFromAsPerspective,
    nameLocale,
    attrOpts
  );
  const duplicateEanEnriched = enrichDuplicateEanForUi(
    duplicateEanWarnings,
    productsA,
    productsB
  );

  return {
    siteALabel,
    siteBLabel,
    nameLocale,
    idMatches: idMatches.sort((x, y) => x.id - y.id),
    unplacedBByIdRaw,
    unplacedAByIdRaw,
    intraSiteADups: {
      eanGroups: intraSiteADups.eanGroups,
      namePhotoPairs: intraSiteADups.namePhotoPairs,
      brandVisualPairs: intraSiteADups.brandVisualPairs,
      unlikelyPairs: intraSiteADups.unlikelyPairs
    },
    intraSiteBDups: {
      eanGroups: intraSiteBDups.eanGroups,
      namePhotoPairs: intraSiteBDups.namePhotoPairs,
      brandVisualPairs: intraSiteBDups.brandVisualPairs,
      unlikelyPairs: intraSiteBDups.unlikelyPairs
    },
    eanMatches: eanMatches.sort((x, y) => x.ean.localeCompare(y.ean)),
    eanTrivialSameId,
    articleTrivialSameId,
    articleMatches: articleMatches.sort((x, y) =>
      x.article.localeCompare(y.article)
    ),
    nameMatches,
    onlyA: onlyA.sort((a, b) =>
      pickComparableName(a, nameLocale).localeCompare(pickComparableName(b, nameLocale), "ru")
    ),
    onlyB: onlyB.sort((a, b) =>
      pickComparableName(a, nameLocale).localeCompare(pickComparableName(b, nameLocale), "ru")
    ),
    stats: {
      countA: productsA.length,
      countB: productsB.length,
      idPlacedCount: idMatches.length,
      unplacedBByIdCount: unplacedBByIdRaw.length,
      unplacedAByIdCount: unplacedAByIdRaw.length,
      /** Товары B: ни один их артикул не найден среди артикулов A — основа новинок и кросс-дублей */
      noveltiesBByArticleCount: noveltiesFromB.length,
      /** Симметрично: товары A без пересечения артикулов с каталогом B */
      noveltiesAByArticleCount: noveltiesFromAsPerspective.length,
      /** Сколько строк B без полей артикула/code/vendor (включены в новинки как «нет кода») */
      noveltiesIncludedBmissingArticleFields: countMissingArticleKeysOnCatalogB,
      noveltiesIncludedAmissingArticleFields: countMissingArticleKeysOnCatalogA,
      eanMatchCount: eanMatches.length,
      articleMatchCount: articleMatches.length,
      nameCandidateCount: nameMatches.length
    },
    duplicateEanWarnings,
    duplicateArticleWarnings,
    duplicateEanEnriched,
    noveltiesByArticleRaw: noveltiesFromB,
    noveltiesAByArticleRaw: noveltiesFromAsPerspective,
    rawOnlyB,
    rawOnlyA,
    onlyBCrossWithA,
    onlyACrossWithB,
    onlyBInternalDups,
    onlyAInternalDups
  };
}
