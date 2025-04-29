import js from "@eslint/js";

// Plugins
import tseslint from "typescript-eslint";
import onlyWarn from "eslint-plugin-only-warn";

// Configs
import prettierConfig from "eslint-config-prettier";
import turboConfig from "eslint-config-turbo/flat";

/**
 * A shared ESLint configuration for the repository.
 *
 * @type {import("eslint").Linter.Config[]}
 * */
export const config = [
  js.configs.recommended,
  prettierConfig,
  ...turboConfig,
  ...tseslint.configs.recommended,
  {
    plugins: {
      onlyWarn,
    },
  },
  {
    ignores: ["**/dist/**", "**/.next/**"],
  },
];
