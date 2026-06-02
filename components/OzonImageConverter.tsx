"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  homeBtnPrimary,
  homeCard,
  homeCardBody,
  homeCardHeader,
  homeCardTitle,
  homeInput
} from "@/components/homeTheme";
import { convertUrlsBatch } from "@/lib/ozonImageConvertClient";
import {
  analyzeWorkbook,
  applyFoto3Column,
  readWorkbookFromFile,
  writeWorkbookToBlob
} from "@/lib/ozonImageExcel";
import type { OzonUrlRow } from "@/lib/ozonImageUrls";

const DEFAULT_OLD = "http://5.35.85.200";
const EXAMPLE =
  "http://5.35.85.200/api/public/tasks/dd66947c-bfbc-47d3-9cab-98932d0a82d2/7.jpg";

type Mode = "replace" | "rehost";
type InputKind = "excel" | "list";

export function OzonImageConverter() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [inputKind, setInputKind] = useState<InputKind>("excel");
  const [fileName, setFileName] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [mode, setMode] = useState<Mode>("rehost");
  const [oldBase, setOldBase] = useState(DEFAULT_OLD);
  const [newBase, setNewBase] = useState("");
  const [rows, setRows] = useState<OzonUrlRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resultBlob, setResultBlob] = useState<{ blob: Blob; name: string } | null>(null);
  const [excelStats, setExcelStats] = useState<{ total: number; ok: number } | null>(null);

  const okUrls = useMemo(
    () => (rows ?? []).filter((r) => r.ok).map((r) => r.output),
    [rows]
  );

  const convertOptions = useMemo(
    () => ({
      mode,
      oldBase: mode === "replace" ? oldBase : undefined,
      newBase: mode === "replace" ? newBase : undefined
    }),
    [mode, oldBase, newBase]
  );

  const runList = useCallback(async () => {
    setBusy(true);
    setError(null);
    setRows(null);
    setResultBlob(null);
    setExcelStats(null);
    setProgress(null);
    try {
      const urls = text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      const map = await convertUrlsBatch(urls, convertOptions);
      setRows(urls.map((u) => map.get(u) ?? { input: u, output: "", ok: false, error: "Нет ответа" }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось связаться с сервером");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }, [text, convertOptions]);

  const runExcel = useCallback(async (file: File) => {
    setBusy(true);
    setError(null);
    setRows(null);
    setResultBlob(null);
    setExcelStats(null);
    setProgress("Читаем Excel…");

    try {
      const wb = await readWorkbookFromFile(file);
      const info = analyzeWorkbook(wb);
      if (!info) {
        setError('Не найден столбец «foto 2» (или «foto2») в первой строке заголовков');
        return;
      }
      if (info.rows.length === 0) {
        setError("В столбце foto 2 нет ссылок для преобразования");
        return;
      }

      const urls = info.rows.map((r) => r.url);
      setProgress(`Преобразуем 0 / ${urls.length}…`);

      const map = await convertUrlsBatch(urls, convertOptions, (done, total) => {
        setProgress(`Преобразуем ${done} / ${total}…`);
      });

      const ws = wb.Sheets[info.sheetName];
      if (!ws) {
        setError("Лист Excel не найден");
        return;
      }

      const ok = applyFoto3Column(ws, info, map);
      const blob = await writeWorkbookToBlob(wb);
      const outName = file.name.replace(/\.xlsx?$/i, "") + "-foto3.xlsx";

      setResultBlob({ blob, name: outName });
      setExcelStats({ total: info.rows.length, ok });
      setRows(
        info.rows.map(({ url }) => map.get(url) ?? { input: url, output: "", ok: false, error: "Нет ответа" })
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка обработки Excel");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }, [convertOptions]);

  const onFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      setFileName(file?.name ?? null);
      setResultBlob(null);
      setExcelStats(null);
      setRows(null);
      setError(null);
      if (file) void runExcel(file);
      e.target.value = "";
    },
    [runExcel]
  );

  const copyAll = useCallback(async () => {
    if (okUrls.length === 0) return;
    await navigator.clipboard.writeText(okUrls.join("\n"));
  }, [okUrls]);

  const downloadTxt = useCallback(() => {
    if (!rows?.length) return;
    const lines = rows.map((r) =>
      r.ok ? r.output : `# ошибка: ${r.input} — ${r.error ?? "?"}`
    );
    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "ozon-links.txt";
    a.click();
    URL.revokeObjectURL(a.href);
  }, [rows]);

  const downloadExcel = useCallback(() => {
    if (!resultBlob) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(resultBlob.blob);
    a.download = resultBlob.name;
    a.click();
    URL.revokeObjectURL(a.href);
  }, [resultBlob]);

  return (
    <div className="space-y-6">
      <section className={homeCard}>
        <div className={homeCardHeader}>
          <h2 className={homeCardTitle}>Как работает</h2>
        </div>
        <div className={`${homeCardBody} text-sm leading-relaxed text-slate-600`}>
          <p className="mb-2">
            Загрузите Excel с колонкой <strong className="font-semibold text-slate-800">foto 2</strong>{" "}
            (ссылки на инфографику с <code className="text-xs">http://5.35.85.200</code>).
            Инструмент добавит рядом колонку <strong className="font-semibold text-slate-800">Foto 3</strong>{" "}
            с https-ссылками для Ozon.
          </p>
        </div>
      </section>

      <section className={homeCard}>
        <div className={homeCardHeader}>
          <h2 className={homeCardTitle}>Режим</h2>
        </div>
        <div className={`${homeCardBody} grid gap-3 sm:grid-cols-2`}>
          <button
            type="button"
            onClick={() => setMode("rehost")}
            className={`rounded-xl border-2 p-4 text-left transition ${
              mode === "rehost"
                ? "border-emerald-600 bg-emerald-50/70 ring-1 ring-emerald-200/60"
                : "border-slate-200 bg-white hover:border-amber-300/80"
            }`}
          >
            <p className="text-sm font-bold text-slate-900">Выложить в облако</p>
            <p className="mt-1 text-xs text-slate-600">Рекомендуется для Ozon</p>
          </button>
          <button
            type="button"
            onClick={() => setMode("replace")}
            className={`rounded-xl border-2 p-4 text-left transition ${
              mode === "replace"
                ? "border-emerald-600 bg-emerald-50/70 ring-1 ring-emerald-200/60"
                : "border-slate-200 bg-white hover:border-amber-300/80"
            }`}
          >
            <p className="text-sm font-bold text-slate-900">Заменить адрес</p>
            <p className="mt-1 text-xs text-slate-600">Если HTTPS уже на вашем сервере</p>
          </button>
        </div>
      </section>

      {mode === "replace" ? (
        <section className={homeCard}>
          <div className={homeCardHeader}>
            <h2 className={homeCardTitle}>Замена префикса</h2>
          </div>
          <div className={`${homeCardBody} grid gap-4 sm:grid-cols-2`}>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-700">Старый адрес</span>
              <input
                className={homeInput}
                value={oldBase}
                onChange={(e) => setOldBase(e.target.value)}
                placeholder={DEFAULT_OLD}
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-700">Новый адрес (https)</span>
              <input
                className={homeInput}
                value={newBase}
                onChange={(e) => setNewBase(e.target.value)}
                placeholder="https://cdn.example.com"
              />
            </label>
          </div>
        </section>
      ) : null}

      <section className={homeCard}>
        <div className={homeCardHeader}>
          <h2 className={homeCardTitle}>Источник</h2>
        </div>
        <div className={`${homeCardBody} space-y-4`}>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setInputKind("excel")}
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
                inputKind === "excel"
                  ? "bg-[#ffd740] text-[#0a0a0a]"
                  : "border border-slate-200 bg-white text-slate-700"
              }`}
            >
              Excel файл
            </button>
            <button
              type="button"
              onClick={() => setInputKind("list")}
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
                inputKind === "list"
                  ? "bg-[#ffd740] text-[#0a0a0a]"
                  : "border border-slate-200 bg-white text-slate-700"
              }`}
            >
              Список ссылок
            </button>
          </div>

          {inputKind === "excel" ? (
            <>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={onFileChange}
              />
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  className={homeBtnPrimary}
                  disabled={busy}
                  onClick={() => fileRef.current?.click()}
                >
                  {busy ? "Обрабатываем…" : "Выбрать Excel"}
                </button>
                {fileName ? (
                  <span className="text-sm text-slate-600">{fileName}</span>
                ) : null}
              </div>
              <p className="text-xs text-slate-500">
                Нужен столбец <strong>foto 2</strong> в шапке. Рядом появится <strong>Foto 3</strong> с
                https-ссылками. Остальные колонки (name, foto, ml…) сохраняются; встроенные картинки в
                Excel могут визуально съехать — для Ozon используйте ссылки из Foto 3.
              </p>
              {progress ? <p className="text-sm text-slate-600">{progress}</p> : null}
              {resultBlob && excelStats ? (
                <div className="flex flex-wrap gap-3 pt-1">
                  <button
                    type="button"
                    className={homeBtnPrimary}
                    onClick={downloadExcel}
                  >
                    Скачать Excel с Foto 3
                  </button>
                  <span className="self-center text-sm text-emerald-700">
                    Готово: {excelStats.ok} из {excelStats.total} ссылок
                  </span>
                </div>
              ) : null}
            </>
          ) : (
            <>
              <textarea
                className={`${homeInput} min-h-[180px] font-mono text-xs leading-relaxed`}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={`По одной ссылке на строку, например:\n${EXAMPLE}`}
                spellCheck={false}
              />
              <button
                type="button"
                className={homeBtnPrimary}
                disabled={busy || !text.trim()}
                onClick={() => void runList()}
              >
                {busy ? "Обрабатываем…" : "Преобразовать"}
              </button>
            </>
          )}

          {error ? (
            <p className="text-sm text-red-700" role="alert">
              {error}
            </p>
          ) : null}

          {inputKind === "list" && rows && okUrls.length > 0 ? (
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50"
                onClick={() => void copyAll()}
              >
                Скопировать {okUrls.length} ссылок
              </button>
              <button
                type="button"
                className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50"
                onClick={downloadTxt}
              >
                Скачать .txt
              </button>
            </div>
          ) : null}
        </div>
      </section>

      {rows && rows.length > 0 && inputKind === "list" ? (
        <section className={homeCard}>
          <div className={homeCardHeader}>
            <h2 className={homeCardTitle}>
              Результат — {rows.filter((r) => r.ok).length} из {rows.length} ok
            </h2>
          </div>
          <div className={`${homeCardBody} overflow-x-auto`}>
            <table className="w-full min-w-[640px] text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="pb-2 pr-3 font-semibold">Было</th>
                  <th className="pb-2 pr-3 font-semibold">Стало</th>
                  <th className="pb-2 font-semibold">Статус</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.input} className="border-b border-slate-100 align-top">
                    <td className="max-w-[240px] break-all py-2 pr-3 font-mono text-slate-600">
                      {r.input}
                    </td>
                    <td className="max-w-[240px] break-all py-2 pr-3 font-mono text-slate-900">
                      {r.output || "—"}
                    </td>
                    <td className="py-2">
                      {r.ok ? (
                        <span className="font-semibold text-emerald-700">OK</span>
                      ) : (
                        <span className="text-red-700">{r.error ?? "Ошибка"}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
