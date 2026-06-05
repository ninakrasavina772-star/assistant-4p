"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  homeBtnPrimary,
  homeCard,
  homeCardBody,
  homeCardHeader,
  homeCardTitle
} from "@/components/homeTheme";
import { OzonImageConverter } from "@/components/OzonImageConverter";
import { PodruzhkaCosmeticsColumnMappingUI } from "@/components/PodruzhkaCosmeticsColumnMappingUI";
import { PodruzhkaCosmeticsDetectedLayout } from "@/components/PodruzhkaCosmeticsDetectedLayout";
import {
  applyCosmeticsFoto2Urls,
  autoDetectCosmeticsMapping,
  buildCosmeticsFoto2ColumnInfo,
  buildCosmeticsSheetFromMapping,
  countCosmeticsReadyRows,
  cosmeticsMappingIsComplete,
  defaultCosmeticsDownloadName,
  ensureCosmeticsAiColumns,
  getCosmeticsRowRenderEligibility,
  listCosmeticsTextColumnsOnSheet,
  readCosmeticsProductTypeForCard,
  readCosmeticsTextsFromSheet,
  readWorkbookFromFile,
  refreshWorkbookScan,
  scanWorkbookHeaders,
  writeWorkbookToBlob,
  type CosmeticsAutoDetectResult,
  type PodruzhkaCosmeticsColumnMapping,
  type PodruzhkaCosmeticsFieldKey,
  type PodruzhkaCosmeticsSheetInfo,
  type WorkbookScan
} from "@/lib/podruzhkaCosmeticsExcel";
import { PODRUZHKA_COSMETICS_FIELD_LABELS } from "@/lib/podruzhkaCosmeticsColumnMapping";
import { renderPodruzhkaCardClient } from "@/lib/podruzhkaClientRender";
import type ExcelJS from "exceljs";

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
  const [textsDone, setTextsDone] = useState(false);
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

  const downloadBlob = useCallback((blob: Blob, name: string) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  }, []);

  const downloadWorkbook = useCallback(
    async (suffix: "texts" | "infographic" | "foto3") => {
      if (!wb || !scan) return;
      try {
        const ws = wb.getWorksheet(scan.sheetName);
        if (ws) ensureCosmeticsAiColumns(ws, scan.headerRow);
        const blob = await writeWorkbookToBlob(wb);
        downloadBlob(blob, defaultCosmeticsDownloadName(fileName, suffix));
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
      setInfographicDone(false);
      setRenderStats(null);
      setLayoutVersion(null);
      setPreviewUrl(null);
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
        setWb(workbook);
        setScan(scanned);
        setMapping(detected.mapping);
        setFileName(file.name);

        if (!detected.isReady) {
          setManualMapping(true);
          setError(
            `Файл не похож на образец. Не найдены колонки: ${detected.missing
              .map((k) => PODRUZHKA_COSMETICS_FIELD_LABELS[k])
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

  const runRender = useCallback(async () => {
    if (!wb || !sheetInfo || !scan) return;
    const wsCheck = wb.getWorksheet(sheetInfo.sheetName);
    if (!wsCheck || countCosmeticsReadyRows(wsCheck, sheetInfo) === 0) return;

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
    const visionNote = "Рендер: Canvas 2D + wide-set gap merge, html-figma-v12 (косметика).";
    const todo: typeof sheetInfo.rows = [];
    const skipped: { row: number; brand: string; reasons: string }[] = [];
    const noFotoRows: { row: number; brand: string; error: string }[] = [];
    const layoutWarnings: { row: number; brand: string; warning: string }[] = [];

    for (const row of sheetInfo.rows) {
      const el = getCosmeticsRowRenderEligibility(ws, sheetInfo, row);
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
        `Нет строк для картинок (0 из ${sheetInfo.rows.length}). Заполните model и benefit 1–3 в Excel.`
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
            const ai = readCosmeticsTextsFromSheet(ws, sheetInfo, row);
            try {
              const rendered = await renderPodruzhkaCardClient({
                brandName: row.brandName,
                productType: readCosmeticsProductTypeForCard(ws, sheetInfo, row, ai.model),
                model: ai.model,
                ml: row.ml,
                fotoUrl: row.foto,
                notes: ai.benefits
              });

              const form = new FormData();
              form.append("file", rendered.blob, `podruzhka-cosmetics-row-${row.row}.jpg`);
              const res = await fetch("/api/podruzhka/upload", {
                method: "POST",
                body: form
              });
              const data = (await res.json()) as {
                url?: string;
                error?: string;
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

      const { foto2Col } = applyCosmeticsFoto2Urls(ws, sheetInfo, urls);
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
      setTextsDone(true);
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
      ready: countCosmeticsReadyRows(ws, sheetInfo),
      total: sheetInfo.rows.length
    };
  }, [wb, sheetInfo, scan, infographicDone]);

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
          <h2 className={homeCardTitle}>Порядок работы — косметика</h2>
        </div>
        <div className={`${homeCardBody} text-sm text-slate-600 space-y-2`}>
          <p>
            <strong>1.</strong> Загрузить Excel — колонки фида распознаются сами (name, brand name,
            foto…).
          </p>
          <p>
            <strong>2.</strong> Заполнить <strong>model</strong> и три блока свойств:{" "}
            <strong>benefit 1–3</strong> (заголовок КАПС) + описание в{" "}
            <strong>benefit 1 (2)</strong>, <strong>benefit 2 (1)</strong>,{" "}
            <strong>benefit 3 (1)</strong>. AI для свойств — позже, пока вручную или из вашего
            источника.
          </p>
          <p>
            <strong>3.</strong> Инфографика 1024×1365 — те же правила вёрстки и фото, что у
            ароматов → ссылки в <strong>foto 2</strong>.
          </p>
          <p>
            <strong>4.</strong> При необходимости — публичные https в <strong>foto 3</strong>.
          </p>
          <div className="flex flex-wrap gap-2 pt-2">
            {stepBtn(1, "1. Тексты карточки", Boolean(wb))}
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
            {busy && !wb ? "Читаем…" : textsDone ? "Загрузить исправленный Excel" : "Загрузить Excel"}
          </button>
          {mappingConfirmed && sheetInfo ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 space-y-3">
              <p className="text-sm text-slate-700">
                <strong>{renderReady.ready}</strong> из <strong>{renderReady.total}</strong> строк
                готовы к инфографике (есть model, benefit 1–3 и foto).
              </p>
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
                  disabled={busy || renderReady.ready === 0}
                  title={
                    renderReady.ready === 0
                      ? "Сначала заполните model и benefit 1–3 в Excel"
                      : undefined
                  }
                  onClick={() => setStep(2)}
                >
                  2. Сразу генерировать инфографику
                </button>
              </div>
              {renderReady.ready === 0 ? (
                <p className="text-xs text-amber-900">
                  Нет готовых строк — заполните model, benefit 1–3 и описания в Excel.
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
            <h2 className={homeCardTitle}>Шаг 1 — model и свойства (benefit 1–3)</h2>
          </div>
          <div className={`${homeCardBody} space-y-4`}>
            <p className="text-sm text-slate-600">
              На карточке три блока вместо нот аромата: <strong>benefit 1–3</strong> — заголовок
              (КАПС, коротко), <strong>benefit 1 (2)</strong>, <strong>benefit 2 (1)</strong>,{" "}
              <strong>benefit 3 (1)</strong> — описание (1–2 строки). <strong>model</strong> — линейка
              или название серии. <strong>product_type</strong> в фиде не меняется.
            </p>
            {textColumns.length > 0 ? (
              <p className="text-xs text-violet-800 bg-violet-50 rounded-lg px-3 py-2">
                Столбцы текстов: {textColumns.map((c) => `${c.header} (${c.col})`).join(", ")}
              </p>
            ) : null}
            <button
              type="button"
              className="rounded-lg border border-violet-700 bg-white px-4 py-2 text-sm font-semibold text-violet-900"
              disabled={busy}
              onClick={initTextColumns}
            >
              Создать столбцы model и benefit 1–3 в Excel
            </button>
            <button
              type="button"
              className={homeBtnPrimary}
              disabled={busy}
              onClick={() => void downloadWorkbook("texts")}
            >
              Скачать Excel для заполнения текстов
            </button>
            {renderReady.ready > 0 ? (
              <StepDoneBanner title="Тексты готовы — можно к инфографике">
                <p className="text-sm text-emerald-800">
                  Готово строк: {renderReady.ready} из {renderReady.total}. Скачайте Excel, проверьте
                  benefit 1–3 и перейдите к шагу 2.
                </p>
                <button
                  type="button"
                  className="w-full rounded-lg border border-emerald-700 bg-white px-4 py-2.5 text-sm font-semibold text-emerald-900"
                  onClick={() => setStep(2)}
                >
                  К инфографике →
                </button>
              </StepDoneBanner>
            ) : (
              <p className="text-xs text-amber-900">
                Заполните model и benefit 1–3 в Excel, загрузите файл снова — или скачайте шаблон
                со столбцами и заполните offline.
              </p>
            )}
          </div>
        </section>
      ) : null}

      {canRenderInfographic && step === 2 ? (
        <section className={homeCard}>
          <div className={homeCardHeader}>
            <h2 className={homeCardTitle}>Шаг 2 — инфографика</h2>
          </div>
          <div className={`${homeCardBody} space-y-4`}>
            <p className="text-xs text-slate-500">
              Тот же шаблон 1024×1365 и правила размещения фото, что у ароматов. Три блока benefit
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
                  {layoutVersion ? (
                    <>
                      {" "}
                      Макет: <code className="text-xs">{layoutVersion}</code> (актуально:{" "}
                      html-figma-v12).
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
