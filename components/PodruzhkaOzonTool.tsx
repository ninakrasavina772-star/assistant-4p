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
import { cellAsUrl } from "@/lib/ozonImageExcel";
import {
  applyAiResults,
  applyFoto2Urls,
  buildFoto2ColumnInfo,
  buildSheetFromMapping,
  defaultPodruzhkaDownloadName,
  guessColumnMapping,
  mappingIsComplete,
  PODRUZHKA_FIELD_LABELS,
  readAiFromSheet,
  readWorkbookFromFile,
  REQUIRED_FEED_FIELDS,
  scanWorkbookHeaders,
  writeWorkbookToBlob,
  type PodruzhkaColumnMapping,
  type PodruzhkaFieldKey,
  type PodruzhkaSheetInfo,
  type WorkbookScan
} from "@/lib/podruzhkaExcel";
import type { PodruzhkaAiResult } from "@/lib/podruzhkaTypes";
import type ExcelJS from "exceljs";

const SK_OPENAI = "fp_podruzhka_openai_key";
const SK_OPENAI_REM = "fp_podruzhka_openai_remember";
const NOTES_CHUNK = 3;
const RENDER_CHUNK = 2;

type Step = 1 | 2 | 3;

const FIELD_ORDER: PodruzhkaFieldKey[] = [
  "brandName",
  "productType",
  "productName",
  "name",
  "foto",
  "ml",
  "id",
  "foto2"
];

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
  const refFileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>(1);
  const [fileName, setFileName] = useState<string | null>(null);
  const [wb, setWb] = useState<ExcelJS.Workbook | null>(null);
  const [scan, setScan] = useState<WorkbookScan | null>(null);
  const [mapping, setMapping] = useState<PodruzhkaColumnMapping>({});
  const [mappingOk, setMappingOk] = useState(false);
  const [sheetInfo, setSheetInfo] = useState<PodruzhkaSheetInfo | null>(null);
  const [templateBase64, setTemplateBase64] = useState<string | null>(null);
  const [templatePreview, setTemplatePreview] = useState<string | null>(null);
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
  const [renderStats, setRenderStats] = useState<{ ok: number; fail: number } | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

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
      if (!wb) return;
      try {
        const blob = await writeWorkbookToBlob(wb);
        downloadBlob(blob, defaultPodruzhkaDownloadName(fileName, suffix));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не удалось сохранить Excel");
      }
    },
    [wb, fileName, downloadBlob]
  );

  const confirmMapping = useCallback(() => {
    if (!wb || !scan) return;
    const err = mappingIsComplete(mapping);
    if (err) {
      setError(err);
      return;
    }
    const info = buildSheetFromMapping(wb, scan, mapping);
    if (!info) {
      setError("Нет строк с данными по выбранным колонкам");
      return;
    }
    setSheetInfo(info);
    setMappingOk(true);
    setError(null);
    setStep(1);
  }, [wb, scan, mapping]);

  const onFile = useCallback(async (file: File) => {
    setBusy(true);
    setError(null);
    setNotesDone(false);
    setNotesStats(null);
    setInfographicDone(false);
    setRenderStats(null);
    setPreviewUrl(null);
    setMappingOk(false);
    setSheetInfo(null);
    setProgress("Читаем Excel…");

    try {
      const workbook = await readWorkbookFromFile(file);
      const scanned = scanWorkbookHeaders(workbook);
      if (!scanned) {
        setError("Не найдена строка заголовков в Excel");
        return;
      }
      const guessed = guessColumnMapping(scanned.headers);
      setWb(workbook);
      setScan(scanned);
      setMapping(guessed);
      setFileName(file.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка чтения Excel");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }, []);

  const onReference = useCallback((file: File) => {
    if (!file.type.startsWith("image/")) {
      setError("Референс: загрузите PNG или JPG");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const data = String(reader.result ?? "");
      setTemplateBase64(data);
      setTemplatePreview(data);
      setError(null);
    };
    reader.readAsDataURL(file);
  }, []);

  const runNotes = useCallback(async () => {
    if (!wb || !sheetInfo) return;
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
    setNotesDone(false);
    setNotesStats(null);

    const ws = wb.getWorksheet(sheetInfo.sheetName);
    if (!ws) {
      setError("Лист не найден");
      setBusy(false);
      return;
    }

    const pending = sheetInfo.rows.filter((row) => {
      const ai = readAiFromSheet(ws, sheetInfo, row);
      return ai.status !== "ok";
    });

    const results: PodruzhkaAiResult[] = [];
    let ok = 0;
    let fail = 0;

    try {
      if (pending.length > 0) {
        for (let i = 0; i < pending.length; i += NOTES_CHUNK) {
          const chunk = pending.slice(i, i + NOTES_CHUNK);
          setProgress(`Ноты и model: ${i} / ${pending.length}…`);

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

      const written = applyAiResults(ws, sheetInfo, results);
      const skipped = sheetInfo.rows.length - pending.length;
      setNotesStats({ ok: ok + skipped, fail, written: written || pending.length + skipped });
      setNotesDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка шага 1");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }, [wb, sheetInfo, openaiKey, rememberKey]);

  const runRender = useCallback(async () => {
    if (!wb || !sheetInfo) return;
    if (!notesDone) {
      setError("Сначала завершите шаг 1.");
      return;
    }

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
    const todo: typeof sheetInfo.rows = [];

    for (const row of sheetInfo.rows) {
      const ai = readAiFromSheet(ws, sheetInfo, row);
      if (ai.status !== "ok" || !ai.model || !ai.notes.every((n) => n.title && n.desc)) {
        continue;
      }
      if (
        sheetInfo.foto2Col &&
        cellAsUrl(ws.getCell(row.row, sheetInfo.foto2Col).value)
      ) {
        continue;
      }
      todo.push(row);
    }

    if (todo.length === 0) {
      setError(
        "Нет строк для инфографики: нужен notes_status=ok, model, 3 ноты. Скачайте Excel после шага 1 и проверьте колонки."
      );
      setBusy(false);
      return;
    }

    try {
      for (let i = 0; i < todo.length; i += RENDER_CHUNK) {
        const chunk = todo.slice(i, i + RENDER_CHUNK);
        setProgress(`Формируем инфографику: ${i} / ${todo.length}…`);

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
                  notes: ai.notes,
                  templateBase64: templateBase64 ?? undefined
                })
              });
              const data = (await res.json()) as { url?: string; error?: string };
              if (!res.ok || !data.url) {
                fail++;
                return;
              }
              urls.set(row.row, data.url);
              ok++;
              if (!previewUrl) setPreviewUrl(data.url);
            } catch {
              fail++;
            }
          })
        );
      }

      const { foto2Col } = applyFoto2Urls(ws, sheetInfo, urls);
      setSheetInfo((prev) => (prev ? { ...prev, foto2Col } : prev));
      setRenderStats({ ok, fail });
      setInfographicDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка формирования инфографики");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }, [wb, sheetInfo, notesDone, previewUrl, templateBase64]);

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

  const headerOptions = scan?.headers ?? [];

  return (
    <div className="space-y-6">
      <section className={homeCard}>
        <div className={homeCardHeader}>
          <h2 className={homeCardTitle}>Этапы</h2>
        </div>
        <div className={`${homeCardBody} space-y-3 text-sm text-slate-600`}>
          <div className="flex flex-wrap gap-2">
            {stepBtn(1, "1. Ноты", mappingOk)}
            {stepBtn(2, "2. Инфографика", notesDone)}
            {stepBtn(3, "3. Foto 3", infographicDone)}
          </div>
        </div>
      </section>

      {/* Excel */}
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
              {sheetInfo ? ` — ${sheetInfo.rows.length} строк` : " — укажите соответствие колонок"}
            </p>
          ) : null}
          {progress ? <p className="text-sm text-slate-600">{progress}</p> : null}
          {error ? (
            <p className="text-sm text-red-700" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </section>

      {/* Сопоставление колонок */}
      {wb && scan && !mappingOk ? (
        <section className={homeCard}>
          <div className={homeCardHeader}>
            <h2 className={homeCardTitle}>Соответствие полей</h2>
          </div>
          <div className={`${homeCardBody} space-y-4`}>
            <p className="text-sm text-slate-600">
              Укажите, какая колонка Excel куда попадает в инфографику и в AI.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {FIELD_ORDER.map((field) => (
                <label key={field} className="block text-sm">
                  <span className="mb-1 block font-medium text-slate-700">
                    {PODRUZHKA_FIELD_LABELS[field]}
                    {REQUIRED_FEED_FIELDS.includes(field) ? (
                      <span className="text-red-600"> *</span>
                    ) : null}
                  </span>
                  <select
                    className={homeInput}
                    value={mapping[field] ?? ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      setMapping((m) => ({
                        ...m,
                        [field]: v ? Number(v) : undefined
                      }));
                    }}
                  >
                    <option value="">— не выбрано —</option>
                    {headerOptions.map((h) => (
                      <option key={h.col} value={h.col}>
                        {h.label} (столбец {h.col})
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <button type="button" className={homeBtnPrimary} onClick={confirmMapping}>
              Сохранить соответствие и продолжить
            </button>
          </div>
        </section>
      ) : null}

      {/* Референс шаблона */}
      {mappingOk ? (
        <section className={homeCard}>
          <div className={homeCardHeader}>
            <h2 className={homeCardTitle}>Референс шаблона (PNG/JPG)</h2>
          </div>
          <div className={`${homeCardBody} space-y-4`}>
            <p className="text-xs text-slate-500">
              Загрузите макет 900×1200 (как ваш пример Подружка Global). Текст и фото товара программа
              нарисует поверх. Без референса — серый фон по умолчанию.
            </p>
            <input
              ref={refFileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onReference(f);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50"
              onClick={() => refFileRef.current?.click()}
            >
              {templatePreview ? "Заменить референс" : "Загрузить референс"}
            </button>
            {templatePreview ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={templatePreview}
                alt="Референс"
                className="max-h-48 rounded-lg border border-slate-200 object-contain"
              />
            ) : null}
          </div>
        </section>
      ) : null}

      {/* Скачать — всегда видно после шага 1 */}
      {notesDone && wb ? (
        <section className="rounded-xl border-2 border-amber-300 bg-amber-50 px-4 py-3 flex flex-wrap items-center gap-3">
          <span className="text-sm font-semibold text-amber-950">Файл с нотами готов</span>
          <button
            type="button"
            className={homeBtnPrimary}
            disabled={busy}
            onClick={() => void downloadWorkbook("notes")}
          >
            Скачать Excel с model и нотами
          </button>
        </section>
      ) : null}

      {mappingOk && sheetInfo && step === 1 && (
        <section className={homeCard}>
          <div className={homeCardHeader}>
            <h2 className={homeCardTitle}>Шаг 1 — model и ноты</h2>
          </div>
          <div className={`${homeCardBody} space-y-4`}>
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
                {busy ? "Идёт AI…" : "Прописать model и ноты"}
              </button>
            ) : null}

            {notesDone && notesStats ? (
              <StepDoneBanner title="Шаг 1 завершён">
                <p className="text-sm text-emerald-800">
                  Записано в Excel: {notesStats.written} строк. Успешно: {notesStats.ok}, без
                  данных: {notesStats.fail}.
                </p>
                <button
                  type="button"
                  className={homeBtnPrimary}
                  disabled={busy}
                  onClick={() => void downloadWorkbook("notes")}
                >
                  Скачать Excel с model и нотами
                </button>
                <button
                  type="button"
                  className="w-full rounded-lg border border-emerald-700 bg-white px-4 py-2.5 text-sm font-semibold text-emerald-900 hover:bg-emerald-50"
                  onClick={() => setStep(2)}
                >
                  Проверила файл — к инфографике →
                </button>
              </StepDoneBanner>
            ) : null}
          </div>
        </section>
      )}

      {mappingOk && sheetInfo && step === 2 && (
        <section className={homeCard}>
          <div className={homeCardHeader}>
            <h2 className={homeCardTitle}>Шаг 2 — инфографика</h2>
          </div>
          <div className={`${homeCardBody} space-y-4`}>
            {!infographicDone ? (
              <button
                type="button"
                className={homeBtnPrimary}
                disabled={busy || !notesDone}
                onClick={() => void runRender()}
              >
                {busy ? "Формируем…" : "Сформировать инфографику"}
              </button>
            ) : null}

            {infographicDone && renderStats ? (
              <StepDoneBanner title="Инфографика готова">
                <p className="text-sm text-emerald-800">
                  Ссылок в foto 2: {renderStats.ok}
                  {renderStats.fail > 0 ? `, ошибок: ${renderStats.fail}` : ""}.
                </p>
                <button
                  type="button"
                  className={homeBtnPrimary}
                  disabled={busy}
                  onClick={() => void downloadWorkbook("infographic")}
                >
                  Скачать готовый Excel (все колонки + foto 2)
                </button>
                {previewUrl ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={previewUrl} alt="Превью" className="max-w-xs rounded-lg border" />
                ) : null}
                <button
                  type="button"
                  className="w-full rounded-lg border border-emerald-700 bg-white px-4 py-2.5 text-sm font-semibold text-emerald-900"
                  onClick={() => setStep(3)}
                >
                  Шаг 3 — Foto 3 для Ozon →
                </button>
              </StepDoneBanner>
            ) : null}
          </div>
        </section>
      )}

      {infographicDone && wb && (
        <section className="rounded-xl border-2 border-amber-300 bg-amber-50 px-4 py-3 flex flex-wrap gap-3">
          <span className="text-sm font-semibold text-amber-950">Готовый Excel</span>
          <button
            type="button"
            className={homeBtnPrimary}
            onClick={() => void downloadWorkbook("infographic")}
          >
            Скачать Excel с инфографикой
          </button>
        </section>
      )}

      {mappingOk && sheetInfo && step === 3 && infographicDone && (
        <OzonImageConverter embedded pipeline={pipeline} />
      )}
    </div>
  );
}
