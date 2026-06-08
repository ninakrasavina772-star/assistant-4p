/**
 * node scripts/probe-perfume-foto-visual.mjs [article]
 * Скачивает строку из фида 4Partners и прогоняет серверный pick (sharp).
 */
import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const needle = (process.argv[2] ?? "124944302").replace(/^tpv_/, "");
const feedUrl =
  process.env.FEED_URL ??
  "https://store.4partners.io/my/feed/r-parfyumeriya-1184649-1234.csv";

const tmpCsv = path.join(os.tmpdir(), `probe-foto-${needle}.csv`);

console.log("Downloading feed…");
const dl = spawnSync("curl", ["-fsSL", "-o", tmpCsv, feedUrl], { encoding: "utf8" });
if (dl.status !== 0) {
  console.error("curl failed:", dl.stderr || dl.stdout);
  process.exit(1);
}

const raw = fs.readFileSync(tmpCsv, "utf8").replace(/^\uFEFF/, "");
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
const imgIdx = headers.indexOf("Изображения варианта");
const nameIdx = headers.indexOf("Название товара");

const probeScript = `
import { parseFotoUrlsFromText } from "../lib/podruzhkaFotoPick.ts";
import { pickBestPerfumeFotoServer } from "../lib/podruzhkaFotoPickServer.ts";

const imgs = parseFotoUrlsFromText(process.env.IMGS ?? "");
const { url, ranked } = await pickBestPerfumeFotoServer(imgs);
console.log(JSON.stringify({ url, ranked, imgs }, null, 2));
`;

const probePath = path.join(__dirname, "_probe-pick-run.mjs");
fs.writeFileSync(probePath, probeScript);

let found = false;
for (let r = 1; r < rows.length; r++) {
  const cells = rows[r];
  const art = String(cells[artIdx] ?? "").trim();
  if (!art.includes(needle)) continue;
  found = true;
  const imgs = String(cells[imgIdx] ?? "");
  console.log("\n===", art, "—", String(cells[nameIdx] ?? "").slice(0, 80), "===");
  const run = spawnSync("npx", ["tsx", probePath], {
    cwd: path.join(__dirname, ".."),
    encoding: "utf8",
    env: { ...process.env, IMGS: imgs }
  });
  if (run.status !== 0) {
    console.error(run.stderr || run.stdout);
    process.exit(1);
  }
  console.log(run.stdout);
  break;
}

fs.unlinkSync(probePath);
if (!found) console.log("Артикул", needle, "не найден");
