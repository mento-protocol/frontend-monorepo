#!/usr/bin/env node

import { createHash } from "node:crypto";

import {
  canonicalizeDeploymentUrl,
  canonicalizeHostname,
} from "./vercel-deployment-state.mjs";
import {
  assertMainReleaseManifest,
  MAIN_RELEASE_ACTIVATION_ORDER,
  reconcileMainRelease,
  reconcileMainReleaseForRecovery,
} from "./vercel-main-release-reconciliation.mjs";

const MAIN_TRANSACTION_SCHEMA = 3;
export const MAIN_TRANSACTION_REPOSITORY = "mento-protocol/frontend-monorepo";
export const MAIN_TRANSACTION_MODE = "shadow";

const SHA_PATTERN = /^[a-f0-9]{40}$/;
const NUMERIC_ID_PATTERN = /^[1-9][0-9]*$/;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9._-]+$/;
const DEPLOYMENT_ID_PATTERN = /^dpl_[A-Za-z0-9]+$/;
// Every main target promotes and rolls back through the same two operations.
const PROMOTABLE_TARGETS = Object.freeze([
  "governance",
  "reserve",
  "ui",
  "app",
]);
const PROTECTED_TARGETS = Object.freeze(["app", "governance", "reserve", "ui"]);
const CANDIDATE_TARGETS = Object.freeze(["app", "governance", "reserve", "ui"]);
const MODES = Object.freeze(["shadow", "active"]);
const STATUSES = Object.freeze([
  "prepared",
  "started",
  "command_returned",
  "verified",
  "committed",
  "recovering",
  "recovered",
  "manual_intervention",
]);
const OPERATION_TYPES = Object.freeze(["promote", "ordinary_rollback"]);
const FORWARD_OPERATION_TYPES = new Set(["promote"]);
const RECOVERY_OPERATION_TYPES = new Set(["ordinary_rollback"]);
const OPERATION_STATES = Object.freeze([
  "started",
  "command_returned",
  "verified",
]);
const COMMAND_OUTCOMES = Object.freeze([null, "success", "unknown"]);
const MAPPING_STATES = Object.freeze([
  null,
  "prior",
  "candidate",
  "partial",
  "unexpected",
  "unknown",
]);
const ROLLBACK_STATES = Object.freeze([null, "entered"]);
const JOURNAL_KEYS = Object.freeze([
  "schema",
  "repository",
  "deploySha",
  "runId",
  "runAttempt",
  "transactionId",
  "mode",
  "sequence",
  "status",
  "release",
  "prior",
  "startMappings",
  "candidates",
  "operations",
]);
const PRIOR_KEYS = Object.freeze(["deploymentId", "deploymentUrl", "aliases"]);
const CANDIDATE_KEYS = Object.freeze([
  "deploymentId",
  "deploymentUrl",
  "aliases",
  "discovery",
]);
const DISCOVERY_KEYS = Object.freeze([
  "releaseId",
  "candidateId",
  "projectId",
  "projectName",
  "deploySha",
  "target",
  "customEnvironmentSlug",
  "immutableSmoke",
  "metrics",
]);
const OPERATION_KEYS = Object.freeze([
  "operationId",
  "target",
  "type",
  "alias",
  "priorDeploymentId",
  "priorDeploymentUrl",
  "candidateDeploymentId",
  "candidateDeploymentUrl",
  "state",
  "commandOutcome",
  "mappingState",
  "rollbackState",
]);
const CURRENT_MAPPING_KEYS = Object.freeze([
  "alias",
  "deploymentId",
  "deploymentUrl",
]);
const START_MAPPING_TARGETS = Object.freeze([
  "app",
  "governance",
  "reserve",
  "ui",
]);
const RECOVERY_PLAN_KEYS = Object.freeze([
  "decision",
  "reason",
  "journal",
  "actions",
  "rollbackStateTargets",
  "forceFailure",
]);
const INHERITED_RECOVERY_PLAN_KEYS = Object.freeze([
  "decision",
  "reason",
  "journal",
  "reconciliation",
  "actions",
  "rollbackAuthority",
]);
const RECOVERY_ACTION_BASE_KEYS = Object.freeze([
  "kind",
  "target",
  "operationId",
  "priorDeploymentId",
  "priorDeploymentUrl",
  "candidateDeploymentId",
  "candidateDeploymentUrl",
]);

export class MainTransactionError extends Error {
  constructor(message, { code = "MAIN_TRANSACTION_FAILED", journal } = {}) {
    super(message);
    this.name = "MainTransactionError";
    this.code = code;
    this.journal = journal;
  }
}

function assertExactKeys(value, expectedKeys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is malformed`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} contains forbidden or missing fields`);
  }
}

function assertOrderedExactKeys(value, expectedKeys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is malformed`);
  }
  if (JSON.stringify(Object.keys(value)) !== JSON.stringify(expectedKeys)) {
    throw new Error(`${label} keys are missing, extra, or out of order`);
  }
}

function requireString(value, label, pattern) {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new Error(`${label} is malformed`);
  }
  return value;
}

function requireNumericId(value, label) {
  const normalized =
    typeof value === "number" && Number.isSafeInteger(value)
      ? String(value)
      : value;
  return requireString(normalized, label, NUMERIC_ID_PATTERN);
}

function requireDeploymentId(value, label) {
  return requireString(value, label, DEPLOYMENT_ID_PATTERN);
}

function canonicalAliases(values, label) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error(`${label} must be a non-empty array`);
  }
  const aliases = values.map((value) => canonicalizeHostname(value));
  const canonical = [...new Set(aliases)].sort();
  if (
    canonical.length !== aliases.length ||
    JSON.stringify(canonical) !== JSON.stringify(values)
  ) {
    throw new Error(`${label} must be unique and canonically sorted`);
  }
  return canonical;
}

function canonicalPriorRecord(record, label) {
  assertExactKeys(record, PRIOR_KEYS, label);
  return {
    deploymentId: requireDeploymentId(
      record.deploymentId,
      `${label} deployment ID`,
    ),
    deploymentUrl: canonicalizeDeploymentUrl(record.deploymentUrl),
    aliases: canonicalAliases(record.aliases, `${label} aliases`),
  };
}

function canonicalSmoke(value, label, deploySha) {
  assertOrderedExactKeys(value, ["immutableUrl", "servedSha", "status"], label);
  const immutableUrl = canonicalizeDeploymentUrl(value.immutableUrl);
  const servedSha = requireString(
    value.servedSha,
    `${label} served SHA`,
    SHA_PATTERN,
  );
  if (servedSha !== deploySha || value.status !== "passed") {
    throw new Error(`${label} does not prove the candidate SHA`);
  }
  return { immutableUrl, servedSha, status: "passed" };
}

function canonicalMetrics(value, label) {
  assertOrderedExactKeys(
    value,
    ["buildDurationMs", "deploymentDurationMs", "cacheHit"],
    label,
  );
  for (const key of ["buildDurationMs", "deploymentDurationMs", "cacheHit"]) {
    if (value[key] !== null) {
      throw new Error(`${label} must remain null for a reused candidate`);
    }
  }
  return { buildDurationMs: null, deploymentDurationMs: null, cacheHit: null };
}

function canonicalDiscovery(discovery, release, target, label) {
  assertExactKeys(discovery, DISCOVERY_KEYS, label);
  const expected = release.originalPriors[target];
  const environment = { target, customEnvironmentSlug: null };
  const canonical = {
    releaseId: requireString(
      discovery.releaseId,
      `${label} release ID`,
      IDENTIFIER_PATTERN,
    ),
    candidateId: requireString(
      discovery.candidateId,
      `${label} candidate ID`,
      IDENTIFIER_PATTERN,
    ),
    projectId: requireString(
      discovery.projectId,
      `${label} project ID`,
      IDENTIFIER_PATTERN,
    ),
    projectName: requireString(
      discovery.projectName,
      `${label} project name`,
      IDENTIFIER_PATTERN,
    ),
    deploySha: requireString(
      discovery.deploySha,
      `${label} deploy SHA`,
      SHA_PATTERN,
    ),
    target: discovery.target,
    customEnvironmentSlug: discovery.customEnvironmentSlug,
    immutableSmoke: canonicalSmoke(
      discovery.immutableSmoke,
      `${label} immutable smoke`,
      release.deploySha,
    ),
    metrics: canonicalMetrics(discovery.metrics, `${label} reuse metrics`),
  };
  if (
    canonical.releaseId !== release.releaseId ||
    canonical.deploySha !== release.deploySha ||
    canonical.projectId !== expected.projectId ||
    canonical.projectName !== expected.projectName ||
    canonical.target !== environment.target ||
    canonical.customEnvironmentSlug !== environment.customEnvironmentSlug
  ) {
    throw new Error(`${label} does not match stable provider identity`);
  }
  return canonical;
}

function canonicalCandidateRecord(record, target, release, prior) {
  if (record === null) return null;
  const label = `Candidate ${target}`;
  assertExactKeys(record, CANDIDATE_KEYS, label);
  const deploymentId =
    record.deploymentId === null
      ? null
      : requireDeploymentId(record.deploymentId, `${label} deployment ID`);
  const deploymentUrl =
    record.deploymentUrl === null
      ? null
      : canonicalizeDeploymentUrl(record.deploymentUrl);
  if ((deploymentId === null) !== (deploymentUrl === null)) {
    throw new Error(`${label} ID and URL must both be known or both be null`);
  }
  // Every selected target — App included — stages an exact provider candidate
  // before activation.
  if (deploymentId === null) {
    throw new Error(`${label} must identify the staged deployment`);
  }
  if (record.discovery === null) {
    throw new Error(`${label} stable provider metadata is required`);
  }
  const aliases = canonicalAliases(record.aliases, `${label} aliases`);
  if (JSON.stringify(aliases) !== JSON.stringify(prior.aliases)) {
    throw new Error(`${label} aliases differ from the captured prior aliases`);
  }
  return {
    deploymentId,
    deploymentUrl,
    aliases,
    discovery: canonicalDiscovery(
      record.discovery,
      release,
      target,
      `${label} discovery`,
    ),
  };
}

function canonicalIdentity(value) {
  if (value.repository !== MAIN_TRANSACTION_REPOSITORY) {
    throw new Error("Journal repository is unexpected");
  }
  const identity = {
    repository: value.repository,
    deploySha: requireString(
      value.deploySha,
      "Journal deploy SHA",
      SHA_PATTERN,
    ),
    runId: requireNumericId(value.runId, "Journal run ID"),
    runAttempt: requireNumericId(value.runAttempt, "Journal run attempt"),
  };
  identity.transactionId = createMainTransactionId(identity);
  if (
    value.transactionId !== undefined &&
    value.transactionId !== identity.transactionId
  ) {
    throw new Error("Journal transaction ID does not match its identity");
  }
  return identity;
}

function canonicalPrior(prior) {
  assertOrderedExactKeys(prior, PROTECTED_TARGETS, "Journal prior state");
  const canonical = Object.fromEntries(
    PROTECTED_TARGETS.map((target) => [
      target,
      canonicalPriorRecord(prior[target], `Prior ${target}`),
    ]),
  );
  const aliases = PROTECTED_TARGETS.flatMap(
    (target) => canonical[target].aliases,
  );
  if (new Set(aliases).size !== aliases.length) {
    throw new Error("Journal prior aliases overlap across protected targets");
  }
  return canonical;
}

function canonicalCandidates(candidates, release, prior) {
  assertOrderedExactKeys(
    candidates,
    CANDIDATE_TARGETS,
    "Journal candidate state",
  );
  const canonical = Object.fromEntries(
    CANDIDATE_TARGETS.map((target) => [
      target,
      canonicalCandidateRecord(
        candidates[target],
        target,
        release,
        prior[target],
      ),
    ]),
  );
  for (const target of CANDIDATE_TARGETS) {
    if (!release.activeTargets.includes(target) && canonical[target] !== null) {
      throw new Error("Journal retains a candidate for an unselected target");
    }
  }
  return canonical;
}

function canonicalStartMappings(startMappings, prior) {
  assertOrderedExactKeys(
    startMappings,
    START_MAPPING_TARGETS,
    "Journal start mappings",
  );
  const canonical = Object.fromEntries(
    START_MAPPING_TARGETS.map((target) => [
      target,
      [
        ...canonicalCurrentMappings(
          startMappings[target],
          prior[target].aliases,
        ).values(),
      ].sort((left, right) => left.alias.localeCompare(right.alias)),
    ]),
  );
  return canonical;
}

function assertJournalReleaseBindings({
  release,
  mode,
  deploySha,
  prior,
  candidates,
  startMappings,
  allowTerminalAppRecoveryResidual = false,
}) {
  if (release.mode !== mode) {
    throw new Error("Journal mode conflicts with the durable release manifest");
  }
  if (release.deploySha !== deploySha) {
    throw new Error("Journal SHA conflicts with the durable release manifest");
  }
  for (const target of MAIN_RELEASE_ACTIVATION_ORDER) {
    const releasePrior = release.originalPriors[target];
    const journalPrior = prior[target];
    if (
      journalPrior.deploymentId !== releasePrior.deploymentId ||
      journalPrior.deploymentUrl !== releasePrior.deploymentUrl ||
      !sameJson(journalPrior.aliases, releasePrior.aliases)
    ) {
      throw new Error(
        "Journal prior conflicts with the durable release manifest",
      );
    }
  }
  const reconciliationCandidates = Object.fromEntries(
    release.stagedTargets.map((target) => [
      target,
      candidates[target] === null || candidates[target].deploymentId === null
        ? null
        : {
            deploymentId: candidates[target].deploymentId,
            deploymentUrl: candidates[target].deploymentUrl,
            manifest: release,
          },
    ]),
  );
  const reconcile = allowTerminalAppRecoveryResidual
    ? reconcileMainReleaseForRecovery
    : reconcileMainRelease;
  reconcile({
    manifest: release,
    candidates: reconciliationCandidates,
    currentMappings: Object.fromEntries(
      MAIN_RELEASE_ACTIVATION_ORDER.map((target) => [
        target,
        startMappings[target],
      ]),
    ),
  });
}

// `vercel rollback` only restores a production deployment. Every reviewed main
// prior is an ordinary production deployment, and this guard keeps a
// non-production prior — a custom environment's, for instance — from ever
// reaching a rollback compensation.
export function isProductionShapedPrior(release, target) {
  const prior = release?.originalPriors?.[target];
  return (
    prior?.target === "production" && prior?.customEnvironmentSlug === null
  );
}

function assertOperationTarget(type, target, alias, journal) {
  if (!PROMOTABLE_TARGETS.includes(target) || alias !== null) {
    throw new Error(`${type} must bind one main target without an alias`);
  }
  if (
    type === "ordinary_rollback" &&
    !isProductionShapedPrior(journal.release, target)
  ) {
    throw new Error(
      `ordinary_rollback cannot restore a non-production ${target} prior`,
    );
  }
}

function canonicalOperation(operation, journal) {
  assertExactKeys(operation, OPERATION_KEYS, "Journal operation");
  const operationId = requireString(
    operation.operationId,
    "Operation ID",
    /^op-[0-9]{4}$/,
  );
  if (!PROTECTED_TARGETS.includes(operation.target)) {
    throw new Error("Operation target is unsupported");
  }
  if (!OPERATION_TYPES.includes(operation.type)) {
    throw new Error("Operation type is unsupported");
  }
  const alias =
    operation.alias === null ? null : canonicalizeHostname(operation.alias);
  assertOperationTarget(operation.type, operation.target, alias, journal);
  const priorDeploymentId = requireDeploymentId(
    operation.priorDeploymentId,
    "Operation prior deployment ID",
  );
  const priorDeploymentUrl = canonicalizeDeploymentUrl(
    operation.priorDeploymentUrl,
  );
  const expectedPrior = journal.prior[operation.target];
  if (
    priorDeploymentId !== expectedPrior.deploymentId ||
    priorDeploymentUrl !== expectedPrior.deploymentUrl
  ) {
    throw new Error("Operation prior identity differs from the journal");
  }
  const candidateDeploymentId =
    operation.candidateDeploymentId === null
      ? null
      : requireDeploymentId(
          operation.candidateDeploymentId,
          "Operation candidate deployment ID",
        );
  const candidateDeploymentUrl =
    operation.candidateDeploymentUrl === null
      ? null
      : canonicalizeDeploymentUrl(operation.candidateDeploymentUrl);
  if ((candidateDeploymentId === null) !== (candidateDeploymentUrl === null)) {
    throw new Error(
      "Operation candidate ID and URL must both be known or both be null",
    );
  }
  if (candidateDeploymentId === null) {
    throw new Error("Every operation binds its exact staged candidate");
  }
  const expectedCandidate = journal.candidates[operation.target];
  if (expectedCandidate === null) {
    throw new Error("Operation target was not selected for this transaction");
  }
  if (
    candidateDeploymentId !== null &&
    expectedCandidate?.deploymentId !== null &&
    (candidateDeploymentId !== expectedCandidate?.deploymentId ||
      candidateDeploymentUrl !== expectedCandidate?.deploymentUrl)
  ) {
    throw new Error("Operation candidate identity differs from the journal");
  }
  if (!OPERATION_STATES.includes(operation.state)) {
    throw new Error("Operation state is unsupported");
  }
  if (!COMMAND_OUTCOMES.includes(operation.commandOutcome)) {
    throw new Error("Operation command outcome is unsupported");
  }
  if (!MAPPING_STATES.includes(operation.mappingState)) {
    throw new Error("Operation mapping state is unsupported");
  }
  if (!ROLLBACK_STATES.includes(operation.rollbackState)) {
    throw new Error("Operation rollback state is unsupported");
  }
  if (
    (operation.state === "started" &&
      (operation.commandOutcome !== null ||
        operation.mappingState !== null ||
        operation.rollbackState !== null)) ||
    (operation.state === "command_returned" &&
      (operation.commandOutcome === null ||
        operation.mappingState !== null ||
        operation.rollbackState !== null)) ||
    (operation.state === "verified" &&
      (operation.commandOutcome === null || operation.mappingState === null))
  ) {
    throw new Error("Operation fields are inconsistent with its state");
  }
  if (
    operation.rollbackState === "entered" &&
    (operation.type !== "ordinary_rollback" ||
      operation.state !== "verified" ||
      operation.mappingState !== "prior")
  ) {
    throw new Error(
      "Rollback marker requires a verified ordinary rollback at prior",
    );
  }
  if (
    operation.type === "ordinary_rollback" &&
    operation.state === "verified" &&
    operation.mappingState === "prior" &&
    operation.rollbackState !== "entered"
  ) {
    throw new Error("Verified ordinary rollback must enter rollback state");
  }
  return {
    operationId,
    target: operation.target,
    type: operation.type,
    alias,
    priorDeploymentId,
    priorDeploymentUrl,
    candidateDeploymentId,
    candidateDeploymentUrl,
    state: operation.state,
    commandOutcome: operation.commandOutcome,
    mappingState: operation.mappingState,
    rollbackState: operation.rollbackState,
  };
}

function canonicalOperations(operations, journal) {
  if (!Array.isArray(operations)) {
    throw new Error("Journal operations must be an array");
  }
  const canonical = operations.map((operation) =>
    canonicalOperation(operation, journal),
  );
  const statesByOperation = new Map();
  for (const operation of canonical) {
    const events = statesByOperation.get(operation.operationId) ?? [];
    if (events.length > 0) {
      const first = events[0];
      for (const key of [
        "operationId",
        "target",
        "type",
        "alias",
        "priorDeploymentId",
        "priorDeploymentUrl",
      ]) {
        if (operation[key] !== first[key]) {
          throw new Error("Journal operation intent changed across events");
        }
      }
      const previous = events.at(-1);
      if (
        previous.candidateDeploymentId !== null &&
        (operation.candidateDeploymentId !== previous.candidateDeploymentId ||
          operation.candidateDeploymentUrl !== previous.candidateDeploymentUrl)
      ) {
        throw new Error(
          "Journal operation candidate changed after it was discovered",
        );
      }
      if (
        previous.commandOutcome !== null &&
        operation.commandOutcome !== previous.commandOutcome
      ) {
        throw new Error("Journal operation command outcome changed");
      }
      if (
        previous.mappingState !== null &&
        operation.mappingState !== previous.mappingState
      ) {
        throw new Error("Journal operation mapping result changed");
      }
      if (
        previous.rollbackState !== null &&
        operation.rollbackState !== previous.rollbackState
      ) {
        throw new Error("Journal operation rollback marker changed");
      }
    }
    events.push(operation);
    statesByOperation.set(operation.operationId, events);
  }
  const operationIds = [...statesByOperation.keys()];
  for (const [index, operationId] of operationIds.entries()) {
    if (operationId !== `op-${String(index + 1).padStart(4, "0")}`) {
      throw new Error("Journal operation IDs are not monotonic");
    }
    const states = statesByOperation
      .get(operationId)
      .map((operation) => operation.state);
    if (states[0] !== "started") {
      throw new Error("Every journal operation must begin with started");
    }
    const allowedTransitions = {
      started: new Set(["command_returned"]),
      command_returned: new Set(["verified"]),
      verified: new Set(),
    };
    for (let stateIndex = 1; stateIndex < states.length; stateIndex += 1) {
      if (!allowedTransitions[states[stateIndex - 1]].has(states[stateIndex])) {
        throw new Error("Journal operation state transition is invalid");
      }
    }
  }
  return canonical;
}

function clone(value) {
  return structuredClone(value);
}

function nextJournal(journal, changes) {
  const current = assertMainTransactionJournal(journal);
  const next = {
    ...clone(current),
    ...changes,
    sequence: current.sequence + 1,
  };
  return assertMainTransactionJournal(next);
}

function operationIntent(journal, { target, type, alias = null }) {
  const canonicalAlias = alias === null ? null : canonicalizeHostname(alias);
  assertOperationTarget(type, target, canonicalAlias, journal);
  const prior = journal.prior[target];
  const candidate = journal.candidates[target];
  return {
    target,
    type,
    alias: canonicalAlias,
    priorDeploymentId: prior.deploymentId,
    priorDeploymentUrl: prior.deploymentUrl,
    candidateDeploymentId: candidate?.deploymentId ?? null,
    candidateDeploymentUrl: candidate?.deploymentUrl ?? null,
  };
}

function lastOperationEvent(journal, operationId) {
  const events = journal.operations.filter(
    (operation) => operation.operationId === operationId,
  );
  if (events.length === 0) throw new Error("Journal operation does not exist");
  return events.at(-1);
}

function appendOperationEvent(journal, previous, changes) {
  const event = {
    ...previous,
    ...changes,
  };
  const next = nextJournal(journal, {
    status: event.state,
    operations: [...journal.operations, event],
  });
  return next;
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validateCandidateEvolution(previous, current) {
  for (const target of CANDIDATE_TARGETS) {
    if (sameJson(previous[target], current[target])) continue;
    throw new Error("Journal candidates changed after preparation");
  }
}

function statusOnlyTransitionAllowed(previous, current) {
  const transitions = {
    prepared: new Set(["committed", "recovering"]),
    started: new Set(["recovering"]),
    command_returned: new Set(["recovering"]),
    verified: new Set([
      "committed",
      "recovering",
      "recovered",
      "manual_intervention",
    ]),
    committed: new Set(),
    recovering: new Set(["recovered", "manual_intervention"]),
    recovered: new Set(),
    manual_intervention: new Set(),
  };
  return transitions[previous].has(current);
}

function canonicalCurrentMappings(currentMappings, aliases) {
  if (!Array.isArray(currentMappings)) {
    throw new Error("Current mappings must be an array");
  }
  const byAlias = new Map();
  for (const mapping of currentMappings) {
    assertExactKeys(mapping, CURRENT_MAPPING_KEYS, "Current mapping");
    const canonical = {
      alias: canonicalizeHostname(mapping.alias),
      deploymentId: requireDeploymentId(
        mapping.deploymentId,
        "Current mapping deployment ID",
      ),
      deploymentUrl: canonicalizeDeploymentUrl(mapping.deploymentUrl),
    };
    if (byAlias.has(canonical.alias)) {
      throw new Error("Current mapping contains a duplicate alias");
    }
    byAlias.set(canonical.alias, canonical);
  }
  const expectedAliases = [...new Set(aliases)].sort();
  if (
    JSON.stringify([...byAlias.keys()].sort()) !==
    JSON.stringify(expectedAliases)
  ) {
    throw new Error("Current mappings do not exactly cover protected aliases");
  }
  return byAlias;
}

function sameDeployment(mapping, record) {
  return (
    mapping.deploymentId === record.deploymentId &&
    mapping.deploymentUrl === record.deploymentUrl
  );
}

function startedForwardOperations(journal) {
  const starts = journal.operations.filter(
    (operation) =>
      operation.state === "started" &&
      FORWARD_OPERATION_TYPES.has(operation.type),
  );
  return starts;
}

// Every reviewed main domain lives in the ordinary production environment, so
// `vercel promote` carries it. Every forward operation, App included, is
// verified at `candidate`: nothing may be verified while its reviewed mapping
// still points at the prior. A recovery operation is verified at `prior`
// instead, and its own executor states that explicitly, so this function is
// forward-only and fails closed on anything else.
export function expectedVerifiedMappingStateFor(operation) {
  if (!FORWARD_OPERATION_TYPES.has(operation?.type)) {
    throw new Error("Operation type is unsupported");
  }
  return "candidate";
}

function isOperationVerified(journal, operationId) {
  const last = lastOperationEvent(journal, operationId);
  return (
    last.state === "verified" &&
    last.commandOutcome === "success" &&
    last.mappingState === expectedVerifiedMappingStateFor(last)
  );
}

function appendStatus(journal, status) {
  return nextJournal(journal, { status });
}

export function createMainTransactionId({
  repository,
  deploySha,
  runId,
  runAttempt,
}) {
  if (repository !== MAIN_TRANSACTION_REPOSITORY) {
    throw new Error("Transaction repository is unexpected");
  }
  const sha = requireString(deploySha, "Transaction deploy SHA", SHA_PATTERN);
  const canonicalRunId = requireNumericId(runId, "Transaction run ID");
  const canonicalRunAttempt = requireNumericId(
    runAttempt,
    "Transaction run attempt",
  );
  const digest = createHash("sha256")
    .update(
      JSON.stringify([repository, sha, canonicalRunId, canonicalRunAttempt]),
    )
    .digest("hex")
    .slice(0, 32);
  return `main-${digest}`;
}

export function createPreparedMainTransactionJournal({
  repository = MAIN_TRANSACTION_REPOSITORY,
  deploySha,
  runId,
  runAttempt,
  mode,
  release,
  prior,
  startMappings,
  candidates,
  allowTerminalAppRecoveryResidual = false,
}) {
  const identity = canonicalIdentity({
    repository,
    deploySha,
    runId,
    runAttempt,
  });
  if (!MODES.includes(mode)) throw new Error("Journal mode is unsupported");
  if (typeof allowTerminalAppRecoveryResidual !== "boolean") {
    throw new Error("Journal recovery-only admission is malformed");
  }
  const canonicalRelease = assertMainReleaseManifest(release);
  const canonicalPriorState = canonicalPrior(prior);
  const canonicalStartState = canonicalStartMappings(
    startMappings,
    canonicalPriorState,
  );
  const canonicalCandidateState = canonicalCandidates(
    candidates,
    canonicalRelease,
    canonicalPriorState,
  );
  assertJournalReleaseBindings({
    release: canonicalRelease,
    mode,
    deploySha: identity.deploySha,
    prior: canonicalPriorState,
    candidates: canonicalCandidateState,
    startMappings: canonicalStartState,
    allowTerminalAppRecoveryResidual,
  });
  const journal = {
    schema: MAIN_TRANSACTION_SCHEMA,
    repository: identity.repository,
    deploySha: identity.deploySha,
    runId: identity.runId,
    runAttempt: identity.runAttempt,
    transactionId: identity.transactionId,
    mode,
    sequence: 0,
    status: "prepared",
    release: canonicalRelease,
    prior: canonicalPriorState,
    startMappings: canonicalStartState,
    candidates: canonicalCandidateState,
    operations: [],
  };
  return assertMainTransactionJournal(journal);
}

export function assertMainTransactionJournal(journal, expected = {}) {
  assertExactKeys(journal, JOURNAL_KEYS, "Main transaction journal");
  if (journal.schema !== MAIN_TRANSACTION_SCHEMA) {
    throw new Error("Journal schema is unsupported");
  }
  const identity = canonicalIdentity(journal);
  if (!MODES.includes(journal.mode)) {
    throw new Error("Journal mode is unsupported");
  }
  if (!Number.isSafeInteger(journal.sequence) || journal.sequence < 0) {
    throw new Error("Journal sequence is malformed");
  }
  if (!STATUSES.includes(journal.status)) {
    throw new Error("Journal status is unsupported");
  }
  const prior = canonicalPrior(journal.prior);
  const release = assertMainReleaseManifest(journal.release);
  const startMappings = canonicalStartMappings(journal.startMappings, prior);
  const canonical = {
    schema: journal.schema,
    repository: identity.repository,
    deploySha: identity.deploySha,
    runId: identity.runId,
    runAttempt: identity.runAttempt,
    transactionId: identity.transactionId,
    mode: journal.mode,
    sequence: journal.sequence,
    status: journal.status,
    release,
    prior,
    startMappings,
    candidates: canonicalCandidates(journal.candidates, release, prior),
    operations: [],
  };
  // Existing journals can represent either a forward prefix or an inherited
  // recovery-only App residual. Parsing grants no mutation authority.
  assertJournalReleaseBindings({
    ...canonical,
    allowTerminalAppRecoveryResidual: true,
  });
  canonical.operations = canonicalOperations(journal.operations, canonical);
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (!Object.hasOwn(canonical, key) || canonical[key] !== expectedValue) {
      throw new Error(`Journal ${key} does not match the expected identity`);
    }
  }
  return canonical;
}

// This is deliberately a pure planner. The coordinator must re-observe
// provider mappings immediately before applying these actions and create a
// fresh current-attempt recovery journal. GitHub artifacts are not authority
// for inherited state.
export function planInheritedMainTransactionRecovery({ journal, reason }) {
  const canonical = assertMainTransactionJournal(journal);
  if (
    ![
      "main-stale-before-forward",
      "suffix-preparation-failed-before-forward",
      "forward-operation-failed",
    ].includes(reason)
  ) {
    throw new Error("Inherited recovery reason is unsupported");
  }
  const candidates = Object.fromEntries(
    canonical.release.stagedTargets.map((target) => [
      target,
      canonical.candidates[target] === null
        ? null
        : {
            deploymentId: canonical.candidates[target].deploymentId,
            deploymentUrl: canonical.candidates[target].deploymentUrl,
            manifest: canonical.release,
          },
    ]),
  );
  const reconciliation = reconcileMainReleaseForRecovery({
    manifest: canonical.release,
    candidates,
    currentMappings: Object.fromEntries(
      MAIN_RELEASE_ACTIVATION_ORDER.map((target) => [
        target,
        canonical.startMappings[target],
      ]),
    ),
  });
  if (reconciliation.allCandidate) {
    return {
      decision: "verify-noop",
      reason: "all-candidate-without-current-mutation",
      journal: canonical,
      reconciliation,
      actions: [],
      rollbackAuthority: { targets: [], aliases: [] },
    };
  }
  if (reconciliation.inheritedCandidateAliases.length === 0) {
    return {
      decision: "no-inherited-recovery",
      reason: "all-prior",
      journal: canonical,
      reconciliation,
      actions: [],
      rollbackAuthority: { targets: [], aliases: [] },
    };
  }
  const inheritedTargets = reconciliation.targets.filter(
    ({ state }) => state === "candidate" || state === "mixed",
  );
  const actions = [];
  for (const observed of [...inheritedTargets].reverse()) {
    const { target, state } = observed;
    const candidate = canonical.candidates[target];
    if (state !== "candidate") {
      throw new Error("Inherited ordinary recovery state is unsupported");
    }
    actions.push({
      kind: "ordinary_rollback",
      target,
      aliases: [...canonical.prior[target].aliases],
      priorDeploymentId: canonical.prior[target].deploymentId,
      priorDeploymentUrl: canonical.prior[target].deploymentUrl,
      candidateDeploymentId: candidate.deploymentId,
      candidateDeploymentUrl: candidate.deploymentUrl,
    });
  }
  return {
    decision: "restore-inherited",
    reason,
    journal: canonical,
    reconciliation,
    actions,
    rollbackAuthority: {
      targets: inheritedTargets.map(({ target }) => target),
      aliases: [...reconciliation.inheritedCandidateAliases].sort(),
    },
  };
}

export function assertMainInheritedTransactionRecoveryPlan(plan) {
  assertExactKeys(
    plan,
    INHERITED_RECOVERY_PLAN_KEYS,
    "Inherited main transaction recovery plan",
  );
  if (plan.decision !== "restore-inherited") {
    throw new Error("Inherited recovery plan is not executable");
  }
  const expected = planInheritedMainTransactionRecovery({
    journal: plan.journal,
    reason: plan.reason,
  });
  if (!sameJson(plan, expected)) {
    throw new Error("Inherited recovery plan differs from the canonical plan");
  }
  return expected;
}

export function mainTransactionJournalArtifactName(journal) {
  const canonical = assertMainTransactionJournal(journal);
  return `vercel-main-journal-${canonical.transactionId}-${String(
    canonical.sequence,
  ).padStart(6, "0")}`;
}

export async function persistMainTransactionJournal(journal, uploadJournal) {
  const canonical = assertMainTransactionJournal(journal);
  if (typeof uploadJournal !== "function") {
    throw new Error("Journal upload adapter is required");
  }
  const artifactName = mainTransactionJournalArtifactName(canonical);
  let receipt;
  try {
    receipt = await uploadJournal({
      artifactName,
      journal: clone(canonical),
      retentionDays: 7,
    });
  } catch {
    throw new MainTransactionError("Journal artifact upload failed", {
      code: "JOURNAL_UPLOAD_FAILED",
      journal: canonical,
    });
  }
  if (
    !receipt ||
    receipt.acknowledged !== true ||
    receipt.artifactName !== artifactName ||
    !NUMERIC_ID_PATTERN.test(String(receipt.artifactId ?? ""))
  ) {
    throw new MainTransactionError(
      "Journal artifact upload was not acknowledged",
      {
        code: "JOURNAL_UPLOAD_NOT_ACKNOWLEDGED",
        journal: canonical,
      },
    );
  }
  return canonical;
}

export function startMainTransactionOperation(journal, intent) {
  const canonical = assertMainTransactionJournal(journal);
  if (!["prepared", "verified", "recovering"].includes(canonical.status)) {
    throw new Error("Journal cannot start another operation in this state");
  }
  if (!OPERATION_TYPES.includes(intent?.type)) {
    throw new Error("Operation type is unsupported");
  }
  const recoveryPhase =
    canonical.status === "recovering" ||
    canonical.operations.some(
      (operation) =>
        operation.state === "started" &&
        RECOVERY_OPERATION_TYPES.has(operation.type),
    );
  if (
    (recoveryPhase && !RECOVERY_OPERATION_TYPES.has(intent.type)) ||
    (!recoveryPhase && !FORWARD_OPERATION_TYPES.has(intent.type))
  ) {
    throw new Error("Operation type is not allowed in this transaction phase");
  }
  if (!recoveryPhase) {
    assertJournalReleaseBindings(canonical);
  }
  const resolved = operationIntent(canonical, intent);
  const forwardStarts = startedForwardOperations(canonical);
  if (
    forwardStarts.some(
      (operation) =>
        operation.type === resolved.type &&
        operation.target === resolved.target,
    )
  ) {
    throw new Error("Forward transaction operation is already recorded");
  }
  const startedCount = canonical.operations.filter(
    (operation) => operation.state === "started",
  ).length;
  const event = {
    operationId: `op-${String(startedCount + 1).padStart(4, "0")}`,
    ...resolved,
    state: "started",
    commandOutcome: null,
    mappingState: null,
    rollbackState: null,
  };
  return nextJournal(canonical, {
    status: "started",
    operations: [...canonical.operations, event],
  });
}

export function recordMainTransactionCommandReturned(
  journal,
  { operationId, outcome, candidate = null },
) {
  const canonical = assertMainTransactionJournal(journal);
  const previous = lastOperationEvent(canonical, operationId);
  if (previous.state !== "started") {
    throw new Error("Operation is not waiting for a command result");
  }
  if (!["success", "unknown"].includes(outcome)) {
    throw new Error("Command result must be success or unknown");
  }
  // No activation command creates a deployment, so a command return never
  // discovers a candidate.
  if (candidate !== null) {
    throw new Error("Activation commands never discover a candidate");
  }
  return appendOperationEvent(canonical, previous, {
    state: "command_returned",
    commandOutcome: outcome,
  });
}

export function recordMainTransactionVerified(
  journal,
  { operationId, mappingState, rollbackState = null },
) {
  const canonical = assertMainTransactionJournal(journal);
  const previous = lastOperationEvent(canonical, operationId);
  if (previous.state !== "command_returned") {
    throw new Error("Operation command has not returned");
  }
  if (!MAPPING_STATES.includes(mappingState) || mappingState === null) {
    throw new Error("Verified mapping state is unsupported");
  }
  if (!ROLLBACK_STATES.includes(rollbackState)) {
    throw new Error("Verified rollback state is unsupported");
  }
  return appendOperationEvent(canonical, previous, {
    state: "verified",
    mappingState,
    rollbackState,
  });
}

export function assertMainTransactionJournalHistory(
  journals,
  expectedIdentity = {},
) {
  if (!Array.isArray(journals) || journals.length === 0) {
    throw new Error("Journal history must be a non-empty array");
  }
  const canonical = journals
    .map((journal) => assertMainTransactionJournal(journal, expectedIdentity))
    .sort((left, right) => left.sequence - right.sequence);
  for (const [index, journal] of canonical.entries()) {
    if (journal.sequence !== index) {
      throw new Error("Journal history sequence is missing or duplicated");
    }
    if (index === 0) {
      if (journal.status !== "prepared" || journal.operations.length !== 0) {
        throw new Error("Journal history must begin with a prepared snapshot");
      }
      continue;
    }
    const previous = canonical[index - 1];
    for (const key of [
      "schema",
      "repository",
      "deploySha",
      "runId",
      "runAttempt",
      "transactionId",
      "mode",
    ]) {
      if (previous[key] !== journal[key]) {
        throw new Error("Journal identity changed across history");
      }
    }
    if (!sameJson(previous.prior, journal.prior)) {
      throw new Error("Journal prior state changed across history");
    }
    if (!sameJson(previous.release, journal.release)) {
      throw new Error("Journal release manifest changed across history");
    }
    if (!sameJson(previous.startMappings, journal.startMappings)) {
      throw new Error("Journal start mappings changed across history");
    }
    validateCandidateEvolution(previous.candidates, journal.candidates);
    if (
      !sameJson(
        journal.operations.slice(0, previous.operations.length),
        previous.operations,
      )
    ) {
      throw new Error("Journal operation history was rewritten");
    }
    const appendedEvents =
      journal.operations.length - previous.operations.length;
    const candidateChanged = !sameJson(previous.candidates, journal.candidates);
    let expected;
    if (appendedEvents === 0) {
      const isCandidateAttachment =
        candidateChanged && journal.status === previous.status;
      const isStatusOnlyTransition =
        !candidateChanged &&
        statusOnlyTransitionAllowed(previous.status, journal.status);
      if (!isCandidateAttachment && !isStatusOnlyTransition) {
        throw new Error("Journal snapshot did not append one legal event");
      }
      if (isCandidateAttachment) {
        expected = nextJournal(previous, {
          candidates: journal.candidates,
        });
      } else if (journal.status === "committed") {
        expected = markMainTransactionCommitted(previous);
      } else {
        if (
          ["recovered", "manual_intervention"].includes(journal.status) &&
          !canonical
            .slice(0, index)
            .some((snapshot) => snapshot.status === "recovering")
        ) {
          throw new Error(
            "Terminal recovery status requires a recovering snapshot",
          );
        }
        expected = appendStatus(previous, journal.status);
      }
    } else if (appendedEvents !== 1) {
      throw new Error("Journal snapshot batched operation events");
    } else {
      const appended = journal.operations.at(-1);
      if (appended.state === "started") {
        if (candidateChanged) {
          throw new Error("Operation start cannot change staged candidates");
        }
        expected = startMainTransactionOperation(previous, {
          type: appended.type,
          target: appended.target,
          alias: appended.alias,
        });
      } else if (appended.state === "command_returned") {
        expected = recordMainTransactionCommandReturned(previous, {
          operationId: appended.operationId,
          outcome: appended.commandOutcome,
          candidate: candidateChanged
            ? {
                deploymentId: journal.candidates.app.deploymentId,
                deploymentUrl: journal.candidates.app.deploymentUrl,
                ...journal.candidates.app.discovery,
              }
            : null,
        });
      } else if (appended.state === "verified") {
        if (candidateChanged) {
          throw new Error(
            "Operation verification cannot change staged candidates",
          );
        }
        expected = recordMainTransactionVerified(previous, {
          operationId: appended.operationId,
          mappingState: appended.mappingState,
          rollbackState: appended.rollbackState,
        });
      } else {
        throw new Error("Journal appended an unsupported operation event");
      }
    }
    if (!sameJson(expected, journal)) {
      throw new Error("Journal snapshot differs from its legal helper append");
    }
  }
  return canonical;
}

export function selectHighestMainTransactionJournal(
  journals,
  expectedIdentity = {},
) {
  return assertMainTransactionJournalHistory(journals, expectedIdentity).at(-1);
}

export function decideMainTransactionRecovery(journals, expectedIdentity = {}) {
  const journal = selectHighestMainTransactionJournal(
    journals,
    expectedIdentity,
  );
  return decideRecoveryFromJournal(journal);
}

function decideRecoveryFromJournal(journal) {
  if (journal.status === "committed") {
    return { decision: "bypass", reason: "committed", journal };
  }
  if (journal.status === "recovered") {
    return { decision: "bypass", reason: "already-recovered", journal };
  }
  if (journal.status === "manual_intervention") {
    return {
      decision: "manual_intervention",
      reason: "manual-intervention-recorded",
      journal,
    };
  }
  const started = startedForwardOperations(journal);
  if (started.length === 0) {
    return {
      decision: "verify-only",
      reason: "no-mutation-started",
      journal,
    };
  }
  return {
    decision: "recover",
    reason: "incomplete-mutation-journal",
    journal,
  };
}

export function markMainTransactionCommitted(journal) {
  const canonical = assertMainTransactionJournal(journal);
  if (canonical.status === "committed") return canonical;
  const selectedOperations = PROMOTABLE_TARGETS.map((target) => {
    const candidate = canonical.candidates[target];
    if (candidate === null) return null;
    const state = classifyMainTransactionMapping({
      aliases: canonical.prior[target].aliases,
      currentMappings: canonical.startMappings[target],
      prior: canonical.prior[target],
      candidate,
    });
    if (state === "candidate") return null;
    if (state === "prior") return { target, type: "promote" };
    throw new Error(
      "Transaction cannot commit from an unsupported start mapping",
    );
  }).filter((operation) => operation !== null);
  // App alias completeness is owned by the final protected-mapping verifier.
  // The journal commit gate binds the selected immutable deployment itself.
  const selectedOperationsVerified = selectedOperations.every(
    ({ target, type }) => {
      const operation = startedForwardOperations(canonical).find(
        (entry) => entry.type === type && entry.target === target,
      );
      return (
        operation !== undefined &&
        isOperationVerified(canonical, operation.operationId)
      );
    },
  );
  if (
    !["prepared", "verified"].includes(canonical.status) ||
    !selectedOperationsVerified ||
    startedForwardOperations(canonical).some(
      (operation) => !isOperationVerified(canonical, operation.operationId),
    )
  ) {
    throw new Error("Transaction cannot commit with incomplete operations");
  }
  return appendStatus(canonical, "committed");
}

export function classifyMainTransactionMapping({
  aliases,
  currentMappings,
  prior,
  candidate,
}) {
  const canonicalPrior = canonicalPriorRecord(prior, "Mapping prior");
  const canonicalCandidate = canonicalPriorRecord(
    {
      deploymentId: candidate?.deploymentId,
      deploymentUrl: candidate?.deploymentUrl,
      aliases: candidate?.aliases,
    },
    "Mapping candidate",
  );
  const canonicalAliasList = canonicalAliases(aliases, "Mapping aliases");
  const mappings = canonicalCurrentMappings(
    currentMappings,
    canonicalAliasList,
  );
  const states = canonicalAliasList.map((alias) => {
    const mapping = mappings.get(alias);
    if (sameDeployment(mapping, canonicalPrior)) return "prior";
    if (sameDeployment(mapping, canonicalCandidate)) return "candidate";
    return "unexpected";
  });
  if (states.every((state) => state === "prior")) return "prior";
  if (states.every((state) => state === "candidate")) return "candidate";
  if (states.every((state) => state !== "unexpected")) return "partial";
  return "unexpected";
}

function canonicalAllCurrentMappings(journal, currentMappings) {
  const aliases = PROTECTED_TARGETS.flatMap(
    (target) => journal.prior[target].aliases,
  );
  return canonicalCurrentMappings(currentMappings, aliases);
}

function action(kind, journal, operation, additional = {}) {
  const target = additional.target ?? operation.target;
  const prior = journal.prior[target];
  const candidate = journal.candidates[target];
  return {
    kind,
    target,
    operationId: operation.operationId,
    priorDeploymentId: prior.deploymentId,
    priorDeploymentUrl: prior.deploymentUrl,
    candidateDeploymentId: candidate?.deploymentId ?? null,
    candidateDeploymentUrl: candidate?.deploymentUrl ?? null,
    ...additional,
  };
}

export function planMainTransactionRecovery({ journal, currentMappings }) {
  const canonical = assertMainTransactionJournal(journal);
  // The recovery job validates the complete immutable artifact history before
  // passing its highest snapshot to this pure planner.
  const recoveryDecision = decideRecoveryFromJournal(canonical);
  if (recoveryDecision.decision !== "recover") {
    return {
      decision: recoveryDecision.decision,
      reason: recoveryDecision.reason,
      journal: canonical,
      actions: [],
      rollbackStateTargets: [],
      forceFailure: false,
    };
  }
  const mappings = canonicalAllCurrentMappings(canonical, currentMappings);
  const starts = startedForwardOperations(canonical);
  const recoveryJournal = canonical;
  const actions = [];
  const handledPromoteTargets = new Set();
  let manual = false;
  for (const operation of [...starts].reverse()) {
    if (operation.type === "promote") {
      if (handledPromoteTargets.has(operation.target)) continue;
      handledPromoteTargets.add(operation.target);
      const candidate = canonical.candidates[operation.target];
      const targetMappings = canonical.prior[operation.target].aliases.map(
        (alias) => mappings.get(alias),
      );
      const mappingState = classifyMainTransactionMapping({
        aliases: canonical.prior[operation.target].aliases,
        currentMappings: targetMappings,
        prior: canonical.prior[operation.target],
        candidate,
      });
      if (mappingState === "prior") {
        actions.push(
          action("verified_noop", recoveryJournal, operation, {
            mappingState: "prior",
          }),
        );
      } else if (
        mappingState === "candidate" &&
        // A Vercel rollback only restores a production deployment. Every
        // reviewed prior is production-shaped; anything else stays manual.
        isProductionShapedPrior(canonical.release, operation.target)
      ) {
        actions.push(
          action("ordinary_rollback", recoveryJournal, operation, {
            aliases: canonical.prior[operation.target].aliases,
            entersRollbackState: true,
          }),
        );
      } else {
        manual = true;
        actions.push(
          action("manual_intervention", recoveryJournal, operation, {
            mappingState,
          }),
        );
      }
      continue;
    }
  }
  return {
    decision: manual ? "manual_intervention" : "recover",
    reason: manual
      ? "unexpected-protected-mapping"
      : "started-operations-require-verification-or-recovery",
    journal: canonical,
    actions,
    rollbackStateTargets: actions
      .filter((entry) => entry.kind === "ordinary_rollback")
      .map((entry) => entry.target),
    forceFailure: true, // Recovery never converts a failed activation into a green release.
  };
}

function recoveryActionSlots(journal) {
  const slots = [];
  const handledPromoteTargets = new Set();
  for (const operation of [...startedForwardOperations(journal)].reverse()) {
    if (operation.type !== "promote") continue;
    if (handledPromoteTargets.has(operation.target)) continue;
    handledPromoteTargets.add(operation.target);
    slots.push({
      category: "ordinary",
      target: operation.target,
      alias: null,
      operation,
    });
  }
  return slots;
}

function canonicalRecoveryAction(entry, slot, journal, index) {
  const label = `Recovery action ${index + 1}`;
  // Every recovery slot compensates one promote. `candidate` is always
  // compensated by a rollback, so it is never an admissible manual or noop
  // state.
  const allowedKinds = new Set([
    "verified_noop",
    "manual_intervention",
    "ordinary_rollback",
  ]);
  if (slot.category !== "ordinary" || !allowedKinds.has(entry?.kind)) {
    throw new Error(`${label} kind does not match its recovery slot`);
  }
  const expectedKeys =
    entry.kind === "ordinary_rollback"
      ? [...RECOVERY_ACTION_BASE_KEYS, "aliases", "entersRollbackState"]
      : [...RECOVERY_ACTION_BASE_KEYS, "mappingState"];
  assertExactKeys(entry, expectedKeys, label);

  const expected = action(entry.kind, journal, slot.operation, {
    target: slot.target,
  });
  for (const key of RECOVERY_ACTION_BASE_KEYS.slice(1)) {
    if (entry[key] !== expected[key]) {
      throw new Error(`${label} ${key} differs from the journal`);
    }
  }

  if (entry.kind === "ordinary_rollback") {
    if (
      !sameJson(entry.aliases, journal.prior[slot.target].aliases) ||
      entry.entersRollbackState !== true
    ) {
      throw new Error(`${label} rollback contract is malformed`);
    }
    return {
      ...expected,
      aliases: [...journal.prior[slot.target].aliases],
      entersRollbackState: true,
    };
  }

  const allowedMappingStates =
    entry.kind === "verified_noop"
      ? new Set(["prior"])
      : new Set(["partial", "unexpected"]);
  if (!allowedMappingStates.has(entry.mappingState)) {
    throw new Error(`${label} mapping state is inconsistent with its kind`);
  }
  return {
    ...expected,
    mappingState: entry.mappingState,
  };
}

export function assertMainTransactionRecoveryPlan(plan) {
  assertExactKeys(plan, RECOVERY_PLAN_KEYS, "Main transaction recovery plan");
  const journal = assertMainTransactionJournal(plan.journal);
  const recoveryDecision = decideRecoveryFromJournal(journal);
  if (recoveryDecision.decision !== "recover") {
    if (
      plan.decision !== recoveryDecision.decision ||
      plan.reason !== recoveryDecision.reason ||
      !Array.isArray(plan.actions) ||
      plan.actions.length !== 0 ||
      !Array.isArray(plan.rollbackStateTargets) ||
      plan.rollbackStateTargets.length !== 0 ||
      plan.forceFailure !== false
    ) {
      throw new Error(
        "Recovery plan does not match the journal recovery decision",
      );
    }
    return {
      decision: recoveryDecision.decision,
      reason: recoveryDecision.reason,
      journal,
      actions: [],
      rollbackStateTargets: [],
      forceFailure: false,
    };
  }

  if (!Array.isArray(plan.actions)) {
    throw new Error("Recovery plan actions are malformed");
  }
  const slots = recoveryActionSlots(journal);
  if (plan.actions.length !== slots.length) {
    throw new Error("Recovery plan actions do not cover the journal exactly");
  }
  const actions = plan.actions.map((entry, index) =>
    canonicalRecoveryAction(entry, slots[index], journal, index),
  );
  const rollbackStateTargets = actions
    .filter((entry) => entry.kind === "ordinary_rollback")
    .map((entry) => entry.target);
  if (!sameJson(plan.rollbackStateTargets, rollbackStateTargets)) {
    throw new Error("Recovery rollback-state targets are malformed");
  }
  const hasManualAction = actions.some(
    (entry) => entry.kind === "manual_intervention",
  );
  const decision = hasManualAction ? "manual_intervention" : "recover";
  const reason = hasManualAction
    ? "unexpected-protected-mapping"
    : "started-operations-require-verification-or-recovery";
  if (
    plan.decision !== decision ||
    plan.reason !== reason ||
    plan.forceFailure !== true
  ) {
    throw new Error("Recovery plan outcome is inconsistent with its actions");
  }
  return {
    decision,
    reason,
    journal,
    actions,
    rollbackStateTargets,
    forceFailure: true,
  };
}

export function startMainTransactionRecovery(journal) {
  const canonical = assertMainTransactionJournal(journal);
  if (decideRecoveryFromJournal(canonical).decision !== "recover") {
    throw new Error("Journal does not require transaction recovery");
  }
  if (
    ["recovering", "recovered", "manual_intervention"].includes(
      canonical.status,
    )
  ) {
    throw new Error("Journal cannot start transaction recovery in this state");
  }
  return appendStatus(canonical, "recovering");
}

export function startInheritedMainTransactionRecovery({
  journal,
  recoveryPlan,
}) {
  const canonical = assertMainTransactionJournal(journal);
  const plan = assertMainInheritedTransactionRecoveryPlan(recoveryPlan);
  if (!sameJson(canonical, plan.journal)) {
    throw new Error(
      "Current-attempt journal differs from its inherited recovery plan",
    );
  }
  if (canonical.status !== "prepared" || canonical.operations.length !== 0) {
    throw new Error(
      "Inherited recovery requires a fresh prepared current-attempt journal",
    );
  }
  if (plan.actions.length === 0) {
    throw new Error(
      "Inherited recovery plan has no authorized restore actions",
    );
  }
  return appendStatus(canonical, "recovering");
}

export function finishMainTransactionRecovery(
  journal,
  { manualIntervention = false } = {},
) {
  const canonical = assertMainTransactionJournal(journal);
  if (!["recovering", "verified"].includes(canonical.status)) {
    throw new Error("Journal cannot finish transaction recovery in this state");
  }
  const recoveryStarts = canonical.operations.filter(
    (operation) =>
      operation.state === "started" &&
      RECOVERY_OPERATION_TYPES.has(operation.type),
  );
  if (canonical.status !== "recovering" && recoveryStarts.length === 0) {
    throw new Error("Transaction recovery was not started");
  }
  const firstRecoveryIndex = canonical.operations.findIndex(
    (operation) =>
      operation.state === "started" &&
      RECOVERY_OPERATION_TYPES.has(operation.type),
  );
  if (
    firstRecoveryIndex >= 0 &&
    canonical.operations
      .slice(firstRecoveryIndex)
      .some(
        (operation) =>
          operation.state === "started" &&
          !RECOVERY_OPERATION_TYPES.has(operation.type),
      )
  ) {
    throw new Error("Forward mutation cannot start during recovery");
  }
  for (const operation of recoveryStarts) {
    const last = lastOperationEvent(canonical, operation.operationId);
    if (
      last.state !== "verified" ||
      last.commandOutcome !== "success" ||
      last.mappingState !== "prior" ||
      (last.type === "ordinary_rollback" && last.rollbackState !== "entered")
    ) {
      throw new Error("Transaction recovery contains an incomplete operation");
    }
  }
  return appendStatus(
    canonical,
    manualIntervention ? "manual_intervention" : "recovered",
  );
}

async function assertFresh(assertFreshness, phase, journal) {
  if (typeof assertFreshness !== "function") {
    throw new Error("Freshness adapter is required");
  }
  let result;
  try {
    result = await assertFreshness({
      phase,
      deploySha: journal.deploySha,
      transactionId: journal.transactionId,
    });
  } catch {
    throw new MainTransactionError("Remote main freshness is unproven", {
      code: "FRESHNESS_UNPROVEN",
      journal,
    });
  }
  if (!result || result.sha !== journal.deploySha) {
    throw new MainTransactionError("Remote main advanced", {
      code:
        phase === "transaction-start"
          ? "SUPERSEDED_BEFORE_MUTATION"
          : "SUPERSEDED_DURING_MUTATION",
      journal,
    });
  }
}

export async function executeJournaledMainMutation({
  journal,
  intent,
  uploadJournal,
  executeMutation,
  verifyMapping,
  inspectMutationState,
  allowedPreMutationStates = ["prior"],
  expectedVerifiedMappingState = "candidate",
  assertFreshness,
  requireFreshness = true,
}) {
  let highest = assertMainTransactionJournal(journal);
  let lastDurableJournal = highest;
  const persistNext = async (next) => {
    try {
      const persisted = await persistMainTransactionJournal(
        next,
        uploadJournal,
      );
      lastDurableJournal = persisted;
      return persisted;
    } catch (error) {
      if (error instanceof MainTransactionError) {
        error.journal = lastDurableJournal;
      }
      throw error;
    }
  };
  if (typeof executeMutation !== "function") {
    throw new Error("Mutation adapter is required");
  }
  if (typeof verifyMapping !== "function") {
    throw new Error("Mapping verification adapter is required");
  }
  if (typeof inspectMutationState !== "function") {
    throw new Error("Pre-mutation state adapter is required");
  }
  if (
    !Array.isArray(allowedPreMutationStates) ||
    allowedPreMutationStates.length === 0 ||
    allowedPreMutationStates.some(
      (state) => !["prior", "candidate"].includes(state),
    )
  ) {
    throw new Error("Allowed pre-mutation mapping states are malformed");
  }
  if (!["prior", "candidate"].includes(expectedVerifiedMappingState)) {
    throw new Error("Expected verified mapping state is malformed");
  }
  const assertPreMutationState = async (phase) => {
    let result;
    try {
      result = await inspectMutationState({
        phase,
        intent: clone(intent),
        transactionId: highest.transactionId,
      });
    } catch {
      throw new MainTransactionError(
        "Protected mapping state is unproven before mutation",
        {
          code: "PROTECTED_MAPPING_DRIFT",
          journal: highest,
        },
      );
    }
    if (!result || !allowedPreMutationStates.includes(result.mappingState)) {
      throw new MainTransactionError(
        "Protected mapping drifted before mutation",
        {
          code: "PROTECTED_MAPPING_DRIFT",
          journal: highest,
        },
      );
    }
  };
  if (requireFreshness) {
    await assertFresh(assertFreshness, "pre-operation", highest);
  }
  await assertPreMutationState("pre-operation");
  highest = startMainTransactionOperation(highest, intent);
  highest = await persistNext(highest);
  const operationId = highest.operations.at(-1).operationId;
  if (requireFreshness) {
    try {
      await assertFresh(assertFreshness, "pre-command", highest);
    } catch (error) {
      if (error instanceof MainTransactionError) error.journal = highest;
      throw error;
    }
  }
  try {
    await assertPreMutationState("pre-command");
  } catch (error) {
    if (error instanceof MainTransactionError) error.journal = highest;
    throw error;
  }
  let commandResult;
  try {
    commandResult = await executeMutation({
      operation: clone(highest.operations.at(-1)),
      transactionId: highest.transactionId,
    });
  } catch {
    commandResult = { outcome: "unknown" };
  }
  const outcome = commandResult?.outcome === "success" ? "success" : "unknown";
  highest = recordMainTransactionCommandReturned(highest, {
    operationId,
    outcome,
    candidate: commandResult?.candidate ?? null,
  });
  highest = await persistNext(highest);
  let freshnessError = null;
  if (requireFreshness) {
    try {
      await assertFresh(assertFreshness, "post-command", highest);
    } catch (error) {
      freshnessError = error;
    }
  }
  let mappingState = "unknown";
  try {
    const result = await verifyMapping({
      operation: clone(lastOperationEvent(highest, operationId)),
      transactionId: highest.transactionId,
    });
    if (result && MAPPING_STATES.includes(result.mappingState)) {
      mappingState = result.mappingState;
    }
  } catch {
    mappingState = "unknown";
  }
  if (freshnessError) mappingState = "unknown";
  highest = recordMainTransactionVerified(highest, {
    operationId,
    mappingState,
    rollbackState:
      intent.type === "ordinary_rollback" && mappingState === "prior"
        ? "entered"
        : null,
  });
  highest = await persistNext(highest);
  if (
    freshnessError ||
    outcome === "unknown" ||
    mappingState !== expectedVerifiedMappingState
  ) {
    throw new MainTransactionError(
      "Mutation outcome requires deterministic recovery",
      {
        code: freshnessError
          ? "SUPERSEDED_DURING_MUTATION"
          : outcome === "unknown"
            ? "MUTATION_OUTCOME_UNKNOWN"
            : "MUTATION_VERIFICATION_FAILED",
        journal: highest,
      },
    );
  }
  return highest;
}

function recoveryIntent(action) {
  if (action.kind === "ordinary_rollback") {
    return {
      type: "ordinary_rollback",
      target: action.target,
    };
  }
  throw new Error("Recovery action does not mutate a mapping");
}

export async function executeMainTransactionRecovery({
  plan,
  uploadJournal,
  ordinaryRollback,
  inspectMapping,
  verifyMapping,
}) {
  const canonicalPlan = assertMainTransactionRecoveryPlan(plan);
  let highest = canonicalPlan.journal;
  if (
    !["recover", "manual_intervention"].includes(canonicalPlan.decision) ||
    canonicalPlan.forceFailure === false
  ) {
    return highest;
  }
  let lastDurableJournal = highest;
  const persistNext = async (next) => {
    try {
      const persisted = await persistMainTransactionJournal(
        next,
        uploadJournal,
      );
      lastDurableJournal = persisted;
      return persisted;
    } catch (error) {
      if (error instanceof MainTransactionError) {
        error.journal = lastDurableJournal;
      }
      throw error;
    }
  };
  const mutationKinds = new Set(["ordinary_rollback"]);
  if (
    canonicalPlan.actions.length > 0 &&
    typeof inspectMapping !== "function"
  ) {
    throw new Error("Recovery mapping inspection adapter is required");
  }
  if (
    canonicalPlan.actions.some((entry) => mutationKinds.has(entry.kind)) &&
    typeof verifyMapping !== "function"
  ) {
    throw new Error("Recovery mapping verification adapter is required");
  }
  if (
    canonicalPlan.actions.some((entry) => mutationKinds.has(entry.kind)) &&
    typeof ordinaryRollback !== "function"
  ) {
    throw new Error("Recovery adapter for ordinary_rollback is required");
  }
  for (const entry of canonicalPlan.actions) {
    let inspected;
    try {
      inspected = await inspectMapping(clone(entry), {
        phase: "recovery-plan",
        transactionId: highest.transactionId,
      });
    } catch {
      inspected = null;
    }
    const mappingState = inspected?.mappingState;
    const expectedKind =
      mappingState === "prior"
        ? "verified_noop"
        : mappingState === "candidate"
          ? "ordinary_rollback"
          : ["partial", "unexpected"].includes(mappingState)
            ? "manual_intervention"
            : null;
    if (
      entry.kind !== expectedKind ||
      (entry.kind === "manual_intervention" &&
        entry.mappingState !== mappingState)
    ) {
      throw new MainTransactionError(
        "Recovery plan no longer matches protected mappings",
        {
          code: "PROTECTED_MAPPING_DRIFT",
          journal: highest,
        },
      );
    }
  }
  highest = startMainTransactionRecovery(highest);
  highest = await persistNext(highest);
  for (const entry of canonicalPlan.actions) {
    if (entry.kind === "verified_noop") continue;
    if (entry.kind === "manual_intervention") {
      continue;
    }
    highest = await executeJournaledMainMutation({
      journal: highest,
      intent: recoveryIntent(entry),
      uploadJournal,
      executeMutation: () => ordinaryRollback(clone(entry)),
      inspectMutationState: (context) => inspectMapping(clone(entry), context),
      allowedPreMutationStates: ["candidate"],
      expectedVerifiedMappingState: "prior",
      verifyMapping: (context) => verifyMapping(clone(entry), context),
      requireFreshness: false,
    });
    lastDurableJournal = highest;
  }
  if (canonicalPlan.decision === "recover") {
    for (const entry of canonicalPlan.actions) {
      let inspected;
      try {
        inspected = await inspectMapping(clone(entry), {
          phase: "recovery-final",
          transactionId: highest.transactionId,
        });
      } catch {
        inspected = null;
      }
      if (inspected?.mappingState !== "prior") {
        throw new MainTransactionError(
          "Recovered mapping no longer matches the captured prior",
          {
            code: "RECOVERY_VERIFICATION_FAILED",
            journal: highest,
          },
        );
      }
    }
  }
  highest = finishMainTransactionRecovery(highest, {
    manualIntervention: canonicalPlan.decision === "manual_intervention",
  });
  return persistNext(highest);
}

const MAIN_MUTATION_ADAPTERS = Object.freeze([
  "promote",
  "inspectMapping",
  "verifyMapping",
  "inspectProtectedMappings",
  "ordinaryRollback",
]);

function validateMainMutationAdapters(mutationAdapters) {
  if (
    !mutationAdapters ||
    typeof mutationAdapters !== "object" ||
    Array.isArray(mutationAdapters)
  ) {
    throw new Error("Mutation adapters are malformed");
  }
  for (const name of MAIN_MUTATION_ADAPTERS) {
    if (
      Object.hasOwn(mutationAdapters, name) &&
      typeof mutationAdapters[name] !== "function"
    ) {
      throw new Error(`Mutation adapter ${name} is malformed`);
    }
  }
  // An adapter this transaction has no operation for cannot be smuggled in.
  // The retired `assignAlias`, `restoreAppAlias`, and `deployAppV3` adapters
  // fail closed here rather than sitting unused next to the reviewed set.
  for (const name of Object.keys(mutationAdapters)) {
    if (!MAIN_MUTATION_ADAPTERS.includes(name)) {
      throw new Error(`Mutation adapter ${name} is not allowlisted`);
    }
  }
}

function requireMainMutationAdapter(mutationAdapters, name) {
  const adapter = mutationAdapters[name];
  if (typeof adapter !== "function") {
    throw new Error(`Mutation adapter ${name} is required`);
  }
  return adapter;
}

async function inspectActiveProtectedMappings({
  journal,
  inspectProtectedMappings,
  phase,
}) {
  let inspection;
  try {
    inspection = await inspectProtectedMappings({
      phase,
      deploySha: journal.deploySha,
      transactionId: journal.transactionId,
      journal: clone(journal),
    });
    assertExactKeys(
      inspection,
      ["currentMappings"],
      "Protected mapping inspection",
    );
    return canonicalAllCurrentMappings(journal, inspection.currentMappings);
  } catch {
    throw new MainTransactionError(
      "Complete protected mapping state is unproven",
      {
        code: "PROTECTED_MAPPING_DRIFT",
        journal,
      },
    );
  }
}

async function assertActiveFinalMappings({
  journal,
  inspectProtectedMappings,
}) {
  const mappings = await inspectActiveProtectedMappings({
    journal,
    inspectProtectedMappings,
    phase: "transaction-commit",
  });
  for (const target of PROTECTED_TARGETS) {
    const expected =
      journal.candidates[target] === null
        ? journal.prior[target]
        : journal.candidates[target];
    if (
      expected?.deploymentId === null ||
      journal.prior[target].aliases.some(
        (alias) => !sameDeployment(mappings.get(alias), expected),
      )
    ) {
      throw new MainTransactionError(
        "Final protected mappings do not match the transaction",
        {
          code: "FINAL_MAPPING_VERIFICATION_FAILED",
          journal,
        },
      );
    }
  }
}

export async function runMainTransaction({
  mode = MAIN_TRANSACTION_MODE,
  identity,
  release,
  prior,
  startMappings,
  candidates,
  existingJournals = [],
  assertFreshness,
  uploadJournal,
  inspectRecoveryState,
  mutationAdapters = {},
}) {
  if (!MODES.includes(mode)) throw new Error("Transaction mode is unsupported");
  validateMainMutationAdapters(mutationAdapters);
  const prepared = createPreparedMainTransactionJournal({
    ...identity,
    mode,
    release,
    prior,
    startMappings,
    candidates,
  });
  const selectedPromoteTargets = PROMOTABLE_TARGETS.filter(
    (target) => prepared.candidates[target] !== null,
  );
  let promote;
  let inspectMapping;
  let verifyMapping;
  let inspectProtectedMappings;
  if (mode === "active") {
    if (selectedPromoteTargets.length > 0) {
      promote = requireMainMutationAdapter(mutationAdapters, "promote");
      inspectMapping = requireMainMutationAdapter(
        mutationAdapters,
        "inspectMapping",
      );
      verifyMapping = requireMainMutationAdapter(
        mutationAdapters,
        "verifyMapping",
      );
    }
    inspectProtectedMappings = requireMainMutationAdapter(
      mutationAdapters,
      "inspectProtectedMappings",
    );
  }
  await assertFresh(assertFreshness, "transaction-start", prepared);
  let journals;
  let persisted;
  if (existingJournals.length === 0) {
    persisted = await persistMainTransactionJournal(prepared, uploadJournal);
    journals = [persisted];
  } else {
    journals = assertMainTransactionJournalHistory(existingJournals, {
      repository: prepared.repository,
      deploySha: prepared.deploySha,
      runId: prepared.runId,
      runAttempt: prepared.runAttempt,
      transactionId: prepared.transactionId,
      mode,
    });
    if (!sameJson(journals[0], prepared)) {
      throw new Error(
        "Existing journal history does not begin with this preparation",
      );
    }
    persisted = journals.at(-1);
  }
  const decision = decideMainTransactionRecovery(journals, {
    repository: persisted.repository,
    deploySha: persisted.deploySha,
    runId: persisted.runId,
    runAttempt: persisted.runAttempt,
    transactionId: persisted.transactionId,
    mode,
  });
  if (typeof inspectRecoveryState === "function") {
    await inspectRecoveryState({
      decision: decision.decision,
      reason: decision.reason,
      transactionId: persisted.transactionId,
    });
  }
  if (mode === "shadow") {
    return {
      mode,
      outcome: "shadow-prepared",
      journal: persisted,
      recoveryDecision: {
        decision: decision.decision,
        reason: decision.reason,
      },
      mutationCallbacksCalled: 0,
    };
  }

  if (decision.decision === "bypass" && decision.reason === "committed") {
    await assertActiveFinalMappings({
      journal: persisted,
      inspectProtectedMappings,
    });
    return {
      mode,
      outcome: "active-committed",
      journal: persisted,
      recoveryDecision: {
        decision: decision.decision,
        reason: decision.reason,
      },
      mutationCallbacksCalled: 0,
    };
  }
  if (decision.decision !== "verify-only") {
    throw new MainTransactionError(
      "Existing transaction requires recovery before activation can continue",
      {
        code:
          decision.decision === "manual_intervention"
            ? "MANUAL_INTERVENTION_REQUIRED"
            : decision.reason === "already-recovered"
              ? "TRANSACTION_ALREADY_RECOVERED"
              : "RECOVERY_REQUIRED",
        journal: persisted,
      },
    );
  }

  let highest = persisted;
  let lastDurableJournal = highest;
  let mutationCallbacksCalled = 0;
  const persistNext = async (next) => {
    try {
      const durable = await persistMainTransactionJournal(next, uploadJournal);
      lastDurableJournal = durable;
      return durable;
    } catch (error) {
      if (error instanceof MainTransactionError) {
        error.journal = lastDurableJournal;
      }
      throw error;
    }
  };
  const executeActiveMutation = async ({
    intent,
    executeMutation,
    allowedPreMutationStates = ["prior"],
  }) => {
    highest = await executeJournaledMainMutation({
      journal: highest,
      intent,
      uploadJournal,
      assertFreshness,
      allowedPreMutationStates,
      expectedVerifiedMappingState: expectedVerifiedMappingStateFor(intent),
      inspectMutationState: inspectMapping,
      executeMutation: async (context) => {
        mutationCallbacksCalled += 1;
        return executeMutation(context);
      },
      verifyMapping,
    });
    lastDurableJournal = highest;
  };

  for (const target of selectedPromoteTargets) {
    await executeActiveMutation({
      intent: { type: "promote", target },
      executeMutation: promote,
    });
  }
  await assertFresh(assertFreshness, "transaction-commit", highest);
  await assertActiveFinalMappings({
    journal: highest,
    inspectProtectedMappings,
  });
  highest = await persistNext(markMainTransactionCommitted(highest));
  return {
    mode,
    outcome: "active-committed",
    journal: highest,
    recoveryDecision: {
      decision: "bypass",
      reason: "committed",
    },
    mutationCallbacksCalled,
  };
}
