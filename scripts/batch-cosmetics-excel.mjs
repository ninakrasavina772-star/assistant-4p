import fs from "fs";
import path from "path";
import sharp from "sharp";
import XLSX from "xlsx";
import { fileURLToPath } from "url";
import { preprocessCosmeticsProductBuffer } from "../lib/podruzhkaImageProcess.ts";
import { resolveAdaptiveProductPlacement } from "../lib/podruzhkaProductAdaptive.ts";

const excelPath =
  process.argv[2] ??
  "C:/Users/guita/Desktop/4 партнерс/косметика остатки с ошибками.xlsx";
const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public/podruzhka/batch-test");
fs.mkdirSync(outDir, { recursive: true });

const wb = XLSX.readFile(excelPath);
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

const seen = new Set();
const items = [];
for (let i = 1; i < rows.length; i++) {
  const r = rows[i];
  const url = String(r[4] ?? "").trim();
  if (!url.startsWith("http")) continue;
  if (seen.has(url)) continue;
  seen.add(url);
  items.push({
    row: i + 1,
    sku: String(r[0] ?? i),
    brand: String(r[2] ?? ""),
    url
  });
  if (items.length >= 12) break;
}

async function stats(buf) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  const n = w * h;
  const reach = new Uint8Array(n);
  const q = [];
  const isColored = (i) =>
    data[i * 4 + 3] >= 128 && (data[i * 4] + data[i * 4 + 1] + data[i * 4 + 2]) / 3 < 236;
  const isWhite = (i) =>
    data[i * 4 + 3] >= 250 &&
    (data[i * 4] + data[i * 4 + 1] + data[i * 4 + 2]) / 3 >= 236;

  for (let i = 0; i < n; i++) {
    if (!isColored(i)) continue;
    reach[i] = 1;
    q.push(i);
  }
  while (q.length) {
    const idx = q.pop();
    for (const j of [idx - 1, idx + 1, idx - w, idx + w]) {
      if (j < 0 || j >= n || reach[j]) continue;
      if (data[j * 4 + 3] < 128) continue;
      if (isColored(j) || isWhite(j)) {
        reach[j] = 1;
        q.push(j);
      }
    }
  }

  let orphanWhite = 0;
  let capWhite = 0;
  let sideWhite = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!isWhite(i)) continue;
      if (reach[i]) capWhite++;
      else {
        orphanWhite++;
        if (x < w * 0.12 || x > w * 0.88) sideWhite++;
      }
    }
  }
  return { w, h, orphanWhite, capWhite, sideWhite };
}

const report = [];
for (const item of items) {
  const slug = item.url.split("/").pop()?.replace(/\W+/g, "_") ?? "img";
  const base = `${item.row}-${slug.slice(0, 40)}`;
  try {
    const res = await fetch(item.url, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const input = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(path.join(outDir, `${base}-src.jpg`), input);

    const final = await preprocessCosmeticsProductBuffer(input);
    fs.writeFileSync(path.join(outDir, `${base}-cutout.png`), final);

    const placement = await resolveAdaptiveProductPlacement(input, "cosmetics");
    fs.writeFileSync(path.join(outDir, `${base}-fitted.png`), placement.fit.buffer);

    const pad = 30;
    const gray = await sharp({
      create: {
        width: placement.fit.width + pad * 2,
        height: placement.fit.height + pad * 2,
        channels: 3,
        background: { r: 245, g: 245, b: 245 }
      }
    })
      .composite([{ input: placement.fit.buffer, top: pad, left: pad }])
      .jpeg({ quality: 96 })
      .toBuffer();
    fs.writeFileSync(path.join(outDir, `${base}-gray.jpg`), gray);

    const s = await stats(placement.fit.buffer);
    const row = { ...item, ok: true, ...s };
    report.push(row);
    console.log("OK", row);
  } catch (e) {
    const row = { ...item, ok: false, error: e instanceof Error ? e.message : String(e) };
    report.push(row);
    console.log("FAIL", row);
  }
}

fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));
console.log("saved", outDir);
