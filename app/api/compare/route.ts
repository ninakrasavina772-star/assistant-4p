import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { filterFpProductsByBrands, mergeBrandLists, type BrandMatchMode } from "@/lib/brand-filter";
import { parseExcludeIdsFromRequest } from "@/lib/excludeProductIds";
import {
  applyRubricFetchPipeline,
  fetchAllProductsInRubric,
  fetchMergedRubricsProductIds,
  fetchMergedRubricsProducts,
  fetchNoveltyIdsSlicePage,
  fetchProductsByIds,
  type RubricFetchPipeline
} from "@/lib/fourpartners";
import { findIntraSiteDuplicates } from "@/lib/intraSiteDups";
import { filterFpProductsByModels, mergeModelLists, type ModelMatchMode } from "@/lib/model-filter";
import { fetchPartnersFeedText } from "@/lib/partnersFeedFetch";
import { MAX_RUBRICS_B } from "@/lib/rubricIds";
import { parsePartnersFeedCsv } from "@/lib/partnersFeedCsv";
import { runCompare } from "@/lib/match";
import { collectEans } from "@/lib/product";
import type {
  AttrMatchOptions,
  CompareBrandFilterInfo,
  CompareExcludeIdsAInfo,
  CompareModelFilterInfo,
  CompareResult,
  FpProduct,
  NameLocale,
  NoveltiesFullExportResult,
  NoveltyIdsNoEanOnAResult,
  NoveltyIdsSliceResult,
  NoveltyIdsStageResult,
  SingleSiteDupsResult,
  UnlikelySearchInfo
} from "@/lib/types";

export const maxDuration = 300;

const MIN_TOKEN_LEN = 12;
const MAX_NOVELTY_IDS = 50_000;

function devSkipAuth(): boolean {
  return process.env.NODE_ENV === "development" && process.env.COMPARE_SKIP_AUTH === "1";
}

function resolveToken(bodyToken: unknown, leg: "A" | "B"): string {
  const t = typeof bodyToken === "string" ? bodyToken.trim() : "";
  if (t.length >= MIN_TOKEN_LEN) return t;
  const envA = process.env.FOURPARTNERS_TOKEN_A?.trim() ?? "";
  const envB = process.env.FOURPARTNERS_TOKEN_B?.trim() ?? "";
  const envShared = process.env.FOURPARTNERS_TOKEN?.trim() ?? "";
  if (leg === "A")
    return (envA.length >= MIN_TOKEN_LEN ? envA : "") || (envShared.length >= MIN_TOKEN_LEN ? envShared : "");
  return (envB.length >= MIN_TOKEN_LEN ? envB : "") || (envShared.length >= MIN_TOKEN_LEN ? envShared : "");
}

function parseStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const x of raw) {
    if (typeof x !== "string") continue;
    const s = x.trim();
    if (s) out.push(s);
  }
  return out;
}

function parseRubricBIds(body: Record<string, unknown>): number[] {
  if (Array.isArray(body.rubricsB)) {
    const seen = new Set<number>();
    const out: number[] = [];
    for (const x of body.rubricsB) {
      const n = typeof x === "number" ? x : typeof x === "string" ? Number(x.trim()) : NaN;
      if (!Number.isFinite(n) || n < 1) continue;
      const id = Math.floor(n);
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
    return out;
  }
  if (body.rubricB !== undefined && body.rubricB !== null) {
    const n = Number(body.rubricB);
    if (Number.isFinite(n) && n >= 1) return [Math.floor(n)];
  }
  return [];
}

function rubricBCountError(ids: number[]): string | null {
  if (ids.length > MAX_RUBRICS_B) {
    return `Для сайта B не более ${MAX_RUBRICS_B} рубрик (поле rubricsB).`;
  }
  return null;
}

function parseNoveltyIdsFromBody(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<number>();
  const out: number[] = [];
  for (const x of raw) {
    const n = typeof x === "number" ? x : typeof x === "string" ? Number(String(x).trim()) : NaN;
    if (!Number.isFinite(n) || n < 1) continue;
    const id = Math.floor(n);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= MAX_NOVELTY_IDS) break;
  }
  return out;
}

function parseNameLocale(raw: unknown): NameLocale {
  return raw === "en" ? "en" : "ru";
}

function parseAttrMatch(raw: unknown): AttrMatchOptions | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const volume = Boolean(o.volume),
    shade = Boolean(o.shade),
    color = Boolean(o.color);
  if (!volume && !shade && !color) return undefined;
  return { volume, shade, color };
}

function buildUnlikelySearch(attr?: AttrMatchOptions): UnlikelySearchInfo {
  return {
    attempted: true,
    volume: Boolean(attr?.volume),
    shade: Boolean(attr?.shade),
    color: Boolean(attr?.color)
  };
}

function buildBrandFilterInfo(
  brands: string[],
  brandMatch: BrandMatchMode,
  excludedMissingA: number,
  excludedNotInListA: number,
  excludedMissingB: number,
  excludedNotInListB: number
): CompareBrandFilterInfo | undefined {
  if (!brands.length) return undefined;
  return {
    enabled: true,
    matchMode: brandMatch,
    brandsSample: brands.slice(0, 50),
    totalBrands: brands.length,
    excludedMissingBrandA: excludedMissingA,
    excludedMissingBrandB: excludedMissingB,
    excludedNotInListA: excludedNotInListA,
    excludedNotInListB: excludedNotInListB
  };
}

function buildModelFilterInfo(
  models: string[],
  modelMatch: ModelMatchMode,
  excludedNotInListA: number,
  excludedNotInListB: number
): CompareModelFilterInfo | undefined {
  if (!models.length) return undefined;
  return {
    enabled: true,
    matchMode: modelMatch,
    modelsSample: models.slice(0, 50),
    totalModels: models.length,
    excludedNotInListA,
    excludedNotInListB
  };
}

function buildExcludeIdsInfo(
  excludeRaw: number[],
  excludeMeta?: { removedFromA: number; listIdsNotFoundInRubric: number }
): CompareExcludeIdsAInfo | undefined {
  if (!excludeRaw.length) return undefined;
  return {
    enabled: true,
    listSize: excludeRaw.length,
    removedFromA: excludeMeta?.removedFromA ?? 0,
    listIdsNotFoundInRubric: excludeMeta?.listIdsNotFoundInRubric ?? 0
  };
}

function applyBrandModelOnly(
  products: FpProduct[],
  pipe: Pick<RubricFetchPipeline, "brands" | "brandMatch" | "models" | "modelMatch">
): FpProduct[] {
  let working = products;
  if (pipe.brands?.length) {
    working = filterFpProductsByBrands(working, pipe.brands, pipe.brandMatch ?? "exact").products;
  }
  if (pipe.models?.length) {
    working = filterFpProductsByModels(working, pipe.models, pipe.modelMatch ?? "exact").products;
  }
  return working;
}

type CompareBody = Record<string, unknown>;

const MAX_FEED_CSV_BODY_CHARS = 25 * 1024 * 1024;

async function resolveFeedCsvInput(label: string, urlRaw: unknown, textRaw: unknown): Promise<string> {
  const url = typeof urlRaw === "string" ? urlRaw.trim() : "";
  const text = typeof textRaw === "string" ? textRaw : "";
  if (url && text.trim()) {
    throw new Error(`${label}: укажите либо https-ссылку на фид, либо CSV из файла — не оба`);
  }
  if (url) return await fetchPartnersFeedText(url);
  const t = text.trim();
  if (!t) {
    throw new Error(`${label}: нужна ссылка вида https://….4partners.io/my/feed/….csv или загрузите файл`);
  }
  if (t.length > MAX_FEED_CSV_BODY_CHARS) {
    throw new Error(`${label}: CSV слишком большой`);
  }
  return t;
}

export async function POST(req: NextRequest) {
  if (!devSkipAuth()) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: "Нужен вход" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as CompareBody;
  const feedsMode = body.dataSource === "feeds";
  if (feedsMode && (body.comparePhase || body.wizardTask)) {
    return NextResponse.json(
      { error: "Режим CSV-фидов: этот запрос только для работы через API по ключам." },
      { status: 400 }
    );
  }

  const siteVariation =
    typeof body.siteVariation === "string" && body.siteVariation.trim() ? body.siteVariation.trim() : "default";
  const nameLocale = parseNameLocale(body.nameLocale);
  const attrMatch = parseAttrMatch(body.attrMatch);
  const brandsRaw = mergeBrandLists(parseStringArray(body.brands));
  const modelsRaw = mergeModelLists(parseStringArray(body.models));
  const brandMatch: BrandMatchMode = body.brandMatch === "contains" ? "contains" : "exact";
  const modelMatch: ModelMatchMode = body.modelMatch === "contains" ? "contains" : "exact";
  const excludeIdsRaw = parseExcludeIdsFromRequest(body.excludeIdsA);
  const excludeSet = excludeIdsRaw.length > 0 ? new Set(excludeIdsRaw) : undefined;

  const pipeShared: RubricFetchPipeline = {
    brands: brandsRaw.length ? brandsRaw : undefined,
    brandMatch,
    models: modelsRaw.length ? modelsRaw : undefined,
    modelMatch
  };
  const pipeA: RubricFetchPipeline = {
    ...pipeShared,
    excludeIds: excludeSet,
    excludeIdsRaw: excludeIdsRaw.length ? excludeIdsRaw : undefined
  };

  const siteALabel =
    typeof body.siteALabel === "string" && body.siteALabel.trim() ? body.siteALabel.trim() : "A";
  const siteBLabel =
    typeof body.siteBLabel === "string" && body.siteBLabel.trim() ? body.siteBLabel.trim() : "B";

  try {
    if (body.comparePhase === "noveltyIdsSlice") {
      const tokenA = resolveToken(body.tokenA, "A"),
        tokenB = resolveToken(body.tokenB, "B");
      if (tokenA.length < MIN_TOKEN_LEN || tokenB.length < MIN_TOKEN_LEN) {
        return NextResponse.json({ error: "Нужны ключи API для сайтов A и B (или переменные окружения)" }, { status: 400 });
      }
      const sliceRaw = body.noveltyIdsSlice;
      if (!sliceRaw || typeof sliceRaw !== "object") {
        return NextResponse.json({ error: "Укажите noveltyIdsSlice" }, { status: 400 });
      }
      const sl = sliceRaw as Record<string, unknown>;
      const leg: "A" | "B" = sl.leg === "B" ? "B" : "A";
      const rubricId = Number(sl.rubricId),
        pageNum = Number(sl.page ?? 1);
      if (!Number.isFinite(rubricId) || rubricId < 1) {
        return NextResponse.json({ error: "noveltyIdsSlice.rubricId" }, { status: 400 });
      }
      const page = Number.isFinite(pageNum) && pageNum >= 1 ? Math.floor(pageNum) : 1;
      const token = leg === "A" ? tokenA : tokenB,
        pipe = leg === "A" ? pipeA : pipeShared;
      const slice = await fetchNoveltyIdsSlicePage(token, siteVariation, rubricId, page, pipe, leg);
      const payload: NoveltyIdsSliceResult = {
        resultKind: "noveltyIdsSlice",
        leg,
        rubricId,
        page: slice.page,
        ids: slice.ids,
        rawCatalogIdsBeforeExclude: slice.rawCatalogIdsBeforeExclude,
        hasMore: slice.hasMore,
        perPage: slice.perPage,
        statsSlice: {
          brandExcludedMissing: slice.brandExcludedMissing,
          brandExcludedNotInList: slice.brandExcludedNotInList,
          modelExcludedNotInList: slice.modelExcludedNotInList,
          excludeRemovedFromA: slice.excludeRemovedFromA
        }
      };
      return NextResponse.json(payload);
    }

    if (body.wizardTask === "noveltiesFullExport") {
      const tokenB = resolveToken(body.tokenB, "B");
      if (tokenB.length < MIN_TOKEN_LEN) {
        return NextResponse.json({ error: "Нужен ключ API для сайта B" }, { status: 400 });
      }
      const rubricA = Number(body.rubricA);
      if (!Number.isFinite(rubricA) || rubricA < 1) {
        return NextResponse.json({ error: "Некорректная rubricA" }, { status: 400 });
      }
      const noveltyIds = parseNoveltyIdsFromBody(body.noveltyIdsB);
      if (!noveltyIds.length) return NextResponse.json({ error: "Пустой noveltyIdsB" }, { status: 400 });
      void rubricA;
      let products = await fetchProductsByIds(tokenB, siteVariation, noveltyIds);
      products = applyBrandModelOnly(products, pipeShared);
      return NextResponse.json({
        resultKind: "noveltiesFullExport",
        products,
        siteBLabel,
        nameLocale
      } satisfies NoveltiesFullExportResult);
    }

    if (body.wizardTask === "noveltyIdsNoEanOnA") {
      const tokenA = resolveToken(body.tokenA, "A"),
        tokenB = resolveToken(body.tokenB, "B");
      if (tokenA.length < MIN_TOKEN_LEN || tokenB.length < MIN_TOKEN_LEN) {
        return NextResponse.json({ error: "Нужны ключи API для сайтов A и B" }, { status: 400 });
      }
      const rubricA = Number(body.rubricA);
      if (!Number.isFinite(rubricA) || rubricA < 1) {
        return NextResponse.json({ error: "Некорректная rubricA" }, { status: 400 });
      }
      const noveltyIds = parseNoveltyIdsFromBody(body.noveltyIdsB);
      if (!noveltyIds.length) return NextResponse.json({ error: "Пустой noveltyIdsB" }, { status: 400 });

      const mergedA = await fetchMergedRubricsProducts(tokenA, siteVariation, [rubricA], pipeA);
      const eanOnA = new Set<string>();
      for (const p of mergedA.products) {
        for (const e of collectEans(p)) {
          if (e) eanOnA.add(e);
        }
      }
      let loaded = await fetchProductsByIds(tokenB, siteVariation, noveltyIds);
      loaded = applyBrandModelOnly(loaded, pipeShared);
      const idsOut: number[] = [];
      let removedForEanMatchOnA = 0;
      for (const p of loaded) {
        const eans = collectEans(p);
        if (eans.some((e) => e && eanOnA.has(e))) {
          removedForEanMatchOnA++;
          continue;
        }
        idsOut.push(p.id);
      }
      return NextResponse.json({
        resultKind: "noveltyIdsNoEanOnA",
        ids: idsOut,
        stats: {
          noveltyLoadedCount: loaded.length,
          removedForEanMatchOnA,
          remainingCount: idsOut.length
        },
        siteALabel,
        siteBLabel
      } satisfies NoveltyIdsNoEanOnAResult);
    }

    if (body.comparePhase === "noveltyIds") {
      const tokenA = resolveToken(body.tokenA, "A"),
        tokenB = resolveToken(body.tokenB, "B");
      if (tokenA.length < MIN_TOKEN_LEN || tokenB.length < MIN_TOKEN_LEN) {
        return NextResponse.json({ error: "Нужны ключи API для сайтов A и B" }, { status: 400 });
      }
      const rubricA = Number(body.rubricA);
      if (!Number.isFinite(rubricA) || rubricA < 1) {
        return NextResponse.json({ error: "Некорректная rubricA" }, { status: 400 });
      }
      const rubricBIds = parseRubricBIds(body);
      if (!rubricBIds.length) return NextResponse.json({ error: "Укажите rubricsB" }, { status: 400 });
      const rubricBErr = rubricBCountError(rubricBIds);
      if (rubricBErr) return NextResponse.json({ error: rubricBErr }, { status: 400 });

      const [resA, resB] = await Promise.all([
        fetchMergedRubricsProductIds(tokenA, siteVariation, [rubricA], pipeA, "A"),
        fetchMergedRubricsProductIds(tokenB, siteVariation, rubricBIds, pipeShared, "B")
      ]);

      const setA = new Set(resA.ids);
      const noveltyIds = resB.ids.filter((id) => !setA.has(id));
      const idsOnBothSites = resB.ids.filter((id) => setA.has(id)).length;

      const stage: NoveltyIdsStageResult = {
        resultKind: "noveltyIdsStage",
        siteALabel,
        siteBLabel,
        noveltyIds,
        stats: {
          countIdsRubricA: resA.ids.length,
          countIdsRubricB: resB.ids.length,
          idsOnBothSites,
          noveltyCount: noveltyIds.length
        },
        brandFilter: buildBrandFilterInfo(
          brandsRaw,
          brandMatch,
          resA.brandExcludedMissing,
          resA.brandExcludedNotInList,
          resB.brandExcludedMissing,
          resB.brandExcludedNotInList
        ),
        modelFilter: buildModelFilterInfo(
          modelsRaw,
          modelMatch,
          resA.modelExcludedNotInList,
          resB.modelExcludedNotInList
        ),
        excludeIdsA: buildExcludeIdsInfo(excludeIdsRaw, resA.excludeMeta)
      };
      return NextResponse.json(stage);
    }

    const singleDupsMode = body.mode === "singleDups" || body.mode === "singleSiteDups";

    if (feedsMode) {
      if (singleDupsMode) {
        const csv = await resolveFeedCsvInput("Фид (одна витрина)", body.feedUrlA, body.feedCsvTextA);
        const raw = await parsePartnersFeedCsv(csv);
        const idsSeen = new Set(raw.map((p) => p.id));
        let nf = 0;
        for (const id of excludeIdsRaw) {
          if (!idsSeen.has(id)) nf++;
        }
        const applied = applyRubricFetchPipeline(raw, pipeA, "A");
        const excludeMeta =
          excludeIdsRaw.length > 0
            ? { removedFromA: applied.excludeRemovedFromA, listIdsNotFoundInRubric: nf }
            : undefined;
        const mergedProducts = applied.out;
        const dups = await findIntraSiteDuplicates(mergedProducts, nameLocale, attrMatch);
        const single: SingleSiteDupsResult = {
          resultKind: "singleSiteDups",
          siteLabel: siteALabel,
          nameLocale,
          rubricId: 0,
          stats: { count: mergedProducts.length },
          brandFilter: buildBrandFilterInfo(
            brandsRaw,
            brandMatch,
            applied.brandExcludedMissing,
            applied.brandExcludedNotInList,
            0,
            0
          ),
          modelFilter: buildModelFilterInfo(modelsRaw, modelMatch, applied.modelExcludedNotInList, 0),
          excludeIdsA: buildExcludeIdsInfo(excludeIdsRaw, excludeMeta),
          eanGroups: dups.eanGroups,
          namePhotoPairs: dups.namePhotoPairs,
          brandVisualPairs: dups.brandVisualPairs,
          unlikelyPairs: dups.unlikelyPairs,
          unlikelySearch: buildUnlikelySearch(attrMatch)
        };
        return NextResponse.json(single);
      }

      const csvA = await resolveFeedCsvInput("Сайт A", body.feedUrlA, body.feedCsvTextA);
      const csvB = await resolveFeedCsvInput("Сайт B", body.feedUrlB, body.feedCsvTextB);
      const rawA = await parsePartnersFeedCsv(csvA);
      const rawB = await parsePartnersFeedCsv(csvB);
      const idsSeenA = new Set(rawA.map((p) => p.id));
      let nfA = 0;
      for (const id of excludeIdsRaw) {
        if (!idsSeenA.has(id)) nfA++;
      }
      const appliedA = applyRubricFetchPipeline(rawA, pipeA, "A");
      const excludeMetaA =
        excludeIdsRaw.length > 0
          ? { removedFromA: appliedA.excludeRemovedFromA, listIdsNotFoundInRubric: nfA }
          : undefined;
      const productsA = appliedA.out;
      const appliedB = applyRubricFetchPipeline(rawB, pipeShared, "B");
      const productsB = appliedB.out;
      const cmp = await runCompare(productsA, productsB, nameLocale, siteALabel, siteBLabel, attrMatch);
      const brandFilter = buildBrandFilterInfo(
        brandsRaw,
        brandMatch,
        appliedA.brandExcludedMissing,
        appliedA.brandExcludedNotInList,
        appliedB.brandExcludedMissing,
        appliedB.brandExcludedNotInList
      );
      const modelFilter = buildModelFilterInfo(
        modelsRaw,
        modelMatch,
        appliedA.modelExcludedNotInList,
        appliedB.modelExcludedNotInList
      );
      const result: CompareResult = {
        ...cmp,
        brandFilter,
        modelFilter,
        excludeIdsA: buildExcludeIdsInfo(excludeIdsRaw, excludeMetaA),
        unlikelySearch: buildUnlikelySearch(attrMatch),
        catalogFromFeeds: true
      };
      return NextResponse.json(result);
    }

    if (singleDupsMode) {
      const token = resolveToken(body.tokenA, "A") || resolveToken(body.tokenB, "B");
      if (token.length < MIN_TOKEN_LEN) return NextResponse.json({ error: "Нужен ключ API" }, { status: 400 });
      const rubricA = Number(body.rubricA);
      if (!Number.isFinite(rubricA) || rubricA < 1) {
        return NextResponse.json({ error: "Некорректная rubricA" }, { status: 400 });
      }
      const merged = await fetchAllProductsInRubric(token, siteVariation, rubricA, pipeA);
      const dups = await findIntraSiteDuplicates(merged.products, nameLocale, attrMatch);
      const single: SingleSiteDupsResult = {
        resultKind: "singleSiteDups",
        siteLabel: siteALabel,
        nameLocale,
        rubricId: rubricA,
        stats: { count: merged.products.length },
        brandFilter: buildBrandFilterInfo(
          brandsRaw,
          brandMatch,
          merged.brandExcludedMissing,
          merged.brandExcludedNotInList,
          0,
          0
        ),
        modelFilter: buildModelFilterInfo(modelsRaw, modelMatch, merged.modelExcludedNotInList, 0),
        excludeIdsA: buildExcludeIdsInfo(excludeIdsRaw, merged.excludeMeta),
        eanGroups: dups.eanGroups,
        namePhotoPairs: dups.namePhotoPairs,
        brandVisualPairs: dups.brandVisualPairs,
        unlikelyPairs: dups.unlikelyPairs,
        unlikelySearch: buildUnlikelySearch(attrMatch)
      };
      return NextResponse.json(single);
    }

    const tokenA = resolveToken(body.tokenA, "A"),
      tokenB = resolveToken(body.tokenB, "B");
    if (tokenA.length < MIN_TOKEN_LEN || tokenB.length < MIN_TOKEN_LEN) {
      return NextResponse.json({ error: "Нужны ключи API для сайтов A и B" }, { status: 400 });
    }
    const rubricA = Number(body.rubricA);
    if (!Number.isFinite(rubricA) || rubricA < 1) {
      return NextResponse.json({ error: "Некорректная rubricA" }, { status: 400 });
    }

    const siteBFetchMode = body.siteBFetchMode;
    const noveltyIdsB = parseNoveltyIdsFromBody(body.noveltyIdsB);
    let productsB: FpProduct[];
    let mergedBForMeta: Awaited<ReturnType<typeof fetchMergedRubricsProducts>> | null = null;

    if (siteBFetchMode === "noveltyIds") {
      if (!noveltyIdsB.length) {
        return NextResponse.json({ error: "Пустой noveltyIdsB" }, { status: 400 });
      }
      productsB = applyBrandModelOnly(await fetchProductsByIds(tokenB, siteVariation, noveltyIdsB), pipeShared);
    } else {
      const rubricBIds = parseRubricBIds(body);
      if (!rubricBIds.length) return NextResponse.json({ error: "Укажите rubricsB" }, { status: 400 });
      const rubricBErrMain = rubricBCountError(rubricBIds);
      if (rubricBErrMain) return NextResponse.json({ error: rubricBErrMain }, { status: 400 });
      mergedBForMeta = await fetchMergedRubricsProducts(tokenB, siteVariation, rubricBIds, pipeShared);
      productsB = mergedBForMeta.products;
    }

    const mergedA = await fetchMergedRubricsProducts(tokenA, siteVariation, [rubricA], pipeA);
    const cmp = await runCompare(mergedA.products, productsB, nameLocale, siteALabel, siteBLabel, attrMatch);

    let brandFilter: CompareBrandFilterInfo | undefined;
    let modelFilter: CompareModelFilterInfo | undefined;
    if (siteBFetchMode === "noveltyIds") {
      brandFilter = buildBrandFilterInfo(
        brandsRaw,
        brandMatch,
        mergedA.brandExcludedMissing,
        mergedA.brandExcludedNotInList,
        0,
        0
      );
      modelFilter = buildModelFilterInfo(modelsRaw, modelMatch, mergedA.modelExcludedNotInList, 0);
    } else if (mergedBForMeta) {
      brandFilter = buildBrandFilterInfo(
        brandsRaw,
        brandMatch,
        mergedA.brandExcludedMissing,
        mergedA.brandExcludedNotInList,
        mergedBForMeta.brandExcludedMissing,
        mergedBForMeta.brandExcludedNotInList
      );
      modelFilter = buildModelFilterInfo(
        modelsRaw,
        modelMatch,
        mergedA.modelExcludedNotInList,
        mergedBForMeta.modelExcludedNotInList
      );
    }

    const result: CompareResult = {
      ...cmp,
      brandFilter,
      modelFilter,
      excludeIdsA: buildExcludeIdsInfo(excludeIdsRaw, mergedA.excludeMeta),
      unlikelySearch: buildUnlikelySearch(attrMatch),
      siteBFetchedByNoveltyIds: siteBFetchMode === "noveltyIds" ? true : undefined
    };
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Ошибка сравнения";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
