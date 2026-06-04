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
  listAiColumnsOnSheet,
  mappingIsComplete,
  readAiFromSheet,
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
import type { PodruzhkaAiResult } from "@/lib/podruzhkaTypes";
import type ExcelJS from "exceljs";

const SK_OPENAI = "fp_podruzhka_openai_key";
const SK_OPENAI_REM = "fp_podruzhka_openai_remember";
const NOTES_CHUNK = 3;
const RENDER_CHUNK = 2;

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
  const [notesStats, setNotesStats] = useState<{ ok: number; fail: number; written: number } | null>(
    null
  );
  const [infographicDone, setInfographicDone] = useState(false);
  const [renderStats, setRenderStats] = useState<{
    ok: number;
    fail: number;
    noFoto: number;
    sampleFotoError: string | null;
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
      setStep(1);
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
      setNotesStats({ ok: ready, fail: 0, written: 0 });
      setNotesDone(true);
      setStep(2);
      setBusy(false);
      return;
    }

    const results: PodruzhkaAiResult[] = [];
    let ok = 0;
    let fail = 0;

    try {
      if (pending.length > 0) {
        for (let i = 0; i < pending.length; i += NOTES_CHUNK) {
          const chunk = pending.slice(i, i + NOTES_CHUNK);
          setProgress(`AI: model и ноты — ${i} / ${pending.length}…`);

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

          for (const r of data.results ?? []) {
            results.push(r);
            if (r.ok) ok++;
            else fail++;
          }
        }
      }

      applyAiResults(ws, sheetInfo, results);
      const readyAfter = countAiReadyRows(ws, sheetInfo);
      if (readyAfter === 0) {
        setError(
          "AI не смог заполнить model и ноты. Проверьте ключ OpenAI и названия товаров в Excel."
        );
        setBusy(false);
        return;
      }
      setNotesStats({
        ok: readyAfter,
        fail,
        written: results.length
      });
      setNotesDone(true);
      setForceAiRegenerate(false);

      const fresh = refreshWorkbookScan(wb, scan) ?? scan;
      setScan(fresh);
      syncSheetInfo(wb, fresh, mapping);
      setStep(2);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка шага 1");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }, [wb, scan, sheetInfo, mapping, openaiKey, rememberKey, syncSheetInfo, forceAiRegenerate]);

  const runRender = useCallback(async () => {
    if (!wb || !sheetInfo || !notesDone) return;

    setBusy(true);
    setError(null);
    setInfographicDone(false);
    setRenderStats(null);
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
    const todo: typeof sheetInfo.rows = [];

    for (const row of sheetInfo.rows) {
      const ai = readAiFromSheet(ws, sheetInfo, row);
      if (ai.status !== "ok" || !ai.model || !ai.notes.every((n) => n.title && n.desc)) {
        continue;
      }
      todo.push(row);
    }

    if (todo.length === 0) {
      setError(
        "Нет строк для картинок: нужны model и note 1–3 (заполните вручную или шаг 1 AI)."
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
              const res = await fetch("/api/podruzhka/render", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  brandName: row.brandName,
                  productType: row.productType,
                  model: ai.model,
                  ml: row.ml,
                  fotoUrl: row.foto,
                  notes: ai.notes
                })
              });
              const data = (await res.json()) as {
                url?: string;
                error?: string;
                fotoLoaded?: boolean;
                fotoError?: string;
              };
              if (!res.ok || !data.url) {
                fail++;
                return;
              }
              urls.set(row.row, data.url);
              ok++;
              if (!data.fotoLoaded) {
                noFoto++;
                if (!sampleFotoError && data.fotoError) sampleFotoError = data.fotoError;
              }
              if (!previewUrl) setPreviewUrl(data.url);
            } catch {
              fail++;
            }
          })
        );
      }

      const { foto2Col } = applyFoto2Urls(ws, sheetInfo, urls);
      setSheetInfo((prev) => (prev ? { ...prev, foto2Col } : prev));
      setRenderStats({ ok, fail, noFoto, sampleFotoError });
      setInfographicDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка инфографики");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }, [wb, sheetInfo, notesDone, previewUrl]);

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
  const step2Ready = step1Ready && notesDone;

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
            <strong>2.</strong> AI заполняет <strong>model</strong> и <strong>note 1–3</strong> по
            образцу (как Nasomatto Pardon) — обязательно перед инфографикой.
          </p>
          <p>
            <strong>3.</strong> Инфографика 1080×1350 → ссылки в <strong>foto 2</strong>.
          </p>
          <p>
            <strong>4.</strong> При необходимости — публичные https в <strong>foto 3</strong>.
          </p>
          <div className="flex flex-wrap gap-2 pt-2">
            {stepBtn(1, "1. Ноты (AI)", Boolean(wb))}
            {stepBtn(2, "2. Инфографика", step2Ready)}
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
            {busy && !wb ? "Читаем…" : "Загрузить Excel"}
          </button>
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

      {mappingConfirmed && !notesDone && step === 1 ? (
        <section className={homeCard}>
          <div className={homeCardHeader}>
            <h2 className={homeCardTitle}>Шаг 1 — model и ноты (AI)</h2>
          </div>
          <div className={`${homeCardBody} space-y-4`}>
            <p className="text-sm text-slate-600">
              <strong>model</strong> и <strong>note 1–3</strong> на карточке пишет только AI — в
              формате образца: заголовок ноты ЗАГЛАВНЫМИ, описание с маленькой буквы (например «ПРЯНЫЙ
              пикантный характер»). Без этого шага инфографика будет пустой или кривой.
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
            <button
              type="button"
              className={homeBtnPrimary}
              disabled={busy}
              onClick={() => void runNotes()}
            >
              {busy ? "Идёт AI…" : "Сгенерировать model и ноты (AI)"}
            </button>
          </div>
        </section>
      ) : null}

      {notesDone && (
        <section className="rounded-xl border-2 border-amber-300 bg-amber-50 px-4 py-3 flex flex-wrap items-center gap-3">
          <span className="text-sm font-semibold text-amber-950">Шаг 1 готов — проверьте Excel</span>
          <button
            type="button"
            className={homeBtnPrimary}
            disabled={busy}
            onClick={() => void downloadWorkbook("notes")}
          >
            Скачать Excel (модель + ноты)
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

      {notesDone && notesStats && step === 1 ? (
        <StepDoneBanner title="Шаг 1 завершён">
          <p className="text-sm text-emerald-800">
            Записано строк: {notesStats.written}. Успешно: {notesStats.ok}, без данных: {notesStats.fail}.
            Откройте Excel — колонки model, note 1, note 2, note 3.
          </p>
        </StepDoneBanner>
      ) : null}

      {step2Ready && step === 2 ? (
        <section className={homeCard}>
          <div className={homeCardHeader}>
            <h2 className={homeCardTitle}>Шаг 2 — инфографика</h2>
          </div>
          <div className={`${homeCardBody} space-y-4`}>
            <p className="text-xs text-slate-500">
              Каждая строка — новая карточка: brand name, product_type, model, note 1–3, ml, foto →
              JPG в <strong>foto 2</strong>.
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
                </p>
                {renderStats.noFoto > 0 ? (
                  <p className="text-sm text-amber-900">
                    Проверьте сопоставление <strong>Фото товара</strong> и ссылки в Excel.
                    {renderStats.sampleFotoError ? ` (${renderStats.sampleFotoError})` : ""}
                  </p>
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

      {step2Ready && step === 3 && infographicDone && (
        <OzonImageConverter embedded pipeline={pipeline} />
      )}
    </div>
  );
}
