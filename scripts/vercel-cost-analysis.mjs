#!/usr/bin/env node

import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { normalizeVercelDeploymentPages } from "./vercel-cost-deployment-census.mjs";
import { validateGitHubActionsCostProof } from "./vercel-cost-github-actions.mjs";

export const VERCEL_COST_SCHEMA_VERSION = 4;
export const VERCEL_COST_TARGETS = ["app", "governance", "reserve", "ui"];
export const MINIMUM_OBSERVATION_DAYS = 7;
export const MINIMUM_TRUSTED_PR_PUSHES = 10;
export const MINIMUM_NORMALIZED_SAVINGS = 0.9;

const DAY_MILLISECONDS = 24 * 60 * 60 * 1_000;
const FOCUS_SERVICE_NAME = "Build CPU Minutes";
const FOCUS_UNIT = "minute";
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
  "serviceName",
  "consumedUnit",
  "billingCurrency",
];
const OBSERVATION_PERIOD_KEYS = ["startUtc", "endUtcExclusive"];
const MIGRATED_PATH_KEYS = [
  "buildCpuMinutes",
  "effectiveCost",
  "billedCost",
  "eligibleEvents",
  "deploymentAttempts",
  "duplicateDeployments",
];
const GROSS_PROJECT_KEYS = ["buildCpuMinutes", "effectiveCost", "billedCost"];
const COST_EXCLUDED_KEYS = [
  "legacyV2DeploymentAttempts",
  "manualDeploymentAttempts",
  "unknownDeploymentAttempts",
];
const EXCLUDED_KEYS = [
  ...COST_EXCLUDED_KEYS,
  "suppressedNativeDeploymentAttempts",
];
const ATTRIBUTION_KEYS = ["method", "evidenceSha256"];
const ATTRIBUTION_METHOD = "project-total-no-exclusions";
const MIGRATED_DEPLOYMENT_PATH_KEYS = ["preview", "main"];
const MIGRATED_DEPLOYMENT_CENSUS_KEYS = [
  "eligibleEvents",
  "deploymentAttempts",
  "duplicateDeployments",
];
const TARGET_KEYS = [
  "migratedPath",
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
const MANIFEST_KEYS = [
  "schemaVersion",
  "aggregate",
  "githubActionsEvidence",
  "windows",
];
const GITHUB_ACTIONS_EVIDENCE_KEYS = ["proof", "proofSha256"];
const MANIFEST_WINDOW_KEYS = [
  "focusJsonl",
  "deploymentPagesJson",
  "deploymentPagesSha256",
  "deploymentCensusJsonl",
  "deploymentCensusSha256",
  "deploymentCensusProof",
  "deploymentCensusProofSha256",
  "focusProjectTags",
];
const FOCUS_PROJECT_TAG_KEYS = ["key", "value"];
const DEPLOYMENT_PATHS = ["preview", "main", "legacy-v2", "unknown"];
const DEPLOYMENT_SOURCES = [
  "github-actions-prebuilt",
  "vercel-native",
  "vercel-native-suppressed",
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
  "mainDeploymentObservationOpportunities",
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

function assertPublicEvidenceUrl(value, label) {
  assertNonemptyString(value, label);
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be a public evidence URL`);
  }
  const githubEvidence =
    parsed.hostname === "github.com" &&
    /^\/mento-protocol\/frontend-monorepo\/(?:actions\/runs\/\d+(?:\/job\/\d+)?|runs\/\d+|deployments\/\d+)\/?$/.test(
      parsed.pathname,
    );
  const vercelDeployment =
    parsed.hostname.endsWith(".vercel.app") &&
    parsed.hostname.length > ".vercel.app".length &&
    parsed.pathname === "/";
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.port !== "" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    (!githubEvidence && !vercelDeployment)
  ) {
    throw new Error(
      `${label} must be a public GitHub run/deployment or root *.vercel.app URL without credentials, query, or fragment`,
    );
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

function exceedsWithTolerance(actual, counterfactual) {
  const scale = Math.max(1, Math.abs(actual), Math.abs(counterfactual));
  return actual - counterfactual > Number.EPSILON * scale * 16;
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

function parseCostBoundary(value, label) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/.test(value)
  ) {
    throw new Error(`${label} must be an exact UTC boundary`);
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
  const startMilliseconds = parseCostBoundary(
    period.startUtc,
    `${label}.startUtc`,
  );
  const endMilliseconds = parseCostBoundary(
    period.endUtcExclusive,
    `${label}.endUtcExclusive`,
  );
  if (endMilliseconds <= startMilliseconds) {
    throw new Error(`${label} must have a positive UTC interval`);
  }
  const days = (endMilliseconds - startMilliseconds) / DAY_MILLISECONDS;
  if (!Number.isSafeInteger(days)) {
    throw new Error(`${label} must contain complete 24-hour periods`);
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
  if (period.serviceName !== FOCUS_SERVICE_NAME) {
    throw new Error(`${label}.serviceName must be ${FOCUS_SERVICE_NAME}`);
  }
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
  assertExactKeys(
    target.migratedDeploymentCensus,
    MIGRATED_DEPLOYMENT_PATH_KEYS,
    `${label}.migratedDeploymentCensus`,
  );
  for (const source of MIGRATED_DEPLOYMENT_PATH_KEYS) {
    assertExactKeys(
      target.migratedDeploymentCensus[source],
      MIGRATED_DEPLOYMENT_CENSUS_KEYS,
      `${label}.migratedDeploymentCensus.${source}`,
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
  for (const key of EXCLUDED_KEYS) {
    assertNonnegativeInteger(target.excluded[key], `${label}.excluded.${key}`);
  }
  if (
    targetName !== "app" &&
    target.excluded.legacyV2DeploymentAttempts !== 0
  ) {
    throw new Error(`${label} cannot classify legacy app v2 activity`);
  }

  const excludedAttempts = COST_EXCLUDED_KEYS.reduce(
    (total, key) =>
      addSafeCount(
        total,
        target.excluded[key],
        `${label}.excluded.totalAttempts`,
      ),
    0,
  );
  const { method, evidenceSha256 } = target.attribution;
  if (method !== ATTRIBUTION_METHOD) {
    throw new Error(
      `${label}.attribution.method must be ${ATTRIBUTION_METHOD}`,
    );
  }
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
    const migratedValue = migrated[key];
    const grossValue = gross[key];
    if (migratedValue !== grossValue) {
      throw new Error(
        `${label}.migratedPath.${key} must equal grossProject.${key} for a clean project total`,
      );
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

function validateObservationPeriod(period, label) {
  assertExactKeys(period, OBSERVATION_PERIOD_KEYS, label);
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
  return { startMilliseconds, endMilliseconds, days };
}

function validateWindow(window, label) {
  const requiredKeys =
    label === "postCutover"
      ? [
          "period",
          "observationPeriod",
          "targets",
          "costWindowTrustedDeployedCodePrPushes",
          "trustedDeployedCodePrPushes",
          "github",
          "correctness",
        ]
      : ["period", "targets"];
  assertExactKeys(window, requiredKeys, label);
  const period = validatePeriod(window.period, `${label}.period`);
  const observationPeriod =
    label === "postCutover"
      ? validateObservationPeriod(
          window.observationPeriod,
          `${label}.observationPeriod`,
        )
      : null;
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
      window.costWindowTrustedDeployedCodePrPushes,
      `${label}.costWindowTrustedDeployedCodePrPushes`,
    );
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
    validateObservationCoverage(
      window.correctness,
      "smokeOrE2eChecksCompleted",
      "smokeOrE2eCheckOpportunities",
      "smokeOrE2eRegressions",
      `${label}.correctness`,
    );
    validateObservationCoverage(
      window.correctness,
      "mainDeploymentObservationsCompleted",
      "mainDeploymentObservationOpportunities",
      "mainDeploymentObservationFailures",
      `${label}.correctness`,
    );
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
  return { ...period, observationPeriod };
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
  if (baselinePeriod.endMilliseconds > cutoverMilliseconds) {
    throw new Error("baseline period extends beyond the completed cutover");
  }
  if (postPeriod.startMilliseconds < cutoverMilliseconds) {
    throw new Error("postCutover period starts before the completed cutover");
  }
  if (postPeriod.observationPeriod.startMilliseconds < cutoverMilliseconds) {
    throw new Error(
      "postCutover observationPeriod starts before the completed cutover",
    );
  }
  return { baselinePeriod, postPeriod };
}

function normalizedMetric(evidence, metric) {
  let counterfactual = 0;
  let actual = 0;
  const targets = {};

  for (const target of VERCEL_COST_TARGETS) {
    const targetLabel = `normalized.${metric}.targets.${target}`;
    const targetBaseline =
      evidence.baseline.targets[target].migratedPath[metric];
    const targetActual =
      evidence.postCutover.targets[target].migratedPath[metric];
    const baselineEvents =
      evidence.baseline.targets[target].migratedPath.eligibleEvents;
    const postEvents =
      evidence.postCutover.targets[target].migratedPath.eligibleEvents;

    if (targetBaseline === null || targetActual === null) return null;
    const targetCounterfactual =
      baselineEvents === 0
        ? 0
        : multiplyFiniteDerived(
            postEvents,
            divideFiniteDerived(
              targetBaseline,
              baselineEvents,
              `${targetLabel}.baselinePerEvent`,
            ),
            `${targetLabel}.counterfactual`,
          );

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
  const correctness = evidence.postCutover.correctness;
  const reasons = [];
  reason(
    postPeriod.observationPeriod.days < MINIMUM_OBSERVATION_DAYS,
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
    const targetEffectiveCost = effectiveCost?.targets[target];
    const targetBilledCost = billedCost?.targets[target];
    reason(
      targetEffectiveCost !== null &&
        targetEffectiveCost !== undefined &&
        exceedsWithTolerance(
          targetEffectiveCost.actual,
          targetEffectiveCost.counterfactual,
        ),
      `normalized-effective-cost-regression:${target}`,
      reasons,
    );
    reason(
      targetBilledCost !== null &&
        targetBilledCost !== undefined &&
        exceedsWithTolerance(
          targetBilledCost.actual,
          targetBilledCost.counterfactual,
        ),
      `normalized-billed-cost-regression:${target}`,
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
    correctness.mainDeploymentObservationsCompleted !==
      correctness.mainDeploymentObservationOpportunities,
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
  const costWindowPrPushes =
    evidence.postCutover.costWindowTrustedDeployedCodePrPushes;
  reason(
    costWindowPrPushes === 0,
    "cost-window-trusted-deployed-code-pr-pushes-missing",
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

  const totalAttemptsPerEligibleEvent =
    totalPostEvents === 0
      ? null
      : divideFiniteDerived(
          totalPostAttempts,
          totalPostEvents,
          "postCutover.attemptsPerEligibleEvent.total",
        );
  const totalMinutesPerTrustedPrPush =
    costWindowPrPushes === 0
      ? null
      : divideFiniteDerived(
          postCutoverMigratedMinutes,
          costWindowPrPushes,
          "postCutover.buildCpuMinutesPerTrustedPrPush.total",
        );
  const targetMinutesPerTrustedPrPush = Object.fromEntries(
    VERCEL_COST_TARGETS.map((target) => [
      target,
      costWindowPrPushes === 0
        ? null
        : divideFiniteDerived(
            evidence.postCutover.targets[target].migratedPath.buildCpuMinutes,
            costWindowPrPushes,
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
        serviceName: evidence.baseline.period.serviceName,
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
        serviceName: evidence.postCutover.period.serviceName,
        consumedUnit: evidence.postCutover.period.consumedUnit,
        billingCurrency: evidence.postCutover.period.billingCurrency,
        days: postPeriod.days,
      },
      observation: {
        startUtc: evidence.postCutover.observationPeriod.startUtc,
        endUtcExclusive: evidence.postCutover.observationPeriod.endUtcExclusive,
        days: postPeriod.observationPeriod.days,
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
    costWindowTrustedDeployedCodePrPushes:
      evidence.postCutover.costWindowTrustedDeployedCodePrPushes,
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
    postCutoverMinutesPerCostWindowTrustedPrPush: {
      total: totalMinutesPerTrustedPrPush,
      targets: targetMinutesPerTrustedPrPush,
    },
    mainDeploymentObservations: {
      completed: correctness.mainDeploymentObservationsCompleted,
      opportunities: correctness.mainDeploymentObservationOpportunities,
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
    `- Baseline Vercel cost window: ${analysis.periods.baseline.startUtc} to ${analysis.periods.baseline.endUtcExclusive} (${analysis.periods.baseline.days} complete 24-hour periods)`,
    `- Post-cutover Vercel cost window: ${analysis.periods.postCutover.startUtc} to ${analysis.periods.postCutover.endUtcExclusive} (${analysis.periods.postCutover.days} complete 24-hour periods)`,
    `- Correctness and GitHub observation window: ${analysis.periods.observation.startUtc} to ${analysis.periods.observation.endUtcExclusive} (${analysis.periods.observation.days} complete UTC days)`,
    `- Target-mix normalized build-minute savings: ${formatPercent(analysis.normalized.minutes?.savings ?? null)}`,
    `- Target-mix normalized EffectiveCost savings: ${formatPercent(analysis.normalized.effectiveCost?.savings ?? null)}`,
    `- Target-mix normalized final BilledCost savings: ${formatPercent(analysis.normalized.billedCost?.savings ?? null)}`,
    `- Gross equal-window build-minute savings: ${formatPercent(analysis.gross.minuteSavings)}`,
    `- Gross equal-window EffectiveCost savings: ${formatPercent(analysis.gross.effectiveCostSavings)}`,
    `- Gross equal-window final BilledCost savings: ${formatPercent(analysis.gross.billedCostSavings)}`,
    `- Deployment attempts per eligible event: ${formatNumber(analysis.attemptsPerEligibleEvent.total)}`,
    `- Correctness-window trusted deployed-code same-repository PR pushes: ${analysis.trustedDeployedCodePrPushes}`,
    `- Cost-window trusted deployed-code same-repository PR pushes: ${analysis.costWindowTrustedDeployedCodePrPushes}`,
    `- Vercel build minutes per cost-window trusted deployed-code PR push: ${formatNumber(analysis.postCutoverMinutesPerCostWindowTrustedPrPush.total)}`,
    `- GitHub standard-runner minutes: ${formatNumber(analysis.github.standardRunnerMinutes)}`,
    `- GitHub larger-runner minutes: ${formatNumber(analysis.github.largerRunnerMinutes)}`,
    `- GitHub artifact storage: ${formatNumber(analysis.github.artifactStorageGbHours)} GB-hours`,
    `- GitHub cache storage: ${formatNumber(analysis.github.cacheStorageGbHours)} GB-hours`,
    `- Eligible first previews: ${analysis.correctness.eligibleFirstPreviews}/${analysis.correctness.eligibleFirstPreviewOpportunities}`,
    `- Smoke/E2E checks completed: ${analysis.correctness.smokeOrE2eChecksCompleted}/${analysis.correctness.smokeOrE2eCheckOpportunities}`,
    `- Burst first-plus-latest checks completed: ${analysis.correctness.burstFirstPlusLatestChecksCompleted}/${analysis.correctness.burstFirstPlusLatestCheckOpportunities}`,
    `- Main deployment observations completed: ${analysis.mainDeploymentObservations.completed}/${analysis.mainDeploymentObservations.opportunities}`,
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
      `| ${target} | ${formatNumber(migrated.baselineMinutes)} | ${formatNumber(gross.baselineMinutes)} | ${formatNumber(migrated.postCutoverMinutes)} | ${formatNumber(gross.postCutoverMinutes)} | ${formatNumber(normalized?.counterfactual ?? null)} | ${formatPercent(normalized?.savings ?? null)} | ${formatNumber(analysis.postCutoverMinutesPerCostWindowTrustedPrPush.targets[target])} |`,
    );
  }

  lines.push(
    "",
    "| Target | Baseline events/attempts | Post events/attempts | Post duplicates | Post suppressed native | Post legacy v2 | Post manual | Post unknown | Attribution |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---|",
  );
  for (const target of VERCEL_COST_TARGETS) {
    const census = analysis.eventCensus[target];
    lines.push(
      `| ${target} | ${census.baseline.eligibleEvents}/${census.baseline.deploymentAttempts} | ${census.postCutover.eligibleEvents}/${census.postCutover.deploymentAttempts} | ${census.postCutover.duplicateDeployments} | ${census.postCutover.excluded.suppressedNativeDeploymentAttempts} | ${census.postCutover.excluded.legacyV2DeploymentAttempts} | ${census.postCutover.excluded.manualDeploymentAttempts} | ${census.postCutover.excluded.unknownDeploymentAttempts} | ${census.postCutover.attributionMethod} |`,
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
  if (manifest.schemaVersion !== 3) {
    throw new Error("manifest.schemaVersion must be 3");
  }
  assertNonemptyString(manifest.aggregate, "manifest.aggregate");
  assertExactKeys(
    manifest.githubActionsEvidence,
    GITHUB_ACTIONS_EVIDENCE_KEYS,
    "manifest.githubActionsEvidence",
  );
  assertNonemptyString(
    manifest.githubActionsEvidence.proof,
    "manifest.githubActionsEvidence.proof",
  );
  assertDigest(
    manifest.githubActionsEvidence.proofSha256,
    "manifest.githubActionsEvidence.proofSha256",
  );
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
      "deploymentPagesJson",
      "deploymentCensusJsonl",
      "deploymentCensusProof",
    ]) {
      assertNonemptyString(source[key], `${label}.${key}`);
    }
    for (const key of [
      "deploymentPagesSha256",
      "deploymentCensusSha256",
      "deploymentCensusProofSha256",
    ]) {
      assertDigest(source[key], `${label}.${key}`);
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
    if (row.ServiceName !== FOCUS_SERVICE_NAME) continue;
    if (row.ChargeCategory !== "Usage") continue;
    const tags = assertObject(row.Tags, `${label} row ${index + 1}.Tags`);
    const matches = VERCEL_COST_TARGETS.filter((target) => {
      const selector = source.focusProjectTags[target];
      return tags[selector.key] === selector.value;
    });
    if (matches.length === 0) continue;
    if (matches.length !== 1) {
      throw new Error(`${label} row ${index + 1} matches multiple targets`);
    }
    if (row.ConsumedUnit !== FOCUS_UNIT) {
      throw new Error(
        `${label} row ${index + 1}.ConsumedUnit must be ${FOCUS_UNIT}`,
      );
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
  const trustedPreviewShas = new Set();
  const excluded = Object.fromEntries(
    VERCEL_COST_TARGETS.map((target) => [
      target,
      {
        legacyV2DeploymentAttempts: 0,
        manualDeploymentAttempts: 0,
        unknownDeploymentAttempts: 0,
        suppressedNativeDeploymentAttempts: 0,
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
    assertPublicEvidenceUrl(row.evidenceUrl, `${rowLabel}.evidenceUrl`);
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
    const suppressed =
      migratedPath && row.source === "vercel-native-suppressed";
    if (migrated || suppressed || row.path === "legacy-v2") {
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
      if (
        windowName === "postCutover" &&
        row.path === "preview" &&
        row.source === "github-actions-prebuilt"
      ) {
        trustedPreviewShas.add(row.sourceSha);
      }
      if (row.outcome === "ready") {
        const readyRows = readyByEvent.get(eventKey) ?? [];
        readyRows.push(row);
        readyByEvent.set(eventKey, readyRows);
      }
      if (windowName === "postCutover" && row.source === "vercel-native") {
        unexplainedNativeBuilds += 1;
        reasons.push("unexplained-native-build");
      }
    } else if (suppressed) {
      excluded[row.target].suppressedNativeDeploymentAttempts += 1;
      reasons.push("native-suppression-record");
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
    trustedPreviewShas.size !==
      aggregateWindow.costWindowTrustedDeployedCodePrPushes
  ) {
    throw new Error(
      `${label} trusted preview SHA count does not reconcile to costWindowTrustedDeployedCodePrPushes`,
    );
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

function rebuildDeploymentCensus({
  manifestDirectory,
  source,
  aggregateWindow,
  windowName,
}) {
  const label = `${windowName} deployment census`;
  const pagesBytes = readFileSync(
    resolve(manifestDirectory, source.deploymentPagesJson),
  );
  if (sha256(pagesBytes) !== source.deploymentPagesSha256) {
    throw new Error(`${label} raw pages SHA-256 does not match the manifest`);
  }
  const rebuilt = normalizeVercelDeploymentPages(pagesBytes);
  const proofBytes = readFileSync(
    resolve(manifestDirectory, source.deploymentCensusProof),
  );
  if (sha256(proofBytes) !== source.deploymentCensusProofSha256) {
    throw new Error(`${label} proof SHA-256 does not match the manifest`);
  }
  if (!proofBytes.equals(Buffer.from(rebuilt.proof))) {
    throw new Error(
      `${label} proof is not the canonical proof for the bound raw pages`,
    );
  }
  const censusBytes = readFileSync(
    resolve(manifestDirectory, source.deploymentCensusJsonl),
  );
  if (sha256(censusBytes) !== source.deploymentCensusSha256) {
    throw new Error(`${label} JSONL SHA-256 does not match the manifest`);
  }
  if (rebuilt.proofObject.outputSha256 !== source.deploymentCensusSha256) {
    throw new Error(
      `${label} rebuilt output digest does not match the manifest`,
    );
  }
  if (!censusBytes.equals(Buffer.from(rebuilt.output))) {
    throw new Error(`${label} JSONL does not match the rebuilt output bytes`);
  }
  if (
    rebuilt.proofObject.window.startUtc !== aggregateWindow.period.startUtc ||
    rebuilt.proofObject.window.endUtcExclusive !==
      aggregateWindow.period.endUtcExclusive
  ) {
    throw new Error(`${label} proof window does not match aggregate evidence`);
  }
  return {
    evidence: reconcileDeploymentCensusJsonl(
      rebuilt.output,
      source,
      aggregateWindow,
      windowName,
      `${label} JSONL`,
    ),
    projectIds: Object.fromEntries(
      rebuilt.proofObject.projects.map(({ target, projectId }) => [
        target,
        projectId,
      ]),
    ),
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
  const githubProofPath = resolve(
    manifestDirectory,
    manifest.githubActionsEvidence.proof,
  );
  const githubProofBytes = readFileSync(githubProofPath);
  if (sha256(githubProofBytes) !== manifest.githubActionsEvidence.proofSha256) {
    throw new Error(
      "manifest.githubActionsEvidence.proofSha256 does not bind the proof bytes",
    );
  }
  const githubProof = validateGitHubActionsCostProof(githubProofPath);
  if (
    githubProof.interval.startUtc !==
      evidence.postCutover.observationPeriod.startUtc ||
    githubProof.interval.endUtcExclusive !==
      evidence.postCutover.observationPeriod.endUtcExclusive
  ) {
    throw new Error(
      "GitHub Actions proof interval does not match postCutover.observationPeriod",
    );
  }
  for (const key of GITHUB_KEYS) {
    if (
      githubProof.analyzerFragment[key] !== evidence.postCutover.github[key]
    ) {
      throw new Error(
        `GitHub Actions proof ${key} does not reconcile to the postCutover aggregate`,
      );
    }
  }
  if (
    githubProof.analyzerFragment.mainDeploymentObservationOpportunities !==
    evidence.postCutover.correctness.mainDeploymentObservationOpportunities
  ) {
    throw new Error(
      "GitHub Actions proof mainDeploymentObservationOpportunities does not reconcile to the postCutover aggregate",
    );
  }
  const deploymentEvidence = {};
  const deploymentProjectIds = {};
  for (const windowName of ["baseline", "postCutover"]) {
    const source = manifest.windows[windowName];
    const aggregateWindow = evidence[windowName];
    reconcileFocusJsonl(
      readFileSync(resolve(manifestDirectory, source.focusJsonl), "utf8"),
      source,
      aggregateWindow,
      `${windowName} FOCUS JSONL`,
    );
    const deploymentCensus = rebuildDeploymentCensus({
      manifestDirectory,
      source,
      aggregateWindow,
      windowName,
    });
    deploymentEvidence[windowName] = deploymentCensus.evidence;
    deploymentProjectIds[windowName] = deploymentCensus.projectIds;
  }
  for (const target of VERCEL_COST_TARGETS) {
    if (
      deploymentProjectIds.baseline[target] !==
      deploymentProjectIds.postCutover[target]
    ) {
      throw new Error(
        `deployment census projectId for ${target} must match across comparison windows`,
      );
    }
  }
  return {
    ...analyzeVercelCostEvidence(evidence),
    sourceEvidence: {
      rawFocusReconciled: true,
      projectTotalsReconciled: true,
      deploymentCensusComplete: true,
      githubActionsProofReconciled: true,
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
