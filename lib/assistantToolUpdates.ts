/** Дата последних заметных изменений по сценариям ассистента (href как в app/page.tsx). */
export const ASSISTANT_TOOL_UPDATES: Record<
  string,
  { updatedAt: string; note?: string }
> = {
  "/template-generator": {
    updatedAt: "2026-06-26T12:00:00+03:00",
    note: "Восстановлен фид; русские названия ЯМ"
  },
  "/letual-main-photo": {
    updatedAt: "2026-06-25T12:00:00+03:00",
    note: "Галереи и выбор главного фото"
  },
  "/ozon-images": {
    updatedAt: "2026-06-25T10:00:00+03:00",
    note: "Инфографика парфюм"
  },
  "/ozon-cosmetics": {
    updatedAt: "2026-06-25T10:00:00+03:00",
    note: "Инфографика косметика"
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
