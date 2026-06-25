import type { LetualPhotoScore } from "@/lib/letualPhotoAi";

export type LetualPickStatus = "ok" | "review" | "no_photo" | "manual";

export type LetualGalleryPhoto = {
  url: string;
  variationId: number;
  matchType: "own" | "same_ean" | "same_product";
};

export type LetualPickRow = {
  variationId: number;
  productName: string;
  brandName: string;
  ean: string | null;
  sourceUrl: string;
  sourceLabel: string;
  status: LetualPickStatus;
  comment: string;
  previewUrl?: string;
  ranked?: LetualPhotoScore[];
  error?: string;
};

export type LetualGenerateItem = {
  variationId?: number;
  sourceUrl: string;
};

export type LetualGenerateRow = {
  variationId?: number;
  sourceUrl: string;
  resultUrl: string;
  comment: string;
  previewUrl?: string;
  ok: boolean;
  error?: string;
};
