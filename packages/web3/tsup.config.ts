import { defineConfig } from "tsup";
import { preserveDirectivesPlugin } from "esbuild-plugin-preserve-directives";

export default defineConfig({
  entry: ["src/index.ts"],
  outDir: "dist",
  format: ["esm", "cjs"],
  splitting: false,
  sourcemap: true,
  minify: true,
  target: "es2019",

  dts: {
    compilerOptions: {
      noCheck: true,
    },
  },

  external: [
    "react",
    "react-dom",
    "wagmi",
    "@wagmi/core",
    "@rainbow-me/rainbowkit",
  ],
  esbuildPlugins: [
    preserveDirectivesPlugin({
      directives: ["use client"],
      include: /\.(js|ts|jsx|tsx)$/,
      exclude: /node_modules/,
    }),
  ],
});
