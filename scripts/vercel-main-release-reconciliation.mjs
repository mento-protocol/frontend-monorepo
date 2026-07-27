import { createHash } from "node:crypto";

import {
  MAIN_DEPLOYMENT_TARGETS,
  MAIN_TARGET_CONTRACTS,
  assertMainDeploymentPlan,
  partitionMainOwnership,
  planMainDeployments,
} from "./vercel-main-plan.mjs";
import {
  canonicalizeDeploymentUrl,
  canonicalizeHostname,
} from "./vercel-deployment-url.mjs";
import { generateVercelMainReleaseId } from "./vercel-prebuilt.mjs";

const MAIN_RELEASE_MANIFEST_SCHEMA = "vercel-main-release-manifest:v2";
const MAIN_RELEASE_RECONCILIATION_SCHEMA =
  "vercel-main-release-reconciliation:v1";
const MAIN_PREPLAN_RECONCILIATION_SCHEMA =
  "vercel-main-preplan-reconciliation:v2";
export const MAIN_RELEASE_ACTIVATION_ORDER = Object.freeze([
  "governance",
  "reserve",
  "ui",
  "app",
]);

const REPOSITORY = "mento-protocol/frontend-monorepo";
const SHA_PATTERN = /^[a-f0-9]{40}$/;
const POSITIVE_ID_PATTERN = /^[1-9][0-9]*$/;
const DEPLOYMENT_ID_PATTERN = /^dpl_[A-Za-z0-9]+$/;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const MANIFEST_KEYS = Object.freeze([
  "schema",
  "repository",
  "releaseId",
  "deploySha",
  "upstreamRunId",
  "mode",
  "mainOwnershipMode",
  "stagedTargets",
  "activeTargets",
  "rollbackOnlyTargets",
  "originalPriors",
  "releasePlanDigest",
]);
const PRIOR_KEYS = Object.freeze([
  "deploymentId",
  "deploymentUrl",
  "aliases",
  "projectId",
  "projectName",
  "readyState",
  "target",
  "customEnvironmentSlug",
  "planningLeaves",
  "servedSha",
]);
const PLANNING_LEAF_KEYS = Object.freeze([
  "alias",
  "deploymentId",
  "deploymentUrl",
  "aliases",
  "projectId",
  "projectName",
  "readyState",
  "target",
  "customEnvironmentSlug",
  "git",
]);
const GIT_EVIDENCE_KEYS = Object.freeze([
  "status",
  "org",
  "repo",
  "ref",
  "sha",
]);
const MAPPING_KEYS = Object.freeze(["alias", "deploymentId", "deploymentUrl"]);
const CANDIDATE_KEYS = Object.freeze([
  "deploymentId",
  "deploymentUrl",
  "manifest",
]);
const TARGET_STATES = new Set(["prior", "mixed", "candidate"]);
const PREPARATION_STATES = new Set([
  "ready",
  "failed",
  "pending",
  "producer-live",
]);
const PREPLAN_KEYS = Object.freeze([
  "schema",
  "decision",
  "reason",
  "rollbackOnlyTargets",
  "reconciliation",
  "rollbackAuthorization",
]);

function assertExactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is malformed`);
  }
  if (JSON.stringify(Object.keys(value)) !== JSON.stringify(keys)) {
    throw new Error(`${label} keys are missing, extra, or out of order`);
  }
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function requireString(value, label, pattern) {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new Error(`${label} is malformed`);
  }
  return value;
}

function canonicalTargets(value, label, { allowEmpty = false } = {}) {
  if (
    !Array.isArray(value) ||
    (!allowEmpty && value.length === 0) ||
    value.some((target) => !MAIN_RELEASE_ACTIVATION_ORDER.includes(target)) ||
    new Set(value).size !== value.length
  ) {
    throw new Error(`${label} is malformed`);
  }
  const canonical = MAIN_RELEASE_ACTIVATION_ORDER.filter((target) =>
    value.includes(target),
  );
  if (JSON.stringify(value) !== JSON.stringify(canonical)) {
    throw new Error(`${label} is not canonical`);
  }
  return canonical;
}

function canonicalRollbackOnlyTargets(value, label) {
  if (
    !Array.isArray(value) ||
    value.some((target) => !MAIN_DEPLOYMENT_TARGETS.includes(target)) ||
    new Set(value).size !== value.length
  ) {
    throw new Error(`${label} is malformed`);
  }
  const canonical = MAIN_DEPLOYMENT_TARGETS.filter((target) =>
    value.includes(target),
  );
  if (JSON.stringify(value) !== JSON.stringify(canonical)) {
    throw new Error(`${label} is not canonical`);
  }
  return canonical;
}

function assertFreshRollbackCoverage(manifest, rollbackOnlyTargets) {
  const missing = rollbackOnlyTargets.filter(
    (target) => !manifest.stagedTargets.includes(target),
  );
  if (missing.length > 0) {
    throw new Error(
      `Current main release omits fresh rollback-only targets: ${missing.join(", ")}`,
    );
  }
}

function canonicalOwnership(mode, mainOwnershipMode) {
  assertExactKeys(
    mainOwnershipMode,
    MAIN_DEPLOYMENT_TARGETS,
    "Main release manifest ownership",
  );
  const ownership = partitionMainOwnership({ mode, mainOwnershipMode });
  return {
    mode,
    mainOwnershipMode: ownership.mainOwnershipMode,
    githubTargets: ownership.githubTargets,
    shadowTargets: ownership.shadowTargets,
  };
}

function canonicalAliases(value, target, label) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} is malformed`);
  }
  const aliases = value.map(canonicalizeHostname);
  const canonical = [...new Set(aliases)].sort();
  const expected = [...MAIN_TARGET_CONTRACTS[target].aliases].sort();
  if (
    JSON.stringify(value) !== JSON.stringify(canonical) ||
    JSON.stringify(canonical) !== JSON.stringify(expected)
  ) {
    throw new Error(`${label} does not match the reviewed topology`);
  }
  return canonical;
}

function canonicalNullableGitField(value, label, { sha = false } = {}) {
  if (value === null) return null;
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 256 ||
    (sha && !SHA_PATTERN.test(value))
  ) {
    throw new Error(`${label} is malformed`);
  }
  return sha ? value.toLowerCase() : value;
}

function canonicalGitEvidence(value, label) {
  assertExactKeys(value, GIT_EVIDENCE_KEYS, label);
  if (!["missing", "malformed", "complete"].includes(value.status)) {
    throw new Error(`${label} status is malformed`);
  }
  const canonical = {
    status: value.status,
    org: canonicalNullableGitField(value.org, `${label} org`),
    repo: canonicalNullableGitField(value.repo, `${label} repo`),
    ref: canonicalNullableGitField(value.ref, `${label} ref`),
    sha: canonicalNullableGitField(value.sha, `${label} SHA`, { sha: true }),
  };
  const fields = Object.values(canonical).slice(1);
  if (
    (["missing", "malformed"].includes(canonical.status) &&
      fields.some((entry) => entry !== null)) ||
    (canonical.status === "complete" && fields.some((entry) => entry === null))
  ) {
    throw new Error(`${label} status conflicts with its fields`);
  }
  if (
    canonical.status === "complete" &&
    (!/^[A-Za-z0-9._-]+$/.test(canonical.org) ||
      !/^[A-Za-z0-9._-]+$/.test(canonical.repo) ||
      !/^[A-Za-z0-9._/-]+$/.test(canonical.ref) ||
      canonical.ref.includes(".."))
  ) {
    throw new Error(`${label} complete identity is unsafe`);
  }
  return canonical;
}

function classifyPlanningGitEvidence(leaves) {
  const servedShas = new Set(
    leaves.map(({ git }) => git.sha).filter((sha) => sha !== null),
  );
  const servedSha = servedShas.size === 1 ? [...servedShas][0] : null;
  if (leaves.some(({ git }) => git.status === "missing")) {
    return { reason: "served-git-metadata-missing", servedSha };
  }
  if (leaves.some(({ git }) => git.status === "malformed")) {
    return { reason: "served-git-metadata-malformed", servedSha };
  }
  const identities = new Set(
    leaves.map(({ git }) =>
      JSON.stringify({
        org: git.org,
        repo: git.repo,
        ref: git.ref,
        sha: git.sha,
      }),
    ),
  );
  if (identities.size !== 1) {
    return { reason: "served-git-metadata-conflicting", servedSha };
  }
  const git = leaves[0].git;
  if (
    git.org !== "mento-protocol" ||
    git.repo !== "frontend-monorepo" ||
    git.ref !== "main"
  ) {
    return { reason: "served-git-metadata-wrong-source", servedSha };
  }
  return { reason: null, servedSha };
}

function canonicalPlanningLeaves(value, target, prior, label) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} is malformed`);
  }
  const leaves = value.map((leaf, index) => {
    const leafLabel = `${label} ${index}`;
    assertExactKeys(leaf, PLANNING_LEAF_KEYS, leafLabel);
    const alias = canonicalizeHostname(leaf.alias);
    const aliases = canonicalAliases(
      leaf.aliases,
      target,
      `${leafLabel} aliases`,
    );
    if (
      leaf.deploymentId !== prior.deploymentId ||
      canonicalizeDeploymentUrl(leaf.deploymentUrl) !== prior.deploymentUrl ||
      leaf.projectId !== prior.projectId ||
      leaf.projectName !== prior.projectName ||
      leaf.readyState !== prior.readyState ||
      leaf.target !== prior.target ||
      leaf.customEnvironmentSlug !== prior.customEnvironmentSlug
    ) {
      throw new Error(`${leafLabel} conflicts with its rollback prior`);
    }
    return {
      alias,
      deploymentId: prior.deploymentId,
      deploymentUrl: prior.deploymentUrl,
      aliases,
      projectId: prior.projectId,
      projectName: prior.projectName,
      readyState: prior.readyState,
      target: prior.target,
      customEnvironmentSlug: prior.customEnvironmentSlug,
      git: canonicalGitEvidence(leaf.git, `${leafLabel} Git evidence`),
    };
  });
  leaves.sort((left, right) => left.alias.localeCompare(right.alias));
  if (
    new Set(leaves.map(({ alias }) => alias)).size !== leaves.length ||
    JSON.stringify(leaves.map(({ alias }) => alias)) !==
      JSON.stringify(prior.aliases)
  ) {
    throw new Error(`${label} does not exactly cover reviewed aliases`);
  }
  return leaves;
}

function canonicalPrior(value, target, label) {
  assertExactKeys(value, PRIOR_KEYS, label);
  const contract = MAIN_TARGET_CONTRACTS[target];
  const servedSha =
    value.servedSha === null
      ? null
      : requireString(value.servedSha, `${label} served SHA`, SHA_PATTERN);
  const prior = {
    deploymentId: requireString(
      value.deploymentId,
      `${label} deployment ID`,
      DEPLOYMENT_ID_PATTERN,
    ),
    deploymentUrl: canonicalizeDeploymentUrl(value.deploymentUrl),
    aliases: canonicalAliases(value.aliases, target, `${label} aliases`),
    projectId: requireString(
      value.projectId,
      `${label} project ID`,
      /^[A-Za-z0-9._-]+$/,
    ),
    projectName: contract.projectName,
    readyState: "READY",
    target: contract.target,
    customEnvironmentSlug: contract.customEnvironmentSlug,
  };
  if (
    value.projectName !== contract.projectName ||
    value.readyState !== "READY" ||
    value.target !== contract.target ||
    value.customEnvironmentSlug !== contract.customEnvironmentSlug
  ) {
    throw new Error(`${label} planning identity is malformed`);
  }
  const planningLeaves = canonicalPlanningLeaves(
    value.planningLeaves,
    target,
    prior,
    `${label} planning leaves`,
  );
  const planningGit = classifyPlanningGitEvidence(planningLeaves);
  if (planningGit.servedSha !== servedSha) {
    throw new Error(`${label} served SHA conflicts with its planning leaves`);
  }
  return {
    ...prior,
    planningLeaves,
    servedSha,
  };
}

export function createMainReleaseManifest({
  upstreamRunId,
  plan,
  originalPriors,
}) {
  const canonicalPlan = structuredClone(assertMainDeploymentPlan(plan));
  const canonicalSha = requireString(
    canonicalPlan.deploySha,
    "Main release manifest SHA",
    SHA_PATTERN,
  );
  const canonicalUpstreamRunId = requireString(
    String(upstreamRunId),
    "Main release manifest upstream run ID",
    POSITIVE_ID_PATTERN,
  );
  const canonicalStagedTargets = MAIN_RELEASE_ACTIVATION_ORDER.filter(
    (target) => canonicalPlan.stagedTargets.includes(target),
  );
  const canonicalActiveTargets = MAIN_RELEASE_ACTIVATION_ORDER.filter(
    (target) => canonicalPlan.activeTargets.includes(target),
  );
  const rollbackOnlyTargets = MAIN_DEPLOYMENT_TARGETS.filter((target) =>
    canonicalPlan.reasons.some(
      (reason) =>
        reason.target === target &&
        reason.reason === "served-mapping-rollback-only",
    ),
  );
  const ownership = canonicalOwnership(
    canonicalPlan.mode,
    canonicalPlan.mainOwnershipMode,
  );
  canonicalTargets(
    canonicalStagedTargets,
    "Main release manifest staged targets",
    { allowEmpty: true },
  );
  if (canonicalActiveTargets.length > 0) {
    canonicalTargets(
      canonicalActiveTargets,
      "Main release manifest active targets",
    );
  }
  if (
    rollbackOnlyTargets.some(
      (target) => !canonicalStagedTargets.includes(target),
    )
  ) {
    throw new Error("Main release rollback-only targets were not staged");
  }
  assertExactKeys(
    originalPriors,
    MAIN_RELEASE_ACTIVATION_ORDER,
    "Main release manifest original priors",
  );
  const canonicalPriors = Object.fromEntries(
    MAIN_RELEASE_ACTIVATION_ORDER.map((target) => {
      const prior = canonicalPrior(
        originalPriors[target],
        target,
        `Main release manifest ${target} prior`,
      );
      const plannedPrior = canonicalPlan.priors.find(
        (entry) => entry.target === target,
      );
      if (
        plannedPrior === undefined ||
        plannedPrior.deploymentId !== prior.deploymentId ||
        plannedPrior.deploymentUrl !== prior.deploymentUrl ||
        plannedPrior.servedSha !== prior.servedSha ||
        JSON.stringify(plannedPrior.aliases) !== JSON.stringify(prior.aliases)
      ) {
        throw new Error(
          `${target} original prior conflicts with the canonical release plan`,
        );
      }
      return [target, prior];
    }),
  );
  const releaseId = generateVercelMainReleaseId({
    repository: REPOSITORY,
    commitSha: canonicalSha,
    upstreamRunId: canonicalUpstreamRunId,
  });
  return {
    schema: MAIN_RELEASE_MANIFEST_SCHEMA,
    repository: REPOSITORY,
    releaseId,
    deploySha: canonicalSha,
    upstreamRunId: canonicalUpstreamRunId,
    mode: ownership.mode,
    mainOwnershipMode: ownership.mainOwnershipMode,
    stagedTargets: canonicalStagedTargets,
    activeTargets: canonicalActiveTargets,
    rollbackOnlyTargets,
    originalPriors: canonicalPriors,
    releasePlanDigest: digest(canonicalPlan),
  };
}

export function assertMainReleaseManifest(value) {
  assertExactKeys(value, MANIFEST_KEYS, "Main release manifest");
  if (
    value.schema !== MAIN_RELEASE_MANIFEST_SCHEMA ||
    value.repository !== REPOSITORY
  ) {
    throw new Error("Main release manifest schema is unsupported");
  }
  const deploySha = requireString(
    value.deploySha,
    "Main release manifest SHA",
    SHA_PATTERN,
  );
  const upstreamRunId = requireString(
    String(value.upstreamRunId),
    "Main release manifest upstream run ID",
    POSITIVE_ID_PATTERN,
  );
  if (!["active", "shadow"].includes(value.mode)) {
    throw new Error("Main release manifest mode is malformed");
  }
  const ownership = canonicalOwnership(value.mode, value.mainOwnershipMode);
  const stagedTargets = canonicalTargets(
    value.stagedTargets,
    "Main release manifest staged targets",
    { allowEmpty: true },
  );
  if (!Array.isArray(value.activeTargets)) {
    throw new Error("Main release manifest active targets are malformed");
  }
  const activeTargets =
    value.activeTargets.length === 0
      ? []
      : canonicalTargets(
          value.activeTargets,
          "Main release manifest active targets",
        );
  if (activeTargets.some((target) => !stagedTargets.includes(target))) {
    throw new Error("Main release manifest active targets were not staged");
  }
  const shadowTargets = stagedTargets.filter(
    (target) => !activeTargets.includes(target),
  );
  const rollbackOnlyTargets = canonicalRollbackOnlyTargets(
    value.rollbackOnlyTargets,
    "Main release manifest rollback-only targets",
  );
  if (
    activeTargets.some((target) => !ownership.githubTargets.includes(target)) ||
    shadowTargets.some((target) => !ownership.shadowTargets.includes(target)) ||
    rollbackOnlyTargets.some((target) => !stagedTargets.includes(target))
  ) {
    throw new Error("Main release manifest target ownership conflicts");
  }
  assertExactKeys(
    value.originalPriors,
    MAIN_RELEASE_ACTIVATION_ORDER,
    "Main release manifest original priors",
  );
  const originalPriors = Object.fromEntries(
    MAIN_RELEASE_ACTIVATION_ORDER.map((target) => [
      target,
      canonicalPrior(
        value.originalPriors[target],
        target,
        `Main release manifest ${target} prior`,
      ),
    ]),
  );
  const expectedReleaseId = generateVercelMainReleaseId({
    repository: REPOSITORY,
    commitSha: deploySha,
    upstreamRunId,
  });
  if (
    value.releaseId !== expectedReleaseId ||
    !DIGEST_PATTERN.test(value.releasePlanDigest)
  ) {
    throw new Error("Main release manifest stable identity conflicts");
  }
  return {
    schema: MAIN_RELEASE_MANIFEST_SCHEMA,
    repository: REPOSITORY,
    releaseId: expectedReleaseId,
    deploySha,
    upstreamRunId,
    mode: ownership.mode,
    mainOwnershipMode: ownership.mainOwnershipMode,
    stagedTargets,
    activeTargets,
    rollbackOnlyTargets,
    originalPriors,
    releasePlanDigest: value.releasePlanDigest,
  };
}

function planningGitForRecompute(git) {
  if (git.status === "missing") return null;
  const fields = Object.fromEntries(
    ["org", "repo", "ref", "sha"]
      .filter((key) => git[key] !== null)
      .map((key) => [key, git[key]]),
  );
  return git.status === "malformed"
    ? { ...fields, __sanitizedMalformed: true }
    : fields;
}

export function recomputeMainReleasePlan({
  manifest: rawManifest,
  repoRoot,
  gitAdapter,
  runPlanner,
}) {
  const manifest = assertMainReleaseManifest(rawManifest);
  const projectIds = Object.fromEntries(
    MAIN_DEPLOYMENT_TARGETS.map((target) => [
      target,
      manifest.originalPriors[target].projectId,
    ]),
  );
  const priorStates = Object.fromEntries(
    MAIN_DEPLOYMENT_TARGETS.map((target) => {
      const prior = manifest.originalPriors[target];
      return [
        target,
        {
          health: "passed",
          states: prior.planningLeaves.map((leaf) => ({
            alias: leaf.alias,
            deploymentId: leaf.deploymentId,
            deploymentUrl: leaf.deploymentUrl,
            projectId: leaf.projectId,
            projectName: leaf.projectName,
            readyState: leaf.readyState,
            target: leaf.target,
            customEnvironmentSlug: leaf.customEnvironmentSlug,
            git: planningGitForRecompute(leaf.git),
            aliases: [...leaf.aliases],
          })),
        },
      ];
    }),
  );
  const recomputed = planMainDeployments({
    mode: manifest.mode,
    mainOwnershipMode: manifest.mainOwnershipMode,
    deploySha: manifest.deploySha,
    projectIds,
    priorStates,
    rollbackOnlyTargets: manifest.rollbackOnlyTargets,
    ...(repoRoot === undefined ? {} : { repoRoot }),
    ...(gitAdapter === undefined ? {} : { gitAdapter }),
    ...(runPlanner === undefined ? {} : { runPlanner }),
  });
  const stagedTargets = MAIN_RELEASE_ACTIVATION_ORDER.filter((target) =>
    recomputed.stagedTargets.includes(target),
  );
  const activeTargets = MAIN_RELEASE_ACTIVATION_ORDER.filter((target) =>
    recomputed.activeTargets.includes(target),
  );
  if (
    digest(recomputed) !== manifest.releasePlanDigest ||
    JSON.stringify(stagedTargets) !== JSON.stringify(manifest.stagedTargets) ||
    JSON.stringify(activeTargets) !== JSON.stringify(manifest.activeTargets)
  ) {
    throw new Error(
      "Recomputed main release plan conflicts with its durable manifest",
    );
  }
  return recomputed;
}

function canonicalMapping(value, label) {
  assertExactKeys(value, MAPPING_KEYS, label);
  return {
    alias: canonicalizeHostname(value.alias),
    deploymentId: requireString(
      value.deploymentId,
      `${label} deployment ID`,
      DEPLOYMENT_ID_PATTERN,
    ),
    deploymentUrl: canonicalizeDeploymentUrl(value.deploymentUrl),
  };
}

function canonicalTargetMappings(value, target, prior) {
  if (!Array.isArray(value)) {
    throw new Error(`${target} current mappings are malformed`);
  }
  const mappings = value.map((mapping, index) =>
    canonicalMapping(mapping, `${target} current mapping ${index}`),
  );
  mappings.sort((left, right) => left.alias.localeCompare(right.alias));
  if (
    new Set(mappings.map(({ alias }) => alias)).size !== mappings.length ||
    JSON.stringify(mappings.map(({ alias }) => alias)) !==
      JSON.stringify(prior.aliases)
  ) {
    throw new Error(`${target} current mappings do not match reviewed aliases`);
  }
  return mappings;
}

function canonicalCandidate(value, target, manifest) {
  if (value === null) return null;
  assertExactKeys(value, CANDIDATE_KEYS, `${target} release candidate`);
  const candidateManifest = assertMainReleaseManifest(value.manifest);
  if (JSON.stringify(candidateManifest) !== JSON.stringify(manifest)) {
    throw new Error("Release candidates disagree on their stable manifest");
  }
  return {
    deploymentId: requireString(
      value.deploymentId,
      `${target} candidate deployment ID`,
      DEPLOYMENT_ID_PATTERN,
    ),
    deploymentUrl: canonicalizeDeploymentUrl(value.deploymentUrl),
    manifest: candidateManifest,
  };
}

function classifyTarget({ target, prior, candidate, mappings }) {
  let priorAliases = 0;
  let candidateAliases = 0;
  const classifiedMappings = mappings.map((mapping) => {
    const atPrior =
      mapping.deploymentId === prior.deploymentId &&
      mapping.deploymentUrl === prior.deploymentUrl;
    const atCandidate =
      candidate !== null &&
      mapping.deploymentId === candidate.deploymentId &&
      mapping.deploymentUrl === candidate.deploymentUrl;
    if (atPrior === atCandidate) {
      throw new Error(
        `${target} current mapping is neither exact prior nor exact candidate`,
      );
    }
    if (atPrior) priorAliases += 1;
    if (atCandidate) candidateAliases += 1;
    return { ...mapping, state: atPrior ? "prior" : "candidate" };
  });
  if (candidate === null && candidateAliases !== 0) {
    throw new Error(`${target} maps to a missing release candidate`);
  }
  const state =
    candidateAliases === mappings.length
      ? "candidate"
      : priorAliases === mappings.length
        ? "prior"
        : "mixed";
  if (!TARGET_STATES.has(state) || (state === "mixed" && target !== "app")) {
    throw new Error(`${target} release mapping state is unsupported`);
  }
  return {
    state,
    mappings: classifiedMappings,
  };
}

function assertActivationPrefix(targets) {
  let reachedFrontier = false;
  for (const [index, target] of targets.entries()) {
    if (target.state === "candidate") {
      if (reachedFrontier) {
        throw new Error(
          "Release candidate mappings are not an activation prefix",
        );
      }
      continue;
    }
    if (target.state === "mixed") {
      if (
        reachedFrontier ||
        target.target !== "app" ||
        index !== targets.length - 1
      ) {
        throw new Error("Mixed App mappings are outside the release frontier");
      }
    }
    reachedFrontier = true;
  }
}

export function reconcileMainRelease({
  manifest: rawManifest,
  candidates,
  currentMappings,
}) {
  const manifest = assertMainReleaseManifest(rawManifest);
  assertExactKeys(
    candidates,
    manifest.stagedTargets,
    "Main release candidates",
  );
  assertExactKeys(
    currentMappings,
    MAIN_RELEASE_ACTIVATION_ORDER,
    "Main release current mappings",
  );
  const canonicalCandidates = Object.fromEntries(
    manifest.stagedTargets.map((target) => [
      target,
      canonicalCandidate(candidates[target], target, manifest),
    ]),
  );
  const observedTargets = MAIN_RELEASE_ACTIVATION_ORDER.map((target) => {
    const prior = manifest.originalPriors[target];
    const candidate = canonicalCandidates[target] ?? null;
    if (
      candidate !== null &&
      (candidate.deploymentId === prior.deploymentId ||
        candidate.deploymentUrl === prior.deploymentUrl)
    ) {
      throw new Error(`${target} candidate collides with its original prior`);
    }
    const mappings = canonicalTargetMappings(
      currentMappings[target],
      target,
      prior,
    );
    const classification = classifyTarget({
      target,
      prior,
      candidate,
      mappings,
    });
    if (
      !manifest.activeTargets.includes(target) &&
      classification.state !== "prior"
    ) {
      throw new Error(
        `${target} is not active and must remain at its original prior`,
      );
    }
    return {
      target,
      prior,
      candidate,
      state: classification.state,
      startMappings: classification.mappings,
    };
  });
  const targets = observedTargets.filter(({ target }) =>
    manifest.activeTargets.includes(target),
  );
  assertActivationPrefix(targets);
  const inheritedCandidateTargets = targets
    .filter(({ state }) => state === "candidate")
    .map(({ target }) => target);
  const inheritedCandidateAliases = targets.flatMap(({ startMappings }) =>
    startMappings
      .filter(({ state }) => state === "candidate")
      .map(({ alias }) => alias),
  );
  const allCandidate =
    targets.length > 0 && targets.every(({ state }) => state === "candidate");
  const allPrior = targets.every(({ state }) => state === "prior");
  const frontier =
    targets.find(({ state }) => state !== "candidate")?.target ?? null;
  return {
    schema: MAIN_RELEASE_RECONCILIATION_SCHEMA,
    manifest,
    observedTargets,
    targets,
    inheritedCandidateTargets,
    inheritedCandidateAliases,
    allCandidate,
    allPrior,
    frontier,
  };
}

export function decideMainPreplanReconciliation({
  nextDeploySha,
  nextUpstreamRunId,
  candidateReleases,
  currentMappings,
  rollbackOnlyTargets,
}) {
  const canonicalNextSha = requireString(
    nextDeploySha,
    "Next main release SHA",
    SHA_PATTERN,
  );
  const canonicalNextUpstreamRunId = requireString(
    String(nextUpstreamRunId),
    "Next main release upstream run ID",
    POSITIVE_ID_PATTERN,
  );
  const expectedReleaseId = generateVercelMainReleaseId({
    repository: REPOSITORY,
    commitSha: canonicalNextSha,
    upstreamRunId: canonicalNextUpstreamRunId,
  });
  const canonicalRollbackOnly = canonicalRollbackOnlyTargets(
    rollbackOnlyTargets,
    "Fresh main rollback-only targets",
  );
  assertExactKeys(
    currentMappings,
    MAIN_RELEASE_ACTIVATION_ORDER,
    "Pre-plan current mappings",
  );
  if (!Array.isArray(candidateReleases)) {
    throw new Error("Mapped candidate releases are malformed");
  }
  if (candidateReleases.length === 0) {
    return {
      schema: MAIN_PREPLAN_RECONCILIATION_SCHEMA,
      decision: "capture-new-baseline",
      reason: "no-mapped-release-metadata",
      rollbackOnlyTargets: canonicalRollbackOnly,
      reconciliation: null,
      rollbackAuthorization: null,
    };
  }
  const seenReleases = new Set();
  const compatible = [];
  for (const [index, release] of candidateReleases.entries()) {
    assertExactKeys(
      release,
      ["manifest", "candidates"],
      `Mapped candidate release ${index}`,
    );
    const manifest = assertMainReleaseManifest(release.manifest);
    if (seenReleases.has(manifest.releaseId)) {
      throw new Error("Mapped candidate releases contain a duplicate release");
    }
    seenReleases.add(manifest.releaseId);
    try {
      const reconciliation = reconcileMainRelease({
        manifest,
        candidates: release.candidates,
        currentMappings,
      });
      if (!reconciliation.allPrior) compatible.push(reconciliation);
    } catch {
      // Older path-aware releases are expected to stop explaining the full
      // mapping state after a later completed release changes one of their
      // active or baseline leaves.
    }
  }
  if (compatible.length !== 1) {
    throw new Error(
      `Mapped release history must have one compatible frontier; received ${compatible.length}`,
    );
  }
  const [reconciliation] = compatible;
  const { manifest } = reconciliation;
  const sameRelease = manifest.releaseId === expectedReleaseId;
  if (sameRelease) {
    assertFreshRollbackCoverage(manifest, canonicalRollbackOnly);
  }
  if (reconciliation.allCandidate) {
    return {
      schema: MAIN_PREPLAN_RECONCILIATION_SCHEMA,
      decision: sameRelease
        ? "verify-existing-release"
        : "capture-new-baseline",
      reason: sameRelease
        ? "current-main-release-already-complete"
        : "older-mapped-release-is-complete",
      rollbackOnlyTargets: canonicalRollbackOnly,
      reconciliation,
      rollbackAuthorization: null,
    };
  }
  if (sameRelease) {
    return {
      schema: MAIN_PREPLAN_RECONCILIATION_SCHEMA,
      decision: "resume-existing-release",
      reason: "current-main-release-is-an-interrupted-prefix",
      rollbackOnlyTargets: canonicalRollbackOnly,
      reconciliation,
      rollbackAuthorization: null,
    };
  }
  return {
    schema: MAIN_PREPLAN_RECONCILIATION_SCHEMA,
    decision: "restore-before-planning",
    reason: "older-main-release-is-an-interrupted-prefix",
    rollbackOnlyTargets: canonicalRollbackOnly,
    reconciliation,
    rollbackAuthorization: createInheritedRollbackAuthorization({
      reconciliation,
      reason: "restore-inherited",
    }),
  };
}

function canonicalEmbeddedReconciliation(value) {
  if (value === null) return null;
  const canonical = reconcileMainRelease({
    manifest: value?.manifest,
    candidates: Object.fromEntries(
      (value?.observedTargets ?? [])
        .filter(({ target }) =>
          value?.manifest?.stagedTargets?.includes(target),
        )
        .map(({ target, candidate }) => [
          target,
          candidate === null
            ? null
            : {
                deploymentId: candidate.deploymentId,
                deploymentUrl: candidate.deploymentUrl,
                manifest: candidate.manifest,
              },
        ]),
    ),
    currentMappings: Object.fromEntries(
      (value?.observedTargets ?? []).map(({ target, startMappings }) => [
        target,
        startMappings.map(({ state: _state, ...mapping }) => {
          void _state;
          return mapping;
        }),
      ]),
    ),
  });
  if (JSON.stringify(value) !== JSON.stringify(canonical)) {
    throw new Error("Pre-plan reconciliation is not canonical");
  }
  return canonical;
}

export function assertMainPreplanReconciliation(
  value,
  { nextDeploySha, nextUpstreamRunId },
) {
  assertExactKeys(value, PREPLAN_KEYS, "Main pre-plan reconciliation");
  if (value.schema !== MAIN_PREPLAN_RECONCILIATION_SCHEMA) {
    throw new Error("Main pre-plan reconciliation schema is unsupported");
  }
  const expectedReleaseId = generateVercelMainReleaseId({
    repository: REPOSITORY,
    commitSha: requireString(
      nextDeploySha,
      "Next main release SHA",
      SHA_PATTERN,
    ),
    upstreamRunId: requireString(
      String(nextUpstreamRunId),
      "Next main release upstream run ID",
      POSITIVE_ID_PATTERN,
    ),
  });
  const rollbackOnlyTargets = canonicalRollbackOnlyTargets(
    value.rollbackOnlyTargets,
    "Main pre-plan rollback-only targets",
  );
  const reconciliation = canonicalEmbeddedReconciliation(value.reconciliation);
  let decision;
  let reason;
  let rollbackAuthorization = null;
  if (reconciliation === null) {
    decision = "capture-new-baseline";
    reason = "no-mapped-release-metadata";
  } else {
    if (reconciliation.allPrior) {
      throw new Error(
        "Pre-plan reconciliation cannot select an all-prior release",
      );
    }
    const sameRelease = reconciliation.manifest.releaseId === expectedReleaseId;
    if (sameRelease) {
      assertFreshRollbackCoverage(reconciliation.manifest, rollbackOnlyTargets);
    }
    if (reconciliation.allCandidate) {
      decision = sameRelease
        ? "verify-existing-release"
        : "capture-new-baseline";
      reason = sameRelease
        ? "current-main-release-already-complete"
        : "older-mapped-release-is-complete";
    } else if (sameRelease) {
      decision = "resume-existing-release";
      reason = "current-main-release-is-an-interrupted-prefix";
    } else {
      decision = "restore-before-planning";
      reason = "older-main-release-is-an-interrupted-prefix";
      rollbackAuthorization = createInheritedRollbackAuthorization({
        reconciliation,
        reason: "restore-inherited",
      });
    }
  }
  if (
    value.decision !== decision ||
    value.reason !== reason ||
    JSON.stringify(value.rollbackAuthorization) !==
      JSON.stringify(rollbackAuthorization)
  ) {
    throw new Error("Pre-plan reconciliation decision is inconsistent");
  }
  return {
    schema: MAIN_PREPLAN_RECONCILIATION_SCHEMA,
    decision,
    reason,
    rollbackOnlyTargets,
    reconciliation,
    rollbackAuthorization,
  };
}

export function decideMainReleaseReconciliation({
  reconciliation,
  currentMain,
  preparation,
}) {
  if (
    !reconciliation ||
    reconciliation.schema !== MAIN_RELEASE_RECONCILIATION_SCHEMA
  ) {
    throw new Error("Main release reconciliation is required");
  }
  const canonical = reconcileMainRelease({
    manifest: reconciliation.manifest,
    candidates: Object.fromEntries(
      reconciliation.observedTargets
        .filter(({ target }) =>
          reconciliation.manifest.stagedTargets.includes(target),
        )
        .map(({ target, candidate }) => [
          target,
          candidate === null
            ? null
            : {
                deploymentId: candidate.deploymentId,
                deploymentUrl: candidate.deploymentUrl,
                manifest: candidate.manifest,
              },
        ]),
    ),
    currentMappings: Object.fromEntries(
      reconciliation.observedTargets.map(({ target, startMappings }) => [
        target,
        startMappings.map(({ state: _state, ...mapping }) => {
          void _state;
          return mapping;
        }),
      ]),
    ),
  });
  if (
    typeof currentMain !== "boolean" ||
    !PREPARATION_STATES.has(preparation)
  ) {
    throw new Error("Release reconciliation decision input is malformed");
  }
  const inheritedPartial =
    !canonical.allPrior &&
    !canonical.allCandidate &&
    canonical.inheritedCandidateAliases.length > 0;
  if (canonical.allCandidate) {
    return {
      decision: currentMain ? "verify-noop" : "superseded-noop",
      rollbackInherited: false,
      reason: currentMain
        ? "release-already-candidate"
        : "release-complete-before-main-advanced",
    };
  }
  if (!currentMain) {
    return inheritedPartial
      ? {
          decision: "restore-inherited",
          rollbackInherited: true,
          reason: "main-advanced-during-partial-release",
        }
      : {
          decision: "superseded-noop",
          rollbackInherited: false,
          reason: "main-advanced-before-release-mutation",
        };
  }
  if (preparation === "failed" || preparation === "pending") {
    return inheritedPartial
      ? {
          decision: "restore-inherited",
          rollbackInherited: true,
          reason:
            preparation === "failed"
              ? "suffix-preparation-failed-after-partial-release"
              : "suffix-preparation-unavailable-after-partial-release",
        }
      : {
          decision: "fail-no-mutation",
          rollbackInherited: false,
          reason:
            preparation === "failed"
              ? "suffix-preparation-failed-before-release-mutation"
              : "suffix-preparation-unavailable-before-release-mutation",
        };
  }
  if (preparation === "producer-live") {
    return {
      decision: "wait",
      rollbackInherited: false,
      reason: "same-attempt-producer-still-live",
    };
  }
  return {
    decision: "converge-forward",
    rollbackInherited: inheritedPartial,
    reason: inheritedPartial
      ? "resume-canonical-release-prefix"
      : "start-release-from-original-priors",
  };
}

export function createInheritedRollbackAuthorization({
  reconciliation,
  reason,
}) {
  if (!["first-forward-command", "restore-inherited"].includes(reason)) {
    throw new Error("Inherited rollback authorization reason is unsupported");
  }
  const canonical = reconcileMainRelease({
    manifest: reconciliation.manifest,
    candidates: Object.fromEntries(
      reconciliation.observedTargets
        .filter(({ target }) =>
          reconciliation.manifest.stagedTargets.includes(target),
        )
        .map(({ target, candidate }) => [
          target,
          candidate === null
            ? null
            : {
                deploymentId: candidate.deploymentId,
                deploymentUrl: candidate.deploymentUrl,
                manifest: candidate.manifest,
              },
        ]),
    ),
    currentMappings: Object.fromEntries(
      reconciliation.observedTargets.map(({ target, startMappings }) => [
        target,
        startMappings.map(({ state: _state, ...mapping }) => {
          void _state;
          return mapping;
        }),
      ]),
    ),
  });
  if (canonical.allCandidate && reason === "restore-inherited") {
    throw new Error(
      "A complete release cannot be auto-rolled back by a reader",
    );
  }
  return {
    reason,
    targets: canonical.targets
      .filter(({ startMappings }) =>
        startMappings.some(({ state }) => state === "candidate"),
      )
      .map(({ target }) => target),
    aliases: [...canonical.inheritedCandidateAliases].sort(),
  };
}
