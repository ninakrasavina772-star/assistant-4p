/**
 * node scripts/debug-podruzhka-render.mjs
 */
import ExcelJS from "exceljs";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const xlsx =
  process.argv[2] ||
  "c:\\Users\\guita\\Desktop\\4 партнерс\\задачи\\дляинфографики подружка образец-infographic (5).xlsx";

function cellPlain(v) {
  if (v == null) return "";
  if (typeof v === "object" && "text" in v && v.text) return String(v.text);
  if (typeof v === "object" && "result" in v) return String(v.result ?? "");
  return String(v);
}

function cellUrl(cell) {
  const v = cell.value;
  if (v && typeof v === "object" && "hyperlink" in v && v.hyperlink) return String(v.hyperlink);
  const t = cellPlain(v);
  const m = t.match(/https?:\/\/\S+/i);
  return m ? m[0] : t;
}

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(xlsx);
const ws = wb.worksheets[0];
const cols = {};
for (let c = 1; c <= 20; c++) {
  const h = cellPlain(ws.getCell(1, c).value).trim().toLowerCase();
  if (h) cols[h] = c;
}

const row = Number(process.argv[3] || 3);
const brand = cellPlain(ws.getCell(row, cols["brand name"]).value);
const model = cellPlain(ws.getCell(row, cols["model"]).value);
const foto = cellUrl(ws.getCell(row, cols["foto"]));
const notes = [1, 2, 3].map((i) => ({
  title: cellPlain(ws.getCell(row, cols[`note ${i}`]).value).split("\n")[0] || "A",
  desc: cellPlain(ws.getCell(row, cols[`note ${i}`]).value).split("\n").slice(1).join(" ") || "desc"
}));

console.log("Row", row, brand, model, foto.slice(0, 60));

process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: "commonjs" });
const { renderInfographicDetailed } = await import(
  path.join(root, ".next/server/chunks/..") 
).catch(() => null);

// dynamic import compiled - use tsx if available
let render;
try {
  const mod = await import("../lib/podruzhkaCanvasRender.ts");
  render = mod.renderInfographicDetailed;
} catch {
  try {
    const { register } = await import("tsx/esm/api");
    register();
    const mod = await import("../lib/podruzhkaCanvasRender.ts");
    render = mod.renderInfographicDetailed;
  } catch (e) {
    console.error("Run: npx tsx scripts/debug-podruzhka-render.mjs");
    process.exit(1);
  }
}

const out = path.join(root, "public", "podruzhka", `debug-row${row}.jpg`);
const r = await render({
  brandName: brand,
  productType: "духи",
  model,
  ml: cellPlain(ws.getCell(row, cols["ml"]).value),
  fotoUrl: foto,
  notes
});

console.log({
  fotoLoaded: r.fotoLoaded,
  layoutValidationOk: r.layoutValidationOk,
  layoutValidationPasses: r.layoutValidationPasses,
  layoutValidationError: r.layoutValidationError,
  bufferLen: r.buffer?.length
});

if (r.buffer?.length) {
  fs.writeFileSync(out, r.buffer);
  console.log("Wrote", out);
}
