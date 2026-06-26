"use client";

import { formatAssistantUpdatedAt } from "@/lib/assistantToolUpdates";
import { useEffect, useState } from "react";

type VersionInfo = {
  buildTime?: string;
  buildId?: string;
};

/** Сборка сервера — в шапке инструментов с недавними правками */
export function AssistantBuildStamp({ className = "" }: { className?: string }) {
  const [info, setInfo] = useState<VersionInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as VersionInfo;
        if (!cancelled) setInfo(data);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!info?.buildTime || info.buildTime === "dev") return null;

  const label = formatAssistantUpdatedAt(info.buildTime);
  const id = info.buildId?.trim();

  return (
    <p className={`text-xs text-slate-500 ${className}`}>
      Версия на сервере: {label}
      {id ? ` · ${id}` : ""}
    </p>
  );
}
