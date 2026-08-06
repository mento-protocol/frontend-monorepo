import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
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
  generateVercelMainCandidateDeploymentId,
  generateVercelMainReleaseId,
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
// CURRENT is a reviewed synthetic predecessor derived from the repository
// lockfile by the hono floor swap below; NEXT is the repository's actual
// 2026-08-05 security-floor lockfile bound by the runtime contract.
const CURRENT_VERCEL_CLI_RUNTIME_LOCKFILE_SHA256 =
  "18c68d51acb53f0de65979c8a69bdb524bb24babda0c3aaf4ef7fea23abf7daa";
const NEXT_VERCEL_CLI_RUNTIME_LOCKFILE_SHA256 =
  "5c70b093926a8ed722b9a912ea9b4f2a3996e373bde2118be9975baf93c8fa9e";
const REVIEWED_VERCEL_CLI_RUNTIME_LOCKFILE_SHA256 = new Set([
  CURRENT_VERCEL_CLI_RUNTIME_LOCKFILE_SHA256,
  NEXT_VERCEL_CLI_RUNTIME_LOCKFILE_SHA256,
]);

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

// The reviewed current/next pair differs by exactly the hono security-floor
// bump, giving the rotation tests two distinct approved states derived from
// the real repository lockfile without replaying historical content.
function toNextVercelCliRuntimeLockfile(lockfile) {
  return lockfile.replace(
    "  hono@<4.12.27: 4.12.27",
    "  hono@<4.12.34: 4.12.34",
  );
}

function toCurrentVercelCliRuntimeLockfile(lockfile) {
  return lockfile.replace(
    "  hono@<4.12.34: 4.12.34",
    "  hono@<4.12.27: 4.12.27",
  );
}

function toCurrentVercelCliRuntimeOverrides(overrides) {
  const current = {
    ...overrides,
    "hono@<4.12.27": "4.12.27",
  };
  delete current["hono@<4.12.34"];
  return current;
}

function writeVercelCliRuntimeOverrides({
  rootPackageJsonPath,
  packageJsonPath,
  overrides,
}) {
  const rootPackageMetadata = JSON.parse(
    readFileSync(rootPackageJsonPath, "utf8"),
  );
  const packageMetadata = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  rootPackageMetadata.pnpm.overrides = overrides;
  packageMetadata.pnpm.overrides = overrides;
  writeFileSync(
    rootPackageJsonPath,
    `${JSON.stringify(rootPackageMetadata, null, 2)}\n`,
  );
  writeFileSync(
    packageJsonPath,
    `${JSON.stringify(packageMetadata, null, 2)}\n`,
  );
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalOverrideSha256(overrides) {
  return sha256(
    JSON.stringify(
      Object.fromEntries(
        Object.entries(overrides).toSorted(([left], [right]) =>
          left.localeCompare(right),
        ),
      ),
    ),
  );
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

test("stable release and candidate IDs survive reruns but stay source-bound", () => {
  const input = {
    repository: "mento-protocol/frontend-monorepo",
    commitSha: COMMIT_SHA,
    upstreamRunId: "123456789",
  };
  const release = generateVercelMainReleaseId(input);
  const appCandidate = generateVercelMainCandidateDeploymentId({
    ...input,
    target: "app",
  });
  const uiCandidate = generateVercelMainCandidateDeploymentId({
    ...input,
    target: "ui",
  });
  assert.equal(release, generateVercelMainReleaseId(input));
  assert.equal(
    appCandidate,
    generateVercelMainCandidateDeploymentId({ ...input, target: "app" }),
  );
  assert.notEqual(appCandidate, uiCandidate);
  assert.notEqual(
    release,
    generateVercelMainReleaseId({ ...input, upstreamRunId: "123456790" }),
  );
  assert.notEqual(
    appCandidate,
    generateVercelMainCandidateDeploymentId({
      ...input,
      commitSha: `1${COMMIT_SHA.slice(1)}`,
      target: "app",
    }),
  );
  assert.equal(assertValidDeploymentId(release), release);
  assert.equal(assertValidDeploymentId(appCandidate), appCandidate);
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
  const prerequisites = assertDeploymentIdPrerequisites(repoRoot);
  const expected = {
    next: "16.2.11",
    vercel: "56.4.1",
    vercelCliRuntime: {
      lockfileSha256: prerequisites.vercelCliRuntime.lockfileSha256,
      patchRequired: false,
      vercel: "56.4.1",
    },
  };
  assert.ok(
    REVIEWED_VERCEL_CLI_RUNTIME_LOCKFILE_SHA256.has(
      prerequisites.vercelCliRuntime.lockfileSha256,
    ),
  );
  assert.deepEqual(prerequisites, expected);
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
  assert.equal(isVersionGreaterThan("56.4.1", "50.3.3"), true);
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
    const repositoryLockfile = readFileSync(lockfilePath, "utf8");
    const repositoryRootOverrides = JSON.parse(
      readFileSync(contractPaths.rootPackageJsonPath, "utf8"),
    ).pnpm.overrides;
    const repositoryDigest =
      assertVercelCliRuntimeContract(contractPaths).lockfileSha256;
    assert.equal(repositoryDigest, NEXT_VERCEL_CLI_RUNTIME_LOCKFILE_SHA256);
    const reviewedNextLockfile = repositoryLockfile;
    const reviewedCurrentLockfile =
      toCurrentVercelCliRuntimeLockfile(reviewedNextLockfile);

    assert.equal(
      toCurrentVercelCliRuntimeLockfile(reviewedNextLockfile),
      reviewedCurrentLockfile,
    );
    assert.equal(
      toNextVercelCliRuntimeLockfile(reviewedCurrentLockfile),
      reviewedNextLockfile,
    );

    const reviewedNextOverrides = repositoryRootOverrides;
    const reviewedCurrentOverrides = toCurrentVercelCliRuntimeOverrides(
      reviewedNextOverrides,
    );
    assert.equal(
      sha256(reviewedCurrentLockfile),
      CURRENT_VERCEL_CLI_RUNTIME_LOCKFILE_SHA256,
    );
    assert.equal(
      sha256(reviewedNextLockfile),
      NEXT_VERCEL_CLI_RUNTIME_LOCKFILE_SHA256,
    );
    const prePatchStates = [
      {
        lockfileSha256: CURRENT_VERCEL_CLI_RUNTIME_LOCKFILE_SHA256,
        overridesSha256: canonicalOverrideSha256(reviewedCurrentOverrides),
      },
      {
        lockfileSha256: NEXT_VERCEL_CLI_RUNTIME_LOCKFILE_SHA256,
        overridesSha256: canonicalOverrideSha256(reviewedNextOverrides),
      },
    ];

    writeVercelCliRuntimeOverrides({
      ...contractPaths,
      overrides: reviewedCurrentOverrides,
    });
    writeFileSync(lockfilePath, reviewedCurrentLockfile);
    assert.equal(
      assertVercelCliRuntimeContract({
        ...contractPaths,
        trustedRuntimeStates: prePatchStates,
      }).lockfileSha256,
      CURRENT_VERCEL_CLI_RUNTIME_LOCKFILE_SHA256,
    );

    writeVercelCliRuntimeOverrides({
      ...contractPaths,
      overrides: reviewedNextOverrides,
    });
    writeFileSync(lockfilePath, reviewedNextLockfile);
    assert.equal(
      assertVercelCliRuntimeContract({
        ...contractPaths,
        trustedRuntimeStates: prePatchStates,
      }).lockfileSha256,
      NEXT_VERCEL_CLI_RUNTIME_LOCKFILE_SHA256,
    );

    for (const [overrides, lockfile] of [
      [reviewedCurrentOverrides, reviewedNextLockfile],
      [reviewedNextOverrides, reviewedCurrentLockfile],
    ]) {
      writeVercelCliRuntimeOverrides({ ...contractPaths, overrides });
      writeFileSync(lockfilePath, lockfile);
      assert.throws(
        () =>
          assertVercelCliRuntimeContract({
            ...contractPaths,
            trustedRuntimeStates: prePatchStates,
          }),
        /lockfile and overrides are not an approved pair/,
      );
    }

    writeVercelCliRuntimeOverrides({
      ...contractPaths,
      overrides: reviewedNextOverrides,
    });
    writeFileSync(
      lockfilePath,
      `${reviewedNextLockfile}\n# unreviewed digest\n`,
    );
    assert.throws(
      () => assertVercelCliRuntimeContract(contractPaths),
      /runtime lockfile is not exact/,
    );

    const fixturePatchPath = join(
      fixtureRoot,
      "scripts",
      "vercel-cli-runtime",
      "patches",
      "brace-expansion@2.1.2.patch",
    );
    mkdirSync(join(fixtureRoot, "scripts", "vercel-cli-runtime", "patches"), {
      recursive: true,
    });
    const patchContents = "diff --git a/index.js b/index.js\n";
    writeFileSync(fixturePatchPath, patchContents);
    const patchedRootPackage = JSON.parse(
      readFileSync(contractPaths.rootPackageJsonPath, "utf8"),
    );
    const patchedRuntimePackage = JSON.parse(
      readFileSync(packageJsonPath, "utf8"),
    );
    const rootPatchPath =
      "scripts/vercel-cli-runtime/patches/brace-expansion@2.1.2.patch";
    const runtimePatchPath = "patches/brace-expansion@2.1.2.patch";
    patchedRootPackage.pnpm.patchedDependencies = {
      "brace-expansion@2.1.2": rootPatchPath,
    };
    patchedRuntimePackage.pnpm.patchedDependencies = {
      "brace-expansion@2.1.2": runtimePatchPath,
    };
    const patchedLockfile = `${reviewedNextLockfile}# patched fixture\n`;
    writeFileSync(
      contractPaths.rootPackageJsonPath,
      `${JSON.stringify(patchedRootPackage, null, 2)}\n`,
    );
    writeFileSync(
      packageJsonPath,
      `${JSON.stringify(patchedRuntimePackage, null, 2)}\n`,
    );
    writeFileSync(lockfilePath, patchedLockfile);
    const patchedStates = [
      {
        lockfileSha256: CURRENT_VERCEL_CLI_RUNTIME_LOCKFILE_SHA256,
        overridesSha256: canonicalOverrideSha256(reviewedCurrentOverrides),
      },
      {
        lockfileSha256: NEXT_VERCEL_CLI_RUNTIME_LOCKFILE_SHA256,
        overridesSha256: canonicalOverrideSha256(reviewedNextOverrides),
      },
      {
        lockfileSha256: sha256(patchedLockfile),
        overridesSha256: canonicalOverrideSha256(reviewedNextOverrides),
        rootPatchSha256: sha256(patchContents),
        patchSha256: sha256(patchContents),
      },
    ];
    assert.deepEqual(
      assertVercelCliRuntimeContract({
        ...contractPaths,
        patchFilePath: fixturePatchPath,
        trustedRuntimeStates: patchedStates,
      }),
      {
        lockfileSha256: sha256(patchedLockfile),
        patchRequired: true,
        vercel: "56.4.1",
      },
    );
    assert.equal(
      assertDeploymentIdPrerequisites(fixtureRoot, {
        runtimeContractStates: patchedStates,
      }).vercelCliRuntime.patchRequired,
      true,
    );

    patchedRuntimePackage.pnpm.patchedDependencies = {
      "brace-expansion@2.1.2": rootPatchPath,
    };
    writeFileSync(
      packageJsonPath,
      `${JSON.stringify(patchedRuntimePackage, null, 2)}\n`,
    );
    assert.throws(
      () =>
        assertVercelCliRuntimeContract({
          ...contractPaths,
          patchFilePath: fixturePatchPath,
          trustedRuntimeStates: patchedStates,
        }),
      /runtime manifest is not exact/,
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
