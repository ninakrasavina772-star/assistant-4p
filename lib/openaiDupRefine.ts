import type {
  CompareProduct,
  CompareResult,
  NameLocale,
  SingleSiteDupsResult
} from "./types";

export type DupPairRefineIn = {
  idA: number;
  idB: number;
  titleA: string;
  titleB: string;
  brandA: string;
  brandB: string;
  layer: string;
};

export type DupPairVerdict = {
  pairKey: string;
  duplicate: boolean;
  confidence: number;
  note?: string;
};

export function dupPairKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

function pickTitle(c: CompareProduct, nl: NameLocale): string {
  return nl === "ru" ? c.nameRu : c.nameEn;
}

function isSoftCrossKind(
  k: string
): k is "name_photo" | "brand_visual" | "unlikely" {
  return k === "name_photo" || k === "brand_visual" || k === "unlikely";
}

function isSoftInternalKind(
  k: string
): k is "name_photo" | "brand_visual" | "unlikely" {
  return k === "name_photo" || k === "brand_visual" || k === "unlikely";
}

/**
 * Уникальные мягкие пары для отправки в OpenAI (кросс-площадки + внутренние + режим одной рубрики).
 */
export function collectSoftDupPairsForOpenAi(
  data: CompareResult | SingleSiteDupsResult | null,
  nameLocale: NameLocale,
  maxPairs: number
): DupPairRefineIn[] {
  if (!data || maxPairs < 1) return [];
  const seen = new Set<string>();
  const out: DupPairRefineIn[] = [];

  function push(
    idA: number,
    idB: number,
    titleA: string,
    titleB: string,
    brandA: string,
    brandB: string,
    layer: string
  ) {
    const k = dupPairKey(idA, idB);
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ idA, idB, titleA, titleB, brandA, brandB, layer });
  }

  if ("resultKind" in data && data.resultKind === "singleSiteDups") {
    const layers: {
      rows: { a: CompareProduct; b: CompareProduct }[];
      layer: string;
    }[] = [
      { rows: data.namePhotoPairs, layer: "intra:name_photo" },
      { rows: data.brandVisualPairs ?? [], layer: "intra:brand_visual" },
      { rows: data.unlikelyPairs ?? [], layer: "intra:unlikely" }
    ];
    for (const { rows, layer } of layers) {
      for (const row of rows) {
        if (out.length >= maxPairs) return out;
        const { a, b } = row;
        push(
          a.id,
          b.id,
          pickTitle(a, nameLocale),
          pickTitle(b, nameLocale),
          a.brand,
          b.brand,
          layer
        );
      }
    }
    return out;
  }

  const cr = data as CompareResult;

  for (const r of cr.onlyBCrossWithA ?? []) {
    if (out.length >= maxPairs) break;
    if (!isSoftCrossKind(r.kind)) continue;
    const a = r.productOnA;
    const b = r.productFromOnlyB;
    push(
      a.id,
      b.id,
      pickTitle(a, nameLocale),
      pickTitle(b, nameLocale),
      a.brand,
      b.brand,
      `onlyBvsA:${r.kind}`
    );
  }

  for (const r of cr.onlyACrossWithB ?? []) {
    if (out.length >= maxPairs) break;
    if (!isSoftCrossKind(r.kind)) continue;
    const a = r.productFromOnlyA;
    const b = r.productOnB;
    push(
      a.id,
      b.id,
      pickTitle(a, nameLocale),
      pickTitle(b, nameLocale),
      a.brand,
      b.brand,
      `onlyAvsB:${r.kind}`
    );
  }

  for (const r of cr.onlyBInternalDups ?? []) {
    if (out.length >= maxPairs) break;
    if (!isSoftInternalKind(r.kind)) continue;
    const a = r.first;
    const b = r.second;
    push(
      a.id,
      b.id,
      pickTitle(a, nameLocale),
      pickTitle(b, nameLocale),
      a.brand,
      b.brand,
      `internalB:${r.kind}`
    );
  }

  for (const r of cr.onlyAInternalDups ?? []) {
    if (out.length >= maxPairs) break;
    if (!isSoftInternalKind(r.kind)) continue;
    const a = r.first;
    const b = r.second;
    push(
      a.id,
      b.id,
      pickTitle(a, nameLocale),
      pickTitle(b, nameLocale),
      a.brand,
      b.brand,
      `internalA:${r.kind}`
    );
  }

  return out;
}

const SYSTEM_PROMPT = `Ты помощник мерчандайзера интернет-магазина парфюмерии и косметики.
По каждой паре названий реши: это один и тот же **продаётся как отдельная карточка товар (SKU/линейка)**, или **две разные позиции** (разные ароматы, flanker, объём как отдельная карточка — считаются разными, если в названии явно разные имена линейки).
Совпадение только бренда и общего типа («Eau de Parfum») недостаточно.
Ответ строго JSON-объект вида:
{"verdicts":[{"idA":number,"idB":number,"duplicate":boolean,"confidence":number,"note":string}]}
confidence от 0 до 1. note — кратко по-русски (до 120 символов).`;

export async function refineDupPairsOpenAiBatch(
  apiKey: string,
  pairs: DupPairRefineIn[],
  model = "gpt-4o-mini"
): Promise<DupPairVerdict[]> {
  if (!pairs.length) return [];
  const userPayload = {
    pairs: pairs.map((p) => ({
      idA: p.idA,
      idB: p.idB,
      titleA: p.titleA,
      titleB: p.titleB,
      brandA: p.brandA,
      brandB: p.brandB,
      layer: p.layer
    }))
  };

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      temperature: 0.15,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: JSON.stringify(userPayload)
        }
      ]
    })
  });

  const rawText = await res.text();
  if (!res.ok) {
    throw new Error(
      rawText.slice(0, 400) || `OpenAI HTTP ${res.status}`
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error("OpenAI: некорректный JSON ответа");
  }

  const content =
    parsed &&
    typeof parsed === "object" &&
    "choices" in parsed &&
    Array.isArray((parsed as { choices: unknown }).choices)
      ? (parsed as { choices: { message?: { content?: string } }[] }).choices[0]
          ?.message?.content
      : null;

  if (!content || typeof content !== "string") {
    throw new Error("OpenAI: пустой ответ модели");
  }

  let inner: unknown;
  try {
    inner = JSON.parse(content);
  } catch {
    throw new Error("OpenAI: модель вернула не-JSON в content");
  }

  const verdictsRaw =
    inner &&
    typeof inner === "object" &&
    "verdicts" in inner &&
    Array.isArray((inner as { verdicts: unknown }).verdicts)
      ? (inner as { verdicts: unknown[] }).verdicts
      : null;

  if (!verdictsRaw) {
    throw new Error("OpenAI: нет поля verdicts");
  }

  const out: DupPairVerdict[] = [];
  for (const row of verdictsRaw) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    const idA = typeof o.idA === "number" ? o.idA : Number(o.idA);
    const idB = typeof o.idB === "number" ? o.idB : Number(o.idB);
    if (!Number.isFinite(idA) || !Number.isFinite(idB)) continue;
    const duplicate = Boolean(o.duplicate);
    let confidence = Number(o.confidence);
    if (!Number.isFinite(confidence)) confidence = duplicate ? 0.7 : 0.7;
    confidence = Math.min(1, Math.max(0, confidence));
    const note =
      typeof o.note === "string" ? o.note.slice(0, 200) : undefined;
    out.push({
      pairKey: dupPairKey(Math.floor(idA), Math.floor(idB)),
      duplicate,
      confidence,
      note
    });
  }

  return out;
}

export function looksLikeOpenAiApiKey(k: string): boolean {
  const t = k.trim();
  return t.startsWith("sk-") || t.startsWith("sk-proj-");
}
