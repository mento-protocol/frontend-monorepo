#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const VERCEL_COST_SCHEMA_VERSION = 2;
export const VERCEL_COST_TARGETS = ["app", "governance", "reserve", "ui"];
export const MINIMUM_OBSERVATION_DAYS = 7;
export const MINIMUM_TRUSTED_PR_PUSHES = 10;
export const MINIMUM_NORMALIZED_SAVINGS = 0.9;

const DAY_MILLISECONDS = 24 * 60 * 60 * 1_000;
const FOCUS_UNIT = "Build CPU Minutes";
const BILLING_CURRENCY = "USD";
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const GIT_SHA_PATTERN = /^[a-f0-9]{40}$/;
const VERCEL_DEPLOYMENT_ID_PATTERN = /^dpl_[A-Za-z0-9]+$/;

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
const MIGRATED_DEPLOYMENT_PATH_KEYS = ["preview", "main"];
const MIGRATED_USAGE_KEYS = ["buildCpuMinutes", "effectiveCost", "billedCost"];
const MIGRATED_DEPLOYMENT_CENSUS_KEYS = [
  "eligibleEvents",
  "deploymentAttempts",
  "duplicateDeployments",
];
const TARGET_KEYS = [
  "migratedPath",
  "migratedUsageByPath",
  "migratedDeploymentCensus",
  "grossProject",
  "excluded",
  "attribution",
];
const CLOSEOUT_KEYS = [
  "manualPilotDispositionComplete",
  "shadowAndCanaryScaffoldingDispositionComplete",
  "legacyDeploymentStatusDispositionComplete",
  "migrationLoggingCleanupComplete",
  "docsDriftAuditPassed",
  "finalVerificationPassed",
];
const MANIFEST_KEYS = ["schemaVersion", "aggregate", "windows"];
const MANIFEST_WINDOW_KEYS = [
  "focusJsonl",
  "providerAttributionEvidence",
  "providerAttributionSha256",
  "attributionJsonl",
  "attributionJsonlSha256",
  "deploymentCensusJsonl",
  "deploymentCensusSha256",
  "deploymentCensusComplete",
  "focusProjectTags",
];
const FOCUS_PROJECT_TAG_KEYS = ["key", "value"];
const DEPLOYMENT_PATHS = ["preview", "main", "legacy-v2", "unknown"];
const DEPLOYMENT_SOURCES = [
  "github-actions-prebuilt",
  "vercel-native",
  "manual",
  "unknown",
];
const DEPLOYMENT_OUTCOMES = ["ready", "error", "canceled"];
const DEPLOYMENT_ROW_KEYS = [
  "deploymentId",
  "target",
  "path",
  "source",
  "outcome",
  "sourceSha",
  "createdAtUtc",
  "evidenceUrl",
];
const CORRECTNESS_KEYS = [
  "eligibleFirstPreviews",
  "eligibleFirstPreviewOpportunities",
  "incorrectAffectedTargetSkips",
  "unexplainedNativeBuilds",
  "smokeOrE2eChecksCompleted",
  "smokeOrE2eCheckOpportunities",
  "smokeOrE2eRegressions",
  "secretExposureIncidents",
  "burstFirstPlusLatestChecksCompleted",
  "burstFirstPlusLatestCheckOpportunities",
  "burstFirstPlusLatestFailures",
  "mainDeploymentObservationsCompleted",
  "mainDeploymentObservationFailures",
  "legacyV2HealthChecksCompleted",
  "legacyV2HealthCheckOpportunities",
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

function assertNonemptyString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a nonempty string`);
  }
  return value;
}

function assertHttpsUrl(value, label) {
  assertNonemptyString(value, label);
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be an HTTPS URL`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`${label} must be an HTTPS URL`);
  }
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

function numbersEqual(left, right) {
  const scale = Math.max(1, Math.abs(left), Math.abs(right));
  return Math.abs(left - right) <= Number.EPSILON * scale * 16;
}

function isNegativeRegression(value) {
  return value < -Number.EPSILON * Math.max(1, Math.abs(value)) * 16;
}

function assertNonnegativeDecimal(value, label) {
  if (typeof value === "string" && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) {
    return assertNonnegativeNumber(Number(value), label);
  }
  return assertNonnegativeNumber(value, label);
}

function parseCanonicalUtc(value, label) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
  ) {
    throw new Error(`${label} must be a canonical UTC timestamp`);
  }
  const milliseconds = Date.parse(value);
  const normalized = value.endsWith(".000Z")
    ? value
    : value.endsWith("Z") && !value.includes(".")
      ? value.replace(/Z$/, ".000Z")
      : value;
  if (
    !Number.isFinite(milliseconds) ||
    new Date(milliseconds).toISOString() !== normalized
  ) {
    throw new Error(`${label} must be a canonical UTC timestamp`);
  }
  return milliseconds;
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

function validateTarget(
  target,
  targetName,
  label,
  invoiceFinal,
  focusExportSha256,
) {
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
  assertExactKeys(
    target.migratedDeploymentCensus,
    MIGRATED_DEPLOYMENT_PATH_KEYS,
    `${label}.migratedDeploymentCensus`,
  );
  assertExactKeys(
    target.migratedUsageByPath,
    MIGRATED_DEPLOYMENT_PATH_KEYS,
    `${label}.migratedUsageByPath`,
  );
  for (const source of MIGRATED_DEPLOYMENT_PATH_KEYS) {
    assertExactKeys(
      target.migratedDeploymentCensus[source],
      MIGRATED_DEPLOYMENT_CENSUS_KEYS,
      `${label}.migratedDeploymentCensus.${source}`,
    );
    assertExactKeys(
      target.migratedUsageByPath[source],
      MIGRATED_USAGE_KEYS,
      `${label}.migratedUsageByPath.${source}`,
    );
  }
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
  if (
    duplicateDeployments >
    migrated.deploymentAttempts - migrated.eligibleEvents
  ) {
    throw new Error(
      `${label}.migratedPath.duplicateDeployments cannot exceed deploymentAttempts minus eligibleEvents`,
    );
  }
  for (const metric of MIGRATED_DEPLOYMENT_CENSUS_KEYS) {
    let censusTotal = 0;
    for (const source of MIGRATED_DEPLOYMENT_PATH_KEYS) {
      censusTotal = addSafeCount(
        censusTotal,
        assertNonnegativeInteger(
          target.migratedDeploymentCensus[source][metric],
          `${label}.migratedDeploymentCensus.${source}.${metric}`,
        ),
        `${label}.migratedDeploymentCensus.${metric}.total`,
      );
    }
    if (censusTotal !== migrated[metric]) {
      throw new Error(
        `${label}.migratedDeploymentCensus ${metric} must sum exactly to migratedPath.${metric}`,
      );
    }
  }
  for (const source of MIGRATED_DEPLOYMENT_PATH_KEYS) {
    const sourceCensus = target.migratedDeploymentCensus[source];
    if (sourceCensus.deploymentAttempts < sourceCensus.eligibleEvents) {
      throw new Error(
        `${label}.migratedDeploymentCensus.${source}.deploymentAttempts cannot be lower than eligibleEvents`,
      );
    }
    if (
      sourceCensus.duplicateDeployments >
      sourceCensus.deploymentAttempts - sourceCensus.eligibleEvents
    ) {
      throw new Error(
        `${label}.migratedDeploymentCensus.${source}.duplicateDeployments cannot exceed deploymentAttempts minus eligibleEvents`,
      );
    }
  }
  for (const metric of MIGRATED_USAGE_KEYS) {
    let pathTotal = 0;
    for (const source of MIGRATED_DEPLOYMENT_PATH_KEYS) {
      const value =
        metric === "billedCost"
          ? assertNullableCost(
              target.migratedUsageByPath[source][metric],
              `${label}.migratedUsageByPath.${source}.${metric}`,
            )
          : assertNonnegativeNumber(
              target.migratedUsageByPath[source][metric],
              `${label}.migratedUsageByPath.${source}.${metric}`,
            );
      if (invoiceFinal && value === null) {
        throw new Error(
          `${label}.migratedUsageByPath.${source} requires BilledCost after invoice finalization`,
        );
      }
      if (value === null) {
        pathTotal = null;
        break;
      }
      pathTotal = addFiniteDerived(
        pathTotal,
        value,
        `${label}.migratedUsageByPath.${metric}.total`,
      );
    }
    if (
      (pathTotal === null) !== (migrated[metric] === null) ||
      (pathTotal !== null && !numbersEqual(pathTotal, migrated[metric]))
    ) {
      throw new Error(
        `${label}.migratedUsageByPath ${metric} must sum exactly to migratedPath.${metric}`,
      );
    }
  }
  for (const source of MIGRATED_DEPLOYMENT_PATH_KEYS) {
    if (
      target.migratedDeploymentCensus[source].eligibleEvents === 0 &&
      MIGRATED_USAGE_KEYS.some((metric) => {
        const value = target.migratedUsageByPath[source][metric];
        return value !== 0 && !(metric === "billedCost" && value === null);
      })
    ) {
      throw new Error(
        `${label}.migratedUsageByPath.${source} must be zero when the path has no eligible events`,
      );
    }
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
    const activePaths = MIGRATED_DEPLOYMENT_PATH_KEYS.filter(
      (source) => target.migratedDeploymentCensus[source].eligibleEvents > 0,
    );
    if (activePaths.length > 1) {
      throw new Error(
        `${label}.attribution requires provider-attributed target-by-path evidence when preview and main both have events`,
      );
    }
  } else {
    if (
      typeof evidenceSha256 !== "string" ||
      !SHA256_PATTERN.test(evidenceSha256)
    ) {
      throw new Error(
        `${label}.attribution.evidenceSha256 must be lowercase SHA-256 for provider attribution`,
      );
    }
    if (evidenceSha256 === focusExportSha256) {
      throw new Error(
        `${label}.attribution.evidenceSha256 must differ from the raw FOCUS export digest`,
      );
    }
    if (excludedAttempts === 0) {
      for (const key of GROSS_PROJECT_KEYS) {
        if (migrated[key] !== gross[key]) {
          throw new Error(
            `${label}.migratedPath.${key} must equal grossProject.${key} when provider attribution has no excluded deployments`,
          );
        }
      }
    }
  }
}

function validateObservationCoverage(
  correctness,
  completedKey,
  opportunityKey,
  failureKey,
  label,
) {
  if (correctness[completedKey] > correctness[opportunityKey]) {
    throw new Error(`${label}.${completedKey} cannot exceed ${opportunityKey}`);
  }
  if (correctness[failureKey] > correctness[completedKey]) {
    throw new Error(`${label}.${failureKey} cannot exceed ${completedKey}`);
  }
}

function sumMigratedDeploymentCensus(window, source, metric, label) {
  let total = 0;
  for (const target of VERCEL_COST_TARGETS) {
    total = addSafeCount(
      total,
      window.targets[target].migratedDeploymentCensus[source][metric],
      `${label}.${source}.${metric}.total`,
    );
  }
  return total;
}

function validateWindow(window, label) {
  const requiredKeys =
    label === "postCutover"
      ? [
          "period",
          "targets",
          "trustedDeployedCodePrPushes",
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
      window.period.focusExportSha256,
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
      window.trustedDeployedCodePrPushes,
      `${label}.trustedDeployedCodePrPushes`,
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
    if (
      window.correctness.eligibleFirstPreviewOpportunities >
      window.trustedDeployedCodePrPushes
    ) {
      throw new Error(
        `${label}.correctness.eligibleFirstPreviewOpportunities cannot exceed trustedDeployedCodePrPushes`,
      );
    }
    const previewEligibleEvents = sumMigratedDeploymentCensus(
      window,
      "preview",
      "eligibleEvents",
      `${label}.migratedDeploymentCensus`,
    );
    if (window.correctness.eligibleFirstPreviews > previewEligibleEvents) {
      throw new Error(
        `${label}.correctness.eligibleFirstPreviews cannot exceed derived preview eligible events`,
      );
    }
    validateObservationCoverage(
      window.correctness,
      "smokeOrE2eChecksCompleted",
      "smokeOrE2eCheckOpportunities",
      "smokeOrE2eRegressions",
      `${label}.correctness`,
    );
    const mainEligibleEvents = sumMigratedDeploymentCensus(
      window,
      "main",
      "eligibleEvents",
      `${label}.migratedDeploymentCensus`,
    );
    if (
      window.correctness.mainDeploymentObservationsCompleted >
      mainEligibleEvents
    ) {
      throw new Error(
        `${label}.correctness.mainDeploymentObservationsCompleted cannot exceed derived main eligible events`,
      );
    }
    if (
      window.correctness.mainDeploymentObservationFailures >
      window.correctness.mainDeploymentObservationsCompleted
    ) {
      throw new Error(
        `${label}.correctness.mainDeploymentObservationFailures cannot exceed mainDeploymentObservationsCompleted`,
      );
    }
    validateObservationCoverage(
      window.correctness,
      "burstFirstPlusLatestChecksCompleted",
      "burstFirstPlusLatestCheckOpportunities",
      "burstFirstPlusLatestFailures",
      `${label}.correctness`,
    );
    validateObservationCoverage(
      window.correctness,
      "legacyV2HealthChecksCompleted",
      "legacyV2HealthCheckOpportunities",
      "legacyV2Regressions",
      `${label}.correctness`,
    );
  }
  return period;
}

export function validateVercelCostEvidence(evidence) {
  assertExactKeys(
    evidence,
    [
      "schemaVersion",
      "cutoverCompletedAtUtc",
      "baseline",
      "postCutover",
      "closeout",
    ],
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
  assertExactKeys(evidence.closeout, CLOSEOUT_KEYS, "evidence.closeout");
  for (const key of CLOSEOUT_KEYS) {
    assertBoolean(evidence.closeout[key], `evidence.closeout.${key}`);
  }

  const baselinePeriod = validateWindow(evidence.baseline, "baseline");
  const postPeriod = validateWindow(evidence.postCutover, "postCutover");
  if (
    evidence.baseline.period.focusExportSha256 ===
    evidence.postCutover.period.focusExportSha256
  ) {
    throw new Error(
      "baseline and postCutover raw FOCUS export digests must differ",
    );
  }
  const rawFocusExportDigests = new Set([
    evidence.baseline.period.focusExportSha256,
    evidence.postCutover.period.focusExportSha256,
  ]);
  for (const [windowName, window] of [
    ["baseline", evidence.baseline],
    ["postCutover", evidence.postCutover],
  ]) {
    for (const target of VERCEL_COST_TARGETS) {
      const attribution = window.targets[target].attribution;
      if (
        attribution.method === "provider-attributed" &&
        rawFocusExportDigests.has(attribution.evidenceSha256)
      ) {
        throw new Error(
          `${windowName}.targets.${target}.attribution.evidenceSha256 must differ from every raw FOCUS export digest`,
        );
      }
    }
  }
  for (const target of VERCEL_COST_TARGETS) {
    const baselineAttribution = evidence.baseline.targets[target].attribution;
    const postAttribution = evidence.postCutover.targets[target].attribution;
    if (
      baselineAttribution.method === "provider-attributed" &&
      postAttribution.method === "provider-attributed" &&
      baselineAttribution.evidenceSha256 === postAttribution.evidenceSha256
    ) {
      throw new Error(
        `baseline and postCutover provider attribution evidence must differ for ${target}`,
      );
    }
  }
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
    const targetLabel = `normalized.${metric}.targets.${target}`;
    let targetBaseline = 0;
    let targetCounterfactual = 0;
    let targetActual = 0;
    const paths = {};

    for (const path of MIGRATED_DEPLOYMENT_PATH_KEYS) {
      const baselineValue =
        evidence.baseline.targets[target].migratedUsageByPath[path][metric];
      const postValue =
        evidence.postCutover.targets[target].migratedUsageByPath[path][metric];
      const baselineEvents =
        evidence.baseline.targets[target].migratedDeploymentCensus[path]
          .eligibleEvents;
      const postEvents =
        evidence.postCutover.targets[target].migratedDeploymentCensus[path]
          .eligibleEvents;

      if (baselineValue === null || postValue === null) return null;
      targetBaseline = addFiniteDerived(
        targetBaseline,
        baselineValue,
        `${targetLabel}.baseline`,
      );
      targetActual = addFiniteDerived(
        targetActual,
        postValue,
        `${targetLabel}.actual`,
      );
      if (postEvents === 0) {
        paths[path] = {
          baseline: baselineValue,
          counterfactual: 0,
          actual: postValue,
          savings: null,
          observed: false,
        };
        continue;
      }
      if (baselineEvents === 0) {
        paths[path] = null;
        continue;
      }

      const pathLabel = `${targetLabel}.paths.${path}`;
      const baselinePerEvent = divideFiniteDerived(
        baselineValue,
        baselineEvents,
        `${pathLabel}.baselinePerEvent`,
      );
      const pathCounterfactual = multiplyFiniteDerived(
        postEvents,
        baselinePerEvent,
        `${pathLabel}.counterfactual`,
      );
      targetCounterfactual = addFiniteDerived(
        targetCounterfactual,
        pathCounterfactual,
        `${targetLabel}.counterfactual`,
      );
      paths[path] = {
        baseline: baselineValue,
        counterfactual: pathCounterfactual,
        actual: postValue,
        savings:
          pathCounterfactual === 0
            ? null
            : savingsFiniteDerived(
                postValue,
                pathCounterfactual,
                `${pathLabel}.savings`,
              ),
        observed: true,
      };
    }

    counterfactual = addFiniteDerived(
      counterfactual,
      targetCounterfactual,
      `normalized.${metric}.counterfactual`,
    );
    actual = addFiniteDerived(
      actual,
      targetActual,
      `normalized.${metric}.actual`,
    );
    targets[target] = {
      baseline: targetBaseline,
      counterfactual: targetCounterfactual,
      actual: targetActual,
      savings:
        targetCounterfactual === 0
          ? null
          : savingsFiniteDerived(
              targetActual,
              targetCounterfactual,
              `${targetLabel}.savings`,
            ),
      paths,
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
          : {
              savings: metric.targets[target].savings,
              paths: Object.fromEntries(
                MIGRATED_DEPLOYMENT_PATH_KEYS.map((path) => [
                  path,
                  metric.targets[target].paths[path] === null
                    ? null
                    : { savings: metric.targets[target].paths[path].savings },
                ]),
              ),
            },
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
  const baselineMigratedMinutes = VERCEL_COST_TARGETS.reduce(
    (total, target) =>
      addFiniteDerived(
        total,
        evidence.baseline.targets[target].migratedPath.buildCpuMinutes,
        "baseline.migratedPath.buildCpuMinutes.total",
      ),
    0,
  );
  const postCutoverMigratedMinutes = VERCEL_COST_TARGETS.reduce(
    (total, target) =>
      addFiniteDerived(
        total,
        evidence.postCutover.targets[target].migratedPath.buildCpuMinutes,
        "postCutover.migratedPath.buildCpuMinutes.total",
      ),
    0,
  );
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
  const postMainEligibleEvents = sumMigratedDeploymentCensus(
    evidence.postCutover,
    "main",
    "eligibleEvents",
    "postCutover.migratedDeploymentCensus",
  );

  const correctness = evidence.postCutover.correctness;
  const reasons = [];
  reason(
    postPeriod.days < MINIMUM_OBSERVATION_DAYS,
    `post-cutover-window-under-${MINIMUM_OBSERVATION_DAYS}-days`,
    reasons,
  );
  reason(
    evidence.postCutover.trustedDeployedCodePrPushes <
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
    for (const path of MIGRATED_DEPLOYMENT_PATH_KEYS) {
      const baselineEvents =
        evidence.baseline.targets[target].migratedDeploymentCensus[path]
          .eligibleEvents;
      const postEvents =
        evidence.postCutover.targets[target].migratedDeploymentCensus[path]
          .eligibleEvents;
      reason(
        postEvents > 0 && baselineEvents === 0,
        `missing-baseline-events:${target}:${path}`,
        reasons,
      );
      const pathMinutes = targetMinutes?.paths[path] ?? null;
      reason(
        postEvents > 0 &&
          (pathMinutes === null ||
            !Number.isFinite(pathMinutes.counterfactual) ||
            pathMinutes.counterfactual <= 0 ||
            pathMinutes.savings === null ||
            !Number.isFinite(pathMinutes.savings)),
        `minute-counterfactual-not-positive:${target}:${path}`,
        reasons,
      );
    }
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
    effectiveCost !== null &&
      Number.isFinite(effectiveCost.savings) &&
      isNegativeRegression(effectiveCost.savings),
    "normalized-effective-cost-regression",
    reasons,
  );
  reason(
    billedCost === null ||
      billedCost.savings === null ||
      !Number.isFinite(billedCost.savings),
    "normalized-billed-cost-unavailable",
    reasons,
  );
  reason(
    billedCost !== null &&
      Number.isFinite(billedCost.savings) &&
      isNegativeRegression(billedCost.savings),
    "normalized-billed-cost-regression",
    reasons,
  );
  for (const target of VERCEL_COST_TARGETS) {
    for (const path of MIGRATED_DEPLOYMENT_PATH_KEYS) {
      const effectivePath = effectiveCost?.targets[target]?.paths[path];
      const billedPath = billedCost?.targets[target]?.paths[path];
      reason(
        effectivePath !== null &&
          effectivePath !== undefined &&
          Number.isFinite(effectivePath.savings) &&
          isNegativeRegression(effectivePath.savings),
        `normalized-effective-cost-regression:${target}:${path}`,
        reasons,
      );
      reason(
        billedPath !== null &&
          billedPath !== undefined &&
          Number.isFinite(billedPath.savings) &&
          isNegativeRegression(billedPath.savings),
        `normalized-billed-cost-regression:${target}:${path}`,
        reasons,
      );
    }
  }
  reason(
    correctness.eligibleFirstPreviewOpportunities === 0,
    "eligible-first-preview-opportunities-missing",
    reasons,
  );
  reason(
    correctness.eligibleFirstPreviews !==
      correctness.eligibleFirstPreviewOpportunities,
    "eligible-first-preview-coverage-below-100-percent",
    reasons,
  );
  reason(
    correctness.smokeOrE2eCheckOpportunities === 0,
    "smoke-or-e2e-check-opportunities-missing",
    reasons,
  );
  reason(
    correctness.smokeOrE2eCheckOpportunities <
      evidence.postCutover.trustedDeployedCodePrPushes,
    "smoke-or-e2e-scope-below-trusted-pr-pushes",
    reasons,
  );
  reason(
    correctness.smokeOrE2eChecksCompleted !==
      correctness.smokeOrE2eCheckOpportunities,
    "smoke-or-e2e-check-coverage-incomplete",
    reasons,
  );
  reason(
    correctness.burstFirstPlusLatestCheckOpportunities === 0,
    "burst-first-plus-latest-check-opportunities-missing",
    reasons,
  );
  reason(
    correctness.burstFirstPlusLatestChecksCompleted !==
      correctness.burstFirstPlusLatestCheckOpportunities,
    "burst-first-plus-latest-check-coverage-incomplete",
    reasons,
  );
  reason(
    correctness.mainDeploymentObservationsCompleted !== postMainEligibleEvents,
    "main-deployment-observation-coverage-incomplete",
    reasons,
  );
  reason(
    correctness.legacyV2HealthCheckOpportunities === 0,
    "legacy-v2-health-check-opportunities-missing",
    reasons,
  );
  reason(
    correctness.legacyV2HealthChecksCompleted !==
      correctness.legacyV2HealthCheckOpportunities,
    "legacy-v2-health-check-coverage-incomplete",
    reasons,
  );
  for (const [key, reasonName] of [
    ["incorrectAffectedTargetSkips", "incorrect-affected-target-skips"],
    ["unexplainedNativeBuilds", "unexplained-native-builds"],
    ["smokeOrE2eRegressions", "smoke-or-e2e-regressions"],
    ["secretExposureIncidents", "secret-exposure-incidents"],
    ["burstFirstPlusLatestFailures", "burst-first-plus-latest-failures"],
    [
      "mainDeploymentObservationFailures",
      "main-deployment-observation-failures",
    ],
    ["legacyV2Regressions", "legacy-v2-regressions"],
  ]) {
    reason(correctness[key] !== 0, reasonName, reasons);
  }
  reason(
    !correctness.rollbackProcedureVerified,
    "rollback-procedure-not-verified",
    reasons,
  );
  const observationPass = reasons.length === 0;
  const closeoutComplete = CLOSEOUT_KEYS.every(
    (key) => evidence.closeout[key] === true,
  );
  reason(
    !closeoutComplete,
    "migration-cleanup-or-closeout-incomplete",
    reasons,
  );

  const prPushes = evidence.postCutover.trustedDeployedCodePrPushes;
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
    reportStage: closeoutComplete ? "final-closeout" : "observation-only",
    observationPass,
    closeoutPass: closeoutComplete,
    pass: observationPass && closeoutComplete,
    reasons,
    periods: {
      baseline: {
        startUtc: evidence.baseline.period.startUtc,
        endUtcExclusive: evidence.baseline.period.endUtcExclusive,
        billingIngestionComplete:
          evidence.baseline.period.billingIngestionComplete,
        invoiceFinal: evidence.baseline.period.invoiceFinal,
        consumedUnit: evidence.baseline.period.consumedUnit,
        billingCurrency: evidence.baseline.period.billingCurrency,
        days: baselinePeriod.days,
      },
      postCutover: {
        startUtc: evidence.postCutover.period.startUtc,
        endUtcExclusive: evidence.postCutover.period.endUtcExclusive,
        billingIngestionComplete:
          evidence.postCutover.period.billingIngestionComplete,
        invoiceFinal: evidence.postCutover.period.invoiceFinal,
        consumedUnit: evidence.postCutover.period.consumedUnit,
        billingCurrency: evidence.postCutover.period.billingCurrency,
        days: postPeriod.days,
      },
    },
    normalized: {
      minutes,
      effectiveCost: costSavingsOnly(effectiveCost),
      billedCost: costSavingsOnly(billedCost),
    },
    migrated: {
      baselineMinutes: baselineMigratedMinutes,
      postCutoverMinutes: postCutoverMigratedMinutes,
      targets: Object.fromEntries(
        VERCEL_COST_TARGETS.map((target) => [
          target,
          {
            baselineMinutes:
              evidence.baseline.targets[target].migratedPath.buildCpuMinutes,
            postCutoverMinutes:
              evidence.postCutover.targets[target].migratedPath.buildCpuMinutes,
          },
        ]),
      ),
    },
    gross: {
      baselineMinutes: baselineGrossMinutes,
      postCutoverMinutes: postGrossMinutes,
      baselineMinutesPerDay: baselineGrossMinutesPerDay,
      postCutoverMinutesPerDay: postGrossMinutesPerDay,
      minuteSavings: grossMinuteSavings,
      effectiveCostSavings: grossEffectiveCostSavings,
      billedCostSavings: grossBilledCostSavings,
      targets: Object.fromEntries(
        VERCEL_COST_TARGETS.map((target) => [
          target,
          {
            baselineMinutes:
              evidence.baseline.targets[target].grossProject.buildCpuMinutes,
            postCutoverMinutes:
              evidence.postCutover.targets[target].grossProject.buildCpuMinutes,
          },
        ]),
      ),
    },
    github: { ...evidence.postCutover.github },
    trustedDeployedCodePrPushes:
      evidence.postCutover.trustedDeployedCodePrPushes,
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
            migratedDeploymentCensus: Object.fromEntries(
              MIGRATED_DEPLOYMENT_PATH_KEYS.map((source) => [
                source,
                {
                  ...evidence.baseline.targets[target].migratedDeploymentCensus[
                    source
                  ],
                },
              ]),
            ),
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
            migratedDeploymentCensus: Object.fromEntries(
              MIGRATED_DEPLOYMENT_PATH_KEYS.map((source) => [
                source,
                {
                  ...evidence.postCutover.targets[target]
                    .migratedDeploymentCensus[source],
                },
              ]),
            ),
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
    mainDeploymentObservations: {
      completed: correctness.mainDeploymentObservationsCompleted,
      eligibleEvents: postMainEligibleEvents,
      failures: correctness.mainDeploymentObservationFailures,
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
    `Observation gate: **${analysis.observationPass ? "PASS" : "FAIL"}**`,
    `Cleanup/closeout gate: **${analysis.closeoutPass ? "PASS" : "FAIL"}**`,
    `Report stage: **${analysis.reportStage === "final-closeout" ? "FINAL CLOSEOUT" : "OBSERVATION ONLY"}**`,
    "",
    `- Baseline UTC window: ${analysis.periods.baseline.startUtc} to ${analysis.periods.baseline.endUtcExclusive} (${analysis.periods.baseline.days} complete days)`,
    `- Post-cutover UTC window: ${analysis.periods.postCutover.startUtc} to ${analysis.periods.postCutover.endUtcExclusive} (${analysis.periods.postCutover.days} complete days)`,
    `- Target-by-path normalized build-minute savings: ${formatPercent(analysis.normalized.minutes?.savings ?? null)}`,
    `- Target-by-path normalized EffectiveCost savings: ${formatPercent(analysis.normalized.effectiveCost?.savings ?? null)}`,
    `- Target-by-path normalized final BilledCost savings: ${formatPercent(analysis.normalized.billedCost?.savings ?? null)}`,
    `- Gross equal-window build-minute savings: ${formatPercent(analysis.gross.minuteSavings)}`,
    `- Gross equal-window EffectiveCost savings: ${formatPercent(analysis.gross.effectiveCostSavings)}`,
    `- Gross equal-window final BilledCost savings: ${formatPercent(analysis.gross.billedCostSavings)}`,
    `- Deployment attempts per eligible event: ${formatNumber(analysis.attemptsPerEligibleEvent.total)}`,
    `- Trusted deployed-code same-repository PR pushes: ${analysis.trustedDeployedCodePrPushes}`,
    `- Vercel build minutes per trusted deployed-code PR push: ${formatNumber(analysis.postCutoverMinutesPerTrustedPrPush.total)}`,
    `- GitHub standard-runner minutes: ${formatNumber(analysis.github.standardRunnerMinutes)}`,
    `- GitHub larger-runner minutes: ${formatNumber(analysis.github.largerRunnerMinutes)}`,
    `- GitHub artifact storage: ${formatNumber(analysis.github.artifactStorageGbHours)} GB-hours`,
    `- GitHub cache storage: ${formatNumber(analysis.github.cacheStorageGbHours)} GB-hours`,
    `- Eligible first previews: ${analysis.correctness.eligibleFirstPreviews}/${analysis.correctness.eligibleFirstPreviewOpportunities}`,
    `- Smoke/E2E checks completed: ${analysis.correctness.smokeOrE2eChecksCompleted}/${analysis.correctness.smokeOrE2eCheckOpportunities}`,
    `- Burst first-plus-latest checks completed: ${analysis.correctness.burstFirstPlusLatestChecksCompleted}/${analysis.correctness.burstFirstPlusLatestCheckOpportunities}`,
    `- Main deployment observations completed: ${analysis.mainDeploymentObservations.completed}/${analysis.mainDeploymentObservations.eligibleEvents}`,
    `- Legacy v2 health checks completed: ${analysis.correctness.legacyV2HealthChecksCompleted}/${analysis.correctness.legacyV2HealthCheckOpportunities}`,
    "",
    "| Target | Baseline migrated minutes | Baseline gross minutes | Post migrated minutes | Post gross minutes | Baseline-mix counterfactual | Migrated change | Post minutes / trusted push |",
    "|---|---:|---:|---:|---:|---:|---:|---:|",
  ];

  for (const target of VERCEL_COST_TARGETS) {
    const normalized = analysis.normalized.minutes?.targets[target] ?? null;
    const migrated = analysis.migrated.targets[target];
    const gross = analysis.gross.targets[target];
    lines.push(
      `| ${target} | ${formatNumber(migrated.baselineMinutes)} | ${formatNumber(gross.baselineMinutes)} | ${formatNumber(migrated.postCutoverMinutes)} | ${formatNumber(gross.postCutoverMinutes)} | ${formatNumber(normalized?.counterfactual ?? null)} | ${formatPercent(normalized?.savings ?? null)} | ${formatNumber(analysis.postCutoverMinutesPerTrustedPrPush.targets[target])} |`,
    );
  }

  lines.push(
    "",
    "Normalization cells are logical target x deployment path; an observed post cell without baseline evidence blocks closeout.",
    "",
    "| Target | Path | Baseline minutes | Post minutes | Baseline-mix counterfactual | Change |",
    "|---|---|---:|---:|---:|---:|",
  );
  for (const target of VERCEL_COST_TARGETS) {
    for (const path of MIGRATED_DEPLOYMENT_PATH_KEYS) {
      const normalized =
        analysis.normalized.minutes?.targets[target]?.paths[path] ?? null;
      lines.push(
        `| ${target} | ${path} | ${formatNumber(normalized?.baseline ?? null)} | ${formatNumber(normalized?.actual ?? null)} | ${formatNumber(normalized?.counterfactual ?? null)} | ${formatPercent(normalized?.savings ?? null)} |`,
      );
    }
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

  lines.push(
    "",
    "Source census cells are eligible events/deployment attempts/duplicate deployments.",
    "",
    "| Target | Baseline preview e/a/d | Baseline main e/a/d | Post preview e/a/d | Post main e/a/d |",
    "|---|---:|---:|---:|---:|",
  );
  for (const target of VERCEL_COST_TARGETS) {
    const census = analysis.eventCensus[target];
    const baselinePreview = census.baseline.migratedDeploymentCensus.preview;
    const baselineMain = census.baseline.migratedDeploymentCensus.main;
    const postPreview = census.postCutover.migratedDeploymentCensus.preview;
    const postMain = census.postCutover.migratedDeploymentCensus.main;
    const formatCensus = (value) =>
      `${value.eligibleEvents}/${value.deploymentAttempts}/${value.duplicateDeployments}`;
    lines.push(
      `| ${target} | ${formatCensus(baselinePreview)} | ${formatCensus(baselineMain)} | ${formatCensus(postPreview)} | ${formatCensus(postMain)} |`,
    );
  }

  if (analysis.sourceEvidence?.deployments !== undefined) {
    lines.push("", "## Deployment census anomalies", "");
    let anomalyCount = 0;
    for (const windowName of ["baseline", "postCutover"]) {
      for (const anomaly of analysis.sourceEvidence.deployments[windowName]
        .anomalies) {
        anomalyCount += 1;
        lines.push(
          `- ${windowName}: [${anomaly.deploymentId}](${anomaly.evidenceUrl}) — ${anomaly.target}/${anomaly.path}, ${anomaly.source}, ${anomaly.outcome}; ${anomaly.reasons.join(", ")}`,
        );
      }
    }
    if (anomalyCount === 0) lines.push("- None.");
  }

  if (analysis.reasons.length > 0) {
    lines.push("", "## Blocking evidence", "");
    for (const blockingReason of analysis.reasons) {
      lines.push(`- ${blockingReason}`);
    }
  }

  if (analysis.reportStage === "observation-only") {
    lines.push(
      "",
      "> Observation-only result: migration cleanup and final closeout verification are incomplete. Do not use this report to close #523 or #515.",
    );
  }

  lines.push(
    "",
    "> Absolute EffectiveCost and BilledCost values are intentionally omitted from this public-safe report.",
  );
  return `${lines.join("\n")}\n`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function parseJson(value, label) {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(
      `${label} must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function parseJsonLines(value, label) {
  const rows = [];
  for (const [index, line] of value.split(/\r?\n/).entries()) {
    if (line.trim().length === 0) continue;
    rows.push(parseJson(line, `${label} line ${index + 1}`));
  }
  return rows;
}

function assertDigest(value, label) {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    throw new Error(`${label} must be lowercase SHA-256`);
  }
  return value;
}

function assertExactNumber(actual, expected, label) {
  if (!numbersEqual(actual, expected)) {
    throw new Error(`${label} does not reconcile to the aggregate evidence`);
  }
}

function validateManifest(manifest) {
  assertExactKeys(manifest, MANIFEST_KEYS, "manifest");
  if (manifest.schemaVersion !== 1) {
    throw new Error("manifest.schemaVersion must be 1");
  }
  assertNonemptyString(manifest.aggregate, "manifest.aggregate");
  assertExactKeys(
    manifest.windows,
    ["baseline", "postCutover"],
    "manifest.windows",
  );
  for (const windowName of ["baseline", "postCutover"]) {
    const source = manifest.windows[windowName];
    const label = `manifest.windows.${windowName}`;
    assertExactKeys(source, MANIFEST_WINDOW_KEYS, label);
    for (const key of [
      "focusJsonl",
      "providerAttributionEvidence",
      "attributionJsonl",
      "deploymentCensusJsonl",
    ]) {
      assertNonemptyString(source[key], `${label}.${key}`);
    }
    assertDigest(
      source.providerAttributionSha256,
      `${label}.providerAttributionSha256`,
    );
    assertDigest(
      source.attributionJsonlSha256,
      `${label}.attributionJsonlSha256`,
    );
    assertDigest(
      source.deploymentCensusSha256,
      `${label}.deploymentCensusSha256`,
    );
    if (
      source.providerAttributionSha256 === source.attributionJsonlSha256 ||
      source.providerAttributionEvidence === source.attributionJsonl
    ) {
      throw new Error(
        `${label} must keep the provider artifact distinct from the derived attribution JSONL`,
      );
    }
    if (source.deploymentCensusComplete !== true) {
      throw new Error(
        `${label}.deploymentCensusComplete must be true after pagination/completeness verification`,
      );
    }
    assertExactKeys(
      source.focusProjectTags,
      VERCEL_COST_TARGETS,
      `${label}.focusProjectTags`,
    );
    const selectors = new Set();
    for (const target of VERCEL_COST_TARGETS) {
      const selector = source.focusProjectTags[target];
      assertExactKeys(
        selector,
        FOCUS_PROJECT_TAG_KEYS,
        `${label}.focusProjectTags.${target}`,
      );
      assertNonemptyString(
        selector.key,
        `${label}.focusProjectTags.${target}.key`,
      );
      assertNonemptyString(
        selector.value,
        `${label}.focusProjectTags.${target}.value`,
      );
      const serialized = `${selector.key}\0${selector.value}`;
      if (selectors.has(serialized)) {
        throw new Error(`${label}.focusProjectTags selectors must be unique`);
      }
      selectors.add(serialized);
    }
  }
  for (const target of VERCEL_COST_TARGETS) {
    const baseline = manifest.windows.baseline.focusProjectTags[target];
    const post = manifest.windows.postCutover.focusProjectTags[target];
    if (baseline.key !== post.key || baseline.value !== post.value) {
      throw new Error(
        `manifest focusProjectTags.${target} must identify the same Vercel project in both windows`,
      );
    }
  }
  return manifest;
}

function reconcileFocusJsonl(raw, source, aggregateWindow, label) {
  const actualDigest = sha256(raw);
  if (actualDigest !== aggregateWindow.period.focusExportSha256) {
    throw new Error(`${label} SHA-256 does not match the aggregate evidence`);
  }
  const rows = parseJsonLines(raw, label);
  const totals = Object.fromEntries(
    VERCEL_COST_TARGETS.map((target) => [
      target,
      { buildCpuMinutes: 0, effectiveCost: 0, billedCost: 0 },
    ]),
  );
  let inScopeChargeCount = 0;
  const periodStart = Date.parse(aggregateWindow.period.startUtc);
  const periodEnd = Date.parse(aggregateWindow.period.endUtcExclusive);

  for (const [index, row] of rows.entries()) {
    assertObject(row, `${label} row ${index + 1}`);
    if (row.ConsumedUnit !== FOCUS_UNIT) continue;
    const tags = assertObject(row.Tags, `${label} row ${index + 1}.Tags`);
    const matches = VERCEL_COST_TARGETS.filter((target) => {
      const selector = source.focusProjectTags[target];
      return tags[selector.key] === selector.value;
    });
    if (matches.length === 0) continue;
    if (matches.length !== 1) {
      throw new Error(`${label} row ${index + 1} matches multiple targets`);
    }
    if (row.ChargeCategory !== "Usage") {
      throw new Error(`${label} row ${index + 1}.ChargeCategory must be Usage`);
    }
    if (row.BillingCurrency !== BILLING_CURRENCY) {
      throw new Error(
        `${label} row ${index + 1}.BillingCurrency must be ${BILLING_CURRENCY}`,
      );
    }
    const chargeStart = parseCanonicalUtc(
      row.ChargePeriodStart,
      `${label} row ${index + 1}.ChargePeriodStart`,
    );
    const chargeEnd = parseCanonicalUtc(
      row.ChargePeriodEnd,
      `${label} row ${index + 1}.ChargePeriodEnd`,
    );
    if (
      !Number.isFinite(chargeStart) ||
      !Number.isFinite(chargeEnd) ||
      chargeStart < periodStart ||
      chargeEnd > periodEnd ||
      chargeEnd <= chargeStart
    ) {
      throw new Error(
        `${label} row ${index + 1} must fall inside the aggregate UTC interval`,
      );
    }
    const target = matches[0];
    const consumed = assertNonnegativeDecimal(
      row.ConsumedQuantity,
      `${label} row ${index + 1}.ConsumedQuantity`,
    );
    const effective = assertNonnegativeDecimal(
      row.EffectiveCost,
      `${label} row ${index + 1}.EffectiveCost`,
    );
    const billed =
      row.BilledCost === null
        ? null
        : assertNonnegativeDecimal(
            row.BilledCost,
            `${label} row ${index + 1}.BilledCost`,
          );
    if (aggregateWindow.period.invoiceFinal && billed === null) {
      throw new Error(
        `${label} row ${index + 1}.BilledCost is required after invoice finalization`,
      );
    }
    totals[target].buildCpuMinutes = addFiniteDerived(
      totals[target].buildCpuMinutes,
      consumed,
      `${label}.${target}.buildCpuMinutes`,
    );
    totals[target].effectiveCost = addFiniteDerived(
      totals[target].effectiveCost,
      effective,
      `${label}.${target}.effectiveCost`,
    );
    totals[target].billedCost =
      totals[target].billedCost === null || billed === null
        ? null
        : addFiniteDerived(
            totals[target].billedCost,
            billed,
            `${label}.${target}.billedCost`,
          );
    inScopeChargeCount += 1;
  }

  if (inScopeChargeCount !== aggregateWindow.period.focusChargeCount) {
    throw new Error(
      `${label} charge count does not reconcile to the aggregate evidence`,
    );
  }
  for (const target of VERCEL_COST_TARGETS) {
    for (const metric of GROSS_PROJECT_KEYS) {
      const actual = totals[target][metric];
      const expected = aggregateWindow.targets[target].grossProject[metric];
      if (actual === null || expected === null) {
        if (actual !== expected) {
          throw new Error(
            `${label}.${target}.${metric} does not reconcile to the aggregate evidence`,
          );
        }
      } else {
        assertExactNumber(actual, expected, `${label}.${target}.${metric}`);
      }
    }
  }
}

const ATTRIBUTION_ROW_KEYS = [
  "target",
  "path",
  "buildCpuMinutes",
  "effectiveCost",
  "billedCost",
];

function reconcileAttributionJsonl(
  raw,
  providerEvidence,
  source,
  aggregateWindow,
  label,
) {
  if (sha256(raw) !== source.attributionJsonlSha256) {
    throw new Error(`${label} SHA-256 does not match the manifest`);
  }
  if (sha256(providerEvidence) !== source.providerAttributionSha256) {
    throw new Error(
      `${label} provider artifact SHA-256 does not match the manifest`,
    );
  }
  const rows = parseJsonLines(raw, label);
  const cells = new Map();
  for (const [index, row] of rows.entries()) {
    assertExactKeys(row, ATTRIBUTION_ROW_KEYS, `${label} row ${index + 1}`);
    if (!VERCEL_COST_TARGETS.includes(row.target)) {
      throw new Error(`${label} row ${index + 1}.target is unsupported`);
    }
    if (!MIGRATED_DEPLOYMENT_PATH_KEYS.includes(row.path)) {
      throw new Error(`${label} row ${index + 1}.path must be preview or main`);
    }
    for (const metric of ["buildCpuMinutes", "effectiveCost"]) {
      assertNonnegativeNumber(
        row[metric],
        `${label} row ${index + 1}.${metric}`,
      );
    }
    assertNullableCost(row.billedCost, `${label} row ${index + 1}.billedCost`);
    if (aggregateWindow.period.invoiceFinal && row.billedCost === null) {
      throw new Error(
        `${label} row ${index + 1}.billedCost is required after invoice finalization`,
      );
    }
    const key = `${row.target}:${row.path}`;
    if (cells.has(key))
      throw new Error(`${label} contains duplicate cell ${key}`);
    cells.set(key, row);
  }

  for (const target of VERCEL_COST_TARGETS) {
    const aggregateTarget = aggregateWindow.targets[target];
    if (aggregateTarget.attribution.method === "provider-attributed") {
      if (
        aggregateTarget.attribution.evidenceSha256 !==
        source.providerAttributionSha256
      ) {
        throw new Error(
          `${label} provider artifact SHA-256 does not match provider attribution for ${target}`,
        );
      }
      for (const path of MIGRATED_DEPLOYMENT_PATH_KEYS) {
        const row = cells.get(`${target}:${path}`);
        if (row === undefined) {
          throw new Error(
            `${label} is missing provider cell ${target}:${path}`,
          );
        }
        for (const metric of MIGRATED_USAGE_KEYS) {
          const actual = row[metric];
          const expected = aggregateTarget.migratedUsageByPath[path][metric];
          if (actual === null || expected === null) {
            if (actual !== expected) {
              throw new Error(
                `${label}.${target}.${path}.${metric} does not reconcile to the aggregate evidence`,
              );
            }
          } else {
            assertExactNumber(
              actual,
              expected,
              `${label}.${target}.${path}.${metric}`,
            );
          }
        }
        cells.delete(`${target}:${path}`);
      }
    }
  }
  if (cells.size > 0) {
    throw new Error(
      `${label} contains cells without provider-attributed aggregate ownership: ${[...cells.keys()].join(", ")}`,
    );
  }
}

function emptyDeploymentSummary() {
  return {
    paths: Object.fromEntries(DEPLOYMENT_PATHS.map((value) => [value, 0])),
    sources: Object.fromEntries(DEPLOYMENT_SOURCES.map((value) => [value, 0])),
    outcomes: Object.fromEntries(
      DEPLOYMENT_OUTCOMES.map((value) => [value, 0]),
    ),
  };
}

function reconcileDeploymentCensusJsonl(
  raw,
  source,
  aggregateWindow,
  windowName,
  label,
) {
  if (sha256(raw) !== source.deploymentCensusSha256) {
    throw new Error(`${label} SHA-256 does not match the manifest`);
  }
  const rows = parseJsonLines(raw, label);
  const deploymentIds = new Set();
  const summaries = Object.fromEntries(
    VERCEL_COST_TARGETS.map((target) => [target, emptyDeploymentSummary()]),
  );
  const pathAttempts = Object.fromEntries(
    VERCEL_COST_TARGETS.map((target) => [target, { preview: 0, main: 0 }]),
  );
  const eventKeys = Object.fromEntries(
    VERCEL_COST_TARGETS.map((target) => [
      target,
      { preview: new Set(), main: new Set() },
    ]),
  );
  const readyByEvent = new Map();
  const excluded = Object.fromEntries(
    VERCEL_COST_TARGETS.map((target) => [
      target,
      {
        legacyV2DeploymentAttempts: 0,
        manualDeploymentAttempts: 0,
        unknownDeploymentAttempts: 0,
      },
    ]),
  );
  const anomalyReasons = new Map();
  let unexplainedNativeBuilds = 0;
  const periodStart = Date.parse(aggregateWindow.period.startUtc);
  const periodEnd = Date.parse(aggregateWindow.period.endUtcExclusive);

  for (const [index, row] of rows.entries()) {
    const rowLabel = `${label} row ${index + 1}`;
    assertExactKeys(row, DEPLOYMENT_ROW_KEYS, rowLabel);
    assertNonemptyString(row.deploymentId, `${rowLabel}.deploymentId`);
    if (!VERCEL_DEPLOYMENT_ID_PATTERN.test(row.deploymentId)) {
      throw new Error(
        `${rowLabel}.deploymentId must be a Vercel deployment ID`,
      );
    }
    if (deploymentIds.has(row.deploymentId)) {
      throw new Error(
        `${label} contains duplicate deploymentId ${row.deploymentId}`,
      );
    }
    deploymentIds.add(row.deploymentId);
    if (!VERCEL_COST_TARGETS.includes(row.target)) {
      throw new Error(`${rowLabel}.target is unsupported`);
    }
    if (!DEPLOYMENT_PATHS.includes(row.path)) {
      throw new Error(`${rowLabel}.path is unsupported`);
    }
    if (!DEPLOYMENT_SOURCES.includes(row.source)) {
      throw new Error(`${rowLabel}.source is unsupported`);
    }
    if (!DEPLOYMENT_OUTCOMES.includes(row.outcome)) {
      throw new Error(`${rowLabel}.outcome is unsupported`);
    }
    assertHttpsUrl(row.evidenceUrl, `${rowLabel}.evidenceUrl`);
    const createdAt = Date.parse(row.createdAtUtc);
    if (
      typeof row.createdAtUtc !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(row.createdAtUtc) ||
      !Number.isFinite(createdAt) ||
      new Date(createdAt).toISOString() !== row.createdAtUtc ||
      createdAt < periodStart ||
      createdAt >= periodEnd
    ) {
      throw new Error(
        `${rowLabel}.createdAtUtc must fall inside the census UTC interval`,
      );
    }

    const migratedPath = MIGRATED_DEPLOYMENT_PATH_KEYS.includes(row.path);
    const migrated =
      migratedPath &&
      ["github-actions-prebuilt", "vercel-native"].includes(row.source);
    if (migrated || row.path === "legacy-v2") {
      if (
        typeof row.sourceSha !== "string" ||
        !GIT_SHA_PATTERN.test(row.sourceSha)
      ) {
        throw new Error(
          `${rowLabel}.sourceSha must be a lowercase 40-character Git SHA`,
        );
      }
    } else if (row.sourceSha !== null) {
      throw new Error(
        `${rowLabel}.sourceSha must be null for manual or unknown activity`,
      );
    }
    if (
      row.path === "legacy-v2" &&
      (row.target !== "app" || row.source !== "vercel-native")
    ) {
      throw new Error(
        `${rowLabel} legacy-v2 must be an app vercel-native deployment`,
      );
    }

    const summary = summaries[row.target];
    summary.paths[row.path] += 1;
    summary.sources[row.source] += 1;
    summary.outcomes[row.outcome] += 1;
    const reasons = [];
    if (row.outcome !== "ready") reasons.push(`outcome:${row.outcome}`);

    if (migrated) {
      pathAttempts[row.target][row.path] += 1;
      const eventKey = `${row.target}:${row.path}:${row.sourceSha}`;
      eventKeys[row.target][row.path].add(eventKey);
      if (row.outcome === "ready") {
        const readyRows = readyByEvent.get(eventKey) ?? [];
        readyRows.push(row);
        readyByEvent.set(eventKey, readyRows);
      }
      if (windowName === "postCutover" && row.source === "vercel-native") {
        unexplainedNativeBuilds += 1;
        reasons.push("unexplained-native-build");
      }
    } else if (row.path === "legacy-v2") {
      excluded[row.target].legacyV2DeploymentAttempts += 1;
    } else if (row.source === "manual") {
      excluded[row.target].manualDeploymentAttempts += 1;
      reasons.push("manual-deployment");
    } else {
      excluded[row.target].unknownDeploymentAttempts += 1;
      reasons.push("unknown-deployment");
    }
    if (reasons.length > 0) anomalyReasons.set(row.deploymentId, reasons);
  }

  const duplicates = Object.fromEntries(
    VERCEL_COST_TARGETS.map((target) => [target, { preview: 0, main: 0 }]),
  );
  for (const readyRows of readyByEvent.values()) {
    for (const row of readyRows.slice(1)) {
      duplicates[row.target][row.path] += 1;
      const reasons = anomalyReasons.get(row.deploymentId) ?? [];
      reasons.push("duplicate-ready-deployment");
      anomalyReasons.set(row.deploymentId, reasons);
    }
  }

  for (const target of VERCEL_COST_TARGETS) {
    const expectedTarget = aggregateWindow.targets[target];
    for (const path of MIGRATED_DEPLOYMENT_PATH_KEYS) {
      const expected = expectedTarget.migratedDeploymentCensus[path];
      const actual = {
        eligibleEvents: eventKeys[target][path].size,
        deploymentAttempts: pathAttempts[target][path],
        duplicateDeployments: duplicates[target][path],
      };
      for (const metric of MIGRATED_DEPLOYMENT_CENSUS_KEYS) {
        if (actual[metric] !== expected[metric]) {
          throw new Error(
            `${label}.${target}.${path}.${metric} does not reconcile to the aggregate evidence`,
          );
        }
      }
    }
    for (const key of EXCLUDED_KEYS) {
      if (excluded[target][key] !== expectedTarget.excluded[key]) {
        throw new Error(
          `${label}.${target}.${key} does not reconcile to the aggregate evidence`,
        );
      }
    }
  }
  if (
    windowName === "postCutover" &&
    unexplainedNativeBuilds !==
      aggregateWindow.correctness.unexplainedNativeBuilds
  ) {
    throw new Error(
      `${label}.unexplainedNativeBuilds does not reconcile to the correctness ledger`,
    );
  }

  const rowsById = new Map(rows.map((row) => [row.deploymentId, row]));
  return {
    targets: summaries,
    anomalies: [...anomalyReasons.entries()].map(([deploymentId, reasons]) => {
      const row = rowsById.get(deploymentId);
      return {
        deploymentId,
        target: row.target,
        path: row.path,
        source: row.source,
        outcome: row.outcome,
        evidenceUrl: row.evidenceUrl,
        reasons,
      };
    }),
  };
}

export function analyzeVercelCostManifest(inputPath) {
  const manifestPath = resolve(inputPath);
  const manifestDirectory = dirname(manifestPath);
  const manifest = validateManifest(
    parseJson(readFileSync(manifestPath, "utf8"), "manifest"),
  );
  const evidence = parseJson(
    readFileSync(resolve(manifestDirectory, manifest.aggregate), "utf8"),
    "aggregate evidence",
  );
  validateVercelCostEvidence(evidence);
  const deploymentEvidence = {};
  for (const windowName of ["baseline", "postCutover"]) {
    const source = manifest.windows[windowName];
    const aggregateWindow = evidence[windowName];
    reconcileFocusJsonl(
      readFileSync(resolve(manifestDirectory, source.focusJsonl), "utf8"),
      source,
      aggregateWindow,
      `${windowName} FOCUS JSONL`,
    );
    reconcileAttributionJsonl(
      readFileSync(resolve(manifestDirectory, source.attributionJsonl), "utf8"),
      readFileSync(
        resolve(manifestDirectory, source.providerAttributionEvidence),
        "utf8",
      ),
      source,
      aggregateWindow,
      `${windowName} provider attribution JSONL`,
    );
    deploymentEvidence[windowName] = reconcileDeploymentCensusJsonl(
      readFileSync(
        resolve(manifestDirectory, source.deploymentCensusJsonl),
        "utf8",
      ),
      source,
      aggregateWindow,
      windowName,
      `${windowName} deployment census JSONL`,
    );
  }
  return {
    ...analyzeVercelCostEvidence(evidence),
    sourceEvidence: {
      rawFocusReconciled: true,
      providerArtifactBound: true,
      derivedAttributionReconciled: true,
      deploymentCensusComplete: true,
      deployments: deploymentEvidence,
    },
  };
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--") || index + 1 >= argv.length) {
      throw new Error(
        "Usage: vercel-cost-analysis.mjs --input <evidence-manifest.json> [--format json|markdown]",
      );
    }
    const key = argument.slice(2);
    if (!["input", "format"].includes(key)) {
      throw new Error(
        "Usage: vercel-cost-analysis.mjs --input <evidence-manifest.json> [--format json|markdown]",
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
      "Usage: vercel-cost-analysis.mjs --input <evidence-manifest.json> [--format json|markdown]",
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
    const analysis = analyzeVercelCostManifest(options.input);
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
