/**
 * Копирует woff2 Inter + Libre Franklin в public/podruzhka/fonts (серверный canvas + клиент).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dest = join(root, "public", "podruzhka", "fonts");
mkdirSync(dest, { recursive: true });

const files = [
  [
    "@fontsource/libre-franklin/files/libre-franklin-latin-800-normal.woff2",
    "libre-franklin-latin-800-normal.woff2"
  ],
  ["@fontsource/inter/files/inter-latin-400-normal.woff2", "inter-latin-400-normal.woff2"],
  ["@fontsource/inter/files/inter-latin-500-normal.woff2", "inter-latin-500-normal.woff2"],
  [
    "@fontsource/inter/files/inter-latin-500-italic.woff2",
    "inter-latin-500-italic.woff2"
  ],
  ["@fontsource/inter/files/inter-latin-700-normal.woff2", "inter-latin-700-normal.woff2"],
  ["@fontsource/inter/files/inter-latin-800-normal.woff2", "inter-latin-800-normal.woff2"]
];

for (const [rel, name] of files) {
  const src = join(root, "node_modules", rel);
  if (!existsSync(src)) {
    console.warn("[copy-podruzhka-fonts] skip missing", rel);
    continue;
  }
  writeFileSync(join(dest, name), readFileSync(src));
}

console.log("[copy-podruzhka-fonts] ok → public/podruzhka/fonts");
