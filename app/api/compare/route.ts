import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { type BrandMatchMode, mergeBrandLists } from "@/lib/brand-filter";
import { mergeModelLists, type ModelMatchMode } from "@/lib/model-filter";
import {
  fetchAllProductsInRubric,
  fetchMergedRubricsProducts
} from "@/lib/fourpartners";
import { findIntraSiteDuplicates } from "@/lib/intraSiteDups";
import { runCompare } from "@/lib/match";
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

  const rubricA = Number(body.rubricA);
  const rubricBIds = parseRubricBIds(body);

  if (!tokenA || !tokenB) {
    return NextResponse.json(
      {
        error:
          "Укажите ключи API в форме (сайт A и B) или задайте FOURPARTNERS_TOKEN_A / FOURPARTNERS_TOKEN_B в .env"
      },
      { status: 400 }
    );
  }
  if (!rubricA || rubricBIds.length === 0) {
    return NextResponse.json(
      {
        error:
          "Укажите id рубрики A и хотя бы одну рубрику B (поле rubricB или массив rubricsB)"
      },
      { status: 400 }
    );
  }

  try {
    const [resA, resB] = await Promise.all([
      fetchAllProductsInRubric(tokenA, siteVar, rubricA, {
        excludeIds:
          excludeIdsA.length > 0 ? new Set(excludeIdsA) : undefined,
        excludeIdsRaw: excludeIdsA.length > 0 ? excludeIdsA : undefined,
        brands: brands.length > 0 ? brands : undefined,
        brandMatch,
        models: models.length > 0 ? models : undefined,
        modelMatch
      }),
      fetchMergedRubricsProducts(tokenB, siteVar, rubricBIds, {
        brands: brands.length > 0 ? brands : undefined,
        brandMatch,
        models: models.length > 0 ? models : undefined,
        modelMatch
      })
    ]);
    let a = resA.products;
    let b = resB.products;
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
        excludedMissingBrandB: resB.brandExcludedMissing,
        excludedNotInListA: resA.brandExcludedNotInList,
        excludedNotInListB: resB.brandExcludedNotInList
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
        excludedNotInListB: resB.modelExcludedNotInList
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
