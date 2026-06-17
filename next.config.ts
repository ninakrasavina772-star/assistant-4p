import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["sharp", "exceljs", "@napi-rs/canvas", "rmbg", "onnxruntime-node"],
  webpack: (config, { isServer }) => {
    if (isServer && Array.isArray(config.externals)) {
      config.externals.push("rmbg", "onnxruntime-node");
    }
    return config;
  }
};

export default nextConfig;