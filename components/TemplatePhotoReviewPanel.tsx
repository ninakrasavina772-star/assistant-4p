"use client";

import { useMemo, useState } from "react";
import { homeBtnPrimary, homeCard, homeCardBody, homeCardHeader, homeCardTitle } from "@/components/homeTheme";
import {
  photoMatchLabel,
  photoReviewMainCandidate,
  photoReviewMainUrl,
  type PhotoReviewItem
} from "@/lib/templateGenerator/photoReview";

type Props = {
  items: PhotoReviewItem[];
  busy?: boolean;
  progress?: string | null;
  onChange: (items: PhotoReviewItem[]) => void;
  onRefresh: () => void;
  /** Обработка Летуаль + запись в книгу */
  onProcess: () => void;
  /** Скачать Excel после отбора */
  onDownload: () => void;
};

type Lightbox = { url: string; title?: string };

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

function PhotoThumb({
  url,
  alt,
  className,
  onOpen
}: {
  url: string;
  alt?: string;
  className?: string;
  onOpen: (url: string) => void;
}) {
  return (
    <button
      type="button"
      className={`group block overflow-hidden rounded border border-slate-200 bg-white ${className ?? ""}`}
      onClick={() => onOpen(url)}
      title="Открыть крупно"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={alt ?? ""} className="h-full w-full object-contain" />
      <span className="mt-0.5 block text-center text-[10px] text-sky-700 group-hover:underline">
        открыть
      </span>
    </button>
  );
}

export function TemplatePhotoReviewPanel({
  items,
  busy,
  progress,
  onChange,
  onRefresh,
  onProcess,
  onDownload
}: Props) {
  const [hideProcessed, setHideProcessed] = useState(false);
  const [lightbox, setLightbox] = useState<Lightbox | null>(null);
  const [pickerRow, setPickerRow] = useState<number | null>(null);

  const stats = useMemo(() => {
    let selected = 0;
    let processed = 0;
    let ready = 0;
    for (const it of items) {
      selected += it.candidates.filter((c) => c.selected).length;
      if (it.processed) processed += 1;
      if (it.candidates.some((c) => c.isMain)) ready += 1;
    }
    return { rows: items.length, selected, processed, ready };
  }, [items]);

  const visibleItems = useMemo(
    () => (hideProcessed ? items.filter((it) => !it.processed) : items),
    [items, hideProcessed]
  );

  const pickerItem = pickerRow != null ? items.find((it) => it.row === pickerRow) : null;

  const openLightbox = (url: string, title?: string) => setLightbox({ url, title });

  const canDownload = stats.processed > 0 || stats.ready > 0;

  return (
    <section className={homeCard}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-5">
        <h2 className={homeCardTitle}>
          {items.length
            ? `Выбор фото (${stats.rows} SKU · ${stats.processed} обработано)`
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
              <button
                type="button"
                className="rounded-lg bg-slate-800 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
                disabled={busy || !stats.ready}
                onClick={onProcess}
              >
                {busy ? "Обработка…" : "Обработать фото"}
              </button>
              <button
                type="button"
                className={homeBtnPrimary}
                disabled={busy || !canDownload}
                onClick={onDownload}
              >
                Выгрузить в Excel
              </button>
            </>
          ) : null}
        </div>
      </div>
      <div className={`${homeCardBody} space-y-3`}>
        {!items.length ? (
          <p className="text-sm text-slate-600">
            Загрузите фото из Metabase. AI отметит главное и доп. без дублей — проверьте выбор,
            нажмите «Обработать фото», затем «Выгрузить в Excel».
          </p>
        ) : (
          <div className="overflow-x-auto">
            {visibleItems.length === 0 ? (
              <p className="text-sm text-slate-600">
                Все позиции обработаны. Нажмите «Показать обработанные».
              </p>
            ) : (
              <table className="w-full min-w-[880px] text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                    <th className="pb-2 pr-3">Товар</th>
                    <th className="pb-2 pr-3">Главное</th>
                    <th className="pb-2 pr-3">Доп. фото</th>
                    <th className="pb-2 pr-3">Статус</th>
                    <th className="pb-2">Выбор</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {visibleItems.map((it) => {
                    const name = it.productName || it.brandName || it.sku;
                    const main = photoReviewMainCandidate(it);
                    const mainSrc = main ? main.processedUrl || main.url : null;
                    const extras = it.candidates.filter((c) => c.selected && !c.isMain);
                    return (
                      <tr key={it.row} className={it.processed ? "bg-emerald-50/40" : undefined}>
                        <td className="py-3 pr-3 align-top">
                          <p className="font-medium text-slate-900">{name}</p>
                          <p className="font-mono text-xs text-slate-500">
                            {it.sku} · стр. {it.row}
                          </p>
                        </td>
                        <td className="py-3 pr-3 align-top">
                          {mainSrc ? (
                            <PhotoThumb
                              url={mainSrc}
                              className="h-28 w-28"
                              onOpen={(u) => openLightbox(u, `${name} — главное`)}
                            />
                          ) : (
                            <span className="text-xs text-slate-400">не выбрано</span>
                          )}
                        </td>
                        <td className="py-3 pr-3 align-top">
                          {extras.length ? (
                            <div className="flex flex-wrap gap-1">
                              {extras.map((c) => (
                                <PhotoThumb
                                  key={c.url}
                                  url={c.processedUrl || c.url}
                                  className="h-16 w-16"
                                  onOpen={(u) => openLightbox(u, `${name} — доп.`)}
                                />
                              ))}
                            </div>
                          ) : (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                        </td>
                        <td className="py-3 pr-3 align-top">
                          <div className="flex flex-col gap-1">
                            {it.processed ? (
                              <span className="inline-block w-fit rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                                обработано
                              </span>
                            ) : it.aiPicked ? (
                              <span className="inline-block w-fit rounded bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-800">
                                AI
                              </span>
                            ) : (
                              <span className="text-xs text-slate-400">ожидает</span>
                            )}
                            <span className="text-xs text-slate-600">
                              доп.: {extras.length} / {it.candidates.length - 1}
                            </span>
                          </div>
                        </td>
                        <td className="py-3 align-top">
                          <button
                            type="button"
                            className="text-left text-xs text-sky-700 hover:underline"
                            onClick={() => setPickerRow(it.row)}
                          >
                            Все фото ({it.candidates.length})
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}
        {progress ? <p className="text-xs text-slate-600">{progress}</p> : null}
      </div>

      {pickerItem ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-xl bg-white p-4 shadow-xl">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold text-slate-900">
                  {pickerItem.productName || pickerItem.brandName || pickerItem.sku}
                </h3>
                <p className="text-xs text-slate-500">
                  артикул {pickerItem.sku} · главное (радио) + доп. (галочки)
                </p>
              </div>
              <button
                type="button"
                className="rounded px-2 text-slate-500 hover:bg-slate-100"
                onClick={() => setPickerRow(null)}
              >
                ✕
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {pickerItem.candidates.map((c) => (
                <div
                  key={`${c.variationId}-${c.url}`}
                  className={`rounded-lg border p-2 ${
                    c.isMain
                      ? "border-amber-400 bg-amber-50/60"
                      : c.selected
                        ? "border-emerald-400 bg-emerald-50/50"
                        : "border-slate-200"
                  }`}
                >
                  <button
                    type="button"
                    className="w-full"
                    onClick={() =>
                      openLightbox(
                        c.processedUrl || c.url,
                        `V${c.variationId} · ${photoMatchLabel(c.matchType)}`
                      )
                    }
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={c.processedUrl || c.url}
                      alt=""
                      className="mx-auto h-36 w-full object-contain bg-white"
                    />
                    <span className="mt-1 block text-[10px] text-sky-700 hover:underline">
                      открыть крупно
                    </span>
                  </button>
                  <p className="mt-1 font-mono text-[10px] text-slate-600">V{c.variationId}</p>
                  <p className="text-[10px] text-slate-500">{photoMatchLabel(c.matchType)}</p>
                  <label className="mt-1 flex items-center gap-1 text-[10px] text-amber-900">
                    <input
                      type="radio"
                      name={`main-picker-${pickerItem.row}`}
                      checked={c.isMain}
                      onChange={() => onChange(setMainCandidate(items, pickerItem.row, c.url))}
                    />
                    главное
                  </label>
                  {!c.isMain ? (
                    <label className="flex items-center gap-1 text-xs text-slate-700">
                      <input
                        type="checkbox"
                        checked={c.selected}
                        onChange={(e) =>
                          onChange(
                            toggleCandidate(items, pickerItem.row, c.url, e.target.checked)
                          )
                        }
                      />
                      доп.
                    </label>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {lightbox ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 p-4"
          onClick={() => setLightbox(null)}
        >
          <div
            className="relative max-h-[96vh] max-w-[96vw]"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="absolute -top-10 right-0 rounded bg-white/10 px-3 py-1 text-sm text-white hover:bg-white/20"
              onClick={() => setLightbox(null)}
            >
              Закрыть
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={lightbox.url}
              alt=""
              className="max-h-[90vh] max-w-full rounded-lg bg-white object-contain shadow-2xl"
            />
            {lightbox.title ? (
              <p className="mt-2 text-center text-sm text-white/90">{lightbox.title}</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
