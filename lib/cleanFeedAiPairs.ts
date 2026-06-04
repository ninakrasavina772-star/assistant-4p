import { buildAiCandidatesAmongNovelties } from "./cleanNoveltiesAi";
import { dupPairKey, type DupPairRefineIn } from "./openaiDupRefine";
import { toCompareProduct } from "./product";
import type {
  CompareProduct,
  NameLocale,
  TwoFeedsCleanNoveltiesResult
} from "./types";

/** Что включать в очередь AI для сценария «Чистый фид B vs A». */
export type CleanFeedAiScope = {
  /** Найденные дубли среди новинок B (разные id, один товар). */
  internalB: boolean;
  /** Найденные дубли новинки B ↔ каталог A. */
  vsA: boolean;
  /** Чистые новинки: поиск скрытых дублей (кандидаты с A или среди новинок B). */
  cleanDiscovery: boolean;
};

export const DEFAULT_CLEAN_FEED_AI_SCOPE: CleanFeedAiScope = {
  internalB: true,
  vsA: true,
  cleanDiscovery: true
};

function pickTitle(c: CompareProduct, nl: NameLocale): string {
  return nl === "ru" ? c.nameRu : c.nameEn;
}

function pairIn(
  a: CompareProduct,
  b: CompareProduct,
  layer: string,
  nl: NameLocale
): DupPairRefineIn {
  return {
    idA: a.id,
    idB: b.id,
    titleA: pickTitle(a, nl),
    titleB: pickTitle(b, nl),
    brandA: a.brand,
    brandB: b.brand,
    layer,
    imageUrlA: a.firstImage,
    imageUrlB: b.firstImage
  };
}

/** Ключи пар, которые уже нашла автоматика (EAN / название+фото). */
export function buildCleanFeedAlgorithmPairKeys(
  result: TwoFeedsCleanNoveltiesResult
): Set<string> {
  const s = new Set<string>();
  for (const p of result.duplicatePairs) {
    s.add(dupPairKey(p.novelty.id, p.productOnAId));
  }
  for (const p of result.internalDuplicatePairs ?? []) {
    s.add(dupPairKey(p.aId, p.bId));
  }
  return s;
}

/** Все карточки отчёта для отображения вердиктов AI по id. */
export function collectProductsForCleanFeedAiLookup(
  result: TwoFeedsCleanNoveltiesResult
): Map<number, CompareProduct> {
  const m = new Map<number, CompareProduct>();
  const add = (c: CompareProduct) => m.set(c.id, c);
  for (const p of result.noveltiesAll) add(toCompareProduct(p));
  for (const p of result.duplicatePairs) {
    add(p.novelty);
    add(p.productOnA);
  }
  for (const p of result.internalDuplicatePairs ?? []) {
    add(p.a);
    add(p.b);
  }
  for (const cn of result.cleanNovelties) {
    for (const cand of cn.aiCandidates ?? []) {
      add(cand.productOnA);
    }
  }
  return m;
}

export type CollectCleanFeedAiOptions = {
  scope?: Partial<CleanFeedAiScope>;
  excludePairKeys?: ReadonlySet<string>;
  /** Лимит чистых новинок для discovery (каждая × до 4 кандидатов). */
  maxCleanNovelties?: number;
};

/**
 * Пары для OpenAI: внутренние B↔B, дубли B↔A и/или кандидаты для чистых новинок.
 */
export function collectCleanFeedDupPairsForOpenAi(
  result: TwoFeedsCleanNoveltiesResult,
  maxPairs: number,
  options?: CollectCleanFeedAiOptions
): DupPairRefineIn[] {
  if (maxPairs < 1) return [];
  const scope: CleanFeedAiScope = {
    ...DEFAULT_CLEAN_FEED_AI_SCOPE,
    ...options?.scope
  };
  const nl = result.nameLocale;
  const seen = new Set<string>();
  const out: DupPairRefineIn[] = [];

  const push = (pair: DupPairRefineIn): boolean => {
    const k = dupPairKey(pair.idA, pair.idB);
    if (options?.excludePairKeys?.has(k)) return out.length >= maxPairs;
    if (seen.has(k)) return out.length >= maxPairs;
    seen.add(k);
    out.push(pair);
    return out.length >= maxPairs;
  };

  if (scope.internalB) {
    for (const p of result.internalDuplicatePairs ?? []) {
      if (push(pairIn(p.a, p.b, `clean_feed:internal_b:${p.kind}`, nl))) return out;
    }
  }

  if (scope.vsA) {
    for (const p of result.duplicatePairs) {
      if (
        push(
          pairIn(
            p.productOnA,
            p.novelty,
            `clean_feed:vs_a:${p.kind}`,
            nl
          )
        )
      ) {
        return out;
      }
    }
  }

  if (scope.cleanDiscovery) {
    const noveltiesLimit = options?.maxCleanNovelties ?? 50;
    const pool = result.noveltiesAll;
    let cleanChecked = 0;
    for (const item of result.cleanNovelties) {
      if (out.length >= maxPairs) return out;
      if (item.unverifiable) continue;
      const cands =
        item.aiCandidates && item.aiCandidates.length > 0
          ? item.aiCandidates
          : buildAiCandidatesAmongNovelties(item.product, pool, nl);
      if (cands.length === 0) continue;
      cleanChecked++;
      if (cleanChecked > noveltiesLimit) break;
      const b = toCompareProduct(item.product);
      for (const cand of cands) {
        if (
          push(
            pairIn(
              cand.productOnA,
              b,
              result.stats.countA === 0
                ? "clean_feed:discovery_b"
                : "clean_feed:discovery",
              nl
            )
          )
        ) {
          return out;
        }
      }
    }
  }

  return out;
}

export function countCleanFeedAiPairsAvailable(
  result: TwoFeedsCleanNoveltiesResult,
  scope?: Partial<CleanFeedAiScope>,
  excludePairKeys?: ReadonlySet<string>
): number {
  return collectCleanFeedDupPairsForOpenAi(result, 2_000_000, {
    scope,
    excludePairKeys
  }).length;
}

export function cleanFeedAiScopeBreakdown(
  result: TwoFeedsCleanNoveltiesResult,
  scope?: Partial<CleanFeedAiScope>
): { internalB: number; vsA: number; cleanDiscovery: number; total: number } {
  const internalB = collectCleanFeedDupPairsForOpenAi(result, 2_000_000, {
    scope: { ...DEFAULT_CLEAN_FEED_AI_SCOPE, ...scope, internalB: true, vsA: false, cleanDiscovery: false }
  }).length;
  const vsA = collectCleanFeedDupPairsForOpenAi(result, 2_000_000, {
    scope: { ...DEFAULT_CLEAN_FEED_AI_SCOPE, ...scope, internalB: false, vsA: true, cleanDiscovery: false }
  }).length;
  const cleanDiscovery = collectCleanFeedDupPairsForOpenAi(result, 2_000_000, {
    scope: { ...DEFAULT_CLEAN_FEED_AI_SCOPE, ...scope, internalB: false, vsA: false, cleanDiscovery: true }
  }).length;
  return {
    internalB,
    vsA,
    cleanDiscovery,
    total: collectCleanFeedDupPairsForOpenAi(result, 2_000_000, { scope }).length
  };
}
