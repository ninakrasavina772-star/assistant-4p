import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import {
  type BrandMatchMode,
  filterFpProductsByBrands,
  mergeBrandLists
} from "@/lib/brand-filter";
import {
  filterFpProductsByModels,
  mergeModelLists,
  type ModelMatchMode
} from "@/lib/model-filter";
import { fetchAllProductsInRubric } from "@/lib/fourpartners";
import { findIntraSiteDuplicates } from "@/lib/intraSiteDups";
import { runCompare } from "@/lib/match";
import {
  filterSiteAByExcludedProductIds,
  parseExcludeIdsFromRequest
} from "@/lib/excludeProductIds";
import type {
  AttrMatchOptions,
  CompareBrandFilterInfo,
  CompareExcludeIdsAInfo,
  CompareModelFilterInfo,
  NameLocale
} from "@/lib/types";

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
      let products = await fetchAllProductsInRubric(
        tokenA,
        siteVar,
        rubricA
      );
      let excludeIdsAInfo: CompareExcludeIdsAInfo | undefined;
      if (excludeIdsA.length > 0) {
        const ex = filterSiteAByExcludedProductIds(products, excludeIdsA);
        products = ex.products;
        excludeIdsAInfo = {
          enabled: true,
          listSize: excludeIdsA.length,
          removedFromA: ex.removedFromA,
          listIdsNotFoundInRubric: ex.listIdsNotFoundInRubric
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
        const f = filterFpProductsByBrands(products, brands, brandMatch);
        products = f.products;
        brandFilter = {
          enabled: true,
          matchMode: brandMatch,
          brandsSample: brands.slice(0, 50),
          totalBrands: brands.length,
          excludedMissingBrandA: f.excludedMissingBrand,
          excludedNotInListA: f.excludedNotInList,
          excludedMissingBrandB: 0,
          excludedNotInListB: 0
        };
        if (products.length === 0) {
          return NextResponse.json(
            {
              error:
                "После фильтра по бренду не осталось товаров. Проверьте написание или включите «вхождение в название бренда» (частичное совпадение)."
            },
            { status: 400 }
          );
        }
      }
      let modelFilter: CompareModelFilterInfo | undefined;
      if (models.length > 0) {
        const fm = filterFpProductsByModels(products, models, modelMatch);
        products = fm.products;
        modelFilter = {
          enabled: true,
          matchMode: modelMatch,
          modelsSample: models.slice(0, 50),
          totalModels: models.length,
          excludedNotInListA: fm.excludedNotInList,
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
      const dups = findIntraSiteDuplicates(products, nameLocale, attrOpts);
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
  const rubricB = Number(body.rubricB);

  if (!tokenA || !tokenB) {
    return NextResponse.json(
      {
        error:
          "Укажите ключи API в форме (сайт A и B) или задайте FOURPARTNERS_TOKEN_A / FOURPARTNERS_TOKEN_B в .env"
      },
      { status: 400 }
    );
  }
  if (!rubricA || !rubricB) {
    return NextResponse.json(
      { error: "Укажите числовые id рубрик rubricA и rubricB" },
      { status: 400 }
    );
  }

  try {
    const [productsA, productsB] = await Promise.all([
      fetchAllProductsInRubric(tokenA, siteVar, rubricA),
      fetchAllProductsInRubric(tokenB, siteVar, rubricB)
    ]);
    let a = productsA;
    let b = productsB;
    let excludeIdsAInfo: CompareExcludeIdsAInfo | undefined;
    if (excludeIdsA.length > 0) {
      const ex = filterSiteAByExcludedProductIds(a, excludeIdsA);
      a = ex.products;
      excludeIdsAInfo = {
        enabled: true,
        listSize: excludeIdsA.length,
        removedFromA: ex.removedFromA,
        listIdsNotFoundInRubric: ex.listIdsNotFoundInRubric
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
      const fa = filterFpProductsByBrands(a, brands, brandMatch);
      const fb = filterFpProductsByBrands(productsB, brands, brandMatch);
      a = fa.products;
      b = fb.products;
      if (a.length === 0 || b.length === 0) {
        return NextResponse.json(
          {
            error:
              "После фильтра по бренду в одном из каталогов не осталось товаров. Проверьте написание бренда или включите «вхождение в название бренда»."
          },
          { status: 400 }
        );
      }
      brandFilter = {
        enabled: true,
        matchMode: brandMatch,
        brandsSample: brands.slice(0, 50),
        totalBrands: brands.length,
        excludedMissingBrandA: fa.excludedMissingBrand,
        excludedMissingBrandB: fb.excludedMissingBrand,
        excludedNotInListA: fa.excludedNotInList,
        excludedNotInListB: fb.excludedNotInList
      };
    }
    let modelFilter: CompareModelFilterInfo | undefined;
    if (models.length > 0) {
      const fma = filterFpProductsByModels(a, models, modelMatch);
      const fmb = filterFpProductsByModels(b, models, modelMatch);
      a = fma.products;
      b = fmb.products;
      modelFilter = {
        enabled: true,
        matchMode: modelMatch,
        modelsSample: models.slice(0, 50),
        totalModels: models.length,
        excludedNotInListA: fma.excludedNotInList,
        excludedNotInListB: fmb.excludedNotInList
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
    const result = runCompare(a, b, nameLocale, siteALabel, siteBLabel, attrOpts);
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
