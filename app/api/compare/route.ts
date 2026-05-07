import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { filterFpProductsByBrands, type BrandMatchMode, mergeBrandLists } from "@/lib/brand-filter";
import {
  filterFpProductsByModels,
  mergeModelLists,
  type ModelMatchMode
} from "@/lib/model-filter";
import {
  fetchAllProductsInRubric,
  fetchMergedRubricsProducts,
  fetchMergedRubricsProductIds,
  fetchProductsByIds,
  type RubricFetchPipeline
} from "@/lib/fourpartners";
import { findIntraSiteDuplicates } from "@/lib/intraSiteDups";
import { runCompare } from "@/lib/match";
import { collectEans } from "@/lib/product";
import { parseExcludeIdsFromRequest } from "@/lib/excludeProductIds";
import type {
  AttrMatchOptions,
  CompareBrandFilterInfo,
  CompareExcludeIdsAInfo,
  CompareModelFilterInfo,
  NameLocale
} from "@/lib/types";

/**
 * Долгая выгрузка рубрики. Реальный лимит смотрите в плане Vercel:
 * Hobby — до 60 с (или до 300 с с Fluid compute); Pro — до 300–800 с.
 * @see https://vercel.com/docs/functions/configuring-functions/duration
 */
export const maxDuration = 300;

const MAX_NOVELTY_IDS_BODY = 25_000;

function parseNoveltyIdsFromBody(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const out: number[] = [];
  const seen = new Set<number>();
  for (const x of raw) {
    const n =
      typeof x === "number"
        ? x
        : typeof x === "string"
          ? Number(String(x).trim())
          : NaN;
    if (!Number.isFinite(n) || n < 1) continue;
    const id = Math.floor(n);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function parseAttrMatch(body: {
  attrMatch?: { volume?: boolean; shade?: boolean; color?: boolean };
}): AttrMatchOptions | undefined {
  const m = body.attrMatch;
  if (!m || typeof m !== "object") return undefined;
  const volume = m.volume === true;
  const shade = m.shade === true;
  const color = m.color === true;
  if (!volume && !shade && !color) return undefined;
  return { volume, shade, color };
}

function devSkipAuth(): boolean {
  return (
    process.env.NODE_ENV === "development" &&
    process.env.COMPARE_SKIP_AUTH === "1"
  );
}

export async function POST(req: NextRequest) {
  if (!devSkipAuth()) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Нужен вход" }, { status: 401 });
    }
  }

  const body = (await req.json().catch(() => ({}))) as {
    rubricA?: number;
    rubricB?: number;
    /** Несколько рубрик сайта B — выгрузки объединяются по уникальному id товара */
    rubricsB?: unknown;
    nameLocale?: string;
    siteVariation?: string;
    /** Ключи из интерфейса (приоритет над .env, если непустые) */
    tokenA?: string;
    tokenB?: string;
    siteALabel?: string;
    siteBLabel?: string;
    /** Имена брендов (как в API), пустой массив = без фильтра */
    brands?: unknown;
    /** twoSite — два каталога; singleDups — дубли в одной рубрике */
    mode?: string;
    /** exact — brand.name = строке; contains — подстрока (ручной ввод короче полного названия) */
    brandMatch?: string;
    /** Усилить пары «название+фото»: сравнить объём/оттенок/цвет, если пришли в товаре */
    attrMatch?: { volume?: boolean; shade?: boolean; color?: boolean };
    /** Строки «модели» — оставляем товары, в названии которых есть совпадение */
    models?: unknown;
    /** exact — вся «модельная» часть/название как строка; contains — вхождение */
    modelMatch?: string;
    /** id товаров, которые убрать из каталога A после загрузки рубрики */
    excludeIdsA?: unknown;
    /** Этап 1: только множества id по рубрикам A и B */
    comparePhase?: string;
    /** Этап 2: подгрузить B через GET /product/info по списку id вместо рубрик */
    siteBFetchMode?: string;
    noveltyIdsB?: unknown;
    /** Упрощённый мастер: полная выгрузка новинок по id или список id без пересечения EAN с A */
    wizardTask?: string;
  };

  const mode =
    body.mode === "singleDups" || body.mode === "singleSiteDups"
      ? "singleDups"
      : "twoSite";

  const nameLocale: NameLocale = body.nameLocale === "ru" ? "ru" : "en";
  const siteVar =
    typeof body.siteVariation === "string" && body.siteVariation.trim()
      ? body.siteVariation.trim()
      : "default";

  const brandMatch: BrandMatchMode =
    body.brandMatch === "contains" ? "contains" : "exact";

  const fromUi = (s: unknown) =>
    typeof s === "string" && s.trim().length >= 12 ? s.trim() : "";

  const tokenA =
    fromUi(body.tokenA) ||
    process.env.FOURPARTNERS_TOKEN_A ||
    process.env.FOURPARTNERS_TOKEN ||
    "";
  const tokenB =
    fromUi(body.tokenB) ||
    process.env.FOURPARTNERS_TOKEN_B ||
    process.env.FOURPARTNERS_TOKEN ||
    "";

  const siteALabel =
    (typeof body.siteALabel === "string" && body.siteALabel.trim()
      ? body.siteALabel.trim()
      : null) ||
    process.env.SITE_A_LABEL ||
    "Сайт A";
  const siteBLabel =
    (typeof body.siteBLabel === "string" && body.siteBLabel.trim()
      ? body.siteBLabel.trim()
      : null) ||
    process.env.SITE_B_LABEL ||
    "Сайт B";

  let brands: string[] = [];
  if (Array.isArray(body.brands)) {
    const raw = body.brands.filter((x): x is string => typeof x === "string");
    brands = mergeBrandLists(raw);
  }

  let models: string[] = [];
  if (Array.isArray(body.models)) {
    const raw = body.models.filter((x): x is string => typeof x === "string");
    models = mergeModelLists(raw);
  }

  const modelMatch: ModelMatchMode =
    body.modelMatch === "exact" ? "exact" : "contains";

  const excludeIdsA = parseExcludeIdsFromRequest(body.excludeIdsA);

  const attrOpts = parseAttrMatch(body);

  function parseRubricBIds(payload: {
    rubricB?: number;
    rubricsB?: unknown;
  }): number[] {
    if (Array.isArray(payload.rubricsB)) {
      const seen = new Set<number>();
      const out: number[] = [];
      for (const x of payload.rubricsB) {
        const n =
          typeof x === "number"
            ? x
            : typeof x === "string"
              ? Number(String(x).trim())
              : NaN;
        if (!Number.isFinite(n) || n < 1) continue;
        const id = Math.floor(n);
        if (seen.has(id)) continue;
        seen.add(id);
        out.push(id);
      }
      if (out.length > 0) return out;
    }
    const single = Number(payload.rubricB);
    return single > 0 ? [single] : [];
  }

  if (mode === "singleDups") {
    const rubricA = Number(body.rubricA);
    if (!rubricA) {
      return NextResponse.json(
        { error: "Укажите id рубрики (поле «сайт A»)" },
        { status: 400 }
      );
    }
    if (!tokenA) {
      return NextResponse.json(
        {
          error:
            "Укажите ключ API (сайт A) или задайте FOURPARTNERS_TOKEN_A / FOURPARTNERS_TOKEN в .env"
        },
        { status: 400 }
      );
    }
    try {
      const fetchA = await fetchAllProductsInRubric(tokenA, siteVar, rubricA, {
        excludeIds:
          excludeIdsA.length > 0 ? new Set(excludeIdsA) : undefined,
        excludeIdsRaw: excludeIdsA.length > 0 ? excludeIdsA : undefined,
        brands: brands.length > 0 ? brands : undefined,
        brandMatch,
        models: models.length > 0 ? models : undefined,
        modelMatch
      });
      let products = fetchA.products;
      let excludeIdsAInfo: CompareExcludeIdsAInfo | undefined;
      if (fetchA.excludeMeta) {
        excludeIdsAInfo = {
          enabled: true,
          listSize: excludeIdsA.length,
          removedFromA: fetchA.excludeMeta.removedFromA,
          listIdsNotFoundInRubric: fetchA.excludeMeta.listIdsNotFoundInRubric
        };
        if (products.length === 0) {
          return NextResponse.json(
            {
              error:
                "После исключения по id в рубрике A не осталось товаров. Сократите список или проверьте рубрику."
            },
            { status: 400 }
          );
        }
      }
      let brandFilter: CompareBrandFilterInfo | undefined;
      if (brands.length > 0) {
        brandFilter = {
          enabled: true,
          matchMode: brandMatch,
          brandsSample: brands.slice(0, 50),
          totalBrands: brands.length,
          excludedMissingBrandA: fetchA.brandExcludedMissing,
          excludedNotInListA: fetchA.brandExcludedNotInList,
          excludedMissingBrandB: 0,
          excludedNotInListB: 0
        };
        if (products.length === 0) {
          return NextResponse.json(
            {
              error:
                "После фильтра по бренду не осталось товаров. Фильтр смотрит только поле бренда в API (brand.name), не название товара. Проверьте рубрику, написание бренда в выгрузке или включите «вхождение в название бренда»."
            },
            { status: 400 }
          );
        }
      }
      let modelFilter: CompareModelFilterInfo | undefined;
      if (models.length > 0) {
        modelFilter = {
          enabled: true,
          matchMode: modelMatch,
          modelsSample: models.slice(0, 50),
          totalModels: models.length,
          excludedNotInListA: fetchA.modelExcludedNotInList,
          excludedNotInListB: 0
        };
        if (products.length === 0) {
          return NextResponse.json(
            {
              error:
                "После фильтра по списку моделей не осталось товаров. Смягчите строки, включите «вхождение в название» или проверьте написание."
            },
            { status: 400 }
          );
        }
      }
      const dups = await findIntraSiteDuplicates(products, nameLocale, attrOpts);
      const usAttempted = true;
      return NextResponse.json({
        resultKind: "singleSiteDups" as const,
        siteLabel: siteALabel,
        nameLocale,
        rubricId: rubricA,
        stats: { count: products.length },
        brandFilter,
        modelFilter,
        excludeIdsA: excludeIdsAInfo,
        eanGroups: dups.eanGroups,
        namePhotoPairs: dups.namePhotoPairs,
        brandVisualPairs: dups.brandVisualPairs,
        unlikelyPairs: dups.unlikelyPairs,
        unlikelySearch: {
          attempted: usAttempted,
          volume: attrOpts?.volume === true,
          shade: attrOpts?.shade === true,
          color: attrOpts?.color === true
        }
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Ошибка загрузки";
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  const wizardTaskRaw =
    typeof body.wizardTask === "string" ? body.wizardTask.trim() : "";
  const noveltyIdsWizard = parseNoveltyIdsFromBody(body.noveltyIdsB);

  if (mode === "twoSite" && wizardTaskRaw === "noveltiesFullExport") {
    if (!tokenA || !tokenB) {
      return NextResponse.json(
        {
          error:
            "Укажите ключи API в форме (сайт A и B) или задайте FOURPARTNERS_TOKEN_A / FOURPARTNERS_TOKEN_B в .env"
        },
        { status: 400 }
      );
    }
    if (noveltyIdsWizard.length === 0) {
      return NextResponse.json(
        {
          error:
            "Сначала получите список id новинок (шаг 1) или передайте массив noveltyIdsB."
        },
        { status: 400 }
      );
    }
    if (noveltyIdsWizard.length > MAX_NOVELTY_IDS_BODY) {
      return NextResponse.json(
        {
          error: `Слишком много id (${noveltyIdsWizard.length}). Максимум ${MAX_NOVELTY_IDS_BODY} за один запрос.`
        },
        { status: 400 }
      );
    }
    try {
      let products = await fetchProductsByIds(tokenB, siteVar, noveltyIdsWizard);
      if (brands.length > 0) {
        const r = filterFpProductsByBrands(products, brands, brandMatch);
        products = r.products;
      }
      if (models.length > 0) {
        const r = filterFpProductsByModels(products, models, modelMatch);
        products = r.products;
      }
      if (products.length === 0) {
        return NextResponse.json(
          {
            error:
              "После запросов к API список новинок пуст (проверьте ключ B, фильтры брендов/моделей и id)."
          },
          { status: 400 }
        );
      }
      return NextResponse.json({
        resultKind: "noveltiesFullExport" as const,
        products,
        siteBLabel,
        nameLocale
      });
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : "Ошибка выгрузки новинок по id";
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  if (mode === "twoSite" && wizardTaskRaw === "noveltyIdsNoEanOnA") {
    const rubricAWizard = Number(body.rubricA);
    if (!rubricAWizard) {
      return NextResponse.json(
        { error: "Укажите id рубрики A для выгрузки штрихкодов опорного каталога." },
        { status: 400 }
      );
    }
    if (!tokenA || !tokenB) {
      return NextResponse.json(
        {
          error:
            "Укажите ключи API в форме (сайт A и B) или задайте токены в .env"
        },
        { status: 400 }
      );
    }
    if (noveltyIdsWizard.length === 0) {
      return NextResponse.json(
        {
          error:
            "Нужен список id новинок с сайта B (шаг 1 или noveltyIdsB)."
        },
        { status: 400 }
      );
    }
    if (noveltyIdsWizard.length > MAX_NOVELTY_IDS_BODY) {
      return NextResponse.json(
        {
          error: `Слишком много id (${noveltyIdsWizard.length}). Максимум ${MAX_NOVELTY_IDS_BODY}.`
        },
        { status: 400 }
      );
    }
    try {
      const pipeShared: RubricFetchPipeline = {
        brands: brands.length > 0 ? brands : undefined,
        brandMatch,
        models: models.length > 0 ? models : undefined,
        modelMatch
      };
      const pipeA: RubricFetchPipeline = {
        ...pipeShared,
        excludeIds:
          excludeIdsA.length > 0 ? new Set(excludeIdsA) : undefined,
        excludeIdsRaw: excludeIdsA.length > 0 ? excludeIdsA : undefined
      };
      const resA = await fetchAllProductsInRubric(
        tokenA,
        siteVar,
        rubricAWizard,
        pipeA
      );
      let catalogA = resA.products;
      if (catalogA.length === 0) {
        return NextResponse.json(
          {
            error:
              "Каталог A после выгрузки рубрики и фильтров пуст — не из чего собрать множество EAN."
          },
          { status: 400 }
        );
      }
      const eanOnA = new Set<string>();
      for (const p of catalogA) {
        for (const e of collectEans(p)) {
          if (e) eanOnA.add(e);
        }
      }
      let loadedB = await fetchProductsByIds(tokenB, siteVar, noveltyIdsWizard);
      if (brands.length > 0) {
        const r = filterFpProductsByBrands(loadedB, brands, brandMatch);
        loadedB = r.products;
      }
      if (models.length > 0) {
        const r = filterFpProductsByModels(loadedB, models, modelMatch);
        loadedB = r.products;
      }
      if (loadedB.length === 0) {
        return NextResponse.json(
          {
            error:
              "Не удалось загрузить ни одной карточки новинок по id (проверьте ключ B и фильтры)."
          },
          { status: 400 }
        );
      }
      let removedForEanMatchOnA = 0;
      const ids: number[] = [];
      for (const p of loadedB) {
        const eansB = collectEans(p);
        const anyOnA = eansB.some((e) => eanOnA.has(e));
        if (anyOnA) removedForEanMatchOnA += 1;
        else ids.push(p.id);
      }
      return NextResponse.json({
        resultKind: "noveltyIdsNoEanOnA" as const,
        ids,
        stats: {
          noveltyLoadedCount: loadedB.length,
          removedForEanMatchOnA,
          remainingCount: ids.length
        },
        siteALabel,
        siteBLabel
      });
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : "Ошибка отбора id без EAN на A";
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  const rubricA = Number(body.rubricA);
  const rubricBIds = parseRubricBIds(body);

  const comparePhase =
    body.comparePhase === "noveltyIds" ? "noveltyIds" : "full";
  const siteBFetchMode =
    body.siteBFetchMode === "noveltyIds" ? "noveltyIds" : "rubric";
  const noveltyIdsParsed = parseNoveltyIdsFromBody(body.noveltyIdsB);

  if (!tokenA || !tokenB) {
    return NextResponse.json(
      {
        error:
          "Укажите ключи API в форме (сайт A и B) или задайте FOURPARTNERS_TOKEN_A / FOURPARTNERS_TOKEN_B в .env"
      },
      { status: 400 }
    );
  }

  if (comparePhase === "noveltyIds") {
    if (!rubricA || rubricBIds.length === 0) {
      return NextResponse.json(
        {
          error:
            "Этап «только ID»: укажите рубрику A и хотя бы одну рубрику B (список id рубрик сайта B)."
        },
        { status: 400 }
      );
    }
    try {
      const pipeShared: RubricFetchPipeline = {
        brands: brands.length > 0 ? brands : undefined,
        brandMatch,
        models: models.length > 0 ? models : undefined,
        modelMatch
      };
      const pipeA: RubricFetchPipeline = {
        ...pipeShared,
        excludeIds:
          excludeIdsA.length > 0 ? new Set(excludeIdsA) : undefined,
        excludeIdsRaw: excludeIdsA.length > 0 ? excludeIdsA : undefined
      };
      const [idA, idB] = await Promise.all([
        fetchMergedRubricsProductIds(tokenA, siteVar, [rubricA], pipeA),
        fetchMergedRubricsProductIds(tokenB, siteVar, rubricBIds, pipeShared)
      ]);
      const setA = new Set(idA.ids);
      const noveltyIds = idB.ids.filter((id) => !setA.has(id));
      const idsOnBothSites = idB.ids.reduce(
        (acc, id) => acc + (setA.has(id) ? 1 : 0),
        0
      );

      let excludeIdsAInfo: CompareExcludeIdsAInfo | undefined;
      if (idA.excludeMeta && excludeIdsA.length > 0) {
        excludeIdsAInfo = {
          enabled: true,
          listSize: excludeIdsA.length,
          removedFromA: idA.excludeMeta.removedFromA,
          listIdsNotFoundInRubric: idA.excludeMeta.listIdsNotFoundInRubric
        };
      }

      let brandFilter: CompareBrandFilterInfo | undefined;
      if (brands.length > 0) {
        brandFilter = {
          enabled: true,
          matchMode: brandMatch,
          brandsSample: brands.slice(0, 50),
          totalBrands: brands.length,
          excludedMissingBrandA: idA.brandExcludedMissing,
          excludedMissingBrandB: idB.brandExcludedMissing,
          excludedNotInListA: idA.brandExcludedNotInList,
          excludedNotInListB: idB.brandExcludedNotInList
        };
      }

      let modelFilter: CompareModelFilterInfo | undefined;
      if (models.length > 0) {
        modelFilter = {
          enabled: true,
          matchMode: modelMatch,
          modelsSample: models.slice(0, 50),
          totalModels: models.length,
          excludedNotInListA: idA.modelExcludedNotInList,
          excludedNotInListB: idB.modelExcludedNotInList
        };
      }

      return NextResponse.json({
        resultKind: "noveltyIdsStage" as const,
        siteALabel,
        siteBLabel,
        noveltyIds,
        stats: {
          countIdsRubricA: idA.ids.length,
          countIdsRubricB: idB.ids.length,
          idsOnBothSites,
          noveltyCount: noveltyIds.length
        },
        brandFilter,
        modelFilter,
        excludeIdsA: excludeIdsAInfo
      });
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : "Ошибка выгрузки id по рубрикам";
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  if (!rubricA) {
    return NextResponse.json(
      { error: "Укажите id рубрики A" },
      { status: 400 }
    );
  }
  if (siteBFetchMode === "rubric" && rubricBIds.length === 0) {
    return NextResponse.json(
      {
        error:
          "Укажите хотя бы одну рубрику B (поле rubricB или массив rubricsB) или включите режим «только список новинок» для сайта B."
      },
      { status: 400 }
    );
  }
  if (siteBFetchMode === "noveltyIds") {
    if (noveltyIdsParsed.length === 0) {
      return NextResponse.json(
        {
          error:
            "Передайте список id новинок (поле noveltyIdsB) или сначала нажмите «Этап 1: только ID новинок»."
        },
        { status: 400 }
      );
    }
    if (noveltyIdsParsed.length > MAX_NOVELTY_IDS_BODY) {
      return NextResponse.json(
        {
          error: `Слишком много id новинок (${noveltyIdsParsed.length}). Максимум ${MAX_NOVELTY_IDS_BODY} за один запрос.`
        },
        { status: 400 }
      );
    }
  }

  try {
    const pipeShared = {
      brands: brands.length > 0 ? brands : undefined,
      brandMatch,
      models: models.length > 0 ? models : undefined,
      modelMatch
    };

    const resA = await fetchAllProductsInRubric(tokenA, siteVar, rubricA, {
      excludeIds:
        excludeIdsA.length > 0 ? new Set(excludeIdsA) : undefined,
      excludeIdsRaw: excludeIdsA.length > 0 ? excludeIdsA : undefined,
      ...pipeShared
    });

    let b;
    let brandExcludedMissingB = 0;
    let brandExcludedNotInListB = 0;
    let modelExcludedNotInListB = 0;

    if (siteBFetchMode === "noveltyIds") {
      b = await fetchProductsByIds(tokenB, siteVar, noveltyIdsParsed);
      if (brands.length > 0) {
        const r = filterFpProductsByBrands(b, brands, brandMatch);
        brandExcludedMissingB = r.excludedMissingBrand;
        brandExcludedNotInListB = r.excludedNotInList;
        b = r.products;
      }
      if (models.length > 0) {
        const r = filterFpProductsByModels(b, models, modelMatch);
        modelExcludedNotInListB = r.excludedNotInList;
        b = r.products;
      }
    } else {
      const resBFull = await fetchMergedRubricsProducts(
        tokenB,
        siteVar,
        rubricBIds,
        pipeShared
      );
      b = resBFull.products;
      brandExcludedMissingB = resBFull.brandExcludedMissing;
      brandExcludedNotInListB = resBFull.brandExcludedNotInList;
      modelExcludedNotInListB = resBFull.modelExcludedNotInList;
    }

    let a = resA.products;

    if (b.length === 0) {
      return NextResponse.json(
        {
          error:
            siteBFetchMode === "noveltyIds"
              ? "Не удалось получить ни одной карточки сайта B по сохранённым id новинок (список пуст после запросов к API / проверьте ключ B и site variation)."
              : "Каталог B после выгрузки рубрик пуст."
        },
        { status: 400 }
      );
    }

    let excludeIdsAInfo: CompareExcludeIdsAInfo | undefined;
    if (resA.excludeMeta) {
      excludeIdsAInfo = {
        enabled: true,
        listSize: excludeIdsA.length,
        removedFromA: resA.excludeMeta.removedFromA,
        listIdsNotFoundInRubric: resA.excludeMeta.listIdsNotFoundInRubric
      };
      if (a.length === 0) {
        return NextResponse.json(
          {
            error:
              "После исключения по id в рубрике A не осталось товаров. Сократите список."
          },
          { status: 400 }
        );
      }
    }
    let brandFilter: CompareBrandFilterInfo | undefined;
    if (brands.length > 0) {
      if (a.length === 0 || b.length === 0) {
        const where =
          a.length === 0 && b.length === 0
            ? "в каталогах A и B"
            : a.length === 0
              ? "в каталоге A (рубрика / ключ сайта A)"
              : "в каталоге B (рубрика / ключ сайта B)";
        return NextResponse.json(
          {
            error: `После фильтра по бренду не осталось товаров ${where}. Фильтр сравнивает только поле brand.name из API, не текст названия товара. Проверьте id рубрик на обоих сайтах и как бренд записан в выгрузке; при необходимости временно отключите фильтр по бренду.`
          },
          { status: 400 }
        );
      }
      brandFilter = {
        enabled: true,
        matchMode: brandMatch,
        brandsSample: brands.slice(0, 50),
        totalBrands: brands.length,
        excludedMissingBrandA: resA.brandExcludedMissing,
        excludedMissingBrandB: brandExcludedMissingB,
        excludedNotInListA: resA.brandExcludedNotInList,
        excludedNotInListB: brandExcludedNotInListB
      };
    }
    let modelFilter: CompareModelFilterInfo | undefined;
    if (models.length > 0) {
      modelFilter = {
        enabled: true,
        matchMode: modelMatch,
        modelsSample: models.slice(0, 50),
        totalModels: models.length,
        excludedNotInListA: resA.modelExcludedNotInList,
        excludedNotInListB: modelExcludedNotInListB
      };
      if (a.length === 0 || b.length === 0) {
        return NextResponse.json(
          {
            error:
              "После фильтра по списку моделей в одном из каталогов не осталось товаров. Смягчите список или включите вхождение."
          },
          { status: 400 }
        );
      }
    }
    const result = await runCompare(a, b, nameLocale, siteALabel, siteBLabel, attrOpts);
    if (siteBFetchMode === "noveltyIds") {
      result.siteBFetchedByNoveltyIds = true;
    }
    if (brandFilter) {
      result.brandFilter = brandFilter;
    }
    if (modelFilter) {
      result.modelFilter = modelFilter;
    }
    if (excludeIdsAInfo) {
      result.excludeIdsA = excludeIdsAInfo;
    }
    const usAttempted2 = true;
    return NextResponse.json({
      ...result,
      unlikelySearch: {
        attempted: usAttempted2,
        volume: attrOpts?.volume === true,
        shade: attrOpts?.shade === true,
        color: attrOpts?.color === true
      }
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Ошибка сравнения";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
