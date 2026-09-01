#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import process from "node:process";

import { planVercelDeployments } from "./plan-vercel-deployments.mjs";
import {
  canonicalizeDeploymentUrl,
  canonicalizeHostname,
} from "./vercel-deployment-url.mjs";
import {
  MAIN_OWNERSHIP_MODES,
  PREVIEW_TARGET_CONFIG,
} from "./vercel-preview-targets.mjs";
import {
  assertOnlyExpectedProductionGeneratedAliases,
  PRODUCTION_GENERATED_ALIAS_TOPOLOGY_MODES,
} from "./vercel-production-generated-aliases.mjs";

const SHA_PATTERN = /^[a-f0-9]{40}$/;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9._-]+$/;
const PLANNER_OUTPUT_KEYS = Object.freeze([
  "base",
  "deployments",
  "head",
  "reason",
]);
const KNOWN_PLANNER_REASONS = new Set([
  "affected-packages",
  "diff-failed",
  "empty-diff",
  "global-build-input",
  "invalid-commits",
  "non-runtime-only",
  "turbo-planning-failed",
]);
const FAIL_CLOSED_PLANNER_REASONS = new Set([
  "diff-failed",
  "empty-diff",
  "invalid-commits",
  "turbo-planning-failed",
]);
const RANGE_REASONS = new Set([
  ...KNOWN_PLANNER_REASONS,
  "planner-affected-set-unknown",
  "planner-execution-failed",
  "planner-output-malformed",
  "served-sha-already-current",
  "shadow-first-parent-unresolved",
]);
const SELECTION_REASONS = new Set([
  ...KNOWN_PLANNER_REASONS,
  "planner-affected-set-unknown",
  "planner-execution-failed",
  "planner-output-malformed",
  "served-git-metadata-conflicting",
  "served-git-metadata-malformed",
  "served-git-metadata-missing",
  "served-git-metadata-wrong-source",
  "served-git-sha-not-ancestor",
  "served-git-sha-unresolvable",
  "served-mapping-rollback-only",
  "shadow-first-parent-unresolved",
  "shadow-native-already-current",
]);

export const MAIN_DEPLOYMENT_TARGETS = Object.freeze([
  "app",
  "governance",
  "reserve",
  "ui",
]);

export const MAIN_DEPLOYMENT_MODES = Object.freeze({
  ACTIVE: "active",
  SHADOW: "shadow",
});

export const CURRENT_MAIN_OWNERSHIP_MODE = Object.freeze(
  Object.fromEntries(
    MAIN_DEPLOYMENT_TARGETS.map((target) => [
      target,
      PREVIEW_TARGET_CONFIG[target].mainOwnershipMode,
    ]),
  ),
);

export const MAIN_TARGET_CONTRACTS = Object.freeze({
  app: Object.freeze({
    aliases: Object.freeze(["app.mento.org"]),
    customEnvironmentSlug: null,
    projectName: "app.mento.org",
    target: "production",
  }),
  governance: Object.freeze({
    aliases: Object.freeze(["governance.mento.org"]),
    customEnvironmentSlug: null,
    projectName: "governance.mento.org",
    target: "production",
  }),
  reserve: Object.freeze({
    aliases: Object.freeze(["reserve.mento.org"]),
    customEnvironmentSlug: null,
    projectName: "reserve.mento.org",
    target: "production",
  }),
  ui: Object.freeze({
    aliases: Object.freeze(["ui.mento.org"]),
    customEnvironmentSlug: null,
    projectName: "ui.mento.org",
    target: "production",
  }),
});

// TRANSITION-V3-PRIOR
// `app.mento.org` is still assigned to the retiring `v3` custom environment
// until the dashboard domain move, so the deployment it served before this
// release is still v3-shaped and still carries the custom environment's
// generated alias. Prior-facing validation accepts that exact shape for App
// only. Candidates, staged deployments, promote verification, and final
// mappings stay production-shaped. Delete this block, its call sites, and the
// bridge alias slot in the tighten PR.
export const TRANSITIONAL_APP_PRIOR_ENVIRONMENT = Object.freeze({
  target: null,
  customEnvironmentSlug: "v3",
});
export const TRANSITIONAL_APP_PRIOR_GENERATED_ALIAS =
  "appmentoorg-env-v3-mentolabs.vercel.app";

// TRANSITION-V3-PRIOR
export function isTransitionalAppPriorEnvironment(target, environment) {
  return (
    target === "app" &&
    environment?.target === TRANSITIONAL_APP_PRIOR_ENVIRONMENT.target &&
    environment?.customEnvironmentSlug ===
      TRANSITIONAL_APP_PRIOR_ENVIRONMENT.customEnvironmentSlug
  );
}

// TRANSITION-V3-PRIOR
// True when `environment` is an acceptable shape for the deployment a reviewed
// alias served before this release. Never call this for a candidate.
export function acceptsPriorEnvironment(target, environment) {
  const contract = MAIN_TARGET_CONTRACTS[target];
  if (contract === undefined) return false;
  if (
    environment?.target === contract.target &&
    environment?.customEnvironmentSlug === contract.customEnvironmentSlug
  ) {
    return true;
  }
  return isTransitionalAppPriorEnvironment(target, environment);
}

const PRIOR_STATE_REQUIRED_KEYS = Object.freeze([
  "alias",
  "customEnvironmentSlug",
  "deploymentId",
  "deploymentUrl",
  "projectId",
  "projectName",
  "readyState",
  "target",
]);
const PRIOR_STATE_ALLOWED_KEYS = new Set([
  ...PRIOR_STATE_REQUIRED_KEYS,
  "aliases",
  "creatorUsername",
  "git",
]);
const PLANNING_GIT_KEYS = Object.freeze(["org", "ref", "repo", "sha"]);

export class MainActivationStateError extends Error {
  constructor(target, code) {
    super(
      target === null
        ? `Main activation state is ambiguous (${code})`
        : `Main activation state is ambiguous for ${target} (${code})`,
    );
    this.name = "MainActivationStateError";
    this.target = target;
    this.code = code;
  }
}

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function exactKeys(value, expected) {
  if (!isPlainObject(value)) return false;
  return (
    JSON.stringify(Object.keys(value).toSorted()) ===
    JSON.stringify([...expected].toSorted())
  );
}

function containsOnlyKeys(value, allowed) {
  return (
    isPlainObject(value) && Object.keys(value).every((key) => allowed.has(key))
  );
}

function requireSha(value, label) {
  if (typeof value !== "string" || !SHA_PATTERN.test(value.toLowerCase())) {
    throw new Error(`${label} must be an immutable 40-hex SHA`);
  }
  return value.toLowerCase();
}

function requireIdentifier(value, label) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    !IDENTIFIER_PATTERN.test(value)
  ) {
    throw new Error(`${label} is missing or malformed`);
  }
  return value;
}

function requireMode(value) {
  if (!Object.values(MAIN_DEPLOYMENT_MODES).includes(value)) {
    throw new Error("Main deployment mode must be shadow or active");
  }
  return value;
}

function activationError(target, code) {
  throw new MainActivationStateError(target, code);
}

function assertTargetObject(value, label) {
  if (
    !isPlainObject(value) ||
    JSON.stringify(Object.keys(value).toSorted()) !==
      JSON.stringify([...MAIN_DEPLOYMENT_TARGETS].toSorted())
  ) {
    throw new Error(`${label} must contain exactly the four main targets`);
  }
}

export function partitionMainOwnership({ mode, mainOwnershipMode }) {
  const canonicalMode = requireMode(mode);
  assertTargetObject(mainOwnershipMode, "Main ownership mode");
  const canonicalMap = {};
  for (const target of MAIN_DEPLOYMENT_TARGETS) {
    const ownershipMode = mainOwnershipMode[target];
    if (!Object.values(MAIN_OWNERSHIP_MODES).includes(ownershipMode)) {
      throw new Error(`${target} main ownership mode must be github or shadow`);
    }
    canonicalMap[target] = ownershipMode;
  }
  const githubTargets = MAIN_DEPLOYMENT_TARGETS.filter(
    (target) => canonicalMap[target] === MAIN_OWNERSHIP_MODES.GITHUB,
  );
  const shadowTargets = MAIN_DEPLOYMENT_TARGETS.filter(
    (target) => canonicalMap[target] === MAIN_OWNERSHIP_MODES.SHADOW,
  );
  if (
    canonicalMode === MAIN_DEPLOYMENT_MODES.SHADOW &&
    githubTargets.length > 0
  ) {
    throw new Error(
      "Global shadow mode requires all four targets to use shadow ownership",
    );
  }
  return {
    mainOwnershipMode: canonicalMap,
    githubTargets,
    shadowTargets,
  };
}

function canonicalizeReviewedAliases(aliases, target) {
  if (!Array.isArray(aliases)) {
    activationError(target, "alias-set-ambiguous");
  }
  let normalized;
  try {
    normalized = aliases.map((alias) => canonicalizeHostname(alias));
  } catch {
    activationError(target, "alias-set-ambiguous");
  }
  if (
    new Set(normalized).size !== normalized.length ||
    JSON.stringify(normalized.toSorted()) !==
      JSON.stringify([...MAIN_TARGET_CONTRACTS[target].aliases].toSorted())
  ) {
    activationError(target, "alias-set-ambiguous");
  }
  return normalized;
}

function canonicalizeOptionalDeploymentAliases(
  value,
  target,
  creatorUsername,
  environment,
) {
  if (value === undefined) return null;
  if (!Array.isArray(value)) {
    activationError(target, "alias-set-ambiguous");
  }
  let aliases;
  try {
    aliases = value.map((alias) => canonicalizeHostname(alias));
  } catch {
    activationError(target, "alias-set-ambiguous");
  }
  const sorted = [...new Set(aliases)].toSorted();
  if (
    sorted.length !== aliases.length ||
    JSON.stringify(sorted) !== JSON.stringify(aliases)
  ) {
    activationError(target, "alias-set-ambiguous");
  }
  for (const reviewedAlias of MAIN_TARGET_CONTRACTS[target].aliases) {
    if (!sorted.includes(reviewedAlias)) {
      activationError(target, "alias-set-ambiguous");
    }
  }
  const reviewedAliases = new Set(MAIN_TARGET_CONTRACTS[target].aliases);
  const generatedAliases = sorted.filter(
    (alias) => !reviewedAliases.has(alias),
  );
  // TRANSITION-V3-PRIOR: the generated-alias topology and the deployment
  // environment are one shape, never two independent allowances. A v3-shaped
  // App prior carries exactly the retiring custom environment's generated
  // alias; a production-shaped prior carries exactly the reviewed production
  // set and never the retired alias. Any mixture of the two is an inconsistent
  // transition state and fails closed.
  if (isTransitionalAppPriorEnvironment(target, environment)) {
    if (
      JSON.stringify(generatedAliases) !==
      JSON.stringify([TRANSITIONAL_APP_PRIOR_GENERATED_ALIAS])
    ) {
      activationError(target, "alias-set-ambiguous");
    }
    return sorted;
  }
  // The retired alias cannot re-enter through a production-shaped prior.
  if (generatedAliases.includes(TRANSITIONAL_APP_PRIOR_GENERATED_ALIAS)) {
    activationError(target, "alias-set-ambiguous");
  }
  try {
    assertOnlyExpectedProductionGeneratedAliases({
      aliases: generatedAliases,
      creatorUsername,
      logicalTarget: target,
      mode: PRODUCTION_GENERATED_ALIAS_TOPOLOGY_MODES.SERVED_PRIOR,
    });
  } catch {
    activationError(target, "alias-set-ambiguous");
  }
  return sorted;
}

function syntacticServedSha(gitValues) {
  const values = new Set();
  for (const git of gitValues) {
    if (
      isPlainObject(git) &&
      typeof git.sha === "string" &&
      SHA_PATTERN.test(git.sha.toLowerCase())
    ) {
      values.add(git.sha.toLowerCase());
    }
  }
  return values.size === 1 ? [...values][0] : null;
}

function classifyPlanningGit(gitValues) {
  const servedSha = syntacticServedSha(gitValues);
  if (
    gitValues.some(
      (git) => git === undefined || git === null || !isPlainObject(git),
    )
  ) {
    return {
      base: null,
      reason: "served-git-metadata-missing",
      servedSha,
    };
  }
  if (
    gitValues.some(
      (git) =>
        !exactKeys(git, PLANNING_GIT_KEYS) ||
        Object.values(git).some(
          (value) => typeof value !== "string" || value.length === 0,
        ) ||
        !SHA_PATTERN.test(git.sha.toLowerCase()),
    )
  ) {
    return {
      base: null,
      reason: "served-git-metadata-malformed",
      servedSha,
    };
  }
  const normalized = gitValues.map((git) => ({
    org: git.org,
    ref: git.ref,
    repo: git.repo,
    sha: git.sha.toLowerCase(),
  }));
  if (new Set(normalized.map((git) => JSON.stringify(git))).size !== 1) {
    return {
      base: null,
      reason: "served-git-metadata-conflicting",
      servedSha,
    };
  }
  const git = normalized[0];
  if (
    git.org !== "mento-protocol" ||
    git.repo !== "frontend-monorepo" ||
    git.ref !== "main"
  ) {
    return {
      base: null,
      reason: "served-git-metadata-wrong-source",
      servedSha: git.sha,
    };
  }
  return { base: git.sha, reason: null, servedSha: git.sha };
}

function canonicalizePriorGroup({ target, group, projectId }) {
  const contract = MAIN_TARGET_CONTRACTS[target];
  if (!exactKeys(group, ["health", "states"]) || group.health !== "passed") {
    activationError(target, "prior-health-ambiguous");
  }
  if (!Array.isArray(group.states) || group.states.length === 0) {
    activationError(target, "alias-set-ambiguous");
  }

  const statesByAlias = new Map();
  const gitValues = [];
  let optionalDeploymentAliases = null;
  for (const state of group.states) {
    if (
      !containsOnlyKeys(state, PRIOR_STATE_ALLOWED_KEYS) ||
      PRIOR_STATE_REQUIRED_KEYS.some(
        (key) => !Object.prototype.hasOwnProperty.call(state, key),
      )
    ) {
      activationError(target, "prior-state-forbidden-fields");
    }
    let alias;
    try {
      alias = canonicalizeHostname(state.alias);
    } catch {
      activationError(target, "alias-set-ambiguous");
    }
    if (alias !== state.alias || statesByAlias.has(alias)) {
      activationError(target, "alias-set-ambiguous");
    }
    statesByAlias.set(alias, state);

    if (
      state.projectId !== projectId ||
      state.projectName !== contract.projectName
    ) {
      activationError(target, "project-identity-ambiguous");
    }
    // TRANSITION-V3-PRIOR: App priors may still be v3-shaped.
    if (!acceptsPriorEnvironment(target, state)) {
      activationError(target, "environment-identity-ambiguous");
    }
    if (state.readyState !== "READY") {
      activationError(target, "prior-readiness-ambiguous");
    }
    if (
      typeof state.deploymentId !== "string" ||
      !/^dpl_[A-Za-z0-9]+$/.test(state.deploymentId)
    ) {
      activationError(target, "rollback-target-ambiguous");
    }
    let deploymentUrl;
    try {
      deploymentUrl = canonicalizeDeploymentUrl(state.deploymentUrl);
    } catch {
      activationError(target, "rollback-target-ambiguous");
    }
    if (deploymentUrl !== state.deploymentUrl) {
      activationError(target, "rollback-target-ambiguous");
    }

    const aliases = canonicalizeOptionalDeploymentAliases(
      state.aliases,
      target,
      state.creatorUsername,
      state,
    );
    if (aliases !== null) {
      if (
        optionalDeploymentAliases !== null &&
        JSON.stringify(optionalDeploymentAliases) !== JSON.stringify(aliases)
      ) {
        activationError(target, "alias-set-ambiguous");
      }
      optionalDeploymentAliases = aliases;
    }
    gitValues.push(state.git);
  }

  canonicalizeReviewedAliases([...statesByAlias.keys()], target);
  const orderedStates = contract.aliases.map((alias) =>
    statesByAlias.get(alias),
  );
  if (orderedStates.some((state) => state === undefined)) {
    activationError(target, "alias-set-ambiguous");
  }
  const deploymentIds = new Set(
    orderedStates.map((state) => state.deploymentId),
  );
  const deploymentUrls = new Set(
    orderedStates.map((state) => state.deploymentUrl),
  );
  if (deploymentIds.size !== 1 || deploymentUrls.size !== 1) {
    activationError(target, "rollback-target-ambiguous");
  }

  const planningGit = classifyPlanningGit(gitValues);
  return {
    planningGit,
    prior: {
      target,
      aliases: [...contract.aliases],
      deploymentId: [...deploymentIds][0],
      deploymentUrl: [...deploymentUrls][0],
      servedSha: planningGit.servedSha,
    },
  };
}

function runGit(spawn, repoRoot, argumentsList) {
  const result = spawn("git", argumentsList, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error("Git proof failed");
  }
  return result.stdout.trim();
}

export function createMainPlanGitAdapter({
  repoRoot = process.cwd(),
  spawn = spawnSync,
} = {}) {
  return {
    firstParent(head) {
      return runGit(spawn, repoRoot, [
        "rev-parse",
        "--verify",
        `${requireSha(head, "Head SHA")}^1^{commit}`,
      ]);
    },
    isAncestor(base, head) {
      const result = spawn(
        "git",
        [
          "merge-base",
          "--is-ancestor",
          requireSha(base, "Base SHA"),
          requireSha(head, "Head SHA"),
        ],
        {
          cwd: repoRoot,
          encoding: "utf8",
          maxBuffer: 20 * 1024 * 1024,
        },
      );
      if (result.error || ![0, 1].includes(result.status)) {
        throw new Error("Git ancestry proof failed");
      }
      return result.status === 0;
    },
    resolveCommit(sha) {
      return runGit(spawn, repoRoot, [
        "rev-parse",
        "--verify",
        `${requireSha(sha, "Commit SHA")}^{commit}`,
      ]);
    },
  };
}

function assertGitAdapter(gitAdapter) {
  if (
    !isPlainObject(gitAdapter) ||
    ["firstParent", "isAncestor", "resolveCommit"].some(
      (name) => typeof gitAdapter[name] !== "function",
    )
  ) {
    throw new Error("Main plan Git adapter is malformed");
  }
}

function stableTargets(values) {
  const selected = new Set(values);
  return MAIN_DEPLOYMENT_TARGETS.filter((target) => selected.has(target));
}

function malformedPlannerRange({ kind, base, head, targets, all = false }) {
  return {
    range: {
      kind,
      base,
      head,
      targets: [...targets],
      deployments: all ? [...MAIN_DEPLOYMENT_TARGETS] : stableTargets(targets),
      reason: all ? "planner-affected-set-unknown" : "planner-output-malformed",
    },
    selectionReason: all
      ? "planner-affected-set-unknown"
      : "planner-output-malformed",
  };
}

function executePlannerRange({ kind, base, head, targets, runPlanner }) {
  let output;
  try {
    output = runPlanner({ base, head });
  } catch {
    return {
      range: {
        kind,
        base,
        head,
        targets: [...targets],
        deployments: stableTargets(targets),
        reason: "planner-execution-failed",
      },
      selectionReason: "planner-execution-failed",
    };
  }
  if (
    !isPlainObject(output) ||
    !exactKeys(output, PLANNER_OUTPUT_KEYS) ||
    !Array.isArray(output.deployments)
  ) {
    return malformedPlannerRange({
      kind,
      base,
      head,
      targets,
      all: isPlainObject(output) && !Array.isArray(output.deployments),
    });
  }
  if (
    output.deployments.some(
      (target) =>
        typeof target !== "string" || !MAIN_DEPLOYMENT_TARGETS.includes(target),
    )
  ) {
    return malformedPlannerRange({
      kind,
      base,
      head,
      targets,
      all: true,
    });
  }
  const stableDeployments = stableTargets(output.deployments);
  if (
    JSON.stringify(stableDeployments) !== JSON.stringify(output.deployments) ||
    output.base !== base ||
    output.head !== head ||
    typeof output.reason !== "string" ||
    !KNOWN_PLANNER_REASONS.has(output.reason)
  ) {
    return malformedPlannerRange({ kind, base, head, targets });
  }

  if (output.reason === "non-runtime-only") {
    if (output.deployments.length !== 0) {
      return malformedPlannerRange({ kind, base, head, targets });
    }
    return {
      range: {
        kind,
        base,
        head,
        targets: [...targets],
        deployments: [],
        reason: output.reason,
      },
      selectionReason: null,
    };
  }
  if (output.reason === "global-build-input") {
    if (
      JSON.stringify(output.deployments) !==
      JSON.stringify(MAIN_DEPLOYMENT_TARGETS)
    ) {
      return malformedPlannerRange({ kind, base, head, targets });
    }
    return {
      range: {
        kind,
        base,
        head,
        targets: [...targets],
        deployments: [...MAIN_DEPLOYMENT_TARGETS],
        reason: output.reason,
      },
      selectionReason: output.reason,
    };
  }
  if (output.reason === "affected-packages") {
    if (output.deployments.length === 0) {
      return malformedPlannerRange({ kind, base, head, targets });
    }
    return {
      range: {
        kind,
        base,
        head,
        targets: [...targets],
        deployments: [...output.deployments],
        reason: output.reason,
      },
      selectionReason: output.reason,
    };
  }
  if (FAIL_CLOSED_PLANNER_REASONS.has(output.reason)) {
    return {
      range: {
        kind,
        base,
        head,
        targets: [...targets],
        deployments: stableTargets(targets),
        reason: output.reason,
      },
      selectionReason: output.reason,
    };
  }
  return malformedPlannerRange({ kind, base, head, targets });
}

function proveServedBase({ base, deploySha, gitAdapter }) {
  try {
    const resolved = requireSha(
      gitAdapter.resolveCommit(base),
      "Resolved served SHA",
    );
    if (resolved !== base) {
      return { base: null, reason: "served-git-sha-unresolvable" };
    }
    if (!gitAdapter.isAncestor(resolved, deploySha)) {
      return { base: null, reason: "served-git-sha-not-ancestor" };
    }
    return { base: resolved, reason: null };
  } catch {
    return { base: null, reason: "served-git-sha-unresolvable" };
  }
}

function proveFirstParent({ deploySha, gitAdapter }) {
  const parent = requireSha(
    gitAdapter.firstParent(deploySha),
    "First-parent SHA",
  );
  const resolved = requireSha(
    gitAdapter.resolveCommit(parent),
    "Resolved first-parent SHA",
  );
  if (
    resolved !== parent ||
    resolved === deploySha ||
    !gitAdapter.isAncestor(resolved, deploySha)
  ) {
    throw new Error("First-parent proof failed");
  }
  return resolved;
}

function exactOutputKeys(value, keys, label) {
  if (!exactKeys(value, keys)) {
    throw new Error(`${label} contains forbidden fields`);
  }
}

export function assertMainDeploymentPlan(plan) {
  exactOutputKeys(
    plan,
    [
      "activeTargets",
      "deploySha",
      "mainOwnershipMode",
      "mode",
      "plan",
      "priors",
      "ranges",
      "reasons",
      "schema",
      "stagedTargets",
      "shadowTargets",
    ],
    "Main deployment plan",
  );
  if (plan.schema !== "vercel-main-plan:v2") {
    throw new Error("Main deployment plan schema is invalid");
  }
  const mode = requireMode(plan.mode);
  requireSha(plan.deploySha, "Main deployment plan SHA");
  if (
    !Array.isArray(plan.plan) ||
    JSON.stringify(stableTargets(plan.plan)) !== JSON.stringify(plan.plan)
  ) {
    throw new Error("Main deployment final plan is malformed");
  }
  const ownership = partitionMainOwnership({
    mode,
    mainOwnershipMode: plan.mainOwnershipMode,
  });
  if (
    JSON.stringify(ownership.mainOwnershipMode) !==
    JSON.stringify(plan.mainOwnershipMode)
  ) {
    throw new Error("Main deployment ownership is malformed");
  }
  if (
    !Array.isArray(plan.stagedTargets) ||
    !Array.isArray(plan.activeTargets) ||
    !Array.isArray(plan.shadowTargets) ||
    JSON.stringify(plan.stagedTargets) !== JSON.stringify(plan.plan) ||
    JSON.stringify(stableTargets(plan.activeTargets)) !==
      JSON.stringify(plan.activeTargets) ||
    JSON.stringify(stableTargets(plan.shadowTargets)) !==
      JSON.stringify(plan.shadowTargets) ||
    plan.activeTargets.some(
      (target) =>
        !plan.plan.includes(target) ||
        !ownership.githubTargets.includes(target),
    ) ||
    plan.shadowTargets.some(
      (target) =>
        !plan.plan.includes(target) ||
        !ownership.shadowTargets.includes(target),
    ) ||
    JSON.stringify(
      stableTargets([...plan.activeTargets, ...plan.shadowTargets]),
    ) !== JSON.stringify(plan.plan)
  ) {
    throw new Error("Main deployment ownership plan is malformed");
  }
  if (
    !Array.isArray(plan.priors) ||
    plan.priors.length !== MAIN_DEPLOYMENT_TARGETS.length
  ) {
    throw new Error("Main deployment priors are malformed");
  }
  for (const [index, prior] of plan.priors.entries()) {
    exactOutputKeys(
      prior,
      ["aliases", "deploymentId", "deploymentUrl", "servedSha", "target"],
      "Main deployment prior",
    );
    if (
      prior.target !== MAIN_DEPLOYMENT_TARGETS[index] ||
      JSON.stringify(prior.aliases) !==
        JSON.stringify(MAIN_TARGET_CONTRACTS[prior.target].aliases)
    ) {
      throw new Error("Main deployment prior target is malformed");
    }
    if (!/^dpl_[A-Za-z0-9]+$/.test(prior.deploymentId)) {
      throw new Error("Main deployment prior ID is malformed");
    }
    if (
      canonicalizeDeploymentUrl(prior.deploymentUrl) !== prior.deploymentUrl
    ) {
      throw new Error("Main deployment prior URL is malformed");
    }
    if (prior.servedSha !== null) {
      requireSha(prior.servedSha, "Main deployment served SHA");
    }
  }
  if (!Array.isArray(plan.ranges) || !Array.isArray(plan.reasons)) {
    throw new Error("Main deployment range evidence is malformed");
  }
  for (const range of plan.ranges) {
    exactOutputKeys(
      range,
      ["base", "deployments", "head", "kind", "reason", "targets"],
      "Main deployment planner range",
    );
    if (!["served", "shadow-first-parent"].includes(range.kind)) {
      throw new Error("Main deployment planner range kind is malformed");
    }
    if (range.base !== null) {
      requireSha(range.base, "Main deployment planner base");
    }
    requireSha(range.head, "Main deployment planner head");
    if (
      JSON.stringify(stableTargets(range.targets)) !==
        JSON.stringify(range.targets) ||
      range.targets.length === 0 ||
      JSON.stringify(stableTargets(range.deployments)) !==
        JSON.stringify(range.deployments) ||
      typeof range.reason !== "string" ||
      !RANGE_REASONS.has(range.reason)
    ) {
      throw new Error("Main deployment planner range is malformed");
    }
  }
  for (const reason of plan.reasons) {
    exactOutputKeys(
      reason,
      ["base", "reason", "target"],
      "Main deployment selection reason",
    );
    if (
      !MAIN_DEPLOYMENT_TARGETS.includes(reason.target) ||
      typeof reason.reason !== "string" ||
      !SELECTION_REASONS.has(reason.reason) ||
      !plan.plan.includes(reason.target)
    ) {
      throw new Error("Main deployment selection reason is malformed");
    }
    if (reason.base !== null) {
      requireSha(reason.base, "Main deployment selection base");
    }
  }
  return plan;
}

export function planMainDeployments({
  mode,
  mainOwnershipMode,
  deploySha,
  projectIds,
  priorStates,
  rollbackOnlyTargets,
  repoRoot = process.cwd(),
  gitAdapter = createMainPlanGitAdapter({ repoRoot }),
  runPlanner = ({ base, head }) =>
    planVercelDeployments({ repoRoot, base, head }),
}) {
  const canonicalMode = requireMode(mode);
  const ownership = partitionMainOwnership({
    mode: canonicalMode,
    mainOwnershipMode,
  });
  const canonicalDeploySha = requireSha(deploySha, "DEPLOY_SHA");
  if (
    !Array.isArray(rollbackOnlyTargets) ||
    JSON.stringify(stableTargets(rollbackOnlyTargets)) !==
      JSON.stringify(rollbackOnlyTargets)
  ) {
    throw new Error("Main rollback-only targets are malformed");
  }
  const rollbackOnly = new Set(rollbackOnlyTargets);
  assertTargetObject(projectIds, "Main project IDs");
  assertTargetObject(priorStates, "Main prior states");
  if (typeof runPlanner !== "function") {
    throw new Error("Main deployment planner adapter is malformed");
  }
  assertGitAdapter(gitAdapter);
  for (const target of MAIN_DEPLOYMENT_TARGETS) {
    requireIdentifier(projectIds[target], `${target} project ID`);
  }
  let resolvedHead;
  try {
    resolvedHead = requireSha(
      gitAdapter.resolveCommit(canonicalDeploySha),
      "Resolved DEPLOY_SHA",
    );
  } catch {
    throw new Error("DEPLOY_SHA cannot be resolved");
  }
  if (resolvedHead !== canonicalDeploySha) {
    throw new Error("DEPLOY_SHA did not resolve exactly");
  }

  const normalized = MAIN_DEPLOYMENT_TARGETS.map((target) => ({
    target,
    ...canonicalizePriorGroup({
      target,
      group: priorStates[target],
      projectId: projectIds[target],
    }),
  }));
  const selected = new Set();
  const reasons = [];
  const ranges = [];
  const groupedBases = new Map();

  function addSelection(target, reason, base = null) {
    selected.add(target);
    if (
      !reasons.some(
        (entry) =>
          entry.target === target &&
          entry.reason === reason &&
          entry.base === base,
      )
    ) {
      reasons.push({ target, reason, base });
    }
  }

  for (const entry of normalized) {
    if (rollbackOnly.has(entry.target)) {
      addSelection(
        entry.target,
        "served-mapping-rollback-only",
        entry.prior.servedSha,
      );
      continue;
    }
    if (entry.planningGit.reason !== null) {
      addSelection(
        entry.target,
        entry.planningGit.reason,
        entry.planningGit.servedSha,
      );
      continue;
    }
    const proof = proveServedBase({
      base: entry.planningGit.base,
      deploySha: canonicalDeploySha,
      gitAdapter,
    });
    if (proof.reason !== null) {
      addSelection(entry.target, proof.reason, entry.planningGit.base);
      continue;
    }
    const targets = groupedBases.get(proof.base) ?? [];
    targets.push(entry.target);
    groupedBases.set(proof.base, targets);
  }

  const alreadyCurrentTargets = new Set(
    groupedBases.get(canonicalDeploySha) ?? [],
  );
  const alreadyCurrentShadowTargets = new Set(
    [...alreadyCurrentTargets].filter((target) =>
      ownership.shadowTargets.includes(target),
    ),
  );
  for (const [base, targets] of groupedBases) {
    if (base === canonicalDeploySha) {
      ranges.push({
        kind: "served",
        base,
        head: canonicalDeploySha,
        targets: [...targets],
        deployments: [],
        reason: "served-sha-already-current",
      });
      continue;
    }
    const result = executePlannerRange({
      kind: "served",
      base,
      head: canonicalDeploySha,
      targets,
      runPlanner,
    });
    ranges.push(result.range);
    for (const target of result.range.deployments) {
      if (alreadyCurrentTargets.has(target)) continue;
      addSelection(target, result.selectionReason, base);
    }
  }

  if (alreadyCurrentShadowTargets.size > 0) {
    let firstParent;
    try {
      firstParent = proveFirstParent({
        deploySha: canonicalDeploySha,
        gitAdapter,
      });
    } catch {
      ranges.push({
        kind: "shadow-first-parent",
        base: null,
        head: canonicalDeploySha,
        targets: stableTargets(alreadyCurrentShadowTargets),
        deployments: ownership.shadowTargets,
        reason: "shadow-first-parent-unresolved",
      });
      for (const target of ownership.shadowTargets) {
        addSelection(target, "shadow-first-parent-unresolved");
      }
      firstParent = null;
    }
    if (firstParent !== null) {
      const result = executePlannerRange({
        kind: "shadow-first-parent",
        base: firstParent,
        head: canonicalDeploySha,
        targets: stableTargets(alreadyCurrentShadowTargets),
        runPlanner,
      });
      ranges.push(result.range);
      for (const target of result.range.deployments) {
        if (ownership.shadowTargets.includes(target)) {
          addSelection(target, "shadow-native-already-current", firstParent);
        }
      }
    }
  }

  const stagedTargets = stableTargets(selected);
  const plan = {
    schema: "vercel-main-plan:v2",
    mode: canonicalMode,
    deploySha: canonicalDeploySha,
    mainOwnershipMode: ownership.mainOwnershipMode,
    plan: [...stagedTargets],
    stagedTargets: [...stagedTargets],
    activeTargets: stagedTargets.filter((target) =>
      ownership.githubTargets.includes(target),
    ),
    shadowTargets: stagedTargets.filter((target) =>
      ownership.shadowTargets.includes(target),
    ),
    priors: normalized.map((entry) => entry.prior),
    ranges,
    reasons: reasons.toSorted((left, right) => {
      const targetOrder =
        MAIN_DEPLOYMENT_TARGETS.indexOf(left.target) -
        MAIN_DEPLOYMENT_TARGETS.indexOf(right.target);
      if (targetOrder !== 0) return targetOrder;
      const reasonOrder = left.reason.localeCompare(right.reason);
      if (reasonOrder !== 0) return reasonOrder;
      return (left.base ?? "").localeCompare(right.base ?? "");
    }),
  };
  return assertMainDeploymentPlan(plan);
}
