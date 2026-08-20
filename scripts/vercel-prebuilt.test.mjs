import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import process from "node:process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  assertCandidateDeploymentIdPrerequisites,
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
import {
  assertVercelCliRuntimeContract,
  PINNED_VERCEL_CLI_VERSION,
} from "./vercel-cli-runtime-contract.mjs";
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
const FORMER_VERCEL_CLI_RUNTIME_OVERRIDE_SHA256 =
  "301165d803f4cc7db4524ea3a7a02b33db772505c04fdc9025860b244bcb447b";
const activeVercelCliRuntimeContract = JSON.parse(
  readFileSync(
    join(repoRoot, "scripts", "vercel-cli-runtime", "contract.json"),
    "utf8",
  ),
);

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
  copyFileSync(
    join(repoRoot, "scripts", "vercel-cli-runtime", "contract.json"),
    join(runtimeRoot, "contract.json"),
  );
  return fixtureRoot;
}

function formerNanoidOverrides(overrides) {
  const former = { ...overrides };
  assert.equal(former["nanoid@<3.3.18"], "3.3.18");
  delete former["nanoid@<3.3.18"];
  former["nanoid@<3.3.17"] = "3.3.17";
  return former;
}

function canonicalOverrideSha256(overrides) {
  const canonical = Object.fromEntries(
    Object.entries(overrides).toSorted(([left], [right]) =>
      left.localeCompare(right),
    ),
  );
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

function nextPatchVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/u.exec(version);
  assert.ok(match, `Expected an exact stable version, received ${version}`);
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}

function syntheticRegistryIntegrity(sourceIntegrity) {
  const integrity = `sha512-${createHash("sha512")
    .update(`candidate:${sourceIntegrity}`)
    .digest("base64")}`;
  assert.notEqual(integrity, sourceIntegrity);
  return integrity;
}

function formerNanoidLockfile(lockfile) {
  const former = lockfile.replace(
    "  nanoid@<3.3.18: 3.3.18\n",
    "  nanoid@<3.3.17: 3.3.17\n",
  );
  assert.notEqual(former, lockfile);
  return former;
}

function writeRuntimeOverrides({ fixtureRoot, overrides }) {
  for (const path of [
    join(fixtureRoot, "package.json"),
    join(fixtureRoot, "scripts", "vercel-cli-runtime", "package.json"),
  ]) {
    const packageMetadata = JSON.parse(readFileSync(path, "utf8"));
    packageMetadata.pnpm.overrides = overrides;
    writeFileSync(path, `${JSON.stringify(packageMetadata, null, 2)}\n`);
  }
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
    next: "16.2.12",
    vercel: PINNED_VERCEL_CLI_VERSION,
    vercelCliRuntime: {
      lockfileSha256: prerequisites.vercelCliRuntime.lockfileSha256,
      vercel: PINNED_VERCEL_CLI_VERSION,
    },
  };
  assert.equal(
    prerequisites.vercelCliRuntime.lockfileSha256,
    activeVercelCliRuntimeContract.lockfileSha256,
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
  assert.equal(isVersionGreaterThan(PINNED_VERCEL_CLI_VERSION, "50.3.3"), true);
});

test("candidate-only version check accepts a self-consistent rotation without changing controller authority", () => {
  const fixtureRoot = createVersionContractFixture();
  const runtimeRoot = join(fixtureRoot, "scripts", "vercel-cli-runtime");
  const targetVersion = nextPatchVersion(PINNED_VERCEL_CLI_VERSION);
  const targetIntegrity = syntheticRegistryIntegrity(
    activeVercelCliRuntimeContract.registryIntegrity,
  );
  try {
    const runtimePackagePath = join(runtimeRoot, "package.json");
    const runtimePackage = JSON.parse(readFileSync(runtimePackagePath, "utf8"));
    const sourcePythonVersion = runtimePackage.dependencies["@vercel/python"];
    const targetPythonVersion = nextPatchVersion(sourcePythonVersion);
    const rootPackagePath = join(fixtureRoot, "package.json");
    const rootPackage = JSON.parse(readFileSync(rootPackagePath, "utf8"));
    rootPackage.devDependencies.vercel = targetVersion;
    writeFileSync(rootPackagePath, `${JSON.stringify(rootPackage, null, 2)}\n`);
    const rootLockPath = join(fixtureRoot, "pnpm-lock.yaml");
    writeFileSync(
      rootLockPath,
      readFileSync(rootLockPath, "utf8")
        .replaceAll(PINNED_VERCEL_CLI_VERSION, targetVersion)
        .replaceAll(sourcePythonVersion, targetPythonVersion)
        .replaceAll(
          activeVercelCliRuntimeContract.registryIntegrity,
          targetIntegrity,
        ),
    );

    runtimePackage.dependencies["@vercel/python"] = targetPythonVersion;
    runtimePackage.dependencies.vercel = targetVersion;
    const runtimePackageBytes = `${JSON.stringify(runtimePackage, null, 2)}\n`;
    writeFileSync(runtimePackagePath, runtimePackageBytes);
    const runtimeLockPath = join(runtimeRoot, "pnpm-lock.yaml");
    const runtimeLockBytes = readFileSync(runtimeLockPath, "utf8")
      .replaceAll(PINNED_VERCEL_CLI_VERSION, targetVersion)
      .replaceAll(sourcePythonVersion, targetPythonVersion)
      .replaceAll(
        activeVercelCliRuntimeContract.registryIntegrity,
        targetIntegrity,
      );
    writeFileSync(runtimeLockPath, runtimeLockBytes);
    const contract = {
      lockfileSha256: createHash("sha256")
        .update(runtimeLockBytes)
        .digest("hex"),
      manifestSha256: createHash("sha256")
        .update(runtimePackageBytes)
        .digest("hex"),
      overridesSha256: canonicalOverrideSha256(rootPackage.pnpm.overrides),
      registryIntegrity: targetIntegrity,
      runtimeDependenciesSha256: canonicalOverrideSha256(
        runtimePackage.dependencies,
      ),
      schema: "vercel-cli-runtime-contract:v1",
      vercelVersion: targetVersion,
    };
    writeFileSync(
      join(runtimeRoot, "contract.json"),
      `${JSON.stringify(contract, null, 2)}\n`,
    );

    const candidate = assertCandidateDeploymentIdPrerequisites(fixtureRoot);
    assert.equal(candidate.vercel, targetVersion);
    assert.equal(candidate.vercelCliRuntime.vercel, targetVersion);
    assert.equal(
      PINNED_VERCEL_CLI_VERSION,
      activeVercelCliRuntimeContract.vercelVersion,
    );
    assert.notEqual(PINNED_VERCEL_CLI_VERSION, targetVersion);
    assert.equal(
      JSON.parse(
        execFileSync(
          process.execPath,
          [scriptPath, "check-candidate-versions", "--repo-root", fixtureRoot],
          { encoding: "utf8" },
        ),
      ).vercel,
      targetVersion,
    );
    assert.throws(
      () => assertDeploymentIdPrerequisites(fixtureRoot),
      /root Vercel CLI contract is invalid/,
    );
  } finally {
    rmSync(fixtureRoot, { force: true, recursive: true });
  }
});

test("candidate runtime contract rejects a manifest dependency with stale lock resolution", () => {
  const fixtureRoot = createVersionContractFixture();
  const runtimeRoot = join(fixtureRoot, "scripts", "vercel-cli-runtime");
  try {
    const packagePath = join(runtimeRoot, "package.json");
    const packageMetadata = JSON.parse(readFileSync(packagePath, "utf8"));
    packageMetadata.dependencies["@vercel/python"] = nextPatchVersion(
      packageMetadata.dependencies["@vercel/python"],
    );
    const packageBytes = `${JSON.stringify(packageMetadata, null, 2)}\n`;
    writeFileSync(packagePath, packageBytes);
    const contractPath = join(runtimeRoot, "contract.json");
    const contract = JSON.parse(readFileSync(contractPath, "utf8"));
    contract.manifestSha256 = createHash("sha256")
      .update(packageBytes)
      .digest("hex");
    contract.runtimeDependenciesSha256 = canonicalOverrideSha256(
      packageMetadata.dependencies,
    );
    writeFileSync(contractPath, `${JSON.stringify(contract, null, 2)}\n`);
    assert.throws(
      () => assertCandidateDeploymentIdPrerequisites(fixtureRoot),
      /lockfile importer is stale: @vercel\/python/u,
    );
  } finally {
    rmSync(fixtureRoot, { force: true, recursive: true });
  }
});

test("candidate fixed-path checks reject symlinks, devices, and oversized inputs", () => {
  const symlinkFixture = createVersionContractFixture();
  try {
    const rootPackagePath = join(symlinkFixture, "package.json");
    const savedPackagePath = join(symlinkFixture, "saved-package.json");
    writeFileSync(savedPackagePath, readFileSync(rootPackagePath));
    rmSync(rootPackagePath);
    symlinkSync(savedPackagePath, rootPackagePath);
    assert.throws(
      () => assertCandidateDeploymentIdPrerequisites(symlinkFixture),
      /Root package manifest is unreadable or unsafe/u,
    );
  } finally {
    rmSync(symlinkFixture, { force: true, recursive: true });
  }

  assert.throws(
    () =>
      assertVercelCliRuntimeContract({
        contractPath: "/dev/null",
        lockfilePath: "/dev/null",
        packageJsonPath: "/dev/null",
        rootPackageJsonPath: "/dev/null",
      }),
    /runtime contract is unreadable/u,
  );

  const oversizedFixture = createVersionContractFixture();
  try {
    writeFileSync(
      join(oversizedFixture, "scripts", "vercel-cli-runtime", "contract.json"),
      "x".repeat(64 * 1024 + 1),
    );
    assert.throws(
      () => assertCandidateDeploymentIdPrerequisites(oversizedFixture),
      /runtime contract is unreadable/u,
    );
  } finally {
    rmSync(oversizedFixture, { force: true, recursive: true });
  }
});

test("trusted controller accepts only the active Vercel CLI runtime pair", () => {
  const fixtureRoot = createVersionContractFixture();
  const contractPaths = {
    rootPackageJsonPath: join(fixtureRoot, "package.json"),
    packageJsonPath: join(
      fixtureRoot,
      "scripts",
      "vercel-cli-runtime",
      "package.json",
    ),
    lockfilePath: join(
      fixtureRoot,
      "scripts",
      "vercel-cli-runtime",
      "pnpm-lock.yaml",
    ),
    contractPath: join(
      fixtureRoot,
      "scripts",
      "vercel-cli-runtime",
      "contract.json",
    ),
  };
  try {
    const activeDigest =
      assertVercelCliRuntimeContract(contractPaths).lockfileSha256;
    assert.equal(activeDigest, activeVercelCliRuntimeContract.lockfileSha256);
    const activeLockfile = readFileSync(contractPaths.lockfilePath, "utf8");
    const activeOverrides = JSON.parse(
      readFileSync(contractPaths.rootPackageJsonPath, "utf8"),
    ).pnpm.overrides;
    const formerLockfile = formerNanoidLockfile(activeLockfile);
    const formerOverrides = formerNanoidOverrides(activeOverrides);
    const unknownOverrides = {
      ...activeOverrides,
      "nanoid@<3.3.18": "3.3.19",
    };
    assert.equal(
      canonicalOverrideSha256(formerOverrides),
      FORMER_VERCEL_CLI_RUNTIME_OVERRIDE_SHA256,
    );

    for (const { expected, lockfile, name, overrides } of [
      {
        expected: /runtime lockfile is not exact/,
        lockfile: formerLockfile,
        name: "former lockfile and overrides",
        overrides: formerOverrides,
      },
      {
        expected: /runtime manifest is not exact/,
        lockfile: activeLockfile,
        name: "active lockfile with former overrides",
        overrides: formerOverrides,
      },
      {
        expected: /runtime lockfile is not exact/,
        lockfile: formerLockfile,
        name: "former lockfile with active overrides",
        overrides: activeOverrides,
      },
      {
        expected: /runtime lockfile is not exact/,
        lockfile: `${activeLockfile}\n# unreviewed digest\n`,
        name: "unreviewed lockfile",
        overrides: activeOverrides,
      },
      {
        expected: /runtime manifest is not exact/,
        lockfile: activeLockfile,
        name: "unreviewed overrides",
        overrides: unknownOverrides,
      },
    ]) {
      writeRuntimeOverrides({ fixtureRoot, overrides });
      writeFileSync(contractPaths.lockfilePath, lockfile);
      assert.throws(
        () => assertVercelCliRuntimeContract(contractPaths),
        expected,
        name,
      );
    }
  } finally {
    rmSync(fixtureRoot, { force: true, recursive: true });
  }
});

test("version check rejects standalone pin, override, patch, and lockfile drift", () => {
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
        for (const path of [
          join(fixtureRoot, "package.json"),
          join(fixtureRoot, "scripts", "vercel-cli-runtime", "package.json"),
        ]) {
          const packageMetadata = JSON.parse(readFileSync(path, "utf8"));
          packageMetadata.pnpm.overrides["axios@<1.18.0"] = ">=1.18.1";
          writeFileSync(path, `${JSON.stringify(packageMetadata, null, 2)}\n`);
        }
      },
    },
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
        packageMetadata.pnpm.patchedDependencies = {
          "brace-expansion@2.1.2": "patches/brace-expansion@2.1.2.patch",
        };
        writeFileSync(path, `${JSON.stringify(packageMetadata, null, 2)}\n`);
      },
    },
    {
      expected: /runtime manifest is not exact/,
      mutate(fixtureRoot) {
        const path = join(fixtureRoot, "package.json");
        const packageMetadata = JSON.parse(readFileSync(path, "utf8"));
        packageMetadata.pnpm.patchedDependencies = {
          "brace-expansion@2.1.2":
            "scripts/vercel-cli-runtime/patches/brace-expansion@2.1.2.patch",
        };
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
