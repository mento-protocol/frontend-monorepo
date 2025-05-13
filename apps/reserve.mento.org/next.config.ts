import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // TODO: Remove once stable
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
