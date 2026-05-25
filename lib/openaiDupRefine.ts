import { normBrand } from "./pairScoring";
import type {
  CompareProduct,
  CompareResult,
  IntraEanGroupRow,
  IntraNamePhotoPairRow,
  IntraUnlikelyPairRow,
  NameLocale,
  SingleSiteDupsResult
} from "./types";

export type DupPairRefineIn = {
  idA: number;
  idB: number;
  titleA: string;
  titleB: string;
  brandA: string;
  brandB: string;
  layer: string;
  /** Публичный URL первого фото (для режима vision) */
  imageUrlA?: string | null;
  imageUrlB?: string | null;
};

export type DupPairVerdict = {
  pairKey: string;
  duplicate: boolean;
  confidence: number;
  note?: string;
};

export function dupPairKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

function pickTitle(c: CompareProduct, nl: NameLocale): string {
  return nl === "ru" ? c.nameRu : c.nameEn;
}

function isSoftCrossKind(
  k: string
): k is "name_photo" | "brand_visual" | "unlikely" {
  return k === "name_photo" || k === "brand_visual" || k === "unlikely";
}

function isSoftInternalKind(
  k: string
): k is "name_photo" | "brand_visual" | "unlikely" {
  return k === "name_photo" || k === "brand_visual" || k === "unlikely";
}

export type CollectSoftDupPairsOptions = {
  /** Пары с этими ключами (формат как у dupPairKey) не включаются — уже проверены AI. */
  excludePairKeys?: ReadonlySet<string>;
  /**
   * Пары, которые отчёт уже отнёс к EAN / слоям название+фото / маловероятным — в OpenAI не шлём
   * (режим «только новые кандидаты» + вкладка «Дубли AI»).
   */
  excludeAlgorithmPairKeys?: ReadonlySet<string>;
};

function titleTokenJaccard(t1: string, t2: string): number {
  const tokenize = (s: string) => {
    const parts = s
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length > 2);
    return [...new Set(parts)];
  };
  const a = new Set(tokenize(t1));
  const b = new Set(tokenize(t2));
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union > 0 ? inter / union : 0;
}

function titlesLooseMatch(ta: string, tb: string): boolean {
  const jac = titleTokenJaccard(ta, tb);
  if (jac >= 0.085) return true;
  if (ta.length < 8 || tb.length < 8) return false;
  const pa = ta.slice(0, Math.min(28, ta.length)).toLowerCase();
  const pb = tb.slice(0, Math.min(28, tb.length)).toLowerCase();
  return ta.toLowerCase().includes(pb) || tb.toLowerCase().includes(pa);
}

export function collectProductsFromSingleSiteDups(
  data: SingleSiteDupsResult
): Map<number, CompareProduct> {
  const m = new Map<number, CompareProduct>();
  for (const g of data.eanGroups) {
    for (const c of g.products) m.set(c.id, c);
  }
  for (const g of data.nameGroups ?? []) {
    for (const c of g.products) m.set(c.id, c);
  }
  for (const row of data.namePhotoPairs ?? []) {
    m.set(row.a.id, row.a);
    m.set(row.b.id, row.b);
  }
  for (const row of data.brandVisualPairs ?? []) {
    m.set(row.a.id, row.a);
    m.set(row.b.id, row.b);
  }
  for (const row of data.unlikelyPairs ?? []) {
    m.set(row.a.id, row.a);
    m.set(row.b.id, row.b);
  }
  return m;
}

/** Пары, которые отчёт уже классифицировал (вкладки EAN / название+фото / маловероятные). */
export function buildIntraAlgoSlicePairKeys(slice: {
  eanGroups: IntraEanGroupRow[];
  nameGroups?: { products: CompareProduct[] }[];
  namePhotoPairs: IntraNamePhotoPairRow[];
  brandVisualPairs: IntraNamePhotoPairRow[];
  unlikelyPairs: IntraUnlikelyPairRow[];
}): Set<string> {
  const s = new Set<string>();
  const addGroupProducts = (prods: CompareProduct[]) => {
    for (let i = 0; i < prods.length; i++) {
      for (let j = i + 1; j < prods.length; j++) {
        s.add(dupPairKey(prods[i]!.id, prods[j]!.id));
      }
    }
  };
  for (const g of slice.eanGroups ?? []) addGroupProducts(g.products);
  for (const g of slice.nameGroups ?? []) addGroupProducts(g.products);
  const addRow = (a: CompareProduct, b: CompareProduct) =>
    s.add(dupPairKey(a.id, b.id));
  for (const row of slice.namePhotoPairs ?? []) addRow(row.a, row.b);
  for (const row of slice.brandVisualPairs ?? []) addRow(row.a, row.b);
  for (const row of slice.unlikelyPairs ?? []) addRow(row.a, row.b);
  return s;
}

export function buildIntraAlgorithmPairKeysSingleSite(
  data: SingleSiteDupsResult
): Set<string> {
  return buildIntraAlgoSlicePairKeys({
    eanGroups: data.eanGroups,
    nameGroups: data.nameGroups,
    namePhotoPairs: data.namePhotoPairs,
    brandVisualPairs: data.brandVisualPairs ?? [],
    unlikelyPairs: data.unlikelyPairs ?? []
  });
}

export function buildCompareAlgorithmPairKeys(cr: CompareResult): Set<string> {
  const s = new Set<string>();
  const add = (a: number, b: number) => s.add(dupPairKey(a, b));
  for (const r of cr.eanMatches ?? []) add(r.a.id, r.b.id);
  for (const r of cr.articleMatches ?? []) add(r.a.id, r.b.id);
  for (const r of cr.nameMatches ?? []) add(r.a.id, r.b.id);
  for (const r of cr.idMatches ?? []) add(r.a.id, r.b.id);
  for (const r of cr.onlyBCrossWithA ?? []) add(r.productOnA.id, r.productFromOnlyB.id);
  for (const r of cr.onlyACrossWithB ?? []) add(r.productFromOnlyA.id, r.productOnB.id);
  for (const r of cr.onlyBInternalDups ?? []) add(r.first.id, r.second.id);
  for (const r of cr.onlyAInternalDups ?? []) add(r.first.id, r.second.id);
  for (const sub of [cr.intraSiteADups, cr.intraSiteBDups]) {
    for (const k of buildIntraAlgoSlicePairKeys(sub)) s.add(k);
  }
  return s;
}

export function buildAlgorithmPairKeys(
  data: CompareResult | SingleSiteDupsResult | null
): Set<string> {
  if (!data) return new Set();
  if ("resultKind" in data && data.resultKind === "singleSiteDups") {
    return buildIntraAlgorithmPairKeysSingleSite(data);
  }
  if (!("resultKind" in data)) {
    return buildCompareAlgorithmPairKeys(data);
  }
  return new Set();
}

function collectIntraDiscoveryPairs(
  productsById: Map<number, CompareProduct>,
  nameLocale: NameLocale,
  maxPairs: number,
  out: DupPairRefineIn[],
  excludePairKeys: ReadonlySet<string> | undefined,
  excludeAlgorithmPairKeys: ReadonlySet<string> | undefined,
  seen: Set<string>,
  push: (
    idA: number,
    idB: number,
    titleA: string,
    titleB: string,
    brandA: string,
    brandB: string,
    layer: string,
    imageUrlA?: string | null,
    imageUrlB?: string | null
  ) => void
) {
  const MAX_BUCKET = 120;
  const byBrand = new Map<string, CompareProduct[]>();
  for (const c of productsById.values()) {
    const bk = normBrand(c.brand) || "__nobrand__";
    if (!byBrand.has(bk)) byBrand.set(bk, []);
    byBrand.get(bk)!.push(c);
  }
  const keys = [...byBrand.keys()].sort();
  for (const bk of keys) {
    const list = byBrand.get(bk)!;
    if (list.length < 2) continue;
    list.sort((x, y) => x.id - y.id);
    const slice = list.length > MAX_BUCKET ? list.slice(0, MAX_BUCKET) : list;
    for (let i = 0; i < slice.length; i++) {
      if (out.length >= maxPairs) return;
      const a = slice[i]!;
      for (let j = i + 1; j < slice.length; j++) {
        if (out.length >= maxPairs) return;
        const b = slice[j]!;
        const k = dupPairKey(a.id, b.id);
        if (excludeAlgorithmPairKeys?.has(k)) continue;
        if (excludePairKeys?.has(k)) continue;
        if (seen.has(k)) continue;
        const ta = pickTitle(a, nameLocale);
        const tb = pickTitle(b, nameLocale);
        if (!titlesLooseMatch(ta, tb)) continue;
        push(
          a.id,
          b.id,
          ta,
          tb,
          a.brand,
          b.brand,
          "intra:ai_discovery",
          a.firstImage,
          b.firstImage
        );
      }
    }
  }
}

function collectCrossDiscoveryPairs(
  listA: CompareProduct[],
  listB: CompareProduct[],
  nameLocale: NameLocale,
  maxPairs: number,
  out: DupPairRefineIn[],
  excludePairKeys: ReadonlySet<string> | undefined,
  excludeAlgorithmPairKeys: ReadonlySet<string> | undefined,
  seen: Set<string>,
  push: (
    idA: number,
    idB: number,
    titleA: string,
    titleB: string,
    brandA: string,
    brandB: string,
    layer: string,
    imageUrlA?: string | null,
    imageUrlB?: string | null
  ) => void
) {
  const MAX_SIDE = 55;
  const byA = new Map<string, CompareProduct[]>();
  const byB = new Map<string, CompareProduct[]>();
  const put = (m: Map<string, CompareProduct[]>, c: CompareProduct) => {
    const bk = normBrand(c.brand) || "__nobrand__";
    if (!m.has(bk)) m.set(bk, []);
    m.get(bk)!.push(c);
  };
  for (const c of listA) put(byA, c);
  for (const c of listB) put(byB, c);
  const keys = [...byA.keys()].filter((k) => byB.has(k)).sort();
  for (const bk of keys) {
    let as = byA.get(bk)!;
    let bs = byB.get(bk)!;
    as = [...as].sort((x, y) => x.id - y.id);
    bs = [...bs].sort((x, y) => x.id - y.id);
    if (as.length > MAX_SIDE) as = as.slice(0, MAX_SIDE);
    if (bs.length > MAX_SIDE) bs = bs.slice(0, MAX_SIDE);
    for (const a of as) {
      if (out.length >= maxPairs) return;
      for (const b of bs) {
        if (out.length >= maxPairs) return;
        const k = dupPairKey(a.id, b.id);
        if (excludeAlgorithmPairKeys?.has(k)) continue;
        if (excludePairKeys?.has(k)) continue;
        if (seen.has(k)) continue;
        const ta = pickTitle(a, nameLocale);
        const tb = pickTitle(b, nameLocale);
        if (!titlesLooseMatch(ta, tb)) continue;
        push(
          a.id,
          b.id,
          ta,
          tb,
          a.brand,
          b.brand,
          "cross:ai_discovery",
          a.firstImage,
          b.firstImage
        );
      }
    }
  }
}

/**
 * Уникальные мягкие пары для отправки в OpenAI (кросс-площадки + внутренние + режим одной рубрики).
 */
export function collectSoftDupPairsForOpenAi(
  data: CompareResult | SingleSiteDupsResult | null,
  nameLocale: NameLocale,
  maxPairs: number,
  options?: CollectSoftDupPairsOptions
): DupPairRefineIn[] {
  if (!data || maxPairs < 1) return [];
  const excludePairKeys = options?.excludePairKeys;
  const excludeAlgorithmPairKeys = options?.excludeAlgorithmPairKeys;
  const discoveryOnly = excludeAlgorithmPairKeys !== undefined;
  const seen = new Set<string>();
  const out: DupPairRefineIn[] = [];

  function push(
    idA: number,
    idB: number,
    titleA: string,
    titleB: string,
    brandA: string,
    brandB: string,
    layer: string,
    imageUrlA?: string | null,
    imageUrlB?: string | null
  ) {
    const k = dupPairKey(idA, idB);
    if (excludePairKeys?.has(k)) return;
    if (excludeAlgorithmPairKeys?.has(k)) return;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({
      idA,
      idB,
      titleA,
      titleB,
      brandA,
      brandB,
      layer,
      imageUrlA: imageUrlA ?? null,
      imageUrlB: imageUrlB ?? null
    });
  }

  if ("resultKind" in data && data.resultKind === "singleSiteDups") {
    if (discoveryOnly) {
      const byId = collectProductsFromSingleSiteDups(data);
      collectIntraDiscoveryPairs(
        byId,
        nameLocale,
        maxPairs,
        out,
        excludePairKeys,
        excludeAlgorithmPairKeys,
        seen,
        push
      );
      return out;
    }
    const layers: {
      rows: { a: CompareProduct; b: CompareProduct }[];
      layer: string;
    }[] = [
      { rows: data.namePhotoPairs, layer: "intra:name_photo" },
      { rows: data.brandVisualPairs ?? [], layer: "intra:brand_visual" },
      { rows: data.unlikelyPairs ?? [], layer: "intra:unlikely" }
    ];
    for (const { rows, layer } of layers) {
      for (const row of rows) {
        if (out.length >= maxPairs) return out;
        const { a, b } = row;
        push(
          a.id,
          b.id,
          pickTitle(a, nameLocale),
          pickTitle(b, nameLocale),
          a.brand,
          b.brand,
          layer,
          a.firstImage,
          b.firstImage
        );
      }
    }
    return out;
  }

  const cr = data as CompareResult;

  if (discoveryOnly) {
    collectCrossDiscoveryPairs(
      cr.onlyA ?? [],
      cr.onlyB ?? [],
      nameLocale,
      maxPairs,
      out,
      excludePairKeys,
      excludeAlgorithmPairKeys,
      seen,
      push
    );
    if (out.length < maxPairs) {
      collectIntraDiscoveryPairs(
        new Map((cr.onlyB ?? []).map((c) => [c.id, c])),
        nameLocale,
        maxPairs,
        out,
        excludePairKeys,
        excludeAlgorithmPairKeys,
        seen,
        push
      );
    }
    if (out.length < maxPairs) {
      collectIntraDiscoveryPairs(
        new Map((cr.onlyA ?? []).map((c) => [c.id, c])),
        nameLocale,
        maxPairs,
        out,
        excludePairKeys,
        excludeAlgorithmPairKeys,
        seen,
        push
      );
    }
    return out;
  }

  for (const r of cr.onlyBCrossWithA ?? []) {
    if (out.length >= maxPairs) break;
    if (!isSoftCrossKind(r.kind)) continue;
    const a = r.productOnA;
    const b = r.productFromOnlyB;
    push(
      a.id,
      b.id,
      pickTitle(a, nameLocale),
      pickTitle(b, nameLocale),
      a.brand,
      b.brand,
      `onlyBvsA:${r.kind}`,
      a.firstImage,
      b.firstImage
    );
  }

  for (const r of cr.onlyACrossWithB ?? []) {
    if (out.length >= maxPairs) break;
    if (!isSoftCrossKind(r.kind)) continue;
    const a = r.productFromOnlyA;
    const b = r.productOnB;
    push(
      a.id,
      b.id,
      pickTitle(a, nameLocale),
      pickTitle(b, nameLocale),
      a.brand,
      b.brand,
      `onlyAvsB:${r.kind}`,
      a.firstImage,
      b.firstImage
    );
  }

  for (const r of cr.onlyBInternalDups ?? []) {
    if (out.length >= maxPairs) break;
    if (!isSoftInternalKind(r.kind)) continue;
    const a = r.first;
    const b = r.second;
    push(
      a.id,
      b.id,
      pickTitle(a, nameLocale),
      pickTitle(b, nameLocale),
      a.brand,
      b.brand,
      `internalB:${r.kind}`,
      a.firstImage,
      b.firstImage
    );
  }

  for (const r of cr.onlyAInternalDups ?? []) {
    if (out.length >= maxPairs) break;
    if (!isSoftInternalKind(r.kind)) continue;
    const a = r.first;
    const b = r.second;
    push(
      a.id,
      b.id,
      pickTitle(a, nameLocale),
      pickTitle(b, nameLocale),
      a.brand,
      b.brand,
      `internalA:${r.kind}`,
      a.firstImage,
      b.firstImage
    );
  }

  return out;
}

/** Все карточки из отчёта, по которым можно найти текст/фото для пары из вердикта AI */
export function collectProductsForAiLookup(
  data: CompareResult | SingleSiteDupsResult
): Map<number, CompareProduct> {
  if ("resultKind" in data && data.resultKind === "singleSiteDups") {
    return collectProductsFromSingleSiteDups(data);
  }
  const cr = data as CompareResult;
  const m = new Map<number, CompareProduct>();
  const add = (c: CompareProduct) => m.set(c.id, c);
  for (const c of cr.onlyA ?? []) add(c);
  for (const c of cr.onlyB ?? []) add(c);
  for (const r of cr.eanMatches ?? []) {
    add(r.a);
    add(r.b);
  }
  for (const r of cr.articleMatches ?? []) {
    add(r.a);
    add(r.b);
  }
  for (const r of cr.nameMatches ?? []) {
    add(r.a);
    add(r.b);
  }
  for (const r of cr.idMatches ?? []) {
    add(r.a);
    add(r.b);
  }
  for (const slice of [cr.intraSiteADups, cr.intraSiteBDups]) {
    for (const g of slice.eanGroups ?? []) {
      for (const c of g.products) add(c);
    }
    for (const g of slice.nameGroups ?? []) {
      for (const c of g.products) add(c);
    }
    for (const row of slice.namePhotoPairs ?? []) {
      add(row.a);
      add(row.b);
    }
    for (const row of slice.brandVisualPairs ?? []) {
      add(row.a);
      add(row.b);
    }
    for (const row of slice.unlikelyPairs ?? []) {
      add(row.a);
      add(row.b);
    }
  }
  for (const r of cr.onlyBCrossWithA ?? []) {
    add(r.productOnA);
    add(r.productFromOnlyB);
  }
  for (const r of cr.onlyACrossWithB ?? []) {
    add(r.productFromOnlyA);
    add(r.productOnB);
  }
  for (const r of cr.onlyBInternalDups ?? []) {
    add(r.first);
    add(r.second);
  }
  for (const r of cr.onlyAInternalDups ?? []) {
    add(r.first);
    add(r.second);
  }
  return m;
}

const SYSTEM_PROMPT = `Ты опытный мерчандайзер интернет-магазина косметики и парфюмерии. Работай **как человек, который вручную открывает две карточки товара рядом** и решает: это одно и то же торговое предложение или две разные позиции. Не своди задачу к совпадению отдельных слов и не считай «формулу», а воспринимай пару как целое.

Для каждой пары:
– **duplicate: true**, если по смыслу это типичное **дублирование в каталоге**: та же пользовательская сущность товара/SKU, второй раз завели карточку, или ты уверена, что это один и тот же продукт.
– **duplicate: false**, если это **разные товары** для покупателя: другой объём или формат, другая линейка или аромат, палитровый вариант, «refill» vs полный флакон и т.п., когда человек ждал бы **отдельные карточки**.

Здравый смысл:
– Одного бренда и общих слов («крем», «spray», «Eau de Parfum») **недостаточно**, если названия задают разные SKU.
– Если из текстов **явно следует два разных аромата, объёмов или линеек** — **не дубль**.
– При сомнении — **duplicate: false** или низкая confidence; в note кратко сформулируй сомнение.

Ответ строго JSON-объект вида:
{"verdicts":[{"idA":number,"idB":number,"duplicate":boolean,"confidence":number,"note":string}]}
confidence от 0 до 1. note — по-русски до 120 символов; пиши **как пояснишь коллеге**, что именно ты увидел в названии и бренде.`;

function verdictsFromOpenAiHttpBody(rawText: string): DupPairVerdict[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error("OpenAI: некорректный JSON ответа");
  }

  const content =
    parsed &&
    typeof parsed === "object" &&
    "choices" in parsed &&
    Array.isArray((parsed as { choices: unknown }).choices)
      ? (parsed as { choices: { message?: { content?: string | unknown } }[] })
          .choices[0]?.message?.content
      : null;

  let text: string | null = null;
  if (typeof content === "string") {
    text = content;
  } else if (Array.isArray(content)) {
    const parts = content as { type?: string; text?: string }[];
    text = parts
      .filter((p) => p && p.type === "text" && typeof p.text === "string")
      .map((p) => p.text)
      .join("\n");
  }

  if (!text || !text.trim()) {
    throw new Error("OpenAI: пустой ответ модели");
  }

  let inner: unknown;
  try {
    inner = JSON.parse(text);
  } catch {
    throw new Error("OpenAI: модель вернула не-JSON в content");
  }

  const verdictsRaw =
    inner &&
    typeof inner === "object" &&
    "verdicts" in inner &&
    Array.isArray((inner as { verdicts: unknown }).verdicts)
      ? (inner as { verdicts: unknown[] }).verdicts
      : null;

  if (!verdictsRaw) {
    throw new Error("OpenAI: нет поля verdicts");
  }

  /** Иначе строка "false" от модели даёт Boolean("false") === true */
  const duplicateFromModel = (v: unknown): boolean => {
    if (v === true || v === 1) return true;
    if (v === false || v === 0 || v == null) return false;
    if (typeof v === "string") {
      const s = v.trim().toLowerCase();
      if (s === "true" || s === "1" || s === "yes" || s === "да") return true;
      if (s === "false" || s === "0" || s === "no" || s === "нет" || s === "")
        return false;
    }
    return false;
  };

  const out: DupPairVerdict[] = [];
  for (const row of verdictsRaw) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    const idA = typeof o.idA === "number" ? o.idA : Number(o.idA);
    const idB = typeof o.idB === "number" ? o.idB : Number(o.idB);
    if (!Number.isFinite(idA) || !Number.isFinite(idB)) continue;
    const duplicate = duplicateFromModel(o.duplicate);
    let confidence = Number(o.confidence);
    if (!Number.isFinite(confidence)) confidence = duplicate ? 0.7 : 0.7;
    confidence = Math.min(1, Math.max(0, confidence));
    const note =
      typeof o.note === "string" ? o.note.slice(0, 200) : undefined;
    out.push({
      pairKey: dupPairKey(Math.floor(idA), Math.floor(idB)),
      duplicate,
      confidence,
      note
    });
  }

  return out;
}

const SYSTEM_PROMPT_VISION = `Ты опытный мерчандайзер интернет-магазина косметики и парфюмерии. Работай **как человек смотрит две карточки подряд на мониторе**: читаешь бренды и полные названия и **разглядываешь присланные превью** (для каждой пары: сначала A, затем B).

Обязательная «выверка»:
– Просмотри оба превью внимательно: **форма и тип упаковки**, цвет, общая расстановка блоков на упаковке, крупные надписи об объёме (мл, g), указание оттенка/линии, знакомые элементы того же SKU.
– Используй **и текст, и изображение** вместе. Если текст говорит о разных SKU, а картинки похожи — чаще **не дубль** (может быть сходная упаковка линии).
– **duplicate: true**, только когда по сумме фото и текста ты уверена, что это **одна и та же позиция** или дважды описан один и тот же товар.
– **duplicate: false**, когда это явно или с высокой вероятностью **разные товары** (аромат/объём/палитра/линейка/refill vs полный объём и т.д.).
– При сильных сомнениях после «осмотра» — **duplicate: false** или низкая confidence; в note можно написать, на что ты смотрел.

Ответ строго JSON-объект вида:
{"verdicts":[{"idA":number,"idB":number,"duplicate":boolean,"confidence":number,"note":string}]}
Один элемент на каждую пару из запроса с теми же idA и idB. confidence от 0 до 1. note — по-русски до 120 символов; где уместно, укажи **что заметила на превью или в тексте**.`;

/** Загрузка превью на нашем сервере: OpenAI часто даёт timeout на CDN витрины. */
const VISION_IMAGE_FETCH_TIMEOUT_MS = 25_000;
const VISION_IMAGE_MAX_BYTES = 2 * 1024 * 1024;

function mimeFromImageMagic(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return "image/gif";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

/**
 * Скачивает изображение по HTTPS/HTTP и возвращает data URL для vision (OpenAI не ходит за URL сами).
 */
async function fetchImageAsDataUrlForVision(remoteUrl: string): Promise<string | null> {
  const u = remoteUrl.trim().slice(0, 2000);
  if (!/^https?:\/\//i.test(u)) return null;

  let res: Response;
  try {
    res = await fetch(u, {
      redirect: "follow",
      headers: { Accept: "image/*,*/*;q=0.8" },
      signal: AbortSignal.timeout(VISION_IMAGE_FETCH_TIMEOUT_MS)
    });
  } catch {
    return null;
  }

  if (!res.ok) return null;

  const cl = res.headers.get("content-length");
  if (cl) {
    const n = Number(cl);
    if (Number.isFinite(n) && n > VISION_IMAGE_MAX_BYTES) return null;
  }

  let buf: ArrayBuffer;
  try {
    buf = await res.arrayBuffer();
  } catch {
    return null;
  }

  if (!buf.byteLength || buf.byteLength > VISION_IMAGE_MAX_BYTES) return null;

  const bytes = new Uint8Array(buf);
  const headerCt = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  const mime =
    headerCt.startsWith("image/") && headerCt.length > 8
      ? headerCt
      : mimeFromImageMagic(bytes) || "image/jpeg";

  const b64 = Buffer.from(buf).toString("base64");
  return `data:${mime};base64,${b64}`;
}

/**
 * Мультимодальный запрос: превью подтягиваются **на сервере приложения** и уходят в OpenAI как data URL,
 * чтобы не зависеть от доступности CDN с инфраструктуры OpenAI.
 * Небольшие чанки на вызов — из‑за лимита изображений и токенов.
 */
export async function refineDupPairsOpenAiVisionBatch(
  apiKey: string,
  pairs: DupPairRefineIn[],
  model = "gpt-4o-mini"
): Promise<DupPairVerdict[]> {
  if (!pairs.length) return [];

  const resolved = await Promise.all(
    pairs.map(async (p) => {
      const ua = p.imageUrlA?.trim();
      const ub = p.imageUrlB?.trim();
      const [dataA, dataB] = await Promise.all([
        ua && /^https?:\/\//i.test(ua)
          ? fetchImageAsDataUrlForVision(ua)
          : Promise.resolve(null),
        ub && /^https?:\/\//i.test(ub)
          ? fetchImageAsDataUrlForVision(ub)
          : Promise.resolve(null)
      ]);
      return { p, dataA, dataB };
    })
  );

  const content: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string; detail: "low" | "high" } }
  > = [
    {
      type: "text",
      text:
        `Это контроль дублей каталога: ${pairs.length} пар. По каждой сначала строки с id и полными названиями, затем превью A (или текст, что его нет), затем превью B — **смотри на обе картинки подряд как при живой верификации**. ` +
        `Верни verdicts по каждой паре.`
    }
  ];

  for (const { p, dataA, dataB } of resolved) {
    content.push({
      type: "text",
      text: `\n---\nПара: idA=${p.idA}, idB=${p.idB}\nlayer: ${p.layer}\nA: ${p.brandA} — ${p.titleA}\nB: ${p.brandB} — ${p.titleB}`
    });
    if (dataA) {
      content.push({
        type: "image_url",
        image_url: { url: dataA, detail: "high" }
      });
    } else if (p.imageUrlA?.trim() && /^https?:\/\//i.test(p.imageUrlA.trim())) {
      content.push({
        type: "text",
        text: "(Превью A не загрузилось на сервере — оцени только по тексту.)"
      });
    } else {
      content.push({ type: "text", text: "(Превью A нет.)" });
    }
    if (dataB) {
      content.push({
        type: "image_url",
        image_url: { url: dataB, detail: "high" }
      });
    } else if (p.imageUrlB?.trim() && /^https?:\/\//i.test(p.imageUrlB.trim())) {
      content.push({
        type: "text",
        text: "(Превью B не загрузилось на сервере — оцени только по тексту.)"
      });
    } else {
      content.push({ type: "text", text: "(Превью B нет.)" });
    }
  }

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      temperature: 0.22,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT_VISION },
        { role: "user", content }
      ]
    })
  });

  const rawText = await res.text();
  if (!res.ok) {
    throw new Error(rawText.slice(0, 400) || `OpenAI HTTP ${res.status}`);
  }

  return verdictsFromOpenAiHttpBody(rawText);
}

export async function refineDupPairsOpenAiBatch(
  apiKey: string,
  pairs: DupPairRefineIn[],
  model = "gpt-4o-mini"
): Promise<DupPairVerdict[]> {
  if (!pairs.length) return [];
  const userPayload = {
    instruction:
      "Сравни каждую пару **как при живом просмотре двух карточек каталога** (две строки ниже для каждых id — это полные названия и бренды). Цельное суждение, не счёт совпадающих слов.",
    pairs: pairs.map((p) => ({
      idA: p.idA,
      idB: p.idB,
      titleA: p.titleA,
      titleB: p.titleB,
      brandA: p.brandA,
      brandB: p.brandB,
      layer: p.layer
    }))
  };

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      temperature: 0.22,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: JSON.stringify(userPayload)
        }
      ]
    })
  });

  const rawText = await res.text();
  if (!res.ok) {
    throw new Error(
      rawText.slice(0, 400) || `OpenAI HTTP ${res.status}`
    );
  }

  return verdictsFromOpenAiHttpBody(rawText);
}

export function looksLikeOpenAiApiKey(k: string): boolean {
  const t = k.trim();
  return t.startsWith("sk-") || t.startsWith("sk-proj-");
}
