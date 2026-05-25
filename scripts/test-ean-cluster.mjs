/**
 * Проверка склейки EAN (как в compare) без API.
 * node scripts/test-ean-cluster.mjs
 */

function expandEanDigitsForIndex(digits) {
  const d = String(digits).replace(/\D/g, "");
  if (d.length < 6) return [];
  const out = new Set();
  const add = (s) => {
    if (s.length >= 6) out.add(s);
  };
  add(d);
  const trimmed = d.replace(/^0+/, "") || "0";
  add(trimmed);
  for (const len of [12, 13, 14]) {
    if (trimmed.length <= len) add(trimmed.padStart(len, "0"));
  }
  if (d.length <= 14) add(d.padStart(14, "0"));
  if (d.length >= 14) {
    add(d.slice(-13));
    add(d.slice(-12));
  }
  return [...out];
}

function collectKeys(eans) {
  const keys = new Set();
  for (const raw of eans) {
    const d = String(raw).replace(/\D/g, "");
    if (d.length < 6) continue;
    for (const k of expandEanDigitsForIndex(d)) keys.add(k);
  }
  return keys;
}

function buildGroups(products) {
  const keyToIds = new Map();
  for (const p of products) {
    for (const k of collectKeys(p.eans)) {
      if (!keyToIds.has(k)) keyToIds.set(k, new Set());
      keyToIds.get(k).add(p.id);
    }
  }
  const uf = new Map();
  const find = (x) => {
    if (!uf.has(x)) uf.set(x, x);
    let r = uf.get(x);
    while (r !== uf.get(r)) r = uf.get(r);
    let y = x;
    while (y !== r) {
      const n = uf.get(y);
      uf.set(y, r);
      y = n;
    }
    return r;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) uf.set(ra, rb);
  };
  for (const p of products) find(p.id);
  for (const ids of keyToIds.values()) {
    const arr = [...ids];
    for (let i = 1; i < arr.length; i++) union(arr[0], arr[i]);
  }
  const rootTo = new Map();
  for (const p of products) {
    const r = find(p.id);
    if (!rootTo.has(r)) rootTo.set(r, new Set());
    rootTo.get(r).add(p.id);
  }
  return [...rootTo.values()].filter((s) => s.size >= 2);
}

const products = [
  { id: 69095402, eans: ["20714052959", "20714156893"] },
  { id: 1187048, eans: ["0020714052959", "0020714156893"] },
  { id: 60276228, eans: ["020714052959"] },
  { id: 65455124, eans: ["020714156893"] }
];

const groups = buildGroups(products);
const g52959 = groups.find(
  (s) => s.has(69095402) && s.has(1187048) && s.has(60276228)
);
const g56893 = groups.find(
  (s) => s.has(69095402) && s.has(1187048) && s.has(65455124)
);

console.log("20714052959 group", g52959 ? [...g52959].sort() : "MISSING");
console.log("20714156893 group", g56893 ? [...g56893].sort() : "MISSING");
const ok = Boolean(g52959 && g56893);
console.log(ok ? "OK" : "FAIL");
process.exit(ok ? 0 : 1);
