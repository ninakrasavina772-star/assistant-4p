import JSZip from "jszip";

/** formula1 из dataValidation type=list, по номеру столбца (1-based) */
export type SheetColumnValidations = Map<number, string>;
export type WorkbookListValidations = Map<string, SheetColumnValidations>;

function colLettersToIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) {
    n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return n;
}

function parseCellRef(ref: string): { row: number; col: number } | null {
  const m = ref.trim().match(/^\$?([A-Z]+)\$?(\d+)$/i);
  if (!m) return null;
  return { col: colLettersToIndex(m[1]!), row: Number(m[2]) };
}

function columnsInSqref(sqref: string): number[] {
  const cols = new Set<number>();
  for (const part of sqref.split(/\s+/)) {
    if (!part) continue;
    if (part.includes(":")) {
      const [a, b] = part.split(":");
      const c1 = parseCellRef(a!)?.col;
      const c2 = parseCellRef(b!)?.col;
      if (!c1 || !c2) continue;
      const lo = Math.min(c1, c2);
      const hi = Math.max(c1, c2);
      for (let c = lo; c <= hi; c++) cols.add(c);
    } else {
      const c = parseCellRef(part)?.col;
      if (c) cols.add(c);
    }
  }
  return [...cols];
}

function parseSheetValidationsXml(xml: string): SheetColumnValidations {
  const out = new Map<number, string>();
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const validations = doc.getElementsByTagName("dataValidation");
  for (let i = 0; i < validations.length; i++) {
    const dv = validations[i]!;
    if (dv.getAttribute("type") !== "list") continue;
    const sqref = dv.getAttribute("sqref") || "";
    const f1 = dv.getElementsByTagName("formula1")[0]?.textContent?.trim() || "";
    if (!sqref || !f1) continue;
    for (const col of columnsInSqref(sqref)) {
      if (!out.has(col)) out.set(col, f1);
    }
  }
  return out;
}

async function sheetXmlPaths(zip: JSZip): Promise<Map<string, string>> {
  const wbXml = await zip.file("xl/workbook.xml")?.async("string");
  const relsXml = await zip.file("xl/_rels/workbook.xml.rels")?.async("string");
  if (!wbXml || !relsXml) return new Map();

  const wbDoc = new DOMParser().parseFromString(wbXml, "application/xml");
  const relsDoc = new DOMParser().parseFromString(relsXml, "application/xml");

  const relMap = new Map<string, string>();
  const rels = relsDoc.getElementsByTagName("Relationship");
  for (let i = 0; i < rels.length; i++) {
    const id = rels[i]!.getAttribute("Id");
    const target = rels[i]!.getAttribute("Target");
    if (id && target) relMap.set(id, target.replace(/^\//, ""));
  }

  const out = new Map<string, string>();
  const sheets = wbDoc.getElementsByTagName("sheet");
  for (let i = 0; i < sheets.length; i++) {
    const sh = sheets[i]!;
    const name = sh.getAttribute("name");
    if (!name) continue;
    const rId = sh.getAttribute("r:id") ?? sh.getAttribute("id");
    const target = rId ? relMap.get(rId) : null;
    if (!target) continue;
    const path = target.startsWith("xl/") ? target : `xl/${target}`;
    out.set(name, path);
  }
  return out;
}

/** Список валидаций из XML без разворачивания диапазонов на миллионы ячеек (ExcelJS падает на Ozon-шаблонах). */
export async function extractWorkbookListValidations(buf: ArrayBuffer): Promise<WorkbookListValidations> {
  const zip = await JSZip.loadAsync(buf);
  const paths = await sheetXmlPaths(zip);
  const out: WorkbookListValidations = new Map();

  for (const [name, path] of paths) {
    const xml = await zip.file(path)?.async("string");
    if (!xml || !xml.includes("dataValidation")) continue;
    const cols = parseSheetValidationsXml(xml);
    if (cols.size) out.set(name, cols);
  }
  return out;
}
