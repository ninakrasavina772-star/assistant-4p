/**
 * Из листа ТЗ (1024×682) вырезает логотип и сохраняет пустой template-base 1080×1350.
 * node scripts/extract-podruzhka-assets.mjs [path-to-spec.png]
 */
import fs from "fs";
import path from "path";
import sharp from "sharp";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const outDir = path.join(root, "public", "podruzhka");

const defaultRef = path.join(
  process.env.USERPROFILE || "",
  ".cursor",
  "projects",
  "c-Users-guita-Desktop",
  "assets",
  "c__Users_guita_AppData_Roaming_Cursor_User_workspaceStorage_66686c61b333da3f90c941ecf170ca82_images_________-15116342-f275-4cfc-80e0-d0aba374a388.png"
);

const refPath = process.argv[2] || defaultRef;

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  if (!fs.existsSync(refPath)) {
    console.error("Reference not found:", refPath);
    process.exit(1);
  }

  const meta = await sharp(refPath).metadata();
  const W = meta.width || 1024;
  const cardW = Math.round(W * 0.48);

  await sharp(refPath)
    .extract({
      left: Math.round(cardW * 0.12),
      top: Math.round((meta.height || 682) * 0.04),
      width: Math.round(cardW * 0.76),
      height: Math.round((meta.height || 682) * 0.11)
    })
    .png()
    .toFile(path.join(outDir, "logo-global.png"));

  console.log("Wrote", path.join(outDir, "logo-global.png"));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
