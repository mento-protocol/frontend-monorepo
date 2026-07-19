import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  analyzeVercelCostManifest,
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
const manifestUrl = new URL(
  "./fixtures/vercel-cost-analysis/manifest.json",
  import.meta.url,
);
const fixtureDirectory = fileURLToPath(
  new URL("./fixtures/vercel-cost-analysis/", import.meta.url),
);
const scriptPath = fileURLToPath(
  new URL("./vercel-cost-analysis.mjs", import.meta.url),
);

function fixture() {
  return JSON.parse(readFileSync(fixtureUrl, "utf8"));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function manifestForAggregate(aggregatePath) {
  const manifest = JSON.parse(readFileSync(manifestUrl, "utf8"));
  manifest.aggregate = aggregatePath;
  for (const windowName of ["baseline", "postCutover"]) {
    const source = manifest.windows[windowName];
    for (const key of [
      "focusJsonl",
      "providerAttributionEvidence",
      "attributionJsonl",
      "deploymentCensusJsonl",
    ]) {
      source[key] = resolve(fixtureDirectory, source[key]);
    }
  }
  return manifest;
}

function setUsageMetric(evidence, windowName, target, metric, value) {
  const targetEvidence = evidence[windowName].targets[target];
  targetEvidence.migratedPath[metric] = value;
  targetEvidence.grossProject[metric] = value;
  if (value === null) {
    targetEvidence.migratedUsageByPath.preview[metric] = null;
    targetEvidence.migratedUsageByPath.main[metric] = null;
    return;
  }
  const currentPreview = targetEvidence.migratedUsageByPath.preview[metric];
  const currentMain = targetEvidence.migratedUsageByPath.main[metric];
  const currentTotal = currentPreview + currentMain;
  const previewShare = currentTotal === 0 ? 0.5 : currentPreview / currentTotal;
  const preview = value * previewShare;
  targetEvidence.migratedUsageByPath.preview[metric] = preview;
  targetEvidence.migratedUsageByPath.main[metric] = value - preview;
}

function setAllBilledCosts(evidence, value) {
  for (const windowName of ["baseline", "postCutover"]) {
    for (const target of VERCEL_COST_TARGETS) {
      setUsageMetric(evidence, windowName, target, "billedCost", value);
    }
  }
}

function setBuildCpuMinutes(evidence, windowName, target, value) {
  setUsageMetric(evidence, windowName, target, "buildCpuMinutes", value);
}

function setPathUsageZero(evidence, windowName, target, path) {
  for (const metric of ["buildCpuMinutes", "effectiveCost", "billedCost"]) {
    evidence[windowName].targets[target].migratedUsageByPath[path][metric] = 0;
    evidence[windowName].targets[target].migratedPath[metric] =
      evidence[windowName].targets[target].migratedUsageByPath.preview[metric] +
      evidence[windowName].targets[target].migratedUsageByPath.main[metric];
  }
}

function setMigratedCensusMetric(
  evidence,
  windowName,
  target,
  metric,
  preview,
  main,
) {
  evidence[windowName].targets[target].migratedPath[metric] = preview + main;
  evidence[windowName].targets[target].migratedDeploymentCensus.preview[
    metric
  ] = preview;
  evidence[windowName].targets[target].migratedDeploymentCensus.main[metric] =
    main;
}

function movePreviewCensusToMain(evidence, targets = VERCEL_COST_TARGETS) {
  for (const target of targets) {
    for (const metric of [
      "eligibleEvents",
      "deploymentAttempts",
      "duplicateDeployments",
    ]) {
      const census =
        evidence.postCutover.targets[target].migratedDeploymentCensus;
      census.main[metric] += census.preview[metric];
      census.preview[metric] = 0;
    }
    for (const metric of ["buildCpuMinutes", "effectiveCost", "billedCost"]) {
      const usage = evidence.postCutover.targets[target].migratedUsageByPath;
      usage.main[metric] += usage.preview[metric];
      usage.preview[metric] = 0;
    }
  }
}

function postCutoverSourceTotal(evidence, source, metric) {
  return VERCEL_COST_TARGETS.reduce(
    (total, target) =>
      total +
      evidence.postCutover.targets[target].migratedDeploymentCensus[source][
        metric
      ],
    0,
  );
}

test("computes the issue #523 target-by-path formula at the exact pass boundary", () => {
  const analysis = analyzeVercelCostEvidence(fixture());

  assert.equal(analysis.normalized.minutes.counterfactual, 270);
  assert.equal(analysis.normalized.minutes.actual, 27);
  assert.equal(analysis.normalized.minutes.savings, MINIMUM_NORMALIZED_SAVINGS);
  assert.equal(analysis.normalized.minutes.targets.app.counterfactual, 100);
  assert.equal(
    analysis.normalized.minutes.targets.app.paths.preview.counterfactual,
    75,
  );
  assert.equal(
    analysis.normalized.minutes.targets.app.paths.main.counterfactual,
    25,
  );
  assert.equal(
    analysis.normalized.minutes.targets.governance.counterfactual,
    100,
  );
  assert.equal(analysis.normalized.minutes.targets.reserve.counterfactual, 40);
  assert.equal(analysis.normalized.minutes.targets.ui.counterfactual, 30);
  assert.deepEqual(analysis.migrated.targets.app, {
    baselineMinutes: 200,
    postCutoverMinutes: 10,
  });
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
  assert.deepEqual(analysis.gross.targets.app, {
    baselineMinutes: 240,
    postCutoverMinutes: 30,
  });
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

test("keeps private financial and FOCUS provenance out of public output", () => {
  const analysis = analyzeVercelCostEvidence(fixture());
  const markdown = formatVercelCostMarkdown(analysis);
  const serializedAnalysis = JSON.stringify(analysis);

  assert.deepEqual(Object.keys(analysis.normalized.effectiveCost), [
    "savings",
    "targets",
  ]);
  assert.deepEqual(Object.keys(analysis.normalized.billedCost), [
    "savings",
    "targets",
  ]);
  assert.equal(serializedAnalysis.includes('"effectiveCost":40'), false);
  assert.equal(serializedAnalysis.includes('"evidenceSha256"'), false);
  for (const period of Object.values(analysis.periods)) {
    assert.equal(Object.hasOwn(period, "focusExportSha256"), false);
    assert.equal(Object.hasOwn(period, "focusChargeCount"), false);
  }
  assert.equal(serializedAnalysis.includes('"focusExportSha256"'), false);
  assert.equal(serializedAnalysis.includes('"focusChargeCount"'), false);
  assert.match(
    markdown,
    /Absolute EffectiveCost and BilledCost values are intentionally omitted/,
  );
  assert.match(
    markdown,
    /Target-by-path normalized build-minute savings: 90\.00%/,
  );
  assert.match(markdown, /Smoke\/E2E checks completed: 10\/10/);
  assert.match(markdown, /Burst first-plus-latest checks completed: 2\/2/);
  assert.match(markdown, /Legacy v2 health checks completed: 7\/7/);
  assert.match(markdown, /Main deployment observations completed: 4\/4/);
  assert.match(markdown, /Trusted deployed-code same-repository PR pushes: 10/);
  assert.match(
    markdown,
    /\| app \| 200\.00 \| 240\.00 \| 10\.00 \| 30\.00 \| 100\.00 \| 90\.00% \|/,
  );
  assert.doesNotMatch(markdown, /\| Target \|[^\n]*\| Pass \|/);
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
  assert.equal(analysis.correctness.smokeOrE2eChecksCompleted, 10);
  assert.equal(analysis.correctness.burstFirstPlusLatestChecksCompleted, 2);
  assert.equal(analysis.correctness.legacyV2HealthChecksCompleted, 7);
  assert.deepEqual(analysis.eventCensus.app.postCutover, {
    eligibleEvents: 4,
    deploymentAttempts: 4,
    duplicateDeployments: 0,
    excluded: {
      legacyV2DeploymentAttempts: 1,
      manualDeploymentAttempts: 0,
      unknownDeploymentAttempts: 0,
    },
    attributionMethod: "provider-attributed",
    migratedDeploymentCensus: {
      preview: {
        eligibleEvents: 3,
        deploymentAttempts: 3,
        duplicateDeployments: 0,
      },
      main: {
        eligibleEvents: 1,
        deploymentAttempts: 1,
        duplicateDeployments: 0,
      },
    },
  });
  assert.deepEqual(analysis.mainDeploymentObservations, {
    completed: 4,
    eligibleEvents: 4,
    failures: 0,
  });
  assert.equal(
    analysis.eventCensus.governance.postCutover.attributionMethod,
    "provider-attributed",
  );
});

test("requires the migrated preview/main census to reconcile exactly", () => {
  for (const metric of [
    "eligibleEvents",
    "deploymentAttempts",
    "duplicateDeployments",
  ]) {
    const evidence = fixture();
    evidence.postCutover.targets.app.migratedDeploymentCensus.preview[metric] +=
      1;
    assert.throws(
      () => validateVercelCostEvidence(evidence),
      new RegExp(
        `migratedDeploymentCensus ${metric} must sum exactly to migratedPath\\.${metric}`,
      ),
      metric,
    );
  }

  const sourceAttemptsBelowEvents = fixture();
  sourceAttemptsBelowEvents.postCutover.targets.app.migratedDeploymentCensus.preview.eligibleEvents = 4;
  sourceAttemptsBelowEvents.postCutover.targets.app.migratedDeploymentCensus.main.eligibleEvents = 0;
  assert.throws(
    () => validateVercelCostEvidence(sourceAttemptsBelowEvents),
    /preview\.deploymentAttempts cannot be lower than eligibleEvents/,
  );

  const sourceDuplicatesAboveAttempts = fixture();
  setMigratedCensusMetric(
    sourceDuplicatesAboveAttempts,
    "postCutover",
    "app",
    "deploymentAttempts",
    3,
    2,
  );
  setMigratedCensusMetric(
    sourceDuplicatesAboveAttempts,
    "postCutover",
    "app",
    "duplicateDeployments",
    1,
    0,
  );
  assert.throws(
    () => validateVercelCostEvidence(sourceDuplicatesAboveAttempts),
    /preview\.duplicateDeployments cannot exceed deploymentAttempts/,
  );

  const aggregateDuplicatesWithoutExtraAttempts = fixture();
  aggregateDuplicatesWithoutExtraAttempts.baseline.targets.app.migratedPath.duplicateDeployments = 1;
  aggregateDuplicatesWithoutExtraAttempts.baseline.targets.app.migratedDeploymentCensus.preview.duplicateDeployments = 1;
  assert.throws(
    () => validateVercelCostEvidence(aggregateDuplicatesWithoutExtraAttempts),
    /migratedPath\.duplicateDeployments cannot exceed deploymentAttempts minus eligibleEvents/,
  );

  const sourceDuplicatesWithoutExtraAttempts = fixture();
  setMigratedCensusMetric(
    sourceDuplicatesWithoutExtraAttempts,
    "baseline",
    "app",
    "deploymentAttempts",
    6,
    3,
  );
  setMigratedCensusMetric(
    sourceDuplicatesWithoutExtraAttempts,
    "baseline",
    "app",
    "duplicateDeployments",
    1,
    0,
  );
  assert.throws(
    () => validateVercelCostEvidence(sourceDuplicatesWithoutExtraAttempts),
    /preview\.duplicateDeployments cannot exceed deploymentAttempts minus eligibleEvents/,
  );
});

test("binds complete main observations to derived main eligible events", () => {
  const incomplete = fixture();
  incomplete.postCutover.correctness.mainDeploymentObservationsCompleted = 3;
  const incompleteAnalysis = analyzeVercelCostEvidence(incomplete);
  assert.equal(incompleteAnalysis.pass, false);
  assert.ok(
    incompleteAnalysis.reasons.includes(
      "main-deployment-observation-coverage-incomplete",
    ),
  );

  const failed = fixture();
  failed.postCutover.correctness.mainDeploymentObservationFailures = 1;
  const failedAnalysis = analyzeVercelCostEvidence(failed);
  assert.equal(failedAnalysis.pass, false);
  assert.ok(
    failedAnalysis.reasons.includes("main-deployment-observation-failures"),
  );

  const tooManyCompleted = fixture();
  tooManyCompleted.postCutover.correctness.mainDeploymentObservationsCompleted = 5;
  assert.throws(
    () => validateVercelCostEvidence(tooManyCompleted),
    /mainDeploymentObservationsCompleted cannot exceed derived main eligible events/,
  );

  const tooManyFailures = fixture();
  tooManyFailures.postCutover.correctness.mainDeploymentObservationFailures = 5;
  assert.throws(
    () => validateVercelCostEvidence(tooManyFailures),
    /mainDeploymentObservationFailures cannot exceed mainDeploymentObservationsCompleted/,
  );
});

test("reports a truthful zero-event main denominator without bypassing path-mix savings", () => {
  const evidence = fixture();
  for (const target of VERCEL_COST_TARGETS) {
    for (const metric of ["buildCpuMinutes", "effectiveCost", "billedCost"]) {
      const usage = evidence.postCutover.targets[target].migratedUsageByPath;
      usage.preview[metric] += usage.main[metric];
      usage.main[metric] = 0;
    }
    const migrated = evidence.postCutover.targets[target].migratedPath;
    setMigratedCensusMetric(
      evidence,
      "postCutover",
      target,
      "eligibleEvents",
      migrated.eligibleEvents,
      0,
    );
    setMigratedCensusMetric(
      evidence,
      "postCutover",
      target,
      "deploymentAttempts",
      migrated.deploymentAttempts,
      0,
    );
    setMigratedCensusMetric(
      evidence,
      "postCutover",
      target,
      "duplicateDeployments",
      migrated.duplicateDeployments,
      0,
    );
  }
  evidence.postCutover.correctness.mainDeploymentObservationsCompleted = 0;

  const analysis = analyzeVercelCostEvidence(evidence);
  const markdown = formatVercelCostMarkdown(analysis);
  assert.equal(analysis.pass, false);
  assert.ok(
    analysis.reasons.includes(
      "normalized-build-minute-savings-below-90-percent",
    ),
  );
  assert.deepEqual(analysis.mainDeploymentObservations, {
    completed: 0,
    eligibleEvents: 0,
    failures: 0,
  });
  assert.match(markdown, /Main deployment observations completed: 0\/0/);
});

test("fails below 90 percent without rounding the gate", () => {
  const evidence = fixture();
  setBuildCpuMinutes(evidence, "postCutover", "ui", 3.01);
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
  setMigratedCensusMetric(
    evidence,
    "postCutover",
    "ui",
    "eligibleEvents",
    0,
    0,
  );
  setMigratedCensusMetric(
    evidence,
    "postCutover",
    "ui",
    "deploymentAttempts",
    0,
    0,
  );
  for (const path of ["preview", "main"]) {
    setPathUsageZero(evidence, "postCutover", "ui", path);
  }
  for (const metric of ["buildCpuMinutes", "effectiveCost", "billedCost"]) {
    evidence.postCutover.targets.ui.grossProject[metric] = 0;
  }
  evidence.postCutover.correctness.mainDeploymentObservationsCompleted = 3;
  evidence.postCutover.correctness.eligibleFirstPreviews = 8;
  evidence.postCutover.correctness.eligibleFirstPreviewOpportunities = 8;
  const analysis = analyzeVercelCostEvidence(evidence);

  assert.equal(analysis.pass, false);
  assert.ok(analysis.reasons.includes("missing-post-events:ui"));
  assert.ok(analysis.reasons.includes("minute-counterfactual-not-positive:ui"));
  assert.equal(analysis.normalized.minutes.targets.ui.counterfactual, 0);
  assert.deepEqual(analysis.migrated.targets.ui, {
    baselineMinutes: 60,
    postCutoverMinutes: 0,
  });
  assert.match(
    formatVercelCostMarkdown(analysis),
    /\| ui \| 60\.00 \| 60\.00 \| 0\.00 \| 0\.00 \| 0\.00 \| n\/a \|/,
  );
});

test("requires a positive minute counterfactual for every target", () => {
  const evidence = fixture();
  setBuildCpuMinutes(evidence, "baseline", "app", 0);
  setMigratedCensusMetric(evidence, "baseline", "app", "eligibleEvents", 1, 0);
  setMigratedCensusMetric(
    evidence,
    "postCutover",
    "app",
    "eligibleEvents",
    1,
    0,
  );
  for (const windowName of ["baseline", "postCutover"]) {
    const usage = evidence[windowName].targets.app.migratedUsageByPath;
    for (const metric of ["buildCpuMinutes", "effectiveCost", "billedCost"]) {
      usage.preview[metric] += usage.main[metric];
      usage.main[metric] = 0;
    }
  }
  evidence.postCutover.correctness.mainDeploymentObservationsCompleted = 3;
  evidence.postCutover.correctness.eligibleFirstPreviews = 8;
  evidence.postCutover.correctness.eligibleFirstPreviewOpportunities = 8;
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
  setMigratedCensusMetric(
    evidence,
    "postCutover",
    "app",
    "deploymentAttempts",
    4,
    1,
  );
  const analysis = analyzeVercelCostEvidence(evidence);

  assert.equal(analysis.pass, true);
  assert.equal(analysis.attemptsPerEligibleEvent.targets.app, 1.25);
});

test("rejects fewer attempts than events in both evidence windows", () => {
  const baseline = fixture();
  setMigratedCensusMetric(
    baseline,
    "baseline",
    "app",
    "deploymentAttempts",
    5,
    2,
  );
  assert.throws(
    () => validateVercelCostEvidence(baseline),
    /baseline\.targets\.app\.migratedPath\.deploymentAttempts cannot be lower than eligibleEvents/,
  );

  const postCutover = fixture();
  setMigratedCensusMetric(
    postCutover,
    "postCutover",
    "app",
    "deploymentAttempts",
    2,
    1,
  );
  assert.throws(
    () => validateVercelCostEvidence(postCutover),
    /postCutover\.targets\.app\.migratedPath\.deploymentAttempts cannot be lower than eligibleEvents/,
  );
});

test("blocks actual duplicate deployments", () => {
  const duplicate = fixture();
  setMigratedCensusMetric(
    duplicate,
    "postCutover",
    "app",
    "deploymentAttempts",
    4,
    1,
  );
  setMigratedCensusMetric(
    duplicate,
    "postCutover",
    "app",
    "duplicateDeployments",
    1,
    0,
  );
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
  setMigratedCensusMetric(
    targetCounterfactualOverflow,
    "baseline",
    "app",
    "eligibleEvents",
    1,
    0,
  );
  for (const windowName of ["baseline", "postCutover"]) {
    const usage =
      targetCounterfactualOverflow[windowName].targets.app.migratedUsageByPath;
    for (const metric of ["buildCpuMinutes", "effectiveCost", "billedCost"]) {
      usage.preview[metric] += usage.main[metric];
      usage.main[metric] = 0;
    }
  }
  setMigratedCensusMetric(
    targetCounterfactualOverflow,
    "postCutover",
    "app",
    "eligibleEvents",
    3,
    0,
  );
  targetCounterfactualOverflow.postCutover.correctness.mainDeploymentObservationsCompleted = 3;
  assert.throws(
    () => analyzeVercelCostEvidence(targetCounterfactualOverflow),
    /normalized\.buildCpuMinutes\.targets\.app\.paths\.preview\.counterfactual must be finite/,
  );

  const aggregateCounterfactualOverflow = fixture();
  for (const target of VERCEL_COST_TARGETS) {
    setBuildCpuMinutes(
      aggregateCounterfactualOverflow,
      "baseline",
      target,
      Number.MAX_VALUE / 8,
    );
    setMigratedCensusMetric(
      aggregateCounterfactualOverflow,
      "baseline",
      target,
      "eligibleEvents",
      1,
      0,
    );
    for (const windowName of ["baseline", "postCutover"]) {
      const usage =
        aggregateCounterfactualOverflow[windowName].targets[target]
          .migratedUsageByPath;
      for (const metric of ["buildCpuMinutes", "effectiveCost", "billedCost"]) {
        usage.preview[metric] += usage.main[metric];
        usage.main[metric] = 0;
      }
    }
    setMigratedCensusMetric(
      aggregateCounterfactualOverflow,
      "postCutover",
      target,
      "eligibleEvents",
      3,
      0,
    );
    setMigratedCensusMetric(
      aggregateCounterfactualOverflow,
      "postCutover",
      target,
      "deploymentAttempts",
      3,
      0,
    );
  }
  aggregateCounterfactualOverflow.postCutover.correctness.mainDeploymentObservationsCompleted = 0;
  assert.throws(
    () => analyzeVercelCostEvidence(aggregateCounterfactualOverflow),
    /normalized\.buildCpuMinutes\.counterfactual must be finite/,
  );

  const aggregateActualOverflow = fixture();
  for (const target of VERCEL_COST_TARGETS) {
    setUsageMetric(
      aggregateActualOverflow,
      "baseline",
      target,
      "effectiveCost",
      Number.MAX_VALUE / 8,
    );
    setUsageMetric(
      aggregateActualOverflow,
      "postCutover",
      target,
      "effectiveCost",
      Number.MAX_VALUE / 2,
    );
  }
  assert.throws(
    () => analyzeVercelCostEvidence(aggregateActualOverflow),
    /normalized\.effectiveCost\.actual must be finite/,
  );

  const savingsRatioOverflow = fixture();
  setBuildCpuMinutes(savingsRatioOverflow, "baseline", "app", Number.MIN_VALUE);
  setMigratedCensusMetric(
    savingsRatioOverflow,
    "baseline",
    "app",
    "eligibleEvents",
    1,
    0,
  );
  for (const windowName of ["baseline", "postCutover"]) {
    const usage =
      savingsRatioOverflow[windowName].targets.app.migratedUsageByPath;
    for (const metric of ["buildCpuMinutes", "effectiveCost", "billedCost"]) {
      usage.preview[metric] += usage.main[metric];
      usage.main[metric] = 0;
    }
  }
  setMigratedCensusMetric(
    savingsRatioOverflow,
    "postCutover",
    "app",
    "eligibleEvents",
    1,
    0,
  );
  savingsRatioOverflow.postCutover.correctness.mainDeploymentObservationsCompleted = 3;
  savingsRatioOverflow.postCutover.correctness.eligibleFirstPreviews = 8;
  savingsRatioOverflow.postCutover.correctness.eligibleFirstPreviewOpportunities = 8;
  assert.throws(
    () => analyzeVercelCostEvidence(savingsRatioOverflow),
    /normalized\.buildCpuMinutes\.targets\.app\.paths\.preview\.savings\.ratio must be finite/,
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
  evidence.postCutover.trustedDeployedCodePrPushes = 9;
  evidence.postCutover.correctness.eligibleFirstPreviews = 9;
  evidence.postCutover.correctness.eligibleFirstPreviewOpportunities = 9;
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

test("requires finite normalized final BilledCost savings", () => {
  const evidence = fixture();
  setAllBilledCosts(evidence, 0);
  const analysis = analyzeVercelCostEvidence(evidence);

  assert.equal(analysis.normalized.billedCost.savings, null);
  assert.equal(analysis.pass, false);
  assert.ok(analysis.reasons.includes("normalized-billed-cost-unavailable"));
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

test("fails closed when required correctness observations are absent", () => {
  const evidence = fixture();
  evidence.postCutover.correctness.eligibleFirstPreviews = 0;
  evidence.postCutover.correctness.eligibleFirstPreviewOpportunities = 0;
  evidence.postCutover.correctness.smokeOrE2eChecksCompleted = 0;
  evidence.postCutover.correctness.smokeOrE2eCheckOpportunities = 0;
  evidence.postCutover.correctness.burstFirstPlusLatestChecksCompleted = 0;
  evidence.postCutover.correctness.burstFirstPlusLatestCheckOpportunities = 0;
  evidence.postCutover.correctness.legacyV2HealthChecksCompleted = 0;
  evidence.postCutover.correctness.legacyV2HealthCheckOpportunities = 0;

  const analysis = analyzeVercelCostEvidence(evidence);

  assert.equal(analysis.pass, false);
  for (const expected of [
    "eligible-first-preview-opportunities-missing",
    "smoke-or-e2e-check-opportunities-missing",
    "smoke-or-e2e-scope-below-trusted-pr-pushes",
    "burst-first-plus-latest-check-opportunities-missing",
    "legacy-v2-health-check-opportunities-missing",
  ]) {
    assert.ok(analysis.reasons.includes(expected), expected);
  }
});

test("fails closed when required correctness observations are incomplete", () => {
  const evidence = fixture();
  evidence.postCutover.correctness.smokeOrE2eChecksCompleted = 9;
  evidence.postCutover.correctness.burstFirstPlusLatestChecksCompleted = 1;
  evidence.postCutover.correctness.legacyV2HealthChecksCompleted = 6;

  const analysis = analyzeVercelCostEvidence(evidence);

  assert.equal(analysis.pass, false);
  for (const expected of [
    "smoke-or-e2e-check-coverage-incomplete",
    "burst-first-plus-latest-check-coverage-incomplete",
    "legacy-v2-health-check-coverage-incomplete",
  ]) {
    assert.ok(analysis.reasons.includes(expected), expected);
  }
});

test("rejects contradictory correctness observation counts", () => {
  const tooManyCompleted = fixture();
  tooManyCompleted.postCutover.correctness.smokeOrE2eChecksCompleted = 11;
  assert.throws(
    () => validateVercelCostEvidence(tooManyCompleted),
    /smokeOrE2eChecksCompleted cannot exceed smokeOrE2eCheckOpportunities/,
  );

  const tooManyFailures = fixture();
  tooManyFailures.postCutover.correctness.burstFirstPlusLatestFailures = 3;
  assert.throws(
    () => validateVercelCostEvidence(tooManyFailures),
    /burstFirstPlusLatestFailures cannot exceed burstFirstPlusLatestChecksCompleted/,
  );

  const impossibleFirstPreviewScope = fixture();
  impossibleFirstPreviewScope.postCutover.correctness.eligibleFirstPreviews = 11;
  impossibleFirstPreviewScope.postCutover.correctness.eligibleFirstPreviewOpportunities = 11;
  assert.throws(
    () => validateVercelCostEvidence(impossibleFirstPreviewScope),
    /eligibleFirstPreviewOpportunities cannot exceed trustedDeployedCodePrPushes/,
  );

  const missingPreviewCensus = fixture();
  movePreviewCensusToMain(missingPreviewCensus);
  missingPreviewCensus.postCutover.correctness.mainDeploymentObservationsCompleted =
    postCutoverSourceTotal(missingPreviewCensus, "main", "eligibleEvents");
  assert.throws(
    () => validateVercelCostEvidence(missingPreviewCensus),
    /eligibleFirstPreviews cannot exceed derived preview eligible events/,
  );
});

test("does not equate trusted PR pushes with preview target events", () => {
  const evidence = fixture();
  movePreviewCensusToMain(evidence, ["governance", "reserve", "ui"]);
  const previewEligibleEvents = postCutoverSourceTotal(
    evidence,
    "preview",
    "eligibleEvents",
  );
  evidence.postCutover.correctness.eligibleFirstPreviews =
    previewEligibleEvents;
  evidence.postCutover.correctness.eligibleFirstPreviewOpportunities =
    previewEligibleEvents;
  evidence.postCutover.correctness.mainDeploymentObservationsCompleted =
    postCutoverSourceTotal(evidence, "main", "eligibleEvents");

  assert.equal(previewEligibleEvents, 3);
  assert.equal(evidence.postCutover.trustedDeployedCodePrPushes, 10);
  assert.equal(analyzeVercelCostEvidence(evidence).pass, true);
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
  const cleanTarget = mismatchedCleanTotal.baseline.targets.governance;
  for (const metric of [
    "eligibleEvents",
    "deploymentAttempts",
    "duplicateDeployments",
  ]) {
    cleanTarget.migratedDeploymentCensus.preview[metric] +=
      cleanTarget.migratedDeploymentCensus.main[metric];
    cleanTarget.migratedDeploymentCensus.main[metric] = 0;
  }
  for (const metric of ["buildCpuMinutes", "effectiveCost", "billedCost"]) {
    cleanTarget.migratedUsageByPath.preview[metric] +=
      cleanTarget.migratedUsageByPath.main[metric];
    cleanTarget.migratedUsageByPath.main[metric] = 0;
  }
  cleanTarget.attribution = {
    method: "project-total-no-exclusions",
    evidenceSha256: null,
  };
  mismatchedCleanTotal.baseline.targets.governance.migratedPath.buildCpuMinutes = 199;
  cleanTarget.migratedUsageByPath.preview.buildCpuMinutes = 199;
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

  for (const metric of ["buildCpuMinutes", "effectiveCost", "billedCost"]) {
    const unexplainedProviderSplit = fixture();
    const target = unexplainedProviderSplit.baseline.targets.governance;
    target.attribution = {
      method: "provider-attributed",
      evidenceSha256:
        "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    };
    target.migratedPath[metric] = target.grossProject[metric] - 1;
    target.migratedUsageByPath.preview[metric] -= 1;

    assert.throws(
      () => validateVercelCostEvidence(unexplainedProviderSplit),
      new RegExp(
        `migratedPath\\.${metric} must equal grossProject\\.${metric} when provider attribution has no excluded deployments`,
      ),
      metric,
    );
  }
});

test("rejects reused raw and provider-attribution evidence digests", () => {
  const reusedFocusExport = fixture();
  reusedFocusExport.postCutover.period.focusExportSha256 =
    reusedFocusExport.baseline.period.focusExportSha256;
  assert.throws(
    () => validateVercelCostEvidence(reusedFocusExport),
    /raw FOCUS export digests must differ/,
  );

  const rawFocusUsedAsAttribution = fixture();
  rawFocusUsedAsAttribution.baseline.targets.app.attribution.evidenceSha256 =
    rawFocusUsedAsAttribution.baseline.period.focusExportSha256;
  assert.throws(
    () => validateVercelCostEvidence(rawFocusUsedAsAttribution),
    /evidenceSha256 must differ from the raw FOCUS export digest/,
  );

  const baselineAttributionUsesPostFocus = fixture();
  baselineAttributionUsesPostFocus.baseline.targets.app.attribution.evidenceSha256 =
    baselineAttributionUsesPostFocus.postCutover.period.focusExportSha256;
  assert.throws(
    () => validateVercelCostEvidence(baselineAttributionUsesPostFocus),
    /baseline\.targets\.app\.attribution\.evidenceSha256 must differ from every raw FOCUS export digest/,
  );

  const postAttributionUsesBaselineFocus = fixture();
  postAttributionUsesBaselineFocus.postCutover.targets.app.attribution.evidenceSha256 =
    postAttributionUsesBaselineFocus.baseline.period.focusExportSha256;
  assert.throws(
    () => validateVercelCostEvidence(postAttributionUsesBaselineFocus),
    /postCutover\.targets\.app\.attribution\.evidenceSha256 must differ from every raw FOCUS export digest/,
  );

  const reusedProviderEvidence = fixture();
  reusedProviderEvidence.postCutover.targets.app.attribution.evidenceSha256 =
    reusedProviderEvidence.baseline.targets.app.attribution.evidenceSha256;
  assert.throws(
    () => validateVercelCostEvidence(reusedProviderEvidence),
    /provider attribution evidence must differ for app/,
  );
});

test("loads and reconciles raw FOCUS, provider attribution, and deployment census sources", () => {
  const analysis = analyzeVercelCostManifest(fileURLToPath(manifestUrl));

  assert.equal(analysis.pass, true);
  assert.equal(analysis.sourceEvidence.rawFocusReconciled, true);
  assert.equal(analysis.sourceEvidence.providerArtifactBound, true);
  assert.equal(analysis.sourceEvidence.derivedAttributionReconciled, true);
  assert.equal(analysis.sourceEvidence.deploymentCensusComplete, true);
  assert.deepEqual(
    analysis.sourceEvidence.deployments.postCutover.targets.app.sources,
    {
      "github-actions-prebuilt": 4,
      "vercel-native": 1,
      manual: 0,
      unknown: 0,
    },
  );
});

test("filters non-Usage FOCUS rows before reconciling usage totals", () => {
  const temporaryDirectory = mkdtempSync(
    join(tmpdir(), "vercel-focus-filter-"),
  );
  try {
    const original = readFileSync(
      resolve(fixtureDirectory, "baseline.focus.jsonl"),
      "utf8",
    );
    const creditRow = {
      ChargeCategory: "Credit",
      ChargePeriodStart: "2026-07-01T00:00:00Z",
      ChargePeriodEnd: "2026-07-15T00:00:00Z",
      ConsumedQuantity: "-240",
      ConsumedUnit: "Build CPU Minutes",
      EffectiveCost: "-48",
      BilledCost: "-48",
      BillingCurrency: "USD",
      Tags: { ProjectName: "app.mento.org" },
    };
    const raw = `${original}${JSON.stringify(creditRow)}\n`;
    const focusPath = join(temporaryDirectory, "baseline.focus.jsonl");
    writeFileSync(focusPath, raw);
    const evidence = fixture();
    evidence.baseline.period.focusExportSha256 = sha256(raw);
    const aggregatePath = join(temporaryDirectory, "aggregate.json");
    writeFileSync(aggregatePath, `${JSON.stringify(evidence, null, 2)}\n`);
    const manifest = manifestForAggregate(aggregatePath);
    manifest.windows.baseline.focusJsonl = focusPath;
    const manifestPath = join(temporaryDirectory, "manifest.json");
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    const analysis = analyzeVercelCostManifest(manifestPath);
    assert.equal(analysis.pass, true);
    assert.equal(analysis.sourceEvidence.rawFocusReconciled, true);
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("fails closed when raw FOCUS rows do not reconcile to project totals", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "vercel-focus-"));
  try {
    const raw = readFileSync(
      resolve(fixtureDirectory, "baseline.focus.jsonl"),
      "utf8",
    ).replace('"ConsumedQuantity":"240"', '"ConsumedQuantity":"241"');
    const focusPath = join(temporaryDirectory, "baseline.focus.jsonl");
    writeFileSync(focusPath, raw);
    const evidence = fixture();
    evidence.baseline.period.focusExportSha256 = sha256(raw);
    const aggregatePath = join(temporaryDirectory, "aggregate.json");
    writeFileSync(aggregatePath, `${JSON.stringify(evidence, null, 2)}\n`);
    const manifest = manifestForAggregate(aggregatePath);
    manifest.windows.baseline.focusJsonl = focusPath;
    const manifestPath = join(temporaryDirectory, "manifest.json");
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    assert.throws(
      () => analyzeVercelCostManifest(manifestPath),
      /baseline FOCUS JSONL\.app\.buildCpuMinutes does not reconcile/,
    );
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("requires complete, untampered deployment census evidence with unique IDs", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "vercel-census-"));
  try {
    const incomplete = manifestForAggregate(fileURLToPath(fixtureUrl));
    incomplete.windows.postCutover.deploymentCensusComplete = false;
    const incompletePath = join(temporaryDirectory, "incomplete.json");
    writeFileSync(incompletePath, `${JSON.stringify(incomplete, null, 2)}\n`);
    assert.throws(
      () => analyzeVercelCostManifest(incompletePath),
      /deploymentCensusComplete must be true/,
    );

    const original = readFileSync(
      resolve(fixtureDirectory, "post.deployments.jsonl"),
      "utf8",
    );
    const duplicate = `${original}${original.split("\n")[0]}\n`;
    const duplicatePath = join(temporaryDirectory, "duplicate.jsonl");
    writeFileSync(duplicatePath, duplicate);
    const duplicateManifest = manifestForAggregate(fileURLToPath(fixtureUrl));
    duplicateManifest.windows.postCutover.deploymentCensusJsonl = duplicatePath;
    duplicateManifest.windows.postCutover.deploymentCensusSha256 =
      sha256(duplicate);
    const duplicateManifestPath = join(
      temporaryDirectory,
      "duplicate-manifest.json",
    );
    writeFileSync(
      duplicateManifestPath,
      `${JSON.stringify(duplicateManifest, null, 2)}\n`,
    );
    assert.throws(
      () => analyzeVercelCostManifest(duplicateManifestPath),
      /duplicate deploymentId dpl_PAppP1/,
    );
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("rejects private or credential-bearing deployment evidence URLs", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "vercel-census-url-"));
  try {
    const originalRows = readFileSync(
      resolve(fixtureDirectory, "post.deployments.jsonl"),
      "utf8",
    )
      .trimEnd()
      .split("\n")
      .map((row) => JSON.parse(row));
    const unsafeUrls = [
      "https://vercel.com/mentolabs/app.mento.org/dpl_Private",
      "https://user:secret@example-preview.vercel.app/",
      "https://example-preview.vercel.app/?token=secret",
      "https://example-preview.vercel.app/#private",
    ];

    for (const [index, evidenceUrl] of unsafeUrls.entries()) {
      const rows = structuredClone(originalRows);
      rows[0].evidenceUrl = evidenceUrl;
      const census = `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
      const censusPath = join(temporaryDirectory, `post-${index}.jsonl`);
      writeFileSync(censusPath, census);
      const manifest = manifestForAggregate(fileURLToPath(fixtureUrl));
      manifest.windows.postCutover.deploymentCensusJsonl = censusPath;
      manifest.windows.postCutover.deploymentCensusSha256 = sha256(census);
      const manifestPath = join(temporaryDirectory, `manifest-${index}.json`);
      writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

      assert.throws(
        () => analyzeVercelCostManifest(manifestPath),
        /evidenceUrl must be a public GitHub run\/deployment or root \*\.vercel\.app URL without credentials, query, or fragment/,
      );
    }
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("renders direct links for failed deployment attempts without calling them duplicates", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "vercel-anomaly-"));
  try {
    const original = readFileSync(
      resolve(fixtureDirectory, "post.deployments.jsonl"),
      "utf8",
    );
    const failedRow = {
      deploymentId: "dpl_PAppP4",
      target: "app",
      path: "preview",
      source: "github-actions-prebuilt",
      outcome: "error",
      sourceSha: "1000000000000000000000000000000000000001",
      createdAtUtc: "2026-07-17T01:30:00.000Z",
      evidenceUrl: "https://example-preview.vercel.app/",
    };
    const census = `${original}${JSON.stringify(failedRow)}\n`;
    const censusPath = join(temporaryDirectory, "post.deployments.jsonl");
    writeFileSync(censusPath, census);
    const evidence = fixture();
    evidence.postCutover.targets.app.migratedPath.deploymentAttempts = 5;
    evidence.postCutover.targets.app.migratedDeploymentCensus.preview.deploymentAttempts = 4;
    const aggregatePath = join(temporaryDirectory, "aggregate.json");
    writeFileSync(aggregatePath, `${JSON.stringify(evidence, null, 2)}\n`);
    const manifest = manifestForAggregate(aggregatePath);
    manifest.windows.postCutover.deploymentCensusJsonl = censusPath;
    manifest.windows.postCutover.deploymentCensusSha256 = sha256(census);
    const manifestPath = join(temporaryDirectory, "manifest.json");
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    const analysis = analyzeVercelCostManifest(manifestPath);
    const anomaly =
      analysis.sourceEvidence.deployments.postCutover.anomalies[0];
    assert.deepEqual(anomaly.reasons, ["outcome:error"]);
    assert.equal(analysis.eventCensus.app.postCutover.duplicateDeployments, 0);
    assert.match(
      formatVercelCostMarkdown(analysis),
      /\[dpl_PAppP4\]\(https:\/\/example-preview\.vercel\.app\/\)/,
    );
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("keeps the provider artifact distinct from the derived attribution mapping", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "vercel-provider-"));
  try {
    const manifest = manifestForAggregate(fileURLToPath(fixtureUrl));
    manifest.windows.baseline.attributionJsonlSha256 =
      manifest.windows.baseline.providerAttributionSha256;
    const manifestPath = join(temporaryDirectory, "manifest.json");
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    assert.throws(
      () => analyzeVercelCostManifest(manifestPath),
      /keep the provider artifact distinct from the derived attribution JSONL/,
    );
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("fails an observed target-path cell that has no baseline events", () => {
  const evidence = fixture();
  const target = evidence.baseline.targets.app;
  target.migratedDeploymentCensus.preview.eligibleEvents +=
    target.migratedDeploymentCensus.main.eligibleEvents;
  target.migratedDeploymentCensus.preview.deploymentAttempts +=
    target.migratedDeploymentCensus.main.deploymentAttempts;
  target.migratedDeploymentCensus.main.eligibleEvents = 0;
  target.migratedDeploymentCensus.main.deploymentAttempts = 0;
  for (const metric of ["buildCpuMinutes", "effectiveCost", "billedCost"]) {
    target.migratedUsageByPath.preview[metric] +=
      target.migratedUsageByPath.main[metric];
    target.migratedUsageByPath.main[metric] = 0;
  }

  const analysis = analyzeVercelCostEvidence(evidence);
  assert.equal(analysis.observationPass, false);
  assert.ok(analysis.reasons.includes("missing-baseline-events:app:main"));
});

test("fails negative EffectiveCost and BilledCost savings for any path", () => {
  const evidence = fixture();
  const target = evidence.postCutover.targets.app;
  target.migratedUsageByPath.preview.effectiveCost = 40;
  target.migratedUsageByPath.preview.billedCost = 40;
  target.migratedPath.effectiveCost = 40.25;
  target.migratedPath.billedCost = 40.25;
  target.grossProject.effectiveCost = 40.25;
  target.grossProject.billedCost = 40.25;

  const analysis = analyzeVercelCostEvidence(evidence);
  assert.equal(analysis.observationPass, false);
  assert.ok(
    analysis.reasons.includes(
      "normalized-effective-cost-regression:app:preview",
    ),
  );
  assert.ok(
    analysis.reasons.includes("normalized-billed-cost-regression:app:preview"),
  );
});

test("labels a successful measurement observation-only until closeout finishes", () => {
  const evidence = fixture();
  evidence.closeout.docsDriftAuditPassed = false;
  const analysis = analyzeVercelCostEvidence(evidence);
  const markdown = formatVercelCostMarkdown(analysis);

  assert.equal(analysis.observationPass, true);
  assert.equal(analysis.closeoutPass, false);
  assert.equal(analysis.pass, false);
  assert.equal(analysis.reportStage, "observation-only");
  assert.match(markdown, /Observation gate: \*\*PASS\*\*/);
  assert.match(markdown, /Report stage: \*\*OBSERVATION ONLY\*\*/);
  assert.match(markdown, /Do not use this report to close #523 or #515/);
});

test("CLI emits public-safe JSON and returns nonzero for a failed gate", () => {
  const passing = spawnSync(
    process.execPath,
    [scriptPath, "--input", fileURLToPath(manifestUrl)],
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
  assert.equal(
    Object.hasOwn(output.periods.baseline, "focusExportSha256"),
    false,
  );
  assert.equal(
    Object.hasOwn(output.periods.baseline, "focusChargeCount"),
    false,
  );
  assert.equal(
    Object.hasOwn(output.periods.postCutover, "focusExportSha256"),
    false,
  );
  assert.equal(
    Object.hasOwn(output.periods.postCutover, "focusChargeCount"),
    false,
  );

  const temporaryDirectory = mkdtempSync(
    join(tmpdir(), "vercel-cost-analysis-"),
  );
  try {
    const validButNonpassing = fixture();
    validButNonpassing.postCutover.period.billingIngestionComplete = false;
    const failingEvidencePath = join(temporaryDirectory, "failing.json");
    writeFileSync(
      failingEvidencePath,
      `${JSON.stringify(validButNonpassing, null, 2)}\n`,
    );
    const failingManifestPath = join(temporaryDirectory, "manifest.json");
    writeFileSync(
      failingManifestPath,
      `${JSON.stringify(manifestForAggregate(failingEvidencePath), null, 2)}\n`,
    );
    const gateFailure = spawnSync(
      process.execPath,
      [scriptPath, "--input", failingManifestPath],
      { encoding: "utf8" },
    );
    assert.equal(gateFailure.status, 1, gateFailure.stderr);
    assert.equal(gateFailure.stderr, "");
    const gateFailureOutput = JSON.parse(gateFailure.stdout);
    assert.equal(gateFailureOutput.pass, false);
    assert.ok(
      gateFailureOutput.reasons.includes(
        "post-cutover-billing-ingestion-incomplete",
      ),
    );
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }

  const failing = spawnSync(
    process.execPath,
    [scriptPath, "--input", fileURLToPath(manifestUrl), "--format", "xml"],
    { encoding: "utf8" },
  );
  assert.equal(failing.status, 1);
  assert.match(failing.stderr, /Usage:/);

  const unknown = spawnSync(
    process.execPath,
    [
      scriptPath,
      "--input",
      fileURLToPath(manifestUrl),
      "--private-costs",
      "yes",
    ],
    { encoding: "utf8" },
  );
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /Usage:/);
});
