/**
 * Smoke: preprocessCosmeticsProductBufferAi top-alpha (needs YANDEX_S3_* in .env.local).
 * npx tsx scripts/test-cap-v45.mjs [foto-url]
 */
import { fetchPodruzhkaProductImage } from "../lib/podruzhkaImageFetch.ts";
import { preprocessCosmeticsProductBufferAi } from "../lib/podruzhkaImageProcess.ts";
import sharp from "sharp";

const url =
  process.argv[2] ?? "https://cdn1.ozone.ru/s3/multimedia-1-c/11111301984.jpg";

const raw = await fetchPodruzhkaProductImage(url);
if (!raw) throw new Error("fetch");

const out = await preprocessCosmeticsProductBufferAi(raw, url);
const { data, info } = await sharp(out).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
let minY = info.height;
for (let y = 0; y < info.height; y++) {
  for (let x = 0; x < info.width; x++) {
    if (data[(y * info.width + x) * 4 + 3]! >= 128) {
      minY = y;
      break;
    }
  }
}
console.log("topAlphaY", minY, "/", info.height, `(${(100 * minY) / info.height}%)`);
