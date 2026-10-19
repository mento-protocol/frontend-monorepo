import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const SHARP_RUNTIME_VERSION = "0.35.4";
export const SHARP_LIBVIPS_PACKAGE_VERSION = "1.3.3";
export const SHARP_LIBVIPS_RUNTIME_VERSION = "8.18.6";

/**
 * Sharp and libvips runtime pairs that the trusted prebuilt workflow accepts.
 * Main's copy checks every candidate, so a sharp upgrade first lands here as
 * an added pair, then moves the tracing constants above, then drops the old
 * pair. The current tracing pair must always be listed.
 */
export const TRUSTED_SHARP_RUNTIMES = Object.freeze([
  Object.freeze({ sharp: "0.35.4", libvips: "8.18.6" }),
  Object.freeze({ sharp: "0.35.5", libvips: "8.18.7" }),
]);

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
