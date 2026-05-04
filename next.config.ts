import type { NextConfig } from "next";

/**
 * next-auth делает `new URL(process.env.NEXTAUTH_URL ?? …)`. Пустая строка в `.env`
 * даёт Invalid URL при `next build` / prerender.
 */
function stripEmptyAuthUrl(): void {
  for (const key of [
    "NEXTAUTH_URL",
    "NEXTAUTH_URL_INTERNAL",
    "VERCEL_URL"
  ] as const) {
    const v = process.env[key];
    if (typeof v === "string" && v.trim() === "") {
      delete process.env[key];
    }
  }
}
stripEmptyAuthUrl();

/**
 * NEXTAUTH_URL не задаём в `env` конфига: при сборке он «запекается» и часто не совпадает
 * с реальным адресом (другой деплой, алиас, свой домен) — ломаются OAuth и cookie.
 * Укажите NEXTAUTH_URL в Vercel / .env.local как в браузере (https://…, без / в конце).
 */
const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "cdnru.4stand.com", pathname: "/**" },
      { protocol: "https", hostname: "cdn.4stand.com", pathname: "/**" }
    ]
  }
};

export default nextConfig;
