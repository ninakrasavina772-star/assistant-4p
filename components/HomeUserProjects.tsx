"use client";

import { useCallback, useEffect, useState } from "react";
import {
  homeBtnPrimary,
  homeCard,
  homeCardBody,
  homeCardHeader,
  homeCardTitle,
  homeInput
} from "@/components/homeTheme";

const STORAGE_KEY = "assistant_user_projects_v1";

export type UserProject = {
  id: string;
  title: string;
  kind: "work" | "waiting";
  url?: string;
};

function loadProjects(): UserProject[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr
      .map((x) => {
        if (!x || typeof x !== "object") return null;
        const o = x as Record<string, unknown>;
        const id = typeof o.id === "string" ? o.id : "";
        const title = typeof o.title === "string" ? o.title.trim() : "";
        const kind = o.kind === "waiting" ? "waiting" : "work";
        const url = typeof o.url === "string" && o.url.trim() ? o.url.trim() : undefined;
        if (!id || !title) return null;
        return { id, title, kind, url } as UserProject;
      })
      .filter((x): x is UserProject => x != null);
  } catch {
    return [];
  }
}

function saveProjects(list: UserProject[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // ignore
  }
}

const sublabel = "text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500";
const listRow =
  "flex items-start justify-between gap-3 border-b border-slate-100 py-3 last:border-b-0 first:pt-0 sm:px-0";

export function HomeUserProjects() {
  const [list, setList] = useState<UserProject[]>([]);
  const [mounted, setMounted] = useState(false);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<"work" | "waiting">("work");
  const [url, setUrl] = useState("");

  useEffect(() => {
    setMounted(true);
    setList(loadProjects());
  }, []);

  const persist = useCallback((next: UserProject[]) => {
    setList(next);
    saveProjects(next);
  }, []);

  const add = useCallback(() => {
    const t = title.trim();
    if (!t) return;
    const id =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : String(Date.now());
    const u = url.trim();
    const next: UserProject = {
      id,
      title: t,
      kind,
      url: kind === "work" && u ? u : undefined
    };
    persist([next, ...list]);
    setTitle("");
    setUrl("");
    setKind("work");
  }, [title, kind, url, list, persist]);

  const remove = useCallback(
    (id: string) => {
      persist(list.filter((p) => p.id !== id));
    },
    [list, persist]
  );

  const work = list.filter((p) => p.kind === "work");
  const wait = list.filter((p) => p.kind === "waiting");

  if (!mounted) {
    return (
      <div className={homeCard} aria-hidden>
        <div className={homeCardHeader}>
          <h2 className={homeCardTitle}>Мои проекты</h2>
        </div>
        <div className={`${homeCardBody} text-sm text-slate-400`}>Загрузка…</div>
      </div>
    );
  }

  return (
    <div className={homeCard}>
      <div className={homeCardHeader}>
        <h2 className={homeCardTitle}>Мои проекты</h2>
      </div>
      <div className={`${homeCardBody} border-b border-slate-100`}>
        <p className="text-xs leading-relaxed text-slate-500 sm:text-sm">
          Заметки для себя: «в работе» — сейчас; «ожидаются» — планы. Ссылка
          опциональна. Сохраняется только в этом браузере.
        </p>
      </div>

      <form
        className="border-b border-slate-100 bg-slate-50/30 px-4 py-4 sm:px-5"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <label className="block min-w-0 flex-1 sm:min-w-[12rem]">
            <span className={sublabel}>Название</span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={120}
              placeholder="Например: выгрузка бренда"
              className={`${homeInput} mt-1.5`}
            />
          </label>
          <label className="block w-full min-w-0 sm:w-44">
            <span className={sublabel}>Статус</span>
            <select
              value={kind}
              onChange={(e) =>
                setKind(e.target.value === "waiting" ? "waiting" : "work")
              }
              className={`${homeInput} mt-1.5`}
            >
              <option value="work">В работе</option>
              <option value="waiting">Ожидаются</option>
            </select>
          </label>
          {kind === "work" && (
            <label className="block min-w-0 flex-1 sm:min-w-[12rem]">
              <span className={sublabel}>Ссылка</span>
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://…"
                className={`${homeInput} mt-1.5`}
              />
            </label>
          )}
          <button
            type="submit"
            className={`${homeBtnPrimary} w-full sm:w-auto sm:shrink-0`}
          >
            Добавить
          </button>
        </div>
      </form>

      <div className={homeCardBody + " grid gap-0 sm:grid-cols-2 sm:gap-0"}>
        <div className="sm:border-r sm:border-slate-100 sm:pr-4">
          <h3
            className={
              sublabel + " mb-0 flex items-center gap-2 text-emerald-700/90"
            }
          >
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            В работе
            <span className="font-normal text-slate-400">({work.length})</span>
          </h3>
          {work.length === 0 ? (
            <p className="mt-2 text-xs text-slate-400">Пока пусто</p>
          ) : (
            <ul className="mt-1">
              {work.map((p) => (
                <li key={p.id} className={listRow}>
                  <div className="min-w-0 pr-1">
                    {p.url ? (
                      <a
                        href={p.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-medium text-slate-800 underline decoration-slate-200 underline-offset-2 transition hover:decoration-amber-500"
                      >
                        {p.title}
                      </a>
                    ) : (
                      <span className="text-sm font-medium text-slate-800">
                        {p.title}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => remove(p.id)}
                    className="shrink-0 rounded p-1 text-slate-400 transition hover:bg-slate-100 hover:text-red-600"
                    aria-label="Удалить"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="mt-5 border-t border-slate-100 pt-5 sm:mt-0 sm:border-0 sm:border-t-0 sm:pt-0 sm:pl-4">
          <h3
            className={sublabel + " mb-0 flex items-center gap-2 text-amber-800/80"}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
            Ожидаются
            <span className="font-normal text-slate-400">({wait.length})</span>
          </h3>
          {wait.length === 0 ? (
            <p className="mt-2 text-xs text-slate-400">Пока пусто</p>
          ) : (
            <ul className="mt-1">
              {wait.map((p) => (
                <li key={p.id} className={listRow}>
                  <span className="text-sm font-medium text-slate-500">
                    {p.title}
                  </span>
                  <button
                    type="button"
                    onClick={() => remove(p.id)}
                    className="shrink-0 rounded p-1 text-slate-400 transition hover:bg-slate-100 hover:text-red-600"
                    aria-label="Удалить"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
