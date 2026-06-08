/**
 * Проба: картинки по id/tpv на store.4partners.io
 * FOURPARTNERS_TOKEN=... node scripts/probe-tpv-images.mjs 147519981
 */
const id = process.argv[2] || "147519981";
const token =
  process.env.FOURPARTNERS_TOKEN?.trim() ||
  process.env.FOURPARTNERS_TOKEN_A?.trim() ||
  "";

function extractUrls(blob) {
  return [
    ...blob.matchAll(/https?:\/\/[^"'\\s>]+\.(?:jpg|jpeg|png|webp)(?:\?[^"'\\s>]*)?/gi)
  ].map((m) => m[0]);
}

function normalizeVariations(pv) {
  if (!pv) return [];
  if (Array.isArray(pv)) return pv.map((v, i) => ({ key: String(v.id ?? i), ...v }));
  return Object.entries(pv).map(([key, v]) => ({ key, ...(v ?? {}) }));
}

function scoreImageUrl(url, index) {
  const u = url.toLowerCase();
  let score = 50;
  if (/pack|product|main|hero|front|bottle|flacon/i.test(u)) score += 20;
  if (/box|set|gift|lifestyle|model|banner|slide|thumb|icon|logo/i.test(u)) score -= 15;
  if (index === 0) score += 5;
  return score;
}

async function scrapeStore(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "assistant-4p-probe/1" }
  });
  const html = await res.text();
  return {
    status: res.status,
    ok: res.ok,
    htmlImgs: [...new Set(extractUrls(html))]
  };
}

async function apiProductInfo(productId, variation = "ru") {
  if (!token) return { skipped: true, reason: "no FOURPARTNERS_TOKEN" };
  const base = (process.env.FOURPARTNERS_API_BASE || "https://api.4partners.io/v1").replace(
    /\/+$/,
    ""
  );
  const path = `/product/info/${productId}/${encodeURIComponent(variation)}`;
  const res = await fetch(`${base}${path}`, {
    headers: { "X-Auth-Token": token, "User-Agent": "assistant-4p-probe/1" }
  });
  const text = await res.text();
  if (!res.ok) return { status: res.status, error: text.slice(0, 500) };
  const json = JSON.parse(text);
  const result = json.result ?? {};
  const prod = result.product ?? (Array.isArray(result.products) ? result.products[0] : null);
  if (!prod) return { status: res.status, rawKeys: Object.keys(result) };

  const variations = normalizeVariations(prod.product_variation);
  const tpvKey = `tpv_${id}`;
  const match =
    variations.find((v) => String(v.key) === tpvKey) ||
    variations.find((v) => String(v.id) === id) ||
    variations.find((v) => String(v.key || "").includes(id));

  const allVariationImages = variations.map((v) => {
    const images = Array.isArray(v.images) ? v.images.map(String) : [];
    const ranked = images
      .map((url, i) => ({ url, score: scoreImageUrl(url, i) }))
      .sort((a, b) => b.score - a.score);
    return {
      key: v.key ?? String(v.id ?? "?"),
      variationId: v.id ?? null,
      params: (v.variation_param ?? []).map((p) => p.param_name).filter(Boolean),
      imageCount: images.length,
      images,
      bestGuess: ranked[0] ?? null
    };
  });

  const matchImages = Array.isArray(match?.images) ? match.images.map(String) : [];
  const rankedMatch = matchImages
    .map((url, i) => ({ url, score: scoreImageUrl(url, i) }))
    .sort((a, b) => b.score - a.score);

  return {
    status: res.status,
    productId: prod.id,
    name: prod.name,
    variationCount: variations.length,
    matchedVariation: match
      ? {
          key: match.key ?? String(match.id),
          variationId: match.id ?? null,
          imageCount: matchImages.length,
          images: matchImages,
          bestGuess: rankedMatch[0] ?? null
        }
      : null,
    allVariationImages
  };
}

console.log("=== probe id/tpv:", id, "===\n");

for (const url of [
  `https://store.4partners.io/ru/product/${id}`,
  `https://store.4partners.io/ru/product/tpv_${id}`
]) {
  console.log("STORE", url);
  try {
    const r = await scrapeStore(url);
    console.log("  status:", r.status, "static imgs:", r.htmlImgs.length);
  } catch (e) {
    console.log("  error:", e instanceof Error ? e.message : e);
  }
}

console.log("\nAPI /product/info/{id}/ru");
try {
  console.log(JSON.stringify(await apiProductInfo(id), null, 2));
} catch (e) {
  console.log("  error:", e instanceof Error ? e.message : e);
}
