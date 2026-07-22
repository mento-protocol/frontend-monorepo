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

if (uploadSentrySourceMaps && !sentryAuthToken) {
  throw new Error("SENTRY_AUTH_TOKEN is required for production builds");
}

const storageHostname = env.NEXT_PUBLIC_STORAGE_URL.replace(
  /^https?:\/\/([^/]+)\/?.*$/,
  "$1",
);

// Origins of the optional per-chain RPC overrides, appended only when set so we
// never hardcode a snapshot of the current Vercel values.
const rpcOverrideOrigins = [
  env.NEXT_PUBLIC_RPC_URL,
  env.NEXT_PUBLIC_CELO_RPC_URL,
  env.NEXT_PUBLIC_CELO_SEPOLIA_RPC_URL,
  env.NEXT_PUBLIC_MONAD_RPC_URL,
  env.NEXT_PUBLIC_MONAD_TESTNET_RPC_URL,
  process.env.NEXT_PUBLIC_POLYGON_RPC_URL,
  process.env.NEXT_PUBLIC_POLYGON_AMOY_RPC_URL,
  process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL,
]
  .map(originOf)
  .filter(Boolean);

const connectSrc = [
  "'self'",
  "https://forno.celo.org",
  "https://forno.celo-sepolia.celo-testnet.org",
  "https://rpc.monad.xyz",
  "https://testnet-rpc.monad.xyz",
  "https://rpc3.monad.xyz",
  "https://polygon.drpc.org",
  "https://polygon-amoy.drpc.org",
  "https://sepolia.base.org",
  "https://api.studio.thegraph.com",
  "https://api.coingecko.com",
  "https://api.wormholescan.io",
  "https://api.web3modal.org",
  "https://*.walletconnect.com",
  "wss://*.walletconnect.com",
  "https://*.walletconnect.org",
  "wss://*.walletconnect.org",
  `https://${storageHostname}`,
  ...rpcOverrideOrigins,
];

const reportUri = sentryCspReportUri(env.NEXT_PUBLIC_SENTRY_DSN_SWAP);

const reportOnlyCsp = [
  "default-src 'self'",
  // 'unsafe-inline' 'unsafe-eval' are required by Next 15 + wagmi today.
  // Tightening target: replace with per-request nonces/hashes in production.
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: https://${storageHostname}`,
  "font-src 'self' data:",
  `connect-src ${connectSrc.join(" ")}`,
  "frame-src 'self' https://verify.walletconnect.com https://verify.walletconnect.org",
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
        headers: buildSecurityHeaders({ reportOnlyCsp }),
      },
    ];
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: storageHostname,
        pathname: "/app/**",
      },
      {
        protocol: "https",
        hostname: storageHostname,
        pathname: "/shared/**",
      },
    ],
  },
  transpilePackages: [
    "@mento-protocol/ui",
    "@repo/web3",
    "@rainbow-me/rainbowkit",
  ],
};

export default withSentryConfig(nextConfig, {
  // For all available options, see:
  // https://www.npmjs.com/package/@sentry/webpack-plugin#options

  org: "mento-labs",
  project: "app-mento-org",

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

  // Route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
  // This can increase your server load as well as your hosting bill.
  // Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
  // side errors will fail.
  tunnelRoute: "/monitoring",

  webpack: {
    // Capture React component names to see which component a user clicked on in Session Replays.
    reactComponentAnnotation: {
      enabled: true,
    },

    // Automatically tree-shake Sentry logger statements to reduce bundle size.
    treeshake: {
      removeDebugLogging: true,
    },

    // Enables automatic instrumentation of Vercel Cron Monitors. (Does not yet work with App Router route handlers.)
    // See the following for more information:
    // https://docs.sentry.io/product/crons/
    // https://vercel.com/docs/cron-jobs
    automaticVercelMonitors: true,
  },
});
