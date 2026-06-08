"use client";

import { useState } from "react";

type Variant = "perfume" | "cosmetics";

type Props = {
  variant: Variant;
};

type ExampleCol = {
  header: string;
  sample: string;
  required?: boolean;
  note?: string;
};

const PERFUME_FEED: ExampleCol[] = [
  { header: "brand name", sample: "CHANEL", required: true, note: "крупно вверху" },
  { header: "product_type", sample: "парфюмерная вода", required: true, note: "серая строка" },
  { header: "product name", sample: "Coco Mademoiselle", required: true, note: "для AI" },
  { header: "name", sample: "CHANEL Coco Mademoiselle EDP жен.", required: true, note: "полное SKU" },
  { header: "ml", sample: "100", required: true, note: "внизу карточки" },
  {
    header: "foto",
    sample: "https://…/product.jpg",
    required: true,
    note: "ссылка JPG/PNG"
  },
  { header: "id", sample: "12345678", note: "id товара 4Partners — необязательно" }
];

const PERFUME_AI: ExampleCol[] = [
  { header: "model", sample: "Coco Mademoiselle", note: "AI или вручную" },
  { header: "note 1", sample: "ЦВЕТОЧНЫЙ", note: "заголовок, КАПС" },
  { header: "note 1 (2)", sample: "нежный и женственный", note: "описание" },
  { header: "note 2", sample: "СТОЙКИЙ", note: "" },
  { header: "note 2 (1)", sample: "дольше держится на коже", note: "" },
  { header: "note 3", sample: "УНИВЕРСАЛЬНЫЙ", note: "" },
  { header: "note 3 (1)", sample: "на каждый день", note: "" },
  { header: "статус нот", sample: "ok", note: "комментарий AI" },
  { header: "foto 2", sample: "(после шага 2)", note: "ссылка на готовую карточку" }
];

const COSMETICS_FEED: ExampleCol[] = [
  { header: "brand name", sample: "DIOR", required: true },
  { header: "product_type", sample: "тени для век", required: true },
  { header: "name", sample: "DIOR Show Mono 001 Backstage", required: true },
  {
    header: "foto",
    sample: "https://…/product.jpg",
    required: true,
    note: "исходное фото"
  },
  { header: "product name", sample: "Show Mono", note: "необязательно" },
  { header: "id", sample: "tpv_482910", note: "артикул вариации — необязательно" }
];

const COSMETICS_AI: ExampleCol[] = [
  { header: "model", sample: "Show Mono", note: "AI или вручную" },
  { header: "benefit 1", sample: "СИЯНИЕ", note: "заголовок, КАПС" },
  { header: "benefit 1 (2)", sample: "придаёт глазам яркий блеск", note: "описание" },
  { header: "benefit 2", sample: "НАСЫЩЕННОСТЬ", note: "" },
  { header: "benefit 2 (1)", sample: "интенсивный цвет с первого нанесения", note: "" },
  { header: "benefit 3", sample: "ЛЁГКОСТЬ", note: "" },
  { header: "benefit 3 (1)", sample: "комфортное нанесение и растушёвка", note: "" },
  { header: "статус свойств", sample: "ok", note: "комментарий AI" },
  { header: "foto 2", sample: "(после шага 2)", note: "ссылка на готовую карточку" }
];

function ExampleTable({ title, cols }: { title: string; cols: ExampleCol[] }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p>
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="min-w-full text-left text-xs">
          <thead className="bg-slate-100 text-slate-600">
            <tr>
              <th className="px-3 py-2 font-semibold">Колонка Excel</th>
              <th className="px-3 py-2 font-semibold">Пример значения</th>
              <th className="px-3 py-2 font-semibold">Зачем</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {cols.map((col) => (
              <tr key={col.header}>
                <td className="px-3 py-2 font-mono text-slate-800">
                  {col.header}
                  {col.required ? (
                    <span className="ml-1 text-rose-600" title="обязательно в фиде">
                      *
                    </span>
                  ) : null}
                </td>
                <td className="px-3 py-2 text-slate-700">{col.sample}</td>
                <td className="px-3 py-2 text-slate-500">{col.note ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function PodruzhkaExcelExample({ variant }: Props) {
  const [open, setOpen] = useState(false);
  const isPerfume = variant === "perfume";

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/80">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-semibold text-slate-800"
      >
        <span>Пример заполнения Excel — какие колонки нужны</span>
        <span className="text-slate-500">{open ? "▲" : "▼"}</span>
      </button>
      {open ? (
        <div className="space-y-4 border-t border-slate-200 px-4 py-4">
          <p className="text-sm text-slate-600">
            {isPerfume ? (
              <>
                В файле до AI нужны колонки фида (<span className="text-rose-600">*</span>).
                Столбцы model и note 1–3 можно заполнить AI или вручную — тогда сразу шаг 2.
              </>
            ) : (
              <>
                В файле до AI нужны brand name, product_type, name и foto. Объём (ml) на карточке
                не показывается. benefit 1–3 — через AI или вручную.
              </>
            )}
          </p>
          <ExampleTable
            title={isPerfume ? "Колонки из вашего фида (до AI)" : "Колонки из фида (до AI)"}
            cols={isPerfume ? PERFUME_FEED : COSMETICS_FEED}
          />
          <ExampleTable
            title={isPerfume ? "Добавляются после AI / для инфографики" : "Добавляются после AI / для инфографики"}
            cols={isPerfume ? PERFUME_AI : COSMETICS_AI}
          />
        </div>
      ) : null}
    </div>
  );
}
