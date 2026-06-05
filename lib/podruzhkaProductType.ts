/**
 * Серая строка на карточке: product type card → иначе product_type из Excel как есть.
 * Угадывание из name — только если product_type пустой.
 */
export function normalizeProductType(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function norm(s: string): string {
  return normalizeProductType(s);
}

export function productTypesDiffer(feedType: string, cardType: string): boolean {
  const feed = norm(feedType);
  const card = norm(cardType);
  if (!card) return false;
  return feed !== card;
}

function genderSuffix(blob: string): string {
  if (/мужск|(\bmen\b)|homme|for\s+men/i.test(blob)) return " мужская";
  if (/женск|(\bwomen\b)|femme|for\s+women|lady/i.test(blob)) return " женская";
  return "";
}

/** Запасной вариант, если product_type в Excel пустой */
function inferFromNames(productName: string, name: string, model?: string): string {
  const blob = `${productName} ${name} ${model ?? ""}`.toLowerCase();
  const g = genderSuffix(blob);

  if (
    /eau\s*de\s*parfum|\bedp\b|парфюмерн(?:ая|ой)\s+вод|extrait\s+de\s+parfum|духи\s*\(парфюмерн/i.test(
      blob
    )
  ) {
    return `парфюмерная вода${g}`.trim();
  }
  if (
    /\belixir\s+de\s+parfum\b|\bde\s+parfum\b|\bparfum\b/i.test(blob) &&
    !/eau\s*de\s*toilette|\bedt\b/i.test(blob)
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
  model?: string;
}): string {
  const col = norm(input.productType);
  if (col) return col;

  return inferFromNames(input.productName, input.name, input.model);
}

/** product type card (если заполнен) → иначе product_type → иначе name */
export function resolveProductTypeForRender(input: {
  productTypeCard: string;
  productType: string;
  productName: string;
  name: string;
  model?: string;
}): string {
  const fromCard = norm(input.productTypeCard);
  if (fromCard) return fromCard;
  return resolveProductTypeForCard({
    productType: input.productType,
    productName: input.productName,
    name: input.name,
    model: input.model
  });
}
