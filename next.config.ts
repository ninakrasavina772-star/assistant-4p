import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["sharp", "exceljs", "@napi-rs/canvas", "undici"]
};

export default nextConfig;
