import sharp from "sharp";
import { enhanceSourceForProcessing, extractCosmeticsPackshotFromWhite } from "../lib/podruzhkaImageProcess.ts";

const w = 400, h = 500;
const pixels = Buffer.alloc(w * h * 4, 255);
for (let y = 120; y < 420; y++) {
  for (let x = 140; x < 260; x++) {
    const i = (y * w + x) * 4;
    pixels[i] = 210; pixels[i + 1] = 175; pixels[i + 2] = 140; pixels[i + 3] = 255;
  }
}
for (let y = 60; y < 120; y++) {
  for (let x = 130; x < 270; x++) {
    const i = (y * w + x) * 4;
    pixels[i] = 255; pixels[i + 1] = 255; pixels[i + 2] = 255; pixels[i + 3] = 255;
  }
}
const srcJpeg = await sharp(pixels, { raw: { width: w, height: h, channels: 4 } }).jpeg({ quality: 95 }).toBuffer();
const enhanced = await enhanceSourceForProcessing(srcJpeg);
const cutout = await extractCosmeticsPackshotFromWhite(enhanced);
const { data, info } = await sharp(cutout).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
let cap = 0, body = 0, trans = 0;
for (let y = 0; y < info.height; y++) {
  for (let x = 0; x < info.width; x++) {
    const i = (y * info.width + x) * 4;
    const a = data[i + 3];
    const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
    if (a < 20) trans++;
    else if (y < info.height * 0.35 && avg >= 236) cap++;
    else if (avg < 236) body++;
  }
}
console.log({ cap, body, trans, w: info.width, h: info.height });
