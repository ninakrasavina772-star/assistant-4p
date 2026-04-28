/**
 * Упрощённый продукт 4Partners (/product/list). Доп. поля с бэка попадают в экспорт.
 */
export type FpProduct = {
  id: number;
  name: string;
  link: string;
  eans?: string[] | null;
  brand?: { name?: string } | null;
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
  kind: "ean_diff_id" | "name_photo" | "article" | "unlikely";
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
  kind: "ean_diff_id" | "name_photo" | "article" | "unlikely";
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
  kind: "ean" | "name_photo" | "unlikely";
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
  /** Пары «название + фото» (не попавшие в EAN-группы) */
  namePhotoPairs: IntraNamePhotoPairRow[];
  /** Фото + выбранные характеристики (мало) */
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
    /** |unplacedBByIdRaw| */
    unplacedBByIdCount: number;
    /** id из A, которого нет в B (симметрия unplacedBById) */
    unplacedAByIdCount: number;
    eanMatchCount: number;
    articleMatchCount: number;
    nameCandidateCount: number;
  };
  /**
   * Совпадения по id: товар B присутствует на A с тем же id (исключён из «неразмещённых»).
   */
  idMatches: IdMatchRow[];
  /**
   * B без пары в A **по id** (основа списка «неразмещённые» и кросс-дублей).
   */
  unplacedBByIdRaw: FpProduct[];
  /** A без пары в B по id (основа «неразмещённых A» и кросса A↔B) */
  unplacedAByIdRaw: FpProduct[];
  /**
   * Дубли **только в рамках каталога A** (рубрика A), независимо от «неразмещённых».
   */
  intraSiteADups: {
    eanGroups: IntraEanGroupRow[];
    namePhotoPairs: IntraNamePhotoPairRow[];
    unlikelyPairs: IntraUnlikelyPairRow[];
  };
  /** Дубли внутри рубрики B (аналог intraSiteADups) */
  intraSiteBDups: {
    eanGroups: IntraEanGroupRow[];
    namePhotoPairs: IntraNamePhotoPairRow[];
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
  /** «Только на B» сопоставлены с полным каталогом A (EAN при разных id / имя+фото) */
  onlyBCrossWithA?: OnlyBCrossWithARow[];
  /** «Только на A» сопоставлены с полным каталогом B */
  onlyACrossWithB?: OnlyACrossWithBRow[];
  /** Дубли внутри списка «только на B» */
  onlyBInternalDups?: OnlyBInternalDupRow[];
  /** Дубли внутри unplacedAByIdRaw (симметрия onlyBInternalDups) */
  onlyAInternalDups?: OnlyBInternalDupRow[];
  /** Как при «одна рубрика»: без галочек «маловероятные» в intraSite* не считаются */
  unlikelySearch?: UnlikelySearchInfo;
};
