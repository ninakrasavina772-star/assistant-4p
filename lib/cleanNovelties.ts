import { normalizeBrandName, productBrandName } from "./brand-filter";
import {
  NAME_TAB_MODEL_MIN as _DEPRECATED_NAME_TAB_MODEL_MIN,
  resolveNameTabPair
} from "./dupTiers";
import {
  buildAiCandidatesForClean,
  type NoveltyAiCandidate
} from "./cleanNoveltiesAi";
import { prefetchPhashes, type PhashCache } from "./imagePhash";
import { normBrand } from "./pairScoring";
import { collectEanIndexKeys, toCompareProduct } from "./product";

export type { NoveltyAiCandidate } from "./cleanNoveltiesAi";
export { buildAiCandidatesAmongNovelties } from "./cleanNoveltiesAi";
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
function brandBucketKey(p: FpProduct): string {
  return normalizeBrandName(productBrandName(p)) || "__empty_brand__";
}

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
 * Пара внутренних дублей среди новинок B (один товар под разными id).
 * `aId < bId` по соглашению.
 */
export type InternalNoveltyDupPair = {
  kind: "ean" | "name_photo";
  ean?: string;
  reasons: string[];
  a: CompareProduct;
  b: CompareProduct;
  aId: number;
  bId: number;
};

/**
 * Ищет дубли **внутри** списка новинок B (один и тот же товар под разными id).
 *
 * Логика:
 * - EAN: одинаковый штрихкод у двух новинок → пара kind="ean".
 * - Название/фото: тот же нормализованный бренд + порог сходства из dupTiers
 *   (используем `resolveNameTabPair`). Запускается только для пар, не попавших
 *   в EAN-дубли (чтобы не дублировать одну пару с разными kind).
 *
 * Кэш phash переиспользуется из основной проверки (B vs A), а недостающие
 * URL внутри B дополнительно прогреваются.
 */
export async function findInternalNoveltyDuplicates(
  noveltiesB: FpProduct[],
  nameLocale: NameLocale,
  cache: PhashCache = new Map()
): Promise<InternalNoveltyDupPair[]> {
  if (noveltiesB.length < 2) return [];

  /** id → FpProduct для быстрого доступа */
  const byId = new Map<number, FpProduct>();
  for (const p of noveltiesB) byId.set(p.id, p);

  /** EAN индекс среди новинок */
  const eanIndex = new Map<string, number[]>();
  for (const p of noveltiesB) {
    for (const k of collectEanIndexKeys(p)) {
      const arr = eanIndex.get(k) ?? [];
      arr.push(p.id);
      eanIndex.set(k, arr);
    }
  }

  const pairs: InternalNoveltyDupPair[] = [];
  const seenKeys = new Set<string>();
  const pairKey = (x: number, y: number) =>
    x < y ? `${x}-${y}` : `${y}-${x}`;

  /** 1) EAN-группы */
  for (const [ean, ids] of eanIndex) {
    if (ids.length < 2) continue;
    /** уникальные id */
    const uniq = [...new Set(ids)].sort((a, b) => a - b);
    for (let i = 0; i < uniq.length; i++) {
      for (let j = i + 1; j < uniq.length; j++) {
        const aId = uniq[i]!;
        const bId = uniq[j]!;
        const k = pairKey(aId, bId);
        if (seenKeys.has(k)) continue;
        seenKeys.add(k);
        const a = byId.get(aId)!;
        const b = byId.get(bId)!;
        pairs.push({
          kind: "ean",
          ean,
          reasons: [`общий EAN ${ean}`],
          a: toCompareProduct(a),
          b: toCompareProduct(b),
          aId,
          bId
        });
      }
    }
  }

  /** 2) Название + фото — только для пар, у которых ещё нет EAN-совпадения. */
  const byBrand = new Map<string, FpProduct[]>();
  for (const p of noveltiesB) {
    const k = normBrand(productBrandName(p)) || "__empty_brand__";
    const arr = byBrand.get(k) ?? [];
    arr.push(p);
    byBrand.set(k, arr);
  }
  /** Прогреем phash для тех URL, что ещё не в кэше — берём все фото каждой карточки. */
  const urls = new Set<string>();
  for (const list of byBrand.values()) {
    if (list.length < 2) continue;
    for (const p of list) {
      const cp = toCompareProduct(p);
      const imgs = cp.allImages ?? (cp.firstImage ? [cp.firstImage] : []);
      for (const u of imgs) urls.add(u.trim());
    }
  }
  await prefetchPhashes(urls, cache);
  const photoPhashSkipped = urls.size > 0 && cache.size === 0;

  for (const [_brand, list] of byBrand) {
    void _brand;
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => a.id - b.id);
    for (let i = 0; i < sorted.length; i++) {
      const pa = sorted[i]!;
      const ca = toCompareProduct(pa);
      for (let j = i + 1; j < sorted.length; j++) {
        const pb = sorted[j]!;
        const k = pairKey(pa.id, pb.id);
        if (seenKeys.has(k)) continue;
        const cb = toCompareProduct(pb);
        const res = resolveNameTabPair(ca, cb, nameLocale, cache, photoPhashSkipped);
        if ("reject" in res) continue;
        seenKeys.add(k);
        pairs.push({
          kind: "name_photo",
          reasons: res.reasons,
          a: ca,
          b: cb,
          aId: pa.id,
          bId: pb.id
        });
      }
    }
  }

  return pairs;
}

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
    const k = brandBucketKey(pA);
    const arr = aByBrand.get(k) ?? [];
    arr.push(pA);
    aByBrand.set(k, arr);
  }

  const bByBrand = new Map<string, FpProduct[]>();
  for (const pB of noveltiesB) {
    const k = brandBucketKey(pB);
    const arr = bByBrand.get(k) ?? [];
    arr.push(pB);
    bByBrand.set(k, arr);
  }

  /** Собираем URL для phash-предзагрузки — только пары, у которых первое фото отличается. */
  const candidatePairs: { b: FpProduct; aSameBrand: FpProduct[] }[] = [];
  for (const b of noveltiesB) {
    const k = brandBucketKey(b);
    const aSameBrand = aByBrand.get(k) ?? [];
    candidatePairs.push({ b, aSameBrand });
  }
  /**
   * Грузим **все** фото обеих карточек (а не только первые): это нужно, чтобы
   * матчить пары «открытая тушь vs тушь в коробке», когда первое фото отличается.
   */
  const phashUrls = new Set<string>();
  for (const { b, aSameBrand } of candidatePairs) {
    const cB = toCompareProduct(b);
    const imgsB = cB.allImages ?? (cB.firstImage ? [cB.firstImage] : []);
    if (imgsB.length === 0) continue;
    for (const pA of aSameBrand) {
      const cA = toCompareProduct(pA);
      const imgsA = cA.allImages ?? (cA.firstImage ? [cA.firstImage] : []);
      if (imgsA.length === 0) continue;
      for (const u of imgsA) phashUrls.add(u.trim());
      for (const u of imgsB) phashUrls.add(u.trim());
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
      const sameBrand = aByBrand.get(brandBucketKey(b));
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
      const candidates = buildAiCandidatesForClean(
        b,
        cB,
        aByBrand,
        productsA,
        bByBrand,
        noveltiesB,
        nameLocale
      );
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
