import { resolve } from "path";
import { mergeConfig } from "vitest/config";
import sharedConfig from "@repo/vitest-config/shared";

export default mergeConfig(sharedConfig, {
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "react",
  },
  resolve: {
    alias: {
      // Mirror the tsconfig path alias used by the app
      "@": resolve(__dirname, "./app"),
    },
  },
  test: {
    environment: "jsdom",
    include: ["app/**/*.test.ts", "app/**/*.test.tsx"],
    coverage: {
      all: true,
      include: [
        "app/**/*.{js,jsx,mjs,ts,tsx}",
        "instrumentation.ts",
        "instrumentation-client.ts",
        "sentry.edge.config.ts",
        "sentry.server.config.ts",
      ],
      exclude: [
        "app/**/*.test.{js,jsx,mjs,ts,tsx}",
        "app/**/*.spec.{js,jsx,mjs,ts,tsx}",
        "app/**/__tests__/**",
        "app/**/__generated__/**",
        "app/**/generated/**",
        "app/**/*.d.ts",
      ],
      thresholds: {
        statements: 30,
        branches: 72,
        functions: 72,
        lines: 30,
      },
    },
  },
});
