/** Маркетплейс — отдельная ветка логики заполнения шаблона */
export type MarketplaceId = "ozon" | "yandex";

export const MARKETPLACE_LABELS: Record<MarketplaceId, string> = {
  ozon: "Ozon",
  yandex: "Яндекс Маркет"
};
