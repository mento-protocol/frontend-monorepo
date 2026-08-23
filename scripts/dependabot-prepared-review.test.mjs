/* eslint-disable turbo/no-undeclared-env-vars -- embedded workflow subprocesses need the host PATH. */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { test } from "node:test";

import { parse } from "yaml";

import {
  canonicalReceiptJson,
  digestReceipt,
  validateAppliedBaseOnCurrentMain,
  validatePreparedReviewTarget,
} from "./dependabot-prepared-review.mjs";
import { DEPENDABOT_CHECK_POLICY } from "./dependabot-processor.mjs";

const repository = "mento-protocol/frontend-monorepo";
const pullRequestNumber = 731;
const headRef = "dependabot/npm_and_yarn/runtime-packages-123abc";
const seedHeadSha = "1".repeat(40);
const baseSha = "2".repeat(40);
const preparedHeadSha = "3".repeat(40);
const previousBaseSha = "4".repeat(40);
const workflowSha = "5".repeat(40);
const prepareAppSlug = "mento-dependabot-prepare";
const prepareBotId = 987654;
const prepareBotLogin = "mento-dependabot-prepare[bot]";
const githubSystemCommitter = {
  id: 19864447,
  login: "web-flow",
  type: "User",
};

function read(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

function workflow(relativePath) {
  return parse(read(relativePath), { uniqueKeys: true });
}

function githubActionsApp() {
  return { id: 15368, slug: "github-actions" };
}

function workflowRun({
  actor,
  attempt = 1,
  conclusion = "success",
  displayTitle,
  event,
  id,
  path,
  status = "completed",
}) {
  return {
    actor,
    conclusion,
    display_title: displayTitle,
    event,
    head_branch: "main",
    head_repository: { full_name: repository },
    head_sha: workflowSha,
    id,
    path,
    repository: { full_name: repository },
    run_attempt: attempt,
    status,
  };
}

function pullRequest({
  liveBaseSha = baseSha,
  liveHeadSha = preparedHeadSha,
} = {}) {
  return {
    base: {
      ref: "main",
      repo: { full_name: repository },
      sha: liveBaseSha,
    },
    draft: false,
    head: {
      ref: headRef,
      repo: { full_name: repository },
      sha: liveHeadSha,
    },
    state: "open",
    user: { login: "dependabot[bot]", type: "Bot" },
  };
}

function operationChecksPath(head, name, page = 1) {
  return (
    `repos/${repository}/commits/${head}/check-runs?` +
    `check_name=${encodeURIComponent(name)}&filter=all&per_page=100&page=${page}`
  );
}

function seedCommit() {
  return {
    author: { login: "dependabot[bot]", type: "Bot" },
    commit: { verification: { reason: "valid", verified: true } },
    committer: { login: "dependabot[bot]", type: "Bot" },
    parents: [],
    sha: seedHeadSha,
  };
}

function check({
  conclusion = "success",
  externalId,
  headSha,
  id,
  name,
  receipt,
}) {
  return {
    app: githubActionsApp(),
    conclusion,
    details_url: `https://github.com/${repository}/runs/${id}`,
    external_id: externalId,
    head_sha: headSha,
    id,
    name,
    output: { text: canonicalReceiptJson(receipt) },
    status: "completed",
  };
}

function requestFromMap(entries) {
  const map = new Map(entries);
  return (path) => {
    assert.ok(map.has(path), `unexpected API request: ${path}`);
    return structuredClone(map.get(path));
  };
}

function options(operation, checkId, operationDigest) {
  return {
    headRef,
    headSha: preparedHeadSha,
    operation,
    operationCheckId: checkId,
    operationDigest,
    prepareAppSlug,
    prepareBotId,
    prepareBotLogin,
    pullRequestNumber,
    repository,
  };
}

function processorPacket({
  attemptNumber,
  packetHeadSha,
  workflowRunAttempt = 1,
  workflowRunId,
  ...overrides
}) {
  return {
    attemptLimit: 2,
    attemptNumber,
    automatic: true,
    baseRef: "main",
    baseSha,
    changedPaths: ["package.json", "pnpm-lock.yaml"],
    dependencyGroup: "tooling",
    dependencyNames: ["vercel"],
    escalation: "manual-review",
    expectedBlobs: [
      {
        mode: "100644",
        path: "package.json",
        sha: "a".repeat(40),
        type: "blob",
      },
    ],
    failures: [
      {
        attribution: "branch",
        detailsUrl: null,
        id: "ci",
        name: "CI sentinel",
      },
    ],
    feedbackThreads: [],
    findings: [],
    forbiddenPaths: [".github/**"],
    headRef,
    headSha: packetHeadSha,
    limits: {
      maxAddedLines: 20,
      maxBytes: 8192,
      maxChanges: 20,
      maxDeletedLines: 20,
      maxFiles: 1,
    },
    mode: "prepare",
    packageEcosystem: "npm",
    permittedPaths: ["package.json"],
    preparable: true,
    pullRequestNumber,
    repository,
    requiredGateIds: ["ci"],
    requireExactHead: true,
    requireHumanApproval: false,
    riskTier: "automatic",
    schema: "dependabot-repair-packet:v2",
    updateType: "patch",
    validationCommands: ["pnpm quality:budgets:test"],
    workflowRunAttempt,
    workflowRunId,
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

function protectedRuntimePacket({
  attemptNumber,
  packetHeadSha,
  workflowRunId,
}) {
  return processorPacket({
    attemptNumber,
    dependencyNames: ["knip", "vercel", "@next/eslint-plugin-next"],
    expectedBlobs: protectedRuntimeInputPaths.map((path) => ({
      mode: "100644",
      path,
      sha: "a".repeat(40),
      type: "blob",
    })),
    failures: [],
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
      schema: "dependabot-protected-runtime-sync:v1",
      sourceSeedHeadSha: seedHeadSha,
      targetVersion: "56.5.0",
      updateType: "minor",
    },
    packetHeadSha,
    permittedPaths: protectedRuntimeRequiredPaths,
    requiredGateIds: DEPENDABOT_CHECK_POLICY.map(({ id }) => id),
    riskTier: "human-merge-npm",
    schema: "dependabot-repair-packet:v3",
    updateType: "minor",
    validationCommands: [
      "pnpm install --frozen-lockfile",
      "pnpm quality:budgets:test",
      "pnpm quality:coverage",
      "pnpm build",
      "pnpm quality:bundle:check",
    ],
    workflowRunId,
  });
}

function repairFixture() {
  const processorRunId = 510;
  const repairRunId = 610;
  const processorCheckId = 110;
  const repairCheckId = 210;
  const packet = processorPacket({
    attemptNumber: 1,
    packetHeadSha: seedHeadSha,
    workflowRunId: processorRunId,
  });
  const packetDigest = digestReceipt(packet);
  const processorCheck = check({
    conclusion: "failure",
    externalId:
      `dependabot-processor:v2:pr=${pullRequestNumber}:head=${seedHeadSha}:` +
      `mode=prepare:repair=1:packet=true:digest=${packetDigest}:` +
      `run=${processorRunId}:attempt=1`,
    headSha: seedHeadSha,
    id: processorCheckId,
    name: "Dependabot Processor",
    receipt: packet,
  });
  const receipt = {
    attempt: 1,
    baseSha,
    headRef,
    headSha: preparedHeadSha,
    packetDigest,
    parentHeadSha: seedHeadSha,
    prepareAppSlug,
    prepareBotId,
    prepareBotLogin,
    processorCheckId,
    pullRequestNumber,
    repository,
    schema: "dependabot-repair:v1",
    state: "completed",
    workflowRunAttempt: 1,
    workflowRunId: repairRunId,
    workflowSha,
  };
  const receiptDigest = digestReceipt(receipt);
  const repairCheck = check({
    externalId:
      `dependabot-repair:v1:pr=${pullRequestNumber}:head=${preparedHeadSha}:` +
      `attempt=1:digest=${receiptDigest}:run=${repairRunId}:run_attempt=1`,
    headSha: preparedHeadSha,
    id: repairCheckId,
    name: "Dependabot Repair",
    receipt,
  });
  const repairCommit = {
    author: { id: prepareBotId, login: prepareBotLogin, type: "Bot" },
    commit: { verification: { reason: "valid", verified: true } },
    committer: githubSystemCommitter,
    parents: [{ sha: seedHeadSha }],
    sha: preparedHeadSha,
  };
  return {
    checkId: repairCheckId,
    entries: [
      [`repos/${repository}/pulls/${pullRequestNumber}`, pullRequest()],
      [`repos/${repository}/check-runs/${repairCheckId}`, repairCheck],
      [`repos/${repository}/check-runs/${processorCheckId}`, processorCheck],
      [
        `repos/${repository}/actions/runs/${repairRunId}`,
        workflowRun({
          event: "repository_dispatch",
          id: repairRunId,
          path: ".github/workflows/dependabot-prepare-repair.yml",
        }),
      ],
      [
        `repos/${repository}/actions/runs/${processorRunId}`,
        workflowRun({
          event: "workflow_run",
          id: processorRunId,
          path: ".github/workflows/dependabot-process.yml",
        }),
      ],
      [`repos/${repository}/commits/${preparedHeadSha}`, repairCommit],
      [`repos/${repository}/commits/${seedHeadSha}`, seedCommit()],
      [
        operationChecksPath(seedHeadSha, "Dependabot Refresh"),
        { check_runs: [], total_count: 0 },
      ],
      [
        operationChecksPath(seedHeadSha, "Dependabot Repair"),
        { check_runs: [], total_count: 0 },
      ],
    ],
    operation: "repair",
    receiptDigest,
  };
}

function refreshFixture({
  completedBaseSha = baseSha,
  liveBaseSha = baseSha,
  requestedBaseSha = baseSha,
} = {}) {
  const requestRunId = 520;
  const completedRunId = 620;
  const requestCheckId = 120;
  const completedCheckId = 220;
  const requestReceipt = {
    baseSha: requestedBaseSha,
    headRef,
    headSha: null,
    parentHeadSha: seedHeadSha,
    prepareAppSlug,
    prepareBotId,
    prepareBotLogin,
    previousBaseSha,
    pullRequestNumber,
    repository,
    schema: "dependabot-refresh:v1",
    state: "requested",
    workflowRunAttempt: 1,
    workflowRunId: requestRunId,
    workflowSha,
  };
  const requestDigest = digestReceipt(requestReceipt);
  const requestedCheck = check({
    externalId:
      `dependabot-refresh:v1:pr=${pullRequestNumber}:head=${seedHeadSha}:` +
      `state=requested:digest=${requestDigest}:run=${requestRunId}:attempt=1`,
    headSha: seedHeadSha,
    id: requestCheckId,
    name: "Dependabot Refresh",
    receipt: requestReceipt,
  });
  const completedReceipt = {
    ...requestReceipt,
    baseSha: completedBaseSha,
    headSha: preparedHeadSha,
    requestCheckId,
    requestDigest,
    state: "completed",
    workflowRunId: completedRunId,
  };
  const completedDigest = digestReceipt(completedReceipt);
  const completedCheck = check({
    externalId:
      `dependabot-refresh:v1:pr=${pullRequestNumber}:head=${preparedHeadSha}:` +
      `state=completed:digest=${completedDigest}:run=${completedRunId}:attempt=1`,
    headSha: preparedHeadSha,
    id: completedCheckId,
    name: "Dependabot Refresh",
    receipt: completedReceipt,
  });
  return {
    checkId: completedCheckId,
    entries: [
      [
        `repos/${repository}/pulls/${pullRequestNumber}`,
        pullRequest({ liveBaseSha }),
      ],
      [`repos/${repository}/check-runs/${completedCheckId}`, completedCheck],
      [`repos/${repository}/check-runs/${requestCheckId}`, requestedCheck],
      [
        `repos/${repository}/actions/runs/${completedRunId}`,
        workflowRun({
          event: "workflow_run",
          id: completedRunId,
          path: ".github/workflows/dependabot-process.yml",
        }),
      ],
      [
        `repos/${repository}/actions/runs/${requestRunId}`,
        workflowRun({
          event: "workflow_run",
          id: requestRunId,
          path: ".github/workflows/dependabot-process.yml",
        }),
      ],
      [
        `repos/${repository}/commits/${preparedHeadSha}`,
        {
          author: { id: prepareBotId, login: prepareBotLogin, type: "Bot" },
          commit: { verification: { reason: "valid", verified: true } },
          committer: { id: 19864447, login: "web-flow", type: "User" },
          parents: [{ sha: seedHeadSha }, { sha: completedBaseSha }],
          sha: preparedHeadSha,
        },
      ],
      [`repos/${repository}/commits/${seedHeadSha}`, seedCommit()],
      [
        operationChecksPath(seedHeadSha, "Dependabot Refresh"),
        { check_runs: [requestedCheck], total_count: 1 },
      ],
      [
        operationChecksPath(seedHeadSha, "Dependabot Repair"),
        { check_runs: [], total_count: 0 },
      ],
    ],
    operation: "refresh",
    receiptDigest: completedDigest,
  };
}

function recoveredRepairLineageFixture({
  failedRecoveryCount = 0,
  protectedRuntimeSecondRepair = false,
} = {}) {
  assert.ok([0, 1, 2].includes(failedRecoveryCount));
  const laterHeadSha = "9".repeat(40);
  const firstProcessorRunId = 510;
  const firstRepairRunId = 610;
  const recoveryRunId = 611 + failedRecoveryCount;
  const secondProcessorRunId = 710;
  const secondRepairRunId = 810;
  const firstProcessorCheckId = 110;
  const firstRepairCheckId = 210;
  const intentCheckId = 160;
  const secondProcessorCheckId = 310;
  const secondRepairCheckId = 410;
  const actor = {
    id: prepareBotId,
    login: prepareBotLogin,
    type: "Bot",
  };

  const firstPacket = processorPacket({
    attemptNumber: 1,
    packetHeadSha: seedHeadSha,
    workflowRunId: firstProcessorRunId,
  });
  const firstPacketDigest = digestReceipt(firstPacket);
  const firstProcessorCheck = check({
    conclusion: "failure",
    externalId:
      `dependabot-processor:v2:pr=${pullRequestNumber}:head=${seedHeadSha}:` +
      `mode=prepare:repair=1:packet=true:digest=${firstPacketDigest}:` +
      `run=${firstProcessorRunId}:attempt=1`,
    headSha: seedHeadSha,
    id: firstProcessorCheckId,
    name: "Dependabot Processor",
    receipt: firstPacket,
  });
  const firstReceipt = {
    attempt: 1,
    baseSha,
    headRef,
    headSha: preparedHeadSha,
    packetDigest: firstPacketDigest,
    parentHeadSha: seedHeadSha,
    prepareAppSlug,
    prepareBotId,
    prepareBotLogin,
    processorCheckId: firstProcessorCheckId,
    pullRequestNumber,
    repository,
    schema: "dependabot-repair:v1",
    state: "completed",
    workflowRunAttempt: 1,
    workflowRunId: firstRepairRunId,
    workflowSha,
  };
  const firstReceiptDigest = digestReceipt(firstReceipt);
  const firstRepairCheck = check({
    externalId:
      `dependabot-repair:v1:pr=${pullRequestNumber}:head=${preparedHeadSha}:` +
      `attempt=1:digest=${firstReceiptDigest}:run=${firstRepairRunId}:run_attempt=1`,
    headSha: preparedHeadSha,
    id: firstRepairCheckId,
    name: "Dependabot Repair",
    receipt: firstReceipt,
  });
  const edits = [
    {
      contentDigest: "a".repeat(64),
      expectedBlobSha: "6".repeat(40),
      mode: "100644",
      path: "package.json",
      resultBlobSha: "7".repeat(40),
      type: "blob",
    },
  ];
  const intent = {
    attempt: 1,
    baseSha,
    edits,
    editsDigest: digestReceipt(edits),
    headRef,
    headSha: preparedHeadSha,
    packetDigest: firstPacketDigest,
    parentHeadSha: seedHeadSha,
    parentTreeSha: "a".repeat(40),
    prepareAppSlug,
    prepareBotId,
    prepareBotLogin,
    processorCheckId: firstProcessorCheckId,
    pullRequestNumber,
    repository,
    retryCount: 0,
    schema: "dependabot-repair-intent:v1",
    state: "staged",
    treeDigest: digestReceipt({
      parentTreeSha: "a".repeat(40),
      treeSha: "b".repeat(40),
    }),
    treeSha: "b".repeat(40),
    validatedPlanDigest: "c".repeat(64),
    workflowRunAttempt: 1,
    workflowRunId: firstRepairRunId,
    workflowSha,
  };
  const intentDigest = digestReceipt(intent);
  const intentCheck = check({
    externalId:
      `dependabot-repair-intent:v1:pr=${pullRequestNumber}:head=${preparedHeadSha}:` +
      `attempt=1:digest=${intentDigest}:run=${firstRepairRunId}:run_attempt=1`,
    headSha: preparedHeadSha,
    id: intentCheckId,
    name: "Dependabot Repair Intent",
    receipt: intent,
  });
  const recoveryEvidence = Array.from(
    { length: failedRecoveryCount + 1 },
    (_, retryCount) => {
      const runId = 611 + retryCount;
      const checkId = 211 + retryCount;
      const receipt = { ...firstReceipt, workflowRunId: runId };
      const receiptDigest = digestReceipt(receipt);
      return {
        check: check({
          externalId:
            `dependabot-repair:v1:pr=${pullRequestNumber}:head=${preparedHeadSha}:` +
            `attempt=1:digest=${receiptDigest}:run=${runId}:run_attempt=1`,
          headSha: preparedHeadSha,
          id: checkId,
          name: "Dependabot Repair",
          receipt,
        }),
        receiptDigest,
        retryCount,
        run: workflowRun({
          actor,
          conclusion: retryCount < failedRecoveryCount ? "failure" : "success",
          displayTitle:
            `dependabot-repair-recover:v1 | pr=${pullRequestNumber} | ` +
            `head=${preparedHeadSha} | check=${intentCheckId} | ` +
            `digest=${intentDigest} | retry=${retryCount}`,
          event: "repository_dispatch",
          id: runId,
          path: ".github/workflows/dependabot-prepare-repair.yml",
        }),
        runId,
      };
    },
  );
  const recoveryCheck = recoveryEvidence.at(-1).check;
  const recoveryDigest = recoveryEvidence.at(-1).receiptDigest;

  const secondPacket = protectedRuntimeSecondRepair
    ? protectedRuntimePacket({
        attemptNumber: 2,
        packetHeadSha: preparedHeadSha,
        workflowRunId: secondProcessorRunId,
      })
    : processorPacket({
        attemptNumber: 2,
        packetHeadSha: preparedHeadSha,
        workflowRunId: secondProcessorRunId,
      });
  const secondPacketDigest = digestReceipt(secondPacket);
  const secondProcessorCheck = check({
    conclusion: "failure",
    externalId:
      `dependabot-processor:v2:pr=${pullRequestNumber}:head=${preparedHeadSha}:` +
      `mode=prepare:repair=2:packet=true:digest=${secondPacketDigest}:` +
      `run=${secondProcessorRunId}:attempt=1`,
    headSha: preparedHeadSha,
    id: secondProcessorCheckId,
    name: "Dependabot Processor",
    receipt: secondPacket,
  });
  const secondReceipt = {
    attempt: 2,
    baseSha,
    headRef,
    headSha: laterHeadSha,
    packetDigest: secondPacketDigest,
    parentHeadSha: preparedHeadSha,
    prepareAppSlug,
    prepareBotId,
    prepareBotLogin,
    processorCheckId: secondProcessorCheckId,
    pullRequestNumber,
    repository,
    schema: "dependabot-repair:v1",
    state: "completed",
    workflowRunAttempt: 1,
    workflowRunId: secondRepairRunId,
    workflowSha,
  };
  const secondReceiptDigest = digestReceipt(secondReceipt);
  const secondRepairCheck = check({
    externalId:
      `dependabot-repair:v1:pr=${pullRequestNumber}:head=${laterHeadSha}:` +
      `attempt=2:digest=${secondReceiptDigest}:run=${secondRepairRunId}:run_attempt=1`,
    headSha: laterHeadSha,
    id: secondRepairCheckId,
    name: "Dependabot Repair",
    receipt: secondReceipt,
  });

  const entries = [
    [
      `repos/${repository}/pulls/${pullRequestNumber}`,
      pullRequest({ liveHeadSha: laterHeadSha }),
    ],
    [
      `repos/${repository}/check-runs/${secondRepairCheckId}`,
      secondRepairCheck,
    ],
    [
      `repos/${repository}/check-runs/${secondProcessorCheckId}`,
      secondProcessorCheck,
    ],
    [
      `repos/${repository}/check-runs/${firstProcessorCheckId}`,
      firstProcessorCheck,
    ],
    [`repos/${repository}/check-runs/${intentCheckId}`, intentCheck],
    [
      `repos/${repository}/actions/runs/${secondRepairRunId}`,
      workflowRun({
        actor,
        event: "repository_dispatch",
        id: secondRepairRunId,
        path: ".github/workflows/dependabot-prepare-repair.yml",
      }),
    ],
    [
      `repos/${repository}/actions/runs/${secondProcessorRunId}`,
      workflowRun({
        event: "workflow_run",
        id: secondProcessorRunId,
        path: ".github/workflows/dependabot-process.yml",
      }),
    ],
    [
      `repos/${repository}/actions/runs/${firstRepairRunId}`,
      workflowRun({
        actor,
        conclusion: "failure",
        displayTitle:
          `dependabot-repair:v1 | pr=${pullRequestNumber} | head=${seedHeadSha} | ` +
          `check=${firstProcessorCheckId} | digest=${firstPacketDigest} | retry=0`,
        event: "repository_dispatch",
        id: firstRepairRunId,
        path: ".github/workflows/dependabot-prepare-repair.yml",
      }),
    ],
    ...recoveryEvidence.map(({ run, runId }) => [
      `repos/${repository}/actions/runs/${runId}`,
      run,
    ]),
    [
      `repos/${repository}/actions/runs/${firstProcessorRunId}`,
      workflowRun({
        event: "workflow_run",
        id: firstProcessorRunId,
        path: ".github/workflows/dependabot-process.yml",
      }),
    ],
    [
      `repos/${repository}/commits/${laterHeadSha}`,
      {
        author: actor,
        commit: { verification: { reason: "valid", verified: true } },
        committer: githubSystemCommitter,
        parents: [{ sha: preparedHeadSha }],
        sha: laterHeadSha,
      },
    ],
    [
      `repos/${repository}/commits/${preparedHeadSha}`,
      {
        author: actor,
        commit: { verification: { reason: "valid", verified: true } },
        committer: githubSystemCommitter,
        parents: [{ sha: seedHeadSha }],
        sha: preparedHeadSha,
      },
    ],
    [`repos/${repository}/commits/${seedHeadSha}`, seedCommit()],
    [
      operationChecksPath(preparedHeadSha, "Dependabot Refresh"),
      { check_runs: [], total_count: 0 },
    ],
    [
      operationChecksPath(preparedHeadSha, "Dependabot Repair"),
      {
        check_runs: [
          firstRepairCheck,
          ...recoveryEvidence.map(({ check: recovery }) => recovery),
        ],
        total_count: 1 + recoveryEvidence.length,
      },
    ],
    [
      operationChecksPath(seedHeadSha, "Dependabot Refresh"),
      { check_runs: [], total_count: 0 },
    ],
    [
      operationChecksPath(seedHeadSha, "Dependabot Repair"),
      { check_runs: [], total_count: 0 },
    ],
  ];
  return {
    entries,
    firstRepairCheck,
    firstRepairRunId,
    firstProcessorRunId,
    intentCheckId,
    intentDigest,
    laterHeadSha,
    operation: "repair",
    recoveryCheck,
    recoveryDigest,
    recoveryEvidence,
    recoveryRunId,
    secondReceiptDigest,
    secondRepairCheckId,
  };
}

function replaceEntry(entries, path, update) {
  return entries.map(([key, value]) =>
    key === path ? [key, update(structuredClone(value))] : [key, value],
  );
}

test("canonical receipt JSON recursively sorts keys", () => {
  assert.equal(
    canonicalReceiptJson({ z: [{ b: 2, a: 1 }], a: { d: 4, c: 3 } }),
    '{"a":{"c":3,"d":4},"z":[{"a":1,"b":2}]}',
  );
});

test("accepts an exact App-authored repair rooted in a verified Dependabot seed", () => {
  const fixture = repairFixture();
  const result = validatePreparedReviewTarget(
    options(fixture.operation, fixture.checkId, fixture.receiptDigest),
    requestFromMap(fixture.entries),
  );
  assert.deepEqual(result, {
    headSha: preparedHeadSha,
    operationDigests: [fixture.receiptDigest],
    prepareAppSlug,
    prepareBotId,
    prepareBotLogin,
    pullRequestNumber,
    refreshCount: 0,
    repairCount: 1,
    repository,
    seedHeadSha,
  });
});

test("also accepts an exact App bot as the verified Repair committer", () => {
  const fixture = repairFixture();
  const path = `repos/${repository}/commits/${preparedHeadSha}`;
  const entries = fixture.entries.map(([key, value]) =>
    key === path
      ? [
          key,
          {
            ...value,
            committer: {
              id: prepareBotId,
              login: prepareBotLogin,
              type: "Bot",
            },
          },
        ]
      : [key, value],
  );
  assert.equal(
    validatePreparedReviewTarget(
      options(fixture.operation, fixture.checkId, fixture.receiptDigest),
      requestFromMap(entries),
    ).repairCount,
    1,
  );
});

test("uses a successful recovery receipt after a failed receipt when later prepared lineage continues", () => {
  const fixture = recoveredRepairLineageFixture();
  const result = validatePreparedReviewTarget(
    {
      ...options(
        fixture.operation,
        fixture.secondRepairCheckId,
        fixture.secondReceiptDigest,
      ),
      headSha: fixture.laterHeadSha,
    },
    requestFromMap(fixture.entries),
  );
  assert.deepEqual(result, {
    headSha: fixture.laterHeadSha,
    operationDigests: [fixture.recoveryDigest, fixture.secondReceiptDigest],
    prepareAppSlug,
    prepareBotId,
    prepareBotLogin,
    pullRequestNumber,
    refreshCount: 0,
    repairCount: 2,
    repository,
    seedHeadSha,
  });
});

test("accepts a v2 repair followed by a packet-bound v3 protected-runtime sync", () => {
  const fixture = recoveredRepairLineageFixture({
    protectedRuntimeSecondRepair: true,
  });
  const result = validatePreparedReviewTarget(
    {
      ...options(
        fixture.operation,
        fixture.secondRepairCheckId,
        fixture.secondReceiptDigest,
      ),
      headSha: fixture.laterHeadSha,
    },
    requestFromMap(fixture.entries),
  );
  assert.equal(result.repairCount, 2);
  assert.deepEqual(result.operationDigests, [
    fixture.recoveryDigest,
    fixture.secondReceiptDigest,
  ]);
});

test("accepts a continuing lineage after one failed recovery retry", () => {
  const fixture = recoveredRepairLineageFixture({ failedRecoveryCount: 1 });
  const result = validatePreparedReviewTarget(
    {
      ...options(
        fixture.operation,
        fixture.secondRepairCheckId,
        fixture.secondReceiptDigest,
      ),
      headSha: fixture.laterHeadSha,
    },
    requestFromMap(fixture.entries),
  );
  assert.equal(result.repairCount, 2);
  assert.deepEqual(result.operationDigests, [
    fixture.recoveryDigest,
    fixture.secondReceiptDigest,
  ]);
});

test("accepts a continuing lineage after two failed recovery retries", () => {
  const fixture = recoveredRepairLineageFixture({ failedRecoveryCount: 2 });
  const result = validatePreparedReviewTarget(
    {
      ...options(
        fixture.operation,
        fixture.secondRepairCheckId,
        fixture.secondReceiptDigest,
      ),
      headSha: fixture.laterHeadSha,
    },
    requestFromMap(fixture.entries),
  );
  assert.equal(result.repairCount, 2);
  assert.deepEqual(result.operationDigests, [
    fixture.recoveryDigest,
    fixture.secondReceiptDigest,
  ]);
});

test("uses a historical Processor packet's recorded attempt after its run is rerun", () => {
  const fixture = recoveredRepairLineageFixture();
  const runPath = `repos/${repository}/actions/runs/${fixture.firstProcessorRunId}`;
  const attemptPath = `${runPath}/attempts/1`;
  const recordedAttempt = structuredClone(
    new Map(fixture.entries).get(runPath),
  );
  let entries = replaceEntry(fixture.entries, runPath, (run) => ({
    ...run,
    run_attempt: 2,
  }));
  entries.push([attemptPath, recordedAttempt]);
  const result = validatePreparedReviewTarget(
    {
      ...options(
        fixture.operation,
        fixture.secondRepairCheckId,
        fixture.secondReceiptDigest,
      ),
      headSha: fixture.laterHeadSha,
    },
    requestFromMap(entries),
  );
  assert.equal(result.repairCount, 2);
  assert.deepEqual(result.operationDigests, [
    fixture.recoveryDigest,
    fixture.secondReceiptDigest,
  ]);
});

test("rejects a missing, mismatched, or failed recorded Processor attempt", () => {
  const scenarios = [
    {
      label: "missing attempt",
      pattern: /unexpected API request: .*\/attempts\/1/,
    },
    {
      attempt: (run) => ({ ...run, run_attempt: 2 }),
      label: "mismatched attempt",
      pattern: /repair packet Processor workflow provenance is invalid/,
    },
    {
      attempt: (run) => ({ ...run, conclusion: "failure" }),
      label: "failed attempt",
      pattern: /repair packet Processor workflow provenance is invalid/,
    },
  ];
  for (const scenario of scenarios) {
    const fixture = recoveredRepairLineageFixture();
    const runPath = `repos/${repository}/actions/runs/${fixture.firstProcessorRunId}`;
    const attemptPath = `${runPath}/attempts/1`;
    const recordedAttempt = structuredClone(
      new Map(fixture.entries).get(runPath),
    );
    const entries = replaceEntry(fixture.entries, runPath, (run) => ({
      ...run,
      run_attempt: 2,
    }));
    if (scenario.attempt !== undefined) {
      entries.push([attemptPath, scenario.attempt(recordedAttempt)]);
    }
    assert.throws(
      () =>
        validatePreparedReviewTarget(
          {
            ...options(
              fixture.operation,
              fixture.secondRepairCheckId,
              fixture.secondReceiptDigest,
            ),
            headSha: fixture.laterHeadSha,
          },
          requestFromMap(entries),
        ),
      scenario.pattern,
      scenario.label,
    );
  }
});

test("rejects malformed, untrusted, in-progress, and non-retryable failed receipts before recovery", () => {
  const listingPath = operationChecksPath(preparedHeadSha, "Dependabot Repair");
  const scenarios = [
    {
      label: "Repair check disguised as a request",
      mutate: (fixture) =>
        replaceEntry(fixture.entries, listingPath, (response) => ({
          ...response,
          check_runs: response.check_runs.map((candidate) =>
            candidate.id === fixture.firstRepairCheck.id
              ? {
                  ...candidate,
                  output: {
                    text: canonicalReceiptJson({ state: "requested" }),
                  },
                }
              : candidate,
          ),
        })),
      pattern: /only an exact Refresh check may have requested state/,
    },
    {
      label: "malformed receipt",
      mutate: (fixture) =>
        replaceEntry(fixture.entries, listingPath, (response) => ({
          ...response,
          check_runs: response.check_runs.map((candidate) =>
            candidate.id === fixture.firstRepairCheck.id
              ? { ...candidate, output: { text: "{" } }
              : candidate,
          ),
        })),
      pattern: /malformed operation check/,
    },
    {
      label: "untrusted actor",
      mutate: (fixture) =>
        replaceEntry(
          fixture.entries,
          `repos/${repository}/actions/runs/${fixture.firstRepairRunId}`,
          (run) => ({
            ...run,
            actor: { id: 123, login: "attacker[bot]", type: "Bot" },
          }),
        ),
      pattern: /run actor is not the trusted Prepare App/,
    },
    {
      label: "in-progress run",
      mutate: (fixture) =>
        replaceEntry(
          fixture.entries,
          `repos/${repository}/actions/runs/${fixture.firstRepairRunId}`,
          (run) => ({ ...run, conclusion: null, status: "in_progress" }),
        ),
      pattern: /workflow provenance is invalid/,
    },
    {
      label: "non-retryable run",
      mutate: (fixture) =>
        replaceEntry(
          fixture.entries,
          `repos/${repository}/actions/runs/${fixture.firstRepairRunId}`,
          (run) => ({ ...run, conclusion: "neutral" }),
        ),
      pattern: /workflow provenance is invalid/,
    },
  ];
  for (const scenario of scenarios) {
    const fixture = recoveredRepairLineageFixture();
    assert.throws(
      () =>
        validatePreparedReviewTarget(
          {
            ...options(
              fixture.operation,
              fixture.secondRepairCheckId,
              fixture.secondReceiptDigest,
            ),
            headSha: fixture.laterHeadSha,
          },
          requestFromMap(scenario.mutate(fixture)),
        ),
      scenario.pattern,
      scenario.label,
    );
  }
});

test("rejects malformed, untrusted, in-progress, and non-retryable failed recovery receipts", () => {
  const listingPath = operationChecksPath(preparedHeadSha, "Dependabot Repair");
  const scenarios = [
    {
      label: "malformed failed recovery receipt",
      mutate: (fixture) => {
        const failedRecovery = fixture.recoveryEvidence[0];
        return replaceEntry(fixture.entries, listingPath, (response) => ({
          ...response,
          check_runs: response.check_runs.map((candidate) =>
            candidate.id === failedRecovery.check.id
              ? { ...candidate, output: { text: "{" } }
              : candidate,
          ),
        }));
      },
      pattern: /malformed operation check/,
    },
    {
      label: "untrusted failed recovery actor",
      mutate: (fixture) =>
        replaceEntry(
          fixture.entries,
          `repos/${repository}/actions/runs/${fixture.recoveryEvidence[0].runId}`,
          (run) => ({
            ...run,
            actor: { id: 123, login: "attacker[bot]", type: "Bot" },
          }),
        ),
      pattern: /run actor is not the trusted Prepare App/,
    },
    {
      label: "in-progress failed recovery run",
      mutate: (fixture) =>
        replaceEntry(
          fixture.entries,
          `repos/${repository}/actions/runs/${fixture.recoveryEvidence[0].runId}`,
          (run) => ({ ...run, conclusion: null, status: "in_progress" }),
        ),
      pattern: /workflow provenance is invalid/,
    },
    {
      label: "non-retryable failed recovery run",
      mutate: (fixture) =>
        replaceEntry(
          fixture.entries,
          `repos/${repository}/actions/runs/${fixture.recoveryEvidence[0].runId}`,
          (run) => ({ ...run, conclusion: "neutral" }),
        ),
      pattern: /workflow provenance is invalid/,
    },
  ];
  for (const scenario of scenarios) {
    const fixture = recoveredRepairLineageFixture({ failedRecoveryCount: 1 });
    assert.throws(
      () =>
        validatePreparedReviewTarget(
          {
            ...options(
              fixture.operation,
              fixture.secondRepairCheckId,
              fixture.secondReceiptDigest,
            ),
            headSha: fixture.laterHeadSha,
          },
          requestFromMap(scenario.mutate(fixture)),
        ),
      scenario.pattern,
      scenario.label,
    );
  }
});

test("rejects missing, duplicated, skipped, mismatched-intent, and out-of-order recovery retry evidence", () => {
  const listingPath = operationChecksPath(preparedHeadSha, "Dependabot Repair");
  const scenarios = [
    {
      build: () => {
        const fixture = recoveredRepairLineageFixture({
          failedRecoveryCount: 1,
        });
        const failedRecovery = fixture.recoveryEvidence[0];
        return {
          entries: replaceEntry(
            fixture.entries,
            `repos/${repository}/actions/runs/${failedRecovery.runId}`,
            (run) => ({
              ...run,
              display_title: `${run.display_title} trailing`,
            }),
          ),
          fixture,
        };
      },
      label: "malformed recovery title",
      pattern: /recovery run title does not bind its receipt/,
    },
    {
      build: () => {
        const fixture = recoveredRepairLineageFixture({
          failedRecoveryCount: 1,
        });
        const failedRecovery = fixture.recoveryEvidence[0];
        return {
          entries: replaceEntry(
            fixture.entries,
            `repos/${repository}/actions/runs/${failedRecovery.runId}`,
            (run) => ({
              ...run,
              display_title: run.display_title.replace(
                /digest=[0-9a-f]{64}/,
                `digest=${"d".repeat(64)}`,
              ),
            }),
          ),
          fixture,
        };
      },
      label: "mismatched recovery intent",
      pattern: /does not bind the canonical intent and operation/,
    },
    {
      build: () => {
        const fixture = recoveredRepairLineageFixture({
          failedRecoveryCount: 1,
        });
        const failedRecovery = fixture.recoveryEvidence[0];
        return {
          entries: replaceEntry(
            fixture.entries,
            `repos/${repository}/actions/runs/${failedRecovery.runId}`,
            (run) => ({
              ...run,
              display_title: run.display_title.replace("retry=0", "retry=1"),
            }),
          ),
          fixture,
        };
      },
      label: "duplicated retry number",
      pattern: /retries are missing, duplicated, or out of order/,
    },
    {
      build: () => {
        const fixture = recoveredRepairLineageFixture({
          failedRecoveryCount: 2,
        });
        const skipped = fixture.recoveryEvidence[1];
        return {
          entries: replaceEntry(fixture.entries, listingPath, (response) => ({
            check_runs: response.check_runs.filter(
              (candidate) => candidate.id !== skipped.check.id,
            ),
            total_count: response.total_count - 1,
          })),
          fixture,
        };
      },
      label: "missing skipped retry",
      pattern: /retries are missing, duplicated, or out of order/,
    },
    {
      build: () => {
        const fixture = recoveredRepairLineageFixture({
          failedRecoveryCount: 1,
        });
        const failedRecovery = fixture.recoveryEvidence[0];
        const duplicate = {
          ...structuredClone(failedRecovery.check),
          details_url: `https://github.com/${repository}/actions/runs/${failedRecovery.runId}`,
          id: 250,
        };
        return {
          entries: replaceEntry(fixture.entries, listingPath, (response) => ({
            check_runs: [...response.check_runs, duplicate],
            total_count: response.total_count + 1,
          })),
          fixture,
        };
      },
      label: "duplicate failed retry evidence",
      pattern: /retries are missing, duplicated, or out of order/,
    },
    {
      build: () => {
        const fixture = recoveredRepairLineageFixture({
          failedRecoveryCount: 1,
        });
        const failedRecovery = fixture.recoveryEvidence[0];
        return {
          entries: replaceEntry(fixture.entries, listingPath, (response) => ({
            ...response,
            check_runs: response.check_runs.map((candidate) =>
              candidate.id === failedRecovery.check.id
                ? {
                    ...candidate,
                    details_url: `https://github.com/${repository}/actions/runs/${failedRecovery.runId}`,
                    id: 999,
                  }
                : candidate,
            ),
          })),
          fixture,
        };
      },
      label: "out-of-order recovery checks",
      pattern: /not in strict check order/,
    },
    {
      build: () => {
        const fixture = recoveredRepairLineageFixture({
          failedRecoveryCount: 1,
        });
        return {
          entries: fixture.entries.filter(
            ([path]) =>
              path !==
              `repos/${repository}/check-runs/${fixture.intentCheckId}`,
          ),
          fixture,
        };
      },
      label: "missing canonical intent",
      pattern: /unexpected API request: .*\/check-runs\//,
    },
  ];
  for (const scenario of scenarios) {
    const { entries, fixture } = scenario.build();
    assert.throws(
      () =>
        validatePreparedReviewTarget(
          {
            ...options(
              fixture.operation,
              fixture.secondRepairCheckId,
              fixture.secondReceiptDigest,
            ),
            headSha: fixture.laterHeadSha,
          },
          requestFromMap(entries),
        ),
      scenario.pattern,
      scenario.label,
    );
  }
});

test("rejects recovery that does not bind the exact failed-run intent", () => {
  const fixture = recoveredRepairLineageFixture();
  const entries = replaceEntry(
    fixture.entries,
    `repos/${repository}/actions/runs/${fixture.recoveryRunId}`,
    (run) => ({
      ...run,
      display_title: run.display_title.replace(
        /digest=[0-9a-f]{64}/,
        `digest=${"d".repeat(64)}`,
      ),
    }),
  );
  assert.throws(
    () =>
      validatePreparedReviewTarget(
        {
          ...options(
            fixture.operation,
            fixture.secondRepairCheckId,
            fixture.secondReceiptDigest,
          ),
          headSha: fixture.laterHeadSha,
        },
        requestFromMap(entries),
      ),
    /does not exactly supersede the failed receipt/,
  );
});

test("rejects multiple successful historical repair authorities around recovery", () => {
  const fixture = recoveredRepairLineageFixture();
  const duplicateRunId = 612;
  const duplicateCheckId = 212;
  const receipt = JSON.parse(fixture.firstRepairCheck.output.text);
  receipt.workflowRunId = duplicateRunId;
  const receiptDigest = digestReceipt(receipt);
  const duplicateCheck = check({
    externalId:
      `dependabot-repair:v1:pr=${pullRequestNumber}:head=${preparedHeadSha}:` +
      `attempt=1:digest=${receiptDigest}:run=${duplicateRunId}:run_attempt=1`,
    headSha: preparedHeadSha,
    id: duplicateCheckId,
    name: "Dependabot Repair",
    receipt,
  });
  const listingPath = operationChecksPath(preparedHeadSha, "Dependabot Repair");
  const entries = replaceEntry(fixture.entries, listingPath, (response) => ({
    check_runs: [...response.check_runs, duplicateCheck],
    total_count: response.total_count + 1,
  }));
  entries.push([
    `repos/${repository}/actions/runs/${duplicateRunId}`,
    workflowRun({
      actor: { id: prepareBotId, login: prepareBotLogin, type: "Bot" },
      event: "repository_dispatch",
      id: duplicateRunId,
      path: ".github/workflows/dependabot-prepare-repair.yml",
    }),
  ]);
  assert.throws(
    () =>
      validatePreparedReviewTarget(
        {
          ...options(
            fixture.operation,
            fixture.secondRepairCheckId,
            fixture.secondReceiptDigest,
          ),
          headSha: fixture.laterHeadSha,
        },
        requestFromMap(entries),
      ),
    /prepared lineage has ambiguous receipts/,
  );
});

test("historical lineage ignores more than 100 unrelated Processor checks", () => {
  const fixture = repairFixture();
  const broadPath = `repos/${repository}/commits/${seedHeadSha}/check-runs?filter=all&per_page=100`;
  fixture.entries.push([
    broadPath,
    {
      check_runs: Array.from({ length: 100 }, (_, index) => ({
        id: 10_000 + index,
        name: "Dependabot Processor",
      })),
      total_count: 150,
    },
  ]);
  const requestedPaths = [];
  const respond = requestFromMap(fixture.entries);
  const result = validatePreparedReviewTarget(
    options(fixture.operation, fixture.checkId, fixture.receiptDigest),
    (path) => {
      requestedPaths.push(path);
      return respond(path);
    },
  );
  assert.equal(result.repairCount, 1);
  assert.ok(!requestedPaths.includes(broadPath));
  assert.ok(
    requestedPaths
      .filter((path) => path.includes("/check-runs?"))
      .every((path) => path.includes("check_name=Dependabot%20")),
  );
});

test("accepts a completed refresh only with its exact old-head request", () => {
  const fixture = refreshFixture({ requestedBaseSha: "6".repeat(40) });
  const result = validatePreparedReviewTarget(
    options(fixture.operation, fixture.checkId, fixture.receiptDigest),
    requestFromMap(fixture.entries),
  );
  assert.equal(result.refreshCount, 1);
  assert.equal(result.repairCount, 0);
  assert.equal(result.seedHeadSha, seedHeadSha);
});

test("binds an applied refresh base to the current main ancestry", () => {
  const appliedBaseSha = "6".repeat(40);
  const requestJson = requestFromMap([
    [
      `repos/${repository}/compare/${appliedBaseSha}...${baseSha}`,
      {
        ahead_by: 2,
        base_commit: { sha: appliedBaseSha },
        behind_by: 0,
        merge_base_commit: { sha: appliedBaseSha },
        status: "ahead",
      },
    ],
  ]);
  assert.doesNotThrow(() =>
    validateAppliedBaseOnCurrentMain({
      appliedBaseSha,
      currentBaseSha: baseSha,
      repository,
      requestJson,
    }),
  );
  assert.throws(
    () =>
      validateAppliedBaseOnCurrentMain({
        appliedBaseSha,
        currentBaseSha: baseSha,
        repository,
        requestJson: () => ({
          ahead_by: 0,
          base_commit: { sha: appliedBaseSha },
          behind_by: 1,
          merge_base_commit: { sha: "7".repeat(40) },
          status: "diverged",
        }),
      }),
    /refresh base is not on the current main lineage/,
  );
});

test("a refresh applied to an obsolete base is not current review authority", () => {
  const fixture = refreshFixture({ liveBaseSha: "7".repeat(40) });
  assert.throws(
    () =>
      validatePreparedReviewTarget(
        options(fixture.operation, fixture.checkId, fixture.receiptDigest),
        requestFromMap(fixture.entries),
      ),
    /prepared head is not bound to the current main base/,
  );
});

test("rejects a repair commit whose bot identity is only asserted in receipt JSON", () => {
  const fixture = repairFixture();
  const path = `repos/${repository}/commits/${preparedHeadSha}`;
  const entries = fixture.entries.map(([key, value]) =>
    key === path
      ? [
          key,
          {
            ...value,
            author: { id: 123, login: "attacker[bot]", type: "Bot" },
          },
        ]
      : [key, value],
  );
  assert.throws(
    () =>
      validatePreparedReviewTarget(
        options(fixture.operation, fixture.checkId, fixture.receiptDigest),
        requestFromMap(entries),
      ),
    /repair commit is not an exact Prepare App append/,
  );
});

test("rejects inexact GitHub system committers on a Repair commit", () => {
  const path = `repos/${repository}/commits/${preparedHeadSha}`;
  for (const committer of [
    { ...githubSystemCommitter, id: githubSystemCommitter.id + 1 },
    { ...githubSystemCommitter, login: "attacker" },
    { ...githubSystemCommitter, type: "Bot" },
  ]) {
    const fixture = repairFixture();
    const entries = fixture.entries.map(([key, value]) =>
      key === path ? [key, { ...value, committer }] : [key, value],
    );
    assert.throws(
      () =>
        validatePreparedReviewTarget(
          options(fixture.operation, fixture.checkId, fixture.receiptDigest),
          requestFromMap(entries),
        ),
      /repair commit is not an exact Prepare App append/,
      JSON.stringify(committer),
    );
  }
});

test("rejects unsigned and invalid-reason Repair commits", () => {
  const path = `repos/${repository}/commits/${preparedHeadSha}`;
  for (const verification of [
    { reason: "unsigned", verified: false },
    { reason: "unknown_key", verified: true },
  ]) {
    const fixture = repairFixture();
    const entries = fixture.entries.map(([key, value]) =>
      key === path
        ? [
            key,
            {
              ...value,
              commit: { verification },
            },
          ]
        : [key, value],
    );
    assert.throws(
      () =>
        validatePreparedReviewTarget(
          options(fixture.operation, fixture.checkId, fixture.receiptDigest),
          requestFromMap(entries),
        ),
      /repair commit is not an exact Prepare App append/,
      JSON.stringify(verification),
    );
  }
});

test("rejects a successful operation check backed by an incomplete workflow run", () => {
  const fixture = repairFixture();
  const path = `repos/${repository}/actions/runs/610`;
  const entries = fixture.entries.map(([key, value]) =>
    key === path
      ? [key, { ...value, conclusion: null, status: "in_progress" }]
      : [key, value],
  );
  assert.throws(
    () =>
      validatePreparedReviewTarget(
        options(fixture.operation, fixture.checkId, fixture.receiptDigest),
        requestFromMap(entries),
      ),
    /workflow provenance is invalid/,
  );
});

test("rejects a refresh that is not the exact two-parent append", () => {
  const fixture = refreshFixture();
  const path = `repos/${repository}/commits/${preparedHeadSha}`;
  const entries = fixture.entries.map(([key, value]) =>
    key === path
      ? [key, { ...value, parents: [{ sha: seedHeadSha }] }]
      : [key, value],
  );
  assert.throws(
    () =>
      validatePreparedReviewTarget(
        options(fixture.operation, fixture.checkId, fixture.receiptDigest),
        requestFromMap(entries),
      ),
    /refresh is not the exact append-only two-parent merge/,
  );
});

test("rejects refresh lineage without exact bot authorship and verification", () => {
  const fixture = refreshFixture();
  const path = `repos/${repository}/commits/${preparedHeadSha}`;
  for (const replacement of [
    { author: { id: 123, login: "attacker[bot]", type: "Bot" } },
    { commit: { verification: { reason: "unsigned", verified: false } } },
    { committer: { id: 123, login: "web-flow", type: "User" } },
  ]) {
    const entries = fixture.entries.map(([key, value]) =>
      key === path ? [key, { ...value, ...replacement }] : [key, value],
    );
    assert.throws(
      () =>
        validatePreparedReviewTarget(
          options(fixture.operation, fixture.checkId, fixture.receiptDigest),
          requestFromMap(entries),
        ),
      /refresh is not the exact append-only two-parent merge/,
    );
  }
});

test("rejects a refresh whose request and completion disagree on the old base", () => {
  const fixture = refreshFixture();
  const requestPath = `repos/${repository}/check-runs/120`;
  const completedPath = `repos/${repository}/check-runs/220`;
  const entries = new Map(fixture.entries);
  const requestedCheck = structuredClone(entries.get(requestPath));
  const requestedReceipt = JSON.parse(requestedCheck.output.text);
  requestedReceipt.previousBaseSha = "8".repeat(40);
  const requestDigest = digestReceipt(requestedReceipt);
  requestedCheck.output.text = canonicalReceiptJson(requestedReceipt);
  requestedCheck.external_id =
    `dependabot-refresh:v1:pr=${pullRequestNumber}:head=${seedHeadSha}:` +
    `state=requested:digest=${requestDigest}:run=520:attempt=1`;
  entries.set(requestPath, requestedCheck);

  const completedCheck = structuredClone(entries.get(completedPath));
  const completedReceipt = JSON.parse(completedCheck.output.text);
  completedReceipt.requestDigest = requestDigest;
  const completedDigest = digestReceipt(completedReceipt);
  completedCheck.output.text = canonicalReceiptJson(completedReceipt);
  completedCheck.external_id =
    `dependabot-refresh:v1:pr=${pullRequestNumber}:head=${preparedHeadSha}:` +
    `state=completed:digest=${completedDigest}:run=620:attempt=1`;
  entries.set(completedPath, completedCheck);

  assert.throws(
    () =>
      validatePreparedReviewTarget(
        options(fixture.operation, fixture.checkId, completedDigest),
        requestFromMap(entries),
      ),
    /refresh request receipt does not bind the completed refresh/,
  );
});

test("prepared-head intake is an exact credentialless bounded dispatch", () => {
  const intake = workflow(
    ".github/workflows/dependabot-prepared-head-intake.yml",
  );
  assert.equal(intake.name, "Dependabot Prepared Head Intake");
  assert.deepEqual(intake.on, {
    repository_dispatch: { types: ["dependabot-prepared-head"] },
  });
  assert.deepEqual(intake.permissions, {});
  assert.match(intake["run-name"], /dependabot-prepared-head:v1\|p=/);
  assert.doesNotMatch(intake["run-name"], /headRef|parentHeadSha|externalId/);
  const longestTitle =
    `dependabot-prepared-head:v1|p=${"9".repeat(10)}|h=${"a".repeat(40)}|` +
    `o=r|c=${"9".repeat(20)}|d=${"b".repeat(64)}|ok=true`;
  assert.ok(longestTitle.length <= 220, String(longestTitle.length));

  const job = intake.jobs["validate-receipt"];
  assert.equal(Object.hasOwn(job, "permissions"), false);
  assert.equal(job.steps.length, 1);
  assert.equal(Object.hasOwn(job.steps[0], "uses"), false);
  assert.match(job.if, /DEPENDABOT_PROCESSOR_PREPARE_BOT_ID/);
  assert.match(job.if, /DEPENDABOT_PROCESSOR_PREPARE_BOT_LOGIN/);
  assert.match(job.if, /DEPENDABOT_PROCESSOR_PREPARE_APP_SLUG/);
  assert.doesNotMatch(
    job.steps[0].run,
    /\bgh\b|curl|checkout|artifact|cache|install/,
  );
});

test("prepared-head intake enforces the nine-key nested receipt envelope", () => {
  const intake = workflow(
    ".github/workflows/dependabot-prepared-head-intake.yml",
  );
  const step = intake.jobs["validate-receipt"].steps[0];
  const receiptDigest = "6".repeat(64);
  const payload = {
    headRef,
    headSha: preparedHeadSha,
    operation: "repair",
    operationReceipt: {
      checkId: 210,
      digest: receiptDigest,
      externalId:
        `dependabot-repair:v1:pr=${pullRequestNumber}:head=${preparedHeadSha}:` +
        `attempt=1:digest=${receiptDigest}:run=610:run_attempt=1`,
      workflowRunAttempt: 1,
      workflowRunId: 610,
      workflowSha,
    },
    parentHeadSha: seedHeadSha,
    prNumber: pullRequestNumber,
    prepareApp: {
      botId: prepareBotId,
      botLogin: prepareBotLogin,
      slug: prepareAppSlug,
    },
    repository,
    schema: "dependabot-prepared-head-intake:v1",
  };
  assert.equal(Object.keys(payload).length, 9);
  const run = (clientPayload) => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "prepared-intake-test-"),
    );
    const eventPath = join(temporaryDirectory, "event.json");
    try {
      writeFileSync(
        eventPath,
        JSON.stringify({ client_payload: clientPayload }),
      );
      return spawnSync("bash", ["-c", step.run], {
        encoding: "utf8",
        env: {
          EXPECTED_PREPARE_APP_SLUG: prepareAppSlug,
          EXPECTED_PREPARE_BOT_ID: String(prepareBotId),
          EXPECTED_PREPARE_BOT_LOGIN: prepareBotLogin,
          GITHUB_EVENT_PATH: eventPath,
          PATH: process.env.PATH,
          REPOSITORY: repository,
          SENDER_ID: String(prepareBotId),
          SENDER_LOGIN: prepareBotLogin,
          SENDER_TYPE: "Bot",
        },
      });
    } finally {
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  };
  assert.equal(run(payload).status, 0);
  const extra = { ...payload, untrusted: true };
  const rejected = run(extra);
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /client payload keys are not exact/);
  const oversizedPr = run({ ...payload, prNumber: 10_000_000_000 });
  assert.notEqual(oversizedPr.status, 0);
  assert.match(oversizedPr.stderr, /PR number is invalid/);
});

test("Dependabot reviewer accepts only authenticated native or prepared intake", () => {
  const review = workflow(".github/workflows/dependabot-claude-review.yml");
  assert.deepEqual(review.on, {
    workflow_run: {
      types: ["completed"],
      workflows: ["Dependabot Intake", "Dependabot Prepared Head Intake"],
    },
  });
  assert.deepEqual(review.permissions, {});
  const preflight = review.jobs.preflight;
  assert.match(preflight.if, /dependabot-prepared-head-intake\.yml/);
  assert.doesNotMatch(preflight.if, /workflow_run\.name/);
  assert.match(preflight.if, /\|ok=true/);
  assert.deepEqual(preflight.permissions, {
    actions: "read",
    checks: "read",
    contents: "read",
    "pull-requests": "read",
  });
  const authentication = preflight.steps[0];
  assert.match(authentication.run, /dependabot-intake\.yml/);
  assert.match(authentication.run, /dependabot-prepared-head-intake\.yml/);
  assert.equal(
    authentication.env.INTAKE_PATH,
    "${{ github.event.workflow_run.path }}",
  );
  assert.equal(Object.hasOwn(authentication.env, "INTAKE_WORKFLOW"), false);
  assert.match(authentication.run, /INTAKE_ACTOR_ID.*EXPECTED_PREPARE_BOT_ID/s);
  assert.match(authentication.run, /dependabot-prepared-head:v1/);
  assert.match(authentication.run, /operation_digest/);

  const materialize = preflight.steps.find(
    ({ name }) =>
      name === "Materialize the prepared-review validator from trusted source",
  );
  assert.ok(materialize);
  assert.match(materialize.run, /github\.workflow_sha|WORKFLOW_SHA/);
  assert.match(
    materialize.run,
    /dependabot-prepared-review\.mjs\?ref=\$WORKFLOW_SHA/,
  );
  const lineage = preflight.steps.find(
    ({ name }) => name === "Authenticate the append-only prepared-head lineage",
  );
  assert.ok(lineage);
  assert.match(lineage.run, /--digest/);
  assert.doesNotMatch(lineage.run, /checkout|artifact|cache|pnpm|npm|yarn/);

  const claude = review.jobs.review.steps.find(
    ({ name }) => name === "Run Claude Code Review",
  );
  assert.deepEqual(review.jobs.review.permissions, {
    contents: "read",
    issues: "read",
    "pull-requests": "read",
  });
  assert.equal(
    claude.with.allowed_bots,
    "${{ needs.preflight.outputs.review_actor_login }}",
  );
  assert.notEqual(claude.with.allowed_bots, "*");
  assert.match(
    claude.with.prompt,
    /gh pr diff.*needs\.preflight\.outputs\.pr_number.*--repo.*github\.repository/s,
  );
  assert.match(claude.with.prompt, /one plain-text document tool result/);
  const settings = JSON.parse(claude.with.settings);
  assert.deepEqual(settings.env, {
    BASH_MAX_OUTPUT_LENGTH: "150000",
    DEPENDABOT_REVIEW_PR_NUMBER: "${{ needs.preflight.outputs.pr_number }}",
    DEPENDABOT_REVIEW_REPOSITORY: "mento-protocol/frontend-monorepo",
  });
  assert.deepEqual(settings.hooks, {
    PreToolUse: [
      {
        matcher: "Bash",
        hooks: [
          {
            type: "command",
            command:
              'node "${{ github.workspace }}/scripts/dependabot-claude-review-tool-guard.mjs" || exit 2',
            timeout: 5,
          },
        ],
      },
    ],
    PostToolUse: [
      {
        matcher: "Bash",
        hooks: [
          {
            type: "command",
            command:
              'node "${{ github.workspace }}/scripts/dependabot-claude-review-tool-guard.mjs" || exit 2',
            timeout: 5,
          },
        ],
      },
    ],
  });
  assert.deepEqual(
    [...claude.with.claude_args.matchAll(/--tools\s+"([^"]+)"/g)].map(
      (match) => match[1],
    ),
    ["Bash"],
  );
  assert.deepEqual(
    [
      ...claude.with.claude_args.matchAll(
        /--(?:disallowedTools|disallowed-tools)\s+"([^"]+)"/g,
      ),
    ].map((match) => match[1]),
    ["mcp__*"],
  );
  assert.deepEqual(
    [...claude.with.claude_args.matchAll(/--model\s+(\S+)/g)].map(
      (match) => match[1],
    ),
    ["claude-sonnet-4-6"],
  );
  assert.match(claude.with.claude_args, /--permission-mode\s+dontAsk/);
  assert.match(claude.with.claude_args, /--setting-sources\s+user/);
  assert.match(claude.with.claude_args, /--strict-mcp-config\b/);
  assert.doesNotMatch(
    claude.with.claude_args,
    /--(?:allowedTools|allowed-tools)\b/,
  );
  assert.doesNotMatch(
    claude.with.claude_args,
    /Bash\(gh api|Bash\(curl|Bash\(git|WebFetch|WebSearch|mcp__github__|--permission-mode\s+bypassPermissions|--dangerously-skip-permissions|--tools\s+"[^"]*(?:Read|Edit|Write|Glob|Grep|Agent)/,
  );
  const guard = read("scripts/dependabot-claude-review-tool-guard.mjs");
  assert.match(guard, /dependabot-claude-review-tool-completed:v2/);
  assert.match(guard, /hookEventName: "PostToolUse"/);
  assert.match(guard, /updatedToolOutput:/);
  assert.match(guard, /structuredContent:/);
  assert.match(guard, /type: "document"/);
  assert.match(guard, /media_type: "text\/plain"/);
  assert.match(guard, /data: response\.stdout/);
  const completion = review.jobs.review.steps.find(
    ({ name }) => name === "Require a completed exact diff read",
  );
  assert.ok(completion);
  assert.equal(completion.if, "${{ always() }}");
  assert.match(completion.run, /--verify-completion/);
  const diagnostics = review.jobs.review.steps.find(
    ({ name }) => name === "Report sanitized Claude terminal diagnostics",
  );
  assert.ok(diagnostics);
  assert.equal(diagnostics.if, "${{ always() }}");
  assert.equal(diagnostics["continue-on-error"], true);
  assert.equal(
    diagnostics.env.CLAUDE_EXECUTION_FILE,
    "${{ steps.claude-review.outputs.execution_file }}",
  );
  assert.match(diagnostics.run, /claude-execution-output\.json/);
  assert.match(diagnostics.run, /terminal_reason/);
  assert.match(diagnostics.run, /api_error_status/);
  assert.doesNotMatch(
    diagnostics.run,
    /\.result\b|\.errors\b|\.message\b|\.content\b|\bcat\b/,
  );
  const publish = review.jobs.publish.steps.find(
    ({ name }) => name === "Publish the exact-head Claude review check",
  );
  assert.match(publish.run, /jq -S -c/);
  assert.match(publish.run, /verdict == "findings"/);
  assert.match(
    publish.run,
    /elif test "\$POST_IDENTITY_STABLE" = "true" && \\\n+\s+test "\$valid_review" = "true"/,
  );
});

test("prepared reviewer preflight authenticates and emits the actual compact receipt", () => {
  const review = workflow(".github/workflows/dependabot-claude-review.yml");
  const step = review.jobs.preflight.steps[0];
  const operationDigest = "7".repeat(64);
  const title =
    `dependabot-prepared-head:v1|p=${pullRequestNumber}|h=${preparedHeadSha}|` +
    `o=p|c=210|d=${operationDigest}|ok=true`;
  const temporaryDirectory = mkdtempSync(
    join(tmpdir(), "prepared-review-preflight-"),
  );
  const outputPath = join(temporaryDirectory, "github-output");
  try {
    const result = spawnSync("bash", ["-c", step.run], {
      encoding: "utf8",
      env: {
        DEFAULT_BRANCH: "main",
        EXPECTED_PREPARE_APP_SLUG: prepareAppSlug,
        EXPECTED_PREPARE_BOT_ID: String(prepareBotId),
        EXPECTED_PREPARE_BOT_LOGIN: prepareBotLogin,
        GITHUB_OUTPUT: outputPath,
        INTAKE_ACTOR_ID: String(prepareBotId),
        INTAKE_ACTOR_LOGIN: prepareBotLogin,
        INTAKE_ACTOR_TYPE: "Bot",
        INTAKE_CONCLUSION: "success",
        INTAKE_EVENT: "repository_dispatch",
        INTAKE_HEAD_BRANCH: "main",
        INTAKE_HEAD_REPOSITORY: repository,
        INTAKE_HEAD_SHA: workflowSha,
        INTAKE_PATH: ".github/workflows/dependabot-prepared-head-intake.yml",
        INTAKE_PULL_REQUESTS_JSON: "[]",
        INTAKE_TITLE: title,
        INTAKE_TRIGGERING_ACTOR_ID: String(prepareBotId),
        INTAKE_TRIGGERING_ACTOR_LOGIN: prepareBotLogin,
        INTAKE_TRIGGERING_ACTOR_TYPE: "Bot",
        PATH: process.env.PATH,
        REPOSITORY: repository,
        RUN_ATTEMPT: "1",
        RUN_ID: "1000",
        WORKFLOW_SHA: workflowSha,
      },
    });
    assert.equal(result.status, 0, result.stderr);
    const output = readFileSync(outputPath, "utf8");
    assert.match(output, new RegExp(`pr_number=${pullRequestNumber}`));
    assert.match(output, new RegExp(`head_sha=${preparedHeadSha}`));
    assert.match(output, /operation=repair/);
    assert.match(output, /operation_check_id=210/);
    assert.match(output, new RegExp(`operation_digest=${operationDigest}`));
    assert.match(output, /source_kind=prepared/);
  } finally {
    rmSync(temporaryDirectory, { force: true, recursive: true });
  }
});

test("prepared review helper rejects a Processor workflow SHA mismatch", () => {
  const fixture = repairFixture();
  const path = `repos/${repository}/actions/runs/510`;
  const entries = fixture.entries.map(([key, value]) =>
    key === path ? [key, { ...value, head_sha: "9".repeat(40) }] : [key, value],
  );
  assert.throws(
    () =>
      validatePreparedReviewTarget(
        options(fixture.operation, fixture.checkId, fixture.receiptDigest),
        requestFromMap(entries),
      ),
    /Processor workflow provenance is invalid/,
  );
});
