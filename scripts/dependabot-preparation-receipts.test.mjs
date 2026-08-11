import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  canonicalDigest,
  canonicalJson,
  collectTerminalSourceChecks,
  createRecoveryRetryAction,
  createRepairRecoveryAction,
  createRepairRetryAction,
  createRequestedRefreshAction,
  gitSubprocessEnvironment,
  isRetryableRepairConclusion,
  nextInfrastructureRetry,
  operationExternalId,
  parseRepairRunTitle,
  parseCanonicalJson,
  rawDigest,
  repairIntentExternalId,
  sourceAttemptBinding,
  terminalActionConfiguration,
  validatePreparedHeadPayload,
  validateProcessDispatchPayload,
  validateProcessorRepairPacket,
  validateRefreshReceipt,
  validateRepairDispatchPayload,
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
        digest: "f".repeat(64),
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

test("a terminal requested Refresh produces only the bounded next-process event", () => {
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
    base: { sha: baseSha },
    head: { ref: receipt.headRef, sha: headSha },
    number: 731,
  };
  const action = createRequestedRefreshAction({
    check,
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
      pull: { ...pull, base: { sha: "c".repeat(40) } },
      receipt,
      sourceRunId: 998877,
    }),
    null,
    "a terminal request for an obsolete base is inert",
  );
  assert.throws(
    () =>
      createRequestedRefreshAction({
        check: { ...check, status: "in_progress" },
        pull,
        receipt,
        sourceRunId: 998877,
      }),
    /not exact/,
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
