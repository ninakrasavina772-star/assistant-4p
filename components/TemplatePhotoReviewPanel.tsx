"use client";

import { useMemo, useState } from "react";
import { homeBtnPrimary, homeCard, homeCardBody, homeCardHeader, homeCardTitle } from "@/components/homeTheme";
import {
  photoMatchLabel,
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
          candidates: it.candidates.map((c) =>
            c.url === url ? { ...c, selected } : c
          )
        }
  );
}

function setAllCandidates(items: PhotoReviewItem[], selected: boolean): PhotoReviewItem[] {
  return items.map((it) => ({
    ...it,
    candidates: it.candidates.map((c) => ({ ...c, selected }))
  }));
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

  const stats = useMemo(() => {
    let photos = 0;
    let selected = 0;
    for (const it of items) {
      photos += it.candidates.length;
      selected += it.candidates.filter((c) => c.selected).length;
    }
    return { rows: items.length, photos, selected };
  }, [items]);

  return (
    <section className={homeCard}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-5">
        <h2 className={homeCardTitle}>
          {items.length
            ? `Выбор доп. фото (${stats.rows} SKU · ${stats.selected}/${stats.photos})`
            : "Выбор доп. фото"}
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
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                disabled={busy}
                onClick={() => onChange(setAllCandidates(items, true))}
              >
                Выбрать все
              </button>
              <button
                type="button"
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                disabled={busy}
                onClick={() => onChange(setAllCandidates(items, false))}
              >
                Снять все
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
            Загрузите фото из Metabase: своя вариация + карточки с тем же EAN. Отметьте галочками
            доп. фото — при применении обработаем под стандарт Летуаль (1000×1000, белый фон) и
            запишем ссылки в Excel.
          </p>
        ) : (
          <div className="max-h-[70vh] space-y-3 overflow-y-auto">
            {items.map((it) => {
              const open = expanded[it.row] !== false;
              const name = it.productName || it.brandName || it.sku;
              return (
                <div key={it.row} className="rounded-lg border border-slate-200 bg-white p-3">
                  <button
                    type="button"
                    className="flex w-full items-start gap-3 text-left"
                    onClick={() => setExpanded((m) => ({ ...m, [it.row]: !open }))}
                  >
                    {it.mainUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={it.mainUrl}
                        alt=""
                        className="h-16 w-16 shrink-0 rounded border border-slate-200 bg-white object-contain"
                      />
                    ) : (
                      <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded border border-dashed border-slate-200 text-xs text-slate-400">
                        нет
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-900">{name}</p>
                      <p className="font-mono text-xs text-slate-500">
                        артикул {it.sku} · строка {it.row}
                      </p>
                      <p className="mt-1 text-xs text-slate-600">
                        Главное + {it.candidates.length} кандидатов · отмечено{" "}
                        {it.candidates.filter((c) => c.selected).length}
                      </p>
                    </div>
                    <span className="text-xs text-slate-400">{open ? "▲" : "▼"}</span>
                  </button>
                  {open ? (
                    <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                      {it.candidates.length ? (
                        it.candidates.map((c) => (
                          <label
                            key={`${c.variationId}-${c.url}`}
                            className={`flex w-[7.5rem] flex-col items-stretch gap-1 rounded-lg border p-1 ${
                              c.selected
                                ? "border-emerald-400 bg-emerald-50/50"
                                : "border-slate-200 opacity-75"
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
                            <span className="flex items-center gap-1 px-0.5 text-xs text-slate-700">
                              <input
                                type="checkbox"
                                checked={c.selected}
                                onChange={(e) =>
                                  onChange(
                                    toggleCandidate(items, it.row, c.url, e.target.checked)
                                  )
                                }
                              />
                              в витрину
                            </span>
                          </label>
                        ))
                      ) : (
                        <p className="text-xs text-slate-500">Нет доп. фото для этой вариации.</p>
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
