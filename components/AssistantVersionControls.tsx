"use client";

import {
  type AssistantVersionPayload,
  ASSISTANT_FORCE_UPDATE_STORAGE_KEY,
  fetchAssistantVersion,
  forceUpdateAssistantVersion,
  formatBuildIdLabel,
  isAssistantVersionStale,
  isValidBuildId,
  readStoredClientRevision,
  softReloadAssistant,
  storeClientRevision
} from "@/lib/assistantVersion";
import { formatAssistantUpdatedAt } from "@/lib/assistantToolUpdates";
import { useCallback, useEffect, useRef, useState } from "react";

const POLL_MS = 15_000;

type UiMode = "hidden" | "modal" | "banner";

type Props = {
  /** Компактная панель на главной — сразу видны версии и кнопка */
  variant?: "floating" | "panel";
  className?: string;
};

/**
 * Контроль версии: опрос /api/version, предупреждение о рассинхроне,
 * принудительное обновление с очисткой кэша.
 */
export function AssistantVersionControls({ variant = "floating", className = "" }: Props) {
  const [mode, setMode] = useState<UiMode>("hidden");
  const [server, setServer] = useState<AssistantVersionPayload | null>(null);
  const [storedRevision, setStoredRevision] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dismissedRef = useRef(false);

  useEffect(() => {
    const url = new URL(window.location.href);
    for (const key of ["_refresh", "_fv"]) {
      if (!url.searchParams.has(key)) continue;
      url.searchParams.delete(key);
      const next = url.pathname + url.search + url.hash;
      window.history.replaceState({}, "", next);
      break;
    }
  }, []);

  const syncRevisionState = useCallback(() => {
    setStoredRevision(readStoredClientRevision());
  }, []);

  const checkVersion = useCallback(async () => {
    const data = await fetchAssistantVersion();
    if (!data?.ok) return;

    setServer(data);
    const stored = readStoredClientRevision();

    if (!stored) {
      storeClientRevision(data);
      syncRevisionState();
      setMode("hidden");
      return;
    }

    if (isAssistantVersionStale(stored, data)) {
      if (dismissedRef.current) {
        setMode("banner");
      } else {
        setMode("modal");
      }
      return;
    }

    storeClientRevision(data);
    syncRevisionState();
    setMode("hidden");
  }, [syncRevisionState]);


  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== ASSISTANT_FORCE_UPDATE_STORAGE_KEY || !event.newValue) return;
      void forceUpdateAssistantVersion(true);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    syncRevisionState();
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
  }, [checkVersion, syncRevisionState]);

  const hasUpdate =
    server != null && isAssistantVersionStale(storedRevision, server);

  const onForceUpdate = async () => {
    setBusy(true);
    await forceUpdateAssistantVersion();
  };

  const onSoftUpdate = () => {
    softReloadAssistant();
  };

  const dismissToBanner = () => {
    dismissedRef.current = true;
    setMode("banner");
  };

  const serverBuild = formatBuildIdLabel(server?.buildId);
  const clientBuild = formatBuildIdLabel(storedRevision);
  const serverTime =
    server?.buildTime && server.buildTime !== "dev"
      ? formatAssistantUpdatedAt(server.buildTime)
      : null;

  if (variant === "panel") {
    return (
      <section className={className} aria-label="Версия ассистента">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm ring-1 ring-slate-200/60 sm:p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-slate-900">Версия ассистента</h2>
              <p className="mt-1 text-sm leading-relaxed text-slate-600">
                Если у коллег другой интерфейс или старые карточки — нажмите принудительное
                обновление. Страница перезагрузится и подтянет свежий код с сервера.
              </p>
              <dl className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-2">
                <div className="rounded-lg bg-slate-50 px-3 py-2">
                  <dt className="font-medium text-slate-500">На сервере</dt>
                  <dd className="mt-0.5 font-semibold text-slate-900">{serverBuild}</dd>
                  {serverTime ? (
                    <dd className="mt-0.5 text-slate-500">{serverTime}</dd>
                  ) : null}
                </div>
                <div className="rounded-lg bg-slate-50 px-3 py-2">
                  <dt className="font-medium text-slate-500">У вас в браузере</dt>
                  <dd className="mt-0.5 font-semibold text-slate-900">{clientBuild}</dd>
                  {hasUpdate ? (
                    <dd className="mt-0.5 font-medium text-amber-700">Есть более новая версия</dd>
                  ) : (
                    <dd className="mt-0.5 text-emerald-700">Актуально</dd>
                  )}
                </div>
              </dl>
            </div>
            <div className="flex shrink-0 flex-col gap-2 sm:w-56">
              <button
                type="button"
                disabled={busy}
                onClick={() => void onForceUpdate()}
                className="inline-flex items-center justify-center rounded-xl bg-[#ffd740] px-4 py-3 text-sm font-semibold text-[#0a0a0a] shadow-sm ring-1 ring-black/5 transition hover:bg-[#f5cd38] disabled:opacity-60"
              >
                {busy ? "Обновляем…" : "Обновить версию принудительно"}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={onSoftUpdate}
                className="inline-flex items-center justify-center rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
              >
                Мягкое обновление
              </button>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <>
      <div className={`fixed bottom-4 right-4 z-[210] flex flex-col items-end gap-2 ${className}`}>
        {hasUpdate ? (
          <div className="max-w-xs rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 shadow-lg">
            На сервере новая версия ({serverBuild}). Обновите принудительно.
          </div>
        ) : null}
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void onForceUpdate()}
            title={
              hasUpdate
                ? "Сбросить кэш и загрузить новую версию с сервера"
                : "Принудительно подтянуть последнюю версию с сервера"
            }
            className={`flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-semibold shadow-lg ring-1 transition hover:scale-[1.02] disabled:opacity-60 ${
              hasUpdate
                ? "bg-[#ffd740] text-[#0a0a0a] ring-amber-300/80 animate-pulse"
                : "bg-white/95 text-slate-700 ring-slate-200/80 hover:bg-slate-50"
            }`}
          >
            <span aria-hidden className="text-sm leading-none">
              ↻
            </span>
            Обновить версию
            {hasUpdate ? (
              <span className="rounded-full bg-amber-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                new
              </span>
            ) : null}
          </button>
        </div>
      </div>

      {mode === "banner" ? (
        <div
          className="fixed bottom-0 left-0 right-0 z-[200] border-t border-amber-200/80 bg-amber-50 px-4 py-3 pr-4 shadow-lg sm:pr-44"
          role="status"
        >
          <div className="mx-auto flex max-w-3xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-slate-800">
              <span className="font-semibold">На сервере новая версия ассистента.</span> Нажмите
              «Обновить версию» справа внизу.
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() => void onForceUpdate()}
              className="shrink-0 rounded-lg bg-[#ffd740] px-4 py-2 text-sm font-semibold text-[#0a0a0a] shadow-sm ring-1 ring-black/5 transition hover:bg-[#f5cd38] sm:hidden disabled:opacity-60"
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
              Доступна новая версия
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              На сервере обновлён ассистент
              {isValidBuildId(server?.buildId) ? ` (${server?.buildId})` : ""}. Нажмите
              «Обновить версию принудительно», чтобы сбросить кэш браузера и подтянуть свежий
              интерфейс.
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
                disabled={busy}
                onClick={() => void onForceUpdate()}
                className="rounded-lg bg-[#ffd740] px-4 py-2.5 text-sm font-semibold text-[#0a0a0a] shadow-sm ring-1 ring-black/5 transition hover:bg-[#f5cd38] disabled:opacity-60"
              >
                {busy ? "Обновляем…" : "Обновить версию принудительно"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
