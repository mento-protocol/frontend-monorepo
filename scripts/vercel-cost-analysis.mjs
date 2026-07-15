#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const VERCEL_COST_SCHEMA_VERSION = 1;
export const VERCEL_COST_TARGETS = ["app", "governance", "reserve", "ui"];
export const MINIMUM_OBSERVATION_DAYS = 7;
export const MINIMUM_TRUSTED_PR_PUSHES = 10;
export const MINIMUM_NORMALIZED_SAVINGS = 0.9;

const DAY_MILLISECONDS = 24 * 60 * 60 * 1_000;
const FOCUS_UNIT = "Build CPU Minutes";
const BILLING_CURRENCY = "USD";
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

const PERIOD_KEYS = [
  "startUtc",
  "endUtcExclusive",
  "billingIngestionComplete",
  "invoiceFinal",
  "focusExportSha256",
  "focusChargeCount",
  "consumedUnit",
  "billingCurrency",
];
const MIGRATED_PATH_KEYS = [
  "buildCpuMinutes",
  "effectiveCost",
  "billedCost",
  "eligibleEvents",
  "deploymentAttempts",
  "duplicateDeployments",
];
const GROSS_PROJECT_KEYS = ["buildCpuMinutes", "effectiveCost", "billedCost"];
const EXCLUDED_KEYS = [
  "legacyV2DeploymentAttempts",
  "manualDeploymentAttempts",
  "unknownDeploymentAttempts",
];
const ATTRIBUTION_KEYS = ["method", "evidenceSha256"];
const ATTRIBUTION_METHODS = [
  "project-total-no-exclusions",
  "provider-attributed",
];
const TARGET_KEYS = ["migratedPath", "grossProject", "excluded", "attribution"];
const CORRECTNESS_KEYS = [
  "eligibleFirstPreviews",
  "eligibleFirstPreviewOpportunities",
  "incorrectAffectedTargetSkips",
  "unexplainedNativeBuilds",
  "smokeOrE2eRegressions",
  "secretExposureIncidents",
  "burstFirstPlusLatestFailures",
  "legacyV2Regressions",
  "rollbackProcedureVerified",
];
const GITHUB_KEYS = [
  "standardRunnerMinutes",
  "largerRunnerMinutes",
  "artifactStorageGbHours",
  "cacheStorageGbHours",
  "repositoryPublicEntireWindow",
];

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertObject(value, label) {
  if (!isObject(value)) throw new Error(`${label} must be an object`);
  return value;
}

function assertExactKeys(value, expectedKeys, label) {
  const actualKeys = Object.keys(assertObject(value, label)).sort();
  const sortedExpected = [...expectedKeys].sort();
  if (
    actualKeys.length !== sortedExpected.length ||
    actualKeys.some((key, index) => key !== sortedExpected[index])
  ) {
    throw new Error(
      `${label} must contain exactly: ${sortedExpected.join(", ")}`,
    );
  }
}

function assertBoolean(value, label) {
  if (typeof value !== "boolean") throw new Error(`${label} must be boolean`);
  return value;
}

function assertNonnegativeNumber(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a finite nonnegative number`);
  }
  return value;
}

function assertNonnegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a nonnegative safe integer`);
  }
  return value;
}

function assertNullableCost(value, label) {
  return value === null ? null : assertNonnegativeNumber(value, label);
}

function assertFiniteDerived(value, label) {
  if (!Number.isFinite(value)) {
    throw new Error(`${label} must be finite`);
  }
  return value;
}

function addFiniteDerived(total, value, label) {
  return assertFiniteDerived(total + value, label);
}

function multiplyFiniteDerived(left, right, label) {
  return assertFiniteDerived(left * right, label);
}

function divideFiniteDerived(numerator, denominator, label) {
  return assertFiniteDerived(numerator / denominator, label);
}

function savingsFiniteDerived(actual, counterfactual, label) {
  const ratio = divideFiniteDerived(actual, counterfactual, `${label}.ratio`);
  return assertFiniteDerived(1 - ratio, label);
}

function addSafeCount(total, value, label) {
  const result = addFiniteDerived(total, value, label);
  if (!Number.isSafeInteger(result)) {
    throw new Error(`${label} must be a safe integer`);
  }
  return result;
}

function parseUtcBoundary(value, label) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/.test(value)
  ) {
    throw new Error(`${label} must be an exact UTC midnight boundary`);
  }
  const milliseconds = Date.parse(value);
  if (
    !Number.isFinite(milliseconds) ||
    new Date(milliseconds).toISOString() !== value
  ) {
    throw new Error(`${label} must be a valid ISO 8601 timestamp`);
  }
  return milliseconds;
}

function validatePeriod(period, label) {
  assertExactKeys(period, PERIOD_KEYS, label);
  const startMilliseconds = parseUtcBoundary(
    period.startUtc,
    `${label}.startUtc`,
  );
  const endMilliseconds = parseUtcBoundary(
    period.endUtcExclusive,
    `${label}.endUtcExclusive`,
  );
  if (endMilliseconds <= startMilliseconds) {
    throw new Error(`${label} must have a positive UTC interval`);
  }
  const days = (endMilliseconds - startMilliseconds) / DAY_MILLISECONDS;
  if (!Number.isSafeInteger(days)) {
    throw new Error(`${label} must contain complete UTC days`);
  }
  assertBoolean(
    period.billingIngestionComplete,
    `${label}.billingIngestionComplete`,
  );
  assertBoolean(period.invoiceFinal, `${label}.invoiceFinal`);
  if (
    typeof period.focusExportSha256 !== "string" ||
    !SHA256_PATTERN.test(period.focusExportSha256)
  ) {
    throw new Error(`${label}.focusExportSha256 must be lowercase SHA-256`);
  }
  assertNonnegativeInteger(
    period.focusChargeCount,
    `${label}.focusChargeCount`,
  );
  if (period.consumedUnit !== FOCUS_UNIT) {
    throw new Error(`${label}.consumedUnit must be ${FOCUS_UNIT}`);
  }
  if (period.billingCurrency !== BILLING_CURRENCY) {
    throw new Error(`${label}.billingCurrency must be ${BILLING_CURRENCY}`);
  }
  return { startMilliseconds, endMilliseconds, days };
}

function validateTarget(target, targetName, label, invoiceFinal) {
  assertExactKeys(target, TARGET_KEYS, label);
  assertExactKeys(
    target.migratedPath,
    MIGRATED_PATH_KEYS,
    `${label}.migratedPath`,
  );
  assertExactKeys(
    target.grossProject,
    GROSS_PROJECT_KEYS,
    `${label}.grossProject`,
  );
  assertExactKeys(target.excluded, EXCLUDED_KEYS, `${label}.excluded`);
  assertExactKeys(target.attribution, ATTRIBUTION_KEYS, `${label}.attribution`);

  const migrated = target.migratedPath;
  const gross = target.grossProject;

  for (const key of ["buildCpuMinutes", "effectiveCost"]) {
    assertNonnegativeNumber(migrated[key], `${label}.migratedPath.${key}`);
    assertNonnegativeNumber(gross[key], `${label}.grossProject.${key}`);
    if (migrated[key] > gross[key]) {
      throw new Error(
        `${label}.migratedPath.${key} cannot exceed grossProject.${key}`,
      );
    }
  }

  assertNullableCost(migrated.billedCost, `${label}.migratedPath.billedCost`);
  assertNullableCost(gross.billedCost, `${label}.grossProject.billedCost`);
  if (
    invoiceFinal &&
    (migrated.billedCost === null || gross.billedCost === null)
  ) {
    throw new Error(`${label} requires BilledCost after invoice finalization`);
  }
  if (
    migrated.billedCost !== null &&
    gross.billedCost !== null &&
    migrated.billedCost > gross.billedCost
  ) {
    throw new Error(
      `${label}.migratedPath.billedCost cannot exceed grossProject.billedCost`,
    );
  }

  assertNonnegativeInteger(
    migrated.eligibleEvents,
    `${label}.migratedPath.eligibleEvents`,
  );
  assertNonnegativeInteger(
    migrated.deploymentAttempts,
    `${label}.migratedPath.deploymentAttempts`,
  );
  if (migrated.deploymentAttempts < migrated.eligibleEvents) {
    throw new Error(
      `${label}.migratedPath.deploymentAttempts cannot be lower than eligibleEvents`,
    );
  }
  const duplicateDeployments = assertNonnegativeInteger(
    migrated.duplicateDeployments,
    `${label}.migratedPath.duplicateDeployments`,
  );
  if (duplicateDeployments > migrated.deploymentAttempts) {
    throw new Error(
      `${label}.migratedPath.duplicateDeployments cannot exceed deploymentAttempts`,
    );
  }
  for (const key of EXCLUDED_KEYS) {
    assertNonnegativeInteger(target.excluded[key], `${label}.excluded.${key}`);
  }
  if (
    targetName !== "app" &&
    target.excluded.legacyV2DeploymentAttempts !== 0
  ) {
    throw new Error(`${label} cannot classify legacy app v2 activity`);
  }

  const excludedAttempts = EXCLUDED_KEYS.reduce(
    (total, key) =>
      addSafeCount(
        total,
        target.excluded[key],
        `${label}.excluded.totalAttempts`,
      ),
    0,
  );
  const { method, evidenceSha256 } = target.attribution;
  if (!ATTRIBUTION_METHODS.includes(method)) {
    throw new Error(
      `${label}.attribution.method must be ${ATTRIBUTION_METHODS.join(" or ")}`,
    );
  }
  if (method === "project-total-no-exclusions") {
    if (evidenceSha256 !== null) {
      throw new Error(
        `${label}.attribution.evidenceSha256 must be null for a clean project total`,
      );
    }
    if (excludedAttempts !== 0) {
      throw new Error(
        `${label} cannot use a clean project total with excluded deployments`,
      );
    }
    for (const key of GROSS_PROJECT_KEYS) {
      if (migrated[key] !== gross[key]) {
        throw new Error(
          `${label}.migratedPath.${key} must equal grossProject.${key} for a clean project total`,
        );
      }
    }
  } else if (
    typeof evidenceSha256 !== "string" ||
    !SHA256_PATTERN.test(evidenceSha256)
  ) {
    throw new Error(
      `${label}.attribution.evidenceSha256 must be lowercase SHA-256 for provider attribution`,
    );
  }
  if (
    gross.buildCpuMinutes > migrated.buildCpuMinutes &&
    excludedAttempts === 0
  ) {
    throw new Error(`${label} has unattributed gross Build CPU minutes`);
  }
}

function validateWindow(window, label) {
  const requiredKeys =
    label === "postCutover"
      ? [
          "period",
          "targets",
          "trustedSameRepositoryPrPushes",
          "github",
          "correctness",
        ]
      : ["period", "targets"];
  assertExactKeys(window, requiredKeys, label);
  const period = validatePeriod(window.period, `${label}.period`);
  assertExactKeys(window.targets, VERCEL_COST_TARGETS, `${label}.targets`);
  for (const target of VERCEL_COST_TARGETS) {
    validateTarget(
      window.targets[target],
      target,
      `${label}.targets.${target}`,
      window.period.invoiceFinal,
    );
  }
  const grossMinutes = VERCEL_COST_TARGETS.reduce(
    (total, target) =>
      addFiniteDerived(
        total,
        window.targets[target].grossProject.buildCpuMinutes,
        `${label}.grossProject.buildCpuMinutes.total`,
      ),
    0,
  );
  if (grossMinutes > 0 && window.period.focusChargeCount === 0) {
    throw new Error(`${label}.period.focusChargeCount contradicts gross usage`);
  }

  if (label === "postCutover") {
    assertNonnegativeInteger(
      window.trustedSameRepositoryPrPushes,
      `${label}.trustedSameRepositoryPrPushes`,
    );
    assertExactKeys(window.github, GITHUB_KEYS, `${label}.github`);
    for (const key of GITHUB_KEYS.slice(0, 4)) {
      assertNonnegativeNumber(window.github[key], `${label}.github.${key}`);
    }
    assertBoolean(
      window.github.repositoryPublicEntireWindow,
      `${label}.github.repositoryPublicEntireWindow`,
    );
    assertExactKeys(
      window.correctness,
      CORRECTNESS_KEYS,
      `${label}.correctness`,
    );
    for (const key of CORRECTNESS_KEYS.slice(0, -1)) {
      assertNonnegativeInteger(
        window.correctness[key],
        `${label}.correctness.${key}`,
      );
    }
    assertBoolean(
      window.correctness.rollbackProcedureVerified,
      `${label}.correctness.rollbackProcedureVerified`,
    );
    if (
      window.correctness.eligibleFirstPreviews >
      window.correctness.eligibleFirstPreviewOpportunities
    ) {
      throw new Error(
        `${label}.correctness.eligibleFirstPreviews cannot exceed opportunities`,
      );
    }
  }
  return period;
}

export function validateVercelCostEvidence(evidence) {
  assertExactKeys(
    evidence,
    ["schemaVersion", "cutoverCompletedAtUtc", "baseline", "postCutover"],
    "evidence",
  );
  if (evidence.schemaVersion !== VERCEL_COST_SCHEMA_VERSION) {
    throw new Error(
      `evidence.schemaVersion must be ${VERCEL_COST_SCHEMA_VERSION}`,
    );
  }
  const cutoverMilliseconds = Date.parse(evidence.cutoverCompletedAtUtc);
  if (
    typeof evidence.cutoverCompletedAtUtc !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(
      evidence.cutoverCompletedAtUtc,
    ) ||
    !Number.isFinite(cutoverMilliseconds) ||
    new Date(cutoverMilliseconds).toISOString() !==
      evidence.cutoverCompletedAtUtc
  ) {
    throw new Error(
      "evidence.cutoverCompletedAtUtc must be an exact UTC timestamp",
    );
  }

  const baselinePeriod = validateWindow(evidence.baseline, "baseline");
  const postPeriod = validateWindow(evidence.postCutover, "postCutover");
  if (baselinePeriod.endMilliseconds > cutoverMilliseconds) {
    throw new Error("baseline period extends beyond the completed cutover");
  }
  if (postPeriod.startMilliseconds < cutoverMilliseconds) {
    throw new Error("postCutover period starts before the completed cutover");
  }
  return { baselinePeriod, postPeriod };
}

function normalizedMetric(evidence, metric) {
  let counterfactual = 0;
  let actual = 0;
  const targets = {};

  for (const target of VERCEL_COST_TARGETS) {
    const baseline = evidence.baseline.targets[target].migratedPath;
    const post = evidence.postCutover.targets[target].migratedPath;
    const baselineValue = baseline[metric];
    const postValue = post[metric];

    if (baselineValue === null || postValue === null) return null;
    if (baseline.eligibleEvents === 0 || post.eligibleEvents === 0) {
      targets[target] = null;
      continue;
    }

    const targetLabel = `normalized.${metric}.targets.${target}`;
    const baselinePerEvent = divideFiniteDerived(
      baselineValue,
      baseline.eligibleEvents,
      `${targetLabel}.baselinePerEvent`,
    );
    const targetCounterfactual = multiplyFiniteDerived(
      post.eligibleEvents,
      baselinePerEvent,
      `${targetLabel}.counterfactual`,
    );
    counterfactual = addFiniteDerived(
      counterfactual,
      targetCounterfactual,
      `normalized.${metric}.counterfactual`,
    );
    actual = addFiniteDerived(actual, postValue, `normalized.${metric}.actual`);
    targets[target] = {
      baseline: baselineValue,
      counterfactual: targetCounterfactual,
      actual: postValue,
      savings:
        targetCounterfactual === 0
          ? null
          : savingsFiniteDerived(
              postValue,
              targetCounterfactual,
              `${targetLabel}.savings`,
            ),
    };
  }

  return {
    counterfactual,
    actual,
    savings:
      counterfactual === 0
        ? null
        : savingsFiniteDerived(
            actual,
            counterfactual,
            `normalized.${metric}.savings`,
          ),
    targets,
  };
}

function costSavingsOnly(metric) {
  if (metric === null) return null;
  return {
    savings: metric.savings,
    targets: Object.fromEntries(
      VERCEL_COST_TARGETS.map((target) => [
        target,
        metric.targets[target] === null
          ? null
          : { savings: metric.targets[target].savings },
      ]),
    ),
  };
}

function sumGross(evidence, windowName, metric) {
  let total = 0;
  for (const target of VERCEL_COST_TARGETS) {
    const value = evidence[windowName].targets[target].grossProject[metric];
    if (value === null) return null;
    total = addFiniteDerived(
      total,
      value,
      `gross.${windowName}.${metric}.total`,
    );
  }
  return total;
}

function grossSavings(evidence, metric, baselineDays, postDays) {
  const baseline = sumGross(evidence, "baseline", metric);
  const post = sumGross(evidence, "postCutover", metric);
  if (baseline === null || post === null || baseline === 0) {
    return null;
  }
  const baselinePerDay = divideFiniteDerived(
    baseline,
    baselineDays,
    `gross.baseline.${metric}.perDay`,
  );
  const postPerDay = divideFiniteDerived(
    post,
    postDays,
    `gross.postCutover.${metric}.perDay`,
  );
  return savingsFiniteDerived(
    postPerDay,
    baselinePerDay,
    `gross.${metric}.savings`,
  );
}

function reason(condition, value, reasons) {
  if (condition) reasons.push(value);
}

export function analyzeVercelCostEvidence(evidence) {
  const { baselinePeriod, postPeriod } = validateVercelCostEvidence(evidence);
  const minutes = normalizedMetric(evidence, "buildCpuMinutes");
  const effectiveCost = normalizedMetric(evidence, "effectiveCost");
  const billedCost = normalizedMetric(evidence, "billedCost");
  const baselineGrossMinutes = sumGross(
    evidence,
    "baseline",
    "buildCpuMinutes",
  );
  const postGrossMinutes = sumGross(evidence, "postCutover", "buildCpuMinutes");
  const baselineGrossMinutesPerDay = divideFiniteDerived(
    baselineGrossMinutes,
    baselinePeriod.days,
    "gross.baseline.buildCpuMinutes.perDay",
  );
  const postGrossMinutesPerDay = divideFiniteDerived(
    postGrossMinutes,
    postPeriod.days,
    "gross.postCutover.buildCpuMinutes.perDay",
  );
  const grossMinuteSavings =
    baselineGrossMinutesPerDay === 0
      ? null
      : savingsFiniteDerived(
          postGrossMinutesPerDay,
          baselineGrossMinutesPerDay,
          "gross.buildCpuMinutes.savings",
        );
  const grossEffectiveCostSavings = grossSavings(
    evidence,
    "effectiveCost",
    baselinePeriod.days,
    postPeriod.days,
  );
  const grossBilledCostSavings = grossSavings(
    evidence,
    "billedCost",
    baselinePeriod.days,
    postPeriod.days,
  );

  const attempts = {};
  let totalPostEvents = 0;
  let totalPostAttempts = 0;
  for (const target of VERCEL_COST_TARGETS) {
    const post = evidence.postCutover.targets[target].migratedPath;
    totalPostEvents = addSafeCount(
      totalPostEvents,
      post.eligibleEvents,
      "postCutover.eligibleEvents.total",
    );
    totalPostAttempts = addSafeCount(
      totalPostAttempts,
      post.deploymentAttempts,
      "postCutover.deploymentAttempts.total",
    );
    attempts[target] =
      post.eligibleEvents === 0
        ? null
        : divideFiniteDerived(
            post.deploymentAttempts,
            post.eligibleEvents,
            `postCutover.targets.${target}.attemptsPerEligibleEvent`,
          );
  }

  const correctness = evidence.postCutover.correctness;
  const reasons = [];
  reason(
    postPeriod.days < MINIMUM_OBSERVATION_DAYS,
    `post-cutover-window-under-${MINIMUM_OBSERVATION_DAYS}-days`,
    reasons,
  );
  reason(
    evidence.postCutover.trustedSameRepositoryPrPushes <
      MINIMUM_TRUSTED_PR_PUSHES,
    `fewer-than-${MINIMUM_TRUSTED_PR_PUSHES}-trusted-pr-pushes`,
    reasons,
  );
  reason(
    !evidence.baseline.period.billingIngestionComplete,
    "baseline-billing-ingestion-incomplete",
    reasons,
  );
  reason(
    !evidence.postCutover.period.billingIngestionComplete,
    "post-cutover-billing-ingestion-incomplete",
    reasons,
  );
  reason(
    !evidence.baseline.period.invoiceFinal,
    "baseline-invoice-not-final",
    reasons,
  );
  reason(
    !evidence.postCutover.period.invoiceFinal,
    "post-cutover-invoice-not-final",
    reasons,
  );
  reason(
    !evidence.postCutover.github.repositoryPublicEntireWindow,
    "repository-not-public-for-complete-window",
    reasons,
  );
  reason(
    evidence.postCutover.github.largerRunnerMinutes !== 0,
    "larger-runner-minutes-nonzero",
    reasons,
  );
  reason(
    evidence.postCutover.github.standardRunnerMinutes === 0,
    "standard-runner-minutes-missing",
    reasons,
  );

  for (const target of VERCEL_COST_TARGETS) {
    const baseline = evidence.baseline.targets[target].migratedPath;
    const post = evidence.postCutover.targets[target].migratedPath;
    reason(
      baseline.eligibleEvents === 0,
      `missing-baseline-events:${target}`,
      reasons,
    );
    reason(post.eligibleEvents === 0, `missing-post-events:${target}`, reasons);
    reason(
      post.duplicateDeployments !== 0,
      `duplicate-deployments:${target}`,
      reasons,
    );
    reason(
      evidence.postCutover.targets[target].excluded
        .unknownDeploymentAttempts !== 0,
      `unknown-deployment-attempts:${target}`,
      reasons,
    );
    const targetMinutes = minutes.targets[target];
    reason(
      targetMinutes === null ||
        !Number.isFinite(targetMinutes.counterfactual) ||
        targetMinutes.counterfactual <= 0 ||
        targetMinutes.savings === null ||
        !Number.isFinite(targetMinutes.savings),
      `minute-counterfactual-not-positive:${target}`,
      reasons,
    );
  }

  reason(
    minutes.savings === null ||
      !Number.isFinite(minutes.savings) ||
      minutes.savings < MINIMUM_NORMALIZED_SAVINGS,
    "normalized-build-minute-savings-below-90-percent",
    reasons,
  );
  reason(
    effectiveCost === null ||
      effectiveCost.savings === null ||
      !Number.isFinite(effectiveCost.savings),
    "normalized-effective-cost-unavailable",
    reasons,
  );
  reason(
    correctness.eligibleFirstPreviews !==
      correctness.eligibleFirstPreviewOpportunities,
    "eligible-first-preview-coverage-below-100-percent",
    reasons,
  );
  for (const [key, reasonName] of [
    ["incorrectAffectedTargetSkips", "incorrect-affected-target-skips"],
    ["unexplainedNativeBuilds", "unexplained-native-builds"],
    ["smokeOrE2eRegressions", "smoke-or-e2e-regressions"],
    ["secretExposureIncidents", "secret-exposure-incidents"],
    ["burstFirstPlusLatestFailures", "burst-first-plus-latest-failures"],
    ["legacyV2Regressions", "legacy-v2-regressions"],
  ]) {
    reason(correctness[key] !== 0, reasonName, reasons);
  }
  reason(
    !correctness.rollbackProcedureVerified,
    "rollback-procedure-not-verified",
    reasons,
  );

  const prPushes = evidence.postCutover.trustedSameRepositoryPrPushes;
  const postCutoverMigratedMinutes = VERCEL_COST_TARGETS.reduce(
    (total, target) =>
      addFiniteDerived(
        total,
        evidence.postCutover.targets[target].migratedPath.buildCpuMinutes,
        "postCutover.migratedPath.buildCpuMinutes.total",
      ),
    0,
  );
  const totalAttemptsPerEligibleEvent =
    totalPostEvents === 0
      ? null
      : divideFiniteDerived(
          totalPostAttempts,
          totalPostEvents,
          "postCutover.attemptsPerEligibleEvent.total",
        );
  const totalMinutesPerTrustedPrPush =
    prPushes === 0
      ? null
      : divideFiniteDerived(
          postCutoverMigratedMinutes,
          prPushes,
          "postCutover.buildCpuMinutesPerTrustedPrPush.total",
        );
  const targetMinutesPerTrustedPrPush = Object.fromEntries(
    VERCEL_COST_TARGETS.map((target) => [
      target,
      prPushes === 0
        ? null
        : divideFiniteDerived(
            evidence.postCutover.targets[target].migratedPath.buildCpuMinutes,
            prPushes,
            `postCutover.targets.${target}.buildCpuMinutesPerTrustedPrPush`,
          ),
    ]),
  );
  return {
    schemaVersion: VERCEL_COST_SCHEMA_VERSION,
    pass: reasons.length === 0,
    reasons,
    periods: {
      baseline: { ...evidence.baseline.period, days: baselinePeriod.days },
      postCutover: {
        ...evidence.postCutover.period,
        days: postPeriod.days,
      },
    },
    normalized: {
      minutes,
      effectiveCost: costSavingsOnly(effectiveCost),
      billedCost: costSavingsOnly(billedCost),
    },
    gross: {
      baselineMinutes: baselineGrossMinutes,
      postCutoverMinutes: postGrossMinutes,
      baselineMinutesPerDay: baselineGrossMinutesPerDay,
      postCutoverMinutesPerDay: postGrossMinutesPerDay,
      minuteSavings: grossMinuteSavings,
      effectiveCostSavings: grossEffectiveCostSavings,
      billedCostSavings: grossBilledCostSavings,
    },
    github: { ...evidence.postCutover.github },
    correctness: { ...evidence.postCutover.correctness },
    eventCensus: Object.fromEntries(
      VERCEL_COST_TARGETS.map((target) => [
        target,
        {
          baseline: {
            eligibleEvents:
              evidence.baseline.targets[target].migratedPath.eligibleEvents,
            deploymentAttempts:
              evidence.baseline.targets[target].migratedPath.deploymentAttempts,
            duplicateDeployments:
              evidence.baseline.targets[target].migratedPath
                .duplicateDeployments,
            excluded: { ...evidence.baseline.targets[target].excluded },
            attributionMethod:
              evidence.baseline.targets[target].attribution.method,
          },
          postCutover: {
            eligibleEvents:
              evidence.postCutover.targets[target].migratedPath.eligibleEvents,
            deploymentAttempts:
              evidence.postCutover.targets[target].migratedPath
                .deploymentAttempts,
            duplicateDeployments:
              evidence.postCutover.targets[target].migratedPath
                .duplicateDeployments,
            excluded: { ...evidence.postCutover.targets[target].excluded },
            attributionMethod:
              evidence.postCutover.targets[target].attribution.method,
          },
        },
      ]),
    ),
    attemptsPerEligibleEvent: {
      total: totalAttemptsPerEligibleEvent,
      targets: attempts,
    },
    postCutoverMinutesPerTrustedPrPush: {
      total: totalMinutesPerTrustedPrPush,
      targets: targetMinutesPerTrustedPrPush,
    },
  };
}

function formatPercent(value) {
  return value === null
    ? "n/a"
    : `${multiplyFiniteDerived(value, 100, "formatted percentage").toFixed(2)}%`;
}

function formatNumber(value) {
  return value === null
    ? "n/a"
    : assertFiniteDerived(value, "formatted number").toFixed(2);
}

export function formatVercelCostMarkdown(analysis) {
  const lines = [
    "# Vercel build-minute validation",
    "",
    `Result: **${analysis.pass ? "PASS" : "FAIL"}**`,
    "",
    `- Baseline UTC window: ${analysis.periods.baseline.startUtc} to ${analysis.periods.baseline.endUtcExclusive} (${analysis.periods.baseline.days} complete days)`,
    `- Post-cutover UTC window: ${analysis.periods.postCutover.startUtc} to ${analysis.periods.postCutover.endUtcExclusive} (${analysis.periods.postCutover.days} complete days)`,
    `- Target-mix normalized build-minute savings: ${formatPercent(analysis.normalized.minutes?.savings ?? null)}`,
    `- Target-mix normalized EffectiveCost savings: ${formatPercent(analysis.normalized.effectiveCost?.savings ?? null)}`,
    `- Target-mix normalized final BilledCost savings: ${formatPercent(analysis.normalized.billedCost?.savings ?? null)}`,
    `- Gross equal-window build-minute savings: ${formatPercent(analysis.gross.minuteSavings)}`,
    `- Gross equal-window EffectiveCost savings: ${formatPercent(analysis.gross.effectiveCostSavings)}`,
    `- Gross equal-window final BilledCost savings: ${formatPercent(analysis.gross.billedCostSavings)}`,
    `- Deployment attempts per eligible event: ${formatNumber(analysis.attemptsPerEligibleEvent.total)}`,
    `- Vercel build minutes per trusted same-repository PR push: ${formatNumber(analysis.postCutoverMinutesPerTrustedPrPush.total)}`,
    `- GitHub standard-runner minutes: ${formatNumber(analysis.github.standardRunnerMinutes)}`,
    `- GitHub larger-runner minutes: ${formatNumber(analysis.github.largerRunnerMinutes)}`,
    `- GitHub artifact storage: ${formatNumber(analysis.github.artifactStorageGbHours)} GB-hours`,
    `- GitHub cache storage: ${formatNumber(analysis.github.cacheStorageGbHours)} GB-hours`,
    `- Eligible first previews: ${analysis.correctness.eligibleFirstPreviews}/${analysis.correctness.eligibleFirstPreviewOpportunities}`,
    "",
    "| Target | Baseline minutes | Post-cutover minutes | Baseline-mix counterfactual | Change | Pass |",
    "|---|---:|---:|---:|---:|---|",
  ];

  for (const target of VERCEL_COST_TARGETS) {
    const normalized = analysis.normalized.minutes?.targets[target] ?? null;
    lines.push(
      `| ${target} | ${formatNumber(normalized?.baseline ?? null)} | ${formatNumber(normalized?.actual ?? null)} | ${formatNumber(normalized?.counterfactual ?? null)} | ${formatPercent(normalized?.savings ?? null)} | ${normalized !== null && normalized.savings !== null && normalized.savings >= MINIMUM_NORMALIZED_SAVINGS ? "yes" : "no"} |`,
    );
  }

  lines.push(
    "",
    "| Target | Baseline events/attempts | Post events/attempts | Post duplicates | Post legacy v2 | Post manual | Post unknown | Attribution |",
    "|---|---:|---:|---:|---:|---:|---:|---|",
  );
  for (const target of VERCEL_COST_TARGETS) {
    const census = analysis.eventCensus[target];
    lines.push(
      `| ${target} | ${census.baseline.eligibleEvents}/${census.baseline.deploymentAttempts} | ${census.postCutover.eligibleEvents}/${census.postCutover.deploymentAttempts} | ${census.postCutover.duplicateDeployments} | ${census.postCutover.excluded.legacyV2DeploymentAttempts} | ${census.postCutover.excluded.manualDeploymentAttempts} | ${census.postCutover.excluded.unknownDeploymentAttempts} | ${census.postCutover.attributionMethod} |`,
    );
  }

  if (analysis.reasons.length > 0) {
    lines.push("", "## Blocking evidence", "");
    for (const blockingReason of analysis.reasons) {
      lines.push(`- ${blockingReason}`);
    }
  }

  lines.push(
    "",
    "> Absolute EffectiveCost and BilledCost values are intentionally omitted from this public-safe report.",
  );
  return `${lines.join("\n")}\n`;
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--") || index + 1 >= argv.length) {
      throw new Error(
        "Usage: vercel-cost-analysis.mjs --input <aggregate.json> [--format json|markdown]",
      );
    }
    const key = argument.slice(2);
    if (!["input", "format"].includes(key)) {
      throw new Error(
        "Usage: vercel-cost-analysis.mjs --input <aggregate.json> [--format json|markdown]",
      );
    }
    if (Object.hasOwn(options, key))
      throw new Error(`Duplicate option: --${key}`);
    options[key] = argv[index + 1];
    index += 1;
  }
  if (
    !options.input ||
    ![undefined, "json", "markdown"].includes(options.format)
  ) {
    throw new Error(
      "Usage: vercel-cost-analysis.mjs --input <aggregate.json> [--format json|markdown]",
    );
  }
  return { input: options.input, format: options.format ?? "json" };
}

function isCliEntrypoint() {
  return (
    process.argv[1] !== undefined &&
    fileURLToPath(import.meta.url) === resolve(process.argv[1])
  );
}

if (isCliEntrypoint()) {
  try {
    const options = parseArguments(process.argv.slice(2));
    const evidence = JSON.parse(readFileSync(resolve(options.input), "utf8"));
    const analysis = analyzeVercelCostEvidence(evidence);
    process.stdout.write(
      options.format === "markdown"
        ? formatVercelCostMarkdown(analysis)
        : `${JSON.stringify(analysis, null, 2)}\n`,
    );
    if (!analysis.pass) process.exitCode = 1;
  } catch (error) {
    console.error(
      `FAIL ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
