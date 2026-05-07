"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { FpRubric } from "@/lib/fourpartners";

const MIN_TOKEN = 12;

type Props = {
  label: string;
  token: string;
  value: string;
  onChange: (rubricId: string) => void;
  disabled?: boolean;
};

async function postRubrics(
  token: string,
  parentId: number | null
): Promise<FpRubric[]> {
  const res = await fetch("/api/rubrics", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, parentId })
  });
  const j = (await res.json().catch(() => ({}))) as {
    rubrics?: FpRubric[];
    error?: string;
  };
  if (!res.ok) {
    throw new Error(j.error || `Ошибка ${res.status}`);
  }
  return j.rubrics ?? [];
}

type PathItem = { id: number; name: string; isLeaf: boolean };

/**
 * Кнопка + колонки вправо: наведение раскрывает дочерние рубрики, клик по строке
 * фиксирует id этой рубрики (любой уровень, не только лист) и закрывает панель.
 */
export function RubricCascadeSelect({
  label,
  token,
  value,
  onChange,
  disabled
}: Props) {
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const canLoad = !disabled && token.trim().length >= MIN_TOKEN;
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [columns, setColumns] = useState<FpRubric[][]>([]);
  const [pathStack, setPathStack] = useState<PathItem[]>([]);
  const cache = useRef<Map<string, FpRubric[]>>(new Map());

  const key = (parent: number | null) => (parent == null ? "root" : String(parent));

  const resetCache = useCallback(() => {
    cache.current = new Map();
  }, []);

  const fetchList = useCallback(
    async (parent: number | null) => {
      const k = key(parent);
      if (cache.current.has(k)) return cache.current.get(k)!;
      setLoading(true);
      setErr(null);
      try {
        const list = await postRubrics(token.trim(), parent);
        cache.current.set(k, list);
        return list;
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Ошибка");
        return [];
      } finally {
        setLoading(false);
      }
    },
    [token]
  );

  useEffect(() => {
    if (!open || !canLoad) return;
    let dead = false;
    setPathStack([]);
    setErr(null);
    void (async () => {
      const main = await fetchList(null);
      if (dead) return;
      setColumns(main.length > 0 ? [main] : []);
    })();
    return () => {
      dead = true;
    };
  }, [open, canLoad, fetchList]);

  /** Клик: зафиксировать эту рубрику и закрыть (в т.ч. промежуточный уровень). */
  const commitSelection = useCallback(
    (colIndex: number, r: FpRubric) => {
      if (!canLoad) return;
      onChange(String(r.id));
      setPathStack((prev) => [
        ...prev.slice(0, colIndex),
        { id: r.id, name: r.name, isLeaf: r.is_leaf }
      ]);
      setOpen(false);
    },
    [canLoad, onChange]
  );

  const onRowEnter = useCallback(
    (colIndex: number, r: FpRubric) => {
      setPathStack((prev) => [
        ...prev.slice(0, colIndex),
        { id: r.id, name: r.name, isLeaf: r.is_leaf }
      ]);
      if (r.is_leaf) return;
      void (async () => {
        const ch = await fetchList(r.id);
        setColumns((prev) => {
          const next = prev.slice(0, colIndex + 1);
          if (ch.length > 0) return [...next, ch];
          return next;
        });
      })();
    },
    [fetchList]
  );

  const onRowClick = useCallback(
    (colIndex: number, r: FpRubric) => {
      commitSelection(colIndex, r);
    },
    [commitSelection]
  );

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!canLoad) {
      setColumns([]);
      setPathStack([]);
      setOpen(false);
      resetCache();
    }
  }, [canLoad, resetCache, token]);

  const idOk = value.trim() !== "" && Number(value) > 0;
  const pathText =
    pathStack.length > 0
      ? pathStack.map((p) => p.name).join(" → ")
      : idOk
        ? `id ${value}`
        : "— выберите рубрику —";

  return (
    <div className="block" ref={rootRef}>
      <span className="text-xs font-medium text-slate-500">{label}</span>
      {!disabled && !canLoad && (
        <p className="text-[11px] text-amber-800 mt-1">
          Вставьте ключ API ({MIN_TOKEN}+ симв.) — список рубрик относится к этому
          ключу.
        </p>
      )}
      {canLoad && err && !open && (
        <p className="text-xs text-red-600 mt-1">{err}</p>
      )}

      <div className="relative mt-2">
        <button
          type="button"
          id={listboxId}
          disabled={disabled || (canLoad && loading && open && columns.length === 0)}
          onClick={() => {
            if (!canLoad) return;
            setOpen((o) => !o);
          }}
          className="flex w-full min-h-[42px] items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm shadow-sm transition hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <span
            className={`min-w-0 flex-1 truncate ${
              pathStack.length > 0 || idOk ? "text-slate-900" : "text-slate-400"
            }`}
            title={pathText}
          >
            {pathText}
          </span>
          <span className="shrink-0 text-slate-500" aria-hidden>
            {open ? "▴" : "▾"}
          </span>
        </button>

        {open && canLoad && (
          <div
            className="absolute left-0 z-50 mt-1 max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 bg-white py-0 shadow-lg"
            role="listbox"
            aria-labelledby={listboxId}
          >
            {err && open && (
              <p className="border-b border-red-100 px-3 py-2 text-xs text-red-600">
                {err}
              </p>
            )}
            {loading && columns.length === 0 && (
              <p className="px-3 py-3 text-sm text-slate-500">Загрузка…</p>
            )}
            {columns.length > 0 && (
              <div className="flex max-h-72 w-max min-w-0 max-w-full overflow-x-auto overflow-y-hidden sm:max-w-none">
                {columns.map((list, colIndex) => (
                  <ul
                    key={colIndex}
                    className="min-w-[200px] max-w-[260px] overflow-y-auto border-r border-slate-100 last:border-r-0"
                    style={{ maxHeight: "18rem" }}
                  >
                    {list.map((r) => {
                      const activeHere = pathStack[colIndex]?.id === r.id;
                      return (
                        <li key={r.id}>
                          <button
                            type="button"
                            className={`flex w-full items-center justify-between gap-2 px-2.5 py-2 text-left text-sm ${
                              activeHere
                                ? "bg-slate-100 text-slate-900"
                                : "text-slate-800 hover:bg-slate-50"
                            }`}
                            onPointerEnter={() => onRowEnter(colIndex, r)}
                            onClick={() => onRowClick(colIndex, r)}
                          >
                            <span className="min-w-0 flex-1 break-words">
                              {r.name}
                            </span>
                            {!r.is_leaf && (
                              <span className="shrink-0 text-slate-400" aria-hidden>
                                ›
                              </span>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ))}
              </div>
            )}
            {columns.length === 0 && !loading && canLoad && !err && (
              <p className="px-3 py-2 text-sm text-slate-500">Нет рубрик</p>
            )}
            <p className="border-t border-slate-100 px-2.5 py-1.5 text-[10px] text-slate-500">
              Подсказка: наведение открывает колонку справа; клик по строке — выбрать
              эту рубрику (любой уровень, не обязательно конечную) и закрыть список.
            </p>
          </div>
        )}
      </div>

      {idOk && (
        <p className="text-[11px] text-slate-500 mt-1 font-mono">id: {value}</p>
      )}
    </div>
  );
}
