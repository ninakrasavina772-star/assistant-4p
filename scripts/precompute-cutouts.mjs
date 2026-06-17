/**
 * Один раз: снять фон со всех уникальных foto из Excel и залить в Yandex-кэш.
 * Запуск на компьютере (не на Vercel). Нужны YANDEX_S3_* в .env.local.
 *
 * npm run cutouts -- "путь/к/файлу.xlsx"
 */
import XLSX from "xlsx";
import { rmbg } from "rmbg";
import { saveCutoutToCache } from "../lib/podruzhkaAiCutout.ts";
import { preferOzonFullSizeUrl } from "../lib/podruzhkaImageFetch.ts";

const excelPath =
  process.argv[2] ??
  "C:/Users/guita/Desktop/4 партнерс/косметика остатки с ошибками-cosmetics-infographic-part1.xlsx";

const wb = XLSX.readFile(excelPath);
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

const urls = new Set();
for (let i = 1; i < rows.length; i++) {
  const u = String(rows[i][4] ?? "").trim();
  if (u.startsWith("http")) urls.add(preferOzonFullSizeUrl(u));
}

console.log("Уникальных foto:", urls.size);
let ok = 0;
for (const url of urls) {
  const t0 = Date.now();
  const res = await fetch(url);
  const buf = Buffer.from(await res.arrayBuffer());
  const cut = Buffer.from(await rmbg(buf));
  const saved = await saveCutoutToCache(url, cut);
  ok++;
  console.log(ok, "/", urls.size, `${Date.now() - t0}ms`, saved ?? "(кэш не записан)", url.slice(-48));
}
console.log("Готово:", ok);
