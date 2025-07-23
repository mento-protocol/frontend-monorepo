import type { NextConfig } from "next";
import { env } from "@/env.mjs";

const nextConfig: NextConfig = {
  // TODO: Remove once stable
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: env.NEXT_PUBLIC_STORAGE_URL.replace(
          /^https?:\/\/([^/]+)\/?.*$/,
          "$1",
        ),
        pathname: "/governance/*",
      },
      {
        protocol: "https",
        hostname: "raw.githubusercontent.com",
        pathname: "/*",
      },
    ],
  },
  transpilePackages: ["@repo/ui"],
};

export default nextConfig;
