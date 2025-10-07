import { defineConfig } from "tsup";
import { preserveDirectivesPlugin } from "esbuild-plugin-preserve-directives";

export default defineConfig({
  entry: ["src/index.ts", "src/wagmi.ts", "src/wagmi-ssr.ts"],
  outDir: "dist",
  format: ["esm", "cjs"],
  splitting: false,
  sourcemap: true,
  minify: true,
  target: "es2021",

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
    "@repo/web3",
  ],
  esbuildPlugins: [
    preserveDirectivesPlugin({
      directives: ["use client"],
      include: /\.(js|ts|jsx|tsx)$/,
      exclude: /node_modules/,
    }),
  ],
});
