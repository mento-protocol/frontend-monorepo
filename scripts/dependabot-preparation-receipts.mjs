/* eslint-disable turbo/no-undeclared-env-vars -- GitHub Actions injects these command-specific credentials. */

import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

export const GITHUB_ACTIONS_APP_ID = 15_368;
export const GITHUB_WEB_FLOW_USER_ID = 19_864_447;
export const PROCESSOR_PACKET_SCHEMA = "dependabot-repair-packet:v2";
export const REPAIR_INTENT_SCHEMA = "dependabot-repair-intent:v1";
export const REPAIR_PLAN_SCHEMA = "dependabot-repair-plan:v1";
export const REPAIR_RECOVERY_SCHEMA = "dependabot-repair-recovery:v1";
export const VALIDATED_REPAIR_PLAN_SCHEMA =
  "dependabot-validated-repair-plan:v1";
export const REPAIR_EVIDENCE_SCHEMA = "dependabot-repair-evidence:v1";

const REPOSITORY = "mento-protocol/frontend-monorepo";
const HEX_SHA = /^[0-9a-f]{40}$/;
const HEX_DIGEST = /^[0-9a-f]{64}$/;
const SAFE_HEAD_REF = /^dependabot\/[A-Za-z0-9._/-]{1,220}$/;
const SAFE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._@+/-]{1,300}$/;
const HARD_DENIED_PATHS = [
  ".github/CODEOWNERS",
  ".github/dependabot.yml",
  ".github/actions/**",
  ".github/workflows/**",
  ".gitmodules",
  "docs/vercel-deployments.md",
  "scripts/vercel-main-*.mjs",
];
const ALLOWED_FILE_EXTENSIONS = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".patch",
  ".scss",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);
const CHECK_PAGE_SIZE = 100;
const MAX_TERMINAL_CHECK_PAGES = 10;
const MAX_EVIDENCE_BLOB_BYTES = 8 * 1024 * 1024;
const MAX_EVIDENCE_BLOBS_BYTES = 24 * 1024 * 1024;
const MAX_EVIDENCE_DIFF_BYTES = 1024 * 1024;
const MAX_EVIDENCE_JOB_LOG_BYTES = 1024 * 1024;
const MAX_EVIDENCE_JOB_LOGS_BYTES = 4 * 1024 * 1024;
const MAX_EVIDENCE_JOB_COUNT = 100;
const MAX_FEEDBACK_BODY_BYTES = 128 * 1024;
const MAX_GITHUB_JSON_BYTES = 32 * 1024 * 1024;
const MAX_EVIDENCE_LINE_BYTES = 4 * 1024;
const MAX_EVIDENCE_MANIFEST_FILES = 150;
const CLAUDE_REVIEW_EXTERNAL_ID_PATTERN =
  /^dependabot-claude-review:v1:pr=([1-9][0-9]{0,9}):sha=([0-9a-f]{40}):run=([1-9][0-9]*):attempt=([1-9][0-9]*)$/;
const CLAUDE_REVIEW_RECEIPT_PATTERN =
  /^dependabot-claude-review:v1 \| source=dependabot-intake:v1 \| repository=([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+) \| pr=([1-9][0-9]{0,9}) \| sha=([0-9a-f]{40}) \| action=(opened|synchronize|reopened) \| receipt=true$/;
const CLAUDE_PREPARED_REVIEW_RECEIPT_PATTERN =
  /^dependabot-claude-review:v1 \| source=dependabot-prepared-head:v1\|p=([1-9][0-9]{0,9})\|h=([0-9a-f]{40})\|o=([rp])\|c=([1-9][0-9]*)\|d=([0-9a-f]{64})\|ok=true$/;
const FAILURE_SOURCE_POLICY = Object.freeze({
  "action-pins": {
    events: ["pull_request_target"],
    workflowPaths: [".github/workflows/action-pins.yml"],
  },
  "action-pins-source": {
    events: ["pull_request"],
    workflowPaths: [".github/workflows/action-pins-source.yml"],
  },
  ci: {
    events: ["pull_request", "push"],
    workflowPaths: [".github/workflows/ci.yml"],
  },
  "dependency-review": {
    events: ["pull_request"],
    workflowPaths: [".github/workflows/dependency-review.yml"],
  },
  "e2e-celo": {
    events: ["pull_request", "schedule", "workflow_dispatch"],
    workflowPaths: [".github/workflows/e2e.yml"],
  },
  "e2e-governance": {
    events: ["pull_request", "schedule", "workflow_dispatch"],
    workflowPaths: [".github/workflows/e2e.yml"],
  },
  "e2e-monad": {
    events: ["pull_request", "schedule", "workflow_dispatch"],
    workflowPaths: [".github/workflows/e2e.yml"],
  },
  "e2e-plan": {
    events: ["pull_request", "schedule", "workflow_dispatch"],
    workflowPaths: [".github/workflows/e2e.yml"],
  },
  "e2e-seed": {
    events: ["pull_request", "schedule", "workflow_dispatch"],
    workflowPaths: [".github/workflows/e2e.yml"],
  },
  quality: {
    events: ["pull_request", "push", "workflow_dispatch"],
    workflowPaths: [".github/workflows/quality-budgets.yml"],
  },
  "supply-chain-lockfile": {
    events: ["pull_request", "schedule", "workflow_dispatch"],
    workflowPaths: [".github/workflows/supply-chain.yml"],
  },
  "supply-chain-pnpm-bootstrap-osv": {
    events: ["pull_request", "schedule", "workflow_dispatch"],
    workflowPaths: [".github/workflows/supply-chain.yml"],
  },
  "supply-chain-pnpm-runtime-osv": {
    events: ["pull_request", "schedule", "workflow_dispatch"],
    workflowPaths: [".github/workflows/supply-chain.yml"],
  },
  "supply-chain-root-osv": {
    events: ["pull_request", "schedule", "workflow_dispatch"],
    workflowPaths: [".github/workflows/supply-chain.yml"],
  },
  "supply-chain-vercel-runtime-osv": {
    events: ["pull_request", "schedule", "workflow_dispatch"],
    workflowPaths: [".github/workflows/supply-chain.yml"],
  },
  "supply-chain-version-skew": {
    events: ["pull_request", "schedule", "workflow_dispatch"],
    workflowPaths: [".github/workflows/supply-chain.yml"],
  },
  "visual-app": {
    events: ["pull_request", "push"],
    workflowPaths: [".github/workflows/visual.yml"],
  },
  "visual-plan": {
    events: ["pull_request", "push"],
    workflowPaths: [".github/workflows/visual.yml"],
  },
  "visual-ui": {
    events: ["pull_request", "push"],
    workflowPaths: [".github/workflows/visual.yml"],
  },
});
const RETRYABLE_REPAIR_CONCLUSIONS = new Set([
  "action_required",
  "cancelled",
  "failure",
  "startup_failure",
  "timed_out",
]);

export function isRetryableRepairConclusion(conclusion) {
  return RETRYABLE_REPAIR_CONCLUSIONS.has(conclusion);
}

function fail(message) {
  throw new Error(message);
}

function plainObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
  return value;
}

function exactKeys(value, keys, label) {
  plainObject(value, label);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${label} keys are not exact`);
  }
}

function safeInteger(
  value,
  label,
  { max = Number.MAX_SAFE_INTEGER, min = 1 } = {},
) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    fail(`${label} must be a safe integer between ${min} and ${max}`);
  }
  return value;
}

function boundedString(value, label, { max, min = 0, pattern } = {}) {
  if (
    typeof value !== "string" ||
    value.length < min ||
    (max !== undefined && value.length > max) ||
    (pattern !== undefined && !pattern.test(value))
  ) {
    fail(`${label} is invalid`);
  }
  return value;
}

function sha(value, label) {
  return boundedString(value, label, { max: 40, min: 40, pattern: HEX_SHA });
}

function digest(value, label) {
  return boundedString(value, label, {
    max: 64,
    min: 64,
    pattern: HEX_DIGEST,
  });
}

function repository(value) {
  if (value !== REPOSITORY) fail("repository is not the trusted repository");
  return value;
}

function headRef(value) {
  boundedString(value, "headRef", {
    max: 231,
    min: 12,
    pattern: SAFE_HEAD_REF,
  });
  if (value.includes("..") || value.endsWith("/")) fail("headRef is unsafe");
  return value;
}

function pathName(value, label = "path") {
  boundedString(value, label, { max: 300, min: 1, pattern: SAFE_PATH });
  if (
    value.includes("//") ||
    value.includes("\\") ||
    [...value].some((character) => character.codePointAt(0) <= 0x1f)
  ) {
    fail(`${label} is unsafe`);
  }
  return value;
}

function recursivelySorted(value) {
  if (Array.isArray(value)) return value.map(recursivelySorted);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, recursivelySorted(value[key])]),
    );
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(recursivelySorted(value));
}

export function canonicalDigest(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function rawDigest(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function parseCanonicalJson(source, label = "canonical JSON") {
  boundedString(source, label, { max: 64 * 1024, min: 2 });
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch {
    fail(`${label} is not JSON`);
  }
  if (canonicalJson(parsed) !== source) fail(`${label} is not canonical`);
  return parsed;
}

function validatePrepareIdentity(receipt) {
  boundedString(receipt.prepareAppSlug, "prepareAppSlug", {
    max: 100,
    min: 1,
    pattern: /^[a-z0-9][a-z0-9-]{0,99}$/,
  });
  safeInteger(receipt.prepareBotId, "prepareBotId");
  if (receipt.prepareBotLogin !== `${receipt.prepareAppSlug}[bot]`) {
    fail("prepareBotLogin does not match prepareAppSlug");
  }
}

function validateWorkflowIdentity(receipt) {
  safeInteger(receipt.workflowRunId, "workflowRunId");
  safeInteger(receipt.workflowRunAttempt, "workflowRunAttempt");
  sha(receipt.workflowSha, "workflowSha");
}

export function validateRefreshReceipt(receipt, { state } = {}) {
  const requestedKeys = [
    "baseSha",
    "headRef",
    "headSha",
    "parentHeadSha",
    "prepareAppSlug",
    "prepareBotId",
    "prepareBotLogin",
    "previousBaseSha",
    "pullRequestNumber",
    "repository",
    "schema",
    "state",
    "workflowRunAttempt",
    "workflowRunId",
    "workflowSha",
  ];
  const completedKeys = [...requestedKeys, "requestCheckId", "requestDigest"];
  exactKeys(
    receipt,
    receipt.state === "completed" ? completedKeys : requestedKeys,
    "refresh receipt",
  );
  if (receipt.schema !== "dependabot-refresh:v1")
    fail("refresh schema is invalid");
  if (receipt.state !== "requested" && receipt.state !== "completed") {
    fail("refresh state is invalid");
  }
  if (state !== undefined && receipt.state !== state)
    fail("refresh state changed");
  repository(receipt.repository);
  safeInteger(receipt.pullRequestNumber, "pullRequestNumber");
  headRef(receipt.headRef);
  sha(receipt.parentHeadSha, "parentHeadSha");
  sha(receipt.previousBaseSha, "previousBaseSha");
  sha(receipt.baseSha, "baseSha");
  if (receipt.previousBaseSha === receipt.baseSha) {
    fail("refresh previous and current bases must be distinct");
  }
  if (receipt.state === "requested") {
    if (receipt.headSha !== null)
      fail("requested refresh headSha must be null");
  } else {
    sha(receipt.headSha, "headSha");
    if (receipt.headSha === receipt.parentHeadSha)
      fail("refresh did not append a head");
    safeInteger(receipt.requestCheckId, "requestCheckId");
    digest(receipt.requestDigest, "requestDigest");
  }
  validatePrepareIdentity(receipt);
  validateWorkflowIdentity(receipt);
  return receipt;
}

export function validateRepairReceipt(receipt) {
  exactKeys(
    receipt,
    [
      "attempt",
      "baseSha",
      "headRef",
      "headSha",
      "packetDigest",
      "parentHeadSha",
      "prepareAppSlug",
      "prepareBotId",
      "prepareBotLogin",
      "processorCheckId",
      "pullRequestNumber",
      "repository",
      "schema",
      "state",
      "workflowRunAttempt",
      "workflowRunId",
      "workflowSha",
    ],
    "repair receipt",
  );
  if (
    receipt.schema !== "dependabot-repair:v1" ||
    receipt.state !== "completed"
  ) {
    fail("repair receipt schema or state is invalid");
  }
  repository(receipt.repository);
  safeInteger(receipt.pullRequestNumber, "pullRequestNumber");
  safeInteger(receipt.attempt, "attempt", { max: 2 });
  safeInteger(receipt.processorCheckId, "processorCheckId");
  headRef(receipt.headRef);
  sha(receipt.parentHeadSha, "parentHeadSha");
  sha(receipt.headSha, "headSha");
  sha(receipt.baseSha, "baseSha");
  digest(receipt.packetDigest, "packetDigest");
  if (receipt.headSha === receipt.parentHeadSha)
    fail("repair did not append a head");
  validatePrepareIdentity(receipt);
  validateWorkflowIdentity(receipt);
  return receipt;
}

export function validateRepairIntent(intent) {
  exactKeys(
    intent,
    [
      "attempt",
      "baseSha",
      "edits",
      "editsDigest",
      "headRef",
      "headSha",
      "packetDigest",
      "parentHeadSha",
      "parentTreeSha",
      "prepareAppSlug",
      "prepareBotId",
      "prepareBotLogin",
      "processorCheckId",
      "pullRequestNumber",
      "repository",
      "retryCount",
      "schema",
      "state",
      "treeDigest",
      "treeSha",
      "validatedPlanDigest",
      "workflowRunAttempt",
      "workflowRunId",
      "workflowSha",
    ],
    "repair intent",
  );
  if (intent.schema !== REPAIR_INTENT_SCHEMA || intent.state !== "staged") {
    fail("repair intent schema or state is invalid");
  }
  repository(intent.repository);
  safeInteger(intent.pullRequestNumber, "pullRequestNumber");
  safeInteger(intent.attempt, "attempt", { max: 2 });
  safeInteger(intent.processorCheckId, "processorCheckId");
  safeInteger(intent.retryCount, "retryCount", { max: 2, min: 0 });
  headRef(intent.headRef);
  sha(intent.parentHeadSha, "parentHeadSha");
  sha(intent.headSha, "headSha");
  sha(intent.baseSha, "baseSha");
  sha(intent.parentTreeSha, "parentTreeSha");
  sha(intent.treeSha, "treeSha");
  digest(intent.packetDigest, "packetDigest");
  digest(intent.validatedPlanDigest, "validatedPlanDigest");
  digest(intent.editsDigest, "editsDigest");
  digest(intent.treeDigest, "treeDigest");
  if (
    intent.headSha === intent.parentHeadSha ||
    intent.treeSha === intent.parentTreeSha
  ) {
    fail("repair intent did not stage a changed successor");
  }
  if (
    !Array.isArray(intent.edits) ||
    intent.edits.length < 1 ||
    intent.edits.length > 6
  ) {
    fail("repair intent edits are invalid");
  }
  const paths = new Set();
  for (const [index, edit] of intent.edits.entries()) {
    exactKeys(
      edit,
      [
        "contentDigest",
        "expectedBlobSha",
        "mode",
        "path",
        "resultBlobSha",
        "type",
      ],
      `repair intent edits[${index}]`,
    );
    pathName(edit.path, `repair intent edits[${index}].path`);
    if (paths.has(edit.path)) fail("repair intent contains duplicate paths");
    paths.add(edit.path);
    sha(edit.expectedBlobSha, `repair intent edits[${index}].expectedBlobSha`);
    sha(edit.resultBlobSha, `repair intent edits[${index}].resultBlobSha`);
    digest(edit.contentDigest, `repair intent edits[${index}].contentDigest`);
    if (
      edit.resultBlobSha === edit.expectedBlobSha ||
      edit.type !== "blob" ||
      !new Set(["100644", "100755"]).has(edit.mode)
    ) {
      fail(`repair intent edits[${index}] is not a changed regular blob`);
    }
  }
  if (intent.editsDigest !== canonicalDigest(intent.edits)) {
    fail("repair intent edit digest changed");
  }
  if (
    intent.treeDigest !==
    canonicalDigest({
      parentTreeSha: intent.parentTreeSha,
      treeSha: intent.treeSha,
    })
  ) {
    fail("repair intent tree digest changed");
  }
  validatePrepareIdentity(intent);
  validateWorkflowIdentity(intent);
  return intent;
}

export function repairIntentExternalId(intent) {
  validateRepairIntent(intent);
  return `dependabot-repair-intent:v1:pr=${intent.pullRequestNumber}:head=${intent.headSha}:attempt=${intent.attempt}:digest=${canonicalDigest(intent)}:run=${intent.workflowRunId}:run_attempt=${intent.workflowRunAttempt}`;
}

export function operationExternalId(receipt) {
  const receiptDigest = canonicalDigest(receipt);
  if (receipt.schema === "dependabot-refresh:v1") {
    validateRefreshReceipt(receipt);
    const boundHead =
      receipt.state === "requested" ? receipt.parentHeadSha : receipt.headSha;
    return `dependabot-refresh:v1:pr=${receipt.pullRequestNumber}:head=${boundHead}:state=${receipt.state}:digest=${receiptDigest}:run=${receipt.workflowRunId}:attempt=${receipt.workflowRunAttempt}`;
  }
  validateRepairReceipt(receipt);
  return `dependabot-repair:v1:pr=${receipt.pullRequestNumber}:head=${receipt.headSha}:attempt=${receipt.attempt}:digest=${receiptDigest}:run=${receipt.workflowRunId}:run_attempt=${receipt.workflowRunAttempt}`;
}

function boundedStringArray(value, label, maxItems = 100) {
  if (!Array.isArray(value) || value.length > maxItems)
    fail(`${label} is invalid`);
  for (const [index, item] of value.entries()) {
    boundedString(item, `${label}[${index}]`, { max: 500, min: 1 });
  }
}

function validateEvidence(packet) {
  if (!Array.isArray(packet.findings) || packet.findings.length > 20) {
    fail("findings are invalid");
  }
  for (const [index, finding] of packet.findings.entries()) {
    exactKeys(
      finding,
      [
        "checkId",
        "digest",
        "line",
        "path",
        "source",
        "sourceId",
        "summary",
        "title",
      ],
      `findings[${index}]`,
    );
    if (!new Set(["check", "claude", "codex", "cursor"]).has(finding.source)) {
      fail(`findings[${index}].source is invalid`);
    }
    boundedString(finding.sourceId, `findings[${index}].sourceId`, {
      max: 200,
      min: 1,
    });
    if (finding.checkId !== null)
      safeInteger(finding.checkId, `findings[${index}].checkId`);
    pathName(finding.path, `findings[${index}].path`);
    if (finding.line !== null)
      safeInteger(finding.line, `findings[${index}].line`);
    boundedString(finding.title, `findings[${index}].title`, {
      max: 160,
      min: 1,
    });
    boundedString(finding.summary, `findings[${index}].summary`, {
      max: 1_000,
      min: 1,
    });
    digest(finding.digest, `findings[${index}].digest`);
    if (
      finding.digest !==
      canonicalDigest({
        line: finding.line,
        path: finding.path,
        summary: finding.summary,
        title: finding.title,
      })
    ) {
      fail(`findings[${index}].digest does not bind the finding`);
    }
  }

  if (
    !Array.isArray(packet.feedbackThreads) ||
    packet.feedbackThreads.length > 20
  ) {
    fail("feedbackThreads are invalid");
  }
  for (const [index, thread] of packet.feedbackThreads.entries()) {
    exactKeys(
      thread,
      [
        "commentId",
        "commitSha",
        "digest",
        "line",
        "path",
        "source",
        "threadId",
      ],
      `feedbackThreads[${index}]`,
    );
    if (!new Set(["claude", "codex", "cursor"]).has(thread.source)) {
      fail(`feedbackThreads[${index}].source is invalid`);
    }
    boundedString(thread.threadId, `feedbackThreads[${index}].threadId`, {
      max: 200,
      min: 1,
    });
    safeInteger(thread.commentId, `feedbackThreads[${index}].commentId`);
    pathName(thread.path, `feedbackThreads[${index}].path`);
    if (thread.line !== null)
      safeInteger(thread.line, `feedbackThreads[${index}].line`);
    sha(thread.commitSha, `feedbackThreads[${index}].commitSha`);
    digest(thread.digest, `feedbackThreads[${index}].digest`);
  }
}

export function validateProcessorRepairPacket(packet) {
  exactKeys(
    packet,
    [
      "attemptLimit",
      "attemptNumber",
      "automatic",
      "baseRef",
      "baseSha",
      "changedPaths",
      "dependencyGroup",
      "dependencyNames",
      "escalation",
      "expectedBlobs",
      "failures",
      "feedbackThreads",
      "findings",
      "forbiddenPaths",
      "headRef",
      "headSha",
      "limits",
      "mode",
      "packageEcosystem",
      "permittedPaths",
      "preparable",
      "pullRequestNumber",
      "repository",
      "requiredGateIds",
      "requireExactHead",
      "requireHumanApproval",
      "riskTier",
      "schema",
      "updateType",
      "validationCommands",
      "workflowRunAttempt",
      "workflowRunId",
      "workflowSha",
    ],
    "Processor repair packet",
  );
  if (packet.schema !== PROCESSOR_PACKET_SCHEMA)
    fail("packet schema is invalid");
  repository(packet.repository);
  safeInteger(packet.pullRequestNumber, "pullRequestNumber");
  headRef(packet.headRef);
  sha(packet.headSha, "headSha");
  if (packet.baseRef !== "main") fail("baseRef is not main");
  sha(packet.baseSha, "baseSha");
  sha(packet.workflowSha, "workflowSha");
  safeInteger(packet.workflowRunId, "workflowRunId");
  safeInteger(packet.workflowRunAttempt, "workflowRunAttempt");
  safeInteger(packet.attemptNumber, "attemptNumber", { max: 2 });
  if (packet.attemptLimit !== 2) fail("attemptLimit is not two");
  if (
    packet.mode !== "prepare" ||
    packet.automatic !== true ||
    packet.preparable !== true ||
    packet.requireExactHead !== true ||
    packet.requireHumanApproval !== false ||
    packet.escalation !== "manual-review"
  ) {
    fail("packet does not grant bounded automatic repair authority");
  }
  boundedStringArray(packet.changedPaths, "changedPaths", 300);
  boundedStringArray(packet.dependencyNames, "dependencyNames", 100);
  boundedStringArray(packet.permittedPaths, "permittedPaths", 50);
  boundedStringArray(packet.forbiddenPaths, "forbiddenPaths", 50);
  boundedStringArray(packet.requiredGateIds, "requiredGateIds", 100);
  boundedStringArray(packet.validationCommands, "validationCommands", 20);
  for (const [index, changedPath] of packet.changedPaths.entries()) {
    pathName(changedPath, `changedPaths[${index}]`);
  }
  if (!Array.isArray(packet.failures) || packet.failures.length > 20) {
    fail("failures are invalid");
  }
  for (const [index, failure] of packet.failures.entries()) {
    exactKeys(
      failure,
      ["attribution", "detailsUrl", "id", "name"],
      `failures[${index}]`,
    );
    if (failure.attribution !== "branch")
      fail("failure is not branch-attributed");
    boundedString(failure.id, `failures[${index}].id`, { max: 100, min: 1 });
    boundedString(failure.name, `failures[${index}].name`, {
      max: 200,
      min: 1,
    });
    if (failure.detailsUrl !== null) {
      boundedString(failure.detailsUrl, `failures[${index}].detailsUrl`, {
        max: 1_000,
        min: 1,
      });
    }
  }
  if (
    !Array.isArray(packet.expectedBlobs) ||
    packet.expectedBlobs.length < 1 ||
    packet.expectedBlobs.length > 100
  ) {
    fail("expectedBlobs are invalid");
  }
  const blobPaths = new Set();
  for (const [index, blob] of packet.expectedBlobs.entries()) {
    exactKeys(blob, ["mode", "path", "sha", "type"], `expectedBlobs[${index}]`);
    pathName(blob.path, `expectedBlobs[${index}].path`);
    sha(blob.sha, `expectedBlobs[${index}].sha`);
    if (blob.type !== "blob" || !new Set(["100644", "100755"]).has(blob.mode)) {
      fail(`expectedBlobs[${index}] is not a regular blob`);
    }
    if (blobPaths.has(blob.path))
      fail("expectedBlobs contains duplicate paths");
    blobPaths.add(blob.path);
  }
  exactKeys(
    packet.limits,
    ["maxAddedLines", "maxBytes", "maxChanges", "maxDeletedLines", "maxFiles"],
    "limits",
  );
  safeInteger(packet.limits.maxFiles, "limits.maxFiles", { max: 8 });
  safeInteger(packet.limits.maxChanges, "limits.maxChanges", { max: 20 });
  safeInteger(packet.limits.maxBytes, "limits.maxBytes", { max: 64 * 1024 });
  safeInteger(packet.limits.maxAddedLines, "limits.maxAddedLines", {
    max: 1_000,
  });
  safeInteger(packet.limits.maxDeletedLines, "limits.maxDeletedLines", {
    max: 1_000,
  });
  validateEvidence(packet);
  if (
    packet.failures.length === 0 &&
    packet.findings.length === 0 &&
    packet.feedbackThreads.length === 0
  ) {
    fail("packet has no actionable failure or feedback evidence");
  }
  return packet;
}

function globRegex(pattern) {
  let source = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === "*" && pattern[index + 1] === "*") {
      source += ".*";
      index += 1;
    } else if (character === "*") {
      source += "[^/]*";
    } else {
      source += character.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
    }
  }
  return new RegExp(`^${source}$`);
}

export function pathMatches(pattern, candidate) {
  return globRegex(pattern).test(candidate);
}

function pathAllowed(packet, candidate) {
  pathName(candidate);
  const extensionIndex = candidate.lastIndexOf(".");
  const extension =
    extensionIndex === -1 ? "" : candidate.slice(extensionIndex);
  if (!ALLOWED_FILE_EXTENSIONS.has(extension))
    fail(`file type is denied: ${candidate}`);
  if (HARD_DENIED_PATHS.some((pattern) => pathMatches(pattern, candidate))) {
    fail(`hard-denied path: ${candidate}`);
  }
  if (
    packet.forbiddenPaths.some((pattern) => pathMatches(pattern, candidate))
  ) {
    fail(`packet-denied path: ${candidate}`);
  }
  if (
    !packet.permittedPaths.some((pattern) => pathMatches(pattern, candidate))
  ) {
    fail(`path is outside packet allowlist: ${candidate}`);
  }
}

function parseJsonValue(source, label) {
  boundedString(source, label, { max: 64 * 1024, min: 2 });
  let value;
  try {
    value = JSON.parse(source);
    if (typeof value === "string") value = JSON.parse(value);
  } catch {
    fail(`${label} is not JSON`);
  }
  return value;
}

export function validateRepairPlan(
  plan,
  { packet, packetDigest, processorCheckId },
) {
  exactKeys(
    plan,
    [
      "attempt",
      "baseSha",
      "edits",
      "packetDigest",
      "parentHeadSha",
      "processorCheckId",
      "pullRequestNumber",
      "repository",
      "schema",
      "summary",
    ],
    "repair plan",
  );
  if (plan.schema !== REPAIR_PLAN_SCHEMA) fail("repair plan schema is invalid");
  repository(plan.repository);
  if (
    plan.pullRequestNumber !== packet.pullRequestNumber ||
    plan.parentHeadSha !== packet.headSha ||
    plan.baseSha !== packet.baseSha ||
    plan.attempt !== packet.attemptNumber ||
    plan.processorCheckId !== processorCheckId ||
    plan.packetDigest !== packetDigest
  ) {
    fail("repair plan identity does not match packet");
  }
  boundedString(plan.summary, "summary", { max: 500, min: 1 });
  if (
    !Array.isArray(plan.edits) ||
    plan.edits.length < 1 ||
    plan.edits.length > packet.limits.maxFiles
  ) {
    fail("repair plan edit count is invalid");
  }
  if (Buffer.byteLength(canonicalJson(plan)) > 64 * 1024)
    fail("repair plan is too large");
  const expectedBlobs = new Map(
    packet.expectedBlobs.map((blob) => [blob.path, blob]),
  );
  const paths = new Set();
  for (const [index, edit] of plan.edits.entries()) {
    exactKeys(edit, ["expectedBlobSha", "patch", "path"], `edits[${index}]`);
    pathAllowed(packet, edit.path);
    if (paths.has(edit.path)) fail("repair plan contains duplicate edit paths");
    paths.add(edit.path);
    if (expectedBlobs.get(edit.path)?.sha !== edit.expectedBlobSha) {
      fail(`expected blob is not packet-bound: ${edit.path}`);
    }
    sha(edit.expectedBlobSha, `edits[${index}].expectedBlobSha`);
    boundedString(edit.patch, `edits[${index}].patch`, { max: 8_192, min: 1 });
  }
  return plan;
}

export function validateValidatedRepairPlan(
  value,
  { packet, packetDigest, processorCheckId },
) {
  exactKeys(
    value,
    [
      "attempt",
      "baseSha",
      "edits",
      "packetDigest",
      "parentHeadSha",
      "processorCheckId",
      "pullRequestNumber",
      "repository",
      "schema",
      "summary",
    ],
    "validated repair plan",
  );
  if (value.schema !== VALIDATED_REPAIR_PLAN_SCHEMA) {
    fail("validated repair plan schema is invalid");
  }
  const planShape = {
    ...value,
    schema: REPAIR_PLAN_SCHEMA,
    edits: value.edits.map((edit) => ({
      expectedBlobSha: edit.expectedBlobSha,
      patch: edit.patch,
      path: edit.path,
    })),
  };
  validateRepairPlan(planShape, { packet, packetDigest, processorCheckId });
  for (const [index, edit] of value.edits.entries()) {
    exactKeys(
      edit,
      ["contentDigest", "expectedBlobSha", "mode", "patch", "path", "type"],
      `validated edits[${index}]`,
    );
    digest(edit.contentDigest, `validated edits[${index}].contentDigest`);
    if (edit.type !== "blob" || !new Set(["100644", "100755"]).has(edit.mode)) {
      fail(`validated edits[${index}] is not a regular blob`);
    }
  }
  return value;
}

export function validateRepairDispatchPayload(payload) {
  exactKeys(
    payload,
    [
      "baseSha",
      "headRef",
      "headSha",
      "prNumber",
      "processorReceipt",
      "repairAttempt",
      "repository",
      "retryCount",
      "schema",
    ],
    "repair dispatch payload",
  );
  if (Object.keys(payload).length > 10)
    fail("repair dispatch exceeds GitHub key cap");
  if (payload.schema !== "dependabot-prepare-repair:v1")
    fail("repair dispatch schema is invalid");
  repository(payload.repository);
  safeInteger(payload.prNumber, "prNumber");
  safeInteger(payload.repairAttempt, "repairAttempt", { max: 2 });
  safeInteger(payload.retryCount, "retryCount", { max: 2, min: 0 });
  headRef(payload.headRef);
  sha(payload.headSha, "headSha");
  sha(payload.baseSha, "baseSha");
  exactKeys(
    payload.processorReceipt,
    ["checkId", "digest", "workflowRunAttempt", "workflowRunId", "workflowSha"],
    "processorReceipt",
  );
  safeInteger(payload.processorReceipt.checkId, "processorReceipt.checkId");
  digest(payload.processorReceipt.digest, "processorReceipt.digest");
  safeInteger(
    payload.processorReceipt.workflowRunId,
    "processorReceipt.workflowRunId",
  );
  safeInteger(
    payload.processorReceipt.workflowRunAttempt,
    "processorReceipt.workflowRunAttempt",
  );
  sha(payload.processorReceipt.workflowSha, "processorReceipt.workflowSha");
  return payload;
}

export function validateRepairRecoveryPayload(payload) {
  exactKeys(
    payload,
    [
      "baseSha",
      "headRef",
      "headSha",
      "intentReceipt",
      "parentHeadSha",
      "prNumber",
      "repairAttempt",
      "repository",
      "retryCount",
      "schema",
    ],
    "repair recovery payload",
  );
  if (Object.keys(payload).length > 10) {
    fail("repair recovery exceeds GitHub key cap");
  }
  if (payload.schema !== REPAIR_RECOVERY_SCHEMA) {
    fail("repair recovery schema is invalid");
  }
  repository(payload.repository);
  safeInteger(payload.prNumber, "prNumber");
  safeInteger(payload.repairAttempt, "repairAttempt", { max: 2 });
  safeInteger(payload.retryCount, "retryCount", { max: 2, min: 0 });
  headRef(payload.headRef);
  sha(payload.parentHeadSha, "parentHeadSha");
  sha(payload.headSha, "headSha");
  sha(payload.baseSha, "baseSha");
  if (payload.parentHeadSha === payload.headSha) {
    fail("repair recovery head is unchanged");
  }
  exactKeys(
    payload.intentReceipt,
    ["checkId", "digest", "workflowRunAttempt", "workflowRunId", "workflowSha"],
    "intentReceipt",
  );
  safeInteger(payload.intentReceipt.checkId, "intentReceipt.checkId");
  digest(payload.intentReceipt.digest, "intentReceipt.digest");
  safeInteger(
    payload.intentReceipt.workflowRunId,
    "intentReceipt.workflowRunId",
  );
  safeInteger(
    payload.intentReceipt.workflowRunAttempt,
    "intentReceipt.workflowRunAttempt",
  );
  sha(payload.intentReceipt.workflowSha, "intentReceipt.workflowSha");
  return payload;
}

export function validateProcessDispatchPayload(payload) {
  exactKeys(payload, ["scope"], "processor dispatch payload");
  if (payload.scope !== "open") fail("processor dispatch scope is invalid");
  return payload;
}

export function validateTerminalEventPayload(
  eventType,
  payload,
  repositoryName,
) {
  repository(repositoryName);
  if (eventType === "dependabot-process") {
    return validateProcessDispatchPayload(payload);
  }
  const validated =
    eventType === "dependabot-prepare-repair"
      ? validateRepairDispatchPayload(payload)
      : eventType === "dependabot-prepare-repair-recover"
        ? validateRepairRecoveryPayload(payload)
        : eventType === "dependabot-prepared-head"
          ? validatePreparedHeadPayload(payload)
          : fail("terminal dispatch event type is invalid");
  if (validated.repository !== repositoryName) {
    fail("terminal dispatch repository changed");
  }
  return validated;
}

export function validatePreparedHeadPayload(payload) {
  exactKeys(
    payload,
    [
      "headRef",
      "headSha",
      "operation",
      "operationReceipt",
      "parentHeadSha",
      "prNumber",
      "prepareApp",
      "repository",
      "schema",
    ],
    "prepared-head payload",
  );
  if (Object.keys(payload).length > 10)
    fail("prepared-head payload exceeds key cap");
  if (payload.schema !== "dependabot-prepared-head-intake:v1") {
    fail("prepared-head schema is invalid");
  }
  repository(payload.repository);
  safeInteger(payload.prNumber, "prNumber");
  headRef(payload.headRef);
  sha(payload.parentHeadSha, "parentHeadSha");
  sha(payload.headSha, "headSha");
  if (payload.parentHeadSha === payload.headSha)
    fail("prepared head is unchanged");
  if (payload.operation !== "refresh" && payload.operation !== "repair") {
    fail("prepared operation is invalid");
  }
  exactKeys(
    payload.operationReceipt,
    [
      "checkId",
      "digest",
      "externalId",
      "workflowRunAttempt",
      "workflowRunId",
      "workflowSha",
    ],
    "operationReceipt",
  );
  safeInteger(payload.operationReceipt.checkId, "operationReceipt.checkId");
  digest(payload.operationReceipt.digest, "operationReceipt.digest");
  boundedString(
    payload.operationReceipt.externalId,
    "operationReceipt.externalId",
    {
      max: 500,
      min: 1,
    },
  );
  safeInteger(
    payload.operationReceipt.workflowRunId,
    "operationReceipt.workflowRunId",
  );
  safeInteger(
    payload.operationReceipt.workflowRunAttempt,
    "operationReceipt.workflowRunAttempt",
  );
  sha(payload.operationReceipt.workflowSha, "operationReceipt.workflowSha");
  exactKeys(payload.prepareApp, ["botId", "botLogin", "slug"], "prepareApp");
  validatePrepareIdentity({
    prepareAppSlug: payload.prepareApp.slug,
    prepareBotId: payload.prepareApp.botId,
    prepareBotLogin: payload.prepareApp.botLogin,
  });
  return payload;
}

export function terminalActionConfiguration(actions, configuration) {
  if (!Array.isArray(actions)) fail("terminal actions must be an array");
  if (actions.length === 0) return null;
  if (actions.length > 1) fail("terminal actions are ambiguous");
  const prepareAppSlug = boundedString(
    configuration.prepareAppSlug,
    "configured Prepare App slug",
    {
      max: 100,
      min: 1,
      pattern: /^[a-z0-9][a-z0-9-]{0,99}$/,
    },
  );
  const prepareBotId = Number(configuration.prepareBotId);
  const prepareBotLogin = configuration.prepareBotLogin;
  validatePrepareIdentity({ prepareAppSlug, prepareBotId, prepareBotLogin });
  const [action] = actions;
  if (
    (action.eventType === "dependabot-prepared-head" &&
      (action.payload.prepareApp.slug !== prepareAppSlug ||
        action.payload.prepareApp.botId !== prepareBotId ||
        action.payload.prepareApp.botLogin !== prepareBotLogin)) ||
    (action.prepareApp !== undefined &&
      (action.prepareApp.slug !== prepareAppSlug ||
        action.prepareApp.botId !== prepareBotId ||
        action.prepareApp.botLogin !== prepareBotLogin))
  ) {
    fail("operation receipt Prepare App identity does not match configuration");
  }
  return { prepareAppSlug, prepareBotId, prepareBotLogin };
}

export function sourceAttemptBinding(externalId, runId, runAttempt, kind) {
  boundedString(externalId, "externalId", { max: 1_000, min: 1 });
  safeInteger(runId, "runId");
  safeInteger(runAttempt, "runAttempt");
  const suffix = new Set(["intent", "repair"]).has(kind)
    ? "run_attempt"
    : "attempt";
  if (!new Set(["intent", "processor", "refresh", "repair"]).has(kind)) {
    fail("source attempt kind is invalid");
  }
  const match = externalId.match(
    new RegExp(`:run=([1-9][0-9]*):${suffix}=([1-9][0-9]*)$`),
  );
  if (match === null)
    return externalId.includes(`:run=${runId}:`) ? "malformed" : "other-run";
  if (Number(match[1]) !== runId) return "other-run";
  return Number(match[2]) === runAttempt ? "current" : "other-attempt";
}

function argsMap(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith("--") || value === undefined)
      fail("CLI arguments are malformed");
    if (args.has(name)) fail(`duplicate CLI argument: ${name}`);
    args.set(name, value);
  }
  return args;
}

function requiredArg(args, name) {
  const value = args.get(name);
  if (value === undefined || value === "") fail(`missing ${name}`);
  return value;
}

function writeOutputs(path, outputs) {
  const lines = [];
  for (const [name, value] of Object.entries(outputs)) {
    if (!/^[a-z][a-z0-9_]*$/.test(name)) fail(`unsafe output name: ${name}`);
    const stringValue = String(value);
    if (stringValue.includes("\n") || stringValue.includes("\r")) {
      fail(`multiline output is forbidden: ${name}`);
    }
    lines.push(`${name}=${stringValue}`);
  }
  writeFileSync(path, `${lines.join("\n")}\n`, { flag: "a", mode: 0o600 });
}

async function readBoundedResponseBytes(response, maximumBytes, label) {
  const contentLength = response.headers.get("content-length");
  if (
    contentLength !== null &&
    (!/^(?:0|[1-9][0-9]*)$/.test(contentLength) ||
      Number(contentLength) > maximumBytes)
  ) {
    fail(`${label} exceeds the bounded size`);
  }
  if (response.body === null) return Buffer.alloc(0);
  const chunks = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.byteLength;
    if (bytes > maximumBytes) fail(`${label} exceeds the bounded size`);
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks, bytes);
}

function strictUtf8(bytes, label, { allowEmpty = false } = {}) {
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    fail(`${label} is not valid UTF-8`);
  }
  if ((!allowEmpty && text.length === 0) || text.includes("\0")) {
    fail(`${label} is empty or contains a NUL byte`);
  }
  return text;
}

function githubHeaders(token, accept = "application/vnd.github+json") {
  boundedString(token, "GitHub token", { max: 10_000, min: 1 });
  return {
    Accept: accept,
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function githubRequest(token, method, path, body) {
  const response = await fetch(`https://api.github.com${path}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: githubHeaders(token),
    method,
  });
  const responseText = strictUtf8(
    await readBoundedResponseBytes(
      response,
      MAX_GITHUB_JSON_BYTES,
      `GitHub ${method} ${path} response`,
    ),
    `GitHub ${method} ${path} response`,
    { allowEmpty: true },
  );
  let data = null;
  if (responseText !== "") {
    try {
      data = JSON.parse(responseText);
    } catch {
      fail(`GitHub ${method} ${path} returned non-JSON`);
    }
  }
  if (!response.ok)
    fail(`GitHub ${method} ${path} failed with ${response.status}`);
  return data;
}

async function githubTextRequest(token, path, accept, maximumBytes, label) {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: githubHeaders(token, accept),
    method: "GET",
  });
  const bytes = await readBoundedResponseBytes(response, maximumBytes, label);
  if (!response.ok) fail(`${label} failed with ${response.status}`);
  return strictUtf8(bytes, label);
}

export async function githubJobLogRequest(token, repositoryName, jobId) {
  const apiPath = `/repos/${repositoryName}/actions/jobs/${jobId}/logs`;
  const response = await fetch(`https://api.github.com${apiPath}`, {
    headers: githubHeaders(token),
    method: "GET",
    redirect: "manual",
  });
  const location = response.headers.get("location");
  if (
    !new Set([302, 307]).has(response.status) ||
    typeof location !== "string"
  ) {
    fail(`failure job ${jobId} log redirect is invalid`);
  }
  let signedUrl;
  try {
    signedUrl = new URL(location);
  } catch {
    fail(`failure job ${jobId} log redirect URL is invalid`);
  }
  if (
    signedUrl.protocol !== "https:" ||
    signedUrl.username !== "" ||
    signedUrl.password !== "" ||
    signedUrl.hash !== "" ||
    signedUrl.hostname === "api.github.com" ||
    !(
      signedUrl.hostname === "results-receiver.actions.githubusercontent.com" ||
      /^[a-z0-9-]{1,63}\.blob\.core\.windows\.net$/.test(signedUrl.hostname)
    )
  ) {
    fail(`failure job ${jobId} log redirect is not a signed Actions URL`);
  }
  const signedResponse = await fetch(signedUrl, {
    headers: {},
    method: "GET",
    redirect: "error",
  });
  const bytes = await readBoundedResponseBytes(
    signedResponse,
    MAX_EVIDENCE_JOB_LOG_BYTES,
    `failure job ${jobId} log`,
  );
  if (!signedResponse.ok) {
    fail(`failure job ${jobId} log failed with ${signedResponse.status}`);
  }
  return strictUtf8(bytes, `failure job ${jobId} log`);
}

function expectedRunUrl(repositoryName, runId) {
  return `https://github.com/${repositoryName}/actions/runs/${runId}`;
}

function checkDetailsBound(check, repositoryName, runId) {
  return (
    check.details_url === expectedRunUrl(repositoryName, runId) ||
    check.details_url ===
      `https://github.com/${repositoryName}/runs/${check.id}`
  );
}

async function validateActionsRun({
  expectedActor,
  expectedAttempt,
  expectedConclusions = new Set(["success"]),
  expectedEvent,
  expectedPath,
  expectedSha,
  expectedStatuses = new Set(["completed"]),
  expectedTitle,
  repository: repositoryName,
  runId,
  token,
}) {
  let run = await githubRequest(
    token,
    "GET",
    `/repos/${repositoryName}/actions/runs/${runId}`,
  );
  if (run.run_attempt !== expectedAttempt) {
    run = await githubRequest(
      token,
      "GET",
      `/repos/${repositoryName}/actions/runs/${runId}/attempts/${expectedAttempt}`,
    );
  }
  if (
    run.id !== runId ||
    run.run_attempt !== expectedAttempt ||
    !expectedStatuses.has(run.status) ||
    !expectedConclusions.has(run.conclusion) ||
    (expectedEvent instanceof Set
      ? !expectedEvent.has(run.event)
      : run.event !== expectedEvent) ||
    run.path !== expectedPath ||
    run.head_branch !== "main" ||
    run.head_repository?.full_name !== repositoryName ||
    run.head_sha !== expectedSha ||
    (expectedTitle !== undefined && run.display_title !== expectedTitle) ||
    (expectedActor !== undefined &&
      (run.actor?.id !== expectedActor.id ||
        run.actor?.login !== expectedActor.login ||
        run.actor?.type !== expectedActor.type))
  ) {
    fail("Actions run provenance is not exact");
  }
  return run;
}

async function validateLivePullRequest(token, packet) {
  const pull = await githubRequest(
    token,
    "GET",
    `/repos/${packet.repository}/pulls/${packet.pullRequestNumber}`,
  );
  if (
    pull.number !== packet.pullRequestNumber ||
    pull.state !== "open" ||
    pull.draft !== false ||
    pull.user?.login !== "dependabot[bot]" ||
    pull.user?.type !== "Bot" ||
    pull.head?.repo?.full_name !== packet.repository ||
    pull.base?.repo?.full_name !== packet.repository ||
    pull.head?.ref !== packet.headRef ||
    pull.head?.sha !== packet.headSha ||
    pull.base?.ref !== "main" ||
    pull.base?.sha !== packet.baseSha
  ) {
    fail("live pull request moved or lost Dependabot identity");
  }
  return pull;
}

async function loadProcessorPacket(
  token,
  payload,
  { requireLiveHead = true } = {},
) {
  const checkId = payload.processorReceipt.checkId;
  const check = await githubRequest(
    token,
    "GET",
    `/repos/${payload.repository}/check-runs/${checkId}`,
  );
  if (
    check.id !== checkId ||
    check.name !== "Dependabot Processor" ||
    check.app?.id !== GITHUB_ACTIONS_APP_ID ||
    check.head_sha !== payload.headSha ||
    check.status !== "completed" ||
    check.conclusion !== "failure" ||
    !checkDetailsBound(
      check,
      payload.repository,
      payload.processorReceipt.workflowRunId,
    )
  ) {
    fail("Processor check provenance is invalid");
  }
  const text = check.output?.text;
  boundedString(text, "Processor packet text", { max: 64 * 1024, min: 2 });
  if (rawDigest(text) !== payload.processorReceipt.digest)
    fail("Processor packet digest changed");
  const packet = validateProcessorRepairPacket(
    parseCanonicalJson(text, "Processor packet"),
  );
  if (
    packet.repository !== payload.repository ||
    packet.pullRequestNumber !== payload.prNumber ||
    packet.headRef !== payload.headRef ||
    packet.headSha !== payload.headSha ||
    packet.baseSha !== payload.baseSha ||
    packet.attemptNumber !== payload.repairAttempt ||
    packet.workflowRunId !== payload.processorReceipt.workflowRunId ||
    packet.workflowRunAttempt !== payload.processorReceipt.workflowRunAttempt ||
    packet.workflowSha !== payload.processorReceipt.workflowSha
  ) {
    fail("Processor packet does not match dispatch");
  }
  const external = `dependabot-processor:v2:pr=${payload.prNumber}:head=${payload.headSha}:mode=prepare:repair=${payload.repairAttempt}:packet=true:digest=${payload.processorReceipt.digest}:run=${payload.processorReceipt.workflowRunId}:attempt=${payload.processorReceipt.workflowRunAttempt}`;
  if (check.external_id !== external) fail("Processor external ID is invalid");
  await validateActionsRun({
    expectedAttempt: payload.processorReceipt.workflowRunAttempt,
    expectedEvent: new Set(["repository_dispatch", "schedule", "workflow_run"]),
    expectedPath: ".github/workflows/dependabot-process.yml",
    expectedSha: payload.processorReceipt.workflowSha,
    repository: payload.repository,
    runId: payload.processorReceipt.workflowRunId,
    token,
  });
  if (requireLiveHead) await validateLivePullRequest(token, packet);
  return { check, packet, text };
}

async function commandRepairPreflight(args) {
  const event = JSON.parse(readFileSync(requiredArg(args, "--event"), "utf8"));
  const repositoryName = requiredArg(args, "--repository");
  repository(repositoryName);
  const payload = validateRepairDispatchPayload(event.client_payload);
  if (payload.repository !== repositoryName) fail("event repository changed");
  const token = requiredArg(
    new Map([["--token", process.env.GH_TOKEN ?? ""]]),
    "--token",
  );
  const { check, packet, text } = await loadProcessorPacket(token, payload);
  writeOutputs(requiredArg(args, "--github-output"), {
    base_sha: packet.baseSha,
    head_ref: packet.headRef,
    head_sha: packet.headSha,
    packet_base64: Buffer.from(text).toString("base64"),
    packet_digest: payload.processorReceipt.digest,
    packet_json: text,
    processor_check_id: check.id,
    pull_request_number: packet.pullRequestNumber,
    repair_attempt: packet.attemptNumber,
    retry_count: payload.retryCount,
  });
}

function exactCliPositiveInteger(value, label) {
  boundedString(value, label, {
    max: 16,
    min: 1,
    pattern: /^[1-9][0-9]*$/,
  });
  return safeInteger(Number(value), label);
}

function decodeExactBase64(value, label) {
  boundedString(value, label, { max: 128 * 1024, min: 4 });
  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    )
  ) {
    fail(`${label} is not canonical base64`);
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) {
    fail(`${label} is not canonical base64`);
  }
  return bytes;
}

async function authenticateMaterializedPacket({
  packetDigest,
  packetText,
  processorCheckId,
  repositoryName,
  token,
}) {
  const packet = validateProcessorRepairPacket(
    parseCanonicalJson(packetText, "Processor packet"),
  );
  if (
    packet.repository !== repositoryName ||
    rawDigest(packetText) !== packetDigest
  ) {
    fail("Processor packet CLI binding changed");
  }
  const check = await githubRequest(
    token,
    "GET",
    `/repos/${repositoryName}/check-runs/${processorCheckId}`,
  );
  const external = `dependabot-processor:v2:pr=${packet.pullRequestNumber}:head=${packet.headSha}:mode=prepare:repair=${packet.attemptNumber}:packet=true:digest=${packetDigest}:run=${packet.workflowRunId}:attempt=${packet.workflowRunAttempt}`;
  if (
    check?.id !== processorCheckId ||
    check?.name !== "Dependabot Processor" ||
    check?.app?.id !== GITHUB_ACTIONS_APP_ID ||
    check?.app?.slug !== "github-actions" ||
    check?.head_sha !== packet.headSha ||
    check?.status !== "completed" ||
    check?.conclusion !== "failure" ||
    check?.external_id !== external ||
    check?.output?.text !== packetText ||
    !checkDetailsBound(check, repositoryName, packet.workflowRunId)
  ) {
    fail("Processor packet check provenance is invalid");
  }
  await validateActionsRun({
    expectedAttempt: packet.workflowRunAttempt,
    expectedEvent: new Set(["repository_dispatch", "schedule", "workflow_run"]),
    expectedPath: ".github/workflows/dependabot-process.yml",
    expectedSha: packet.workflowSha,
    repository: repositoryName,
    runId: packet.workflowRunId,
    token,
  });
  const pull = await validateLivePullRequest(token, packet);
  boundedString(pull.updated_at, "pull request updated_at", {
    max: 100,
    min: 1,
  });
  safeInteger(pull.changed_files, "pull request changed_files", { max: 300 });
  return { packet, pull };
}

function sameSortedStrings(left, right) {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

export async function collectExactPullFiles(token, packet, pull) {
  const files = [];
  const pageCount = Math.ceil(pull.changed_files / 100);
  for (let page = 1; page <= pageCount; page += 1) {
    const pageFiles = await githubRequest(
      token,
      "GET",
      `/repos/${packet.repository}/pulls/${packet.pullRequestNumber}/files?per_page=100&page=${page}`,
    );
    if (!Array.isArray(pageFiles) || pageFiles.length > 100) {
      fail("pull request file inventory is malformed");
    }
    files.push(...pageFiles);
  }
  if (files.length !== pull.changed_files || files.length > 300) {
    fail("pull request file inventory is incomplete");
  }
  const expectedByPath = new Map(
    packet.expectedBlobs.map((blob) => [blob.path, blob]),
  );
  const changedPaths = new Set(packet.changedPaths);
  if (
    changedPaths.size !== packet.changedPaths.length ||
    expectedByPath.size !== packet.expectedBlobs.length
  ) {
    fail("packet path inventories contain duplicates");
  }
  const seen = new Set();
  const inventory = [];
  for (const [index, file] of files.entries()) {
    const filename = pathName(file?.filename, `pull files[${index}].filename`);
    const expected = expectedByPath.get(filename);
    const fileSha = sha(file?.sha, `pull files[${index}].sha`);
    if (
      seen.has(filename) ||
      !changedPaths.has(filename) ||
      (expected !== undefined && fileSha !== expected.sha) ||
      !new Set(["added", "changed", "modified"]).has(file.status) ||
      (file.previous_filename !== undefined && file.previous_filename !== null)
    ) {
      fail(`pull request file does not match the packet: ${filename}`);
    }
    seen.add(filename);
    inventory.push({
      additions: safeInteger(file.additions, `pull files[${index}].additions`, {
        max: 1_000_000,
        min: 0,
      }),
      changes: safeInteger(file.changes, `pull files[${index}].changes`, {
        max: 1_000_000,
        min: 0,
      }),
      deletions: safeInteger(file.deletions, `pull files[${index}].deletions`, {
        max: 1_000_000,
        min: 0,
      }),
      path: filename,
      sha: fileSha,
      status: file.status,
    });
  }
  if (!sameSortedStrings(seen, changedPaths)) {
    fail("live pull request paths changed from the packet");
  }
  return inventory.sort((left, right) => left.path.localeCompare(right.path));
}

function validateExactPullDiff(diff, packet) {
  if (!diff.startsWith("diff --git ")) fail("pull request diff is malformed");
  const diffPaths = [];
  for (const line of diff.split("\n")) {
    if (!line.startsWith("diff --git ")) continue;
    const match = /^diff --git a\/(\S+) b\/(\S+)$/.exec(line);
    if (match === null) fail("pull request diff contains an unsafe path");
    const oldPath = pathName(match[1], "diff old path");
    const newPath = pathName(match[2], "diff new path");
    if (oldPath !== newPath) fail("pull request diff contains a rename");
    diffPaths.push(newPath);
  }
  if (
    new Set(diffPaths).size !== diffPaths.length ||
    !sameSortedStrings(diffPaths, packet.changedPaths)
  ) {
    fail("pull request diff paths do not match the packet");
  }
  return diff;
}

export function validateFailureRun(run, packet, runId, failure) {
  const policy = FAILURE_SOURCE_POLICY[failure.id];
  if (
    policy === undefined ||
    run?.id !== runId ||
    run?.head_sha !== packet.headSha ||
    run?.head_repository?.full_name !== packet.repository ||
    run?.status !== "completed" ||
    run?.conclusion !== "failure" ||
    !policy.events.includes(run?.event) ||
    !policy.workflowPaths.includes(
      String(run?.path ?? "").replace(/@.*$/, ""),
    ) ||
    !Number.isSafeInteger(run?.run_attempt) ||
    run.run_attempt < 1
  ) {
    fail("failure workflow run provenance is not exact");
  }
  boundedString(String(run.path).replace(/@.*$/, ""), "failure workflow path", {
    max: 300,
    min: 1,
    pattern: /^\.github\/workflows\/[A-Za-z0-9._/-]+$/,
  });
  return run;
}

function validateFailureJob(job, packet, runId, runAttempt, label) {
  if (
    !Number.isSafeInteger(job?.id) ||
    job.id < 1 ||
    job.run_id !== runId ||
    job.run_attempt !== runAttempt ||
    job.head_sha !== packet.headSha ||
    job.status !== "completed" ||
    typeof job.name !== "string" ||
    job.name.length < 1 ||
    job.name.length > 300 ||
    job.run_url !==
      `https://api.github.com/repos/${packet.repository}/actions/runs/${runId}`
  ) {
    fail(`${label} provenance is not exact`);
  }
  return job;
}

function exactClaudeReviewFindings(result, packet, checkId) {
  exactKeys(
    result,
    [
      "findings",
      "headSha",
      "pullRequestNumber",
      "repository",
      "reviewCompleted",
      "schema",
      "verdict",
    ],
    "Claude review result",
  );
  if (
    result.schema !== "dependabot-claude-review-result:v1" ||
    result.repository !== packet.repository ||
    result.pullRequestNumber !== packet.pullRequestNumber ||
    result.headSha !== packet.headSha ||
    result.reviewCompleted !== true ||
    result.verdict !== "findings" ||
    !Array.isArray(result.findings) ||
    result.findings.length < 1 ||
    result.findings.length > 20
  ) {
    fail("Claude review result does not contain exact findings");
  }
  return result.findings.map((finding, index) => {
    exactKeys(
      finding,
      ["line", "path", "summary", "title"],
      `Claude review findings[${index}]`,
    );
    pathName(finding.path, `Claude review findings[${index}].path`);
    safeInteger(finding.line, `Claude review findings[${index}].line`);
    boundedString(finding.title, `Claude review findings[${index}].title`, {
      max: 160,
      min: 1,
    });
    boundedString(finding.summary, `Claude review findings[${index}].summary`, {
      max: 1_000,
      min: 1,
    });
    const canonical = {
      line: finding.line,
      path: finding.path,
      summary: finding.summary,
      title: finding.title,
    };
    const findingDigest = canonicalDigest(canonical);
    return {
      checkId,
      digest: findingDigest,
      ...canonical,
      source: "claude",
      sourceId: findingDigest.slice(0, 24),
    };
  });
}

function claudeReviewDisplayTitleMatches(run, packet) {
  const title = String(run.display_title ?? "");
  const native = CLAUDE_REVIEW_RECEIPT_PATTERN.exec(title);
  if (native !== null) {
    return (
      native[1] === packet.repository &&
      Number(native[2]) === packet.pullRequestNumber &&
      native[3] === packet.headSha
    );
  }
  const prepared = CLAUDE_PREPARED_REVIEW_RECEIPT_PATTERN.exec(title);
  return (
    prepared !== null &&
    Number(prepared[1]) === packet.pullRequestNumber &&
    prepared[2] === packet.headSha
  );
}

async function collectClaudeReviewFailureEvidence(
  token,
  packet,
  failure,
  packetFindings,
) {
  if (failure.id !== "claude-review" || failure.name !== "claude-review") {
    fail("Claude review failure identity is not exact");
  }
  const checkIds = new Set(packetFindings.map(({ checkId }) => checkId));
  if (
    packetFindings.length < 1 ||
    checkIds.size !== 1 ||
    !Number.isSafeInteger(packetFindings[0].checkId) ||
    packetFindings[0].checkId < 1 ||
    packet.findings.some(
      (finding) =>
        finding.source !== "claude" &&
        finding.checkId === packetFindings[0].checkId,
    )
  ) {
    fail("Claude review packet findings are ambiguous");
  }
  const checkId = packetFindings[0].checkId;
  const check = await githubRequest(
    token,
    "GET",
    `/repos/${packet.repository}/check-runs/${checkId}`,
  );
  const external = CLAUDE_REVIEW_EXTERNAL_ID_PATTERN.exec(
    String(check?.external_id ?? ""),
  );
  if (external === null) fail("Claude review external receipt is invalid");
  const runId = safeInteger(Number(external[3]), "Claude review run ID");
  const runAttempt = safeInteger(
    Number(external[4]),
    "Claude review run attempt",
  );
  const runUrl = expectedRunUrl(packet.repository, runId);
  const selfUrl = `https://github.com/${packet.repository}/runs/${checkId}`;
  if (
    check?.id !== checkId ||
    check?.name !== "claude-review" ||
    check?.app?.id !== GITHUB_ACTIONS_APP_ID ||
    check?.app?.slug !== "github-actions" ||
    check?.head_sha !== packet.headSha ||
    check?.status !== "completed" ||
    check?.conclusion !== "failure" ||
    check?.details_url !== failure.detailsUrl ||
    !new Set([runUrl, selfUrl]).has(failure.detailsUrl) ||
    Number(external[1]) !== packet.pullRequestNumber ||
    external[2] !== packet.headSha
  ) {
    fail("Claude review check provenance is not exact");
  }
  const reviewText = boundedString(
    check.output?.text,
    "Claude review result text",
    { max: 64 * 1024, min: 2 },
  );
  const expectedFindings = exactClaudeReviewFindings(
    parseCanonicalJson(reviewText, "Claude review result"),
    packet,
    checkId,
  );
  if (canonicalJson(expectedFindings) !== canonicalJson(packetFindings)) {
    fail("Claude review packet findings changed from the check");
  }

  let run = await githubRequest(
    token,
    "GET",
    `/repos/${packet.repository}/actions/runs/${runId}`,
  );
  if (run?.run_attempt !== runAttempt) {
    run = await githubRequest(
      token,
      "GET",
      `/repos/${packet.repository}/actions/runs/${runId}/attempts/${runAttempt}`,
    );
  }
  const workflowPath = String(run?.path ?? "").replace(/@.*$/, "");
  if (
    run?.id !== runId ||
    run?.run_attempt !== runAttempt ||
    run?.status !== "completed" ||
    run?.conclusion !== "failure" ||
    run?.event !== "workflow_run" ||
    workflowPath !== ".github/workflows/dependabot-claude-review.yml" ||
    run?.head_branch !== "main" ||
    run?.repository?.full_name !== packet.repository ||
    run?.head_repository?.full_name !== packet.repository ||
    !HEX_SHA.test(run?.head_sha ?? "") ||
    run.head_sha === packet.headSha ||
    !claudeReviewDisplayTitleMatches(run, packet)
  ) {
    fail("Claude review workflow run provenance is not exact");
  }
  return {
    checkId,
    checkName: check.name,
    detailsUrl: failure.detailsUrl,
    externalId: check.external_id,
    failureId: failure.id,
    kind: "review-findings",
    runAttempt,
    runId,
    workflowHeadSha: run.head_sha,
    workflowPath,
  };
}

async function collectFailureEvidence(token, packet) {
  const failureIndex = [];
  const logFiles = [];
  const runs = new Map();
  const loggedJobs = new Set();
  let totalLogBytes = 0;
  const claudeFailureCandidates = packet.failures.filter(
    ({ id, name }) => id === "claude-review" || name === "claude-review",
  );
  const claudeFindings = packet.findings.filter(
    ({ source }) => source === "claude",
  );
  if (
    claudeFailureCandidates.some(
      ({ id, name }) => id !== "claude-review" || name !== "claude-review",
    ) ||
    claudeFailureCandidates.length > 1 ||
    (claudeFailureCandidates.length === 0 && claudeFindings.length > 0)
  ) {
    fail("Claude review failure evidence is ambiguous");
  }
  for (const [failureIndexValue, failure] of packet.failures.entries()) {
    if (failure.id === "claude-review") {
      failureIndex.push(
        await collectClaudeReviewFailureEvidence(
          token,
          packet,
          failure,
          claudeFindings,
        ),
      );
      continue;
    }
    const escapedRepository = packet.repository.replaceAll("/", "\\/");
    const match = new RegExp(
      `^https:\\/\\/github\\.com\\/${escapedRepository}\\/actions\\/runs\\/([1-9][0-9]*)\\/job\\/([1-9][0-9]*)$`,
    ).exec(failure.detailsUrl ?? "");
    if (match === null) {
      fail(`failure[${failureIndexValue}] has no exact Actions job URL`);
    }
    const runId = safeInteger(Number(match[1]), "failure run ID");
    const jobId = safeInteger(Number(match[2]), "failure job ID");
    let collected = runs.get(runId);
    if (collected === undefined) {
      const run = validateFailureRun(
        await githubRequest(
          token,
          "GET",
          `/repos/${packet.repository}/actions/runs/${runId}`,
        ),
        packet,
        runId,
        failure,
      );
      const jobsResponse = await githubRequest(
        token,
        "GET",
        `/repos/${packet.repository}/actions/runs/${runId}/attempts/${run.run_attempt}/jobs?per_page=100&page=1`,
      );
      if (
        !Number.isSafeInteger(jobsResponse?.total_count) ||
        jobsResponse.total_count < 1 ||
        jobsResponse.total_count > MAX_EVIDENCE_JOB_COUNT ||
        !Array.isArray(jobsResponse.jobs) ||
        jobsResponse.jobs.length !== jobsResponse.total_count
      ) {
        fail("failure workflow job inventory is incomplete or capped");
      }
      const jobs = new Map();
      for (const [index, candidate] of jobsResponse.jobs.entries()) {
        const job = validateFailureJob(
          candidate,
          packet,
          runId,
          run.run_attempt,
          `failure jobs[${index}]`,
        );
        if (jobs.has(job.id)) fail("failure job inventory contains duplicates");
        jobs.set(job.id, job);
      }
      collected = { jobs, run };
      runs.set(runId, collected);
    }
    const target = collected.jobs.get(jobId);
    if (
      target === undefined ||
      target.name !== failure.name ||
      target.html_url !== failure.detailsUrl ||
      !new Set([
        "action_required",
        "cancelled",
        "failure",
        "startup_failure",
        "timed_out",
      ]).has(target.conclusion)
    ) {
      fail(`failure[${failureIndexValue}] job no longer matches the packet`);
    }
    failureIndex.push({
      failureId: failure.id,
      jobId,
      jobName: target.name,
      runAttempt: collected.run.run_attempt,
      runId,
      workflowPath: collected.run.path,
    });
    const failedJobs = [...collected.jobs.values()]
      .filter((job) =>
        new Set([
          "action_required",
          "cancelled",
          "failure",
          "startup_failure",
          "timed_out",
        ]).has(job.conclusion),
      )
      .sort((left, right) => left.id - right.id);
    for (const job of failedJobs) {
      if (loggedJobs.has(job.id)) continue;
      if (loggedJobs.size >= 20) fail("failure job log count exceeds its cap");
      const log = await githubJobLogRequest(token, packet.repository, job.id);
      totalLogBytes += Buffer.byteLength(log);
      if (totalLogBytes > MAX_EVIDENCE_JOB_LOGS_BYTES) {
        fail("failure job logs exceed their aggregate cap");
      }
      loggedJobs.add(job.id);
      logFiles.push({
        content: log,
        source: {
          conclusion: job.conclusion,
          jobId: job.id,
          jobName: job.name,
          runAttempt: collected.run.run_attempt,
          runId: collected.run.id,
        },
      });
    }
  }
  return {
    index: failureIndex.sort((left, right) =>
      left.failureId.localeCompare(right.failureId),
    ),
    logs: logFiles.sort(
      (left, right) => left.source.jobId - right.source.jobId,
    ),
  };
}

function expectedFeedbackLogin(source) {
  return source === "codex" ? "chatgpt-codex-connector" : source;
}

async function collectFeedbackEvidence(token, packet) {
  const evidence = [];
  for (const [index, thread] of packet.feedbackThreads.entries()) {
    const comment = await githubRequest(
      token,
      "GET",
      `/repos/${packet.repository}/pulls/comments/${thread.commentId}`,
    );
    const login = String(comment?.user?.login ?? "")
      .toLowerCase()
      .replace(/\[bot\]$/, "");
    if (
      comment?.id !== thread.commentId ||
      comment?.in_reply_to_id != null ||
      comment?.pull_request_url !==
        `https://api.github.com/repos/${packet.repository}/pulls/${packet.pullRequestNumber}` ||
      comment?.user?.type !== "Bot" ||
      comment?.path !== thread.path ||
      comment?.commit_id !== thread.commitSha ||
      (thread.line !== null && comment?.line !== thread.line) ||
      login !== expectedFeedbackLogin(thread.source) ||
      typeof comment?.body !== "string" ||
      Buffer.byteLength(comment.body) > MAX_FEEDBACK_BODY_BYTES ||
      rawDigest(comment.body) !== thread.digest
    ) {
      fail(`feedbackThreads[${index}] body or provenance changed`);
    }
    evidence.push({ body: comment.body, thread });
  }
  return evidence;
}

function prepareEvidenceOutputRoot(outputRoot) {
  if (
    !isAbsolute(outputRoot) ||
    resolve(outputRoot) !== outputRoot ||
    outputRoot === "/" ||
    outputRoot.includes("\0")
  ) {
    fail("evidence output root is not one exact absolute path");
  }
  mkdirSync(outputRoot, { mode: 0o700, recursive: false });
  chmodSync(outputRoot, 0o700);
  return outputRoot;
}

function evidenceFileEntry(root, name, kind, content, source) {
  if (!/^[a-z][a-z0-9-]{0,60}\.(?:json|patch|txt)$/.test(name)) {
    fail("synthetic evidence filename is invalid");
  }
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
  strictUtf8(bytes, `evidence file ${name}`, { allowEmpty: false });
  validateEvidenceLineLengths(bytes, `evidence file ${name}`);
  const path = join(root, name);
  writeFileSync(path, bytes, { flag: "wx", mode: 0o600 });
  chmodSync(path, 0o400);
  return {
    bytes: bytes.byteLength,
    digest: rawDigest(bytes),
    kind,
    mediaType: name.endsWith(".json") ? "application/json" : "text/plain",
    name,
    source,
  };
}

function validateEvidenceLineLengths(bytes, label) {
  let lineStart = 0;
  for (let index = 0; index <= bytes.byteLength; index += 1) {
    if (index !== bytes.byteLength && bytes[index] !== 0x0a) continue;
    if (index - lineStart > MAX_EVIDENCE_LINE_BYTES) {
      fail(`${label} contains an oversized line`);
    }
    lineStart = index + 1;
  }
}

function prettyJson(value) {
  return `${JSON.stringify(recursivelySorted(value), null, 2)}\n`;
}

export async function materializeRepairEvidence({
  outputRoot,
  packetDigest,
  packetText,
  processorCheckId,
  repositoryName,
  token,
}) {
  repository(repositoryName);
  digest(packetDigest, "packetDigest");
  safeInteger(processorCheckId, "processorCheckId");
  const authenticated = await authenticateMaterializedPacket({
    packetDigest,
    packetText,
    processorCheckId,
    repositoryName,
    token,
  });
  const { packet, pull } = authenticated;
  const pullFiles = await collectExactPullFiles(token, packet, pull);
  const diff = validateExactPullDiff(
    await githubTextRequest(
      token,
      `/repos/${repositoryName}/pulls/${packet.pullRequestNumber}`,
      "application/vnd.github.v3.diff",
      MAX_EVIDENCE_DIFF_BYTES,
      "pull request diff",
    ),
    packet,
  );
  const { entries, treeSha } = await exactTreeEntries(
    token,
    repositoryName,
    packet.headSha,
  );
  const blobs = [];
  let totalBlobBytes = 0;
  for (const expected of [...packet.expectedBlobs].sort((left, right) =>
    left.path.localeCompare(right.path),
  )) {
    const treeEntry = entries.get(expected.path);
    if (
      treeEntry?.path !== expected.path ||
      treeEntry?.sha !== expected.sha ||
      treeEntry?.mode !== expected.mode ||
      treeEntry?.type !== expected.type
    ) {
      fail(`tree entry changed from the packet: ${expected.path}`);
    }
    const content = await loadExactGitBlob(token, repositoryName, expected);
    totalBlobBytes += content.byteLength;
    if (totalBlobBytes > MAX_EVIDENCE_BLOBS_BYTES) {
      fail("Git blobs exceed their aggregate evidence cap");
    }
    blobs.push({ content, expected });
  }
  const failures = await collectFailureEvidence(token, packet);
  const feedback = await collectFeedbackEvidence(token, packet);
  const finalPull = await validateLivePullRequest(token, packet);
  if (
    finalPull.updated_at !== pull.updated_at ||
    finalPull.changed_files !== pull.changed_files
  ) {
    fail("pull request changed while repair evidence was collected");
  }

  const root = prepareEvidenceOutputRoot(outputRoot);
  try {
    const files = [];
    files.push(
      evidenceFileEntry(root, "packet.json", "packet", prettyJson(packet), {
        packetDigest,
        processorCheckId,
      }),
      evidenceFileEntry(root, "pull-request-diff.patch", "pull-diff", diff, {
        baseSha: packet.baseSha,
        headSha: packet.headSha,
        paths: packet.changedPaths,
      }),
      evidenceFileEntry(
        root,
        "pull-file-inventory.json",
        "pull-file-inventory",
        prettyJson(pullFiles),
        { baseSha: packet.baseSha, headSha: packet.headSha },
      ),
    );
    for (const [index, blob] of blobs.entries()) {
      files.push(
        evidenceFileEntry(
          root,
          `blob-${String(index).padStart(3, "0")}.txt`,
          "git-blob",
          blob.content,
          {
            gitBlobSha: blob.expected.sha,
            mode: blob.expected.mode,
            path: blob.expected.path,
            treeSha,
          },
        ),
      );
    }
    files.push(
      evidenceFileEntry(
        root,
        "failure-index.json",
        "failure-index",
        prettyJson(failures.index),
        { headSha: packet.headSha },
      ),
    );
    for (const [index, log] of failures.logs.entries()) {
      files.push(
        evidenceFileEntry(
          root,
          `job-log-${String(index).padStart(3, "0")}.txt`,
          "job-log",
          log.content,
          log.source,
        ),
      );
    }
    files.push(
      evidenceFileEntry(
        root,
        "findings.json",
        "packet-findings",
        prettyJson(packet.findings),
        { packetDigest },
      ),
      evidenceFileEntry(
        root,
        "feedback-index.json",
        "feedback-index",
        prettyJson(feedback.map(({ thread }) => thread)),
        { packetDigest },
      ),
    );
    for (const [index, item] of feedback.entries()) {
      files.push(
        evidenceFileEntry(
          root,
          `feedback-body-${String(index).padStart(3, "0")}.txt`,
          "feedback-body",
          item.body,
          item.thread,
        ),
      );
    }
    if (files.length > MAX_EVIDENCE_MANIFEST_FILES) {
      fail("repair evidence file inventory exceeds its cap");
    }
    const manifest = {
      baseSha: packet.baseSha,
      evidenceRoot: root,
      files: files.sort((left, right) => left.name.localeCompare(right.name)),
      headSha: packet.headSha,
      packetDigest,
      processorCheckId,
      pullRequestNumber: packet.pullRequestNumber,
      repository: repositoryName,
      schema: REPAIR_EVIDENCE_SCHEMA,
      workflowRunAttempt: packet.workflowRunAttempt,
      workflowRunId: packet.workflowRunId,
      workflowSha: packet.workflowSha,
    };
    const manifestPath = join(root, "manifest.json");
    const manifestText = prettyJson(manifest);
    validateEvidenceLineLengths(Buffer.from(manifestText), "evidence manifest");
    writeFileSync(manifestPath, manifestText, {
      flag: "wx",
      mode: 0o600,
    });
    chmodSync(manifestPath, 0o400);
    chmodSync(root, 0o700);
    return {
      manifest,
      manifestDigest: rawDigest(manifestText),
      manifestPath,
      root,
    };
  } catch (error) {
    chmodSync(root, 0o700);
    rmSync(root, { force: true, recursive: true });
    throw error;
  }
}

async function commandMaterializeRepairEvidence(args) {
  const repositoryName = requiredArg(args, "--repository");
  const packetText = strictUtf8(
    decodeExactBase64(requiredArg(args, "--packet-base64"), "packet base64"),
    "packet base64",
  );
  const result = await materializeRepairEvidence({
    outputRoot: requiredArg(args, "--output-root"),
    packetDigest: requiredArg(args, "--packet-digest"),
    packetText,
    processorCheckId: exactCliPositiveInteger(
      requiredArg(args, "--processor-check-id"),
      "processor check ID",
    ),
    repositoryName,
    token: process.env.GH_TOKEN,
  });
  writeOutputs(requiredArg(args, "--github-output"), {
    evidence_root: result.root,
    evidence_manifest: result.manifestPath,
    evidence_manifest_digest: result.manifestDigest,
  });
}

export function gitSubprocessEnvironment(
  workingDirectory,
  ambientEnvironment = process.env,
) {
  return {
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    HOME: workingDirectory,
    LANG: "C",
    LC_ALL: "C",
    PATH: ambientEnvironment.PATH ?? "/usr/bin:/bin",
  };
}

function runGit(arguments_, workingDirectory, input) {
  const result = spawnSync("git", arguments_, {
    cwd: workingDirectory,
    encoding: "utf8",
    env: gitSubprocessEnvironment(workingDirectory),
    input,
  });
  if (result.status !== 0)
    fail(`git ${arguments_.join(" ")} failed: ${result.stderr}`);
  return result.stdout;
}

export function validateRepairPatch(edit) {
  if (
    /^(?:GIT binary patch|Binary files |new file mode |deleted file mode |old mode |new mode |rename from |rename to )/m.test(
      edit.patch,
    )
  ) {
    fail(`patch contains a forbidden operation: ${edit.path}`);
  }
  const lines = edit.patch.split("\n");
  const oldHeaders = lines.filter((line) => line.startsWith("--- "));
  const newHeaders = lines.filter((line) => line.startsWith("+++ "));
  if (
    oldHeaders.length !== 1 ||
    newHeaders.length !== 1 ||
    oldHeaders[0] !== `--- a/${edit.path}` ||
    newHeaders[0] !== `+++ b/${edit.path}`
  ) {
    fail(`patch headers do not bind one exact path: ${edit.path}`);
  }
  let addedLines = 0;
  let deletedLines = 0;
  let inHunk = false;
  for (const line of lines) {
    if (/^@@ -[0-9]+(?:,[0-9]+)? \+[0-9]+(?:,[0-9]+)? @@/.test(line)) {
      inHunk = true;
      continue;
    }
    if (!inHunk) continue;
    if (line.startsWith("+")) addedLines += 1;
    if (line.startsWith("-")) deletedLines += 1;
  }
  if (!inHunk) fail(`patch has no bounded hunk: ${edit.path}`);
  return {
    addedLines,
    bytes: Buffer.byteLength(edit.patch),
    changes: addedLines + deletedLines,
    deletedLines,
  };
}

async function exactTreeEntries(token, repositoryName, headSha) {
  const commit = await githubRequest(
    token,
    "GET",
    `/repos/${repositoryName}/git/commits/${headSha}`,
  );
  sha(commit.tree?.sha, "commit tree SHA");
  const tree = await githubRequest(
    token,
    "GET",
    `/repos/${repositoryName}/git/trees/${commit.tree.sha}?recursive=1`,
  );
  if (
    tree.truncated === true ||
    !Array.isArray(tree.tree) ||
    tree.tree.length > 100_000
  ) {
    fail("Git tree evidence is incomplete or capped");
  }
  const entries = new Map();
  for (const entry of tree.tree) {
    if (typeof entry.path !== "string" || entries.has(entry.path)) {
      fail("Git tree contains malformed or duplicate paths");
    }
    entries.set(entry.path, entry);
  }
  return { entries, treeSha: commit.tree.sha };
}

export function gitBlobSha(content) {
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
  return createHash("sha1")
    .update(Buffer.from(`blob ${bytes.byteLength}\0`))
    .update(bytes)
    .digest("hex");
}

function decodeGitHubBase64(value, label) {
  if (typeof value !== "string") fail(`${label} is not base64 text`);
  const normalized = value.replaceAll("\n", "");
  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      normalized,
    )
  ) {
    fail(`${label} is not canonical base64`);
  }
  const bytes = Buffer.from(normalized, "base64");
  if (bytes.toString("base64") !== normalized) {
    fail(`${label} is not canonical base64`);
  }
  return bytes;
}

async function loadExactGitBlob(
  token,
  repositoryName,
  expected,
  { maximumBytes = MAX_EVIDENCE_BLOB_BYTES } = {},
) {
  const blob = await githubRequest(
    token,
    "GET",
    `/repos/${repositoryName}/git/blobs/${expected.sha}`,
  );
  if (
    blob?.sha !== expected.sha ||
    blob?.encoding !== "base64" ||
    !Number.isSafeInteger(blob?.size) ||
    blob.size < 0 ||
    blob.size > maximumBytes
  ) {
    fail(`Git blob metadata changed or exceeds its cap: ${expected.path}`);
  }
  const content = decodeGitHubBase64(
    blob.content,
    `Git blob content for ${expected.path}`,
  );
  if (
    content.byteLength !== blob.size ||
    gitBlobSha(content) !== expected.sha
  ) {
    fail(`Git blob bytes do not match the exact tree: ${expected.path}`);
  }
  strictUtf8(content, `Git blob content for ${expected.path}`, {
    allowEmpty: true,
  });
  return content;
}

export async function applyRepairPlan({ packet, plan, repositoryName, token }) {
  const expectedBlobs = new Map(
    packet.expectedBlobs.map((blob) => [blob.path, blob]),
  );
  const { entries, treeSha } = await exactTreeEntries(
    token,
    repositoryName,
    packet.headSha,
  );
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "dependabot-repair-"));
  const totals = { addedLines: 0, bytes: 0, changes: 0, deletedLines: 0 };
  try {
    runGit(["init", "--quiet"], temporaryDirectory);
    const appliedEdits = [];
    for (const edit of plan.edits) {
      const counts = validateRepairPatch(edit);
      for (const key of Object.keys(totals)) totals[key] += counts[key];
      const expected = expectedBlobs.get(edit.path);
      const treeEntry = entries.get(edit.path);
      if (
        expected === undefined ||
        treeEntry?.path !== expected.path ||
        treeEntry?.sha !== expected.sha ||
        treeEntry?.mode !== expected.mode ||
        treeEntry?.type !== expected.type ||
        treeEntry.type !== "blob" ||
        !new Set(["100644", "100755"]).has(treeEntry.mode)
      ) {
        fail(
          `tree entry changed or is not a regular packet-bound blob: ${edit.path}`,
        );
      }
      const content = await loadExactGitBlob(token, repositoryName, expected);
      const filePath = join(temporaryDirectory, edit.path);
      mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
      writeFileSync(filePath, content, {
        mode: treeEntry.mode === "100755" ? 0o700 : 0o600,
      });
      const patchPath = join(
        temporaryDirectory,
        `.patch-${appliedEdits.length}`,
      );
      writeFileSync(patchPath, edit.patch, { mode: 0o600 });
      runGit(
        ["apply", "--check", "--whitespace=error-all", patchPath],
        temporaryDirectory,
      );
      runGit(
        ["apply", "--whitespace=error-all", patchPath],
        temporaryDirectory,
      );
      const newContent = readFileSync(filePath);
      appliedEdits.push({
        ...edit,
        content: newContent,
        contentDigest: rawDigest(newContent),
        mode: treeEntry.mode,
        type: treeEntry.type,
      });
    }
    if (
      totals.addedLines > packet.limits.maxAddedLines ||
      totals.deletedLines > packet.limits.maxDeletedLines ||
      totals.changes > packet.limits.maxChanges ||
      totals.bytes > packet.limits.maxBytes
    ) {
      fail("repair plan exceeds aggregate change limits");
    }
    return { edits: appliedEdits, treeSha };
  } finally {
    rmSync(temporaryDirectory, { force: true, recursive: true });
  }
}

async function commandValidateRepairPlan(args) {
  const repositoryName = requiredArg(args, "--repository");
  repository(repositoryName);
  const packetText = Buffer.from(
    requiredArg(args, "--packet-base64"),
    "base64",
  ).toString();
  const packet = validateProcessorRepairPacket(
    parseCanonicalJson(packetText, "Processor packet"),
  );
  const packetDigest = rawDigest(packetText);
  const plan = parseJsonValue(requiredArg(args, "--plan-json"), "repair plan");
  const processorCheckId = Number(requiredArg(args, "--processor-check-id"));
  safeInteger(processorCheckId, "processorCheckId");
  validateRepairPlan(plan, {
    packet,
    packetDigest,
    processorCheckId,
  });
  const token = process.env.GH_TOKEN;
  await validateLivePullRequest(token, packet);
  const applied = await applyRepairPlan({
    packet,
    plan,
    repositoryName,
    token,
  });
  const validated = {
    ...plan,
    edits: applied.edits.map((edit) => ({
      contentDigest: edit.contentDigest,
      expectedBlobSha: edit.expectedBlobSha,
      mode: edit.mode,
      patch: edit.patch,
      path: edit.path,
      type: edit.type,
    })),
    schema: VALIDATED_REPAIR_PLAN_SCHEMA,
  };
  validateValidatedRepairPlan(validated, {
    packet,
    packetDigest,
    processorCheckId,
  });
  const canonical = canonicalJson(validated);
  writeOutputs(requiredArg(args, "--github-output"), {
    validated_plan_base64: Buffer.from(canonical).toString("base64"),
    validated_plan_digest: rawDigest(canonical),
  });
}

async function reloadPacketFromValidatedPlan(
  readToken,
  packet,
  validated,
  packetText,
  retryCount,
) {
  const payload = {
    baseSha: packet.baseSha,
    headRef: packet.headRef,
    headSha: packet.headSha,
    prNumber: packet.pullRequestNumber,
    processorReceipt: {
      checkId: validated.processorCheckId,
      digest: rawDigest(packetText),
      workflowRunAttempt: packet.workflowRunAttempt,
      workflowRunId: packet.workflowRunId,
      workflowSha: packet.workflowSha,
    },
    repairAttempt: packet.attemptNumber,
    repository: packet.repository,
    retryCount,
    schema: "dependabot-prepare-repair:v1",
  };
  await loadProcessorPacket(readToken, payload);
  return payload;
}

function prepareIdentityFromArgs(args) {
  const identity = {
    prepareAppSlug: requiredArg(args, "--prepare-app-slug"),
    prepareBotId: Number(requiredArg(args, "--prepare-bot-id")),
    prepareBotLogin: requiredArg(args, "--prepare-bot-login"),
  };
  validatePrepareIdentity(identity);
  return identity;
}

function repairRunTitle(intent) {
  return `dependabot-repair:v1 | pr=${intent.pullRequestNumber} | head=${intent.parentHeadSha} | check=${intent.processorCheckId} | digest=${intent.packetDigest} | retry=${intent.retryCount}`;
}

function repairRecoveryRunTitle(payload) {
  return `dependabot-repair-recover:v1 | pr=${payload.prNumber} | head=${payload.headSha} | check=${payload.intentReceipt.checkId} | digest=${payload.intentReceipt.digest} | retry=${payload.retryCount}`;
}

export function parseRepairRunTitle(title) {
  boundedString(title, "repair run title", { max: 255, min: 1 });
  const normal = title.match(
    /^dependabot-repair:v1 \| pr=([1-9][0-9]*) \| head=([0-9a-f]{40}) \| check=([1-9][0-9]*) \| digest=([0-9a-f]{64}) \| retry=([0-2])$/,
  );
  const recovery = title.match(
    /^dependabot-repair-recover:v1 \| pr=([1-9][0-9]*) \| head=([0-9a-f]{40}) \| check=([1-9][0-9]*) \| digest=([0-9a-f]{64}) \| retry=([0-2])$/,
  );
  const match = normal ?? recovery;
  if (match === null) fail("repair run title is not exact");
  const parsed = {
    checkId: Number(match[3]),
    digest: match[4],
    headSha: match[2],
    kind: normal === null ? "recovery" : "repair",
    pullRequestNumber: Number(match[1]),
    retryCount: Number(match[5]),
  };
  safeInteger(parsed.checkId, "repair run title check ID");
  safeInteger(parsed.pullRequestNumber, "repair run title PR number");
  safeInteger(parsed.retryCount, "repair run title retry count", {
    max: 2,
    min: 0,
  });
  return parsed;
}

export function nextInfrastructureRetry(retryCount) {
  safeInteger(retryCount, "infrastructure retry count", { max: 2, min: 0 });
  return retryCount < 2 ? retryCount + 1 : null;
}

export function validateRepairCommit(commit, intent) {
  const exactPrepareCommitter =
    commit.committer?.id === intent.prepareBotId &&
    commit.committer?.login === intent.prepareBotLogin &&
    commit.committer?.type === "Bot";
  const exactGitHubSystemCommitter =
    commit.committer?.id === GITHUB_WEB_FLOW_USER_ID &&
    commit.committer?.login === "web-flow" &&
    commit.committer?.type === "User";
  if (
    commit.sha !== intent.headSha ||
    commit.parents?.length !== 1 ||
    commit.parents[0]?.sha !== intent.parentHeadSha ||
    commit.commit?.tree?.sha !== intent.treeSha ||
    commit.commit?.verification?.verified !== true ||
    commit.commit?.verification?.reason !== "valid" ||
    commit.author?.id !== intent.prepareBotId ||
    commit.author?.login !== intent.prepareBotLogin ||
    commit.author?.type !== "Bot" ||
    (!exactPrepareCommitter && !exactGitHubSystemCommitter)
  ) {
    fail("staged repair commit is not an exact Prepare App append");
  }
  return commit;
}

function validatePullForIntent(
  pull,
  intent,
  expectedHeadSha,
  { requireBaseSha = true } = {},
) {
  if (
    pull.number !== intent.pullRequestNumber ||
    pull.state !== "open" ||
    pull.draft !== false ||
    pull.user?.login !== "dependabot[bot]" ||
    pull.user?.type !== "Bot" ||
    pull.head?.repo?.full_name !== intent.repository ||
    pull.base?.repo?.full_name !== intent.repository ||
    pull.head?.ref !== intent.headRef ||
    pull.head?.sha !== expectedHeadSha ||
    pull.base?.ref !== "main" ||
    (requireBaseSha && pull.base?.sha !== intent.baseSha)
  ) {
    fail("live pull request does not match repair intent");
  }
  return pull;
}

async function verifyRepairIntentTree(token, intent) {
  const parent = await exactTreeEntries(
    token,
    intent.repository,
    intent.parentHeadSha,
  );
  const successor = await exactTreeEntries(
    token,
    intent.repository,
    intent.headSha,
  );
  if (
    parent.treeSha !== intent.parentTreeSha ||
    successor.treeSha !== intent.treeSha ||
    parent.entries.size !== successor.entries.size
  ) {
    fail("repair intent tree identity changed");
  }
  const edits = new Map(intent.edits.map((edit) => [edit.path, edit]));
  const editAncestors = new Set();
  for (const edit of intent.edits) {
    const parts = edit.path.split("/");
    for (let index = 1; index < parts.length; index += 1) {
      editAncestors.add(parts.slice(0, index).join("/"));
    }
  }
  for (const [path, parentEntry] of parent.entries) {
    const successorEntry = successor.entries.get(path);
    const edit = edits.get(path);
    if (edit !== undefined) {
      if (
        parentEntry.sha !== edit.expectedBlobSha ||
        successorEntry?.sha !== edit.resultBlobSha ||
        parentEntry.mode !== edit.mode ||
        successorEntry?.mode !== edit.mode ||
        parentEntry.type !== edit.type ||
        successorEntry?.type !== edit.type
      ) {
        fail(`repair intent tree edit changed: ${path}`);
      }
      continue;
    }
    const changedAncestor =
      parentEntry.type === "tree" && editAncestors.has(path);
    if (
      successorEntry?.path !== parentEntry.path ||
      successorEntry?.mode !== parentEntry.mode ||
      successorEntry?.type !== parentEntry.type ||
      (!changedAncestor && successorEntry?.sha !== parentEntry.sha)
    ) {
      fail(`repair intent changed an unlisted tree entry: ${path}`);
    }
  }
  for (const edit of intent.edits) {
    const blob = await githubRequest(
      token,
      "GET",
      `/repos/${intent.repository}/git/blobs/${edit.resultBlobSha}`,
    );
    if (
      blob.sha !== edit.resultBlobSha ||
      blob.encoding !== "base64" ||
      typeof blob.content !== "string" ||
      blob.content.length > 2_000_000
    ) {
      fail(`repair intent result blob is malformed: ${edit.path}`);
    }
    const content = Buffer.from(blob.content.replaceAll("\n", ""), "base64");
    if (rawDigest(content) !== edit.contentDigest) {
      fail(`repair intent result blob digest changed: ${edit.path}`);
    }
  }
}

async function loadIntentProcessorPacket(token, intent) {
  const check = await githubRequest(
    token,
    "GET",
    `/repos/${intent.repository}/check-runs/${intent.processorCheckId}`,
  );
  const text = boundedString(check.output?.text, "Processor packet text", {
    max: 64 * 1024,
    min: 2,
  });
  const packet = validateProcessorRepairPacket(
    parseCanonicalJson(text, "Processor packet"),
  );
  const payload = {
    baseSha: intent.baseSha,
    headRef: intent.headRef,
    headSha: intent.parentHeadSha,
    prNumber: intent.pullRequestNumber,
    processorReceipt: {
      checkId: intent.processorCheckId,
      digest: intent.packetDigest,
      workflowRunAttempt: packet.workflowRunAttempt,
      workflowRunId: packet.workflowRunId,
      workflowSha: packet.workflowSha,
    },
    repairAttempt: intent.attempt,
    repository: intent.repository,
    retryCount: intent.retryCount,
    schema: "dependabot-prepare-repair:v1",
  };
  return loadProcessorPacket(token, validateRepairDispatchPayload(payload), {
    requireLiveHead: false,
  });
}

async function listNamedChecks(token, repositoryName, headSha, name) {
  const checks = [];
  const seen = new Set();
  let totalCount;
  for (let page = 1; page <= MAX_TERMINAL_CHECK_PAGES; page += 1) {
    const response = await githubRequest(
      token,
      "GET",
      `/repos/${repositoryName}/commits/${headSha}/check-runs?check_name=${encodeURIComponent(name)}&filter=all&per_page=${CHECK_PAGE_SIZE}&page=${page}`,
    );
    if (
      !Number.isSafeInteger(response.total_count) ||
      response.total_count < 0 ||
      !Array.isArray(response.check_runs) ||
      response.check_runs.length > CHECK_PAGE_SIZE
    ) {
      fail(`named ${name} check collection is malformed`);
    }
    totalCount ??= response.total_count;
    if (response.total_count !== totalCount) {
      fail(`named ${name} check count changed`);
    }
    for (const check of response.check_runs) {
      if (
        !Number.isSafeInteger(check.id) ||
        check.id < 1 ||
        check.name !== name ||
        seen.has(check.id)
      ) {
        fail(`named ${name} check evidence is malformed`);
      }
      seen.add(check.id);
      checks.push(check);
    }
    if (
      response.check_runs.length < CHECK_PAGE_SIZE ||
      page * CHECK_PAGE_SIZE >= totalCount
    ) {
      break;
    }
  }
  if (seen.size !== totalCount) {
    fail(`named ${name} check collection is incomplete`);
  }
  return checks;
}

function validateRepairIntentCheck({ check, checkId, intent, intentText }) {
  if (
    check.id !== checkId ||
    check.name !== "Dependabot Repair Intent" ||
    check.app?.id !== GITHUB_ACTIONS_APP_ID ||
    check.app?.slug !== "github-actions" ||
    check.head_sha !== intent.headSha ||
    check.status !== "completed" ||
    check.conclusion !== "success" ||
    !checkDetailsBound(check, intent.repository, intent.workflowRunId) ||
    check.external_id !== repairIntentExternalId(intent) ||
    check.output?.text !== intentText
  ) {
    fail("repair intent check is not exact");
  }
  return check;
}

async function publishCanonicalCheck({
  body,
  externalId,
  headSha,
  name,
  repositoryName,
  runId,
  text,
  token,
}) {
  const checks = await listNamedChecks(token, repositoryName, headSha, name);
  for (const check of checks) {
    if (check.external_id !== externalId) continue;
    if (
      check.app?.id !== GITHUB_ACTIONS_APP_ID ||
      check.app?.slug !== "github-actions" ||
      check.head_sha !== headSha ||
      check.status !== "completed" ||
      check.conclusion !== "success" ||
      !checkDetailsBound(check, repositoryName, runId) ||
      check.output?.text !== text
    ) {
      fail(`existing ${name} check conflicts with canonical evidence`);
    }
    return check;
  }
  return githubRequest(
    token,
    "POST",
    `/repos/${repositoryName}/check-runs`,
    body,
  );
}

async function commandStageRepair(args) {
  const repositoryName = requiredArg(args, "--repository");
  repository(repositoryName);
  const packetText = Buffer.from(
    requiredArg(args, "--packet-base64"),
    "base64",
  ).toString();
  const packet = validateProcessorRepairPacket(
    parseCanonicalJson(packetText, "Processor packet"),
  );
  const packetDigest = rawDigest(packetText);
  const validatedText = Buffer.from(
    requiredArg(args, "--validated-plan-base64"),
    "base64",
  ).toString();
  if (
    rawDigest(validatedText) !== requiredArg(args, "--validated-plan-digest")
  ) {
    fail("validated repair plan digest changed");
  }
  const validated = validateValidatedRepairPlan(
    parseCanonicalJson(validatedText, "validated repair plan"),
    {
      packet,
      packetDigest,
      processorCheckId: JSON.parse(validatedText).processorCheckId,
    },
  );
  const readToken = process.env.GH_READ_TOKEN;
  const writeToken = process.env.GH_WRITE_TOKEN;
  boundedString(readToken, "read-only GitHub token", { max: 10_000, min: 1 });
  boundedString(writeToken, "Repair App GitHub token", { max: 10_000, min: 1 });
  if (readToken === writeToken) {
    fail("Repair publication requires distinct read and write credentials");
  }
  const retryCount = Number(requiredArg(args, "--retry-count"));
  safeInteger(retryCount, "retryCount", { max: 2, min: 0 });
  await reloadPacketFromValidatedPlan(
    readToken,
    packet,
    validated,
    packetText,
    retryCount,
  );
  const applied = await applyRepairPlan({
    packet,
    plan: validated,
    repositoryName,
    token: readToken,
  });

  const reference = await githubRequest(
    readToken,
    "GET",
    `/repos/${repositoryName}/git/ref/heads/${packet.headRef
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`,
  );
  if (
    reference.object?.sha !== packet.headSha ||
    reference.object?.type !== "commit"
  ) {
    fail("branch ref moved before repair publication");
  }
  const baseReference = await githubRequest(
    readToken,
    "GET",
    `/repos/${repositoryName}/git/ref/heads/main`,
  );
  if (baseReference.object?.sha !== packet.baseSha)
    fail("main moved before repair publication");
  const parentCommit = await githubRequest(
    readToken,
    "GET",
    `/repos/${repositoryName}/git/commits/${packet.headSha}`,
  );
  sha(parentCommit.tree?.sha, "parent tree SHA");
  if (parentCommit.tree.sha !== applied.treeSha) {
    fail("parent tree changed before repair publication");
  }

  const treeEntries = [];
  const stagedEdits = [];
  const validatedByPath = new Map(
    validated.edits.map((edit) => [edit.path, edit]),
  );
  for (const edit of applied.edits) {
    const expected = validatedByPath.get(edit.path);
    if (
      expected?.contentDigest !== edit.contentDigest ||
      expected?.mode !== edit.mode ||
      expected?.type !== edit.type
    ) {
      fail(`reapplied repair does not match validated result: ${edit.path}`);
    }
    const blob = await githubRequest(
      writeToken,
      "POST",
      `/repos/${repositoryName}/git/blobs`,
      { content: edit.content.toString("base64"), encoding: "base64" },
    );
    sha(blob.sha, `created blob for ${edit.path}`);
    treeEntries.push({
      mode: edit.mode,
      path: edit.path,
      sha: blob.sha,
      type: edit.type,
    });
    stagedEdits.push({
      contentDigest: edit.contentDigest,
      expectedBlobSha: edit.expectedBlobSha,
      mode: edit.mode,
      path: edit.path,
      resultBlobSha: blob.sha,
      type: edit.type,
    });
  }
  const tree = await githubRequest(
    writeToken,
    "POST",
    `/repos/${repositoryName}/git/trees`,
    { base_tree: parentCommit.tree.sha, tree: treeEntries },
  );
  const commit = await githubRequest(
    writeToken,
    "POST",
    `/repos/${repositoryName}/git/commits`,
    {
      message: `chore(deps): repair Dependabot update\n\nAttempt ${packet.attemptNumber}; packet ${packetDigest}`,
      parents: [packet.headSha],
      tree: tree.sha,
    },
  );
  sha(commit.sha, "repair commit SHA");
  sha(tree.sha, "repair tree SHA");
  const finalCommit = await githubRequest(
    readToken,
    "GET",
    `/repos/${repositoryName}/commits/${commit.sha}`,
  );
  const identity = prepareIdentityFromArgs(args);
  const intent = validateRepairIntent({
    attempt: packet.attemptNumber,
    baseSha: packet.baseSha,
    edits: stagedEdits,
    editsDigest: canonicalDigest(stagedEdits),
    headRef: packet.headRef,
    headSha: commit.sha,
    packetDigest,
    parentHeadSha: packet.headSha,
    parentTreeSha: parentCommit.tree.sha,
    ...identity,
    processorCheckId: validated.processorCheckId,
    pullRequestNumber: packet.pullRequestNumber,
    repository: packet.repository,
    retryCount,
    schema: REPAIR_INTENT_SCHEMA,
    state: "staged",
    treeDigest: canonicalDigest({
      parentTreeSha: parentCommit.tree.sha,
      treeSha: tree.sha,
    }),
    treeSha: tree.sha,
    validatedPlanDigest: rawDigest(validatedText),
    workflowRunAttempt: Number(requiredArg(args, "--workflow-run-attempt")),
    workflowRunId: Number(requiredArg(args, "--workflow-run-id")),
    workflowSha: requiredArg(args, "--workflow-sha"),
  });
  validateRepairCommit(finalCommit, intent);
  await verifyRepairIntentTree(readToken, intent);
  const intentText = canonicalJson(intent);
  writeOutputs(requiredArg(args, "--github-output"), {
    new_head_sha: commit.sha,
    intent_base64: Buffer.from(intentText).toString("base64"),
    intent_digest: rawDigest(intentText),
  });
}

function loadIntentArgument(args) {
  const intentText = Buffer.from(
    requiredArg(args, "--intent-base64"),
    "base64",
  ).toString();
  if (rawDigest(intentText) !== requiredArg(args, "--intent-digest")) {
    fail("repair intent digest changed");
  }
  const intent = validateRepairIntent(
    parseCanonicalJson(intentText, "repair intent"),
  );
  return { intent, intentText };
}

async function validateRepairIntentSource(
  token,
  intent,
  expectedConclusions,
  expectedStatuses,
) {
  return validateActionsRun({
    expectedActor: {
      id: intent.prepareBotId,
      login: intent.prepareBotLogin,
      type: "Bot",
    },
    expectedAttempt: intent.workflowRunAttempt,
    expectedConclusions,
    expectedEvent: "repository_dispatch",
    expectedPath: ".github/workflows/dependabot-prepare-repair.yml",
    expectedSha: intent.workflowSha,
    expectedStatuses,
    expectedTitle: repairRunTitle(intent),
    repository: intent.repository,
    runId: intent.workflowRunId,
    token,
  });
}

async function commandPublishRepairIntent(args) {
  const repositoryName = requiredArg(args, "--repository");
  repository(repositoryName);
  const { intent, intentText } = loadIntentArgument(args);
  if (intent.repository !== repositoryName)
    fail("repair intent repository changed");
  const token = process.env.GH_TOKEN;
  await validateRepairIntentSource(
    token,
    intent,
    new Set([null]),
    new Set(["in_progress"]),
  );
  await loadIntentProcessorPacket(token, intent);
  const pull = await githubRequest(
    token,
    "GET",
    `/repos/${repositoryName}/pulls/${intent.pullRequestNumber}`,
  );
  validatePullForIntent(pull, intent, intent.parentHeadSha);
  const commit = await githubRequest(
    token,
    "GET",
    `/repos/${repositoryName}/commits/${intent.headSha}`,
  );
  validateRepairCommit(commit, intent);
  await verifyRepairIntentTree(token, intent);
  const externalId = repairIntentExternalId(intent);
  const check = await publishCanonicalCheck({
    body: {
      conclusion: "success",
      details_url: expectedRunUrl(repositoryName, intent.workflowRunId),
      external_id: externalId,
      head_sha: intent.headSha,
      name: "Dependabot Repair Intent",
      output: {
        summary:
          "One exact staged successor is authorized for a non-force ref move.",
        text: intentText,
        title: "Dependabot repair intent staged",
      },
      status: "completed",
    },
    externalId,
    headSha: intent.headSha,
    name: "Dependabot Repair Intent",
    repositoryName,
    runId: intent.workflowRunId,
    text: intentText,
    token,
  });
  safeInteger(check.id, "repair intent check ID");
  validateRepairIntentCheck({ check, checkId: check.id, intent, intentText });
  writeOutputs(requiredArg(args, "--github-output"), {
    check_id: check.id,
    external_id: externalId,
  });
}

async function commandApplyRepairIntent(args) {
  const repositoryName = requiredArg(args, "--repository");
  repository(repositoryName);
  const { intent, intentText } = loadIntentArgument(args);
  if (intent.repository !== repositoryName)
    fail("repair intent repository changed");
  const identity = prepareIdentityFromArgs(args);
  if (
    identity.prepareAppSlug !== intent.prepareAppSlug ||
    identity.prepareBotId !== intent.prepareBotId ||
    identity.prepareBotLogin !== intent.prepareBotLogin
  ) {
    fail("configured Prepare App identity changed after intent publication");
  }
  const readToken = process.env.GH_READ_TOKEN;
  const writeToken = process.env.GH_WRITE_TOKEN;
  boundedString(readToken, "read-only GitHub token", { max: 10_000, min: 1 });
  boundedString(writeToken, "Repair App GitHub token", { max: 10_000, min: 1 });
  if (readToken === writeToken) {
    fail("Repair ref move requires distinct read and write credentials");
  }
  await validateRepairIntentSource(
    readToken,
    intent,
    new Set([null]),
    new Set(["in_progress"]),
  );
  await loadIntentProcessorPacket(readToken, intent);
  const checkId = Number(requiredArg(args, "--intent-check-id"));
  safeInteger(checkId, "repair intent check ID");
  const check = await githubRequest(
    readToken,
    "GET",
    `/repos/${repositoryName}/check-runs/${checkId}`,
  );
  validateRepairIntentCheck({ check, checkId, intent, intentText });
  const pull = await githubRequest(
    readToken,
    "GET",
    `/repos/${repositoryName}/pulls/${intent.pullRequestNumber}`,
  );
  validatePullForIntent(pull, intent, intent.parentHeadSha);
  const commit = await githubRequest(
    readToken,
    "GET",
    `/repos/${repositoryName}/commits/${intent.headSha}`,
  );
  validateRepairCommit(commit, intent);
  await verifyRepairIntentTree(readToken, intent);
  const encodedRef = intent.headRef
    .split("/")
    .map(encodeURIComponent)
    .join("/");
  const reference = await githubRequest(
    readToken,
    "GET",
    `/repos/${repositoryName}/git/ref/heads/${encodedRef}`,
  );
  if (
    reference.object?.type !== "commit" ||
    reference.object?.sha !== intent.parentHeadSha
  ) {
    fail("branch ref moved before repair intent application");
  }
  const baseReference = await githubRequest(
    readToken,
    "GET",
    `/repos/${repositoryName}/git/ref/heads/main`,
  );
  if (baseReference.object?.sha !== intent.baseSha) {
    fail("main moved before repair intent application");
  }
  await githubRequest(
    writeToken,
    "PATCH",
    `/repos/${repositoryName}/git/refs/heads/${encodedRef}`,
    { force: false, sha: intent.headSha },
  );
  const finalReference = await githubRequest(
    readToken,
    "GET",
    `/repos/${repositoryName}/git/ref/heads/${encodedRef}`,
  );
  if (
    finalReference.object?.type !== "commit" ||
    finalReference.object?.sha !== intent.headSha
  ) {
    fail("repair ref verification failed");
  }
  const finalPull = await githubRequest(
    readToken,
    "GET",
    `/repos/${repositoryName}/pulls/${intent.pullRequestNumber}`,
  );
  validatePullForIntent(finalPull, intent, intent.headSha);
  const receipt = validateRepairReceipt({
    attempt: intent.attempt,
    baseSha: intent.baseSha,
    headRef: intent.headRef,
    headSha: intent.headSha,
    packetDigest: intent.packetDigest,
    parentHeadSha: intent.parentHeadSha,
    prepareAppSlug: intent.prepareAppSlug,
    prepareBotId: intent.prepareBotId,
    prepareBotLogin: intent.prepareBotLogin,
    processorCheckId: intent.processorCheckId,
    pullRequestNumber: intent.pullRequestNumber,
    repository: intent.repository,
    schema: "dependabot-repair:v1",
    state: "completed",
    workflowRunAttempt: intent.workflowRunAttempt,
    workflowRunId: intent.workflowRunId,
    workflowSha: intent.workflowSha,
  });
  const receiptText = canonicalJson(receipt);
  writeOutputs(requiredArg(args, "--github-output"), {
    new_head_sha: intent.headSha,
    operation_digest: rawDigest(receiptText),
    receipt_base64: Buffer.from(receiptText).toString("base64"),
  });
}

async function commandPublishRepairReceipt(args) {
  const repositoryName = requiredArg(args, "--repository");
  repository(repositoryName);
  const receiptText = Buffer.from(
    requiredArg(args, "--receipt-base64"),
    "base64",
  ).toString();
  const receipt = validateRepairReceipt(
    parseCanonicalJson(receiptText, "repair receipt"),
  );
  if (receipt.repository !== repositoryName)
    fail("repair receipt repository changed");
  const token = process.env.GH_TOKEN;
  const pull = await githubRequest(
    token,
    "GET",
    `/repos/${repositoryName}/pulls/${receipt.pullRequestNumber}`,
  );
  if (
    pull.state !== "open" ||
    pull.draft !== false ||
    pull.head?.ref !== receipt.headRef ||
    pull.head?.sha !== receipt.headSha ||
    pull.base?.sha !== receipt.baseSha
  ) {
    fail("PR moved before repair receipt publication");
  }
  const commit = await githubRequest(
    token,
    "GET",
    `/repos/${repositoryName}/git/commits/${receipt.headSha}`,
  );
  if (
    commit.parents?.length !== 1 ||
    commit.parents[0]?.sha !== receipt.parentHeadSha
  ) {
    fail("repair commit lineage changed before receipt publication");
  }
  const externalId = operationExternalId(receipt);
  const check = await publishCanonicalCheck({
    body: {
      conclusion: "success",
      details_url: expectedRunUrl(repositoryName, receipt.workflowRunId),
      external_id: externalId,
      head_sha: receipt.headSha,
      name: "Dependabot Repair",
      output: {
        summary: "One packet-bound append-only repair commit was published.",
        text: receiptText,
        title: "Dependabot repair completed",
      },
      status: "completed",
    },
    externalId,
    headSha: receipt.headSha,
    name: "Dependabot Repair",
    repositoryName,
    runId: receipt.workflowRunId,
    text: receiptText,
    token,
  });
  safeInteger(check.id, "repair check ID");
  writeOutputs(requiredArg(args, "--github-output"), {
    check_id: check.id,
    external_id: externalId,
  });
}

async function listOpenDependabotPulls(token, repositoryName) {
  const pulls = await githubRequest(
    token,
    "GET",
    `/repos/${repositoryName}/pulls?state=open&per_page=100`,
  );
  if (!Array.isArray(pulls) || pulls.length > 50) {
    fail("open pull-request collection is malformed or capped");
  }
  return pulls.filter(
    (pull) =>
      pull.user?.login === "dependabot[bot]" &&
      pull.user?.type === "Bot" &&
      pull.head?.repo?.full_name === repositoryName &&
      pull.base?.repo?.full_name === repositoryName &&
      pull.base?.ref === "main" &&
      pull.state === "open" &&
      pull.draft === false,
  );
}

export async function readCurrentDefaultBranchSha({
  repositoryName,
  requestJson,
}) {
  repository(repositoryName);
  const repositoryState = plainObject(
    await requestJson(`/repos/${repositoryName}`),
    "repository state",
  );
  if (
    repositoryState.full_name !== repositoryName ||
    repositoryState.default_branch !== "main"
  ) {
    fail("repository default branch is not exact");
  }
  const reference = plainObject(
    await requestJson(`/repos/${repositoryName}/git/ref/heads/main`),
    "default-branch reference",
  );
  if (
    reference.ref !== "refs/heads/main" ||
    reference.object?.type !== "commit"
  ) {
    fail("default-branch reference is not exact");
  }
  return sha(reference.object.sha, "current default-branch SHA");
}

export async function collectTerminalSourceChecks({
  pulls,
  repositoryName,
  requestJson,
  sourceRunAttempt,
  sourceRunId,
  sourceWorkflow,
}) {
  const names =
    sourceWorkflow === "Dependabot Processor"
      ? ["Dependabot Refresh", "Dependabot Processor"]
      : sourceWorkflow === "Dependabot Prepare Repair"
        ? ["Dependabot Repair", "Dependabot Repair Intent"]
        : fail("terminal check source workflow is invalid");
  const checks = [];
  for (const pull of pulls) {
    for (const name of names) {
      const kind =
        name === "Dependabot Refresh"
          ? "refresh"
          : name === "Dependabot Repair"
            ? "repair"
            : name === "Dependabot Repair Intent"
              ? "intent"
              : "processor";
      const seen = new Set();
      let totalCount;
      for (let page = 1; page <= MAX_TERMINAL_CHECK_PAGES; page += 1) {
        const response = await requestJson(
          `/repos/${repositoryName}/commits/${pull.head.sha}/check-runs?` +
            `check_name=${encodeURIComponent(name)}&filter=all&per_page=${CHECK_PAGE_SIZE}&page=${page}`,
        );
        if (
          !Number.isSafeInteger(response.total_count) ||
          response.total_count < 0 ||
          !Array.isArray(response.check_runs) ||
          response.check_runs.length > CHECK_PAGE_SIZE
        ) {
          fail(`named check collection is malformed for PR ${pull.number}`);
        }
        totalCount ??= response.total_count;
        if (response.total_count !== totalCount) {
          fail(`named check count changed for PR ${pull.number}`);
        }
        for (const check of response.check_runs) {
          if (
            !Number.isSafeInteger(check.id) ||
            check.id < 1 ||
            check.name !== name ||
            seen.has(check.id)
          ) {
            fail(`named check evidence is malformed for PR ${pull.number}`);
          }
          seen.add(check.id);
          const externalId = check.external_id;
          const sourceRunUrl = expectedRunUrl(repositoryName, sourceRunId);
          const mentionsSource =
            typeof externalId === "string" &&
            externalId.includes(`:run=${sourceRunId}:`);
          if (!mentionsSource && check.details_url !== sourceRunUrl) continue;
          if (!mentionsSource) {
            fail(
              `source check external run binding is missing for PR ${pull.number}`,
            );
          }
          const binding = sourceAttemptBinding(
            externalId,
            sourceRunId,
            sourceRunAttempt,
            kind,
          );
          if (binding === "malformed") {
            fail(
              `source check external run binding is malformed for PR ${pull.number}`,
            );
          }
          if (binding === "current") checks.push({ check, pull });
        }
        if (
          response.check_runs.length < CHECK_PAGE_SIZE ||
          page * CHECK_PAGE_SIZE >= totalCount
        ) {
          break;
        }
      }
      if (seen.size !== totalCount) {
        fail(`named check collection is incomplete for PR ${pull.number}`);
      }
    }
  }
  return checks;
}

async function currentHeadChecks(
  token,
  repositoryName,
  pulls,
  sourceWorkflow,
  sourceRunId,
  sourceRunAttempt,
) {
  return collectTerminalSourceChecks({
    pulls,
    repositoryName,
    requestJson: (path) => githubRequest(token, "GET", path),
    sourceRunAttempt,
    sourceRunId,
    sourceWorkflow,
  });
}

function preparedPayloadFromReceipt(receipt, check) {
  const receiptDigest = canonicalDigest(receipt);
  return validatePreparedHeadPayload({
    headRef: receipt.headRef,
    headSha: receipt.headSha,
    operation:
      receipt.schema === "dependabot-refresh:v1" ? "refresh" : "repair",
    operationReceipt: {
      checkId: check.id,
      digest: receiptDigest,
      externalId: operationExternalId(receipt),
      workflowRunAttempt: receipt.workflowRunAttempt,
      workflowRunId: receipt.workflowRunId,
      workflowSha: receipt.workflowSha,
    },
    parentHeadSha: receipt.parentHeadSha,
    prNumber: receipt.pullRequestNumber,
    prepareApp: {
      botId: receipt.prepareBotId,
      botLogin: receipt.prepareBotLogin,
      slug: receipt.prepareAppSlug,
    },
    repository: receipt.repository,
    schema: "dependabot-prepared-head-intake:v1",
  });
}

function validateOperationCheck({ check, pull, receipt, sourceRunId }) {
  if (
    check.app?.id !== GITHUB_ACTIONS_APP_ID ||
    check.app?.slug !== "github-actions" ||
    check.head_sha !== pull.head.sha ||
    check.status !== "completed" ||
    check.conclusion !== "success" ||
    receipt.headSha !== pull.head.sha ||
    receipt.headRef !== pull.head.ref ||
    receipt.pullRequestNumber !== pull.number ||
    receipt.workflowRunId !== sourceRunId ||
    !checkDetailsBound(check, receipt.repository, sourceRunId) ||
    check.external_id !== operationExternalId(receipt)
  ) {
    fail("operation receipt check is not exact");
  }
}

function validateRequestedRefreshCheck({
  check,
  currentBaseSha,
  pull,
  receipt,
  sourceRunId,
}) {
  if (
    check.app?.id !== GITHUB_ACTIONS_APP_ID ||
    check.app?.slug !== "github-actions" ||
    check.head_sha !== pull.head.sha ||
    check.status !== "completed" ||
    check.conclusion !== "success" ||
    receipt.headSha !== null ||
    receipt.parentHeadSha !== pull.head.sha ||
    receipt.headRef !== pull.head.ref ||
    receipt.pullRequestNumber !== pull.number ||
    receipt.workflowRunId !== sourceRunId ||
    !checkDetailsBound(check, receipt.repository, sourceRunId) ||
    check.external_id !== operationExternalId(receipt)
  ) {
    fail("requested refresh check is not exact");
  }
  return (
    receipt.previousBaseSha === pull.base?.sha &&
    receipt.baseSha === currentBaseSha
  );
}

export function createRequestedRefreshAction({
  check,
  currentBaseSha,
  pull,
  receipt,
  sourceRunId,
}) {
  validateRefreshReceipt(receipt, { state: "requested" });
  sha(currentBaseSha, "current default-branch SHA");
  if (
    !validateRequestedRefreshCheck({
      check,
      currentBaseSha,
      pull,
      receipt,
      sourceRunId,
    })
  ) {
    return null;
  }
  return {
    eventType: "dependabot-process",
    payload: validateProcessDispatchPayload({ scope: "open" }),
    prepareApp: {
      botId: receipt.prepareBotId,
      botLogin: receipt.prepareBotLogin,
      slug: receipt.prepareAppSlug,
    },
  };
}

export function createRepairRecoveryAction({
  check,
  intent,
  intentText,
  pull,
  retryCount,
  sourceRunId,
}) {
  validateRepairIntent(intent);
  if (intent.headSha !== pull.head?.sha) return null;
  if (
    intent.pullRequestNumber !== pull.number ||
    intent.headRef !== pull.head?.ref ||
    intent.workflowRunId !== sourceRunId
  ) {
    fail("repair intent does not match current PR or source run");
  }
  validateRepairIntentCheck({
    check,
    checkId: check.id,
    intent,
    intentText,
  });
  const payload = validateRepairRecoveryPayload({
    baseSha: intent.baseSha,
    headRef: intent.headRef,
    headSha: intent.headSha,
    intentReceipt: {
      checkId: check.id,
      digest: rawDigest(intentText),
      workflowRunAttempt: intent.workflowRunAttempt,
      workflowRunId: intent.workflowRunId,
      workflowSha: intent.workflowSha,
    },
    parentHeadSha: intent.parentHeadSha,
    prNumber: intent.pullRequestNumber,
    repairAttempt: intent.attempt,
    repository: intent.repository,
    retryCount,
    schema: REPAIR_RECOVERY_SCHEMA,
  });
  return {
    eventType: "dependabot-prepare-repair-recover",
    payload,
    prepareApp: {
      botId: intent.prepareBotId,
      botLogin: intent.prepareBotLogin,
      slug: intent.prepareAppSlug,
    },
  };
}

export async function createRepairRetryAction({
  pull,
  repositoryName,
  title,
  token,
}) {
  if (title.kind !== "repair") fail("repair retry title kind changed");
  const nextRetry = nextInfrastructureRetry(title.retryCount);
  if (nextRetry === null || pull === undefined) return null;
  if (
    pull.number !== title.pullRequestNumber ||
    pull.head?.sha !== title.headSha
  ) {
    return null;
  }
  const check = await githubRequest(
    token,
    "GET",
    `/repos/${repositoryName}/check-runs/${title.checkId}`,
  );
  const packetText = boundedString(check.output?.text, "repair retry packet", {
    max: 64 * 1024,
    min: 2,
  });
  if (rawDigest(packetText) !== title.digest) {
    fail("repair retry packet digest changed");
  }
  const packet = validateProcessorRepairPacket(
    parseCanonicalJson(packetText, "repair retry packet"),
  );
  const payload = validateRepairDispatchPayload({
    baseSha: packet.baseSha,
    headRef: packet.headRef,
    headSha: packet.headSha,
    prNumber: packet.pullRequestNumber,
    processorReceipt: {
      checkId: title.checkId,
      digest: title.digest,
      workflowRunAttempt: packet.workflowRunAttempt,
      workflowRunId: packet.workflowRunId,
      workflowSha: packet.workflowSha,
    },
    repairAttempt: packet.attemptNumber,
    repository: packet.repository,
    retryCount: nextRetry,
    schema: "dependabot-prepare-repair:v1",
  });
  await loadProcessorPacket(token, payload);
  return { eventType: "dependabot-prepare-repair", payload };
}

export async function createRecoveryRetryAction({
  pull,
  repositoryName,
  title,
  token,
}) {
  if (title.kind !== "recovery") fail("recovery retry title kind changed");
  const nextRetry = nextInfrastructureRetry(title.retryCount);
  if (nextRetry === null || pull === undefined) return null;
  if (
    pull.number !== title.pullRequestNumber ||
    pull.head?.sha !== title.headSha
  ) {
    return null;
  }
  const check = await githubRequest(
    token,
    "GET",
    `/repos/${repositoryName}/check-runs/${title.checkId}`,
  );
  const intentText = boundedString(check.output?.text, "retry repair intent", {
    max: 64 * 1024,
    min: 2,
  });
  if (rawDigest(intentText) !== title.digest) {
    fail("recovery retry intent digest changed");
  }
  const intent = validateRepairIntent(
    parseCanonicalJson(intentText, "retry repair intent"),
  );
  if (
    intent.pullRequestNumber !== title.pullRequestNumber ||
    intent.headSha !== title.headSha
  ) {
    fail("recovery retry title does not match intent");
  }
  return createRepairRecoveryAction({
    check,
    intent,
    intentText,
    pull,
    retryCount: nextRetry,
    sourceRunId: intent.workflowRunId,
  });
}

async function commandRecoverRepair(args) {
  const repositoryName = requiredArg(args, "--repository");
  repository(repositoryName);
  const event = JSON.parse(readFileSync(requiredArg(args, "--event"), "utf8"));
  const payload = validateRepairRecoveryPayload(event.client_payload);
  if (payload.repository !== repositoryName)
    fail("repair recovery repository changed");
  const configuredIdentity = prepareIdentityFromArgs(args);
  const token = process.env.GH_TOKEN;
  const intentCheck = await githubRequest(
    token,
    "GET",
    `/repos/${repositoryName}/check-runs/${payload.intentReceipt.checkId}`,
  );
  const intentText = boundedString(
    intentCheck.output?.text,
    "repair intent text",
    { max: 64 * 1024, min: 2 },
  );
  if (rawDigest(intentText) !== payload.intentReceipt.digest) {
    fail("repair recovery intent digest changed");
  }
  const intent = validateRepairIntent(
    parseCanonicalJson(intentText, "repair intent"),
  );
  if (
    intent.repository !== payload.repository ||
    intent.pullRequestNumber !== payload.prNumber ||
    intent.headRef !== payload.headRef ||
    intent.parentHeadSha !== payload.parentHeadSha ||
    intent.headSha !== payload.headSha ||
    intent.baseSha !== payload.baseSha ||
    intent.attempt !== payload.repairAttempt ||
    intent.workflowRunId !== payload.intentReceipt.workflowRunId ||
    intent.workflowRunAttempt !== payload.intentReceipt.workflowRunAttempt ||
    intent.workflowSha !== payload.intentReceipt.workflowSha ||
    intent.prepareAppSlug !== configuredIdentity.prepareAppSlug ||
    intent.prepareBotId !== configuredIdentity.prepareBotId ||
    intent.prepareBotLogin !== configuredIdentity.prepareBotLogin
  ) {
    fail("repair recovery payload does not match intent");
  }
  validateRepairIntentCheck({
    check: intentCheck,
    checkId: payload.intentReceipt.checkId,
    intent,
    intentText,
  });
  await validateRepairIntentSource(
    token,
    intent,
    RETRYABLE_REPAIR_CONCLUSIONS,
    new Set(["completed"]),
  );
  const recoveryRunId = Number(requiredArg(args, "--workflow-run-id"));
  const recoveryRunAttempt = Number(
    requiredArg(args, "--workflow-run-attempt"),
  );
  const recoveryWorkflowSha = requiredArg(args, "--workflow-sha");
  safeInteger(recoveryRunId, "recovery workflow run ID");
  safeInteger(recoveryRunAttempt, "recovery workflow run attempt");
  sha(recoveryWorkflowSha, "recovery workflow SHA");
  await validateActionsRun({
    expectedActor: {
      id: intent.prepareBotId,
      login: intent.prepareBotLogin,
      type: "Bot",
    },
    expectedAttempt: recoveryRunAttempt,
    expectedConclusions: new Set([null]),
    expectedEvent: "repository_dispatch",
    expectedPath: ".github/workflows/dependabot-prepare-repair.yml",
    expectedSha: recoveryWorkflowSha,
    expectedStatuses: new Set(["in_progress"]),
    expectedTitle: repairRecoveryRunTitle(payload),
    repository: repositoryName,
    runId: recoveryRunId,
    token,
  });
  await loadIntentProcessorPacket(token, intent);
  const pull = await githubRequest(
    token,
    "GET",
    `/repos/${repositoryName}/pulls/${intent.pullRequestNumber}`,
  );
  validatePullForIntent(pull, intent, intent.headSha, {
    requireBaseSha: false,
  });
  const reference = await githubRequest(
    token,
    "GET",
    `/repos/${repositoryName}/git/ref/heads/${intent.headRef
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`,
  );
  if (
    reference.object?.type !== "commit" ||
    reference.object?.sha !== intent.headSha
  ) {
    fail("repair recovery ref is not the intended successor");
  }
  const commit = await githubRequest(
    token,
    "GET",
    `/repos/${repositoryName}/commits/${intent.headSha}`,
  );
  validateRepairCommit(commit, intent);
  await verifyRepairIntentTree(token, intent);

  const priorChecks = await listNamedChecks(
    token,
    repositoryName,
    intent.headSha,
    "Dependabot Repair",
  );
  const externalPrefix = `dependabot-repair:v1:pr=${intent.pullRequestNumber}:head=${intent.headSha}:attempt=${intent.attempt}:`;
  for (const check of priorChecks) {
    if (!check.external_id?.startsWith(externalPrefix)) continue;
    const priorText = boundedString(
      check.output?.text,
      "prior repair receipt text",
      { max: 64 * 1024, min: 2 },
    );
    const receipt = validateRepairReceipt(
      parseCanonicalJson(priorText, "prior repair receipt"),
    );
    if (
      receipt.repository !== intent.repository ||
      receipt.pullRequestNumber !== intent.pullRequestNumber ||
      receipt.headRef !== intent.headRef ||
      receipt.parentHeadSha !== intent.parentHeadSha ||
      receipt.headSha !== intent.headSha ||
      receipt.baseSha !== intent.baseSha ||
      receipt.attempt !== intent.attempt ||
      receipt.packetDigest !== intent.packetDigest ||
      receipt.processorCheckId !== intent.processorCheckId ||
      receipt.prepareAppSlug !== intent.prepareAppSlug ||
      receipt.prepareBotId !== intent.prepareBotId ||
      receipt.prepareBotLogin !== intent.prepareBotLogin ||
      check.app?.id !== GITHUB_ACTIONS_APP_ID ||
      check.app?.slug !== "github-actions" ||
      check.head_sha !== intent.headSha ||
      check.status !== "completed" ||
      check.conclusion !== "success" ||
      check.external_id !== operationExternalId(receipt) ||
      !checkDetailsBound(check, repositoryName, receipt.workflowRunId)
    ) {
      fail("prior repair receipt conflicts with recovery intent");
    }
    const priorRun = await validateActionsRun({
      expectedActor: {
        id: intent.prepareBotId,
        login: intent.prepareBotLogin,
        type: "Bot",
      },
      expectedAttempt: receipt.workflowRunAttempt,
      expectedConclusions: new Set([
        ...RETRYABLE_REPAIR_CONCLUSIONS,
        "success",
      ]),
      expectedEvent: "repository_dispatch",
      expectedPath: ".github/workflows/dependabot-prepare-repair.yml",
      expectedSha: receipt.workflowSha,
      expectedStatuses: new Set(["completed"]),
      repository: repositoryName,
      runId: receipt.workflowRunId,
      token,
    });
    if (priorRun.conclusion === "success") {
      writeOutputs(requiredArg(args, "--github-output"), {
        already_completed: "true",
        check_id: check.id,
        external_id: check.external_id,
      });
      return;
    }
  }

  const receipt = validateRepairReceipt({
    attempt: intent.attempt,
    baseSha: intent.baseSha,
    headRef: intent.headRef,
    headSha: intent.headSha,
    packetDigest: intent.packetDigest,
    parentHeadSha: intent.parentHeadSha,
    prepareAppSlug: intent.prepareAppSlug,
    prepareBotId: intent.prepareBotId,
    prepareBotLogin: intent.prepareBotLogin,
    processorCheckId: intent.processorCheckId,
    pullRequestNumber: intent.pullRequestNumber,
    repository: intent.repository,
    schema: "dependabot-repair:v1",
    state: "completed",
    workflowRunAttempt: recoveryRunAttempt,
    workflowRunId: recoveryRunId,
    workflowSha: recoveryWorkflowSha,
  });
  const receiptText = canonicalJson(receipt);
  const externalId = operationExternalId(receipt);
  const check = await publishCanonicalCheck({
    body: {
      conclusion: "success",
      details_url: expectedRunUrl(repositoryName, recoveryRunId),
      external_id: externalId,
      head_sha: intent.headSha,
      name: "Dependabot Repair",
      output: {
        summary:
          "The exact intent-bound repair append was recovered without branch credentials.",
        text: receiptText,
        title: "Dependabot repair recovered",
      },
      status: "completed",
    },
    externalId,
    headSha: intent.headSha,
    name: "Dependabot Repair",
    repositoryName,
    runId: recoveryRunId,
    text: receiptText,
    token,
  });
  safeInteger(check.id, "recovered repair check ID");
  writeOutputs(requiredArg(args, "--github-output"), {
    already_completed: "false",
    check_id: check.id,
    external_id: externalId,
  });
}

async function commandTerminalDispatchPlan(args) {
  const repositoryName = requiredArg(args, "--repository");
  repository(repositoryName);
  const sourceWorkflow = requiredArg(args, "--source-workflow");
  const sourceRunId = Number(requiredArg(args, "--source-run-id"));
  const sourceRunAttempt = Number(requiredArg(args, "--source-run-attempt"));
  const sourceWorkflowSha = requiredArg(args, "--source-workflow-sha");
  safeInteger(sourceRunId, "sourceRunId");
  safeInteger(sourceRunAttempt, "sourceRunAttempt");
  sha(sourceWorkflowSha, "sourceWorkflowSha");
  const configuredAppSlug = args.get("--prepare-app-slug") ?? "";
  const configuredBotId = args.get("--prepare-bot-id") ?? "";
  const configuredBotLogin = args.get("--prepare-bot-login") ?? "";
  const token = process.env.GH_TOKEN;
  const source =
    sourceWorkflow === "Dependabot Processor"
      ? {
          events: new Set(["repository_dispatch", "schedule", "workflow_run"]),
          path: ".github/workflows/dependabot-process.yml",
        }
      : sourceWorkflow === "Dependabot Prepare Repair"
        ? {
            conclusions: new Set([...RETRYABLE_REPAIR_CONCLUSIONS, "success"]),
            events: "repository_dispatch",
            path: ".github/workflows/dependabot-prepare-repair.yml",
          }
        : fail("terminal dispatcher source workflow is invalid");
  source.conclusions ??= new Set(["success"]);
  const sourceRun = await validateActionsRun({
    expectedAttempt: sourceRunAttempt,
    expectedConclusions: source.conclusions,
    expectedEvent: source.events,
    expectedPath: source.path,
    expectedSha: sourceWorkflowSha,
    repository: repositoryName,
    runId: sourceRunId,
    token,
  });
  const repairTitle =
    sourceWorkflow === "Dependabot Prepare Repair"
      ? parseRepairRunTitle(sourceRun.display_title)
      : null;

  const pulls = await listOpenDependabotPulls(token, repositoryName);
  const checks = await currentHeadChecks(
    token,
    repositoryName,
    pulls,
    sourceWorkflow,
    sourceRunId,
    sourceRunAttempt,
  );
  const actions = [];
  let currentDefaultBranchSha;
  for (const { check, pull } of checks) {
    const text = check.output?.text;
    const externalId = check.external_id ?? "";
    const isSourceExternal = externalId.includes(`:run=${sourceRunId}:`);
    if (
      sourceWorkflow === "Dependabot Processor" &&
      check.name === "Dependabot Refresh"
    ) {
      if (!isSourceExternal) continue;
      const binding = sourceAttemptBinding(
        externalId,
        sourceRunId,
        sourceRunAttempt,
        "refresh",
      );
      if (binding === "malformed") {
        fail("refresh receipt external run binding is malformed");
      }
      if (binding !== "current") continue;
      const receipt = validateRefreshReceipt(
        parseCanonicalJson(text, "refresh receipt"),
      );
      if (
        receipt.workflowRunAttempt !== sourceRunAttempt ||
        receipt.workflowSha !== sourceWorkflowSha
      ) {
        fail("refresh receipt run identity changed");
      }
      if (receipt.state === "requested") {
        currentDefaultBranchSha ??= await readCurrentDefaultBranchSha({
          repositoryName,
          requestJson: (path) => githubRequest(token, "GET", path),
        });
        const action = createRequestedRefreshAction({
          check,
          currentBaseSha: currentDefaultBranchSha,
          pull,
          receipt,
          sourceRunId,
        });
        if (action) actions.push(action);
      } else {
        validateOperationCheck({ check, pull, receipt, sourceRunId });
        actions.push({
          eventType: "dependabot-prepared-head",
          payload: preparedPayloadFromReceipt(receipt, check),
        });
      }
      continue;
    }
    if (
      sourceWorkflow === "Dependabot Processor" &&
      check.name === "Dependabot Processor" &&
      /:packet=true:/.test(externalId) &&
      isSourceExternal
    ) {
      const binding = sourceAttemptBinding(
        externalId,
        sourceRunId,
        sourceRunAttempt,
        "processor",
      );
      if (binding === "malformed") {
        fail("repair packet external run binding is malformed");
      }
      if (binding !== "current") continue;
      if (
        check.app?.id !== GITHUB_ACTIONS_APP_ID ||
        check.head_sha !== pull.head.sha ||
        check.status !== "completed" ||
        check.conclusion !== "failure" ||
        !checkDetailsBound(check, repositoryName, sourceRunId)
      ) {
        fail("repair packet check is invalid");
      }
      const packetText = boundedString(text, "repair packet text", {
        max: 64 * 1024,
        min: 2,
      });
      const packetDigest = rawDigest(packetText);
      const packet = validateProcessorRepairPacket(
        parseCanonicalJson(packetText, "repair packet"),
      );
      if (
        packet.pullRequestNumber !== pull.number ||
        packet.headRef !== pull.head.ref ||
        packet.headSha !== pull.head.sha ||
        packet.baseSha !== pull.base.sha ||
        packet.workflowRunId !== sourceRunId ||
        packet.workflowRunAttempt !== sourceRunAttempt ||
        packet.workflowSha !== sourceWorkflowSha
      ) {
        fail("repair packet does not match current PR or source run");
      }
      const expectedExternal = `dependabot-processor:v2:pr=${pull.number}:head=${pull.head.sha}:mode=prepare:repair=${packet.attemptNumber}:packet=true:digest=${packetDigest}:run=${sourceRunId}:attempt=${sourceRunAttempt}`;
      if (externalId !== expectedExternal)
        fail("repair packet external ID is invalid");
      actions.push({
        eventType: "dependabot-prepare-repair",
        payload: validateRepairDispatchPayload({
          baseSha: packet.baseSha,
          headRef: packet.headRef,
          headSha: packet.headSha,
          prNumber: packet.pullRequestNumber,
          processorReceipt: {
            checkId: check.id,
            digest: packetDigest,
            workflowRunAttempt: sourceRunAttempt,
            workflowRunId: sourceRunId,
            workflowSha: sourceWorkflowSha,
          },
          repairAttempt: packet.attemptNumber,
          repository: packet.repository,
          retryCount: 0,
          schema: "dependabot-prepare-repair:v1",
        }),
      });
      continue;
    }
    if (
      sourceWorkflow === "Dependabot Prepare Repair" &&
      sourceRun.conclusion === "success" &&
      check.name === "Dependabot Repair"
    ) {
      if (!isSourceExternal) continue;
      const binding = sourceAttemptBinding(
        externalId,
        sourceRunId,
        sourceRunAttempt,
        "repair",
      );
      if (binding === "malformed") {
        fail("repair receipt external run binding is malformed");
      }
      if (binding !== "current") continue;
      const receipt = validateRepairReceipt(
        parseCanonicalJson(text, "completed repair receipt"),
      );
      if (
        receipt.workflowRunAttempt !== sourceRunAttempt ||
        receipt.workflowSha !== sourceWorkflowSha ||
        receipt.pullRequestNumber !== repairTitle.pullRequestNumber ||
        (repairTitle.kind === "repair" &&
          (receipt.parentHeadSha !== repairTitle.headSha ||
            receipt.processorCheckId !== repairTitle.checkId ||
            receipt.packetDigest !== repairTitle.digest)) ||
        (repairTitle.kind === "recovery" &&
          receipt.headSha !== repairTitle.headSha)
      ) {
        fail("repair receipt run or title identity changed");
      }
      validateOperationCheck({ check, pull, receipt, sourceRunId });
      actions.push({
        eventType: "dependabot-prepared-head",
        payload: preparedPayloadFromReceipt(receipt, check),
      });
      continue;
    }
    if (
      sourceWorkflow === "Dependabot Prepare Repair" &&
      sourceRun.conclusion !== "success" &&
      check.name === "Dependabot Repair Intent"
    ) {
      if (!isSourceExternal) continue;
      const binding = sourceAttemptBinding(
        externalId,
        sourceRunId,
        sourceRunAttempt,
        "intent",
      );
      if (binding === "malformed") {
        fail("repair intent external run binding is malformed");
      }
      if (binding !== "current") continue;
      const intentText = boundedString(text, "repair intent text", {
        max: 64 * 1024,
        min: 2,
      });
      const intent = validateRepairIntent(
        parseCanonicalJson(intentText, "repair intent"),
      );
      if (
        intent.workflowRunAttempt !== sourceRunAttempt ||
        intent.workflowSha !== sourceWorkflowSha ||
        repairTitle.kind !== "repair" ||
        intent.pullRequestNumber !== repairTitle.pullRequestNumber ||
        intent.parentHeadSha !== repairTitle.headSha ||
        intent.processorCheckId !== repairTitle.checkId ||
        intent.packetDigest !== repairTitle.digest ||
        intent.retryCount !== repairTitle.retryCount
      ) {
        fail("repair intent run or title identity changed");
      }
      const action = createRepairRecoveryAction({
        check,
        intent,
        intentText,
        pull,
        retryCount: 0,
        sourceRunId,
      });
      if (action) actions.push(action);
    }
  }

  if (
    actions.length === 0 &&
    sourceWorkflow === "Dependabot Prepare Repair" &&
    sourceRun.conclusion !== "success"
  ) {
    const pull = pulls.find(
      (candidate) => candidate.number === repairTitle.pullRequestNumber,
    );
    const retryAction =
      repairTitle.kind === "repair"
        ? await createRepairRetryAction({
            pull,
            repositoryName,
            title: repairTitle,
            token,
          })
        : await createRecoveryRetryAction({
            pull,
            repositoryName,
            title: repairTitle,
            token,
          });
    if (retryAction) actions.push(retryAction);
  }

  if (actions.length > 1)
    fail("terminal source produced ambiguous preparation actions");
  if (actions.length === 0) {
    writeOutputs(requiredArg(args, "--github-output"), {
      actionable: "false",
      event_type: "none",
      payload_base64: "none",
    });
    return;
  }
  terminalActionConfiguration(actions, {
    prepareAppSlug: configuredAppSlug,
    prepareBotId: configuredBotId,
    prepareBotLogin: configuredBotLogin,
  });
  const [action] = actions;
  const payloadText = canonicalJson(action.payload);
  writeOutputs(requiredArg(args, "--github-output"), {
    actionable: "true",
    event_type: action.eventType,
    payload_base64: Buffer.from(payloadText).toString("base64"),
  });
}

async function commandDispatchTerminalEvent(args) {
  const repositoryName = requiredArg(args, "--repository");
  repository(repositoryName);
  const eventType = requiredArg(args, "--event-type");
  const payloadText = Buffer.from(
    requiredArg(args, "--payload-base64"),
    "base64",
  ).toString();
  const payload = parseCanonicalJson(payloadText, "terminal dispatch payload");
  validateTerminalEventPayload(eventType, payload, repositoryName);
  await githubRequest(
    process.env.GH_TOKEN,
    "POST",
    `/repos/${repositoryName}/dispatches`,
    { client_payload: payload, event_type: eventType },
  );
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const args = argsMap(rest);
  if (command === "repair-preflight") return commandRepairPreflight(args);
  if (command === "materialize-repair-evidence")
    return commandMaterializeRepairEvidence(args);
  if (command === "validate-repair-plan")
    return commandValidateRepairPlan(args);
  if (command === "stage-repair") return commandStageRepair(args);
  if (command === "publish-repair-intent")
    return commandPublishRepairIntent(args);
  if (command === "apply-repair-intent") return commandApplyRepairIntent(args);
  if (command === "publish-repair-receipt")
    return commandPublishRepairReceipt(args);
  if (command === "recover-repair") return commandRecoverRepair(args);
  if (command === "terminal-dispatch-plan")
    return commandTerminalDispatchPlan(args);
  if (command === "dispatch-terminal-event")
    return commandDispatchTerminalEvent(args);
  fail(`unknown preparation command: ${command ?? ""}`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
