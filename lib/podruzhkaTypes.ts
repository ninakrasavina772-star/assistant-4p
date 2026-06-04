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
};

export const PODRUZHKA_AI_COLUMNS = [
  "model",
  "note1_title",
  "note1_desc",
  "note2_title",
  "note2_desc",
  "note3_title",
  "note3_desc",
  "notes_status"
] as const;
