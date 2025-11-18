import { defineConfig } from "tsup";
import { preserveDirectivesPlugin } from "esbuild-plugin-preserve-directives";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  splitting: false, // keeps everything in one JS file
  minify: true,
  sourcemap: true,
  target: "esnext",
  external: ["react", "react-dom"],
  publicDir: "src/assets",
  esbuildOptions(options) {
    // ✅ give the plugin the metafile
    options.metafile = true;
    // Handle image files as data URLs
    options.loader = {
      ...options.loader,
      ".png": "dataurl",
      ".jpg": "dataurl",
      ".jpeg": "dataurl",
      ".svg": "dataurl",
    };
  },
  esbuildPlugins: [
    preserveDirectivesPlugin({
      directives: ["use client"],
      include: /\.(js|ts|jsx|tsx)$/,
      exclude: /node_modules/,
    }),
  ],
});
