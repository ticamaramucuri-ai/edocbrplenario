import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  ...(process.env.EDOCBR_NEXT_DIST_DIR ? { distDir: process.env.EDOCBR_NEXT_DIST_DIR } : {}),
  /* config options here */
  reactStrictMode: false,
};

export default nextConfig;
