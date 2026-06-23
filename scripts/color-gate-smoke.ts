import { crossRubricColorVerdict } from "../lib/crossRubricColorGate";
import { toCompareProduct } from "../lib/product";
import type { FpProduct } from "../lib/types";

function fp(name: string, id: number): FpProduct {
  return { id, name, link: "", brand: { name: "Joma" } };
}

const pink = toCompareProduct(
  fp("JOMA OPEN LADY PINK WOMEN TOPLW2513OM", 76903437)
);
const sky = toCompareProduct(
  fp("ZAPATILLAS JOMA OPEN LADY SKY BLUE 2505 MUJER TOPLW2513OM", 80001057)
);
const pink2 = toCompareProduct(
  fp("JOMA OPEN LADY PINK WOMEN TOPLW2513OM", 76903438)
);

const conflict = crossRubricColorVerdict(pink, sky);
const match = crossRubricColorVerdict(pink, pink2);

console.log("pink vs sky:", conflict, "expected conflict");
console.log("pink vs pink:", match, "expected match");

if (conflict !== "conflict" || match !== "match") {
  process.exit(1);
}
