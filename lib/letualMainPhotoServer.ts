import {
  pickBestFromRanked,
  pickSuitableLetualPhoto,
  type LetualPhotoScore
} from "@/lib/letualPhotoAi";
import { processLetualMainPhotoFromUrl } from "@/lib/letualMainPhotoProcess";
import { fetchLetualVariations } from "@/lib/letualMetabase";
import { searchLetualWebImages, validateImageUrl } from "@/lib/letualWebSearch";
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
  if (!best) return "";
  const notes: string[] = [];
  if (!best.hasWhiteBackground) notes.push("фон не белый — проверить");
  if (!best.isFrontal) notes.push("не фронтальный ракурс — проверить");
  if (best.quality < 50) notes.push("низкое качество источника");
  if (!best.suitable) notes.push(best.reason);
  if (!notes.length) return "";
  return `Фото из БД: ${notes.join("; ")}`;
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

    if (row.imageUrls.length) {
      const suitable = await pickSuitableLetualPhoto(row.imageUrls, key);
      if (suitable.url) {
        sourceUrl = suitable.url;
        comment = buildDbComment(suitable.best);
      } else if (suitable.ranked.length) {
        const fallback = pickBestFromRanked(suitable.ranked);
        if (fallback?.url) {
          candidateUrls.push(fallback.url);
          comment = buildDbComment(fallback);
        }
      }
    }

    if (!sourceUrl && !candidateUrls.length) {
      const web = await searchLetualWebImages(row.ean, row.productName, row.brandName);
      for (const item of web) {
        if (!(await validateImageUrl(item.url))) continue;
        const scored = await pickSuitableLetualPhoto([item.url], key);
        if (scored.url) {
          sourceUrl = scored.url;
          comment = `Фото из интернета (${item.source}), проверить вручную`;
          break;
        }
        if (scored.best?.url) {
          candidateUrls.push(scored.best.url);
          comment = `Фото из интернета (${item.source}): ${scored.best.reason}; проверить`;
        }
      }
    }

    const tryList = sourceUrl ? [sourceUrl, ...candidateUrls] : candidateUrls;

    if (!tryList.length) {
      const deadLinks = row.imageUrls.length
        ? `В БД ${row.imageUrls.length} ссылок, но ни одна не скачивается (404/403). `
        : "";
      return {
        variationId,
        resultUrl: "",
        comment: "",
        ok: false,
        error: `${deadLinks}Нет подходящего фото в интернете`
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
