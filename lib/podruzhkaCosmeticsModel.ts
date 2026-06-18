/**
 * Подстановка model для карточки косметики: AI иногда копирует product_type
 * или оставляет обрезанное Ozon-имя (DIORSKIN FOREV).
 */
const GENERIC_MODELS = new Set(
  [
    "тональный крем",
    "основа под макияж",
    "база под макияж",
    "пудра",
    "тушь",
    "тушь для ресниц",
    "помада",
    "бальзам",
    "крем",
    "сыворотка",
    "маска",
    "консилер",
    "праймер",
    "хайлайтер",
    "румяна",
    "тени",
    "карандаш",
    "пенка",
    "лосьон",
    "гель",
    "скраб",
    "масло",
    "пудра",
    "bb-крем",
    "cc-крем"
  ].map((s) => s.toLowerCase())
);

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** FOREV → Forever (типичное обрезание Ozon в DIORSKIN FOREV FLUID). */
export function repairTruncatedLatinModel(model: string, _name: string): string {
  return model
    .replace(/\bforev\b/gi, "Forever")
    .replace(/\s+/g, " ")
    .trim();
}

function extractLatinLine(name: string, brand: string): string {
  const matches = name.match(/[A-Za-z][A-Za-z0-9][A-Za-z0-9\s\-'.]{1,}/g) ?? [];
  let best = "";
  for (const raw of matches) {
    const cleaned = raw.trim().replace(/\s+/g, " ");
    if (cleaned.length < 4 || cleaned.length <= best.length) continue;
    const words = cleaned.split(/\s+/);
    if (brand && words.length <= 2 && new RegExp(`\\b${escapeRegex(brand)}\\b`, "i").test(cleaned)) {
      continue;
    }
    best = cleaned;
  }
  return best;
}

function stripCategoryFromName(name: string, productType: string): string {
  let t = name.trim();
  const variants = new Set<string>();
  const pt = productType.trim();
  if (pt) {
    variants.add(pt);
    variants.add(pt.replace(/основа/gi, "база"));
    variants.add(pt.replace(/база/gi, "основа"));
  }
  for (const v of variants) {
    if (!v) continue;
    t = t.replace(new RegExp(escapeRegex(v), "gi"), " ");
  }
  return t.replace(/\s+/g, " ").trim();
}

function inferModelFromName(input: {
  name: string;
  productName: string;
  brandName: string;
  productType: string;
}): string {
  const name = (input.productName || input.name).trim();
  const brand = input.brandName.trim();
  const productType = input.productType.trim();

  const latin = extractLatinLine(name, brand);
  if (latin.length >= 4) {
    return repairTruncatedLatinModel(latin, name);
  }

  let t = stripCategoryFromName(name, productType);
  if (brand) {
    t = t.replace(new RegExp(`\\b${escapeRegex(brand)}\\b`, "gi"), " ");
  }
  t = t
    .replace(/\b\d+[\.,]?\d*\s*(ml|g|г|мл|шт)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (t.length >= 3 && norm(t) !== norm(productType)) return t;
  return "";
}

function isWeakModel(model: string, productType: string): boolean {
  const m = norm(model);
  const pt = norm(productType);
  if (!m) return true;
  if (pt && m === pt) return true;
  if (GENERIC_MODELS.has(m)) return true;
  return false;
}

export function resolveCosmeticsModelForRender(input: {
  model: string;
  productType: string;
  brandName: string;
  name: string;
  productName: string;
}): string {
  let model = repairTruncatedLatinModel(input.model.trim(), input.name || input.productName);

  if (!isWeakModel(model, input.productType)) {
    return model;
  }

  const inferred = inferModelFromName(input);
  if (inferred && !isWeakModel(inferred, input.productType)) {
    return inferred;
  }

  if (model) return model;
  return inferred || input.name.trim().slice(0, 40);
}

/** Для AI-валидации: model совпал с product_type или слишком общий. */
export function isCosmeticsModelRejected(model: string, productType: string): boolean {
  return isWeakModel(model.trim(), productType.trim());
}
