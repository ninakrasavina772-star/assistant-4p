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
import { OzonImageConverter } from "@/components/OzonImageConverter";
import { PodruzhkaColumnMappingUI } from "@/components/PodruzhkaColumnMappingUI";
import { PodruzhkaDetectedLayout } from "@/components/PodruzhkaDetectedLayout";
import {
  applyAiResults,
  applyFoto2Urls,
  autoDetectPodruzhkaMapping,
  buildFoto2ColumnInfo,
  buildSheetFromMapping,
  countAiReadyRows,
  defaultPodruzhkaDownloadName,
  ensureAiColumns,
  getRowRenderEligibility,
  listAiColumnsOnSheet,
  mappingIsComplete,
  readAiFromSheet,
  readProductTypeForCard,
  rowNeedsAiGeneration,
  readWorkbookFromFile,
  refreshWorkbookScan,
  scanWorkbookHeaders,
  writeWorkbookToBlob,
  type AutoDetectResult,
  type PodruzhkaColumnMapping,
  type PodruzhkaFieldKey,
  type PodruzhkaSheetInfo,
  type WorkbookScan
} from "@/lib/podruzhkaExcel";
import { PODRUZHKA_FIELD_LABELS } from "@/lib/podruzhkaColumnMapping";
import { renderPodruzhkaCardClient } from "@/lib/podruzhkaClientRender";
import type { PodruzhkaAiResult } from "@/lib/podruzhkaTypes";
import type ExcelJS from "exceljs";

const SK_OPENAI = "fp_podruzhka_openai_key";
const SK_OPENAI_REM = "fp_podruzhka_openai_remember";
/** Строк в одном запросе к API (параллельно на сервере) */
const NOTES_CHUNK = 5;
/** Сколько запросов к API одновременно с браузера */
const NOTES_PARALLEL = 4;
/** HTML-рендер в браузере — по 1 карточке (html2canvas тяжёлый) */
const RENDER_CHUNK = 1;

type Step = 1 | 2 | 3;

function StepDoneBanner({
  title,
  children
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50/80 px-4 py-4 space-y-3">
      <p className="text-sm font-semibold text-emerald-900">{title}</p>
      {children}
    </div>
  );
}

export function PodruzhkaOzonTool() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>(1);
  const [fileName, setFileName] = useState<string | null>(null);
  const [wb, setWb] = useState<ExcelJS.Workbook | null>(null);
  const [scan, setScan] = useState<WorkbookScan | null>(null);
  const [mapping, setMapping] = useState<PodruzhkaColumnMapping>({});
  const [mappingConfirmed, setMappingConfirmed] = useState(false);
  const [detection, setDetection] = useState<AutoDetectResult | null>(null);
  const [manualMapping, setManualMapping] = useState(false);
  const [sheetInfo, setSheetInfo] = useState<PodruzhkaSheetInfo | null>(null);
  const [aiColumns, setAiColumns] = useState<{ key: string; header: string; col: number }[]>(
    []
  );
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openaiKey, setOpenaiKey] = useState("");
  const [rememberKey, setRememberKey] = useState(true);
  const [notesDone, setNotesDone] = useState(false);
  const [notesStats, setNotesStats] = useState<{
    ok: number;
    fail: number;
    written: number;
    typeMismatch?: number;
  } | null>(null);
  const [infographicDone, setInfographicDone] = useState(false);
  const [layoutVersion, setLayoutVersion] = useState<string | null>(null);
  const [renderStats, setRenderStats] = useState<{
    ok: number;
    fail: number;
    noFoto: number;
    sampleFotoError: string | null;
    visionNote: string | null;
    skipped: { row: number; brand: string; reasons: string }[];
    noFotoRows: { row: number; brand: string; error: string }[];
    layoutWarnings: { row: number; brand: string; warning: string }[];
  } | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [forceAiRegenerate, setForceAiRegenerate] = useState(false);

  useEffect(() => {
    if (typeof sessionStorage === "undefined") return;
    if (sessionStorage.getItem(SK_OPENAI_REM) !== "0") {
      const k = sessionStorage.getItem(SK_OPENAI);
      if (k) setOpenaiKey(k);
    }
  }, []);

  const downloadBlob = useCallback((blob: Blob, name: string) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  }, []);

  const downloadWorkbook = useCallback(
    async (suffix: "notes" | "infographic" | "foto3") => {
      if (!wb || !scan) return;
      try {
        const ws = wb.getWorksheet(scan.sheetName);
        if (ws) ensureAiColumns(ws, scan.headerRow);
        const blob = await writeWorkbookToBlob(wb);
        downloadBlob(blob, defaultPodruzhkaDownloadName(fileName, suffix));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не удалось сохранить Excel");
      }
    },
    [wb, scan, fileName, downloadBlob]
  );

  const syncSheetInfo = useCallback(
    (workbook: ExcelJS.Workbook, scanned: WorkbookScan, m: PodruzhkaColumnMapping) => {
      const info = buildSheetFromMapping(workbook, scanned, m);
      if (info) setSheetInfo(info);
      const ws = workbook.getWorksheet(scanned.sheetName);
      if (ws) setAiColumns(listAiColumnsOnSheet(ws, scanned.headerRow));
      return info;
    },
    []
  );

  const confirmMapping = useCallback(() => {
    if (!wb || !scan) return;
    const err = mappingIsComplete(mapping);
    if (err) {
      setError(err);
      return;
    }
    const ws = wb.getWorksheet(scan.sheetName);
    if (!ws) {
      setError("Лист не найден");
      return;
    }
    ensureAiColumns(ws, scan.headerRow);
    const fresh = refreshWorkbookScan(wb, scan) ?? scan;
    setScan(fresh);
    const info = syncSheetInfo(wb, fresh, mapping);
    if (!info) {
      setError("Нет строк с данными — проверьте бренд или foto в выбранных колонках");
      return;
    }
    setMappingConfirmed(true);
    setError(null);
    setStep(1);
  }, [wb, scan, mapping, syncSheetInfo]);

  const onMappingChange = useCallback((field: PodruzhkaFieldKey, col: number | undefined) => {
    setMapping((m) => ({ ...m, [field]: col }));
  }, []);

  const finishUpload = useCallback(
    (
      workbook: ExcelJS.Workbook,
      scanned: WorkbookScan,
      m: PodruzhkaColumnMapping,
      detected: AutoDetectResult
    ) => {
      const ws = workbook.getWorksheet(scanned.sheetName);
      if (!ws) {
        setError("Лист не найден");
        return false;
      }
      ensureAiColumns(ws, scanned.headerRow);
      const fresh = refreshWorkbookScan(workbook, scanned) ?? scanned;
      setScan(fresh);
      const info = syncSheetInfo(workbook, fresh, m);
      if (!info) {
        setError(
          "Нет строк с товарами — проверьте, что в колонках brand name и foto есть данные"
        );
        return false;
      }
      setDetection(detected);
      setMappingConfirmed(true);
      setManualMapping(false);
      const ready = countAiReadyRows(ws, info);
      if (ready > 0) {
        setNotesDone(true);
        setNotesStats({
          ok: ready,
          fail: info.rows.length - ready,
          written: 0
        });
      } else {
        setNotesDone(false);
        setNotesStats(null);
        setStep(1);
      }
      setError(null);
      return true;
    },
    [syncSheetInfo]
  );

  const onFile = useCallback(
    async (file: File) => {
      setBusy(true);
      setError(null);
      setNotesDone(false);
      setNotesStats(null);
      setInfographicDone(false);
      setRenderStats(null);
    setLayoutVersion(null);
      setPreviewUrl(null);
      setMappingConfirmed(false);
      setSheetInfo(null);
      setAiColumns([]);
      setDetection(null);
      setManualMapping(false);
      setProgress("Читаем Excel…");

      try {
        const workbook = await readWorkbookFromFile(file);
        const scanned = scanWorkbookHeaders(workbook);
        if (!scanned) {
          setError("Не найдена строка заголовков в Excel");
          return;
        }
        const detected = autoDetectPodruzhkaMapping(scanned.headers);
        setWb(workbook);
        setScan(scanned);
        setMapping(detected.mapping);
        setFileName(file.name);

        if (!detected.isReady) {
          setManualMapping(true);
          setError(
            `Файл не похож на образец. Не найдены колонки: ${detected.missing
              .map((k) => PODRUZHKA_FIELD_LABELS[k])
              .join(", ")}. Используйте шаблон с заголовками name, brand name, foto…`
          );
          return;
        }

        finishUpload(workbook, scanned, detected.mapping, detected);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Ошибка чтения Excel");
      } finally {
        setBusy(false);
        setProgress(null);
      }
    },
    [finishUpload]
  );

  const runNotes = useCallback(async () => {
    if (!wb || !scan || !sheetInfo) return;
    const key = openaiKey.trim();
    if (!key.startsWith("sk-")) {
      setError("Введите ключ OpenAI API (sk-…)");
      return;
    }
    if (rememberKey && typeof sessionStorage !== "undefined") {
      sessionStorage.setItem(SK_OPENAI, key);
      sessionStorage.setItem(SK_OPENAI_REM, "1");
    }

    setBusy(true);
    setError(null);
    setNotesStats(null);

    const ws = wb.getWorksheet(sheetInfo.sheetName);
    if (!ws) {
      setError("Лист не найден");
      setBusy(false);
      return;
    }

    ensureAiColumns(ws, scan.headerRow);

    const pending = sheetInfo.rows.filter((row) =>
      rowNeedsAiGeneration(ws, sheetInfo, row, forceAiRegenerate)
    );

    if (pending.length === 0) {
      const ready = countAiReadyRows(ws, sheetInfo);
      if (ready === 0) {
        setError(
          "Нет готовых строк. Запустите AI — он заполнит model и note 1–3 по образцу для инфографики."
        );
        setBusy(false);
        return;
      }
      setNotesStats({ ok: ready, fail: 0, written: 0, typeMismatch: 0 });
      setNotesDone(true);
      setStep(1);
      setBusy(false);
      return;
    }

    let ok = 0;
    let fail = 0;
    let writtenTotal = 0;
    let typeMismatchCount = 0;

    const fetchNotesChunk = async (
      chunk: (typeof pending)[number][]
    ): Promise<PodruzhkaAiResult[]> => {
      const res = await fetch("/api/podruzhka/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ openaiApiKey: key, rows: chunk })
      });
      const data = (await res.json()) as {
        results?: PodruzhkaAiResult[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      return data.results ?? [];
    };

    const applyChunkResults = (chunkResults: PodruzhkaAiResult[]) => {
      const { written, typeMismatch } = applyAiResults(ws, sheetInfo, chunkResults);
      writtenTotal += written;
      typeMismatchCount += typeMismatch;
      for (const r of chunkResults) {
        if (r.ok) ok++;
        else fail++;
      }
    };

    try {
      if (pending.length > 0) {
        const chunks: (typeof pending)[] = [];
        for (let i = 0; i < pending.length; i += NOTES_CHUNK) {
          chunks.push(pending.slice(i, i + NOTES_CHUNK));
        }

        let processed = 0;
        for (let w = 0; w < chunks.length; w += NOTES_PARALLEL) {
          const wave = chunks.slice(w, w + NOTES_PARALLEL);
          setProgress(`AI: model и ноты — ${processed} / ${pending.length}…`);

          const waveResults = await Promise.all(wave.map((chunk) => fetchNotesChunk(chunk)));
          for (const chunkResults of waveResults) {
            applyChunkResults(chunkResults);
            processed += chunkResults.length;
          }
          setProgress(`AI: model и ноты — ${processed} / ${pending.length}…`);
        }
      }

      const readyAfter = countAiReadyRows(ws, sheetInfo);
      if (writtenTotal === 0 && readyAfter === 0) {
        setError(
          "AI не смог заполнить model и ноты. Проверьте ключ OpenAI и названия товаров в Excel."
        );
        setBusy(false);
        return;
      }
      setNotesStats({
        ok: readyAfter,
        fail,
        written: writtenTotal,
        typeMismatch: typeMismatchCount
      });
      setNotesDone(true);
      setForceAiRegenerate(false);
      setStep(1);

      const fresh = refreshWorkbookScan(wb, scan) ?? scan;
      setScan(fresh);
      syncSheetInfo(wb, fresh, mapping);
    } catch (e) {
      if (writtenTotal > 0) {
        const readyPartial = countAiReadyRows(ws, sheetInfo);
        setNotesStats({
          ok: readyPartial,
          fail,
          written: writtenTotal,
          typeMismatch: typeMismatchCount
        });
        setNotesDone(true);
        setStep(1);
        setError(
          `${e instanceof Error ? e.message : "Ошибка шага 1"}. Уже записано строк: ${writtenTotal} — скачайте Excel и при необходимости запустите снова (без «перезаписать все»).`
        );
      } else {
        setError(e instanceof Error ? e.message : "Ошибка шага 1");
      }
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }, [wb, scan, sheetInfo, mapping, openaiKey, rememberKey, syncSheetInfo, forceAiRegenerate]);

  const runRender = useCallback(async () => {
    if (!wb || !sheetInfo || !scan) return;
    const wsCheck = wb.getWorksheet(sheetInfo.sheetName);
    if (!wsCheck || countAiReadyRows(wsCheck, sheetInfo) === 0) return;

    setBusy(true);
    setError(null);
    setInfographicDone(false);
    setRenderStats(null);
    setLayoutVersion(null);
    setPreviewUrl(null);

    const ws = wb.getWorksheet(sheetInfo.sheetName);
    if (!ws) {
      setError("Лист не найден");
      setBusy(false);
      return;
    }

    const urls = new Map<number, string>();
    let ok = 0;
    let fail = 0;
    let noFoto = 0;
    let sampleFotoError: string | null = null;
    let visionNote: string | null = null;
    const todo: typeof sheetInfo.rows = [];
    const skipped: { row: number; brand: string; reasons: string }[] = [];
    const noFotoRows: { row: number; brand: string; error: string }[] = [];
    const layoutWarnings: { row: number; brand: string; warning: string }[] = [];

    for (const row of sheetInfo.rows) {
      const el = getRowRenderEligibility(ws, sheetInfo, row);
      if (el.ok) {
        todo.push(row);
      } else {
        skipped.push({
          row: row.row,
          brand: row.brandName || row.name.slice(0, 30),
          reasons: el.reasons.join(", ") || el.status || "не готово"
        });
      }
    }

    if (todo.length === 0) {
      setError(
        `Нет строк для картинок (0 из ${sheetInfo.rows.length}). Запустите шаг 1 AI или заполните model и note 1–3 вручную.`
      );
      setBusy(false);
      return;
    }

    try {
      for (let i = 0; i < todo.length; i += RENDER_CHUNK) {
        const chunk = todo.slice(i, i + RENDER_CHUNK);
        setProgress(`Инфографика: ${i} / ${todo.length}…`);

        await Promise.all(
          chunk.map(async (row) => {
            const ai = readAiFromSheet(ws, sheetInfo, row);
            try {
              const rendered = await renderPodruzhkaCardClient({
                brandName: row.brandName,
                productType: readProductTypeForCard(ws, sheetInfo, row, ai.model),
                model: ai.model,
                ml: row.ml,
                fotoUrl: row.foto,
                notes: ai.notes
              });

              const form = new FormData();
              form.append(
                "file",
                rendered.blob,
                `podruzhka-row-${row.row}.jpg`
              );
              const res = await fetch("/api/podruzhka/upload", {
                method: "POST",
                body: form
              });
              const data = (await res.json()) as {
                url?: string;
                error?: string;
                fotoLoaded?: boolean;
                layoutVersion?: string;
              };
              if (!res.ok || !data.url) {
                fail++;
                const err = data.error ?? `HTTP ${res.status}`;
                noFoto++;
                noFotoRows.push({
                  row: row.row,
                  brand: row.brandName || row.name.slice(0, 30),
                  error: err
                });
                if (!sampleFotoError) sampleFotoError = err;
                return;
              }
              urls.set(row.row, data.url);
              ok++;
              if (data.layoutVersion) setLayoutVersion(data.layoutVersion);
              if (!previewUrl) setPreviewUrl(data.url);
              if (!visionNote) {
                visionNote =
                  "Рендер: Canvas 2D + adaptive bottom lift, html-figma-v11.";
              }
            } catch (e) {
              fail++;
              const err = e instanceof Error ? e.message : "ошибка рендера";
              noFoto++;
              noFotoRows.push({
                row: row.row,
                brand: row.brandName || row.name.slice(0, 30),
                error: err
              });
              if (!sampleFotoError) sampleFotoError = err;
            }
          })
        );
      }

      const { foto2Col } = applyFoto2Urls(ws, sheetInfo, urls);
      setSheetInfo((prev) => (prev ? { ...prev, foto2Col } : prev));
      setRenderStats({
        ok,
        fail,
        noFoto,
        sampleFotoError,
        visionNote,
        skipped,
        noFotoRows,
        layoutWarnings
      });
      setInfographicDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка инфографики");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }, [wb, sheetInfo, scan, previewUrl]);

  const renderReady = useMemo(() => {
    if (!wb || !sheetInfo || !scan) return { ready: 0, total: 0 };
    const ws = wb.getWorksheet(sheetInfo.sheetName);
    if (!ws) return { ready: 0, total: sheetInfo.rows.length };
    return {
      ready: countAiReadyRows(ws, sheetInfo),
      total: sheetInfo.rows.length
    };
  }, [wb, sheetInfo, scan, notesStats, infographicDone]);

  const pipeline = useMemo(() => {
    if (!wb || !sheetInfo || !infographicDone) return null;
    return {
      workbook: wb,
      fileName: fileName ?? "feed.xlsx",
      getFoto2Info: () => {
        const ws = wb.getWorksheet(sheetInfo.sheetName);
        if (!ws) return null;
        return buildFoto2ColumnInfo(ws, sheetInfo);
      }
    };
  }, [wb, sheetInfo, fileName, infographicDone]);

  const headerOptions = scan?.headers ?? [];
  const step1Ready = Boolean(wb && mappingConfirmed && sheetInfo);
  const canRenderInfographic = step1Ready && renderReady.ready > 0;

  const stepBtn = (n: Step, label: string, enabled: boolean) => (
    <button
      type="button"
      disabled={!enabled}
      onClick={() => enabled && setStep(n)}
      className={`rounded-lg px-3 py-1.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40 ${
        step === n
          ? "bg-[#ffd740] text-[#0a0a0a]"
          : "border border-slate-200 bg-white text-slate-700"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-6">
      <section className={homeCard}>
        <div className={homeCardHeader}>
          <h2 className={homeCardTitle}>Порядок работы</h2>
        </div>
        <div className={`${homeCardBody} text-sm text-slate-600 space-y-2`}>
          <p>
            <strong>1.</strong> Загрузить Excel как <strong>образец.xlsx</strong> — колонки
            распознаются сами (name, brand name, foto, note 1…).
          </p>
          <p>
            <strong>2.</strong> Два пути: <strong>AI</strong> заполняет model и ноты — или сразу{" "}
            <strong>инфографика</strong>, если в Excel уже есть model и note 1–3.
          </p>
          <p>
            <strong>3.</strong> После AI скачайте Excel, поправьте при необходимости, загрузите снова.
          </p>
          <p>
            <strong>4.</strong> Инфографика 1024×1365 → ссылки в <strong>foto 2</strong>.
          </p>
          <p>
            <strong>5.</strong> При необходимости — публичные https в <strong>foto 3</strong>.
          </p>
          <div className="flex flex-wrap gap-2 pt-2">
            {stepBtn(1, "1. Ноты (AI)", Boolean(wb))}
            {stepBtn(2, "2. Инфографика", canRenderInfographic)}
            {stepBtn(3, "3. Foto 3", infographicDone)}
          </div>
        </div>
      </section>

      <section className={homeCard}>
        <div className={homeCardHeader}>
          <h2 className={homeCardTitle}>Excel-фид</h2>
        </div>
        <div className={`${homeCardBody} space-y-4`}>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onFile(f);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            className={homeBtnPrimary}
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            {busy && !wb ? "Читаем…" : notesDone ? "Загрузить исправленный Excel" : "Загрузить Excel"}
          </button>
          {mappingConfirmed && sheetInfo ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 space-y-3">
              <p className="text-sm text-slate-700">
                <strong>{renderReady.ready}</strong> из <strong>{renderReady.total}</strong> строк
                готовы к инфографике (есть model, note 1–3 и foto).
              </p>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  className="rounded-lg border border-violet-700 bg-white px-4 py-2.5 text-sm font-semibold text-violet-900 hover:bg-violet-50"
                  disabled={busy}
                  onClick={() => setStep(1)}
                >
                  1. Запустить AI — найти model и ноты
                </button>
                <button
                  type="button"
                  className={homeBtnPrimary}
                  disabled={busy || renderReady.ready === 0}
                  title={
                    renderReady.ready === 0
                      ? "Сначала заполните model и note 1–3 (AI или вручную в Excel)"
                      : undefined
                  }
                  onClick={() => setStep(2)}
                >
                  2. Сразу генерировать инфографику
                </button>
              </div>
              {renderReady.ready === 0 ? (
                <p className="text-xs text-amber-900">
                  Нет готовых строк — запустите AI или заполните model, note 1–3 и note 1 (2)… в Excel.
                </p>
              ) : null}
            </div>
          ) : null}
          {fileName ? (
            <p className="text-sm text-slate-600">
              <strong>{fileName}</strong>
              {sheetInfo ? ` — ${sheetInfo.rows.length} товаров` : ""}
            </p>
          ) : null}
          {detection?.isReady && sheetInfo && mappingConfirmed && !manualMapping ? (
            <PodruzhkaDetectedLayout detection={detection} rowCount={sheetInfo.rows.length} />
          ) : null}
          {progress ? <p className="text-sm text-slate-600">{progress}</p> : null}
          {wb && notesDone ? (
            <button
              type="button"
              className={homeBtnPrimary}
              disabled={busy}
              onClick={() => void downloadWorkbook("notes")}
            >
              Скачать Excel (model, ноты, тип)
            </button>
          ) : null}
          {error ? (
            <p className="text-sm text-red-700" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </section>

      {wb && scan && manualMapping && !mappingConfirmed ? (
        <section className={homeCard}>
          <div className={homeCardHeader}>
            <h2 className={homeCardTitle}>Другая структура Excel — вручную</h2>
          </div>
          <div className={`${homeCardBody} space-y-4`}>
            <PodruzhkaColumnMappingUI
              mapping={mapping}
              headers={headerOptions}
              aiColumns={aiColumns}
              onChange={onMappingChange}
            />
            <button type="button" className={homeBtnPrimary} onClick={confirmMapping}>
              Применить и перейти к AI
            </button>
          </div>
        </section>
      ) : null}

      {wb && scan && mappingConfirmed && detection?.isReady ? (
        <p className="text-sm text-slate-600">
          <button
            type="button"
            className="underline"
            onClick={() => {
              setMappingConfirmed(false);
              setManualMapping(true);
            }}
          >
            Файл не как образец — настроить колонки вручную
          </button>
        </p>
      ) : null}

      {mappingConfirmed && step === 1 ? (
        <section className={homeCard}>
          <div className={homeCardHeader}>
            <h2 className={homeCardTitle}>Шаг 1 — model, ноты и тип (AI)</h2>
          </div>
          <div className={`${homeCardBody} space-y-4`}>
            <p className="text-sm text-slate-600">
              AI заполняет <strong>model</strong> и ноты в отдельных столбцах:{" "}
              <strong>note 1–3</strong> — название (ДРЕВЕСНЫЙ),{" "}
              <strong>note 1 (2)</strong>, <strong>note 2 (1)</strong>, <strong>note 3 (1)</strong>{" "}
              — описание (тёплый и глубокий). Три названия нот не повторяются.{" "}
              <strong>product_type</strong> в фиде не меняется.
            </p>
            <p className="text-xs text-slate-500">
              Скорость: до {NOTES_CHUNK * NOTES_PARALLEL} ароматов параллельно — ~1900 позиций
              обычно за 30–60 мин (вкладку не закрывать).
            </p>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={forceAiRegenerate}
                onChange={(e) => setForceAiRegenerate(e.target.checked)}
              />
              Перезаписать model и ноты у всех строк (даже если уже были)
            </label>
            {aiColumns.length > 0 ? (
              <p className="text-xs text-violet-800 bg-violet-50 rounded-lg px-3 py-2">
                Столбцы AI: {aiColumns.map((c) => `${c.header} (${c.col})`).join(", ")}
              </p>
            ) : null}
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-700">Ключ OpenAI</span>
              <input
                type="password"
                className={homeInput}
                value={openaiKey}
                onChange={(e) => setOpenaiKey(e.target.value)}
                placeholder="sk-…"
                autoComplete="off"
              />
            </label>
            {!notesDone ? (
              <button
                type="button"
                className={homeBtnPrimary}
                disabled={busy}
                onClick={() => void runNotes()}
              >
                {busy ? "Идёт AI…" : "Сгенерировать model, ноты и проверить тип (AI)"}
              </button>
            ) : notesStats && notesStats.fail > 0 ? (
              <button
                type="button"
                className="rounded-lg border border-violet-700 bg-white px-4 py-2 text-sm font-semibold text-violet-900"
                disabled={busy}
                onClick={() => void runNotes()}
              >
                {busy ? "Идёт AI…" : `Дозаполнить оставшиеся (${notesStats.fail})`}
              </button>
            ) : null}

            {notesDone && notesStats ? (
              <StepDoneBanner title="Шаг 1 завершён — скачайте Excel">
                <p className="text-sm text-emerald-800">
                  Записано строк: {notesStats.written}. Готово к инфографике: {notesStats.ok}, без
                  данных: {notesStats.fail}.
                  {notesStats.typeMismatch != null && notesStats.typeMismatch > 0 ? (
                    <>
                      {" "}
                      Тип на карточке отличается от product_type у {notesStats.typeMismatch} строк —
                      см. колонку <strong>product type card</strong>.
                    </>
                  ) : null}{" "}
                  Колонки: <strong>model</strong>, <strong>note 1–3</strong> и{" "}
                  <strong>note 1 (2)</strong> / <strong>note 2 (1)</strong> /{" "}
                  <strong>note 3 (1)</strong>, при необходимости <strong>product type card</strong>.
                </p>
                <button
                  type="button"
                  className={homeBtnPrimary}
                  disabled={busy}
                  onClick={() => void downloadWorkbook("notes")}
                >
                  Скачать Excel (model, ноты, тип)
                </button>
                <button
                  type="button"
                  className="w-full rounded-lg border border-emerald-700 bg-white px-4 py-2.5 text-sm font-semibold text-emerald-900"
                  onClick={() => setStep(2)}
                >
                  Проверила файл — к инфографике →
                </button>
              </StepDoneBanner>
            ) : null}
          </div>
        </section>
      ) : null}

      {notesDone && (
        <section className="rounded-xl border-2 border-amber-300 bg-amber-50 px-4 py-3 flex flex-wrap items-center gap-3">
          <span className="text-sm font-semibold text-amber-950">
            Шаг 1 готов — скачайте Excel, проверьте и при необходимости загрузите снова
          </span>
          <button
            type="button"
            className={homeBtnPrimary}
            disabled={busy}
            onClick={() => void downloadWorkbook("notes")}
          >
            Скачать Excel (model, ноты, тип)
          </button>
          {!infographicDone ? (
            <button
              type="button"
              className="rounded-lg border border-amber-700 bg-white px-4 py-2 text-sm font-semibold text-amber-950"
              onClick={() => setStep(2)}
            >
              К инфографике →
            </button>
          ) : null}
        </section>
      )}

      {canRenderInfographic && step === 2 ? (
        <section className={homeCard}>
          <div className={homeCardHeader}>
            <h2 className={homeCardTitle}>Шаг 2 — инфографика</h2>
          </div>
          <div className={`${homeCardBody} space-y-4`}>
            <p className="text-xs text-slate-500">
              Шаблон + данные из Excel. С ключом OpenAI каждая карточка сравнивается с{" "}
              <strong>референсом</strong> (GPT-4o Vision, до 2 проходов): подгоняются отступы текста,
              размер и положение фото. Дольше, но ближе к образцу Xerjoff.
            </p>
            <button
              type="button"
              className={homeBtnPrimary}
              disabled={busy}
              onClick={() => void runRender()}
            >
              {busy ? "Формируем…" : infographicDone ? "Перегенерировать все карточки" : "Сформировать инфографику"}
            </button>

            {infographicDone && renderStats ? (
              <StepDoneBanner title="Инфографика готова">
                <p className="text-sm text-emerald-800">
                  Готово: {renderStats.ok}
                  {renderStats.fail > 0 ? `, ошибок: ${renderStats.fail}` : ""}
                  {renderStats.noFoto > 0 ? `, без фото: ${renderStats.noFoto}` : ""}.
                  {layoutVersion ? (
                    <>
                      {" "}
                      Макет: <code className="text-xs">{layoutVersion}</code> (актуально:{" "}
                      html-figma-v11).
                    </>
                  ) : null}
                </p>
                {renderStats.visionNote ? (
                  <p className="text-sm text-slate-700">{renderStats.visionNote}</p>
                ) : null}
                {renderStats.skipped.length > 0 ? (
                  <div className="text-sm text-amber-900">
                    <p>
                      Пропущено строк: {renderStats.skipped.length} (нет model/нот или AI не
                      заполнил):
                    </p>
                    <ul className="mt-1 list-inside list-disc">
                      {renderStats.skipped.map((s) => (
                        <li key={s.row}>
                          строка {s.row} — {s.brand}: {s.reasons}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {renderStats.layoutWarnings.length > 0 ? (
                  <div className="text-sm text-slate-700">
                    <p>
                      Сохранено с замечанием по композиции ({renderStats.layoutWarnings.length}
                      ):
                    </p>
                    <ul className="mt-1 list-inside list-disc">
                      {renderStats.layoutWarnings.map((s) => (
                        <li key={s.row}>
                          строка {s.row} — {s.brand}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {renderStats.noFotoRows.length > 0 ? (
                  <div className="text-sm text-amber-900">
                    <p>
                      Без фото на карточке ({renderStats.noFotoRows.length}) — в Excel{" "}
                      <strong>foto 2</strong> не записано:
                    </p>
                    <ul className="mt-1 list-inside list-disc">
                      {renderStats.noFotoRows.map((s) => (
                        <li key={s.row}>
                          строка {s.row} — {s.brand}: {s.error}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {previewUrl ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={previewUrl} alt="Превью" className="max-w-xs rounded-lg border" />
                ) : null}
                <button
                  type="button"
                  className={homeBtnPrimary}
                  disabled={busy}
                  onClick={() => void downloadWorkbook("infographic")}
                >
                  Скачать Excel с foto 2
                </button>
                <button
                  type="button"
                  className="w-full rounded-lg border border-emerald-700 bg-white px-4 py-2.5 text-sm font-semibold text-emerald-900"
                  onClick={() => setStep(3)}
                >
                  Шаг 3 — Foto 3 →
                </button>
              </StepDoneBanner>
            ) : null}
          </div>
        </section>
      ) : null}

      {infographicDone && wb ? (
        <section className="rounded-xl border-2 border-amber-300 bg-amber-50 px-4 py-3 flex flex-wrap gap-3">
          <button
            type="button"
            className={homeBtnPrimary}
            onClick={() => void downloadWorkbook("infographic")}
          >
            Скачать готовый Excel
          </button>
        </section>
      ) : null}

      {canRenderInfographic && step === 3 && infographicDone && (
        <OzonImageConverter embedded pipeline={pipeline} />
      )}
    </div>
  );
}
