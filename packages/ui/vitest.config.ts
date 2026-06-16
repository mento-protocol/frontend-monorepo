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
  },
});
