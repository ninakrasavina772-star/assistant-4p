"use client";

import { signOut, useSession } from "next-auth/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { mergeBrandLists, parseBrandListFromText } from "@/lib/brand-filter";
import {
  mergeModelLists,
  parseModelListFromText
} from "@/lib/model-filter";
import { parseExcludeProductIdsFromText } from "@/lib/excludeProductIds";
import type {
  CompareProduct,
  CompareResult,
  SingleSiteDupsResult
} from "@/lib/types";
import { ProductCell } from "@/components/ProductCell";
import { AssistantBrand } from "@/components/AssistantBrand";
import { BackToAssistant } from "@/components/BackToAssistant";
import {
  appCompareHeaderCard,
  appSectionCard,
  appSubpageContainer6xl,
  appSubpageRoot,
  homeCardTitle
} from "@/components/homeTheme";
import { RubricCascadeSelect } from "@/components/RubricCascadeSelect";
import { toCompareProduct } from "@/lib/product";

const SK_TOKEN_A = "fp_compare_token_a";
const SK_TOKEN_B = "fp_compare_token_b";
const SK_LABEL_A = "fp_compare_label_a";
const SK_LABEL_B = "fp_compare_label_b";
const SK_REMEMBER = "fp_compare_remember_keys";

/** Как в RubricCascadeSelect — для запроса /api/rubrics */
const MIN_API_TOKEN = 12;

/** Долгие рубрики: после этого срока fetch прервётся, кнопка снова станет активной */
const COMPARE_FETCH_TIMEOUT_MS = 30 * 60 * 1000;

function formatLoadElapsed(totalSec: number) {
  if (totalSec < 60) return `${totalSec} с`;
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m} мин ${s} с`;
}

function isCodeCrossKind(kind: string) {
  return kind === "ean_diff_id" || kind === "article";
}

type DupKindFilter = "all" | "ean" | "nameAttr" | "unlikely";

function crossRowMatchesFilter(kind: string, f: DupKindFilter) {
  if (f === "all") return true;
  if (f === "ean") return isCodeCrossKind(kind);
  if (f === "nameAttr") return kind === "name_photo";
  return kind === "unlikely";
}

function internalRowMatchesFilter(
  kind: "ean" | "name_photo" | "unlikely",
  f: DupKindFilter
) {
  if (f === "all") return true;
  if (f === "ean") return kind === "ean";
  if (f === "nameAttr") return kind === "name_photo";
  return kind === "unlikely";
}

export default function ComparePage() {
  const { data: session, status } = useSession();
  const [rubricA, setRubricA] = useState("");
  const [rubricB, setRubricB] = useState("");
  const [nameLocale, setNameLocale] = useState<"en" | "ru">("ru");
  const [siteVariation, setSiteVariation] = useState("default");
  const [tokenA, setTokenA] = useState("");
  const [tokenB, setTokenB] = useState("");
  const [siteLabelA, setSiteLabelA] = useState("");
  const [siteLabelB, setSiteLabelB] = useState("");
  const [rememberKeys, setRememberKeys] = useState(true);
  const [brandText, setBrandText] = useState("");
  const [modelText, setModelText] = useState("");
  /** id товаров, убрать из каталога A после выгрузки рубрики (до брендов/моделей) */
  const [excludeIdsText, setExcludeIdsText] = useState("");
  /** twoSite — два каталога; singleDups — дубли в одной рубрике (один токен) */
  const [compareMode, setCompareMode] = useState<"twoSite" | "singleDups">("twoSite");
  /** Узкий отчёт или полный экран сравнения (сценарий: сайт A — выборка, B — полный) */
  const [reportView, setReportView] = useState<
    "full" | "notOnA" | "dupsA" | "dupsB" | "crossBvsA"
  >("full");
  /** Показ дублей: все / EAN+арт / название+фото+хар. / мало: фото+хар. */
  const [dupKindFilter, setDupKindFilter] = useState<DupKindFilter>("all");
  /** Дубли на A: внутри рубрики A — или неразм. B↔A (список по id) */
  const [dupScopeA, setDupScopeA] = useState<"intraA" | "unplacedVsA">(
    "intraA"
  );
  const [dupScopeB, setDupScopeB] = useState<"intraB" | "unplacedVsB">(
    "intraB"
  );
  /** Вместе с «название+фото»: учитывать объём / оттенок / цвет в JSON товара */
  const [attrMatch, setAttrMatch] = useState({
    volume: false,
    shade: false,
    color: false
  });
  /** true = brand.name может содержать введённую строку; false = полное совпадение */
  const [brandMatchContains, setBrandMatchContains] = useState(false);
  const [modelMatchContains, setModelMatchContains] = useState(true);
  const [loading, setLoading] = useState(false);
  const [loadElapsed, setLoadElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<CompareResult | SingleSiteDupsResult | null>(null);
  const compareAbortRef = useRef<AbortController | null>(null);
  const userCancelledRef = useRef(false);

  useEffect(() => {
    if (!loading) {
      setLoadElapsed(0);
      return;
    }
    setLoadElapsed(0);
    const id = setInterval(() => {
      setLoadElapsed((e) => e + 1);
    }, 1000);
    return () => clearInterval(id);
  }, [loading]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      setRememberKeys(sessionStorage.getItem(SK_REMEMBER) !== "0");
      const a = sessionStorage.getItem(SK_TOKEN_A);
      const b = sessionStorage.getItem(SK_TOKEN_B);
      if (a) setTokenA(a);
      if (b) setTokenB(b);
      const la = sessionStorage.getItem(SK_LABEL_A);
      const lb = sessionStorage.getItem(SK_LABEL_B);
      if (la) setSiteLabelA(la);
      if (lb) setSiteLabelB(lb);
    } catch {
      // ignore
    }
  }, []);

  const persistKeys = useCallback(
    (nextA: string, nextB: string, nextLa: string, nextLb: string) => {
      if (typeof window === "undefined" || !rememberKeys) return;
      try {
        sessionStorage.setItem(SK_TOKEN_A, nextA);
        sessionStorage.setItem(SK_TOKEN_B, nextB);
        sessionStorage.setItem(SK_LABEL_A, nextLa);
        sessionStorage.setItem(SK_LABEL_B, nextLb);
        sessionStorage.setItem(SK_REMEMBER, "1");
      } catch {
        // ignore
      }
    },
    [rememberKeys]
  );

  const clearStoredKeys = useCallback(() => {
    setTokenA("");
    setTokenB("");
    setSiteLabelA("");
    setSiteLabelB("");
    try {
      sessionStorage.removeItem(SK_TOKEN_A);
      sessionStorage.removeItem(SK_TOKEN_B);
      sessionStorage.removeItem(SK_LABEL_A);
      sessionStorage.removeItem(SK_LABEL_B);
      sessionStorage.setItem(SK_REMEMBER, "0");
    } catch {
      // ignore
    }
    setRememberKeys(false);
  }, []);

  const cancelRun = useCallback(() => {
    userCancelledRef.current = true;
    compareAbortRef.current?.abort();
  }, []);

  const run = useCallback(async () => {
    userCancelledRef.current = false;
    setError(null);
    setData(null);
    setLoading(true);
    const ac = new AbortController();
    compareAbortRef.current = ac;
    const timeoutId = window.setTimeout(() => {
      ac.abort();
    }, COMPARE_FETCH_TIMEOUT_MS);
    try {
      if (rememberKeys) {
        persistKeys(tokenA, tokenB, siteLabelA, siteLabelB);
      }
      const brandList = parseBrandListFromText(brandText);
      const modelList = parseModelListFromText(modelText);
      const excludeList = parseExcludeProductIdsFromText(excludeIdsText);
      const res = await fetch("/api/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ac.signal,
        body: JSON.stringify({
          mode: compareMode === "singleDups" ? "singleDups" : undefined,
          rubricA: Number(rubricA),
          rubricB: Number(rubricB),
          nameLocale,
          siteVariation,
          tokenA: tokenA.trim() || undefined,
          tokenB: tokenB.trim() || undefined,
          siteALabel: siteLabelA.trim() || undefined,
          siteBLabel: siteLabelB.trim() || undefined,
          brands: brandList.length > 0 ? brandList : undefined,
          brandMatch: brandMatchContains ? "contains" : "exact",
          models: modelList.length > 0 ? modelList : undefined,
          modelMatch: modelMatchContains ? "contains" : "exact",
          excludeIdsA: excludeList.length > 0 ? excludeList : undefined,
          attrMatch:
            attrMatch.volume || attrMatch.shade || attrMatch.color
              ? {
                  volume: attrMatch.volume,
                  shade: attrMatch.shade,
                  color: attrMatch.color
                }
              : undefined
        })
      });
      const json = (await res.json()) as
        | (CompareResult & { error?: string })
        | (SingleSiteDupsResult & { error?: string });
      if (!res.ok) {
        setError("error" in json && json.error ? json.error : `Ошибка ${res.status}`);
        return;
      }
      if ("error" in json && json.error) {
        setError(String(json.error));
        return;
      }
      setData(json as CompareResult | SingleSiteDupsResult);
    } catch (e) {
      const isAbort = e instanceof Error && e.name === "AbortError";
      if (isAbort) {
        setError(
          userCancelledRef.current
            ? "Сравнение отменено."
            : "Слишком долго: запрос остановлен (тайм‑аут 30 мин). Сузьте рубрику, списки брендов/моделей или повторите позже."
        );
      } else {
        setError(e instanceof Error ? e.message : "Сеть");
      }
    } finally {
      clearTimeout(timeoutId);
      compareAbortRef.current = null;
      userCancelledRef.current = false;
      setLoading(false);
    }
  }, [
    rubricA,
    rubricB,
    nameLocale,
    siteVariation,
    tokenA,
    tokenB,
    siteLabelA,
    siteLabelB,
    rememberKeys,
    persistKeys,
    brandText,
    modelText,
    excludeIdsText,
    compareMode,
    brandMatchContains,
    modelMatchContains,
    attrMatch
  ]);

  const brandListCount = useMemo(
    () => parseBrandListFromText(brandText).length,
    [brandText]
  );

  const modelListCount = useMemo(
    () => parseModelListFromText(modelText).length,
    [modelText]
  );

  const excludeIdsListCount = useMemo(
    () => parseExcludeProductIdsFromText(excludeIdsText).length,
    [excludeIdsText]
  );

  /**
   * Ключ B в поле часто пустой (тот же магазин, второй в .env). API сравнения
   * подставит .env, но каскад рубрик B раньше не работал без client token — вторая
   * рубрика не выбиралась, кнопка «Сравнить» оставалась disabled.
   */
  const tokenForRubricsB = useMemo(() => {
    if (tokenB.trim().length >= MIN_API_TOKEN) return tokenB;
    if (tokenA.trim().length >= MIN_API_TOKEN) return tokenA;
    return "";
  }, [tokenA, tokenB]);

  const rubricAOk = Number(rubricA) > 0;
  const rubricBOk = Number(rubricB) > 0;

  const comparePrimaryDisabled =
    loading ||
    !rubricAOk ||
    (compareMode === "twoSite" && !rubricBOk);

  const compareDisabledHint = !loading
    ? !rubricAOk
      ? "Кнопка ожидает числовой id рубрики A: выберите в списке выше или введите вручную в поле «Прямой ввод id». Нужен ключ API 12+ симв. в поле A, чтобы подгрузились рубрики."
      : compareMode === "twoSite" && !rubricBOk
        ? "Введите id рубрики B (каскад или поле «Прямой ввод»). Если ключ B пуст, список B строится по ключу A."
        : null
    : null;

  const isSingleDups = (
    d: CompareResult | SingleSiteDupsResult | null
  ): d is SingleSiteDupsResult =>
    d != null && "resultKind" in d && d.resultKind === "singleSiteDups";

  type CrossBvsARow = {
    kind: "ean_diff_id" | "name_photo" | "article" | "unlikely";
    onA: CompareProduct;
    fromB: CompareProduct;
    ean?: string;
    article?: string;
    score?: number;
    matchReasons?: string[];
  };

  /** Список «нет на A» (только B) vs полный каталог A: onlyBCrossWithA */
  const crossBvsARows = useMemo((): CrossBvsARow[] => {
    if (!data || "resultKind" in data) return [];
    return (data.onlyBCrossWithA ?? []).map((r) => ({
      kind: r.kind,
      onA: r.productOnA,
      fromB: r.productFromOnlyB,
      ean: r.ean,
      article: r.article,
      score: r.score,
      matchReasons: r.matchReasons
    }));
  }, [data]);

  const onlyACrossWithBFiltered = useMemo(() => {
    if (!data || "resultKind" in data) return [];
    const rows = data.onlyACrossWithB ?? [];
    return rows.filter((r) => crossRowMatchesFilter(r.kind, dupKindFilter));
  }, [data, dupKindFilter]);

  const showEanSections =
    dupKindFilter === "all" || dupKindFilter === "ean";
  const showNameAttrSections =
    dupKindFilter === "all" || dupKindFilter === "nameAttr";
  const showUnlikelySections =
    dupKindFilter === "all" || dupKindFilter === "unlikely";

  const crossBvsARowsFiltered = useMemo((): CrossBvsARow[] => {
    return crossBvsARows.filter((r) => crossRowMatchesFilter(r.kind, dupKindFilter));
  }, [crossBvsARows, dupKindFilter]);

  const onlyBCrossWithAFiltered = useMemo(() => {
    if (!data || "resultKind" in data) return [];
    const rows = data.onlyBCrossWithA ?? [];
    return rows.filter((r) => crossRowMatchesFilter(r.kind, dupKindFilter));
  }, [data, dupKindFilter]);

  const onlyBInternalDupsFiltered = useMemo(() => {
    if (!data || "resultKind" in data) return [];
    const rows = data.onlyBInternalDups ?? [];
    return rows.filter((r) => internalRowMatchesFilter(r.kind, dupKindFilter));
  }, [data, dupKindFilter]);

  const onlyAInternalDupsFiltered = useMemo(() => {
    if (!data || "resultKind" in data) return [];
    const rows = data.onlyAInternalDups ?? [];
    return rows.filter((r) => internalRowMatchesFilter(r.kind, dupKindFilter));
  }, [data, dupKindFilter]);

  const unplacedBList = useMemo((): CompareProduct[] => {
    if (!data || "resultKind" in data) return [];
    return (data.unplacedBByIdRaw ?? []).map((p) => toCompareProduct(p));
  }, [data]);

  const downloadOnlyBExcel = useCallback(async () => {
    if (!data || !("rawOnlyB" in data) || !data.rawOnlyB?.length) return;
    setError(null);
    try {
      const { downloadOnlyBAsExcel } = await import("@/lib/exportOnlyB");
      await downloadOnlyBAsExcel(
        data.rawOnlyB,
        data.nameLocale,
        data.siteBLabel || "site_B"
      );
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Не удалось сформировать Excel (нужен пакет xlsx: npm install)"
      );
    }
  }, [data]);

  const downloadNotOnAExcel = useCallback(async () => {
    if (!data || "resultKind" in data) return;
    const raw = data.unplacedBByIdRaw;
    if (!raw?.length) return;
    setError(null);
    try {
      const { downloadNerazmeshennyeSiteAExcel } = await import(
        "@/lib/exportOnlyB"
      );
      await downloadNerazmeshennyeSiteAExcel(
        raw,
        data.nameLocale,
        data.siteBLabel || "B"
      );
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Не удалось сформировать Excel (нужен пакет xlsx: npm install)"
      );
    }
  }, [data]);

  const onBrandFile = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      e.target.value = "";
      if (!f) return;
      setError(null);
      try {
        const { extractBrandsFromFile } = await import("@/lib/brandFileImport");
        const fromFile = await extractBrandsFromFile(f);
        setBrandText((prev) => {
          const cur = parseBrandListFromText(prev);
          return mergeBrandLists(cur, fromFile).join("\n");
        });
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Не удалось прочитать файл (нужен пакет xlsx: npm install)"
        );
      }
    },
    []
  );

  const onModelFile = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      e.target.value = "";
      if (!f) return;
      setError(null);
      try {
        const { extractBrandsFromFile } = await import("@/lib/brandFileImport");
        const fromFile = await extractBrandsFromFile(f);
        setModelText((prev) => {
          const cur = parseModelListFromText(prev);
          return mergeModelLists(cur, fromFile).join("\n");
        });
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Не удалось прочитать файл (нужен пакет xlsx: npm install)"
        );
      }
    },
    []
  );

  const onExcludeIdsFile = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      e.target.value = "";
      if (!f) return;
      setError(null);
      try {
        const { extractProductIdsFromFile } = await import(
          "@/lib/excludeIdsFileImport"
        );
        const fromFile = await extractProductIdsFromFile(f);
        setExcludeIdsText((prev) => {
          const cur = parseExcludeProductIdsFromText(prev);
          const seen = new Set<number>([...cur, ...fromFile]);
          return Array.from(seen).join("\n");
        });
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Не удалось прочитать файл (нужен пакет xlsx: npm install)"
        );
      }
    },
    []
  );

  return (
    <div className={appSubpageRoot}>
      <div className={appSubpageContainer6xl}>
      <header className={appCompareHeaderCard}>
        <div className="max-w-2xl">
          <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            <AssistantBrand size="compact" />
            <BackToAssistant />
          </div>
          <p className={`${homeCardTitle} mb-1`}>
            Сравнение витрин
          </p>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
            Сравнение рубрик
          </h1>
          <p className="text-sm text-slate-600 mt-2 leading-relaxed">
            Сначала сопоставляем по <strong>штрихкоду (EAN)</strong> и{" "}
            <strong>артикулу</strong> из API — это надёжные «якоря». Затем — по бренду и
            <strong> модельной части названия</strong> + фото: одинаковый URL картинки, либо
            одна «семья» карточки (суффикс <code className="text-[11px]">-a…</code> в ссылке) и
            совпадение объёма. Галки объём/цвет/оттенок в форме ужесточают пары. Ключи — в
            форме или{" "}
            <code className="text-xs bg-white/80 px-1.5 py-0.5 rounded border border-slate-200">.env</code>
            .
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 text-sm">
          {status === "loading" && (
            <span className="text-xs text-amber-700">Проверка сессии…</span>
          )}
          <span className="text-slate-600 truncate max-w-[200px]">
            {status === "loading" ? "—" : session?.user?.email ? (
              session.user.email
            ) : (
              <span className="text-amber-700">не вошли</span>
            )}
          </span>
          {session?.user && (
            <button
              type="button"
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="text-slate-500 hover:text-slate-800"
            >
              Выйти
            </button>
          )}
        </div>
      </header>

      <section className={appSectionCard}>
        <h2 className="text-sm font-semibold text-slate-800 mb-3">
          Ключи API (4Partners) и подписи
        </h2>
        <p className="text-xs text-slate-500 mb-3">
          Один токен — одна витрина. Для двух магазинов — два ключа. Если оставить
          пустым, будут взяты значения из <code className="bg-slate-100 px-1">.env</code>{" "}
          (если заданы).
        </p>
        <div className="mb-4 rounded-lg border border-slate-200/90 bg-slate-50/90 px-3 py-2.5 text-[11px] text-slate-600 leading-relaxed">
          <p className="font-semibold text-slate-700 mb-1.5">Что значат сайт A и сайт B</p>
          <ul className="list-disc pl-4 space-y-1">
            <li>
              <strong className="text-slate-800">Сайт A</strong> — опорная витрина: от неё
              берётся первая рубрика и основной каталог в отчёте. Исключение товаров по
              списку id, фильтры по бренду и модели в первую очередь относятся к
              выгрузке A. В сценарии «узкая рубрика на A и полный каталог на B» это
              обычно сторона A.
            </li>
            <li>
              <strong className="text-slate-800">Сайт B</strong> — вторая витрина: с ней
              сопоставляют A (что на обеих, что только на A или только на B). Нужен
              режим «два магазина»; в режиме «дубли в одной рубрике» используется
              только ключ и рубрика A, поле B не участвует.
            </li>
          </ul>
        </div>
        <div className="grid sm:grid-cols-2 gap-4 mb-3">
          <label className="block">
            <span
              className="text-xs font-medium text-slate-500"
              title="Первая витрина: рубрика A, список id на исключение, фильтры — к каталогу A"
            >
              Ключ API, сайт A (X-Auth-Token)
            </span>
            <input
              type="password"
              className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono"
              value={tokenA}
              onChange={(e) => setTokenA(e.target.value)}
              onBlur={() =>
                rememberKeys && persistKeys(tokenA, tokenB, siteLabelA, siteLabelB)
              }
              autoComplete="off"
              spellCheck={false}
              placeholder="вставьте токен или пусто = .env"
            />
          </label>
          <label className="block">
            <span
              className={`text-xs font-medium ${
                compareMode === "singleDups" ? "text-slate-300" : "text-slate-500"
              }`}
              title={
                compareMode === "singleDups"
                  ? "В режиме дублей в одной рубрике не используется"
                  : "Вторая витрина для сопоставления с A"
              }
            >
              Ключ API, сайт B
            </span>
            <input
              type="password"
              className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono disabled:bg-slate-50 disabled:text-slate-400"
              value={tokenB}
              onChange={(e) => setTokenB(e.target.value)}
              onBlur={() =>
                rememberKeys && persistKeys(tokenA, tokenB, siteLabelA, siteLabelB)
              }
              autoComplete="off"
              spellCheck={false}
              placeholder="второй тот же, если та же площадка"
              disabled={compareMode === "singleDups"}
            />
          </label>
        </div>
        <div className="grid sm:grid-cols-2 gap-4 mb-3">
          <label className="block">
            <span
              className="text-xs font-medium text-slate-500"
              title="Как подписать колонку/витрину A в отчётах"
            >
              Подпись в таблице, сайт A
            </span>
            <input
              className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
              value={siteLabelA}
              onChange={(e) => setSiteLabelA(e.target.value)}
              onBlur={() =>
                rememberKeys && persistKeys(tokenA, tokenB, siteLabelA, siteLabelB)
              }
              placeholder="например: Рив Гош"
            />
          </label>
          <label className="block">
            <span
              className="text-xs font-medium text-slate-500"
              title="Как подписать витрину B в отчётах (режим двух магазинов)"
            >
              Подпись, сайт B
            </span>
            <input
              className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
              value={siteLabelB}
              onChange={(e) => setSiteLabelB(e.target.value)}
              onBlur={() =>
                rememberKeys && persistKeys(tokenA, tokenB, siteLabelA, siteLabelB)
              }
              placeholder="второй магазин"
            />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-4 mb-4 text-sm">
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={rememberKeys}
              onChange={(e) => {
                const v = e.target.checked;
                setRememberKeys(v);
                if (!v) {
                  try {
                    sessionStorage.setItem(SK_REMEMBER, "0");
                  } catch {
                    // ignore
                  }
                } else {
                  persistKeys(tokenA, tokenB, siteLabelA, siteLabelB);
                }
              }}
            />
            <span className="text-slate-600">
              Сохранять в браузере (sessionStorage, до закрытия окна)
            </span>
          </label>
          <button
            type="button"
            onClick={clearStoredKeys}
            className="text-slate-500 hover:text-slate-800 underline text-sm"
          >
            Очистить ключи и подписи
          </button>
        </div>

        <h2 className="text-sm font-semibold text-slate-800 mb-2 mt-6">Режим</h2>
        <div className="flex flex-wrap gap-4 mb-4 text-sm">
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="compareMode"
              checked={compareMode === "twoSite"}
              onChange={() => setCompareMode("twoSite")}
            />
            <span>Два магазина (сравнение A и B)</span>
          </label>
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="compareMode"
              checked={compareMode === "singleDups"}
              onChange={() => setCompareMode("singleDups")}
            />
            <span>Дубли в одной рубрике (один сайт, один ключ A)</span>
          </label>
        </div>

        <h2 className="text-sm font-semibold text-slate-800 mb-3">Рубрики</h2>
        <p className="text-xs text-slate-500 mb-3">
          Рубрика <strong>A</strong> — каталог первой витрины, рубрика{" "}
          <strong>B</strong> — второй (при сравнении A и B). Только{" "}
          <strong>активные</strong> рубрики. Сначала верхний уровень, затем при
          необходимости — вложенные (подгружаются по выбору).{" "}
          {compareMode === "twoSite" && (
            <>
              <strong>Два магазина:</strong> если поле ключа B пусто, под список
              рубрик B подставляется <strong>тот же ключ, что в поле A</strong> (как
              на сервере при сравнении с .env).
            </>
          )}
        </p>
        <div
          className={`grid gap-4 mb-4 ${
            compareMode === "twoSite" ? "sm:grid-cols-2" : ""
          }`}
        >
          <RubricCascadeSelect
            label={
              compareMode === "singleDups"
                ? "Рубрика"
                : "Рубрика, сайт A"
            }
            token={tokenA}
            value={rubricA}
            onChange={setRubricA}
          />
          {compareMode === "twoSite" && (
            <RubricCascadeSelect
              label="Рубрика, сайт B"
              token={tokenForRubricsB}
              value={rubricB}
              onChange={setRubricB}
            />
          )}
        </div>
        <div className="mb-4 rounded-xl border border-dashed border-slate-200 bg-slate-50/80 p-3">
          <p className="text-xs font-semibold text-slate-800 mb-1">
            Прямой ввод id рубрики
          </p>
          <p className="text-[11px] text-slate-500 mb-2">
            В каскаде — последний выбранный id. Если не хотите кликать по дереву,
            введите число (из админки / API) — сравнение использует эти id.
            Кнопка «Сравнить» <strong>не сработает</strong>, пока A (и B в двух
            витринах) пусто или не положительное число.
          </p>
          <div
            className={`grid gap-3 ${
              compareMode === "twoSite" ? "sm:grid-cols-2" : ""
            }`}
          >
            <label className="block">
              <span className="text-xs text-slate-600">
                Id рубрики{compareMode === "twoSite" ? " (сайт A)" : ""}
              </span>
              <input
                type="text"
                inputMode="numeric"
                className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono"
                value={rubricA}
                onChange={(e) => setRubricA(e.target.value.replace(/\D/g, ""))}
                placeholder="только цифры, например 12345"
                spellCheck={false}
                autoComplete="off"
              />
            </label>
            {compareMode === "twoSite" && (
              <label className="block">
                <span className="text-xs text-slate-600">Id рубрики (сайт B)</span>
                <input
                  type="text"
                  inputMode="numeric"
                  className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono"
                  value={rubricB}
                  onChange={(e) => setRubricB(e.target.value.replace(/\D/g, ""))}
                  placeholder="только цифры"
                  spellCheck={false}
                  autoComplete="off"
                />
              </label>
            )}
          </div>
          <p className="mt-2 text-[11px] text-slate-600">
            Статус: A —{" "}
            <strong className={rubricAOk ? "text-emerald-700" : "text-amber-800"}>
              {rubricAOk ? `готово (id ${rubricA})` : "нужен id > 0"}
            </strong>
            {compareMode === "twoSite" && (
              <>
                {" "}
                · B —{" "}
                <strong
                  className={rubricBOk ? "text-emerald-700" : "text-amber-800"}
                >
                  {rubricBOk ? `готово (id ${rubricB})` : "нужен id > 0"}
                </strong>
              </>
            )}
          </p>
        </div>
        <div className="grid sm:grid-cols-2 gap-4 mb-4">
          <label className="block">
            <span className="text-xs font-medium text-slate-500">
              Сопоставлять по названию (если EAN нет/не сматчилось)
            </span>
            <select
              className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
              value={nameLocale}
              onChange={(e) => setNameLocale(e.target.value as "en" | "ru")}
            >
              <option value="ru">Название (RU) — i18n.ru, иначе базовое</option>
              <option value="en">Название (EN) — i18n.en, иначе базовое</option>
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-500">
              Site variation (как в API)
            </span>
            <input
              className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
              value={siteVariation}
              onChange={(e) => setSiteVariation(e.target.value || "default")}
              placeholder="default"
            />
          </label>
        </div>

        {(compareMode === "twoSite" || compareMode === "singleDups") && (
          <div className="mb-4 p-3 rounded-lg border border-slate-200 bg-slate-50/90 text-xs text-slate-700">
            {compareMode === "twoSite" && (
              <p className="mb-2">
                <strong>Обычный сценарий сравнения:</strong> в рубрику <strong>сайта A</strong>{" "}
                заведите <strong>часть</strong> товара, в рубрику <strong>сайта B</strong> —{" "}
                <strong>полный</strong> каталог. Пары строим по EAN и по названию+фото
                (одинаковый URL первой картинки, если нет EAN). Далее: список{" "}
                <strong>«нет товаров на сайте A»</strong> = позиции из B, с которыми в A не
                нашлось пары.
              </p>
            )}
            <p className="text-slate-600 mb-2">
              Для пар <strong>название + фото</strong>: галочки объём / оттенок / цвет
              ужесточают отбор — если <strong>на обоих</strong> товарах поле задано и
              значения <strong>различаются</strong>, такая пара отбрасывается. Объём
              сначала берётся из полей в JSON, при отсутствии — <strong>из названия и
              описания</strong> (шаблоны вроде «50 мл», «30ml», «100 oz», «Размер 50
              мл»; число + единица нормализуются при сравнении).
            </p>
            <p className="text-slate-600 mb-2">
              Секция <strong>«маловероятные»</strong> считается отдельно: одно и то же
              первое фото (URL) и сходство «модельной» части названия не ниже 60%. У
              этой ветки галочки не обязательны. Если отметить объём/оттенок/цвет, к
              подписи пары добавятся пояснения (нормализация чисел и единиц, например
              50&nbsp;мл и 50&nbsp;ml — как одно; при разных объёмах в подписи будет
              «объём: различается», сама пара остаётся).
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={attrMatch.volume}
                  onChange={(e) =>
                    setAttrMatch((m) => ({ ...m, volume: e.target.checked }))
                  }
                />
                объём
              </label>
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={attrMatch.shade}
                  onChange={(e) =>
                    setAttrMatch((m) => ({ ...m, shade: e.target.checked }))
                  }
                />
                оттенок
              </label>
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={attrMatch.color}
                  onChange={(e) =>
                    setAttrMatch((m) => ({ ...m, color: e.target.checked }))
                  }
                />
                цвет
              </label>
            </div>
            <p className="text-[11px] text-slate-500 mt-2">
              Изменения вступают в силу после нового нажатия «Сравнить» / «Найти дубли».
            </p>
          </div>
        )}

        <h2 className="text-sm font-semibold text-slate-800 mb-2 mt-6">
          Бренды (по желанию)
        </h2>
        <p className="text-xs text-slate-500 mb-2">
          Пустое поле — вся рубрика. Если указать бренды, останутся товары с
          непустым <code className="bg-slate-100 px-0.5">brand.name</code> в API.
          Без бренда в API товар не попадёт в выборку.
        </p>
        <label className="inline-flex items-center gap-2 text-sm text-slate-700 mb-2 cursor-pointer">
          <input
            type="checkbox"
            checked={brandMatchContains}
            onChange={(e) => setBrandMatchContains(e.target.checked)}
          />
          <span>
            Вхождение в название бренда (часть слова, не только полное совпадение)
          </span>
        </label>
        <textarea
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono min-h-[120px] mb-2"
          value={brandText}
          onChange={(e) => setBrandText(e.target.value)}
          placeholder={"La Roche-Posay\nVichy\nCeraVe\nили в одну строку: A, B; C"}
          spellCheck={false}
        />
        <div className="flex flex-wrap items-center gap-3 mb-2 text-sm">
          <input
            type="file"
            accept=".xlsx,.xls,.xlsm,.csv,.txt"
            onChange={onBrandFile}
            className="text-slate-700 text-xs max-w-full"
          />
          <span className="text-xs text-slate-500">
            Excel: один бренд на строку в <strong>первом столбце</strong> первого листа.
            Можно также CSV/TXT.
          </span>
        </div>
        {brandListCount > 0 && (
          <p className="text-xs text-slate-600 mb-3">
            В списке: {brandListCount} бренд(ов)
          </p>
        )}

        <h2 className="text-sm font-semibold text-slate-800 mb-2 mt-6">
          Модели (по желанию)
        </h2>
        <p className="text-xs text-slate-500 mb-2">
          Список подстрок для отбора товаров <strong>в выбранных рубриках</strong> после
          загрузки каталога. Сопоставление идёт с RU/EN названием и &quot;модельной&quot;
          частью (без типа &laquo;парфюм&raquo; и дублирования бренда), без учёта регистра. Пустое поле
          — не фильтруем по моделям.
        </p>
        <label className="inline-flex items-center gap-2 text-sm text-slate-700 mb-2 cursor-pointer">
          <input
            type="checkbox"
            checked={modelMatchContains}
            onChange={(e) => setModelMatchContains(e.target.checked)}
          />
          <span>
            Вхождение в название (ищем строку внутри полного заголовка; снимите — только полное
            совпадение с модельной частью или целым названием)
          </span>
        </label>
        <textarea
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono min-h-[100px] mb-2"
          value={modelText}
          onChange={(e) => setModelText(e.target.value)}
          placeholder={"ARGAN SUBLIME\nMan Aqua\n— по одной модели в строке"}
          spellCheck={false}
        />
        <div className="flex flex-wrap items-center gap-3 mb-2 text-sm">
          <input
            type="file"
            accept=".xlsx,.xls,.xlsm,.csv,.txt"
            onChange={onModelFile}
            className="text-slate-700 text-xs max-w-full"
          />
          <span className="text-xs text-slate-500">
            Файл: как у брендов — первый столбец, одна модель в строке.
          </span>
        </div>
        {modelListCount > 0 && (
          <p className="text-xs text-slate-600 mb-3">
            В списке: {modelListCount} строк(и)
          </p>
        )}

        <h2 className="text-sm font-semibold text-slate-800 mb-2 mt-6">
          Исключить id с сайта A (по желанию)
        </h2>
        <p className="text-xs text-slate-500 mb-2">
          После загрузки рубрики A из API эти <strong>id товаров</strong> убираются из
          выборки. Далее к оставшемуся на A применяются бренды и модели. Сайт B не
          фильтруется этим списком.
        </p>
        <textarea
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono min-h-[100px] mb-2"
          value={excludeIdsText}
          onChange={(e) => setExcludeIdsText(e.target.value)}
          placeholder={"12345\n23456\nили: 1,2;3"}
          spellCheck={false}
        />
        <div className="flex flex-wrap items-center gap-3 mb-2 text-sm">
          <input
            type="file"
            accept=".xlsx,.xls,.xlsm,.csv,.txt"
            onChange={onExcludeIdsFile}
            className="text-slate-700 text-xs max-w-full"
          />
          <span className="text-xs text-slate-500">
            Excel/CSV/TXT: id в <strong>первом столбце</strong> (как у брендов/моделей).
            Загрузка <strong>добавляет</strong> к полю, без дублей.
          </span>
        </div>
        {excludeIdsListCount > 0 && (
          <p className="text-xs text-slate-600 mb-3">
            Уникальных id в поле: {excludeIdsListCount}
          </p>
        )}

        {error && (
          <p className="text-sm text-red-600 mb-3">{error}</p>
        )}
        {compareDisabledHint && (
          <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200/80 rounded-lg px-3 py-2 mb-3">
            {compareDisabledHint}
          </p>
        )}
        <div className="flex flex-col gap-2 items-start">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={run}
              disabled={comparePrimaryDisabled}
              title={
                comparePrimaryDisabled
                  ? "Сначала укажите id рубрик (см. поля выше) или дождитесь загрузки"
                  : "Запустить сравнение"
              }
              className="rounded-xl bg-[#ffd740] text-[#0a0a0a] border border-black/10 px-5 py-2.5 text-sm font-bold shadow-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#f5cd38] cursor-pointer"
            >
              {loading
                ? "Загрузка…"
                : compareMode === "singleDups"
                  ? "Найти дубли"
                  : "Сравнить"}
            </button>
            {loading && (
              <button
                type="button"
                onClick={cancelRun}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:border-slate-400 hover:bg-slate-50"
              >
                Отменить
              </button>
            )}
          </div>
          {loading && (
            <>
              <p className="text-xs text-slate-500 max-w-xl leading-relaxed">
                Сначала выгружаются все товары по рубрикам из API (много запросов с
                пагинацией), затем сопоставление. На больших витринах это нормально
                длится от десятков секунд до нескольких минут. Страница не
                «зависла»: таймер ниже тикает, работа идёт на сервере. Сузьте
                рубрику или список брендов — так быстрее. Не закрывайте вкладку — дождитесь
                отчёта. Если слишком долго — кнопка{" "}
                <strong>Отменить</strong> (или тайм‑аут 30 мин) вернёт форму.
              </p>
              <p className="text-xs font-medium text-amber-900/80">
                Идёт запрос: {formatLoadElapsed(loadElapsed)}
              </p>
            </>
          )}
        </div>
      </section>

      {data && isSingleDups(data) && (() => {
        const cEan = data.eanGroups.length;
        const cName = data.namePhotoPairs.length;
        const cUnl = data.unlikelyPairs?.length ?? 0;
        const cAllBlocks = cEan + cName + cUnl;
        return (
        <>
          <div className="flex flex-wrap gap-4 text-sm text-slate-700 mb-6 p-4 rounded-xl bg-white border border-slate-200">
            <span>
              <strong>{data.siteLabel}</strong>, рубрика {data.rubricId}:{" "}
              {data.stats.count} товаров
            </span>
            <span className="text-amber-800">
              Групп EAN-дублей: {cEan}
            </span>
            <span className="text-amber-800">
              Пар имя+фото: {cName}
            </span>
            <span className="text-amber-800">
              Маловероятных: {cUnl}
            </span>
            <span className="text-slate-600 border-l border-slate-200 pl-4">
              Всего блоков в отчёте:{" "}
              <strong className="text-slate-900 tabular-nums">{cAllBlocks}</strong>{" "}
              <span className="text-slate-500">({cEan}+{cName}+{cUnl})</span>
            </span>
          </div>

          <div className="mb-6 p-4 rounded-xl border border-amber-200/80 bg-amber-50/40 text-sm">
            <p className="text-xs text-slate-600 mb-2">
              Что показывать: дубли <strong>по EAN</strong> и/или{" "}
              <strong>по названию + фото</strong>
              <span className="text-slate-500">
                {" "}
                — счётчики: EAN <strong className="tabular-nums text-slate-700">{cEan}</strong>, имя+фото{" "}
                <strong className="tabular-nums text-slate-700">{cName}</strong>, маловероятн.{" "}
                <strong className="tabular-nums text-slate-700">{cUnl}</strong>
              </span>
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setDupKindFilter("all")}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                  dupKindFilter === "all"
                    ? "bg-amber-800 text-white"
                    : "bg-white border border-slate-200 text-slate-800"
                }`}
              >
                Все ({cAllBlocks})
              </button>
              <button
                type="button"
                onClick={() => setDupKindFilter("ean")}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                  dupKindFilter === "ean"
                    ? "bg-amber-800 text-white"
                    : "bg-white border border-slate-200 text-slate-800"
                }`}
              >
                Только EAN ({cEan})
              </button>
              <button
                type="button"
                onClick={() => setDupKindFilter("nameAttr")}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                  dupKindFilter === "nameAttr"
                    ? "bg-amber-800 text-white"
                    : "bg-white border border-slate-200 text-slate-800"
                }`}
              >
                Название + фото + хар. ({cName})
              </button>
              <button
                type="button"
                onClick={() => setDupKindFilter("unlikely")}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                  dupKindFilter === "unlikely"
                    ? "bg-amber-800 text-white"
                    : "bg-white border border-slate-200 text-slate-800"
                }`}
              >
                Маловероятные ({cUnl})
              </button>
            </div>
          </div>

          {data.brandFilter?.enabled && (
            <div className="mb-6 p-4 rounded-xl border border-amber-200/80 bg-amber-50/50 text-sm text-slate-800">
              <h3 className="font-semibold text-amber-900 mb-2">
                Фильтр по брендам
              </h3>
              <p className="text-xs text-slate-600 mb-2">
                Режим:{" "}
                <strong>
                  {data.brandFilter.matchMode === "contains"
                    ? "вхождение подстроки"
                    : "точное совпадение"}
                </strong>
                . По {data.brandFilter.totalBrands} бренд(ам). Без бренда в API —{" "}
                {data.brandFilter.excludedMissingBrandA}, не подошло по списку —{" "}
                {data.brandFilter.excludedNotInListA}.
              </p>
              {data.brandFilter.brandsSample.length > 0 && (
                <p className="text-xs text-slate-500 break-words">
                  Примеры: {data.brandFilter.brandsSample.join(", ")}
                  {data.brandFilter.totalBrands > data.brandFilter.brandsSample.length
                    ? "…"
                    : ""}
                </p>
              )}
            </div>
          )}

          {data.modelFilter?.enabled && (
            <div className="mb-6 p-4 rounded-xl border border-sky-200/80 bg-sky-50/50 text-sm text-slate-800">
              <h3 className="font-semibold text-sky-900 mb-2">
                Фильтр по списку моделей
              </h3>
              <p className="text-xs text-slate-600 mb-2">
                Режим:{" "}
                <strong>
                  {data.modelFilter.matchMode === "contains"
                    ? "вхождение в название"
                    : "точное совпадение с модельной частью / полным названием"}
                </strong>
                . Учтено строк в списке: {data.modelFilter.totalModels}. Отфильтровано как
                не подошедшие: {data.modelFilter.excludedNotInListA}.
              </p>
              {data.modelFilter.modelsSample.length > 0 && (
                <p className="text-xs text-slate-500 break-words">
                  Примеры: {data.modelFilter.modelsSample.join(", ")}
                  {data.modelFilter.totalModels > data.modelFilter.modelsSample.length
                    ? "…"
                    : ""}
                </p>
              )}
            </div>
          )}

          {data.excludeIdsA?.enabled && (
            <div className="mb-6 p-4 rounded-xl border border-rose-200/80 bg-rose-50/50 text-sm text-slate-800">
              <h3 className="font-semibold text-rose-900 mb-2">
                Исключение по id (сайт A)
              </h3>
              <p className="text-xs text-slate-600">
                В списке было {data.excludeIdsA.listSize} id. Убрано из рубрики A —{" "}
                <strong className="tabular-nums text-slate-800">
                  {data.excludeIdsA.removedFromA}
                </strong>
                . В рубрике не найдено (возможна опечатка) —{" "}
                {data.excludeIdsA.listIdsNotFoundInRubric}.
              </p>
            </div>
          )}

          {showEanSections && (
          <section className="mb-10" id="intra-ean">
            <h2 className="text-lg font-semibold text-slate-900 mb-2">
              Один EAN — несколько разных id{" "}
              <span className="text-amber-800 tabular-nums">({cEan})</span>
            </h2>
            <p className="text-xs text-slate-500 mb-3">
              Два столбца: разные карточки в одной строке. Полное совпадение по штрихкоду.
            </p>
            {data.eanGroups.length === 0 && (
              <p className="text-sm text-slate-500">Нет</p>
            )}
            <div className="space-y-6">
              {data.eanGroups.map((g) => (
                <div
                  key={g.ean}
                  className="rounded-xl border border-slate-200 bg-white p-4"
                >
                  <p className="text-xs font-mono text-slate-600 mb-3">EAN {g.ean}</p>
                  <div className="grid sm:grid-cols-2 gap-4">
                    {g.products.map((c) => (
                      <div key={c.id} className="min-w-0">
                        <ProductCell c={c} siteLabel={data.siteLabel} />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
          )}

          {(dupKindFilter === "all" || dupKindFilter === "nameAttr") && (
          <section className="mb-10" id="intra-name">
            <h2 className="text-lg font-semibold text-slate-900 mb-2">
              Дубли по названию и фото{" "}
              <span className="text-amber-800 tabular-nums">({cName})</span>
            </h2>
            <p className="text-xs text-slate-500 mb-3">
              Та же бренд-логика, что в сравнении двух витрин. Пары, уже покрытые
              EAN-группой выше, сюда не попадают.
            </p>
            {data.namePhotoPairs.length === 0 && (
              <p className="text-sm text-slate-500">Нет</p>
            )}
            <div className="space-y-3">
              {data.namePhotoPairs.map((row, i) => (
                <div
                  key={`${row.a.id}-${row.b.id}-${i}`}
                  className="grid sm:grid-cols-2 gap-4 p-4 rounded-xl border border-slate-200 bg-amber-50/40"
                >
                  <ProductCell c={row.a} siteLabel={data.siteLabel} />
                  <ProductCell c={row.b} siteLabel={data.siteLabel} />
                  <div className="sm:col-span-2 text-xs text-slate-600">
                    балл: <strong>{(row.score * 100).toFixed(0)}%</strong>{" "}
                    {row.matchReasons.length ? `(${row.matchReasons.join(" + ")})` : null}
                  </div>
                </div>
              ))}
            </div>
          </section>
          )}

          {showUnlikelySections && (
          <section className="mb-10" id="intra-unlikely">
            <h2 className="text-lg font-semibold text-slate-900 mb-2">
              Маловероятные дубли (одинаковое фото + модель ≳60%){" "}
              <span className="text-violet-800 tabular-nums">({cUnl})</span>
            </h2>
            <p className="text-xs text-slate-500 mb-3 leading-relaxed">
              {(data.unlikelyPairs?.length ?? 0) === 0 ? (
                <>
                  Подходящих пар нет, если в рубрике нет пары с{" "}
                  <strong>одинаковым URL первой картинки</strong> и сходством
                  «модельной» части названия (после бренда) не меньше 60% — в
                  пределах одного нормализованного бренда.
                </>
              ) : (
                <>
                  Найдено пар: {data.unlikelyPairs.length}. В подписи — процент
                  сходства модели и, если при запуске отмечены{" "}
                  {[
                    data.unlikelySearch?.volume && "объём",
                    data.unlikelySearch?.shade && "оттенок",
                    data.unlikelySearch?.color && "цвет"
                  ]
                    .filter(Boolean)
                    .join(", ") || "—"}
                  , пояснения по сравнению нормализованных характеристик.
                </>
              )}
            </p>
            <div className="space-y-3">
              {(data.unlikelyPairs ?? []).map((row, i) => (
                <div
                  key={`${row.a.id}-${row.b.id}-${i}`}
                  className="grid sm:grid-cols-2 gap-4 p-4 rounded-xl border border-slate-200 bg-violet-50/40"
                >
                  <ProductCell c={row.a} siteLabel={data.siteLabel} />
                  <ProductCell c={row.b} siteLabel={data.siteLabel} />
                  <div className="sm:col-span-2 text-xs text-slate-600">
                    {row.matchReasons?.join(" + ")}
                  </div>
                </div>
              ))}
            </div>
          </section>
          )}
        </>
        );
      })()}

      {data && !isSingleDups(data) && (
        <>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-[11px] uppercase text-slate-500 font-medium">Сайт A</p>
              <p className="text-lg font-semibold text-slate-900">{data.stats.countA}</p>
              <p className="text-xs text-slate-500 truncate" title={data.siteALabel}>
                {data.siteALabel}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-[11px] uppercase text-slate-500 font-medium">Сайт B</p>
              <p className="text-lg font-semibold text-slate-900">{data.stats.countB}</p>
              <p className="text-xs text-slate-500 truncate" title={data.siteBLabel}>
                {data.siteBLabel}
              </p>
            </div>
            <div className="rounded-xl border border-emerald-200/80 bg-emerald-50/50 p-4 shadow-sm">
              <p className="text-[11px] uppercase text-emerald-800 font-medium">Код (EAN)</p>
              <p className="text-lg font-semibold text-emerald-900">
                {data.stats.eanMatchCount}
                <span className="text-slate-400 font-normal text-sm">
                  {" "}
                  + арт. {data.stats.articleMatchCount}
                </span>
              </p>
              <p className="text-xs text-slate-600">пар между A и B</p>
            </div>
            <div className="rounded-xl border border-amber-200/80 bg-amber-50/40 p-4 shadow-sm">
              <p className="text-[11px] uppercase text-amber-900 font-medium">Кандидаты</p>
              <p className="text-lg font-semibold text-amber-950">
                {data.stats.nameCandidateCount}
              </p>
              <p className="text-xs text-slate-600">модель+фото / название</p>
            </div>
          </div>
          <p className="text-xs text-slate-600 mb-4">
            <strong className="text-slate-800">По id товара:</strong> совпало на обеих витринах —{" "}
            {data.stats.idPlacedCount ?? data.idMatches?.length ?? 0}; на {data.siteBLabel}{" "}
            нет id на {data.siteALabel} (неразмещ.) — {data.stats.unplacedBByIdCount}; на {data.siteALabel}{" "}
            нет id на {data.siteBLabel} — {data.stats.unplacedAByIdCount ?? 0}.
          </p>
          {((data.eanTrivialSameId ?? 0) > 0 || (data.articleTrivialSameId ?? 0) > 0) && (
            <p className="text-xs text-slate-500 mb-6 -mt-2">
              Скрыто как «свой дубль» на витрине: EAN+тот же id — {data.eanTrivialSameId ?? 0};
              артикул+тот же id — {data.articleTrivialSameId ?? 0}.
            </p>
          )}

          {data.brandFilter?.enabled && (
            <div className="mb-6 p-4 rounded-xl border border-amber-200/80 bg-amber-50/50 text-sm text-slate-800">
              <h3 className="font-semibold text-amber-900 mb-2">
                Фильтр по брендам
              </h3>
              <p className="text-xs text-slate-600 mb-2">
                Режим:{" "}
                <strong>
                  {data.brandFilter.matchMode === "contains"
                    ? "вхождение подстроки"
                    : "точное совпадение"}
                </strong>
                . Сравнение только по {data.brandFilter.totalBrands} бренд(ам) из
                списка. Показанные числа — уже после отбора.
              </p>
              <ul className="text-xs text-slate-700 space-y-1 list-disc pl-4">
                <li>
                  {data.siteALabel}: без бренда в API —{" "}
                  {data.brandFilter.excludedMissingBrandA}, не из списка —{" "}
                  {data.brandFilter.excludedNotInListA}
                </li>
                <li>
                  {data.siteBLabel}: без бренда в API —{" "}
                  {data.brandFilter.excludedMissingBrandB}, не из списка —{" "}
                  {data.brandFilter.excludedNotInListB}
                </li>
              </ul>
              {data.brandFilter.brandsSample.length > 0 && (
                <p className="text-xs text-slate-500 mt-2 break-words">
                  Примеры из списка:{" "}
                  {data.brandFilter.brandsSample.join(", ")}
                  {data.brandFilter.totalBrands > data.brandFilter.brandsSample.length
                    ? "…"
                    : ""}
                </p>
              )}
            </div>
          )}

          {data.modelFilter?.enabled && (
            <div className="mb-6 p-4 rounded-xl border border-sky-200/80 bg-sky-50/50 text-sm text-slate-800">
              <h3 className="font-semibold text-sky-900 mb-2">
                Фильтр по списку моделей
              </h3>
              <p className="text-xs text-slate-600 mb-2">
                Режим:{" "}
                <strong>
                  {data.modelFilter.matchMode === "contains"
                    ? "вхождение в название"
                    : "точное совпадение"}
                </strong>
                . Строк в списке: {data.modelFilter.totalModels}.
              </p>
              <ul className="text-xs text-slate-700 space-y-1 list-disc pl-4">
                <li>
                  {data.siteALabel}: не в списке — {data.modelFilter.excludedNotInListA}
                </li>
                <li>
                  {data.siteBLabel}: не в списке — {data.modelFilter.excludedNotInListB}
                </li>
              </ul>
              {data.modelFilter.modelsSample.length > 0 && (
                <p className="text-xs text-slate-500 mt-2 break-words">
                  Примеры: {data.modelFilter.modelsSample.join(", ")}
                  {data.modelFilter.totalModels > data.modelFilter.modelsSample.length
                    ? "…"
                    : ""}
                </p>
              )}
            </div>
          )}

          {data.excludeIdsA?.enabled && (
            <div className="mb-6 p-4 rounded-xl border border-rose-200/80 bg-rose-50/50 text-sm text-slate-800">
              <h3 className="font-semibold text-rose-900 mb-2">
                Исключение по id ({data.siteALabel})
              </h3>
              <p className="text-xs text-slate-600">
                В списке {data.excludeIdsA.listSize} id. С каталога {data.siteALabel} убрано —{" "}
                <strong className="tabular-nums text-slate-800">
                  {data.excludeIdsA.removedFromA}
                </strong>
                . Id из списка, не встретившихся в рубрике A —{" "}
                {data.excludeIdsA.listIdsNotFoundInRubric} ({data.siteBLabel} этим
                списком не затрагивался).
              </p>
            </div>
          )}

          <section className="mb-6 p-4 rounded-xl border border-slate-200 bg-slate-50/90 text-sm">
            <h3 className="font-semibold text-slate-900 mb-2">
              Отчёты по сайтам A и B
            </h3>
            <p className="text-xs text-slate-600 mb-3">
              <strong>Сайт A</strong> — каталог-выборка, <strong>сайт B</strong> — полный
              каталог (как в полях выше).               Сначала — по <strong>EAN</strong> и <strong>артикулу</strong>, потом кандидаты
              «модель+фото». Ниже — отчёты и дубли.
            </p>
            <ul className="text-xs text-slate-600 mb-4 list-disc pl-4 space-y-0.5">
              <li>
                <strong>1</strong> — «нет товаров на сайте A»: что есть в <strong>B</strong>, но
                не сопоставилось с <strong>A</strong>.
              </li>
              <li>
                <strong>2</strong> — дубли внутри рубрики на <strong>сайте A</strong> (один EAN —
                разные id). Вкладка фильтра: только EAN или название+фото (+ опции объём/цвет
                в форме выше).
              </li>
              <li>
                <strong>3</strong> — то же для <strong>сайта B</strong>.
              </li>
              <li>
                <strong>4</strong> — для списка из п.1 ищем пересечения с полным каталогом{" "}
                <strong>A</strong> (тот же EAN с другим id или пара по названию+фото), чтобы
                выявить возможные дубли.
              </li>
            </ul>
            <div className="flex flex-wrap gap-2 mb-2">
              <button
                type="button"
                onClick={() => setReportView("full")}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                  reportView === "full"
                    ? "bg-slate-900 text-white"
                    : "bg-white border border-slate-200 text-slate-800"
                }`}
              >
                Полное сравнение
              </button>
              <button
                type="button"
                onClick={() => setReportView("notOnA")}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                  reportView === "notOnA"
                    ? "bg-slate-900 text-white"
                    : "bg-white border border-slate-200 text-slate-800"
                }`}
              >
                1) Неразмещённые (по id)
              </button>
              <button
                type="button"
                onClick={() => setReportView("dupsA")}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                  reportView === "dupsA"
                    ? "bg-slate-900 text-white"
                    : "bg-white border border-slate-200 text-slate-800"
                }`}
              >
                2) Дубли на сайте A
              </button>
              <button
                type="button"
                onClick={() => setReportView("dupsB")}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                  reportView === "dupsB"
                    ? "bg-slate-900 text-white"
                    : "bg-white border border-slate-200 text-slate-800"
                }`}
              >
                3) Дубли на сайте B
              </button>
              <button
                type="button"
                onClick={() => setReportView("crossBvsA")}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                  reportView === "crossBvsA"
                    ? "bg-slate-900 text-white"
                    : "bg-white border border-slate-200 text-slate-800"
                }`}
              >
                4) Неразмещённые (id) vs A
              </button>
            </div>
            {reportView !== "notOnA" && (
              <div className="mt-4 pt-3 border-t border-slate-200">
                <p className="text-xs text-slate-600 mb-2">
                  <strong>Тип дублей (вкладки)</strong> — <strong>все</strong>,{" "}
                  <strong>EAN + артикул</strong> (один «кодовый» слой) или{" "}
                  <strong>только по названию + фото / модель</strong> (и объём/оттенок/цвет
                  в форме). Действует в отчётах 2–4, в жёлтых EAN и в полном сравнении.
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setDupKindFilter("all")}
                    className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                      dupKindFilter === "all"
                        ? "bg-amber-800 text-white"
                        : "bg-white border border-slate-200 text-slate-800"
                    }`}
                  >
                    Все
                  </button>
                  <button
                    type="button"
                    onClick={() => setDupKindFilter("ean")}
                    className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                      dupKindFilter === "ean"
                        ? "bg-amber-800 text-white"
                        : "bg-white border border-slate-200 text-slate-800"
                    }`}
                  >
                    EAN и артикул
                  </button>
                  <button
                    type="button"
                    onClick={() => setDupKindFilter("nameAttr")}
                    className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                      dupKindFilter === "nameAttr"
                        ? "bg-amber-800 text-white"
                        : "bg-white border border-slate-200 text-slate-800"
                    }`}
                  >
                    Название + фото + хар.
                  </button>
                  <button
                    type="button"
                    onClick={() => setDupKindFilter("unlikely")}
                    className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                      dupKindFilter === "unlikely"
                        ? "bg-amber-800 text-white"
                        : "bg-white border border-slate-200 text-slate-800"
                    }`}
                  >
                    Маловероятные
                  </button>
                </div>
                {(reportView === "dupsA" || reportView === "dupsB") && (
                  <div className="mt-3 pt-3 border-t border-slate-200">
                    <p className="text-xs text-slate-600 mb-2">
                      <strong>Область дублей</strong> (для отчётов 2 и 3): внутри рубрики
                      на сайте или среди списка «неразмещённые по id» vs полный другой сайт.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {reportView === "dupsA" ? (
                        <>
                          <button
                            type="button"
                            onClick={() => setDupScopeA("intraA")}
                            className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                              dupScopeA === "intraA"
                                ? "bg-slate-900 text-white"
                                : "bg-white border border-slate-200 text-slate-800"
                            }`}
                          >
                            Дубли на {data.siteALabel} (рубрика)
                          </button>
                          <button
                            type="button"
                            onClick={() => setDupScopeA("unplacedVsA")}
                            className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                              dupScopeA === "unplacedVsA"
                                ? "bg-slate-900 text-white"
                                : "bg-white border border-slate-200 text-slate-800"
                            }`}
                          >
                            Список «неразмещённые» ({data.siteBLabel}) vs {data.siteALabel}
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => setDupScopeB("intraB")}
                            className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                              dupScopeB === "intraB"
                                ? "bg-slate-900 text-white"
                                : "bg-white border border-slate-200 text-slate-800"
                            }`}
                          >
                            Дубли на {data.siteBLabel} (рубрика)
                          </button>
                          <button
                            type="button"
                            onClick={() => setDupScopeB("unplacedVsB")}
                            className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                              dupScopeB === "unplacedVsB"
                                ? "bg-slate-900 text-white"
                                : "bg-white border border-slate-200 text-slate-800"
                            }`}
                          >
                            Список «неразмещённые» ({data.siteALabel}) vs {data.siteBLabel}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>

          {reportView === "notOnA" && (
            <section className="mb-10 p-4 rounded-xl border border-emerald-200 bg-emerald-50/20">
              <h2 className="text-lg font-semibold text-slate-900 mb-2" id="rep-not-on-a">
                Неразмещённые позиции сайта A
              </h2>
              <p className="text-sm text-slate-600 mb-3">
                Товары <strong>{data.siteBLabel}</strong>, у которых <strong>нет такого id</strong>{" "}
                в каталоге <strong>{data.siteALabel}</strong> (приоритетное сопоставление).
                В Excel — все поля выгрузки, в т.ч. вложенность в JSON-столбце.
              </p>
              {(() => {
                const n = data.unplacedBByIdRaw?.length ?? 0;
                return (
                  <>
                    <p className="text-sm text-slate-700 mb-2">
                      Всего: <strong>{n}</strong>
                    </p>
                    {n > 0 && (
                      <button
                        type="button"
                        onClick={downloadNotOnAExcel}
                        className="rounded-lg bg-emerald-800 text-white px-3 py-1.5 text-sm font-medium hover:bg-emerald-900 mb-4"
                      >
                        Скачать Excel ({n} шт.)
                      </button>
                    )}
                    <div className="max-h-[min(75vh,1400px)] overflow-y-auto space-y-2 pr-1">
                      {n === 0 && (
                        <p className="text-sm text-slate-500">Список пуст</p>
                      )}
                      {unplacedBList.map((c) => (
                        <div
                          key={c.id}
                          className="p-3 rounded-lg border border-slate-200 bg-white"
                        >
                          <ProductCell c={c} siteLabel={data.siteBLabel} />
                        </div>
                      ))}
                    </div>
                  </>
                );
              })()}
            </section>
          )}

          {(reportView === "dupsA" || reportView === "dupsB") && (() => {
            const isA = reportView === "dupsA";
            const intra = isA ? data.intraSiteADups : data.intraSiteBDups;
            const dupSiteLabel = isA ? data.siteALabel : data.siteBLabel;
            const scopeIntra = isA ? dupScopeA === "intraA" : dupScopeB === "intraB";
            return (
            <section
              className="mb-10 space-y-8"
              id={isA ? "rep-dups-a" : "rep-dups-b"}
            >
              <div>
                <h2 className="text-lg font-semibold text-slate-900 mb-1">
                  {isA ? "2) Дубли на сайте A" : "3) Дубли на сайте B"}
                </h2>
                <p className="text-xs text-slate-600">
                  {scopeIntra
                    ? `Показаны дубли внутри рубрики ${dupSiteLabel} (EAN, название+фото, маловероятные — по кнопкам выше).`
                    : isA
                      ? `Позиции из списка «неразмещённые по id» ${data.siteBLabel} сопоставлены с полным ${data.siteALabel} и между собой.`
                      : `Позиции «неразмещённые по id» ${data.siteALabel} сопоставлены с полным ${data.siteBLabel} и между собой.`}
                </p>
              </div>

              {scopeIntra && (dupKindFilter === "nameAttr" || dupKindFilter === "unlikely") && (
                <p className="text-sm text-amber-900/90 p-3 rounded-lg bg-amber-100/50 border border-amber-200">
                  Слой <strong>EAN/арт</strong> скрыт фильтром. Переключите на «Все» или
                  «EAN и артикул», чтобы увидеть группы EAN.
                </p>
              )}

              {scopeIntra && (
                <>
                  {showEanSections && (
                    <div>
                      <h3 className="text-sm font-semibold text-amber-900 mb-2">
                        EAN — несколько id на {dupSiteLabel}
                      </h3>
                      <p className="text-xs text-amber-900/80 mb-3">
                        Один EAN, разные карточки. «Карточка» — витрина или шаблон{" "}
                        <code className="text-[11px] bg-amber-100 px-0.5 rounded">
                          NEXT_PUBLIC_4P_ADMIN_URL_TEMPLATE
                        </code>{" "}
                        ({"{id}"}). «Админка» всегда ведёт в Control Center:{" "}
                        <code className="text-[11px] bg-amber-100 px-0.5 rounded">
                          https://4stand.com/A
                        </code>
                        + id.
                      </p>
                      {intra.eanGroups.length === 0 && (
                        <p className="text-sm text-slate-500">Нет</p>
                      )}
                      <div className="space-y-6">
                        {intra.eanGroups.map((g) => (
                          <div
                            key={g.ean}
                            className="rounded-xl border border-amber-200 bg-amber-50/30 p-4"
                          >
                            <p className="text-xs font-mono text-amber-950 mb-3">
                              EAN {g.ean}
                            </p>
                            <div className="grid sm:grid-cols-1 md:grid-cols-2 gap-4">
                              {g.products.map((c) => (
                                <ProductCell
                                  key={c.id}
                                  c={c}
                                  siteLabel={dupSiteLabel}
                                />
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {showNameAttrSections && (
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900 mb-2">
                        Пары: название + фото (код не дублирует)
                      </h3>
                      {intra.namePhotoPairs.length === 0 && (
                        <p className="text-sm text-slate-500">Нет</p>
                      )}
                      <div className="space-y-3">
                        {intra.namePhotoPairs.map((row, i) => (
                          <div
                            key={`intra-np-${row.a.id}-${row.b.id}-${i}`}
                            className="grid sm:grid-cols-2 gap-4 p-4 rounded-xl border border-slate-200 bg-amber-50/40"
                          >
                            <ProductCell c={row.a} siteLabel={dupSiteLabel} />
                            <ProductCell c={row.b} siteLabel={dupSiteLabel} />
                            <div className="sm:col-span-2 text-xs text-slate-600">
                              {(row.score * 100).toFixed(0)}% ·{" "}
                              {row.matchReasons?.join(" + ")}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {showUnlikelySections && (
                    <div>
                      <h3 className="text-sm font-semibold text-violet-900 mb-2">
                        Маловероятные (фото + модель ≳60%)
                      </h3>
                      {(intra.unlikelyPairs?.length ?? 0) === 0 && (
                        <p className="text-xs text-slate-600 mb-2 leading-relaxed">
                          Нет пар с одинаковым URL первой картинки и сходством
                          модельной части ≥ 60% (и опциональными пояснениями по
                          объёму/оттенку/цвету, если отмечены).
                        </p>
                      )}
                      <div className="space-y-3">
                        {(intra.unlikelyPairs ?? []).map((row, i) => (
                          <div
                            key={`intra-u-${row.a.id}-${row.b.id}-${i}`}
                            className="grid sm:grid-cols-2 gap-4 p-4 rounded-xl border border-violet-200 bg-violet-50/40"
                          >
                            <ProductCell c={row.a} siteLabel={dupSiteLabel} />
                            <ProductCell c={row.b} siteLabel={dupSiteLabel} />
                            <div className="sm:col-span-2 text-xs text-slate-600">
                              {row.matchReasons?.join(" + ")}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}

              {!scopeIntra && isA && (
                <>
                  <div>
                    <h3 className="text-sm font-semibold text-emerald-900 mb-2">
                      «Неразмещённые» {data.siteBLabel} — совпадения в полном {data.siteALabel}
                    </h3>
                    {onlyBCrossWithAFiltered.length === 0 && (
                      <p className="text-sm text-slate-500">Нет</p>
                    )}
                    <div className="space-y-3">
                      {onlyBCrossWithAFiltered.map((row, i) => (
                        <div
                          key={`ca-${i}-${row.productFromOnlyB.id}-${row.productOnA.id}`}
                          className="p-4 rounded-xl border border-emerald-200 bg-white"
                        >
                          <p className="text-[10px] uppercase text-emerald-800 font-medium mb-2">
                            {row.kind === "ean_diff_id"
                              ? "EAN, разные id"
                              : row.kind === "article"
                                ? "Артикул"
                                : row.kind === "name_photo"
                                  ? "Модель + фото"
                                  : "Маловероятно (фото+хар.)"}
                          </p>
                          <div className="grid sm:grid-cols-2 gap-3">
                            <div>
                              <p className="text-[11px] text-slate-500 mb-0.5">
                                {data.siteALabel}
                              </p>
                              <ProductCell
                                c={row.productOnA}
                                siteLabel={data.siteALabel}
                              />
                            </div>
                            <div>
                              <p className="text-[11px] text-slate-500 mb-0.5">
                                {data.siteBLabel} (неразмещён)
                              </p>
                              <ProductCell
                                c={row.productFromOnlyB}
                                siteLabel={data.siteBLabel}
                              />
                            </div>
                          </div>
                          {row.kind === "ean_diff_id" && row.ean && (
                            <p className="text-xs font-mono text-slate-500 mt-1">
                              EAN {row.ean}
                            </p>
                          )}
                          {row.kind === "article" && row.article && (
                            <p className="text-xs font-mono text-slate-500 mt-1">
                              арт. {row.article}
                            </p>
                          )}
                          {(row.kind === "name_photo" || row.kind === "unlikely") && (
                            <p className="text-xs text-slate-600 mt-1">
                              {(row.score! * 100).toFixed(0)}%
                              {row.matchReasons?.length
                                ? ` (${row.matchReasons.join(" + ")})`
                                : ""}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-amber-900 mb-2">
                      Дубли внутри неразмещённого списка ({data.siteBLabel})
                    </h3>
                    {onlyBInternalDupsFiltered.length === 0 && (
                      <p className="text-sm text-slate-500">Нет</p>
                    )}
                    <div className="space-y-3">
                      {onlyBInternalDupsFiltered.map((row, i) => (
                        <div
                          key={`ib-${i}-${row.first.id}-${row.second.id}`}
                          className="p-4 rounded-xl border border-amber-200 bg-amber-50/30"
                        >
                          <p className="text-[10px] uppercase text-amber-900 font-medium mb-2">
                            {row.kind === "ean"
                              ? "EAN"
                              : row.kind === "name_photo"
                                ? "Название+фото"
                                : "Маловероятно"}
                          </p>
                          <div className="grid sm:grid-cols-2 gap-3">
                            <ProductCell
                              c={row.first}
                              siteLabel={data.siteBLabel}
                            />
                            <ProductCell
                              c={row.second}
                              siteLabel={data.siteBLabel}
                            />
                          </div>
                          {row.kind === "ean" && row.ean && (
                            <p className="text-xs font-mono text-slate-500 mt-1">
                              EAN {row.ean}
                            </p>
                          )}
                          {(row.kind === "name_photo" || row.kind === "unlikely") && (
                            <p className="text-xs text-slate-600 mt-1">
                              {(row.score! * 100).toFixed(0)}%
                              {row.matchReasons?.length
                                ? ` (${row.matchReasons.join(" + ")})`
                                : ""}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {!scopeIntra && !isA && (
                <>
                  <div>
                    <h3 className="text-sm font-semibold text-emerald-900 mb-2">
                      «Неразмещённые» {data.siteALabel} — совпадения в полном {data.siteBLabel}
                    </h3>
                    {onlyACrossWithBFiltered.length === 0 && (
                      <p className="text-sm text-slate-500">Нет</p>
                    )}
                    <div className="space-y-3">
                      {onlyACrossWithBFiltered.map((row, i) => (
                        <div
                          key={`cb-${i}-${row.productFromOnlyA.id}-${row.productOnB.id}`}
                          className="p-4 rounded-xl border border-emerald-200 bg-white"
                        >
                          <p className="text-[10px] uppercase text-emerald-800 font-medium mb-2">
                            {row.kind === "ean_diff_id"
                              ? "EAN, разные id"
                              : row.kind === "article"
                                ? "Артикул"
                                : row.kind === "name_photo"
                                  ? "Модель + фото"
                                  : "Маловероятно (фото+хар.)"}
                          </p>
                          <div className="grid sm:grid-cols-2 gap-3">
                            <div>
                              <p className="text-[11px] text-slate-500 mb-0.5">
                                {data.siteALabel} (неразмещён)
                              </p>
                              <ProductCell
                                c={row.productFromOnlyA}
                                siteLabel={data.siteALabel}
                              />
                            </div>
                            <div>
                              <p className="text-[11px] text-slate-500 mb-0.5">
                                {data.siteBLabel}
                              </p>
                              <ProductCell
                                c={row.productOnB}
                                siteLabel={data.siteBLabel}
                              />
                            </div>
                          </div>
                          {row.kind === "ean_diff_id" && row.ean && (
                            <p className="text-xs font-mono text-slate-500 mt-1">
                              EAN {row.ean}
                            </p>
                          )}
                          {row.kind === "article" && row.article && (
                            <p className="text-xs font-mono text-slate-500 mt-1">
                              арт. {row.article}
                            </p>
                          )}
                          {(row.kind === "name_photo" || row.kind === "unlikely") && (
                            <p className="text-xs text-slate-600 mt-1">
                              {(row.score! * 100).toFixed(0)}%
                              {row.matchReasons?.length
                                ? ` (${row.matchReasons.join(" + ")})`
                                : ""}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-amber-900 mb-2">
                      Дубли внутри неразмещённого списка ({data.siteALabel})
                    </h3>
                    {onlyAInternalDupsFiltered.length === 0 && (
                      <p className="text-sm text-slate-500">Нет</p>
                    )}
                    <div className="space-y-3">
                      {onlyAInternalDupsFiltered.map((row, i) => (
                        <div
                          key={`ia-${i}-${row.first.id}-${row.second.id}`}
                          className="p-4 rounded-xl border border-amber-200 bg-amber-50/30"
                        >
                          <p className="text-[10px] uppercase text-amber-900 font-medium mb-2">
                            {row.kind === "ean"
                              ? "EAN"
                              : row.kind === "name_photo"
                                ? "Название+фото"
                                : "Маловероятно"}
                          </p>
                          <div className="grid sm:grid-cols-2 gap-3">
                            <ProductCell
                              c={row.first}
                              siteLabel={data.siteALabel}
                            />
                            <ProductCell
                              c={row.second}
                              siteLabel={data.siteALabel}
                            />
                          </div>
                          {row.kind === "ean" && row.ean && (
                            <p className="text-xs font-mono text-slate-500 mt-1">
                              EAN {row.ean}
                            </p>
                          )}
                          {(row.kind === "name_photo" || row.kind === "unlikely") && (
                            <p className="text-xs text-slate-600 mt-1">
                              {(row.score! * 100).toFixed(0)}%
                              {row.matchReasons?.length
                                ? ` (${row.matchReasons.join(" + ")})`
                                : ""}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </section>
            );
          })()}

          {reportView === "crossBvsA" && (
            <section className="mb-10" id="rep-cross-b-vs-a">
              <h2 className="text-lg font-semibold text-slate-900 mb-1">
                Неразмещённые по id vs полный каталог {data.siteALabel}
              </h2>
              <p className="text-sm text-slate-600 mb-4">
                Для {data.siteBLabel}, у кого <strong>нет id</strong> на {data.siteALabel}, в
                полной выгрузке {data.siteALabel} ищем EAN, артикул, затем кандидатов
                (модель+фото / мало: фото+хар.)
              </p>
              {crossBvsARowsFiltered.length === 0 && (
                <p className="text-sm text-slate-500">Нет</p>
              )}
              <div className="space-y-3 max-h-[min(80vh,1600px)] overflow-y-auto pr-1">
                {crossBvsARowsFiltered.map((row, i) => (
                  <div
                    key={`${row.fromB.id}-${row.onA.id}-${i}`}
                    className="p-4 rounded-xl border border-emerald-200 bg-white space-y-2"
                  >
                    <p className="text-[10px] uppercase text-emerald-800 font-medium">
                      {row.kind === "ean_diff_id"
                        ? "EAN, разные id"
                        : row.kind === "article"
                          ? "Артикул"
                          : row.kind === "name_photo"
                            ? "Модель + фото"
                            : "Маловероятно (фото+хар.)"}
                    </p>
                    <div className="grid sm:grid-cols-2 gap-3">
                      <div>
                        <p className="text-[11px] text-slate-500 mb-0.5">
                          На сайте A ({data.siteALabel})
                        </p>
                        <ProductCell c={row.onA} siteLabel={data.siteALabel} />
                      </div>
                      <div>
                        <p className="text-[11px] text-slate-500 mb-0.5">
                          Из «нет на A» на {data.siteBLabel}
                        </p>
                        <ProductCell c={row.fromB} siteLabel={data.siteBLabel} />
                      </div>
                    </div>
                    {row.kind === "ean_diff_id" && row.ean && (
                      <p className="text-xs font-mono text-slate-500">EAN {row.ean}</p>
                    )}
                    {row.kind === "article" && row.article && (
                      <p className="text-xs font-mono text-slate-500">арт. {row.article}</p>
                    )}
                    {(row.kind === "name_photo" || row.kind === "unlikely") && (
                      <p className="text-xs text-slate-600">
                        балл: {(row.score! * 100).toFixed(0)}%
                        {row.matchReasons?.length
                          ? ` (${row.matchReasons.join(" + ")})`
                          : ""}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {reportView === "full" && (
            <>
          {showEanSections &&
            (data.duplicateEanEnriched?.length ?? 0) > 0 && (
            <section className="mb-8">
              <h2 className="text-lg font-semibold text-amber-900 mb-2">
                Предупреждение: один EAN на разных товарах
              </h2>
              <div className="space-y-6">
                {data.duplicateEanEnriched!.map((g) => (
                  <div
                    key={`${g.site}-${g.ean}`}
                    className="rounded-xl border border-amber-200 bg-amber-50/30 p-4"
                  >
                    <p className="text-xs text-amber-900 mb-2">
                      Сайт {g.site} ({g.site === "A" ? data.siteALabel : data.siteBLabel})
                      <span className="font-mono"> · EAN {g.ean}</span>
                    </p>
                    <div className="grid sm:grid-cols-1 md:grid-cols-2 gap-4">
                      {g.products.map((c) => (
                        <ProductCell
                          key={c.id}
                          c={c}
                          siteLabel={g.site === "A" ? data.siteALabel : data.siteBLabel}
                        />
                      ))}
                    </div>
                    {g.products.length === 0 && (
                      <p className="text-sm text-amber-900">
                        id:{" "}
                        {(
                          data.duplicateEanWarnings.find(
                            (w) => w.site === g.site && w.ean === g.ean
                          )?.productIds ?? []
                        ).join(", ")}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {showEanSections &&
            (data.duplicateEanEnriched?.length ?? 0) === 0 &&
            data.duplicateEanWarnings.length > 0 && (
            <section className="mb-8">
              <h2 className="text-lg font-semibold text-amber-900 mb-2">
                Предупреждение: один EAN на разных товарах
              </h2>
              <ul className="text-sm text-amber-900 space-y-1 list-disc pl-5">
                {data.duplicateEanWarnings.map((w) => (
                  <li key={`${w.site}-${w.ean}`}>
                    Сайт {w.site}, EAN {w.ean}: id {w.productIds.join(", ")}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {showEanSections && (data.duplicateArticleWarnings?.length ?? 0) > 0 && (
            <section className="mb-8">
              <h2 className="text-lg font-semibold text-amber-800 mb-2">
                Предупреждение: один артикул — несколько id
              </h2>
              <ul className="text-sm text-amber-900 space-y-1 list-disc pl-5">
                {data.duplicateArticleWarnings!.map((w) => (
                  <li key={`${w.site}-${w.article}`}>
                    Сайт {w.site}, арт. {w.article}: id {w.productIds.join(", ")}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {showEanSections && (
          <section className="mb-10" id="ean">
            <h2 className="text-lg font-semibold text-slate-900 mb-3">
              1) Один EAN — разные id (между площадками)
            </h2>
            <p className="text-xs text-slate-500 mb-2">
              Случаи, когда штрихкод совпал, а внутренний id на A и B <strong>не
              совпадает</strong>. Пары с тем же EAN <strong>и</strong> тем же id
              (часто одна витрина) в этот список не выводим — смотрите счётчик
              вверху.
            </p>
            <div className="space-y-3">
              {data.eanMatches.length === 0 && (
                <p className="text-sm text-slate-500">Нет</p>
              )}
              {data.eanMatches.map((row) => (
                <div
                  key={row.ean}
                  className="grid md:grid-cols-2 gap-4 p-4 rounded-xl border border-slate-200 bg-white shadow-sm"
                >
                  <div className="flex items-start justify-between gap-2">
                    <ProductCell c={row.a} siteLabel={data.siteALabel} />
                  </div>
                  <ProductCell c={row.b} siteLabel={data.siteBLabel} />
                  <div className="md:col-span-2 text-xs text-slate-500 font-mono border-t border-slate-100 pt-2">
                    EAN: {row.ean}
                  </div>
                </div>
              ))}
            </div>
          </section>
          )}

          {showEanSections && (
          <section className="mb-10" id="article">
            <h2 className="text-lg font-semibold text-slate-900 mb-3">
              1b) Один артикул / код — разные id
            </h2>
            <p className="text-xs text-slate-500 mb-2">
              Поля <code className="text-[11px] bg-slate-100 px-0.5 rounded">article</code>,{" "}
              <code className="text-[11px] bg-slate-100 px-0.5">code</code> из API
              (нормализовано). Срабатывает, если EAN ещё не сопоставил пару. Дубликаты
              одного артикула внутри рубрики — в предупреждениях.
            </p>
            <div className="space-y-3">
              {(data.articleMatches?.length ?? 0) === 0 && (
                <p className="text-sm text-slate-500">Нет</p>
              )}
              {data.articleMatches?.map((row) => (
                <div
                  key={row.article}
                  className="grid md:grid-cols-2 gap-4 p-4 rounded-xl border border-amber-200/80 bg-amber-50/40 shadow-sm"
                >
                  <ProductCell c={row.a} siteLabel={data.siteALabel} />
                  <ProductCell c={row.b} siteLabel={data.siteBLabel} />
                  <div className="md:col-span-2 text-xs text-slate-600 font-mono border-t border-amber-200/50 pt-2">
                    Артикул: {row.article}
                  </div>
                </div>
              ))}
            </div>
          </section>
          )}

          {showNameAttrSections && (
          <section className="mb-10" id="name">
            <h2 className="text-lg font-semibold text-slate-900 mb-3">
              2) Кандидаты (модель + фото, без пары по коду)
            </h2>
            <p className="text-xs text-slate-500 mb-2">
              Тот же <strong>бренд</strong> (из API). Сравниваем «модельную» часть
              названия (без «туалетная вода…») плюс фото. Совпал URL картинки — сильный
              сигнал. Разные фото, но <strong>один суффикс карточки</strong> в ссылке (
              <code className="text-[11px]">-a1182822</code>) и <strong>оба объёма</strong> в
              данных — тоже пара (см. причину в балле: «карточка+объём»). Без картинок
              пары — только по высокой близости названия. Разные числа в вариации (01/02) —
              отсекаем. ИИ не используется.
            </p>
            <div className="space-y-3">
              {data.nameMatches.length === 0 && (
                <p className="text-sm text-slate-500">Нет</p>
              )}
              {data.nameMatches.map((row, i) => (
                <div
                  key={`${row.a.id}-${row.b.id}-${i}`}
                  className="grid md:grid-cols-2 gap-4 p-4 rounded-xl border border-slate-200 bg-amber-50/40"
                >
                  <div className="flex items-start justify-between gap-2">
                    <ProductCell c={row.a} siteLabel={data.siteALabel} />
                  </div>
                  <ProductCell c={row.b} siteLabel={data.siteBLabel} />
                  <div className="md:col-span-2 text-xs text-slate-600">
                    балл: <strong>{(row.score * 100).toFixed(0)}%</strong>
                    {row.matchReasons?.length ? (
                      <>
                        {" "}
                        ({row.matchReasons.join(" + ")})
                      </>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </section>
          )}

          <section className="mb-10" id="only-a">
            <h2 className="text-lg font-semibold text-slate-900 mb-3">
              Только в {data.siteALabel} (после матчей)
            </h2>
            <div className="space-y-2">
              {data.onlyA.length === 0 && (
                <p className="text-sm text-slate-500">—</p>
              )}
              {data.onlyA.map((c) => (
                <div
                  key={c.id}
                  className="p-3 rounded-lg border border-slate-200 bg-white"
                >
                  <ProductCell c={c} siteLabel={data.siteALabel} />
                </div>
              ))}
            </div>
          </section>

          <section className="mb-10" id="only-b-triple">
            <h2 className="text-lg font-semibold text-slate-900 mb-1">
              Неразмещённые на A ({data.siteBLabel}): три колонки
            </h2>
            <p className="text-sm text-slate-600 mb-4">
              Слева — позиции {data.siteBLabel} <strong>без такого id</strong> на {data.siteALabel}
              (основа списка). В центре — тот же набор, сопоставленный с полным {data.siteALabel}.
              Справа — дубли внутри неразмещённого списка.
            </p>
            <div className="grid xl:grid-cols-3 gap-6 items-start">
              <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 min-h-[120px]">
                <h3 className="text-sm font-semibold text-slate-800 mb-1">
                  1) Неразмещённые (по id) на {data.siteBLabel}
                </h3>
                <p className="text-xs text-slate-500 mb-3">
                  Отдельно: «только на B» после имя+фото — в конце, Excel «сырой только B».
                </p>
                {unplacedBList.length > 0 && (
                  <div className="mb-3">
                    <button
                      type="button"
                      onClick={downloadNotOnAExcel}
                      className="rounded-lg bg-slate-800 text-white px-3 py-1.5 text-xs font-medium hover:bg-slate-900"
                    >
                      Excel «неразмещённые» ({unplacedBList.length} шт.)
                    </button>
                  </div>
                )}
                <div className="max-h-[min(70vh,1200px)] overflow-y-auto space-y-2 pr-1">
                  {unplacedBList.length === 0 && (
                    <p className="text-sm text-slate-500">—</p>
                  )}
                  {unplacedBList.map((c) => (
                    <div
                      key={c.id}
                      className="p-2 rounded-lg border border-slate-200 bg-white text-left"
                    >
                      <ProductCell c={c} siteLabel={data.siteBLabel} />
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/30 p-4 min-h-[120px]">
                <h3 className="text-sm font-semibold text-slate-800 mb-1">
                  2) Тот же товар в каталоге {data.siteALabel}
                </h3>
                <p className="text-xs text-slate-500 mb-3">
                  <strong className="text-emerald-900">EAN / артикул</strong> — тот же код,
                  разные id. <strong>Модель+фото</strong> — внутри бренда, см. тезисы в п.2
                  отчёта. У одной позиции B может быть несколько попаданий в A.
                </p>
                <div className="max-h-[min(70vh,1200px)] overflow-y-auto space-y-3 pr-1">
                  {onlyBCrossWithAFiltered.length === 0 && (
                    <p className="text-sm text-slate-500">Нет</p>
                  )}
                  {onlyBCrossWithAFiltered.map((row, i) => (
                    <div
                      key={`x-${i}-${row.productFromOnlyB.id}-${row.productOnA.id}-${row.kind}`}
                      className="p-3 rounded-lg border border-emerald-100 bg-white space-y-2"
                    >
                      <p className="text-[10px] uppercase tracking-wide text-emerald-800 font-medium">
                        {row.kind === "ean_diff_id"
                          ? "EAN, разные id"
                          : row.kind === "article"
                            ? "Артикул"
                            : row.kind === "name_photo"
                              ? "Модель + фото"
                              : "Маловероятно (фото+хар.)"}
                      </p>
                      <div className="grid sm:grid-cols-2 gap-2">
                        <ProductCell c={row.productOnA} siteLabel={data.siteALabel} />
                        <ProductCell
                          c={row.productFromOnlyB}
                          siteLabel={data.siteBLabel}
                        />
                      </div>
                      {row.kind === "ean_diff_id" && row.ean && (
                        <p className="text-xs font-mono text-slate-500">EAN {row.ean}</p>
                      )}
                      {row.kind === "article" && row.article && (
                        <p className="text-xs font-mono text-slate-500">арт. {row.article}</p>
                      )}
                      {(row.kind === "name_photo" || row.kind === "unlikely") && (
                        <p className="text-xs text-slate-600">
                          балл: {(row.score! * 100).toFixed(0)}%
                          {row.matchReasons?.length
                            ? ` (${row.matchReasons.join(" + ")})`
                            : ""}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-xl border border-amber-200 bg-amber-50/30 p-4 min-h-[120px]">
                <h3 className="text-sm font-semibold text-slate-800 mb-1">
                  3) Дубли в неразмещённом списке
                </h3>
                <p className="text-xs text-slate-500 mb-3">
                  <strong className="text-amber-900">EAN</strong>, <strong>имя+фото</strong> и
                  <strong> мало: фото+хар.</strong> — по фильтру выше.
                </p>
                <div className="max-h-[min(70vh,1200px)] overflow-y-auto space-y-3 pr-1">
                  {onlyBInternalDupsFiltered.length === 0 && (
                    <p className="text-sm text-slate-500">Нет</p>
                  )}
                  {onlyBInternalDupsFiltered.map((row, i) => (
                    <div
                      key={`d-${i}-${row.first.id}-${row.second.id}-${row.kind}`}
                      className="p-3 rounded-lg border border-amber-100 bg-white space-y-2"
                    >
                      <p className="text-[10px] uppercase tracking-wide text-amber-900 font-medium">
                        {row.kind === "ean"
                          ? "Дубль по EAN"
                          : row.kind === "name_photo"
                            ? "Дубль имя+фото"
                            : "Маловероятно"}
                      </p>
                      <div className="grid sm:grid-cols-2 gap-2">
                        <ProductCell c={row.first} siteLabel={data.siteBLabel} />
                        <ProductCell c={row.second} siteLabel={data.siteBLabel} />
                      </div>
                      {row.kind === "ean" && row.ean && (
                        <p className="text-xs font-mono text-slate-500">EAN {row.ean}</p>
                      )}
                      {(row.kind === "name_photo" || row.kind === "unlikely") && (
                        <p className="text-xs text-slate-600">
                          балл: {(row.score! * 100).toFixed(0)}%
                          {row.matchReasons?.length
                            ? ` (${row.matchReasons.join(" + ")})`
                            : ""}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
            {data.rawOnlyB && data.rawOnlyB.length > 0 && (
              <p className="text-xs text-slate-500 mt-4">
                Выгрузка «только на {data.siteBLabel}» после кандидат-матчей (не по id):{" "}
                <button
                  type="button"
                  onClick={downloadOnlyBExcel}
                  className="text-slate-800 underline font-medium"
                >
                  Excel ({data.rawOnlyB.length})
                </button>
              </p>
            )}
          </section>
            </>
          )}
        </>
      )}

      <nav className="fixed bottom-0 left-0 right-0 border-t border-slate-200/90 bg-white/95 backdrop-blur text-sm flex flex-wrap justify-center gap-4 sm:gap-6 py-2 px-2 text-slate-600 shadow-[0_-4px_20px_rgba(15,23,42,0.04)]">
        {data && isSingleDups(data) ? (
          <>
            <a href="#intra-ean" className="hover:text-slate-900 hover:underline">
              EAN в рубрике
            </a>
            <a href="#intra-name" className="hover:text-slate-900 hover:underline">
              Имя+фото
            </a>
            <a href="#intra-unlikely" className="hover:text-slate-900 hover:underline">
              Маловероятные
            </a>
          </>
        ) : (
          <>
            <a href="#ean" className="hover:text-slate-900 hover:underline">
              EAN
            </a>
            <a href="#article" className="hover:text-slate-900 hover:underline">
              Артикул
            </a>
            <a href="#name" className="hover:text-slate-900 hover:underline">
              Кандидаты
            </a>
            <a href="#only-a" className="hover:text-slate-900 hover:underline">
              Только A
            </a>
            <a href="#only-b-triple" className="hover:text-slate-900 hover:underline">
              3 колонки B
            </a>
          </>
        )}
      </nav>
    </div>
    </div>
  );
}
