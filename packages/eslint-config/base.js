import js from "@eslint/js";
import path from "path";
import { fileURLToPath } from "url";

// Plugins
import tseslint from "typescript-eslint";
import onlyWarn from "eslint-plugin-only-warn";

// Configs
import prettierConfig from "eslint-config-prettier";
import turboConfig from "eslint-config-turbo/flat";

// Get the directory of this file to find workspace root
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, "../..");

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
  // Turbo configuration with explicit workspace root
  {
    rules: {
      "turbo/no-undeclared-env-vars": [
        "error",
        {
          cwd: workspaceRoot,
        },
      ],
    },
  },
  {
    ignores: ["**/dist/**", "**/.next/**"],
  },
];
