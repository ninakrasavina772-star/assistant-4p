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
  /** Публичный URL первого фото (для режима vision) */
  imageUrlA?: string | null;
  imageUrlB?: string | null;
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
    layer: string,
    imageUrlA?: string | null,
    imageUrlB?: string | null
  ) {
    const k = dupPairKey(idA, idB);
    if (seen.has(k)) return;
    seen.add(k);
    out.push({
      idA,
      idB,
      titleA,
      titleB,
      brandA,
      brandB,
      layer,
      imageUrlA: imageUrlA ?? null,
      imageUrlB: imageUrlB ?? null
    });
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
          layer,
          a.firstImage,
          b.firstImage
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
      `onlyBvsA:${r.kind}`,
      a.firstImage,
      b.firstImage
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
      `onlyAvsB:${r.kind}`,
      a.firstImage,
      b.firstImage
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
      `internalB:${r.kind}`,
      a.firstImage,
      b.firstImage
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
      `internalA:${r.kind}`,
      a.firstImage,
      b.firstImage
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

function verdictsFromOpenAiHttpBody(rawText: string): DupPairVerdict[] {
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
      ? (parsed as { choices: { message?: { content?: string | unknown } }[] })
          .choices[0]?.message?.content
      : null;

  let text: string | null = null;
  if (typeof content === "string") {
    text = content;
  } else if (Array.isArray(content)) {
    const parts = content as { type?: string; text?: string }[];
    text = parts
      .filter((p) => p && p.type === "text" && typeof p.text === "string")
      .map((p) => p.text)
      .join("\n");
  }

  if (!text || !text.trim()) {
    throw new Error("OpenAI: пустой ответ модели");
  }

  let inner: unknown;
  try {
    inner = JSON.parse(text);
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

const SYSTEM_PROMPT_VISION = `Ты помощник мерчандайзера интернет-магазина парфюмерии и косметики.
Для каждой пары товаров даны бренды, полные названия и при наличии — два превью (сначала A, затем B). Упаковка и фото помогают отличить разные линейки и объёмы.
Реши: это **один и тот же SKU / дублирующиеся карточки одной позиции**, или **разные товары** (другой аромат, flanker, другой объём как отдельная карточка и т.д.).
Совпадение только бренда недостаточно.
Ответ строго JSON-объект вида:
{"verdicts":[{"idA":number,"idB":number,"duplicate":boolean,"confidence":number,"note":string}]}
Один элемент на каждую пару из запроса с теми же idA и idB. confidence от 0 до 1. note — кратко по-русски (до 120 символов).`;

/**
 * Мультимодальный запрос: превью по публичным URL (CDN витрины должен быть доступен с серверов OpenAI).
 * Небольшие чанки на вызов — из‑за лимита изображений и токенов.
 */
export async function refineDupPairsOpenAiVisionBatch(
  apiKey: string,
  pairs: DupPairRefineIn[],
  model = "gpt-4o-mini"
): Promise<DupPairVerdict[]> {
  if (!pairs.length) return [];

  const content: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string; detail: "low" } }
  > = [
    {
      type: "text",
      text: `Проанализируй ${pairs.length} пар ниже: для каждой сначала блок текста с id и названиями, затем превью A (или пометка об отсутствии), затем превью B. Верни verdicts по всем парам.`
    }
  ];

  for (const p of pairs) {
    content.push({
      type: "text",
      text: `\n---\nПара: idA=${p.idA}, idB=${p.idB}\nlayer: ${p.layer}\nA: ${p.brandA} — ${p.titleA}\nB: ${p.brandB} — ${p.titleB}`
    });
    const ua = p.imageUrlA?.trim();
    const ub = p.imageUrlB?.trim();
    if (ua && /^https?:\/\//i.test(ua)) {
      content.push({
        type: "image_url",
        image_url: { url: ua.slice(0, 2000), detail: "low" }
      });
    } else {
      content.push({ type: "text", text: "(Превью A нет.)" });
    }
    if (ub && /^https?:\/\//i.test(ub)) {
      content.push({
        type: "image_url",
        image_url: { url: ub.slice(0, 2000), detail: "low" }
      });
    } else {
      content.push({ type: "text", text: "(Превью B нет.)" });
    }
  }

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
        { role: "system", content: SYSTEM_PROMPT_VISION },
        { role: "user", content }
      ]
    })
  });

  const rawText = await res.text();
  if (!res.ok) {
    throw new Error(rawText.slice(0, 400) || `OpenAI HTTP ${res.status}`);
  }

  return verdictsFromOpenAiHttpBody(rawText);
}

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

  return verdictsFromOpenAiHttpBody(rawText);
}

export function looksLikeOpenAiApiKey(k: string): boolean {
  const t = k.trim();
  return t.startsWith("sk-") || t.startsWith("sk-proj-");
}
