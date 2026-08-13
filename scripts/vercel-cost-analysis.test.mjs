import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { createSyntheticGitHubActionsEvidence } from "./vercel-cost-github-actions.test-helper.mjs";
import { createSyntheticVercelDeploymentEvidence } from "./vercel-cost-deployment-census.test-helper.mjs";

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

function bindDeploymentCensus(
  manifest,
  windowName,
  directory,
  censusRaw,
  aggregate,
) {
  const bundle = createSyntheticVercelDeploymentEvidence({
    directory,
    name: windowName,
    censusRaw,
    startUtc: aggregate[windowName].period.startUtc,
    endUtcExclusive: aggregate[windowName].period.endUtcExclusive,
  });
  Object.assign(manifest.windows[windowName], {
    deploymentPagesJson: bundle.pagesPath,
    deploymentPagesSha256: bundle.pagesSha256,
    deploymentCensusSha256: bundle.censusSha256,
    deploymentCensusProof: bundle.proofPath,
    deploymentCensusProofSha256: bundle.proofSha256,
  });
  return bundle;
}

function manifestForAggregate(aggregatePath, evidenceDirectory) {
  const manifest = JSON.parse(readFileSync(manifestUrl, "utf8"));
  manifest.aggregate = aggregatePath;
  const aggregate = JSON.parse(readFileSync(aggregatePath, "utf8"));
  for (const windowName of ["baseline", "postCutover"]) {
    const source = manifest.windows[windowName];
    for (const key of ["focusJsonl", "deploymentCensusJsonl"]) {
      source[key] = resolve(fixtureDirectory, source[key]);
    }
    bindDeploymentCensus(
      manifest,
      windowName,
      evidenceDirectory,
      readFileSync(source.deploymentCensusJsonl, "utf8"),
      aggregate,
    );
  }
  const directory = dirname(aggregatePath);
  const github = createSyntheticGitHubActionsEvidence(directory);
  manifest.githubActionsEvidence = {
    proof: github.proofPath,
    proofSha256: github.proofSha256,
  };
  return manifest;
}

function createManifestFixture(
  parent,
  aggregatePath = fileURLToPath(fixtureUrl),
) {
  const github = createSyntheticGitHubActionsEvidence(parent);
  const manifest = manifestForAggregate(aggregatePath, parent);
  manifest.githubActionsEvidence = {
    proof: github.proofPath,
    proofSha256: github.proofSha256,
  };
  const manifestPath = join(parent, "manifest.json");
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { github, manifest, manifestPath };
}

function setUsageMetric(evidence, windowName, target, metric, value) {
  const targetEvidence = evidence[windowName].targets[target];
  targetEvidence.migratedPath[metric] = value;
  targetEvidence.grossProject[metric] = value;
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

function setTargetUsageZero(evidence, windowName, target) {
  for (const metric of ["buildCpuMinutes", "effectiveCost", "billedCost"]) {
    evidence[windowName].targets[target].migratedPath[metric] = 0;
    evidence[windowName].targets[target].grossProject[metric] = 0;
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

test("computes the issue #523 target-mix formula across a changed preview/main mix", () => {
  const evidence = fixture();
  setMigratedCensusMetric(
    evidence,
    "postCutover",
    "app",
    "eligibleEvents",
    1,
    3,
  );
  setMigratedCensusMetric(
    evidence,
    "postCutover",
    "app",
    "deploymentAttempts",
    1,
    3,
  );
  evidence.postCutover.correctness.eligibleFirstPreviews = 8;
  evidence.postCutover.correctness.eligibleFirstPreviewOpportunities = 8;
  evidence.postCutover.correctness.mainDeploymentObservationsCompleted = 6;

  const analysis = analyzeVercelCostEvidence(evidence);

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
  assert.equal(analysis.gross.baselineMinutes, 540);
  assert.equal(analysis.gross.postCutoverMinutes, 27);
  assert.equal(analysis.gross.baselineMinutesPerDay, 540 / 14);
  assert.equal(analysis.gross.postCutoverMinutesPerDay, 27 / 7);
  assert.equal(analysis.gross.minuteSavings, 1 - 27 / 7 / (540 / 14));
  assert.equal(analysis.gross.effectiveCostSavings, 1 - 3.2 / 7 / (74 / 14));
  assert.equal(analysis.gross.billedCostSavings, 1 - 3.2 / 7 / (74 / 14));
  assert.deepEqual(analysis.gross.targets.app, {
    baselineMinutes: 200,
    postCutoverMinutes: 10,
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
  assert.match(markdown, /Target-mix normalized build-minute savings: 90\.00%/);
  assert.match(markdown, /Smoke\/E2E checks completed: 10\/10/);
  assert.match(markdown, /Burst first-plus-latest checks completed: 2\/2/);
  assert.match(markdown, /Legacy v2 health checks completed: 7\/7/);
  assert.match(markdown, /Main deployment observations completed: 4\/4/);
  assert.match(markdown, /Trusted deployed-code same-repository PR pushes: 10/);
  assert.match(
    markdown,
    /\| app \| 200\.00 \| 200\.00 \| 10\.00 \| 10\.00 \| 100\.00 \| 90\.00% \|/,
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
      legacyV2DeploymentAttempts: 0,
      manualDeploymentAttempts: 0,
      unknownDeploymentAttempts: 0,
    },
    attributionMethod: "project-total-no-exclusions",
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
    "project-total-no-exclusions",
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

test("reports a truthful zero-event main denominator without changing target-mix savings", () => {
  const evidence = fixture();
  for (const target of VERCEL_COST_TARGETS) {
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
  assert.equal(analysis.pass, true);
  assert.equal(analysis.normalized.minutes.savings, MINIMUM_NORMALIZED_SAVINGS);
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
  setTargetUsageZero(evidence, "postCutover", "ui");
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
    setMigratedCensusMetric(
      aggregateCounterfactualOverflow,
      "baseline",
      target,
      "eligibleEvents",
      1,
      0,
    );
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
    /normalized\.buildCpuMinutes\.targets\.app\.savings\.ratio must be finite/,
  );
});

test("rejects excluded deployment activity before normalization", () => {
  const evidence = fixture();
  evidence.postCutover.targets.app.excluded.unknownDeploymentAttempts = 1;
  assert.throws(
    () => validateVercelCostEvidence(evidence),
    /cannot use a clean project total with excluded deployments/,
  );
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

test("requires invoice-grade zero-exclusion project-total attribution", () => {
  const legacyProviderMethod = fixture();
  legacyProviderMethod.baseline.targets.app.attribution.method =
    "provider-attributed";
  assert.throws(
    () => validateVercelCostEvidence(legacyProviderMethod),
    /attribution\.method must be project-total-no-exclusions/,
  );

  const legacyEvidenceDigest = fixture();
  legacyEvidenceDigest.baseline.targets.app.attribution.evidenceSha256 =
    "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
  assert.throws(
    () => validateVercelCostEvidence(legacyEvidenceDigest),
    /evidenceSha256 must be null for a clean project total/,
  );

  for (const metric of ["buildCpuMinutes", "effectiveCost", "billedCost"]) {
    const mismatchedProjectTotal = fixture();
    const target = mismatchedProjectTotal.baseline.targets.governance;
    target.migratedPath[metric] = target.grossProject[metric] - 1;

    assert.throws(
      () => validateVercelCostEvidence(mismatchedProjectTotal),
      new RegExp(
        `migratedPath\\.${metric} must equal grossProject\\.${metric} for a clean project total`,
      ),
      metric,
    );
  }

  const mismatchedNullableCost = fixture();
  mismatchedNullableCost.baseline.period.invoiceFinal = false;
  mismatchedNullableCost.baseline.targets.app.migratedPath.billedCost = null;
  assert.throws(
    () => validateVercelCostEvidence(mismatchedNullableCost),
    /migratedPath\.billedCost must equal grossProject\.billedCost for a clean project total/,
  );

  const nearEqualProjectTotal = fixture();
  nearEqualProjectTotal.baseline.targets.app.migratedPath.effectiveCost = 39.999999999999986;
  assert.throws(
    () => validateVercelCostEvidence(nearEqualProjectTotal),
    /migratedPath\.effectiveCost must equal grossProject\.effectiveCost for a clean project total/,
  );

  for (const excludedKey of [
    "legacyV2DeploymentAttempts",
    "manualDeploymentAttempts",
    "unknownDeploymentAttempts",
  ]) {
    const excluded = fixture();
    excluded.baseline.targets.app.excluded[excludedKey] = 1;
    assert.throws(
      () => validateVercelCostEvidence(excluded),
      /cannot use a clean project total with excluded deployments/,
      excludedKey,
    );
  }

  const legacyV2OnWrongProject = fixture();
  legacyV2OnWrongProject.postCutover.targets.ui.excluded.legacyV2DeploymentAttempts = 1;
  assert.throws(
    () => validateVercelCostEvidence(legacyV2OnWrongProject),
    /cannot classify legacy app v2 activity/,
  );
});

test("rejects reused raw FOCUS evidence digests", () => {
  const reusedFocusExport = fixture();
  reusedFocusExport.postCutover.period.focusExportSha256 =
    reusedFocusExport.baseline.period.focusExportSha256;
  assert.throws(
    () => validateVercelCostEvidence(reusedFocusExport),
    /raw FOCUS export digests must differ/,
  );
});

test("loads and reconciles raw FOCUS project totals and deployment census sources", () => {
  const temporaryDirectory = mkdtempSync(
    join(tmpdir(), "vercel-manifest-pass-"),
  );
  try {
    const { manifestPath } = createManifestFixture(temporaryDirectory);
    const analysis = analyzeVercelCostManifest(manifestPath);

    assert.equal(analysis.pass, true);
    assert.equal(analysis.sourceEvidence.rawFocusReconciled, true);
    assert.equal(analysis.sourceEvidence.projectTotalsReconciled, true);
    assert.equal(analysis.sourceEvidence.deploymentCensusComplete, true);
    assert.equal(analysis.sourceEvidence.githubActionsProofReconciled, true);
    assert.deepEqual(
      analysis.sourceEvidence.deployments.postCutover.targets.app.sources,
      {
        "github-actions-prebuilt": 4,
        "vercel-native": 0,
        manual: 0,
        unknown: 0,
      },
    );
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("rebuilds the GitHub Actions proof from a bound owner web audit export", () => {
  const temporaryDirectory = mkdtempSync(
    join(tmpdir(), "vercel-web-audit-manifest-"),
  );
  try {
    const { manifest } = createManifestFixture(temporaryDirectory);
    const github = createSyntheticGitHubActionsEvidence(
      join(temporaryDirectory, "web-audit"),
      { auditSource: "web" },
    );
    manifest.githubActionsEvidence = {
      proof: github.proofPath,
      proofSha256: github.proofSha256,
    };
    const manifestPath = join(temporaryDirectory, "web-audit-manifest.json");
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    const analysis = analyzeVercelCostManifest(manifestPath);
    assert.equal(analysis.pass, true);
    assert.equal(analysis.sourceEvidence.githubActionsProofReconciled, true);
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
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
    const manifest = manifestForAggregate(aggregatePath, temporaryDirectory);
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
    ).replace('"ConsumedQuantity":"200"', '"ConsumedQuantity":"201"');
    const focusPath = join(temporaryDirectory, "baseline.focus.jsonl");
    writeFileSync(focusPath, raw);
    const evidence = fixture();
    evidence.baseline.period.focusExportSha256 = sha256(raw);
    const aggregatePath = join(temporaryDirectory, "aggregate.json");
    writeFileSync(aggregatePath, `${JSON.stringify(evidence, null, 2)}\n`);
    const manifest = manifestForAggregate(aggregatePath, temporaryDirectory);
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

test("rejects a forged normalized census and caller completeness assertion", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "vercel-census-"));
  try {
    const manifest = manifestForAggregate(
      fileURLToPath(fixtureUrl),
      temporaryDirectory,
    );
    const original = readFileSync(
      resolve(fixtureDirectory, "post.deployments.jsonl"),
      "utf8",
    );
    const forged = `${original}${original.split("\n")[0]}\n`;
    const forgedPath = join(temporaryDirectory, "forged.jsonl");
    writeFileSync(forgedPath, forged);
    manifest.windows.postCutover.deploymentCensusJsonl = forgedPath;
    manifest.windows.postCutover.deploymentCensusSha256 = sha256(forged);
    manifest.windows.postCutover.deploymentCensusComplete = true;
    const manifestPath = join(temporaryDirectory, "manifest.json");
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    assert.throws(
      () => analyzeVercelCostManifest(manifestPath),
      /manifest\.windows\.postCutover must contain exactly/,
    );

    delete manifest.windows.postCutover.deploymentCensusComplete;
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    assert.throws(
      () => analyzeVercelCostManifest(manifestPath),
      /rebuilt output digest does not match the manifest/,
    );
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("rejects tampered deployment pages and proof with updated digests", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "vercel-census-raw-"));
  try {
    const rawManifest = manifestForAggregate(
      fileURLToPath(fixtureUrl),
      temporaryDirectory,
    );
    const rawSource = rawManifest.windows.postCutover;
    const pages = JSON.parse(
      readFileSync(rawSource.deploymentPagesJson, "utf8"),
    );
    pages.projects[0].pages[0].response.deployments[0].futureProviderField = {
      ignored: true,
    };
    const tamperedPages = `${JSON.stringify(pages)}\n`;
    const tamperedPagesPath = join(temporaryDirectory, "tampered-pages.json");
    writeFileSync(tamperedPagesPath, tamperedPages);
    rawSource.deploymentPagesJson = tamperedPagesPath;
    rawSource.deploymentPagesSha256 = sha256(tamperedPages);
    const rawManifestPath = join(temporaryDirectory, "raw-manifest.json");
    writeFileSync(rawManifestPath, `${JSON.stringify(rawManifest, null, 2)}\n`);
    assert.throws(
      () => analyzeVercelCostManifest(rawManifestPath),
      /proof is not the canonical proof for the bound raw pages/,
    );

    const proofManifest = manifestForAggregate(
      fileURLToPath(fixtureUrl),
      temporaryDirectory,
    );
    const proofSource = proofManifest.windows.postCutover;
    const proof = JSON.parse(
      readFileSync(proofSource.deploymentCensusProof, "utf8"),
    );
    proof.operatorAssertion = "complete";
    const tamperedProof = `${JSON.stringify(proof)}\n`;
    const tamperedProofPath = join(temporaryDirectory, "tampered-proof.json");
    writeFileSync(tamperedProofPath, tamperedProof);
    proofSource.deploymentCensusProof = tamperedProofPath;
    proofSource.deploymentCensusProofSha256 = sha256(tamperedProof);
    const proofManifestPath = join(temporaryDirectory, "proof-manifest.json");
    writeFileSync(
      proofManifestPath,
      `${JSON.stringify(proofManifest, null, 2)}\n`,
    );
    assert.throws(
      () => analyzeVercelCostManifest(proofManifestPath),
      /proof is not the canonical proof for the bound raw pages/,
    );
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("requires each rebuilt deployment census window to match its aggregate", () => {
  const temporaryDirectory = mkdtempSync(
    join(tmpdir(), "vercel-census-window-"),
  );
  try {
    const manifest = manifestForAggregate(
      fileURLToPath(fixtureUrl),
      temporaryDirectory,
    );
    for (const key of [
      "deploymentPagesJson",
      "deploymentPagesSha256",
      "deploymentCensusJsonl",
      "deploymentCensusSha256",
      "deploymentCensusProof",
      "deploymentCensusProofSha256",
    ]) {
      manifest.windows.baseline[key] = manifest.windows.postCutover[key];
    }
    const manifestPath = join(temporaryDirectory, "manifest.json");
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    assert.throws(
      () => analyzeVercelCostManifest(manifestPath),
      /baseline deployment census proof window does not match aggregate evidence/,
    );
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("requires Vercel project IDs to match across comparison windows", () => {
  const temporaryDirectory = mkdtempSync(
    join(tmpdir(), "vercel-census-project-continuity-"),
  );
  try {
    const manifest = manifestForAggregate(
      fileURLToPath(fixtureUrl),
      temporaryDirectory,
    );
    const source = manifest.windows.postCutover;
    const aggregate = fixture();
    const bundle = createSyntheticVercelDeploymentEvidence({
      directory: temporaryDirectory,
      name: "unrelated-post",
      censusRaw: readFileSync(source.deploymentCensusJsonl, "utf8"),
      startUtc: aggregate.postCutover.period.startUtc,
      endUtcExclusive: aggregate.postCutover.period.endUtcExclusive,
      projectIds: {
        app: "prj_unrelatedApp999",
        governance: "prj_governance123",
        reserve: "prj_reserve123",
        ui: "prj_ui123",
      },
    });
    Object.assign(source, {
      deploymentPagesJson: bundle.pagesPath,
      deploymentPagesSha256: bundle.pagesSha256,
      deploymentCensusProof: bundle.proofPath,
      deploymentCensusProofSha256: bundle.proofSha256,
    });
    const manifestPath = join(temporaryDirectory, "manifest.json");
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    assert.throws(
      () => analyzeVercelCostManifest(manifestPath),
      /deployment census projectId for app must match across comparison windows/,
    );
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("rejects normalized census bytes that differ from bound raw pages", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "vercel-census-url-"));
  try {
    const originalRows = readFileSync(
      resolve(fixtureDirectory, "post.deployments.jsonl"),
      "utf8",
    )
      .trimEnd()
      .split("\n")
      .map((row) => JSON.parse(row));
    originalRows[0].evidenceUrl =
      "https://example-preview.vercel.app/?token=forged";
    const census = `${originalRows.map((row) => JSON.stringify(row)).join("\n")}\n`;
    const censusPath = join(temporaryDirectory, "post.jsonl");
    writeFileSync(censusPath, census);
    const manifest = manifestForAggregate(
      fileURLToPath(fixtureUrl),
      temporaryDirectory,
    );
    manifest.windows.postCutover.deploymentCensusJsonl = censusPath;
    manifest.windows.postCutover.deploymentCensusSha256 = sha256(census);
    const manifestPath = join(temporaryDirectory, "manifest.json");
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    assert.throws(
      () => analyzeVercelCostManifest(manifestPath),
      /rebuilt output digest does not match the manifest/,
    );
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
    const rows = [
      ...original.trimEnd().split("\n").map(JSON.parse),
      failedRow,
    ].toSorted((left, right) => {
      const timestamp = left.createdAtUtc.localeCompare(right.createdAtUtc);
      return timestamp === 0
        ? left.deploymentId.localeCompare(right.deploymentId)
        : timestamp;
    });
    const census = `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
    const censusPath = join(temporaryDirectory, "post.deployments.jsonl");
    writeFileSync(censusPath, census);
    const evidence = fixture();
    evidence.postCutover.targets.app.migratedPath.deploymentAttempts = 5;
    evidence.postCutover.targets.app.migratedDeploymentCensus.preview.deploymentAttempts = 4;
    const aggregatePath = join(temporaryDirectory, "aggregate.json");
    writeFileSync(aggregatePath, `${JSON.stringify(evidence, null, 2)}\n`);
    const manifest = manifestForAggregate(aggregatePath, temporaryDirectory);
    manifest.windows.postCutover.deploymentCensusJsonl = censusPath;
    bindDeploymentCensus(
      manifest,
      "postCutover",
      temporaryDirectory,
      census,
      evidence,
    );
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

test("rejects legacy manifest schemas and provider-attribution fields", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "vercel-manifest-"));
  try {
    const legacySchema = manifestForAggregate(
      fileURLToPath(fixtureUrl),
      temporaryDirectory,
    );
    legacySchema.schemaVersion = 1;
    const legacySchemaPath = join(temporaryDirectory, "schema.json");
    writeFileSync(
      legacySchemaPath,
      `${JSON.stringify(legacySchema, null, 2)}\n`,
    );
    assert.throws(
      () => analyzeVercelCostManifest(legacySchemaPath),
      /manifest\.schemaVersion must be 3/,
    );

    const legacyField = manifestForAggregate(
      fileURLToPath(fixtureUrl),
      temporaryDirectory,
    );
    legacyField.windows.baseline.providerAttributionEvidence =
      "baseline.provider-evidence.json";
    const legacyFieldPath = join(temporaryDirectory, "field.json");
    writeFileSync(legacyFieldPath, `${JSON.stringify(legacyField, null, 2)}\n`);
    assert.throws(
      () => analyzeVercelCostManifest(legacyFieldPath),
      /manifest\.windows\.baseline must contain exactly/,
    );
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("binds manifest v3 to the exact GitHub Actions proof and aggregate fields", () => {
  const temporaryDirectory = mkdtempSync(
    join(tmpdir(), "vercel-github-proof-"),
  );
  try {
    const { manifest, github } = createManifestFixture(temporaryDirectory);
    manifest.githubActionsEvidence.proofSha256 = "f".repeat(64);
    const digestPath = join(temporaryDirectory, "digest.json");
    writeFileSync(digestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    assert.throws(
      () => analyzeVercelCostManifest(digestPath),
      /proofSha256 does not bind the proof bytes/,
    );

    const mismatchedAggregate = fixture();
    mismatchedAggregate.postCutover.github.standardRunnerMinutes = 299;
    const aggregatePath = join(temporaryDirectory, "mismatch-aggregate.json");
    writeFileSync(
      aggregatePath,
      `${JSON.stringify(mismatchedAggregate, null, 2)}\n`,
    );
    const mismatchManifest = structuredClone(manifest);
    mismatchManifest.aggregate = aggregatePath;
    mismatchManifest.githubActionsEvidence = {
      proof: github.proofPath,
      proofSha256: github.proofSha256,
    };
    const mismatchPath = join(temporaryDirectory, "mismatch.json");
    writeFileSync(
      mismatchPath,
      `${JSON.stringify(mismatchManifest, null, 2)}\n`,
    );
    assert.throws(
      () => analyzeVercelCostManifest(mismatchPath),
      /standardRunnerMinutes does not reconcile/,
    );
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("fails a target with post events but no baseline target events", () => {
  const evidence = fixture();
  const target = evidence.baseline.targets.app;
  target.migratedDeploymentCensus.preview.eligibleEvents = 0;
  target.migratedDeploymentCensus.preview.deploymentAttempts = 0;
  target.migratedDeploymentCensus.main.eligibleEvents = 0;
  target.migratedDeploymentCensus.main.deploymentAttempts = 0;
  target.migratedPath.eligibleEvents = 0;
  target.migratedPath.deploymentAttempts = 0;

  const analysis = analyzeVercelCostEvidence(evidence);
  assert.equal(analysis.observationPass, false);
  assert.ok(analysis.reasons.includes("missing-baseline-events:app"));
  assert.ok(
    analysis.reasons.includes("minute-counterfactual-not-positive:app"),
  );
});

test("fails a zero-counterfactual target cost increase masked by aggregate savings", () => {
  const evidence = fixture();
  const target = evidence.baseline.targets.app;
  target.migratedPath.effectiveCost = 0;
  target.migratedPath.billedCost = 0;
  target.grossProject.effectiveCost = 0;
  target.grossProject.billedCost = 0;

  const analysis = analyzeVercelCostEvidence(evidence);
  assert.equal(analysis.observationPass, false);
  assert.ok(analysis.normalized.effectiveCost.savings > 0);
  assert.ok(analysis.normalized.billedCost.savings > 0);
  assert.equal(analysis.normalized.effectiveCost.targets.app.savings, null);
  assert.equal(analysis.normalized.billedCost.targets.app.savings, null);
  assert.ok(
    analysis.reasons.includes("normalized-effective-cost-regression:app"),
  );
  assert.ok(analysis.reasons.includes("normalized-billed-cost-regression:app"));
  assert.equal(
    analysis.reasons.includes("normalized-effective-cost-regression"),
    false,
  );
  assert.equal(
    analysis.reasons.includes("normalized-billed-cost-regression"),
    false,
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
  const passingDirectory = mkdtempSync(join(tmpdir(), "vercel-cost-cli-pass-"));
  try {
    const { manifestPath } = createManifestFixture(passingDirectory);
    const passing = spawnSync(
      process.execPath,
      [scriptPath, "--input", manifestPath],
      {
        encoding: "utf8",
      },
    );
    assert.equal(passing.status, 0, passing.stderr);
    const output = JSON.parse(passing.stdout);
    assert.equal(output.pass, true);
    assert.equal(
      Object.hasOwn(output.normalized.effectiveCost, "actual"),
      false,
    );
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
  } finally {
    rmSync(passingDirectory, { recursive: true, force: true });
  }

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
      `${JSON.stringify(
        manifestForAggregate(failingEvidencePath, temporaryDirectory),
        null,
        2,
      )}\n`,
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
