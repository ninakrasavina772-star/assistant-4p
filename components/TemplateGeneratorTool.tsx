"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type ExcelJS from "exceljs";
import { readWorkbookFromBuffer, writeWorkbookToBlob } from "@/lib/ozonImageExcel";
import { applyFillResults } from "@/lib/templateGenerator/apply";
import type { FillRowInput, FillRowResult } from "@/lib/templateGenerator/types";
import {
  buildCsvIndex,
  lookupCsvRow,
  mergeCsvMapHeuristic,
  parseCsvText,
  type CsvTable
} from "@/lib/templateGenerator/csvIndex";
import {
  collectTemplateSkus,
  countFillModes,
  enhanceCsvColumnMap,
  summarizeCsvCoverage
} from "@/lib/templateGenerator/csvPrefill";
import { DEFAULT_PRODUCT_DATA_SHEET, DEFAULT_PHOTO_REVIEW_COLUMN } from "@/lib/templateGenerator/presets";
import {
  clearColumnPrefs,
  loadColumnPrefs,
  mergePrefsWithColumns,
  saveColumnPrefs,
  templateColumnKey
} from "@/lib/templateGenerator/columnSelection";
import { collectRowContexts, loadListSheetValues, scanTemplateSheet, scanTemplateWorkbook } from "@/lib/templateGenerator/scan";
import type { ColumnSelection, CsvColumnMap, DropdownSource, TemplateSheetScan, TemplateWorkMode } from "@/lib/templateGenerator/types";
import { filterRowsForFill } from "@/lib/templateGenerator/workMode";
import {
  buildCsvSampleRows,
  buildFillPromptFromChat,
  buildStrictExampleInstructions,
  chatStorageKey,
  newChatId,
  welcomeMessage,
  type AssistantFillAction,
  type ChatMessage,
  type TemplateChatContext,
  type TemplateProductSample
} from "@/lib/templateGenerator/chat";
import {
  buildExampleReferenceText,
  loadExampleTemplateSamples
} from "@/lib/templateGenerator/exampleTemplate";
import { injectVariationProducts } from "@/lib/templateGenerator/injectVariationRows";
import { normVariationSku } from "@/lib/templateGenerator/parseVariationIds";
import { isContentDefaultColumn } from "@/lib/templateGenerator/presets";
import { extractWorkbookListValidations, sanitizeOzonXlsxBuffer } from "@/lib/templateGenerator/xlsxValidations";
import { TemplateGeneratorChat } from "@/components/TemplateGeneratorChat";
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
const SK_FEED_ENABLED = "fp_template_gen_feed_enabled";
const SK_WORK_MODE = "fp_template_gen_work_mode";
const SK_OVERWRITE_FILLED = "fp_template_gen_overwrite_filled";
const FILL_CHUNK = 1;
const FILL_PARALLEL = 1;
const FILL_REQUEST_MS = 280_000;
const FILL_BATCH_SIZE_DEFAULT = 50;

type RunFillOptions = {
  variationIds?: number[];
  strictExample?: boolean;
  selectionOverride?: ColumnSelection[];
};

function buildDefaultSelection(scan: TemplateSheetScan): ColumnSelection[] {
  return scan.columns
    .filter((c) => !c.readonly && (c.contentDefault || isContentDefaultColumn(c.header)))
    .map((c) => ({
      header: c.header,
      col: c.col,
      mode: "ai" as const,
      dropdownSource: defaultDropdownSource(c)
    }));
}

function capDropdownForApi(values: string[], brand: string, max = 400): string[] {
  if (values.length <= max) return values;
  if (brand.trim()) return dropdownSample(values, brand).slice(0, max);
  return values.slice(0, max);
}

function dropdownSample(values: string[], brand: string): string[] {
  const b = brand.toLowerCase();
  const matched = values.filter((v) => v.toLowerCase().includes(b.slice(0, 4)));
  const head = values.slice(0, 40);
  return [...new Set([...matched.slice(0, 40), ...head])].slice(0, 120);
}

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

function buildProductSamples(
  wb: ExcelJS.Workbook,
  scan: TemplateSheetScan
): { samples: TemplateProductSample[]; brands: string[] } {
  const ws = wb.getWorksheet(scan.sheetName);
  if (!ws) return { samples: [], brands: [] };
  const rows = collectRowContexts(ws, scan).slice(0, 6);
  const brands = new Set<string>();
  const samples = rows.map((r) => {
    const brand = r.cells["Бренд *"] ?? r.cells["Бренд"] ?? "";
    const name = r.cells["Название товара *"] ?? r.cells["Название товара"] ?? "";
    if (brand) brands.add(brand);
    const preview: Record<string, string> = {};
    for (const [k, v] of Object.entries(r.cells)) {
      if (!v.trim()) continue;
      const n = k.toLowerCase();
      if (/бренд|название|тип|пол|семейство|описание|нот|объем|объём/.test(n)) {
        preview[k] = v.length > 120 ? `${v.slice(0, 120)}…` : v;
      }
      if (Object.keys(preview).length >= 8) break;
    }
    return { sku: r.sku, name, brand, preview };
  });
  return { samples, brands: [...brands].slice(0, 30) };
}

function downloadBlob(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

function filledDownloadName(fileName: string, part?: number): string {
  const base = fileName.replace(/\.xlsx?$/i, "") || "template";
  if (part && part > 0) return `${base}-filled-part${String(part).padStart(2, "0")}.xlsx`;
  return `${base}-filled.xlsx`;
}

export function TemplateGeneratorTool() {
  const tplRef = useRef<HTMLInputElement>(null);
  const exampleRef = useRef<HTMLInputElement>(null);
  const csvRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>(1);
  const wbRef = useRef<ExcelJS.Workbook | null>(null);
  const [hasWb, setHasWb] = useState(false);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [fileName, setFileName] = useState("");
  const [sheetName, setSheetName] = useState("");
  const [scan, setScan] = useState<TemplateSheetScan | null>(null);
  const [csvTable, setCsvTable] = useState<CsvTable | null>(null);
  const [csvMap, setCsvMap] = useState<CsvColumnMap | null>(null);
  const [csvMapLabel, setCsvMapLabel] = useState("");
  const [csvUrl, setCsvUrl] = useState("");
  const [csvLoading, setCsvLoading] = useState(false);
  const [feedEnabled, setFeedEnabled] = useState(false);
  const [workMode, setWorkMode] = useState<TemplateWorkMode>("supplement");
  const [overwriteFilled, setOverwriteFilled] = useState(false);
  const [tplLoading, setTplLoading] = useState(false);

  const listValuesRef = useRef<Map<string, string[]>>(new Map());

  const [openaiKey, setOpenaiKey] = useState("");
  const [rememberKey, setRememberKey] = useState(true);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([welcomeMessage()]);
  const chatKeyLoadedRef = useRef("");

  const [enabledCols, setEnabledCols] = useState<Record<string, boolean>>({});
  const [strictDropdown, setStrictDropdown] = useState<Record<string, boolean>>({});
  const [dropdownSource, setDropdownSource] = useState<Record<string, DropdownSource>>({});

  const [photoEnabled, setPhotoEnabled] = useState(true);
  const [photoGenerateBackgrounds, setPhotoGenerateBackgrounds] = useState(true);
  const [photoStyle, setPhotoStyle] = useState<"themed" | "gradient">("themed");
  const [metabaseEnabled, setMetabaseEnabled] = useState(true);
  const [serverStatus, setServerStatus] = useState<{
    openai: boolean;
    metabase: boolean;
    storage: string | null;
  } | null>(null);
  const [photoMin, setPhotoMin] = useState(7);
  const [photoTarget, setPhotoTarget] = useState(8);

  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<FillRowResult[]>([]);
  const [done, setDone] = useState(false);
  const [fillBatchSize, setFillBatchSize] = useState(FILL_BATCH_SIZE_DEFAULT);
  const [fillRowOffset, setFillRowOffset] = useState(0);
  const [batchesCompleted, setBatchesCompleted] = useState(0);
  const [batchNotice, setBatchNotice] = useState("");
  const [productSamples, setProductSamples] = useState<TemplateProductSample[] | undefined>();
  const [uniqueBrands, setUniqueBrands] = useState<string[] | undefined>();
  const [exampleFileName, setExampleFileName] = useState("");
  const [exampleSheet, setExampleSheet] = useState("");
  const [exampleSamples, setExampleSamples] = useState<TemplateProductSample[]>([]);
  const [exampleLoading, setExampleLoading] = useState(false);

  const step2Ref = useRef<HTMLElement>(null);
  const chatContextRef = useRef<TemplateChatContext>({});
  const columnPrefsKeyRef = useRef("");
  const [columnPrefsRestored, setColumnPrefsRestored] = useState(false);

  useEffect(() => {
    fetch("/api/template-generator/status")
      .then((r) => r.json())
      .then((d: { openai?: boolean; metabase?: boolean; storage?: string | null }) => {
        setServerStatus({
          openai: Boolean(d.openai),
          metabase: Boolean(d.metabase),
          storage: d.storage ?? null
        });
      })
      .catch(() => setServerStatus(null));
  }, []);

  useEffect(() => {
    if (sessionStorage.getItem(SK_OPENAI_REM) !== "0") {
      const k = sessionStorage.getItem(SK_OPENAI);
      if (k) setOpenaiKey(k);
    }
    setFeedEnabled(sessionStorage.getItem(SK_FEED_ENABLED) === "1");
    const wm = sessionStorage.getItem(SK_WORK_MODE);
    if (wm === "from_scratch" || wm === "supplement") setWorkMode(wm);
    setOverwriteFilled(sessionStorage.getItem(SK_OVERWRITE_FILLED) === "1");
  }, []);

  useEffect(() => {
    sessionStorage.setItem(SK_WORK_MODE, workMode);
  }, [workMode]);

  useEffect(() => {
    sessionStorage.setItem(SK_OVERWRITE_FILLED, overwriteFilled ? "1" : "0");
  }, [overwriteFilled]);

  useEffect(() => {
    if (workMode === "from_scratch") setFeedEnabled(true);
  }, [workMode]);

  useEffect(() => {
    sessionStorage.setItem(SK_FEED_ENABLED, feedEnabled ? "1" : "0");
  }, [feedEnabled]);

  useEffect(() => {
    const k = openaiKey.trim();
    if (!k) return;
    if (chatKeyLoadedRef.current === k) return;
    chatKeyLoadedRef.current = k;
    try {
      const raw = sessionStorage.getItem(chatStorageKey(k));
      if (raw) {
        const parsed = JSON.parse(raw) as ChatMessage[];
        if (Array.isArray(parsed) && parsed.length) {
          setChatMessages(parsed);
          return;
        }
      }
    } catch {
      /* ignore */
    }
    setChatMessages([welcomeMessage()]);
  }, [openaiKey]);

  useEffect(() => {
    const k = openaiKey.trim();
    if (!k || !chatMessages.length) return;
    sessionStorage.setItem(chatStorageKey(k), JSON.stringify(chatMessages));
  }, [chatMessages, openaiKey]);

  const chatContext = useMemo((): TemplateChatContext => {
    const selected = scan
      ? scan.columns.filter((c) => !c.readonly && enabledCols[c.header]).map((c) => c.header)
      : [];

    const columns = scan
      ? scan.columns.map((c) => ({
          header: c.header,
          hint: c.hint,
          enabled: Boolean(enabledCols[c.header]),
          readonly: c.readonly
        }))
      : undefined;

    return {
      templateFile: fileName || undefined,
      sheetName: sheetName || undefined,
      rowCount: scan?.dataRowCount,
      feedEnabled,
      workMode,
      overwriteFilled,
      csvLabel: feedEnabled ? csvMapLabel || undefined : undefined,
      csvRowCount: feedEnabled ? csvTable?.rows.length : undefined,
      skuColumn: feedEnabled ? csvMap?.skuColumn : undefined,
      selectedColumns: selected,
      enabledColCount: selected.length,
      photoEnabled,
      photoGenerateBackgrounds,
      photoStyle,
      metabaseEnabled,
      photoMin,
      photoTarget,
      columns,
      productSamples: hasWb ? productSamples : undefined,
      uniqueBrands: hasWb ? uniqueBrands : undefined,
      csvHeaders: feedEnabled ? csvTable?.headers : undefined,
      csvSampleRows:
        feedEnabled && csvTable ? buildCsvSampleRows(csvTable, csvMap, 3) : undefined,
      csvMappedColumns: feedEnabled ? csvMap?.columns : undefined,
      exampleFile: exampleFileName || undefined,
      exampleSheet: exampleSheet || undefined,
      exampleRowCount: exampleSamples.length || undefined,
      exampleSamples: exampleSamples.length ? exampleSamples : undefined
    };
  }, [
    fileName,
    sheetName,
    scan,
    hasWb,
    productSamples,
    uniqueBrands,
    enabledCols,
    feedEnabled,
    workMode,
    overwriteFilled,
    csvMapLabel,
    csvTable,
    csvMap,
    photoEnabled,
    photoGenerateBackgrounds,
    photoStyle,
    metabaseEnabled,
    photoMin,
    photoTarget,
    exampleFileName,
    exampleSheet,
    exampleSamples
  ]);

  useEffect(() => {
    chatContextRef.current = chatContext;
  }, [chatContext]);

  const eventReply = useCallback(
    async (eventText: string) => {
      const key = openaiKey.trim();
      const ctx = chatContextRef.current;
      const userMsg: ChatMessage = {
        id: newChatId(),
        role: "user",
        content: eventText,
        at: Date.now()
      };
      let merged: ChatMessage[] = [];
      setChatMessages((prev) => {
        merged = [...prev, userMsg];
        return merged;
      });

      const fallback = (() => {
        if (eventText.includes("шаблон") || eventText.includes("Шаблон")) {
          const brands = ctx.uniqueBrands?.slice(0, 5).join(", ") || ctx.productSamples?.[0]?.brand || "";
          const ex = ctx.productSamples?.[0]?.name || "";
          return `Получила шаблон «${ctx.templateFile}»: ${ctx.rowCount ?? "?"} товаров, вкладка «${ctx.sheetName}». Пример: ${brands} — ${ex}. Напишите, что заполнять, или нажмите «Запустить AI» ниже.`;
        }
        if (eventText.includes("CSV")) {
          return `CSV подключён (${ctx.csvRowCount ?? "?"} строк, SKU: ${ctx.skuColumn ?? "?"}). Что делаем дальше?`;
        }
        return "Поняла. Напишите, какие характеристики заполнять.";
      })();

      if (!key && !serverStatus?.openai) {
        setChatMessages((prev) => [
          ...prev,
          { id: newChatId(), role: "assistant", content: fallback, at: Date.now() }
        ]);
        return;
      }

      try {
        const res = await fetch("/api/template-generator/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            openaiApiKey: key,
            messages: merged,
            context: ctx
          })
        });
        const j = (await res.json()) as { reply?: string; error?: string };
        if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
        setChatMessages((prev) => [
          ...prev,
          {
            id: newChatId(),
            role: "assistant",
            content: j.reply ?? fallback,
            at: Date.now()
          }
        ]);
      } catch {
        setChatMessages((prev) => [
          ...prev,
          { id: newChatId(), role: "assistant", content: fallback, at: Date.now() }
        ]);
      }
    },
    [openaiKey, serverStatus]
  );

  const initColumns = useCallback((s: TemplateSheetScan, sheet: string) => {
    const editable = s.columns.filter((c) => !c.readonly);
    const headers = editable.map((c) => c.header);

    const defaults = {
      enabled: {} as Record<string, boolean>,
      strict: {} as Record<string, boolean>,
      dropdownSource: {} as Record<string, DropdownSource>
    };
    for (const c of editable) {
      const listVals = resolveDropdownValues(c, "list_sheet");
      const tplVals = resolveDropdownValues(c, "template_validation");
      defaults.strict[c.header] = listVals.length > 0 || tplVals.length > 0;
      defaults.dropdownSource[c.header] = defaultDropdownSource(c);
    }

    const key = templateColumnKey(sheet, headers);
    columnPrefsKeyRef.current = key;
    const saved = loadColumnPrefs(key);
    const merged = mergePrefsWithColumns(headers, saved, defaults);

    setEnabledCols(merged.enabled);
    setStrictDropdown(merged.strict);
    setDropdownSource(merged.dropdownSource);
    setColumnPrefsRestored(merged.restored);
  }, []);

  useEffect(() => {
    const key = columnPrefsKeyRef.current;
    if (!key || !scan) return;
    saveColumnPrefs(key, {
      enabled: enabledCols,
      strict: strictDropdown,
      dropdownSource
    });
  }, [enabledCols, strictDropdown, dropdownSource, scan]);

  const setAllColumns = useCallback(
    (on: boolean) => {
      if (!scan) return;
      setEnabledCols((prev) => {
        const next = { ...prev };
        for (const c of scan.columns) {
          if (!c.readonly) next[c.header] = on;
        }
        return next;
      });
    },
    [scan]
  );

  const resetColumnPrefs = useCallback(() => {
    const key = columnPrefsKeyRef.current;
    if (key) clearColumnPrefs(key);
    if (scan) initColumns(scan, sheetName);
    setColumnPrefsRestored(false);
  }, [scan, sheetName, initColumns]);

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
      if (scan) {
        const headers = scan.columns.map((c) => c.header);
        map = enhanceCsvColumnMap(table, headers, map);
      }
      setCsvMap(map);
      setCsvMapLabel(
        `${label} · ${table.rows.length} строк · SKU: ${map.skuColumn || "?"}`
      );
      return { table, map, label };
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
        const { map } = await applyCsvTable(table, file.name);
        chatContextRef.current = {
          ...chatContextRef.current,
          csvLabel: `${file.name} · ${table.rows.length} строк`,
          csvRowCount: table.rows.length,
          csvHeaders: table.headers,
          csvSampleRows: buildCsvSampleRows(table, map),
          csvMappedColumns: map.columns,
          skuColumn: map.skuColumn
        };
        void eventReply(
          `Загрузила CSV «${file.name}»: ${table.rows.length} строк, колонок ${table.headers.length}.`
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : "Ошибка чтения CSV");
      } finally {
        setCsvLoading(false);
      }
    },
    [applyCsvTable, eventReply, fileName, sheetName, scan, enabledCols]
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
      let csvText: string | null = null;
      let label = url;

      // Сначала — напрямую из браузера (для больших фидов и когда у вас открыта сессия 4Partners)
      try {
        const direct = await fetch(url, { redirect: "follow" });
        if (direct.ok) {
          csvText = await direct.text();
          try {
            label = new URL(url).pathname.split("/").pop() || label;
          } catch {
            /* ignore */
          }
        }
      } catch {
        /* CORS или сеть — попробуем через сервер */
      }

      if (!csvText?.trim()) {
        const res = await fetch("/api/template-generator/fetch-csv", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url })
        });
        const j = (await res.json()) as { text?: string; label?: string; error?: string };
        if (!res.ok) {
          throw new Error(
            j.error ??
              "Не удалось загрузить по ссылке. Скачайте CSV в браузере и нажмите «Загрузить файл»."
          );
        }
        csvText = j.text ?? "";
        label = j.label ?? label;
      }

      const table = parseCsvText(csvText);
      if (!table.headers.length) {
        throw new Error("CSV пустой или не распознан");
      }
      const { map } = await applyCsvTable(table, label);
      chatContextRef.current = {
        ...chatContextRef.current,
        csvLabel: label,
        csvRowCount: table.rows.length,
        csvHeaders: table.headers,
        csvSampleRows: buildCsvSampleRows(table, map),
        csvMappedColumns: map.columns,
        skuColumn: map.skuColumn
      };
      void eventReply(
        `Загрузила CSV по ссылке: ${label} (${table.rows.length} строк).`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки CSV по ссылке");
    } finally {
      setCsvLoading(false);
    }
  }, [csvUrl, applyCsvTable, eventReply, fileName, sheetName, scan, enabledCols]);

  const onTemplateFile = useCallback(
    async (file: File) => {
      setError("");
      setDone(false);
      setPreview([]);
      setFillRowOffset(0);
      setBatchesCompleted(0);
      setBatchNotice("");
      setTplLoading(true);
      try {
        if (!/\.xlsx?$/i.test(file.name)) {
          throw new Error("Нужен файл Excel (.xlsx). Старый .xls не поддерживается.");
        }
        await new Promise((r) => requestAnimationFrame(() => r(undefined)));
        const buf = await file.arrayBuffer();
        const listValidations = await extractWorkbookListValidations(buf);
        const safeBuf = await sanitizeOzonXlsxBuffer(buf);
        const workbook = await readWorkbookFromBuffer(safeBuf);
        const listValues = loadListSheetValues(workbook);
        listValuesRef.current = listValues;
        const scanned = scanTemplateWorkbook(workbook, listValidations);
        const names = Object.keys(scanned.scans);
        const preferred =
          scanned.scans[DEFAULT_PRODUCT_DATA_SHEET]
            ? DEFAULT_PRODUCT_DATA_SHEET
            : names.sort(
            (a, b) => (scanned.scans[b]?.dataRowCount ?? 0) - (scanned.scans[a]?.dataRowCount ?? 0)
          )[0];

        if (!preferred) {
          setError(
            "Не нашли вкладку с товарами (ожидаем лист с колонками «Название товара», «Артикул» или «Данные о товарах»). Проверьте формат шаблона витрины."
          );
          return;
        }

        const sheetScan = scanned.scans[preferred]!;
        wbRef.current = workbook;
        setHasWb(true);
        setSheetNames(workbook.worksheets.map((w) => w.name));
        setFileName(file.name);
        setSheetName(preferred);
        setScan(sheetScan);
        initColumns(sheetScan, preferred);
        setStep(2);
        requestAnimationFrame(() => {
          step2Ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
        const { samples, brands } = buildProductSamples(workbook, sheetScan);
        setProductSamples(samples);
        setUniqueBrands(brands);
        chatContextRef.current = {
          ...chatContextRef.current,
          templateFile: file.name,
          sheetName: preferred,
          rowCount: sheetScan.dataRowCount,
          enabledColCount: 0,
          columns: sheetScan.columns.map((c) => ({
            header: c.header,
            hint: c.hint,
            enabled: false,
            readonly: c.readonly
          })),
          productSamples: samples,
          uniqueBrands: brands,
          selectedColumns: []
        };
        void eventReply(
          `Загрузила шаблон Excel «${file.name}»: вкладка «${preferred}», ${sheetScan.dataRowCount} товаров. Отметьте галочками нужные столбцы и нажмите «Запустить AI».`
        );
      } catch (e) {
        setError(
          e instanceof Error
            ? e.message
            : "Не удалось открыть Excel. Попробуйте другой файл или обновите страницу."
        );
      } finally {
        setTplLoading(false);
      }
    },
    [initColumns, eventReply]
  );

  const onExampleFile = useCallback(
    async (file: File) => {
      setError("");
      setExampleLoading(true);
      try {
        if (!/\.xlsx?$/i.test(file.name)) {
          throw new Error("Образец — файл Excel (.xlsx)");
        }
        if (!scan) {
          throw new Error("Сначала загрузите основной шаблон");
        }
        const buf = await file.arrayBuffer();
        const { samples, sheetName: exSheet, rowCount } = await loadExampleTemplateSamples(
          buf,
          sheetName
        );
        if (!samples.length) {
          throw new Error("В образце не нашли заполненных строк товаров");
        }
        setExampleFileName(file.name);
        setExampleSheet(exSheet);
        setExampleSamples(samples);
        void eventReply(
          `Загрузила образец «${file.name}»: ${rowCount} строк с данными, вкладка «${exSheet}». AI будет ориентироваться на стиль заполнения.`
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : "Ошибка чтения образца");
      } finally {
        setExampleLoading(false);
      }
    },
    [scan, sheetName, eventReply]
  );

  const reviewBeforeFill = useCallback(() => {
    if (!openaiKey.trim() && !serverStatus?.openai) {
      setError("Введите OpenAI API key или задайте OPENAI_API_KEY на сервере");
      return;
    }
    void eventReply(
      "Проверь сопоставление: шаблон, фид (если включён), эталон (если загружен) и отмеченные столбцы. " +
        "Какие поля непонятны или не сопоставились? Задай уточняющие вопросы перед запуском AI."
    );
  }, [eventReply, openaiKey, serverStatus]);

  const onSheetChange = useCallback(
    (name: string) => {
      const wb = wbRef.current;
      if (!wb) return;
      const s = scanTemplateSheet(wb, name, listValuesRef.current);
      if (!s) return;
      setSheetName(name);
      setScan(s);
      initColumns(s, name);
      const { samples, brands } = buildProductSamples(wb, s);
      setProductSamples(samples);
      setUniqueBrands(brands);
    },
    [initColumns]
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

  const runFill = useCallback(async (opts?: RunFillOptions) => {
    const wb = wbRef.current;
    if (!wb || !scan) return;
    const key = openaiKey.trim();
    if (!key && !serverStatus?.openai) {
      setError("Введите OpenAI API key или задайте OPENAI_API_KEY на сервере");
      return;
    }
    const activeSelection =
      opts?.selectionOverride?.length ? opts.selectionOverride : selectionList;
    if (activeSelection.length === 0) {
      setError("Выберите хотя бы один столбец (или загрузите шаблон с контентными полями)");
      return;
    }
    const byVariationIds = Boolean(opts?.variationIds?.length);
    if (!byVariationIds && workMode === "from_scratch" && (!feedEnabled || !csvTable)) {
      setError("Режим «С нуля» требует включённый и загруженный CSV-фид");
      return;
    }
    if (!byVariationIds && feedEnabled && !csvTable) {
      setError("Включён CSV-фид, но файл не загружен — загрузите фид или снимите галочку «Использовать фид»");
      return;
    }

    if (rememberKey) {
      sessionStorage.setItem(SK_OPENAI, key);
      sessionStorage.setItem(SK_OPENAI_REM, "1");
    }

    setBusy(true);
    setError("");
    setBatchNotice("");

    const ws = wb.getWorksheet(scan.sheetName)!;
    let allContexts = collectRowContexts(ws, scan);
    const selectedHeaders = activeSelection.map((s) => s.header);
    const csvMapResolved = feedEnabled
      ? enhanceCsvColumnMap(
          csvTable ?? { headers: [], rows: [] },
          scan.columns.map((c) => c.header),
          csvMap ??
            (csvTable
              ? mergeCsvMapHeuristic(csvTable, scan.columns.map((c) => c.header))
              : { skuColumn: "", columns: {} })
        )
      : { skuColumn: "", columns: {} };
    const csvIndex =
      feedEnabled && csvTable ? buildCsvIndex(csvTable, csvMapResolved) : new Map();
    const feedSkuSet = feedEnabled && csvTable ? new Set(csvIndex.keys()) : null;

    let fillableContexts = filterRowsForFill(allContexts, {
      workMode,
      selectedHeaders,
      feedSkuSet,
      overwriteFilled: byVariationIds ? true : overwriteFilled
    });

    if (byVariationIds && opts?.variationIds) {
      try {
        setProgress(`Metabase: ищу ${opts.variationIds.length} variation_id…`);
        const mbRes = await fetch("/api/template-generator/metabase-products", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ variationIds: opts.variationIds })
        });
        const mbJson = (await mbRes.json()) as {
          products?: {
            variationId: number;
            productName: string;
            brandName: string;
            imageUrls: string[];
          }[];
          missing?: number[];
          error?: string;
        };
        if (!mbRes.ok) throw new Error(mbJson.error ?? `Metabase HTTP ${mbRes.status}`);
        const products = mbJson.products ?? [];
        if (!products.length) {
          throw new Error(
            `В Metabase не найдено ни одного товара из ${opts.variationIds.length} ID` +
              (mbJson.missing?.length ? ` (пропущены: ${mbJson.missing.join(", ")})` : "")
          );
        }
        fillableContexts = injectVariationProducts(ws, scan, products);
        allContexts = collectRowContexts(ws, scan);
        if (mbJson.missing?.length) {
          setBatchNotice(`Не найдены в Metabase: ${mbJson.missing.join(", ")}`);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Ошибка Metabase");
        setBusy(false);
        return;
      }
    }

    const totalRows = fillableContexts.length;
    if (totalRows === 0) {
      setError(
        workMode === "supplement"
          ? "Нет строк с пустыми выбранными полями — всё уже заполнено или снимите галочки."
          : "Нет строк шаблона с артикулами из фида — проверьте сопоставление SKU."
      );
      setBusy(false);
      return;
    }
    if (!byVariationIds && fillRowOffset >= totalRows) {
      setError("Все строки уже обработаны — загрузите шаблон заново или скачайте файл.");
      setBusy(false);
      return;
    }

    const batchSize = byVariationIds
      ? totalRows
      : Math.max(1, Math.min(fillBatchSize, 200));
    const batchStart = byVariationIds ? 0 : fillRowOffset;
    const contexts = fillableContexts.slice(batchStart, batchStart + batchSize);
    const batchEnd = batchStart + contexts.length;
    const batchLabel = `строки ${batchStart + 1}–${batchEnd} из ${totalRows}`;

    setDone(false);
    setPreview([]);
    const templateSkuSet = collectTemplateSkus(allContexts.map((c) => c.sku));
    if (feedEnabled && csvTable && templateSkuSet.size) {
      const feedHits = summarizeCsvCoverage(csvTable, csvMapResolved, templateSkuSet).found;
      setProgress(
        `Фид: ${feedHits} из ${templateSkuSet.size} артикулов · режим «${workMode === "from_scratch" ? "с нуля" : "дополнить"}»…`
      );
    } else if (!feedEnabled) {
      setProgress("Без фида — заполнение через AI (название, бренд, сайт производителя)…");
    }

    const imageHeader =
      scan.columns.find((c) => c.header.toLowerCase().includes("ссылка на изображение"))?.header ??
      null;

    const keepCell = (header: string) =>
      activeSelection.some((s) => s.header === header) ||
      /название|бренд|артикул|изображение|sku|описание|тип|пол|семейство|нот|объем|объём|линейка|год|тестер/i.test(
        header
      );

    const allResults: FillRowResult[] = [];
    const chunks: FillRowInput[][] = [];
    for (let i = 0; i < contexts.length; i += FILL_CHUNK) {
      chunks.push(
        contexts.slice(i, i + FILL_CHUNK).map((ctx) => {
          const cells: Record<string, string> = {};
          for (const [k, v] of Object.entries(ctx.cells)) {
            if (keepCell(k) && v.trim()) cells[k] = v;
          }
          return {
            row: ctx.row,
            sku: ctx.sku,
            productName: ctx.cells["Название товара *"] ?? ctx.cells["Название товара"] ?? "",
            brand: ctx.cells["Бренд *"] ?? ctx.cells["Бренд"] ?? "",
            cells,
            csvData:
              feedEnabled && csvTable
                ? lookupCsvRow(csvIndex, ctx.sku, csvMapResolved)
                : {},
          };
        })
      );
    }

    const columnMeta = activeSelection.map((sel) => {
      const c = scan.columns.find((x) => x.header === sel.header);
      if (!c) return null;
      const source = dropdownSource[c.header] ?? defaultDropdownSource(c);
      const allValues = resolveDropdownValues(c, source);
      return {
        header: c.header,
        hint: c.hint,
        dropdownValues:
          sel.mode === "dropdown_strict"
            ? capDropdownForApi(allValues, "")
            : [],
        mode: (strictDropdown[c.header] ? "dropdown_strict" : "ai") as "ai" | "dropdown_strict"
      };
    }).filter((x): x is NonNullable<typeof x> => x != null);

    const exampleRefText = buildExampleReferenceText(exampleSamples);
    const strictBlock =
      opts?.strictExample || byVariationIds
        ? buildStrictExampleInstructions(exampleSamples.length > 0)
        : "";
    const fillPrompt = [strictBlock, buildFillPromptFromChat(chatMessages, exampleRefText)]
      .filter(Boolean)
      .join("\n\n");
    const applyOverwrite =
      byVariationIds || workMode === "from_scratch" || overwriteFilled;

    let doneRows = 0;
    try {
      for (let i = 0; i < chunks.length; i += FILL_PARALLEL) {
        const wave = chunks.slice(i, i + FILL_PARALLEL);
        setProgress(`AI: ${doneRows} / ${contexts.length} (${batchLabel})…`);

        const waveResults = await Promise.all(
          wave.map(async (rows) => {
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), FILL_REQUEST_MS);
            try {
              const res = await fetch("/api/template-generator/fill", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                signal: ctrl.signal,
                body: JSON.stringify({
                  openaiApiKey: key,
                  userPrompt: fillPrompt,
                  columns: activeSelection,
                  columnMeta,
                  rows,
                  skipWebContext: false,
                  contentFocus: true,
                  workMode,
                  overwriteFilled: applyOverwrite,
                  photoSettings: {
                    enabled: photoEnabled,
                    generateBackgrounds: photoGenerateBackgrounds,
                    photoStyle,
                    metabaseEnabled,
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
            } catch (e) {
              if (e instanceof Error && e.name === "AbortError") {
                throw new Error("Сервер не ответил вовремя — попробуйте снова или уменьшите число столбцов");
              }
              throw e;
            } finally {
              clearTimeout(timer);
            }
          })
        );

        for (const batch of waveResults) {
          allResults.push(...batch);
          doneRows += batch.length;
        }
        applyFillResults(
          ws,
          scan,
          activeSelection,
          allResults,
          DEFAULT_PHOTO_REVIEW_COLUMN,
          applyOverwrite,
          scan.imageCol
        );
        setPreview([...allResults]);
        setProgress(`AI: ${doneRows} / ${contexts.length} (${batchLabel})…`);
      }

      const batchNum = batchesCompleted + 1;
      const blob = await writeWorkbookToBlob(wb);
      downloadBlob(blob, filledDownloadName(fileName, batchNum));

      const modes = countFillModes(allResults);
      const modeLine =
        feedEnabled && csvTable && allResults.length
          ? ` CSV: ${modes.csvOnly} строк · смешанно: ${modes.mixed} · только AI: ${modes.aiOnly}.`
          : "";

      const newOffset = batchEnd;
      setFillRowOffset(newOffset);
      setBatchesCompleted(batchNum);
      const okCount = allResults.filter((r) => r.ok).length;
      const remaining = totalRows - newOffset;

      if (remaining <= 0) {
        setProgress(`Готово: ${okCount} / ${allResults.length} в последней партии, всего ${totalRows} строк`);
        setDone(true);
        setStep(3);
        void eventReply(
          `Все ${totalRows} строк обработаны (${batchNum} партий). Файл part${String(batchNum).padStart(2, "0")} скачан.`
        );
      } else {
        setProgress(`Партия ${batchNum}: ${contexts.length} строк. Осталось ${remaining}.`);
        setBatchNotice(
          `Партия ${batchNum} готова (${batchLabel}) — файл part${String(batchNum).padStart(2, "0")} скачан.` +
            ` Осталось ${remaining} строк.${modeLine} Нажмите «Следующие» для продолжения.`
        );
        void eventReply(
          `Партия ${batchNum}: ${okCount} из ${allResults.length} строк (${batchLabel}). Скачайте уже есть — можно запускать следующую партию.`
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Ошибка заполнения";
      setError(
        doneRows > 0
          ? `${msg}. Обработано ${doneRows} из ${contexts.length} в этой партии — можно скачать частичный результат.`
          : msg
      );
      if (doneRows > 0) {
        const batchNum = batchesCompleted + 1;
        const blob = await writeWorkbookToBlob(wb);
        downloadBlob(blob, filledDownloadName(fileName, batchNum));
        setBatchesCompleted(batchNum);
        setFillRowOffset(batchStart + doneRows);
        setBatchNotice(
          `Ошибка в партии, но ${doneRows} строк записаны — скачан part${String(batchNum).padStart(2, "0")}. Можно продолжить с оставшихся.`
        );
      }
    } finally {
      setBusy(false);
    }
  }, [
    scan,
    openaiKey,
    rememberKey,
    selectionList,
    chatMessages,
    chatContext,
    eventReply,
    csvTable,
    csvMap,
    photoEnabled,
    photoGenerateBackgrounds,
    photoStyle,
    metabaseEnabled,
    photoMin,
    photoTarget,
    strictDropdown,
    dropdownSource,
    fillRowOffset,
    fillBatchSize,
    batchesCompleted,
    fileName,
    feedEnabled,
    workMode,
    overwriteFilled,
    exampleSamples,
    serverStatus
  ]);

  const handleAssistantAction = useCallback(
    async (action: AssistantFillAction) => {
      if (action.type !== "start_fill") return;
      if (!wbRef.current || !scan) {
        setError("Сначала загрузите Excel-шаблон");
        return;
      }
      if (action.strictExample && !exampleSamples.length) {
        void eventReply(
          "Эталон не загружен — заполню по Metabase и правилам из чата. Для строгого копирования стиля загрузите образец."
        );
      }
      const selectionOverride =
        selectionList.length > 0 ? undefined : buildDefaultSelection(scan);
      if (selectionOverride?.length) {
        setEnabledCols((prev) => {
          const next = { ...prev };
          for (const s of selectionOverride) next[s.header] = true;
          return next;
        });
        setStep(2);
      }
      await runFill({
        variationIds: action.variationIds,
        strictExample: action.strictExample,
        selectionOverride
      });
    },
    [scan, selectionList, exampleSamples, eventReply, runFill]
  );

  const download = useCallback(
    async (part?: number) => {
      const wb = wbRef.current;
      if (!wb) return;
      const blob = await writeWorkbookToBlob(wb);
      downloadBlob(blob, filledDownloadName(fileName, part));
    },
    [fileName]
  );

  const enabledColCount = useMemo(
    () => Object.values(enabledCols).filter(Boolean).length,
    [enabledCols]
  );

  const fillStats = useMemo(() => {
    const total = scan?.dataRowCount ?? 0;
    const remaining = Math.max(0, total - fillRowOffset);
    const nextBatch = Math.min(Math.max(1, fillBatchSize), remaining || fillBatchSize);
    const rangeFrom = fillRowOffset + 1;
    const rangeTo = fillRowOffset + nextBatch;
    const allDone = total > 0 && fillRowOffset >= total;
    return { total, remaining, nextBatch, rangeFrom, rangeTo, allDone };
  }, [scan?.dataRowCount, fillRowOffset, fillBatchSize]);

  const csvCoverage = useMemo(() => {
    if (!feedEnabled || !csvTable || !scan || !hasWb) return null;
    const wb = wbRef.current;
    if (!wb) return null;
    const ws = wb.getWorksheet(scan.sheetName);
    if (!ws) return null;
    const contexts = collectRowContexts(ws, scan);
    const skus = collectTemplateSkus(contexts.map((c) => c.sku));
    const baseMap =
      csvMap ?? mergeCsvMapHeuristic(csvTable, scan.columns.map((c) => c.header));
    const map = enhanceCsvColumnMap(csvTable, scan.columns.map((c) => c.header), baseMap);
    return {
      ...summarizeCsvCoverage(csvTable, map, skus),
      feedRows: csvTable.rows.length
    };
  }, [feedEnabled, csvTable, scan, csvMap, hasWb, sheetName]);

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
        {stepBtn(1, "Шаблон", hasWb)}
        {stepBtn(2, "Столбцы и запуск", Boolean(hasWb && scan))}
        {stepBtn(3, "Результат", done)}
      </div>

      {error ? (
        <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
          {error}
        </div>
      ) : null}

      {!hasWb ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <strong>Шаг 1:</strong> загрузите шаблон Excel (.xlsx) — CSV не нужен. После загрузки
          (10–30 сек на большой файл) появятся столбцы и кнопка «Запустить AI».
        </p>
      ) : (
        <p className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-900">
          ✓ Шаблон «{fileName}» загружен · {scan?.dataRowCount ?? 0} товаров · прокрутите вниз к
          блоку «2. Столбцы и запуск»
        </p>
      )}

      <section className={homeCard}>
        <div className={homeCardHeader}>
          <h2 className={homeCardTitle}>1. Шаблон и данные</h2>
        </div>
        <div className={`${homeCardBody} space-y-4`}>
            <input
              ref={tplRef}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              disabled={tplLoading}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onTemplateFile(f);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              className={homeBtnPrimary}
              disabled={tplLoading}
              onClick={() => tplRef.current?.click()}
            >
              {tplLoading ? "Читаем шаблон… (подождите)" : "Загрузить шаблон Excel (.xlsx)"}
            </button>
            {tplLoading ? (
              <p className="text-sm text-slate-600">Парсим Excel в браузере — CSV не требуется.</p>
            ) : null}
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

            {scan ? (
              <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-sm font-semibold text-slate-800">Режим работы</p>
                <label className="flex cursor-pointer items-start gap-2 text-sm">
                  <input
                    type="radio"
                    name="workMode"
                    className="mt-1"
                    checked={workMode === "supplement"}
                    onChange={() => {
                      setWorkMode("supplement");
                      setFillRowOffset(0);
                      setBatchesCompleted(0);
                    }}
                  />
                  <span>
                    <strong>Дополнить</strong> — для рейтинга: заполняем только пустые выбранные поля.
                    Уже заполненное не трогаем.
                  </span>
                </label>
                <label className="flex cursor-pointer items-start gap-2 text-sm">
                  <input
                    type="radio"
                    name="workMode"
                    className="mt-1"
                    checked={workMode === "from_scratch"}
                    onChange={() => {
                      setWorkMode("from_scratch");
                      setFillRowOffset(0);
                      setBatchesCompleted(0);
                    }}
                  />
                  <span>
                    <strong>С нуля</strong> — шаблон витрины + фид: сопоставление колонок, заполнение
                    товаров из фида (нужен включённый CSV).
                  </span>
                </label>
                {workMode === "supplement" ? (
                  <label className="ml-6 flex items-center gap-2 text-xs text-slate-600">
                    <input
                      type="checkbox"
                      checked={overwriteFilled}
                      onChange={(e) => setOverwriteFilled(e.target.checked)}
                    />
                    Перезаписывать уже заполненные ячейки (обычно не нужно)
                  </label>
                ) : null}
              </div>
            ) : null}

            {scan ? (
              <div className="space-y-2 rounded-lg border border-dashed border-amber-300 bg-amber-50/50 p-3">
                <p className="text-sm font-semibold text-slate-800">Образец заполнения (необязательно)</p>
                <p className="text-xs text-slate-600">
                  Загрузите Excel с 5–20 хорошо заполненными строками — ассистент и AI скопируют стиль,
                  формат и полноту полей.
                </p>
                <input
                  ref={exampleRef}
                  type="file"
                  accept=".xlsx"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void onExampleFile(f);
                    e.target.value = "";
                  }}
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold"
                    disabled={exampleLoading}
                    onClick={() => exampleRef.current?.click()}
                  >
                    {exampleLoading ? "Читаем образец…" : "Загрузить образец"}
                  </button>
                  {exampleFileName ? (
                    <button
                      type="button"
                      className="text-sm text-slate-500 underline"
                      onClick={() => {
                        setExampleFileName("");
                        setExampleSheet("");
                        setExampleSamples([]);
                      }}
                    >
                      Сбросить образец
                    </button>
                  ) : null}
                </div>
                {exampleFileName ? (
                  <p className="text-sm text-green-800">
                    ✓ Образец: {exampleFileName} · {exampleSamples.length} строк · вкладка «
                    {exampleSheet}»
                  </p>
                ) : null}
              </div>
            ) : null}

            <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <label className="flex items-start gap-2 text-sm font-semibold text-slate-800">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={feedEnabled}
                  onChange={(e) => setFeedEnabled(e.target.checked)}
                />
                <span>
                  Использовать CSV-фид при заполнении
                  <span className="mt-0.5 block text-xs font-normal text-slate-600">
                    Включите, если в фиде 4Partners есть ноты, описания и т.д. — сначала подставим
                    их по артикулу вариации, остальное добьёт AI. Выключите, чтобы заполнять только
                    через AI без фида.
                  </span>
                </span>
              </label>

              {feedEnabled ? (
                <>
                  <p className="text-xs text-slate-600">
                    Матчинг по «Артикул товара (SKU)». Из большого фида (10 000+ вариаций) берём
                    только строки, чьи артикулы есть в вашем шаблоне.
                    Большие файлы (~80+ МБ) — скачайте в браузере и загрузите кнопкой ниже.
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
              {csvCoverage && scan ? (
                <p className="text-sm text-slate-700">
                  По артикулу вариации в фиде: <strong>{csvCoverage.found}</strong> из{" "}
                  {csvCoverage.total} строк шаблона (всего {csvCoverage.feedRows.toLocaleString()}{" "}
                  вариаций в CSV).
                  {csvCoverage.missing > 0
                    ? ` Для ${csvCoverage.missing} позиций недостающие поля добьёт AI.`
                    : " Все артикулы шаблона есть в фиде."}
                </p>
              ) : null}
              {!scan && csvTable ? (
                <p className="text-xs text-amber-800">
                  CSV загружен. Загрузите шаблон Excel — сопоставим колонки автоматически.
                </p>
              ) : null}
                </>
              ) : (
                <p className="text-xs text-slate-600">
                  Фид выключен — при запуске AI будет использовать название, бренд и сайт
                  производителя. CSV можно не загружать.
                </p>
              )}
            </div>

            <label className="block text-sm">
              OpenAI API key
              <input
                type="password"
                className={`${homeInput} mt-1 w-full max-w-lg`}
                value={openaiKey}
                onChange={(e) => setOpenaiKey(e.target.value)}
                placeholder={serverStatus?.openai ? "необязательно — ключ на сервере" : "sk-proj-…"}
                autoComplete="off"
              />
            </label>
            {serverStatus ? (
              <p className="text-xs text-slate-600">
                Сервер: OpenAI {serverStatus.openai ? "✓" : "—"} · Metabase{" "}
                {serverStatus.metabase ? "✓" : "—"} · хранилище {serverStatus.storage ?? "—"}
              </p>
            ) : null}
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={rememberKey}
                onChange={(e) => setRememberKey(e.target.checked)}
              />
              Запомнить ключ в браузере
            </label>

            <TemplateGeneratorChat
              apiKey={openaiKey}
              serverOpenAi={serverStatus?.openai}
              messages={chatMessages}
              onMessagesChange={setChatMessages}
              context={chatContext}
              onError={setError}
              onAssistantAction={(action) => void handleAssistantAction(action)}
            />

            {scan ? (
              <button
                type="button"
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-50"
                onClick={reviewBeforeFill}
              >
                Проверить сопоставление — задать вопросы ассистенту
              </button>
            ) : null}

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
              Вкладка: <strong>{sheetName}</strong> · режим:{" "}
              <strong>{workMode === "supplement" ? "дополнить" : "с нуля"}</strong> · отмечено:{" "}
              <strong>{enabledColCount}</strong> столбцов · фид:{" "}
              <strong>
                {feedEnabled ? (csvTable ? "включён" : "включён, не загружен") : "выключен"}
              </strong>
              .
              {columnPrefsRestored ? (
                <span className="text-green-700"> Загружен сохранённый выбор для этого шаблона.</span>
              ) : (
                <span> Отметьте галочками нужные характеристики — выбор сохранится для этой вкладки.</span>
              )}
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium hover:bg-slate-50"
                onClick={() => setAllColumns(true)}
              >
                Выбрать все
              </button>
              <button
                type="button"
                className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium hover:bg-slate-50"
                onClick={() => setAllColumns(false)}
              >
                Снять все
              </button>
              <button
                type="button"
                className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium hover:bg-slate-50"
                onClick={resetColumnPrefs}
              >
                Сбросить сохранённый выбор
              </button>
            </div>
            <div className="max-h-80 overflow-auto rounded border border-slate-200">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-slate-100">
                  <tr>
                    <th className="p-2">Заполнять</th>
                    <th className="p-2">Столбец</th>
                    <th className="p-2">Подсказка площадки</th>
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
                        <td className="max-w-[14rem] p-2 text-slate-500" title={c.hint}>
                          {c.hint ? `${c.hint.slice(0, 72)}${c.hint.length > 72 ? "…" : ""}` : "—"}
                        </td>
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
              <legend className="px-1 font-semibold">Фото товара</legend>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={photoEnabled}
                  onChange={(e) => setPhotoEnabled(e.target.checked)}
                />
                Дополнять фото, если в ячейке меньше цели
              </label>
              <label className="mt-2 flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={metabaseEnabled}
                  disabled={!photoEnabled || !serverStatus?.metabase}
                  onChange={(e) => setMetabaseEnabled(e.target.checked)}
                />
                Брать foto из Metabase по SKU (variation_id) — large2x, lifestyle
              </label>
              <label className="mt-2 flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={photoGenerateBackgrounds}
                  disabled={!photoEnabled}
                  onChange={(e) => setPhotoGenerateBackgrounds(e.target.checked)}
                />
                Генерировать lifestyle-фото (флакон на тематическом фоне)
              </label>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <span className="text-xs text-slate-600">Стиль фона:</span>
                <label className="flex items-center gap-1 text-xs">
                  <input
                    type="radio"
                    name="photoStyle"
                    checked={photoStyle === "themed"}
                    disabled={!photoEnabled || !photoGenerateBackgrounds}
                    onChange={() => setPhotoStyle("themed")}
                  />
                  В тему товара (AI, как у брендов)
                </label>
                <label className="flex items-center gap-1 text-xs">
                  <input
                    type="radio"
                    name="photoStyle"
                    checked={photoStyle === "gradient"}
                    disabled={!photoEnabled || !photoGenerateBackgrounds}
                    onChange={() => setPhotoStyle("gradient")}
                  />
                  Простые градиенты (быстрее)
                </label>
              </div>
              <p className="mt-2 text-xs text-slate-500">
                Packshot снимается с белого фона, ставится на сцену по бренду и нотам (DALL·E HD).
                До 3 кадров на строку. Shiseido → японский zen, Santal → дерево/золото и т.д.
              </p>
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
                Цель до {photoTarget} фото в ячейке. Новые URL → «Ссылка на изображение» и «
                {DEFAULT_PHOTO_REVIEW_COLUMN}». AI-режим: ~1–2 мин на строку.
              </p>
            </fieldset>

            <fieldset className="rounded-lg border border-slate-200 p-3 text-sm">
              <legend className="px-1 font-semibold">Партиями</legend>
              <p className="text-xs text-slate-500">
                Обрабатываем файл частями: после каждой партии Excel скачивается автоматически, затем
                нажмите кнопку для следующих строк.
                {feedEnabled
                  ? " Сначала данные подставляются из CSV по артикулу вариации; AI заполняет только то, чего нет в фиде."
                  : " Фид выключен — все выбранные поля заполняет AI."}{" "}
                Вкладку можно закрыть между партиями — прогресс сохраняется, пока не обновите
                страницу.
              </p>
              <div className="mt-2 flex flex-wrap items-end gap-4">
                <label>
                  Строк за запуск
                  <input
                    type="number"
                    min={1}
                    max={200}
                    className={`${homeInput} ml-2 w-20`}
                    value={fillBatchSize}
                    disabled={busy}
                    onChange={(e) => setFillBatchSize(Math.max(1, Math.min(200, Number(e.target.value) || 1)))}
                  />
                </label>
                {fillRowOffset > 0 ? (
                  <p className="text-xs text-slate-600">
                    Уже обработано: <strong>{fillRowOffset}</strong> из {fillStats.total}
                    {batchesCompleted > 0 ? ` · партий: ${batchesCompleted}` : null}
                  </p>
                ) : null}
              </div>
            </fieldset>

            <button
              type="button"
              className={`${homeBtnPrimary} w-full max-w-md py-3 text-base`}
              disabled={busy || fillStats.allDone}
              onClick={() => void runFill()}
            >
              {busy
                ? "Обработка…"
                : fillStats.allDone
                  ? "Все строки обработаны"
                  : fillRowOffset > 0
                    ? `Следующие ${fillStats.nextBatch} (${fillStats.rangeFrom}–${fillStats.rangeTo} из ${fillStats.total})`
                    : `Запустить AI (${fillStats.rangeFrom}–${fillStats.rangeTo} из ${fillStats.total})`}
            </button>
            {batchNotice ? (
              <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                {batchNotice}
              </p>
            ) : null}
            {progress ? <p className="text-sm text-slate-600">{progress}</p> : null}
            {busy ? (
              <p className="text-xs text-slate-500">
                Около 20–40 сек на строку. Счётчик обновляется после каждой строки. Партия из{" "}
                {fillStats.nextBatch} строк ≈ {Math.round((fillStats.nextBatch * 30) / 60)}–
                {Math.round((fillStats.nextBatch * 40) / 60)} мин.
              </p>
            ) : null}
            {fillRowOffset > 0 && !fillStats.allDone && !busy ? (
              <button
                type="button"
                className="text-sm text-slate-600 underline"
                onClick={() => void download(batchesCompleted || undefined)}
              >
                Скачать текущий файл ещё раз
                {batchesCompleted > 0 ? ` (part${String(batchesCompleted).padStart(2, "0")})` : ""}
              </button>
            ) : null}
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
              Обработано строк: {fillRowOffset || preview.length} из {scan?.dataRowCount ?? preview.length},
              в последней партии успешно: {preview.filter((r) => r.ok).length}
              {batchesCompleted > 0 ? ` · скачано партий: ${batchesCompleted}` : null}
            </p>
            <button
              type="button"
              className={homeBtnPrimary}
              onClick={() => void download(batchesCompleted || undefined)}
            >
              Скачать заполненный .xlsx
              {batchesCompleted > 0 ? ` (part${String(batchesCompleted).padStart(2, "0")})` : ""}
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
