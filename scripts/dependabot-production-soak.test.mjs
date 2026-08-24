import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import process from "node:process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  DEPENDABOT_PRODUCTION_SOAK_SCHEMA,
  renderDependabotProductionSoak,
  validateDependabotProductionSoakManifest,
  validatePostMerge,
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
    ],
  );
  const rendered = renderDependabotProductionSoak(value);
  assert.equal(rendered, readFileSync(reportPath, "utf8"));
  assert.match(rendered, /3 of 5 cases observed; 2 pending/);
  assert.match(rendered, /#777[\s\S]*10 refreshes, 1 repair/);
  assert.match(rendered, /#723[\s\S]*1 refresh, 1 repair/);
  assert.match(rendered, /#840[\s\S]*no processor approval/);
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

test("no-target soak proof requires an explicit empty affected-target set", () => {
  const mergeSha = "1".repeat(40);
  const postMerge = {
    affectedTargets: [],
    checkId: 98_000_000_003,
    workflowRunId: 33_000_000_003,
    workflowRunAttempt: 1,
    externalId: "dependabot-post-merge:33000000003:1",
    headSha: mergeSha,
    conclusion: "success",
    outcome: "no-target",
    terminalRestored: true,
  };
  const validate = (evidence) =>
    validatePostMerge(
      evidence,
      { mergeSha },
      "mento-protocol/frontend-monorepo",
      "routine Actions",
    );
  assert.doesNotThrow(() => validate(postMerge));

  const affected = structuredClone(postMerge);
  affected.affectedTargets = ["governance"];
  assert.throws(
    () => validate(affected),
    /no-target must bind zero affected targets/,
  );

  const implicit = structuredClone(postMerge);
  delete implicit.affectedTargets;
  assert.throws(() => validate(implicit), /postMerge keys are invalid/);
});

test("the soak manifest rejects incomplete or contradictory evidence", () => {
  const cases = [
    {
      mutate(value) {
        [value.cases[0], value.cases[1]] = [value.cases[1], value.cases[0]];
      },
      pattern: /five canonical cases in order/,
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
      pattern: /postMerge keys are invalid/,
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
