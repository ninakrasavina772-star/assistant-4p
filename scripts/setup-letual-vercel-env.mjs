/**
 * Добавляет METABASE_* в Vercel (production + preview).
 * Запуск: npx vercel login && node scripts/setup-letual-vercel-env.mjs
 */
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function readMetabaseEnv() {
  const candidates = [
    path.join(root, "..", "метабейс", "metabase-agent-kit-v0.1.0", "metabase-agent-kit-v0.1.0", ".env"),
    path.join(
      "C:",
      "Users",
      "guita",
      "Desktop",
      "метабейс",
      "metabase-agent-kit-v0.1.0",
      "metabase-agent-kit-v0.1.0",
      ".env"
    )
  ];
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    const text = fs.readFileSync(p, "utf8");
    const get = (key) => {
      const m = text.match(new RegExp(`^${key}=(.+)$`, "m"));
      return m?.[1]?.trim() ?? "";
    };
    const url = get("METABASE_URL");
    const apiKey = get("METABASE_API_KEY");
    const dbId = get("METABASE_DB_ID") || "2";
    if (url && apiKey) return { url, apiKey, dbId };
  }
  throw new Error("Не найден .env с METABASE_URL и METABASE_API_KEY");
}

function addEnv(name, value, target) {
  console.log(`→ ${name} (${target})`);
  execSync(`npx vercel env add ${name} ${target}`, {
    cwd: root,
    input: value,
    stdio: ["pipe", "inherit", "inherit"]
  });
}

const { url, apiKey, dbId } = readMetabaseEnv();

for (const target of ["production", "preview"]) {
  addEnv("METABASE_URL", url, target);
  addEnv("METABASE_API_KEY", apiKey, target);
  addEnv("METABASE_DB_ID", dbId, target);
}

console.log("\nГотово. Передеплой: npx vercel --prod");
