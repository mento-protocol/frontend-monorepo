import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";
import { env } from "@/env.mjs";

const nextConfig: NextConfig = {
  // We use trunk to lint the code in a separate step, disable eslint during build for faster builds
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
        pathname: "/app/*|/shared/*",
      },
    ],
  },
  transpilePackages: [
    "@repo/ui",
    "@repo/web3",
    "@wagmi/core",
    "@rainbow-me/rainbowkit",
  ],
  webpack: (config) => {
    // Ignore React Native modules that are not needed in web builds
    config.resolve.fallback = {
      ...config.resolve.fallback,
      "@react-native-async-storage/async-storage": false,
      "react-native": false,
    };

    // Add alias to prevent webpack from trying to resolve these modules
    // and to fix zod/v4/core resolution for @hookform/resolvers
    config.resolve.alias = {
      ...config.resolve.alias,
      "@react-native-async-storage/async-storage": false,
      "zod/v4/core": require.resolve("zod/v4/core"),
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
