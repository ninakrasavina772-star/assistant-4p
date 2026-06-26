/** Версия ассистента: опрос сервера, сравнение с клиентом, принудительное обновление. */

export const ASSISTANT_BUILD_STORAGE_KEY = "assistant-4p-build-id";
export const ASSISTANT_REVISION_STORAGE_KEY = "assistant-4p-content-revision";
export const ASSISTANT_FORCE_UPDATE_STORAGE_KEY = "assistant-4p-force-update-ts";

const INVALID_BUILD_IDS = new Set(["", "local", "dev", "unknown"]);

export type AssistantVersionPayload = {
  ok?: boolean;
  buildId?: string;
  buildTime?: string;
  contentRevision?: string;
  toolUpdates?: Record<string, { updatedAt: string; note?: string }>;
};

export function isValidBuildId(buildId: string | undefined | null): buildId is string {
  const id = buildId?.trim();
  return Boolean(id && !INVALID_BUILD_IDS.has(id));
}

export function formatBuildIdLabel(buildId: string | undefined | null): string {
  const id = buildId?.trim();
  if (!id) return "—";
  if (INVALID_BUILD_IDS.has(id)) return "не задана";
  return id;
}

export async function fetchAssistantVersion(): Promise<AssistantVersionPayload | null> {
  try {
    const res = await fetch("/api/version", {
      cache: "no-store",
      headers: {
        "Cache-Control": "no-cache, no-store, must-revalidate",
        Pragma: "no-cache"
      }
    });
    if (!res.ok) return null;
    return (await res.json()) as AssistantVersionPayload;
  } catch {
    return null;
  }
}

export function readStoredClientRevision(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return (
      sessionStorage.getItem(ASSISTANT_REVISION_STORAGE_KEY)?.trim() ||
      sessionStorage.getItem(ASSISTANT_BUILD_STORAGE_KEY)?.trim() ||
      null
    );
  } catch {
    return null;
  }
}

export function storeClientRevision(data: AssistantVersionPayload): void {
  if (typeof window === "undefined") return;
  try {
    const revision = data.contentRevision?.trim();
    const buildId = data.buildId?.trim();
    if (revision) sessionStorage.setItem(ASSISTANT_REVISION_STORAGE_KEY, revision);
    if (buildId) sessionStorage.setItem(ASSISTANT_BUILD_STORAGE_KEY, buildId);
  } catch {
    /* ignore */
  }
}

export function clearClientVersionMarkers(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(ASSISTANT_BUILD_STORAGE_KEY);
    sessionStorage.removeItem(ASSISTANT_REVISION_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function isAssistantVersionStale(
  storedRevision: string | null,
  server: AssistantVersionPayload | null
): boolean {
  if (!server?.ok) return false;
  const serverRevision = server.contentRevision?.trim();
  if (serverRevision) {
    if (!storedRevision) return false;
    return storedRevision !== serverRevision;
  }
  const serverBuildId = server.buildId?.trim();
  if (!isValidBuildId(serverBuildId)) return false;
  if (!storedRevision) return false;
  return storedRevision !== serverBuildId;
}

/** Жёсткое обновление: сброс маркеров версии, кэшей и перезагрузка без кэша. */
export async function forceUpdateAssistantVersion(fromBroadcast = false): Promise<void> {
  if (typeof window === "undefined") return;

  if (!fromBroadcast) {
    try {
      localStorage.setItem(ASSISTANT_FORCE_UPDATE_STORAGE_KEY, String(Date.now()));
    } catch {
      /* ignore */
    }
  }

  clearClientVersionMarkers();

  try {
    const keys = Object.keys(sessionStorage);
    for (const key of keys) {
      if (
        key.startsWith("assistant-4p-") ||
        key.startsWith("fp_template_gen_") ||
        key.startsWith("fp_tpl_")
      ) {
        sessionStorage.removeItem(key);
      }
    }
  } catch {
    /* ignore */
  }

  if ("caches" in window) {
    try {
      const names = await caches.keys();
      await Promise.all(names.map((name) => caches.delete(name)));
    } catch {
      /* ignore */
    }
  }

  if ("serviceWorker" in navigator) {
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((reg) => reg.unregister()));
    } catch {
      /* ignore */
    }
  }

  try {
    await fetch("/api/version", {
      cache: "reload",
      headers: {
        "Cache-Control": "no-cache, no-store, must-revalidate",
        Pragma: "no-cache"
      }
    });
  } catch {
    /* ignore */
  }

  const url = new URL(window.location.href);
  url.searchParams.set("_fv", String(Date.now()));
  window.location.replace(url.toString());
}

/** Мягкое обновление страницы с обходом кэша документа. */
export function softReloadAssistant(): void {
  if (typeof window === "undefined") return;
  clearClientVersionMarkers();
  const url = new URL(window.location.href);
  url.searchParams.set("_refresh", String(Date.now()));
  window.location.replace(url.toString());
}
