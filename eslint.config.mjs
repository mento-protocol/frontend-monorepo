import { config } from "@repo/eslint-config/base";
import {
  reactSharedConfig,
  nextJsSharedConfig,
} from "@repo/eslint-config/react-shared";
import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

/** @type {import("eslint").Linter.Config} */
export default [
  {
    // Vendored upstream JavaScript from jmrossy/jazzicon, kept byte-for-byte so
    // it can be diffed against upstream. See packages/jazzicon/README.md.
    ignores: ["packages/jazzicon/*.js"],
  },
  ...config,
  js.configs.recommended,
  eslintConfigPrettier,
  ...tseslint.configs.recommended,
  ...reactSharedConfig,
  ...nextJsSharedConfig,
  {
    rules: {
      // Disable React Compiler rules that flag valid patterns
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/preserve-manual-memoization": "off",
      "react-hooks/purity": "off",
    },
  },
  {
    // scripts/check-shell-size.mjs is a byte-identical copy of the checker in
    // mento-protocol/agents, so it cannot carry the inline suppression comment
    // the other scripts here use. MAX_FILE_LINES, MAX_FUNCTION_LINES and
    // SHELL_SIZE_BASE are inputs of a check, not of a Turborepo task, so they
    // do not belong in turbo.json. The copy also reads the Node `process`
    // global instead of importing it. See the shell rules in AGENTS.md.
    files: ["scripts/check-shell-size.mjs"],
    languageOptions: {
      globals: {
        process: "readonly",
      },
    },
    rules: {
      "turbo/no-undeclared-env-vars": "off",
    },
  },
];
