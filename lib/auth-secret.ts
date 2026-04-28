/**
 * Один секрет для NextAuth (API + middleware).
 *
 * В **Edge (middleware)** при `npm run dev` у Next.js часто `NODE_ENV=production`,
 * и прошлая логика «только в development» давала `undefined` → error=Configuration.
 * Если `NEXTAUTH_SECRET` не задан в окружении, используем встроенный **локальный**
 * запасной (для продакшна задайте свой в .env / панели хоста).
 */
export const AUTH_SECRET_FALLBACK =
  "compare-dev-only-not-for-prod-rotate-when-you-deploy-32b";

export function getAuthSecret(): string {
  const s = process.env.NEXTAUTH_SECRET;
  if (s && s.trim().length > 0) {
    return s.trim();
  }
  return AUTH_SECRET_FALLBACK;
}
