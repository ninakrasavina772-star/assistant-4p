/**
 * При деплое: подготовить cut-out для каталога (только если нет в кэше).
 * PREWARM_COSMETICS_CUTOUTS=0 — отключить.
 */
import { rmbg } from "rmbg";
import { BUILTIN_COSMETICS_FOTO_URLS } from "../lib/builtinCosmeticsFotoUrls.ts";
import {
  cosmeticsCutoutPublicUrl,
  saveCutoutToCache
} from "../lib/podruzhkaAiCutout.ts";
import { preferOzonFullSizeUrl } from "../lib/podruzhkaImageFetch.ts";

if (process.env.PREWARM_COSMETICS_CUTOUTS === "0") {
  console.log("[cutouts-prewarm] skipped (PREWARM_COSMETICS_CUTOUTS=0)");
  process.exit(0);
}

if (!process.env.YANDEX_S3_BUCKET?.trim()) {
  console.log("[cutouts-prewarm] skipped (no YANDEX_S3_BUCKET)");
  process.exit(0);
}

let done = 0;
for (const raw of BUILTIN_COSMETICS_FOTO_URLS) {
  const url = preferOzonFullSizeUrl(raw);
  const cached = cosmeticsCutoutPublicUrl(url);
  if (cached) {
    try {
      const head = await fetch(cached, { method: "HEAD", signal: AbortSignal.timeout(15_000) });
      if (head.ok) {
        console.log("[cutouts-prewarm] cache hit", url.slice(-36));
        continue;
      }
    } catch {
      /* generate */
    }
  }

  const t0 = Date.now();
  const res = await fetch(url, { signal: AbortSignal.timeout(45_000) });
  if (!res.ok) {
    console.warn("[cutouts-prewarm] fetch fail", res.status, url);
    continue;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const cut = Buffer.from(await rmbg(buf));
  await saveCutoutToCache(url, cut);
  done++;
  console.log("[cutouts-prewarm] saved", done, `${Date.now() - t0}ms`, url.slice(-36));
}

console.log("[cutouts-prewarm] new:", done);
