import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const SHARP_RUNTIME_VERSION = "0.35.3";
export const SHARP_LIBVIPS_PACKAGE_VERSION = "1.3.2";

export function sharpRuntimePlatform() {
  let platform = process.platform;
  if (platform === "linux") {
    const glibcVersion =
      process.report?.getReport?.().header?.glibcVersionRuntime;
    if (!glibcVersion) platform = "linuxmusl";
  }
  return `${platform}-${process.arch}`;
}

function sharpOutputFileTracingIncludes(runtimePlatform) {
  const nativePackage = `sharp-${runtimePlatform}`;
  const libvipsPackage = `sharp-libvips-${runtimePlatform}`;
  return [
    `../../node_modules/.pnpm/sharp@${SHARP_RUNTIME_VERSION}*/node_modules/sharp/**/*`,
    `../../node_modules/.pnpm/@img+${nativePackage}@${SHARP_RUNTIME_VERSION}/node_modules/@img/${nativePackage}/**/*`,
    ...(runtimePlatform.startsWith("win32-")
      ? []
      : [
          `../../node_modules/.pnpm/@img+${libvipsPackage}@${SHARP_LIBVIPS_PACKAGE_VERSION}/node_modules/@img/${libvipsPackage}/**/*`,
        ]),
  ];
}

/**
 * Include sharp 0.35's versioned native addon and libvips shared library in
 * Next.js output traces until issue #587 verifies stable upstream support.
 *
 * @param {string | URL} appConfigUrl import.meta.url from an app's Next config
 */
export function sharpOutputFileTracingConfig(appConfigUrl) {
  const appDirectory = dirname(fileURLToPath(appConfigUrl));
  const runtimePlatform = sharpRuntimePlatform();
  return {
    outputFileTracingRoot: resolve(appDirectory, "../.."),
    outputFileTracingIncludes: {
      "/*": sharpOutputFileTracingIncludes(runtimePlatform),
    },
  };
}
