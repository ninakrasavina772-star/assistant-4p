import fs from "fs";
import { rmbg } from "rmbg";

const url = process.argv[2] ?? "https://cdn1.ozone.ru/s3/multimedia-1-w/11111301608.jpg";
const out = "C:/Users/guita/AppData/Local/Temp/podruzhka-diag/rmbg-test.png";
const t0 = Date.now();
const res = await fetch(url);
const buf = Buffer.from(await res.arrayBuffer());
console.log("input bytes", buf.length);
const cut = await rmbg(buf);
console.log("output bytes", cut.length, "ms", Date.now() - t0);
fs.writeFileSync(out, cut);
console.log("saved", out);
