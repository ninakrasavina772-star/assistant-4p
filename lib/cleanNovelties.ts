import { productBrandName } from "./brand-filter";
import {
  NAME_TAB_MODEL_MIN as _DEPRECATED_NAME_TAB_MODEL_MIN,
  resolveNameTabPair
} from "./dupTiers";
import { prefetchPhashes, type PhashCache } from "./imagePhash";
import { normBrand } from "./pairScoring";
import { collectEanIndexKeys, toCompareProduct } from "./product";

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
import type {
  AttrMatchOptions,
  CompareProduct,
  FpProduct,
  NameLocale
} from "./types";

// keep import alive to highlight that thresholds in this module come from dupTiers
void _DEPRECATED_NAME_TAB_MODEL_MIN;

/** Найден дубль на A: либо по EAN, либо по бренду/модели/фото. */
export type NoveltyDupMatch = {
  kind: "ean" | "name_photo";
  /** Общий штрихкод (для kind=ean) или причины совпадения по названию */
  ean?: string;
  reasons: string[];
  /** Карточка с сайта A */
  productOnA: CompareProduct;
  /** id товара A — для выгрузки */
  productOnAId: number;
  /** Артикул вариации новинки B с этим EAN (если найден) */
  variantArticleOnB?: string;
};

/** Кандидаты с A для AI-проверки чистых новинок. */
export type NoveltyAiCandidate = {
  productOnA: CompareProduct;
  productOnAId: number;
  /** 0..1 — оценка похожести названия (jaccard) — для отладки */
  textScore: number;
};

export type NoveltyClassification =
  | {
      novelty: FpProduct;
      status: "duplicate";
      dups: NoveltyDupMatch[];
    }
  | {
      novelty: FpProduct;
      status: "clean";
      hasEan: boolean;
      hasImage: boolean;
      /** Топ-K кандидатов с A для AI: тот же бренд + похожее название/первое фото есть. */
      aiCandidates: NoveltyAiCandidate[];
    }
  | {
      novelty: FpProduct;
      status: "unverifiable";
      reason: "no_ean_no_image";
    };

export type CleanNoveltiesSummary = {
  totalNovelties: number;
  duplicates: number;
  clean: number;
  unverifiable: number;
  /** Пары для отчёта (плоский список) */
  dupPairsCount: number;
};

export type CleanNoveltiesResult = {
  classifications: NoveltyClassification[];
  summary: CleanNoveltiesSummary;
};

/**
 * Классификация новинок B по сравнению с каталогом A.
 *
 * - EAN: один штрихкод у B и A (с учётом ведущих нулей) → дубль.
 * - Название/фото: точный бренд + сходство модели ≥ порога + объём не конфликтует
 *   + (одинаковое URL фото ИЛИ похожее phash ИЛИ модель ≥ 0.72).
 * - «Не удалось проверить»: у новинки B нет ни одного EAN и нет первого фото.
 */
export async function classifyNoveltiesAgainstA(
  productsA: FpProduct[],
  noveltiesB: FpProduct[],
  nameLocale: NameLocale,
  attrOpts?: AttrMatchOptions
): Promise<CleanNoveltiesResult> {
  void attrOpts;
  /** Индекс EAN-ключей сайта A → list FpProduct */
  const eanIndexA = new Map<string, FpProduct[]>();
  for (const pA of productsA) {
    for (const key of collectEanIndexKeys(pA)) {
      const arr = eanIndexA.get(key) ?? [];
      arr.push(pA);
      eanIndexA.set(key, arr);
    }
  }

  /** Индекс A по нормализованному бренду. Бренд пустой → ключ "__empty_brand__". */
  const aByBrand = new Map<string, FpProduct[]>();
  for (const pA of productsA) {
    const k = normBrand(productBrandName(pA)) || "__empty_brand__";
    const arr = aByBrand.get(k) ?? [];
    arr.push(pA);
    aByBrand.set(k, arr);
  }

  /** Собираем URL для phash-предзагрузки — только пары, у которых первое фото отличается. */
  const candidatePairs: { b: FpProduct; aSameBrand: FpProduct[] }[] = [];
  for (const b of noveltiesB) {
    const k = normBrand(productBrandName(b)) || "__empty_brand__";
    const aSameBrand = aByBrand.get(k) ?? [];
    candidatePairs.push({ b, aSameBrand });
  }
  const phashUrls = new Set<string>();
  for (const { b, aSameBrand } of candidatePairs) {
    const cB = toCompareProduct(b);
    if (!cB.firstImage) continue;
    for (const pA of aSameBrand) {
      const cA = toCompareProduct(pA);
      if (!cA.firstImage) continue;
      if (cA.firstImage.trim() === cB.firstImage.trim()) continue;
      phashUrls.add(cA.firstImage.trim());
      phashUrls.add(cB.firstImage.trim());
    }
  }
  const cache: PhashCache = new Map();
  await prefetchPhashes(phashUrls, cache);
  const photoPhashSkipped = phashUrls.size > 0 && cache.size === 0;

  /** Артикулы вариаций B по EAN — чтобы в выгрузке указать «вариация ABC дублирует EAN на A». */
  function variantArticleByEan(b: FpProduct, ean: string): string | undefined {
    const variants = b.feedVariants ?? [];
    const digits = ean.replace(/\D/g, "").replace(/^0+/, "") || "0";
    for (const v of variants) {
      const e = (v.ean ?? "").replace(/\D/g, "").replace(/^0+/, "") || "0";
      if (e === digits && v.article) return v.article;
    }
    return undefined;
  }

  const classifications: NoveltyClassification[] = [];
  let dupPairsCount = 0;
  let duplicates = 0;
  let cleanCnt = 0;
  let unverifiable = 0;

  for (const b of noveltiesB) {
    const cB = toCompareProduct(b);
    const eanKeysB = collectEanIndexKeys(b);
    const hasEan = eanKeysB.length > 0;
    const hasImage = Boolean(cB.firstImage);
    const dups: NoveltyDupMatch[] = [];
    const seenAids = new Set<number>();

    // 1) EAN
    for (const k of eanKeysB) {
      const arr = eanIndexA.get(k);
      if (!arr) continue;
      for (const pA of arr) {
        if (seenAids.has(pA.id)) continue;
        seenAids.add(pA.id);
        const cA = toCompareProduct(pA);
        dups.push({
          kind: "ean",
          ean: k,
          reasons: [`дубль по EAN ${k}`],
          productOnA: cA,
          productOnAId: pA.id,
          variantArticleOnB: variantArticleByEan(b, k)
        });
      }
    }

    // 2) Бренд + модель + фото — только если по EAN ничего не нашли
    if (dups.length === 0) {
      const sameBrand = aByBrand.get(
        normBrand(productBrandName(b)) || "__empty_brand__"
      );
      if (sameBrand) {
        for (const pA of sameBrand) {
          if (pA.id === b.id) continue;
          const cA = toCompareProduct(pA);
          const res = resolveNameTabPair(
            cB,
            cA,
            nameLocale,
            cache,
            photoPhashSkipped
          );
          if ("reject" in res) continue;
          if (seenAids.has(pA.id)) continue;
          seenAids.add(pA.id);
          dups.push({
            kind: "name_photo",
            reasons: res.reasons,
            productOnA: cA,
            productOnAId: pA.id
          });
        }
      }
    }

    if (dups.length > 0) {
      classifications.push({ novelty: b, status: "duplicate", dups });
      duplicates++;
      dupPairsCount += dups.length;
    } else if (!hasEan && !hasImage) {
      classifications.push({
        novelty: b,
        status: "unverifiable",
        reason: "no_ean_no_image"
      });
      unverifiable++;
    } else {
      /** Для чистых — собираем top-K кандидатов с A того же бренда для последующей AI-проверки. */
      const sameBrand = aByBrand.get(
        normBrand(productBrandName(b)) || "__empty_brand__"
      );
      const tokB = titleTokens(cB.nameRu + " " + cB.nameEn + " " + (b.name || ""));
      const candidates: NoveltyAiCandidate[] = [];
      if (sameBrand && sameBrand.length > 0) {
        const scored: { p: FpProduct; score: number }[] = [];
        for (const pA of sameBrand) {
          if (pA.id === b.id) continue;
          const cA = toCompareProduct(pA);
          const tokA = titleTokens(
            cA.nameRu + " " + cA.nameEn + " " + (pA.name || "")
          );
          const sc = tokenJaccard(tokA, tokB);
          if (sc > 0) scored.push({ p: pA, score: sc });
        }
        scored.sort((x, y) => y.score - x.score);
        for (const { p: pA, score } of scored.slice(
          0,
          MAX_AI_CANDIDATES_PER_NOVELTY
        )) {
          const cA = toCompareProduct(pA);
          candidates.push({
            productOnA: cA,
            productOnAId: pA.id,
            textScore: score
          });
        }
      }
      classifications.push({
        novelty: b,
        status: "clean",
        hasEan,
        hasImage,
        aiCandidates: candidates
      });
      cleanCnt++;
    }
  }

  return {
    classifications,
    summary: {
      totalNovelties: noveltiesB.length,
      duplicates,
      clean: cleanCnt,
      unverifiable,
      dupPairsCount
    }
  };
}
