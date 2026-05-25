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
  return [...keyToIds.entries()]
    .filter(([, ids]) => ids.size >= 2)
    .map(([ean, ids]) => ({ ean, ids }));
}

const products = [
  { id: 69095402, eans: ["20714052959", "20714156893"] },
  { id: 1187048, eans: ["0020714052959", "0020714156893"] },
  { id: 60276228, eans: ["020714052959"] },
  { id: 65455124, eans: ["020714156893"] }
];

const groups = buildGroups(products);
const hasIds = (g, need) => need.every((id) => g.ids.has(id));
const g52959 = groups.find((g) => hasIds(g, [69095402, 1187048, 60276228]));
const g56893 = groups.find((g) => hasIds(g, [69095402, 1187048, 65455124]));

console.log("20714052959 group", g52959 ? [...g52959.ids].sort() : "MISSING");
console.log("20714156893 group", g56893 ? [...g56893.ids].sort() : "MISSING");

const phantom = [
  { id: 54596346, eans: ["3349668630035"] },
  { id: 61899225, eans: ["3349668630059"] },
  { id: 77250194, eans: ["3349668630028", "3349668630035", "3349668630042", "3349668630059"] }
];
const phGroups = buildGroups(phantom);
const mergedWrong = phGroups.find(
  (g) => g.ids.has(54596346) && g.ids.has(61899225)
);
console.log("phantom disjoint pair in one group", mergedWrong ? "BAD" : "OK");

const ok = Boolean(g52959 && g56893 && !mergedWrong);
console.log(ok ? "OK" : "FAIL");
process.exit(ok ? 0 : 1);
