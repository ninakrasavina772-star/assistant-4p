/**
 * Пересобрать template-base.png 1000×1400 без сжатия плашки (fit: contain).
 * node scripts/normalize-template.mjs [исходный.png]
 */
import fs from "fs";
import path from "path";
import sharp from "sharp";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(__dirname, "..", "public", "podruzhka", "template-base.png");
const src = process.argv[2] || out;
const W = 1000;
const H = 1400;
const BG = { r: 243, g: 241, b: 242, alpha: 1 };

if (!fs.existsSync(src)) {
  console.error("Нет файла:", src);
  process.exit(1);
}

const buf = await sharp(src).resize(W, H, { fit: "contain", background: BG }).png().toBuffer();
await fs.promises.writeFile(out, buf);
const m = await sharp(buf).metadata();
console.log("Wrote", out, m.width, "x", m.height);
