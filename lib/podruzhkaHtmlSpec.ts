/**
 * CSS-раскладка карточки из Ozon Card для cursor.fig (1024×1365).
 * Общая для клиентского HTML-рендера и public/podruzhka-card.html.
 */
import { PODRUZHKA_FIGMA as F } from "@/lib/podruzhkaFigmaLayout";
import { PODRUZHKA_REFERENCE as R } from "@/lib/podruzhkaReferenceSpec";

export const PODRUZHKA_HTML_LAYOUT_VERSION = "html-figma-v9";

export const PODRUZHKA_HTML_SPEC = {
  frame: F.frame,
  colors: R.colors,
  textX: F.textX,
  brand: F.brand,
  productType: F.productType,
  model: F.model,
  notesPinkBar: F.notesPinkBar,
  notes: F.notes,
  mlPinkBar: F.mlPinkBar,
  ml: F.ml,
  product: F.product,
  fonts: {
    brandFamily: '"Libre Franklin", sans-serif',
    bodyFamily: '"Inter", sans-serif',
    brand: { max: F.brand.fontSize, min: 52, weight: 800, lineHeight: 1.05 },
    productType: { size: F.productType.fontSize, weight: 400, lineHeight: 1.12 },
    model: { max: F.model.fontSize, min: 44, weight: 800, lineHeight: 1.05 },
    noteTitle: { size: F.fonts.noteTitle, weight: 700, lineHeight: 1 },
    noteDesc: { size: F.fonts.noteDesc, weight: 400, lineHeight: 1.2 },
    ml: { size: F.ml.fontSize, weight: 500, lineHeight: 1 }
  },
  separator: F.separator,
  templateUrl: "/podruzhka/template-base.png",
  googleFontsUrl:
    "https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,400;0,500;0,700;1,500&family=Libre+Franklin:wght@800&display=swap"
} as const;

export function formatMlHtml(ml: string): string {
  const t = ml.trim();
  if (!t) return "";
  if (/мл|ml/i.test(t)) return t.replace(/\s*ml\b/i, " мл");
  const n = t.replace(/[^\d.,]/g, "");
  return n ? `${n} мл` : t;
}
