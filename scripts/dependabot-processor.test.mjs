import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { test } from "node:test";

import {
  DEPENDABOT_CHECK_POLICY,
  classifyDependabotFeedback,
  classifyDependabotRisk,
  createLiveGitHubAdapter,
  deriveImmutableDependabotMetadata,
  createDependabotRepairPacket,
  evaluateDependabotChecks,
  evaluateDependabotPullRequest,
  evaluateDependabotSweep,
  evaluateFeedbackGate,
  normalizeProcessorMode,
  parseDependabotMetadata,
  processDependabotSweep,
  requireStableFeedbackSnapshot,
  requireStablePullRequestSnapshot,
  selectLatestExactHeadCheck,
  stableJson,
  validateDependabotPullRequestIdentity,
  verifyPostMergeOutcome,
} from "./dependabot-processor.mjs";

const HEAD_SHA = "1".repeat(40);
const BASE_SHA = "2".repeat(40);
const MERGE_SHA = "3".repeat(40);
const OTHER_SHA = "4".repeat(40);
const REPOSITORY = "mento-protocol/frontend-monorepo";

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
    headSha,
    id: 99,
    kind: "check",
    name: "Dependabot Post-Merge Verification",
    runAttempt: 1,
    runHeadSha: headSha,
    runId: 99,
    sourceRepository: REPOSITORY,
    status: "completed",
    workflowEvent: "workflow_run",
    workflowPath: ".github/workflows/vercel-main-deployment.yml",
  };
}

function processorRepairReceipt(
  attempt,
  { mode = "assist", packet = true, externalId, headSha = HEAD_SHA } = {},
) {
  return {
    appId: 15_368,
    conclusion: "neutral",
    externalId:
      externalId ??
      `dependabot-processor:v1:pr=123:head=${headSha}:mode=${mode}:repair=${attempt}:packet=${packet}`,
    headSha,
    id: 10_000 + attempt,
    kind: "check",
    name: "Dependabot Processor",
    status: "completed",
  };
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

function actionBody(name = "actions/setup-node", from = "6.0.0", to = "6.1.0") {
  return `Bumps the github-actions group with 1 update:\n\n| Package | From | To |\n| --- | --- | --- |\n| [${name}](https://github.com/${name}) | \`${from}\` | \`${to}\` |`;
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

function snapshot(overrides = {}) {
  const pullRequest = {
    author: { login: "dependabot[bot]" },
    base: {
      ref: "main",
      repo: { fullName: REPOSITORY },
      sha: BASE_SHA,
    },
    body: actionBody(),
    draft: false,
    files: [".github/workflows/ci.yml"],
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
    ...overrides.pullRequest,
  };
  const pullRequestNumber = pullRequest.number;
  const feedback = {
    currentProcessorApprovalCount: 0,
    currentProcessorApprovalIds: [],
    reviewDecision: "APPROVED",
    unresolvedThreads: 0,
    ...overrides.feedback,
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
        ...completeChecks({ headSha: BASE_SHA, pullRequestNumber }),
        postMergeReceipt(BASE_SHA),
      ],
      sha: BASE_SHA,
    },
    checks: completeChecks({ pullRequestNumber }),
    commits: [{ authorLogin: "dependabot[bot]", sha: HEAD_SHA }],
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
    pullRequest,
    repository: REPOSITORY,
    ...overrides,
    feedback,
  };
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

function liveApprovalPullRequest(overrides = {}) {
  return {
    base: {
      ref: "main",
      repo: { full_name: REPOSITORY },
      sha: BASE_SHA,
    },
    body: actionBody(),
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
    body: `Approved by dependabot-processor:v1 for exact head ${HEAD_SHA}.`,
    commit_id: HEAD_SHA,
    id: 7001,
    state,
    user: { login: "github-actions[bot]", type: "Bot" },
    ...overrides,
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
    assert.fail(`Unexpected request: ${options.method} ${url}`);
  };
}

test("unknown processor modes fail safe to observe", () => {
  assert.equal(normalizeProcessorMode("merge"), "merge");
  assert.equal(normalizeProcessorMode("assist"), "assist");
  assert.equal(normalizeProcessorMode("future-mode"), "observe");
  assert.equal(normalizeProcessorMode(undefined), "observe");
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
      mode: "merge",
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
      mode: "merge",
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
    mode: "merge",
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

test("the policy names every CI, supply-chain, quality, E2E, VRT, review, and Vercel gate", () => {
  assert.deepEqual(
    [...DEPENDABOT_CHECK_POLICY.map(({ id }) => id)].sort(),
    Object.keys(CHECK_NAMES).sort(),
  );
  assert.equal(new Set(DEPENDABOT_CHECK_POLICY.map(({ id }) => id)).size, 21);
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
    repository: REPOSITORY,
  });
  const celo = result.policy.find(({ id }) => id === "e2e-celo");
  assert.equal(celo.state, "failing");
  assert.equal(celo.reason, "unjustified-skip");
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
      baselineChecks: completeChecks({ headSha: BASE_SHA }),
      baselineSha: BASE_SHA,
      checks,
      headSha: HEAD_SHA,
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

  for (const mutation of [
    { runHeadBranch: "dependabot-branch" },
    { runHeadSha: HEAD_SHA },
    {
      runDisplayTitle: `dependabot-claude-review:v1 | source=dependabot-intake:v1 | repository=${REPOSITORY} | pr=123 | sha=${OTHER_SHA} | action=synchronize | receipt=true`,
    },
    {
      externalId: `dependabot-claude-review:v1:pr=123:sha=${HEAD_SHA}:run=1:attempt=2`,
    },
    { detailsUrl: `https://github.com/${REPOSITORY}/actions/runs/1/job/2` },
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
    kind: "status",
    runHeadSha: HEAD_SHA,
    workflowEvent: "pull_request_target",
    workflowPath: ".github/workflows/vercel-preview-intake.yml",
  };
  const result = evaluateDependabotChecks({
    checks,
    headSha: HEAD_SHA,
    repository: REPOSITORY,
  });
  assert.equal(
    result.policy.find(({ id }) => id === "vercel-preview").state,
    "passing",
  );
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
    baselineChecks: completeChecks({ headSha: BASE_SHA }),
    baselineSha: BASE_SHA,
    checks,
    headSha: HEAD_SHA,
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
    repository: REPOSITORY,
  });
  assert.equal(
    provider.policy.find(({ id }) => id === "vercel-preview").state,
    "failing",
  );
});

test("attributes an exact matching baseline failure separately from a branch failure", () => {
  const checks = completeChecks({
    conclusions: {
      "supply-chain-root-osv": "failure",
      "supply-chain-version-skew": "failure",
    },
  });
  const baselineChecks = completeChecks({
    conclusions: { "supply-chain-root-osv": "failure" },
    headSha: BASE_SHA,
  });
  const result = evaluateDependabotChecks({
    baselineChecks,
    baselineSha: BASE_SHA,
    checks,
    headSha: HEAD_SHA,
    repository: REPOSITORY,
  });
  assert.deepEqual(result.failures, [
    {
      attribution: "baseline",
      id: "supply-chain-root-osv",
      name: "osv-scanner / osv-scan",
      reason: "failing",
    },
    {
      attribution: "branch",
      id: "supply-chain-version-skew",
      name: "catalog version-skew",
      reason: "failing",
    },
  ]);
});

test("provider-backed failures remain non-deterministic after a passing baseline and never emit repair packets", () => {
  for (const mode of ["assist", "merge"]) {
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
        "non-deterministic",
        `${mode}:${checkId}`,
      );
    }
  }
});

test("a provider-backed failure suppresses a mixed deterministic repair packet", () => {
  const mixed = evaluateDependabotPullRequest(
    snapshot({
      checks: completeChecks({
        conclusions: { ci: "failure", "vercel-preview": "failure" },
      }),
    }),
    { mode: "assist", repository: REPOSITORY },
  );
  assert.equal(mixed.disposition, "waiting-retry");
  assert.equal(mixed.repairPacket, null);
  assert.deepEqual(
    mixed.checks.failures.map(({ attribution, id }) => ({ attribution, id })),
    [
      { attribution: "branch", id: "ci" },
      { attribution: "non-deterministic", id: "vercel-preview" },
    ],
  );

  const deterministicOnly = evaluateDependabotPullRequest(
    snapshot({
      checks: completeChecks({ conclusions: { ci: "failure" } }),
    }),
    { mode: "assist", repository: REPOSITORY },
  );
  assert.equal(deterministicOnly.disposition, "repair-required");
  assert.deepEqual(
    deterministicOnly.repairPacket.failures.map(({ id }) => id),
    ["ci"],
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
      mode: "assist",
      repository: REPOSITORY,
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
        mode: "assist",
        pullRequests: [pullRequest],
        repository: REPOSITORY,
      },
      publishChecks: true,
    });
    assert.equal(published.length, 1);
    assert.equal(published[0].repairPacketIssued, false);
  }
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
      { mode: "merge", repository: REPOSITORY },
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

test("manual-risk updates may receive proposal-only packets without approval authority", () => {
  const pullRequest = snapshot({
    checks: completeChecks({ conclusions: { ci: "failure" } }),
    metadata: {
      dependencyNames: ["next"],
      packageEcosystem: "npm",
      updateType: "patch",
    },
  });
  const result = evaluateDependabotPullRequest(pullRequest, {
    mode: "assist",
    repository: REPOSITORY,
  });
  assert.equal(result.identity.valid, true);
  assert.equal(result.risk.autoApprovable, false);
  assert.equal(result.disposition, "manual-review");
  assert.equal(result.repairPacket.automatic, false);
  assert.equal(result.repairPacket.requireHumanApproval, true);
  assert.deepEqual(
    result.repairPacket.failures.map(({ id }) => id),
    ["ci"],
  );
});

test("a provider-backed failure shared by the baseline remains baseline-attributed", () => {
  const result = evaluateDependabotPullRequest(
    snapshot({
      baseline: {
        checks: [
          ...completeChecks({
            conclusions: { "e2e-celo": "failure" },
            headSha: BASE_SHA,
          }),
          postMergeReceipt(BASE_SHA),
        ],
        sha: BASE_SHA,
      },
      checks: completeChecks({ conclusions: { "e2e-celo": "failure" } }),
    }),
    { mode: "assist", repository: REPOSITORY },
  );
  assert.equal(result.disposition, "waiting-baseline");
  assert.equal(result.repairPacket, null);
  assert.equal(
    result.checks.failures.find(({ id }) => id === "e2e-celo")?.attribution,
    "baseline",
  );
});

test("missing or pending baseline evidence attributes a failure as unknown and emits no repair packet", () => {
  const pullRequest = snapshot({
    baseline: {
      checks: completeChecks({ headSha: BASE_SHA }).filter(
        ({ name }) => name !== "Build and Test",
      ),
      sha: BASE_SHA,
    },
    checks: completeChecks({ conclusions: { ci: "failure" } }),
  });
  const result = evaluateDependabotPullRequest(pullRequest, {
    mode: "assist",
    repository: REPOSITORY,
  });
  assert.equal(result.disposition, "waiting-retry");
  assert.equal(
    result.checks.failures.find(({ id }) => id === "ci").attribution,
    "unknown",
  );
  assert.equal(result.repairPacket, null);
});

test("missing or pending current-head gates take precedence over deterministic repair", () => {
  const failingChecks = completeChecks({ conclusions: { ci: "failure" } });
  const missing = evaluateDependabotPullRequest(
    snapshot({
      checks: failingChecks.filter(
        ({ name }) => name !== CHECK_NAMES["dependency-review"],
      ),
    }),
    { mode: "assist", repository: REPOSITORY },
  );
  assert.equal(missing.checks.failures[0].attribution, "branch");
  assert.deepEqual(missing.checks.missing, ["dependency-review"]);
  assert.equal(missing.disposition, "waiting-checks");
  assert.equal(missing.repairPacket, null);

  const pending = evaluateDependabotPullRequest(
    snapshot({
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
    { mode: "assist", repository: REPOSITORY },
  );
  assert.equal(pending.checks.failures[0].attribution, "branch");
  assert.deepEqual(pending.checks.pending, ["dependency-review"]);
  assert.equal(pending.disposition, "waiting-checks");
  assert.equal(pending.repairPacket, null);
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
  const feedback = evaluateFeedbackGate({
    feedback: {
      maintainerVeto: true,
      reviewDecision: "CHANGES_REQUESTED",
      unresolvedThreads: 2,
    },
    pullRequest: { labels: ["do-not-merge"] },
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
    body: `Approved by dependabot-processor:v1 for exact head ${bodySha}.`,
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
  assert.deepEqual(evaluateFeedbackGate({ feedback: result }).reasons, [
    "feedback-incomplete",
    "feedback-thread-pagination-cap-exceeded",
    "feedback-thread-comments-cap-exceeded",
  ]);
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
    { mode: "merge", repository: REPOSITORY },
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
    { mode: "merge", repository: REPOSITORY },
  );
  assert.equal(result.feedback.clear, false);
  assert.equal(result.feedback.humanReopened, true);
  assert.deepEqual(result.feedback.reasons, ["human-reopened-pull-request"]);
  assert.equal(result.disposition, "manual-veto-or-feedback");
});

test("evaluates safe green, manual, pending, baseline, and repair dispositions", () => {
  assert.equal(
    evaluateDependabotPullRequest(snapshot(), {
      mode: "merge",
      repository: REPOSITORY,
    }).disposition,
    "merge-candidate",
  );
  assert.equal(
    evaluateDependabotPullRequest(
      snapshot({
        metadata: {
          dependencyNames: ["next"],
          packageEcosystem: "npm",
          updateType: "patch",
        },
      }),
      { mode: "merge", repository: REPOSITORY },
    ).disposition,
    "manual-review",
  );

  const pending = snapshot({ checks: completeChecks().slice(0, -1) });
  assert.equal(
    evaluateDependabotPullRequest(pending, {
      mode: "merge",
      repository: REPOSITORY,
    }).disposition,
    "waiting-checks",
  );

  const baseline = snapshot({
    baseline: {
      checks: completeChecks({
        conclusions: { "supply-chain-root-osv": "failure" },
        headSha: BASE_SHA,
      }),
      sha: BASE_SHA,
    },
    checks: completeChecks({
      conclusions: { "supply-chain-root-osv": "failure" },
    }),
  });
  assert.equal(
    evaluateDependabotPullRequest(baseline, {
      mode: "merge",
      repository: REPOSITORY,
    }).disposition,
    "waiting-baseline",
  );

  const repair = snapshot({
    checks: completeChecks({ conclusions: { ci: "failure" } }),
  });
  const evaluation = evaluateDependabotPullRequest(repair, {
    mode: "merge",
    repository: REPOSITORY,
  });
  assert.equal(evaluation.disposition, "repair-required");
  assert.deepEqual(
    createDependabotRepairPacket(evaluation).failures.map(({ id }) => id),
    ["ci"],
  );
  assert.deepEqual(
    Object.keys(createDependabotRepairPacket(evaluation)).sort(),
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
      "failures",
      "forbiddenPaths",
      "headSha",
      "mode",
      "packageEcosystem",
      "permittedPaths",
      "pullRequestNumber",
      "repository",
      "requiredGateIds",
      "requireExactHead",
      "requireHumanApproval",
      "riskTier",
      "schema",
      "updateType",
      "validationCommands",
    ].sort(),
  );
  const observedRepair = evaluateDependabotPullRequest(repair, {
    mode: "observe",
    repository: REPOSITORY,
  });
  assert.equal(observedRepair.repairPacket, null);
});

test("durable force-push evidence removes automatic and repair authority after a lineage reset", async () => {
  const rewritten = snapshot({
    checks: completeChecks({ conclusions: { ci: "failure" } }),
    commits: [{ authorLogin: "dependabot[bot]", sha: HEAD_SHA }],
    feedback: {
      forcePushActors: ["dependabot[bot]", "unknown-actor"],
      forcePushCommitIds: [OTHER_SHA],
      forcePushEventCount: 2,
      forcePushed: true,
    },
    repairHistoryChecks: [],
  });
  const evaluation = evaluateDependabotPullRequest(rewritten, {
    mode: "merge",
    repository: REPOSITORY,
  });
  assert.equal(evaluation.identity.valid, true);
  assert.equal(evaluation.identity.automaticAuthority, false);
  assert.deepEqual(evaluation.identity.automaticAuthorityReasons, [
    "pull-request-history-force-pushed",
  ]);
  assert.equal(evaluation.feedback.clear, false);
  assert.deepEqual(evaluation.feedback.reasons, [
    "pull-request-history-force-pushed",
  ]);
  assert.equal(evaluation.disposition, "manual-veto-or-feedback");
  assert.equal(evaluation.repairAttempts.currentAttempt, 1);
  assert.equal(evaluation.repairPacket, null);

  let approved = false;
  let merged = false;
  const result = await processDependabotSweep({
    adapter: {
      approvePullRequest: async () => {
        approved = true;
      },
      mergePullRequest: async () => {
        merged = true;
      },
    },
    input: {
      mode: "merge",
      outstandingAutoMergeRequests: [],
      pullRequests: [rewritten],
      repository: REPOSITORY,
    },
  });
  assert.equal(result.mergeCandidate, null);
  assert.equal(approved, false);
  assert.equal(merged, false);
});

test("repair receipts are idempotent on the current head and consume attempts only across append-only lineage", () => {
  const failingChecks = completeChecks({ conclusions: { ci: "failure" } });
  const first = evaluateDependabotPullRequest(
    snapshot({ checks: failingChecks }),
    { mode: "assist", repository: REPOSITORY },
  );
  assert.equal(first.repairAttempt, 1);
  assert.equal(first.identity.automaticAuthority, true);
  assert.equal(first.repairPacket.attemptNumber, 1);
  assert.equal(first.repairAttempts.historySource, "current-checks-fallback");

  const sameHeadRerun = evaluateDependabotPullRequest(
    snapshot({
      checks: failingChecks,
      repairHistoryChecks: [processorRepairReceipt(1)],
    }),
    { mode: "assist", repository: REPOSITORY },
  );
  assert.equal(sameHeadRerun.repairAttempt, 1);
  assert.equal(sameHeadRerun.repairAttempts.consumedAttempts, 0);
  assert.equal(sameHeadRerun.repairAttempts.currentHeadPacketIssued, true);
  assert.equal(sameHeadRerun.repairPacket.attemptNumber, 1);

  const appended = snapshot({ checks: failingChecks });
  appended.commits = [
    { authorLogin: "dependabot[bot]", sha: OTHER_SHA },
    { authorLogin: "alice", sha: HEAD_SHA },
  ];
  appended.metadata = {
    ...appended.metadata,
    maintainerChanges: true,
    repairChanges: true,
  };
  appended.repairHistoryChecks = [
    processorRepairReceipt(1, { headSha: OTHER_SHA }),
  ];
  const second = evaluateDependabotPullRequest(appended, {
    mode: "merge",
    repository: REPOSITORY,
  });
  assert.equal(second.identity.valid, true);
  assert.equal(second.identity.automaticAuthority, false);
  assert.equal(second.identity.automaticSeedHeadSha, OTHER_SHA);
  assert.equal(second.identity.repairCommitCount, 1);
  assert.equal(second.repairAttempt, 2);
  assert.equal(second.repairAttempts.consumedAttempts, 1);
  assert.equal(second.repairAttempts.historySource, "lineage-checks");
  assert.equal(second.repairAttempts.lineageCommitCount, 2);
  assert.equal(second.repairPacket.attemptNumber, 2);
  assert.equal(second.repairPacket.automatic, false);
  assert.equal(second.repairPacket.requireHumanApproval, true);

  const contradictoryProvenance = structuredClone(appended);
  contradictoryProvenance.metadata.maintainerChanges = false;
  contradictoryProvenance.metadata.repairChanges = false;
  const contradictory = evaluateDependabotPullRequest(contradictoryProvenance, {
    mode: "assist",
    repository: REPOSITORY,
  });
  assert.equal(contradictory.identity.valid, false);
  assert.ok(
    contradictory.identity.reasons.includes(
      "maintainer-change-evidence-mismatch",
    ),
  );
  assert.equal(contradictory.repairPacket, null);

  appended.repairHistoryChecks.push(processorRepairReceipt(2));
  const sameSecondHead = evaluateDependabotPullRequest(appended, {
    mode: "assist",
    repository: REPOSITORY,
  });
  assert.equal(sameSecondHead.repairAttempt, 2);
  assert.equal(sameSecondHead.repairAttempts.consumedAttempts, 1);
  assert.equal(sameSecondHead.repairAttempts.currentHeadPacketIssued, true);
  assert.equal(sameSecondHead.repairPacket.attemptNumber, 2);

  const repairedGreen = structuredClone(appended);
  repairedGreen.checks = completeChecks();
  const manualOnly = evaluateDependabotPullRequest(repairedGreen, {
    mode: "merge",
    repository: REPOSITORY,
  });
  assert.equal(manualOnly.identity.valid, true);
  assert.equal(manualOnly.identity.automaticAuthority, false);
  assert.equal(manualOnly.disposition, "manual-review");

  const exhausted = snapshot({ checks: failingChecks });
  exhausted.commits = [
    { authorLogin: "dependabot[bot]", sha: MERGE_SHA },
    { authorLogin: "alice", sha: OTHER_SHA },
    { authorLogin: "alice", sha: HEAD_SHA },
  ];
  exhausted.metadata = {
    ...exhausted.metadata,
    maintainerChanges: true,
    repairChanges: true,
  };
  exhausted.repairHistoryChecks = [
    processorRepairReceipt(1, { headSha: MERGE_SHA }),
    processorRepairReceipt(2, { headSha: OTHER_SHA }),
  ];
  const third = evaluateDependabotPullRequest(exhausted, {
    mode: "assist",
    repository: REPOSITORY,
  });
  assert.equal(third.identity.valid, true);
  assert.equal(third.repairAttempt, 3);
  assert.equal(third.repairAttempts.consumedAttempts, 2);
  assert.equal(third.disposition, "manual-repair-escalated");
  assert.equal(third.repairPacket, null);

  const rebased = evaluateDependabotPullRequest(
    snapshot({ checks: failingChecks, repairHistoryChecks: [] }),
    { mode: "merge", repository: REPOSITORY },
  );
  assert.equal(rebased.repairAttempt, 1);
  assert.equal(rebased.repairAttempts.consumedAttempts, 0);
  assert.equal(rebased.repairAttempts.historySource, "lineage-checks");
});

test("malformed explicit or reachable-lineage repair-attempt evidence fails closed", () => {
  const failingChecks = completeChecks({ conclusions: { ci: "failure" } });
  for (const repairAttempt of [0, -1, 1.5, "1", null]) {
    assert.throws(
      () =>
        evaluateDependabotPullRequest(
          snapshot({ repairAttempt, checks: failingChecks }),
          { mode: "assist", repository: REPOSITORY },
        ),
      /Explicit repairAttempt/,
      String(repairAttempt),
    );
  }
  assert.throws(
    () =>
      evaluateDependabotPullRequest(
        snapshot({
          checks: [...failingChecks, processorRepairReceipt(1)],
          repairAttempt: 2,
        }),
        { mode: "assist", repository: REPOSITORY },
      ),
    /does not match reachable-lineage processor receipts/,
  );
  const malformed = evaluateDependabotPullRequest(
    snapshot({
      checks: [
        ...failingChecks,
        processorRepairReceipt(1, { externalId: "malformed" }),
      ],
    }),
    { mode: "assist", repository: REPOSITORY },
  );
  assert.equal(malformed.disposition, "manual-repair-escalated");
  assert.equal(malformed.repairPacket, null);
  assert.deepEqual(malformed.repairAttempts.reasons, [
    "malformed-repair-attempt-receipt",
  ]);
});

test("repair lineage receipts reject wrong provenance, incomplete results, conflicts, and missing parent issuance", () => {
  const failingChecks = completeChecks({ conclusions: { ci: "failure" } });
  const cases = [
    {
      check: { ...processorRepairReceipt(1), appId: 1 },
      reason: "untrusted-repair-attempt-receipt",
    },
    {
      check: { ...processorRepairReceipt(1), kind: "status" },
      reason: "untrusted-repair-attempt-receipt",
    },
    {
      check: { ...processorRepairReceipt(1), kind: undefined },
      reason: "untrusted-repair-attempt-receipt",
    },
    {
      check: { ...processorRepairReceipt(1), status: "in_progress" },
      reason: "incomplete-repair-attempt-receipt",
    },
    {
      check: { ...processorRepairReceipt(1), status: undefined },
      reason: "incomplete-repair-attempt-receipt",
    },
    {
      check: { ...processorRepairReceipt(1), conclusion: "failure" },
      reason: "invalid-repair-attempt-receipt-conclusion",
    },
    {
      check: processorRepairReceipt(1, {
        externalId: `dependabot-processor:v1:pr=999:head=${HEAD_SHA}:mode=assist:repair=1:packet=true`,
      }),
      reason: "malformed-repair-attempt-receipt",
    },
    {
      check: processorRepairReceipt(1, {
        externalId: `dependabot-processor:v1:pr=123:head=${OTHER_SHA}:mode=assist:repair=1:packet=true`,
      }),
      reason: "malformed-repair-attempt-receipt",
    },
    {
      check: processorRepairReceipt(1, {
        externalId: `dependabot-processor:v1:pr=123:head=${HEAD_SHA}:mode=assist:repair=999999999999999999999:packet=true`,
      }),
      reason: "malformed-repair-attempt-receipt",
    },
    {
      check: processorRepairReceipt(1, {
        headSha: OTHER_SHA,
      }),
      reason: "repair-attempt-receipt-outside-lineage",
    },
    {
      check: processorRepairReceipt(1, {
        mode: "observe",
      }),
      reason: "observe-repair-attempt-receipt-issued-packet",
    },
  ];
  for (const { check: receipt, reason } of cases) {
    const result = evaluateDependabotPullRequest(
      snapshot({
        checks: failingChecks,
        repairHistoryChecks: [receipt],
      }),
      { mode: "assist", repository: REPOSITORY },
    );
    assert.equal(result.repairAttempts.valid, false, reason);
    assert.ok(result.repairAttempts.reasons.includes(reason), reason);
    assert.equal(result.repairPacket, null, reason);
  }

  const successfulReceipt = evaluateDependabotPullRequest(
    snapshot({
      checks: failingChecks,
      repairHistoryChecks: [
        { ...processorRepairReceipt(1), conclusion: "success" },
      ],
    }),
    { mode: "assist", repository: REPOSITORY },
  );
  assert.equal(successfulReceipt.repairAttempts.valid, true);
  assert.equal(successfulReceipt.repairAttempt, 1);

  const duplicate = evaluateDependabotPullRequest(
    snapshot({
      checks: failingChecks,
      repairHistoryChecks: [
        processorRepairReceipt(1),
        { ...processorRepairReceipt(1), id: 20_001 },
      ],
    }),
    { mode: "assist", repository: REPOSITORY },
  );
  assert.equal(duplicate.repairAttempts.valid, true);
  assert.equal(duplicate.repairAttempt, 1);
  assert.equal(duplicate.repairAttempts.issuedAttemptCount, 1);

  const conflict = evaluateDependabotPullRequest(
    snapshot({
      checks: failingChecks,
      repairHistoryChecks: [
        processorRepairReceipt(1),
        processorRepairReceipt(2),
      ],
    }),
    { mode: "assist", repository: REPOSITORY },
  );
  assert.equal(conflict.repairAttempts.valid, false);
  assert.ok(
    conflict.repairAttempts.reasons.includes(
      "ambiguous-repair-attempt-history",
    ),
  );

  const missingParent = snapshot({
    checks: failingChecks,
    repairHistoryChecks: [processorRepairReceipt(1)],
  });
  missingParent.commits = [
    { authorLogin: "dependabot[bot]", sha: OTHER_SHA },
    { authorLogin: "alice", sha: HEAD_SHA },
  ];
  const missingParentResult = evaluateDependabotPullRequest(missingParent, {
    mode: "assist",
    repository: REPOSITORY,
  });
  assert.equal(missingParentResult.repairAttempts.valid, false);
  assert.ok(
    missingParentResult.repairAttempts.reasons.includes(
      "repair-lineage-commit-without-parent-packet",
    ),
  );
  assert.equal(missingParentResult.identity.valid, false);
  assert.ok(
    missingParentResult.identity.reasons.includes("untrusted-repair-lineage"),
  );
});

test("a head behind current main waits for a base update and cannot emit a repair packet", () => {
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
    { mode: "merge", repository: REPOSITORY },
  );
  assert.equal(result.disposition, "waiting-base-update");
  assert.equal(result.base.current, false);
  assert.ok(result.base.reasons.includes("head-is-behind-current-base"));
  assert.equal(result.repairPacket, null);
});

test("selects at most one merge candidate per sweep", () => {
  const second = snapshot({
    pullRequest: { ...snapshot().pullRequest, number: 124 },
  });
  const result = evaluateDependabotSweep({
    mode: "merge",
    pullRequests: [second, snapshot()],
    repository: REPOSITORY,
  });
  assert.deepEqual(result.mergeCandidate, {
    headSha: HEAD_SHA,
    pullRequestNumber: 123,
  });
  assert.deepEqual(result.serialization.outstandingAutoMerge, {
    ambiguous: false,
    reasons: [],
    requests: [],
  });
  assert.equal(
    result.evaluations[1].disposition,
    "waiting-merge-serialization",
  );
  assert.equal(result.summary.mergeCandidates, 1);
});

test("blocks merge serialization without an exact trusted main receipt", () => {
  const withoutReceipt = snapshot();
  withoutReceipt.baseline.checks = withoutReceipt.baseline.checks.filter(
    ({ name }) => name !== "Dependabot Post-Merge Verification",
  );
  const result = evaluateDependabotSweep({
    mode: "merge",
    pullRequests: [withoutReceipt],
    repository: REPOSITORY,
  });
  assert.equal(result.mergeCandidate, null);
  assert.equal(result.serialization.ready, false);
  assert.equal(
    result.evaluations[0].disposition,
    "waiting-post-merge-verification",
  );
});

test("an exact current auto-merge request re-enters the full gate", () => {
  const outstanding = snapshot({
    feedback: {
      autoMergeEnabled: true,
      reviewDecision: "APPROVED",
      unresolvedThreads: 0,
    },
  });
  const result = evaluateDependabotSweep({
    mode: "merge",
    pullRequests: [outstanding],
    repository: REPOSITORY,
  });
  assert.deepEqual(result.mergeCandidate, {
    headSha: HEAD_SHA,
    pullRequestNumber: 123,
  });
  assert.equal(
    result.serialization.reason,
    "exact-candidate-auto-merge-reentry",
  );
  assert.equal(result.serialization.outstandingPullRequestNumber, 123);

  const globalCurrentHeadRecovery = evaluateDependabotSweep({
    mode: "merge",
    outstandingAutoMergeRequests: [
      {
        headSha: HEAD_SHA,
        nodeId: "PR_node",
        pullRequestNumber: 123,
      },
    ],
    pullRequests: [snapshot()],
    repository: REPOSITORY,
  });
  assert.deepEqual(globalCurrentHeadRecovery.mergeCandidate, {
    headSha: HEAD_SHA,
    pullRequestNumber: 123,
  });
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
      mode: "merge",
      outstandingAutoMergeRequests,
      pullRequests: [snapshot()],
      repository: REPOSITORY,
    });
    assert.equal(result.mergeCandidate, null);
    assert.equal(result.serialization.ready, false);
    assert.match(result.serialization.reason, /^outstanding-auto-merge-/);
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

test("process revalidates, approves, and immediately merges only one exact head", async () => {
  const calls = [];
  const events = [];
  let autoMergeEnabled = true;
  let approvalPosted = false;
  let collections = 0;
  const snapshots = new Map([
    [123, snapshot()],
    [
      124,
      snapshot({ pullRequest: { ...snapshot().pullRequest, number: 124 } }),
    ],
  ]);
  const adapter = {
    approvePullRequest: async (input) => {
      events.push("approve");
      assert.equal(input.approvalSnapshot.feedback.autoMergeEnabled, false);
      approvalPosted = true;
      calls.push(["approve", input]);
      return processorApprovalResult();
    },
    collectPullRequestSnapshot: async (_repository, number) => {
      collections += 1;
      events.push(`collect-${collections}`);
      const current = structuredClone(snapshots.get(number));
      current.feedback.autoMergeEnabled = autoMergeEnabled;
      if (approvalPosted) withCurrentProcessorApproval(current);
      return current;
    },
    disablePullRequestAutoMerge: async (input) => {
      events.push("disable");
      assert.equal(input.nodeId, "PR_node");
      autoMergeEnabled = false;
      calls.push(["disable", input]);
    },
    dismissPullRequestApproval: async () =>
      assert.fail("successful merge must not dismiss its approval"),
    getOutstandingDependabotAutoMergeRequests: async () => {
      events.push("global");
      return autoMergeEnabled
        ? [
            {
              headSha: HEAD_SHA,
              nodeId: "PR_node",
              pullRequestNumber: 123,
            },
          ]
        : [];
    },
    getOutstandingDependabotProcessorApprovals: noOutstandingProcessorApprovals,
    mergePullRequest: async (input) => {
      events.push("merge");
      calls.push(["merge", input]);
    },
    publishProcessorCheck: async () =>
      assert.fail(
        "active auto-merge must suppress processor check publication",
      ),
  };
  const result = await processDependabotSweep({
    adapter,
    input: {
      mode: "merge",
      pullRequests: [...snapshots.values()],
      repository: REPOSITORY,
    },
    publishChecks: true,
  });
  assert.deepEqual(
    calls.map(([kind, input]) => [
      kind,
      input.pullRequestNumber,
      input.headSha,
    ]),
    [
      ["disable", 123, HEAD_SHA],
      ["approve", 123, HEAD_SHA],
      ["merge", 123, HEAD_SHA],
    ],
  );
  assert.deepEqual(
    result.mutations.map(({ kind }) => kind),
    ["auto-merge-disabled", "approved", "merged"],
  );
  assert.ok(events.indexOf("disable") < events.indexOf("collect-4"));
  assert.ok(events.indexOf("collect-4") < events.indexOf("approve"));
  assert.ok(
    events
      .slice(events.indexOf("collect-4"), events.indexOf("approve"))
      .filter((event) => event === "global").length >= 1,
  );
  assert.equal(collections, 5);
});

test("a targeted PR B sweep dismisses a stranded approval on PR A before publication and fully re-gates B", async () => {
  const events = [];
  let approvalScans = 0;
  let approvalPosted = false;
  let collections = 0;
  let refreshedTarget = null;
  const selectedPullRequest = {
    ...snapshot().pullRequest,
    node_id: "PR_B",
    number: 124,
  };
  const selected = snapshot({
    pullRequest: selectedPullRequest,
  });
  const adapter = {
    approvePullRequest: async ({ approvalSnapshot, pullRequestNumber }) => {
      events.push(`approve-${pullRequestNumber}`);
      assert.equal(approvalSnapshot.expectedHeadSha, HEAD_SHA);
      approvalPosted = true;
      return processorApprovalResult();
    },
    collectPullRequestSnapshot: async (_repository, number) => {
      collections += 1;
      events.push(`collect-${number}-${collections}`);
      assert.equal(number, 124);
      const current = snapshot({
        expectedHeadSha: OTHER_SHA,
        pullRequest: selectedPullRequest,
      });
      if (collections === 1) refreshedTarget = current;
      return approvalPosted ? withCurrentProcessorApproval(current) : current;
    },
    dismissPullRequestApproval: async ({ approvalId, pullRequestNumber }) => {
      events.push(`dismiss-${pullRequestNumber}-${approvalId}`);
      assert.deepEqual([pullRequestNumber, approvalId], [123, 6001]);
      return { dismissed: true, id: approvalId, state: "DISMISSED" };
    },
    getOutstandingDependabotAutoMergeRequests: async () => {
      events.push("auto-merge-scan");
      return [];
    },
    getOutstandingDependabotProcessorApprovals: async () => {
      approvalScans += 1;
      events.push(`approval-scan-${approvalScans}`);
      return approvalScans === 1
        ? [
            {
              approvalId: 6001,
              headSha: OTHER_SHA,
              pullRequestNumber: 123,
            },
          ]
        : [];
    },
    publishProcessorCheck: async ({ pullRequestNumber }) => {
      events.push(`publish-${pullRequestNumber}`);
    },
    mergePullRequest: async ({ pullRequestNumber }) => {
      events.push(`merge-${pullRequestNumber}`);
    },
  };
  const result = await processDependabotSweep({
    adapter,
    input: {
      mode: "merge",
      outstandingAutoMergeRequests: [],
      pullRequests: [selected],
      repository: REPOSITORY,
    },
    publishChecks: true,
  });
  assert.deepEqual(events, [
    "approval-scan-1",
    "dismiss-123-6001",
    "approval-scan-2",
    "collect-124-1",
    "auto-merge-scan",
    "auto-merge-scan",
    "publish-124",
    "collect-124-2",
    "auto-merge-scan",
    "auto-merge-scan",
    "approve-124",
    "collect-124-3",
    "auto-merge-scan",
    "merge-124",
  ]);
  assert.equal(refreshedTarget.expectedHeadSha, HEAD_SHA);
  assert.deepEqual(
    result.mutations.map(({ kind, pullRequestNumber }) => ({
      kind,
      pullRequestNumber,
    })),
    [
      { kind: "approval-dismissed", pullRequestNumber: 123 },
      { kind: "published-check", pullRequestNumber: 124 },
      { kind: "approved", pullRequestNumber: 124 },
      { kind: "merged", pullRequestNumber: 124 },
    ],
  );
});

test("an initially empty approval inventory still forces a second scan and selected-PR recollection before writes", async () => {
  const events = [];
  let approvalScans = 0;
  let refreshed = null;
  const adapter = {
    approvePullRequest: async () => assert.fail("stale input must not approve"),
    collectPullRequestSnapshot: async (_repository, number) => {
      events.push(`collect-${number}`);
      refreshed = snapshot({
        expectedHeadSha: OTHER_SHA,
        feedback: { autoMergeEnabled: true },
        pullRequest: {
          ...snapshot().pullRequest,
          labels: ["processor:veto"],
        },
      });
      return refreshed;
    },
    dismissPullRequestApproval: async () =>
      assert.fail("an empty inventory must not dismiss"),
    getOutstandingDependabotAutoMergeRequests: async () => {
      events.push("auto-merge-scan");
      return [];
    },
    getOutstandingDependabotProcessorApprovals: async () => {
      approvalScans += 1;
      events.push(`approval-scan-${approvalScans}`);
      return [];
    },
    mergePullRequest: async () => assert.fail("stale input must not merge"),
    publishProcessorCheck: async () =>
      assert.fail("stale input must not publish"),
  };
  const result = await processDependabotSweep({
    adapter,
    input: {
      mode: "merge",
      outstandingAutoMergeRequests: [],
      pullRequests: [snapshot()],
      repository: REPOSITORY,
    },
    publishChecks: true,
  });
  assert.deepEqual(events, [
    "approval-scan-1",
    "approval-scan-2",
    "collect-123",
    "auto-merge-scan",
    "auto-merge-scan",
  ]);
  assert.equal(refreshed.expectedHeadSha, HEAD_SHA);
  assert.equal(result.mergeCandidate, null);
  assert.deepEqual(result.mutations, []);
  assert.equal(result.evaluations[0].disposition, "manual-veto-or-feedback");
});

test("repository-wide reconciliation dismisses every independently valid current approval, including multiples", async () => {
  const dismissed = [];
  let approvalScans = 0;
  const adapter = {
    collectPullRequestSnapshot: async () => snapshot(),
    dismissPullRequestApproval: async ({ approvalId, pullRequestNumber }) => {
      dismissed.push([pullRequestNumber, approvalId]);
      return { dismissed: true, id: approvalId, state: "DISMISSED" };
    },
    getOutstandingDependabotAutoMergeRequests: async () => [],
    getOutstandingDependabotProcessorApprovals: async () => {
      approvalScans += 1;
      return approvalScans === 1
        ? [
            {
              approvalId: 6002,
              headSha: OTHER_SHA,
              pullRequestNumber: 123,
            },
            {
              approvalId: 6001,
              headSha: OTHER_SHA,
              pullRequestNumber: 123,
            },
            {
              approvalId: 6003,
              headSha: HEAD_SHA,
              pullRequestNumber: 125,
            },
          ]
        : [];
    },
    publishProcessorCheck: async () => {},
  };
  const result = await processDependabotSweep({
    adapter,
    input: {
      mode: "assist",
      outstandingAutoMergeRequests: [],
      pullRequests: [snapshot()],
      repository: REPOSITORY,
    },
    publishChecks: true,
  });
  assert.deepEqual(dismissed, [
    [123, 6001],
    [123, 6002],
    [125, 6003],
  ]);
  assert.equal(approvalScans, 2);
  assert.deepEqual(
    result.mutations.map(({ kind }) => kind),
    [
      "approval-dismissed",
      "approval-dismissed",
      "approval-dismissed",
      "published-check",
    ],
  );
});

test("malformed repository-wide processor approval evidence fails before any write", async () => {
  const writes = [];
  await assert.rejects(
    processDependabotSweep({
      adapter: {
        approvePullRequest: async () => writes.push("approve"),
        collectPullRequestSnapshot: async () =>
          assert.fail("must not recollect malformed approval evidence"),
        dismissPullRequestApproval: async () => writes.push("dismiss"),
        getOutstandingDependabotAutoMergeRequests: async () => {
          writes.push("auto-merge-read");
          return [];
        },
        getOutstandingDependabotProcessorApprovals: async () => [
          {
            approvalId: 6001,
            headSha: "not-a-sha",
            pullRequestNumber: 123,
          },
        ],
        publishProcessorCheck: async () => writes.push("publish"),
      },
      input: {
        mode: "merge",
        outstandingAutoMergeRequests: [],
        pullRequests: [snapshot()],
        repository: REPOSITORY,
      },
      publishChecks: true,
    }),
    /Repository-wide processor approval inventory is malformed/,
  );
  assert.deepEqual(writes, []);
});

test("reconciliation attempts every validated approval and blocks new authority when the global rescan remains occupied", async () => {
  const events = [];
  let approvalScans = 0;
  const approvals = [
    {
      approvalId: 6001,
      headSha: OTHER_SHA,
      pullRequestNumber: 123,
    },
    {
      approvalId: 6002,
      headSha: OTHER_SHA,
      pullRequestNumber: 123,
    },
    {
      approvalId: 6003,
      headSha: HEAD_SHA,
      pullRequestNumber: 125,
    },
  ];
  await assert.rejects(
    processDependabotSweep({
      adapter: {
        collectPullRequestSnapshot: async () => {
          events.push("collect");
          return snapshot();
        },
        dismissPullRequestApproval: async ({ approvalId }) => {
          events.push(`dismiss-${approvalId}`);
          if (approvalId === 6001) throw new Error("transient dismissal error");
          return { dismissed: true, id: approvalId, state: "DISMISSED" };
        },
        getOutstandingDependabotAutoMergeRequests: async () => {
          events.push("auto-merge-read");
          return [];
        },
        getOutstandingDependabotProcessorApprovals: async () => {
          approvalScans += 1;
          events.push(`approval-scan-${approvalScans}`);
          return approvalScans === 1 ? approvals : [approvals[0]];
        },
        publishProcessorCheck: async () => events.push("publish"),
      },
      input: {
        mode: "assist",
        outstandingAutoMergeRequests: [],
        pullRequests: [snapshot()],
        repository: REPOSITORY,
      },
      publishChecks: true,
    }),
    /Repository-wide processor approval reconciliation failed/,
  );
  assert.deepEqual(events, [
    "approval-scan-1",
    "dismiss-6001",
    "dismiss-6002",
    "dismiss-6003",
    "approval-scan-2",
  ]);
});

test("failure to disable the exact matching auto-merge request prevents approval and check publication", async () => {
  let approved = false;
  let published = false;
  const adapter = {
    approvePullRequest: async () => {
      approved = true;
    },
    collectPullRequestSnapshot: async () => {
      const current = snapshot();
      current.feedback.autoMergeEnabled = true;
      return current;
    },
    disablePullRequestAutoMerge: async () => {
      throw new Error("disable mutation failed");
    },
    getOutstandingDependabotAutoMergeRequests: async () => [
      {
        headSha: HEAD_SHA,
        nodeId: "PR_node",
        pullRequestNumber: 123,
      },
    ],
    getOutstandingDependabotProcessorApprovals: noOutstandingProcessorApprovals,
    mergePullRequest: async () => assert.fail("must not merge"),
    publishProcessorCheck: async () => {
      published = true;
    },
  };
  await assert.rejects(
    processDependabotSweep({
      adapter,
      input: {
        mode: "merge",
        pullRequests: [snapshot()],
        repository: REPOSITORY,
      },
      publishChecks: true,
    }),
    /disable mutation failed/,
  );
  assert.equal(published, false);
  assert.equal(approved, false);
});

test("process rechecks the exact-main serialization receipt after approval", async () => {
  let collections = 0;
  let approved = false;
  let dismissed = false;
  const adapter = {
    approvePullRequest: async () => {
      approved = true;
      return processorApprovalResult();
    },
    collectPullRequestSnapshot: async () => {
      collections += 1;
      const current = snapshot();
      if (collections === 3) {
        withCurrentProcessorApproval(current);
        current.baseline.checks = current.baseline.checks.filter(
          ({ name }) => name !== "Dependabot Post-Merge Verification",
        );
      }
      return current;
    },
    dismissPullRequestApproval: async () => {
      dismissed = true;
      return { dismissed: true, id: 7001, state: "DISMISSED" };
    },
    getOutstandingDependabotAutoMergeRequests: async () => [],
    getOutstandingDependabotProcessorApprovals: noOutstandingProcessorApprovals,
    mergePullRequest: async () => assert.fail("must not merge"),
  };
  await assert.rejects(
    processDependabotSweep({
      adapter,
      input: {
        mode: "merge",
        pullRequests: [snapshot()],
        repository: REPOSITORY,
      },
    }),
    /changed after approval/,
  );
  assert.equal(approved, true);
  assert.equal(dismissed, true);
});

test("process rechecks current-main ancestry after approval", async () => {
  let collections = 0;
  let dismissed = false;
  const adapter = {
    approvePullRequest: async () => processorApprovalResult(),
    collectPullRequestSnapshot: async () => {
      collections += 1;
      const current = snapshot();
      if (collections === 3) {
        withCurrentProcessorApproval(current);
        current.baseAncestry = {
          ...current.baseAncestry,
          behindBy: 1,
          currentBaseIsAncestor: false,
          mergeBaseSha: OTHER_SHA,
          status: "diverged",
        };
      }
      return current;
    },
    dismissPullRequestApproval: async () => {
      dismissed = true;
      return { dismissed: true, id: 7001, state: "DISMISSED" };
    },
    getOutstandingDependabotAutoMergeRequests: async () => [],
    getOutstandingDependabotProcessorApprovals: noOutstandingProcessorApprovals,
    mergePullRequest: async () => assert.fail("must not merge"),
  };
  await assert.rejects(
    processDependabotSweep({
      adapter,
      input: {
        mode: "merge",
        outstandingAutoMergeRequests: [],
        pullRequests: [snapshot()],
        repository: REPOSITORY,
      },
    }),
    /changed after approval/,
  );
  assert.equal(dismissed, true);
});

test("process repeats the repository-wide auto-merge check immediately before approval", async () => {
  let approved = false;
  let globalReads = 0;
  const adapter = {
    approvePullRequest: async () => {
      approved = true;
    },
    collectPullRequestSnapshot: async () => snapshot(),
    getOutstandingDependabotAutoMergeRequests: async () => {
      globalReads += 1;
      return globalReads === 1
        ? []
        : [
            {
              headSha: OTHER_SHA,
              nodeId: "PR_other",
              pullRequestNumber: 999,
            },
          ];
    },
    getOutstandingDependabotProcessorApprovals: noOutstandingProcessorApprovals,
    mergePullRequest: async () => assert.fail("must not merge"),
  };
  await assert.rejects(
    processDependabotSweep({
      adapter,
      input: {
        mode: "merge",
        outstandingAutoMergeRequests: [],
        pullRequests: [snapshot()],
        repository: REPOSITORY,
      },
    }),
    /Another Dependabot auto-merge request occupies/,
  );
  assert.equal(approved, false);
  assert.equal(globalReads, 2);
});

test("process repeats the repository-wide auto-merge check after approval and before merge", async () => {
  let approved = false;
  let dismissed = false;
  let globalReads = 0;
  const adapter = {
    approvePullRequest: async () => {
      approved = true;
      return processorApprovalResult();
    },
    collectPullRequestSnapshot: async () =>
      approved ? withCurrentProcessorApproval(snapshot()) : snapshot(),
    dismissPullRequestApproval: async () => {
      dismissed = true;
      return { dismissed: true, id: 7001, state: "DISMISSED" };
    },
    getOutstandingDependabotAutoMergeRequests: async () => {
      globalReads += 1;
      return globalReads <= 3
        ? []
        : [
            {
              headSha: OTHER_SHA,
              nodeId: "PR_other",
              pullRequestNumber: 999,
            },
          ];
    },
    getOutstandingDependabotProcessorApprovals: noOutstandingProcessorApprovals,
    mergePullRequest: async () => assert.fail("must not merge"),
  };
  await assert.rejects(
    processDependabotSweep({
      adapter,
      input: {
        mode: "merge",
        outstandingAutoMergeRequests: [],
        pullRequests: [snapshot()],
        repository: REPOSITORY,
      },
    }),
    /repository auto-merge lane must be empty before mutation/,
  );
  assert.equal(approved, true);
  assert.equal(dismissed, true);
  assert.equal(globalReads, 4);
});

test("approval postconditions and merge failures both withdraw the exact processor review", async () => {
  for (const scenario of ["wrong-review", "merge-error"]) {
    let approved = false;
    let dismissed = false;
    const adapter = {
      approvePullRequest: async () => {
        approved = true;
        return processorApprovalResult();
      },
      collectPullRequestSnapshot: async () => {
        const current = snapshot();
        if (approved) {
          withCurrentProcessorApproval(
            current,
            scenario === "wrong-review" ? 7002 : 7001,
          );
        }
        return current;
      },
      dismissPullRequestApproval: async ({ approvalId }) => {
        assert.equal(approvalId, 7001);
        dismissed = true;
        return { dismissed: true, id: approvalId, state: "DISMISSED" };
      },
      getOutstandingDependabotAutoMergeRequests: async () => [],
      getOutstandingDependabotProcessorApprovals:
        noOutstandingProcessorApprovals,
      mergePullRequest: async () => {
        throw new Error("merge exploded after head drift");
      },
    };
    await assert.rejects(
      processDependabotSweep({
        adapter,
        input: {
          mode: "merge",
          outstandingAutoMergeRequests: [],
          pullRequests: [snapshot()],
          repository: REPOSITORY,
        },
      }),
      scenario === "wrong-review"
        ? /processor approval postcondition failed/
        : /merge exploded after head drift/,
    );
    assert.equal(dismissed, true, scenario);
  }
});

test("process performs no approval or merge mutation outside merge mode", async () => {
  const adapter = {
    approvePullRequest: async () => assert.fail("must not approve"),
    collectPullRequestSnapshot: async () => snapshot(),
    mergePullRequest: async () => assert.fail("must not merge"),
  };
  const result = await processDependabotSweep({
    adapter,
    input: {
      mode: "assist",
      pullRequests: [snapshot()],
      repository: REPOSITORY,
    },
  });
  assert.deepEqual(result.mutations, []);
  assert.equal(result.evaluations[0].disposition, "ready-for-approval");
});

test("live merge mode requires a dedicated merge token before any mutation", async () => {
  const adapter = createLiveGitHubAdapter({
    execFileImpl: async () => assert.fail("must not invoke gh merge"),
    fetchImpl: async () => assert.fail("must not read or mutate GitHub"),
    mergeToken: "",
    token: "workflow-token",
  });
  await assert.rejects(
    processDependabotSweep({
      adapter,
      input: {
        mode: "merge",
        outstandingAutoMergeRequests: [],
        pullRequests: [snapshot()],
        repository: REPOSITORY,
      },
      publishChecks: true,
    }),
    /dedicated Dependabot processor merge token is required/,
  );
});

test("live observe and assist modes do not require a merge token", async () => {
  for (const mode of ["observe", "assist"]) {
    const adapter = createLiveGitHubAdapter({
      fetchImpl: async () => assert.fail("must not access GitHub"),
      mergeToken: "",
      token: "workflow-token",
    });
    const result = await processDependabotSweep({
      adapter,
      input: {
        mode,
        outstandingAutoMergeRequests: [],
        pullRequests: [snapshot()],
        repository: REPOSITORY,
      },
    });
    assert.deepEqual(result.mutations, [], mode);
  }
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
      body: `Approved by dependabot-processor:v1 for exact head ${HEAD_SHA}.`,
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

test("live merge adapter uses an immediate protected exact-head merge and never bypasses protection", async () => {
  const executions = [];
  const fetchImpl = async (url, options = {}) => {
    if (url.endsWith(`/repos/${REPOSITORY}/pulls/123`)) {
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
          labels: [],
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
    if (
      url.includes(`/repos/${REPOSITORY}/pulls/123/reviews`) ||
      url.includes(`/repos/${REPOSITORY}/issues/123/comments`) ||
      url.includes(`/repos/${REPOSITORY}/issues/123/events`)
    ) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    if (url.endsWith(`/repos/${REPOSITORY}/commits/main`)) {
      return new Response(JSON.stringify({ sha: BASE_SHA }), { status: 200 });
    }
    if (
      url.endsWith(`/repos/${REPOSITORY}/compare/${BASE_SHA}...${HEAD_SHA}`)
    ) {
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
    assert.fail(`Unexpected request: ${options.method} ${url}`);
  };
  const adapter = createLiveGitHubAdapter({
    execFileImpl: async (file, arguments_, options) => {
      executions.push({ arguments_, file, options });
      return { stdout: "enabled" };
    },
    fetchImpl,
    mergeToken: "merge-token",
    token: "test-token",
  });
  await adapter.mergePullRequest({
    headSha: HEAD_SHA,
    pullRequestNumber: 123,
    repository: REPOSITORY,
  });
  assert.deepEqual(executions[0].arguments_, [
    "pr",
    "merge",
    "123",
    "--repo",
    REPOSITORY,
    "--squash",
    "--match-head-commit",
    HEAD_SHA,
  ]);
  assert.equal(executions[0].arguments_.includes("--admin"), false);
  assert.equal(executions[0].options.env.GH_TOKEN, "merge-token");
  assert.equal(
    executions[0].options.env.DEPENDABOT_PROCESSOR_GITHUB_TOKEN,
    undefined,
  );
  assert.equal(
    executions[0].options.env.DEPENDABOT_PROCESSOR_MERGE_TOKEN,
    undefined,
  );
  assert.equal(executions[0].options.env.GITHUB_TOKEN, undefined);
});

test("final merge admission rechecks current veto labels and paginated durable close history", async () => {
  for (const input of [
    { labels: ["do-not-merge"] },
    { events: [{ actor: { login: "alice" }, event: "closed" }] },
    {
      events: [
        { actor: { login: "alice" }, event: "closed" },
        { actor: { login: "alice" }, event: "reopened" },
      ],
    },
    {
      events: [
        {
          actor: { login: "dependabot[bot]" },
          commit_id: OTHER_SHA,
          event: "head_ref_force_pushed",
        },
      ],
    },
  ]) {
    const adapter = createLiveGitHubAdapter({
      execFileImpl: async () => assert.fail("must not invoke gh merge"),
      fetchImpl: liveMergeAdmissionFetch(input),
      mergeToken: "merge-token",
      token: "test-token",
    });
    await assert.rejects(
      adapter.mergePullRequest({
        headSha: HEAD_SHA,
        pullRequestNumber: 123,
        repository: REPOSITORY,
      }),
      /feedback changed during merge admission/,
      JSON.stringify(input),
    );
  }
});

test("live check collection binds a check to its queried workflow repository", async () => {
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
});

test("live repair-history collection uses only the name-filtered check-run endpoint", async () => {
  const requested = [];
  const receipt = processorRepairReceipt(1);
  const adapter = createLiveGitHubAdapter({
    fetchImpl: async (url) => {
      const parsed = new URL(url);
      requested.push(parsed);
      assert.equal(
        parsed.pathname,
        `/repos/${REPOSITORY}/commits/${HEAD_SHA}/check-runs`,
      );
      assert.equal(
        parsed.searchParams.get("check_name"),
        "Dependabot Processor",
      );
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
      conclusion: "neutral",
      externalId: receipt.externalId,
      headSha: HEAD_SHA,
      id: receipt.id,
      kind: "check",
      name: "Dependabot Processor",
      startedAt: "2026-08-10T09:59:00Z",
      status: "completed",
    },
  ]);
  assert.equal(requested.length, 1);
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
  await adapter.publishProcessorCheck({
    conclusion: "neutral",
    headSha: HEAD_SHA,
    mode: "assist",
    output: { summary: "repair", title: "repair" },
    pullRequestNumber: 123,
    repairAttempt: 2,
    repairPacketIssued: true,
    repository: REPOSITORY,
  });
  assert.equal(
    bodies[0].external_id,
    `dependabot-processor:v1:pr=123:head=${HEAD_SHA}:mode=assist:repair=2:packet=true`,
  );
  await assert.rejects(
    adapter.publishProcessorCheck({
      conclusion: "neutral",
      headSha: HEAD_SHA,
      mode: "observe",
      output: { summary: "observe", title: "observe" },
      pullRequestNumber: 123,
      repairAttempt: 1,
      repairPacketIssued: true,
      repository: REPOSITORY,
    }),
    /Observe processor checks cannot issue repair packets/,
  );
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

test("live durable intervention evidence paginates force pushes regardless actor and survives a reopen", async () => {
  const requestedPages = [];
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
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
          {
            actor: { login: "dependabot[bot]" },
            commit_id: OTHER_SHA,
            event: "head_ref_force_pushed",
          },
          {
            actor: null,
            commit_id: "malformed",
            event: "head_ref_force_pushed",
          },
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
    forcePushCommitIds: [OTHER_SHA],
    forcePushEventCount: 2,
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
    mode: "merge",
    repository: REPOSITORY,
  });
  assert.equal(evaluation.identity.automaticAuthority, false);
  assert.equal(evaluation.repairPacket, null);
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
                    body: `Approved by dependabot-processor:v1 for exact head ${OTHER_SHA}.`,
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
      },
      publishChecks: true,
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
        },
        publishChecks: true,
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
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    const path = parsed.pathname;
    if (url.endsWith("/graphql")) {
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
      if (parsed.searchParams.get("check_name") === "Dependabot Processor") {
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

test("CLI tolerates a leading separator and pure process fails closed without an adapter", () => {
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
    assert.equal(result.mode, "merge");
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
