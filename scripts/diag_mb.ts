import { runCrossRubricCompare } from "../lib/match";
import type { FpProduct } from "../lib/types";

function mb(
  id: number,
  name: string,
  brand: string,
  sku: string,
  ean?: string
): FpProduct {
  return {
    id,
    name,
    link: `https://catalog.local/product-a${id}`,
    brand: { name: brand },
    article: sku,
    code: sku,
    vendor_code: sku,
    ...(ean ? { eans: [ean] } : {}),
    product_variation: {
      [sku]: { id: Number(sku), ...(ean ? { ean } : {}) }
    }
  };
}

async function main() {
  const productsA = [
    mb(
      80001275,
      "ZAPATILLAS LACOSTE POWER SERVE 50SMA0147 454",
      "Lacoste",
      "264256632",
      "111"
    )
  ];
  const productsB = [
    mb(
      76765730,
      "LACOSTE POWER SERVE 50SMA0147 NEGRO",
      "Lacoste",
      "228999999",
      "222"
    )
  ];
  const res = await runCrossRubricCompare(productsA, productsB, "ru", "A", "B");
  console.log(
    "pairs",
    res.onlyBCrossWithA?.length,
    res.onlyBCrossWithA?.[0]?.kind,
    res.onlyBCrossWithA?.[0]?.article
  );
}

main();
