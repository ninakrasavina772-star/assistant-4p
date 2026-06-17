/**
 * Один раз прогнать все уникальные foto из Excel — сохранить cut-out в Yandex-кэш.
 * Нужны YANDEX_S3_* в .env.local. Без лимитов, без API-ключей.
 *
 * npx tsx scripts/precompute-cutouts.mjs "путь/к/файлу.xlsx"
 */
import XLSX from "xlsx";
import { fetchAiCutout } from "../lib/podruzhkaAiCutout.ts";
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

console.log("unique foto:", urls.size);
let ok = 0;
for (const url of urls) {
  const t0 = Date.now();
  const res = await fetch(url);
  const buf = Buffer.from(await res.arrayBuffer());
  await fetchAiCutout(url, buf);
  ok++;
  console.log(ok, "/", urls.size, `${Date.now() - t0}ms`, url.slice(-40));
}
console.log("done", ok);
