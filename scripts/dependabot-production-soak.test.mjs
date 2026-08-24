import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { canonicalJson } from "./dependabot-actions-companion.mjs";
import {
  DEPENDABOT_ACTIONS_COMPANION_SOAK_SCHEMA,
  DEPENDABOT_PRODUCTION_SOAK_SCHEMA,
  renderDependabotProductionSoak,
  validateDependabotProductionSoakManifest,
} from "./dependabot-production-soak.mjs";

const scriptPath = fileURLToPath(
  new URL("./dependabot-production-soak.mjs", import.meta.url),
);

const manifestPath = fileURLToPath(
  new URL("../docs/dependabot-production-soak.json", import.meta.url),
);
const reportPath = fileURLToPath(
  new URL("../docs/dependabot-production-soak.md", import.meta.url),
);

function manifest() {
  return JSON.parse(readFileSync(manifestPath, "utf8"));
}

function manifestWithPassedTypedCompanion() {
  const value = manifest();
  const sourceHeadSha = "1".repeat(40);
  const sourceBaseSha = "2".repeat(40);
  const companionCommitSha = "3".repeat(40);
  const workflowSha = "5".repeat(40);
  const sourcePullRequestNumber = 901;
  const companionPullRequestNumber = 902;
  const companionBranchRef =
    `dependabot-companion/osv-pr-${sourcePullRequestNumber}-` +
    sourceHeadSha.slice(0, 12);
  const workflowRunId = 40_002;
  const workflowRunAttempt = 2;
  const processorRunId = 40_001;
  const processorRunAttempt = 1;
  const planDigest = "d".repeat(64);
  const receipt = (receiptSha256, schema, result) => ({
    receiptSha256,
    result,
    schema,
  });
  value.cases[5] = {
    companion: {
      branchRef: companionBranchRef,
      commitSha: companionCommitSha,
      pr: {
        authorLogin: "mento-dependabot-prepare[bot]",
        baseRef: "main",
        baseSha: sourceBaseSha,
        headRef: companionBranchRef,
        headSha: companionCommitSha,
        mergedAt: null,
        mergeSha: null,
        number: companionPullRequestNumber,
        state: "open",
        url: `https://github.com/mento-protocol/frontend-monorepo/pull/${companionPullRequestNumber}`,
      },
    },
    id: "typed-actions-companion",
    planDigest,
    pr: {
      authorLogin: "dependabot[bot]",
      baseRef: "main",
      baseSha: sourceBaseSha,
      headRef: "dependabot/github_actions/github-actions-manual-example",
      headSha: sourceHeadSha,
      mergedAt: null,
      mergeSha: null,
      number: sourcePullRequestNumber,
      state: "open",
      url: `https://github.com/mento-protocol/frontend-monorepo/pull/${sourcePullRequestNumber}`,
    },
    processor: {
      checkId: 70_001,
      dependencyGroup: "github-actions-manual",
      dependencyNames: [
        "google/osv-scanner-action/osv-scanner-action",
        "google/osv-scanner-action/osv-reporter-action",
      ],
      disposition: "manual-review",
      headSha: sourceHeadSha,
      workflowRunAttempt: processorRunAttempt,
      workflowRunId: processorRunId,
      workflowSha,
    },
    receipts: {
      census: receipt(
        "a".repeat(64),
        "dependabot-actions-companion-live-census:v1",
        "planned",
      ),
      open: receipt(
        "c".repeat(64),
        "dependabot-actions-companion-live-open:v1",
        "opened",
      ),
      stage: receipt(
        "b".repeat(64),
        "dependabot-actions-companion-live-stage:v1",
        "staged",
      ),
    },
    status: "passed",
    summary:
      "A current production run created an exact typed OSV companion pull request.",
    workflow: {
      runAttempt: workflowRunAttempt,
      runId: workflowRunId,
      workflowSha,
    },
  };
  return value;
}

test("the checked-in production evidence renders the checked-in soak report", () => {
  const value = manifest();
  assert.equal(value.schema, DEPENDABOT_PRODUCTION_SOAK_SCHEMA);
  const validated = validateDependabotProductionSoakManifest(value);
  assert.deepEqual(
    validated.validated.map(({ entry }) => [entry.id, entry.status]),
    [
      ["native-green-npm", "pending"],
      ["stale-npm", "passed"],
      ["repairable-npm", "passed"],
      ["routine-actions", "pending"],
      ["manual-actions", "passed"],
      ["typed-actions-companion", "pending"],
    ],
  );
  const rendered = renderDependabotProductionSoak(value);
  assert.equal(rendered, readFileSync(reportPath, "utf8"));
  assert.match(rendered, /3 of 6 cases observed; 3 pending/);
  assert.match(rendered, /#777[\s\S]*10 refreshes, 1 repair/);
  assert.match(rendered, /#723[\s\S]*1 refresh, 1 repair/);
  assert.match(rendered, /#840[\s\S]*no processor approval/);
  assert.match(
    rendered,
    /Typed Actions companion[\s\S]*exact census, stage, and open receipts/,
  );
  assert.match(rendered, /does not authenticate GitHub evidence/);
  assert.match(rendered, /maintainer must revalidate the exact live GitHub PR/);
  assert.doesNotMatch(rendered, /require-complete/);
});

test("the CLI only renders or checks the observational report", () => {
  const defaultRun = spawnSync(
    process.execPath,
    [scriptPath, "--manifest", manifestPath, "--check", reportPath],
    { encoding: "utf8" },
  );
  assert.equal(defaultRun.status, 0, defaultRun.stderr);

  const removedCompletionRun = spawnSync(
    process.execPath,
    [scriptPath, "--manifest", manifestPath, "--require-complete"],
    { encoding: "utf8" },
  );
  assert.equal(removedCompletionRun.status, 1);
  assert.match(
    removedCompletionRun.stderr,
    /Unsupported argument: --require-complete/,
  );
});

test("typed Actions companion PASS evidence binds the exact production chain", () => {
  const value = manifestWithPassedTypedCompanion();
  const validated = validateDependabotProductionSoakManifest(value);
  assert.equal(validated.validated[5].entry.status, "passed");
  const rendered = renderDependabotProductionSoak(value);
  assert.match(rendered, /4 of 6 cases observed; 2 pending/);
  assert.match(rendered, /source \[#901\][\s\S]*companion \[#902\]/);
  assert.match(rendered, /workflow 40002 attempt 2/);
  assert.match(
    rendered,
    /Exact receipt SHA-256 digests: census `a{64}`, stage `b{64}`, open `c{64}`/,
  );
});

test("typed Actions companion PASS evidence rejects focused binding mismatches", () => {
  const cases = [
    {
      mutate(value) {
        value.cases[5].processor.headSha = "4".repeat(40);
      },
      pattern: /does not bind the exact typed OSV classification/,
    },
    {
      mutate(value) {
        value.cases[5].companion.pr.headSha = "4".repeat(40);
      },
      pattern: /does not bind the exact branch, commit, and base/,
    },
    {
      mutate(value) {
        value.cases[5].workflow.workflowSha = "4".repeat(40);
      },
      pattern: /does not bind the exact typed OSV classification/,
    },
    {
      mutate(value) {
        value.cases[5].planDigest = "not-a-digest";
      },
      pattern: /must be a SHA-256 digest/,
    },
    {
      mutate(value) {
        value.cases[5].receipts.stage.schema = "wrong:v1";
      },
      pattern: /schema or result is invalid/,
    },
    {
      mutate(value) {
        value.cases[5].receipts.open.receiptSha256 =
          value.cases[5].receipts.census.receiptSha256;
      },
      pattern: /must use distinct exact receipt digests/,
    },
    {
      mutate(value) {
        value.cases[5].receipts.census.receiptSha256 = "not-a-digest";
      },
      pattern: /must be a SHA-256 digest/,
    },
  ];

  for (const { mutate, pattern } of cases) {
    const value = manifestWithPassedTypedCompanion();
    mutate(value);
    assert.throws(
      () => validateDependabotProductionSoakManifest(value),
      pattern,
    );
  }
});

test("the importer replaces only the typed case and refuses to overwrite", () => {
  const directory = mkdtempSync(join(tmpdir(), "dependabot-soak-import-"));
  try {
    const original = manifest();
    const passed = manifestWithPassedTypedCompanion();
    const capturedAt = "2026-08-24T12:00:00Z";
    const artifactPath = join(directory, "artifact.json");
    const outputPath = join(directory, "manifest.json");
    const artifact = {
      capturedAt,
      case: passed.cases[5],
      repository: original.repository,
      schema: DEPENDABOT_ACTIONS_COMPANION_SOAK_SCHEMA,
    };
    writeFileSync(artifactPath, `${canonicalJson(artifact)}\n`);

    const imported = spawnSync(
      process.execPath,
      [
        scriptPath,
        "import-typed-companion",
        "--artifact",
        artifactPath,
        "--manifest",
        manifestPath,
        "--output",
        outputPath,
      ],
      { encoding: "utf8" },
    );
    assert.equal(imported.status, 0, imported.stderr);
    const raw = readFileSync(outputPath, "utf8");
    const value = JSON.parse(raw);
    assert.equal(raw, `${canonicalJson(value)}\n`);
    assert.equal(value.capturedAt, capturedAt);
    assert.deepEqual(value.cases.slice(0, 5), original.cases.slice(0, 5));
    assert.deepEqual(value.cases[5], artifact.case);
    validateDependabotProductionSoakManifest(value);

    const repeated = spawnSync(
      process.execPath,
      [
        scriptPath,
        "import-typed-companion",
        "--artifact",
        artifactPath,
        "--manifest",
        manifestPath,
        "--output",
        outputPath,
      ],
      { encoding: "utf8" },
    );
    assert.equal(repeated.status, 1);
    assert.match(repeated.stderr, /exist/u);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("the soak manifest rejects incomplete or contradictory evidence", () => {
  const cases = [
    {
      mutate(value) {
        [value.cases[0], value.cases[1]] = [value.cases[1], value.cases[0]];
      },
      pattern: /six canonical cases in order/,
    },
    {
      mutate(value) {
        value.cases[1].allClear.preparation.refreshCount = 0;
      },
      pattern: /does not prove a completed refresh/,
    },
    {
      mutate(value) {
        value.cases[2].allClear.preparation.repairCount = 0;
      },
      pattern: /does not prove a bounded repair/,
    },
    {
      mutate(value) {
        value.cases[2].allClear.preparation.repairCount = 3;
      },
      pattern: /exceeds the bounded repair budget/,
    },
    {
      mutate(value) {
        value.cases[2].allClear.preparation.operationKinds = ["unknown-repair"];
      },
      pattern: /operationKinds are invalid/,
    },
    {
      mutate(value) {
        value.cases[2].allClear.preparation.seedHeadSha =
          value.cases[2].pr.headSha;
      },
      pattern: /does not prove a bounded repair/,
    },
    {
      mutate(value) {
        value.cases[4].authority.processorApprovalCount = 1;
      },
      pattern: /processorApprovalCount must be zero/,
    },
    {
      mutate(value) {
        value.cases[4].processor.externalId =
          value.cases[4].processor.externalId.replace("pr=840", "pr=841");
      },
      pattern: /PR mismatch/,
    },
    {
      mutate(value) {
        value.cases[4].processor.externalId =
          value.cases[4].processor.externalId.replace("repair=1", "repair=999");
      },
      pattern: /attempt is invalid/,
    },
    {
      mutate(value) {
        value.capturedAt = "2020-01-01T00:00:00Z";
      },
      pattern: /mergedAt is later than the manifest capture/,
    },
    {
      mutate(value) {
        value.cases[1].postMerge.headSha = value.cases[1].pr.headSha;
      },
      pattern: /not terminal exact-merge proof/,
    },
    {
      mutate(value) {
        value.cases[1].postMerge.outcome = "no-target";
      },
      pattern: /does not prove an affected release/,
    },
    {
      mutate(value) {
        value.cases[5].status = "passed";
      },
      pattern: /keys are invalid/,
    },
    {
      mutate(value) {
        const duplicate = structuredClone(value.cases[1]);
        duplicate.id = "repairable-npm";
        value.cases[2] = duplicate;
      },
      pattern: /distinct pull requests/,
    },
    {
      mutate(value) {
        value.cases[2].pr.headSha = value.cases[1].pr.headSha;
        value.cases[2].allClear.headSha = value.cases[1].pr.headSha;
        value.cases[2].allClear.externalId =
          value.cases[2].allClear.externalId.replace(
            /head=[0-9a-f]{40}/,
            `head=${value.cases[1].pr.headSha}`,
          );
      },
      pattern: /distinct pull request heads/,
    },
    {
      mutate(value) {
        value.cases[2].mainCi.checkId = value.cases[1].allClear.checkId;
      },
      pattern: /distinct check IDs/,
    },
    {
      mutate(value) {
        value.cases[2].mainCi.workflowRunId =
          value.cases[1].postMerge.workflowRunId;
      },
      pattern: /distinct workflow run IDs/,
    },
    {
      mutate(value) {
        value.cases[2].allClear.processorApprovalId =
          value.cases[1].allClear.processorApprovalId;
      },
      pattern: /distinct processor approval IDs/,
    },
  ];

  for (const { mutate, pattern } of cases) {
    const value = manifest();
    mutate(value);
    assert.throws(
      () => validateDependabotProductionSoakManifest(value),
      pattern,
    );
  }
});
