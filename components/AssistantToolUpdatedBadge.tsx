"use client";

import {
  ASSISTANT_TOOL_UPDATES,
  formatAssistantUpdatedAt
} from "@/lib/assistantToolUpdates";
import { fetchAssistantVersion } from "@/lib/assistantVersion";
import { useEffect, useState } from "react";

type Props = {
  href: string;
  className?: string;
};

/** Подпись «Обновлено …» — дата с сервера (/api/version), не из кэша бандла. */
export function AssistantToolUpdatedBadge({ href, className = "" }: Props) {
  const staticMeta = ASSISTANT_TOOL_UPDATES[href];
  const [meta, setMeta] = useState(staticMeta);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const data = await fetchAssistantVersion();
      const live = data?.toolUpdates?.[href];
      if (!cancelled && live) setMeta(live);
    })();
    return () => {
      cancelled = true;
    };
  }, [href]);

  if (!meta) return null;

  return (
    <span className={`block text-xs font-normal text-emerald-700 ${className}`}>
      Обновлено {formatAssistantUpdatedAt(meta.updatedAt)}
      {meta.note ? ` · ${meta.note}` : ""}
    </span>
  );
}
