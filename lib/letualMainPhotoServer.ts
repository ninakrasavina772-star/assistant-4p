import { pickBestLetualPhoto, pickBestFromRanked } from "@/lib/letualPhotoAi";
import { processLetualMainPhotoFromUrl } from "@/lib/letualMainPhotoProcess";
import { fetchLetualVariations } from "@/lib/letualMetabase";
import { searchLetualWebImages, validateImageUrl } from "@/lib/letualWebSearch";
import { uploadLetualMainPhoto } from "@/lib/ozonImageStorage";
import type { LetualResultRow } from "@/lib/letualMainPhotoExcel";

export type LetualProcessVariationInput = {
  variationId: number;
};

export type LetualProcessUrlInput = {
  sourceUrl: string;
};

function resolveOpenAiKey(clientKey?: string): string {
  const k = (clientKey ?? "").trim() || (process.env.OPENAI_API_KEY ?? "").trim();
  if (!k) throw new Error("Нужен OpenAI API key (в интерфейсе или OPENAI_API_KEY на сервере)");
  return k;
}

async function processAndUpload(sourceUrl: string): Promise<string> {
  const jpeg = await processLetualMainPhotoFromUrl(sourceUrl);
  return uploadLetualMainPhoto(jpeg, "main.jpg");
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
    let webSource = "";

    if (row.imageUrls.length) {
      const picked = await pickBestLetualPhoto(row.imageUrls, key);
      if (picked.url) {
        sourceUrl = picked.url;
        const best = pickBestFromRanked(picked.ranked) ?? picked.ranked[0];
        if (best) {
          const notes: string[] = [];
          if (!best.isFrontal) notes.push("не фронтальный ракурс — проверить");
          if (best.quality < 50) notes.push("низкое качество источника");
          if (!best.suitable) notes.push(best.reason);
          if (notes.length) {
            comment = `Фото из БД: ${notes.join("; ")}`;
          }
        }
      }
    }

    if (!sourceUrl) {
      const web = await searchLetualWebImages(row.ean, row.productName, row.brandName);
      for (const candidate of web) {
        if (!(await validateImageUrl(candidate.url))) continue;
        const scored = await pickBestLetualPhoto([candidate.url], key);
        if (scored.url && scored.ranked[0]?.suitable) {
          sourceUrl = scored.url;
          webSource = candidate.source;
          break;
        }
        if (!sourceUrl && scored.url) {
          sourceUrl = scored.url;
          webSource = candidate.source;
        }
      }

      if (!sourceUrl && web[0]?.url) {
        sourceUrl = web[0].url;
        webSource = web[0].source;
      }

      if (!sourceUrl) {
        return {
          variationId,
          resultUrl: "",
          comment: "",
          ok: false,
          error: "Нет фото в БД и не найдено подходящее в интернете"
        };
      }

      comment = `Фото из интернета (${webSource || "web"}), проверить вручную`;
    }

    const resultUrl = await processAndUpload(sourceUrl);
    return {
      variationId,
      sourceUrl,
      resultUrl,
      comment,
      previewUrl: resultUrl,
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
