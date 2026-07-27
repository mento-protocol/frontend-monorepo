import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";

import {
  assertCanonicalOutput,
  canonicalizeDeploymentUrl,
  canonicalizeHostname,
} from "./vercel-deployment-state.mjs";
import {
  MAIN_RELEASE_ACTIVATION_ORDER,
  assertMainReleaseManifest,
} from "./vercel-main-release-reconciliation.mjs";

export const MAIN_RELEASE_EXECUTION_SCHEMA = "vercel-main-release-execution:v1";
export const MAIN_RELEASE_SELECTION_SCHEMA = "vercel-main-release-selection:v1";
export const MAIN_RELEASE_EXECUTION_MAX_ENCODED_BYTES = 64 * 1024;

const SHA_PATTERN = /^[a-f0-9]{40}$/;
const POSITIVE_ID_PATTERN = /^[1-9][0-9]*$/;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const LEGACY_ALIAS = "v2-app.mento.org";
const LEGACY_ALIASES = Object.freeze(
  [
    LEGACY_ALIAS,
    "appmentoorg-git-v2-mentolabs.vercel.app",
    "appmentoorg-mentolabs.vercel.app",
    "appmentoorg.vercel.app",
  ].sort(),
);
const EXECUTION_KEYS = Object.freeze([
  "schema",
  "decision",
  "reason",
  "manifest",
  "upstream",
  "legacyAppV2",
  "selection",
  "projection",
]);
const SELECTION_KEYS = Object.freeze([
  "schema",
  "providerDiscoveryDigest",
  "planningSnapshotDigest",
  "legacyAppV2Digest",
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
  const expectedRunUrl = `https://github.com/mento-protocol/frontend-monorepo/actions/runs/${runId}`;
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
      `^${expectedRunUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/job/[1-9][0-9]*$`,
    ).test(buildAndTestJobUrl)
  ) {
    throw new Error(
      "Main release execution upstream URLs do not bind the exact repository run",
    );
  }
  return {
    runId,
    runAttempt: requireString(
      String(value.runAttempt),
      "Main release execution upstream run attempt",
      POSITIVE_ID_PATTERN,
    ),
    runUrl,
    buildAndTestJobUrl,
  };
}

function canonicalLegacyAppV2(value, manifest) {
  const state = assertCanonicalOutput(value);
  if (
    Array.isArray(state) ||
    canonicalizeHostname(state.alias) !== LEGACY_ALIAS ||
    canonicalizeDeploymentUrl(state.deploymentUrl) !== state.deploymentUrl ||
    state.projectId !== manifest.originalPriors.app.projectId ||
    state.projectName !== "app.mento.org" ||
    state.readyState !== "READY" ||
    state.target !== "production" ||
    state.customEnvironmentSlug !== null ||
    state.git.org !== "mento-protocol" ||
    state.git.repo !== "frontend-monorepo" ||
    state.git.ref !== "v2" ||
    !SHA_PATTERN.test(state.git.sha) ||
    JSON.stringify(state.aliases) !== JSON.stringify(LEGACY_ALIASES) ||
    state.deploymentId === manifest.originalPriors.app.deploymentId ||
    state.deploymentUrl === manifest.originalPriors.app.deploymentUrl
  ) {
    throw new Error("Main release execution legacy App v2 state is invalid");
  }
  return structuredClone(state);
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function canonicalSelection(value, manifest, legacyAppV2) {
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
  if (
    !isPlainObject(value.projectIds) ||
    JSON.stringify(Object.keys(value.projectIds)) !==
      JSON.stringify(MAIN_RELEASE_ACTIVATION_ORDER) ||
    value.mode !== manifest.mode ||
    JSON.stringify(value.mainOwnershipMode) !==
      JSON.stringify(manifest.mainOwnershipMode) ||
    value.legacyAppV2Digest !== digest(legacyAppV2)
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
    legacyAppV2Digest: value.legacyAppV2Digest,
    projectIds,
    mode: manifest.mode,
    mainOwnershipMode: structuredClone(manifest.mainOwnershipMode),
    selectedManifest,
  };
}

export function createMainReleaseSelection({
  providerDiscoveryDigest,
  planningSnapshotDigest,
  legacyAppV2,
  projectIds,
  mode,
  mainOwnershipMode,
  selectedManifest,
}) {
  const manifest = assertMainReleaseManifest(selectedManifest);
  const legacy = canonicalLegacyAppV2(legacyAppV2, manifest);
  return canonicalSelection(
    {
      schema: MAIN_RELEASE_SELECTION_SCHEMA,
      providerDiscoveryDigest,
      planningSnapshotDigest,
      legacyAppV2Digest: digest(legacy),
      projectIds,
      mode,
      mainOwnershipMode,
      selectedManifest: manifest,
    },
    manifest,
    legacy,
  );
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
  legacyAppV2,
  selection,
}) {
  const release = assertMainReleaseManifest(manifest);
  const selected = canonicalDecision(decision, reason);
  const legacy = canonicalLegacyAppV2(legacyAppV2, release);
  return assertMainReleaseExecution({
    schema: MAIN_RELEASE_EXECUTION_SCHEMA,
    decision: selected.decision,
    reason: selected.reason,
    manifest: release,
    upstream: canonicalUpstream(upstream, release),
    legacyAppV2: legacy,
    selection: canonicalSelection(selection, release, legacy),
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
  const legacyAppV2 = canonicalLegacyAppV2(value.legacyAppV2, manifest);
  const canonical = {
    schema: MAIN_RELEASE_EXECUTION_SCHEMA,
    decision: selected.decision,
    reason: selected.reason,
    manifest,
    upstream: canonicalUpstream(value.upstream, manifest),
    legacyAppV2,
    selection: canonicalSelection(value.selection, manifest, legacyAppV2),
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
