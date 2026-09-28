import pluginReactHooks from "eslint-plugin-react-hooks";
import pluginReact from "eslint-plugin-react";
import pluginNext from "@next/eslint-plugin-next";
import globals from "globals";

// eslint-plugin-react's "detect" calls context.getFilename(), which ESLint 10
// removed, so every run crashed. Keep this in step with the catalog's react.
const REACT_VERSION = "19.2";

/**
 * Shared React configuration that can be extended by both Next.js and React internal configs.
 * This eliminates duplication between the two configurations.
 *
 * @type {import("eslint").Linter.Config[]}
 */
export const reactSharedConfig = [
  {
    plugins: {
      react: pluginReact,
    },
    languageOptions: {
      ...pluginReact.configs.flat.recommended.languageOptions,
      globals: {
        ...globals.serviceworker,
        ...globals.browser,
      },
    },
    rules: {
      ...pluginReact.configs.flat.recommended.rules,
      // Disable prop-types rule for TypeScript projects since TypeScript provides better type checking
      "react/prop-types": "off",
    },
    settings: {
      react: {
        version: REACT_VERSION,
      },
    },
  },
  {
    plugins: {
      "react-hooks": pluginReactHooks,
    },
    settings: { react: { version: REACT_VERSION } },
    rules: {
      ...pluginReactHooks.configs.recommended.rules,
      // React scope no longer necessary with new JSX transform.
      "react/react-in-jsx-scope": "off",
    },
  },
];

/**
 * Shared Next.js configuration for apps.
 *
 * @type {import("eslint").Linter.Config[]}
 */
export const nextJsSharedConfig = [
  {
    files: ["apps/**/*.js", "apps/**/*.jsx", "apps/**/*.ts", "apps/**/*.tsx"],
    plugins: {
      "@next/next": pluginNext,
      next: pluginNext,
    },
    rules: {
      ...pluginNext.configs.recommended.rules,
      ...pluginNext.configs["core-web-vitals"].rules,
    },
  },
];
