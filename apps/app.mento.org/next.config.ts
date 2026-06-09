import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";
import { env } from "@/env.mjs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const storageHostname = env.NEXT_PUBLIC_STORAGE_URL.replace(
  /^https?:\/\/([^/]+)\/?.*$/,
  "$1",
);

const nextConfig: NextConfig = {
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
    "@repo/ui",
    "@repo/web3",
    "@wagmi/core",
    "@rainbow-me/rainbowkit",
  ],
  // NOTE: local dev uses --turbopack, which ignores this webpack hook.
  // Production builds use the default Next.js compiler so this hook remains
  // active for the React Native fallbacks and wagmi deduplication aliases.
  webpack: (config) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      "@react-native-async-storage/async-storage": false,
      "react-native": false,
    };
    config.resolve.alias = {
      ...config.resolve.alias,
      wagmi: path.dirname(require.resolve("wagmi/package.json")),
      "@wagmi/core": path.dirname(require.resolve("@wagmi/core/package.json")),
    };
    return config;
  },
};

export default withSentryConfig(nextConfig, {
  // For all available options, see:
  // https://www.npmjs.com/package/@sentry/webpack-plugin#options

  org: "mento-labs",
  project: "app-mento-org",

  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,

  // Sentry authentication token, required for readable stack traces
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/#step-4-add-readable-stack-traces-with-source-maps-optional
  authToken: env.SENTRY_AUTH_TOKEN,

  // Upload a larger set of source maps for prettier stack traces (increases build time)
  widenClientFileUpload: true,

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
