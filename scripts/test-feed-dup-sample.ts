/**
 * Сэмпл фида: счётчики EAN-групп и пар по названию.
 * npx tsx scripts/test-feed-dup-sample.ts [path-to-csv]
 */
import { readFileSync } from "fs";
import { findIntraSiteDuplicates } from "../lib/intraSiteDups";
import { parsePartnersFeedCsv } from "../lib/partnersFeedCsv";

const path =
  process.argv[2] ||
  String.raw`C:\Users\guita\.cursor\projects\c-Users-guita-Desktop\uploads\feed-live-check.csv`;

async function main() {
  const csv = readFileSync(path, "utf-8");
  const all = await parsePartnersFeedCsv(csv);
  const products = all.slice(0, 800);
  const dups = await findIntraSiteDuplicates(products, "ru");
  const eanCardIds = new Set<number>();
  for (const g of dups.eanGroups) for (const c of g.products) eanCardIds.add(c.id);

  let overlap = 0;
  for (const row of dups.namePhotoPairs) {
    if (eanCardIds.has(row.a.id) || eanCardIds.has(row.b.id)) overlap++;
  }

  console.log("feed sample:", path);
  console.log("products parsed:", all.length, "tested:", products.length);
  console.log("EAN groups:", dups.eanGroups.length, "cards in EAN:", eanCardIds.size);
  console.log("Name pairs:", dups.namePhotoPairs.length);
  console.log("Name pairs touching EAN tab:", overlap, overlap === 0 ? "OK" : "BAD");
  process.exit(overlap === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
