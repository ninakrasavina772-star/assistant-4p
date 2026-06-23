"use client";

import Image from "next/image";
import { standAdminProductUrl } from "@/lib/productLinks";
import { normVariationSku } from "@/lib/templateGenerator/parseVariationIds";
import type { TemplateDuplicateGroup, TemplateDuplicateItem } from "@/lib/templateGenerator/templateDuplicates";

function TemplateDuplicateProductCard({
  item,
  marked
}: {
  item: TemplateDuplicateItem;
  marked: boolean;
}) {
  const variationId = normVariationSku(item.sku);
  const adminUrl = variationId != null ? standAdminProductUrl(variationId) : null;

  return (
    <div
      className={`flex gap-3 min-w-0 rounded-lg border p-2 ${
        marked ? "border-red-200 bg-red-50/80 opacity-70" : "border-slate-200 bg-white"
      }`}
    >
      <div className="relative w-20 h-20 flex-shrink-0 rounded-lg overflow-hidden bg-slate-100 border border-slate-200">
        {item.imageUrl ? (
          <Image
            src={item.imageUrl}
            alt=""
            width={80}
            height={80}
            className="object-contain w-full h-full"
            unoptimized
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-xs text-slate-400">
            нет фото
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        {item.brand ? (
          <p className="text-xs text-slate-400 truncate">{item.brand}</p>
        ) : null}
        <p
          className={`text-sm text-slate-800 font-medium line-clamp-2 ${marked ? "line-through" : ""}`}
        >
          {item.productName}
        </p>
        <p className="text-xs text-slate-600 mt-1 font-mono">
          SKU: {item.sku}
          {item.ean ? ` · EAN ${item.ean}` : ""}
        </p>
        <p className="text-[11px] text-slate-400 mt-0.5">строка {item.row}</p>
        {adminUrl ? (
          <a
            href={adminUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-sm text-indigo-800 hover:underline mt-1"
          >
            Админка
            <span aria-hidden>↗</span>
          </a>
        ) : null}
      </div>
    </div>
  );
}

type Props = {
  groups: TemplateDuplicateGroup[];
  rowsMarkedForRemoval: Set<number>;
  onToggleRemoval: (rowNumber: number) => void;
  onDownloadWithoutRemoved?: () => void;
  compact?: boolean;
};

export function TemplateDuplicatesPanel({
  groups,
  rowsMarkedForRemoval,
  onToggleRemoval,
  onDownloadWithoutRemoved,
  compact = false
}: Props) {
  if (!groups.length) return null;

  const markedCount = rowsMarkedForRemoval.size;

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-600">
        Как в «Сравнение витрин»: фото, название, EAN. Схлопните группу по заголовку. Лишние позиции
        можно убрать из шаблона — они не попадут в Excel при скачивании «без дублей».
      </p>
      <div className={`space-y-3 overflow-y-auto ${compact ? "max-h-[28rem]" : ""}`}>
        {groups.map((g) => {
          const groupMarked = g.rowNumbers.filter((r) => rowsMarkedForRemoval.has(r)).length;
          return (
            <details
              key={g.key + g.rowNumbers.join("-")}
              open
              className="rounded-xl border border-amber-200 bg-amber-50/30 group"
            >
              <summary className="cursor-pointer list-none px-4 py-3 flex flex-wrap items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
                <span className="text-sm font-semibold text-amber-950">{g.reason}</span>
                <span className="text-xs text-amber-900 tabular-nums">
                  {g.items.length} поз.
                  {groupMarked > 0 ? ` · к удалению: ${groupMarked}` : ""}
                  <span className="ml-2 text-slate-500 font-normal group-open:hidden">развернуть ▼</span>
                  <span className="ml-2 text-slate-500 font-normal hidden group-open:inline">свернуть ▲</span>
                </span>
              </summary>
              <div className="border-t border-amber-100 px-4 pb-4 pt-3">
                <div className="grid sm:grid-cols-1 md:grid-cols-2 gap-3">
                  {g.items.map((item) => {
                    const marked = rowsMarkedForRemoval.has(item.row);
                    return (
                      <div key={item.row} className="flex flex-col gap-2 min-w-0">
                        <TemplateDuplicateProductCard item={item} marked={marked} />
                        <button
                          type="button"
                          className={`self-end rounded border px-2 py-1 text-xs font-semibold ${
                            marked
                              ? "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                              : "border-red-200 bg-red-50 text-red-800 hover:bg-red-100"
                          }`}
                          onClick={() => onToggleRemoval(item.row)}
                        >
                          {marked ? "Вернуть в шаблон" : "Удалить товар из шаблона"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </details>
          );
        })}
      </div>
      {markedCount > 0 && onDownloadWithoutRemoved ? (
        <button
          type="button"
          className="rounded-lg border border-amber-600 bg-amber-400 px-4 py-2 text-sm font-bold text-slate-900 hover:bg-amber-300"
          onClick={() => onDownloadWithoutRemoved()}
        >
          Скачать шаблон без удалённых дублей ({markedCount})
        </button>
      ) : null}
    </div>
  );
}
