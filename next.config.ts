import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "cdnru.4stand.com", pathname: "/**" },
      { protocol: "https", hostname: "cdn.4stand.com", pathname: "/**" }
    ]
  },
  /**
   * NextAuth не терпит пустой NEXTAUTH_URL: при сборке падает new URL(...) (Invalid URL).
   * На Vercel при билде есть VERCEL_URL — собираем валидный https URL без ручного env.
   */
  env: {
    NEXTAUTH_URL:
      process.env.NEXTAUTH_URL?.trim() ||
      (process.env.NODE_ENV === "development"
        ? "http://localhost:3000"
        : process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : "http://localhost:3000")
  }
};

export default nextConfig;
