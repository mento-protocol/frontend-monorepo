import { defineConfig } from "vitest/config";

/**
 * Shared vitest configuration for all packages and apps in the monorepo.
 * Packages should extend this config and add their own path aliases.
 *
 * @example
 * // vitest.config.ts in a package
 * import { resolve } from "path";
 * import { mergeConfig } from "vitest/config";
 * import sharedConfig from "@repo/vitest-config/shared";
 *
 * export default mergeConfig(sharedConfig, {
 *   resolve: {
 *     alias: {
 *       "@": resolve(__dirname, "./src"),
 *     },
 *   },
 * });
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["node_modules", "dist", ".next", "build"],
    globals: false,
    passWithNoTests: true,
  },
});
