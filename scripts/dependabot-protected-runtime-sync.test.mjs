import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  applyValidatedPlanToEvidence,
  createRuntimeContract,
  createUnifiedPatch,
  generateProtectedRuntimeRepairPlan,
  inspectGeneratedNextRuntimeLock,
  NEXT_CATALOG_SYNC_REQUIRED_PATHS,
  nextCandidateInstallArguments,
  pnpmInstallArguments,
  PROTECTED_RUNTIME_SYNC_INPUT_PATHS,
  PROTECTED_RUNTIME_SYNC_REQUIRED_PATHS,
  rotateNextCatalogWorkspaceBytes,
  rotateNextOverridePackageBytes,
  rotateNextRootLockBytes,
  rotateNextStandaloneRuntimeLockBytes,
  rotateRootLockBytes,
  rotateRootPackageBytes,
  validateRegistryTransition,
  verifySecretlessNextCandidateBuild,
} from "./dependabot-protected-runtime-sync.mjs";
import {
  canonicalJson,
  validateRepairPlan,
} from "./dependabot-preparation-receipts.mjs";
import { assertVercelCliRuntimeContract } from "./vercel-cli-runtime-contract.mjs";

const REPOSITORY_ROOT = fileURLToPath(new URL("..", import.meta.url));
const FROM_VERSION = "56.4.1";
const TARGET_VERSION = "56.5.0";
const SOURCE_INTEGRITY =
  "sha512-+CIEa0qcKm1RNBRhOvpo2l/yz28LMKSDuGeAYGx4/EkYyR5VOrXJZYV52WvqVARcxBAbH3Un2RRin8YGXMlcNg==";
const TARGET_INTEGRITY =
  "sha512-wAKpT8DFSbnwlgbS711fbvxGjOfQeb1n+NcaBaSC4onq9eJAjbPfERrjrKE4GDsV8dkoBo0627lp0QxbLCGFiw==";
const NEXT_FROM_VERSION = "16.2.12";
const NEXT_TARGET_VERSION = "16.3.1";
const NEXT_FROM_SPECIFIER = `^${NEXT_FROM_VERSION}`;
const NEXT_TARGET_SPECIFIER = `^${NEXT_TARGET_VERSION}`;
const NEXT_TARGET_INTEGRITY =
  "sha512-hsAp0i7Rh+/dhe7DGIeN2YlpLM1DP4MNxti9EtDMtqcO612X81MvvEj388/oTce9U1EcEIOWDlGq0zRwrBKvuA==";
const NEXT_SWC_NAMES = [
  "@next/swc-darwin-arm64",
  "@next/swc-darwin-x64",
  "@next/swc-linux-arm64-gnu",
  "@next/swc-linux-arm64-musl",
  "@next/swc-linux-x64-gnu",
  "@next/swc-linux-x64-musl",
  "@next/swc-win32-arm64-msvc",
  "@next/swc-win32-x64-msvc",
];
const TYPED_NPM_REQUIRED_GATE_IDS = [
  "ci",
  "action-pins",
  "action-pins-source",
  "dependency-review",
  "supply-chain-root-osv",
  "supply-chain-pnpm-runtime-osv",
  "supply-chain-vercel-runtime-osv",
  "supply-chain-pnpm-bootstrap-osv",
  "supply-chain-lockfile",
  "supply-chain-version-skew",
  "quality",
  "e2e-plan",
  "e2e-seed",
  "e2e-celo",
  "e2e-governance",
  "e2e-monad",
  "visual-plan",
  "visual-ui",
  "visual-app",
  "claude-review",
  "vercel-preview",
];
const TYPED_NPM_VALIDATION_COMMANDS = [
  "pnpm install --frozen-lockfile",
  "pnpm quality:budgets:test",
  "pnpm quality:coverage",
  "pnpm build",
  "pnpm quality:bundle:check",
];
const STABLE_BUILDER_DEPENDENCIES = {
  "@vercel/backends": "0.8.25",
  "@vercel/container": "0.0.5",
  "@vercel/elysia": "0.1.102",
  "@vercel/express": "0.1.116",
  "@vercel/fastify": "0.1.105",
  "@vercel/go": "3.10.2",
  "@vercel/h3": "0.1.111",
  "@vercel/hono": "0.2.105",
  "@vercel/hydrogen": "1.4.0",
  "@vercel/koa": "0.1.85",
  "@vercel/nestjs": "0.2.106",
  "@vercel/next": "4.20.4",
  "@vercel/node": "5.8.26",
  "@vercel/redwood": "2.5.0",
  "@vercel/remix-builder": "5.9.1",
  "@vercel/ruby": "2.5.1",
  "@vercel/rust": "1.4.0",
  "@vercel/static-build": "2.11.8",
};
const PR_753_SEED = "374c0899cdadf5be3197bcabe1549af82bdf36df";
const PR_753_IMMUTABLE_SOURCE = "87b50107da06b3d22d6e4a70a43027e48838a4ab";
const PR_753_REPAIRED_HEAD = "7e15d2d5596e81364e44d6d46dd1b212351cc070";
const PR_753_TARGET_ROOT_PACKAGE_SHA256 =
  "4be4c1dc5ffb0fbf2b9c8d8aceb214da348c1c94d6bbb34fb0946092c4e9dc8c";
const PR_753_TARGET_RUNTIME_PACKAGE_SHA256 =
  "623f415ef559c635964cd2f3e046df222b8177edfdad2c04ab7163b524c50738";
const PR_753_TARGET_RUNTIME_LOCK_SHA256 =
  "c512b310653b45f654e8d9204a84fbeea4159617020e242f90ab31b8919da921";
const HAS_PR_753_OBJECTS =
  spawnSync("git", ["cat-file", "-e", `${PR_753_SEED}^{commit}`], {
    cwd: REPOSITORY_ROOT,
    stdio: "ignore",
  }).status === 0 &&
  spawnSync("git", ["cat-file", "-e", `${PR_753_REPAIRED_HEAD}^{commit}`], {
    cwd: REPOSITORY_ROOT,
    stdio: "ignore",
  }).status === 0;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function nextPatchVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/u.exec(version);
  assert.ok(match, `Expected an exact stable version, received ${version}`);
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}

function gitBlobSha(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return createHash("sha1")
    .update(`blob ${bytes.byteLength}\0`)
    .update(bytes)
    .digest("hex");
}

function registryMetadata(version) {
  assert.ok([FROM_VERSION, TARGET_VERSION].includes(version));
  const peers = {
    ...STABLE_BUILDER_DEPENDENCIES,
    "@vercel/python": version === FROM_VERSION ? "6.51.0" : "6.51.1",
  };
  return {
    bin: { vc: "dist/vc.js", vercel: "dist/vc.js" },
    dependencies: { ...peers },
    dist: {
      integrity:
        version === TARGET_VERSION ? TARGET_INTEGRITY : SOURCE_INTEGRITY,
      tarball: `https://registry.npmjs.org/vercel/-/vercel-${version}.tgz`,
    },
    engines: { node: ">= 18" },
    name: "vercel",
    peerDependencies: peers,
    peerDependenciesMeta: Object.fromEntries(
      Object.keys(peers).map((name) => [name, { optional: true }]),
    ),
    version,
  };
}

function sourceMetadata() {
  return registryMetadata(FROM_VERSION);
}

function targetMetadata() {
  return registryMetadata(TARGET_VERSION);
}

test("registry transition accepts only exact stable same-major builder peers", () => {
  const source = sourceMetadata();
  const currentRuntimeDependencies = {
    ...source.peerDependencies,
    vercel: FROM_VERSION,
  };
  const metadata = targetMetadata();
  const result = validateRegistryTransition({
    currentRuntimeDependencies,
    fromVersion: FROM_VERSION,
    sourceMetadata: source,
    targetMetadata: metadata,
    targetVersion: TARGET_VERSION,
    updateType: "minor",
  });
  assert.equal(result.targetIntegrity, TARGET_INTEGRITY);
  assert.equal(result.targetPeers["@vercel/python"], "6.51.1");

  for (const invalid of [
    { ...metadata, version: "57.0.0" },
    {
      ...metadata,
      peerDependencies: { ...metadata.peerDependencies, injected: "1.0.0" },
    },
    {
      ...metadata,
      dependencies: { ...metadata.dependencies, "@vercel/python": "6.51.0" },
    },
    {
      ...metadata,
      peerDependencies: {
        ...metadata.peerDependencies,
        "@vercel/python": "5.99.0",
      },
    },
  ]) {
    assert.throws(
      () =>
        validateRegistryTransition({
          currentRuntimeDependencies,
          fromVersion: FROM_VERSION,
          sourceMetadata: source,
          targetMetadata: invalid,
          targetVersion: TARGET_VERSION,
          updateType: "minor",
        }),
      /Protected runtime sync rejected/,
    );
  }

  for (const invalid of [
    { ...metadata, engines: { node: ">= 20" } },
    { ...metadata, bin: { vercel: "dist/other.js" } },
  ]) {
    assert.throws(
      () =>
        validateRegistryTransition({
          currentRuntimeDependencies,
          fromVersion: FROM_VERSION,
          sourceMetadata: source,
          targetMetadata: invalid,
          targetVersion: TARGET_VERSION,
          updateType: "minor",
        }),
      /preserved metadata shape changed|non-builder dependency shape changed/u,
    );
  }
});

test("runtime contract binds exact manifest, dependency, lock, override, and registry bytes", () => {
  const manifestBytes = Buffer.from("manifest\n");
  const lockfileBytes = Buffer.from("lock\n");
  const runtimeDependencies = {
    "@vercel/python": "6.51.1",
    vercel: TARGET_VERSION,
  };
  const overrides = { "hono@<4.12.34": "4.12.34" };
  const contract = createRuntimeContract({
    integrity: TARGET_INTEGRITY,
    lockfileBytes,
    manifestBytes,
    overrides,
    runtimeDependencies,
    targetVersion: TARGET_VERSION,
  });
  assert.deepEqual(Object.keys(contract), [
    "lockfileSha256",
    "manifestSha256",
    "overridesSha256",
    "registryIntegrity",
    "runtimeDependenciesSha256",
    "schema",
    "vercelVersion",
  ]);
  assert.equal(contract.manifestSha256, sha256(manifestBytes));
  assert.equal(contract.lockfileSha256, sha256(lockfileBytes));
  assert.equal(contract.registryIntegrity, TARGET_INTEGRITY);
  assert.equal(contract.vercelVersion, TARGET_VERSION);
});

test("Next override changes propagate through every runtime contract digest they affect", () => {
  const runtimeDependencies = {
    "@vercel/python": "6.51.1",
    vercel: TARGET_VERSION,
  };
  const sourceOverrides = {
    "hono@<4.12.34": "4.12.34",
    next: NEXT_FROM_SPECIFIER,
  };
  const targetOverrides = {
    ...sourceOverrides,
    next: NEXT_TARGET_SPECIFIER,
  };
  const contractFor = (overrides) =>
    createRuntimeContract({
      integrity: TARGET_INTEGRITY,
      lockfileBytes: Buffer.from(
        `lockfileVersion: '9.0'\noverrides:\n  next: ${overrides.next}\n`,
      ),
      manifestBytes: Buffer.from(
        `${JSON.stringify(
          { dependencies: runtimeDependencies, pnpm: { overrides } },
          null,
          2,
        )}\n`,
      ),
      overrides,
      runtimeDependencies,
      targetVersion: TARGET_VERSION,
    });

  const source = contractFor(sourceOverrides);
  const target = contractFor(targetOverrides);
  assert.notEqual(target.overridesSha256, source.overridesSha256);
  assert.notEqual(target.manifestSha256, source.manifestSha256);
  assert.notEqual(target.lockfileSha256, source.lockfileSha256);
  assert.equal(
    target.runtimeDependenciesSha256,
    source.runtimeDependenciesSha256,
  );
  assert.equal(target.registryIntegrity, source.registryIntegrity);
  assert.equal(target.vercelVersion, source.vercelVersion);
});

test("repair patches use bounded U1 context", () => {
  const root = mkdtempSync(join(tmpdir(), "protected-runtime-patch-"));
  try {
    const patch = createUnifiedPatch({
      newBytes: Buffer.from("one\ntarget\nthree\n"),
      oldBytes: Buffer.from("one\nsource\nthree\n"),
      path: "package.json",
      temporaryRoot: root,
    });
    assert.match(patch, /^--- a\/package\.json\n\+\+\+ b\/package\.json\n@@/u);
    assert.match(patch, /@@ -1,3 \+1,3 @@/u);
    assert.ok(Buffer.byteLength(patch) <= 8_192);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test(
  "PR #753 historical package rotation exactly restores H1 bytes",
  { skip: !HAS_PR_753_OBJECTS },
  () => {
    const historicalH2 = gitShow(PR_753_REPAIRED_HEAD, "package.json");
    const historicalH1 = gitShow(PR_753_SEED, "package.json");
    assert.deepEqual(
      rotateRootPackageBytes(historicalH2, TARGET_VERSION),
      historicalH1,
    );
    assert.equal(sha256(historicalH1), PR_753_TARGET_ROOT_PACKAGE_SHA256);
  },
);

test(
  "PR #753 surgical root-lock rotation changes only the authenticated Vercel regions",
  { skip: !HAS_PR_753_OBJECTS },
  () => {
    const source = sourceMetadata();
    const target = targetMetadata();
    const rotated = rotateRootLockBytes({
      bin: target.bin,
      currentVersion: FROM_VERSION,
      engines: target.engines,
      lockfileBytes: gitShow(PR_753_REPAIRED_HEAD, "pnpm-lock.yaml"),
      sourceIntegrity: source.dist.integrity,
      sourcePeers: source.peerDependencies,
      sourceVersion: FROM_VERSION,
      targetIntegrity: target.dist.integrity,
      targetPeers: target.peerDependencies,
      targetVersion: TARGET_VERSION,
    });
    assert.deepEqual(rotated, gitShow(PR_753_SEED, "pnpm-lock.yaml"));
    assert.equal(
      rotateRootLockBytes({
        bin: target.bin,
        currentVersion: TARGET_VERSION,
        engines: target.engines,
        lockfileBytes: rotated,
        sourceIntegrity: source.dist.integrity,
        sourcePeers: source.peerDependencies,
        sourceVersion: FROM_VERSION,
        targetIntegrity: target.dist.integrity,
        targetPeers: target.peerDependencies,
        targetVersion: TARGET_VERSION,
      }),
      rotated,
    );
  },
);

test("root package rotation preserves unrelated current-base scripts byte-for-byte", () => {
  const currentBytes = readFileSync(join(REPOSITORY_ROOT, "package.json"));
  const current = JSON.parse(currentBytes.toString("utf8"));
  const targetVersion = nextPatchVersion(current.devDependencies.vercel);
  const rotated = JSON.parse(
    rotateRootPackageBytes(currentBytes, targetVersion).toString("utf8"),
  );
  assert.equal(rotated.devDependencies.vercel, targetVersion);
  assert.equal(
    rotated.scripts["dependabot:process:test"],
    current.scripts["dependabot:process:test"],
  );
  rotated.devDependencies.vercel = current.devDependencies.vercel;
  assert.deepEqual(rotated, current);
});

test("Next override rotation is forward-only for the authorized source and target", () => {
  const source = {
    name: "fixture",
    packageManager: "pnpm@10.34.4",
    pnpm: {
      overrides: {
        "hono@<4.12.34": "4.12.34",
        next: NEXT_FROM_SPECIFIER,
      },
    },
    scripts: { test: "node --test" },
  };
  const sourceBytes = Buffer.from(`${JSON.stringify(source, null, 2)}\n`);
  const operation = {
    fromSpecifier: NEXT_FROM_SPECIFIER,
    targetSpecifier: NEXT_TARGET_SPECIFIER,
  };
  const targetBytes = rotateNextOverridePackageBytes(sourceBytes, operation);
  const target = JSON.parse(targetBytes.toString("utf8"));
  assert.equal(target.pnpm.overrides.next, NEXT_TARGET_SPECIFIER);
  target.pnpm.overrides.next = NEXT_FROM_SPECIFIER;
  assert.deepEqual(target, source);
  assert.deepEqual(
    rotateNextOverridePackageBytes(
      rotateNextOverridePackageBytes(sourceBytes, operation),
      operation,
    ),
    targetBytes,
  );

  for (const next of [undefined, "^16.3.0", "16.2.12"]) {
    assert.throws(
      () =>
        rotateNextOverridePackageBytes(
          Buffer.from(
            `${JSON.stringify(
              {
                ...source,
                pnpm: { overrides: { ...source.pnpm.overrides, next } },
              },
              null,
              2,
            )}\n`,
          ),
          operation,
        ),
      /root Next override is neither the packet source nor target specifier/u,
    );
  }
});

test("Next workspace rotation changes one exact catalog entry and rejects ambiguity", () => {
  const operation = {
    fromSpecifier: NEXT_FROM_SPECIFIER,
    targetSpecifier: NEXT_TARGET_SPECIFIER,
  };
  const source = Buffer.from(`packages:
  - apps/*
catalog:
  next: ${NEXT_FROM_SPECIFIER}
  react: ^19.2.4
catalogs:
  legacy:
    next: ${NEXT_FROM_SPECIFIER}
`);
  const target = rotateNextCatalogWorkspaceBytes(source, operation);
  assert.equal(
    target.toString("utf8"),
    source
      .toString("utf8")
      .replace(
        `catalog:\n  next: ${NEXT_FROM_SPECIFIER}\n`,
        `catalog:\n  next: ${NEXT_TARGET_SPECIFIER}\n`,
      ),
  );
  assert.match(target.toString("utf8"), /legacy:\n {4}next: \^16\.2\.12/u);
  assert.deepEqual(rotateNextCatalogWorkspaceBytes(target, operation), target);

  for (const catalogBody of [
    `  next: ${NEXT_FROM_SPECIFIER}\n  next: ${NEXT_FROM_SPECIFIER}\n`,
    `  next: ${NEXT_FROM_SPECIFIER}\n  next: ${NEXT_TARGET_SPECIFIER}\n`,
    "  next: ^16.3.0\n",
  ]) {
    assert.throws(
      () =>
        rotateNextCatalogWorkspaceBytes(
          Buffer.from(`packages:\n  - apps/*\ncatalog:\n${catalogBody}`),
          operation,
        ),
      /workspace Next catalog specifier is missing or ambiguous/u,
    );
  }
});

function gitShow(commit, path) {
  return execFileSync("git", ["show", `${commit}:${path}`], {
    cwd: REPOSITORY_ROOT,
    encoding: null,
    maxBuffer: 4 * 1024 * 1024,
  });
}

function protectedRuntimeFixture({
  mutateBytesByPath = () => {},
  packetTransform = (packet) => packet,
  useHistoricalPr753Objects = false,
} = {}) {
  const root = mkdtempSync(join(tmpdir(), "protected-runtime-pr753-"));
  const evidenceRoot = join(root, "evidence");
  mkdirSync(evidenceRoot, { mode: 0o700 });
  const bytesByPath = new Map();
  for (const path of PROTECTED_RUNTIME_SYNC_INPUT_PATHS) {
    const bytes =
      !useHistoricalPr753Objects ||
      path === "scripts/vercel-cli-runtime/contract.json"
        ? readFileSync(join(REPOSITORY_ROOT, path))
        : gitShow(PR_753_REPAIRED_HEAD, path);
    bytesByPath.set(path, bytes);
  }
  const refreshedRootPackage = JSON.parse(
    bytesByPath.get("package.json").toString("utf8"),
  );
  const currentRootPackage = JSON.parse(
    readFileSync(join(REPOSITORY_ROOT, "package.json"), "utf8"),
  );
  refreshedRootPackage.scripts["dependabot:process:test"] =
    currentRootPackage.scripts["dependabot:process:test"];
  bytesByPath.set(
    "package.json",
    Buffer.from(`${JSON.stringify(refreshedRootPackage, null, 2)}\n`),
  );
  mutateBytesByPath(bytesByPath);
  const expectedBlobs = PROTECTED_RUNTIME_SYNC_INPUT_PATHS.map((path) => ({
    mode: "100644",
    path,
    sha: gitBlobSha(bytesByPath.get(path)),
    type: "blob",
  }));
  const packet = packetTransform({
    attemptLimit: 2,
    attemptNumber: 2,
    automatic: true,
    baseRef: "main",
    baseSha: "b".repeat(40),
    changedPaths: ["package.json", "pnpm-lock.yaml"],
    dependencyGroup: "tooling",
    dependencyNames: ["knip", "vercel", "@next/eslint-plugin-next"],
    escalation: "manual-review",
    expectedBlobs,
    failures: [],
    feedbackThreads: [],
    findings: [],
    forbiddenPaths: [
      ".github/**",
      "**/auth/**",
      "**/deploy/**",
      "**/deployment/**",
      "**/policy/**",
      "**/security/**",
      "docs/vercel-deployments.md",
      "scripts/vercel-main-*.mjs",
    ],
    headRef: "dependabot/npm_and_yarn/tooling-123",
    headSha: useHistoricalPr753Objects ? PR_753_REPAIRED_HEAD : "a".repeat(40),
    limits: {
      maxAddedLines: 600,
      maxBytes: 64 * 1024,
      maxChanges: 160,
      maxDeletedLines: 600,
      maxFiles: 5,
    },
    mode: "prepare",
    operation: {
      dependency: "vercel",
      fromVersion: FROM_VERSION,
      inputPaths: PROTECTED_RUNTIME_SYNC_INPUT_PATHS,
      kind: "vercel-cli-runtime-sync",
      pnpmVersion: "10.34.4",
      requiredPaths: PROTECTED_RUNTIME_SYNC_REQUIRED_PATHS,
      schema: "dependabot-protected-runtime-sync:v1",
      sourceSeedHeadSha: useHistoricalPr753Objects
        ? PR_753_IMMUTABLE_SOURCE
        : "e".repeat(40),
      targetVersion: TARGET_VERSION,
      updateType: "minor",
    },
    packageEcosystem: "npm",
    permittedPaths: PROTECTED_RUNTIME_SYNC_REQUIRED_PATHS,
    preparable: true,
    pullRequestNumber: 753,
    repository: "mento-protocol/frontend-monorepo",
    requiredGateIds: TYPED_NPM_REQUIRED_GATE_IDS,
    requireExactHead: true,
    requireHumanApproval: false,
    riskTier: "human-merge-npm",
    schema: "dependabot-repair-packet:v3",
    updateType: "minor",
    validationCommands: TYPED_NPM_VALIDATION_COMMANDS,
    workflowRunAttempt: 1,
    workflowRunId: 753,
    workflowSha: "c".repeat(40),
  });
  const packetText = canonicalJson(packet);
  const packetDigest = sha256(packetText);
  const files = [];
  for (const [index, expected] of expectedBlobs.entries()) {
    const name = `blob-${String(index).padStart(3, "0")}.txt`;
    const bytes = bytesByPath.get(expected.path);
    const filePath = join(evidenceRoot, name);
    writeFileSync(filePath, bytes, { mode: 0o400 });
    chmodSync(filePath, 0o400);
    files.push({
      bytes: bytes.byteLength,
      digest: sha256(bytes),
      kind: "git-blob",
      mediaType: "text/plain",
      name,
      source: {
        gitBlobSha: expected.sha,
        mode: expected.mode,
        path: expected.path,
        treeSha: "d".repeat(40),
      },
    });
  }
  const manifest = {
    baseSha: packet.baseSha,
    evidenceRoot,
    files,
    headSha: packet.headSha,
    packetDigest,
    processorCheckId: 753,
    pullRequestNumber: packet.pullRequestNumber,
    repository: packet.repository,
    schema: "dependabot-repair-evidence:v1",
    workflowRunAttempt: packet.workflowRunAttempt,
    workflowRunId: packet.workflowRunId,
    workflowSha: packet.workflowSha,
  };
  const manifestPath = join(evidenceRoot, "manifest.json");
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    mode: 0o400,
  });
  chmodSync(manifestPath, 0o400);
  return {
    bytesByPath,
    cleanup: () => rmSync(root, { force: true, recursive: true }),
    evidenceManifestPath: manifestPath,
    packet,
    packetBase64: Buffer.from(packetText).toString("base64"),
  };
}

function pr753Fixture() {
  return protectedRuntimeFixture({ useHistoricalPr753Objects: true });
}

function nextCatalogPacket(
  packet,
  {
    fromVersion = NEXT_FROM_VERSION,
    targetVersion = NEXT_TARGET_VERSION,
    updateType = "minor",
  } = {},
) {
  return {
    ...packet,
    changedPaths: ["pnpm-lock.yaml", "pnpm-workspace.yaml"],
    dependencyGroup: "frontend-core",
    dependencyNames: ["next"],
    limits: {
      ...packet.limits,
      maxChanges: 1_200,
      maxFiles: NEXT_CATALOG_SYNC_REQUIRED_PATHS.length,
    },
    operation: {
      dependency: "next",
      fromSpecifier: `^${fromVersion}`,
      fromVersion,
      inputPaths: PROTECTED_RUNTIME_SYNC_INPUT_PATHS,
      kind: "next-catalog-override-sync",
      pnpmVersion: "10.34.4",
      resolutionMode: "lowest-direct",
      requiredPaths: NEXT_CATALOG_SYNC_REQUIRED_PATHS,
      schema: "dependabot-protected-runtime-sync:v1",
      sourceSeedHeadSha: packet.operation.sourceSeedHeadSha,
      targetSpecifier: `^${targetVersion}`,
      targetVersion,
      updateType,
    },
    permittedPaths: NEXT_CATALOG_SYNC_REQUIRED_PATHS,
    riskTier: "human-merge-npm",
    updateType,
  };
}

function nextCatalogFixture() {
  return protectedRuntimeFixture({ packetTransform: nextCatalogPacket });
}

test("protected runtime inputs cover every current workspace manifest", () => {
  const workspaceManifests = ["apps", "packages"]
    .flatMap((parent) =>
      readdirSync(join(REPOSITORY_ROOT, parent), { withFileTypes: true })
        .filter(
          (entry) =>
            entry.isDirectory() &&
            existsSync(
              join(REPOSITORY_ROOT, parent, entry.name, "package.json"),
            ),
        )
        .map((entry) => `${parent}/${entry.name}/package.json`),
    )
    .sort();
  assert.deepEqual(
    PROTECTED_RUNTIME_SYNC_INPUT_PATHS.filter(
      (path) => path.startsWith("apps/") || path.startsWith("packages/"),
    ).sort(),
    workspaceManifests,
  );
});

function repairPlanForPatch(packet, patch) {
  const packetText = canonicalJson(packet);
  return {
    context: {
      packet,
      packetDigest: sha256(packetText),
      processorCheckId: 753,
    },
    plan: {
      attempt: packet.attemptNumber,
      baseSha: packet.baseSha,
      edits: [
        {
          expectedBlobSha: packet.expectedBlobs.find(
            ({ path }) => path === "package.json",
          ).sha,
          patch,
          path: "package.json",
        },
      ],
      packetDigest: sha256(packetText),
      parentHeadSha: packet.headSha,
      processorCheckId: 753,
      pullRequestNumber: packet.pullRequestNumber,
      repository: packet.repository,
      schema: "dependabot-repair-plan:v1",
      summary: "Exercise the typed patch-size boundary.",
    },
  };
}

function nextRegistryMetadataFixture() {
  return {
    bin: { next: "dist/bin/next" },
    dependencies: {
      "@next/env": NEXT_TARGET_VERSION,
      "@swc/helpers": "0.5.23",
      "baseline-browser-mapping": "^2.9.19",
      "caniuse-lite": "^1.0.30001579",
      postcss: "8.5.23",
      "styled-jsx": "5.1.6",
    },
    dist: {
      integrity: NEXT_TARGET_INTEGRITY,
      tarball: `https://registry.npmjs.org/next/-/next-${NEXT_TARGET_VERSION}.tgz`,
    },
    engines: { node: ">=20.9.0" },
    name: "next",
    optionalDependencies: {
      ...Object.fromEntries(
        NEXT_SWC_NAMES.map((name) => [name, NEXT_TARGET_VERSION]),
      ),
      sharp: "^0.35.3",
    },
    peerDependencies: {
      react: "^19.0.0",
      sass: "^1.3.0",
    },
    peerDependenciesMeta: {
      sass: { optional: true },
    },
    version: NEXT_TARGET_VERSION,
  };
}

function nextSurgicalLockFixture({
  oracle = false,
  unrelatedPeer = "source-peer@1.0.0",
} = {}) {
  const version = oracle ? NEXT_TARGET_VERSION : NEXT_FROM_VERSION;
  const specifier = oracle ? NEXT_TARGET_SPECIFIER : NEXT_FROM_SPECIFIER;
  const helperVersion = oracle ? "0.5.23" : "0.5.15";
  const baselineVersion = oracle ? "2.11.14" : "2.10.42";
  const caniuseVersion = oracle ? "1.0.30001809" : "1.0.30001802";
  const integrity = oracle ? NEXT_TARGET_INTEGRITY : SOURCE_INTEGRITY;
  const registryPackage = (
    name,
    packageVersion,
    packageIntegrity = SOURCE_INTEGRITY,
  ) =>
    `  '${name}@${packageVersion}':\n    resolution: {integrity: ${packageIntegrity}}\n\n`;
  const emptySnapshot = (name, packageVersion, body = "") =>
    body === ""
      ? `  '${name}@${packageVersion}': {}\n\n`
      : `  '${name}@${packageVersion}':\n${body}\n`;
  return Buffer.from(`lockfileVersion: '9.0'

overrides:
  next: ${specifier}

importers:

  apps/example:
    dependencies:
      consumer:
        specifier: 1.0.0
        version: 1.0.0(next@${version}(react@19.2.8))
      next:
        specifier: ${specifier}
        version: ${version}(react@19.2.8)

packages:

${registryPackage("@next/env", version)}  '@next/eslint-plugin-next@${NEXT_FROM_VERSION}':
    resolution: {integrity: ${SOURCE_INTEGRITY}}

${NEXT_SWC_NAMES.map((name) => registryPackage(name, version)).join("")}  '@swc/helpers@${helperVersion}':
    resolution: {integrity: ${SOURCE_INTEGRITY}}

  baseline-browser-mapping@${baselineVersion}:
    resolution: {integrity: ${SOURCE_INTEGRITY}}

  caniuse-lite@${caniuseVersion}:
    resolution: {integrity: ${SOURCE_INTEGRITY}}

  consumer@1.0.0:
    resolution: {integrity: ${SOURCE_INTEGRITY}}
    peerDependencies:
      next: ${specifier}

  next@${version}:
    resolution: {integrity: ${integrity}}
    engines: {node: '>=20.9.0'}
    hasBin: true
    peerDependencies:
      react: ^19.0.0
      sass: ^1.3.0
    peerDependenciesMeta:
      sass:
        optional: true

  noise@1.0.0:
    resolution: {integrity: ${SOURCE_INTEGRITY}}
    note: ${NEXT_FROM_VERSION}

  postcss@8.5.23:
    resolution: {integrity: ${SOURCE_INTEGRITY}}

  styled-jsx@5.1.6:
    resolution: {integrity: ${SOURCE_INTEGRITY}}

snapshots:

${emptySnapshot("@next/env", version)}  '@next/eslint-plugin-next@${NEXT_FROM_VERSION}': {}

${NEXT_SWC_NAMES.map((name) => emptySnapshot(name, version, "    optional: true\n")).join("")}  '@swc/helpers@${helperVersion}': {}

  baseline-browser-mapping@${baselineVersion}: {}

  caniuse-lite@${caniuseVersion}: {}

  consumer@1.0.0(next@${version}(react@19.2.8)):
    dependencies:
      next: ${version}(react@19.2.8)

  next@${version}(react@19.2.8):
    dependencies:
      '@next/env': ${version}
      '@swc/helpers': ${helperVersion}
      baseline-browser-mapping: ${baselineVersion}
      caniuse-lite: ${caniuseVersion}
      postcss: 8.5.23
      react: 19.2.8
      styled-jsx: 5.1.6
    optionalDependencies:
${NEXT_SWC_NAMES.map((name) => `      '${name}': ${version}\n`).join("")}      sharp: 0.35.3
    transitivePeerDependencies:
      - fixture-transitive-peer

  noise@1.0.0(${unrelatedPeer}): {}

  postcss@8.5.23: {}

  styled-jsx@5.1.6: {}
`);
}

test("Next root lock rotation ignores unrelated oracle peer contexts", () => {
  const operation = {
    fromSpecifier: NEXT_FROM_SPECIFIER,
    fromVersion: NEXT_FROM_VERSION,
    targetSpecifier: NEXT_TARGET_SPECIFIER,
    targetVersion: NEXT_TARGET_VERSION,
  };
  const source = nextSurgicalLockFixture();
  const first = rotateNextRootLockBytes({
    lockfileBytes: source,
    operation,
    oracleLockfileBytes: nextSurgicalLockFixture({
      oracle: true,
      unrelatedPeer: "oracle-peer@1.0.0",
    }),
    targetMetadata: nextRegistryMetadataFixture(),
  });
  const second = rotateNextRootLockBytes({
    lockfileBytes: source,
    operation,
    oracleLockfileBytes: nextSurgicalLockFixture({
      oracle: true,
      unrelatedPeer: "oracle-peer@9.0.0",
    }),
    targetMetadata: nextRegistryMetadataFixture(),
  });
  assert.deepEqual(first, second);
  const text = first.toString("utf8");
  assert.match(text, /'@next\/eslint-plugin-next@16\.2\.12':/u);
  assert.match(text, /note: 16\.2\.12/u);
  assert.match(text, /baseline-browser-mapping: 2\.10\.42/u);
  assert.match(text, /caniuse-lite: 1\.0\.30001802/u);
  assert.match(text, /'@swc\/helpers@0\.5\.15':/u);
  assert.match(text, /'@swc\/helpers@0\.5\.23':/u);
  assert.match(text, /source-peer@1\.0\.0/u);
  assert.doesNotMatch(text, /oracle-peer@/u);
  assert.doesNotMatch(text, /(^|[^A-Za-z0-9_@/-])next@16\.2\.12(?=\()/mu);
});

test("Next root lock rotation requires the oracle helper registry integrity", () => {
  const operation = {
    fromSpecifier: NEXT_FROM_SPECIFIER,
    fromVersion: NEXT_FROM_VERSION,
    targetSpecifier: NEXT_TARGET_SPECIFIER,
    targetVersion: NEXT_TARGET_VERSION,
  };
  const oracle = nextSurgicalLockFixture({ oracle: true });
  const invalidOracle = Buffer.from(
    oracle
      .toString("utf8")
      .replace(
        `  '@swc/helpers@0.5.23':\n    resolution: {integrity: ${SOURCE_INTEGRITY}}\n`,
        "  '@swc/helpers@0.5.23': {}\n",
      ),
  );
  assert.notDeepEqual(invalidOracle, oracle);
  assert.throws(
    () =>
      rotateNextRootLockBytes({
        lockfileBytes: nextSurgicalLockFixture(),
        operation,
        oracleLockfileBytes: invalidOracle,
        targetMetadata: nextRegistryMetadataFixture(),
      }),
    /oracle target @swc\/helpers package does not bind one registry integrity/u,
  );
});

test("Next root lock rotation binds target package metadata to the registry", () => {
  const operation = {
    fromSpecifier: NEXT_FROM_SPECIFIER,
    fromVersion: NEXT_FROM_VERSION,
    targetSpecifier: NEXT_TARGET_SPECIFIER,
    targetVersion: NEXT_TARGET_VERSION,
  };
  const oracle = nextSurgicalLockFixture({ oracle: true }).toString("utf8");
  for (const [label, invalidOracle, expectedError] of [
    [
      "forged React peer range",
      oracle.replace("      react: ^19.0.0\n", "      react: '>=99.0.0'\n"),
      /oracle target Next peer dependencies differ from registry metadata/u,
    ],
    [
      "changed engine",
      oracle.replace(
        "    engines: {node: '>=20.9.0'}\n",
        "    engines: {node: '>=99.0.0'}\n",
      ),
      /oracle target Next engines differ from registry metadata/u,
    ],
    [
      "missing bin",
      oracle.replace("    hasBin: true\n", "    hasBin: false\n"),
      /oracle target Next bin shape differs from registry metadata/u,
    ],
    [
      "changed optional-peer metadata",
      oracle.replace("        optional: true\n", "        optional: false\n"),
      /oracle target Next peer metadata is not an exact optional-peer map/u,
    ],
  ]) {
    assert.notEqual(invalidOracle, oracle, label);
    assert.throws(
      () =>
        rotateNextRootLockBytes({
          lockfileBytes: nextSurgicalLockFixture(),
          operation,
          oracleLockfileBytes: Buffer.from(invalidOracle),
          targetMetadata: nextRegistryMetadataFixture(),
        }),
      expectedError,
      label,
    );
  }
});

test("Next root lock rotation binds retained snapshot peer shape to the oracle", () => {
  const operation = {
    fromSpecifier: NEXT_FROM_SPECIFIER,
    fromVersion: NEXT_FROM_VERSION,
    targetSpecifier: NEXT_TARGET_SPECIFIER,
    targetVersion: NEXT_TARGET_VERSION,
  };
  const oracle = nextSurgicalLockFixture({ oracle: true }).toString("utf8");
  for (const [label, invalidOracle, expectedError] of [
    [
      "changed peer reference",
      oracle.replace("      react: 19.2.8\n", "      react: 19.2.9\n"),
      /Next snapshot peer shape differs from the target oracle: react/u,
    ],
    [
      "changed peer context",
      oracle.replace(
        `  next@${NEXT_TARGET_VERSION}(react@19.2.8):\n`,
        `  next@${NEXT_TARGET_VERSION}(react@19.2.9):\n`,
      ),
      /Next snapshot peer context differs from the target oracle/u,
    ],
    [
      "changed transitive peer",
      oracle.replace(
        "      - fixture-transitive-peer\n",
        "      - forged-transitive-peer\n",
      ),
      /Next snapshot peer context differs from the target oracle/u,
    ],
  ]) {
    assert.notEqual(invalidOracle, oracle, label);
    assert.throws(
      () =>
        rotateNextRootLockBytes({
          lockfileBytes: nextSurgicalLockFixture(),
          operation,
          oracleLockfileBytes: Buffer.from(invalidOracle),
          targetMetadata: nextRegistryMetadataFixture(),
        }),
      expectedError,
      label,
    );
  }
});

test("Next root lock rotation requires copied oracle closure in the source", () => {
  const operation = {
    fromSpecifier: NEXT_FROM_SPECIFIER,
    fromVersion: NEXT_FROM_VERSION,
    targetSpecifier: NEXT_TARGET_SPECIFIER,
    targetVersion: NEXT_TARGET_VERSION,
  };
  const oracle = nextSurgicalLockFixture({ oracle: true });
  const invalidOracle = Buffer.from(
    oracle
      .toString("utf8")
      .replace(
        "  '@swc/helpers@0.5.23': {}\n",
        "  '@swc/helpers@0.5.23':\n    dependencies:\n      missing-helper-dep: 1.0.0\n",
      ),
  );
  assert.notDeepEqual(invalidOracle, oracle);
  assert.throws(
    () =>
      rotateNextRootLockBytes({
        lockfileBytes: nextSurgicalLockFixture(),
        operation,
        oracleLockfileBytes: invalidOracle,
        targetMetadata: nextRegistryMetadataFixture(),
      }),
    /source closure package missing-helper-dep@1\.0\.0 is missing or ambiguous/u,
  );
});

test("Next catalog generation reaches the exact pnpm oracle after input validation", () => {
  const fixture = protectedRuntimeFixture({
    packetTransform: nextCatalogPacket,
  });
  const executableRoot = mkdtempSync(join(tmpdir(), "next-catalog-fake-pnpm-"));
  // eslint-disable-next-line turbo/no-undeclared-env-vars -- This test temporarily substitutes the PATH pnpm executable and restores it in finally.
  const previousPath = process.env.PATH;
  try {
    const pnpmPath = join(executableRoot, "pnpm");
    writeFileSync(
      pnpmPath,
      '#!/bin/sh\nif [ "$1" = "--version" ]; then\n  echo 10.34.4\n  exit 0\nfi\necho "offline test sentinel" >&2\nexit 23\n',
      { mode: 0o700 },
    );
    // eslint-disable-next-line turbo/no-undeclared-env-vars -- This test temporarily substitutes the PATH pnpm executable and restores it in finally.
    process.env.PATH = `${executableRoot}:${previousPath ?? ""}`;
    assert.throws(
      () =>
        generateProtectedRuntimeRepairPlan({
          evidenceManifestPath: fixture.evidenceManifestPath,
          packetBase64: fixture.packetBase64,
          processorCheckId: 753,
        }),
      /pnpm lock regeneration failed.*offline test sentinel/su,
    );
  } finally {
    // eslint-disable-next-line turbo/no-undeclared-env-vars -- Restore the process PATH after the isolated executable test.
    process.env.PATH = previousPath;
    fixture.cleanup();
    rmSync(executableRoot, { force: true, recursive: true });
  }
});

test("Next catalog generation rejects unsafe sealed inputs before the pnpm oracle", () => {
  const fixture = protectedRuntimeFixture({
    mutateBytesByPath(bytesByPath) {
      const rootPackage = JSON.parse(
        bytesByPath.get("package.json").toString("utf8"),
      );
      rootPackage.pnpm.patchedDependencies = {
        [`next@${NEXT_FROM_VERSION}`]: "patches/next.patch",
      };
      bytesByPath.set(
        "package.json",
        Buffer.from(`${JSON.stringify(rootPackage, null, 2)}\n`),
      );
    },
    packetTransform: nextCatalogPacket,
  });
  const executableRoot = mkdtempSync(join(tmpdir(), "next-catalog-fake-pnpm-"));
  const sentinelPath = join(executableRoot, "oracle-called");
  // eslint-disable-next-line turbo/no-undeclared-env-vars -- This test temporarily substitutes the PATH pnpm executable and restores it in finally.
  const previousPath = process.env.PATH;
  try {
    const pnpmPath = join(executableRoot, "pnpm");
    writeFileSync(
      pnpmPath,
      `#!/bin/sh\nif [ "$1" = "--version" ]; then\n  echo 10.34.4\n  exit 0\nfi\nprintf called > "${sentinelPath}"\nexit 23\n`,
      { mode: 0o700 },
    );
    // eslint-disable-next-line turbo/no-undeclared-env-vars -- This test temporarily substitutes the PATH pnpm executable and restores it in finally.
    process.env.PATH = `${executableRoot}:${previousPath ?? ""}`;
    assert.throws(
      () =>
        generateProtectedRuntimeRepairPlan({
          evidenceManifestPath: fixture.evidenceManifestPath,
          packetBase64: fixture.packetBase64,
          processorCheckId: 753,
        }),
      /root package manifest admits patchedDependencies/u,
    );
    assert.equal(existsSync(sentinelPath), false);
  } finally {
    // eslint-disable-next-line turbo/no-undeclared-env-vars -- Restore the process PATH after the isolated executable test.
    process.env.PATH = previousPath;
    fixture.cleanup();
    rmSync(executableRoot, { force: true, recursive: true });
  }
});

test("only Next root installs select the packet-bound lowest-direct mode", () => {
  const store = "/tmp/test-pnpm-store";
  const nextRoot = pnpmInstallArguments({
    resolutionMode: "lowest-direct",
    store,
  });
  const nextFrozen = pnpmInstallArguments({
    frozenLockfile: true,
    resolutionMode: "lowest-direct",
    store,
  });
  const standalone = pnpmInstallArguments({
    ignoreWorkspace: true,
    store,
  });
  assert.ok(nextRoot.includes("--config.resolution-mode=lowest-direct"));
  assert.ok(nextFrozen.includes("--config.resolution-mode=lowest-direct"));
  assert.ok(nextFrozen.includes("--frozen-lockfile"));
  assert.ok(
    !standalone.some((arg) => arg.startsWith("--config.resolution-mode=")),
  );
  assert.ok(standalone.includes("--ignore-workspace"));
});

test("the terminal Next candidate install executes scripts without caches or credentials", () => {
  const store = "/tmp/secretless-next-candidate-store";
  const args = nextCandidateInstallArguments({ store });
  assert.deepEqual(args, [
    "--filter",
    "app.mento.org",
    "install",
    "--prod",
    "--frozen-lockfile",
    "--ignore-pnpmfile",
    "--package-import-method",
    "copy",
    "--registry=https://registry.npmjs.org/",
    "--store-dir",
    store,
  ]);
  assert.equal(args.includes("--ignore-scripts"), false);
  assert.equal(args.includes("--lockfile-only"), false);
  assert.throws(
    () => nextCandidateInstallArguments({ store: "" }),
    /Next candidate store path is invalid/u,
  );
});

test("standalone runtime lock rotation changes only its exact Next override", () => {
  const operation = {
    fromSpecifier: NEXT_FROM_SPECIFIER,
    targetSpecifier: NEXT_TARGET_SPECIFIER,
    targetVersion: NEXT_TARGET_VERSION,
  };
  const source = Buffer.from(
    `lockfileVersion: '9.0'\n\noverrides:\n  next: ${operation.fromSpecifier}\n\npackages:\n\n  unrelated@1.0.0:\n    resolution: {integrity: ${SOURCE_INTEGRITY}}\n\nsnapshots:\n\n  unrelated@1.0.0: {}\n`,
  );
  const target = rotateNextStandaloneRuntimeLockBytes({
    lockfileBytes: source,
    operation,
  });
  assert.equal(
    target.toString("utf8"),
    source
      .toString("utf8")
      .replace(
        `  next: ${NEXT_FROM_SPECIFIER}`,
        `  next: ${NEXT_TARGET_SPECIFIER}`,
      ),
  );
  assert.deepEqual(
    rotateNextStandaloneRuntimeLockBytes({
      lockfileBytes: target,
      operation,
    }),
    target,
  );
  assert.doesNotThrow(() => inspectGeneratedNextRuntimeLock(target, operation));

  for (const quote of ["'", '"']) {
    const resolvedNext = Buffer.from(
      target
        .toString("utf8")
        .replace(
          "packages:\n",
          `packages:\n\n  ${quote}next@${NEXT_TARGET_VERSION}${quote}:\n`,
        ),
    );
    assert.throws(
      () =>
        rotateNextStandaloneRuntimeLockBytes({
          lockfileBytes: resolvedNext,
          operation,
        }),
      /standalone runtime lockfile unexpectedly resolves Next|unsupported double-quoted key/u,
    );
  }
});

test("only a Next typed plan admits a contextual patch above 8 KiB", () => {
  const fixture = protectedRuntimeFixture();
  const patchRoot = mkdtempSync(join(tmpdir(), "next-catalog-patch-limit-"));
  try {
    const oldBytes = Buffer.from(`value=${"a".repeat(6_000)}\n`);
    const newBytes = Buffer.from(`value=${"b".repeat(6_000)}\n`);
    assert.throws(
      () =>
        createUnifiedPatch({
          newBytes,
          oldBytes,
          path: "package.json",
          temporaryRoot: join(patchRoot, "default"),
        }),
      /contextual diff failed|contextual U1 patch is invalid or oversized/u,
    );
    const patch = createUnifiedPatch({
      maxBytes: 48 * 1024,
      newBytes,
      oldBytes,
      path: "package.json",
      temporaryRoot: join(patchRoot, "typed"),
    });
    assert.ok(Buffer.byteLength(patch) > 8_192);
    assert.ok(Buffer.byteLength(patch) <= 48 * 1024);

    const protectedRuntimePacket = JSON.parse(
      Buffer.from(fixture.packetBase64, "base64").toString("utf8"),
    );
    const generic = repairPlanForPatch(protectedRuntimePacket, patch);
    assert.throws(
      () => validateRepairPlan(generic.plan, generic.context),
      /edits\[0\]\.patch/u,
    );

    const catalog = repairPlanForPatch(
      nextCatalogPacket(protectedRuntimePacket),
      patch,
    );
    assert.deepEqual(
      validateRepairPlan(catalog.plan, catalog.context),
      catalog.plan,
    );
  } finally {
    fixture.cleanup();
    rmSync(patchRoot, { force: true, recursive: true });
  }
});

test("Next typed packets reject backward version transitions before evidence access", () => {
  const fixture = protectedRuntimeFixture();
  try {
    const protectedRuntimePacket = JSON.parse(
      Buffer.from(fixture.packetBase64, "base64").toString("utf8"),
    );
    const packet = nextCatalogPacket(protectedRuntimePacket, {
      fromVersion: NEXT_TARGET_VERSION,
      targetVersion: NEXT_FROM_VERSION,
    });
    assert.throws(
      () =>
        generateProtectedRuntimeRepairPlan({
          evidenceManifestPath: join(
            dirname(fixture.evidenceManifestPath),
            "must-not-be-read.json",
          ),
          packetBase64: Buffer.from(canonicalJson(packet)).toString("base64"),
          processorCheckId: 753,
        }),
      /Next catalog sync version transition is invalid/u,
    );
  } finally {
    fixture.cleanup();
  }
});

test(
  "current repository Next catalog sync regenerates and applies all six bound files",
  {
    skip:
      // eslint-disable-next-line turbo/no-undeclared-env-vars -- This explicit opt-in keeps registry-backed pnpm regeneration out of default unit runs.
      process.env.NEXT_CATALOG_SYNC_INTEGRATION !== "1",
  },
  () => {
    const fixture = nextCatalogFixture();
    const outputRoot = mkdtempSync(join(tmpdir(), "next-catalog-output-"));
    try {
      const plan = generateProtectedRuntimeRepairPlan({
        evidenceManifestPath: fixture.evidenceManifestPath,
        packetBase64: fixture.packetBase64,
        processorCheckId: 753,
      });
      assert.deepEqual(
        plan.edits.map(({ path }) => path),
        NEXT_CATALOG_SYNC_REQUIRED_PATHS,
      );
      for (const edit of plan.edits) {
        const destination = join(outputRoot, edit.path);
        mkdirSync(dirname(destination), { recursive: true });
        writeFileSync(
          destination,
          readFileSync(join(REPOSITORY_ROOT, edit.path)),
        );
        const applied = spawnSync("/usr/bin/patch", ["-p1"], {
          cwd: outputRoot,
          encoding: "utf8",
          input: edit.patch,
          stdio: ["pipe", "pipe", "pipe"],
        });
        assert.equal(applied.status, 0, applied.stderr);
      }

      const rootPackage = JSON.parse(
        readFileSync(join(outputRoot, "package.json"), "utf8"),
      );
      const workspaceText = readFileSync(
        join(outputRoot, "pnpm-workspace.yaml"),
        "utf8",
      );
      const rootLockText = readFileSync(
        join(outputRoot, "pnpm-lock.yaml"),
        "utf8",
      );
      const runtimeRoot = join(outputRoot, "scripts", "vercel-cli-runtime");
      const runtimePackage = JSON.parse(
        readFileSync(join(runtimeRoot, "package.json"), "utf8"),
      );
      const runtimeLockText = readFileSync(
        join(runtimeRoot, "pnpm-lock.yaml"),
        "utf8",
      );
      assert.equal(rootPackage.pnpm.overrides.next, NEXT_TARGET_SPECIFIER);
      assert.deepEqual(
        [...workspaceText.matchAll(/^ {2}next: (.+)$/gmu)].map(
          (match) => match[1],
        ),
        [NEXT_TARGET_SPECIFIER],
      );
      assert.match(
        rootLockText,
        new RegExp(
          `^  next@${NEXT_TARGET_VERSION.replaceAll(".", "\\.")}:$`,
          "mu",
        ),
      );
      assert.doesNotMatch(
        rootLockText,
        new RegExp(
          `^  next@${NEXT_FROM_VERSION.replaceAll(".", "\\.")}:$`,
          "mu",
        ),
      );
      assert.equal(runtimePackage.pnpm.overrides.next, NEXT_TARGET_SPECIFIER);
      assert.match(
        runtimeLockText,
        new RegExp(
          `^  next: ${NEXT_TARGET_SPECIFIER.replace("^", "\\^")}$`,
          "mu",
        ),
      );

      const sourceContract = JSON.parse(
        readFileSync(
          join(REPOSITORY_ROOT, "scripts/vercel-cli-runtime/contract.json"),
          "utf8",
        ),
      );
      const targetContract = JSON.parse(
        readFileSync(join(runtimeRoot, "contract.json"), "utf8"),
      );
      assert.notEqual(
        targetContract.overridesSha256,
        sourceContract.overridesSha256,
      );
      assert.deepEqual(
        assertVercelCliRuntimeContract({
          contractPath: join(runtimeRoot, "contract.json"),
          lockfilePath: join(runtimeRoot, "pnpm-lock.yaml"),
          packageJsonPath: join(runtimeRoot, "package.json"),
          rootPackageJsonPath: join(outputRoot, "package.json"),
          runtimeRootPath: outputRoot,
        }),
        {
          lockfileSha256: targetContract.lockfileSha256,
          vercel: sourceContract.vercelVersion,
        },
      );

      const expectedByPath = new Map(
        fixture.packet.expectedBlobs.map((entry) => [entry.path, entry]),
      );
      const blobs = new Map(
        [...fixture.bytesByPath].map(([path, bytes]) => [
          path,
          {
            bytes,
            expectedBlobSha: expectedByPath.get(path).sha,
            mode: expectedByPath.get(path).mode,
          },
        ]),
      );
      const generated = new Map(
        NEXT_CATALOG_SYNC_REQUIRED_PATHS.map((path) => [
          path,
          readFileSync(join(outputRoot, path)),
        ]),
      );
      verifySecretlessNextCandidateBuild({
        blobs,
        generated,
        operation: fixture.packet.operation,
        pnpmCommand: execFileSync("which", ["pnpm"], {
          encoding: "utf8",
        }).trim(),
        verificationRoot: join(outputRoot, "secretless-candidate-proof"),
      });
    } finally {
      fixture.cleanup();
      rmSync(outputRoot, { force: true, recursive: true });
    }
  },
);

test("terminal CLI smoke reapplies the validated plan and rejects content drift", () => {
  const fixture = protectedRuntimeFixture();
  const temporaryRoot = mkdtempSync(join(tmpdir(), "terminal-smoke-apply-"));
  try {
    const source = fixture.bytesByPath.get("package.json");
    const target = Buffer.from(
      source.toString("utf8").replace('"private": true', '"private": false'),
    );
    assert.notDeepEqual(target, source);
    const patch = createUnifiedPatch({
      newBytes: target,
      oldBytes: source,
      path: "package.json",
      temporaryRoot: join(temporaryRoot, "patch"),
    });
    const expectedBlobSha = fixture.packet.expectedBlobs.find(
      ({ path }) => path === "package.json",
    ).sha;
    const validated = {
      attempt: fixture.packet.attemptNumber,
      baseSha: fixture.packet.baseSha,
      edits: [
        {
          contentDigest: sha256(target),
          expectedBlobSha,
          mode: "100644",
          patch,
          path: "package.json",
          type: "blob",
        },
      ],
      packetDigest: sha256(
        Buffer.from(fixture.packetBase64, "base64").toString("utf8"),
      ),
      parentHeadSha: fixture.packet.headSha,
      processorCheckId: 753,
      pullRequestNumber: fixture.packet.pullRequestNumber,
      repository: fixture.packet.repository,
      schema: "dependabot-validated-repair-plan:v1",
      summary: "Bind the terminal smoke to one validated plan.",
    };
    const expectedByPath = new Map(
      fixture.packet.expectedBlobs.map((entry) => [entry.path, entry]),
    );
    const blobs = new Map(
      [...fixture.bytesByPath].map(([path, bytes]) => [
        path,
        {
          bytes,
          expectedBlobSha: expectedByPath.get(path).sha,
          mode: expectedByPath.get(path).mode,
        },
      ]),
    );
    const generated = applyValidatedPlanToEvidence({
      blobs,
      packet: fixture.packet,
      temporaryRoot: join(temporaryRoot, "valid"),
      validated,
    });
    assert.deepEqual(generated.get("package.json"), target);
    assert.throws(
      () =>
        applyValidatedPlanToEvidence({
          blobs,
          packet: fixture.packet,
          temporaryRoot: join(temporaryRoot, "drift"),
          validated: {
            ...validated,
            edits: [{ ...validated.edits[0], contentDigest: "0".repeat(64) }],
          },
        }),
      /content digest changed before smoke/u,
    );
  } finally {
    fixture.cleanup();
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});

test(
  "PR #753 regenerates exact authenticated seed root bytes and all five protected files",
  {
    skip:
      // eslint-disable-next-line turbo/no-undeclared-env-vars -- This explicit opt-in keeps the networked exact-pnpm fixture out of default unit runs.
      process.env.PROTECTED_RUNTIME_SYNC_INTEGRATION !== "1" ||
      !HAS_PR_753_OBJECTS,
  },
  () => {
    const fixture = pr753Fixture();
    const outputRoot = mkdtempSync(
      join(tmpdir(), "protected-runtime-pr753-output-"),
    );
    try {
      const plan = generateProtectedRuntimeRepairPlan({
        evidenceManifestPath: fixture.evidenceManifestPath,
        fetchMetadata: registryMetadata,
        packetBase64: fixture.packetBase64,
        processorCheckId: 753,
      });
      assert.deepEqual(
        plan.edits.map(({ path }) => path),
        PROTECTED_RUNTIME_SYNC_REQUIRED_PATHS,
      );
      for (const edit of plan.edits) {
        const destination = join(outputRoot, edit.path);
        mkdirSync(dirname(destination), { recursive: true });
        const source =
          edit.path === "scripts/vercel-cli-runtime/contract.json"
            ? readFileSync(join(REPOSITORY_ROOT, edit.path))
            : edit.path === "package.json"
              ? (() => {
                  const historical = JSON.parse(
                    gitShow(PR_753_REPAIRED_HEAD, edit.path).toString("utf8"),
                  );
                  const current = JSON.parse(
                    readFileSync(join(REPOSITORY_ROOT, edit.path), "utf8"),
                  );
                  historical.scripts["dependabot:process:test"] =
                    current.scripts["dependabot:process:test"];
                  return Buffer.from(
                    `${JSON.stringify(historical, null, 2)}\n`,
                  );
                })()
              : gitShow(PR_753_REPAIRED_HEAD, edit.path);
        writeFileSync(destination, source);
        const applied = spawnSync("/usr/bin/patch", ["-p1"], {
          cwd: outputRoot,
          encoding: "utf8",
          input: edit.patch,
          stdio: ["pipe", "pipe", "pipe"],
        });
        assert.equal(applied.status, 0, applied.stderr);
      }
      const targetRootPackage = readFileSync(join(outputRoot, "package.json"));
      const targetRootLock = readFileSync(join(outputRoot, "pnpm-lock.yaml"));
      const expectedRefreshedPackage = JSON.parse(
        gitShow(PR_753_REPAIRED_HEAD, "package.json").toString("utf8"),
      );
      const currentBasePackage = JSON.parse(
        readFileSync(join(REPOSITORY_ROOT, "package.json"), "utf8"),
      );
      expectedRefreshedPackage.scripts["dependabot:process:test"] =
        currentBasePackage.scripts["dependabot:process:test"];
      const expectedCurrentBasePackage = rotateRootPackageBytes(
        Buffer.from(`${JSON.stringify(expectedRefreshedPackage, null, 2)}\n`),
        TARGET_VERSION,
      );
      assert.deepEqual(targetRootPackage, expectedCurrentBasePackage);
      assert.equal(
        JSON.parse(targetRootPackage.toString("utf8")).devDependencies.knip,
        "^6.32.0",
      );
      assert.match(
        targetRootLock.toString("utf8"),
        new RegExp(
          `\\n  vercel@${TARGET_VERSION.replaceAll(".", "\\.")}:\\n    resolution: \\{integrity: ${TARGET_INTEGRITY.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\}`,
          "u",
        ),
      );
      assert.match(
        gitShow(
          PR_753_REPAIRED_HEAD,
          "packages/eslint-config/package.json",
        ).toString("utf8"),
        /"@next\/eslint-plugin-next": "\^16\.3\.0"/u,
      );
      assert.equal(
        sha256(
          readFileSync(
            join(outputRoot, "scripts", "vercel-cli-runtime", "package.json"),
          ),
        ),
        PR_753_TARGET_RUNTIME_PACKAGE_SHA256,
      );
      assert.equal(
        sha256(
          readFileSync(
            join(outputRoot, "scripts", "vercel-cli-runtime", "pnpm-lock.yaml"),
          ),
        ),
        PR_753_TARGET_RUNTIME_LOCK_SHA256,
      );
    } finally {
      fixture.cleanup();
      rmSync(outputRoot, { force: true, recursive: true });
    }
  },
);
