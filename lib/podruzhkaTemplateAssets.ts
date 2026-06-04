import fs from "fs";
import path from "path";
import sharp from "sharp";
import { PODRUZHKA_SPEC } from "@/lib/podruzhkaSpec";

const TEMPLATE_PATH = path.join(process.cwd(), "public", "podruzhka", "template-base.png");

let resizedTemplate: Buffer | null = null;
let headerPlaque: Buffer | null = null;

export async function getResizedTemplateBuffer(w: number, h: number): Promise<Buffer> {
  if (!fs.existsSync(TEMPLATE_PATH)) {
    throw new Error("Не найден template-base.png");
  }
  if (!resizedTemplate) {
    const raw = await fs.promises.readFile(TEMPLATE_PATH);
    resizedTemplate = await sharp(raw).resize(w, h, { fit: "fill" }).png().toBuffer();
  }
  return resizedTemplate;
}

/** Плашка «подружка Global» — поверх всего в конце рендера */
export async function getHeaderPlaqueBuffer(): Promise<Buffer> {
  if (headerPlaque) return headerPlaque;
  const { w, h } = PODRUZHKA_SPEC.size;
  const H = PODRUZHKA_SPEC.header;
  const base = await getResizedTemplateBuffer(w, h);
  headerPlaque = await sharp(base)
    .extract({ left: H.x, top: H.y, width: H.w, height: H.h })
    .png()
    .toBuffer();
  return headerPlaque;
}
