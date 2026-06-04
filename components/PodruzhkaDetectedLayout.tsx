"use client";

import type { AutoDetectResult } from "@/lib/podruzhkaAutoMapping";
import { PODRUZHKA_FIELD_LABELS, type PodruzhkaFieldKey } from "@/lib/podruzhkaColumnMapping";

type Props = {
  detection: AutoDetectResult;
  rowCount: number;
};

export function PodruzhkaDetectedLayout({ detection, rowCount }: Props) {
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
        <p className="font-semibold">Файл распознан — как в образце Подружка</p>
        <p className="mt-1 text-emerald-800/90">
          Сопоставлять колонки вручную не нужно: заголовки совпали с шаблоном. Строк товаров:{" "}
          <strong>{rowCount}</strong>.
        </p>
      </div>

      <table className="w-full text-sm border border-slate-200 rounded-lg overflow-hidden">
        <thead>
          <tr className="bg-slate-100 text-left">
            <th className="px-3 py-2">Куда на карточке</th>
            <th className="px-3 py-2">Колонка Excel</th>
          </tr>
        </thead>
        <tbody>
          {detection.feedColumns.map((c) => (
            <tr key={`${c.col}-${c.header}`} className="border-t border-slate-100">
              <td className="px-3 py-2 text-slate-800">{c.role}</td>
              <td className="px-3 py-2 font-mono text-slate-600">
                {c.header} (№{c.col})
              </td>
            </tr>
          ))}
          {detection.aiColumns.map((c) => (
            <tr key={`ai-${c.col}`} className="border-t border-slate-100 bg-violet-50/50">
              <td className="px-3 py-2 text-violet-900">
                {c.role}{" "}
                {c.header === "model" || c.header.startsWith("note") ? "— только AI, шаг 1" : ""}
              </td>
              <td className="px-3 py-2 font-mono text-violet-800">
                {c.header} (№{c.col})
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {detection.missing.length > 0 ? (
        <p className="text-sm text-red-700">
          Не найдены колонки:{" "}
          {detection.missing.map((k) => PODRUZHKA_FIELD_LABELS[k as PodruzhkaFieldKey]).join(", ")}.
          Сверьте с файлом <strong>образец.xlsx</strong>.
        </p>
      ) : null}
    </div>
  );
}
