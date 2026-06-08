import sharp from "sharp";
import { analyzePerfumePixels } from "../lib/podruzhkaFotoAnalyzeCore.ts";

const url = process.argv[2];
if (!url) {
  console.error("Usage: node scripts/analyze-foto-url.mjs <url>");
  process.exit(1);
}

const res = await fetch(url, {
  headers: { "User-Agent": "probe/1", Accept: "image/*" }
});
const buf = Buffer.from(await res.arrayBuffer());
const { data, info } = await sharp(buf)
  .resize(180, undefined, { fit: "inside" })
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });

const a = analyzePerfumePixels(data, info.width, info.height);
console.log(JSON.stringify({ url, w: info.width, h: info.height, ...a }, null, 2));
