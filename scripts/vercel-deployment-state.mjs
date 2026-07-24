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

const API_ORIGIN = "https://api.vercel.com";
const SHA_PATTERN = /^[A-Fa-f0-9]{40}$/;
const HOSTNAME_PATTERN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

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

const CANONICAL_GIT_KEYS = ["org", "repo", "ref", "sha"];
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

export function canonicalizeHostname(value) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("Alias hostname is required");
  }
  const hasScheme = value.includes("://");
  let hostname;
  try {
    const url = new URL(hasScheme ? value : `https://${value}`);
    if (
      url.protocol !== "https:" ||
      url.username !== "" ||
      url.password !== "" ||
      url.port !== "" ||
      url.pathname !== "/" ||
      url.search !== "" ||
      url.hash !== ""
    ) {
      throw new Error("Alias URL contains forbidden components");
    }
    hostname = url.hostname;
  } catch {
    throw new Error("Alias hostname is malformed");
  }
  hostname = hostname.toLowerCase().replace(/\.$/, "");
  if (!HOSTNAME_PATTERN.test(hostname)) {
    throw new Error("Alias hostname is malformed");
  }
  return hostname;
}

export function canonicalizeDeploymentUrl(value) {
  const hostname = canonicalizeHostname(value);
  if (!hostname.endsWith(".vercel.app")) {
    throw new Error("Deployment URL must use an immutable vercel.app host");
  }
  return `https://${hostname}`;
}

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
          signal: AbortSignal.timeout(15_000),
        },
      );
    } catch {
      throw new Error("Vercel API request failed");
    }
    if (!response || typeof response.ok !== "boolean") {
      throw new Error("Vercel API returned a malformed response");
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
      throw new Error(`Vercel API request failed with HTTP ${status}`);
    }
    try {
      return await response.json();
    } catch {
      throw new Error("Vercel API returned malformed JSON");
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
  if (command === "snapshot") {
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
