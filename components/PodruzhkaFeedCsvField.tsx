"use client";

import { useEffect, useRef, useState } from "react";
import { homeBtnPrimary, homeInput } from "@/components/homeTheme";

const SK_URL = "fp_podruzhka_feed_csv_url";
const SK_REM = "fp_podruzhka_feed_csv_remember";

export type FeedCsvMergeSource = {
  url?: string;
  csvText?: string;
};

type Props = {
  storageKeyPrefix?: string;
  disabled?: boolean;
  mergeEnabled?: boolean;
  busy?: boolean;
  mergeStats?: { merged: number; notFound: number; variantRows?: number } | null;
  onMerge: (source: FeedCsvMergeSource) => Promise<void>;
};

export function PodruzhkaFeedCsvField({
  storageKeyPrefix = "",
  disabled,
  mergeEnabled,
  busy,
  mergeStats,
  onMerge
}: Props) {
  const skUrl = storageKeyPrefix ? `${storageKeyPrefix}_${SK_URL}` : SK_URL;
  const skRem = storageKeyPrefix ? `${storageKeyPrefix}_${SK_REM}` : SK_REM;

  const fileRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState("");
  const [remember, setRemember] = useState(true);
  const [csvFileName, setCsvFileName] = useState<string | null>(null);
  const [csvText, setCsvText] = useState("");

  useEffect(() => {
    if (typeof sessionStorage === "undefined") return;
    if (sessionStorage.getItem(skRem) !== "0") {
      const u = sessionStorage.getItem(skUrl);
      if (u) setUrl(u);
    }
  }, [skUrl, skRem]);

  useEffect(() => {
    if (typeof sessionStorage === "undefined") return;
    if (!remember) {
      sessionStorage.setItem(skRem, "0");
      sessionStorage.removeItem(skUrl);
      return;
    }
    const t = url.trim();
    if (t) sessionStorage.setItem(skUrl, t);
    sessionStorage.setItem(skRem, "1");
  }, [url, remember, skUrl, skRem]);

  const onCsvFile = async (file: File) => {
    setCsvFileName(file.name);
    setUrl("");
    const text = await file.text();
    setCsvText(text);
  };

  const clearFile = () => {
    setCsvFileName(null);
    setCsvText("");
    if (fileRef.current) fileRef.current.value = "";
  };

  const canMerge = Boolean(mergeEnabled && (url.trim() || csvText.trim()) && !disabled && !busy);

  return (
    <div className="rounded-xl border border-sky-200 bg-sky-50/50 px-4 py-4 space-y-3">
      <div>
        <p className="text-sm font-semibold text-slate-800">CSV 4Partners — фото по артикулу</p>
        <p className="mt-1 text-xs text-slate-600 leading-relaxed">
          Вставьте ссылку на экспортный фид (колонки <strong>Артикул</strong> и{" "}
          <strong>Изображения варианта</strong>). После загрузки Excel нажмите «Подтянуть foto из
          CSV» — в таблицу добавится или обновится колонка с несколькими URL; при рендере парфюма
          выберется packshot (флакон + коробка на белом).
        </p>
      </div>

      <label className="block text-sm">
        <span className="mb-1 block font-medium text-slate-700">Ссылка на CSV</span>
        <input
          type="url"
          className={`${homeInput} font-mono text-[13px]`}
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            if (e.target.value.trim()) clearFile();
          }}
          placeholder="https://store.4partners.io/my/feed/r-parfyumeriya-….csv"
          spellCheck={false}
          disabled={disabled}
        />
      </label>

      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
        <span>или файл CSV:</span>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.txt"
          className="max-w-full text-slate-700"
          disabled={disabled}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onCsvFile(f);
            e.target.value = "";
          }}
        />
        {csvFileName ? (
          <span className="text-slate-700">
            <strong>{csvFileName}</strong>
            <button type="button" className="ml-2 text-sky-700 underline" onClick={clearFile}>
              убрать
            </button>
          </span>
        ) : null}
      </div>

      <label className="flex items-center gap-2 text-xs text-slate-600">
        <input
          type="checkbox"
          checked={remember}
          onChange={(e) => setRemember(e.target.checked)}
          disabled={disabled}
        />
        Запомнить ссылку в этой вкладке
      </label>

      <button
        type="button"
        className={homeBtnPrimary}
        disabled={!canMerge}
        title={
          !mergeEnabled
            ? "Сначала загрузите Excel и подтвердите сопоставление колонок"
            : !url.trim() && !csvText.trim()
              ? "Вставьте ссылку или выберите CSV-файл"
              : undefined
        }
        onClick={() =>
          void onMerge({
            url: url.trim() || undefined,
            csvText: !url.trim() ? csvText : undefined
          })
        }
      >
        {busy ? "Читаем CSV…" : "Подтянуть foto из CSV"}
      </button>

      {mergeStats ? (
        <p className="text-xs text-emerald-800">
          Из CSV записано foto для <strong>{mergeStats.merged}</strong> строк
          {mergeStats.notFound > 0 ? (
            <>
              ; не найдено в CSV по артикулу: <strong>{mergeStats.notFound}</strong>
            </>
          ) : null}
          {mergeStats.variantRows ? (
            <> (в фиде {mergeStats.variantRows} артикулов с фото)</>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
