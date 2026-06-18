import { fetchPodruzhkaProductImageDetailed } from "@/lib/podruzhkaImageFetch";

export type LetualWebImage = {
  url: string;
  source: string;
};

async function serpApiImages(query: string, num = 5): Promise<LetualWebImage[]> {
  const key = process.env.SERPAPI_KEY?.trim();
  if (!key) return [];

  const params = new URLSearchParams({
    engine: "google_images",
    q: query,
    api_key: key,
    num: String(num),
    safe: "active"
  });

  const res = await fetch(`https://serpapi.com/search.json?${params}`, {
    signal: AbortSignal.timeout(30_000)
  });
  if (!res.ok) return [];

  const json = (await res.json()) as {
    images_results?: { original?: string; source?: string; link?: string }[];
  };

  const out: LetualWebImage[] = [];
  for (const item of json.images_results ?? []) {
    const url = (item.original ?? item.link ?? "").trim();
    if (!url.startsWith("http")) continue;
    const host = (() => {
      try {
        return new URL(url).hostname.replace(/^www\./, "");
      } catch {
        return "web";
      }
    })();
    out.push({ url, source: host });
    if (out.length >= num) break;
  }
  return out;
}

const ALLOWED_HOST_RE =
  /(ozon\.ru|ozone\.ru|goldapple\.ru|letu\.ru|4stand\.com|4partners|sephora|douglas|notino|randewoo|iledebeaute)/i;

function filterAllowedSources(images: LetualWebImage[]): LetualWebImage[] {
  return images.filter((img) => {
    try {
      const host = new URL(img.url).hostname;
      return ALLOWED_HOST_RE.test(host) || ALLOWED_HOST_RE.test(img.source);
    } catch {
      return false;
    }
  });
}

/** Поиск фото в интернете по EAN, затем по названию. */
export async function searchLetualWebImages(
  ean: string | null,
  productName: string,
  brandName: string
): Promise<LetualWebImage[]> {
  const queries: string[] = [];
  const e = ean?.trim();
  const name = [brandName, productName].filter(Boolean).join(" ").trim();

  if (e) {
    queries.push(`site:ozon.ru ${e}`);
    queries.push(`site:goldapple.ru ${e}`);
  }
  if (name) {
    queries.push(`${name} флакон белый фон`);
    queries.push(`${name} product packshot`);
  }

  const seen = new Set<string>();
  const collected: LetualWebImage[] = [];

  for (const q of queries) {
    const batch = filterAllowedSources(await serpApiImages(q, 6));
    for (const img of batch) {
      if (seen.has(img.url)) continue;
      seen.add(img.url);
      collected.push(img);
      if (collected.length >= 12) return collected;
    }
  }

  if (collected.length) return collected;

  if (!process.env.SERPAPI_KEY?.trim()) {
    throw new Error(
      "Поиск в интернете недоступен: добавьте SERPAPI_KEY на сервере (Vercel env)"
    );
  }

  return collected;
}

export async function validateImageUrl(url: string): Promise<boolean> {
  const fetched = await fetchPodruzhkaProductImageDetailed(url);
  return Boolean(fetched.buf && fetched.buf.length > 2048);
}
