"use client";

import {
  ASSISTANT_TOOL_UPDATES,
  formatAssistantUpdatedAt
} from "@/lib/assistantToolUpdates";

type Props = {
  href: string;
  className?: string;
};

/** Подпись «Обновлено …» для сценариев с недавними изменениями */
export function AssistantToolUpdatedBadge({ href, className = "" }: Props) {
  const meta = ASSISTANT_TOOL_UPDATES[href];
  if (!meta) return null;

  return (
    <span className={`block text-xs font-normal text-emerald-700 ${className}`}>
      Обновлено {formatAssistantUpdatedAt(meta.updatedAt)}
      {meta.note ? ` · ${meta.note}` : ""}
    </span>
  );
}
