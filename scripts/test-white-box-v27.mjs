import sharp from "sharp";
import {
  extractCosmeticsPackshotFromWhite,
  preprocessCosmeticsProductBuffer,
  enhanceSourceForProcessing
} from "../lib/podruzhkaImageProcess.ts";

/** Synthetic Ozon packshot: white margins + white cap + beige body */
async function makeSynthetic(w = 400, h = 500) {
  const pixels = Buffer.alloc(w * h * 4, 255);
  for (let y = 120; y < 420; y++) {
    for (let x = 140; x < 260; x++) {
      const i = (y * w + x) * 4;
      pixels[i] = 210;
      pixels[i + 1] = 175;
      pixels[i + 2] = 140;
      pixels[i + 3] = 255;
    }
  }
  for (let y = 60; y < 120; y++) {
    for (let x = 130; x < 270; x++) {
      const i = (y * w + x) * 4;
      pixels[i] = 255;
      pixels[i + 1] = 255;
      pixels[i + 2] = 255;
      pixels[i + 3] = 255;
    }
  }
  return sharp(pixels, { raw: { width: w, height: h, channels: 4 } })
    .jpeg({ quality: 95 })
    .toBuffer();
}

async function marginWhite(buf, label) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  let leftWhite = 0;
  let capWhite = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < Math.floor(w * 0.2); x++) {
      const i = (y * w + x) * 4;
      if (data[i + 3] >= 250 && (data[i] + data[i + 1] + data[i + 2]) / 3 >= 236) leftWhite++;
    }
  }
  for (let y = Math.floor(h * 0.1); y < Math.floor(h * 0.28); y++) {
    for (let x = Math.floor(w * 0.32); x < Math.floor(w * 0.68); x++) {
      const i = (y * w + x) * 4;
      if (data[i + 3] >= 250 && (data[i] + data[i + 1] + data[i + 2]) / 3 >= 236) capWhite++;
    }
  }
  console.log(label, { leftWhite, capWhite });
  if (leftWhite > 50) throw new Error(`${label}: left margin still white (${leftWhite})`);
  if (capWhite < 500) throw new Error(`${label}: cap too transparent (${capWhite})`);
}

const src = await makeSynthetic();
const enhanced = await enhanceSourceForProcessing(src);
await marginWhite(await extractCosmeticsPackshotFromWhite(enhanced), "cutout");
console.log("synthetic OK");
