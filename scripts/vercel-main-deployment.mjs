#!/usr/bin/env node

import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
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
  MAIN_ACTIVE_HISTORY_SCHEMA,
  createMainActiveJournalReceipt,
  createMainActiveRecoveryTransitionEvent,
  createMainActiveTransitionEvent,
  loadMainActiveJournalHistory,
  reduceMainActiveRecoveryTransition,
  reduceMainActiveTransition,
} from "./vercel-main-active-controller.mjs";
import {
  ACTIVE_ALIAS_MAPPING_SET_SCHEMA,
  ACTIVE_DEPLOYMENT_STATE_SPEC_SCHEMA,
  assertActiveAliasMappingSet,
  assertAppTransactionCandidateOutput,
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
import { generateVercelDeploymentId } from "./vercel-prebuilt.mjs";

export const MAIN_DEPLOYMENT_SCHEMA = "vercel-main-deployment:v1";
export const MAIN_STAGE_SCHEMA = "vercel-main-stage:v1";
export const MAIN_EVIDENCE_SCHEMA = "vercel-main-evidence:v1";
export const MAIN_FAILURE_EVIDENCE_SCHEMA = "vercel-main-failure-evidence:v1";
export const MAIN_ACTIVE_EVIDENCE_SCHEMA = "vercel-main-active-evidence:v1";
export const MAIN_ACTIVE_FAILURE_EVIDENCE_SCHEMA =
  "vercel-main-active-failure-evidence:v1";
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
export const MAIN_DURABLE_LEGACY_RECOVERY_ALIASES = Object.freeze([
  LEGACY_ALIAS,
]);
export const MAIN_ACTIVE_MAX_RECOVERY_TRANSITIONS =
  MAIN_ORDINARY_TARGETS.length +
  MAIN_TARGET_CONTRACTS.app.aliases.length +
  MAIN_DURABLE_LEGACY_RECOVERY_ALIASES.length;
const MAX_JSON_BYTES = 256 * 1024;
const APP_BUILD_PROOF_SCHEMA = "vercel-main-app-build:v1";
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
    "app-candidate-matches",
    "app-deployment",
    "authorization",
    "current-mappings",
    "freshness",
    "output",
    "receipt",
  ]),
  "active-command-descriptor": Object.freeze(["authorization", "output"]),
  "active-app-candidate-matches-none": Object.freeze(["output"]),
  "active-app-candidate-matches-one": Object.freeze(["candidate", "output"]),
  "active-app-deployment": Object.freeze(["state", "output"]),
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
  "active-journal-history": Object.freeze(["artifacts", "output"]),
  "active-journal-identity": Object.freeze([]),
  "active-journal-receipt": Object.freeze([
    "artifact-id",
    "artifact-name",
    "journal",
    "output",
  ]),
  "active-freshness": Object.freeze(["output"]),
  "active-mapping-spec": Object.freeze(["journal-history", "output"]),
  "active-public-smokes": Object.freeze([
    "app",
    "governance",
    "output",
    "reserve",
    "ui",
  ]),
  "active-public-smoke-target": Object.freeze([
    "output",
    "served-sha",
    "status",
    "target",
  ]),
  "active-state-spec": Object.freeze(["journal-history", "output"]),
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
  "app-build-proof": Object.freeze(["output"]),
  "app-candidate-expectation": Object.freeze(["journal", "output"]),
  "create-spec": Object.freeze(["output", "scope"]),
  evidence: Object.freeze(["output"]),
  "failure-evidence": Object.freeze(["output"]),
  final: Object.freeze([]),
  freshness: Object.freeze([]),
  "journal-name": Object.freeze([]),
  "final-active": Object.freeze([]),
  plan: Object.freeze(["legacy-snapshot", "output", "planning-snapshot"]),
  "plan-active-recovery": Object.freeze([
    "app-candidate-matches",
    "current-mappings",
    "journal-history",
    "output",
  ]),
  "prepare-journal": Object.freeze(["output"]),
  "recover-shadow": Object.freeze(["journal"]),
  "revalidate-prior": Object.freeze(["legacy-snapshot", "planning-snapshot"]),
  "run-active": Object.freeze([
    "event",
    "journal-history",
    "journal-output",
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

function readJson(path, label) {
  const raw = readFileSync(path);
  if (raw.byteLength > MAX_JSON_BYTES) {
    throw new Error(`${label} exceeds its size limit`);
  }
  try {
    return JSON.parse(raw.toString("utf8"));
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
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

export function createMainAppBuildProof({
  deploySha,
  runId,
  runAttempt,
  projectId,
  nextDeploymentId,
}) {
  const identity = {
    repository: MAIN_TRANSACTION_REPOSITORY,
    deploySha: requireSha(deploySha),
    runId: requirePositiveId(runId, "App run ID"),
    runAttempt: requirePositiveId(runAttempt, "App run attempt"),
  };
  const transactionId = createMainTransactionId(identity);
  const expectedNextDeploymentId = generateVercelDeploymentId({
    target: "app",
    commitSha: identity.deploySha,
    runId: identity.runId,
    runAttempt: identity.runAttempt,
  });
  if (nextDeploymentId !== expectedNextDeploymentId) {
    throw new Error(
      "App custom Next deployment ID is not deterministic for this run",
    );
  }
  return {
    schema: APP_BUILD_PROOF_SCHEMA,
    target: "app",
    deploySha: identity.deploySha,
    runId: identity.runId,
    runAttempt: identity.runAttempt,
    transactionId,
    projectId: requireString(projectId, "App project ID"),
    projectName: "app.mento.org",
    customEnvironmentSlug: "v3",
    vercelEnv: "preview",
    vercelTargetEnv: "v3",
    nextPublicVercelEnv: "preview",
    sentryAuthToken: "",
    nextDeploymentId: expectedNextDeploymentId,
    deployReachable: false,
    metadata: createMainAppTransactionMetadata({
      ...identity,
      transactionId,
      nextDeploymentId,
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
  return {
    projectId: requireString(projectId, "App project ID"),
    projectName: "app.mento.org",
    deploySha: canonical.deploySha,
    runId: canonical.runId,
    runAttempt: canonical.runAttempt,
    transactionId: canonical.transactionId,
    customEnvironmentSlug: "v3",
    nextDeploymentId: generateVercelDeploymentId({
      target: "app",
      commitSha: canonical.deploySha,
      runId: canonical.runId,
      runAttempt: canonical.runAttempt,
    }),
  };
}

function assertAppBuildProof(
  proof,
  { deploySha, runId, runAttempt, projectId },
) {
  const expected = createMainAppBuildProof({
    deploySha,
    runId,
    runAttempt,
    projectId,
    nextDeploymentId: proof?.nextDeploymentId,
  });
  if (JSON.stringify(expected) !== JSON.stringify(proof)) {
    throw new Error("App v3 build proof is invalid");
  }
  return proof;
}

export function createMainTransactionInputs({
  plan,
  stageJobs,
  appBuildProof = null,
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
  let appCandidate = null;
  if (handoff.planning.stagedTargets.includes("app")) {
    assertAppBuildProof(appBuildProof, {
      deploySha: handoff.deploySha,
      runId: identity.runId,
      runAttempt: identity.runAttempt,
      projectId: handoff.projectIds.app,
    });
    appCandidate = {
      deploymentId: null,
      deploymentUrl: null,
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
  } else if (appBuildProof !== null) {
    throw new Error("Unselected app returned a build proof");
  }
  const candidates = {
    app: appCandidate,
    governance: stages.governance?.candidate ?? null,
    reserve: stages.reserve?.candidate ?? null,
    ui: stages.ui?.candidate ?? null,
  };
  return { identity, prior, candidates };
}

export function createMainActiveTransactionInputs({
  plan,
  stageJobs,
  appBuildProof = null,
  runId,
  runAttempt,
}) {
  const handoff = assertMainDeploymentHandoff(plan);
  const inputs = createMainTransactionInputs({
    plan: handoff,
    stageJobs,
    appBuildProof,
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
    prior: inputs.prior,
    candidates,
    stagedCandidates: inputs.candidates,
    projectIds: handoff.projectIds,
    planning,
  };
}

export function createPreparedMainActiveJournal(options) {
  const inputs = createMainActiveTransactionInputs(options);
  return createPreparedMainTransactionJournal({
    ...inputs.identity,
    mode: MAIN_ACTIVE_DEPLOYMENT_MODE,
    prior: inputs.prior,
    candidates: inputs.candidates,
  });
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
            JSON.stringify(expected) !==
              JSON.stringify(stages[target]?.candidate)))
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
  runId,
  runAttempt,
  journalHistory = [],
  adapters,
}) {
  const inputs = createMainActiveTransactionInputs({
    plan,
    stageJobs,
    appBuildProof,
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
    prior: inputs.prior,
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
      prior: inputs.prior,
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

export function planMainActiveRecovery({
  journalHistory,
  deploySha,
  runId,
  runAttempt,
  currentMappings,
  appCandidateMatches = [],
}) {
  const history = assertMainActiveJournalHistory({
    journals: journalHistory,
    deploySha,
    runId,
    runAttempt,
  });
  return planMainTransactionRecovery({
    journal: history.at(-1),
    currentMappings,
    appCandidateMatches,
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
    prior: inputs.prior,
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
    prior: inputs.prior,
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
      prior: inputs.prior,
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
    const expectedNextDeploymentId = generateVercelDeploymentId({
      target: "app",
      commitSha: handoff.deploySha,
      runId: expectedRunId,
      runAttempt: expectedRunAttempt,
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

function canonicalPublicSmokes(value, planning, deploySha) {
  assertExactKeys(value, MAIN_DEPLOYMENT_TARGETS, "Active public smokes");
  return Object.fromEntries(
    MAIN_DEPLOYMENT_TARGETS.map((target) => {
      const entry = value[target];
      assertExactKeys(
        entry,
        ["publicUrl", "servedSha", "status"],
        `${target} public smoke`,
      );
      const active = planning.activeTargets.includes(target);
      const expected = active
        ? {
            publicUrl: ACTIVE_PUBLIC_URLS[target],
            servedSha: deploySha,
            status: "passed",
          }
        : {
            publicUrl: ACTIVE_PUBLIC_URLS[target],
            servedSha: null,
            status: "not-required",
          };
      if (JSON.stringify(entry) !== JSON.stringify(expected)) {
        throw new Error(`${target} public smoke evidence is invalid`);
      }
      return [target, expected];
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
        ["publicUrl", "servedSha", "status"],
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
      return [
        target,
        {
          publicUrl: entry.publicUrl,
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
    if (
      (projectIds !== null && project.projectId !== projectIds[target]) ||
      (expectedDeploymentIds !== null &&
        expectedDeploymentIds[target] !== undefined &&
        project.expectedDeploymentId !== expectedDeploymentIds[target])
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
  plan,
  jobs,
  coordinatorOutcome,
  recoveryOutcome,
}) {
  const handoff = assertMainDeploymentHandoff(plan);
  if (handoff.mode !== MAIN_ACTIVE_DEPLOYMENT_MODE) {
    throw new Error("Active final results require an active plan");
  }
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
    const expected = handoff.planning.stagedTargets.includes(target)
      ? "success"
      : "skipped";
    if (canonicalJobs[jobName] !== expected) {
      return result("failure", `stage-${target}-invalid`);
    }
  }

  if (
    ["recovered", "manual-intervention", "recovery-failed"].includes(recovery)
  ) {
    return result("failure", `activation-${recovery}`);
  }
  if (
    coordinator === "active-committed" &&
    canonicalJobs.coordinator === "success" &&
    canonicalJobs.recovery === "success" &&
    recovery === "not-required"
  ) {
    return result("success", "active-committed");
  }
  if (
    ((coordinator === "shadow-prepared" &&
      handoff.planning.stagedTargets.length > 0 &&
      handoff.planning.activeTargets.length === 0) ||
      ["no-target", "superseded-before-journal"].includes(coordinator)) &&
    canonicalJobs.coordinator === "success" &&
    canonicalJobs.recovery === "success" &&
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

function appVerificationDeployment(path) {
  const state = readJson(path, "Active App deployment state");
  if (
    isPlainObject(state) &&
    isPlainObject(state.candidate) &&
    (state.commandOutcome === "success" || state.commandOutcome === "unknown")
  ) {
    const candidate = assertAppTransactionCandidateOutput(state.candidate);
    return {
      deploymentId: candidate.deploymentId,
      deploymentUrl: candidate.deploymentUrl,
      readyState: "READY",
    };
  }
  assertCanonicalOutput(state);
  if (state.readyState !== "READY") {
    throw new Error("Active App deployment is not ready");
  }
  return {
    deploymentId: state.deploymentId,
    deploymentUrl: state.deploymentUrl,
    readyState: "READY",
  };
}

function appCandidateMatches(path) {
  const value = readJson(path, "Active App candidate");
  const candidate = assertAppTransactionCandidateOutput(
    isPlainObject(value) && isPlainObject(value.candidate)
      ? value.candidate
      : value,
  );
  return [candidate];
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
      appCandidateMatches: appVerification
        ? readJson(
            options["app-candidate-matches"],
            "Active App candidate matches",
          )
        : [],
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
    ["servedSha", "status"],
    `Active ${target} smoke result`,
  );
  if (
    value.status !== (active ? "passed" : "not-required") ||
    value.servedSha !== (active ? deploySha : null)
  ) {
    throw new Error(`Active ${target} smoke result is inconsistent`);
  }
  return { status: value.status, servedSha: value.servedSha };
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
  if (command === "active-app-candidate-matches-none") {
    writeCanonicalJson(options.output, []);
    return [];
  }
  if (command === "active-app-candidate-matches-one") {
    const matches = appCandidateMatches(options.candidate);
    writeCanonicalJson(options.output, matches);
    return matches;
  }
  if (command === "active-app-deployment") {
    const deployment = appVerificationDeployment(options.state);
    writeCanonicalJson(options.output, deployment);
    return deployment;
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
    const spec = createMainActiveDeploymentStateSpec({
      plan: parseJson(values.PLAN_JSON, "Main deployment plan"),
      journalHistory: readJson(
        options["journal-history"],
        "Active state spec journal history",
      ),
      stageJobs: stageJobsFromEnvironment(values),
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
  if (command === "active-mapping-spec") {
    const spec = createMainActiveAliasMappingSet({
      plan: parseJson(values.PLAN_JSON, "Main deployment plan"),
      journalHistory: readJson(
        options["journal-history"],
        "Active mapping set journal history",
      ),
      runId: values.GITHUB_RUN_ID,
      runAttempt: values.GITHUB_RUN_ATTEMPT,
    });
    writeActiveAliasMappingSet(options.output, spec);
    return spec;
  }
  if (command === "active-public-smokes") {
    const smokes = createMainActivePublicSmokes({
      plan: parseJson(values.PLAN_JSON, "Main deployment plan"),
      targetResults: Object.fromEntries(
        MAIN_DEPLOYMENT_TARGETS.map((target) => [
          target,
          readJson(options[target], `Active ${target} smoke result`),
        ]),
      ),
    });
    writeCanonicalJson(options.output, smokes);
    return smokes;
  }
  if (command === "active-public-smoke-target") {
    const target = requireString(options.target, "Active smoke target");
    if (!MAIN_DEPLOYMENT_TARGETS.includes(target)) {
      throw new Error("Active smoke target is unsupported");
    }
    const status = requireString(options.status, "Active smoke status");
    const servedSha =
      options["served-sha"] === "none"
        ? null
        : requireSha(options["served-sha"], "Active smoke served SHA");
    if (!["passed", "not-required"].includes(status)) {
      throw new Error("Active smoke status is malformed");
    }
    const result = { status, servedSha };
    writeCanonicalJson(options.output, result);
    return result;
  }
  if (command === "run-active") {
    if (!values.GITHUB_OUTPUT) {
      throw new Error("GITHUB_OUTPUT is required");
    }
    const inputs = createMainActiveTransactionInputs({
      plan: parseJson(values.PLAN_JSON, "Main deployment plan"),
      stageJobs: stageJobsFromEnvironment(values),
      appBuildProof: appProofFromEnvironment(values),
      runId: values.GITHUB_RUN_ID,
      runAttempt: values.GITHUB_RUN_ATTEMPT,
    });
    const preparedJournal = createPreparedMainTransactionJournal({
      ...inputs.identity,
      mode: MAIN_ACTIVE_DEPLOYMENT_MODE,
      prior: inputs.prior,
      candidates: inputs.candidates,
    });
    const result = reduceMainActiveTransition({
      preparedJournal,
      activeTargets: inputs.planning.activeTargets,
      shadowTargets: inputs.planning.shadowTargets,
      stagedCandidates: inputs.stagedCandidates,
      mainOwnershipMode: inputs.planning.mainOwnershipMode,
      projectIds: inputs.projectIds,
      history: activeJournalArray(
        readJson(options["journal-history"], "Active journal history"),
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
        readJson(options["journal-history"], "Active recovery journal history"),
        "Active recovery journal history",
      ),
      deploySha: values.DEPLOY_SHA,
      runId: values.GITHUB_RUN_ID,
      runAttempt: values.GITHUB_RUN_ATTEMPT,
      currentMappings: readJson(
        options["current-mappings"],
        "Active recovery current mappings",
      ),
      appCandidateMatches: readJson(
        options["app-candidate-matches"],
        "Active recovery App candidate matches",
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
        readJson(options["journal-history"], "Active recovery journal history"),
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
    const result = evaluateMainActiveFinalResults({
      plan: parseJson(values.PLAN_JSON, "Main deployment plan"),
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
  if (command === "active-evidence") {
    const evidence = createMainActiveDeploymentEvidence({
      plan: parseJson(values.PLAN_JSON, "Main deployment plan"),
      journalHistory: activeJournalArray(
        readJson(options["journal-history"], "Active evidence journal history"),
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
        readJson(options["journal-history"], "Active failure journal history"),
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
      deploySha: values.DEPLOY_SHA,
      runId: values.GITHUB_RUN_ID,
      runAttempt: values.GITHUB_RUN_ATTEMPT,
      projectId: values.VERCEL_PROJECT_ID_APP,
      nextDeploymentId: values.MENTO_NEXT_DEPLOYMENT_ID,
    });
    writeCanonicalJson(options.output, proof);
    appendOutput(values.GITHUB_OUTPUT, "proof", JSON.stringify(proof));
    return;
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
