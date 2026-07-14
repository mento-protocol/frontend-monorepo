import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";
import { env } from "@/env.mjs";
import {
  buildSecurityHeaders,
  originOf,
  sentryCspReportUri,
} from "../../scripts/security-headers.mjs";

const storageHostname = env.NEXT_PUBLIC_STORAGE_URL.replace(
  /^https?:\/\/([^/]+)\/?.*$/,
  "$1",
);
const analyticsApiOrigin = originOf(process.env.NEXT_PUBLIC_ANALYTICS_API_URL);

// Reserve is a read-only dashboard with no wallet — no WalletConnect entries.
const connectSrc = [
  "'self'",
  "https://forno.celo.org",
  "https://forno.celo-sepolia.celo-testnet.org",
  `https://${storageHostname}`,
  ...(analyticsApiOrigin ? [analyticsApiOrigin] : []),
];

const reportUri = sentryCspReportUri(env.NEXT_PUBLIC_SENTRY_DSN_RESERVE);

const reportOnlyCsp = [
  "default-src 'self'",
  // 'unsafe-inline' 'unsafe-eval' are required by Next 15 today.
  // Tightening target: replace with per-request nonces/hashes in production.
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: https://${storageHostname} https://raw.githubusercontent.com`,
  "font-src 'self' data:",
  `connect-src ${connectSrc.join(" ")}`,
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  ...(reportUri ? [`report-uri ${reportUri}`] : []),
].join("; ");

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: buildSecurityHeaders({ reportOnlyCsp }),
      },
    ];
  },
  async redirects() {
    return [
      {
        source: "/stablecoin-supply",
        destination: "/?tab=stablecoins",
        permanent: true,
      },
      {
        source: "/reserve-holdings",
        destination: "/?tab=collateral",
        permanent: true,
      },
      {
        source: "/reserve-addresses",
        destination: "/?tab=addresses",
        permanent: true,
      },
    ];
  },
  images: {
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    qualities: [75, 100],
    remotePatterns: [
      {
        protocol: "https",
        hostname: storageHostname,
        pathname: "/reserve/*|/shared/*",
      },
      {
        protocol: "https",
        hostname: "raw.githubusercontent.com",
        pathname: "/*",
      },
    ],
  },
  transpilePackages: ["@mento-protocol/ui"],
};

export default withSentryConfig(nextConfig, {
  // For all available options, see:
  // https://www.npmjs.com/package/@sentry/webpack-plugin#options

  org: "mento-labs",
  project: "reserve-mento-org",

  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,

  // Sentry authentication token, required for readable stack traces
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/#step-4-add-readable-stack-traces-with-source-maps-optional
  authToken: process.env.SENTRY_AUTH_TOKEN,

  // Upload a larger set of source maps for prettier stack traces (increases build time)
  widenClientFileUpload: true,

  // Capture React component names to see which component a user clicked on in Session Replays
  reactComponentAnnotation: {
    enabled: true,
  },

  // Route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
  // This can increase your server load as well as your hosting bill.
  // Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
  // side errors will fail.
  tunnelRoute: "/monitoring",

  // Automatically tree-shake Sentry logger statements to reduce bundle size
  disableLogger: true,

  // Enables automatic instrumentation of Vercel Cron Monitors. (Does not yet work with App Router route handlers.)
  // See the following for more information:
  // https://docs.sentry.io/product/crons/
  // https://vercel.com/docs/cron-jobs
  automaticVercelMonitors: true,
});
