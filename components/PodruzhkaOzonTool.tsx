"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  analyzePodruzhkaWorkbook,
  applyAiResults,
  applyFoto2Urls,
  readAiFromSheet,
  readWorkbookFromFile,
  writeWorkbookToBlob
} from "@/lib/podruzhkaExcel";
import type { PodruzhkaAiResult, PodruzhkaFeedRow } from "@/lib/podruzhkaTypes";
import type ExcelJS from "exceljs";

const SK_OPENAI = "fp_podruzhka_openai_key";
const SK_OPENAI_REM = "fp_podruzhka_openai_remember";
const NOTES_CHUNK = 3;
const RENDER_CHUNK = 2;

type Step = 1 | 2 | 3;

export function PodruzhkaOzonTool() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>(1);
  const [fileName, setFileName] = useState<string | null>(null);
  const [wb, setWb] = useState<ExcelJS.Workbook | null>(null);
  const [sheetInfo, setSheetInfo] = useState<ReturnType<typeof analyzePodruzhkaWorkbook>>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openaiKey, setOpenaiKey] = useState("");
  const [rememberKey, setRememberKey] = useState(true);
  const [notesStats, setNotesStats] = useState<{ ok: number; fail: number } | null>(null);
  const [renderStats, setRenderStats] = useState<{ ok: number; fail: number } | null>(null);
  const [resultBlob, setResultBlob] = useState<{ blob: Blob; name: string } | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (typeof sessionStorage === "undefined") return;
    if (sessionStorage.getItem(SK_OPENAI_REM) !== "0") {
      const k = sessionStorage.getItem(SK_OPENAI);
      if (k) setOpenaiKey(k);
    }
  }, []);

  const onFile = useCallback(async (file: File) => {
    setBusy(true);
    setError(null);
    setNotesStats(null);
    setRenderStats(null);
    setResultBlob(null);
    setPreviewUrl(null);
    setProgress("Читаем Excel…");

    try {
      const workbook = await readWorkbookFromFile(file);
      const info = analyzePodruzhkaWorkbook(workbook);
      if (!info) {
        setError(
          "Не найдены колонки: brand name, product_type, product name, name, foto, ml"
        );
        return;
      }
      if (info.rows.length === 0) {
        setError("В файле нет строк с данными");
        return;
      }
      setWb(workbook);
      setSheetInfo(info);
      setFileName(file.name);
      setStep(1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка чтения Excel");
    } finally {
      setBusy(false);
      setProgress(null);
    }
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
    setNotesStats(null);
    const ws = wb.getWorksheet(sheetInfo.sheetName);
    if (!ws) {
      setError("Лист не найден");
      setBusy(false);
      return;
    }

    const all = sheetInfo.rows.filter((row) => {
      const ai = readAiFromSheet(ws, sheetInfo, row);
      return ai.status !== "ok";
    });

    if (all.length === 0) {
      setNotesStats({ ok: sheetInfo.rows.length, fail: 0 });
      setStep(2);
      setBusy(false);
      return;
    }

    const results: PodruzhkaAiResult[] = [];
    let ok = 0;
    let fail = 0;

    try {
      for (let i = 0; i < all.length; i += NOTES_CHUNK) {
        const chunk = all.slice(i, i + NOTES_CHUNK);
        setProgress(`Ноты и model: ${i} / ${all.length}…`);

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

      applyAiResults(ws, sheetInfo, results);

      const blob = await writeWorkbookToBlob(wb);
      const outName = (fileName ?? "feed").replace(/\.xlsx?$/i, "") + "-notes.xlsx";
      setResultBlob({ blob, name: outName });
      const skipped = sheetInfo.rows.length - all.length;
      setNotesStats({ ok: ok + skipped, fail });
      setStep(2);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка шага 1");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }, [wb, sheetInfo, openaiKey, rememberKey, fileName]);

  const runRender = useCallback(async () => {
    if (!wb || !sheetInfo) return;

    setBusy(true);
    setError(null);
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
    const todo: PodruzhkaFeedRow[] = [];

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
      setError("Нет строк с notes_status=ok и заполненными нотами. Сначала шаг 1.");
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

      applyFoto2Urls(ws, sheetInfo, urls);
      const blob = await writeWorkbookToBlob(wb);
      const outName = (fileName ?? "feed").replace(/\.xlsx?$/i, "") + "-infographic.xlsx";
      setResultBlob({ blob, name: outName });
      setRenderStats({ ok, fail });
      setStep(3);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка шага 2");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }, [wb, sheetInfo, fileName, previewUrl]);

  const download = useCallback(() => {
    if (!resultBlob) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(resultBlob.blob);
    a.download = resultBlob.name;
    a.click();
    URL.revokeObjectURL(a.href);
  }, [resultBlob]);

  const stepBtn = (n: Step, label: string) => (
    <button
      type="button"
      onClick={() => setStep(n)}
      className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
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
          <h2 className={homeCardTitle}>Этапы</h2>
        </div>
        <div className={`${homeCardBody} space-y-3 text-sm text-slate-600`}>
          <div className="flex flex-wrap gap-2">
            {stepBtn(1, "1. Ноты + model (AI)")}
            {stepBtn(2, "2. Инфографика в foto 2")}
            {stepBtn(3, "3. Публичные ссылки Foto 3")}
          </div>
          <ol className="list-decimal space-y-1 pl-5 text-xs">
            <li>
              AI находит <strong>model</strong> (название аромата) и 3 пары нот по{" "}
              <strong>name</strong> + <strong>product name</strong> — без выдумок.
            </li>
            <li>
              Подстановка в шаблон Подружка Global: <strong>brand name</strong>,{" "}
              <strong>product_type</strong>, <strong>model</strong>, ноты, <strong>ml</strong>, фото из{" "}
              <strong>foto</strong> → колонка <strong>foto 2</strong>.
            </li>
            <li>Как раньше: foto 2 → облако → <strong>Foto 3</strong> для Ozon.</li>
          </ol>
        </div>
      </section>

      {(step === 1 || step === 2) && (
        <section className={homeCard}>
          <div className={homeCardHeader}>
            <h2 className={homeCardTitle}>Excel фид</h2>
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
              {busy ? "Обрабатываем…" : "Загрузить Excel"}
            </button>
            {fileName && sheetInfo ? (
              <p className="text-sm text-slate-600">
                {fileName} — {sheetInfo.rows.length} строк
              </p>
            ) : null}
            {progress ? <p className="text-sm text-slate-600">{progress}</p> : null}
            {error ? (
              <p className="text-sm text-red-700" role="alert">
                {error}
              </p>
            ) : null}
            {resultBlob ? (
              <button type="button" className={homeBtnPrimary} onClick={download}>
                Скачать {resultBlob.name}
              </button>
            ) : null}
          </div>
        </section>
      )}

      {step === 1 && (
        <section className={homeCard}>
          <div className={homeCardHeader}>
            <h2 className={homeCardTitle}>Шаг 1 — ноты и model</h2>
          </div>
          <div className={`${homeCardBody} space-y-4`}>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-700">Ключ OpenAI API</span>
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
              Помнить в sessionStorage до закрытия вкладки
            </label>
            <button
              type="button"
              className={homeBtnPrimary}
              disabled={busy || !sheetInfo}
              onClick={() => void runNotes()}
            >
              {busy ? "Идёт AI…" : "Прописать ноты и model"}
            </button>
            {notesStats ? (
              <p className="text-sm text-emerald-700">
                Готово: {notesStats.ok} ok, {notesStats.fail} без данных — скачайте Excel и переходите к шагу 2
              </p>
            ) : null}
            <p className="text-xs text-slate-500">
              Добавятся колонки: model, note1_title, note1_desc, … notes_status.
            </p>
          </div>
        </section>
      )}

      {step === 2 && (
        <section className={homeCard}>
          <div className={homeCardHeader}>
            <h2 className={homeCardTitle}>Шаг 2 — шаблон Подружка Global</h2>
          </div>
          <div className={`${homeCardBody} space-y-4`}>
            <p className="text-sm text-slate-600">
              Только подстановка в макет: бренд, тип товара, model, 3 ноты, объём, фото из{" "}
              <strong>foto</strong>. Дизайн не меняется.
            </p>
            <button
              type="button"
              className={homeBtnPrimary}
              disabled={busy || !wb}
              onClick={() => void runRender()}
            >
              {busy ? "Рендер…" : "Собрать инфографику в foto 2"}
            </button>
            {renderStats ? (
              <p className="text-sm text-emerald-700">
                Заполнено foto 2: {renderStats.ok}, ошибок: {renderStats.fail}
              </p>
            ) : null}
            {previewUrl ? (
              <div>
                <p className="mb-2 text-xs text-slate-500">Пример последней карточки:</p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={previewUrl}
                  alt="Превью инфографики"
                  className="max-w-xs rounded-lg border border-slate-200 shadow-sm"
                />
              </div>
            ) : null}
          </div>
        </section>
      )}

      {step === 3 && <OzonImageConverter embedded />}
    </div>
  );
}
