import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["sharp", "exceljs", "@napi-rs/canvas", "rmbg", "onnxruntime-node"]
};

export default nextConfig;
