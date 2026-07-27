#!/usr/bin/env node

import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  parse,
  resolve,
  sep,
} from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  VercelStateClient,
  assertCanonicalOutput,
  assertMainPlanningSnapshot,
  canonicalizeDeploymentUrl,
} from "./vercel-deployment-state.mjs";
import {
  assertMainCandidateHandoff,
  assertMainCandidatePreflight,
  discoverMainPreplanCandidateReleases,
  preflightMainCandidateProvider,
  resolveMainCandidateHandoff,
} from "./vercel-main-candidate-controller.mjs";
import {
  assertMainCandidateIntent,
  assertMainCandidateProviderCandidate,
  encodeMainCandidateReceipt,
} from "./vercel-main-candidate.mjs";
import { createMainCandidateVercelProvider } from "./vercel-main-candidate-provider.mjs";
import {
  MAIN_RELEASE_ACTIVATION_ORDER,
  assertMainReleaseManifest,
  assertMainPreplanReconciliation,
  decideMainPreplanReconciliation,
} from "./vercel-main-release-reconciliation.mjs";
import {
  MAIN_DEPLOYMENT_TARGETS,
  MAIN_TARGET_CONTRACTS,
} from "./vercel-main-plan.mjs";
import { generateVercelMainReleaseId } from "./vercel-prebuilt.mjs";

export const MAIN_PROVIDER_CLI_MAX_JSON_BYTES = 256 * 1024;
export const MAIN_PREPLAN_HANDOFF_MAX_ENCODED_BYTES = 64 * 1024;
export const MAIN_PROVIDER_CLI_RETRY_EXIT_CODE = 75;
export const MAIN_CANONICAL_MAPPINGS_SCHEMA =
  "vercel-main-canonical-mappings:v1";
const MAIN_PROVIDER_DISCOVERY_SCHEMA = "vercel-main-provider-discovery:v2";

const PROJECT_TARGETS = Object.freeze(["app", "governance", "reserve", "ui"]);
const LEGACY_ALIAS = "v2-app.mento.org";
const LEGACY_ALIASES = Object.freeze(
  [
    LEGACY_ALIAS,
    "appmentoorg-git-v2-mentolabs.vercel.app",
    "appmentoorg-mentolabs.vercel.app",
    "appmentoorg.vercel.app",
  ].sort(),
);
const CLI_OPTIONS = Object.freeze({
  "preplan-discover": Object.freeze([
    "planning-snapshot",
    "legacy-snapshot",
    "project-ids",
    "output",
  ]),
  "preplan-decide": Object.freeze([
    "discovery",
    "planning-snapshot",
    "legacy-snapshot",
    "output",
  ]),
  "preplan-materialize": Object.freeze(["output"]),
  "canonical-mappings": Object.freeze(["planning-snapshot", "output"]),
  "candidate-preflight": Object.freeze(["intent", "output"]),
  "candidate-smoke": Object.freeze(["intent", "output"]),
  "candidate-finalize": Object.freeze(["intent", "smoke", "output"]),
});
const OPTIONAL_OPTIONS = Object.freeze({
  "canonical-mappings": new Set(["legacy-snapshot"]),
});
const DISCOVERY_SCHEMA = "vercel-main-preplan-candidate-discovery:v2";
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const SHA_PATTERN = /^[a-f0-9]{40}$/;
const POSITIVE_ID_PATTERN = /^[1-9][0-9]*$/;
const DEPLOYMENT_ID_PATTERN = /^dpl_[A-Za-z0-9]+$/;
const PROJECT_ID_PATTERN = /^[A-Za-z0-9._-]+$/;
const VERCEL_READ_FAILURE_KINDS = new Map([
  ["VERCEL_API_READ_TIMEOUT", "read-timeout"],
  ["VERCEL_API_READ_TRANSPORT", "read-transport"],
  ["VERCEL_API_READ_RATE_LIMITED", "read-rate-limited"],
  ["VERCEL_API_READ_HTTP", "read-http"],
  ["VERCEL_API_READ_MALFORMED", "read-malformed"],
]);
const PREPLAN_POST_CENSUS_FAILURE_CODES = new Set([
  "preplan-private-output-write-failed",
  "preplan-handoff-encode-failed",
  "preplan-github-output-append-failed",
]);
const SAFE_MAIN_PROVIDER_FAILURE_CODES = new Set([
  ...["planning-census", "legacy-census"].flatMap((stage) => [
    `${stage}-read-timeout`,
    `${stage}-read-transport`,
    `${stage}-read-rate-limited`,
    `${stage}-read-http`,
    `${stage}-read-malformed`,
    `${stage}-unstable`,
    `${stage}-stale`,
    `${stage}-failed`,
  ]),
  "preplan-reconciliation-failed",
  ...PREPLAN_POST_CENSUS_FAILURE_CODES,
]);
const RETRYABLE_MAIN_PROVIDER_FAILURE_CODES = new Set([
  "planning-census-unstable",
  "planning-census-stale",
  "legacy-census-unstable",
  "legacy-census-stale",
]);
const MAIN_PROVIDER_OBSERVATION_FAILURE = Object.freeze({
  planningUnstable: "planning-census-unstable",
  planningStale: "planning-census-stale",
  legacyUnstable: "legacy-census-unstable",
  legacyStale: "legacy-census-stale",
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

function canonicalProjectIds(value) {
  assertExactKeys(value, PROJECT_TARGETS, "Main provider project IDs");
  return Object.fromEntries(
    PROJECT_TARGETS.map((target) => {
      const projectId = value[target];
      if (
        typeof projectId !== "string" ||
        !PROJECT_ID_PATTERN.test(projectId)
      ) {
        throw new Error(`Main provider ${target} project ID is malformed`);
      }
      return [target, projectId];
    }),
  );
}

function projectIdsFromEnvironment(env) {
  return canonicalProjectIds({
    app: env.VERCEL_PROJECT_ID_APP,
    governance: env.VERCEL_PROJECT_ID_GOVERNANCE,
    reserve: env.VERCEL_PROJECT_ID_RESERVE,
    ui: env.VERCEL_PROJECT_ID_UI,
  });
}

function sameDeployment(left, right) {
  return (
    left.deploymentId === right.deploymentId &&
    left.deploymentUrl === right.deploymentUrl
  );
}

function mappingFromState(state) {
  if (
    typeof state.deploymentId !== "string" ||
    !DEPLOYMENT_ID_PATTERN.test(state.deploymentId)
  ) {
    throw new Error("Main canonical mapping deployment ID is malformed");
  }
  return {
    alias: state.alias,
    deploymentId: state.deploymentId,
    deploymentUrl: canonicalizeDeploymentUrl(state.deploymentUrl),
  };
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function planningSnapshotDigest(value) {
  return digest(assertMainPlanningSnapshot(value));
}

export function digestMainLegacyV2Snapshot(value) {
  const snapshot = assertCanonicalOutput(value);
  if (!Array.isArray(snapshot) || snapshot.length !== 1) {
    throw new Error("Legacy v2 snapshot must contain exactly one state");
  }
  return digest(snapshot[0]);
}

export function createMainCanonicalMappings({
  planningSnapshot,
  projectIds,
  legacySnapshot = null,
}) {
  const snapshot = assertMainPlanningSnapshot(planningSnapshot);
  const projects = canonicalProjectIds(projectIds);
  const expectedAliases = MAIN_RELEASE_ACTIVATION_ORDER.flatMap(
    (target) => MAIN_TARGET_CONTRACTS[target].aliases,
  ).sort();
  if (
    JSON.stringify(snapshot.states.map(({ alias }) => alias)) !==
    JSON.stringify(expectedAliases)
  ) {
    throw new Error(
      "Main planning snapshot does not exactly cover reviewed aliases",
    );
  }

  const mappings = {};
  for (const target of MAIN_RELEASE_ACTIVATION_ORDER) {
    const contract = MAIN_TARGET_CONTRACTS[target];
    const states = contract.aliases
      .map((alias) => snapshot.states.find((state) => state.alias === alias))
      .sort((left, right) => left.alias.localeCompare(right.alias));
    if (states.some((state) => state === undefined)) {
      throw new Error(`Main planning snapshot is incomplete for ${target}`);
    }
    for (const state of states) {
      if (
        state.projectId !== projects[target] ||
        state.projectName !== contract.projectName ||
        state.target !== contract.target ||
        state.customEnvironmentSlug !== contract.customEnvironmentSlug ||
        state.readyState !== "READY" ||
        !state.aliases.includes(state.alias)
      ) {
        throw new Error(
          `Main planning snapshot identity conflicts for ${state.alias}`,
        );
      }
    }
    if (
      states.some((state) => !sameDeployment(states[0], state)) ||
      (target === "app" &&
        states.some(
          (state) =>
            JSON.stringify(state.aliases) !==
            JSON.stringify([...contract.aliases].sort()),
        ))
    ) {
      throw new Error(
        `Main planning snapshot topology conflicts for ${target}`,
      );
    }
    mappings[target] = states.map(mappingFromState);
  }

  if (legacySnapshot !== null) {
    assertCanonicalOutput(legacySnapshot);
    if (!Array.isArray(legacySnapshot) || legacySnapshot.length !== 1) {
      throw new Error("Legacy v2 snapshot must contain exactly one state");
    }
    const state = legacySnapshot[0];
    if (
      state.alias !== LEGACY_ALIAS ||
      state.projectId !== projects.app ||
      state.projectName !== MAIN_TARGET_CONTRACTS.app.projectName ||
      state.target !== "production" ||
      state.customEnvironmentSlug !== null ||
      state.readyState !== "READY" ||
      state.git.org !== "mento-protocol" ||
      state.git.repo !== "frontend-monorepo" ||
      state.git.ref !== "v2" ||
      JSON.stringify(state.aliases) !== JSON.stringify(LEGACY_ALIASES)
    ) {
      throw new Error("Legacy v2 snapshot identity or topology conflicts");
    }
    mappings["legacy-app"] = state.aliases.map((alias) =>
      mappingFromState({ ...state, alias }),
    );
  }

  return {
    schema: MAIN_CANONICAL_MAPPINGS_SCHEMA,
    mappings,
  };
}

function assertDiscovery(value) {
  assertExactKeys(
    value,
    ["schema", "rollbackOnlyTargets", "candidateReleases"],
    "Main pre-plan candidate discovery",
  );
  if (
    value.schema !== DISCOVERY_SCHEMA ||
    !Array.isArray(value.rollbackOnlyTargets) ||
    JSON.stringify(
      MAIN_DEPLOYMENT_TARGETS.filter((target) =>
        value.rollbackOnlyTargets.includes(target),
      ),
    ) !== JSON.stringify(value.rollbackOnlyTargets) ||
    !Array.isArray(value.candidateReleases)
  ) {
    throw new Error("Main pre-plan candidate discovery is malformed");
  }
  let previousReleaseId = null;
  for (const release of value.candidateReleases) {
    assertExactKeys(
      release,
      ["manifest", "candidates"],
      "Main discovered candidate release",
    );
    const manifest = assertMainReleaseManifest(release.manifest);
    if (previousReleaseId !== null && manifest.releaseId <= previousReleaseId) {
      throw new Error("Main discovered release order is not canonical");
    }
    previousReleaseId = manifest.releaseId;
    assertExactKeys(
      release.candidates,
      manifest.stagedTargets,
      "Main discovered release candidates",
    );
    for (const target of manifest.stagedTargets) {
      const candidate = release.candidates[target];
      if (candidate === null) continue;
      assertExactKeys(
        candidate,
        ["deploymentId", "deploymentUrl", "manifest"],
        "Main discovered release candidate",
      );
      if (
        typeof candidate.deploymentId !== "string" ||
        !DEPLOYMENT_ID_PATTERN.test(candidate.deploymentId) ||
        canonicalizeDeploymentUrl(candidate.deploymentUrl) !==
          candidate.deploymentUrl ||
        JSON.stringify(candidate.manifest) !== JSON.stringify(manifest)
      ) {
        throw new Error("Main discovered release candidate is malformed");
      }
    }
  }
  return value;
}

function createDiscoveryEnvelope({
  planningSnapshot,
  legacySnapshot,
  projectIds,
  discovery,
}) {
  return {
    schema: MAIN_PROVIDER_DISCOVERY_SCHEMA,
    planningSnapshotDigest: planningSnapshotDigest(planningSnapshot),
    legacyAppV2Digest: digestMainLegacyV2Snapshot(legacySnapshot),
    projectIds: canonicalProjectIds(projectIds),
    discovery: assertDiscovery(discovery),
  };
}

function legacyV2Expectation(snapshot) {
  const canonical = assertCanonicalOutput(snapshot);
  if (!Array.isArray(canonical) || canonical.length !== 1) {
    throw new Error("Legacy v2 snapshot must contain exactly one state");
  }
  const state = canonical[0];
  return {
    alias: state.alias,
    deployment: state.deploymentId,
    deploymentUrl: state.deploymentUrl,
    projectId: state.projectId,
    projectName: state.projectName,
    readyState: state.readyState,
    target: state.target,
    customEnvironmentSlug: state.customEnvironmentSlug,
    git: structuredClone(state.git),
  };
}

export function assertMainProviderDiscovery(value) {
  assertExactKeys(
    value,
    [
      "schema",
      "planningSnapshotDigest",
      "legacyAppV2Digest",
      "projectIds",
      "discovery",
    ],
    "Main provider discovery",
  );
  if (
    value.schema !== MAIN_PROVIDER_DISCOVERY_SCHEMA ||
    typeof value.planningSnapshotDigest !== "string" ||
    !DIGEST_PATTERN.test(value.planningSnapshotDigest) ||
    typeof value.legacyAppV2Digest !== "string" ||
    !DIGEST_PATTERN.test(value.legacyAppV2Digest)
  ) {
    throw new Error("Main provider discovery identity is malformed");
  }
  return {
    schema: value.schema,
    planningSnapshotDigest: value.planningSnapshotDigest,
    legacyAppV2Digest: value.legacyAppV2Digest,
    projectIds: canonicalProjectIds(value.projectIds),
    discovery: assertDiscovery(value.discovery),
  };
}

function parseArguments(argv) {
  if (!Array.isArray(argv) || !Object.hasOwn(CLI_OPTIONS, argv[0])) {
    throw new Error("Main provider command is missing or unsupported");
  }
  const command = argv[0];
  const required = new Set(CLI_OPTIONS[command]);
  const optional = OPTIONAL_OPTIONS[command] ?? new Set();
  const allowed = new Set([...required, ...optional]);
  const options = Object.create(null);
  for (let index = 1; index < argv.length; index += 2) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (typeof argument !== "string" || !/^--[a-z][a-z-]*$/.test(argument)) {
      throw new Error("Main provider arguments are malformed");
    }
    const name = argument.slice(2);
    if (!allowed.has(name)) {
      throw new Error("Main provider option is unsupported");
    }
    if (Object.hasOwn(options, name)) {
      throw new Error("Main provider option is duplicated");
    }
    if (
      typeof value !== "string" ||
      value.length === 0 ||
      value.startsWith("--")
    ) {
      throw new Error("Main provider option value is missing");
    }
    options[name] = value;
  }
  if ([...required].some((name) => !Object.hasOwn(options, name))) {
    throw new Error("Main provider required option is missing");
  }
  return { command, options };
}

export function reviewedRunnerTemp(path) {
  if (typeof path !== "string" || !isAbsolute(path) || resolve(path) !== path) {
    throw new Error("RUNNER_TEMP is missing or unsafe");
  }
  const root = parse(path).root;
  let current = root;
  for (const component of path.slice(root.length).split(sep).filter(Boolean)) {
    current = resolve(current, component);
    const stats = lstatSync(current);
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new Error("RUNNER_TEMP is missing or unsafe");
    }
  }
  if (realpathSync(path) !== path) {
    throw new Error("RUNNER_TEMP is missing or unsafe");
  }
  return path;
}

function privatePath(path, runnerTemp, label) {
  const directory = reviewedRunnerTemp(runnerTemp);
  if (
    typeof path !== "string" ||
    !isAbsolute(path) ||
    resolve(path) !== path ||
    dirname(path) !== directory
  ) {
    throw new Error(`${label} path is missing or unsafe`);
  }
  return path;
}

function containedPath(path, runnerTemp, label) {
  const directory = reviewedRunnerTemp(runnerTemp);
  if (
    typeof path !== "string" ||
    !isAbsolute(path) ||
    resolve(path) !== path ||
    !path.startsWith(`${directory}${sep}`)
  ) {
    throw new Error(`${label} path is missing or unsafe`);
  }
  let current = directory;
  const relativeDirectory = dirname(path).slice(directory.length);
  for (const component of relativeDirectory.split(sep).filter(Boolean)) {
    current = resolve(current, component);
    const stats = lstatSync(current);
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new Error(`${label} path is missing or unsafe`);
    }
  }
  if (realpathSync(dirname(path)) !== dirname(path)) {
    throw new Error(`${label} path is missing or unsafe`);
  }
  return path;
}

export function readPrivateJson(
  path,
  label,
  runnerTemp,
  maxBytes = MAIN_PROVIDER_CLI_MAX_JSON_BYTES,
) {
  const inputPath = privatePath(path, runnerTemp, label);
  let descriptor;
  try {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
      throw new Error("unsafe");
    }
    descriptor = openSync(inputPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stats = fstatSync(descriptor);
    const pathStats = lstatSync(inputPath);
    if (
      !stats.isFile() ||
      stats.nlink !== 1 ||
      pathStats.isSymbolicLink() ||
      stats.dev !== pathStats.dev ||
      stats.ino !== pathStats.ino ||
      (stats.mode & 0o077) !== 0 ||
      stats.size < 2 ||
      stats.size > maxBytes
    ) {
      throw new Error("unsafe");
    }
    return JSON.parse(readFileSync(descriptor, "utf8"));
  } catch {
    throw new Error(`${label} is missing, unsafe, or malformed`);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export function writePrivateJson(
  path,
  value,
  runnerTemp,
  maxBytes = MAIN_PROVIDER_CLI_MAX_JSON_BYTES,
) {
  const outputPath = privatePath(path, runnerTemp, "Main provider output");
  const serialized = `${JSON.stringify(value)}\n`;
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    Buffer.byteLength(serialized, "utf8") > maxBytes
  ) {
    throw new Error("Main provider output exceeds its size bound");
  }
  const temporaryPath = join(
    runnerTemp,
    `.${basename(outputPath)}.${process.pid}.${randomUUID()}`,
  );
  let descriptor;
  let linked = false;
  try {
    descriptor = openSync(
      temporaryPath,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    fchmodSync(descriptor, 0o600);
    writeFileSync(descriptor, serialized);
    fsyncSync(descriptor);
    const stats = fstatSync(descriptor);
    if (
      !stats.isFile() ||
      stats.nlink !== 1 ||
      (stats.mode & 0o777) !== 0o600
    ) {
      throw new Error("unsafe");
    }
    closeSync(descriptor);
    descriptor = undefined;
    linkSync(temporaryPath, outputPath);
    linked = true;
    unlinkSync(temporaryPath);
    const outputStats = lstatSync(outputPath);
    if (
      !outputStats.isFile() ||
      outputStats.isSymbolicLink() ||
      outputStats.nlink !== 1 ||
      (outputStats.mode & 0o777) !== 0o600
    ) {
      throw new Error("unsafe");
    }
  } catch {
    try {
      if (descriptor !== undefined) closeSync(descriptor);
    } catch {
      // Preserve the primary safe-write failure.
    }
    try {
      unlinkSync(temporaryPath);
    } catch {
      // Preserve the primary safe-write failure.
    }
    if (linked) {
      try {
        unlinkSync(outputPath);
      } catch {
        // Preserve the primary safe-write failure.
      }
    }
    throw new Error("Main provider output could not be written safely");
  }
}

export function appendGithubOutputs(env, values) {
  const outputPath = containedPath(
    env.GITHUB_OUTPUT,
    env.RUNNER_TEMP,
    "GITHUB_OUTPUT",
  );
  for (const [name, value] of Object.entries(values)) {
    if (
      !/^[a-z][a-z0-9_]*$/.test(name) ||
      typeof value !== "string" ||
      value.length === 0 ||
      Buffer.byteLength(value, "utf8") > MAIN_PROVIDER_CLI_MAX_JSON_BYTES ||
      /[\0\r\n]/.test(value)
    ) {
      throw new Error("Main provider GitHub output is malformed");
    }
  }
  const serialized = Object.entries(values)
    .map(([name, value]) => `${name}=${value}\n`)
    .join("");
  const serializedBytes = Buffer.byteLength(serialized, "utf8");
  let descriptor;
  try {
    descriptor = openSync(
      outputPath,
      constants.O_WRONLY | constants.O_APPEND | constants.O_NOFOLLOW,
    );
    const stats = fstatSync(descriptor);
    const pathStats = lstatSync(outputPath);
    if (
      !stats.isFile() ||
      stats.nlink !== 1 ||
      pathStats.nlink !== 1 ||
      pathStats.isSymbolicLink() ||
      stats.dev !== pathStats.dev ||
      stats.ino !== pathStats.ino ||
      ![0o600, 0o644].includes(stats.mode & 0o7777) ||
      stats.size + serializedBytes > MAIN_PROVIDER_CLI_MAX_JSON_BYTES
    ) {
      throw new Error("unsafe");
    }
    fchmodSync(descriptor, 0o600);
    const sealedStats = fstatSync(descriptor);
    const sealedPathStats = lstatSync(outputPath);
    if (
      !sealedStats.isFile() ||
      sealedStats.nlink !== 1 ||
      sealedPathStats.nlink !== 1 ||
      sealedPathStats.isSymbolicLink() ||
      sealedStats.dev !== sealedPathStats.dev ||
      sealedStats.ino !== sealedPathStats.ino ||
      (sealedStats.mode & 0o7777) !== 0o600 ||
      (sealedPathStats.mode & 0o7777) !== 0o600 ||
      sealedStats.size + serializedBytes > MAIN_PROVIDER_CLI_MAX_JSON_BYTES
    ) {
      throw new Error("unsafe");
    }
    writeFileSync(descriptor, serialized);
    fsyncSync(descriptor);
    const committedStats = fstatSync(descriptor);
    const committedPathStats = lstatSync(outputPath);
    if (
      !committedStats.isFile() ||
      committedStats.nlink !== 1 ||
      committedPathStats.nlink !== 1 ||
      committedPathStats.isSymbolicLink() ||
      committedStats.dev !== committedPathStats.dev ||
      committedStats.ino !== committedPathStats.ino ||
      (committedStats.mode & 0o7777) !== 0o600 ||
      (committedPathStats.mode & 0o7777) !== 0o600 ||
      committedStats.size > MAIN_PROVIDER_CLI_MAX_JSON_BYTES
    ) {
      throw new Error("unsafe");
    }
  } catch {
    throw new Error("GITHUB_OUTPUT could not be written safely");
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function createProvider(env, stateClientFactory, providerFactory, intent) {
  const client = stateClientFactory({
    token: env.VERCEL_TOKEN,
    teamId: env.VERCEL_ORG_ID,
  });
  return providerFactory({ client, intent });
}

function expectedNextReleaseId(env) {
  if (
    typeof env.DEPLOY_SHA !== "string" ||
    !SHA_PATTERN.test(env.DEPLOY_SHA) ||
    typeof env.UPSTREAM_RUN_ID !== "string" ||
    !POSITIVE_ID_PATTERN.test(env.UPSTREAM_RUN_ID)
  ) {
    throw new Error("Main provider next release identity is malformed");
  }
  return generateVercelMainReleaseId({
    repository: "mento-protocol/frontend-monorepo",
    commitSha: env.DEPLOY_SHA,
    upstreamRunId: env.UPSTREAM_RUN_ID,
  });
}

function planningExpectations(projectIds) {
  const projects = canonicalProjectIds(projectIds);
  return MAIN_RELEASE_ACTIVATION_ORDER.flatMap((target) => {
    const contract = MAIN_TARGET_CONTRACTS[target];
    return contract.aliases.map((alias) => ({
      alias,
      projectId: projects[target],
      projectName: contract.projectName,
      target: contract.target,
      customEnvironmentSlug: contract.customEnvironmentSlug,
      git: {
        org: "mento-protocol",
        repo: "frontend-monorepo",
        ref: "main",
      },
    }));
  }).sort((left, right) => left.alias.localeCompare(right.alias));
}

async function captureLivePlanningSnapshot(client, projectIds) {
  if (!client || typeof client.mainPlanningAliasState !== "function") {
    throw new Error("Fresh main planning state client is required");
  }
  const states = [];
  for (const expectation of planningExpectations(projectIds)) {
    states.push(await client.mainPlanningAliasState(expectation));
  }
  states.sort((left, right) => left.alias.localeCompare(right.alias));
  return assertMainPlanningSnapshot({
    schema: "vercel-main-planning-snapshot:v1",
    states,
  });
}

function classifyProviderCensusFailure(stage, error) {
  const readFailure = VERCEL_READ_FAILURE_KINDS.get(error?.code);
  const typedObservationFailure =
    RETRYABLE_MAIN_PROVIDER_FAILURE_CODES.has(error?.mainProviderFailureCode) &&
    error.mainProviderFailureCode.startsWith(`${stage}-`)
      ? error.mainProviderFailureCode
      : null;
  const classified = new Error("Vercel provider census failed");
  classified.mainProviderFailureCode =
    typedObservationFailure ?? `${stage}-${readFailure ?? "failed"}`;
  return classified;
}

function providerObservationFailure(failureCode, message) {
  if (!RETRYABLE_MAIN_PROVIDER_FAILURE_CODES.has(failureCode)) {
    throw new Error("Main provider observation failure code is malformed");
  }
  const error = new Error(message);
  error.mainProviderFailureCode = failureCode;
  return error;
}

async function runClassifiedProviderCensus(stage, capture) {
  try {
    return await capture();
  } catch (error) {
    throw classifyProviderCensusFailure(stage, error);
  }
}

function runClassifiedProviderReconciliation(reconcile) {
  try {
    return reconcile();
  } catch {
    const classified = new Error("Vercel preplan reconciliation failed");
    classified.mainProviderFailureCode = "preplan-reconciliation-failed";
    throw classified;
  }
}

function runClassifiedPreplanPostCensusOperation(failureCode, operation) {
  if (!PREPLAN_POST_CENSUS_FAILURE_CODES.has(failureCode)) {
    throw new Error("Main provider post-census failure code is malformed");
  }
  try {
    return operation();
  } catch {
    const classified = new Error("Vercel preplan post-census operation failed");
    classified.mainProviderFailureCode = failureCode;
    throw classified;
  }
}

async function captureStableBoundPlanningSnapshot({
  client,
  projectIds,
  expectedDigest,
}) {
  const first = await captureLivePlanningSnapshot(client, projectIds);
  const second = await captureLivePlanningSnapshot(client, projectIds);
  if (JSON.stringify(first) !== JSON.stringify(second)) {
    throw providerObservationFailure(
      MAIN_PROVIDER_OBSERVATION_FAILURE.planningUnstable,
      "Main planning aliases changed during decision census",
    );
  }
  if (planningSnapshotDigest(second) !== expectedDigest) {
    throw providerObservationFailure(
      MAIN_PROVIDER_OBSERVATION_FAILURE.planningStale,
      "Main planning aliases changed between discovery and decision",
    );
  }
  return second;
}

async function captureStableBoundLegacyV2Snapshot({
  client,
  legacySnapshot,
  expectedDigest,
}) {
  if (!client || typeof client.canonicalLegacyV2State !== "function") {
    throw new Error("Fresh legacy v2 state client is required");
  }
  const expectation = legacyV2Expectation(legacySnapshot);
  const capture = async () => {
    const proof = await client.canonicalLegacyV2State(expectation);
    if (!isPlainObject(proof)) {
      throw new Error("Fresh legacy v2 state proof is malformed");
    }
    assertExactKeys(
      proof,
      ["ownership", "state"],
      "Fresh legacy v2 state proof",
    );
    if (proof.ownership !== "native-vercel-git") {
      throw new Error("Fresh legacy v2 state proof is malformed");
    }
    return assertCanonicalOutput([proof.state]);
  };
  const first = await capture();
  const second = await capture();
  if (JSON.stringify(first) !== JSON.stringify(second)) {
    throw providerObservationFailure(
      MAIN_PROVIDER_OBSERVATION_FAILURE.legacyUnstable,
      "Legacy v2 mapping changed during decision census",
    );
  }
  if (digestMainLegacyV2Snapshot(second) !== expectedDigest) {
    throw providerObservationFailure(
      MAIN_PROVIDER_OBSERVATION_FAILURE.legacyStale,
      "Legacy v2 mapping changed between discovery and decision",
    );
  }
  return second;
}

export function encodeMainPreplanHandoff(
  value,
  { nextDeploySha, nextUpstreamRunId },
) {
  const canonical = assertMainPreplanReconciliation(value, {
    nextDeploySha,
    nextUpstreamRunId,
  });
  const encoded = Buffer.from(JSON.stringify(canonical), "utf8").toString(
    "base64url",
  );
  if (
    Buffer.byteLength(encoded, "utf8") > MAIN_PREPLAN_HANDOFF_MAX_ENCODED_BYTES
  ) {
    throw new Error("Main pre-plan handoff exceeds its job-output size bound");
  }
  return encoded;
}

export function decodeMainPreplanHandoff(
  encoded,
  { nextDeploySha, nextUpstreamRunId },
) {
  if (
    typeof encoded !== "string" ||
    !/^[A-Za-z0-9_-]+$/.test(encoded) ||
    Buffer.byteLength(encoded, "utf8") > MAIN_PREPLAN_HANDOFF_MAX_ENCODED_BYTES
  ) {
    throw new Error("Main pre-plan handoff is malformed or oversized");
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
    throw new Error("Main pre-plan handoff cannot be decoded");
  }
  return assertMainPreplanReconciliation(parsed, {
    nextDeploySha,
    nextUpstreamRunId,
  });
}

export function writeMainPreplanDecisionOutputs({
  output,
  result,
  releaseId,
  runnerTemp,
  env,
  operations = {
    writePrivateJson,
    encodeMainPreplanHandoff,
    appendGithubOutputs,
  },
}) {
  const handoff = runClassifiedPreplanPostCensusOperation(
    "preplan-handoff-encode-failed",
    () =>
      operations.encodeMainPreplanHandoff(result, {
        nextDeploySha: env.DEPLOY_SHA,
        nextUpstreamRunId: env.UPSTREAM_RUN_ID,
      }),
  );
  runClassifiedPreplanPostCensusOperation(
    "preplan-private-output-write-failed",
    () => operations.writePrivateJson(output, result, runnerTemp),
  );
  runClassifiedPreplanPostCensusOperation(
    "preplan-github-output-append-failed",
    () =>
      operations.appendGithubOutputs(env, {
        decision: result.decision,
        reason: result.reason,
        release_id: releaseId,
        handoff,
      }),
  );
}

async function smokeMainCandidateUrl({
  intent,
  candidate,
  fetchImpl = globalThis.fetch,
}) {
  const canonicalIntent = assertMainCandidateIntent(intent);
  const canonicalCandidate = assertMainCandidateProviderCandidate(
    candidate,
    canonicalIntent,
  );
  if (typeof fetchImpl !== "function") {
    throw new Error("Main candidate HTTP smoke implementation is required");
  }
  const url = new URL(canonicalCandidate.deploymentUrl);
  if (
    url.protocol !== "https:" ||
    !url.hostname.endsWith(".vercel.app") ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("Main candidate immutable URL is outside Vercel");
  }
  let response;
  try {
    response = await fetchImpl(url.toString(), {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
      headers: {
        "user-agent": "mento-vercel-main-candidate-smoke/1",
      },
    });
  } catch {
    throw new Error("Main candidate immutable HTTP smoke failed");
  }
  let responseUrl = null;
  try {
    responseUrl =
      typeof response?.url === "string"
        ? canonicalizeDeploymentUrl(response.url)
        : null;
  } catch {
    responseUrl = null;
  }
  const servedSha = response?.headers?.get?.("x-mento-deployment-sha");
  if (
    !Number.isSafeInteger(response?.status) ||
    response.status < 200 ||
    response.status >= 300 ||
    response.redirected !== false ||
    responseUrl !== canonicalCandidate.deploymentUrl ||
    servedSha !== canonicalIntent.deploySha
  ) {
    throw new Error("Main candidate immutable HTTP smoke is inconsistent");
  }
  if (typeof response.body?.cancel === "function") {
    await response.body.cancel();
  }
  return {
    immutableUrl: canonicalCandidate.deploymentUrl,
    servedSha: canonicalIntent.deploySha,
    status: "passed",
  };
}

export async function runMainProviderCli({
  argv,
  env = process.env,
  stdout = process.stdout,
  stateClientFactory = (options) => new VercelStateClient(options),
  providerFactory = ({ client, intent }) =>
    createMainCandidateVercelProvider(
      intent === undefined ? { client } : { client, intent },
    ),
  fetchImpl = globalThis.fetch,
} = {}) {
  const { command, options } = parseArguments(argv);
  const runnerTemp = reviewedRunnerTemp(env.RUNNER_TEMP);

  if (command === "canonical-mappings") {
    const mappings = createMainCanonicalMappings({
      planningSnapshot: readPrivateJson(
        options["planning-snapshot"],
        "Main planning snapshot",
        runnerTemp,
      ),
      projectIds: projectIdsFromEnvironment(env),
      legacySnapshot: Object.hasOwn(options, "legacy-snapshot")
        ? readPrivateJson(
            options["legacy-snapshot"],
            "Legacy v2 snapshot",
            runnerTemp,
          )
        : null,
    });
    writePrivateJson(options.output, mappings, runnerTemp);
    stdout.write("Canonical main mappings written\n");
    return mappings;
  }

  if (command === "preplan-discover") {
    const projectIds = canonicalProjectIds(
      readPrivateJson(
        options["project-ids"],
        "Main provider project IDs",
        runnerTemp,
      ),
    );
    const planningSnapshot = readPrivateJson(
      options["planning-snapshot"],
      "Main planning snapshot",
      runnerTemp,
    );
    const legacySnapshot = readPrivateJson(
      options["legacy-snapshot"],
      "Main provider legacy v2 snapshot",
      runnerTemp,
    );
    const currentMappings = createMainCanonicalMappings({
      planningSnapshot,
      projectIds,
      legacySnapshot,
    }).mappings;
    const discovery = assertDiscovery(
      await discoverMainPreplanCandidateReleases({
        currentMappings: Object.fromEntries(
          MAIN_RELEASE_ACTIVATION_ORDER.map((target) => [
            target,
            currentMappings[target],
          ]),
        ),
        projectIds,
        provider: createProvider(
          env,
          stateClientFactory,
          providerFactory,
          undefined,
        ),
      }),
    );
    const result = createDiscoveryEnvelope({
      planningSnapshot,
      legacySnapshot,
      projectIds,
      discovery,
    });
    writePrivateJson(options.output, result, runnerTemp);
    stdout.write("Canonical pre-plan candidate discovery written\n");
    return result;
  }

  if (command === "preplan-materialize") {
    const result = decodeMainPreplanHandoff(env.MAIN_PREPLAN_HANDOFF, {
      nextDeploySha: env.DEPLOY_SHA,
      nextUpstreamRunId: env.UPSTREAM_RUN_ID,
    });
    if (result.decision !== "restore-before-planning") {
      throw new Error(
        "Only restore-before-planning pre-plan handoffs may be materialized",
      );
    }
    writePrivateJson(options.output, result, runnerTemp);
    appendGithubOutputs(env, {
      inherited_candidate_targets: JSON.stringify(
        result.rollbackAuthorization.targets,
      ),
    });
    stdout.write("Canonical pre-plan handoff materialized\n");
    return result;
  }

  if (command === "preplan-decide") {
    const discovery = assertMainProviderDiscovery(
      readPrivateJson(
        options.discovery,
        "Main pre-plan candidate discovery",
        runnerTemp,
      ),
    );
    const projects = projectIdsFromEnvironment(env);
    if (JSON.stringify(projects) !== JSON.stringify(discovery.projectIds)) {
      throw new Error("Main provider discovery project set changed");
    }
    const suppliedSnapshot = readPrivateJson(
      options["planning-snapshot"],
      "Main planning snapshot",
      runnerTemp,
    );
    const suppliedLegacySnapshot = readPrivateJson(
      options["legacy-snapshot"],
      "Main provider legacy v2 snapshot",
      runnerTemp,
    );
    createMainCanonicalMappings({
      planningSnapshot: suppliedSnapshot,
      projectIds: projects,
      legacySnapshot: suppliedLegacySnapshot,
    });
    if (
      planningSnapshotDigest(suppliedSnapshot) !==
      discovery.planningSnapshotDigest
    ) {
      throw new Error(
        "Main planning snapshot changed between discovery and decision",
      );
    }
    if (
      digestMainLegacyV2Snapshot(suppliedLegacySnapshot) !==
      discovery.legacyAppV2Digest
    ) {
      throw new Error(
        "Legacy v2 mapping changed between discovery and decision",
      );
    }
    const liveClient = stateClientFactory({
      token: env.VERCEL_TOKEN,
      teamId: env.VERCEL_ORG_ID,
    });
    const freshSnapshot = await runClassifiedProviderCensus(
      "planning-census",
      () =>
        captureStableBoundPlanningSnapshot({
          client: liveClient,
          projectIds: projects,
          expectedDigest: discovery.planningSnapshotDigest,
        }),
    );
    const freshLegacySnapshot = await runClassifiedProviderCensus(
      "legacy-census",
      () =>
        captureStableBoundLegacyV2Snapshot({
          client: liveClient,
          legacySnapshot: suppliedLegacySnapshot,
          expectedDigest: discovery.legacyAppV2Digest,
        }),
    );
    const { result, releaseId } = runClassifiedProviderReconciliation(() => {
      const { mappings: allMappings } = createMainCanonicalMappings({
        planningSnapshot: freshSnapshot,
        projectIds: projects,
        legacySnapshot: freshLegacySnapshot,
      });
      const currentMappings = Object.fromEntries(
        MAIN_RELEASE_ACTIVATION_ORDER.map((target) => [
          target,
          allMappings[target],
        ]),
      );
      const nextReleaseId = expectedNextReleaseId(env);
      const decision = assertMainPreplanReconciliation(
        decideMainPreplanReconciliation({
          nextDeploySha: env.DEPLOY_SHA,
          nextUpstreamRunId: env.UPSTREAM_RUN_ID,
          candidateReleases: discovery.discovery.candidateReleases,
          currentMappings,
          rollbackOnlyTargets: discovery.discovery.rollbackOnlyTargets,
        }),
        {
          nextDeploySha: env.DEPLOY_SHA,
          nextUpstreamRunId: env.UPSTREAM_RUN_ID,
        },
      );
      return {
        result: decision,
        releaseId:
          decision.decision === "restore-before-planning"
            ? decision.reconciliation.manifest.releaseId
            : nextReleaseId,
      };
    });
    writeMainPreplanDecisionOutputs({
      output: options.output,
      result,
      releaseId,
      runnerTemp,
      env,
    });
    stdout.write("Canonical pre-plan reconciliation decision written\n");
    return result;
  }

  const intent = assertMainCandidateIntent(
    readPrivateJson(options.intent, "Main candidate intent", runnerTemp),
  );
  const provider = createProvider(
    env,
    stateClientFactory,
    providerFactory,
    intent,
  );
  if (command === "candidate-preflight") {
    const result = assertMainCandidatePreflight(
      await preflightMainCandidateProvider({ intent, provider }),
    );
    const action = result.outcome === "create-if-zero" ? "create" : "reuse";
    writePrivateJson(options.output, result, runnerTemp);
    appendGithubOutputs(env, { action });
    stdout.write("Canonical candidate preflight written\n");
    return result;
  }

  if (command === "candidate-smoke") {
    const preflight = assertMainCandidatePreflight(
      await preflightMainCandidateProvider({ intent, provider }),
    );
    if (preflight.outcome !== "reuse-existing") {
      throw new Error("Main candidate immutable smoke requires one candidate");
    }
    const result = await smokeMainCandidateUrl({
      intent,
      candidate: preflight.candidate,
      fetchImpl,
    });
    writePrivateJson(options.output, result, runnerTemp);
    appendGithubOutputs(env, {
      deployment_id: preflight.candidate.deploymentId,
    });
    stdout.write("Canonical candidate immutable smoke written\n");
    return result;
  }

  const smoke = readPrivateJson(
    options.smoke,
    "Main candidate immutable smoke",
    runnerTemp,
  );
  const result = assertMainCandidateHandoff(
    await resolveMainCandidateHandoff({
      intent,
      provider,
      smokeCandidate: async () => smoke,
    }),
  );
  if (result.action !== "reuse") {
    throw new Error("Candidate finalization requires one reusable candidate");
  }
  writePrivateJson(options.output, result, runnerTemp);
  appendGithubOutputs(env, {
    action: "reuse",
    deployment_id: result.candidate.deploymentId,
    receipt: encodeMainCandidateReceipt(result.receipt, result.intent),
  });
  stdout.write("Canonical candidate finalization written\n");
  return result;
}

export function renderMainProviderCliFailure(error) {
  const failureCode = error?.mainProviderFailureCode;
  if (
    typeof failureCode === "string" &&
    SAFE_MAIN_PROVIDER_FAILURE_CODES.has(failureCode)
  ) {
    return `Vercel main provider command failed (${failureCode})\n`;
  }
  return "Vercel main provider command failed\n";
}

export function mainProviderCliFailureExitCode(error) {
  return RETRYABLE_MAIN_PROVIDER_FAILURE_CODES.has(
    error?.mainProviderFailureCode,
  )
    ? MAIN_PROVIDER_CLI_RETRY_EXIT_CODE
    : 1;
}

function isCliEntrypoint() {
  return (
    process.argv[1] !== undefined &&
    fileURLToPath(import.meta.url) === resolve(process.argv[1])
  );
}

if (isCliEntrypoint()) {
  try {
    await runMainProviderCli({ argv: process.argv.slice(2) });
  } catch (error) {
    process.stderr.write(renderMainProviderCliFailure(error));
    process.exitCode = mainProviderCliFailureExitCode(error);
  }
}
