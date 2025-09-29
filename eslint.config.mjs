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
  ...config,
  js.configs.recommended,
  eslintConfigPrettier,
  ...tseslint.configs.recommended,
  ...reactSharedConfig,
  ...nextJsSharedConfig,
];
