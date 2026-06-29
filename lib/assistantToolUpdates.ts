/** Дата последних заметных изменений по сценариям ассистента (href как в app/page.tsx). */
export const ASSISTANT_TOOL_UPDATES: Record<
  string,
  { updatedAt: string; note?: string }
> = {
  "/template-generator": {
    updatedAt: "2026-06-26T16:30:00+03:00",
    note: "ЯМ: строка заголовков, русские названия, дефис как пусто, выбор фото"
  },
  "/letual-main-photo": {
    updatedAt: "2026-06-29T18:00:00+03:00",
    note: "Геометрия 1000×1000: вертикали на всю высоту, остальные по низу"
  },
  "/ozon-images": {
    updatedAt: "2026-06-26T16:00:00+03:00",
    note: "Инфографика парфюм · принудительное обновление версии"
  },
  "/ozon-cosmetics": {
    updatedAt: "2026-06-26T16:00:00+03:00",
    note: "Инфографика косметика · выбор фото Metabase"
  }
};

/** Подписи сценариев для блока «Недавние обновления» на главной */
export const ASSISTANT_TOOL_TITLES: Record<string, string> = {
  "/template-generator": "Генератор шаблонов",
  "/letual-main-photo": "Главное фото · Летуаль",
  "/ozon-images": "Инфографика · Ozon парфюм",
  "/ozon-cosmetics": "Инфографика · Ozon косметика"
};

export type AssistantToolUpdateEntry = {
  href: string;
  title: string;
  updatedAt: string;
  note?: string;
};

export function listAssistantToolUpdates(): AssistantToolUpdateEntry[] {
  return Object.entries(ASSISTANT_TOOL_UPDATES)
    .map(([href, meta]) => ({
      href,
      title: ASSISTANT_TOOL_TITLES[href] ?? href,
      ...meta
    }))
    .sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
}

export function formatAssistantUpdatedAt(iso: string): string {
  try {
    return new Intl.DateTimeFormat("ru-RU", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}
