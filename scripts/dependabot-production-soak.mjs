#!/usr/bin/env node

import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  canonicalJson,
  verifyOsvActionsCompanionPlan,
} from "./dependabot-actions-companion.mjs";
import {
  ACTIONS_COMPANION_LIVE_CENSUS_SCHEMA,
  ACTIONS_COMPANION_LIVE_OPEN_SCHEMA,
  ACTIONS_COMPANION_LIVE_STAGE_SCHEMA,
} from "./dependabot-actions-companion-live.mjs";

export const DEPENDABOT_PRODUCTION_SOAK_SCHEMA =
  "dependabot-production-soak:v1";
export const DEPENDABOT_ACTIONS_COMPANION_SOAK_PARTIAL_SCHEMA =
  "dependabot-actions-companion-soak-partial:v1";
export const DEPENDABOT_ACTIONS_COMPANION_SOAK_SCHEMA =
  "dependabot-actions-companion-soak:v1";

const MAX_CENSUS_RECEIPT_BYTES = 8 * 1024 * 1024 + 1;
const MAX_STAGE_RECEIPT_BYTES = 8 * 1024 + 1;
const MAX_OPEN_RECEIPT_BYTES = 8 * 1024 + 1;
const MAX_PULL_SNAPSHOT_BYTES = 512 * 1024;
const MAX_SOAK_MANIFEST_BYTES = 1024 * 1024;
export const MAX_DEPENDABOT_ACTIONS_COMPANION_SOAK_BYTES = 16 * 1024;

const CASE_ORDER = Object.freeze([
  "native-green-npm",
  "stale-npm",
  "repairable-npm",
  "routine-actions",
  "manual-actions",
  "typed-actions-companion",
]);

const CASE_LABELS = Object.freeze({
  "native-green-npm": "Native green npm",
  "stale-npm": "Stale npm",
  "repairable-npm": "Repairable npm",
  "routine-actions": "Routine Actions",
  "manual-actions": "Manual Actions",
  "typed-actions-companion": "Typed Actions companion",
});

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const ALL_CLEAR_EXTERNAL_ID_PATTERN =
  /^dependabot-all-clear:v1:pr=(\d+):head=([0-9a-f]{40}):base=([0-9a-f]{40}):digest=([0-9a-f]{64}):run=(\d+):attempt=(\d+)$/;
const PROCESSOR_EXTERNAL_ID_PATTERN =
  /^dependabot-processor:v2:pr=(\d+):head=([0-9a-f]{40}):mode=prepare:repair=(\d+):packet=false:digest=none:run=(\d+):attempt=(\d+)$/;
const POST_MERGE_EXTERNAL_ID_PATTERN = /^dependabot-post-merge:(\d+):(\d+)$/;
const PREPARE_BOT_LOGIN = "mento-dependabot-prepare[bot]";
const TYPED_COMPANION_REPOSITORY = "mento-protocol/frontend-monorepo";
const TYPED_ACTIONS_DEPENDENCIES = Object.freeze([
  "google/osv-scanner-action/osv-reporter-action",
  "google/osv-scanner-action/osv-scanner-action",
]);
const PREPARED_OPERATION_KINDS = new Set([
  "next-catalog-override-sync",
  "vercel-cli-runtime-sync",
]);

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function exactKeys(value, keys, label) {
  invariant(
    value !== null && typeof value === "object" && !Array.isArray(value),
    `${label} must be an object`,
  );
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  invariant(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${label} keys are invalid`,
  );
}

function canonicalJsonBytes(value) {
  return Buffer.from(`${canonicalJson(value)}\n`, "utf8");
}

function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function bytes(value, label) {
  const result = Buffer.isBuffer(value) ? value : Buffer.from(value);
  invariant(result.byteLength > 0, `${label} must not be empty`);
  return result;
}

function parseJsonBytes(
  value,
  label,
  maximumBytes,
  { canonical = false } = {},
) {
  const rawBytes = bytes(value, label);
  invariant(
    rawBytes.byteLength <= maximumBytes,
    `${label} exceeds its byte limit`,
  );
  const raw = rawBytes.toString("utf8");
  invariant(
    Buffer.from(raw, "utf8").equals(rawBytes),
    `${label} is not strict UTF-8`,
  );
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    invariant(false, `${label} is not valid JSON`);
  }
  if (canonical) {
    invariant(
      raw === `${canonicalJson(parsed)}\n`,
      `${label} is not canonical JSON with one trailing LF`,
    );
  }
  return { bytes: rawBytes, parsed };
}

function writeNewCanonicalJson(path, value, label, maximumBytes) {
  nonEmptyString(path, `${label} output path`);
  const output = canonicalJsonBytes(value);
  invariant(
    output.byteLength <= maximumBytes,
    `${label} exceeds its byte limit`,
  );
  writeFileSync(resolve(path), output, { flag: "wx", mode: 0o600 });
}

function positiveInteger(value, label) {
  invariant(
    Number.isSafeInteger(value) && value > 0,
    `${label} must be a positive integer`,
  );
}

function nonNegativeInteger(value, label) {
  invariant(
    Number.isSafeInteger(value) && value >= 0,
    `${label} must be a non-negative integer`,
  );
}

function exactSha(value, label) {
  invariant(SHA_PATTERN.test(value ?? ""), `${label} must be a full SHA`);
}

function exactDigest(value, label) {
  invariant(
    DIGEST_PATTERN.test(value ?? ""),
    `${label} must be a SHA-256 digest`,
  );
}

function exactTimestamp(value, label) {
  invariant(
    ISO_TIMESTAMP_PATTERN.test(value ?? "") &&
      Number.isFinite(Date.parse(value)),
    `${label} must be a UTC timestamp without fractional seconds`,
  );
}

function nonEmptyString(value, label) {
  invariant(
    typeof value === "string" && value.trim() === value && value.length > 0,
    `${label} must be a non-empty trimmed string`,
  );
}

function pullRequestUrl(repository, number) {
  return `https://github.com/${repository}/pull/${number}`;
}

function checkUrl(repository, checkId) {
  return `https://github.com/${repository}/runs/${checkId}`;
}

function workflowRunUrl(repository, runId) {
  return `https://github.com/${repository}/actions/runs/${runId}`;
}

function receiptProjection(receiptSha256, schema, result, label) {
  exactDigest(receiptSha256, `${label}.receiptSha256`);
  nonEmptyString(schema, `${label}.schema`);
  nonEmptyString(result, `${label}.result`);
  return { receiptSha256, result, schema };
}

function validateReceiptProjection(value, expected, label) {
  exactKeys(value, ["receiptSha256", "result", "schema"], label);
  exactDigest(value.receiptSha256, `${label}.receiptSha256`);
  invariant(
    value.schema === expected.schema &&
      (Array.isArray(expected.result)
        ? expected.result.includes(value.result)
        : value.result === expected.result),
    `${label} schema or result is invalid`,
  );
}

function sourcePullProjection(sourcePull, repository) {
  return {
    authorLogin: sourcePull.author.login,
    baseRef: sourcePull.base.ref,
    baseSha: sourcePull.base.sha,
    headRef: sourcePull.head.ref,
    headSha: sourcePull.head.sha,
    mergedAt: null,
    mergeSha: null,
    number: sourcePull.number,
    state: sourcePull.state,
    url: pullRequestUrl(repository, sourcePull.number),
  };
}

function exactBindings(actual, expected, label) {
  for (const [key, value] of Object.entries(expected)) {
    invariant(actual?.[key] === value, `${label}.${key} does not match`);
  }
}

function validateCensusReceiptBytes(value) {
  const parsed = parseJsonBytes(
    value,
    "companion census receipt",
    MAX_CENSUS_RECEIPT_BYTES,
    { canonical: true },
  );
  const receipt = parsed.parsed;
  exactKeys(
    receipt,
    [
      "authority",
      "censusDigest",
      "input",
      "orchestratorRunAttempt",
      "orchestratorRunId",
      "plan",
      "processorRunAttempt",
      "processorRunId",
      "repository",
      "result",
      "schema",
      "sourceHeadSha",
      "sourcePullRequestNumber",
      "workflowSha",
    ],
    "companion census receipt",
  );
  exactBindings(
    receipt,
    {
      repository: TYPED_COMPANION_REPOSITORY,
      result: "planned",
      schema: ACTIONS_COMPANION_LIVE_CENSUS_SCHEMA,
    },
    "companion census receipt",
  );
  exactDigest(receipt.censusDigest, "companion census receipt.censusDigest");
  const { censusDigest, ...core } = receipt;
  invariant(
    censusDigest === sha256Bytes(Buffer.from(canonicalJson(core), "utf8")),
    "companion census receipt self-digest is invalid",
  );
  for (const key of [
    "orchestratorRunAttempt",
    "orchestratorRunId",
    "processorRunAttempt",
    "processorRunId",
    "sourcePullRequestNumber",
  ]) {
    positiveInteger(receipt[key], `companion census receipt.${key}`);
  }
  exactSha(receipt.sourceHeadSha, "companion census receipt.sourceHeadSha");
  exactSha(receipt.workflowSha, "companion census receipt.workflowSha");
  invariant(
    verifyOsvActionsCompanionPlan(receipt.input, receipt.plan).eligible,
    "companion census receipt plan is invalid",
  );
  const sourcePull = receipt.input.sourcePullRequest;
  const pr = sourcePullProjection(sourcePull, receipt.repository);
  validatePullRequest(
    pr,
    receipt.repository,
    "open",
    "companion census receipt",
  );
  const dependencyNames = sourcePull.metadata.dependencies.map(
    ({ name }) => name,
  );
  invariant(
    sourcePull.metadata.dependencyGroup === "github-actions-manual" &&
      sourcePull.metadata.packageEcosystem === "github-actions" &&
      JSON.stringify([...dependencyNames].sort()) ===
        JSON.stringify(TYPED_ACTIONS_DEPENDENCIES) &&
      receipt.input.processor.disposition === "manual-review" &&
      sourcePull.number === receipt.sourcePullRequestNumber &&
      sourcePull.head.sha === receipt.sourceHeadSha &&
      sourcePull.base.sha === receipt.input.currentBase.commitSha,
    "companion census receipt source or classification is invalid",
  );
  exactDigest(
    receipt.plan.planDigest,
    "companion census receipt.plan.planDigest",
  );
  exactKeys(
    receipt.authority.processor,
    ["checkId", "runAttempt", "runId"],
    "companion census receipt.authority.processor",
  );
  positiveInteger(
    receipt.authority.processor.checkId,
    "companion census receipt.authority.processor.checkId",
  );
  invariant(
    receipt.authority.processor.runId === receipt.processorRunId &&
      receipt.authority.processor.runAttempt === receipt.processorRunAttempt,
    "companion census receipt processor binding is invalid",
  );
  return {
    dependencyNames,
    pr,
    receipt,
    receiptSha256: sha256Bytes(parsed.bytes),
  };
}

function validateStageReceiptBytes(value, census) {
  const parsed = parseJsonBytes(
    value,
    "companion stage receipt",
    MAX_STAGE_RECEIPT_BYTES,
    { canonical: true },
  );
  const receipt = parsed.parsed;
  exactSha(receipt.commitSha, "companion stage receipt.commitSha");
  exactDigest(receipt.planDigest, "companion stage receipt.planDigest");
  exactBindings(
    receipt,
    {
      branchRef: census.receipt.plan.branchRef,
      orchestratorRunAttempt: census.receipt.orchestratorRunAttempt,
      orchestratorRunId: census.receipt.orchestratorRunId,
      parentCommitSha: census.pr.baseSha,
      planDigest: census.receipt.plan.planDigest,
      processorRunAttempt: census.receipt.processorRunAttempt,
      processorRunId: census.receipt.processorRunId,
      repository: census.receipt.repository,
      result: "staged",
      schema: ACTIONS_COMPANION_LIVE_STAGE_SCHEMA,
      sourceHeadSha: census.receipt.sourceHeadSha,
      sourcePullRequestNumber: census.receipt.sourcePullRequestNumber,
      workflowSha: census.receipt.workflowSha,
    },
    "companion stage receipt",
  );
  return { receipt, receiptSha256: sha256Bytes(parsed.bytes) };
}

export function createDependabotActionsCompanionSoakPartial({
  censusReceiptBytes,
  stageReceiptBytes,
}) {
  const census = validateCensusReceiptBytes(censusReceiptBytes);
  const stage = validateStageReceiptBytes(stageReceiptBytes, census);
  invariant(
    census.receiptSha256 !== stage.receiptSha256,
    "companion census and stage receipt hashes must be distinct",
  );
  const partial = {
    companion: {
      branchRef: stage.receipt.branchRef,
      commitSha: stage.receipt.commitSha,
    },
    planDigest: stage.receipt.planDigest,
    pr: census.pr,
    processor: {
      checkId: census.receipt.authority.processor.checkId,
      dependencyGroup: "github-actions-manual",
      dependencyNames: census.dependencyNames,
      disposition: "manual-review",
      headSha: census.receipt.sourceHeadSha,
      workflowRunAttempt: census.receipt.processorRunAttempt,
      workflowRunId: census.receipt.processorRunId,
      workflowSha: census.receipt.workflowSha,
    },
    receipts: {
      census: receiptProjection(
        census.receiptSha256,
        census.receipt.schema,
        census.receipt.result,
        "companion census projection",
      ),
      stage: receiptProjection(
        stage.receiptSha256,
        stage.receipt.schema,
        stage.receipt.result,
        "companion stage projection",
      ),
    },
    repository: census.receipt.repository,
    schema: DEPENDABOT_ACTIONS_COMPANION_SOAK_PARTIAL_SCHEMA,
    workflow: {
      runAttempt: census.receipt.orchestratorRunAttempt,
      runId: census.receipt.orchestratorRunId,
      workflowSha: census.receipt.workflowSha,
    },
  };
  validateDependabotActionsCompanionSoakPartial(partial);
  invariant(
    canonicalJsonBytes(partial).byteLength <=
      MAX_DEPENDABOT_ACTIONS_COMPANION_SOAK_BYTES,
    "companion soak partial exceeds its byte limit",
  );
  return partial;
}

export function validateDependabotActionsCompanionSoakPartial(partial) {
  exactKeys(
    partial,
    [
      "companion",
      "planDigest",
      "pr",
      "processor",
      "receipts",
      "repository",
      "schema",
      "workflow",
    ],
    "companion soak partial",
  );
  invariant(
    partial.schema === DEPENDABOT_ACTIONS_COMPANION_SOAK_PARTIAL_SCHEMA &&
      partial.repository === TYPED_COMPANION_REPOSITORY,
    "companion soak partial identity is invalid",
  );
  validatePullRequest(
    partial.pr,
    partial.repository,
    "open",
    "companion soak partial",
  );
  exactDigest(partial.planDigest, "companion soak partial.planDigest");
  exactKeys(
    partial.companion,
    ["branchRef", "commitSha"],
    "companion soak partial.companion",
  );
  exactSha(
    partial.companion.commitSha,
    "companion soak partial.companion.commitSha",
  );
  invariant(
    partial.companion.branchRef ===
      `dependabot-companion/osv-pr-${partial.pr.number}-${partial.pr.headSha.slice(0, 12)}`,
    "companion soak partial branch does not bind the source pull request",
  );
  validateTypedCompanionProcessor(
    partial.processor,
    partial.pr,
    partial.workflow,
    "companion soak partial",
  );
  exactKeys(
    partial.receipts,
    ["census", "stage"],
    "companion soak partial.receipts",
  );
  validateReceiptProjection(
    partial.receipts.census,
    { result: "planned", schema: ACTIONS_COMPANION_LIVE_CENSUS_SCHEMA },
    "companion soak partial.receipts.census",
  );
  validateReceiptProjection(
    partial.receipts.stage,
    { result: "staged", schema: ACTIONS_COMPANION_LIVE_STAGE_SCHEMA },
    "companion soak partial.receipts.stage",
  );
  invariant(
    partial.receipts.census.receiptSha256 !==
      partial.receipts.stage.receiptSha256,
    "companion soak partial receipt hashes must be distinct",
  );
  return partial;
}

function validateOpenReceiptBytes(value, partial) {
  const parsed = parseJsonBytes(
    value,
    "companion open receipt",
    MAX_OPEN_RECEIPT_BYTES,
    { canonical: true },
  );
  const receipt = parsed.parsed;
  invariant(
    new Set(["opened", "already-open"]).has(receipt.result),
    "companion open receipt result is invalid",
  );
  exactBindings(
    receipt,
    {
      branchRef: partial.companion.branchRef,
      commitSha: partial.companion.commitSha,
      orchestratorRunAttempt: partial.workflow.runAttempt,
      orchestratorRunId: partial.workflow.runId,
      planDigest: partial.planDigest,
      processorRunAttempt: partial.processor.workflowRunAttempt,
      processorRunId: partial.processor.workflowRunId,
      repository: partial.repository,
      schema: ACTIONS_COMPANION_LIVE_OPEN_SCHEMA,
      sourceHeadSha: partial.pr.headSha,
      sourcePullRequestNumber: partial.pr.number,
      workflowSha: partial.workflow.workflowSha,
    },
    "companion open receipt",
  );
  exactKeys(
    receipt.companionPullRequest,
    ["baseSha", "draft", "headSha", "number", "state", "url"],
    "companion open receipt.companionPullRequest",
  );
  positiveInteger(
    receipt.companionPullRequest.number,
    "companion open receipt.companionPullRequest.number",
  );
  invariant(
    receipt.companionPullRequest.baseSha === partial.pr.baseSha &&
      receipt.companionPullRequest.draft === false &&
      receipt.companionPullRequest.headSha === partial.companion.commitSha &&
      receipt.companionPullRequest.state === "open" &&
      receipt.companionPullRequest.url ===
        pullRequestUrl(partial.repository, receipt.companionPullRequest.number),
    "companion open receipt pull request binding is invalid",
  );
  return { receipt, receiptSha256: sha256Bytes(parsed.bytes) };
}

function validateConfirmedCompanionPull(value, partial, openReceipt) {
  const parsed = parseJsonBytes(
    value,
    "confirmed companion pull request snapshot",
    MAX_PULL_SNAPSHOT_BYTES,
  );
  const pull = parsed.parsed;
  positiveInteger(pull?.number, "confirmed companion pull request.number");
  positiveInteger(pull?.user?.id, "confirmed companion pull request.user.id");
  invariant(
    pull.number === openReceipt.companionPullRequest.number &&
      pull.html_url === openReceipt.companionPullRequest.url &&
      pull.state === "open" &&
      pull.draft === false &&
      pull.merged_at === null &&
      pull.auto_merge === null &&
      pull.maintainer_can_modify === false &&
      pull.user.login === PREPARE_BOT_LOGIN &&
      pull.user.type === "Bot" &&
      pull.head?.ref === partial.companion.branchRef &&
      pull.head?.sha === partial.companion.commitSha &&
      pull.head?.repo?.full_name === partial.repository &&
      pull.base?.ref === "main" &&
      pull.base?.sha === partial.pr.baseSha &&
      pull.base?.repo?.full_name === partial.repository,
    "confirmed companion pull request does not bind the open receipt",
  );
  return {
    authorLogin: pull.user.login,
    baseRef: pull.base.ref,
    baseSha: pull.base.sha,
    headRef: pull.head.ref,
    headSha: pull.head.sha,
    mergedAt: pull.merged_at,
    mergeSha: null,
    number: pull.number,
    state: pull.state,
    url: pull.html_url,
  };
}

function currentTimestamp() {
  return new Date().toISOString().replace(/\.\d{3}Z$/u, "Z");
}

export function createDependabotActionsCompanionSoakArtifact({
  capturedAt = currentTimestamp(),
  openReceiptBytes,
  partialBytes,
  pullSnapshotBytes,
}) {
  exactTimestamp(capturedAt, "companion soak artifact.capturedAt");
  const partial = parseJsonBytes(
    partialBytes,
    "companion soak partial",
    MAX_DEPENDABOT_ACTIONS_COMPANION_SOAK_BYTES,
    { canonical: true },
  ).parsed;
  validateDependabotActionsCompanionSoakPartial(partial);
  const open = validateOpenReceiptBytes(openReceiptBytes, partial);
  invariant(
    new Set([
      partial.receipts.census.receiptSha256,
      partial.receipts.stage.receiptSha256,
      open.receiptSha256,
    ]).size === 3,
    "companion receipt hashes must be distinct",
  );
  const companionPullRequest = validateConfirmedCompanionPull(
    pullSnapshotBytes,
    partial,
    open.receipt,
  );
  const artifact = {
    capturedAt,
    case: {
      companion: {
        ...partial.companion,
        pr: companionPullRequest,
      },
      id: "typed-actions-companion",
      planDigest: partial.planDigest,
      pr: partial.pr,
      processor: partial.processor,
      receipts: {
        ...partial.receipts,
        open: receiptProjection(
          open.receiptSha256,
          open.receipt.schema,
          open.receipt.result,
          "companion open projection",
        ),
      },
      status: "passed",
      summary:
        "A production run created and bound an exact typed OSV companion pull request.",
      workflow: partial.workflow,
    },
    repository: partial.repository,
    schema: DEPENDABOT_ACTIONS_COMPANION_SOAK_SCHEMA,
  };
  validateDependabotActionsCompanionSoakArtifact(artifact);
  invariant(
    canonicalJsonBytes(artifact).byteLength <=
      MAX_DEPENDABOT_ACTIONS_COMPANION_SOAK_BYTES,
    "companion soak artifact exceeds its byte limit",
  );
  return artifact;
}

export function validateDependabotActionsCompanionSoakArtifact(artifact) {
  exactKeys(
    artifact,
    ["capturedAt", "case", "repository", "schema"],
    "companion soak artifact",
  );
  invariant(
    artifact.schema === DEPENDABOT_ACTIONS_COMPANION_SOAK_SCHEMA &&
      artifact.repository === TYPED_COMPANION_REPOSITORY,
    "companion soak artifact identity is invalid",
  );
  exactTimestamp(artifact.capturedAt, "companion soak artifact.capturedAt");
  validateTypedActionsCompanionCase(artifact.case, {
    repository: artifact.repository,
  });
  return artifact;
}

export function importDependabotActionsCompanionSoakArtifact({
  artifactBytes,
  manifest,
}) {
  const artifact = parseJsonBytes(
    artifactBytes,
    "companion soak artifact",
    MAX_DEPENDABOT_ACTIONS_COMPANION_SOAK_BYTES,
    { canonical: true },
  ).parsed;
  validateDependabotActionsCompanionSoakArtifact(artifact);
  validateDependabotProductionSoakManifest(manifest);
  invariant(
    artifact.repository === manifest.repository,
    "companion soak artifact repository does not match the manifest",
  );
  invariant(
    Date.parse(artifact.capturedAt) >= Date.parse(manifest.capturedAt),
    "companion soak artifact predates the manifest capture",
  );
  const imported = structuredClone(manifest);
  imported.capturedAt = artifact.capturedAt;
  const typedIndex = imported.cases.findIndex(
    ({ id }) => id === "typed-actions-companion",
  );
  invariant(
    typedIndex >= 0,
    "typed companion case is missing from the manifest",
  );
  imported.cases[typedIndex] = structuredClone(artifact.case);
  validateDependabotProductionSoakManifest(imported);
  return imported;
}

function validatePullRequest(pr, repository, expectedState, label) {
  exactKeys(
    pr,
    [
      "authorLogin",
      "baseRef",
      "baseSha",
      "headRef",
      "headSha",
      "mergedAt",
      "mergeSha",
      "number",
      "state",
      "url",
    ],
    `${label}.pr`,
  );
  positiveInteger(pr.number, `${label}.pr.number`);
  invariant(
    pr.url === pullRequestUrl(repository, pr.number),
    `${label}.pr.url is not canonical`,
  );
  invariant(
    pr.authorLogin === "dependabot[bot]",
    `${label}.pr.authorLogin is not Dependabot`,
  );
  invariant(pr.baseRef === "main", `${label}.pr.baseRef must be main`);
  exactSha(pr.baseSha, `${label}.pr.baseSha`);
  exactSha(pr.headSha, `${label}.pr.headSha`);
  invariant(
    typeof pr.headRef === "string" && pr.headRef.startsWith("dependabot/"),
    `${label}.pr.headRef is not a Dependabot ref`,
  );
  invariant(pr.state === expectedState, `${label}.pr.state is invalid`);
  if (expectedState === "merged") {
    exactSha(pr.mergeSha, `${label}.pr.mergeSha`);
    exactTimestamp(pr.mergedAt, `${label}.pr.mergedAt`);
  } else {
    invariant(pr.mergeSha === null, `${label}.pr.mergeSha must be null`);
    invariant(pr.mergedAt === null, `${label}.pr.mergedAt must be null`);
  }
}

function validatePreparation(preparation, label) {
  exactKeys(
    preparation,
    ["kind", "operationKinds", "refreshCount", "repairCount", "seedHeadSha"],
    label,
  );
  invariant(
    preparation.kind === "native" || preparation.kind === "prepared",
    `${label}.kind is invalid`,
  );
  exactSha(preparation.seedHeadSha, `${label}.seedHeadSha`);
  nonNegativeInteger(preparation.refreshCount, `${label}.refreshCount`);
  nonNegativeInteger(preparation.repairCount, `${label}.repairCount`);
  invariant(
    preparation.repairCount <= 2,
    `${label}.repairCount exceeds the bounded repair budget`,
  );
  invariant(
    Array.isArray(preparation.operationKinds),
    `${label}.operationKinds must be an array`,
  );
  invariant(
    preparation.operationKinds.every((kind) =>
      PREPARED_OPERATION_KINDS.has(kind),
    ) &&
      new Set(preparation.operationKinds).size ===
        preparation.operationKinds.length,
    `${label}.operationKinds are invalid`,
  );
  if (preparation.kind === "native") {
    invariant(
      preparation.refreshCount === 0 &&
        preparation.repairCount === 0 &&
        preparation.operationKinds.length === 0,
      `${label} native evidence cannot contain mutations`,
    );
  }
}

function validateAllClear(allClear, pr, repository, label) {
  exactKeys(
    allClear,
    [
      "autoMergeEnabled",
      "baseSha",
      "checkId",
      "conclusion",
      "externalId",
      "headSha",
      "mergeAuthorizedByAutomation",
      "preparation",
      "processorApprovalId",
      "riskTier",
      "updateType",
      "workflowRunAttempt",
      "workflowRunId",
      "workflowSha",
    ],
    `${label}.allClear`,
  );
  positiveInteger(allClear.checkId, `${label}.allClear.checkId`);
  positiveInteger(
    allClear.processorApprovalId,
    `${label}.allClear.processorApprovalId`,
  );
  positiveInteger(allClear.workflowRunId, `${label}.allClear.workflowRunId`);
  positiveInteger(
    allClear.workflowRunAttempt,
    `${label}.allClear.workflowRunAttempt`,
  );
  exactSha(allClear.workflowSha, `${label}.allClear.workflowSha`);
  invariant(
    allClear.workflowSha === pr.baseSha,
    `${label}.allClear.workflowSha must equal the reviewed base SHA`,
  );
  invariant(
    allClear.baseSha === pr.baseSha && allClear.headSha === pr.headSha,
    `${label}.allClear does not bind the exact PR head and base`,
  );
  invariant(
    allClear.conclusion === "success" &&
      allClear.autoMergeEnabled === false &&
      allClear.mergeAuthorizedByAutomation === false,
    `${label}.allClear grants invalid authority`,
  );
  invariant(
    allClear.riskTier === "human-merge-npm" ||
      allClear.riskTier === "safe-actions-patch-minor",
    `${label}.allClear.riskTier is invalid`,
  );
  invariant(
    new Set(["patch", "minor", "major"]).has(allClear.updateType),
    `${label}.allClear.updateType is invalid`,
  );
  const external = ALL_CLEAR_EXTERNAL_ID_PATTERN.exec(allClear.externalId);
  invariant(external !== null, `${label}.allClear.externalId is invalid`);
  invariant(Number(external[1]) === pr.number, `${label}.allClear PR mismatch`);
  invariant(external[2] === pr.headSha, `${label}.allClear head mismatch`);
  invariant(external[3] === pr.baseSha, `${label}.allClear base mismatch`);
  invariant(
    DIGEST_PATTERN.test(external[4]),
    `${label}.allClear digest is invalid`,
  );
  invariant(
    Number(external[5]) === allClear.workflowRunId &&
      Number(external[6]) === allClear.workflowRunAttempt,
    `${label}.allClear workflow provenance mismatch`,
  );
  validatePreparation(allClear.preparation, `${label}.allClear.preparation`);
  return {
    checkUrl: checkUrl(repository, allClear.checkId),
    runUrl: workflowRunUrl(repository, allClear.workflowRunId),
  };
}

function validateMainCi(mainCi, pr, repository, label) {
  exactKeys(
    mainCi,
    ["checkId", "conclusion", "headSha", "workflowRunId"],
    `${label}.mainCi`,
  );
  positiveInteger(mainCi.checkId, `${label}.mainCi.checkId`);
  positiveInteger(mainCi.workflowRunId, `${label}.mainCi.workflowRunId`);
  invariant(
    mainCi.conclusion === "success" && mainCi.headSha === pr.mergeSha,
    `${label}.mainCi is not successful for the exact merge SHA`,
  );
  return {
    checkUrl: checkUrl(repository, mainCi.checkId),
    runUrl: workflowRunUrl(repository, mainCi.workflowRunId),
  };
}

function validatePostMerge(postMerge, pr, repository, label) {
  exactKeys(
    postMerge,
    [
      "checkId",
      "conclusion",
      "externalId",
      "headSha",
      "outcome",
      "terminalRestored",
      "workflowRunAttempt",
      "workflowRunId",
    ],
    `${label}.postMerge`,
  );
  positiveInteger(postMerge.checkId, `${label}.postMerge.checkId`);
  positiveInteger(postMerge.workflowRunId, `${label}.postMerge.workflowRunId`);
  positiveInteger(
    postMerge.workflowRunAttempt,
    `${label}.postMerge.workflowRunAttempt`,
  );
  invariant(
    postMerge.conclusion === "success" &&
      postMerge.headSha === pr.mergeSha &&
      postMerge.terminalRestored === true,
    `${label}.postMerge is not terminal exact-merge proof`,
  );
  invariant(
    new Set(["active-committed", "current-release-verified"]).has(
      postMerge.outcome,
    ),
    `${label}.postMerge.outcome does not prove an affected release`,
  );
  const external = POST_MERGE_EXTERNAL_ID_PATTERN.exec(postMerge.externalId);
  invariant(external !== null, `${label}.postMerge.externalId is invalid`);
  invariant(
    Number(external[1]) === postMerge.workflowRunId &&
      Number(external[2]) === postMerge.workflowRunAttempt,
    `${label}.postMerge workflow provenance mismatch`,
  );
  return {
    checkUrl: checkUrl(repository, postMerge.checkId),
    runUrl: workflowRunUrl(repository, postMerge.workflowRunId),
  };
}

function validateMergedCase(entry, manifest) {
  const label = `case ${entry.id}`;
  exactKeys(
    entry,
    ["allClear", "id", "mainCi", "postMerge", "pr", "status", "summary"],
    label,
  );
  validatePullRequest(entry.pr, manifest.repository, "merged", label);
  invariant(
    Date.parse(entry.pr.mergedAt) <= Date.parse(manifest.capturedAt),
    `${label}.pr.mergedAt is later than the manifest capture`,
  );
  const allClearUrls = validateAllClear(
    entry.allClear,
    entry.pr,
    manifest.repository,
    label,
  );
  const mainCiUrls = validateMainCi(
    entry.mainCi,
    entry.pr,
    manifest.repository,
    label,
  );
  const postMergeUrls = validatePostMerge(
    entry.postMerge,
    entry.pr,
    manifest.repository,
    label,
  );
  const { preparation } = entry.allClear;
  if (entry.id === "native-green-npm") {
    invariant(
      entry.allClear.riskTier === "human-merge-npm" &&
        preparation.kind === "native" &&
        preparation.seedHeadSha === entry.pr.headSha,
      `${label} is not native green npm evidence`,
    );
  } else if (entry.id === "stale-npm") {
    invariant(
      entry.allClear.riskTier === "human-merge-npm" &&
        preparation.kind === "prepared" &&
        preparation.seedHeadSha !== entry.pr.headSha &&
        preparation.refreshCount >= 1,
      `${label} does not prove a completed refresh`,
    );
  } else if (entry.id === "repairable-npm") {
    invariant(
      entry.allClear.riskTier === "human-merge-npm" &&
        preparation.kind === "prepared" &&
        preparation.seedHeadSha !== entry.pr.headSha &&
        preparation.repairCount >= 1 &&
        preparation.operationKinds.length >= 1,
      `${label} does not prove a bounded repair`,
    );
  } else if (entry.id === "routine-actions") {
    invariant(
      entry.allClear.riskTier === "safe-actions-patch-minor" &&
        preparation.kind === "native" &&
        preparation.seedHeadSha === entry.pr.headSha &&
        new Set(["patch", "minor"]).has(entry.allClear.updateType),
      `${label} is not a native routine Actions update`,
    );
  } else {
    invariant(false, `${label} cannot use merged evidence`);
  }
  return { allClearUrls, mainCiUrls, postMergeUrls };
}

function validateManualProcessor(
  processor,
  pr,
  repository,
  label,
  { requireBaseMatch = true } = {},
) {
  exactKeys(
    processor,
    [
      "checkId",
      "conclusion",
      "dependencyGroup",
      "dependencyNames",
      "disposition",
      "externalId",
      "headSha",
      "workflowRunAttempt",
      "workflowRunId",
      "workflowSha",
    ],
    `${label}.processor`,
  );
  positiveInteger(processor.checkId, `${label}.processor.checkId`);
  positiveInteger(processor.workflowRunId, `${label}.processor.workflowRunId`);
  positiveInteger(
    processor.workflowRunAttempt,
    `${label}.processor.workflowRunAttempt`,
  );
  exactSha(processor.workflowSha, `${label}.processor.workflowSha`);
  invariant(
    (!requireBaseMatch || processor.workflowSha === pr.baseSha) &&
      processor.headSha === pr.headSha,
    `${label}.processor does not bind the exact controller and PR head`,
  );
  invariant(
    processor.conclusion === "failure" &&
      processor.disposition === "manual-review" &&
      processor.dependencyGroup === "github-actions-manual",
    `${label}.processor is not a manual-review classification`,
  );
  invariant(
    Array.isArray(processor.dependencyNames) &&
      processor.dependencyNames.length > 0 &&
      processor.dependencyNames.every(
        (name) => typeof name === "string" && name.length > 0,
      ) &&
      new Set(processor.dependencyNames).size ===
        processor.dependencyNames.length,
    `${label}.processor dependency metadata is invalid`,
  );
  const external = PROCESSOR_EXTERNAL_ID_PATTERN.exec(processor.externalId);
  invariant(external !== null, `${label}.processor.externalId is invalid`);
  invariant(Number(external[1]) === pr.number, `${label} PR mismatch`);
  invariant(external[2] === pr.headSha, `${label} head mismatch`);
  invariant(
    Number(external[3]) >= 1 && Number(external[3]) <= 2,
    `${label} attempt is invalid`,
  );
  invariant(
    Number(external[4]) === processor.workflowRunId &&
      Number(external[5]) === processor.workflowRunAttempt,
    `${label}.processor workflow provenance mismatch`,
  );
  return {
    processorCheckUrl: checkUrl(repository, processor.checkId),
    processorRunUrl: workflowRunUrl(repository, processor.workflowRunId),
  };
}

function validateManualCase(entry, manifest) {
  const label = `case ${entry.id}`;
  exactKeys(
    entry,
    ["authority", "id", "pr", "processor", "status", "summary"],
    label,
  );
  invariant(entry.id === "manual-actions", `${label} is not manual Actions`);
  validatePullRequest(entry.pr, manifest.repository, "open", label);
  const processorUrls = validateManualProcessor(
    entry.processor,
    entry.pr,
    manifest.repository,
    label,
  );
  exactKeys(
    entry.authority,
    [
      "allClearCheckCount",
      "autoMergeRequestCount",
      "capturedAt",
      "processorApprovalCount",
      "refreshCheckCount",
      "repairCheckCount",
    ],
    `${label}.authority`,
  );
  exactTimestamp(entry.authority.capturedAt, `${label}.authority.capturedAt`);
  invariant(
    Date.parse(entry.authority.capturedAt) <= Date.parse(manifest.capturedAt),
    `${label}.authority capture is later than the manifest capture`,
  );
  for (const key of [
    "allClearCheckCount",
    "autoMergeRequestCount",
    "processorApprovalCount",
    "refreshCheckCount",
    "repairCheckCount",
  ]) {
    invariant(
      entry.authority[key] === 0,
      `${label}.authority.${key} must be zero`,
    );
  }
  return processorUrls;
}

function validateTypedCompanionPullRequest(
  companion,
  sourcePr,
  repository,
  label,
) {
  exactKeys(companion, ["branchRef", "commitSha", "pr"], `${label}.companion`);
  exactSha(companion.commitSha, `${label}.companion.commitSha`);
  const expectedBranch =
    `dependabot-companion/osv-pr-${sourcePr.number}-` +
    sourcePr.headSha.slice(0, 12);
  invariant(
    companion.branchRef === expectedBranch,
    `${label}.companion.branchRef does not bind the source PR and head`,
  );
  exactKeys(
    companion.pr,
    [
      "authorLogin",
      "baseRef",
      "baseSha",
      "headRef",
      "headSha",
      "mergedAt",
      "mergeSha",
      "number",
      "state",
      "url",
    ],
    `${label}.companion.pr`,
  );
  positiveInteger(companion.pr.number, `${label}.companion.pr.number`);
  invariant(
    companion.pr.number !== sourcePr.number &&
      companion.pr.url === pullRequestUrl(repository, companion.pr.number),
    `${label}.companion.pr identity is invalid`,
  );
  invariant(
    companion.pr.authorLogin === PREPARE_BOT_LOGIN,
    `${label}.companion.pr author is not the Prepare App`,
  );
  invariant(
    companion.pr.baseRef === "main" &&
      companion.pr.baseSha === sourcePr.baseSha &&
      companion.pr.headRef === companion.branchRef &&
      companion.pr.headSha === companion.commitSha,
    `${label}.companion.pr does not bind the exact branch, commit, and base`,
  );
  invariant(
    companion.pr.state === "open" &&
      companion.pr.mergedAt === null &&
      companion.pr.mergeSha === null,
    `${label}.companion.pr is not an open companion`,
  );
}

function validateTypedCompanionProcessor(processor, pr, workflow, label) {
  exactKeys(
    processor,
    [
      "checkId",
      "dependencyGroup",
      "dependencyNames",
      "disposition",
      "headSha",
      "workflowRunAttempt",
      "workflowRunId",
      "workflowSha",
    ],
    `${label}.processor`,
  );
  positiveInteger(processor.checkId, `${label}.processor.checkId`);
  positiveInteger(processor.workflowRunId, `${label}.processor.workflowRunId`);
  positiveInteger(
    processor.workflowRunAttempt,
    `${label}.processor.workflowRunAttempt`,
  );
  exactSha(processor.workflowSha, `${label}.processor.workflowSha`);
  invariant(
    processor.headSha === pr.headSha &&
      processor.workflowSha === workflow.workflowSha &&
      processor.disposition === "manual-review" &&
      processor.dependencyGroup === "github-actions-manual" &&
      Array.isArray(processor.dependencyNames) &&
      JSON.stringify([...processor.dependencyNames].sort()) ===
        JSON.stringify(TYPED_ACTIONS_DEPENDENCIES),
    `${label}.processor does not bind the exact typed OSV classification`,
  );
  return {
    processorCheckUrl: checkUrl(TYPED_COMPANION_REPOSITORY, processor.checkId),
    processorRunUrl: workflowRunUrl(
      TYPED_COMPANION_REPOSITORY,
      processor.workflowRunId,
    ),
  };
}

function validateTypedActionsCompanionCase(entry, manifest) {
  const label = `case ${entry.id}`;
  exactKeys(
    entry,
    [
      "companion",
      "id",
      "planDigest",
      "pr",
      "processor",
      "receipts",
      "status",
      "summary",
      "workflow",
    ],
    label,
  );
  invariant(
    entry.id === "typed-actions-companion",
    `${label} is not typed Actions companion evidence`,
  );
  validatePullRequest(entry.pr, manifest.repository, "open", label);
  validateTypedCompanionPullRequest(
    entry.companion,
    entry.pr,
    manifest.repository,
    label,
  );
  exactDigest(entry.planDigest, `${label}.planDigest`);
  exactKeys(
    entry.workflow,
    ["runAttempt", "runId", "workflowSha"],
    `${label}.workflow`,
  );
  positiveInteger(entry.workflow.runId, `${label}.workflow.runId`);
  positiveInteger(entry.workflow.runAttempt, `${label}.workflow.runAttempt`);
  exactSha(entry.workflow.workflowSha, `${label}.workflow.workflowSha`);
  const processorUrls = validateTypedCompanionProcessor(
    entry.processor,
    entry.pr,
    entry.workflow,
    label,
  );
  exactKeys(entry.receipts, ["census", "open", "stage"], `${label}.receipts`);
  validateReceiptProjection(
    entry.receipts.census,
    { result: "planned", schema: ACTIONS_COMPANION_LIVE_CENSUS_SCHEMA },
    `${label}.receipts.census`,
  );
  validateReceiptProjection(
    entry.receipts.stage,
    { result: "staged", schema: ACTIONS_COMPANION_LIVE_STAGE_SCHEMA },
    `${label}.receipts.stage`,
  );
  validateReceiptProjection(
    entry.receipts.open,
    {
      result: ["opened", "already-open"],
      schema: ACTIONS_COMPANION_LIVE_OPEN_SCHEMA,
    },
    `${label}.receipts.open`,
  );
  invariant(
    new Set([
      entry.receipts.census.receiptSha256,
      entry.receipts.stage.receiptSha256,
      entry.receipts.open.receiptSha256,
    ]).size === 3,
    `${label}.receipts must use distinct exact receipt digests`,
  );
  return {
    ...processorUrls,
    companionPullRequestUrl: entry.companion.pr.url,
    workflowRunUrl: workflowRunUrl(manifest.repository, entry.workflow.runId),
  };
}

export function validateDependabotProductionSoakManifest(manifest) {
  exactKeys(
    manifest,
    ["capturedAt", "cases", "publisherAppId", "repository", "schema"],
    "manifest",
  );
  invariant(
    manifest.schema === DEPENDABOT_PRODUCTION_SOAK_SCHEMA,
    "manifest schema is invalid",
  );
  invariant(
    /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(manifest.repository ?? ""),
    "manifest repository is invalid",
  );
  exactTimestamp(manifest.capturedAt, "manifest.capturedAt");
  invariant(
    manifest.publisherAppId === 15_368,
    "manifest publisherAppId must be the GitHub Actions App",
  );
  invariant(Array.isArray(manifest.cases), "manifest cases must be an array");
  invariant(
    JSON.stringify(manifest.cases.map(({ id }) => id)) ===
      JSON.stringify(CASE_ORDER),
    "manifest cases must contain the six canonical cases in order",
  );

  const validated = [];
  for (const entry of manifest.cases) {
    nonEmptyString(entry.summary, `case ${entry.id}.summary`);
    invariant(
      entry.status === "passed" || entry.status === "pending",
      `case ${entry.id}.status is invalid`,
    );
    if (entry.status === "pending") {
      exactKeys(entry, ["id", "status", "summary"], `case ${entry.id}`);
      invariant(
        entry.id !== "manual-actions",
        "manual Actions must use its observed classification evidence",
      );
      validated.push({ entry, urls: null });
      continue;
    }
    const urls =
      entry.id === "manual-actions"
        ? validateManualCase(entry, manifest)
        : entry.id === "typed-actions-companion"
          ? validateTypedActionsCompanionCase(entry, manifest)
          : validateMergedCase(entry, manifest);
    validated.push({ entry, urls });
  }
  const observed = validated.filter(({ entry }) => entry.status === "passed");
  const pullRequestNumbers = observed.flatMap(({ entry }) =>
    entry.id === "typed-actions-companion"
      ? [entry.pr.number, entry.companion.pr.number]
      : [entry.pr.number],
  );
  invariant(
    new Set(pullRequestNumbers).size === pullRequestNumbers.length,
    "passed soak cases must use distinct pull requests",
  );
  const pullRequestHeads = observed.flatMap(({ entry }) =>
    entry.id === "typed-actions-companion"
      ? [entry.pr.headSha, entry.companion.pr.headSha]
      : [entry.pr.headSha],
  );
  invariant(
    new Set(pullRequestHeads).size === pullRequestHeads.length,
    "passed soak cases must use distinct pull request heads",
  );
  const checkIds = observed.flatMap(({ entry }) =>
    entry.id === "manual-actions" || entry.id === "typed-actions-companion"
      ? [entry.processor.checkId]
      : [entry.allClear.checkId, entry.mainCi.checkId, entry.postMerge.checkId],
  );
  invariant(
    new Set(checkIds).size === checkIds.length,
    "passed soak evidence must use distinct check IDs",
  );
  const workflowRunIds = observed.flatMap(({ entry }) =>
    entry.id === "manual-actions"
      ? [entry.processor.workflowRunId]
      : entry.id === "typed-actions-companion"
        ? [...new Set([entry.workflow.runId, entry.processor.workflowRunId])]
        : [
            entry.allClear.workflowRunId,
            entry.mainCi.workflowRunId,
            entry.postMerge.workflowRunId,
          ],
  );
  invariant(
    new Set(workflowRunIds).size === workflowRunIds.length,
    "passed soak evidence must use distinct workflow run IDs",
  );
  const processorApprovalIds = observed.flatMap(({ entry }) =>
    entry.id === "manual-actions" || entry.id === "typed-actions-companion"
      ? []
      : [entry.allClear.processorApprovalId],
  );
  invariant(
    new Set(processorApprovalIds).size === processorApprovalIds.length,
    "passed soak evidence must use distinct processor approval IDs",
  );
  return { manifest, validated };
}

function shortSha(sha) {
  return sha.slice(0, 8);
}

function tableText(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}

function countText(value, singular, plural) {
  return `${value} ${value === 1 ? singular : plural}`;
}

function markdownTable(headers, rows) {
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => String(row[index]).length), 3),
  );
  const line = (cells) =>
    `| ${cells.map((cell, index) => String(cell).padEnd(widths[index])).join(" | ")} |`;
  return [
    line(headers),
    `| ${widths.map((width) => "-".repeat(width)).join(" | ")} |`,
    ...rows.map(line),
  ];
}

function renderPassed(entry, urls) {
  if (entry.id === "typed-actions-companion") {
    return [
      `source [#${entry.pr.number}](${entry.pr.url}) at \`${shortSha(entry.pr.headSha)}\` -> companion [#${entry.companion.pr.number}](${urls.companionPullRequestUrl}) at \`${shortSha(entry.companion.commitSha)}\``,
      `[workflow ${entry.workflow.runId} attempt ${entry.workflow.runAttempt}](${urls.workflowRunUrl}) and ` +
        `[Processor ${entry.processor.checkId}](${urls.processorCheckUrl}) bound branch \`${entry.companion.branchRef}\`. ` +
        `Exact receipt SHA-256 digests: census \`${entry.receipts.census.receiptSha256}\`, stage \`${entry.receipts.stage.receiptSha256}\`, open \`${entry.receipts.open.receiptSha256}\`.`,
    ];
  }
  if (entry.id === "manual-actions") {
    const dependencies = entry.processor.dependencyNames.join(", ");
    return [
      `[#${entry.pr.number}](${entry.pr.url}) at \`${shortSha(entry.pr.headSha)}\` (controller \`${shortSha(entry.processor.workflowSha)}\`)`,
      `[Processor ${entry.processor.checkId}](${urls.processorCheckUrl}) returned \`manual-review\` for \`${entry.processor.dependencyGroup}\` (${dependencies}). ` +
        "The captured head had no processor approval, auto-merge request, ALL CLEAR, Refresh, or Repair authority.",
    ];
  }
  const preparation = entry.allClear.preparation;
  const operations =
    preparation.operationKinds.length === 0
      ? "none"
      : preparation.operationKinds.map((kind) => `\`${kind}\``).join(", ");
  return [
    `[#${entry.pr.number}](${entry.pr.url}) at \`${shortSha(entry.pr.headSha)}\` (controller \`${shortSha(entry.allClear.workflowSha)}\`)`,
    `[ALL CLEAR ${entry.allClear.checkId}](${urls.allClearUrls.checkUrl}), ` +
      `[main CI ${entry.mainCi.checkId}](${urls.mainCiUrls.checkUrl}), and ` +
      `[post-merge ${entry.postMerge.checkId}](${urls.postMergeUrls.checkUrl}) passed. ` +
      `Preparation recorded ${countText(preparation.refreshCount, "refresh", "refreshes")}, ${countText(preparation.repairCount, "repair", "repairs")}, and operations ${operations}. ` +
      `Merge \`${shortSha(entry.pr.mergeSha)}\` finished with \`${entry.postMerge.outcome}\` proof.`,
  ];
}

export function renderDependabotProductionSoak(manifest) {
  const { validated } = validateDependabotProductionSoakManifest(manifest);
  const passed = validated.filter(
    ({ entry }) => entry.status === "passed",
  ).length;
  const rows = validated.map(({ entry, urls }) => {
    const label = CASE_LABELS[entry.id];
    if (entry.status === "pending") {
      return [label, "PENDING", "-", tableText(entry.summary)];
    }
    const [evidence, result] = renderPassed(entry, urls);
    return [label, "PASS", tableText(evidence), tableText(result)];
  });
  const table = markdownTable(
    ["Case", "State", "Production evidence", "Result"],
    rows,
  );
  return [
    "# Dependabot production soak report",
    "",
    `Captured at \`${manifest.capturedAt}\` for \`${manifest.repository}\`.`,
    "",
    `Recorded production coverage: **${passed} of ${CASE_ORDER.length} cases observed; ${CASE_ORDER.length - passed} pending.**`,
    "",
    "> This offline report is observational. It does not authenticate GitHub evidence or grant preparation, approval, merge, deployment, or recovery authority.",
    "",
    ...table,
    "",
    "## Evidence handling",
    "",
    "Offline validation checks only the manifest schema, internal consistency, and report rendering. It does not query GitHub or prove that a recorded resource exists, is current, or has the declared publisher and conclusion.",
    "",
    "A maintainer must revalidate the exact live GitHub PR, head, controller SHA, checks, workflow runs, approval state, merge, and post-merge result before changing a row from `PENDING` to `PASS`. Keep a case pending until a real Dependabot event supplies that evidence. Contract tests and copied identifiers are not production evidence.",
    "",
    "Render or check this observational report without network access:",
    "",
    "```bash",
    "node scripts/dependabot-production-soak.mjs",
    "node scripts/dependabot-production-soak.mjs --check docs/dependabot-production-soak.md",
    "```",
    "",
  ].join("\n");
}

function parseArguments(arguments_) {
  let manifestPath = "docs/dependabot-production-soak.json";
  let checkPath = null;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--manifest") {
      manifestPath = arguments_[index + 1];
      invariant(manifestPath, "--manifest requires a path");
      index += 1;
    } else if (argument === "--check") {
      checkPath = arguments_[index + 1];
      invariant(checkPath, "--check requires a path");
      index += 1;
    } else {
      invariant(false, `Unsupported argument: ${argument}`);
    }
  }
  return { checkPath, manifestPath };
}

function parseCommandPaths(arguments_, expectedNames) {
  invariant(
    arguments_.length === expectedNames.length * 2,
    "Command arguments are incomplete",
  );
  const expected = new Set(expectedNames.map((name) => `--${name}`));
  const result = {};
  for (let index = 0; index < arguments_.length; index += 2) {
    const option = arguments_[index];
    const value = arguments_[index + 1];
    invariant(expected.has(option), `Unsupported argument: ${option}`);
    const name = option.slice(2);
    invariant(result[name] === undefined, `Duplicate argument: ${option}`);
    nonEmptyString(value, `${option} path`);
    result[name] = value;
  }
  invariant(
    expectedNames.every((name) => result[name] !== undefined),
    "Command arguments are incomplete",
  );
  return result;
}

function runCli() {
  const arguments_ = process.argv.slice(2);
  const [command, ...commandArguments] = arguments_;
  if (command === "companion-stage") {
    const paths = parseCommandPaths(commandArguments, [
      "census",
      "stage",
      "output",
    ]);
    const partial = createDependabotActionsCompanionSoakPartial({
      censusReceiptBytes: readFileSync(resolve(paths.census)),
      stageReceiptBytes: readFileSync(resolve(paths.stage)),
    });
    writeNewCanonicalJson(
      paths.output,
      partial,
      "companion soak partial",
      MAX_DEPENDABOT_ACTIONS_COMPANION_SOAK_BYTES,
    );
    process.stdout.write(`${paths.output} created\n`);
    return;
  }
  if (command === "companion-open") {
    const paths = parseCommandPaths(commandArguments, [
      "partial",
      "open",
      "pull",
      "output",
    ]);
    const artifact = createDependabotActionsCompanionSoakArtifact({
      openReceiptBytes: readFileSync(resolve(paths.open)),
      partialBytes: readFileSync(resolve(paths.partial)),
      pullSnapshotBytes: readFileSync(resolve(paths.pull)),
    });
    writeNewCanonicalJson(
      paths.output,
      artifact,
      "companion soak artifact",
      MAX_DEPENDABOT_ACTIONS_COMPANION_SOAK_BYTES,
    );
    process.stdout.write(`${paths.output} created\n`);
    return;
  }
  if (command === "import-typed-companion") {
    const paths = parseCommandPaths(commandArguments, [
      "artifact",
      "manifest",
      "output",
    ]);
    const manifest = parseJsonBytes(
      readFileSync(resolve(paths.manifest)),
      "production soak manifest",
      MAX_SOAK_MANIFEST_BYTES,
    ).parsed;
    const imported = importDependabotActionsCompanionSoakArtifact({
      artifactBytes: readFileSync(resolve(paths.artifact)),
      manifest,
    });
    writeNewCanonicalJson(
      paths.output,
      imported,
      "production soak manifest",
      MAX_SOAK_MANIFEST_BYTES,
    );
    process.stdout.write(`${paths.output} created\n`);
    return;
  }
  const { checkPath, manifestPath } = parseArguments(arguments_);
  const manifest = JSON.parse(readFileSync(resolve(manifestPath), "utf8"));
  const rendered = renderDependabotProductionSoak(manifest);
  if (checkPath !== null) {
    const current = readFileSync(resolve(checkPath), "utf8");
    invariant(current === rendered, `${checkPath} is out of date`);
    process.stdout.write(`${checkPath} is current\n`);
    return;
  }
  process.stdout.write(rendered);
}

if (
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  try {
    runCli();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
