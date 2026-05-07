/**
 * Упрощённый продукт 4Partners (/product/list). Доп. поля с бэка попадают в экспорт.
 */
export type FpProduct = {
  id: number;
  name: string;
  link: string;
  eans?: string[] | null;
  /**
   * В выгрузке /product/list обычно { name }. Реже API отдаёт бренд строкой в `brand`
   * или в корневом `brand_name` — см. productBrandName в brand-filter.
   */
  brand?: { name?: string } | string | null;
  brand_name?: string | null;
  i18n?: Record<
    string,
    { name?: string; description?: string } | undefined
  >;
  /** Текст из API, если есть — для поиска объёма в описании */
  description?: string;
  short_description?: string;
  text?: string;
  product_variation?: Record<
    string,
    {
      id?: number;
      ean?: string;
      images?: string[];
      link?: string;
      /** Активный остаток по офферу (Partner API); null/0 — вариант без активного оффера */
      quantity?: number | null;
    }
  > | null;
  /** Артикул/код, если API отдаёт */
  article?: string;
  code?: string;
  vendor_code?: string;
  /** Наименование от поставщика / оригинал */
  original_name?: string;
  name_original?: string;
  supplier_name?: string;
  /** Иногда бренд дублируется в manufacturer / vendor (строка или объект как brand) */
  manufacturer?: string | { name?: string; title?: string; label?: string } | null;
  vendor?: string | { name?: string; title?: string; label?: string } | null;
};

export type NameLocale = "en" | "ru";

/** Учитывать при сопоставлении «название + фото» (и внутри одной витрины) */
export type AttrMatchOptions = {
  volume?: boolean;
  shade?: boolean;
  color?: boolean;
};

export type CompareProduct = {
  id: number;
  nameEn: string;
  nameRu: string;
  link: string;
  eans: string[];
  firstImage: string | null;
  brand: string;
  /** Суффикс в URL вида a1182822 — одна «семья» карточки */
  linkBaseKey?: string;
  /** Первый нормализованный артикул (в выгрузке могут быть и другие) */
  articleKey?: string;
  /** Подтянуто из JSON товара, если есть: объём / цвет / оттенок */
  attrVolume?: string;
  attrColor?: string;
  attrShade?: string;
};

export type EanMatchRow = {
  ean: string;
  a: CompareProduct;
  b: CompareProduct;
};

/** Сопоставление по артикулу/коду (тот же ключ на A и B) */
export type ArticleMatchRow = {
  article: string;
  a: CompareProduct;
  b: CompareProduct;
};

export type NameMatchRow = {
  a: CompareProduct;
  b: CompareProduct;
  /** 0..1, соответствует шкале 0–100 в riv-gosh (порог нечёткого 0,6) */
  score: number;
  matchReasons?: string[];
};

/** «Только на B» + совпадение в полном каталоге A: EAN, артикул, имя+фото / семья URL */
export type OnlyBCrossWithARow = {
  kind:
    | "ean_diff_id"
    | "name_photo"
    | "brand_visual"
    | "article"
    | "unlikely";
  productOnA: CompareProduct;
  productFromOnlyB: CompareProduct;
  ean?: string;
  /** Нормализованный артикул, если kind === "article" */
  article?: string;
  score?: number;
  matchReasons?: string[];
};

/** «Только на A» + совпадение в полном каталоге B (симметрично OnlyBCrossWithARow) */
export type OnlyACrossWithBRow = {
  kind:
    | "ean_diff_id"
    | "name_photo"
    | "brand_visual"
    | "article"
    | "unlikely";
  productOnB: CompareProduct;
  productFromOnlyA: CompareProduct;
  ean?: string;
  article?: string;
  score?: number;
  matchReasons?: string[];
};

/** Один EAN — несколько товаров на одной площадке; для UI (фото, ссылки) */
export type DuplicateEanEnrichedRow = {
  site: "A" | "B";
  ean: string;
  products: CompareProduct[];
};

/** Дубли внутри списка «только на B»: сначала EAN, потом жадно имя+фото */
export type OnlyBInternalDupRow = {
  kind: "ean" | "name_photo" | "brand_visual" | "unlikely";
  first: CompareProduct;
  second: CompareProduct;
  ean?: string;
  score?: number;
  matchReasons?: string[];
};

export type IntraEanGroupRow = {
  ean: string;
  products: CompareProduct[];
};

export type IntraNamePhotoPairRow = {
  a: CompareProduct;
  b: CompareProduct;
  score: number;
  matchReasons: string[];
};

export type IntraUnlikelyPairRow = {
  a: CompareProduct;
  b: CompareProduct;
  score: number;
  matchReasons: string[];
};

/** Сопоставлены по id товара (один и тот же id на A и B) */
export type IdMatchRow = {
  id: number;
  a: CompareProduct;
  b: CompareProduct;
};

/**
 * Какие галочки стояли при запуске «дубли в рубрике» — влияет на расчёт «маловероятных».
 * Поиск «маловероятных» (фото+модель) всегда выполняется; `volume`/`shade`/`color` —
 * какие галочки стояли, чтобы в отчёте показать подсказки по характеристикам.
 */
export type UnlikelySearchInfo = {
  attempted: boolean;
  volume: boolean;
  shade: boolean;
  color: boolean;
};

/** Один запрос пагинации для шага 1 «новинки по id» (укладывается в короткий лимит Vercel). */
export type NoveltyIdsSliceResult = {
  resultKind: "noveltyIdsSlice";
  leg: "A" | "B";
  rubricId: number;
  /** Страница из запроса клиента (для продолжения цикла). */
  page: number;
  ids: number[];
  /** Все id карточек на странице до исключения по списку id на A (только для сверки excludeIds). */
  rawCatalogIdsBeforeExclude: number[];
  hasMore: boolean;
  perPage: number;
  statsSlice: {
    brandExcludedMissing: number;
    brandExcludedNotInList: number;
    modelExcludedNotInList: number;
    excludeRemovedFromA: number;
  };
};

/** Этап 1: только сравнение множеств id по рубрикам A и B (без полных карточек и без runCompare) */
export type NoveltyIdsStageResult = {
  resultKind: "noveltyIdsStage";
  siteALabel: string;
  siteBLabel: string;
  noveltyIds: number[];
  stats: {
    /** Уникальных id на A после фильтров (исключения, бренды, модели) */
    countIdsRubricA: number;
    /** Уникальных id на B после фильтров */
    countIdsRubricB: number;
    /** Сколько id из B также есть на A */
    idsOnBothSites: number;
    /** |noveltyIds| — id есть на B, нет на A */
    noveltyCount: number;
  };
  brandFilter?: CompareBrandFilterInfo;
  modelFilter?: CompareModelFilterInfo;
  excludeIdsA?: CompareExcludeIdsAInfo;
};

/** Мастер: полная выгрузка карточек новинок по id (GET /product/info) */
export type NoveltiesFullExportResult = {
  resultKind: "noveltiesFullExport";
  products: FpProduct[];
  siteBLabel: string;
  nameLocale: NameLocale;
};

/** Мастер: id новинок без пересечения EAN с выгрузкой рубрики A */
export type NoveltyIdsNoEanOnAResult = {
  resultKind: "noveltyIdsNoEanOnA";
  ids: number[];
  stats: {
    noveltyLoadedCount: number;
    removedForEanMatchOnA: number;
    remainingCount: number;
  };
  siteALabel: string;
  siteBLabel: string;
};

/** Результат «один сайт, одна рубрика» — дубли внутри выгрузки */
export type SingleSiteDupsResult = {
  resultKind: "singleSiteDups";
  siteLabel: string;
  nameLocale: NameLocale;
  rubricId: number;
  stats: { count: number };
  brandFilter?: CompareBrandFilterInfo;
  modelFilter?: CompareModelFilterInfo;
  excludeIdsA?: CompareExcludeIdsAInfo;
  /** Один EAN — несколько разных id */
  eanGroups: IntraEanGroupRow[];
  /** ~90%: частичное название + эквивалентный URL фото (не в EAN-группах) */
  namePhotoPairs: IntraNamePhotoPairRow[];
  /** ~60%: точный бренд + частичное название + визуально похожее фото */
  brandVisualPairs: IntraNamePhotoPairRow[];
  /** Маловероятные: бренд + слабее название + похожее фото */
  unlikelyPairs: IntraUnlikelyPairRow[];
  /** Нужен, чтобы отличить «0 совпадений» от «поиск не запускали» */
  unlikelySearch?: UnlikelySearchInfo;
};

export type CompareBrandFilterInfo = {
  enabled: boolean;
  /** Как сопоставляли строки с brand.name: точно или вхождение подстроки */
  matchMode?: "exact" | "contains";
  /** До 50 шт. для подсказки в UI; полный список в запросе */
  brandsSample: string[];
  totalBrands: number;
  /** Сколько товаров без brand в ответе API — исключены при включённом фильтре */
  excludedMissingBrandA: number;
  excludedMissingBrandB: number;
  /** С брендом, но не из списка — исключены */
  excludedNotInListA: number;
  excludedNotInListB: number;
};

/** Фильтр по списку «моделей» (строки ищем в названии / модельной части) */
export type CompareModelFilterInfo = {
  enabled: boolean;
  matchMode: "exact" | "contains";
  modelsSample: string[];
  totalModels: number;
  excludedNotInListA: number;
  excludedNotInListB: number;
};

/** Исключение товаров сайта A по списку id (до брендов/моделей) */
export type CompareExcludeIdsAInfo = {
  enabled: boolean;
  /** Уникальных id в запросе */
  listSize: number;
  /** Убрано из выгрузки рубрики A (совпали с списком) */
  removedFromA: number;
  /** Id из списка, которых не было в рубрике A (опечатка или другая рубрика) */
  listIdsNotFoundInRubric: number;
};

export type CompareResult = {
  siteALabel: string;
  siteBLabel: string;
  nameLocale: NameLocale;
  /**
   * EAN совпал между A и B, но id товара различается — внимание при выгрузках.
   * Случаи с одинаковым id и EAN в список не попадают (см. eanTrivialSameId).
   */
  eanMatches: EanMatchRow[];
  /** Сколько пар убрано из списка: тот же EAN и тот же id (типовой дубль витрин) */
  eanTrivialSameId: number;
  /** Тот же артикул и тот же id (не показано в articleMatches) */
  articleTrivialSameId: number;
  /** Тот же артикул/код между A и B (как EAN, без учёта вариаций) */
  articleMatches: ArticleMatchRow[];
  nameMatches: NameMatchRow[];
  onlyA: CompareProduct[];
  onlyB: CompareProduct[];
  stats: {
    countA: number;
    countB: number;
    /** Сколько позиций B «есть в A» по одному id */
    idPlacedCount: number;
    /** |unplacedBByIdRaw| — нет того же **id** товара на A */
    unplacedBByIdCount: number;
    /** id из A, которого нет в B (симметрия unplacedBById) */
    unplacedAByIdCount: number;
    /**
     * Товары с B: ни один ключ (article/code/vendor_code + суффикс a… из ссылки) не найден на A —
     * критерий «новинка» для отчётов ниже и кросс-дублей B→A.
     */
    noveltiesBByArticleCount: number;
    /**
     * Симметрично: товары A без пересечения артикулов с каталогом B — кросс A→B.
     */
    noveltiesAByArticleCount: number;
    /**
     * Сколько позиций B без полей артикула/code/vendor в JSON (они всё же попали в новинки
     * как «нельзя проверить по артикулу»).
     */
    noveltiesIncludedBmissingArticleFields?: number;
    noveltiesIncludedAmissingArticleFields?: number;
    eanMatchCount: number;
    articleMatchCount: number;
    nameCandidateCount: number;
  };
  /**
   * Совпадения по id: товар B присутствует на A с тем же id (исключён из «неразмещённых»).
   */
  idMatches: IdMatchRow[];
  /**
   * B без пары в A **по id** (справочно; кросс-дубли считаются от «новинок по артикулу», см. noveltiesByArticleRaw).
   */
  unplacedBByIdRaw: FpProduct[];
  /** A без пары в B по id */
  unplacedAByIdRaw: FpProduct[];
  /**
   * Дубли **только в рамках каталога A** (рубрика A), независимо от «неразмещённых».
   */
  intraSiteADups: {
    eanGroups: IntraEanGroupRow[];
    namePhotoPairs: IntraNamePhotoPairRow[];
    brandVisualPairs: IntraNamePhotoPairRow[];
    unlikelyPairs: IntraUnlikelyPairRow[];
  };
  /** Дубли внутри рубрики B (аналог intraSiteADups) */
  intraSiteBDups: {
    eanGroups: IntraEanGroupRow[];
    namePhotoPairs: IntraNamePhotoPairRow[];
    brandVisualPairs: IntraNamePhotoPairRow[];
    unlikelyPairs: IntraUnlikelyPairRow[];
  };
  /** EAN, которым сопоставлено более одного товара (на рубрике) — требуется ручной разбор */
  duplicateEanWarnings: { site: "A" | "B"; ean: string; productIds: number[] }[];
  /** Тот же артикул — несколько id */
  duplicateArticleWarnings?: { site: "A" | "B"; article: string; productIds: number[] }[];
  /**
   * То же, что duplicateEanWarnings, но с карточками (фото, названия) для отображения.
   */
  duplicateEanEnriched?: DuplicateEanEnrichedRow[];
  /** Заполнено, если при сравнении был непустой список брендов */
  brandFilter?: CompareBrandFilterInfo;
  /** Список моделей в названии (после бренд-фильтра, если был) */
  modelFilter?: CompareModelFilterInfo;
  excludeIdsA?: CompareExcludeIdsAInfo;
  /**
   * Полные объекты API для товаров «только на B» (для выгрузки Excel).
   * Пароль/токен не передаётся — только публичные поля товара.
   */
  rawOnlyB?: FpProduct[];
  /**
   * Полные объекты API для товаров «только на A» (симметрично rawOnlyB, для выгрузки).
   */
  rawOnlyA?: FpProduct[];
  /**
   * Новинки с B: ни один артикул/code/vendor_code не найден в каталоге A.
   * По этому списку считаются «кросс-дубли» на A и внутренние дубли списка.
   */
  noveltiesByArticleRaw?: FpProduct[];
  /**
   * Новинки с A: симметрично (артикулы отсутствуют среди позиций B).
   */
  noveltiesAByArticleRaw?: FpProduct[];
  /**
   * Каждая позиция с B из novelties — сопоставление с полным каталогом A
   * (общий EAN при разных id, название+фото и т.д.).
   */
  onlyBCrossWithA?: OnlyBCrossWithARow[];
  /** То же симметрично: позиции novelties на A против полного каталога B */
  onlyACrossWithB?: OnlyACrossWithBRow[];
  /** Дубли между двумя новинками B (внутри noveltiesByArticleRaw) */
  onlyBInternalDups?: OnlyBInternalDupRow[];
  /** Дубли внутри novelties на A */
  onlyAInternalDups?: OnlyBInternalDupRow[];
  /** Как при «одна рубрика»: без галочек «маловероятные» в intraSite* не считаются */
  unlikelySearch?: UnlikelySearchInfo;
  /** Сайт B загружен через GET /product/info по списку новинок (этап 1), не целиком из рубрик */
  siteBFetchedByNoveltyIds?: boolean;
  /** Каталоги A/B из CSV-фидов (не выгрузка по рубрикам API) */
  catalogFromFeeds?: boolean;
};
