#!/usr/bin/env node

import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { join, relative, sep } from "node:path";

import {
  assertMainTransactionJournal,
  assertMainTransactionJournalHistory,
  assertMainTransactionRecoveryPlan,
  attachDiscoveredAppCandidate,
  classifyMainTransactionMapping,
  finishMainTransactionRecovery,
  mainTransactionJournalArtifactName,
  markMainTransactionCommitted,
  recordMainTransactionCommandReturned,
  recordMainTransactionVerified,
  resolveUniqueAppTransactionCandidate,
  startMainTransactionOperation,
  startMainTransactionRecovery,
} from "./vercel-main-transaction.mjs";
import {
  assertMainActiveCommandDescriptor,
  assertMainActiveCommandResult,
  buildMainActiveAppAliasRestoreCommand,
  buildMainActiveAppAliasSetCommand,
  buildMainActiveAppDeployCommand,
  buildMainActiveLegacyAliasRestoreCommand,
  buildMainActivePromotionCommand,
  buildMainActiveRollbackCommand,
} from "./vercel-main-active.mjs";
import {
  assertActiveDeploymentStateProof,
  canonicalizeDeploymentUrl,
  canonicalizeHostname,
} from "./vercel-deployment-state.mjs";
import { generateVercelDeploymentId } from "./vercel-prebuilt.mjs";

export const MAIN_ACTIVE_EVENT_SCHEMA = "vercel-main-active-event:v1";
export const MAIN_ACTIVE_RECOVERY_EVENT_SCHEMA =
  "vercel-main-active-recovery-event:v1";
const MAIN_ACTIVE_TRANSITION_SCHEMA = "vercel-main-active-transition:v1";
export const MAIN_ACTIVE_HISTORY_SCHEMA =
  "vercel-main-active-journal-history:v1";

const SHA_PATTERN = /^[a-f0-9]{40}$/;
const DEPLOYMENT_ID_PATTERN = /^dpl_[A-Za-z0-9]+$/;
const POSITIVE_ID_PATTERN = /^[1-9][0-9]*$/;
const OPERATION_ID_PATTERN = /^op-[0-9]{4}$/;
const TRANSACTION_ID_PATTERN = /^main-[a-f0-9]{32}$/;
const MAX_JOURNAL_BYTES = 256 * 1024;
const ORDINARY_TARGETS = Object.freeze(["governance", "reserve", "ui"]);
const DEPLOYMENT_TARGETS = Object.freeze([
  "app",
  "governance",
  "reserve",
  "ui",
]);
const PROTECTED_TARGETS = Object.freeze([
  "app",
  "governance",
  "reserve",
  "ui",
  "legacy-app",
]);
const FORWARD_TYPES = new Set(["promote", "app_v3_deploy", "app_alias_set"]);
const RECOVERY_TYPES = new Set([
  "ordinary_rollback",
  "app_alias_restore",
  "legacy_emergency_restore",
]);
const PUBLIC_URLS = Object.freeze({
  app: "https://app.mento.org/",
  governance: "https://governance.mento.org/",
  reserve: "https://reserve.mento.org/",
  ui: "https://ui.mento.org/",
});

function clone(value) {
  return structuredClone(value);
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

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
    !sameJson(Object.keys(value).sort(), [...keys].sort())
  ) {
    throw new Error(`${label} contains forbidden or missing fields`);
  }
}

function requireString(value, label, pattern) {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new Error(`${label} is malformed`);
  }
  return value;
}

function requireSha(value, label) {
  return requireString(value, label, SHA_PATTERN);
}

function requireDeploymentId(value, label) {
  return requireString(value, label, DEPLOYMENT_ID_PATTERN);
}

function canonicalTargets(value, label) {
  if (
    !Array.isArray(value) ||
    value.some((target) => !DEPLOYMENT_TARGETS.includes(target)) ||
    new Set(value).size !== value.length
  ) {
    throw new Error(`${label} is malformed`);
  }
  return DEPLOYMENT_TARGETS.filter((target) => value.includes(target));
}

function canonicalStagedCandidates(value) {
  if (!isPlainObject(value)) {
    throw new Error("Staged candidate map is malformed");
  }
  assertExactKeys(value, DEPLOYMENT_TARGETS, "Staged candidate map");
  return Object.fromEntries(
    DEPLOYMENT_TARGETS.map((target) => {
      const candidate = value[target];
      if (candidate === null) return [target, null];
      if (
        !isPlainObject(candidate) ||
        (candidate.deploymentId !== null &&
          !DEPLOYMENT_ID_PATTERN.test(candidate.deploymentId)) ||
        (candidate.deploymentUrl !== null &&
          canonicalizeDeploymentUrl(candidate.deploymentUrl) !==
            candidate.deploymentUrl)
      ) {
        throw new Error(`Staged candidate ${target} is malformed`);
      }
      return [target, clone(candidate)];
    }),
  );
}

function canonicalPlanning(
  {
    activeTargets,
    shadowTargets,
    stagedCandidates,
    mainOwnershipMode,
    projectIds,
  },
  journal,
) {
  const active = canonicalTargets(activeTargets, "Active targets");
  const shadow = canonicalTargets(shadowTargets, "Shadow targets");
  const staged = canonicalStagedCandidates(stagedCandidates);
  if (active.some((target) => shadow.includes(target))) {
    throw new Error("Active and shadow targets overlap");
  }
  assertExactKeys(mainOwnershipMode, DEPLOYMENT_TARGETS, "Main ownership mode");
  assertExactKeys(projectIds, DEPLOYMENT_TARGETS, "Vercel project IDs");
  for (const target of DEPLOYMENT_TARGETS) {
    if (
      !["github", "shadow"].includes(mainOwnershipMode[target]) ||
      typeof projectIds[target] !== "string" ||
      projectIds[target].length === 0
    ) {
      throw new Error("Main planning identity is malformed");
    }
  }
  const selectedStaged = DEPLOYMENT_TARGETS.filter(
    (target) => staged[target] !== null,
  );
  if (
    !sameJson(
      DEPLOYMENT_TARGETS.filter(
        (target) => active.includes(target) || shadow.includes(target),
      ),
      selectedStaged,
    )
  ) {
    throw new Error(
      "Ownership partitions do not exactly cover the staged candidates",
    );
  }
  for (const target of DEPLOYMENT_TARGETS) {
    if (active.includes(target) !== (journal.candidates[target] !== null)) {
      throw new Error(
        "Active target partition differs from the prepared candidates",
      );
    }
  }
  return {
    activeTargets: active,
    shadowTargets: shadow,
    stagedCandidates: staged,
    mainOwnershipMode: clone(mainOwnershipMode),
    projectIds: clone(projectIds),
  };
}

function canonicalHistoryInput(history) {
  if (Array.isArray(history)) return history;
  assertExactKeys(
    history,
    [
      "schema",
      "transactionId",
      "highestSequence",
      "highestStatus",
      "highestArtifactName",
      "journals",
    ],
    "Active journal history document",
  );
  if (history.schema !== MAIN_ACTIVE_HISTORY_SCHEMA) {
    throw new Error("Active journal history schema is unsupported");
  }
  if (!Array.isArray(history.journals)) {
    throw new Error("Active journal history journals are malformed");
  }
  return history.journals;
}

function canonicalReceipt(receipt, journal) {
  assertExactKeys(
    receipt,
    ["acknowledged", "artifactName", "artifactId", "transactionId", "sequence"],
    "Journal upload receipt",
  );
  const artifactId = String(receipt.artifactId);
  if (
    receipt.acknowledged !== true ||
    !POSITIVE_ID_PATTERN.test(artifactId) ||
    receipt.artifactName !== mainTransactionJournalArtifactName(journal) ||
    receipt.transactionId !== journal.transactionId ||
    receipt.sequence !== journal.sequence
  ) {
    throw new Error(
      "Journal upload receipt does not acknowledge the highest snapshot",
    );
  }
  return {
    acknowledged: true,
    artifactName: receipt.artifactName,
    artifactId,
    transactionId: receipt.transactionId,
    sequence: receipt.sequence,
  };
}

function assertReceiptShape(receipt) {
  assertExactKeys(
    receipt,
    ["acknowledged", "artifactName", "artifactId", "transactionId", "sequence"],
    "Journal upload receipt",
  );
  if (
    receipt.acknowledged !== true ||
    !POSITIVE_ID_PATTERN.test(String(receipt.artifactId)) ||
    typeof receipt.artifactName !== "string" ||
    !TRANSACTION_ID_PATTERN.test(receipt.transactionId) ||
    !Number.isSafeInteger(receipt.sequence) ||
    receipt.sequence < 0
  ) {
    throw new Error("Journal upload receipt is malformed");
  }
}

export function createMainActiveJournalReceipt({
  journal,
  artifactName,
  artifactId,
}) {
  const canonical = assertMainTransactionJournal(journal);
  return canonicalReceipt(
    {
      acknowledged: true,
      artifactName,
      artifactId,
      transactionId: canonical.transactionId,
      sequence: canonical.sequence,
    },
    canonical,
  );
}

function assertFreshSha(value, journal) {
  if (requireSha(value, "Fresh main SHA") !== journal.deploySha) {
    throw new Error("Remote main is not fresh for this transaction");
  }
}

function canonicalCurrentMappings(journal, value) {
  if (!Array.isArray(value)) {
    throw new Error("Current protected mappings must be an array");
  }
  const expectedAliases = PROTECTED_TARGETS.flatMap(
    (target) => journal.prior[target].aliases,
  ).sort();
  const canonical = value.map((mapping, index) => {
    assertExactKeys(
      mapping,
      ["alias", "deploymentId", "deploymentUrl"],
      `Current protected mapping ${index + 1}`,
    );
    return {
      alias: canonicalizeHostname(mapping.alias),
      deploymentId: requireDeploymentId(
        mapping.deploymentId,
        `Current protected mapping ${index + 1} deployment ID`,
      ),
      deploymentUrl: canonicalizeDeploymentUrl(mapping.deploymentUrl),
    };
  });
  const actualAliases = canonical.map((mapping) => mapping.alias).sort();
  if (
    new Set(actualAliases).size !== actualAliases.length ||
    !sameJson(actualAliases, expectedAliases)
  ) {
    throw new Error(
      "Current protected mappings do not exactly cover protected aliases",
    );
  }
  return canonical.sort((left, right) => left.alias.localeCompare(right.alias));
}

function mappingsForAliases(currentMappings, aliases) {
  const selected = new Set(aliases);
  return currentMappings.filter((mapping) => selected.has(mapping.alias));
}

function mappingState(journal, currentMappings, target) {
  const candidate =
    target === "legacy-app"
      ? journal.candidates.app
      : journal.candidates[target];
  if (candidate?.deploymentId === null || candidate === null) return "unknown";
  return classifyMainTransactionMapping({
    aliases: journal.prior[target].aliases,
    currentMappings: mappingsForAliases(
      currentMappings,
      journal.prior[target].aliases,
    ),
    prior: journal.prior[target],
    candidate,
  });
}

function aliasMappingState(journal, currentMappings, alias, target = "app") {
  const candidate =
    target === "legacy-app"
      ? journal.candidates.app
      : journal.candidates[target];
  if (candidate?.deploymentId === null || candidate === null) return "unknown";
  return classifyMainTransactionMapping({
    aliases: [alias],
    currentMappings: mappingsForAliases(currentMappings, [alias]),
    prior: {
      ...journal.prior[target],
      aliases: [alias],
    },
    candidate: {
      ...candidate,
      aliases: [alias],
    },
  });
}

function assertLegacyPrior(journal, currentMappings) {
  const prior = journal.prior["legacy-app"];
  for (const alias of prior.aliases) {
    const mapping = currentMappings.find((entry) => entry.alias === alias);
    if (
      mapping.deploymentId !== prior.deploymentId ||
      mapping.deploymentUrl !== prior.deploymentUrl
    ) {
      throw new Error("Legacy App v2 mapping differs from its captured prior");
    }
  }
}

function lastEvents(journal) {
  const events = new Map();
  for (const operation of journal.operations) {
    events.set(operation.operationId, operation);
  }
  return events;
}

function operationStarts(journal, types) {
  return journal.operations.filter(
    (operation) => operation.state === "started" && types.has(operation.type),
  );
}

function matchingForwardStart(journal, intent) {
  return operationStarts(journal, FORWARD_TYPES).find(
    (operation) =>
      operation.type === intent.type &&
      operation.target === intent.target &&
      operation.alias === (intent.alias ?? null),
  );
}

function pendingOperation(journal, types) {
  const pending = operationStarts(journal, types).filter(
    (operation) =>
      lastEvents(journal).get(operation.operationId).state !== "verified",
  );
  if (pending.length > 1) {
    throw new Error("Journal contains overlapping operations");
  }
  return pending[0] ?? null;
}

function operationCounts(journal) {
  if (journal === null) {
    return { confirmedMutationCommands: 0, possibleMutationCommands: 0 };
  }
  const possible = new Set(
    journal.operations
      .filter((operation) => operation.state === "started")
      .map((operation) => operation.operationId),
  );
  const confirmed = new Set(
    journal.operations
      .filter((operation) => operation.state === "command_returned")
      .map((operation) => operation.operationId),
  );
  if (confirmed.size > possible.size) {
    throw new Error("Journal mutation counts are inconsistent");
  }
  return {
    confirmedMutationCommands: confirmed.size,
    possibleMutationCommands: possible.size,
  };
}

function transition({
  transitionKind,
  nextAction,
  journal = null,
  command = null,
  afterUploadAction = null,
  highest = journal,
}) {
  const canonicalJournal =
    journal === null ? null : assertMainTransactionJournal(journal);
  const countJournal =
    highest === null ? canonicalJournal : assertMainTransactionJournal(highest);
  const commandOperation =
    command === null || countJournal === null
      ? null
      : (countJournal.operations
          .filter((operation) => operation.state === "started")
          .at(-1) ?? null);
  return {
    schema: MAIN_ACTIVE_TRANSITION_SCHEMA,
    transitionKind,
    nextAction,
    afterUploadAction,
    transactionId:
      canonicalJournal?.transactionId ?? countJournal?.transactionId ?? null,
    journalSequence: canonicalJournal?.sequence ?? null,
    journalArtifactName:
      canonicalJournal === null
        ? null
        : mainTransactionJournalArtifactName(canonicalJournal),
    operationId: commandOperation?.operationId ?? null,
    operationType: commandOperation?.type ?? null,
    target: commandOperation?.target ?? null,
    alias: commandOperation?.alias ?? null,
    command,
    journal: canonicalJournal,
    ...operationCounts(countJournal),
  };
}

function journalTransition(journal, afterUploadAction) {
  return transition({
    transitionKind: "journal",
    nextAction: "upload-journal",
    afterUploadAction,
    journal,
  });
}

function noJournalTransition(
  highest,
  transitionKind,
  nextAction,
  command = null,
) {
  return transition({
    transitionKind,
    nextAction,
    command,
    highest,
  });
}

function canonicalForwardEvent(event) {
  if (!isPlainObject(event) || event.schema !== MAIN_ACTIVE_EVENT_SCHEMA) {
    throw new Error("Active transition event is malformed");
  }
  const keys = {
    initialize: ["schema", "kind"],
    dispatch: [
      "schema",
      "kind",
      "uploadReceipt",
      "freshSha",
      "currentMappings",
    ],
    authorize: [
      "schema",
      "kind",
      "uploadReceipt",
      "freshSha",
      "currentMappings",
    ],
    "command-returned": [
      "schema",
      "kind",
      "uploadReceipt",
      "operationId",
      "command",
      "result",
    ],
    verify: [
      "schema",
      "kind",
      "uploadReceipt",
      "freshSha",
      "currentMappings",
      "appCandidateMatches",
      "appDeployment",
    ],
    finalize: [
      "schema",
      "kind",
      "uploadReceipt",
      "freshSha",
      "currentMappings",
      "publicSmokes",
      "stateProof",
    ],
  };
  if (!Object.hasOwn(keys, event.kind)) {
    throw new Error("Active transition event kind is unsupported");
  }
  assertExactKeys(event, keys[event.kind], "Active transition event");
  if (event.kind !== "initialize") {
    assertReceiptShape(event.uploadReceipt);
  }
  if (["dispatch", "authorize", "verify", "finalize"].includes(event.kind)) {
    requireSha(event.freshSha, "Active event fresh SHA");
    if (!Array.isArray(event.currentMappings)) {
      throw new Error("Active event current mappings are malformed");
    }
  }
  if (event.kind === "command-returned") {
    requireString(
      event.operationId,
      "Active event operation ID",
      OPERATION_ID_PATTERN,
    );
    assertMainActiveCommandDescriptor(event.command);
    assertMainActiveCommandResult(event.result);
  }
  if (
    event.kind === "verify" &&
    (!Array.isArray(event.appCandidateMatches) ||
      !(event.appDeployment === null || isPlainObject(event.appDeployment)))
  ) {
    throw new Error("Active verification event is malformed");
  }
  if (event.kind === "finalize") {
    if (!isPlainObject(event.publicSmokes)) {
      throw new Error("Active final public smokes are malformed");
    }
    assertActiveDeploymentStateProof(event.stateProof);
  }
  return event;
}

export function createMainActiveTransitionEvent(value) {
  return clone(canonicalForwardEvent(value));
}

function commandForOperation(journal, operation) {
  if (operation.type === "promote") {
    return buildMainActivePromotionCommand({
      target: operation.target,
      deploymentId: operation.candidateDeploymentId,
      deploymentUrl: operation.candidateDeploymentUrl,
    });
  }
  if (operation.type === "app_v3_deploy") {
    const discovery = journal.candidates.app.discovery;
    return buildMainActiveAppDeployCommand({
      projectId: discovery.projectId,
      deploySha: journal.deploySha,
      runId: journal.runId,
      runAttempt: journal.runAttempt,
      transactionId: journal.transactionId,
      nextDeploymentId: generateVercelDeploymentId({
        target: "app",
        commitSha: journal.deploySha,
        runId: journal.runId,
        runAttempt: journal.runAttempt,
      }),
    });
  }
  if (operation.type === "app_alias_set") {
    return buildMainActiveAppAliasSetCommand({
      alias: operation.alias,
      deploymentId: operation.candidateDeploymentId,
      deploymentUrl: operation.candidateDeploymentUrl,
    });
  }
  if (operation.type === "ordinary_rollback") {
    return buildMainActiveRollbackCommand({
      target: operation.target,
      deploymentId: operation.priorDeploymentId,
      deploymentUrl: operation.priorDeploymentUrl,
    });
  }
  if (operation.type === "app_alias_restore") {
    return buildMainActiveAppAliasRestoreCommand({
      alias: operation.alias,
      deploymentId: operation.priorDeploymentId,
      deploymentUrl: operation.priorDeploymentUrl,
    });
  }
  if (operation.type === "legacy_emergency_restore") {
    return buildMainActiveLegacyAliasRestoreCommand({
      alias: operation.alias,
      deploymentId: operation.priorDeploymentId,
      deploymentUrl: operation.priorDeploymentUrl,
    });
  }
  throw new Error("Journal operation has no active command descriptor");
}

function requireLatestOperation(journal, state, types) {
  const start = operationStarts(journal, types).at(-1);
  if (start === undefined) {
    throw new Error("Journal does not contain the expected operation");
  }
  const latest = lastEvents(journal).get(start.operationId);
  if (latest.state !== state) {
    throw new Error(`Journal operation is not waiting in ${state}`);
  }
  return latest;
}

function forwardOperationPreState(journal, currentMappings, operation) {
  if (operation.type === "app_alias_set") {
    return aliasMappingState(journal, currentMappings, operation.alias);
  }
  if (operation.type === "app_v3_deploy") {
    return journal.prior.app.aliases.every((alias) => {
      const mapping = currentMappings.find((entry) => entry.alias === alias);
      return (
        mapping.deploymentId === journal.prior.app.deploymentId &&
        mapping.deploymentUrl === journal.prior.app.deploymentUrl
      );
    })
      ? "prior"
      : "unexpected";
  }
  return mappingState(journal, currentMappings, operation.target);
}

function nextForwardIntent(journal, currentMappings) {
  const latest = lastEvents(journal);
  for (const start of operationStarts(journal, FORWARD_TYPES)) {
    const last = latest.get(start.operationId);
    if (
      last.state === "verified" &&
      (last.commandOutcome !== "success" || last.mappingState !== "candidate")
    ) {
      return { kind: "recovery-required" };
    }
  }
  if (pendingOperation(journal, FORWARD_TYPES) !== null) {
    throw new Error("A forward operation is already in progress");
  }
  for (const target of ORDINARY_TARGETS) {
    if (journal.candidates[target] === null) continue;
    const intent = { type: "promote", target };
    if (matchingForwardStart(journal, intent) === undefined) {
      return { kind: "intent", intent };
    }
  }
  if (journal.candidates.app !== null) {
    const deployIntent = { type: "app_v3_deploy", target: "app" };
    if (matchingForwardStart(journal, deployIntent) === undefined) {
      return { kind: "intent", intent: deployIntent };
    }
    if (journal.candidates.app.deploymentId === null) {
      return { kind: "recovery-required" };
    }
    for (const alias of journal.prior.app.aliases) {
      const intent = { type: "app_alias_set", target: "app", alias };
      if (matchingForwardStart(journal, intent) !== undefined) continue;
      const state = aliasMappingState(journal, currentMappings, alias);
      if (state === "candidate") continue;
      if (state === "prior") return { kind: "intent", intent };
      return { kind: "recovery-required" };
    }
  }
  return { kind: "complete" };
}

function canonicalAppMatches(journal, matches) {
  if (!Array.isArray(matches)) {
    throw new Error("App candidate matches must be an array");
  }
  if (matches.length === 0) return [];
  if (matches.length > 1) return clone(matches);
  const resolved = resolveUniqueAppTransactionCandidate(journal, matches);
  return [
    {
      deploymentId: resolved.deploymentId,
      deploymentUrl: resolved.deploymentUrl,
      ...journal.candidates.app.discovery,
    },
  ];
}

function verifyAppDeployment(journal, appDeployment) {
  assertExactKeys(
    appDeployment,
    ["deploymentId", "deploymentUrl", "readyState"],
    "App deployment verification",
  );
  const candidate = journal.candidates.app;
  return (
    appDeployment.readyState === "READY" &&
    appDeployment.deploymentId === candidate.deploymentId &&
    canonicalizeDeploymentUrl(appDeployment.deploymentUrl) ===
      candidate.deploymentUrl
  );
}

function canonicalPublicSmokes(journal, planning, value) {
  assertExactKeys(value, DEPLOYMENT_TARGETS, "Active public smoke proof");
  return Object.fromEntries(
    DEPLOYMENT_TARGETS.map((target) => {
      const entry = value[target];
      assertExactKeys(
        entry,
        ["status", "publicUrl", "servedSha"],
        `Active public smoke ${target}`,
      );
      const selected = planning.activeTargets.includes(target);
      if (selected) {
        if (
          entry.status !== "passed" ||
          entry.publicUrl !== PUBLIC_URLS[target] ||
          entry.servedSha !== journal.deploySha
        ) {
          throw new Error(`Active public smoke ${target} is unproven`);
        }
        return [target, clone(entry)];
      }
      if (
        entry.status !== "not-required" ||
        entry.publicUrl !== PUBLIC_URLS[target] ||
        entry.servedSha !== null
      ) {
        throw new Error(`Unselected public smoke ${target} is malformed`);
      }
      return [target, clone(entry)];
    }),
  );
}

function canonicalStateProof(journal, planning, value) {
  const proof = assertActiveDeploymentStateProof(value);
  const stagedTargets = DEPLOYMENT_TARGETS.filter(
    (target) =>
      planning.activeTargets.includes(target) ||
      planning.shadowTargets.includes(target),
  );
  if (
    proof.outcome !== "proven" ||
    proof.deploySha !== journal.deploySha ||
    proof.runId !== journal.runId ||
    proof.runAttempt !== journal.runAttempt ||
    proof.transactionId !== journal.transactionId ||
    !sameJson(proof.mainOwnershipMode, planning.mainOwnershipMode) ||
    !sameJson(proof.stagedTargets, stagedTargets) ||
    !sameJson(proof.activeTargets, planning.activeTargets) ||
    !sameJson(proof.shadowTargets, planning.shadowTargets)
  ) {
    throw new Error("Active deployment state proof identity is inconsistent");
  }
  for (const target of DEPLOYMENT_TARGETS) {
    const project = proof.projects[target];
    const active = planning.activeTargets.includes(target);
    const shadowStage =
      target !== "app" && planning.shadowTargets.includes(target);
    const expected = active
      ? journal.candidates[target]
      : shadowStage
        ? planning.stagedCandidates[target]
        : null;
    const disposition = active
      ? "githubPrebuilt"
      : shadowStage
        ? "githubShadowStage"
        : null;
    if (
      project.projectId !== planning.projectIds[target] ||
      project.expectedDisposition !== disposition ||
      project.expectedDeploymentId !== (expected?.deploymentId ?? null) ||
      project.expectedDeploymentUrl !== (expected?.deploymentUrl ?? null)
    ) {
      throw new Error(
        `Active deployment state proof ${target} expectation is inconsistent`,
      );
    }
  }
  const legacy = journal.prior["legacy-app"];
  if (
    proof.legacyAppV2.alias !== legacy.aliases[0] ||
    proof.legacyAppV2.deploymentId !== legacy.deploymentId ||
    proof.legacyAppV2.deploymentUrl !== legacy.deploymentUrl ||
    proof.legacyAppV2.projectId !== planning.projectIds.app
  ) {
    throw new Error("Active deployment state proof legacy v2 is inconsistent");
  }
  return proof;
}

function sameDeployment(mapping, deployment) {
  return (
    mapping.deploymentId === deployment.deploymentId &&
    mapping.deploymentUrl === deployment.deploymentUrl
  );
}

function assertFinalMappings(journal, planning, proof, currentMappings) {
  for (const target of DEPLOYMENT_TARGETS) {
    const active = planning.activeTargets.includes(target);
    const prior = journal.prior[target];
    const allowed = active ? [journal.candidates[target]] : [prior];
    if (!active && planning.mainOwnershipMode[target] === "shadow") {
      const nativeOwners = proof.projects[target].records.nativeGitOwner;
      if (nativeOwners.length === 1) allowed.push(nativeOwners[0]);
    }
    if (
      allowed.some(
        (deployment) =>
          deployment?.deploymentId === null || deployment === null,
      )
    ) {
      throw new Error(`Final mapping ${target} lacks an expected deployment`);
    }
    const mappings = prior.aliases.map((alias) =>
      currentMappings.find((entry) => entry.alias === alias),
    );
    if (
      !allowed.some((deployment) =>
        mappings.every((mapping) => sameDeployment(mapping, deployment)),
      )
    ) {
      throw new Error(`Final mapping ${target} is invalid`);
    }
  }
  const legacy = proof.legacyAppV2;
  for (const alias of journal.prior["legacy-app"].aliases) {
    const mapping = currentMappings.find((entry) => entry.alias === alias);
    if (
      mapping.deploymentId !== legacy.deploymentId ||
      mapping.deploymentUrl !== legacy.deploymentUrl
    ) {
      throw new Error("Final legacy App v2 mapping is invalid");
    }
  }
}

export function reduceMainActiveTransition({
  preparedJournal,
  activeTargets,
  shadowTargets,
  stagedCandidates,
  mainOwnershipMode,
  projectIds,
  history,
  event,
}) {
  const prepared = assertMainTransactionJournal(preparedJournal);
  if (prepared.mode !== "active") {
    throw new Error("Prepared active journal mode is invalid");
  }
  const planning = canonicalPlanning(
    {
      activeTargets,
      shadowTargets,
      stagedCandidates,
      mainOwnershipMode,
      projectIds,
    },
    prepared,
  );
  const journals = canonicalHistoryInput(history);
  const input = canonicalForwardEvent(event);
  if (input.kind === "initialize") {
    if (journals.length !== 0) {
      throw new Error("Active initialization requires empty journal history");
    }
    if (planning.activeTargets.length === 0) {
      return noJournalTransition(null, "no-active-target", "complete");
    }
    return journalTransition(prepared, "dispatch");
  }
  if (journals.length === 0) {
    throw new Error("Active transition requires durable journal history");
  }
  const canonicalHistory = assertMainTransactionJournalHistory(journals, {
    repository: prepared.repository,
    deploySha: prepared.deploySha,
    runId: prepared.runId,
    runAttempt: prepared.runAttempt,
    transactionId: prepared.transactionId,
    mode: prepared.mode,
  });
  if (!sameJson(canonicalHistory[0], prepared)) {
    throw new Error(
      "Active journal history does not match the reviewed preparation",
    );
  }
  const highest = canonicalHistory.at(-1);
  canonicalReceipt(input.uploadReceipt, highest);

  if (input.kind === "dispatch" || input.kind === "authorize") {
    assertFreshSha(input.freshSha, highest);
    const currentMappings = canonicalCurrentMappings(
      highest,
      input.currentMappings,
    );
    assertLegacyPrior(highest, currentMappings);
    if (input.kind === "dispatch") {
      if (highest.status === "committed") {
        return noJournalTransition(highest, "committed", "complete");
      }
      const next = nextForwardIntent(highest, currentMappings);
      if (next.kind === "recovery-required") {
        return noJournalTransition(highest, "recovery-required", "recover");
      }
      if (next.kind === "complete") {
        return noJournalTransition(
          highest,
          "await-final-proof",
          "collect-final-proof",
        );
      }
      const started = startMainTransactionOperation(highest, next.intent);
      const operation = started.operations.at(-1);
      if (
        forwardOperationPreState(highest, currentMappings, operation) !==
        "prior"
      ) {
        throw new Error(
          "Protected mapping is not at prior before the mutation start",
        );
      }
      return journalTransition(started, "authorize");
    }
    const operation = requireLatestOperation(highest, "started", FORWARD_TYPES);
    if (
      forwardOperationPreState(highest, currentMappings, operation) !== "prior"
    ) {
      throw new Error(
        "Protected mapping changed after the durable mutation start",
      );
    }
    const command = commandForOperation(highest, operation);
    return noJournalTransition(highest, "command", "execute-command", command);
  }

  if (input.kind === "command-returned") {
    const operation = requireLatestOperation(highest, "started", FORWARD_TYPES);
    if (
      input.operationId !== operation.operationId ||
      !sameJson(
        assertMainActiveCommandDescriptor(input.command),
        commandForOperation(highest, operation),
      )
    ) {
      throw new Error("Command result does not bind the authorized operation");
    }
    const result = assertMainActiveCommandResult(input.result);
    let candidate = null;
    if (operation.type === "app_v3_deploy") {
      if (result.candidate !== null) {
        candidate = {
          ...result.candidate,
          ...highest.candidates.app.discovery,
        };
      }
    } else if (result.candidate !== null) {
      throw new Error("Non-App command cannot report an App candidate");
    }
    const returned = recordMainTransactionCommandReturned(highest, {
      operationId: operation.operationId,
      outcome: result.outcome,
      candidate,
    });
    return journalTransition(returned, "verify");
  }

  if (input.kind === "verify") {
    assertFreshSha(input.freshSha, highest);
    const currentMappings = canonicalCurrentMappings(
      highest,
      input.currentMappings,
    );
    assertLegacyPrior(highest, currentMappings);
    const operation = requireLatestOperation(
      highest,
      "command_returned",
      FORWARD_TYPES,
    );
    if (
      operation.type === "app_v3_deploy" &&
      highest.candidates.app.deploymentId === null
    ) {
      const matches = canonicalAppMatches(highest, input.appCandidateMatches);
      if (matches.length === 1) {
        return journalTransition(
          attachDiscoveredAppCandidate(highest, matches[0]),
          "verify",
        );
      }
      const unknown = recordMainTransactionVerified(highest, {
        operationId: operation.operationId,
        mappingState: "unknown",
      });
      return journalTransition(unknown, "recover");
    }
    if (
      operation.type !== "app_v3_deploy" &&
      (!Array.isArray(input.appCandidateMatches) ||
        input.appCandidateMatches.length !== 0 ||
        input.appDeployment !== null)
    ) {
      throw new Error("Non-App verification contains App-only fields");
    }
    let state;
    if (operation.type === "app_v3_deploy") {
      if (!Array.isArray(input.appCandidateMatches)) {
        throw new Error("App candidate matches must be an array");
      }
      state = verifyAppDeployment(highest, input.appDeployment)
        ? "candidate"
        : "unknown";
    } else if (operation.type === "app_alias_set") {
      state = aliasMappingState(highest, currentMappings, operation.alias);
    } else {
      state = mappingState(highest, currentMappings, operation.target);
    }
    const verified = recordMainTransactionVerified(highest, {
      operationId: operation.operationId,
      mappingState: state,
    });
    return journalTransition(
      verified,
      state === "candidate" && operation.commandOutcome === "success"
        ? "dispatch"
        : "recover",
    );
  }

  assertFreshSha(input.freshSha, highest);
  const currentMappings = canonicalCurrentMappings(
    highest,
    input.currentMappings,
  );
  const stateProof = canonicalStateProof(highest, planning, input.stateProof);
  assertFinalMappings(highest, planning, stateProof, currentMappings);
  if (pendingOperation(highest, FORWARD_TYPES) !== null) {
    throw new Error("Active transaction still has an incomplete operation");
  }
  canonicalPublicSmokes(highest, planning, input.publicSmokes);
  const committed = markMainTransactionCommitted(highest);
  return journalTransition(committed, "complete");
}

function canonicalRecoveryEvent(event) {
  if (
    !isPlainObject(event) ||
    event.schema !== MAIN_ACTIVE_RECOVERY_EVENT_SCHEMA
  ) {
    throw new Error("Active recovery event is malformed");
  }
  const keys = {
    initialize: ["schema", "kind", "uploadReceipt"],
    dispatch: ["schema", "kind", "uploadReceipt", "currentMappings"],
    authorize: ["schema", "kind", "uploadReceipt", "currentMappings"],
    "command-returned": [
      "schema",
      "kind",
      "uploadReceipt",
      "operationId",
      "command",
      "result",
    ],
    verify: ["schema", "kind", "uploadReceipt", "currentMappings"],
  };
  if (!Object.hasOwn(keys, event.kind)) {
    throw new Error("Active recovery event kind is unsupported");
  }
  assertExactKeys(event, keys[event.kind], "Active recovery event");
  assertReceiptShape(event.uploadReceipt);
  if (
    ["dispatch", "authorize", "verify"].includes(event.kind) &&
    !Array.isArray(event.currentMappings)
  ) {
    throw new Error("Active recovery current mappings are malformed");
  }
  if (event.kind === "command-returned") {
    requireString(
      event.operationId,
      "Active recovery operation ID",
      OPERATION_ID_PATTERN,
    );
    assertMainActiveCommandDescriptor(event.command);
    assertMainActiveCommandResult(event.result);
  }
  return event;
}

export function createMainActiveRecoveryTransitionEvent(value) {
  return clone(canonicalRecoveryEvent(value));
}

function recoveryIntent(action) {
  if (action.kind === "ordinary_rollback") {
    return { type: "ordinary_rollback", target: action.target };
  }
  if (action.kind === "app_alias_restore") {
    return { type: "app_alias_restore", target: "app", alias: action.alias };
  }
  if (action.kind === "legacy_emergency_restore") {
    return {
      type: "legacy_emergency_restore",
      target: "legacy-app",
      alias: action.alias,
    };
  }
  return null;
}

function matchingRecoveryStart(journal, intent) {
  return (
    operationStarts(journal, RECOVERY_TYPES).find(
      (operation) =>
        operation.type === intent.type &&
        operation.target === intent.target &&
        operation.alias === (intent.alias ?? null),
    ) ?? null
  );
}

function liveRecoveryIntent(action, journal, currentMappings) {
  if (action.kind === "manual_intervention") {
    return { kind: "manual", intent: null };
  }
  if (action.kind !== "verified_noop") {
    return { kind: "mutation", intent: recoveryIntent(action) };
  }
  const state =
    action.alias === undefined
      ? mappingState(journal, currentMappings, action.target)
      : aliasMappingState(
          journal,
          currentMappings,
          action.alias,
          action.target,
        );
  if (state === "prior") return { kind: "noop", intent: null };
  if (state !== "candidate") return { kind: "manual", intent: null };
  if (ORDINARY_TARGETS.includes(action.target)) {
    return {
      kind: "mutation",
      intent: { type: "ordinary_rollback", target: action.target },
    };
  }
  if (action.target === "app") {
    return {
      kind: "mutation",
      intent: {
        type: "app_alias_restore",
        target: "app",
        alias: action.alias,
      },
    };
  }
  return {
    kind: "mutation",
    intent: {
      type: "legacy_emergency_restore",
      target: "legacy-app",
      alias: action.alias,
    },
  };
}

function recoveryMappingState(journal, currentMappings, operation) {
  if (operation.alias !== null) {
    return aliasMappingState(
      journal,
      currentMappings,
      operation.alias,
      operation.target,
    );
  }
  return mappingState(journal, currentMappings, operation.target);
}

function nextRecoveryAction(journal, plan, currentMappings) {
  if (plan.decision === "manual_intervention") {
    return { kind: "manual" };
  }
  const latest = lastEvents(journal);
  for (const action of plan.actions) {
    const live = liveRecoveryIntent(action, journal, currentMappings);
    if (live.kind === "noop") continue;
    if (live.kind === "manual") return { kind: "manual" };
    const start = matchingRecoveryStart(journal, live.intent);
    if (start === null) {
      const intent = live.intent;
      const state =
        intent.alias === undefined
          ? mappingState(journal, currentMappings, intent.target)
          : aliasMappingState(
              journal,
              currentMappings,
              intent.alias,
              intent.target,
            );
      if (state === "prior") continue;
      if (state !== "candidate") return { kind: "manual" };
      return { kind: "intent", intent };
    }
    const last = latest.get(start.operationId);
    if (last.state !== "verified") {
      throw new Error("A recovery operation is already in progress");
    }
    if (last.mappingState !== "prior") {
      return { kind: "manual" };
    }
  }
  return { kind: "complete" };
}

export function reduceMainActiveRecoveryTransition({
  recoveryPlan,
  history,
  event,
}) {
  const plan = assertMainTransactionRecoveryPlan(recoveryPlan);
  const input = canonicalRecoveryEvent(event);
  const journals = canonicalHistoryInput(history);
  if (journals.length === 0) {
    throw new Error("Active recovery requires durable journal history");
  }
  const canonicalHistory = assertMainTransactionJournalHistory(journals, {
    repository: plan.journal.repository,
    deploySha: plan.journal.deploySha,
    runId: plan.journal.runId,
    runAttempt: plan.journal.runAttempt,
    transactionId: plan.journal.transactionId,
    mode: plan.journal.mode,
  });
  let highest = canonicalHistory.at(-1);
  canonicalReceipt(input.uploadReceipt, highest);
  if (!["recover", "manual_intervention"].includes(plan.decision)) {
    return noJournalTransition(
      highest,
      "recovery-not-required",
      "fail-after-evidence",
    );
  }
  if (input.kind === "initialize") {
    if (
      plan.discoveredAppCandidate !== null &&
      highest.candidates.app?.deploymentId === null
    ) {
      return journalTransition(
        attachDiscoveredAppCandidate(highest, plan.discoveredAppCandidate),
        "initialize",
      );
    }
    if (highest.status !== "recovering") {
      highest = startMainTransactionRecovery(highest);
      return journalTransition(highest, "dispatch");
    }
    return noJournalTransition(highest, "recovery-ready", "dispatch");
  }
  if (input.kind === "dispatch" || input.kind === "authorize") {
    const currentMappings = canonicalCurrentMappings(
      highest,
      input.currentMappings,
    );
    if (input.kind === "dispatch") {
      const next = nextRecoveryAction(highest, plan, currentMappings);
      if (next.kind === "manual") {
        try {
          const terminal = finishMainTransactionRecovery(highest, {
            manualIntervention: true,
          });
          return journalTransition(terminal, "fail-after-evidence");
        } catch {
          return noJournalTransition(
            highest,
            "manual-intervention-required",
            "fail-after-evidence",
          );
        }
      }
      if (next.kind === "complete") {
        try {
          const terminal = finishMainTransactionRecovery(highest);
          return journalTransition(terminal, "fail-after-evidence");
        } catch {
          return noJournalTransition(
            highest,
            "recovery-verification-incomplete",
            "fail-after-evidence",
          );
        }
      }
      const started = startMainTransactionOperation(highest, next.intent);
      return journalTransition(started, "authorize");
    }
    const operation = requireLatestOperation(
      highest,
      "started",
      RECOVERY_TYPES,
    );
    if (
      recoveryMappingState(highest, currentMappings, operation) !== "candidate"
    ) {
      throw new Error(
        "Recovery mapping changed after the durable mutation start",
      );
    }
    return noJournalTransition(
      highest,
      "command",
      "execute-command",
      commandForOperation(highest, operation),
    );
  }
  if (input.kind === "command-returned") {
    const operation = requireLatestOperation(
      highest,
      "started",
      RECOVERY_TYPES,
    );
    if (
      input.operationId !== operation.operationId ||
      !sameJson(
        assertMainActiveCommandDescriptor(input.command),
        commandForOperation(highest, operation),
      )
    ) {
      throw new Error(
        "Recovery command result does not bind the authorized operation",
      );
    }
    const result = assertMainActiveCommandResult(input.result);
    if (result.candidate !== null) {
      throw new Error("Recovery command cannot report an App candidate");
    }
    const returned = recordMainTransactionCommandReturned(highest, {
      operationId: operation.operationId,
      outcome: result.outcome,
    });
    return journalTransition(returned, "verify");
  }
  const currentMappings = canonicalCurrentMappings(
    highest,
    input.currentMappings,
  );
  const operation = requireLatestOperation(
    highest,
    "command_returned",
    RECOVERY_TYPES,
  );
  const state = recoveryMappingState(highest, currentMappings, operation);
  const verified = recordMainTransactionVerified(highest, {
    operationId: operation.operationId,
    mappingState: state,
    rollbackState:
      operation.type === "ordinary_rollback" && state === "prior"
        ? "entered"
        : null,
  });
  return journalTransition(verified, "dispatch");
}

export async function executeMainActiveCommand({ command, adapter }) {
  const canonical = assertMainActiveCommandDescriptor(command);
  if (typeof adapter !== "function") {
    throw new Error("Active command executor is required");
  }
  let result;
  try {
    result = await adapter(clone(canonical));
  } catch {
    return {
      outcome: "unknown",
      reason: "spawn-error",
      candidate: null,
    };
  }
  try {
    return assertMainActiveCommandResult(result);
  } catch {
    return {
      outcome: "unknown",
      reason: "lost-result",
      candidate: null,
    };
  }
}

function isWithin(parent, child) {
  const path = relative(parent, child);
  return path !== "" && path !== ".." && !path.startsWith(`..${sep}`);
}

export function loadMainActiveJournalHistory({
  artifactsDirectory,
  expectedIdentity,
}) {
  assertExactKeys(
    expectedIdentity,
    ["repository", "deploySha", "runId", "runAttempt", "transactionId", "mode"],
    "Active journal history identity",
  );
  requireString(
    expectedIdentity.transactionId,
    "Active journal transaction ID",
    TRANSACTION_ID_PATTERN,
  );
  requireSha(expectedIdentity.deploySha, "Active journal deploy SHA");
  if (
    expectedIdentity.repository !== "mento-protocol/frontend-monorepo" ||
    !POSITIVE_ID_PATTERN.test(String(expectedIdentity.runId)) ||
    !POSITIVE_ID_PATTERN.test(String(expectedIdentity.runAttempt)) ||
    expectedIdentity.mode !== "active"
  ) {
    throw new Error("Active journal history identity is malformed");
  }
  const rootStat = lstatSync(artifactsDirectory);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error("Active journal artifacts root must be a real directory");
  }
  const root = realpathSync(artifactsDirectory);
  const escapedTransactionId = expectedIdentity.transactionId.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&",
  );
  const artifactPattern = new RegExp(
    `^vercel-main-journal-${escapedTransactionId}-([0-9]{6})$`,
  );
  const journals = [];
  for (const name of readdirSync(root).sort()) {
    const match = artifactPattern.exec(name);
    if (match === null) continue;
    const directory = join(root, name);
    const directoryStat = lstatSync(directory);
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
      throw new Error("Journal artifact entry must be a real directory");
    }
    const directoryReal = realpathSync(directory);
    if (!isWithin(root, directoryReal)) {
      throw new Error("Journal artifact directory escapes the download root");
    }
    const entries = readdirSync(directoryReal);
    if (entries.length !== 1 || entries[0] !== "main-journal.json") {
      throw new Error(
        "Journal artifact directory must contain one canonical journal file",
      );
    }
    const file = join(directoryReal, "main-journal.json");
    const fileStat = lstatSync(file);
    if (
      !fileStat.isFile() ||
      fileStat.isSymbolicLink() ||
      fileStat.nlink !== 1 ||
      fileStat.size <= 0 ||
      fileStat.size > MAX_JOURNAL_BYTES
    ) {
      throw new Error("Journal artifact file must be a regular file");
    }
    const fileReal = realpathSync(file);
    if (!isWithin(directoryReal, fileReal)) {
      throw new Error("Journal artifact file escapes its artifact directory");
    }
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(fileReal, "utf8"));
    } catch {
      throw new Error("Journal artifact file is not valid JSON");
    }
    const journal = assertMainTransactionJournal(parsed, expectedIdentity);
    if (
      journal.sequence !== Number(match[1]) ||
      mainTransactionJournalArtifactName(journal) !== name
    ) {
      throw new Error(
        "Journal artifact directory does not match its canonical snapshot",
      );
    }
    journals.push(journal);
  }
  if (journals.length === 0) {
    throw new Error("No active journal artifacts match the transaction");
  }
  const canonical = assertMainTransactionJournalHistory(
    journals,
    expectedIdentity,
  );
  const highest = canonical.at(-1);
  return {
    schema: MAIN_ACTIVE_HISTORY_SCHEMA,
    transactionId: highest.transactionId,
    highestSequence: highest.sequence,
    highestStatus: highest.status,
    highestArtifactName: mainTransactionJournalArtifactName(highest),
    journals: canonical,
  };
}
