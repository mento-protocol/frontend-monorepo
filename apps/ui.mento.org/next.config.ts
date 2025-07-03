import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* Performance Optimizations */
  // Enable React Server Components (default in App Router)
  reactStrictMode: true,

  // Image optimization config
  images: {
    formats: ["image/avif", "image/webp"],
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
