/**
 * Опционально: подготовить cut-out для каталога (только если нет в кэше).
 * Запуск: PREWARM_COSMETICS_CUTOUTS=1 npm run build:prewarm
 * На Vercel по умолчанию НЕ запускается — иначе сборка зависает на сотнях rmbg.
 */
import XLSX from "xlsx";
import { rmbg } from "rmbg";
import { BUILTIN_COSMETICS_FOTO_URLS } from "../lib/builtinCosmeticsFotoUrls.ts";
import { FEED_COSMETICS_FOTO_URLS } from "../lib/feedCosmeticsFotoUrls.ts";
import {
  cosmeticsCutoutPublicUrl,
  saveCutoutToCache
} from "../lib/podruzhkaAiCutout.ts";
import { preferOzonFullSizeUrl } from "../lib/podruzhkaImageFetch.ts";

function collectUrlsFromExcel(excelPath) {
  const urls = new Set();
  try {
    const wb = XLSX.readFile(excelPath);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
    for (let i = 1; i < rows.length; i++) {
      const u = String(rows[i][4] ?? "").trim();
      if (u.startsWith("http")) urls.add(preferOzonFullSizeUrl(u));
    }
  } catch (e) {
    console.warn("[cutouts-prewarm] excel skip:", e instanceof Error ? e.message : e);
  }
  return urls;
}

if (process.env.PREWARM_COSMETICS_CUTOUTS !== "1") {
  console.log("[cutouts-prewarm] skipped (set PREWARM_COSMETICS_CUTOUTS=1 to enable)");
  process.exit(0);
}

if (process.env.VERCEL === "1") {
  console.log("[cutouts-prewarm] skipped on Vercel — run locally: npm run cutouts");
  process.exit(0);
}

if (!process.env.YANDEX_S3_BUCKET?.trim()) {
  console.log("[cutouts-prewarm] skipped (no YANDEX_S3_BUCKET)");
  process.exit(0);
}

const allUrls = new Set([
  ...BUILTIN_COSMETICS_FOTO_URLS.map(preferOzonFullSizeUrl),
  ...FEED_COSMETICS_FOTO_URLS.map(preferOzonFullSizeUrl)
]);
const excelPath = process.env.COSMETICS_PREWARM_XLSX?.trim();
if (excelPath) {
  for (const u of collectUrlsFromExcel(excelPath)) allUrls.add(u);
}
console.log("[cutouts-prewarm] urls:", allUrls.size);

let done = 0;
let hit = 0;
for (const url of allUrls) {
  const cached = cosmeticsCutoutPublicUrl(url);
  if (cached) {
    try {
      const head = await fetch(cached, { method: "HEAD", signal: AbortSignal.timeout(15_000) });
      if (head.ok) {
        hit++;
        continue;
      }
    } catch {
      /* generate */
    }
  }

  const t0 = Date.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(45_000) });
    if (!res.ok) {
      console.warn("[cutouts-prewarm] fetch fail", res.status, url.slice(-48));
      continue;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const cut = Buffer.from(await rmbg(buf));
    await saveCutoutToCache(url, cut);
    done++;
    console.log("[cutouts-prewarm] saved", done, `${Date.now() - t0}ms`, url.slice(-48));
  } catch (e) {
    console.warn("[cutouts-prewarm] fail", url.slice(-48), e instanceof Error ? e.message : e);
  }
}

console.log("[cutouts-prewarm] cache hit:", hit, "new:", done);
