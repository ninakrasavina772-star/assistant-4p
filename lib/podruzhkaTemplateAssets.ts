import fs from "fs";
import path from "path";
import sharp from "sharp";
import { PODRUZHKA_SPEC } from "@/lib/podruzhkaSpec";

const TEMPLATE_FULL_PATH = path.join(process.cwd(), "public", "podruzhka", "template-base.png");

let fullTemplate: Buffer | null = null;
let templateMtime = 0;

const BG = { r: 247, g: 247, b: 247, alpha: 1 };

/** Пустой макет — contain в 1024×1365 (3:4), плашка не сжимается */
export async function getFullTemplateBuffer(): Promise<Buffer> {
  if (!fs.existsSync(TEMPLATE_FULL_PATH)) {
    throw new Error("Не найден public/podruzhka/template-base.png");
  }

  const stat = await fs.promises.stat(TEMPLATE_FULL_PATH);
  if (fullTemplate && stat.mtimeMs === templateMtime) return fullTemplate;

  const { w, h } = PODRUZHKA_SPEC.size;
  const raw = await fs.promises.readFile(TEMPLATE_FULL_PATH);
  const meta = await sharp(raw).metadata();

  if (meta.width === w && meta.height === h) {
    fullTemplate = raw;
  } else {
    fullTemplate = await sharp(raw)
      .resize(w, h, { fit: "contain", background: BG })
      .png()
      .toBuffer();
  }

  templateMtime = stat.mtimeMs;
  return fullTemplate;
}
