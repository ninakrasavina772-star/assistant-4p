"use client";

import { hardReloadAssistant } from "@/lib/hardReloadAssistant";
import { useCallback, useEffect, useRef, useState } from "react";

const STORAGE_KEY = "assistant-4p-build-id";
const POLL_MS = 30_000;

type VersionPayload = {
  ok?: boolean;
  buildId?: string;
  buildTime?: string;
};

type UiMode = "hidden" | "modal" | "banner";

/**
 * Новая сборка — модалка или полоска. Кнопка «Обновить» всегда в углу экрана.
 */
export function AssistantUpdateNotifier() {
  const [mode, setMode] = useState<UiMode>("hidden");
  const [pendingBuildId, setPendingBuildId] = useState<string | null>(null);
  const [buildTime, setBuildTime] = useState<string | null>(null);
  const dismissedRef = useRef(false);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("_refresh")) return;
    url.searchParams.delete("_refresh");
    const next = url.pathname + url.search + url.hash;
    window.history.replaceState({}, "", next);
  }, []);

  const checkVersion = useCallback(async () => {
    try {
      const res = await fetch("/api/version", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as VersionPayload;
      const buildId = data.buildId?.trim();
      if (data.buildTime?.trim() && data.buildTime !== "dev") {
        setBuildTime(data.buildTime.trim());
      }
      if (!data.ok || !buildId) return;

      const stored = sessionStorage.getItem(STORAGE_KEY);
      if (stored && stored !== buildId) {
        setPendingBuildId(buildId);
        if (dismissedRef.current) {
          setMode("banner");
        } else {
          setMode("modal");
        }
        return;
      }
      if (!stored) {
        sessionStorage.setItem(STORAGE_KEY, buildId);
      }
      setPendingBuildId(null);
      setMode("hidden");
    } catch {
      // сервер спит / сеть
    }
  }, []);

  useEffect(() => {
    void checkVersion();
    const timer = window.setInterval(() => void checkVersion(), POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void checkVersion();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [checkVersion]);

  const acceptRefresh = () => {
    hardReloadAssistant(true);
  };

  const dismissToBanner = () => {
    dismissedRef.current = true;
    setMode("banner");
  };

  const hasUpdate = pendingBuildId != null;

  return (
    <>
      <button
        type="button"
        onClick={acceptRefresh}
        title={
          hasUpdate
            ? "Загрузить новую версию ассистента"
            : buildTime
              ? `Обновить страницу · сборка ${buildTime}`
              : "Обновить страницу и подтянуть последнюю версию"
        }
        className={`fixed bottom-4 right-4 z-[210] flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-semibold shadow-lg ring-1 transition hover:scale-[1.02] ${
          hasUpdate
            ? "bg-[#ffd740] text-[#0a0a0a] ring-amber-300/80 animate-pulse"
            : "bg-white/95 text-slate-700 ring-slate-200/80 hover:bg-slate-50"
        }`}
      >
        <span aria-hidden className="text-sm leading-none">
          ↻
        </span>
        Обновить
        {hasUpdate ? (
          <span className="rounded-full bg-amber-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
            new
          </span>
        ) : null}
      </button>

      {mode === "banner" ? (
        <div
          className="fixed bottom-0 left-0 right-0 z-[200] border-t border-amber-200/80 bg-amber-50 px-4 py-3 pr-28 shadow-lg"
          role="status"
        >
          <div className="mx-auto flex max-w-3xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-slate-800">
              <span className="font-semibold">Были изменения в ассистенте.</span>{" "}
              Нажмите «Обновить» справа внизу, когда будете готовы.
            </p>
            <button
              type="button"
              onClick={acceptRefresh}
              className="shrink-0 rounded-lg bg-[#ffd740] px-4 py-2 text-sm font-semibold text-[#0a0a0a] shadow-sm ring-1 ring-black/5 transition hover:bg-[#f5cd38] sm:hidden"
            >
              Обновить сейчас
            </button>
          </div>
        </div>
      ) : null}

      {mode === "modal" ? (
        <div
          className="fixed inset-0 z-[205] flex items-center justify-center bg-black/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="assistant-update-title"
        >
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl ring-1 ring-slate-200/60">
            <h2
              id="assistant-update-title"
              className="text-lg font-semibold tracking-tight text-slate-900"
            >
              Были изменения в ассистенте
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              Вышла новая версия. Можно обновить сейчас или доделать задачу — кнопка «Обновить»
              останется справа внизу.
            </p>
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={dismissToBanner}
                className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              >
                Сначала доделаю
              </button>
              <button
                type="button"
                onClick={acceptRefresh}
                className="rounded-lg bg-[#ffd740] px-4 py-2.5 text-sm font-semibold text-[#0a0a0a] shadow-sm ring-1 ring-black/5 transition hover:bg-[#f5cd38]"
              >
                Обновить сейчас
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
