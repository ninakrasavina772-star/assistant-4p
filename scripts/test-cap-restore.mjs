/**
 * Quick cap-restore smoke test (run from compare/: npx tsx scripts/test-cap-restore.mjs)
 */
import { fetchPodruzhkaProductImage } from "../lib/podruzhkaImageFetch.ts";
import { preprocessCosmeticsProductBufferAi } from "../lib/podruzhkaImageProcess.ts";
import sharp from "sharp";
import { writeFileSync, mkdirSync } from "fs";

const cases = [
  {
    name: "essie",
    url: "https://cdn1.ozone.ru/s3/multimedia-1-h/10612583729.jpg"
  },
  {
    name: "huda",
    url: "https://cdn1.ozone.ru/s3/multimedia-1-c/11111301984.jpg"
  }
];

mkdirSync("public/podruzhka/cap-test", { recursive: true });

for (const c of cases) {
  const buf = await fetchPodruzhkaProductImage(c.url);
  if (!buf) {
    console.error("fetch fail", c.name);
    continue;
  }
  const out = await preprocessCosmeticsProductBufferAi(buf, c.url);
  const { data, info } = await sharp(out).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  let minY = h;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3]! >= 128) minY = Math.min(minY, y);
    }
  }
  const path = `public/podruzhka/cap-test/${c.name}-v44.png`;
  writeFileSync(path, out);
  console.log(c.name, "topAlphaY=", minY, "h=", h, "saved", path);
}
