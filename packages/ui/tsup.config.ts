import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  // When setting this to true, there is a race condition with the css build
  // so we need to set it to false. If the css build finishes first, the tsup
  // clean step will delete the css file again and the build will fail.
  clean: false,
  minify: true,
  splitting: true,
  external: ["react", "react-dom"],
  treeshake: true,
  target: "esnext",
  banner: {
    js: '"use client";',
  },
});
