"use client";

import { useMemo, useState } from "react";
import { homeBtnPrimary, homeCard, homeCardBody, homeCardHeader, homeCardTitle } from "@/components/homeTheme";
import type { PhotoReviewItem } from "@/lib/templateGenerator/photoReview";

type Props = {
  items: PhotoReviewItem[];
  busy?: boolean;
  onChange: (items: PhotoReviewItem[]) => void;
  onRefresh: () => void;
  onApply: () => void;
};

function toggleExtra(
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
          extras: it.extras.map((e) => (e.url === url ? { ...e, selected } : e))
        }
  );
}

function setAllExtras(items: PhotoReviewItem[], selected: boolean): PhotoReviewItem[] {
  return items.map((it) => ({
    ...it,
    extras: it.extras.map((e) => ({ ...e, selected }))
  }));
}

export function TemplatePhotoReviewPanel({
  items,
  busy,
  onChange,
  onRefresh,
  onApply
}: Props) {
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  const stats = useMemo(() => {
    let photos = 0;
    let selected = 0;
    for (const it of items) {
      photos += it.extras.length;
      selected += it.extras.filter((e) => e.selected).length;
    }
    return { rows: items.length, photos, selected };
  }, [items]);

  if (!items.length) {
    return (
      <section className={homeCard}>
        <div className={homeCardHeader}>
          <h2 className={homeCardTitle}>Проверка доп. фото</h2>
        </div>
        <div className={`${homeCardBody} space-y-3`}>
          <p className="text-sm text-slate-600">
            После этапа фото нажмите «Загрузить из шаблона» — покажем превью доп. фото с галочками,
            как в инструменте Летуаль.
          </p>
          <button type="button" className={homeBtnPrimary} disabled={busy} onClick={onRefresh}>
            Загрузить из шаблона
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className={homeCard}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-5">
        <h2 className={homeCardTitle}>
          Проверка доп. фото ({stats.rows} SKU · {stats.selected}/{stats.photos} отмечено)
        </h2>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
            disabled={busy}
            onClick={onRefresh}
          >
            Обновить
          </button>
          <button
            type="button"
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
            disabled={busy}
            onClick={() => onChange(setAllExtras(items, true))}
          >
            Выбрать все
          </button>
          <button
            type="button"
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
            disabled={busy}
            onClick={() => onChange(setAllExtras(items, false))}
          >
            Снять все
          </button>
          <button type="button" className={homeBtnPrimary} disabled={busy} onClick={onApply}>
            Применить к шаблону
          </button>
        </div>
      </div>
      <div className={`${homeCardBody} max-h-[70vh] space-y-3 overflow-y-auto`}>
        {items.map((it) => {
          const open = expanded[it.row] !== false;
          const name = it.productName || it.sku;
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
                    строка {it.row} · {it.sku}
                  </p>
                  <p className="mt-1 text-xs text-slate-600">
                    Главное фото + {it.extras.length} доп. · отмечено{" "}
                    {it.extras.filter((e) => e.selected).length}
                  </p>
                </div>
                <span className="text-xs text-slate-400">{open ? "▲" : "▼"}</span>
              </button>
              {open ? (
                <div className="mt-3 flex flex-wrap gap-3 border-t border-slate-100 pt-3">
                  {it.extras.length ? (
                    it.extras.map((ex) => (
                      <label
                        key={ex.url}
                        className={`flex w-28 flex-col items-center gap-1 rounded-lg border p-1 ${
                          ex.selected ? "border-emerald-300 bg-emerald-50/40" : "border-slate-200 opacity-70"
                        }`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={ex.url}
                          alt=""
                          className="h-24 w-full rounded object-contain bg-white"
                        />
                        <span className="flex items-center gap-1 text-xs text-slate-700">
                          <input
                            type="checkbox"
                            checked={ex.selected}
                            onChange={(e) =>
                              onChange(toggleExtra(items, it.row, ex.url, e.target.checked))
                            }
                          />
                          в витрину
                        </span>
                      </label>
                    ))
                  ) : (
                    <p className="text-xs text-slate-500">Нет доп. фото — только главное.</p>
                  )}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );

}
