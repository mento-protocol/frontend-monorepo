import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";
import { env } from "@/env.mjs";
import { buildAppReportOnlyCsp } from "./app-report-only-csp.mjs";
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
// Vercel provides this in hosted builds; the main deployment workflow binds it to the exact main SHA.
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

const reportUri = sentryCspReportUri(env.NEXT_PUBLIC_SENTRY_DSN_SWAP);

const reportOnlyCsp = buildAppReportOnlyCsp({
  reportUri,
  rpcOverrideOrigins,
  storageHostname,
});

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
