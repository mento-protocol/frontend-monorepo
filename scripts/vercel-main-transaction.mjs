#!/usr/bin/env node

import { createHash } from "node:crypto";

import {
  canonicalizeDeploymentUrl,
  canonicalizeHostname,
} from "./vercel-deployment-state.mjs";

export const MAIN_TRANSACTION_SCHEMA = 1;
export const MAIN_TRANSACTION_REPOSITORY = "mento-protocol/frontend-monorepo";
export const MAIN_TRANSACTION_MODE = "shadow";

const SHA_PATTERN = /^[a-f0-9]{40}$/;
const NUMERIC_ID_PATTERN = /^[1-9][0-9]*$/;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9._-]+$/;
const DEPLOYMENT_ID_PATTERN = /^dpl_[A-Za-z0-9]+$/;
const TRANSACTION_ID_PATTERN = /^main-[a-f0-9]{32}$/;
const ORDINARY_TARGETS = Object.freeze(["governance", "reserve", "ui"]);
const PROTECTED_TARGETS = Object.freeze([
  "app",
  "governance",
  "reserve",
  "ui",
  "legacy-app",
]);
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
const OPERATION_TYPES = Object.freeze([
  "promote",
  "app_v3_deploy",
  "app_alias_set",
  "ordinary_rollback",
  "app_alias_restore",
  "legacy_emergency_restore",
]);
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
  "prior",
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
  "projectId",
  "projectName",
  "deploySha",
  "runId",
  "runAttempt",
  "transactionId",
  "customEnvironmentSlug",
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
const APP_CANDIDATE_MATCH_KEYS = Object.freeze([
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
const RECOVERY_PLAN_KEYS = Object.freeze([
  "decision",
  "reason",
  "journal",
  "actions",
  "rollbackStateTargets",
  "forceFailure",
  "discoveredAppCandidate",
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

function canonicalDiscovery(discovery, identity, label) {
  assertExactKeys(discovery, DISCOVERY_KEYS, label);
  const canonical = {
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
    runId: requireNumericId(discovery.runId, `${label} run ID`),
    runAttempt: requireNumericId(discovery.runAttempt, `${label} run attempt`),
    transactionId: requireString(
      discovery.transactionId,
      `${label} transaction ID`,
      TRANSACTION_ID_PATTERN,
    ),
    customEnvironmentSlug: discovery.customEnvironmentSlug,
  };
  if (canonical.customEnvironmentSlug !== "v3") {
    throw new Error(`${label} custom environment must be v3`);
  }
  if (
    canonical.deploySha !== identity.deploySha ||
    canonical.runId !== identity.runId ||
    canonical.runAttempt !== identity.runAttempt ||
    canonical.transactionId !== identity.transactionId
  ) {
    throw new Error(`${label} does not match the journal identity`);
  }
  return canonical;
}

function canonicalCandidateRecord(record, target, identity, prior) {
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
  if (target !== "app" && deploymentId === null) {
    throw new Error(`${label} must identify the staged deployment`);
  }
  if (target === "app" && record.discovery === null) {
    throw new Error("Candidate app discovery metadata is required");
  }
  if (target !== "app" && record.discovery !== null) {
    throw new Error(`${label} must not contain app discovery metadata`);
  }
  const aliases = canonicalAliases(record.aliases, `${label} aliases`);
  if (JSON.stringify(aliases) !== JSON.stringify(prior.aliases)) {
    throw new Error(`${label} aliases differ from the captured prior aliases`);
  }
  return {
    deploymentId,
    deploymentUrl,
    aliases,
    discovery:
      target === "app"
        ? canonicalDiscovery(record.discovery, identity, `${label} discovery`)
        : null,
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

function canonicalCandidates(candidates, identity, prior) {
  assertOrderedExactKeys(
    candidates,
    CANDIDATE_TARGETS,
    "Journal candidate state",
  );
  return Object.fromEntries(
    CANDIDATE_TARGETS.map((target) => [
      target,
      canonicalCandidateRecord(
        candidates[target],
        target,
        identity,
        prior[target],
      ),
    ]),
  );
}

function assertOperationTarget(type, target, alias, journal) {
  const isOrdinary = ORDINARY_TARGETS.includes(target);
  if (
    (type === "promote" || type === "ordinary_rollback") &&
    (!isOrdinary || alias !== null)
  ) {
    throw new Error(`${type} must bind one ordinary target without an alias`);
  }
  if (type === "app_v3_deploy" && (target !== "app" || alias !== null)) {
    throw new Error("app_v3_deploy must bind the app target");
  }
  if (
    (type === "app_alias_set" || type === "app_alias_restore") &&
    (target !== "app" ||
      alias === null ||
      !journal.prior.app.aliases.includes(alias))
  ) {
    throw new Error(`${type} must bind one reviewed app-v3 alias`);
  }
  if (
    type === "legacy_emergency_restore" &&
    (target !== "legacy-app" ||
      alias === null ||
      !journal.prior["legacy-app"].aliases.includes(alias))
  ) {
    throw new Error(
      "legacy_emergency_restore must bind a captured legacy alias",
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
  if (candidateDeploymentId === null && operation.type !== "app_v3_deploy") {
    throw new Error("Only app_v3_deploy may start before candidate discovery");
  }
  const expectedCandidate =
    operation.target === "legacy-app"
      ? journal.candidates.app
      : journal.candidates[operation.target];
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
  const candidate =
    target === "legacy-app"
      ? journal.candidates.app
      : journal.candidates[target];
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
    if (target !== "app") {
      throw new Error("Journal candidates changed after preparation");
    }
    const before = previous.app;
    const after = current.app;
    if (
      before === null ||
      after === null ||
      before.deploymentId !== null ||
      before.deploymentUrl !== null ||
      after.deploymentId === null ||
      after.deploymentUrl === null ||
      !sameJson(before.aliases, after.aliases) ||
      !sameJson(before.discovery, after.discovery)
    ) {
      throw new Error("App candidate evolution is not monotonic");
    }
  }
}

function statusOnlyTransitionAllowed(previous, current) {
  const transitions = {
    prepared: new Set(["committed"]),
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
      ["promote", "app_v3_deploy", "app_alias_set"].includes(operation.type),
  );
  return starts;
}

function isOperationVerified(journal, operationId) {
  const last = lastOperationEvent(journal, operationId);
  return (
    last.state === "verified" &&
    last.commandOutcome === "success" &&
    last.mappingState === "candidate"
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
  prior,
  candidates,
}) {
  const identity = canonicalIdentity({
    repository,
    deploySha,
    runId,
    runAttempt,
  });
  if (!MODES.includes(mode)) throw new Error("Journal mode is unsupported");
  const canonicalPriorState = canonicalPrior(prior);
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
    prior: canonicalPriorState,
    candidates: canonicalCandidates(candidates, identity, canonicalPriorState),
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
    prior,
    candidates: canonicalCandidates(journal.candidates, identity, prior),
    operations: [],
  };
  canonical.operations = canonicalOperations(journal.operations, canonical);
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (!Object.hasOwn(canonical, key) || canonical[key] !== expectedValue) {
      throw new Error(`Journal ${key} does not match the expected identity`);
    }
  }
  return canonical;
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
  const resolved = operationIntent(canonical, intent);
  const forwardStarts = startedForwardOperations(canonical);
  if (
    (resolved.type === "promote" &&
      forwardStarts.some(
        (operation) =>
          operation.type === "promote" && operation.target === resolved.target,
      )) ||
    (resolved.type === "app_v3_deploy" &&
      forwardStarts.some((operation) => operation.type === "app_v3_deploy")) ||
    (resolved.type === "app_alias_set" &&
      forwardStarts.some(
        (operation) =>
          operation.type === "app_alias_set" &&
          operation.alias === resolved.alias,
      ))
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
  let canonical = assertMainTransactionJournal(journal);
  const previous = lastOperationEvent(canonical, operationId);
  if (previous.state !== "started") {
    throw new Error("Operation is not waiting for a command result");
  }
  if (!["success", "unknown"].includes(outcome)) {
    throw new Error("Command result must be success or unknown");
  }
  if (candidate !== null) {
    if (previous.type !== "app_v3_deploy") {
      throw new Error("Only app_v3_deploy may discover a candidate");
    }
    const app = canonical.candidates.app;
    if (app === null) {
      throw new Error("The transaction did not prepare an app candidate");
    }
    const discovered = canonicalizeAppCandidateMatch(candidate, app.discovery);
    if (
      app.deploymentId !== null &&
      (app.deploymentId !== discovered.deploymentId ||
        app.deploymentUrl !== discovered.deploymentUrl)
    ) {
      throw new Error("App candidate conflicts with the journal");
    }
    canonical = {
      ...canonical,
      candidates: {
        ...canonical.candidates,
        app: {
          ...app,
          deploymentId: discovered.deploymentId,
          deploymentUrl: discovered.deploymentUrl,
        },
      },
    };
  }
  const appCandidate = canonical.candidates.app;
  const candidateIdentity =
    previous.type === "app_v3_deploy" && appCandidate?.deploymentId
      ? {
          candidateDeploymentId: appCandidate.deploymentId,
          candidateDeploymentUrl: appCandidate.deploymentUrl,
        }
      : {};
  return appendOperationEvent(canonical, previous, {
    ...candidateIdentity,
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

export function attachDiscoveredAppCandidate(journal, match) {
  const canonical = assertMainTransactionJournal(journal);
  if (canonical.candidates.app === null) {
    throw new Error("The transaction did not prepare an app candidate");
  }
  const candidate = canonicalizeAppCandidateMatch(
    match,
    canonical.candidates.app.discovery,
  );
  if (
    canonical.candidates.app.deploymentId !== null &&
    (canonical.candidates.app.deploymentId !== candidate.deploymentId ||
      canonical.candidates.app.deploymentUrl !== candidate.deploymentUrl)
  ) {
    throw new Error("App candidate conflicts with the journal");
  }
  if (canonical.candidates.app.deploymentId !== null) return canonical;
  return nextJournal(canonical, {
    candidates: {
      ...canonical.candidates,
      app: {
        ...canonical.candidates.app,
        deploymentId: candidate.deploymentId,
        deploymentUrl: candidate.deploymentUrl,
      },
    },
  });
}

function canonicalizeAppCandidateMatch(match, discovery) {
  assertExactKeys(match, APP_CANDIDATE_MATCH_KEYS, "App candidate match");
  const canonical = {
    deploymentId: requireDeploymentId(
      match.deploymentId,
      "App candidate deployment ID",
    ),
    deploymentUrl: canonicalizeDeploymentUrl(match.deploymentUrl),
    projectId: requireString(
      match.projectId,
      "App candidate project ID",
      IDENTIFIER_PATTERN,
    ),
    projectName: requireString(
      match.projectName,
      "App candidate project name",
      IDENTIFIER_PATTERN,
    ),
    deploySha: requireString(
      match.deploySha,
      "App candidate deploy SHA",
      SHA_PATTERN,
    ),
    runId: requireNumericId(match.runId, "App candidate run ID"),
    runAttempt: requireNumericId(match.runAttempt, "App candidate run attempt"),
    transactionId: requireString(
      match.transactionId,
      "App candidate transaction ID",
      TRANSACTION_ID_PATTERN,
    ),
    customEnvironmentSlug: match.customEnvironmentSlug,
  };
  for (const key of DISCOVERY_KEYS) {
    if (canonical[key] !== discovery[key]) {
      throw new Error(`App candidate ${key} does not match discovery metadata`);
    }
  }
  return canonical;
}

export function resolveUniqueAppTransactionCandidate(journal, matches) {
  const canonical = assertMainTransactionJournal(journal);
  const app = canonical.candidates.app;
  if (app === null) throw new Error("The transaction has no app candidate");
  if (app.deploymentId !== null) {
    if (matches !== undefined && (!Array.isArray(matches) || matches.length)) {
      throw new Error("Known app candidate must not be rediscovered");
    }
    return app;
  }
  if (!Array.isArray(matches)) {
    throw new Error("App candidate discovery results must be an array");
  }
  const canonicalMatches = matches.map((match) =>
    canonicalizeAppCandidateMatch(match, app.discovery),
  );
  if (canonicalMatches.length !== 1) {
    throw new Error(
      `App candidate discovery must return exactly one match; received ${canonicalMatches.length}`,
    );
  }
  return {
    ...app,
    deploymentId: canonicalMatches[0].deploymentId,
    deploymentUrl: canonicalMatches[0].deploymentUrl,
  };
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
    if (appendedEvents === 0) {
      const isCandidateAttachment =
        candidateChanged && journal.status === previous.status;
      const isStatusOnlyTransition =
        !candidateChanged &&
        statusOnlyTransitionAllowed(previous.status, journal.status);
      if (!isCandidateAttachment && !isStatusOnlyTransition) {
        throw new Error("Journal snapshot did not append one legal event");
      }
      continue;
    }
    if (appendedEvents !== 1) {
      throw new Error("Journal snapshot batched operation events");
    }
    const appended = journal.operations.at(-1);
    if (journal.status !== appended.state) {
      throw new Error("Journal status does not match its appended operation");
    }
    const expectedPreviousStatuses = {
      started: new Set(["prepared", "verified", "recovering"]),
      command_returned: new Set(["started"]),
      verified: new Set(["command_returned"]),
    };
    if (!expectedPreviousStatuses[appended.state].has(previous.status)) {
      throw new Error("Journal operation append is invalid for its status");
    }
    if (
      candidateChanged &&
      (appended.type !== "app_v3_deploy" ||
        appended.state !== "command_returned")
    ) {
      throw new Error(
        "App candidate attachment must accompany its command-return event",
      );
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
  const selectedOperations = [
    ...ORDINARY_TARGETS.filter(
      (target) => canonical.candidates[target] !== null,
    ).map((target) => ({ target, type: "promote" })),
    ...(canonical.candidates.app === null
      ? []
      : [{ target: "app", type: "app_v3_deploy" }]),
  ];
  // App alias completeness is owned by the final protected-mapping verifier.
  // The journal commit gate binds the selected immutable deployment itself.
  const selectedOperationsVerified = selectedOperations.every(
    ({ target, type }) => {
      if (
        type === "app_v3_deploy" &&
        canonical.candidates.app.deploymentId === null
      ) {
        return false;
      }
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
  const candidate =
    target === "legacy-app"
      ? journal.candidates.app
      : journal.candidates[target];
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

export function planMainTransactionRecovery({
  journal,
  currentMappings,
  appCandidateMatches = [],
}) {
  let canonical = assertMainTransactionJournal(journal);
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
      discoveredAppCandidate: null,
    };
  }
  const mappings = canonicalAllCurrentMappings(canonical, currentMappings);
  const starts = startedForwardOperations(canonical);
  const appWasStarted = starts.some(
    (operation) => operation.type === "app_v3_deploy",
  );
  let appCandidate = canonical.candidates.app;
  let discoveredAppCandidate = null;
  if (appWasStarted && appCandidate?.deploymentId === null) {
    const appAliasesMoved = canonical.prior.app.aliases.some(
      (alias) => !sameDeployment(mappings.get(alias), canonical.prior.app),
    );
    const legacyMoved = canonical.prior["legacy-app"].aliases.some(
      (alias) =>
        !sameDeployment(mappings.get(alias), canonical.prior["legacy-app"]),
    );
    if (appAliasesMoved || legacyMoved) {
      try {
        appCandidate = resolveUniqueAppTransactionCandidate(
          canonical,
          appCandidateMatches,
        );
        discoveredAppCandidate = {
          deploymentId: appCandidate.deploymentId,
          deploymentUrl: appCandidate.deploymentUrl,
          ...appCandidate.discovery,
        };
      } catch {
        return {
          decision: "manual_intervention",
          reason: "app-candidate-ambiguous-after-mapping-moved",
          journal: canonical,
          actions: [],
          rollbackStateTargets: [],
          forceFailure: true,
          discoveredAppCandidate: null,
        };
      }
    }
  }
  const recoveryJournal =
    discoveredAppCandidate === null
      ? canonical
      : attachDiscoveredAppCandidate(canonical, discoveredAppCandidate);
  const actions = [];
  const handledOrdinaryTargets = new Set();
  const handledAppAliases = new Set();
  let legacyHandled = false;
  let manual = false;
  let emergencyLegacyRestore = false;
  for (const operation of [...starts].reverse()) {
    if (operation.type === "promote") {
      if (handledOrdinaryTargets.has(operation.target)) continue;
      handledOrdinaryTargets.add(operation.target);
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
      } else if (mappingState === "candidate") {
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
    if (
      operation.type === "app_alias_set" &&
      !handledAppAliases.has(operation.alias)
    ) {
      handledAppAliases.add(operation.alias);
      const mapping = mappings.get(operation.alias);
      if (sameDeployment(mapping, canonical.prior.app)) {
        actions.push(
          action("verified_noop", recoveryJournal, operation, {
            alias: operation.alias,
            mappingState: "prior",
          }),
        );
      } else if (
        appCandidate?.deploymentId &&
        sameDeployment(mapping, appCandidate)
      ) {
        actions.push(
          action("app_alias_restore", recoveryJournal, operation, {
            alias: operation.alias,
          }),
        );
      } else {
        manual = true;
        actions.push(
          action("manual_intervention", recoveryJournal, operation, {
            alias: operation.alias,
            mappingState: "unexpected",
          }),
        );
      }
      continue;
    }
    if (operation.type === "app_v3_deploy") {
      for (const alias of [...canonical.prior.app.aliases].reverse()) {
        if (handledAppAliases.has(alias)) continue;
        handledAppAliases.add(alias);
        const mapping = mappings.get(alias);
        if (sameDeployment(mapping, canonical.prior.app)) {
          actions.push(
            action("verified_noop", recoveryJournal, operation, {
              alias,
              mappingState: "prior",
            }),
          );
        } else if (
          appCandidate?.deploymentId &&
          sameDeployment(mapping, appCandidate)
        ) {
          actions.push(
            action("app_alias_restore", recoveryJournal, operation, {
              alias,
            }),
          );
        } else {
          manual = true;
          actions.push(
            action("manual_intervention", recoveryJournal, operation, {
              alias,
              mappingState: "unexpected",
            }),
          );
        }
      }
      if (!legacyHandled) {
        legacyHandled = true;
        for (const alias of canonical.prior["legacy-app"].aliases) {
          const mapping = mappings.get(alias);
          if (sameDeployment(mapping, canonical.prior["legacy-app"])) {
            actions.push(
              action("verified_noop", recoveryJournal, operation, {
                target: "legacy-app",
                alias,
                mappingState: "prior",
              }),
            );
          } else if (
            appCandidate?.deploymentId &&
            sameDeployment(mapping, appCandidate)
          ) {
            emergencyLegacyRestore = true;
            actions.push(
              action("legacy_emergency_restore", recoveryJournal, operation, {
                target: "legacy-app",
                alias,
              }),
            );
          } else {
            manual = true;
            actions.push(
              action("manual_intervention", recoveryJournal, operation, {
                target: "legacy-app",
                alias,
                mappingState: "unexpected",
              }),
            );
          }
        }
      }
    }
  }
  return {
    decision: manual ? "manual_intervention" : "recover",
    reason: manual
      ? "unexpected-protected-mapping"
      : emergencyLegacyRestore
        ? "legacy-alias-moved-to-transaction-candidate"
        : "started-operations-require-verification-or-recovery",
    journal: canonical,
    actions,
    rollbackStateTargets: actions
      .filter((entry) => entry.kind === "ordinary_rollback")
      .map((entry) => entry.target),
    forceFailure: true, // Recovery never converts a failed activation into a green release.
    discoveredAppCandidate,
  };
}

function recoveryActionSlots(journal) {
  const slots = [];
  const handledOrdinaryTargets = new Set();
  const handledAppAliases = new Set();
  let legacyHandled = false;
  for (const operation of [...startedForwardOperations(journal)].reverse()) {
    if (operation.type === "promote") {
      if (handledOrdinaryTargets.has(operation.target)) continue;
      handledOrdinaryTargets.add(operation.target);
      slots.push({
        category: "ordinary",
        target: operation.target,
        alias: null,
        operation,
      });
      continue;
    }
    if (
      operation.type === "app_alias_set" &&
      !handledAppAliases.has(operation.alias)
    ) {
      handledAppAliases.add(operation.alias);
      slots.push({
        category: "app",
        target: "app",
        alias: operation.alias,
        operation,
      });
      continue;
    }
    if (operation.type !== "app_v3_deploy") continue;
    for (const alias of [...journal.prior.app.aliases].reverse()) {
      if (handledAppAliases.has(alias)) continue;
      handledAppAliases.add(alias);
      slots.push({
        category: "app",
        target: "app",
        alias,
        operation,
      });
    }
    if (legacyHandled) continue;
    legacyHandled = true;
    for (const alias of journal.prior["legacy-app"].aliases) {
      slots.push({
        category: "legacy",
        target: "legacy-app",
        alias,
        operation,
      });
    }
  }
  return slots;
}

function canonicalRecoveryAction(entry, slot, journal, index) {
  const label = `Recovery action ${index + 1}`;
  const allowedKinds = {
    ordinary: new Set([
      "verified_noop",
      "manual_intervention",
      "ordinary_rollback",
    ]),
    app: new Set(["verified_noop", "manual_intervention", "app_alias_restore"]),
    legacy: new Set([
      "verified_noop",
      "manual_intervention",
      "legacy_emergency_restore",
    ]),
  };
  if (!allowedKinds[slot.category].has(entry?.kind)) {
    throw new Error(`${label} kind does not match its recovery slot`);
  }
  const hasAlias = slot.alias !== null;
  const expectedKeys =
    entry.kind === "ordinary_rollback"
      ? [...RECOVERY_ACTION_BASE_KEYS, "aliases", "entersRollbackState"]
      : entry.kind === "app_alias_restore" ||
          entry.kind === "legacy_emergency_restore"
        ? [...RECOVERY_ACTION_BASE_KEYS, "alias"]
        : [
            ...RECOVERY_ACTION_BASE_KEYS,
            ...(hasAlias ? ["alias"] : []),
            "mappingState",
          ];
  assertExactKeys(entry, expectedKeys, label);

  const expected = action(entry.kind, journal, slot.operation, {
    target: slot.target,
  });
  for (const key of RECOVERY_ACTION_BASE_KEYS.slice(1)) {
    if (entry[key] !== expected[key]) {
      throw new Error(`${label} ${key} differs from the journal`);
    }
  }
  if (hasAlias && entry.alias !== slot.alias) {
    throw new Error(`${label} alias differs from the recovery order`);
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
  if (
    entry.kind === "app_alias_restore" ||
    entry.kind === "legacy_emergency_restore"
  ) {
    if (expected.candidateDeploymentId === null) {
      throw new Error(`${label} cannot restore an unknown app candidate`);
    }
    return { ...expected, alias: slot.alias };
  }

  const allowedMappingStates =
    entry.kind === "verified_noop"
      ? new Set(["prior"])
      : slot.category === "ordinary"
        ? new Set(["partial", "unexpected"])
        : new Set(["unexpected"]);
  if (!allowedMappingStates.has(entry.mappingState)) {
    throw new Error(`${label} mapping state is inconsistent with its kind`);
  }
  return {
    ...expected,
    ...(hasAlias ? { alias: slot.alias } : {}),
    mappingState: entry.mappingState,
  };
}

function assertMainTransactionRecoveryPlan(plan) {
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
      plan.forceFailure !== false ||
      plan.discoveredAppCandidate !== null
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
      discoveredAppCandidate: null,
    };
  }

  let effectiveJournal = journal;
  let discoveredAppCandidate = null;
  if (plan.discoveredAppCandidate !== null) {
    if (journal.candidates.app?.deploymentId !== null) {
      throw new Error("Known app candidate must not be rediscovered");
    }
    effectiveJournal = attachDiscoveredAppCandidate(
      journal,
      plan.discoveredAppCandidate,
    );
    discoveredAppCandidate = {
      deploymentId: effectiveJournal.candidates.app.deploymentId,
      deploymentUrl: effectiveJournal.candidates.app.deploymentUrl,
      ...effectiveJournal.candidates.app.discovery,
    };
  }

  const isAmbiguousAppCandidate =
    plan.decision === "manual_intervention" &&
    plan.reason === "app-candidate-ambiguous-after-mapping-moved" &&
    Array.isArray(plan.actions) &&
    plan.actions.length === 0;
  if (isAmbiguousAppCandidate) {
    const unknownStartedApp =
      journal.candidates.app?.deploymentId === null &&
      startedForwardOperations(journal).some(
        (operation) => operation.type === "app_v3_deploy",
      );
    if (
      !unknownStartedApp ||
      !Array.isArray(plan.rollbackStateTargets) ||
      plan.rollbackStateTargets.length !== 0 ||
      plan.forceFailure !== true ||
      plan.discoveredAppCandidate !== null
    ) {
      throw new Error("Ambiguous app recovery plan is malformed");
    }
    return {
      decision: "manual_intervention",
      reason: "app-candidate-ambiguous-after-mapping-moved",
      journal,
      actions: [],
      rollbackStateTargets: [],
      forceFailure: true,
      discoveredAppCandidate: null,
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
    canonicalRecoveryAction(entry, slots[index], effectiveJournal, index),
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
  const hasLegacyEmergency = actions.some(
    (entry) => entry.kind === "legacy_emergency_restore",
  );
  const decision = hasManualAction ? "manual_intervention" : "recover";
  const reason = hasManualAction
    ? "unexpected-protected-mapping"
    : hasLegacyEmergency
      ? "legacy-alias-moved-to-transaction-candidate"
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
    discoveredAppCandidate,
  };
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
  if (action.kind === "app_alias_restore") {
    return {
      type: "app_alias_restore",
      target: "app",
      alias: action.alias,
    };
  }
  if (action.kind === "legacy_emergency_restore") {
    return {
      type: "legacy_emergency_restore",
      target: "legacy-app",
      alias: action.alias,
    };
  }
  throw new Error("Recovery action does not mutate a mapping");
}

export async function executeMainTransactionRecovery({
  plan,
  uploadJournal,
  ordinaryRollback,
  restoreAppAlias,
  restoreLegacyAlias,
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
  const mutationKinds = new Set([
    "ordinary_rollback",
    "app_alias_restore",
    "legacy_emergency_restore",
  ]);
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
  for (const [kind, adapter] of [
    ["ordinary_rollback", ordinaryRollback],
    ["app_alias_restore", restoreAppAlias],
    ["legacy_emergency_restore", restoreLegacyAlias],
  ]) {
    if (
      canonicalPlan.actions.some((entry) => entry.kind === kind) &&
      typeof adapter !== "function"
    ) {
      throw new Error(`Recovery adapter for ${kind} is required`);
    }
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
          ? entry.target === "legacy-app"
            ? "legacy_emergency_restore"
            : entry.target === "app"
              ? "app_alias_restore"
              : "ordinary_rollback"
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
  if (
    canonicalPlan.discoveredAppCandidate &&
    highest.candidates.app?.deploymentId === null
  ) {
    highest = attachDiscoveredAppCandidate(
      highest,
      canonicalPlan.discoveredAppCandidate,
    );
    highest = await persistNext(highest);
  }
  highest = appendStatus(highest, "recovering");
  highest = await persistNext(highest);
  for (const entry of canonicalPlan.actions) {
    if (entry.kind === "verified_noop") continue;
    if (entry.kind === "manual_intervention") {
      continue;
    }
    const adapter =
      entry.kind === "ordinary_rollback"
        ? ordinaryRollback
        : entry.kind === "app_alias_restore"
          ? restoreAppAlias
          : restoreLegacyAlias;
    highest = await executeJournaledMainMutation({
      journal: highest,
      intent: recoveryIntent(entry),
      uploadJournal,
      executeMutation: () => adapter(clone(entry)),
      inspectMutationState: (context) => inspectMapping(clone(entry), context),
      allowedPreMutationStates: ["candidate"],
      expectedVerifiedMappingState: "prior",
      verifyMapping: (context) => verifyMapping(clone(entry), context),
      requireFreshness: false,
    });
    lastDurableJournal = highest;
  }
  highest = appendStatus(
    highest,
    canonicalPlan.decision === "manual_intervention"
      ? "manual_intervention"
      : "recovered",
  );
  return persistNext(highest);
}

export async function runMainTransaction({
  mode = MAIN_TRANSACTION_MODE,
  identity,
  prior,
  candidates,
  existingJournals = [],
  assertFreshness,
  uploadJournal,
  inspectRecoveryState,
  mutationAdapters = {},
}) {
  if (mode !== "shadow") {
    throw new Error(
      "Active Vercel main transaction execution is unreachable in PR A",
    );
  }
  const forbiddenAdapters = [
    "promote",
    "deployAppV3",
    "assignAlias",
    "ordinaryRollback",
    "restoreAppAlias",
    "restoreLegacyAlias",
  ];
  for (const name of forbiddenAdapters) {
    if (
      Object.hasOwn(mutationAdapters, name) &&
      typeof mutationAdapters[name] !== "function"
    ) {
      throw new Error(`Mutation adapter ${name} is malformed`);
    }
  }
  const prepared = createPreparedMainTransactionJournal({
    ...identity,
    mode,
    prior,
    candidates,
  });
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
      mode: "shadow",
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
    mode: "shadow",
  });
  if (typeof inspectRecoveryState === "function") {
    await inspectRecoveryState({
      decision: decision.decision,
      reason: decision.reason,
      transactionId: persisted.transactionId,
    });
  }
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
