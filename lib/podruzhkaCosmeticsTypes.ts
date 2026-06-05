import type { PodruzhkaNoteBlock } from "@/lib/podruzhkaTypes";

/** Три блока на карточке косметики (рисуются в тех же слотах, что и ноты у ароматов). */
export type PodruzhkaCosmeticsBenefitBlock = PodruzhkaNoteBlock;

export type PodruzhkaCosmeticsAiColumnKey =
  | "model"
  | "product_type_card"
  | "benefit1"
  | "benefit2"
  | "benefit3"
  | "benefit1_desc"
  | "benefit2_desc"
  | "benefit3_desc"
  | "benefits_status";

export type PodruzhkaCosmeticsAiColumnDef = {
  key: PodruzhkaCosmeticsAiColumnKey;
  header: string;
  aliases: string[];
  optional?: boolean;
};

/** benefit 1–3 = заголовок (КАПС), benefit N (M) = описание */
export const PODRUZHKA_COSMETICS_AI_COLUMN_DEFS: PodruzhkaCosmeticsAiColumnDef[] = [
  { key: "model", header: "model", aliases: ["model", "модель", "линейка"] },
  {
    key: "product_type_card",
    header: "product type card",
    aliases: [
      "product type card",
      "product_type_card",
      "тип на карточке",
      "тип для карточки"
    ]
  },
  {
    key: "benefit1",
    header: "benefit 1",
    aliases: ["benefit 1", "benefit1", "свойство 1", "эффект 1", "плюс 1"]
  },
  {
    key: "benefit1_desc",
    header: "benefit 1 (2)",
    aliases: [
      "benefit 1 (2)",
      "benefit 1 desc",
      "benefit1_desc",
      "свойство 1 описание",
      "эффект 1 описание"
    ],
    optional: true
  },
  {
    key: "benefit2",
    header: "benefit 2",
    aliases: ["benefit 2", "benefit2", "свойство 2", "эффект 2", "плюс 2"]
  },
  {
    key: "benefit2_desc",
    header: "benefit 2 (1)",
    aliases: [
      "benefit 2 (1)",
      "benefit 2 desc",
      "benefit2_desc",
      "свойство 2 описание",
      "эффект 2 описание"
    ],
    optional: true
  },
  {
    key: "benefit3",
    header: "benefit 3",
    aliases: ["benefit 3", "benefit3", "свойство 3", "эффект 3", "плюс 3"]
  },
  {
    key: "benefit3_desc",
    header: "benefit 3 (1)",
    aliases: [
      "benefit 3 (1)",
      "benefit 3 desc",
      "benefit3_desc",
      "свойство 3 описание",
      "эффект 3 описание"
    ],
    optional: true
  },
  {
    key: "benefits_status",
    header: "статус свойств",
    aliases: ["benefits_status", "статус свойств", "статус", "status"]
  }
];
