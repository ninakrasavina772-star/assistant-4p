"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type ExcelJS from "exceljs";
import { readWorkbookFromFile, writeWorkbookToBlob } from "@/lib/ozonImageExcel";
import { applyFillResults } from "@/lib/templateGenerator/apply";
import type { FillRowInput, FillRowResult } from "@/lib/templateGenerator/types";
import {
  buildCsvIndex,
  lookupCsvRow,
  mergeCsvMapHeuristic,
  parseCsvText,
  type CsvTable
} from "@/lib/templateGenerator/csvIndex";
import { OZON_DATA_SHEET, DEFAULT_PHOTO_REVIEW_COLUMN } from "@/lib/templateGenerator/presets";
import { collectRowContexts, scanTemplateWorkbook } from "@/lib/templateGenerator/scan";
import type { ColumnSelection, CsvColumnMap, DropdownSource, TemplateSheetScan } from "@/lib/templateGenerator/types";
import {
  homeBtnPrimary,
  homeCard,
  homeCardBody,
  homeCardHeader,
  homeCardTitle,
  homeInput
} from "@/components/homeTheme";

const SK_OPENAI = "fp_template_gen_openai_key";
const SK_OPENAI_REM = "fp_template_gen_openai_remember";
const FILL_CHUNK = 2;
const FILL_PARALLEL = 3;

function resolveDropdownValues(
  c: TemplateSheetScan["columns"][number],
  source: DropdownSource
): string[] {
  if (source === "template_validation") return c.templateValidationValues;
  return c.dropdownValues;
}

function defaultDropdownSource(c: TemplateSheetScan["columns"][number]): DropdownSource {
  if (c.dropdownValues.length > 0) return "list_sheet";
  if (c.templateValidationValues.length > 0) return "template_validation";
  return "list_sheet";
}

type Step = 1 | 2 | 3;

function downloadBlob(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function TemplateGeneratorTool() {
  const tplRef = useRef<HTMLInputElement>(null);
  const csvRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>(1);
  const [wb, setWb] = useState<ExcelJS.Workbook | null>(null);
  const [fileName, setFileName] = useState("");
  const [sheetName, setSheetName] = useState("");
  const [scan, setScan] = useState<TemplateSheetScan | null>(null);
  const [csvTable, setCsvTable] = useState<CsvTable | null>(null);
  const [csvMap, setCsvMap] = useState<CsvColumnMap | null>(null);
  const [csvMapLabel, setCsvMapLabel] = useState("");
  const [csvUrl, setCsvUrl] = useState("");
  const [csvLoading, setCsvLoading] = useState(false);

  const [openaiKey, setOpenaiKey] = useState("");
  const [rememberKey, setRememberKey] = useState(true);
  const [userPrompt, setUserPrompt] = useState(
    "Заполняй только контентные характеристики. Описание — продающее, факты проверяй по официальному сайту бренда."
  );

  const [enabledCols, setEnabledCols] = useState<Record<string, boolean>>({});
  const [strictDropdown, setStrictDropdown] = useState<Record<string, boolean>>({});
  const [dropdownSource, setDropdownSource] = useState<Record<string, DropdownSource>>({});

  const [photoEnabled, setPhotoEnabled] = useState(true);
  const [photoMin, setPhotoMin] = useState(7);
  const [photoTarget, setPhotoTarget] = useState(8);

  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<FillRowResult[]>([]);
  const [done, setDone] = useState(false);

  const step2Ref = useRef<HTMLElement>(null);

  useEffect(() => {
    if (sessionStorage.getItem(SK_OPENAI_REM) !== "0") {
      const k = sessionStorage.getItem(SK_OPENAI);
      if (k) setOpenaiKey(k);
    }
  }, []);

  const initColumns = useCallback((s: TemplateSheetScan) => {
    const en: Record<string, boolean> = {};
    const st: Record<string, boolean> = {};
    const ds: Record<string, DropdownSource> = {};
    for (const c of s.columns) {
      if (c.readonly) continue;
      en[c.header] = c.contentDefault;
      const listVals = resolveDropdownValues(c, "list_sheet");
      const tplVals = resolveDropdownValues(c, "template_validation");
      const hasList = listVals.length > 0;
      const hasTpl = tplVals.length > 0;
      st[c.header] = hasList || hasTpl;
      ds[c.header] = defaultDropdownSource(c);
    }
    setEnabledCols(en);
    setStrictDropdown(st);
    setDropdownSource(ds);
  }, []);

  const applyCsvTable = useCallback(
    async (table: CsvTable, label: string) => {
      setCsvTable(table);
      const heuristic = scan
        ? mergeCsvMapHeuristic(table, scan.columns.map((c) => c.header))
        : { skuColumn: "", columns: {} };
      let map = heuristic;
      if (scan && openaiKey.trim()) {
        const res = await fetch("/api/template-generator/map-csv", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            openaiApiKey: openaiKey.trim(),
            csvHeaders: table.headers,
            templateHeaders: scan.columns.map((c) => c.header),
            sampleRows: table.rows.slice(0, 5)
          })
        });
        const j = (await res.json()) as { map?: CsvColumnMap };
        if (j.map) map = j.map;
      }
      setCsvMap(map);
      setCsvMapLabel(
        `${label} · ${table.rows.length} строк · SKU: ${map.skuColumn || "?"}`
      );
    },
    [openaiKey, scan]
  );

  useEffect(() => {
    if (!csvTable || !scan) return;
    const label = csvMapLabel.split(" · ")[0] || "CSV";
    void applyCsvTable(csvTable, label);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- remap when template/sheet appears
  }, [scan?.sheetName]);

  const onCsvFile = useCallback(
    async (file: File) => {
      setError("");
      setCsvLoading(true);
      try {
        const text = await file.text();
        const table = parseCsvText(text);
        if (!table.headers.length) {
          setError("CSV пустой или не распознан");
          return;
        }
        await applyCsvTable(table, file.name);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Ошибка чтения CSV");
      } finally {
        setCsvLoading(false);
      }
    },
    [applyCsvTable]
  );

  const onCsvUrlLoad = useCallback(async () => {
    const url = csvUrl.trim();
    if (!url) {
      setError("Вставьте ссылку на CSV");
      return;
    }
    setError("");
    setCsvLoading(true);
    try {
      const res = await fetch("/api/template-generator/fetch-csv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url })
      });
      const j = (await res.json()) as { text?: string; label?: string; error?: string };
      if (!res.ok) {
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      const table = parseCsvText(j.text ?? "");
      if (!table.headers.length) {
        throw new Error("CSV пустой или не распознан");
      }
      await applyCsvTable(table, j.label ?? url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки CSV по ссылке");
    } finally {
      setCsvLoading(false);
    }
  }, [csvUrl, applyCsvTable]);

  const onTemplateFile = useCallback(
    async (file: File) => {
      setError("");
      setDone(false);
      setPreview([]);
      const workbook = await readWorkbookFromFile(file);
      const scanned = scanTemplateWorkbook(workbook);
      const names = Object.keys(scanned.scans);
      const preferred =
        scanned.scans[OZON_DATA_SHEET] ? OZON_DATA_SHEET : names.sort(
          (a, b) => (scanned.scans[b]?.dataRowCount ?? 0) - (scanned.scans[a]?.dataRowCount ?? 0)
        )[0];

      if (!preferred) {
        setError("Не удалось разобрать листы шаблона");
        return;
      }

      setWb(workbook);
      setFileName(file.name);
      setSheetName(preferred);
      setScan(scanned.scans[preferred]!);
      initColumns(scanned.scans[preferred]!);
      setStep(2);
      requestAnimationFrame(() => {
        step2Ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    },
    [initColumns]
  );

  const onSheetChange = useCallback(
    (name: string) => {
      if (!wb) return;
      const scanned = scanTemplateWorkbook(wb);
      const s = scanned.scans[name];
      if (!s) return;
      setSheetName(name);
      setScan(s);
      initColumns(s);
    },
    [wb, initColumns]
  );

  const selectionList = useMemo((): ColumnSelection[] => {
    if (!scan) return [];
    return scan.columns
      .filter((c) => !c.readonly && enabledCols[c.header])
      .map((c) => ({
        header: c.header,
        col: c.col,
        mode: strictDropdown[c.header] ? "dropdown_strict" : "ai",
        dropdownSource: dropdownSource[c.header] ?? defaultDropdownSource(c)
      }));
  }, [scan, enabledCols, strictDropdown, dropdownSource]);

  const runFill = useCallback(async () => {
    if (!wb || !scan) return;
    const key = openaiKey.trim();
    if (!key) {
      setError("Введите OpenAI API key");
      return;
    }
    if (selectionList.length === 0) {
      setError("Выберите хотя бы один столбец");
      return;
    }

    if (rememberKey) {
      sessionStorage.setItem(SK_OPENAI, key);
      sessionStorage.setItem(SK_OPENAI_REM, "1");
    }

    setBusy(true);
    setError("");
    setDone(false);
    setPreview([]);

    const ws = wb.getWorksheet(scan.sheetName)!;
    const contexts = collectRowContexts(ws, scan);
    const csvMapResolved =
      csvMap ??
      (csvTable
        ? mergeCsvMapHeuristic(csvTable, scan.columns.map((c) => c.header))
        : { skuColumn: "", columns: {} });
    const csvIndex = csvTable ? buildCsvIndex(csvTable, csvMapResolved) : new Map();

    const imageHeader =
      scan.columns.find((c) => c.header.toLowerCase().includes("ссылка на изображение"))?.header ??
      null;

    const allResults: FillRowResult[] = [];
    const chunks: FillRowInput[][] = [];
    for (let i = 0; i < contexts.length; i += FILL_CHUNK) {
      chunks.push(
        contexts.slice(i, i + FILL_CHUNK).map((ctx) => ({
          row: ctx.row,
          sku: ctx.sku,
          productName: ctx.cells["Название товара *"] ?? ctx.cells["Название товара"] ?? "",
          brand: ctx.cells["Бренд *"] ?? ctx.cells["Бренд"] ?? "",
          cells: ctx.cells,
          csvData: lookupCsvRow(csvIndex, ctx.sku, csvMapResolved)
        }))
      );
    }

    const columnMeta = scan.columns.map((c) => {
      const source = dropdownSource[c.header] ?? defaultDropdownSource(c);
      return {
        header: c.header,
        hint: c.hint,
        dropdownValues: resolveDropdownValues(c, source),
        mode: (strictDropdown[c.header] ? "dropdown_strict" : "ai") as "ai" | "dropdown_strict"
      };
    });

    let doneRows = 0;
    for (let i = 0; i < chunks.length; i += FILL_PARALLEL) {
      const wave = chunks.slice(i, i + FILL_PARALLEL);
      setProgress(`AI: ${doneRows} / ${contexts.length}…`);
      const waveResults = await Promise.all(
        wave.map(async (rows) => {
          const res = await fetch("/api/template-generator/fill", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              openaiApiKey: key,
              userPrompt,
              columns: selectionList,
              columnMeta,
              rows,
              photoSettings: {
                enabled: photoEnabled,
                minCount: photoMin,
                targetCount: photoTarget,
                imageHeader
              }
            })
          });
          if (!res.ok) {
            const j = (await res.json()) as { error?: string };
            throw new Error(j.error ?? `HTTP ${res.status}`);
          }
          const j = (await res.json()) as { results: FillRowResult[] };
          return j.results;
        })
      );
      for (const batch of waveResults) {
        allResults.push(...batch);
        doneRows += batch.length;
      }
      applyFillResults(ws, scan, selectionList, allResults, DEFAULT_PHOTO_REVIEW_COLUMN);
      setPreview([...allResults]);
    }

    setProgress(`Готово: ${allResults.filter((r) => r.ok).length} / ${allResults.length}`);
    setDone(true);
    setBusy(false);
    setStep(3);
  }, [
    wb,
    scan,
    openaiKey,
    rememberKey,
    selectionList,
    userPrompt,
    csvTable,
    csvMap,
    photoEnabled,
    photoMin,
    photoTarget,
    strictDropdown,
    dropdownSource
  ]);

  const download = useCallback(async () => {
    if (!wb) return;
    const blob = await writeWorkbookToBlob(wb);
    const base = fileName.replace(/\.xlsx?$/i, "") || "template";
    downloadBlob(blob, `${base}-filled.xlsx`);
  }, [wb, fileName]);

  const sheetNames = wb ? wb.worksheets.map((w) => w.name) : [];

  const enabledColCount = useMemo(
    () => Object.values(enabledCols).filter(Boolean).length,
    [enabledCols]
  );

  const scrollToStep = (n: Step) => {
    setStep(n);
    if (n === 2) {
      requestAnimationFrame(() => {
        step2Ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  };

  const stepBtn = (n: Step, label: string, enabled: boolean) => (
    <button
      type="button"
      disabled={!enabled}
      onClick={() => enabled && scrollToStep(n)}
      className="rounded-lg px-3 py-1.5 text-sm font-semibold disabled:opacity-40"
      style={{
        background: step === n ? "#ffd740" : "#e5e7eb",
        color: "#111"
      }}
    >
      {n}. {label}
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {stepBtn(1, "Шаблон", Boolean(wb))}
        {stepBtn(2, "Столбцы и запуск", Boolean(wb && scan))}
        {stepBtn(3, "Результат", done)}
      </div>

      {error ? (
        <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
          {error}
        </div>
      ) : null}

      {!wb ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <strong>Шаг 1:</strong> загрузите шаблон Excel — после этого ниже появятся выбор вкладки,
          столбцов для генерации и кнопка «Запустить AI».
        </p>
      ) : null}

      <section className={homeCard}>
        <div className={homeCardHeader}>
          <h2 className={homeCardTitle}>1. Шаблон и данные</h2>
        </div>
        <div className={`${homeCardBody} space-y-4`}>
            <input
              ref={tplRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onTemplateFile(f);
                e.target.value = "";
              }}
            />
            <button type="button" className={homeBtnPrimary} onClick={() => tplRef.current?.click()}>
              Загрузить шаблон Excel (.xlsx)
            </button>
            {fileName ? <p className="text-sm text-slate-600">Файл: {fileName}</p> : null}

            {scan ? (
              <label className="block text-sm">
                Вкладка для заполнения
                <select
                  className={`${homeInput} mt-1 w-full max-w-md`}
                  value={sheetName}
                  onChange={(e) => onSheetChange(e.target.value)}
                >
                  {sheetNames.map((n) => (
                    <option key={n} value={n}>
                      {n}
                      {n === sheetName && scan ? ` (${scan.dataRowCount} строк)` : ""}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            {scan ? (
              <p className="text-sm text-slate-700">
                Строк товаров: <strong>{scan.dataRowCount}</strong> · столбцов: {scan.columns.length}
                {scan.listSheetAvailable ? " · списки значений найдены" : ""}
              </p>
            ) : null}

            <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-sm font-semibold text-slate-800">CSV-фид (опционально)</p>
              <p className="text-xs text-slate-600">
                Матчинг по артикулу вариации — «Артикул товара (SKU)». Можно файлом или ссылкой.
              </p>
              <input
                ref={csvRef}
                type="file"
                accept=".csv,.txt"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onCsvFile(f);
                  e.target.value = "";
                }}
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold"
                  disabled={csvLoading}
                  onClick={() => csvRef.current?.click()}
                >
                  Загрузить файл
                </button>
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <label className="block min-w-0 flex-1 text-sm">
                  Ссылка на CSV
                  <input
                    type="url"
                    className={`${homeInput} mt-1 w-full`}
                    placeholder="https://yandex.market.4partners.io/my/feed/....csv"
                    value={csvUrl}
                    onChange={(e) => setCsvUrl(e.target.value)}
                  />
                </label>
                <button
                  type="button"
                  className={homeBtnPrimary}
                  disabled={csvLoading || !csvUrl.trim()}
                  onClick={() => void onCsvUrlLoad()}
                >
                  {csvLoading ? "Загрузка…" : "Загрузить по ссылке"}
                </button>
              </div>
              {csvMapLabel ? (
                <p className="text-sm text-green-800">✓ CSV: {csvMapLabel}</p>
              ) : null}
              {!scan && csvTable ? (
                <p className="text-xs text-amber-800">
                  CSV загружен. Загрузите шаблон Excel — сопоставим колонки автоматически.
                </p>
              ) : null}
            </div>

            <label className="block text-sm">
              OpenAI API key
              <input
                type="password"
                className={`${homeInput} mt-1 w-full max-w-lg`}
                value={openaiKey}
                onChange={(e) => setOpenaiKey(e.target.value)}
                autoComplete="off"
              />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={rememberKey}
                onChange={(e) => setRememberKey(e.target.checked)}
              />
              Запомнить ключ в браузере
            </label>

            <label className="block text-sm">
              Задание для AI (ожидания по столбцам)
              <textarea
                className={`${homeInput} mt-1 min-h-[100px] w-full`}
                value={userPrompt}
                onChange={(e) => setUserPrompt(e.target.value)}
              />
            </label>

            {scan ? (
              <button type="button" className={homeBtnPrimary} onClick={() => scrollToStep(2)}>
                Далее → выбор столбцов и запуск ({enabledColCount} отмечено)
              </button>
            ) : null}
          </div>
        </section>

      {scan ? (
        <section ref={step2Ref} className={homeCard}>
          <div className={homeCardHeader}>
            <h2 className={homeCardTitle}>2. Столбцы, вкладка и запуск</h2>
          </div>
          <div className={`${homeCardBody} space-y-4`}>
            <p className="text-sm text-slate-700">
              Вкладка: <strong>{sheetName}</strong> · отмечено для генерации:{" "}
              <strong>{enabledColCount}</strong> столбцов. Снимите галочки с полей, которые не
              нужно менять.
            </p>
            <div className="max-h-80 overflow-auto rounded border border-slate-200">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-slate-100">
                  <tr>
                    <th className="p-2">Заполнять</th>
                    <th className="p-2">Столбец</th>
                    <th className="p-2">Строго из списка</th>
                    <th className="p-2">Источник списка</th>
                  </tr>
                </thead>
                <tbody>
                  {scan.columns
                    .filter((c) => !c.readonly)
                    .map((c) => {
                      const listN = c.dropdownValues.length;
                      const tplN = c.templateValidationValues.length;
                      const canPick = listN > 0 && tplN > 0;
                      const source = dropdownSource[c.header] ?? defaultDropdownSource(c);
                      return (
                      <tr key={c.header} className="border-t border-slate-100">
                        <td className="p-2">
                          <input
                            type="checkbox"
                            checked={Boolean(enabledCols[c.header])}
                            onChange={(e) =>
                              setEnabledCols((prev) => ({ ...prev, [c.header]: e.target.checked }))
                            }
                          />
                        </td>
                        <td className="p-2 font-medium">{c.header}</td>
                        <td className="p-2">
                          {listN > 0 || tplN > 0 ? (
                            <input
                              type="checkbox"
                              checked={Boolean(strictDropdown[c.header])}
                              onChange={(e) =>
                                setStrictDropdown((prev) => ({
                                  ...prev,
                                  [c.header]: e.target.checked
                                }))
                              }
                            />
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="p-2">
                          {canPick ? (
                            <select
                              className="max-w-[11rem] rounded border border-slate-300 text-xs"
                              value={source}
                              onChange={(e) =>
                                setDropdownSource((prev) => ({
                                  ...prev,
                                  [c.header]: e.target.value as DropdownSource
                                }))
                              }
                            >
                              <option value="list_sheet">Список значений ({listN})</option>
                              <option value="template_validation">Ячейки шаблона ({tplN})</option>
                            </select>
                          ) : (
                            <span className="text-xs text-slate-500">
                              {listN > 0
                                ? `Список значений (${listN})`
                                : tplN > 0
                                  ? `Шаблон (${tplN})`
                                  : "—"}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                    })}
                </tbody>
              </table>
            </div>

            <fieldset className="rounded-lg border border-slate-200 p-3 text-sm">
              <legend className="px-1 font-semibold">Доп. фото</legend>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={photoEnabled}
                  onChange={(e) => setPhotoEnabled(e.target.checked)}
                />
                Искать доп. фото, если мало
              </label>
              <div className="mt-2 flex flex-wrap gap-4">
                <label>
                  Минимум фото
                  <input
                    type="number"
                    min={1}
                    max={10}
                    className={`${homeInput} ml-2 w-16`}
                    value={photoMin}
                    onChange={(e) => setPhotoMin(Number(e.target.value))}
                  />
                </label>
                <label>
                  Цель (шт.)
                  <input
                    type="number"
                    min={3}
                    max={15}
                    className={`${homeInput} ml-2 w-16`}
                    value={photoTarget}
                    onChange={(e) => setPhotoTarget(Number(e.target.value))}
                  />
                </label>
              </div>
              <p className="mt-2 text-xs text-slate-500">
                Ссылки на проверку → колонка «{DEFAULT_PHOTO_REVIEW_COLUMN}». Обработка фона — в
                следующих версиях.
              </p>
            </fieldset>

            <button
              type="button"
              className={`${homeBtnPrimary} w-full max-w-md py-3 text-base`}
              disabled={busy}
              onClick={() => void runFill()}
            >
              {busy ? "Обработка…" : `Запустить AI для всех ${scan.dataRowCount} строк`}
            </button>
            {progress ? <p className="text-sm text-slate-600">{progress}</p> : null}
          </div>
        </section>
      ) : null}

      {done ? (
        <section className={homeCard}>
          <div className={homeCardHeader}>
            <h2 className={homeCardTitle}>3. Готово</h2>
          </div>
          <div className={`${homeCardBody} space-y-3`}>
            <p className="text-sm">
              Обработано строк: {preview.length}, успешно: {preview.filter((r) => r.ok).length}
            </p>
            <button type="button" className={homeBtnPrimary} onClick={() => void download()}>
              Скачать заполненный .xlsx
            </button>
            <div className="max-h-48 overflow-auto text-xs text-slate-600">
              {preview.slice(0, 15).map((r) => (
                <div key={r.row}>
                  строка {r.row}: {r.ok ? "OK" : r.error}
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
