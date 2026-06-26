"use client";

import { AssistantVersionControls } from "@/components/AssistantVersionControls";

/** Плавающая кнопка «Обновить версию» на всех страницах. */
export function AssistantUpdateNotifier() {
  return <AssistantVersionControls variant="floating" />;
}
