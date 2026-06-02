"use client";

import { useCallback, useMemo, useState } from "react";
import {
  homeBtnPrimary,
  homeCard,
  homeCardBody,
  homeCardHeader,
  homeCardTitle,
  homeInput
} from "@/components/homeTheme";
import type { OzonUrlRow } from "@/lib/ozonImageUrls";

const DEFAULT_OLD = "http://5.35.85.200";
const EXAMPLE =
  "http://5.35.85.200/api/public/tasks/dd66947c-bfbc-47d3-9cab-98932d0a82d2/7.jpg";

type Mode = "replace" | "rehost";

export function OzonImageConverter() {
  const [text, setText] = useState("");
  const [mode, setMode] = useState<Mode>("rehost");
  const [oldBase, setOldBase] = useState(DEFAULT_OLD);
  const [newBase, setNewBase] = useState("");
  const [rows, setRows] = useState<OzonUrlRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const okUrls = useMemo(
    () => (rows ?? []).filter((r) => r.ok).map((r) => r.output),
    [rows]
  );

  const run = useCallback(async () => {
    setBusy(true);
    setError(null);
    setRows(null);
    try {
      const res = await fetch("/api/ozon-images/convert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          text,
          oldBase: mode === "replace" ? oldBase : undefined,
          newBase: mode === "replace" ? newBase : undefined
        })
      });
      const data = (await res.json()) as {
        error?: string;
        rows?: OzonUrlRow[];
      };
      if (!res.ok) {
        setError(data.error ?? `Ошибка ${res.status}`);
        return;
      }
      setRows(data.rows ?? []);
    } catch {
      setError("Не удалось связаться с сервером");
    } finally {
      setBusy(false);
    }
  }, [mode, text, oldBase, newBase]);

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

  return (
    <div className="space-y-6">
      <section className={homeCard}>
        <div className={homeCardHeader}>
          <h2 className={homeCardTitle}>Как работает</h2>
        </div>
        <div className={`${homeCardBody} text-sm leading-relaxed text-slate-600`}>
          <p className="mb-2">
            Ozon принимает только ссылки с <strong className="font-semibold text-slate-800">https://</strong>.
            Ваши картинки сейчас на <code className="text-xs">http://5.35.85.200</code> — поэтому не
            грузятся.
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong className="font-medium text-slate-800">Выложить в облако</strong> — скачиваем
              картинки и даём новые https-ссылки (нужен Vercel Blob на сервере).
            </li>
            <li>
              <strong className="font-medium text-slate-800">Заменить адрес</strong> — если у вас уже
              есть HTTPS-домен с теми же путями, просто меняем начало ссылки.
            </li>
          </ul>
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
            <p className="mt-1 text-xs text-slate-600">
              Рекомендуется: готовые https-ссылки для Ozon
            </p>
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
            <p className="mt-1 text-xs text-slate-600">
              Если HTTPS уже настроен на вашем сервере
            </p>
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
          <h2 className={homeCardTitle}>Ссылки на картинки</h2>
        </div>
        <div className={homeCardBody}>
          <textarea
            className={`${homeInput} min-h-[180px] font-mono text-xs leading-relaxed`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={`По одной ссылке на строку, например:\n${EXAMPLE}`}
            spellCheck={false}
          />
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              className={homeBtnPrimary}
              disabled={busy || !text.trim()}
              onClick={() => void run()}
            >
              {busy ? "Обрабатываем…" : "Преобразовать"}
            </button>
            {rows && okUrls.length > 0 ? (
              <>
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
              </>
            ) : null}
          </div>
          {error ? (
            <p className="mt-3 text-sm text-red-700" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </section>

      {rows && rows.length > 0 ? (
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
