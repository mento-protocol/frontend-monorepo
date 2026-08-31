import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { test } from "node:test";

import {
  canonicalJson,
  parseCanonicalJson,
  rawDigest,
  validateRepairPlan,
} from "./dependabot-preparation-receipts.mjs";
import {
  DEPENDABOT_ALL_CLEAR_SCHEMA,
  DEPENDABOT_CHECK_POLICY,
  DEPENDABOT_PROCESSOR_SCHEMA,
  DEPENDABOT_PROTECTED_RUNTIME_REPAIR_PACKET_SCHEMA,
  DEPENDABOT_REFRESH_SCHEMA,
  DEPENDABOT_REPAIR_PACKET_SCHEMA,
  DEPENDABOT_REPAIR_SCHEMA,
  classifyDependabotFeedback,
  classifyDependabotRisk,
  createLiveGitHubAdapter,
  deriveImmutableDependabotMetadata,
  derivePlannerDecisions,
  createDependabotRepairPacket,
  evaluateDependabotChecks,
  evaluateDependabotPullRequest,
  evaluateDependabotSweep,
  evaluateFeedbackGate,
  normalizeProcessorMode,
  normalizeProcessorPhase,
  parseDependabotAllClearReceipt,
  parseDependabotProcessorReceipt,
  parseDependabotRefreshReceipt,
  parseDependabotRepairReceipt,
  parseDependabotMetadata,
  processDependabotSweep,
  requireStableFeedbackSnapshot,
  requireStablePullRequestSnapshot,
  selectDependabotRepairBlobPaths,
  selectAllowedCheckEvents,
  selectLatestExactHeadCheck,
  stableJson,
  validateDependabotPullRequestIdentity,
  verifyPostMergeOutcome,
} from "./dependabot-processor.mjs";

const HEAD_SHA = "1".repeat(40);
const BASE_SHA = "2".repeat(40);
const MERGE_SHA = "3".repeat(40);
const OTHER_SHA = "4".repeat(40);
const SECOND_HEAD_SHA = "5".repeat(40);
const REPOSITORY = "mento-protocol/frontend-monorepo";
const WORKFLOW_CONTEXT = {
  workflowRunAttempt: 1,
  workflowRunId: 8_001,
  workflowSha: MERGE_SHA,
};
const PREPARE_ACTOR = {
  appSlug: "mento-dependabot-prepare",
  botId: 91_001,
  botLogin: "mento-dependabot-prepare[bot]",
};
const DEPENDABOT_ACTOR = {
  id: 49_699_333,
  login: "dependabot[bot]",
  type: "Bot",
};
const GITHUB_SYSTEM_COMMITTER = {
  committerId: 19_864_447,
  committerLogin: "web-flow",
  committerType: "User",
};
const PACKAGE_BLOB = {
  filename: "package.json",
  mode: "100644",
  sha: OTHER_SHA,
  type: "blob",
};
const VERCEL_REQUIRED_PATHS = [
  "package.json",
  "pnpm-lock.yaml",
  "scripts/vercel-cli-runtime/contract.json",
  "scripts/vercel-cli-runtime/package.json",
  "scripts/vercel-cli-runtime/pnpm-lock.yaml",
];
const VERCEL_INPUT_PATHS = [
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
const NEXT_CATALOG_REQUIRED_PATHS = [
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "scripts/vercel-cli-runtime/contract.json",
  "scripts/vercel-cli-runtime/package.json",
  "scripts/vercel-cli-runtime/pnpm-lock.yaml",
];
const NEXT_FROM_SPECIFIER = "^16.2.12";
const NEXT_TARGET_SPECIFIER = "^16.3.1";

function digest(value) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function textDigest(value) {
  return createHash("sha256").update(value).digest("hex");
}

const CHECK_NAMES = {
  "action-pins": "Action Pin Policy",
  "action-pins-source": "Action Pin Policy Source",
  "claude-review": "claude-review",
  ci: "Build and Test",
  "dependency-review": "dependency-review",
  "e2e-celo": "Connected swap (anvil fork)",
  "e2e-governance": "Connected governance (anvil fork)",
  "e2e-monad": "Connected swap (Monad anvil fork)",
  "e2e-plan": "E2E Plan",
  "e2e-seed": "fork-seed self-test",
  quality: "coverage and production bundles",
  "supply-chain-lockfile": "lockfile integrity + registry",
  "supply-chain-pnpm-bootstrap-osv":
    "osv-scanner (trusted pnpm bootstrap) / osv-scan",
  "supply-chain-pnpm-runtime-osv":
    "osv-scanner (trusted pnpm runtime) / osv-scan",
  "supply-chain-root-osv": "osv-scanner / osv-scan",
  "supply-chain-vercel-runtime-osv":
    "osv-scanner (standalone Vercel CLI runtime) / osv-scan",
  "supply-chain-version-skew": "catalog version-skew",
  "vercel-preview": "Vercel Preview",
  "visual-app": "Visual Regression (app.mento.org)",
  "visual-plan": "Visual Regression Plan",
  "visual-ui": "Visual Regression (ui.mento.org)",
};

const WORKFLOW_PATHS = {
  "action-pins": ".github/workflows/action-pins.yml",
  "action-pins-source": ".github/workflows/action-pins-source.yml",
  "claude-review": ".github/workflows/dependabot-claude-review.yml",
  ci: ".github/workflows/ci.yml",
  "dependency-review": ".github/workflows/dependency-review.yml",
  "e2e-celo": ".github/workflows/e2e.yml",
  "e2e-governance": ".github/workflows/e2e.yml",
  "e2e-monad": ".github/workflows/e2e.yml",
  "e2e-plan": ".github/workflows/e2e.yml",
  "e2e-seed": ".github/workflows/e2e.yml",
  quality: ".github/workflows/quality-budgets.yml",
  "supply-chain-lockfile": ".github/workflows/supply-chain.yml",
  "supply-chain-pnpm-bootstrap-osv": ".github/workflows/supply-chain.yml",
  "supply-chain-pnpm-runtime-osv": ".github/workflows/supply-chain.yml",
  "supply-chain-root-osv": ".github/workflows/supply-chain.yml",
  "supply-chain-vercel-runtime-osv": ".github/workflows/supply-chain.yml",
  "supply-chain-version-skew": ".github/workflows/supply-chain.yml",
  "vercel-preview": ".github/workflows/vercel-preview-intake.yml",
  "visual-app": ".github/workflows/visual.yml",
  "visual-plan": ".github/workflows/visual.yml",
  "visual-ui": ".github/workflows/visual.yml",
};

const MAIN_BASELINE_EVENTS = {
  ci: "push",
  "e2e-celo": "workflow_dispatch",
  "e2e-governance": "workflow_dispatch",
  "e2e-monad": "workflow_dispatch",
  "e2e-plan": "workflow_dispatch",
  "e2e-seed": "workflow_dispatch",
  quality: "push",
  "supply-chain-lockfile": "push",
  "supply-chain-pnpm-bootstrap-osv": "workflow_dispatch",
  "supply-chain-pnpm-runtime-osv": "workflow_dispatch",
  "supply-chain-root-osv": "workflow_dispatch",
  "supply-chain-vercel-runtime-osv": "workflow_dispatch",
  "supply-chain-version-skew": "push",
  "visual-app": "push",
  "visual-plan": "push",
  "visual-ui": "push",
};

const EXTERNAL_CHECK_IDS = [
  "dependency-review",
  "supply-chain-root-osv",
  "supply-chain-pnpm-runtime-osv",
  "supply-chain-vercel-runtime-osv",
  "supply-chain-pnpm-bootstrap-osv",
  "e2e-celo",
  "e2e-governance",
  "e2e-monad",
  "visual-ui",
  "visual-app",
  "claude-review",
  "vercel-preview",
];

function check(name, conclusion = "success", options = {}) {
  const policyId = Object.entries(CHECK_NAMES).find(
    ([, checkName]) => checkName === name,
  )?.[0];
  const id = options.id ?? 1;
  const isStatus = policyId === "vercel-preview";
  const headSha = options.headSha ?? HEAD_SHA;
  const pullRequestNumber = options.pullRequestNumber ?? 123;
  const isClaudeReview = policyId === "claude-review";
  return {
    appId: 15_368,
    completedAt: options.completedAt ?? "2026-08-10T10:00:00Z",
    conclusion,
    creatorLogin: isStatus ? "github-actions[bot]" : undefined,
    description: isStatus ? "Preview disabled for Dependabot PR" : undefined,
    detailsUrl: `https://github.com/${REPOSITORY}/actions/runs/${id}`,
    externalId: isClaudeReview
      ? `dependabot-claude-review:v1:pr=${pullRequestNumber}:sha=${headSha}:run=${id}:attempt=1`
      : undefined,
    headSha,
    id,
    kind: isStatus ? "status" : "check",
    name,
    runAttempt: 1,
    runDisplayTitle: isClaudeReview
      ? `dependabot-claude-review:v1 | source=dependabot-intake:v1 | repository=${REPOSITORY} | pr=${pullRequestNumber} | sha=${headSha} | action=synchronize | receipt=true`
      : isStatus
        ? `Vercel preview intake | pr=${pullRequestNumber} | sha=${headSha} | action=synchronize`
        : undefined,
    runHeadBranch: isClaudeReview ? "main" : undefined,
    runHeadSha: isClaudeReview ? MERGE_SHA : headSha,
    runId: id,
    sourceRepository: REPOSITORY,
    status: options.status ?? "completed",
    workflowEvent:
      policyId === "action-pins"
        ? "pull_request_target"
        : policyId === "claude-review"
          ? "workflow_run"
          : policyId === "vercel-preview"
            ? "pull_request_target"
            : "pull_request",
    workflowPath: WORKFLOW_PATHS[policyId],
    ...options.source,
  };
}

function postMergeReceipt(headSha = BASE_SHA) {
  return {
    appId: 15_368,
    completedAt: "2026-08-10T10:00:00Z",
    conclusion: "success",
    detailsUrl: `https://github.com/${REPOSITORY}/actions/runs/99`,
    externalId: "dependabot-post-merge:99:1",
    headSha,
    id: 100,
    kind: "check",
    name: "Dependabot Post-Merge Verification",
    runAttempt: 1,
    runConclusion: "success",
    runHeadBranch: "main",
    runHeadSha: headSha,
    runId: 99,
    runStatus: "completed",
    sourceRepository: REPOSITORY,
    status: "completed",
    workflowEvent: "workflow_run",
    workflowPath: ".github/workflows/vercel-main-deployment.yml",
  };
}

function trustedReceiptCheck({
  conclusion = "success",
  externalId,
  headSha,
  id,
  name,
  receipt,
  workflowContext = WORKFLOW_CONTEXT,
  workflowEvent = "repository_dispatch",
  workflowPath,
}) {
  return {
    appId: 15_368,
    conclusion,
    detailsUrl: `https://github.com/${REPOSITORY}/actions/runs/${workflowContext.workflowRunId}`,
    externalId,
    headSha,
    id,
    kind: "check",
    name,
    outputText: receipt ? stableJson(receipt) : null,
    runAttempt: workflowContext.workflowRunAttempt,
    runConclusion: "success",
    runHeadBranch: "main",
    runHeadSha: workflowContext.workflowSha,
    runId: workflowContext.workflowRunId,
    runStatus: "completed",
    sourceRepository: REPOSITORY,
    status: "completed",
    workflowEvent,
    workflowPath,
  };
}

function processorRepairReceipt(
  attempt,
  {
    mode = "prepare",
    packet = true,
    externalId,
    headSha = HEAD_SHA,
    id = 10_000 + attempt,
    packetEncoding = "legacy",
    pullRequestNumber = 123,
    workflowContext = WORKFLOW_CONTEXT,
  } = {},
) {
  const repairPacket =
    packet === true
      ? {
          feedbackThreads: [],
          schema: DEPENDABOT_REPAIR_PACKET_SCHEMA,
          ...workflowContext,
        }
      : packet && typeof packet === "object"
        ? packet
        : null;
  const packetText = repairPacket
    ? packetEncoding === "canonical"
      ? canonicalJson(repairPacket)
      : stableJson(repairPacket)
    : null;
  const packetDigest = packetText ? rawDigest(packetText) : "none";
  const receipt = trustedReceiptCheck({
    conclusion: repairPacket ? "failure" : "neutral",
    externalId:
      externalId ??
      `${DEPENDABOT_PROCESSOR_SCHEMA}:pr=${pullRequestNumber}:head=${headSha}:mode=${mode}:repair=${attempt}:packet=${Boolean(repairPacket)}:digest=${packetDigest}:run=${workflowContext.workflowRunId}:attempt=${workflowContext.workflowRunAttempt}`,
    headSha,
    id,
    name: "Dependabot Processor",
    receipt: repairPacket,
    workflowContext,
    workflowPath: ".github/workflows/dependabot-process.yml",
  });
  if (packetText !== null) receipt.outputText = packetText;
  return receipt;
}

function refreshReceiptCheck(
  state,
  {
    baseSha = BASE_SHA,
    headRef = "dependabot/github_actions/github-actions-routine-123",
    headSha = state === "requested" ? HEAD_SHA : OTHER_SHA,
    id = state === "requested" ? 20_001 : 20_002,
    parentHeadSha = HEAD_SHA,
    previousBaseSha = MERGE_SHA,
    pullRequestNumber = 123,
    requestCheckId = 20_001,
    requestDigest,
    workflowContext = WORKFLOW_CONTEXT,
  } = {},
) {
  const requested = {
    baseSha,
    headRef,
    headSha: null,
    parentHeadSha,
    prepareAppSlug: PREPARE_ACTOR.appSlug,
    prepareBotId: PREPARE_ACTOR.botId,
    prepareBotLogin: PREPARE_ACTOR.botLogin,
    previousBaseSha,
    pullRequestNumber,
    repository: REPOSITORY,
    schema: DEPENDABOT_REFRESH_SCHEMA,
    state: "requested",
    ...workflowContext,
  };
  const receipt =
    state === "requested"
      ? requested
      : {
          ...requested,
          headSha,
          requestCheckId,
          requestDigest: requestDigest ?? digest(requested),
          state: "completed",
        };
  const checkHeadSha = state === "requested" ? parentHeadSha : headSha;
  return trustedReceiptCheck({
    externalId: `${DEPENDABOT_REFRESH_SCHEMA}:pr=${pullRequestNumber}:head=${checkHeadSha}:state=${state}:digest=${digest(receipt)}:run=${workflowContext.workflowRunId}:attempt=${workflowContext.workflowRunAttempt}`,
    headSha: checkHeadSha,
    id,
    name: "Dependabot Refresh",
    receipt,
    workflowContext,
    workflowPath: ".github/workflows/dependabot-process.yml",
  });
}

function repairReceiptCheck({
  attempt = 1,
  baseSha = BASE_SHA,
  headSha = OTHER_SHA,
  headRef = "dependabot/github_actions/github-actions-routine-123",
  id = 30_001,
  packetDigest,
  parentHeadSha = HEAD_SHA,
  processorCheckId = 10_001,
  workflowContext = WORKFLOW_CONTEXT,
} = {}) {
  const receipt = {
    attempt,
    baseSha,
    headRef,
    headSha,
    packetDigest: packetDigest ?? "a".repeat(64),
    parentHeadSha,
    prepareAppSlug: PREPARE_ACTOR.appSlug,
    prepareBotId: PREPARE_ACTOR.botId,
    prepareBotLogin: PREPARE_ACTOR.botLogin,
    processorCheckId,
    pullRequestNumber: 123,
    repository: REPOSITORY,
    schema: DEPENDABOT_REPAIR_SCHEMA,
    state: "completed",
    ...workflowContext,
  };
  return trustedReceiptCheck({
    externalId: `${DEPENDABOT_REPAIR_SCHEMA}:pr=123:head=${headSha}:attempt=${attempt}:digest=${digest(receipt)}:run=${workflowContext.workflowRunId}:run_attempt=${workflowContext.workflowRunAttempt}`,
    headSha,
    id,
    name: "Dependabot Repair",
    receipt,
    workflowContext,
    workflowPath: ".github/workflows/dependabot-prepare-repair.yml",
  });
}

function completeChecks({
  conclusions = {},
  headSha = HEAD_SHA,
  plannedSkips = false,
  pullRequestNumber = 123,
} = {}) {
  return DEPENDABOT_CHECK_POLICY.map(({ id }) =>
    check(
      CHECK_NAMES[id],
      plannedSkips &&
        [
          "e2e-celo",
          "e2e-governance",
          "e2e-monad",
          "visual-app",
          "visual-ui",
        ].includes(id)
        ? "skipped"
        : (conclusions[id] ?? "success"),
      { headSha, pullRequestNumber },
    ),
  );
}

function completeBaselineChecks({
  conclusions = {},
  headSha = BASE_SHA,
  plannedSkips = false,
  pullRequestNumber = 123,
} = {}) {
  return completeChecks({
    conclusions,
    headSha,
    plannedSkips,
    pullRequestNumber,
  }).flatMap((candidate) => {
    const checkId = Object.entries(CHECK_NAMES).find(
      ([, name]) => name === candidate.name,
    )?.[0];
    const workflowEvent = MAIN_BASELINE_EVENTS[checkId];
    if (!workflowEvent) return [];
    return [
      {
        ...candidate,
        runHeadBranch: "main",
        runHeadSha: headSha,
        workflowEvent,
      },
    ];
  });
}

function completeChecksWithClaudeFindings({
  conclusions = {},
  findings,
  headSha = HEAD_SHA,
} = {}) {
  const checks = completeChecks({
    conclusions: { ...conclusions, "claude-review": "failure" },
    headSha,
  });
  const claudeIndex = checks.findIndex(
    ({ name }) => name === CHECK_NAMES["claude-review"],
  );
  checks[claudeIndex] = {
    ...checks[claudeIndex],
    outputText: stableJson({
      findings,
      headSha,
      pullRequestNumber: 123,
      repository: REPOSITORY,
      reviewCompleted: true,
      schema: "dependabot-claude-review-result:v1",
      verdict: "findings",
    }),
  };
  return checks;
}

function actionBody(name = "actions/setup-node", from = "6.0.0", to = "6.1.0") {
  return `Bumps the github-actions group with 1 update:\n\n| Package | From | To |\n| --- | --- | --- |\n| [${name}](https://github.com/${name}) | \`${from}\` | \`${to}\` |`;
}

function toolingBody({
  duplicateVercel = false,
  vercelFrom = "56.4.1",
  vercelTo = "56.5.0",
} = {}) {
  const rows = [
    ["knip", "6.31.0", "6.32.0"],
    ["vercel", vercelFrom, vercelTo],
    ["@next/eslint-plugin-next", "16.2.12", "16.3.0"],
    ...(duplicateVercel ? [["vercel", vercelFrom, vercelTo]] : []),
  ];
  return `Bumps the tooling group with ${rows.length} updates:\n\n| Package | From | To |\n| --- | --- | --- |\n${rows
    .map(
      ([name, from, to]) =>
        `| [${name}](https://www.npmjs.com/package/${name}) | \`${from}\` | \`${to}\` |`,
    )
    .join("\n")}`;
}

function vercelCliBody({ vercelFrom = "56.4.1", vercelTo = "56.5.0" } = {}) {
  return `Bumps the vercel-cli group with 1 update:\n\n| Package | From | To |\n| --- | --- | --- |\n| [vercel](https://www.npmjs.com/package/vercel) | \`${vercelFrom}\` | \`${vercelTo}\` |`;
}

function vercelMetadata({
  duplicateVercel = false,
  group = "tooling",
  vercelFrom = "56.4.1",
  vercelTo = "56.5.0",
} = {}) {
  const parsed = parseDependabotMetadata({
    body: toolingBody({ duplicateVercel, vercelFrom, vercelTo }),
    files: [
      "package.json",
      "packages/eslint-config/package.json",
      "pnpm-lock.yaml",
    ],
    headRef: "dependabot/npm_and_yarn/tooling-31c5cf6265",
  });
  return {
    ...parsed,
    dependencyGroup: group,
    immutableEvidence: {
      currentHeadMatches: true,
      dependencyMetadataValid: parsed.groupedUpdateIntegrity.valid,
      seedCommitSha: HEAD_SHA,
      seedCommitTrusted: true,
      source: "dependabot-commit-message",
      valid: true,
    },
  };
}

function vercelCliMetadata({
  vercelFrom = "56.4.1",
  vercelTo = "56.5.0",
} = {}) {
  const body = vercelCliBody({ vercelFrom, vercelTo });
  const parsed = parseDependabotMetadata({
    body,
    files: ["package.json", "pnpm-lock.yaml"],
    headRef: "dependabot/npm_and_yarn/vercel-cli-986014f9a1",
  });
  return {
    ...parsed,
    immutableEvidence: {
      currentHeadMatches: true,
      dependencyMetadataValid: parsed.groupedUpdateIntegrity.valid,
      seedCommitSha: HEAD_SHA,
      seedCommitTrusted: true,
      source: "dependabot-commit-message",
      valid: true,
    },
  };
}

function vercelExpectedBlobs() {
  return VERCEL_INPUT_PATHS.map((path) => ({
    mode: "100644",
    path,
    sha: createHash("sha1").update(path).digest("hex"),
    type: "blob",
  }));
}

function nextCatalogBody({ from = "16.2.12", to = "16.3.1" } = {}) {
  return `Bumps the frontend-core group with 1 update:\n\n| Package | From | To |\n| --- | --- | --- |\n| [next](https://www.npmjs.com/package/next) | \`${from}\` | \`${to}\` |`;
}

function nextCatalogMetadata({ from = "16.2.12", to = "16.3.1" } = {}) {
  const body = nextCatalogBody({ from, to });
  const parsed = parseDependabotMetadata({
    body,
    files: ["pnpm-lock.yaml", "pnpm-workspace.yaml"],
    headRef: "dependabot/npm_and_yarn/frontend-core-2f0c077f04",
  });
  return {
    ...parsed,
    immutableEvidence: {
      currentHeadMatches: true,
      dependencyMetadataValid: parsed.groupedUpdateIntegrity.valid,
      seedCommitSha: HEAD_SHA,
      seedCommitTrusted: true,
      source: "dependabot-commit-message",
      valid: true,
    },
  };
}

function nextCatalogState(state = "mixed") {
  const specifiers = {
    mixed: {
      catalogSpecifier: NEXT_TARGET_SPECIFIER,
      overrideSpecifier: NEXT_FROM_SPECIFIER,
      runtimeOverrideSpecifier: NEXT_FROM_SPECIFIER,
    },
    source: {
      catalogSpecifier: NEXT_FROM_SPECIFIER,
      overrideSpecifier: NEXT_FROM_SPECIFIER,
      runtimeOverrideSpecifier: NEXT_FROM_SPECIFIER,
    },
    target: {
      catalogSpecifier: NEXT_TARGET_SPECIFIER,
      overrideSpecifier: NEXT_TARGET_SPECIFIER,
      runtimeOverrideSpecifier: NEXT_TARGET_SPECIFIER,
    },
  }[state];
  assert.notEqual(
    specifiers,
    undefined,
    `unknown Next catalog state: ${state}`,
  );
  return {
    ...specifiers,
    contractOverrideDigest: "a".repeat(64),
    contractSchema: "vercel-cli-runtime-contract:v1",
    contractVersion: "56.5.0",
    overrideDigest: "a".repeat(64),
    pnpmVersion: "10.34.4",
    rootVercelVersion: "56.5.0",
    runtimeOverrideDigest: "a".repeat(64),
    runtimeVercelVersion: "56.5.0",
  };
}

function nextCatalogSnapshot({
  changedPaths = ["pnpm-lock.yaml", "pnpm-workspace.yaml"],
  checks,
  commits,
  headSha = HEAD_SHA,
  metadata = nextCatalogMetadata(),
  nextCatalogSync = nextCatalogState(),
  repairHistoryChecks,
} = {}) {
  const expectedBlobs = vercelExpectedBlobs();
  const expectedByPath = new Map(
    expectedBlobs.map((entry) => [entry.path, entry]),
  );
  return snapshot({
    baseAncestry: {
      aheadBy: commits?.length ?? 1,
      baseCommitSha: BASE_SHA,
      behindBy: 0,
      currentBaseIsAncestor: true,
      currentBaseSha: BASE_SHA,
      headSha,
      mergeBaseSha: BASE_SHA,
      status: "ahead",
    },
    checks:
      checks ??
      completeChecks({
        conclusions: { "supply-chain-version-skew": "failure" },
        headSha,
      }),
    commits: commits ?? [nativeDependabotCommit(HEAD_SHA)],
    expectedBlobs,
    expectedHeadSha: headSha,
    metadata,
    nextCatalogSync,
    prepareActor: PREPARE_ACTOR,
    pullRequest: {
      body: nextCatalogBody(),
      files: changedPaths.map((filename) => ({
        filename,
        mode: expectedByPath.get(filename).mode,
        sha: expectedByPath.get(filename).sha,
        status: "modified",
        type: expectedByPath.get(filename).type,
      })),
      head: {
        ref: "dependabot/npm_and_yarn/frontend-core-2f0c077f04",
        repo: { fullName: REPOSITORY },
        sha: headSha,
      },
    },
    repairHistoryChecks,
  });
}

function preparedCommit(sha, parent) {
  return {
    authorId: PREPARE_ACTOR.botId,
    authorLogin: PREPARE_ACTOR.botLogin,
    authorType: "Bot",
    ...GITHUB_SYSTEM_COMMITTER,
    parents: [parent],
    sha,
    verified: true,
    verificationReason: "valid",
  };
}

function nativeDependabotCommit(sha, parent = BASE_SHA) {
  return {
    authorId: DEPENDABOT_ACTOR.id,
    authorLogin: DEPENDABOT_ACTOR.login,
    authorType: DEPENDABOT_ACTOR.type,
    ...GITHUB_SYSTEM_COMMITTER,
    parents: [parent],
    sha,
    verified: true,
    verificationReason: "valid",
  };
}

function nativeForcePushFeedback({
  afterSha = HEAD_SHA,
  beforeSha = OTHER_SHA,
  headRef = "dependabot/github_actions/github-actions-routine-123",
} = {}) {
  return {
    forcePushActors: [DEPENDABOT_ACTOR.login],
    forcePushCommitIds: [afterSha],
    forcePushCommits: [
      nativeDependabotCommit(beforeSha, MERGE_SHA),
      nativeDependabotCommit(afterSha),
    ],
    forcePushEventCount: 1,
    forcePushEvents: [
      {
        actorId: DEPENDABOT_ACTOR.id,
        actorLogin: "dependabot",
        actorType: DEPENDABOT_ACTOR.type,
        afterSha,
        beforeSha,
        createdAt: "2026-08-10T09:00:00Z",
        eventId: "force-push-event-1",
        headRef: `refs/heads/${headRef}`,
      },
    ],
    forcePushEventsComplete: true,
    forcePushed: true,
  };
}

function withNativeForcePush(current) {
  current.commits[0] = nativeDependabotCommit(HEAD_SHA);
  current.feedback = {
    ...current.feedback,
    ...nativeForcePushFeedback(),
  };
  current.metadata = {
    ...current.metadata,
    immutableEvidence: {
      ...current.metadata.immutableEvidence,
      seedCommitSha: HEAD_SHA,
      seedCommitTrusted: true,
    },
  };
  current.pullRequest.author = DEPENDABOT_ACTOR;
  return current;
}

function vercelSnapshot({
  body = toolingBody(),
  changedPaths = [
    "package.json",
    "packages/eslint-config/package.json",
    "pnpm-lock.yaml",
  ],
  commits,
  contractVersion,
  headRef = "dependabot/npm_and_yarn/tooling-31c5cf6265",
  headSha = HEAD_SHA,
  metadata = vercelMetadata(),
  protectedVersion = "56.4.1",
  repairHistoryChecks,
  rootVersion,
  runtimeVersion,
} = {}) {
  const expectedBlobs = vercelExpectedBlobs();
  const expectedByPath = new Map(
    expectedBlobs.map((entry) => [entry.path, entry]),
  );
  return snapshot({
    baseAncestry: {
      aheadBy: commits?.length ?? 1,
      baseCommitSha: BASE_SHA,
      behindBy: 0,
      currentBaseIsAncestor: true,
      currentBaseSha: BASE_SHA,
      headSha,
      mergeBaseSha: BASE_SHA,
      status: "ahead",
    },
    checks: completeChecks({ headSha }),
    commits: commits ?? [
      {
        authorLogin: "dependabot[bot]",
        committerLogin: "dependabot[bot]",
        sha: HEAD_SHA,
        verified: true,
      },
    ],
    expectedBlobs,
    expectedHeadSha: headSha,
    metadata,
    protectedRuntime: {
      contractSchema: "vercel-cli-runtime-contract:v1",
      contractVersion: contractVersion ?? protectedVersion,
      pnpmVersion: "10.34.4",
      rootVersion: rootVersion ?? protectedVersion,
      runtimeVersion: runtimeVersion ?? protectedVersion,
    },
    pullRequest: {
      body,
      files: changedPaths.map((filename) => ({
        filename,
        mode: expectedByPath.get(filename).mode,
        sha: expectedByPath.get(filename).sha,
        status: "modified",
        type: expectedByPath.get(filename).type,
      })),
      head: {
        ref: headRef,
        repo: { fullName: REPOSITORY },
        sha: headSha,
      },
    },
    repairHistoryChecks,
  });
}

function vercelCliSnapshot({
  contractVersion = "56.4.1",
  runtimeVersion = "56.4.1",
  ...overrides
} = {}) {
  return vercelSnapshot({
    body: vercelCliBody(),
    changedPaths: ["package.json", "pnpm-lock.yaml"],
    contractVersion,
    headRef: "dependabot/npm_and_yarn/vercel-cli-986014f9a1",
    metadata: vercelCliMetadata(),
    rootVersion: "56.5.0",
    runtimeVersion,
    ...overrides,
  });
}

function legacyNpmRepairPacket({ headSha = HEAD_SHA } = {}) {
  const body =
    "Bumps the tooling group with 1 update:\n\n| Package | From | To |\n| --- | --- | --- |\n| [knip](https://www.npmjs.com/package/knip) | `6.31.0` | `6.32.0` |";
  const parsed = parseDependabotMetadata({
    body,
    files: [PACKAGE_BLOB],
    headRef: "dependabot/npm_and_yarn/tooling-31c5cf6265",
  });
  const result = evaluateDependabotPullRequest(
    snapshot({
      checks: completeChecks({ conclusions: { ci: "failure" }, headSha }),
      expectedHeadSha: headSha,
      metadata: {
        ...parsed,
        immutableEvidence: {
          dependencyMetadataValid: true,
          seedCommitSha: HEAD_SHA,
          valid: true,
        },
      },
      pullRequest: {
        body,
        head: {
          ref: "dependabot/npm_and_yarn/tooling-31c5cf6265",
          repo: { fullName: REPOSITORY },
          sha: headSha,
        },
      },
    }),
    {
      mode: "prepare",
      repository: REPOSITORY,
      workflowContext: WORKFLOW_CONTEXT,
    },
  );
  assert.equal(result.repairPacket?.schema, DEPENDABOT_REPAIR_PACKET_SCHEMA);
  return result.repairPacket;
}

function vercelAfterLegacyRepair({ protectedVersion = "56.4.1" } = {}) {
  const legacyPacket = legacyNpmRepairPacket();
  const processorCheck = processorRepairReceipt(1, {
    headSha: HEAD_SHA,
    packet: legacyPacket,
    packetEncoding: "canonical",
  });
  const repairCheck = repairReceiptCheck({
    attempt: 1,
    headRef: "dependabot/npm_and_yarn/tooling-31c5cf6265",
    headSha: OTHER_SHA,
    packetDigest: rawDigest(processorCheck.outputText),
    parentHeadSha: HEAD_SHA,
    processorCheckId: processorCheck.id,
  });
  return {
    legacyPacket,
    processorCheck,
    repairCheck,
    snapshot: vercelSnapshot({
      commits: [
        {
          authorLogin: "dependabot[bot]",
          committerLogin: "dependabot[bot]",
          sha: HEAD_SHA,
          verified: true,
        },
        preparedCommit(OTHER_SHA, HEAD_SHA),
      ],
      headSha: OTHER_SHA,
      protectedVersion,
      repairHistoryChecks: [processorCheck, repairCheck],
    }),
  };
}

function vercelAfterTypedRepair() {
  const selected = evaluateDependabotPullRequest(vercelCliSnapshot(), {
    mode: "prepare",
    repository: REPOSITORY,
    workflowContext: WORKFLOW_CONTEXT,
  });
  assert.equal(
    selected.repairPacket?.schema,
    DEPENDABOT_PROTECTED_RUNTIME_REPAIR_PACKET_SCHEMA,
  );
  const processorCheck = processorRepairReceipt(1, {
    headSha: HEAD_SHA,
    packet: selected.repairPacket,
    packetEncoding: "canonical",
  });
  const repairCheck = repairReceiptCheck({
    attempt: 1,
    headRef: "dependabot/npm_and_yarn/vercel-cli-986014f9a1",
    headSha: OTHER_SHA,
    packetDigest: rawDigest(processorCheck.outputText),
    parentHeadSha: HEAD_SHA,
    processorCheckId: processorCheck.id,
  });
  const repaired = vercelCliSnapshot({
    changedPaths: VERCEL_REQUIRED_PATHS,
    commits: [
      {
        authorLogin: "dependabot[bot]",
        committerLogin: "dependabot[bot]",
        sha: HEAD_SHA,
        verified: true,
      },
      preparedCommit(OTHER_SHA, HEAD_SHA),
    ],
    contractVersion: "56.5.0",
    headSha: OTHER_SHA,
    repairHistoryChecks: [processorCheck, repairCheck],
    runtimeVersion: "56.5.0",
  });
  return { processorCheck, repairCheck, repaired, selected };
}

function cursorReview(commitSha = HEAD_SHA, issueCount = 1) {
  return {
    actor: { association: "NONE", login: "cursor", type: "Bot" },
    body: `<!-- BUGBOT_REVIEW -->\nCursor Bugbot has reviewed your changes using high effort and found ${issueCount} potential issue${issueCount === 1 ? "" : "s"}.`,
    commitSha,
    id: 21,
    state: "COMMENTED",
  };
}

function vercelRuntimeSyncCursorBody({
  fromVersion = "56.4.1",
  reviewCommitSha = HEAD_SHA,
  targetVersion = "56.5.0",
} = {}) {
  return `### Incomplete Vercel CLI runtime sync\n\n**High Severity**\n\n<!-- DESCRIPTION START -->\nRoot \`vercel\` is now \`${targetVersion}\`, but \`scripts/vercel-cli-runtime\` still pins \`${fromVersion}\` and \`contract.json\` still records \`vercelVersion\` \`${fromVersion}\`. \`assertVercelCliRuntimeContract\` requires those to match, so \`check-versions\` fails and protected deploy workflows keep the old CLI.\n<!-- DESCRIPTION END -->\n\n<!-- BUGBOT_BUG_ID: fbce8aba-b010-4b72-8d4a-bf6acb9ea14d -->\n\n<!-- LOCATIONS START\npackage.json#L76-L77\npnpm-lock.yaml#L221-L223\nLOCATIONS END -->\n<details>\n<summary>Additional Locations (1)</summary>\n\n- [\`pnpm-lock.yaml#L221-L223\`](https://github.com/mento-protocol/frontend-monorepo/blob/${reviewCommitSha}/pnpm-lock.yaml#L221-L223)\n\n</details>\n\n<div><a href="https://cursor.com/open?link=fixture" target="_blank" rel="noopener noreferrer"><picture><source media="(prefers-color-scheme: dark)" srcset="https://cursor.com/assets/images/fix-in-cursor-dark.png"><source media="(prefers-color-scheme: light)" srcset="https://cursor.com/assets/images/fix-in-cursor-light.png"><img alt="Fix in Cursor" width="115" height="28" src="https://cursor.com/assets/images/fix-in-cursor-dark.png"></picture></a>&nbsp;<a href="https://cursor.com/agents?link=fixture" target="_blank" rel="noopener noreferrer"><picture><source media="(prefers-color-scheme: dark)" srcset="https://cursor.com/assets/images/fix-in-web-dark.png"><source media="(prefers-color-scheme: light)" srcset="https://cursor.com/assets/images/fix-in-web-light.png"><img alt="Fix in Web" width="99" height="28" src="https://cursor.com/assets/images/fix-in-web-dark.png"></picture></a></div>\n\n\n<sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit ${reviewCommitSha}. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>\n`;
}

function vercelRuntimeSyncCursorFeedback({
  body = vercelRuntimeSyncCursorBody(),
  path = "package.json",
} = {}) {
  return classifyDependabotFeedback({
    headSha: HEAD_SHA,
    reviews: [cursorReview()],
    threads: [
      {
        comments: [
          {
            actor: { association: "NONE", login: "cursor", type: "Bot" },
            body,
            createdAt: "2026-08-10T10:00:00Z",
            id: 11,
            replyToId: null,
            reviewCommitSha: HEAD_SHA,
            reviewId: 21,
          },
        ],
        id: "thread-vercel-runtime-sync",
        line: 77,
        outdated: false,
        path,
        resolved: false,
      },
    ],
  });
}

function nextCatalogSyncCursorBody({
  fromVersion = "16.2.12",
  reviewCommitSha = HEAD_SHA,
  targetVersion = "16.3.1",
} = {}) {
  return `### Next bump never applied\n\n**High Severity**\n\n<!-- DESCRIPTION START -->\nThis PR claims to move \`next\` from \`${fromVersion}\` to \`${targetVersion}\`, but the lockfile still resolves \`next\` to \`${fromVersion}\` (and peers like \`@vercel/analytics\` still bind that same copy). Catalog and root override remain \`^${fromVersion}\`, so merging ships no Next upgrade while closing the Dependabot request—the exact incomplete \`frontend-core\` failure mode documented in ADR 0007.\n<!-- DESCRIPTION END -->\n\n<!-- BUGBOT_BUG_ID: 8df03061-7960-4b0d-a266-f91a7e607eee -->\n\n<!-- LOCATIONS START\npnpm-lock.yaml#L284-L286\npnpm-lock.yaml#L273-L274\nLOCATIONS END -->\n<details>\n<summary>Additional Locations (1)</summary>\n\n- [\`pnpm-lock.yaml#L273-L274\`](https://github.com/mento-protocol/frontend-monorepo/blob/${reviewCommitSha}/pnpm-lock.yaml#L273-L274)\n\n</details>\n\n<div><a href="https://cursor.com/open?link=fixture" target="_blank" rel="noopener noreferrer"><picture><source media="(prefers-color-scheme: dark)" srcset="https://cursor.com/assets/images/fix-in-cursor-dark.png"><source media="(prefers-color-scheme: light)" srcset="https://cursor.com/assets/images/fix-in-cursor-light.png"><img alt="Fix in Cursor" width="115" height="28" src="https://cursor.com/assets/images/fix-in-cursor-dark.png"></picture></a>&nbsp;<a href="https://cursor.com/agents?link=fixture" target="_blank" rel="noopener noreferrer"><picture><source media="(prefers-color-scheme: dark)" srcset="https://cursor.com/assets/images/fix-in-web-dark.png"><source media="(prefers-color-scheme: light)" srcset="https://cursor.com/assets/images/fix-in-web-light.png"><img alt="Fix in Web" width="99" height="28" src="https://cursor.com/assets/images/fix-in-web-dark.png"></picture></a></div>\n\n\n<sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit ${reviewCommitSha}. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>\n`;
}

function nextCatalogSyncCursorFeedback({
  body = nextCatalogSyncCursorBody(),
  path = "pnpm-lock.yaml",
} = {}) {
  return classifyDependabotFeedback({
    headSha: HEAD_SHA,
    reviews: [cursorReview()],
    threads: [
      {
        comments: [
          {
            actor: { association: "NONE", login: "cursor", type: "Bot" },
            body,
            createdAt: "2026-08-22T17:07:46Z",
            id: 11,
            replyToId: null,
            reviewCommitSha: HEAD_SHA,
            reviewId: 21,
          },
        ],
        id: "thread-next-catalog-sync",
        line: 277,
        outdated: false,
        path,
        resolved: false,
      },
    ],
  });
}

function codexReviewBody(headSha = HEAD_SHA) {
  return `\n### 💡 Codex Review\n\nHere are some automated review suggestions for this pull request.\n\n**Reviewed commit:** \`${headSha.slice(0, 10)}\`\n    \n\n<details> <summary>ℹ️ About Codex in GitHub</summary>\n<br/>\n\nConnector details.\n\n</details>`;
}

function snapshot(overrides = {}) {
  const {
    feedback: feedbackOverride = {},
    pullRequest: pullRequestOverride = {},
    ...snapshotOverrides
  } = overrides;
  const pullRequest = {
    author: { login: "dependabot[bot]" },
    base: {
      ref: "main",
      repo: { fullName: REPOSITORY },
      sha: BASE_SHA,
    },
    body: actionBody(),
    draft: false,
    files: [PACKAGE_BLOB],
    head: {
      ref: "dependabot/github_actions/github-actions-routine-123",
      repo: { fullName: REPOSITORY },
      sha: HEAD_SHA,
    },
    isCrossRepository: false,
    labels: [],
    node_id: "PR_node",
    number: 123,
    state: "open",
    updated_at: "2026-08-10T10:00:00Z",
    ...pullRequestOverride,
  };
  const pullRequestNumber = pullRequest.number;
  const feedback = {
    autoMergeEnabled: false,
    currentProcessorApprovalCount: 0,
    currentProcessorApprovalIds: [],
    mergeable: true,
    mergeStateStatus: "CLEAN",
    reviewDecision: "APPROVED",
    unresolvedThreads: 0,
    ...feedbackOverride,
  };
  return {
    baseAncestry: {
      aheadBy: 1,
      baseCommitSha: BASE_SHA,
      behindBy: 0,
      currentBaseIsAncestor: true,
      currentBaseSha: BASE_SHA,
      headSha: HEAD_SHA,
      mergeBaseSha: BASE_SHA,
      status: "ahead",
    },
    baseline: {
      checks: [
        ...completeBaselineChecks({ pullRequestNumber }),
        postMergeReceipt(BASE_SHA),
      ],
      sha: BASE_SHA,
    },
    checks: completeChecks({ pullRequestNumber }),
    commits: [
      {
        authorLogin: "dependabot[bot]",
        committerLogin: "dependabot[bot]",
        sha: HEAD_SHA,
        verified: true,
      },
    ],
    expectedHeadSha: HEAD_SHA,
    metadata: {
      dependencyNames: ["actions/setup-node"],
      groupedUpdateIntegrity: {
        declaredUpdateCount: 1,
        duplicateDependencyRows: false,
        parsedUpdateCount: 1,
        valid: true,
      },
      immutableEvidence: { valid: true },
      packageEcosystem: "github-actions",
      updateType: "minor",
    },
    repository: REPOSITORY,
    workflowContext: WORKFLOW_CONTEXT,
    ...snapshotOverrides,
    feedback,
    pullRequest,
  };
}

function snapshotForPullRequest(pullRequestNumber, headSha) {
  return snapshot({
    baseAncestry: {
      aheadBy: 1,
      baseCommitSha: BASE_SHA,
      behindBy: 0,
      currentBaseIsAncestor: true,
      currentBaseSha: BASE_SHA,
      headSha,
      mergeBaseSha: BASE_SHA,
      status: "ahead",
    },
    checks: completeChecks({ headSha, pullRequestNumber }),
    commits: [
      {
        authorLogin: "dependabot[bot]",
        committerLogin: "dependabot[bot]",
        sha: headSha,
        verified: true,
      },
    ],
    expectedHeadSha: headSha,
    pullRequest: {
      head: {
        ref: `dependabot/github_actions/github-actions-routine-${pullRequestNumber}`,
        repo: { fullName: REPOSITORY },
        sha: headSha,
      },
      number: pullRequestNumber,
    },
  });
}

function repairPendingSnapshotForPullRequest(
  pullRequestNumber,
  headSha,
  checkId,
) {
  const current = snapshotForPullRequest(pullRequestNumber, headSha);
  current.checks = completeChecks({
    conclusions: { ci: "failure" },
    headSha,
    pullRequestNumber,
  });
  const evaluated = evaluateDependabotPullRequest(current, {
    mode: "prepare",
    repository: REPOSITORY,
    workflowContext: WORKFLOW_CONTEXT,
  });
  assert.equal(evaluated.disposition, "repair-required");
  assert.notEqual(evaluated.repairPacket, null);
  const packetCheck = processorRepairReceipt(1, {
    headSha,
    id: checkId,
    packet: evaluated.repairPacket,
    packetEncoding: "canonical",
    pullRequestNumber,
  });
  packetCheck.outputSummary = "Disposition: repair-required";
  current.checks.push(packetCheck);
  current.repairHistoryChecks = [packetCheck];
  return current;
}

function staleSnapshotForPullRequest(pullRequestNumber, headSha) {
  const current = snapshotForPullRequest(pullRequestNumber, headSha);
  current.pullRequest.base.sha = MERGE_SHA;
  current.baseAncestry = {
    aheadBy: 1,
    baseCommitSha: BASE_SHA,
    behindBy: 1,
    currentBaseIsAncestor: false,
    currentBaseSha: BASE_SHA,
    headSha,
    mergeBaseSha: MERGE_SHA,
    status: "diverged",
  };
  return current;
}

function staleSnapshot() {
  return snapshot({
    baseAncestry: {
      aheadBy: 1,
      baseCommitSha: BASE_SHA,
      behindBy: 1,
      currentBaseIsAncestor: false,
      currentBaseSha: BASE_SHA,
      headSha: HEAD_SHA,
      mergeBaseSha: MERGE_SHA,
      status: "diverged",
    },
    pullRequest: {
      base: {
        ref: "main",
        repo: { fullName: REPOSITORY },
        sha: MERGE_SHA,
      },
    },
  });
}

function refreshedSnapshot({ feedback = {}, repairHistoryChecks = [] } = {}) {
  return snapshot({
    baseAncestry: {
      aheadBy: 2,
      baseCommitSha: BASE_SHA,
      behindBy: 0,
      currentBaseIsAncestor: true,
      currentBaseSha: BASE_SHA,
      headSha: OTHER_SHA,
      mergeBaseSha: BASE_SHA,
      status: "ahead",
    },
    checks: completeChecks({ headSha: OTHER_SHA }),
    commits: [
      nativeDependabotCommit(HEAD_SHA),
      {
        authorId: PREPARE_ACTOR.botId,
        authorLogin: PREPARE_ACTOR.botLogin,
        authorType: "Bot",
        committerId: 19_864_447,
        committerLogin: "web-flow",
        committerType: "User",
        parents: [HEAD_SHA, BASE_SHA],
        sha: OTHER_SHA,
        verified: true,
        verificationReason: "valid",
      },
    ],
    expectedHeadSha: OTHER_SHA,
    feedback,
    prepareActor: PREPARE_ACTOR,
    pullRequest: {
      head: {
        ref: "dependabot/github_actions/github-actions-routine-123",
        repo: { fullName: REPOSITORY },
        sha: OTHER_SHA,
      },
    },
    repairHistoryChecks,
  });
}

function evaluatePrepareSerializationReceipt(receipt) {
  const current = snapshot();
  current.baseline.checks = [
    ...current.baseline.checks.filter(
      ({ name }) => name !== "Dependabot Post-Merge Verification",
    ),
    receipt,
  ];
  return evaluateDependabotSweep({
    mode: "prepare",
    pullRequests: [current],
    repository: REPOSITORY,
    workflowContext: WORKFLOW_CONTEXT,
  });
}

function withCurrentProcessorApproval(current, approvalId = 7001) {
  current.feedback.currentProcessorApprovalCount = 1;
  current.feedback.currentProcessorApprovalIds = [approvalId];
  return current;
}

function processorApprovalResult(approvalId = 7001) {
  return {
    id: approvalId,
    state: "APPROVED",
    updatedAt: "2026-08-10T10:00:00Z",
  };
}

async function noOutstandingProcessorApprovals() {
  return [];
}

async function activeAllClearSnapshot({
  approvalId,
  checkId,
  headSha,
  pullRequestNumber,
}) {
  let approved = false;
  let receipt = null;
  const currentSnapshot = () => {
    const current = snapshotForPullRequest(pullRequestNumber, headSha);
    if (approved) withCurrentProcessorApproval(current, approvalId);
    return current;
  };
  await processDependabotSweep({
    adapter: {
      approvePullRequest: async () => {
        approved = true;
        return processorApprovalResult(approvalId);
      },
      collectPullRequestSnapshot: async () => currentSnapshot(),
      dismissPullRequestApproval: async () =>
        assert.fail("ALL CLEAR setup must preserve its approval"),
      getOutstandingDependabotAutoMergeRequests: async () => [],
      getOutstandingDependabotProcessorApprovals: async () =>
        approved ? [{ approvalId, headSha, pullRequestNumber }] : [],
      publishAllClear: async ({ receipt: publishedReceipt }) => {
        receipt = publishedReceipt;
        return { id: checkId };
      },
      publishAllClearInvalidation: async () =>
        assert.fail("ALL CLEAR setup must not invalidate its receipt"),
      publishProcessorCheck: async () => ({ id: checkId - 1 }),
    },
    input: {
      mode: "prepare",
      outstandingAutoMergeRequests: [],
      pullRequests: [currentSnapshot()],
      repository: REPOSITORY,
      workflowContext: WORKFLOW_CONTEXT,
    },
    phase: "finalize",
    publishChecks: true,
    workflowContext: WORKFLOW_CONTEXT,
  });
  assert.notEqual(receipt, null);
  const allClearCheck = trustedReceiptCheck({
    externalId: `${DEPENDABOT_ALL_CLEAR_SCHEMA}:pr=${pullRequestNumber}:head=${headSha}:base=${BASE_SHA}:digest=${digest(receipt)}:run=${WORKFLOW_CONTEXT.workflowRunId}:attempt=${WORKFLOW_CONTEXT.workflowRunAttempt}`,
    headSha,
    id: checkId,
    name: "Dependabot ALL CLEAR",
    receipt,
    workflowContext: WORKFLOW_CONTEXT,
    workflowPath: ".github/workflows/dependabot-process.yml",
  });
  const current = currentSnapshot();
  current.checks.push(allClearCheck);
  return current;
}

function liveApprovalPullRequest(overrides = {}) {
  return {
    base: {
      ref: "main",
      repo: { full_name: REPOSITORY },
      sha: BASE_SHA,
    },
    body: actionBody(),
    changed_files: 1,
    draft: false,
    head: {
      ref: "dependabot/github_actions/github-actions-routine-123",
      repo: { full_name: REPOSITORY },
      sha: HEAD_SHA,
    },
    labels: [],
    node_id: "PR_node",
    number: 123,
    state: "open",
    updated_at: "2026-08-10T10:00:00Z",
    user: { login: "dependabot[bot]" },
    ...overrides,
  };
}

function liveProcessorReview(state = "APPROVED", overrides = {}) {
  return {
    body: `Approved by ${DEPENDABOT_PROCESSOR_SCHEMA} for exact head ${HEAD_SHA}.`,
    commit_id: HEAD_SHA,
    id: 7001,
    state,
    user: { login: "github-actions[bot]", type: "Bot" },
    ...overrides,
  };
}

function allClearInvalidationCheck({
  blocking = true,
  headSha = HEAD_SHA,
  id = 60_001,
  pullRequestNumber = 123,
} = {}) {
  return {
    appId: 15_368,
    conclusion: blocking ? "failure" : "neutral",
    externalId: `dependabot-all-clear-${blocking ? "invalidated" : "tombstone"}:v1:pr=${pullRequestNumber}:head=${headSha}`,
    headSha,
    id,
    name: "Dependabot ALL CLEAR",
    status: "completed",
  };
}

function forcePushTimelinePayload(nodes = [], { hasNextPage = false } = {}) {
  return {
    data: {
      repository: {
        pullRequest: {
          timelineItems: {
            nodes,
            pageInfo: { hasNextPage },
            totalCount: nodes.length + (hasNextPage ? 1 : 0),
          },
        },
      },
    },
  };
}

function liveMergeAdmissionFetch({ events = [], labels = [] } = {}) {
  return async (url, options = {}) => {
    const parsed = new URL(url);
    const path = parsed.pathname;
    if (path === `/repos/${REPOSITORY}/pulls/123`) {
      return new Response(
        JSON.stringify({
          base: {
            ref: "main",
            repo: { full_name: REPOSITORY },
            sha: BASE_SHA,
          },
          draft: false,
          head: {
            ref: "dependabot/github_actions/github-actions-routine-123",
            repo: { full_name: REPOSITORY },
            sha: HEAD_SHA,
          },
          labels: labels.map((name) => ({ name })),
          node_id: "PR_node",
          number: 123,
          state: "open",
          updated_at: "2026-08-10T10:00:00Z",
          user: { login: "dependabot[bot]" },
        }),
        { status: 200 },
      );
    }
    if (url.endsWith("/graphql")) {
      const { query } = JSON.parse(options.body);
      if (query.includes("DependabotProcessorAutoMergeRequests")) {
        return new Response(
          JSON.stringify({
            data: {
              repository: {
                pullRequests: {
                  nodes: [],
                  pageInfo: { endCursor: null, hasNextPage: false },
                },
              },
            },
          }),
          { status: 200 },
        );
      }
      if (query.includes("DependabotForcePushHistory")) {
        return new Response(JSON.stringify(forcePushTimelinePayload()), {
          status: 200,
        });
      }
      return new Response(
        JSON.stringify({
          data: {
            repository: {
              pullRequest: {
                autoMergeRequest: null,
                headRefOid: HEAD_SHA,
                id: "PR_node",
                isDraft: false,
                mergeStateStatus: "CLEAN",
                reviewDecision: "APPROVED",
                reviewThreads: {
                  nodes: [],
                  pageInfo: { endCursor: null, hasNextPage: false },
                },
                updatedAt: "2026-08-10T10:00:00Z",
              },
            },
          },
        }),
        { status: 200 },
      );
    }
    if (
      path === `/repos/${REPOSITORY}/pulls/123/reviews` ||
      path === `/repos/${REPOSITORY}/issues/123/comments`
    ) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    if (path === `/repos/${REPOSITORY}/issues/123/events`) {
      return new Response(JSON.stringify(events), { status: 200 });
    }
    if (path === `/repos/${REPOSITORY}/commits/main`) {
      return new Response(JSON.stringify({ sha: BASE_SHA }), { status: 200 });
    }
    if (path === `/repos/${REPOSITORY}/compare/${BASE_SHA}...${HEAD_SHA}`) {
      return new Response(
        JSON.stringify({
          ahead_by: 1,
          base_commit: { sha: BASE_SHA },
          behind_by: 0,
          merge_base_commit: { sha: BASE_SHA },
          status: "ahead",
        }),
        { status: 200 },
      );
    }
    if (path === `/repos/${REPOSITORY}/git/trees/${HEAD_SHA}`) {
      return new Response(JSON.stringify({ tree: [], truncated: false }), {
        status: 200,
      });
    }
    assert.fail(`Unexpected request: ${options.method} ${url}`);
  };
}

test("only exact lowercase processor mode strings grant configured authority", () => {
  assert.equal(normalizeProcessorMode("observe"), "observe");
  assert.equal(normalizeProcessorMode("assist"), "assist");
  assert.equal(normalizeProcessorMode("prepare"), "prepare");
  assert.equal(normalizeProcessorMode("merge"), "observe");
  assert.equal(normalizeProcessorMode("Merge"), "observe");
  assert.equal(normalizeProcessorMode("MERGE"), "observe");
  assert.equal(normalizeProcessorMode(" merge "), "observe");
  assert.equal(normalizeProcessorMode("Prepare"), "observe");
  assert.equal(normalizeProcessorMode(" prepare "), "observe");
  assert.equal(normalizeProcessorMode(["merge"]), "observe");
  assert.equal(normalizeProcessorMode("future-mode"), "observe");
  assert.equal(normalizeProcessorMode(undefined), "observe");
});

test("processor phase parsing defaults to finalize and accepts only the three capability phases", () => {
  assert.equal(normalizeProcessorPhase(), "finalize");
  assert.equal(normalizeProcessorPhase(""), "finalize");
  assert.equal(normalizeProcessorPhase("request"), "request");
  assert.equal(normalizeProcessorPhase("mutate"), "mutate");
  assert.equal(normalizeProcessorPhase("finalize"), "finalize");
  for (const value of [
    "Request",
    "Mutate",
    " mutate ",
    "merge",
    "future",
    [],
  ]) {
    assert.throws(
      () => normalizeProcessorPhase(value),
      /Processor phase must be exactly request, mutate, or finalize/,
    );
  }
});

test("generic npm repairs collect canonical companion inputs", () => {
  assert.deepEqual(
    selectDependabotRepairBlobPaths({
      files: [
        { filename: "pnpm-lock.yaml" },
        { filename: "pnpm-workspace.yaml" },
      ],
      packageEcosystem: "npm",
    }),
    ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"],
  );
  assert.deepEqual(
    selectDependabotRepairBlobPaths({
      files: [{ filename: ".github/workflows/ci.yml" }],
      packageEcosystem: "github-actions",
    }),
    [".github/workflows/ci.yml"],
  );
  assert.deepEqual(
    selectDependabotRepairBlobPaths({
      files: [{ filename: "package.json" }],
      packageEcosystem: "npm",
      protectedRuntimeEligible: true,
    }),
    VERCEL_INPUT_PATHS,
  );
  assert.deepEqual(
    selectDependabotRepairBlobPaths({
      files: [{ filename: "pnpm-workspace.yaml" }],
      nextCatalogSyncEligible: true,
      packageEcosystem: "npm",
    }),
    VERCEL_INPUT_PATHS,
  );
});

test("parses exact Dependabot action dependencies and the highest semver tier", () => {
  const body = `${actionBody("actions/setup-node", "6.0.0", "6.0.1")}\n| [actions/cache](https://github.com/actions/cache) | \`4.0.0\` | \`4.2.0\` |`;
  assert.deepEqual(
    parseDependabotMetadata({
      body,
      files: [".github/workflows/ci.yml"],
      headRef: "dependabot/github_actions/github-actions-deadbeef",
    }),
    {
      dependencies: [
        {
          from: "6.0.0",
          name: "actions/setup-node",
          to: "6.0.1",
          updateType: "patch",
        },
        {
          from: "4.0.0",
          name: "actions/cache",
          to: "4.2.0",
          updateType: "minor",
        },
      ],
      dependencyGroup: "github-actions",
      dependencyNames: ["actions/cache", "actions/setup-node"],
      groupedUpdateIntegrity: {
        declaredUpdateCount: 1,
        duplicateDependencyRows: false,
        parsedUpdateCount: 2,
        valid: false,
      },
      packageEcosystem: "github-actions",
      updateType: "minor",
    },
  );
});

test("parses the immutable single-dependency npm commit format", () => {
  assert.deepEqual(
    parseDependabotMetadata({
      body: `chore(deps): bump dompurify

Bumps the security-runtime group with 1 update in the / directory: [dompurify](https://github.com/cure53/DOMPurify).

Updates \`dompurify\` from 3.4.12 to 3.4.13`,
      files: ["package.json", "pnpm-lock.yaml"],
      headRef: "dependabot/npm_and_yarn/security-runtime-deadbeef",
    }),
    {
      dependencies: [
        {
          from: "3.4.12",
          name: "dompurify",
          to: "3.4.13",
          updateType: "patch",
        },
      ],
      dependencyGroup: "security-runtime",
      dependencyNames: ["dompurify"],
      groupedUpdateIntegrity: {
        declaredUpdateCount: 1,
        duplicateDependencyRows: false,
        parsedUpdateCount: 1,
        valid: true,
      },
      packageEcosystem: "npm",
      updateType: "patch",
    },
  );
});

test("parses the direct single-dependency Dependabot commit format", () => {
  assert.deepEqual(
    parseDependabotMetadata({
      body: `chore(deps): bump @tiptap/react from 3.15.3 to 3.29.0

Bumps [@tiptap/react](https://github.com/ueberdosis/tiptap/tree/HEAD/packages/react) from 3.15.3 to 3.29.0.`,
      files: ["package.json", "pnpm-lock.yaml"],
      headRef: "dependabot/npm_and_yarn/tiptap-react-deadbeef",
    }),
    {
      dependencies: [
        {
          from: "3.15.3",
          name: "@tiptap/react",
          to: "3.29.0",
          updateType: "minor",
        },
      ],
      dependencyGroup: null,
      dependencyNames: ["@tiptap/react"],
      groupedUpdateIntegrity: {
        declaredUpdateCount: null,
        duplicateDependencyRows: false,
        parsedUpdateCount: 1,
        valid: true,
      },
      packageEcosystem: "npm",
      updateType: "minor",
    },
  );
});

test("grouped immutable metadata fails closed on partial or duplicate update rows", () => {
  const partialMessage = actionBody().replace(
    "with 1 update",
    "with 2 updates",
  );
  const partial = deriveImmutableDependabotMetadata({
    commits: [
      {
        author: { login: "dependabot[bot]" },
        commit: {
          message: partialMessage.replace(
            "github-actions group",
            "github-actions-routine group",
          ),
          verification: { verified: true },
        },
        committer: { login: "web-flow" },
        sha: HEAD_SHA,
      },
    ],
    files: [{ filename: ".github/workflows/ci.yml", status: "modified" }],
    headRef: "dependabot/github_actions/github-actions-routine-deadbeef",
    headSha: HEAD_SHA,
  });
  assert.deepEqual(partial.groupedUpdateIntegrity, {
    declaredUpdateCount: 2,
    duplicateDependencyRows: false,
    parsedUpdateCount: 1,
    valid: false,
  });
  assert.equal(partial.immutableEvidence.valid, false);
  assert.equal(classifyDependabotRisk(partial).autoApprovable, false);

  const duplicateRow =
    "| [actions/setup-node](https://github.com/actions/setup-node) | `6.0.0` | `6.1.0` |";
  const duplicate = deriveImmutableDependabotMetadata({
    commits: [
      {
        author: { login: "dependabot[bot]" },
        commit: {
          message: `${partialMessage.replace(
            "github-actions group",
            "github-actions-routine group",
          )}\n${duplicateRow}`,
          verification: { verified: true },
        },
        committer: { login: "web-flow" },
        sha: HEAD_SHA,
      },
    ],
    files: [{ filename: ".github/workflows/ci.yml", status: "modified" }],
    headRef: "dependabot/github_actions/github-actions-routine-deadbeef",
    headSha: HEAD_SHA,
  });
  assert.equal(duplicate.groupedUpdateIntegrity.duplicateDependencyRows, true);
  assert.equal(duplicate.groupedUpdateIntegrity.valid, false);
  assert.equal(duplicate.immutableEvidence.valid, false);
});

test("only non-sensitive GitHub Actions patch and minor updates are auto-approvable", () => {
  const safe = classifyDependabotRisk({
    dependencyNames: ["actions/setup-node"],
    immutableEvidence: { valid: true },
    packageEcosystem: "github-actions",
    updateType: "patch",
  });
  assert.equal(safe.tier, "safe-actions-patch-minor");
  assert.equal(safe.autoApprovable, true);

  for (const name of [
    "dependabot/fetch-metadata",
    "anthropics/claude-code-action",
    "github/codeql-action/upload-sarif",
    "ossf/scorecard-action",
    "actions/dependency-review-action",
    "actions/create-github-app-token",
    "step-security/harden-runner",
  ]) {
    const sensitive = classifyDependabotRisk({
      dependencyNames: [name],
      immutableEvidence: { valid: true },
      packageEcosystem: "github-actions",
      updateType: "patch",
    });
    assert.equal(sensitive.tier, "manual-sensitive-action", name);
    assert.equal(sensitive.autoApprovable, false, name);
  }
});

test("npm, action majors, and incomplete metadata stay manual", () => {
  assert.equal(
    classifyDependabotRisk({
      dependencyNames: ["next"],
      packageEcosystem: "npm",
      updateType: "patch",
    }).tier,
    "manual-npm",
  );
  assert.equal(
    classifyDependabotRisk({
      dependencyNames: ["actions/setup-node"],
      immutableEvidence: { valid: true },
      packageEcosystem: "github-actions",
      updateType: "major",
    }).tier,
    "manual-action-major-or-unknown",
  );
  assert.equal(
    classifyDependabotRisk({
      dependencyNames: [],
      immutableEvidence: { valid: true },
      packageEcosystem: "github-actions",
      updateType: "minor",
    }).tier,
    "manual-unknown-action",
  );
});

test("editable PR body metadata can neither grant nor hide the automatic action tier", () => {
  assert.equal(
    classifyDependabotRisk({
      dependencyNames: ["actions/setup-node"],
      packageEcosystem: "github-actions",
      updateType: "patch",
    }).tier,
    "manual-unverified-action-metadata",
  );

  const hiddenSensitive = snapshot({
    metadata: {
      dependencyGroup: "github-actions-routine",
      dependencyNames: ["github/codeql-action/upload-sarif"],
      immutableEvidence: { valid: true },
      packageEcosystem: "github-actions",
      updateType: "patch",
    },
    pullRequest: {
      ...snapshot().pullRequest,
      body: actionBody("actions/setup-node", "6.0.0", "6.0.1"),
    },
  });
  assert.equal(
    evaluateDependabotPullRequest(hiddenSensitive, {
      mode: "prepare",
      repository: REPOSITORY,
    }).risk.tier,
    "manual-sensitive-action",
  );

  const bodyOnlySensitive = snapshot({
    pullRequest: {
      ...snapshot().pullRequest,
      body: actionBody("github/codeql-action/upload-sarif", "4.0.0", "4.0.1"),
    },
  });
  assert.equal(
    evaluateDependabotPullRequest(bodyOnlySensitive, {
      mode: "prepare",
      repository: REPOSITORY,
    }).risk.tier,
    "safe-actions-patch-minor",
  );
});

test("accepts the live verified Dependabot author plus web-flow committer as immutable evidence", () => {
  const commit = {
    author: { login: "dependabot[bot]" },
    commit: {
      message: actionBody().replace(
        "github-actions group",
        "github-actions-routine group",
      ),
      verification: { verified: true },
    },
    committer: { login: "web-flow" },
    sha: HEAD_SHA,
  };
  const metadata = deriveImmutableDependabotMetadata({
    commits: [commit],
    files: [{ filename: ".github/workflows/ci.yml", status: "modified" }],
    headRef: "dependabot/github_actions/github-actions-routine-deadbeef",
    headSha: HEAD_SHA,
  });
  assert.equal(metadata.immutableEvidence.valid, true);
  assert.equal(metadata.maintainerChanges, false);
  assert.equal(classifyDependabotRisk(metadata).autoApprovable, true);

  const repairMetadata = deriveImmutableDependabotMetadata({
    commits: [
      { ...commit, sha: OTHER_SHA },
      {
        ...commit,
        author: { login: "alice" },
        sha: HEAD_SHA,
      },
    ],
    files: [{ filename: ".github/workflows/ci.yml", status: "modified" }],
    headRef: "dependabot/github_actions/github-actions-routine-deadbeef",
    headSha: HEAD_SHA,
  });
  assert.equal(repairMetadata.immutableEvidence.valid, true);
  assert.equal(repairMetadata.immutableEvidence.seedCommitSha, OTHER_SHA);
  assert.equal(repairMetadata.immutableEvidence.repairCommitCount, 1);
  assert.equal(repairMetadata.maintainerChanges, true);
  assert.equal(repairMetadata.repairChanges, true);

  const staleCommit = deriveImmutableDependabotMetadata({
    commits: [commit],
    files: [{ filename: ".github/workflows/ci.yml", status: "modified" }],
    headRef: "dependabot/github_actions/github-actions-routine-deadbeef",
    headSha: OTHER_SHA,
  });
  assert.equal(staleCommit.immutableEvidence.valid, false);
  assert.equal(classifyDependabotRisk(staleCommit).autoApprovable, false);

  const maintainerCommit = {
    ...commit,
    author: { login: "maintainer" },
  };
  const rejected = deriveImmutableDependabotMetadata({
    commits: [maintainerCommit],
    files: [{ filename: ".github/workflows/ci.yml", status: "modified" }],
    headRef: "dependabot/github_actions/github-actions-routine-deadbeef",
    headSha: HEAD_SHA,
  });
  assert.equal(rejected.immutableEvidence.valid, false);
  assert.equal(rejected.maintainerChanges, true);
});

test("validates exact same-repository Dependabot identity and rejects stale or edited heads", () => {
  const valid = snapshot();
  assert.equal(
    validateDependabotPullRequestIdentity({
      commits: valid.commits,
      expectedHeadSha: valid.expectedHeadSha,
      metadata: valid.metadata,
      pullRequest: valid.pullRequest,
      repository: REPOSITORY,
    }).valid,
    true,
  );

  const invalid = validateDependabotPullRequestIdentity({
    commits: [{ authorLogin: "maintainer", sha: OTHER_SHA }],
    expectedHeadSha: OTHER_SHA,
    metadata: valid.metadata,
    pullRequest: {
      ...valid.pullRequest,
      author: { login: "someone-else" },
      base: { ...valid.pullRequest.base, ref: "release" },
      head: { ...valid.pullRequest.head, repo: { fullName: "fork/repo" } },
    },
    repository: REPOSITORY,
  });
  assert.equal(invalid.valid, false);
  assert.deepEqual(invalid.reasons.sort(), [
    "author-is-not-dependabot",
    "head-repository-mismatch",
    "head-sha-changed",
    "immutable-commit-head-mismatch",
    "maintainer-changes-present",
    "unexpected-base-ref",
  ]);
});

test("rejects a close-reopen ABA when only the monotonic PR update token changed", () => {
  const pullRequest = {
    draft: false,
    base: {
      ref: "main",
      repo: { full_name: REPOSITORY },
      sha: BASE_SHA,
    },
    head: {
      ref: "dependabot/github_actions/github-actions-routine-123",
      repo: { full_name: REPOSITORY },
      sha: HEAD_SHA,
    },
    node_id: "PR_node",
    number: 123,
    state: "open",
    updated_at: "2026-08-10T10:00:00Z",
    user: { login: "dependabot[bot]" },
  };
  assert.throws(
    () =>
      requireStablePullRequestSnapshot(
        pullRequest,
        { ...pullRequest, updated_at: "2026-08-10T10:00:01Z" },
        123,
      ),
    /changed while its exact-head snapshot was collected/,
  );
});

test("stable PR snapshots bind every approval identity field", () => {
  const pullRequest = {
    base: {
      ref: "main",
      repo: { full_name: REPOSITORY },
      sha: BASE_SHA,
    },
    draft: false,
    head: {
      ref: "dependabot/github_actions/github-actions-routine-123",
      repo: { full_name: REPOSITORY },
      sha: HEAD_SHA,
    },
    node_id: "PR_node",
    number: 123,
    state: "open",
    updated_at: "2026-08-10T10:00:00Z",
    user: { login: "dependabot[bot]" },
  };
  requireStablePullRequestSnapshot(
    pullRequest,
    structuredClone(pullRequest),
    123,
  );
  const changes = [
    (current) => {
      current.number = 124;
    },
    (current) => {
      current.node_id = "PR_other";
    },
    (current) => {
      current.state = "closed";
    },
    (current) => {
      current.draft = true;
    },
    (current) => {
      current.user.login = "someone-else";
    },
    (current) => {
      current.base.ref = "release";
    },
    (current) => {
      current.base.repo.full_name = "other/repo";
    },
    (current) => {
      current.base.sha = OTHER_SHA;
    },
    (current) => {
      current.head.ref = "dependabot/npm/foo";
    },
    (current) => {
      current.head.repo.full_name = "fork/repo";
    },
    (current) => {
      current.head.sha = OTHER_SHA;
    },
    (current) => {
      current.isCrossRepository = true;
    },
    (current) => {
      current.updated_at = "2026-08-10T10:00:01Z";
    },
  ];
  for (const change of changes) {
    const current = structuredClone(pullRequest);
    change(current);
    assert.throws(
      () => requireStablePullRequestSnapshot(pullRequest, current, 123),
      /changed while its exact-head snapshot was collected/,
    );
  }
});

test("rejects automatic metadata when the sole immutable commit is not the exact PR head", () => {
  const current = snapshot({
    commits: [{ authorLogin: "dependabot[bot]", sha: OTHER_SHA }],
  });
  const evaluation = evaluateDependabotPullRequest(current, {
    mode: "prepare",
    repository: REPOSITORY,
  });
  assert.equal(evaluation.identity.valid, false);
  assert.ok(
    evaluation.identity.reasons.includes("immutable-commit-head-mismatch"),
  );
  assert.equal(evaluation.disposition, "rejected-identity");
});

test("selects only the latest result attached to the exact head", () => {
  const definition = { names: [/^Build and Test$/] };
  const selected = selectLatestExactHeadCheck(
    [
      check("Build and Test", "failure", {
        completedAt: "2026-08-10T09:00:00Z",
        id: 5,
      }),
      check("Build and Test", "success", {
        completedAt: "2026-08-10T10:00:00Z",
        id: 6,
      }),
      check("Build and Test", "failure", {
        completedAt: "2026-08-10T11:00:00Z",
        headSha: OTHER_SHA,
        id: 7,
      }),
    ],
    HEAD_SHA,
    definition,
  );
  assert.equal(selected.id, 6);
  assert.equal(selected.conclusion, "success");
});

test("a newer untrusted duplicate check run supersedes an older trusted pass", () => {
  const older = check("Build and Test", "success", { id: 100 });
  const newerRogue = check("Build and Test", "success", {
    id: 101,
    source: { runId: 0 },
  });
  const checks = completeChecks().filter(
    ({ name }) => name !== "Build and Test",
  );
  checks.push(older, newerRogue);

  const selected = selectLatestExactHeadCheck(checks, HEAD_SHA, {
    id: "ci",
    names: [/^Build and Test$/],
  });
  assert.equal(selected.id, 101);

  const result = evaluateDependabotChecks({
    checks,
    headSha: HEAD_SHA,
    pullRequestNumber: 123,
    repository: REPOSITORY,
  });
  const ci = result.policy.find(({ id }) => id === "ci");
  assert.equal(ci.check.id, 101);
  assert.equal(ci.reason, "invalid-workflow-run-id");
  assert.equal(ci.state, "failing");
  assert.equal(result.state, "failing");
});

test("the policy names every CI, supply-chain, quality, E2E, VRT, review, and Vercel gate", () => {
  assert.deepEqual(
    [...DEPENDABOT_CHECK_POLICY.map(({ id }) => id)].sort(),
    Object.keys(CHECK_NAMES).sort(),
  );
  assert.equal(new Set(DEPENDABOT_CHECK_POLICY.map(({ id }) => id)).size, 21);
});

test("the shared fork clock selects every connected E2E lane", () => {
  for (const path of [
    "scripts/fork-test-clock.mjs",
    "scripts/fork-test-clock.test.mjs",
  ]) {
    assert.deepEqual(derivePlannerDecisions([path]), {
      e2eApp: true,
      e2eGovernance: true,
      e2eMonad: true,
      visualApp: false,
      visualUi: false,
    });
  }
});

test("accepts skipped E2E and VRT jobs only when their exact-head planners pass", () => {
  const accepted = evaluateDependabotChecks({
    checks: completeChecks({ plannedSkips: true }),
    headSha: HEAD_SHA,
    plannerDecisions: {
      e2eApp: false,
      e2eGovernance: false,
      e2eMonad: false,
      visualApp: false,
      visualUi: false,
    },
    pullRequestNumber: 123,
    repository: REPOSITORY,
  });
  assert.equal(accepted.state, "passing");
  assert.equal(
    accepted.policy.find(({ id }) => id === "e2e-celo").reason,
    "planner-backed-skip",
  );

  const unjustifiedChecks = completeChecks({ plannedSkips: true }).filter(
    ({ name }) => name !== "E2E Plan",
  );
  const rejected = evaluateDependabotChecks({
    checks: unjustifiedChecks,
    headSha: HEAD_SHA,
    plannerDecisions: {
      e2eApp: false,
      e2eGovernance: false,
      e2eMonad: false,
      visualApp: false,
      visualUi: false,
    },
    pullRequestNumber: 123,
    repository: REPOSITORY,
  });
  assert.equal(rejected.state, "failing");
  assert.deepEqual(
    rejected.failures
      .filter(({ id }) => id.startsWith("e2e-"))
      .map(({ id, reason }) => ({ id, reason })),
    [
      { id: "e2e-celo", reason: "unjustified-skip" },
      { id: "e2e-governance", reason: "unjustified-skip" },
      { id: "e2e-monad", reason: "unjustified-skip" },
    ],
  );
});

test("rejects a skipped job when the trusted path planner selected that surface", () => {
  const result = evaluateDependabotChecks({
    checks: completeChecks({ plannedSkips: true }),
    headSha: HEAD_SHA,
    plannerDecisions: {
      e2eApp: true,
      e2eGovernance: false,
      e2eMonad: false,
      visualApp: false,
      visualUi: false,
    },
    pullRequestNumber: 123,
    repository: REPOSITORY,
  });
  const celo = result.policy.find(({ id }) => id === "e2e-celo");
  assert.equal(celo.state, "failing");
  assert.equal(celo.reason, "unjustified-skip");
});

test("check source event selection fails closed without an explicit baseline allowlist", () => {
  assert.deepEqual(
    selectAllowedCheckEvents({ events: ["pull_request"] }, true),
    [],
  );
  assert.deepEqual(
    selectAllowedCheckEvents(
      { baselineEvents: "push", events: ["pull_request"] },
      true,
    ),
    [],
  );
  assert.deepEqual(
    selectAllowedCheckEvents(
      { baselineEvents: ["push"], events: ["pull_request"] },
      true,
    ),
    ["push"],
  );
  assert.deepEqual(selectAllowedCheckEvents({ events: ["pull_request"] }), [
    "pull_request",
  ]);
  assert.deepEqual(selectAllowedCheckEvents({ events: "pull_request" }), []);
});

test("fails closed on an unexpected check app, workflow, event, attempt, or source repository", () => {
  for (const source of [
    { appId: 1 },
    { workflowPath: ".github/workflows/untrusted.yml" },
    { workflowEvent: "repository_dispatch" },
    { runAttempt: 0 },
    { sourceRepository: "attacker/fork" },
  ]) {
    const checks = completeChecks();
    const index = checks.findIndex(({ name }) => name === "Build and Test");
    checks[index] = { ...checks[index], ...source };
    const result = evaluateDependabotChecks({
      baselineChecks: completeBaselineChecks(),
      baselineSha: BASE_SHA,
      checks,
      headSha: HEAD_SHA,
      pullRequestNumber: 123,
      repository: REPOSITORY,
    });
    assert.equal(
      result.policy.find(({ id }) => id === "ci").state,
      "failing",
      JSON.stringify(source),
    );
  }
});

test("Claude review requires the workflow-run receipt, main source ref, and exact API check identity", () => {
  const validChecks = completeChecks();
  const valid = evaluateDependabotChecks({
    checks: validChecks,
    headSha: HEAD_SHA,
    pullRequestNumber: 123,
    repository: REPOSITORY,
  });
  assert.equal(
    valid.policy.find(({ id }) => id === "claude-review").state,
    "passing",
  );

  const rewrittenChecks = completeChecks();
  const rewrittenIndex = rewrittenChecks.findIndex(
    ({ name }) => name === "claude-review",
  );
  rewrittenChecks[rewrittenIndex] = {
    ...rewrittenChecks[rewrittenIndex],
    detailsUrl: `https://github.com/${REPOSITORY}/runs/${rewrittenChecks[rewrittenIndex].id}`,
  };
  const rewritten = evaluateDependabotChecks({
    checks: rewrittenChecks,
    headSha: HEAD_SHA,
    pullRequestNumber: 123,
    repository: REPOSITORY,
  });
  assert.equal(
    rewritten.policy.find(({ id }) => id === "claude-review").state,
    "passing",
  );

  for (const variant of [
    {
      detailsUrl: `https://github.com/${REPOSITORY}/actions/runs/2`,
      name: "Claude-Review",
    },
    {
      detailsUrl: `https://github.com/${REPOSITORY}/runs/2`,
      name: "CLAUDE-REVIEW",
    },
  ]) {
    const checks = completeChecks();
    const index = checks.findIndex(({ name }) => name === "claude-review");
    checks.push({
      ...checks[index],
      detailsUrl: variant.detailsUrl,
      externalId: `dependabot-claude-review:v1:pr=123:sha=${HEAD_SHA}:run=2:attempt=1`,
      id: 2,
      name: variant.name,
      runId: 2,
    });
    const result = evaluateDependabotChecks({
      checks,
      headSha: HEAD_SHA,
      pullRequestNumber: 123,
      repository: REPOSITORY,
    });
    const policy = result.policy.find(({ id }) => id === "claude-review");
    assert.equal(policy.check.name, variant.name, JSON.stringify(variant));
    assert.equal(policy.state, "failing", JSON.stringify(variant));
    assert.equal(
      policy.reason,
      "unexpected-claude-review-check-name",
      JSON.stringify(variant),
    );
  }

  for (const mutation of [
    { runHeadBranch: "dependabot-branch" },
    { runHeadSha: HEAD_SHA },
    {
      runDisplayTitle: `dependabot-claude-review:v1 | source=dependabot-intake:v1 | repository=${REPOSITORY} | pr=123 | sha=${OTHER_SHA} | action=synchronize | receipt=true`,
    },
    {
      externalId: `dependabot-claude-review:v1:pr=123:sha=${HEAD_SHA}:run=1:attempt=2`,
    },
    {
      externalId: `dependabot-claude-review:v1:pr=123:sha=${HEAD_SHA}:run=2:attempt=1`,
    },
    { externalId: "dependabot-claude-review:v1:malformed" },
    { detailsUrl: `https://github.com/${REPOSITORY}/runs/2` },
    {
      detailsUrl: `https://github.com/${REPOSITORY}/runs/1`,
      id: 0,
    },
    { detailsUrl: `https://github.com/${REPOSITORY}/actions/runs/1/job/2` },
    { sourceRepository: "attacker/fork" },
    { workflowEvent: "pull_request_target" },
  ]) {
    const checks = completeChecks();
    const index = checks.findIndex(({ name }) => name === "claude-review");
    checks[index] = { ...checks[index], ...mutation };
    const result = evaluateDependabotChecks({
      checks,
      headSha: HEAD_SHA,
      pullRequestNumber: 123,
      repository: REPOSITORY,
    });
    assert.equal(
      result.policy.find(({ id }) => id === "claude-review").state,
      "failing",
      JSON.stringify(mutation),
    );
  }
});

test("accepts a live-shaped Vercel status only from the exact trusted Actions run and creator", () => {
  const checks = completeChecks();
  const index = checks.findIndex(({ name }) => name === "Vercel Preview");
  checks[index] = {
    ...checks[index],
    appId: 0,
    creatorLogin: "github-actions[bot]",
    description: "Preview disabled for Dependabot PR",
    detailsUrl: `https://github.com/${REPOSITORY}/actions/runs/31421269407`,
    id: 51_972_724_561,
    kind: "status",
    runHeadSha: HEAD_SHA,
    runId: 31_421_269_407,
    runDisplayTitle: `Vercel preview intake | pr=123 | sha=${HEAD_SHA} | action=edited`,
    workflowEvent: "pull_request_target",
    workflowPath: ".github/workflows/vercel-preview-intake.yml",
  };
  const result = evaluateDependabotChecks({
    checks,
    headSha: HEAD_SHA,
    pullRequestNumber: 123,
    repository: REPOSITORY,
  });
  assert.equal(
    result.policy.find(({ id }) => id === "vercel-preview").state,
    "passing",
  );

  for (const mutation of [
    { creatorLogin: "vercel[bot]" },
    { description: "Preview event durably recorded" },
    {
      detailsUrl: "https://appmento-rk7mrub6v-mentolabs.vercel.app/",
    },
    {
      runDisplayTitle: `Vercel preview intake | pr=999 | sha=${HEAD_SHA} | action=edited`,
    },
    {
      runDisplayTitle: `Vercel preview intake | pr=123 | sha=${OTHER_SHA} | action=edited`,
    },
  ]) {
    const rejectedChecks = [...checks];
    rejectedChecks[index] = { ...checks[index], ...mutation };
    const rejected = evaluateDependabotChecks({
      checks: rejectedChecks,
      headSha: HEAD_SHA,
      pullRequestNumber: 123,
      repository: REPOSITORY,
    });
    assert.equal(
      rejected.policy.find(({ id }) => id === "vercel-preview").state,
      "failing",
      JSON.stringify(mutation),
    );
  }
});

test("Vercel status selection follows status publication chronology and rejects provider URLs", () => {
  const checks = completeChecks().filter(
    ({ name }) => name !== "Vercel Preview",
  );
  checks.push(
    check("Vercel Preview", "success", {
      completedAt: "2026-08-10T09:00:00Z",
      id: 200,
    }),
    check("Vercel Preview", "failure", {
      completedAt: "2026-08-10T10:00:00Z",
      id: 100,
    }),
  );
  const chronological = evaluateDependabotChecks({
    baselineChecks: completeBaselineChecks(),
    baselineSha: BASE_SHA,
    checks,
    headSha: HEAD_SHA,
    pullRequestNumber: 123,
    repository: REPOSITORY,
  });
  const preview = chronological.policy.find(
    ({ id }) => id === "vercel-preview",
  );
  assert.equal(preview.check.id, 100);
  assert.equal(preview.state, "failing");

  const providerChecks = completeChecks();
  const providerIndex = providerChecks.findIndex(
    ({ name }) => name === "Vercel Preview",
  );
  providerChecks[providerIndex] = {
    ...providerChecks[providerIndex],
    detailsUrl: "https://frontend-abcdef.vercel.app",
  };
  const provider = evaluateDependabotChecks({
    checks: providerChecks,
    headSha: HEAD_SHA,
    pullRequestNumber: 123,
    repository: REPOSITORY,
  });
  assert.equal(
    provider.policy.find(({ id }) => id === "vercel-preview").state,
    "failing",
  );
});

test("attributes an exact provider baseline failure separately from a branch failure", () => {
  const checks = completeChecks({
    conclusions: {
      "supply-chain-root-osv": "failure",
      "supply-chain-version-skew": "failure",
    },
  });
  const baselineChecks = completeBaselineChecks({
    conclusions: { "supply-chain-root-osv": "failure" },
  });
  const result = evaluateDependabotChecks({
    baselineChecks,
    baselineSha: BASE_SHA,
    checks,
    headSha: HEAD_SHA,
    pullRequestNumber: 123,
    repository: REPOSITORY,
  });
  assert.deepEqual(result.failures, [
    {
      attribution: "provider-baseline",
      findings: [],
      id: "supply-chain-root-osv",
      name: "osv-scanner / osv-scan",
      reason: "failing",
    },
    {
      attribution: "branch",
      findings: [],
      id: "supply-chain-version-skew",
      name: "catalog version-skew",
      reason: "failing",
    },
  ]);
});

test("provider-only failures remain retry-only with or without a main-context baseline", () => {
  for (const mode of ["assist", "prepare"]) {
    for (const checkId of EXTERNAL_CHECK_IDS) {
      const result = evaluateDependabotPullRequest(
        snapshot({
          checks: completeChecks({ conclusions: { [checkId]: "failure" } }),
        }),
        { mode, repository: REPOSITORY },
      );
      assert.equal(result.disposition, "waiting-retry", `${mode}:${checkId}`);
      assert.equal(result.repairPacket, null, `${mode}:${checkId}`);
      assert.equal(
        result.checks.failures.find(({ id }) => id === checkId)?.attribution,
        MAIN_BASELINE_EVENTS[checkId]
          ? "non-deterministic"
          : "provider-unbaselined",
        `${mode}:${checkId}`,
      );
    }
  }
});

test("prepare mode scopes mixed provider and deterministic failures to the deterministic repair", () => {
  const mixed = evaluateDependabotPullRequest(
    snapshot({
      checks: completeChecks({
        conclusions: { ci: "failure", "vercel-preview": "failure" },
      }),
    }),
    {
      mode: "prepare",
      repository: REPOSITORY,
      workflowContext: WORKFLOW_CONTEXT,
    },
  );
  assert.equal(mixed.disposition, "repair-required");
  assert.deepEqual(
    mixed.checks.failures.map(({ attribution, id }) => ({ attribution, id })),
    [
      { attribution: "branch", id: "ci" },
      { attribution: "provider-unbaselined", id: "vercel-preview" },
    ],
  );
  assert.deepEqual(
    mixed.repairPacket.failures.map(({ attribution, id }) => ({
      attribution,
      id,
    })),
    [{ attribution: "branch", id: "ci" }],
  );

  const assist = evaluateDependabotPullRequest(
    snapshot({
      checks: completeChecks({
        conclusions: { ci: "failure", "vercel-preview": "failure" },
      }),
    }),
    { mode: "assist", repository: REPOSITORY },
  );
  assert.equal(assist.disposition, "waiting-retry");
  assert.equal(assist.repairPacket, null);

  const deterministicOnly = evaluateDependabotPullRequest(
    snapshot({
      checks: completeChecks({ conclusions: { ci: "failure" } }),
    }),
    {
      mode: "prepare",
      repository: REPOSITORY,
      workflowContext: WORKFLOW_CONTEXT,
    },
  );
  assert.equal(deterministicOnly.disposition, "repair-required");
  assert.deepEqual(
    deterministicOnly.repairPacket.failures.map(({ id }) => id),
    ["ci"],
  );
});

test("prepare mode can repair a branch failure beside trusted provider evidence without a baseline", () => {
  const baselineChecks = completeBaselineChecks();
  const current = snapshot({
    baseline: { checks: baselineChecks, sha: BASE_SHA },
    checks: completeChecks({
      conclusions: { ci: "failure", "vercel-preview": "failure" },
    }),
  });
  const prepared = evaluateDependabotPullRequest(current, {
    mode: "prepare",
    repository: REPOSITORY,
    workflowContext: WORKFLOW_CONTEXT,
  });

  assert.equal(prepared.disposition, "repair-required");
  assert.deepEqual(
    prepared.checks.failures.map(({ attribution, id }) => ({
      attribution,
      id,
    })),
    [
      { attribution: "branch", id: "ci" },
      { attribution: "provider-unbaselined", id: "vercel-preview" },
    ],
  );
  assert.deepEqual(
    prepared.repairPacket.failures.map(({ attribution, id }) => ({
      attribution,
      id,
    })),
    [{ attribution: "branch", id: "ci" }],
  );

  const assisted = evaluateDependabotPullRequest(current, {
    mode: "assist",
    repository: REPOSITORY,
  });
  assert.equal(assisted.disposition, "waiting-retry");
  assert.equal(assisted.repairPacket, null);

  const providerOnly = evaluateDependabotPullRequest(
    snapshot({
      baseline: { checks: baselineChecks, sha: BASE_SHA },
      checks: completeChecks({
        conclusions: { "vercel-preview": "failure" },
      }),
    }),
    {
      mode: "prepare",
      repository: REPOSITORY,
      workflowContext: WORKFLOW_CONTEXT,
    },
  );
  assert.equal(providerOnly.disposition, "waiting-retry");
  assert.equal(providerOnly.repairPacket, null);
});

test("malformed provider provenance blocks a concurrent deterministic repair", () => {
  for (const malformedSide of ["current", "baseline"]) {
    const baselineChecks = completeBaselineChecks();
    const checks = completeChecks({
      conclusions: { ci: "failure", "e2e-celo": "failure" },
    });
    const targetChecks = malformedSide === "current" ? checks : baselineChecks;
    const providerIndex = targetChecks.findIndex(
      ({ name }) => name === CHECK_NAMES["e2e-celo"],
    );
    targetChecks[providerIndex] = {
      ...targetChecks[providerIndex],
      appId: 9,
    };
    const result = evaluateDependabotPullRequest(
      snapshot({
        baseline: { checks: baselineChecks, sha: BASE_SHA },
        checks,
      }),
      {
        mode: "prepare",
        repository: REPOSITORY,
        workflowContext: WORKFLOW_CONTEXT,
      },
    );

    assert.equal(result.disposition, "waiting-retry", malformedSide);
    assert.equal(result.repairPacket, null, malformedSide);
    assert.equal(
      result.checks.failures.find(({ id }) => id === "e2e-celo")?.attribution,
      "unknown",
      malformedSide,
    );
  }
});

test("main supply-chain push leaves provider failures unbaselined", () => {
  const providerIds = new Set([
    "supply-chain-root-osv",
    "supply-chain-pnpm-runtime-osv",
    "supply-chain-vercel-runtime-osv",
    "supply-chain-pnpm-bootstrap-osv",
  ]);
  const baselineChecks = completeBaselineChecks().filter((candidate) => {
    const id = Object.entries(CHECK_NAMES).find(
      ([, name]) => name === candidate.name,
    )?.[0];
    return !providerIds.has(id);
  });
  const result = evaluateDependabotPullRequest(
    snapshot({
      baseline: { checks: baselineChecks, sha: BASE_SHA },
      checks: completeChecks({
        conclusions: {
          "supply-chain-root-osv": "failure",
          "supply-chain-version-skew": "failure",
        },
      }),
    }),
    {
      mode: "prepare",
      repository: REPOSITORY,
      workflowContext: WORKFLOW_CONTEXT,
    },
  );

  assert.equal(result.disposition, "repair-required");
  assert.deepEqual(
    result.checks.failures.map(({ attribution, id }) => ({ attribution, id })),
    [
      {
        attribution: "provider-unbaselined",
        id: "supply-chain-root-osv",
      },
      {
        attribution: "branch",
        id: "supply-chain-version-skew",
      },
    ],
  );
  assert.deepEqual(
    result.repairPacket.failures.map(({ id }) => id),
    ["supply-chain-version-skew"],
  );
});

test("a trusted skipped main provider check remains unbaselined", () => {
  const baselineChecks = completeBaselineChecks().map((candidate) => {
    const supplyChainCheck = candidate.name.startsWith("osv-scanner");
    if (!supplyChainCheck) return candidate;
    return {
      ...candidate,
      conclusion: "skipped",
      runHeadBranch: "main",
      runHeadSha: BASE_SHA,
      workflowEvent: "push",
    };
  });
  const result = evaluateDependabotPullRequest(
    snapshot({
      baseline: { checks: baselineChecks, sha: BASE_SHA },
      checks: completeChecks({
        conclusions: {
          "supply-chain-root-osv": "failure",
          "supply-chain-version-skew": "failure",
        },
      }),
    }),
    {
      mode: "prepare",
      repository: REPOSITORY,
      workflowContext: WORKFLOW_CONTEXT,
    },
  );

  assert.equal(result.disposition, "repair-required");
  assert.equal(
    result.checks.failures.find(({ id }) => id === "supply-chain-root-osv")
      ?.attribution,
    "provider-unbaselined",
  );
  assert.deepEqual(
    result.repairPacket.failures.map(({ id }) => id),
    ["supply-chain-version-skew"],
  );
});

test("exact-main push evidence attributes deterministic supply-chain failures", () => {
  for (const checkId of [
    "supply-chain-lockfile",
    "supply-chain-version-skew",
  ]) {
    const baselineWithConclusion = (conclusion, source = {}) =>
      completeBaselineChecks().map((candidate) =>
        candidate.name === CHECK_NAMES[checkId]
          ? {
              ...candidate,
              conclusion,
              runHeadBranch: "main",
              runHeadSha: BASE_SHA,
              workflowEvent: "push",
              ...source,
            }
          : candidate,
      );
    const evaluate = (baselineChecks) =>
      evaluateDependabotPullRequest(
        snapshot({
          baseline: { checks: baselineChecks, sha: BASE_SHA },
          checks: completeChecks({ conclusions: { [checkId]: "failure" } }),
        }),
        {
          mode: "prepare",
          repository: REPOSITORY,
          workflowContext: WORKFLOW_CONTEXT,
        },
      );

    const branch = evaluate(baselineWithConclusion("success"));
    assert.equal(branch.disposition, "repair-required", checkId);
    assert.equal(branch.checks.failures[0].attribution, "branch", checkId);

    const baseline = evaluate(baselineWithConclusion("failure"));
    assert.equal(baseline.disposition, "waiting-baseline", checkId);
    assert.equal(baseline.checks.failures[0].attribution, "baseline", checkId);

    for (const source of [
      { runHeadBranch: "release" },
      { runHeadSha: OTHER_SHA },
    ]) {
      const untrusted = evaluate(baselineWithConclusion("success", source));
      assert.equal(untrusted.disposition, "waiting-retry", checkId);
      assert.equal(untrusted.repairPacket, null, checkId);
      assert.equal(
        untrusted.checks.failures[0].attribution,
        "unknown",
        checkId,
      );
    }
  }
});

test("manual provider baselines require exact main workflow provenance", () => {
  const baselineWithSource = (source = {}) =>
    completeBaselineChecks({
      conclusions: { "e2e-celo": "failure" },
    }).map((candidate) =>
      candidate.name === CHECK_NAMES["e2e-celo"]
        ? { ...candidate, ...source }
        : candidate,
    );
  const evaluate = (baselineChecks) =>
    evaluateDependabotPullRequest(
      snapshot({
        baseline: { checks: baselineChecks, sha: BASE_SHA },
        checks: completeChecks({
          conclusions: {
            "e2e-celo": "failure",
            "supply-chain-version-skew": "failure",
          },
        }),
      }),
      {
        mode: "prepare",
        repository: REPOSITORY,
        workflowContext: WORKFLOW_CONTEXT,
      },
    );

  const trusted = evaluate(baselineWithSource());
  assert.equal(trusted.disposition, "repair-required");
  assert.deepEqual(
    trusted.checks.failures.map(({ attribution, id }) => ({ attribution, id })),
    [
      { attribution: "branch", id: "supply-chain-version-skew" },
      { attribution: "provider-baseline", id: "e2e-celo" },
    ],
  );
  assert.deepEqual(
    trusted.repairPacket.failures.map(({ id }) => id),
    ["supply-chain-version-skew"],
  );

  for (const [label, source] of [
    ["branch", { runHeadBranch: "release" }],
    ["sha", { runHeadSha: OTHER_SHA }],
    ["event", { workflowEvent: "pull_request" }],
    ["workflow", { workflowPath: ".github/workflows/ci.yml" }],
    ["app", { appId: 9 }],
    ["run identity", { runId: 0 }],
    [
      "run URL",
      { detailsUrl: `https://github.com/${REPOSITORY}/actions/runs/999` },
    ],
  ]) {
    const rejected = evaluate(baselineWithSource(source));
    assert.equal(rejected.disposition, "waiting-retry", label);
    assert.equal(rejected.repairPacket, null, label);
    assert.equal(
      rejected.checks.failures.find(({ id }) => id === "e2e-celo")?.attribution,
      "unknown",
      label,
    );
    assert.equal(
      rejected.checks.failures.find(
        ({ id }) => id === "supply-chain-version-skew",
      )?.attribution,
      "branch",
      label,
    );
  }
});

test("non-repairable conclusions cannot authorize deterministic repair", () => {
  for (const testCase of [
    { conclusion: "skipped", id: "e2e-celo" },
    { conclusion: "neutral", id: "e2e-celo" },
    { conclusion: "cancelled", id: "supply-chain-version-skew" },
    { conclusion: "neutral", id: "supply-chain-version-skew" },
    { conclusion: "startup_failure", id: "ci" },
    { conclusion: "timed_out", id: "ci" },
  ]) {
    const result = evaluateDependabotPullRequest(
      snapshot({
        checks: completeChecks({
          conclusions: { ci: "failure", [testCase.id]: testCase.conclusion },
        }),
      }),
      {
        mode: "prepare",
        repository: REPOSITORY,
        workflowContext: WORKFLOW_CONTEXT,
      },
    );

    assert.equal(
      result.disposition,
      "waiting-retry",
      `${testCase.id}:${testCase.conclusion}`,
    );
    assert.equal(result.repairPacket, null);
    assert.equal(
      result.checks.failures.find(({ id }) => id === testCase.id)?.attribution,
      "unknown",
    );
  }
});

test("retryable provider outcomes can coexist with a separate deterministic repair", () => {
  for (const testCase of [
    { conclusion: "error", id: "vercel-preview" },
    { conclusion: "startup_failure", id: "e2e-celo" },
    { conclusion: "timed_out", id: "e2e-celo" },
  ]) {
    const result = evaluateDependabotPullRequest(
      snapshot({
        checks: completeChecks({
          conclusions: { ci: "failure", [testCase.id]: testCase.conclusion },
        }),
      }),
      {
        mode: "prepare",
        repository: REPOSITORY,
        workflowContext: WORKFLOW_CONTEXT,
      },
    );

    assert.equal(result.disposition, "repair-required", testCase.conclusion);
    assert.equal(
      result.checks.failures.find(({ id }) => id === testCase.id)?.attribution,
      MAIN_BASELINE_EVENTS[testCase.id]
        ? "non-deterministic"
        : "provider-unbaselined",
      testCase.conclusion,
    );
    assert.deepEqual(
      result.repairPacket.failures.map(({ id }) => id),
      ["ci"],
      testCase.conclusion,
    );
  }
});

test("non-proof baseline outcomes remain unknown", () => {
  for (const testCase of [
    { baselineConclusion: "neutral", baselineStatus: "completed" },
    { baselineConclusion: "cancelled", baselineStatus: "completed" },
  ]) {
    const baselineChecks = completeBaselineChecks();
    const providerIndex = baselineChecks.findIndex(
      ({ name }) => name === CHECK_NAMES["e2e-celo"],
    );
    baselineChecks[providerIndex] = {
      ...baselineChecks[providerIndex],
      conclusion: testCase.baselineConclusion,
      status: testCase.baselineStatus,
    };
    const result = evaluateDependabotPullRequest(
      snapshot({
        baseline: { checks: baselineChecks, sha: BASE_SHA },
        checks: completeChecks({
          conclusions: { ci: "failure", "e2e-celo": "failure" },
        }),
      }),
      {
        mode: "prepare",
        repository: REPOSITORY,
        workflowContext: WORKFLOW_CONTEXT,
      },
    );

    assert.equal(result.disposition, "waiting-retry");
    assert.equal(result.repairPacket, null);
    assert.equal(
      result.checks.failures.find(({ id }) => id === "e2e-celo")?.attribution,
      "unknown",
    );
  }

  for (const conclusion of ["startup_failure", "timed_out"]) {
    const baselineChecks = completeBaselineChecks().map((candidate) =>
      candidate.name === CHECK_NAMES.ci
        ? { ...candidate, conclusion }
        : candidate,
    );
    const result = evaluateDependabotPullRequest(
      snapshot({
        baseline: { checks: baselineChecks, sha: BASE_SHA },
        checks: completeChecks({ conclusions: { ci: "failure" } }),
      }),
      {
        mode: "prepare",
        repository: REPOSITORY,
        workflowContext: WORKFLOW_CONTEXT,
      },
    );
    assert.equal(result.disposition, "waiting-retry", conclusion);
    assert.equal(result.repairPacket, null, conclusion);
    assert.equal(
      result.checks.failures.find(({ id }) => id === "ci")?.attribution,
      "unknown",
      conclusion,
    );
  }
});

test("a trusted pending provider baseline can coexist with a deterministic repair", () => {
  const baselineChecks = completeBaselineChecks();
  const providerIndex = baselineChecks.findIndex(
    ({ name }) => name === CHECK_NAMES["e2e-celo"],
  );
  baselineChecks[providerIndex] = {
    ...baselineChecks[providerIndex],
    conclusion: null,
    status: "in_progress",
  };
  const result = evaluateDependabotPullRequest(
    snapshot({
      baseline: { checks: baselineChecks, sha: BASE_SHA },
      checks: completeChecks({
        conclusions: { ci: "failure", "e2e-celo": "failure" },
      }),
    }),
    {
      mode: "prepare",
      repository: REPOSITORY,
      workflowContext: WORKFLOW_CONTEXT,
    },
  );

  assert.equal(result.disposition, "repair-required");
  assert.equal(
    result.checks.failures.find(({ id }) => id === "e2e-celo")?.attribution,
    "provider-unbaselined",
  );
  assert.deepEqual(
    result.repairPacket.failures.map(({ id }) => id),
    ["ci"],
  );
});

test("a push check cannot authorize a current Dependabot head failure", () => {
  const checks = completeChecks({
    conclusions: { ci: "failure", "supply-chain-version-skew": "failure" },
  });
  const skewIndex = checks.findIndex(
    ({ name }) => name === CHECK_NAMES["supply-chain-version-skew"],
  );
  checks[skewIndex] = {
    ...checks[skewIndex],
    runHeadBranch: "main",
    runHeadSha: HEAD_SHA,
    workflowEvent: "push",
  };
  const result = evaluateDependabotPullRequest(snapshot({ checks }), {
    mode: "prepare",
    repository: REPOSITORY,
    workflowContext: WORKFLOW_CONTEXT,
  });

  assert.equal(result.disposition, "waiting-retry");
  assert.equal(result.repairPacket, null);
  assert.equal(
    result.checks.failures.find(({ id }) => id === "supply-chain-version-skew")
      ?.attribution,
    "unknown",
  );
});

test("a baseline failure blocks a separate deterministic branch repair", () => {
  const result = evaluateDependabotPullRequest(
    snapshot({
      baseline: {
        checks: completeBaselineChecks({
          conclusions: { "supply-chain-lockfile": "failure" },
        }),
        sha: BASE_SHA,
      },
      checks: completeChecks({
        conclusions: {
          ci: "failure",
          "supply-chain-lockfile": "failure",
        },
      }),
    }),
    {
      mode: "prepare",
      repository: REPOSITORY,
      workflowContext: WORKFLOW_CONTEXT,
    },
  );

  assert.equal(result.disposition, "waiting-baseline");
  assert.equal(result.repairPacket, null);
});

test("an unknown failure still suppresses a mixed deterministic repair packet", () => {
  const baselineChecks = completeBaselineChecks().filter(
    ({ name }) => name !== CHECK_NAMES.ci,
  );
  const result = evaluateDependabotPullRequest(
    snapshot({
      baseline: {
        checks: baselineChecks,
        sha: BASE_SHA,
      },
      checks: completeChecks({
        conclusions: { ci: "failure", "supply-chain-version-skew": "failure" },
      }),
    }),
    {
      mode: "prepare",
      repository: REPOSITORY,
      workflowContext: WORKFLOW_CONTEXT,
    },
  );

  assert.equal(result.disposition, "waiting-retry");
  assert.equal(result.repairPacket, null);
  assert.equal(
    result.checks.failures.find(({ id }) => id === "ci")?.attribution,
    "unknown",
  );
  assert.equal(
    result.checks.failures.find(({ id }) => id === "supply-chain-version-skew")
      ?.attribution,
    "branch",
  );
});

test("trusted exact-head Claude findings are direct branch evidence without a main baseline check", () => {
  const checks = completeChecks({
    conclusions: { "claude-review": "failure" },
  });
  const claudeIndex = checks.findIndex(
    ({ name }) => name === CHECK_NAMES["claude-review"],
  );
  checks[claudeIndex] = {
    ...checks[claudeIndex],
    outputText: stableJson({
      findings: [
        {
          line: 12,
          path: "package.json",
          summary: "The updated dependency range conflicts with its override.",
          title: "Align the dependency override",
        },
      ],
      headSha: HEAD_SHA,
      pullRequestNumber: 123,
      repository: REPOSITORY,
      reviewCompleted: true,
      schema: "dependabot-claude-review-result:v1",
      verdict: "findings",
    }),
  };
  const baselineChecks = completeBaselineChecks();
  const result = evaluateDependabotPullRequest(
    snapshot({
      baseline: {
        checks: [...baselineChecks, postMergeReceipt(BASE_SHA)],
        sha: BASE_SHA,
      },
      checks,
      metadata: {
        dependencyNames: ["next"],
        immutableEvidence: { valid: true },
        packageEcosystem: "npm",
        updateType: "patch",
      },
    }),
    {
      mode: "prepare",
      repository: REPOSITORY,
      workflowContext: WORKFLOW_CONTEXT,
    },
  );

  const failure = result.checks.failures.find(
    ({ id }) => id === "claude-review",
  );
  assert.equal(failure.attribution, "branch");
  assert.equal(failure.findings.length, 1);
  assert.equal(result.disposition, "repair-required");
  assert.equal(result.repairPacket.findings.length, 1);
  assert.equal(result.repairPacket.findings[0].path, "package.json");
});

test("non-failure Claude findings cannot authorize a branch repair", () => {
  const checks = completeChecksWithClaudeFindings({
    findings: [
      {
        line: 12,
        path: "package.json",
        summary: "The updated dependency range conflicts with its override.",
        title: "Align the dependency override",
      },
    ],
  });
  const claudeIndex = checks.findIndex(
    ({ name }) => name === CHECK_NAMES["claude-review"],
  );
  checks[claudeIndex] = { ...checks[claudeIndex], conclusion: "timed_out" };
  const result = evaluateDependabotPullRequest(snapshot({ checks }), {
    mode: "prepare",
    repository: REPOSITORY,
    workflowContext: WORKFLOW_CONTEXT,
  });

  assert.equal(result.disposition, "waiting-retry");
  assert.equal(result.repairPacket, null);
  assert.equal(
    result.checks.failures.find(({ id }) => id === "claude-review")
      ?.attribution,
    "unknown",
  );
});

test("identity or feedback failure suppresses repair packets and publishes packet=false receipts", async () => {
  const failingChecks = completeChecks({ conclusions: { ci: "failure" } });
  const invalidIdentity = snapshot({ checks: failingChecks });
  invalidIdentity.pullRequest.author = { login: "alice" };
  const cases = [
    invalidIdentity,
    snapshot({
      checks: failingChecks,
      feedback: {
        maintainerVeto: true,
        reviewDecision: "APPROVED",
        unresolvedThreads: 0,
      },
    }),
  ];
  for (const pullRequest of cases) {
    const evaluated = evaluateDependabotPullRequest(pullRequest, {
      mode: "prepare",
      repository: REPOSITORY,
      workflowContext: WORKFLOW_CONTEXT,
    });
    assert.equal(createDependabotRepairPacket(evaluated), null);
    assert.equal(evaluated.repairPacket, null);

    const published = [];
    await processDependabotSweep({
      adapter: {
        collectPullRequestSnapshot: async () => pullRequest,
        getOutstandingDependabotAutoMergeRequests: async () => [],
        getOutstandingDependabotProcessorApprovals:
          noOutstandingProcessorApprovals,
        publishProcessorCheck: async (receipt) => published.push(receipt),
      },
      input: {
        mode: "prepare",
        pullRequests: [pullRequest],
        repository: REPOSITORY,
        workflowContext: WORKFLOW_CONTEXT,
      },
      publishChecks: true,
      workflowContext: WORKFLOW_CONTEXT,
    });
    assert.equal(published.length, 1);
    assert.equal(published[0].repairPacket, null);
  }
});

test("processor check publication preserves each fail-closed disposition", async () => {
  const pending = snapshot({ checks: completeChecks().slice(0, -1) });
  const failing = snapshot({
    checks: completeChecks({ conclusions: { ci: "failure" } }),
  });
  const staleBase = snapshot();
  staleBase.baseAncestry = {
    ...staleBase.baseAncestry,
    behindBy: 1,
    currentBaseIsAncestor: false,
    status: "diverged",
  };
  const manual = snapshot({
    metadata: {
      dependencyNames: ["next"],
      immutableEvidence: { valid: true },
      packageEcosystem: "npm",
      updateType: "patch",
    },
  });
  const vetoed = snapshot({ feedback: { maintainerVeto: true } });
  const retry = snapshot({
    checks: completeChecks({
      conclusions: { "vercel-preview": "failure" },
    }),
  });
  const baselineFailure = snapshot({
    baseline: {
      checks: [
        ...completeBaselineChecks({
          conclusions: { ci: "failure" },
        }),
        postMergeReceipt(BASE_SHA),
      ],
      sha: BASE_SHA,
    },
    checks: completeChecks({ conclusions: { ci: "failure" } }),
  });
  const cases = [
    {
      expected: "ready-for-human-review",
      snapshot: snapshot(),
    },
    { expected: "waiting-checks", snapshot: pending },
    { expected: "repair-required", snapshot: failing },
    {
      expected: "waiting-base-update",
      snapshot: staleBase,
    },
    { expected: "manual-review", snapshot: manual },
    {
      expected: "manual-veto-or-feedback",
      snapshot: vetoed,
    },
    { expected: "waiting-retry", snapshot: retry },
    {
      expected: "waiting-baseline",
      snapshot: baselineFailure,
    },
  ];

  for (const testCase of cases) {
    const published = [];
    const result = await processDependabotSweep({
      adapter: {
        collectPullRequestSnapshot: async () => testCase.snapshot,
        getOutstandingDependabotAutoMergeRequests: async () => [],
        getOutstandingDependabotProcessorApprovals:
          noOutstandingProcessorApprovals,
        publishProcessorCheck: async (receipt) => published.push(receipt),
      },
      input: {
        mode: "assist",
        outstandingAutoMergeRequests: [],
        pullRequests: [testCase.snapshot],
        repository: REPOSITORY,
        workflowContext: WORKFLOW_CONTEXT,
      },
      publishChecks: true,
      workflowContext: WORKFLOW_CONTEXT,
    });
    assert.equal(result.evaluations[0].disposition, testCase.expected);
    assert.equal(published.length, 1);
    assert.equal(published[0].disposition, testCase.expected);
    assert.equal(published[0].repairPacket, null);
  }
});

test("manual-review processor checks explain the deterministic next action without a packet", async () => {
  const current = snapshot({
    metadata: {
      dependencyNames: ["google/osv-scanner-action"],
      immutableEvidence: { valid: true },
      packageEcosystem: "github-actions",
      updateType: "minor",
    },
    pullRequest: {
      files: [
        {
          ...PACKAGE_BLOB,
          filename: ".github/workflows/_osv-scanner-readonly.yml",
        },
      ],
    },
  });
  const published = [];
  const result = await processDependabotSweep({
    adapter: {
      collectPullRequestSnapshot: async () => current,
      getOutstandingDependabotAutoMergeRequests: async () => [],
      getOutstandingDependabotProcessorApprovals:
        noOutstandingProcessorApprovals,
      publishProcessorCheck: async (input) => published.push(input),
    },
    input: {
      mode: "prepare",
      outstandingAutoMergeRequests: [],
      pullRequests: [current],
      repository: REPOSITORY,
      workflowContext: WORKFLOW_CONTEXT,
    },
    publishChecks: true,
    workflowContext: WORKFLOW_CONTEXT,
  });

  assert.equal(result.evaluations[0].disposition, "manual-review");
  assert.equal(
    result.evaluations[0].risk.reason,
    "sensitive-auth-deployment-or-workflow-policy-action",
  );
  assert.equal(published.length, 1);
  assert.equal(published[0].repairPacket, null);
  assert.equal(
    published[0].summary,
    "Disposition: manual-review. Reason: sensitive-auth-deployment-or-workflow-policy-action. Next action: have a maintainer agent merge the current base into the branch without rebasing or force-pushing, resolve conflicts, fix valid findings, validate, push, reply to every review comment, and resolve eligible threads, then report the exact final head and stop; do not dismiss a review, submit a review approval, create a processor approval, publish or claim Dependabot ALL CLEAR, enable auto-merge, or merge.",
  );
  assert.equal(published[0].summary.length, 506);

  const receipt = processorRepairReceipt(1, {
    mode: "prepare",
    packet: false,
  });
  receipt.outputSummary = published[0].summary;
  assert.equal(receipt.outputText, null);
  assert.notEqual(parseDependabotProcessorReceipt(receipt, REPOSITORY), null);
});

test("unchanged trusted Processor receipts suppress check churn without hiding drift", async () => {
  const matchingReceipt = processorRepairReceipt(1, {
    id: 62_001,
    mode: "observe",
    packet: false,
  });
  matchingReceipt.outputSummary = "Disposition: eligible-observed";

  const run = async (current, mode = "observe") => {
    const published = [];
    await processDependabotSweep({
      adapter: {
        collectPullRequestSnapshot: async () => structuredClone(current),
        getOutstandingDependabotAutoMergeRequests: async () => [],
        getOutstandingDependabotProcessorApprovals:
          noOutstandingProcessorApprovals,
        publishProcessorCheck: async (input) => {
          published.push(input);
          return { id: 62_100 + published.length };
        },
      },
      input: {
        mode,
        outstandingAutoMergeRequests: [],
        pullRequests: [structuredClone(current)],
        repository: REPOSITORY,
        workflowContext: WORKFLOW_CONTEXT,
      },
      phase: "finalize",
      publishChecks: true,
      workflowContext: WORKFLOW_CONTEXT,
    });
    return published;
  };

  const unchanged = snapshot();
  unchanged.checks.push(matchingReceipt);
  assert.deepEqual(await run(unchanged), []);

  const changedDisposition = snapshot({
    feedback: { maintainerVeto: true },
  });
  changedDisposition.checks.push(matchingReceipt);
  const changedPublication = await run(changedDisposition);
  assert.equal(changedPublication.length, 1);
  assert.equal(changedPublication[0].disposition, "manual-veto-or-feedback");

  const newerMalformed = snapshot();
  newerMalformed.checks.push(matchingReceipt, {
    ...matchingReceipt,
    id: 62_002,
    runId: 0,
  });
  const malformedPublication = await run(newerMalformed);
  assert.equal(malformedPublication.length, 1);
  assert.equal(malformedPublication[0].disposition, "eligible-observed");

  const sensitiveMetadata = {
    dependencyNames: ["google/osv-scanner-action"],
    immutableEvidence: { valid: true },
    packageEcosystem: "github-actions",
    updateType: "minor",
  };
  const actionableSummary =
    "Disposition: manual-review. Reason: sensitive-auth-deployment-or-workflow-policy-action. Next action: have a maintainer agent merge the current base into the branch without rebasing or force-pushing, resolve conflicts, fix valid findings, validate, push, reply to every review comment, and resolve eligible threads, then report the exact final head and stop; do not dismiss a review, submit a review approval, create a processor approval, publish or claim Dependabot ALL CLEAR, enable auto-merge, or merge.";
  const actionableReceipt = processorRepairReceipt(1, {
    id: 62_003,
    mode: "prepare",
    packet: false,
  });
  actionableReceipt.outputSummary = actionableSummary;
  const unchangedManual = snapshot({ metadata: sensitiveMetadata });
  unchangedManual.checks.push(actionableReceipt);
  assert.deepEqual(await run(unchangedManual, "prepare"), []);

  const legacyManualReceipt = {
    ...actionableReceipt,
    id: 62_004,
    outputSummary:
      "Disposition: manual-review. Reason: sensitive-auth-deployment-or-workflow-policy-action. Next action: take over manually; verify exact head/base, required checks, resolved feedback, current approval, and mergeability, then merge.",
  };
  const legacyManual = snapshot({ metadata: sensitiveMetadata });
  legacyManual.checks.push(legacyManualReceipt);
  const actionablePublication = await run(legacyManual, "prepare");
  assert.equal(actionablePublication.length, 1);
  assert.equal(actionablePublication[0].summary, actionableSummary);
});

test("deterministic lockfile and version-skew failures remain branch-repairable", () => {
  for (const checkId of [
    "supply-chain-lockfile",
    "supply-chain-version-skew",
  ]) {
    const result = evaluateDependabotPullRequest(
      snapshot({
        checks: completeChecks({ conclusions: { [checkId]: "failure" } }),
      }),
      {
        mode: "prepare",
        repository: REPOSITORY,
        workflowContext: WORKFLOW_CONTEXT,
      },
    );
    assert.equal(result.disposition, "repair-required", checkId);
    assert.equal(
      result.checks.failures.find(({ id }) => id === checkId)?.attribution,
      "branch",
      checkId,
    );
    assert.deepEqual(
      result.repairPacket.failures.map(({ id }) => id),
      [checkId],
      checkId,
    );
  }
});

test("version-skew repair packets retain exact npm companion blobs", () => {
  const expectedBlobs = [
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
  ].map((path) => ({
    mode: "100644",
    path,
    sha: createHash("sha1").update(path).digest("hex"),
    type: "blob",
  }));
  const expectedByPath = new Map(
    expectedBlobs.map((entry) => [entry.path, entry]),
  );
  const result = evaluateDependabotPullRequest(
    snapshot({
      checks: completeChecks({
        conclusions: { "supply-chain-version-skew": "failure" },
      }),
      expectedBlobs,
      metadata: {
        dependencies: [
          {
            from: "16.2.12",
            name: "next",
            to: "16.3.1",
            updateType: "minor",
          },
        ],
        dependencyNames: ["next"],
        immutableEvidence: { valid: true },
        packageEcosystem: "npm",
        updateType: "minor",
      },
      pullRequest: {
        files: ["pnpm-lock.yaml", "pnpm-workspace.yaml"].map((filename) => ({
          filename,
          mode: expectedByPath.get(filename).mode,
          sha: expectedByPath.get(filename).sha,
          status: "modified",
          type: expectedByPath.get(filename).type,
        })),
      },
    }),
    {
      mode: "prepare",
      repository: REPOSITORY,
      workflowContext: WORKFLOW_CONTEXT,
    },
  );

  assert.equal(result.disposition, "repair-required");
  assert.deepEqual(
    result.repairPacket.expectedBlobs.map(({ path }) => path),
    ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"],
  );
  assert.deepEqual(result.repairPacket.changedPaths, [
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
  ]);
});

test("verified npm updates are preparable even when the legacy automatic tier is false", () => {
  const pullRequest = snapshot({
    checks: completeChecks({ conclusions: { ci: "failure" } }),
    metadata: {
      dependencyNames: ["next"],
      immutableEvidence: { valid: true },
      packageEcosystem: "npm",
      updateType: "patch",
    },
  });
  const result = evaluateDependabotPullRequest(pullRequest, {
    mode: "prepare",
    repository: REPOSITORY,
    workflowContext: WORKFLOW_CONTEXT,
  });
  assert.equal(
    result.identity.valid,
    true,
    stableJson({
      identity: result.identity,
      repairAttempts: result.repairAttempts,
    }),
  );
  assert.equal(result.risk.autoApprovable, false);
  assert.equal(result.risk.preparable, true);
  assert.equal(result.disposition, "repair-required");
  assert.equal(result.repairPacket.automatic, true);
  assert.equal(result.repairPacket.requireHumanApproval, false);
  assert.deepEqual(
    result.repairPacket.failures.map(({ id }) => id),
    ["ci"],
  );
});

test("provider retry outcomes shared by the main baseline remain retry-only", () => {
  for (const conclusion of [
    "error",
    "failure",
    "startup_failure",
    "timed_out",
  ]) {
    const current = snapshot({
      baseline: {
        checks: [
          ...completeBaselineChecks({
            conclusions: { "e2e-celo": conclusion },
          }),
          postMergeReceipt(BASE_SHA),
        ],
        sha: BASE_SHA,
      },
      checks: completeChecks({ conclusions: { "e2e-celo": conclusion } }),
    });
    for (const mode of ["observe", "assist", "prepare"]) {
      const result = evaluateDependabotPullRequest(current, {
        mode,
        repository: REPOSITORY,
        workflowContext: WORKFLOW_CONTEXT,
      });
      assert.equal(
        result.disposition,
        "waiting-retry",
        `${mode}:${conclusion}`,
      );
      assert.equal(result.checks.state, "failing", `${mode}:${conclusion}`);
      assert.equal(result.repairPacket, null, `${mode}:${conclusion}`);
      assert.equal(
        result.checks.failures.find(({ id }) => id === "e2e-celo")?.attribution,
        "provider-baseline",
        `${mode}:${conclusion}`,
      );
    }
  }
});

test("live-shaped provider baseline failures stay outside a deterministic repair packet", () => {
  const current = snapshot({
    baseline: {
      checks: completeBaselineChecks({
        conclusions: {
          "e2e-celo": "failure",
          "e2e-monad": "failure",
        },
      }),
      sha: BASE_SHA,
    },
    checks: completeChecks({
      conclusions: {
        "e2e-celo": "failure",
        "e2e-monad": "failure",
        "supply-chain-version-skew": "failure",
      },
    }),
  });
  const prepared = evaluateDependabotPullRequest(current, {
    mode: "prepare",
    repository: REPOSITORY,
    workflowContext: WORKFLOW_CONTEXT,
  });

  assert.equal(prepared.disposition, "repair-required");
  assert.deepEqual(
    prepared.checks.failures.map(({ attribution, id }) => ({
      attribution,
      id,
    })),
    [
      { attribution: "branch", id: "supply-chain-version-skew" },
      { attribution: "provider-baseline", id: "e2e-celo" },
      { attribution: "provider-baseline", id: "e2e-monad" },
    ],
  );
  assert.deepEqual(
    prepared.repairPacket.failures.map(({ id }) => id),
    ["supply-chain-version-skew"],
  );

  const assisted = evaluateDependabotPullRequest(current, {
    mode: "assist",
    repository: REPOSITORY,
  });
  assert.equal(assisted.disposition, "waiting-retry");
  assert.equal(assisted.repairPacket, null);

  const providerOnly = evaluateDependabotPullRequest(
    snapshot({
      baseline: current.baseline,
      checks: completeChecks({
        conclusions: {
          "e2e-celo": "failure",
          "e2e-monad": "failure",
        },
      }),
    }),
    {
      mode: "prepare",
      repository: REPOSITORY,
      workflowContext: WORKFLOW_CONTEXT,
    },
  );
  assert.equal(providerOnly.disposition, "waiting-retry");
  assert.equal(providerOnly.checks.state, "failing");
  assert.equal(providerOnly.repairPacket, null);
});

test("missing or pending baseline evidence attributes a failure as unknown and emits no repair packet", () => {
  const completeBaseline = completeBaselineChecks();
  const pendingBaseline = completeBaseline.map((candidate) =>
    candidate.name === CHECK_NAMES.ci
      ? { ...candidate, conclusion: null, status: "in_progress" }
      : candidate,
  );
  for (const baselineChecks of [
    completeBaseline.filter(({ name }) => name !== CHECK_NAMES.ci),
    pendingBaseline,
  ]) {
    const result = evaluateDependabotPullRequest(
      snapshot({
        baseline: { checks: baselineChecks, sha: BASE_SHA },
        checks: completeChecks({ conclusions: { ci: "failure" } }),
      }),
      {
        mode: "assist",
        repository: REPOSITORY,
      },
    );
    assert.equal(result.disposition, "waiting-retry");
    assert.equal(
      result.checks.failures.find(({ id }) => id === "ci").attribution,
      "unknown",
    );
    assert.equal(result.repairPacket, null);
  }
});

test("missing or pending current-head gates take precedence over deterministic repair", () => {
  const failingChecks = completeChecks({ conclusions: { ci: "failure" } });
  const cases = [
    {
      expected: { missing: ["dependency-review"], pending: [] },
      snapshot: snapshot({
        checks: failingChecks.filter(
          ({ name }) => name !== CHECK_NAMES["dependency-review"],
        ),
      }),
    },
    {
      expected: { missing: [], pending: ["dependency-review"] },
      snapshot: snapshot({
        checks: failingChecks.map((candidate) =>
          candidate.name === CHECK_NAMES["dependency-review"]
            ? {
                ...candidate,
                conclusion: null,
                status: "in_progress",
              }
            : candidate,
        ),
      }),
    },
  ];

  for (const mode of ["assist", "prepare"]) {
    for (const testCase of cases) {
      const result = evaluateDependabotPullRequest(testCase.snapshot, {
        mode,
        repository: REPOSITORY,
        workflowContext: WORKFLOW_CONTEXT,
      });
      assert.equal(result.checks.failures[0].attribution, "branch", mode);
      assert.deepEqual(result.checks.missing, testCase.expected.missing, mode);
      assert.deepEqual(result.checks.pending, testCase.expected.pending, mode);
      assert.equal(result.disposition, "waiting-checks", mode);
      assert.equal(result.repairPacket, null, mode);
    }
  }
});

test("an unreplied-thread count fails feedback and packet gates even when reasons are malformed-empty", () => {
  const result = evaluateDependabotPullRequest(
    snapshot({
      checks: completeChecks({ conclusions: { ci: "failure" } }),
      feedback: {
        reasons: [],
        reviewDecision: "APPROVED",
        unresolvedThreads: 0,
        unrepliedThreads: 1,
      },
    }),
    { mode: "assist", repository: REPOSITORY },
  );
  assert.equal(result.feedback.clear, false);
  assert.equal(result.feedback.unrepliedThreads, 1);
  assert.deepEqual(result.feedback.reasons, ["unreplied-review-feedback"]);
  assert.equal(result.disposition, "manual-veto-or-feedback");
  assert.equal(result.repairPacket, null);
});

test("feedback gate blocks unresolved threads, requested changes, explicit vetoes, and veto labels", () => {
  const pullRequest = snapshot({
    pullRequest: { labels: ["do-not-merge"] },
  }).pullRequest;
  const feedback = evaluateFeedbackGate({
    feedback: {
      maintainerVeto: true,
      reviewDecision: "CHANGES_REQUESTED",
      unresolvedThreads: 2,
    },
    pullRequest,
  });
  assert.equal(feedback.clear, false);
  assert.deepEqual(feedback.reasons, [
    "unresolved-review-feedback",
    "changes-requested",
    "explicit-maintainer-veto",
    "veto-label-present",
  ]);

  for (const unrepliedThreads of [-1, 1.5, "invalid"]) {
    const malformed = evaluateFeedbackGate({
      feedback: { unrepliedThreads, unresolvedThreads: 0 },
      pullRequest: snapshot().pullRequest,
    });
    assert.equal(malformed.clear, false);
    assert.ok(
      malformed.reasons.includes("invalid-unreplied-thread-count"),
      String(unrepliedThreads),
    );
  }

  const forcePushed = evaluateFeedbackGate({
    feedback: {
      forcePushActors: Array.from(
        { length: 60 },
        (_, index) => `actor-${String(index).padStart(2, "0")}`,
      ),
      forcePushCommitIds: [OTHER_SHA, "malformed"],
      forcePushEventCount: 60,
      forcePushed: true,
    },
    pullRequest: snapshot().pullRequest,
  });
  assert.equal(forcePushed.clear, false);
  assert.equal(forcePushed.forcePushActors.length, 50);
  assert.deepEqual(forcePushed.forcePushCommitIds, [OTHER_SHA]);
  assert.equal(forcePushed.forcePushEventCount, 60);
  assert.deepEqual(forcePushed.reasons, ["pull-request-history-force-pushed"]);
});

test("feedback classifier binds Cursor summaries to actionable inline roots and requires resolution plus a direct maintainer reply", () => {
  const root = {
    actor: { association: "NONE", login: "cursor[bot]", type: "Bot" },
    body: "### Catalog bump defeated by override",
    createdAt: "2026-08-10T10:00:00Z",
    id: 11,
    replyToId: null,
    reviewCommitSha: HEAD_SHA,
    reviewId: 21,
  };
  const result = classifyDependabotFeedback({
    headSha: HEAD_SHA,
    reviews: [
      {
        actor: { association: "NONE", login: "cursor", type: "Bot" },
        body: "<!-- BUGBOT_REVIEW -->\nCursor Bugbot has reviewed your changes using high effort and found 1 potential issue.",
        commitSha: HEAD_SHA,
        id: 21,
        state: "COMMENTED",
      },
    ],
    threads: [
      {
        comments: [root],
        id: "thread-1",
        outdated: false,
        resolved: false,
      },
    ],
  });
  assert.deepEqual(result.reasons, [
    "unresolved-review-feedback",
    "unreplied-review-feedback",
  ]);
  assert.equal(result.actionableThreadCount, 1);
  assert.equal(result.blockerCount, 2);
  assert.equal(
    result.blockers.some(({ reason }) => reason.includes("cursor")),
    false,
  );
  assert.equal("body" in result.blockers[0], false);
  assert.match(result.blockers[0].bodyDigest, /^[0-9a-f]{64}$/);
});

test("feedback classifier recognizes only the exact Cursor Vercel runtime mismatch", () => {
  const exact = vercelRuntimeSyncCursorFeedback();
  assert.deepEqual(exact.actionableThreads[0].protectedRuntimeFinding, {
    fromVersion: "56.4.1",
    kind: "vercel-cli-runtime-sync",
    targetVersion: "56.5.0",
  });
  for (const feedback of [
    vercelRuntimeSyncCursorFeedback({ path: "pnpm-lock.yaml" }),
    vercelRuntimeSyncCursorFeedback({
      body: vercelRuntimeSyncCursorBody().replace(
        "protected deploy workflows keep the old CLI",
        "a different problem remains",
      ),
    }),
    vercelRuntimeSyncCursorFeedback({
      body: `${vercelRuntimeSyncCursorBody()}\n### Another actionable concern`,
    }),
    vercelRuntimeSyncCursorFeedback({
      body: vercelRuntimeSyncCursorBody({ reviewCommitSha: OTHER_SHA }),
    }),
  ]) {
    assert.equal(
      "protectedRuntimeFinding" in feedback.actionableThreads[0],
      false,
    );
  }
});

test("feedback classifier recognizes only the exact Cursor Next catalog mismatch", () => {
  const exact = nextCatalogSyncCursorFeedback();
  assert.deepEqual(exact.actionableThreads[0].protectedRuntimeFinding, {
    fromVersion: "16.2.12",
    kind: "next-catalog-override-sync",
    targetVersion: "16.3.1",
  });
  for (const feedback of [
    nextCatalogSyncCursorFeedback({ path: "package.json" }),
    nextCatalogSyncCursorFeedback({
      body: nextCatalogSyncCursorBody().replace(
        "merging ships no Next upgrade",
        "a different problem remains",
      ),
    }),
    nextCatalogSyncCursorFeedback({
      body: `${nextCatalogSyncCursorBody()}\n### Another actionable concern`,
    }),
    nextCatalogSyncCursorFeedback({
      body: nextCatalogSyncCursorBody({ reviewCommitSha: OTHER_SHA }),
    }),
  ]) {
    assert.equal(
      "protectedRuntimeFinding" in feedback.actionableThreads[0],
      false,
    );
  }
});

test("resolved current-head roots clear only with the exact repository reply formats", () => {
  const root = {
    actor: { association: "NONE", login: "cursor", type: "Bot" },
    body: "### Finding",
    createdAt: "2026-08-10T10:00:00Z",
    id: 11,
    replyToId: null,
    reviewCommitSha: HEAD_SHA,
    reviewId: 21,
  };
  for (const body of [
    `Fixed in ${HEAD_SHA.slice(0, 8)} — aligned the exact fixture`,
    "Won't fix: the behavior is required by the checked contract",
  ]) {
    const result = classifyDependabotFeedback({
      headSha: HEAD_SHA,
      reviews: [
        {
          actor: { association: "NONE", login: "cursor", type: "Bot" },
          body: "<!-- BUGBOT_REVIEW -->\nCursor Bugbot has reviewed your changes using high effort and found 1 potential issue.",
          commitSha: HEAD_SHA,
          id: 21,
          state: "COMMENTED",
        },
      ],
      threads: [
        {
          comments: [
            root,
            {
              actor: { association: "MEMBER", login: "alice", type: "User" },
              body,
              createdAt: "2026-08-10T10:01:00Z",
              id: 12,
              replyToId: 11,
              reviewCommitSha: HEAD_SHA,
              reviewId: 21,
            },
          ],
          id: "thread-1",
          outdated: false,
          resolved: true,
        },
      ],
    });
    assert.deepEqual(result.reasons, [], body);
  }
  const wrongHead = classifyDependabotFeedback({
    headSha: HEAD_SHA,
    reviews: [cursorReview()],
    threads: [
      {
        comments: [
          root,
          {
            actor: { association: "MEMBER", login: "alice", type: "User" },
            body: `Fixed in ${OTHER_SHA.slice(0, 8)} — changed a different head`,
            createdAt: "2026-08-10T10:01:00Z",
            id: 12,
            replyToId: 11,
            reviewCommitSha: HEAD_SHA,
            reviewId: 21,
          },
        ],
        id: "thread-1",
        outdated: false,
        resolved: true,
      },
    ],
  });
  assert.deepEqual(wrongHead.reasons, ["unreplied-review-feedback"]);
});

test("actionable Claude and Codex roots require one bounded actor- and commit-bound parent review", () => {
  for (const { body, login } of [
    {
      body: "## Claude Code Review\nOne inline finding follows.",
      login: "claude",
    },
    {
      body: "Codex Review:\nOne inline finding follows.",
      login: "chatgpt-codex-connector",
    },
    {
      body: codexReviewBody(),
      login: "chatgpt-codex-connector",
    },
  ]) {
    const root = {
      actor: { association: "NONE", login, type: "Bot" },
      body: "Inline finding",
      createdAt: "2026-08-10T10:00:00Z",
      id: 11,
      replyToId: null,
      reviewCommitSha: HEAD_SHA,
      reviewId: 21,
    };
    const reply = {
      actor: { association: "MEMBER", login: "alice", type: "User" },
      body: `Fixed in ${HEAD_SHA.slice(0, 8)} — fixed the bounded finding`,
      createdAt: "2026-08-10T10:01:00Z",
      id: 12,
      replyToId: 11,
      reviewCommitSha: HEAD_SHA,
      reviewId: 21,
    };
    const review = {
      actor: { association: "NONE", login, type: "Bot" },
      body,
      commitSha: HEAD_SHA,
      id: 21,
      state: "COMMENTED",
    };
    const clear = classifyDependabotFeedback({
      headSha: HEAD_SHA,
      reviews: [review],
      threads: [
        {
          comments: [root, reply],
          id: "thread-1",
          resolved: true,
        },
      ],
    });
    assert.deepEqual(clear.reasons, [], login);

    for (const badReviews of [
      [],
      [{ ...review, actor: { ...review.actor, login: "cursor" } }],
      [{ ...review, commitSha: OTHER_SHA }],
      [{ ...review, body: "x".repeat(50_001) }],
      ...(body.startsWith("\n### 💡 Codex Review\n")
        ? [
            [{ ...review, body: codexReviewBody(OTHER_SHA) }],
            [
              {
                ...review,
                body: body.replace(
                  "Here are some automated review suggestions",
                  "Automated suggestions",
                ),
              },
            ],
          ]
        : []),
    ]) {
      const blocked = classifyDependabotFeedback({
        headSha: HEAD_SHA,
        reviews: badReviews,
        threads: [
          {
            comments: [root, reply],
            id: "thread-1",
            resolved: true,
          },
        ],
      });
      assert.ok(
        blocked.reasons.includes("invalid-actionable-review-envelope"),
        `${login}:${JSON.stringify(blocked.reasons)}`,
      );
      assert.equal(blocked.complete, false);
    }
  }
});

test("processor approvals are informational only when their body binds their own current or historical commit", () => {
  const approval = (commitSha, bodySha = commitSha) => ({
    actor: { association: "NONE", login: "github-actions", type: "Bot" },
    body: `Approved by ${DEPENDABOT_PROCESSOR_SCHEMA} for exact head ${bodySha}.`,
    commitSha,
    id: commitSha === HEAD_SHA ? 1 : 2,
    state: "APPROVED",
  });
  const result = classifyDependabotFeedback({
    headSha: HEAD_SHA,
    reviews: [approval(HEAD_SHA), approval(OTHER_SHA)],
  });
  assert.deepEqual(result.reasons, []);
  assert.equal(result.currentProcessorApprovalCount, 1);
  assert.deepEqual(result.currentProcessorApprovalIds, [1]);
  assert.equal(result.historicalProcessorApprovalCount, 1);

  const dismissed = classifyDependabotFeedback({
    headSha: HEAD_SHA,
    reviews: [{ ...approval(HEAD_SHA), id: 3, state: "DISMISSED" }],
  });
  assert.deepEqual(dismissed.reasons, []);
  assert.equal(dismissed.currentProcessorApprovalCount, 0);
  assert.deepEqual(dismissed.currentProcessorApprovalIds, []);
  assert.equal(dismissed.dismissedProcessorApprovalCount, 1);

  const mismatched = classifyDependabotFeedback({
    headSha: HEAD_SHA,
    reviews: [approval(OTHER_SHA, HEAD_SHA)],
  });
  assert.deepEqual(mismatched.reasons, ["unknown-review-bot-feedback"]);
  assert.equal(mismatched.currentProcessorApprovalCount, 0);
});

test("resolved historical feedback clears without a current-head reply while unresolved feedback still requires one", () => {
  const thread = {
    comments: [
      {
        actor: { association: "NONE", login: "cursor", type: "Bot" },
        body: "### Old finding",
        createdAt: "2026-08-09T10:00:00Z",
        id: 11,
        replyToId: null,
        reviewCommitSha: OTHER_SHA,
        reviewId: 21,
      },
    ],
    id: "thread-1",
    outdated: true,
    resolved: false,
  };
  const blocked = classifyDependabotFeedback({
    headSha: HEAD_SHA,
    reviews: [cursorReview(OTHER_SHA)],
    threads: [thread],
  });
  assert.deepEqual(blocked.reasons, [
    "unresolved-review-feedback",
    "unreplied-review-feedback",
  ]);
  const clear = classifyDependabotFeedback({
    headSha: HEAD_SHA,
    reviews: [cursorReview(OTHER_SHA)],
    threads: [{ ...thread, resolved: true }],
  });
  assert.deepEqual(clear.reasons, []);

  const malformedEnvelope = classifyDependabotFeedback({
    headSha: HEAD_SHA,
    reviews: [{ ...cursorReview(OTHER_SHA), body: "malformed" }],
    threads: [{ ...thread, resolved: true }],
  });
  assert.deepEqual(malformedEnvelope.reasons, [
    "unknown-review-bot-feedback",
    "invalid-actionable-review-envelope",
  ]);
  assert.equal(malformedEnvelope.complete, false);
});

test("empty legacy Cursor envelopes clear only when every inline root is historical, outdated, and resolved", () => {
  const review = { ...cursorReview(OTHER_SHA), body: "" };
  const thread = {
    comments: [
      {
        actor: review.actor,
        body: "### Historical Cursor finding",
        createdAt: "2026-08-09T10:00:00Z",
        id: 11,
        replyToId: null,
        reviewCommitSha: OTHER_SHA,
        reviewId: review.id,
      },
    ],
    id: "legacy-cursor-thread",
    outdated: true,
    resolved: true,
  };

  const clear = classifyDependabotFeedback({
    headSha: HEAD_SHA,
    reviews: [review],
    threads: [thread],
  });
  assert.deepEqual(clear.reasons, []);
  assert.equal(clear.complete, true);
  assert.equal(clear.actionableThreadCount, 0);
  assert.deepEqual(clear.actionableThreads, []);

  const currentReview = { ...cursorReview(HEAD_SHA, 2), id: 22 };
  const currentThreads = [1, 2].map((index) => ({
    comments: [
      {
        actor: currentReview.actor,
        body: `### Current Cursor finding ${index}`,
        createdAt: `2026-08-10T10:0${index}:00Z`,
        id: 20 + index,
        replyToId: null,
        reviewCommitSha: HEAD_SHA,
        reviewId: currentReview.id,
      },
    ],
    id: `current-cursor-thread-${index}`,
    outdated: false,
    resolved: false,
  }));
  const mixed = classifyDependabotFeedback({
    headSha: HEAD_SHA,
    reviews: [review, currentReview],
    threads: [thread, ...currentThreads],
  });
  assert.deepEqual(mixed.reasons, [
    "unresolved-review-feedback",
    "unreplied-review-feedback",
  ]);
  assert.equal(mixed.complete, true);
  assert.equal(mixed.actionableThreadCount, 2);
  assert.equal(mixed.actionableThreads.length, 2);
  assert.equal(
    evaluateFeedbackGate({
      feedback: mixed,
      pullRequest: snapshot().pullRequest,
    }).repairable,
    true,
  );

  const sameReviewUnresolvedThread = {
    ...thread,
    comments: [
      {
        ...thread.comments[0],
        body: "### Second historical Cursor finding",
        id: 12,
      },
    ],
    id: "legacy-cursor-unresolved-thread",
    resolved: false,
  };
  for (const [blockedThread, threadReason] of [
    [{ ...thread, outdated: false }, "invalid-actionable-review-envelope"],
    [{ ...thread, resolved: false }, "invalid-actionable-review-envelope"],
    [
      { ...thread, commentsTruncated: true },
      "feedback-thread-comments-cap-exceeded",
    ],
  ]) {
    const blocked = classifyDependabotFeedback({
      headSha: HEAD_SHA,
      reviews: [review],
      threads: [blockedThread],
    });
    assert.ok(
      blocked.reasons.includes("unknown-review-bot-feedback"),
      JSON.stringify(blocked.reasons),
    );
    assert.ok(
      blocked.reasons.includes(threadReason),
      JSON.stringify(blocked.reasons),
    );
    assert.equal(blocked.complete, false);
  }

  const incompleteReview = classifyDependabotFeedback({
    headSha: HEAD_SHA,
    reviews: [review],
    threads: [thread, sameReviewUnresolvedThread],
  });
  assert.ok(
    incompleteReview.reasons.includes("unknown-review-bot-feedback"),
    JSON.stringify(incompleteReview.reasons),
  );
  assert.ok(
    incompleteReview.reasons.includes("invalid-actionable-review-envelope"),
    JSON.stringify(incompleteReview.reasons),
  );
  assert.equal(incompleteReview.complete, false);

  const whitespaceEnvelope = classifyDependabotFeedback({
    headSha: HEAD_SHA,
    reviews: [{ ...review, body: " " }],
    threads: [thread],
  });
  assert.ok(
    whitespaceEnvelope.reasons.includes("unknown-review-bot-feedback"),
    JSON.stringify(whitespaceEnvelope.reasons),
  );
  assert.ok(
    whitespaceEnvelope.reasons.includes("invalid-actionable-review-envelope"),
    JSON.stringify(whitespaceEnvelope.reasons),
  );
  assert.equal(whitespaceEnvelope.complete, false);
});

test("resolved replied trusted bot threads do not poison an unrelated deterministic repair", () => {
  const historicalReview = cursorReview(OTHER_SHA);
  const currentReview = { ...cursorReview(HEAD_SHA), id: 22 };
  const feedback = classifyDependabotFeedback({
    headSha: HEAD_SHA,
    reviews: [historicalReview, currentReview],
    threads: [
      {
        comments: [
          {
            actor: historicalReview.actor,
            body: "### Historical workflow finding",
            createdAt: "2026-08-09T10:00:00Z",
            id: 31,
            replyToId: null,
            reviewCommitSha: OTHER_SHA,
            reviewId: historicalReview.id,
          },
          {
            actor: { association: "MEMBER", login: "alice", type: "User" },
            body: "Won't fix: the historical finding was superseded by the current exact head",
            createdAt: "2026-08-09T10:01:00Z",
            id: 32,
            replyToId: 31,
            reviewCommitSha: OTHER_SHA,
            reviewId: historicalReview.id,
          },
        ],
        id: "historical-resolved-thread",
        outdated: true,
        path: ".github/workflows/dependabot-process.yml",
        resolved: true,
      },
      {
        comments: [
          {
            actor: currentReview.actor,
            body: "### Current deployment runbook finding",
            createdAt: "2026-08-10T10:00:00Z",
            id: 41,
            replyToId: null,
            reviewCommitSha: HEAD_SHA,
            reviewId: currentReview.id,
          },
          {
            actor: { association: "MEMBER", login: "alice", type: "User" },
            body: `Fixed in ${HEAD_SHA.slice(0, 8)} — aligned the current finding`,
            createdAt: "2026-08-10T10:01:00Z",
            id: 42,
            replyToId: 41,
            reviewCommitSha: HEAD_SHA,
            reviewId: currentReview.id,
          },
        ],
        id: "current-resolved-thread",
        outdated: false,
        path: "docs/vercel-deployments.md",
        resolved: true,
      },
    ],
  });

  assert.deepEqual(feedback.reasons, []);
  assert.equal(feedback.actionableThreadCount, 0);
  assert.deepEqual(feedback.actionableThreads, []);
  assert.equal(feedback.unresolvedThreads, 0);
  assert.equal(feedback.unrepliedThreads, 0);

  const evaluated = evaluateDependabotPullRequest(
    snapshot({
      checks: completeChecks({ conclusions: { ci: "failure" } }),
      feedback,
    }),
    {
      mode: "prepare",
      repository: REPOSITORY,
      workflowContext: WORKFLOW_CONTEXT,
    },
  );

  assert.equal(evaluated.disposition, "repair-required");
  assert.notEqual(evaluated.disposition, "manual-repair-required");
  assert.deepEqual(evaluated.feedback.actionableThreads, []);
  assert.deepEqual(evaluated.repairPacket.feedbackThreads, []);
  assert.deepEqual(
    evaluated.repairPacket.failures.map(({ id }) => id),
    ["ci"],
  );
  assert.equal(
    evaluated.repairPacket.failures.length +
      evaluated.repairPacket.findings.length +
      evaluated.repairPacket.feedbackThreads.length,
    1,
  );
});

test("resolved packet-bound automation replies do not become later repair input", () => {
  const packetDigest = "a".repeat(64);
  const rootBody = "Claude finding";
  const threadId = "PRRT_thread_61";
  const classified = classifyDependabotFeedback({
    headSha: HEAD_SHA,
    reviews: [
      {
        actor: { association: "NONE", login: "claude", type: "Bot" },
        body: "## Claude Code Review\nOne inline finding follows.",
        commitSha: HEAD_SHA,
        id: 21,
        state: "COMMENTED",
      },
    ],
    threads: [
      {
        comments: [
          {
            actor: { association: "NONE", login: "claude", type: "Bot" },
            body: rootBody,
            createdAt: "2026-08-10T10:00:00Z",
            id: 61,
            replyToId: null,
            reviewCommitSha: HEAD_SHA,
            reviewId: 21,
          },
          {
            actor: {
              association: "NONE",
              login: "github-actions",
              type: "Bot",
            },
            body: `Fixed in ${HEAD_SHA.slice(0, 12)} — Addressed by authenticated Dependabot preparation.\n\n<!-- dependabot-remediation:v1 pr=123 head=${HEAD_SHA} thread=${textDigest(threadId)} packet=${packetDigest} -->`,
            createdAt: "2026-08-10T10:01:00Z",
            id: 62,
            replyToId: 61,
            reviewCommitSha: HEAD_SHA,
            reviewId: 21,
          },
        ],
        id: threadId,
        line: 7,
        path: "package.json",
        resolved: true,
      },
    ],
  });
  assert.deepEqual(classified.reasons, ["unreplied-review-feedback"]);
  assert.equal(classified.actionableThreadCount, 1);
  assert.equal(classified.actionableThreads[0].resolved, true);

  const thread = classified.actionableThreads[0];
  const feedback = evaluateFeedbackGate({
    feedback: {
      ...classified,
      reviewDecision: "APPROVED",
    },
    pullRequest: snapshot().pullRequest,
    repairAttempts: {
      latestAppliedRepair: {
        packet: {
          feedbackThreads: [
            {
              commentId: thread.rootCommentId,
              digest: thread.bodyDigest,
              threadId: thread.threadId,
            },
          ],
        },
        packetDigest,
        receipt: { state: "completed" },
      },
    },
  });

  assert.equal(feedback.clear, true);
  assert.equal(feedback.actionableThreadCount, 0);
  assert.deepEqual(feedback.actionableThreads, []);
  assert.deepEqual(feedback.trustedRemediationThreads, [thread.threadId]);

  const unrelatedCiFailure = evaluateDependabotPullRequest(
    snapshot({ checks: completeChecks({ conclusions: { ci: "failure" } }) }),
    {
      mode: "prepare",
      repository: REPOSITORY,
      workflowContext: WORKFLOW_CONTEXT,
    },
  );
  const laterPacket = createDependabotRepairPacket({
    ...unrelatedCiFailure,
    feedback,
  });

  assert.notEqual(laterPacket, null);
  assert.deepEqual(laterPacket.feedbackThreads, []);
  assert.deepEqual(
    laterPacket.failures.map(({ id }) => id),
    ["ci"],
  );
  assert.equal(
    laterPacket.failures.length +
      laterPacket.findings.length +
      laterPacket.feedbackThreads.length,
    1,
  );
});

test("historical Codex envelopes bind their reviewed commit before repaired-head resolution", () => {
  const review = {
    actor: {
      association: "NONE",
      login: "chatgpt-codex-connector",
      type: "Bot",
    },
    body: codexReviewBody(OTHER_SHA),
    commitSha: OTHER_SHA,
    id: 41,
    state: "COMMENTED",
  };
  const thread = {
    comments: [
      {
        actor: review.actor,
        body: "### Historical Codex finding",
        createdAt: "2026-08-09T10:00:00Z",
        id: 42,
        replyToId: null,
        reviewCommitSha: OTHER_SHA,
        reviewId: review.id,
      },
    ],
    id: "codex-thread-42",
    outdated: true,
    resolved: false,
  };

  const blocked = classifyDependabotFeedback({
    headSha: HEAD_SHA,
    reviews: [review],
    threads: [thread],
  });
  assert.deepEqual(blocked.reasons, [
    "unresolved-review-feedback",
    "unreplied-review-feedback",
  ]);

  const clear = classifyDependabotFeedback({
    headSha: HEAD_SHA,
    reviews: [review],
    threads: [{ ...thread, resolved: true }],
  });
  assert.deepEqual(clear.reasons, []);

  const wrongEnvelopeCommit = classifyDependabotFeedback({
    headSha: HEAD_SHA,
    reviews: [{ ...review, body: codexReviewBody(HEAD_SHA) }],
    threads: [{ ...thread, resolved: true }],
  });
  assert.deepEqual(wrongEnvelopeCommit.reasons, [
    "unknown-review-bot-feedback",
    "invalid-actionable-review-envelope",
  ]);
});

test("trusted human prose and unknown bots remove auto authority without letting public users create a veto", () => {
  const result = classifyDependabotFeedback({
    headSha: HEAD_SHA,
    issueComments: [
      {
        actor: { association: "MEMBER", login: "alice", type: "User" },
        body: "Please hold this update.",
        id: 31,
      },
      {
        actor: { association: "NONE", login: "mallory", type: "User" },
        body: "Please hold this update.",
        id: 32,
      },
      {
        actor: { association: "NONE", login: "mystery[bot]", type: "Bot" },
        body: "All clear, probably.",
        id: 33,
      },
    ],
    reviews: [
      {
        actor: { association: "OWNER", login: "bob", type: "User" },
        body: "Please update the paired runtime.",
        commitSha: HEAD_SHA,
        id: 34,
        state: "COMMENTED",
      },
    ],
  });
  assert.deepEqual(result.reasons, [
    "maintainer-top-level-review-feedback",
    "maintainer-issue-comment",
    "unknown-issue-comment-bot-feedback",
  ]);
  assert.equal(result.blockerCount, 3);
});

test("exact trusted maintainer Dependabot branch commands do not create a veto", () => {
  const result = classifyDependabotFeedback({
    headSha: HEAD_SHA,
    issueComments: [
      {
        actor: { association: "MEMBER", login: "alice", type: "User" },
        body: "@dependabot recreate",
        createdAt: "2026-08-10T08:00:00Z",
        id: 31,
        updatedAt: "2026-08-10T08:00:00Z",
      },
      {
        actor: { association: "OWNER", login: "bob", type: "User" },
        body: "\n@dependabot rebase\n",
        createdAt: "2026-08-10T09:00:00Z",
        id: 32,
        updatedAt: "2026-08-10T09:00:00Z",
      },
      {
        actor: { association: "MEMBER", login: "alice", type: "User" },
        body: "@dependabot recreate please",
        id: 33,
      },
      {
        actor: { association: "MEMBER", login: "alice", type: "User" },
        body: "@dependabot merge",
        id: 34,
      },
      {
        actor: { association: "MEMBER", login: "alice", type: "User" },
        body: "Please hold this update.",
        id: 35,
      },
    ],
  });
  assert.deepEqual(result.reasons, ["maintainer-issue-comment"]);
  assert.equal(result.blockerCount, 3);
  assert.deepEqual(
    result.branchMaintenanceComments.map(({ body, id }) => ({ body, id })),
    [
      { body: "@dependabot recreate", id: 31 },
      { body: "@dependabot rebase", id: 32 },
    ],
  );
});

test("edited or malformed trusted branch commands remain maintainer vetoes", () => {
  const result = classifyDependabotFeedback({
    headSha: HEAD_SHA,
    issueComments: [
      {
        actor: { association: "MEMBER", login: "alice", type: "User" },
        body: "@dependabot recreate",
        createdAt: "2026-08-10T08:00:00Z",
        id: 31,
        updatedAt: "2026-08-10T08:01:00Z",
      },
      {
        actor: { association: "OWNER", login: "bob", type: "User" },
        body: "@dependabot rebase",
        createdAt: "2026-08-10T09:00:00Z",
        id: null,
        updatedAt: "2026-08-10T09:00:00Z",
      },
    ],
  });

  assert.deepEqual(result.branchMaintenanceComments, []);
  assert.equal(result.blockerCount, 2);
  assert.deepEqual(result.reasons, ["maintainer-issue-comment"]);
});

test("bot informational issue comments require their exact author and body predicates", () => {
  const comments = [
    {
      actor: { association: "NONE", login: "github-actions[bot]", type: "Bot" },
      body: "<!-- vercel-preview-journal:v2 -->\n\n**No reviewer action is required.** Details follow.",
      id: 1,
    },
    {
      actor: { association: "NONE", login: "argos-ci[bot]", type: "Bot" },
      body: "**The latest updates on your projects.** Learn more about [Argos notifications ↗︎](https://argos-ci.com/docs/learn/review-workflow/pull-request-comments)\n\n| Build | Status |",
      id: 2,
    },
    {
      actor: { association: "NONE", login: "vercel[bot]", type: "Bot" },
      body: "[vc]: signed provider payload",
      id: 3,
    },
    {
      actor: {
        association: "NONE",
        login: "chatgpt-codex-connector[bot]",
        type: "Bot",
      },
      body: "Codex Review: Didn't find any major issues. Nice.",
      id: 4,
    },
  ];
  assert.deepEqual(
    classifyDependabotFeedback({ headSha: HEAD_SHA, issueComments: comments })
      .reasons,
    [],
  );
  const missingJournalPredicate = classifyDependabotFeedback({
    headSha: HEAD_SHA,
    issueComments: [
      { ...comments[0], body: "<!-- vercel-preview-journal:v2 -->" },
    ],
  });
  assert.deepEqual(missingJournalPredicate.reasons, [
    "unknown-issue-comment-bot-feedback",
  ]);
});

test("feedback collection caps fail closed instead of silently dropping thread data", () => {
  const result = classifyDependabotFeedback({
    headSha: HEAD_SHA,
    threadPagesTruncated: true,
    threads: [
      {
        comments: [],
        commentsTruncated: true,
        id: "thread-over-cap",
        resolved: true,
      },
    ],
  });
  assert.equal(result.complete, false);
  assert.deepEqual(result.reasons, [
    "feedback-thread-pagination-cap-exceeded",
    "feedback-thread-comments-cap-exceeded",
  ]);
  assert.deepEqual(
    evaluateFeedbackGate({
      feedback: result,
      pullRequest: snapshot().pullRequest,
    }).reasons,
    [
      "feedback-incomplete",
      "feedback-thread-pagination-cap-exceeded",
      "feedback-thread-comments-cap-exceeded",
    ],
  );
});

test("feedback snapshot stability binds head, update token, and canonical digest", () => {
  const stable = {
    digest: "a".repeat(64),
    headSha: HEAD_SHA,
    updatedAt: "2026-08-10T10:00:00Z",
  };
  requireStableFeedbackSnapshot(stable, { ...stable }, 123);
  for (const changed of [
    { ...stable, digest: "b".repeat(64) },
    { ...stable, headSha: OTHER_SHA },
    { ...stable, updatedAt: "2026-08-10T10:01:00Z" },
  ]) {
    assert.throws(
      () => requireStableFeedbackSnapshot(stable, changed, 123),
      /feedback changed while its exact-head snapshot was collected/,
    );
  }
});

test("a historical human close remains an explicit veto after the PR is reopened", () => {
  const result = evaluateDependabotPullRequest(
    snapshot({
      feedback: {
        humanClosed: true,
        maintainerVeto: true,
        reviewDecision: "APPROVED",
        unresolvedThreads: 0,
      },
    }),
    { mode: "prepare", repository: REPOSITORY },
  );
  assert.equal(result.feedback.clear, false);
  assert.equal(result.feedback.humanClosed, true);
  assert.deepEqual(result.feedback.reasons, ["human-closed-pull-request"]);
  assert.equal(result.disposition, "manual-veto-or-feedback");
});

test("a historical human reopen is also a durable intervention veto", () => {
  const result = evaluateDependabotPullRequest(
    snapshot({
      feedback: {
        humanReopened: true,
        maintainerVeto: true,
        reviewDecision: "APPROVED",
        unresolvedThreads: 0,
      },
    }),
    { mode: "prepare", repository: REPOSITORY },
  );
  assert.equal(result.feedback.clear, false);
  assert.equal(result.feedback.humanReopened, true);
  assert.deepEqual(result.feedback.reasons, ["human-reopened-pull-request"]);
  assert.equal(result.disposition, "manual-veto-or-feedback");
});

test("evaluates exact observe, assist, and prepare dispositions and v2 repair packets", () => {
  assert.equal(
    evaluateDependabotPullRequest(snapshot(), {
      mode: "observe",
      repository: REPOSITORY,
    }).disposition,
    "eligible-observed",
  );
  assert.equal(
    evaluateDependabotPullRequest(snapshot(), {
      mode: "assist",
      repository: REPOSITORY,
    }).disposition,
    "ready-for-human-review",
  );
  assert.equal(
    evaluateDependabotPullRequest(snapshot(), {
      mode: "prepare",
      repository: REPOSITORY,
      workflowContext: WORKFLOW_CONTEXT,
    }).disposition,
    "prepare-candidate",
  );

  const pending = evaluateDependabotPullRequest(
    snapshot({ checks: completeChecks().slice(0, -1) }),
    {
      mode: "prepare",
      repository: REPOSITORY,
      workflowContext: WORKFLOW_CONTEXT,
    },
  );
  assert.equal(pending.disposition, "waiting-checks");

  const repair = evaluateDependabotPullRequest(
    snapshot({ checks: completeChecks({ conclusions: { ci: "failure" } }) }),
    {
      mode: "prepare",
      repository: REPOSITORY,
      workflowContext: WORKFLOW_CONTEXT,
    },
  );
  assert.equal(repair.disposition, "repair-required");
  assert.deepEqual(
    repair.repairPacket.failures.map(({ id }) => id),
    ["ci"],
  );
  assert.deepEqual(repair.repairPacket.expectedBlobs, [
    { mode: "100644", path: "package.json", sha: OTHER_SHA, type: "blob" },
  ]);
  assert.equal(repair.repairPacket.schema, DEPENDABOT_REPAIR_PACKET_SCHEMA);
  assert.deepEqual(
    {
      workflowRunAttempt: repair.repairPacket.workflowRunAttempt,
      workflowRunId: repair.repairPacket.workflowRunId,
      workflowSha: repair.repairPacket.workflowSha,
    },
    WORKFLOW_CONTEXT,
  );
  assert.equal(
    evaluateDependabotPullRequest(
      snapshot({ checks: completeChecks({ conclusions: { ci: "failure" } }) }),
      { mode: "observe", repository: REPOSITORY },
    ).repairPacket,
    null,
  );
});

test("immutable frontend-core Next metadata selects an exact v3 catalog sync for source and mixed states", () => {
  const operation = {
    dependency: "next",
    fromSpecifier: NEXT_FROM_SPECIFIER,
    fromVersion: "16.2.12",
    inputPaths: VERCEL_INPUT_PATHS,
    kind: "next-catalog-override-sync",
    pnpmVersion: "10.34.4",
    resolutionMode: "lowest-direct",
    requiredPaths: NEXT_CATALOG_REQUIRED_PATHS,
    schema: "dependabot-protected-runtime-sync:v1",
    sourceSeedHeadSha: HEAD_SHA,
    targetSpecifier: NEXT_TARGET_SPECIFIER,
    targetVersion: "16.3.1",
    updateType: "minor",
  };
  for (const state of ["source", "mixed"]) {
    const result = evaluateDependabotPullRequest(
      nextCatalogSnapshot({ nextCatalogSync: nextCatalogState(state) }),
      {
        mode: "prepare",
        repository: REPOSITORY,
        workflowContext: WORKFLOW_CONTEXT,
      },
    );

    assert.equal(result.disposition, "repair-required", state);
    assert.deepEqual(result.dependencies, [
      {
        from: "16.2.12",
        name: "next",
        to: "16.3.1",
        updateType: "minor",
      },
    ]);
    assert.deepEqual(result.nextCatalogSyncOperation, {
      eligible: true,
      proof: null,
      satisfied: false,
      stateMatches: false,
      operation,
    });
    assert.equal(
      result.repairPacket?.schema,
      "dependabot-repair-packet:v3",
      state,
    );
    assert.deepEqual(result.repairPacket?.operation, operation, state);
    assert.deepEqual(
      result.repairPacket?.expectedBlobs.map(({ path }) => path),
      VERCEL_INPUT_PATHS,
      state,
    );
    assert.deepEqual(
      result.repairPacket?.permittedPaths,
      NEXT_CATALOG_REQUIRED_PATHS,
      state,
    );
    assert.deepEqual(result.repairPacket?.limits, {
      maxAddedLines: 600,
      maxBytes: 65_536,
      maxChanges: 1_200,
      maxDeletedLines: 600,
      maxFiles: 6,
    });
  }

  const packet = evaluateDependabotPullRequest(nextCatalogSnapshot(), {
    mode: "prepare",
    repository: REPOSITORY,
    workflowContext: WORKFLOW_CONTEXT,
  }).repairPacket;
  assert.notEqual(packet, null);
  assert.deepEqual(
    Object.keys(packet).sort(),
    [
      "attemptLimit",
      "attemptNumber",
      "automatic",
      "baseRef",
      "baseSha",
      "changedPaths",
      "dependencyGroup",
      "dependencyNames",
      "escalation",
      "expectedBlobs",
      "failures",
      "feedbackThreads",
      "findings",
      "forbiddenPaths",
      "headRef",
      "headSha",
      "limits",
      "mode",
      "operation",
      "packageEcosystem",
      "permittedPaths",
      "preparable",
      "pullRequestNumber",
      "repository",
      "requireExactHead",
      "requireHumanApproval",
      "requiredGateIds",
      "riskTier",
      "schema",
      "updateType",
      "validationCommands",
      "workflowRunAttempt",
      "workflowRunId",
      "workflowSha",
    ].sort(),
  );
  assert.equal(packet.expectedBlobs.length, 15);
  assert.equal(packet.permittedPaths.length, 6);
  assert.deepEqual(packet.changedPaths, [
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
  ]);
  assert.deepEqual(
    packet.failures.map(({ attribution, id }) => ({ attribution, id })),
    [{ attribution: "branch", id: "supply-chain-version-skew" }],
  );
  assert.deepEqual(packet.feedbackThreads, []);
  assert.deepEqual(packet.findings, []);
});

test("the exact Cursor Next mismatch is packet-bound to the typed catalog sync", () => {
  const evaluateWithFeedback = (feedback) => {
    const candidate = nextCatalogSnapshot();
    candidate.feedback = { ...candidate.feedback, ...feedback };
    return evaluateDependabotPullRequest(candidate, {
      mode: "prepare",
      repository: REPOSITORY,
      workflowContext: WORKFLOW_CONTEXT,
    });
  };

  const exactFeedback = nextCatalogSyncCursorFeedback();
  const exact = evaluateWithFeedback(exactFeedback);
  assert.equal(exact.disposition, "repair-required");
  assert.equal(
    exact.repairPacket?.schema,
    DEPENDABOT_PROTECTED_RUNTIME_REPAIR_PACKET_SCHEMA,
  );
  assert.deepEqual(exact.repairPacket?.feedbackThreads, [
    {
      commentId: 11,
      commitSha: HEAD_SHA,
      digest: exact.feedback.actionableThreads[0].bodyDigest,
      line: 277,
      path: "pnpm-lock.yaml",
      source: "cursor",
      threadId: "thread-next-catalog-sync",
    },
  ]);

  const wrongSource = structuredClone(exactFeedback);
  wrongSource.actionableThreads[0].source = "claude";
  const wrongCommit = structuredClone(exactFeedback);
  wrongCommit.actionableThreads[0].reviewCommitSha = OTHER_SHA;
  const mixed = structuredClone(exactFeedback);
  mixed.actionableThreadCount = 2;
  mixed.actionableThreads.push({
    ...mixed.actionableThreads[0],
    bodyDigest: "b".repeat(64),
    rootCommentId: 12,
    threadId: "thread-unrelated-lock-finding",
  });
  delete mixed.actionableThreads[1].protectedRuntimeFinding;
  for (const feedback of [
    nextCatalogSyncCursorFeedback({
      body: nextCatalogSyncCursorBody({ targetVersion: "16.3.2" }),
    }),
    nextCatalogSyncCursorFeedback({ path: "package.json" }),
    wrongSource,
    wrongCommit,
    mixed,
  ]) {
    const blocked = evaluateWithFeedback(feedback);
    assert.equal(blocked.disposition, "manual-repair-required");
    assert.equal(blocked.repairPacket, null);
  }
});

test("an exact Cursor Next finding stays bound across authenticated repair and refresh lineage", () => {
  const headRef = "dependabot/npm_and_yarn/frontend-core-2f0c077f04";
  const first = evaluateDependabotPullRequest(nextCatalogSnapshot(), {
    mode: "prepare",
    repository: REPOSITORY,
    workflowContext: WORKFLOW_CONTEXT,
  });
  assert.equal(first.disposition, "repair-required");
  assert.notEqual(first.repairPacket, null);

  const processorCheck = processorRepairReceipt(1, {
    headSha: HEAD_SHA,
    id: 10_411,
    packet: first.repairPacket,
    packetEncoding: "canonical",
  });
  const repairCheck = repairReceiptCheck({
    attempt: 1,
    headRef,
    headSha: OTHER_SHA,
    id: 30_411,
    packetDigest: rawDigest(processorCheck.outputText),
    parentHeadSha: HEAD_SHA,
    processorCheckId: processorCheck.id,
  });
  const refreshRequest = refreshReceiptCheck("requested", {
    headRef,
    id: 20_411,
    parentHeadSha: OTHER_SHA,
  });
  const refreshCompletion = refreshReceiptCheck("completed", {
    headRef,
    headSha: SECOND_HEAD_SHA,
    id: 20_412,
    parentHeadSha: OTHER_SHA,
    requestCheckId: refreshRequest.id,
  });
  const reviewFeedback = classifyDependabotFeedback({
    headSha: SECOND_HEAD_SHA,
    reviews: [cursorReview(OTHER_SHA)],
    threads: [
      {
        comments: [
          {
            actor: { association: "NONE", login: "cursor", type: "Bot" },
            body: nextCatalogSyncCursorBody({
              reviewCommitSha: OTHER_SHA,
            }),
            createdAt: "2026-08-22T17:07:46Z",
            id: 11,
            replyToId: null,
            reviewCommitSha: OTHER_SHA,
            reviewId: 21,
          },
        ],
        id: "thread-next-catalog-sync",
        line: 277,
        outdated: false,
        path: "pnpm-lock.yaml",
        resolved: false,
      },
    ],
  });
  const current = nextCatalogSnapshot({
    commits: [
      nativeDependabotCommit(HEAD_SHA),
      preparedCommit(OTHER_SHA, HEAD_SHA),
      {
        authorId: PREPARE_ACTOR.botId,
        authorLogin: PREPARE_ACTOR.botLogin,
        authorType: "Bot",
        ...GITHUB_SYSTEM_COMMITTER,
        parents: [OTHER_SHA, BASE_SHA],
        sha: SECOND_HEAD_SHA,
        verified: true,
        verificationReason: "valid",
      },
    ],
    headSha: SECOND_HEAD_SHA,
    repairHistoryChecks: [
      processorCheck,
      repairCheck,
      refreshRequest,
      refreshCompletion,
    ],
  });
  current.feedback = { ...current.feedback, ...reviewFeedback };

  const selected = evaluateDependabotPullRequest(current, {
    mode: "prepare",
    repository: REPOSITORY,
    workflowContext: WORKFLOW_CONTEXT,
  });
  assert.equal(selected.repairAttempt, 2);
  assert.equal(selected.disposition, "repair-required");
  assert.equal(
    selected.repairPacket?.schema,
    DEPENDABOT_PROTECTED_RUNTIME_REPAIR_PACKET_SCHEMA,
  );
  assert.deepEqual(selected.repairAttempts.authenticatedLineageHeadShas, [
    HEAD_SHA,
    OTHER_SHA,
    SECOND_HEAD_SHA,
  ]);
  assert.deepEqual(selected.repairPacket?.feedbackThreads, [
    {
      commentId: 11,
      commitSha: OTHER_SHA,
      digest: selected.feedback.actionableThreads[0].bodyDigest,
      line: 277,
      path: "pnpm-lock.yaml",
      source: "cursor",
      threadId: "thread-next-catalog-sync",
    },
  ]);

  const outsideLineage = structuredClone(current);
  outsideLineage.feedback.actionableThreads[0].reviewCommitSha = BASE_SHA;
  const blocked = evaluateDependabotPullRequest(outsideLineage, {
    mode: "prepare",
    repository: REPOSITORY,
    workflowContext: WORKFLOW_CONTEXT,
  });
  assert.equal(blocked.disposition, "manual-repair-required");
  assert.equal(blocked.repairPacket, null);

  const missingRefreshProof = structuredClone(current);
  missingRefreshProof.repairHistoryChecks = [processorCheck, repairCheck];
  const untrusted = evaluateDependabotPullRequest(missingRefreshProof, {
    mode: "prepare",
    repository: REPOSITORY,
    workflowContext: WORKFLOW_CONTEXT,
  });
  assert.deepEqual(untrusted.repairAttempts.authenticatedLineageHeadShas, []);
  assert.equal(untrusted.repairPacket, null);

  for (const authenticatedLineageHeadShas of [
    [HEAD_SHA, OTHER_SHA, OTHER_SHA],
    [OTHER_SHA, SECOND_HEAD_SHA],
    [HEAD_SHA, OTHER_SHA],
  ]) {
    const malformed = structuredClone(selected);
    malformed.repairAttempts.authenticatedLineageHeadShas =
      authenticatedLineageHeadShas;
    assert.equal(createDependabotRepairPacket(malformed), null);
  }
});

test("Next catalog sync recovers the source-state bad head at attempt two despite provider baselines", () => {
  const genericPacket = {
    ...legacyNpmRepairPacket(),
    changedPaths: ["pnpm-lock.yaml", "pnpm-workspace.yaml"],
    dependencyGroup: "frontend-core",
    dependencyNames: ["next"],
    headRef: "dependabot/npm_and_yarn/frontend-core-2f0c077f04",
    updateType: "minor",
  };
  const processorCheck = processorRepairReceipt(1, {
    headSha: HEAD_SHA,
    packet: genericPacket,
    packetEncoding: "canonical",
  });
  const repairCheck = repairReceiptCheck({
    attempt: 1,
    headRef: "dependabot/npm_and_yarn/frontend-core-2f0c077f04",
    headSha: OTHER_SHA,
    packetDigest: rawDigest(processorCheck.outputText),
    parentHeadSha: HEAD_SHA,
    processorCheckId: processorCheck.id,
  });
  const candidate = nextCatalogSnapshot({
    changedPaths: ["pnpm-lock.yaml"],
    checks: completeChecks({
      conclusions: { "e2e-celo": "failure", "e2e-monad": "failure" },
      headSha: OTHER_SHA,
    }),
    commits: [
      nativeDependabotCommit(HEAD_SHA),
      preparedCommit(OTHER_SHA, HEAD_SHA),
    ],
    headSha: OTHER_SHA,
    nextCatalogSync: nextCatalogState("source"),
    repairHistoryChecks: [processorCheck, repairCheck],
  });
  candidate.baseline.checks = candidate.baseline.checks.map((check) =>
    [CHECK_NAMES["e2e-celo"], CHECK_NAMES["e2e-monad"]].includes(check.name)
      ? { ...check, conclusion: "failure" }
      : check,
  );

  const result = evaluateDependabotPullRequest(candidate, {
    mode: "prepare",
    repository: REPOSITORY,
    workflowContext: WORKFLOW_CONTEXT,
  });

  assert.equal(result.repairAttempts.valid, true);
  assert.equal(result.repairAttempt, 2);
  assert.equal(result.disposition, "repair-required");
  assert.deepEqual(
    result.checks.failures.map(({ attribution, id }) => ({
      attribution,
      id,
    })),
    [
      { attribution: "provider-baseline", id: "e2e-celo" },
      { attribution: "provider-baseline", id: "e2e-monad" },
    ],
  );
  assert.equal(
    result.repairPacket?.operation.kind,
    "next-catalog-override-sync",
  );
  assert.equal(result.repairPacket?.attemptNumber, 2);
  assert.deepEqual(result.repairPacket?.failures, []);
});

test("Next catalog target state requires a reachable matching typed repair proof", () => {
  const withoutProof = evaluateDependabotPullRequest(
    nextCatalogSnapshot({
      checks: completeChecks(),
      nextCatalogSync: nextCatalogState("target"),
    }),
    {
      mode: "prepare",
      repository: REPOSITORY,
      workflowContext: WORKFLOW_CONTEXT,
    },
  );
  assert.equal(withoutProof.disposition, "manual-repair-required");
  assert.equal(withoutProof.repairPacket, null);
  assert.equal(
    withoutProof.nextCatalogSyncOperation.reason,
    "next-catalog-target-state-has-no-typed-proof",
  );

  const selected = evaluateDependabotPullRequest(nextCatalogSnapshot(), {
    mode: "prepare",
    repository: REPOSITORY,
    workflowContext: WORKFLOW_CONTEXT,
  });
  assert.notEqual(selected.repairPacket, null);
  const processorCheck = processorRepairReceipt(1, {
    headSha: HEAD_SHA,
    packet: selected.repairPacket,
    packetEncoding: "canonical",
  });
  const repairCheck = repairReceiptCheck({
    attempt: 1,
    headRef: "dependabot/npm_and_yarn/frontend-core-2f0c077f04",
    headSha: OTHER_SHA,
    packetDigest: rawDigest(processorCheck.outputText),
    parentHeadSha: HEAD_SHA,
    processorCheckId: processorCheck.id,
  });
  const withProof = evaluateDependabotPullRequest(
    nextCatalogSnapshot({
      changedPaths: NEXT_CATALOG_REQUIRED_PATHS,
      checks: completeChecks({ headSha: OTHER_SHA }),
      commits: [
        nativeDependabotCommit(HEAD_SHA),
        preparedCommit(OTHER_SHA, HEAD_SHA),
      ],
      headSha: OTHER_SHA,
      nextCatalogSync: nextCatalogState("target"),
      repairHistoryChecks: [processorCheck, repairCheck],
    }),
    {
      mode: "prepare",
      repository: REPOSITORY,
      workflowContext: WORKFLOW_CONTEXT,
    },
  );

  assert.equal(withProof.disposition, "prepare-candidate");
  assert.equal(withProof.repairPacket, null);
  assert.equal(withProof.nextCatalogSyncOperation.satisfied, true);
  assert.deepEqual(
    withProof.nextCatalogSyncOperation.proof.operation,
    selected.repairPacket.operation,
  );
  assert.equal(withProof.repairAttempts.protectedRuntimeOperations.length, 1);

  const genericPacket = structuredClone(selected.repairPacket);
  delete genericPacket.operation;
  Object.assign(genericPacket, {
    attemptNumber: 2,
    changedPaths: ["pnpm-lock.yaml"],
    expectedBlobs: genericPacket.expectedBlobs.filter(
      ({ path }) => path === "pnpm-lock.yaml",
    ),
    failures: [
      {
        attribution: "branch",
        detailsUrl: null,
        id: "supply-chain-version-skew",
        name: "catalog version-skew",
      },
    ],
    headSha: OTHER_SHA,
    limits: {
      maxAddedLines: 20,
      maxBytes: 8_192,
      maxChanges: 20,
      maxDeletedLines: 20,
      maxFiles: 1,
    },
    permittedPaths: ["pnpm-lock.yaml"],
    schema: DEPENDABOT_REPAIR_PACKET_SCHEMA,
  });
  const genericProcessorCheck = processorRepairReceipt(2, {
    headSha: OTHER_SHA,
    id: 10_102,
    packet: genericPacket,
    packetEncoding: "canonical",
  });
  const genericRepairCheck = repairReceiptCheck({
    attempt: 2,
    headRef: genericPacket.headRef,
    headSha: SECOND_HEAD_SHA,
    id: 30_102,
    packetDigest: rawDigest(genericProcessorCheck.outputText),
    parentHeadSha: OTHER_SHA,
    processorCheckId: genericProcessorCheck.id,
  });
  const afterGenericRepair = evaluateDependabotPullRequest(
    nextCatalogSnapshot({
      changedPaths: NEXT_CATALOG_REQUIRED_PATHS,
      checks: completeChecks({ headSha: SECOND_HEAD_SHA }),
      commits: [
        nativeDependabotCommit(HEAD_SHA),
        preparedCommit(OTHER_SHA, HEAD_SHA),
        preparedCommit(SECOND_HEAD_SHA, OTHER_SHA),
      ],
      headSha: SECOND_HEAD_SHA,
      nextCatalogSync: nextCatalogState("target"),
      repairHistoryChecks: [
        processorCheck,
        repairCheck,
        genericProcessorCheck,
        genericRepairCheck,
      ],
    }),
    {
      mode: "prepare",
      repository: REPOSITORY,
      workflowContext: WORKFLOW_CONTEXT,
    },
  );
  assert.equal(afterGenericRepair.disposition, "prepare-candidate");
  assert.equal(
    afterGenericRepair.repairAttempts.latestAppliedRepair.packet.schema,
    DEPENDABOT_REPAIR_PACKET_SCHEMA,
  );
  assert.equal(afterGenericRepair.nextCatalogSyncOperation.satisfied, true);
  assert.deepEqual(
    afterGenericRepair.nextCatalogSyncOperation.proof.operation,
    selected.repairPacket.operation,
  );
});

test("Next catalog sync rejects higher, malformed, and unsupported immutable states", () => {
  for (const [label, nextCatalogSync] of [
    [
      "higher-than-target catalog",
      {
        ...nextCatalogState("mixed"),
        catalogSpecifier: "^16.4.0",
      },
    ],
    [
      "malformed override",
      {
        ...nextCatalogState("mixed"),
        overrideSpecifier: "16.2.12",
      },
    ],
  ]) {
    const result = evaluateDependabotPullRequest(
      nextCatalogSnapshot({ nextCatalogSync }),
      {
        mode: "prepare",
        repository: REPOSITORY,
        workflowContext: WORKFLOW_CONTEXT,
      },
    );
    assert.equal(result.disposition, "manual-repair-required", label);
    assert.equal(result.repairPacket, null, label);
    assert.equal(
      result.nextCatalogSyncOperation.reason,
      "invalid-next-catalog-sync-snapshot",
      label,
    );
  }

  const unsupportedTransition = evaluateDependabotPullRequest(
    nextCatalogSnapshot({ metadata: nextCatalogMetadata({ to: "17.0.0" }) }),
    {
      mode: "prepare",
      repository: REPOSITORY,
      workflowContext: WORKFLOW_CONTEXT,
    },
  );
  assert.equal(unsupportedTransition.disposition, "manual-repair-required");
  assert.equal(unsupportedTransition.repairPacket, null);
  assert.equal(
    unsupportedTransition.nextCatalogSyncOperation.reason,
    "invalid-next-catalog-sync-update",
  );
});

test("a green #753-like legacy repair requires a typed Vercel runtime sync", () => {
  const legacy = vercelAfterLegacyRepair();
  const result = evaluateDependabotPullRequest(legacy.snapshot, {
    mode: "prepare",
    repository: REPOSITORY,
    workflowContext: WORKFLOW_CONTEXT,
  });

  assert.equal(result.repairAttempt, 2);
  assert.equal(result.disposition, "repair-required");
  assert.deepEqual(result.dependencies, vercelMetadata().dependencies);
  assert.equal(
    result.repairPacket?.schema,
    DEPENDABOT_PROTECTED_RUNTIME_REPAIR_PACKET_SCHEMA,
  );
  assert.deepEqual(result.repairPacket?.operation, {
    dependency: "vercel",
    fromVersion: "56.4.1",
    inputPaths: VERCEL_INPUT_PATHS,
    kind: "vercel-cli-runtime-sync",
    pnpmVersion: "10.34.4",
    requiredPaths: VERCEL_REQUIRED_PATHS,
    schema: "dependabot-protected-runtime-sync:v1",
    sourceSeedHeadSha: HEAD_SHA,
    targetVersion: "56.5.0",
    updateType: "minor",
  });
  assert.deepEqual(
    result.repairPacket?.expectedBlobs.map(({ path }) => path),
    VERCEL_INPUT_PATHS,
  );
  assert.deepEqual(result.repairPacket?.permittedPaths, VERCEL_REQUIRED_PATHS);
  assert.deepEqual(result.repairPacket?.limits, {
    maxAddedLines: 600,
    maxBytes: 65_536,
    maxChanges: 160,
    maxDeletedLines: 600,
    maxFiles: 5,
  });

  const alignedWithoutProof = evaluateDependabotPullRequest(
    vercelAfterLegacyRepair({ protectedVersion: "56.5.0" }).snapshot,
    {
      mode: "prepare",
      repository: REPOSITORY,
      workflowContext: WORKFLOW_CONTEXT,
    },
  );
  assert.equal(alignedWithoutProof.disposition, "repair-required");
  assert.equal(
    alignedWithoutProof.repairPacket?.schema,
    DEPENDABOT_PROTECTED_RUNTIME_REPAIR_PACKET_SCHEMA,
  );
});

test("a prior typed Vercel repair permits one finding-scoped generic follow-up", () => {
  const { repaired } = vercelAfterTypedRepair();
  repaired.checks = completeChecksWithClaudeFindings({
    findings: [
      {
        line: 16_610,
        path: "pnpm-lock.yaml",
        summary:
          "The unrelated lockfile resolution changed and must retain the prior compatible version.",
        title: "Retain the prior transitive resolution",
      },
    ],
    headSha: OTHER_SHA,
  });

  const result = evaluateDependabotPullRequest(repaired, {
    mode: "prepare",
    repository: REPOSITORY,
    workflowContext: WORKFLOW_CONTEXT,
  });

  assert.equal(result.protectedRuntimeOperation.satisfied, true);
  assert.equal(result.repairAttempt, 2);
  assert.equal(result.disposition, "repair-required");
  assert.equal(result.repairPacket?.schema, DEPENDABOT_REPAIR_PACKET_SCHEMA);
  assert.deepEqual(result.repairPacket?.changedPaths, VERCEL_REQUIRED_PATHS);
  assert.deepEqual(
    result.repairPacket?.expectedBlobs.map(({ path }) => path),
    ["pnpm-lock.yaml"],
  );
  assert.deepEqual(result.repairPacket?.permittedPaths, ["pnpm-lock.yaml"]);
  assert.equal(result.repairPacket?.limits.maxFiles, 1);
  assert.ok(
    result.repairPacket?.forbiddenPaths.includes(
      "scripts/vercel-cli-runtime/**",
    ),
  );
  assert.deepEqual(
    result.repairPacket?.findings.map(({ path, source }) => ({ path, source })),
    [{ path: "pnpm-lock.yaml", source: "claude" }],
  );

  const mixedOrdering = structuredClone(result);
  const mixedPaths = [
    "packages/-fixture/package.json",
    "packages/_fixture/package.json",
  ];
  const claudeFailure = mixedOrdering.checks.failures.find(
    ({ id }) => id === "claude-review",
  );
  for (const path of mixedPaths) {
    mixedOrdering.changedPaths.push(path);
    mixedOrdering.expectedBlobs.push({
      mode: "100644",
      path,
      sha: createHash("sha1").update(path).digest("hex"),
      type: "blob",
    });
    const summary = "The exact mixed-character path needs a bounded repair.";
    claudeFailure.findings.push({
      id: createHash("sha256").update(path).digest("hex").slice(0, 24),
      line: 1,
      path,
      summary,
      summaryDigest: textDigest(summary),
      title: "Repair the exact mixed-character path",
    });
  }
  mixedOrdering.changedPaths.sort();
  mixedOrdering.expectedBlobs.sort((left, right) =>
    left.path.localeCompare(right.path),
  );
  const expectedEvidencePaths = ["pnpm-lock.yaml", ...mixedPaths].sort(
    (left, right) => left.localeCompare(right),
  );
  const mixedPacket = createDependabotRepairPacket(mixedOrdering);
  assert.deepEqual(
    mixedPacket?.expectedBlobs.map(({ path }) => path),
    expectedEvidencePaths,
  );
  assert.deepEqual(mixedPacket?.permittedPaths, expectedEvidencePaths);

  const packetDigest = rawDigest(canonicalJson(result.repairPacket));
  assert.throws(
    () =>
      validateRepairPlan(
        {
          attempt: 2,
          baseSha: BASE_SHA,
          edits: [
            {
              expectedBlobSha: "6".repeat(40),
              patch:
                "--- a/scripts/vercel-cli-runtime/package.json\n+++ b/scripts/vercel-cli-runtime/package.json\n@@ -1 +1 @@\n-old\n+new\n",
              path: "scripts/vercel-cli-runtime/package.json",
            },
          ],
          packetDigest,
          parentHeadSha: OTHER_SHA,
          processorCheckId: 44_001,
          pullRequestNumber: 123,
          repository: REPOSITORY,
          schema: "dependabot-repair-plan:v1",
          summary: "Attempt to edit the protected runtime",
        },
        {
          packet: result.repairPacket,
          packetDigest,
          processorCheckId: 44_001,
        },
      ),
    /packet-denied path: scripts\/vercel-cli-runtime\/package\.json/,
  );

  const feedbackCandidate = vercelAfterTypedRepair().repaired;
  feedbackCandidate.feedback = {
    actionableThreadCount: 1,
    actionableThreads: [
      {
        bodyDigest: textDigest("Retain the prior transitive resolution"),
        line: 16_610,
        path: "pnpm-lock.yaml",
        reviewCommitSha: OTHER_SHA,
        rootCommentId: 61,
        source: "claude",
        threadId: "PRRT_lockfile_resolution",
        trustedBotEnvelope: true,
      },
    ],
    reasons: ["unresolved-review-feedback", "unreplied-review-feedback"],
    reviewDecision: "APPROVED",
    unresolvedThreads: 1,
    unrepliedThreads: 1,
  };
  const feedbackResult = evaluateDependabotPullRequest(feedbackCandidate, {
    mode: "prepare",
    repository: REPOSITORY,
    workflowContext: WORKFLOW_CONTEXT,
  });
  assert.equal(feedbackResult.disposition, "repair-required");
  assert.deepEqual(feedbackResult.repairPacket?.permittedPaths, [
    "pnpm-lock.yaml",
  ]);
  assert.deepEqual(
    feedbackResult.repairPacket?.feedbackThreads.map(({ path, source }) => ({
      path,
      source,
    })),
    [{ path: "pnpm-lock.yaml", source: "claude" }],
  );
});

test("a typed Vercel follow-up keeps provider failures outside its Claude repair packet", () => {
  const finding = {
    line: 16_610,
    path: "pnpm-lock.yaml",
    summary:
      "The unrelated lockfile resolution changed and must retain the prior compatible version.",
    title: "Retain the prior transitive resolution",
  };
  for (const { baselineMode, expectedAttribution } of [
    {
      baselineMode: "passing",
      expectedAttribution: "non-deterministic",
    },
    {
      baselineMode: "failing",
      expectedAttribution: "provider-baseline",
    },
    {
      baselineMode: "missing",
      expectedAttribution: "provider-unbaselined",
    },
  ]) {
    const candidate = vercelAfterTypedRepair().repaired;
    candidate.checks = completeChecksWithClaudeFindings({
      conclusions: { "e2e-celo": "failure" },
      findings: [finding],
      headSha: OTHER_SHA,
    });
    if (baselineMode === "failing") {
      candidate.baseline.checks = candidate.baseline.checks.map((check) =>
        check.name === CHECK_NAMES["e2e-celo"]
          ? { ...check, conclusion: "failure" }
          : check,
      );
    } else if (baselineMode === "missing") {
      candidate.baseline.checks = candidate.baseline.checks.filter(
        ({ name }) => name !== CHECK_NAMES["e2e-celo"],
      );
    }

    const result = evaluateDependabotPullRequest(candidate, {
      mode: "prepare",
      repository: REPOSITORY,
      workflowContext: WORKFLOW_CONTEXT,
    });

    assert.equal(result.disposition, "repair-required", expectedAttribution);
    assert.deepEqual(
      result.checks.failures.map(({ attribution, id }) => ({
        attribution,
        id,
      })),
      [
        { attribution: expectedAttribution, id: "e2e-celo" },
        { attribution: "branch", id: "claude-review" },
      ],
      expectedAttribution,
    );
    assert.deepEqual(
      result.repairPacket?.failures.map(({ attribution, id }) => ({
        attribution,
        id,
      })),
      [{ attribution: "branch", id: "claude-review" }],
      expectedAttribution,
    );
    assert.deepEqual(
      result.repairPacket?.findings.map(({ path, source }) => ({
        path,
        source,
      })),
      [{ path: "pnpm-lock.yaml", source: "claude" }],
      expectedAttribution,
    );
  }
});

test("the protected-runtime carry-forward exception fails closed on unbound or broad repair input", () => {
  const finding = (path) => ({
    line: 12,
    path,
    summary: "The exact finding requires one bounded file repair.",
    title: "Repair the exact finding",
  });
  const evaluate = (
    candidate,
    { conclusions = {}, path = "pnpm-lock.yaml" } = {},
  ) => {
    candidate.checks = completeChecksWithClaudeFindings({
      conclusions,
      findings: [finding(path)],
      headSha: OTHER_SHA,
    });
    return evaluateDependabotPullRequest(candidate, {
      mode: "prepare",
      repository: REPOSITORY,
      workflowContext: WORKFLOW_CONTEXT,
    });
  };

  const allowed = evaluate(vercelAfterTypedRepair().repaired);
  const missingProof = structuredClone(allowed);
  missingProof.protectedRuntimeOperation.proof = null;
  assert.equal(createDependabotRepairPacket(missingProof), null);

  const missingLineageBinding = structuredClone(allowed);
  missingLineageBinding.repairAttempts.protectedRuntimeOperations = [];
  assert.equal(createDependabotRepairPacket(missingLineageBinding), null);

  const firstAttempt = structuredClone(allowed);
  firstAttempt.repairAttempt = 1;
  assert.equal(createDependabotRepairPacket(firstAttempt), null);

  const invalidCurrentAttempt = structuredClone(allowed);
  invalidCurrentAttempt.repairAttempts.currentAttempt = 3;
  assert.equal(createDependabotRepairPacket(invalidCurrentAttempt), null);

  const staleRuntimeState = structuredClone(allowed);
  staleRuntimeState.protectedRuntimeOperation.stateMatches = false;
  assert.equal(createDependabotRepairPacket(staleRuntimeState), null);

  const malformedProofDigest = structuredClone(allowed);
  malformedProofDigest.protectedRuntimeOperation.proof.packetDigest =
    "malformed";
  malformedProofDigest.repairAttempts.protectedRuntimeOperations[0].packetDigest =
    "malformed";
  assert.equal(createDependabotRepairPacket(malformedProofDigest), null);

  const extraRuntimePath = vercelAfterTypedRepair().repaired;
  const extraBlob = {
    filename: "scripts/other-runtime/config.json",
    mode: "100644",
    sha: "6".repeat(40),
    status: "modified",
    type: "blob",
  };
  extraRuntimePath.pullRequest.files.push(extraBlob);
  extraRuntimePath.expectedBlobs.push({
    mode: extraBlob.mode,
    path: extraBlob.filename,
    sha: extraBlob.sha,
    type: extraBlob.type,
  });
  const extraRuntimeResult = evaluate(extraRuntimePath);
  assert.equal(extraRuntimeResult.disposition, "manual-repair-required");
  assert.equal(extraRuntimeResult.repairPacket, null);

  for (const path of [
    ".gitmodules",
    "docs/vercel-deployments.md",
    "scripts/vercel-main-controller.mjs",
  ]) {
    const extraHardDeniedPath = vercelAfterTypedRepair().repaired;
    const hardDeniedBlob = {
      filename: path,
      mode: "100644",
      sha: createHash("sha1").update(path).digest("hex"),
      status: "modified",
      type: "blob",
    };
    extraHardDeniedPath.pullRequest.files.push(hardDeniedBlob);
    extraHardDeniedPath.expectedBlobs.push({
      mode: hardDeniedBlob.mode,
      path: hardDeniedBlob.filename,
      sha: hardDeniedBlob.sha,
      type: hardDeniedBlob.type,
    });
    const extraHardDeniedResult = evaluate(extraHardDeniedPath);
    assert.equal(
      extraHardDeniedResult.disposition,
      "manual-repair-required",
      path,
    );
    assert.equal(extraHardDeniedResult.repairPacket, null, path);
  }

  const protectedFinding = evaluate(vercelAfterTypedRepair().repaired, {
    path: "scripts/vercel-cli-runtime/package.json",
  });
  assert.equal(protectedFinding.disposition, "manual-repair-required");
  assert.equal(protectedFinding.repairPacket, null);

  const mixedFailure = evaluate(vercelAfterTypedRepair().repaired, {
    conclusions: { ci: "failure" },
  });
  assert.equal(mixedFailure.disposition, "manual-repair-required");
  assert.equal(mixedFailure.repairPacket, null);

  const baselineFailureCandidate = vercelAfterTypedRepair().repaired;
  const baselineCi = baselineFailureCandidate.baseline.checks.find(
    ({ name }) => name === CHECK_NAMES.ci,
  );
  baselineCi.conclusion = "failure";
  const baselineFailure = evaluate(baselineFailureCandidate, {
    conclusions: { ci: "failure" },
  });
  assert.deepEqual(
    baselineFailure.checks.failures.map(({ attribution, id }) => ({
      attribution,
      id,
    })),
    [
      { attribution: "baseline", id: "ci" },
      { attribution: "branch", id: "claude-review" },
    ],
  );
  assert.equal(baselineFailure.disposition, "waiting-baseline");
  assert.equal(baselineFailure.repairPacket, null);

  const absentEvidenceBlob = evaluate(vercelAfterTypedRepair().repaired, {
    path: "packages/ui/src/unrelated.ts",
  });
  assert.equal(absentEvidenceBlob.disposition, "manual-repair-required");
  assert.equal(absentEvidenceBlob.repairPacket, null);
});

test("the exact Cursor runtime mismatch is packet-bound to the typed Vercel sync", () => {
  const evaluateWithFeedback = (feedback) => {
    const candidate = vercelCliSnapshot();
    candidate.feedback = { ...candidate.feedback, ...feedback };
    return evaluateDependabotPullRequest(candidate, {
      mode: "prepare",
      repository: REPOSITORY,
      workflowContext: WORKFLOW_CONTEXT,
    });
  };

  const exact = evaluateWithFeedback(vercelRuntimeSyncCursorFeedback());
  assert.equal(exact.disposition, "repair-required");
  assert.equal(
    exact.repairPacket?.schema,
    DEPENDABOT_PROTECTED_RUNTIME_REPAIR_PACKET_SCHEMA,
  );
  assert.deepEqual(exact.repairPacket?.feedbackThreads, [
    {
      commentId: 11,
      commitSha: HEAD_SHA,
      digest: exact.feedback.actionableThreads[0].bodyDigest,
      line: 77,
      path: "package.json",
      source: "cursor",
      threadId: "thread-vercel-runtime-sync",
    },
  ]);

  const wrongSource = structuredClone(vercelRuntimeSyncCursorFeedback());
  wrongSource.actionableThreads[0].source = "claude";
  const wrongCommit = structuredClone(vercelRuntimeSyncCursorFeedback());
  wrongCommit.actionableThreads[0].reviewCommitSha = OTHER_SHA;
  for (const feedback of [
    vercelRuntimeSyncCursorFeedback({
      body: vercelRuntimeSyncCursorBody({ targetVersion: "56.5.1" }),
    }),
    vercelRuntimeSyncCursorFeedback({
      body: "### Different package.json finding",
    }),
    wrongSource,
    wrongCommit,
  ]) {
    const blocked = evaluateWithFeedback(feedback);
    assert.equal(blocked.disposition, "manual-repair-required");
    assert.equal(blocked.repairPacket, null);
  }
});

test("typed Vercel sync fails closed when another actionable thread is present", () => {
  const mixedFeedback = classifyDependabotFeedback({
    headSha: HEAD_SHA,
    reviews: [cursorReview(HEAD_SHA, 2)],
    threads: [
      {
        comments: [
          {
            actor: { association: "NONE", login: "cursor", type: "Bot" },
            body: vercelRuntimeSyncCursorBody(),
            createdAt: "2026-08-10T10:00:00Z",
            id: 11,
            replyToId: null,
            reviewCommitSha: HEAD_SHA,
            reviewId: 21,
          },
        ],
        id: "thread-vercel-runtime-sync",
        line: 77,
        outdated: false,
        path: "package.json",
        resolved: false,
      },
      {
        comments: [
          {
            actor: { association: "NONE", login: "cursor", type: "Bot" },
            body: "### Unrelated package.json finding",
            createdAt: "2026-08-10T10:01:00Z",
            id: 12,
            replyToId: null,
            reviewCommitSha: HEAD_SHA,
            reviewId: 21,
          },
        ],
        id: "thread-unrelated-finding",
        line: 78,
        outdated: false,
        path: "package.json",
        resolved: false,
      },
    ],
  });
  const candidate = vercelCliSnapshot();
  candidate.feedback = { ...candidate.feedback, ...mixedFeedback };

  const result = evaluateDependabotPullRequest(candidate, {
    mode: "prepare",
    repository: REPOSITORY,
    workflowContext: WORKFLOW_CONTEXT,
  });

  assert.equal(result.feedback.actionableThreadCount, 2);
  assert.equal(result.disposition, "manual-repair-required");
  assert.equal(result.repairPacket, null);
});

test("typed Vercel sync remediates its seed-bound Cursor thread after refresh", async () => {
  const headRef = "dependabot/npm_and_yarn/vercel-cli-986014f9a1";
  const requestCheck = refreshReceiptCheck("requested", { headRef });
  const completedCheck = refreshReceiptCheck("completed", { headRef });
  const sourceFeedback = vercelRuntimeSyncCursorFeedback();
  const refreshed = vercelCliSnapshot({
    commits: [
      {
        authorLogin: "dependabot[bot]",
        committerLogin: "dependabot[bot]",
        sha: HEAD_SHA,
        verified: true,
      },
      {
        authorId: PREPARE_ACTOR.botId,
        authorLogin: PREPARE_ACTOR.botLogin,
        authorType: "Bot",
        ...GITHUB_SYSTEM_COMMITTER,
        parents: [HEAD_SHA, BASE_SHA],
        sha: OTHER_SHA,
        verified: true,
        verificationReason: "valid",
      },
    ],
    headSha: OTHER_SHA,
    repairHistoryChecks: [requestCheck, completedCheck],
  });
  refreshed.feedback = { ...refreshed.feedback, ...sourceFeedback };

  const unboundReview = structuredClone(refreshed);
  unboundReview.feedback.actionableThreads[0].reviewCommitSha = SECOND_HEAD_SHA;
  const blocked = evaluateDependabotPullRequest(unboundReview, {
    mode: "prepare",
    repository: REPOSITORY,
    workflowContext: WORKFLOW_CONTEXT,
  });
  assert.equal(blocked.disposition, "manual-repair-required");
  assert.equal(blocked.repairPacket, null);

  const selected = evaluateDependabotPullRequest(refreshed, {
    mode: "prepare",
    repository: REPOSITORY,
    workflowContext: WORKFLOW_CONTEXT,
  });
  assert.equal(selected.disposition, "repair-required");
  assert.equal(
    selected.repairPacket?.schema,
    DEPENDABOT_PROTECTED_RUNTIME_REPAIR_PACKET_SCHEMA,
  );
  assert.equal(selected.repairPacket?.operation.sourceSeedHeadSha, HEAD_SHA);
  assert.equal(selected.repairPacket?.feedbackThreads[0].commitSha, HEAD_SHA);

  const packetCheck = processorRepairReceipt(1, {
    headSha: OTHER_SHA,
    id: 10_401,
    packet: selected.repairPacket,
    packetEncoding: "canonical",
  });
  const repairCheck = repairReceiptCheck({
    attempt: 1,
    headRef,
    headSha: SECOND_HEAD_SHA,
    id: 30_401,
    packetDigest: rawDigest(packetCheck.outputText),
    parentHeadSha: OTHER_SHA,
    processorCheckId: packetCheck.id,
  });
  const repaired = vercelCliSnapshot({
    commits: [
      refreshed.commits[0],
      refreshed.commits[1],
      preparedCommit(SECOND_HEAD_SHA, OTHER_SHA),
    ],
    contractVersion: "56.5.0",
    headSha: SECOND_HEAD_SHA,
    repairHistoryChecks: [
      requestCheck,
      completedCheck,
      packetCheck,
      repairCheck,
    ],
    runtimeVersion: "56.5.0",
  });
  repaired.feedback = { ...repaired.feedback, ...sourceFeedback };

  const remediationProbe = evaluateDependabotPullRequest(repaired, {
    mode: "prepare",
    repository: REPOSITORY,
    workflowContext: WORKFLOW_CONTEXT,
  });
  assert.equal(
    remediationProbe.disposition,
    "feedback-remediation-required",
    stableJson({
      feedback: remediationProbe.feedback,
      identity: remediationProbe.identity,
      repairAttempts: remediationProbe.repairAttempts,
    }),
  );

  const replies = [];
  const resolved = [];
  const result = await processDependabotSweep({
    adapter: {
      approvePullRequest: async () =>
        assert.fail("feedback remediation must re-review before approval"),
      collectPullRequestSnapshot: async () => repaired,
      dismissPullRequestApproval: async () => {},
      getOutstandingDependabotAutoMergeRequests: async () => [],
      getOutstandingDependabotProcessorApprovals:
        noOutstandingProcessorApprovals,
      publishAllClear: async () =>
        assert.fail("feedback remediation must not publish ALL CLEAR"),
      publishAllClearInvalidation: async () => {},
      publishProcessorCheck: async () => ({ id: 53_401 }),
      replyToReviewComment: async (input) => replies.push(input),
      resolveReviewThread: async ({ threadId }) => resolved.push(threadId),
    },
    input: {
      mode: "prepare",
      outstandingAutoMergeRequests: [],
      pullRequests: [repaired],
      repository: REPOSITORY,
      workflowContext: WORKFLOW_CONTEXT,
    },
    phase: "finalize",
    publishChecks: true,
    workflowContext: WORKFLOW_CONTEXT,
  });

  assert.equal(replies.length, 1);
  assert.equal(replies[0].commentId, 11);
  assert.match(replies[0].body, /^Fixed in 555555555555/);
  assert.match(
    replies[0].body,
    new RegExp(`packet=${rawDigest(packetCheck.outputText)}`),
  );
  assert.deepEqual(resolved, ["thread-vercel-runtime-sync"]);
  assert.deepEqual(
    result.mutations.filter(({ kind }) => kind === "feedback-remediated"),
    [
      {
        headSha: SECOND_HEAD_SHA,
        kind: "feedback-remediated",
        pullRequestNumber: 123,
        threadId: "thread-vercel-runtime-sync",
      },
    ],
  );
});

test("a reachable typed Vercel receipt and exact target state permit preparation", async () => {
  const legacy = vercelAfterLegacyRepair();
  const selected = evaluateDependabotPullRequest(legacy.snapshot, {
    mode: "prepare",
    repository: REPOSITORY,
    workflowContext: WORKFLOW_CONTEXT,
  });
  assert.notEqual(selected.repairPacket, null);
  const processorCheck = processorRepairReceipt(2, {
    headSha: OTHER_SHA,
    id: 10_002,
    packet: selected.repairPacket,
    packetEncoding: "canonical",
  });
  const repairCheck = repairReceiptCheck({
    attempt: 2,
    headRef: "dependabot/npm_and_yarn/tooling-31c5cf6265",
    headSha: SECOND_HEAD_SHA,
    id: 30_002,
    packetDigest: rawDigest(processorCheck.outputText),
    parentHeadSha: OTHER_SHA,
    processorCheckId: processorCheck.id,
  });
  const prepared = vercelSnapshot({
    commits: [
      {
        authorLogin: "dependabot[bot]",
        committerLogin: "dependabot[bot]",
        sha: HEAD_SHA,
        verified: true,
      },
      preparedCommit(OTHER_SHA, HEAD_SHA),
      preparedCommit(SECOND_HEAD_SHA, OTHER_SHA),
    ],
    headSha: SECOND_HEAD_SHA,
    protectedVersion: "56.5.0",
    repairHistoryChecks: [
      legacy.processorCheck,
      legacy.repairCheck,
      processorCheck,
      repairCheck,
    ],
  });
  const currentRunStatus = processorRepairReceipt(3, {
    headSha: SECOND_HEAD_SHA,
    id: 10_003,
    packet: false,
  });
  currentRunStatus.runConclusion = null;
  currentRunStatus.runStatus = "in_progress";
  prepared.checks.push(currentRunStatus);
  prepared.repairHistoryChecks.push(currentRunStatus);
  const result = evaluateDependabotPullRequest(prepared, {
    mode: "prepare",
    repository: REPOSITORY,
    workflowContext: WORKFLOW_CONTEXT,
  });

  assert.equal(result.disposition, "prepare-candidate");
  assert.equal(result.repairPacket, null);
  assert.equal(result.repairAttempts.currentAttempt, 3);
  assert.deepEqual(result.repairAttempts.protectedRuntimeOperations, [
    {
      operation: selected.repairPacket.operation,
      operationDigest: digest(
        repairCheck.outputText ? JSON.parse(repairCheck.outputText) : null,
      ),
      packetDigest: rawDigest(processorCheck.outputText),
    },
  ]);

  let approved = false;
  let allClearReceipt = null;
  const currentSnapshot = () => {
    const current = structuredClone(prepared);
    if (approved) withCurrentProcessorApproval(current);
    return current;
  };
  await processDependabotSweep({
    adapter: {
      approvePullRequest: async () => {
        approved = true;
        return processorApprovalResult();
      },
      collectPullRequestSnapshot: async () => currentSnapshot(),
      dismissPullRequestApproval: async () =>
        assert.fail("the protected runtime candidate must remain approved"),
      getOutstandingDependabotAutoMergeRequests: async () => [],
      getOutstandingDependabotProcessorApprovals: async () =>
        approved
          ? [
              {
                approvalId: 7001,
                headSha: SECOND_HEAD_SHA,
                pullRequestNumber: 123,
              },
            ]
          : [],
      publishAllClear: async ({ receipt }) => {
        allClearReceipt = receipt;
        return { id: 50_002 };
      },
      publishAllClearInvalidation: async () =>
        assert.fail("the protected runtime candidate must not be invalidated"),
      publishProcessorCheck: async () => ({ id: 50_001 }),
    },
    input: {
      mode: "prepare",
      outstandingAutoMergeRequests: [],
      pullRequests: [prepared],
      repository: REPOSITORY,
      workflowContext: WORKFLOW_CONTEXT,
    },
    phase: "finalize",
    publishChecks: true,
    workflowContext: WORKFLOW_CONTEXT,
  });
  assert.deepEqual(
    allClearReceipt?.preparation.protectedRuntimeOperations,
    result.repairAttempts.protectedRuntimeOperations,
  );
  const mismatchedSeedReceipt = structuredClone(allClearReceipt);
  mismatchedSeedReceipt.preparation.protectedRuntimeOperations[0].operation.sourceSeedHeadSha =
    OTHER_SHA;
  assert.equal(
    parseDependabotAllClearReceipt(
      trustedReceiptCheck({
        externalId: `${DEPENDABOT_ALL_CLEAR_SCHEMA}:pr=123:head=${SECOND_HEAD_SHA}:base=${BASE_SHA}:digest=${digest(mismatchedSeedReceipt)}:run=${WORKFLOW_CONTEXT.workflowRunId}:attempt=${WORKFLOW_CONTEXT.workflowRunAttempt}`,
        headSha: SECOND_HEAD_SHA,
        id: 50_003,
        name: "Dependabot ALL CLEAR",
        receipt: mismatchedSeedReceipt,
        workflowContext: WORKFLOW_CONTEXT,
        workflowPath: ".github/workflows/dependabot-process.yml",
      }),
      REPOSITORY,
    ),
    null,
  );
});

test("Vercel runtime sync waits for gates and fails closed on unsafe inputs", () => {
  const pending = vercelSnapshot();
  pending.checks = completeChecks().slice(0, -1);
  assert.equal(
    evaluateDependabotPullRequest(pending, {
      mode: "prepare",
      repository: REPOSITORY,
      workflowContext: WORKFLOW_CONTEXT,
    }).disposition,
    "waiting-checks",
  );
  const retry = vercelSnapshot();
  retry.checks = completeChecks({ conclusions: { "e2e-celo": "failure" } });
  assert.equal(
    evaluateDependabotPullRequest(retry, {
      mode: "prepare",
      repository: REPOSITORY,
      workflowContext: WORKFLOW_CONTEXT,
    }).disposition,
    "waiting-retry",
  );

  for (const metadata of [
    vercelMetadata({ vercelTo: "57.0.0" }),
    vercelMetadata({ vercelTo: "56.5.0-rc.1" }),
    vercelMetadata({ duplicateVercel: true }),
  ]) {
    const result = evaluateDependabotPullRequest(vercelSnapshot({ metadata }), {
      mode: "prepare",
      repository: REPOSITORY,
      workflowContext: WORKFLOW_CONTEXT,
    });
    assert.equal(result.disposition, "manual-repair-required");
    assert.equal(result.repairPacket, null);
  }

  const missingBlob = vercelSnapshot();
  missingBlob.expectedBlobs = missingBlob.expectedBlobs.slice(1);
  const missingResult = evaluateDependabotPullRequest(missingBlob, {
    mode: "prepare",
    repository: REPOSITORY,
    workflowContext: WORKFLOW_CONTEXT,
  });
  assert.equal(missingResult.disposition, "manual-repair-required");
  assert.equal(missingResult.repairPacket, null);

  const legacy = vercelAfterLegacyRepair();
  const secondPacket = {
    ...legacy.legacyPacket,
    attemptNumber: 2,
    headSha: OTHER_SHA,
  };
  const secondProcessorCheck = processorRepairReceipt(2, {
    headSha: OTHER_SHA,
    id: 10_002,
    packet: secondPacket,
    packetEncoding: "canonical",
  });
  const secondRepairCheck = repairReceiptCheck({
    attempt: 2,
    headRef: "dependabot/npm_and_yarn/tooling-31c5cf6265",
    headSha: SECOND_HEAD_SHA,
    id: 30_002,
    packetDigest: rawDigest(secondProcessorCheck.outputText),
    parentHeadSha: OTHER_SHA,
    processorCheckId: secondProcessorCheck.id,
  });
  const exhausted = evaluateDependabotPullRequest(
    vercelSnapshot({
      commits: [
        {
          authorLogin: "dependabot[bot]",
          committerLogin: "dependabot[bot]",
          sha: HEAD_SHA,
          verified: true,
        },
        preparedCommit(OTHER_SHA, HEAD_SHA),
        preparedCommit(SECOND_HEAD_SHA, OTHER_SHA),
      ],
      headSha: SECOND_HEAD_SHA,
      repairHistoryChecks: [
        legacy.processorCheck,
        legacy.repairCheck,
        secondProcessorCheck,
        secondRepairCheck,
      ],
    }),
    {
      mode: "prepare",
      repository: REPOSITORY,
      workflowContext: WORKFLOW_CONTEXT,
    },
  );
  assert.equal(exhausted.repairAttempts.currentAttempt, 3);
  assert.equal(exhausted.disposition, "manual-repair-escalated");
  assert.equal(exhausted.repairPacket, null);
});

test("constructed repair packets fail closed when schema-invalid or oversized", () => {
  const repair = evaluateDependabotPullRequest(
    snapshot({ checks: completeChecks({ conclusions: { ci: "failure" } }) }),
    {
      mode: "prepare",
      repository: REPOSITORY,
      workflowContext: WORKFLOW_CONTEXT,
    },
  );
  assert.notEqual(repair.repairPacket, null);

  assert.equal(
    createDependabotRepairPacket({ ...repair, baseRef: "release" }),
    null,
  );

  const oversizedPaths = Array.from(
    { length: 300 },
    (_, index) =>
      `packages/${String(index).padStart(3, "0")}/${"a".repeat(270)}.ts`,
  );
  assert.ok(
    stableJson({ ...repair.repairPacket, changedPaths: oversizedPaths })
      .length > 50_000,
  );
  assert.equal(
    createDependabotRepairPacket({ ...repair, changedPaths: oversizedPaths }),
    null,
  );
});

test("workflow-path Actions failures require manual repair while green updates remain preparable", () => {
  const workflowFile = {
    filename: ".github/workflows/ci.yml",
    mode: "100644",
    sha: OTHER_SHA,
    type: "blob",
  };
  const failing = evaluateDependabotPullRequest(
    snapshot({
      checks: completeChecks({ conclusions: { ci: "failure" } }),
      pullRequest: { files: [workflowFile] },
    }),
    {
      mode: "prepare",
      repository: REPOSITORY,
      workflowContext: WORKFLOW_CONTEXT,
    },
  );
  assert.equal(failing.risk.preparable, true);
  assert.equal(failing.disposition, "manual-repair-required");
  assert.equal(failing.repairPacket, null);

  const green = evaluateDependabotPullRequest(
    snapshot({ pullRequest: { files: [workflowFile] } }),
    {
      mode: "prepare",
      repository: REPOSITORY,
      workflowContext: WORKFLOW_CONTEXT,
    },
  );
  assert.equal(green.disposition, "prepare-candidate");
});

test("a legacy same-head packet is replaced canonically once before the lane becomes pending", async () => {
  const replacementWorkflowContext = {
    ...WORKFLOW_CONTEXT,
    workflowRunId: WORKFLOW_CONTEXT.workflowRunId + 1,
  };
  const laterWorkflowContext = {
    ...WORKFLOW_CONTEXT,
    workflowRunId: WORKFLOW_CONTEXT.workflowRunId + 2,
  };
  const current = snapshot({
    checks: completeChecks({ conclusions: { ci: "failure" } }),
  });
  const initial = evaluateDependabotPullRequest(current, {
    mode: "prepare",
    repository: REPOSITORY,
    workflowContext: WORKFLOW_CONTEXT,
  });
  assert.equal(initial.disposition, "repair-required");
  assert.notEqual(initial.repairPacket, null);

  const legacyCheck = processorRepairReceipt(1, {
    id: 60_001,
    packet: initial.repairPacket,
  });
  legacyCheck.outputSummary = "Disposition: repair-required";
  assert.equal(
    parseDependabotProcessorReceipt(legacyCheck, REPOSITORY)?.packetCanonical,
    false,
  );
  current.checks.push(legacyCheck);
  current.repairHistoryChecks = [legacyCheck];

  const beforeReplacement = evaluateDependabotSweep({
    mode: "prepare",
    outstandingAutoMergeRequests: [],
    pullRequests: [current],
    repository: REPOSITORY,
    workflowContext: replacementWorkflowContext,
  });
  assert.equal(
    beforeReplacement.evaluations[0].repairAttempts.currentHeadPacketIssued,
    false,
  );
  assert.equal(beforeReplacement.evaluations[0].disposition, "repair-required");
  assert.notEqual(beforeReplacement.evaluations[0].repairPacket, null);

  const published = [];
  const adapter = {
    collectPullRequestSnapshot: async () => structuredClone(current),
    getOutstandingDependabotAutoMergeRequests: async () => [],
    getOutstandingDependabotProcessorApprovals: noOutstandingProcessorApprovals,
    publishProcessorCheck: async (input) => {
      published.push(input);
      return { id: 60_002 };
    },
  };
  const replacement = await processDependabotSweep({
    adapter,
    input: {
      mode: "prepare",
      outstandingAutoMergeRequests: [],
      pullRequests: [structuredClone(current)],
      repository: REPOSITORY,
      workflowContext: replacementWorkflowContext,
    },
    phase: "finalize",
    publishChecks: true,
    workflowContext: replacementWorkflowContext,
  });
  assert.equal(published.length, 1);
  assert.equal(published[0].disposition, "repair-required");
  assert.equal(
    published[0].repairPacket.workflowRunId,
    replacementWorkflowContext.workflowRunId,
  );
  assert.deepEqual(
    replacement.mutations.map(({ kind }) => kind),
    ["repair-packet-published"],
  );

  const canonicalCheck = processorRepairReceipt(1, {
    id: 60_002,
    packet: published[0].repairPacket,
    packetEncoding: "canonical",
    workflowContext: replacementWorkflowContext,
  });
  canonicalCheck.outputSummary = "Disposition: repair-required";
  assert.equal(
    parseDependabotProcessorReceipt(canonicalCheck, REPOSITORY)
      ?.packetCanonical,
    true,
  );
  current.checks.push(canonicalCheck);
  current.repairHistoryChecks.push(canonicalCheck);

  for (let run = 0; run < 2; run += 1) {
    const workflowContext = {
      ...laterWorkflowContext,
      workflowRunId: laterWorkflowContext.workflowRunId + run,
    };
    const result = await processDependabotSweep({
      adapter,
      input: {
        mode: "prepare",
        outstandingAutoMergeRequests: [],
        pullRequests: [structuredClone(current)],
        repository: REPOSITORY,
        workflowContext,
      },
      phase: "finalize",
      publishChecks: true,
      workflowContext,
    });
    assert.equal(result.prepareCandidate.disposition, "repair-pending");
    assert.equal(result.evaluations[0].repairPacket, null);
    assert.deepEqual(result.mutations, []);
  }
  assert.equal(published.length, 1);
  assert.equal(
    current.checks.filter(({ name }) => name === "Dependabot Processor").length,
    2,
  );
});

test("a canonical same-head repair packet occupies the lane without republishing", async () => {
  const current = snapshot({
    checks: completeChecks({ conclusions: { ci: "failure" } }),
  });
  const first = evaluateDependabotPullRequest(current, {
    mode: "prepare",
    repository: REPOSITORY,
    workflowContext: WORKFLOW_CONTEXT,
  });
  assert.equal(first.disposition, "repair-required");
  assert.notEqual(first.repairPacket, null);

  const packetCheck = processorRepairReceipt(1, {
    id: 61_001,
    packet: first.repairPacket,
    packetEncoding: "canonical",
  });
  packetCheck.outputSummary = "Disposition: repair-required";
  assert.equal(
    parseDependabotProcessorReceipt(packetCheck, REPOSITORY)?.packetCanonical,
    true,
  );
  current.checks.push(packetCheck);
  current.repairHistoryChecks = [packetCheck];
  const repeated = evaluateDependabotSweep({
    mode: "prepare",
    outstandingAutoMergeRequests: [],
    pullRequests: [current],
    repository: REPOSITORY,
    workflowContext: WORKFLOW_CONTEXT,
  });
  assert.equal(repeated.evaluations[0].disposition, "repair-pending");
  assert.equal(repeated.evaluations[0].repairPacket, null);
  assert.equal(repeated.prepareCandidate.disposition, "repair-pending");

  let published = 0;
  const adapter = {
    collectPullRequestSnapshot: async () => structuredClone(current),
    getOutstandingDependabotAutoMergeRequests: async () => [],
    getOutstandingDependabotProcessorApprovals: noOutstandingProcessorApprovals,
    publishAllClearInvalidation: async () => {},
    publishProcessorCheck: async () => {
      published += 1;
      return { id: 61_002 };
    },
  };
  for (let sweep = 0; sweep < 2; sweep += 1) {
    const result = await processDependabotSweep({
      adapter,
      input: {
        mode: "prepare",
        outstandingAutoMergeRequests: [],
        pullRequests: [structuredClone(current)],
        repository: REPOSITORY,
        workflowContext: WORKFLOW_CONTEXT,
      },
      phase: "finalize",
      publishChecks: true,
      workflowContext: WORKFLOW_CONTEXT,
    });
    assert.equal(result.prepareCandidate.disposition, "repair-pending");
    assert.deepEqual(result.mutations, []);
  }
  assert.equal(published, 0);
  assert.equal(
    current.checks.filter(({ name }) => name === "Dependabot Processor").length,
    1,
  );
});

test("durable force-push evidence removes preparation and repair authority", async () => {
  const rewritten = snapshot({
    checks: completeChecks({ conclusions: { ci: "failure" } }),
    feedback: {
      forcePushActors: ["dependabot[bot]", "unknown-actor"],
      forcePushCommitIds: [OTHER_SHA],
      forcePushEventCount: 2,
      forcePushed: true,
    },
    repairHistoryChecks: [],
  });
  const evaluation = evaluateDependabotPullRequest(rewritten, {
    mode: "prepare",
    repository: REPOSITORY,
    workflowContext: WORKFLOW_CONTEXT,
  });
  assert.equal(evaluation.identity.prepareAuthority, false);
  assert.deepEqual(evaluation.identity.automaticAuthorityReasons, [
    "pull-request-history-force-pushed",
  ]);
  assert.equal(evaluation.disposition, "manual-veto-or-feedback");
  assert.equal(evaluation.repairPacket, null);

  let approved = false;
  const result = await processDependabotSweep({
    adapter: {
      approvePullRequest: async () => {
        approved = true;
      },
      collectPullRequestSnapshot: async () => rewritten,
      getOutstandingDependabotAutoMergeRequests: async () => [],
      getOutstandingDependabotProcessorApprovals:
        noOutstandingProcessorApprovals,
    },
    input: {
      mode: "prepare",
      outstandingAutoMergeRequests: [],
      pullRequests: [rewritten],
      repository: REPOSITORY,
      workflowContext: WORKFLOW_CONTEXT,
    },
    workflowContext: WORKFLOW_CONTEXT,
  });
  assert.equal(result.mergeCandidate, null);
  assert.equal(result.prepareCandidate, null);
  assert.equal(approved, false);
});

test("a verified native Dependabot rewrite starts a new preparation generation", () => {
  const rewritten = snapshot({
    checks: completeChecks({ conclusions: { ci: "failure" } }),
    commits: [nativeDependabotCommit(HEAD_SHA)],
    feedback: nativeForcePushFeedback(),
    metadata: {
      ...snapshot().metadata,
      immutableEvidence: {
        ...snapshot().metadata.immutableEvidence,
        seedCommitSha: HEAD_SHA,
        seedCommitTrusted: true,
      },
    },
    pullRequest: {
      author: DEPENDABOT_ACTOR,
    },
    repairHistoryChecks: [],
  });
  const evaluation = evaluateDependabotPullRequest(rewritten, {
    mode: "prepare",
    repository: REPOSITORY,
    workflowContext: WORKFLOW_CONTEXT,
  });

  assert.equal(evaluation.feedback.forcePushGenerationKind, "native");
  assert.equal(evaluation.feedback.forcePushVeto, false);
  assert.equal(evaluation.feedback.clear, true);
  assert.equal(evaluation.identity.valid, true);
  assert.equal(evaluation.identity.prepareAuthority, true);
  assert.equal(evaluation.identity.automaticSeedHeadSha, HEAD_SHA);
  assert.equal(evaluation.repairAttempts.currentAttempt, 1);
  assert.equal(evaluation.disposition, "repair-required");
  assert.notEqual(evaluation.repairPacket, null);
});

test("a continuous Dependabot rewrite accepts equal-resolution event times", () => {
  const feedback = nativeForcePushFeedback();
  feedback.forcePushEventCount = 2;
  feedback.forcePushEvents = [
    {
      ...feedback.forcePushEvents[0],
      afterSha: SECOND_HEAD_SHA,
      createdAt: "2026-08-10T08:00:00Z",
    },
    {
      ...feedback.forcePushEvents[0],
      beforeSha: SECOND_HEAD_SHA,
      createdAt: "2026-08-10T08:00:00Z",
      eventId: "force-push-event-2",
    },
  ];
  feedback.forcePushCommits = [
    nativeDependabotCommit(OTHER_SHA, MERGE_SHA),
    nativeDependabotCommit(SECOND_HEAD_SHA),
    nativeDependabotCommit(HEAD_SHA),
  ];
  const rewritten = snapshot({
    checks: completeChecks({ conclusions: { ci: "failure" } }),
    commits: [nativeDependabotCommit(HEAD_SHA)],
    feedback,
    metadata: {
      ...snapshot().metadata,
      immutableEvidence: {
        ...snapshot().metadata.immutableEvidence,
        seedCommitSha: HEAD_SHA,
        seedCommitTrusted: true,
      },
    },
    pullRequest: { author: DEPENDABOT_ACTOR },
    repairHistoryChecks: [],
  });
  const evaluation = evaluateDependabotPullRequest(rewritten, {
    mode: "prepare",
    repository: REPOSITORY,
    workflowContext: WORKFLOW_CONTEXT,
  });

  assert.equal(evaluation.feedback.forcePushGenerationKind, "native");
  assert.equal(evaluation.feedback.forcePushVeto, false);
  assert.equal(evaluation.feedback.clear, true);
  assert.equal(evaluation.identity.prepareAuthority, true);
  assert.equal(evaluation.disposition, "repair-required");
  assert.notEqual(evaluation.repairPacket, null);
});

test("an exact trusted recreate starts a native generation after poisoned history", () => {
  const feedback = nativeForcePushFeedback();
  feedback.branchMaintenanceComments = [
    {
      actor: { association: "MEMBER", login: "alice", type: "User" },
      body: "@dependabot recreate",
      createdAt: "2026-08-10T09:00:00Z",
      id: 41,
      updatedAt: "2026-08-10T09:00:00Z",
    },
  ];
  feedback.forcePushEventCount = 2;
  feedback.forcePushEvents = [
    {
      ...feedback.forcePushEvents[0],
      afterSha: SECOND_HEAD_SHA,
      createdAt: "2026-08-10T08:00:00Z",
    },
    {
      ...feedback.forcePushEvents[0],
      beforeSha: MERGE_SHA,
      createdAt: "2026-08-10T10:00:00Z",
      eventId: "force-push-event-2",
    },
  ];
  feedback.forcePushCommits = [
    nativeDependabotCommit(OTHER_SHA, MERGE_SHA),
    nativeDependabotCommit(SECOND_HEAD_SHA),
    preparedCommit(MERGE_SHA, BASE_SHA),
    nativeDependabotCommit(HEAD_SHA),
  ];
  const rewritten = snapshot({
    checks: completeChecks({ conclusions: { ci: "failure" } }),
    commits: [nativeDependabotCommit(HEAD_SHA)],
    feedback,
    metadata: {
      ...snapshot().metadata,
      immutableEvidence: {
        ...snapshot().metadata.immutableEvidence,
        seedCommitSha: HEAD_SHA,
        seedCommitTrusted: true,
      },
    },
    pullRequest: { author: DEPENDABOT_ACTOR },
    repairHistoryChecks: [],
  });

  const evaluation = evaluateDependabotPullRequest(rewritten, {
    mode: "prepare",
    repository: REPOSITORY,
    workflowContext: WORKFLOW_CONTEXT,
  });
  assert.equal(evaluation.feedback.forcePushGenerationKind, "native");
  assert.equal(evaluation.feedback.forcePushVeto, false);
  assert.equal(evaluation.identity.prepareAuthority, true);
  assert.equal(evaluation.disposition, "repair-required");

  const invalidBoundaries = [
    [
      "rebase command",
      (current) => {
        current.feedback.branchMaintenanceComments[0].body =
          "@dependabot rebase";
      },
    ],
    [
      "comment edited after rewrite",
      (current) => {
        current.feedback.branchMaintenanceComments[0].updatedAt =
          "2026-08-10T11:00:00Z";
      },
    ],
    [
      "equal-resolution rewrite before a later rewrite",
      (current) => {
        current.feedback.forcePushEventCount = 3;
        current.feedback.forcePushEvents[1].createdAt = "2026-08-10T09:00:00Z";
        current.feedback.forcePushEvents[1].afterSha = SECOND_HEAD_SHA;
        current.feedback.forcePushEvents.push({
          ...current.feedback.forcePushEvents[1],
          afterSha: HEAD_SHA,
          beforeSha: SECOND_HEAD_SHA,
          createdAt: "2026-08-10T10:00:00Z",
          eventId: "force-push-event-3",
        });
      },
    ],
    [
      "untrusted commenter",
      (current) => {
        current.feedback.branchMaintenanceComments[0].actor.association =
          "NONE";
      },
    ],
    [
      "non-Dependabot destination event",
      (current) => {
        current.feedback.forcePushEvents[1].actorId = 7;
        current.feedback.forcePushEvents[1].actorLogin = "alice";
        current.feedback.forcePushEvents[1].actorType = "User";
      },
    ],
  ];
  for (const [label, mutate] of invalidBoundaries) {
    const current = structuredClone(rewritten);
    mutate(current);
    const rejected = evaluateDependabotPullRequest(current, {
      mode: "prepare",
      repository: REPOSITORY,
      workflowContext: WORKFLOW_CONTEXT,
    });
    assert.equal(rejected.feedback.forcePushVeto, true, label);
    assert.equal(rejected.identity.prepareAuthority, false, label);
    assert.equal(rejected.disposition, "manual-veto-or-feedback", label);
  }

  const boundaryReplay = structuredClone(rewritten);
  boundaryReplay.feedback.forcePushEventCount = 3;
  boundaryReplay.feedback.forcePushEvents.push({
    ...boundaryReplay.feedback.forcePushEvents[1],
    afterSha: MERGE_SHA,
    beforeSha: HEAD_SHA,
    createdAt: "2026-08-10T11:00:00Z",
    eventId: "force-push-event-3",
  });
  const replayed = evaluateDependabotPullRequest(boundaryReplay, {
    mode: "prepare",
    repository: REPOSITORY,
    workflowContext: WORKFLOW_CONTEXT,
  });
  assert.equal(replayed.feedback.forcePushVeto, true);
  assert.ok(
    replayed.feedback.forcePushGenerationReasons.includes(
      "invalid-force-push-event-chain",
    ),
  );
});

test("human, spoofed, malformed, mixed, and unbound rewrites remain vetoed", () => {
  const baseFeedback = nativeForcePushFeedback();
  const cases = [
    {
      expectedReason: "invalid-force-push-event-chain",
      label: "human actor",
      mutate(feedback) {
        feedback.forcePushEvents[0].actorId = 7;
        feedback.forcePushEvents[0].actorLogin = "alice";
        feedback.forcePushEvents[0].actorType = "User";
      },
    },
    {
      expectedReason: "invalid-force-push-event-chain",
      label: "Dependabot login with the wrong ID",
      mutate(feedback) {
        feedback.forcePushEvents[0].actorId = 7;
      },
    },
    {
      expectedReason: "invalid-force-push-event-chain",
      label: "Dependabot ID with the wrong actor type",
      mutate(feedback) {
        feedback.forcePushEvents[0].actorType = "User";
      },
    },
    {
      expectedReason: "invalid-force-push-event-chain",
      label: "malformed destination",
      mutate(feedback) {
        feedback.forcePushEvents[0].afterSha = "malformed";
      },
    },
    {
      expectedReason: "invalid-force-push-generation-seed",
      label: "latest destination does not bind the seed",
      mutate(feedback) {
        feedback.forcePushEvents[0].afterSha = SECOND_HEAD_SHA;
      },
    },
    {
      expectedReason: "incomplete-force-push-event-census",
      label: "incomplete event census",
      mutate(feedback) {
        feedback.forcePushEventCount = 2;
      },
    },
    {
      expectedReason: "invalid-force-push-event-chain",
      label: "wrong branch ref",
      mutate(feedback) {
        feedback.forcePushEvents[0].headRef =
          "refs/heads/dependabot/npm_and_yarn/other";
      },
    },
    {
      expectedReason: "invalid-force-push-commit-census",
      label: "untrusted historical commit",
      mutate(feedback) {
        feedback.forcePushCommits[0].verificationReason = "unknown_key";
      },
    },
    {
      expectedReason: "invalid-force-push-commit-census",
      label: "missing historical commit census",
      mutate(feedback) {
        feedback.forcePushCommits.pop();
      },
    },
    {
      expectedReason: "invalid-force-push-commit-census",
      label: "Dependabot rewrite erased a Prepare App commit",
      mutate(feedback) {
        feedback.forcePushCommits[0] = preparedCommit(OTHER_SHA, MERGE_SHA);
      },
    },
    {
      expectedReason: "invalid-force-push-event-chain",
      label: "cyclic rewrite returned to a prior seed",
      mutate(feedback) {
        feedback.forcePushEventCount = 2;
        feedback.forcePushEvents = [
          {
            ...feedback.forcePushEvents[0],
            afterSha: SECOND_HEAD_SHA,
            beforeSha: HEAD_SHA,
            createdAt: "2026-08-10T08:00:00Z",
          },
          {
            ...feedback.forcePushEvents[0],
            beforeSha: SECOND_HEAD_SHA,
            createdAt: "2026-08-10T09:00:00Z",
            eventId: "force-push-event-2",
          },
        ];
        feedback.forcePushCommits = [
          nativeDependabotCommit(HEAD_SHA),
          nativeDependabotCommit(SECOND_HEAD_SHA),
        ];
      },
    },
    {
      expectedReason: "invalid-force-push-event-chain",
      label: "reordered events",
      mutate(feedback) {
        feedback.forcePushEventCount = 2;
        feedback.forcePushCommits.push(
          nativeDependabotCommit(SECOND_HEAD_SHA, MERGE_SHA),
        );
        feedback.forcePushEvents.unshift({
          ...feedback.forcePushEvents[0],
          afterSha: SECOND_HEAD_SHA,
          beforeSha: OTHER_SHA,
          createdAt: "2026-08-10T10:00:00Z",
          eventId: "force-push-event-2",
        });
      },
    },
    {
      expectedReason: "invalid-force-push-event-chain",
      label: "discontinuous events",
      mutate(feedback) {
        feedback.forcePushEventCount = 2;
        feedback.forcePushCommits.push(nativeDependabotCommit(SECOND_HEAD_SHA));
        feedback.forcePushEvents.unshift({
          ...feedback.forcePushEvents[0],
          afterSha: SECOND_HEAD_SHA,
          beforeSha: MERGE_SHA,
          createdAt: "2026-08-10T08:00:00Z",
          eventId: "force-push-event-2",
        });
      },
    },
    {
      expectedReason: "invalid-force-push-event-chain",
      label: "mixed history",
      mutate(feedback) {
        feedback.forcePushEventCount = 2;
        feedback.forcePushEvents.push({
          ...feedback.forcePushEvents[0],
          actorId: 7,
          actorLogin: "alice",
          actorType: "User",
          afterSha: SECOND_HEAD_SHA,
          beforeSha: HEAD_SHA,
          createdAt: "2026-08-10T10:00:00Z",
          eventId: "force-push-event-2",
        });
      },
    },
    {
      expectedReason: "invalid-force-push-generation-seed",
      label: "spoofed current seed actor",
      mutate() {},
      mutateSnapshot(current) {
        current.commits[0].authorId = 7;
      },
    },
    {
      expectedReason: "invalid-force-push-generation-seed",
      label: "invalid current seed verification",
      mutate() {},
      mutateSnapshot(current) {
        current.commits[0].verificationReason = "unknown_key";
      },
    },
  ];

  for (const testCase of cases) {
    const feedback = structuredClone(baseFeedback);
    testCase.mutate(feedback);
    const current = snapshot({
      checks: completeChecks({ conclusions: { ci: "failure" } }),
      commits: [nativeDependabotCommit(HEAD_SHA)],
      feedback,
      metadata: {
        ...snapshot().metadata,
        immutableEvidence: {
          ...snapshot().metadata.immutableEvidence,
          seedCommitSha: HEAD_SHA,
          seedCommitTrusted: true,
        },
      },
      pullRequest: { author: DEPENDABOT_ACTOR },
    });
    testCase.mutateSnapshot?.(current);
    const evaluation = evaluateDependabotPullRequest(current, {
      mode: "prepare",
      repository: REPOSITORY,
      workflowContext: WORKFLOW_CONTEXT,
    });
    assert.equal(evaluation.feedback.forcePushVeto, true, testCase.label);
    assert.ok(
      evaluation.feedback.forcePushGenerationReasons.includes(
        testCase.expectedReason,
      ),
      testCase.label,
    );
    assert.equal(evaluation.feedback.clear, false, testCase.label);
    assert.equal(evaluation.identity.prepareAuthority, false, testCase.label);
    assert.equal(
      evaluation.disposition,
      "manual-veto-or-feedback",
      testCase.label,
    );
    assert.equal(evaluation.repairPacket, null, testCase.label);
  }
});

test("typed repair receipts require valid verification and consume one attempt only", () => {
  const packet = evaluateDependabotPullRequest(
    snapshot({ checks: completeChecks({ conclusions: { ci: "failure" } }) }),
    {
      mode: "prepare",
      repository: REPOSITORY,
      workflowContext: WORKFLOW_CONTEXT,
    },
  ).repairPacket;
  assert.notEqual(packet, null);
  const legacyPacketText = stableJson(packet);
  assert.notEqual(legacyPacketText, canonicalJson(packet));
  const packetCheck = processorRepairReceipt(1, {
    headSha: HEAD_SHA,
    packet,
  });
  assert.equal(packetCheck.outputText, legacyPacketText);
  const parsedLegacyPacket = parseDependabotProcessorReceipt(
    packetCheck,
    REPOSITORY,
  );
  assert.equal(parsedLegacyPacket?.packetCanonical, false);
  assert.equal(parsedLegacyPacket?.packetDigest, rawDigest(legacyPacketText));
  const receiptCheck = repairReceiptCheck({
    headSha: OTHER_SHA,
    packetDigest: digest(packet),
    parentHeadSha: HEAD_SHA,
    processorCheckId: packetCheck.id,
  });
  const repaired = snapshot({
    baseAncestry: {
      aheadBy: 2,
      baseCommitSha: BASE_SHA,
      behindBy: 0,
      currentBaseIsAncestor: true,
      currentBaseSha: BASE_SHA,
      headSha: OTHER_SHA,
      mergeBaseSha: BASE_SHA,
      status: "ahead",
    },
    checks: completeChecks({ headSha: OTHER_SHA }),
    commits: [
      nativeDependabotCommit(HEAD_SHA),
      {
        authorId: PREPARE_ACTOR.botId,
        authorLogin: PREPARE_ACTOR.botLogin,
        authorType: "Bot",
        ...GITHUB_SYSTEM_COMMITTER,
        parents: [HEAD_SHA],
        sha: OTHER_SHA,
        verified: true,
        verificationReason: "valid",
      },
    ],
    expectedHeadSha: OTHER_SHA,
    feedback: nativeForcePushFeedback(),
    metadata: {
      ...snapshot().metadata,
      immutableEvidence: {
        ...snapshot().metadata.immutableEvidence,
        seedCommitSha: HEAD_SHA,
        seedCommitTrusted: true,
      },
    },
    prepareActor: PREPARE_ACTOR,
    pullRequest: {
      author: DEPENDABOT_ACTOR,
      head: {
        ref: "dependabot/github_actions/github-actions-routine-123",
        repo: { fullName: REPOSITORY },
        sha: OTHER_SHA,
      },
    },
    repairHistoryChecks: [packetCheck, receiptCheck],
  });
  const result = evaluateDependabotPullRequest(repaired, {
    mode: "prepare",
    repository: REPOSITORY,
    workflowContext: WORKFLOW_CONTEXT,
  });
  assert.equal(
    result.identity.valid,
    true,
    stableJson({
      identity: result.identity,
      repairAttempts: result.repairAttempts,
    }),
  );
  assert.equal(
    result.identity.prepareAuthority,
    true,
    stableJson({ feedback: result.feedback, metadata: repaired.metadata }),
  );
  assert.equal(result.feedback.forcePushGenerationKind, "native");
  assert.equal(result.repairAttempts.authenticatedRepairCommitCount, 1);
  assert.equal(result.repairAttempts.consumedAttempts, 1);
  assert.equal(result.repairAttempts.valid, true);
  assert.equal(result.repairAttempt, 2);
  assert.equal(result.repairAttempts.preparationKind, "prepared");
  assert.equal(result.disposition, "prepare-candidate");

  for (const [label, verification] of [
    ["unsigned", { verificationReason: "unsigned", verified: false }],
    ["invalid reason", { verificationReason: "unknown_key", verified: true }],
  ]) {
    const unverified = structuredClone(repaired);
    Object.assign(unverified.commits[1], verification);
    const untrusted = evaluateDependabotPullRequest(unverified, {
      mode: "prepare",
      repository: REPOSITORY,
      workflowContext: WORKFLOW_CONTEXT,
    });
    assert.equal(untrusted.identity.valid, false, label);
    assert.ok(
      untrusted.repairAttempts.reasons.includes("invalid-repair-transition"),
      `${label}: ${stableJson(untrusted.repairAttempts.reasons)}`,
    );
    assert.equal(untrusted.repairPacket, null, label);
  }

  for (const replacement of [
    { committerId: GITHUB_SYSTEM_COMMITTER.committerId + 1 },
    { committerLogin: "attacker" },
    { committerType: "Bot" },
  ]) {
    const wrongSystemCommitter = structuredClone(repaired);
    Object.assign(wrongSystemCommitter.commits[1], replacement);
    const wrongSystemCommitterResult = evaluateDependabotPullRequest(
      wrongSystemCommitter,
      {
        mode: "prepare",
        repository: REPOSITORY,
        workflowContext: WORKFLOW_CONTEXT,
      },
    );
    assert.equal(wrongSystemCommitterResult.identity.valid, false);
    assert.ok(
      wrongSystemCommitterResult.repairAttempts.reasons.includes(
        "invalid-repair-transition",
      ),
    );
  }

  const forged = structuredClone(repaired);
  forged.repairHistoryChecks[1].outputText = stableJson({
    ...JSON.parse(forged.repairHistoryChecks[1].outputText),
    packetDigest: "f".repeat(64),
  });
  const rejected = evaluateDependabotPullRequest(forged, {
    mode: "prepare",
    repository: REPOSITORY,
    workflowContext: WORKFLOW_CONTEXT,
  });
  assert.equal(rejected.identity.valid, false);
  assert.ok(
    rejected.repairAttempts.reasons.includes("malformed-repair-receipt"),
  );
  assert.equal(rejected.repairPacket, null);
});

test("typed preparation receipt parsers bind terminal workflow provenance", () => {
  const requested = refreshReceiptCheck("requested");
  const completed = refreshReceiptCheck("completed");
  const repaired = repairReceiptCheck();
  assert.ok(parseDependabotRefreshReceipt(requested, REPOSITORY));
  assert.ok(parseDependabotRefreshReceipt(completed, REPOSITORY));
  assert.ok(parseDependabotRepairReceipt(repaired, REPOSITORY));

  for (const mutation of [
    { runStatus: "in_progress" },
    { runConclusion: "failure" },
    { runHeadBranch: "feature" },
    { runHeadSha: OTHER_SHA },
    { workflowEvent: "pull_request" },
    { workflowPath: ".github/workflows/ci.yml" },
  ]) {
    assert.equal(
      parseDependabotRefreshReceipt({ ...requested, ...mutation }, REPOSITORY),
      null,
      stableJson(mutation),
    );
  }
});

test("packetless processor statuses do not enter repair-lineage receipt accounting", () => {
  for (const source of [
    { runConclusion: null, runStatus: "in_progress" },
    { runConclusion: "success", runStatus: "completed" },
    { runConclusion: "failure", runStatus: "completed" },
  ]) {
    const processorStatus = {
      ...processorRepairReceipt(1, { packet: false }),
      ...source,
    };
    const result = evaluateDependabotPullRequest(
      snapshot({ repairHistoryChecks: [processorStatus] }),
      {
        mode: "prepare",
        repository: REPOSITORY,
        workflowContext: WORKFLOW_CONTEXT,
      },
    );
    assert.equal(result.identity.valid, true, stableJson(source));
    assert.equal(result.disposition, "prepare-candidate", stableJson(source));
    assert.equal(result.repairAttempts.valid, true, stableJson(source));
    assert.deepEqual(result.repairAttempts.reasons, [], stableJson(source));
    assert.equal(result.repairAttempts.consumedAttempts, 0, stableJson(source));
    assert.equal(
      result.repairAttempts.issuedAttemptCount,
      0,
      stableJson(source),
    );
    assert.equal(
      result.repairAttempts.receiptCheckCount,
      0,
      stableJson(source),
    );
    assert.equal(result.repairAttempts.currentAttempt, 1, stableJson(source));
    assert.equal(
      result.repairAttempts.currentHeadPacketIssued,
      false,
      stableJson(source),
    );
  }

  for (const mutation of [
    { outputText: stableJson({ unexpected: true }) },
    { workflowPath: ".github/workflows/ci.yml" },
    {
      externalId: `${DEPENDABOT_PROCESSOR_SCHEMA}:pr=123:head=${HEAD_SHA}:mode=prepare:repair=1:packet=false:digest=${"a".repeat(64)}:run=${WORKFLOW_CONTEXT.workflowRunId}:attempt=${WORKFLOW_CONTEXT.workflowRunAttempt}`,
    },
  ]) {
    const processorStatus = {
      ...processorRepairReceipt(1, { packet: false }),
      runConclusion: null,
      runStatus: "in_progress",
      ...mutation,
    };
    const result = evaluateDependabotPullRequest(
      snapshot({ repairHistoryChecks: [processorStatus] }),
      {
        mode: "prepare",
        repository: REPOSITORY,
        workflowContext: WORKFLOW_CONTEXT,
      },
    );
    assert.equal(result.repairAttempts.valid, false, stableJson(mutation));
    assert.deepEqual(
      result.repairAttempts.reasons,
      ["malformed-processor-status"],
      stableJson(mutation),
    );
  }

  const packetCheck = processorRepairReceipt(1, {
    packet: legacyNpmRepairPacket(),
    packetEncoding: "canonical",
  });
  packetCheck.runConclusion = null;
  packetCheck.runStatus = "in_progress";
  const rejected = evaluateDependabotPullRequest(
    snapshot({ repairHistoryChecks: [packetCheck] }),
    {
      mode: "prepare",
      repository: REPOSITORY,
      workflowContext: WORKFLOW_CONTEXT,
    },
  );
  assert.equal(rejected.repairAttempts.valid, false);
  assert.equal(rejected.repairAttempts.currentHeadPacketIssued, false);
  assert.ok(
    rejected.repairAttempts.reasons.includes(
      "malformed-processor-packet-receipt",
    ),
  );
});

test("a head behind current main enters the serialized refresh lane", () => {
  const result = evaluateDependabotPullRequest(
    snapshot({
      baseAncestry: {
        aheadBy: 1,
        baseCommitSha: BASE_SHA,
        behindBy: 1,
        currentBaseIsAncestor: false,
        currentBaseSha: BASE_SHA,
        headSha: HEAD_SHA,
        mergeBaseSha: OTHER_SHA,
        status: "diverged",
      },
      checks: completeChecks({ conclusions: { ci: "failure" } }),
    }),
    {
      mode: "prepare",
      repository: REPOSITORY,
      workflowContext: WORKFLOW_CONTEXT,
    },
  );
  assert.equal(result.disposition, "refresh-required");
  assert.equal(result.base.current, false);
  assert.ok(result.base.reasons.includes("head-is-behind-current-base"));
  assert.equal(result.repairPacket, null);
});

test("workflow and local-action updates never enter a Prepare App mutation", () => {
  for (const filename of [
    ".github/workflows/ci.yml",
    ".github/actions/pnpm-install/action.yml",
  ]) {
    const actionFile = { ...PACKAGE_BLOB, filename };
    const green = evaluateDependabotPullRequest(
      snapshot({ pullRequest: { files: [actionFile] } }),
      {
        mode: "prepare",
        repository: REPOSITORY,
        workflowContext: WORKFLOW_CONTEXT,
      },
    );
    assert.equal(green.disposition, "prepare-candidate", filename);
    assert.equal(green.repairPacket, null, filename);

    const stale = evaluateDependabotPullRequest(
      snapshot({
        baseAncestry: {
          aheadBy: 1,
          baseCommitSha: BASE_SHA,
          behindBy: 1,
          currentBaseIsAncestor: false,
          currentBaseSha: BASE_SHA,
          headSha: HEAD_SHA,
          mergeBaseSha: OTHER_SHA,
          status: "diverged",
        },
        pullRequest: { files: [actionFile] },
      }),
      {
        mode: "prepare",
        repository: REPOSITORY,
        workflowContext: WORKFLOW_CONTEXT,
      },
    );
    assert.equal(stale.disposition, "manual-review", filename);
    assert.equal(stale.repairPacket, null, filename);

    const failing = evaluateDependabotPullRequest(
      snapshot({
        checks: completeChecks({ conclusions: { ci: "failure" } }),
        pullRequest: { files: [actionFile] },
      }),
      {
        mode: "prepare",
        repository: REPOSITORY,
        workflowContext: WORKFLOW_CONTEXT,
      },
    );
    assert.equal(failing.disposition, "manual-repair-required", filename);
    assert.equal(failing.repairPacket, null, filename);
  }
});

test("selects at most one prepare candidate per sweep and exposes no merge candidate", () => {
  const second = snapshot({
    pullRequest: { ...snapshot().pullRequest, number: 124 },
  });
  const result = evaluateDependabotSweep({
    mode: "prepare",
    pullRequests: [second, snapshot()],
    repository: REPOSITORY,
    workflowContext: WORKFLOW_CONTEXT,
  });
  assert.deepEqual(result.prepareCandidate, {
    disposition: "prepare-candidate",
    headSha: HEAD_SHA,
    pullRequestNumber: 123,
  });
  assert.equal(result.mergeCandidate, null);
  assert.deepEqual(result.serialization.outstandingAutoMerge, {
    ambiguous: false,
    reasons: [],
    requests: [],
  });
  assert.equal(
    result.evaluations[1].disposition,
    "waiting-prepare-serialization",
  );
  assert.equal(result.summary.prepareCandidates, 1);
});

test("targeted prepare collection expands globally and preserves an active higher-number ALL CLEAR", async () => {
  const targeted = snapshotForPullRequest(122, HEAD_SHA);
  const incumbent = await activeAllClearSnapshot({
    approvalId: 7_301,
    checkId: 63_102,
    headSha: SECOND_HEAD_SHA,
    pullRequestNumber: 124,
  });
  const snapshots = new Map([
    [122, targeted],
    [124, incumbent],
  ]);
  const collectedNumbers = [];
  const result = await processDependabotSweep({
    adapter: {
      collectPullRequestSnapshot: async (_repository, number) => {
        collectedNumbers.push(number);
        return structuredClone(snapshots.get(number));
      },
      getOpenDependabotPullRequestNumbers: async () => [124, 122],
      getOutstandingDependabotAutoMergeRequests: async () => [],
      publishRefreshReceipt: async () =>
        assert.fail("an active ALL CLEAR must not request a refresh"),
    },
    expectedHeadSha: HEAD_SHA,
    mode: "prepare",
    phase: "request",
    pullRequestNumbers: [122],
    repository: REPOSITORY,
    workflowContext: WORKFLOW_CONTEXT,
  });

  assert.deepEqual(collectedNumbers, [122, 124]);
  assert.deepEqual(result.prepareCandidate, {
    disposition: "prepare-candidate",
    headSha: SECOND_HEAD_SHA,
    pullRequestNumber: 124,
  });
  assert.equal(result.serialization.activeAllClearApprovalId, 7_301);
  assert.equal(
    result.evaluations.find(
      ({ pullRequestNumber }) => pullRequestNumber === 122,
    ).disposition,
    "waiting-prepare-serialization",
  );
  assert.deepEqual(result.mutations, []);
});

test("targeted prepare collection preserves a higher repair-pending incumbent", async () => {
  const targeted = snapshotForPullRequest(122, HEAD_SHA);
  const incumbent = repairPendingSnapshotForPullRequest(
    123,
    SECOND_HEAD_SHA,
    61_101,
  );
  const snapshots = new Map([
    [122, targeted],
    [123, incumbent],
  ]);
  const result = await processDependabotSweep({
    adapter: {
      collectPullRequestSnapshot: async (_repository, number) =>
        structuredClone(snapshots.get(number)),
      getOpenDependabotPullRequestNumbers: async () => [122, 123],
      getOutstandingDependabotAutoMergeRequests: async () => [],
      publishRefreshReceipt: async () =>
        assert.fail("a repair-pending incumbent must not request a refresh"),
    },
    expectedHeadSha: HEAD_SHA,
    mode: "prepare",
    phase: "request",
    pullRequestNumbers: [122],
    repository: REPOSITORY,
    workflowContext: WORKFLOW_CONTEXT,
  });

  assert.deepEqual(result.prepareCandidate, {
    disposition: "repair-pending",
    headSha: SECOND_HEAD_SHA,
    pullRequestNumber: 123,
  });
  assert.equal(
    result.evaluations.find(
      ({ pullRequestNumber }) => pullRequestNumber === 122,
    ).disposition,
    "waiting-prepare-serialization",
  );
  assert.deepEqual(result.mutations, []);
});

test("a prepared waiting-checks incumbent outranks a lower refresh candidate", () => {
  const requestCheck = refreshReceiptCheck("requested");
  const completedCheck = refreshReceiptCheck("completed");
  const incumbent = refreshedSnapshot({
    repairHistoryChecks: [requestCheck, completedCheck],
  });
  incumbent.checks = completeChecks({ headSha: OTHER_SHA }).slice(0, -1);
  const lower = staleSnapshotForPullRequest(122, SECOND_HEAD_SHA);

  const result = evaluateDependabotSweep({
    mode: "prepare",
    outstandingAutoMergeRequests: [],
    pullRequests: [lower, incumbent],
    repository: REPOSITORY,
    workflowContext: WORKFLOW_CONTEXT,
  });

  const selected = result.evaluations.find(
    ({ pullRequestNumber }) => pullRequestNumber === 123,
  );
  assert.equal(selected.repairAttempts.preparationKind, "prepared");
  assert.equal(selected.repairAttempts.prepareLineageValid, true);
  assert.deepEqual(result.prepareCandidate, {
    disposition: "waiting-checks",
    headSha: OTHER_SHA,
    pullRequestNumber: 123,
  });
  assert.equal(
    result.evaluations.find(
      ({ pullRequestNumber }) => pullRequestNumber === 122,
    ).disposition,
    "waiting-prepare-serialization",
  );
});

test("multiple durable preparation incumbents fail closed without a candidate", () => {
  const lower = staleSnapshotForPullRequest(122, SECOND_HEAD_SHA);
  const first = repairPendingSnapshotForPullRequest(123, HEAD_SHA, 61_201);
  const second = repairPendingSnapshotForPullRequest(124, OTHER_SHA, 61_202);

  const result = evaluateDependabotSweep({
    mode: "prepare",
    outstandingAutoMergeRequests: [],
    pullRequests: [lower, first, second],
    repository: REPOSITORY,
    workflowContext: WORKFLOW_CONTEXT,
  });

  assert.equal(result.prepareCandidate, null);
  assert.equal(result.serialization.ready, false);
  assert.equal(result.serialization.reason, "multiple-preparation-incumbents");
  assert.deepEqual(
    result.evaluations.map(({ disposition }) => disposition),
    Array(3).fill("waiting-prepare-serialization"),
  );
  assert.ok(
    result.evaluations.every(({ repairPacket }) => repairPacket === null),
  );
});

test("global prepare expansion keeps the expected head bound only to its requested target", async () => {
  const racedTarget = snapshotForPullRequest(122, SECOND_HEAD_SHA);
  const other = snapshotForPullRequest(123, HEAD_SHA);
  const snapshots = new Map([
    [122, racedTarget],
    [123, other],
  ]);
  const result = await processDependabotSweep({
    adapter: {
      collectPullRequestSnapshot: async (_repository, number) =>
        structuredClone(snapshots.get(number)),
      getOpenDependabotPullRequestNumbers: async () => [122, 123],
      getOutstandingDependabotAutoMergeRequests: async () => [],
      publishRefreshReceipt: async () =>
        assert.fail("a target head race must not request a refresh"),
    },
    expectedHeadSha: HEAD_SHA,
    mode: "prepare",
    phase: "request",
    pullRequestNumbers: [122],
    repository: REPOSITORY,
    workflowContext: WORKFLOW_CONTEXT,
  });

  const rejected = result.evaluations.find(
    ({ pullRequestNumber }) => pullRequestNumber === 122,
  );
  assert.equal(rejected.disposition, "rejected-identity");
  assert.ok(rejected.identity.reasons.includes("head-sha-changed"));
  assert.deepEqual(result.prepareCandidate, {
    disposition: "prepare-candidate",
    headSha: HEAD_SHA,
    pullRequestNumber: 123,
  });
});

test("observe collection remains scoped to the requested pull request", async () => {
  const collectedNumbers = [];
  const result = await processDependabotSweep({
    adapter: {
      collectPullRequestSnapshot: async (_repository, number) => {
        collectedNumbers.push(number);
        return snapshotForPullRequest(number, HEAD_SHA);
      },
      getOpenDependabotPullRequestNumbers: async () =>
        assert.fail("observe must not expand a targeted collection"),
      getOutstandingDependabotAutoMergeRequests: async () => [],
    },
    mode: "observe",
    pullRequestNumbers: [122],
    repository: REPOSITORY,
  });

  assert.deepEqual(collectedNumbers, [122]);
  assert.equal(result.evaluations.length, 1);
  assert.equal(result.evaluations[0].pullRequestNumber, 122);
  assert.equal(result.prepareCandidate, null);
});

test("blocks prepare serialization without an exact trusted main receipt", () => {
  const withoutReceipt = snapshot();
  withoutReceipt.baseline.checks = withoutReceipt.baseline.checks.filter(
    ({ name }) => name !== "Dependabot Post-Merge Verification",
  );
  const result = evaluateDependabotSweep({
    mode: "prepare",
    pullRequests: [withoutReceipt],
    repository: REPOSITORY,
    workflowContext: WORKFLOW_CONTEXT,
  });
  assert.equal(result.prepareCandidate, null);
  assert.equal(result.serialization.ready, false);
  assert.equal(
    result.evaluations[0].disposition,
    "waiting-post-merge-verification",
  );
});

test("post-merge serialization binds an exact Actions receipt to its trusted workflow run", () => {
  const actionsReceipt = evaluatePrepareSerializationReceipt(
    postMergeReceipt(BASE_SHA),
  );
  assert.equal(actionsReceipt.serialization.ready, true);
  assert.equal(
    actionsReceipt.serialization.reason,
    "exact-main-post-merge-receipt-passed",
  );
  assert.deepEqual(actionsReceipt.prepareCandidate, {
    disposition: "prepare-candidate",
    headSha: HEAD_SHA,
    pullRequestNumber: 123,
  });

  const validReceipt = postMergeReceipt(BASE_SHA);
  const cases = [
    ["malformed external ID", { externalId: "dependabot-post-merge:invalid" }],
    [
      "mismatched external run ID",
      { externalId: "dependabot-post-merge:100:1" },
    ],
    [
      "mismatched external attempt",
      { externalId: "dependabot-post-merge:99:2" },
    ],
    [
      "wrong Actions run URL",
      { detailsUrl: `https://github.com/${REPOSITORY}/actions/runs/100` },
    ],
    [
      "wrong self check URL",
      {
        detailsUrl: `https://github.com/${REPOSITORY}/runs/101`,
        id: 100,
      },
    ],
    ["wrong source repository", { sourceRepository: "attacker/repository" }],
    ["wrong workflow path", { workflowPath: ".github/workflows/ci.yml" }],
    ["wrong workflow event", { workflowEvent: "push" }],
    ["wrong workflow branch", { runHeadBranch: "release" }],
    ["wrong workflow head", { runHeadSha: OTHER_SHA }],
    ["wrong workflow attempt", { runAttempt: 2 }],
    ["failed workflow run", { runConclusion: "failure" }],
    [
      "in-progress workflow run",
      { runConclusion: null, runStatus: "in_progress" },
    ],
  ];
  for (const [label, override] of cases) {
    const result = evaluatePrepareSerializationReceipt({
      ...validReceipt,
      ...override,
    });
    assert.equal(result.serialization.ready, false, label);
    assert.equal(result.prepareCandidate, null, label);
    assert.equal(
      result.evaluations[0].disposition,
      "waiting-post-merge-verification",
      label,
    );
  }

  const { runHeadSha: omittedRunHeadSha, ...withoutWorkflowHead } =
    validReceipt;
  assert.equal(omittedRunHeadSha, BASE_SHA);
  const persistedWithoutWorkflowHead = JSON.parse(
    stableJson(withoutWorkflowHead),
  );
  assert.equal(
    Object.hasOwn(persistedWithoutWorkflowHead, "runHeadSha"),
    false,
  );
  const omittedWorkflowHead = evaluatePrepareSerializationReceipt(
    persistedWithoutWorkflowHead,
  );
  assert.equal(omittedWorkflowHead.serialization.ready, false);
  assert.equal(
    omittedWorkflowHead.serialization.reason,
    "untrusted-post-merge-source-ref",
  );
  assert.equal(omittedWorkflowHead.prepareCandidate, null);
});

test("a newer malformed post-merge check supersedes an older valid receipt and closes the lane", () => {
  const current = snapshot();
  current.baseline.checks.push({
    appId: 15_368,
    completedAt: "2026-08-10T10:01:00Z",
    conclusion: "failure",
    detailsUrl: `https://github.com/${REPOSITORY}/runs/101`,
    externalId: "malformed",
    headSha: BASE_SHA,
    id: 101,
    kind: "check",
    name: "Dependabot Post-Merge Verification",
    status: "completed",
  });

  const result = evaluateDependabotSweep({
    mode: "prepare",
    pullRequests: [current],
    repository: REPOSITORY,
    workflowContext: WORKFLOW_CONTEXT,
  });

  assert.equal(result.serialization.ready, false);
  assert.equal(result.serialization.reason, "unexpected-source-repository");
  assert.equal(result.serialization.check.conclusion, "failure");
  assert.equal(result.serialization.check.runId, 0);
  assert.equal(result.prepareCandidate, null);
  assert.equal(
    result.evaluations[0].disposition,
    "waiting-post-merge-verification",
  );
});

test("an unordered post-merge receipt blocks fallback to an older valid publication", () => {
  const current = snapshot();
  current.baseline.checks.push({
    ...postMergeReceipt(BASE_SHA),
    completedAt: "2026-08-10T10:01:00Z",
    id: 0,
  });

  const result = evaluateDependabotSweep({
    mode: "prepare",
    pullRequests: [current],
    repository: REPOSITORY,
    workflowContext: WORKFLOW_CONTEXT,
  });

  assert.equal(result.serialization.ready, false);
  assert.equal(result.serialization.reason, "invalid-post-merge-check-id");
  assert.equal(result.prepareCandidate, null);
  assert.equal(
    result.evaluations[0].disposition,
    "waiting-post-merge-verification",
  );
});

test("an exact current native auto-merge request blocks preparation until cleanup", () => {
  const outstanding = snapshot({
    feedback: {
      autoMergeEnabled: true,
      reviewDecision: "APPROVED",
      unresolvedThreads: 0,
    },
  });
  const result = evaluateDependabotSweep({
    mode: "prepare",
    pullRequests: [outstanding],
    repository: REPOSITORY,
    workflowContext: WORKFLOW_CONTEXT,
  });
  assert.equal(result.prepareCandidate, null);
  assert.equal(
    result.serialization.reason,
    "outstanding-native-auto-merge-request",
  );
  assert.equal(result.evaluations[0].disposition, "waiting-auto-merge-removal");

  const globalCurrentHeadRecovery = evaluateDependabotSweep({
    mode: "prepare",
    outstandingAutoMergeRequests: [
      {
        headSha: HEAD_SHA,
        nodeId: "PR_node",
        pullRequestNumber: 123,
      },
    ],
    pullRequests: [snapshot()],
    repository: REPOSITORY,
    workflowContext: WORKFLOW_CONTEXT,
  });
  assert.equal(globalCurrentHeadRecovery.prepareCandidate, null);
  assert.equal(
    globalCurrentHeadRecovery.evaluations[0].disposition,
    "waiting-auto-merge-removal",
  );
});

test("targeted sweeps block other, multiple, or malformed repository auto-merge requests", () => {
  const cases = [
    [
      {
        headSha: OTHER_SHA,
        nodeId: "PR_other",
        pullRequestNumber: 999,
      },
    ],
    [
      {
        headSha: null,
        nodeId: "PR_node",
        pullRequestNumber: 123,
      },
    ],
    [
      {
        headSha: HEAD_SHA,
        pullRequestNumber: 123,
      },
    ],
    [
      {
        headSha: HEAD_SHA,
        nodeId: "PR_node",
        pullRequestNumber: 123,
      },
      {
        headSha: OTHER_SHA,
        nodeId: "PR_other",
        pullRequestNumber: 999,
      },
    ],
  ];
  for (const outstandingAutoMergeRequests of cases) {
    const result = evaluateDependabotSweep({
      mode: "prepare",
      outstandingAutoMergeRequests,
      pullRequests: [snapshot()],
      repository: REPOSITORY,
      workflowContext: WORKFLOW_CONTEXT,
    });
    assert.equal(result.prepareCandidate, null);
    assert.equal(result.serialization.ready, false);
    assert.match(
      result.serialization.reason,
      /^outstanding-(?:auto-merge-|native-auto-merge-request$)/,
    );
  }
});

test("post-merge verification accepts only exact main CI plus approved Vercel outcomes", () => {
  for (const outcome of ["active-committed", "current-release-verified"]) {
    const result = verifyPostMergeOutcome({
      expectedMergeSha: MERGE_SHA,
      mainChecks: [check("Build and Test", "success", { headSha: MERGE_SHA })],
      mergeSha: MERGE_SHA,
      repository: REPOSITORY,
      vercel: { deploySha: MERGE_SHA, outcome, terminal: true },
    });
    assert.equal(result.verified, true, outcome);
  }
  assert.equal(
    verifyPostMergeOutcome({
      expectedMergeSha: MERGE_SHA,
      mainChecks: [check("Build and Test", "success", { headSha: MERGE_SHA })],
      mergeSha: MERGE_SHA,
      repository: REPOSITORY,
      vercel: {
        affectedTargets: [],
        deploySha: MERGE_SHA,
        outcome: "no-target",
        terminal: true,
      },
    }).verified,
    true,
  );
});

test("post-merge verification rejects recovered, superseded, affected no-target, and stale SHA evidence", () => {
  for (const vercel of [
    { deploySha: MERGE_SHA, outcome: "recovered" },
    { deploySha: MERGE_SHA, outcome: "superseded-before-journal" },
    {
      affectedTargets: ["app"],
      deploySha: MERGE_SHA,
      outcome: "no-target",
    },
    { deploySha: OTHER_SHA, outcome: "active-committed" },
  ]) {
    const result = verifyPostMergeOutcome({
      expectedMergeSha: MERGE_SHA,
      mainChecks: [check("Build and Test", "success", { headSha: MERGE_SHA })],
      mergeSha: MERGE_SHA,
      repository: REPOSITORY,
      vercel,
    });
    assert.equal(result.verified, false, vercel.outcome);
  }
});

test("post-merge verification requires explicit terminal Vercel evidence", () => {
  const mainChecks = [
    check("Build and Test", "success", { headSha: MERGE_SHA }),
  ];
  for (const vercel of [
    { deploySha: MERGE_SHA, outcome: "active-committed" },
    {
      deploySha: MERGE_SHA,
      outcome: "current-release-verified",
      terminal: false,
    },
    { outcome: "active-committed", terminal: true },
    { deploySha: MERGE_SHA, terminal: true },
    {
      deploySha: MERGE_SHA,
      outcome: "no-target",
      terminal: true,
    },
  ]) {
    const result = verifyPostMergeOutcome({
      expectedMergeSha: MERGE_SHA,
      mainChecks,
      mergeSha: MERGE_SHA,
      repository: REPOSITORY,
      vercel,
    });
    assert.equal(result.verified, false, JSON.stringify(vercel));
  }
});

test("refresh preparation is split across request, mutate, and finalize phases", async () => {
  const stale = withNativeForcePush(staleSnapshot());
  let requestedReceipt = null;
  const requested = await processDependabotSweep({
    adapter: {
      prepareActor: PREPARE_ACTOR,
      publishRefreshReceipt: async ({ receipt }) => {
        requestedReceipt = receipt;
        return { id: 40_001 };
      },
    },
    input: {
      mode: "prepare",
      outstandingAutoMergeRequests: [],
      pullRequests: [stale],
      repository: REPOSITORY,
      workflowContext: WORKFLOW_CONTEXT,
    },
    phase: "request",
    workflowContext: WORKFLOW_CONTEXT,
  });
  assert.deepEqual(
    requested.mutations.map(({ kind }) => kind),
    ["refresh-requested"],
  );
  assert.equal(requestedReceipt.state, "requested");
  assert.equal(requestedReceipt.parentHeadSha, HEAD_SHA);
  assert.equal(requestedReceipt.previousBaseSha, MERGE_SHA);
  assert.equal(requestedReceipt.baseSha, BASE_SHA);
  assert.deepEqual(
    {
      workflowRunAttempt: requestedReceipt.workflowRunAttempt,
      workflowRunId: requestedReceipt.workflowRunId,
      workflowSha: requestedReceipt.workflowSha,
    },
    WORKFLOW_CONTEXT,
  );

  const requestCheck = refreshReceiptCheck("requested");
  const pending = withNativeForcePush(staleSnapshot());
  pending.repairHistoryChecks = [requestCheck];
  let updateInput = null;
  const mutated = await processDependabotSweep({
    adapter: {
      collectPullRequestSnapshot: async () =>
        withNativeForcePush(
          refreshedSnapshot({ repairHistoryChecks: [requestCheck] }),
        ),
      requestPullRequestUpdateBranch: async (input) => {
        updateInput = input;
      },
    },
    input: {
      mode: "prepare",
      outstandingAutoMergeRequests: [],
      pullRequests: [pending],
      repository: REPOSITORY,
      workflowContext: WORKFLOW_CONTEXT,
    },
    phase: "mutate",
    workflowContext: WORKFLOW_CONTEXT,
  });
  assert.deepEqual(
    mutated.mutations.map(({ kind }) => kind),
    ["refresh-update-requested"],
    stableJson(mutated.evaluations[0].repairAttempts),
  );
  assert.deepEqual(updateInput, {
    expectedBaseSha: BASE_SHA,
    expectedHeadSha: HEAD_SHA,
    expectedPreviousBaseSha: MERGE_SHA,
    pullRequestNumber: 123,
    repository: REPOSITORY,
  });

  const successor = withNativeForcePush(
    refreshedSnapshot({
      repairHistoryChecks: [requestCheck],
    }),
  );
  let completedReceipt = null;
  const completed = await processDependabotSweep({
    adapter: {
      collectPullRequestSnapshot: async () => successor,
      getOutstandingDependabotAutoMergeRequests: async () => [],
      getOutstandingDependabotProcessorApprovals:
        noOutstandingProcessorApprovals,
      publishRefreshReceipt: async ({ receipt }) => {
        completedReceipt = receipt;
        return { id: 40_002 };
      },
    },
    input: {
      mode: "prepare",
      outstandingAutoMergeRequests: [],
      pullRequests: [successor],
      repository: REPOSITORY,
      workflowContext: WORKFLOW_CONTEXT,
    },
    phase: "finalize",
    workflowContext: WORKFLOW_CONTEXT,
  });
  assert.deepEqual(
    completed.mutations.map(({ kind }) => kind),
    ["refresh-completed"],
  );
  assert.equal(completedReceipt.state, "completed");
  assert.equal(completedReceipt.headSha, OTHER_SHA);
  assert.equal(completedReceipt.requestCheckId, requestCheck.id);
  assert.equal(completedReceipt.requestDigest, digest(requestedReceipt));
});

test("refresh successor polling retries only bounded snapshot races after the ref moves", async () => {
  const requestCheck = refreshReceiptCheck("requested");
  const pending = staleSnapshot();
  pending.repairHistoryChecks = [requestCheck];
  const stableFeedback = {
    digest: "a".repeat(64),
    headSha: OTHER_SHA,
    updatedAt: "2026-08-12T09:58:00Z",
  };
  let reads = 0;
  let waits = 0;
  const result = await processDependabotSweep({
    adapter: {
      collectPullRequestSnapshot: async () => {
        reads += 1;
        if (reads === 1) {
          requireStableFeedbackSnapshot(
            stableFeedback,
            { ...stableFeedback, digest: "b".repeat(64) },
            123,
          );
        }
        return refreshedSnapshot({ repairHistoryChecks: [requestCheck] });
      },
      requestPullRequestUpdateBranch: async () => {},
      waitForRefreshSuccessor: async () => {
        waits += 1;
      },
    },
    input: {
      mode: "prepare",
      outstandingAutoMergeRequests: [],
      pullRequests: [pending],
      repository: REPOSITORY,
      workflowContext: WORKFLOW_CONTEXT,
    },
    phase: "mutate",
    workflowContext: WORKFLOW_CONTEXT,
  });
  assert.equal(reads, 2);
  assert.equal(waits, 1);
  assert.deepEqual(result.mutations, [
    {
      headSha: HEAD_SHA,
      kind: "refresh-update-requested",
      pullRequestNumber: 123,
      requestCheckId: requestCheck.id,
      requestDigest: digest(JSON.parse(requestCheck.outputText)),
      successorHeadSha: OTHER_SHA,
    },
  ]);

  reads = 0;
  waits = 0;
  const slowSuccessor = await processDependabotSweep({
    adapter: {
      collectPullRequestSnapshot: async () => {
        reads += 1;
        if (reads <= 4) return pending;
        if (reads === 5) {
          requireStableFeedbackSnapshot(
            stableFeedback,
            { ...stableFeedback, digest: "b".repeat(64) },
            123,
          );
        }
        return refreshedSnapshot({ repairHistoryChecks: [requestCheck] });
      },
      requestPullRequestUpdateBranch: async () => {},
      waitForRefreshSuccessor: async () => {
        waits += 1;
      },
    },
    input: {
      mode: "prepare",
      outstandingAutoMergeRequests: [],
      pullRequests: [pending],
      repository: REPOSITORY,
      workflowContext: WORKFLOW_CONTEXT,
    },
    phase: "mutate",
    workflowContext: WORKFLOW_CONTEXT,
  });
  assert.equal(reads, 6);
  assert.equal(waits, 5);
  assert.equal(
    slowSuccessor.mutations[0].successorHeadSha,
    OTHER_SHA,
    "old-head polls must not consume the separate snapshot-race budget",
  );

  reads = 0;
  waits = 0;
  await assert.rejects(
    processDependabotSweep({
      adapter: {
        collectPullRequestSnapshot: async () => {
          reads += 1;
          requireStableFeedbackSnapshot(
            stableFeedback,
            { ...stableFeedback, updatedAt: `2026-08-12T09:58:0${reads}Z` },
            123,
          );
        },
        requestPullRequestUpdateBranch: async () => {},
        waitForRefreshSuccessor: async () => {
          waits += 1;
        },
      },
      input: {
        mode: "prepare",
        outstandingAutoMergeRequests: [],
        pullRequests: [pending],
        repository: REPOSITORY,
        workflowContext: WORKFLOW_CONTEXT,
      },
      phase: "mutate",
      workflowContext: WORKFLOW_CONTEXT,
    }),
    /feedback changed while its exact-head snapshot was collected/,
  );
  assert.equal(reads, 5);
  assert.equal(waits, 4);

  await assert.rejects(
    processDependabotSweep({
      adapter: {
        collectPullRequestSnapshot: async () => {
          throw new Error("GitHub API unavailable");
        },
        requestPullRequestUpdateBranch: async () => {},
        waitForRefreshSuccessor: async () =>
          assert.fail("arbitrary failures must not be retried"),
      },
      input: {
        mode: "prepare",
        outstandingAutoMergeRequests: [],
        pullRequests: [pending],
        repository: REPOSITORY,
        workflowContext: WORKFLOW_CONTEXT,
      },
      phase: "mutate",
      workflowContext: WORKFLOW_CONTEXT,
    }),
    /GitHub API unavailable/,
  );

  const badSuccessor = refreshedSnapshot({
    repairHistoryChecks: [requestCheck],
  });
  badSuccessor.commits.at(-1).parents = [HEAD_SHA];
  reads = 0;
  await assert.rejects(
    processDependabotSweep({
      adapter: {
        collectPullRequestSnapshot: async () => {
          reads += 1;
          if (reads === 1) {
            requireStableFeedbackSnapshot(
              stableFeedback,
              { ...stableFeedback, digest: "b".repeat(64) },
              123,
            );
          }
          return badSuccessor;
        },
        requestPullRequestUpdateBranch: async () => {},
        waitForRefreshSuccessor: async () => {},
      },
      input: {
        mode: "prepare",
        outstandingAutoMergeRequests: [],
        pullRequests: [pending],
        repository: REPOSITORY,
        workflowContext: WORKFLOW_CONTEXT,
      },
      phase: "mutate",
      workflowContext: WORKFLOW_CONTEXT,
    }),
    /refresh commit parents are invalid/,
  );
  assert.equal(reads, 2);
});

test("refresh request rejects a recorded base that differs from the compare merge base", async () => {
  const stale = staleSnapshot();
  stale.pullRequest.base.sha = OTHER_SHA;
  let published = false;
  await assert.rejects(
    processDependabotSweep({
      adapter: {
        prepareActor: PREPARE_ACTOR,
        publishRefreshReceipt: async () => {
          published = true;
          return { id: 40_001 };
        },
      },
      input: {
        mode: "prepare",
        outstandingAutoMergeRequests: [],
        pullRequests: [stale],
        repository: REPOSITORY,
        workflowContext: WORKFLOW_CONTEXT,
      },
      phase: "request",
      workflowContext: WORKFLOW_CONTEXT,
    }),
    /does not bind the recorded old base and distinct current base/,
  );
  assert.equal(published, false);
});

test("same-run or malformed Refresh evidence cannot reach the App update capability", async () => {
  const stale = staleSnapshot();
  stale.repairHistoryChecks = [
    { ...refreshReceiptCheck("requested"), runStatus: "in_progress" },
  ];
  let updated = false;
  const result = await processDependabotSweep({
    adapter: {
      collectPullRequestSnapshot: async () =>
        assert.fail("untrusted same-run evidence must not recollect"),
      requestPullRequestUpdateBranch: async () => {
        updated = true;
      },
    },
    input: {
      mode: "prepare",
      outstandingAutoMergeRequests: [],
      pullRequests: [stale],
      repository: REPOSITORY,
      workflowContext: WORKFLOW_CONTEXT,
    },
    phase: "mutate",
    workflowContext: WORKFLOW_CONTEXT,
  });
  assert.equal(updated, false);
  assert.deepEqual(result.mutations, []);
  assert.equal(result.prepareCandidate?.disposition, "refresh-required");
  assert.ok(
    result.evaluations[0].repairAttempts.reasons.includes(
      "malformed-current-refresh-request",
    ),
  );

  const badSuccessor = refreshedSnapshot({
    repairHistoryChecks: [refreshReceiptCheck("requested")],
  });
  badSuccessor.commits[1].parents = [HEAD_SHA];
  let published = false;
  const rejected = await processDependabotSweep({
    adapter: {
      collectPullRequestSnapshot: async () => badSuccessor,
      getOutstandingDependabotAutoMergeRequests: async () => [],
      getOutstandingDependabotProcessorApprovals:
        noOutstandingProcessorApprovals,
      publishRefreshReceipt: async () => {
        published = true;
      },
    },
    input: {
      mode: "prepare",
      outstandingAutoMergeRequests: [],
      pullRequests: [badSuccessor],
      repository: REPOSITORY,
      workflowContext: WORKFLOW_CONTEXT,
    },
    phase: "finalize",
    workflowContext: WORKFLOW_CONTEXT,
  });
  assert.equal(published, false);
  assert.equal(rejected.prepareCandidate, null);
  assert.ok(
    rejected.evaluations[0].repairAttempts.reasons.includes(
      "preparation-lineage-commit-without-typed-receipt",
    ),
  );
});

test("finalize approves one recollected exact head and publishes ALL CLEAR without merging", async () => {
  const calls = [];
  let approved = false;
  let allClearReceipt = null;
  let processorStatusPublished = false;
  const preApprovalSnapshot = snapshot({
    feedback: {
      mergeStateStatus: "BLOCKED",
      reviewDecision: "REVIEW_REQUIRED",
    },
  });
  const postApproval = () => {
    const current = structuredClone(preApprovalSnapshot);
    if (processorStatusPublished) {
      const processorStatus = processorRepairReceipt(1, {
        id: 50_001,
        packet: false,
      });
      processorStatus.runConclusion = null;
      processorStatus.runStatus = "in_progress";
      current.checks.push(processorStatus);
      current.repairHistoryChecks = [processorStatus];
    }
    if (approved) {
      withCurrentProcessorApproval(current);
      current.feedback.mergeStateStatus = "CLEAN";
      current.feedback.reviewDecision = "APPROVED";
    }
    return current;
  };
  const adapter = {
    approvePullRequest: async ({ headSha, pullRequestNumber }) => {
      calls.push(["approve", pullRequestNumber, headSha]);
      approved = true;
      return processorApprovalResult();
    },
    collectPullRequestSnapshot: async () => {
      const current = postApproval();
      if (approved) {
        const sweep = evaluateDependabotSweep({
          mode: "prepare",
          outstandingAutoMergeRequests: [],
          pullRequests: [current],
          repository: REPOSITORY,
          workflowContext: WORKFLOW_CONTEXT,
        });
        assert.deepEqual(sweep.prepareCandidate, {
          disposition: "prepare-candidate",
          headSha: HEAD_SHA,
          pullRequestNumber: 123,
        });
        assert.deepEqual(
          sweep.evaluations[0].feedback.currentProcessorApprovalIds,
          [7001],
        );
      }
      return current;
    },
    dismissPullRequestApproval: async () =>
      assert.fail("successful finalization must preserve its exact approval"),
    getOutstandingDependabotAutoMergeRequests: async () => [],
    getOutstandingDependabotProcessorApprovals: async () =>
      approved
        ? [
            {
              approvalId: 7001,
              headSha: HEAD_SHA,
              pullRequestNumber: 123,
            },
          ]
        : [],
    publishAllClear: async ({ receipt }) => {
      calls.push(["all-clear", receipt.pullRequestNumber, receipt.headSha]);
      allClearReceipt = receipt;
      return { id: 50_002 };
    },
    publishAllClearInvalidation: async () =>
      assert.fail("a clean candidate must not invalidate ALL CLEAR"),
    publishProcessorCheck: async ({ disposition, headSha }) => {
      calls.push(["processor", disposition, headSha]);
      processorStatusPublished = true;
      return { id: 50_001 };
    },
  };
  const admittedProbeSnapshot = withCurrentProcessorApproval(snapshot());
  const admittedProbe = evaluateDependabotSweep({
    mode: "prepare",
    outstandingAutoMergeRequests: [],
    pullRequests: [admittedProbeSnapshot],
    repository: REPOSITORY,
    workflowContext: WORKFLOW_CONTEXT,
  }).evaluations[0];
  assert.equal(
    admittedProbe.disposition,
    "prepare-candidate",
    stableJson({
      base: admittedProbe.base,
      checks: admittedProbe.checks,
      feedback: admittedProbe.feedback,
      identity: admittedProbe.identity,
    }),
  );
  const result = await processDependabotSweep({
    adapter,
    input: {
      mode: "prepare",
      outstandingAutoMergeRequests: [],
      pullRequests: [preApprovalSnapshot],
      repository: REPOSITORY,
      workflowContext: WORKFLOW_CONTEXT,
    },
    phase: "finalize",
    publishChecks: true,
    workflowContext: WORKFLOW_CONTEXT,
  });
  assert.deepEqual(calls, [
    ["processor", "prepare-candidate", HEAD_SHA],
    ["approve", 123, HEAD_SHA],
    ["all-clear", 123, HEAD_SHA],
  ]);
  assert.deepEqual(
    result.mutations.map(({ kind }) => kind),
    ["processor-check-published", "approved", "all-clear-published"],
  );
  assert.equal(result.mergeCandidate, null);
  assert.equal(Object.hasOwn(adapter, "mergePullRequest"), false);
  assert.equal(allClearReceipt.schema, DEPENDABOT_ALL_CLEAR_SCHEMA);
  assert.equal(allClearReceipt.humanAction, "merge");
  assert.equal(allClearReceipt.mergeAuthorizedByAutomation, false);
  assert.equal(allClearReceipt.processorApprovalId, 7001);
  assert.deepEqual(allClearReceipt.preparation, {
    kind: "native",
    operationDigests: [],
    refreshCount: 0,
    repairCount: 0,
    seedHeadSha: HEAD_SHA,
  });
});

test("finalize withdraws its approval when the post-approval ruleset stays blocked", async () => {
  const cleanup = [];
  let approved = false;
  let processorStatusPublished = false;
  const preApprovalSnapshot = snapshot({
    feedback: {
      mergeStateStatus: "BLOCKED",
      reviewDecision: "REVIEW_REQUIRED",
    },
  });
  const currentSnapshot = () => {
    const current = structuredClone(preApprovalSnapshot);
    if (processorStatusPublished) {
      const processorStatus = processorRepairReceipt(1, {
        id: 50_101,
        packet: false,
      });
      processorStatus.runConclusion = null;
      processorStatus.runStatus = "in_progress";
      current.checks.push(processorStatus);
      current.repairHistoryChecks = [processorStatus];
    }
    if (approved) {
      withCurrentProcessorApproval(current);
      current.feedback.reviewDecision = "APPROVED";
    }
    return current;
  };

  await assert.rejects(
    processDependabotSweep({
      adapter: {
        approvePullRequest: async () => {
          approved = true;
          return processorApprovalResult();
        },
        collectPullRequestSnapshot: async () => currentSnapshot(),
        dismissPullRequestApproval: async ({ approvalId }) => {
          cleanup.push(["dismiss", approvalId]);
          approved = false;
        },
        getOutstandingDependabotAutoMergeRequests: async () => [],
        getOutstandingDependabotProcessorApprovals: async () =>
          approved
            ? [
                {
                  approvalId: 7_001,
                  headSha: HEAD_SHA,
                  pullRequestNumber: 123,
                },
              ]
            : [],
        publishAllClear: async () =>
          assert.fail("a blocked ruleset must never receive ALL CLEAR"),
        publishAllClearInvalidation: async ({ headSha }) => {
          cleanup.push(["invalidate", headSha]);
        },
        publishProcessorCheck: async () => {
          processorStatusPublished = true;
          return { id: 50_101 };
        },
      },
      input: {
        mode: "prepare",
        outstandingAutoMergeRequests: [],
        pullRequests: [preApprovalSnapshot],
        repository: REPOSITORY,
        workflowContext: WORKFLOW_CONTEXT,
      },
      phase: "finalize",
      publishChecks: true,
      workflowContext: WORKFLOW_CONTEXT,
    }),
    /failed final ruleset admission/,
  );
  assert.equal(processorStatusPublished, true);
  assert.deepEqual(cleanup, [
    ["invalidate", HEAD_SHA],
    ["dismiss", 7_001],
  ]);
});

test("finalize finds and dismisses an approval after its response is lost", async () => {
  const cleanup = [];
  let approved = false;
  await assert.rejects(
    processDependabotSweep({
      adapter: {
        approvePullRequest: async () => {
          approved = true;
          throw new Error("approval response lost");
        },
        collectPullRequestSnapshot: async () => snapshot(),
        dismissPullRequestApproval: async ({ approvalId }) => {
          assert.equal(approvalId, 7_001);
          cleanup.push(["dismiss", approvalId]);
          approved = false;
        },
        getOutstandingDependabotAutoMergeRequests: async () => [],
        getOutstandingDependabotProcessorApprovals: async () =>
          approved
            ? [
                {
                  approvalId: 7_001,
                  headSha: HEAD_SHA,
                  pullRequestNumber: 123,
                },
              ]
            : [],
        publishAllClear: async () =>
          assert.fail("an ambiguous approval must block ALL CLEAR"),
        publishAllClearInvalidation: async ({ headSha }) => {
          cleanup.push(["invalidate", headSha]);
        },
        publishProcessorCheck: async () => ({ id: 50_201 }),
      },
      input: {
        mode: "prepare",
        outstandingAutoMergeRequests: [],
        pullRequests: [snapshot()],
        repository: REPOSITORY,
        workflowContext: WORKFLOW_CONTEXT,
      },
      phase: "finalize",
      publishChecks: true,
      workflowContext: WORKFLOW_CONTEXT,
    }),
    /approval response lost/,
  );
  assert.deepEqual(cleanup, [
    ["invalidate", HEAD_SHA],
    ["dismiss", 7_001],
  ]);
  assert.equal(approved, false);
});

test("finalize settles a blocking ALL CLEAR invalidation only without merge authority", async () => {
  const writes = [];
  let activeApprovalId = 6_999;
  let tombstoned = false;
  const currentSnapshot = () => {
    const approved = activeApprovalId !== null;
    const current = snapshot({
      feedback: {
        mergeStateStatus:
          approved && tombstoned ? "CLEAN" : approved ? "UNSTABLE" : "BLOCKED",
        reviewDecision: approved ? "APPROVED" : "REVIEW_REQUIRED",
      },
    });
    current.checks.push(allClearInvalidationCheck());
    if (tombstoned) {
      current.checks.push(
        allClearInvalidationCheck({ blocking: false, id: 60_002 }),
      );
    }
    if (approved) withCurrentProcessorApproval(current, activeApprovalId);
    return current;
  };

  const result = await processDependabotSweep({
    adapter: {
      approvePullRequest: async () => {
        writes.push("approve");
        activeApprovalId = 7_001;
        return processorApprovalResult();
      },
      collectPullRequestSnapshot: async () => currentSnapshot(),
      dismissPullRequestApproval: async ({ approvalId }) => {
        assert.equal(approvalId, 6_999);
        writes.push("dismiss-stale-approval");
        activeApprovalId = null;
      },
      getOutstandingDependabotAutoMergeRequests: async () => [],
      getOutstandingDependabotProcessorApprovals: async () =>
        activeApprovalId === null
          ? []
          : [
              {
                approvalId: activeApprovalId,
                headSha: HEAD_SHA,
                pullRequestNumber: 123,
              },
            ],
      publishAllClear: async () => {
        writes.push("all-clear");
        return { id: 60_004 };
      },
      publishAllClearInvalidation: async ({ blocking = true }) => {
        assert.equal(blocking, false);
        writes.push("neutral-tombstone");
        tombstoned = true;
        return { id: 60_002 };
      },
      publishProcessorCheck: async () => {
        writes.push("processor");
        return { id: 60_003 };
      },
    },
    input: {
      mode: "prepare",
      outstandingAutoMergeRequests: [],
      pullRequests: [currentSnapshot()],
      repository: REPOSITORY,
      workflowContext: WORKFLOW_CONTEXT,
    },
    phase: "finalize",
    publishChecks: true,
    workflowContext: WORKFLOW_CONTEXT,
  });

  assert.deepEqual(writes, [
    "dismiss-stale-approval",
    "neutral-tombstone",
    "processor",
    "approve",
    "all-clear",
  ]);
  assert.ok(
    result.mutations.some(({ kind }) => kind === "all-clear-tombstoned"),
  );
  assert.ok(
    result.mutations.some(({ kind }) => kind === "all-clear-published"),
  );
});

test("finalize disables native auto-merge before ALL CLEAR recovery", async () => {
  const current = snapshot();
  current.checks.push(allClearInvalidationCheck());
  const request = {
    headSha: HEAD_SHA,
    nodeId: "PR_node",
    pullRequestNumber: 123,
  };
  let autoMergeActive = true;
  const writes = [];

  const result = await processDependabotSweep({
    adapter: {
      approvePullRequest: async () =>
        assert.fail("auto-merge cleanup must finish first"),
      collectPullRequestSnapshot: async () => structuredClone(current),
      disablePullRequestAutoMerge: async (input) => {
        assert.deepEqual(input, { ...request, repository: REPOSITORY });
        writes.push("disable-auto-merge");
        autoMergeActive = false;
      },
      dismissPullRequestApproval: async () =>
        assert.fail("no processor approval exists"),
      getOutstandingDependabotAutoMergeRequests: async () =>
        autoMergeActive ? [request] : [],
      getOutstandingDependabotProcessorApprovals:
        noOutstandingProcessorApprovals,
      publishAllClear: async () =>
        assert.fail("auto-merge cleanup must finish first"),
      publishAllClearInvalidation: async () =>
        assert.fail("the blocking invalidation must remain current"),
      publishProcessorCheck: async () =>
        assert.fail("auto-merge cleanup must finish first"),
    },
    input: {
      mode: "prepare",
      outstandingAutoMergeRequests: [request],
      pullRequests: [current],
      repository: REPOSITORY,
      workflowContext: WORKFLOW_CONTEXT,
    },
    phase: "finalize",
    publishChecks: true,
    workflowContext: WORKFLOW_CONTEXT,
  });

  assert.deepEqual(writes, ["disable-auto-merge"]);
  assert.equal(autoMergeActive, false);
  assert.deepEqual(
    result.mutations.map(({ kind }) => kind),
    ["auto-merge-disabled"],
  );
});

test("finalize revalidates a persisted neutral ALL CLEAR tombstone", async () => {
  const writes = [];
  let approved = false;
  let allClearState = "persisted-neutral";
  const currentSnapshot = () => {
    const current = snapshot({
      feedback: {
        mergeStateStatus: approved ? "CLEAN" : "BLOCKED",
        reviewDecision: approved ? "APPROVED" : "REVIEW_REQUIRED",
      },
    });
    current.checks.push(allClearInvalidationCheck());
    if (allClearState === "persisted-neutral") {
      current.checks.push(
        allClearInvalidationCheck({ blocking: false, id: 60_202 }),
      );
    } else if (allClearState === "revalidated-blocking") {
      current.checks.push(allClearInvalidationCheck({ id: 60_203 }));
    } else if (allClearState === "recovered-neutral") {
      current.checks.push(
        allClearInvalidationCheck({ blocking: false, id: 60_204 }),
      );
    }
    if (approved) withCurrentProcessorApproval(current);
    return current;
  };

  await processDependabotSweep({
    adapter: {
      approvePullRequest: async () => {
        writes.push("approve");
        approved = true;
        return processorApprovalResult();
      },
      collectPullRequestSnapshot: async () => currentSnapshot(),
      dismissPullRequestApproval: async () =>
        assert.fail("successful finalization must preserve its approval"),
      getOutstandingDependabotAutoMergeRequests: async () => [],
      getOutstandingDependabotProcessorApprovals: async () =>
        approved
          ? [
              {
                approvalId: 7_001,
                headSha: HEAD_SHA,
                pullRequestNumber: 123,
              },
            ]
          : [],
      publishAllClear: async () => {
        writes.push("all-clear");
        return { id: 60_206 };
      },
      publishAllClearInvalidation: async ({ blocking = true }) => {
        if (blocking) {
          writes.push("blocking-invalidation");
          allClearState = "revalidated-blocking";
          return { id: 60_203 };
        }
        writes.push("neutral-tombstone");
        allClearState = "recovered-neutral";
        return { id: 60_204 };
      },
      publishProcessorCheck: async () => {
        writes.push("processor");
        return { id: 60_205 };
      },
    },
    input: {
      mode: "prepare",
      outstandingAutoMergeRequests: [],
      pullRequests: [currentSnapshot()],
      repository: REPOSITORY,
      workflowContext: WORKFLOW_CONTEXT,
    },
    phase: "finalize",
    publishChecks: true,
    workflowContext: WORKFLOW_CONTEXT,
  });

  assert.deepEqual(writes, [
    "blocking-invalidation",
    "neutral-tombstone",
    "processor",
    "approve",
    "all-clear",
  ]);
});

test("finalize leaves a blocking ALL CLEAR invalidation when review authority remains", async () => {
  const current = snapshot({
    feedback: {
      mergeStateStatus: "UNSTABLE",
      reviewDecision: "APPROVED",
    },
  });
  current.checks.push(allClearInvalidationCheck());
  const writes = [];

  await assert.rejects(
    processDependabotSweep({
      adapter: {
        approvePullRequest: async () => writes.push("approve"),
        collectPullRequestSnapshot: async () => structuredClone(current),
        dismissPullRequestApproval: async () => writes.push("dismiss"),
        getOutstandingDependabotAutoMergeRequests: async () => [],
        getOutstandingDependabotProcessorApprovals:
          noOutstandingProcessorApprovals,
        publishAllClear: async () => writes.push("all-clear"),
        publishAllClearInvalidation: async () => writes.push("invalidation"),
        publishProcessorCheck: async () => writes.push("processor"),
      },
      input: {
        mode: "prepare",
        outstandingAutoMergeRequests: [],
        pullRequests: [current],
        repository: REPOSITORY,
        workflowContext: WORKFLOW_CONTEXT,
      },
      phase: "finalize",
      publishChecks: true,
      workflowContext: WORKFLOW_CONTEXT,
    }),
    /retained merge authority during ALL CLEAR recovery/,
  );
  assert.deepEqual(writes, []);
});

test("finalize reblocks a persisted neutral tombstone before checking review authority", async () => {
  let blocking = false;
  const writes = [];
  const currentSnapshot = () => {
    const current = snapshot({
      feedback: {
        mergeStateStatus: "UNSTABLE",
        reviewDecision: "APPROVED",
      },
    });
    current.checks.push(allClearInvalidationCheck());
    current.checks.push(
      allClearInvalidationCheck({
        blocking,
        id: blocking ? 60_212 : 60_211,
      }),
    );
    return current;
  };

  await assert.rejects(
    processDependabotSweep({
      adapter: {
        approvePullRequest: async () =>
          assert.fail("human review authority must block approval"),
        collectPullRequestSnapshot: async () => currentSnapshot(),
        dismissPullRequestApproval: async () =>
          assert.fail("human approvals must not be dismissed"),
        getOutstandingDependabotAutoMergeRequests: async () => [],
        getOutstandingDependabotProcessorApprovals:
          noOutstandingProcessorApprovals,
        publishAllClear: async () =>
          assert.fail("human review authority must block ALL CLEAR"),
        publishAllClearInvalidation: async ({ blocking: next = true }) => {
          assert.equal(next, true);
          writes.push("blocking-invalidation");
          blocking = true;
          return { id: 60_212 };
        },
        publishProcessorCheck: async () =>
          assert.fail("human review authority must block classification"),
      },
      input: {
        mode: "prepare",
        outstandingAutoMergeRequests: [],
        pullRequests: [currentSnapshot()],
        repository: REPOSITORY,
        workflowContext: WORKFLOW_CONTEXT,
      },
      phase: "finalize",
      publishChecks: true,
      workflowContext: WORKFLOW_CONTEXT,
    }),
    /retained merge authority during ALL CLEAR recovery/,
  );
  assert.deepEqual(writes, ["blocking-invalidation"]);
  assert.equal(blocking, true);
});

test("finalize restores a blocking invalidation when neutral recovery races", async () => {
  const writes = [];
  let tombstoned = false;
  const currentSnapshot = () => {
    const current = snapshot({
      feedback: {
        mergeStateStatus: tombstoned ? "UNSTABLE" : "BLOCKED",
        reviewDecision: tombstoned ? "APPROVED" : "REVIEW_REQUIRED",
      },
    });
    current.checks.push(allClearInvalidationCheck());
    if (tombstoned) {
      current.checks.push(
        allClearInvalidationCheck({ blocking: false, id: 60_102 }),
      );
    }
    return current;
  };

  await assert.rejects(
    processDependabotSweep({
      adapter: {
        approvePullRequest: async () => writes.push("approve"),
        collectPullRequestSnapshot: async () => currentSnapshot(),
        dismissPullRequestApproval: async () => writes.push("dismiss"),
        getOutstandingDependabotAutoMergeRequests: async () => [],
        getOutstandingDependabotProcessorApprovals:
          noOutstandingProcessorApprovals,
        publishAllClear: async () => writes.push("all-clear"),
        publishAllClearInvalidation: async ({ blocking = true }) => {
          writes.push(blocking ? "blocking-invalidation" : "neutral-tombstone");
          tombstoned = !blocking;
          return { id: blocking ? 60_103 : 60_102 };
        },
        publishProcessorCheck: async () => writes.push("processor"),
      },
      input: {
        mode: "prepare",
        outstandingAutoMergeRequests: [],
        pullRequests: [currentSnapshot()],
        repository: REPOSITORY,
        workflowContext: WORKFLOW_CONTEXT,
      },
      phase: "finalize",
      publishChecks: true,
      workflowContext: WORKFLOW_CONTEXT,
    }),
    /retained merge authority during ALL CLEAR recovery/,
  );
  assert.deepEqual(writes, ["neutral-tombstone", "blocking-invalidation"]);
});

test("finalize restores blocking state after an ambiguous neutral publication", async () => {
  const writes = [];
  let blockingRestored = false;
  const current = snapshot({
    feedback: {
      mergeStateStatus: "BLOCKED",
      reviewDecision: "REVIEW_REQUIRED",
    },
  });
  current.checks.push(allClearInvalidationCheck());

  await assert.rejects(
    processDependabotSweep({
      adapter: {
        approvePullRequest: async () =>
          assert.fail("ambiguous recovery must stop before approval"),
        collectPullRequestSnapshot: async () => structuredClone(current),
        dismissPullRequestApproval: async () =>
          assert.fail("no processor approval exists"),
        getOutstandingDependabotAutoMergeRequests: async () => [],
        getOutstandingDependabotProcessorApprovals:
          noOutstandingProcessorApprovals,
        publishAllClear: async () =>
          assert.fail("ambiguous recovery must stop before ALL CLEAR"),
        publishAllClearInvalidation: async ({ blocking = true }) => {
          writes.push(blocking ? "blocking-invalidation" : "neutral-tombstone");
          if (!blocking) {
            throw new Error("neutral publication response lost");
          }
          blockingRestored = true;
          return { id: 60_403 };
        },
        publishProcessorCheck: async () =>
          assert.fail("ambiguous recovery must stop before classification"),
      },
      input: {
        mode: "prepare",
        outstandingAutoMergeRequests: [],
        pullRequests: [current],
        repository: REPOSITORY,
        workflowContext: WORKFLOW_CONTEXT,
      },
      phase: "finalize",
      publishChecks: true,
      workflowContext: WORKFLOW_CONTEXT,
    }),
    /neutral publication response lost/,
  );
  assert.deepEqual(writes, ["neutral-tombstone", "blocking-invalidation"]);
  assert.equal(blockingRestored, true);
});

test("finalize disables auto-merge that reappears on the same PR during rollback", async () => {
  const request = {
    headSha: HEAD_SHA,
    nodeId: "PR_node",
    pullRequestNumber: 123,
  };
  const writes = [];
  let autoMergeActive = false;
  let disableCount = 0;
  let reenabled = false;
  let rollbackStarted = false;
  let tombstoned = false;
  const currentSnapshot = () => {
    const current = snapshot({
      feedback: {
        mergeStateStatus: "BLOCKED",
        reviewDecision: "REVIEW_REQUIRED",
      },
    });
    current.checks.push(allClearInvalidationCheck());
    if (tombstoned) {
      current.checks.push(
        allClearInvalidationCheck({ blocking: false, id: 60_502 }),
      );
    }
    return current;
  };

  await assert.rejects(
    processDependabotSweep({
      adapter: {
        approvePullRequest: async () =>
          assert.fail("auto-merge recovery must stop before approval"),
        collectPullRequestSnapshot: async () => currentSnapshot(),
        disablePullRequestAutoMerge: async (input) => {
          assert.deepEqual(input, { ...request, repository: REPOSITORY });
          writes.push("disable-auto-merge");
          disableCount += 1;
          autoMergeActive = false;
        },
        dismissPullRequestApproval: async () =>
          assert.fail("no processor approval exists"),
        getOutstandingDependabotAutoMergeRequests: async () => {
          if (rollbackStarted && disableCount === 1 && !reenabled) {
            reenabled = true;
            autoMergeActive = true;
          }
          return autoMergeActive ? [request] : [];
        },
        getOutstandingDependabotProcessorApprovals:
          noOutstandingProcessorApprovals,
        publishAllClear: async () =>
          assert.fail("auto-merge recovery must stop before ALL CLEAR"),
        publishAllClearInvalidation: async ({ blocking = true }) => {
          writes.push(blocking ? "blocking-invalidation" : "neutral-tombstone");
          tombstoned = !blocking;
          if (blocking) rollbackStarted = true;
          else autoMergeActive = true;
          return { id: blocking ? 60_503 : 60_502 };
        },
        publishProcessorCheck: async () =>
          assert.fail("auto-merge recovery must stop before classification"),
      },
      input: {
        mode: "prepare",
        outstandingAutoMergeRequests: [],
        pullRequests: [currentSnapshot()],
        repository: REPOSITORY,
        workflowContext: WORKFLOW_CONTEXT,
      },
      phase: "finalize",
      publishChecks: true,
      workflowContext: WORKFLOW_CONTEXT,
    }),
    /ALL CLEAR recovery requires no repository auto-merge authority/,
  );
  assert.deepEqual(writes, [
    "neutral-tombstone",
    "blocking-invalidation",
    "disable-auto-merge",
    "disable-auto-merge",
  ]);
  assert.equal(disableCount, 2);
  assert.equal(reenabled, true);
  assert.equal(autoMergeActive, false);
  assert.equal(tombstoned, false);
});

test("finalize disables auto-merge first visible in a rollback confirmation scan", async () => {
  const request = {
    headSha: HEAD_SHA,
    nodeId: "PR_node",
    pullRequestNumber: 123,
  };
  const writes = [];
  let autoMergeActive = false;
  let rollbackAutoMergeReads = 0;
  let rollbackStarted = false;
  let tombstoned = false;
  const currentSnapshot = () => {
    const current = snapshot({
      feedback: {
        mergeStateStatus: tombstoned ? "UNSTABLE" : "BLOCKED",
        reviewDecision: tombstoned ? "APPROVED" : "REVIEW_REQUIRED",
      },
    });
    current.checks.push(allClearInvalidationCheck());
    if (tombstoned) {
      current.checks.push(
        allClearInvalidationCheck({ blocking: false, id: 60_512 }),
      );
    }
    return current;
  };

  await assert.rejects(
    processDependabotSweep({
      adapter: {
        approvePullRequest: async () =>
          assert.fail("a recovery race must stop before approval"),
        collectPullRequestSnapshot: async () => currentSnapshot(),
        disablePullRequestAutoMerge: async (input) => {
          assert.deepEqual(input, { ...request, repository: REPOSITORY });
          writes.push("disable-late-auto-merge");
          autoMergeActive = false;
        },
        dismissPullRequestApproval: async () =>
          assert.fail("no processor approval exists"),
        getOutstandingDependabotAutoMergeRequests: async () => {
          if (!rollbackStarted) return [];
          rollbackAutoMergeReads += 1;
          if (rollbackAutoMergeReads === 2) autoMergeActive = true;
          return autoMergeActive ? [request] : [];
        },
        getOutstandingDependabotProcessorApprovals:
          noOutstandingProcessorApprovals,
        publishAllClear: async () =>
          assert.fail("a recovery race must stop before ALL CLEAR"),
        publishAllClearInvalidation: async ({ blocking = true }) => {
          writes.push(blocking ? "blocking-invalidation" : "neutral-tombstone");
          tombstoned = !blocking;
          if (blocking) rollbackStarted = true;
          return { id: blocking ? 60_513 : 60_512 };
        },
        publishProcessorCheck: async () =>
          assert.fail("a recovery race must stop before classification"),
      },
      input: {
        mode: "prepare",
        outstandingAutoMergeRequests: [],
        pullRequests: [currentSnapshot()],
        repository: REPOSITORY,
        workflowContext: WORKFLOW_CONTEXT,
      },
      phase: "finalize",
      publishChecks: true,
      workflowContext: WORKFLOW_CONTEXT,
    }),
    /retained merge authority during ALL CLEAR recovery/,
  );
  assert.deepEqual(writes, [
    "neutral-tombstone",
    "blocking-invalidation",
    "disable-late-auto-merge",
  ]);
  assert.equal(rollbackAutoMergeReads, 4);
  assert.equal(autoMergeActive, false);
});

test("finalize dismisses processor authority that appears during ALL CLEAR recovery", async () => {
  const writes = [];
  let racedApproval = false;
  let tombstoned = false;
  const currentSnapshot = () => {
    const current = snapshot({
      feedback: {
        mergeStateStatus: racedApproval ? "UNSTABLE" : "BLOCKED",
        reviewDecision: racedApproval ? "APPROVED" : "REVIEW_REQUIRED",
      },
    });
    current.checks.push(allClearInvalidationCheck());
    if (tombstoned) {
      current.checks.push(
        allClearInvalidationCheck({ blocking: false, id: 60_302 }),
      );
    }
    if (racedApproval) withCurrentProcessorApproval(current, 7_002);
    return current;
  };

  await assert.rejects(
    processDependabotSweep({
      adapter: {
        approvePullRequest: async () =>
          assert.fail("a recovery race must stop before a new approval"),
        collectPullRequestSnapshot: async () => currentSnapshot(),
        dismissPullRequestApproval: async ({ approvalId }) => {
          assert.equal(approvalId, 7_002);
          writes.push("dismiss-raced-approval");
          racedApproval = false;
        },
        getOutstandingDependabotAutoMergeRequests: async () => [],
        getOutstandingDependabotProcessorApprovals: async () =>
          racedApproval
            ? [
                {
                  approvalId: 7_002,
                  headSha: HEAD_SHA,
                  pullRequestNumber: 123,
                },
              ]
            : [],
        publishAllClear: async () =>
          assert.fail("a recovery race must not publish ALL CLEAR"),
        publishAllClearInvalidation: async ({ blocking = true }) => {
          writes.push(blocking ? "blocking-invalidation" : "neutral-tombstone");
          if (!blocking) {
            tombstoned = true;
            racedApproval = true;
          }
          return { id: blocking ? 60_303 : 60_302 };
        },
        publishProcessorCheck: async () =>
          assert.fail("a recovery race must stop before classification"),
      },
      input: {
        mode: "prepare",
        outstandingAutoMergeRequests: [],
        pullRequests: [currentSnapshot()],
        repository: REPOSITORY,
        workflowContext: WORKFLOW_CONTEXT,
      },
      phase: "finalize",
      publishChecks: true,
      workflowContext: WORKFLOW_CONTEXT,
    }),
    /processor approvals changed during ALL CLEAR recovery/,
  );
  assert.deepEqual(writes, [
    "neutral-tombstone",
    "blocking-invalidation",
    "dismiss-raced-approval",
  ]);
  assert.equal(racedApproval, false);
});

test("finalize dismisses an approval first visible in a rollback confirmation scan", async () => {
  const writes = [];
  let lateApprovalActive = false;
  let rollbackInventoryReads = 0;
  let rollbackStarted = false;
  let tombstoned = false;
  const currentSnapshot = () => {
    const current = snapshot({
      feedback: {
        mergeStateStatus: tombstoned ? "UNSTABLE" : "BLOCKED",
        reviewDecision: tombstoned ? "APPROVED" : "REVIEW_REQUIRED",
      },
    });
    current.checks.push(allClearInvalidationCheck());
    if (tombstoned) {
      current.checks.push(
        allClearInvalidationCheck({ blocking: false, id: 60_602 }),
      );
    }
    return current;
  };

  await assert.rejects(
    processDependabotSweep({
      adapter: {
        approvePullRequest: async () =>
          assert.fail("a recovery race must stop before approval"),
        collectPullRequestSnapshot: async () => currentSnapshot(),
        dismissPullRequestApproval: async ({ approvalId }) => {
          assert.equal(approvalId, 7_003);
          writes.push("dismiss-late-approval");
          lateApprovalActive = false;
        },
        getOutstandingDependabotAutoMergeRequests: async () => [],
        getOutstandingDependabotProcessorApprovals: async () => {
          if (!rollbackStarted) return [];
          rollbackInventoryReads += 1;
          if (rollbackInventoryReads === 2) lateApprovalActive = true;
          return lateApprovalActive
            ? [
                {
                  approvalId: 7_003,
                  headSha: HEAD_SHA,
                  pullRequestNumber: 123,
                },
              ]
            : [];
        },
        publishAllClear: async () =>
          assert.fail("a recovery race must stop before ALL CLEAR"),
        publishAllClearInvalidation: async ({ blocking = true }) => {
          writes.push(blocking ? "blocking-invalidation" : "neutral-tombstone");
          tombstoned = !blocking;
          if (blocking) rollbackStarted = true;
          return { id: blocking ? 60_603 : 60_602 };
        },
        publishProcessorCheck: async () =>
          assert.fail("a recovery race must stop before classification"),
      },
      input: {
        mode: "prepare",
        outstandingAutoMergeRequests: [],
        pullRequests: [currentSnapshot()],
        repository: REPOSITORY,
        workflowContext: WORKFLOW_CONTEXT,
      },
      phase: "finalize",
      publishChecks: true,
      workflowContext: WORKFLOW_CONTEXT,
    }),
    /retained merge authority during ALL CLEAR recovery/,
  );
  assert.deepEqual(writes, [
    "neutral-tombstone",
    "blocking-invalidation",
    "dismiss-late-approval",
  ]);
  assert.equal(rollbackInventoryReads, 4);
  assert.equal(lateApprovalActive, false);
});

test("finalize withdraws its approval and invalidates ALL CLEAR after an exact-head race", async () => {
  const cleanup = [];
  let approved = false;
  await assert.rejects(
    processDependabotSweep({
      adapter: {
        approvePullRequest: async () => {
          approved = true;
          return processorApprovalResult();
        },
        collectPullRequestSnapshot: async () => {
          if (!approved) return snapshot();
          return snapshot({
            expectedHeadSha: OTHER_SHA,
            pullRequest: {
              head: {
                ref: "dependabot/github_actions/github-actions-routine-123",
                repo: { fullName: REPOSITORY },
                sha: OTHER_SHA,
              },
            },
          });
        },
        dismissPullRequestApproval: async ({ approvalId }) => {
          cleanup.push(["dismiss", approvalId]);
        },
        getOutstandingDependabotAutoMergeRequests: async () => [],
        getOutstandingDependabotProcessorApprovals:
          noOutstandingProcessorApprovals,
        publishAllClear: async () =>
          assert.fail("a raced head must never receive ALL CLEAR"),
        publishAllClearInvalidation: async ({ headSha }) => {
          cleanup.push(["invalidate", headSha]);
        },
        publishProcessorCheck: async () => ({ id: 51_001 }),
      },
      input: {
        mode: "prepare",
        outstandingAutoMergeRequests: [],
        pullRequests: [snapshot()],
        repository: REPOSITORY,
        workflowContext: WORKFLOW_CONTEXT,
      },
      phase: "finalize",
      publishChecks: true,
      workflowContext: WORKFLOW_CONTEXT,
    }),
    /failed final ruleset admission/,
  );
  assert.deepEqual(cleanup, [
    ["invalidate", HEAD_SHA],
    ["dismiss", 7001],
  ]);
});

test("a matching exact-head ALL CLEAR receipt makes finalize idempotent", async () => {
  let captured = null;
  let approved = false;
  const postApproval = () => {
    const current = snapshot();
    if (approved) withCurrentProcessorApproval(current);
    return current;
  };
  await processDependabotSweep({
    adapter: {
      approvePullRequest: async () => {
        approved = true;
        return processorApprovalResult();
      },
      collectPullRequestSnapshot: async () => postApproval(),
      dismissPullRequestApproval: async () => {},
      getOutstandingDependabotAutoMergeRequests: async () => [],
      getOutstandingDependabotProcessorApprovals: async () =>
        approved
          ? [
              {
                approvalId: 7001,
                headSha: HEAD_SHA,
                pullRequestNumber: 123,
              },
            ]
          : [],
      publishAllClear: async ({ receipt }) => {
        captured = receipt;
        return { id: 52_002 };
      },
      publishAllClearInvalidation: async () => {},
      publishProcessorCheck: async () => ({ id: 52_001 }),
    },
    input: {
      mode: "prepare",
      outstandingAutoMergeRequests: [],
      pullRequests: [snapshot()],
      repository: REPOSITORY,
      workflowContext: WORKFLOW_CONTEXT,
    },
    phase: "finalize",
    publishChecks: true,
    workflowContext: WORKFLOW_CONTEXT,
  });
  const allClearCheck = trustedReceiptCheck({
    externalId: `${DEPENDABOT_ALL_CLEAR_SCHEMA}:pr=123:head=${HEAD_SHA}:base=${BASE_SHA}:digest=${digest(captured)}:run=${WORKFLOW_CONTEXT.workflowRunId}:attempt=${WORKFLOW_CONTEXT.workflowRunAttempt}`,
    headSha: HEAD_SHA,
    id: 52_002,
    name: "Dependabot ALL CLEAR",
    receipt: captured,
    workflowContext: WORKFLOW_CONTEXT,
    workflowPath: ".github/workflows/dependabot-process.yml",
  });
  assert.ok(parseDependabotAllClearReceipt(allClearCheck, REPOSITORY));

  const alreadyClear = withCurrentProcessorApproval(snapshot());
  alreadyClear.checks.push(allClearCheck);
  const writes = [];
  const result = await processDependabotSweep({
    adapter: {
      approvePullRequest: async () => writes.push("approve"),
      collectPullRequestSnapshot: async () => alreadyClear,
      dismissPullRequestApproval: async () => writes.push("dismiss"),
      getOutstandingDependabotAutoMergeRequests: async () => [],
      getOutstandingDependabotProcessorApprovals: async () => [
        {
          approvalId: 7001,
          headSha: HEAD_SHA,
          pullRequestNumber: 123,
        },
      ],
      publishAllClear: async () => writes.push("all-clear"),
      publishAllClearInvalidation: async () => writes.push("invalidate"),
      publishProcessorCheck: async () => writes.push("processor"),
    },
    input: {
      mode: "prepare",
      outstandingAutoMergeRequests: [],
      pullRequests: [alreadyClear],
      repository: REPOSITORY,
      workflowContext: WORKFLOW_CONTEXT,
    },
    phase: "finalize",
    publishChecks: true,
    workflowContext: WORKFLOW_CONTEXT,
  });
  assert.deepEqual(writes, []);
  assert.deepEqual(result.processing, {
    enabled: true,
    reason: "already-all-clear",
  });
  assert.deepEqual(result.mutations, []);
});

test("an active higher-number ALL CLEAR pins global and targeted prepare lanes", async () => {
  const lower = snapshotForPullRequest(122, HEAD_SHA);
  const higher = await activeAllClearSnapshot({
    approvalId: 7_201,
    checkId: 63_002,
    headSha: SECOND_HEAD_SHA,
    pullRequestNumber: 124,
  });
  const evaluated = evaluateDependabotSweep({
    mode: "prepare",
    outstandingAutoMergeRequests: [],
    pullRequests: [lower, higher],
    repository: REPOSITORY,
    workflowContext: WORKFLOW_CONTEXT,
  });
  assert.deepEqual(evaluated.prepareCandidate, {
    disposition: "prepare-candidate",
    headSha: SECOND_HEAD_SHA,
    pullRequestNumber: 124,
  });
  assert.equal(evaluated.serialization.activeAllClearApprovalId, 7_201);
  assert.equal(
    evaluated.evaluations.find(
      ({ pullRequestNumber }) => pullRequestNumber === 122,
    ).disposition,
    "waiting-prepare-serialization",
  );

  const writes = [];
  const targeted = await processDependabotSweep({
    adapter: {
      approvePullRequest: async () => writes.push("approve"),
      collectPullRequestSnapshot: async (_repository, pullRequestNumber) => {
        if (pullRequestNumber === 124) return structuredClone(higher);
        if (pullRequestNumber === 122) return structuredClone(lower);
        assert.fail(`unexpected PR #${pullRequestNumber}`);
      },
      dismissPullRequestApproval: async () => writes.push("dismiss"),
      getOutstandingDependabotAutoMergeRequests: async () => [],
      getOutstandingDependabotProcessorApprovals: async () => [
        {
          approvalId: 7_201,
          headSha: SECOND_HEAD_SHA,
          pullRequestNumber: 124,
        },
      ],
      publishAllClear: async () => writes.push("all-clear"),
      publishAllClearInvalidation: async () => writes.push("invalidate"),
      publishProcessorCheck: async () => writes.push("processor"),
    },
    input: {
      mode: "prepare",
      outstandingAutoMergeRequests: [],
      pullRequests: [lower],
      repository: REPOSITORY,
      workflowContext: WORKFLOW_CONTEXT,
    },
    phase: "finalize",
    publishChecks: true,
    workflowContext: WORKFLOW_CONTEXT,
  });
  assert.deepEqual(writes, []);
  assert.deepEqual(targeted.prepareCandidate, {
    disposition: "prepare-candidate",
    headSha: SECOND_HEAD_SHA,
    pullRequestNumber: 124,
  });
  assert.deepEqual(targeted.processing, {
    enabled: true,
    reason: "already-all-clear",
  });
});

test("a competing approval injected after exact-head admission prevents ALL CLEAR", async () => {
  const cleanup = [];
  const activeApprovals = new Map();
  let approved = false;
  await assert.rejects(
    processDependabotSweep({
      adapter: {
        approvePullRequest: async () => {
          approved = true;
          activeApprovals.set(7_001, {
            approvalId: 7_001,
            headSha: HEAD_SHA,
            pullRequestNumber: 123,
          });
          activeApprovals.set(7_999, {
            approvalId: 7_999,
            headSha: SECOND_HEAD_SHA,
            pullRequestNumber: 124,
          });
          return processorApprovalResult();
        },
        collectPullRequestSnapshot: async () => {
          const current = snapshot();
          if (approved) withCurrentProcessorApproval(current);
          return current;
        },
        dismissPullRequestApproval: async ({ approvalId }) => {
          cleanup.push(["dismiss", approvalId]);
          activeApprovals.delete(approvalId);
        },
        getOutstandingDependabotAutoMergeRequests: async () => [],
        getOutstandingDependabotProcessorApprovals: async () => [
          ...activeApprovals.values(),
        ],
        publishAllClear: async () =>
          assert.fail("competing global approval must block ALL CLEAR"),
        publishAllClearInvalidation: async ({ headSha }) => {
          cleanup.push(["invalidate", headSha]);
        },
        publishProcessorCheck: async () => ({ id: 64_001 }),
      },
      input: {
        mode: "prepare",
        outstandingAutoMergeRequests: [],
        pullRequests: [snapshot()],
        repository: REPOSITORY,
        workflowContext: WORKFLOW_CONTEXT,
      },
      phase: "finalize",
      publishChecks: true,
      workflowContext: WORKFLOW_CONTEXT,
    }),
    /approval inventory changed before ALL CLEAR/,
  );
  assert.deepEqual(cleanup, [
    ["invalidate", HEAD_SHA],
    ["dismiss", 7_001],
    ["invalidate", SECOND_HEAD_SHA],
    ["dismiss", 7_999],
  ]);
  assert.equal(activeApprovals.size, 0);
});

test("post-approval rollback disables auto-merge and dismisses its approval", async () => {
  const request = {
    headSha: HEAD_SHA,
    nodeId: "PR_node",
    pullRequestNumber: 123,
  };
  const cleanup = [];
  let approved = false;
  let autoMergeActive = false;

  await assert.rejects(
    processDependabotSweep({
      adapter: {
        approvePullRequest: async () => {
          approved = true;
          autoMergeActive = true;
          return processorApprovalResult();
        },
        collectPullRequestSnapshot: async () => {
          const current = snapshot();
          if (approved) withCurrentProcessorApproval(current);
          return current;
        },
        disablePullRequestAutoMerge: async (input) => {
          assert.deepEqual(input, { ...request, repository: REPOSITORY });
          cleanup.push(["disable-auto-merge", HEAD_SHA]);
          autoMergeActive = false;
        },
        dismissPullRequestApproval: async ({ approvalId }) => {
          assert.equal(approvalId, 7_001);
          cleanup.push(["dismiss", approvalId]);
          approved = false;
        },
        getOutstandingDependabotAutoMergeRequests: async () =>
          autoMergeActive ? [request] : [],
        getOutstandingDependabotProcessorApprovals: async () =>
          approved
            ? [
                {
                  approvalId: 7_001,
                  headSha: HEAD_SHA,
                  pullRequestNumber: 123,
                },
              ]
            : [],
        publishAllClear: async () =>
          assert.fail("post-approval auto-merge must block ALL CLEAR"),
        publishAllClearInvalidation: async ({ headSha }) => {
          cleanup.push(["invalidate", headSha]);
        },
        publishProcessorCheck: async () => ({ id: 64_101 }),
      },
      input: {
        mode: "prepare",
        outstandingAutoMergeRequests: [],
        pullRequests: [snapshot()],
        repository: REPOSITORY,
        workflowContext: WORKFLOW_CONTEXT,
      },
      phase: "finalize",
      publishChecks: true,
      workflowContext: WORKFLOW_CONTEXT,
    }),
    /failed final ruleset admission/,
  );
  assert.deepEqual(cleanup, [
    ["invalidate", HEAD_SHA],
    ["dismiss", 7_001],
    ["disable-auto-merge", HEAD_SHA],
  ]);
  assert.equal(approved, false);
  assert.equal(autoMergeActive, false);
});

test("finalize remediates only the exact packet-bound review thread", async () => {
  const thread = {
    bodyDigest: textDigest("Claude finding"),
    line: 7,
    path: "package.json",
    reviewCommitSha: HEAD_SHA,
    resolved: false,
    rootCommentId: 61,
    source: "claude",
    threadId: "PRRT_thread_61",
    trustedBotEnvelope: true,
  };
  const repairableFeedback = {
    actionableThreadCount: 1,
    actionableThreads: [thread],
    reasons: ["unresolved-review-feedback", "unreplied-review-feedback"],
    reviewDecision: "APPROVED",
    unresolvedThreads: 1,
    unrepliedThreads: 1,
  };
  const packet = evaluateDependabotPullRequest(
    snapshot({ feedback: repairableFeedback }),
    {
      mode: "prepare",
      repository: REPOSITORY,
      workflowContext: WORKFLOW_CONTEXT,
    },
  ).repairPacket;
  assert.notEqual(packet, null);
  const packetCheck = processorRepairReceipt(1, {
    headSha: HEAD_SHA,
    packet,
  });
  const receiptCheck = repairReceiptCheck({
    headSha: OTHER_SHA,
    packetDigest: digest(packet),
    parentHeadSha: HEAD_SHA,
    processorCheckId: packetCheck.id,
  });
  const repaired = refreshedSnapshot({
    feedback: repairableFeedback,
    repairHistoryChecks: [packetCheck, receiptCheck],
  });
  repaired.commits[1] = {
    authorId: PREPARE_ACTOR.botId,
    authorLogin: PREPARE_ACTOR.botLogin,
    authorType: "Bot",
    ...GITHUB_SYSTEM_COMMITTER,
    parents: [HEAD_SHA],
    sha: OTHER_SHA,
    verified: true,
    verificationReason: "valid",
  };
  repaired.baseAncestry.aheadBy = 2;
  const remediationProbe = evaluateDependabotPullRequest(repaired, {
    mode: "prepare",
    repository: REPOSITORY,
    workflowContext: WORKFLOW_CONTEXT,
  });
  assert.equal(
    remediationProbe.disposition,
    "feedback-remediation-required",
    stableJson({
      feedback: remediationProbe.feedback,
      identity: remediationProbe.identity,
      repairAttempts: remediationProbe.repairAttempts,
    }),
  );

  const replies = [];
  const resolved = [];
  const result = await processDependabotSweep({
    adapter: {
      approvePullRequest: async () =>
        assert.fail("feedback remediation must re-review before approval"),
      collectPullRequestSnapshot: async () => repaired,
      dismissPullRequestApproval: async () => {},
      getOutstandingDependabotAutoMergeRequests: async () => [],
      getOutstandingDependabotProcessorApprovals:
        noOutstandingProcessorApprovals,
      publishAllClear: async () =>
        assert.fail("feedback remediation must not publish ALL CLEAR"),
      publishAllClearInvalidation: async () => {},
      publishProcessorCheck: async () => ({ id: 53_001 }),
      replyToReviewComment: async (input) => replies.push(input),
      resolveReviewThread: async ({ threadId }) => resolved.push(threadId),
    },
    input: {
      mode: "prepare",
      outstandingAutoMergeRequests: [],
      pullRequests: [repaired],
      repository: REPOSITORY,
      workflowContext: WORKFLOW_CONTEXT,
    },
    phase: "finalize",
    publishChecks: true,
    workflowContext: WORKFLOW_CONTEXT,
  });
  assert.equal(replies.length, 1);
  assert.equal(replies[0].commentId, 61);
  assert.match(replies[0].body, /^Fixed in 444444444444/);
  assert.match(replies[0].body, new RegExp(`packet=${digest(packet)}`));
  assert.deepEqual(resolved, [thread.threadId]);
  assert.deepEqual(
    result.mutations.filter(({ kind }) => kind === "feedback-remediated"),
    [
      {
        headSha: OTHER_SHA,
        kind: "feedback-remediated",
        pullRequestNumber: 123,
        threadId: thread.threadId,
      },
    ],
  );

  let firstAttemptReplies = 0;
  await assert.rejects(
    processDependabotSweep({
      adapter: {
        collectPullRequestSnapshot: async () => repaired,
        dismissPullRequestApproval: async () => {},
        getOutstandingDependabotAutoMergeRequests: async () => [],
        getOutstandingDependabotProcessorApprovals:
          noOutstandingProcessorApprovals,
        publishAllClearInvalidation: async () => {},
        publishProcessorCheck: async () => ({ id: 53_010 }),
        replyToReviewComment: async () => {
          firstAttemptReplies += 1;
        },
        resolveReviewThread: async () => {
          throw new Error("resolve failed after reply");
        },
      },
      input: {
        mode: "prepare",
        outstandingAutoMergeRequests: [],
        pullRequests: [repaired],
        repository: REPOSITORY,
        workflowContext: WORKFLOW_CONTEXT,
      },
      phase: "finalize",
      publishChecks: true,
      workflowContext: WORKFLOW_CONTEXT,
    }),
    /resolve failed after reply/,
  );
  assert.equal(firstAttemptReplies, 1);

  const replyPersisted = structuredClone(repaired);
  replyPersisted.feedback.remediationCandidates = [
    {
      headSha: OTHER_SHA,
      packetDigest: digest(packet),
      pullRequestNumber: 123,
      rootCommentId: thread.rootCommentId,
      threadDigest: textDigest(thread.threadId),
      threadId: thread.threadId,
    },
  ];
  const retryResolutions = [];
  const retry = await processDependabotSweep({
    adapter: {
      collectPullRequestSnapshot: async () => replyPersisted,
      dismissPullRequestApproval: async () => {},
      getOutstandingDependabotAutoMergeRequests: async () => [],
      getOutstandingDependabotProcessorApprovals:
        noOutstandingProcessorApprovals,
      publishAllClearInvalidation: async () => {},
      publishProcessorCheck: async () => ({ id: 53_011 }),
      replyToReviewComment: async () =>
        assert.fail("a trusted persisted remediation reply must not repeat"),
      resolveReviewThread: async ({ threadId }) =>
        retryResolutions.push(threadId),
    },
    input: {
      mode: "prepare",
      outstandingAutoMergeRequests: [],
      pullRequests: [replyPersisted],
      repository: REPOSITORY,
      workflowContext: WORKFLOW_CONTEXT,
    },
    phase: "finalize",
    publishChecks: true,
    workflowContext: WORKFLOW_CONTEXT,
  });
  assert.deepEqual(retryResolutions, [thread.threadId]);
  assert.deepEqual(
    retry.mutations.filter(
      ({ kind }) => kind === "feedback-resolution-retried",
    ),
    [
      {
        headSha: OTHER_SHA,
        kind: "feedback-resolution-retried",
        pullRequestNumber: 123,
        threadId: thread.threadId,
      },
    ],
  );

  const forged = structuredClone(repaired);
  forged.feedback.actionableThreads[0].rootCommentId = 62;
  await assert.rejects(
    processDependabotSweep({
      adapter: {
        collectPullRequestSnapshot: async () => forged,
        dismissPullRequestApproval: async () => {},
        getOutstandingDependabotAutoMergeRequests: async () => [],
        getOutstandingDependabotProcessorApprovals:
          noOutstandingProcessorApprovals,
        publishAllClearInvalidation: async () => {},
        publishProcessorCheck: async () => ({ id: 53_002 }),
        replyToReviewComment: async () =>
          assert.fail("a changed root comment must not receive a reply"),
        resolveReviewThread: async () =>
          assert.fail("a changed root comment must not be resolved"),
      },
      input: {
        mode: "prepare",
        outstandingAutoMergeRequests: [],
        pullRequests: [forged],
        repository: REPOSITORY,
        workflowContext: WORKFLOW_CONTEXT,
      },
      phase: "finalize",
      publishChecks: true,
      workflowContext: WORKFLOW_CONTEXT,
    }),
    /Feedback remediation thread changed after repair/,
  );
});

test("live adapters expose only their phase capability and contain no merge adapter", () => {
  const common = {
    fetchImpl: async () => assert.fail("construction must not call GitHub"),
    prepareAppSlug: PREPARE_ACTOR.appSlug,
    prepareBotId: PREPARE_ACTOR.botId,
    prepareBotLogin: PREPARE_ACTOR.botLogin,
    token: "normal-token",
  };
  const request = createLiveGitHubAdapter({ ...common, phase: "request" });
  assert.equal(typeof request.publishRefreshReceipt, "function");
  assert.equal(request.requestPullRequestUpdateBranch, undefined);
  assert.equal(request.approvePullRequest, undefined);
  assert.equal(request.publishAllClear, undefined);
  assert.equal(request.mergePullRequest, undefined);

  const mutate = createLiveGitHubAdapter({
    ...common,
    phase: "mutate",
    repairToken: "prepare-app-token",
  });
  assert.equal(typeof mutate.requestPullRequestUpdateBranch, "function");
  assert.equal(mutate.publishRefreshReceipt, undefined);
  assert.equal(mutate.approvePullRequest, undefined);
  assert.equal(mutate.publishAllClear, undefined);
  assert.equal(mutate.mergePullRequest, undefined);

  const finalize = createLiveGitHubAdapter({ ...common, phase: "finalize" });
  assert.equal(typeof finalize.publishRefreshReceipt, "function");
  assert.equal(typeof finalize.approvePullRequest, "function");
  assert.equal(typeof finalize.publishAllClear, "function");
  assert.equal(finalize.requestPullRequestUpdateBranch, undefined);
  assert.equal(finalize.mergePullRequest, undefined);

  for (const phase of ["request", "finalize"]) {
    assert.throws(
      () =>
        createLiveGitHubAdapter({
          ...common,
          phase,
          repairToken: "prepare-app-token",
        }),
      new RegExp(`${phase} phase must not receive a Dependabot repair token`),
    );
  }
});

test("live refresh mutation binds the historical PR base and current main before update-branch", async () => {
  const operations = [];
  const fetchImpl = async (url, options = {}) => {
    const path = new URL(url).pathname;
    if (path === `/repos/${REPOSITORY}/pulls/123`) {
      operations.push("pull");
      assert.equal(options.method, "GET");
      assert.equal(options.headers.Authorization, "Bearer workflow-token");
      return new Response(
        JSON.stringify(
          liveApprovalPullRequest({
            base: {
              ref: "main",
              repo: { full_name: REPOSITORY },
              sha: MERGE_SHA,
            },
          }),
        ),
        { status: 200 },
      );
    }
    if (path === `/repos/${REPOSITORY}/pulls/123/files`) {
      operations.push("files");
      assert.equal(options.method, "GET");
      assert.equal(options.headers.Authorization, "Bearer workflow-token");
      return new Response(JSON.stringify([{ filename: "package.json" }]), {
        status: 200,
      });
    }
    if (path === `/repos/${REPOSITORY}/git/ref/heads/main`) {
      operations.push("main");
      assert.equal(options.method, "GET");
      assert.equal(options.headers.Authorization, "Bearer workflow-token");
      return new Response(
        JSON.stringify({
          object: { sha: BASE_SHA, type: "commit" },
          ref: "refs/heads/main",
        }),
        { status: 200 },
      );
    }
    assert.equal(path, `/repos/${REPOSITORY}/pulls/123/update-branch`);
    operations.push("update");
    assert.equal(options.method, "PUT");
    assert.equal(options.headers.Authorization, "Bearer prepare-app-token");
    assert.deepEqual(JSON.parse(options.body), {
      expected_head_sha: HEAD_SHA,
    });
    return new Response(JSON.stringify({ message: "Updating pull request" }), {
      status: 202,
    });
  };
  const adapter = createLiveGitHubAdapter({
    fetchImpl,
    phase: "mutate",
    prepareAppSlug: PREPARE_ACTOR.appSlug,
    prepareBotId: PREPARE_ACTOR.botId,
    prepareBotLogin: PREPARE_ACTOR.botLogin,
    repairToken: "prepare-app-token",
    token: "workflow-token",
  });
  assert.deepEqual(
    await adapter.requestPullRequestUpdateBranch({
      expectedBaseSha: BASE_SHA,
      expectedHeadSha: HEAD_SHA,
      expectedPreviousBaseSha: MERGE_SHA,
      pullRequestNumber: 123,
      repository: REPOSITORY,
    }),
    { message: "Updating pull request" },
  );
  assert.deepEqual(operations, ["pull", "files", "main", "update"]);
});

test("live refresh mutation rejects a changed historical base, head, or current main", async () => {
  const attempt = async ({
    liveBaseSha = MERGE_SHA,
    liveFilePath = "package.json",
    liveHeadSha = HEAD_SHA,
    liveMainSha = BASE_SHA,
  }) => {
    const operations = [];
    const adapter = createLiveGitHubAdapter({
      fetchImpl: async (url) => {
        const path = new URL(url).pathname;
        if (path === `/repos/${REPOSITORY}/pulls/123`) {
          operations.push("pull");
          return new Response(
            JSON.stringify(
              liveApprovalPullRequest({
                base: {
                  ref: "main",
                  repo: { full_name: REPOSITORY },
                  sha: liveBaseSha,
                },
                head: {
                  ref: "dependabot/github_actions/github-actions-routine-123",
                  repo: { full_name: REPOSITORY },
                  sha: liveHeadSha,
                },
              }),
            ),
            { status: 200 },
          );
        }
        if (path === `/repos/${REPOSITORY}/pulls/123/files`) {
          operations.push("files");
          return new Response(JSON.stringify([{ filename: liveFilePath }]), {
            status: 200,
          });
        }
        if (path === `/repos/${REPOSITORY}/git/ref/heads/main`) {
          operations.push("main");
          return new Response(
            JSON.stringify({
              object: { sha: liveMainSha, type: "commit" },
              ref: "refs/heads/main",
            }),
            { status: 200 },
          );
        }
        operations.push("update");
        return assert.fail("invalid refresh evidence reached update-branch");
      },
      phase: "mutate",
      prepareAppSlug: PREPARE_ACTOR.appSlug,
      prepareBotId: PREPARE_ACTOR.botId,
      prepareBotLogin: PREPARE_ACTOR.botLogin,
      repairToken: "prepare-app-token",
      token: "workflow-token",
    });
    const promise = adapter.requestPullRequestUpdateBranch({
      expectedBaseSha: BASE_SHA,
      expectedHeadSha: HEAD_SHA,
      expectedPreviousBaseSha: MERGE_SHA,
      pullRequestNumber: 123,
      repository: REPOSITORY,
    });
    return { operations, promise };
  };

  const previousBaseChanged = await attempt({ liveBaseSha: OTHER_SHA });
  await assert.rejects(
    previousBaseChanged.promise,
    /changed before update-branch/,
  );
  assert.deepEqual(previousBaseChanged.operations, ["pull"]);

  const headChanged = await attempt({ liveHeadSha: OTHER_SHA });
  await assert.rejects(headChanged.promise, /changed before update-branch/);
  assert.deepEqual(headChanged.operations, ["pull"]);

  const workflowChanged = await attempt({
    liveFilePath: ".github/workflows/ci.yml",
  });
  await assert.rejects(
    workflowChanged.promise,
    /cannot refresh automation authority paths/,
  );
  assert.deepEqual(workflowChanged.operations, ["pull", "files"]);

  const mainChanged = await attempt({ liveMainSha: OTHER_SHA });
  await assert.rejects(
    mainChanged.promise,
    /main changed before update-branch/,
  );
  assert.deepEqual(mainChanged.operations, ["pull", "files", "main"]);
});

test("live approval brackets the exact full PR identity and returns its post-review update token", async () => {
  const operations = [];
  let pullReads = 0;
  const fetchImpl = async (url, options = {}) => {
    const path = new URL(url).pathname;
    if (path === `/repos/${REPOSITORY}/pulls/123`) {
      operations.push("pull");
      pullReads += 1;
      return new Response(
        JSON.stringify(
          liveApprovalPullRequest({
            updated_at:
              pullReads === 1 ? "2026-08-10T10:00:00Z" : "2026-08-10T10:00:01Z",
          }),
        ),
        { status: 200 },
      );
    }
    assert.equal(path, `/repos/${REPOSITORY}/pulls/123/reviews`);
    operations.push("approve");
    assert.equal(options.method, "POST");
    assert.equal(options.headers.Authorization, "Bearer workflow-token");
    assert.deepEqual(JSON.parse(options.body), {
      body: `Approved by ${DEPENDABOT_PROCESSOR_SCHEMA} for exact head ${HEAD_SHA}.`,
      commit_id: HEAD_SHA,
      event: "APPROVE",
    });
    return new Response(
      JSON.stringify({
        commit_id: HEAD_SHA,
        id: 7001,
        state: "APPROVED",
      }),
      { status: 200 },
    );
  };
  const adapter = createLiveGitHubAdapter({
    fetchImpl,
    token: "workflow-token",
  });
  assert.deepEqual(
    await adapter.approvePullRequest({
      approvalSnapshot: snapshot(),
      headSha: HEAD_SHA,
      pullRequestNumber: 123,
      repository: REPOSITORY,
    }),
    {
      id: 7001,
      state: "APPROVED",
      updatedAt: "2026-08-10T10:00:01Z",
    },
  );
  assert.deepEqual(operations, ["pull", "approve", "pull"]);
});

test("live approval dismisses its exact review after a postflight identity race even when the head drifted", async () => {
  const operations = [];
  let pullReads = 0;
  const fetchImpl = async (url, options = {}) => {
    const path = new URL(url).pathname;
    if (path === `/repos/${REPOSITORY}/pulls/123`) {
      operations.push("pull");
      pullReads += 1;
      const current = liveApprovalPullRequest({
        updated_at:
          pullReads === 1 ? "2026-08-10T10:00:00Z" : "2026-08-10T10:00:01Z",
      });
      if (pullReads > 1) current.head.sha = OTHER_SHA;
      return new Response(JSON.stringify(current), { status: 200 });
    }
    if (path === `/repos/${REPOSITORY}/pulls/123/reviews`) {
      operations.push("approve");
      return new Response(
        JSON.stringify({
          commit_id: HEAD_SHA,
          id: 7001,
          state: "APPROVED",
        }),
        { status: 200 },
      );
    }
    if (path === `/repos/${REPOSITORY}/pulls/123/reviews/7001`) {
      operations.push("review");
      assert.equal(options.method, "GET");
      return new Response(JSON.stringify(liveProcessorReview()), {
        status: 200,
      });
    }
    assert.equal(
      path,
      `/repos/${REPOSITORY}/pulls/123/reviews/7001/dismissals`,
    );
    operations.push("dismiss");
    assert.equal(options.method, "PUT");
    assert.equal(options.headers.Authorization, "Bearer workflow-token");
    assert.deepEqual(JSON.parse(options.body), {
      event: "DISMISS",
      message:
        "Dependabot processor withdrew this approval after exact-snapshot revalidation failed.",
    });
    return new Response(JSON.stringify(liveProcessorReview("DISMISSED")), {
      status: 200,
    });
  };
  const adapter = createLiveGitHubAdapter({
    fetchImpl,
    token: "workflow-token",
  });
  await assert.rejects(
    adapter.approvePullRequest({
      approvalSnapshot: snapshot(),
      headSha: HEAD_SHA,
      pullRequestNumber: 123,
      repository: REPOSITORY,
    }),
    /changed while its exact-head snapshot was collected/,
  );
  assert.deepEqual(operations, [
    "pull",
    "approve",
    "pull",
    "pull",
    "review",
    "dismiss",
  ]);
});

test("live approval rejects and dismisses a schema-invalid create-review response", async () => {
  let pullReads = 0;
  let dismissed = false;
  const adapter = createLiveGitHubAdapter({
    fetchImpl: async (url, options = {}) => {
      const path = new URL(url).pathname;
      if (path === `/repos/${REPOSITORY}/pulls/123`) {
        pullReads += 1;
        return new Response(JSON.stringify(liveApprovalPullRequest()), {
          status: 200,
        });
      }
      if (path === `/repos/${REPOSITORY}/pulls/123/reviews`) {
        assert.equal(options.method, "POST");
        return new Response(
          JSON.stringify({
            commit_id: OTHER_SHA,
            id: 7001,
            state: "COMMENTED",
          }),
          { status: 200 },
        );
      }
      if (path === `/repos/${REPOSITORY}/pulls/123/reviews/7001`) {
        return new Response(JSON.stringify(liveProcessorReview()), {
          status: 200,
        });
      }
      dismissed = true;
      return new Response(JSON.stringify(liveProcessorReview("DISMISSED")), {
        status: 200,
      });
    },
    token: "workflow-token",
  });
  await assert.rejects(
    adapter.approvePullRequest({
      approvalSnapshot: snapshot(),
      headSha: HEAD_SHA,
      pullRequestNumber: 123,
      repository: REPOSITORY,
    }),
    /approval response is invalid/,
  );
  assert.equal(pullReads, 2);
  assert.equal(dismissed, true);
});

test("live approval dismissal validates the exact processor review and response", async () => {
  const adapter = createLiveGitHubAdapter({
    fetchImpl: async (url, options = {}) => {
      const path = new URL(url).pathname;
      if (path === `/repos/${REPOSITORY}/pulls/123`) {
        return new Response(JSON.stringify(liveApprovalPullRequest()), {
          status: 200,
        });
      }
      if (
        path === `/repos/${REPOSITORY}/pulls/123/reviews/7001` &&
        options.method === "GET"
      ) {
        return new Response(JSON.stringify(liveProcessorReview()), {
          status: 200,
        });
      }
      return new Response(JSON.stringify(liveProcessorReview("APPROVED")), {
        status: 200,
      });
    },
    token: "workflow-token",
  });
  await assert.rejects(
    adapter.dismissPullRequestApproval({
      approvalId: 7001,
      pullRequestNumber: 123,
      repository: REPOSITORY,
    }),
    /approval dismissal response is invalid/,
  );
});

test("live approval dismissal accepts a concurrent GitHub auto-dismiss after a 422", async () => {
  let reviewReads = 0;
  let dismissalWrites = 0;
  const adapter = createLiveGitHubAdapter({
    fetchImpl: async (url, options = {}) => {
      const path = new URL(url).pathname;
      if (path === `/repos/${REPOSITORY}/pulls/123`) {
        return new Response(JSON.stringify(liveApprovalPullRequest()), {
          status: 200,
        });
      }
      if (path === `/repos/${REPOSITORY}/pulls/123/reviews/7001`) {
        reviewReads += 1;
        return new Response(
          JSON.stringify(
            liveProcessorReview(reviewReads === 1 ? "APPROVED" : "DISMISSED"),
          ),
          { status: 200 },
        );
      }
      assert.equal(options.method, "PUT");
      dismissalWrites += 1;
      return new Response("already dismissed", { status: 422 });
    },
    token: "workflow-token",
  });
  assert.deepEqual(
    await adapter.dismissPullRequestApproval({
      approvalId: 7001,
      pullRequestNumber: 123,
      repository: REPOSITORY,
    }),
    { dismissed: true, id: 7001, state: "DISMISSED" },
  );
  assert.equal(reviewReads, 2);
  assert.equal(dismissalWrites, 1);
});

test("live approval dismissal is idempotent when GitHub already dismissed the review", async () => {
  const adapter = createLiveGitHubAdapter({
    fetchImpl: async (url) => {
      const path = new URL(url).pathname;
      if (path === `/repos/${REPOSITORY}/pulls/123`) {
        return new Response(JSON.stringify(liveApprovalPullRequest()), {
          status: 200,
        });
      }
      if (path === `/repos/${REPOSITORY}/pulls/123/reviews/7001`) {
        return new Response(JSON.stringify(liveProcessorReview("DISMISSED")), {
          status: 200,
        });
      }
      assert.fail("an already dismissed review must not be dismissed again");
    },
    token: "workflow-token",
  });
  assert.deepEqual(
    await adapter.dismissPullRequestApproval({
      approvalId: 7001,
      pullRequestNumber: 123,
      repository: REPOSITORY,
    }),
    { dismissed: true, id: 7001, state: "DISMISSED" },
  );
});

test("live check collection binds a check to its queried workflow repository", async () => {
  let workflowRunReads = 0;
  const fetchImpl = async (url) => {
    if (url.includes(`/repos/${REPOSITORY}/commits/${HEAD_SHA}/check-runs`)) {
      return new Response(
        JSON.stringify({
          check_runs: [
            {
              app: { id: 15368 },
              completed_at: "2026-08-10T00:01:00Z",
              conclusion: "success",
              details_url: `https://github.com/${REPOSITORY}/actions/runs/99/job/100`,
              head_sha: HEAD_SHA,
              id: 100,
              name: "Build and Test",
              started_at: "2026-08-10T00:00:00Z",
              status: "completed",
            },
          ],
        }),
        { status: 200 },
      );
    }
    if (url.endsWith(`/repos/${REPOSITORY}/actions/runs/99`)) {
      workflowRunReads += 1;
      return new Response(
        JSON.stringify({
          event: "pull_request",
          head_sha: HEAD_SHA,
          id: 99,
          path: ".github/workflows/ci.yml",
          repository: { full_name: REPOSITORY },
          run_attempt: 1,
        }),
        { status: 200 },
      );
    }
    if (url.includes(`/repos/${REPOSITORY}/commits/${HEAD_SHA}/statuses`)) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    assert.fail(`Unexpected request: ${url}`);
  };
  const adapter = createLiveGitHubAdapter({ fetchImpl, token: "test-token" });
  const [checkRun] = await adapter.getChecks(REPOSITORY, HEAD_SHA);

  assert.equal(checkRun.sourceRepository, REPOSITORY);
  const result = evaluateDependabotChecks({
    checks: [checkRun],
    headSha: HEAD_SHA,
    repository: REPOSITORY,
  });
  assert.equal(result.policy.find(({ id }) => id === "ci").state, "passing");
  assert.equal(workflowRunReads, 1);
});

test("live Claude review collection follows its exact receipt when GitHub rewrites the check URL", async () => {
  const checkRunId = 93_713_691_800;
  const workflowRunId = 31_471_141_800;
  const requestedWorkflowRuns = [];
  const fetchImpl = async (url) => {
    const path = new URL(url).pathname;
    if (path.endsWith(`/commits/${HEAD_SHA}/check-runs`)) {
      return new Response(
        JSON.stringify({
          check_runs: [
            {
              app: { id: 15_368 },
              completed_at: "2026-08-12T10:01:00Z",
              conclusion: "success",
              details_url: `https://github.com/${REPOSITORY}/runs/${checkRunId}`,
              external_id: `dependabot-claude-review:v1:pr=123:sha=${HEAD_SHA}:run=${workflowRunId}:attempt=1`,
              head_sha: HEAD_SHA,
              id: checkRunId,
              name: "claude-review",
              output: {
                text: stableJson({
                  findings: [],
                  headSha: HEAD_SHA,
                  pullRequestNumber: 123,
                  repository: REPOSITORY,
                  reviewCompleted: true,
                  schema: "dependabot-claude-review-result:v1",
                  verdict: "clean",
                }),
              },
              started_at: "2026-08-12T10:00:00Z",
              status: "completed",
            },
          ],
        }),
        { status: 200 },
      );
    }
    if (path === `/repos/${REPOSITORY}/actions/runs/${workflowRunId}`) {
      requestedWorkflowRuns.push(workflowRunId);
      return new Response(
        JSON.stringify({
          conclusion: "success",
          display_title: `dependabot-claude-review:v1 | source=dependabot-intake:v1 | repository=${REPOSITORY} | pr=123 | sha=${HEAD_SHA} | action=synchronize | receipt=true`,
          event: "workflow_run",
          head_branch: "main",
          head_sha: MERGE_SHA,
          id: workflowRunId,
          path: ".github/workflows/dependabot-claude-review.yml",
          repository: { full_name: REPOSITORY },
          run_attempt: 1,
          status: "completed",
        }),
        { status: 200 },
      );
    }
    if (path.endsWith(`/commits/${HEAD_SHA}/statuses`)) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    assert.fail(`Unexpected request: ${url}`);
  };
  const adapter = createLiveGitHubAdapter({ fetchImpl, token: "test-token" });
  const [review] = await adapter.getChecks(REPOSITORY, HEAD_SHA);

  assert.deepEqual(requestedWorkflowRuns, [workflowRunId]);
  assert.equal(review.id, checkRunId);
  assert.equal(
    review.detailsUrl,
    `https://github.com/${REPOSITORY}/runs/${checkRunId}`,
  );
  assert.equal(review.runId, workflowRunId);
  assert.equal(review.runAttempt, 1);
  assert.equal(review.sourceRepository, REPOSITORY);
  assert.equal(
    review.workflowPath,
    ".github/workflows/dependabot-claude-review.yml",
  );

  const result = evaluateDependabotChecks({
    checks: [review],
    headSha: HEAD_SHA,
    pullRequestNumber: 123,
    repository: REPOSITORY,
  });
  assert.deepEqual(
    result.policy
      .filter(({ id }) => id === "claude-review")
      .map(({ findings, reason, source, state }) => ({
        findings,
        reason,
        source,
        state,
      })),
    [
      {
        findings: [],
        reason: "passing",
        source: "trusted-source",
        state: "passing",
      },
    ],
  );
});

test("live Claude review self URLs fail closed without the exact receipt and check identity", async () => {
  const checkRunId = 93_713_691_810;
  const workflowRunId = 31_471_141_810;
  const cases = [
    {
      detailsUrl: `https://github.com/${REPOSITORY}/runs/${checkRunId}`,
      externalId: "dependabot-claude-review:v1:malformed",
      label: "malformed external receipt",
    },
    {
      detailsUrl: `https://github.com/${REPOSITORY}/runs/${checkRunId + 1}`,
      externalId: `dependabot-claude-review:v1:pr=123:sha=${HEAD_SHA}:run=${workflowRunId}:attempt=1`,
      label: "wrong self check ID",
    },
  ];

  for (const testCase of cases) {
    let workflowRunReads = 0;
    const fetchImpl = async (url) => {
      const path = new URL(url).pathname;
      if (path.endsWith(`/commits/${HEAD_SHA}/check-runs`)) {
        return new Response(
          JSON.stringify({
            check_runs: [
              {
                app: { id: 15_368 },
                completed_at: "2026-08-12T10:01:00Z",
                conclusion: "success",
                details_url: testCase.detailsUrl,
                external_id: testCase.externalId,
                head_sha: HEAD_SHA,
                id: checkRunId,
                name: "claude-review",
                started_at: "2026-08-12T10:00:00Z",
                status: "completed",
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (path.includes(`/repos/${REPOSITORY}/actions/runs/`)) {
        workflowRunReads += 1;
        return new Response(JSON.stringify({ message: "unexpected" }), {
          status: 500,
        });
      }
      if (path.endsWith(`/commits/${HEAD_SHA}/statuses`)) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      assert.fail(`Unexpected request: ${url}`);
    };
    const adapter = createLiveGitHubAdapter({
      fetchImpl,
      token: "test-token",
    });
    const [review] = await adapter.getChecks(REPOSITORY, HEAD_SHA);
    const result = evaluateDependabotChecks({
      checks: [review],
      headSha: HEAD_SHA,
      pullRequestNumber: 123,
      repository: REPOSITORY,
    });
    const policy = result.policy.find(({ id }) => id === "claude-review");

    assert.equal(workflowRunReads, 0, testCase.label);
    assert.equal(policy.state, "failing", testCase.label);
    assert.equal(policy.reason, "unexpected-source-repository", testCase.label);
  }
});

test("live check collection skips workflow-run reads for irrelevant checks and statuses", async () => {
  const fetchImpl = async (url) => {
    if (url.includes(`/repos/${REPOSITORY}/commits/${HEAD_SHA}/check-runs`)) {
      return new Response(
        JSON.stringify({
          check_runs: [
            {
              app: { id: 15_368 },
              completed_at: "2026-08-10T00:01:00Z",
              conclusion: "success",
              details_url: `https://github.com/${REPOSITORY}/actions/runs/101`,
              head_sha: HEAD_SHA,
              id: 102,
              name: "Trunk Check",
              started_at: "2026-08-10T00:00:00Z",
              status: "completed",
            },
          ],
        }),
        { status: 200 },
      );
    }
    if (url.includes(`/repos/${REPOSITORY}/commits/${HEAD_SHA}/statuses`)) {
      return new Response(
        JSON.stringify([
          {
            context: "argos/summary",
            creator: { login: "github-actions[bot]" },
            id: 103,
            state: "success",
            target_url: `https://github.com/${REPOSITORY}/actions/runs/104`,
            updated_at: "2026-08-10T00:01:00Z",
          },
        ]),
        { status: 200 },
      );
    }
    assert.fail(`Irrelevant evidence must not fetch its workflow run: ${url}`);
  };
  const adapter = createLiveGitHubAdapter({ fetchImpl, token: "test-token" });
  const checks = await adapter.getChecks(REPOSITORY, HEAD_SHA);

  assert.deepEqual(
    checks.map(({ name, runId, sourceRepository, workflowPath }) => ({
      name,
      runId,
      sourceRepository,
      workflowPath,
    })),
    [
      {
        name: "Trunk Check",
        runId: undefined,
        sourceRepository: undefined,
        workflowPath: undefined,
      },
      {
        name: "argos/summary",
        runId: undefined,
        sourceRepository: undefined,
        workflowPath: undefined,
      },
    ],
  );
});

test("live check collection caches relevant workflow provenance across repeated collections", async () => {
  let checkReads = 0;
  let workflowRunReads = 0;
  const fetchImpl = async (url) => {
    if (url.includes(`/repos/${REPOSITORY}/commits/${HEAD_SHA}/check-runs`)) {
      checkReads += 1;
      return new Response(
        JSON.stringify({
          check_runs: [
            {
              app: { id: 15_368 },
              completed_at: "2026-08-10T00:01:00Z",
              conclusion: "success",
              details_url: `https://github.com/${REPOSITORY}/actions/runs/105`,
              head_sha: HEAD_SHA,
              id: 106,
              name: "Build and Test",
              started_at: "2026-08-10T00:00:00Z",
              status: "completed",
            },
          ],
        }),
        { status: 200 },
      );
    }
    if (url.endsWith(`/repos/${REPOSITORY}/actions/runs/105`)) {
      workflowRunReads += 1;
      return new Response(
        JSON.stringify({
          conclusion: "success",
          event: "pull_request",
          head_branch: "dependabot/test",
          head_sha: HEAD_SHA,
          id: 105,
          path: ".github/workflows/ci.yml",
          repository: { full_name: REPOSITORY },
          run_attempt: 1,
          status: "completed",
        }),
        { status: 200 },
      );
    }
    if (url.includes(`/repos/${REPOSITORY}/commits/${HEAD_SHA}/statuses`)) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    assert.fail(`Unexpected request: ${url}`);
  };
  const adapter = createLiveGitHubAdapter({ fetchImpl, token: "test-token" });

  for (let collection = 0; collection < 2; collection += 1) {
    const [check] = await adapter.getChecks(REPOSITORY, HEAD_SHA);
    assert.equal(check.runId, 105);
    assert.equal(check.sourceRepository, REPOSITORY);
    assert.equal(check.workflowPath, ".github/workflows/ci.yml");
  }
  assert.equal(checkReads, 2);
  assert.equal(workflowRunReads, 1);
});

test("live check collection bounds concurrent workflow-run enrichment for checks and statuses", async () => {
  const checkCount = 12;
  const statusCount = 12;
  const relevantCheckNames = [
    "Build and Test",
    "Action Pin Policy",
    "Action Pin Policy Source",
    "dependency-review",
    "osv-scanner / osv-scan",
    "osv-scanner (trusted pnpm runtime) / osv-scan",
    "osv-scanner (standalone Vercel CLI runtime) / osv-scan",
    "osv-scanner (trusted pnpm bootstrap) / osv-scan",
    "lockfile integrity + registry",
    "catalog version-skew",
    "coverage and production bundles",
    "E2E Plan",
  ];
  const firstWorkflowRunId = 31_471_141_700;
  const firstStatusWorkflowRunId = firstWorkflowRunId + checkCount;
  let activeWorkflowRunGets = 0;
  let maxConcurrentWorkflowRunGets = 0;
  let releaseScheduled = false;
  let workflowRunGets = 0;
  const pendingReleases = [];
  const waitForCurrentWave = () =>
    new Promise((resolve) => {
      pendingReleases.push(resolve);
      if (releaseScheduled) return;
      releaseScheduled = true;
      queueMicrotask(() => {
        releaseScheduled = false;
        const currentWave = pendingReleases.splice(0);
        for (const release of currentWave) release();
      });
    });
  const fetchImpl = async (url) => {
    if (url.includes(`/repos/${REPOSITORY}/commits/${HEAD_SHA}/check-runs`)) {
      return new Response(
        JSON.stringify({
          check_runs: Array.from({ length: checkCount }, (_, index) => {
            const workflowRunId = firstWorkflowRunId + index;
            return {
              app: { id: 15_368 },
              completed_at: "2026-08-11T08:24:00Z",
              conclusion: "success",
              details_url: `https://github.com/${REPOSITORY}/actions/runs/${workflowRunId}`,
              head_sha: HEAD_SHA,
              id: 93_713_691_500 + index,
              name: relevantCheckNames[index],
              started_at: "2026-08-11T08:23:59Z",
              status: "completed",
            };
          }),
        }),
        { status: 200 },
      );
    }
    const workflowRunMatch = /\/actions\/runs\/([1-9][0-9]*)$/.exec(url);
    if (workflowRunMatch) {
      const workflowRunId = Number(workflowRunMatch[1]);
      workflowRunGets += 1;
      activeWorkflowRunGets += 1;
      maxConcurrentWorkflowRunGets = Math.max(
        maxConcurrentWorkflowRunGets,
        activeWorkflowRunGets,
      );
      await waitForCurrentWave();
      activeWorkflowRunGets -= 1;
      return new Response(
        JSON.stringify({
          conclusion: "success",
          event: "pull_request",
          head_branch: "dependabot/test",
          head_sha: HEAD_SHA,
          id: workflowRunId,
          path: ".github/workflows/ci.yml",
          repository: { full_name: REPOSITORY },
          run_attempt: 1,
          status: "completed",
        }),
        { status: 200 },
      );
    }
    if (url.includes(`/repos/${REPOSITORY}/commits/${HEAD_SHA}/statuses`)) {
      return new Response(
        JSON.stringify(
          Array.from({ length: statusCount }, (_, index) => {
            const workflowRunId = firstStatusWorkflowRunId + index;
            return {
              context: "Vercel Preview",
              creator: { login: "github-actions[bot]" },
              id: 93_713_691_600 + index,
              state: "success",
              target_url: `https://github.com/${REPOSITORY}/actions/runs/${workflowRunId}`,
              updated_at: "2026-08-11T08:24:00Z",
            };
          }),
        ),
        { status: 200 },
      );
    }
    assert.fail(`Unexpected request: ${url}`);
  };
  const adapter = createLiveGitHubAdapter({ fetchImpl, token: "test-token" });
  const checks = await adapter.getChecks(REPOSITORY, HEAD_SHA);

  assert.equal(checks.length, checkCount + statusCount);
  assert.equal(workflowRunGets, checkCount + statusCount);
  assert.equal(activeWorkflowRunGets, 0);
  assert.ok(maxConcurrentWorkflowRunGets > 0);
  assert.ok(maxConcurrentWorkflowRunGets <= 8);
  assert.deepEqual(
    checks.map(({ runId }) => runId),
    [
      ...Array.from(
        { length: checkCount },
        (_, index) => firstWorkflowRunId + index,
      ),
      ...Array.from(
        { length: statusCount },
        (_, index) => firstStatusWorkflowRunId + index,
      ),
    ],
  );
});

test("live typed receipt enrichment preserves historical attempts without cache poisoning", async () => {
  const workflowRunId = 31_471_141_750;
  const workflowContextForAttempt = (workflowRunAttempt) => ({
    ...WORKFLOW_CONTEXT,
    workflowRunAttempt,
    workflowRunId,
  });
  const historicalReceipt = processorRepairReceipt(1, {
    id: 93_713_691_750,
    packet: false,
    workflowContext: workflowContextForAttempt(1),
  });
  const currentReceipt = processorRepairReceipt(1, {
    id: 93_713_691_751,
    packet: false,
    workflowContext: workflowContextForAttempt(2),
  });
  const requestedRunPaths = [];
  const fetchImpl = async (url) => {
    const path = new URL(url).pathname;
    if (path.endsWith(`/commits/${HEAD_SHA}/check-runs`)) {
      return new Response(
        JSON.stringify({
          check_runs: [
            {
              app: { id: 15_368 },
              completed_at: "2026-08-11T08:25:00Z",
              conclusion: historicalReceipt.conclusion,
              details_url: `https://github.com/${REPOSITORY}/actions/runs/${workflowRunId}`,
              external_id: historicalReceipt.externalId,
              head_sha: HEAD_SHA,
              id: historicalReceipt.id,
              name: historicalReceipt.name,
              started_at: "2026-08-11T08:24:59Z",
              status: "completed",
            },
            {
              app: { id: 15_368 },
              completed_at: "2026-08-11T08:26:00Z",
              conclusion: currentReceipt.conclusion,
              details_url: `https://github.com/${REPOSITORY}/actions/runs/${workflowRunId}`,
              external_id: currentReceipt.externalId,
              head_sha: HEAD_SHA,
              id: currentReceipt.id,
              name: currentReceipt.name,
              started_at: "2026-08-11T08:25:59Z",
              status: "completed",
            },
            {
              app: { id: 15_368 },
              completed_at: "2026-08-11T08:26:00Z",
              conclusion: "failure",
              details_url: `https://github.com/${REPOSITORY}/actions/runs/${workflowRunId}`,
              head_sha: HEAD_SHA,
              id: 93_713_691_752,
              name: "Build and Test",
              started_at: "2026-08-11T08:25:59Z",
              status: "completed",
            },
          ],
        }),
        { status: 200 },
      );
    }
    if (
      path === `/repos/${REPOSITORY}/actions/runs/${workflowRunId}` ||
      path === `/repos/${REPOSITORY}/actions/runs/${workflowRunId}/attempts/1`
    ) {
      requestedRunPaths.push(path);
      const historical = path.endsWith("/attempts/1");
      return new Response(
        JSON.stringify({
          conclusion: "success",
          display_title: historical ? "historical attempt" : "latest attempt",
          event: "repository_dispatch",
          head_branch: "main",
          head_sha: MERGE_SHA,
          id: workflowRunId,
          path: ".github/workflows/dependabot-process.yml",
          repository: { full_name: REPOSITORY },
          run_attempt: historical ? 1 : 2,
          status: "completed",
        }),
        { status: 200 },
      );
    }
    if (path.endsWith(`/commits/${HEAD_SHA}/statuses`)) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    assert.fail(`Unexpected request: ${url}`);
  };
  const adapter = createLiveGitHubAdapter({ fetchImpl, token: "test-token" });

  for (let collection = 0; collection < 2; collection += 1) {
    const checks = await adapter.getChecks(REPOSITORY, HEAD_SHA);
    assert.ok(parseDependabotProcessorReceipt(checks[0], REPOSITORY));
    assert.ok(parseDependabotProcessorReceipt(checks[1], REPOSITORY));
    assert.deepEqual(
      checks.map(({ runAttempt, runConclusion, runDisplayTitle, runId }) => ({
        runAttempt,
        runConclusion,
        runDisplayTitle,
        runId,
      })),
      [
        {
          runAttempt: 1,
          runConclusion: "success",
          runDisplayTitle: "historical attempt",
          runId: workflowRunId,
        },
        {
          runAttempt: 2,
          runConclusion: "success",
          runDisplayTitle: "latest attempt",
          runId: workflowRunId,
        },
        {
          runAttempt: 2,
          runConclusion: "success",
          runDisplayTitle: "latest attempt",
          runId: workflowRunId,
        },
      ],
    );
  }
  assert.deepEqual(requestedRunPaths, [
    `/repos/${REPOSITORY}/actions/runs/${workflowRunId}`,
    `/repos/${REPOSITORY}/actions/runs/${workflowRunId}/attempts/1`,
  ]);
});

test("live typed receipt attempt enrichment fails closed on fetch and identity errors", async () => {
  const workflowRunId = 31_471_141_760;
  const receipt = processorRepairReceipt(1, {
    id: 93_713_691_760,
    workflowContext: {
      ...WORKFLOW_CONTEXT,
      workflowRunAttempt: 1,
      workflowRunId,
    },
  });
  const cases = [
    {
      attemptResponse: new Response(JSON.stringify({ message: "Not Found" }), {
        status: 404,
      }),
      expected: /attempts\/1 failed with 404/,
      label: "missing historical attempt",
    },
    {
      attemptResponse: new Response(
        JSON.stringify({ id: workflowRunId + 1, run_attempt: 1 }),
        { status: 200 },
      ),
      expected: /attempt 1 response is invalid/,
      label: "mismatched run ID",
    },
    {
      attemptResponse: new Response(
        JSON.stringify({ id: workflowRunId, run_attempt: 2 }),
        { status: 200 },
      ),
      expected: /attempt 1 response is invalid/,
      label: "mismatched attempt",
    },
  ];

  for (const testCase of cases) {
    const fetchImpl = async (url) => {
      const path = new URL(url).pathname;
      if (path.endsWith(`/commits/${HEAD_SHA}/check-runs`)) {
        return new Response(
          JSON.stringify({
            check_runs: [
              {
                app: { id: 15_368 },
                completed_at: "2026-08-11T08:25:00Z",
                conclusion: "failure",
                details_url: `https://github.com/${REPOSITORY}/actions/runs/${workflowRunId}`,
                external_id: receipt.externalId,
                head_sha: HEAD_SHA,
                id: receipt.id,
                name: receipt.name,
                started_at: "2026-08-11T08:24:59Z",
                status: "completed",
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (path === `/repos/${REPOSITORY}/actions/runs/${workflowRunId}`) {
        return new Response(
          JSON.stringify({
            id: workflowRunId,
            repository: { full_name: REPOSITORY },
            run_attempt: 2,
          }),
          { status: 200 },
        );
      }
      if (
        path === `/repos/${REPOSITORY}/actions/runs/${workflowRunId}/attempts/1`
      ) {
        return testCase.attemptResponse.clone();
      }
      assert.fail(`Unexpected request: ${url}`);
    };
    const adapter = createLiveGitHubAdapter({
      fetchImpl,
      token: "test-token",
    });
    await assert.rejects(
      adapter.getChecks(REPOSITORY, HEAD_SHA),
      testCase.expected,
      testCase.label,
    );
  }
});

test("live post-merge collection follows the durable external receipt when GitHub rewrites the check URL", async () => {
  const checkRunId = 93_713_691_394;
  const workflowRunId = 31_471_141_674;
  const requestedWorkflowRuns = [];
  const fetchImpl = async (url) => {
    if (url.includes(`/repos/${REPOSITORY}/commits/${BASE_SHA}/check-runs`)) {
      return new Response(
        JSON.stringify({
          check_runs: [
            {
              app: { id: 15_368 },
              completed_at: "2026-08-11T08:20:00Z",
              conclusion: "success",
              details_url: `https://github.com/${REPOSITORY}/runs/${checkRunId}`,
              external_id: `dependabot-post-merge:${workflowRunId}:1`,
              head_sha: BASE_SHA,
              id: checkRunId,
              name: "Dependabot Post-Merge Verification",
              started_at: "2026-08-11T08:19:59Z",
              status: "completed",
            },
          ],
        }),
        { status: 200 },
      );
    }
    if (url.endsWith(`/repos/${REPOSITORY}/actions/runs/${workflowRunId}`)) {
      requestedWorkflowRuns.push(workflowRunId);
      return new Response(
        JSON.stringify({
          conclusion: "success",
          event: "workflow_run",
          head_branch: "main",
          head_sha: BASE_SHA,
          id: workflowRunId,
          path: ".github/workflows/vercel-main-deployment.yml",
          repository: { full_name: REPOSITORY },
          run_attempt: 1,
          status: "completed",
        }),
        { status: 200 },
      );
    }
    if (url.includes(`/repos/${REPOSITORY}/commits/${BASE_SHA}/statuses`)) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    assert.fail(`Unexpected request: ${url}`);
  };
  const adapter = createLiveGitHubAdapter({ fetchImpl, token: "test-token" });
  const [receipt] = await adapter.getChecks(REPOSITORY, BASE_SHA);

  assert.deepEqual(requestedWorkflowRuns, [workflowRunId]);
  assert.equal(receipt.id, checkRunId);
  assert.equal(
    receipt.detailsUrl,
    `https://github.com/${REPOSITORY}/runs/${checkRunId}`,
  );
  assert.equal(receipt.externalId, `dependabot-post-merge:${workflowRunId}:1`);
  assert.equal(receipt.runId, workflowRunId);
  assert.equal(receipt.runAttempt, 1);
  assert.equal(receipt.runConclusion, "success");
  assert.equal(receipt.runHeadBranch, "main");
  assert.equal(receipt.runHeadSha, BASE_SHA);
  assert.equal(receipt.sourceRepository, REPOSITORY);
  assert.equal(receipt.runStatus, "completed");
  assert.equal(receipt.workflowEvent, "workflow_run");
  assert.equal(
    receipt.workflowPath,
    ".github/workflows/vercel-main-deployment.yml",
  );

  const result = evaluatePrepareSerializationReceipt(receipt);
  assert.equal(result.serialization.ready, true);
  assert.deepEqual(result.serialization.check, {
    conclusion: "success",
    headSha: BASE_SHA,
    name: "Dependabot Post-Merge Verification",
    runAttempt: 1,
    runId: workflowRunId,
  });
});

test("live post-merge collection refetches mutable workflow-run state for every gate snapshot", async () => {
  const checkRunId = 93_713_691_395;
  const workflowRunId = 31_471_141_675;
  let checkReads = 0;
  let workflowRunReads = 0;
  const fetchImpl = async (url) => {
    if (url.includes(`/repos/${REPOSITORY}/commits/${BASE_SHA}/check-runs`)) {
      checkReads += 1;
      return new Response(
        JSON.stringify({
          check_runs: [
            {
              app: { id: 15_368 },
              completed_at: "2026-08-11T08:21:00Z",
              conclusion: "success",
              details_url: `https://github.com/${REPOSITORY}/runs/${checkRunId}`,
              external_id: `dependabot-post-merge:${workflowRunId}:1`,
              head_sha: BASE_SHA,
              id: checkRunId,
              name: "Dependabot Post-Merge Verification",
              started_at: "2026-08-11T08:20:59Z",
              status: "completed",
            },
          ],
        }),
        { status: 200 },
      );
    }
    if (url.endsWith(`/repos/${REPOSITORY}/actions/runs/${workflowRunId}`)) {
      workflowRunReads += 1;
      const completed = workflowRunReads === 1;
      return new Response(
        JSON.stringify({
          conclusion: completed ? "success" : null,
          event: "workflow_run",
          head_branch: "main",
          head_sha: BASE_SHA,
          id: workflowRunId,
          path: ".github/workflows/vercel-main-deployment.yml",
          repository: { full_name: REPOSITORY },
          run_attempt: 1,
          status: completed ? "completed" : "in_progress",
        }),
        { status: 200 },
      );
    }
    if (url.includes(`/repos/${REPOSITORY}/commits/${BASE_SHA}/statuses`)) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    assert.fail(`Unexpected request: ${url}`);
  };
  const adapter = createLiveGitHubAdapter({ fetchImpl, token: "test-token" });

  const [firstReceipt] = await adapter.getChecks(REPOSITORY, BASE_SHA);
  const firstResult = evaluatePrepareSerializationReceipt(firstReceipt);
  assert.equal(firstReceipt.runStatus, "completed");
  assert.equal(firstReceipt.runConclusion, "success");
  assert.equal(firstResult.serialization.ready, true);

  const [secondReceipt] = await adapter.getChecks(REPOSITORY, BASE_SHA);
  const secondResult = evaluatePrepareSerializationReceipt(secondReceipt);
  assert.equal(secondReceipt.runStatus, "in_progress");
  assert.equal(secondReceipt.runConclusion, null);
  assert.equal(secondResult.serialization.ready, false);
  assert.equal(
    secondResult.serialization.reason,
    "post-merge-workflow-not-successful",
  );
  assert.equal(secondResult.prepareCandidate, null);
  assert.equal(checkReads, 2);
  assert.equal(workflowRunReads, 2);
});

test("live post-merge collection preserves an absent workflow head as null across stable JSON", async () => {
  const cases = [
    { explicitNull: false, label: "omitted" },
    { explicitNull: true, label: "null" },
  ];
  let omittedReceipt = null;
  for (const [index, testCase] of cases.entries()) {
    const checkRunId = 93_713_691_400 + index;
    const workflowRunId = 31_471_141_680 + index;
    const fetchImpl = async (url) => {
      if (url.includes(`/repos/${REPOSITORY}/commits/${BASE_SHA}/check-runs`)) {
        return new Response(
          JSON.stringify({
            check_runs: [
              {
                app: { id: 15_368 },
                completed_at: "2026-08-11T08:22:00Z",
                conclusion: "success",
                details_url: `https://github.com/${REPOSITORY}/runs/${checkRunId}`,
                external_id: `dependabot-post-merge:${workflowRunId}:1`,
                head_sha: BASE_SHA,
                id: checkRunId,
                name: "Dependabot Post-Merge Verification",
                started_at: "2026-08-11T08:21:59Z",
                status: "completed",
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.endsWith(`/repos/${REPOSITORY}/actions/runs/${workflowRunId}`)) {
        const workflowRun = {
          conclusion: "success",
          event: "workflow_run",
          head_branch: "main",
          id: workflowRunId,
          path: ".github/workflows/vercel-main-deployment.yml",
          repository: { full_name: REPOSITORY },
          run_attempt: 1,
          status: "completed",
        };
        if (testCase.explicitNull) workflowRun.head_sha = null;
        return new Response(JSON.stringify(workflowRun), { status: 200 });
      }
      if (url.includes(`/repos/${REPOSITORY}/commits/${BASE_SHA}/statuses`)) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      assert.fail(`Unexpected request: ${url}`);
    };
    const adapter = createLiveGitHubAdapter({ fetchImpl, token: "test-token" });
    const [receipt] = await adapter.getChecks(REPOSITORY, BASE_SHA);

    assert.equal(receipt.runHeadSha, null, testCase.label);
    if (!testCase.explicitNull) omittedReceipt = receipt;
    const result = evaluatePrepareSerializationReceipt(receipt);
    assert.equal(result.serialization.ready, false, testCase.label);
    assert.equal(
      result.serialization.reason,
      "untrusted-post-merge-source-ref",
      testCase.label,
    );
    assert.equal(result.prepareCandidate, null, testCase.label);
  }

  assert.notEqual(omittedReceipt, null);
  const persistedReceipt = JSON.parse(stableJson(omittedReceipt));
  assert.equal(persistedReceipt.runHeadSha, null);
  const persistedResult = evaluatePrepareSerializationReceipt(persistedReceipt);
  assert.equal(persistedResult.serialization.ready, false);
  assert.equal(
    persistedResult.serialization.reason,
    "untrusted-post-merge-source-ref",
  );
  assert.equal(persistedResult.prepareCandidate, null);
});

test("live post-merge collection dereferences only the newest exact receipt", async () => {
  const olderCheckRunId = 93_713_691_410;
  const olderWorkflowRunId = 31_471_141_690;
  const newerCheckRunId = olderCheckRunId + 1;
  const newerWorkflowRunId = olderWorkflowRunId + 1;
  const checkRunPages = [];
  const requestedWorkflowRuns = [];
  const fetchImpl = async (url) => {
    if (url.includes(`/repos/${REPOSITORY}/commits/${BASE_SHA}/check-runs`)) {
      const page = Number(new URL(url).searchParams.get("page"));
      checkRunPages.push(page);
      const newerReceipt = {
        app: { id: 15_368 },
        completed_at: "2026-08-11T08:20:00Z",
        conclusion: "success",
        details_url: `https://github.com/${REPOSITORY}/runs/${newerCheckRunId}`,
        external_id: `dependabot-post-merge:${newerWorkflowRunId}:1`,
        head_sha: BASE_SHA,
        id: newerCheckRunId,
        name: "Dependabot Post-Merge Verification",
        started_at: "2026-08-11T08:19:59Z",
        status: "completed",
      };
      const olderReceipt = {
        app: { id: 15_368 },
        completed_at: "2026-08-11T08:23:00Z",
        conclusion: "success",
        details_url: `https://github.com/${REPOSITORY}/runs/${olderCheckRunId}`,
        external_id: `dependabot-post-merge:${olderWorkflowRunId}:1`,
        head_sha: BASE_SHA,
        id: olderCheckRunId,
        name: "Dependabot Post-Merge Verification",
        started_at: "2026-08-11T08:22:59Z",
        status: "completed",
      };
      const unrelatedChecks = Array.from({ length: 99 }, (_, index) => ({
        app: { id: 15_368 },
        completed_at: "2026-08-11T08:21:00Z",
        conclusion: "success",
        details_url: null,
        head_sha: BASE_SHA,
        id: 50_000 + index,
        name: `Unrelated check ${index}`,
        started_at: "2026-08-11T08:20:59Z",
        status: "completed",
      }));
      const checkRuns =
        page === 1
          ? [newerReceipt, ...unrelatedChecks]
          : page === 2
            ? [olderReceipt]
            : [];
      return new Response(JSON.stringify({ check_runs: checkRuns }), {
        status: 200,
      });
    }
    if (
      url.endsWith(`/repos/${REPOSITORY}/actions/runs/${olderWorkflowRunId}`)
    ) {
      requestedWorkflowRuns.push(olderWorkflowRunId);
      return new Response(JSON.stringify({ message: "Not Found" }), {
        status: 404,
      });
    }
    if (
      url.endsWith(`/repos/${REPOSITORY}/actions/runs/${newerWorkflowRunId}`)
    ) {
      requestedWorkflowRuns.push(newerWorkflowRunId);
      return new Response(
        JSON.stringify({
          conclusion: "success",
          event: "workflow_run",
          head_branch: "main",
          head_sha: BASE_SHA,
          id: newerWorkflowRunId,
          path: ".github/workflows/vercel-main-deployment.yml",
          repository: { full_name: REPOSITORY },
          run_attempt: 1,
          status: "completed",
        }),
        { status: 200 },
      );
    }
    if (url.includes(`/repos/${REPOSITORY}/commits/${BASE_SHA}/statuses`)) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    assert.fail(`Unexpected request: ${url}`);
  };
  const adapter = createLiveGitHubAdapter({ fetchImpl, token: "test-token" });
  const receipts = await adapter.getChecks(REPOSITORY, BASE_SHA);

  assert.deepEqual(checkRunPages, [1, 2]);
  assert.deepEqual(requestedWorkflowRuns, [newerWorkflowRunId]);
  const current = snapshot();
  current.baseline.checks = [
    ...current.baseline.checks.filter(
      ({ name }) => name !== "Dependabot Post-Merge Verification",
    ),
    ...receipts,
  ];
  const result = evaluateDependabotSweep({
    mode: "prepare",
    pullRequests: [current],
    repository: REPOSITORY,
    workflowContext: WORKFLOW_CONTEXT,
  });
  assert.equal(result.serialization.ready, true);
  assert.equal(result.serialization.check.runId, newerWorkflowRunId);
  assert.deepEqual(result.prepareCandidate, {
    disposition: "prepare-candidate",
    headSha: HEAD_SHA,
    pullRequestNumber: 123,
  });
});

test("live check collection authenticates the current Dependabot Vercel intake status envelope", async () => {
  const runId = 31_421_269_407;
  const statusId = 51_972_724_561;
  const fetchImpl = async (url) => {
    if (url.includes(`/repos/${REPOSITORY}/commits/${HEAD_SHA}/check-runs`)) {
      return new Response(JSON.stringify({ check_runs: [] }), { status: 200 });
    }
    if (url.endsWith(`/repos/${REPOSITORY}/actions/runs/${runId}`)) {
      return new Response(
        JSON.stringify({
          display_title: `Vercel preview intake | pr=123 | sha=${HEAD_SHA} | action=edited`,
          event: "pull_request_target",
          head_branch: "dependabot/npm_and_yarn/frontend-core-2f0c077f04",
          head_sha: HEAD_SHA,
          id: runId,
          path: ".github/workflows/vercel-preview-intake.yml",
          repository: { full_name: REPOSITORY },
          run_attempt: 1,
        }),
        { status: 200 },
      );
    }
    if (url.includes(`/repos/${REPOSITORY}/commits/${HEAD_SHA}/statuses`)) {
      return new Response(
        JSON.stringify([
          {
            context: "Vercel Preview",
            creator: { login: "github-actions[bot]", type: "Bot" },
            description: "Preview disabled for Dependabot PR",
            id: statusId,
            state: "success",
            target_url: `https://github.com/${REPOSITORY}/actions/runs/${runId}`,
            updated_at: "2026-08-10T18:53:02Z",
          },
        ]),
        { status: 200 },
      );
    }
    assert.fail(`Unexpected request: ${url}`);
  };
  const adapter = createLiveGitHubAdapter({ fetchImpl, token: "test-token" });
  const [status] = await adapter.getChecks(REPOSITORY, HEAD_SHA);
  assert.equal(status.description, "Preview disabled for Dependabot PR");
  const result = evaluateDependabotChecks({
    checks: [status],
    headSha: HEAD_SHA,
    pullRequestNumber: 123,
    repository: REPOSITORY,
  });
  assert.equal(
    result.policy.find(({ id }) => id === "vercel-preview").state,
    "passing",
  );
});

test("live repair-history collection filters preparation receipts after the all-checks query", async () => {
  const requested = [];
  const receipt = processorRepairReceipt(1);
  const adapter = createLiveGitHubAdapter({
    fetchImpl: async (url) => {
      const parsed = new URL(url);
      requested.push(parsed);
      if (parsed.pathname.endsWith(`/commits/${HEAD_SHA}/statuses`)) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      assert.equal(
        parsed.pathname,
        `/repos/${REPOSITORY}/commits/${HEAD_SHA}/check-runs`,
      );
      assert.equal(parsed.searchParams.get("check_name"), null);
      assert.equal(parsed.searchParams.get("filter"), "all");
      return new Response(
        JSON.stringify({
          check_runs: [
            {
              app: { id: receipt.appId },
              completed_at: "2026-08-10T10:00:00Z",
              conclusion: receipt.conclusion,
              external_id: receipt.externalId,
              head_sha: receipt.headSha,
              id: receipt.id,
              name: receipt.name,
              started_at: "2026-08-10T09:59:00Z",
              status: receipt.status,
            },
          ],
        }),
        { status: 200 },
      );
    },
    token: "test-token",
  });
  assert.deepEqual(await adapter.getProcessorChecks(REPOSITORY, HEAD_SHA), [
    {
      appId: 15_368,
      completedAt: "2026-08-10T10:00:00Z",
      conclusion: "failure",
      detailsUrl: undefined,
      externalId: receipt.externalId,
      headSha: HEAD_SHA,
      id: receipt.id,
      kind: "check",
      name: "Dependabot Processor",
      outputSummary: null,
      outputText: null,
      startedAt: "2026-08-10T09:59:00Z",
      status: "completed",
    },
  ]);
  assert.equal(requested.length, 2);
});

test("published processor checks carry exact-head durable repair receipts and observe cannot consume one", async () => {
  const bodies = [];
  const adapter = createLiveGitHubAdapter({
    fetchImpl: async (url, options = {}) => {
      assert.equal(url.endsWith(`/repos/${REPOSITORY}/check-runs`), true);
      bodies.push(JSON.parse(options.body));
      return new Response(
        JSON.stringify({ html_url: "https://github.com/checks/1", id: 1 }),
        { status: 201 },
      );
    },
    token: "test-token",
  });
  const repairPacket = evaluateDependabotPullRequest(
    snapshot({ checks: completeChecks({ conclusions: { ci: "failure" } }) }),
    {
      mode: "prepare",
      repository: REPOSITORY,
      workflowContext: WORKFLOW_CONTEXT,
    },
  ).repairPacket;
  await adapter.publishProcessorCheck({
    disposition: "repair-required",
    headSha: HEAD_SHA,
    mode: "prepare",
    pullRequestNumber: 123,
    repairAttempt: 2,
    repairPacket,
    repository: REPOSITORY,
    summary: "Disposition: repair-required",
    workflowContext: WORKFLOW_CONTEXT,
  });
  const publishedPacketText = bodies[0].output.text;
  assert.equal(
    bodies[0].external_id,
    `${DEPENDABOT_PROCESSOR_SCHEMA}:pr=123:head=${HEAD_SHA}:mode=prepare:repair=2:packet=true:digest=${rawDigest(publishedPacketText)}:run=${WORKFLOW_CONTEXT.workflowRunId}:attempt=${WORKFLOW_CONTEXT.workflowRunAttempt}`,
  );
  assert.equal(bodies[0].conclusion, "failure");
  assert.equal(
    bodies[0].details_url,
    `https://github.com/${REPOSITORY}/actions/runs/${WORKFLOW_CONTEXT.workflowRunId}`,
  );
  assert.equal(publishedPacketText, canonicalJson(repairPacket));
  assert.deepEqual(
    parseCanonicalJson(publishedPacketText, "repair packet"),
    repairPacket,
  );
  assert.ok(
    publishedPacketText.indexOf('"requireExactHead"') <
      publishedPacketText.indexOf('"requiredGateIds"'),
  );
  await assert.rejects(
    adapter.publishProcessorCheck({
      disposition: "repair-required",
      headSha: HEAD_SHA,
      mode: "observe",
      pullRequestNumber: 123,
      repairAttempt: 1,
      repairPacket,
      repository: REPOSITORY,
      summary: "Disposition: repair-required",
      workflowContext: WORKFLOW_CONTEXT,
    }),
    /Observe processor checks cannot issue repair packets/,
  );
});

test("processor checks keep safe non-packet dispositions neutral and fail packets or unsafe states", async () => {
  const bodies = [];
  const adapter = createLiveGitHubAdapter({
    fetchImpl: async (url, options = {}) => {
      assert.equal(url.endsWith(`/repos/${REPOSITORY}/check-runs`), true);
      bodies.push(JSON.parse(options.body));
      return new Response(
        JSON.stringify({ html_url: "https://github.com/checks/1", id: 1 }),
        { status: 201 },
      );
    },
    token: "test-token",
  });
  const repairPacket = evaluateDependabotPullRequest(
    snapshot({ checks: completeChecks({ conclusions: { ci: "failure" } }) }),
    {
      mode: "prepare",
      repository: REPOSITORY,
      workflowContext: WORKFLOW_CONTEXT,
    },
  ).repairPacket;
  const actionableManualSummary =
    "Disposition: manual-review. Reason: sensitive-auth-deployment-or-workflow-policy-action. Next action: have a maintainer agent merge the current base into the branch without rebasing or force-pushing, resolve conflicts, fix valid findings, validate, push, reply to every review comment, and resolve eligible threads, then report the exact final head and stop; do not dismiss a review, submit a review approval, create a processor approval, publish or claim Dependabot ALL CLEAR, enable auto-merge, or merge.";
  const cases = [
    {
      disposition: "prepare-candidate",
      expectedConclusion: "neutral",
      mode: "prepare",
      repairPacket: null,
    },
    {
      disposition: "refresh-pending",
      expectedConclusion: "neutral",
      mode: "prepare",
      repairPacket: null,
    },
    {
      disposition: "ready-for-human-review",
      expectedConclusion: "neutral",
      mode: "assist",
      repairPacket: null,
    },
    {
      disposition: "eligible-observed",
      expectedConclusion: "neutral",
      mode: "observe",
      repairPacket: null,
    },
    {
      disposition: "manual-review",
      expectedConclusion: "failure",
      mode: "prepare",
      repairPacket: null,
      summary: actionableManualSummary,
    },
    {
      disposition: "waiting-checks",
      expectedConclusion: "failure",
      mode: "prepare",
      repairPacket: null,
    },
    {
      disposition: "waiting-retry",
      expectedConclusion: "failure",
      mode: "prepare",
      repairPacket: null,
    },
    {
      disposition: "repair-required",
      expectedConclusion: "failure",
      mode: "prepare",
      repairPacket,
    },
  ];

  for (const testCase of cases) {
    await adapter.publishProcessorCheck({
      disposition: testCase.disposition,
      headSha: HEAD_SHA,
      mode: testCase.mode,
      pullRequestNumber: 123,
      repairAttempt: 1,
      repairPacket: testCase.repairPacket,
      repository: REPOSITORY,
      summary: testCase.summary ?? `Disposition: ${testCase.disposition}`,
      workflowContext: WORKFLOW_CONTEXT,
    });
  }

  assert.deepEqual(
    bodies.map(({ conclusion }) => conclusion),
    cases.map(({ expectedConclusion }) => expectedConclusion),
  );
  const manualBody =
    bodies[
      cases.findIndex(({ disposition }) => disposition === "manual-review")
    ];
  assert.equal(manualBody.output.summary, actionableManualSummary);
  assert.equal(Object.hasOwn(manualBody.output, "text"), false);
  await assert.rejects(
    adapter.publishProcessorCheck({
      disposition: "manual-review",
      headSha: HEAD_SHA,
      mode: "prepare",
      pullRequestNumber: 123,
      repairAttempt: 1,
      repairPacket: null,
      repository: REPOSITORY,
      summary: "Disposition: manual-review",
      workflowContext: WORKFLOW_CONTEXT,
    }),
    /canonical disposition/,
  );
});

test("authority check publications bind their exact Actions run URL and reject missing run IDs", async () => {
  const requestBodies = [];
  const finalizeBodies = [];
  const publisher = (bodies, phase) =>
    createLiveGitHubAdapter({
      fetchImpl: async (url, options = {}) => {
        assert.equal(url.endsWith(`/repos/${REPOSITORY}/check-runs`), true);
        bodies.push(JSON.parse(options.body));
        return new Response(
          JSON.stringify({
            html_url: `https://github.com/${REPOSITORY}/runs/${bodies.length}`,
            id: bodies.length,
          }),
          { status: 201 },
        );
      },
      phase,
      token: "test-token",
    });
  const requestAdapter = publisher(requestBodies, "request");
  const finalizeAdapter = publisher(finalizeBodies, "finalize");
  const requestedReceipt = JSON.parse(
    refreshReceiptCheck("requested").outputText,
  );
  const completedReceipt = JSON.parse(
    refreshReceiptCheck("completed").outputText,
  );
  const allClearReceipt = {
    autoMergeEnabled: false,
    baseSha: BASE_SHA,
    checksDigest: "a".repeat(64),
    feedbackDigest: "b".repeat(64),
    headRef: "dependabot/github_actions/github-actions-routine-123",
    headSha: HEAD_SHA,
    humanAction: "merge",
    mergeAuthorizedByAutomation: false,
    mergeStateStatus: "CLEAN",
    mergeable: true,
    preparation: {
      kind: "native",
      operationDigests: [],
      refreshCount: 0,
      repairCount: 0,
      seedHeadSha: HEAD_SHA,
    },
    processorApprovalId: 7_001,
    pullRequestNumber: 123,
    repository: REPOSITORY,
    reviewDecision: "APPROVED",
    riskTier: "safe-actions-patch-minor",
    schema: DEPENDABOT_ALL_CLEAR_SCHEMA,
    updateType: "minor",
    ...WORKFLOW_CONTEXT,
  };

  await requestAdapter.publishRefreshReceipt({
    receipt: requestedReceipt,
    repository: REPOSITORY,
  });
  await finalizeAdapter.publishRefreshReceipt({
    receipt: completedReceipt,
    repository: REPOSITORY,
  });
  await finalizeAdapter.publishAllClear({
    receipt: allClearReceipt,
    repository: REPOSITORY,
  });
  await finalizeAdapter.publishAllClearInvalidation({
    headSha: HEAD_SHA,
    pullRequestNumber: 123,
    repository: REPOSITORY,
  });
  await finalizeAdapter.publishAllClearInvalidation({
    blocking: false,
    headSha: HEAD_SHA,
    pullRequestNumber: 123,
    repository: REPOSITORY,
  });

  const expectedDetailsUrl = `https://github.com/${REPOSITORY}/actions/runs/${WORKFLOW_CONTEXT.workflowRunId}`;
  assert.equal(requestBodies[0].details_url, expectedDetailsUrl);
  assert.deepEqual(
    finalizeBodies.slice(0, 2).map(({ details_url: detailsUrl }) => detailsUrl),
    [expectedDetailsUrl, expectedDetailsUrl],
  );
  assert.equal(Object.hasOwn(finalizeBodies[2], "details_url"), false);
  assert.equal(finalizeBodies[2].conclusion, "failure");
  assert.equal(
    finalizeBodies[2].output.title,
    "Dependabot ALL CLEAR invalidated",
  );
  assert.equal(finalizeBodies[3].conclusion, "neutral");
  assert.equal(
    finalizeBodies[3].output.title,
    "Dependabot ALL CLEAR authority absent",
  );
  assert.equal(
    finalizeBodies[3].external_id,
    `dependabot-all-clear-tombstone:v1:pr=123:head=${HEAD_SHA}`,
  );
  assert.equal(Object.hasOwn(finalizeBodies[3], "details_url"), false);

  const { workflowRunId: omittedProcessorRunId, ...missingProcessorRunId } =
    WORKFLOW_CONTEXT;
  assert.equal(omittedProcessorRunId, WORKFLOW_CONTEXT.workflowRunId);
  for (const workflowContext of [
    missingProcessorRunId,
    { ...WORKFLOW_CONTEXT, workflowRunId: 0 },
  ]) {
    await assert.rejects(
      finalizeAdapter.publishProcessorCheck({
        disposition: "prepare-candidate",
        headSha: HEAD_SHA,
        mode: "prepare",
        pullRequestNumber: 123,
        repairAttempt: 1,
        repairPacket: null,
        repository: REPOSITORY,
        summary: "Disposition: prepare-candidate",
        workflowContext,
      }),
      /workflow run ID/i,
    );
  }

  const withoutRunId = (receipt) => {
    const { workflowRunId, ...rest } = receipt;
    assert.equal(workflowRunId, WORKFLOW_CONTEXT.workflowRunId);
    return rest;
  };
  for (const receipt of [
    withoutRunId(requestedReceipt),
    { ...requestedReceipt, workflowRunId: "not-a-run" },
  ]) {
    await assert.rejects(
      requestAdapter.publishRefreshReceipt({ receipt, repository: REPOSITORY }),
      /workflow run ID/i,
    );
  }
  for (const receipt of [
    withoutRunId(allClearReceipt),
    { ...allClearReceipt, workflowRunId: "not-a-run" },
  ]) {
    await assert.rejects(
      finalizeAdapter.publishAllClear({ receipt, repository: REPOSITORY }),
      /workflow run ID/i,
    );
  }
  assert.equal(requestBodies.length, 1);
  assert.equal(finalizeBodies.length, 4);
});

test("live feedback collection paginates threads, top-level reviews, and issue comments", async () => {
  const graphqlCursors = [];
  const restPages = [];
  const publicActor = {
    author_association: "NONE",
    user: { login: "public-user", type: "User" },
  };
  const fetchImpl = async (url, options = {}) => {
    const parsed = new URL(url);
    if (url.endsWith("/graphql")) {
      const { variables } = JSON.parse(options.body);
      graphqlCursors.push(variables.after);
      const second = variables.after === "thread-page-2";
      return new Response(
        JSON.stringify({
          data: {
            repository: {
              pullRequest: {
                autoMergeRequest: null,
                headRefOid: HEAD_SHA,
                id: "PR_node",
                isDraft: false,
                mergeStateStatus: "CLEAN",
                reviewDecision: "APPROVED",
                reviewThreads: {
                  nodes: [
                    {
                      comments: {
                        nodes: [
                          {
                            author: {
                              __typename: "User",
                              login: "public-user",
                            },
                            authorAssociation: "NONE",
                            body: "Untrusted public feedback",
                            createdAt: "2026-08-10T10:00:00Z",
                            databaseId: second ? 102 : 101,
                            pullRequestReview: {
                              commit: { oid: HEAD_SHA },
                              databaseId: second ? 202 : 201,
                            },
                            replyTo: null,
                          },
                        ],
                        pageInfo: { hasNextPage: false },
                        totalCount: 1,
                      },
                      id: second ? "thread-2" : "thread-1",
                      isOutdated: false,
                      isResolved: true,
                    },
                  ],
                  pageInfo: {
                    endCursor: second ? null : "thread-page-2",
                    hasNextPage: !second,
                  },
                },
                updatedAt: "2026-08-10T10:00:00Z",
              },
            },
          },
        }),
        { status: 200 },
      );
    }
    const page = Number(parsed.searchParams.get("page"));
    restPages.push(`${parsed.pathname}:${page}`);
    if (page === 2) return new Response(JSON.stringify([]), { status: 200 });
    if (parsed.pathname === `/repos/${REPOSITORY}/pulls/123/reviews`) {
      return new Response(
        JSON.stringify(
          Array.from({ length: 100 }, (_, index) => ({
            ...publicActor,
            body: "",
            commit_id: HEAD_SHA,
            id: index + 1,
            state: "COMMENTED",
          })),
        ),
        { status: 200 },
      );
    }
    if (parsed.pathname === `/repos/${REPOSITORY}/issues/123/comments`) {
      return new Response(
        JSON.stringify(
          Array.from({ length: 100 }, (_, index) => ({
            ...publicActor,
            body: "Public comment",
            created_at: "2026-08-10T10:00:00Z",
            id: index + 1,
            updated_at: "2026-08-10T10:00:00Z",
          })),
        ),
        { status: 200 },
      );
    }
    assert.fail(`Unexpected request: ${url}`);
  };
  const adapter = createLiveGitHubAdapter({ fetchImpl, token: "test-token" });
  const result = await adapter.getFeedback(REPOSITORY, 123);
  assert.deepEqual(graphqlCursors, [null, "thread-page-2"]);
  assert.equal(result.threadCount, 2);
  assert.equal(result.reviewCount, 100);
  assert.equal(result.issueCommentCount, 100);
  assert.equal(result.complete, true);
  assert.deepEqual(result.reasons, []);
  assert.deepEqual(restPages, [
    `/repos/${REPOSITORY}/pulls/123/reviews:1`,
    `/repos/${REPOSITORY}/issues/123/comments:1`,
    `/repos/${REPOSITORY}/pulls/123/reviews:2`,
    `/repos/${REPOSITORY}/issues/123/comments:2`,
  ]);
});

test("live feedback verifies maintenance authors by repository permission", async () => {
  const maintenanceUser = {
    id: 117495,
    login: "maintainer",
    type: "User",
  };
  const collect = async ({
    authorCount = 1,
    lookupTracker = null,
    permission = "admin",
    permissionStatus = 200,
  } = {}) => {
    const maintenanceUsers = Array.from({ length: authorCount }, (_, index) =>
      index === 0
        ? maintenanceUser
        : {
            id: maintenanceUser.id + index,
            login: `maintainer-${index + 1}`,
            type: "User",
          },
    );
    const fetchImpl = async (url) => {
      const parsed = new URL(url);
      if (parsed.pathname === "/graphql") {
        return new Response(
          JSON.stringify({
            data: {
              repository: {
                pullRequest: {
                  autoMergeRequest: null,
                  headRefOid: HEAD_SHA,
                  id: "PR_node",
                  isDraft: false,
                  mergeStateStatus: "CLEAN",
                  reviewDecision: "APPROVED",
                  reviewThreads: {
                    nodes: [],
                    pageInfo: { endCursor: null, hasNextPage: false },
                  },
                  updatedAt: "2026-08-10T10:00:00Z",
                },
              },
            },
          }),
          { status: 200 },
        );
      }
      if (parsed.pathname === `/repos/${REPOSITORY}/pulls/123/reviews`) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (parsed.pathname === `/repos/${REPOSITORY}/issues/123/comments`) {
        return new Response(
          JSON.stringify(
            maintenanceUsers.map((user, index) => ({
              author_association: "NONE",
              body: "@dependabot recreate",
              created_at: "2026-08-10T10:00:00Z",
              id: 41 + index,
              updated_at: "2026-08-10T10:00:00Z",
              user,
            })),
          ),
          { status: 200 },
        );
      }
      const permissionPrefix = `/repos/${REPOSITORY}/collaborators/`;
      if (
        parsed.pathname.startsWith(permissionPrefix) &&
        parsed.pathname.endsWith("/permission")
      ) {
        const login = decodeURIComponent(
          parsed.pathname.slice(permissionPrefix.length, -"/permission".length),
        );
        const user = maintenanceUsers.find(
          (candidate) => candidate.login === login,
        );
        assert.ok(user, `Unexpected permission author: ${login}`);
        if (lookupTracker !== null) {
          lookupTracker.active += 1;
          lookupTracker.maxActive = Math.max(
            lookupTracker.maxActive,
            lookupTracker.active,
          );
          await new Promise((resolve) => setTimeout(resolve, 1));
          lookupTracker.active -= 1;
          lookupTracker.completed += 1;
        }
        return new Response(JSON.stringify({ permission, user }), {
          status: permissionStatus,
        });
      }
      assert.fail(`Unexpected request: ${url}`);
    };
    return createLiveGitHubAdapter({
      fetchImpl,
      token: "test-token",
    }).getFeedback(REPOSITORY, 123);
  };

  const admin = await collect();
  assert.deepEqual(admin.branchMaintenanceComments, [
    {
      actor: {
        association: "NONE",
        login: "maintainer",
        repositoryPermission: "admin",
        type: "User",
      },
      body: "@dependabot recreate",
      createdAt: "2026-08-10T10:00:00Z",
      id: 41,
      updatedAt: "2026-08-10T10:00:00Z",
    },
  ]);

  for (const options of [{ permission: "read" }, { permissionStatus: 404 }]) {
    const untrusted = await collect(options);
    assert.deepEqual(untrusted.branchMaintenanceComments, []);
    assert.deepEqual(untrusted.reasons, []);
  }

  await assert.rejects(
    collect({ permission: "maintain" }),
    /repository permission response/i,
  );

  const lookupTracker = { active: 0, completed: 0, maxActive: 0 };
  const bounded = await collect({ authorCount: 9, lookupTracker });
  assert.equal(bounded.branchMaintenanceComments.length, 9);
  assert.deepEqual(lookupTracker, {
    active: 0,
    completed: 9,
    maxActive: 4,
  });

  const cappedTracker = { active: 0, completed: 0, maxActive: 0 };
  await assert.rejects(
    collect({ authorCount: 21, lookupTracker: cappedTracker }),
    /permission lookup cap exceeded/i,
  );
  assert.deepEqual(cappedTracker, {
    active: 0,
    completed: 0,
    maxActive: 0,
  });
});

test("live feedback collection marks an over-cap thread instead of dropping replies", async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith("/graphql")) {
      return new Response(
        JSON.stringify({
          data: {
            repository: {
              pullRequest: {
                autoMergeRequest: null,
                headRefOid: HEAD_SHA,
                id: "PR_node",
                isDraft: false,
                mergeStateStatus: "CLEAN",
                reviewDecision: "APPROVED",
                reviewThreads: {
                  nodes: [
                    {
                      comments: {
                        nodes: Array.from({ length: 100 }, (_, index) => ({
                          author: { __typename: "User", login: "public-user" },
                          authorAssociation: "NONE",
                          body: "feedback",
                          createdAt: "2026-08-10T10:00:00Z",
                          databaseId: index + 1,
                          pullRequestReview: {
                            commit: { oid: HEAD_SHA },
                            databaseId: 201,
                          },
                          replyTo: index === 0 ? null : { databaseId: 1 },
                        })),
                        pageInfo: { hasNextPage: true },
                        totalCount: 101,
                      },
                      id: "thread-over-cap",
                      isOutdated: false,
                      isResolved: true,
                    },
                  ],
                  pageInfo: { endCursor: null, hasNextPage: false },
                },
                updatedAt: "2026-08-10T10:00:00Z",
              },
            },
          },
        }),
        { status: 200 },
      );
    }
    return new Response(JSON.stringify([]), { status: 200 });
  };
  const adapter = createLiveGitHubAdapter({ fetchImpl, token: "test-token" });
  const result = await adapter.getFeedback(REPOSITORY, 123);
  assert.equal(result.complete, false);
  assert.deepEqual(result.reasons, ["feedback-thread-comments-cap-exceeded"]);
});

test("live durable intervention evidence preserves the force-push chain and survives a reopen", async () => {
  const requestedPages = [];
  const forcePushEvents = [
    {
      actor: {
        __typename: "Bot",
        databaseId: DEPENDABOT_ACTOR.id,
        login: "dependabot",
      },
      afterCommit: { oid: OTHER_SHA },
      beforeCommit: { oid: MERGE_SHA },
      createdAt: "2026-08-10T09:00:00Z",
      id: "force-push-event-1",
      ref: {
        name: "dependabot/github_actions/github-actions-routine-123",
        prefix: "refs/heads/",
      },
    },
    {
      actor: null,
      afterCommit: { oid: SECOND_HEAD_SHA },
      beforeCommit: { oid: OTHER_SHA },
      createdAt: "2026-08-10T10:00:00Z",
      id: "force-push-event-2",
      ref: {
        name: "dependabot/github_actions/github-actions-routine-123",
        prefix: "refs/heads/",
      },
    },
  ];
  const fetchImpl = async (url, options = {}) => {
    const parsed = new URL(url);
    if (parsed.pathname === "/graphql") {
      const { query } = JSON.parse(options.body);
      assert.match(query, /DependabotForcePushHistory/);
      return new Response(
        JSON.stringify(forcePushTimelinePayload(forcePushEvents)),
        { status: 200 },
      );
    }
    const commitSha = new RegExp(
      `^/repos/${REPOSITORY}/commits/([0-9a-f]{40})$`,
    ).exec(parsed.pathname)?.[1];
    if (commitSha) {
      return new Response(
        JSON.stringify({
          author: DEPENDABOT_ACTOR,
          commit: { verification: { reason: "valid", verified: true } },
          committer: {
            id: GITHUB_SYSTEM_COMMITTER.committerId,
            login: GITHUB_SYSTEM_COMMITTER.committerLogin,
            type: GITHUB_SYSTEM_COMMITTER.committerType,
          },
          parents: [{ sha: BASE_SHA }],
          sha: commitSha,
        }),
        { status: 200 },
      );
    }
    assert.equal(parsed.pathname, `/repos/${REPOSITORY}/issues/123/events`);
    const page = Number(parsed.searchParams.get("page"));
    requestedPages.push(page);
    if (page === 1) {
      return new Response(
        JSON.stringify(
          Array.from({ length: 100 }, (_, index) => ({
            actor: { login: "dependabot[bot]" },
            event: index === 0 ? "closed" : "reopened",
          })),
        ),
        {
          headers: {
            link: `<https://api.github.com/repos/${REPOSITORY}/issues/123/events?per_page=100&page=2>; rel="next"`,
          },
          status: 200,
        },
      );
    }
    if (page === 2) {
      return new Response(
        JSON.stringify([
          { actor: { login: "alice" }, event: "closed" },
          { actor: { login: "alice" }, event: "reopened" },
        ]),
        { status: 200 },
      );
    }
    assert.fail(`Unexpected issue-event page: ${page}`);
  };
  const adapter = createLiveGitHubAdapter({ fetchImpl, token: "test-token" });
  const evidence = await adapter.getHumanCloseEvidence(REPOSITORY, 123);
  assert.deepEqual(requestedPages, [1, 2]);
  assert.deepEqual(evidence, {
    forcePushActors: ["dependabot[bot]", "unknown-actor"],
    forcePushCommitIds: [OTHER_SHA, SECOND_HEAD_SHA],
    forcePushCommits: [],
    forcePushEventCount: 2,
    forcePushEvents: [
      {
        actorId: DEPENDABOT_ACTOR.id,
        actorLogin: "dependabot",
        actorType: DEPENDABOT_ACTOR.type,
        afterSha: OTHER_SHA,
        beforeSha: MERGE_SHA,
        createdAt: "2026-08-10T09:00:00Z",
        eventId: "force-push-event-1",
        headRef:
          "refs/heads/dependabot/github_actions/github-actions-routine-123",
      },
      {
        actorId: null,
        actorLogin: null,
        actorType: null,
        afterSha: SECOND_HEAD_SHA,
        beforeSha: OTHER_SHA,
        createdAt: "2026-08-10T10:00:00Z",
        eventId: "force-push-event-2",
        headRef:
          "refs/heads/dependabot/github_actions/github-actions-routine-123",
      },
    ],
    forcePushEventsComplete: true,
    forcePushed: true,
    humanCloseActors: ["alice"],
    humanClosed: true,
    humanIntervened: true,
    humanReopenActors: ["alice"],
    humanReopened: true,
  });
  const rewritten = snapshot({
    checks: completeChecks({ conclusions: { ci: "failure" } }),
    commits: [{ authorLogin: "dependabot[bot]", sha: HEAD_SHA }],
    feedback: evidence,
    repairHistoryChecks: [],
  });
  const evaluation = evaluateDependabotPullRequest(rewritten, {
    mode: "prepare",
    repository: REPOSITORY,
  });
  assert.equal(evaluation.identity.automaticAuthority, false);
  assert.equal(evaluation.repairPacket, null);
});

test("live native force-push collection binds every commit in one continuous generation", async () => {
  const headRef = "dependabot/github_actions/github-actions-routine-123";
  let commitReads = 0;
  const forcePushEvent = {
    actor: {
      __typename: "Bot",
      databaseId: DEPENDABOT_ACTOR.id,
      login: "dependabot",
    },
    afterCommit: { oid: HEAD_SHA },
    beforeCommit: { oid: OTHER_SHA },
    createdAt: "2026-08-10T09:00:00Z",
    id: "force-push-event-1",
    ref: { name: headRef, prefix: "refs/heads/" },
  };
  const fetchImpl = async (url, options = {}) => {
    const path = new URL(url).pathname;
    if (path === "/graphql") {
      const { query } = JSON.parse(options.body);
      assert.match(query, /DependabotForcePushHistory/);
      return new Response(
        JSON.stringify(forcePushTimelinePayload([forcePushEvent])),
        { status: 200 },
      );
    }
    if (path === `/repos/${REPOSITORY}/issues/123/events`) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    const commitSha = new RegExp(
      `^/repos/${REPOSITORY}/commits/([0-9a-f]{40})$`,
    ).exec(path)?.[1];
    if (commitSha) {
      commitReads += 1;
      return new Response(
        JSON.stringify({
          author: DEPENDABOT_ACTOR,
          commit: { verification: { reason: "valid", verified: true } },
          committer: {
            id: GITHUB_SYSTEM_COMMITTER.committerId,
            login: GITHUB_SYSTEM_COMMITTER.committerLogin,
            type: GITHUB_SYSTEM_COMMITTER.committerType,
          },
          parents: [{ sha: commitSha === HEAD_SHA ? BASE_SHA : MERGE_SHA }],
          sha: commitSha,
        }),
        { status: 200 },
      );
    }
    assert.fail(`Unexpected request: ${url}`);
  };
  const adapter = createLiveGitHubAdapter({ fetchImpl, token: "test-token" });
  const evidence = await adapter.getHumanCloseEvidence(REPOSITORY, 123);
  const repeated = await adapter.getHumanCloseEvidence(REPOSITORY, 123);

  assert.deepEqual(repeated, evidence);
  assert.equal(commitReads, 2);
  assert.equal(evidence.forcePushEventsComplete, true);
  assert.deepEqual(evidence.forcePushEvents, [
    {
      actorId: DEPENDABOT_ACTOR.id,
      actorLogin: "dependabot",
      actorType: DEPENDABOT_ACTOR.type,
      afterSha: HEAD_SHA,
      beforeSha: OTHER_SHA,
      createdAt: "2026-08-10T09:00:00Z",
      eventId: "force-push-event-1",
      headRef: `refs/heads/${headRef}`,
    },
  ]);
  assert.deepEqual(
    evidence.forcePushCommits.map(({ sha }) => sha),
    [HEAD_SHA, OTHER_SHA],
  );

  const evaluation = evaluateDependabotPullRequest(
    snapshot({
      commits: [nativeDependabotCommit(HEAD_SHA)],
      feedback: evidence,
      metadata: {
        ...snapshot().metadata,
        immutableEvidence: {
          ...snapshot().metadata.immutableEvidence,
          seedCommitSha: HEAD_SHA,
          seedCommitTrusted: true,
        },
      },
      pullRequest: { author: DEPENDABOT_ACTOR },
    }),
    { mode: "prepare", repository: REPOSITORY },
  );
  assert.equal(evaluation.feedback.forcePushGenerationKind, "native");
  assert.equal(evaluation.identity.prepareAuthority, true);
});

test("live collection can select a native recreate generation after a non-Dependabot prefix", async () => {
  const headRef = "dependabot/github_actions/github-actions-routine-123";
  const forcePushEvents = [
    ...Array.from({ length: 49 }, (_, index) => ({
      actor: {
        __typename: "User",
        databaseId: 7,
        login: "alice",
      },
      afterCommit: {
        oid: (index * 2 + 2).toString(16).padStart(40, "0"),
      },
      beforeCommit: {
        oid: (index * 2 + 1).toString(16).padStart(40, "0"),
      },
      createdAt: new Date(
        Date.parse("2026-08-10T08:00:00Z") + index * 1_000,
      ).toISOString(),
      id: `force-push-event-${index + 1}`,
      ref: { name: headRef, prefix: "refs/heads/" },
    })),
    {
      actor: {
        __typename: "Bot",
        databaseId: DEPENDABOT_ACTOR.id,
        login: "dependabot",
      },
      afterCommit: { oid: HEAD_SHA },
      beforeCommit: { oid: MERGE_SHA },
      createdAt: "2026-08-10T10:00:00Z",
      id: "force-push-event-50",
      ref: { name: headRef, prefix: "refs/heads/" },
    },
  ];
  const branchMaintenanceComments = [
    {
      actor: { association: "MEMBER", login: "bob", type: "User" },
      body: "@dependabot recreate",
      createdAt: "2026-08-10T09:00:00Z",
      id: 41,
      updatedAt: "2026-08-10T09:00:00Z",
    },
  ];
  const fetchImpl = async (url, options = {}) => {
    const path = new URL(url).pathname;
    if (path === "/graphql") {
      const { query } = JSON.parse(options.body);
      assert.match(query, /DependabotForcePushHistory/);
      return new Response(
        JSON.stringify(forcePushTimelinePayload(forcePushEvents)),
        { status: 200 },
      );
    }
    if (path === `/repos/${REPOSITORY}/issues/123/events`) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    const commitSha = new RegExp(
      `^/repos/${REPOSITORY}/commits/([0-9a-f]{40})$`,
    ).exec(path)?.[1];
    if (commitSha) {
      return new Response(
        JSON.stringify({
          author: DEPENDABOT_ACTOR,
          commit: { verification: { reason: "valid", verified: true } },
          committer: {
            id: GITHUB_SYSTEM_COMMITTER.committerId,
            login: GITHUB_SYSTEM_COMMITTER.committerLogin,
            type: GITHUB_SYSTEM_COMMITTER.committerType,
          },
          parents: [{ sha: BASE_SHA }],
          sha: commitSha,
        }),
        { status: 200 },
      );
    }
    assert.fail(`Unexpected request: ${url}`);
  };
  const adapter = createLiveGitHubAdapter({ fetchImpl, token: "test-token" });
  const feedback = await adapter.getHumanCloseEvidence(
    REPOSITORY,
    123,
    branchMaintenanceComments,
  );
  feedback.branchMaintenanceComments = branchMaintenanceComments;

  assert.deepEqual(
    feedback.forcePushCommits.map(({ sha }) => sha),
    [HEAD_SHA],
  );
  const evaluation = evaluateDependabotPullRequest(
    snapshot({
      commits: [nativeDependabotCommit(HEAD_SHA)],
      feedback,
      metadata: {
        ...snapshot().metadata,
        immutableEvidence: {
          ...snapshot().metadata.immutableEvidence,
          seedCommitSha: HEAD_SHA,
          seedCommitTrusted: true,
        },
      },
      pullRequest: { author: DEPENDABOT_ACTOR },
    }),
    { mode: "prepare", repository: REPOSITORY },
  );
  assert.equal(evaluation.feedback.forcePushGenerationKind, "native");
  assert.equal(evaluation.identity.prepareAuthority, true);
});

test("live repository-wide processor approval visibility paginates open PRs and every review page", async () => {
  const listPages = [];
  const reviewPages = [];
  let pullDetailReads = 0;
  const dependabotPull = () => {
    const pullRequest = liveApprovalPullRequest({ node_id: "PR_A" });
    pullRequest.head = { ...pullRequest.head, sha: OTHER_SHA };
    return pullRequest;
  };
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    if (
      parsed.pathname === `/repos/${REPOSITORY}/pulls` &&
      parsed.searchParams.get("state") === "open"
    ) {
      const page = Number(parsed.searchParams.get("page"));
      listPages.push(page);
      return new Response(
        JSON.stringify(
          page === 1
            ? Array.from({ length: 100 }, (_, index) => ({
                number: index + 1_000,
                user: { login: "human-author" },
              }))
            : page === 2
              ? [dependabotPull()]
              : [],
        ),
        { status: 200 },
      );
    }
    if (parsed.pathname === `/repos/${REPOSITORY}/pulls/123`) {
      pullDetailReads += 1;
      return new Response(JSON.stringify(dependabotPull()), { status: 200 });
    }
    if (parsed.pathname === `/repos/${REPOSITORY}/pulls/123/reviews`) {
      const page = Number(parsed.searchParams.get("page"));
      reviewPages.push(page);
      return new Response(
        JSON.stringify(
          page === 1
            ? Array.from({ length: 100 }, (_, index) =>
                index === 0
                  ? {
                      body: "Historical automated approval",
                      commit_id: HEAD_SHA,
                      id: 1,
                      state: "APPROVED",
                      user: { login: "github-actions[bot]", type: "Bot" },
                    }
                  : {
                      body: "",
                      commit_id: OTHER_SHA,
                      id: index + 1,
                      state: "COMMENTED",
                      user: { login: "human-reviewer", type: "User" },
                    },
              )
            : page === 2
              ? [
                  liveProcessorReview("APPROVED", {
                    body: `Approved by ${DEPENDABOT_PROCESSOR_SCHEMA} for exact head ${OTHER_SHA}.`,
                    commit_id: OTHER_SHA,
                    id: 6001,
                  }),
                ]
              : [],
        ),
        { status: 200 },
      );
    }
    assert.fail(`Unexpected request: ${url}`);
  };
  const adapter = createLiveGitHubAdapter({ fetchImpl, token: "test-token" });
  assert.deepEqual(
    await adapter.getOutstandingDependabotProcessorApprovals(REPOSITORY),
    [
      {
        approvalId: 6001,
        headSha: OTHER_SHA,
        pullRequestNumber: 123,
      },
    ],
  );
  assert.deepEqual(listPages, [1, 2, 1, 2]);
  assert.deepEqual(reviewPages, [1, 2]);
  assert.equal(pullDetailReads, 2);
});

test("live repository-wide processor approval visibility retries one full snapshot drift", async () => {
  let detailReads = 0;
  let listReads = 0;
  let reviewReads = 0;
  const updatedAt = (value) =>
    liveApprovalPullRequest({ updated_at: `2026-08-10T10:00:0${value}Z` });
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname === `/repos/${REPOSITORY}/pulls`) {
      listReads += 1;
      const version = listReads === 1 ? 0 : 1;
      return new Response(JSON.stringify([updatedAt(version)]), {
        status: 200,
      });
    }
    if (parsed.pathname === `/repos/${REPOSITORY}/pulls/123`) {
      detailReads += 1;
      return new Response(JSON.stringify(updatedAt(detailReads <= 2 ? 0 : 1)), {
        status: 200,
      });
    }
    if (parsed.pathname === `/repos/${REPOSITORY}/pulls/123/reviews`) {
      reviewReads += 1;
      return new Response(JSON.stringify([liveProcessorReview()]), {
        status: 200,
      });
    }
    assert.fail(`Unexpected request: ${url}`);
  };
  const adapter = createLiveGitHubAdapter({ fetchImpl, token: "test-token" });

  assert.deepEqual(
    await adapter.getOutstandingDependabotProcessorApprovals(REPOSITORY),
    [
      {
        approvalId: 7_001,
        headSha: HEAD_SHA,
        pullRequestNumber: 123,
      },
    ],
  );
  assert.equal(listReads, 4);
  assert.equal(detailReads, 4);
  assert.equal(reviewReads, 2);
});

test("live repository-wide processor approval visibility rejects a second full snapshot drift", async () => {
  let detailReads = 0;
  let listReads = 0;
  const updatedAt = (value) =>
    liveApprovalPullRequest({ updated_at: `2026-08-10T10:00:0${value}Z` });
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname === `/repos/${REPOSITORY}/pulls`) {
      listReads += 1;
      const version = [0, 1, 1, 2][listReads - 1];
      return new Response(JSON.stringify([updatedAt(version)]), {
        status: 200,
      });
    }
    if (parsed.pathname === `/repos/${REPOSITORY}/pulls/123`) {
      detailReads += 1;
      return new Response(
        JSON.stringify(detailReads <= 2 ? updatedAt(0) : updatedAt(1)),
        { status: 200 },
      );
    }
    if (parsed.pathname === `/repos/${REPOSITORY}/pulls/123/reviews`) {
      return new Response(JSON.stringify([liveProcessorReview()]), {
        status: 200,
      });
    }
    assert.fail(`Unexpected request: ${url}`);
  };
  const adapter = createLiveGitHubAdapter({ fetchImpl, token: "test-token" });

  await assert.rejects(
    adapter.getOutstandingDependabotProcessorApprovals(REPOSITORY),
    /Repository-wide processor approval PR set changed during collection/,
  );
  assert.equal(listReads, 4);
  assert.equal(detailReads, 4);
});

test("a targeted PR B sweep rejects an unbound current github-actions approval on PR A before writes", async () => {
  let detailReads = 0;
  const writes = [];
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname === `/repos/${REPOSITORY}/pulls`) {
      return new Response(JSON.stringify([liveApprovalPullRequest()]), {
        status: 200,
      });
    }
    if (parsed.pathname === `/repos/${REPOSITORY}/pulls/123`) {
      detailReads += 1;
      return new Response(JSON.stringify(liveApprovalPullRequest()), {
        status: 200,
      });
    }
    if (parsed.pathname === `/repos/${REPOSITORY}/pulls/123/reviews`) {
      return new Response(
        JSON.stringify([
          liveProcessorReview("APPROVED", {
            body: "Legacy automated approval without a bound processor envelope",
          }),
        ]),
        { status: 200 },
      );
    }
    assert.fail(`Unexpected request: ${url}`);
  };
  const liveAdapter = createLiveGitHubAdapter({
    fetchImpl,
    token: "test-token",
  });
  await assert.rejects(
    processDependabotSweep({
      adapter: {
        ...liveAdapter,
        approvePullRequest: async () => writes.push("approve"),
        dismissPullRequestApproval: async () => writes.push("dismiss"),
        getOutstandingDependabotAutoMergeRequests: async () => {
          writes.push("auto-merge-read");
          return [];
        },
        publishProcessorCheck: async () => writes.push("publish"),
      },
      input: {
        mode: "assist",
        outstandingAutoMergeRequests: [],
        pullRequests: [
          snapshot({
            pullRequest: {
              ...snapshot().pullRequest,
              node_id: "PR_B",
              number: 124,
            },
          }),
        ],
        repository: REPOSITORY,
        workflowContext: WORKFLOW_CONTEXT,
      },
      publishChecks: true,
      workflowContext: WORKFLOW_CONTEXT,
    }),
    /PR #123 processor approval evidence is malformed/,
  );
  assert.equal(detailReads, 2);
  assert.deepEqual(writes, []);
});

test("a targeted PR B sweep rejects incomplete current github-actions approval identity before writes", async () => {
  const cases = [
    ["missing actor type", { user: { login: "github-actions[bot]" } }],
    ["missing commit", { commit_id: undefined }],
    ["malformed commit", { commit_id: "not-a-sha" }],
    ["missing state", { state: undefined }],
  ];
  for (const [name, reviewOverrides] of cases) {
    const writes = [];
    const fetchImpl = async (url) => {
      const parsed = new URL(url);
      if (parsed.pathname === `/repos/${REPOSITORY}/pulls`) {
        return new Response(JSON.stringify([liveApprovalPullRequest()]), {
          status: 200,
        });
      }
      if (parsed.pathname === `/repos/${REPOSITORY}/pulls/123`) {
        return new Response(JSON.stringify(liveApprovalPullRequest()), {
          status: 200,
        });
      }
      if (parsed.pathname === `/repos/${REPOSITORY}/pulls/123/reviews`) {
        return new Response(
          JSON.stringify([
            liveProcessorReview("APPROVED", {
              body: "Legacy automated approval",
              ...reviewOverrides,
            }),
          ]),
          { status: 200 },
        );
      }
      assert.fail(`Unexpected request: ${url}`);
    };
    const liveAdapter = createLiveGitHubAdapter({
      fetchImpl,
      token: "test-token",
    });
    await assert.rejects(
      processDependabotSweep({
        adapter: {
          ...liveAdapter,
          approvePullRequest: async () => writes.push("approve"),
          dismissPullRequestApproval: async () => writes.push("dismiss"),
          getOutstandingDependabotAutoMergeRequests: async () => {
            writes.push("auto-merge-read");
            return [];
          },
          publishProcessorCheck: async () => writes.push("publish"),
        },
        input: {
          mode: "assist",
          outstandingAutoMergeRequests: [],
          pullRequests: [
            snapshot({
              pullRequest: {
                ...snapshot().pullRequest,
                node_id: "PR_B",
                number: 124,
              },
            }),
          ],
          repository: REPOSITORY,
          workflowContext: WORKFLOW_CONTEXT,
        },
        publishChecks: true,
        workflowContext: WORKFLOW_CONTEXT,
      }),
      /PR #123 review evidence is malformed/,
      name,
    );
    assert.deepEqual(writes, [], name);
  }
});

test("live repository-wide processor approval visibility rejects malformed schema claims", async () => {
  let detailReads = 0;
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname === `/repos/${REPOSITORY}/pulls`) {
      return new Response(JSON.stringify([liveApprovalPullRequest()]), {
        status: 200,
      });
    }
    if (parsed.pathname === `/repos/${REPOSITORY}/pulls/123`) {
      detailReads += 1;
      return new Response(JSON.stringify(liveApprovalPullRequest()), {
        status: 200,
      });
    }
    if (parsed.pathname === `/repos/${REPOSITORY}/pulls/123/reviews`) {
      return new Response(
        JSON.stringify([
          liveProcessorReview("APPROVED", {
            user: { login: "dependabot[bot]", type: "Bot" },
          }),
        ]),
        { status: 200 },
      );
    }
    assert.fail(`Unexpected request: ${url}`);
  };
  const adapter = createLiveGitHubAdapter({ fetchImpl, token: "test-token" });
  await assert.rejects(
    adapter.getOutstandingDependabotProcessorApprovals(REPOSITORY),
    /PR #123 processor approval evidence is malformed/,
  );
  assert.equal(detailReads, 2);
});

test("live repository-wide processor approval visibility fails closed at its open-PR cap", async () => {
  const requestedPages = [];
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    assert.equal(parsed.pathname, `/repos/${REPOSITORY}/pulls`);
    const page = Number(parsed.searchParams.get("page"));
    requestedPages.push(page);
    return new Response(
      JSON.stringify(
        page === 1
          ? Array.from({ length: 100 }, () => ({
              user: { login: "dependabot[bot]" },
            }))
          : [{ user: { login: "dependabot[bot]" } }],
      ),
      { status: 200 },
    );
  };
  const adapter = createLiveGitHubAdapter({ fetchImpl, token: "test-token" });
  await assert.rejects(
    adapter.getOutstandingDependabotProcessorApprovals(REPOSITORY),
    /Repository-wide processor approval PR limit exceeded/,
  );
  assert.deepEqual(requestedPages, [1, 2]);
});

test("live repository-wide processor approval visibility fails closed at its per-PR review cap", async () => {
  const reviewPages = [];
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname === `/repos/${REPOSITORY}/pulls`) {
      return new Response(JSON.stringify([liveApprovalPullRequest()]), {
        status: 200,
      });
    }
    if (parsed.pathname === `/repos/${REPOSITORY}/pulls/123`) {
      return new Response(JSON.stringify(liveApprovalPullRequest()), {
        status: 200,
      });
    }
    if (parsed.pathname === `/repos/${REPOSITORY}/pulls/123/reviews`) {
      const page = Number(parsed.searchParams.get("page"));
      reviewPages.push(page);
      return new Response(
        JSON.stringify(
          page === 1
            ? Array.from({ length: 2_000 }, (_, index) => ({
                body: "",
                commit_id: HEAD_SHA,
                id: index + 1,
                state: "COMMENTED",
                user: { login: "human-reviewer", type: "User" },
              }))
            : [],
        ),
        { status: 200 },
      );
    }
    assert.fail(`Unexpected request: ${url}`);
  };
  const adapter = createLiveGitHubAdapter({ fetchImpl, token: "test-token" });
  await assert.rejects(
    adapter.getOutstandingDependabotProcessorApprovals(REPOSITORY),
    /PR #123 processor approval review limit exceeded/,
  );
  assert.deepEqual(reviewPages, [1, 2]);
});

test("live repository auto-merge visibility paginates all open Dependabot PRs", async () => {
  const cursors = [];
  const fetchImpl = async (url, options = {}) => {
    assert.equal(url.endsWith("/graphql"), true);
    const { query, variables } = JSON.parse(options.body);
    assert.doesNotMatch(
      query,
      /autoMergeRequest\s*\{[^}]*\bcommit\b/s,
      "AutoMergeRequest has no commit field in GitHub's live schema",
    );
    cursors.push(variables.after);
    const second = variables.after === "page-2";
    return new Response(
      JSON.stringify({
        data: {
          repository: {
            pullRequests: {
              nodes: [
                {
                  author: {
                    login: second ? "dependabot" : "human-author",
                  },
                  autoMergeRequest: { enabledAt: "now" },
                  headRefOid: second ? HEAD_SHA : OTHER_SHA,
                  id: second ? "PR_node" : "PR_other",
                  number: second ? 123 : 999,
                },
              ],
              pageInfo: {
                endCursor: second ? null : "page-2",
                hasNextPage: !second,
              },
            },
          },
        },
      }),
      { status: 200 },
    );
  };
  const adapter = createLiveGitHubAdapter({ fetchImpl, token: "test-token" });
  assert.deepEqual(
    await adapter.getOutstandingDependabotAutoMergeRequests(REPOSITORY),
    [
      {
        enabledAt: "now",
        headSha: HEAD_SHA,
        nodeId: "PR_node",
        pullRequestNumber: 123,
      },
    ],
  );
  assert.deepEqual(cursors, [null, "page-2"]);
});

test("live auto-merge disable binds the current PR node, head, single lane request, and schema-valid mutation", async () => {
  const operations = [];
  const fetchImpl = async (url, options = {}) => {
    const path = new URL(url).pathname;
    if (path === `/repos/${REPOSITORY}/pulls/123`) {
      operations.push("pull");
      return new Response(
        JSON.stringify({
          head: { sha: HEAD_SHA },
          node_id: "PR_node",
          number: 123,
          state: "open",
        }),
        { status: 200 },
      );
    }
    assert.equal(url.endsWith("/graphql"), true);
    const { query, variables } = JSON.parse(options.body);
    assert.doesNotMatch(
      query,
      /autoMergeRequest\s*\{[^}]*\bcommit\b/s,
      "AutoMergeRequest has no commit field in GitHub's live schema",
    );
    if (query.includes("DependabotProcessorAutoMergeRequests")) {
      operations.push("lane");
      return new Response(
        JSON.stringify({
          data: {
            repository: {
              pullRequests: {
                nodes: [
                  {
                    author: { login: "dependabot[bot]" },
                    autoMergeRequest: { enabledAt: "now" },
                    headRefOid: HEAD_SHA,
                    id: "PR_node",
                    number: 123,
                  },
                ],
                pageInfo: { endCursor: null, hasNextPage: false },
              },
            },
          },
        }),
        { status: 200 },
      );
    }
    operations.push("mutation");
    assert.match(query, /mutation DependabotProcessorDisableAutoMerge/);
    assert.match(
      query,
      /disablePullRequestAutoMerge\(input: \{pullRequestId: \$pullRequestId\}\)/,
    );
    assert.deepEqual(variables, { pullRequestId: "PR_node" });
    return new Response(
      JSON.stringify({
        data: {
          disablePullRequestAutoMerge: {
            pullRequest: {
              autoMergeRequest: null,
              headRefOid: HEAD_SHA,
              id: "PR_node",
              number: 123,
              state: "OPEN",
            },
          },
        },
      }),
      { status: 200 },
    );
  };
  const adapter = createLiveGitHubAdapter({ fetchImpl, token: "test-token" });
  assert.deepEqual(
    await adapter.disablePullRequestAutoMerge({
      headSha: HEAD_SHA,
      nodeId: "PR_node",
      pullRequestNumber: 123,
      repository: REPOSITORY,
    }),
    {
      headSha: HEAD_SHA,
      nodeId: "PR_node",
      pullRequestNumber: 123,
    },
  );
  assert.deepEqual(operations, ["pull", "lane", "mutation"]);
});

test("live auto-merge disable fails before mutation unless the exact target is the sole active request", async () => {
  let mutationCalled = false;
  const adapter = createLiveGitHubAdapter({
    fetchImpl: async (url, options = {}) => {
      const path = new URL(url).pathname;
      if (path === `/repos/${REPOSITORY}/pulls/123`) {
        return new Response(
          JSON.stringify({
            head: { sha: HEAD_SHA },
            node_id: "PR_node",
            number: 123,
            state: "open",
          }),
          { status: 200 },
        );
      }
      const { query } = JSON.parse(options.body);
      if (query.includes("DependabotProcessorAutoMergeRequests")) {
        return new Response(
          JSON.stringify({
            data: {
              repository: {
                pullRequests: {
                  nodes: [
                    {
                      author: { login: "dependabot[bot]" },
                      autoMergeRequest: { enabledAt: "now" },
                      headRefOid: OTHER_SHA,
                      id: "PR_other",
                      number: 999,
                    },
                  ],
                  pageInfo: { endCursor: null, hasNextPage: false },
                },
              },
            },
          }),
          { status: 200 },
        );
      }
      mutationCalled = true;
      assert.fail("must not mutate a non-matching auto-merge request");
    },
    token: "test-token",
  });
  await assert.rejects(
    adapter.disablePullRequestAutoMerge({
      headSha: HEAD_SHA,
      nodeId: "PR_node",
      pullRequestNumber: 123,
      repository: REPOSITORY,
    }),
    /not the current single repository auto-merge request/,
  );
  assert.equal(mutationCalled, false);
});

function liveVercelSnapshotFetch({
  current = true,
  includeContract = true,
} = {}) {
  const expectedBlobs = vercelExpectedBlobs();
  const currentBaseSha = current ? BASE_SHA : MERGE_SHA;
  const blobDocuments = new Map([
    [
      expectedBlobs.find(({ path }) => path === "package.json").sha,
      {
        devDependencies: { vercel: "56.4.1" },
        packageManager: "pnpm@10.34.4",
      },
    ],
    [
      expectedBlobs.find(
        ({ path }) => path === "scripts/vercel-cli-runtime/package.json",
      ).sha,
      { dependencies: { vercel: "56.4.1" } },
    ],
    [
      expectedBlobs.find(
        ({ path }) => path === "scripts/vercel-cli-runtime/contract.json",
      ).sha,
      {
        schema: "vercel-cli-runtime-contract:v1",
        vercelVersion: "56.4.1",
      },
    ],
  ]);
  const rawPullRequest = {
    base: {
      ref: "main",
      repo: { full_name: REPOSITORY },
      sha: currentBaseSha,
    },
    body: toolingBody(),
    draft: false,
    head: {
      ref: "dependabot/npm_and_yarn/tooling-31c5cf6265",
      repo: { full_name: REPOSITORY },
      sha: HEAD_SHA,
    },
    labels: [],
    merge_commit_sha: null,
    merged: false,
    node_id: "PR_node",
    number: 123,
    state: "open",
    title: "chore(deps): bump the tooling group",
    updated_at: "2026-08-10T10:00:00Z",
    user: { login: "dependabot[bot]" },
  };
  return async (url, options = {}) => {
    const parsed = new URL(url);
    const path = parsed.pathname;
    if (url.endsWith("/graphql")) {
      const { query } = JSON.parse(options.body);
      if (query.includes("DependabotForcePushHistory")) {
        return new Response(JSON.stringify(forcePushTimelinePayload()), {
          status: 200,
        });
      }
      return new Response(
        JSON.stringify({
          data: {
            repository: {
              pullRequest: {
                autoMergeRequest: null,
                headRefOid: HEAD_SHA,
                id: "PR_node",
                isDraft: false,
                mergeStateStatus: "CLEAN",
                reviewDecision: "APPROVED",
                reviewThreads: {
                  nodes: [],
                  pageInfo: { endCursor: null, hasNextPage: false },
                },
                updatedAt: "2026-08-10T10:00:00Z",
              },
            },
          },
        }),
        { status: 200 },
      );
    }
    if (path === `/repos/${REPOSITORY}/pulls/123`) {
      return new Response(JSON.stringify(rawPullRequest), { status: 200 });
    }
    if (path === `/repos/${REPOSITORY}/pulls/123/files`) {
      return new Response(
        JSON.stringify([
          { filename: "package.json", status: "modified" },
          {
            filename: "packages/eslint-config/package.json",
            status: "modified",
          },
          { filename: "pnpm-lock.yaml", status: "modified" },
        ]),
        { status: 200 },
      );
    }
    if (path === `/repos/${REPOSITORY}/pulls/123/commits`) {
      return new Response(
        JSON.stringify([
          {
            author: { login: "dependabot[bot]" },
            commit: {
              message: toolingBody(),
              verification: { reason: "valid", verified: true },
            },
            committer: { login: "web-flow" },
            parents: [{ sha: BASE_SHA }],
            sha: HEAD_SHA,
          },
        ]),
        { status: 200 },
      );
    }
    if (
      path === `/repos/${REPOSITORY}/pulls/123/reviews` ||
      path === `/repos/${REPOSITORY}/issues/123/comments` ||
      path === `/repos/${REPOSITORY}/issues/123/events`
    ) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    if (path === `/repos/${REPOSITORY}/commits/main`) {
      return new Response(JSON.stringify({ sha: currentBaseSha }), {
        status: 200,
      });
    }
    if (
      path === `/repos/${REPOSITORY}/compare/${currentBaseSha}...${HEAD_SHA}`
    ) {
      return new Response(
        JSON.stringify(
          current
            ? {
                ahead_by: 1,
                base_commit: { sha: currentBaseSha },
                behind_by: 0,
                merge_base_commit: { sha: currentBaseSha },
                status: "ahead",
              }
            : {
                ahead_by: 1,
                base_commit: { sha: currentBaseSha },
                behind_by: 1,
                merge_base_commit: { sha: BASE_SHA },
                status: "diverged",
              },
        ),
        { status: 200 },
      );
    }
    if (path === `/repos/${REPOSITORY}/git/trees/${HEAD_SHA}`) {
      return new Response(
        JSON.stringify({
          tree: includeContract
            ? expectedBlobs
            : expectedBlobs.filter(
                ({ path: blobPath }) =>
                  blobPath !== "scripts/vercel-cli-runtime/contract.json",
              ),
          truncated: false,
        }),
        { status: 200 },
      );
    }
    const blobSha = /\/git\/blobs\/([0-9a-f]{40})$/.exec(path)?.[1];
    if (blobSha && blobDocuments.has(blobSha)) {
      const content = JSON.stringify(blobDocuments.get(blobSha));
      return new Response(
        JSON.stringify({
          content: Buffer.from(content).toString("base64"),
          encoding: "base64",
          size: Buffer.byteLength(content),
        }),
        { status: 200 },
      );
    }
    if (path.endsWith("/check-runs")) {
      return new Response(JSON.stringify({ check_runs: [] }), { status: 200 });
    }
    if (path.endsWith("/statuses")) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    assert.fail(`Unexpected request: ${url}`);
  };
}

test("live snapshot collection binds Vercel operation inputs and parsed target state", async () => {
  const adapter = createLiveGitHubAdapter({
    fetchImpl: liveVercelSnapshotFetch(),
    token: "test-token",
  });
  const collected = await adapter.collectPullRequestSnapshot(REPOSITORY, 123);
  assert.deepEqual(
    collected.expectedBlobs.map(({ path }) => path),
    VERCEL_INPUT_PATHS,
  );
  assert.deepEqual(
    collected.metadata.dependencies,
    vercelMetadata().dependencies,
  );
  assert.deepEqual(collected.protectedRuntime, {
    contractSchema: "vercel-cli-runtime-contract:v1",
    contractVersion: "56.4.1",
    pnpmVersion: "10.34.4",
    rootVersion: "56.4.1",
    runtimeVersion: "56.4.1",
  });
});

test("a stale Vercel head can refresh before newly introduced runtime inputs exist", async () => {
  const staleAdapter = createLiveGitHubAdapter({
    fetchImpl: liveVercelSnapshotFetch({
      current: false,
      includeContract: false,
    }),
    token: "test-token",
  });
  const stale = await staleAdapter.collectPullRequestSnapshot(REPOSITORY, 123);
  assert.equal(stale.protectedRuntime, null);
  assert.equal(
    evaluateDependabotPullRequest(stale, {
      mode: "prepare",
      repository: REPOSITORY,
      workflowContext: WORKFLOW_CONTEXT,
    }).disposition,
    "refresh-required",
  );

  const currentAdapter = createLiveGitHubAdapter({
    fetchImpl: liveVercelSnapshotFetch({ includeContract: false }),
    token: "test-token",
  });
  const current = await currentAdapter.collectPullRequestSnapshot(
    REPOSITORY,
    123,
  );
  assert.equal(current.protectedRuntime, null);
  const evaluated = evaluateDependabotPullRequest(current, {
    mode: "prepare",
    repository: REPOSITORY,
    workflowContext: WORKFLOW_CONTEXT,
  });
  assert.equal(evaluated.disposition, "manual-repair-required");
  assert.equal(evaluated.repairPacket, null);
});

test("live snapshot collection rejects a PR head race after files, commits, and checks were read", async () => {
  let feedbackReads = 0;
  let pullReads = 0;
  const rawPullRequest = (headSha) => ({
    base: {
      ref: "main",
      repo: { full_name: REPOSITORY },
      sha: BASE_SHA,
    },
    body: actionBody(),
    draft: false,
    head: {
      ref: "dependabot/github_actions/github-actions-routine-deadbeef",
      repo: { full_name: REPOSITORY },
      sha: headSha,
    },
    labels: [],
    merge_commit_sha: null,
    merged: false,
    node_id: "PR_node",
    number: 123,
    state: "open",
    title: "routine actions",
    updated_at: "2026-08-10T10:00:00Z",
    user: { login: "dependabot[bot]" },
  });
  const fetchImpl = async (url, options = {}) => {
    const parsed = new URL(url);
    const path = parsed.pathname;
    if (url.endsWith("/graphql")) {
      const { query } = JSON.parse(options.body);
      if (query.includes("DependabotForcePushHistory")) {
        return new Response(JSON.stringify(forcePushTimelinePayload()), {
          status: 200,
        });
      }
      feedbackReads += 1;
      return new Response(
        JSON.stringify({
          data: {
            repository: {
              pullRequest: {
                autoMergeRequest: null,
                headRefOid: HEAD_SHA,
                id: "PR_node",
                isDraft: false,
                mergeStateStatus: "CLEAN",
                reviewDecision: "APPROVED",
                updatedAt: "2026-08-10T10:00:00Z",
                reviewThreads: {
                  nodes: [],
                  pageInfo: { endCursor: null, hasNextPage: false },
                },
              },
            },
          },
        }),
        { status: 200 },
      );
    }
    if (path === `/repos/${REPOSITORY}/pulls/123`) {
      pullReads += 1;
      return new Response(
        JSON.stringify(rawPullRequest(pullReads === 1 ? HEAD_SHA : OTHER_SHA)),
        { status: 200 },
      );
    }
    if (path === `/repos/${REPOSITORY}/pulls/123/files`) {
      return new Response(
        JSON.stringify([
          { filename: ".github/workflows/ci.yml", status: "modified" },
        ]),
        { status: 200 },
      );
    }
    if (path === `/repos/${REPOSITORY}/pulls/123/commits`) {
      return new Response(
        JSON.stringify([
          {
            author: { login: "dependabot[bot]" },
            commit: {
              message: actionBody().replace(
                "github-actions group",
                "github-actions-routine group",
              ),
              verification: { verified: true },
            },
            committer: { login: "web-flow" },
            sha: HEAD_SHA,
          },
        ]),
        { status: 200 },
      );
    }
    if (
      path === `/repos/${REPOSITORY}/pulls/123/reviews` ||
      path === `/repos/${REPOSITORY}/issues/123/comments`
    ) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    if (path === `/repos/${REPOSITORY}/issues/123/events`) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    if (path === `/repos/${REPOSITORY}/commits/main`) {
      return new Response(JSON.stringify({ sha: BASE_SHA }), { status: 200 });
    }
    if (path === `/repos/${REPOSITORY}/compare/${BASE_SHA}...${HEAD_SHA}`) {
      return new Response(
        JSON.stringify({
          ahead_by: 1,
          base_commit: { sha: BASE_SHA },
          behind_by: 0,
          merge_base_commit: { sha: BASE_SHA },
          status: "ahead",
        }),
        { status: 200 },
      );
    }
    if (path === `/repos/${REPOSITORY}/git/trees/${HEAD_SHA}`) {
      return new Response(
        JSON.stringify({
          tree: [
            {
              mode: "100644",
              path: ".github/workflows/ci.yml",
              sha: OTHER_SHA,
              type: "blob",
            },
          ],
          truncated: false,
        }),
        { status: 200 },
      );
    }
    if (path.endsWith("/check-runs")) {
      return new Response(JSON.stringify({ check_runs: [] }), { status: 200 });
    }
    if (path.endsWith("/statuses")) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    assert.fail(`Unexpected request: ${url}`);
  };
  const adapter = createLiveGitHubAdapter({ fetchImpl, token: "test-token" });
  await assert.rejects(
    adapter.collectPullRequestSnapshot(REPOSITORY, 123),
    /changed while its exact-head snapshot was collected/,
  );
  assert.equal(feedbackReads, 2);
  assert.equal(pullReads, 2);
});

test("live snapshot collection awaits the initial PR read before candidate-controlled surfaces", async () => {
  const lineageShas = [
    "5".repeat(40),
    "6".repeat(40),
    "7".repeat(40),
    "8".repeat(40),
    OTHER_SHA,
    HEAD_SHA,
  ];
  let activeHistoryReads = 0;
  let historyReads = 0;
  let initialPullReadCompleted = false;
  let maximumHistoryConcurrency = 0;
  let pullReads = 0;
  let currentHeadChecksCollected = false;
  const fallback = liveMergeAdmissionFetch();
  const fetchImpl = async (url, options = {}) => {
    const parsed = new URL(url);
    const path = parsed.pathname;
    if (path === `/repos/${REPOSITORY}/pulls/123`) {
      pullReads += 1;
      if (pullReads === 1) {
        await new Promise((resolve) => queueMicrotask(resolve));
        initialPullReadCompleted = true;
      }
      return fallback(url, options);
    }
    if (
      path === `/repos/${REPOSITORY}/pulls/123/files` ||
      path === `/repos/${REPOSITORY}/pulls/123/commits`
    ) {
      assert.equal(initialPullReadCompleted, true, path);
      return new Response(
        JSON.stringify(
          path.endsWith("/commits")
            ? [...lineageShas, lineageShas[1]].map((sha) => ({ sha }))
            : [],
        ),
        { status: 200 },
      );
    }
    if (path.endsWith("/check-runs")) {
      const sha = /\/commits\/([0-9a-f]{40})\/check-runs$/.exec(path)?.[1];
      const isCurrentHeadCollection =
        sha === HEAD_SHA && currentHeadChecksCollected === false;
      if (isCurrentHeadCollection) currentHeadChecksCollected = true;
      if (lineageShas.includes(sha) && !isCurrentHeadCollection) {
        historyReads += 1;
        activeHistoryReads += 1;
        maximumHistoryConcurrency = Math.max(
          maximumHistoryConcurrency,
          activeHistoryReads,
        );
        await new Promise((resolve) => setTimeout(resolve, 1));
        activeHistoryReads -= 1;
      }
      return new Response(JSON.stringify({ check_runs: [] }), { status: 200 });
    }
    if (path.endsWith("/statuses")) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    return fallback(url, options);
  };
  const adapter = createLiveGitHubAdapter({ fetchImpl, token: "test-token" });
  const collected = await adapter.collectPullRequestSnapshot(REPOSITORY, 123);
  assert.equal(pullReads, 2);
  assert.equal(historyReads, lineageShas.length);
  assert.equal(maximumHistoryConcurrency, 4);
  assert.deepEqual(collected.repairHistoryChecks, []);
  assert.deepEqual(collected.baseAncestry, {
    aheadBy: 1,
    baseCommitSha: BASE_SHA,
    behindBy: 0,
    currentBaseIsAncestor: true,
    currentBaseSha: BASE_SHA,
    headSha: HEAD_SHA,
    mergeBaseSha: BASE_SHA,
    status: "ahead",
  });
});

test("live snapshot collection fails closed before repair-history fan-out when the lineage cap is exceeded", async () => {
  let historyReads = 0;
  const fallback = liveMergeAdmissionFetch();
  const commitShas = [
    ...Array.from({ length: 100 }, (_, index) =>
      index.toString(16).padStart(40, "0"),
    ),
    HEAD_SHA,
  ];
  const fetchImpl = async (url, options = {}) => {
    const parsed = new URL(url);
    const path = parsed.pathname;
    if (path === `/repos/${REPOSITORY}/pulls/123/files`) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    if (path === `/repos/${REPOSITORY}/pulls/123/commits`) {
      const page = Number(parsed.searchParams.get("page"));
      return new Response(
        JSON.stringify(
          commitShas
            .slice((page - 1) * 100, page * 100)
            .map((sha) => ({ sha })),
        ),
        { status: 200 },
      );
    }
    if (
      path.endsWith("/check-runs") &&
      parsed.searchParams.get("check_name") === "Dependabot Processor"
    ) {
      historyReads += 1;
    }
    return fallback(url, options);
  };
  const adapter = createLiveGitHubAdapter({ fetchImpl, token: "test-token" });
  await assert.rejects(
    adapter.collectPullRequestSnapshot(REPOSITORY, 123),
    /repair lineage commit limit exceeded/,
  );
  assert.equal(historyReads, 0);
});

test("stable JSON recursively sorts object keys", () => {
  assert.equal(
    stableJson({ z: 1, a: { y: 2, b: 3 } }),
    '{"a":{"b":3,"y":2},"z":1}',
  );
});

test("CLI tolerates a leading separator, normalizes legacy merge, and keeps pure process read-only", () => {
  const directory = mkdtempSync(join(tmpdir(), "dependabot-processor-"));
  const inputPath = join(directory, "input.json");
  try {
    writeFileSync(
      inputPath,
      JSON.stringify({
        mode: "merge",
        pullRequests: [snapshot()],
        repository: REPOSITORY,
      }),
    );
    const scriptPath = new URL("./dependabot-processor.mjs", import.meta.url);
    const output = execFileSync(
      process.execPath,
      [scriptPath.pathname, "--", "process", "--input", inputPath],
      { encoding: "utf8" },
    );
    const result = JSON.parse(output);
    assert.equal(result.mode, "observe");
    assert.deepEqual(result.mutations, []);
    assert.deepEqual(result.processing, {
      enabled: false,
      reason: "live-or-injected-adapter-required",
    });
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("CLI help documents the live and exact-intake contracts", () => {
  const scriptPath = new URL("./dependabot-processor.mjs", import.meta.url);
  const output = execFileSync(
    process.execPath,
    [scriptPath.pathname, "--help"],
    {
      encoding: "utf8",
    },
  );
  assert.match(output, /evaluate --live/);
  assert.match(output, /process --live/);
  assert.match(output, /--expected-head-sha/);
});

test("CLI enforces an expected intake SHA and rejects unsupported flags", () => {
  const directory = mkdtempSync(join(tmpdir(), "dependabot-processor-stale-"));
  const inputPath = join(directory, "input.json");
  const scriptPath = new URL("./dependabot-processor.mjs", import.meta.url);
  try {
    writeFileSync(
      inputPath,
      JSON.stringify({
        mode: "merge",
        pullRequests: [snapshot()],
        repository: REPOSITORY,
      }),
    );
    const output = execFileSync(
      process.execPath,
      [
        scriptPath.pathname,
        "evaluate",
        "--input",
        inputPath,
        "--expected-head-sha",
        OTHER_SHA,
      ],
      { encoding: "utf8" },
    );
    const result = JSON.parse(output);
    assert.equal(result.evaluations[0].disposition, "rejected-identity");
    assert.ok(
      result.evaluations[0].identity.reasons.includes("head-sha-changed"),
    );
    assert.throws(
      () =>
        execFileSync(
          process.execPath,
          [
            scriptPath.pathname,
            "evaluate",
            "--input",
            inputPath,
            "--bogus",
            "x",
          ],
          { encoding: "utf8", stdio: "pipe" },
        ),
      /Command failed/,
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
