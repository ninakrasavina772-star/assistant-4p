import type { DropdownSource } from "@/lib/templateGenerator/types";

const STORAGE_PREFIX = "fp_tpl_col_prefs_";

export type SavedColumnPrefs = {
  enabled: Record<string, boolean>;
  strict: Record<string, boolean>;
  dropdownSource: Record<string, DropdownSource>;
  savedAt: number;
};

/** Ключ по вкладке и набору заголовков — один шаблон Ozon, разные категории */
export function templateColumnKey(sheetName: string, headers: string[]): string {
  const norm = headers.map((h) => h.trim()).sort();
  let hash = 0;
  const payload = `${sheetName}\0${norm.join("\0")}`;
  for (let i = 0; i < payload.length; i++) {
    hash = (Math.imul(31, hash) + payload.charCodeAt(i)) | 0;
  }
  return `${STORAGE_PREFIX}${sheetName}__${(hash >>> 0).toString(36)}`;
}

export function loadColumnPrefs(key: string): SavedColumnPrefs | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedColumnPrefs;
    if (!parsed || typeof parsed.enabled !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveColumnPrefs(key: string, prefs: Omit<SavedColumnPrefs, "savedAt">): void {
  if (typeof sessionStorage === "undefined") return;
  const data: SavedColumnPrefs = { ...prefs, savedAt: Date.now() };
  sessionStorage.setItem(key, JSON.stringify(data));
}

export function clearColumnPrefs(key: string): void {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.removeItem(key);
}

/** Слияние сохранённого выбора с актуальными столбцами шаблона */
export function mergePrefsWithColumns(
  headers: string[],
  saved: SavedColumnPrefs | null,
  defaults: {
    enabled: Record<string, boolean>;
    strict: Record<string, boolean>;
    dropdownSource: Record<string, DropdownSource>;
  }
): {
  enabled: Record<string, boolean>;
  strict: Record<string, boolean>;
  dropdownSource: Record<string, DropdownSource>;
  restored: boolean;
} {
  if (!saved) {
    const enabled: Record<string, boolean> = {};
    for (const h of headers) {
      enabled[h] = Boolean(defaults.enabled[h]);
    }
    return { enabled, strict: defaults.strict, dropdownSource: defaults.dropdownSource, restored: false };
  }

  const enabled: Record<string, boolean> = {};
  const strict: Record<string, boolean> = {};
  const dropdownSource: Record<string, DropdownSource> = {};

  for (const h of headers) {
    enabled[h] = Boolean(saved.enabled[h]);
    strict[h] = saved.strict[h] ?? defaults.strict[h] ?? false;
    dropdownSource[h] = saved.dropdownSource[h] ?? defaults.dropdownSource[h] ?? "list_sheet";
  }

  return { enabled, strict, dropdownSource, restored: true };
}
