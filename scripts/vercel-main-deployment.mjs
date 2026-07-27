#!/usr/bin/env node

import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import process from "node:process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  MAIN_DEPLOYMENT_MODES,
  MAIN_DEPLOYMENT_TARGETS,
  MAIN_TARGET_CONTRACTS,
  assertMainDeploymentPlan,
  planMainDeployments,
} from "./vercel-main-plan.mjs";
import {
  MAIN_TRANSACTION_MODE,
  MAIN_TRANSACTION_REPOSITORY,
  MainTransactionError,
  assertMainTransactionJournal,
  assertMainTransactionJournalHistory,
  createMainTransactionId,
  createPreparedMainTransactionJournal,
  decideMainTransactionRecovery,
  executeMainTransactionRecovery,
  mainTransactionJournalArtifactName,
  planMainTransactionRecovery,
  runMainTransaction,
} from "./vercel-main-transaction.mjs";
import {
  assertMainCandidateIntent,
  assertMainCandidateReceipt,
  createMainCandidateIntent,
  createMainCandidateVercelMetadata,
} from "./vercel-main-candidate.mjs";
import {
  assertMainReleaseManifest,
  createMainReleaseManifest,
} from "./vercel-main-release-reconciliation.mjs";
import {
  assertMainReleaseExecution,
  digestMainReleaseExecution,
} from "./vercel-main-release-execution.mjs";
import { createMainForwardTransactionJournal } from "./vercel-main-release-journal.mjs";
import {
  createMainTerminalEvidence,
  createMainTerminalReceipt,
  decodeMainTerminalEvidence,
  decodeMainTerminalReceipt,
  digestMainTerminalEvidence,
  encodeMainTerminalEvidence,
  encodeMainTerminalReceipt,
} from "./vercel-main-terminal-receipt.mjs";
import {
  MAIN_ACTIVE_HISTORY_SCHEMA,
  createMainActiveJournalReceipt,
  createMainActiveRecoveryTransitionEvent,
  createMainActiveTransitionEvent,
  createCurrentMainActiveRecoveryJournal,
  decideMainActiveAppRecoverySafety,
  loadMainActiveJournalHistory,
  planFreshInheritedMainActiveRecovery,
  reconcileFreshMainActiveRelease,
  reduceMainActiveRecoveryTransition,
  reduceMainActiveTransition,
} from "./vercel-main-active-controller.mjs";
import {
  ACTIVE_ALIAS_MAPPING_SPEC_SCHEMA,
  ACTIVE_ALIAS_MAPPING_SET_SCHEMA,
  ACTIVE_DEPLOYMENT_STATE_SPEC_SCHEMA,
  assertActiveAliasMappingSpec,
  assertActiveAliasMappingSet,
  assertActiveDeploymentStateProof,
  assertActiveDeploymentStateSpec,
  assertCanonicalOutput,
  assertMainPlanningSnapshot,
  assertSnapshotSpec,
  canonicalizeDeploymentUrl,
  canonicalizeHostname,
  writeActiveAliasMappingSet,
} from "./vercel-deployment-state.mjs";
import {
  assertOnlyExpectedVercelGeneratedAliases,
  validateImmutableMainSource,
} from "./vercel-production-shadow.mjs";
import {
  generateVercelDeploymentId,
  generateVercelMainCandidateDeploymentId,
} from "./vercel-prebuilt.mjs";

export {
  createCurrentMainActiveRecoveryJournal,
  decideMainActiveAppRecoverySafety,
  planFreshInheritedMainActiveRecovery,
  reconcileFreshMainActiveRelease,
};

export const MAIN_DEPLOYMENT_SCHEMA = "vercel-main-deployment:v1";
export const MAIN_STAGE_SCHEMA = "vercel-main-stage:v1";
export const MAIN_EVIDENCE_SCHEMA = "vercel-main-evidence:v1";
export const MAIN_FAILURE_EVIDENCE_SCHEMA = "vercel-main-failure-evidence:v1";
export const MAIN_ACTIVE_EVIDENCE_SCHEMA = "vercel-main-active-evidence:v1";
export const MAIN_ACTIVE_CURRENT_RELEASE_EVIDENCE_SCHEMA =
  "vercel-main-active-current-release-evidence:v1";
export const MAIN_ACTIVE_SAFE_NOOP_EVIDENCE_SCHEMA =
  "vercel-main-active-safe-noop-evidence:v1";
export const MAIN_ACTIVE_FAILURE_EVIDENCE_SCHEMA =
  "vercel-main-active-failure-evidence:v1";
export const MAIN_ACTIVE_PREPARATION_FAILURE_EVIDENCE_SCHEMA =
  "vercel-main-active-preparation-failure-evidence:v1";
export const MAIN_ACTIVE_TERMINAL_PROOFS_SCHEMA =
  "vercel-main-active-terminal-proofs:v3";
export const MAIN_STAGE_BARRIER_SCHEMA = "vercel-main-stage-barrier:v1";
export const MAIN_TERMINAL_STATE_PROOF_SCHEMA =
  "vercel-main-terminal-state-proof:v1";
export const MAIN_DEPLOYMENT_MODE = MAIN_TRANSACTION_MODE;
export const MAIN_ACTIVE_DEPLOYMENT_MODE = MAIN_DEPLOYMENT_MODES.ACTIVE;
export const MAIN_DEPLOYMENT_WORKFLOW =
  ".github/workflows/vercel-main-deployment.yml";
export const MAIN_DEPLOYMENT_ENVIRONMENT = "vercel-cli-production";
export const MAIN_OWNERSHIP_MODES = Object.freeze({
  GITHUB: "github",
  SHADOW: "shadow",
});
export const MAIN_ORDINARY_TARGETS = Object.freeze([
  "governance",
  "reserve",
  "ui",
]);

const SHA_PATTERN = /^[a-f0-9]{40}$/;
const ID_PATTERN = /^[A-Za-z0-9._-]+$/;
const DEPLOYMENT_ID_PATTERN = /^dpl_[A-Za-z0-9]+$/;
const POSITIVE_ID_PATTERN = /^[1-9][0-9]*$/;
const JOB_RESULTS = new Set(["success", "failure", "cancelled", "skipped"]);
const FINAL_JOB_KEYS = Object.freeze([
  "waitForCi",
  "plan",
  "stageGovernance",
  "stageReserve",
  "stageUi",
  "coordinator",
  "recovery",
]);
const PLAN_KEYS = Object.freeze([
  "schema",
  "mode",
  "deploySha",
  "upstream",
  "projectIds",
  "protectedSnapshot",
  "legacySnapshot",
  "planning",
  "legacyPrior",
]);
const UPSTREAM_KEYS = Object.freeze([
  "runId",
  "runAttempt",
  "runUrl",
  "buildAndTestJobUrl",
]);
const PROJECT_KEYS = Object.freeze(["app", "governance", "reserve", "ui"]);
const PRIOR_KEYS = Object.freeze(["deploymentId", "deploymentUrl", "aliases"]);
const STAGE_KEYS = Object.freeze([
  "schema",
  "target",
  "deploySha",
  "transactionKey",
  "prior",
  "candidate",
  "verification",
]);
const CANDIDATE_KEYS = Object.freeze([
  "deploymentId",
  "deploymentUrl",
  "aliases",
  "discovery",
]);
const VERIFICATION_KEYS = Object.freeze([
  "canonicalState",
  "immutableSmoke",
  "protectedMappings",
]);
const LEGACY_ALIAS = "v2-app.mento.org";
const LEGACY_GENERATED_BRANCH_SLUG = "git-v2";
const LEGACY_GENERATED_SCOPE_SLUG = "mentolabs";
const LEGACY_GENERATED_BRANCH_ALIAS = `appmentoorg-${LEGACY_GENERATED_BRANCH_SLUG}-${LEGACY_GENERATED_SCOPE_SLUG}.vercel.app`;
const LEGACY_GENERATED_SCOPE_ALIAS = `appmentoorg-${LEGACY_GENERATED_SCOPE_SLUG}.vercel.app`;
const LEGACY_GENERATED_PROJECT_DEFAULT_ALIAS = "appmentoorg.vercel.app";
export const MAIN_LEGACY_REQUIRED_ALIAS_TOPOLOGY = Object.freeze(
  [
    LEGACY_ALIAS,
    LEGACY_GENERATED_BRANCH_ALIAS,
    LEGACY_GENERATED_SCOPE_ALIAS,
    LEGACY_GENERATED_PROJECT_DEFAULT_ALIAS,
  ].sort(),
);
export const MAIN_DURABLE_LEGACY_RECOVERY_ALIASES =
  MAIN_LEGACY_REQUIRED_ALIAS_TOPOLOGY;
export const MAIN_ACTIVE_MAX_RECOVERY_TRANSITIONS =
  MAIN_ORDINARY_TARGETS.length +
  MAIN_TARGET_CONTRACTS.app.aliases.length +
  MAIN_DURABLE_LEGACY_RECOVERY_ALIASES.length;
const MAX_JSON_BYTES = 256 * 1024;
export const MAIN_ACTIVE_JOURNAL_HISTORY_MAX_JSON_BYTES = 1024 * 1024;
export const MAIN_ACTIVE_TERMINAL_PROOFS_MAX_JSON_BYTES = 1024 * 1024;
const APP_BUILD_PROOF_SCHEMA = "vercel-main-app-build:v2";
const CLI_COMMAND_OPTIONS = Object.freeze({
  "active-event-authorize": Object.freeze([
    "current-mappings",
    "freshness",
    "output",
    "receipt",
  ]),
  "active-event-command-returned": Object.freeze([
    "authorization",
    "output",
    "receipt",
    "result",
  ]),
  "active-event-dispatch": Object.freeze([
    "current-mappings",
    "freshness",
    "output",
    "receipt",
  ]),
  "active-event-finalize": Object.freeze([
    "current-mappings",
    "freshness",
    "output",
    "public-smokes",
    "receipt",
    "state-proof",
  ]),
  "active-event-initialize": Object.freeze(["output"]),
  "active-event-verify": Object.freeze([
    "authorization",
    "current-mappings",
    "freshness",
    "output",
    "receipt",
  ]),
  "active-event-verify-app": Object.freeze([
    "app-candidate-receipt",
    "app-deployment",
    "authorization",
    "current-mappings",
    "freshness",
    "output",
    "receipt",
  ]),
  "active-command-descriptor": Object.freeze(["authorization", "output"]),
  "active-evidence": Object.freeze([
    "final-mappings",
    "journal-history",
    "output",
    "state-proof",
  ]),
  "active-failure-evidence": Object.freeze([
    "journal-history",
    "output",
    "state-proof",
  ]),
  "active-safe-noop-evidence": Object.freeze(["output"]),
  "terminal-evidence-create": Object.freeze([
    "active-evidence",
    "evidence-output",
    "execution",
    "manifest",
    "proofs",
    "receipt-output",
  ]),
  "terminal-evidence-restore": Object.freeze([
    "evidence",
    "execution",
    "manifest",
    "output",
    "receipt",
  ]),
  "active-journal-history": Object.freeze(["artifacts", "output"]),
  "active-journal-identity": Object.freeze([]),
  "active-journal-receipt": Object.freeze([
    "artifact-id",
    "artifact-name",
    "journal",
    "output",
  ]),
  "active-freshness": Object.freeze(["output"]),
  "active-mapping-spec": Object.freeze([
    "execution",
    "journal-history",
    "output",
    "stage-barrier",
  ]),
  "current-release-mapping-spec": Object.freeze([
    "execution",
    "output",
    "stage-barrier",
  ]),
  "active-recovery-mapping-spec": Object.freeze(["journal-history", "output"]),
  "active-recovery-canonical-mappings": Object.freeze([
    "journal-history",
    "mappings",
    "output",
  ]),
  "active-recovery-state-spec": Object.freeze([
    "execution",
    "journal-history",
    "output",
  ]),
  "active-recovery-public-smokes": Object.freeze([
    "app",
    "execution",
    "governance",
    "output",
    "reserve",
    "ui",
  ]),
  "active-public-smokes": Object.freeze([
    "app",
    "execution",
    "governance",
    "output",
    "reserve",
    "stage-barrier",
    "ui",
  ]),
  "active-state-spec": Object.freeze([
    "execution",
    "journal-history",
    "output",
    "stage-barrier",
  ]),
  "current-release-state-spec": Object.freeze([
    "execution",
    "output",
    "stage-barrier",
  ]),
  "active-terminal-state-proof": Object.freeze([
    "execution",
    "output",
    "stage-barrier",
    "state-proof",
  ]),
  "active-recovery-event-authorize": Object.freeze([
    "current-mappings",
    "output",
    "receipt",
  ]),
  "active-recovery-event-command-returned": Object.freeze([
    "authorization",
    "output",
    "receipt",
    "result",
  ]),
  "active-recovery-event-dispatch": Object.freeze([
    "current-mappings",
    "output",
    "receipt",
  ]),
  "active-recovery-event-initialize": Object.freeze(["output", "receipt"]),
  "active-recovery-event-verify": Object.freeze([
    "current-mappings",
    "output",
    "receipt",
  ]),
  "app-build-proof": Object.freeze(["intent", "output"]),
  "app-candidate-expectation": Object.freeze(["journal", "output"]),
  "candidate-intent": Object.freeze(["execution", "output", "target"]),
  "candidate-metadata": Object.freeze(["intent", "output"]),
  "create-release-manifest": Object.freeze([
    "original-priors",
    "output",
    "plan",
  ]),
  "create-spec": Object.freeze(["output", "scope"]),
  evidence: Object.freeze(["output"]),
  "failure-evidence": Object.freeze(["output"]),
  final: Object.freeze([]),
  freshness: Object.freeze([]),
  "journal-name": Object.freeze([]),
  "final-active": Object.freeze(["execution"]),
  plan: Object.freeze(["legacy-snapshot", "output", "planning-snapshot"]),
  "plan-active-recovery": Object.freeze([
    "current-mappings",
    "journal-history",
    "output",
  ]),
  "plan-inherited-recovery": Object.freeze([
    "current-journal",
    "current-mappings",
    "journal",
    "output",
    "reason",
  ]),
  "prepare-current-recovery-journal": Object.freeze([
    "current-mappings",
    "inherited-journal",
    "output",
  ]),
  "reconcile-release": Object.freeze([
    "current-mappings",
    "journal",
    "output",
    "rechecked-current-mappings",
  ]),
  "prepare-journal": Object.freeze(["output"]),
  "recover-shadow": Object.freeze(["journal"]),
  "revalidate-prior": Object.freeze(["legacy-snapshot", "planning-snapshot"]),
  "run-active": Object.freeze([
    "execution",
    "event",
    "journal-history",
    "journal-output",
    "output",
    "prepared-journal",
    "stage-barrier",
  ]),
  "stage-barrier": Object.freeze([
    "app-preparation",
    "candidate-receipts",
    "execution",
    "output",
  ]),
  "run-active-recovery": Object.freeze([
    "event",
    "journal-history",
    "journal-output",
    "output",
    "plan",
  ]),
  "run-shadow": Object.freeze(["journal"]),
  "stage-result": Object.freeze(["output", "state"]),
  "validate-context": Object.freeze([]),
  "validate-source": Object.freeze([]),
  "validate-stages": Object.freeze([]),
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
    JSON.stringify(Object.keys(value).sort()) !==
      JSON.stringify([...keys].sort())
  ) {
    throw new Error(`${label} contains forbidden or missing fields`);
  }
}

function requireString(value, label, pattern = ID_PATTERN) {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new Error(`${label} is missing or malformed`);
  }
  return value;
}

function requireSha(value, label = "DEPLOY_SHA") {
  return requireString(value, label, SHA_PATTERN);
}

function requirePositiveId(value, label) {
  const normalized =
    typeof value === "number" && Number.isSafeInteger(value)
      ? String(value)
      : value;
  return requireString(normalized, label, POSITIVE_ID_PATTERN);
}

function requireNonNegativeCount(value, label) {
  const normalized =
    typeof value === "number" && Number.isSafeInteger(value)
      ? String(value)
      : value;
  return requireString(normalized, label, /^[0-9]+$/);
}

function requireUrl(value, label, origin = "https://github.com") {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} is malformed`);
  }
  if (
    url.origin !== origin ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== ""
  ) {
    throw new Error(`${label} is malformed`);
  }
  return url.toString();
}

function parseJson(raw, label) {
  if (
    typeof raw !== "string" ||
    Buffer.byteLength(raw, "utf8") > MAX_JSON_BYTES
  ) {
    throw new Error(`${label} is missing or exceeds its size limit`);
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
}

function readJson(path, label, maxBytes = MAX_JSON_BYTES) {
  const raw = readFileSync(path);
  if (raw.byteLength > maxBytes) {
    throw new Error(`${label} exceeds its size limit`);
  }
  try {
    return JSON.parse(raw.toString("utf8"));
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
}

function readActiveJournalHistory(path, label) {
  return readJson(path, label, MAIN_ACTIVE_JOURNAL_HISTORY_MAX_JSON_BYTES);
}

function writeCanonicalJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
}

function appendOutput(path, name, value) {
  if (!path) throw new Error("GITHUB_OUTPUT is required");
  if (!/^[a-z][a-z0-9_]*$/.test(name)) {
    throw new Error("GitHub output name is malformed");
  }
  if (String(value).includes("\n")) {
    throw new Error(`GitHub output ${name} contains a newline`);
  }
  appendFileSync(path, `${name}=${value}\n`);
}

function canonicalProjectIds(projectIds) {
  assertExactKeys(projectIds, PROJECT_KEYS, "Main project IDs");
  return Object.fromEntries(
    MAIN_DEPLOYMENT_TARGETS.map((target) => [
      target,
      requireString(projectIds[target], `${target} project ID`),
    ]),
  );
}

export function canonicalMainOwnershipMode(mainOwnershipMode) {
  assertExactKeys(
    mainOwnershipMode,
    MAIN_DEPLOYMENT_TARGETS,
    "Main ownership mode",
  );
  return Object.fromEntries(
    MAIN_DEPLOYMENT_TARGETS.map((target) => {
      const mode = mainOwnershipMode[target];
      if (!Object.values(MAIN_OWNERSHIP_MODES).includes(mode)) {
        throw new Error(`Main ownership mode is invalid for ${target}`);
      }
      return [target, mode];
    }),
  );
}

export function createMainActivePlanning({ plan }) {
  const handoff = assertMainDeploymentHandoff(plan);
  if (handoff.mode !== MAIN_ACTIVE_DEPLOYMENT_MODE) {
    throw new Error("Active planning requires an active deployment plan");
  }
  const reviewed = handoff.planning;
  assertExactKeys(
    reviewed,
    [
      "schema",
      "mode",
      "deploySha",
      "mainOwnershipMode",
      "plan",
      "stagedTargets",
      "activeTargets",
      "shadowTargets",
      "priors",
      "ranges",
      "reasons",
    ],
    "Active main planning handoff",
  );
  if (reviewed.schema !== "vercel-main-plan:v2") {
    throw new Error("Active planning requires the v2 ownership schema");
  }
  const ownership = canonicalMainOwnershipMode(reviewed.mainOwnershipMode);
  const stagedTargets = [...reviewed.stagedTargets];
  const expectedStaged = MAIN_DEPLOYMENT_TARGETS.filter((target) =>
    reviewed.plan.includes(target),
  );
  const expectedActive = expectedStaged.filter(
    (target) => ownership[target] === MAIN_OWNERSHIP_MODES.GITHUB,
  );
  const expectedShadow = expectedStaged.filter(
    (target) => ownership[target] === MAIN_OWNERSHIP_MODES.SHADOW,
  );
  if (
    JSON.stringify(reviewed.plan) !== JSON.stringify(expectedStaged) ||
    JSON.stringify(stagedTargets) !== JSON.stringify(expectedStaged) ||
    JSON.stringify(reviewed.activeTargets) !== JSON.stringify(expectedActive) ||
    JSON.stringify(reviewed.shadowTargets) !== JSON.stringify(expectedShadow)
  ) {
    throw new Error("Active planning ownership partitions are inconsistent");
  }
  return {
    controllerMode: MAIN_ACTIVE_DEPLOYMENT_MODE,
    mainOwnershipMode: ownership,
    stagedTargets,
    activeTargets: [...reviewed.activeTargets],
    shadowTargets: [...reviewed.shadowTargets],
  };
}

function expectedGit(ref) {
  return {
    org: "mento-protocol",
    repo: "frontend-monorepo",
    ref,
  };
}

export function createMainProtectedAliasSpec({ projectIds }) {
  const ids = canonicalProjectIds(projectIds);
  const entries = [];
  for (const target of MAIN_DEPLOYMENT_TARGETS) {
    const contract = MAIN_TARGET_CONTRACTS[target];
    for (const alias of contract.aliases) {
      entries.push({
        alias,
        projectId: ids[target],
        projectName: contract.projectName,
        target: contract.target,
        customEnvironmentSlug: contract.customEnvironmentSlug,
        git: expectedGit("main"),
      });
    }
  }
  const spec = entries.sort((left, right) =>
    left.alias.localeCompare(right.alias),
  );
  return assertSnapshotSpec(spec);
}

export function createMainLegacyAliasSpec({ projectIds }) {
  const ids = canonicalProjectIds(projectIds);
  return assertSnapshotSpec([
    {
      alias: LEGACY_ALIAS,
      projectId: ids.app,
      projectName: MAIN_TARGET_CONTRACTS.app.projectName,
      target: "production",
      customEnvironmentSlug: null,
      git: expectedGit("v2"),
    },
  ]);
}

function canonicalPlanningSnapshotForSpec({ snapshot, projectIds }) {
  const canonical = assertMainPlanningSnapshot(snapshot);
  const spec = createMainProtectedAliasSpec({ projectIds });
  if (canonical.states.length !== spec.length) {
    throw new Error("Protected snapshot does not contain every reviewed alias");
  }
  const ordered = canonical.states.toSorted((left, right) =>
    left.alias.localeCompare(right.alias),
  );
  for (const [index, state] of ordered.entries()) {
    const expected = spec[index];
    if (
      state.alias !== expected.alias ||
      state.projectId !== expected.projectId ||
      state.projectName !== expected.projectName ||
      state.target !== expected.target ||
      state.customEnvironmentSlug !== expected.customEnvironmentSlug ||
      state.readyState !== "READY" ||
      !state.aliases.includes(expected.alias)
    ) {
      throw new Error(
        `Protected snapshot state is ambiguous for ${expected.alias}`,
      );
    }
    if (
      expected.customEnvironmentSlug === "v3" &&
      JSON.stringify(state.aliases) !==
        JSON.stringify([...MAIN_TARGET_CONTRACTS.app.aliases])
    ) {
      throw new Error("Protected App alias set is ambiguous");
    }
  }
  return { schema: canonical.schema, states: ordered };
}

function canonicalLegacySnapshotForSpec({ snapshot, projectIds }) {
  assertCanonicalOutput(snapshot);
  const spec = createMainLegacyAliasSpec({ projectIds });
  if (!Array.isArray(snapshot) || snapshot.length !== 1) {
    throw new Error("Legacy snapshot must contain exactly v2-app.mento.org");
  }
  const state = snapshot[0];
  const expected = spec[0];
  if (
    state.alias !== expected.alias ||
    state.projectId !== expected.projectId ||
    state.projectName !== expected.projectName ||
    state.target !== expected.target ||
    state.customEnvironmentSlug !== expected.customEnvironmentSlug ||
    state.git.org !== expected.git.org ||
    state.git.repo !== expected.git.repo ||
    state.git.ref !== expected.git.ref ||
    state.readyState !== "READY"
  ) {
    throw new Error("Legacy app rollback state is ambiguous");
  }
  return [state];
}

function groupSnapshot(snapshot, target) {
  const aliases = MAIN_TARGET_CONTRACTS[target].aliases;
  const states = snapshot.filter((state) => aliases.includes(state.alias));
  if (states.length !== aliases.length) {
    throw new Error(`Protected snapshot is incomplete for ${target}`);
  }
  return { health: "passed", states };
}

function canonicalPrior(value, label) {
  assertExactKeys(value, PRIOR_KEYS, label);
  const aliases = value.aliases.map(canonicalizeHostname).sort();
  if (
    aliases.length === 0 ||
    new Set(aliases).size !== aliases.length ||
    JSON.stringify(aliases) !== JSON.stringify(value.aliases)
  ) {
    throw new Error(`${label} aliases are malformed`);
  }
  return {
    deploymentId: requireString(
      value.deploymentId,
      `${label} deployment ID`,
      DEPLOYMENT_ID_PATTERN,
    ),
    deploymentUrl: canonicalizeDeploymentUrl(value.deploymentUrl),
    aliases,
  };
}

function legacyPriorFromSnapshot(snapshot, projectId) {
  const states = snapshot.filter((state) => state.alias === LEGACY_ALIAS);
  if (states.length !== 1) {
    throw new Error("Legacy app rollback state is ambiguous");
  }
  const state = states[0];
  const legacyIdentityIsAmbiguous =
    state.projectId !== projectId ||
    state.projectName !== "app.mento.org" ||
    state.target !== "production" ||
    state.customEnvironmentSlug !== null ||
    state.git.org !== "mento-protocol" ||
    state.git.repo !== "frontend-monorepo" ||
    state.git.ref !== "v2" ||
    state.readyState !== "READY";
  if (legacyIdentityIsAmbiguous) {
    throw new Error("Legacy app rollback state is ambiguous");
  }
  if (
    JSON.stringify(state.aliases) !==
    JSON.stringify(MAIN_LEGACY_REQUIRED_ALIAS_TOPOLOGY)
  ) {
    throw new Error(
      `Legacy app generated-alias topology mismatch: ${JSON.stringify({ actualAliases: state.aliases, creatorUsername: state.creatorUsername, expectedAliasTopologies: [MAIN_LEGACY_REQUIRED_ALIAS_TOPOLOGY] })}`,
    );
  }
  return canonicalPrior(
    {
      deploymentId: state.deploymentId,
      deploymentUrl: state.deploymentUrl,
      aliases: MAIN_DURABLE_LEGACY_RECOVERY_ALIASES,
    },
    "Legacy app prior",
  );
}

function canonicalUpstream(upstream) {
  assertExactKeys(upstream, UPSTREAM_KEYS, "Upstream CI receipt");
  return {
    runId: requirePositiveId(upstream.runId, "Upstream run ID"),
    runAttempt: requirePositiveId(upstream.runAttempt, "Upstream run attempt"),
    runUrl: requireUrl(upstream.runUrl, "Upstream run URL"),
    buildAndTestJobUrl: requireUrl(
      upstream.buildAndTestJobUrl,
      "Build and Test job URL",
    ),
  };
}

export function createMainDeploymentPlan({
  mode,
  mainOwnershipMode,
  deploySha,
  projectIds,
  planningSnapshot,
  legacySnapshot,
  rollbackOnlyTargets,
  upstream,
  repoRoot = process.cwd(),
  gitAdapter,
  runPlanner,
}) {
  if (!Object.values(MAIN_DEPLOYMENT_MODES).includes(mode)) {
    throw new Error("Main deployment mode must be shadow or active");
  }
  const sha = requireSha(deploySha);
  const ids = canonicalProjectIds(projectIds);
  const protectedSnapshot = canonicalPlanningSnapshotForSpec({
    snapshot: planningSnapshot,
    projectIds: ids,
  });
  const strictLegacySnapshot = canonicalLegacySnapshotForSpec({
    snapshot: legacySnapshot,
    projectIds: ids,
  });
  const priorStates = Object.fromEntries(
    MAIN_DEPLOYMENT_TARGETS.map((target) => [
      target,
      groupSnapshot(protectedSnapshot.states, target),
    ]),
  );
  const planning = planMainDeployments({
    mode,
    mainOwnershipMode,
    deploySha: sha,
    projectIds: ids,
    priorStates,
    rollbackOnlyTargets,
    repoRoot,
    ...(gitAdapter ? { gitAdapter } : {}),
    ...(runPlanner ? { runPlanner } : {}),
  });
  const result = {
    schema: MAIN_DEPLOYMENT_SCHEMA,
    mode,
    deploySha: sha,
    upstream: canonicalUpstream(upstream),
    projectIds: ids,
    protectedSnapshot,
    legacySnapshot: strictLegacySnapshot,
    planning,
    legacyPrior: legacyPriorFromSnapshot(strictLegacySnapshot, ids.app),
  };
  return assertMainDeploymentHandoff(result);
}

export function assertMainDeploymentHandoff(value) {
  assertExactKeys(value, PLAN_KEYS, "Main deployment handoff");
  if (
    value.schema !== MAIN_DEPLOYMENT_SCHEMA ||
    !Object.values(MAIN_DEPLOYMENT_MODES).includes(value.mode)
  ) {
    throw new Error("Main deployment handoff schema or mode is invalid");
  }
  const deploySha = requireSha(value.deploySha);
  const projectIds = canonicalProjectIds(value.projectIds);
  const upstream = canonicalUpstream(value.upstream);
  const protectedSnapshot = canonicalPlanningSnapshotForSpec({
    snapshot: value.protectedSnapshot,
    projectIds,
  });
  const legacySnapshot = canonicalLegacySnapshotForSpec({
    snapshot: value.legacySnapshot,
    projectIds,
  });
  const planning = assertMainDeploymentPlan(value.planning);
  if (planning.deploySha !== deploySha || planning.mode !== value.mode) {
    throw new Error("Served-SHA plan does not match its workflow handoff");
  }
  const legacyPrior = legacyPriorFromSnapshot(legacySnapshot, projectIds.app);
  if (JSON.stringify(legacyPrior) !== JSON.stringify(value.legacyPrior)) {
    throw new Error("Legacy app prior changed inside the plan handoff");
  }
  return {
    schema: value.schema,
    mode: value.mode,
    deploySha,
    upstream,
    projectIds,
    protectedSnapshot,
    legacySnapshot,
    planning,
    legacyPrior,
  };
}

export function validateMainWorkflowContext({
  repository,
  eventName,
  workflowRef,
  workflowSha,
  deploySha,
}) {
  const sha = requireSha(deploySha);
  if (
    repository !== MAIN_TRANSACTION_REPOSITORY ||
    eventName !== "workflow_run"
  ) {
    throw new Error("Main deployment workflow context is untrusted");
  }
  const expectedRef = `${MAIN_TRANSACTION_REPOSITORY}/${MAIN_DEPLOYMENT_WORKFLOW}@refs/heads/main`;
  if (workflowRef !== expectedRef || workflowSha !== sha) {
    throw new Error(
      "Main deployment workflow definition is not the exact DEPLOY_SHA on main",
    );
  }
  return sha;
}

export function validateMainDeploymentSource({
  repoRoot,
  deploySha,
  workflowSha,
  execute,
}) {
  return validateImmutableMainSource({
    sourcePath: repoRoot,
    deploySha,
    workflowSha,
    ...(execute ? { execute } : {}),
  });
}

export function createMainStageResult({
  target,
  plan,
  state,
  runId,
  runAttempt,
  smokePassed,
  protectedMappingsUnchanged,
}) {
  if (!MAIN_ORDINARY_TARGETS.includes(target)) {
    throw new Error("Stage result target is not an ordinary main target");
  }
  const handoff = assertMainDeploymentHandoff(plan);
  if (!handoff.planning.stagedTargets.includes(target)) {
    throw new Error(`Unselected target ${target} cannot return a stage result`);
  }
  assertCanonicalOutput(state);
  if (Array.isArray(state)) {
    throw new Error("Stage result must contain exactly one deployment");
  }
  assertOnlyExpectedVercelGeneratedAliases(state, target);
  if (
    state.projectId !== handoff.projectIds[target] ||
    state.projectName !== MAIN_TARGET_CONTRACTS[target].projectName ||
    state.readyState !== "READY" ||
    state.target !== "production" ||
    state.customEnvironmentSlug !== null ||
    state.git.org !== "mento-protocol" ||
    state.git.repo !== "frontend-monorepo" ||
    state.git.ref !== "main" ||
    state.git.sha !== handoff.deploySha
  ) {
    throw new Error(`Staged ${target} deployment identity is invalid`);
  }
  if (smokePassed !== true || protectedMappingsUnchanged !== true) {
    throw new Error(`Staged ${target} verification is incomplete`);
  }
  const prior = handoff.planning.priors.find(
    (entry) => entry.target === target,
  );
  const result = {
    schema: MAIN_STAGE_SCHEMA,
    target,
    deploySha: handoff.deploySha,
    transactionKey: `${requirePositiveId(runId, "Run ID")}-${requirePositiveId(
      runAttempt,
      "Run attempt",
    )}-${target}`,
    prior: {
      deploymentId: prior.deploymentId,
      deploymentUrl: prior.deploymentUrl,
      aliases: [...prior.aliases].sort(),
    },
    candidate: {
      deploymentId: state.deploymentId,
      deploymentUrl: state.deploymentUrl,
      aliases: [...prior.aliases].sort(),
      discovery: null,
    },
    verification: {
      canonicalState: "passed",
      immutableSmoke: "passed",
      protectedMappings: "unchanged",
    },
  };
  return assertMainStageResult(result, {
    plan: handoff,
    expectedTarget: target,
  });
}

export function assertMainStageResult(
  value,
  { plan, expectedTarget, expectedRunId, expectedRunAttempt } = {},
) {
  assertExactKeys(value, STAGE_KEYS, "Main stage result");
  if (
    value.schema !== MAIN_STAGE_SCHEMA ||
    !MAIN_ORDINARY_TARGETS.includes(value.target) ||
    (expectedTarget && value.target !== expectedTarget)
  ) {
    throw new Error("Main stage result target is invalid");
  }
  const deploySha = requireSha(value.deploySha, "Stage DEPLOY_SHA");
  const prior = canonicalPrior(value.prior, "Stage prior");
  assertExactKeys(value.candidate, CANDIDATE_KEYS, "Stage candidate");
  if (value.candidate.discovery !== null) {
    throw new Error("Ordinary stage candidate discovery must be null");
  }
  const candidate = {
    deploymentId: requireString(
      value.candidate.deploymentId,
      "Stage candidate deployment ID",
      DEPLOYMENT_ID_PATTERN,
    ),
    deploymentUrl: canonicalizeDeploymentUrl(value.candidate.deploymentUrl),
    aliases: canonicalPrior(
      {
        deploymentId: value.candidate.deploymentId,
        deploymentUrl: value.candidate.deploymentUrl,
        aliases: value.candidate.aliases,
      },
      "Stage candidate",
    ).aliases,
    discovery: null,
  };
  if (JSON.stringify(candidate.aliases) !== JSON.stringify(prior.aliases)) {
    throw new Error("Stage candidate protected alias intent changed");
  }
  assertExactKeys(value.verification, VERIFICATION_KEYS, "Stage verification");
  if (
    value.verification.canonicalState !== "passed" ||
    value.verification.immutableSmoke !== "passed" ||
    value.verification.protectedMappings !== "unchanged"
  ) {
    throw new Error("Stage verification is incomplete");
  }
  requireString(
    value.transactionKey,
    "Stage transaction key",
    /^[1-9][0-9]*-[1-9][0-9]*-(?:governance|reserve|ui)$/,
  );
  if (expectedRunId !== undefined || expectedRunAttempt !== undefined) {
    const expectedKey = `${requirePositiveId(
      expectedRunId,
      "Expected run ID",
    )}-${requirePositiveId(
      expectedRunAttempt,
      "Expected run attempt",
    )}-${value.target}`;
    if (value.transactionKey !== expectedKey) {
      throw new Error(
        "Stage transaction key does not match the coordinator attempt",
      );
    }
  }
  if (plan) {
    const handoff = assertMainDeploymentHandoff(plan);
    if (
      deploySha !== handoff.deploySha ||
      !handoff.planning.stagedTargets.includes(value.target)
    ) {
      throw new Error("Stage result does not match its plan");
    }
    const expectedPrior = handoff.planning.priors.find(
      (entry) => entry.target === value.target,
    );
    if (
      JSON.stringify(prior) !==
      JSON.stringify({
        deploymentId: expectedPrior.deploymentId,
        deploymentUrl: expectedPrior.deploymentUrl,
        aliases: [...expectedPrior.aliases].sort(),
      })
    ) {
      throw new Error("Stage result prior does not match the captured plan");
    }
  }
  return {
    schema: value.schema,
    target: value.target,
    deploySha,
    transactionKey: value.transactionKey,
    prior,
    candidate,
    verification: { ...value.verification },
  };
}

export function validateMainStageJobs({ plan, jobs, runId, runAttempt }) {
  const handoff = assertMainDeploymentHandoff(plan);
  const expectedRunId = requirePositiveId(runId, "Expected run ID");
  const expectedRunAttempt = requirePositiveId(
    runAttempt,
    "Expected run attempt",
  );
  assertExactKeys(jobs, MAIN_ORDINARY_TARGETS, "Main stage jobs");
  const results = {};
  for (const target of MAIN_ORDINARY_TARGETS) {
    const job = jobs[target];
    assertExactKeys(job, ["result", "handoff"], `${target} stage job`);
    if (!JOB_RESULTS.has(job.result)) {
      throw new Error(`${target} stage job result is invalid`);
    }
    const selected = handoff.planning.stagedTargets.includes(target);
    if (selected) {
      if (job.result !== "success" || !job.handoff) {
        throw new Error(`Selected ${target} stage did not succeed`);
      }
      results[target] = assertMainStageResult(job.handoff, {
        plan: handoff,
        expectedTarget: target,
        expectedRunId,
        expectedRunAttempt,
      });
    } else {
      if (job.result !== "skipped" || job.handoff !== null) {
        throw new Error(`Unselected ${target} stage was not cleanly skipped`);
      }
      results[target] = null;
    }
  }
  return {
    outcome:
      handoff.planning.stagedTargets.length === 0 ? "no-target" : "eligible",
    activeTargetCount: handoff.planning.activeTargets.length,
    stages: results,
  };
}

export function createMainAppTransactionMetadata({
  deploySha,
  runId,
  runAttempt,
  transactionId,
  nextDeploymentId,
}) {
  return {
    githubCommitOrg: "mento-protocol",
    githubCommitRepo: "frontend-monorepo",
    githubCommitRef: "main",
    githubCommitSha: requireSha(deploySha),
    mentoTransactionId: requireString(
      transactionId,
      "App transaction ID",
      /^main-[a-f0-9]{32}$/,
    ),
    mentoRunId: requirePositiveId(runId, "App run ID"),
    mentoRunAttempt: requirePositiveId(runAttempt, "App run attempt"),
    mentoNextDeploymentId: requireString(
      nextDeploymentId,
      "App custom Next deployment ID",
      /^(?!dpl_)[A-Za-z0-9_-]{1,32}$/,
    ),
  };
}

export function createMainAppBuildProof({ intent }) {
  const candidateIntent = assertMainCandidateIntent(intent);
  if (
    candidateIntent.target !== "app" ||
    candidateIntent.environment.target !== null ||
    candidateIntent.environment.customEnvironmentSlug !== "v3"
  ) {
    throw new Error(
      "App build proof requires the exact App v3 candidate intent",
    );
  }
  const identity = {
    repository: MAIN_TRANSACTION_REPOSITORY,
    deploySha: candidateIntent.deploySha,
    runId: candidateIntent.originRunId,
    runAttempt: candidateIntent.originAttempt,
  };
  const transactionId = createMainTransactionId(identity);
  if (candidateIntent.originTransactionId !== transactionId) {
    throw new Error(
      "App candidate intent transaction differs from its current-attempt identity",
    );
  }
  const nextDeploymentId = candidateIntent.candidateId;
  return {
    schema: APP_BUILD_PROOF_SCHEMA,
    intent: candidateIntent,
    target: "app",
    deploySha: identity.deploySha,
    runId: identity.runId,
    runAttempt: identity.runAttempt,
    transactionId,
    projectId: candidateIntent.projectId,
    projectName: "app.mento.org",
    customEnvironmentSlug: "v3",
    vercelEnv: "preview",
    vercelTargetEnv: "v3",
    nextPublicVercelEnv: "preview",
    sentryAuthToken: "",
    nextDeploymentId,
    deployReachable: false,
    metadata: createMainAppTransactionMetadata({
      ...identity,
      transactionId,
      nextDeploymentId,
    }),
    candidateMetadata: createMainCandidateVercelMetadata({
      intent: candidateIntent,
    }),
  };
}

export function createMainAppCandidateExpectation({ journal, projectId }) {
  const canonical = assertMainTransactionJournal(journal);
  const app = canonical.candidates.app;
  if (app === null || app.discovery === null) {
    throw new Error("Journal does not contain App candidate discovery");
  }
  if (app.discovery.projectId !== projectId) {
    throw new Error("App recovery project does not match the journal");
  }
  const nextDeploymentId = generateVercelMainCandidateDeploymentId({
    repository: canonical.repository,
    target: "app",
    commitSha: canonical.deploySha,
    upstreamRunId: canonical.release.upstreamRunId,
  });
  if (app.discovery.candidateId !== nextDeploymentId) {
    throw new Error(
      "App recovery candidate differs from the stable release ID",
    );
  }
  return {
    projectId: requireString(projectId, "App project ID"),
    projectName: "app.mento.org",
    deploySha: canonical.deploySha,
    runId: canonical.runId,
    runAttempt: canonical.runAttempt,
    transactionId: canonical.transactionId,
    customEnvironmentSlug: "v3",
    nextDeploymentId,
  };
}

function assertAppBuildProof(proof, intent) {
  const expected = createMainAppBuildProof({ intent });
  if (JSON.stringify(expected) !== JSON.stringify(proof)) {
    throw new Error("App v3 build proof is invalid");
  }
  return expected;
}

function releaseManifestFromHandoff(handoff) {
  const originalPriors = Object.fromEntries(
    ["governance", "reserve", "ui", "app"].map((target) => {
      const planned = handoff.planning.priors.find(
        (entry) => entry.target === target,
      );
      const leaves = handoff.protectedSnapshot.states.filter((state) =>
        planned.aliases.includes(state.alias),
      );
      if (leaves.length !== planned.aliases.length) {
        throw new Error(`Release manifest lacks ${target} original mappings`);
      }
      const first = leaves[0];
      const git = first.git;
      if (
        !git ||
        git.org !== "mento-protocol" ||
        git.repo !== "frontend-monorepo" ||
        git.ref !== "main" ||
        git.sha !== planned.servedSha
      ) {
        throw new Error(
          `Release manifest ${target} Git evidence is not complete`,
        );
      }
      return [
        target,
        {
          deploymentId: planned.deploymentId,
          deploymentUrl: planned.deploymentUrl,
          aliases: [...planned.aliases],
          projectId: first.projectId,
          projectName: first.projectName,
          readyState: first.readyState,
          target: first.target,
          customEnvironmentSlug: first.customEnvironmentSlug,
          planningLeaves: planned.aliases.map((alias) => ({
            alias,
            deploymentId: planned.deploymentId,
            deploymentUrl: planned.deploymentUrl,
            aliases: [...planned.aliases],
            projectId: first.projectId,
            projectName: first.projectName,
            readyState: first.readyState,
            target: first.target,
            customEnvironmentSlug: first.customEnvironmentSlug,
            git: {
              status: "complete",
              org: git.org,
              repo: git.repo,
              ref: git.ref,
              sha: git.sha,
            },
          })),
          servedSha: planned.servedSha,
        },
      ];
    }),
  );
  return createMainReleaseManifest({
    upstreamRunId: handoff.upstream.runId,
    plan: handoff.planning,
    originalPriors,
  });
}

function startMappingsFromPrior(prior) {
  return Object.fromEntries(
    ["app", "governance", "reserve", "ui", "legacy-app"].map((target) => [
      target,
      prior[target].aliases.map((alias) => ({
        alias,
        deploymentId: prior[target].deploymentId,
        deploymentUrl: prior[target].deploymentUrl,
      })),
    ]),
  );
}

function v3Candidate(candidate, target, release) {
  if (candidate === null) return null;
  const prior = release.originalPriors[target];
  const deploymentUrl =
    candidate.deploymentUrl ?? `https://${target}-candidate.vercel.app`;
  return {
    deploymentId: candidate.deploymentId,
    deploymentUrl: candidate.deploymentUrl === null ? null : deploymentUrl,
    aliases: [...prior.aliases],
    discovery: {
      releaseId: release.releaseId,
      candidateId: generateVercelMainCandidateDeploymentId({
        repository: MAIN_TRANSACTION_REPOSITORY,
        target,
        commitSha: release.deploySha,
        upstreamRunId: release.upstreamRunId,
      }),
      projectId: prior.projectId,
      projectName: prior.projectName,
      deploySha: release.deploySha,
      target,
      customEnvironmentSlug: target === "app" ? "v3" : null,
      immutableSmoke: {
        immutableUrl: deploymentUrl,
        servedSha: release.deploySha,
        status: "passed",
      },
      metrics: {
        buildDurationMs: null,
        deploymentDurationMs: null,
        cacheHit: null,
      },
    },
  };
}

export function createMainTransactionInputs({
  plan,
  stageJobs,
  appBuildProof = null,
  appCandidateReceipt = null,
  runId,
  runAttempt,
}) {
  const handoff = assertMainDeploymentHandoff(plan);
  const identity = {
    repository: MAIN_TRANSACTION_REPOSITORY,
    deploySha: handoff.deploySha,
    runId: requirePositiveId(runId, "Run ID"),
    runAttempt: requirePositiveId(runAttempt, "Run attempt"),
  };
  const stages = validateMainStageJobs({
    plan: handoff,
    jobs: stageJobs,
    runId: identity.runId,
    runAttempt: identity.runAttempt,
  }).stages;
  const transactionId = createMainTransactionId(identity);
  const priorByTarget = Object.fromEntries(
    handoff.planning.priors.map((entry) => [
      entry.target,
      canonicalPrior(
        {
          deploymentId: entry.deploymentId,
          deploymentUrl: entry.deploymentUrl,
          aliases: [...entry.aliases].sort(),
        },
        `${entry.target} prior`,
      ),
    ]),
  );
  const prior = {
    app: priorByTarget.app,
    governance: priorByTarget.governance,
    reserve: priorByTarget.reserve,
    ui: priorByTarget.ui,
    "legacy-app": canonicalPrior(handoff.legacyPrior, "Legacy app prior"),
  };
  const release = releaseManifestFromHandoff(handoff);
  const appIntent = handoff.planning.stagedTargets.includes("app")
    ? createMainCandidateIntent({
        target: "app",
        deploySha: release.deploySha,
        upstreamRunId: release.upstreamRunId,
        originRunId: identity.runId,
        originAttempt: identity.runAttempt,
        originTransactionId: transactionId,
        projectId: release.originalPriors.app.projectId,
        projectName: release.originalPriors.app.projectName,
        releaseManifest: release,
      })
    : null;
  let appCandidate = null;
  let appReceipt = null;
  if (handoff.planning.stagedTargets.includes("app")) {
    if ((appBuildProof === null) === (appCandidateReceipt === null)) {
      throw new Error(
        "Selected app requires exactly one build proof or provider candidate receipt",
      );
    }
    appReceipt =
      appCandidateReceipt === null
        ? null
        : assertMainCandidateReceipt(appCandidateReceipt);
    if (appReceipt === null) {
      assertAppBuildProof(appBuildProof, appIntent);
    } else if (
      JSON.stringify(appReceipt.intent) !== JSON.stringify(appIntent)
    ) {
      throw new Error(
        "App provider candidate receipt differs from the selected deployment",
      );
    }
    appCandidate = {
      deploymentId: appReceipt?.candidate.deploymentId ?? null,
      deploymentUrl: appReceipt?.candidate.deploymentUrl ?? null,
      aliases: [...prior.app.aliases],
      discovery: {
        projectId: handoff.projectIds.app,
        projectName: MAIN_TARGET_CONTRACTS.app.projectName,
        deploySha: handoff.deploySha,
        runId: identity.runId,
        runAttempt: identity.runAttempt,
        transactionId,
        customEnvironmentSlug: "v3",
      },
    };
  } else if (appBuildProof !== null || appCandidateReceipt !== null) {
    throw new Error(
      "Unselected app returned build proof or provider candidate receipt",
    );
  }
  const candidates = {
    app: appCandidate,
    governance: stages.governance?.candidate ?? null,
    reserve: stages.reserve?.candidate ?? null,
    ui: stages.ui?.candidate ?? null,
  };
  const v3Candidates = Object.fromEntries(
    MAIN_DEPLOYMENT_TARGETS.map((target) => [
      target,
      release.activeTargets.includes(target)
        ? v3Candidate(candidates[target], target, release)
        : null,
    ]),
  );
  return {
    identity,
    release,
    prior,
    startMappings: startMappingsFromPrior(prior),
    candidates: v3Candidates,
    appReceipt,
  };
}

export function createMainActiveTransactionInputs({
  plan,
  stageJobs,
  appBuildProof = null,
  appCandidateReceipt = null,
  runId,
  runAttempt,
}) {
  const handoff = assertMainDeploymentHandoff(plan);
  const inputs = createMainTransactionInputs({
    plan: handoff,
    stageJobs,
    appBuildProof,
    appCandidateReceipt,
    runId,
    runAttempt,
  });
  const planning = createMainActivePlanning({ plan });
  const candidates = Object.fromEntries(
    MAIN_DEPLOYMENT_TARGETS.map((target) => [
      target,
      planning.mainOwnershipMode[target] === MAIN_OWNERSHIP_MODES.GITHUB
        ? inputs.candidates[target]
        : null,
    ]),
  );
  return {
    identity: inputs.identity,
    release: inputs.release,
    prior: inputs.prior,
    startMappings: inputs.startMappings,
    candidates,
    stagedCandidates: inputs.candidates,
    projectIds: handoff.projectIds,
    planning,
    appReceipt: inputs.appReceipt,
  };
}

export function createPreparedMainActiveJournal(options) {
  const inputs = createMainActiveTransactionInputs(options);
  return createPreparedMainTransactionJournal({
    ...inputs.identity,
    mode: MAIN_ACTIVE_DEPLOYMENT_MODE,
    release: inputs.release,
    prior: inputs.prior,
    startMappings: inputs.startMappings,
    candidates: inputs.candidates,
  });
}

const STAGE_BARRIER_TARGETS = Object.freeze([
  "app",
  "governance",
  "reserve",
  "ui",
]);

function currentAttemptIdentity({ execution, runId, runAttempt }) {
  const canonical = assertMainReleaseExecution(execution);
  const identity = {
    repository: MAIN_TRANSACTION_REPOSITORY,
    deploySha: canonical.manifest.deploySha,
    runId: requirePositiveId(runId, "Current main run ID"),
    runAttempt: requirePositiveId(runAttempt, "Current main run attempt"),
  };
  return { execution: canonical, identity };
}

function expectedCurrentCandidateIntent(execution, identity, target) {
  const prior = execution.manifest.originalPriors[target];
  return createMainCandidateIntent({
    target,
    deploySha: execution.manifest.deploySha,
    upstreamRunId: execution.manifest.upstreamRunId,
    originRunId: identity.runId,
    originAttempt: identity.runAttempt,
    originTransactionId: createMainTransactionId(identity),
    projectId: prior.projectId,
    projectName: prior.projectName,
    releaseManifest: execution.manifest,
  });
}

export function createMainCurrentCandidateIntent({
  execution,
  target,
  runId,
  runAttempt,
}) {
  const current = currentAttemptIdentity({ execution, runId, runAttempt });
  return expectedCurrentCandidateIntent(
    current.execution,
    current.identity,
    target,
  );
}

function canonicalAppPreparation(value, execution, identity) {
  return assertAppBuildProof(
    value,
    expectedCurrentCandidateIntent(execution, identity, "app"),
  );
}

// This is the only stage handoff the automatic controller accepts. It binds
// every candidate to the asserted execution and this downstream attempt,
// while keeping shadow receipts out of transaction mutation authority.
export function createMainStageBarrier({
  execution,
  candidateReceipts,
  appPreparation,
  runId,
  runAttempt,
}) {
  const current = currentAttemptIdentity({ execution, runId, runAttempt });
  assertExactKeys(
    candidateReceipts,
    STAGE_BARRIER_TARGETS,
    "Current main candidate receipts",
  );
  const selected = new Set(current.execution.projection.stagedTargets);
  const stages = {};
  for (const target of STAGE_BARRIER_TARGETS) {
    const receipt = candidateReceipts[target];
    if (!selected.has(target)) {
      if (receipt !== null) {
        throw new Error(`Unselected ${target} has a candidate receipt`);
      }
      stages[target] = {
        kind: "not-selected",
        receipt: null,
        preparation: null,
      };
      continue;
    }
    if (target === "app" && receipt === null) {
      stages.app = {
        kind: "pending-app",
        receipt: null,
        preparation: canonicalAppPreparation(
          appPreparation,
          current.execution,
          current.identity,
        ),
      };
      continue;
    }
    if (receipt === null) {
      throw new Error(`Selected ${target} requires an exact candidate receipt`);
    }
    stages[target] = {
      kind: "receipt",
      receipt: assertMainCandidateReceipt(
        receipt,
        expectedCurrentCandidateIntent(
          current.execution,
          current.identity,
          target,
        ),
      ),
      preparation: null,
    };
  }
  if (stages.app.kind !== "pending-app" && appPreparation !== null) {
    throw new Error("Unexpected App preparation proof");
  }
  return {
    schema: MAIN_STAGE_BARRIER_SCHEMA,
    releaseId: current.execution.manifest.releaseId,
    releaseExecutionDigest: digestMainReleaseExecution(current.execution),
    deploySha: current.execution.manifest.deploySha,
    runId: current.identity.runId,
    runAttempt: current.identity.runAttempt,
    stages,
  };
}

export function assertMainStageBarrier(
  value,
  { execution, runId, runAttempt },
) {
  assertExactKeys(
    value,
    [
      "schema",
      "releaseId",
      "releaseExecutionDigest",
      "deploySha",
      "runId",
      "runAttempt",
      "stages",
    ],
    "Current main stage barrier",
  );
  const current = currentAttemptIdentity({ execution, runId, runAttempt });
  if (
    value.schema !== MAIN_STAGE_BARRIER_SCHEMA ||
    value.releaseId !== current.execution.manifest.releaseId ||
    value.releaseExecutionDigest !==
      digestMainReleaseExecution(current.execution) ||
    value.deploySha !== current.execution.manifest.deploySha ||
    value.runId !== current.identity.runId ||
    value.runAttempt !== current.identity.runAttempt
  ) {
    throw new Error("Current main stage barrier identity is inconsistent");
  }
  assertExactKeys(
    value.stages,
    STAGE_BARRIER_TARGETS,
    "Current main barrier stages",
  );
  for (const target of STAGE_BARRIER_TARGETS) {
    const stage = value.stages[target];
    assertExactKeys(
      stage,
      ["kind", "receipt", "preparation"],
      `Current main barrier ${target}`,
    );
    if (
      !["not-selected", "receipt", "pending-app"].includes(stage.kind) ||
      (stage.kind === "pending-app" && target !== "app")
    ) {
      throw new Error(`Current main barrier ${target} kind is invalid`);
    }
  }
  const canonical = createMainStageBarrier({
    execution: current.execution,
    candidateReceipts: Object.fromEntries(
      STAGE_BARRIER_TARGETS.map((target) => [
        target,
        value.stages[target]?.receipt ?? null,
      ]),
    ),
    appPreparation: value.stages.app?.preparation ?? null,
    runId: current.identity.runId,
    runAttempt: current.identity.runAttempt,
  });
  assertSameJson(value, canonical, "Current main stage barrier");
  return canonical;
}

export function createMainCurrentActiveInputs({
  execution,
  barrier,
  currentMappings,
  runId,
  runAttempt,
}) {
  const current = currentAttemptIdentity({ execution, runId, runAttempt });
  const canonicalBarrier = assertMainStageBarrier(barrier, {
    execution: current.execution,
    runId: current.identity.runId,
    runAttempt: current.identity.runAttempt,
  });
  const candidateReceipts = Object.fromEntries(
    STAGE_BARRIER_TARGETS.map((target) => [
      target,
      current.execution.projection.activeTargets.includes(target)
        ? canonicalBarrier.stages[target].receipt
        : null,
    ]),
  );
  const journal = createMainForwardTransactionJournal({
    releaseExecution: current.execution,
    currentMappings,
    candidateReceipts,
    runId: current.identity.runId,
    runAttempt: current.identity.runAttempt,
  });
  const stagedCandidates = Object.fromEntries(
    STAGE_BARRIER_TARGETS.map((target) => {
      const stage = canonicalBarrier.stages[target];
      if (stage.kind === "not-selected") return [target, null];
      if (stage.kind === "pending-app") {
        return [target, { deploymentId: null, deploymentUrl: null }];
      }
      return [
        target,
        {
          deploymentId: stage.receipt.candidate.deploymentId,
          deploymentUrl: stage.receipt.candidate.deploymentUrl,
        },
      ];
    }),
  );
  return {
    execution: current.execution,
    barrier: canonicalBarrier,
    journal,
    planning: {
      activeTargets: [...current.execution.projection.activeTargets],
      shadowTargets: [...current.execution.projection.shadowTargets],
      stagedCandidates,
      mainOwnershipMode: structuredClone(
        current.execution.manifest.mainOwnershipMode,
      ),
      projectIds: structuredClone(current.execution.projection.projectIds),
    },
  };
}

function currentActiveHistory({
  execution,
  barrier,
  journalHistory,
  runId,
  runAttempt,
}) {
  const current = currentAttemptIdentity({ execution, runId, runAttempt });
  const canonicalBarrier = assertMainStageBarrier(barrier, {
    execution: current.execution,
    runId: current.identity.runId,
    runAttempt: current.identity.runAttempt,
  });
  const journals = assertMainActiveJournalHistory({
    journals: activeJournalArray(
      journalHistory,
      "Current active journal history",
    ),
    deploySha: current.execution.manifest.deploySha,
    runId: current.identity.runId,
    runAttempt: current.identity.runAttempt,
  });
  return { current, barrier: canonicalBarrier, highest: journals.at(-1) };
}

function currentReleaseVerification({ execution, barrier, runId, runAttempt }) {
  const current = currentAttemptIdentity({ execution, runId, runAttempt });
  const canonicalBarrier = assertMainStageBarrier(barrier, {
    execution: current.execution,
    runId: current.identity.runId,
    runAttempt: current.identity.runAttempt,
  });
  if (
    current.execution.decision !== "verify-existing-release" ||
    current.execution.reason !== "current-main-release-already-complete" ||
    current.execution.projection.activeTargets.length === 0
  ) {
    throw new Error("Current release verification conflicts with execution");
  }
  for (const target of current.execution.projection.activeTargets) {
    const stage = canonicalBarrier.stages[target];
    if (stage.kind !== "receipt" || stage.receipt === null) {
      throw new Error(
        `Current release verification ${target} lacks an exact candidate receipt`,
      );
    }
  }
  return { current, barrier: canonicalBarrier };
}

function currentStateProject({ current, barrier, target, candidate }) {
  const active = current.execution.projection.activeTargets;
  const shadow = current.execution.projection.shadowTargets;
  const isActive = active.includes(target);
  const isShadow = shadow.includes(target);
  const stage = barrier.stages[target];
  const expected = isActive
    ? candidate
    : isShadow && target !== "app" && stage.receipt !== null
      ? {
          deploymentId: stage.receipt.candidate.deploymentId,
          deploymentUrl: stage.receipt.candidate.deploymentUrl,
        }
      : null;
  if (isActive && (expected === null || expected.deploymentId === null)) {
    throw new Error(
      `Current active state spec ${target} candidate is pending or absent`,
    );
  }
  return [
    target,
    {
      projectId: current.execution.projection.projectIds[target],
      projectName: `${target}.mento.org`,
      expectedDisposition: isActive
        ? "githubPrebuilt"
        : isShadow && target !== "app"
          ? "githubShadowStage"
          : null,
      deploymentId: expected?.deploymentId ?? null,
      deploymentUrl: expected?.deploymentUrl ?? null,
      target: target === "app" ? null : "production",
      customEnvironmentSlug: target === "app" ? "v3" : null,
    },
  ];
}

export function createMainCurrentActiveDeploymentStateSpec({
  execution,
  barrier,
  journalHistory,
  runId,
  runAttempt,
}) {
  const {
    current,
    barrier: canonicalBarrier,
    highest,
  } = currentActiveHistory({
    execution,
    barrier,
    journalHistory,
    runId,
    runAttempt,
  });
  const active = current.execution.projection.activeTargets;
  const shadow = current.execution.projection.shadowTargets;
  const staged = current.execution.projection.stagedTargets;
  const projects = Object.fromEntries(
    STAGE_BARRIER_TARGETS.map((target) =>
      currentStateProject({
        current,
        barrier: canonicalBarrier,
        target,
        candidate: active.includes(target) ? highest.candidates[target] : null,
      }),
    ),
  );
  const legacy = current.execution.legacyAppV2;
  return assertActiveDeploymentStateSpec({
    schema: ACTIVE_DEPLOYMENT_STATE_SPEC_SCHEMA,
    deploySha: current.execution.manifest.deploySha,
    runId: current.identity.runId,
    runAttempt: current.identity.runAttempt,
    transactionId: highest.transactionId,
    releaseManifest: current.execution.manifest,
    mainOwnershipMode: current.execution.manifest.mainOwnershipMode,
    stagedTargets: staged,
    activeTargets: active,
    shadowTargets: shadow,
    projects,
    legacyAppV2: {
      alias: legacy.alias,
      deployment: legacy.deploymentId,
      deploymentUrl: legacy.deploymentUrl,
      projectId: legacy.projectId,
      projectName: legacy.projectName,
      readyState: legacy.readyState,
      target: legacy.target,
      customEnvironmentSlug: legacy.customEnvironmentSlug,
      git: { ...legacy.git },
    },
  });
}

export function createMainCurrentReleaseVerifiedDeploymentStateSpec({
  execution,
  barrier,
  runId,
  runAttempt,
}) {
  const { current, barrier: canonicalBarrier } = currentReleaseVerification({
    execution,
    barrier,
    runId,
    runAttempt,
  });
  const legacy = current.execution.legacyAppV2;
  return assertActiveDeploymentStateSpec({
    schema: ACTIVE_DEPLOYMENT_STATE_SPEC_SCHEMA,
    deploySha: current.execution.manifest.deploySha,
    runId: current.identity.runId,
    runAttempt: current.identity.runAttempt,
    transactionId: createMainTransactionId(current.identity),
    releaseManifest: current.execution.manifest,
    mainOwnershipMode: current.execution.manifest.mainOwnershipMode,
    stagedTargets: current.execution.projection.stagedTargets,
    activeTargets: current.execution.projection.activeTargets,
    shadowTargets: current.execution.projection.shadowTargets,
    projects: Object.fromEntries(
      STAGE_BARRIER_TARGETS.map((target) =>
        currentStateProject({
          current,
          barrier: canonicalBarrier,
          target,
          candidate: current.execution.projection.activeTargets.includes(target)
            ? canonicalBarrier.stages[target].receipt.candidate
            : null,
        }),
      ),
    ),
    legacyAppV2: {
      alias: legacy.alias,
      deployment: legacy.deploymentId,
      deploymentUrl: legacy.deploymentUrl,
      projectId: legacy.projectId,
      projectName: legacy.projectName,
      readyState: legacy.readyState,
      target: legacy.target,
      customEnvironmentSlug: legacy.customEnvironmentSlug,
      git: { ...legacy.git },
    },
  });
}

export function createMainCurrentActiveAliasMappingSet({
  execution,
  barrier,
  journalHistory,
  runId,
  runAttempt,
}) {
  const { highest } = currentActiveHistory({
    execution,
    barrier,
    journalHistory,
    runId,
    runAttempt,
  });
  return assertActiveAliasMappingSet({
    schema: ACTIVE_ALIAS_MAPPING_SET_SCHEMA,
    aliases: [
      ...STAGE_BARRIER_TARGETS.flatMap(
        (target) => highest.prior[target].aliases,
      ),
      ...highest.prior["legacy-app"].aliases,
    ].toSorted(),
  });
}

export function createMainCurrentReleaseVerifiedAliasMappingSet({
  execution,
  barrier,
  runId,
  runAttempt,
}) {
  const { current } = currentReleaseVerification({
    execution,
    barrier,
    runId,
    runAttempt,
  });
  return assertActiveAliasMappingSet({
    schema: ACTIVE_ALIAS_MAPPING_SET_SCHEMA,
    aliases: [
      ...STAGE_BARRIER_TARGETS.flatMap(
        (target) => current.execution.manifest.originalPriors[target].aliases,
      ),
      ...current.execution.legacyAppV2.aliases,
    ].toSorted(),
  });
}

export function createMainActiveRecoveryMappingSpec({
  journalHistory,
  runId,
  runAttempt,
}) {
  const journals = activeJournalArray(
    journalHistory,
    "Active recovery mapping-spec journal history",
  );
  if (journals.length === 0) {
    throw new Error("Active recovery mapping spec requires journal history");
  }
  const observedHead = journals.at(-1);
  const history = assertMainActiveJournalHistory({
    journals,
    deploySha: observedHead.deploySha,
    runId: requirePositiveId(runId, "Active recovery mapping-spec run ID"),
    runAttempt: requirePositiveId(
      runAttempt,
      "Active recovery mapping-spec run attempt",
    ),
  });
  const highest = history.at(-1);
  const release = assertMainReleaseManifest(highest.release);
  const bindings = [];
  const aliases = new Set();
  for (const target of ["app", "governance", "reserve", "ui", "legacy-app"]) {
    const releaseTarget =
      target === "legacy-app"
        ? release.originalPriors.app
        : release.originalPriors[target];
    const prior = highest.prior[target];
    if (
      target !== "legacy-app" &&
      (!sameJson(prior.aliases, releaseTarget.aliases) ||
        prior.deploymentId !== releaseTarget.deploymentId ||
        prior.deploymentUrl !== releaseTarget.deploymentUrl)
    ) {
      throw new Error(
        `Active recovery ${target} prior conflicts with the release`,
      );
    }
    if (
      target === "legacy-app" &&
      !sameJson(prior.aliases, MAIN_LEGACY_REQUIRED_ALIAS_TOPOLOGY)
    ) {
      throw new Error("Active recovery legacy App topology is incomplete");
    }
    for (const alias of prior.aliases) {
      if (aliases.has(alias)) {
        throw new Error("Active recovery mapping aliases overlap");
      }
      aliases.add(alias);
      bindings.push({
        alias,
        projectId: releaseTarget.projectId,
        target,
      });
    }
  }
  return assertActiveAliasMappingSpec({
    schema: ACTIVE_ALIAS_MAPPING_SPEC_SCHEMA,
    bindings: bindings.toSorted((left, right) =>
      left.alias.localeCompare(right.alias),
    ),
  });
}

// The provider captures bound mappings as a flat alias list. Re-derive the
// allowed bindings from the current-attempt journal before grouping that list
// into the transaction's canonical target shape. This deliberately keeps
// project IDs while validating the capture and removes them only from the
// post-binding handoff consumed by terminal artifacts.
export function createMainActiveRecoveryCanonicalMappings({
  journalHistory,
  mappings,
  runId,
  runAttempt,
}) {
  const spec = createMainActiveRecoveryMappingSpec({
    journalHistory,
    runId,
    runAttempt,
  });
  if (!Array.isArray(mappings) || mappings.length !== spec.bindings.length) {
    throw new Error("Active recovery bound mappings are incomplete");
  }
  const bound = mappings.map((value, index) => {
    const binding = spec.bindings[index];
    const hasProjectId = Object.hasOwn(value ?? {}, "projectId");
    assertExactKeys(
      value,
      hasProjectId
        ? ["alias", "deploymentId", "deploymentUrl", "projectId"]
        : ["alias", "deploymentId", "deploymentUrl"],
      `Active recovery bound mapping ${index + 1}`,
    );
    const alias = canonicalizeHostname(value.alias);
    const deploymentId = requireString(
      value.deploymentId,
      `Active recovery bound mapping ${index + 1} deployment ID`,
      DEPLOYMENT_ID_PATTERN,
    );
    const deploymentUrl = canonicalizeDeploymentUrl(value.deploymentUrl);
    if (
      alias !== binding.alias ||
      value.alias !== alias ||
      value.deploymentUrl !== deploymentUrl ||
      (binding.target === "legacy-app"
        ? !hasProjectId ||
          requireString(
            value.projectId,
            `Active recovery bound mapping ${index + 1} project ID`,
          ) !== binding.projectId
        : hasProjectId)
    ) {
      throw new Error("Active recovery bound mapping conflicts with its spec");
    }
    return {
      alias,
      deploymentId,
      deploymentUrl,
      ...(binding.target === "legacy-app"
        ? { projectId: binding.projectId }
        : {}),
    };
  });
  assertSameJson(mappings, bound, "Active recovery bound mappings");
  return {
    schema: "vercel-main-canonical-mappings:v1",
    mappings: Object.fromEntries(
      ["governance", "reserve", "ui", "app", "legacy-app"].map((target) => [
        target,
        spec.bindings
          .map((binding, index) => ({ binding, mapping: bound[index] }))
          .filter(({ binding }) => binding.target === target)
          .map(({ mapping }) => ({
            alias: mapping.alias,
            deploymentId: mapping.deploymentId,
            deploymentUrl: mapping.deploymentUrl,
          })),
      ]),
    ),
  };
}

// Recovery has no stage barrier to trust. The exact execution supplies the
// immutable release and captured v2 state, while the current-attempt journal
// supplies the candidate and transaction authority. No provider-built input
// can alter this spec.
export function createMainActiveRecoveryDeploymentStateSpec({
  execution,
  journalHistory,
  runId,
  runAttempt,
}) {
  const releaseExecution = assertMainReleaseExecution(execution);
  const journals = activeJournalArray(
    journalHistory,
    "Active recovery state-spec journal history",
  );
  if (journals.length === 0) {
    throw new Error("Active recovery state spec requires journal history");
  }
  const observedHead = journals.at(-1);
  const history = assertMainActiveJournalHistory({
    journals,
    deploySha: observedHead.deploySha,
    runId: requirePositiveId(runId, "Active recovery state-spec run ID"),
    runAttempt: requirePositiveId(
      runAttempt,
      "Active recovery state-spec run attempt",
    ),
  });
  const highest = history.at(-1);
  if (!["recovered", "manual_intervention"].includes(highest.status)) {
    throw new Error(
      "Active recovery state spec requires a terminal recovery journal",
    );
  }
  const release = assertMainReleaseManifest(highest.release);
  if (
    highest.deploySha !== releaseExecution.manifest.deploySha ||
    !sameJson(release, releaseExecution.manifest)
  ) {
    throw new Error(
      "Active recovery state spec execution does not match journal release",
    );
  }
  const active = STAGE_BARRIER_TARGETS.filter((target) =>
    release.activeTargets.includes(target),
  );
  const shadow = STAGE_BARRIER_TARGETS.filter(
    (target) =>
      release.stagedTargets.includes(target) && !active.includes(target),
  );
  const legacy = releaseExecution.legacyAppV2;
  const capturedLegacy = highest.prior["legacy-app"];
  if (
    legacy.alias !== LEGACY_ALIAS ||
    !sameJson(legacy.aliases, MAIN_LEGACY_REQUIRED_ALIAS_TOPOLOGY) ||
    legacy.deploymentId !== capturedLegacy.deploymentId ||
    legacy.deploymentUrl !== capturedLegacy.deploymentUrl ||
    !sameJson(legacy.aliases, capturedLegacy.aliases) ||
    legacy.projectId !== release.originalPriors.app.projectId ||
    legacy.projectName !== "app.mento.org" ||
    legacy.readyState !== "READY" ||
    legacy.target !== "production" ||
    legacy.customEnvironmentSlug !== null ||
    legacy.git?.org !== "mento-protocol" ||
    legacy.git.repo !== "frontend-monorepo" ||
    legacy.git.ref !== "v2"
  ) {
    throw new Error(
      "Active recovery state spec legacy v2 capture is incomplete",
    );
  }
  const projects = Object.fromEntries(
    STAGE_BARRIER_TARGETS.map((target) => {
      const isActive = active.includes(target);
      const isShadow = shadow.includes(target);
      const candidate = highest.candidates[target];
      const recoveredPriorApp =
        target === "app" &&
        isActive &&
        candidate !== null &&
        candidate.deploymentId === null &&
        candidate.deploymentUrl === null &&
        !highest.operations.some(
          (operation) => operation.type === "app_v3_deploy",
        );
      if (
        (isActive || (isShadow && target !== "app")) &&
        (candidate === null ||
          candidate.deploymentId === null ||
          candidate.deploymentUrl === null) &&
        !recoveredPriorApp
      ) {
        throw new Error(
          `Active recovery state spec ${target} candidate is incomplete`,
        );
      }
      if (!isActive && !isShadow && candidate !== null) {
        throw new Error(
          `Active recovery state spec ${target} has an unselected candidate`,
        );
      }
      const prior = release.originalPriors[target];
      return [
        target,
        {
          projectId: prior.projectId,
          projectName: `${target}.mento.org`,
          expectedDisposition: recoveredPriorApp
            ? "recoveredPrior"
            : isActive
              ? "githubPrebuilt"
              : isShadow && target !== "app"
                ? "githubShadowStage"
                : null,
          deploymentId: candidate?.deploymentId ?? null,
          deploymentUrl: candidate?.deploymentUrl ?? null,
          target: target === "app" ? null : "production",
          customEnvironmentSlug: target === "app" ? "v3" : null,
        },
      ];
    }),
  );
  return assertActiveDeploymentStateSpec({
    schema: ACTIVE_DEPLOYMENT_STATE_SPEC_SCHEMA,
    deploySha: highest.deploySha,
    runId: highest.runId,
    runAttempt: highest.runAttempt,
    transactionId: highest.transactionId,
    releaseManifest: release,
    mainOwnershipMode: release.mainOwnershipMode,
    stagedTargets: STAGE_BARRIER_TARGETS.filter((target) =>
      release.stagedTargets.includes(target),
    ),
    activeTargets: active,
    shadowTargets: shadow,
    projects,
    legacyAppV2: {
      alias: legacy.alias,
      deployment: legacy.deploymentId,
      deploymentUrl: legacy.deploymentUrl,
      projectId: legacy.projectId,
      projectName: legacy.projectName,
      readyState: legacy.readyState,
      target: legacy.target,
      customEnvironmentSlug: legacy.customEnvironmentSlug,
      git: { ...legacy.git },
    },
  });
}

const ACTIVE_RUNTIME_RESULT_KEYS = Object.freeze([
  "deploy_sha",
  "final_url",
  "interaction",
  "logical_target",
  "public_url",
  "successful_documents",
  "successful_fonts",
  "successful_scripts",
  "successful_stylesheets",
]);

const ACTIVE_RECOVERY_RUNTIME_FINAL_PATHS = Object.freeze({
  app: "/",
  governance: "/voting-power",
  reserve: "/?tab=stablecoins",
  ui: "/form-components",
});

const ACTIVE_RECOVERY_RUNTIME_INTERACTIONS = Object.freeze({
  app: "real-production-wallet-list",
  governance: "governance-voting-power-navigation",
  reserve: "reserve-overview-data-and-supply-tab",
  ui: "ui-search-navigation-and-checkbox",
});

function canonicalActiveRuntimeSmoke({ value, target, expectedSha, label }) {
  assertExactKeys(value, ACTIVE_RUNTIME_RESULT_KEYS, label);
  const expectedFinalUrl = new URL(
    ACTIVE_RECOVERY_RUNTIME_FINAL_PATHS[target],
    ACTIVE_PUBLIC_URLS[target],
  ).toString();
  if (
    value.logical_target !== target ||
    value.public_url !== ACTIVE_PUBLIC_URLS[target] ||
    value.deploy_sha !== expectedSha ||
    value.final_url !== expectedFinalUrl ||
    value.interaction !== ACTIVE_RECOVERY_RUNTIME_INTERACTIONS[target]
  ) {
    throw new Error(`${label} conflicts`);
  }
  for (const field of [
    "successful_documents",
    "successful_fonts",
    "successful_scripts",
    "successful_stylesheets",
  ]) {
    if (!Number.isSafeInteger(value[field]) || value[field] < 1) {
      throw new Error(`${label} is incomplete`);
    }
  }
  return {
    deploy_sha: value.deploy_sha,
    final_url: value.final_url,
    interaction: value.interaction,
    logical_target: value.logical_target,
    public_url: value.public_url,
    successful_documents: value.successful_documents,
    successful_fonts: value.successful_fonts,
    successful_scripts: value.successful_scripts,
    successful_stylesheets: value.successful_stylesheets,
  };
}

function canonicalRecoveryRuntimeSmoke(value, target, execution) {
  return canonicalActiveRuntimeSmoke({
    value,
    target,
    expectedSha: execution.manifest.originalPriors[target].servedSha,
    label: `${target} active recovery runtime smoke`,
  });
}

function canonicalCurrentActiveRuntimeSmoke(value, target, execution) {
  return canonicalActiveRuntimeSmoke({
    value,
    target,
    expectedSha: execution.manifest.deploySha,
    label: `${target} active runtime smoke`,
  });
}

export function createMainActiveRecoveryPublicSmokes({
  execution,
  targetResults,
}) {
  const releaseExecution = assertMainReleaseExecution(execution);
  assertExactKeys(
    targetResults,
    MAIN_DEPLOYMENT_TARGETS,
    "Active recovery runtime smoke results",
  );
  return Object.fromEntries(
    MAIN_DEPLOYMENT_TARGETS.map((target) => {
      const runtime = canonicalRecoveryRuntimeSmoke(
        targetResults[target],
        target,
        releaseExecution,
      );
      return [
        target,
        {
          publicUrl: ACTIVE_PUBLIC_URLS[target],
          runtime,
          servedSha: releaseExecution.manifest.originalPriors[target].servedSha,
          status: "passed",
        },
      ];
    }),
  );
}

export function createMainCurrentActivePublicSmokes({
  execution,
  barrier,
  targetResults,
  runId,
  runAttempt,
}) {
  const current = currentAttemptIdentity({ execution, runId, runAttempt });
  assertMainStageBarrier(barrier, {
    execution: current.execution,
    runId: current.identity.runId,
    runAttempt: current.identity.runAttempt,
  });
  assertExactKeys(
    targetResults,
    STAGE_BARRIER_TARGETS,
    "Current active smoke results",
  );
  return Object.fromEntries(
    STAGE_BARRIER_TARGETS.map((target) => {
      const active =
        current.execution.projection.activeTargets.includes(target);
      if (!active) {
        if (targetResults[target] !== null) {
          throw new Error(
            `${target} inactive active runtime smoke is malformed`,
          );
        }
        return [
          target,
          {
            publicUrl: ACTIVE_PUBLIC_URLS[target],
            runtime: null,
            servedSha: null,
            status: "not-required",
          },
        ];
      }
      const runtime = canonicalCurrentActiveRuntimeSmoke(
        targetResults[target],
        target,
        current.execution,
      );
      return [
        target,
        {
          publicUrl: ACTIVE_PUBLIC_URLS[target],
          runtime,
          servedSha: current.execution.manifest.deploySha,
          status: "passed",
        },
      ];
    }),
  );
}

function canonicalTerminalStateProof(value, { execution, runId, runAttempt }) {
  assertExactKeys(
    value,
    [
      "schema",
      "deploymentStateProof",
      "currentReleaseCandidates",
      "appShadowPreparation",
    ],
    "Main terminal state proof",
  );
  const current = currentAttemptIdentity({ execution, runId, runAttempt });
  if (value.schema !== MAIN_TERMINAL_STATE_PROOF_SCHEMA) {
    throw new Error("Main terminal state proof schema is unsupported");
  }
  const appIsShadow =
    current.execution.projection.shadowTargets.includes("app");
  assertExactKeys(
    value.appShadowPreparation,
    ["digest", "preparation"],
    "Main terminal App shadow preparation",
  );
  let preparation = null;
  let digest = null;
  if (appIsShadow) {
    preparation = canonicalAppPreparation(
      value.appShadowPreparation.preparation,
      current.execution,
      current.identity,
    );
    digest = requireString(
      value.appShadowPreparation.digest,
      "Main terminal App shadow preparation digest",
      /^[a-f0-9]{64}$/,
    );
    if (digest !== digestCanonicalJson(preparation)) {
      throw new Error("Main terminal App shadow preparation digest conflicts");
    }
  } else if (
    value.appShadowPreparation.preparation !== null ||
    value.appShadowPreparation.digest !== null
  ) {
    throw new Error("Main terminal App shadow preparation is unexpected");
  }
  const deploymentStateProof =
    value.deploymentStateProof === null
      ? null
      : assertActiveDeploymentStateProof(value.deploymentStateProof);
  if (
    deploymentStateProof === null &&
    current.execution.projection.activeTargets.length !== 0
  ) {
    throw new Error("Active terminal state proof is required");
  }
  if (deploymentStateProof !== null) {
    const transactionId = createMainTransactionId(current.identity);
    if (
      deploymentStateProof.deploySha !== current.execution.manifest.deploySha ||
      deploymentStateProof.runId !== current.identity.runId ||
      deploymentStateProof.runAttempt !== current.identity.runAttempt ||
      deploymentStateProof.transactionId !== transactionId ||
      !sameJson(
        deploymentStateProof.mainOwnershipMode,
        current.execution.manifest.mainOwnershipMode,
      )
    ) {
      throw new Error(
        "Main terminal deployment state proof identity conflicts",
      );
    }
    for (const target of MAIN_DEPLOYMENT_TARGETS) {
      const project = deploymentStateProof.projects[target];
      const prior = current.execution.manifest.originalPriors[target];
      if (
        project.priorDeploymentId !== prior.deploymentId ||
        project.priorDeploymentUrl !== prior.deploymentUrl ||
        project.priorServedSha !== prior.servedSha
      ) {
        throw new Error("Main terminal deployment state proof prior conflicts");
      }
    }
  }
  assertExactKeys(
    value.currentReleaseCandidates,
    MAIN_DEPLOYMENT_TARGETS,
    "Main terminal current release candidates",
  );
  const currentRelease =
    current.execution.decision === "verify-existing-release" &&
    current.execution.reason === "current-main-release-already-complete";
  const currentReleaseCandidates = Object.fromEntries(
    MAIN_DEPLOYMENT_TARGETS.map((target) => {
      const candidate = value.currentReleaseCandidates[target];
      const active =
        current.execution.projection.activeTargets.includes(target);
      if (!currentRelease || !active) {
        if (candidate !== null) {
          throw new Error(
            "Main terminal current release candidate is unexpected",
          );
        }
        return [target, null];
      }
      assertExactKeys(
        candidate,
        ["deploymentId", "deploymentUrl"],
        `Main terminal current release ${target} candidate`,
      );
      const canonicalCandidate = {
        deploymentId: requireString(
          candidate.deploymentId,
          `Main terminal current release ${target} deployment ID`,
          DEPLOYMENT_ID_PATTERN,
        ),
        deploymentUrl: canonicalizeDeploymentUrl(candidate.deploymentUrl),
      };
      if (
        deploymentStateProof === null ||
        deploymentStateProof.projects[target].expectedDeploymentId !==
          canonicalCandidate.deploymentId ||
        deploymentStateProof.projects[target].expectedDeploymentUrl !==
          canonicalCandidate.deploymentUrl
      ) {
        throw new Error("Main terminal current release candidate conflicts");
      }
      return [target, canonicalCandidate];
    }),
  );
  return {
    schema: MAIN_TERMINAL_STATE_PROOF_SCHEMA,
    deploymentStateProof,
    currentReleaseCandidates,
    appShadowPreparation: { digest, preparation },
  };
}

export function createMainActiveTerminalStateProof({
  execution,
  barrier,
  stateProof,
  runId,
  runAttempt,
}) {
  const current = currentAttemptIdentity({ execution, runId, runAttempt });
  const canonicalBarrier = assertMainStageBarrier(barrier, {
    execution: current.execution,
    runId: current.identity.runId,
    runAttempt: current.identity.runAttempt,
  });
  const preparation = current.execution.projection.shadowTargets.includes("app")
    ? canonicalBarrier.stages.app.preparation
    : null;
  return canonicalTerminalStateProof(
    {
      schema: MAIN_TERMINAL_STATE_PROOF_SCHEMA,
      deploymentStateProof: stateProof,
      currentReleaseCandidates: Object.fromEntries(
        MAIN_DEPLOYMENT_TARGETS.map((target) => [
          target,
          current.execution.decision === "verify-existing-release" &&
          current.execution.projection.activeTargets.includes(target)
            ? {
                deploymentId:
                  canonicalBarrier.stages[target].receipt.candidate
                    .deploymentId,
                deploymentUrl:
                  canonicalBarrier.stages[target].receipt.candidate
                    .deploymentUrl,
              }
            : null,
        ]),
      ),
      appShadowPreparation: {
        preparation,
        digest: preparation === null ? null : digestCanonicalJson(preparation),
      },
    },
    { execution: current.execution, ...current.identity },
  );
}

export function createMainActiveDeploymentStateSpec({
  plan,
  journalHistory,
  stageJobs,
  runId,
  runAttempt,
}) {
  const handoff = assertMainDeploymentHandoff(plan);
  const planning = createMainActivePlanning({ plan: handoff });
  const expectedRunId = requirePositiveId(runId, "Active state spec run ID");
  const expectedRunAttempt = requirePositiveId(
    runAttempt,
    "Active state spec run attempt",
  );
  const journals = assertMainActiveJournalHistory({
    journals: activeJournalArray(
      journalHistory,
      "Active state spec journal history",
    ),
    deploySha: handoff.deploySha,
    runId: expectedRunId,
    runAttempt: expectedRunAttempt,
  });
  const canonicalJournal = journals.at(-1);
  const stages = validateMainStageJobs({
    plan: handoff,
    jobs: stageJobs,
    runId: expectedRunId,
    runAttempt: expectedRunAttempt,
  }).stages;
  const projects = Object.fromEntries(
    MAIN_DEPLOYMENT_TARGETS.map((target) => {
      const active = planning.activeTargets.includes(target);
      const shadowStage =
        target !== "app" && planning.shadowTargets.includes(target);
      const expected = active
        ? canonicalJournal.candidates[target]
        : shadowStage
          ? stages[target]?.candidate
          : null;
      if (
        active &&
        (expected?.deploymentId === null ||
          expected === null ||
          (target !== "app" &&
            (expected.deploymentId !==
              stages[target]?.candidate?.deploymentId ||
              expected.deploymentUrl !==
                stages[target]?.candidate?.deploymentUrl)))
      ) {
        throw new Error(
          `Active state spec ${target} candidate is incomplete or inconsistent`,
        );
      }
      return [
        target,
        {
          projectId: handoff.projectIds[target],
          projectName: `${target}.mento.org`,
          expectedDisposition: active
            ? "githubPrebuilt"
            : shadowStage
              ? "githubShadowStage"
              : null,
          deploymentId: expected?.deploymentId ?? null,
          deploymentUrl: expected?.deploymentUrl ?? null,
          target: target === "app" ? null : "production",
          customEnvironmentSlug: target === "app" ? "v3" : null,
        },
      ];
    }),
  );
  const legacy = handoff.legacySnapshot[0];
  return assertActiveDeploymentStateSpec({
    schema: ACTIVE_DEPLOYMENT_STATE_SPEC_SCHEMA,
    deploySha: canonicalJournal.deploySha,
    runId: canonicalJournal.runId,
    runAttempt: canonicalJournal.runAttempt,
    transactionId: canonicalJournal.transactionId,
    releaseManifest: releaseManifestFromHandoff(handoff),
    mainOwnershipMode: planning.mainOwnershipMode,
    stagedTargets: planning.stagedTargets,
    activeTargets: planning.activeTargets,
    shadowTargets: planning.shadowTargets,
    projects,
    legacyAppV2: {
      alias: legacy.alias,
      deployment: legacy.deploymentId,
      deploymentUrl: legacy.deploymentUrl,
      projectId: legacy.projectId,
      projectName: legacy.projectName,
      readyState: legacy.readyState,
      target: legacy.target,
      customEnvironmentSlug: legacy.customEnvironmentSlug,
      git: { ...legacy.git },
    },
  });
}

export function createMainActiveAliasMappingSet({
  plan,
  journalHistory,
  runId,
  runAttempt,
}) {
  const handoff = assertMainDeploymentHandoff(plan);
  const planning = createMainActivePlanning({ plan: handoff });
  const history = assertMainActiveJournalHistory({
    journals: activeJournalArray(
      journalHistory,
      "Active mapping set journal history",
    ),
    deploySha: handoff.deploySha,
    runId: requirePositiveId(runId, "Active mapping set run ID"),
    runAttempt: requirePositiveId(runAttempt, "Active mapping set run attempt"),
  });
  const highest = history.at(-1);
  assertJournalMatchesActivePlanning(highest, planning);
  return assertActiveAliasMappingSet({
    schema: ACTIVE_ALIAS_MAPPING_SET_SCHEMA,
    aliases: [
      ...MAIN_DEPLOYMENT_TARGETS.flatMap(
        (target) => highest.prior[target].aliases,
      ),
      ...highest.prior["legacy-app"].aliases,
    ].toSorted(),
  });
}

export function createMainActiveJournalHistoryIdentity({
  deploySha,
  runId,
  runAttempt,
}) {
  const identity = {
    repository: MAIN_TRANSACTION_REPOSITORY,
    deploySha: requireSha(deploySha),
    runId: requirePositiveId(runId, "Run ID"),
    runAttempt: requirePositiveId(runAttempt, "Run attempt"),
  };
  const transactionId = createMainTransactionId(identity);
  return {
    repository: identity.repository,
    deploySha: identity.deploySha,
    runId: identity.runId,
    runAttempt: identity.runAttempt,
    transactionId,
    mode: MAIN_ACTIVE_DEPLOYMENT_MODE,
    artifactPrefix: `vercel-main-journal-${transactionId}-`,
  };
}

export function assertMainActiveJournalHistory({
  journals,
  deploySha,
  runId,
  runAttempt,
}) {
  const identity = createMainActiveJournalHistoryIdentity({
    deploySha,
    runId,
    runAttempt,
  });
  return assertMainTransactionJournalHistory(journals, {
    repository: identity.repository,
    deploySha: identity.deploySha,
    runId: identity.runId,
    runAttempt: identity.runAttempt,
    transactionId: identity.transactionId,
    mode: identity.mode,
  });
}

function acknowledgedJournalReceipt(receipt, journal) {
  return (
    receipt?.acknowledged === true &&
    receipt.artifactName === mainTransactionJournalArtifactName(journal) &&
    POSITIVE_ID_PATTERN.test(String(receipt.artifactId ?? ""))
  );
}

function activeRunHandoff({
  outcome,
  planning,
  journal,
  freshness,
  publicServingMutationCommands,
  recoveryDecision,
  errorCode = null,
}) {
  return {
    outcome,
    mainOwnershipMode: planning.mainOwnershipMode,
    stagedTargets: planning.stagedTargets,
    activeTargets: planning.activeTargets,
    shadowTargets: planning.shadowTargets,
    transactionId: journal?.transactionId ?? null,
    highestJournalSequence: journal?.sequence ?? null,
    highestJournalStatus: journal?.status ?? null,
    freshness,
    publicServingMutationCommands,
    recoveryDecision,
    errorCode,
  };
}

export async function runMainActiveTransaction({
  plan,
  stageJobs,
  appBuildProof,
  appCandidateReceipt = null,
  runId,
  runAttempt,
  journalHistory = [],
  adapters,
}) {
  const inputs = createMainActiveTransactionInputs({
    plan,
    stageJobs,
    appBuildProof,
    appCandidateReceipt,
    runId,
    runAttempt,
  });
  if (!Array.isArray(journalHistory)) {
    throw new Error("Active journal history must be an array");
  }
  if (inputs.planning.stagedTargets.length === 0) {
    return activeRunHandoff({
      outcome: "no-target",
      planning: inputs.planning,
      journal: null,
      freshness: [],
      publicServingMutationCommands: 0,
      recoveryDecision: {
        decision: "verify-only",
        reason: "no-mutation-started",
      },
    });
  }
  if (!isPlainObject(adapters)) {
    throw new Error("Active controller adapters are required");
  }
  const existing =
    journalHistory.length === 0
      ? []
      : assertMainActiveJournalHistory({
          journals: journalHistory,
          ...inputs.identity,
        });
  const prepared = createPreparedMainTransactionJournal({
    ...inputs.identity,
    mode: MAIN_ACTIVE_DEPLOYMENT_MODE,
    release: inputs.release,
    prior: inputs.prior,
    startMappings: inputs.startMappings,
    candidates: inputs.candidates,
  });
  if (
    existing.length > 0 &&
    JSON.stringify(existing[0]) !== JSON.stringify(prepared)
  ) {
    throw new Error(
      "Active journal history does not match the reviewed transaction inputs",
    );
  }

  const acknowledged = [];
  const freshness = [];
  let publicServingMutationCommands = 0;
  const publicMutation = (name) => {
    const adapter = adapters[name];
    if (typeof adapter !== "function") return adapter;
    return async (context) => {
      publicServingMutationCommands += 1;
      return adapter(context);
    };
  };
  const assertFreshness = async (context) => {
    if (typeof adapters.assertFreshness !== "function") {
      throw new Error("Active freshness adapter is required");
    }
    try {
      const result = await adapters.assertFreshness(context);
      freshness.push({
        phase: context.phase,
        status: result?.sha === context.deploySha ? "fresh" : "superseded",
      });
      return result;
    } catch (error) {
      freshness.push({ phase: context.phase, status: "unproven" });
      throw error;
    }
  };
  const uploadJournal = async (context) => {
    if (typeof adapters.uploadJournal !== "function") {
      throw new Error("Active journal upload adapter is required");
    }
    const receipt = await adapters.uploadJournal(context);
    if (acknowledgedJournalReceipt(receipt, context.journal)) {
      acknowledged.push(context.journal);
    }
    return receipt;
  };
  const durableHistory = () => {
    const combined = [...existing, ...acknowledged];
    if (combined.length === 0) return [];
    return assertMainActiveJournalHistory({
      journals: combined,
      ...inputs.identity,
    });
  };
  const mutationAdapters = {};
  for (const name of ["promote", "deployAppV3", "assignAlias"]) {
    const adapter = publicMutation(name);
    if (typeof adapter === "function") mutationAdapters[name] = adapter;
  }
  for (const name of [
    "inspectMapping",
    "verifyMapping",
    "inspectProtectedMappings",
    "ordinaryRollback",
    "restoreAppAlias",
    "restoreLegacyAlias",
  ]) {
    if (typeof adapters[name] === "function") {
      mutationAdapters[name] = adapters[name];
    }
  }

  try {
    const result = await runMainTransaction({
      mode: MAIN_ACTIVE_DEPLOYMENT_MODE,
      identity: inputs.identity,
      release: inputs.release,
      prior: inputs.prior,
      startMappings: inputs.startMappings,
      candidates: inputs.candidates,
      existingJournals: existing,
      assertFreshness,
      uploadJournal,
      inspectRecoveryState: adapters.inspectRecoveryState,
      mutationAdapters,
    });
    return {
      ...activeRunHandoff({
        outcome: result.outcome,
        planning: inputs.planning,
        journal: result.journal,
        freshness,
        publicServingMutationCommands,
        recoveryDecision: result.recoveryDecision,
      }),
      journal: result.journal,
      journalHistory: durableHistory(),
    };
  } catch (error) {
    const history = durableHistory();
    const highest = history.at(-1) ?? null;
    error.activeResult = {
      ...activeRunHandoff({
        outcome: "active-failed",
        planning: inputs.planning,
        journal: highest,
        freshness,
        publicServingMutationCommands,
        recoveryDecision:
          highest === null
            ? null
            : (() => {
                const decision = decideMainTransactionRecovery(history, {
                  ...inputs.identity,
                  mode: MAIN_ACTIVE_DEPLOYMENT_MODE,
                });
                return {
                  decision: decision.decision,
                  reason: decision.reason,
                };
              })(),
        errorCode:
          error instanceof MainTransactionError
            ? error.code
            : "CONTROLLER_FAILED",
      }),
      journal: highest,
      journalHistory: history,
    };
    throw error;
  }
}

function canonicalRecoveryPlannerMappings(journal, value) {
  if (!Array.isArray(value)) {
    throw new Error("Active recovery current mappings must be an array");
  }
  const legacyAliases = new Set(journal.prior["legacy-app"].aliases);
  const legacyProjectId = journal.release.originalPriors.app.projectId;
  return value.map((mapping, index) => {
    const hasProjectId = Object.hasOwn(mapping ?? {}, "projectId");
    assertExactKeys(
      mapping,
      hasProjectId
        ? ["alias", "deploymentId", "deploymentUrl", "projectId"]
        : ["alias", "deploymentId", "deploymentUrl"],
      `Active recovery current mapping ${index + 1}`,
    );
    const alias = canonicalizeHostname(mapping.alias);
    if (
      hasProjectId &&
      (!legacyAliases.has(alias) || mapping.projectId !== legacyProjectId)
    ) {
      throw new Error(
        "Active recovery legacy App project binding is inconsistent",
      );
    }
    return {
      alias,
      deploymentId: requireString(
        mapping.deploymentId,
        `Active recovery current mapping ${index + 1} deployment ID`,
        DEPLOYMENT_ID_PATTERN,
      ),
      deploymentUrl: canonicalizeDeploymentUrl(mapping.deploymentUrl),
    };
  });
}

export function planMainActiveRecovery({
  journalHistory,
  deploySha,
  runId,
  runAttempt,
  currentMappings,
}) {
  const history = assertMainActiveJournalHistory({
    journals: journalHistory,
    deploySha,
    runId,
    runAttempt,
  });
  return planMainTransactionRecovery({
    journal: history.at(-1),
    currentMappings: canonicalRecoveryPlannerMappings(
      history.at(-1),
      currentMappings,
    ),
  });
}

export async function runMainActiveRecovery({ recoveryPlan, adapters }) {
  if (!isPlainObject(adapters)) {
    throw new Error("Active recovery adapters are required");
  }
  let publicServingMutationCommands = 0;
  const acknowledged = [];
  const publicMutation = (name) => {
    const adapter = adapters[name];
    if (typeof adapter !== "function") return adapter;
    return async (context) => {
      publicServingMutationCommands += 1;
      return adapter(context);
    };
  };
  const uploadJournal = async (context) => {
    if (typeof adapters.uploadJournal !== "function") {
      throw new Error("Active recovery journal upload adapter is required");
    }
    const receipt = await adapters.uploadJournal(context);
    if (acknowledgedJournalReceipt(receipt, context.journal)) {
      acknowledged.push(context.journal);
    }
    return receipt;
  };
  try {
    const journal = await executeMainTransactionRecovery({
      plan: recoveryPlan,
      uploadJournal,
      ordinaryRollback: publicMutation("ordinaryRollback"),
      restoreAppAlias: publicMutation("restoreAppAlias"),
      restoreLegacyAlias: publicMutation("restoreLegacyAlias"),
      inspectMapping: adapters.inspectMapping,
      verifyMapping: adapters.verifyMapping,
    });
    const outcome =
      journal.status === "recovered"
        ? "recovered"
        : journal.status === "manual_intervention"
          ? "manual-intervention"
          : recoveryPlan.decision === "verify-only"
            ? "verified-no-mutation"
            : recoveryPlan.reason === "committed"
              ? "bypassed-committed"
              : "already-recovered";
    return {
      outcome,
      decision: recoveryPlan.decision,
      reason: recoveryPlan.reason,
      forceReleaseFailure: recoveryPlan.forceFailure,
      rollbackStateTargets: [...recoveryPlan.rollbackStateTargets],
      publicServingMutationCommands,
      journal,
      uploadedJournals: acknowledged,
    };
  } catch (error) {
    error.activeRecoveryResult = {
      outcome: "recovery-failed",
      decision: recoveryPlan?.decision ?? null,
      reason: recoveryPlan?.reason ?? null,
      forceReleaseFailure: true,
      rollbackStateTargets: Array.isArray(recoveryPlan?.rollbackStateTargets)
        ? [...recoveryPlan.rollbackStateTargets]
        : [],
      publicServingMutationCommands,
      journal: acknowledged.at(-1) ?? recoveryPlan?.journal ?? null,
      uploadedJournals: acknowledged,
    };
    throw error;
  }
}

export function assertProtectedSnapshotMatchesPlan({
  plan,
  planningSnapshot,
  legacySnapshot,
}) {
  const handoff = assertMainDeploymentHandoff(plan);
  const currentPlanning = canonicalPlanningSnapshotForSpec({
    snapshot: planningSnapshot,
    projectIds: handoff.projectIds,
  });
  const currentLegacy = canonicalLegacySnapshotForSpec({
    snapshot: legacySnapshot,
    projectIds: handoff.projectIds,
  });
  const rollbackIdentity = (snapshot) =>
    snapshot.states.map((state) => {
      const identity = {
        alias: state.alias,
        deploymentId: state.deploymentId,
        deploymentUrl: state.deploymentUrl,
        projectId: state.projectId,
        projectName: state.projectName,
        readyState: state.readyState,
        target: state.target,
        customEnvironmentSlug: state.customEnvironmentSlug,
      };
      if (MAIN_TARGET_CONTRACTS.app.aliases.includes(state.alias)) {
        return {
          ...identity,
          creatorUsername: state.creatorUsername,
          aliases: state.aliases,
        };
      }
      return identity;
    });
  if (
    JSON.stringify(rollbackIdentity(currentPlanning)) !==
      JSON.stringify(rollbackIdentity(handoff.protectedSnapshot)) ||
    JSON.stringify(currentLegacy) !== JSON.stringify(handoff.legacySnapshot)
  ) {
    throw new Error(
      "Protected mappings or rollback state drifted after planning",
    );
  }
  return {
    protectedSnapshot: currentPlanning,
    legacySnapshot: currentLegacy,
  };
}

export function readRemoteMainSha({
  remote = "origin",
  spawn = spawnSync,
  attempts = 3,
}) {
  requireString(remote, "Git remote");
  if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > 5) {
    throw new Error("Remote-main retry limit is invalid");
  }
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = spawn(
      "git",
      ["ls-remote", "--exit-code", remote, "refs/heads/main"],
      {
        encoding: "utf8",
        timeout: 15_000,
        maxBuffer: 16 * 1024,
      },
    );
    if (result.status !== 0) continue;
    const lines = result.stdout.trim().split("\n");
    if (lines.length !== 1) continue;
    const match = lines[0].match(/^([a-f0-9]{40})\trefs\/heads\/main$/);
    if (match) return match[1];
  }
  throw new Error("Remote main freshness could not be proven");
}

export function classifyRemoteMainFreshness({ deploySha, remoteSha }) {
  const expected = requireSha(deploySha);
  const current = requireSha(remoteSha, "Remote main SHA");
  return {
    status: current === expected ? "fresh" : "superseded",
    sha: current,
  };
}

export function createPreparedMainJournal(options) {
  const inputs = createMainTransactionInputs(options);
  return createPreparedMainTransactionJournal({
    ...inputs.identity,
    mode: MAIN_DEPLOYMENT_MODE,
    release: inputs.release,
    prior: inputs.prior,
    startMappings: inputs.startMappings,
    candidates: inputs.candidates,
  });
}

export function createMainJournalArtifactIdentity({
  deploySha,
  runId,
  runAttempt,
}) {
  const identity = {
    repository: MAIN_TRANSACTION_REPOSITORY,
    deploySha: requireSha(deploySha),
    runId: requirePositiveId(runId, "Run ID"),
    runAttempt: requirePositiveId(runAttempt, "Run attempt"),
  };
  const transactionId = createMainTransactionId(identity);
  return {
    transactionId,
    artifactName: `vercel-main-journal-${transactionId}-000000`,
  };
}

export function createMainWorkflowRunUrl({ serverUrl, repository, runId }) {
  if (
    serverUrl !== "https://github.com" ||
    repository !== MAIN_TRANSACTION_REPOSITORY
  ) {
    throw new Error("Downstream workflow repository origin is invalid");
  }
  return `https://github.com/${MAIN_TRANSACTION_REPOSITORY}/actions/runs/${requirePositiveId(
    runId,
    "Evidence run ID",
  )}`;
}

export function assertUploadedPreparedJournal({
  journal,
  journalBytes,
  artifactName,
  artifactId,
}) {
  const canonical = assertMainTransactionJournal(journal, {
    mode: MAIN_DEPLOYMENT_MODE,
    status: "prepared",
    sequence: 0,
  });
  const expectedName = mainTransactionJournalArtifactName(canonical);
  const expectedBytes = `${JSON.stringify(canonical)}\n`;
  if (
    artifactName !== expectedName ||
    journalBytes !== expectedBytes ||
    !POSITIVE_ID_PATTERN.test(String(artifactId))
  ) {
    throw new Error(
      "Prepared journal artifact does not acknowledge these exact bytes",
    );
  }
  return {
    acknowledged: true,
    artifactName: expectedName,
    artifactId: String(artifactId),
  };
}

export async function runMainShadowTransaction({
  plan,
  stageJobs,
  appBuildProof,
  runId,
  runAttempt,
  journalBytes,
  artifactName,
  artifactId,
  readRemoteMain = () => readRemoteMainSha({}),
}) {
  const inputs = createMainTransactionInputs({
    plan,
    stageJobs,
    appBuildProof,
    runId,
    runAttempt,
  });
  const regenerated = createPreparedMainTransactionJournal({
    ...inputs.identity,
    mode: MAIN_DEPLOYMENT_MODE,
    release: inputs.release,
    prior: inputs.prior,
    startMappings: inputs.startMappings,
    candidates: inputs.candidates,
  });
  assertUploadedPreparedJournal({
    journal: regenerated,
    journalBytes,
    artifactName,
    artifactId,
  });
  const forbidden = () => {
    throw new Error("Mutation callback is unreachable in shadow mode");
  };
  try {
    return await runMainTransaction({
      mode: MAIN_DEPLOYMENT_MODE,
      identity: inputs.identity,
      release: inputs.release,
      prior: inputs.prior,
      startMappings: inputs.startMappings,
      candidates: inputs.candidates,
      assertFreshness: async () => ({ sha: readRemoteMain() }),
      uploadJournal: async ({ artifactName: name, journal }) =>
        assertUploadedPreparedJournal({
          journal,
          journalBytes,
          artifactName: name,
          artifactId,
        }),
      inspectRecoveryState: async ({ decision }) => {
        if (decision !== "verify-only") {
          throw new Error("Shadow recovery decision may only verify");
        }
      },
      mutationAdapters: {
        promote: forbidden,
        deployAppV3: forbidden,
        assignAlias: forbidden,
        ordinaryRollback: forbidden,
        restoreAppAlias: forbidden,
        restoreLegacyAlias: forbidden,
      },
    });
  } catch (error) {
    if (
      error instanceof MainTransactionError &&
      error.code === "SUPERSEDED_BEFORE_MUTATION"
    ) {
      return {
        mode: MAIN_DEPLOYMENT_MODE,
        outcome: "superseded-after-journal",
        journal: regenerated,
        recoveryDecision: {
          decision: "verify-only",
          reason: "superseded-before-mutation",
        },
        mutationCallbacksCalled: 0,
      };
    }
    throw error;
  }
}

export function recoverMainShadowTransaction({ journal, expectedIdentity }) {
  const canonical = assertMainTransactionJournal(journal, {
    ...expectedIdentity,
    mode: MAIN_DEPLOYMENT_MODE,
  });
  const decision = decideMainTransactionRecovery([canonical], {
    ...expectedIdentity,
    mode: MAIN_DEPLOYMENT_MODE,
  });
  if (decision.decision !== "verify-only") {
    throw new Error("Shadow recovery must remain read-only");
  }
  return {
    outcome: "verified-no-mutation",
    decision: decision.decision,
    reason: decision.reason,
    transactionId: canonical.transactionId,
  };
}

function canonicalEvidenceMetrics(value, label, { deploy = true } = {}) {
  assertExactKeys(
    value,
    deploy
      ? [
          "buildDurationMs",
          "deployDurationMs",
          "totalDurationMs",
          "turboCacheHits",
          "turboCacheMisses",
        ]
      : [
          "buildDurationMs",
          "totalDurationMs",
          "turboCacheHits",
          "turboCacheMisses",
        ],
    `${label} metrics`,
  );
  return {
    buildDurationMs: requireNonNegativeCount(
      value.buildDurationMs,
      `${label} build duration`,
    ),
    ...(deploy
      ? {
          deployDurationMs: requireNonNegativeCount(
            value.deployDurationMs,
            `${label} deploy duration`,
          ),
        }
      : {}),
    totalDurationMs: requireNonNegativeCount(
      value.totalDurationMs,
      `${label} total duration`,
    ),
    turboCacheHits: requireNonNegativeCount(
      value.turboCacheHits,
      `${label} Turbo cache hits`,
    ),
    turboCacheMisses: requireNonNegativeCount(
      value.turboCacheMisses,
      `${label} Turbo cache misses`,
    ),
  };
}

function canonicalFinalJobResults(jobs, label = "Main final job results") {
  assertExactKeys(jobs, FINAL_JOB_KEYS, label);
  return Object.fromEntries(
    FINAL_JOB_KEYS.map((name) => {
      const result = jobs[name];
      if (!JOB_RESULTS.has(result)) {
        throw new Error(`${label} is invalid for ${name}`);
      }
      return [name, result];
    }),
  );
}

function canonicalOptionalSha(value) {
  return typeof value === "string" && SHA_PATTERN.test(value) ? value : null;
}

export function createMainDeploymentFailureEvidence({
  eventHeadSha,
  verifiedDeploySha,
  planOutput,
  jobs,
  workflowDefinitionSha,
  runId,
  runAttempt,
  workflowRunUrl,
}) {
  const expectedRunId = requirePositiveId(runId, "Failure evidence run ID");
  const expectedRunAttempt = requirePositiveId(
    runAttempt,
    "Failure evidence run attempt",
  );
  const expectedWorkflowRunUrl = createMainWorkflowRunUrl({
    serverUrl: "https://github.com",
    repository: MAIN_TRANSACTION_REPOSITORY,
    runId: expectedRunId,
  });
  if (workflowRunUrl !== expectedWorkflowRunUrl) {
    throw new Error("Failure evidence workflow run URL is invalid");
  }
  const canonicalJobs = canonicalFinalJobResults(
    jobs,
    "Failure evidence job results",
  );
  return {
    schema: MAIN_FAILURE_EVIDENCE_SCHEMA,
    mode: MAIN_DEPLOYMENT_MODE,
    repository: MAIN_TRANSACTION_REPOSITORY,
    eventHeadSha: canonicalOptionalSha(eventHeadSha),
    verifiedDeploySha:
      canonicalJobs.waitForCi === "success"
        ? canonicalOptionalSha(verifiedDeploySha)
        : null,
    workflowDefinitionSha: requireSha(
      workflowDefinitionSha,
      "Failure evidence workflow definition SHA",
    ),
    runId: expectedRunId,
    runAttempt: expectedRunAttempt,
    workflowRunUrl: expectedWorkflowRunUrl,
    planOutputPresent: typeof planOutput === "string" && planOutput.length > 0,
    jobs: canonicalJobs,
    publicServingMutationCommands: 0,
    outcome: "failed",
  };
}

export function createMainDeploymentEvidence({
  plan,
  stages,
  app,
  coordinator,
  recovery,
  runId,
  runAttempt,
  workflowRunUrl,
}) {
  const handoff = assertMainDeploymentHandoff(plan);
  const expectedRunId = requirePositiveId(runId, "Evidence run ID");
  const expectedRunAttempt = requirePositiveId(
    runAttempt,
    "Evidence run attempt",
  );
  const expectedWorkflowRunUrl = createMainWorkflowRunUrl({
    serverUrl: "https://github.com",
    repository: MAIN_TRANSACTION_REPOSITORY,
    runId: expectedRunId,
  });
  if (workflowRunUrl !== expectedWorkflowRunUrl) {
    throw new Error("Downstream workflow run URL is invalid");
  }
  assertExactKeys(stages, MAIN_ORDINARY_TARGETS, "Evidence stage targets");
  const canonicalStages = {};
  for (const target of MAIN_ORDINARY_TARGETS) {
    const selected = handoff.planning.stagedTargets.includes(target);
    const value = stages[target];
    if (!selected) {
      if (value !== null) {
        throw new Error(`Unselected ${target} has unexpected evidence`);
      }
      canonicalStages[target] = null;
      continue;
    }
    assertExactKeys(
      value,
      ["handoff", "metrics", "nextDeploymentId"],
      `${target} evidence`,
    );
    const stage = assertMainStageResult(value.handoff, {
      plan: handoff,
      expectedTarget: target,
      expectedRunId,
      expectedRunAttempt,
    });
    const expectedNextDeploymentId = generateVercelDeploymentId({
      target,
      commitSha: handoff.deploySha,
      runId: expectedRunId,
      runAttempt: expectedRunAttempt,
    });
    if (value.nextDeploymentId !== expectedNextDeploymentId) {
      throw new Error(`${target} evidence has the wrong custom Next ID`);
    }
    canonicalStages[target] = {
      candidate: {
        deploymentId: stage.candidate.deploymentId,
        deploymentUrl: stage.candidate.deploymentUrl,
        nextDeploymentId: expectedNextDeploymentId,
      },
      verification: { ...stage.verification },
      metrics: canonicalEvidenceMetrics(value.metrics, `${target} evidence`),
    };
  }
  assertExactKeys(
    coordinator,
    [
      "artifactName",
      "artifactId",
      "outcome",
      "totalDurationMs",
      "transactionId",
    ],
    "Coordinator evidence",
  );
  if (
    ![
      "shadow-prepared",
      "superseded-before-journal",
      "superseded-after-journal",
      "no-target",
    ].includes(coordinator.outcome)
  ) {
    throw new Error("Coordinator evidence outcome is invalid");
  }
  const durable = ["shadow-prepared", "superseded-after-journal"].includes(
    coordinator.outcome,
  );
  const expectedIdentity = createMainJournalArtifactIdentity({
    deploySha: handoff.deploySha,
    runId: expectedRunId,
    runAttempt: expectedRunAttempt,
  });
  if (
    durable
      ? coordinator.transactionId !== expectedIdentity.transactionId ||
        coordinator.artifactName !== expectedIdentity.artifactName ||
        !POSITIVE_ID_PATTERN.test(String(coordinator.artifactId))
      : coordinator.transactionId !== null ||
        coordinator.artifactName !== null ||
        coordinator.artifactId !== null
  ) {
    throw new Error("Coordinator evidence journal identity is invalid");
  }
  const coordinatorEvidence = {
    outcome: coordinator.outcome,
    totalDurationMs: requireNonNegativeCount(
      coordinator.totalDurationMs,
      "Coordinator total duration",
    ),
  };
  const journal = durable
    ? {
        transactionId: expectedIdentity.transactionId,
        artifactName: expectedIdentity.artifactName,
        journalArtifactId: String(coordinator.artifactId),
        sequence: 0,
        status: "prepared",
      }
    : null;
  let canonicalApp = null;
  const appSelected = handoff.planning.stagedTargets.includes("app");
  if (app !== null) {
    if (!appSelected || coordinator.outcome === "superseded-before-journal") {
      throw new Error("App evidence exists without completed App work");
    }
    assertExactKeys(app, ["metrics", "nextDeploymentId"], "App evidence");
    const expectedNextDeploymentId = generateVercelMainCandidateDeploymentId({
      repository: MAIN_TRANSACTION_REPOSITORY,
      target: "app",
      commitSha: handoff.deploySha,
      upstreamRunId: handoff.upstream.runId,
    });
    if (app.nextDeploymentId !== expectedNextDeploymentId) {
      throw new Error("App evidence has the wrong custom Next ID");
    }
    canonicalApp = {
      outcome: "build-only",
      nextDeploymentId: expectedNextDeploymentId,
      metrics: canonicalEvidenceMetrics(app.metrics, "App evidence", {
        deploy: false,
      }),
    };
  } else if (
    appSelected &&
    !["superseded-before-journal"].includes(coordinator.outcome)
  ) {
    throw new Error("Selected App is missing build-only evidence");
  }
  assertExactKeys(recovery, ["outcome"], "Recovery evidence");
  if (
    durable
      ? recovery.outcome !== "verified-no-mutation"
      : recovery.outcome !== "not-required"
  ) {
    throw new Error("Recovery evidence does not match journal durability");
  }
  const legacyState = handoff.legacySnapshot[0];
  const legacy = {
    alias: LEGACY_ALIAS,
    deploymentId: handoff.legacyPrior.deploymentId,
    deploymentUrl: handoff.legacyPrior.deploymentUrl,
    servedSha: legacyState.git.sha,
    ref: legacyState.git.ref,
    readyState: legacyState.readyState,
    health: "passed",
  };
  const freshness = {
    "no-target": {
      beforeAppPreparation: "not-run",
      beforeTransaction: "not-run",
    },
    "superseded-before-journal": {
      beforeAppPreparation: "superseded",
      beforeTransaction: "not-run",
    },
    "shadow-prepared": {
      beforeAppPreparation: "fresh",
      beforeTransaction: "fresh",
    },
    "superseded-after-journal": {
      beforeAppPreparation: "fresh",
      beforeTransaction: "superseded",
    },
  }[coordinator.outcome];
  return {
    schema: MAIN_EVIDENCE_SCHEMA,
    mode: MAIN_DEPLOYMENT_MODE,
    deploySha: handoff.deploySha,
    workflowDefinitionSha: handoff.deploySha,
    runId: expectedRunId,
    runAttempt: expectedRunAttempt,
    workflowRunUrl: expectedWorkflowRunUrl,
    upstream: {
      ...handoff.upstream,
      buildAndTestConclusion: "success",
    },
    planning: handoff.planning,
    legacy,
    stages: canonicalStages,
    app: canonicalApp,
    coordinator: coordinatorEvidence,
    journal,
    recovery: { outcome: recovery.outcome },
    freshness,
    ordinaryRollbackStateTargets: [],
  };
}

const ACTIVE_PUBLIC_URLS = Object.freeze({
  app: "https://app.mento.org/",
  governance: "https://governance.mento.org/",
  reserve: "https://reserve.mento.org/",
  ui: "https://ui.mento.org/",
});

function canonicalMutationCount(value, label) {
  const normalized = requireNonNegativeCount(value, label);
  const count = Number(normalized);
  if (!Number.isSafeInteger(count)) {
    throw new Error(`${label} exceeds the safe integer range`);
  }
  return count;
}

function canonicalFreshnessEvidence(value, { committed = false } = {}) {
  if (!Array.isArray(value)) {
    throw new Error("Active freshness evidence must be an array");
  }
  const canonical = value.map((entry, index) => {
    assertExactKeys(
      entry,
      ["phase", "status"],
      `Active freshness event ${index + 1}`,
    );
    const phase = requireString(
      entry.phase,
      `Active freshness event ${index + 1} phase`,
      /^[A-Za-z0-9:_-]+$/,
    );
    if (!["fresh", "superseded", "unproven"].includes(entry.status)) {
      throw new Error(`Active freshness event ${index + 1} is invalid`);
    }
    return { phase, status: entry.status };
  });
  if (
    committed &&
    (canonical.some((entry) => entry.status !== "fresh") ||
      !canonical.some((entry) => entry.phase === "transaction-start") ||
      !canonical.some((entry) => entry.phase === "transaction-commit"))
  ) {
    throw new Error("Committed active evidence lacks complete freshness");
  }
  return canonical;
}

function canonicalOrderedVerifiedOperations(journal) {
  return journal.operations
    .filter((operation) => operation.state === "verified")
    .map((operation) => ({
      operationId: operation.operationId,
      type: operation.type,
      target: operation.target,
      alias: operation.alias,
      candidateDeploymentId: operation.candidateDeploymentId,
      candidateDeploymentUrl: operation.candidateDeploymentUrl,
      mappingState: operation.mappingState,
      rollbackState: operation.rollbackState,
    }));
}

function operationMutationCounts(journal) {
  const operationIds = (state) =>
    new Set(
      journal.operations
        .filter((operation) => operation.state === state)
        .map((operation) => operation.operationId),
    ).size;
  return {
    started: operationIds("started"),
    confirmedReturned: operationIds("command_returned"),
  };
}

function canonicalFinalMappings(journal, value, { exact = true } = {}) {
  if (!Array.isArray(value)) {
    throw new Error("Active final mappings must be an array");
  }
  const expectedByAlias = new Map();
  for (const target of ["app", "governance", "reserve", "ui", "legacy-app"]) {
    const expected =
      target === "legacy-app" || journal.candidates[target] === null
        ? journal.prior[target]
        : journal.candidates[target];
    for (const alias of journal.prior[target].aliases) {
      expectedByAlias.set(alias, expected);
    }
  }
  const seen = new Set();
  const canonical = value.map((entry, index) => {
    assertExactKeys(
      entry,
      ["alias", "deploymentId", "deploymentUrl"],
      `Active final mapping ${index + 1}`,
    );
    const alias = canonicalizeHostname(entry.alias);
    if (!expectedByAlias.has(alias) || seen.has(alias)) {
      throw new Error("Active final mappings contain an unknown alias");
    }
    seen.add(alias);
    const mapping = {
      alias,
      deploymentId: requireString(
        entry.deploymentId,
        `Active final mapping ${alias} deployment ID`,
        DEPLOYMENT_ID_PATTERN,
      ),
      deploymentUrl: canonicalizeDeploymentUrl(entry.deploymentUrl),
    };
    if (exact) {
      const expected = expectedByAlias.get(alias);
      if (
        mapping.deploymentId !== expected.deploymentId ||
        mapping.deploymentUrl !== expected.deploymentUrl
      ) {
        throw new Error("Active final mapping differs from the transaction");
      }
    }
    return mapping;
  });
  if (seen.size !== expectedByAlias.size) {
    throw new Error("Active final mappings are incomplete");
  }
  return canonical.toSorted((left, right) =>
    left.alias.localeCompare(right.alias),
  );
}

function canonicalCurrentReleaseVerifiedMappings({
  execution,
  stateProof,
  value,
  runId,
  runAttempt,
}) {
  const current = currentAttemptIdentity({ execution, runId, runAttempt });
  if (
    current.execution.decision !== "verify-existing-release" ||
    current.execution.reason !== "current-main-release-already-complete"
  ) {
    throw new Error("Current release final mappings conflict with execution");
  }
  const canonicalStateProof = assertActiveDeploymentStateProof(stateProof);
  if (!Array.isArray(value)) {
    throw new Error("Current release final mappings must be an array");
  }
  const expectedByAlias = new Map();
  for (const target of MAIN_DEPLOYMENT_TARGETS) {
    const expected = current.execution.projection.activeTargets.includes(target)
      ? {
          deploymentId:
            canonicalStateProof.projects[target].expectedDeploymentId,
          deploymentUrl:
            canonicalStateProof.projects[target].expectedDeploymentUrl,
        }
      : current.execution.manifest.originalPriors[target];
    for (const alias of current.execution.manifest.originalPriors[target]
      .aliases) {
      expectedByAlias.set(alias, expected);
    }
  }
  for (const alias of current.execution.legacyAppV2.aliases) {
    expectedByAlias.set(alias, current.execution.legacyAppV2);
  }
  const seen = new Set();
  const mappings = value.map((entry, index) => {
    assertExactKeys(
      entry,
      ["alias", "deploymentId", "deploymentUrl"],
      `Current release final mapping ${index + 1}`,
    );
    const alias = canonicalizeHostname(entry.alias);
    const expected = expectedByAlias.get(alias);
    const mapping = {
      alias,
      deploymentId: requireString(
        entry.deploymentId,
        `Current release mapping ${alias} deployment ID`,
        DEPLOYMENT_ID_PATTERN,
      ),
      deploymentUrl: canonicalizeDeploymentUrl(entry.deploymentUrl),
    };
    if (
      expected === undefined ||
      seen.has(alias) ||
      mapping.deploymentId !== expected.deploymentId ||
      mapping.deploymentUrl !== expected.deploymentUrl
    ) {
      throw new Error(
        "Current release final mappings conflict with candidates",
      );
    }
    seen.add(alias);
    return mapping;
  });
  if (seen.size !== expectedByAlias.size) {
    throw new Error("Current release final mappings are incomplete");
  }
  return mappings.toSorted((left, right) =>
    left.alias.localeCompare(right.alias),
  );
}

function canonicalPublicSmokes(value, planning, deploySha) {
  assertExactKeys(value, MAIN_DEPLOYMENT_TARGETS, "Active public smokes");
  return Object.fromEntries(
    MAIN_DEPLOYMENT_TARGETS.map((target) => {
      const entry = value[target];
      assertExactKeys(
        entry,
        ["publicUrl", "runtime", "servedSha", "status"],
        `${target} public smoke`,
      );
      const active = planning.activeTargets.includes(target);
      if (
        entry.publicUrl !== ACTIVE_PUBLIC_URLS[target] ||
        entry.status !== (active ? "passed" : "not-required") ||
        entry.servedSha !== (active ? deploySha : null)
      ) {
        throw new Error(`${target} public smoke evidence is invalid`);
      }
      const runtime = active
        ? canonicalActiveRuntimeSmoke({
            value: entry.runtime,
            target,
            expectedSha: deploySha,
            label: `${target} public smoke runtime`,
          })
        : null;
      if (!active && entry.runtime !== null) {
        throw new Error(`${target} public smoke evidence is invalid`);
      }
      return [
        target,
        {
          publicUrl: ACTIVE_PUBLIC_URLS[target],
          runtime,
          servedSha: active ? deploySha : null,
          status: active ? "passed" : "not-required",
        },
      ];
    }),
  );
}

function canonicalFailurePublicSmokes(value) {
  if (value === null) return null;
  assertExactKeys(
    value,
    MAIN_DEPLOYMENT_TARGETS,
    "Active failure public smokes",
  );
  return Object.fromEntries(
    MAIN_DEPLOYMENT_TARGETS.map((target) => {
      const entry = value[target];
      assertExactKeys(
        entry,
        ["publicUrl", "runtime", "servedSha", "status"],
        `${target} failure public smoke`,
      );
      if (
        entry.publicUrl !== ACTIVE_PUBLIC_URLS[target] ||
        !["passed", "failed", "not-run"].includes(entry.status) ||
        (entry.servedSha !== null &&
          canonicalOptionalSha(entry.servedSha) !== entry.servedSha)
      ) {
        throw new Error(`${target} failure public smoke is invalid`);
      }
      const runtime =
        entry.status === "passed"
          ? canonicalActiveRuntimeSmoke({
              value: entry.runtime,
              target,
              expectedSha: entry.servedSha,
              label: `${target} failure public smoke runtime`,
            })
          : null;
      if (entry.status !== "passed" && entry.runtime !== null) {
        throw new Error(`${target} failure public smoke is invalid`);
      }
      return [
        target,
        {
          publicUrl: entry.publicUrl,
          runtime,
          servedSha: entry.servedSha,
          status: entry.status,
        },
      ];
    }),
  );
}

function summarizeActiveDeploymentStateProof(
  value,
  {
    allowMissing = false,
    deploySha,
    runId,
    runAttempt,
    transactionId,
    mainOwnershipMode,
    stagedTargets,
    activeTargets,
    shadowTargets,
    projectIds = null,
    expectedDeploymentIds = null,
    originalPriors = null,
    legacyState = null,
    requireProven = false,
  },
) {
  if (value === null) {
    if (allowMissing) return null;
    throw new Error("Active deployment state proof is required");
  }
  const proof = assertActiveDeploymentStateProof(value);
  if (
    proof.deploySha !== deploySha ||
    proof.runId !== String(runId) ||
    proof.runAttempt !== String(runAttempt) ||
    proof.transactionId !== transactionId ||
    JSON.stringify(proof.mainOwnershipMode) !==
      JSON.stringify(mainOwnershipMode) ||
    (stagedTargets !== undefined &&
      JSON.stringify(proof.stagedTargets) !== JSON.stringify(stagedTargets)) ||
    (activeTargets !== undefined &&
      JSON.stringify(proof.activeTargets) !== JSON.stringify(activeTargets)) ||
    (shadowTargets !== undefined &&
      JSON.stringify(proof.shadowTargets) !== JSON.stringify(shadowTargets))
  ) {
    throw new Error("Active deployment state proof does not match the release");
  }
  if (requireProven && proof.outcome !== "proven") {
    throw new Error("Active deployment state proof is not proven");
  }
  for (const target of MAIN_DEPLOYMENT_TARGETS) {
    const project = proof.projects[target];
    const originalPrior = originalPriors?.[target];
    if (
      (projectIds !== null && project.projectId !== projectIds[target]) ||
      (expectedDeploymentIds !== null &&
        expectedDeploymentIds[target] !== undefined &&
        project.expectedDeploymentId !== expectedDeploymentIds[target]) ||
      (originalPriors !== null &&
        (originalPrior === undefined ||
          project.priorDeploymentId !== originalPrior.deploymentId ||
          project.priorDeploymentUrl !== originalPrior.deploymentUrl ||
          project.priorServedSha !== originalPrior.servedSha))
    ) {
      throw new Error(
        "Active deployment state proof does not match the release plan",
      );
    }
  }
  if (legacyState !== null) {
    const expectedLegacy = {
      alias: legacyState.alias,
      deploymentId: legacyState.deploymentId,
      deploymentUrl: legacyState.deploymentUrl,
      projectId: legacyState.projectId,
      projectName: legacyState.projectName,
      readyState: legacyState.readyState,
      target: legacyState.target,
      customEnvironmentSlug: legacyState.customEnvironmentSlug,
      git: legacyState.git,
      ownership: "native-vercel-git",
    };
    if (JSON.stringify(proof.legacyAppV2) !== JSON.stringify(expectedLegacy)) {
      throw new Error(
        "Active deployment state proof does not match legacy App v2",
      );
    }
  }
  return {
    proofSchema: proof.schema,
    outcome: proof.outcome,
    transactionId: proof.transactionId,
    targets: Object.fromEntries(
      MAIN_DEPLOYMENT_TARGETS.map((target) => {
        const project = proof.projects[target];
        return [
          target,
          {
            expectedDisposition: project.expectedDisposition,
            expectedDeploymentId: project.expectedDeploymentId,
            counts: {
              scanned: project.counts.scanned,
              githubPrebuilt: project.counts.githubPrebuilt,
              githubShadowStage: project.counts.githubShadowStage,
              nativeGitOwner: project.counts.nativeGitOwner,
              nativeGitDuplicates: project.counts.nativeGitDuplicates,
              manualDuplicates: project.counts.manualDuplicates,
              unknown: project.counts.unknown,
            },
          },
        ];
      }),
    ),
    legacyAppV2: {
      deploymentId: proof.legacyAppV2.deploymentId,
      ownership: proof.legacyAppV2.ownership,
    },
  };
}

function canonicalRollbackStateTargets(value) {
  if (
    !Array.isArray(value) ||
    new Set(value).size !== value.length ||
    value.some((target) => !MAIN_ORDINARY_TARGETS.includes(target))
  ) {
    throw new Error("Active rollback-state targets are invalid");
  }
  return [...value];
}

function assertJournalMatchesActivePlanning(journal, planning) {
  for (const target of MAIN_DEPLOYMENT_TARGETS) {
    const selected = planning.stagedTargets.includes(target);
    const active = planning.activeTargets.includes(target);
    if (
      (selected && active && journal.candidates[target] === null) ||
      ((!selected || !active) && journal.candidates[target] !== null)
    ) {
      throw new Error(
        "Active journal candidates do not match per-target ownership",
      );
    }
  }
}

export function createMainActiveDeploymentEvidence({
  plan,
  journalHistory,
  freshness,
  finalMappings,
  publicSmokes,
  stateProof,
  rollbackStateTargets,
  publicServingMutationCommands,
  recoveryOutcome,
  runId,
  runAttempt,
  workflowRunUrl,
}) {
  const handoff = assertMainDeploymentHandoff(plan);
  const planning = createMainActivePlanning({ plan: handoff });
  const history = assertMainActiveJournalHistory({
    journals: journalHistory,
    deploySha: handoff.deploySha,
    runId,
    runAttempt,
  });
  const highest = history.at(-1);
  if (highest.status !== "committed") {
    throw new Error("Active success evidence requires a committed journal");
  }
  assertJournalMatchesActivePlanning(highest, planning);
  const mutations = operationMutationCounts(highest);
  const mutationCount = canonicalMutationCount(
    publicServingMutationCommands,
    "Active public-serving mutation commands",
  );
  if (mutationCount !== mutations.started) {
    throw new Error("Committed active mutation count differs from the journal");
  }
  if (recoveryOutcome !== "not-required") {
    throw new Error("Committed active evidence cannot contain recovery");
  }
  const rollbackTargets = canonicalRollbackStateTargets(rollbackStateTargets);
  if (rollbackTargets.length !== 0) {
    throw new Error("Committed active evidence cannot be in rollback state");
  }
  const mappings = canonicalFinalMappings(highest, finalMappings);
  const expectedRunId = requirePositiveId(runId, "Active evidence run ID");
  const expectedRunAttempt = requirePositiveId(
    runAttempt,
    "Active evidence run attempt",
  );
  const expectedWorkflowRunUrl = createMainWorkflowRunUrl({
    serverUrl: "https://github.com",
    repository: MAIN_TRANSACTION_REPOSITORY,
    runId: expectedRunId,
  });
  if (workflowRunUrl !== expectedWorkflowRunUrl) {
    throw new Error("Active evidence workflow run URL is invalid");
  }
  const stateProofSummary = summarizeActiveDeploymentStateProof(stateProof, {
    deploySha: handoff.deploySha,
    runId: expectedRunId,
    runAttempt: expectedRunAttempt,
    transactionId: highest.transactionId,
    mainOwnershipMode: planning.mainOwnershipMode,
    stagedTargets: planning.stagedTargets,
    activeTargets: planning.activeTargets,
    shadowTargets: planning.shadowTargets,
    projectIds: handoff.projectIds,
    expectedDeploymentIds: Object.fromEntries(
      MAIN_DEPLOYMENT_TARGETS.map((target) => [
        target,
        planning.activeTargets.includes(target)
          ? highest.candidates[target].deploymentId
          : planning.shadowTargets.includes(target)
            ? undefined
            : null,
      ]),
    ),
    originalPriors: Object.fromEntries(
      handoff.planning.priors.map((prior) => [prior.target, prior]),
    ),
    legacyState: handoff.legacySnapshot[0],
    requireProven: true,
  });
  return {
    schema: MAIN_ACTIVE_EVIDENCE_SCHEMA,
    mode: MAIN_ACTIVE_DEPLOYMENT_MODE,
    repository: MAIN_TRANSACTION_REPOSITORY,
    deploySha: handoff.deploySha,
    workflowDefinitionSha: handoff.deploySha,
    runId: expectedRunId,
    runAttempt: expectedRunAttempt,
    workflowRunUrl: expectedWorkflowRunUrl,
    planning,
    journal: {
      transactionId: highest.transactionId,
      artifactName: mainTransactionJournalArtifactName(highest),
      highestSequence: highest.sequence,
      highestStatus: highest.status,
    },
    orderedVerifiedOperations: canonicalOrderedVerifiedOperations(highest),
    freshness: canonicalFreshnessEvidence(freshness, { committed: true }),
    finalMappings: mappings,
    publicSmokes: canonicalPublicSmokes(
      publicSmokes,
      planning,
      handoff.deploySha,
    ),
    stateProofSummary,
    recovery: {
      outcome: recoveryOutcome,
      rollbackStateTargets: rollbackTargets,
    },
    publicServingMutationCommands: mutationCount,
    outcome: "active-committed",
  };
}

function classifyActiveFailureHistory({
  journalHistory,
  deploySha,
  runId,
  runAttempt,
}) {
  if (!Array.isArray(journalHistory) || journalHistory.length === 0) {
    return {
      historyStatus: "missing",
      highest: null,
      verifiedOperations: [],
      started: 0,
      confirmedReturned: 0,
    };
  }
  try {
    const history = assertMainActiveJournalHistory({
      journals: journalHistory,
      deploySha,
      runId,
      runAttempt,
    });
    const highest = history.at(-1);
    return {
      historyStatus: "valid",
      highest,
      verifiedOperations: canonicalOrderedVerifiedOperations(highest),
      ...operationMutationCounts(highest),
    };
  } catch {
    const individuallyValid = journalHistory.flatMap((journal) => {
      try {
        return [
          assertMainTransactionJournal(journal, {
            repository: MAIN_TRANSACTION_REPOSITORY,
            deploySha,
            runId: requirePositiveId(runId, "Failure evidence run ID"),
            runAttempt: requirePositiveId(
              runAttempt,
              "Failure evidence run attempt",
            ),
            mode: MAIN_ACTIVE_DEPLOYMENT_MODE,
          }),
        ];
      } catch {
        return [];
      }
    });
    const highest = individuallyValid
      .toSorted((left, right) => left.sequence - right.sequence)
      .at(-1);
    const counts =
      highest === undefined
        ? { started: 0, confirmedReturned: 0 }
        : operationMutationCounts(highest);
    return {
      historyStatus: "ambiguous",
      highest: highest ?? null,
      verifiedOperations: [],
      ...counts,
    };
  }
}

export function createMainActiveDeploymentFailureEvidence({
  eventHeadSha,
  verifiedDeploySha,
  planOutput,
  jobs,
  workflowDefinitionSha,
  runId,
  runAttempt,
  workflowRunUrl,
  mainOwnershipMode,
  journalHistory,
  freshness = [],
  finalMappings = null,
  publicSmokes = null,
  stateProof = null,
  rollbackStateTargets = [],
  publicServingMutationCommands,
  coordinatorOutcome,
  recoveryOutcome,
  errorCode,
}) {
  const expectedRunId = requirePositiveId(
    runId,
    "Active failure evidence run ID",
  );
  const expectedRunAttempt = requirePositiveId(
    runAttempt,
    "Active failure evidence run attempt",
  );
  const deploySha = canonicalOptionalSha(verifiedDeploySha);
  const history =
    deploySha === null
      ? {
          historyStatus:
            Array.isArray(journalHistory) && journalHistory.length === 0
              ? "missing"
              : "ambiguous",
          highest: null,
          verifiedOperations: [],
          started: 0,
          confirmedReturned: 0,
        }
      : classifyActiveFailureHistory({
          journalHistory,
          deploySha,
          runId: expectedRunId,
          runAttempt: expectedRunAttempt,
        });
  const mutationCount = canonicalMutationCount(
    publicServingMutationCommands,
    "Active failure public-serving mutation commands",
  );
  if (
    mutationCount < history.confirmedReturned ||
    (history.started > 0 && mutationCount === 0)
  ) {
    throw new Error(
      "Active failure evidence understates possible public mutations",
    );
  }
  const expectedWorkflowRunUrl = createMainWorkflowRunUrl({
    serverUrl: "https://github.com",
    repository: MAIN_TRANSACTION_REPOSITORY,
    runId: expectedRunId,
  });
  if (workflowRunUrl !== expectedWorkflowRunUrl) {
    throw new Error("Active failure evidence workflow run URL is invalid");
  }
  const highest = history.highest;
  if (highest === null && finalMappings !== null) {
    throw new Error("Active failure mappings require a valid journal identity");
  }
  const canonicalMappings =
    finalMappings === null
      ? null
      : canonicalFinalMappings(highest, finalMappings, { exact: false });
  const ownership = canonicalMainOwnershipMode(mainOwnershipMode);
  const expectedTransactionId =
    deploySha === null
      ? null
      : createMainTransactionId({
          repository: MAIN_TRANSACTION_REPOSITORY,
          deploySha,
          runId: expectedRunId,
          runAttempt: expectedRunAttempt,
        });
  if (stateProof !== null && deploySha === null) {
    throw new Error(
      "Active failure state proof requires a verified deployment SHA",
    );
  }
  const stateProofSummary = summarizeActiveDeploymentStateProof(stateProof, {
    allowMissing: true,
    deploySha,
    runId: expectedRunId,
    runAttempt: expectedRunAttempt,
    transactionId: expectedTransactionId,
    mainOwnershipMode: ownership,
  });
  return {
    schema: MAIN_ACTIVE_FAILURE_EVIDENCE_SCHEMA,
    mode: MAIN_ACTIVE_DEPLOYMENT_MODE,
    repository: MAIN_TRANSACTION_REPOSITORY,
    eventHeadSha: canonicalOptionalSha(eventHeadSha),
    verifiedDeploySha: deploySha,
    workflowDefinitionSha: requireSha(
      workflowDefinitionSha,
      "Active failure workflow definition SHA",
    ),
    runId: expectedRunId,
    runAttempt: expectedRunAttempt,
    workflowRunUrl: expectedWorkflowRunUrl,
    planOutputPresent: typeof planOutput === "string" && planOutput.length > 0,
    jobs: canonicalFinalJobResults(jobs, "Active failure evidence job results"),
    mainOwnershipMode: ownership,
    journal: {
      historyStatus: history.historyStatus,
      transactionId: highest?.transactionId ?? null,
      artifactName:
        highest === null ? null : mainTransactionJournalArtifactName(highest),
      highestSequence: highest?.sequence ?? null,
      highestStatus: highest?.status ?? null,
    },
    orderedVerifiedOperations: history.verifiedOperations,
    freshness: canonicalFreshnessEvidence(freshness),
    finalMappings: canonicalMappings,
    publicSmokes: canonicalFailurePublicSmokes(publicSmokes),
    stateProofSummary,
    rollbackStateTargets: canonicalRollbackStateTargets(rollbackStateTargets),
    publicServingMutationCommands: mutationCount,
    coordinatorOutcome: requireString(
      coordinatorOutcome,
      "Active failure coordinator outcome",
      /^[a-z][a-z0-9-]*$/,
    ),
    recoveryOutcome: requireString(
      recoveryOutcome,
      "Active failure recovery outcome",
      /^[a-z][a-z0-9-]*$/,
    ),
    errorCode: requireString(
      errorCode,
      "Active failure error code",
      /^[A-Z][A-Z0-9_]*$/,
    ),
    outcome: "failed",
  };
}

export function renderMainActiveDeploymentEvidence(evidence) {
  if (
    !isPlainObject(evidence) ||
    evidence.schema !== MAIN_ACTIVE_EVIDENCE_SCHEMA ||
    evidence.outcome !== "active-committed"
  ) {
    throw new Error("Active deployment evidence is malformed");
  }
  return [
    "### Vercel main active deployment evidence",
    "",
    `- DEPLOY_SHA: \`${evidence.deploySha}\``,
    `- Journal: \`${evidence.journal.artifactName}\` at sequence \`${evidence.journal.highestSequence}\` (\`${evidence.journal.highestStatus}\`)`,
    `- Verified operations: \`${evidence.orderedVerifiedOperations.length}\` in journal order`,
    `- Public-serving mutation commands: \`${evidence.publicServingMutationCommands}\``,
    `- Per-target main ownership: ${MAIN_DEPLOYMENT_TARGETS.map(
      (target) =>
        `\`${target}:${evidence.planning.mainOwnershipMode[target]}\``,
    ).join(", ")}`,
    `- Public smokes: ${MAIN_DEPLOYMENT_TARGETS.map(
      (target) => `\`${target}:${evidence.publicSmokes[target].status}\``,
    ).join(", ")}`,
    `- Canonical deployment state proof: \`${evidence.stateProofSummary.proofSchema}\` is \`${evidence.stateProofSummary.outcome}\``,
    `- Deployment dispositions: ${MAIN_DEPLOYMENT_TARGETS.map(
      (target) =>
        `\`${target}:${evidence.stateProofSummary.targets[target].expectedDisposition ?? "unselected"}\``,
    ).join(", ")}`,
    `- Legacy v2: \`${evidence.stateProofSummary.legacyAppV2.ownership}\` at \`${evidence.stateProofSummary.legacyAppV2.deploymentId}\``,
    "- Recovery: `not-required`; ordinary rollback-state targets: none",
    "",
  ].join("\n");
}

export function renderMainCurrentReleaseVerificationEvidence(evidence) {
  if (
    !isPlainObject(evidence) ||
    evidence.schema !== MAIN_ACTIVE_CURRENT_RELEASE_EVIDENCE_SCHEMA ||
    evidence.outcome !== "current-release-verified" ||
    evidence.publicServingMutationCommands !== 0
  ) {
    throw new Error("Current release verification evidence is malformed");
  }
  return [
    "### Vercel main current-release verification evidence",
    "",
    `- DEPLOY_SHA: \`${evidence.deploySha}\``,
    `- Downstream workflow: [run ${evidence.runId}, attempt ${evidence.runAttempt}](${evidence.workflowRunUrl})`,
    "- Existing GitHub-built release verified; no activation, alias, promotion, rollback, or recovery command ran.",
    `- Active targets: ${evidence.planning.activeTargets.map((target) => `\`${target}\``).join(", ")}`,
    `- Public smokes: ${MAIN_DEPLOYMENT_TARGETS.map(
      (target) => `\`${target}:${evidence.publicSmokes[target].status}\``,
    ).join(", ")}`,
    `- Canonical deployment state proof: \`${evidence.stateProofSummary.proofSchema}\` is \`${evidence.stateProofSummary.outcome}\``,
    "- Active journal: `not-applicable`",
    "- Public-serving mutation commands: `0`",
    "",
  ].join("\n");
}

export function renderMainActivePreparationFailureEvidence(evidence) {
  if (
    !isPlainObject(evidence) ||
    evidence.schema !== MAIN_ACTIVE_PREPARATION_FAILURE_EVIDENCE_SCHEMA ||
    evidence.outcome !== "failed" ||
    evidence.reason !== "preparation-failed-before-journal" ||
    evidence.publicServingMutationCommands !== 0 ||
    !isPlainObject(evidence.stageResults) ||
    !isPlainObject(evidence.stageResults.results)
  ) {
    throw new Error("Active preparation failure evidence is malformed");
  }
  return [
    "### Vercel main active preparation failure evidence",
    "",
    `- DEPLOY_SHA: \`${evidence.deploySha}\``,
    `- Downstream workflow: [run ${evidence.runId}, attempt ${evidence.runAttempt}](${evidence.workflowRunUrl})`,
    `- Stage results: ${MAIN_DEPLOYMENT_TARGETS.map(
      (target) => `\`${target}:${evidence.stageResults.results[target]}\``,
    ).join(", ")}; \`coordinator:${evidence.stageResults.coordinatorResult}\``,
    "- Active journal: `not-created`",
    "- Public-serving mutation commands: `0`",
    "- Outcome: `failed` before the forward journal; this attempt authorized no public mapping mutation.",
    "",
  ].join("\n");
}

export function renderMainActiveDeploymentFailureEvidence(evidence) {
  if (
    !isPlainObject(evidence) ||
    evidence.schema !== MAIN_ACTIVE_FAILURE_EVIDENCE_SCHEMA ||
    evidence.outcome !== "failed"
  ) {
    throw new Error("Active deployment failure evidence is malformed");
  }
  return [
    "### Vercel main active deployment failure evidence",
    "",
    `- Downstream workflow: [run ${evidence.runId}, attempt ${evidence.runAttempt}](${evidence.workflowRunUrl})`,
    `- Journal history: \`${evidence.journal.historyStatus}\`; highest sequence: \`${evidence.journal.highestSequence ?? "unavailable"}\``,
    `- Verified operations recorded: \`${evidence.orderedVerifiedOperations.length}\``,
    `- Public-serving mutation commands: \`${evidence.publicServingMutationCommands}\``,
    `- Coordinator: \`${evidence.coordinatorOutcome}\`; recovery: \`${evidence.recoveryOutcome}\``,
    `- Error code: \`${evidence.errorCode}\``,
    `- Canonical deployment state proof: ${
      evidence.stateProofSummary === null
        ? "unavailable"
        : `\`${evidence.stateProofSummary.proofSchema}\` is \`${evidence.stateProofSummary.outcome}\``
    }`,
    `- Ordinary rollback-state targets: ${
      evidence.rollbackStateTargets
        .map((target) => `\`${target}\``)
        .join(", ") || "none"
    }`,
    "- Outcome: `failed`; publish this evidence before failing the release.",
    "",
  ].join("\n");
}

export function renderMainDeploymentEvidence(evidence) {
  if (!isPlainObject(evidence) || evidence.schema !== MAIN_EVIDENCE_SCHEMA) {
    throw new Error("Main deployment evidence is malformed");
  }
  const lines = [
    "### Vercel main deployment shadow evidence",
    "",
    `- DEPLOY_SHA: \`${evidence.deploySha}\``,
    `- Downstream workflow: [run ${evidence.runId}, attempt ${evidence.runAttempt}](${evidence.workflowRunUrl})`,
    `- Final plan: ${
      evidence.planning.stagedTargets.length === 0
        ? "no targets"
        : evidence.planning.stagedTargets
            .map((target) => `\`${target}\``)
            .join(", ")
    }`,
    `- Upstream CI: [run ${evidence.upstream.runId}, attempt ${evidence.upstream.runAttempt}](${evidence.upstream.runUrl})`,
    `- Workflow definition SHA: \`${evidence.workflowDefinitionSha}\``,
    `- Upstream sentinel: [Build and Test](${evidence.upstream.buildAndTestJobUrl}) — \`${evidence.upstream.buildAndTestConclusion}\``,
    "",
    "#### Served deployment priors",
    "",
    "| Target | Deployment | Served SHA | Reviewed aliases |",
    "|---|---|---|---|",
    ...evidence.planning.priors.map(
      (prior) =>
        `| ${prior.target} | \`${prior.deploymentId}\` / ${prior.deploymentUrl} | ${
          prior.servedSha ? `\`${prior.servedSha}\`` : "unknown"
        } | ${prior.aliases.map((alias) => `\`${alias}\``).join(", ")} |`,
    ),
    `| legacy-app | \`${evidence.legacy.deploymentId}\` / ${evidence.legacy.deploymentUrl} | \`${evidence.legacy.servedSha}\` (\`${evidence.legacy.ref}\`, \`${evidence.legacy.readyState}\`, health \`${evidence.legacy.health}\`) | \`${evidence.legacy.alias}\` |`,
    "",
    "#### Served-SHA ranges and selection reasons",
    "",
    "| Kind | Base → head | Source targets | Selected packages | Reason |",
    "|---|---|---|---|---|",
    ...evidence.planning.ranges.map(
      (range) =>
        `| ${range.kind} | ${
          range.base ? `\`${range.base}\`` : "unknown"
        } → \`${range.head}\` | ${range.targets.join(", ")} | ${
          range.deployments.join(", ") || "none"
        } | \`${range.reason}\` |`,
    ),
    "",
    ...evidence.planning.reasons.map(
      (reason) =>
        `- \`${reason.target}\`: \`${reason.reason}\`${
          reason.base ? ` from \`${reason.base}\`` : ""
        }`,
    ),
    "",
    "#### Candidate evidence",
    "",
    "| Target | Candidate | Verification | Build / deploy / runner | Turbo cache |",
    "|---|---|---|---|---|",
    ...MAIN_ORDINARY_TARGETS.map((target) => {
      const stage = evidence.stages[target];
      return stage === null
        ? `| ${target} | not selected | n/a | n/a | n/a |`
        : `| ${target} | \`${stage.candidate.deploymentId}\` / ${stage.candidate.deploymentUrl} | canonical \`${stage.verification.canonicalState}\`; immutable browser/runtime/security \`${stage.verification.immutableSmoke}\`; mappings \`${stage.verification.protectedMappings}\` | ${stage.metrics.buildDurationMs} / ${stage.metrics.deployDurationMs} / ${stage.metrics.totalDurationMs} ms | ${stage.metrics.turboCacheHits} hit / ${stage.metrics.turboCacheMisses} miss |`;
    }),
    evidence.app === null
      ? "| app | not built | n/a | n/a | n/a |"
      : `| app | build-only Next ID \`${evidence.app.nextDeploymentId}\` | exact custom-v3 build proof; deploy unreachable | ${evidence.app.metrics.buildDurationMs} / n/a / ${evidence.app.metrics.totalDurationMs} ms | ${evidence.app.metrics.turboCacheHits} hit / ${evidence.app.metrics.turboCacheMisses} miss |`,
    "",
    `- Coordinator: \`${evidence.coordinator.outcome}\` in ${evidence.coordinator.totalDurationMs} ms`,
    `- Journal: ${
      evidence.journal
        ? `\`${evidence.journal.artifactName}\` (artifact \`${evidence.journal.journalArtifactId}\`, sequence \`${evidence.journal.sequence}\`, status \`${evidence.journal.status}\`) for \`${evidence.journal.transactionId}\``
        : "not created"
    }`,
    `- Recovery: \`${evidence.recovery.outcome}\``,
    `- Freshness barriers: before App preparation \`${evidence.freshness.beforeAppPreparation}\`; before transaction \`${evidence.freshness.beforeTransaction}\``,
    "- Ordinary rollback-state targets: none",
    `- Unaliased ordinary staging uploads: ${
      MAIN_ORDINARY_TARGETS.filter((target) => evidence.stages[target] !== null)
        .map((target) => `\`${target}\``)
        .join(", ") || "none"
    }`,
    "- Public-serving activation, alias, promotion, rollback, and recovery commands: `0`",
    "",
  ];
  return lines.join("\n");
}

export function renderMainDeploymentFailureEvidence(evidence) {
  assertExactKeys(
    evidence,
    [
      "eventHeadSha",
      "jobs",
      "mode",
      "outcome",
      "planOutputPresent",
      "publicServingMutationCommands",
      "repository",
      "runAttempt",
      "runId",
      "schema",
      "verifiedDeploySha",
      "workflowDefinitionSha",
      "workflowRunUrl",
    ],
    "Main deployment failure evidence",
  );
  if (
    evidence.schema !== MAIN_FAILURE_EVIDENCE_SCHEMA ||
    evidence.mode !== MAIN_DEPLOYMENT_MODE ||
    evidence.repository !== MAIN_TRANSACTION_REPOSITORY ||
    evidence.outcome !== "failed" ||
    typeof evidence.planOutputPresent !== "boolean" ||
    evidence.publicServingMutationCommands !== 0
  ) {
    throw new Error("Main deployment failure evidence is malformed");
  }
  const jobs = canonicalFinalJobResults(
    evidence.jobs,
    "Failure evidence job results",
  );
  const runUrl = createMainWorkflowRunUrl({
    serverUrl: "https://github.com",
    repository: evidence.repository,
    runId: evidence.runId,
  });
  if (
    evidence.workflowRunUrl !== runUrl ||
    requirePositiveId(evidence.runAttempt, "Failure evidence run attempt") !==
      evidence.runAttempt ||
    requireSha(
      evidence.workflowDefinitionSha,
      "Failure evidence workflow definition SHA",
    ) !== evidence.workflowDefinitionSha ||
    (evidence.eventHeadSha !== null &&
      canonicalOptionalSha(evidence.eventHeadSha) !== evidence.eventHeadSha) ||
    (evidence.verifiedDeploySha !== null &&
      canonicalOptionalSha(evidence.verifiedDeploySha) !==
        evidence.verifiedDeploySha)
  ) {
    throw new Error("Main deployment failure evidence is malformed");
  }
  return [
    "### Vercel main deployment failure evidence",
    "",
    `- Downstream workflow: [run ${evidence.runId}, attempt ${evidence.runAttempt}](${evidence.workflowRunUrl})`,
    `- Workflow definition SHA: \`${evidence.workflowDefinitionSha}\``,
    `- Event head SHA: ${
      evidence.eventHeadSha ? `\`${evidence.eventHeadSha}\`` : "unavailable"
    }`,
    `- Verified deploy SHA: ${
      evidence.verifiedDeploySha
        ? `\`${evidence.verifiedDeploySha}\``
        : "unavailable"
    }`,
    `- Planner output: ${
      evidence.planOutputPresent ? "present but not embedded" : "unavailable"
    }`,
    "",
    "#### Final job graph",
    "",
    "| Job | Result |",
    "|---|---|",
    ...FINAL_JOB_KEYS.map((name) => `| ${name} | \`${jobs[name]}\` |`),
    "",
    "- Public-serving activation, alias, promotion, rollback, and recovery commands: `0`",
    "- Outcome: `failed`; this report does not authorize activation.",
    "",
  ].join("\n");
}

export function assertMainFinalResults({
  plan,
  jobs,
  coordinatorOutcome,
  recoveryOutcome,
}) {
  const handoff = assertMainDeploymentHandoff(plan);
  const canonicalJobs = canonicalFinalJobResults(jobs);
  if (
    canonicalJobs.waitForCi !== "success" ||
    canonicalJobs.plan !== "success" ||
    canonicalJobs.coordinator !== "success" ||
    canonicalJobs.recovery !== "success"
  ) {
    throw new Error("A required main deployment job did not succeed");
  }
  for (const target of MAIN_ORDINARY_TARGETS) {
    const jobName =
      target === "governance"
        ? "stageGovernance"
        : target === "reserve"
          ? "stageReserve"
          : "stageUi";
    const expected = handoff.planning.stagedTargets.includes(target)
      ? "success"
      : "skipped";
    if (canonicalJobs[jobName] !== expected) {
      throw new Error(`Final stage result is invalid for ${target}`);
    }
  }
  if (
    ![
      "shadow-prepared",
      "superseded-before-journal",
      "superseded-after-journal",
      "no-target",
    ].includes(coordinatorOutcome)
  ) {
    throw new Error("Coordinator outcome is not safe for PR A");
  }
  const durableJournalExists = [
    "shadow-prepared",
    "superseded-after-journal",
  ].includes(coordinatorOutcome);
  if (durableJournalExists && recoveryOutcome !== "verified-no-mutation") {
    throw new Error("Prepared shadow transaction was not recovery-verified");
  }
  if (!durableJournalExists && recoveryOutcome !== "not-required") {
    throw new Error("No-op coordinator outcome has unexpected recovery");
  }
  return { outcome: coordinatorOutcome };
}

export function evaluateMainActiveFinalResults({
  execution,
  jobs,
  coordinatorOutcome,
  recoveryOutcome,
}) {
  const releaseExecution = assertMainReleaseExecution(execution);
  const planning = activePlanningFromExecution(releaseExecution);
  const canonicalJobs = canonicalFinalJobResults(
    jobs,
    "Active final job results",
  );
  const coordinator = requireString(
    coordinatorOutcome,
    "Active coordinator outcome",
    /^[a-z][a-z0-9-]*$/,
  );
  const recovery = requireString(
    recoveryOutcome,
    "Active recovery outcome",
    /^[a-z][a-z0-9-]*$/,
  );
  const result = (releaseOutcome, reason) => ({
    releaseOutcome,
    evidenceKind: releaseOutcome === "success" ? "success" : "failure",
    failAfterEvidence: releaseOutcome === "failure",
    reason,
  });

  if (
    canonicalJobs.waitForCi !== "success" ||
    canonicalJobs.plan !== "success"
  ) {
    return result("failure", "admission-or-plan-failed");
  }
  for (const target of MAIN_ORDINARY_TARGETS) {
    const jobName =
      target === "governance"
        ? "stageGovernance"
        : target === "reserve"
          ? "stageReserve"
          : "stageUi";
    const expected = planning.stagedTargets.includes(target)
      ? "success"
      : "skipped";
    if (canonicalJobs[jobName] !== expected) {
      return result("failure", `stage-${target}-invalid`);
    }
  }

  if (
    ["recovered", "manual-intervention", "recovery-failed"].includes(recovery)
  ) {
    if (
      canonicalJobs.coordinator === "failure" &&
      canonicalJobs.recovery === "failure"
    ) {
      return result("failure", `activation-${recovery}`);
    }
    return result("failure", "unexpected-active-job-graph");
  }
  if (coordinator === "preparation-failed-before-journal") {
    if (
      canonicalJobs.coordinator === "failure" &&
      canonicalJobs.recovery === "failure"
    ) {
      return result("failure", "preparation-failed-before-journal");
    }
    return result("failure", "unexpected-active-job-graph");
  }
  if (
    coordinator === "active-committed" &&
    canonicalJobs.coordinator === "success" &&
    canonicalJobs.recovery === "skipped" &&
    planning.activeTargets.length > 0 &&
    recovery === "not-required"
  ) {
    return result("success", "active-committed");
  }
  if (
    coordinator === "current-release-verified" &&
    canonicalJobs.coordinator === "success" &&
    canonicalJobs.recovery === "skipped" &&
    planning.activeTargets.length > 0 &&
    releaseExecution.decision === "verify-existing-release" &&
    releaseExecution.reason === "current-main-release-already-complete" &&
    recovery === "not-required"
  ) {
    return result("success", "current-release-verified");
  }
  if (
    ((coordinator === "shadow-prepared" &&
      planning.stagedTargets.length > 0 &&
      planning.activeTargets.length === 0) ||
      ["no-target", "superseded-before-journal"].includes(coordinator)) &&
    canonicalJobs.coordinator === "success" &&
    canonicalJobs.recovery === "skipped" &&
    (coordinator !== "no-target" || releaseExecution.projection.noTarget) &&
    recovery === "not-required"
  ) {
    return result("success", coordinator);
  }
  if (
    coordinator === "active-failed" &&
    [
      "verified-no-mutation",
      "recovered",
      "manual-intervention",
      "recovery-failed",
      "not-found-after-runner-failure",
    ].includes(recovery)
  ) {
    return result("failure", `active-failed-${recovery}`);
  }
  return result("failure", "unexpected-active-job-graph");
}

export function createMainActiveSafeNoopEvidence({
  plan,
  jobs,
  coordinatorOutcome,
  recoveryOutcome,
  verifiedDeploySha,
  workflowDefinitionSha,
  runId,
  runAttempt,
  workflowRunUrl,
}) {
  const handoff = assertMainDeploymentHandoff(plan);
  const canonicalJobs = canonicalFinalJobResults(
    jobs,
    "Active safe-noop evidence job results",
  );
  const planning = createMainActivePlanning({ plan: handoff });
  const safeCoordinator =
    coordinatorOutcome === "no-target" ||
    coordinatorOutcome === "superseded-before-journal" ||
    (coordinatorOutcome === "shadow-prepared" &&
      planning.stagedTargets.length > 0 &&
      planning.activeTargets.length === 0);
  const stagesMatch = MAIN_ORDINARY_TARGETS.every((target) => {
    const jobName =
      target === "governance"
        ? "stageGovernance"
        : target === "reserve"
          ? "stageReserve"
          : "stageUi";
    return (
      canonicalJobs[jobName] ===
      (planning.stagedTargets.includes(target) ? "success" : "skipped")
    );
  });
  const verdict =
    canonicalJobs.waitForCi === "success" &&
    canonicalJobs.plan === "success" &&
    canonicalJobs.coordinator === "success" &&
    canonicalJobs.recovery === "success" &&
    recoveryOutcome === "not-required" &&
    stagesMatch &&
    safeCoordinator
      ? {
          releaseOutcome: "success",
          evidenceKind: "success",
          failAfterEvidence: false,
          reason: coordinatorOutcome,
        }
      : {
          releaseOutcome: "failure",
          evidenceKind: "failure",
          failAfterEvidence: true,
          reason: "unexpected-active-job-graph",
        };
  if (
    verdict.releaseOutcome !== "success" ||
    verdict.evidenceKind !== "success" ||
    verdict.failAfterEvidence ||
    verdict.reason === "active-committed"
  ) {
    throw new Error("Active safe-noop evidence requires a safe no-op verdict");
  }
  const deploySha = requireSha(
    verifiedDeploySha,
    "Active safe-noop deployment SHA",
  );
  if (deploySha !== handoff.deploySha) {
    throw new Error("Active safe-noop deployment SHA does not match the plan");
  }
  const definitionSha = requireSha(
    workflowDefinitionSha,
    "Active safe-noop workflow definition SHA",
  );
  if (definitionSha !== handoff.deploySha) {
    throw new Error(
      "Active safe-noop workflow definition SHA does not match the plan",
    );
  }
  const expectedRunId = requirePositiveId(
    runId,
    "Active safe-noop evidence run ID",
  );
  const expectedRunAttempt = requirePositiveId(
    runAttempt,
    "Active safe-noop evidence run attempt",
  );
  const expectedWorkflowRunUrl = createMainWorkflowRunUrl({
    serverUrl: "https://github.com",
    repository: MAIN_TRANSACTION_REPOSITORY,
    runId: expectedRunId,
  });
  if (workflowRunUrl !== expectedWorkflowRunUrl) {
    throw new Error("Active safe-noop evidence workflow run URL is invalid");
  }
  return {
    schema: MAIN_ACTIVE_SAFE_NOOP_EVIDENCE_SCHEMA,
    mode: MAIN_ACTIVE_DEPLOYMENT_MODE,
    repository: MAIN_TRANSACTION_REPOSITORY,
    deploySha,
    workflowDefinitionSha: definitionSha,
    runId: expectedRunId,
    runAttempt: expectedRunAttempt,
    workflowRunUrl: expectedWorkflowRunUrl,
    planning: createMainActivePlanning({ plan: handoff }),
    jobs: canonicalJobs,
    coordinatorOutcome,
    recoveryOutcome,
    publicServingMutationCommands: 0,
    outcome: "success",
    reason: verdict.reason,
  };
}

export function renderMainActiveSafeNoopEvidence(evidence) {
  if (
    !isPlainObject(evidence) ||
    evidence.schema !== MAIN_ACTIVE_SAFE_NOOP_EVIDENCE_SCHEMA ||
    evidence.outcome !== "success" ||
    !["no-target", "superseded-before-journal", "shadow-prepared"].includes(
      evidence.reason,
    ) ||
    evidence.publicServingMutationCommands !== 0
  ) {
    throw new Error("Active safe-noop evidence is malformed");
  }
  const targets = (value) =>
    value.map((target) => `\`${target}\``).join(", ") || "none";
  return [
    "### Vercel main active safe-noop evidence",
    "",
    `- DEPLOY_SHA: \`${evidence.deploySha}\``,
    `- Downstream workflow: [run ${evidence.runId}, attempt ${evidence.runAttempt}](${evidence.workflowRunUrl})`,
    `- Outcome: \`success\` (\`${evidence.reason}\`)`,
    `- Staged targets: ${targets(evidence.planning.stagedTargets)}`,
    `- GitHub-owned active targets: ${targets(evidence.planning.activeTargets)}`,
    `- Native-owned shadow targets: ${targets(evidence.planning.shadowTargets)}`,
    `- Coordinator: \`${evidence.coordinatorOutcome}\`; recovery: \`${evidence.recoveryOutcome}\``,
    "- Active journal: `not-required`",
    "- Public-serving mutation commands: `0`",
    "",
  ].join("\n");
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function assertSameJson(actual, expected, label) {
  if (!sameJson(actual, expected)) {
    throw new Error(`${label} is not canonical`);
  }
  return expected;
}

function digestCanonicalJson(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function canonicalTerminalArtifact(value, label, depth = 0) {
  if (depth > 12) throw new Error(`${label} is too deeply nested`);
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      throw new Error(`${label} contains a noncanonical number`);
    }
    return value;
  }
  if (typeof value === "string") {
    if (value.length > 4096) {
      throw new Error(`${label} contains an oversized string`);
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > 512) {
      throw new Error(`${label} contains too many entries`);
    }
    return value.map((entry, index) =>
      canonicalTerminalArtifact(entry, `${label}[${index}]`, depth + 1),
    );
  }
  if (!isPlainObject(value)) {
    throw new Error(`${label} is not canonical JSON`);
  }
  const keys = Object.keys(value);
  if (keys.length > 128) {
    throw new Error(`${label} contains too many fields`);
  }
  return Object.fromEntries(
    keys.map((key) => {
      if (!/^[A-Za-z][A-Za-z0-9_.-]{0,127}$/.test(key)) {
        throw new Error(`${label} contains an unsafe field name`);
      }
      return [
        key,
        canonicalTerminalArtifact(value[key], `${label}.${key}`, depth + 1),
      ];
    }),
  );
}

function canonicalTerminalProof(value, label, { journal = false } = {}) {
  assertExactKeys(value, ["status", "artifact"], label);
  const statuses = journal
    ? ["committed", "recovered", "manual-intervention", "not-applicable"]
    : ["passed", "not-required", "superseded", "prepared", "unsafe"];
  if (!statuses.includes(value.status)) {
    throw new Error(`${label} status is malformed`);
  }
  const notApplicable = journal
    ? value.status === "not-applicable"
    : value.status === "not-required";
  if (notApplicable) {
    if (value.artifact !== null) {
      throw new Error(`${label} must not carry an artifact`);
    }
    return {
      receipt: { status: value.status, digest: null },
      artifact: null,
    };
  }
  if (
    value.artifact === null ||
    (typeof value.artifact !== "object" && !Array.isArray(value.artifact))
  ) {
    throw new Error(`${label} artifact is required`);
  }
  const artifact = canonicalTerminalArtifact(
    value.artifact,
    `${label} artifact`,
  );
  return {
    receipt: {
      status: value.status,
      digest: digestCanonicalJson(artifact),
    },
    artifact,
  };
}

export function assertMainActiveTerminalProofs(value) {
  assertExactKeys(
    value,
    [
      "schema",
      "releaseId",
      "releaseManifestDigest",
      "releaseExecutionDigest",
      "producerJob",
      "outcome",
      "finalMapping",
      "finalCensus",
      "stateProof",
      "publicSmoke",
      "freshLegacyV2",
      "mutationCount",
      "rollbackTargets",
      "affectedOperations",
      "journal",
    ],
    "Main active terminal proofs",
  );
  if (value.schema !== MAIN_ACTIVE_TERMINAL_PROOFS_SCHEMA) {
    throw new Error("Main active terminal proofs schema is unsupported");
  }
  const releaseId = requireString(
    value.releaseId,
    "Main active terminal proof release ID",
    /^mr-[a-f0-9]{24}$/,
  );
  const releaseManifestDigest = requireString(
    value.releaseManifestDigest,
    "Main active terminal proof manifest digest",
    /^[a-f0-9]{64}$/,
  );
  const releaseExecutionDigest = requireString(
    value.releaseExecutionDigest,
    "Main active terminal proof execution digest",
    /^[a-f0-9]{64}$/,
  );
  if (
    !["activate-and-verify", "recover-main-deployment"].includes(
      value.producerJob,
    )
  ) {
    throw new Error("Main active terminal proof producer is unsupported");
  }
  const outcome = requireString(
    value.outcome,
    "Main active terminal outcome",
    /^(?:active-committed|current-release-verified|recovered|verified-noop|no-target|superseded-before-journal|shadow-prepared|manual-intervention|preparation-failed-before-journal)$/,
  );
  const finalMapping = canonicalTerminalProof(
    value.finalMapping,
    "Main terminal final mapping proof",
  );
  const finalCensus = canonicalTerminalProof(
    value.finalCensus,
    "Main terminal final census proof",
  );
  const stateProof = canonicalTerminalProof(
    value.stateProof,
    "Main terminal state proof",
  );
  const publicSmoke = canonicalTerminalProof(
    value.publicSmoke,
    "Main terminal public smoke proof",
  );
  const freshLegacyV2 = canonicalTerminalProof(
    value.freshLegacyV2,
    "Main terminal fresh legacy v2 proof",
  );
  const journal = canonicalTerminalProof(
    value.journal,
    "Main terminal journal proof",
    { journal: true },
  );
  const mutationCount = canonicalMutationCount(
    value.mutationCount,
    "Main terminal mutation count",
  );
  const rollbackTargets = canonicalRollbackStateTargets(value.rollbackTargets);
  const affectedOperations = canonicalTerminalAffectedOperations(
    value.affectedOperations,
  );
  if (
    (outcome === "manual-intervention" &&
      (affectedOperations.length === 0 ||
        affectedOperations.length !== mutationCount)) ||
    (outcome !== "manual-intervention" && affectedOperations.length !== 0)
  ) {
    throw new Error(
      "Main terminal affected operations conflict with the outcome",
    );
  }
  return {
    schema: MAIN_ACTIVE_TERMINAL_PROOFS_SCHEMA,
    releaseId,
    releaseManifestDigest,
    releaseExecutionDigest,
    producerJob: value.producerJob,
    outcome,
    finalMapping,
    finalCensus,
    stateProof,
    publicSmoke,
    freshLegacyV2,
    mutationCount,
    rollbackTargets,
    affectedOperations,
    journal,
  };
}

function canonicalTerminalJournalHistory(
  value,
  { execution, runId, runAttempt },
) {
  if (Array.isArray(value)) {
    if (value.length !== 0) {
      throw new Error(
        "Non-empty terminal journal history requires its canonical document",
      );
    }
    return [];
  }
  assertExactKeys(
    value,
    [
      "schema",
      "transactionId",
      "highestSequence",
      "highestStatus",
      "highestArtifactName",
      "journals",
    ],
    "Terminal journal history document",
  );
  if (value.schema !== MAIN_ACTIVE_HISTORY_SCHEMA) {
    throw new Error("Terminal journal history schema is unsupported");
  }
  const journals = assertMainActiveJournalHistory({
    journals: value.journals,
    deploySha: execution.manifest.deploySha,
    runId,
    runAttempt,
  });
  const highest = journals.at(-1);
  assertSameJson(
    {
      transactionId: value.transactionId,
      highestSequence: value.highestSequence,
      highestStatus: value.highestStatus,
      highestArtifactName: value.highestArtifactName,
    },
    {
      transactionId: highest.transactionId,
      highestSequence: highest.sequence,
      highestStatus: highest.status,
      highestArtifactName: mainTransactionJournalArtifactName(highest),
    },
    "Terminal journal history summary",
  );
  return journals;
}

function canonicalTerminalProviderMappings(value) {
  assertExactKeys(
    value,
    ["schema", "mappings"],
    "Terminal canonical mapping set",
  );
  if (value.schema !== "vercel-main-canonical-mappings:v1") {
    throw new Error("Terminal canonical mapping schema is unsupported");
  }
  const targets = ["governance", "reserve", "ui", "app", "legacy-app"];
  assertExactKeys(value.mappings, targets, "Terminal canonical mappings");
  return targets.flatMap((target) => {
    if (!Array.isArray(value.mappings[target])) {
      throw new Error(`Terminal ${target} mappings are malformed`);
    }
    return value.mappings[target];
  });
}

function canonicalTerminalFreshLegacyV2(value, execution) {
  assertCanonicalOutput(value);
  if (
    !Array.isArray(value) ||
    value.length !== 1 ||
    !sameJson(value[0], execution.legacyAppV2)
  ) {
    throw new Error(
      "Terminal fresh legacy v2 snapshot conflicts with the execution",
    );
  }
  return value[0];
}

function terminalExpectedCandidateIds(highest, planning) {
  return Object.fromEntries(
    MAIN_DEPLOYMENT_TARGETS.map((target) => [
      target,
      planning.activeTargets.includes(target)
        ? highest.candidates[target]?.deploymentId
        : planning.shadowTargets.includes(target)
          ? undefined
          : null,
    ]),
  );
}

function terminalDeploymentStateProof({
  value,
  execution,
  runId,
  runAttempt,
  requireWrapper,
}) {
  if (
    isPlainObject(value) &&
    value.schema === MAIN_TERMINAL_STATE_PROOF_SCHEMA
  ) {
    const wrapper = canonicalTerminalStateProof(value, {
      execution,
      runId,
      runAttempt,
    });
    return {
      artifact: wrapper,
      deploymentStateProof: wrapper.deploymentStateProof,
    };
  }
  if (requireWrapper) {
    throw new Error("Terminal state proof wrapper is required");
  }
  return {
    artifact: value,
    deploymentStateProof:
      value === null ? null : assertActiveDeploymentStateProof(value),
  };
}

function canonicalCompleteTerminalStateProof({
  value,
  execution,
  planning,
  highest,
  runId,
  runAttempt,
  requireWrapper = false,
  expectedCandidateIds = null,
}) {
  if (value === null) {
    throw new Error("Complete terminal state proof is required");
  }
  const terminalProof = terminalDeploymentStateProof({
    value,
    execution,
    runId,
    runAttempt,
    requireWrapper,
  });
  if (terminalProof.deploymentStateProof === null) {
    throw new Error("Complete terminal deployment state proof is required");
  }
  const transactionId = createMainTransactionId({
    repository: MAIN_TRANSACTION_REPOSITORY,
    deploySha: execution.manifest.deploySha,
    runId,
    runAttempt,
  });
  summarizeActiveDeploymentStateProof(terminalProof.deploymentStateProof, {
    deploySha: execution.manifest.deploySha,
    runId,
    runAttempt,
    transactionId,
    mainOwnershipMode: planning.mainOwnershipMode,
    stagedTargets: planning.stagedTargets,
    activeTargets: planning.activeTargets,
    shadowTargets: planning.shadowTargets,
    projectIds: execution.projection.projectIds,
    expectedDeploymentIds:
      expectedCandidateIds ?? terminalExpectedCandidateIds(highest, planning),
    originalPriors: execution.manifest.originalPriors,
    legacyState: execution.legacyAppV2,
    requireProven: true,
  });
  return terminalProof.artifact;
}

function assertTerminalMappingsArePriors(mappings, execution) {
  const priorByAlias = new Map();
  for (const target of MAIN_DEPLOYMENT_TARGETS) {
    const prior = execution.manifest.originalPriors[target];
    for (const alias of prior.aliases) priorByAlias.set(alias, prior);
  }
  for (const alias of execution.legacyAppV2.aliases) {
    priorByAlias.set(alias, execution.legacyAppV2);
  }
  for (const mapping of mappings) {
    const prior = priorByAlias.get(mapping.alias);
    if (
      prior === undefined ||
      mapping.deploymentId !== prior.deploymentId ||
      mapping.deploymentUrl !== prior.deploymentUrl
    ) {
      throw new Error("Terminal recovered mapping does not restore its prior");
    }
  }
}

function canonicalTerminalPriorSmokes(value, execution) {
  const smokes = canonicalFailurePublicSmokes(value);
  if (smokes === null) {
    throw new Error("Complete terminal public smoke proof is required");
  }
  for (const target of MAIN_DEPLOYMENT_TARGETS) {
    if (
      smokes[target].status !== "passed" ||
      smokes[target].servedSha !==
        execution.manifest.originalPriors[target].servedSha
    ) {
      throw new Error(
        `Terminal ${target} public smoke does not prove the restored prior`,
      );
    }
  }
  return smokes;
}

function terminalRollbackTargets(highest) {
  const operations = highest.operations.filter(
    (operation) =>
      operation.type === "ordinary_rollback" &&
      operation.state === "verified" &&
      operation.mappingState === "prior" &&
      operation.rollbackState === "entered",
  );
  const targets = new Set(operations.map((operation) => operation.target));
  return MAIN_ORDINARY_TARGETS.filter((target) => targets.has(target));
}

const TERMINAL_AFFECTED_OPERATION_KEYS = Object.freeze([
  "operationId",
  "target",
  "type",
  "alias",
  "state",
  "commandOutcome",
  "mappingState",
  "rollbackState",
]);

function terminalAffectedOperations(highest) {
  const latest = new Map();
  for (const operation of highest.operations) {
    latest.set(operation.operationId, operation);
  }
  return [...latest.values()].map((operation) => ({
    operationId: operation.operationId,
    target: operation.target,
    type: operation.type,
    alias: operation.alias,
    state: operation.state,
    commandOutcome: operation.commandOutcome,
    mappingState: operation.mappingState,
    rollbackState: operation.rollbackState,
  }));
}

export function createMainTerminalAffectedOperations(journal) {
  return terminalAffectedOperations(assertMainTransactionJournal(journal));
}

function canonicalTerminalAffectedOperations(value) {
  if (!Array.isArray(value)) {
    throw new Error("Main terminal affected operations are malformed");
  }
  const canonical = value.map((operation, index) => {
    assertExactKeys(
      operation,
      TERMINAL_AFFECTED_OPERATION_KEYS,
      `Main terminal affected operation ${index}`,
    );
    requireString(
      operation.operationId,
      `Main terminal affected operation ${index} ID`,
      /^op-[0-9]{4}$/,
    );
    if (
      ![
        "promote",
        "app_v3_deploy",
        "app_alias_set",
        "ordinary_rollback",
        "app_alias_restore",
        "legacy_emergency_restore",
      ].includes(operation.type) ||
      !["app", "governance", "reserve", "ui", "legacy-app"].includes(
        operation.target,
      ) ||
      !["started", "command_returned", "verified"].includes(operation.state) ||
      ![null, "success", "unknown"].includes(operation.commandOutcome) ||
      ![
        null,
        "prior",
        "candidate",
        "partial",
        "unexpected",
        "unknown",
      ].includes(operation.mappingState) ||
      ![null, "entered"].includes(operation.rollbackState)
    ) {
      throw new Error("Main terminal affected operation is malformed");
    }
    if (
      operation.alias !== null &&
      canonicalizeHostname(operation.alias) !== operation.alias
    ) {
      throw new Error("Main terminal affected operation alias is malformed");
    }
    return { ...operation };
  });
  const ordered = canonical.toSorted((left, right) =>
    left.operationId.localeCompare(right.operationId),
  );
  if (
    new Set(canonical.map(({ operationId }) => operationId)).size !==
      canonical.length ||
    !sameJson(canonical, ordered)
  ) {
    throw new Error("Main terminal affected operations are not canonical");
  }
  return canonical;
}

function canonicalTerminalStageResults(
  value,
  { execution, runId, runAttempt },
) {
  assertExactKeys(
    value,
    [
      "schema",
      "deploySha",
      "runId",
      "runAttempt",
      "results",
      "coordinatorResult",
    ],
    "Terminal stage results",
  );
  if (
    value.schema !== "vercel-main-stage-results:v2" ||
    value.deploySha !== execution.manifest.deploySha ||
    requirePositiveId(value.runId, "Terminal stage results run ID") !== runId ||
    requirePositiveId(
      value.runAttempt,
      "Terminal stage results run attempt",
    ) !== runAttempt
  ) {
    throw new Error("Terminal stage results identity conflicts");
  }
  assertExactKeys(
    value.results,
    MAIN_DEPLOYMENT_TARGETS,
    "Terminal target preparation results",
  );
  const selected = new Set(execution.projection.stagedTargets);
  const results = Object.fromEntries(
    MAIN_DEPLOYMENT_TARGETS.map((target) => {
      const result = requireString(
        value.results[target],
        `Terminal ${target} preparation result`,
        /^(?:success|failure|cancelled|skipped)$/,
      );
      if (!selected.has(target) && result !== "skipped") {
        throw new Error("Unselected terminal preparation must be skipped");
      }
      return [target, result];
    }),
  );
  const selectedFailure = MAIN_DEPLOYMENT_TARGETS.some(
    (target) =>
      selected.has(target) &&
      ["failure", "cancelled"].includes(results[target]),
  );
  const coordinatorResult = requireString(
    value.coordinatorResult,
    "Terminal coordinator result",
    /^(?:success|failure|cancelled|skipped)$/,
  );
  if (
    selected.size === 0 ||
    (coordinatorResult === "success" && !selectedFailure)
  ) {
    throw new Error(
      "Terminal stage results do not prove a pre-journal failure",
    );
  }
  const canonical = {
    schema: "vercel-main-stage-results:v2",
    deploySha: execution.manifest.deploySha,
    runId,
    runAttempt,
    results,
    coordinatorResult,
  };
  assertSameJson(value, canonical, "Terminal stage results");
  return canonical;
}

export function createMainTerminalStageResults({
  execution,
  results,
  coordinatorResult,
  runId,
  runAttempt,
}) {
  const releaseExecution = assertMainReleaseExecution(execution);
  return canonicalTerminalStageResults(
    {
      schema: "vercel-main-stage-results:v2",
      deploySha: releaseExecution.manifest.deploySha,
      runId: requirePositiveId(runId, "Terminal stage results run ID"),
      runAttempt: requirePositiveId(
        runAttempt,
        "Terminal stage results run attempt",
      ),
      results,
      coordinatorResult,
    },
    { execution: releaseExecution, runId, runAttempt },
  );
}

function terminalJobs(execution, outcome) {
  const recoveryOutcome = [
    "recovered",
    "verified-noop",
    "manual-intervention",
  ].includes(outcome);
  return {
    waitForCi: "success",
    plan: "success",
    stageGovernance: execution.projection.stagedTargets.includes("governance")
      ? "success"
      : "skipped",
    stageReserve: execution.projection.stagedTargets.includes("reserve")
      ? "success"
      : "skipped",
    stageUi: execution.projection.stagedTargets.includes("ui")
      ? "success"
      : "skipped",
    coordinator: recoveryOutcome ? "failure" : "success",
    recovery: outcome === "manual-intervention" ? "failure" : "success",
  };
}

function terminalWorkflowRunUrl(runId) {
  return createMainWorkflowRunUrl({
    serverUrl: "https://github.com",
    repository: MAIN_TRANSACTION_REPOSITORY,
    runId,
  });
}

function terminalProof({ status, artifact }) {
  return { status, artifact };
}

export function createMainActiveTerminalArtifacts({
  execution,
  outcome,
  journalHistory,
  finalMappings,
  publicSmokes,
  stateProof,
  finalCensus,
  freshLegacyV2,
  freshness,
  stageResults = null,
  runId,
  runAttempt,
}) {
  const releaseExecution = assertMainReleaseExecution(execution);
  const planning = activePlanningFromExecution(releaseExecution);
  const canonicalRunId = requirePositiveId(runId, "Terminal producer run ID");
  const canonicalRunAttempt = requirePositiveId(
    runAttempt,
    "Terminal producer run attempt",
  );
  if (
    ![
      "active-committed",
      "current-release-verified",
      "recovered",
      "verified-noop",
      "no-target",
      "superseded-before-journal",
      "shadow-prepared",
      "manual-intervention",
      "preparation-failed-before-journal",
    ].includes(outcome)
  ) {
    throw new Error("Terminal producer outcome is unsupported");
  }
  const history = canonicalTerminalJournalHistory(journalHistory, {
    execution: releaseExecution,
    runId: canonicalRunId,
    runAttempt: canonicalRunAttempt,
  });
  const legacyState = canonicalTerminalFreshLegacyV2(
    freshLegacyV2,
    releaseExecution,
  );
  const manifest = releaseExecution.manifest;
  const proofIdentity = {
    schema: MAIN_ACTIVE_TERMINAL_PROOFS_SCHEMA,
    releaseId: manifest.releaseId,
    releaseManifestDigest: digestCanonicalJson(manifest),
    releaseExecutionDigest: digestMainReleaseExecution(releaseExecution),
  };
  const safeJobs = terminalJobs(releaseExecution, outcome);
  let evidence;
  let proofs;

  if (outcome === "preparation-failed-before-journal") {
    if (
      history.length !== 0 ||
      finalMappings !== null ||
      publicSmokes !== null ||
      stateProof !== null ||
      finalCensus !== null ||
      freshness !== null
    ) {
      throw new Error(
        "Terminal preparation failure cannot contain journal or provider proof",
      );
    }
    const failure = canonicalTerminalStageResults(stageResults, {
      execution: releaseExecution,
      runId: canonicalRunId,
      runAttempt: canonicalRunAttempt,
    });
    evidence = {
      schema: MAIN_ACTIVE_PREPARATION_FAILURE_EVIDENCE_SCHEMA,
      mode: MAIN_ACTIVE_DEPLOYMENT_MODE,
      repository: MAIN_TRANSACTION_REPOSITORY,
      deploySha: manifest.deploySha,
      workflowDefinitionSha: manifest.deploySha,
      runId: canonicalRunId,
      runAttempt: canonicalRunAttempt,
      workflowRunUrl: terminalWorkflowRunUrl(canonicalRunId),
      planning,
      stageResults: failure,
      publicServingMutationCommands: 0,
      outcome: "failed",
      reason: "preparation-failed-before-journal",
    };
    proofs = {
      ...proofIdentity,
      producerJob: "recover-main-deployment",
      outcome,
      finalMapping: terminalProof({
        status: "unsafe",
        artifact: failure,
      }),
      finalCensus: terminalProof({
        status: "unsafe",
        artifact: failure,
      }),
      stateProof: terminalProof({
        status: "unsafe",
        artifact: failure,
      }),
      publicSmoke: terminalProof({
        status: "not-required",
        artifact: null,
      }),
      freshLegacyV2: terminalProof({
        status: "passed",
        artifact: legacyState,
      }),
      mutationCount: 0,
      rollbackTargets: [],
      affectedOperations: [],
      journal: terminalProof({
        status: "not-applicable",
        artifact: null,
      }),
    };
  } else if (outcome === "current-release-verified") {
    if (stageResults !== null || history.length !== 0) {
      throw new Error("Current release verification cannot contain a journal");
    }
    if (
      releaseExecution.decision !== "verify-existing-release" ||
      releaseExecution.reason !== "current-main-release-already-complete" ||
      planning.activeTargets.length === 0 ||
      finalMappings === null ||
      publicSmokes === null ||
      stateProof === null ||
      finalCensus === null ||
      !sameJson(finalCensus, stateProof)
    ) {
      throw new Error("Current release verification inputs are incomplete");
    }
    assertExactKeys(
      freshness,
      ["schema", "status", "deploySha", "observedSha"],
      "Current release freshness observation",
    );
    const verifiedFreshness = createMainActiveFreshness({
      deploySha: freshness.deploySha,
      observedSha: freshness.observedSha,
    });
    if (
      !sameJson(freshness, verifiedFreshness) ||
      verifiedFreshness.deploySha !== manifest.deploySha ||
      verifiedFreshness.status !== "fresh"
    ) {
      throw new Error("Current release verification lacks fresh main proof");
    }
    const terminalState = terminalDeploymentStateProof({
      value: stateProof,
      execution: releaseExecution,
      runId: canonicalRunId,
      runAttempt: canonicalRunAttempt,
      requireWrapper: true,
    });
    if (terminalState.deploymentStateProof === null) {
      throw new Error("Current release verification state proof is absent");
    }
    const transactionId = createMainTransactionId({
      repository: MAIN_TRANSACTION_REPOSITORY,
      deploySha: manifest.deploySha,
      runId: canonicalRunId,
      runAttempt: canonicalRunAttempt,
    });
    const expectedDeploymentIds = Object.fromEntries(
      MAIN_DEPLOYMENT_TARGETS.map((target) => [
        target,
        planning.activeTargets.includes(target)
          ? terminalState.deploymentStateProof.projects[target]
              .expectedDeploymentId
          : planning.shadowTargets.includes(target)
            ? undefined
            : null,
      ]),
    );
    const stateProofSummary = summarizeActiveDeploymentStateProof(
      terminalState.deploymentStateProof,
      {
        deploySha: manifest.deploySha,
        runId: canonicalRunId,
        runAttempt: canonicalRunAttempt,
        transactionId,
        mainOwnershipMode: planning.mainOwnershipMode,
        stagedTargets: planning.stagedTargets,
        activeTargets: planning.activeTargets,
        shadowTargets: planning.shadowTargets,
        projectIds: releaseExecution.projection.projectIds,
        expectedDeploymentIds,
        originalPriors: manifest.originalPriors,
        legacyState: releaseExecution.legacyAppV2,
        requireProven: true,
      },
    );
    const mappings = canonicalCurrentReleaseVerifiedMappings({
      execution: releaseExecution,
      stateProof: terminalState.deploymentStateProof,
      value: canonicalTerminalProviderMappings(finalMappings),
      runId: canonicalRunId,
      runAttempt: canonicalRunAttempt,
    });
    const smokes = canonicalPublicSmokes(
      publicSmokes,
      planning,
      manifest.deploySha,
    );
    evidence = {
      schema: MAIN_ACTIVE_CURRENT_RELEASE_EVIDENCE_SCHEMA,
      mode: MAIN_ACTIVE_DEPLOYMENT_MODE,
      repository: MAIN_TRANSACTION_REPOSITORY,
      deploySha: manifest.deploySha,
      workflowDefinitionSha: manifest.deploySha,
      runId: canonicalRunId,
      runAttempt: canonicalRunAttempt,
      workflowRunUrl: terminalWorkflowRunUrl(canonicalRunId),
      planning,
      freshness: [{ phase: "current-release-verification", status: "fresh" }],
      finalMappings: mappings,
      publicSmokes: smokes,
      stateProofSummary,
      publicServingMutationCommands: 0,
      outcome: "current-release-verified",
    };
    proofs = {
      ...proofIdentity,
      producerJob: "activate-and-verify",
      outcome,
      finalMapping: terminalProof({ status: "passed", artifact: mappings }),
      finalCensus: terminalProof({
        status: "passed",
        artifact: terminalState.artifact,
      }),
      stateProof: terminalProof({
        status: "passed",
        artifact: terminalState.artifact,
      }),
      publicSmoke: terminalProof({ status: "passed", artifact: smokes }),
      freshLegacyV2: terminalProof({ status: "passed", artifact: legacyState }),
      mutationCount: 0,
      rollbackTargets: [],
      affectedOperations: [],
      journal: terminalProof({ status: "not-applicable", artifact: null }),
    };
  } else if (
    ["no-target", "superseded-before-journal", "shadow-prepared"].includes(
      outcome,
    )
  ) {
    if (stageResults !== null) {
      throw new Error(
        "Terminal preparation failure proof is unexpected for the outcome",
      );
    }
    if (history.length !== 0) {
      throw new Error("Safe terminal outcome cannot contain a journal");
    }
    const shadow = outcome === "shadow-prepared";
    let supersededFreshness = null;
    if (outcome === "superseded-before-journal") {
      assertExactKeys(
        freshness,
        ["schema", "status", "deploySha", "observedSha"],
        "Terminal superseded freshness observation",
      );
      supersededFreshness = createMainActiveFreshness({
        deploySha: freshness.deploySha,
        observedSha: freshness.observedSha,
      });
      if (
        !sameJson(freshness, supersededFreshness) ||
        supersededFreshness.deploySha !== manifest.deploySha ||
        supersededFreshness.status !== "superseded"
      ) {
        throw new Error(
          "Terminal superseded outcome lacks exact freshness proof",
        );
      }
    } else if (freshness !== null) {
      throw new Error("Terminal freshness proof is unexpected for the outcome");
    }
    if (
      shadow
        ? finalMappings === null ||
          publicSmokes === null ||
          stateProof === null ||
          finalCensus === null
        : finalMappings !== null ||
          publicSmokes !== null ||
          stateProof !== null ||
          finalCensus !== null
    ) {
      throw new Error("Safe terminal proof inputs do not match the outcome");
    }
    if (
      (outcome === "no-target" && !releaseExecution.projection.noTarget) ||
      (shadow &&
        (planning.stagedTargets.length === 0 ||
          planning.activeTargets.length !== 0))
    ) {
      throw new Error("Safe terminal outcome conflicts with the execution");
    }
    evidence = {
      schema: MAIN_ACTIVE_SAFE_NOOP_EVIDENCE_SCHEMA,
      mode: MAIN_ACTIVE_DEPLOYMENT_MODE,
      repository: MAIN_TRANSACTION_REPOSITORY,
      deploySha: manifest.deploySha,
      workflowDefinitionSha: manifest.deploySha,
      runId: canonicalRunId,
      runAttempt: canonicalRunAttempt,
      workflowRunUrl: terminalWorkflowRunUrl(canonicalRunId),
      planning,
      jobs: safeJobs,
      coordinatorOutcome: outcome,
      recoveryOutcome: "not-required",
      publicServingMutationCommands: 0,
      outcome: "success",
      reason: outcome,
    };
    const supersededArtifact = supersededFreshness;
    let canonicalMappings = null;
    let canonicalSmokes = null;
    let shadowState = null;
    if (shadow) {
      canonicalMappings = canonicalNestedFinalMappings(
        canonicalTerminalProviderMappings(finalMappings),
        releaseExecution,
      );
      assertTerminalMappingsArePriors(canonicalMappings, releaseExecution);
      canonicalSmokes = canonicalPublicSmokes(
        publicSmokes,
        planning,
        manifest.deploySha,
      );
      shadowState = terminalDeploymentStateProof({
        value: stateProof,
        execution: releaseExecution,
        runId: canonicalRunId,
        runAttempt: canonicalRunAttempt,
        requireWrapper: true,
      });
      if (
        shadowState.deploymentStateProof !== null ||
        !sameJson(finalCensus, shadowState.artifact)
      ) {
        throw new Error(
          "Shadow terminal state proof conflicts with preparation",
        );
      }
    }
    const statuses =
      outcome === "no-target"
        ? {
            finalMapping: terminalProof({
              status: "not-required",
              artifact: null,
            }),
            finalCensus: terminalProof({
              status: "not-required",
              artifact: null,
            }),
            stateProof: terminalProof({
              status: "not-required",
              artifact: null,
            }),
            publicSmoke: terminalProof({
              status: "not-required",
              artifact: null,
            }),
          }
        : outcome === "superseded-before-journal"
          ? {
              finalMapping: terminalProof({
                status: "superseded",
                artifact: supersededArtifact,
              }),
              finalCensus: terminalProof({
                status: "superseded",
                artifact: supersededArtifact,
              }),
              stateProof: terminalProof({
                status: "superseded",
                artifact: supersededArtifact,
              }),
              publicSmoke: terminalProof({
                status: "not-required",
                artifact: null,
              }),
            }
          : {
              finalMapping: terminalProof({
                status: "passed",
                artifact: canonicalMappings,
              }),
              finalCensus: terminalProof({
                status: "passed",
                artifact: shadowState.artifact,
              }),
              stateProof: terminalProof({
                status: "prepared",
                artifact: shadowState.artifact,
              }),
              publicSmoke: terminalProof({
                status: "passed",
                artifact: canonicalSmokes,
              }),
            };
    proofs = {
      ...proofIdentity,
      producerJob: "activate-and-verify",
      outcome,
      ...statuses,
      freshLegacyV2: terminalProof({
        status: "passed",
        artifact: legacyState,
      }),
      mutationCount: 0,
      rollbackTargets: [],
      affectedOperations: [],
      journal: terminalProof({
        status: "not-applicable",
        artifact: null,
      }),
    };
  } else {
    if (stageResults !== null) {
      throw new Error(
        "Terminal preparation failure proof is unexpected for the outcome",
      );
    }
    if (freshness !== null) {
      throw new Error("Terminal freshness proof is unexpected for the outcome");
    }
    if (history.length === 0) {
      throw new Error("Terminal mutation outcome requires a journal");
    }
    const highest = history.at(-1);
    assertJournalMatchesActivePlanning(highest, planning);
    const counts = operationMutationCounts(highest);
    const complete = outcome !== "manual-intervention";
    if (
      (outcome === "active-committed" && highest.status !== "committed") ||
      (outcome === "recovered" && highest.status !== "recovered") ||
      (outcome === "verified-noop" &&
        (highest.status !== "prepared" || counts.started !== 0)) ||
      (outcome === "manual-intervention" &&
        highest.status !== "manual_intervention")
    ) {
      throw new Error("Terminal journal head conflicts with the outcome");
    }
    if (
      finalMappings === null ||
      stateProof === null ||
      finalCensus === null ||
      !sameJson(finalCensus, stateProof) ||
      (complete && publicSmokes === null)
    ) {
      throw new Error("Terminal outcome lacks complete provider proof");
    }
    const flattenedMappings = canonicalTerminalProviderMappings(finalMappings);
    const mappings =
      outcome === "active-committed"
        ? canonicalFinalMappings(highest, flattenedMappings)
        : canonicalFinalMappings(highest, flattenedMappings, { exact: false });
    if (["recovered", "verified-noop"].includes(outcome)) {
      assertTerminalMappingsArePriors(mappings, releaseExecution);
    }
    const completeStateProof =
      outcome === "manual-intervention"
        ? (() => {
            summarizeActiveDeploymentStateProof(stateProof, {
              deploySha: manifest.deploySha,
              runId: canonicalRunId,
              runAttempt: canonicalRunAttempt,
              transactionId: highest.transactionId,
              mainOwnershipMode: planning.mainOwnershipMode,
              originalPriors: manifest.originalPriors,
            });
            return stateProof;
          })()
        : canonicalCompleteTerminalStateProof({
            value: stateProof,
            execution: releaseExecution,
            planning,
            highest,
            runId: canonicalRunId,
            runAttempt: canonicalRunAttempt,
            requireWrapper: outcome === "active-committed",
          });
    const smokes =
      outcome === "active-committed"
        ? canonicalPublicSmokes(publicSmokes, planning, manifest.deploySha)
        : outcome === "manual-intervention"
          ? canonicalFailurePublicSmokes(publicSmokes)
          : canonicalTerminalPriorSmokes(publicSmokes, releaseExecution);
    const rollbackTargets =
      outcome === "recovered"
        ? terminalRollbackTargets(highest)
        : outcome === "manual-intervention"
          ? terminalRollbackTargets(highest)
          : [];
    const affectedOperations =
      outcome === "manual-intervention"
        ? terminalAffectedOperations(highest)
        : [];
    if (
      (outcome === "recovered" && rollbackTargets.length === 0) ||
      (outcome === "manual-intervention" &&
        (affectedOperations.length === 0 ||
          affectedOperations.length !== counts.started))
    ) {
      throw new Error("Terminal recovery lacks rollback proof");
    }
    if (outcome === "active-committed") {
      evidence = {
        schema: MAIN_ACTIVE_EVIDENCE_SCHEMA,
        mode: MAIN_ACTIVE_DEPLOYMENT_MODE,
        repository: MAIN_TRANSACTION_REPOSITORY,
        deploySha: manifest.deploySha,
        workflowDefinitionSha: manifest.deploySha,
        runId: canonicalRunId,
        runAttempt: canonicalRunAttempt,
        workflowRunUrl: terminalWorkflowRunUrl(canonicalRunId),
        planning,
        journal: {
          transactionId: highest.transactionId,
          artifactName: mainTransactionJournalArtifactName(highest),
          highestSequence: highest.sequence,
          highestStatus: highest.status,
        },
        orderedVerifiedOperations: canonicalOrderedVerifiedOperations(highest),
        freshness: [
          { phase: "transaction-start", status: "fresh" },
          { phase: "transaction-commit", status: "fresh" },
        ],
        finalMappings: mappings,
        publicSmokes: smokes,
        stateProofSummary: summarizeActiveDeploymentStateProof(
          terminalDeploymentStateProof({
            value: completeStateProof,
            execution: releaseExecution,
            runId: canonicalRunId,
            runAttempt: canonicalRunAttempt,
            requireWrapper: true,
          }).deploymentStateProof,
          {
            deploySha: manifest.deploySha,
            runId: canonicalRunId,
            runAttempt: canonicalRunAttempt,
            transactionId: highest.transactionId,
            mainOwnershipMode: planning.mainOwnershipMode,
            stagedTargets: planning.stagedTargets,
            activeTargets: planning.activeTargets,
            shadowTargets: planning.shadowTargets,
            projectIds: releaseExecution.projection.projectIds,
            expectedDeploymentIds: terminalExpectedCandidateIds(
              highest,
              planning,
            ),
            originalPriors: manifest.originalPriors,
            legacyState: releaseExecution.legacyAppV2,
            requireProven: true,
          },
        ),
        recovery: {
          outcome: "not-required",
          rollbackStateTargets: [],
        },
        publicServingMutationCommands: counts.started,
        outcome: "active-committed",
      };
    } else {
      evidence = createMainActiveDeploymentFailureEvidence({
        eventHeadSha: manifest.deploySha,
        verifiedDeploySha: manifest.deploySha,
        planOutput: "execution-bound",
        jobs: safeJobs,
        workflowDefinitionSha: manifest.deploySha,
        runId: canonicalRunId,
        runAttempt: canonicalRunAttempt,
        workflowRunUrl: terminalWorkflowRunUrl(canonicalRunId),
        mainOwnershipMode: planning.mainOwnershipMode,
        journalHistory: history,
        finalMappings: mappings,
        publicSmokes: smokes,
        stateProof: completeStateProof,
        rollbackStateTargets: rollbackTargets,
        publicServingMutationCommands: counts.started,
        coordinatorOutcome: "active-failed",
        recoveryOutcome:
          outcome === "verified-noop" ? "verified-no-mutation" : outcome,
        errorCode:
          outcome === "recovered"
            ? "RECOVERED_TO_PRIORS"
            : outcome === "verified-noop"
              ? "VERIFIED_NO_MUTATION"
              : "MANUAL_INTERVENTION_REQUIRED",
      });
    }
    const manual = outcome === "manual-intervention";
    proofs = {
      ...proofIdentity,
      producerJob:
        outcome === "active-committed"
          ? "activate-and-verify"
          : "recover-main-deployment",
      outcome,
      finalMapping: terminalProof({
        status: manual ? "unsafe" : "passed",
        artifact: mappings,
      }),
      finalCensus: terminalProof({
        status: manual ? "unsafe" : "passed",
        artifact: completeStateProof,
      }),
      stateProof: terminalProof({
        status: manual ? "unsafe" : "passed",
        artifact: completeStateProof,
      }),
      publicSmoke: terminalProof({
        status: manual ? "not-required" : "passed",
        artifact: manual ? null : smokes,
      }),
      freshLegacyV2: terminalProof({
        status: "passed",
        artifact: legacyState,
      }),
      mutationCount: counts.started,
      rollbackTargets,
      affectedOperations,
      journal: terminalProof({
        status:
          outcome === "verified-noop"
            ? "not-applicable"
            : outcome === "active-committed"
              ? "committed"
              : outcome,
        artifact: outcome === "verified-noop" ? null : history,
      }),
    };
  }

  assertMainActiveTerminalProofs(proofs);
  assertMainActiveTerminalEvidenceArtifact(evidence, {
    execution: releaseExecution,
    runId: canonicalRunId,
    runAttempt: canonicalRunAttempt,
    outcome,
  });
  return { evidence, proofs };
}

function activePlanningFromExecution(execution) {
  const manifest = execution.manifest;
  if (manifest.mode !== MAIN_ACTIVE_DEPLOYMENT_MODE) {
    throw new Error("Nested terminal evidence requires an active execution");
  }
  const selected = (targets) =>
    MAIN_DEPLOYMENT_TARGETS.filter((target) => targets.includes(target));
  return {
    controllerMode: MAIN_ACTIVE_DEPLOYMENT_MODE,
    mainOwnershipMode: canonicalMainOwnershipMode(manifest.mainOwnershipMode),
    stagedTargets: selected(execution.projection.stagedTargets),
    activeTargets: selected(execution.projection.activeTargets),
    shadowTargets: selected(execution.projection.shadowTargets),
  };
}

function canonicalActiveEvidenceIdentity(
  value,
  execution,
  { runId, runAttempt },
) {
  const expectedRunId = requirePositiveId(runId, "Active evidence run ID");
  const expectedRunAttempt = requirePositiveId(
    runAttempt,
    "Active evidence run attempt",
  );
  const expectedWorkflowRunUrl = createMainWorkflowRunUrl({
    serverUrl: "https://github.com",
    repository: MAIN_TRANSACTION_REPOSITORY,
    runId: expectedRunId,
  });
  if (
    value.mode !== MAIN_ACTIVE_DEPLOYMENT_MODE ||
    value.repository !== MAIN_TRANSACTION_REPOSITORY ||
    value.workflowDefinitionSha !== execution.manifest.deploySha ||
    value.runId !== expectedRunId ||
    value.runAttempt !== expectedRunAttempt ||
    value.workflowRunUrl !== expectedWorkflowRunUrl
  ) {
    throw new Error("Nested active evidence identity is inconsistent");
  }
  return {
    runId: expectedRunId,
    runAttempt: expectedRunAttempt,
    workflowRunUrl: expectedWorkflowRunUrl,
  };
}

function canonicalActiveVerifiedOperations(value) {
  if (!Array.isArray(value)) {
    throw new Error("Nested active verified operations are malformed");
  }
  const seen = new Set();
  return value.map((operation, index) => {
    assertExactKeys(
      operation,
      [
        "operationId",
        "type",
        "target",
        "alias",
        "candidateDeploymentId",
        "candidateDeploymentUrl",
        "mappingState",
        "rollbackState",
      ],
      `Nested active verified operation ${index + 1}`,
    );
    const operationId = requireString(
      operation.operationId,
      `Nested active verified operation ${index + 1} ID`,
      /^op-[0-9]{4}$/,
    );
    if (seen.has(operationId)) {
      throw new Error("Nested active verified operations are duplicated");
    }
    seen.add(operationId);
    if (
      ![
        "promote",
        "app_v3_deploy",
        "app_alias_set",
        "ordinary_rollback",
        "app_alias_restore",
        "legacy_emergency_restore",
      ].includes(operation.type) ||
      ![...MAIN_DEPLOYMENT_TARGETS, "legacy-app"].includes(operation.target)
    ) {
      throw new Error("Nested active verified operation is unsupported");
    }
    const alias =
      operation.alias === null ? null : canonicalizeHostname(operation.alias);
    const candidateDeploymentId =
      operation.candidateDeploymentId === null
        ? null
        : requireString(
            operation.candidateDeploymentId,
            "Nested active candidate deployment ID",
            DEPLOYMENT_ID_PATTERN,
          );
    const candidateDeploymentUrl =
      operation.candidateDeploymentUrl === null
        ? null
        : canonicalizeDeploymentUrl(operation.candidateDeploymentUrl);
    const mappingState =
      operation.mappingState === null
        ? null
        : requireString(
            operation.mappingState,
            "Nested active operation mapping state",
            /^[a-z][a-z0-9_-]*$/,
          );
    const rollbackState =
      operation.rollbackState === null
        ? null
        : requireString(
            operation.rollbackState,
            "Nested active operation rollback state",
            /^[a-z][a-z0-9_-]*$/,
          );
    return {
      operationId,
      type: operation.type,
      target: operation.target,
      alias,
      candidateDeploymentId,
      candidateDeploymentUrl,
      mappingState,
      rollbackState,
    };
  });
}

function canonicalNestedFinalMappings(value, execution) {
  if (!Array.isArray(value)) {
    throw new Error("Nested active final mappings are malformed");
  }
  const priors = new Map(
    MAIN_DEPLOYMENT_TARGETS.map((target) => [
      target,
      execution.manifest.originalPriors[target],
    ]),
  );
  const planning = activePlanningFromExecution(execution);
  const expectedByAlias = new Map();
  for (const target of MAIN_DEPLOYMENT_TARGETS) {
    const prior = priors.get(target);
    for (const alias of prior.aliases) expectedByAlias.set(alias, target);
  }
  for (const alias of execution.legacyAppV2.aliases) {
    expectedByAlias.set(alias, "legacy-app");
  }
  const seen = new Set();
  const deploymentByTarget = new Map();
  const canonical = value.map((entry, index) => {
    assertExactKeys(
      entry,
      ["alias", "deploymentId", "deploymentUrl"],
      `Nested active final mapping ${index + 1}`,
    );
    const mapping = {
      alias: canonicalizeHostname(entry.alias),
      deploymentId: requireString(
        entry.deploymentId,
        "Nested active final mapping deployment ID",
        DEPLOYMENT_ID_PATTERN,
      ),
      deploymentUrl: canonicalizeDeploymentUrl(entry.deploymentUrl),
    };
    if (!expectedByAlias.has(mapping.alias) || seen.has(mapping.alias)) {
      throw new Error("Nested active final mappings contain an unknown alias");
    }
    seen.add(mapping.alias);
    const target = expectedByAlias.get(mapping.alias);
    const priorMapping = deploymentByTarget.get(target);
    if (
      priorMapping !== undefined &&
      (priorMapping.deploymentId !== mapping.deploymentId ||
        priorMapping.deploymentUrl !== mapping.deploymentUrl)
    ) {
      throw new Error("Nested active target aliases disagree");
    }
    deploymentByTarget.set(target, mapping);
    const mustRemainPrior =
      target === "legacy-app" || !planning.activeTargets.includes(target);
    const prior =
      target === "legacy-app" ? execution.legacyAppV2 : priors.get(target);
    if (
      mustRemainPrior &&
      (mapping.deploymentId !== prior.deploymentId ||
        mapping.deploymentUrl !== prior.deploymentUrl)
    ) {
      throw new Error(
        "Nested active final mapping conflicts with the execution",
      );
    }
    return mapping;
  });
  if (seen.size !== expectedByAlias.size) {
    throw new Error("Nested active final mappings are incomplete");
  }
  const sorted = canonical.toSorted((left, right) =>
    left.alias.localeCompare(right.alias),
  );
  return assertSameJson(value, sorted, "Nested active final mappings");
}

function canonicalNestedStateProofSummary(
  value,
  execution,
  { transactionId, requireProven = false, allowMissing = false } = {},
) {
  if (value === null) {
    if (allowMissing) return null;
    throw new Error("Nested active state proof summary is required");
  }
  assertExactKeys(
    value,
    ["proofSchema", "outcome", "transactionId", "targets", "legacyAppV2"],
    "Nested active state proof summary",
  );
  if (
    value.proofSchema !== "vercel-active-deployment-state-proof:v4" ||
    !["proven", "unproven"].includes(value.outcome) ||
    (requireProven && value.outcome !== "proven") ||
    value.transactionId !== transactionId
  ) {
    throw new Error("Nested active state proof summary identity is invalid");
  }
  assertExactKeys(
    value.targets,
    MAIN_DEPLOYMENT_TARGETS,
    "Nested active state proof targets",
  );
  const targets = Object.fromEntries(
    MAIN_DEPLOYMENT_TARGETS.map((target) => {
      const entry = value.targets[target];
      assertExactKeys(
        entry,
        ["expectedDisposition", "expectedDeploymentId", "counts"],
        `Nested active ${target} state proof`,
      );
      if (
        entry.expectedDisposition !== null &&
        (typeof entry.expectedDisposition !== "string" ||
          !/^[A-Za-z][A-Za-z0-9_-]*$/.test(entry.expectedDisposition))
      ) {
        throw new Error(`Nested active ${target} disposition is malformed`);
      }
      const expectedDeploymentId =
        entry.expectedDeploymentId === null
          ? null
          : requireString(
              entry.expectedDeploymentId,
              `Nested active ${target} expected deployment ID`,
              DEPLOYMENT_ID_PATTERN,
            );
      const countKeys = [
        "scanned",
        "githubPrebuilt",
        "githubShadowStage",
        "nativeGitOwner",
        "nativeGitDuplicates",
        "manualDuplicates",
        "unknown",
      ];
      assertExactKeys(
        entry.counts,
        countKeys,
        `Nested active ${target} proof counts`,
      );
      const counts = Object.fromEntries(
        countKeys.map((name) => [
          name,
          canonicalMutationCount(
            entry.counts[name],
            `Nested active ${target} ${name} count`,
          ),
        ]),
      );
      return [
        target,
        {
          expectedDisposition: entry.expectedDisposition,
          expectedDeploymentId,
          counts,
        },
      ];
    }),
  );
  assertExactKeys(
    value.legacyAppV2,
    ["deploymentId", "ownership"],
    "Nested active legacy v2 state proof",
  );
  const legacyAppV2 = {
    deploymentId: requireString(
      value.legacyAppV2.deploymentId,
      "Nested active legacy v2 deployment ID",
      DEPLOYMENT_ID_PATTERN,
    ),
    ownership: requireString(
      value.legacyAppV2.ownership,
      "Nested active legacy v2 ownership",
      /^[a-z][a-z0-9-]*$/,
    ),
  };
  if (
    legacyAppV2.deploymentId !== execution.legacyAppV2.deploymentId ||
    legacyAppV2.ownership !== "native-vercel-git"
  ) {
    throw new Error("Nested active legacy v2 state proof conflicts");
  }
  return {
    proofSchema: value.proofSchema,
    outcome: value.outcome,
    transactionId: value.transactionId,
    targets,
    legacyAppV2,
  };
}

function terminalOutcomeForActiveEvidence(evidence) {
  if (evidence.schema === MAIN_ACTIVE_PREPARATION_FAILURE_EVIDENCE_SCHEMA) {
    return "preparation-failed-before-journal";
  }
  if (evidence.schema === MAIN_ACTIVE_EVIDENCE_SCHEMA) {
    return "active-committed";
  }
  if (evidence.schema === MAIN_ACTIVE_CURRENT_RELEASE_EVIDENCE_SCHEMA) {
    return "current-release-verified";
  }
  if (evidence.schema === MAIN_ACTIVE_SAFE_NOOP_EVIDENCE_SCHEMA) {
    return evidence.reason;
  }
  if (evidence.schema !== MAIN_ACTIVE_FAILURE_EVIDENCE_SCHEMA) {
    throw new Error("Nested active evidence schema is unsupported");
  }
  if (evidence.recoveryOutcome === "recovered") return "recovered";
  if (
    evidence.recoveryOutcome === "verified-no-mutation" &&
    evidence.publicServingMutationCommands === 0
  ) {
    return "verified-noop";
  }
  return "manual-intervention";
}

export function assertMainActiveTerminalEvidenceArtifact(
  value,
  { execution, runId, runAttempt, outcome } = {},
) {
  const releaseExecution = assertMainReleaseExecution(execution);
  const manifest = releaseExecution.manifest;
  const planning = activePlanningFromExecution(releaseExecution);
  if (!isPlainObject(value)) {
    throw new Error("Nested active terminal evidence is malformed");
  }
  if (value.schema === MAIN_ACTIVE_PREPARATION_FAILURE_EVIDENCE_SCHEMA) {
    assertExactKeys(
      value,
      [
        "schema",
        "mode",
        "repository",
        "deploySha",
        "workflowDefinitionSha",
        "runId",
        "runAttempt",
        "workflowRunUrl",
        "planning",
        "stageResults",
        "publicServingMutationCommands",
        "outcome",
        "reason",
      ],
      "Nested active preparation failure evidence",
    );
    const identity = canonicalActiveEvidenceIdentity(value, releaseExecution, {
      runId,
      runAttempt,
    });
    const stageResults = canonicalTerminalStageResults(value.stageResults, {
      execution: releaseExecution,
      runId: identity.runId,
      runAttempt: identity.runAttempt,
    });
    if (
      value.deploySha !== manifest.deploySha ||
      !sameJson(value.planning, planning) ||
      value.publicServingMutationCommands !== 0 ||
      value.outcome !== "failed" ||
      value.reason !== "preparation-failed-before-journal"
    ) {
      throw new Error(
        "Nested active preparation failure evidence is inconsistent",
      );
    }
    const canonical = {
      schema: MAIN_ACTIVE_PREPARATION_FAILURE_EVIDENCE_SCHEMA,
      mode: MAIN_ACTIVE_DEPLOYMENT_MODE,
      repository: MAIN_TRANSACTION_REPOSITORY,
      deploySha: manifest.deploySha,
      workflowDefinitionSha: manifest.deploySha,
      runId: identity.runId,
      runAttempt: identity.runAttempt,
      workflowRunUrl: identity.workflowRunUrl,
      planning,
      stageResults,
      publicServingMutationCommands: 0,
      outcome: "failed",
      reason: "preparation-failed-before-journal",
    };
    assertSameJson(
      value,
      canonical,
      "Nested active preparation failure evidence",
    );
    if (
      outcome !== undefined &&
      outcome !== "preparation-failed-before-journal"
    ) {
      throw new Error("Nested active preparation failure outcome conflicts");
    }
    return canonical;
  }
  if (value.schema === MAIN_ACTIVE_CURRENT_RELEASE_EVIDENCE_SCHEMA) {
    assertExactKeys(
      value,
      [
        "schema",
        "mode",
        "repository",
        "deploySha",
        "workflowDefinitionSha",
        "runId",
        "runAttempt",
        "workflowRunUrl",
        "planning",
        "freshness",
        "finalMappings",
        "publicSmokes",
        "stateProofSummary",
        "publicServingMutationCommands",
        "outcome",
      ],
      "Nested current release verification evidence",
    );
    const identity = canonicalActiveEvidenceIdentity(value, releaseExecution, {
      runId,
      runAttempt,
    });
    if (
      value.deploySha !== manifest.deploySha ||
      releaseExecution.decision !== "verify-existing-release" ||
      releaseExecution.reason !== "current-main-release-already-complete" ||
      planning.activeTargets.length === 0 ||
      value.publicServingMutationCommands !== 0 ||
      value.outcome !== "current-release-verified"
    ) {
      throw new Error("Nested current release verification is inconsistent");
    }
    assertSameJson(value.planning, planning, "Nested current release planning");
    const freshness = canonicalFreshnessEvidence(value.freshness);
    if (
      !sameJson(freshness, [
        { phase: "current-release-verification", status: "fresh" },
      ])
    ) {
      throw new Error("Nested current release freshness is incomplete");
    }
    const finalMappings = canonicalNestedFinalMappings(
      value.finalMappings,
      releaseExecution,
    );
    const publicSmokes = canonicalPublicSmokes(
      value.publicSmokes,
      planning,
      manifest.deploySha,
    );
    const transactionId = createMainTransactionId({
      repository: MAIN_TRANSACTION_REPOSITORY,
      deploySha: manifest.deploySha,
      runId: identity.runId,
      runAttempt: identity.runAttempt,
    });
    const stateProofSummary = canonicalNestedStateProofSummary(
      value.stateProofSummary,
      releaseExecution,
      { transactionId, requireProven: true },
    );
    const canonical = {
      schema: MAIN_ACTIVE_CURRENT_RELEASE_EVIDENCE_SCHEMA,
      mode: MAIN_ACTIVE_DEPLOYMENT_MODE,
      repository: MAIN_TRANSACTION_REPOSITORY,
      deploySha: manifest.deploySha,
      workflowDefinitionSha: manifest.deploySha,
      runId: identity.runId,
      runAttempt: identity.runAttempt,
      workflowRunUrl: identity.workflowRunUrl,
      planning,
      freshness,
      finalMappings,
      publicSmokes,
      stateProofSummary,
      publicServingMutationCommands: 0,
      outcome: "current-release-verified",
    };
    assertSameJson(
      value,
      canonical,
      "Nested current release verification evidence",
    );
    if (outcome !== undefined && outcome !== "current-release-verified") {
      throw new Error("Nested current release verification outcome conflicts");
    }
    return canonical;
  }
  if (value.schema === MAIN_ACTIVE_SAFE_NOOP_EVIDENCE_SCHEMA) {
    assertExactKeys(
      value,
      [
        "schema",
        "mode",
        "repository",
        "deploySha",
        "workflowDefinitionSha",
        "runId",
        "runAttempt",
        "workflowRunUrl",
        "planning",
        "jobs",
        "coordinatorOutcome",
        "recoveryOutcome",
        "publicServingMutationCommands",
        "outcome",
        "reason",
      ],
      "Nested active safe-noop evidence",
    );
    const identity = canonicalActiveEvidenceIdentity(value, releaseExecution, {
      runId,
      runAttempt,
    });
    const jobs = canonicalFinalJobResults(
      value.jobs,
      "Nested active safe-noop job results",
    );
    if (
      value.deploySha !== manifest.deploySha ||
      !sameJson(value.planning, planning) ||
      jobs.waitForCi !== "success" ||
      jobs.plan !== "success" ||
      jobs.coordinator !== "success" ||
      jobs.recovery !== "success" ||
      value.recoveryOutcome !== "not-required" ||
      value.coordinatorOutcome !== value.reason ||
      value.outcome !== "success" ||
      value.publicServingMutationCommands !== 0 ||
      !["no-target", "superseded-before-journal", "shadow-prepared"].includes(
        value.reason,
      ) ||
      (value.reason === "no-target" && !releaseExecution.projection.noTarget) ||
      (value.reason === "shadow-prepared" &&
        (planning.stagedTargets.length === 0 ||
          planning.activeTargets.length !== 0))
    ) {
      throw new Error("Nested active safe-noop evidence is inconsistent");
    }
    for (const target of MAIN_ORDINARY_TARGETS) {
      const key =
        target === "governance"
          ? "stageGovernance"
          : target === "reserve"
            ? "stageReserve"
            : "stageUi";
      const expected = planning.stagedTargets.includes(target)
        ? "success"
        : "skipped";
      if (jobs[key] !== expected) {
        throw new Error("Nested active safe-noop stage result is inconsistent");
      }
    }
    const canonical = {
      schema: MAIN_ACTIVE_SAFE_NOOP_EVIDENCE_SCHEMA,
      mode: MAIN_ACTIVE_DEPLOYMENT_MODE,
      repository: MAIN_TRANSACTION_REPOSITORY,
      deploySha: manifest.deploySha,
      workflowDefinitionSha: manifest.deploySha,
      runId: identity.runId,
      runAttempt: identity.runAttempt,
      workflowRunUrl: identity.workflowRunUrl,
      planning,
      jobs,
      coordinatorOutcome: value.coordinatorOutcome,
      recoveryOutcome: "not-required",
      publicServingMutationCommands: 0,
      outcome: "success",
      reason: value.reason,
    };
    assertSameJson(value, canonical, "Nested active safe-noop evidence");
    if (outcome !== undefined && canonical.reason !== outcome) {
      throw new Error("Nested active safe-noop outcome conflicts");
    }
    return canonical;
  }
  if (value.schema === MAIN_ACTIVE_EVIDENCE_SCHEMA) {
    assertExactKeys(
      value,
      [
        "schema",
        "mode",
        "repository",
        "deploySha",
        "workflowDefinitionSha",
        "runId",
        "runAttempt",
        "workflowRunUrl",
        "planning",
        "journal",
        "orderedVerifiedOperations",
        "freshness",
        "finalMappings",
        "publicSmokes",
        "stateProofSummary",
        "recovery",
        "publicServingMutationCommands",
        "outcome",
      ],
      "Nested active deployment evidence",
    );
    const identity = canonicalActiveEvidenceIdentity(value, releaseExecution, {
      runId,
      runAttempt,
    });
    if (
      value.deploySha !== manifest.deploySha ||
      value.outcome !== "active-committed"
    ) {
      throw new Error("Nested active deployment outcome is inconsistent");
    }
    assertSameJson(value.planning, planning, "Nested active planning");
    assertExactKeys(
      value.journal,
      ["transactionId", "artifactName", "highestSequence", "highestStatus"],
      "Nested active journal summary",
    );
    const transactionId = createMainTransactionId({
      repository: MAIN_TRANSACTION_REPOSITORY,
      deploySha: manifest.deploySha,
      runId: identity.runId,
      runAttempt: identity.runAttempt,
    });
    const highestSequence = Number(
      requirePositiveId(
        value.journal.highestSequence,
        "Nested active journal sequence",
      ),
    );
    const journal = {
      transactionId,
      artifactName: `vercel-main-journal-${transactionId}-${String(
        highestSequence,
      ).padStart(6, "0")}`,
      highestSequence,
      highestStatus: "committed",
    };
    assertSameJson(value.journal, journal, "Nested active journal summary");
    const orderedVerifiedOperations = canonicalActiveVerifiedOperations(
      value.orderedVerifiedOperations,
    );
    const mutationCount = canonicalMutationCount(
      value.publicServingMutationCommands,
      "Nested active mutation count",
    );
    if (
      mutationCount === 0 ||
      orderedVerifiedOperations.length !== mutationCount
    ) {
      throw new Error("Nested active mutation evidence is inconsistent");
    }
    const freshness = canonicalFreshnessEvidence(value.freshness, {
      committed: true,
    });
    const finalMappings = canonicalNestedFinalMappings(
      value.finalMappings,
      releaseExecution,
    );
    const publicSmokes = canonicalPublicSmokes(
      value.publicSmokes,
      planning,
      manifest.deploySha,
    );
    const stateProofSummary = canonicalNestedStateProofSummary(
      value.stateProofSummary,
      releaseExecution,
      { transactionId, requireProven: true },
    );
    assertExactKeys(
      value.recovery,
      ["outcome", "rollbackStateTargets"],
      "Nested active recovery summary",
    );
    if (
      value.recovery.outcome !== "not-required" ||
      canonicalRollbackStateTargets(value.recovery.rollbackStateTargets)
        .length !== 0
    ) {
      throw new Error("Nested committed evidence cannot contain recovery");
    }
    const canonical = {
      schema: MAIN_ACTIVE_EVIDENCE_SCHEMA,
      mode: MAIN_ACTIVE_DEPLOYMENT_MODE,
      repository: MAIN_TRANSACTION_REPOSITORY,
      deploySha: manifest.deploySha,
      workflowDefinitionSha: manifest.deploySha,
      runId: identity.runId,
      runAttempt: identity.runAttempt,
      workflowRunUrl: identity.workflowRunUrl,
      planning,
      journal,
      orderedVerifiedOperations,
      freshness,
      finalMappings,
      publicSmokes,
      stateProofSummary,
      recovery: { outcome: "not-required", rollbackStateTargets: [] },
      publicServingMutationCommands: mutationCount,
      outcome: "active-committed",
    };
    assertSameJson(value, canonical, "Nested active deployment evidence");
    if (outcome !== undefined && outcome !== "active-committed") {
      throw new Error("Nested active deployment outcome conflicts");
    }
    return canonical;
  }
  if (value.schema !== MAIN_ACTIVE_FAILURE_EVIDENCE_SCHEMA) {
    throw new Error("Nested active evidence schema is unsupported");
  }
  assertExactKeys(
    value,
    [
      "schema",
      "mode",
      "repository",
      "eventHeadSha",
      "verifiedDeploySha",
      "workflowDefinitionSha",
      "runId",
      "runAttempt",
      "workflowRunUrl",
      "planOutputPresent",
      "jobs",
      "mainOwnershipMode",
      "journal",
      "orderedVerifiedOperations",
      "freshness",
      "finalMappings",
      "publicSmokes",
      "stateProofSummary",
      "rollbackStateTargets",
      "publicServingMutationCommands",
      "coordinatorOutcome",
      "recoveryOutcome",
      "errorCode",
      "outcome",
    ],
    "Nested active failure evidence",
  );
  const identity = canonicalActiveEvidenceIdentity(value, releaseExecution, {
    runId,
    runAttempt,
  });
  if (
    value.eventHeadSha !== manifest.deploySha ||
    value.verifiedDeploySha !== manifest.deploySha ||
    value.planOutputPresent !== true ||
    value.outcome !== "failed"
  ) {
    throw new Error("Nested active failure identity is incomplete");
  }
  const jobs = canonicalFinalJobResults(
    value.jobs,
    "Nested active failure job results",
  );
  const mainOwnershipMode = canonicalMainOwnershipMode(value.mainOwnershipMode);
  if (!sameJson(mainOwnershipMode, manifest.mainOwnershipMode)) {
    throw new Error(
      "Nested active failure ownership conflicts with the execution",
    );
  }
  assertExactKeys(
    value.journal,
    [
      "historyStatus",
      "transactionId",
      "artifactName",
      "highestSequence",
      "highestStatus",
    ],
    "Nested active failure journal",
  );
  if (
    !["valid", "missing", "ambiguous"].includes(value.journal.historyStatus)
  ) {
    throw new Error("Nested active failure journal status is malformed");
  }
  const expectedTransactionId = createMainTransactionId({
    repository: MAIN_TRANSACTION_REPOSITORY,
    deploySha: manifest.deploySha,
    runId: identity.runId,
    runAttempt: identity.runAttempt,
  });
  let journal;
  if (value.journal.historyStatus === "valid") {
    const highestSequence = Number(
      requireNonNegativeCount(
        value.journal.highestSequence,
        "Nested active failure journal sequence",
      ),
    );
    if (
      ![
        "prepared",
        "started",
        "command_returned",
        "verified",
        "committed",
        "recovering",
        "recovered",
        "manual_intervention",
      ].includes(value.journal.highestStatus)
    ) {
      throw new Error("Nested active failure journal head is malformed");
    }
    journal = {
      historyStatus: "valid",
      transactionId: expectedTransactionId,
      artifactName: `vercel-main-journal-${expectedTransactionId}-${String(
        highestSequence,
      ).padStart(6, "0")}`,
      highestSequence,
      highestStatus: value.journal.highestStatus,
    };
  } else {
    journal = {
      historyStatus: value.journal.historyStatus,
      transactionId: null,
      artifactName: null,
      highestSequence: null,
      highestStatus: null,
    };
  }
  assertSameJson(value.journal, journal, "Nested active failure journal");
  const orderedVerifiedOperations = canonicalActiveVerifiedOperations(
    value.orderedVerifiedOperations,
  );
  if (
    value.journal.historyStatus !== "valid" &&
    orderedVerifiedOperations.length !== 0
  ) {
    throw new Error("Unverified active journal cannot claim operations");
  }
  const freshness = canonicalFreshnessEvidence(value.freshness);
  const finalMappings =
    value.finalMappings === null
      ? null
      : canonicalNestedFinalMappings(value.finalMappings, releaseExecution);
  const publicSmokes = canonicalFailurePublicSmokes(value.publicSmokes);
  const stateProofSummary = canonicalNestedStateProofSummary(
    value.stateProofSummary,
    releaseExecution,
    { transactionId: expectedTransactionId, allowMissing: true },
  );
  const rollbackStateTargets = canonicalRollbackStateTargets(
    value.rollbackStateTargets,
  );
  const mutationCount = canonicalMutationCount(
    value.publicServingMutationCommands,
    "Nested active failure mutation count",
  );
  const coordinatorOutcome = requireString(
    value.coordinatorOutcome,
    "Nested active failure coordinator outcome",
    /^[a-z][a-z0-9-]*$/,
  );
  const recoveryOutcome = requireString(
    value.recoveryOutcome,
    "Nested active failure recovery outcome",
    /^[a-z][a-z0-9-]*$/,
  );
  const errorCode = requireString(
    value.errorCode,
    "Nested active failure error code",
    /^[A-Z][A-Z0-9_]*$/,
  );
  const canonical = {
    schema: MAIN_ACTIVE_FAILURE_EVIDENCE_SCHEMA,
    mode: MAIN_ACTIVE_DEPLOYMENT_MODE,
    repository: MAIN_TRANSACTION_REPOSITORY,
    eventHeadSha: manifest.deploySha,
    verifiedDeploySha: manifest.deploySha,
    workflowDefinitionSha: manifest.deploySha,
    runId: identity.runId,
    runAttempt: identity.runAttempt,
    workflowRunUrl: identity.workflowRunUrl,
    planOutputPresent: true,
    jobs,
    mainOwnershipMode,
    journal,
    orderedVerifiedOperations,
    freshness,
    finalMappings,
    publicSmokes,
    stateProofSummary,
    rollbackStateTargets,
    publicServingMutationCommands: mutationCount,
    coordinatorOutcome,
    recoveryOutcome,
    errorCode,
    outcome: "failed",
  };
  assertSameJson(value, canonical, "Nested active failure evidence");
  const terminalOutcome = terminalOutcomeForActiveEvidence(canonical);
  if (outcome !== undefined && terminalOutcome !== outcome) {
    throw new Error("Nested active failure outcome conflicts");
  }
  if (
    terminalOutcome === "recovered" &&
    (journal.historyStatus !== "valid" ||
      journal.highestStatus !== "recovered" ||
      rollbackStateTargets.length === 0)
  ) {
    throw new Error("Recovered active evidence lacks terminal recovery proof");
  }
  if (
    terminalOutcome === "manual-intervention" &&
    (journal.historyStatus !== "valid" ||
      journal.highestStatus !== "manual_intervention" ||
      mutationCount === 0)
  ) {
    throw new Error(
      "Manual-intervention evidence lacks a terminal unsafe journal",
    );
  }
  return canonical;
}

export function parseMainDeploymentArguments(argv) {
  if (!Array.isArray(argv) || !Object.hasOwn(CLI_COMMAND_OPTIONS, argv[0])) {
    throw new Error("Main deployment command is missing or unsupported");
  }
  const command = argv[0];
  const allowed = new Set(CLI_COMMAND_OPTIONS[command]);
  const options = Object.create(null);
  if ((argv.length - 1) % 2 !== 0) {
    throw new Error("Main deployment CLI arguments are malformed");
  }
  for (let index = 1; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (
      typeof flag !== "string" ||
      !/^--[a-z][a-z-]*$/.test(flag) ||
      typeof value !== "string" ||
      value.length === 0 ||
      value.startsWith("--")
    ) {
      throw new Error("Main deployment CLI arguments are malformed");
    }
    const name = flag.slice(2);
    if (!allowed.has(name)) {
      throw new Error("Main deployment CLI option is unsupported");
    }
    if (Object.hasOwn(options, name)) {
      throw new Error("Main deployment CLI option is duplicated");
    }
    options[name] = value;
  }
  if (
    Object.keys(options).length !== allowed.size ||
    [...allowed].some((name) => !Object.hasOwn(options, name))
  ) {
    throw new Error("Main deployment CLI required option is missing");
  }
  return { command, options };
}

function projectIdsFromEnvironment(values) {
  return {
    app: values.VERCEL_PROJECT_ID_APP,
    governance: values.VERCEL_PROJECT_ID_GOVERNANCE,
    reserve: values.VERCEL_PROJECT_ID_RESERVE,
    ui: values.VERCEL_PROJECT_ID_UI,
  };
}

function stageJobsFromEnvironment(values) {
  const parseOptional = (raw, label) => (raw ? parseJson(raw, label) : null);
  return {
    governance: {
      result: values.STAGE_GOVERNANCE_RESULT,
      handoff: parseOptional(
        values.STAGE_GOVERNANCE_HANDOFF,
        "Governance stage handoff",
      ),
    },
    reserve: {
      result: values.STAGE_RESERVE_RESULT,
      handoff: parseOptional(
        values.STAGE_RESERVE_HANDOFF,
        "Reserve stage handoff",
      ),
    },
    ui: {
      result: values.STAGE_UI_RESULT,
      handoff: parseOptional(values.STAGE_UI_HANDOFF, "UI stage handoff"),
    },
  };
}

function finalJobsFromEnvironment(values) {
  return {
    waitForCi: values.WAIT_FOR_CI_RESULT,
    plan: values.PLAN_RESULT,
    stageGovernance: values.STAGE_GOVERNANCE_RESULT,
    stageReserve: values.STAGE_RESERVE_RESULT,
    stageUi: values.STAGE_UI_RESULT,
    coordinator: values.COORDINATOR_RESULT,
    recovery: values.RECOVERY_RESULT,
  };
}

function finalActiveExecution(values, executionPath) {
  const deploySha = requireSha(
    values.DEPLOY_SHA,
    "Final active deployment SHA",
  );
  const upstreamRunId = requirePositiveId(
    values.UPSTREAM_RUN_ID,
    "Final active upstream run ID",
  );
  const upstreamRunAttempt = requirePositiveId(
    values.UPSTREAM_RUN_ATTEMPT,
    "Final active upstream run attempt",
  );
  requirePositiveId(values.GITHUB_RUN_ID, "Final active run ID");
  requirePositiveId(values.GITHUB_RUN_ATTEMPT, "Final active run attempt");
  if (values.GITHUB_REPOSITORY !== MAIN_TRANSACTION_REPOSITORY) {
    throw new Error("Final active repository is invalid");
  }
  const execution = assertMainReleaseExecution(
    readJson(executionPath, "Final active release execution"),
    { deploySha, upstreamRunId },
  );
  if (execution.upstream.runAttempt !== upstreamRunAttempt) {
    throw new Error("Final active execution upstream attempt is inconsistent");
  }
  return execution;
}

function mainOwnershipModeFromEnvironment(values) {
  return canonicalMainOwnershipMode(
    parseJson(values.MAIN_OWNERSHIP_MODE_JSON, "Main ownership mode"),
  );
}

function activeWorkflowRunUrlFromEnvironment(values) {
  return createMainWorkflowRunUrl({
    serverUrl: values.GITHUB_SERVER_URL,
    repository: values.GITHUB_REPOSITORY,
    runId: values.GITHUB_RUN_ID,
  });
}

function activeJournalArray(value, label) {
  if (Array.isArray(value)) return value;
  if (
    !isPlainObject(value) ||
    value.schema !== MAIN_ACTIVE_HISTORY_SCHEMA ||
    !Array.isArray(value.journals)
  ) {
    throw new Error(`${label} is malformed`);
  }
  return value.journals;
}

function assertMainActiveTerminalReleaseInputs({
  execution,
  releaseManifest,
  deploySha,
  upstreamRunId,
  upstreamRunAttempt,
  repository,
}) {
  const canonicalManifest = assertMainReleaseManifest(releaseManifest);
  const releaseExecution = assertMainReleaseExecution(execution, {
    deploySha,
    upstreamRunId,
    releaseId: canonicalManifest.releaseId,
  });
  const expectedManifest = releaseExecution.manifest;
  assertSameJson(
    canonicalManifest,
    expectedManifest,
    "Main terminal release manifest",
  );
  if (
    requirePositiveId(upstreamRunAttempt, "Terminal upstream run attempt") !==
      releaseExecution.upstream.runAttempt ||
    repository !== MAIN_TRANSACTION_REPOSITORY
  ) {
    throw new Error(
      "Main terminal release identity conflicts with the execution",
    );
  }
  return {
    execution: releaseExecution,
    manifest: expectedManifest,
    releaseManifestDigest: digestCanonicalJson(expectedManifest),
    releaseExecutionDigest: digestMainReleaseExecution(releaseExecution),
  };
}

function assertFreshLegacyV2TerminalProof(artifact, execution) {
  assertCanonicalOutput(artifact);
  if (
    !sameJson(
      canonicalTerminalArtifact(artifact, "Fresh legacy v2 state"),
      canonicalTerminalArtifact(
        execution.legacyAppV2,
        "Release execution legacy v2 state",
      ),
    )
  ) {
    throw new Error(
      "Main terminal fresh legacy v2 proof conflicts with execution",
    );
  }
}

function assertTerminalStateProofMatchesEvidence({
  proof,
  evidence,
  execution,
}) {
  if (evidence.stateProofSummary === null) return;
  const terminalState = terminalDeploymentStateProof({
    value: proof,
    execution,
    runId: evidence.runId,
    runAttempt: evidence.runAttempt,
    requireWrapper:
      evidence.schema === MAIN_ACTIVE_EVIDENCE_SCHEMA ||
      evidence.schema === MAIN_ACTIVE_CURRENT_RELEASE_EVIDENCE_SCHEMA,
  });
  if (terminalState.deploymentStateProof === null) {
    throw new Error("Main terminal state proof is absent");
  }
  const raw = terminalState.deploymentStateProof;
  const transactionId = createMainTransactionId({
    repository: MAIN_TRANSACTION_REPOSITORY,
    deploySha: execution.manifest.deploySha,
    runId: evidence.runId,
    runAttempt: evidence.runAttempt,
  });
  const summary = [
    MAIN_ACTIVE_EVIDENCE_SCHEMA,
    MAIN_ACTIVE_CURRENT_RELEASE_EVIDENCE_SCHEMA,
  ].includes(evidence.schema)
    ? summarizeActiveDeploymentStateProof(raw, {
        deploySha: execution.manifest.deploySha,
        runId: evidence.runId,
        runAttempt: evidence.runAttempt,
        transactionId,
        mainOwnershipMode: evidence.planning.mainOwnershipMode,
        stagedTargets: evidence.planning.stagedTargets,
        activeTargets: evidence.planning.activeTargets,
        shadowTargets: evidence.planning.shadowTargets,
        projectIds: execution.projection.projectIds,
        expectedDeploymentIds: Object.fromEntries(
          MAIN_DEPLOYMENT_TARGETS.map((target) => [
            target,
            evidence.planning.activeTargets.includes(target)
              ? evidence.stateProofSummary.targets[target].expectedDeploymentId
              : evidence.planning.shadowTargets.includes(target)
                ? undefined
                : null,
          ]),
        ),
        originalPriors: execution.manifest.originalPriors,
        legacyState: execution.legacyAppV2,
        requireProven: true,
      })
    : summarizeActiveDeploymentStateProof(raw, {
        deploySha: execution.manifest.deploySha,
        runId: evidence.runId,
        runAttempt: evidence.runAttempt,
        transactionId,
        mainOwnershipMode: evidence.mainOwnershipMode,
        originalPriors: execution.manifest.originalPriors,
      });
  assertSameJson(
    summary,
    evidence.stateProofSummary,
    "Main terminal nested state proof",
  );
  if (evidence.schema === MAIN_ACTIVE_CURRENT_RELEASE_EVIDENCE_SCHEMA) {
    const expectedByAlias = new Map();
    for (const target of MAIN_DEPLOYMENT_TARGETS) {
      const expected = evidence.planning.activeTargets.includes(target)
        ? raw.projects[target]
        : execution.manifest.originalPriors[target];
      for (const alias of execution.manifest.originalPriors[target].aliases) {
        expectedByAlias.set(alias, expected);
      }
    }
    for (const alias of execution.legacyAppV2.aliases) {
      expectedByAlias.set(alias, execution.legacyAppV2);
    }
    for (const mapping of evidence.finalMappings) {
      const expected = expectedByAlias.get(mapping.alias);
      const expectedDeploymentId =
        expected?.expectedDeploymentId ?? expected?.deploymentId;
      const expectedDeploymentUrl =
        expected?.expectedDeploymentUrl ?? expected?.deploymentUrl;
      if (
        expected === undefined ||
        mapping.deploymentId !== expectedDeploymentId ||
        mapping.deploymentUrl !== expectedDeploymentUrl
      ) {
        throw new Error(
          "Current release terminal mappings conflict with state proof",
        );
      }
    }
  }
}

function assertTerminalJournalMatchesEvidence({
  journalArtifact,
  evidence,
  execution,
}) {
  const history = assertMainActiveJournalHistory({
    journals: journalArtifact,
    deploySha: execution.manifest.deploySha,
    runId: evidence.runId,
    runAttempt: evidence.runAttempt,
  });
  const highest = history.at(-1);
  const expectedSummary =
    evidence.schema === MAIN_ACTIVE_EVIDENCE_SCHEMA
      ? {
          transactionId: highest.transactionId,
          artifactName: mainTransactionJournalArtifactName(highest),
          highestSequence: highest.sequence,
          highestStatus: highest.status,
        }
      : {
          historyStatus: "valid",
          transactionId: highest.transactionId,
          artifactName: mainTransactionJournalArtifactName(highest),
          highestSequence: highest.sequence,
          highestStatus: highest.status,
        };
  assertSameJson(
    expectedSummary,
    evidence.journal,
    "Main terminal nested journal",
  );
  assertSameJson(
    canonicalOrderedVerifiedOperations(highest),
    evidence.orderedVerifiedOperations,
    "Main terminal nested verified operations",
  );
  if (
    evidence.schema === MAIN_ACTIVE_EVIDENCE_SCHEMA &&
    operationMutationCounts(highest).started !==
      evidence.publicServingMutationCommands
  ) {
    throw new Error("Main terminal journal mutation count conflicts");
  }
  return highest;
}

function assertMainActiveTerminalProofBindings({
  proofs,
  evidence,
  execution,
  releaseManifestDigest,
  releaseExecutionDigest,
}) {
  if (
    proofs.releaseId !== execution.manifest.releaseId ||
    proofs.releaseManifestDigest !== releaseManifestDigest ||
    proofs.releaseExecutionDigest !== releaseExecutionDigest
  ) {
    throw new Error("Main terminal proofs conflict with release execution");
  }
  const expectedOutcome = terminalOutcomeForActiveEvidence(evidence);
  if (proofs.outcome !== expectedOutcome) {
    throw new Error("Main terminal proof outcome conflicts with evidence");
  }
  const expectedProducerJob = [
    MAIN_ACTIVE_FAILURE_EVIDENCE_SCHEMA,
    MAIN_ACTIVE_PREPARATION_FAILURE_EVIDENCE_SCHEMA,
  ].includes(evidence.schema)
    ? "recover-main-deployment"
    : "activate-and-verify";
  if (proofs.producerJob !== expectedProducerJob) {
    throw new Error("Main terminal proof producer conflicts with evidence");
  }
  if (proofs.mutationCount !== evidence.publicServingMutationCommands) {
    throw new Error(
      "Main terminal proof mutation count conflicts with evidence",
    );
  }
  const evidenceRollbackTargets =
    evidence.schema === MAIN_ACTIVE_EVIDENCE_SCHEMA
      ? evidence.recovery.rollbackStateTargets
      : evidence.schema === MAIN_ACTIVE_FAILURE_EVIDENCE_SCHEMA
        ? evidence.rollbackStateTargets
        : [];
  if (!sameJson(proofs.rollbackTargets, evidenceRollbackTargets)) {
    throw new Error("Main terminal rollback targets conflict with evidence");
  }
  if (
    evidence.schema === MAIN_ACTIVE_PREPARATION_FAILURE_EVIDENCE_SCHEMA &&
    (!sameJson(proofs.finalMapping.artifact, evidence.stageResults) ||
      !sameJson(proofs.finalCensus.artifact, evidence.stageResults) ||
      !sameJson(proofs.stateProof.artifact, evidence.stageResults))
  ) {
    throw new Error(
      "Main terminal preparation failure proofs conflict with evidence",
    );
  }
  assertFreshLegacyV2TerminalProof(proofs.freshLegacyV2.artifact, execution);

  if (evidence.finalMappings !== undefined && evidence.finalMappings !== null) {
    if (
      proofs.finalMapping.artifact === null ||
      !sameJson(
        canonicalTerminalArtifact(
          evidence.finalMappings,
          "Nested active final mappings",
        ),
        proofs.finalMapping.artifact,
      )
    ) {
      throw new Error(
        "Main terminal final mapping proof conflicts with evidence",
      );
    }
  } else if (
    proofs.finalMapping.receipt.status === "passed" &&
    proofs.finalMapping.artifact === null
  ) {
    throw new Error("Main terminal final mapping proof is missing");
  } else if (
    evidence.schema === MAIN_ACTIVE_SAFE_NOOP_EVIDENCE_SCHEMA &&
    proofs.finalMapping.receipt.status === "passed"
  ) {
    canonicalNestedFinalMappings(proofs.finalMapping.artifact, execution);
  }

  if (evidence.publicSmokes !== undefined && evidence.publicSmokes !== null) {
    if (
      proofs.publicSmoke.artifact === null ||
      !sameJson(
        canonicalTerminalArtifact(
          evidence.publicSmokes,
          "Nested active public smokes",
        ),
        proofs.publicSmoke.artifact,
      )
    ) {
      throw new Error(
        "Main terminal public smoke proof conflicts with evidence",
      );
    }
  } else if (
    proofs.publicSmoke.receipt.status === "passed" &&
    proofs.publicSmoke.artifact === null
  ) {
    throw new Error("Main terminal public smoke proof is missing");
  } else if (
    evidence.schema === MAIN_ACTIVE_SAFE_NOOP_EVIDENCE_SCHEMA &&
    proofs.publicSmoke.receipt.status === "passed"
  ) {
    canonicalPublicSmokes(
      proofs.publicSmoke.artifact,
      evidence.planning,
      execution.manifest.deploySha,
    );
  }

  if (proofs.stateProof.receipt.status === "passed") {
    const terminalState = terminalDeploymentStateProof({
      value: proofs.stateProof.artifact,
      execution,
      runId: evidence.runId,
      runAttempt: evidence.runAttempt,
      requireWrapper: ["active-committed", "current-release-verified"].includes(
        proofs.outcome,
      ),
    });
    if (terminalState.deploymentStateProof === null) {
      throw new Error("Main terminal deployment state proof is absent");
    }
    const rawStateProof = terminalState.deploymentStateProof;
    const expectedOwnership =
      evidence.schema === MAIN_ACTIVE_FAILURE_EVIDENCE_SCHEMA
        ? evidence.mainOwnershipMode
        : evidence.planning.mainOwnershipMode;
    if (
      rawStateProof.deploySha !== execution.manifest.deploySha ||
      rawStateProof.runId !== evidence.runId ||
      rawStateProof.runAttempt !== evidence.runAttempt ||
      rawStateProof.transactionId !==
        createMainTransactionId({
          repository: MAIN_TRANSACTION_REPOSITORY,
          deploySha: execution.manifest.deploySha,
          runId: evidence.runId,
          runAttempt: evidence.runAttempt,
        }) ||
      !sameJson(rawStateProof.mainOwnershipMode, expectedOwnership)
    ) {
      throw new Error("Main terminal state proof identity conflicts");
    }
  }
  if (proofs.finalCensus.receipt.status === "passed") {
    const canonicalCensusArtifact =
      proofs.stateProof.receipt.status === "passed"
        ? proofs.stateProof.artifact
        : proofs.outcome === "shadow-prepared" &&
            proofs.stateProof.receipt.status === "prepared"
          ? terminalDeploymentStateProof({
              value: proofs.stateProof.artifact,
              execution,
              runId: evidence.runId,
              runAttempt: evidence.runAttempt,
              requireWrapper: true,
            }).artifact
          : null;
    if (
      canonicalCensusArtifact === null ||
      !sameJson(proofs.finalCensus.artifact, canonicalCensusArtifact)
    ) {
      throw new Error(
        "Main terminal final census proof conflicts with canonical evidence",
      );
    }
  }
  if (
    evidence.stateProofSummary !== undefined &&
    evidence.stateProofSummary !== null
  ) {
    if (proofs.stateProof.artifact === null) {
      throw new Error("Main terminal state proof is missing");
    }
    assertTerminalStateProofMatchesEvidence({
      proof: proofs.stateProof.artifact,
      evidence,
      execution,
    });
  }

  if (
    proofs.journal.receipt.status !== "not-applicable" &&
    proofs.journal.artifact !== null
  ) {
    const highest = assertTerminalJournalMatchesEvidence({
      journalArtifact: proofs.journal.artifact,
      evidence,
      execution,
    });
    if (
      proofs.outcome === "manual-intervention" &&
      !sameJson(proofs.affectedOperations, terminalAffectedOperations(highest))
    ) {
      throw new Error(
        "Main terminal affected operations conflict with the journal",
      );
    }
  }
}

export function createMainActiveTerminalHandoff({
  activeEvidence,
  releaseManifest,
  execution,
  proofs,
  deploySha,
  upstreamRunId,
  upstreamRunAttempt,
  workflowRunId,
  producerRunAttempt,
  repository,
}) {
  const release = assertMainActiveTerminalReleaseInputs({
    execution,
    releaseManifest,
    deploySha,
    upstreamRunId,
    upstreamRunAttempt,
    repository,
  });
  const canonicalProofs = assertMainActiveTerminalProofs(proofs);
  const canonicalWorkflowRunId = requirePositiveId(
    workflowRunId,
    "Main terminal workflow run ID",
  );
  const canonicalProducerRunAttempt = requirePositiveId(
    producerRunAttempt,
    "Main terminal producer run attempt",
  );
  const artifact = assertMainActiveTerminalEvidenceArtifact(activeEvidence, {
    execution: release.execution,
    runId: canonicalWorkflowRunId,
    runAttempt: canonicalProducerRunAttempt,
    outcome: canonicalProofs.outcome,
  });
  assertMainActiveTerminalProofBindings({
    proofs: canonicalProofs,
    evidence: artifact,
    execution: release.execution,
    releaseManifestDigest: release.releaseManifestDigest,
    releaseExecutionDigest: release.releaseExecutionDigest,
  });
  const identity = {
    deploySha: release.manifest.deploySha,
    upstreamRunId: release.execution.upstream.runId,
    upstreamRunAttempt: release.execution.upstream.runAttempt,
    workflowRunId: canonicalWorkflowRunId,
    producerRunAttempt: canonicalProducerRunAttempt,
    producerJob: canonicalProofs.producerJob,
    releaseId: release.manifest.releaseId,
    releaseManifestDigest: release.releaseManifestDigest,
    releasePlanDigest: release.manifest.releasePlanDigest,
    releaseExecutionDigest: release.releaseExecutionDigest,
    outcome: canonicalProofs.outcome,
  };
  const evidence = createMainTerminalEvidence({
    ...identity,
    affectedOperations: canonicalProofs.affectedOperations,
    artifact,
  });
  const receipt = createMainTerminalReceipt({
    ...identity,
    evidenceDigest: digestMainTerminalEvidence(evidence),
    finalMapping: canonicalProofs.finalMapping.receipt,
    finalCensus: canonicalProofs.finalCensus.receipt,
    stateProof: canonicalProofs.stateProof.receipt,
    publicSmoke: canonicalProofs.publicSmoke.receipt,
    freshLegacyV2: canonicalProofs.freshLegacyV2.receipt,
    mutationCount: canonicalProofs.mutationCount,
    rollbackTargets: canonicalProofs.rollbackTargets,
    affectedOperations: canonicalProofs.affectedOperations,
    journal: canonicalProofs.journal.receipt,
  });
  return {
    receipt,
    evidence,
    encodedReceipt: encodeMainTerminalReceipt(receipt),
    encodedEvidence: encodeMainTerminalEvidence(evidence),
  };
}

export function restoreMainActiveTerminalEvidence({
  encodedReceipt,
  encodedEvidence,
  releaseManifest,
  execution,
  deploySha,
  upstreamRunId,
  upstreamRunAttempt,
  workflowRunId,
  finalRunAttempt,
  repository,
}) {
  const release = assertMainActiveTerminalReleaseInputs({
    execution,
    releaseManifest,
    deploySha,
    upstreamRunId,
    upstreamRunAttempt,
    repository,
  });
  const receipt = decodeMainTerminalReceipt(encodedReceipt, {
    deploySha: release.manifest.deploySha,
    upstreamRunId: release.execution.upstream.runId,
    upstreamRunAttempt: release.execution.upstream.runAttempt,
    workflowRunId: requirePositiveId(
      workflowRunId,
      "Main terminal workflow run ID",
    ),
    finalRunAttempt: requirePositiveId(
      finalRunAttempt,
      "Main terminal final run attempt",
    ),
    releaseId: release.manifest.releaseId,
    releaseManifestDigest: release.releaseManifestDigest,
    releasePlanDigest: release.manifest.releasePlanDigest,
    releaseExecutionDigest: release.releaseExecutionDigest,
  });
  const evidence = decodeMainTerminalEvidence(encodedEvidence, { receipt });
  const artifact = assertMainActiveTerminalEvidenceArtifact(evidence.artifact, {
    execution: release.execution,
    runId: receipt.workflowRunId,
    runAttempt: receipt.producerRunAttempt,
    outcome: receipt.outcome,
  });
  if (terminalOutcomeForActiveEvidence(artifact) !== receipt.outcome) {
    throw new Error("Restored active evidence conflicts with terminal receipt");
  }
  return { receipt, evidence, artifact };
}

function writeMainActiveTransition({
  values,
  result,
  outputPath,
  journalOutputPath,
}) {
  const { journal, ...handoff } = result;
  writeCanonicalJson(outputPath, handoff);
  if (journal === null) {
    if (existsSync(journalOutputPath)) {
      throw new Error(
        "Journal output path already exists for a transition without a snapshot",
      );
    }
  } else {
    writeCanonicalJson(journalOutputPath, journal);
  }
  for (const [name, value] of [
    ["transition_kind", result.transitionKind],
    ["next_action", result.nextAction],
    ["after_upload_action", result.afterUploadAction ?? "none"],
    ["transaction_id", result.transactionId ?? "none"],
    ["journal_sequence", result.journalSequence ?? "none"],
    ["journal_artifact_name", result.journalArtifactName ?? "none"],
    ["operation_id", result.operationId ?? "none"],
    ["operation_type", result.operationType ?? "none"],
    ["target", result.target ?? "none"],
    ["alias", result.alias ?? "none"],
    [
      "command",
      result.command === null ? "null" : JSON.stringify(result.command),
    ],
    ["confirmed_mutation_commands", result.confirmedMutationCommands],
    ["possible_mutation_commands", result.possibleMutationCommands],
  ]) {
    appendOutput(values.GITHUB_OUTPUT, name, value);
  }
  return result;
}

function appProofFromEnvironment(values) {
  return values.APP_BUILD_PROOF
    ? parseJson(values.APP_BUILD_PROOF, "App build proof")
    : null;
}

function evidenceStageFromEnvironment(values, target) {
  const prefix = `EVIDENCE_${target.toUpperCase()}`;
  const result = values[`${prefix}_RESULT`];
  if (result === "skipped") return null;
  if (result !== "success") {
    throw new Error(`${target} evidence job did not succeed or skip`);
  }
  return {
    handoff: parseJson(
      values[`${prefix}_HANDOFF`],
      `${target} evidence handoff`,
    ),
    nextDeploymentId: values[`${prefix}_NEXT_DEPLOYMENT_ID`],
    metrics: {
      buildDurationMs: values[`${prefix}_BUILD_DURATION_MS`],
      deployDurationMs: values[`${prefix}_DEPLOY_DURATION_MS`],
      totalDurationMs: values[`${prefix}_TOTAL_DURATION_MS`],
      turboCacheHits: values[`${prefix}_TURBO_CACHE_HITS`],
      turboCacheMisses: values[`${prefix}_TURBO_CACHE_MISSES`],
    },
  };
}

function evidenceAppFromEnvironment(values) {
  if (!values.EVIDENCE_APP_NEXT_DEPLOYMENT_ID) return null;
  return {
    nextDeploymentId: values.EVIDENCE_APP_NEXT_DEPLOYMENT_ID,
    metrics: {
      buildDurationMs: values.EVIDENCE_APP_BUILD_DURATION_MS,
      totalDurationMs: values.EVIDENCE_APP_TOTAL_DURATION_MS,
      turboCacheHits: values.EVIDENCE_APP_TURBO_CACHE_HITS,
      turboCacheMisses: values.EVIDENCE_APP_TURBO_CACHE_MISSES,
    },
  };
}

function authorizationFromTransition(path, label) {
  const authorization = readJson(path, label);
  if (
    !isPlainObject(authorization) ||
    authorization.schema !== "vercel-main-active-transition:v1" ||
    authorization.transitionKind !== "command" ||
    authorization.nextAction !== "execute-command" ||
    typeof authorization.operationId !== "string" ||
    !isPlainObject(authorization.command)
  ) {
    throw new Error(`${label} is not an authorized command transition`);
  }
  return {
    operationId: authorization.operationId,
    command: authorization.command,
  };
}

export function createMainActiveFreshness({ deploySha, observedSha }) {
  const expected = requireSha(deploySha, "Active freshness deployment SHA");
  const observed = requireSha(observedSha, "Active freshness observed SHA");
  return {
    schema: "vercel-main-active-freshness:v1",
    status: observed === expected ? "fresh" : "superseded",
    deploySha: expected,
    observedSha: observed,
  };
}

function freshShaFromObservation(path) {
  const observation = readJson(path, "Active freshness observation");
  assertExactKeys(
    observation,
    ["deploySha", "observedSha", "schema", "status"],
    "Active freshness observation",
  );
  const canonical = createMainActiveFreshness({
    deploySha: observation.deploySha,
    observedSha: observation.observedSha,
  });
  if (
    JSON.stringify(observation) !== JSON.stringify(canonical) ||
    canonical.status !== "fresh"
  ) {
    throw new Error("Active freshness observation is not fresh");
  }
  return canonical.observedSha;
}

function buildMainActiveEvent(command, options) {
  if (command === "active-event-initialize") {
    return createMainActiveTransitionEvent({
      schema: "vercel-main-active-event:v1",
      kind: "initialize",
    });
  }
  const kind = command.slice("active-event-".length);
  if (kind === "dispatch" || kind === "authorize") {
    return createMainActiveTransitionEvent({
      schema: "vercel-main-active-event:v1",
      kind,
      uploadReceipt: readJson(options.receipt, "Active journal receipt"),
      freshSha: freshShaFromObservation(options.freshness),
      currentMappings: readJson(
        options["current-mappings"],
        "Active current mappings",
      ),
    });
  }
  if (kind === "command-returned") {
    const authorization = authorizationFromTransition(
      options.authorization,
      "Active command authorization",
    );
    return createMainActiveTransitionEvent({
      schema: "vercel-main-active-event:v1",
      kind,
      uploadReceipt: readJson(options.receipt, "Active journal receipt"),
      operationId: authorization.operationId,
      command: authorization.command,
      result: readJson(options.result, "Active command result"),
    });
  }
  if (
    command === "active-event-verify" ||
    command === "active-event-verify-app"
  ) {
    const authorization = authorizationFromTransition(
      options.authorization,
      "Active verification authorization",
    );
    const appVerification = command === "active-event-verify-app";
    if ((authorization.command.kind === "app-v3-deploy") !== appVerification) {
      throw new Error(
        "Active verification materializer does not match the authorized command",
      );
    }
    return createMainActiveTransitionEvent({
      schema: "vercel-main-active-event:v1",
      kind: "verify",
      uploadReceipt: readJson(options.receipt, "Active journal receipt"),
      freshSha: freshShaFromObservation(options.freshness),
      currentMappings: readJson(
        options["current-mappings"],
        "Active current mappings",
      ),
      appCandidateReceipt: appVerification
        ? readJson(
            options["app-candidate-receipt"],
            "Active App candidate receipt",
          )
        : null,
      appDeployment: appVerification
        ? readJson(options["app-deployment"], "Active App deployment")
        : null,
    });
  }
  if (kind === "finalize") {
    return createMainActiveTransitionEvent({
      schema: "vercel-main-active-event:v1",
      kind,
      uploadReceipt: readJson(options.receipt, "Active journal receipt"),
      freshSha: freshShaFromObservation(options.freshness),
      currentMappings: readJson(
        options["current-mappings"],
        "Active current mappings",
      ),
      publicSmokes: readJson(options["public-smokes"], "Active public smokes"),
      stateProof: readJson(
        options["state-proof"],
        "Active deployment state proof",
      ),
    });
  }
  throw new Error("Active event builder command is unsupported");
}

function canonicalActiveSmokeInput(value, target, deploySha, active) {
  if (!isPlainObject(value)) {
    throw new Error(`Active ${target} smoke result is malformed`);
  }
  assertExactKeys(
    value,
    ["runtime", "servedSha", "status"],
    `Active ${target} smoke result`,
  );
  if (
    value.status !== (active ? "passed" : "not-required") ||
    value.servedSha !== (active ? deploySha : null)
  ) {
    throw new Error(`Active ${target} smoke result is inconsistent`);
  }
  const runtime = active
    ? canonicalActiveRuntimeSmoke({
        value: value.runtime,
        target,
        expectedSha: deploySha,
        label: `Active ${target} smoke runtime`,
      })
    : null;
  if (!active && value.runtime !== null) {
    throw new Error(`Active ${target} smoke result is inconsistent`);
  }
  return { runtime, status: value.status, servedSha: value.servedSha };
}

export function createMainActivePublicSmokes({ plan, targetResults }) {
  const handoff = assertMainDeploymentHandoff(plan);
  const planning = createMainActivePlanning({ plan: handoff });
  assertExactKeys(
    targetResults,
    MAIN_DEPLOYMENT_TARGETS,
    "Active smoke results",
  );
  return Object.fromEntries(
    MAIN_DEPLOYMENT_TARGETS.map((target) => {
      const result = canonicalActiveSmokeInput(
        targetResults[target],
        target,
        handoff.deploySha,
        planning.activeTargets.includes(target),
      );
      return [
        target,
        {
          publicUrl: ACTIVE_PUBLIC_URLS[target],
          runtime: result.runtime,
          servedSha: result.servedSha,
          status: result.status,
        },
      ];
    }),
  );
}

function buildMainActiveRecoveryEvent(command, options) {
  const kind = command.slice("active-recovery-event-".length);
  const common = {
    schema: "vercel-main-active-recovery-event:v1",
    kind,
    uploadReceipt: readJson(options.receipt, "Active recovery journal receipt"),
  };
  if (kind === "initialize") {
    return createMainActiveRecoveryTransitionEvent(common);
  }
  if (kind === "dispatch" || kind === "authorize" || kind === "verify") {
    return createMainActiveRecoveryTransitionEvent({
      ...common,
      currentMappings: readJson(
        options["current-mappings"],
        "Active recovery current mappings",
      ),
    });
  }
  if (kind === "command-returned") {
    const authorization = authorizationFromTransition(
      options.authorization,
      "Active recovery command authorization",
    );
    return createMainActiveRecoveryTransitionEvent({
      ...common,
      operationId: authorization.operationId,
      command: authorization.command,
      result: readJson(options.result, "Active recovery command result"),
    });
  }
  throw new Error("Active recovery event builder command is unsupported");
}

export async function runMainDeploymentCli({
  argv = process.argv.slice(2),
  values = process.env,
}) {
  const { command, options } = parseMainDeploymentArguments(argv);
  if (command === "create-release-manifest") {
    const manifest = createMainReleaseManifest({
      plan: readJson(options.plan, "Canonical main release plan"),
      originalPriors: readJson(
        options["original-priors"],
        "Fresh main release original priors",
      ),
      upstreamRunId: values.UPSTREAM_RUN_ID,
    });
    writeCanonicalJson(options.output, manifest);
    appendOutput(values.GITHUB_OUTPUT, "release_id", manifest.releaseId);
    return manifest;
  }
  if (command === "terminal-evidence-create") {
    if (!values.GITHUB_OUTPUT) {
      throw new Error("GITHUB_OUTPUT is required");
    }
    const result = createMainActiveTerminalHandoff({
      activeEvidence: readJson(
        options["active-evidence"],
        "Canonical active deployment evidence",
      ),
      releaseManifest: readJson(
        options.manifest,
        "Canonical main release manifest",
      ),
      execution: readJson(
        options.execution,
        "Canonical main release execution",
      ),
      proofs: readJson(
        options.proofs,
        "Canonical active terminal proofs",
        MAIN_ACTIVE_TERMINAL_PROOFS_MAX_JSON_BYTES,
      ),
      deploySha: values.DEPLOY_SHA,
      upstreamRunId: values.UPSTREAM_RUN_ID,
      upstreamRunAttempt: values.UPSTREAM_RUN_ATTEMPT,
      workflowRunId: values.GITHUB_RUN_ID,
      producerRunAttempt: values.GITHUB_RUN_ATTEMPT,
      repository: values.GITHUB_REPOSITORY,
    });
    writeCanonicalJson(options["receipt-output"], result.receipt);
    writeCanonicalJson(options["evidence-output"], result.evidence);
    appendOutput(values.GITHUB_OUTPUT, "receipt", result.encodedReceipt);
    appendOutput(values.GITHUB_OUTPUT, "evidence", result.encodedEvidence);
    return result;
  }
  if (command === "terminal-evidence-restore") {
    const result = restoreMainActiveTerminalEvidence({
      encodedReceipt: options.receipt,
      encodedEvidence: options.evidence,
      releaseManifest: readJson(
        options.manifest,
        "Canonical main release manifest",
      ),
      execution: readJson(
        options.execution,
        "Canonical main release execution",
      ),
      deploySha: values.DEPLOY_SHA,
      upstreamRunId: values.UPSTREAM_RUN_ID,
      upstreamRunAttempt: values.UPSTREAM_RUN_ATTEMPT,
      workflowRunId: values.GITHUB_RUN_ID,
      finalRunAttempt: values.GITHUB_RUN_ATTEMPT,
      repository: values.GITHUB_REPOSITORY,
    });
    writeCanonicalJson(options.output, result.artifact);
    if (values.GITHUB_STEP_SUMMARY) {
      const render =
        result.artifact.schema === MAIN_ACTIVE_EVIDENCE_SCHEMA
          ? renderMainActiveDeploymentEvidence
          : result.artifact.schema ===
              MAIN_ACTIVE_CURRENT_RELEASE_EVIDENCE_SCHEMA
            ? renderMainCurrentReleaseVerificationEvidence
            : result.artifact.schema ===
                MAIN_ACTIVE_PREPARATION_FAILURE_EVIDENCE_SCHEMA
              ? renderMainActivePreparationFailureEvidence
              : result.artifact.schema === MAIN_ACTIVE_SAFE_NOOP_EVIDENCE_SCHEMA
                ? renderMainActiveSafeNoopEvidence
                : renderMainActiveDeploymentFailureEvidence;
      appendFileSync(values.GITHUB_STEP_SUMMARY, render(result.artifact));
    }
    return result;
  }
  if (command === "candidate-intent") {
    const intent = createMainCurrentCandidateIntent({
      execution: readJson(
        options.execution,
        "Canonical main release execution",
      ),
      target: options.target,
      runId: values.GITHUB_RUN_ID,
      runAttempt: values.GITHUB_RUN_ATTEMPT,
    });
    writeCanonicalJson(options.output, intent);
    appendOutput(values.GITHUB_OUTPUT, "candidate_id", intent.candidateId);
    return intent;
  }
  if (command === "candidate-metadata") {
    const metadata = createMainCandidateVercelMetadata({
      intent: readJson(options.intent, "Main candidate intent"),
    });
    writeCanonicalJson(options.output, metadata);
    return metadata;
  }
  if (command === "reconcile-release") {
    const journal = readJson(options.journal, "Main release journal");
    const initial = reconcileFreshMainActiveRelease({
      journal,
      currentMappings: readJson(
        options["current-mappings"],
        "Fresh main release mappings",
      ),
    });
    const reconciliation = reconcileFreshMainActiveRelease({
      journal,
      currentMappings: readJson(
        options["rechecked-current-mappings"],
        "Rechecked main release mappings",
      ),
    });
    if (
      JSON.stringify(initial.observedTargets) !==
      JSON.stringify(reconciliation.observedTargets)
    ) {
      throw new Error("Fresh main release provider census changed");
    }
    writeCanonicalJson(options.output, reconciliation);
    appendOutput(
      values.GITHUB_OUTPUT,
      "decision",
      reconciliation.allCandidate
        ? "verify-noop"
        : reconciliation.allPrior
          ? "start"
          : "resume",
    );
    return reconciliation;
  }
  if (command === "prepare-current-recovery-journal") {
    const currentMappings = readJson(
      options["current-mappings"],
      "Fresh recovery current mappings",
    );
    const result = createCurrentMainActiveRecoveryJournal({
      inheritedJournal: readJson(
        options["inherited-journal"],
        "Inherited main release journal",
      ),
      identity: {
        repository: MAIN_TRANSACTION_REPOSITORY,
        deploySha: values.DEPLOY_SHA,
        runId: values.GITHUB_RUN_ID,
        runAttempt: values.GITHUB_RUN_ATTEMPT,
      },
      currentMappings,
    });
    writeCanonicalJson(options.output, result.journal);
    appendOutput(
      values.GITHUB_OUTPUT,
      "artifact_name",
      mainTransactionJournalArtifactName(result.journal),
    );
    appendOutput(
      values.GITHUB_OUTPUT,
      "transaction_id",
      result.journal.transactionId,
    );
    return result;
  }
  if (command === "stage-barrier") {
    const barrier = createMainStageBarrier({
      execution: readJson(options.execution, "Main release execution"),
      candidateReceipts: readJson(
        options["candidate-receipts"],
        "Current main candidate receipts",
      ),
      appPreparation: readJson(
        options["app-preparation"],
        "Current App preparation",
      ),
      runId: values.GITHUB_RUN_ID,
      runAttempt: values.GITHUB_RUN_ATTEMPT,
    });
    writeCanonicalJson(options.output, barrier);
    appendOutput(values.GITHUB_OUTPUT, "release_id", barrier.releaseId);
    appendOutput(
      values.GITHUB_OUTPUT,
      "stage_barrier",
      JSON.stringify(barrier),
    );
    return barrier;
  }
  if (command === "plan-inherited-recovery") {
    const plan = decideMainActiveAppRecoverySafety({
      inheritedJournal: readJson(
        options.journal,
        "Inherited main release journal",
      ),
      currentJournal: readJson(
        options["current-journal"],
        "Current-attempt recovery journal",
      ),
      reason: options.reason,
      currentMappings: readJson(
        options["current-mappings"],
        "Fresh inherited recovery mappings",
      ),
    });
    writeCanonicalJson(options.output, plan);
    appendOutput(values.GITHUB_OUTPUT, "decision", plan.decision);
    appendOutput(values.GITHUB_OUTPUT, "reason", plan.reason);
    return plan;
  }
  if (command.startsWith("active-event-")) {
    const event = buildMainActiveEvent(command, options);
    writeCanonicalJson(options.output, event);
    return event;
  }
  if (command.startsWith("active-recovery-event-")) {
    const event = buildMainActiveRecoveryEvent(command, options);
    writeCanonicalJson(options.output, event);
    return event;
  }
  if (command === "active-journal-receipt") {
    const receipt = createMainActiveJournalReceipt({
      journal: readJson(options.journal, "Active journal snapshot"),
      artifactName: options["artifact-name"],
      artifactId: options["artifact-id"],
    });
    writeCanonicalJson(options.output, receipt);
    appendOutput(values.GITHUB_OUTPUT, "transaction_id", receipt.transactionId);
    appendOutput(values.GITHUB_OUTPUT, "sequence", receipt.sequence);
    appendOutput(values.GITHUB_OUTPUT, "artifact_name", receipt.artifactName);
    appendOutput(values.GITHUB_OUTPUT, "artifact_id", receipt.artifactId);
    return receipt;
  }
  if (command === "active-journal-history") {
    const identity = createMainActiveJournalHistoryIdentity({
      deploySha: values.DEPLOY_SHA,
      runId: values.GITHUB_RUN_ID,
      runAttempt: values.GITHUB_RUN_ATTEMPT,
    });
    const history = loadMainActiveJournalHistory({
      artifactsDirectory: options.artifacts,
      expectedIdentity: {
        repository: identity.repository,
        deploySha: identity.deploySha,
        runId: identity.runId,
        runAttempt: identity.runAttempt,
        transactionId: identity.transactionId,
        mode: identity.mode,
      },
    });
    writeCanonicalJson(options.output, history);
    appendOutput(
      values.GITHUB_OUTPUT,
      "highest_sequence",
      history.highestSequence,
    );
    appendOutput(values.GITHUB_OUTPUT, "highest_status", history.highestStatus);
    appendOutput(
      values.GITHUB_OUTPUT,
      "highest_artifact_name",
      history.highestArtifactName,
    );
    const mutationCounts = operationMutationCounts(history.journals.at(-1));
    appendOutput(
      values.GITHUB_OUTPUT,
      "confirmed_mutation_commands",
      mutationCounts.confirmedReturned,
    );
    appendOutput(
      values.GITHUB_OUTPUT,
      "possible_mutation_commands",
      mutationCounts.started,
    );
    return history;
  }
  if (command === "active-journal-identity") {
    const identity = createMainActiveJournalHistoryIdentity({
      deploySha: values.DEPLOY_SHA,
      runId: values.GITHUB_RUN_ID,
      runAttempt: values.GITHUB_RUN_ATTEMPT,
    });
    appendOutput(
      values.GITHUB_OUTPUT,
      "artifact_prefix",
      identity.artifactPrefix,
    );
    appendOutput(
      values.GITHUB_OUTPUT,
      "transaction_id",
      identity.transactionId,
    );
    appendOutput(values.GITHUB_OUTPUT, "mode", identity.mode);
    return identity;
  }
  if (command === "active-command-descriptor") {
    const authorization = authorizationFromTransition(
      options.authorization,
      "Active command authorization",
    );
    writeCanonicalJson(options.output, authorization.command);
    return authorization.command;
  }
  if (command === "active-freshness") {
    const freshness = createMainActiveFreshness({
      deploySha: values.DEPLOY_SHA,
      observedSha: readRemoteMainSha({}),
    });
    writeCanonicalJson(options.output, freshness);
    appendOutput(values.GITHUB_OUTPUT, "status", freshness.status);
    appendOutput(values.GITHUB_OUTPUT, "observed_sha", freshness.observedSha);
    return freshness;
  }
  if (command === "active-state-spec") {
    const spec = createMainCurrentActiveDeploymentStateSpec({
      execution: readJson(options.execution, "Main release execution"),
      barrier: readJson(options["stage-barrier"], "Current main stage barrier"),
      journalHistory: readActiveJournalHistory(
        options["journal-history"],
        "Active state spec journal history",
      ),
      runId: values.GITHUB_RUN_ID,
      runAttempt: values.GITHUB_RUN_ATTEMPT,
    });
    writeCanonicalJson(options.output, spec);
    appendOutput(values.GITHUB_OUTPUT, "transaction_id", spec.transactionId);
    appendOutput(
      values.GITHUB_OUTPUT,
      "active_targets",
      JSON.stringify(spec.activeTargets),
    );
    appendOutput(
      values.GITHUB_OUTPUT,
      "shadow_targets",
      JSON.stringify(spec.shadowTargets),
    );
    return spec;
  }
  if (command === "current-release-state-spec") {
    const spec = createMainCurrentReleaseVerifiedDeploymentStateSpec({
      execution: readJson(options.execution, "Main release execution"),
      barrier: readJson(options["stage-barrier"], "Current main stage barrier"),
      runId: values.GITHUB_RUN_ID,
      runAttempt: values.GITHUB_RUN_ATTEMPT,
    });
    writeCanonicalJson(options.output, spec);
    appendOutput(values.GITHUB_OUTPUT, "transaction_id", spec.transactionId);
    return spec;
  }
  if (command === "active-terminal-state-proof") {
    const proof = createMainActiveTerminalStateProof({
      execution: readJson(options.execution, "Main release execution"),
      barrier: readJson(options["stage-barrier"], "Current main stage barrier"),
      stateProof: readJson(
        options["state-proof"],
        "Active deployment state proof",
      ),
      runId: values.GITHUB_RUN_ID,
      runAttempt: values.GITHUB_RUN_ATTEMPT,
    });
    writeCanonicalJson(options.output, proof);
    return proof;
  }
  if (command === "active-recovery-mapping-spec") {
    const spec = createMainActiveRecoveryMappingSpec({
      journalHistory: readActiveJournalHistory(
        options["journal-history"],
        "Active recovery mapping-spec journal history",
      ),
      runId: values.GITHUB_RUN_ID,
      runAttempt: values.GITHUB_RUN_ATTEMPT,
    });
    writeCanonicalJson(options.output, spec);
    return spec;
  }
  if (command === "active-recovery-canonical-mappings") {
    const mappings = createMainActiveRecoveryCanonicalMappings({
      journalHistory: readActiveJournalHistory(
        options["journal-history"],
        "Active recovery canonical-mappings journal history",
      ),
      mappings: readJson(
        options.mappings,
        "Active recovery bound provider mappings",
      ),
      runId: values.GITHUB_RUN_ID,
      runAttempt: values.GITHUB_RUN_ATTEMPT,
    });
    writeCanonicalJson(options.output, mappings);
    return mappings;
  }
  if (command === "active-recovery-state-spec") {
    const spec = createMainActiveRecoveryDeploymentStateSpec({
      journalHistory: readActiveJournalHistory(
        options["journal-history"],
        "Active recovery state-spec journal history",
      ),
      execution: readJson(options.execution, "Main release execution"),
      runId: values.GITHUB_RUN_ID,
      runAttempt: values.GITHUB_RUN_ATTEMPT,
    });
    writeCanonicalJson(options.output, spec);
    appendOutput(values.GITHUB_OUTPUT, "transaction_id", spec.transactionId);
    return spec;
  }
  if (command === "active-recovery-public-smokes") {
    const smokes = createMainActiveRecoveryPublicSmokes({
      execution: readJson(options.execution, "Main release execution"),
      targetResults: Object.fromEntries(
        MAIN_DEPLOYMENT_TARGETS.map((target) => [
          target,
          readJson(options[target], `Active recovery ${target} runtime smoke`),
        ]),
      ),
    });
    writeCanonicalJson(options.output, smokes);
    return smokes;
  }
  if (command === "active-mapping-spec") {
    const spec = createMainCurrentActiveAliasMappingSet({
      execution: readJson(options.execution, "Main release execution"),
      barrier: readJson(options["stage-barrier"], "Current main stage barrier"),
      journalHistory: readActiveJournalHistory(
        options["journal-history"],
        "Active mapping set journal history",
      ),
      runId: values.GITHUB_RUN_ID,
      runAttempt: values.GITHUB_RUN_ATTEMPT,
    });
    writeActiveAliasMappingSet(options.output, spec);
    return spec;
  }
  if (command === "current-release-mapping-spec") {
    const spec = createMainCurrentReleaseVerifiedAliasMappingSet({
      execution: readJson(options.execution, "Main release execution"),
      barrier: readJson(options["stage-barrier"], "Current main stage barrier"),
      runId: values.GITHUB_RUN_ID,
      runAttempt: values.GITHUB_RUN_ATTEMPT,
    });
    writeActiveAliasMappingSet(options.output, spec);
    return spec;
  }
  if (command === "active-public-smokes") {
    const smokes = createMainCurrentActivePublicSmokes({
      execution: readJson(options.execution, "Main release execution"),
      barrier: readJson(options["stage-barrier"], "Current main stage barrier"),
      targetResults: Object.fromEntries(
        MAIN_DEPLOYMENT_TARGETS.map((target) => [
          target,
          readJson(options[target], `Active ${target} smoke result`),
        ]),
      ),
      runId: values.GITHUB_RUN_ID,
      runAttempt: values.GITHUB_RUN_ATTEMPT,
    });
    writeCanonicalJson(options.output, smokes);
    return smokes;
  }
  if (command === "run-active") {
    if (!values.GITHUB_OUTPUT) {
      throw new Error("GITHUB_OUTPUT is required");
    }
    const preparedJournal = assertMainTransactionJournal(
      readJson(options["prepared-journal"], "Prepared current main journal"),
    );
    const inputs = createMainCurrentActiveInputs({
      execution: readJson(options.execution, "Main release execution"),
      barrier: readJson(options["stage-barrier"], "Current main stage barrier"),
      currentMappings: {
        schema: "vercel-main-canonical-mappings:v1",
        mappings: Object.fromEntries(
          ["governance", "reserve", "ui", "app", "legacy-app"].map((target) => [
            target,
            preparedJournal.startMappings[target],
          ]),
        ),
      },
      runId: values.GITHUB_RUN_ID,
      runAttempt: values.GITHUB_RUN_ATTEMPT,
    });
    if (JSON.stringify(preparedJournal) !== JSON.stringify(inputs.journal)) {
      throw new Error(
        "Prepared current main journal conflicts with execution and barrier",
      );
    }
    const result = reduceMainActiveTransition({
      preparedJournal,
      ...inputs.planning,
      history: activeJournalArray(
        readActiveJournalHistory(
          options["journal-history"],
          "Active journal history",
        ),
        "Active journal history",
      ),
      event: readJson(options.event, "Active transition event"),
    });
    return writeMainActiveTransition({
      values,
      result,
      outputPath: options.output,
      journalOutputPath: options["journal-output"],
    });
  }
  if (command === "plan-active-recovery") {
    const recoveryPlan = planMainActiveRecovery({
      journalHistory: activeJournalArray(
        readActiveJournalHistory(
          options["journal-history"],
          "Active recovery journal history",
        ),
        "Active recovery journal history",
      ),
      deploySha: values.DEPLOY_SHA,
      runId: values.GITHUB_RUN_ID,
      runAttempt: values.GITHUB_RUN_ATTEMPT,
      currentMappings: readJson(
        options["current-mappings"],
        "Active recovery current mappings",
      ),
    });
    writeCanonicalJson(options.output, recoveryPlan);
    appendOutput(values.GITHUB_OUTPUT, "decision", recoveryPlan.decision);
    appendOutput(values.GITHUB_OUTPUT, "reason", recoveryPlan.reason);
    appendOutput(
      values.GITHUB_OUTPUT,
      "rollback_state_targets",
      JSON.stringify(recoveryPlan.rollbackStateTargets),
    );
    appendOutput(
      values.GITHUB_OUTPUT,
      "force_release_failure",
      String(recoveryPlan.forceFailure),
    );
    return recoveryPlan;
  }
  if (command === "run-active-recovery") {
    if (!values.GITHUB_OUTPUT) {
      throw new Error("GITHUB_OUTPUT is required");
    }
    const result = reduceMainActiveRecoveryTransition({
      recoveryPlan: readJson(options.plan, "Active recovery plan"),
      history: activeJournalArray(
        readActiveJournalHistory(
          options["journal-history"],
          "Active recovery journal history",
        ),
        "Active recovery journal history",
      ),
      event: readJson(options.event, "Active recovery transition event"),
    });
    return writeMainActiveTransition({
      values,
      result,
      outputPath: options.output,
      journalOutputPath: options["journal-output"],
    });
  }
  if (command === "final-active") {
    const execution = finalActiveExecution(values, options.execution);
    const result = evaluateMainActiveFinalResults({
      execution,
      jobs: finalJobsFromEnvironment(values),
      coordinatorOutcome: values.COORDINATOR_OUTCOME,
      recoveryOutcome: values.RECOVERY_OUTCOME,
    });
    appendOutput(
      values.GITHUB_OUTPUT,
      "release_outcome",
      result.releaseOutcome,
    );
    appendOutput(values.GITHUB_OUTPUT, "evidence_kind", result.evidenceKind);
    appendOutput(
      values.GITHUB_OUTPUT,
      "fail_after_evidence",
      String(result.failAfterEvidence),
    );
    appendOutput(values.GITHUB_OUTPUT, "reason", result.reason);
    process.stdout.write(
      `Vercel active final result: ${result.releaseOutcome} (${result.reason})\n`,
    );
    return result;
  }
  if (command === "active-safe-noop-evidence") {
    const evidence = createMainActiveSafeNoopEvidence({
      plan: parseJson(values.PLAN_JSON, "Main deployment plan"),
      jobs: finalJobsFromEnvironment(values),
      coordinatorOutcome: values.COORDINATOR_OUTCOME,
      recoveryOutcome: values.RECOVERY_OUTCOME,
      verifiedDeploySha: values.DEPLOY_SHA,
      workflowDefinitionSha: values.GITHUB_WORKFLOW_SHA,
      runId: values.GITHUB_RUN_ID,
      runAttempt: values.GITHUB_RUN_ATTEMPT,
      workflowRunUrl: activeWorkflowRunUrlFromEnvironment(values),
    });
    writeCanonicalJson(options.output, evidence);
    if (!values.GITHUB_STEP_SUMMARY) {
      throw new Error("GITHUB_STEP_SUMMARY is required");
    }
    appendFileSync(
      values.GITHUB_STEP_SUMMARY,
      renderMainActiveSafeNoopEvidence(evidence),
    );
    return evidence;
  }
  if (command === "active-evidence") {
    const evidence = createMainActiveDeploymentEvidence({
      plan: parseJson(values.PLAN_JSON, "Main deployment plan"),
      journalHistory: activeJournalArray(
        readActiveJournalHistory(
          options["journal-history"],
          "Active evidence journal history",
        ),
        "Active evidence journal history",
      ),
      freshness: parseJson(
        values.ACTIVE_FRESHNESS_JSON,
        "Active freshness evidence",
      ),
      finalMappings: readJson(
        options["final-mappings"],
        "Active final mappings",
      ),
      publicSmokes: parseJson(
        values.ACTIVE_PUBLIC_SMOKES_JSON,
        "Active public smokes",
      ),
      stateProof: readJson(
        options["state-proof"],
        "Active deployment state proof",
      ),
      rollbackStateTargets: parseJson(
        values.ROLLBACK_STATE_TARGETS_JSON,
        "Active rollback-state targets",
      ),
      publicServingMutationCommands: values.PUBLIC_SERVING_MUTATION_COMMANDS,
      recoveryOutcome: values.RECOVERY_OUTCOME,
      runId: values.GITHUB_RUN_ID,
      runAttempt: values.GITHUB_RUN_ATTEMPT,
      workflowRunUrl: activeWorkflowRunUrlFromEnvironment(values),
    });
    writeCanonicalJson(options.output, evidence);
    if (!values.GITHUB_STEP_SUMMARY) {
      throw new Error("GITHUB_STEP_SUMMARY is required");
    }
    appendFileSync(
      values.GITHUB_STEP_SUMMARY,
      renderMainActiveDeploymentEvidence(evidence),
    );
    return evidence;
  }
  if (command === "active-failure-evidence") {
    const evidence = createMainActiveDeploymentFailureEvidence({
      eventHeadSha: values.EVENT_HEAD_SHA,
      verifiedDeploySha: values.DEPLOY_SHA,
      planOutput: values.PLAN_JSON,
      jobs: finalJobsFromEnvironment(values),
      workflowDefinitionSha: values.GITHUB_WORKFLOW_SHA,
      runId: values.GITHUB_RUN_ID,
      runAttempt: values.GITHUB_RUN_ATTEMPT,
      workflowRunUrl: activeWorkflowRunUrlFromEnvironment(values),
      mainOwnershipMode: mainOwnershipModeFromEnvironment(values),
      journalHistory: activeJournalArray(
        readActiveJournalHistory(
          options["journal-history"],
          "Active failure journal history",
        ),
        "Active failure journal history",
      ),
      freshness: parseJson(
        values.ACTIVE_FRESHNESS_JSON,
        "Active failure freshness evidence",
      ),
      stateProof: readJson(
        options["state-proof"],
        "Active failure deployment state proof",
      ),
      rollbackStateTargets: parseJson(
        values.ROLLBACK_STATE_TARGETS_JSON,
        "Active failure rollback-state targets",
      ),
      publicServingMutationCommands: values.PUBLIC_SERVING_MUTATION_COMMANDS,
      coordinatorOutcome: values.COORDINATOR_OUTCOME,
      recoveryOutcome: values.RECOVERY_OUTCOME,
      errorCode: values.ACTIVE_ERROR_CODE,
    });
    writeCanonicalJson(options.output, evidence);
    if (!values.GITHUB_STEP_SUMMARY) {
      throw new Error("GITHUB_STEP_SUMMARY is required");
    }
    appendFileSync(
      values.GITHUB_STEP_SUMMARY,
      renderMainActiveDeploymentFailureEvidence(evidence),
    );
    return evidence;
  }
  if (command === "validate-context") {
    validateMainWorkflowContext({
      repository: values.GITHUB_REPOSITORY,
      eventName: values.GITHUB_EVENT_NAME,
      workflowRef: values.GITHUB_WORKFLOW_REF,
      workflowSha: values.GITHUB_WORKFLOW_SHA,
      deploySha: values.DEPLOY_SHA,
    });
    return;
  }
  if (command === "validate-source") {
    validateMainDeploymentSource({
      repoRoot: values.SOURCE_PATH,
      deploySha: values.DEPLOY_SHA,
      workflowSha: values.GITHUB_WORKFLOW_SHA,
    });
    return;
  }
  if (command === "create-spec") {
    const scope = options.scope;
    if (!["main", "legacy"].includes(scope)) {
      throw new Error("create-spec requires scope main or legacy");
    }
    writeCanonicalJson(
      options.output,
      scope === "main"
        ? createMainProtectedAliasSpec({
            projectIds: projectIdsFromEnvironment(values),
          })
        : createMainLegacyAliasSpec({
            projectIds: projectIdsFromEnvironment(values),
          }),
    );
    return;
  }
  if (command === "evidence") {
    const evidence = createMainDeploymentEvidence({
      plan: parseJson(values.PLAN_JSON, "Main deployment plan"),
      stages: Object.fromEntries(
        MAIN_ORDINARY_TARGETS.map((target) => [
          target,
          evidenceStageFromEnvironment(values, target),
        ]),
      ),
      app: evidenceAppFromEnvironment(values),
      coordinator: {
        outcome: values.COORDINATOR_OUTCOME,
        transactionId: values.TRANSACTION_ID || null,
        artifactName: values.JOURNAL_ARTIFACT_NAME || null,
        artifactId: values.JOURNAL_ARTIFACT_ID || null,
        totalDurationMs: values.COORDINATOR_TOTAL_DURATION_MS,
      },
      recovery: { outcome: values.RECOVERY_OUTCOME },
      runId: values.GITHUB_RUN_ID,
      runAttempt: values.GITHUB_RUN_ATTEMPT,
      workflowRunUrl: createMainWorkflowRunUrl({
        serverUrl: values.GITHUB_SERVER_URL,
        repository: values.GITHUB_REPOSITORY,
        runId: values.GITHUB_RUN_ID,
      }),
    });
    writeCanonicalJson(options.output, evidence);
    if (!values.GITHUB_STEP_SUMMARY) {
      throw new Error("GITHUB_STEP_SUMMARY is required");
    }
    appendFileSync(
      values.GITHUB_STEP_SUMMARY,
      renderMainDeploymentEvidence(evidence),
    );
    return;
  }
  if (command === "failure-evidence") {
    const evidence = createMainDeploymentFailureEvidence({
      eventHeadSha: values.EVENT_HEAD_SHA,
      verifiedDeploySha: values.DEPLOY_SHA,
      planOutput: values.PLAN_JSON,
      jobs: finalJobsFromEnvironment(values),
      workflowDefinitionSha: values.GITHUB_WORKFLOW_SHA,
      runId: values.GITHUB_RUN_ID,
      runAttempt: values.GITHUB_RUN_ATTEMPT,
      workflowRunUrl: createMainWorkflowRunUrl({
        serverUrl: values.GITHUB_SERVER_URL,
        repository: values.GITHUB_REPOSITORY,
        runId: values.GITHUB_RUN_ID,
      }),
    });
    writeCanonicalJson(options.output, evidence);
    if (!values.GITHUB_STEP_SUMMARY) {
      throw new Error("GITHUB_STEP_SUMMARY is required");
    }
    appendFileSync(
      values.GITHUB_STEP_SUMMARY,
      renderMainDeploymentFailureEvidence(evidence),
    );
    return;
  }
  if (command === "plan") {
    const result = createMainDeploymentPlan({
      mode: values.VERCEL_MAIN_MODE,
      mainOwnershipMode: mainOwnershipModeFromEnvironment(values),
      deploySha: values.DEPLOY_SHA,
      projectIds: projectIdsFromEnvironment(values),
      planningSnapshot: readJson(
        options["planning-snapshot"],
        "Main planning snapshot",
      ),
      legacySnapshot: readJson(
        options["legacy-snapshot"],
        "Legacy app snapshot",
      ),
      rollbackOnlyTargets: MAIN_DEPLOYMENT_TARGETS,
      upstream: {
        runId: values.UPSTREAM_RUN_ID,
        runAttempt: values.UPSTREAM_RUN_ATTEMPT,
        runUrl: values.UPSTREAM_RUN_URL,
        buildAndTestJobUrl: values.BUILD_AND_TEST_JOB_URL,
      },
      repoRoot: values.SOURCE_PATH,
    });
    writeCanonicalJson(options.output, result);
    appendOutput(values.GITHUB_OUTPUT, "plan", JSON.stringify(result));
    appendOutput(
      values.GITHUB_OUTPUT,
      "targets",
      JSON.stringify(result.planning.stagedTargets),
    );
    return;
  }
  if (command === "freshness") {
    const result = classifyRemoteMainFreshness({
      deploySha: values.DEPLOY_SHA,
      remoteSha: readRemoteMainSha({}),
    });
    appendOutput(values.GITHUB_OUTPUT, "status", result.status);
    return;
  }
  if (command === "journal-name") {
    const identity = createMainJournalArtifactIdentity({
      deploySha: values.DEPLOY_SHA,
      runId: values.GITHUB_RUN_ID,
      runAttempt: values.GITHUB_RUN_ATTEMPT,
    });
    appendOutput(values.GITHUB_OUTPUT, "artifact_name", identity.artifactName);
    appendOutput(
      values.GITHUB_OUTPUT,
      "transaction_id",
      identity.transactionId,
    );
    return;
  }
  if (command === "revalidate-prior") {
    assertProtectedSnapshotMatchesPlan({
      plan: parseJson(values.PLAN_JSON, "Main deployment plan"),
      planningSnapshot: readJson(
        options["planning-snapshot"],
        "Current main planning snapshot",
      ),
      legacySnapshot: readJson(
        options["legacy-snapshot"],
        "Current legacy snapshot",
      ),
    });
    return;
  }
  if (command === "app-build-proof") {
    const proof = createMainAppBuildProof({
      intent: readJson(options.intent, "Current App candidate intent"),
    });
    writeCanonicalJson(options.output, proof);
    appendOutput(values.GITHUB_OUTPUT, "proof", JSON.stringify(proof));
    return proof;
  }
  if (command === "app-candidate-expectation") {
    writeCanonicalJson(
      options.output,
      createMainAppCandidateExpectation({
        journal: readJson(options.journal, "Prepared transaction journal"),
        projectId: values.VERCEL_PROJECT_ID_APP,
      }),
    );
    return;
  }
  if (command === "stage-result") {
    const result = createMainStageResult({
      target: values.LOGICAL_TARGET,
      plan: parseJson(values.PLAN_JSON, "Main deployment plan"),
      state: readJson(options.state, "Staged deployment state"),
      runId: values.GITHUB_RUN_ID,
      runAttempt: values.GITHUB_RUN_ATTEMPT,
      smokePassed: values.IMMUTABLE_SMOKE_PASSED === "true",
      protectedMappingsUnchanged:
        values.PROTECTED_MAPPINGS_UNCHANGED === "true",
    });
    writeCanonicalJson(options.output, result);
    appendOutput(values.GITHUB_OUTPUT, "result", JSON.stringify(result));
    return;
  }
  if (command === "validate-stages") {
    const result = validateMainStageJobs({
      plan: parseJson(values.PLAN_JSON, "Main deployment plan"),
      jobs: stageJobsFromEnvironment(values),
      runId: values.GITHUB_RUN_ID,
      runAttempt: values.GITHUB_RUN_ATTEMPT,
    });
    appendOutput(values.GITHUB_OUTPUT, "outcome", result.outcome);
    appendOutput(
      values.GITHUB_OUTPUT,
      "active_target_count",
      String(result.activeTargetCount),
    );
    return;
  }
  if (command === "prepare-journal") {
    const journal = createPreparedMainJournal({
      plan: parseJson(values.PLAN_JSON, "Main deployment plan"),
      stageJobs: stageJobsFromEnvironment(values),
      appBuildProof: appProofFromEnvironment(values),
      runId: values.GITHUB_RUN_ID,
      runAttempt: values.GITHUB_RUN_ATTEMPT,
    });
    writeCanonicalJson(options.output, journal);
    appendOutput(
      values.GITHUB_OUTPUT,
      "artifact_name",
      mainTransactionJournalArtifactName(journal),
    );
    appendOutput(values.GITHUB_OUTPUT, "transaction_id", journal.transactionId);
    return;
  }
  if (command === "run-shadow") {
    const journalBytes = readFileSync(options.journal, "utf8");
    const result = await runMainShadowTransaction({
      plan: parseJson(values.PLAN_JSON, "Main deployment plan"),
      stageJobs: stageJobsFromEnvironment(values),
      appBuildProof: appProofFromEnvironment(values),
      runId: values.GITHUB_RUN_ID,
      runAttempt: values.GITHUB_RUN_ATTEMPT,
      journalBytes,
      artifactName: values.JOURNAL_ARTIFACT_NAME,
      artifactId: values.JOURNAL_ARTIFACT_ID,
    });
    appendOutput(values.GITHUB_OUTPUT, "outcome", result.outcome);
    return;
  }
  if (command === "recover-shadow") {
    const plan = assertMainDeploymentHandoff(
      parseJson(values.PLAN_JSON, "Main deployment plan"),
    );
    const result = recoverMainShadowTransaction({
      journal: readJson(options.journal, "Prepared transaction journal"),
      expectedIdentity: {
        repository: MAIN_TRANSACTION_REPOSITORY,
        deploySha: plan.deploySha,
        runId: values.GITHUB_RUN_ID,
        runAttempt: values.GITHUB_RUN_ATTEMPT,
      },
    });
    appendOutput(values.GITHUB_OUTPUT, "outcome", result.outcome);
    return;
  }
  if (command === "final") {
    const result = assertMainFinalResults({
      plan: parseJson(values.PLAN_JSON, "Main deployment plan"),
      jobs: finalJobsFromEnvironment(values),
      coordinatorOutcome: values.COORDINATOR_OUTCOME,
      recoveryOutcome: values.RECOVERY_OUTCOME,
    });
    process.stdout.write(
      `Validated Vercel main deployment outcome: ${result.outcome}\n`,
    );
    return;
  }
  throw new Error("Main deployment command is missing or unsupported");
}

function isCliEntrypoint() {
  return (
    process.argv[1] !== undefined &&
    fileURLToPath(import.meta.url) === resolve(process.argv[1])
  );
}

if (isCliEntrypoint()) {
  await runMainDeploymentCli({});
}
