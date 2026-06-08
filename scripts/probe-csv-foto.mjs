/**
 * node scripts/probe-csv-foto.mjs <csv-path> [article]
 */
import fs from "fs";
import { pickBestFotoUrl, parseFotoUrlsFromText } from "../lib/podruzhkaFotoPick.ts";

const path = process.argv[2];
const needle = (process.argv[3] ?? "124944302").replace(/^tpv_/, "");

if (!path || !fs.existsSync(path)) {
  console.error("Usage: node scripts/probe-csv-foto.mjs <csv> [article]");
  process.exit(1);
}

const raw = fs.readFileSync(path, "utf8").replace(/^\uFEFF/, "");
const lines = raw.split(/\r?\n/);
let start = 0;
for (let i = 0; i < Math.min(lines.length, 80); i++) {
  if (lines[i].includes("Id товара") && lines[i].includes("Артикул")) {
    start = i;
    break;
  }
}

const csvBody = lines.slice(start).join("\n");
const rows = [];
let row = [];
let cell = "";
let inQ = false;
for (let i = 0; i < csvBody.length; i++) {
  const ch = csvBody[i];
  if (ch === '"') {
    inQ = !inQ;
    continue;
  }
  if (ch === "," && !inQ) {
    row.push(cell);
    cell = "";
    continue;
  }
  if (ch === "\n" && !inQ) {
    row.push(cell);
    rows.push(row);
    row = [];
    cell = "";
    continue;
  }
  cell += ch;
}
if (cell || row.length) {
  row.push(cell);
  rows.push(row);
}

const headers = rows[0] ?? [];
const artIdx = headers.indexOf("Артикул");
const idIdx = headers.indexOf("Id товара");
const imgIdx = headers.indexOf("Изображения варианта");
const nameIdx = headers.indexOf("Название товара");

console.log("CSV rows:", rows.length - 1, "| art col:", artIdx, "| images col:", imgIdx);

function scoreAll(urls) {
  return urls.map((url, i) => {
    const picked = pickBestFotoUrl(urls, "perfume");
    return { url, i, picked: url === picked };
  });
}

const found = [];
for (let r = 1; r < rows.length; r++) {
  const cells = rows[r];
  const art = String(cells[artIdx] ?? "").trim();
  if (!art.includes(needle)) continue;
  const imgs = parseFotoUrlsFromText(String(cells[imgIdx] ?? ""));
  const picked = pickBestFotoUrl(imgs, "perfume");
  found.push({
    art,
    productId: cells[idIdx],
    name: cells[nameIdx],
    imgs,
    picked
  });
}

if (!found.length) {
  console.log("\nАртикул", needle, "не найден в этом CSV.");
  console.log("Примеры артикулов в файле:");
  for (let r = 1; r < Math.min(rows.length, 6); r++) {
    const cells = rows[r];
    console.log(" ", cells[artIdx], "—", String(cells[nameIdx] ?? "").slice(0, 60));
  }
  process.exit(0);
}

for (const f of found) {
  console.log("\n===", f.art, "| id", f.productId, "===");
  console.log(f.name);
  console.log("Кандидаты:");
  f.imgs.forEach((u, i) => console.log(`  ${i + 1}. ${u}`));
  console.log("\nВЫБРАНО:", f.picked);
}
