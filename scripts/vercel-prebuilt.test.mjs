import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
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
import { assertVercelCliRuntimeContract } from "./vercel-cli-runtime-contract.mjs";
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

function createVersionContractFixture() {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "vercel-versions-"));
  const runtimeRoot = join(fixtureRoot, "scripts", "vercel-cli-runtime");
  mkdirSync(runtimeRoot, { recursive: true });
  for (const file of ["package.json", "pnpm-lock.yaml"]) {
    copyFileSync(join(repoRoot, file), join(fixtureRoot, file));
    copyFileSync(
      join(repoRoot, "scripts", "vercel-cli-runtime", file),
      join(runtimeRoot, file),
    );
  }
  return fixtureRoot;
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
  const expected = {
    next: "16.2.11",
    vercel: "56.2.0",
    vercelCliRuntime: {
      lockfileSha256:
        "505674eac656c26fce2fe912a2b14228f8f4f3edd4b3d6d7b0f2c9f08c276d76",
      vercel: "56.2.0",
    },
  };
  assert.deepEqual(assertDeploymentIdPrerequisites(repoRoot), expected);
  assert.deepEqual(
    JSON.parse(
      execFileSync(
        process.execPath,
        [scriptPath, "check-versions", "--repo-root", repoRoot],
        { encoding: "utf8" },
      ),
    ),
    expected,
  );
  assert.equal(isVersionGreaterThan("16.2.10", "16.2.0-canary.15"), true);
  assert.equal(isVersionGreaterThan("56.2.0", "50.3.3"), true);
});

test("trusted controller accepts only the reviewed Vercel CLI runtime lockfile rotation", () => {
  const fixtureRoot = createVersionContractFixture();
  const packageJsonPath = join(
    fixtureRoot,
    "scripts",
    "vercel-cli-runtime",
    "package.json",
  );
  const lockfilePath = join(
    fixtureRoot,
    "scripts",
    "vercel-cli-runtime",
    "pnpm-lock.yaml",
  );
  const contractPaths = {
    rootPackageJsonPath: join(fixtureRoot, "package.json"),
    packageJsonPath,
    lockfilePath,
  };
  try {
    assert.equal(
      assertVercelCliRuntimeContract(contractPaths).lockfileSha256,
      "505674eac656c26fce2fe912a2b14228f8f4f3edd4b3d6d7b0f2c9f08c276d76",
    );

    const reviewedNextLockfile = readFileSync(lockfilePath, "utf8")
      .replace(
        "  '@opentelemetry/core@<2.8.0': '>=2.8.0'",
        "  '@mysten/sui': 1.45.2\n  '@opentelemetry/core@<2.8.0': '>=2.8.0'",
      )
      .replace("  postcss@<8.5.10: '>=8.5.10'", "  postcss@<8.5.18: 8.5.18")
      .replace("  tar@>=7.0.0 <7.5.16: 7.5.20", "  tar@>=7.0.0 <7.5.21: 7.5.21")
      .replace(
        "  vite@>=7.0.0 <7.3.5: 7.3.5",
        "  valibot@>=1.0.0 <1.4.2: 1.4.2\n  vite@>=7.0.0 <7.3.5: 7.3.5",
      )
      .replace(
        "  tar@7.5.20:\n    resolution: {integrity: sha512-9FcyK4PA6+WbzlTM9WhQm6vB5W7cP7dUiPsv1g7YDwEQnQ1CGpK3MGlKk/ITVWMk05kHZuBhmVhiv8LZoy/PFQ==}",
        "  tar@7.5.21:\n    resolution: {integrity: sha512-XdhtCvlMywwxpCW8YEq3lOXBJpUPTR2OHHcwLPO3HwsJqOHa2Ok/oJ7ruGzp+JrKoRPVCzJwAdEjqLW/vNRPHA==}",
      )
      .replace("      tar: 7.5.20", "      tar: 7.5.21")
      .replace("      tar: 7.5.20", "      tar: 7.5.21")
      .replace(
        "  tar@7.5.20:\n    dependencies:",
        "  tar@7.5.21:\n    dependencies:",
      );
    writeFileSync(lockfilePath, reviewedNextLockfile);
    assert.equal(
      assertVercelCliRuntimeContract(contractPaths).lockfileSha256,
      "884e3c4186c9d5faee0e6cf710b112e7e60cdae5d46be13da1b2b0ae9cf11eb0",
    );

    writeFileSync(
      lockfilePath,
      `${reviewedNextLockfile}\n# unreviewed digest\n`,
    );
    assert.throws(
      () => assertVercelCliRuntimeContract(contractPaths),
      /runtime lockfile is not exact/,
    );
  } finally {
    rmSync(fixtureRoot, { force: true, recursive: true });
  }
});

test("version check rejects standalone pin, override, and lockfile drift", () => {
  const cases = [
    {
      expected: /runtime manifest is not exact/,
      mutate(fixtureRoot) {
        const path = join(
          fixtureRoot,
          "scripts",
          "vercel-cli-runtime",
          "package.json",
        );
        const packageMetadata = JSON.parse(readFileSync(path, "utf8"));
        packageMetadata.dependencies.vercel = "56.2.1";
        writeFileSync(path, `${JSON.stringify(packageMetadata, null, 2)}\n`);
      },
    },
    {
      expected: /runtime manifest is not exact/,
      mutate(fixtureRoot) {
        const path = join(fixtureRoot, "package.json");
        const packageMetadata = JSON.parse(readFileSync(path, "utf8"));
        packageMetadata.pnpm.overrides["axios@<1.18.0"] = ">=1.18.1";
        writeFileSync(path, `${JSON.stringify(packageMetadata, null, 2)}\n`);
      },
    },
    {
      expected: /runtime lockfile is not exact/,
      mutate(fixtureRoot) {
        const path = join(
          fixtureRoot,
          "scripts",
          "vercel-cli-runtime",
          "pnpm-lock.yaml",
        );
        writeFileSync(path, `${readFileSync(path, "utf8")}\n`);
      },
    },
  ];

  for (const fixtureCase of cases) {
    const fixtureRoot = createVersionContractFixture();
    try {
      fixtureCase.mutate(fixtureRoot);
      assert.throws(
        () => assertDeploymentIdPrerequisites(fixtureRoot),
        fixtureCase.expected,
      );
    } finally {
      rmSync(fixtureRoot, { force: true, recursive: true });
    }
  }
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
