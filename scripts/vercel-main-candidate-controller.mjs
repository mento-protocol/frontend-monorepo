import {
  MAIN_CANDIDATE_RESOLUTION_SCHEMA,
  assertMainCandidateIntent,
  assertMainCandidateProviderCandidate,
  assertMainCandidateReceipt,
  assertMainCandidateResolution,
  createMainCandidateReceipt,
  resolveMainCandidateProviderState,
} from "./vercel-main-candidate.mjs";
import {
  assertCanonicalOutput,
  canonicalizeDeploymentUrl,
  canonicalizeHostname,
} from "./vercel-deployment-state.mjs";
import {
  MAIN_DEPLOYMENT_TARGETS,
  MAIN_TARGET_CONTRACTS,
} from "./vercel-main-plan.mjs";
import {
  MAIN_RELEASE_ACTIVATION_ORDER,
  assertMainReleaseManifest,
} from "./vercel-main-release-reconciliation.mjs";
import {
  assertOnlyExpectedProductionGeneratedAliases,
  PRODUCTION_GENERATED_ALIAS_TOPOLOGY_MODES,
} from "./vercel-production-generated-aliases.mjs";

const MAIN_CANDIDATE_PREFLIGHT_SCHEMA = "vercel-main-candidate-preflight:v1";
const MAIN_CANDIDATE_HANDOFF_SCHEMA = "vercel-main-candidate-handoff:v1";
const MAIN_PREPLAN_CANDIDATE_DISCOVERY_SCHEMA =
  "vercel-main-preplan-candidate-discovery:v2";

const EMPTY_REUSE_METRICS = Object.freeze({
  buildDurationMs: null,
  deploymentDurationMs: null,
  cacheHit: null,
});

function assertAliasTopologyTarget(intent, aliasTopologyMode) {
  if (
    aliasTopologyMode ===
      PRODUCTION_GENERATED_ALIAS_TOPOLOGY_MODES.SERVED_PRIOR &&
    intent.target === "app"
  ) {
    throw new Error("Served-prior candidate finalization excludes App");
  }
}

function exactKeys(value, keys, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    JSON.stringify(Object.keys(value)) !== JSON.stringify(keys)
  ) {
    throw new Error(`${label} is malformed`);
  }
}

function listing(value) {
  exactKeys(
    value,
    ["deploymentIds", "complete"],
    "Main candidate preflight listing",
  );
  if (
    value.complete !== true ||
    !Array.isArray(value.deploymentIds) ||
    value.deploymentIds.some(
      (id) => typeof id !== "string" || !/^dpl_[A-Za-z0-9]+$/.test(id),
    ) ||
    new Set(value.deploymentIds).size !== value.deploymentIds.length
  ) {
    throw new Error("Main candidate preflight listing is incomplete");
  }
  return [...value.deploymentIds].sort();
}

function canonicalPreplanMappings(value) {
  exactKeys(
    value,
    MAIN_RELEASE_ACTIVATION_ORDER,
    "Main pre-plan current mappings",
  );
  return Object.fromEntries(
    MAIN_RELEASE_ACTIVATION_ORDER.map((target) => {
      if (!Array.isArray(value[target]) || value[target].length === 0) {
        throw new Error(`Main pre-plan ${target} mappings are malformed`);
      }
      const mappings = value[target]
        .map((mapping) => {
          exactKeys(
            mapping,
            ["alias", "deploymentId", "deploymentUrl"],
            `Main pre-plan ${target} mapping`,
          );
          if (
            typeof mapping.deploymentId !== "string" ||
            !/^dpl_[A-Za-z0-9]+$/.test(mapping.deploymentId)
          ) {
            throw new Error(
              `Main pre-plan ${target} deployment ID is malformed`,
            );
          }
          return {
            alias: canonicalizeHostname(mapping.alias),
            deploymentId: mapping.deploymentId,
            deploymentUrl: canonicalizeDeploymentUrl(mapping.deploymentUrl),
          };
        })
        .sort((left, right) => left.alias.localeCompare(right.alias));
      if (
        new Set(mappings.map(({ alias }) => alias)).size !== mappings.length
      ) {
        throw new Error(`Main pre-plan ${target} mappings are ambiguous`);
      }
      return [target, mappings];
    }),
  );
}

function canonicalProjectIds(value) {
  const targets = ["app", "governance", "reserve", "ui"];
  exactKeys(value, targets, "Main pre-plan project IDs");
  return Object.fromEntries(
    targets.map((target) => {
      const projectId = value[target];
      if (
        typeof projectId !== "string" ||
        !/^[A-Za-z0-9._-]+$/.test(projectId)
      ) {
        throw new Error(`Main pre-plan ${target} project ID is malformed`);
      }
      return [target, projectId];
    }),
  );
}

export async function discoverMainPreplanCandidateReleases({
  currentMappings,
  projectIds,
  provider,
}) {
  const mappings = canonicalPreplanMappings(currentMappings);
  const projects = canonicalProjectIds(projectIds);
  if (
    !provider ||
    typeof provider.inspectMappedCandidate !== "function" ||
    typeof provider.resolveReleaseCandidate !== "function"
  ) {
    throw new Error("Main pre-plan candidate provider is required");
  }
  const manifests = new Map();
  const rollbackOnlyTargets = new Set();
  for (const target of MAIN_RELEASE_ACTIVATION_ORDER) {
    const deploymentIds = [
      ...new Set(mappings[target].map(({ deploymentId }) => deploymentId)),
    ].sort();
    for (const deploymentId of deploymentIds) {
      const mapped = await provider.inspectMappedCandidate({
        deploymentId,
        target,
        projectId: projects[target],
      });
      if (mapped.metadata === null) {
        rollbackOnlyTargets.add(target);
        continue;
      }
      const manifest = assertMainReleaseManifest(
        mapped.metadata.releaseManifest,
      );
      const previous = manifests.get(manifest.releaseId);
      if (
        previous !== undefined &&
        JSON.stringify(previous) !== JSON.stringify(manifest)
      ) {
        throw new Error("Mapped candidates disagree on one release manifest");
      }
      manifests.set(manifest.releaseId, manifest);
    }
  }

  const candidateReleases = [];
  for (const manifest of [...manifests.values()].sort((left, right) =>
    left.releaseId.localeCompare(right.releaseId),
  )) {
    const candidates = {};
    for (const target of manifest.stagedTargets) {
      const resolved = await provider.resolveReleaseCandidate({
        manifest,
        target,
        projectId: projects[target],
      });
      candidates[target] =
        resolved === null
          ? null
          : {
              deploymentId: resolved.candidate.deploymentId,
              deploymentUrl: resolved.candidate.deploymentUrl,
              manifest,
            };
    }
    candidateReleases.push({ manifest, candidates });
  }
  return {
    schema: MAIN_PREPLAN_CANDIDATE_DISCOVERY_SCHEMA,
    rollbackOnlyTargets: MAIN_DEPLOYMENT_TARGETS.filter((target) =>
      rollbackOnlyTargets.has(target),
    ),
    candidateReleases,
  };
}

export async function preflightMainCandidateProvider({ intent, provider }) {
  const canonicalIntent = assertMainCandidateIntent(intent);
  if (
    !provider ||
    typeof provider.listCandidateDeploymentIds !== "function" ||
    typeof provider.inspectCandidate !== "function"
  ) {
    throw new Error("Main candidate preflight provider is required");
  }
  const query = {
    projectId: canonicalIntent.projectId,
    releaseId: canonicalIntent.releaseId,
    candidateId: canonicalIntent.candidateId,
    target: canonicalIntent.target,
    environment: canonicalIntent.environment,
    stableIntentDigest: canonicalIntent.stableIntentDigest,
  };
  const ids = listing(await provider.listCandidateDeploymentIds(query));
  if (ids.length > 1)
    throw new Error("Main candidate preflight found multiple candidates");
  const repeatedIds = listing(await provider.listCandidateDeploymentIds(query));
  if (JSON.stringify(repeatedIds) !== JSON.stringify(ids)) {
    throw new Error("Main candidate preflight census changed");
  }
  if (repeatedIds.length > 1)
    throw new Error("Main candidate preflight found multiple candidates");
  if (ids.length === 0) {
    return {
      schema: MAIN_CANDIDATE_PREFLIGHT_SCHEMA,
      outcome: "create-if-zero",
      intent: canonicalIntent,
      candidate: null,
      origin: null,
      metrics: { ...EMPTY_REUSE_METRICS },
    };
  }
  const candidate = assertMainCandidateProviderCandidate(
    await provider.inspectCandidate(ids[0]),
    canonicalIntent,
  );
  return {
    schema: MAIN_CANDIDATE_PREFLIGHT_SCHEMA,
    outcome: "reuse-existing",
    intent: canonicalIntent,
    candidate,
    origin: candidate.metadata.auditOrigin,
    metrics: { ...EMPTY_REUSE_METRICS },
  };
}

export function assertMainCandidatePreflight(value) {
  exactKeys(
    value,
    ["schema", "outcome", "intent", "candidate", "origin", "metrics"],
    "Main candidate preflight",
  );
  const intent = assertMainCandidateIntent(value.intent);
  if (
    value.schema !== MAIN_CANDIDATE_PREFLIGHT_SCHEMA ||
    JSON.stringify(value.metrics) !== JSON.stringify(EMPTY_REUSE_METRICS)
  ) {
    throw new Error("Main candidate preflight metrics or schema is malformed");
  }
  if (value.outcome === "create-if-zero") {
    if (value.candidate !== null || value.origin !== null)
      throw new Error("Zero-candidate preflight is malformed");
    return { ...value, intent, metrics: { ...EMPTY_REUSE_METRICS } };
  }
  if (value.outcome !== "reuse-existing")
    throw new Error("Main candidate preflight outcome is malformed");
  const candidate = assertMainCandidateProviderCandidate(
    value.candidate,
    intent,
  );
  if (
    JSON.stringify(value.origin) !==
    JSON.stringify(candidate.metadata.auditOrigin)
  ) {
    throw new Error("Main candidate preflight origin conflicts with candidate");
  }
  return {
    ...value,
    intent,
    candidate,
    origin: structuredClone(value.origin),
    metrics: { ...EMPTY_REUSE_METRICS },
  };
}

async function resolveMainCandidateHandoffForAliasTopology(
  { intent, provider, smokeCandidate },
  aliasTopologyMode,
) {
  const canonicalIntent = assertMainCandidateIntent(intent);
  assertAliasTopologyTarget(canonicalIntent, aliasTopologyMode);
  if (
    !provider ||
    typeof provider.listCandidateDeploymentIds !== "function" ||
    typeof provider.inspectCandidate !== "function"
  ) {
    throw new Error("Main candidate resolver provider is required");
  }
  const resolution = await resolveMainCandidateProviderState({
    intent: canonicalIntent,
    listCandidateDeploymentIds: provider.listCandidateDeploymentIds,
    inspectCandidate: provider.inspectCandidate,
    smokeCandidate,
  });
  if (resolution.schema !== MAIN_CANDIDATE_RESOLUTION_SCHEMA)
    throw new Error("Main candidate resolver returned an unsupported schema");
  const canonicalResolution = assertMainCandidateResolution(resolution);
  if (canonicalResolution.outcome === "blocked")
    throw new Error(
      `Main candidate resolution blocked: ${canonicalResolution.reason}`,
    );
  if (canonicalResolution.outcome === "create-if-zero")
    return createMainCandidateCreateHandoff({ intent: canonicalIntent });
  const receipt = createMainCandidateReceipt({
    intent: canonicalIntent,
    candidate: canonicalResolution.candidate,
    immutableSmoke: canonicalResolution.immutableSmoke,
  });
  if (typeof provider.inspectCandidateState !== "function")
    throw new Error("Main candidate canonical-state provider is required");
  const canonicalState = assertMainCandidateCanonicalState(
    await provider.inspectCandidateState(receipt.candidate.deploymentId),
    canonicalIntent,
    receipt.candidate,
    aliasTopologyMode,
  );
  return {
    schema: MAIN_CANDIDATE_HANDOFF_SCHEMA,
    action: "reuse",
    executionMode: "reuse",
    intent: canonicalIntent,
    candidate: receipt.candidate,
    canonicalState,
    receipt,
    immutableSmoke: receipt.immutableSmoke,
    metrics: { ...EMPTY_REUSE_METRICS },
  };
}

export async function resolveMainCandidateHandoff(options) {
  return resolveMainCandidateHandoffForAliasTopology(
    options,
    PRODUCTION_GENERATED_ALIAS_TOPOLOGY_MODES.CANDIDATE,
  );
}

export async function resolveMainServedPriorCandidateHandoff(options) {
  return resolveMainCandidateHandoffForAliasTopology(
    options,
    PRODUCTION_GENERATED_ALIAS_TOPOLOGY_MODES.SERVED_PRIOR,
  );
}

function createMainCandidateCreateHandoff({ intent }) {
  const canonicalIntent = assertMainCandidateIntent(intent);
  return {
    schema: MAIN_CANDIDATE_HANDOFF_SCHEMA,
    action: "create",
    executionMode: "build",
    intent: canonicalIntent,
    candidate: null,
    canonicalState: null,
    receipt: null,
    immutableSmoke: null,
    metrics: { ...EMPTY_REUSE_METRICS },
  };
}

function assertMainCandidateCanonicalState(
  value,
  intent,
  candidate,
  aliasTopologyMode,
) {
  const canonicalState = assertCanonicalOutput(value);
  if (
    canonicalState.deploymentId !== candidate.deploymentId ||
    canonicalState.deploymentUrl !== candidate.deploymentUrl ||
    canonicalState.projectId !== intent.projectId ||
    canonicalState.projectName !== intent.projectName ||
    canonicalState.target !== intent.environment.target ||
    canonicalState.customEnvironmentSlug !==
      intent.environment.customEnvironmentSlug ||
    canonicalState.git.sha !== intent.deploySha
  ) {
    throw new Error("Main candidate canonical state conflicts with receipt");
  }
  if (intent.target !== "app") {
    const immutableHostname = new URL(canonicalState.deploymentUrl).hostname;
    if (
      canonicalState.alias !== immutableHostname ||
      canonicalState.aliases.includes(immutableHostname)
    ) {
      throw new Error(
        "Main candidate canonical state violates immutable-host separation",
      );
    }
    let generatedAliases = canonicalState.aliases;
    if (
      aliasTopologyMode ===
      PRODUCTION_GENERATED_ALIAS_TOPOLOGY_MODES.SERVED_PRIOR
    ) {
      const protectedAliases = MAIN_TARGET_CONTRACTS[intent.target].aliases;
      if (
        protectedAliases.some(
          (alias) => !canonicalState.aliases.includes(alias),
        )
      ) {
        throw new Error(
          "Served-prior candidate canonical state is missing its reviewed protected alias",
        );
      }
      generatedAliases = canonicalState.aliases.filter(
        (alias) => !protectedAliases.includes(alias),
      );
    }
    assertOnlyExpectedProductionGeneratedAliases({
      aliases: generatedAliases,
      creatorUsername: canonicalState.creatorUsername,
      logicalTarget: intent.target,
      mode: aliasTopologyMode,
    });
  }
  return canonicalState;
}

function assertMainCandidateHandoffForAliasTopology(value, aliasTopologyMode) {
  exactKeys(
    value,
    [
      "schema",
      "action",
      "executionMode",
      "intent",
      "candidate",
      "canonicalState",
      "receipt",
      "immutableSmoke",
      "metrics",
    ],
    "Main candidate handoff",
  );
  const intent = assertMainCandidateIntent(value.intent);
  assertAliasTopologyTarget(intent, aliasTopologyMode);
  if (
    value.schema !== MAIN_CANDIDATE_HANDOFF_SCHEMA ||
    JSON.stringify(value.metrics) !== JSON.stringify(EMPTY_REUSE_METRICS)
  )
    throw new Error("Main candidate handoff schema or metrics is malformed");
  if (value.action === "create") {
    if (
      value.executionMode !== "build" ||
      value.candidate !== null ||
      value.canonicalState !== null ||
      value.receipt !== null ||
      value.immutableSmoke !== null
    )
      throw new Error("Create main candidate handoff is malformed");
    return { ...value, intent, metrics: { ...EMPTY_REUSE_METRICS } };
  }
  if (value.action !== "reuse" || value.executionMode !== "reuse")
    throw new Error("Reuse main candidate handoff is malformed");
  const receipt = assertMainCandidateReceipt(value.receipt, intent);
  if (
    JSON.stringify(value.candidate) !== JSON.stringify(receipt.candidate) ||
    JSON.stringify(value.immutableSmoke) !==
      JSON.stringify(receipt.immutableSmoke)
  )
    throw new Error("Reuse main candidate handoff conflicts with receipt");
  const canonicalState = assertMainCandidateCanonicalState(
    value.canonicalState,
    intent,
    receipt.candidate,
    aliasTopologyMode,
  );
  return {
    ...value,
    intent,
    candidate: receipt.candidate,
    canonicalState,
    receipt,
    immutableSmoke: receipt.immutableSmoke,
    metrics: { ...EMPTY_REUSE_METRICS },
  };
}

export function assertMainCandidateHandoff(value) {
  return assertMainCandidateHandoffForAliasTopology(
    value,
    PRODUCTION_GENERATED_ALIAS_TOPOLOGY_MODES.CANDIDATE,
  );
}

export function assertMainServedPriorCandidateHandoff(value) {
  return assertMainCandidateHandoffForAliasTopology(
    value,
    PRODUCTION_GENERATED_ALIAS_TOPOLOGY_MODES.SERVED_PRIOR,
  );
}
