/**
 * Проверка вкладки «по названию»: исключение EAN-дублей, Phantom не склеивается по разным EAN.
 * npx tsx scripts/test-name-tab.ts
 */
import { findIntraSiteDuplicates } from "../lib/intraSiteDups";
import type { FpProduct } from "../lib/types";

function p(
  id: number,
  eans: string[],
  name: string,
  brand: string,
  volume?: string,
  img?: string
): FpProduct {
  return {
    id,
    name,
    brand: { name: brand },
    eans,
    ...(volume || img
      ? {
          product_variation: {
            v1: {
              ...(volume ? { volume } : {}),
              ...(img ? { images: [img] } : {})
            }
          }
        }
      : {})
  };
}

async function main() {
  const phantomA = p(
    54596346,
    ["3349668630035"],
    "Rabanne Phantom Intense 100ml",
    "Rabanne",
    "100 ml",
    "https://cdnru.4stand.com/900x900/a/a.jpg"
  );
  const phantomB = p(
    61899225,
    ["3349668630059"],
    "Paco Rabanne Phantom Intense EDT 200 ml",
    "paco rabanne",
    "200 ml",
    "https://cdnru.4stand.com/900x900/b/b.jpg"
  );
  const hub = p(
    77250194,
    ["3349668630028", "3349668630035", "3349668630042", "3349668630059"],
    "Phantom Eau de Parfum Intense",
    "Rabanne",
    "50 ml",
    "https://cdnru.4stand.com/900x900/c/c.jpg"
  );

  const clinique1 = p(1187048, ["20714052959"], "Clinique Happy", "CLINIQUE", "100 ml");
  const clinique2 = p(60276228, ["20714052959"], "Clinique Happy Women", "CLINIQUE", "100 ml");

  const products = [phantomA, phantomB, hub, clinique1, clinique2];
  const dups = await findIntraSiteDuplicates(products, "ru");

  const eanIds = new Set<number>();
  for (const g of dups.eanGroups) {
    for (const c of g.products) eanIds.add(c.id);
  }

  const namePairKeys = new Set(
    dups.namePhotoPairs.map((r) =>
      r.a.id < r.b.id ? `${r.a.id}-${r.b.id}` : `${r.b.id}-${r.a.id}`
    )
  );

  const badPhantom =
    namePairKeys.has("54596346-61899225") ||
    namePairKeys.has("54596346-77250194") && namePairKeys.has("61899225-77250194");

  const cliniqueEan = dups.eanGroups.some(
    (g) =>
      g.products.some((c) => c.id === 1187048) &&
      g.products.some((c) => c.id === 60276228)
  );

  const cliniqueInName = [...namePairKeys].some(
    (k) => k.includes("1187048") && k.includes("60276228")
  );

  console.log("EAN groups:", dups.eanGroups.length, "ids in EAN tab:", eanIds.size);
  console.log("Name pairs:", dups.namePhotoPairs.length);
  console.log("Phantom A/B in name tab:", badPhantom ? "BAD" : "OK");
  console.log("Clinique in EAN group:", cliniqueEan ? "OK" : "MISSING");
  console.log("Clinique same-EAN in name tab (should be no):", cliniqueInName ? "BAD" : "OK");

  const ok = !badPhantom && cliniqueEan && !cliniqueInName;
  console.log(ok ? "ALL OK" : "FAIL");
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
