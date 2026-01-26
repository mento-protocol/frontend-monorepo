import { resolve } from "path";
import { mergeConfig } from "vitest/config";
import sharedConfig from "@repo/vitest-config/shared";

export default mergeConfig(sharedConfig, {
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
});
