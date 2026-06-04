import fs from "fs";
import path from "path";
import sharp from "sharp";
import { PODRUZHKA_SPEC } from "@/lib/podruzhkaSpec";

const PODRUZHKA_DIR = path.join(process.cwd(), "public", "podruzhka");
const TEMPLATE_BG_PATH = path.join(PODRUZHKA_DIR, "template-bg.png");
const HEADER_PATH = path.join(PODRUZHKA_DIR, "header.png");
const TEMPLATE_LEGACY_PATH = path.join(PODRUZHKA_DIR, "template-base.png");

let templateBg: Buffer | null = null;
let headerPng: Buffer | null = null;

async function buildLayersFromLegacy(): Promise<void> {
  if (!fs.existsSync(TEMPLATE_LEGACY_PATH)) {
    throw new Error("Не найден template-bg.png (и нет template-base.png для сборки)");
  }
  const { w, h } = PODRUZHKA_SPEC.size;
  const hdr = PODRUZHKA_SPEC.header;
  const maskH = PODRUZHKA_SPEC.headerMaskHeight;
  const bgRgb = { r: 240, g: 240, b: 240, alpha: 1 };

  const base = await sharp(TEMPLATE_LEGACY_PATH).resize(w, h, { fit: "fill" }).png().toBuffer();

  headerPng = await sharp(base)
    .extract({ left: hdr.x, top: hdr.y, width: hdr.w, height: hdr.h })
    .png()
    .toBuffer();

  const mask = await sharp({
    create: { width: w, height: maskH, channels: 4, background: bgRgb }
  })
    .png()
    .toBuffer();

  templateBg = await sharp(base).composite([{ input: mask, top: 0, left: 0 }]).png().toBuffer();
}

export async function getTemplateBgBuffer(): Promise<Buffer> {
  if (templateBg) return templateBg;

  if (fs.existsSync(TEMPLATE_BG_PATH)) {
    const raw = await fs.promises.readFile(TEMPLATE_BG_PATH);
    const { w, h } = PODRUZHKA_SPEC.size;
    const meta = await sharp(raw).metadata();
    if (meta.width === w && meta.height === h) {
      templateBg = raw;
      return templateBg;
    }
    templateBg = await sharp(raw).resize(w, h, { fit: "fill" }).png().toBuffer();
    return templateBg;
  }

  await buildLayersFromLegacy();
  return templateBg!;
}

export async function getHeaderPlaqueBuffer(): Promise<Buffer> {
  if (headerPng) return headerPng;

  if (fs.existsSync(HEADER_PATH)) {
    headerPng = await fs.promises.readFile(HEADER_PATH);
    return headerPng;
  }

  await buildLayersFromLegacy();
  return headerPng!;
}

/** @deprecated используйте getTemplateBgBuffer */
export async function getResizedTemplateBuffer(w: number, h: number): Promise<Buffer> {
  const buf = await getTemplateBgBuffer();
  const meta = await sharp(buf).metadata();
  if (meta.width === w && meta.height === h) return buf;
  return sharp(buf).resize(w, h, { fit: "fill" }).png().toBuffer();
}
