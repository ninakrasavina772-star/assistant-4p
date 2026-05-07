import type { FpProduct } from "./types";
import { extractVolumePhraseFromText } from "./volumeFromText";

/**
 * Поддержка: объём / цвет / оттенок из вложенных полей товара 4Partners
 * (разные витрины отдают разные ключи — обходим JSON).
 */
function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

type AttrOut = { vol?: string; col?: string; sh?: string };

function considerKeyName(key: string, val: string, out: AttrOut) {
  const k = key.toLowerCase();
  if (
    /объем|обьем|volume|volum|объё|size|ml|мл|мл\.|e\.?\s*g\.?/i.test(k) &&
    !/photo|image|фото|картин/i.test(k)
  ) {
    if (!out.vol) out.vol = val;
    return;
  }
  if (/цвет|color|colour|колер/i.test(k) && !/фото|photo/i.test(k)) {
    if (!out.col) out.col = val;
    return;
  }
  if (/оттенок|shade|nuance|тон(?!\w)|tone\b/i.test(k)) {
    if (!out.sh) out.sh = val;
  }
}

function walk(
  o: unknown,
  depth: number,
  out: AttrOut
): void {
  if (depth > 6 || o == null) return;
  if (typeof o === "string") return;
  if (Array.isArray(o)) {
    for (const x of o) {
      if (x && typeof x === "object" && !Array.isArray(x)) {
        const r = x as Record<string, unknown>;
        const name = (r.name || r.title || r.label || r.key) as
          | string
          | undefined;
        const val = (r.value || r.text || r.name_value) as
          | string
          | undefined;
        if (name && val && typeof name === "string" && typeof val === "string") {
          considerKeyName(String(name), String(val), out);
        }
      }
      walk(x, depth + 1, out);
    }
    return;
  }
  if (typeof o === "object") {
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (typeof v === "string" && v.trim() && v.length < 200) {
        considerKeyName(k, v, out);
      }
      walk(v, depth + 1, out);
    }
  }
}

function collectVolumeTextSources(p: FpProduct): string[] {
  const out: string[] = [];
  const add = (s: unknown) => {
    if (typeof s === "string" && s.trim()) out.push(s);
  };
  add(p.name);
  if (p.i18n) {
    for (const loc of Object.values(p.i18n)) {
      if (!loc) continue;
      add(loc.name);
      add(loc.description);
    }
  }
  add(p.original_name);
  add(p.name_original);
  add(p.supplier_name);
  add(p.description);
  add(p.short_description);
  add(p.text);
  const x = p as Record<string, unknown>;
  for (const k of ["body", "content", "annotation"] as const) {
    add(x[k]);
  }
  return out;
}

/**
 * Плоские подсказки для сопоставления (не нормируем до физ. ед.).
 * Объём: сначала поля в JSON, иначе — эвристика по названию и описанию (50 мл / 30ml / …).
 */
export function extractProductAttributes(
  p: FpProduct
): { attrVolume?: string; attrColor?: string; attrShade?: string } {
  const out: AttrOut = {};
  walk(p as unknown, 0, out);
  if (!out.vol) {
    for (const chunk of collectVolumeTextSources(p)) {
      const v = extractVolumePhraseFromText(chunk);
      if (v) {
        out.vol = v;
        break;
      }
    }
  }
  return {
    attrVolume: out.vol,
    attrColor: out.col,
    attrShade: out.sh
  };
}

export { norm as normAttrValue };
