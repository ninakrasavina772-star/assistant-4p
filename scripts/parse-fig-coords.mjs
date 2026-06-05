/**
 * node scripts/parse-fig-coords.mjs "path/to/file.fig"
 */
import { readFileSync } from "fs";
import { parseFig } from "openfig-core";

const figPath = process.argv[2];
if (!figPath) {
  console.error("Usage: node scripts/parse-fig-coords.mjs <file.fig>");
  process.exit(1);
}

const doc = parseFig(new Uint8Array(readFileSync(figPath)));

function nodeId(guid) {
  if (!guid) return "";
  return `${guid.sessionID}:${guid.localID}`;
}

function localPos(node) {
  const t = node.transform;
  if (!t) return { x: 0, y: 0 };
  return { x: Math.round(t.m02 ?? 0), y: Math.round(t.m12 ?? 0) };
}

function sizeOf(node) {
  const s = node.size;
  if (!s) return { w: 0, h: 0 };
  return { w: Math.round(s.x ?? 0), h: Math.round(s.y ?? 0) };
}

function textOf(node) {
  return (node.textData?.characters ?? node.characters ?? "").trim();
}

function walk(nodeIdStr, ox, oy, depth, out) {
  const node = doc.nodeMap.get(nodeIdStr);
  if (!node) return;
  const lp = localPos(node);
  const sz = sizeOf(node);
  const x = ox + lp.x;
  const y = oy + lp.y;
  const text = textOf(node);

  out.push({
    depth,
    type: node.type,
    name: (node.name ?? "").trim(),
    text,
    x,
    y,
    w: sz.w,
    h: sz.h,
    fontSize: node.fontSize ? Math.round(node.fontSize) : null,
    font: node.fontName?.family ?? null,
    fontStyle: node.fontName?.style ?? null
  });

  const kids = doc.childrenMap.get(nodeIdStr) ?? [];
  for (const child of kids) {
    walk(nodeId(child.guid), x, y, depth + 1, out);
  }
}

const roots = doc.nodes.filter((n) => {
  const pid = n.parentIndex?.guid;
  if (!pid) return n.type === "DOCUMENT" || n.type === "CANVAS";
  const parent = doc.nodeMap.get(nodeId(pid));
  return !parent || parent.type === "DOCUMENT" || parent.type === "CANVAS";
});

const all = [];
for (const r of roots) {
  walk(nodeId(r.guid), 0, 0, 0, all);
}

console.log("Frame:", doc.meta?.client_meta?.render_coordinates ?? "1024×1365");
console.log("Nodes:", doc.nodes.length);
console.log("---");

const rows = all
  .filter((n) => n.w > 0 || n.h > 0 || n.text)
  .sort((a, b) => a.y - b.y || a.x - b.x);

for (const n of rows) {
  const pad = "  ".repeat(Math.min(n.depth, 3));
  const label = n.text ? `${n.name} "${n.text}"` : n.name;
  const font = n.fontSize ? ` ${n.fontSize}px ${n.font ?? ""}` : "";
  console.log(
    `${pad}${n.type.padEnd(18)} ${label.padEnd(42)} @ ${n.x},${n.y}  ${n.w}×${n.h}${font}`
  );
}
