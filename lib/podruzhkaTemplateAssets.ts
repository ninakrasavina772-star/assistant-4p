import fs from "fs";
import path from "path";
import sharp from "sharp";
import { PODRUZHKA_SPEC } from "@/lib/podruzhkaSpec";

const PODRUZHKA_DIR = path.join(process.cwd(), "public", "podruzhka");
const TEMPLATE_FULL_PATH = path.join(PODRUZHKA_DIR, "template-base.png");

let fullTemplate: Buffer | null = null;

/** Полный шаблон: фон + петля + шапка «подружка Global» как в макете */
export async function getFullTemplateBuffer(): Promise<Buffer> {
  if (fullTemplate) return fullTemplate;

  if (!fs.existsSync(TEMPLATE_FULL_PATH)) {
    throw new Error("Не найден public/podruzhka/template-base.png");
  }

  const { w, h } = PODRUZHKA_SPEC.size;
  const raw = await fs.promises.readFile(TEMPLATE_FULL_PATH);
  const meta = await sharp(raw).metadata();
  if (meta.width === w && meta.height === h) {
    fullTemplate = raw;
    return fullTemplate;
  }
  fullTemplate = await sharp(raw).resize(w, h, { fit: "fill" }).png().toBuffer();
  return fullTemplate;
}
