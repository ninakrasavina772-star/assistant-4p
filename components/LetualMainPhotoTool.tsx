"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  homeBtnPrimary,
  homeCard,
  homeCardBody,
  homeCardHeader,
  homeCardTitle,
  homeInput
} from "@/components/homeTheme";
import {
  buildLetualUrlResultWorkbook,
  buildLetualVariationResultWorkbook,
  parseUrlsFromText,
  parseVariationIdsFromText,
  readVariationIdsFromExcel,
  type LetualResultRow
} from "@/lib/letualMainPhotoExcel";
import { LETUAL_API_CHUNK, LETUAL_BATCH_MAX } from "@/lib/letualMainPhotoConstants";

const SK_OPENAI = "fp_letual_openai_key";
const SK_OPENAI_REM = "fp_letual_openai_remember";

type Tab = "variations" | "urls";

async function processChunk(
  mode: Tab,
  items: number[] | string[],
  openaiKey: string
): Promise<LetualResultRow[]> {
  const body =
    mode === "variations"
      ? {
          mode: "variation",
          variationIds: items,
          openaiApiKey: openaiKey
        }
      : { mode: "url", urls: items, openaiApiKey: openaiKey };

  const res = await fetch("/api/letual/process", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = (await res.json()) as { results?: LetualResultRow[]; error?: string };
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data.results ?? [];
}

export function LetualMainPhotoTool() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<Tab>("variations");
  const [text, setText] = useState("");
  const [variationIds, setVariationIds] = useState<number[]>([]);
  const [urlList, setUrlList] = useState<string[]>([]);
  const [openaiKey, setOpenaiKey] = useState("");
  const [rememberKey, setRememberKey] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<LetualResultRow[]>([]);
  const [resultBlob, setResultBlob] = useState<{ blob: Blob; name: string } | null>(null);
  const [excelBuilding, setExcelBuilding] = useState(false);
  const [status, setStatus] = useState<{
    storage: boolean;
    metabase: boolean;
    catalogSearch: boolean;
    serpapi: boolean;
  } | null>(null);

  useEffect(() => {
    if (typeof sessionStorage === "undefined") return;
    if (sessionStorage.getItem(SK_OPENAI_REM) !== "0") {
      const k = sessionStorage.getItem(SK_OPENAI);
      if (k) setOpenaiKey(k);
    }
  }, []);

  useEffect(() => {
    if (typeof sessionStorage === "undefined") return;
    if (!rememberKey) {
      sessionStorage.setItem(SK_OPENAI_REM, "0");
      sessionStorage.removeItem(SK_OPENAI);
      return;
    }
    const t = openaiKey.trim();
    if (t) sessionStorage.setItem(SK_OPENAI, t);
    sessionStorage.setItem(SK_OPENAI_REM, "1");
  }, [openaiKey, rememberKey]);

  useEffect(() => {
    void fetch("/api/letual/status")
      .then((r) => r.json())
      .then(
        (d: {
          configured?: boolean;
          metabase?: boolean;
          catalogSearch?: boolean;
          serpapi?: boolean;
        }) => {
          setStatus({
            storage: Boolean(d.configured),
            metabase: Boolean(d.metabase),
            catalogSearch: Boolean(d.catalogSearch ?? d.metabase),
            serpapi: Boolean(d.serpapi)
          });
        }
      )
      .catch(() =>
        setStatus({ storage: false, metabase: false, catalogSearch: false, serpapi: false })
      );
  }, []);

  const pendingCount = tab === "variations" ? variationIds.length : urlList.length;

  const stats = useMemo(() => {
    const ok = results.filter((r) => r.ok).length;
    const fail = results.length - ok;
    return { ok, fail, total: results.length };
  }, [results]);

  const onFile = useCallback(async (file: File | null) => {
    if (!file) return;
    setError(null);
    try {
      const rows = await readVariationIdsFromExcel(file);
      const ids = rows.map((r) => r.variationId).slice(0, LETUAL_BATCH_MAX);
      setVariationIds(ids);
      setText(ids.join("\n"));
      if (rows.length > LETUAL_BATCH_MAX) {
        setError(`В файле ${rows.length} строк — обработаем первые ${LETUAL_BATCH_MAX}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось прочитать Excel");
    }
  }, []);

  const syncFromText = useCallback(() => {
    if (tab === "variations") {
      setVariationIds(parseVariationIdsFromText(text).slice(0, LETUAL_BATCH_MAX));
    } else {
      setUrlList(parseUrlsFromText(text).slice(0, LETUAL_BATCH_MAX));
    }
  }, [tab, text]);

  const run = useCallback(async () => {
    syncFromText();
    const key = openaiKey.trim();
    if (!key && tab === "variations") {
      setError("Укажите OpenAI API key для отбора фото из БД");
      return;
    }
    if (tab === "variations" && status && !status.metabase) {
      setError("Metabase не настроен на сервере (METABASE_API_KEY)");
      return;
    }

    const items =
      tab === "variations"
        ? parseVariationIdsFromText(text).slice(0, LETUAL_BATCH_MAX)
        : parseUrlsFromText(text).slice(0, LETUAL_BATCH_MAX);

    if (!items.length) {
      setError(tab === "variations" ? "Добавьте variation_id" : "Добавьте URL изображений");
      return;
    }

    setBusy(true);
    setError(null);
    setResults([]);
    setResultBlob(null);

    const all: LetualResultRow[] = [];
    try {
      for (let i = 0; i < items.length; i += LETUAL_API_CHUNK) {
        const chunk = items.slice(i, i + LETUAL_API_CHUNK);
        setProgress(`Обработка ${i + 1}–${i + chunk.length} из ${items.length}…`);
        const part = await processChunk(tab, chunk, key);
        all.push(...part);
        setResults([...all]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка обработки");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }, [openaiKey, status, syncFromText, tab, text]);

  useEffect(() => {
    if (!results.length) {
      setResultBlob(null);
      setExcelBuilding(false);
      return;
    }
    let cancelled = false;
    setExcelBuilding(true);
    void (async () => {
      const blob =
        tab === "variations"
          ? await buildLetualVariationResultWorkbook(results)
          : await buildLetualUrlResultWorkbook(results);
      if (cancelled) return;
      const suffix = new Date().toISOString().slice(0, 10);
      setResultBlob({
        blob,
        name:
          tab === "variations"
            ? `letual-main-photo-${suffix}.xlsx`
            : `letual-urls-${suffix}.xlsx`
      });
      setExcelBuilding(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [results, tab]);

  const downloadExcel = useCallback(async () => {
    if (!results.length) return;

    let blob = resultBlob?.blob;
    let name = resultBlob?.name;
    if (!blob) {
      setExcelBuilding(true);
      try {
        blob =
          tab === "variations"
            ? await buildLetualVariationResultWorkbook(results)
            : await buildLetualUrlResultWorkbook(results);
        const suffix = new Date().toISOString().slice(0, 10);
        name =
          tab === "variations"
            ? `letual-main-photo-${suffix}.xlsx`
            : `letual-urls-${suffix}.xlsx`;
        setResultBlob({ blob, name });
      } finally {
        setExcelBuilding(false);
      }
    }
    if (!blob || !name) return;

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }, [resultBlob, results, tab]);

  return (
    <div className="space-y-6">
      {status ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600 space-y-1">
          <p>
            Хранилище S3:{" "}
            <strong className={status.storage ? "text-emerald-700" : "text-red-700"}>
              {status.storage ? "OK" : "не настроено"}
            </strong>
          </p>
          <p>
            Metabase (фото из БД):{" "}
            <strong className={status.metabase ? "text-emerald-700" : "text-red-700"}>
              {status.metabase ? "OK" : "не настроен на сервере"}
            </strong>
          </p>
          <p>
            Поиск в каталоге:{" "}
            <strong className={status.catalogSearch ? "text-emerald-700" : "text-red-700"}>
              {status.catalogSearch
                ? "OK — тот же EAN / та же карточка"
                : "нужен Metabase на сервере"}
            </strong>
          </p>
          <p>
            Поиск в интернете (опционально):{" "}
            <strong className={status.serpapi ? "text-emerald-700" : "text-slate-600"}>
              {status.serpapi
                ? "SerpAPI OK — Ozon/ЗЯ/Лэту"
                : "не подключён — достаточно каталога + вырезание"}
            </strong>
          </p>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={`rounded-lg px-4 py-2 text-sm font-medium ${
            tab === "variations"
              ? "bg-slate-900 text-white"
              : "bg-slate-100 text-slate-700 hover:bg-slate-200"
          }`}
          onClick={() => setTab("variations")}
        >
          По ID вариаций
        </button>
        <button
          type="button"
          className={`rounded-lg px-4 py-2 text-sm font-medium ${
            tab === "urls"
              ? "bg-slate-900 text-white"
              : "bg-slate-100 text-slate-700 hover:bg-slate-200"
          }`}
          onClick={() => setTab("urls")}
        >
          По ссылкам
        </button>
      </div>

      <section className={homeCard}>
        <div className={homeCardHeader}>
          <h2 className={homeCardTitle}>
            {tab === "variations" ? "ID вариаций (до 20)" : "Ссылки на фото (до 20)"}
          </h2>
        </div>
        <div className={`${homeCardBody} space-y-4`}>
          {tab === "variations" ? (
            <div className="space-y-2">
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={(e) => void onFile(e.target.files?.[0] ?? null)}
              />
              <button
                type="button"
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                onClick={() => fileRef.current?.click()}
              >
                Загрузить Excel
              </button>
              <p className="text-xs text-slate-500">
                Столбец <code>variation_id</code> или первый столбец с числами.
              </p>
            </div>
          ) : null}

          <textarea
            className={`${homeInput} min-h-[140px] font-mono text-sm`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={
              tab === "variations"
                ? "222000654\n189324402\n149874579"
                : "https://...\nhttps://..."
            }
          />

          {tab === "variations" ? (
            <div className="space-y-4">
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-slate-700">OpenAI API key</span>
                <input
                  type="password"
                  className={homeInput}
                  value={openaiKey}
                  onChange={(e) => setOpenaiKey(e.target.value)}
                  placeholder="sk-…"
                  autoComplete="off"
                />
              </label>
              <label className="flex items-center gap-2 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={rememberKey}
                  onChange={(e) => setRememberKey(e.target.checked)}
                />
                Запомнить OpenAI key в этой вкладке
              </label>
            </div>
          ) : null}

          <button
            type="button"
            disabled={busy}
            className={homeBtnPrimary}
            onClick={() => void run()}
          >
            {busy ? "Обработка…" : "Сгенерировать фото"}
          </button>

          {progress ? <p className="text-sm text-slate-600">{progress}</p> : null}
          {error ? (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </p>
          ) : null}
          {pendingCount > 0 && !busy ? (
            <p className="text-xs text-slate-500">В очереди: {pendingCount} поз.</p>
          ) : null}
        </div>
      </section>

      {results.length > 0 ? (
        <section className={homeCard}>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-5">
            <h2 className={homeCardTitle}>
              Результат ({stats.ok} OK{stats.fail ? `, ${stats.fail} ошибок` : ""})
            </h2>
            <button
              type="button"
              disabled={!results.length}
              onClick={() => void downloadExcel()}
              className="inline-flex shrink-0 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {excelBuilding ? "Скачать Excel (обновляется…)" : "Скачать Excel"}
            </button>
          </div>
          <div className={`${homeCardBody} space-y-4`}>
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {results.map((r, i) => (
                <li key={i} className="flex flex-wrap gap-4 p-4">
                  <div className="min-w-0 flex-1 space-y-1">
                    {r.variationId ? (
                      <p className="text-sm font-semibold text-slate-900">ID {r.variationId}</p>
                    ) : null}
                    {r.sourceUrl ? (
                      <p className="truncate text-xs text-slate-500" title={r.sourceUrl}>
                        Источник: {r.sourceUrl}
                      </p>
                    ) : null}
                    {r.ok && r.resultUrl ? (
                      <a
                        href={r.resultUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="break-all text-sm text-sky-700 hover:underline"
                      >
                        {r.resultUrl}
                      </a>
                    ) : (
                      <p className="text-sm text-red-700">{r.error ?? "Ошибка"}</p>
                    )}
                    {r.comment ? (
                      <p className="text-xs font-medium text-amber-800">{r.comment}</p>
                    ) : null}
                  </div>
                  {r.ok && r.previewUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={r.previewUrl}
                      alt=""
                      className="h-28 w-28 shrink-0 rounded-lg border border-slate-200 bg-white object-contain"
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}
    </div>
  );
}
