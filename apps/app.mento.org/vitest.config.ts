import { resolve } from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: {
    // Enable the automatic JSX runtime so tests can use JSX without explicit React imports
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
    exclude: ["**/node_modules/**", "**/dist/**", "**/.next/**"],
    globals: false,
    passWithNoTests: true,
  },
});
