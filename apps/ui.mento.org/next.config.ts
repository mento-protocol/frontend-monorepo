import type { NextConfig } from "next";
import { env } from "@/env.mjs";
import { buildSecurityHeaders } from "../../scripts/security-headers.mjs";
import { sharpOutputFileTracingConfig } from "../../scripts/next-sharp-output-tracing.mjs";

// Declared in this app's turbo.json so deployment attempts do not invalidate shared-package caches.
// eslint-disable-next-line turbo/no-undeclared-env-vars
const deploymentId = process.env.MENTO_NEXT_DEPLOYMENT_ID;
const storageHostname = env.NEXT_PUBLIC_STORAGE_URL.replace(
  /^https?:\/\/([^/]+)\/?.*$/,
  "$1",
);

// Showcase app: no wallet, no Sentry. Report-only violations still log to the
// browser console, which is enough here — so no report-uri.
const reportOnlyCsp = [
  "default-src 'self'",
  // 'unsafe-inline' 'unsafe-eval' are required by Next 15 today.
  // Tightening target: replace with per-request nonces/hashes in production.
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: https://${storageHostname}`,
  "font-src 'self' data:",
  `connect-src 'self' https://${storageHostname}`,
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const nextConfig: NextConfig = {
  ...sharpOutputFileTracingConfig(import.meta.url),
  deploymentId,
  experimental: deploymentId
    ? {
        runtimeServerDeploymentId: false,
      }
    : undefined,
  /* Performance Optimizations */
  // Enable React Server Components (default in App Router)
  reactStrictMode: true,

  async headers() {
    return [
      {
        source: "/:path*",
        headers: buildSecurityHeaders({ reportOnlyCsp }),
      },
    ];
  },

  // Image optimization config
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: storageHostname,
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
  transpilePackages: ["@mento-protocol/ui"],
};

export default nextConfig;
