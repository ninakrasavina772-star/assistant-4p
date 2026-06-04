/**
 * Тип для серой строки на карточке: из колонки product_type или из name / product name.
 * Excel не перезаписываем — только подстановка при рендере.
 */
const VAGUE_ONLY =
  /^(духи|парфюм|аромат|парфюмерия|fragrance|perfume|парфюмированная\s+вода)$/i;

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function genderSuffix(blob: string): string {
  if (/мужск|(\bmen\b)|homme|for\s+men/i.test(blob)) return " мужская";
  if (/женск|(\bwomen\b)|femme|for\s+women|lady/i.test(blob)) return " женская";
  return "";
}

function inferFromNames(productName: string, name: string): string {
  const blob = `${productName} ${name}`.toLowerCase();
  const g = genderSuffix(blob);

  if (
    /eau\s*de\s*parfum|\bedp\b|парфюмерн(?:ая|ой)\s+вод|extrait\s+de\s+parfum|духи\s*\(парфюмерн/i.test(
      blob
    )
  ) {
    return `парфюмерная вода${g}`.trim();
  }
  if (/eau\s*de\s*toilette|\bedt\b|туалетн(?:ая|ой)\s+вод/i.test(blob)) {
    return `туалетная вода${g}`.trim();
  }
  if (/eau\s*de\s*cologne|\bedc\b|одеколон/i.test(blob)) {
    return `одеколон${g}`.trim();
  }
  if (/parfum\b|духи\s*\(масл|perfume\s+oil|маслян/i.test(blob)) {
    return "духи";
  }
  if (/набор|gift\s*set|coffret|комплект/i.test(blob)) {
    return "набор";
  }
  if (/дезодорант|deodorant/i.test(blob)) {
    return "дезодорант";
  }
  if (/лосьон|body\s+lotion|лосьён/i.test(blob)) {
    return "лосьон для тела";
  }

  return "";
}

export function resolveProductTypeForCard(input: {
  productType: string;
  productName: string;
  name: string;
}): string {
  const col = norm(input.productType);
  if (col && !VAGUE_ONLY.test(col)) {
    return col;
  }

  const inferred = inferFromNames(input.productName, input.name);
  if (inferred) return inferred;

  if (col) return col;
  return "";
}
