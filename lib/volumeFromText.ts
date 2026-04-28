/**
 * Нормализация объёма/веса: числа + единицы (мл/ml/oz/л/г…), в т.ч. из названия и описания.
 */

export type VolumeParsed = { v: number; kind: "ml" | "g" };

const GateEpsilon = 0.55;

/**
 * Парсит одну «фразу» (поле характеристики или фрагмент «50 мл» из текста).
 */
export function parseVolumeString(s: string | undefined | null): VolumeParsed | null {
  if (!s?.trim()) return null;
  const t = s.trim();
  let m = t.match(
    /(\d+(?:[.,]\d+)?)\s*(мл|mл|ml|millil|g\b|gr\b|кг|kg|fl\.?\s*oz|fl\s*oz|oz\b|унц|мг|mg)/i
  );
  if (!m) {
    m = t.match(/(\d+(?:[.,]\d+)?)\s*(l|л)(?=[\s.,;)]|$)/i);
  }
  if (!m) return null;
  let n = parseFloat(m[1]!.replace(/\s/g, "").replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return null;
  const u = m[2]!.toLowerCase().replace(/\s/g, "");
  if (u === "кг" || u === "kg") {
    n *= 1000;
    return { v: n, kind: "g" };
  }
  if (u === "g" || u === "gr") return { v: n, kind: "g" };
  if (u === "l" || u === "л") {
    n *= 1000;
    return { v: n, kind: "ml" };
  }
  if (u === "мг" || u === "mg") {
    n /= 1000;
    return { v: n, kind: "g" };
  }
  if (u.includes("oz") || u === "oz" || u.includes("fl") || u.includes("унц")) {
    n *= 29.5735;
    return { v: n, kind: "ml" };
  }
  return { v: n, kind: "ml" };
}

/**
 * Сравнение для «круто» логики (name+фото, семейство ссылок): 50 мл ≈ 50ml.
 */
export function volumeStringsEquivalentForGate(a: string, b: string): boolean {
  const pa = parseVolumeString(a);
  const pb = parseVolumeString(b);
  if (pa && pb) {
    if (pa.kind !== pb.kind) {
      if (
        (pa.kind === "ml" && pb.kind === "g") ||
        (pa.kind === "g" && pb.kind === "ml")
      ) {
        return false;
      }
    }
    return Math.abs(pa.v - pb.v) <= GateEpsilon;
  }
  return (
    a.trim().toLowerCase().replace(/\s+/g, " ") ===
    b.trim().toLowerCase().replace(/\s+/g, " ")
  );
}

function stripHtmlLike(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Ищет в произвольном тексте (название, описание) фрагмент «число + единица объёма».
 * «Размер 50 мл», «30ml», «1.7 fl oz», «100oz».
 */
export function extractVolumePhraseFromText(
  text: string | null | undefined
): string | null {
  if (text == null) return null;
  const t = stripHtmlLike(String(text));
  if (t.length < 2) return null;

  // С меткой: «объём: 50 мл», «Size 30 ml», «e.g. 15 g» …
  const labeled =
    /(?:^|[\s;,(/])(?:об[ъь]?ем|обьем|volume|volum|вместимост|размер|size|e\.?g\.?|вес|weight|содержим|capacity|масса|состав|nett?o?)\s*[:.\-]?\s*(\d+(?:[.,]\d+)?)\s*(мл|mл|ml|g\b|l\b|л\b|кг|kg|fl\.?\s*oz|fl\s*oz|oz\b|унц|gr\b|мг|mg)(?=[\s.,;)\]]|[^0-9a-zа-яё]|$)/giu;
  let m: RegExpExecArray | null;
  labeled.lastIndex = 0;
  while ((m = labeled.exec(t)) !== null) {
    const phrase = `${m[1]} ${m[2]}`.replace(/\s+/g, " ");
    if (parseVolumeString(phrase)) return phrase;
  }

  // Без метки: 50ml, 30 мл, 100oz
  const plain =
    /(\d+(?:[.,]\d+)?)\s*(мл|mл|ml|g\b|l\b|л\b|кг|kg|fl\.?\s*oz|fl\s*oz|oz\b|унц|gr\b|мг|mg)(?=[\s.,;)\]]|[^0-9a-zа-яё]|$)/giu;
  plain.lastIndex = 0;
  while ((m = plain.exec(t)) !== null) {
    const n = parseFloat(m[1]!.replace(",", "."));
    if (!Number.isFinite(n)) continue;
    if (n >= 1990 && n <= 2030) {
      const u2 = m[2]!.toLowerCase();
      if (!/ml|мл|mл|l|л|oz|g|gr|fl|унц|мг|mg|кг|kg/.test(u2)) {
        continue;
      }
    }
    const phrase = `${m[1]} ${m[2]}`.replace(/\s+/g, " ");
    if (parseVolumeString(phrase)) return phrase;
  }
  return null;
}
