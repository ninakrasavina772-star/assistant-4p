/** Строка фида Подружка Ozon из Excel */
export type PodruzhkaFeedRow = {
  row: number;
  id: string;
  name: string;
  brandName: string;
  productType: string;
  productName: string;
  foto: string;
  ml: string;
};

export type PodruzhkaNoteBlock = {
  title: string;
  desc: string;
};

export type PodruzhkaAiResult = {
  row: number;
  ok: boolean;
  model: string;
  notes: PodruzhkaNoteBlock[];
  /** Текст для серой строки на карточке (если отличается от product_type в фиде) */
  productTypeCard: string;
  productTypeMismatch: boolean;
  sources: string[];
  error?: string;
};

/** Данные для подстановки в шаблон (шаг 2) */
export type PodruzhkaInfographicData = {
  brandName: string;
  productType: string;
  model: string;
  ml: string;
  fotoUrl: string;
  notes: PodruzhkaNoteBlock[];
  /** perfume — парфюм; cosmetics — крупнее foto и benefit desc */
  renderProfile?: "perfume" | "cosmetics";
};

/** Ключи столбцов AI — как в образце Excel (note 1, note 2, model…) */
export type PodruzhkaAiColumnKey =
  | "model"
  | "product_type_card"
  | "note1"
  | "note2"
  | "note3"
  | "note1_desc"
  | "note2_desc"
  | "note3_desc"
  | "notes_status";

export type PodruzhkaAiColumnDef = {
  key: PodruzhkaAiColumnKey;
  /** Заголовок, если столбец создаётся автоматически */
  header: string;
  aliases: string[];
  /** Не создавать новый столбец, если не найден (только note *_desc) */
  optional?: boolean;
};

/**
 * Образец фида: name, brand name, product_type, product name, foto, ml,
 * foto 2, note 1, note 2, note 3, model, foto 3
 */
export const PODRUZHKA_AI_COLUMN_DEFS: PodruzhkaAiColumnDef[] = [
  { key: "model", header: "model", aliases: ["model", "модель", "модель арома"] },
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
    key: "note1",
    header: "note 1",
    aliases: ["note 1", "note1", "нота 1", "note1_title"]
  },
  {
    key: "note1_desc",
    header: "note 1 (2)",
    aliases: [
      "note 1 (2)",
      "note 1 desc",
      "note1_desc",
      "note 1 описание",
      "нота 1 описание"
    ],
    optional: true
  },
  {
    key: "note2",
    header: "note 2",
    aliases: ["note 2", "note2", "нота 2", "note2_title"]
  },
  {
    key: "note2_desc",
    header: "note 2 (1)",
    aliases: [
      "note 2 (1)",
      "note 2 desc",
      "note2_desc",
      "note 2 описание",
      "нота 2 описание"
    ],
    optional: true
  },
  {
    key: "note3",
    header: "note 3",
    aliases: ["note 3", "note3", "нота 3", "note3_title"]
  },
  {
    key: "note3_desc",
    header: "note 3 (1)",
    aliases: [
      "note 3 (1)",
      "note 3 desc",
      "note3_desc",
      "note 3 описание",
      "нота 3 описание"
    ],
    optional: true
  },
  {
    key: "notes_status",
    header: "статус нот",
    aliases: ["notes_status", "статус нот", "статус", "status"]
  }
];

export const PODRUZHKA_AI_COLUMNS = PODRUZHKA_AI_COLUMN_DEFS.filter((d) => !d.optional).map(
  (d) => d.header
);
