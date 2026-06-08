import { stripPartnersFeedPreamble } from "../lib/partnersFeedCsv.ts";
import { pickBestFotoUrl, parseFotoUrlsFromText } from "../lib/podruzhkaFotoPick.ts";

const feedUrl = process.argv[2] ?? "https://store.4partners.io/my/feed/r-parfyumeriya-1184649-1234.csv";
const needle = process.argv[3] ?? "124944302";

function parseImageUrls(cell) {
  return parseFotoUrlsFromText(cell);
}

function normCell(h) {
  return String(h ?? "").trim();
}

console.log("Fetching", feedUrl);
const res = await fetch(feedUrl, { headers: { "User-Agent": "probe/1" } });
const csv = await res.text();
const stripped = stripPartnersFeedPreamble(csv);

const XLSX = await import("xlsx");
const wb = XLSX.read(stripped, { type: "string" });
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {
  header: 1,
  defval: "",
  raw: false
});

const headers = (rows[0] ?? []).map(normCell);
const artIdx = headers.findIndex((h) => normCell(h).toLowerCase() === "артикул");
const idIdx = headers.findIndex((h) => h.toLowerCase().includes("id товара"));
const imgIdx = headers.findIndex((h) => h === "Изображения варианта");
const nameIdx = headers.findIndex((h) => h === "Название товара");

let found = 0;
for (let r = 1; r < rows.length; r++) {
  const row = rows[r];
  const art = normCell(row[artIdx]);
  if (art !== needle) continue;
  found++;
  const imgs = parseImageUrls(normCell(row[imgIdx]));
  const picked = pickBestFotoUrl(imgs, "perfume");
  console.log("\n=== Строка фида | артикул", art, "| id", row[idIdx], "===");
  console.log(normCell(row[nameIdx]));
  console.log("Фото в ячейке (" + imgs.length + "):");
  imgs.forEach((u, i) => console.log(`  ${i + 1}. ${u}`));
  console.log("\nВЫБРАНО:", picked);
}

if (!found) {
  console.log("Артикул", needle, "не найден среди", rows.length - 1, "строк");
}
