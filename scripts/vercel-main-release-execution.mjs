import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";

import {
  MAIN_RELEASE_ACTIVATION_ORDER,
  assertMainReleaseManifest,
} from "./vercel-main-release-reconciliation.mjs";
import { MAIN_DEPLOYMENT_TARGETS } from "./vercel-main-plan.mjs";

const MAIN_RELEASE_EXECUTION_SCHEMA = "vercel-main-release-execution:v2";
const MAIN_RELEASE_SELECTION_SCHEMA = "vercel-main-release-selection:v2";
const MAIN_RELEASE_EXECUTION_MAX_ENCODED_BYTES = 64 * 1024;

const SHA_PATTERN = /^[a-f0-9]{40}$/;
const POSITIVE_ID_PATTERN = /^[1-9][0-9]*$/;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const EXECUTION_KEYS = Object.freeze([
  "schema",
  "decision",
  "reason",
  "manifest",
  "upstream",
  "selection",
  "projection",
]);
const SELECTION_KEYS = Object.freeze([
  "schema",
  "providerDiscoveryDigest",
  "planningSnapshotDigest",
  "rollbackOnlyTargets",
  "projectIds",
  "mode",
  "mainOwnershipMode",
  "selectedManifest",
]);
const UPSTREAM_KEYS = Object.freeze([
  "runId",
  "runAttempt",
  "runUrl",
  "buildAndTestJobUrl",
]);
const PROJECTION_KEYS = Object.freeze([
  "projectIds",
  "stagedTargets",
  "activeTargets",
  "shadowTargets",
  "noTarget",
]);
const DECISION_REASONS = Object.freeze({
  "capture-new-baseline": new Set([
    "no-mapped-release-metadata",
    "older-mapped-release-is-complete",
  ]),
  "resume-existing-release": new Set([
    "current-main-release-is-an-interrupted-prefix",
  ]),
  "verify-existing-release": new Set(["current-main-release-already-complete"]),
});

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function assertExactKeys(value, keys, label) {
  if (
    !isPlainObject(value) ||
    JSON.stringify(Object.keys(value)) !== JSON.stringify(keys)
  ) {
    throw new Error(`${label} contains forbidden or missing fields`);
  }
}

function requireString(value, label, pattern) {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new Error(`${label} is malformed`);
  }
  return value;
}

function requireGithubUrl(value, label) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} is malformed`);
  }
  if (
    parsed.origin !== "https://github.com" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.hash !== ""
  ) {
    throw new Error(`${label} is malformed`);
  }
  return parsed.toString();
}

function canonicalUpstream(value, manifest) {
  assertExactKeys(value, UPSTREAM_KEYS, "Main release execution upstream");
  const runId = requireString(
    String(value.runId),
    "Main release execution upstream run ID",
    POSITIVE_ID_PATTERN,
  );
  if (runId !== manifest.upstreamRunId) {
    throw new Error(
      "Main release execution upstream run differs from its stable manifest",
    );
  }
  const runAttempt = requireString(
    String(value.runAttempt),
    "Main release execution upstream run attempt",
    POSITIVE_ID_PATTERN,
  );
  const expectedJobUrlPrefix = `https://github.com/mento-protocol/frontend-monorepo/actions/runs/${runId}`;
  const expectedRunUrl = `${expectedJobUrlPrefix}/attempts/${runAttempt}`;
  const runUrl = requireGithubUrl(
    value.runUrl,
    "Main release execution upstream run URL",
  );
  const buildAndTestJobUrl = requireGithubUrl(
    value.buildAndTestJobUrl,
    "Main release execution build job URL",
  );
  if (
    runUrl !== expectedRunUrl ||
    !new RegExp(
      `^${expectedJobUrlPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/job/[1-9][0-9]*$`,
    ).test(buildAndTestJobUrl)
  ) {
    throw new Error(
      "Main release execution upstream URLs do not bind the exact repository run",
    );
  }
  return {
    runId,
    runAttempt,
    runUrl,
    buildAndTestJobUrl,
  };
}

function canonicalRollbackOnlyTargets(value) {
  if (
    !Array.isArray(value) ||
    value.some((target) => !MAIN_DEPLOYMENT_TARGETS.includes(target)) ||
    new Set(value).size !== value.length
  ) {
    throw new Error(
      "Main release selection rollback-only targets are malformed",
    );
  }
  const canonical = MAIN_DEPLOYMENT_TARGETS.filter((target) =>
    value.includes(target),
  );
  if (JSON.stringify(canonical) !== JSON.stringify(value)) {
    throw new Error(
      "Main release selection rollback-only targets are not canonical",
    );
  }
  return canonical;
}

function canonicalSelection(value, manifest) {
  assertExactKeys(value, SELECTION_KEYS, "Main release selection");
  if (value.schema !== MAIN_RELEASE_SELECTION_SCHEMA) {
    throw new Error("Main release selection schema is unsupported");
  }
  const selectedManifest = assertMainReleaseManifest(value.selectedManifest);
  if (JSON.stringify(selectedManifest) !== JSON.stringify(manifest)) {
    throw new Error("Main release selection manifest conflicts with execution");
  }
  const projectIds = Object.fromEntries(
    MAIN_RELEASE_ACTIVATION_ORDER.map((target) => {
      const projectId = requireString(
        value.projectIds?.[target],
        `Main release selection ${target} project ID`,
        /^[A-Za-z0-9._-]+$/,
      );
      if (projectId !== manifest.originalPriors[target].projectId) {
        throw new Error(
          "Main release selection project IDs conflict with its manifest",
        );
      }
      return [target, projectId];
    }),
  );
  const rollbackOnlyTargets = canonicalRollbackOnlyTargets(
    value.rollbackOnlyTargets,
  );
  if (
    !isPlainObject(value.projectIds) ||
    JSON.stringify(Object.keys(value.projectIds)) !==
      JSON.stringify(MAIN_RELEASE_ACTIVATION_ORDER) ||
    value.mode !== manifest.mode ||
    JSON.stringify(value.mainOwnershipMode) !==
      JSON.stringify(manifest.mainOwnershipMode)
  ) {
    throw new Error(
      "Main release selection context conflicts with its provider evidence",
    );
  }
  return {
    schema: MAIN_RELEASE_SELECTION_SCHEMA,
    providerDiscoveryDigest: requireString(
      value.providerDiscoveryDigest,
      "Main release selection provider discovery digest",
      DIGEST_PATTERN,
    ),
    planningSnapshotDigest: requireString(
      value.planningSnapshotDigest,
      "Main release selection planning snapshot digest",
      DIGEST_PATTERN,
    ),
    rollbackOnlyTargets,
    projectIds,
    mode: manifest.mode,
    mainOwnershipMode: structuredClone(manifest.mainOwnershipMode),
    selectedManifest,
  };
}

export function createMainReleaseSelection({
  providerDiscoveryDigest,
  planningSnapshotDigest,
  rollbackOnlyTargets,
  projectIds,
  mode,
  mainOwnershipMode,
  selectedManifest,
}) {
  const manifest = assertMainReleaseManifest(selectedManifest);
  return canonicalSelection(
    {
      schema: MAIN_RELEASE_SELECTION_SCHEMA,
      providerDiscoveryDigest,
      planningSnapshotDigest,
      rollbackOnlyTargets,
      projectIds,
      mode,
      mainOwnershipMode,
      selectedManifest: manifest,
    },
    manifest,
  );
}

function assertSelectionRollbackCoverage(decision, manifest, selection) {
  const missing = selection.rollbackOnlyTargets.filter(
    (target) => !manifest.stagedTargets.includes(target),
  );
  if (missing.length > 0) {
    throw new Error(
      `Main release selection omits fresh rollback-only targets: ${missing.join(", ")}`,
    );
  }
  if (
    decision === "capture-new-baseline" &&
    JSON.stringify(selection.rollbackOnlyTargets) !==
      JSON.stringify(manifest.rollbackOnlyTargets)
  ) {
    throw new Error(
      "New main release manifest conflicts with fresh rollback-only targets",
    );
  }
}

function projectionFromManifest(manifest) {
  const projectIds = Object.fromEntries(
    MAIN_RELEASE_ACTIVATION_ORDER.map((target) => [
      target,
      manifest.originalPriors[target].projectId,
    ]),
  );
  const stagedTargets = [...manifest.stagedTargets];
  const activeTargets = [...manifest.activeTargets];
  return {
    projectIds,
    stagedTargets,
    activeTargets,
    shadowTargets: stagedTargets.filter(
      (target) => !activeTargets.includes(target),
    ),
    noTarget: stagedTargets.length === 0,
  };
}

function canonicalProjection(value, manifest) {
  assertExactKeys(value, PROJECTION_KEYS, "Main release execution projection");
  const expected = projectionFromManifest(manifest);
  if (JSON.stringify(value) !== JSON.stringify(expected)) {
    throw new Error(
      "Main release execution projection differs from its stable manifest",
    );
  }
  return expected;
}

function canonicalDecision(decision, reason) {
  const reasons = DECISION_REASONS[decision];
  if (reasons === undefined || !reasons.has(reason)) {
    throw new Error("Main release execution decision or reason is invalid");
  }
  return { decision, reason };
}

export function createMainReleaseExecution({
  decision,
  reason,
  manifest,
  upstream,
  selection,
}) {
  const release = assertMainReleaseManifest(manifest);
  const selected = canonicalDecision(decision, reason);
  return assertMainReleaseExecution({
    schema: MAIN_RELEASE_EXECUTION_SCHEMA,
    decision: selected.decision,
    reason: selected.reason,
    manifest: release,
    upstream: canonicalUpstream(upstream, release),
    selection: canonicalSelection(selection, release),
    projection: projectionFromManifest(release),
  });
}

export function assertMainReleaseExecution(value, expected = {}) {
  assertExactKeys(value, EXECUTION_KEYS, "Main release execution");
  if (value.schema !== MAIN_RELEASE_EXECUTION_SCHEMA) {
    throw new Error("Main release execution schema is unsupported");
  }
  const manifest = assertMainReleaseManifest(value.manifest);
  const selected = canonicalDecision(value.decision, value.reason);
  const selection = canonicalSelection(value.selection, manifest);
  assertSelectionRollbackCoverage(selected.decision, manifest, selection);
  const canonical = {
    schema: MAIN_RELEASE_EXECUTION_SCHEMA,
    decision: selected.decision,
    reason: selected.reason,
    manifest,
    upstream: canonicalUpstream(value.upstream, manifest),
    selection,
    projection: canonicalProjection(value.projection, manifest),
  };
  if (
    expected.deploySha !== undefined &&
    requireString(
      expected.deploySha,
      "Expected main release execution SHA",
      SHA_PATTERN,
    ) !== manifest.deploySha
  ) {
    throw new Error("Main release execution SHA differs from the expected SHA");
  }
  if (
    expected.upstreamRunId !== undefined &&
    requireString(
      String(expected.upstreamRunId),
      "Expected main release execution upstream run ID",
      POSITIVE_ID_PATTERN,
    ) !== manifest.upstreamRunId
  ) {
    throw new Error(
      "Main release execution upstream run differs from the expected run",
    );
  }
  if (
    expected.releaseId !== undefined &&
    expected.releaseId !== manifest.releaseId
  ) {
    throw new Error(
      "Main release execution release differs from the expected release",
    );
  }
  return canonical;
}

export function encodeMainReleaseExecution(value, expected = {}) {
  const canonical = assertMainReleaseExecution(value, expected);
  const encoded = Buffer.from(JSON.stringify(canonical), "utf8").toString(
    "base64url",
  );
  if (
    Buffer.byteLength(encoded, "utf8") >
    MAIN_RELEASE_EXECUTION_MAX_ENCODED_BYTES
  ) {
    throw new Error("Main release execution exceeds its output size bound");
  }
  return encoded;
}

export function decodeMainReleaseExecution(encoded, expected = {}) {
  if (
    typeof encoded !== "string" ||
    !BASE64URL_PATTERN.test(encoded) ||
    Buffer.byteLength(encoded, "utf8") >
      MAIN_RELEASE_EXECUTION_MAX_ENCODED_BYTES
  ) {
    throw new Error(
      "Main release execution encoding is malformed or oversized",
    );
  }
  let parsed;
  try {
    const decoded = Buffer.from(encoded, "base64url");
    if (decoded.toString("base64url") !== encoded) {
      throw new Error("noncanonical base64url");
    }
    const serialized = decoded.toString("utf8");
    parsed = JSON.parse(serialized);
    if (JSON.stringify(parsed) !== serialized) {
      throw new Error("noncanonical JSON");
    }
  } catch {
    throw new Error("Main release execution cannot be decoded");
  }
  return assertMainReleaseExecution(parsed, expected);
}

export function digestMainReleaseExecution(value, expected = {}) {
  return createHash("sha256")
    .update(JSON.stringify(assertMainReleaseExecution(value, expected)))
    .digest("hex");
}
