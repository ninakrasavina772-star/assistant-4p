import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "cdnru.4stand.com", pathname: "/**" },
      { protocol: "https", hostname: "cdn.4stand.com", pathname: "/**" }
    ]
  },
  /** Частая причина «Server error» NextAuth: не подставился URL для localhost */
  env: {
    NEXTAUTH_URL:
      process.env.NEXTAUTH_URL ||
      (process.env.NODE_ENV === "development"
        ? "http://localhost:3000"
        : "")
  }
};

export default nextConfig;
