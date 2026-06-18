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
import { PodruzhkaCosmeticsColumnMappingUI } from "@/components/PodruzhkaCosmeticsColumnMappingUI";
import { PodruzhkaCosmeticsDetectedLayout } from "@/components/PodruzhkaCosmeticsDetectedLayout";
import { FourPartnersApiKeyField } from "@/components/FourPartnersApiKeyField";
import {
  PodruzhkaFeedCsvField,
  type FeedCsvMergeSource
} from "@/components/PodruzhkaFeedCsvField";
import { PodruzhkaExcelExample } from "@/components/PodruzhkaExcelExample";
import {
  applyCosmeticsAiResults,
  applyCosmeticsFoto2Urls,
  autoDetectCosmeticsMapping,
  buildCosmeticsFoto2ColumnInfo,
  buildCosmeticsSheetFromMapping,
  countCosmeticsReadyRows,
  cosmeticsMappingIsComplete,
  defaultCosmeticsDownloadName,
  ensureCosmeticsAiColumns,
  getCosmeticsRowRenderEligibility,
  getFeedRowAiSkipReason,
  guessCosmeticsColumnMapping,
  listCosmeticsTextColumnsOnSheet,
  makeFeedRowAiErrorResult,
  readCosmeticsProductTypeForCard,
  readCosmeticsTextsFromSheet,
  readWorkbookFromFile,
  refreshWorkbookScan,
  rowNeedsCosmeticsAiGeneration,
  scanWorkbookHeaders,
  writeWorkbookToBlob,
  type CosmeticsAutoDetectResult,
  type PodruzhkaCosmeticsColumnMapping,
  type PodruzhkaCosmeticsFieldKey,
  type PodruzhkaCosmeticsSheetInfo,
  type WorkbookScan
} from "@/lib/podruzhkaCosmeticsExcel";
import {
  cosmeticsRowSignature,
  expandCosmeticsAiResults
} from "@/lib/podruzhkaCosmeticsAi";
import { PODRUZHKA_COSMETICS_FIELD_LABELS } from "@/lib/podruzhkaCosmeticsColumnMapping";
import { mergeCsvImagesIntoWorkbook } from "@/lib/podruzhkaFeedCsvMerge";
import { resolveFeedFotoUrlAsync, type FeedFotoResolveMode } from "@/lib/podruzhkaFeedFoto";
import type { PodruzhkaColumnMapping } from "@/lib/podruzhkaColumnMapping";
import { PodruzhkaInfographicPreview, type InfographicPreviewItem } from "@/components/PodruzhkaInfographicPreview";
import {
  buildPodruzhkaErrorRows,
  buildPodruzhkaErrorsWorkbook,
  defaultCosmeticsErrorsDownloadName,
  type PodruzhkaErrorRow
} from "@/lib/podruzhkaErrorReport";
import { renderPodruzhkaCardClient } from "@/lib/podruzhkaClientRender";
import { resolveCosmeticsModelForRender } from "@/lib/podruzhkaCosmeticsModel";
import type { PodruzhkaAiResult, PodruzhkaFeedRow } from "@/lib/podruzhkaTypes";
import type ExcelJS from "exceljs";

const SK_OPENAI = "fp_podruzhka_cosmetics_openai_key";
const SK_OPENAI_REM = "fp_podruzhka_cosmetics_openai_remember";
const SK_FILE_FOTO = "fp_podruzhka_cosmetics_file_foto_only";
const BENEFITS_CHUNK = 5;
const BENEFITS_PARALLEL = 4;
import {
  PODRUZHKA_RENDER_FLUSH_EVERY,
  PODRUZHKA_RENDER_PARALLEL,
  runPodruzhkaRenderPool
} from "@/lib/podruzhkaRenderPool";

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

export function PodruzhkaCosmeticsOzonTool() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>(1);
  const [fileName, setFileName] = useState<string | null>(null);
  const [wb, setWb] = useState<ExcelJS.Workbook | null>(null);
  const [scan, setScan] = useState<WorkbookScan | null>(null);
  const [mapping, setMapping] = useState<PodruzhkaCosmeticsColumnMapping>({});
  const [mappingConfirmed, setMappingConfirmed] = useState(false);
  const [detection, setDetection] = useState<CosmeticsAutoDetectResult | null>(null);
  const [manualMapping, setManualMapping] = useState(false);
  const [sheetInfo, setSheetInfo] = useState<PodruzhkaCosmeticsSheetInfo | null>(null);
  const [textColumns, setTextColumns] = useState<{ key: string; header: string; col: number }[]>(
    []
  );
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openaiKey, setOpenaiKey] = useState("");
  const [rememberKey, setRememberKey] = useState(true);
  const [forceAiRegenerate, setForceAiRegenerate] = useState(false);
  const [feedCsvMergeStats, setFeedCsvMergeStats] = useState<{
    merged: number;
    notFound: number;
    variantRows?: number;
  } | null>(null);
  const [textsDone, setTextsDone] = useState(false);
  const [textsStats, setTextsStats] = useState<{
    ok: number;
    fail: number;
    written: number;
    typeMismatch?: number;
    feedSkipped?: number;
    uniqueAi?: number;
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
    batchesSaved?: number;
    errorRows?: PodruzhkaErrorRow[];
    flushErrors?: string[];
  } | null>(null);
  const [renderPreviews, setRenderPreviews] = useState<InfographicPreviewItem[]>([]);
  const [fileFotoOnly, setFileFotoOnly] = useState(false);

  useEffect(() => {
    if (typeof sessionStorage === "undefined") return;
    setFileFotoOnly(sessionStorage.getItem(SK_FILE_FOTO) === "1");
  }, []);

  const fotoResolveMode: FeedFotoResolveMode = fileFotoOnly ? "file" : "auto";

  const toggleFileFotoOnly = useCallback(() => {
    setFileFotoOnly((prev) => {
      const next = !prev;
      if (typeof sessionStorage !== "undefined") {
        sessionStorage.setItem(SK_FILE_FOTO, next ? "1" : "0");
      }
      return next;
    });
  }, []);

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

  const downloadErrorsReport = useCallback(
    async (rows: PodruzhkaErrorRow[]) => {
      if (!rows.length) return;
      try {
        const blob = await buildPodruzhkaErrorsWorkbook(rows);
        downloadBlob(blob, defaultCosmeticsErrorsDownloadName(fileName));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не удалось сохранить файл ошибок");
      }
    },
    [fileName, downloadBlob]
  );

  const downloadWorkbook = useCallback(
    async (suffix: "texts" | "infographic" | "foto3", part?: number) => {
      if (!wb || !scan) return;
      try {
        const ws = wb.getWorksheet(scan.sheetName);
        if (ws) ensureCosmeticsAiColumns(ws, scan.headerRow);
        const blob = await writeWorkbookToBlob(wb);
        downloadBlob(blob, defaultCosmeticsDownloadName(fileName, suffix, part));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не удалось сохранить Excel");
      }
    },
    [wb, scan, fileName, downloadBlob]
  );

  const syncSheetInfo = useCallback(
    (workbook: ExcelJS.Workbook, scanned: WorkbookScan, m: PodruzhkaCosmeticsColumnMapping) => {
      const info = buildCosmeticsSheetFromMapping(workbook, scanned, m);
      if (info) setSheetInfo(info);
      const ws = workbook.getWorksheet(scanned.sheetName);
      if (ws) setTextColumns(listCosmeticsTextColumnsOnSheet(ws, scanned.headerRow));
      return info;
    },
    []
  );

  const applyFeedCsv = useCallback(
    async (source: FeedCsvMergeSource) => {
      if (!wb || !scan) {
        setError("Сначала загрузите Excel");
        return;
      }
      setBusy(true);
      setError(null);
      setProgress("Скачиваем CSV и подтягиваем foto…");
      try {
        const res = await fetch("/api/podruzhka/feed-csv/index", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(source)
        });
        const data = (await res.json()) as {
          byArticle?: Record<string, string>;
          variantRows?: number;
          error?: string;
        };
        if (!res.ok || !data.byArticle) {
          throw new Error(data.error ?? `HTTP ${res.status}`);
        }

        const ws = wb.getWorksheet(scan.sheetName);
        if (!ws) throw new Error("Лист не найден");

        const byArticle = new Map(Object.entries(data.byArticle));
        const result = mergeCsvImagesIntoWorkbook(
          ws,
          scan,
          mapping as PodruzhkaColumnMapping,
          byArticle
        );
        setMapping(result.mapping as PodruzhkaCosmeticsColumnMapping);
        const fresh = refreshWorkbookScan(wb, scan) ?? scan;
        setScan(fresh);
        syncSheetInfo(wb, fresh, result.mapping as PodruzhkaCosmeticsColumnMapping);
        setFeedCsvMergeStats({
          merged: result.merged,
          notFound: result.notFound,
          variantRows: data.variantRows
        });
        setMappingConfirmed(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Ошибка CSV");
      } finally {
        setBusy(false);
        setProgress(null);
      }
    },
    [wb, scan, mapping, syncSheetInfo]
  );

  const confirmMapping = useCallback(() => {
    if (!wb || !scan) return;
    const err = cosmeticsMappingIsComplete(mapping);
    if (err) {
      setError(err);
      return;
    }
    const ws = wb.getWorksheet(scan.sheetName);
    if (!ws) {
      setError("Лист не найден");
      return;
    }
    ensureCosmeticsAiColumns(ws, scan.headerRow);
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

  const onMappingChange = useCallback(
    (field: PodruzhkaCosmeticsFieldKey, col: number | undefined) => {
      setMapping((m) => ({ ...m, [field]: col }));
    },
    []
  );

  const finishUpload = useCallback(
    (
      workbook: ExcelJS.Workbook,
      scanned: WorkbookScan,
      m: PodruzhkaCosmeticsColumnMapping,
      detected: CosmeticsAutoDetectResult
    ) => {
      const ws = workbook.getWorksheet(scanned.sheetName);
      if (!ws) {
        setError("Лист не найден");
        return false;
      }
      ensureCosmeticsAiColumns(ws, scanned.headerRow);
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
      const ready = countCosmeticsReadyRows(ws, info);
      setTextsDone(ready > 0);
      setError(null);
      return true;
    },
    [syncSheetInfo]
  );

  const onFile = useCallback(
    async (file: File) => {
      setBusy(true);
      setError(null);
      setTextsDone(false);
      setTextsStats(null);
      setInfographicDone(false);
      setRenderStats(null);
      setLayoutVersion(null);
      setRenderPreviews([]);
      setMappingConfirmed(false);
      setSheetInfo(null);
      setTextColumns([]);
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
        const detected = autoDetectCosmeticsMapping(scanned.headers);
        let finalMapping = detected.mapping;
        let ready = detected.isReady;

        if (!ready) {
          const guessed = guessCosmeticsColumnMapping(scanned.headers);
          const merged = { ...guessed, ...detected.mapping };
          if (!cosmeticsMappingIsComplete(merged)) {
            setManualMapping(true);
            setError(
              `Не найдены колонки: ${detected.missing
                .map((k) => PODRUZHKA_COSMETICS_FIELD_LABELS[k])
                .join(", ")}. Нужны: name, brand name, product_type, foto. Объём и product name не обязательны.`
            );
            setMapping(merged);
            return;
          }
          finalMapping = merged;
          ready = true;
        }

        setWb(workbook);
        setScan(scanned);
        setMapping(finalMapping);
        setFileName(file.name);

        if (!ready) {
          return;
        }

        finishUpload(workbook, scanned, finalMapping, {
          ...detected,
          mapping: finalMapping,
          isReady: true,
          missing: []
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Ошибка чтения Excel");
      } finally {
        setBusy(false);
        setProgress(null);
      }
    },
    [finishUpload]
  );

  const initTextColumns = useCallback(() => {
    if (!wb || !scan) return;
    const ws = wb.getWorksheet(scan.sheetName);
    if (!ws) return;
    ensureCosmeticsAiColumns(ws, scan.headerRow);
    const fresh = refreshWorkbookScan(wb, scan) ?? scan;
    setScan(fresh);
    setTextColumns(listCosmeticsTextColumnsOnSheet(ws, scan.headerRow));
    if (sheetInfo) {
      const ready = countCosmeticsReadyRows(ws, sheetInfo);
      setTextsDone(ready > 0);
    }
    setError(null);
  }, [wb, scan, sheetInfo]);

  const runBenefits = useCallback(async () => {
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
    setTextsStats(null);

    const ws = wb.getWorksheet(sheetInfo.sheetName);
    if (!ws) {
      setError("Лист не найден");
      setBusy(false);
      return;
    }

    ensureCosmeticsAiColumns(ws, scan.headerRow);

    const pending = sheetInfo.rows.filter((row) =>
      rowNeedsCosmeticsAiGeneration(ws, sheetInfo, row, forceAiRegenerate)
    );

    if (pending.length === 0) {
      const ready = countCosmeticsReadyRows(ws, sheetInfo);
      if (ready === 0) {
        setError(
          "Нет готовых строк. Запустите AI — он заполнит model и benefit 1–3 для инфографики."
        );
        setBusy(false);
        return;
      }
      setTextsStats({ ok: ready, fail: 0, written: 0, typeMismatch: 0 });
      setTextsDone(true);
      setStep(1);
      setBusy(false);
      return;
    }

    let ok = 0;
    let fail = 0;
    let writtenTotal = 0;
    let typeMismatchCount = 0;
    let feedSkipped = 0;

    const feedSkipResults: PodruzhkaAiResult[] = [];
    const toProcess = pending.filter((row) => {
      const reason = getFeedRowAiSkipReason(row);
      if (reason) {
        feedSkipResults.push(makeFeedRowAiErrorResult(row, reason));
        return false;
      }
      return true;
    });

    if (feedSkipResults.length > 0) {
      const { written, typeMismatch } = applyCosmeticsAiResults(ws, sheetInfo, feedSkipResults);
      writtenTotal += written;
      typeMismatchCount += typeMismatch;
      feedSkipped = feedSkipResults.length;
      for (const r of feedSkipResults) {
        if (r.ok) ok++;
        else fail++;
      }
    }

    const repRowToAllRows = new Map<number, number[]>();
    const uniqueToProcess: PodruzhkaFeedRow[] = [];
    for (const row of toProcess) {
      const sig = cosmeticsRowSignature(row);
      const existing = uniqueToProcess.find((u) => cosmeticsRowSignature(u) === sig);
      if (existing) {
        const list = repRowToAllRows.get(existing.row) ?? [existing.row];
        list.push(row.row);
        repRowToAllRows.set(existing.row, list);
      } else {
        uniqueToProcess.push(row);
        repRowToAllRows.set(row.row, [row.row]);
      }
    }

    const fetchBenefitsChunk = async (
      chunk: PodruzhkaFeedRow[]
    ): Promise<PodruzhkaAiResult[]> => {
      try {
        const res = await fetch("/api/podruzhka/cosmetics-benefits", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ openaiApiKey: key, rows: chunk })
        });
        const data = (await res.json()) as {
          results?: PodruzhkaAiResult[];
          error?: string;
        };
        if (!res.ok || !data.results?.length) {
          const msg = data.error ?? `HTTP ${res.status}`;
          return chunk.map((row) => makeFeedRowAiErrorResult(row, msg));
        }
        return data.results;
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Сбой сети";
        return chunk.map((row) => makeFeedRowAiErrorResult(row, msg));
      }
    };

    const applyChunkResults = (chunkResults: PodruzhkaAiResult[]) => {
      const expanded = expandCosmeticsAiResults(chunkResults, repRowToAllRows);
      const { written, typeMismatch } = applyCosmeticsAiResults(ws, sheetInfo, expanded);
      writtenTotal += written;
      typeMismatchCount += typeMismatch;
      for (const r of chunkResults) {
        if (r.ok) ok++;
        else fail++;
      }
    };

    try {
      if (uniqueToProcess.length > 0) {
        const chunks: PodruzhkaFeedRow[][] = [];
        for (let i = 0; i < uniqueToProcess.length; i += BENEFITS_CHUNK) {
          chunks.push(uniqueToProcess.slice(i, i + BENEFITS_CHUNK));
        }

        let processed = 0;
        const total = uniqueToProcess.length;
        for (let w = 0; w < chunks.length; w += BENEFITS_PARALLEL) {
          const wave = chunks.slice(w, w + BENEFITS_PARALLEL);
          setProgress(
            `AI: model и свойства — ${processed} / ${total} уник. SKU…` +
              (pending.length > total
                ? ` (строк в Excel: ${pending.length}, дублей: ${pending.length - total})`
                : "") +
              (feedSkipped > 0 ? ` · пропущено фид: ${feedSkipped}` : "")
          );

          const waveResults = await Promise.all(wave.map((chunk) => fetchBenefitsChunk(chunk)));
          for (const chunkResults of waveResults) {
            applyChunkResults(chunkResults);
            processed += chunkResults.length;
          }
        }
      }

      const readyAfter = countCosmeticsReadyRows(ws, sheetInfo);
      if (writtenTotal === 0 && readyAfter === 0) {
        setError(
          "AI не смог заполнить model и свойства. Проверьте ключ OpenAI и названия в Excel."
        );
        setBusy(false);
        return;
      }

      setTextsStats({
        ok: readyAfter,
        fail,
        written: writtenTotal,
        typeMismatch: typeMismatchCount,
        feedSkipped: feedSkipped > 0 ? feedSkipped : undefined,
        uniqueAi: uniqueToProcess.length
      });
      setTextsDone(true);
      setForceAiRegenerate(false);
      setStep(1);

      const fresh = refreshWorkbookScan(wb, scan) ?? scan;
      setScan(fresh);
      syncSheetInfo(wb, fresh, mapping);

      if (fail > 0 || feedSkipped > 0) {
        setError(
          `Обработка завершена. Ошибок: ${fail}${feedSkipped > 0 ? `, пропущено из‑за фида: ${feedSkipped}` : ""}. Комментарии — в «статус свойств». Скачайте Excel и дозапустите без «перезаписать все».`
        );
      }
    } catch (e) {
      const readyPartial = countCosmeticsReadyRows(ws, sheetInfo);
      if (writtenTotal > 0 || readyPartial > 0) {
        setTextsStats({
          ok: readyPartial,
          fail,
          written: writtenTotal,
          typeMismatch: typeMismatchCount,
          feedSkipped: feedSkipped > 0 ? feedSkipped : undefined,
          uniqueAi: uniqueToProcess.length
        });
        setTextsDone(true);
        setStep(1);
        setError(
          `${e instanceof Error ? e.message : "Ошибка шага 1"}. Уже записано строк: ${writtenTotal}. Комментарии — в «статус свойств».`
        );
      } else {
        setError(e instanceof Error ? e.message : "Ошибка шага 1");
      }
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }, [
    wb,
    scan,
    sheetInfo,
    mapping,
    openaiKey,
    rememberKey,
    syncSheetInfo,
    forceAiRegenerate
  ]);

  const runRender = useCallback(async () => {
    if (!wb || !sheetInfo || !scan) return;
    const wsCheck = wb.getWorksheet(sheetInfo.sheetName);
    if (!wsCheck) return;

    setBusy(true);
    setError(null);
    setInfographicDone(false);
    setRenderStats(null);
    setLayoutVersion(null);
    setRenderPreviews([]);

    const ws = wb.getWorksheet(sheetInfo.sheetName);
    if (!ws) {
      setError("Лист не найден");
      setBusy(false);
      return;
    }

    const urls = new Map<number, string>();
    const visionNote =
      "Рендер: cosmetics-v7. Параллельно ×" +
      `${PODRUZHKA_RENDER_PARALLEL}, Excel каждые ${PODRUZHKA_RENDER_FLUSH_EVERY} ссылок.`;
    const todo: typeof sheetInfo.rows = [];
    const skipped: { row: number; brand: string; reasons: string }[] = [];
    const noFotoRows: { row: number; brand: string; error: string }[] = [];
    const layoutWarnings: { row: number; brand: string; warning: string }[] = [];

    for (const row of sheetInfo.rows) {
      const el = getCosmeticsRowRenderEligibility(ws, sheetInfo, row, fotoResolveMode);
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
      const errorRows = buildPodruzhkaErrorRows(sheetInfo.rows, skipped, []);
      if (errorRows.length > 0) {
        await downloadErrorsReport(errorRows);
      }
      setRenderStats({
        ok: 0,
        fail: 0,
        noFoto: 0,
        sampleFotoError: null,
        visionNote,
        skipped,
        noFotoRows: [],
        layoutWarnings,
        errorRows
      });
      setInfographicDone(errorRows.length > 0);
      setError(
        errorRows.length > 0
          ? `Готовых строк: 0. Проблемные позиции (${errorRows.length}) — в файле «…-cosmetics-errors.xlsx».`
          : `Нет строк для картинок (0 из ${sheetInfo.rows.length}). Заполните model и benefit 1–3.`
      );
      setBusy(false);
      setProgress(null);
      return;
    }

    try {
      let foto2Col = sheetInfo.foto2Col;

      const poolResult = await runPodruzhkaRenderPool({
        items: todo,
        parallel: PODRUZHKA_RENDER_PARALLEL,
        flushEvery: PODRUZHKA_RENDER_FLUSH_EVERY,
        onProgress: (p) => {
          setProgress(
            `Инфографика: ${p.done} / ${p.total} (готово ${p.ok}` +
              (p.fail ? `, ошибок ${p.fail}` : "") +
              (p.batchesSaved
                ? ` · партий в Excel: ${p.batchesSaved} по ~${PODRUZHKA_RENDER_FLUSH_EVERY}`
                : "") +
              ")…"
          );
        },
        onFlush: async (batchUrls, batchIndex) => {
          for (const [row, url] of batchUrls) urls.set(row, url);
          const applied = applyCosmeticsFoto2Urls(ws, { ...sheetInfo, foto2Col }, batchUrls);
          foto2Col = applied.foto2Col;
          setSheetInfo((prev) => (prev ? { ...prev, foto2Col: applied.foto2Col } : prev));
          await downloadWorkbook("infographic", batchIndex);
        },
        renderOne: async (row) => {
          const ai = readCosmeticsTextsFromSheet(ws, sheetInfo, row);
          try {
            const fotoUrl =
              (await resolveFeedFotoUrlAsync(ws, row.row, mapping, "cosmetics", fotoResolveMode)) ||
              row.foto;
            const rendered = await renderPodruzhkaCardClient({
              brandName: row.brandName,
              productType: readCosmeticsProductTypeForCard(ws, sheetInfo, row, ai.model),
              model: resolveCosmeticsModelForRender({
                model: ai.model,
                productType: row.productType,
                brandName: row.brandName,
                name: row.name,
                productName: row.productName
              }),
              ml: "",
              fotoUrl,
              notes: ai.benefits,
              renderProfile: "cosmetics"
            });

            const form = new FormData();
            form.append("file", rendered.blob, `podruzhka-cosmetics-row-${row.row}.jpg`);
            const res = await fetch("/api/podruzhka/upload", { method: "POST", body: form });
            const data = (await res.json()) as {
              url?: string;
              error?: string;
              layoutVersion?: string;
            };
            if (!res.ok || !data.url) {
              return {
                row: row.row,
                ok: false,
                error: data.error ?? `HTTP ${res.status}`
              };
            }
            if (rendered.notesTruncated) {
              layoutWarnings.push({
                row: row.row,
                brand: row.brandName || row.name.slice(0, 30),
                warning: "Длинное описание benefit — сократите текст в Excel"
              });
            }
            return {
              row: row.row,
              ok: true,
              url: data.url,
              layoutVersion: data.layoutVersion ?? rendered.layoutVersion
            };
          } catch (e) {
            return {
              row: row.row,
              ok: false,
              error: e instanceof Error ? e.message : "ошибка рендера"
            };
          }
        }
      });

      for (const [row, url] of poolResult.allUrls) urls.set(row, url);
      if (poolResult.layoutVersion) setLayoutVersion(poolResult.layoutVersion);

      const previews: InfographicPreviewItem[] = todo
        .map((row) => {
          const url = urls.get(row.row);
          if (!url) return null;
          const ai = readCosmeticsTextsFromSheet(ws, sheetInfo, row);
          return {
            row: row.row,
            brand: row.brandName || "—",
            label: ai.model || row.name.slice(0, 40),
            url
          };
        })
        .filter((x): x is InfographicPreviewItem => x != null);
      setRenderPreviews(previews);

      const noFotoRows = poolResult.errors.map((e) => ({
        row: e.row,
        brand:
          todo.find((r) => r.row === e.row)?.brandName ||
          todo.find((r) => r.row === e.row)?.name.slice(0, 30) ||
          "?",
        error: e.error
      }));

      const errorRows = buildPodruzhkaErrorRows(sheetInfo.rows, skipped, noFotoRows);
      if (errorRows.length > 0) {
        await downloadErrorsReport(errorRows);
      }

      setRenderStats({
        ok: poolResult.ok,
        fail: poolResult.fail,
        noFoto: poolResult.fail,
        sampleFotoError: noFotoRows[0]?.error ?? null,
        visionNote,
        skipped,
        noFotoRows,
        layoutWarnings,
        batchesSaved: poolResult.batchesSaved,
        errorRows,
        flushErrors: poolResult.flushErrors.length ? poolResult.flushErrors : undefined
      });
      setInfographicDone(poolResult.ok > 0 || poolResult.batchesSaved > 0 || errorRows.length > 0);
      setTextsDone(true);

      if (errorRows.length > 0 && poolResult.ok > 0) {
        setError(
          `Готово: ${poolResult.ok}, ошибок: ${errorRows.length}. Проблемные позиции — в файле «…-cosmetics-errors.xlsx».`
        );
      } else if (poolResult.flushErrors.length > 0) {
        setError(
          `Часть партий Excel не сохранилась. Успешных карточек: ${poolResult.ok}. Скачайте Excel вручную.`
        );
      } else if (errorRows.length > 0 && poolResult.ok === 0) {
        setError(
          `Все попытки рендера завершились ошибкой (${errorRows.length}). Список — в «…-cosmetics-errors.xlsx».`
        );
      }
    } catch (e) {
      setError(
        `${e instanceof Error ? e.message : "Ошибка инфографики"}. Уже готовые карточки — в скачанных Excel-партиях.`
      );
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }, [wb, sheetInfo, scan, mapping, downloadWorkbook, downloadErrorsReport, fotoResolveMode]);

  const renderReady = useMemo(() => {
    if (!wb || !sheetInfo || !scan) return { ready: 0, total: 0 };
    const ws = wb.getWorksheet(sheetInfo.sheetName);
    if (!ws) return { ready: 0, total: sheetInfo.rows.length };
    return {
      ready: countCosmeticsReadyRows(ws, sheetInfo, fotoResolveMode),
      total: sheetInfo.rows.length
    };
  }, [wb, sheetInfo, scan, infographicDone, fileFotoOnly, fotoResolveMode]);

  const pipeline = useMemo(() => {
    if (!wb || !sheetInfo || !infographicDone) return null;
    return {
      workbook: wb,
      fileName: fileName ?? "feed.xlsx",
      getFoto2Info: () => {
        const ws = wb.getWorksheet(sheetInfo.sheetName);
        if (!ws) return null;
        return buildCosmeticsFoto2ColumnInfo(ws, sheetInfo);
      }
    };
  }, [wb, sheetInfo, fileName, infographicDone]);

  const headerOptions = scan?.headers ?? [];
  const step1Ready = Boolean(wb && mappingConfirmed && sheetInfo);
  const canOpenInfographicStep = step1Ready;

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
          <h2 className={homeCardTitle}>Порядок работы — косметика</h2>
        </div>
        <div className={`${homeCardBody} text-sm text-slate-600 space-y-2`}>
          <p>
            <strong>1.</strong> Вставьте ссылку на CSV 4Partners и загрузите Excel — колонки фида
            распознаются сами (name, brand name, foto…). Затем{" "}
            <strong>«Подтянуть foto из CSV»</strong> по артикулу.
          </p>
          <p>
            <strong>2.</strong> AI-категорийный менеджер заполняет <strong>model</strong> и три свойства{" "}
            <strong>benefit 1–3</strong> (сам выбирает важные характеристики по product_type).
          </p>
          <p>
            <strong>3.</strong> Инфографика 1024×1365 — те же правила фото, что у ароматов. Объём на
            карточке не показываем.
          </p>
          <p>
            <strong>4.</strong> Ссылки в <strong>foto 2</strong> → при необходимости{" "}
            <strong>Foto 3</strong>.
          </p>
          <div className="flex flex-wrap gap-2 pt-2">
            {stepBtn(1, "1. Свойства (AI)", Boolean(wb))}
            {stepBtn(2, "2. Инфографика", canOpenInfographicStep)}
            {stepBtn(3, "3. Foto 3", infographicDone)}
          </div>
        </div>
      </section>

      <section className={homeCard}>
        <div className={homeCardHeader}>
          <h2 className={homeCardTitle}>Excel + CSV 4Partners</h2>
        </div>
        <div className={`${homeCardBody} space-y-4`}>
          <PodruzhkaExcelExample variant="cosmetics" />
          <PodruzhkaFeedCsvField
            storageKeyPrefix="podruzhka_cosmetics"
            disabled={busy}
            busy={busy && Boolean(progress?.includes("CSV"))}
            mergeEnabled={Boolean(wb && mappingConfirmed)}
            mergeStats={feedCsvMergeStats}
            onMerge={applyFeedCsv}
          />
          <FourPartnersApiKeyField storageKeyPrefix="podruzhka_cosmetics" />
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
            {busy && !wb ? "Читаем…" : textsDone ? "Загрузить исправленный Excel" : "Загрузить Excel"}
          </button>
          {mappingConfirmed && sheetInfo ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 space-y-3">
              <p className="text-sm text-slate-700">
                <strong>{renderReady.ready}</strong> из <strong>{renderReady.total}</strong> строк
                готовы к инфографике (есть model, benefit 1–3 и foto
                {fileFotoOnly ? " в колонке foto" : ""}).
              </p>
              <label className="flex items-start gap-2 text-sm text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={fileFotoOnly}
                  onChange={toggleFileFotoOnly}
                />
                <span>
                  Только foto из Excel — без выбора из CSV / «Изображения варианта»
                </span>
              </label>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  className="rounded-lg border border-violet-700 bg-white px-4 py-2.5 text-sm font-semibold text-violet-900 hover:bg-violet-50"
                  disabled={busy}
                  onClick={() => setStep(1)}
                >
                  1. Тексты — model и benefit 1–3
                </button>
                <button
                  type="button"
                  className={homeBtnPrimary}
                  disabled={busy}
                  onClick={() => setStep(2)}
                >
                  2. Сразу генерировать инфографику
                </button>
              </div>
              {renderReady.ready === 0 ? (
                <p className="text-xs text-amber-900">
                  Пока 0 готовых строк — можно открыть шаг 2 и запустить: готовые позиции
                  обработаются, остальные попадут в файл ошибок.
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
            <PodruzhkaCosmeticsDetectedLayout detection={detection} rowCount={sheetInfo.rows.length} />
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
            <PodruzhkaCosmeticsColumnMappingUI
              mapping={mapping}
              headers={headerOptions}
              textColumns={textColumns}
              onChange={onMappingChange}
            />
            <button type="button" className={homeBtnPrimary} onClick={confirmMapping}>
              Применить и перейти к текстам
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
            <h2 className={homeCardTitle}>Шаг 1 — model и свойства (AI)</h2>
          </div>
          <div className={`${homeCardBody} space-y-4`}>
            <p className="text-sm text-slate-600">
              AI-категорийный менеджер по <strong>brand name</strong>, <strong>name</strong> и{" "}
              <strong>product_type</strong> заполняет <strong>model</strong> и три свойства в слотах
              нот: <strong>benefit 1–3</strong> (заголовок КАПС) + описание. Характеристики
              подбирает сам — для помады одно, для консилера другое.
            </p>
            <p className="text-xs text-slate-500">
              ~349 уникальных SKU в вашем файле → AI вызывается по уникальным name (дубликаты
              оттенков копируются). Скорость: до {BENEFITS_CHUNK * BENEFITS_PARALLEL} позиций
              параллельно.
            </p>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={forceAiRegenerate}
                onChange={(e) => setForceAiRegenerate(e.target.checked)}
              />
              Перезаписать model и свойства у всех строк (даже если уже были)
            </label>
            {textColumns.length > 0 ? (
              <p className="text-xs text-violet-800 bg-violet-50 rounded-lg px-3 py-2">
                Столбцы: {textColumns.map((c) => `${c.header} (${c.col})`).join(", ")}
              </p>
            ) : (
              <button
                type="button"
                className="rounded-lg border border-violet-700 bg-white px-4 py-2 text-sm font-semibold text-violet-900"
                disabled={busy}
                onClick={initTextColumns}
              >
                Создать столбцы model и benefit 1–3 в Excel
              </button>
            )}
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
            {!textsDone ? (
              <button
                type="button"
                className={homeBtnPrimary}
                disabled={busy}
                onClick={() => void runBenefits()}
              >
                {busy ? "Идёт AI…" : "Сгенерировать model и свойства (AI)"}
              </button>
            ) : textsStats && textsStats.fail > 0 ? (
              <button
                type="button"
                className="rounded-lg border border-violet-700 bg-white px-4 py-2 text-sm font-semibold text-violet-900"
                disabled={busy}
                onClick={() => void runBenefits()}
              >
                {busy ? "Идёт AI…" : `Дозаполнить оставшиеся (${textsStats.fail})`}
              </button>
            ) : null}

            {textsDone && textsStats ? (
              <StepDoneBanner title="Шаг 1 завершён — скачайте Excel">
                <p className="text-sm text-emerald-800">
                  Записано строк: {textsStats.written}. Готово к инфографике: {textsStats.ok}, без
                  данных: {textsStats.fail}.
                  {textsStats.uniqueAi != null ? (
                    <> Уникальных SKU обработано AI: {textsStats.uniqueAi}.</>
                  ) : null}
                  {textsStats.feedSkipped != null && textsStats.feedSkipped > 0 ? (
                    <> Пропущено из‑за фида: {textsStats.feedSkipped}.</>
                  ) : null}{" "}
                  Ошибки — в <strong>статус свойств</strong>.
                </p>
                <button
                  type="button"
                  className={homeBtnPrimary}
                  disabled={busy}
                  onClick={() => void downloadWorkbook("texts")}
                >
                  Скачать Excel (model, свойства)
                </button>
                <button
                  type="button"
                  className="w-full rounded-lg border border-emerald-700 bg-white px-4 py-2.5 text-sm font-semibold text-emerald-900"
                  onClick={() => setStep(2)}
                >
                  К инфографике →
                </button>
              </StepDoneBanner>
            ) : null}
          </div>
        </section>
      ) : null}

      {canOpenInfographicStep && step === 2 ? (
        <section className={homeCard}>
          <div className={homeCardHeader}>
            <h2 className={homeCardTitle}>Шаг 2 — инфографика</h2>
          </div>
          <div className={`${homeCardBody} space-y-4`}>
            <p className="text-sm text-slate-600">
              Готово к рендеру: <strong>{renderReady.ready}</strong> из{" "}
              <strong>{renderReady.total}</strong>. Ошибочные позиции не останавливают процесс —
              после завершения скачается файл <strong>…-cosmetics-errors.xlsx</strong>.
            </p>
            <label className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={fileFotoOnly}
                onChange={toggleFileFotoOnly}
              />
              <span>
                <strong>Только foto из Excel</strong> — не выбирать из CSV и не анализировать
                галерею. Берётся первая ссылка из колонки <strong>foto</strong> в файле.
              </span>
            </label>
            <p className="text-xs text-slate-500">
              Параллельно до <strong>{PODRUZHKA_RENDER_PARALLEL}</strong> карточек. Каждые{" "}
              <strong>{PODRUZHKA_RENDER_FLUSH_EVERY}</strong> ссылок — скачивается Excel с{" "}
              <strong>foto 2</strong> (part1, part2…). Последний part — полный накопленный результат.
            </p>
            <p className="text-xs text-slate-500">
              Тот же шаблон 1024×1365 и правила размещения фото, что у арomatов. Три блока benefit
              рисуются в слотах нот.
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
                  {renderStats.batchesSaved ? (
                    <>
                      {" "}
                      Партий Excel: <strong>{renderStats.batchesSaved}</strong>.
                    </>
                  ) : null}
                  {layoutVersion ? (
                    <>
                      {" "}
                      Макет: <code className="text-xs">{layoutVersion}</code> (актуально:{" "}
                      html-figma-cosmetics-v7).
                    </>
                  ) : null}
                </p>
                {renderStats.visionNote ? (
                  <p className="text-sm text-slate-700">{renderStats.visionNote}</p>
                ) : null}
                {renderStats.skipped.length > 0 ? (
                  <div className="text-sm text-amber-900">
                    <p>
                      Пропущено строк: {renderStats.skipped.length} (нет model/benefit или не
                      заполнено):
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
                {renderStats.layoutWarnings.length > 0 ? (
                  <div className="text-sm text-amber-900">
                    <p>Предупреждения вёрстки ({renderStats.layoutWarnings.length}):</p>
                    <ul className="mt-1 list-inside list-disc">
                      {renderStats.layoutWarnings.map((s) => (
                        <li key={s.row}>
                          строка {s.row} — {s.brand}: {s.warning}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {renderPreviews.length > 0 ? (
                  <PodruzhkaInfographicPreview items={renderPreviews} />
                ) : null}
                {renderStats.errorRows && renderStats.errorRows.length > 0 ? (
                  <button
                    type="button"
                    className="rounded-lg border border-amber-700 bg-white px-4 py-2 text-sm font-semibold text-amber-950"
                    disabled={busy}
                    onClick={() => void downloadErrorsReport(renderStats.errorRows!)}
                  >
                    Скачать файл ошибок ({renderStats.errorRows.length})
                  </button>
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

      {canOpenInfographicStep && step === 3 && infographicDone && (
        <OzonImageConverter embedded pipeline={pipeline} />
      )}
    </div>
  );
}
