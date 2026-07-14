import { resolve } from "path";
import { mergeConfig } from "vitest/config";
import sharedConfig from "@repo/vitest-config/shared";

export default mergeConfig(sharedConfig, {
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
  test: {
    // The SDK ships an ESM build with extensionless relative imports that Node's
    // native resolver rejects; inlining lets Vite transform and resolve it.
    server: {
      deps: {
        inline: [/@mento-protocol\/mento-sdk/],
      },
    },
    coverage: {
      all: true, // untested included files count as 0% — keeps the gate deletion-proof
      include: [
        "src/features/borrow/leverage/math.ts",
        "src/features/swap/utils.ts",
        "src/features/swap/route-liquidity.ts",
      ],
      thresholds: {
        statements: 90,
        lines: 90,
        branches: 90,
        functions: 90,
      },
    },
  },
});
