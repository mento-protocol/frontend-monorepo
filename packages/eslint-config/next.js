import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";
import pluginNext from "@next/eslint-plugin-next";
import { config as baseConfig } from "./base.js";
import { reactSharedConfig, nextJsSharedConfig } from "./react-shared.js";

/**
 * A custom ESLint configuration for libraries that use Next.js.
 *
 * @type {import("eslint").Linter.Config[]}
 */
export const nextJsConfig = [
  ...baseConfig,
  js.configs.recommended,
  eslintConfigPrettier,
  ...tseslint.configs.recommended,
  ...reactSharedConfig,
  ...nextJsSharedConfig,
  // Additional config that Next.js can auto-detect
  {
    plugins: {
      "@next/next": pluginNext,
      next: pluginNext,
    },
  },
];
