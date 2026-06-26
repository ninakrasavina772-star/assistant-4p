"use client";

import { useMemo, useState } from "react";
import { homeBtnPrimary, homeCard, homeCardBody, homeCardHeader, homeCardTitle } from "@/components/homeTheme";
import {
  photoMatchLabel,
  photoReviewMainUrl,
  type PhotoReviewItem
} from "@/lib/templateGenerator/photoReview";

type Props = {
  items: PhotoReviewItem[];
  busy?: boolean;
  progress?: string | null;
  onChange: (items: PhotoReviewItem[]) => void;
  onRefresh: () => void;
  onApply: () => void;
};

function setMainCandidate(
  items: PhotoReviewItem[],
  row: number,
  url: string
): PhotoReviewItem[] {
  return items.map((it) => {
    if (it.row !== row) return it;
    return {
      ...it,
      processed: false,
      mainUrl: url,
      candidates: it.candidates.map((c) => ({
        ...c,
        isMain: c.url === url,
        selected: c.url === url ? false : c.selected
      }))
    };
  });
}

function toggleCandidate(
  items: PhotoReviewItem[],
  row: number,
  url: string,
  selected: boolean
): PhotoReviewItem[] {
  return items.map((it) =>
    it.row !== row
      ? it
      : {
          ...it,
          processed: false,
          candidates: it.candidates.map((c) =>
            c.url === url ? { ...c, selected: c.isMain ? false : selected } : c
          )
        }
  );
}

export function TemplatePhotoReviewPanel({
  items,
  busy,
  progress,
  onChange,
  onRefresh,
  onApply
}: Props) {
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [hideProcessed, setHideProcessed] = useState(false);

  const stats = useMemo(() => {
    let photos = 0;
    let selected = 0;
    let processed = 0;
    for (const it of items) {
      photos += it.candidates.length;
      selected += it.candidates.filter((c) => c.selected).length;
      if (it.processed) processed += 1;
    }
    return { rows: items.length, photos, selected, processed };
  }, [items]);

  const visibleItems = useMemo(
    () => (hideProcessed ? items.filter((it) => !it.processed) : items),
    [items, hideProcessed]
  );

  return (
    <section className={homeCard}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-5">
        <h2 className={homeCardTitle}>
          {items.length
            ? `Выбор фото (${stats.rows} SKU · ${stats.selected} доп. · ${stats.processed} обработано)`
            : "Выбор фото"}
        </h2>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
            disabled={busy}
            onClick={onRefresh}
          >
            {busy ? "Загрузка…" : "Загрузить из Metabase"}
          </button>
          {items.length ? (
            <>
              <button
                type="button"
                className={`rounded-lg border px-3 py-2 text-sm ${
                  hideProcessed
                    ? "border-indigo-300 bg-indigo-50 text-indigo-800"
                    : "border-slate-200"
                }`}
                disabled={busy || !stats.processed}
                onClick={() => setHideProcessed((v) => !v)}
              >
                {hideProcessed ? "Показать обработанные" : "Скрыть обработанные"}
              </button>
              <button type="button" className={homeBtnPrimary} disabled={busy} onClick={onApply}>
                {busy ? "Обработка…" : "Применить в Excel"}
              </button>
            </>
          ) : null}
        </div>
      </div>
      <div className={`${homeCardBody} space-y-3`}>
        {!items.length ? (
          <p className="text-sm text-slate-600">
            Загрузите фото из Metabase. AI отметит главное и доп. фото без дублей — вы можете
            скорректировать. «Главное» — первое фото в Excel, галочки — дополнительные.
          </p>
        ) : (
          <div className="max-h-[70vh] space-y-3 overflow-y-auto">
            {visibleItems.length === 0 ? (
              <p className="text-sm text-slate-600">
                Все позиции обработаны. Нажмите «Показать обработанные», чтобы увидеть их снова.
              </p>
            ) : null}
            {visibleItems.map((it) => {
              const open = expanded[it.row] !== false;
              const name = it.productName || it.brandName || it.sku;
              const preview = photoReviewMainUrl(it);
              const extraCount = it.candidates.filter((c) => c.selected).length;
              return (
                <div
                  key={it.row}
                  className={`rounded-lg border p-3 ${
                    it.processed
                      ? "border-emerald-200 bg-emerald-50/30"
                      : "border-slate-200 bg-white"
                  }`}
                >
                  <button
                    type="button"
                    className="flex w-full items-start gap-3 text-left"
                    onClick={() => setExpanded((m) => ({ ...m, [it.row]: !open }))}
                  >
                    {preview ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={preview}
                        alt=""
                        className="h-16 w-16 shrink-0 rounded border border-slate-200 bg-white object-contain"
                      />
                    ) : (
                      <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded border border-dashed border-slate-200 text-xs text-slate-400">
                        нет
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium text-slate-900">{name}</p>
                        {it.processed ? (
                          <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800">
                            обработано
                          </span>
                        ) : null}
                        {it.aiPicked && !it.processed ? (
                          <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium text-sky-800">
                            AI
                          </span>
                        ) : null}
                      </div>
                      <p className="font-mono text-xs text-slate-500">
                        артикул {it.sku} · строка {it.row}
                      </p>
                      <p className="mt-1 text-xs text-slate-600">
                        {it.candidates.length} фото · главное выбрано · доп. {extraCount}
                      </p>
                    </div>
                    <span className="text-xs text-slate-400">{open ? "▲" : "▼"}</span>
                  </button>
                  {open ? (
                    <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                      {it.candidates.length ? (
                        it.candidates.map((c) => (
                          <div
                            key={`${c.variationId}-${c.url}`}
                            className={`flex w-[7.5rem] flex-col items-stretch gap-1 rounded-lg border p-1 ${
                              c.isMain
                                ? "border-amber-400 bg-amber-50/60 ring-1 ring-amber-200"
                                : c.selected
                                  ? "border-emerald-400 bg-emerald-50/50"
                                  : "border-slate-200 opacity-80"
                            }`}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={c.processedUrl || c.url}
                              alt=""
                              className="h-24 w-full rounded object-contain bg-white"
                            />
                            <span className="truncate px-0.5 font-mono text-[10px] text-slate-600">
                              V{c.variationId}
                            </span>
                            <span className="px-0.5 text-[10px] leading-tight text-slate-500">
                              {photoMatchLabel(c.matchType)}
                            </span>
                            <label className="flex items-center gap-1 px-0.5 text-[10px] text-amber-900">
                              <input
                                type="radio"
                                name={`main-${it.row}`}
                                checked={c.isMain}
                                onChange={() => onChange(setMainCandidate(items, it.row, c.url))}
                              />
                              главное
                            </label>
                            {!c.isMain ? (
                              <label className="flex items-center gap-1 px-0.5 text-xs text-slate-700">
                                <input
                                  type="checkbox"
                                  checked={c.selected}
                                  onChange={(e) =>
                                    onChange(
                                      toggleCandidate(items, it.row, c.url, e.target.checked)
                                    )
                                  }
                                />
                                доп.
                              </label>
                            ) : null}
                          </div>
                        ))
                      ) : (
                        <p className="text-xs text-slate-500">Нет фото для этой вариации.</p>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
        {progress ? <p className="text-xs text-slate-600">{progress}</p> : null}
      </div>
    </section>
  );
}
