import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import process from "node:process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  analyzeVercelCostEvidence,
  formatVercelCostMarkdown,
  MINIMUM_NORMALIZED_SAVINGS,
  validateVercelCostEvidence,
  VERCEL_COST_TARGETS,
} from "./vercel-cost-analysis.mjs";

const fixtureUrl = new URL(
  "./fixtures/vercel-cost-analysis/pass.json",
  import.meta.url,
);
const scriptPath = fileURLToPath(
  new URL("./vercel-cost-analysis.mjs", import.meta.url),
);

function fixture() {
  return JSON.parse(readFileSync(fixtureUrl, "utf8"));
}

function setAllBilledCosts(evidence, value) {
  for (const windowName of ["baseline", "postCutover"]) {
    for (const target of VERCEL_COST_TARGETS) {
      evidence[windowName].targets[target].migratedPath.billedCost = value;
      evidence[windowName].targets[target].grossProject.billedCost = value;
    }
  }
}

function setBuildCpuMinutes(evidence, windowName, target, value) {
  evidence[windowName].targets[target].migratedPath.buildCpuMinutes = value;
  evidence[windowName].targets[target].grossProject.buildCpuMinutes = value;
}

test("computes the issue #523 target-mix formula at the exact pass boundary", () => {
  const analysis = analyzeVercelCostEvidence(fixture());

  assert.equal(analysis.normalized.minutes.counterfactual, 270);
  assert.equal(analysis.normalized.minutes.actual, 27);
  assert.equal(analysis.normalized.minutes.savings, MINIMUM_NORMALIZED_SAVINGS);
  assert.equal(analysis.normalized.minutes.targets.app.counterfactual, 100);
  assert.equal(
    analysis.normalized.minutes.targets.governance.counterfactual,
    100,
  );
  assert.equal(analysis.normalized.minutes.targets.reserve.counterfactual, 40);
  assert.equal(analysis.normalized.minutes.targets.ui.counterfactual, 30);
  assert.equal(analysis.pass, true);
  assert.deepEqual(analysis.reasons, []);
});

test("normalizes gross minutes by complete UTC days", () => {
  const analysis = analyzeVercelCostEvidence(fixture());

  assert.equal(analysis.periods.baseline.days, 14);
  assert.equal(analysis.periods.postCutover.days, 7);
  assert.equal(analysis.gross.baselineMinutes, 580);
  assert.equal(analysis.gross.postCutoverMinutes, 47);
  assert.equal(analysis.gross.baselineMinutesPerDay, 580 / 14);
  assert.equal(analysis.gross.postCutoverMinutesPerDay, 47 / 7);
  assert.equal(analysis.gross.minuteSavings, 1 - 47 / 7 / (580 / 14));
  assert.equal(analysis.gross.effectiveCostSavings, 1 - 7.2 / 7 / (82 / 14));
  assert.equal(analysis.gross.billedCostSavings, 1 - 7.2 / 7 / (82 / 14));
});

test("reports duplicate rate and raw minutes per trusted PR push", () => {
  const analysis = analyzeVercelCostEvidence(fixture());

  assert.equal(analysis.attemptsPerEligibleEvent.total, 1);
  assert.deepEqual(analysis.attemptsPerEligibleEvent.targets, {
    app: 1,
    governance: 1,
    reserve: 1,
    ui: 1,
  });
  assert.equal(analysis.postCutoverMinutesPerTrustedPrPush.total, 2.7);
  assert.deepEqual(analysis.postCutoverMinutesPerTrustedPrPush.targets, {
    app: 1,
    governance: 1,
    reserve: 0.4,
    ui: 0.3,
  });
});

test("keeps absolute financial values out of the analysis result and Markdown", () => {
  const analysis = analyzeVercelCostEvidence(fixture());
  const markdown = formatVercelCostMarkdown(analysis);

  assert.deepEqual(Object.keys(analysis.normalized.effectiveCost), [
    "savings",
    "targets",
  ]);
  assert.deepEqual(Object.keys(analysis.normalized.billedCost), [
    "savings",
    "targets",
  ]);
  assert.equal(JSON.stringify(analysis).includes('"effectiveCost":40'), false);
  assert.equal(JSON.stringify(analysis).includes('"evidenceSha256"'), false);
  assert.match(
    markdown,
    /Absolute EffectiveCost and BilledCost values are intentionally omitted/,
  );
  assert.match(markdown, /Target-mix normalized build-minute savings: 90\.00%/);
  assert.doesNotMatch(markdown, /\$\d/);
});

test("reports public-safe GitHub, correctness, event, and attribution evidence", () => {
  const analysis = analyzeVercelCostEvidence(fixture());

  assert.deepEqual(analysis.github, {
    standardRunnerMinutes: 300,
    largerRunnerMinutes: 0,
    artifactStorageGbHours: 5,
    cacheStorageGbHours: 50,
    repositoryPublicEntireWindow: true,
  });
  assert.equal(analysis.correctness.eligibleFirstPreviews, 10);
  assert.deepEqual(analysis.eventCensus.app.postCutover, {
    eligibleEvents: 10,
    deploymentAttempts: 10,
    duplicateDeployments: 0,
    excluded: {
      legacyV2DeploymentAttempts: 1,
      manualDeploymentAttempts: 0,
      unknownDeploymentAttempts: 0,
    },
    attributionMethod: "provider-attributed",
  });
  assert.equal(
    analysis.eventCensus.governance.postCutover.attributionMethod,
    "project-total-no-exclusions",
  );
});

test("fails below 90 percent without rounding the gate", () => {
  const evidence = fixture();
  evidence.postCutover.targets.ui.migratedPath.buildCpuMinutes = 3.01;
  evidence.postCutover.targets.ui.grossProject.buildCpuMinutes = 3.01;
  const analysis = analyzeVercelCostEvidence(evidence);

  assert.ok(analysis.normalized.minutes.savings < 0.9);
  assert.equal(analysis.pass, false);
  assert.ok(
    analysis.reasons.includes(
      "normalized-build-minute-savings-below-90-percent",
    ),
  );
});

test("requires post-cutover events for every logical target", () => {
  const evidence = fixture();
  evidence.postCutover.targets.ui.migratedPath.eligibleEvents = 0;
  evidence.postCutover.targets.ui.migratedPath.deploymentAttempts = 0;
  const analysis = analyzeVercelCostEvidence(evidence);

  assert.equal(analysis.pass, false);
  assert.ok(analysis.reasons.includes("missing-post-events:ui"));
  assert.ok(analysis.reasons.includes("minute-counterfactual-not-positive:ui"));
  assert.equal(analysis.normalized.minutes.targets.ui, null);
});

test("requires a positive minute counterfactual for every target", () => {
  const evidence = fixture();
  evidence.baseline.targets.app.migratedPath.buildCpuMinutes = 0;
  for (const target of ["governance", "reserve", "ui"]) {
    setBuildCpuMinutes(evidence, "postCutover", target, 0);
  }
  const analysis = analyzeVercelCostEvidence(evidence);

  assert.ok(analysis.normalized.minutes.savings >= MINIMUM_NORMALIZED_SAVINGS);
  assert.equal(analysis.normalized.minutes.targets.app.counterfactual, 0);
  assert.equal(analysis.normalized.minutes.targets.app.savings, null);
  assert.equal(analysis.pass, false);
  assert.ok(
    analysis.reasons.includes("minute-counterfactual-not-positive:app"),
  );
});

test("measures extra attempts without misclassifying them as deployments", () => {
  const evidence = fixture();
  evidence.postCutover.targets.app.migratedPath.deploymentAttempts += 1;
  const analysis = analyzeVercelCostEvidence(evidence);

  assert.equal(analysis.pass, true);
  assert.equal(analysis.attemptsPerEligibleEvent.targets.app, 1.1);
});

test("rejects fewer attempts than events in both evidence windows", () => {
  const baseline = fixture();
  baseline.baseline.targets.app.migratedPath.deploymentAttempts = 19;
  assert.throws(
    () => validateVercelCostEvidence(baseline),
    /baseline\.targets\.app\.migratedPath\.deploymentAttempts cannot be lower than eligibleEvents/,
  );

  const postCutover = fixture();
  postCutover.postCutover.targets.app.migratedPath.deploymentAttempts = 9;
  assert.throws(
    () => validateVercelCostEvidence(postCutover),
    /postCutover\.targets\.app\.migratedPath\.deploymentAttempts cannot be lower than eligibleEvents/,
  );
});

test("blocks actual duplicate deployments", () => {
  const duplicate = fixture();
  duplicate.postCutover.targets.app.migratedPath.duplicateDeployments = 1;
  const duplicateAnalysis = analyzeVercelCostEvidence(duplicate);
  assert.equal(duplicateAnalysis.pass, false);
  assert.ok(duplicateAnalysis.reasons.includes("duplicate-deployments:app"));
});

test("rejects non-finite derived totals, counterfactuals, ratios, and savings", () => {
  const grossTotalOverflow = fixture();
  for (const target of VERCEL_COST_TARGETS) {
    setBuildCpuMinutes(
      grossTotalOverflow,
      "baseline",
      target,
      Number.MAX_VALUE,
    );
  }
  assert.throws(
    () => validateVercelCostEvidence(grossTotalOverflow),
    /baseline\.grossProject\.buildCpuMinutes\.total must be finite/,
  );

  const targetCounterfactualOverflow = fixture();
  setBuildCpuMinutes(
    targetCounterfactualOverflow,
    "baseline",
    "app",
    Number.MAX_VALUE / 2,
  );
  targetCounterfactualOverflow.baseline.targets.app.migratedPath.eligibleEvents = 1;
  targetCounterfactualOverflow.postCutover.targets.app.migratedPath.eligibleEvents = 3;
  assert.throws(
    () => analyzeVercelCostEvidence(targetCounterfactualOverflow),
    /normalized\.buildCpuMinutes\.targets\.app\.counterfactual must be finite/,
  );

  const aggregateCounterfactualOverflow = fixture();
  for (const target of VERCEL_COST_TARGETS) {
    setBuildCpuMinutes(
      aggregateCounterfactualOverflow,
      "baseline",
      target,
      Number.MAX_VALUE / 8,
    );
    aggregateCounterfactualOverflow.baseline.targets[
      target
    ].migratedPath.eligibleEvents = 1;
    aggregateCounterfactualOverflow.postCutover.targets[
      target
    ].migratedPath.eligibleEvents = 3;
  }
  assert.throws(
    () => analyzeVercelCostEvidence(aggregateCounterfactualOverflow),
    /normalized\.buildCpuMinutes\.counterfactual must be finite/,
  );

  const aggregateActualOverflow = fixture();
  for (const target of VERCEL_COST_TARGETS) {
    aggregateActualOverflow.baseline.targets[
      target
    ].migratedPath.effectiveCost = Number.MAX_VALUE / 8;
    aggregateActualOverflow.baseline.targets[
      target
    ].grossProject.effectiveCost = Number.MAX_VALUE / 8;
    aggregateActualOverflow.postCutover.targets[
      target
    ].migratedPath.effectiveCost = Number.MAX_VALUE / 2;
    aggregateActualOverflow.postCutover.targets[
      target
    ].grossProject.effectiveCost = Number.MAX_VALUE / 2;
  }
  assert.throws(
    () => analyzeVercelCostEvidence(aggregateActualOverflow),
    /normalized\.effectiveCost\.actual must be finite/,
  );

  const savingsRatioOverflow = fixture();
  savingsRatioOverflow.baseline.targets.app.migratedPath.buildCpuMinutes =
    Number.MIN_VALUE;
  savingsRatioOverflow.baseline.targets.app.migratedPath.eligibleEvents = 1;
  savingsRatioOverflow.postCutover.targets.app.migratedPath.eligibleEvents = 1;
  assert.throws(
    () => analyzeVercelCostEvidence(savingsRatioOverflow),
    /normalized\.buildCpuMinutes\.targets\.app\.savings\.ratio must be finite/,
  );
});

test("does not allow unknown deployment activity to pass", () => {
  const evidence = fixture();
  evidence.postCutover.targets.app.excluded.unknownDeploymentAttempts = 1;
  const analysis = analyzeVercelCostEvidence(evidence);

  assert.equal(analysis.pass, false);
  assert.ok(analysis.reasons.includes("unknown-deployment-attempts:app"));
});

test("enforces the observation duration, PR sample, and GitHub billing gates", () => {
  const evidence = fixture();
  evidence.postCutover.period.endUtcExclusive = "2026-07-22T00:00:00.000Z";
  evidence.postCutover.trustedSameRepositoryPrPushes = 9;
  evidence.postCutover.github.standardRunnerMinutes = 0;
  evidence.postCutover.github.largerRunnerMinutes = 1;
  evidence.postCutover.github.repositoryPublicEntireWindow = false;
  const analysis = analyzeVercelCostEvidence(evidence);

  assert.equal(analysis.pass, false);
  assert.ok(analysis.reasons.includes("post-cutover-window-under-7-days"));
  assert.ok(analysis.reasons.includes("fewer-than-10-trusted-pr-pushes"));
  assert.ok(analysis.reasons.includes("larger-runner-minutes-nonzero"));
  assert.ok(analysis.reasons.includes("standard-runner-minutes-missing"));
  assert.ok(
    analysis.reasons.includes("repository-not-public-for-complete-window"),
  );
});

test("keeps incomplete billing and invoices visibly non-passing", () => {
  const evidence = fixture();
  evidence.baseline.period.billingIngestionComplete = false;
  evidence.postCutover.period.billingIngestionComplete = false;
  evidence.baseline.period.invoiceFinal = false;
  evidence.postCutover.period.invoiceFinal = false;
  setAllBilledCosts(evidence, null);
  const analysis = analyzeVercelCostEvidence(evidence);

  assert.equal(analysis.normalized.billedCost, null);
  assert.deepEqual(
    analysis.reasons.filter((value) => value.includes("billing-ingestion")),
    [
      "baseline-billing-ingestion-incomplete",
      "post-cutover-billing-ingestion-incomplete",
    ],
  );
  assert.deepEqual(
    analysis.reasons.filter((value) => value.includes("invoice-not-final")),
    ["baseline-invoice-not-final", "post-cutover-invoice-not-final"],
  );
});

test("evaluates every correctness and service-quality closeout gate", () => {
  const evidence = fixture();
  evidence.postCutover.correctness.eligibleFirstPreviews = 9;
  evidence.postCutover.correctness.incorrectAffectedTargetSkips = 1;
  evidence.postCutover.correctness.unexplainedNativeBuilds = 1;
  evidence.postCutover.correctness.smokeOrE2eRegressions = 1;
  evidence.postCutover.correctness.secretExposureIncidents = 1;
  evidence.postCutover.correctness.burstFirstPlusLatestFailures = 1;
  evidence.postCutover.correctness.legacyV2Regressions = 1;
  evidence.postCutover.correctness.rollbackProcedureVerified = false;
  const analysis = analyzeVercelCostEvidence(evidence);

  assert.equal(analysis.pass, false);
  for (const expected of [
    "eligible-first-preview-coverage-below-100-percent",
    "incorrect-affected-target-skips",
    "unexplained-native-builds",
    "smoke-or-e2e-regressions",
    "secret-exposure-incidents",
    "burst-first-plus-latest-failures",
    "legacy-v2-regressions",
    "rollback-procedure-not-verified",
  ]) {
    assert.ok(analysis.reasons.includes(expected), expected);
  }
});

test("rejects a post window that begins before the completed cutover", () => {
  const evidence = fixture();
  evidence.cutoverCompletedAtUtc = "2026-07-16T00:00:00.001Z";
  assert.throws(
    () => validateVercelCostEvidence(evidence),
    /starts before the completed cutover/,
  );
});

test("requires the baseline to end before cutover", () => {
  const evidence = fixture();
  evidence.cutoverCompletedAtUtc = "2026-07-10T00:00:00.000Z";
  assert.throws(
    () => validateVercelCostEvidence(evidence),
    /baseline period extends beyond the completed cutover/,
  );
});

test("rejects non-daily ranges and non-FOCUS provenance", () => {
  const nonDaily = fixture();
  nonDaily.postCutover.period.startUtc = "2026-07-16T01:00:00.000Z";
  assert.throws(
    () => validateVercelCostEvidence(nonDaily),
    /exact UTC midnight boundary/,
  );

  const wrongUnit = fixture();
  wrongUnit.baseline.period.consumedUnit = "hours";
  assert.throws(
    () => validateVercelCostEvidence(wrongUnit),
    /must be Build CPU Minutes/,
  );

  const badDigest = fixture();
  badDigest.baseline.period.focusExportSha256 = "not-a-digest";
  assert.throws(
    () => validateVercelCostEvidence(badDigest),
    /must be lowercase SHA-256/,
  );

  const invalidCalendarDate = fixture();
  invalidCalendarDate.baseline.period.startUtc = "2026-06-31T00:00:00.000Z";
  assert.throws(
    () => validateVercelCostEvidence(invalidCalendarDate),
    /valid ISO 8601 timestamp/,
  );
});

test("rejects inconsistent aggregates instead of silently repairing them", () => {
  const migratedExceedsGross = fixture();
  migratedExceedsGross.baseline.targets.app.migratedPath.buildCpuMinutes = 241;
  assert.throws(
    () => validateVercelCostEvidence(migratedExceedsGross),
    /cannot exceed grossProject/,
  );

  const finalWithoutBilledCost = fixture();
  finalWithoutBilledCost.postCutover.targets.ui.migratedPath.billedCost = null;
  assert.throws(
    () => validateVercelCostEvidence(finalWithoutBilledCost),
    /requires BilledCost after invoice finalization/,
  );

  const typo = fixture();
  typo.postCutover.targets.app.migratedPath.buildMinutes = 10;
  assert.throws(() => validateVercelCostEvidence(typo), /must contain exactly/);

  const contradictoryFocusCount = fixture();
  contradictoryFocusCount.postCutover.period.focusChargeCount = 0;
  assert.throws(
    () => validateVercelCostEvidence(contradictoryFocusCount),
    /focusChargeCount contradicts gross usage/,
  );

  const impossibleDuplicates = fixture();
  impossibleDuplicates.postCutover.targets.app.migratedPath.duplicateDeployments = 11;
  assert.throws(
    () => validateVercelCostEvidence(impossibleDuplicates),
    /duplicateDeployments cannot exceed deploymentAttempts/,
  );
});

test("requires invoice-grade provenance for migrated-path attribution", () => {
  const missingProviderDigest = fixture();
  missingProviderDigest.baseline.targets.app.attribution.evidenceSha256 = null;
  assert.throws(
    () => validateVercelCostEvidence(missingProviderDigest),
    /must be lowercase SHA-256 for provider attribution/,
  );

  const excludedCleanTotal = fixture();
  excludedCleanTotal.baseline.targets.app.attribution = {
    method: "project-total-no-exclusions",
    evidenceSha256: null,
  };
  assert.throws(
    () => validateVercelCostEvidence(excludedCleanTotal),
    /cannot use a clean project total with excluded deployments/,
  );

  const mismatchedCleanTotal = fixture();
  mismatchedCleanTotal.baseline.targets.governance.migratedPath.buildCpuMinutes = 199;
  assert.throws(
    () => validateVercelCostEvidence(mismatchedCleanTotal),
    /must equal grossProject\.buildCpuMinutes for a clean project total/,
  );

  const legacyV2OnWrongProject = fixture();
  legacyV2OnWrongProject.postCutover.targets.ui.excluded.legacyV2DeploymentAttempts = 1;
  assert.throws(
    () => validateVercelCostEvidence(legacyV2OnWrongProject),
    /cannot classify legacy app v2 activity/,
  );
});

test("CLI emits public-safe JSON and returns nonzero for a failed gate", () => {
  const passing = spawnSync(
    process.execPath,
    [scriptPath, "--input", fileURLToPath(fixtureUrl)],
    { encoding: "utf8" },
  );
  assert.equal(passing.status, 0, passing.stderr);
  const output = JSON.parse(passing.stdout);
  assert.equal(output.pass, true);
  assert.equal(Object.hasOwn(output.normalized.effectiveCost, "actual"), false);
  assert.equal(
    Object.hasOwn(output.normalized.billedCost, "counterfactual"),
    false,
  );

  const failing = spawnSync(
    process.execPath,
    [scriptPath, "--input", fileURLToPath(fixtureUrl), "--format", "xml"],
    { encoding: "utf8" },
  );
  assert.equal(failing.status, 1);
  assert.match(failing.stderr, /Usage:/);

  const unknown = spawnSync(
    process.execPath,
    [
      scriptPath,
      "--input",
      fileURLToPath(fixtureUrl),
      "--private-costs",
      "yes",
    ],
    { encoding: "utf8" },
  );
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /Usage:/);
});
