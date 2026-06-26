/** Дата последних заметных изменений по сценариям ассистента (href как в app/page.tsx). */
export const ASSISTANT_TOOL_UPDATES: Record<
  string,
  { updatedAt: string; note?: string }
> = {
  "/template-generator": {
    updatedAt: "2025-06-25T20:30:00+03:00",
    note: "ЯМ: русские названия, автозаполнение контента"
  },
  "/letual-main-photo": {
    updatedAt: "2025-06-25T12:00:00+03:00",
    note: "Галереи и выбор главного фото"
  },
  "/ozon-images": {
    updatedAt: "2025-06-25T10:00:00+03:00",
    note: "Инфографика парфюм"
  },
  "/ozon-cosmetics": {
    updatedAt: "2025-06-25T10:00:00+03:00",
    note: "Инфографика косметика"
  }
};

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
