import type { NextConfig } from "next";
import { env } from "./env.mjs";

const nextConfig: NextConfig = {
  /* Performance Optimizations */
  // Enable React Server Components (default in App Router)
  reactStrictMode: true,

  // Image optimization config
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: env.NEXT_PUBLIC_STORAGE_URL.replace(
          /^https?:\/\/([^/]+)\/?.*$/,
          "$1",
        ),
        pathname: "/shared/*",
      },
    ],
  },

  // Enable compiler optimizations
  compiler: {
    // Remove console logs in production
    removeConsole: process.env.NODE_ENV === "production",
  },

  // Transpile monorepo packages used by this app
  // https://nextjs.org/docs/architecture/nextjs-compiler#module-transpilation
  transpilePackages: ["@repo/ui"],
};

export default nextConfig;
