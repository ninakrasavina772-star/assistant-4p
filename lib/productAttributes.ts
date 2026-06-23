import type { FpProduct } from "./types";
import { extractVolumePhraseFromText, parseVolumeString } from "./volumeFromText";

/**
 * Поддержка: объём / цвет / оттенок из вложенных полей товара 4Partners
 * (разные витрины отдают разные ключи — обходим JSON).
 */
function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

type AttrOut = { vol?: string; col?: string; sh?: string };

/** Объём в значении «50 ml», даже если ключ не volume (capacity, net wt и т.д.). */
function considerVolumeFromRawValue(val: string, out: AttrOut): void {
  if (out.vol) return;
  const t = val.trim();
  if (!t || t.length > 180) return;
  if (parseVolumeString(t)) out.vol = t;
}

function considerKeyName(key: string, val: string, out: AttrOut) {
  const k = key.toLowerCase();
  const noPhoto = !/photo|image|фото|картин/i.test(k);
  const volumeKeyStrict =
    noPhoto &&
    /объем|обьем|volume|volum|объё|capacity|емкост|volumetric|nett?o|нетто|мл|\bml\b|fl\.?\s*oz|fl\s*oz|\boz\b|унц/i.test(
      k
    );
  const volumeKeyLoose =
    noPhoto &&
    /размер|size|масса|weight/i.test(k) &&
    parseVolumeString(val);
  if (volumeKeyStrict) {
    if (!out.vol) out.vol = val;
    return;
  }
  if (volumeKeyLoose) {
    if (!out.vol) out.vol = val;
    return;
  }
  /**
   * Оттенок раньше цвета: `color (shade)`, `цвет (оттенок)`, makeup shade…
   * PIM / поставщики дают десятки имён — синонимы под родителя «Оттенок».
   */
  if (
    /оттенок|shade|nuance|farbton|odcień|odcien|tonacja|makeup\s+shade|choose\s+shade|hair\s+colou?r\s+shade|\bcolou?r\s+shade\b|color\s*\(\s*shade\s*\)|цвет\s*\(\s*оттенок\s*\)/i.test(
      k
    ) &&
    !/фото|photo/i.test(k)
  ) {
    if (!out.sh) out.sh = val;
    return;
  }
  if (
    /цвет|color|colour|колер|renk|kleur|couleur|colore|\bkolor\b|main\s+col|product\s+main\s+colou?r|\bcolors?\b|colout/i.test(
      k
    ) &&
    !/фото|photo/i.test(k)
  ) {
    if (!out.col) out.col = val;
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
          considerVolumeFromRawValue(String(val), out);
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
        considerVolumeFromRawValue(v, out);
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
function applyFeedExtras(p: FpProduct, out: AttrOut): void {
  const fe = (p as Record<string, unknown>).feedExtras as
    | { volume?: string; color?: string; shade?: string }
    | undefined;
  if (!fe || typeof fe !== "object") return;
  if (!out.vol && fe.volume?.trim()) out.vol = fe.volume.trim();
  if (!out.col && fe.color?.trim()) out.col = fe.color.trim();
  if (!out.sh && fe.shade?.trim()) out.sh = fe.shade.trim();
}

export function extractProductAttributes(
  p: FpProduct
): { attrVolume?: string; attrColor?: string; attrShade?: string } {
  const out: AttrOut = {};
  applyFeedExtras(p, out);
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
