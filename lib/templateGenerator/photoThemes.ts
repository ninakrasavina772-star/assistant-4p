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
    "Luxury perfume product photography backdrop, empty clear center on travertine stone for bottle placement, " +
    "soft pink peonies and blush roses softly blurred in background, warm golden sunlight from upper left, " +
    "feminine elegant mood, shallow depth of field, photorealistic, no perfume bottle, no product, no text, no logo"
};

const SCENE_DARK_WOODY: ThemedScene = {
  id: "dark-woody-gold",
  label: "тёмное дерево и золото",
  prompt:
    "High-end perfume advertising background, empty center foreground on dark reflective surface, " +
    "black studio backdrop, weathered sandalwood and oud wood textures, molten gold accents, " +
    "metallic gold rose softly blurred on the side, dramatic chiaroscuro lighting, " +
    "photorealistic, no bottle, no product, no text, no logo"
};

const SCENE_CITRUS: ThemedScene = {
  id: "citrus-fresh",
  label: "свежий цитрус",
  prompt:
    "Bright perfume lifestyle background, white marble surface, empty center for product, " +
    "fresh lemon and bergamot slices and green leaves artistically blurred, crisp daylight, " +
    "clean airy spa mood, photorealistic, no bottle, no text, no logo"
};

const SCENE_ORIENTAL: ThemedScene = {
  id: "oriental-amber",
  label: "восточный амбра",
  prompt:
    "Oriental luxury perfume scene background, dark amber and burgundy silk fabric, " +
    "golden incense smoke wisps, warm candlelight bokeh, empty center on polished stone, " +
    "mysterious premium mood, photorealistic, no bottle, no text, no logo"
};

const SCENE_AQUATIC: ThemedScene = {
  id: "aquatic-clean",
  label: "свежая вода",
  prompt:
    "Fresh aquatic perfume background, pale blue gradient, water droplets and soft waves blurred, " +
    "frosted glass reflections, cool daylight, empty center on wet white surface, " +
    "photorealistic, no bottle, no text, no logo"
};

const SCENE_GOURMAND: ThemedScene = {
  id: "gourmand-vanilla",
  label: "гурман ваниль",
  prompt:
    "Gourmand perfume lifestyle backdrop, creamy beige surface, vanilla pods and cocoa blurred, " +
    "warm caramel tones, cozy luxury mood, soft side light, empty center for bottle, " +
    "photorealistic, no bottle, no text, no logo"
};

const SCENE_CLASSIC: ThemedScene = {
  id: "classic-luxury",
  label: "классическая роскошь",
  prompt:
    "Timeless luxury perfume studio background, soft champagne gradient, subtle silk curtain bokeh, " +
    "neutral beige and gold tones, elegant minimal composition, empty center, " +
    "photorealistic, no bottle, no text, no logo"
};

const SCENE_MUSK: ThemedScene = {
  id: "powder-musk",
  label: "пудровый мускус",
  prompt:
    "Soft powdery musk perfume background, pale lilac and nude tones, fluffy textile texture, " +
    "gentle diffused window light, dreamy clean beauty mood, empty center on matte surface, " +
    "photorealistic, no bottle, no text, no logo"
};

const ALL_SCENES = [
  SCENE_FLORAL,
  SCENE_DARK_WOODY,
  SCENE_CITRUS,
  SCENE_ORIENTAL,
  SCENE_AQUATIC,
  SCENE_GOURMAND,
  SCENE_CLASSIC,
  SCENE_MUSK
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
