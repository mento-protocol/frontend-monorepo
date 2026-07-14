import { resolve } from "path";
import { mergeConfig } from "vitest/config";
import sharedConfig from "@repo/vitest-config/shared";

const uiSrcDir = resolve(__dirname, "../../packages/ui/src");

export default mergeConfig(sharedConfig, {
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "react",
  },
  resolve: {
    alias: {
      // @mento-protocol/ui's package.json only exposes dist/ (tsup output), so a
      // standalone `pnpm --filter governance.mento.org test` fails to resolve it
      // without a prior turbo build. footer.test.tsx renders the real Footer, so
      // we alias straight to its source instead of mocking it away. We can't
      // alias the package's full barrel (src/index.ts): that pulls in the whole
      // component library (e.g. mode-toggle.tsx), whose own internal "@/..."
      // imports collide with governance's own "@" alias below (same alias
      // string, different roots). Footer's own dependency surface is tiny
      // (two "@/..." imports plus relative icon imports), so we alias directly
      // to its file and resolve those two imports explicitly.
      "@/lib/links.js": resolve(uiSrcDir, "lib/links.ts"),
      "@/lib/utils.js": resolve(uiSrcDir, "lib/utils.ts"),
      "@mento-protocol/ui": resolve(uiSrcDir, "components/footer.tsx"),
      // Mirror the tsconfig path alias used by the app
      "@": resolve(__dirname, "./app"),
    },
  },
  test: {
    environment: "jsdom",
    include: ["app/**/*.test.ts", "app/**/*.test.tsx"],
    // The SDK ships an ESM build with extensionless relative imports that Node's
    // native resolver rejects; inlining lets Vite transform and resolve it.
    // (Mirrors packages/web3/vitest.config.ts, which hit the same issue.)
    server: {
      deps: {
        inline: [/@mento-protocol\/mento-sdk/],
      },
    },
  },
});
