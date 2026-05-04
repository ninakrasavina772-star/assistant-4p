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
import {
  mergeUniqueSortedRubricId,
  parseRubricIdsFromText
} from "@/lib/rubricIds";
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
  compareFormNarrow,
  homeCardHeader,
  homeCardTitle,
  homeInput,
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

const ATTR_PAIR_HINT_POPOVER =
  "Для каждой отмеченной характеристики (объём, оттенок, цвет): если значение указано у обеих карточек и различается — пара для мягкого совпадения отбрасывается по этому полю. Если у одной карточки поля нет — эта отмеченная проверку не отменяет пару (она может отсеиваться другой отмеченной характеристикой или другим правилом). Слой «слабых» ~45% в отчёте объём/оттенок не фильтрует.";

/** Дружелюбное сообщение вместо сырого 504 / timeout (логику запроса не меняем) */
function friendlyHttpOrTimeoutMessage(raw: string): {
  title: string;
  description: string;
} | null {
  const t = raw.trim();
  if (!t) return null;
  const low = t.toLowerCase();
  if (
    /\b504\b|\b503\b|\b502\b|\b500\b/i.test(t) ||
    low.includes("timeout") ||
    low.includes("timed out") ||
    low.includes("invocation") ||
    low.includes("function_invocation") ||
    low.includes("too many requests") ||
    low.includes("etimedout") ||
    low.includes("econnreset") ||
    low.includes("network error") ||
    low.includes("failed to fetch")
  ) {
    return {
      title: "Сервер не успел обработать запрос",
      description:
        "Обычно слишком большой объём: сузите рубрику, меньше брендов или одну сессию запуска позже. На бесплатном Vercel лимит времени короткий — для тяжёлых рубрик нужен платный режим или свой сервер."
    };
  }
  if (
    low.includes("не json") ||
    low.includes("not json") ||
    low.includes("html-страница ошибки") ||
    low.includes("обрыв соединения")
  ) {
    return {
      title: "Ответ сервера не удалось разобрать",
      description:
        "Часто это тайм‑аут или ошибка посредине ответа. Уменьшите задачу и повторите; при необходимости откройте F12 → Сеть → запрос /api/compare."
    };
  }
  return null;
}

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
  if (f === "nameAttr")
    return kind === "name_photo" || kind === "brand_visual";
  return kind === "unlikely";
}

function internalRowMatchesFilter(
  kind: "ean" | "name_photo" | "brand_visual" | "unlikely",
  f: DupKindFilter
) {
  if (f === "all") return true;
  if (f === "ean") return kind === "ean";
  if (f === "nameAttr")
    return kind === "name_photo" || kind === "brand_visual";
  return kind === "unlikely";
}

function isSoftDupScoreKind(k: string): boolean {
  return k === "name_photo" || k === "brand_visual" || k === "unlikely";
}

function onlyBCrossKindTitle(kind: string): string {
  switch (kind) {
    case "ean_diff_id":
      return "EAN, разные id";
    case "article":
      return "Артикул";
    case "name_photo":
      return "Надёжное: то же фото (ссылка) + название";
    case "brand_visual":
      return "Среднее: бренд, линейка, превью картинки";
    case "unlikely":
      return "Слабое: только на проверку глазами";
    default:
      return kind;
  }
}

function internalDupKindTitle(kind: string): string {
  switch (kind) {
    case "ean":
      return "EAN";
    case "name_photo":
      return "Надёжное (фото+название)";
    case "brand_visual":
      return "Среднее (бренд+превью)";
    case "unlikely":
      return "Слабое (на проверку)";
    default:
      return kind;
  }
}

function attrPresetIdFromMatch(m: {
  volume: boolean;
  shade: boolean;
  color: boolean;
}): string {
  return `${m.volume ? "v" : ""}${m.shade ? "s" : ""}${m.color ? "c" : ""}` || "off";
}

function attrMatchFromPresetId(id: string): {
  volume: boolean;
  shade: boolean;
  color: boolean;
} {
  switch (id) {
    case "off":
      return { volume: false, shade: false, color: false };
    case "v":
      return { volume: true, shade: false, color: false };
    case "s":
      return { volume: false, shade: true, color: false };
    case "c":
      return { volume: false, shade: false, color: true };
    case "vs":
      return { volume: true, shade: true, color: false };
    case "vc":
      return { volume: true, shade: false, color: true };
    case "sc":
      return { volume: false, shade: true, color: true };
    case "vsc":
      return { volume: true, shade: true, color: true };
    default:
      return { volume: false, shade: false, color: false };
  }
}

const ATTR_STRICT_OPTIONS: { value: string; label: string }[] = [
  {
    value: "off",
    label:
      "Не применять фильтр по характеристикам (не сужать пары название+фото по объёму / оттенку / цвету)"
  },
  { value: "v", label: "Ужесточать только по объёму" },
  { value: "s", label: "Ужесточать только по оттенку" },
  { value: "c", label: "Ужесточать только по цвету" },
  { value: "vs", label: "Объём + оттенок" },
  { value: "vc", label: "Объём + цвет" },
  { value: "sc", label: "Оттенок + цвет" },
  {
    value: "vsc",
    label: "Объём + оттенок + цвет (максимально строго для слоя название+фото)"
  }
];

export default function ComparePage() {
  const { data: session, status } = useSession();
  const [rubricA, setRubricA] = useState("");
  /** Сайт B: одна или несколько рубрик (id строками / запятыми) */
  const [rubricsBText, setRubricsBText] = useState("");
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
    "full" | "noveltiesArticle" | "notOnA" | "dupsA" | "dupsB" | "crossBvsA"
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
  /** После двух магазинов: только «новинки по id» на B или дубли новинок по артикулу против A */
  const [twoSiteGoal, setTwoSiteGoal] = useState<
    "noveltiesById" | "dupContourAgainstA"
  >("noveltiesById");
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
  const selectReportView = useCallback(
    (
      v:
        | "full"
        | "noveltiesArticle"
        | "notOnA"
        | "dupsA"
        | "dupsB"
        | "crossBvsA"
    ) => {
      setError(null);
      setReportView(v);
    },
    []
  );
  const skipModelFilter = useCallback(() => {
    setModelText("");
    setError(null);
  }, []);
  const [data, setData] = useState<CompareResult | SingleSiteDupsResult | null>(null);
  const compareAbortRef = useRef<AbortController | null>(null);
  const userCancelledRef = useRef(false);

  const rubricBParsedIds = useMemo(
    () => parseRubricIdsFromText(rubricsBText),
    [rubricsBText]
  );

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
          ...(compareMode === "twoSite" && rubricBParsedIds.length > 0
            ? { rubricsB: rubricBParsedIds }
            : {}),
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
      const raw = await res.text();
      let json: (CompareResult & { error?: string }) | (SingleSiteDupsResult & {
        error?: string;
      });
      try {
        json = (raw ? JSON.parse(raw) : {}) as typeof json;
      } catch {
        const oneLine = raw.replace(/\s+/g, " ").trim();
        const frag = oneLine.slice(0, 220);
        setError(
          `Ответ сервера не JSON (HTTP ${res.status}). Обычно это HTML-страница ошибки хостинга (тайм‑аут, нехватка памяти) или обрыв соединения. Фрагмент: ${frag || "—"}`
        );
        return;
      }
      if (!res.ok) {
        setError("error" in json && json.error ? json.error : `Ошибка ${res.status}`);
        return;
      }
      if ("error" in json && json.error) {
        setError(String(json.error));
        return;
      }
      const cmp = json as CompareResult | SingleSiteDupsResult;
      setData(cmp);
      if (
        compareMode === "twoSite" &&
        !("resultKind" in cmp && cmp.resultKind === "singleSiteDups")
      ) {
        selectReportView(twoSiteGoal === "noveltiesById" ? "notOnA" : "crossBvsA");
      }
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
    rubricBParsedIds,
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
    attrMatch,
    twoSiteGoal,
    selectReportView
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
  const rubricBOk =
    compareMode !== "twoSite" || rubricBParsedIds.length >= 1;

  const brandsRequiredForTwoSite =
    compareMode !== "twoSite" || brandListCount > 0;

  const comparePrimaryDisabled =
    loading ||
    !rubricAOk ||
    (compareMode === "twoSite" && !rubricBOk) ||
    !brandsRequiredForTwoSite;

  const compareDisabledHint = !loading
    ? !brandsRequiredForTwoSite && compareMode === "twoSite"
      ? "Для двух магазинов укажите хотя бы один бренд — поле ниже или «Добавить список из Excel». Без ограничения по бренду сравнение не запускается."
      : !rubricAOk
        ? "Кнопка ожидает числовой id рубрики A: выберите в списке выше или введите вручную в поле «Прямой ввод id». Нужен ключ API 12+ симв. в поле A, чтобы подгрузились рубрики."
        : compareMode === "twoSite" && !rubricBOk
          ? "Укажите хотя бы одну рубрику B: клик в каскаде добавляет id в список, либо введите id вручную — несколько через запятую или с новой строки. Если ключ B пуст, каскад B строится по ключу A."
          : null
    : null;

  /** Основная задача страницы (три понятных сценария для контента) */
  type CatalogMainTask =
    | "singleDups"
    | "twoSite_noveltiesById"
    | "twoSite_dupContour";

  const catalogMainTask: CatalogMainTask = useMemo(() => {
    if (compareMode === "singleDups") return "singleDups";
    return twoSiteGoal === "noveltiesById"
      ? "twoSite_noveltiesById"
      : "twoSite_dupContour";
  }, [compareMode, twoSiteGoal]);

  /** Текст главной кнопки запуска (без «Загрузка…») */
  const primaryRunButtonLabel = useMemo(() => {
    if (compareMode === "singleDups") return "Найти дубли";
    return twoSiteGoal === "noveltiesById" ? "Найти новинки" : "Сравнить витрины";
  }, [compareMode, twoSiteGoal]);

  const applyCatalogMainTask = useCallback((t: CatalogMainTask) => {
    setError(null);
    if (t === "singleDups") {
      setCompareMode("singleDups");
      return;
    }
    setCompareMode("twoSite");
    setTwoSiteGoal(
      t === "twoSite_noveltiesById" ? "noveltiesById" : "dupContourAgainstA"
    );
  }, []);

  const catalogTaskTitle = useMemo(() => {
    switch (catalogMainTask) {
      case "singleDups":
        return "Найти дубли в одной рубрике";
      case "twoSite_noveltiesById":
        return "Товары-новинки на второй витрине (нет того же id на A)";
      case "twoSite_dupContour":
        return "Кандидаты в дубль между витринами";
      default:
        return "";
    }
  }, [catalogMainTask]);

  /** Подписи A/B для блока-помощника до загрузки данных */
  const assistantSiteNames = useMemo(() => {
    const a = siteLabelA.trim() || "опорный сайт (A)";
    const b = siteLabelB.trim() || "второй сайт (B)";
    return { a, b };
  }, [siteLabelA, siteLabelB]);

  const assistantSteps = useMemo(() => {
    const rubricsReady =
      rubricAOk && (compareMode === "singleDups" || rubricBOk);
    const filtersReady =
      compareMode !== "twoSite" || brandsRequiredForTwoSite;
    const readyToRun =
      rubricsReady && filtersReady && !loading;
    const step3Title =
      compareMode === "twoSite"
        ? "Бренды (обязательно) и доп. фильтры"
        : "Доп. фильтры: бренды, модели, id";
    return [
      {
        n: 1,
        title: "Задача",
        hint:
          compareMode === "singleDups"
            ? "Ищем повторы и похожие карточки внутри одной рубрики одной витрины."
            : twoSiteGoal === "noveltiesById"
              ? "Две витрины: список позиций на B без той же карточки по внутреннему id на A."
              : "Две витрины: таблица пар для ручной проверки (код, название, фото).",
        ok: true,
        fix: null as string | null
      },
      {
        n: 2,
        title: "Рубрики",
        hint:
          compareMode === "twoSite"
            ? "A — одна рубрика; B — одна или несколько (если товары разнесены по каталогу), id в списке."
            : "Нужна одна рубрика (id больше нуля).",
        ok: rubricsReady,
        fix: !rubricAOk
          ? "Укажите рубрику для сайта A."
          : compareMode === "twoSite" && !rubricBOk
            ? "Укажите хотя бы один id рубрики для сайта B (список ниже)."
            : null
      },
      {
        n: 3,
        title: step3Title,
        hint:
          compareMode === "twoSite"
            ? "Обязательно укажите бренды; при необходимости откройте блоки ниже — модели, исключение id, ужесточение по объёму/цвету."
            : "По желанию сузьте рубрику брендами, моделями или уберите лишние id с опорной витрины.",
        ok: filtersReady,
        fix:
          compareMode === "twoSite" && !brandsRequiredForTwoSite
            ? "Добавьте хотя бы один бренд в поле ниже или загрузите список из файла."
            : null
      },
      {
        n: 4,
        title: "Запуск",
        hint: "Один запрос: всё считается сразу; дальше только переключение вкладок.",
        ok: readyToRun,
        fix:
          rubricsReady && filtersReady ? null : "Сначала закройте шаги выше.",
        anchor: "#compare-run-anchor"
      }
    ];
  }, [
    compareMode,
    twoSiteGoal,
    rubricAOk,
    rubricBOk,
    brandsRequiredForTwoSite,
    loading
  ]);

  const assistantOutcomeLines = useMemo(() => {
    const { a: la, b: lb } = assistantSiteNames;
    const out: string[] = [];

    if (compareMode === "singleDups") {
      out.push(
        `После «Найти дубли» вы получите отчёт: где внутри одной рубрики на «${la}» встречаются похожие или одинаковые карточки.`
      );
      if (brandListCount > 0) {
        out.push(
          `В расчёт попадут только товары с брендами из вашего списка (${brandListCount} поз.).`
        );
      } else {
        out.push("Бренды не заданы — в расчёт идёт вся активная выгрузка рубрики (как её отдаёт API).");
      }
    } else if (twoSiteGoal === "noveltiesById") {
      out.push(
        `Первым экраном откроются товары на «${lb}», для которых нет пары с тем же внутренним id на «${la}». Это список «новых номенклатурных карточек» относительно опоры, если смотреть по id.`
      );
      out.push("Таблицу можно сохранить в Excel на открывшейся вкладке.");
    } else {
      out.push(
        `Первым откроется сравнение пар: карточка на «${la}» и кандидат с «${lb}» — сначала надёжные совпадения по коду, затем мягкие по названию и картинке.`
      );
      out.push("Удобно проверять глазами, не путая с «новинкой только по id».");
    }

    if (compareMode === "twoSite" && rubricBParsedIds.length > 1) {
      out.push(
        `На «${lb}» задаёте ${rubricBParsedIds.length} рубрик: выгрузки идут параллельно, товары склеиваются без дубля по id — удобно, когда нужный бренд размазан по разным веткам каталога (часто надёжнее одной «толстой» родительской рубрики).`
      );
    }

    if (compareMode === "twoSite" && brandListCount > 0) {
      out.push(
        `Брендов в фильтре: ${brandListCount} — именно они ограничивают обе выгрузки.`
      );
    }

    if (modelListCount > 0) {
      out.push(
        `Фильтр по моделям включён (${modelListCount} строк в списке): в отчёт попадут только подходящие названия.`
      );
    }
    if (excludeIdsListCount > 0 && compareMode === "twoSite") {
      out.push(
        `${excludeIdsListCount} id заранее убраны из опорной выгрузки «${la}» — эти карточки как будто отсутствуют при сравнении.`
      );
    }

    const ap = attrPresetIdFromMatch(attrMatch);
    if (compareMode !== "singleDups") {
      if (ap === "off") {
        out.push(
          "Пары «по названию и фото» не дополнительно сужаются по объёму, оттенку или цвету."
        );
      } else {
        const label =
          ATTR_STRICT_OPTIONS.find((o) => o.value === ap)?.label ??
          "";
        out.push(
          `Ужесточение для похожих по названию и фото: ${label.charAt(0).toLowerCase()}${label.slice(1)}`
        );
      }
    }

    return out;
  }, [
    assistantSiteNames,
    compareMode,
    twoSiteGoal,
    brandListCount,
    modelListCount,
    excludeIdsListCount,
    attrMatch,
    rubricBParsedIds
  ]);

  const assistantNextAction = useMemo(() => {
    const s = assistantSteps.find((x) => !x.ok);
    if (s?.fix) return s.fix;
    if (
      loading &&
      assistantSteps.slice(0, 3).every((x) => x.ok)
    ) {
      return "Идёт выгрузка и расчёт… Дождитесь результата или нажмите «Отменить».";
    }
    if (assistantSteps.every((x) => x.ok) && !loading) {
      return `Можно нажать «${primaryRunButtonLabel}» внизу формы.`;
    }
    return null;
  }, [assistantSteps, loading, primaryRunButtonLabel]);

  const isSingleDups = (
    d: CompareResult | SingleSiteDupsResult | null
  ): d is SingleSiteDupsResult =>
    d != null && "resultKind" in d && d.resultKind === "singleSiteDups";

  /** Подписи A/B для панели отчётов до и после загрузки результата */
  const reportLabels = useMemo(() => {
    const defA = siteLabelA.trim() || "Сайт A";
    const defB = siteLabelB.trim() || "Сайт B";
    if (data && !isSingleDups(data))
      return { siteA: data.siteALabel, siteB: data.siteBLabel };
    return { siteA: defA, siteB: defB };
  }, [data, siteLabelA, siteLabelB]);

  type CrossBvsARow = {
    kind:
      | "ean_diff_id"
      | "name_photo"
      | "brand_visual"
      | "article"
      | "unlikely";
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

  /** Строки толькоBCrossWithA по слоям (для счётчиков переключателей второго контура). */
  const crossRowKindCounts = useMemo(() => {
    if (!data || isSingleDups(data)) {
      return { codeLayer: 0, nameAttr: 0, unlikely: 0, total: 0 };
    }
    let codeLayer = 0;
    let nameAttr = 0;
    let unlikely = 0;
    for (const r of data.onlyBCrossWithA ?? []) {
      if (crossRowMatchesFilter(r.kind, "ean")) codeLayer++;
      else if (r.kind === "name_photo" || r.kind === "brand_visual")
        nameAttr++;
      else if (r.kind === "unlikely") unlikely++;
    }
    return {
      codeLayer,
      nameAttr,
      unlikely,
      total: (data.onlyBCrossWithA ?? []).length
    };
  }, [data]);

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

  /** Новинки B: артикулы этой карточки не встречаются в каталоге A (после фильтров). */
  const noveltiesBList = useMemo((): CompareProduct[] => {
    if (!data || "resultKind" in data) return [];
    return (data.noveltiesByArticleRaw ?? []).map((p) => toCompareProduct(p));
  }, [data]);

  const downloadNoveltiesPlainExcel = useCallback(async () => {
    if (!data || "resultKind" in data || !data.noveltiesByArticleRaw?.length)
      return;
    setError(null);
    try {
      const { downloadNoveltiesByArticleExcel } = await import(
        "@/lib/exportOnlyB"
      );
      await downloadNoveltiesByArticleExcel(
        data.noveltiesByArticleRaw,
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

  const downloadNoveltiesWithDupColsExcel = useCallback(async () => {
    if (!data || "resultKind" in data || !data.noveltiesByArticleRaw?.length)
      return;
    setError(null);
    try {
      const { downloadNoveltiesByArticleWithDupColumnsExcel } = await import(
        "@/lib/exportOnlyB"
      );
      await downloadNoveltiesByArticleWithDupColumnsExcel(
        data.noveltiesByArticleRaw,
        data.onlyBCrossWithA ?? [],
        data.nameLocale,
        data.siteBLabel || "site_B",
        data.siteALabel || "A"
      );
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Не удалось сформировать Excel (нужен пакет xlsx: npm install)"
      );
    }
  }, [data]);

  const downloadCrossDupPairsExcel = useCallback(async () => {
    if (!data || "resultKind" in data) return;
    const rows = onlyBCrossWithAFiltered;
    if (!rows.length) return;
    setError(null);
    try {
      const { downloadCrossDuplicatePairsExcel } = await import(
        "@/lib/exportOnlyB"
      );
      await downloadCrossDuplicatePairsExcel(
        rows,
        data.nameLocale,
        data.siteBLabel || "site_B",
        data.siteALabel || "A",
        data.siteBLabel || "B"
      );
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Не удалось сформировать Excel (нужен пакет xlsx: npm install)"
      );
    }
  }, [data, onlyBCrossWithAFiltered]);

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
      <div className={compareFormNarrow}>
      <header className={appCompareHeaderCard}>
        <div className="max-w-2xl">
          <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            <AssistantBrand size="compact" />
            <BackToAssistant />
          </div>
          <p className={`${homeCardTitle} mb-1`}>Ассистент контента</p>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
            Сравнение каталогов
          </h1>
          <p className="text-base text-slate-800 mt-3 leading-relaxed">
            Страница ведёт по шагам: вы выбираете витрины и рубрики, при необходимости сужаете список
            брендами — дальше система сама соберёт таблицу (
            {compareMode === "singleDups"
              ? "дубли в одной рубрике"
              : "новинки второй витрины или пары для проверки"}
            ). Жёлтый блок ниже коротко напоминает, чего не хватает и{" "}
            <strong className="font-semibold text-slate-900">что будет в отчёте</strong> при ваших
            фильтрах.
          </p>
          <details className="mt-3 rounded-lg border border-slate-200/90 bg-slate-50/60 px-3 py-2">
            <summary className="cursor-pointer text-sm font-medium text-sky-900 hover:text-sky-950">
              Подробнее для специалистов: EAN, артикул, название и фото
            </summary>
            <p className="text-sm text-slate-600 mt-2 leading-relaxed pb-1">
              Сначала сопоставляем по <strong>штрихкоду (EAN)</strong> и{" "}
              <strong>артикулу</strong> из API — это надёжные «якоря». Затем — по бренду и
              <strong> модельной части названия</strong> + фото: одинаковый URL картинки, либо одна
              «семья» карточки (суффикс <code className="text-[11px]">-a…</code> в ссылке) и совпадение
              объёма. Настройки объёма / оттенка / цвета в форме ужесточают пары «название + фото». Ключи —
              в форме или{" "}
              <code className="text-xs bg-white/80 px-1.5 py-0.5 rounded border border-slate-200">
                .env
              </code>
              .
            </p>
          </details>
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

      <section
        className="mb-8 rounded-2xl border-2 border-amber-200/90 bg-gradient-to-br from-amber-50/95 via-white to-slate-50/40 p-5 shadow-sm ring-1 ring-amber-100/50 sm:p-6"
        aria-label="Пошаговая подсказка для контента"
      >
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className={`${homeCardTitle} text-amber-900/80`}>
              Памятка контенту
            </p>
            <h2 className="text-lg font-bold text-slate-900 mt-0.5">
              Сначала выберите задачу
            </h2>
            <p className="text-sm text-slate-700 mt-1 max-w-3xl leading-relaxed">
              От выбора зависит, какие поля обязательны и что откроется первым после расчёта. Потом
              заполните ключи, рубрики и при необходимости — дополнительные фильтры ниже по форме.
            </p>
          </div>
        </div>

        <div
          className="mb-6 rounded-xl border border-amber-300/70 bg-white/80 px-3 py-4 sm:px-4"
          role="group"
          aria-label="Выбор основной задачи"
        >
          <p className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">
            Что хотим сделать?
          </p>
          <div className="grid gap-3 md:grid-cols-3">
            <button
              type="button"
              onClick={() => applyCatalogMainTask("singleDups")}
              className={`rounded-xl border-2 p-4 text-left transition ${
                catalogMainTask === "singleDups"
                  ? "border-emerald-600 bg-emerald-50/70 shadow-sm ring-1 ring-emerald-200/60"
                  : "border-slate-200 bg-white hover:border-amber-300/80"
              }`}
            >
              <p className="text-sm font-bold text-slate-900 leading-snug">
                Найти дубли в одной рубрике
              </p>
              <p className="mt-2 text-xs text-slate-600 leading-relaxed">
                Одна витрина, один ключ и одна рубрика: где в каталоге есть похожие или повторяющиеся
                карточки.
              </p>
            </button>
            <button
              type="button"
              onClick={() => applyCatalogMainTask("twoSite_noveltiesById")}
              className={`rounded-xl border-2 p-4 text-left transition ${
                catalogMainTask === "twoSite_noveltiesById"
                  ? "border-emerald-600 bg-emerald-50/70 shadow-sm ring-1 ring-emerald-200/60"
                  : "border-slate-200 bg-white hover:border-amber-300/80"
              }`}
            >
              <p className="text-sm font-bold text-slate-900 leading-snug">
                Новинки: нет того же ID на первой витрине (A)
              </p>
              <p className="mt-2 text-xs text-slate-600 leading-relaxed">
                Товары-новинки на B: опорная витрина A не содержит карточку с тем же{" "}
                <strong className="font-semibold text-slate-800">внутренним id</strong>. Удобно
                смотреть, чего не хватает в опорном каталоге.
              </p>
            </button>
            <button
              type="button"
              onClick={() => applyCatalogMainTask("twoSite_dupContour")}
              className={`rounded-xl border-2 p-4 text-left transition ${
                catalogMainTask === "twoSite_dupContour"
                  ? "border-emerald-600 bg-emerald-50/70 shadow-sm ring-1 ring-emerald-200/60"
                  : "border-slate-200 bg-white hover:border-amber-300/80"
              }`}
            >
              <p className="text-sm font-bold text-slate-900 leading-snug">
                Кандидаты в дубль — проверить вручную
              </p>
              <p className="mt-2 text-xs text-slate-600 leading-relaxed">
                Две витрины: таблица «карточка на A — похожая на B» (код, название, фото). Внутри могут быть
                и надёжные совпадения по штрихкоду — смотреть нужно каждую строку.
              </p>
            </button>
          </div>
        </div>

        <p className={`${homeCardTitle} text-amber-900/80 mb-1`}>
          Порядок заполнения
        </p>
        <p className="text-base font-semibold text-slate-900 mb-4">
          Шаги и результат при ваших фильтрах
        </p>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mb-5">
          {assistantSteps.map((st) => (
            <div
              key={st.n}
              className={`rounded-xl border px-3 py-3 sm:px-3.5 sm:py-3.5 ${
                st.ok
                  ? "border-emerald-300/80 bg-emerald-50/50"
                  : "border-amber-300/90 bg-white/90"
              }`}
            >
              <div className="flex items-center gap-2 mb-1.5">
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                    st.ok
                      ? "bg-emerald-600 text-white"
                      : "bg-amber-500 text-white"
                  }`}
                  aria-hidden
                >
                  {st.n}
                </span>
                <span className="text-sm font-semibold text-slate-900 leading-tight">
                  {st.title}
                </span>
                <span
                  className={`ml-auto text-[11px] font-semibold uppercase tracking-wide ${
                    st.ok ? "text-emerald-800" : "text-amber-800"
                  }`}
                >
                  {st.ok ? "готово" : "нужно"}
                </span>
              </div>
              <p className="text-xs text-slate-700 leading-relaxed">{st.hint}</p>
              {st.n === 4 && (
                <p className="mt-2 text-[11px]">
                  <a
                    href="#compare-run-anchor"
                    className="font-medium text-sky-800 underline decoration-sky-200 underline-offset-2 hover:text-sky-950"
                  >
                    Перейти к кнопке запуска
                  </a>
                </p>
              )}
            </div>
          ))}
        </div>

        {assistantNextAction && (
          <p className="mb-4 rounded-lg border border-sky-200/80 bg-sky-50/80 px-3 py-2.5 text-sm font-medium text-sky-950">
            Сейчас: {assistantNextAction}
          </p>
        )}

        <div className="rounded-xl border border-slate-200 bg-white/90 px-4 py-3">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
            Если запустить расчёт с этими фильтрами
          </p>
          <ul className="list-disc pl-4 space-y-1.5 text-sm text-slate-800 leading-relaxed">
            {assistantOutcomeLines.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className={appSectionCard}>
        <div className={homeCardHeader + " mb-5 -mx-5 -mt-5 sm:-mx-6 sm:-mt-6 rounded-t-2xl"}>
          <h2 className={homeCardTitle}>Параметры выгрузки</h2>
          <p className="mt-2 text-sm text-slate-600 leading-relaxed max-w-xl">
            Ключи, рубрики и фильтры — здесь задаётся, что именно загрузится из API.
          </p>
        </div>
        <h2 className="text-sm font-semibold text-slate-800 mb-3">
          Ключи API (4Partners) и подписи
        </h2>
        <p className="text-xs text-slate-500 mb-3">
          Один токен — одна витрина. Для двух магазинов — два ключа. Если оставить
          пустым, будут взяты значения из <code className="bg-slate-100 px-1">.env</code>{" "}
          (если заданы).
        </p>
        <div className="mb-4 rounded-lg border border-slate-200/90 bg-slate-50/90 px-3 py-2.5 text-[11px] text-slate-600 leading-relaxed">
          <p className="font-semibold text-slate-700 mb-1.5">Роли витрин</p>
          <ul className="list-disc pl-4 space-y-1">
            <li>
              <strong className="text-slate-800">Сайт A</strong> —{" "}
              <span className="text-emerald-800 font-medium">сайт для сравнения</span>{" "}
              (опорный каталог: его рубрика, исключения по id, фильтры в первую очередь к
              этой выгрузке).
            </li>
            <li>
              <strong className="text-slate-800">Сайт B</strong> —{" "}
              <span className="text-emerald-800 font-medium">где ищем новинки</span> и
              недостающие позиции относительно A (режим «два магазина»). В режиме «дубли в
              одной рубрике» используется только ключ и рубрика A — поля B скрыты.
            </li>
          </ul>
        </div>
        <div className="grid sm:grid-cols-2 gap-4 mb-3">
          <label className="block">
            <span
              className="text-xs font-medium text-slate-700"
              title="Сайт для сравнения — опорный каталог A"
            >
              Ключ API, сайт A — для сравнения (X-Auth-Token)
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
              Ключ API, сайт B — где ищем новинки
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
              placeholder="Hermès, топ поставщиков …"
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

        <p className="text-sm font-semibold text-slate-900 mb-4 mt-6 px-0.5 border-l-4 border-slate-300 pl-3 py-0.5">
          Текущая задача: {catalogTaskTitle}
        </p>

        <details className="mb-4 rounded-xl border-2 border-amber-200/90 bg-amber-50/20" open>
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-900">
            Рубрики<span className="text-red-600 ml-0.5">*</span> — выберите рубрики для выгрузки (обязательно)
          </summary>
          <div className="border-t border-amber-100/90 px-4 pb-4 pt-3 space-y-3">
            <p className="text-xs text-slate-600">
              <strong>Сайт A:</strong> выберите рубрику для сравнения (опорный каталог в отчёте).
              {compareMode === "twoSite" ? (
                <>
                  {" "}
                  <strong>Сайт B:</strong> можно указать <strong>несколько рубрик</strong> —
                  объединим выгрузки (товары не дублируются по id). Удобно, если нужный ассортимент
                  разнесён по веткам каталога.
                </>
              ) : null}{" "}
              Только <strong>активные</strong> рубрики; ниже можно ввести id вручную.
              {compareMode === "twoSite" && (
                <span className="block mt-1 text-slate-500">
                  Если ключ B пуст, каскад B строится на том же ключе, что и A.
                </span>
              )}
            </p>
        <div
          className={`grid gap-4 mb-2 ${
            compareMode === "twoSite" ? "sm:grid-cols-2" : ""
          }`}
        >
          <RubricCascadeSelect
            label={
              compareMode === "singleDups"
                ? "Рубрика"
                : "Выберите рубрику, сайт A (для сравнения)"
            }
            token={tokenA}
            value={rubricA}
            onChange={setRubricA}
          />
          {compareMode === "twoSite" && (
            <div className="space-y-2">
              <RubricCascadeSelect
                label="Сайт B — клик по рубрике добавляет её id в список ниже"
                token={tokenForRubricsB}
                value=""
                onChange={(idStr) => {
                  const id = Number(String(idStr).replace(/\D/g, ""));
                  if (id > 0) {
                    setRubricsBText((prev) =>
                      mergeUniqueSortedRubricId(prev, id)
                    );
                  }
                }}
              />
            </div>
          )}
        </div>
        <div className="mb-3 rounded-xl border border-dashed border-slate-200 bg-white/70 p-3">
          <p className="text-xs font-semibold text-slate-800 mb-1">
            Или прямой ввод id рубрики (из админки / API)
          </p>
          <p className="text-[11px] text-slate-500 mb-2">
            Для A — одно число. Для B — несколько id (каждый добавляет каскад или вводите сами).
            Кнопка запуска внизу активна, если для A задан id &gt; 0
            {compareMode === "twoSite" ? " и в списке B есть хотя бы один id." : "."}
          </p>
          <div
            className={`grid gap-3 ${
              compareMode === "twoSite" ? "sm:grid-cols-2" : ""
            }`}
          >
            <label className="block">
              <span className="text-xs text-slate-600">
                Id рубрики{compareMode === "twoSite" ? " — сайт A" : ""}
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
              <label className="block sm:col-span-2">
                <span className="text-xs font-medium text-slate-700">
                  Id рубрик сайта B — одна или несколько (с новой строки или через запятую)
                </span>
                <textarea
                  className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono min-h-[88px]"
                  value={rubricsBText}
                  onChange={(e) => setRubricsBText(e.target.value)}
                  placeholder={"123456\n234567"}
                  spellCheck={false}
                />
                <p className="mt-1 text-[11px] text-slate-500">
                  Рекомендация при таймаутах: сузить набор узкими рубриками вместо одной огромной
                  родительской.
                </p>
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
                  {rubricBOk
                    ? `${rubricBParsedIds.length} рубр.: ${rubricBParsedIds.join(", ")}`
                    : "нужен хотя бы один id"}
                </strong>
              </>
            )}
          </p>
        </div>
        <div className="grid sm:grid-cols-2 gap-4 mb-1">
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
          </div>
        </details>

        {(compareMode === "twoSite" || compareMode === "singleDups") && (
          <details className="mb-4 rounded-xl border border-slate-200 bg-white shadow-sm ring-1 ring-slate-200/40" open>
            <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-slate-900 [&::-webkit-details-marker]:hidden flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="rounded-lg bg-amber-100/80 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-900">
                Текст карточки
              </span>
              <span>Объём, оттенок и цвет в паре «название + фото»</span>
              <span className="text-red-600">*</span>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                className="ml-auto inline-flex h-7 min-w-[1.75rem] items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-xs font-bold text-slate-600 hover:border-amber-300 hover:bg-white"
                title={ATTR_PAIR_HINT_POPOVER}
                aria-label="Пояснение по объёму, оттенку и цвету"
              >
                ?
              </button>
            </summary>
            <div className="border-t border-slate-100 px-4 pb-4 pt-3 space-y-3 text-sm text-slate-700">
              <label className="block">
                <span className="text-xs font-medium text-slate-700">
                  Вариант проверки (обязательно выберите; можно «не применять»)
                </span>
                <select
                  className={`${homeInput} mt-1`}
                  value={attrPresetIdFromMatch(attrMatch)}
                  onChange={(e) => setAttrMatch(attrMatchFromPresetId(e.target.value))}
                >
                  {ATTR_STRICT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            {compareMode === "twoSite" && (
              <p className="text-slate-600 text-sm">
                <strong>Обычный сценарий:</strong> в рубрику <strong>сайта A</strong> заведите{" "}
                <strong>часть</strong> товара, в рубрику <strong>сайта B</strong> —{" "}
                <strong>полный</strong> каталог. Пары строим по EAN и по названию+фото.
              </p>
            )}
            <p className="text-slate-600 text-sm">
              Если отмечено несколько характеристик, проверяется <strong>каждая</strong> из них: где
              у <strong>обеих</strong> карточек есть значение и оно <strong>не совпадает</strong> —
              мягкая пара отбрасывается по этому полю. Если у одной карточки поле пустое — именно эта
              отмеченная проверка пару не отменит.
            </p>
            <p className="text-slate-600 text-sm">
              <strong>Слой «слабых» кандидатов (~45%)</strong> считается отдельно: объём / оттенок /
              цвет его не отфильтровывают (могут показываться только в подписи к паре).
            </p>
            <p className="text-xs text-slate-500">
              Изменение вступит в силу после нового запуска: «{primaryRunButtonLabel}».
            </p>
            </div>
          </details>
        )}

        <details className={`mb-4 rounded-xl bg-slate-50/40 ${compareMode === "twoSite" ? "border-2 border-amber-200/90" : "border border-slate-200"}`} open>
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-900">
            Бренды
            {compareMode === "twoSite" ? (
              <>
                <span className="text-red-600 ml-0.5">*</span> — обязательный фильтр
              </>
            ) : (
              <span className="font-normal text-slate-600">
                {" "}
                · дополнительный фильтр (можно не заполнять — тогда вся рубрика)
              </span>
            )}
          </summary>
          <div className="border-t border-amber-100/90 px-4 pb-4 pt-3 space-y-3">
            <p className="text-xs text-slate-600">
              <strong>Введите бренды вручную</strong> (по одному в строке или через запятую)
              и/или <strong>добавьте список из Excel/CSV</strong> — первый столбец, одна
              позиция в строке.
              {compareMode === "twoSite" ? (
                <>
                  {" "}
                  Для <strong>двух магазинов</strong> нужен <strong>хотя бы один</strong> бренд
                  — иначе запуск недоступен.
                </>
              ) : (
                <> Пустой список — вся рубрика.</>
              )}{" "}
              Без распознанного бренда в API товар не попадёт в выборку, если фильтр задан.
            </p>
        <label className="inline-flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
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
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono min-h-[120px]"
          value={brandText}
          onChange={(e) => setBrandText(e.target.value)}
          placeholder={"La Roche-Posay\nVichy\nCeraVe\nили в одну строку: A, B; C"}
          spellCheck={false}
        />
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-xs font-medium text-slate-700">Добавить список брендов:</span>
          <input
            type="file"
            accept=".xlsx,.xls,.xlsm,.csv,.txt"
            onChange={onBrandFile}
            className="text-slate-700 text-xs max-w-full"
          />
          <span className="text-xs text-slate-500">
            Excel/CSV — первый столбец первого листа.
          </span>
        </div>
        {brandListCount > 0 && (
          <p className="text-xs font-medium text-emerald-800">
            В списке: {brandListCount} бренд(ов) — можно сравнить
          </p>
        )}
          </div>
        </details>

        <details className="mb-4 rounded-xl border border-slate-200 bg-slate-50/40">
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-900">
            Дополнительно: сузить выборку по модели в названии
          </summary>
          <div className="border-t border-slate-100 px-4 pb-4 pt-3 space-y-3">
            <p className="text-xs text-slate-600">
              Если добавить модели, поиск по модели <strong>включается</strong>: отбор по
              подстрокам в названиях (RU/EN, оригинальные поля и «модельная» часть после
              снятия бренда). Пустое поле — фильтра по модели нет.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={skipModelFilter}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Пропустить фильтр по модели
              </button>
              {modelListCount === 0 && (
                <span className="text-[11px] text-slate-500">сейчас отключён (список пуст)</span>
              )}
            </div>
        <label className="inline-flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
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
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono min-h-[100px]"
          value={modelText}
          onChange={(e) => setModelText(e.target.value)}
          placeholder={"ARGAN SUBLIME\nMan Aqua\n— по одной модели в строке"}
          spellCheck={false}
        />
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-xs font-medium text-slate-700">Добавить список из файла:</span>
          <input
            type="file"
            accept=".xlsx,.xls,.xlsm,.csv,.txt"
            onChange={onModelFile}
            className="text-slate-700 text-xs max-w-full"
          />
          <span className="text-xs text-slate-500">Первый столбец, как у брендов.</span>
        </div>
        {modelListCount > 0 && (
          <p className="text-xs font-medium text-sky-800">
            Активен фильтр: {modelListCount} строк(и) в списке моделей
          </p>
        )}
          </div>
        </details>

        <details className="mb-4 rounded-xl border border-slate-200/90 bg-slate-50/50 shadow-sm ring-1 ring-slate-200/30">
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-900 hover:bg-white/70 rounded-xl transition [&::-webkit-details-marker]:hidden list-none flex items-center gap-2">
            <span aria-hidden className="text-slate-400 select-none">
              ▸
            </span>
            Дополнительные условия (опционально)
          </summary>
          <div className="border-t border-slate-100 px-4 pb-4 pt-2 space-y-4">
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-4">
              <h3 className="text-sm font-semibold text-slate-900 mb-2">
                Исключить товары по ID
              </h3>
              <p className="text-xs text-slate-600 mb-3 leading-relaxed">
                Укажите <strong className="text-slate-800">внутренние id</strong> позиций на{" "}
                <strong className="text-slate-800">опорной витрине A</strong>. После выгрузки рубрики
                они убираются из каталога A; к оставшемуся применяются бренды и модели. Витрина B этим списком
                не ограничивается.
              </p>
              <textarea
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-mono min-h-[100px] shadow-sm"
                value={excludeIdsText}
                onChange={(e) => setExcludeIdsText(e.target.value)}
                placeholder={"12345\n23456\nили: 1,2;3"}
                spellCheck={false}
              />
              <div className="flex flex-wrap items-center gap-3 text-sm mt-3">
                <input
                  type="file"
                  accept=".xlsx,.xls,.xlsm,.csv,.txt"
                  onChange={onExcludeIdsFile}
                  className="text-slate-700 text-xs max-w-full"
                />
                <span className="text-xs text-slate-500">
                  Excel/CSV/TXT: id в <strong>первом столбце</strong>. Загрузка{" "}
                  <strong>добавляет</strong> к полю, без дублей.
                </span>
              </div>
              {excludeIdsListCount > 0 && (
                <p className="text-xs text-slate-600 mt-2">
                  Уникальных id в поле: {excludeIdsListCount}
                </p>
              )}
            </div>
          </div>
        </details>

        {compareMode === "twoSite" && (
          <>
            <div className="mb-4 p-5 rounded-2xl border border-sky-200 bg-sky-50/80 text-slate-800">
              <p className="text-base font-semibold text-sky-950 mb-2">Три вещи, которые важно знать</p>
              <ol className="list-decimal pl-5 space-y-2 text-sm leading-relaxed text-slate-700">
                <li>
                  Сначала нажимаете <strong>«{primaryRunButtonLabel}»</strong> внизу — один раз загружаем данные.
                </li>
                <li>
                  <strong>Зелёный блок</strong> — что показать <em>первым</em> после расчёта. Можно
                  поменять в любой момент, заново считать не нужно.
                </li>
                <li>
                  Серо-белый блок ниже — <strong>только если нужен другой вид таблицы</strong> (полная
                  страница, новинки по артикулу, дубли внутри рубрики и т.д.). По умолчанию можно не
                  открывать.
                </li>
              </ol>
            </div>

            <div className="mb-6 p-5 sm:p-6 rounded-2xl border-2 border-emerald-600/35 bg-emerald-50/60 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wider text-emerald-900/80 mb-1">
                Главное — выберите один вариант
              </p>
              <h3 className="text-lg sm:text-xl font-bold text-emerald-950 mb-3">
                Что показать первым после расчёта
              </h3>
              <p className="text-sm text-slate-700 mb-5 max-w-prose leading-relaxed">
                То же, что блок «Что хотим сделать?» вверху страницы: нажмите одну большую карточку —
                именно её увидят после расчёта.
              </p>
              <div className="flex flex-col gap-3">
                <button
                  type="button"
                  onClick={() => applyCatalogMainTask("twoSite_noveltiesById")}
                  className={`rounded-2xl border-2 px-5 py-4 text-left transition ${
                    twoSiteGoal === "noveltiesById"
                      ? "border-emerald-600 bg-white shadow-md ring-2 ring-emerald-500/25"
                      : "border-slate-200 bg-white/90 hover:border-emerald-300"
                  }`}
                >
                  <span className="block text-base font-bold text-slate-900 leading-snug">
                    Товары-новинки на {reportLabels.siteB}{" "}
                    <span className="font-normal text-slate-600">(нет id на {reportLabels.siteA})</span>
                  </span>
                  <span className="mt-2 block text-sm text-slate-600 leading-relaxed">
                    Товары, для которых на {reportLabels.siteA} нет карточки с тем же внутренним
                    номером. Удобно смотреть «чего нет у нас». На экране будет кнопка выгрузки в
                    Excel.
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => applyCatalogMainTask("twoSite_dupContour")}
                  className={`rounded-2xl border-2 px-5 py-4 text-left transition ${
                    twoSiteGoal === "dupContourAgainstA"
                      ? "border-emerald-600 bg-white shadow-md ring-2 ring-emerald-500/25"
                      : "border-slate-200 bg-white/90 hover:border-emerald-300"
                  }`}
                >
                  <span className="block text-base font-bold text-slate-900 leading-snug">
                    Похожесть между витринами{" "}
                    <span className="font-normal text-slate-600">(проверить вручную)</span>
                  </span>
                  <span className="mt-2 block text-sm text-slate-600 leading-relaxed">
                    Для ручной проверки возможных дублей: скан, код, название рядом. Сначала
                    надёжные совпадения, затем более мягкие.
                  </span>
                </button>
              </div>
              <p className="mt-5 text-sm font-medium text-emerald-950 rounded-xl bg-white border border-emerald-200/90 px-4 py-3">
                {twoSiteGoal === "noveltiesById" ? (
                  <>
                    После расчёта первым откроется{" "}
                    <strong>список новинок на {reportLabels.siteB}</strong> (без пары по id на{" "}
                    {reportLabels.siteA}).
                  </>
                ) : (
                  <>
                    После расчёта первым откроется{" "}
                    <strong>таблица пар «{reportLabels.siteA} — {reportLabels.siteB}»</strong>.
                  </>
                )}
              </p>
            </div>

            <details className="mb-6 group rounded-2xl border-2 border-slate-200 bg-white shadow-sm overflow-hidden">
              <summary className="cursor-pointer list-none px-5 py-4 sm:py-5 hover:bg-slate-50 transition [&::-webkit-details-marker]:hidden flex flex-col gap-1">
                <span className="text-lg font-bold text-slate-900">
                  Другие отчёты
                </span>
                <span className="text-sm text-slate-600 font-normal leading-snug max-w-xl">
                  Нажмите, если нужна не та таблица, что в зелёном блоке. Повторно нажимать «
                  {primaryRunButtonLabel}» не нужно — данные уже готовы.
                </span>
                <span className="text-xs text-emerald-800 font-semibold mt-2 group-open:hidden">
                  Развернуть список вариантов ↓
                </span>
                <span className="hidden text-xs text-slate-500 font-medium mt-2 group-open:block">
                  Нажмите заголовок ещё раз, чтобы свернуть
                </span>
              </summary>
              <div className="border-t border-slate-100 px-4 sm:px-5 pb-5 pt-4 bg-slate-50/50">
          <section
            id="rep-novelties-article"
            className="mb-4 scroll-mt-20 space-y-5"
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => selectReportView("noveltiesArticle")}
                className={`rounded-2xl border-2 px-4 py-4 text-left transition ${
                  reportView === "noveltiesArticle"
                    ? "border-emerald-600 bg-white shadow-md"
                    : "border-slate-200 bg-white hover:border-slate-300"
                }`}
              >
                <span className="block text-base font-bold text-slate-900">
                  Новинки по артикулу
                </span>
                <span className="mt-1 block text-sm text-slate-600 leading-relaxed">
                  Список на {reportLabels.siteB}: товары без того же артикула на {reportLabels.siteA}.
                  Можно сохранить в Excel.
                </span>
              </button>
              <button
                type="button"
                onClick={() => selectReportView("notOnA")}
                className={`rounded-2xl border-2 px-4 py-4 text-left transition ${
                  reportView === "notOnA"
                    ? "border-emerald-600 bg-white shadow-md"
                    : "border-slate-200 bg-white hover:border-slate-300"
                }`}
              >
                <span className="block text-base font-bold text-slate-900">
                  Нет той же карточки по внутреннему id
                </span>
                <span className="mt-1 block text-sm text-slate-600 leading-relaxed">
                  Как первый пункт в зелёном блоке: позиции на {reportLabels.siteB} без пары по id на{" "}
                  {reportLabels.siteA}.
                </span>
              </button>
              <button
                type="button"
                onClick={() => selectReportView("crossBvsA")}
                className={`rounded-2xl border-2 px-4 py-4 text-left transition ${
                  reportView === "crossBvsA"
                    ? "border-emerald-600 bg-white shadow-md"
                    : "border-slate-200 bg-white hover:border-slate-300"
                }`}
              >
                <span className="block text-base font-bold text-slate-900">
                  Пары для проверки между витринами
                </span>
                <span className="mt-1 block text-sm text-slate-600 leading-relaxed">
                  Как второй пункт в зелёном блоке: две колонки карточек.
                </span>
              </button>
              <button
                type="button"
                onClick={() => selectReportView("dupsA")}
                className={`rounded-2xl border-2 px-4 py-4 text-left transition ${
                  reportView === "dupsA"
                    ? "border-emerald-600 bg-white shadow-md"
                    : "border-slate-200 bg-white hover:border-slate-300"
                }`}
              >
                <span className="block text-base font-bold text-slate-900">
                  Дубли только в загруженной рубрике — {reportLabels.siteA}
                </span>
                <span className="mt-1 block text-sm text-slate-600 leading-relaxed">
                  Похожие карточки внутри выгрузки опорной витрины.
                </span>
              </button>
              <button
                type="button"
                onClick={() => selectReportView("dupsB")}
                className={`rounded-2xl border-2 px-4 py-4 text-left transition ${
                  reportView === "dupsB"
                    ? "border-emerald-600 bg-white shadow-md"
                    : "border-slate-200 bg-white hover:border-slate-300"
                }`}
              >
                <span className="block text-base font-bold text-slate-900">
                  Дубли только в загруженной рубрике — {reportLabels.siteB}
                </span>
                <span className="mt-1 block text-sm text-slate-600 leading-relaxed">
                  Похожие карточки внутри выгрузки второй витрины.
                </span>
              </button>
              <button
                type="button"
                onClick={() => selectReportView("full")}
                className={`rounded-2xl border-2 px-4 py-4 text-left transition sm:col-span-2 ${
                  reportView === "full"
                    ? "border-slate-800 bg-white shadow-md"
                    : "border-slate-200 bg-white hover:border-slate-300"
                }`}
              >
                <span className="block text-base font-bold text-slate-900">
                  Вся информация одной длинной страницей
                </span>
                <span className="mt-1 block text-sm text-slate-600 leading-relaxed">
                  Для опытных: совпадения по коду, пары и блоки друг за другом. Объёмнее, чем
                  отдельные режимы выше.
                </span>
              </button>
            </div>

            {reportView !== "notOnA" && reportView !== "noveltiesArticle" && (
              <div className="rounded-2xl border border-amber-200/90 bg-amber-50/50 p-4 sm:p-5">
                <p className="text-base font-bold text-slate-900 mb-1">
                  Насколько строго отбирать «дубли»
                </p>
                <p className="text-sm text-slate-600 mb-4 leading-relaxed">
                  Нужно для режимов с дублями и для полной страницы. Обычно начинают с{" "}
                  <strong>«Только код»</strong> — это надёжнее; «по названию и фото» — для догонки
                  товаров без штрихкода в данных.
                </p>
                <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setDupKindFilter("all")}
                    className={`rounded-xl px-4 py-3 text-sm font-semibold min-h-[3rem] flex-1 sm:flex-none ${
                      dupKindFilter === "all"
                        ? "bg-amber-800 text-white shadow-sm"
                        : "bg-white border-2 border-slate-200 text-slate-800 hover:border-amber-300"
                    }`}
                  >
                    Показать все слои
                  </button>
                  <button
                    type="button"
                    onClick={() => setDupKindFilter("ean")}
                    className={`rounded-xl px-4 py-3 text-sm font-semibold min-h-[3rem] flex-1 sm:flex-none ${
                      dupKindFilter === "ean"
                        ? "bg-amber-800 text-white shadow-sm"
                        : "bg-white border-2 border-slate-200 text-slate-800 hover:border-amber-300"
                    }`}
                  >
                    Только штрихкод и артикул
                  </button>
                  <button
                    type="button"
                    onClick={() => setDupKindFilter("nameAttr")}
                    className={`rounded-xl px-4 py-3 text-sm font-semibold min-h-[3rem] flex-1 sm:flex-none ${
                      dupKindFilter === "nameAttr"
                        ? "bg-amber-800 text-white shadow-sm"
                        : "bg-white border-2 border-slate-200 text-slate-800 hover:border-amber-300"
                    }`}
                  >
                    По названию и фото (+ характеристики из формы)
                  </button>
                  <button
                    type="button"
                    onClick={() => setDupKindFilter("unlikely")}
                    className={`rounded-xl px-4 py-3 text-sm font-semibold min-h-[3rem] flex-1 sm:flex-none ${
                      dupKindFilter === "unlikely"
                        ? "bg-amber-800 text-white shadow-sm"
                        : "bg-white border-2 border-slate-200 text-slate-800 hover:border-amber-300"
                    }`}
                  >
                    Только сомнительные (проверить глазами)
                  </button>
                </div>
                {(reportView === "dupsA" || reportView === "dupsB") && (
                  <div className="mt-5 pt-4 border-t border-amber-200/80">
                    <p className="text-sm font-semibold text-slate-900 mb-1">
                      Как считать дубли по рубрике
                    </p>
                    <p className="text-sm text-slate-600 mb-3 leading-relaxed">
                      Либо повтор внутри выгруженной рубрики, либо сравнение «новинок по артикулу»
                      с полным каталогом другой витрины.
                    </p>
                    <div className="flex flex-col sm:flex-row flex-wrap gap-2">
                      {reportView === "dupsA" ? (
                        <>
                          <button
                            type="button"
                            onClick={() => setDupScopeA("intraA")}
                            className={`rounded-xl px-4 py-3 text-sm font-semibold ${
                              dupScopeA === "intraA"
                                ? "bg-slate-900 text-white"
                                : "bg-white border-2 border-slate-200"
                            }`}
                          >
                            Внутри рубрики {reportLabels.siteA}
                          </button>
                          <button
                            type="button"
                            onClick={() => setDupScopeA("unplacedVsA")}
                            className={`rounded-xl px-4 py-3 text-sm font-semibold ${
                              dupScopeA === "unplacedVsA"
                                ? "bg-slate-900 text-white"
                                : "bg-white border-2 border-slate-200"
                            }`}
                          >
                            Новинки {reportLabels.siteB} vs полный {reportLabels.siteA}
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => setDupScopeB("intraB")}
                            className={`rounded-xl px-4 py-3 text-sm font-semibold ${
                              dupScopeB === "intraB"
                                ? "bg-slate-900 text-white"
                                : "bg-white border-2 border-slate-200"
                            }`}
                          >
                            Внутри рубрики {reportLabels.siteB}
                          </button>
                          <button
                            type="button"
                            onClick={() => setDupScopeB("unplacedVsB")}
                            className={`rounded-xl px-4 py-3 text-sm font-semibold ${
                              dupScopeB === "unplacedVsB"
                                ? "bg-slate-900 text-white"
                                : "bg-white border-2 border-slate-200"
                            }`}
                          >
                            Новинки {reportLabels.siteA} vs полный {reportLabels.siteB}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
            {!data && (
              <p className="text-sm text-amber-900 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 leading-relaxed">
                Сначала нажмите <strong>«{primaryRunButtonLabel}»</strong> ниже. Первым откроется тот режим,
                который выбран <strong>в зелёном блоке</strong>. Отчёты из списка выше —
                понадобятся только если нужна другая таблица.
              </p>
            )}
            {data && !isSingleDups(data) && (
              <p className="text-sm text-emerald-900 rounded-xl bg-emerald-50/80 border border-emerald-200 px-4 py-3 leading-relaxed">
                Готово: экран уже построен. Чтобы поменять вид, нажмите другую большую карточку —
                заново качать каталог не нужно.
              </p>
            )}
          </section>
              </div>
            </details>
          </>
        )}

        {error && (() => {
          const soft = friendlyHttpOrTimeoutMessage(error);
          if (soft) {
            return (
              <div
                className="mb-4 rounded-2xl border border-red-200/90 bg-gradient-to-br from-red-50/95 to-white px-4 py-4 shadow-sm ring-1 ring-red-100/70"
                role="alert"
              >
                <p className="text-base font-bold text-red-950">{soft.title}</p>
                <p className="mt-2 text-sm text-red-900/90 leading-relaxed">
                  {soft.description}
                </p>
                <details className="mt-3 rounded-lg border border-red-100 bg-white/70 px-3 py-2 text-xs text-slate-600">
                  <summary className="cursor-pointer font-medium text-slate-700">
                    Техническая деталь
                  </summary>
                  <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-[11px]">
                    {error}
                  </pre>
                </details>
              </div>
            );
          }
          return (
            <div
              className="mb-4 rounded-2xl border border-amber-200/90 bg-amber-50/70 px-4 py-3 text-sm text-amber-950"
              role="alert"
            >
              {error}
            </div>
          );
        })()}
        {compareDisabledHint && (
          <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200/80 rounded-lg px-3 py-2 mb-3">
            {compareDisabledHint}
          </p>
        )}
        <div
          id="compare-run-anchor"
          className="flex flex-col gap-3 items-center scroll-mt-24 rounded-2xl border border-slate-200/90 bg-gradient-to-b from-amber-50/40 via-white to-slate-50/30 px-4 py-6 shadow-sm ring-1 ring-slate-200/40 sm:px-6"
        >
          <button
              type="button"
              onClick={run}
              disabled={comparePrimaryDisabled}
              title={
                comparePrimaryDisabled
                  ? "Сначала укажите id рубрик (см. поля выше) или дождитесь загрузки"
                  : "Запустить расчёт"
              }
              className="min-w-[min(100%,18rem)] rounded-2xl bg-[#ffd740] text-[#0a0a0a] border border-black/10 px-8 py-3.5 text-base font-bold shadow-md disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#f5cd38] cursor-pointer ring-2 ring-amber-200/30 hover:ring-amber-400/40 transition"
            >
              {loading ? "Загрузка…" : primaryRunButtonLabel}
            </button>
          <div className="flex flex-wrap items-center justify-center gap-2 w-full">
            {loading && (
              <button
                type="button"
                onClick={cancelRun}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:border-slate-400 hover:bg-slate-50"
              >
                Отменить
              </button>
            )}
          </div>
          {loading && (
            <>
              <p className="text-xs text-slate-500 max-w-3xl mx-auto text-center leading-relaxed">
                Сначала выгружаются товары по рубрикам из API (для B с несколькими id — параллельно,
                потом объединение). На больших витринах это нормально длится от десятков секунд до
                нескольких минут. Страница не «зависла»: таймер ниже тикает, работа идёт на сервере.
                Сузьте рубрику, списки брендов или добавьте на B несколько узких рубрик вместо одной — так
                надёжнее по таймингу на хостингах с коротким лимитом. Не закрывайте вкладку — дождитесь
                отчёта. Если слишком долго — кнопка{" "}
                <strong>Отменить</strong> (или тайм‑аут 30 мин) вернёт форму.
              </p>
              <p className="text-xs text-amber-900/85 max-w-3xl mx-auto text-center leading-relaxed">
                <strong>Облако Vercel:</strong> на бесплатном плане лимит функции около{" "}
                <strong>60 с</strong>. Ошибка может появиться с задержкой: таймер на странице при
                этом продолжит идти — это не значит, что сервер ещё считает. Сузьте рубрику/бренды
                или в панели Vercel включите <strong>Fluid compute</strong> / перейдите на Pro
                (до 300+ с). Не про место на диске у вас.
              </p>
              {loadElapsed >= 70 && (
                <p className="text-xs text-amber-950 max-w-3xl mx-auto text-center leading-relaxed rounded-lg border border-amber-400/90 bg-amber-100/90 px-3 py-2">
                  <strong>Прошла уже минута+, а результата нет.</strong> Откройте{" "}
                  <kbd className="rounded border border-amber-700/40 bg-white px-1">F12</kbd> →
                  вкладка <strong>Сеть</strong> → найдите запрос к <strong>compare</strong> (путь{" "}
                  <code className="text-[11px]">/api/compare</code>). Статус{" "}
                  <strong>504 / 502</strong> или «failed» — это лимит или сбой на хостинге: сузьте
                  задачу или смените план Vercel. Если статус ещё <strong>(ожидает)</strong> на
                  бесплатном плане дольше ~2 мин — нажмите <strong>Отменить</strong> и попробуйте
                  меньший объём. На <strong>локальном</strong> запуске или Pro тяжёлая выгрузка может
                  реально занимать несколько минут — тогда просто ждите.
                </p>
              )}
              <p className="text-xs font-medium text-amber-900/80 text-center w-full">
                Идёт запрос: {formatLoadElapsed(loadElapsed)}
              </p>
            </>
          )}
        </div>
      </section>

      </div>

      {data && isSingleDups(data) && (() => {
        const cEan = data.eanGroups.length;
        const cName = data.namePhotoPairs.length;
        const cVis = data.brandVisualPairs?.length ?? 0;
        const cUnl = data.unlikelyPairs?.length ?? 0;
        const cNameAttr = cName + cVis;
        const cAllBlocks = cEan + cName + cVis + cUnl;
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
              ~90% (имя+URL фото): {cName}
            </span>
            <span className="text-sky-800">
              ~60% (бренд+визуально): {cVis}
            </span>
            <span className="text-amber-800">
              Маловероятных: {cUnl}
            </span>
            <span className="text-slate-600 border-l border-slate-200 pl-4">
              Всего блоков в отчёте:{" "}
              <strong className="text-slate-900 tabular-nums">{cAllBlocks}</strong>{" "}
              <span className="text-slate-500">
                ({cEan}+{cName}+{cVis}+{cUnl})
              </span>
            </span>
          </div>

          <div className="mb-6 p-4 rounded-xl border border-amber-200/80 bg-amber-50/40 text-sm">
            <p className="text-xs text-slate-600 mb-2">
              Что показывать: дубли <strong>по EAN</strong> и/или{" "}
              <strong>по названию + фото</strong>
              <span className="text-slate-500">
                {" "}
                — счётчики: EAN{" "}
                <strong className="tabular-nums text-slate-700">{cEan}</strong>, ~90%{" "}
                <strong className="tabular-nums text-slate-700">{cName}</strong>, ~60%{" "}
                <strong className="tabular-nums text-slate-700">{cVis}</strong>, маловероятн.{" "}
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
                Название / фото + хар. ({cNameAttr})
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
              ~90%: частичное название + эквивалентный URL фото{" "}
              <span className="text-amber-800 tabular-nums">({cName})</span>
            </h2>
            <p className="text-xs text-slate-500 mb-3">
              Внутри бренда. Товары из EAN-групп выше сюда не включаются. При галочках
              объём/оттенок/цвет — жёсткий отсев по расхождению.
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

          {(dupKindFilter === "all" || dupKindFilter === "nameAttr") && (
          <section className="mb-10" id="intra-brand-visual">
            <h2 className="text-lg font-semibold text-slate-900 mb-2">
              ~60%: тот же бренд +{" "}
              <strong className="text-slate-800">похожая модельная линия</strong> в названии и
              похожее первое фото (по автоматическому превью). Если у обоих товаров есть EAN и они{" "}
              <strong className="text-slate-800">разные</strong>, пара сюда не попадает.{" "}
              <span className="text-sky-800 tabular-nums">({cVis})</span>
            </h2>
            <p className="text-sm text-slate-600 mb-3 leading-relaxed">
              Картинки сравниваются упрощённо (маленький «отпечаток» по первому фото после загрузки),
              без «искусственного интеллекта» и без совпадения URL. Порог здесь{" "}
              <strong className="text-slate-800">мягче</strong>, чем у блока «маловероятные» ниже.
            </p>
            {(data.brandVisualPairs?.length ?? 0) === 0 ? (
              <p className="text-sm text-slate-500">Нет</p>
            ) : (
              <div className="space-y-3">
                {(data.brandVisualPairs ?? []).map((row, i) => (
                  <div
                    key={`${row.a.id}-${row.b.id}-bv-${i}`}
                    className="grid sm:grid-cols-2 gap-4 p-4 rounded-xl border border-sky-200 bg-sky-50/40"
                  >
                    <ProductCell c={row.a} siteLabel={data.siteLabel} />
                    <ProductCell c={row.b} siteLabel={data.siteLabel} />
                    <div className="sm:col-span-2 text-xs text-slate-600">
                      балл: <strong>{(row.score * 100).toFixed(0)}%</strong>{" "}
                      {row.matchReasons.length
                        ? `(${row.matchReasons.join(" + ")})`
                        : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
          )}

          {showUnlikelySections && (
          <section className="mb-10" id="intra-unlikely">
            <h2 className="text-lg font-semibold text-slate-900 mb-2">
              Маловероятные кандидаты (~45%) — один бренд, слабее совпадение названия{" "}
              <span className="text-violet-800 tabular-nums">({cUnl})</span>
            </h2>
            <p className="text-sm text-slate-600 mb-3 leading-relaxed">
              Сюда попадают только пары с <strong>более строгим</strong>, чем у ~60%, сходством
              первых фото. Явная несостыковка категории в тексте названия отсекается (например{" "}
              <strong className="text-slate-800">туалетная вода / парфюм</strong>{" "}
              против <strong className="text-slate-800">туши для ресниц / mascara</strong>) — робот их
              сюда не выводит. Ошибки на белых студийных снимках всё равно возможны; доверяйте паре
              в первую очередь при совпадении по <strong className="text-slate-800">EAN или артикулу</strong>.
              Галочки объём / оттенок / цвет на этот слой не действуют.
            </p>
            {(data.unlikelyPairs?.length ?? 0) === 0 ? (
              <p className="text-sm text-slate-500 mb-3 leading-relaxed">
                Ничего подходящего: либо нет пар под эти условия, либо кандидаты отсечены как разные типы товара по заголовку.
              </p>
            ) : (
              <p className="text-sm text-slate-600 mb-3">
                Найдено пар: <strong className="tabular-nums">{data.unlikelyPairs!.length}</strong>
              </p>
            )}
            <div className="space-y-3">
              {(data.unlikelyPairs ?? []).map((row, i) => (
                <div
                  key={`${row.a.id}-${row.b.id}-${i}`}
                  className="grid sm:grid-cols-2 gap-4 p-4 rounded-xl border border-slate-200 bg-violet-50/40"
                >
                  <ProductCell c={row.a} siteLabel={data.siteLabel} />
                  <ProductCell c={row.b} siteLabel={data.siteLabel} />
                  <div className="sm:col-span-2 text-sm text-slate-600 leading-relaxed">
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
          <div
            className="mb-6 rounded-2xl border border-sky-200/90 bg-gradient-to-br from-sky-50/90 via-white to-slate-50/40 p-5 shadow-sm ring-1 ring-sky-100/60"
            role="region"
            aria-label="Как работает отчёт"
          >
            <p className={`${homeCardTitle} text-sky-900/90 mb-1`}>Подсказка</p>
            <h2 className="text-lg font-bold text-slate-900">
              Как алгоритм находит совпадения
            </h2>
            <p className="mt-2 text-sm text-slate-700 leading-relaxed max-w-3xl">
              Сначала по <strong className="text-slate-900">EAN и артикулу</strong> из карточек — это
              самые надёжные признаки. Если по ним не удалось связать позиции, подбираются{" "}
              <strong className="text-slate-900">кандидаты по названию и превью фотографии</strong> (без
              «искусственного интеллекта» по смыслу товара; на белых студийных фото бывают ошибки).
            </p>
            <details className="mt-3 rounded-xl border border-sky-100 bg-white/80 px-4 py-3 text-sm text-slate-700">
              <summary className="cursor-pointer font-semibold text-sky-950">
                Подробнее про уровни уверенности
              </summary>
              <ul className="mt-3 list-disc pl-5 space-y-2 leading-relaxed">
                <li>
                  <strong>Надёжное</strong> — совпали часть названия и ссылка на первое фото считается
                  той же (после нормализации).
                </li>
                <li>
                  <strong>Среднее (~60% в подписи)</strong> — тот же бренд, близкая «линейка» в тексте и
                  похожее превью (порог мягче).
                </li>
                <li>
                  <strong>Слабое (~45%)</strong> — слабее текст, превью проверяется строже; явные противоречия
                  типа парфюм vs тушь по заголовку отсекаются. Объём/оттенок/цвет из формы этот слой не
                  фильтруют — проверка глазами.
                </li>
              </ul>
            </details>
          </div>
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
            другой id относительно {data.siteALabel} (справочно) — {data.stats.unplacedBByIdCount}; на{" "}
            {data.siteALabel} нет id из {data.siteBLabel} — {data.stats.unplacedAByIdCount ?? 0}.
            <br />
            <strong className="text-slate-800 mt-1 inline-block">Новинки по артикулу:</strong> на{" "}
            {data.siteBLabel} позиций без пересечения артикулов с {data.siteALabel} —{" "}
            <strong>{data.stats.noveltiesBByArticleCount ?? 0}</strong>; симметрично новинки на{" "}
            {data.siteALabel} — <strong>{data.stats.noveltiesAByArticleCount ?? 0}</strong>.
            {(data.stats.noveltiesIncludedBmissingArticleFields ?? 0) > 0 && (
              <>
                {" "}
                На {data.siteBLabel} без полей артикула в JSON (всё равно в списке новинок):{" "}
                {data.stats.noveltiesIncludedBmissingArticleFields}.
              </>
            )}
            {(data.stats.noveltiesIncludedAmissingArticleFields ?? 0) > 0 && (
              <>
                {" "}
                На {data.siteALabel} без полей артикула:{" "}
                {data.stats.noveltiesIncludedAmissingArticleFields}.
              </>
            )}
          </p>
          {twoSiteGoal === "noveltiesById" && (
            <div className="mb-6 p-4 rounded-xl border-2 border-emerald-400/60 bg-emerald-50/50">
              <h3 className="text-sm font-semibold text-emerald-950">
                Выбранный сценарий: новинки на {data.siteBLabel} (нет пары по id на{" "}
                {data.siteALabel})
              </h3>
              <p className="text-3xl font-bold text-emerald-900 mt-2 tabular-nums">
                {data.stats.unplacedBByIdCount ?? data.unplacedBByIdRaw?.length ?? 0}
              </p>
              <p className="text-xs text-slate-600 mt-2 mb-3 max-w-2xl">
                Каждая карточка — отдельная позиция в выгрузке с её артикулами и вариациями из API.
                Ниже откройте список и при необходимости скачайте Excel.
              </p>
              <button
                type="button"
                onClick={() => selectReportView("notOnA")}
                className="rounded-lg bg-emerald-900 text-white px-4 py-2 text-sm font-semibold hover:bg-emerald-950"
              >
                Перейти к списку и выгрузке Excel
              </button>
            </div>
          )}
          {twoSiteGoal === "dupContourAgainstA" && (
            <div className="mb-6 p-4 rounded-xl border-2 border-emerald-700/40 bg-white">
              <h3 className="text-sm font-semibold text-emerald-950 mb-1">
                Выбранный сценарий: дубли из «новинок по артикулу» {data.siteBLabel} по каталогу{" "}
                {data.siteALabel}
              </h3>
              <p className="text-xs text-slate-600 mb-3">
                Всего найденных пар второго контура:{" "}
                <strong className="tabular-nums">{crossRowKindCounts.total}</strong>. Переключатель
                ниже влияет на то, какие строки показаны на вкладке E и в Excel пар.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setDupKindFilter("ean")}
                  className={`rounded-lg px-3 py-2 text-xs font-semibold border ${
                    dupKindFilter === "ean"
                      ? "bg-amber-800 text-white border-amber-900"
                      : "bg-white text-slate-800 border-slate-200 hover:border-slate-300"
                  }`}
                >
                  По EAN и артикулу ({crossRowKindCounts.codeLayer})
                </button>
                <button
                  type="button"
                  onClick={() => setDupKindFilter("nameAttr")}
                  className={`rounded-lg px-3 py-2 text-xs font-semibold border ${
                    dupKindFilter === "nameAttr"
                      ? "bg-amber-800 text-white border-amber-900"
                      : "bg-white text-slate-800 border-slate-200 hover:border-slate-300"
                  }`}
                >
                  По названию и фото ({crossRowKindCounts.nameAttr})
                </button>
                <button
                  type="button"
                  onClick={() => setDupKindFilter("unlikely")}
                  className={`rounded-lg px-3 py-2 text-xs font-semibold border ${
                    dupKindFilter === "unlikely"
                      ? "bg-amber-800 text-white border-amber-900"
                      : "bg-white text-slate-800 border-slate-200 hover:border-slate-300"
                  }`}
                >
                  Слабые кандидаты ({crossRowKindCounts.unlikely})
                </button>
                <button
                  type="button"
                  onClick={() => setDupKindFilter("all")}
                  className={`rounded-lg px-3 py-2 text-xs font-semibold border ${
                    dupKindFilter === "all"
                      ? "bg-slate-900 text-white border-slate-900"
                      : "bg-white text-slate-800 border-slate-200 hover:border-slate-300"
                  }`}
                >
                  Все слои ({crossRowKindCounts.total})
                </button>
              </div>
              <button
                type="button"
                onClick={() => selectReportView("crossBvsA")}
                className="mt-3 rounded-lg border border-emerald-800 text-emerald-950 px-3 py-1.5 text-xs font-semibold hover:bg-emerald-50"
              >
                Открыть вкладку с парами A ↔ B
              </button>
            </div>
          )}
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


          {reportView === "notOnA" && (
            <section className="mb-10 p-4 rounded-xl border border-emerald-200 bg-emerald-50/20">
              <h2 className="text-lg font-semibold text-slate-900 mb-2" id="rep-not-on-a">
                B · Другой id относительно каталога A ({data.siteBLabel})
              </h2>
              <p className="text-sm text-slate-600 mb-3">
                <strong>Справочно:</strong> товары <strong>{data.siteBLabel}</strong>, у которых в
                вашей выгрузке <strong>нет такого же id</strong>, как у карточки на{" "}
                <strong>{data.siteALabel}</strong>. Это не то же самое, что «новинки по артикулу»:
                товар может совпасть с A по артикулу или EAN, но жить под другим id.
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

          {reportView === "noveltiesArticle" && (
            <section
              className="mb-10 p-4 rounded-xl border border-emerald-300 bg-emerald-50/35"
              id="novelties-article-detail"
            >
              <h2 className="text-lg font-semibold text-emerald-950 mb-2">
                Новинки по артикулу — {data.siteBLabel}
              </h2>
              <p className="text-sm text-slate-700 mb-2">
                Карточки <strong>{data.siteBLabel}</strong>, для которых <strong>ни один</strong>{" "}
                нормализованный код из полей артикула / code / vendor_code и ни один ключ вида{" "}
                <code className="text-[11px] bg-white/70 px-0.5 rounded">a58067391</code> из
                суффикса ссылки карточки не встречается в вашей выгрузке{" "}
                <strong>{data.siteALabel}</strong> с тем же фильтром (рубрика, бренд, модели…). По
                этому же списку ниже считается поиск «дублей вторым контуром» во вкладке E и в трёх
                колонках страницы.
              </p>
              <p className="text-sm text-slate-600 mb-4">
                Всего строк:{" "}
                <strong>{data.noveltiesByArticleRaw?.length ?? noveltiesBList.length}</strong>
              </p>
              <div className="flex flex-wrap gap-2 mb-6">
                <button
                  type="button"
                  onClick={downloadNoveltiesPlainExcel}
                  disabled={!noveltiesBList.length}
                  className="rounded-lg bg-emerald-900 text-white px-3 py-2 text-sm font-medium hover:bg-emerald-950 disabled:opacity-50"
                >
                  Excel — только новинки
                </button>
                <button
                  type="button"
                  onClick={downloadNoveltiesWithDupColsExcel}
                  disabled={!noveltiesBList.length}
                  className="rounded-lg bg-white border-2 border-emerald-800 text-emerald-950 px-3 py-2 text-sm font-medium hover:bg-emerald-50 disabled:opacity-50"
                  title="Колонки: есть ли второй контур дубля на A, типы совпадения, артикулы кандидатов на A"
                >
                  Excel — новинки + «дубль на A»
                </button>
                <button
                  type="button"
                  onClick={downloadCrossDupPairsExcel}
                  disabled={!onlyBCrossWithAFiltered.length}
                  className="rounded-lg bg-amber-800 text-white px-3 py-2 text-sm font-medium hover:bg-amber-900 disabled:opacity-50"
                  title="Отдельный файл по строкам вкладки E с учётом фильтра «тип дубля»"
                >
                  Excel — строки найденных дублей ({onlyBCrossWithAFiltered.length})
                </button>
              </div>
              <p className="text-xs text-slate-500 mb-3">
                Просмотр списка (без второго столбца A). Отчёт пар B↔A — вкладка E.
              </p>
              <div className="max-h-[min(70vh,1200px)] overflow-y-auto space-y-2 pr-1">
                {noveltiesBList.length === 0 ? (
                  <p className="text-sm text-slate-600">Нет позиций (все артикулы есть на A).</p>
                ) : (
                  noveltiesBList.map((c) => (
                    <div
                      key={c.id}
                      className="p-3 rounded-lg border border-emerald-200/90 bg-white"
                    >
                      <ProductCell c={c} siteLabel={data.siteBLabel} />
                    </div>
                  ))
                )}
              </div>
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
                  {isA ? "C · Дубли в загруженной рубрике A" : "D · Дубли в загруженной рубрике B"}
                </h2>
                <p className="text-xs text-slate-600">
                  {scopeIntra
                    ? `Показаны дубли внутри рубрики ${dupSiteLabel} (EAN, ~90%, ~60%, маловероятные ~45% — см. подписи блоков).`
                    : isA
                      ? `Новинки ${data.siteBLabel} по артикулу сопоставлены с полным каталогом ${data.siteALabel} и между собой.`
                      : `Новинки ${data.siteALabel} по артикулу сопоставлены с полным каталогом ${data.siteBLabel} и между собой.`}
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
                        ~90%: частичное название + эквивалентный URL фото
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

                  {showNameAttrSections && (
                    <div>
                      <h3 className="text-sm font-semibold text-sky-900 mb-2">
                        ~60%: бренд + <strong>сходство модели/линейки</strong> в названии + похожее первое фото
                        (автопревью, порог мягче, чем у «маловероятных»). При разных EAN (если есть у обеих карточек) не
                        считаем.
                      </h3>
                      {(intra.brandVisualPairs?.length ?? 0) === 0 ? (
                        <p className="text-sm text-slate-500">Нет</p>
                      ) : (
                        <div className="space-y-3">
                          {(intra.brandVisualPairs ?? []).map((row, i) => (
                            <div
                              key={`intra-bv-${row.a.id}-${row.b.id}-${i}`}
                              className="grid sm:grid-cols-2 gap-4 p-4 rounded-xl border border-sky-200 bg-sky-50/40"
                            >
                              <ProductCell c={row.a} siteLabel={dupSiteLabel} />
                              <ProductCell c={row.b} siteLabel={dupSiteLabel} />
                              <div className="sm:col-span-2 text-sm text-slate-600 leading-relaxed">
                                {(row.score * 100).toFixed(0)}% ·{" "}
                                {row.matchReasons?.join(" + ")}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {showUnlikelySections && (
                    <div>
                      <h3 className="text-sm font-semibold text-violet-900 mb-2">
                        Маловероятные ~45% — бренд и слабее название + строже по превью первого фото
                      </h3>
                      <p className="text-sm text-slate-600 mb-2 leading-relaxed">
                        Пары «парфюм / туалетная вода» против «туши / mascara» по явным словам в заголовке робот сюда не
                        выводит. На белом фоне редкие ложные попадания возможны — смотрите EAN и артикул.
                      </p>
                      {(intra.unlikelyPairs?.length ?? 0) === 0 && (
                        <p className="text-sm text-slate-600 mb-2 leading-relaxed">
                          Нет строк: нет подходящих пар или они отсечены по правилам выше.
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
                            <div className="sm:col-span-2 text-sm text-slate-600 leading-relaxed">
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
                      Новинки {data.siteBLabel} (по артикулу) — возможный дубль в полном {data.siteALabel}
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
                            {onlyBCrossKindTitle(row.kind)}
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
                                {data.siteBLabel} (новинка)
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
                          {isSoftDupScoreKind(row.kind) && (
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
                      Дубли внутри списка новинок ({data.siteBLabel})
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
                            {internalDupKindTitle(row.kind)}
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
                          {isSoftDupScoreKind(row.kind) && (
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
                      Новинки {data.siteALabel} (по артикулу) — возможный дубль в полном {data.siteBLabel}
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
                            {onlyBCrossKindTitle(row.kind)}
                          </p>
                          <div className="grid sm:grid-cols-2 gap-3">
                            <div>
                              <p className="text-[11px] text-slate-500 mb-0.5">
                                {data.siteALabel} (новинка)
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
                          {isSoftDupScoreKind(row.kind) && (
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
                      Дубли внутри списка новинок ({data.siteALabel})
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
                            {internalDupKindTitle(row.kind)}
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
                          {isSoftDupScoreKind(row.kind) && (
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
                E · Второй контур: новинки {data.siteBLabel} против каталога {data.siteALabel}
              </h2>
              <p className="text-sm text-slate-600 mb-3">
                Берутся только товары с B из списка «новинки по артикулу» (артикула нет на A). Для
                каждой позиции в полной выгрузке {data.siteALabel} ищем совпадение по{" "}
                <strong>общему EAN</strong> (при другом артикуле), затем по{" "}
                <strong>названию + фото</strong>, режим ~60% (бренд, линейка в названии, мягкий порог по превью картинки) и
                блок ~45% маловероятных (<strong>строже по картинке</strong>; явное «парфюм vs тушь» по словам в заголовке
                отсекается).
              </p>
              <div className="mb-4 rounded-lg border border-amber-300/80 bg-amber-50/70 px-3 py-2.5 text-sm text-amber-950 leading-relaxed">
                <p className="font-semibold text-amber-950 mb-1">
                  Почему слева может быть «совсем другой» товар на {data.siteALabel}
                </p>
                <p>
                  Справа — карточка, у которой по <strong>кодам артикула</strong> не нашлось пары в
                  вашей выгрузке {data.siteALabel}; это <strong>не</strong> означает «такого
                  названия точно нет в магазине у покупателя». Слева показан лишь{" "}
                  <strong>кандидат</strong>, которого робот нашёл по мягким правилам (бренд, превью
                  первого фото, часть названия — без «понимания» товара по смыслу). Строки ~60% и ~45%
                  нужно проверять глазами; как дубль доверяйте прежде всего совпадению по{" "}
                  <strong>EAN или артикулу</strong>.
                </p>
              </div>
              <div className="flex flex-wrap gap-2 mb-4">
                <button
                  type="button"
                  onClick={downloadCrossDupPairsExcel}
                  disabled={!onlyBCrossWithAFiltered.length}
                  className="rounded-lg bg-emerald-900 text-white px-3 py-2 text-sm font-medium hover:bg-emerald-950 disabled:opacity-50"
                >
                  Скачать пары дублей (Excel, {onlyBCrossWithAFiltered.length} строк)
                </button>
                <button
                  type="button"
                  onClick={downloadNoveltiesWithDupColsExcel}
                  disabled={!noveltiesBList.length}
                  className="rounded-lg bg-white border border-emerald-800 text-emerald-950 px-3 py-2 text-sm font-medium hover:bg-emerald-50 disabled:opacity-50"
                >
                  Скачать все новинки с колонкой «дубль да/нет»
                </button>
              </div>
              {crossBvsARowsFiltered.length === 0 && (
                <p className="text-sm text-slate-500">Нет — по выбранному фильтру типа дубля.</p>
              )}
              <div className="space-y-3 max-h-[min(80vh,1600px)] overflow-y-auto pr-1">
                {crossBvsARowsFiltered.map((row, i) => (
                  <div
                    key={`${row.fromB.id}-${row.onA.id}-${i}`}
                    className="p-4 rounded-xl border border-emerald-200 bg-white space-y-2"
                  >
                    <p className="text-[10px] uppercase text-emerald-800 font-medium">
                      {onlyBCrossKindTitle(row.kind)}
                    </p>
                    <div className="grid sm:grid-cols-2 gap-3">
                      <div>
                        <p className="text-[11px] text-slate-500 mb-0.5">
                          Каталог {data.siteALabel}
                        </p>
                        <ProductCell c={row.onA} siteLabel={data.siteALabel} />
                      </div>
                      <div>
                        <p className="text-[11px] text-slate-500 mb-0.5">
                          Новинка {data.siteBLabel} (по артикулу)
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
                    {isSoftDupScoreKind(row.kind) && (
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
              Новинки {data.siteBLabel}: список по артикулу + второй контур + дубли внутри списка
            </h2>
            <p className="text-sm text-slate-600 mb-4">
              Колонка 1 — <strong>новинки по артикулу</strong> (как во вкладке A). Колонка 2 — для
              них поиск дубля во всём {data.siteALabel} (EAN, название+фото…). Колонка 3 — дубли
              между двумя новинками одного списка. Список «нет общего id» с B —{" "}
              <a
                href="#rep-not-on-a"
                className="text-emerald-800 underline font-medium"
              >
                вкладка B
              </a>
              .
            </p>
            <div className="grid xl:grid-cols-3 gap-6 items-start">
              <div className="rounded-xl border border-emerald-200/90 bg-emerald-50/40 p-4 min-h-[120px]">
                <h3 className="text-sm font-semibold text-slate-800 mb-1">
                  1) Новинки по артикулу на {data.siteBLabel}
                </h3>
                <p className="text-xs text-slate-500 mb-3">
                  Выгрузки по кнопкам — те же, что во вкладке A.
                </p>
                <div className="flex flex-wrap gap-2 mb-3">
                  <button
                    type="button"
                    onClick={downloadNoveltiesPlainExcel}
                    disabled={!noveltiesBList.length}
                    className="rounded-lg bg-emerald-900 text-white px-2.5 py-1.5 text-xs font-medium disabled:opacity-50"
                  >
                    Excel новинки
                  </button>
                  <button
                    type="button"
                    onClick={downloadNoveltiesWithDupColsExcel}
                    disabled={!noveltiesBList.length}
                    className="rounded-lg bg-white border border-emerald-800 text-emerald-950 px-2.5 py-1.5 text-xs font-medium disabled:opacity-50"
                  >
                    + колонка «дубль»
                  </button>
                </div>
                <div className="max-h-[min(70vh,1200px)] overflow-y-auto space-y-2 pr-1">
                  {noveltiesBList.length === 0 && (
                    <p className="text-sm text-slate-500">—</p>
                  )}
                  {noveltiesBList.map((c) => (
                    <div
                      key={c.id}
                      className="p-2 rounded-lg border border-emerald-200/80 bg-white text-left"
                    >
                      <ProductCell c={c} siteLabel={data.siteBLabel} />
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/30 p-4 min-h-[120px]">
                <h3 className="text-sm font-semibold text-slate-800 mb-1">
                  2) Второй контур: те же новинки против {data.siteALabel}
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
                        {onlyBCrossKindTitle(row.kind)}
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
                      {isSoftDupScoreKind(row.kind) && (
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
                  3) Дубли между двумя новинками того же списка
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
                          : internalDupKindTitle(row.kind)}
                      </p>
                      <div className="grid sm:grid-cols-2 gap-2">
                        <ProductCell c={row.first} siteLabel={data.siteBLabel} />
                        <ProductCell c={row.second} siteLabel={data.siteBLabel} />
                      </div>
                      {row.kind === "ean" && row.ean && (
                        <p className="text-xs font-mono text-slate-500">EAN {row.ean}</p>
                      )}
                      {isSoftDupScoreKind(row.kind) && (
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
                Выгрузка техническая: «осталось только на {data.siteBLabel}» после автоматических
                пар EAN → артикул → название+фото (другой состав, чем «новинки по артикулу»):{" "}
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
              ~90%
            </a>
            <a href="#intra-brand-visual" className="hover:text-slate-900 hover:underline">
              ~60%
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
            <a href="#rep-novelties-article" className="hover:text-slate-900 hover:underline">
              Новинки по артикулу
            </a>
          </>
        )}
      </nav>
    </div>
    </div>
  );
}
