export type DropdownSource = "list_sheet" | "template_validation";

export type ColumnFillMode = "ai" | "dropdown_strict" | "skip";

export type TemplateColumnMeta = {
  col: number;
  header: string;
  hint: string;
  readonly: boolean;
  contentDefault: boolean;
  listSheetName: string | null;
  dropdownValues: string[];
  templateValidationValues: string[];
};

export type TemplateSheetScan = {
  sheetName: string;
  headerRow: number;
  hintRow: number;
  dataStartRow: number;
  columns: TemplateColumnMeta[];
  dataRowCount: number;
  skuCol: number | null;
  imageCol: number | null;
  listSheetAvailable: boolean;
};

export type TemplateRowContext = {
  row: number;
  sku: string;
  cells: Record<string, string>;
};

export type ColumnSelection = {
  header: string;
  col: number;
  mode: ColumnFillMode;
  dropdownSource: DropdownSource;
};

export type PhotoSettings = {
  enabled: boolean;
  minCount: number;
  targetCount: number;
  reviewColumnHeader: string;
};

export type FillRowInput = {
  row: number;
  sku: string;
  productName: string;
  brand: string;
  cells: Record<string, string>;
  csvData: Record<string, string>;
};

export type FillRowResult = {
  row: number;
  ok: boolean;
  values: Record<string, string>;
  extraPhotos: string[];
  /** Полный список URL для колонки «Ссылка на изображение» */
  imageUrls?: string[];
  sources: string[];
  error?: string;
};

export type CsvColumnMap = {
  skuColumn: string;
  columns: Record<string, string>;
};

/** Дополнить пустые поля в уже частично заполненном шаблоне */
export type TemplateWorkMode = "supplement" | "from_scratch";
