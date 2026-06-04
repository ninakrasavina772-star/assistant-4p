/**
 * Два слоя из template-base.png → template-bg.png (без шапки) + header.png.
 * node scripts/split-podruzhka-layers.mjs
 */
import fs from "fs";
import path from "path";
import sharp from "sharp";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const outDir = path.join(root, "public", "podruzhka");
const srcPath = path.join(outDir, "template-base.png");

const W = 1000;
const H = 1400;
const BG = { r: 240, g: 240, b: 240, alpha: 1 };
const HEADER = { x: 250, y: 35, w: 500, h: 85 };
const MASK_H = 145;

async function main() {
  if (!fs.existsSync(srcPath)) {
    console.error("Нет", srcPath);
    process.exit(1);
  }

  const base = await sharp(srcPath).resize(W, H, { fit: "fill" }).png().toBuffer();

  await sharp(base)
    .extract({ left: HEADER.x, top: HEADER.y, width: HEADER.w, height: HEADER.h })
    .png()
    .toFile(path.join(outDir, "header.png"));

  const mask = await sharp({
    create: { width: W, height: MASK_H, channels: 4, background: BG }
  })
    .png()
    .toBuffer();

  await sharp(base)
    .composite([{ input: mask, top: 0, left: 0 }])
    .png()
    .toFile(path.join(outDir, "template-bg.png"));

  const m = await sharp(path.join(outDir, "template-bg.png")).metadata();
  const h = await sharp(path.join(outDir, "header.png")).metadata();
  console.log("template-bg:", m.width, "x", m.height);
  console.log("header:", h.width, "x", h.height, "@", HEADER.x, HEADER.y);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
