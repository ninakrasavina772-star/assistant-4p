import type ExcelJS from "exceljs";
import { cellPlainValue } from "@/lib/ozonImageExcel";
import type { LetualGalleryPhoto } from "@/lib/letualPickTypes";
import {
  dedupeImageUrlsSemantic,
  imageUrlIdentityKey
} from "@/lib/templateGenerator/imageUrlDedupe";
import {
  ensurePhotoReviewColumn,
  formatImageCellValue,
  formatPhotoReviewValue,
  parseImageUrls
} from "@/lib/templateGenerator/photos";
import { DEFAULT_PHOTO_REVIEW_COLUMN, normHeader } from "@/lib/templateGenerator/presets";
import { normVariationSku } from "@/lib/templateGenerator/parseVariationIds";
import type { TemplateRowContext, TemplateSheetScan } from "@/lib/templateGenerator/types";

export type PhotoReviewCandidate = {
  url: string;
  selected: boolean;
  /** Главное фото (первое в галерее Excel) */
  isMain: boolean;
  variationId: number;
  matchType: LetualGalleryPhoto["matchType"];
  /** URL после обработки Летуаль (1000×1000) */
  processedUrl?: string;
};

export type PhotoReviewItem = {
  row: number;
  sku: string;
  variationId: number;
  productName: string;
  brandName: string;
  ean: string | null;
  /** @deprecated используйте candidate с isMain */
  mainUrl: string | null;
  candidates: PhotoReviewCandidate[];
  /** Строка уже применена в Excel */
  processed: boolean;
  /** AI проставил галочки */
  aiPicked?: boolean;
};

const MATCH_LABEL: Record<LetualGalleryPhoto["matchType"], string> = {
  own: "эта вариация",
  same_ean: "тот же EAN",
  same_product: "та же карточка"
};

export function photoMatchLabel(matchType: LetualGalleryPhoto["matchType"]): string {
  return MATCH_LABEL[matchType];
}

export function photoReviewMainCandidate(item: PhotoReviewItem): PhotoReviewCandidate | undefined {
  return item.candidates.find((c) => c.isMain) ?? item.candidates[0];
}

export function photoReviewMainUrl(item: PhotoReviewItem): string | null {
  const main = photoReviewMainCandidate(item);
  return main ? main.processedUrl || main.url : item.mainUrl;
}

function findCol(scan: TemplateSheetScan, header: string): number | null {
  const want = normHeader(header);
  for (const c of scan.columns) {
    if (normHeader(c.header) === want) return c.col;
  }
  return null;
}

function pickProductName(cells: Record<string, string>): string {
  return (
    cells["Название товара *"] ??
    cells["Название товара"] ??
    cells["name"] ??
    ""
  ).trim();
}

function pickBrand(cells: Record<string, string>): string {
  return (cells["Бренд *"] ?? cells["Бренд"] ?? "").trim();
}

function metaForUrl(
  url: string,
  galleryPhotos: LetualGalleryPhoto[],
  variationId: number
): Pick<PhotoReviewCandidate, "variationId" | "matchType"> {
  const hit = galleryPhotos.find((p) => imageUrlIdentityKey(p.url) === imageUrlIdentityKey(url));
  return {
    variationId: hit?.variationId ?? variationId,
    matchType: hit?.matchType ?? "own"
  };
}

function resolveMainKey(gallery: string[], galleryPhotos: LetualGalleryPhoto[]): string {
  if (gallery[0]) return imageUrlIdentityKey(gallery[0]);
  const own = galleryPhotos.find((p) => p.matchType === "own");
  if (own) return imageUrlIdentityKey(own.url);
  if (galleryPhotos[0]) return imageUrlIdentityKey(galleryPhotos[0].url);
  return "";
}

function rowLooksProcessed(gallery: string[], reviewUrls: string[]): boolean {
  return gallery.length > 0 && reviewUrls.length > 0;
}

function buildCandidatesFromGallery(
  galleryPhotos: LetualGalleryPhoto[],
  variationId: number,
  gallery: string[],
  reviewUrls: string[],
  aiSelected?: { mainUrl: string; extraUrls: string[] }
): PhotoReviewCandidate[] {
  const urls = dedupeImageUrlsSemantic([
    ...galleryPhotos.map((p) => p.url),
    ...gallery,
    ...reviewUrls
  ]);
  if (!urls.length) return [];

  const mainKey = aiSelected?.mainUrl
    ? imageUrlIdentityKey(aiSelected.mainUrl)
    : resolveMainKey(gallery, galleryPhotos);
  const extraKeys = new Set(
    (aiSelected?.extraUrls ?? (reviewUrls.length ? reviewUrls : gallery.slice(1))).map(
      imageUrlIdentityKey
    )
  );
  const hasExplicitSelection = reviewUrls.length > 0 || Boolean(aiSelected);

  return urls.map((url) => {
    const key = imageUrlIdentityKey(url);
    const isMain = key === mainKey || (!mainKey && urls[0] === url);
    const meta = metaForUrl(url, galleryPhotos, variationId);
    let selected = false;
    if (isMain) {
      selected = false;
    } else if (hasExplicitSelection) {
      selected = extraKeys.has(key);
    } else {
      selected = meta.matchType === "own";
    }
    return { url, isMain, selected, ...meta };
  });
}

/** Собрать карточки для UI из Metabase-галерей + текущего шаблона. */
export function buildPhotoReviewItems(
  contexts: TemplateRowContext[],
  galleries: Record<number, LetualGalleryPhoto[]>,
  ws: ExcelJS.Worksheet,
  scan: TemplateSheetScan,
  imageHeader: string
): PhotoReviewItem[] {
  const imageCol = findCol(scan, imageHeader) ?? scan.imageCol;
  const reviewCol = findCol(scan, DEFAULT_PHOTO_REVIEW_COLUMN);
  const out: PhotoReviewItem[] = [];

  for (const ctx of contexts) {
    const variationId = normVariationSku(ctx.sku);
    if (!variationId) continue;

    const galleryPhotos = galleries[variationId] ?? [];
    if (!galleryPhotos.length) continue;

    const imageText = imageCol
      ? cellPlainValue(ws.getCell(ctx.row, imageCol).value).trim()
      : "";
    const gallery = parseImageUrls(imageText);
    const reviewText = reviewCol
      ? cellPlainValue(ws.getCell(ctx.row, reviewCol).value).trim()
      : "";
    const reviewUrls = parseImageUrls(reviewText.replace(/\n/g, " "));

    const candidates = buildCandidatesFromGallery(
      galleryPhotos,
      variationId,
      gallery,
      reviewUrls
    );
    if (!candidates.length) continue;

    const main = photoReviewMainUrl({ row: ctx.row, sku: ctx.sku, variationId, productName: "", brandName: "", ean: null, mainUrl: null, candidates, processed: false });

    out.push({
      row: ctx.row,
      sku: ctx.sku,
      variationId,
      productName: pickProductName(ctx.cells),
      brandName: pickBrand(ctx.cells),
      ean: null,
      mainUrl: main,
      candidates,
      processed: rowLooksProcessed(gallery, reviewUrls)
    });
  }

  return out;
}

/** Fallback: только из ячеек Excel (без Metabase). */
export function loadPhotoReviewFromWorkbook(
  ws: ExcelJS.Worksheet,
  scan: TemplateSheetScan,
  opts: { imageHeader: string; reviewHeader?: string; rows?: number[] }
): PhotoReviewItem[] {
  const imageCol = findCol(scan, opts.imageHeader) ?? scan.imageCol;
  const reviewHeader = opts.reviewHeader ?? DEFAULT_PHOTO_REVIEW_COLUMN;
  const reviewCol = findCol(scan, reviewHeader);
  const rowSet = opts.rows?.length ? new Set(opts.rows) : null;
  const out: PhotoReviewItem[] = [];

  for (let row = scan.dataStartRow; row <= ws.rowCount; row++) {
    if (rowSet && !rowSet.has(row)) continue;
    const sku = scan.skuCol
      ? cellPlainValue(ws.getCell(row, scan.skuCol).value).trim()
      : "";
    const variationId = normVariationSku(sku);
    if (!variationId) continue;

    const imageText = imageCol ? cellPlainValue(ws.getCell(row, imageCol).value).trim() : "";
    const gallery = parseImageUrls(imageText);
    const reviewUrls = parseImageUrls(
      (reviewCol ? cellPlainValue(ws.getCell(row, reviewCol).value) : "").replace(/\n/g, " ")
    );

    const urls = dedupeImageUrlsSemantic([...gallery, ...reviewUrls]);
    if (!urls.length) continue;

    const mainKey = gallery[0] ? imageUrlIdentityKey(gallery[0]) : imageUrlIdentityKey(urls[0]!);
    const extraKeys = new Set((reviewUrls.length ? reviewUrls : gallery.slice(1)).map(imageUrlIdentityKey));

    const cells: Record<string, string> = {};
    for (const c of scan.columns) {
      const v = cellPlainValue(ws.getCell(row, c.col).value).trim();
      if (v) cells[c.header] = v;
    }

    const candidates: PhotoReviewCandidate[] = urls.map((url) => {
      const key = imageUrlIdentityKey(url);
      const isMain = key === mainKey;
      return {
        url,
        isMain,
        variationId,
        matchType: "own" as const,
        selected: !isMain && extraKeys.has(key)
      };
    });

    out.push({
      row,
      sku,
      variationId,
      productName: pickProductName(cells),
      brandName: pickBrand(cells),
      ean: null,
      mainUrl: photoReviewMainUrl({ row, sku, variationId, productName: "", brandName: "", ean: null, mainUrl: null, candidates, processed: false }),
      candidates,
      processed: rowLooksProcessed(gallery, reviewUrls)
    });
  }

  return out;
}

export function applyPhotoReviewToWorkbook(
  ws: ExcelJS.Worksheet,
  scan: TemplateSheetScan,
  items: PhotoReviewItem[],
  opts: { imageHeader: string; reviewHeader?: string }
): number {
  const imageCol = findCol(scan, opts.imageHeader) ?? scan.imageCol;
  if (!imageCol) return 0;
  const reviewHeader = opts.reviewHeader ?? DEFAULT_PHOTO_REVIEW_COLUMN;
  let reviewCol = findCol(scan, reviewHeader);
  if (!reviewCol) {
    reviewCol = ensurePhotoReviewColumn(ws, scan.headerRow, reviewHeader);
  }

  let n = 0;
  for (const item of items) {
    const main = photoReviewMainCandidate(item);
    const mainOut = main ? main.processedUrl || main.url : "";
    const extras = item.candidates
      .filter((c) => c.selected && !c.isMain)
      .map((c) => c.processedUrl || c.url)
      .filter(Boolean);
    const gallery = mainOut
      ? [mainOut, ...extras.filter((u) => imageUrlIdentityKey(u) !== imageUrlIdentityKey(mainOut))]
      : extras;
    const unique = dedupeImageUrlsSemantic(gallery.filter(Boolean));
    if (!unique.length) continue;

    ws.getCell(item.row, imageCol).value = formatImageCellValue(unique);
    ws.getCell(item.row, reviewCol).value = extras.length ? formatPhotoReviewValue(extras) : "";
    n++;
  }
  return n;
}

export function mergeAutoPickIntoItems(
  items: PhotoReviewItem[],
  picks: Record<number, { mainUrl: string; extraUrls: string[] }>
): PhotoReviewItem[] {
  return items.map((item) => {
    const pick = picks[item.variationId];
    if (!pick?.mainUrl) return item;
    const mainKey = imageUrlIdentityKey(pick.mainUrl);
    const extraKeys = new Set(pick.extraUrls.map(imageUrlIdentityKey));
    return {
      ...item,
      aiPicked: true,
      mainUrl: pick.mainUrl,
      candidates: item.candidates.map((c) => {
        const key = imageUrlIdentityKey(c.url);
        const isMain = key === mainKey;
        return {
          ...c,
          isMain,
          selected: !isMain && extraKeys.has(key)
        };
      })
    };
  });
}
