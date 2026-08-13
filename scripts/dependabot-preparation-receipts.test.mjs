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
    changedPaths: [".github/workflows/ci.yml"],
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
    schema: "dependabot-repair-packet:v2",
    updateType: "patch",
    validationCommands: ["pnpm ci:action-pins:test"],
    workflowRunAttempt: 2,
    workflowRunId: 998877,
    workflowSha,
    ...overrides,
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

test("staging and recovery reject an unsigned Prepare App repair commit", () => {
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
      id: intent.prepareBotId,
      login: intent.prepareBotLogin,
      type: "Bot",
    },
    parents: [{ sha: intent.parentHeadSha }],
    sha: intent.headSha,
  };
  assert.equal(validateRepairCommit(commit, intent), commit);
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
  const disjointPacket = repairPacket();
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
    if (path === `/repos/${repository}/actions/runs/${packet.workflowRunId}`)
      return jsonResponse(processorRun);
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
          ? "diff --git a/a b/a\n"
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
            numLines: 1,
            startLine: 1,
            totalLines: 1,
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
            numLines: 1,
            startLine: 1,
            totalLines: 1,
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
        multiline: false,
        output_mode: "content",
        path: fixture.root,
        pattern: "vercel",
      },
      tool_name: "Grep",
      tool_use_id: "toolu_repair_grep",
    };
    const grep = spawnSync(process.execPath, [guard], {
      encoding: "utf8",
      env: fixture.environment,
      input: JSON.stringify(grepInput),
    });
    assert.equal(grep.status, 0, grep.stderr);
    const grepPost = spawnSync(process.execPath, [guard], {
      encoding: "utf8",
      env: fixture.environment,
      input: JSON.stringify({
        ...grepInput,
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
            limit: 4,
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
        tool_input: { file_path: packetPath, limit: 5, offset: 1 },
        tool_name: "Read",
        tool_use_id: "toolu_large_page_too_wide",
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
      tool_input: { file_path: packetPath, limit: 4, offset: 1 },
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
    const pageContent = `${packetLines.slice(0, 4).join("\n")}\n`;
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
            numLines: 4,
            startLine: 1,
            totalLines: packetLines.length - 1,
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
              numLines: 4,
              startLine: 1,
              totalLines: packetLines.length - 1,
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
