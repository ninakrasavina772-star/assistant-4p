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
  buildLetualVariationResultWorkbook,
  parseUrlsFromText,
  parseVariationIdsFromText,
  readVariationIdsFromExcel,
  type LetualResultRow
} from "@/lib/letualMainPhotoExcel";
import { LETUAL_API_CHUNK, LETUAL_BATCH_MAX } from "@/lib/letualMainPhotoConstants";
import type { LetualPickRow, LetualPickStatus } from "@/lib/letualPickTypes";
import type { LetualPhotoScore } from "@/lib/letualPhotoAi";

const SK_OPENAI = "fp_letual_openai_key";
const SK_OPENAI_REM = "fp_letual_openai_remember";

type Tab = "variations" | "urls";

type UiRow = LetualPickRow & {
  resultUrl?: string;
  resultPreviewUrl?: string;
  generated?: boolean;
  generateError?: string;
};

type GalleryPhoto = {
  url: string;
  variationId: number;
  matchType: "own" | "same_ean" | "same_product";
  score?: LetualPhotoScore;
};

type SearchHit = {
  url: string;
  source: string;
  score?: LetualPhotoScore;
};

const STATUS_LABEL: Record<LetualPickStatus, string> = {
  ok: "OK",
  review: "Проверить",
  no_photo: "Нет фото",
  manual: "Вручную"
};

const STATUS_CLASS: Record<LetualPickStatus, string> = {
  ok: "bg-emerald-100 text-emerald-800",
  review: "bg-amber-100 text-amber-900",
  no_photo: "bg-red-100 text-red-800",
  manual: "bg-sky-100 text-sky-800"
};

const MATCH_LABEL: Record<GalleryPhoto["matchType"], string> = {
  own: "эта вариация",
  same_ean: "тот же EAN",
  same_product: "та же карточка"
};

async function pickChunk(ids: number[], openaiKey: string): Promise<LetualPickRow[]> {
  const res = await fetch("/api/letual/pick", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ variationIds: ids, openaiApiKey: openaiKey })
  });
  const data = (await res.json()) as { results?: LetualPickRow[]; error?: string };
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data.results ?? [];
}

async function generateChunk(
  items: { variationId: number; sourceUrl: string }[]
): Promise<LetualResultRow[]> {
  const res = await fetch("/api/letual/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items })
  });
  const data = (await res.json()) as { results?: LetualResultRow[]; error?: string };
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return (data.results ?? []).map((r) => ({
    variationId: r.variationId,
    sourceUrl: r.sourceUrl,
    resultUrl: r.resultUrl,
    comment: r.comment,
    previewUrl: r.previewUrl,
    ok: r.ok,
    error: r.error
  }));
}

function scoreBadge(score?: LetualPhotoScore): string {
  if (!score) return "";
  const tags: string[] = [];
  if (score.hasBox) tags.push("коробка");
  if (!score.isFrontal) tags.push("не фронт");
  if (!score.hasWhiteBackground) tags.push("фон");
  if (!score.hasProduct) tags.push("нет товара");
  if (tags.length) return tags.join(", ");
  return score.suitable ? "подходит" : score.reason;
}

export function LetualMainPhotoTool() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<Tab>("variations");
  const [text, setText] = useState("");
  const [openaiKey, setOpenaiKey] = useState("");
  const [rememberKey, setRememberKey] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<UiRow[]>([]);
  const [resultBlob, setResultBlob] = useState<{ blob: Blob; name: string } | null>(null);
  const [excelBuilding, setExcelBuilding] = useState(false);
  const [status, setStatus] = useState<{
    storage: boolean;
    metabase: boolean;
    serpapi: boolean;
  } | null>(null);

  const [galleryFor, setGalleryFor] = useState<number | null>(null);
  const [galleryPhotos, setGalleryPhotos] = useState<GalleryPhoto[]>([]);
  const [galleryLoading, setGalleryLoading] = useState(false);

  const [searchFor, setSearchFor] = useState<UiRow | null>(null);
  const [searchHits, setSearchHits] = useState<SearchHit[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  const [manualUrl, setManualUrl] = useState<Record<number, string>>({});

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
      .then((d: { configured?: boolean; metabase?: boolean; serpapi?: boolean }) => {
        setStatus({
          storage: Boolean(d.configured),
          metabase: Boolean(d.metabase),
          serpapi: Boolean(d.serpapi)
        });
      })
      .catch(() => setStatus({ storage: false, metabase: false, serpapi: false }));
  }, []);

  const stats = useMemo(() => {
    const generated = rows.filter((r) => r.generated && r.resultUrl).length;
    const ready = rows.filter((r) => r.sourceUrl && (r.status === "ok" || r.status === "manual")).length;
    const review = rows.filter((r) => r.status === "review" || r.status === "no_photo").length;
    return { generated, ready, review, total: rows.length };
  }, [rows]);

  const onFile = useCallback(async (file: File | null) => {
    if (!file) return;
    setError(null);
    try {
      const parsed = await readVariationIdsFromExcel(file);
      const ids = parsed.map((r) => r.variationId).slice(0, LETUAL_BATCH_MAX);
      setText(ids.join("\n"));
      if (parsed.length > LETUAL_BATCH_MAX) {
        setError(`В файле ${parsed.length} строк — обработаем первые ${LETUAL_BATCH_MAX}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось прочитать Excel");
    }
  }, []);

  const runPick = useCallback(async () => {
    const key = openaiKey.trim();
    if (!key) {
      setError("Укажите OpenAI API key для отбора фото");
      return;
    }
    if (status && !status.metabase) {
      setError("Metabase не настроен на сервере");
      return;
    }

    const ids = parseVariationIdsFromText(text).slice(0, LETUAL_BATCH_MAX);
    if (!ids.length) {
      setError("Добавьте variation_id");
      return;
    }

    setBusy(true);
    setError(null);
    setRows([]);
    setResultBlob(null);

    const all: UiRow[] = [];
    try {
      for (let i = 0; i < ids.length; i += LETUAL_API_CHUNK) {
        const chunk = ids.slice(i, i + LETUAL_API_CHUNK);
        setProgress(`Подбор фото ${i + 1}–${i + chunk.length} из ${ids.length}…`);
        const part = await pickChunk(chunk, key);
        all.push(...part);
        setRows([...all]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка подбора");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }, [openaiKey, status, text]);

  const selectPhoto = useCallback(
    (variationId: number, url: string, label: string) => {
      setRows((prev) =>
        prev.map((r) =>
          r.variationId === variationId
            ? {
                ...r,
                sourceUrl: url,
                previewUrl: url,
                sourceLabel: label,
                status: "manual" as const,
                comment: "Выбрано вручную"
              }
            : r
        )
      );
      setGalleryFor(null);
      setSearchFor(null);
    },
    []
  );

  const applyManualUrl = useCallback((variationId: number) => {
    const url = manualUrl[variationId]?.trim();
    if (!url?.startsWith("http")) return;
    selectPhoto(variationId, url, "manual_url");
  }, [manualUrl, selectPhoto]);

  const openGallery = useCallback(
    async (row: UiRow) => {
      const key = openaiKey.trim();
      if (!key) {
        setError("Нужен OpenAI key для оценки фото в галерее");
        return;
      }
      setGalleryFor(row.variationId);
      setGalleryLoading(true);
      setGalleryPhotos([]);
      try {
        const res = await fetch(
          `/api/letual/photos?variationId=${row.variationId}&score=1&openaiApiKey=${encodeURIComponent(key)}`
        );
        const data = (await res.json()) as { photos?: GalleryPhoto[]; error?: string };
        if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
        setGalleryPhotos(data.photos ?? []);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не удалось загрузить фото");
        setGalleryFor(null);
      } finally {
        setGalleryLoading(false);
      }
    },
    [openaiKey]
  );

  const openSearch = useCallback(
    async (row: UiRow) => {
      const key = openaiKey.trim();
      if (!key) {
        setError("Нужен OpenAI key для поиска");
        return;
      }
      setSearchFor(row);
      setSearchHits([]);
      setSearchLoading(true);
      try {
        const res = await fetch("/api/letual/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ean: row.ean,
            productName: row.productName,
            brandName: row.brandName,
            openaiApiKey: key
          })
        });
        const data = (await res.json()) as { results?: SearchHit[]; error?: string };
        if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
        setSearchHits(data.results ?? []);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Ошибка поиска");
        setSearchFor(null);
      } finally {
        setSearchLoading(false);
      }
    },
    [openaiKey]
  );

  const runGenerate = useCallback(
    async (mode: "all" | "except") => {
      const toGen = rows.filter((r) => {
        if (!r.sourceUrl) return false;
        if (mode === "except") return r.status === "ok" || r.status === "manual";
        return true;
      });
      if (!toGen.length) {
        setError(mode === "except" ? "Нет позиций со статусом OK" : "Нет выбранных фото");
        return;
      }

      setBusy(true);
      setError(null);
      setProgress(`Генерация 0 / ${toGen.length}…`);

      const updated = new Map(rows.map((r) => [r.variationId, { ...r }]));
      let done = 0;

      try {
        for (let i = 0; i < toGen.length; i += LETUAL_API_CHUNK) {
          const chunk = toGen.slice(i, i + LETUAL_API_CHUNK);
          setProgress(`Генерация ${i + 1}–${i + chunk.length} из ${toGen.length}…`);
          const results = await generateChunk(
            chunk.map((r) => ({ variationId: r.variationId, sourceUrl: r.sourceUrl }))
          );
          for (const res of results) {
            if (!res.variationId) continue;
            const row = updated.get(res.variationId);
            if (!row) continue;
            row.resultUrl = res.ok ? res.resultUrl : undefined;
            row.generated = res.ok;
            row.generateError = res.ok ? undefined : (res.error ?? "ошибка генерации");
            if (res.ok && res.resultUrl) {
              row.resultPreviewUrl = res.resultUrl;
            }
            updated.set(res.variationId, row);
            done++;
          }
          setRows([...updated.values()]);
        }
        setProgress(`Готово: ${done} из ${toGen.length}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Ошибка генерации");
      } finally {
        setBusy(false);
        setTimeout(() => setProgress(null), 3000);
      }
    },
    [rows]
  );

  useEffect(() => {
    const withResults = rows.filter((r) => r.generated && r.resultUrl);
    if (!withResults.length) {
      setResultBlob(null);
      return;
    }
    let cancelled = false;
    setExcelBuilding(true);
    void (async () => {
      const excelRows: LetualResultRow[] = withResults.map((r) => ({
        variationId: r.variationId,
        sourceUrl: r.sourceUrl,
        resultUrl: r.resultUrl!,
        comment: r.comment,
        previewUrl: r.resultUrl,
        ok: true
      }));
      const blob = await buildLetualVariationResultWorkbook(excelRows);
      if (cancelled) return;
      const suffix = new Date().toISOString().slice(0, 10);
      setResultBlob({ blob, name: `letual-main-photo-${suffix}.xlsx` });
      setExcelBuilding(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [rows]);

  const downloadExcel = useCallback(async () => {
    if (!resultBlob) return;
    const url = URL.createObjectURL(resultBlob.blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = resultBlob.name;
    a.click();
    URL.revokeObjectURL(url);
  }, [resultBlob]);

  const runUrlMode = useCallback(async () => {
    const urls = parseUrlsFromText(text).slice(0, LETUAL_BATCH_MAX);
    if (!urls.length) {
      setError("Добавьте URL");
      return;
    }
    setBusy(true);
    setError(null);
    const all: LetualResultRow[] = [];
    try {
      for (let i = 0; i < urls.length; i += LETUAL_API_CHUNK) {
        const chunk = urls.slice(i, i + LETUAL_API_CHUNK);
        setProgress(`Обработка ${i + 1}–${i + chunk.length}…`);
        const res = await fetch("/api/letual/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items: chunk.map((u) => ({ sourceUrl: u })) })
        });
        const data = (await res.json()) as { results?: LetualResultRow[]; error?: string };
        if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
        all.push(...(data.results ?? []));
      }
      setRows(
        all.map((r, i) => ({
          variationId: r.variationId ?? i,
          productName: "",
          brandName: "",
          ean: null,
          sourceUrl: r.sourceUrl ?? "",
          sourceLabel: "url",
          status: r.ok ? "ok" : "no_photo",
          comment: r.comment,
          previewUrl: r.previewUrl,
          resultUrl: r.resultUrl,
          generated: r.ok
        }))
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }, [text]);

  return (
    <div className="space-y-6">
      {status ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600 space-y-1">
          <p>
            S3:{" "}
            <strong className={status.storage ? "text-emerald-700" : "text-red-700"}>
              {status.storage ? "OK" : "не настроено"}
            </strong>
            {" · "}
            Metabase:{" "}
            <strong className={status.metabase ? "text-emerald-700" : "text-red-700"}>
              {status.metabase ? "OK" : "нет"}
            </strong>
            {" · "}
            Поиск в интернете:{" "}
            <strong className={status.serpapi ? "text-emerald-700" : "text-slate-600"}>
              {status.serpapi ? "SerpAPI" : "не подключён"}
            </strong>
          </p>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={`rounded-lg px-4 py-2 text-sm font-medium ${
            tab === "variations" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700"
          }`}
          onClick={() => setTab("variations")}
        >
          По ID вариаций
        </button>
        <button
          type="button"
          className={`rounded-lg px-4 py-2 text-sm font-medium ${
            tab === "urls" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700"
          }`}
          onClick={() => setTab("urls")}
        >
          По ссылкам (сразу генерация)
        </button>
      </div>

      <section className={homeCard}>
        <div className={homeCardHeader}>
          <h2 className={homeCardTitle}>
            {tab === "variations" ? `ID вариаций (до ${LETUAL_BATCH_MAX})` : `Ссылки на фото (до ${LETUAL_BATCH_MAX})`}
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
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                onClick={() => fileRef.current?.click()}
              >
                Загрузить Excel
              </button>
            </div>
          ) : null}

          <textarea
            className={`${homeInput} min-h-[120px] font-mono text-sm`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={tab === "variations" ? "258767564\n240352334" : "https://...\nhttps://..."}
          />

          {tab === "variations" ? (
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
          ) : null}

          <div className="flex flex-wrap gap-2">
            {tab === "variations" ? (
              <button type="button" disabled={busy} className={homeBtnPrimary} onClick={() => void runPick()}>
                {busy ? "Подбор…" : "1. Подобрать фото"}
              </button>
            ) : (
              <button type="button" disabled={busy} className={homeBtnPrimary} onClick={() => void runUrlMode()}>
                {busy ? "Генерация…" : "Сгенерировать"}
              </button>
            )}
          </div>

          {progress ? <p className="text-sm text-slate-600">{progress}</p> : null}
          {error ? (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
          ) : null}
        </div>
      </section>

      {rows.length > 0 && tab === "variations" ? (
        <section className={homeCard}>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-5">
            <h2 className={homeCardTitle}>
              Подбор ({stats.ready} готовы, {stats.review} на проверку)
            </h2>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                className="rounded-lg bg-slate-800 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
                onClick={() => void runGenerate("all")}
              >
                2. Сгенерировать все
              </button>
              <button
                type="button"
                disabled={busy}
                className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                onClick={() => void runGenerate("except")}
              >
                Сгенерировать кроме проблемных
              </button>
              {resultBlob ? (
                <button
                  type="button"
                  onClick={() => void downloadExcel()}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                >
                  {excelBuilding ? "Excel…" : "Excel"}
                </button>
              ) : null}
            </div>
          </div>
          <div className={`${homeCardBody} overflow-x-auto`}>
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                  <th className="pb-2 pr-3">ID</th>
                  <th className="pb-2 pr-3">Источник</th>
                  <th className="pb-2 pr-3">Статус</th>
                  <th className="pb-2 pr-3">Комментарий</th>
                  <th className="pb-2 pr-3">Результат</th>
                  <th className="pb-2">Действия</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr key={r.variationId}>
                    <td className="py-3 pr-3 align-top font-mono">{r.variationId}</td>
                    <td className="py-3 pr-3 align-top">
                      {r.sourceUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={r.sourceUrl}
                          alt=""
                          title="Исходник"
                          className="h-20 w-20 rounded border border-slate-200 bg-white object-contain"
                        />
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="py-3 pr-3 align-top">
                      <span
                        className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[r.status]}`}
                      >
                        {STATUS_LABEL[r.status]}
                      </span>
                    </td>
                    <td className="py-3 pr-3 align-top text-xs text-slate-600 max-w-[200px]">
                      {r.error ?? r.comment}
                    </td>
                    <td className="py-3 pr-3 align-top">
                      {r.resultUrl && r.generated ? (
                        <a
                          href={r.resultUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="block w-24"
                          title="Открыть результат"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={r.resultUrl}
                            alt=""
                            className="h-24 w-24 rounded border border-emerald-200 bg-white object-contain"
                          />
                          <span className="mt-1 block text-[10px] text-sky-700">открыть</span>
                        </a>
                      ) : r.generateError ? (
                        <span className="text-xs text-red-700">{r.generateError}</span>
                      ) : (
                        <span className="text-slate-400 text-xs">ещё не сгенерировано</span>
                      )}
                    </td>
                    <td className="py-3 align-top">
                      <div className="flex flex-col gap-1">
                        <button
                          type="button"
                          className="text-left text-xs text-sky-700 hover:underline"
                          onClick={() => void openGallery(r)}
                        >
                          Другие фото
                        </button>
                        <button
                          type="button"
                          className="text-left text-xs text-sky-700 hover:underline"
                          onClick={() => void openSearch(r)}
                        >
                          Поиск в интернете
                        </button>
                        <div className="flex gap-1 mt-1">
                          <input
                            type="url"
                            className="w-full min-w-0 rounded border border-slate-200 px-1 py-0.5 text-xs"
                            placeholder="URL фото"
                            value={manualUrl[r.variationId] ?? ""}
                            onChange={(e) =>
                              setManualUrl((m) => ({ ...m, [r.variationId]: e.target.value }))
                            }
                          />
                          <button
                            type="button"
                            className="shrink-0 rounded bg-slate-100 px-2 text-xs"
                            onClick={() => applyManualUrl(r.variationId)}
                          >
                            OK
                          </button>
                        </div>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {rows.some((r) => r.generated && r.resultUrl) ? (
              <div className="mt-6 border-t border-slate-100 pt-4">
                <h3 className="mb-3 text-sm font-semibold text-slate-800">Превью результатов</h3>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
                  {rows
                    .filter((r) => r.generated && r.resultUrl)
                    .map((r) => (
                      <a
                        key={r.variationId}
                        href={r.resultUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-lg border border-slate-200 bg-white p-2 hover:border-emerald-300"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={r.resultUrl}
                          alt=""
                          className="mx-auto h-40 w-full object-contain"
                        />
                        <p className="mt-2 text-center font-mono text-xs text-slate-600">{r.variationId}</p>
                      </a>
                    ))}
                </div>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {galleryFor !== null ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white p-4 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-semibold">Фото вариации {galleryFor}</h3>
              <button type="button" className="text-slate-500" onClick={() => setGalleryFor(null)}>
                ✕
              </button>
            </div>
            {galleryLoading ? (
              <p className="text-sm text-slate-500">Загрузка и оценка…</p>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {galleryPhotos.map((p) => (
                  <button
                    key={p.url}
                    type="button"
                    className="rounded-lg border border-slate-200 p-2 text-left hover:border-sky-400"
                    onClick={() => selectPhoto(galleryFor, p.url, MATCH_LABEL[p.matchType])}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.url} alt="" className="mx-auto h-28 w-full object-contain" />
                    <p className="mt-1 text-[10px] text-slate-500">
                      {MATCH_LABEL[p.matchType]} · {p.variationId}
                    </p>
                    {p.score ? (
                      <p className="text-[10px] text-amber-800">{scoreBadge(p.score)}</p>
                    ) : null}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}

      {searchFor ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white p-4 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-semibold">
                Поиск: {searchFor.brandName} {searchFor.productName}
              </h3>
              <button type="button" className="text-slate-500" onClick={() => setSearchFor(null)}>
                ✕
              </button>
            </div>
            {searchLoading ? (
              <p className="text-sm text-slate-500">Поиск и оценка…</p>
            ) : searchHits.length === 0 ? (
              <p className="text-sm text-slate-500">
                Ничего не найдено. {status?.serpapi ? "" : "SerpAPI не подключён — вставьте URL вручную."}
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {searchHits.map((h) => (
                  <button
                    key={h.url}
                    type="button"
                    className="rounded-lg border border-slate-200 p-2 text-left hover:border-sky-400"
                    onClick={() => selectPhoto(searchFor.variationId, h.url, `web:${h.source}`)}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={h.url} alt="" className="mx-auto h-28 w-full object-contain" />
                    <p className="mt-1 text-[10px] text-slate-500">{h.source}</p>
                    {h.score ? (
                      <p className="text-[10px] text-amber-800">{scoreBadge(h.score)}</p>
                    ) : null}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
