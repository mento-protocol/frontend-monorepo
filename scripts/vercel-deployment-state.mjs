#!/usr/bin/env node

/* eslint-disable turbo/no-undeclared-env-vars -- This direct Actions controller does not run through Turbo. */

import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import process from "node:process";
import { dirname, isAbsolute, parse, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  canonicalizeDeploymentUrl,
  canonicalizeHostname,
} from "./vercel-deployment-url.mjs";
import { canonicalizeMainCandidateVercelMetadata } from "./vercel-main-candidate.mjs";
import { assertMainReleaseManifest } from "./vercel-main-release-reconciliation.mjs";

export { canonicalizeDeploymentUrl, canonicalizeHostname };

const API_ORIGIN = "https://api.vercel.com";
const SHA_PATTERN = /^[A-Fa-f0-9]{40}$/;

export const CANONICAL_STATE_KEYS = Object.freeze([
  "alias",
  "deploymentId",
  "deploymentUrl",
  "creatorUsername",
  "projectId",
  "projectName",
  "readyState",
  "target",
  "customEnvironmentSlug",
  "git",
  "aliases",
]);

export const MAIN_PLANNING_SNAPSHOT_SCHEMA = "vercel-main-planning-snapshot:v1";
export const MAIN_PLANNING_SNAPSHOT_KEYS = Object.freeze(["schema", "states"]);
export const ACTIVE_DEPLOYMENT_STATE_SPEC_SCHEMA =
  "vercel-active-deployment-state-spec:v3";
export const ACTIVE_DEPLOYMENT_STATE_PROOF_SCHEMA =
  "vercel-active-deployment-state-proof:v4";
export const ACTIVE_ALIAS_MAPPING_SET_SCHEMA =
  "vercel-active-alias-mapping-set:v1";
export const ACTIVE_ALIAS_MAPPING_SPEC_SCHEMA =
  "vercel-active-alias-mapping-spec:v2";

const CANONICAL_GIT_KEYS = ["org", "repo", "ref", "sha"];
const ACTIVE_STATE_TARGETS = Object.freeze([
  "app",
  "governance",
  "reserve",
  "ui",
]);
const ACTIVE_PROTECTED_ALIASES = Object.freeze([
  "app.mento.org",
  "appmentoorg-env-v3-mentolabs.vercel.app",
  "appmentoorg-git-v2-mentolabs.vercel.app",
  "appmentoorg-mentolabs.vercel.app",
  "appmentoorg.vercel.app",
  "governance.mento.org",
  "reserve.mento.org",
  "ui.mento.org",
  "v2-app.mento.org",
]);
const ACTIVE_MAPPING_TARGETS = Object.freeze([
  "app",
  "governance",
  "reserve",
  "ui",
  "legacy-app",
]);
const ACTIVE_STATE_SPEC_KEYS = Object.freeze([
  "schema",
  "deploySha",
  "runId",
  "runAttempt",
  "transactionId",
  "releaseManifest",
  "mainOwnershipMode",
  "stagedTargets",
  "activeTargets",
  "shadowTargets",
  "projects",
  "legacyAppV2",
]);
const ACTIVE_STATE_PROJECT_SPEC_KEYS = Object.freeze([
  "projectId",
  "projectName",
  "expectedDisposition",
  "deploymentId",
  "deploymentUrl",
  "target",
  "customEnvironmentSlug",
]);
const ACTIVE_STATE_LEGACY_SPEC_KEYS = Object.freeze([
  "alias",
  "deployment",
  "deploymentUrl",
  "projectId",
  "projectName",
  "readyState",
  "target",
  "customEnvironmentSlug",
  "git",
]);
const ACTIVE_STATE_PROOF_KEYS = Object.freeze([
  "schema",
  "outcome",
  "deploySha",
  "runId",
  "runAttempt",
  "transactionId",
  "mainOwnershipMode",
  "stagedTargets",
  "activeTargets",
  "shadowTargets",
  "projects",
  "legacyAppV2",
]);
const ACTIVE_STATE_PROJECT_PROOF_KEYS = Object.freeze([
  "projectId",
  "projectName",
  "target",
  "customEnvironmentSlug",
  "mainOwnershipMode",
  "expectedDisposition",
  "expectedDeploymentId",
  "expectedDeploymentUrl",
  "priorDeploymentId",
  "priorDeploymentUrl",
  "priorServedSha",
  "counts",
  "ids",
  "records",
]);
const ACTIVE_STATE_RECORD_KEYS = Object.freeze([
  "deploymentId",
  "deploymentUrl",
  "projectId",
  "projectName",
  "readyState",
  "target",
  "customEnvironmentSlug",
  "git",
  "source",
  "workflowMetadataMatches",
]);
const ACTIVE_STATE_CLASSIFICATIONS = Object.freeze([
  "githubPrebuilt",
  "githubShadowStage",
  "nativeGitOwner",
  "nativeGitDuplicates",
  "manualDuplicates",
  "unknown",
  "legacyV2",
]);
const ACTIVE_STATE_LEGACY_PROOF_KEYS = Object.freeze([
  "alias",
  "deploymentId",
  "deploymentUrl",
  "projectId",
  "projectName",
  "readyState",
  "target",
  "customEnvironmentSlug",
  "git",
  "ownership",
]);
const APP_TRANSACTION_CANDIDATE_KEYS = Object.freeze([
  "deploymentId",
  "deploymentUrl",
  "projectId",
  "projectName",
  "deploySha",
  "runId",
  "runAttempt",
  "transactionId",
  "customEnvironmentSlug",
]);
const APP_TRANSACTION_EXPECTATION_KEYS = Object.freeze([
  "projectId",
  "projectName",
  "deploySha",
  "runId",
  "runAttempt",
  "transactionId",
  "customEnvironmentSlug",
  "nextDeploymentId",
]);
const CREATOR_USERNAME_PATTERN =
  /^(?=.{1,63}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const CLI_OPTIONS = Object.freeze({
  "active-proof": Object.freeze(["spec", "output"]),
  "alias-mappings": Object.freeze(["spec", "output"]),
  "app-candidate": Object.freeze(["expected", "output"]),
  compare: Object.freeze(["before", "after"]),
  deployment: Object.freeze(["expected", "output"]),
  "planning-snapshot": Object.freeze(["spec", "output"]),
  project: Object.freeze(["project-id", "project-name", "root-directory"]),
  snapshot: Object.freeze(["spec", "output"]),
});
const APP_CANDIDATE_PENDING_STATES = new Set([
  "BUILDING",
  "INITIALIZING",
  "QUEUED",
]);

function sleep(milliseconds) {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, milliseconds);
  });
}

class CanonicalDriftError extends Error {}

export function canonicalizeAliases(response) {
  if (!response || !Array.isArray(response.aliases)) {
    throw new Error("Deployment aliases response is malformed");
  }
  const aliases = response.aliases.map((item) => {
    if (!item || typeof item !== "object" || typeof item.alias !== "string") {
      throw new Error("Deployment alias entry is malformed");
    }
    return canonicalizeHostname(item.alias);
  });
  return [...new Set(aliases)].sort();
}

function consistentString(label, candidates, { pattern } = {}) {
  const values = candidates.filter(
    (value) => value !== undefined && value !== null,
  );
  if (values.some((value) => typeof value !== "string" || value.length === 0)) {
    throw new Error(`Deployment ${label} is malformed`);
  }
  const distinct = [...new Set(values)];
  if (distinct.length === 0) throw new Error(`Deployment ${label} is missing`);
  if (distinct.length > 1) {
    throw new Error(`Deployment ${label} metadata conflicts`);
  }
  if (pattern && !pattern.test(distinct[0])) {
    throw new Error(`Deployment ${label} is malformed`);
  }
  return distinct[0];
}

function canonicalizeCreatorUsername(deploymentResponse) {
  const creator = deploymentResponse.creator;
  if (creator === undefined || creator === null) return null;
  if (typeof creator !== "object" || Array.isArray(creator)) {
    throw new Error("Deployment creator is malformed");
  }
  if (creator.username === undefined || creator.username === null) return null;
  if (typeof creator.username !== "string" || creator.username.length === 0) {
    throw new Error("Deployment creator username is malformed");
  }
  const username = creator.username.toLowerCase();
  if (!CREATOR_USERNAME_PATTERN.test(username)) {
    throw new Error("Deployment creator username is malformed");
  }
  return username;
}

function canonicalizeAliasLookup(alias, response) {
  if (!response || typeof response !== "object" || Array.isArray(response)) {
    throw new Error("Alias lookup response is malformed");
  }
  const canonicalAlias = canonicalizeHostname(alias ?? response.alias);
  if (canonicalizeHostname(response.alias) !== canonicalAlias) {
    throw new Error("Alias lookup returned a different hostname");
  }
  return {
    alias: canonicalAlias,
    deploymentId: consistentString("ID", [
      response.deploymentId,
      response.deployment?.id,
    ]),
    projectId: consistentString("project ID", [response.projectId]),
  };
}

function canonicalizeGit(raw) {
  const meta = raw.meta ?? {};
  const gitSource = raw.gitSource ?? {};
  const gitRepo = raw.gitRepo ?? raw.gitRepository ?? {};
  return {
    org: consistentString("Git organization", [
      meta.githubCommitOrg,
      gitSource.org,
      gitSource.owner,
      gitRepo.org,
      gitRepo.owner,
      gitRepo.namespace,
    ]),
    repo: consistentString("Git repository", [
      meta.githubCommitRepo,
      gitSource.repo,
      gitSource.repoSlug,
      gitRepo.repo,
      gitRepo.name,
    ]),
    ref: consistentString("Git ref", [
      meta.githubCommitRef,
      gitSource.ref,
      gitRepo.ref,
    ]),
    sha: consistentString(
      "Git SHA",
      [meta.githubCommitSha, gitSource.sha, gitRepo.sha],
      { pattern: SHA_PATTERN },
    ).toLowerCase(),
  };
}

function canonicalizeInventoryGitSha(raw, label) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${label} is malformed`);
  }
  const sources = [
    ["metadata", raw.meta],
    ["Git source", raw.gitSource],
    ["Git repository", raw.gitRepo],
    ["Git repository", raw.gitRepository],
  ];
  for (const [sourceLabel, source] of sources) {
    if (
      source !== undefined &&
      source !== null &&
      (typeof source !== "object" || Array.isArray(source))
    ) {
      throw new Error(`${label} ${sourceLabel} is malformed`);
    }
  }
  const candidates = [
    raw.meta?.githubCommitSha,
    raw.gitSource?.sha,
    raw.gitRepo?.sha,
    raw.gitRepository?.sha,
  ].filter((value) => value !== undefined && value !== null);
  if (candidates.length === 0) return null;
  return consistentString("Git SHA", candidates, {
    pattern: SHA_PATTERN,
  }).toLowerCase();
}

function assertExactShaDeploymentInspection({
  deployment,
  deploymentId,
  projectId,
  deploySha,
}) {
  if (
    !deployment ||
    typeof deployment !== "object" ||
    Array.isArray(deployment) ||
    requireDeploymentId(
      consistentString("ID", [deployment.id, deployment.uid]),
      "Active state inspected deployment ID",
    ) !== deploymentId ||
    consistentString("project ID", [
      deployment.projectId,
      deployment.project?.id,
    ]) !== projectId
  ) {
    throw new Error("Active state inspected deployment is malformed");
  }
  if (
    canonicalizeInventoryGitSha(
      deployment,
      "Active state inspected deployment",
    ) !== deploySha
  ) {
    throw new Error(
      "Active state inspected deployment SHA does not match census",
    );
  }
  return deployment;
}

function planningGitCandidates(raw) {
  const meta = raw.meta ?? {};
  const gitSource = raw.gitSource ?? {};
  const gitRepo = raw.gitRepo ?? raw.gitRepository ?? {};
  return {
    org: [
      meta.githubCommitOrg,
      gitSource.org,
      gitSource.owner,
      gitRepo.org,
      gitRepo.owner,
      gitRepo.namespace,
    ],
    repo: [
      meta.githubCommitRepo,
      gitSource.repo,
      gitSource.repoSlug,
      gitRepo.repo,
      gitRepo.name,
    ],
    ref: [meta.githubCommitRef, gitSource.ref, gitRepo.ref],
    sha: [meta.githubCommitSha, gitSource.sha, gitRepo.sha],
  };
}

function canonicalizeMainPlanningGit(raw) {
  const candidates = planningGitCandidates(raw);
  const supplied = Object.values(candidates).flatMap((values) =>
    values.filter((value) => value !== undefined && value !== null),
  );
  if (supplied.length === 0) return null;
  const canonical = {};
  for (const key of CANONICAL_GIT_KEYS) {
    const values = candidates[key].filter(
      (value) => value !== undefined && value !== null,
    );
    if (
      values.length === 0 ||
      values.some((value) => typeof value !== "string" || value.length === 0)
    ) {
      return {};
    }
    const distinct = [...new Set(values)];
    if (distinct.length !== 1) return {};
    canonical[key] = distinct[0];
  }
  if (!SHA_PATTERN.test(canonical.sha)) return {};
  if (
    !/^[A-Za-z0-9._-]+$/.test(canonical.org) ||
    !/^[A-Za-z0-9._-]+$/.test(canonical.repo) ||
    !/^[A-Za-z0-9._/-]+$/.test(canonical.ref) ||
    canonical.ref.includes("..")
  ) {
    return {};
  }
  canonical.sha = canonical.sha.toLowerCase();
  return canonical;
}

function canonicalizeActiveCensusGit(raw, deploySha) {
  const sha = canonicalizeInventoryGitSha(
    raw,
    "Active state inspected deployment",
  );
  if (sha === null || sha !== deploySha) {
    throw new Error(
      "Active state inspected deployment SHA does not match census",
    );
  }
  const observed = canonicalizeMainPlanningGit(raw);
  const hasCompleteObservedIdentity =
    observed !== null &&
    Object.keys(observed).length === CANONICAL_GIT_KEYS.length &&
    observed.sha === sha;
  return {
    org: hasCompleteObservedIdentity ? observed.org : null,
    repo: hasCompleteObservedIdentity ? observed.repo : null,
    ref: hasCompleteObservedIdentity ? observed.ref : null,
    sha,
  };
}

function assertExpected(actual, expected, label) {
  if (expected !== undefined && actual !== expected) {
    throw new Error(`Unexpected deployment ${label}`);
  }
}

function canonicalizeRunTransaction(value) {
  return typeof value === "string" &&
    /^[1-9][0-9]*-[1-9][0-9]*-(?:governance|reserve|ui)$/.test(value)
    ? value
    : null;
}

function canonicalAppTransactionExpectation(value) {
  assertExactKeys(
    value,
    APP_TRANSACTION_EXPECTATION_KEYS,
    "App transaction candidate expectation",
  );
  const canonical = {
    projectId: requireIdentifier(value.projectId, "App project ID"),
    projectName: requireIdentifier(value.projectName, "App project name"),
    deploySha: requireIdentifier(
      value.deploySha,
      "App deploy SHA",
    ).toLowerCase(),
    runId: requireIdentifier(String(value.runId), "App run ID"),
    runAttempt: requireIdentifier(String(value.runAttempt), "App run attempt"),
    transactionId: requireIdentifier(value.transactionId, "App transaction ID"),
    customEnvironmentSlug: value.customEnvironmentSlug,
    nextDeploymentId: requireIdentifier(
      value.nextDeploymentId,
      "App custom Next deployment ID",
    ),
  };
  if (
    canonical.projectName !== "app.mento.org" ||
    !SHA_PATTERN.test(canonical.deploySha) ||
    !/^[1-9][0-9]*$/.test(canonical.runId) ||
    !/^[1-9][0-9]*$/.test(canonical.runAttempt) ||
    !/^main-[a-f0-9]{32}$/.test(canonical.transactionId) ||
    canonical.customEnvironmentSlug !== "v3" ||
    canonical.nextDeploymentId.length > 32 ||
    canonical.nextDeploymentId.startsWith("dpl_") ||
    !/^[A-Za-z0-9_-]+$/.test(canonical.nextDeploymentId)
  ) {
    throw new Error("App transaction candidate expectation is malformed");
  }
  return canonical;
}

export function canonicalizeAppTransactionCandidate({
  deploymentResponse,
  expected,
}) {
  if (
    !deploymentResponse ||
    typeof deploymentResponse !== "object" ||
    Array.isArray(deploymentResponse)
  ) {
    throw new Error("App transaction candidate response is malformed");
  }
  const expectation = canonicalAppTransactionExpectation(expected);
  const deploymentId = requireIdentifier(
    deploymentResponse.id,
    "App candidate deployment ID",
  );
  if (!deploymentId.startsWith("dpl_")) {
    throw new Error("App candidate deployment ID is malformed");
  }
  const deploymentUrl = canonicalizeDeploymentUrl(deploymentResponse.url);
  const projectId = consistentString("project ID", [
    deploymentResponse.projectId,
    deploymentResponse.project?.id,
  ]);
  const projectName = consistentString("project name", [
    deploymentResponse.name,
    deploymentResponse.project?.name,
  ]);
  const readyState = consistentString("readiness", [
    deploymentResponse.readyState,
  ]);
  const git = canonicalizeGit(deploymentResponse);
  const target = deploymentResponse.target ?? null;
  const customEnvironmentSlug =
    deploymentResponse.customEnvironment?.slug ?? null;
  const meta = deploymentResponse.meta;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
    throw new Error("App transaction candidate metadata is malformed");
  }
  const runId = meta.mentoRunId;
  const runAttempt = meta.mentoRunAttempt;
  const transactionId = meta.mentoTransactionId;
  const nextDeploymentId = meta.mentoNextDeploymentId;
  if (
    projectId !== expectation.projectId ||
    projectName !== expectation.projectName ||
    readyState !== "READY" ||
    target !== null ||
    customEnvironmentSlug !== expectation.customEnvironmentSlug ||
    git.org !== "mento-protocol" ||
    git.repo !== "frontend-monorepo" ||
    git.ref !== "main" ||
    git.sha !== expectation.deploySha ||
    runId !== expectation.runId ||
    runAttempt !== expectation.runAttempt ||
    transactionId !== expectation.transactionId ||
    nextDeploymentId !== expectation.nextDeploymentId
  ) {
    throw new Error("App transaction candidate identity does not match");
  }
  const result = {
    deploymentId,
    deploymentUrl,
    projectId,
    projectName,
    deploySha: git.sha,
    runId,
    runAttempt,
    transactionId,
    customEnvironmentSlug,
  };
  return assertAppTransactionCandidateOutput(result);
}

export function assertAppTransactionCandidateOutput(value) {
  assertExactKeys(
    value,
    APP_TRANSACTION_CANDIDATE_KEYS,
    "App transaction candidate",
  );
  if (
    typeof value.deploymentId !== "string" ||
    !/^dpl_[A-Za-z0-9]+$/.test(value.deploymentId) ||
    canonicalizeDeploymentUrl(value.deploymentUrl) !== value.deploymentUrl ||
    typeof value.projectId !== "string" ||
    !/^[A-Za-z0-9._-]+$/.test(value.projectId) ||
    value.projectName !== "app.mento.org" ||
    typeof value.deploySha !== "string" ||
    !SHA_PATTERN.test(value.deploySha) ||
    value.deploySha !== value.deploySha.toLowerCase() ||
    typeof value.runId !== "string" ||
    !/^[1-9][0-9]*$/.test(value.runId) ||
    typeof value.runAttempt !== "string" ||
    !/^[1-9][0-9]*$/.test(value.runAttempt) ||
    typeof value.transactionId !== "string" ||
    !/^main-[a-f0-9]{32}$/.test(value.transactionId) ||
    value.customEnvironmentSlug !== "v3"
  ) {
    throw new Error("App transaction candidate output is malformed");
  }
  return value;
}

export function canonicalizeAliasMapping({
  alias,
  aliasResponse,
  deploymentResponse,
}) {
  if (
    !aliasResponse ||
    !deploymentResponse ||
    typeof deploymentResponse !== "object" ||
    Array.isArray(deploymentResponse)
  ) {
    throw new Error("Alias mapping response is malformed");
  }
  const lookup = canonicalizeAliasLookup(alias, aliasResponse);
  return {
    alias: lookup.alias,
    deploymentId: consistentString("ID", [
      lookup.deploymentId,
      deploymentResponse.id,
    ]),
    deploymentUrl: canonicalizeDeploymentUrl(deploymentResponse.url),
    projectId: consistentString("project ID", [
      lookup.projectId,
      deploymentResponse.projectId,
      deploymentResponse.project?.id,
    ]),
  };
}

export function canonicalizeDeploymentState({
  alias,
  aliasResponse,
  deploymentResponse,
  aliasesResponse,
  expected = {},
}) {
  if (!deploymentResponse || typeof deploymentResponse !== "object") {
    throw new Error("Deployment response is malformed");
  }
  const canonicalAlias = canonicalizeHostname(
    alias ?? aliasResponse?.alias ?? deploymentResponse.url,
  );
  const deploymentId = consistentString("ID", [
    deploymentResponse.id,
    aliasResponse?.deploymentId,
    aliasResponse?.deployment?.id,
  ]);
  const deploymentUrl = canonicalizeDeploymentUrl(deploymentResponse.url);
  const creatorUsername = canonicalizeCreatorUsername(deploymentResponse);
  const projectId = consistentString("project ID", [
    deploymentResponse.projectId,
    deploymentResponse.project?.id,
    aliasResponse?.projectId,
  ]);
  const projectName = consistentString("project name", [
    deploymentResponse.name,
    deploymentResponse.project?.name,
  ]);
  const readyState = consistentString("readiness", [
    deploymentResponse.readyState,
  ]);
  const git = canonicalizeGit(deploymentResponse);
  const transaction = canonicalizeRunTransaction(
    deploymentResponse.meta?.mentoTransaction,
  );
  const target = deploymentResponse.target ?? null;
  if (target !== null && (typeof target !== "string" || target.length === 0)) {
    throw new Error("Deployment target is malformed");
  }
  let customEnvironmentSlug = null;
  if (
    deploymentResponse.customEnvironment !== undefined &&
    deploymentResponse.customEnvironment !== null
  ) {
    if (
      typeof deploymentResponse.customEnvironment !== "object" ||
      Array.isArray(deploymentResponse.customEnvironment) ||
      typeof deploymentResponse.customEnvironment.slug !== "string" ||
      deploymentResponse.customEnvironment.slug.length === 0
    ) {
      throw new Error("Deployment custom environment is malformed");
    }
    customEnvironmentSlug = deploymentResponse.customEnvironment.slug;
  }

  assertExpected(projectId, expected.projectId, "project ID");
  assertExpected(deploymentId, expected.deployment, "ID");
  assertExpected(
    deploymentUrl,
    expected.deploymentUrl === undefined
      ? undefined
      : canonicalizeDeploymentUrl(expected.deploymentUrl),
    "URL",
  );
  assertExpected(projectName, expected.projectName, "project name");
  assertExpected(readyState, expected.readyState ?? "READY", "readiness");
  assertExpected(target, expected.target, "target");
  assertExpected(
    customEnvironmentSlug,
    expected.customEnvironmentSlug,
    "custom environment",
  );
  assertExpected(git.org, expected.git?.org, "Git organization");
  assertExpected(git.repo, expected.git?.repo, "Git repository");
  assertExpected(git.ref, expected.git?.ref, "Git ref");
  assertExpected(git.sha, expected.git?.sha?.toLowerCase(), "Git SHA");
  assertExpected(transaction, expected.transaction, "workflow transaction");

  const aliases = canonicalizeAliases(aliasesResponse);
  if (
    aliasResponse &&
    canonicalizeHostname(aliasResponse.alias) !== canonicalAlias
  ) {
    throw new Error("Alias lookup returned a different hostname");
  }
  if (aliasResponse && !aliases.includes(canonicalAlias)) {
    throw new Error("Resolved alias is absent from the deployment alias list");
  }

  return {
    alias: canonicalAlias,
    deploymentId,
    deploymentUrl,
    creatorUsername,
    projectId,
    projectName,
    readyState,
    target,
    customEnvironmentSlug,
    git,
    aliases,
  };
}

export function canonicalizeMainPlanningDeploymentState({
  alias,
  aliasResponse,
  deploymentResponse,
  aliasesResponse,
  expected = {},
}) {
  if (
    !deploymentResponse ||
    typeof deploymentResponse !== "object" ||
    Array.isArray(deploymentResponse)
  ) {
    throw new Error("Deployment response is malformed");
  }
  const canonicalAlias = canonicalizeHostname(
    alias ?? aliasResponse?.alias ?? deploymentResponse.url,
  );
  const deploymentId = consistentString("ID", [
    deploymentResponse.id,
    aliasResponse?.deploymentId,
    aliasResponse?.deployment?.id,
  ]);
  const deploymentUrl = canonicalizeDeploymentUrl(deploymentResponse.url);
  const creatorUsername = canonicalizeCreatorUsername(deploymentResponse);
  const projectId = consistentString("project ID", [
    deploymentResponse.projectId,
    deploymentResponse.project?.id,
    aliasResponse?.projectId,
  ]);
  const projectName = consistentString("project name", [
    deploymentResponse.name,
    deploymentResponse.project?.name,
  ]);
  const readyState = consistentString("readiness", [
    deploymentResponse.readyState,
  ]);
  const git = canonicalizeMainPlanningGit(deploymentResponse);
  const target = deploymentResponse.target ?? null;
  if (target !== null && (typeof target !== "string" || target.length === 0)) {
    throw new Error("Deployment target is malformed");
  }
  let customEnvironmentSlug = null;
  if (
    deploymentResponse.customEnvironment !== undefined &&
    deploymentResponse.customEnvironment !== null
  ) {
    if (
      typeof deploymentResponse.customEnvironment !== "object" ||
      Array.isArray(deploymentResponse.customEnvironment) ||
      typeof deploymentResponse.customEnvironment.slug !== "string" ||
      deploymentResponse.customEnvironment.slug.length === 0
    ) {
      throw new Error("Deployment custom environment is malformed");
    }
    customEnvironmentSlug = deploymentResponse.customEnvironment.slug;
  }

  assertExpected(projectId, expected.projectId, "project ID");
  assertExpected(deploymentId, expected.deployment, "ID");
  assertExpected(
    deploymentUrl,
    expected.deploymentUrl === undefined
      ? undefined
      : canonicalizeDeploymentUrl(expected.deploymentUrl),
    "URL",
  );
  assertExpected(projectName, expected.projectName, "project name");
  assertExpected(readyState, expected.readyState ?? "READY", "readiness");
  assertExpected(target, expected.target, "target");
  assertExpected(
    customEnvironmentSlug,
    expected.customEnvironmentSlug,
    "custom environment",
  );

  const aliases = canonicalizeAliases(aliasesResponse);
  if (
    aliasResponse &&
    canonicalizeHostname(aliasResponse.alias) !== canonicalAlias
  ) {
    throw new Error("Alias lookup returned a different hostname");
  }
  if (aliasResponse && !aliases.includes(canonicalAlias)) {
    throw new Error("Resolved alias is absent from the deployment alias list");
  }

  return {
    alias: canonicalAlias,
    deploymentId,
    deploymentUrl,
    creatorUsername,
    projectId,
    projectName,
    readyState,
    target,
    customEnvironmentSlug,
    git,
    aliases,
  };
}

function assertExactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is malformed`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} contains forbidden fields`);
  }
}

export function assertCanonicalOutput(value) {
  const states = Array.isArray(value) ? value : [value];
  if (states.length === 0) {
    throw new Error("Canonical output is malformed");
  }
  for (const state of states) {
    assertExactKeys(state, CANONICAL_STATE_KEYS, "Canonical deployment state");
    if (canonicalizeHostname(state.alias) !== state.alias) {
      throw new Error("Canonical deployment alias is malformed");
    }
    requireIdentifier(state.deploymentId, "Canonical deployment ID");
    if (
      canonicalizeDeploymentUrl(state.deploymentUrl) !== state.deploymentUrl
    ) {
      throw new Error("Canonical deployment URL is malformed");
    }
    if (
      canonicalizeCreatorUsername({
        creator:
          state.creatorUsername === null
            ? null
            : { username: state.creatorUsername },
      }) !== state.creatorUsername
    ) {
      throw new Error("Canonical deployment creator username is malformed");
    }
    requireIdentifier(state.projectId, "Canonical project ID");
    requireIdentifier(state.projectName, "Canonical project name");
    if (state.readyState !== "READY") {
      throw new Error("Canonical deployment readiness must be READY");
    }
    const isProduction =
      state.target === "production" && state.customEnvironmentSlug === null;
    const isAppV3 =
      state.target === null && state.customEnvironmentSlug === "v3";
    if (!isProduction && !isAppV3) {
      throw new Error("Canonical deployment environment is malformed");
    }
    assertExactKeys(state.git, CANONICAL_GIT_KEYS, "Canonical Git state");
    if (
      state.git.org !== "mento-protocol" ||
      state.git.repo !== "frontend-monorepo" ||
      !["main", "v2"].includes(state.git.ref) ||
      typeof state.git.sha !== "string" ||
      !SHA_PATTERN.test(state.git.sha) ||
      state.git.sha !== state.git.sha.toLowerCase()
    ) {
      throw new Error("Canonical Git state is malformed");
    }
    const aliases = canonicalizeAliases({
      aliases: Array.isArray(state.aliases)
        ? state.aliases.map((alias) => ({ alias }))
        : state.aliases,
    });
    if (JSON.stringify(aliases) !== JSON.stringify(state.aliases)) {
      throw new Error("Canonical deployment aliases are malformed");
    }
  }
  return value;
}

export function assertMainPlanningSnapshot(value) {
  assertExactKeys(value, MAIN_PLANNING_SNAPSHOT_KEYS, "Main planning snapshot");
  if (
    value.schema !== MAIN_PLANNING_SNAPSHOT_SCHEMA ||
    !Array.isArray(value.states) ||
    value.states.length === 0
  ) {
    throw new Error("Main planning snapshot schema is malformed");
  }
  const aliases = new Set();
  for (const state of value.states) {
    assertExactKeys(
      state,
      CANONICAL_STATE_KEYS,
      "Main planning deployment state",
    );
    assertCanonicalOutput({
      ...state,
      git: {
        org: "mento-protocol",
        repo: "frontend-monorepo",
        ref: "main",
        sha: "0000000000000000000000000000000000000000",
      },
    });
    const git = state.git;
    const isMissing = git === null;
    const isMalformed =
      git !== null &&
      typeof git === "object" &&
      !Array.isArray(git) &&
      Object.keys(git).length === 0;
    const isExact =
      git !== null &&
      typeof git === "object" &&
      !Array.isArray(git) &&
      Object.keys(git).length === CANONICAL_GIT_KEYS.length &&
      CANONICAL_GIT_KEYS.every((key) =>
        Object.prototype.hasOwnProperty.call(git, key),
      ) &&
      typeof git.org === "string" &&
      /^[A-Za-z0-9._-]+$/.test(git.org) &&
      typeof git.repo === "string" &&
      /^[A-Za-z0-9._-]+$/.test(git.repo) &&
      typeof git.ref === "string" &&
      /^[A-Za-z0-9._/-]+$/.test(git.ref) &&
      !git.ref.includes("..") &&
      typeof git.sha === "string" &&
      SHA_PATTERN.test(git.sha) &&
      git.sha === git.sha.toLowerCase();
    if (!isMissing && !isMalformed && !isExact) {
      throw new Error("Main planning Git evidence is malformed");
    }
    if (aliases.has(state.alias)) {
      throw new Error("Main planning snapshot contains duplicate aliases");
    }
    aliases.add(state.alias);
  }
  const ordered = value.states.toSorted((left, right) =>
    left.alias.localeCompare(right.alias),
  );
  if (JSON.stringify(ordered) !== JSON.stringify(value.states)) {
    throw new Error("Main planning snapshot aliases are not canonical");
  }
  return value;
}

function requireIdentifier(value, label) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    !/^[A-Za-z0-9._-]+$/.test(value)
  ) {
    throw new Error(`${label} is missing or malformed`);
  }
  return value;
}

function appendTeamId(path, teamId) {
  const url = new URL(path, API_ORIGIN);
  url.searchParams.set("teamId", requireIdentifier(teamId, "Vercel team ID"));
  return url;
}

export class VercelStateClient {
  constructor({ token, teamId, fetchImplementation = fetch }) {
    if (typeof token !== "string" || token.length === 0) {
      throw new Error("VERCEL_TOKEN is required");
    }
    this.token = token;
    this.teamId = requireIdentifier(teamId, "Vercel team ID");
    this.fetchImplementation = fetchImplementation;
  }

  async request(path) {
    let response;
    const signal = AbortSignal.timeout(15_000);
    try {
      response = await this.fetchImplementation(
        appendTeamId(path, this.teamId),
        {
          method: "GET",
          redirect: "error",
          headers: {
            Authorization: `Bearer ${this.token}`,
            "Content-Type": "application/json",
          },
          signal,
        },
      );
    } catch {
      const timedOut = signal.aborted && signal.reason?.name === "TimeoutError";
      const error = new Error(
        timedOut ? "Vercel API request timed out" : "Vercel API request failed",
      );
      error.code = timedOut
        ? "VERCEL_API_READ_TIMEOUT"
        : "VERCEL_API_READ_TRANSPORT";
      throw error;
    }
    if (!response || typeof response.ok !== "boolean") {
      const error = new Error("Vercel API returned a malformed response");
      error.code = "VERCEL_API_READ_MALFORMED";
      throw error;
    }
    if (!response.ok) {
      // API error bodies can include environment or protection data. Never
      // read them or copy them into an error message.
      const status =
        Number.isInteger(response.status) &&
        response.status >= 100 &&
        response.status <= 599
          ? response.status
          : "unknown";
      const error = new Error(`Vercel API request failed with HTTP ${status}`);
      error.code =
        status === 429
          ? "VERCEL_API_READ_RATE_LIMITED"
          : "VERCEL_API_READ_HTTP";
      if (status === 429) error.status = status;
      throw error;
    }
    try {
      return await response.json();
    } catch {
      const error = new Error("Vercel API returned malformed JSON");
      error.code = "VERCEL_API_READ_MALFORMED";
      throw error;
    }
  }

  async requestWithRetry(path, { attempts = 3 } = {}) {
    if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > 3) {
      throw new Error("Vercel read retry limit is malformed");
    }
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await this.request(path);
      } catch (error) {
        // Retrying a rate-limited request immediately consumes the same
        // endpoint budget and can turn one bounded census into a burst. The
        // caller must fail closed and start a fresh, bounded capture later.
        if (error?.status === 429) throw error;
        lastError = error;
      }
    }
    throw lastError;
  }

  async resolveAlias(alias) {
    const hostname = canonicalizeHostname(alias);
    return this.requestWithRetry(`/v4/aliases/${encodeURIComponent(hostname)}`);
  }

  async inspectDeployment(idOrUrl) {
    const value = requireIdentifier(
      idOrUrl.replace(/^https?:\/\//, ""),
      "Vercel deployment ID or URL",
    );
    const url = new URL(
      `/v13/deployments/${encodeURIComponent(value)}`,
      API_ORIGIN,
    );
    url.searchParams.set("withGitRepoInfo", "true");
    return this.requestWithRetry(`${url.pathname}${url.search}`);
  }

  async listDeploymentAliases(deploymentId) {
    const id = requireIdentifier(deploymentId, "Vercel deployment ID");
    return this.requestWithRetry(
      `/v2/deployments/${encodeURIComponent(id)}/aliases`,
    );
  }

  async inspectProject(projectId) {
    const id = requireIdentifier(projectId, "Vercel project ID");
    return this.requestWithRetry(`/v9/projects/${encodeURIComponent(id)}`);
  }

  async listAppTransactionDeploymentIds(expected, { maximumPages = 5 } = {}) {
    const expectation = canonicalAppTransactionExpectation(expected);
    if (
      !Number.isSafeInteger(maximumPages) ||
      maximumPages < 1 ||
      maximumPages > 5
    ) {
      throw new Error("App candidate pagination limit is malformed");
    }
    const ids = [];
    const seenIds = new Set();
    const seenCursors = new Set();
    let cursor = null;
    for (let page = 1; page <= maximumPages; page += 1) {
      const url = new URL("/v6/deployments", API_ORIGIN);
      url.searchParams.set("projectId", expectation.projectId);
      url.searchParams.set("target", "v3");
      url.searchParams.set("limit", "100");
      url.searchParams.set(
        "meta-mentoTransactionId",
        expectation.transactionId,
      );
      if (cursor !== null) url.searchParams.set("until", cursor);
      const response = await this.requestWithRetry(
        `${url.pathname}${url.search}`,
      );
      if (
        !response ||
        typeof response !== "object" ||
        Array.isArray(response) ||
        !Array.isArray(response.deployments) ||
        !response.pagination ||
        typeof response.pagination !== "object" ||
        Array.isArray(response.pagination)
      ) {
        throw new Error("App candidate deployment list is malformed");
      }
      for (const summary of response.deployments) {
        if (!summary || typeof summary !== "object" || Array.isArray(summary)) {
          throw new Error("App candidate deployment summary is malformed");
        }
        const id = requireIdentifier(
          consistentString("ID", [summary.uid, summary.id]),
          "App candidate deployment ID",
        );
        if (!id.startsWith("dpl_") || seenIds.has(id)) {
          throw new Error("App candidate deployment list is ambiguous");
        }
        seenIds.add(id);
        ids.push(id);
      }
      const next = response.pagination.next ?? null;
      if (next === null) return ids;
      const nextCursor =
        typeof next === "number" && Number.isSafeInteger(next)
          ? String(next)
          : next;
      if (
        typeof nextCursor !== "string" ||
        !/^[1-9][0-9]*$/.test(nextCursor) ||
        seenCursors.has(nextCursor)
      ) {
        throw new Error("App candidate pagination cursor is malformed");
      }
      seenCursors.add(nextCursor);
      cursor = nextCursor;
    }
    throw new Error("App candidate pagination exceeded its bounded limit");
  }

  async listExactShaDeploymentIds({ projectId, deploySha }) {
    const canonicalProjectId = requireIdentifier(
      projectId,
      "Active state project ID",
    );
    if (
      typeof deploySha !== "string" ||
      !SHA_PATTERN.test(deploySha) ||
      deploySha !== deploySha.toLowerCase()
    ) {
      throw new Error("Active state deploy SHA is malformed");
    }
    const seenIds = new Set();
    const url = new URL("/v7/deployments", API_ORIGIN);
    url.searchParams.set("projectId", canonicalProjectId);
    url.searchParams.set("sha", deploySha);
    // A project can prove at most its expected GitHub deployment plus one
    // observational native Git owner. A third result can never prove and must
    // not trigger an unbounded detail scan.
    url.searchParams.set("limit", "3");
    const response = await this.requestWithRetry(
      `${url.pathname}${url.search}`,
    );
    if (
      !response ||
      typeof response !== "object" ||
      Array.isArray(response) ||
      !Array.isArray(response.deployments) ||
      !response.pagination ||
      typeof response.pagination !== "object" ||
      Array.isArray(response.pagination) ||
      !Object.hasOwn(response.pagination, "next")
    ) {
      throw new Error("Active state deployment list is malformed");
    }
    if (response.pagination.next !== null || response.deployments.length > 2) {
      throw new Error(
        "Active state exact-SHA census exceeded its bounded limit",
      );
    }
    for (const summary of response.deployments) {
      if (!summary || typeof summary !== "object" || Array.isArray(summary)) {
        throw new Error("Active state deployment summary is malformed");
      }
      const id = requireDeploymentId(
        consistentString("ID", [summary.uid, summary.id]),
        "Active state deployment ID",
      );
      if (
        seenIds.has(id) ||
        consistentString("project ID", [summary.projectId]) !==
          canonicalProjectId
      ) {
        throw new Error("Active state deployment list is ambiguous");
      }
      seenIds.add(id);
    }
    return [...seenIds].sort();
  }

  async discoverAppTransactionCandidate(
    expected,
    {
      maximumAttempts = 6,
      sleepImplementation = sleep,
      stabilizationDelayMs = 2_000,
    } = {},
  ) {
    const expectation = canonicalAppTransactionExpectation(expected);
    if (
      !Number.isSafeInteger(maximumAttempts) ||
      maximumAttempts < 1 ||
      maximumAttempts > 10 ||
      typeof sleepImplementation !== "function" ||
      !Number.isSafeInteger(stabilizationDelayMs) ||
      stabilizationDelayMs < 0 ||
      stabilizationDelayMs > 10_000
    ) {
      throw new Error("App candidate stabilization limits are malformed");
    }
    for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
      const ids = await this.listAppTransactionDeploymentIds(expectation);
      if (ids.length > 1) {
        throw new Error(
          `App transaction candidate discovery requires exactly one match; received ${ids.length}`,
        );
      }
      if (ids.length === 1) {
        const deploymentResponse = await this.requestWithRetry(
          `/v13/deployments/${encodeURIComponent(ids[0])}?withGitRepoInfo=true`,
        );
        const readyState = consistentString("readiness", [
          deploymentResponse?.readyState,
        ]);
        if (readyState === "READY") {
          return canonicalizeAppTransactionCandidate({
            deploymentResponse,
            expected: expectation,
          });
        }
        if (!APP_CANDIDATE_PENDING_STATES.has(readyState)) {
          throw new Error("App transaction candidate did not become READY");
        }
        canonicalizeAppTransactionCandidate({
          deploymentResponse: {
            ...deploymentResponse,
            readyState: "READY",
          },
          expected: expectation,
        });
      }
      if (attempt < maximumAttempts) {
        await sleepImplementation(stabilizationDelayMs);
      }
    }
    throw new Error(
      "App transaction candidate did not stabilize within the bounded window",
    );
  }

  async canonicalAliasState(spec) {
    assertStateExpectation(spec);
    const aliasResponse = await this.resolveAlias(spec.alias);
    const lookup = canonicalizeAliasLookup(spec.alias, aliasResponse);
    const deploymentResponse = await this.inspectDeployment(
      lookup.deploymentId,
    );
    const aliasesResponse = await this.listDeploymentAliases(
      lookup.deploymentId,
    );
    const confirmedAliasResponse = await this.resolveAlias(spec.alias);
    const confirmedLookup = canonicalizeAliasLookup(
      spec.alias,
      confirmedAliasResponse,
    );
    if (
      confirmedLookup.deploymentId !== lookup.deploymentId ||
      confirmedLookup.projectId !== lookup.projectId
    ) {
      throw new Error("Alias mapping changed during inspection");
    }
    return canonicalizeDeploymentState({
      alias: spec.alias,
      aliasResponse: confirmedAliasResponse,
      deploymentResponse,
      aliasesResponse,
      expected: spec,
    });
  }

  async canonicalLegacyV2State(spec) {
    assertStateExpectation(spec, { requireDeployment: true });
    if (
      spec.alias !== "v2-app.mento.org" ||
      spec.projectName !== "app.mento.org" ||
      spec.target !== "production" ||
      spec.customEnvironmentSlug !== null ||
      spec.git?.org !== "mento-protocol" ||
      spec.git?.repo !== "frontend-monorepo" ||
      spec.git?.ref !== "v2"
    ) {
      throw new Error("Legacy App v2 expectation is malformed");
    }
    const aliasResponse = await this.resolveAlias(spec.alias);
    const lookup = canonicalizeAliasLookup(spec.alias, aliasResponse);
    if (
      lookup.deploymentId !== spec.deployment ||
      lookup.projectId !== spec.projectId
    ) {
      throw new Error("Legacy App v2 alias mapping does not match");
    }
    const deploymentResponse = await this.inspectDeployment(
      lookup.deploymentId,
    );
    const aliasesResponse = await this.listDeploymentAliases(
      lookup.deploymentId,
    );
    const confirmedAliasResponse = await this.resolveAlias(spec.alias);
    const confirmedLookup = canonicalizeAliasLookup(
      spec.alias,
      confirmedAliasResponse,
    );
    if (
      confirmedLookup.deploymentId !== lookup.deploymentId ||
      confirmedLookup.projectId !== lookup.projectId
    ) {
      throw new Error("Legacy App v2 alias mapping changed during inspection");
    }
    return {
      ownership: "native-vercel-git",
      state: canonicalizeDeploymentState({
        alias: spec.alias,
        aliasResponse: confirmedAliasResponse,
        deploymentResponse,
        aliasesResponse,
        expected: spec,
      }),
    };
  }

  async mainPlanningAliasState(spec) {
    assertStateExpectation(spec);
    const aliasResponse = await this.resolveAlias(spec.alias);
    const lookup = canonicalizeAliasLookup(spec.alias, aliasResponse);
    const deploymentResponse = await this.inspectDeployment(
      lookup.deploymentId,
    );
    const aliasesResponse = await this.listDeploymentAliases(
      lookup.deploymentId,
    );
    const confirmedAliasResponse = await this.resolveAlias(spec.alias);
    const confirmedLookup = canonicalizeAliasLookup(
      spec.alias,
      confirmedAliasResponse,
    );
    if (
      confirmedLookup.deploymentId !== lookup.deploymentId ||
      confirmedLookup.projectId !== lookup.projectId
    ) {
      throw new Error("Alias mapping changed during inspection");
    }
    return canonicalizeMainPlanningDeploymentState({
      alias: spec.alias,
      aliasResponse: confirmedAliasResponse,
      deploymentResponse,
      aliasesResponse,
      expected: spec,
    });
  }

  async aliasMapping(alias) {
    const aliasResponse = await this.resolveAlias(alias);
    const lookup = canonicalizeAliasLookup(alias, aliasResponse);
    const deploymentResponse = await this.inspectDeployment(
      lookup.deploymentId,
    );
    const confirmedAliasResponse = await this.resolveAlias(alias);
    const confirmedLookup = canonicalizeAliasLookup(
      alias,
      confirmedAliasResponse,
    );
    if (
      confirmedLookup.deploymentId !== lookup.deploymentId ||
      confirmedLookup.projectId !== lookup.projectId
    ) {
      throw new Error("Alias mapping changed during inspection");
    }
    return canonicalizeAliasMapping({
      alias,
      aliasResponse: confirmedAliasResponse,
      deploymentResponse,
    });
  }

  async canonicalDeploymentState({ deployment, alias, ...expected }) {
    assertStateExpectation(
      { deployment, alias, ...expected },
      { requireDeployment: true },
    );
    const deploymentResponse = await this.inspectDeployment(deployment);
    const aliasesResponse = await this.listDeploymentAliases(
      deploymentResponse.id,
    );
    return canonicalizeDeploymentState({
      alias: alias ?? deploymentResponse.url,
      deploymentResponse,
      aliasesResponse,
      expected: { deployment, ...expected },
    });
  }

  async assertProject({ projectId, projectName, rootDirectory }) {
    requireIdentifier(projectId, "Expected project ID");
    requireIdentifier(projectName, "Expected project name");
    if (
      typeof rootDirectory !== "string" ||
      !/^apps\/[A-Za-z0-9._-]+$/.test(rootDirectory)
    ) {
      throw new Error(
        "Expected project Root Directory is missing or malformed",
      );
    }
    const project = await this.inspectProject(projectId);
    if (project.id !== projectId)
      throw new Error("Unexpected Vercel project ID");
    if (project.name !== projectName) {
      throw new Error("Unexpected Vercel project name");
    }
    if (project.rootDirectory !== rootDirectory) {
      throw new Error("Unexpected Vercel project Root Directory");
    }
  }
}

export async function captureAliasMappings(client, aliases) {
  if (!Array.isArray(aliases) || aliases.length === 0) {
    throw new Error("Alias mapping list must be non-empty");
  }
  const mappings = [];
  const seen = new Set();
  for (const value of aliases) {
    const alias = canonicalizeHostname(value);
    if (seen.has(alias))
      throw new Error("Alias mapping list contains duplicates");
    seen.add(alias);
    mappings.push(await client.aliasMapping(alias));
  }
  return mappings.sort((left, right) => left.alias.localeCompare(right.alias));
}

export function assertActiveAliasMappingSet(value) {
  assertExactKeys(value, ["aliases", "schema"], "Active alias mapping set");
  if (
    value.schema !== ACTIVE_ALIAS_MAPPING_SET_SCHEMA ||
    !Array.isArray(value.aliases) ||
    JSON.stringify(value.aliases) !== JSON.stringify(ACTIVE_PROTECTED_ALIASES)
  ) {
    throw new Error("Active alias mapping set is malformed");
  }
  return value;
}

export function assertActiveAliasMappingSpec(value) {
  assertExactKeys(
    value,
    ["bindings", "schema"],
    "Active alias mapping specification",
  );
  if (
    value.schema !== ACTIVE_ALIAS_MAPPING_SPEC_SCHEMA ||
    !Array.isArray(value.bindings) ||
    value.bindings.length === 0
  ) {
    throw new Error("Active alias mapping specification is malformed");
  }
  const aliases = new Set();
  const bindings = value.bindings.map((binding, index) => {
    assertExactKeys(
      binding,
      ["alias", "projectId", "target"],
      `Active alias mapping binding ${index + 1}`,
    );
    const alias = canonicalizeHostname(binding.alias);
    const projectId = requireIdentifier(
      binding.projectId,
      `Active alias mapping binding ${index + 1} project ID`,
    );
    if (
      !ACTIVE_MAPPING_TARGETS.includes(binding.target) ||
      aliases.has(alias)
    ) {
      throw new Error("Active alias mapping bindings are ambiguous");
    }
    aliases.add(alias);
    return { alias, projectId, target: binding.target };
  });
  const canonical = bindings.toSorted((left, right) =>
    left.alias.localeCompare(right.alias),
  );
  if (JSON.stringify(bindings) !== JSON.stringify(canonical)) {
    throw new Error("Active alias mapping bindings are not canonical");
  }
  return {
    schema: ACTIVE_ALIAS_MAPPING_SPEC_SCHEMA,
    bindings: canonical,
  };
}

function assertBoundActiveAliasMappings(value, spec) {
  const canonicalSpec = assertActiveAliasMappingSpec(spec);
  if (!Array.isArray(value) || value.length !== canonicalSpec.bindings.length) {
    throw new Error("Bound active alias mappings are incomplete");
  }
  const expectedByAlias = new Map(
    canonicalSpec.bindings.map((binding) => [binding.alias, binding]),
  );
  const seen = new Set();
  const mappings = value.map((entry, index) => {
    const alias = canonicalizeHostname(entry?.alias);
    const expected = expectedByAlias.get(alias);
    const hasProjectId = Object.hasOwn(entry ?? {}, "projectId");
    assertExactKeys(
      entry,
      hasProjectId
        ? ["alias", "deploymentId", "deploymentUrl", "projectId"]
        : ["alias", "deploymentId", "deploymentUrl"],
      `Bound active alias mapping ${index + 1}`,
    );
    if (
      expected === undefined ||
      seen.has(alias) ||
      (!hasProjectId && expected.target === "legacy-app") ||
      (hasProjectId &&
        requireIdentifier(
          entry.projectId,
          `Bound active alias mapping ${index + 1} project ID`,
        ) !== expected.projectId)
    ) {
      throw new Error("Bound active alias mapping conflicts with its spec");
    }
    seen.add(alias);
    const mapping = {
      alias,
      deploymentId: requireDeploymentId(
        entry.deploymentId,
        `Bound active alias mapping ${index + 1} deployment ID`,
      ),
      deploymentUrl: canonicalizeDeploymentUrl(entry.deploymentUrl),
    };
    return expected.target === "legacy-app"
      ? { ...mapping, projectId: expected.projectId }
      : mapping;
  });
  if (seen.size !== expectedByAlias.size) {
    throw new Error("Bound active alias mappings are incomplete");
  }
  return mappings.toSorted((left, right) =>
    left.alias.localeCompare(right.alias),
  );
}

export function assertActiveAliasMappings(value) {
  if (
    !Array.isArray(value) ||
    value.length !== ACTIVE_PROTECTED_ALIASES.length
  ) {
    throw new Error("Active alias mappings are malformed");
  }
  const mappings = value.map((entry, index) => {
    assertExactKeys(
      entry,
      ["alias", "deploymentId", "deploymentUrl"],
      `Active alias mapping ${index + 1}`,
    );
    return {
      alias: canonicalizeHostname(entry.alias),
      deploymentId: requireDeploymentId(
        entry.deploymentId,
        `Active alias mapping ${index + 1} deployment ID`,
      ),
      deploymentUrl: canonicalizeDeploymentUrl(entry.deploymentUrl),
    };
  });
  if (
    JSON.stringify(mappings.map((mapping) => mapping.alias).toSorted()) !==
    JSON.stringify(ACTIVE_PROTECTED_ALIASES)
  ) {
    throw new Error(
      "Active alias mappings do not exactly cover protected aliases",
    );
  }
  return mappings.toSorted((left, right) =>
    left.alias.localeCompare(right.alias),
  );
}

function assertStateExpectation(expected, { requireDeployment = false } = {}) {
  if (!expected || typeof expected !== "object" || Array.isArray(expected)) {
    throw new Error("Deployment expectation is malformed");
  }
  requireIdentifier(expected.projectId, "Expected project ID");
  requireIdentifier(expected.projectName, "Expected project name");
  if (expected.git?.org !== "mento-protocol") {
    throw new Error("Expected Git organization must be mento-protocol");
  }
  if (expected.git?.repo !== "frontend-monorepo") {
    throw new Error("Expected Git repository must be frontend-monorepo");
  }
  if (!["main", "v2"].includes(expected.git?.ref)) {
    throw new Error("Expected Git ref must be main or v2");
  }
  if (
    expected.git.sha !== undefined &&
    (typeof expected.git.sha !== "string" ||
      !SHA_PATTERN.test(expected.git.sha))
  ) {
    throw new Error("Expected Git SHA is malformed");
  }
  const isProduction =
    expected.target === "production" && expected.customEnvironmentSlug === null;
  const isAppV3 =
    expected.target === null && expected.customEnvironmentSlug === "v3";
  if (!isProduction && !isAppV3) {
    throw new Error("Expected deployment environment is malformed");
  }
  if (expected.readyState !== undefined && expected.readyState !== "READY") {
    throw new Error("Expected deployment readiness must be READY");
  }
  if (
    expected.transaction !== undefined &&
    canonicalizeRunTransaction(expected.transaction) !== expected.transaction
  ) {
    throw new Error("Expected workflow transaction is malformed");
  }
  if (expected.alias !== undefined) canonicalizeHostname(expected.alias);
  if (requireDeployment) {
    requireIdentifier(expected.deployment, "Expected deployment ID");
    canonicalizeDeploymentUrl(expected.deploymentUrl);
    if (expected.git.sha === undefined) {
      throw new Error("Expected Git SHA is required");
    }
  }
  return expected;
}

export function assertSnapshotSpec(spec) {
  if (!Array.isArray(spec) || spec.length === 0) {
    throw new Error("Protected alias specification must be a non-empty array");
  }
  const aliases = new Set();
  for (const entry of spec) {
    if (!entry || typeof entry !== "object") {
      throw new Error("Protected alias specification is malformed");
    }
    const alias = canonicalizeHostname(entry.alias);
    if (aliases.has(alias)) throw new Error("Protected alias is duplicated");
    aliases.add(alias);
    assertStateExpectation(entry);
  }
  return spec;
}

function requireDeploymentId(value, label) {
  const deploymentId = requireIdentifier(value, label);
  if (!/^dpl_[A-Za-z0-9]+$/.test(deploymentId)) {
    throw new Error(`${label} is missing or malformed`);
  }
  return deploymentId;
}

function requirePositiveIdentifier(value, label) {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) {
    throw new Error(`${label} is missing or malformed`);
  }
  return value;
}

function activeProjectEnvironment(target) {
  return target === "app"
    ? { target: null, customEnvironmentSlug: "v3" }
    : { target: "production", customEnvironmentSlug: null };
}

function canonicalActiveStateTargets(value, label) {
  if (
    !Array.isArray(value) ||
    value.some((target) => !ACTIVE_STATE_TARGETS.includes(target)) ||
    new Set(value).size !== value.length
  ) {
    throw new Error(`${label} are malformed`);
  }
  const ordered = value.toSorted(
    (left, right) =>
      ACTIVE_STATE_TARGETS.indexOf(left) - ACTIVE_STATE_TARGETS.indexOf(right),
  );
  if (JSON.stringify(ordered) !== JSON.stringify(value)) {
    throw new Error(`${label} are not canonical`);
  }
  return value;
}

function plannedDispositionForTarget(
  logicalTarget,
  activeTargets,
  shadowTargets,
) {
  if (activeTargets.includes(logicalTarget)) return "githubPrebuilt";
  if (logicalTarget !== "app" && shadowTargets.includes(logicalTarget)) {
    return "githubShadowStage";
  }
  return null;
}

// App recovery evidence may carry a zero-candidate recoveredPrior expectation
// when its v3 deploy never started or when a manual-intervention terminal cannot
// prove whether a started command created a detached candidate. In the latter
// case this is fail-closed evidence, not proof that no candidate exists: any
// matching candidate makes the state proof unproven. Ordinary targets always
// have an exact staged candidate before activation.
function expectedActiveStateDisposition({
  logicalTarget,
  activeTargets,
  shadowTargets,
  project,
}) {
  const planned = plannedDispositionForTarget(
    logicalTarget,
    activeTargets,
    shadowTargets,
  );
  if (project.expectedDisposition !== "recoveredPrior") return planned;
  const deploymentId = Object.hasOwn(project, "deploymentId")
    ? project.deploymentId
    : project.expectedDeploymentId;
  const deploymentUrl = Object.hasOwn(project, "deploymentUrl")
    ? project.deploymentUrl
    : project.expectedDeploymentUrl;
  if (
    logicalTarget !== "app" ||
    planned !== "githubPrebuilt" ||
    deploymentId !== null ||
    deploymentUrl !== null
  ) {
    throw new Error(
      `${logicalTarget} recovered-prior deployment expectation is malformed`,
    );
  }
  return "recoveredPrior";
}

function canonicalMainOwnershipMode(value) {
  assertExactKeys(value, ACTIVE_STATE_TARGETS, "Main ownership mode");
  for (const logicalTarget of ACTIVE_STATE_TARGETS) {
    if (!["github", "shadow"].includes(value[logicalTarget])) {
      throw new Error("Main ownership mode is malformed");
    }
  }
  return value;
}

function assertActiveReleaseManifestBinding({
  releaseManifest,
  deploySha,
  mainOwnershipMode,
  stagedTargets,
  activeTargets,
  projects,
  label,
}) {
  const manifest = assertMainReleaseManifest(releaseManifest);
  const shadowTargets = manifest.stagedTargets.filter(
    (target) => !manifest.activeTargets.includes(target),
  );
  const normalizeTargets = (targets) =>
    ACTIVE_STATE_TARGETS.filter((target) => targets.includes(target));
  if (
    JSON.stringify(manifest) !== JSON.stringify(releaseManifest) ||
    manifest.deploySha !== deploySha ||
    JSON.stringify(manifest.mainOwnershipMode) !==
      JSON.stringify(mainOwnershipMode) ||
    JSON.stringify(normalizeTargets(manifest.stagedTargets)) !==
      JSON.stringify(stagedTargets) ||
    JSON.stringify(normalizeTargets(manifest.activeTargets)) !==
      JSON.stringify(activeTargets) ||
    JSON.stringify(normalizeTargets(shadowTargets)) !==
      JSON.stringify(
        stagedTargets.filter((target) => !activeTargets.includes(target)),
      )
  ) {
    throw new Error(`${label} release manifest conflicts with state identity`);
  }
  for (const logicalTarget of ACTIVE_STATE_TARGETS) {
    const prior = manifest.originalPriors[logicalTarget];
    const project = projects[logicalTarget];
    if (
      project === undefined ||
      prior.projectId !== project.projectId ||
      prior.projectName !== project.projectName
    ) {
      throw new Error(`${label} release manifest project identity conflicts`);
    }
  }
  return manifest;
}

export function assertActiveDeploymentStateSpec(spec) {
  assertExactKeys(spec, ACTIVE_STATE_SPEC_KEYS, "Active deployment state spec");
  if (
    spec.schema !== ACTIVE_DEPLOYMENT_STATE_SPEC_SCHEMA ||
    typeof spec.deploySha !== "string" ||
    !SHA_PATTERN.test(spec.deploySha) ||
    spec.deploySha !== spec.deploySha.toLowerCase() ||
    typeof spec.transactionId !== "string" ||
    !/^main-[a-f0-9]{32}$/.test(spec.transactionId)
  ) {
    throw new Error("Active deployment state spec identity is malformed");
  }
  requirePositiveIdentifier(spec.runId, "Planned active state run ID");
  requirePositiveIdentifier(
    spec.runAttempt,
    "Planned active state run attempt",
  );
  const stagedTargets = canonicalActiveStateTargets(
    spec.stagedTargets,
    "Planned staged targets",
  );
  const activeTargets = canonicalActiveStateTargets(
    spec.activeTargets,
    "Planned active targets",
  );
  const shadowTargets = canonicalActiveStateTargets(
    spec.shadowTargets,
    "Planned shadow targets",
  );
  const mainOwnershipMode = canonicalMainOwnershipMode(spec.mainOwnershipMode);
  if (
    activeTargets.some((target) => shadowTargets.includes(target)) ||
    activeTargets.some((target) => mainOwnershipMode[target] !== "github") ||
    shadowTargets.some((target) => mainOwnershipMode[target] !== "shadow") ||
    JSON.stringify(
      [...activeTargets, ...shadowTargets].toSorted(
        (left, right) =>
          ACTIVE_STATE_TARGETS.indexOf(left) -
          ACTIVE_STATE_TARGETS.indexOf(right),
      ),
    ) !== JSON.stringify(stagedTargets)
  ) {
    throw new Error("Planned active deployment target partition is malformed");
  }
  assertExactKeys(
    spec.projects,
    ACTIVE_STATE_TARGETS,
    "Active deployment state projects",
  );
  const projectIds = new Set();
  const deploymentIds = new Set();
  const deploymentUrls = new Set();
  for (const logicalTarget of ACTIVE_STATE_TARGETS) {
    const project = spec.projects[logicalTarget];
    assertExactKeys(
      project,
      ACTIVE_STATE_PROJECT_SPEC_KEYS,
      `${logicalTarget} planned active deployment state project`,
    );
    const expectedEnvironment = activeProjectEnvironment(logicalTarget);
    const projectId = requireIdentifier(
      project.projectId,
      `${logicalTarget} planned active project ID`,
    );
    const expectedDisposition = expectedActiveStateDisposition({
      logicalTarget,
      activeTargets,
      shadowTargets,
      project,
    });
    let deploymentId = null;
    let deploymentUrl = null;
    if (
      expectedDisposition === null ||
      expectedDisposition === "recoveredPrior"
    ) {
      if (project.deploymentId !== null || project.deploymentUrl !== null) {
        throw new Error(
          `${logicalTarget} planned active deployment expectation is malformed`,
        );
      }
    } else {
      deploymentId = requireDeploymentId(
        project.deploymentId,
        `${logicalTarget} planned active deployment ID`,
      );
      deploymentUrl = canonicalizeDeploymentUrl(project.deploymentUrl);
    }
    if (
      project.projectName !== `${logicalTarget}.mento.org` ||
      project.expectedDisposition !== expectedDisposition ||
      project.deploymentUrl !== deploymentUrl ||
      project.target !== expectedEnvironment.target ||
      project.customEnvironmentSlug !==
        expectedEnvironment.customEnvironmentSlug ||
      projectIds.has(projectId) ||
      (deploymentId !== null && deploymentIds.has(deploymentId)) ||
      (deploymentUrl !== null && deploymentUrls.has(deploymentUrl))
    ) {
      throw new Error(
        `${logicalTarget} planned active deployment state project is malformed`,
      );
    }
    projectIds.add(projectId);
    if (deploymentId !== null) deploymentIds.add(deploymentId);
    if (deploymentUrl !== null) deploymentUrls.add(deploymentUrl);
  }
  assertActiveReleaseManifestBinding({
    releaseManifest: spec.releaseManifest,
    deploySha: spec.deploySha,
    mainOwnershipMode,
    stagedTargets,
    activeTargets,
    projects: spec.projects,
    label: "Active deployment state spec",
  });
  assertExactKeys(
    spec.legacyAppV2,
    ACTIVE_STATE_LEGACY_SPEC_KEYS,
    "Legacy App v2 state",
  );
  assertStateExpectation(spec.legacyAppV2, { requireDeployment: true });
  const legacyDeploymentId = requireDeploymentId(
    spec.legacyAppV2.deployment,
    "Legacy App v2 deployment ID",
  );
  const legacyDeploymentUrl = canonicalizeDeploymentUrl(
    spec.legacyAppV2.deploymentUrl,
  );
  if (
    spec.legacyAppV2.alias !== "v2-app.mento.org" ||
    spec.legacyAppV2.projectId !== spec.projects.app.projectId ||
    spec.legacyAppV2.projectName !== "app.mento.org" ||
    spec.legacyAppV2.readyState !== "READY" ||
    spec.legacyAppV2.target !== "production" ||
    spec.legacyAppV2.customEnvironmentSlug !== null ||
    spec.legacyAppV2.git.org !== "mento-protocol" ||
    spec.legacyAppV2.git.repo !== "frontend-monorepo" ||
    spec.legacyAppV2.git.ref !== "v2" ||
    typeof spec.legacyAppV2.git.sha !== "string" ||
    !SHA_PATTERN.test(spec.legacyAppV2.git.sha) ||
    spec.legacyAppV2.git.sha !== spec.legacyAppV2.git.sha.toLowerCase() ||
    legacyDeploymentUrl !== spec.legacyAppV2.deploymentUrl ||
    deploymentIds.has(legacyDeploymentId) ||
    deploymentUrls.has(legacyDeploymentUrl)
  ) {
    throw new Error("Legacy App v2 state is malformed");
  }
  return spec;
}

function canonicalActiveDeploymentIdentity(entry, deploySha) {
  if (
    !entry ||
    typeof entry !== "object" ||
    Array.isArray(entry) ||
    !Object.hasOwn(entry, "deploymentId") ||
    !Object.hasOwn(entry, "response")
  ) {
    throw new Error("Active deployment inspection entry is malformed");
  }
  const requestedId = requireDeploymentId(
    entry.deploymentId,
    "Active deployment requested ID",
  );
  const raw = entry.response;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Active state inspected deployment is malformed");
  }
  const git = canonicalizeActiveCensusGit(raw, deploySha);
  const malformedIdentity = {
    deploymentId: null,
    deploymentUrl: null,
    projectId: null,
    projectName: null,
    readyState: null,
    target: null,
    customEnvironmentSlug: null,
    git,
    source: null,
    meta: null,
  };
  try {
    const deploymentId = requireDeploymentId(
      consistentString("ID", [raw.id, raw.uid]),
      "Active deployment ID",
    );
    if (deploymentId !== requestedId) return null;
    const deploymentUrl = canonicalizeDeploymentUrl(raw.url);
    const projectId = consistentString("project ID", [
      raw.projectId,
      raw.project?.id,
    ]);
    const projectName = consistentString("project name", [
      raw.name,
      raw.project?.name,
    ]);
    const readyState = consistentString("readiness", [raw.readyState]);
    const target = raw.target ?? null;
    if (
      target !== null &&
      (typeof target !== "string" || target.length === 0)
    ) {
      return null;
    }
    let customEnvironmentSlug = null;
    if (raw.customEnvironment !== undefined && raw.customEnvironment !== null) {
      if (
        typeof raw.customEnvironment !== "object" ||
        Array.isArray(raw.customEnvironment) ||
        typeof raw.customEnvironment.slug !== "string" ||
        raw.customEnvironment.slug.length === 0
      ) {
        return null;
      }
      customEnvironmentSlug = raw.customEnvironment.slug;
    }
    const source =
      typeof raw.source === "string" && /^[a-z][a-z-]*$/.test(raw.source)
        ? raw.source
        : null;
    const meta =
      raw.meta && typeof raw.meta === "object" && !Array.isArray(raw.meta)
        ? raw.meta
        : null;
    return {
      deploymentId,
      deploymentUrl,
      projectId,
      projectName,
      readyState,
      target,
      customEnvironmentSlug,
      git,
      source,
      meta,
    };
  } catch {
    return malformedIdentity;
  }
}

function matchesActiveProjectTopology(identity, project, deploySha) {
  return (
    identity !== null &&
    identity.projectId === project.projectId &&
    identity.projectName === project.projectName &&
    identity.readyState === "READY" &&
    identity.target === project.target &&
    identity.customEnvironmentSlug === project.customEnvironmentSlug &&
    identity.git.sha === deploySha
  );
}

function matchesCanonicalMainCandidate(identity, project, deploySha) {
  return (
    matchesActiveProjectTopology(identity, project, deploySha) &&
    identity.git.org === "mento-protocol" &&
    identity.git.repo === "frontend-monorepo" &&
    identity.git.ref === "main" &&
    identity.git.sha === deploySha
  );
}

function hasExpectedGitHubMetadata(identity, logicalTarget, spec) {
  if (
    identity.meta === null ||
    Object.hasOwn(identity.meta, "githubDeployment")
  ) {
    return false;
  }
  const project = spec.projects[logicalTarget];
  try {
    const metadata = canonicalizeMainCandidateVercelMetadata(identity.meta, {
      target: logicalTarget,
      deploySha: spec.deploySha,
      projectId: project.projectId,
      projectName: project.projectName,
    });
    return (
      JSON.stringify(metadata.releaseManifest) ===
      JSON.stringify(spec.releaseManifest)
    );
  } catch {
    return false;
  }
}

function canonicalActiveDeploymentRecord(
  requestedId,
  identity,
  logicalTarget,
  spec,
) {
  return {
    deploymentId: requestedId,
    deploymentUrl: identity?.deploymentUrl ?? null,
    projectId: identity?.projectId ?? null,
    projectName: identity?.projectName ?? null,
    readyState: identity?.readyState ?? null,
    target: identity?.target ?? null,
    customEnvironmentSlug: identity?.customEnvironmentSlug ?? null,
    git: identity === null ? null : { ...identity.git },
    source: identity?.source ?? null,
    workflowMetadataMatches:
      identity !== null &&
      hasExpectedGitHubMetadata(identity, logicalTarget, spec),
  };
}

function matchesLegacyV2Identity(identity, legacy) {
  return (
    identity !== null &&
    identity.deploymentId === legacy.deployment &&
    identity.deploymentUrl === legacy.deploymentUrl &&
    identity.projectId === legacy.projectId &&
    identity.projectName === legacy.projectName &&
    identity.readyState === "READY" &&
    identity.target === "production" &&
    identity.customEnvironmentSlug === null &&
    identity.git.org === "mento-protocol" &&
    identity.git.repo === "frontend-monorepo" &&
    identity.git.ref === "v2" &&
    identity.git.sha === legacy.git.sha
  );
}

function canonicalLegacyV2Proof(spec, legacyV2) {
  if (!legacyV2 || typeof legacyV2 !== "object" || Array.isArray(legacyV2)) {
    throw new Error("Legacy App v2 state is unproven");
  }
  assertExactKeys(
    legacyV2,
    ["ownership", "state"],
    "Legacy App v2 capture proof",
  );
  if (legacyV2.ownership !== "native-vercel-git") {
    throw new Error("Legacy App v2 state is unproven");
  }
  const state = assertCanonicalOutput(legacyV2.state);
  if (
    state.alias !== spec.alias ||
    state.deploymentId !== spec.deployment ||
    state.deploymentUrl !== spec.deploymentUrl ||
    state.projectId !== spec.projectId ||
    state.projectName !== spec.projectName ||
    state.readyState !== "READY" ||
    state.target !== "production" ||
    state.customEnvironmentSlug !== null ||
    state.git.org !== "mento-protocol" ||
    state.git.repo !== "frontend-monorepo" ||
    state.git.ref !== "v2" ||
    state.git.sha !== spec.git.sha
  ) {
    throw new Error("Legacy App v2 state is unproven");
  }
  return {
    alias: state.alias,
    deploymentId: state.deploymentId,
    deploymentUrl: state.deploymentUrl,
    projectId: state.projectId,
    projectName: state.projectName,
    readyState: state.readyState,
    target: state.target,
    customEnvironmentSlug: state.customEnvironmentSlug,
    git: { ...state.git },
    ownership: "native-vercel-git",
  };
}

function matchesReleaseRollbackPrior(identity, logicalTarget, spec) {
  const prior = spec.releaseManifest.originalPriors[logicalTarget];
  const project = spec.projects[logicalTarget];
  return (
    identity !== null &&
    prior.servedSha === spec.deploySha &&
    identity.deploymentId === prior.deploymentId &&
    identity.deploymentUrl === prior.deploymentUrl &&
    identity.projectId === prior.projectId &&
    identity.projectName === prior.projectName &&
    identity.projectId === project.projectId &&
    identity.projectName === project.projectName &&
    identity.readyState === "READY" &&
    identity.target === project.target &&
    identity.customEnvironmentSlug === project.customEnvironmentSlug &&
    identity.git.sha === prior.servedSha
  );
}

function sortedUniqueIds(values, label) {
  if (
    !Array.isArray(values) ||
    values.some(
      (value) => typeof value !== "string" || !/^dpl_[A-Za-z0-9]+$/.test(value),
    ) ||
    new Set(values).size !== values.length
  ) {
    throw new Error(`${label} is malformed`);
  }
  const sorted = values.toSorted();
  if (JSON.stringify(sorted) !== JSON.stringify(values)) {
    throw new Error(`${label} is not canonical`);
  }
  return values;
}

export function createActiveDeploymentStateProof({
  spec,
  deployments,
  legacyV2,
}) {
  const canonicalSpec = assertActiveDeploymentStateSpec(spec);
  assertExactKeys(
    deployments,
    ACTIVE_STATE_TARGETS,
    "Active deployment inspections",
  );
  const projects = {};
  for (const logicalTarget of ACTIVE_STATE_TARGETS) {
    const project = canonicalSpec.projects[logicalTarget];
    const entries = deployments[logicalTarget];
    if (!Array.isArray(entries)) {
      throw new Error(
        `${logicalTarget} active deployment inspections are malformed`,
      );
    }
    const ids = Object.fromEntries(
      ACTIVE_STATE_CLASSIFICATIONS.map((classification) => [
        classification,
        [],
      ]),
    );
    const records = Object.fromEntries(
      ACTIVE_STATE_CLASSIFICATIONS.map((classification) => [
        classification,
        [],
      ]),
    );
    const seenIds = new Set();
    for (const entry of entries) {
      const requestedId = requireDeploymentId(
        entry?.deploymentId,
        `${logicalTarget} active deployment requested ID`,
      );
      if (seenIds.has(requestedId)) {
        throw new Error(
          `${logicalTarget} active deployment inspection is ambiguous`,
        );
      }
      seenIds.add(requestedId);
      const identity = canonicalActiveDeploymentIdentity(
        entry,
        canonicalSpec.deploySha,
      );
      let classification = "unknown";
      if (
        logicalTarget === "app" &&
        requestedId === canonicalSpec.legacyAppV2.deployment &&
        matchesLegacyV2Identity(identity, canonicalSpec.legacyAppV2)
      ) {
        classification = "legacyV2";
      } else if (
        matchesActiveProjectTopology(identity, project, canonicalSpec.deploySha)
      ) {
        if (
          matchesCanonicalMainCandidate(
            identity,
            project,
            canonicalSpec.deploySha,
          ) &&
          identity.deploymentId === project.deploymentId &&
          identity.deploymentUrl === project.deploymentUrl &&
          hasExpectedGitHubMetadata(identity, logicalTarget, canonicalSpec)
        ) {
          classification = project.expectedDisposition;
        } else if (
          matchesReleaseRollbackPrior(identity, logicalTarget, canonicalSpec)
        ) {
          classification =
            canonicalSpec.mainOwnershipMode[logicalTarget] === "shadow"
              ? "nativeGitOwner"
              : "nativeGitDuplicates";
        } else {
          classification = "manualDuplicates";
        }
      }
      records[classification].push(
        canonicalActiveDeploymentRecord(
          requestedId,
          identity,
          logicalTarget,
          canonicalSpec,
        ),
      );
    }
    const nativeGitRecords = records.nativeGitOwner.toSorted((left, right) =>
      left.deploymentId.localeCompare(right.deploymentId),
    );
    records.nativeGitOwner =
      canonicalSpec.mainOwnershipMode[logicalTarget] === "shadow"
        ? nativeGitRecords.slice(0, 1)
        : [];
    records.nativeGitDuplicates.push(
      ...(canonicalSpec.mainOwnershipMode[logicalTarget] === "shadow"
        ? nativeGitRecords.slice(1)
        : nativeGitRecords),
    );
    for (const classification of ACTIVE_STATE_CLASSIFICATIONS) {
      records[classification].sort((left, right) =>
        left.deploymentId.localeCompare(right.deploymentId),
      );
      ids[classification] = records[classification].map(
        ({ deploymentId }) => deploymentId,
      );
    }
    const counts = {
      scanned: entries.length,
      ...Object.fromEntries(
        ACTIVE_STATE_CLASSIFICATIONS.map((classification) => [
          classification,
          ids[classification].length,
        ]),
      ),
    };
    projects[logicalTarget] = {
      projectId: project.projectId,
      projectName: project.projectName,
      target: project.target,
      customEnvironmentSlug: project.customEnvironmentSlug,
      mainOwnershipMode: canonicalSpec.mainOwnershipMode[logicalTarget],
      expectedDisposition: project.expectedDisposition,
      expectedDeploymentId: project.deploymentId,
      expectedDeploymentUrl: project.deploymentUrl,
      priorDeploymentId:
        canonicalSpec.releaseManifest.originalPriors[logicalTarget]
          .deploymentId,
      priorDeploymentUrl:
        canonicalSpec.releaseManifest.originalPriors[logicalTarget]
          .deploymentUrl,
      priorServedSha:
        canonicalSpec.releaseManifest.originalPriors[logicalTarget].servedSha,
      counts,
      ids,
      records,
    };
  }
  const proven = ACTIVE_STATE_TARGETS.every((logicalTarget) => {
    const { counts, ids } = projects[logicalTarget];
    const project = canonicalSpec.projects[logicalTarget];
    return (
      counts.githubPrebuilt ===
        (project.expectedDisposition === "githubPrebuilt" ? 1 : 0) &&
      (project.expectedDisposition !== "githubPrebuilt" ||
        ids.githubPrebuilt[0] === project.deploymentId) &&
      counts.githubShadowStage ===
        (project.expectedDisposition === "githubShadowStage" ? 1 : 0) &&
      (project.expectedDisposition !== "githubShadowStage" ||
        ids.githubShadowStage[0] === project.deploymentId) &&
      counts.nativeGitOwner <=
        (canonicalSpec.mainOwnershipMode[logicalTarget] === "shadow" ? 1 : 0) &&
      counts.nativeGitDuplicates <=
        (canonicalSpec.mainOwnershipMode[logicalTarget] === "github" ? 1 : 0) &&
      counts.manualDuplicates === 0 &&
      counts.unknown === 0
    );
  });
  return assertActiveDeploymentStateProof({
    schema: ACTIVE_DEPLOYMENT_STATE_PROOF_SCHEMA,
    outcome: proven ? "proven" : "unproven",
    deploySha: canonicalSpec.deploySha,
    runId: canonicalSpec.runId,
    runAttempt: canonicalSpec.runAttempt,
    transactionId: canonicalSpec.transactionId,
    mainOwnershipMode: { ...canonicalSpec.mainOwnershipMode },
    stagedTargets: [...canonicalSpec.stagedTargets],
    activeTargets: [...canonicalSpec.activeTargets],
    shadowTargets: [...canonicalSpec.shadowTargets],
    projects,
    legacyAppV2: canonicalLegacyV2Proof(canonicalSpec.legacyAppV2, legacyV2),
  });
}

function assertActiveDeploymentRecord(record, label) {
  assertExactKeys(record, ACTIVE_STATE_RECORD_KEYS, label);
  requireDeploymentId(record.deploymentId, `${label} deployment ID`);
  if (
    record.deploymentUrl !== null &&
    canonicalizeDeploymentUrl(record.deploymentUrl) !== record.deploymentUrl
  ) {
    throw new Error(`${label} deployment URL is malformed`);
  }
  for (const [field, value] of [
    ["project ID", record.projectId],
    ["project name", record.projectName],
    ["readiness", record.readyState],
  ]) {
    if (value !== null) requireIdentifier(value, `${label} ${field}`);
  }
  if (
    (record.target !== null &&
      (typeof record.target !== "string" || record.target.length === 0)) ||
    (record.customEnvironmentSlug !== null &&
      (typeof record.customEnvironmentSlug !== "string" ||
        record.customEnvironmentSlug.length === 0)) ||
    (record.source !== null &&
      (typeof record.source !== "string" ||
        !/^[a-z][a-z-]*$/.test(record.source))) ||
    typeof record.workflowMetadataMatches !== "boolean"
  ) {
    throw new Error(`${label} identity is malformed`);
  }
  if (record.git === null) {
    throw new Error(`${label} Git identity is missing`);
  }
  assertExactKeys(record.git, CANONICAL_GIT_KEYS, `${label} Git identity`);
  if (
    (record.git.org !== null &&
      (typeof record.git.org !== "string" ||
        !/^[A-Za-z0-9._-]+$/.test(record.git.org))) ||
    (record.git.repo !== null &&
      (typeof record.git.repo !== "string" ||
        !/^[A-Za-z0-9._-]+$/.test(record.git.repo))) ||
    (record.git.ref !== null &&
      (typeof record.git.ref !== "string" ||
        !/^[A-Za-z0-9._/-]+$/.test(record.git.ref) ||
        record.git.ref.includes(".."))) ||
    typeof record.git.sha !== "string" ||
    !SHA_PATTERN.test(record.git.sha) ||
    record.git.sha !== record.git.sha.toLowerCase()
  ) {
    throw new Error(`${label} Git identity is malformed`);
  }
  return record;
}

function recordMatchesActiveProjectTopology(record, project, deploySha) {
  return (
    record.deploymentUrl !== null &&
    record.projectId === project.projectId &&
    record.projectName === project.projectName &&
    record.readyState === "READY" &&
    record.target === project.target &&
    record.customEnvironmentSlug === project.customEnvironmentSlug &&
    record.git.sha === deploySha
  );
}

function recordMatchesCanonicalMainCandidate(record, project, deploySha) {
  return (
    recordMatchesActiveProjectTopology(record, project, deploySha) &&
    record.git?.org === "mento-protocol" &&
    record.git.repo === "frontend-monorepo" &&
    record.git.ref === "main" &&
    record.git.sha === deploySha
  );
}

export function assertActiveDeploymentStateProof(value) {
  assertExactKeys(
    value,
    ACTIVE_STATE_PROOF_KEYS,
    "Active deployment state proof",
  );
  if (
    value.schema !== ACTIVE_DEPLOYMENT_STATE_PROOF_SCHEMA ||
    !["proven", "unproven"].includes(value.outcome) ||
    typeof value.deploySha !== "string" ||
    !SHA_PATTERN.test(value.deploySha) ||
    value.deploySha !== value.deploySha.toLowerCase() ||
    typeof value.transactionId !== "string" ||
    !/^main-[a-f0-9]{32}$/.test(value.transactionId)
  ) {
    throw new Error("Active deployment state proof identity is malformed");
  }
  requirePositiveIdentifier(value.runId, "Active proof run ID");
  requirePositiveIdentifier(value.runAttempt, "Active proof run attempt");
  const mainOwnershipMode = canonicalMainOwnershipMode(value.mainOwnershipMode);
  const stagedTargets = canonicalActiveStateTargets(
    value.stagedTargets,
    "Active proof staged targets",
  );
  const activeTargets = canonicalActiveStateTargets(
    value.activeTargets,
    "Active proof active targets",
  );
  const shadowTargets = canonicalActiveStateTargets(
    value.shadowTargets,
    "Active proof shadow targets",
  );
  if (
    activeTargets.some((target) => mainOwnershipMode[target] !== "github") ||
    shadowTargets.some((target) => mainOwnershipMode[target] !== "shadow") ||
    activeTargets.some((target) => shadowTargets.includes(target)) ||
    JSON.stringify(
      [...activeTargets, ...shadowTargets].toSorted(
        (left, right) =>
          ACTIVE_STATE_TARGETS.indexOf(left) -
          ACTIVE_STATE_TARGETS.indexOf(right),
      ),
    ) !== JSON.stringify(stagedTargets)
  ) {
    throw new Error("Active deployment proof target partition is malformed");
  }
  assertExactKeys(
    value.projects,
    ACTIVE_STATE_TARGETS,
    "Active deployment state proof projects",
  );
  let proven = true;
  const projectIds = new Set();
  const expectedDeploymentIds = new Set();
  const expectedDeploymentUrls = new Set();
  const priorDeploymentIds = new Set();
  const priorDeploymentUrls = new Set();
  const classifiedDeploymentIds = new Set();
  for (const logicalTarget of ACTIVE_STATE_TARGETS) {
    const project = value.projects[logicalTarget];
    assertExactKeys(
      project,
      ACTIVE_STATE_PROJECT_PROOF_KEYS,
      `${logicalTarget} active deployment state proof`,
    );
    const expectedEnvironment = activeProjectEnvironment(logicalTarget);
    const expectedDisposition = expectedActiveStateDisposition({
      logicalTarget,
      activeTargets,
      shadowTargets,
      project,
    });
    const projectId = requireIdentifier(
      project.projectId,
      `${logicalTarget} active proof project ID`,
    );
    let expectedDeploymentId = null;
    let expectedDeploymentUrl = null;
    const priorDeploymentId = requireDeploymentId(
      project.priorDeploymentId,
      `${logicalTarget} active proof prior deployment ID`,
    );
    const priorDeploymentUrl = canonicalizeDeploymentUrl(
      project.priorDeploymentUrl,
    );
    const priorServedSha = project.priorServedSha;
    if (
      priorServedSha !== null &&
      (typeof priorServedSha !== "string" ||
        !SHA_PATTERN.test(priorServedSha) ||
        priorServedSha !== priorServedSha.toLowerCase())
    ) {
      throw new Error(
        `${logicalTarget} active proof prior served SHA is malformed`,
      );
    }
    if (
      expectedDisposition === null ||
      expectedDisposition === "recoveredPrior"
    ) {
      if (
        project.expectedDeploymentId !== null ||
        project.expectedDeploymentUrl !== null
      ) {
        throw new Error(
          `${logicalTarget} active deployment state proof expectation is malformed`,
        );
      }
    } else {
      expectedDeploymentId = requireDeploymentId(
        project.expectedDeploymentId,
        `${logicalTarget} active proof deployment ID`,
      );
      expectedDeploymentUrl = canonicalizeDeploymentUrl(
        project.expectedDeploymentUrl,
      );
    }
    if (
      project.projectName !== `${logicalTarget}.mento.org` ||
      project.target !== expectedEnvironment.target ||
      project.customEnvironmentSlug !==
        expectedEnvironment.customEnvironmentSlug ||
      project.mainOwnershipMode !== mainOwnershipMode[logicalTarget] ||
      project.expectedDisposition !== expectedDisposition ||
      expectedDeploymentUrl !== project.expectedDeploymentUrl ||
      priorDeploymentUrl !== project.priorDeploymentUrl ||
      projectIds.has(projectId) ||
      priorDeploymentIds.has(priorDeploymentId) ||
      priorDeploymentUrls.has(priorDeploymentUrl) ||
      (expectedDeploymentId !== null &&
        (expectedDeploymentIds.has(expectedDeploymentId) ||
          expectedDeploymentId === priorDeploymentId)) ||
      (expectedDeploymentUrl !== null &&
        (expectedDeploymentUrls.has(expectedDeploymentUrl) ||
          expectedDeploymentUrl === priorDeploymentUrl))
    ) {
      throw new Error(
        `${logicalTarget} active deployment state proof is malformed`,
      );
    }
    projectIds.add(projectId);
    priorDeploymentIds.add(priorDeploymentId);
    priorDeploymentUrls.add(priorDeploymentUrl);
    if (expectedDeploymentId !== null) {
      expectedDeploymentIds.add(expectedDeploymentId);
    }
    if (expectedDeploymentUrl !== null) {
      expectedDeploymentUrls.add(expectedDeploymentUrl);
    }
    assertExactKeys(
      project.ids,
      ACTIVE_STATE_CLASSIFICATIONS,
      `${logicalTarget} active deployment state proof IDs`,
    );
    assertExactKeys(
      project.records,
      ACTIVE_STATE_CLASSIFICATIONS,
      `${logicalTarget} active deployment state proof records`,
    );
    for (const classification of ACTIVE_STATE_CLASSIFICATIONS) {
      sortedUniqueIds(
        project.ids[classification],
        `${logicalTarget} ${classification} deployment IDs`,
      );
      if (!Array.isArray(project.records[classification])) {
        throw new Error(
          `${logicalTarget} ${classification} deployment records are malformed`,
        );
      }
      const recordIds = project.records[classification].map(
        (record, index) =>
          assertActiveDeploymentRecord(
            record,
            `${logicalTarget} ${classification} deployment record ${index}`,
          ).deploymentId,
      );
      if (
        JSON.stringify(recordIds) !==
        JSON.stringify(project.ids[classification])
      ) {
        throw new Error(
          `${logicalTarget} ${classification} deployment records conflict`,
        );
      }
      for (const record of project.records[classification]) {
        if (classifiedDeploymentIds.has(record.deploymentId)) {
          throw new Error("Active deployment proof classifies an ID twice");
        }
        classifiedDeploymentIds.add(record.deploymentId);
        if (
          classification !== "unknown" &&
          classification !== "legacyV2" &&
          !recordMatchesActiveProjectTopology(record, project, value.deploySha)
        ) {
          throw new Error(
            `${logicalTarget} ${classification} deployment record is malformed`,
          );
        }
        if (
          (["githubPrebuilt", "githubShadowStage"].includes(classification) &&
            (record.deploymentId !== expectedDeploymentId ||
              record.deploymentUrl !== expectedDeploymentUrl ||
              !recordMatchesCanonicalMainCandidate(
                record,
                project,
                value.deploySha,
              ) ||
              record.workflowMetadataMatches !== true)) ||
          (classification === "nativeGitOwner" &&
            (mainOwnershipMode[logicalTarget] !== "shadow" ||
              priorServedSha !== value.deploySha ||
              record.deploymentId !== priorDeploymentId ||
              record.deploymentUrl !== priorDeploymentUrl)) ||
          (classification === "nativeGitDuplicates" &&
            (mainOwnershipMode[logicalTarget] !== "github" ||
              priorServedSha !== value.deploySha ||
              record.deploymentId !== priorDeploymentId ||
              record.deploymentUrl !== priorDeploymentUrl)) ||
          (classification === "legacyV2" &&
            (logicalTarget !== "app" ||
              record.deploymentId !== value.legacyAppV2.deploymentId))
        ) {
          throw new Error(
            `${logicalTarget} ${classification} deployment classification is malformed`,
          );
        }
      }
    }
    assertExactKeys(
      project.counts,
      ["scanned", ...ACTIVE_STATE_CLASSIFICATIONS],
      `${logicalTarget} active deployment state proof counts`,
    );
    for (const classification of ACTIVE_STATE_CLASSIFICATIONS) {
      if (
        project.counts[classification] !== project.ids[classification].length
      ) {
        throw new Error(
          `${logicalTarget} active deployment state proof counts conflict`,
        );
      }
    }
    if (
      !Number.isSafeInteger(project.counts.scanned) ||
      project.counts.scanned < 0 ||
      project.counts.scanned !==
        ACTIVE_STATE_CLASSIFICATIONS.reduce(
          (total, classification) => total + project.counts[classification],
          0,
        )
    ) {
      throw new Error(
        `${logicalTarget} active deployment state proof count is malformed`,
      );
    }
    // An exact manifest-bound rollback prior may remain in the same-SHA census
    // after replacement. It never satisfies the required GitHub disposition
    // or the separate protected-mapping proof.
    proven &&=
      project.counts.githubPrebuilt ===
        (expectedDisposition === "githubPrebuilt" ? 1 : 0) &&
      (expectedDisposition !== "githubPrebuilt" ||
        project.ids.githubPrebuilt[0] === expectedDeploymentId) &&
      project.counts.githubShadowStage ===
        (expectedDisposition === "githubShadowStage" ? 1 : 0) &&
      (expectedDisposition !== "githubShadowStage" ||
        project.ids.githubShadowStage[0] === expectedDeploymentId) &&
      project.counts.nativeGitOwner <=
        (mainOwnershipMode[logicalTarget] === "shadow" ? 1 : 0) &&
      project.counts.nativeGitDuplicates <=
        (mainOwnershipMode[logicalTarget] === "github" ? 1 : 0) &&
      project.counts.manualDuplicates === 0 &&
      project.counts.unknown === 0;
  }
  assertExactKeys(
    value.legacyAppV2,
    ACTIVE_STATE_LEGACY_PROOF_KEYS,
    "Legacy App v2 proof",
  );
  assertCanonicalOutput({
    alias: value.legacyAppV2.alias,
    deploymentId: value.legacyAppV2.deploymentId,
    deploymentUrl: value.legacyAppV2.deploymentUrl,
    creatorUsername: null,
    projectId: value.legacyAppV2.projectId,
    projectName: value.legacyAppV2.projectName,
    readyState: value.legacyAppV2.readyState,
    target: value.legacyAppV2.target,
    customEnvironmentSlug: value.legacyAppV2.customEnvironmentSlug,
    git: value.legacyAppV2.git,
    aliases: [value.legacyAppV2.alias],
  });
  requireDeploymentId(
    value.legacyAppV2.deploymentId,
    "Legacy App v2 proof deployment ID",
  );
  if (
    value.legacyAppV2.alias !== "v2-app.mento.org" ||
    value.legacyAppV2.projectId !== value.projects.app.projectId ||
    value.legacyAppV2.projectName !== "app.mento.org" ||
    value.legacyAppV2.readyState !== "READY" ||
    value.legacyAppV2.target !== "production" ||
    value.legacyAppV2.customEnvironmentSlug !== null ||
    value.legacyAppV2.git.org !== "mento-protocol" ||
    value.legacyAppV2.git.repo !== "frontend-monorepo" ||
    value.legacyAppV2.git.ref !== "v2" ||
    value.legacyAppV2.ownership !== "native-vercel-git" ||
    expectedDeploymentIds.has(value.legacyAppV2.deploymentId) ||
    expectedDeploymentUrls.has(value.legacyAppV2.deploymentUrl) ||
    value.projects.app.ids.legacyV2.some(
      (deploymentId) => deploymentId !== value.legacyAppV2.deploymentId,
    ) ||
    value.projects.app.records.legacyV2.some(
      (record) =>
        record.deploymentId !== value.legacyAppV2.deploymentId ||
        record.deploymentUrl !== value.legacyAppV2.deploymentUrl ||
        record.projectId !== value.legacyAppV2.projectId ||
        record.projectName !== value.legacyAppV2.projectName ||
        record.readyState !== value.legacyAppV2.readyState ||
        record.target !== value.legacyAppV2.target ||
        record.customEnvironmentSlug !==
          value.legacyAppV2.customEnvironmentSlug ||
        JSON.stringify(record.git) !== JSON.stringify(value.legacyAppV2.git) ||
        record.workflowMetadataMatches !== false,
    ) ||
    ACTIVE_STATE_TARGETS.filter((target) => target !== "app").some(
      (target) =>
        value.projects[target].ids.legacyV2.length !== 0 ||
        value.projects[target].records.legacyV2.length !== 0,
    ) ||
    value.outcome !== (proven ? "proven" : "unproven")
  ) {
    throw new Error("Active deployment state proof outcome is malformed");
  }
  return value;
}

export async function captureActiveDeploymentStateProof(client, spec) {
  const canonicalSpec = assertActiveDeploymentStateSpec(spec);
  if (
    !client ||
    typeof client.listExactShaDeploymentIds !== "function" ||
    typeof client.inspectDeployment !== "function" ||
    typeof client.canonicalLegacyV2State !== "function"
  ) {
    throw new Error("Active deployment state client is malformed");
  }
  const captureInventory = async (label) => {
    const inventory = {};
    for (const logicalTarget of ACTIVE_STATE_TARGETS) {
      inventory[logicalTarget] = sortedUniqueIds(
        await client.listExactShaDeploymentIds({
          projectId: canonicalSpec.projects[logicalTarget].projectId,
          deploySha: canonicalSpec.deploySha,
        }),
        `${logicalTarget} ${label}`,
      );
    }
    return inventory;
  };
  const assertInventoryUnchanged = (expected, actual) => {
    if (
      ACTIVE_STATE_TARGETS.some(
        (logicalTarget) =>
          JSON.stringify(actual[logicalTarget]) !==
          JSON.stringify(expected[logicalTarget]),
      )
    ) {
      throw new Error("Active deployment set changed during inspection");
    }
  };
  const listedBefore = await captureInventory("active deployment listing");
  const deployments = {};
  for (const logicalTarget of ACTIVE_STATE_TARGETS) {
    deployments[logicalTarget] = [];
    for (const deploymentId of listedBefore[logicalTarget]) {
      const response = assertExactShaDeploymentInspection({
        deployment: await client.inspectDeployment(deploymentId),
        deploymentId,
        projectId: canonicalSpec.projects[logicalTarget].projectId,
        deploySha: canonicalSpec.deploySha,
      });
      deployments[logicalTarget].push({
        deploymentId,
        response,
      });
    }
  }
  const legacyV2 = await client.canonicalLegacyV2State(
    canonicalSpec.legacyAppV2,
  );
  const listedAfter = await captureInventory(
    "confirmed active deployment listing",
  );
  assertInventoryUnchanged(listedBefore, listedAfter);
  const stabilized = await captureInventory(
    "stabilized active deployment listing",
  );
  assertInventoryUnchanged(listedAfter, stabilized);
  return createActiveDeploymentStateProof({
    spec: canonicalSpec,
    deployments,
    legacyV2,
  });
}

export async function captureMainPlanningSnapshot(client, spec) {
  assertSnapshotSpec(spec);
  if (spec.some((entry) => entry.git.ref !== "main")) {
    throw new Error("Main planning snapshot may only inspect main aliases");
  }
  if (!client || typeof client.mainPlanningAliasState !== "function") {
    throw new Error("Main planning state client is malformed");
  }
  const states = [];
  for (const entry of spec) {
    states.push(await client.mainPlanningAliasState(entry));
  }
  const ordered = states.sort((left, right) =>
    left.alias.localeCompare(right.alias),
  );
  const groups = new Map();
  for (const entry of spec) {
    const key = JSON.stringify([
      entry.projectId,
      entry.projectName,
      entry.target,
      entry.customEnvironmentSlug,
    ]);
    const group = groups.get(key) ?? [];
    group.push(canonicalizeHostname(entry.alias));
    groups.set(key, group);
  }
  for (const [key, reviewedAliases] of groups) {
    const [projectId, projectName, target, customEnvironmentSlug] =
      JSON.parse(key);
    const groupStates = ordered.filter(
      (state) =>
        state.projectId === projectId &&
        state.projectName === projectName &&
        state.target === target &&
        state.customEnvironmentSlug === customEnvironmentSlug,
    );
    if (groupStates.length !== reviewedAliases.length) {
      throw new Error("Main planning alias group is incomplete");
    }
    if (
      new Set(groupStates.map((state) => state.deploymentId)).size !== 1 ||
      new Set(groupStates.map((state) => state.deploymentUrl)).size !== 1
    ) {
      throw new Error(
        "Main planning aliases do not share one rollback deployment",
      );
    }
    const aliasSets = new Set(
      groupStates.map((state) => JSON.stringify(state.aliases)),
    );
    if (aliasSets.size !== 1) {
      throw new Error("Main planning deployment alias sets conflict");
    }
    const deploymentAliases = groupStates[0].aliases;
    if (reviewedAliases.some((alias) => !deploymentAliases.includes(alias))) {
      throw new Error(
        "Main planning deployment omits a reviewed protected alias",
      );
    }
    if (
      customEnvironmentSlug === "v3" &&
      JSON.stringify(deploymentAliases) !==
        JSON.stringify(reviewedAliases.toSorted())
    ) {
      throw new Error(
        "Main planning app-v3 aliases do not exactly match the reviewed set",
      );
    }
  }
  return assertMainPlanningSnapshot({
    schema: MAIN_PLANNING_SNAPSHOT_SCHEMA,
    states: ordered,
  });
}

export async function captureProtectedSnapshot(client, spec) {
  assertSnapshotSpec(spec);
  const snapshot = [];
  for (const entry of spec) {
    snapshot.push(await client.canonicalAliasState(entry));
  }
  const customV3States = snapshot.filter(
    (state) => state.customEnvironmentSlug === "v3",
  );
  if (
    customV3States.length > 0 &&
    new Set(customV3States.map((state) => state.deploymentId)).size !== 1
  ) {
    throw new Error("Reviewed app-v3 aliases do not share one deployment");
  }
  if (customV3States.length > 0) {
    const reviewedV3Aliases = spec
      .filter((entry) => entry.customEnvironmentSlug === "v3")
      .map((entry) => canonicalizeHostname(entry.alias))
      .sort();
    for (const state of customV3States) {
      if (JSON.stringify(state.aliases) !== JSON.stringify(reviewedV3Aliases)) {
        throw new Error(
          "Reviewed app-v3 aliases do not exactly match the deployment alias set",
        );
      }
    }
  }
  return snapshot.sort((left, right) => left.alias.localeCompare(right.alias));
}

export function compareProtectedSnapshots(before, after) {
  for (const snapshot of [before, after]) {
    if (!Array.isArray(snapshot) || snapshot.length === 0) {
      throw new Error("Protected alias snapshot is malformed");
    }
  }
  const mapping = (snapshot) => {
    const entries = snapshot
      .map((entry) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
          throw new Error("Protected alias snapshot entry is malformed");
        }
        return [
          canonicalizeHostname(entry.alias),
          {
            deploymentId: requireIdentifier(
              entry.deploymentId,
              "Snapshot deployment ID",
            ),
            deploymentUrl: canonicalizeDeploymentUrl(entry.deploymentUrl),
            projectId: requireIdentifier(
              entry.projectId,
              "Snapshot project ID",
            ),
          },
        ];
      })
      .sort(([left], [right]) => left.localeCompare(right));
    if (new Set(entries.map(([alias]) => alias)).size !== entries.length) {
      throw new Error("Protected alias snapshot contains duplicates");
    }
    return Object.fromEntries(entries);
  };
  const beforeMapping = mapping(before);
  const afterMapping = mapping(after);
  if (JSON.stringify(beforeMapping) !== JSON.stringify(afterMapping)) {
    const aliases = [
      ...new Set([...Object.keys(beforeMapping), ...Object.keys(afterMapping)]),
    ].sort();
    const evidence = aliases
      .filter(
        (alias) =>
          JSON.stringify(beforeMapping[alias] ?? null) !==
          JSON.stringify(afterMapping[alias] ?? null),
      )
      .map((alias) => ({
        alias,
        before: beforeMapping[alias] ?? null,
        current: afterMapping[alias] ?? null,
        restoreCommand: beforeMapping[alias]
          ? `vercel alias set ${beforeMapping[alias].deploymentUrl} ${alias}`
          : null,
      }));
    throw new CanonicalDriftError(
      [
        "Protected alias mappings changed; comparison is read-only and attempted no repair.",
        `Canonical drift: ${JSON.stringify(evidence)}`,
        "Operator recovery: stop forward work, rule out concurrent or intentional activation, re-resolve every alias against the canonical current state, run any listed restore command only after that guard, then capture and compare the complete protected snapshot again.",
      ].join(" "),
    );
  }
  return beforeMapping;
}

export function parseArguments(argv) {
  if (!Array.isArray(argv) || !Object.hasOwn(CLI_OPTIONS, argv[0])) {
    throw new Error(
      "Vercel deployment state command is missing or unsupported",
    );
  }
  const command = argv[0];
  const allowed = new Set(CLI_OPTIONS[command]);
  const options = Object.create(null);
  for (let index = 1; index < argv.length; index += 2) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (typeof argument !== "string" || !/^--[a-z][a-z-]*$/.test(argument)) {
      throw new Error("Vercel deployment state arguments are malformed");
    }
    const name = argument.slice(2);
    if (!allowed.has(name)) {
      throw new Error("Vercel deployment state option is unsupported");
    }
    if (Object.hasOwn(options, name)) {
      throw new Error("Vercel deployment state option is duplicated");
    }
    if (
      typeof value !== "string" ||
      value.length === 0 ||
      value.startsWith("--")
    ) {
      throw new Error("Vercel deployment state option value is missing");
    }
    options[name] = value;
  }
  if (
    Object.keys(options).length !== allowed.size ||
    [...allowed].some((name) => !Object.hasOwn(options, name))
  ) {
    throw new Error("Vercel deployment state required option is missing");
  }
  return { command, options };
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(resolve(path), "utf8"));
  } catch {
    throw new Error(`${label} is missing or malformed`);
  }
}

function privateDirectory(path) {
  if (typeof path !== "string" || !isAbsolute(path)) {
    throw new Error("Private output directory is missing or unsafe");
  }
  const absolutePath = resolve(path);
  const root = parse(absolutePath).root;
  let current = root;
  try {
    for (const component of absolutePath
      .slice(root.length)
      .split(sep)
      .filter(Boolean)) {
      current = resolve(current, component);
      const stats = lstatSync(current);
      if (stats.isSymbolicLink() || !stats.isDirectory()) {
        throw new Error("unsafe");
      }
    }
    return { path: absolutePath, stats: lstatSync(absolutePath) };
  } catch {
    throw new Error("Private output directory is missing or unsafe");
  }
}

function sameInode(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function writeValidatedPrivateJson(
  path,
  value,
  validate,
  { runnerTemp = process.env.RUNNER_TEMP } = {},
) {
  validate(value);
  const directory = privateDirectory(runnerTemp);
  if (typeof path !== "string" || !isAbsolute(path)) {
    throw new Error("Private output path is missing or unsafe");
  }
  const outputPath = resolve(path);
  if (dirname(outputPath) !== directory.path) {
    throw new Error("Private output path is missing or unsafe");
  }
  if (!Number.isInteger(constants.O_NOFOLLOW) || constants.O_NOFOLLOW === 0) {
    throw new Error("Private output creation is unsupported on this platform");
  }

  let descriptor;
  try {
    descriptor = openSync(
      outputPath,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
  } catch {
    throw new Error("Private output file could not be created safely");
  }

  try {
    const fileBefore = fstatSync(descriptor);
    const pathBefore = lstatSync(outputPath);
    const directoryAfterOpen = lstatSync(directory.path);
    if (
      !fileBefore.isFile() ||
      fileBefore.nlink !== 1 ||
      pathBefore.isSymbolicLink() ||
      !sameInode(fileBefore, pathBefore) ||
      directoryAfterOpen.isSymbolicLink() ||
      !directoryAfterOpen.isDirectory() ||
      !sameInode(directory.stats, directoryAfterOpen)
    ) {
      throw new Error("unsafe");
    }

    fchmodSync(descriptor, 0o600);
    writeFileSync(descriptor, `${JSON.stringify(value)}\n`);

    const fileAfter = fstatSync(descriptor);
    const pathAfter = lstatSync(outputPath);
    const directoryAfterWrite = lstatSync(directory.path);
    if (
      !fileAfter.isFile() ||
      fileAfter.nlink !== 1 ||
      (fileAfter.mode & 0o777) !== 0o600 ||
      pathAfter.isSymbolicLink() ||
      !sameInode(fileAfter, pathAfter) ||
      directoryAfterWrite.isSymbolicLink() ||
      !directoryAfterWrite.isDirectory() ||
      !sameInode(directory.stats, directoryAfterWrite)
    ) {
      throw new Error("unsafe");
    }
  } catch {
    throw new Error("Private output file could not be written safely");
  } finally {
    closeSync(descriptor);
  }
}

export function writeCanonicalJson(path, value, options = {}) {
  return writeValidatedPrivateJson(path, value, assertCanonicalOutput, options);
}

export function writeMainPlanningSnapshot(path, value, options = {}) {
  return writeValidatedPrivateJson(
    path,
    value,
    assertMainPlanningSnapshot,
    options,
  );
}

export function writeAppTransactionCandidate(path, value, options = {}) {
  return writeValidatedPrivateJson(
    path,
    value,
    assertAppTransactionCandidateOutput,
    options,
  );
}

export function writeActiveDeploymentStateProof(path, value, options = {}) {
  return writeValidatedPrivateJson(
    path,
    value,
    assertActiveDeploymentStateProof,
    options,
  );
}

export function writeActiveAliasMappings(path, value, options = {}) {
  return writeValidatedPrivateJson(
    path,
    value,
    assertActiveAliasMappings,
    options,
  );
}

export function writeActiveAliasMappingSet(path, value, options = {}) {
  return writeValidatedPrivateJson(
    path,
    value,
    assertActiveAliasMappingSet,
    options,
  );
}

function createClient(env, clientFactory) {
  return clientFactory({
    token: env.VERCEL_TOKEN,
    teamId: env.VERCEL_ORG_ID,
  });
}

export async function runCli({
  argv,
  env = process.env,
  stdout = process.stdout,
  clientFactory = (options) => new VercelStateClient(options),
} = {}) {
  const { command, options } = parseArguments(argv);

  if (command === "compare") {
    compareProtectedSnapshots(
      readJson(options.before, "Baseline snapshot"),
      readJson(options.after, "Current snapshot"),
    );
    stdout.write("Protected alias mappings verified\n");
    return;
  }

  const client = createClient(env, clientFactory);
  if (command === "active-proof") {
    const result = await captureActiveDeploymentStateProof(
      client,
      readJson(options.spec, "Active deployment state specification"),
    );
    writeActiveDeploymentStateProof(options.output, result, {
      runnerTemp: env.RUNNER_TEMP,
    });
    if (result.outcome !== "proven") {
      throw new Error("Active deployment state is unproven");
    }
    stdout.write("Canonical active deployment state proof written\n");
  } else if (command === "alias-mappings") {
    const rawSpec = readJson(
      options.spec,
      "Active alias mapping specification",
    );
    const dynamic = rawSpec?.schema === ACTIVE_ALIAS_MAPPING_SPEC_SCHEMA;
    const spec = dynamic
      ? assertActiveAliasMappingSpec(rawSpec)
      : assertActiveAliasMappingSet(rawSpec);
    const captured = await captureAliasMappings(
      client,
      dynamic ? spec.bindings.map(({ alias }) => alias) : spec.aliases,
    );
    const result = dynamic
      ? assertBoundActiveAliasMappings(captured, spec)
      : assertActiveAliasMappings(
          captured.map((mapping) => ({
            alias: mapping.alias,
            deploymentId: mapping.deploymentId,
            deploymentUrl: mapping.deploymentUrl,
          })),
        );
    if (dynamic) {
      writeValidatedPrivateJson(
        options.output,
        result,
        (value) => assertBoundActiveAliasMappings(value, spec),
        { runnerTemp: env.RUNNER_TEMP },
      );
    } else {
      writeActiveAliasMappings(options.output, result, {
        runnerTemp: env.RUNNER_TEMP,
      });
    }
    stdout.write("Canonical active alias mappings written\n");
  } else if (command === "snapshot") {
    const result = await captureProtectedSnapshot(
      client,
      readJson(options.spec, "Protected alias specification"),
    );
    writeCanonicalJson(options.output, result, {
      runnerTemp: env.RUNNER_TEMP,
    });
    stdout.write("Canonical protected-domain snapshot written\n");
  } else if (command === "planning-snapshot") {
    const result = await captureMainPlanningSnapshot(
      client,
      readJson(options.spec, "Main planning alias specification"),
    );
    writeMainPlanningSnapshot(options.output, result, {
      runnerTemp: env.RUNNER_TEMP,
    });
    stdout.write("Canonical main planning snapshot written\n");
  } else if (command === "app-candidate") {
    const result = await client.discoverAppTransactionCandidate(
      readJson(options.expected, "App candidate expectation"),
    );
    writeAppTransactionCandidate(options.output, result, {
      runnerTemp: env.RUNNER_TEMP,
    });
    stdout.write("Canonical App transaction candidate written\n");
  } else if (command === "deployment") {
    const expected = readJson(options.expected, "Deployment expectation");
    const result = await client.canonicalDeploymentState(expected);
    writeCanonicalJson(options.output, result, {
      runnerTemp: env.RUNNER_TEMP,
    });
    stdout.write("Canonical deployment state written\n");
  } else {
    await client.assertProject({
      projectId: options["project-id"],
      projectName: options["project-name"],
      rootDirectory: options["root-directory"],
    });
    stdout.write("Vercel project configuration verified\n");
  }
}

export function renderCliFailure(error) {
  return error instanceof CanonicalDriftError
    ? `${error.message}\n`
    : "Vercel deployment state command failed\n";
}

function isCliEntrypoint() {
  return (
    process.argv[1] !== undefined &&
    fileURLToPath(import.meta.url) === resolve(process.argv[1])
  );
}

if (isCliEntrypoint()) {
  try {
    await runCli({ argv: process.argv.slice(2) });
  } catch (error) {
    process.stderr.write(renderCliFailure(error));
    process.exitCode = 1;
  }
}
