import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  ACTIONS_COMPANION_INPUT_SCHEMA,
  ACTIONS_COMPANION_PLAN_SCHEMA,
  ACTIONS_COMPANION_STAGED_SCHEMA,
  canonicalJson,
  createOsvActionsCompanionPlan,
  evaluateOsvActionsCompanion,
  OSV_MIRROR_TEST_PATH,
  OSV_REPORTER_ACTION,
  OSV_SCANNER_ACTION,
  OSV_WORKFLOW_PATH,
  verifyOsvActionsCompanionPlan,
  verifyStagedOsvActionsCompanion,
} from "./dependabot-actions-companion.mjs";

const SCRIPT_PATH = fileURLToPath(
  new URL("./dependabot-actions-companion.mjs", import.meta.url),
);
const FROM_SHA = "a".repeat(40);
const TO_SHA = "b".repeat(40);
const BASE_SHA = "c".repeat(40);
const BASE_TREE_SHA = "d".repeat(40);
const HEAD_SHA = "e".repeat(40);

test("canonical JSON uses locale-independent code-unit key order", () => {
  assert.equal(
    canonicalJson({ pr: { mergedAt: null, mergeSha: null } }),
    '{"pr":{"mergeSha":null,"mergedAt":null}}',
  );
});

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function gitBlobSha(value) {
  const bytes = Buffer.from(value, "utf8");
  return createHash("sha1")
    .update(`blob ${bytes.byteLength}\0`)
    .update(bytes)
    .digest("hex");
}

function baseWorkflow() {
  return [
    "name: OSV Scanner (read-only)",
    "jobs:",
    "  scan:",
    "    steps:",
    "      - name: Scan",
    `        uses: ${OSV_SCANNER_ACTION}@${FROM_SHA} # v2.5.1`,
    "        with:",
    "          scan-args: lock.yaml",
    "      - name: Report",
    `        uses: ${OSV_REPORTER_ACTION}@${FROM_SHA} # v2.5.1`,
    "        with:",
    "          fail-on-vuln: true",
    "",
  ].join("\n");
}

function sourceWorkflow() {
  return baseWorkflow().replaceAll(FROM_SHA, TO_SHA);
}

function mirrorTest() {
  return [
    `const scanner = "${OSV_SCANNER_ACTION}@${FROM_SHA}";`,
    `const reporter = "${OSV_REPORTER_ACTION}@${FROM_SHA}";`,
    "assert.equal(scan.uses, scanner);",
    "assert.equal(report.uses, reporter);",
    "",
  ].join("\n");
}

function sourceMessage() {
  return [
    "chore(ci): bump the github-actions-manual group across 1 directory with 2 updates",
    "",
    "Bumps the github-actions-manual group with 2 updates in the / directory.",
    "",
    `Updates \`${OSV_SCANNER_ACTION}\` from ${FROM_SHA} to ${TO_SHA}`,
    `Updates \`${OSV_REPORTER_ACTION}\` from ${FROM_SHA} to ${TO_SHA}`,
    "",
  ].join("\n");
}

function input() {
  const workflow = baseWorkflow();
  const mirror = mirrorTest();
  return {
    currentBase: {
      commitSha: BASE_SHA,
      ref: "main",
      treeSha: BASE_TREE_SHA,
    },
    mirror: {
      baseContent: mirror,
      path: OSV_MIRROR_TEST_PATH,
    },
    mode: "prepare",
    oldReferenceFiles: [
      {
        contentSha256: sha256(workflow),
        oldShaOccurrences: 2,
        path: OSV_WORKFLOW_PATH,
      },
      {
        contentSha256: sha256(mirror),
        oldShaOccurrences: 2,
        path: OSV_MIRROR_TEST_PATH,
      },
    ],
    processor: {
      approved: false,
      autoMergeEnabled: false,
      disposition: "manual-review",
    },
    repository: "mento-protocol/frontend-monorepo",
    schema: ACTIONS_COMPANION_INPUT_SCHEMA,
    sourcePullRequest: {
      author: {
        id: 49_699_333,
        login: "dependabot[bot]",
        type: "Bot",
      },
      base: {
        ref: "main",
        repository: "mento-protocol/frontend-monorepo",
        sha: BASE_SHA,
      },
      commits: [
        {
          author: {
            id: 49_699_333,
            login: "dependabot[bot]",
            type: "Bot",
          },
          committer: {
            id: 19_864_447,
            login: "web-flow",
            type: "User",
          },
          message: sourceMessage(),
          parentShas: [BASE_SHA],
          sha: HEAD_SHA,
          verificationReason: "valid",
          verified: true,
        },
      ],
      draft: false,
      files: [
        {
          baseContent: workflow,
          path: OSV_WORKFLOW_PATH,
          previousPath: null,
          sourceContent: sourceWorkflow(),
          status: "modified",
        },
      ],
      head: {
        ref: "dependabot/github_actions/github-actions-manual-a7528f0b61",
        repository: "mento-protocol/frontend-monorepo",
        sha: HEAD_SHA,
      },
      labels: [],
      metadata: {
        dependencies: [
          { from: FROM_SHA, name: OSV_SCANNER_ACTION, to: TO_SHA },
          { from: FROM_SHA, name: OSV_REPORTER_ACTION, to: TO_SHA },
        ],
        dependencyGroup: "github-actions-manual",
        packageEcosystem: "github-actions",
      },
      number: 840,
      state: "open",
    },
  };
}

function rejected(mutator, reason) {
  const candidate = structuredClone(input());
  mutator(candidate);
  const result = evaluateOsvActionsCompanion(candidate);
  assert.equal(result.eligible, false);
  assert.equal(result.result, "manual-review");
  assert.equal(result.reason, reason);
  assert.equal(result.plan, null);
}

function stagedHead(plan) {
  return {
    branchRef: plan.branchRef,
    commitMessage: plan.commitMessage,
    commitSha: "f".repeat(40),
    edits: plan.edits.map((edit) => ({
      blobSha: edit.resultBlobSha,
      contentSha256: edit.resultContentSha256,
      mode: edit.mode,
      path: edit.path,
    })),
    parentCommitSha: plan.parentCommitSha,
    parentTreeSha: plan.parentTreeSha,
    planDigest: plan.planDigest,
    repository: plan.repository,
    schema: ACTIONS_COMPANION_STAGED_SCHEMA,
    treeDigest: plan.treeDigest,
    treeSha: "1".repeat(40),
  };
}

test("plans the exact two-file OSV companion deterministically", () => {
  const first = createOsvActionsCompanionPlan(input());
  const second = createOsvActionsCompanionPlan(input());
  const reorderedCensus = input();
  reorderedCensus.oldReferenceFiles.reverse();
  assert.deepEqual(first, second);
  assert.deepEqual(first, createOsvActionsCompanionPlan(reorderedCensus));
  assert.equal(first.schema, ACTIONS_COMPANION_PLAN_SCHEMA);
  assert.equal(first.eligible, true);
  assert.equal(first.result, "create");
  assert.equal(first.reason, null);
  assert.equal(first.adapter, "osv-internal-pair:v1");
  assert.equal(first.branchRef, "dependabot-companion/osv-pr-840-eeeeeeeeeeee");
  assert.equal(
    first.pullRequestTitle,
    "chore(ci): apply OSV action update from Dependabot #840",
  );
  assert.equal(first.readyForReview, true);
  assert.deepEqual(first.source, {
    baseRef: "main",
    baseSha: BASE_SHA,
    commitSha: HEAD_SHA,
    headRef: "dependabot/github_actions/github-actions-manual-a7528f0b61",
    headSha: HEAD_SHA,
    pullRequestNumber: 840,
    repository: "mento-protocol/frontend-monorepo",
  });
  assert.equal(first.parentCommitSha, BASE_SHA);
  assert.equal(first.parentTreeSha, BASE_TREE_SHA);
  assert.match(first.treeDigest, /^[0-9a-f]{64}$/u);
  assert.match(first.planDigest, /^[0-9a-f]{64}$/u);
  assert.deepEqual(
    first.edits.map(({ origin, path }) => ({ origin, path })),
    [
      { origin: "verified-dependabot-head", path: OSV_WORKFLOW_PATH },
      {
        origin: "deterministic-osv-test-mirror",
        path: OSV_MIRROR_TEST_PATH,
      },
    ],
  );

  const workflowEdit = first.edits[0];
  assert.equal(workflowEdit.baseBlobSha, gitBlobSha(baseWorkflow()));
  assert.equal(workflowEdit.sourceBlobSha, gitBlobSha(sourceWorkflow()));
  assert.equal(workflowEdit.resultBlobSha, gitBlobSha(sourceWorkflow()));
  assert.equal(
    Buffer.from(workflowEdit.resultContentBase64, "base64").toString("utf8"),
    sourceWorkflow(),
  );
  const mirrorResult = mirrorTest().replaceAll(FROM_SHA, TO_SHA);
  const mirrorEdit = first.edits[1];
  assert.equal(mirrorEdit.baseContentSha256, sha256(mirrorTest()));
  assert.equal(mirrorEdit.sourceContentSha256, sha256(mirrorTest()));
  assert.equal(mirrorEdit.resultContentSha256, sha256(mirrorResult));
  assert.equal(
    Buffer.from(mirrorEdit.resultContentBase64, "base64").toString("utf8"),
    mirrorResult,
  );
  assert.match(
    first.commitMessage,
    new RegExp(`Plan-Digest: ${first.planDigest}$`, "u"),
  );
  assert.match(first.pullRequestBody, /^## The Problem\n/mu);
  assert.match(first.pullRequestBody, /\n## The Solution\n/u);
  assert.match(
    first.pullRequestBody,
    /Keep review and merge decisions with a human/u,
  );
  assert.doesNotMatch(
    first.pullRequestBody,
    /ALL CLEAR|approved by the processor/iu,
  );

  assert.deepEqual(verifyOsvActionsCompanionPlan(input(), first), {
    eligible: true,
    planDigest: first.planDigest,
    reason: null,
    result: "verified",
    schema: "dependabot-actions-companion-verification:v1",
  });
  assert.equal(
    verifyStagedOsvActionsCompanion(input(), first, stagedHead(first)).result,
    "verified-staged-head",
  );
});

test("rejects any source change beyond the two full OSV SHA replacements", () => {
  rejected((value) => {
    value.sourcePullRequest.files[0].sourceContent = `${sourceWorkflow()}permissions:\n  contents: write\n`;
  }, "osv-source-has-unsupported-changes");
  rejected((value) => {
    value.sourcePullRequest.files[0].sourceContent = sourceWorkflow().replace(
      "fail-on-vuln: true",
      "fail-on-vuln: false",
    );
  }, "osv-source-has-unsupported-changes");
  rejected((value) => {
    value.sourcePullRequest.files[0].sourceContent = sourceWorkflow().replace(
      `${OSV_REPORTER_ACTION}@${TO_SHA}`,
      `${OSV_REPORTER_ACTION}@${"9".repeat(40)}`,
    );
  }, "osv-action-transition-invalid");
  rejected((value) => {
    value.sourcePullRequest.files[0].sourceContent = sourceWorkflow().replace(
      TO_SHA,
      "v2.5.2",
    );
  }, "osv-action-reference-count-invalid");
  rejected((value) => {
    value.sourcePullRequest.files[0].status = "renamed";
  }, "source-file-status-invalid");
  rejected((value) => {
    value.sourcePullRequest.files.push({
      ...value.sourcePullRequest.files[0],
      path: ".github/workflows/ci.yml",
    });
  }, "source-files-invalid");
});

test("rejects non-native, stale, or untrusted source pull requests", () => {
  const cases = [
    [(value) => (value.mode = "assist"), "processor-mode-invalid"],
    [
      (value) => (value.sourcePullRequest.state = "closed"),
      "source-pr-not-open",
    ],
    [(value) => (value.sourcePullRequest.draft = true), "source-pr-is-draft"],
    [
      (value) => (value.sourcePullRequest.author.id = 1),
      "source-pr-author-invalid",
    ],
    [
      (value) =>
        (value.sourcePullRequest.head.ref =
          "dependabot/github_actions/github-actions-routine"),
      "source-head-ref-invalid",
    ],
    [
      (value) => (value.sourcePullRequest.head.repository = "fork/repo"),
      "source-head-repository-invalid",
    ],
    [
      (value) => (value.sourcePullRequest.base.sha = "9".repeat(40)),
      "source-base-is-stale",
    ],
    [
      (value) =>
        value.sourcePullRequest.commits.push(
          value.sourcePullRequest.commits[0],
        ),
      "source-commit-count-invalid",
    ],
    [
      (value) =>
        (value.sourcePullRequest.commits[0].parentShas = ["9".repeat(40)]),
      "source-commit-parent-mismatch",
    ],
    [
      (value) => (value.sourcePullRequest.commits[0].verified = false),
      "source-commit-signature-invalid",
    ],
    [
      (value) => (value.sourcePullRequest.commits[0].committer.login = "owner"),
      "source-commit-committer-invalid",
    ],
    [
      (value) =>
        (value.sourcePullRequest.metadata.dependencyGroup =
          "github-actions-routine"),
      "source-group-invalid",
    ],
    [
      (value) =>
        (value.sourcePullRequest.metadata.dependencies[0].to = "9".repeat(40)),
      "source-dependencies-invalid",
    ],
  ];
  for (const [mutator, reason] of cases) rejected(mutator, reason);
});

test("rejects vetoes, prior authority, mirror drift, and an incomplete old-reference census", () => {
  rejected(
    (value) => value.sourcePullRequest.labels.push("do-not-merge"),
    "source-pr-has-veto-label",
  );
  rejected(
    (value) => (value.processor.approved = true),
    "processor-state-invalid",
  );
  rejected(
    (value) => (value.processor.autoMergeEnabled = true),
    "processor-state-invalid",
  );
  rejected((value) => {
    value.mirror.baseContent = value.mirror.baseContent.replace(
      `${OSV_REPORTER_ACTION}@${FROM_SHA}`,
      `${OSV_REPORTER_ACTION}@${TO_SHA}`,
    );
  }, "mirror-reference-count-invalid");
  rejected(
    (value) => value.oldReferenceFiles.pop(),
    "old-reference-census-invalid",
  );
  rejected((value) => {
    value.oldReferenceFiles.push({
      contentSha256: sha256(`documentation ${FROM_SHA}\n`),
      oldShaOccurrences: 1,
      path: "docs/dependabot.md",
    });
  }, "old-reference-census-invalid");
  rejected(
    (value) => (value.oldReferenceFiles[0].contentSha256 = "0".repeat(64)),
    "old-reference-census-invalid",
  );
});

test("plan and staged-head verification fail closed on any drift", () => {
  const plan = createOsvActionsCompanionPlan(input());
  const tamperedPlan = structuredClone(plan);
  tamperedPlan.pullRequestTitle = "chore(ci): trust me";
  assert.deepEqual(verifyOsvActionsCompanionPlan(input(), tamperedPlan), {
    eligible: false,
    planDigest: null,
    reason: "plan-mismatch",
    result: "manual-review",
    schema: "dependabot-actions-companion-verification:v1",
  });

  for (const [field, replacement, reason] of [
    ["branchRef", "dependabot-companion/other", "staged-branch-mismatch"],
    ["parentCommitSha", "9".repeat(40), "staged-parent-commit-mismatch"],
    ["treeDigest", "9".repeat(64), "staged-tree-digest-mismatch"],
    ["planDigest", "9".repeat(64), "staged-plan-digest-mismatch"],
    ["commitMessage", "different", "staged-commit-message-mismatch"],
  ]) {
    const staged = stagedHead(plan);
    staged[field] = replacement;
    assert.equal(
      verifyStagedOsvActionsCompanion(input(), plan, staged).reason,
      reason,
    );
  }
  const staged = stagedHead(plan);
  staged.edits[0].blobSha = "9".repeat(40);
  assert.equal(
    verifyStagedOsvActionsCompanion(input(), plan, staged).reason,
    "staged-edits-mismatch",
  );

  const staleInput = input();
  staleInput.sourcePullRequest.head.sha = "8".repeat(40);
  assert.equal(
    verifyStagedOsvActionsCompanion(staleInput, plan, stagedHead(plan)).reason,
    "source-commit-head-mismatch",
  );
});

test("CLI emits canonical plan and verification receipts without overwriting files", () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "osv-companion-test-"));
  try {
    const inputPath = join(temporaryRoot, "input.json");
    const evaluationPath = join(temporaryRoot, "evaluation.json");
    const planPath = join(temporaryRoot, "plan.json");
    const verificationPath = join(temporaryRoot, "verification.json");
    writeFileSync(inputPath, JSON.stringify(input()));
    let run = spawnSync(
      process.execPath,
      [SCRIPT_PATH, "plan", "--input", inputPath, "--output", evaluationPath],
      { encoding: "utf8" },
    );
    assert.equal(run.status, 0, run.stderr);
    const evaluation = JSON.parse(readFileSync(evaluationPath, "utf8"));
    assert.equal(evaluation.eligible, true);
    writeFileSync(planPath, JSON.stringify(evaluation.plan));
    run = spawnSync(
      process.execPath,
      [
        SCRIPT_PATH,
        "verify",
        "--input",
        inputPath,
        "--plan",
        planPath,
        "--output",
        verificationPath,
      ],
      { encoding: "utf8" },
    );
    assert.equal(run.status, 0, run.stderr);
    assert.equal(
      JSON.parse(readFileSync(verificationPath, "utf8")).result,
      "verified",
    );
    run = spawnSync(
      process.execPath,
      [SCRIPT_PATH, "plan", "--input", inputPath, "--output", evaluationPath],
      { encoding: "utf8" },
    );
    assert.notEqual(run.status, 0);
  } finally {
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});

test("helper has no network, subprocess, approval, or merge implementation", () => {
  const source = readFileSync(SCRIPT_PATH, "utf8");
  assert.doesNotMatch(source, /node:(?:child_process|http|https|net|tls)/u);
  assert.doesNotMatch(source, /@octokit|\bfetch\s*\(|\bgh\s+(?:api|pr)\b/u);
  assert.doesNotMatch(
    source,
    /pulls\.merge|createReview|enablePullRequestAutoMerge|\/merge\b/u,
  );
});
