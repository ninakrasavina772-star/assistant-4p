import Link from "next/link";
import {
  formatAssistantUpdatedAt,
  listAssistantToolUpdates
} from "@/lib/assistantToolUpdates";
import { homeCard, homeCardBody, homeCardHeader, homeCardTitle } from "@/components/homeTheme";

/** Блок «Недавние обновления» на главной ассистента */
export function AssistantRecentUpdates() {
  const items = listAssistantToolUpdates();
  if (!items.length) return null;

  return (
    <section className={homeCard} aria-label="Недавние обновления">
      <div className={homeCardHeader}>
        <h2 className={homeCardTitle}>Недавние обновления</h2>
      </div>
      <ul className={`${homeCardBody} divide-y divide-slate-100`}>
        {items.map((it) => (
          <li key={it.href} className="py-3 first:pt-0 last:pb-0">
            <Link
              href={it.href}
              className="group block rounded-lg transition hover:bg-slate-50/80 -mx-1 px-1 py-0.5"
            >
              <span className="block text-sm font-semibold text-slate-900 group-hover:text-slate-950">
                {it.title}
              </span>
              <span className="mt-0.5 block text-xs text-emerald-700">
                Обновлено {formatAssistantUpdatedAt(it.updatedAt)}
                {it.note ? ` · ${it.note}` : ""}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
