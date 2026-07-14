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
      // Mirror the tsconfig "@/*" path alias (points at the package source)
      "@": resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.tsx"],
    coverage: {
      all: true,
      include: ["src/**/*.{js,jsx,ts,tsx}"],
      exclude: [
        "src/**/*.test.{js,jsx,ts,tsx}",
        "src/**/*.spec.{js,jsx,ts,tsx}",
        "src/**/__tests__/**",
        "src/**/__snapshots__/**",
        "src/**/__generated__/**",
        "src/**/generated/**",
        "src/**/*.d.ts",
      ],
      thresholds: {
        statements: 5,
        branches: 80,
        functions: 80,
        lines: 5,
      },
    },
  },
});
