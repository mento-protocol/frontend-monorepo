import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";
import { env } from "@/env.mjs";
import {
  buildSecurityHeaders,
  originOf,
  sentryCspReportUri,
} from "../../scripts/security-headers.mjs";
import { sharpOutputFileTracingConfig } from "../../scripts/next-sharp-output-tracing.mjs";

const uploadSentrySourceMaps = process.env.VERCEL_ENV === "production";
const sentryAuthToken = env.SENTRY_AUTH_TOKEN;
// Declared in this app's turbo.json so deployment attempts do not invalidate shared-package caches.
// eslint-disable-next-line turbo/no-undeclared-env-vars
const deploymentId = process.env.MENTO_NEXT_DEPLOYMENT_ID;
// Vercel provides this in hosted builds; the production-shadow workflow binds it to preflight's exact main SHA.
// eslint-disable-next-line turbo/no-undeclared-env-vars
const deploymentSha = process.env.VERCEL_GIT_COMMIT_SHA;
if (deploymentSha && !/^[a-f0-9]{40}$/i.test(deploymentSha)) {
  throw new Error("VERCEL_GIT_COMMIT_SHA must be a full commit SHA");
}

if (uploadSentrySourceMaps && !sentryAuthToken) {
  throw new Error("SENTRY_AUTH_TOKEN is required for production builds");
}

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
  ...sharpOutputFileTracingConfig(import.meta.url),
  deploymentId,
  experimental: deploymentId
    ? {
        runtimeServerDeploymentId: false,
      }
    : undefined,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          ...buildSecurityHeaders({ reportOnlyCsp }),
          ...(deploymentSha
            ? [
                {
                  key: "X-Mento-Deployment-Sha",
                  value: deploymentSha.toLowerCase(),
                },
              ]
            : []),
        ],
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

  // Preview builds skip source-map work entirely; keep upload logs for production CI.
  silent: !process.env.CI || !uploadSentrySourceMaps,

  // Sentry authentication token, required for production source-map uploads
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/#step-4-add-readable-stack-traces-with-source-maps-optional
  authToken: uploadSentrySourceMaps ? sentryAuthToken : undefined,

  sourcemaps: {
    disable: !uploadSentrySourceMaps,
  },
  useRunAfterProductionCompileHook: uploadSentrySourceMaps,

  // Production keeps the wider maps for readable stack traces; previews build faster.
  widenClientFileUpload: uploadSentrySourceMaps,

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
