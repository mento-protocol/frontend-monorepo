import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  GITHUB_WEB_FLOW_USER_ID,
  PROCESSOR_PACKET_SCHEMA_V2,
  PROCESSOR_PACKET_SCHEMA_V3,
  PROTECTED_RUNTIME_SYNC_OPERATION_SCHEMA,
  applyRepairPlan,
  canonicalDigest,
  canonicalJson,
  collectExactPullFiles,
  collectTerminalSourceChecks,
  createRecoveryRetryAction,
  createRepairRecoveryAction,
  createRepairRetryAction,
  createRequestedRefreshAction,
  gitSubprocessEnvironment,
  gitBlobSha,
  githubJobLogRequest,
  isRetryableRepairConclusion,
  materializeRepairEvidence,
  nextInfrastructureRetry,
  operationExternalId,
  parseRepairRunTitle,
  parseCanonicalJson,
  prepareRefMutationForbiddenPath,
  rawDigest,
  readCurrentDefaultBranchSha,
  repairIntentExternalId,
  sourceAttemptBinding,
  terminalActionConfiguration,
  validatePreparedHeadPayload,
  validateProcessDispatchPayload,
  validateProcessorRepairPacket,
  validateRefreshReceipt,
  validateRepairDispatchPayload,
  validateFailureRun,
  validateRepairCommit,
  validateRepairIntent,
  validateRepairPatch,
  validateRepairPlan,
  validateRepairReceipt,
  validateRepairRecoveryPayload,
  validateTerminalEventPayload,
  validateValidatedRepairPlan,
  waitForRepairPullAfterRefMove,
} from "./dependabot-preparation-receipts.mjs";

const repository = "mento-protocol/frontend-monorepo";
const headSha = "a".repeat(40);
const baseSha = "b".repeat(40);
const workflowSha = "c".repeat(40);
const packetDigest = "d".repeat(64);
const appIdentity = {
  prepareAppSlug: "mento-dependabot-prepare",
  prepareBotId: 123456,
  prepareBotLogin: "mento-dependabot-prepare[bot]",
};

function repairPacket(overrides = {}) {
  return {
    attemptLimit: 2,
    attemptNumber: 1,
    automatic: true,
    baseRef: "main",
    baseSha,
    changedPaths: ["scripts/fixtures/action-pins/ci.yml"],
    dependencyGroup: "github-actions-routine",
    dependencyNames: ["actions/checkout"],
    escalation: "manual-review",
    expectedBlobs: [
      {
        mode: "100644",
        path: "scripts/fixtures/action-pins/ci.yml",
        sha: "e".repeat(40),
        type: "blob",
      },
    ],
    failures: [],
    feedbackThreads: [],
    findings: [
      {
        checkId: 77,
        digest: canonicalDigest({
          line: 3,
          path: "scripts/fixtures/action-pins/ci.yml",
          summary: "The reviewed fixture still contains the prior pin.",
          title: "Update the action-pin fixture",
        }),
        line: 3,
        path: "scripts/fixtures/action-pins/ci.yml",
        source: "check",
        sourceId: "action-pins",
        summary: "The reviewed fixture still contains the prior pin.",
        title: "Update the action-pin fixture",
      },
    ],
    forbiddenPaths: [".github/workflows/**", ".github/actions/**"],
    headRef: "dependabot/github_actions/actions-checkout-123",
    headSha,
    limits: {
      maxAddedLines: 20,
      maxBytes: 8192,
      maxChanges: 20,
      maxDeletedLines: 20,
      maxFiles: 2,
    },
    mode: "prepare",
    packageEcosystem: "github-actions",
    permittedPaths: ["scripts/fixtures/action-pins/**"],
    preparable: true,
    pullRequestNumber: 731,
    repository,
    requiredGateIds: ["action-pins"],
    requireExactHead: true,
    requireHumanApproval: false,
    riskTier: "automatic",
    schema: PROCESSOR_PACKET_SCHEMA_V2,
    updateType: "patch",
    validationCommands: ["pnpm ci:action-pins:test"],
    workflowRunAttempt: 2,
    workflowRunId: 998877,
    workflowSha,
    ...overrides,
  };
}

const protectedRuntimeRequiredPaths = [
  "package.json",
  "pnpm-lock.yaml",
  "scripts/vercel-cli-runtime/contract.json",
  "scripts/vercel-cli-runtime/package.json",
  "scripts/vercel-cli-runtime/pnpm-lock.yaml",
];
const protectedRuntimeInputPaths = [
  "apps/app.mento.org/package.json",
  "apps/governance.mento.org/package.json",
  "apps/reserve.mento.org/package.json",
  "apps/ui.mento.org/package.json",
  "package.json",
  "packages/eslint-config/package.json",
  "packages/typescript-config/package.json",
  "packages/ui/package.json",
  "packages/vitest-config/package.json",
  "packages/web3/package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "scripts/vercel-cli-runtime/contract.json",
  "scripts/vercel-cli-runtime/package.json",
  "scripts/vercel-cli-runtime/pnpm-lock.yaml",
];
const typedNpmRequiredGateIds = [
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
const typedNpmValidationCommands = [
  "pnpm install --frozen-lockfile",
  "pnpm quality:budgets:test",
  "pnpm quality:coverage",
  "pnpm build",
  "pnpm quality:bundle:check",
];

function protectedRuntimePacket(overrides = {}) {
  return repairPacket({
    changedPaths: ["package.json", "pnpm-lock.yaml"],
    dependencyGroup: "tooling",
    dependencyNames: ["knip", "vercel", "@next/eslint-plugin-next"],
    expectedBlobs: protectedRuntimeInputPaths.map((path) => ({
      mode: "100644",
      path,
      sha: "e".repeat(40),
      type: "blob",
    })),
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
    limits: {
      maxAddedLines: 600,
      maxBytes: 64 * 1024,
      maxChanges: 160,
      maxDeletedLines: 600,
      maxFiles: 5,
    },
    operation: {
      dependency: "vercel",
      fromVersion: "56.4.1",
      inputPaths: protectedRuntimeInputPaths,
      kind: "vercel-cli-runtime-sync",
      pnpmVersion: "10.34.4",
      requiredPaths: protectedRuntimeRequiredPaths,
      schema: PROTECTED_RUNTIME_SYNC_OPERATION_SCHEMA,
      sourceSeedHeadSha: "f".repeat(40),
      targetVersion: "56.5.0",
      updateType: "minor",
    },
    packageEcosystem: "npm",
    permittedPaths: protectedRuntimeRequiredPaths,
    requiredGateIds: typedNpmRequiredGateIds,
    riskTier: "human-merge-npm",
    schema: PROCESSOR_PACKET_SCHEMA_V3,
    updateType: "minor",
    validationCommands: typedNpmValidationCommands,
    ...overrides,
  });
}

const nextCatalogRequiredPaths = [
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "scripts/vercel-cli-runtime/contract.json",
  "scripts/vercel-cli-runtime/package.json",
  "scripts/vercel-cli-runtime/pnpm-lock.yaml",
];

function nextCatalogPacket(overrides = {}) {
  return protectedRuntimePacket({
    changedPaths: ["pnpm-lock.yaml", "pnpm-workspace.yaml"],
    dependencyGroup: "frontend-core",
    dependencyNames: ["next"],
    headRef: "dependabot/npm_and_yarn/frontend-core-123",
    limits: {
      maxAddedLines: 600,
      maxBytes: 64 * 1024,
      maxChanges: 1_200,
      maxDeletedLines: 600,
      maxFiles: nextCatalogRequiredPaths.length,
    },
    operation: {
      dependency: "next",
      fromSpecifier: "^16.2.12",
      fromVersion: "16.2.12",
      inputPaths: protectedRuntimeInputPaths,
      kind: "next-catalog-override-sync",
      pnpmVersion: "10.34.4",
      resolutionMode: "lowest-direct",
      requiredPaths: nextCatalogRequiredPaths,
      schema: PROTECTED_RUNTIME_SYNC_OPERATION_SCHEMA,
      sourceSeedHeadSha: "f".repeat(40),
      targetSpecifier: "^16.3.1",
      targetVersion: "16.3.1",
      updateType: "minor",
    },
    permittedPaths: nextCatalogRequiredPaths,
    riskTier: "human-merge-npm",
    updateType: "minor",
    ...overrides,
  });
}

function repairPlanFor(packet, edits) {
  return {
    attempt: packet.attemptNumber,
    baseSha: packet.baseSha,
    edits,
    packetDigest,
    parentHeadSha: packet.headSha,
    processorCheckId: 444,
    pullRequestNumber: packet.pullRequestNumber,
    repository: packet.repository,
    schema: "dependabot-repair-plan:v1",
    summary: "Apply the exact packet-bound repair.",
  };
}

function repairReceipt(overrides = {}) {
  return {
    attempt: 1,
    baseSha,
    headRef: "dependabot/github_actions/actions-checkout-123",
    headSha: "1".repeat(40),
    packetDigest,
    parentHeadSha: headSha,
    ...appIdentity,
    processorCheckId: 444,
    pullRequestNumber: 731,
    repository,
    schema: "dependabot-repair:v1",
    state: "completed",
    workflowRunAttempt: 2,
    workflowRunId: 998877,
    workflowSha,
    ...overrides,
  };
}

function repairIntent(overrides = {}) {
  const edits = [
    {
      contentDigest: "5".repeat(64),
      expectedBlobSha: "e".repeat(40),
      mode: "100644",
      path: "scripts/fixtures/action-pins/ci.yml",
      resultBlobSha: "4".repeat(40),
      type: "blob",
    },
  ];
  const parentTreeSha = "2".repeat(40);
  const treeSha = "3".repeat(40);
  return {
    attempt: 1,
    baseSha,
    edits,
    editsDigest: canonicalDigest(edits),
    headRef: "dependabot/github_actions/actions-checkout-123",
    headSha: "1".repeat(40),
    packetDigest,
    parentHeadSha: headSha,
    parentTreeSha,
    ...appIdentity,
    processorCheckId: 444,
    pullRequestNumber: 731,
    repository,
    retryCount: 0,
    schema: "dependabot-repair-intent:v1",
    state: "staged",
    treeDigest: canonicalDigest({ parentTreeSha, treeSha }),
    treeSha,
    validatedPlanDigest: "6".repeat(64),
    workflowRunAttempt: 2,
    workflowRunId: 998877,
    workflowSha,
    ...overrides,
  };
}

function requestedRefreshReceipt(overrides = {}) {
  return {
    baseSha,
    headRef: "dependabot/github_actions/actions-checkout-123",
    headSha: null,
    parentHeadSha: headSha,
    ...appIdentity,
    previousBaseSha: "9".repeat(40),
    pullRequestNumber: 731,
    repository,
    schema: "dependabot-refresh:v1",
    state: "requested",
    workflowRunAttempt: 2,
    workflowRunId: 998877,
    workflowSha,
    ...overrides,
  };
}

test("canonical JSON recursively sorts keys and rejects non-canonical text", () => {
  const value = { z: [{ b: 2, a: 1 }], a: true };
  const canonical = '{"a":true,"z":[{"a":1,"b":2}]}';
  assert.equal(canonicalJson(value), canonical);
  assert.deepEqual(parseCanonicalJson(canonical), value);
  assert.throws(
    () => parseCanonicalJson(JSON.stringify(value)),
    /not canonical/,
  );
});

test("operation receipts bind exact identity, workflow run, and canonical digest", () => {
  const requested = validateRefreshReceipt(requestedRefreshReceipt());
  assert.match(
    operationExternalId(requested),
    /^dependabot-refresh:v1:pr=731:head=[a-f0-9]{40}:state=requested:digest=[a-f0-9]{64}:run=998877:attempt=2$/,
  );
  assert.throws(
    () =>
      validateRefreshReceipt(
        requestedRefreshReceipt({ previousBaseSha: baseSha }),
      ),
    /previous and current bases must be distinct/,
  );

  const repair = validateRepairReceipt(repairReceipt());
  assert.equal(
    canonicalDigest(repair),
    operationExternalId(repair).match(/digest=([a-f0-9]{64})/)?.[1],
  );
  assert.throws(
    () => validateRepairReceipt(repairReceipt({ prepareBotId: 0 })),
    /prepareBotId/,
  );
});

test("repair intents bind staged commit, packet, plan, tree, edits, App, and source run", () => {
  const intent = validateRepairIntent(repairIntent());
  assert.match(
    repairIntentExternalId(intent),
    /^dependabot-repair-intent:v1:pr=731:head=[a-f0-9]{40}:attempt=1:digest=[a-f0-9]{64}:run=998877:run_attempt=2$/,
  );
  assert.throws(
    () =>
      validateRepairIntent({
        ...intent,
        edits: [{ ...intent.edits[0], resultBlobSha: "7".repeat(40) }],
      }),
    /edit digest changed/,
  );
  assert.throws(
    () => validateRepairIntent({ ...intent, treeSha: "8".repeat(40) }),
    /tree digest changed/,
  );
});

test("post-ref repair verification polls only an exact stale parent pull", async () => {
  const intent = repairIntent();
  const pullAt = (head) => ({
    base: {
      ref: "main",
      repo: { full_name: intent.repository },
      sha: intent.baseSha,
    },
    draft: false,
    head: {
      ref: intent.headRef,
      repo: { full_name: intent.repository },
      sha: head,
    },
    number: intent.pullRequestNumber,
    state: "open",
    user: { login: "dependabot[bot]", type: "Bot" },
  });
  const reads = [
    pullAt(intent.parentHeadSha),
    pullAt(intent.parentHeadSha),
    pullAt(intent.headSha),
  ];
  const waits = [];
  const result = await waitForRepairPullAfterRefMove({
    intent,
    readPull: async () => reads.shift(),
    sleep: async (milliseconds) => waits.push(milliseconds),
  });
  assert.equal(result.head.sha, intent.headSha);
  assert.equal(reads.length, 0);
  assert.deepEqual(waits, [2_000, 2_000]);

  let immediateReads = 0;
  const immediate = await waitForRepairPullAfterRefMove({
    intent,
    readPull: async () => {
      immediateReads += 1;
      return pullAt(intent.headSha);
    },
    sleep: async () => assert.fail("an exact target must not wait"),
  });
  assert.equal(immediate.head.sha, intent.headSha);
  assert.equal(immediateReads, 1);
});

test("post-ref repair verification fails closed on drift, API errors, and a stale cap", async () => {
  const intent = repairIntent();
  const pullAt = (head, overrides = {}) => ({
    base: {
      ref: "main",
      repo: { full_name: intent.repository },
      sha: intent.baseSha,
    },
    draft: false,
    head: {
      ref: intent.headRef,
      repo: { full_name: intent.repository },
      sha: head,
    },
    number: intent.pullRequestNumber,
    state: "open",
    user: { login: "dependabot[bot]", type: "Bot" },
    ...overrides,
  });

  let driftReads = 0;
  await assert.rejects(
    waitForRepairPullAfterRefMove({
      intent,
      readPull: async () => {
        driftReads += 1;
        return pullAt("9".repeat(40));
      },
      sleep: async () => assert.fail("unexpected head drift must not wait"),
    }),
    /live pull request does not match repair intent/,
  );
  assert.equal(driftReads, 1);

  let metadataReads = 0;
  await assert.rejects(
    waitForRepairPullAfterRefMove({
      intent,
      readPull: async () => {
        metadataReads += 1;
        return pullAt(intent.parentHeadSha, { draft: true });
      },
      sleep: async () => assert.fail("metadata drift must not wait"),
    }),
    /live pull request does not match repair intent/,
  );
  assert.equal(metadataReads, 1);

  let apiReads = 0;
  const apiWaits = [];
  await assert.rejects(
    waitForRepairPullAfterRefMove({
      intent,
      readPull: async () => {
        apiReads += 1;
        if (apiReads === 1) return pullAt(intent.parentHeadSha);
        throw new Error("provider read failed");
      },
      sleep: async (milliseconds) => apiWaits.push(milliseconds),
    }),
    /provider read failed/,
  );
  assert.equal(apiReads, 2);
  assert.deepEqual(apiWaits, [2_000]);

  let staleReads = 0;
  const staleWaits = [];
  await assert.rejects(
    waitForRepairPullAfterRefMove({
      intent,
      readPull: async () => {
        staleReads += 1;
        return pullAt(intent.parentHeadSha);
      },
      sleep: async (milliseconds) => staleWaits.push(milliseconds),
    }),
    /remained stale after repair ref move/,
  );
  assert.equal(staleReads, 5);
  assert.deepEqual(staleWaits, [2_000, 2_000, 2_000, 2_000]);
});

test("repair and recovery titles bind bounded infrastructure retry state", () => {
  assert.deepEqual(
    parseRepairRunTitle(
      `dependabot-repair:v1 | pr=731 | head=${headSha} | check=444 | digest=${packetDigest} | retry=2`,
    ),
    {
      checkId: 444,
      digest: packetDigest,
      headSha,
      kind: "repair",
      pullRequestNumber: 731,
      retryCount: 2,
    },
  );
  assert.equal(
    parseRepairRunTitle(
      `dependabot-repair-recover:v1 | pr=731 | head=${"1".repeat(40)} | check=771 | digest=${"7".repeat(64)} | retry=0`,
    ).kind,
    "recovery",
  );
  assert.equal(nextInfrastructureRetry(0), 1);
  assert.equal(nextInfrastructureRetry(1), 2);
  assert.equal(nextInfrastructureRetry(2), null);
  for (const conclusion of [
    "action_required",
    "cancelled",
    "failure",
    "startup_failure",
    "timed_out",
  ]) {
    assert.equal(isRetryableRepairConclusion(conclusion), true);
  }
  for (const conclusion of ["neutral", "skipped", "stale", "success"]) {
    assert.equal(isRetryableRepairConclusion(conclusion), false);
  }
  assert.throws(
    () =>
      parseRepairRunTitle(
        `dependabot-repair:v1 | pr=731 | head=${headSha} | check=444 | digest=${packetDigest}`,
      ),
    /title is not exact/,
  );
  assert.throws(
    () =>
      parseRepairRunTitle(
        `dependabot-repair:v1 | pr=731 | head=${headSha} | check=445 | digest=${packetDigest} | retry=2 trailing`,
      ),
    /title is not exact/,
  );
});

test("staging and recovery bind the Prepare author, GitHub signer, and verification", () => {
  const intent = repairIntent();
  const commit = {
    author: {
      id: intent.prepareBotId,
      login: intent.prepareBotLogin,
      type: "Bot",
    },
    commit: {
      tree: { sha: intent.treeSha },
      verification: { reason: "valid", verified: true },
    },
    committer: {
      id: GITHUB_WEB_FLOW_USER_ID,
      login: "web-flow",
      type: "User",
    },
    parents: [{ sha: intent.parentHeadSha }],
    sha: intent.headSha,
  };
  assert.equal(validateRepairCommit(commit, intent), commit);
  assert.equal(
    validateRepairCommit(
      {
        ...commit,
        committer: {
          id: intent.prepareBotId,
          login: intent.prepareBotLogin,
          type: "Bot",
        },
      },
      intent,
    ).sha,
    intent.headSha,
  );
  for (const committer of [
    { id: GITHUB_WEB_FLOW_USER_ID + 1, login: "web-flow", type: "User" },
    { id: GITHUB_WEB_FLOW_USER_ID, login: "attacker", type: "User" },
    { id: GITHUB_WEB_FLOW_USER_ID, login: "web-flow", type: "Bot" },
    { id: intent.prepareBotId, login: intent.prepareBotLogin, type: "User" },
  ]) {
    assert.throws(
      () => validateRepairCommit({ ...commit, committer }, intent),
      /exact Prepare App append/,
    );
  }
  assert.throws(
    () =>
      validateRepairCommit(
        {
          ...commit,
          commit: {
            ...commit.commit,
            verification: { reason: "unsigned", verified: false },
          },
        },
        intent,
      ),
    /exact Prepare App append/,
  );
  assert.throws(
    () =>
      validateRepairCommit(
        {
          ...commit,
          commit: {
            ...commit.commit,
            verification: { reason: "unknown_signature_type", verified: true },
          },
        },
        intent,
      ),
    /exact Prepare App append/,
  );
});

test("a crash after the ref move dispatches exact-head recovery while a staged-only intent is inert", () => {
  const intent = repairIntent({ retryCount: 2 });
  const intentText = canonicalJson(intent);
  const check = {
    app: { id: 15368, slug: "github-actions" },
    conclusion: "success",
    details_url: "https://github.com/mento-protocol/frontend-monorepo/runs/771",
    external_id: repairIntentExternalId(intent),
    head_sha: intent.headSha,
    id: 771,
    name: "Dependabot Repair Intent",
    output: { text: intentText },
    status: "completed",
  };
  const currentPull = {
    base: { sha: "9".repeat(40) },
    head: { ref: intent.headRef, sha: intent.headSha },
    number: intent.pullRequestNumber,
  };
  const action = createRepairRecoveryAction({
    check,
    intent,
    intentText,
    pull: currentPull,
    retryCount: 0,
    sourceRunId: intent.workflowRunId,
  });
  assert.equal(action.eventType, "dependabot-prepare-repair-recover");
  assert.equal(action.payload.headSha, intent.headSha);
  assert.equal(action.payload.parentHeadSha, intent.parentHeadSha);
  assert.equal(action.payload.intentReceipt.checkId, check.id);
  assert.equal(action.payload.intentReceipt.digest, rawDigest(intentText));
  assert.equal(action.payload.retryCount, 0);
  assert.equal(Object.keys(action.payload).length, 10);
  assert.deepEqual(
    validateTerminalEventPayload(action.eventType, action.payload, repository),
    action.payload,
  );
  assert.ok(
    createRepairRecoveryAction({
      check: {
        ...check,
        details_url:
          "https://github.com/mento-protocol/frontend-monorepo/actions/runs/998877",
      },
      intent,
      intentText,
      pull: currentPull,
      retryCount: 0,
      sourceRunId: intent.workflowRunId,
    }),
    "submitted Actions URLs and GitHub-rewritten exact self URLs are accepted",
  );

  assert.equal(
    createRepairRecoveryAction({
      check,
      intent,
      intentText,
      pull: {
        ...currentPull,
        head: { ref: intent.headRef, sha: intent.parentHeadSha },
      },
      retryCount: 0,
      sourceRunId: intent.workflowRunId,
    }),
    null,
    "an intent on an unreachable staged successor cannot authorize recovery",
  );
  assert.throws(
    () =>
      createRepairRecoveryAction({
        check: { ...check, conclusion: "failure" },
        intent,
        intentText,
        pull: currentPull,
        retryCount: 0,
        sourceRunId: intent.workflowRunId,
      }),
    /intent check is not exact/,
  );
});

test("terminal retries re-authenticate a pre-ref packet and bound recovery 0 to 1 to 2", async () => {
  const readFixture = ["read", "fixture"].join("-");
  const packet = repairPacket();
  const packetText = canonicalJson(packet);
  const digest = rawDigest(packetText);
  const pull = {
    base: { ref: "main", repo: { full_name: repository }, sha: packet.baseSha },
    draft: false,
    head: {
      ref: packet.headRef,
      repo: { full_name: repository },
      sha: packet.headSha,
    },
    number: packet.pullRequestNumber,
    state: "open",
    user: { login: "dependabot[bot]", type: "Bot" },
  };
  const processorCheck = {
    app: { id: 15368, slug: "github-actions" },
    conclusion: "failure",
    details_url: `https://github.com/${repository}/actions/runs/${packet.workflowRunId}`,
    external_id: `dependabot-processor:v2:pr=${packet.pullRequestNumber}:head=${packet.headSha}:mode=prepare:repair=${packet.attemptNumber}:packet=true:digest=${digest}:run=${packet.workflowRunId}:attempt=${packet.workflowRunAttempt}`,
    head_sha: packet.headSha,
    id: 444,
    name: "Dependabot Processor",
    output: { text: packetText },
    status: "completed",
  };
  const processorRun = {
    conclusion: "success",
    event: "repository_dispatch",
    head_branch: "main",
    head_repository: { full_name: repository },
    head_sha: packet.workflowSha,
    id: packet.workflowRunId,
    path: ".github/workflows/dependabot-process.yml",
    run_attempt: packet.workflowRunAttempt,
    status: "completed",
  };
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      const path = new URL(url).pathname;
      const body =
        path === `/repos/${repository}/check-runs/444`
          ? processorCheck
          : path === `/repos/${repository}/actions/runs/${packet.workflowRunId}`
            ? processorRun
            : path === `/repos/${repository}/pulls/${packet.pullRequestNumber}`
              ? pull
              : assert.fail(`unexpected retry request: ${path}`);
      return new Response(JSON.stringify(body), { status: 200 });
    };
    const retry = await createRepairRetryAction({
      pull,
      repositoryName: repository,
      title: parseRepairRunTitle(
        `dependabot-repair:v1 | pr=${packet.pullRequestNumber} | head=${packet.headSha} | check=444 | digest=${digest} | retry=0`,
      ),
      token: readFixture,
    });
    assert.equal(retry.eventType, "dependabot-prepare-repair");
    assert.equal(retry.payload.retryCount, 1);
    assert.equal(retry.payload.processorReceipt.digest, digest);

    globalThis.fetch = async () =>
      assert.fail("a capped repair retry must not read provider state");
    assert.equal(
      await createRepairRetryAction({
        pull,
        repositoryName: repository,
        title: parseRepairRunTitle(
          `dependabot-repair:v1 | pr=${packet.pullRequestNumber} | head=${packet.headSha} | check=444 | digest=${digest} | retry=2`,
        ),
        token: readFixture,
      }),
      null,
    );

    const intent = repairIntent({ retryCount: 2 });
    const intentText = canonicalJson(intent);
    const intentCheck = {
      app: { id: 15368, slug: "github-actions" },
      conclusion: "success",
      details_url: `https://github.com/${repository}/runs/771`,
      external_id: repairIntentExternalId(intent),
      head_sha: intent.headSha,
      id: 771,
      name: "Dependabot Repair Intent",
      output: { text: intentText },
      status: "completed",
    };
    const preparedPull = {
      ...pull,
      head: { ...pull.head, sha: intent.headSha },
    };
    globalThis.fetch = async (url) => {
      const path = new URL(url).pathname;
      assert.equal(path, `/repos/${repository}/check-runs/771`);
      return new Response(JSON.stringify(intentCheck), { status: 200 });
    };
    for (const [current, expected] of [
      [0, 1],
      [1, 2],
    ]) {
      const retry = await createRecoveryRetryAction({
        pull: preparedPull,
        repositoryName: repository,
        title: parseRepairRunTitle(
          `dependabot-repair-recover:v1 | pr=${intent.pullRequestNumber} | head=${intent.headSha} | check=771 | digest=${rawDigest(intentText)} | retry=${current}`,
        ),
        token: readFixture,
      });
      assert.equal(retry.payload.retryCount, expected);
    }
    await assert.rejects(
      createRecoveryRetryAction({
        pull: preparedPull,
        repositoryName: repository,
        title: parseRepairRunTitle(
          `dependabot-repair-recover:v1 | pr=${intent.pullRequestNumber} | head=${intent.headSha} | check=771 | digest=${"8".repeat(64)} | retry=0`,
        ),
        token: readFixture,
      }),
      /intent digest changed/,
    );
    globalThis.fetch = async () =>
      assert.fail("a capped recovery retry must not read provider state");
    assert.equal(
      await createRecoveryRetryAction({
        pull: preparedPull,
        repositoryName: repository,
        title: parseRepairRunTitle(
          `dependabot-repair-recover:v1 | pr=${intent.pullRequestNumber} | head=${intent.headSha} | check=771 | digest=${rawDigest(intentText)} | retry=2`,
        ),
        token: readFixture,
      }),
      null,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a live-shaped terminal requested Refresh binds the historical PR base and current main", () => {
  const receipt = requestedRefreshReceipt();
  const check = {
    app: { id: 15368, slug: "github-actions" },
    conclusion: "success",
    details_url:
      "https://github.com/mento-protocol/frontend-monorepo/actions/runs/998877",
    external_id: operationExternalId(receipt),
    head_sha: headSha,
    id: 551,
    status: "completed",
  };
  const pull = {
    base: { sha: receipt.previousBaseSha },
    head: { ref: receipt.headRef, sha: headSha },
    number: 731,
  };
  const action = createRequestedRefreshAction({
    check,
    currentBaseSha: receipt.baseSha,
    pull,
    receipt,
    sourceRunId: 998877,
  });
  assert.deepEqual(action, {
    eventType: "dependabot-process",
    payload: { scope: "open" },
    prepareApp: {
      botId: appIdentity.prepareBotId,
      botLogin: appIdentity.prepareBotLogin,
      slug: appIdentity.prepareAppSlug,
    },
  });
  assert.equal(Object.keys(action.payload).length, 1);
  assert.equal(
    createRequestedRefreshAction({
      check,
      currentBaseSha: "c".repeat(40),
      pull,
      receipt,
      sourceRunId: 998877,
    }),
    null,
    "a terminal request becomes inert when current main moves",
  );
  assert.equal(
    createRequestedRefreshAction({
      check,
      currentBaseSha: receipt.baseSha,
      pull: { ...pull, base: { sha: "8".repeat(40) } },
      receipt,
      sourceRunId: 998877,
    }),
    null,
    "a terminal request becomes inert when the PR historical base changes",
  );
  assert.throws(
    () =>
      createRequestedRefreshAction({
        check: { ...check, status: "in_progress" },
        currentBaseSha: receipt.baseSha,
        pull,
        receipt,
        sourceRunId: 998877,
      }),
    /not exact/,
  );
  assert.throws(
    () =>
      createRequestedRefreshAction({
        check: { ...check, head_sha: "7".repeat(40) },
        currentBaseSha: receipt.baseSha,
        pull,
        receipt,
        sourceRunId: 998877,
      }),
    /not exact/,
    "a requested Refresh cannot move to a different head",
  );
  assert.throws(
    () =>
      createRequestedRefreshAction({
        check,
        currentBaseSha: "not-a-sha",
        pull,
        receipt,
        sourceRunId: 998877,
      }),
    /current default-branch SHA is invalid/,
  );
});

test("terminal Refresh dispatch reads the exact live default-branch ref", async () => {
  const requestedPaths = [];
  const currentBaseSha = await readCurrentDefaultBranchSha({
    repositoryName: repository,
    requestJson: async (path) => {
      requestedPaths.push(path);
      if (path === `/repos/${repository}`) {
        return {
          default_branch: "main",
          full_name: repository,
          id: 123,
        };
      }
      assert.equal(path, `/repos/${repository}/git/ref/heads/main`);
      return {
        object: { sha: baseSha, type: "commit" },
        ref: "refs/heads/main",
        url: `https://api.github.com/repos/${repository}/git/refs/heads/main`,
      };
    },
  });
  assert.equal(currentBaseSha, baseSha);
  assert.deepEqual(requestedPaths, [
    `/repos/${repository}`,
    `/repos/${repository}/git/ref/heads/main`,
  ]);

  await assert.rejects(
    readCurrentDefaultBranchSha({
      repositoryName: repository,
      requestJson: async (path) =>
        path === `/repos/${repository}`
          ? { default_branch: "trunk", full_name: repository }
          : assert.fail("a non-main default must not be dereferenced"),
    }),
    /default branch is not exact/,
  );
  await assert.rejects(
    readCurrentDefaultBranchSha({
      repositoryName: repository,
      requestJson: async (path) =>
        path === `/repos/${repository}`
          ? { default_branch: "main", full_name: repository }
          : {
              object: { sha: baseSha, type: "tag" },
              ref: "refs/heads/main",
            },
    }),
    /reference is not exact/,
  );
});

test("terminal dispatch accepts the repository-free exact processor sweep payload", () => {
  assert.deepEqual(
    validateTerminalEventPayload(
      "dependabot-process",
      { scope: "open" },
      repository,
    ),
    { scope: "open" },
  );
  assert.throws(
    () =>
      validateTerminalEventPayload(
        "dependabot-process",
        { repository, scope: "open" },
        repository,
      ),
    /keys are not exact/,
  );
});

test("terminal lookup paginates exact source check names without broad head caps", async () => {
  const receipt = requestedRefreshReceipt();
  const currentCheck = {
    app: { id: 15368, slug: "github-actions" },
    conclusion: "success",
    details_url:
      "https://github.com/mento-protocol/frontend-monorepo/actions/runs/998877",
    external_id: operationExternalId(receipt),
    head_sha: headSha,
    id: 999_999,
    name: "Dependabot Refresh",
    output: { text: canonicalJson(receipt) },
    status: "completed",
  };
  const historical = Array.from({ length: 100 }, (_, index) => ({
    details_url: `https://github.com/${repository}/actions/runs/${index + 1}`,
    external_id: `old:run=${index + 1}:attempt=1`,
    id: 10_000 + index,
    name: "Dependabot Refresh",
  }));
  const requestedPaths = [];
  const refreshPrefix =
    `/repos/${repository}/commits/${headSha}/check-runs?` +
    "check_name=Dependabot%20Refresh&filter=all&per_page=100&page=";
  const processorPath =
    `/repos/${repository}/commits/${headSha}/check-runs?` +
    "check_name=Dependabot%20Processor&filter=all&per_page=100&page=1";
  const responses = new Map([
    [`${refreshPrefix}1`, { check_runs: historical, total_count: 101 }],
    [`${refreshPrefix}2`, { check_runs: [currentCheck], total_count: 101 }],
    [processorPath, { check_runs: [], total_count: 0 }],
  ]);
  const checks = await collectTerminalSourceChecks({
    pulls: [
      {
        head: { ref: receipt.headRef, sha: headSha },
        number: 731,
      },
    ],
    repositoryName: repository,
    requestJson: async (path) => {
      requestedPaths.push(path);
      assert.ok(responses.has(path), `unexpected check request: ${path}`);
      return responses.get(path);
    },
    sourceRunAttempt: 2,
    sourceRunId: 998877,
    sourceWorkflow: "Dependabot Processor",
  });
  assert.deepEqual(checks, [
    {
      check: currentCheck,
      pull: {
        head: { ref: receipt.headRef, sha: headSha },
        number: 731,
      },
    },
  ]);
  assert.deepEqual(requestedPaths, [
    `${refreshPrefix}1`,
    `${refreshPrefix}2`,
    processorPath,
  ]);
  assert.ok(requestedPaths.every((path) => path.includes("check_name=")));
});

test("terminal lookup fails closed when exact-name checks exceed its page cap", async () => {
  const receipt = requestedRefreshReceipt();
  const requestedPages = [];
  await assert.rejects(
    collectTerminalSourceChecks({
      pulls: [
        {
          head: { ref: receipt.headRef, sha: headSha },
          number: receipt.pullRequestNumber,
        },
      ],
      repositoryName: repository,
      requestJson: async (path) => {
        const page = Number(
          new URL(`https://github.invalid${path}`).searchParams.get("page"),
        );
        requestedPages.push(page);
        return {
          check_runs: Array.from({ length: 100 }, (_, index) => ({
            details_url: `https://github.com/${repository}/actions/runs/${page * 100 + index + 1}`,
            external_id: `historical:run=${page * 100 + index + 1}:attempt=1`,
            id: page * 100 + index + 1,
            name: "Dependabot Refresh",
          })),
          total_count: 1_001,
        };
      },
      sourceRunAttempt: 2,
      sourceRunId: 998877,
      sourceWorkflow: "Dependabot Processor",
    }),
    /named check collection is incomplete/,
  );
  assert.deepEqual(requestedPages, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

test("processor packet permits feedback-only repair but rejects empty authority", () => {
  assert.equal(validateProcessorRepairPacket(repairPacket()).preparable, true);
  assert.throws(
    () =>
      validateProcessorRepairPacket(
        repairPacket({ failures: [], feedbackThreads: [], findings: [] }),
      ),
    /no actionable/,
  );
  assert.throws(
    () =>
      validateProcessorRepairPacket(
        repairPacket({ expectedBlobs: [{ path: "x", sha: "e".repeat(40) }] }),
      ),
    /keys are not exact/,
  );
  const providerFailure = repairPacket({
    failures: [
      {
        attribution: "branch",
        detailsUrl: `https://github.com/${repository}/actions/runs/11`,
        id: "action-pins",
        name: "Action Pin Policy",
      },
    ],
  });
  providerFailure.failures[0].attribution = "provider-baseline";
  assert.throws(
    () => validateProcessorRepairPacket(providerFailure),
    /not branch-attributed/,
  );
});

test("Prepare App ref mutations reject the protected workflow authority graph", () => {
  for (const path of [
    ".github/workflows/ci.yml",
    ".github/workflows/e2e.yml",
    ".github/workflows/quality-budgets.yml",
    ".github/workflows/visual.yml",
    ".github/actions/pnpm-install/action.yml",
  ]) {
    assert.equal(prepareRefMutationForbiddenPath(path), true, path);
    assert.throws(
      () =>
        validateProcessorRepairPacket(repairPacket({ changedPaths: [path] })),
      /cannot authorize a ref move for automation authority paths/,
      path,
    );
  }
  for (const path of [
    "package.json",
    "pnpm-lock.yaml",
    "apps/app.mento.org/package.json",
  ]) {
    assert.equal(prepareRefMutationForbiddenPath(path), false, path);
  }
});

test("protected-runtime v3 packets permit empty repair evidence only under the exact typed contract", () => {
  const packet = protectedRuntimePacket();
  assert.equal(validateProcessorRepairPacket(packet), packet);
  assert.equal(packet.failures.length, 0);

  assert.throws(
    () =>
      validateProcessorRepairPacket({
        ...packet,
        schema: PROCESSOR_PACKET_SCHEMA_V2,
      }),
    /keys are not exact/,
  );

  const invalidPackets = [
    {
      label: "operation key",
      mutate(value) {
        value.operation.untrusted = true;
      },
    },
    {
      label: "operation schema",
      mutate(value) {
        value.operation.schema = "dependabot-protected-runtime-sync:v2";
      },
    },
    {
      label: "dependency",
      mutate(value) {
        value.operation.dependency = "next";
      },
    },
    {
      label: "major target",
      mutate(value) {
        value.operation.targetVersion = "57.0.0";
        value.operation.updateType = "major";
        value.updateType = "major";
      },
    },
    {
      label: "required path",
      mutate(value) {
        value.operation.requiredPaths = [
          ...value.operation.requiredPaths,
          "scripts/vercel-cli-runtime/extra.json",
        ];
      },
    },
    {
      label: "input order",
      mutate(value) {
        value.operation.inputPaths = [...value.operation.inputPaths].reverse();
      },
    },
    {
      label: "missing expected blob",
      mutate(value) {
        value.expectedBlobs = value.expectedBlobs.slice(1);
      },
    },
    {
      label: "extra permitted path",
      mutate(value) {
        value.permittedPaths = [...value.permittedPaths, "scripts/**"];
      },
    },
    {
      label: "runtime wildcard denial",
      mutate(value) {
        value.forbiddenPaths = [
          ...value.forbiddenPaths.slice(0, 5),
          "**/runtime/**",
          ...value.forbiddenPaths.slice(5),
        ];
      },
    },
    {
      label: "change cap",
      mutate(value) {
        value.limits.maxChanges = 159;
      },
    },
  ];
  for (const { label, mutate } of invalidPackets) {
    const value = structuredClone(packet);
    mutate(value);
    assert.throws(() => validateProcessorRepairPacket(value), undefined, label);
  }
});

test("Next catalog-sync v3 packets accept only the exact typed contract", () => {
  const packet = nextCatalogPacket();
  assert.equal(validateProcessorRepairPacket(packet), packet);
  assert.equal(packet.failures.length, 0);

  const invalidPackets = [
    {
      label: "operation identity",
      expected: /Next catalog sync identity is invalid/,
      mutate(value) {
        value.operation.dependency = "react";
      },
    },
    {
      label: "operation kind",
      expected: /limits\.maxChanges/,
      mutate(value) {
        value.operation.kind = "unknown-catalog-sync";
      },
    },
    {
      label: "operation schema",
      expected: /Next catalog sync identity is invalid/,
      mutate(value) {
        value.operation.schema = "dependabot-protected-runtime-sync:v2";
      },
    },
    {
      label: "package ecosystem",
      expected: /Next catalog sync identity is invalid/,
      mutate(value) {
        value.packageEcosystem = "github-actions";
      },
    },
    {
      label: "pnpm identity",
      expected: /Next catalog sync identity is invalid/,
      mutate(value) {
        value.operation.pnpmVersion = "10.34.3";
      },
    },
    {
      label: "resolution mode",
      expected: /Next catalog sync identity is invalid/,
      mutate(value) {
        value.operation.resolutionMode = "highest";
      },
    },
    {
      label: "operation source identity",
      expected: /operation\.sourceSeedHeadSha is invalid/,
      mutate(value) {
        value.operation.sourceSeedHeadSha = "not-a-sha";
      },
    },
    {
      label: "dependency group",
      expected: /Next catalog sync identity is invalid/,
      mutate(value) {
        value.dependencyGroup = "tooling";
      },
    },
    {
      label: "dependency names",
      expected: /Next catalog sync identity is invalid/,
      mutate(value) {
        value.dependencyNames = ["next", "react"];
      },
    },
    {
      label: "risk tier",
      expected: /typed npm risk tier is invalid/,
      mutate(value) {
        value.riskTier = "automatic";
      },
    },
    {
      label: "required gates",
      expected: /requiredGateIds is not the exact/,
      mutate(value) {
        value.requiredGateIds = value.requiredGateIds.slice(1);
      },
    },
    {
      label: "validation commands",
      expected: /validationCommands is not the exact/,
      mutate(value) {
        value.validationCommands = value.validationCommands.slice(0, -1);
      },
    },
    {
      label: "required path",
      expected: /operation\.requiredPaths is not the exact/,
      mutate(value) {
        value.operation.requiredPaths = value.operation.requiredPaths.slice(1);
      },
    },
    {
      label: "input path order",
      expected: /operation\.inputPaths is not the exact/,
      mutate(value) {
        value.operation.inputPaths = [...value.operation.inputPaths].reverse();
      },
    },
    {
      label: "permitted path",
      expected: /permittedPaths is not the exact/,
      mutate(value) {
        value.permittedPaths = value.permittedPaths.slice(0, -1);
      },
    },
    {
      label: "forbidden path",
      expected: /forbiddenPaths is not the exact/,
      mutate(value) {
        value.forbiddenPaths = [...value.forbiddenPaths].reverse();
      },
    },
    {
      label: "expected input blob",
      expected: /expectedBlobs do not cover the exact typed-operation inputs/,
      mutate(value) {
        value.expectedBlobs = value.expectedBlobs.slice(1);
      },
    },
    {
      label: "from specifier",
      expected: /Next catalog sync identity is invalid/,
      mutate(value) {
        value.operation.fromSpecifier = "16.2.12";
      },
    },
    {
      label: "target specifier",
      expected: /Next catalog sync identity is invalid/,
      mutate(value) {
        value.operation.targetSpecifier = "^16.3.0";
      },
    },
    {
      label: "major version",
      expected: /Next catalog sync version transition is invalid/,
      mutate(value) {
        value.operation.targetSpecifier = "^17.0.0";
        value.operation.targetVersion = "17.0.0";
        value.operation.updateType = "major";
        value.updateType = "major";
      },
    },
    {
      label: "version downgrade",
      expected: /Next catalog sync version transition is invalid/,
      mutate(value) {
        value.operation.targetSpecifier = "^16.1.0";
        value.operation.targetVersion = "16.1.0";
      },
    },
    {
      label: "prerelease version",
      expected: /operation\.targetVersion is invalid/,
      mutate(value) {
        value.operation.targetSpecifier = "^16.3.1-rc.1";
        value.operation.targetVersion = "16.3.1-rc.1";
      },
    },
    {
      label: "update type",
      expected: /Next catalog sync version transition is invalid/,
      mutate(value) {
        value.operation.updateType = "patch";
      },
    },
    ...[
      ["maxAddedLines", 599],
      ["maxBytes", 64 * 1024 - 1],
      ["maxChanges", 1_199],
      ["maxDeletedLines", 599],
      ["maxFiles", nextCatalogRequiredPaths.length - 1],
    ].map(([key, replacement]) => ({
      label: `limit ${key}`,
      expected: /Next catalog sync limits are invalid/,
      mutate(value) {
        value.limits[key] = replacement;
      },
    })),
  ];

  for (const { expected, label, mutate } of invalidPackets) {
    const value = structuredClone(packet);
    mutate(value);
    assert.throws(() => validateProcessorRepairPacket(value), expected, label);
  }

  const unknownKind = structuredClone(packet);
  unknownKind.operation.kind = "unknown-catalog-sync";
  unknownKind.limits.maxChanges = 160;
  assert.throws(
    () => validateProcessorRepairPacket(unknownKind),
    /typed operation kind is invalid/,
    "an unknown typed operation kind is rejected after generic v3 limits pass",
  );
});

test("repair plan patch caps remain narrow for v2 and permit a large typed Next lock patch", () => {
  const v2Packet = repairPacket();
  const v2Edit = {
    expectedBlobSha: "e".repeat(40),
    patch: "x".repeat(8 * 1024),
    path: "scripts/fixtures/action-pins/ci.yml",
  };
  assert.equal(
    validateRepairPlan(repairPlanFor(v2Packet, [v2Edit]), {
      packet: v2Packet,
      packetDigest,
      processorCheckId: 444,
    }).edits[0].patch.length,
    8 * 1024,
  );
  assert.throws(
    () =>
      validateRepairPlan(
        repairPlanFor(v2Packet, [
          { ...v2Edit, patch: "x".repeat(8 * 1024 + 1) },
        ]),
        { packet: v2Packet, packetDigest, processorCheckId: 444 },
      ),
    /edits\[0\]\.patch is oversized/,
  );

  const nextPacket = nextCatalogPacket();
  const largeLockEdit = {
    expectedBlobSha: "e".repeat(40),
    patch: "x".repeat(41 * 1024),
    path: "pnpm-lock.yaml",
  };
  assert.equal(
    validateRepairPlan(repairPlanFor(nextPacket, [largeLockEdit]), {
      packet: nextPacket,
      packetDigest,
      processorCheckId: 444,
    }).edits[0].patch.length,
    41 * 1024,
  );
  assert.throws(
    () =>
      validateRepairPlan(
        repairPlanFor(nextPacket, [
          { ...largeLockEdit, patch: "x".repeat(48 * 1024 + 1) },
        ]),
        { packet: nextPacket, packetDigest, processorCheckId: 444 },
      ),
    /edits\[0\]\.patch is oversized/,
  );

  assert.throws(
    () =>
      validateRepairPlan(
        repairPlanFor(nextPacket, [
          { ...largeLockEdit, patch: "é".repeat(24 * 1024 + 1) },
        ]),
        { packet: nextPacket, packetDigest, processorCheckId: 444 },
      ),
    /edits\[0\]\.patch is oversized/,
  );

  const aggregateEdits = ["package.json", "pnpm-lock.yaml"].map((path) => ({
    expectedBlobSha: "e".repeat(40),
    patch: "x".repeat(33 * 1024),
    path,
  }));
  assert.throws(
    () =>
      validateRepairPlan(repairPlanFor(nextPacket, aggregateEdits), {
        packet: nextPacket,
        packetDigest,
        processorCheckId: 444,
      }),
    /repair plan is too large/,
  );
});

test("v3 operation authority remains transitively bound through unchanged repair receipts", () => {
  const digest = canonicalDigest(protectedRuntimePacket());
  const intent = validateRepairIntent(
    repairIntent({
      headRef: "dependabot/npm_and_yarn/tooling-123",
      packetDigest: digest,
    }),
  );
  const receipt = validateRepairReceipt(
    repairReceipt({
      headRef: intent.headRef,
      packetDigest: digest,
    }),
  );
  assert.equal(intent.packetDigest, digest);
  assert.equal(receipt.packetDigest, digest);
  assert.match(
    repairIntentExternalId(intent),
    new RegExp(`digest=[0-9a-f]{64}`),
  );
  assert.match(operationExternalId(receipt), /dependabot-repair:v1/);
});

test("repair plans bind packet paths and carry only bounded patches and digests", () => {
  const packet = repairPacket();
  const plan = {
    attempt: 1,
    baseSha,
    edits: [
      {
        expectedBlobSha: "e".repeat(40),
        patch:
          "--- a/scripts/fixtures/action-pins/ci.yml\n+++ b/scripts/fixtures/action-pins/ci.yml\n@@ -1 +1 @@\n-old\n+new\n",
        path: "scripts/fixtures/action-pins/ci.yml",
      },
    ],
    packetDigest,
    parentHeadSha: headSha,
    processorCheckId: 444,
    pullRequestNumber: 731,
    repository,
    schema: "dependabot-repair-plan:v1",
    summary: "Update the reviewed action-pin fixture.",
  };
  assert.equal(
    validateRepairPlan(plan, {
      packet,
      packetDigest,
      processorCheckId: 444,
    }).edits.length,
    1,
  );
  const validated = {
    ...plan,
    edits: [
      {
        ...plan.edits[0],
        contentDigest: "8".repeat(64),
        mode: "100644",
        type: "blob",
      },
    ],
    schema: "dependabot-validated-repair-plan:v1",
  };
  assert.equal(
    validateValidatedRepairPlan(validated, {
      packet,
      packetDigest,
      processorCheckId: 444,
    }).edits[0].contentDigest,
    "8".repeat(64),
  );
  assert.equal(Object.hasOwn(validated.edits[0], "contentBase64"), false);
  assert.throws(
    () =>
      validateRepairPlan(
        {
          ...plan,
          edits: [{ ...plan.edits[0], path: ".github/workflows/ci.yml" }],
        },
        { packet, packetDigest, processorCheckId: 444 },
      ),
    /hard-denied|packet-denied|outside packet allowlist/,
  );
});

test("v2 npm repair plans preserve Dependabot-changed declarations", () => {
  const blobs = new Map([
    ["package.json", "1".repeat(40)],
    ["pnpm-lock.yaml", "2".repeat(40)],
    ["pnpm-workspace.yaml", "3".repeat(40)],
  ]);
  const packet = repairPacket({
    changedPaths: ["pnpm-lock.yaml", "pnpm-workspace.yaml"],
    dependencyGroup: "frontend-core",
    dependencyNames: ["next"],
    expectedBlobs: [...blobs].map(([path, sha]) => ({
      mode: "100644",
      path,
      sha,
      type: "blob",
    })),
    failures: [
      {
        attribution: "branch",
        detailsUrl: `https://github.com/${repository}/actions/runs/11/job/12`,
        id: "supply-chain-version-skew",
        name: "catalog version-skew",
      },
    ],
    findings: [],
    headRef: "dependabot/npm_and_yarn/frontend-core-123",
    packageEcosystem: "npm",
    permittedPaths: ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"],
    riskTier: "human-merge-npm",
    updateType: "minor",
  });
  const plan = {
    attempt: 1,
    baseSha,
    edits: [
      {
        expectedBlobSha: blobs.get("package.json"),
        patch:
          '--- a/package.json\n+++ b/package.json\n@@ -1 +1 @@\n-  "next": "^16.2.12"\n+  "next": "^16.3.1"\n',
        path: "package.json",
      },
      {
        expectedBlobSha: blobs.get("pnpm-lock.yaml"),
        patch:
          "--- a/pnpm-lock.yaml\n+++ b/pnpm-lock.yaml\n@@ -1 +1 @@\n-  next: ^16.2.12\n+  next: ^16.3.1\n",
        path: "pnpm-lock.yaml",
      },
    ],
    packetDigest,
    parentHeadSha: headSha,
    processorCheckId: 444,
    pullRequestNumber: packet.pullRequestNumber,
    repository,
    schema: "dependabot-repair-plan:v1",
    summary: "Align the unchanged override and generated lockfile.",
  };

  assert.deepEqual(
    validateRepairPlan(plan, {
      packet,
      packetDigest,
      processorCheckId: 444,
    }).edits.map(({ path }) => path),
    ["package.json", "pnpm-lock.yaml"],
  );
  assert.throws(
    () =>
      validateRepairPlan(
        {
          ...plan,
          edits: [
            {
              expectedBlobSha: blobs.get("pnpm-workspace.yaml"),
              patch:
                "--- a/pnpm-workspace.yaml\n+++ b/pnpm-workspace.yaml\n@@ -1 +1 @@\n-  next: ^16.3.1\n+  next: ^16.2.12\n",
              path: "pnpm-workspace.yaml",
            },
          ],
          summary: "Reverse the Dependabot catalog update.",
        },
        { packet, packetDigest, processorCheckId: 444 },
      ),
    /rewrites a Dependabot-changed dependency declaration: pnpm-workspace\.yaml/,
  );
});

test("repair patch budgets count hunk content with diff-header prefixes", () => {
  const path = "scripts/fixtures/action-pins/ci.yml";
  const patch = `--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n---old\n+++new\n`;
  assert.deepEqual(
    validateRepairPatch({
      patch,
      path,
    }),
    {
      addedLines: 1,
      bytes: Buffer.byteLength(patch),
      changes: 2,
      deletedLines: 1,
    },
  );
});

test("repair validator rejects one-sided hunks and accepts exact trailing context", async () => {
  const path = "pnpm-lock.yaml";
  const original = [
    "importers:",
    "  .:",
    "    devDependencies:",
    "      typescript-eslint:",
    "        version: 8.65.0(eslint@9.39.2)(typescript@5.9.3)",
    "      vercel:",
    "        specifier: 56.5.0",
    "        version: 56.5.0(@vercel/container@0.0.5)",
    "      yaml:",
    "        specifier: 2.9.0",
    "",
  ].join("\n");
  const expectedBlobSha = gitBlobSha(original);
  const packet = repairPacket({
    changedPaths: [path],
    expectedBlobs: [
      { mode: "100644", path, sha: expectedBlobSha, type: "blob" },
    ],
    permittedPaths: [path],
  });
  const treeSha = "2".repeat(40);
  const oneSidedPatch = `--- a/${path}\n+++ b/${path}\n@@ -5,4 +5,4 @@\n         version: 8.65.0(eslint@9.39.2)(typescript@5.9.3)\n       vercel:\n-        specifier: 56.5.0\n-        version: 56.5.0(@vercel/container@0.0.5)\n+        specifier: 56.4.1\n+        version: 56.4.1(@vercel/container@0.0.5)\n`;
  const contextualPatch = oneSidedPatch
    .replace("@@ -5,4 +5,4 @@", "@@ -5,5 +5,5 @@")
    .concat("       yaml:\n");
  const malformedHunkCountPatch = contextualPatch.replace(
    "@@ -5,5 +5,5 @@",
    "@@ -5,6 +5,6 @@",
  );
  const missingContextMarkersPatch = contextualPatch
    .replace("         version: 8.65.0", "        version: 8.65.0")
    .replace("       vercel:", "      vercel:")
    .replace("       yaml:", "      yaml:");
  assert.deepEqual(validateRepairPatch({ patch: oneSidedPatch, path }), {
    addedLines: 2,
    bytes: Buffer.byteLength(oneSidedPatch),
    changes: 4,
    deletedLines: 2,
  });

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      const pathName = new URL(url).pathname;
      const body = pathName.endsWith(`/git/commits/${headSha}`)
        ? { tree: { sha: treeSha } }
        : pathName.endsWith(`/git/trees/${treeSha}`)
          ? {
              tree: [
                { mode: "100644", path, sha: expectedBlobSha, type: "blob" },
              ],
              truncated: false,
            }
          : pathName.endsWith(`/git/blobs/${expectedBlobSha}`)
            ? {
                content: Buffer.from(original).toString("base64"),
                encoding: "base64",
                sha: expectedBlobSha,
                size: Buffer.byteLength(original),
              }
            : assert.fail(`unexpected Git blob request: ${pathName}`);
      return new Response(JSON.stringify(body), { status: 200 });
    };
    await assert.rejects(
      applyRepairPlan({
        packet,
        plan: { edits: [{ expectedBlobSha, patch: oneSidedPatch, path }] },
        repositoryName: repository,
        token: "read-token",
      }),
      /git apply --check --whitespace=error-all.*patch does not apply/s,
    );
    await assert.rejects(
      applyRepairPlan({
        packet,
        plan: {
          edits: [{ expectedBlobSha, patch: malformedHunkCountPatch, path }],
        },
        repositoryName: repository,
        token: "read-token",
      }),
      /git apply --check --whitespace=error-all.*corrupt patch/s,
    );
    await assert.rejects(
      applyRepairPlan({
        packet,
        plan: {
          edits: [{ expectedBlobSha, patch: missingContextMarkersPatch, path }],
        },
        repositoryName: repository,
        token: "read-token",
      }),
      /git apply --check --whitespace=error-all.*patch does not apply/s,
    );
    const applied = await applyRepairPlan({
      packet,
      plan: { edits: [{ expectedBlobSha, patch: contextualPatch, path }] },
      repositoryName: repository,
      token: "read-token",
    });
    assert.match(
      applied.edits[0].content.toString(),
      /specifier: 56\.4\.1\n {8}version: 56\.4\.1/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("dispatch payloads stay below GitHub's ten-key client-payload cap", () => {
  const processPayload = validateProcessDispatchPayload({ scope: "open" });
  assert.equal(Object.keys(processPayload).length, 1);
  assert.throws(
    () => validateProcessDispatchPayload({ mode: "prepare", scope: "open" }),
    /keys are not exact/,
  );

  const repair = validateRepairDispatchPayload({
    baseSha,
    headRef: "dependabot/github_actions/actions-checkout-123",
    headSha,
    prNumber: 731,
    processorReceipt: {
      checkId: 444,
      digest: packetDigest,
      workflowRunAttempt: 2,
      workflowRunId: 998877,
      workflowSha,
    },
    repairAttempt: 1,
    repository,
    retryCount: 0,
    schema: "dependabot-prepare-repair:v1",
  });
  assert.equal(Object.keys(repair).length, 9);

  const intent = repairIntent();
  const recovery = validateRepairRecoveryPayload({
    baseSha: intent.baseSha,
    headRef: intent.headRef,
    headSha: intent.headSha,
    intentReceipt: {
      checkId: 771,
      digest: rawDigest(canonicalJson(intent)),
      workflowRunAttempt: intent.workflowRunAttempt,
      workflowRunId: intent.workflowRunId,
      workflowSha: intent.workflowSha,
    },
    parentHeadSha: intent.parentHeadSha,
    prNumber: intent.pullRequestNumber,
    repairAttempt: intent.attempt,
    repository,
    retryCount: 0,
    schema: "dependabot-repair-recovery:v1",
  });
  assert.equal(Object.keys(recovery).length, 10);

  const receipt = repairReceipt();
  const prepared = validatePreparedHeadPayload({
    headRef: receipt.headRef,
    headSha: receipt.headSha,
    operation: "repair",
    operationReceipt: {
      checkId: 555,
      digest: canonicalDigest(receipt),
      externalId: operationExternalId(receipt),
      workflowRunAttempt: receipt.workflowRunAttempt,
      workflowRunId: receipt.workflowRunId,
      workflowSha: receipt.workflowSha,
    },
    parentHeadSha: receipt.parentHeadSha,
    prNumber: receipt.pullRequestNumber,
    prepareApp: {
      botId: receipt.prepareBotId,
      botLogin: receipt.prepareBotLogin,
      slug: receipt.prepareAppSlug,
    },
    repository,
    schema: "dependabot-prepared-head-intake:v1",
  });
  assert.equal(Object.keys(prepared).length, 9);
});

test("terminal dispatcher is inert without App config until an action exists", () => {
  assert.equal(
    terminalActionConfiguration([], {
      prepareAppSlug: "",
      prepareBotId: "",
      prepareBotLogin: "",
    }),
    null,
  );
  assert.throws(
    () =>
      terminalActionConfiguration(
        [{ eventType: "dependabot-prepare-repair", payload: {} }],
        { prepareAppSlug: "", prepareBotId: "", prepareBotLogin: "" },
      ),
    /configured Prepare App slug/,
  );
  assert.throws(
    () =>
      terminalActionConfiguration(
        [
          {
            eventType: "dependabot-process",
            payload: { scope: "open" },
            prepareApp: {
              botId: appIdentity.prepareBotId + 1,
              botLogin: appIdentity.prepareBotLogin,
              slug: appIdentity.prepareAppSlug,
            },
          },
        ],
        {
          prepareAppSlug: appIdentity.prepareAppSlug,
          prepareBotId: String(appIdentity.prepareBotId),
          prepareBotLogin: appIdentity.prepareBotLogin,
        },
      ),
    /does not match configuration/,
  );
});

test("repair publisher source keeps security-critical object keys unique", () => {
  const source = readFileSync(
    new URL("./dependabot-preparation-receipts.mjs", import.meta.url),
    "utf8",
  );
  const receiptPublisher = source.slice(
    source.indexOf("async function commandPublishRepairReceipt"),
    source.indexOf("async function listOpenDependabotPulls"),
  );
  assert.equal(
    [...receiptPublisher.matchAll(/^\s+conclusion:\s*"success",?$/gm)].length,
    1,
  );
  assert.equal([...receiptPublisher.matchAll(/^\s+details_url:/gm)].length, 1);
  const stageBeforeIntent = source.slice(
    source.indexOf("async function commandStageRepair"),
    source.indexOf(
      "const intent = validateRepairIntent",
      source.indexOf("async function commandStageRepair"),
    ),
  );
  assert.doesNotMatch(stageBeforeIntent, /\bintent\./);
  const validatedCall =
    /const validated = validateValidatedRepairPlan\([\s\S]*?\n\s*\{([\s\S]*?)\n\s*\},\n\s*\);/.exec(
      source,
    )?.[1];
  assert.ok(validatedCall);
  assert.equal([...validatedCall.matchAll(/^\s+packetDigest,?$/gm)].length, 1);
});

test("Git patch subprocesses receive only an explicit credential-free environment", () => {
  const credentialEnvironment = Object.fromEntries([
    [["GH", "READ", "TOKEN"].join("_"), ["read", "sentinel"].join("-")],
    [["GH", "WRITE", "TOKEN"].join("_"), ["write", "sentinel"].join("-")],
    [["GITHUB", "TOKEN"].join("_"), ["github", "sentinel"].join("-")],
    ["PATH", "/trusted/bin"],
    [["SENTINEL", "SECRET"].join("_"), ["must", "not", "cross"].join("-")],
  ]);
  const childEnvironment = gitSubprocessEnvironment(
    "/tmp/exact-repair",
    credentialEnvironment,
  );
  assert.deepEqual(childEnvironment, {
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    HOME: "/tmp/exact-repair",
    LANG: "C",
    LC_ALL: "C",
    PATH: "/trusted/bin",
  });
  assert.doesNotMatch(
    JSON.stringify(childEnvironment),
    /sentinel|TOKEN|SECRET/,
  );
});

test("Git blob identity covers bytes above the Contents API inline limit", () => {
  const content = Buffer.alloc(1024 * 1024 + 97, 0x61);
  const expected = createHash("sha1")
    .update(Buffer.from(`blob ${content.byteLength}\0`))
    .update(content)
    .digest("hex");
  assert.equal(gitBlobSha(content), expected);
  content[content.length - 1] = 0x62;
  assert.notEqual(gitBlobSha(content), expected);
});

test("repair validator loads a greater-than-1MiB exact Git blob by object SHA", async () => {
  const path = "pnpm-lock.yaml";
  const original = `${"# filler\n".repeat(140_000)}vercel: 56.5.0\n`;
  assert.ok(Buffer.byteLength(original) > 1024 * 1024);
  const expectedBlobSha = gitBlobSha(original);
  const packet = repairPacket({
    changedPaths: [path],
    expectedBlobs: [
      { mode: "100644", path, sha: expectedBlobSha, type: "blob" },
    ],
    failures: [
      {
        attribution: "branch",
        detailsUrl: `https://github.com/${repository}/actions/runs/11/job/12`,
        id: "ci",
        name: "Build and Test",
      },
    ],
    findings: [],
    limits: {
      maxAddedLines: 20,
      maxBytes: 8192,
      maxChanges: 20,
      maxDeletedLines: 20,
      maxFiles: 2,
    },
    permittedPaths: ["pnpm-lock.yaml"],
  });
  const patch = `--- a/${path}\n+++ b/${path}\n@@ -140001 +140001 @@\n-vercel: 56.5.0\n+vercel: 56.4.1\n`;
  const plan = {
    attempt: 1,
    baseSha,
    edits: [{ expectedBlobSha, patch, path }],
    packetDigest,
    parentHeadSha: headSha,
    processorCheckId: 444,
    pullRequestNumber: packet.pullRequestNumber,
    repository,
    schema: "dependabot-repair-plan:v1",
    summary: "Restore the reviewed Vercel CLI pin.",
  };
  const treeSha = "2".repeat(40);
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      const pathName = new URL(url).pathname;
      const body = pathName.endsWith(`/git/commits/${headSha}`)
        ? { tree: { sha: treeSha } }
        : pathName.endsWith(`/git/trees/${treeSha}`)
          ? {
              tree: [
                { mode: "100644", path, sha: expectedBlobSha, type: "blob" },
              ],
              truncated: false,
            }
          : pathName.endsWith(`/git/blobs/${expectedBlobSha}`)
            ? {
                content: Buffer.from(original).toString("base64"),
                encoding: "base64",
                sha: expectedBlobSha,
                size: Buffer.byteLength(original),
              }
            : assert.fail(`unexpected Git blob request: ${pathName}`);
      return new Response(JSON.stringify(body), { status: 200 });
    };
    const applied = await applyRepairPlan({
      packet,
      plan,
      repositoryName: repository,
      token: "read-token",
    });
    assert.equal(applied.edits.length, 1);
    assert.equal(
      applied.edits[0].content.toString().endsWith("vercel: 56.4.1\n"),
      true,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("pull file evidence binds changed paths independently from repair blobs", async () => {
  const disjointPacket = repairPacket({
    changedPaths: [".github/workflows/ci.yml"],
  });
  const packet = repairPacket({
    changedPaths: ["package.json"],
    expectedBlobs: [
      {
        mode: "100644",
        path: "package.json",
        sha: "e".repeat(40),
        type: "blob",
      },
    ],
  });
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify([
          {
            additions: 1,
            changes: 2,
            deletions: 1,
            filename: ".github/workflows/ci.yml",
            sha: "f".repeat(40),
            status: "modified",
          },
        ]),
        { status: 200 },
      );
    const disjointInventory = await collectExactPullFiles(
      "read-token",
      disjointPacket,
      { changed_files: 1 },
    );
    assert.equal(disjointInventory[0].path, ".github/workflows/ci.yml");
    assert.equal(disjointInventory[0].sha, "f".repeat(40));

    globalThis.fetch = async () =>
      new Response(
        JSON.stringify([
          {
            additions: 1,
            changes: 2,
            deletions: 1,
            filename: "package.json",
            sha: "e".repeat(40),
            status: "modified",
          },
        ]),
        { status: 200 },
      );
    const inventory = await collectExactPullFiles("read-token", packet, {
      changed_files: 1,
    });
    assert.equal(inventory[0].path, "package.json");
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify([
          {
            additions: 1,
            changes: 2,
            deletions: 1,
            filename: "package.json",
            sha: "f".repeat(40),
            status: "modified",
          },
        ]),
        { status: 200 },
      );
    await assert.rejects(
      collectExactPullFiles("read-token", packet, { changed_files: 1 }),
      /does not match the packet/,
    );

    globalThis.fetch = async () =>
      new Response(
        JSON.stringify([
          {
            additions: 1,
            changes: 2,
            deletions: 1,
            filename: "pnpm-lock.yaml",
            sha: "e".repeat(40),
            status: "modified",
          },
        ]),
        { status: 200 },
      );
    await assert.rejects(
      collectExactPullFiles("read-token", packet, { changed_files: 1 }),
      /does not match the packet/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("failure run evidence binds each gate ID to its trusted event and workflow", () => {
  const packet = repairPacket();
  const failure = {
    attribution: "branch",
    detailsUrl: `https://github.com/${repository}/actions/runs/11/job/12`,
    id: "action-pins",
    name: "Actions SHA pinning",
  };
  const run = {
    conclusion: "failure",
    event: "pull_request_target",
    head_repository: { full_name: repository },
    head_sha: packet.headSha,
    id: 11,
    path: ".github/workflows/action-pins.yml@refs/heads/main",
    run_attempt: 1,
    status: "completed",
  };
  assert.equal(validateFailureRun(run, packet, 11, failure), run);
  assert.throws(
    () =>
      validateFailureRun(
        { ...run, event: "pull_request" },
        packet,
        11,
        failure,
      ),
    /provenance is not exact/,
  );
  assert.throws(
    () => validateFailureRun(run, packet, 11, { ...failure, id: "unknown" }),
    /provenance is not exact/,
  );
});

test("job logs follow only credential-free signed Actions or Azure Blob redirects", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const host of [
      "results-receiver.actions.githubusercontent.com",
      "productionresultssa9.blob.core.windows.net",
    ]) {
      const calls = [];
      globalThis.fetch = async (url, options) => {
        calls.push({ options, url: String(url) });
        if (calls.length === 1) {
          return new Response(null, {
            headers: { location: `https://${host}/signed/log?sig=opaque` },
            status: 302,
          });
        }
        return new Response("exact log\n", { status: 200 });
      };
      assert.equal(
        await githubJobLogRequest("read-token", repository, 123),
        "exact log\n",
      );
      assert.match(calls[0].options.headers.Authorization, /^Bearer /);
      assert.deepEqual(calls[1].options.headers, {});
      assert.equal(calls[1].options.redirect, "error");
    }
    for (const location of [
      "https://productionresultssa9.blob.core.windows.net.evil.example/log?sig=x",
      "https://evil.actions.githubusercontent.com/log?sig=x",
      "https://user@productionresultssa9.blob.core.windows.net/log?sig=x",
      "http://productionresultssa9.blob.core.windows.net/log?sig=x",
    ]) {
      globalThis.fetch = async () =>
        new Response(null, { headers: { location }, status: 302 });
      await assert.rejects(
        githubJobLogRequest("read-token", repository, 123),
        /not a signed Actions URL/,
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function jsonResponse(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), { headers, status });
}

function claudePacketFinding(checkId = 777, overrides = {}) {
  const canonical = {
    line: 2,
    path: "package.json",
    summary: "Restore the reviewed Vercel CLI pin.",
    title: "Vercel CLI pin drift",
    ...overrides,
  };
  const findingDigest = canonicalDigest(canonical);
  return {
    checkId,
    digest: findingDigest,
    ...canonical,
    source: "claude",
    sourceId: findingDigest.slice(0, 24),
  };
}

function materializerFixture(overrides = {}) {
  const blobContent = overrides.blobContent ?? '{\n  "vercel": "56.5.0"\n}\n';
  const blobSha = gitBlobSha(blobContent);
  const packet = repairPacket({
    changedPaths: ["package.json"],
    expectedBlobs: [
      { mode: "100644", path: "package.json", sha: blobSha, type: "blob" },
    ],
    failures: [
      {
        attribution: "branch",
        detailsUrl: `https://github.com/${repository}/actions/runs/700/job/701`,
        id: "ci",
        name: "Build and Test",
      },
    ],
    findings: [
      {
        checkId: 77,
        digest: canonicalDigest({
          line: 2,
          path: "package.json",
          summary: "Restore the reviewed Vercel CLI pin.",
          title: "Vercel CLI pin drift",
        }),
        line: 2,
        path: "package.json",
        source: "check",
        sourceId: "ci-pin-drift",
        summary: "Restore the reviewed Vercel CLI pin.",
        title: "Vercel CLI pin drift",
      },
    ],
    permittedPaths: ["package.json"],
    pullRequestNumber: 731,
    workflowRunAttempt: 1,
    workflowRunId: 998877,
    ...overrides.packet,
  });
  const packetText = canonicalJson(packet);
  const digest = rawDigest(packetText);
  const claudeFailure = packet.failures.find(
    ({ id }) => id === "claude-review",
  );
  const claudeFindings = packet.findings.filter(
    ({ source }) => source === "claude",
  );
  const claudeCheckId = claudeFindings[0]?.checkId;
  const claudeRunId = overrides.claudeRunId ?? 702;
  const claudeRunAttempt = overrides.claudeRunAttempt ?? 1;
  const claudeResult = overrides.claudeResult ?? {
    findings: claudeFindings.map(({ line, path, summary, title }) => ({
      line,
      path,
      summary,
      title,
    })),
    headSha: packet.headSha,
    pullRequestNumber: packet.pullRequestNumber,
    repository: packet.repository,
    reviewCompleted: true,
    schema: "dependabot-claude-review-result:v1",
    verdict: "findings",
  };
  const claudeCheck =
    claudeFailure === undefined
      ? null
      : {
          app: { id: 15368, slug: "github-actions" },
          conclusion: "failure",
          details_url: claudeFailure.detailsUrl,
          external_id: `dependabot-claude-review:v1:pr=${packet.pullRequestNumber}:sha=${packet.headSha}:run=${claudeRunId}:attempt=${claudeRunAttempt}`,
          head_sha: packet.headSha,
          id: claudeCheckId,
          name: "claude-review",
          output: { text: canonicalJson(claudeResult) },
          status: "completed",
          ...overrides.claudeCheck,
        };
  const claudeRun = {
    conclusion: "failure",
    display_title: `dependabot-claude-review:v1 | source=dependabot-intake:v1 | repository=${repository} | pr=${packet.pullRequestNumber} | sha=${packet.headSha} | action=synchronize | receipt=true`,
    event: "workflow_run",
    head_branch: "main",
    head_repository: { full_name: repository },
    head_sha: "8".repeat(40),
    id: claudeRunId,
    path: ".github/workflows/dependabot-claude-review.yml",
    repository: { full_name: repository },
    run_attempt: claudeRunAttempt,
    status: "completed",
    ...overrides.claudeRun,
  };
  const processorCheck = {
    app: { id: 15368, slug: "github-actions" },
    conclusion: "failure",
    details_url: `https://github.com/${repository}/actions/runs/${packet.workflowRunId}`,
    external_id: `dependabot-processor:v2:pr=${packet.pullRequestNumber}:head=${packet.headSha}:mode=prepare:repair=${packet.attemptNumber}:packet=true:digest=${digest}:run=${packet.workflowRunId}:attempt=${packet.workflowRunAttempt}`,
    head_sha: packet.headSha,
    id: 444,
    name: "Dependabot Processor",
    output: { text: packetText },
    status: "completed",
  };
  const processorRun = {
    conclusion: "success",
    event: "repository_dispatch",
    head_branch: "main",
    head_repository: { full_name: repository },
    head_sha: packet.workflowSha,
    id: packet.workflowRunId,
    path: ".github/workflows/dependabot-process.yml",
    run_attempt: packet.workflowRunAttempt,
    status: "completed",
  };
  const pull = {
    base: { ref: "main", repo: { full_name: repository }, sha: packet.baseSha },
    changed_files: 1,
    draft: false,
    head: {
      ref: packet.headRef,
      repo: { full_name: repository },
      sha: packet.headSha,
    },
    number: packet.pullRequestNumber,
    state: "open",
    updated_at: "2026-08-13T10:00:00Z",
    user: { login: "dependabot[bot]", type: "Bot" },
  };
  const treeSha = "9".repeat(40);
  const failureRun = {
    conclusion: "failure",
    event: "pull_request",
    head_branch: packet.headRef,
    head_repository: { full_name: repository },
    head_sha: packet.headSha,
    id: 700,
    path: ".github/workflows/ci.yml",
    run_attempt: 1,
    status: "completed",
  };
  const jobs = {
    jobs: [
      {
        conclusion: "failure",
        head_sha: packet.headSha,
        html_url: `https://github.com/${repository}/actions/runs/700/job/701`,
        id: 701,
        name: "Build and Test",
        run_attempt: 1,
        run_id: 700,
        run_url: `https://api.github.com/repos/${repository}/actions/runs/700`,
        status: "completed",
      },
    ],
    total_count: 1,
  };
  const feedbackThread = packet.feedbackThreads[0] ?? null;
  const feedbackBody =
    overrides.feedbackBody ?? "The protected runtime is not synchronized.\n";
  const feedbackLogin =
    feedbackThread?.source === "codex"
      ? "chatgpt-codex-connector"
      : `${feedbackThread?.source ?? "cursor"}[bot]`;
  const feedbackComment =
    feedbackThread === null
      ? null
      : {
          body: feedbackBody,
          commit_id: packet.headSha,
          id: feedbackThread.commentId,
          in_reply_to_id: null,
          line: feedbackThread.line,
          original_commit_id: feedbackThread.commitSha,
          path: feedbackThread.path,
          pull_request_url: `https://api.github.com/repos/${repository}/pulls/${packet.pullRequestNumber}`,
          user: { login: feedbackLogin, type: "Bot" },
          ...overrides.feedbackComment,
        };
  let livePullReads = 0;
  const fetch = async (url, options = {}) => {
    const parsed = new URL(url);
    if (parsed.hostname === "productionresultssa9.blob.core.windows.net") {
      return new Response("CI failed: expected Vercel 56.4.1\n", {
        status: 200,
      });
    }
    const path = `${parsed.pathname}${parsed.search}`;
    if (path === `/repos/${repository}/check-runs/444`)
      return jsonResponse(processorCheck);
    if (
      claudeCheck !== null &&
      path === `/repos/${repository}/check-runs/${claudeCheckId}`
    )
      return jsonResponse(claudeCheck);
    if (path === `/repos/${repository}/actions/runs/${packet.workflowRunId}`)
      return jsonResponse(processorRun);
    if (
      claudeCheck !== null &&
      path === `/repos/${repository}/actions/runs/${claudeRunId}`
    )
      return jsonResponse({
        ...claudeRun,
        ...overrides.claudeLatestRun,
      });
    if (
      claudeCheck !== null &&
      path ===
        `/repos/${repository}/actions/runs/${claudeRunId}/attempts/${claudeRunAttempt}`
    )
      return jsonResponse(claudeRun);
    if (path === `/repos/${repository}/pulls/${packet.pullRequestNumber}`) {
      const accept = options.headers?.Accept;
      if (accept === "application/vnd.github.v3.diff") {
        return new Response(
          "diff --git a/package.json b/package.json\n--- a/package.json\n+++ b/package.json\n@@ -1 +1 @@\n-old\n+new\n",
          { status: 200 },
        );
      }
      livePullReads += 1;
      return jsonResponse(
        livePullReads === 2 && overrides.finalPull
          ? { ...pull, ...overrides.finalPull }
          : pull,
      );
    }
    if (
      path ===
      `/repos/${repository}/pulls/${packet.pullRequestNumber}/files?per_page=100&page=1`
    ) {
      return jsonResponse([
        {
          additions: 1,
          changes: 2,
          deletions: 1,
          filename: "package.json",
          sha: overrides.fileSha ?? blobSha,
          status: "modified",
        },
      ]);
    }
    if (path === `/repos/${repository}/git/commits/${packet.headSha}`)
      return jsonResponse({ tree: { sha: treeSha } });
    if (path === `/repos/${repository}/git/trees/${treeSha}?recursive=1`)
      return jsonResponse({
        tree: [
          { mode: "100644", path: "package.json", sha: blobSha, type: "blob" },
        ],
        truncated: false,
      });
    if (path === `/repos/${repository}/git/blobs/${blobSha}`)
      return jsonResponse({
        content: Buffer.from(blobContent).toString("base64"),
        encoding: "base64",
        sha: blobSha,
        size: Buffer.byteLength(blobContent),
      });
    if (path === `/repos/${repository}/actions/runs/700`)
      return jsonResponse(failureRun);
    if (
      feedbackComment !== null &&
      path === `/repos/${repository}/pulls/comments/${feedbackThread.commentId}`
    )
      return jsonResponse(feedbackComment);
    if (
      path ===
      `/repos/${repository}/actions/runs/700/attempts/1/jobs?per_page=100&page=1`
    )
      return jsonResponse(jobs);
    if (path === `/repos/${repository}/actions/jobs/701/logs`) {
      assert.equal(options.redirect, "manual");
      return new Response(null, {
        headers: {
          location:
            "https://productionresultssa9.blob.core.windows.net/exact/log?sig=opaque",
        },
        status: 302,
      });
    }
    return assert.fail(`unexpected materializer request: ${path}`);
  };
  return { digest, fetch, packet, packetText };
}

test("materializer seals an exact packet, diff, blob, failed log, and manifest", async () => {
  const fixture = materializerFixture({
    blobContent: `{\n  "current-tooling-script": "${"x".repeat(1_040)}"\n}\n`,
  });
  const temporary = mkdtempSync(
    join(tmpdir(), "dependabot-repair-materialize-"),
  );
  const outputRoot = join(temporary, "evidence");
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = fixture.fetch;
    const result = await materializeRepairEvidence({
      outputRoot,
      packetDigest: fixture.digest,
      packetText: fixture.packetText,
      processorCheckId: 444,
      repositoryName: repository,
      token: "read-token",
    });
    const manifestText = readFileSync(result.manifestPath, "utf8");
    assert.equal(result.manifestDigest, rawDigest(manifestText));
    assert.match(manifestText, /^\{\n {2}"baseSha":/);
    assert.equal(
      JSON.parse(manifestText).schema,
      "dependabot-repair-evidence:v1",
    );
    assert.equal(result.manifest.files.length, 8);
    assert.deepEqual(
      result.manifest.files.map(({ name }) => name),
      [
        "blob-000.txt",
        "failure-index.json",
        "feedback-index.json",
        "findings.json",
        "job-log-000.txt",
        "packet.json",
        "pull-file-inventory.json",
        "pull-request-diff.patch",
      ],
    );
    for (const entry of result.manifest.files) {
      const stats = await import("node:fs").then(({ statSync }) =>
        statSync(join(outputRoot, entry.name)),
      );
      assert.equal(stats.mode & 0o777, 0o400);
      const bytes = readFileSync(join(outputRoot, entry.name));
      assert.equal(bytes.length, entry.bytes);
      assert.equal(rawDigest(bytes), entry.digest);
    }
    assert.doesNotMatch(
      JSON.stringify(
        result.manifest.files.find(({ name }) => name === "job-log-000.txt")
          .source,
      ),
      /Bearer|read-token/,
    );
    assert.equal(
      JSON.parse(readFileSync(join(outputRoot, "findings.json"), "utf8"))[0]
        .title,
      "Vercel CLI pin drift",
    );
    assert.deepEqual(
      JSON.parse(readFileSync(join(outputRoot, "feedback-index.json"), "utf8")),
      [],
    );
    assert.equal(
      JSON.parse(readFileSync(join(outputRoot, "packet.json"), "utf8")).headSha,
      fixture.packet.headSha,
    );
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(temporary, { force: true, recursive: true });
  }
});

test("materializer keeps immutable feedback provenance across a refreshed head", async () => {
  const body = "The protected runtime is not synchronized.\n";
  const originalCommitSha = "f".repeat(40);
  const thread = {
    commentId: 3783646660,
    commitSha: originalCommitSha,
    digest: rawDigest(body),
    line: 77,
    path: "package.json",
    source: "cursor",
    threadId: "PRRT_kwDOObNo886ZRNj6",
  };
  const fixture = materializerFixture({
    feedbackBody: body,
    packet: { feedbackThreads: [thread] },
  });
  const temporary = mkdtempSync(
    join(tmpdir(), "dependabot-repair-materialize-feedback-refresh-"),
  );
  const outputRoot = join(temporary, "evidence");
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = fixture.fetch;
    const result = await materializeRepairEvidence({
      outputRoot,
      packetDigest: fixture.digest,
      packetText: fixture.packetText,
      processorCheckId: 444,
      repositoryName: repository,
      token: "read-token",
    });
    assert.equal(
      readFileSync(join(outputRoot, "feedback-body-000.txt"), "utf8"),
      body,
    );
    assert.deepEqual(
      JSON.parse(readFileSync(join(outputRoot, "feedback-index.json"), "utf8")),
      [thread],
    );
    assert.ok(
      result.manifest.files.some(
        ({ name }) => name === "feedback-body-000.txt",
      ),
    );
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(temporary, { force: true, recursive: true });
  }
});

test("materializer rejects changed original feedback provenance after refresh", async () => {
  const body = "The protected runtime is not synchronized.\n";
  const thread = {
    commentId: 3783646660,
    commitSha: "f".repeat(40),
    digest: rawDigest(body),
    line: 77,
    path: "package.json",
    source: "cursor",
    threadId: "PRRT_kwDOObNo886ZRNj6",
  };
  for (const feedbackComment of [
    { original_commit_id: "0".repeat(40) },
    { commit_id: "1".repeat(40) },
  ]) {
    const fixture = materializerFixture({
      feedbackBody: body,
      feedbackComment,
      packet: { feedbackThreads: [thread] },
    });
    const temporary = mkdtempSync(
      join(tmpdir(), "dependabot-repair-materialize-feedback-reject-"),
    );
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = fixture.fetch;
      await assert.rejects(
        materializeRepairEvidence({
          outputRoot: join(temporary, "evidence"),
          packetDigest: fixture.digest,
          packetText: fixture.packetText,
          processorCheckId: 444,
          repositoryName: repository,
          token: "read-token",
        }),
        /feedbackThreads\[0\] body or provenance changed/,
      );
    } finally {
      globalThis.fetch = originalFetch;
      rmSync(temporary, { force: true, recursive: true });
    }
  }
});

test("materializer authenticates exact Claude findings without weakening failed-job logs", async () => {
  const claudeFinding = claudePacketFinding();
  const fixture = materializerFixture({
    packet: {
      failures: [
        {
          attribution: "branch",
          detailsUrl: `https://github.com/${repository}/runs/${claudeFinding.checkId}`,
          id: "claude-review",
          name: "claude-review",
        },
      ],
      findings: [claudeFinding],
    },
  });
  const temporary = mkdtempSync(
    join(tmpdir(), "dependabot-repair-materialize-claude-"),
  );
  const outputRoot = join(temporary, "evidence");
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = fixture.fetch;
    const result = await materializeRepairEvidence({
      outputRoot,
      packetDigest: fixture.digest,
      packetText: fixture.packetText,
      processorCheckId: 444,
      repositoryName: repository,
      token: "read-token",
    });
    assert.deepEqual(
      result.manifest.files.map(({ name }) => name),
      [
        "blob-000.txt",
        "failure-index.json",
        "feedback-index.json",
        "findings.json",
        "packet.json",
        "pull-file-inventory.json",
        "pull-request-diff.patch",
      ],
    );
    assert.deepEqual(
      JSON.parse(readFileSync(join(outputRoot, "failure-index.json"), "utf8")),
      [
        {
          checkId: claudeFinding.checkId,
          checkName: "claude-review",
          detailsUrl: `https://github.com/${repository}/runs/${claudeFinding.checkId}`,
          externalId: `dependabot-claude-review:v1:pr=731:sha=${headSha}:run=702:attempt=1`,
          failureId: "claude-review",
          kind: "review-findings",
          runAttempt: 1,
          runId: 702,
          workflowHeadSha: "8".repeat(40),
          workflowPath: ".github/workflows/dependabot-claude-review.yml",
        },
      ],
    );
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(temporary, { force: true, recursive: true });
  }
});

test("materializer binds Claude findings to the exact check and historical run attempt", async () => {
  const claudeFinding = claudePacketFinding();
  for (const { claudeRun, detailsUrl } of [
    {
      detailsUrl: `https://github.com/${repository}/actions/runs/702`,
    },
    {
      claudeRun: {
        display_title: `dependabot-claude-review:v1 | source=dependabot-prepared-head:v1|p=731|h=${headSha}|o=r|c=444|d=${"d".repeat(64)}|ok=true`,
      },
      detailsUrl: `https://github.com/${repository}/runs/${claudeFinding.checkId}`,
    },
  ]) {
    const fixture = materializerFixture({
      claudeLatestRun: { run_attempt: 2 },
      claudeRun,
      packet: {
        failures: [
          {
            attribution: "branch",
            detailsUrl,
            id: "claude-review",
            name: "claude-review",
          },
        ],
        findings: [claudeFinding],
      },
    });
    const temporary = mkdtempSync(
      join(tmpdir(), "dependabot-repair-materialize-claude-attempt-"),
    );
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = fixture.fetch;
      await materializeRepairEvidence({
        outputRoot: join(temporary, "evidence"),
        packetDigest: fixture.digest,
        packetText: fixture.packetText,
        processorCheckId: 444,
        repositoryName: repository,
        token: "read-token",
      });
    } finally {
      globalThis.fetch = originalFetch;
      rmSync(temporary, { force: true, recursive: true });
    }
  }
});

test("materializer rejects inexact Claude finding provenance and ordinary run URLs", async () => {
  const claudeFinding = claudePacketFinding();
  const cases = [
    {
      packet: {
        failures: [
          {
            attribution: "branch",
            detailsUrl: `https://github.com/${repository}/actions/runs/700`,
            id: "ci",
            name: "Build and Test",
          },
        ],
      },
      pattern: /no exact Actions job URL/,
    },
    {
      claudeCheck: { app: { id: 1, slug: "github-actions" } },
      pattern: /check provenance is not exact/,
    },
    {
      claudeCheck: {
        external_id: `dependabot-claude-review:v1:pr=999:sha=${headSha}:run=702:attempt=1`,
      },
      pattern: /check provenance is not exact/,
    },
    {
      claudeCheck: {
        details_url: `https://github.com/${repository}/runs/${claudeFinding.checkId + 1}`,
      },
      pattern: /check provenance is not exact/,
    },
    {
      claudeCheck: {
        output: {
          text: JSON.stringify({
            verdict: "findings",
            schema: "dependabot-claude-review-result:v1",
          }),
        },
      },
      pattern: /not canonical/,
    },
    {
      claudeResult: {
        findings: [
          {
            line: 3,
            path: "package.json",
            summary: "The finding changed.",
            title: "Changed finding",
          },
        ],
        headSha,
        pullRequestNumber: 731,
        repository,
        reviewCompleted: true,
        schema: "dependabot-claude-review-result:v1",
        verdict: "findings",
      },
      pattern: /packet findings changed/,
    },
    {
      claudeRun: { event: "pull_request" },
      pattern: /workflow run provenance is not exact/,
    },
    {
      claudeRun: {
        display_title: `dependabot-claude-review:v1 | source=dependabot-intake:v1 | repository=${repository} | pr=999 | sha=${headSha} | action=synchronize | receipt=true`,
      },
      pattern: /workflow run provenance is not exact/,
    },
    {
      claudeRun: {
        path: ".github/workflows/ci.yml",
      },
      pattern: /workflow run provenance is not exact/,
    },
    {
      claudeRun: {
        repository: { full_name: "attacker/example" },
      },
      pattern: /workflow run provenance is not exact/,
    },
    {
      claudeRun: { head_sha: headSha },
      pattern: /workflow run provenance is not exact/,
    },
    {
      packet: {
        failures: [
          {
            attribution: "branch",
            detailsUrl: `https://github.com/${repository}/runs/${claudeFinding.checkId}`,
            id: "claude-review",
            name: "claude-review",
          },
          {
            attribution: "branch",
            detailsUrl: `https://github.com/${repository}/runs/${claudeFinding.checkId}`,
            id: "claude-review",
            name: "claude-review",
          },
        ],
        findings: [claudeFinding],
      },
      pattern: /failure evidence is ambiguous/,
    },
    {
      packet: {
        failures: [
          {
            attribution: "branch",
            detailsUrl: `https://github.com/${repository}/runs/${claudeFinding.checkId}`,
            id: "claude-review",
            name: "claude-review",
          },
        ],
        findings: [
          claudeFinding,
          { ...repairPacket().findings[0], checkId: claudeFinding.checkId },
        ],
      },
      pattern: /packet findings are ambiguous/,
    },
    {
      packet: {
        failures: [],
        findings: [claudeFinding],
      },
      pattern: /failure evidence is ambiguous/,
    },
    {
      packet: {
        failures: [
          {
            attribution: "branch",
            detailsUrl: `https://github.com/${repository}/runs/${claudeFinding.checkId}`,
            id: "claude-review",
            name: "Claude-Review",
          },
        ],
        findings: [claudeFinding],
      },
      pattern: /failure evidence is ambiguous/,
    },
  ];
  for (const testCase of cases) {
    const packet = testCase.packet ?? {
      failures: [
        {
          attribution: "branch",
          detailsUrl: `https://github.com/${repository}/runs/${claudeFinding.checkId}`,
          id: "claude-review",
          name: "claude-review",
        },
      ],
      findings: [claudeFinding],
    };
    const fixture = materializerFixture({
      claudeCheck: testCase.claudeCheck,
      claudeResult: testCase.claudeResult,
      claudeRun: testCase.claudeRun,
      packet,
    });
    const temporary = mkdtempSync(
      join(tmpdir(), "dependabot-repair-materialize-claude-reject-"),
    );
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = fixture.fetch;
      await assert.rejects(
        materializeRepairEvidence({
          outputRoot: join(temporary, "evidence"),
          packetDigest: fixture.digest,
          packetText: fixture.packetText,
          processorCheckId: 444,
          repositoryName: repository,
          token: "read-token",
        }),
        testCase.pattern,
      );
    } finally {
      globalThis.fetch = originalFetch;
      rmSync(temporary, { force: true, recursive: true });
    }
  }
});

test("materializer logs only ordinary jobs for mixed gate and Claude findings", async () => {
  const claudeFinding = claudePacketFinding();
  const fixture = materializerFixture({
    packet: {
      failures: [
        {
          attribution: "branch",
          detailsUrl: `https://github.com/${repository}/actions/runs/700/job/701`,
          id: "ci",
          name: "Build and Test",
        },
        {
          attribution: "branch",
          detailsUrl: `https://github.com/${repository}/runs/${claudeFinding.checkId}`,
          id: "claude-review",
          name: "claude-review",
        },
      ],
      findings: [claudeFinding],
    },
  });
  const temporary = mkdtempSync(
    join(tmpdir(), "dependabot-repair-materialize-mixed-"),
  );
  const outputRoot = join(temporary, "evidence");
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = fixture.fetch;
    const result = await materializeRepairEvidence({
      outputRoot,
      packetDigest: fixture.digest,
      packetText: fixture.packetText,
      processorCheckId: 444,
      repositoryName: repository,
      token: "read-token",
    });
    assert.deepEqual(
      result.manifest.files
        .filter(({ kind }) => kind === "job-log")
        .map(({ source }) => source.jobId),
      [701],
    );
    assert.deepEqual(
      JSON.parse(
        readFileSync(join(outputRoot, "failure-index.json"), "utf8"),
      ).map(({ failureId }) => failureId),
      ["ci", "claude-review"],
    );
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(temporary, { force: true, recursive: true });
  }
});

test("materializer rejects evidence with a line above the paging cap", async () => {
  const fixture = materializerFixture({
    blobContent: `${"x".repeat(4 * 1024 + 1)}\n`,
  });
  const temporary = mkdtempSync(
    join(tmpdir(), "dependabot-repair-materialize-line-cap-"),
  );
  const outputRoot = join(temporary, "evidence");
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = fixture.fetch;
    await assert.rejects(
      materializeRepairEvidence({
        outputRoot,
        packetDigest: fixture.digest,
        packetText: fixture.packetText,
        processorCheckId: 444,
        repositoryName: repository,
        token: "read-token",
      }),
      /contains an oversized line/,
    );
    assert.throws(() => readFileSync(join(outputRoot, "manifest.json")));
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(temporary, { force: true, recursive: true });
  }
});

test("materializer rejects a final PR race and live file SHA mismatch before sealing", async () => {
  for (const overrides of [
    { finalPull: { updated_at: "2026-08-13T10:01:00Z" } },
    { fileSha: "0".repeat(40) },
  ]) {
    const fixture = materializerFixture(overrides);
    const temporary = mkdtempSync(
      join(tmpdir(), "dependabot-repair-materialize-reject-"),
    );
    const outputRoot = join(temporary, "evidence");
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = fixture.fetch;
      await assert.rejects(
        materializeRepairEvidence({
          outputRoot,
          packetDigest: fixture.digest,
          packetText: fixture.packetText,
          processorCheckId: 444,
          repositoryName: repository,
          token: "read-token",
        }),
        /changed while repair evidence|does not match the packet/,
      );
      assert.throws(() => readFileSync(join(outputRoot, "manifest.json")));
    } finally {
      globalThis.fetch = originalFetch;
      rmSync(temporary, { force: true, recursive: true });
    }
  }
});

function makeGuardEvidenceFixture({
  additionalFileCount = 0,
  diffContent = "diff --git a/a b/a\n",
  packetContent = "{}\n",
} = {}) {
  const temporary = mkdtempSync(
    join(tmpdir(), "dependabot-repair-evidence-guard-"),
  );
  const runnerTemp = join(temporary, "runner");
  const root = join(runnerTemp, "dependabot-repair-evidence-998877-1");
  mkdirSync(runnerTemp, { mode: 0o700 });
  mkdirSync(root, { mode: 0o700 });
  chmodSync(root, 0o700);
  chmodSync(runnerTemp, 0o700);
  const named = [
    "failure-index.json",
    "feedback-index.json",
    "findings.json",
    "packet.json",
    "pull-file-inventory.json",
    "pull-request-diff.patch",
    ...Array.from(
      { length: additionalFileCount },
      (_, index) => `extra-${String(index).padStart(3, "0")}.txt`,
    ),
  ];
  const files = named.map((name) => {
    const content =
      name === "packet.json"
        ? packetContent
        : name.endsWith(".patch")
          ? diffContent
          : "{}\n";
    const path = join(root, name);
    writeFileSync(path, content, { mode: 0o400 });
    return {
      bytes: Buffer.byteLength(content),
      digest: rawDigest(content),
      kind: name.replace(/\.(?:json|patch|txt)$/, ""),
      mediaType: name.endsWith(".json") ? "application/json" : "text/plain",
      name,
      source: {},
    };
  });
  const manifest = `${JSON.stringify(
    JSON.parse(
      canonicalJson({
        baseSha,
        evidenceRoot: root,
        files,
        headSha,
        packetDigest,
        processorCheckId: 444,
        pullRequestNumber: 731,
        repository,
        schema: "dependabot-repair-evidence:v1",
        workflowRunAttempt: 1,
        workflowRunId: 998877,
        workflowSha,
      }),
    ),
    null,
    2,
  )}\n`;
  const manifestPath = join(root, "manifest.json");
  writeFileSync(manifestPath, manifest, { mode: 0o400 });
  const environment = {
    ...process.env,
    DEPENDABOT_REPAIR_EVIDENCE_MANIFEST: manifestPath,
    DEPENDABOT_REPAIR_EVIDENCE_MANIFEST_DIGEST: rawDigest(manifest),
    DEPENDABOT_REPAIR_EVIDENCE_ROOT: root,
    GITHUB_RUN_ATTEMPT: "1",
    GITHUB_RUN_ID: "998877",
    RUNNER_TEMP: runnerTemp,
  };
  return {
    environment,
    manifestPath,
    receiptRoot: join(runnerTemp, "dependabot-repair-evidence-use-998877-1"),
    root,
    temporary,
  };
}

function exactSizedJsonEvidence(byteLength) {
  const lineCount = 4;
  const structuralBytes = lineCount * 6 + 3;
  assert.ok(byteLength > structuralBytes);
  const payloadBytes = byteLength - structuralBytes;
  const basePayloadBytes = Math.floor(payloadBytes / lineCount);
  const remainder = payloadBytes % lineCount;
  const content = `${JSON.stringify(
    Array.from({ length: lineCount }, (_, index) =>
      "x".repeat(basePayloadBytes + (index < remainder ? 1 : 0)),
    ),
    null,
    2,
  )}\n`;
  assert.equal(Buffer.byteLength(content), byteLength);
  assert.ok(
    content.split("\n").every((line) => Buffer.byteLength(line) <= 4 * 1024),
  );
  return content;
}

test("repair evidence guard pages JSON above its exact token-safe threshold", () => {
  const guard = fileURLToPath(
    new URL("./dependabot-repair-evidence-tool-guard.mjs", import.meta.url),
  );
  const printed = spawnSync(process.execPath, [guard, "--print-policy"], {
    encoding: "utf8",
  });
  assert.equal(printed.status, 0, printed.stderr);
  const policy = JSON.parse(printed.stdout);
  assert.equal(
    policy.claudeCodeActionRef,
    "be7b93b1907a4abad570368f3c74b6fe3807510b",
  );
  assert.equal(policy.claudeCodeVersion, "2.1.220");
  assert.equal(policy.evidenceMaxLineBytes, 4 * 1024);
  assert.equal(policy.jsonMaxUnpagedBytes, 12_500);
  assert.equal(policy.jsonMaxBytes, 12_500);
  assert.equal(policy.jsonMaxLines, 2_000);

  const thresholdFixture = makeGuardEvidenceFixture({
    packetContent: exactSizedJsonEvidence(policy.jsonMaxUnpagedBytes),
  });
  try {
    const atThreshold = spawnSync(process.execPath, [guard], {
      encoding: "utf8",
      env: thresholdFixture.environment,
      input: JSON.stringify({
        hook_event_name: "PreToolUse",
        tool_input: { file_path: join(thresholdFixture.root, "packet.json") },
        tool_name: "Read",
        tool_use_id: "toolu_json_at_unpaged_threshold",
      }),
    });
    assert.equal(atThreshold.status, 0, atThreshold.stderr);
  } finally {
    rmSync(thresholdFixture.temporary, { force: true, recursive: true });
  }

  const aboveThresholdFixture = makeGuardEvidenceFixture({
    packetContent: exactSizedJsonEvidence(policy.jsonMaxUnpagedBytes + 1),
  });
  const packetPath = join(aboveThresholdFixture.root, "packet.json");
  try {
    for (const [toolUseId, toolInput] of [
      ["toolu_json_above_threshold_unpaged", { file_path: packetPath }],
      [
        "toolu_json_above_threshold_whole_page",
        { file_path: packetPath, limit: policy.jsonMaxLines, offset: 1 },
      ],
    ]) {
      const blocked = spawnSync(process.execPath, [guard], {
        encoding: "utf8",
        env: aboveThresholdFixture.environment,
        input: JSON.stringify({
          hook_event_name: "PreToolUse",
          tool_input: toolInput,
          tool_name: "Read",
          tool_use_id: toolUseId,
        }),
      });
      assert.equal(blocked.status, 2, blocked.stderr);
      assert.deepEqual(readdirSync(aboveThresholdFixture.receiptRoot), []);
    }

    const bounded = spawnSync(process.execPath, [guard], {
      encoding: "utf8",
      env: aboveThresholdFixture.environment,
      input: JSON.stringify({
        hook_event_name: "PreToolUse",
        tool_input: {
          file_path: packetPath,
          limit: 4,
          offset: 1,
        },
        tool_name: "Read",
        tool_use_id: "toolu_json_above_threshold_bounded",
      }),
    });
    assert.equal(bounded.status, 0, bounded.stderr);
  } finally {
    rmSync(aboveThresholdFixture.temporary, {
      force: true,
      recursive: true,
    });
  }
});

test("repair evidence guard measures escaped JSON pages by exact sealed bytes", () => {
  const guard = fileURLToPath(
    new URL("./dependabot-repair-evidence-tool-guard.mjs", import.meta.url),
  );
  const packetContent = `${JSON.stringify(
    { items: Array.from({ length: 500 }, () => "\u0001".repeat(4)) },
    null,
    2,
  )}\n`;
  assert.ok(Buffer.byteLength(packetContent) > 12_500);
  assert.match(packetContent, /\\u0001/);
  const packetLines = packetContent.split("\n");
  assert.ok(packetLines.every((line) => Buffer.byteLength(line) <= 4 * 1024));
  let pageLineCount = 0;
  let pageBytes = 0;
  while (pageLineCount < packetLines.length) {
    const nextLineBytes = Buffer.byteLength(packetLines[pageLineCount]);
    const candidateBytes =
      pageBytes + (pageLineCount === 0 ? 0 : 1) + nextLineBytes;
    if (candidateBytes > 12_500) break;
    pageBytes = candidateBytes;
    pageLineCount += 1;
  }
  assert.ok(pageLineCount > 3);
  const pageContent = packetLines.slice(0, pageLineCount).join("\n");
  assert.equal(Buffer.byteLength(pageContent), pageBytes);

  const fixture = makeGuardEvidenceFixture({ packetContent });
  const packetPath = join(fixture.root, "packet.json");
  const pageInput = {
    hook_event_name: "PreToolUse",
    tool_input: { file_path: packetPath, limit: pageLineCount, offset: 1 },
    tool_name: "Read",
    tool_use_id: "toolu_escaped_json_page",
  };
  try {
    const pre = spawnSync(process.execPath, [guard], {
      encoding: "utf8",
      env: fixture.environment,
      input: JSON.stringify(pageInput),
    });
    assert.equal(pre.status, 0, pre.stderr);
    const post = spawnSync(process.execPath, [guard], {
      encoding: "utf8",
      env: fixture.environment,
      input: JSON.stringify({
        ...pageInput,
        hook_event_name: "PostToolUse",
        tool_response: {
          file: {
            content: pageContent,
            filePath: packetPath,
            numLines: pageLineCount,
            startLine: 1,
            totalLines: packetLines.length,
            truncatedByTokenCap: false,
          },
          type: "text",
        },
      }),
    });
    assert.equal(post.status, 0, post.stderr);
  } finally {
    rmSync(fixture.temporary, { force: true, recursive: true });
  }
});

test("repair evidence guard matches Claude Read CRLF normalization on large pages", () => {
  const guard = fileURLToPath(
    new URL("./dependabot-repair-evidence-tool-guard.mjs", import.meta.url),
  );
  const contentLines = Array.from(
    { length: 600 },
    (_, index) => `line-${String(index).padStart(3, "0")}-${"x".repeat(24)}`,
  );
  const rawContent = `${contentLines.join("\r\n")}\r\n`;
  assert.ok(Buffer.byteLength(rawContent) > 16 * 1024);
  const rawLines = rawContent.split("\n");
  const normalizedLines = rawLines.map((line) =>
    line.endsWith("\r") ? line.slice(0, -1) : line,
  );
  assert.equal(normalizedLines.length, 601);
  assert.equal(normalizedLines.at(-1), "");

  const fixture = makeGuardEvidenceFixture({ diffContent: rawContent });
  const evidencePath = join(fixture.root, "pull-request-diff.patch");
  const offset = contentLines.length;
  const limit = 2;
  const normalizedPage = normalizedLines
    .slice(offset - 1, offset - 1 + limit)
    .join("\n");
  const rawPage = rawLines.slice(offset - 1, offset - 1 + limit).join("\n");
  assert.equal(normalizedPage, `${contentLines.at(-1)}\n`);
  assert.equal(rawPage, `${contentLines.at(-1)}\r\n`);

  const readInput = (toolUseId) => ({
    hook_event_name: "PreToolUse",
    tool_input: { file_path: evidencePath, limit, offset },
    tool_name: "Read",
    tool_use_id: toolUseId,
  });
  const readResponse = (content) => ({
    file: {
      content,
      filePath: evidencePath,
      numLines: limit,
      startLine: offset,
      totalLines: normalizedLines.length,
      truncatedByTokenCap: false,
    },
    type: "text",
  });
  try {
    const normalizedInput = readInput("toolu_large_crlf_normalized");
    const normalizedPre = spawnSync(process.execPath, [guard], {
      encoding: "utf8",
      env: fixture.environment,
      input: JSON.stringify(normalizedInput),
    });
    assert.equal(normalizedPre.status, 0, normalizedPre.stderr);
    const normalizedPost = spawnSync(process.execPath, [guard], {
      encoding: "utf8",
      env: fixture.environment,
      input: JSON.stringify({
        ...normalizedInput,
        hook_event_name: "PostToolUse",
        tool_response: readResponse(normalizedPage),
      }),
    });
    assert.equal(normalizedPost.status, 0, normalizedPost.stderr);

    const rawInput = readInput("toolu_large_crlf_raw");
    const rawPre = spawnSync(process.execPath, [guard], {
      encoding: "utf8",
      env: fixture.environment,
      input: JSON.stringify(rawInput),
    });
    assert.equal(rawPre.status, 0, rawPre.stderr);
    const rawPost = spawnSync(process.execPath, [guard], {
      encoding: "utf8",
      env: fixture.environment,
      input: JSON.stringify({
        ...rawInput,
        hook_event_name: "PostToolUse",
        tool_response: readResponse(rawPage),
      }),
    });
    assert.equal(rawPost.status, 2);
    assert.match(
      rawPost.stderr,
      /Read response does not match the authorized sealed slice/,
    );
  } finally {
    rmSync(fixture.temporary, { force: true, recursive: true });
  }
});

test("repair evidence guard matches Claude Read BOM normalization on large pages", () => {
  const guard = fileURLToPath(
    new URL("./dependabot-repair-evidence-tool-guard.mjs", import.meta.url),
  );
  const contentLines = Array.from(
    { length: 600 },
    (_, index) => `line-${String(index).padStart(3, "0")}-${"x".repeat(24)}`,
  );
  const rawContent = `\uFEFF\uFEFF${contentLines.join("\n")}`;
  assert.ok(Buffer.byteLength(rawContent) > 16 * 1024);
  const rawLines = rawContent.split("\n");
  const normalizedLines = rawContent.slice(1).split("\n");
  assert.equal(rawLines.length, normalizedLines.length);
  assert.equal(rawLines[0], `\uFEFF\uFEFF${contentLines[0]}`);
  assert.equal(normalizedLines[0], `\uFEFF${contentLines[0]}`);

  const fixture = makeGuardEvidenceFixture({ diffContent: rawContent });
  const evidencePath = join(fixture.root, "pull-request-diff.patch");
  const offset = 1;
  const limit = 2;
  const normalizedPage = normalizedLines.slice(0, limit).join("\n");
  const rawPage = rawLines.slice(0, limit).join("\n");
  const readInput = (toolUseId) => ({
    hook_event_name: "PreToolUse",
    tool_input: { file_path: evidencePath, limit, offset },
    tool_name: "Read",
    tool_use_id: toolUseId,
  });
  const readResponse = (content) => ({
    file: {
      content,
      filePath: evidencePath,
      numLines: limit,
      startLine: offset,
      totalLines: normalizedLines.length,
      truncatedByTokenCap: false,
    },
    type: "text",
  });
  try {
    const normalizedInput = readInput("toolu_large_bom_normalized");
    const normalizedPre = spawnSync(process.execPath, [guard], {
      encoding: "utf8",
      env: fixture.environment,
      input: JSON.stringify(normalizedInput),
    });
    assert.equal(normalizedPre.status, 0, normalizedPre.stderr);
    const normalizedPost = spawnSync(process.execPath, [guard], {
      encoding: "utf8",
      env: fixture.environment,
      input: JSON.stringify({
        ...normalizedInput,
        hook_event_name: "PostToolUse",
        tool_response: readResponse(normalizedPage),
      }),
    });
    assert.equal(normalizedPost.status, 0, normalizedPost.stderr);

    const rawInput = readInput("toolu_large_bom_raw");
    const rawPre = spawnSync(process.execPath, [guard], {
      encoding: "utf8",
      env: fixture.environment,
      input: JSON.stringify(rawInput),
    });
    assert.equal(rawPre.status, 0, rawPre.stderr);
    const rawPost = spawnSync(process.execPath, [guard], {
      encoding: "utf8",
      env: fixture.environment,
      input: JSON.stringify({
        ...rawInput,
        hook_event_name: "PostToolUse",
        tool_response: readResponse(rawPage),
      }),
    });
    assert.equal(rawPost.status, 2);
    assert.match(
      rawPost.stderr,
      /Read response does not match the authorized sealed slice/,
    );
  } finally {
    rmSync(fixture.temporary, { force: true, recursive: true });
  }
});

test("repair evidence guard permits only sealed manifest Read/Grep and requires completion", () => {
  const guard = fileURLToPath(
    new URL("./dependabot-repair-evidence-tool-guard.mjs", import.meta.url),
  );
  const fixture = makeGuardEvidenceFixture();
  try {
    const readInput = {
      hook_event_name: "PreToolUse",
      tool_input: {
        file_path: join(fixture.root, "packet.json"),
        limit: 2000,
        offset: 1,
      },
      tool_name: "Read",
      tool_use_id: "toolu_repair_packet",
    };
    const pre = spawnSync(process.execPath, [guard], {
      encoding: "utf8",
      env: fixture.environment,
      input: JSON.stringify(readInput),
    });
    assert.equal(pre.status, 0, pre.stderr);
    assert.equal(
      JSON.parse(pre.stdout).hookSpecificOutput.permissionDecision,
      "allow",
    );
    const post = spawnSync(process.execPath, [guard], {
      encoding: "utf8",
      env: fixture.environment,
      input: JSON.stringify({
        ...readInput,
        hook_event_name: "PostToolUse",
        tool_response: {
          file: {
            content: "{}\n",
            filePath: join(fixture.root, "packet.json"),
            numLines: 2,
            startLine: 1,
            totalLines: 2,
          },
          type: "text",
        },
      }),
    });
    assert.equal(post.status, 0, post.stderr);
    const mismatchedResponse = spawnSync(process.execPath, [guard], {
      encoding: "utf8",
      env: fixture.environment,
      input: JSON.stringify({
        ...readInput,
        hook_event_name: "PostToolUse",
        tool_response: {
          file: {
            content: "{}\n",
            filePath: join(fixture.root, "findings.json"),
            numLines: 2,
            startLine: 1,
            totalLines: 2,
          },
          type: "text",
        },
      }),
    });
    assert.equal(mismatchedResponse.status, 2);
    const verify = spawnSync(process.execPath, [guard, "--verify-completion"], {
      encoding: "utf8",
      env: fixture.environment,
    });
    assert.equal(verify.status, 0, verify.stderr);

    const grepInput = {
      hook_event_name: "PreToolUse",
      tool_input: {
        "-A": 1,
        head_limit: 5,
        output_mode: "content",
        path: fixture.root,
        pattern: "vercel",
      },
      tool_name: "Grep",
      tool_use_id: "toolu_repair_grep",
    };
    for (const [toolUseId, multiline] of [
      ["toolu_repair_grep_default", undefined],
      ["toolu_repair_grep_false", false],
    ]) {
      const input = {
        ...grepInput,
        tool_input: {
          ...grepInput.tool_input,
          ...(multiline === undefined ? {} : { multiline }),
        },
        tool_use_id: toolUseId,
      };
      const grep = spawnSync(process.execPath, [guard], {
        encoding: "utf8",
        env: fixture.environment,
        input: JSON.stringify(input),
      });
      assert.equal(grep.status, 0, grep.stderr);
      const grepPost = spawnSync(process.execPath, [guard], {
        encoding: "utf8",
        env: fixture.environment,
        input: JSON.stringify({
          ...input,
          hook_event_name: "PostToolUse",
          tool_response: {
            appliedLimit: 5,
            appliedOffset: 0,
            content: `${join(fixture.root, "packet.json")}:1:{}`,
            filenames: [join(fixture.root, "packet.json")],
            mode: "content",
            numFiles: 1,
            numLines: 1,
            numMatches: 1,
            totalFiles: 1,
            totalLines: 1,
          },
        }),
      });
      assert.equal(grepPost.status, 0, grepPost.stderr);
    }
    const grepVerify = spawnSync(
      process.execPath,
      [guard, "--verify-completion"],
      {
        encoding: "utf8",
        env: fixture.environment,
      },
    );
    assert.equal(grepVerify.status, 0, grepVerify.stderr);

    for (const blockedInput of [
      { ...readInput, tool_name: "Bash" },
      { ...readInput, tool_input: { file_path: "/etc/passwd" } },
      {
        ...readInput,
        tool_input: {
          file_path: join(fixture.root, "packet.json"),
          limit: 100,
          offset: 0,
        },
      },
      {
        ...readInput,
        tool_input: { file_path: fixture.manifestPath, limit: 2001 },
      },
      {
        ...grepInput,
        tool_input: { ...grepInput.tool_input, multiline: true },
      },
      {
        ...grepInput,
        tool_input: { ...grepInput.tool_input, multiline: "false" },
      },
      {
        ...grepInput,
        tool_input: { ...grepInput.tool_input, head_limit: 6 },
      },
      {
        ...grepInput,
        tool_input: { ...grepInput.tool_input, "-A": 2 },
      },
      {
        ...grepInput,
        tool_input: { ...grepInput.tool_input, pattern: "x".repeat(501) },
      },
      { ...readInput, hook_event_name: "PostToolUseFailure" },
    ]) {
      const blocked = spawnSync(process.execPath, [guard], {
        encoding: "utf8",
        env: fixture.environment,
        input: JSON.stringify(blockedInput),
      });
      assert.equal(blocked.status, 2, JSON.stringify(blockedInput));
    }
  } finally {
    rmSync(fixture.temporary, { force: true, recursive: true });
  }
});

test("repair evidence guard accepts 150 manifest files and rejects 151", () => {
  const guard = fileURLToPath(
    new URL("./dependabot-repair-evidence-tool-guard.mjs", import.meta.url),
  );
  for (const [additionalFileCount, expectedStatus] of [
    [144, 0],
    [145, 2],
  ]) {
    const fixture = makeGuardEvidenceFixture({ additionalFileCount });
    try {
      const result = spawnSync(process.execPath, [guard], {
        encoding: "utf8",
        env: fixture.environment,
        input: JSON.stringify({
          hook_event_name: "PreToolUse",
          tool_input: {
            file_path: fixture.manifestPath,
            limit: 3,
            offset: 1,
          },
          tool_name: "Read",
          tool_use_id: `toolu_manifest_${additionalFileCount}`,
        }),
      });
      assert.equal(result.status, expectedStatus, result.stderr);
    } finally {
      rmSync(fixture.temporary, { force: true, recursive: true });
    }
  }
});

test("repair evidence guard requires bounded one-based pages for large reads and Grep", () => {
  const guard = fileURLToPath(
    new URL("./dependabot-repair-evidence-tool-guard.mjs", import.meta.url),
  );
  const packetContent = `${JSON.stringify(
    { items: Array.from({ length: 3_000 }, (_, index) => `item-${index}`) },
    null,
    2,
  )}\n`;
  assert.ok(Buffer.byteLength(packetContent) > 16 * 1024);
  assert.ok(
    packetContent
      .split("\n")
      .every((line) => Buffer.byteLength(line) <= 4 * 1024),
  );
  const fixture = makeGuardEvidenceFixture({ packetContent });
  const packetPath = join(fixture.root, "packet.json");
  try {
    const invalidInputs = [
      {
        hook_event_name: "PreToolUse",
        tool_input: { file_path: packetPath },
        tool_name: "Read",
        tool_use_id: "toolu_large_unpaged",
      },
      {
        hook_event_name: "PreToolUse",
        tool_input: { file_path: packetPath, limit: 4, offset: 0 },
        tool_name: "Read",
        tool_use_id: "toolu_large_offset_zero",
      },
      {
        hook_event_name: "PreToolUse",
        tool_input: { file_path: packetPath, limit: 2000, offset: 1 },
        tool_name: "Read",
        tool_use_id: "toolu_large_page_too_many_bytes",
      },
      {
        hook_event_name: "PreToolUse",
        tool_input: {
          multiline: false,
          output_mode: "content",
          path: fixture.root,
          pattern: "item",
        },
        tool_name: "Grep",
        tool_use_id: "toolu_unbounded_grep",
      },
    ];
    for (const input of invalidInputs) {
      const blocked = spawnSync(process.execPath, [guard], {
        encoding: "utf8",
        env: fixture.environment,
        input: JSON.stringify(input),
      });
      assert.equal(blocked.status, 2, JSON.stringify(input));
      assert.deepEqual(readdirSync(fixture.receiptRoot), []);
    }

    const pageInput = {
      hook_event_name: "PreToolUse",
      tool_input: { file_path: packetPath, limit: 3, offset: 1 },
      tool_name: "Read",
      tool_use_id: "toolu_large_page",
    };
    const pagePre = spawnSync(process.execPath, [guard], {
      encoding: "utf8",
      env: fixture.environment,
      input: JSON.stringify(pageInput),
    });
    assert.equal(pagePre.status, 0, pagePre.stderr);
    const packetLines = packetContent.split("\n");
    const pageContent = packetLines.slice(0, 3).join("\n");
    const pagePost = spawnSync(process.execPath, [guard], {
      encoding: "utf8",
      env: fixture.environment,
      input: JSON.stringify({
        ...pageInput,
        hook_event_name: "PostToolUse",
        tool_response: {
          file: {
            content: pageContent,
            filePath: packetPath,
            numLines: 3,
            startLine: 1,
            totalLines: packetLines.length,
            truncatedByTokenCap: false,
          },
          type: "text",
        },
      }),
    });
    assert.equal(pagePost.status, 0, pagePost.stderr);
    const verified = spawnSync(
      process.execPath,
      [guard, "--verify-completion"],
      { encoding: "utf8", env: fixture.environment },
    );
    assert.equal(verified.status, 0, verified.stderr);

    for (const [toolUseId, responseOverride] of [
      ["toolu_large_wrong_start", { startLine: 2 }],
      ["toolu_large_truncated", { truncatedByTokenCap: true }],
      [
        "toolu_large_wrong_slice",
        { content: pageContent.replace('"items"', '"xtems"') },
      ],
    ]) {
      const input = { ...pageInput, tool_use_id: toolUseId };
      const pre = spawnSync(process.execPath, [guard], {
        encoding: "utf8",
        env: fixture.environment,
        input: JSON.stringify(input),
      });
      assert.equal(pre.status, 0, pre.stderr);
      const post = spawnSync(process.execPath, [guard], {
        encoding: "utf8",
        env: fixture.environment,
        input: JSON.stringify({
          ...input,
          hook_event_name: "PostToolUse",
          tool_response: {
            file: {
              content: pageContent,
              filePath: packetPath,
              numLines: 3,
              startLine: 1,
              totalLines: packetLines.length,
              truncatedByTokenCap: false,
              ...responseOverride,
            },
            type: "text",
          },
        }),
      });
      assert.equal(post.status, 2, JSON.stringify(responseOverride));
    }
  } finally {
    rmSync(fixture.temporary, { force: true, recursive: true });
  }
});

test("repair evidence guard completes 690 short lines in two byte-bounded pages", () => {
  const guard = fileURLToPath(
    new URL("./dependabot-repair-evidence-tool-guard.mjs", import.meta.url),
  );
  const packetContent = JSON.stringify(
    Array.from(
      { length: 688 },
      (_, index) => `line-${String(index).padStart(3, "0")}-${"x".repeat(24)}`,
    ),
    null,
    2,
  );
  const packetLines = packetContent.split("\n");
  assert.equal(packetLines.length, 690);
  assert.ok(Buffer.byteLength(packetContent) > 16 * 1024);
  const fixture = makeGuardEvidenceFixture({ diffContent: packetContent });
  const packetPath = join(fixture.root, "pull-request-diff.patch");
  try {
    const pages = [];
    for (let lineIndex = 0; lineIndex < packetLines.length; ) {
      let nextLineIndex = lineIndex;
      let pageBytes = 0;
      while (nextLineIndex < packetLines.length) {
        const nextLineBytes = Buffer.byteLength(packetLines[nextLineIndex]);
        const candidateBytes =
          pageBytes + (nextLineIndex === lineIndex ? 0 : 1) + nextLineBytes;
        if (candidateBytes > 25_000) break;
        pageBytes = candidateBytes;
        nextLineIndex += 1;
      }
      assert.ok(nextLineIndex > lineIndex);
      pages.push({
        lineIndex,
        pageLines: packetLines.slice(lineIndex, nextLineIndex),
      });
      lineIndex = nextLineIndex;
    }
    assert.equal(pages.length, 2);

    let completedPages = 0;
    for (const { lineIndex, pageLines } of pages) {
      const toolUseId = `toolu_capacity_page_${String(completedPages).padStart(3, "0")}`;
      const pageInput = {
        hook_event_name: "PreToolUse",
        tool_input: {
          file_path: packetPath,
          limit: pageLines.length,
          offset: lineIndex + 1,
        },
        tool_name: "Read",
        tool_use_id: toolUseId,
      };
      const pre = spawnSync(process.execPath, [guard], {
        encoding: "utf8",
        env: fixture.environment,
        input: JSON.stringify(pageInput),
      });
      assert.equal(pre.status, 0, pre.stderr);
      const post = spawnSync(process.execPath, [guard], {
        encoding: "utf8",
        env: fixture.environment,
        input: JSON.stringify({
          ...pageInput,
          hook_event_name: "PostToolUse",
          tool_response: {
            file: {
              content: pageLines.join("\n"),
              filePath: packetPath,
              numLines: pageLines.length,
              startLine: lineIndex + 1,
              totalLines: packetLines.length,
              truncatedByTokenCap: false,
            },
            type: "text",
          },
        }),
      });
      assert.equal(post.status, 0, post.stderr);
      completedPages += 1;
    }
    assert.equal(completedPages, 2);
    assert.equal(readdirSync(fixture.receiptRoot).length, 4);
    const verified = spawnSync(
      process.execPath,
      [guard, "--verify-completion"],
      { encoding: "utf8", env: fixture.environment },
    );
    assert.equal(verified.status, 0, verified.stderr);
  } finally {
    rmSync(fixture.temporary, { force: true, recursive: true });
  }
});

test("repair evidence guard retains its 200-call receipt ceiling", () => {
  const guard = fileURLToPath(
    new URL("./dependabot-repair-evidence-tool-guard.mjs", import.meta.url),
  );
  const fixture = makeGuardEvidenceFixture();
  mkdirSync(fixture.receiptRoot, { mode: 0o700 });
  const writeReceiptPair = (index) => {
    const toolUseId = `toolu_receipt_cap_${String(index).padStart(3, "0")}`;
    const toolInputDigest = rawDigest(`input-${index}`);
    const shared = {
      manifestDigest:
        fixture.environment.DEPENDABOT_REPAIR_EVIDENCE_MANIFEST_DIGEST,
      runAttempt: "1",
      runId: "998877",
      toolInputDigest,
      toolUseId,
    };
    writeFileSync(
      join(fixture.receiptRoot, `${toolUseId}.issued.json`),
      `${canonicalJson({
        ...shared,
        pageBytes: 0,
        pageDigest: null,
        pageLines: 0,
        schema: "dependabot-repair-evidence-tool-issued:v1",
      })}\n`,
      { mode: 0o600 },
    );
    writeFileSync(
      join(fixture.receiptRoot, `${toolUseId}.completed.json`),
      `${canonicalJson({
        ...shared,
        responseBytes: 1,
        responseDigest: rawDigest(`response-${index}`),
        schema: "dependabot-repair-evidence-tool-completed:v1",
      })}\n`,
      { mode: 0o600 },
    );
  };
  try {
    for (let index = 0; index < 200; index += 1) writeReceiptPair(index);
    const atCap = spawnSync(process.execPath, [guard, "--verify-completion"], {
      encoding: "utf8",
      env: fixture.environment,
    });
    assert.equal(atCap.status, 0, atCap.stderr);

    writeReceiptPair(200);
    const aboveCap = spawnSync(
      process.execPath,
      [guard, "--verify-completion"],
      { encoding: "utf8", env: fixture.environment },
    );
    assert.equal(aboveCap.status, 2);
    assert.match(aboveCap.stderr, /receipt inventory is malformed or capped/);
  } finally {
    rmSync(fixture.temporary, { force: true, recursive: true });
  }
});

test("repair evidence guard keeps maximum-width pages below response bounds", () => {
  const guard = fileURLToPath(
    new URL("./dependabot-repair-evidence-tool-guard.mjs", import.meta.url),
  );
  const maximumWidthLine = "x".repeat(4 * 1024);
  const packetContent = Array.from({ length: 8 }, () => maximumWidthLine).join(
    "\n",
  );
  const fixture = makeGuardEvidenceFixture({ diffContent: packetContent });
  const packetPath = join(fixture.root, "pull-request-diff.patch");
  try {
    const sevenLinePage = spawnSync(process.execPath, [guard], {
      encoding: "utf8",
      env: fixture.environment,
      input: JSON.stringify({
        hook_event_name: "PreToolUse",
        tool_input: { file_path: packetPath, limit: 7, offset: 1 },
        tool_name: "Read",
        tool_use_id: "toolu_seven_maximum_width_lines",
      }),
    });
    assert.equal(sevenLinePage.status, 2);

    const pageInput = {
      hook_event_name: "PreToolUse",
      tool_input: { file_path: packetPath, limit: 6, offset: 1 },
      tool_name: "Read",
      tool_use_id: "toolu_six_maximum_width_lines",
    };
    const pre = spawnSync(process.execPath, [guard], {
      encoding: "utf8",
      env: fixture.environment,
      input: JSON.stringify(pageInput),
    });
    assert.equal(pre.status, 0, pre.stderr);
    const pageContent = Array.from({ length: 6 }, () => maximumWidthLine).join(
      "\n",
    );
    assert.equal(Buffer.byteLength(pageContent), 6 * 4 * 1024 + 5);
    assert.ok(Buffer.byteLength(pageContent) < 25_000);
    const post = spawnSync(process.execPath, [guard], {
      encoding: "utf8",
      env: fixture.environment,
      input: JSON.stringify({
        ...pageInput,
        hook_event_name: "PostToolUse",
        tool_response: {
          file: {
            content: pageContent,
            filePath: packetPath,
            numLines: 6,
            startLine: 1,
            totalLines: 8,
            truncatedByTokenCap: false,
          },
          type: "text",
        },
      }),
    });
    assert.equal(post.status, 0, post.stderr);
    const completedReceipt = JSON.parse(
      readFileSync(
        join(
          fixture.receiptRoot,
          "toolu_six_maximum_width_lines.completed.json",
        ),
        "utf8",
      ),
    );
    assert.equal(
      completedReceipt.responseBytes,
      Buffer.byteLength(pageContent),
    );

    const oversizedLineInput = {
      hook_event_name: "PreToolUse",
      tool_input: { file_path: packetPath, limit: 1, offset: 1 },
      tool_name: "Read",
      tool_use_id: "toolu_oversized_response_line",
    };
    const oversizedLinePre = spawnSync(process.execPath, [guard], {
      encoding: "utf8",
      env: fixture.environment,
      input: JSON.stringify(oversizedLineInput),
    });
    assert.equal(oversizedLinePre.status, 0, oversizedLinePre.stderr);
    const oversizedLinePost = spawnSync(process.execPath, [guard], {
      encoding: "utf8",
      env: fixture.environment,
      input: JSON.stringify({
        ...oversizedLineInput,
        hook_event_name: "PostToolUse",
        tool_response: {
          file: {
            content: "x".repeat(4 * 1024 + 1),
            filePath: packetPath,
            numLines: 1,
            startLine: 1,
            totalLines: 8,
            truncatedByTokenCap: false,
          },
          type: "text",
        },
      }),
    });
    assert.equal(oversizedLinePost.status, 2);

    const grepInput = {
      hook_event_name: "PreToolUse",
      tool_input: {
        head_limit: 1,
        output_mode: "content",
        path: packetPath,
        pattern: "x",
      },
      tool_name: "Grep",
      tool_use_id: "toolu_oversized_grep_response",
    };
    const grepPre = spawnSync(process.execPath, [guard], {
      encoding: "utf8",
      env: fixture.environment,
      input: JSON.stringify(grepInput),
    });
    assert.equal(grepPre.status, 0, grepPre.stderr);
    const grepPost = spawnSync(process.execPath, [guard], {
      encoding: "utf8",
      env: fixture.environment,
      input: JSON.stringify({
        ...grepInput,
        hook_event_name: "PostToolUse",
        tool_response: {
          content: "x".repeat(32 * 1024),
          filenames: [packetPath],
          numFiles: 1,
        },
      }),
    });
    assert.equal(grepPost.status, 2);
  } finally {
    rmSync(fixture.temporary, { force: true, recursive: true });
  }
});

test("repair evidence guard admits the worst escaped six-line Read envelope", () => {
  const guard = fileURLToPath(
    new URL("./dependabot-repair-evidence-tool-guard.mjs", import.meta.url),
  );
  const maximumControlLine = "\u0001".repeat(4 * 1024);
  const pageContent = Array.from({ length: 6 }, () => maximumControlLine).join(
    "\n",
  );
  assert.equal(Buffer.byteLength(pageContent), 6 * 4 * 1024 + 5);
  assert.equal(
    Buffer.byteLength(JSON.stringify(pageContent)),
    6 * 4 * 1024 * 6 + 5 * 2 + 2,
  );
  const fixture = makeGuardEvidenceFixture({ diffContent: pageContent });
  const evidencePath = join(fixture.root, "pull-request-diff.patch");
  try {
    const postMetadata = {
      agent_id: "agent-test",
      agent_type: "",
      cwd: fixture.root,
      duration_ms: Number.MAX_SAFE_INTEGER,
      effort: { level: "high" },
      hook_event_name: "PostToolUse",
      permission_mode: "dontAsk",
      prompt_id: "prompt-test",
      session_id: "session-test",
      tool_input: { file_path: evidencePath, limit: 6, offset: 1 },
      tool_name: "Read",
      tool_use_id: "toolu_worst_escaped_page",
      transcript_path: join(fixture.temporary, "transcript.jsonl"),
    };
    const metadataPadding =
      64 * 1024 - Buffer.byteLength(JSON.stringify(postMetadata));
    assert.ok(metadataPadding > 0);
    postMetadata.agent_type = "x".repeat(metadataPadding);
    assert.equal(Buffer.byteLength(JSON.stringify(postMetadata)), 64 * 1024);

    const preInput = { ...postMetadata, hook_event_name: "PreToolUse" };
    assert.equal(Buffer.byteLength(JSON.stringify(preInput)), 64 * 1024 - 1);
    const pre = spawnSync(process.execPath, [guard], {
      encoding: "utf8",
      env: fixture.environment,
      input: JSON.stringify(preInput),
    });
    assert.equal(pre.status, 0, pre.stderr);

    const postInput = {
      ...postMetadata,
      tool_response: {
        file: {
          content: pageContent,
          filePath: evidencePath,
          numLines: 6,
          startLine: 1,
          totalLines: 6,
          truncatedByTokenCap: false,
        },
        type: "text",
      },
    };
    const serializedPostInput = JSON.stringify(postInput);
    assert.ok(Buffer.byteLength(serializedPostInput) > 64 * 1024);
    assert.ok(Buffer.byteLength(serializedPostInput) < 256 * 1024);
    const post = spawnSync(process.execPath, [guard], {
      encoding: "utf8",
      env: fixture.environment,
      input: serializedPostInput,
    });
    assert.equal(post.status, 0, post.stderr);
    const verified = spawnSync(
      process.execPath,
      [guard, "--verify-completion"],
      { encoding: "utf8", env: fixture.environment },
    );
    assert.equal(verified.status, 0, verified.stderr);
  } finally {
    rmSync(fixture.temporary, { force: true, recursive: true });
  }
});

test("repair evidence guard rejects metadata one byte above its separate cap", () => {
  const guard = fileURLToPath(
    new URL("./dependabot-repair-evidence-tool-guard.mjs", import.meta.url),
  );
  const fixture = makeGuardEvidenceFixture();
  try {
    const input = {
      hook_event_name: "PreToolUse",
      metadataPadding: "",
      tool_input: {
        file_path: join(fixture.root, "packet.json"),
        limit: 1,
        offset: 1,
      },
      tool_name: "Read",
      tool_use_id: "toolu_oversized_hook_metadata",
    };
    const paddingBytes =
      64 * 1024 + 1 - Buffer.byteLength(JSON.stringify(input));
    assert.ok(paddingBytes > 0);
    input.metadataPadding = "x".repeat(paddingBytes);
    const serializedInput = JSON.stringify(input);
    assert.equal(Buffer.byteLength(serializedInput), 64 * 1024 + 1);
    assert.ok(Buffer.byteLength(serializedInput) < 256 * 1024);

    const blocked = spawnSync(process.execPath, [guard], {
      encoding: "utf8",
      env: fixture.environment,
      input: serializedInput,
    });
    assert.equal(blocked.status, 2);
    assert.match(blocked.stderr, /hook metadata exceeds its size cap/);
    assert.deepEqual(readdirSync(fixture.receiptRoot), []);
  } finally {
    rmSync(fixture.temporary, { force: true, recursive: true });
  }
});

test("repair evidence guard rejects stdin one byte above its derived cap", () => {
  const guard = fileURLToPath(
    new URL("./dependabot-repair-evidence-tool-guard.mjs", import.meta.url),
  );
  const fixture = makeGuardEvidenceFixture();
  try {
    const input = JSON.stringify({
      hook_event_name: "PreToolUse",
      tool_input: {
        file_path: join(fixture.root, "packet.json"),
        limit: 1,
        offset: 1,
      },
      tool_name: "Read",
      tool_use_id: "toolu_oversized_hook_stdin",
    });
    const oversizedInput = `${input}${" ".repeat(256 * 1024 + 1 - Buffer.byteLength(input))}`;
    assert.equal(Buffer.byteLength(oversizedInput), 256 * 1024 + 1);
    const blocked = spawnSync(process.execPath, [guard], {
      encoding: "utf8",
      env: fixture.environment,
      input: oversizedInput,
    });
    assert.equal(blocked.status, 2);
    assert.match(blocked.stderr, /hook input exceeds its size cap/);
    assert.deepEqual(readdirSync(fixture.receiptRoot), []);
  } finally {
    rmSync(fixture.temporary, { force: true, recursive: true });
  }
});

test("repair evidence guard rejects manifest mutation, symlinks, extras, and missing use", () => {
  const guard = fileURLToPath(
    new URL("./dependabot-repair-evidence-tool-guard.mjs", import.meta.url),
  );
  const cases = ["digest", "symlink", "extra", "unused"];
  for (const kind of cases) {
    const fixture = makeGuardEvidenceFixture();
    try {
      if (kind === "digest") {
        fixture.environment.DEPENDABOT_REPAIR_EVIDENCE_MANIFEST_DIGEST =
          "0".repeat(64);
      } else if (kind === "symlink") {
        const path = join(fixture.root, "packet.json");
        chmodSync(path, 0o600);
        rmSync(path);
        symlinkSync("findings.json", path);
      } else if (kind === "extra") {
        writeFileSync(join(fixture.root, "unlisted.txt"), "x", { mode: 0o400 });
      }
      const args = kind === "unused" ? [guard, "--verify-completion"] : [guard];
      const result = spawnSync(process.execPath, args, {
        encoding: "utf8",
        env: fixture.environment,
        input:
          kind === "unused"
            ? undefined
            : JSON.stringify({
                hook_event_name: "PreToolUse",
                tool_input: { file_path: join(fixture.root, "packet.json") },
                tool_name: "Read",
                tool_use_id: `toolu_${kind}`,
              }),
      });
      assert.equal(result.status, 2, `${kind}: ${result.stderr}`);
    } finally {
      rmSync(fixture.temporary, { force: true, recursive: true });
    }
  }
});

test("terminal receipt selection ignores proven old attempts and rejects malformed current evidence", () => {
  assert.equal(
    sourceAttemptBinding(
      "dependabot-refresh:v1:pr=1:head=a:state=completed:digest=d:run=55:attempt=1",
      55,
      2,
      "refresh",
    ),
    "other-attempt",
  );
  assert.equal(
    sourceAttemptBinding(
      "dependabot-repair-intent:v1:pr=1:head=a:attempt=1:digest=d:run=55:run_attempt=2",
      55,
      2,
      "intent",
    ),
    "current",
  );
  assert.equal(
    sourceAttemptBinding(
      "dependabot-refresh:v1:pr=1:head=a:state=completed:digest=d:run=55:attempt=2",
      55,
      2,
      "refresh",
    ),
    "current",
  );
  assert.equal(
    sourceAttemptBinding(
      "dependabot-repair:v1:pr=1:head=a:attempt=1:digest=d:run=55:run_attempt=1",
      55,
      2,
      "repair",
    ),
    "other-attempt",
  );
  assert.equal(
    sourceAttemptBinding(
      "dependabot-refresh:v1:pr=1:head=a:state=completed:digest=d:run=55:attempt=broken",
      55,
      2,
      "refresh",
    ),
    "malformed",
  );
});
