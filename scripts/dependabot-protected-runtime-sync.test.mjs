import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  assertValidatedPlanMatchesRegeneration,
  createRuntimeContract,
  createUnifiedPatch,
  generateProtectedRuntimeRepairPlan,
  PROTECTED_RUNTIME_SYNC_INPUT_PATHS,
  PROTECTED_RUNTIME_SYNC_REQUIRED_PATHS,
  rotateRootLockBytes,
  rotateRootPackageBytes,
  validateRegistryTransition,
} from "./dependabot-protected-runtime-sync.mjs";
import { canonicalJson } from "./dependabot-preparation-receipts.mjs";

const REPOSITORY_ROOT = fileURLToPath(new URL("..", import.meta.url));
const FROM_VERSION = "56.4.1";
const TARGET_VERSION = "56.5.0";
const TARGET_INTEGRITY =
  "sha512-wAKpT8DFSbnwlgbS711fbvxGjOfQeb1n+NcaBaSC4onq9eJAjbPfERrjrKE4GDsV8dkoBo0627lp0QxbLCGFiw==";
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

function gitBlobSha(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return createHash("sha1")
    .update(`blob ${bytes.byteLength}\0`)
    .update(bytes)
    .digest("hex");
}

function registryMetadata(version) {
  assert.ok([FROM_VERSION, TARGET_VERSION].includes(version));
  const currentDependencies = JSON.parse(
    readFileSync(
      join(REPOSITORY_ROOT, "scripts", "vercel-cli-runtime", "package.json"),
      "utf8",
    ),
  ).dependencies;
  const peers = Object.fromEntries(
    Object.entries(currentDependencies)
      .filter(([name]) => name !== "vercel")
      .map(([name, entryVersion]) => [
        name,
        name === "@vercel/python" && version === FROM_VERSION
          ? "6.51.0"
          : name === "@vercel/python"
            ? "6.51.1"
            : entryVersion,
      ]),
  );
  return {
    bin: { vc: "dist/vc.js", vercel: "dist/vc.js" },
    dependencies: { ...peers },
    dist: {
      integrity:
        version === TARGET_VERSION
          ? TARGET_INTEGRITY
          : activeSourceContract().registryIntegrity,
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

function activeSourceContract() {
  return JSON.parse(
    readFileSync(
      join(REPOSITORY_ROOT, "scripts", "vercel-cli-runtime", "contract.json"),
      "utf8",
    ),
  );
}

function sourceMetadata() {
  return registryMetadata(FROM_VERSION);
}

function targetMetadata() {
  return registryMetadata(TARGET_VERSION);
}

test("registry transition accepts only exact stable same-major builder peers", () => {
  const currentRuntimeDependencies = JSON.parse(
    readFileSync(
      join(REPOSITORY_ROOT, "scripts", "vercel-cli-runtime", "package.json"),
      "utf8",
    ),
  ).dependencies;
  const metadata = targetMetadata();
  const result = validateRegistryTransition({
    currentRuntimeDependencies,
    fromVersion: FROM_VERSION,
    sourceMetadata: sourceMetadata(),
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
          sourceMetadata: sourceMetadata(),
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
          sourceMetadata: sourceMetadata(),
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
  const rotated = JSON.parse(
    rotateRootPackageBytes(currentBytes, TARGET_VERSION).toString("utf8"),
  );
  assert.equal(rotated.devDependencies.vercel, TARGET_VERSION);
  assert.equal(
    rotated.scripts["dependabot:process:test"],
    current.scripts["dependabot:process:test"],
  );
  rotated.devDependencies.vercel = current.devDependencies.vercel;
  assert.deepEqual(rotated, current);
});

function gitShow(commit, path) {
  return execFileSync("git", ["show", `${commit}:${path}`], {
    cwd: REPOSITORY_ROOT,
    encoding: null,
    maxBuffer: 4 * 1024 * 1024,
  });
}

function pr753Fixture() {
  const root = mkdtempSync(join(tmpdir(), "protected-runtime-pr753-"));
  const evidenceRoot = join(root, "evidence");
  mkdirSync(evidenceRoot, { mode: 0o700 });
  const bytesByPath = new Map();
  for (const path of PROTECTED_RUNTIME_SYNC_INPUT_PATHS) {
    const bytes =
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
  const expectedBlobs = PROTECTED_RUNTIME_SYNC_INPUT_PATHS.map((path) => ({
    mode: "100644",
    path,
    sha: gitBlobSha(bytesByPath.get(path)),
    type: "blob",
  }));
  const packet = {
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
    headSha: PR_753_REPAIRED_HEAD,
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
      sourceSeedHeadSha: PR_753_IMMUTABLE_SOURCE,
      targetVersion: TARGET_VERSION,
      updateType: "minor",
    },
    packageEcosystem: "npm",
    permittedPaths: PROTECTED_RUNTIME_SYNC_REQUIRED_PATHS,
    preparable: true,
    pullRequestNumber: 753,
    repository: "mento-protocol/frontend-monorepo",
    requiredGateIds: ["build-and-test"],
    requireExactHead: true,
    requireHumanApproval: false,
    riskTier: "manual-review",
    schema: "dependabot-repair-packet:v3",
    updateType: "minor",
    validationCommands: ["pnpm dependabot:process:test"],
    workflowRunAttempt: 1,
    workflowRunId: 753,
    workflowSha: "c".repeat(40),
  };
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
    cleanup: () => rmSync(root, { force: true, recursive: true }),
    evidenceManifestPath: manifestPath,
    packetBase64: Buffer.from(packetText).toString("base64"),
  };
}

test("terminal CLI smoke rejects validated-plan and content drift", () => {
  const fixture = pr753Fixture();
  try {
    const packetText = Buffer.from(fixture.packetBase64, "base64").toString(
      "utf8",
    );
    const packet = JSON.parse(packetText);
    const generatedContent = Buffer.from("generated target bytes\n");
    const expectedBlobSha = packet.expectedBlobs.find(
      ({ path }) => path === "package.json",
    ).sha;
    const plan = {
      attempt: packet.attemptNumber,
      baseSha: packet.baseSha,
      edits: [
        {
          expectedBlobSha,
          patch: "exact generated patch",
          path: "package.json",
        },
      ],
      packetDigest: sha256(packetText),
      parentHeadSha: packet.headSha,
      processorCheckId: 753,
      pullRequestNumber: packet.pullRequestNumber,
      repository: packet.repository,
      schema: "dependabot-repair-plan:v1",
      summary: "Bind the terminal smoke to one validated plan.",
    };
    const validated = {
      ...plan,
      edits: plan.edits.map((edit) => ({
        contentDigest: sha256(generatedContent),
        expectedBlobSha: edit.expectedBlobSha,
        mode: "100644",
        patch: edit.patch,
        path: edit.path,
        type: "blob",
      })),
      schema: "dependabot-validated-repair-plan:v1",
    };
    const assertBound = (candidate) => {
      const canonical = canonicalJson(candidate);
      return assertValidatedPlanMatchesRegeneration({
        generated: new Map([["package.json", generatedContent]]),
        packetBase64: fixture.packetBase64,
        processorCheckId: 753,
        regeneratedPlan: plan,
        validatedPlanBase64: Buffer.from(canonical).toString("base64"),
        validatedPlanDigest: sha256(canonical),
      });
    };
    assert.equal(assertBound(validated).schema, validated.schema);
    assert.throws(
      () =>
        assertBound({
          ...validated,
          edits: [{ ...validated.edits[0], patch: "registry drift" }],
        }),
      /not the exact terminal-smoke regeneration/u,
    );
    assert.throws(
      () =>
        assertBound({
          ...validated,
          edits: [{ ...validated.edits[0], contentDigest: "0".repeat(64) }],
        }),
      /content digest changed before smoke/u,
    );
  } finally {
    fixture.cleanup();
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
