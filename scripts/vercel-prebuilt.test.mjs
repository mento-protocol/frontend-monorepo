import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import process from "node:process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  assertDeploymentIdPrerequisites,
  assertPrebuiltDeploymentId,
  assertValidDeploymentId,
  CUSTOM_DEPLOYMENT_ID_ENV,
  generateVercelDeploymentId,
  isVersionGreaterThan,
  VERCEL_TARGETS,
} from "./vercel-prebuilt.mjs";
import {
  assertSharpOutputTrace,
  isSharpManifestPath,
} from "./assert-next-sharp-trace.mjs";
import {
  sharpOutputFileTracingConfig,
  SHARP_LIBVIPS_PACKAGE_VERSION,
  SHARP_RUNTIME_VERSION,
} from "./next-sharp-output-tracing.mjs";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const scriptPath = fileURLToPath(
  new URL("./vercel-prebuilt.mjs", import.meta.url),
);
const COMMIT_SHA = "0123456789abcdef0123456789abcdef01234567";

function deploymentId(overrides = {}) {
  return generateVercelDeploymentId({
    target: "app",
    commitSha: COMMIT_SHA,
    runId: "123456789",
    runAttempt: "1",
    ...overrides,
  });
}

test("generated IDs satisfy every Vercel constraint for every target", () => {
  for (const target of VERCEL_TARGETS) {
    const value = deploymentId({ target });
    assert.ok(value.length <= 32, `${target}: ${value}`);
    assert.match(value, /^[A-Za-z0-9_-]+$/);
    assert.equal(value.startsWith("dpl_"), false);
    assert.equal(assertValidDeploymentId(value), value);
  }
});

test("generated IDs are stable within a workflow attempt", () => {
  assert.equal(deploymentId(), deploymentId());
});

test("generated IDs differ across target, SHA, run, and rerun attempt", () => {
  const baseline = deploymentId();
  const variants = [
    deploymentId({ target: "reserve" }),
    deploymentId({ commitSha: `1${COMMIT_SHA.slice(1)}` }),
    deploymentId({ runId: "123456790" }),
    deploymentId({ runAttempt: "2" }),
  ];
  assert.equal(new Set([baseline, ...variants]).size, variants.length + 1);
});

test("deployment ID input validation rejects mutable or malformed identity", () => {
  for (const overrides of [
    { target: "unknown" },
    { commitSha: "main" },
    { runId: "0" },
    { runAttempt: "retry" },
  ]) {
    assert.throws(() => deploymentId(overrides));
  }
  assert.throws(() => assertValidDeploymentId("dpl_reserved"));
  assert.throws(() => assertValidDeploymentId("invalid value"));
  assert.throws(() => assertValidDeploymentId("x".repeat(33)));
});

test("generated ID propagates into and is asserted from prebuilt config", () => {
  const directory = mkdtempSync(join(tmpdir(), "vercel-output-"));
  const outputDirectory = join(directory, ".vercel", "output");
  const expected = deploymentId();
  try {
    mkdirSync(outputDirectory, { recursive: true });
    writeFileSync(
      join(outputDirectory, "config.json"),
      JSON.stringify({ version: 3, deploymentId: expected }),
    );
    assert.equal(
      assertPrebuiltDeploymentId(outputDirectory, expected),
      expected,
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("prebuilt assertion rejects missing, malformed, or mismatched output", () => {
  const directory = mkdtempSync(join(tmpdir(), "vercel-output-"));
  const expected = deploymentId();
  try {
    assert.throws(
      () => assertPrebuiltDeploymentId(directory, expected),
      /Missing or invalid prebuilt config/,
    );
    writeFileSync(join(directory, "config.json"), "not json");
    assert.throws(
      () => assertPrebuiltDeploymentId(directory, expected),
      /Missing or invalid prebuilt config/,
    );
    writeFileSync(
      join(directory, "config.json"),
      JSON.stringify({ version: 3 }),
    );
    assert.throws(
      () => assertPrebuiltDeploymentId(directory, expected),
      /missing deploymentId/,
    );
    writeFileSync(
      join(directory, "config.json"),
      JSON.stringify({
        version: 3,
        deploymentId: deploymentId({ runAttempt: "2" }),
      }),
    );
    assert.throws(
      () => assertPrebuiltDeploymentId(directory, expected),
      /does not match/,
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("resolved Next.js and exact Vercel CLI satisfy custom-ID prerequisites", () => {
  assert.deepEqual(assertDeploymentIdPrerequisites(repoRoot), {
    next: "16.2.11",
    vercel: "56.2.0",
  });
  assert.equal(isVersionGreaterThan("16.2.10", "16.2.0-canary.15"), true);
  assert.equal(isVersionGreaterThan("56.2.0", "50.3.3"), true);
});

test("all Next apps use the shared sharp output-tracing workaround", () => {
  for (const target of VERCEL_TARGETS) {
    const appDirectory =
      target === "app" ? "app.mento.org" : `${target}.mento.org`;
    const configUrl = new URL(
      `../apps/${appDirectory}/next.config.ts`,
      import.meta.url,
    );
    const source = readFileSync(configUrl, "utf8");
    const tracing = sharpOutputFileTracingConfig(configUrl);

    assert.equal(tracing.outputFileTracingRoot, resolve(repoRoot));
    assert.deepEqual(Object.keys(tracing.outputFileTracingIncludes), ["/*"]);
    assert.ok(
      tracing.outputFileTracingIncludes["/*"].every(
        (pattern) =>
          pattern.startsWith("../../node_modules/.pnpm/") &&
          (pattern.includes(SHARP_RUNTIME_VERSION) ||
            pattern.includes(SHARP_LIBVIPS_PACKAGE_VERSION)),
      ),
    );
    assert.match(source, /sharpOutputFileTracingConfig\(import\.meta\.url\)/);
  }
});

test("sharp manifests are recognized with POSIX and Windows separators", () => {
  assert.equal(
    isSharpManifestPath("/repo/node_modules/sharp/package.json"),
    true,
  );
  assert.equal(
    isSharpManifestPath("C:\\repo\\node_modules\\sharp\\package.json"),
    true,
  );
  assert.equal(
    isSharpManifestPath("C:\\repo\\node_modules\\not-sharp\\package.json"),
    false,
  );
});

test("sharp postbuild assertion requires one complete runtime trace", () => {
  const directory = mkdtempSync(join(tmpdir(), "next-sharp-trace-"));
  const buildDirectory = join(directory, "app", ".next");
  const traceDirectory = join(buildDirectory, "server", "app", "page");
  const sharpManifest = join(
    directory,
    "node_modules",
    ".pnpm",
    "sharp@0.35.3",
    "node_modules",
    "sharp",
    "package.json",
  );
  const nativeAddon = join(
    directory,
    "node_modules",
    ".pnpm",
    "@img+sharp-linux-x64@0.35.3",
    "node_modules",
    "@img",
    "sharp-linux-x64",
    "lib",
    "sharp-linux-x64-0.35.3.node",
  );
  const unrelatedNativeAddon = join(
    directory,
    "node_modules",
    ".pnpm",
    "@img+sharp-win32-arm64@0.35.3",
    "node_modules",
    "@img",
    "sharp-win32-arm64",
    "lib",
    "sharp-win32-arm64-0.35.3.node",
  );
  const libvipsDirectory = join(
    directory,
    "node_modules",
    ".pnpm",
    "@img+sharp-libvips-linux-x64@1.3.2",
    "node_modules",
    "@img",
    "sharp-libvips-linux-x64",
  );
  const sharedLibrary = join(libvipsDirectory, "lib", "libvips-cpp.so.8.18.3");
  const versionsManifest = join(libvipsDirectory, "versions.json");
  const tracePath = join(traceDirectory, "route.js.nft.json");

  try {
    for (const path of [
      sharpManifest,
      nativeAddon,
      unrelatedNativeAddon,
      sharedLibrary,
      versionsManifest,
    ]) {
      mkdirSync(join(path, ".."), { recursive: true });
    }
    mkdirSync(traceDirectory, { recursive: true });
    writeFileSync(sharpManifest, JSON.stringify({ version: "0.35.3" }));
    writeFileSync(nativeAddon, "native");
    writeFileSync(unrelatedNativeAddon, "unrelated native");
    writeFileSync(sharedLibrary, "libvips");
    writeFileSync(versionsManifest, JSON.stringify({ vips: "8.18.3" }));
    writeFileSync(
      tracePath,
      JSON.stringify({
        version: 1,
        files: [
          sharpManifest,
          nativeAddon,
          unrelatedNativeAddon,
          sharedLibrary,
          versionsManifest,
        ].map((path) => relative(traceDirectory, path)),
      }),
    );

    assert.deepEqual(
      assertSharpOutputTrace(buildDirectory, {
        runtimePlatform: "linux-x64",
      }),
      {
        libvipsVersion: "8.18.3",
        nativeAddon,
        sharpManifest,
        sharedLibrary,
        tracePath,
        versionsManifest,
      },
    );
    rmSync(sharedLibrary);
    assert.throws(
      () =>
        assertSharpOutputTrace(buildDirectory, {
          runtimePlatform: "linux-x64",
        }),
      /No single Next output trace contains sharp 0\.35\.3.*libvips 8\.18\.3/,
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("prerelease comparison follows numeric SemVer identifier ordering", () => {
  const minimum = "16.2.0-canary.15";
  assert.equal(isVersionGreaterThan("16.2.0-canary.9", minimum), false);
  assert.equal(isVersionGreaterThan("16.2.0-canary.15", minimum), false);
  assert.equal(isVersionGreaterThan("16.2.0-canary.100", minimum), true);
  assert.equal(isVersionGreaterThan("16.2.0-canary.15.1", minimum), true);
  assert.equal(isVersionGreaterThan("16.2.0", minimum), true);
});

test("all Next configs and app Turbo inputs use one custom ID variable", () => {
  for (const target of VERCEL_TARGETS) {
    const appDirectory =
      target === "app" ? "app.mento.org" : `${target}.mento.org`;
    const nextConfig = readFileSync(
      new URL(`../apps/${appDirectory}/next.config.ts`, import.meta.url),
      "utf8",
    );
    const turboConfig = readFileSync(
      new URL(`../apps/${appDirectory}/turbo.json`, import.meta.url),
      "utf8",
    );
    assert.match(
      nextConfig,
      new RegExp(`process\\.env\\.${CUSTOM_DEPLOYMENT_ID_ENV}`),
    );
    assert.match(nextConfig, /deploymentId/);
    assert.match(nextConfig, /runtimeServerDeploymentId: false/);
    assert.match(turboConfig, new RegExp(CUSTOM_DEPLOYMENT_ID_ENV));
  }
});

test("CLI computes the same ID as the library", () => {
  const output = execFileSync(
    process.execPath,
    [
      scriptPath,
      "deployment-id",
      "--target",
      "app",
      "--sha",
      COMMIT_SHA,
      "--run-id",
      "123456789",
      "--run-attempt",
      "1",
    ],
    { encoding: "utf8" },
  ).trim();
  assert.equal(output, deploymentId());
});
