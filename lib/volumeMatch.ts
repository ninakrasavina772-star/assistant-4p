import { normAttrValue } from "./productAttributes";
import { parseVolumeString } from "./volumeFromText";

const Epsilon = 0.55;

/**
 * `equal` — после нормализации одно и то же (50 мл ≈ 50ml);
 * `different` — оба распознаны, величины различаются;
 * `partial` — у одного не извлекли.
 */
export function volumePairHint(
  a: string | undefined,
  b: string | undefined
): "equal" | "different" | "partial" {
  const pa = parseVolumeString(a);
  const pb = parseVolumeString(b);
  if (!pa || !pb) return "partial";
  if (pa.kind !== pb.kind) {
    if (
      (pa.kind === "ml" && pb.kind === "g") ||
      (pa.kind === "g" && pb.kind === "ml")
    ) {
      return "different";
    }
  }
  if (Math.abs(pa.v - pb.v) <= Epsilon) return "equal";
  return "different";
}

/** Сравнение оттенка/цвета — только если оба непустые (для подписей к парам) */
export function attrPairHint(
  a: string | undefined,
  b: string | undefined
): "equal" | "different" | "partial" {
  const av = a?.trim();
  const bv = b?.trim();
  if (!av || !bv) return "partial";
  if (normAttrValue(av) === normAttrValue(bv)) return "equal";
  return "different";
}
