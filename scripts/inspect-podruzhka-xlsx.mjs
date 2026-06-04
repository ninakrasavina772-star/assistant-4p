/**
 * node scripts/inspect-podruzhka-xlsx.mjs "path/to/file.xlsx"
 */
import ExcelJS from "exceljs";
import path from "path";

const file = process.argv[2];
if (!file) {
  console.error("Usage: node scripts/inspect-podruzhka-xlsx.mjs <xlsx>");
  process.exit(1);
}

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
  if (/^https?:\/\//i.test(t)) return t;
  return t;
}

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(file);
const ws = wb.worksheets[0];
const hr = 1;
console.log("File:", path.basename(file));
console.log("Rows:", ws.rowCount);

const headers = [];
for (let c = 1; c <= 20; c++) {
  const l = cellPlain(ws.getCell(hr, c).value).trim();
  if (l) headers.push({ c, l });
}
console.log("Headers:", headers.map((h) => `${h.c}:${h.l}`).join(" | "));

const col = Object.fromEntries(
  headers.map((h) => [h.l.toLowerCase().replace(/\s+/g, " "), h.c])
);

for (let r = 2; r <= ws.rowCount; r++) {
  const brand = cellPlain(ws.getCell(r, col["brand name"] ?? 3).value);
  const name = cellPlain(ws.getCell(r, col["name"] ?? 2).value).slice(0, 40);
  const foto = cellUrl(ws.getCell(r, col["foto"] ?? 6));
  const ml = cellPlain(ws.getCell(r, col["ml"] ?? 7).value);
  const model = cellPlain(ws.getCell(r, col["model"] ?? 12).value).slice(0, 30);
  const n1 = cellPlain(ws.getCell(r, col["note 1"] ?? 9).value).slice(0, 35);
  const st = cellPlain(ws.getCell(r, col["статус нот"] ?? col["notes_status"] ?? 14).value);
  const renderOk =
    st === "ok" && model && n1 && cellPlain(ws.getCell(r, col["note 2"] ?? 10).value) && cellPlain(ws.getCell(r, col["note 3"] ?? 11).value);
  console.log(
    `r${r} render=${renderOk ? "YES" : "SKIP"} st=${st || "-"} model=${model || "-"} foto=${foto.slice(0, 55)} ml=${ml}`
  );
}
