import fs from "fs";
import path from "path";
import sharp from "sharp";
import { fileURLToPath } from "url";
import { resolveAdaptiveProductPlacement } from "../lib/podruzhkaProductAdaptive.ts";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const template = path.join(root, "public/podruzhka/template-base.png");
const out = "C:/Users/guita/AppData/Local/Temp/podruzhka-diag";
fs.mkdirSync(out, { recursive: true });

const items = [
  { name: "hauschka", url: "https://cdn1.ozone.ru/s3/multimedia-1-w/11111301608.jpg" },
  { name: "lancome", url: "https://cdn1.ozone.ru/s3/multimedia-1-i/7127308278.jpg" }
];

for (const item of items) {
  const input = Buffer.from(await (await fetch(item.url)).arrayBuffer());
  const placement = await resolveAdaptiveProductPlacement(input, "cosmetics", item.url);
  const card = await sharp(template)
    .composite([
      { input: placement.fit.buffer, left: Math.round(placement.drawX), top: Math.round(placement.drawY) }
    ])
    .jpeg({ quality: 96 })
    .toBuffer();
  fs.writeFileSync(`${out}/ai-${item.name}-card.jpg`, card);
  console.log(item.name, placement.strategyId);
}
