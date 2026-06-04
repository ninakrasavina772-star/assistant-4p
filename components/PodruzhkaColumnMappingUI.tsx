"use client";

import { homeInput } from "@/components/homeTheme";
import {
  PODRUZHKA_FIELD_HINTS,
  PODRUZHKA_FIELD_LABELS,
  REQUIRED_FEED_FIELDS,
  SOURCE_EXCEL_FIELDS,
  type ExcelHeaderOption,
  type PodruzhkaColumnMapping,
  type PodruzhkaFieldKey
} from "@/lib/podruzhkaColumnMapping";
import { PODRUZHKA_SAMPLE_COLUMNS } from "@/lib/podruzhkaSampleLayout";
import { PODRUZHKA_AI_COLUMN_DEFS } from "@/lib/podruzhkaTypes";

type Props = {
  mapping: PodruzhkaColumnMapping;
  headers: ExcelHeaderOption[];
  aiColumns?: { key: string; header: string; col: number }[];
  onChange: (field: PodruzhkaFieldKey, col: number | undefined) => void;
};

export function PodruzhkaColumnMappingUI({
  mapping,
  headers,
  aiColumns,
  onChange
}: Props) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-sky-200 bg-sky-50/80 px-4 py-3 text-sm text-sky-950">
        <p className="font-semibold mb-1">Как это работает</p>
        <ol className="list-decimal list-inside space-y-1 text-sky-900/90">
          <li>
            Ниже вы один раз указываете, <strong>какая колонка вашего Excel</strong> — бренд, фото,
            объём и т.д.
          </li>
          <li>
            <strong>model, note 1–3</strong> — только AI по образцу (заголовок ЗАГЛАВНЫМИ + описание,
            как «ПРЯНЫЙ пикантный характер»). Вручную не заполняйте.
          </li>
          <li>Шаг 2 соберёт картинку как в файле <strong>образец.xlsx</strong>.</li>
        </ol>
      </div>

      <details className="rounded-lg border border-slate-200 text-xs">
        <summary className="cursor-pointer px-3 py-2 font-semibold text-slate-700">
          Эталонная структура Excel (образец)
        </summary>
        <ul className="px-3 pb-3 space-y-1 text-slate-600">
          {PODRUZHKA_SAMPLE_COLUMNS.map((c) => (
            <li key={c.header}>
              <strong>{c.header}</strong> — {c.role}
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
            {SOURCE_EXCEL_FIELDS.map((field) => (
              <tr key={field} className="border-t border-slate-100">
                <td className="px-3 py-3 align-top">
                  <span className="font-medium text-slate-800">
                    {PODRUZHKA_FIELD_LABELS[field]}
                    {REQUIRED_FEED_FIELDS.includes(field) ? (
                      <span className="text-red-600"> *</span>
                    ) : null}
                  </span>
                  <p className="text-xs text-slate-500 mt-0.5">{PODRUZHKA_FIELD_HINTS[field]}</p>
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
                    <option value="">— выберите столбец —</option>
                    {headers.map((h) => (
                      <option key={h.col} value={h.col}>
                        {h.label} (столбец {h.col})
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
            <tr className="border-t border-slate-200 bg-violet-50/60">
              <td className="px-3 py-3 align-top" colSpan={2}>
                <p className="font-semibold text-violet-900">Создаёт AI (не выбирать вручную)</p>
                <ul className="mt-2 text-xs text-violet-900/90 space-y-1">
                  {PODRUZHKA_AI_COLUMN_DEFS.filter((d) => !d.optional).map((d) => {
                    const found = aiColumns?.find((c) => c.key === d.key);
                    return (
                      <li key={d.key}>
                        <strong>{d.header}</strong>
                        {found ? ` — столбец ${found.col}` : " — создастся при сохранении / шаге 1"}
                      </li>
                    );
                  })}
                </ul>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
