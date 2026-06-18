import { LUXURY_SCENE_TAIL } from "@/lib/templateGenerator/photoPrompts";

export type ProductPhotoContext = {
  brand: string;
  productName: string;
  family?: string;
  type?: string;
  notes?: string;
};

export type ThemedScene = {
  id: string;
  label: string;
  /** Промпт для генерации фона (без флакона) */
  prompt: string;
};

const SCENE_FLORAL: ThemedScene = {
  id: "floral-romantic",
  label: "цветочный романтик",
  prompt:
    "Chloé-style luxury perfume set: pale travertine stone table, soft pink peonies and blush roses " +
    "in background bokeh, warm golden hour sunlight from upper left, delicate feminine mood. " +
    LUXURY_SCENE_TAIL
};

const SCENE_DARK_WOODY: ThemedScene = {
  id: "dark-woody-gold",
  label: "тёмное дерево и золото",
  prompt:
    "Guerlain-style luxury perfume scene: black studio, weathered sandalwood and oud wood, " +
    "molten gold liquid accents, metallic gold rose blurred on side, dramatic chiaroscuro. " +
    LUXURY_SCENE_TAIL
};

const SCENE_CITRUS: ThemedScene = {
  id: "citrus-fresh",
  label: "свежий цитрус",
  prompt:
    "Fresh citrus perfume editorial: white Carrara marble slab, lemon and bergamot slices, " +
    "green leaves, crisp morning daylight, spa luxury mood. " + LUXURY_SCENE_TAIL
};

const SCENE_ORIENTAL: ThemedScene = {
  id: "oriental-amber",
  label: "восточный амбра",
  prompt:
    "Oriental luxury perfume: dark amber silk, golden incense smoke, candlelight bokeh, " +
    "polished black stone surface, mysterious premium mood. " + LUXURY_SCENE_TAIL
};

const SCENE_AQUATIC: ThemedScene = {
  id: "aquatic-clean",
  label: "свежая вода",
  prompt:
    "Aquatic fragrance campaign: wet white stone, water droplets catching light, " +
    "soft blue reflections, clean fresh daylight. " + LUXURY_SCENE_TAIL
};

const SCENE_GOURMAND: ThemedScene = {
  id: "gourmand-vanilla",
  label: "гурман ваниль",
  prompt:
    "Gourmand perfume lifestyle: creamy travertine, vanilla pods and tonka, warm caramel light, " +
    "cozy luxury boutique mood. " + LUXURY_SCENE_TAIL
};

const SCENE_CLASSIC: ThemedScene = {
  id: "classic-luxury",
  label: "классическая роскошь",
  prompt:
    "Timeless luxury perfume counter: champagne silk curtain bokeh, beige and gold tones, " +
    "polished stone surface, elegant minimal Harrods display. " + LUXURY_SCENE_TAIL
};

const SCENE_MUSK: ThemedScene = {
  id: "powder-musk",
  label: "пудровый мускус",
  prompt:
    "Powdery musk fragrance: pale lilac and nude linen texture, soft window light, " +
    "dreamy clean beauty editorial. " + LUXURY_SCENE_TAIL
};

const SCENE_JAPANESE: ThemedScene = {
  id: "japanese-zen",
  label: "японский минимализм",
  prompt:
    "Shiseido-style Japanese luxury: honed light stone surface, washi paper texture, " +
    "single cherry blossom branch blurred, zen minimalism, soft diffused daylight. " +
    LUXURY_SCENE_TAIL
};

const ALL_SCENES = [
  SCENE_FLORAL,
  SCENE_DARK_WOODY,
  SCENE_CITRUS,
  SCENE_ORIENTAL,
  SCENE_AQUATIC,
  SCENE_GOURMAND,
  SCENE_CLASSIC,
  SCENE_MUSK,
  SCENE_JAPANESE
];

const VARIATION_SUFFIXES = [
  "morning soft light",
  "golden hour warmth",
  "subtle lens flare",
  "editorial magazine style",
  "slightly different camera angle"
];

function haystack(ctx: ProductPhotoContext): string {
  return [ctx.productName, ctx.brand, ctx.family, ctx.type, ctx.notes]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function scoreScenes(ctx: ProductPhotoContext): ThemedScene[] {
  const t = haystack(ctx);
  const scored: { scene: ThemedScene; score: number }[] = [];

  const add = (scene: ThemedScene, score: number) => scored.push({ scene, score });

  if (/santal|sandal|oud|уд|wood|древес|кедр|ветивер|incense|ладан/i.test(t)) {
    add(SCENE_DARK_WOODY, 10);
    add(SCENE_ORIENTAL, 7);
  }
  if (/rose|роз|peony|пион|floral|цвет|jasmine|жасмин|iris|ирис|lily|лили/i.test(t)) {
    add(SCENE_FLORAL, 10);
    add(SCENE_MUSK, 6);
  }
  if (/chloé|chloe|femme|женск|романт/i.test(t)) add(SCENE_FLORAL, 8);
  if (/citrus|цитрус|bergamot|бергамот|lemon|лимон|grapefruit|грейп|fresh|свеж/i.test(t)) {
    add(SCENE_CITRUS, 10);
    add(SCENE_AQUATIC, 6);
  }
  if (/aquatic|водн|marine|морск|ozon|океан/i.test(t)) add(SCENE_AQUATIC, 10);
  if (/vanil|ванил|cocoa|какао|caramel|карамел|gourmand|гурман|praline|шоколад/i.test(t)) {
    add(SCENE_GOURMAND, 10);
  }
  if (/oriental|восточ|amber|амбра|spice|специ|oud|мирр|myrrh/i.test(t)) {
    add(SCENE_ORIENTAL, 9);
    add(SCENE_DARK_WOODY, 5);
  }
  if (/musk|мускус|powder|пудр|iris|фиалк/i.test(t)) add(SCENE_MUSK, 8);
  if (/shiseido|шисейдо|japanese|япон|zen|sensual/i.test(t)) add(SCENE_JAPANESE, 9);

  add(SCENE_CLASSIC, 3);

  scored.sort((a, b) => b.score - a.score);

  const seen = new Set<string>();
  const out: ThemedScene[] = [];
  for (const { scene } of scored) {
    if (seen.has(scene.id)) continue;
    seen.add(scene.id);
    out.push(scene);
  }

  for (const scene of ALL_SCENES) {
    if (!seen.has(scene.id)) out.push(scene);
  }

  return out;
}

/** Подбор уникальных сцен под товар + лёгкая вариативность промпта */
export function pickThemedScenes(ctx: ProductPhotoContext, count: number): ThemedScene[] {
  const ranked = scoreScenes(ctx);
  const skuSeed = ctx.brand.length + ctx.productName.length;
  const rotated = [...ranked.slice(skuSeed % 3), ...ranked.slice(0, skuSeed % 3)];

  return rotated.slice(0, count).map((scene, i) => ({
    ...scene,
    prompt: `${scene.prompt}, ${VARIATION_SUFFIXES[(skuSeed + i) % VARIATION_SUFFIXES.length]}`
  }));
}

export function productPhotoContextFromRow(row: {
  brand: string;
  productName: string;
  cells: Record<string, string>;
  csvData: Record<string, string>;
}): ProductPhotoContext {
  const cells = { ...row.cells, ...row.csvData };
  const pick = (re: RegExp): string => {
    for (const [k, v] of Object.entries(cells)) {
      if (re.test(k.trim()) && v.trim()) return v.trim();
    }
    return "";
  };

  const notes = [pick(/верхн/i), pick(/средн/i), pick(/базов/i), pick(/^ноты$/i)]
    .filter(Boolean)
    .join("; ");

  return {
    brand: row.brand,
    productName: row.productName,
    family: pick(/семейство/i),
    type: pick(/^тип$/i),
    notes
  };
}
