"use client";

import { useCallback, useState } from "react";

export type InfographicPreviewItem = {
  row: number;
  brand: string;
  label: string;
  url: string;
};

type Props = {
  items: InfographicPreviewItem[];
  title?: string;
};

export function PodruzhkaInfographicPreview({ items, title = "Просмотр карточек" }: Props) {
  const [active, setActive] = useState<InfographicPreviewItem | null>(null);

  const close = useCallback(() => setActive(null), []);

  if (items.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-emerald-900">
          {title} ({items.length})
        </p>
        <p className="text-xs text-slate-600">Нажмите на карточку — откроется крупный просмотр</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {items.map((item) => (
          <button
            key={item.row}
            type="button"
            onClick={() => setActive(item)}
            className="group overflow-hidden rounded-lg border border-slate-200 bg-white text-left shadow-sm transition hover:border-emerald-400 hover:shadow-md"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={item.url}
              alt={item.label}
              className="aspect-[1024/1365] w-full object-cover"
            />
            <div className="px-2 py-1.5">
              <p className="truncate text-xs font-semibold text-slate-800">{item.brand}</p>
              <p className="truncate text-[11px] text-slate-500">строка {item.row}</p>
            </div>
          </button>
        ))}
      </div>

      {active ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={close}
          role="presentation"
        >
          <div
            className="relative max-h-[95vh] w-full max-w-3xl overflow-auto rounded-xl bg-white p-3 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={`Просмотр: ${active.label}`}
          >
            <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-slate-900">{active.brand}</p>
                <p className="text-xs text-slate-500">
                  строка {active.row} · {active.label}
                </p>
              </div>
              <div className="flex gap-2">
                <a
                  href={active.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Открыть в новой вкладке
                </a>
                <button
                  type="button"
                  onClick={close}
                  className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white"
                >
                  Закрыть
                </button>
              </div>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={active.url} alt={active.label} className="mx-auto max-h-[80vh] w-auto rounded-lg" />
          </div>
        </div>
      ) : null}
    </div>
  );
}
