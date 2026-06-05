"use client";

import { homeInput } from "@/components/homeTheme";
import {
  COSMETICS_REQUIRED_FEED_FIELDS,
  COSMETICS_SOURCE_EXCEL_FIELDS,
  PODRUZHKA_COSMETICS_FIELD_HINTS,
  PODRUZHKA_COSMETICS_FIELD_LABELS,
  type ExcelHeaderOption,
  type PodruzhkaCosmeticsColumnMapping,
  type PodruzhkaCosmeticsFieldKey
} from "@/lib/podruzhkaCosmeticsColumnMapping";
import { PODRUZHKA_COSMETICS_AI_COLUMN_DEFS } from "@/lib/podruzhkaCosmeticsTypes";

type Props = {
  mapping: PodruzhkaCosmeticsColumnMapping;
  headers: ExcelHeaderOption[];
  textColumns?: { key: string; header: string; col: number }[];
  onChange: (field: PodruzhkaCosmeticsFieldKey, col: number | undefined) => void;
};

export function PodruzhkaCosmeticsColumnMappingUI({
  mapping,
  headers,
  textColumns,
  onChange
}: Props) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-sky-200 bg-sky-50/80 px-4 py-3 text-sm text-sky-950">
        <p className="font-semibold mb-1">Как это работает</p>
        <ol className="list-decimal list-inside space-y-1 text-sky-900/90">
          <li>
            Ниже вы один раз указываете колонки Excel: <strong>brand name</strong>,{" "}
            <strong>name</strong>, <strong>product_type</strong>, <strong>foto</strong>. Объём не
            нужен.
          </li>
          <li>
            <strong>model</strong> и <strong>benefit 1–3</strong> — заполняет AI (шаг 1) или вручную
            в Excel.
          </li>
          <li>Скачайте Excel после шага 1, при необходимости загрузите исправленный файл → шаг 2.</li>
        </ol>
      </div>

      <details className="rounded-lg border border-slate-200 text-xs">
        <summary className="cursor-pointer px-3 py-2 font-semibold text-slate-700">
          Столбцы текстов на карточке (косметика)
        </summary>
        <ul className="px-3 pb-3 space-y-1 text-slate-600">
          {PODRUZHKA_COSMETICS_AI_COLUMN_DEFS.map((c) => (
            <li key={c.key}>
              <strong>{c.header}</strong>
              {c.optional ? " (необязательно)" : ""}
            </li>
          ))}
        </ul>
      </details>

      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-100 text-left">
              <th className="px-3 py-2 font-semibold text-slate-800">На инфографике</th>
              <th className="px-3 py-2 font-semibold text-slate-800">Колонка в вашем Excel</th>
            </tr>
          </thead>
          <tbody>
            {COSMETICS_SOURCE_EXCEL_FIELDS.map((field) => (
              <tr key={field} className="border-t border-slate-100">
                <td className="px-3 py-3 align-top">
                  <span className="font-medium text-slate-800">
                    {PODRUZHKA_COSMETICS_FIELD_LABELS[field]}
                    {COSMETICS_REQUIRED_FEED_FIELDS.includes(field) ? (
                      <span className="text-red-600"> *</span>
                    ) : null}
                  </span>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {PODRUZHKA_COSMETICS_FIELD_HINTS[field]}
                  </p>
                </td>
                <td className="px-3 py-3">
                  <select
                    className={homeInput}
                    value={mapping[field] ?? ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      onChange(field, v ? Number(v) : undefined);
                    }}
                  >
                    <option value="">— не выбрано —</option>
                    {headers.map((h) => (
                      <option key={h.col} value={h.col}>
                        {h.label} (№{h.col})
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {textColumns && textColumns.length > 0 ? (
        <p className="text-xs text-violet-800 bg-violet-50 rounded-lg px-3 py-2">
          Найдены столбцы текстов: {textColumns.map((c) => `${c.header} (${c.col})`).join(", ")}
        </p>
      ) : null}
    </div>
  );
}
