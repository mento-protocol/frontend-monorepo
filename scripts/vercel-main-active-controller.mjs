#!/usr/bin/env node

import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { join, relative, sep } from "node:path";

import {
  assertMainInheritedTransactionRecoveryPlan,
  assertMainTransactionJournal,
  assertMainTransactionJournalHistory,
  assertMainTransactionRecoveryPlan,
  createPreparedMainTransactionJournal,
  classifyMainTransactionMapping,
  expectedVerifiedMappingStateFor,
  finishMainTransactionRecovery,
  isProductionShapedPrior,
  mainTransactionJournalArtifactName,
  markMainTransactionCommitted,
  recordMainTransactionCommandReturned,
  recordMainTransactionVerified,
  planInheritedMainTransactionRecovery,
  startMainTransactionOperation,
  startInheritedMainTransactionRecovery,
  startMainTransactionRecovery,
} from "./vercel-main-transaction.mjs";
import {
  MAIN_RELEASE_ACTIVATION_ORDER,
  assertMainReleaseManifest,
  reconcileMainRelease,
  reconcileMainReleaseForRecovery,
} from "./vercel-main-release-reconciliation.mjs";
import {
  assertMainActiveCommandDescriptor,
  assertMainActiveCommandResult,
  buildMainActiveAppAliasRestoreCommand,
  buildMainActiveAppAliasSetCommand,
  buildMainActivePromotionCommand,
  buildMainActiveRollbackCommand,
  MAIN_ACTIVE_PROMOTABLE_TARGETS,
} from "./vercel-main-active.mjs";
import {
  assertActiveDeploymentStateProof,
  canonicalizeDeploymentUrl,
  canonicalizeHostname,
} from "./vercel-deployment-state.mjs";

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
const PROMOTABLE_TARGETS = MAIN_ACTIVE_PROMOTABLE_TARGETS;
const DEPLOYMENT_TARGETS = Object.freeze([
  "app",
  "governance",
  "reserve",
  "ui",
]);
const PROTECTED_TARGETS = Object.freeze(["app", "governance", "reserve", "ui"]);
const FORWARD_TYPES = new Set(["promote", "app_alias_set"]);
const RECOVERY_TYPES = new Set(["ordinary_rollback", "app_alias_restore"]);
const PUBLIC_URLS = Object.freeze({
  app: "https://app.mento.org/",
  governance: "https://governance.mento.org/",
  reserve: "https://reserve.mento.org/",
  ui: "https://ui.mento.org/",
});
const ACTIVE_RUNTIME_RESULT_KEYS = Object.freeze([
  "deploy_sha",
  "final_url",
  "interaction",
  "logical_target",
  "public_url",
  "successful_documents",
  "successful_fonts",
  "successful_scripts",
  "successful_stylesheets",
]);
const ACTIVE_RUNTIME_FINAL_PATHS = Object.freeze({
  app: "/swap/celo",
  governance: "/voting-power",
  reserve: "/?tab=stablecoins",
  ui: "/form-components",
});
const ACTIVE_RUNTIME_INTERACTIONS = Object.freeze({
  app: "real-production-wallet-list",
  governance: "governance-voting-power-navigation",
  reserve: "reserve-overview-data-and-supply-tab",
  ui: "ui-search-navigation-and-checkbox",
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

function canonicalRuntimeSmoke(value, target, deploySha) {
  assertExactKeys(
    value,
    ACTIVE_RUNTIME_RESULT_KEYS,
    `Active public smoke ${target} runtime`,
  );
  const expectedFinalUrl = new URL(
    ACTIVE_RUNTIME_FINAL_PATHS[target],
    PUBLIC_URLS[target],
  ).toString();
  if (
    value.deploy_sha !== deploySha ||
    value.logical_target !== target ||
    value.public_url !== PUBLIC_URLS[target] ||
    value.final_url !== expectedFinalUrl ||
    value.interaction !== ACTIVE_RUNTIME_INTERACTIONS[target]
  ) {
    throw new Error(`Active public smoke ${target} runtime is unproven`);
  }
  for (const field of [
    "successful_documents",
    "successful_fonts",
    "successful_scripts",
    "successful_stylesheets",
  ]) {
    if (!Number.isSafeInteger(value[field]) || value[field] < 1) {
      throw new Error(`Active public smoke ${target} runtime is incomplete`);
    }
  }
  return {
    deploy_sha: value.deploy_sha,
    final_url: value.final_url,
    interaction: value.interaction,
    logical_target: value.logical_target,
    public_url: value.public_url,
    successful_documents: value.successful_documents,
    successful_fonts: value.successful_fonts,
    successful_scripts: value.successful_scripts,
    successful_stylesheets: value.successful_stylesheets,
  };
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
    const alias = canonicalizeHostname(mapping.alias);
    return {
      alias,
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

function groupedReleaseMappings(journal, currentMappings) {
  return Object.fromEntries(
    MAIN_RELEASE_ACTIVATION_ORDER.map((target) => [
      target,
      mappingsForAliases(currentMappings, journal.prior[target].aliases),
    ]),
  );
}

function assertForwardReleaseOrdering(journal, currentMappings) {
  const grouped = groupedReleaseMappings(journal, currentMappings);
  const onlyKnownReleaseMappings = MAIN_RELEASE_ACTIVATION_ORDER.every(
    (target) => {
      const prior = journal.prior[target];
      const candidate = journal.candidates[target];
      return grouped[target].every(
        (mapping) =>
          sameDeployment(mapping, prior) ||
          (candidate !== null &&
            candidate.deploymentId !== null &&
            sameDeployment(mapping, candidate)),
      );
    },
  );
  // Unexpected provider identities follow the existing deterministic recovery
  // route. When every leaf belongs to this release, the activation-order
  // reconciler must reject any state that is not a forward prefix.
  if (!onlyKnownReleaseMappings) return;
  reconcileMainRelease({
    manifest: journal.release,
    candidates: releaseCandidatesFromJournal(journal),
    currentMappings: grouped,
  });
}

function mappingState(journal, currentMappings, target) {
  const candidate = journal.candidates[target];
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
  const candidate = journal.candidates[target];
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
    verify: ["schema", "kind", "uploadReceipt", "freshSha", "currentMappings"],
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
  return mappingState(journal, currentMappings, operation.target);
}

function nextForwardIntent(journal, currentMappings) {
  const latest = lastEvents(journal);
  for (const start of operationStarts(journal, FORWARD_TYPES)) {
    const last = latest.get(start.operationId);
    // TRANSITION-V3-PRIOR: the App promote is verified at `prior`, every other
    // forward operation at `candidate`. Comparing against the per-operation
    // expectation is what lets a verified App promote advance to the bridge
    // alias set instead of entering recovery.
    if (
      last.state === "verified" &&
      (last.commandOutcome !== "success" ||
        last.mappingState !== expectedVerifiedMappingStateFor(start))
    ) {
      return { kind: "recovery-required" };
    }
  }
  if (pendingOperation(journal, FORWARD_TYPES) !== null) {
    throw new Error("A forward operation is already in progress");
  }
  for (const target of PROMOTABLE_TARGETS) {
    if (journal.candidates[target] === null) continue;
    const intent = { type: "promote", target };
    const existing = matchingForwardStart(journal, intent);
    const state = mappingState(journal, currentMappings, target);
    // A stable release identity may resume after another attempt already
    // promoted a prefix. Current provider mappings, rather than the absence of
    // a current-attempt journal operation, determine whether this target still
    // needs a mutation.
    //
    // TRANSITION-V3-PRIOR: the App promote does not move the reviewed App
    // domain, so an App mapping already at the candidate proves an earlier
    // attempt completed the whole App prefix — promote plus bridge — and this
    // attempt has nothing left to do for App.
    if (state === "candidate") {
      continue;
    }
    if (state === "prior" && existing === undefined) {
      return { kind: "intent", intent };
    }
    if (state !== "prior" || target !== "app") {
      return { kind: "recovery-required" };
    }
  }
  if (journal.candidates.app !== null) {
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

function canonicalPublicSmokes(journal, planning, value) {
  assertExactKeys(value, DEPLOYMENT_TARGETS, "Active public smoke proof");
  return Object.fromEntries(
    DEPLOYMENT_TARGETS.map((target) => {
      const entry = value[target];
      assertExactKeys(
        entry,
        ["runtime", "status", "publicUrl", "servedSha"],
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
        return [
          target,
          {
            ...clone(entry),
            runtime: canonicalRuntimeSmoke(
              entry.runtime,
              target,
              journal.deploySha,
            ),
          },
        ];
      }
      if (
        entry.status !== "not-required" ||
        entry.publicUrl !== PUBLIC_URLS[target] ||
        entry.servedSha !== null ||
        entry.runtime !== null
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
    const originalPrior = journal.release.originalPriors[target];
    const active = planning.activeTargets.includes(target);
    const shadowStage = planning.shadowTargets.includes(target);
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
      project.expectedDeploymentUrl !== (expected?.deploymentUrl ?? null) ||
      project.priorDeploymentId !== originalPrior.deploymentId ||
      project.priorDeploymentUrl !== originalPrior.deploymentUrl ||
      project.priorServedSha !== originalPrior.servedSha
    ) {
      throw new Error(
        `Active deployment state proof ${target} expectation is inconsistent`,
      );
    }
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
    assertForwardReleaseOrdering(highest, currentMappings);
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
    const returned = recordMainTransactionCommandReturned(highest, {
      operationId: operation.operationId,
      outcome: result.outcome,
      candidate: null,
    });
    return journalTransition(returned, "verify");
  }

  if (input.kind === "verify") {
    assertFreshSha(input.freshSha, highest);
    const currentMappings = canonicalCurrentMappings(
      highest,
      input.currentMappings,
    );
    const operation = requireLatestOperation(
      highest,
      "command_returned",
      FORWARD_TYPES,
    );
    const state =
      operation.type === "app_alias_set"
        ? aliasMappingState(highest, currentMappings, operation.alias)
        : mappingState(highest, currentMappings, operation.target);
    const verified = recordMainTransactionVerified(highest, {
      operationId: operation.operationId,
      mappingState: state,
    });
    return journalTransition(
      verified,
      state === expectedVerifiedMappingStateFor(operation) &&
        operation.commandOutcome === "success"
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
  if (action.alias === undefined) {
    // TRANSITION-V3-PRIOR: a promote slot compensates with a rollback, which
    // only restores a production deployment. A v3-shaped App prior has none,
    // so a drifted App promote slot is manual.
    if (
      action.target !== "app" ||
      isProductionShapedPrior(journal.release, "app")
    ) {
      return {
        kind: "mutation",
        intent: { type: "ordinary_rollback", target: action.target },
      };
    }
    return { kind: "manual", intent: null };
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
  throw new Error("Recovery action has no active mutation intent");
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
  const latest = lastEvents(journal);
  let manualInterventionRequired = false;
  for (const action of plan.actions) {
    const live = liveRecoveryIntent(action, journal, currentMappings);
    if (live.kind === "noop") continue;
    if (live.kind === "manual") {
      manualInterventionRequired = true;
      continue;
    }
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
      if (state !== "candidate") {
        manualInterventionRequired = true;
        continue;
      }
      return { kind: "intent", intent };
    }
    const last = latest.get(start.operationId);
    if (last.state !== "verified") {
      throw new Error("A recovery operation is already in progress");
    }
    if (last.mappingState !== "prior") {
      manualInterventionRequired = true;
    }
  }
  return {
    kind: manualInterventionRequired ? "manual" : "complete",
  };
}

function canonicalActiveRecoveryPlan(recoveryPlan) {
  const inherited =
    isPlainObject(recoveryPlan) &&
    Object.hasOwn(recoveryPlan, "reconciliation") &&
    Object.hasOwn(recoveryPlan, "rollbackAuthority");
  return inherited
    ? {
        kind: "inherited",
        plan: assertMainInheritedTransactionRecoveryPlan(recoveryPlan),
      }
    : {
        kind: "failed-activation",
        plan: assertMainTransactionRecoveryPlan(recoveryPlan),
      };
}

export function reduceMainActiveRecoveryTransition({
  recoveryPlan,
  history,
  event,
}) {
  const canonicalPlan = canonicalActiveRecoveryPlan(recoveryPlan);
  const { plan } = canonicalPlan;
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
  if (
    canonicalPlan.kind === "failed-activation" &&
    !["recover", "manual_intervention"].includes(plan.decision)
  ) {
    return noJournalTransition(
      highest,
      "recovery-not-required",
      "fail-after-evidence",
    );
  }
  if (input.kind === "initialize") {
    if (highest.status !== "recovering") {
      highest =
        canonicalPlan.kind === "inherited"
          ? startInheritedMainTransactionRecovery({
              journal: highest,
              recoveryPlan: plan,
            })
          : startMainTransactionRecovery(highest);
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
          const terminal = finishMainTransactionRecovery(highest, {
            manualIntervention:
              canonicalPlan.kind === "failed-activation" &&
              plan.decision === "manual_intervention",
          });
          return journalTransition(
            terminal,
            canonicalPlan.kind === "inherited"
              ? "continue-after-recovery"
              : "fail-after-evidence",
          );
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

function releaseCandidatesFromJournal(journal) {
  return Object.fromEntries(
    journal.release.stagedTargets.map((target) => {
      const candidate = journal.candidates[target];
      return [
        target,
        candidate === null || candidate.deploymentId === null
          ? null
          : {
              deploymentId: candidate.deploymentId,
              deploymentUrl: candidate.deploymentUrl,
              manifest: journal.release,
            },
      ];
    }),
  );
}

function releaseMappingsFromJournal(journal, currentMappings) {
  if (!currentMappings || typeof currentMappings !== "object") {
    throw new Error("Fresh release mappings are required");
  }
  return Object.fromEntries(
    ["governance", "reserve", "ui", "app"].map((target) => [
      target,
      currentMappings[target],
    ]),
  );
}

function sameSnapshot(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

// Stable candidate metadata identifies a release. Fresh provider mappings decide
// whether it is safe to mutate it. This intentionally has no artifact input.
export function reconcileFreshMainActiveRelease({ journal, currentMappings }) {
  const canonicalJournal = assertMainTransactionJournal(journal);
  const manifest = assertMainReleaseManifest(canonicalJournal.release);
  return reconcileMainRelease({
    manifest,
    candidates: releaseCandidatesFromJournal(canonicalJournal),
    currentMappings: releaseMappingsFromJournal(
      canonicalJournal,
      currentMappings,
    ),
  });
}

function reconcileFreshMainActiveReleaseForRecovery({
  journal,
  currentMappings,
}) {
  const canonicalJournal = assertMainTransactionJournal(journal);
  const manifest = assertMainReleaseManifest(canonicalJournal.release);
  return reconcileMainReleaseForRecovery({
    manifest,
    candidates: releaseCandidatesFromJournal(canonicalJournal),
    currentMappings: releaseMappingsFromJournal(
      canonicalJournal,
      currentMappings,
    ),
  });
}

// Take two provider snapshots so a changing mapping set cannot become recovery
// authority between inspection and journal creation.
export async function censusFreshMainActiveRelease({
  journal,
  inspectCurrentMappings,
}) {
  if (typeof inspectCurrentMappings !== "function") {
    throw new Error("Fresh release mapping inspector is required");
  }
  const first = await inspectCurrentMappings();
  const firstReconciliation = reconcileFreshMainActiveRelease({
    journal,
    currentMappings: first,
  });
  const second = await inspectCurrentMappings();
  const secondReconciliation = reconcileFreshMainActiveRelease({
    journal,
    currentMappings: second,
  });
  if (
    !sameSnapshot(
      firstReconciliation.observedTargets,
      secondReconciliation.observedTargets,
    )
  ) {
    throw new Error("Fresh release mapping census changed");
  }
  return { currentMappings: second, reconciliation: secondReconciliation };
}

function releasePriorFromManifest(manifest) {
  return Object.fromEntries(
    ["app", "governance", "reserve", "ui"].map((target) => {
      const prior = manifest.originalPriors[target];
      return [
        target,
        {
          deploymentId: prior.deploymentId,
          deploymentUrl: prior.deploymentUrl,
          aliases: prior.aliases,
        },
      ];
    }),
  );
}

// A recovery attempt has a new downstream identity. The manifest remains
// stable identity; this journal is the only mutation authority for the
// current attempt.
export function createCurrentMainActiveRecoveryJournal({
  inheritedJournal,
  identity,
  currentMappings,
}) {
  const inherited = assertMainTransactionJournal(inheritedJournal);
  const reconciliation = reconcileFreshMainActiveReleaseForRecovery({
    journal: inherited,
    currentMappings,
  });
  const release = assertMainReleaseManifest(inherited.release);
  const prior = releasePriorFromManifest(release);
  const recovery = createPreparedMainTransactionJournal({
    ...identity,
    deploySha: release.deploySha,
    mode: inherited.mode,
    release,
    prior,
    startMappings: currentMappings,
    candidates: inherited.candidates,
    allowTerminalAppRecoveryResidual: true,
  });
  return { journal: recovery, reconciliation };
}

// Reconciliation is deliberately performed against fresh mappings before the
// pure transaction planner sees them. A complete candidate release is proof to
// verify only; a reader may never roll it back.
export function planFreshInheritedMainActiveRecovery({
  inheritedJournal,
  reason,
  currentMappings,
}) {
  const inherited = assertMainTransactionJournal(inheritedJournal);
  let reconciliation;
  try {
    reconciliation = reconcileFreshMainActiveReleaseForRecovery({
      journal: inherited,
      currentMappings,
    });
  } catch (error) {
    return {
      decision: "manual-intervention",
      reason: "fresh-provider-census-is-not-a-known-release-frontier",
      error: error instanceof Error ? error.message : String(error),
      reconciliation: null,
      actions: [],
    };
  }
  // The inherited planner is pure. Rebase only its provider-observed start
  // mappings; never treat an older artifact snapshot as current authority.
  const rebased = assertMainTransactionJournal({
    ...inherited,
    startMappings: currentMappings,
  });
  const plan = planInheritedMainTransactionRecovery({
    journal: rebased,
    reason,
  });
  return { ...plan, reconciliation };
}

// App has two protected environments. A moved v3 mapping is recoverable only
// when this current attempt first captured the v2 mapping. An unmapped third
// deployment or a candidate left by another attempt stops for manual work.
export function decideMainActiveAppRecoverySafety({
  inheritedJournal,
  currentJournal = null,
  reason,
  currentMappings,
}) {
  const inherited = assertMainTransactionJournal(inheritedJournal);
  const inheritedPlan = planFreshInheritedMainActiveRecovery({
    inheritedJournal,
    reason,
    currentMappings,
  });
  if (
    inheritedPlan.decision === "manual-intervention" ||
    inheritedPlan.decision === "verify-noop" ||
    inheritedPlan.decision === "no-inherited-recovery"
  ) {
    return inheritedPlan;
  }
  if (currentJournal === null) {
    return {
      decision: "manual-intervention",
      reason: "current-attempt-recovery-journal-is-required",
      reconciliation: inheritedPlan.reconciliation,
      actions: [],
    };
  }

  let current;
  try {
    current = assertMainTransactionJournal(currentJournal);
    if (
      current.status !== "prepared" ||
      current.operations.length !== 0 ||
      !sameSnapshot(current.release, inherited.release) ||
      !sameSnapshot(current.candidates, inherited.candidates) ||
      !sameSnapshot(current.startMappings, currentMappings)
    ) {
      throw new Error(
        "Current recovery journal does not bind the fresh inherited release census",
      );
    }
  } catch (error) {
    return {
      decision: "manual-intervention",
      reason: "current-attempt-recovery-journal-is-not-safe",
      error: error instanceof Error ? error.message : String(error),
      reconciliation: inheritedPlan.reconciliation,
      actions: [],
    };
  }

  const plan = planFreshInheritedMainActiveRecovery({
    inheritedJournal: current,
    reason,
    currentMappings,
  });
  if (
    plan.decision !== "restore-inherited" ||
    !sameSnapshot(plan.reconciliation, inheritedPlan.reconciliation)
  ) {
    return {
      decision: "manual-intervention",
      reason: "current-attempt-recovery-plan-diverged",
      reconciliation: inheritedPlan.reconciliation,
      actions: [],
    };
  }
  const app = plan.reconciliation.observedTargets.find(
    (target) => target.target === "app",
  );
  if (app?.state === "prior") return plan;
  try {
    if (!sameSnapshot(currentMappings.app, current.startMappings.app)) {
      throw new Error("Current attempt App mapping changed");
    }
  } catch (error) {
    return {
      decision: "manual-intervention",
      reason: "app-v3-recovery-journal-is-not-safe",
      error: error instanceof Error ? error.message : String(error),
      reconciliation: plan.reconciliation,
      actions: [],
    };
  }
  return plan;
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
