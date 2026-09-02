import { createHash } from "node:crypto";

import {
  acceptsPriorEnvironment,
  MAIN_DEPLOYMENT_TARGETS,
  MAIN_TARGET_CONTRACTS,
  MAX_RIDER_ALIASES,
  assertMainDeploymentPlan,
  partitionMainOwnership,
  planMainDeployments,
} from "./vercel-main-plan.mjs";
import {
  canonicalizeDeploymentUrl,
  canonicalizeHostname,
} from "./vercel-deployment-url.mjs";
import { generateVercelMainReleaseId } from "./vercel-prebuilt.mjs";

// A release manifest is durable cross-run state, and every candidate seal
// embeds an immutable copy of the one its release was planned from. `:v3` adds
// the per-target `riderAliases` list; `:v2` seals predate it and can never grow
// the field. Both decode, and a decoded manifest keeps the schema tag it was
// sealed with, so re-validating a decoded manifest is stable. The difference is
// exactly one key: a `:v2` prior has no `riderAliases`, a `:v3` prior must have
// it. Everything else is validated identically, so a corrupt manifest is never
// mistaken for an older one. Readers that want the list use
// `manifestRiderAliases`, which answers `null` for "this manifest predates
// rider capture" — never "this deployment carried no riders".
const MAIN_RELEASE_MANIFEST_SCHEMA_V2 = "vercel-main-release-manifest:v2";
const MAIN_RELEASE_MANIFEST_SCHEMA_V3 = "vercel-main-release-manifest:v3";
const MAIN_RELEASE_MANIFEST_SCHEMAS = Object.freeze([
  MAIN_RELEASE_MANIFEST_SCHEMA_V2,
  MAIN_RELEASE_MANIFEST_SCHEMA_V3,
]);
const MAIN_RELEASE_MANIFEST_SCHEMA = MAIN_RELEASE_MANIFEST_SCHEMA_V3;
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
const PRIOR_KEYS_V2 = Object.freeze([
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
const PRIOR_KEYS_V3 = Object.freeze([
  "deploymentId",
  "deploymentUrl",
  "aliases",
  "riderAliases",
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
// A reviewed target maps exactly one alias, so its release state is either
// wholly prior or wholly candidate. "mixed" is only ever malformed evidence.
const TARGET_STATES = new Set(["prior", "candidate"]);
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

// A candidate seal is immutable, so a manifest sealed while `app.mento.org`
// still hung off the retired `v3` custom environment stays readable forever: an
// operator may re-map such a deployment by rolling back at any time. Exactly
// one difference from the current environment contract is permitted, and only
// on the App prior — the deployment the reviewed App domain served *before*
// that release (this is independent of the manifest schema tag, which admits
// `:v2` and `:v3` on every path):
// the retired custom environment, with either the single reviewed alias that
// the bridge era sealed or the two-alias topology that preceded it. Every other
// field of every prior is validated by the same machinery either way, so a
// corrupt manifest is never mistaken for a bridge-era one. This admission is
// permanent, not transitional.
const BRIDGE_ERA_APP_PRIOR_ENVIRONMENT = Object.freeze({
  target: null,
  customEnvironmentSlug: "v3",
});
const BRIDGE_ERA_APP_ALIAS_TOPOLOGIES = Object.freeze([
  Object.freeze(["app.mento.org"]),
  Object.freeze(["app.mento.org", "appmentoorg-env-v3-mentolabs.vercel.app"]),
]);

function reviewedAliasContract(target, bridgeEraAppAliases) {
  return target === "app" && bridgeEraAppAliases !== null
    ? bridgeEraAppAliases
    : MAIN_TARGET_CONTRACTS[target].aliases;
}

function isBridgeEraAppPriorEnvironment(target, value) {
  return (
    target === "app" &&
    value?.target === BRIDGE_ERA_APP_PRIOR_ENVIRONMENT.target &&
    value?.customEnvironmentSlug ===
      BRIDGE_ERA_APP_PRIOR_ENVIRONMENT.customEnvironmentSlug
  );
}

function canonicalAliases(value, target, label, bridgeEraAppAliases = null) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} is malformed`);
  }
  const aliases = value.map(canonicalizeHostname);
  const canonical = [...new Set(aliases)].sort();
  const expected = [
    ...reviewedAliasContract(target, bridgeEraAppAliases),
  ].sort();
  if (
    JSON.stringify(value) !== JSON.stringify(canonical) ||
    JSON.stringify(canonical) !== JSON.stringify(expected)
  ) {
    throw new Error(`${label} does not match the reviewed topology`);
  }
  return canonical;
}

// Rider domains are informational, so this checks shape only: canonical
// hostnames, sorted, deduplicated, bounded, and disjoint from the reviewed
// topology recorded beside them. Which riders are acceptable stays a planning
// question — `canonicalizeOptionalDeploymentAliases` already refuses another
// main target's reviewed protected domain before a manifest is ever built.
function canonicalRiderAliases(value, reviewedAliases, label) {
  if (!Array.isArray(value) || value.length > MAX_RIDER_ALIASES) {
    throw new Error(`${label} is malformed`);
  }
  let aliases;
  try {
    aliases = value.map(canonicalizeHostname);
  } catch {
    throw new Error(`${label} is malformed`);
  }
  const canonical = [...new Set(aliases)].sort();
  if (JSON.stringify(value) !== JSON.stringify(canonical)) {
    throw new Error(`${label} is not canonical`);
  }
  const reviewed = new Set(reviewedAliases);
  if (canonical.some((alias) => reviewed.has(alias))) {
    throw new Error(`${label} overlap the reviewed topology`);
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

function canonicalPlanningLeaves(
  value,
  target,
  prior,
  label,
  bridgeEraAppAliases = null,
) {
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
      bridgeEraAppAliases,
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

function canonicalPrior(
  value,
  target,
  label,
  { bridgeEraAppAliases = null, schema = MAIN_RELEASE_MANIFEST_SCHEMA } = {},
) {
  const carriesRiders = schema === MAIN_RELEASE_MANIFEST_SCHEMA_V3;
  assertExactKeys(value, carriesRiders ? PRIOR_KEYS_V3 : PRIOR_KEYS_V2, label);
  const contract = MAIN_TARGET_CONTRACTS[target];
  // Every prior is held to the same production environment contract as a
  // candidate, except an App prior inside a bridge-era manifest, which carries
  // the retired custom environment the reviewed domain served from back then.
  const accepted =
    acceptsPriorEnvironment(target, value) ||
    (bridgeEraAppAliases !== null &&
      isBridgeEraAppPriorEnvironment(target, value));
  const environment = accepted
    ? {
        target: value.target,
        customEnvironmentSlug: value.customEnvironmentSlug,
      }
    : null;
  const servedSha =
    value.servedSha === null
      ? null
      : requireString(value.servedSha, `${label} served SHA`, SHA_PATTERN);
  const aliases = canonicalAliases(
    value.aliases,
    target,
    `${label} aliases`,
    bridgeEraAppAliases,
  );
  const prior = {
    deploymentId: requireString(
      value.deploymentId,
      `${label} deployment ID`,
      DEPLOYMENT_ID_PATTERN,
    ),
    deploymentUrl: canonicalizeDeploymentUrl(value.deploymentUrl),
    aliases,
    ...(carriesRiders
      ? {
          riderAliases: canonicalRiderAliases(
            value.riderAliases,
            aliases,
            `${label} rider aliases`,
          ),
        }
      : {}),
    projectId: requireString(
      value.projectId,
      `${label} project ID`,
      /^[A-Za-z0-9._-]+$/,
    ),
    projectName: contract.projectName,
    readyState: "READY",
    target: environment === null ? contract.target : environment.target,
    customEnvironmentSlug:
      environment === null
        ? contract.customEnvironmentSlug
        : environment.customEnvironmentSlug,
  };
  if (
    value.projectName !== contract.projectName ||
    value.readyState !== "READY" ||
    environment === null
  ) {
    throw new Error(`${label} planning identity is malformed`);
  }
  const planningLeaves = canonicalPlanningLeaves(
    value.planningLeaves,
    target,
    prior,
    `${label} planning leaves`,
    bridgeEraAppAliases,
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

function assertReleaseManifest(value, bridgeEraAppAliases) {
  assertExactKeys(value, MANIFEST_KEYS, "Main release manifest");
  if (
    !MAIN_RELEASE_MANIFEST_SCHEMAS.includes(value.schema) ||
    value.repository !== REPOSITORY
  ) {
    throw new Error("Main release manifest schema is unsupported");
  }
  const schema = value.schema;
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
        { bridgeEraAppAliases, schema },
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
    schema,
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

export function assertMainReleaseManifest(value) {
  return assertReleaseManifest(value, null);
}

// The rider domains a target's served prior carried, or `null` when the
// manifest is a `:v2` seal that predates rider capture. Evidence renders that
// difference as "unknown" rather than "none": a manifest without the field
// proves nothing about what rode along. This is a reporting accessor — no
// selection, verification, or recovery decision may call it.
export function manifestRiderAliases(manifest, target) {
  const riders = manifest?.originalPriors?.[target]?.riderAliases;
  return Array.isArray(riders) ? [...riders] : null;
}

// Admits a manifest that is a structurally valid current manifest in every
// respect except its App prior, which carries the retired `v3` custom
// environment and one of the two alias topologies that environment ever had.
// A candidate seal is immutable, so this stays reachable permanently: rolling
// a reviewed domain back to a deployment sealed during or before the bridge
// era re-maps such a manifest. The caller treats the result as an unmarked
// rollback-only prior — no attempt of the current release can reconcile or
// resume it — and anything corrupt elsewhere still fails closed here.
export function assertBridgeEraReleaseManifest(value) {
  let lastError;
  for (const aliases of BRIDGE_ERA_APP_ALIAS_TOPOLOGIES) {
    let manifest;
    try {
      manifest = assertReleaseManifest(value, aliases);
    } catch (error) {
      lastError = error;
      continue;
    }
    if (
      JSON.stringify(manifest.originalPriors.app.aliases) ===
        JSON.stringify([...aliases].sort()) &&
      isBridgeEraAppPriorEnvironment("app", manifest.originalPriors.app)
    ) {
      return manifest;
    }
    lastError = new Error("Main release manifest is not a bridge-era manifest");
  }
  throw (
    lastError ?? new Error("Main release manifest is not a bridge-era manifest")
  );
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
  // Every reviewed target maps exactly one alias, so a mixed state can only
  // come from malformed evidence.
  if (!TARGET_STATES.has(state)) {
    throw new Error(`${target} release mapping state is unsupported`);
  }
  return {
    state,
    mappings: classifiedMappings,
  };
}

function isTerminalAppRecoveryResidual(targets) {
  // A failed App command can leave its manifest-bound candidate mapped after
  // recovery has already restored every ordinary target. That exact terminal
  // shape is recoverable only by restoring App; it is never a forward prefix.
  return (
    targets.length > 1 &&
    targets.at(-1)?.target === "app" &&
    targets.at(-1)?.state === "candidate" &&
    targets.slice(0, -1).every(({ state }) => state === "prior")
  );
}

function assertActivationPrefix(
  targets,
  { allowTerminalAppRecoveryResidual = false } = {},
) {
  if (
    allowTerminalAppRecoveryResidual &&
    isTerminalAppRecoveryResidual(targets)
  ) {
    return;
  }

  let reachedFrontier = false;
  for (const target of targets) {
    if (target.state === "candidate") {
      if (reachedFrontier) {
        throw new Error(
          "Release candidate mappings are not an activation prefix",
        );
      }
      continue;
    }
    reachedFrontier = true;
  }
}

function reconcileMainReleaseWithPolicy(
  { manifest: rawManifest, candidates, currentMappings },
  { allowTerminalAppRecoveryResidual },
) {
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
  assertActivationPrefix(targets, { allowTerminalAppRecoveryResidual });
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

export function reconcileMainRelease(input) {
  return reconcileMainReleaseWithPolicy(input, {
    allowTerminalAppRecoveryResidual: false,
  });
}

export function reconcileMainReleaseForRecovery(input) {
  return reconcileMainReleaseWithPolicy(input, {
    allowTerminalAppRecoveryResidual: true,
  });
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
      const reconciliation = reconcileMainReleaseForRecovery({
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
  const terminalAppRecoveryResidual = isTerminalAppRecoveryResidual(
    reconciliation.targets,
  );
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
  if (sameRelease && !terminalAppRecoveryResidual) {
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
    reason: terminalAppRecoveryResidual
      ? sameRelease
        ? "current-main-release-is-an-app-recovery-residual"
        : "older-main-release-is-an-app-recovery-residual"
      : "older-main-release-is-an-interrupted-prefix",
    rollbackOnlyTargets: canonicalRollbackOnly,
    reconciliation,
    rollbackAuthorization: createInheritedRollbackAuthorization({
      reconciliation,
      reason: "restore-inherited",
    }),
  };
}

function reconciliationInput(value) {
  return {
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
  };
}

function canonicalEmbeddedReconciliation(value) {
  if (value === null) return null;
  const canonical = reconcileMainReleaseForRecovery(reconciliationInput(value));
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
    const terminalAppRecoveryResidual = isTerminalAppRecoveryResidual(
      reconciliation.targets,
    );
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
    } else if (sameRelease && !terminalAppRecoveryResidual) {
      decision = "resume-existing-release";
      reason = "current-main-release-is-an-interrupted-prefix";
    } else {
      decision = "restore-before-planning";
      reason = terminalAppRecoveryResidual
        ? sameRelease
          ? "current-main-release-is-an-app-recovery-residual"
          : "older-main-release-is-an-app-recovery-residual"
        : "older-main-release-is-an-interrupted-prefix";
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
  const canonical = reconcileMainReleaseForRecovery(
    reconciliationInput(reconciliation),
  );
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
  const terminalAppRecoveryResidual = isTerminalAppRecoveryResidual(
    canonical.targets,
  );
  if (canonical.allCandidate) {
    return {
      decision: currentMain ? "verify-noop" : "superseded-noop",
      rollbackInherited: false,
      reason: currentMain
        ? "release-already-candidate"
        : "release-complete-before-main-advanced",
    };
  }
  if (terminalAppRecoveryResidual) {
    return {
      decision: "restore-inherited",
      rollbackInherited: true,
      reason: "terminal-app-recovery-residual",
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
  const input = reconciliationInput(reconciliation);
  const canonical =
    reason === "restore-inherited"
      ? reconcileMainReleaseForRecovery(input)
      : reconcileMainRelease(input);
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
