import {
  pickBestFromRanked,
  pickSuitableLetualPhoto,
  type LetualPhotoScore
} from "@/lib/letualPhotoAi";
import { processLetualMainPhotoFromUrl } from "@/lib/letualMainPhotoProcess";
import { fetchLetualVariations } from "@/lib/letualMetabase";
import { pickFromSiblingCatalogPhotos } from "@/lib/letualSiblingPhotos";
import { searchLetualWebImages, validateImageUrl, isSerpApiConfigured } from "@/lib/letualWebSearch";
import { uploadLetualMainPhoto } from "@/lib/ozonImageStorage";
import type { LetualResultRow } from "@/lib/letualMainPhotoExcel";

function resolveOpenAiKey(clientKey?: string): string {
  const k = (clientKey ?? "").trim() || (process.env.OPENAI_API_KEY ?? "").trim();
  if (!k) throw new Error("Нужен OpenAI API key (в интерфейсе или OPENAI_API_KEY на сервере)");
  return k;
}

async function processAndUpload(sourceUrl: string): Promise<string> {
  const jpeg = await processLetualMainPhotoFromUrl(sourceUrl);
  return uploadLetualMainPhoto(jpeg, "main.jpg");
}

async function tryProcessCandidates(
  candidates: string[]
): Promise<{ resultUrl: string; sourceUrl: string } | null> {
  for (const url of candidates) {
    if (!url) continue;
    try {
      const resultUrl = await processAndUpload(url);
      return { resultUrl, sourceUrl: url };
    } catch {
      continue;
    }
  }
  return null;
}

function buildDbComment(best: LetualPhotoScore | undefined): string {
  if (!best || best.suitable) return "";
  const notes: string[] = [];
  if (best.hasBox) notes.push("в кадре коробка — вырезание флакона");
  if (!best.hasWhiteBackground) notes.push("фон не белый — вырезание");
  if (!best.isFrontal) notes.push("ракурс — проверить");
  if (best.quality < 50) notes.push("низкое качество источника");
  if (!notes.length && best.reason && best.reason !== "Не подходит") {
    notes.push(best.reason);
  }
  if (!notes.length) return "";
  return `Главное фото: ${notes.join("; ")}`;
}

function dbPhotoNeedsWebFallback(ranked: LetualPhotoScore[]): boolean {
  if (!ranked.length) return true;
  return !ranked.some((r) => r.hasProduct);
}

function findSuitableInRanked(ranked: LetualPhotoScore[]): LetualPhotoScore | undefined {
  const suitable = ranked.filter((r) => r.suitable);
  if (!suitable.length) return undefined;
  return [...suitable].sort((a, b) => b.score - a.score)[0];
}

function lastResortDbUrls(urls: string[], mainImageUrl?: string | null): string[] {
  const ordered = mainImageUrl ? [mainImageUrl, ...urls] : urls;
  const own = ordered.filter((u) => /cdnru\.4stand|deloox/i.test(u));
  const rest = ordered.filter((u) => !own.includes(u));
  return [...new Set([...own, ...rest])];
}

function catalogFallbackComment(dbNote: string): string {
  return dbNote
    ? `${dbNote}; в каталоге лучше не найдено`
    : "В каталоге не найдено лучшее фото — используем своё с вырезанием";
}

function webFallbackComment(dbNote: string): string {
  if (!isSerpApiConfigured()) {
    return catalogFallbackComment(dbNote);
  }
  return dbNote ? `${dbNote}; в интернете не найдено` : "В интернете не найдено — фото из БД с вырезанием";
}

function dbFallbackGoodEnoughForCutout(best: LetualPhotoScore): boolean {
  return (
    !best.hasBox &&
    !best.hasInfographic &&
    best.isFrontal &&
    best.quality >= 40
  );
}

async function pickFromWebImages(
  images: Awaited<ReturnType<typeof searchLetualWebImages>>,
  openaiKey: string
): Promise<{ sourceUrl: string; comment: string; candidates: string[] }> {
  const allRanked: LetualPhotoScore[] = [];
  const sourceByUrl = new Map<string, string>();

  for (const item of images) {
    if (!(await validateImageUrl(item.url))) continue;
    const scored = await pickSuitableLetualPhoto([item.url], openaiKey);
    for (const r of scored.ranked) {
      sourceByUrl.set(r.url, item.source);
      allRanked.push(r);
    }
  }

  const suitable = findSuitableInRanked(allRanked);
  if (suitable?.url) {
    const src = sourceByUrl.get(suitable.url) ?? "web";
    return {
      sourceUrl: suitable.url,
      comment: `Фото из интернета (${src})`,
      candidates: []
    };
  }

  const webBest = pickBestFromRanked(allRanked);
  if (webBest?.url) {
    const src = sourceByUrl.get(webBest.url) ?? "web";
    return {
      sourceUrl: "",
      comment: `Фото из интернета (${src}): ${webBest.reason || "проверить"}`,
      candidates: [webBest.url]
    };
  }

  return { sourceUrl: "", comment: "", candidates: [] };
}

export async function processLetualByUrl(
  sourceUrl: string,
  _openaiApiKey?: string
): Promise<LetualResultRow> {
  try {
    const resultUrl = await processAndUpload(sourceUrl);
    return {
      sourceUrl,
      resultUrl,
      comment: "",
      previewUrl: resultUrl,
      ok: true
    };
  } catch (e) {
    return {
      sourceUrl,
      resultUrl: "",
      comment: "",
      ok: false,
      error: e instanceof Error ? e.message : String(e)
    };
  }
}

export async function processLetualByVariationId(
  variationId: number,
  openaiApiKey?: string,
  metabaseApiKey?: string
): Promise<LetualResultRow> {
  const key = resolveOpenAiKey(openaiApiKey);

  try {
    const rows = await fetchLetualVariations([variationId], metabaseApiKey);
    const row = rows[0];
    if (!row) {
      return {
        variationId,
        resultUrl: "",
        comment: "",
        ok: false,
        error: `Вариация ${variationId} не найдена в БД`
      };
    }

    let sourceUrl = "";
    let comment = "";
    const candidateUrls: string[] = [];
    let rankedFromDb: LetualPhotoScore[] = [];
    let dbFallback: LetualPhotoScore | undefined;

    if (row.imageUrls.length) {
      const picked = await pickSuitableLetualPhoto(row.imageUrls, key);
      rankedFromDb = picked.ranked;

      const suitable = findSuitableInRanked(picked.ranked);
      if (suitable?.url) {
        sourceUrl = suitable.url;
        comment = buildDbComment(suitable);
      } else {
        const best = pickBestFromRanked(picked.ranked);
        if (best?.url) {
          if (best.suitable) {
            sourceUrl = best.url;
          } else {
            candidateUrls.push(best.url);
          }
          comment = buildDbComment(best);
          dbFallback = best;
        }
      }
    }

    // Нет идеального фото → другие вариации в каталоге, затем SerpAPI (если есть)
    if (!sourceUrl) {
      if (dbFallback?.url && dbFallbackGoodEnoughForCutout(dbFallback)) {
        candidateUrls.push(dbFallback.url);
        comment = buildDbComment(dbFallback);
      } else {
        const exclude = [...row.imageUrls, row.mainImageUrl ?? ""].filter(Boolean);
        const siblingPick = await pickFromSiblingCatalogPhotos(
          variationId,
          key,
          { brandName: row.brandName, productName: row.productName },
          exclude,
          metabaseApiKey
        );

        if (siblingPick.sourceUrl) {
          sourceUrl = siblingPick.sourceUrl;
          comment = siblingPick.comment;
        } else if (siblingPick.candidates.length) {
          candidateUrls.push(...siblingPick.candidates);
          comment = siblingPick.comment;
        } else if (isSerpApiConfigured()) {
          const web = await searchLetualWebImages(row.ean, row.productName, row.brandName);
          const webPick = await pickFromWebImages(web, key);
          if (webPick.sourceUrl) {
            sourceUrl = webPick.sourceUrl;
            comment = webPick.comment;
          } else if (webPick.candidates.length) {
            candidateUrls.push(...webPick.candidates);
            comment = webPick.comment;
          } else if (dbFallback?.url) {
            candidateUrls.push(dbFallback.url);
            comment = webFallbackComment(buildDbComment(dbFallback));
          } else {
            for (const u of lastResortDbUrls(row.imageUrls, row.mainImageUrl).slice(0, 4)) {
              candidateUrls.push(u);
            }
            comment = webFallbackComment("");
          }
        } else if (dbFallback?.url) {
          candidateUrls.push(dbFallback.url);
          comment = catalogFallbackComment(buildDbComment(dbFallback));
        } else {
          for (const u of lastResortDbUrls(row.imageUrls, row.mainImageUrl).slice(0, 4)) {
            candidateUrls.push(u);
          }
          comment = catalogFallbackComment("");
        }
      }
    }

    const tryList: string[] = [];
    if (sourceUrl) tryList.push(sourceUrl);
    for (const u of candidateUrls) {
      if (u && !tryList.includes(u)) tryList.push(u);
    }
    const rankedSorted = [...rankedFromDb].sort((a, b) => b.score - a.score);
    for (const r of rankedSorted) {
      if (r.url && r.hasProduct && !tryList.includes(r.url)) {
        tryList.push(r.url);
      }
    }

    if (!tryList.length) {
      const onlyBox =
        rankedFromDb.length > 0 &&
        rankedFromDb.every((r) => r.hasBox || r.hasInfographic);
      const deadLinks = row.imageUrls.length
        ? `В БД ${row.imageUrls.length} ссылок, но ни одна не скачивается (404/403). `
        : "";
      const boxNote = onlyBox ? "В БД только фото с коробкой/инфографикой. " : "";
      return {
        variationId,
        resultUrl: "",
        comment: "",
        ok: false,
        error: `${boxNote}${deadLinks}Нет подходящего фото в каталоге`
      };
    }

    const processed = await tryProcessCandidates(tryList);
    if (!processed) {
      return {
        variationId,
        resultUrl: "",
        comment: "",
        ok: false,
        error: `Не удалось обработать фото (${tryList.length} кандидатов, ошибки скачивания)`
      };
    }

    return {
      variationId,
      sourceUrl: processed.sourceUrl,
      resultUrl: processed.resultUrl,
      comment,
      previewUrl: processed.resultUrl,
      ok: true
    };
  } catch (e) {
    return {
      variationId,
      resultUrl: "",
      comment: "",
      ok: false,
      error: e instanceof Error ? e.message : String(e)
    };
  }
}
