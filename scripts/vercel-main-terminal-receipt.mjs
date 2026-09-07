import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

const MAIN_TERMINAL_RECEIPT_SCHEMA = "vercel-main-terminal-receipt:v3";
const MAIN_TERMINAL_RECEIPT_REPOSITORY = "mento-protocol/frontend-monorepo";

// GitHub permits much larger job outputs. Keep the durable handoff deliberately
// small so its size stays auditable and cannot become a second artifact channel.
export const MAIN_TERMINAL_RECEIPT_MAX_ENCODED_BYTES = 32 * 1024;
const MAIN_TERMINAL_EVIDENCE_SCHEMA = "vercel-main-terminal-evidence:v3";
export const MAIN_TERMINAL_EVIDENCE_MAX_ENCODED_BYTES = 64 * 1024;

const SHA_PATTERN = /^[a-f0-9]{40}$/;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const NUMERIC_ID_PATTERN = /^[1-9][0-9]*$/;
const RELEASE_ID_PATTERN = /^mr-[a-f0-9]{24}$/;
const PRODUCER_JOBS = new Set([
  "activate-and-verify",
  "recover-main-deployment",
]);
const TARGETS = Object.freeze(["governance", "reserve", "ui", "app"]);
const OPERATION_TARGETS = Object.freeze([...TARGETS]);
const OPERATION_TYPES = Object.freeze(["promote", "ordinary_rollback"]);
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
const PROOF_STATUSES = Object.freeze([
  "passed",
  "not-required",
  "superseded",
  "prepared",
  "unsafe",
]);
const JOURNAL_STATUSES = Object.freeze([
  "committed",
  "recovered",
  "recovery-failed",
  "manual-intervention",
  "not-applicable",
]);
const RECEIPT_KEYS = Object.freeze([
  "schema",
  "repository",
  "deploySha",
  "upstreamRunId",
  "upstreamRunAttempt",
  "workflowRunId",
  "producerRunAttempt",
  "producerJob",
  "releaseId",
  "releaseManifestDigest",
  "releasePlanDigest",
  "releaseExecutionDigest",
  "evidenceDigest",
  "outcome",
  "finalMapping",
  "finalCensus",
  "stateProof",
  "publicSmoke",
  "mutationCount",
  "rollbackTargets",
  "affectedOperations",
  "journal",
  "digest",
]);
const EVIDENCE_KEYS = Object.freeze([
  "schema",
  "repository",
  "deploySha",
  "upstreamRunId",
  "upstreamRunAttempt",
  "workflowRunId",
  "producerRunAttempt",
  "producerJob",
  "releaseId",
  "releaseManifestDigest",
  "releasePlanDigest",
  "releaseExecutionDigest",
  "outcome",
  "affectedOperations",
  "artifact",
]);
const PROOF_KEYS = Object.freeze(["status", "digest"]);
const JOURNAL_KEYS = Object.freeze(["status", "digest"]);
const AFFECTED_OPERATION_KEYS = Object.freeze([
  "operationId",
  "target",
  "type",
  "alias",
  "state",
  "commandOutcome",
  "mappingState",
  "rollbackState",
]);

export const MAIN_TERMINAL_RECEIPT_OUTCOMES = Object.freeze({
  "active-committed": Object.freeze({
    proofs: ["passed", "passed", "passed", "passed"],
    journal: "committed",
    minMutations: 1,
    rollback: "empty",
  }),
  recovered: Object.freeze({
    proofs: ["passed", "passed", "passed", "passed"],
    journal: "recovered",
    minMutations: 1,
    rollback: "required",
  }),
  "recovered-census-unproven": Object.freeze({
    proofs: ["passed", "unsafe", "unsafe", "passed"],
    journal: "recovered",
    minMutations: 1,
    rollback: "required",
  }),
  "verified-noop": Object.freeze({
    proofs: ["passed", "passed", "passed", "passed"],
    journal: "not-applicable",
    mutations: 0,
    rollback: "empty",
  }),
  "current-release-verified": Object.freeze({
    proofs: ["passed", "passed", "passed", "passed"],
    journal: "not-applicable",
    mutations: 0,
    rollback: "empty",
  }),
  "no-target": Object.freeze({
    proofs: ["not-required", "not-required", "not-required", "not-required"],
    journal: "not-applicable",
    mutations: 0,
    rollback: "empty",
  }),
  "superseded-before-journal": Object.freeze({
    proofs: ["superseded", "superseded", "superseded", "not-required"],
    journal: "not-applicable",
    mutations: 0,
    rollback: "empty",
  }),
  "shadow-prepared": Object.freeze({
    proofs: ["passed", "passed", "prepared", "passed"],
    journal: "not-applicable",
    mutations: 0,
    rollback: "empty",
  }),
  "manual-intervention": Object.freeze({
    proofs: ["unsafe", "unsafe", "unsafe", "not-required"],
    journal: "manual-intervention",
    minMutations: 1,
    rollback: "any",
    affectedOperations: "required",
  }),
  "recovery-failed": Object.freeze({
    proofs: ["unsafe", "unsafe", "unsafe", "not-required"],
    journal: "recovery-failed",
    rollback: "empty",
    affectedOperations: "empty",
  }),
  "preparation-failed-before-journal": Object.freeze({
    proofs: ["unsafe", "unsafe", "unsafe", "not-required"],
    journal: "not-applicable",
    mutations: 0,
    rollback: "empty",
    affectedOperations: "empty",
  }),
});

function assertExactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is malformed`);
  }
  if (JSON.stringify(Object.keys(value)) !== JSON.stringify(keys)) {
    throw new Error(`${label} keys are missing, extra, or out of order`);
  }
}

function requireString(value, label, pattern) {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new Error(`${label} is malformed`);
  }
  return value;
}

function requireId(value, label) {
  return requireString(String(value), label, NUMERIC_ID_PATTERN);
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function canonicalArtifact(value, label, depth = 0) {
  if (depth > 10) throw new Error(`${label} is too deeply nested`);
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      throw new Error(`${label} contains a noncanonical number`);
    }
    return value;
  }
  if (typeof value === "string") {
    if (value.length > 4096)
      throw new Error(`${label} contains an oversized string`);
    if (
      /\b(?:token|secret|password|authorization|cookie|private[-_ ]?key|api[-_ ]?key)\s*[:=]/i.test(
        value,
      ) ||
      /\bBearer\s+[A-Za-z0-9._~-]+/i.test(value) ||
      /:\/\/[^/\s:@]+:[^/\s@]+@/.test(value)
    ) {
      throw new Error(`${label} is not redacted`);
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > 256)
      throw new Error(`${label} contains too many entries`);
    return value.map((entry, index) =>
      canonicalArtifact(entry, `${label}[${index}]`, depth + 1),
    );
  }
  if (
    !value ||
    typeof value !== "object" ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new Error(`${label} is not JSON data`);
  }
  const keys = Object.keys(value);
  if (keys.length > 128) throw new Error(`${label} contains too many fields`);
  const canonical = {};
  for (const key of keys) {
    if (!/^[A-Za-z][A-Za-z0-9_.-]{0,127}$/.test(key)) {
      throw new Error(`${label} contains an unsafe field name`);
    }
    if (
      /(?:token|secret|password|authorization|cookie|private.?key|api.?key)/i.test(
        key,
      )
    ) {
      throw new Error(`${label} is not redacted`);
    }
    canonical[key] = canonicalArtifact(
      value[key],
      `${label}.${key}`,
      depth + 1,
    );
  }
  return canonical;
}

function receiptIdentity(value, label) {
  return {
    repository: requireString(
      value.repository,
      `${label} repository`,
      /^mento-protocol\/frontend-monorepo$/,
    ),
    deploySha: requireString(value.deploySha, `${label} SHA`, SHA_PATTERN),
    upstreamRunId: requireId(value.upstreamRunId, `${label} upstream run ID`),
    upstreamRunAttempt: requireId(
      value.upstreamRunAttempt,
      `${label} upstream run attempt`,
    ),
    workflowRunId: requireId(value.workflowRunId, `${label} workflow run ID`),
    producerRunAttempt: requireId(
      value.producerRunAttempt,
      `${label} producer run attempt`,
    ),
    producerJob: requireString(
      value.producerJob,
      `${label} producer job`,
      /^[A-Za-z0-9._-]{1,128}$/,
    ),
    releaseId: requireString(
      value.releaseId,
      `${label} release ID`,
      RELEASE_ID_PATTERN,
    ),
    releaseManifestDigest: requireString(
      value.releaseManifestDigest,
      `${label} release manifest digest`,
      DIGEST_PATTERN,
    ),
    releasePlanDigest: requireString(
      value.releasePlanDigest,
      `${label} release plan digest`,
      DIGEST_PATTERN,
    ),
    releaseExecutionDigest: requireString(
      value.releaseExecutionDigest,
      `${label} release execution digest`,
      DIGEST_PATTERN,
    ),
  };
}

function canonicalProof(value, label) {
  assertExactKeys(value, PROOF_KEYS, label);
  if (!PROOF_STATUSES.includes(value.status)) {
    throw new Error(`${label} status is malformed`);
  }
  if (value.status !== "not-required") {
    return {
      status: value.status,
      digest: requireString(value.digest, `${label} digest`, DIGEST_PATTERN),
    };
  }
  if (value.digest !== null) {
    throw new Error(`${label} not-required status must not carry a digest`);
  }
  return { status: value.status, digest: null };
}

function canonicalJournal(value) {
  assertExactKeys(value, JOURNAL_KEYS, "Main terminal receipt journal");
  if (!JOURNAL_STATUSES.includes(value.status)) {
    throw new Error("Main terminal receipt journal status is malformed");
  }
  if (value.status === "not-applicable") {
    if (value.digest !== null) {
      throw new Error(
        "Non-applicable terminal journal must not carry a digest",
      );
    }
    return { status: value.status, digest: null };
  }
  return {
    status: value.status,
    digest: requireString(
      value.digest,
      "Main terminal receipt journal digest",
      DIGEST_PATTERN,
    ),
  };
}

function canonicalRollbackTargets(value) {
  if (
    !Array.isArray(value) ||
    value.some((target) => !TARGETS.includes(target))
  ) {
    throw new Error("Main terminal receipt rollback targets are malformed");
  }
  const canonical = TARGETS.filter((target) => value.includes(target));
  if (
    new Set(value).size !== value.length ||
    JSON.stringify(value) !== JSON.stringify(canonical)
  ) {
    throw new Error("Main terminal receipt rollback targets are not canonical");
  }
  return canonical;
}

function canonicalMutationCount(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 100) {
    throw new Error("Main terminal receipt mutation count is malformed");
  }
  return value;
}

function canonicalAffectedOperations(value) {
  if (!Array.isArray(value)) {
    throw new Error("Main terminal receipt affected operations are malformed");
  }
  const operations = value.map((operation, index) => {
    assertExactKeys(
      operation,
      AFFECTED_OPERATION_KEYS,
      `Main terminal receipt affected operation ${index}`,
    );
    const operationId = requireString(
      operation.operationId,
      `Main terminal receipt affected operation ${index} ID`,
      /^op-[0-9]{4}$/,
    );
    if (!OPERATION_TARGETS.includes(operation.target)) {
      throw new Error(
        "Main terminal receipt affected operation target is malformed",
      );
    }
    if (!OPERATION_TYPES.includes(operation.type)) {
      throw new Error(
        "Main terminal receipt affected operation type is malformed",
      );
    }
    const alias =
      operation.alias === null
        ? null
        : requireString(
            operation.alias,
            "Main terminal receipt affected operation alias",
            /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/,
          );
    if (
      !OPERATION_STATES.includes(operation.state) ||
      !COMMAND_OUTCOMES.includes(operation.commandOutcome) ||
      !MAPPING_STATES.includes(operation.mappingState) ||
      !ROLLBACK_STATES.includes(operation.rollbackState)
    ) {
      throw new Error(
        "Main terminal receipt affected operation state is malformed",
      );
    }
    // Every reviewed operation binds one main target and never an alias: no
    // activation or recovery path moves a domain directly.
    if (!OPERATION_TARGETS.includes(operation.target) || alias !== null) {
      throw new Error(
        "Main terminal receipt affected operation identity is malformed",
      );
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
        (operation.commandOutcome === null ||
          operation.mappingState === null)) ||
      (operation.rollbackState === "entered" &&
        (operation.type !== "ordinary_rollback" ||
          operation.state !== "verified" ||
          operation.mappingState !== "prior")) ||
      (operation.type === "ordinary_rollback" &&
        operation.state === "verified" &&
        operation.mappingState === "prior" &&
        operation.rollbackState !== "entered")
    ) {
      throw new Error(
        "Main terminal receipt affected operation fields are inconsistent",
      );
    }
    return {
      operationId,
      target: operation.target,
      type: operation.type,
      alias,
      state: operation.state,
      commandOutcome: operation.commandOutcome,
      mappingState: operation.mappingState,
      rollbackState: operation.rollbackState,
    };
  });
  const canonical = operations.toSorted((left, right) =>
    left.operationId.localeCompare(right.operationId),
  );
  if (
    new Set(operations.map(({ operationId }) => operationId)).size !==
      operations.length ||
    JSON.stringify(operations) !== JSON.stringify(canonical)
  ) {
    throw new Error(
      "Main terminal receipt affected operations are not canonical",
    );
  }
  return canonical;
}

function assertOutcomeContract(receipt) {
  const contract = MAIN_TERMINAL_RECEIPT_OUTCOMES[receipt.outcome];
  if (!contract)
    throw new Error("Main terminal receipt outcome is unsupported");
  const proofs = [
    receipt.finalMapping,
    receipt.finalCensus,
    receipt.stateProof,
    receipt.publicSmoke,
  ];
  if (
    JSON.stringify(proofs.map((proof) => proof.status)) !==
    JSON.stringify(contract.proofs)
  ) {
    throw new Error(
      "Main terminal receipt proof statuses conflict with outcome",
    );
  }
  if (receipt.journal.status !== contract.journal) {
    throw new Error("Main terminal receipt journal conflicts with outcome");
  }
  if (
    ["recovery-failed", "recovered-census-unproven"].includes(
      receipt.outcome,
    ) &&
    receipt.producerJob !== "recover-main-deployment"
  ) {
    throw new Error(
      `${receipt.outcome} terminal receipt requires the recovery producer job`,
    );
  }
  if (
    contract.mutations !== undefined &&
    receipt.mutationCount !== contract.mutations
  ) {
    throw new Error(
      "Main terminal receipt mutation count conflicts with outcome",
    );
  }
  if (
    contract.minMutations !== undefined &&
    receipt.mutationCount < contract.minMutations
  ) {
    throw new Error("Main terminal receipt outcome requires mutations");
  }
  if (contract.rollback === "empty" && receipt.rollbackTargets.length !== 0) {
    throw new Error("Main terminal receipt outcome forbids rollback targets");
  }
  if (
    contract.rollback === "required" &&
    receipt.rollbackTargets.length === 0
  ) {
    throw new Error("Recovered terminal receipt requires rollback targets");
  }
  if (
    contract.affectedOperations === "required" &&
    receipt.affectedOperations.length === 0
  ) {
    throw new Error("Manual terminal receipt requires affected operations");
  }
  if (
    receipt.outcome === "manual-intervention" &&
    receipt.mutationCount !== receipt.affectedOperations.length
  ) {
    throw new Error(
      "Manual terminal receipt mutation count conflicts with affected operations",
    );
  }
  if (
    receipt.outcome !== "manual-intervention" &&
    receipt.affectedOperations.length !== 0
  ) {
    throw new Error("Non-manual terminal receipt forbids affected operations");
  }
}

function canonicalReceipt(value, { checkDigest = true } = {}) {
  assertExactKeys(value, RECEIPT_KEYS, "Main terminal receipt");
  if (
    value.schema !== MAIN_TERMINAL_RECEIPT_SCHEMA ||
    value.repository !== MAIN_TERMINAL_RECEIPT_REPOSITORY
  ) {
    throw new Error("Main terminal receipt schema is unsupported");
  }
  const receipt = {
    schema: value.schema,
    repository: value.repository,
    deploySha: requireString(
      value.deploySha,
      "Main terminal receipt SHA",
      SHA_PATTERN,
    ),
    upstreamRunId: requireId(
      value.upstreamRunId,
      "Main terminal receipt upstream run ID",
    ),
    upstreamRunAttempt: requireId(
      value.upstreamRunAttempt,
      "Main terminal receipt upstream run attempt",
    ),
    workflowRunId: requireId(
      value.workflowRunId,
      "Main terminal receipt workflow run ID",
    ),
    producerRunAttempt: requireId(
      value.producerRunAttempt,
      "Main terminal receipt producer run attempt",
    ),
    producerJob: requireString(
      value.producerJob,
      "Main terminal receipt producer job",
      /^[A-Za-z0-9._-]{1,128}$/,
    ),
    releaseId: requireString(
      value.releaseId,
      "Main terminal receipt release ID",
      RELEASE_ID_PATTERN,
    ),
    releaseManifestDigest: requireString(
      value.releaseManifestDigest,
      "Main terminal receipt release manifest digest",
      DIGEST_PATTERN,
    ),
    releasePlanDigest: requireString(
      value.releasePlanDigest,
      "Main terminal receipt release plan digest",
      DIGEST_PATTERN,
    ),
    releaseExecutionDigest: requireString(
      value.releaseExecutionDigest,
      "Main terminal receipt release execution digest",
      DIGEST_PATTERN,
    ),
    evidenceDigest: requireString(
      value.evidenceDigest,
      "Main terminal receipt evidence digest",
      DIGEST_PATTERN,
    ),
    outcome: requireString(
      value.outcome,
      "Main terminal receipt outcome",
      /^(?:active-committed|recovered|recovered-census-unproven|verified-noop|current-release-verified|no-target|superseded-before-journal|shadow-prepared|manual-intervention|recovery-failed|preparation-failed-before-journal)$/,
    ),
    finalMapping: canonicalProof(
      value.finalMapping,
      "Main terminal receipt final mapping",
    ),
    finalCensus: canonicalProof(
      value.finalCensus,
      "Main terminal receipt final census",
    ),
    stateProof: canonicalProof(
      value.stateProof,
      "Main terminal receipt state proof",
    ),
    publicSmoke: canonicalProof(
      value.publicSmoke,
      "Main terminal receipt public smoke",
    ),
    mutationCount: canonicalMutationCount(value.mutationCount),
    rollbackTargets: canonicalRollbackTargets(value.rollbackTargets),
    affectedOperations: canonicalAffectedOperations(value.affectedOperations),
    journal: canonicalJournal(value.journal),
    digest: requireString(
      value.digest,
      "Main terminal receipt digest",
      DIGEST_PATTERN,
    ),
  };
  if (!PRODUCER_JOBS.has(receipt.producerJob)) {
    throw new Error("Main terminal receipt producer job is unsupported");
  }
  assertOutcomeContract(receipt);
  const selfDigest = digest(
    Object.fromEntries(
      Object.entries(receipt).filter(([key]) => key !== "digest"),
    ),
  );
  if (checkDigest && receipt.digest !== selfDigest) {
    throw new Error("Main terminal receipt self digest does not match");
  }
  return receipt;
}

/** Creates the only durable final-job handoff; it contains proof digests, never artifacts. */
export function createMainTerminalReceipt(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Main terminal receipt input is malformed");
  }
  const draft = {
    schema: MAIN_TERMINAL_RECEIPT_SCHEMA,
    repository: MAIN_TERMINAL_RECEIPT_REPOSITORY,
    deploySha: input.deploySha,
    upstreamRunId: input.upstreamRunId,
    upstreamRunAttempt: input.upstreamRunAttempt,
    workflowRunId: input.workflowRunId,
    producerRunAttempt: input.producerRunAttempt,
    producerJob: input.producerJob,
    releaseId: input.releaseId,
    releaseManifestDigest: input.releaseManifestDigest,
    releasePlanDigest: input.releasePlanDigest,
    releaseExecutionDigest: input.releaseExecutionDigest,
    evidenceDigest: input.evidenceDigest,
    outcome: input.outcome,
    finalMapping: input.finalMapping,
    finalCensus: input.finalCensus,
    stateProof: input.stateProof,
    publicSmoke: input.publicSmoke,
    mutationCount: input.mutationCount,
    rollbackTargets: input.rollbackTargets,
    affectedOperations: input.affectedOperations,
    journal: input.journal,
    digest: "0".repeat(64),
  };
  const canonical = canonicalReceipt(draft, { checkDigest: false });
  return {
    ...canonical,
    digest: digest(
      Object.fromEntries(
        Object.entries(canonical).filter(([key]) => key !== "digest"),
      ),
    ),
  };
}

export function assertMainTerminalReceipt(value, expected = {}) {
  const receipt = canonicalReceipt(value);
  const expectedIdentity = {
    repository: MAIN_TERMINAL_RECEIPT_REPOSITORY,
    deploySha: expected.deploySha,
    upstreamRunId: expected.upstreamRunId,
    upstreamRunAttempt: expected.upstreamRunAttempt,
    workflowRunId: expected.workflowRunId,
    releaseId: expected.releaseId,
    releaseManifestDigest: expected.releaseManifestDigest,
    releasePlanDigest: expected.releasePlanDigest,
    releaseExecutionDigest: expected.releaseExecutionDigest,
  };
  for (const [key, value] of Object.entries(expectedIdentity)) {
    if (value !== undefined && receipt[key] !== String(value)) {
      throw new Error(
        `Main terminal receipt ${key} conflicts with expected identity`,
      );
    }
  }
  if (expected.finalRunAttempt !== undefined) {
    const finalAttempt = requireId(
      expected.finalRunAttempt,
      "Expected final run attempt",
    );
    if (BigInt(receipt.producerRunAttempt) > BigInt(finalAttempt)) {
      throw new Error(
        "Main terminal receipt producer attempt exceeds final attempt",
      );
    }
  }
  return receipt;
}

export function encodeMainTerminalReceipt(receipt) {
  const canonical = assertMainTerminalReceipt(receipt);
  const encoded = Buffer.from(JSON.stringify(canonical)).toString("base64url");
  if (
    Buffer.byteLength(encoded, "utf8") > MAIN_TERMINAL_RECEIPT_MAX_ENCODED_BYTES
  ) {
    throw new Error(
      "Main terminal receipt exceeds the GitHub output size bound",
    );
  }
  return encoded;
}

export function decodeMainTerminalReceipt(encoded, expected = {}) {
  if (typeof encoded !== "string" || !/^[A-Za-z0-9_-]+$/.test(encoded)) {
    throw new Error("Main terminal receipt output is malformed");
  }
  if (
    Buffer.byteLength(encoded, "utf8") > MAIN_TERMINAL_RECEIPT_MAX_ENCODED_BYTES
  ) {
    throw new Error(
      "Main terminal receipt output exceeds the GitHub output size bound",
    );
  }
  let parsed;
  try {
    const decoded = Buffer.from(encoded, "base64url");
    if (decoded.toString("base64url") !== encoded) {
      throw new Error("noncanonical base64url");
    }
    parsed = JSON.parse(decoded.toString("utf8"));
  } catch {
    throw new Error("Main terminal receipt output cannot be decoded");
  }
  return assertMainTerminalReceipt(parsed, expected);
}

function canonicalEvidence(value) {
  assertExactKeys(value, EVIDENCE_KEYS, "Main terminal evidence");
  if (value.schema !== MAIN_TERMINAL_EVIDENCE_SCHEMA) {
    throw new Error("Main terminal evidence schema is unsupported");
  }
  const identity = receiptIdentity(value, "Main terminal evidence");
  if (identity.repository !== MAIN_TERMINAL_RECEIPT_REPOSITORY) {
    throw new Error("Main terminal evidence repository is unsupported");
  }
  if (!PRODUCER_JOBS.has(identity.producerJob)) {
    throw new Error("Main terminal evidence producer job is unsupported");
  }
  const outcome = requireString(
    value.outcome,
    "Main terminal evidence outcome",
    /^(?:active-committed|recovered|recovered-census-unproven|verified-noop|current-release-verified|no-target|superseded-before-journal|shadow-prepared|manual-intervention|recovery-failed|preparation-failed-before-journal)$/,
  );
  if (!MAIN_TERMINAL_RECEIPT_OUTCOMES[outcome]) {
    throw new Error("Main terminal evidence outcome is unsupported");
  }
  if (
    ["recovery-failed", "recovered-census-unproven"].includes(outcome) &&
    identity.producerJob !== "recover-main-deployment"
  ) {
    throw new Error(
      `${outcome} terminal evidence requires the recovery producer job`,
    );
  }
  if (
    !value.artifact ||
    typeof value.artifact !== "object" ||
    Array.isArray(value.artifact)
  ) {
    throw new Error("Main terminal evidence artifact is malformed");
  }
  return {
    schema: value.schema,
    ...identity,
    outcome,
    affectedOperations: canonicalAffectedOperations(value.affectedOperations),
    artifact: canonicalArtifact(
      value.artifact,
      "Main terminal evidence artifact",
    ),
  };
}

export function createMainTerminalEvidence(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Main terminal evidence input is malformed");
  }
  return canonicalEvidence({
    schema: MAIN_TERMINAL_EVIDENCE_SCHEMA,
    repository: MAIN_TERMINAL_RECEIPT_REPOSITORY,
    deploySha: input.deploySha,
    upstreamRunId: input.upstreamRunId,
    upstreamRunAttempt: input.upstreamRunAttempt,
    workflowRunId: input.workflowRunId,
    producerRunAttempt: input.producerRunAttempt,
    producerJob: input.producerJob,
    releaseId: input.releaseId,
    releaseManifestDigest: input.releaseManifestDigest,
    releasePlanDigest: input.releasePlanDigest,
    releaseExecutionDigest: input.releaseExecutionDigest,
    outcome: input.outcome,
    affectedOperations: input.affectedOperations,
    artifact: input.artifact,
  });
}

export function digestMainTerminalEvidence(evidence) {
  return digest(canonicalEvidence(evidence));
}

export function assertMainTerminalEvidence(value, expected = {}) {
  const evidence = canonicalEvidence(value);
  const receipt =
    expected.receipt === undefined
      ? null
      : assertMainTerminalReceipt(expected.receipt);
  const expectedIdentity = receipt ?? expected;
  for (const key of [
    "repository",
    "deploySha",
    "upstreamRunId",
    "upstreamRunAttempt",
    "workflowRunId",
    "producerRunAttempt",
    "producerJob",
    "releaseId",
    "releaseManifestDigest",
    "releasePlanDigest",
    "releaseExecutionDigest",
    "outcome",
  ]) {
    if (
      expectedIdentity[key] !== undefined &&
      evidence[key] !== String(expectedIdentity[key])
    ) {
      throw new Error(
        `Main terminal evidence ${key} conflicts with expected identity`,
      );
    }
  }
  if (
    expectedIdentity.affectedOperations !== undefined &&
    JSON.stringify(evidence.affectedOperations) !==
      JSON.stringify(expectedIdentity.affectedOperations)
  ) {
    throw new Error(
      "Main terminal evidence affectedOperations conflicts with expected identity",
    );
  }
  const expectedDigest = receipt?.evidenceDigest ?? expected.evidenceDigest;
  if (expectedDigest !== undefined && digest(evidence) !== expectedDigest) {
    throw new Error("Main terminal evidence digest conflicts with receipt");
  }
  return evidence;
}

export function encodeMainTerminalEvidence(evidence) {
  const canonical = assertMainTerminalEvidence(evidence);
  const encoded = Buffer.from(JSON.stringify(canonical)).toString("base64url");
  if (
    Buffer.byteLength(encoded, "utf8") >
    MAIN_TERMINAL_EVIDENCE_MAX_ENCODED_BYTES
  ) {
    throw new Error(
      "Main terminal evidence exceeds the GitHub output size bound",
    );
  }
  return encoded;
}

export function decodeMainTerminalEvidence(encoded, expected = {}) {
  if (typeof encoded !== "string" || !/^[A-Za-z0-9_-]+$/.test(encoded)) {
    throw new Error("Main terminal evidence output is malformed");
  }
  if (
    Buffer.byteLength(encoded, "utf8") >
    MAIN_TERMINAL_EVIDENCE_MAX_ENCODED_BYTES
  ) {
    throw new Error(
      "Main terminal evidence output exceeds the GitHub output size bound",
    );
  }
  let parsed;
  try {
    const decoded = Buffer.from(encoded, "base64url");
    if (decoded.toString("base64url") !== encoded)
      throw new Error("noncanonical base64url");
    const serialized = decoded.toString("utf8");
    parsed = JSON.parse(serialized);
    if (JSON.stringify(parsed) !== serialized) {
      throw new Error("noncanonical JSON");
    }
  } catch {
    throw new Error("Main terminal evidence output cannot be decoded");
  }
  return assertMainTerminalEvidence(parsed, expected);
}
