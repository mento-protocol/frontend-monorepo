#!/usr/bin/env node

/* eslint-disable turbo/no-undeclared-env-vars -- GitHub Actions and the direct CLI supply controller inputs outside Turbo tasks. */

import { readFileSync } from "node:fs";
import process from "node:process";
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  canonicalJson,
  hardDeniedRepairPath,
  rawDigest,
  validateProcessorRepairPacket,
} from "./dependabot-preparation-receipts.mjs";

export const DEPENDABOT_PROCESSOR_SCHEMA = "dependabot-processor:v2";
export const DEPENDABOT_REPAIR_PACKET_SCHEMA = "dependabot-repair-packet:v2";
export const DEPENDABOT_PROTECTED_RUNTIME_REPAIR_PACKET_SCHEMA =
  "dependabot-repair-packet:v3";
export const DEPENDABOT_POST_MERGE_SCHEMA = "dependabot-post-merge:v1";
export const DEPENDABOT_REFRESH_SCHEMA = "dependabot-refresh:v1";
export const DEPENDABOT_REPAIR_SCHEMA = "dependabot-repair:v1";
export const DEPENDABOT_ALL_CLEAR_SCHEMA = "dependabot-all-clear:v1";

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const DEPENDABOT_LOGIN = "dependabot[bot]";
const DEPENDABOT_USER_ID = 49_699_333;
const PROCESSOR_MODES = new Set(["observe", "assist", "prepare"]);
const PROCESSOR_PHASES = new Set(["request", "mutate", "finalize"]);
const PASSING_CONCLUSIONS = new Set(["success"]);
const PENDING_STATUSES = new Set([
  "expected",
  "in_progress",
  "pending",
  "queued",
  "requested",
  "waiting",
]);
const VETO_LABELS = new Set([
  "dependencies:manual",
  "dependabot:manual",
  "do-not-merge",
  "no-auto-merge",
  "processor:veto",
]);
const TRUSTED_HUMAN_ASSOCIATIONS = new Set(["COLLABORATOR", "MEMBER", "OWNER"]);
const ACTIONABLE_REVIEW_BOTS = new Set([
  "chatgpt-codex-connector",
  "claude",
  "cursor",
]);
const FEEDBACK_BLOCKER_LIMIT = 50;
const DURABLE_EVENT_EVIDENCE_LIMIT = 50;
const REVIEW_THREAD_PAGE_LIMIT = 10;
const REVIEW_THREAD_COMMENT_LIMIT = 100;
const REVIEW_ENVELOPE_BODY_LIMIT = 50_000;
const REPAIR_LINEAGE_COMMIT_LIMIT = 100;
const REPAIR_LINEAGE_CHECK_CONCURRENCY = 4;
const CHECK_SOURCE_RESOLUTION_CONCURRENCY = 8;
const REFRESH_SUCCESSOR_POLL_ATTEMPTS = 5;
const REFRESH_SNAPSHOT_RACE_ATTEMPTS = 5;
const REFRESH_SUCCESSOR_POLL_INTERVAL_MS = 2_000;
const GITHUB_WEB_FLOW_USER_ID = 19_864_447;
const PROCESSOR_APPROVAL_PULL_LIMIT = 100;
const PROCESSOR_APPROVAL_REVIEW_LIMIT = 2_000;
const PROCESSOR_APPROVAL_RESULT_LIMIT = 1_000;
const PROCESSOR_APPROVAL_SCAN_CONCURRENCY = 4;
const PROCESSOR_APPROVAL_SNAPSHOT_ATTEMPTS = 2;
const RECOVERY_ROLLBACK_INVENTORY_ATTEMPTS = 5;
const RECOVERY_ROLLBACK_EMPTY_CONFIRMATIONS = 2;
const PULL_REQUEST_REVIEW_STATES = new Set([
  "APPROVED",
  "CHANGES_REQUESTED",
  "COMMENTED",
  "DISMISSED",
  "PENDING",
]);
const PROCESSOR_CHECK_NAME = "Dependabot Processor";
const REFRESH_CHECK_NAME = "Dependabot Refresh";
const REPAIR_CHECK_NAME = "Dependabot Repair";
const ALL_CLEAR_CHECK_NAME = "Dependabot ALL CLEAR";
const POST_MERGE_CHECK_NAME = "Dependabot Post-Merge Verification";
const PROCESSOR_REPAIR_RECEIPT_PATTERN =
  /^dependabot-processor:v2:pr=([1-9][0-9]{0,9}):head=([0-9a-f]{40}):mode=(observe|assist|prepare):repair=([1-9][0-9]*):packet=(true|false):digest=([0-9a-f]{64}|none):run=([1-9][0-9]*):attempt=([1-9][0-9]*)$/;
const REFRESH_RECEIPT_PATTERN =
  /^dependabot-refresh:v1:pr=([1-9][0-9]{0,9}):head=([0-9a-f]{40}):state=(requested|completed):digest=([0-9a-f]{64}):run=([1-9][0-9]*):attempt=([1-9][0-9]*)$/;
const REPAIR_RECEIPT_PATTERN =
  /^dependabot-repair:v1:pr=([1-9][0-9]{0,9}):head=([0-9a-f]{40}):attempt=([1-9][0-9]*):digest=([0-9a-f]{64}):run=([1-9][0-9]*):run_attempt=([1-9][0-9]*)$/;
const ALL_CLEAR_RECEIPT_PATTERN =
  /^dependabot-all-clear:v1:pr=([1-9][0-9]{0,9}):head=([0-9a-f]{40}):base=([0-9a-f]{40}):digest=([0-9a-f]{64}):run=([1-9][0-9]*):attempt=([1-9][0-9]*)$/;
const POST_MERGE_EXTERNAL_ID_PATTERN =
  /^dependabot-post-merge:([1-9][0-9]*):([1-9][0-9]*)$/;
const CLAUDE_REVIEW_RECEIPT_PATTERN =
  /^dependabot-claude-review:v1 \| source=dependabot-intake:v1 \| repository=([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+) \| pr=([1-9][0-9]{0,9}) \| sha=([0-9a-f]{40}) \| action=(opened|synchronize|reopened) \| receipt=true$/;
const CLAUDE_PREPARED_REVIEW_RECEIPT_PATTERN =
  /^dependabot-claude-review:v1 \| source=dependabot-prepared-head:v1\|p=([1-9][0-9]{0,9})\|h=([0-9a-f]{40})\|o=([rp])\|c=([1-9][0-9]*)\|d=([0-9a-f]{64})\|ok=true$/;
const CLAUDE_REVIEW_EXTERNAL_ID_PATTERN =
  /^dependabot-claude-review:v1:pr=([1-9][0-9]{0,9}):sha=([0-9a-f]{40}):run=([1-9][0-9]*):attempt=([1-9][0-9]*)$/;
const VERCEL_PREVIEW_INTAKE_TITLE_PATTERN =
  /^Vercel preview intake \| pr=([1-9][0-9]{0,9}) \| sha=([0-9a-f]{40}) \| action=(opened|edited|synchronize|reopened|closed)$/;
const CODEX_REVIEW_HEADING = "### 💡 Codex Review";
const SAFE_PROCESSOR_CHECK_DISPOSITIONS = new Set([
  "prepare-candidate",
  "refresh-pending",
  "ready-for-human-review",
  "eligible-observed",
]);
const PREPARE_LANE_DISPOSITIONS = new Set([
  "feedback-remediation-required",
  "prepare-candidate",
  "refresh-pending",
  "refresh-receipt-required",
  "refresh-required",
  "repair-pending",
  "repair-required",
]);
const TERMINAL_PREPARATION_DISPOSITIONS = new Set([
  "manual-repair-escalated",
  "manual-repair-required",
  "manual-review",
  "manual-veto-or-feedback",
  "rejected-identity",
]);
const SENSITIVE_ACTION_PATTERN =
  /^actions\/create-github-app-token(?:\/|$)|(?:^|\/)(?:dependabot|claude|codex|copilot|codeql|osv|security|scorecard|harden-runner|trivy|snyk|attest|dependency-review)(?:[-/]|$)|(?:reviewer|review-action)/i;
const PREPARATION_SENSITIVE_ACTION_PATTERN =
  /(?:^|[/_.-])(?:auth|authentication|credential|credentials|deploy|deployment|login|oidc|permission|policy|token|workflow)(?:[/_.-]|$)/i;
const AUTONOMOUS_REPAIR_FORBIDDEN_PATH_PATTERN =
  /(?:^\.github\/|(?:^|[/_.-])(?:auth|authentication|credential|credentials|deploy|deployment|policy|runtime|security)(?:[/_.-]|$))/i;
const RECEIPT_OUTPUT_LIMIT = 50_000;
const PROTECTED_RUNTIME_BLOB_LIMIT = 256 * 1024;
const PROTECTED_RUNTIME_OPERATION_SCHEMA =
  "dependabot-protected-runtime-sync:v1";
const VERCEL_CLI_RUNTIME_CONTRACT_SCHEMA = "vercel-cli-runtime-contract:v1";
const VERCEL_CLI_RUNTIME_KIND = "vercel-cli-runtime-sync";
const VERCEL_CLI_RUNTIME_PNPM_VERSION = "10.34.4";
const VERCEL_CLI_RUNTIME_GROUPS = new Set([
  "tooling",
  "vercel-cli",
  "vercel-cli-security",
]);
const VERCEL_CLI_RUNTIME_REQUIRED_PATHS = [
  "package.json",
  "pnpm-lock.yaml",
  "scripts/vercel-cli-runtime/contract.json",
  "scripts/vercel-cli-runtime/package.json",
  "scripts/vercel-cli-runtime/pnpm-lock.yaml",
];
const VERCEL_CLI_RUNTIME_INPUT_PATHS = [
  "apps/app.mento.org/package.json",
  "apps/governance.mento.org/package.json",
  "apps/reserve.mento.org/package.json",
  "apps/ui.mento.org/package.json",
  "package.json",
  "packages/eslint-config/package.json",
  "packages/typescript-config/package.json",
  "packages/ui/package.json",
  "packages/vitest-config/package.json",
  "packages/web3/package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "scripts/vercel-cli-runtime/contract.json",
  "scripts/vercel-cli-runtime/package.json",
  "scripts/vercel-cli-runtime/pnpm-lock.yaml",
];

const CHECK_POLICY_DEFINITIONS = [
  {
    id: "ci",
    label: "CI sentinel",
    names: [/^Build and Test$/],
  },
  {
    id: "action-pins",
    label: "GitHub Actions pin policy",
    names: [/^Action Pin Policy$/],
  },
  {
    id: "action-pins-source",
    label: "GitHub Actions pin policy source",
    names: [/^Action Pin Policy Source$/],
  },
  {
    id: "dependency-review",
    label: "Dependency review",
    names: [/^dependency-review$/i],
    failureAttribution: "external",
  },
  {
    id: "supply-chain-root-osv",
    label: "Root OSV scan",
    names: [/^osv-scanner \/ osv-scan$/],
    failureAttribution: "external",
  },
  {
    id: "supply-chain-pnpm-runtime-osv",
    label: "Trusted pnpm runtime OSV scan",
    names: [/^osv-scanner \(trusted pnpm runtime\) \/ osv-scan$/],
    failureAttribution: "external",
  },
  {
    id: "supply-chain-vercel-runtime-osv",
    label: "Standalone Vercel CLI runtime OSV scan",
    names: [/^osv-scanner \(standalone Vercel CLI runtime\) \/ osv-scan$/],
    failureAttribution: "external",
  },
  {
    id: "supply-chain-pnpm-bootstrap-osv",
    label: "Trusted pnpm bootstrap OSV scan",
    names: [/^osv-scanner \(trusted pnpm bootstrap\) \/ osv-scan$/],
    failureAttribution: "external",
  },
  {
    id: "supply-chain-lockfile",
    label: "Lockfile integrity and registry policy",
    names: [/^lockfile integrity \+ registry$/],
  },
  {
    id: "supply-chain-version-skew",
    label: "Catalog version skew",
    names: [/^catalog version-skew$/],
  },
  {
    id: "quality",
    label: "Coverage and production bundle budgets",
    names: [/^coverage and production bundles$/],
  },
  {
    id: "e2e-plan",
    label: "Connected-wallet E2E planner",
    names: [/^E2E Plan$/],
  },
  {
    id: "e2e-seed",
    label: "Fork seed self-test",
    names: [/^fork-seed self-test$/],
  },
  {
    id: "e2e-celo",
    label: "Connected Celo swap",
    names: [/^Connected swap \(anvil fork\)$/],
    failureAttribution: "external",
    skippedBy: "e2e-plan",
    plannerDecision: "e2eApp",
  },
  {
    id: "e2e-governance",
    label: "Connected governance",
    names: [/^Connected governance \(anvil fork\)$/],
    failureAttribution: "external",
    skippedBy: "e2e-plan",
    plannerDecision: "e2eGovernance",
  },
  {
    id: "e2e-monad",
    label: "Connected Monad swap",
    names: [/^Connected swap \(Monad anvil fork\)$/],
    failureAttribution: "external",
    skippedBy: "e2e-plan",
    plannerDecision: "e2eMonad",
  },
  {
    id: "visual-plan",
    label: "Visual regression planner",
    names: [/^Visual Regression Plan$/],
  },
  {
    id: "visual-ui",
    label: "UI visual regression",
    names: [/^Visual Regression \(ui\.mento\.org\)$/],
    failureAttribution: "external",
    skippedBy: "visual-plan",
    plannerDecision: "visualUi",
  },
  {
    id: "visual-app",
    label: "App visual regression",
    names: [/^Visual Regression \(app\.mento\.org\)$/],
    failureAttribution: "external",
    skippedBy: "visual-plan",
    plannerDecision: "visualApp",
  },
  {
    id: "claude-review",
    label: "Claude review",
    names: [/^claude-review$/i],
    failureAttribution: "external",
  },
  {
    id: "vercel-preview",
    label: "Vercel preview",
    names: [/^Vercel Preview$/],
    failureAttribution: "external",
  },
];

const GITHUB_ACTIONS_APP_ID = 15_368;
const CHECK_SOURCE_POLICY = Object.freeze({
  "action-pins": {
    events: ["pull_request_target"],
    workflowPaths: [".github/workflows/action-pins.yml"],
  },
  "action-pins-source": {
    events: ["pull_request"],
    workflowPaths: [".github/workflows/action-pins-source.yml"],
  },
  "claude-review": {
    events: ["workflow_run"],
    workflowPaths: [".github/workflows/dependabot-claude-review.yml"],
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
  "post-merge-verification": {
    events: ["workflow_run"],
    workflowPaths: [".github/workflows/vercel-main-deployment.yml"],
  },
  "vercel-preview": {
    events: ["pull_request_target"],
    kind: "status",
    workflowPaths: [".github/workflows/vercel-preview-intake.yml"],
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

const POST_MERGE_CHECK_DEFINITION = Object.freeze({
  id: "post-merge-verification",
  label: "Dependabot post-merge verification",
  names: [new RegExp(`^${POST_MERGE_CHECK_NAME}$`)],
});

const RECEIPT_SOURCE_POLICY = Object.freeze({
  [PROCESSOR_CHECK_NAME]: {
    events: ["repository_dispatch", "schedule", "workflow_run"],
    workflowPaths: [".github/workflows/dependabot-process.yml"],
  },
  [REFRESH_CHECK_NAME]: {
    events: ["repository_dispatch", "schedule", "workflow_run"],
    workflowPaths: [".github/workflows/dependabot-process.yml"],
  },
  [REPAIR_CHECK_NAME]: {
    events: ["repository_dispatch"],
    workflowPaths: [".github/workflows/dependabot-prepare-repair.yml"],
  },
  [ALL_CLEAR_CHECK_NAME]: {
    events: ["repository_dispatch", "schedule", "workflow_run"],
    workflowPaths: [".github/workflows/dependabot-process.yml"],
  },
});

function checkNameRequiresWorkflowSource(name, kind) {
  if (typeof name !== "string") return false;
  if (
    kind === "check" &&
    (Object.hasOwn(RECEIPT_SOURCE_POLICY, name) ||
      name === POST_MERGE_CHECK_NAME)
  ) {
    return true;
  }
  return CHECK_POLICY_DEFINITIONS.some(
    (definition) =>
      (CHECK_SOURCE_POLICY[definition.id]?.kind ?? "check") === kind &&
      definition.names.some((pattern) => pattern.test(name)),
  );
}

export const DEPENDABOT_PROCESSOR_HELP = `Usage:
  dependabot-processor.mjs evaluate --live --repo owner/name --pr-numbers all|1,2 [--mode observe|assist|prepare]
  dependabot-processor.mjs process --live --repo owner/name --pr-numbers all|1,2 [--mode observe|assist|prepare] [--phase request|mutate|finalize] [--publish-checks]
  dependabot-processor.mjs evaluate --input path|- [--repo owner/name] [--pr-numbers all|1,2] [--mode observe|assist|prepare]
  dependabot-processor.mjs process --input path|- [--repo owner/name] [--pr-numbers all|1,2] [--mode observe|assist|prepare] [--phase finalize]

Intake-triggered live runs may pass --expected-head-sha <40-hex-sha> with exactly one PR.
Only exact lowercase observe, assist, and prepare modes are accepted; merge and every other value fail safe to observe.
Prepare phases are separate capabilities: request may publish only a requested Refresh receipt, mutate may only consume that trusted receipt and request an exact-head branch update, and finalize rejects the repair token and cannot update a branch. Pure process mode never mutates GitHub.`;

export const DEPENDABOT_CHECK_POLICY = Object.freeze(
  CHECK_POLICY_DEFINITIONS.map((definition) =>
    Object.freeze({
      id: definition.id,
      label: definition.label,
      failureAttribution: definition.failureAttribution ?? "deterministic",
      names: Object.freeze(definition.names.map((pattern) => pattern.source)),
      skippedBy: definition.skippedBy ?? null,
      workflowPaths: Object.freeze([
        ...(CHECK_SOURCE_POLICY[definition.id]?.workflowPaths ?? []),
      ]),
    }),
  ),
);

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

class PullRequestSnapshotChangedError extends Error {}

function snapshotInvariant(condition, message) {
  if (!condition) throw new PullRequestSnapshotChangedError(message);
}

function exactSha(value, label = "Commit SHA") {
  invariant(
    typeof value === "string" && SHA_PATTERN.test(value),
    `${label} must be an immutable lowercase 40-character SHA`,
  );
  return value;
}

function repositoryName(value) {
  invariant(
    typeof value === "string" && REPOSITORY_PATTERN.test(value),
    "Repository must use the owner/name form",
  );
  return value;
}

function pullRequestNumber(value) {
  const text = String(value ?? "");
  invariant(/^[1-9][0-9]{0,9}$/.test(text), "PR number must be positive");
  return Number(text);
}

function normalizeLogin(value) {
  const normalized = typeof value === "string" ? value.toLowerCase() : "";
  if (normalized === "app/dependabot" || normalized === "dependabot") {
    return DEPENDABOT_LOGIN;
  }
  return normalized;
}

function normalizeFeedbackLogin(value) {
  return normalizeLogin(value).replace(/\[bot\]$/, "");
}

function feedbackBodyDigest(value) {
  return createHash("sha256")
    .update(typeof value === "string" ? value : "")
    .digest("hex");
}

function canonicalDigest(value) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function exactObjectKeys(value, expectedKeys) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    stableJson(Object.keys(value).sort()) ===
      stableJson([...expectedKeys].sort())
  );
}

function canonicalCheckJson(check) {
  const outputText = check?.outputText ?? check?.output?.text ?? null;
  if (
    typeof outputText !== "string" ||
    outputText.length === 0 ||
    outputText.length > RECEIPT_OUTPUT_LIMIT
  ) {
    return null;
  }
  try {
    const parsed = JSON.parse(outputText);
    return stableJson(parsed) === outputText ? parsed : null;
  } catch {
    return null;
  }
}

function processorPacketJson(check) {
  const outputText = check?.outputText ?? check?.output?.text ?? null;
  if (
    typeof outputText !== "string" ||
    outputText.length === 0 ||
    outputText.length > RECEIPT_OUTPUT_LIMIT
  ) {
    return null;
  }
  try {
    const packet = JSON.parse(outputText);
    const canonical = canonicalJson(packet) === outputText;
    if (!canonical && stableJson(packet) !== outputText) {
      return null;
    }
    return { canonical, outputText, packet };
  } catch {
    return null;
  }
}

function validPrepareActor(receipt) {
  return (
    typeof receipt?.prepareAppSlug === "string" &&
    /^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/.test(receipt.prepareAppSlug) &&
    Number.isSafeInteger(receipt?.prepareBotId) &&
    receipt.prepareBotId > 0 &&
    typeof receipt?.prepareBotLogin === "string" &&
    normalizeLogin(receipt.prepareBotLogin) === `${receipt.prepareAppSlug}[bot]`
  );
}

function trustedWorkflowCheckPublisher(check, repository) {
  const normalized = normalizeCheck(check);
  const policy = RECEIPT_SOURCE_POLICY[normalized.name];
  if (
    !policy ||
    normalized.kind !== "check" ||
    normalized.appId !== GITHUB_ACTIONS_APP_ID ||
    normalized.sourceRepository !== repository ||
    !policy.workflowPaths.includes(normalized.workflowPath) ||
    !policy.events.includes(normalized.workflowEvent) ||
    normalized.runHeadBranch !== "main" ||
    !SHA_PATTERN.test(normalized.runHeadSha ?? "") ||
    !Number.isSafeInteger(normalized.runId) ||
    normalized.runId < 1 ||
    !Number.isSafeInteger(normalized.runAttempt) ||
    normalized.runAttempt < 1 ||
    !new Set([
      `https://github.com/${repository}/actions/runs/${normalized.runId}`,
      `https://github.com/${repository}/runs/${normalized.id}`,
    ]).has(normalized.detailsUrl)
  ) {
    return null;
  }
  return normalized;
}

function trustedReceiptPublisher(check, repository) {
  const normalized = trustedWorkflowCheckPublisher(check, repository);
  if (
    !normalized ||
    normalized.runStatus !== "completed" ||
    normalized.runConclusion !== "success"
  ) {
    return null;
  }
  return normalized;
}

function parseReceiptCheck({
  check,
  conclusion = "success",
  externalPattern,
  name,
  repository,
  schema,
}) {
  const normalized = trustedReceiptPublisher(check, repository);
  if (
    !normalized ||
    normalized.name !== name ||
    normalized.status !== "completed" ||
    normalized.conclusion !== conclusion
  ) {
    return null;
  }
  const external = externalPattern.exec(String(normalized.externalId ?? ""));
  const receipt = canonicalCheckJson(normalized);
  if (
    !external ||
    !receipt ||
    receipt.schema !== schema ||
    canonicalDigest(receipt) !== external[4] ||
    receipt.workflowRunId !== Number(external.at(-2)) ||
    receipt.workflowRunAttempt !== Number(external.at(-1)) ||
    receipt.workflowRunId !== normalized.runId ||
    receipt.workflowRunAttempt !== normalized.runAttempt ||
    !SHA_PATTERN.test(receipt.workflowSha ?? "") ||
    receipt.workflowSha !== normalized.runHeadSha
  ) {
    return null;
  }
  return { check: normalized, external, receipt };
}

function feedbackActor({ association, login, type } = {}) {
  return {
    association: String(association ?? "").toUpperCase(),
    login: normalizeFeedbackLogin(login),
    type: String(type ?? ""),
  };
}

function trustedHuman(actor) {
  return (
    actor.type === "User" &&
    actor.login.length > 0 &&
    TRUSTED_HUMAN_ASSOCIATIONS.has(actor.association)
  );
}

function malformedFeedbackActor(actor) {
  return (
    actor.login.length === 0 ||
    !["Bot", "User"].includes(actor.type) ||
    (actor.type === "Bot" && actor.association !== "NONE")
  );
}

function directMaintainerReply(body, headSha) {
  const fixed = /^Fixed in ([0-9a-f]{7,40}) — .+/s.exec(body);
  if (fixed) return headSha.startsWith(fixed[1]);
  return /^Won't fix: .+/s.test(body);
}

function processorRemediationReply(body, headSha, threadId) {
  const match = new RegExp(
    `^Fixed in ([0-9a-f]{7,40}) — Addressed by authenticated Dependabot preparation\\.\\n\\n<!-- dependabot-remediation:v1 pr=([1-9][0-9]{0,9}) head=([0-9a-f]{40}) thread=([0-9a-f]{64}) packet=([0-9a-f]{64}) -->$`,
  ).exec(String(body ?? ""));
  if (
    match === null ||
    !headSha.startsWith(match[1]) ||
    match[3] !== headSha ||
    match[4] !== feedbackBodyDigest(String(threadId))
  ) {
    return null;
  }
  return {
    headSha: match[3],
    packetDigest: match[5],
    pullRequestNumber: Number(match[2]),
    threadDigest: match[4],
  };
}

function boundedFeedbackBlocker(blocker) {
  return {
    bodyDigest: blocker.bodyDigest,
    id: String(blocker.id).slice(0, 100),
    reason: blocker.reason,
    surface: blocker.surface,
  };
}

const CURSOR_FIX_LINKS_PATTERN = new RegExp(
  [
    '^<div><a href="https://cursor\\.com/open\\?link=[A-Za-z0-9_-]+" target="_blank" rel="noopener noreferrer">',
    '<picture><source media="\\(prefers-color-scheme: dark\\)" srcset="https://cursor\\.com/assets/images/fix-in-cursor-dark\\.png">',
    '<source media="\\(prefers-color-scheme: light\\)" srcset="https://cursor\\.com/assets/images/fix-in-cursor-light\\.png">',
    '<img alt="Fix in Cursor" width="115" height="28" src="https://cursor\\.com/assets/images/fix-in-cursor-dark\\.png"></picture></a>',
    '&nbsp;<a href="https://cursor\\.com/agents\\?link=[A-Za-z0-9_-]+" target="_blank" rel="noopener noreferrer">',
    '<picture><source media="\\(prefers-color-scheme: dark\\)" srcset="https://cursor\\.com/assets/images/fix-in-web-dark\\.png">',
    '<source media="\\(prefers-color-scheme: light\\)" srcset="https://cursor\\.com/assets/images/fix-in-web-light\\.png">',
    '<img alt="Fix in Web" width="99" height="28" src="https://cursor\\.com/assets/images/fix-in-web-dark\\.png"></picture></a></div>\\n\\n\\n([\\s\\S]*)$',
  ].join(""),
);

function exactCursorBugbotSuffix(suffix, reviewCommitSha) {
  const locations =
    /^<!-- BUGBOT_BUG_ID: [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12} -->\n\n<!-- LOCATIONS START\npackage\.json#L[0-9]+(?:-L[0-9]+)?\npnpm-lock\.yaml#L[0-9]+(?:-L[0-9]+)?\nLOCATIONS END -->\n([\s\S]*)$/.exec(
      suffix,
    );
  if (locations === null) return false;
  const additionalLocation =
    /^<details>\n<summary>Additional Locations \(1\)<\/summary>\n\n- \[`pnpm-lock\.yaml#L[0-9]+(?:-L[0-9]+)?`\]\(https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/blob\/([0-9a-f]{40})\/pnpm-lock\.yaml#L[0-9]+(?:-L[0-9]+)?\)\n\n<\/details>\n\n([\s\S]*)$/.exec(
      locations[1],
    );
  if (
    additionalLocation === null ||
    additionalLocation[1] !== reviewCommitSha
  ) {
    return false;
  }
  const fixLinks = CURSOR_FIX_LINKS_PATTERN.exec(additionalLocation[2]);
  if (fixLinks === null) return false;
  const footer =
    /^<sup>Reviewed by \[Cursor Bugbot\]\(https:\/\/cursor\.com\/bugbot\) for commit ([0-9a-f]{40})\. Configure \[here\]\(https:\/\/www\.cursor\.com\/dashboard\/bugbot\)\.<\/sup>\n*$/.exec(
      fixLinks[1],
    );
  return footer !== null && footer[1] === reviewCommitSha;
}

function vercelCliRuntimeSyncFinding(body, reviewCommitSha) {
  const match =
    /^### Incomplete Vercel CLI runtime sync\n\n\*\*High Severity\*\*\n\n<!-- DESCRIPTION START -->\nRoot `vercel` is now `([^`]+)`, but `scripts\/vercel-cli-runtime` still pins `([^`]+)` and `contract\.json` still records `vercelVersion` `([^`]+)`\. `assertVercelCliRuntimeContract` requires those to match, so `check-versions` fails and protected deploy workflows keep the old CLI\.\n<!-- DESCRIPTION END -->\n\n([\s\S]*)$/.exec(
      String(body ?? ""),
    );
  if (
    match === null ||
    match[2] !== match[3] ||
    stableSemverParts(match[1]) === null ||
    stableSemverParts(match[2]) === null ||
    !SHA_PATTERN.test(reviewCommitSha ?? "") ||
    !exactCursorBugbotSuffix(match[4], reviewCommitSha)
  ) {
    return null;
  }
  return {
    fromVersion: match[2],
    kind: VERCEL_CLI_RUNTIME_KIND,
    targetVersion: match[1],
  };
}

function boundedActionableThread({ root, thread, trustedBotEnvelope }) {
  const actor = feedbackActor(root?.actor);
  const source =
    actor.login === "chatgpt-codex-connector"
      ? "codex"
      : actor.login === "cursor"
        ? "cursor"
        : actor.login === "claude"
          ? "claude"
          : "check";
  const path =
    typeof thread?.path === "string" && thread.path.length <= 300
      ? thread.path
      : null;
  const protectedRuntimeFinding =
    source === "cursor" && path === "package.json"
      ? vercelCliRuntimeSyncFinding(root?.body, root?.reviewCommitSha)
      : null;
  return {
    bodyDigest: feedbackBodyDigest(String(root?.body ?? "")),
    line:
      Number.isSafeInteger(thread?.line) && thread.line > 0
        ? thread.line
        : null,
    path,
    ...(protectedRuntimeFinding === null ? {} : { protectedRuntimeFinding }),
    reviewCommitSha: SHA_PATTERN.test(root?.reviewCommitSha ?? "")
      ? root.reviewCommitSha
      : null,
    reviewId:
      Number.isSafeInteger(root?.reviewId) && root.reviewId > 0
        ? root.reviewId
        : null,
    resolved: thread?.resolved === true,
    rootCommentId:
      Number.isSafeInteger(root?.id) && root.id > 0 ? root.id : null,
    source,
    threadId: String(thread?.id ?? "").slice(0, 200),
    trustedBotEnvelope,
  };
}

function trustedDependabotCommit(commit) {
  const author = normalizeLogin(
    commit?.authorLogin ?? commit?.author?.login ?? commit?.author,
  );
  const committer = normalizeLogin(
    commit?.committerLogin ?? commit?.committer?.login ?? commit?.committer,
  );
  return (
    author === DEPENDABOT_LOGIN &&
    (committer === DEPENDABOT_LOGIN || committer === "web-flow") &&
    (commit?.verified === true ||
      commit?.commit?.verification?.verified === true)
  );
}

function commitParentShas(commit) {
  return (Array.isArray(commit?.parents) ? commit.parents : [])
    .map((parent) => (typeof parent === "string" ? parent : parent?.sha))
    .filter((sha) => SHA_PATTERN.test(sha ?? ""));
}

function normalizedCommitActor(commit, role) {
  return {
    id: Number(commit?.[`${role}Id`] ?? commit?.[role]?.id ?? 0),
    login: normalizeLogin(
      commit?.[`${role}Login`] ?? commit?.[role]?.login ?? commit?.[role],
    ),
    type: String(commit?.[`${role}Type`] ?? commit?.[role]?.type ?? ""),
  };
}

function normalizedCommitEvidence(commit) {
  return {
    authorId: normalizedCommitActor(commit, "author").id || null,
    authorLogin: normalizedCommitActor(commit, "author").login,
    authorType: normalizedCommitActor(commit, "author").type,
    committerId: normalizedCommitActor(commit, "committer").id || null,
    committerLogin: normalizedCommitActor(commit, "committer").login,
    committerType: normalizedCommitActor(commit, "committer").type,
    message: commit?.message ?? commit?.commit?.message ?? null,
    parents: commitParentShas(commit),
    sha: commit?.sha ?? null,
    verified:
      commit?.verified === true ||
      commit?.commit?.verification?.verified === true,
    verificationReason:
      commit?.verificationReason ??
      commit?.commit?.verification?.reason ??
      null,
  };
}

function commitMatchesNativeDependabot(commit) {
  const normalized = normalizedCommitEvidence(commit);
  const exactAuthor =
    normalized.authorId === DEPENDABOT_USER_ID &&
    normalized.authorLogin === DEPENDABOT_LOGIN &&
    normalized.authorType === "Bot";
  const exactDependabotCommitter =
    normalized.committerId === DEPENDABOT_USER_ID &&
    normalized.committerLogin === DEPENDABOT_LOGIN &&
    normalized.committerType === "Bot";
  const exactGitHubSystemCommitter =
    normalized.committerId === GITHUB_WEB_FLOW_USER_ID &&
    normalized.committerLogin === "web-flow" &&
    normalized.committerType === "User";
  return (
    SHA_PATTERN.test(normalized.sha ?? "") &&
    exactAuthor &&
    (exactDependabotCommitter || exactGitHubSystemCommitter) &&
    normalized.verified === true &&
    normalized.verificationReason === "valid" &&
    normalized.parents.length === 1
  );
}

function commitActorMatchesPrepareBot(commit, receipt, role) {
  const actor = normalizedCommitActor(commit, role);
  return (
    actor.id === receipt.prepareBotId &&
    actor.login === receipt.prepareBotLogin &&
    actor.type === "Bot"
  );
}

function commitMatchesPrepareBot(commit, receipt) {
  const committer = normalizedCommitActor(commit, "committer");
  const exactPrepareCommitter = commitActorMatchesPrepareBot(
    commit,
    receipt,
    "committer",
  );
  const exactGitHubSystemCommitter =
    committer.id === GITHUB_WEB_FLOW_USER_ID &&
    committer.login === "web-flow" &&
    committer.type === "User";
  return (
    commitActorMatchesPrepareBot(commit, receipt, "author") &&
    (exactPrepareCommitter || exactGitHubSystemCommitter)
  );
}

function commitHasValidVerification(commit) {
  return (
    (commit?.verified === true ||
      commit?.commit?.verification?.verified === true) &&
    (commit?.verificationReason ?? commit?.commit?.verification?.reason) ===
      "valid"
  );
}

function commitMatchesAuthenticatedRefresh(commit, receipt) {
  return (
    commitMatchesPrepareBot(commit, receipt) &&
    commitHasValidVerification(commit)
  );
}

function normalizeLabels(labels) {
  if (!Array.isArray(labels)) return [];
  return labels
    .map((label) => (typeof label === "string" ? label : (label?.name ?? "")))
    .filter(Boolean)
    .map((label) => label.toLowerCase())
    .sort();
}

export function normalizeProcessorMode(value) {
  return typeof value === "string" && PROCESSOR_MODES.has(value)
    ? value
    : "observe";
}

export function normalizeProcessorPhase(value) {
  if (value === undefined || value === null || value === "") return "finalize";
  invariant(
    typeof value === "string" && PROCESSOR_PHASES.has(value),
    "Processor phase must be exactly request, mutate, or finalize",
  );
  return value;
}

function normalizeWorkflowContext(value = {}) {
  const workflowRunId = Number(
    value.workflowRunId ?? value.runId ?? process.env.GITHUB_RUN_ID,
  );
  const workflowRunAttempt = Number(
    value.workflowRunAttempt ??
      value.runAttempt ??
      process.env.GITHUB_RUN_ATTEMPT,
  );
  const workflowSha =
    value.workflowSha ?? value.sha ?? process.env.GITHUB_SHA ?? null;
  invariant(
    Number.isSafeInteger(workflowRunId) && workflowRunId > 0,
    "Workflow run ID must be a positive safe integer",
  );
  invariant(
    Number.isSafeInteger(workflowRunAttempt) && workflowRunAttempt > 0,
    "Workflow run attempt must be a positive safe integer",
  );
  exactSha(workflowSha, "Workflow definition SHA");
  return { workflowRunAttempt, workflowRunId, workflowSha };
}

function severityRank(updateType) {
  return { patch: 1, minor: 2, major: 3 }[updateType] ?? 4;
}

function normalizeUpdateType(value) {
  const normalized = String(value ?? "").toLowerCase();
  if (normalized.includes("patch")) return "patch";
  if (normalized.includes("minor")) return "minor";
  if (normalized.includes("major")) return "major";
  return "unknown";
}

function semverUpdateType(from, to) {
  const parse = (value) => {
    const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(
      String(value).trim(),
    );
    return match ? match.slice(1).map(Number) : null;
  };
  const before = parse(from);
  const after = parse(to);
  if (!before || !after) return "unknown";
  if (after[0] !== before[0]) return "major";
  if (after[1] !== before[1]) return "minor";
  return "patch";
}

function stableSemverParts(value) {
  const match = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.exec(
    String(value ?? ""),
  );
  return match ? match.slice(1).map(Number) : null;
}

function compareSemverParts(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function validVercelCliRuntimeOperation(operation) {
  if (
    !exactObjectKeys(operation, [
      "dependency",
      "fromVersion",
      "inputPaths",
      "kind",
      "pnpmVersion",
      "requiredPaths",
      "schema",
      "sourceSeedHeadSha",
      "targetVersion",
      "updateType",
    ]) ||
    operation.schema !== PROTECTED_RUNTIME_OPERATION_SCHEMA ||
    operation.kind !== VERCEL_CLI_RUNTIME_KIND ||
    operation.dependency !== "vercel" ||
    operation.pnpmVersion !== VERCEL_CLI_RUNTIME_PNPM_VERSION ||
    !SHA_PATTERN.test(operation.sourceSeedHeadSha ?? "") ||
    stableJson(operation.requiredPaths) !==
      stableJson(VERCEL_CLI_RUNTIME_REQUIRED_PATHS) ||
    stableJson(operation.inputPaths) !==
      stableJson(VERCEL_CLI_RUNTIME_INPUT_PATHS)
  ) {
    return false;
  }
  const from = stableSemverParts(operation.fromVersion);
  const target = stableSemverParts(operation.targetVersion);
  return (
    from !== null &&
    target !== null &&
    from[0] === target[0] &&
    compareSemverParts(target, from) > 0 &&
    new Set(["patch", "minor"]).has(operation.updateType) &&
    semverUpdateType(operation.fromVersion, operation.targetVersion) ===
      operation.updateType
  );
}

function vercelCliRuntimeOperationFromMetadata(metadata = {}) {
  const dependencies = Array.isArray(metadata.dependencies)
    ? metadata.dependencies
    : [];
  const vercelRows = dependencies.filter(
    (dependency) => dependency?.name === "vercel",
  );
  if (vercelRows.length === 0) return null;
  const sourceSeedHeadSha = metadata.immutableEvidence?.seedCommitSha;
  if (
    metadata.packageEcosystem !== "npm" ||
    metadata.immutableEvidence?.dependencyMetadataValid !== true ||
    metadata.groupedUpdateIntegrity?.valid !== true ||
    !VERCEL_CLI_RUNTIME_GROUPS.has(metadata.dependencyGroup) ||
    vercelRows.length !== 1 ||
    !SHA_PATTERN.test(sourceSeedHeadSha ?? "")
  ) {
    return { eligible: false, reason: "invalid-vercel-cli-runtime-update" };
  }
  const [{ from, to, updateType }] = vercelRows;
  const operation = {
    dependency: "vercel",
    fromVersion: from,
    inputPaths: [...VERCEL_CLI_RUNTIME_INPUT_PATHS],
    kind: VERCEL_CLI_RUNTIME_KIND,
    pnpmVersion: VERCEL_CLI_RUNTIME_PNPM_VERSION,
    requiredPaths: [...VERCEL_CLI_RUNTIME_REQUIRED_PATHS],
    schema: PROTECTED_RUNTIME_OPERATION_SCHEMA,
    sourceSeedHeadSha,
    targetVersion: to,
    updateType,
  };
  return validVercelCliRuntimeOperation(operation)
    ? { eligible: true, operation }
    : { eligible: false, reason: "invalid-vercel-cli-runtime-update" };
}

function protectedRuntimeStateMatches(protectedRuntime, operation) {
  return (
    protectedRuntime !== null &&
    typeof protectedRuntime === "object" &&
    protectedRuntime.contractSchema === VERCEL_CLI_RUNTIME_CONTRACT_SCHEMA &&
    protectedRuntime.contractVersion === operation.targetVersion &&
    protectedRuntime.rootVersion === operation.targetVersion &&
    protectedRuntime.runtimeVersion === operation.targetVersion &&
    protectedRuntime.pnpmVersion === operation.pnpmVersion
  );
}

function validProtectedRuntimeSnapshot(protectedRuntime) {
  return (
    protectedRuntime !== null &&
    typeof protectedRuntime === "object" &&
    protectedRuntime.contractSchema === VERCEL_CLI_RUNTIME_CONTRACT_SCHEMA &&
    stableSemverParts(protectedRuntime.contractVersion) !== null &&
    stableSemverParts(protectedRuntime.rootVersion) !== null &&
    stableSemverParts(protectedRuntime.runtimeVersion) !== null &&
    protectedRuntime.pnpmVersion === VERCEL_CLI_RUNTIME_PNPM_VERSION
  );
}

function evaluateProtectedRuntimeOperation({
  metadata,
  protectedRuntime,
  repairAttempts,
}) {
  const candidate = vercelCliRuntimeOperationFromMetadata(metadata);
  if (candidate === null || candidate.eligible !== true) return candidate;
  if (!validProtectedRuntimeSnapshot(protectedRuntime)) {
    return {
      eligible: false,
      operation: candidate.operation,
      reason: "invalid-vercel-cli-runtime-snapshot",
    };
  }
  const matchingProof = (repairAttempts?.protectedRuntimeOperations ?? []).find(
    ({ operation }) =>
      validVercelCliRuntimeOperation(operation) &&
      stableJson(operation) === stableJson(candidate.operation),
  );
  const stateMatches = protectedRuntimeStateMatches(
    protectedRuntime,
    candidate.operation,
  );
  return {
    ...candidate,
    proof: matchingProof ?? null,
    satisfied: matchingProof !== undefined && stateMatches,
    stateMatches,
  };
}

function dependencyRowsFromBody(body) {
  const rows = [];
  const pattern = /^\| \[([^\]]+)\]\([^\n)]+\) \| `([^`]+)` \| `([^`]+)` \|$/gm;
  for (const match of String(body ?? "").matchAll(pattern)) {
    rows.push({
      name: match[1].replaceAll("@\u200b", "@"),
      from: match[2],
      to: match[3],
      updateType: semverUpdateType(match[2], match[3]),
    });
  }
  if (rows.length === 0) {
    const singleUpdatePattern =
      /^Updates `([^`]+)` from ([^\s]+) to ([^\s]+)$/gm;
    for (const match of String(body ?? "").matchAll(singleUpdatePattern)) {
      rows.push({
        name: match[1].replaceAll("@\u200b", "@"),
        from: match[2],
        to: match[3],
        updateType: semverUpdateType(match[2], match[3]),
      });
    }
  }
  if (rows.length === 0) {
    const directBumpPattern =
      /^Bumps \[([^\]]+)\]\([^\n]+\) from (\S+) to (\S+)\.$/gm;
    for (const match of String(body ?? "").matchAll(directBumpPattern)) {
      rows.push({
        name: match[1].replaceAll("@\u200b", "@"),
        from: match[2],
        to: match[3],
        updateType: semverUpdateType(match[2], match[3]),
      });
    }
  }
  return rows;
}

export function parseDependabotMetadata({
  body = "",
  files = [],
  headRef = "",
} = {}) {
  const normalizedFiles = files.map((file) =>
    typeof file === "string" ? file : file?.filename,
  );
  let packageEcosystem = "unknown";
  if (headRef.startsWith("dependabot/github_actions/")) {
    packageEcosystem = "github-actions";
  } else if (headRef.startsWith("dependabot/npm_and_yarn/")) {
    packageEcosystem = "npm";
  } else if (
    normalizedFiles.length > 0 &&
    normalizedFiles.every((file) =>
      /^\.github\/(?:workflows\/[^/]+\.ya?ml|actions\/)/.test(file ?? ""),
    )
  ) {
    packageEcosystem = "github-actions";
  } else if (
    normalizedFiles.some((file) =>
      /(?:^|\/)(?:package\.json|pnpm-lock\.yaml)$/.test(file ?? ""),
    )
  ) {
    packageEcosystem = "npm";
  }

  const dependencies = dependencyRowsFromBody(body);
  const normalizedBody = String(body ?? "");
  const declaredGroup =
    /^Bumps the ([A-Za-z0-9_.-]+) group with ([1-9][0-9]*) updates?\b/m.exec(
      normalizedBody,
    );
  const dependencyGroup =
    declaredGroup?.[1] ??
    /^Bumps the ([A-Za-z0-9_.-]+) group\b/m.exec(normalizedBody)?.[1] ??
    null;
  const declaredUpdateCount = declaredGroup ? Number(declaredGroup[2]) : null;
  const uniqueDependencyNames = [
    ...new Set(dependencies.map(({ name }) => name)),
  ].sort();
  const duplicateDependencyRows =
    uniqueDependencyNames.length !== dependencies.length;
  const groupedUpdateIntegrity = {
    declaredUpdateCount,
    duplicateDependencyRows,
    parsedUpdateCount: dependencies.length,
    valid:
      dependencyGroup === null
        ? dependencies.length > 0 && !duplicateDependencyRows
        : Number.isSafeInteger(declaredUpdateCount) &&
          declaredUpdateCount > 0 &&
          declaredUpdateCount === dependencies.length &&
          !duplicateDependencyRows,
  };
  const updateType = dependencies.reduce(
    (highest, dependency) =>
      severityRank(dependency.updateType) > severityRank(highest)
        ? dependency.updateType
        : highest,
    dependencies.length > 0 ? "patch" : "unknown",
  );

  return {
    dependencies,
    dependencyGroup,
    dependencyNames: uniqueDependencyNames,
    groupedUpdateIntegrity,
    packageEcosystem,
    updateType,
  };
}

export function deriveImmutableDependabotMetadata({
  commits = [],
  files = [],
  headRef = "",
  headSha = null,
} = {}) {
  const immutableCommit = commits[0] ?? null;
  const currentCommit = commits.at(-1) ?? null;
  const metadata = parseDependabotMetadata({
    body: immutableCommit?.commit?.message ?? "",
    files,
    headRef,
  });
  const exactRoutineGroup =
    /^dependabot\/github_actions\/github-actions-routine(?:-[a-z0-9._-]+)?$/.test(
      headRef,
    );
  const expectedActionFiles =
    files.length > 0 &&
    files.every((file) => {
      const filename = typeof file === "string" ? file : file?.filename;
      const status = typeof file === "string" ? "modified" : file?.status;
      const expectedPath =
        /^\.github\/workflows\/[^/]+\.ya?ml$/.test(filename ?? "") ||
        /^\.github\/actions\/[^/]+\/action\.ya?ml$/.test(filename ?? "");
      return expectedPath && status !== "removed" && status !== "renamed";
    });
  const seedCommitTrusted = trustedDependabotCommit(immutableCommit);
  const currentHeadMatches =
    currentCommit !== null &&
    SHA_PATTERN.test(headSha ?? "") &&
    currentCommit.sha === headSha;
  const dependencyMetadataValid =
    immutableCommit !== null &&
    currentHeadMatches &&
    seedCommitTrusted &&
    metadata.dependencyNames.length > 0 &&
    metadata.groupedUpdateIntegrity?.valid === true &&
    metadata.updateType !== "unknown" &&
    ["github-actions", "npm"].includes(metadata.packageEcosystem);
  metadata.immutableEvidence = {
    commitCount: commits.length,
    currentHeadMatches,
    dependencyMetadataValid,
    exactRoutineGroup,
    expectedActionFiles,
    repairCommitCount: Math.max(0, commits.length - 1),
    seedCommitSha: immutableCommit?.sha ?? null,
    seedCommitTrusted,
    source: "dependabot-commit-message",
    valid:
      dependencyMetadataValid &&
      exactRoutineGroup &&
      expectedActionFiles &&
      metadata.dependencyGroup === "github-actions-routine" &&
      metadata.updateType !== "major",
  };
  metadata.maintainerChanges = commits.some(
    (commit) => !trustedDependabotCommit(commit),
  );
  metadata.repairChanges = commits
    .slice(1)
    .some((commit) => !trustedDependabotCommit(commit));
  return metadata;
}

export function derivePlannerDecisions(files = []) {
  const decisions = {
    e2eApp: false,
    e2eGovernance: false,
    e2eMonad: false,
    visualApp: false,
    visualUi: false,
  };
  for (const entry of files) {
    const path = typeof entry === "string" ? entry : entry?.filename;
    if (!path) continue;
    const globalInputs =
      path === ".npmrc" ||
      path === "package.json" ||
      path === "pnpm-lock.yaml" ||
      path === "pnpm-workspace.yaml" ||
      path === "turbo.json" ||
      path === "scripts/security-headers.mjs" ||
      path.startsWith(".github/actions/pnpm-install/") ||
      path.startsWith("patches/");
    if (globalInputs || path === ".github/workflows/e2e.yml") {
      decisions.e2eApp = true;
      decisions.e2eGovernance = true;
      decisions.e2eMonad = true;
    }
    if (globalInputs || path === ".github/workflows/visual.yml") {
      decisions.visualApp = true;
      decisions.visualUi = true;
    }
    if (
      path === "scripts/fork-seed.mjs" ||
      path === "scripts/fork-seed.test.mjs"
    ) {
      decisions.e2eApp = true;
      decisions.e2eGovernance = true;
    }
    if (
      path === "scripts/fork-seed-monad.mjs" ||
      path === "scripts/fork-seed-monad.test.mjs"
    ) {
      decisions.e2eMonad = true;
    }
    if (path.startsWith("apps/app.mento.org/")) {
      decisions.e2eApp = true;
      decisions.e2eMonad = true;
      decisions.visualApp = true;
    }
    if (path.startsWith("apps/governance.mento.org/")) {
      decisions.e2eGovernance = true;
    }
    if (path.startsWith("apps/ui.mento.org/")) decisions.visualUi = true;
    if (path.startsWith("packages/web3/")) {
      decisions.e2eApp = true;
      decisions.e2eGovernance = true;
      decisions.e2eMonad = true;
      decisions.visualApp = true;
    }
    if (path.startsWith("packages/ui/")) {
      decisions.e2eApp = true;
      decisions.e2eGovernance = true;
      decisions.e2eMonad = true;
      decisions.visualApp = true;
      decisions.visualUi = true;
    }
  }
  return decisions;
}

export function classifyDependabotRisk(metadata = {}) {
  const packageEcosystem = String(
    metadata.packageEcosystem ?? metadata.packageManager ?? "unknown",
  ).toLowerCase();
  const updateType = normalizeUpdateType(
    metadata.updateType ?? metadata.update_type,
  );
  const dependencyNames = [
    ...(metadata.dependencyNames ?? metadata.dependencyNamesList ?? []),
    ...(metadata.dependencies ?? []).map((dependency) =>
      typeof dependency === "string" ? dependency : dependency?.name,
    ),
  ]
    .filter(Boolean)
    .filter((name, index, names) => names.indexOf(name) === index)
    .sort();
  const sensitiveDependencies = dependencyNames.filter((name) =>
    SENSITIVE_ACTION_PATTERN.test(name),
  );
  const preparationSensitiveDependencies = dependencyNames.filter(
    (name) =>
      SENSITIVE_ACTION_PATTERN.test(name) ||
      PREPARATION_SENSITIVE_ACTION_PATTERN.test(name),
  );
  const verifiedDependencyEvidence =
    metadata.immutableEvidence?.dependencyMetadataValid === true ||
    (metadata.immutableEvidence?.valid === true &&
      dependencyNames.length > 0 &&
      updateType !== "unknown");

  if (packageEcosystem === "npm" || packageEcosystem === "npm_and_yarn") {
    return {
      autoApprovable: false,
      dependencyNames,
      packageEcosystem: "npm",
      preparable: verifiedDependencyEvidence,
      reason: verifiedDependencyEvidence
        ? "verified-npm-update-requires-human-merge"
        : "npm-metadata-is-not-immutable-and-verified",
      sensitiveDependencies: [],
      tier: verifiedDependencyEvidence ? "human-merge-npm" : "manual-npm",
      updateType,
    };
  }
  if (
    packageEcosystem !== "github-actions" &&
    packageEcosystem !== "github_actions"
  ) {
    return {
      autoApprovable: false,
      dependencyNames,
      packageEcosystem,
      preparable: false,
      reason: "unknown-package-ecosystem",
      sensitiveDependencies,
      tier: "manual-unknown",
      updateType,
    };
  }
  if (metadata.immutableEvidence?.valid !== true) {
    return {
      autoApprovable: false,
      dependencyNames,
      packageEcosystem: "github-actions",
      preparable: false,
      reason: "action-metadata-is-not-immutable-and-verified",
      sensitiveDependencies,
      tier: "manual-unverified-action-metadata",
      updateType,
    };
  }
  if (dependencyNames.length === 0) {
    return {
      autoApprovable: false,
      dependencyNames,
      packageEcosystem: "github-actions",
      preparable: false,
      reason: "missing-dependency-metadata",
      sensitiveDependencies,
      tier: "manual-unknown-action",
      updateType,
    };
  }
  if (preparationSensitiveDependencies.length > 0) {
    return {
      autoApprovable: false,
      dependencyNames,
      packageEcosystem: "github-actions",
      preparable: false,
      reason: "sensitive-auth-deployment-or-workflow-policy-action",
      sensitiveDependencies,
      tier: "manual-sensitive-action",
      updateType,
    };
  }
  if (updateType !== "patch" && updateType !== "minor") {
    return {
      autoApprovable: false,
      dependencyNames,
      packageEcosystem: "github-actions",
      preparable: true,
      reason: "only-action-patch-and-minor-updates-are-automatic",
      sensitiveDependencies,
      tier: "manual-action-major-or-unknown",
      updateType,
    };
  }
  return {
    autoApprovable: true,
    dependencyNames,
    packageEcosystem: "github-actions",
    preparable: true,
    reason: "safe-action-patch-or-minor",
    sensitiveDependencies,
    tier: "safe-actions-patch-minor",
    updateType,
  };
}

function normalizePullRequest(pullRequest) {
  const rawAuthor = pullRequest?.author ?? pullRequest?.user;
  const authorLogin = normalizeLogin(
    pullRequest?.author?.login ??
      pullRequest?.user?.login ??
      pullRequest?.author,
  );
  const headRepository =
    pullRequest?.head?.repo?.fullName ??
    pullRequest?.head?.repo?.full_name ??
    pullRequest?.headRepository?.nameWithOwner ??
    pullRequest?.headRepository ??
    pullRequest?.headRepo;
  const baseRepository =
    pullRequest?.base?.repo?.fullName ??
    pullRequest?.base?.repo?.full_name ??
    pullRequest?.baseRepository?.nameWithOwner ??
    pullRequest?.baseRepository ??
    pullRequest?.baseRepo;
  return {
    authorId: Number(rawAuthor?.id ?? 0),
    authorLogin,
    authorType: String(rawAuthor?.type ?? ""),
    baseRef: pullRequest?.base?.ref ?? pullRequest?.baseRef ?? "",
    baseRepository,
    baseSha: pullRequest?.base?.sha ?? pullRequest?.baseSha ?? null,
    body: pullRequest?.body ?? "",
    files: pullRequest?.files ?? [],
    headRef: pullRequest?.head?.ref ?? pullRequest?.headRef ?? "",
    headRepository,
    headSha: pullRequest?.head?.sha ?? pullRequest?.headSha ?? null,
    isCrossRepository:
      pullRequest?.isCrossRepository ??
      (headRepository !== undefined && baseRepository !== undefined
        ? headRepository !== baseRepository
        : null),
    isDraft: Boolean(pullRequest?.draft ?? pullRequest?.isDraft),
    labels: normalizeLabels(pullRequest?.labels),
    mergeCommitSha:
      pullRequest?.merge_commit_sha ?? pullRequest?.mergeCommitSha ?? null,
    mergeable:
      typeof pullRequest?.mergeable === "boolean"
        ? pullRequest.mergeable
        : null,
    mergeStateStatus:
      String(
        pullRequest?.mergeStateStatus ?? pullRequest?.merge_state ?? "",
      ).toUpperCase() || null,
    merged: Boolean(pullRequest?.merged ?? pullRequest?.mergedAt),
    nodeId: pullRequest?.node_id ?? pullRequest?.nodeId ?? pullRequest?.id,
    number: pullRequestNumber(pullRequest?.number),
    state: String(pullRequest?.state ?? "").toLowerCase(),
    title: pullRequest?.title ?? "",
    reviewDecision:
      String(pullRequest?.reviewDecision ?? "").toUpperCase() || null,
    updatedAt: pullRequest?.updated_at ?? pullRequest?.updatedAt ?? null,
  };
}

function evaluateCurrentBaseGate({ ancestry = {}, baselineSha, pullRequest }) {
  const reasons = [];
  const behindBy = Number(ancestry.behindBy);
  const aheadBy = Number(ancestry.aheadBy);
  const status = String(ancestry.status ?? "").toLowerCase();
  const currentBaseSha = ancestry.currentBaseSha ?? null;
  const baseCommitSha = ancestry.baseCommitSha ?? null;
  const mergeBaseSha = ancestry.mergeBaseSha ?? null;
  const comparedHeadSha = ancestry.headSha ?? null;
  const validCounts =
    Number.isSafeInteger(behindBy) &&
    behindBy >= 0 &&
    Number.isSafeInteger(aheadBy) &&
    aheadBy >= 0;
  if (!validCounts) reasons.push("invalid-base-compare-counts");
  if (!SHA_PATTERN.test(currentBaseSha ?? "")) {
    reasons.push("invalid-current-base-sha");
  }
  if (
    currentBaseSha !== baselineSha ||
    currentBaseSha !== pullRequest.baseSha
  ) {
    reasons.push("current-base-sha-mismatch");
  }
  if (baseCommitSha !== currentBaseSha) {
    reasons.push("compare-base-sha-mismatch");
  }
  if (comparedHeadSha !== pullRequest.headSha) {
    reasons.push("compare-head-sha-mismatch");
  }
  if (mergeBaseSha !== currentBaseSha) {
    reasons.push("current-base-is-not-head-ancestor");
  }
  if (behindBy !== 0) reasons.push("head-is-behind-current-base");
  if (!new Set(["ahead", "identical"]).has(status)) {
    reasons.push("unexpected-base-compare-status");
  }
  if (ancestry.currentBaseIsAncestor !== true) {
    reasons.push("current-base-ancestry-not-proven");
  }
  return {
    aheadBy: validCounts ? aheadBy : null,
    baseCommitSha,
    behindBy: validCounts ? behindBy : null,
    current: reasons.length === 0,
    currentBaseIsAncestor: ancestry.currentBaseIsAncestor === true,
    currentBaseSha,
    headSha: comparedHeadSha,
    mergeBaseSha,
    reasons: [...new Set(reasons)],
    status: status || null,
  };
}

export function validateDependabotPullRequestIdentity({
  commits = [],
  expectedHeadSha,
  metadata = {},
  pullRequest,
  repairAttempts = null,
  repository,
}) {
  const normalized = normalizePullRequest(pullRequest);
  const reasons = [];
  const commitList = Array.isArray(commits) ? commits : [];
  repositoryName(repository);

  if (normalized.authorLogin !== DEPENDABOT_LOGIN) {
    reasons.push("author-is-not-dependabot");
  }
  if (!normalized.headRef.startsWith("dependabot/")) {
    reasons.push("head-ref-is-not-dependabot");
  }
  if (normalized.headRepository !== repository) {
    reasons.push("head-repository-mismatch");
  }
  if (normalized.baseRepository !== repository) {
    reasons.push("base-repository-mismatch");
  }
  if (normalized.baseRef !== "main") reasons.push("unexpected-base-ref");
  if (normalized.isCrossRepository === true) {
    reasons.push("cross-repository-pull-request");
  }
  if (normalized.state !== "open") reasons.push("pull-request-is-not-open");
  if (normalized.isDraft) reasons.push("pull-request-is-draft");

  if (!SHA_PATTERN.test(normalized.headSha ?? "")) {
    reasons.push("invalid-head-sha");
  }
  if (!SHA_PATTERN.test(expectedHeadSha ?? "")) {
    reasons.push("invalid-expected-head-sha");
  } else if (normalized.headSha !== expectedHeadSha) {
    reasons.push("head-sha-changed");
  }

  const seedCommit = commitList[0] ?? null;
  const currentCommit = commitList.at(-1) ?? null;
  const seedAuthorLogin = normalizeLogin(
    seedCommit?.authorLogin ?? seedCommit?.author?.login ?? seedCommit?.author,
  );
  const successorCommitCount = Math.max(0, commitList.length - 1);
  const repairCommitCount = Number.isSafeInteger(
    repairAttempts?.repairCommitCount,
  )
    ? repairAttempts.repairCommitCount
    : successorCommitCount;
  const hasNonDependabotRepairCommit = commitList.slice(1).some((commit) => {
    const login = normalizeLogin(
      commit?.authorLogin ?? commit?.author?.login ?? commit?.author,
    );
    return login !== DEPENDABOT_LOGIN;
  });
  const computedMaintainerChanges =
    seedAuthorLogin !== DEPENDABOT_LOGIN || hasNonDependabotRepairCommit;
  const repairLineageValid =
    successorCommitCount === 0 || repairAttempts?.repairLineageValid === true;
  const prepareLineageValid =
    successorCommitCount === 0 || repairAttempts?.prepareLineageValid === true;
  if (seedAuthorLogin !== DEPENDABOT_LOGIN) {
    reasons.push("maintainer-changes-present");
  }
  if (
    (metadata.maintainerChanges !== undefined &&
      (typeof metadata.maintainerChanges !== "boolean" ||
        metadata.maintainerChanges !== computedMaintainerChanges)) ||
    (metadata.repairChanges !== undefined &&
      (typeof metadata.repairChanges !== "boolean" ||
        metadata.repairChanges !== hasNonDependabotRepairCommit))
  ) {
    reasons.push("maintainer-change-evidence-mismatch");
  }
  if (!repairLineageValid) reasons.push("untrusted-repair-lineage");

  if (
    metadata.packageEcosystem === "github-actions" ||
    metadata.packageEcosystem === "github_actions"
  ) {
    if (commitList.length === 0) {
      reasons.push("unexpected-dependabot-commit-count");
    } else if (currentCommit?.sha !== normalized.headSha) {
      reasons.push("immutable-commit-head-mismatch");
    }
  }

  return {
    automaticAuthority:
      reasons.length === 0 && successorCommitCount === 0 && seedCommit !== null,
    automaticSeedHeadSha: seedCommit?.sha ?? null,
    headSha: normalized.headSha,
    number: normalized.number,
    prepareAuthority:
      reasons.length === 0 && prepareLineageValid && seedCommit !== null,
    prepareLineageValid,
    refreshCommitCount: repairAttempts?.refreshCommitCount ?? 0,
    repairCommitCount,
    repairLineageValid,
    reasons,
    valid: reasons.length === 0,
  };
}

function normalizeCheck(check, assumedHeadSha) {
  const name = check?.name ?? check?.context ?? "";
  const rawStatus = String(check?.status ?? "").toLowerCase();
  const rawConclusion = String(
    check?.conclusion ?? check?.state ?? "",
  ).toLowerCase();
  const status =
    rawStatus === "completed" ||
    (rawStatus === "" && !PENDING_STATUSES.has(rawConclusion))
      ? "completed"
      : rawStatus || rawConclusion;
  const conclusion =
    rawConclusion === "success" || rawConclusion === "failure"
      ? rawConclusion
      : rawConclusion || (status === "completed" ? "unknown" : null);
  const timestamp =
    check?.completedAt ??
    check?.completed_at ??
    check?.startedAt ??
    check?.started_at ??
    check?.updatedAt ??
    check?.updated_at ??
    check?.createdAt ??
    check?.created_at ??
    "";
  const runHeadSha = Object.hasOwn(check ?? {}, "runHeadSha")
    ? (check.runHeadSha ?? null)
    : Object.hasOwn(check?.source ?? {}, "runHeadSha")
      ? (check.source.runHeadSha ?? null)
      : null;
  return {
    appId: Number(check?.appId ?? check?.app?.id ?? check?.source?.appId ?? 0),
    conclusion,
    description: check?.description ?? null,
    detailsUrl:
      check?.detailsUrl ?? check?.details_url ?? check?.target_url ?? null,
    externalId:
      check?.externalId ??
      check?.external_id ??
      check?.source?.externalId ??
      null,
    headSha: check?.headSha ?? check?.head_sha ?? assumedHeadSha ?? null,
    id: Number(check?.id ?? 0),
    name,
    outputSummary:
      check?.outputSummary ?? check?.output?.summary ?? check?.summary ?? null,
    outputText: check?.outputText ?? check?.output?.text ?? check?.text ?? null,
    creatorLogin: normalizeLogin(
      check?.creatorLogin ??
        check?.creator?.login ??
        check?.source?.creatorLogin,
    ),
    kind: check?.kind ?? check?.source?.kind ?? "check",
    runAttempt: Number(
      check?.runAttempt ?? check?.run_attempt ?? check?.source?.runAttempt ?? 0,
    ),
    runHeadSha,
    runHeadBranch: check?.runHeadBranch ?? check?.source?.runHeadBranch ?? null,
    runDisplayTitle:
      check?.runDisplayTitle ?? check?.source?.runDisplayTitle ?? null,
    runConclusion: check?.runConclusion ?? check?.source?.runConclusion ?? null,
    runId: Number(check?.runId ?? check?.source?.runId ?? 0),
    runStatus: check?.runStatus ?? check?.source?.runStatus ?? null,
    sourceRepository:
      check?.sourceRepository ?? check?.source?.repository ?? null,
    status,
    timestamp,
    workflowEvent: check?.workflowEvent ?? check?.source?.workflowEvent ?? null,
    workflowPath: String(
      check?.workflowPath ?? check?.source?.workflowPath ?? "",
    ).replace(/@.*$/, ""),
  };
}

export function parseDependabotProcessorReceipt(check, repository) {
  const normalized = trustedReceiptPublisher(check, repository);
  if (
    !normalized ||
    normalized.name !== PROCESSOR_CHECK_NAME ||
    normalized.status !== "completed"
  ) {
    return null;
  }
  const external = PROCESSOR_REPAIR_RECEIPT_PATTERN.exec(
    String(normalized.externalId ?? ""),
  );
  if (!external) return null;
  const packetIssued = external[5] === "true";
  const packetJson = packetIssued ? processorPacketJson(normalized) : null;
  const packet = packetJson?.packet ?? null;
  const packetDigest = external[6];
  let packetValid = !packetIssued;
  if (
    packetIssued &&
    packetJson &&
    rawDigest(packetJson.outputText) === packetDigest
  ) {
    try {
      validateProcessorRepairPacket(packet);
      packetValid = true;
    } catch {
      packetValid = false;
    }
  }
  if (
    normalized.runId !== Number(external[7]) ||
    normalized.runAttempt !== Number(external[8]) ||
    (packetIssued
      ? normalized.conclusion !== "failure"
      : !new Set(["failure", "neutral"]).has(normalized.conclusion)) ||
    !packetValid ||
    (packetIssued &&
      (!packet ||
        !new Set([
          DEPENDABOT_REPAIR_PACKET_SCHEMA,
          DEPENDABOT_PROTECTED_RUNTIME_REPAIR_PACKET_SCHEMA,
        ]).has(packet.schema) ||
        packet.workflowRunId !== normalized.runId ||
        packet.workflowRunAttempt !== normalized.runAttempt ||
        packet.workflowSha !== normalized.runHeadSha ||
        packet.repository !== repository ||
        packet.pullRequestNumber !== Number(external[1]) ||
        packet.headSha !== external[2] ||
        packet.mode !== external[3] ||
        packet.attemptNumber !== Number(external[4]))) ||
    (!packetIssued && (packet !== null || packetDigest !== "none"))
  ) {
    return null;
  }
  return {
    attempt: Number(external[4]),
    check: normalized,
    headSha: external[2],
    mode: external[3],
    packet,
    packetCanonical: packetJson?.canonical === true,
    packetDigest: packetIssued ? packetDigest : null,
    packetIssued,
    pullRequestNumber: Number(external[1]),
  };
}

function parseDependabotProcessorStatus(check, repository) {
  const normalized = trustedWorkflowCheckPublisher(check, repository);
  const external = PROCESSOR_REPAIR_RECEIPT_PATTERN.exec(
    String(normalized?.externalId ?? ""),
  );
  const outputText = normalized?.outputText;
  const attempt = Number(external?.[4]);
  if (
    !normalized ||
    !Number.isSafeInteger(normalized.id) ||
    normalized.id < 1 ||
    normalized.name !== PROCESSOR_CHECK_NAME ||
    normalized.status !== "completed" ||
    !new Set(["failure", "neutral"]).has(normalized.conclusion) ||
    !new Set(["in_progress", "completed"]).has(normalized.runStatus) ||
    (normalized.runStatus === "in_progress" &&
      normalized.runConclusion !== null) ||
    (normalized.runStatus === "completed" &&
      typeof normalized.runConclusion !== "string") ||
    !external ||
    external[5] !== "false" ||
    external[6] !== "none" ||
    normalized.headSha !== external[2] ||
    normalized.runId !== Number(external[7]) ||
    normalized.runAttempt !== Number(external[8]) ||
    !Number.isSafeInteger(attempt) ||
    attempt < 1 ||
    (outputText !== null && outputText !== "")
  ) {
    return null;
  }
  return {
    attempt,
    check: normalized,
    headSha: external[2],
    mode: external[3],
    pullRequestNumber: Number(external[1]),
  };
}

export function parseDependabotRefreshReceipt(check, repository) {
  const parsed = parseReceiptCheck({
    check,
    externalPattern: REFRESH_RECEIPT_PATTERN,
    name: REFRESH_CHECK_NAME,
    repository,
    schema: DEPENDABOT_REFRESH_SCHEMA,
  });
  if (!parsed) return null;
  const { check: normalized, external, receipt } = parsed;
  const commonKeys = [
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
  const completed = receipt.state === "completed";
  const keys = completed
    ? [...commonKeys, "requestCheckId", "requestDigest"]
    : commonKeys;
  if (
    !exactObjectKeys(receipt, keys) ||
    receipt.repository !== repository ||
    receipt.pullRequestNumber !== Number(external[1]) ||
    receipt.state !== external[3] ||
    receipt.state !== (completed ? "completed" : "requested") ||
    !String(receipt.headRef ?? "").startsWith("dependabot/") ||
    !SHA_PATTERN.test(receipt.parentHeadSha ?? "") ||
    !SHA_PATTERN.test(receipt.previousBaseSha ?? "") ||
    !SHA_PATTERN.test(receipt.baseSha ?? "") ||
    receipt.previousBaseSha === receipt.baseSha ||
    !validPrepareActor(receipt) ||
    (completed
      ? !SHA_PATTERN.test(receipt.headSha ?? "") ||
        receipt.headSha !== external[2] ||
        receipt.headSha !== normalized.headSha ||
        !Number.isSafeInteger(receipt.requestCheckId) ||
        receipt.requestCheckId < 1 ||
        !/^[0-9a-f]{64}$/.test(receipt.requestDigest ?? "")
      : receipt.headSha !== null ||
        receipt.parentHeadSha !== external[2] ||
        receipt.parentHeadSha !== normalized.headSha)
  ) {
    return null;
  }
  return { check: normalized, receipt };
}

export function parseDependabotRepairReceipt(check, repository) {
  const parsed = parseReceiptCheck({
    check,
    externalPattern: REPAIR_RECEIPT_PATTERN,
    name: REPAIR_CHECK_NAME,
    repository,
    schema: DEPENDABOT_REPAIR_SCHEMA,
  });
  if (!parsed) return null;
  const { check: normalized, external, receipt } = parsed;
  if (
    !exactObjectKeys(receipt, [
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
    ]) ||
    receipt.state !== "completed" ||
    receipt.repository !== repository ||
    receipt.pullRequestNumber !== Number(external[1]) ||
    receipt.headSha !== external[2] ||
    receipt.headSha !== normalized.headSha ||
    receipt.attempt !== Number(external[3]) ||
    !String(receipt.headRef ?? "").startsWith("dependabot/") ||
    !SHA_PATTERN.test(receipt.parentHeadSha ?? "") ||
    !SHA_PATTERN.test(receipt.headSha ?? "") ||
    !SHA_PATTERN.test(receipt.baseSha ?? "") ||
    !/^[0-9a-f]{64}$/.test(receipt.packetDigest ?? "") ||
    !Number.isSafeInteger(receipt.processorCheckId) ||
    receipt.processorCheckId < 1 ||
    !Number.isSafeInteger(receipt.attempt) ||
    receipt.attempt < 1 ||
    receipt.attempt > 2 ||
    !validPrepareActor(receipt)
  ) {
    return null;
  }
  return { check: normalized, receipt };
}

export function parseDependabotAllClearReceipt(check, repository) {
  const parsed = parseReceiptCheck({
    check,
    externalPattern: ALL_CLEAR_RECEIPT_PATTERN,
    name: ALL_CLEAR_CHECK_NAME,
    repository,
    schema: DEPENDABOT_ALL_CLEAR_SCHEMA,
  });
  if (!parsed) return null;
  const { check: normalized, external, receipt } = parsed;
  if (
    !exactObjectKeys(receipt, [
      "autoMergeEnabled",
      "baseSha",
      "checksDigest",
      "feedbackDigest",
      "headRef",
      "headSha",
      "humanAction",
      "mergeAuthorizedByAutomation",
      "mergeStateStatus",
      "mergeable",
      "preparation",
      "processorApprovalId",
      "pullRequestNumber",
      "repository",
      "reviewDecision",
      "riskTier",
      "schema",
      "updateType",
      "workflowRunAttempt",
      "workflowRunId",
      "workflowSha",
    ]) ||
    receipt.repository !== repository ||
    receipt.pullRequestNumber !== Number(external[1]) ||
    receipt.headSha !== external[2] ||
    receipt.headSha !== normalized.headSha ||
    receipt.baseSha !== external[3] ||
    !String(receipt.headRef ?? "").startsWith("dependabot/") ||
    !SHA_PATTERN.test(receipt.headSha ?? "") ||
    !SHA_PATTERN.test(receipt.baseSha ?? "") ||
    !/^[0-9a-f]{64}$/.test(receipt.feedbackDigest ?? "") ||
    !/^[0-9a-f]{64}$/.test(receipt.checksDigest ?? "") ||
    !Number.isSafeInteger(receipt.processorApprovalId) ||
    receipt.processorApprovalId < 1 ||
    receipt.mergeable !== true ||
    receipt.mergeStateStatus !== "CLEAN" ||
    receipt.reviewDecision !== "APPROVED" ||
    receipt.autoMergeEnabled !== false ||
    receipt.humanAction !== "merge" ||
    receipt.mergeAuthorizedByAutomation !== false ||
    typeof receipt.riskTier !== "string" ||
    receipt.riskTier.length === 0 ||
    typeof receipt.updateType !== "string" ||
    receipt.updateType.length === 0 ||
    !validPreparationSummary(receipt.preparation)
  ) {
    return null;
  }
  return { check: normalized, receipt };
}

function validPreparationSummary(preparation) {
  if (
    preparation === null ||
    typeof preparation !== "object" ||
    !Array.isArray(preparation.operationDigests) ||
    preparation.operationDigests.some(
      (digest) => !/^[0-9a-f]{64}$/.test(digest),
    ) ||
    new Set(preparation.operationDigests).size !==
      preparation.operationDigests.length ||
    !Number.isSafeInteger(preparation.refreshCount) ||
    preparation.refreshCount < 0 ||
    !Number.isSafeInteger(preparation.repairCount) ||
    preparation.repairCount < 0 ||
    !SHA_PATTERN.test(preparation.seedHeadSha ?? "")
  ) {
    return false;
  }
  if (preparation.kind === "native") {
    return (
      exactObjectKeys(preparation, [
        "kind",
        "operationDigests",
        "refreshCount",
        "repairCount",
        "seedHeadSha",
      ]) &&
      preparation.operationDigests.length === 0 &&
      preparation.refreshCount === 0 &&
      preparation.repairCount === 0
    );
  }
  const hasProtectedRuntimeOperations = Object.hasOwn(
    preparation,
    "protectedRuntimeOperations",
  );
  const protectedRuntimeOperations = hasProtectedRuntimeOperations
    ? preparation.protectedRuntimeOperations
    : [];
  if (
    !Array.isArray(protectedRuntimeOperations) ||
    (hasProtectedRuntimeOperations &&
      protectedRuntimeOperations.length === 0) ||
    protectedRuntimeOperations.some(
      (record) =>
        !exactObjectKeys(record, [
          "operation",
          "operationDigest",
          "packetDigest",
        ]) ||
        !validVercelCliRuntimeOperation(record.operation) ||
        record.operation.sourceSeedHeadSha !== preparation.seedHeadSha ||
        !/^[0-9a-f]{64}$/.test(record.operationDigest ?? "") ||
        !/^[0-9a-f]{64}$/.test(record.packetDigest ?? "") ||
        !preparation.operationDigests.includes(record.operationDigest),
    ) ||
    new Set(
      protectedRuntimeOperations.map(({ operationDigest }) => operationDigest),
    ).size !== protectedRuntimeOperations.length ||
    new Set(protectedRuntimeOperations.map(({ packetDigest }) => packetDigest))
      .size !== protectedRuntimeOperations.length
  ) {
    return false;
  }
  return (
    preparation.kind === "prepared" &&
    exactObjectKeys(preparation, [
      "kind",
      "operationDigests",
      "prepareAppSlug",
      "prepareBotId",
      "prepareBotLogin",
      ...(hasProtectedRuntimeOperations ? ["protectedRuntimeOperations"] : []),
      "refreshCount",
      "repairCount",
      "seedHeadSha",
    ]) &&
    preparation.operationDigests.length ===
      preparation.refreshCount + preparation.repairCount &&
    validPrepareActor(preparation)
  );
}

function compareChecks(left, right) {
  if (left.kind === "status" && right.kind === "status") {
    const timestampComparison = String(left.timestamp).localeCompare(
      String(right.timestamp),
    );
    if (timestampComparison !== 0) return timestampComparison;
    const idComparison = left.id - right.id;
    if (idComparison !== 0) return idComparison;
  }
  const runComparison = left.runId - right.runId;
  if (runComparison !== 0) return runComparison;
  const attemptComparison = left.runAttempt - right.runAttempt;
  if (attemptComparison !== 0) return attemptComparison;
  const timestampComparison = String(left.timestamp).localeCompare(
    String(right.timestamp),
  );
  return timestampComparison || left.id - right.id;
}

function comparePostMergeChecks(left, right) {
  const leftIdValid = Number.isSafeInteger(left.id) && left.id > 0;
  const rightIdValid = Number.isSafeInteger(right.id) && right.id > 0;
  // Select unorderable exact-name/head evidence so it fails closed instead of
  // letting an older valid publication authorize the merge lane.
  if (leftIdValid !== rightIdValid) return leftIdValid ? -1 : 1;
  const idComparison = left.id - right.id;
  if (idComparison !== 0) return idComparison;
  return String(left.timestamp).localeCompare(String(right.timestamp));
}

function comparePolicyCheckRuns(left, right) {
  const leftIdValid = Number.isSafeInteger(left.id) && left.id > 0;
  const rightIdValid = Number.isSafeInteger(right.id) && right.id > 0;
  if (leftIdValid !== rightIdValid) return leftIdValid ? -1 : 1;
  const idComparison = left.id - right.id;
  if (idComparison !== 0) return idComparison;
  return String(left.timestamp).localeCompare(String(right.timestamp));
}

function trustedCheckSource(
  check,
  headSha,
  definition,
  repository,
  pullRequestNumberValue = null,
) {
  if (!check) return { reason: "missing", trusted: false };
  const policy = CHECK_SOURCE_POLICY[definition.id];
  if (!policy) return { reason: "missing-source-policy", trusted: false };
  if (check.headSha !== headSha) {
    return { reason: "check-head-sha-mismatch", trusted: false };
  }
  if (check.sourceRepository !== repository) {
    return { reason: "unexpected-source-repository", trusted: false };
  }
  if (check.kind !== "status" && check.appId !== GITHUB_ACTIONS_APP_ID) {
    return { reason: "unexpected-check-app", trusted: false };
  }
  if ((policy.kind ?? "check") !== check.kind) {
    return { reason: "unexpected-check-kind", trusted: false };
  }
  if (check.kind === "status" && check.creatorLogin !== "github-actions[bot]") {
    return { reason: "unexpected-status-creator", trusted: false };
  }
  if (!policy.workflowPaths.includes(check.workflowPath)) {
    return { reason: "unexpected-workflow-path", trusted: false };
  }
  if (!policy.events.includes(check.workflowEvent)) {
    return { reason: "unexpected-workflow-event", trusted: false };
  }
  if (definition.id === "vercel-preview") {
    const title = VERCEL_PREVIEW_INTAKE_TITLE_PATTERN.exec(
      String(check.runDisplayTitle ?? ""),
    );
    if (
      check.description !== "Preview disabled for Dependabot PR" ||
      !title ||
      (pullRequestNumberValue !== null &&
        Number(title[1]) !== pullRequestNumberValue) ||
      title[2] !== headSha
    ) {
      return {
        reason: "invalid-vercel-preview-intake-receipt",
        trusted: false,
      };
    }
    if (
      check.detailsUrl !==
      `https://github.com/${repository}/actions/runs/${check.runId}`
    ) {
      return { reason: "vercel-preview-run-url-mismatch", trusted: false };
    }
  } else if (definition.id === "post-merge-verification") {
    const externalReceipt = POST_MERGE_EXTERNAL_ID_PATTERN.exec(
      String(check.externalId ?? ""),
    );
    if (!externalReceipt) {
      return { reason: "invalid-post-merge-receipt", trusted: false };
    }
    const externalRunId = Number(externalReceipt[1]);
    const externalRunAttempt = Number(externalReceipt[2]);
    if (
      !Number.isSafeInteger(externalRunId) ||
      externalRunId < 1 ||
      !Number.isSafeInteger(externalRunAttempt) ||
      externalRunAttempt < 1 ||
      externalRunId !== check.runId ||
      externalRunAttempt !== check.runAttempt
    ) {
      return {
        reason: "post-merge-run-identity-mismatch",
        trusted: false,
      };
    }
    if (check.runHeadBranch !== "main" || check.runHeadSha !== headSha) {
      return { reason: "untrusted-post-merge-source-ref", trusted: false };
    }
    if (check.runStatus !== "completed" || check.runConclusion !== "success") {
      return {
        reason: "post-merge-workflow-not-successful",
        trusted: false,
      };
    }
    if (!Number.isSafeInteger(check.id) || check.id < 1) {
      return { reason: "invalid-post-merge-check-id", trusted: false };
    }
    const allowedDetailsUrls = new Set([
      `https://github.com/${repository}/actions/runs/${check.runId}`,
      `https://github.com/${repository}/runs/${check.id}`,
    ]);
    if (!allowedDetailsUrls.has(check.detailsUrl)) {
      return { reason: "post-merge-run-url-mismatch", trusted: false };
    }
  } else if (definition.id === "claude-review") {
    if (check.name !== "claude-review") {
      return {
        reason: "unexpected-claude-review-check-name",
        trusted: false,
      };
    }
    const displayTitle = String(check.runDisplayTitle ?? "");
    const nativeDisplayReceipt =
      CLAUDE_REVIEW_RECEIPT_PATTERN.exec(displayTitle);
    const preparedDisplayReceipt =
      CLAUDE_PREPARED_REVIEW_RECEIPT_PATTERN.exec(displayTitle);
    const externalReceipt = CLAUDE_REVIEW_EXTERNAL_ID_PATTERN.exec(
      String(check.externalId ?? ""),
    );
    if (
      (!nativeDisplayReceipt && !preparedDisplayReceipt) ||
      !externalReceipt
    ) {
      return { reason: "invalid-claude-review-receipt", trusted: false };
    }
    const displayPullRequestNumber = Number(
      nativeDisplayReceipt?.[2] ?? preparedDisplayReceipt?.[1],
    );
    const displayHeadSha =
      nativeDisplayReceipt?.[3] ?? preparedDisplayReceipt?.[2];
    const externalPullRequestNumber = Number(externalReceipt[1]);
    if (
      (nativeDisplayReceipt && nativeDisplayReceipt[1] !== repository) ||
      displayHeadSha !== headSha ||
      externalReceipt[2] !== headSha ||
      displayPullRequestNumber !== externalPullRequestNumber ||
      (pullRequestNumberValue !== null &&
        displayPullRequestNumber !== pullRequestNumberValue)
    ) {
      return { reason: "claude-review-receipt-mismatch", trusted: false };
    }
    if (
      check.runHeadBranch !== "main" ||
      !SHA_PATTERN.test(check.runHeadSha ?? "") ||
      check.runHeadSha === headSha
    ) {
      return { reason: "untrusted-claude-review-source-ref", trusted: false };
    }
    if (
      Number(externalReceipt[3]) !== check.runId ||
      Number(externalReceipt[4]) !== check.runAttempt
    ) {
      return { reason: "claude-review-run-identity-mismatch", trusted: false };
    }
    if (!Number.isSafeInteger(check.id) || check.id < 1) {
      return { reason: "invalid-claude-review-check-id", trusted: false };
    }
    const allowedDetailsUrls = new Set([
      `https://github.com/${repository}/actions/runs/${check.runId}`,
      `https://github.com/${repository}/runs/${check.id}`,
    ]);
    if (!allowedDetailsUrls.has(check.detailsUrl)) {
      return { reason: "claude-review-run-url-mismatch", trusted: false };
    }
  } else if (check.runHeadSha !== headSha) {
    return { reason: "workflow-run-head-sha-mismatch", trusted: false };
  }
  if (!Number.isInteger(check.runAttempt) || check.runAttempt < 1) {
    return { reason: "invalid-workflow-run-attempt", trusted: false };
  }
  if (!Number.isSafeInteger(check.runId) || check.runId < 1) {
    return { reason: "invalid-workflow-run-id", trusted: false };
  }
  if (
    !["claude-review", "post-merge-verification"].includes(definition.id) &&
    check.detailsUrl &&
    !check.detailsUrl.includes(`/actions/runs/${check.runId}`)
  ) {
    return { reason: "workflow-run-url-mismatch", trusted: false };
  }
  return { reason: "trusted-source", trusted: true };
}

export function selectLatestExactHeadCheck(checks, headSha, definition) {
  exactSha(headSha, "Expected check head SHA");
  const compare =
    definition.id === "post-merge-verification"
      ? comparePostMergeChecks
      : (CHECK_SOURCE_POLICY[definition.id]?.kind ?? "check") === "status"
        ? compareChecks
        : comparePolicyCheckRuns;
  const candidates = checks
    .map((check) => normalizeCheck(check))
    .filter(
      (check) =>
        check.headSha === headSha &&
        definition.names.some((pattern) => pattern.test(check.name)),
    )
    .sort(compare);
  return candidates.at(-1) ?? null;
}

function resultState(check) {
  if (!check) return "missing";
  if (
    check.status !== "completed" ||
    PENDING_STATUSES.has(check.status) ||
    PENDING_STATUSES.has(check.conclusion)
  ) {
    return "pending";
  }
  if (PASSING_CONCLUSIONS.has(check.conclusion)) return "passing";
  if (check.conclusion === "skipped") return "skipped";
  return "failing";
}

function validatedClaudeFindings(
  check,
  { headSha, pullRequestNumber: number, repository },
) {
  if (!check || !Number.isSafeInteger(number) || number < 1) return [];
  const result = canonicalCheckJson(check);
  if (
    !exactObjectKeys(result, [
      "findings",
      "headSha",
      "pullRequestNumber",
      "repository",
      "reviewCompleted",
      "schema",
      "verdict",
    ]) ||
    result.schema !== "dependabot-claude-review-result:v1" ||
    result.repository !== repository ||
    result.pullRequestNumber !== number ||
    result.headSha !== headSha ||
    result.reviewCompleted !== true ||
    result.verdict !== "findings" ||
    !Array.isArray(result.findings) ||
    result.findings.length < 1 ||
    result.findings.length > 20
  ) {
    return [];
  }
  const findings = [];
  for (const finding of result.findings) {
    if (
      !exactObjectKeys(finding, ["line", "path", "summary", "title"]) ||
      typeof finding.title !== "string" ||
      finding.title.length < 1 ||
      finding.title.length > 160 ||
      typeof finding.path !== "string" ||
      finding.path.length < 1 ||
      finding.path.length > 300 ||
      finding.path.startsWith("/") ||
      finding.path.split("/").includes("..") ||
      !Number.isSafeInteger(finding.line) ||
      finding.line < 1 ||
      typeof finding.summary !== "string" ||
      finding.summary.length < 1 ||
      finding.summary.length > 1_000
    ) {
      return [];
    }
    const canonical = {
      line: finding.line,
      path: finding.path,
      summary: finding.summary,
      title: finding.title,
    };
    findings.push({
      ...canonical,
      id: canonicalDigest(canonical).slice(0, 24),
      summaryDigest: feedbackBodyDigest(finding.summary),
    });
  }
  return findings;
}

function evaluateChecksForSha(
  checks,
  headSha,
  plannerDecisions = {},
  repository,
  pullRequestNumberValue = null,
) {
  const results = [];
  const byId = new Map();
  for (const definition of CHECK_POLICY_DEFINITIONS) {
    const check = selectLatestExactHeadCheck(checks, headSha, definition);
    let state = resultState(check);
    let reason = state;
    const source = trustedCheckSource(
      check,
      headSha,
      definition,
      repository,
      pullRequestNumberValue,
    );
    if (check && !source.trusted) {
      state = "failing";
      reason = source.reason;
    }
    if (state === "skipped") {
      const planner = byId.get(definition.skippedBy);
      if (
        definition.skippedBy &&
        planner?.state === "passing" &&
        definition.plannerDecision &&
        plannerDecisions[definition.plannerDecision] === false
      ) {
        state = "passing";
        reason = "planner-backed-skip";
      } else {
        state = "failing";
        reason = "unjustified-skip";
      }
    }
    const findings =
      definition.id === "claude-review" && state === "failing" && source.trusted
        ? validatedClaudeFindings(check, {
            headSha,
            pullRequestNumber: pullRequestNumberValue,
            repository,
          })
        : [];
    const result = {
      check: check
        ? {
            conclusion: check.conclusion,
            detailsUrl: check.detailsUrl,
            headSha: check.headSha,
            id: check.id,
            runAttempt: check.runAttempt,
            runId: check.runId,
            name: check.name,
            status: check.status,
            workflowEvent: check.workflowEvent,
            workflowPath: check.workflowPath,
          }
        : null,
      id: definition.id,
      label: definition.label,
      failureAttribution: definition.failureAttribution ?? "deterministic",
      findings,
      reason,
      source: source.reason,
      skippedBy: definition.skippedBy ?? null,
      state,
    };
    results.push(result);
    byId.set(definition.id, result);
  }
  return results;
}

export function evaluateDependabotChecks({
  baselineChecks = [],
  baselineSha = null,
  checks = [],
  headSha,
  plannerDecisions = {},
  pullRequestNumber: pullRequestNumberValue = null,
  repository,
}) {
  exactSha(headSha, "PR head SHA");
  repositoryName(repository);
  const policy = evaluateChecksForSha(
    checks,
    headSha,
    plannerDecisions,
    repository,
    pullRequestNumberValue,
  );
  const baselinePolicy = baselineSha
    ? evaluateChecksForSha(
        baselineChecks,
        exactSha(baselineSha, "Baseline SHA"),
        plannerDecisions,
        repository,
        null,
      )
    : [];
  const baselineById = new Map(
    baselinePolicy.map((result) => [result.id, result]),
  );
  const failures = [];
  for (const result of policy) {
    if (result.state !== "failing") continue;
    const baselineResult = baselineById.get(result.id);
    failures.push({
      attribution:
        result.id === "claude-review" && result.findings.length > 0
          ? "branch"
          : baselineResult?.state === "failing"
            ? "baseline"
            : baselineResult?.state === "passing"
              ? result.failureAttribution === "external"
                ? "non-deterministic"
                : "branch"
              : "unknown",
      findings: result.findings,
      id: result.id,
      name: result.check?.name ?? null,
      reason: result.reason,
    });
  }
  const missing = policy
    .filter((result) => result.state === "missing")
    .map(({ id }) => id);
  const pending = policy
    .filter((result) => result.state === "pending")
    .map(({ id }) => id);
  const state =
    failures.length > 0
      ? "failing"
      : missing.length > 0 || pending.length > 0
        ? "pending"
        : "passing";
  return {
    baselineSha,
    failures,
    headSha,
    missing,
    pending,
    policy,
    state,
  };
}

function processorApprovalBinding(review) {
  const body = String(review?.body ?? "");
  const match = new RegExp(
    `^Approved by ${DEPENDABOT_PROCESSOR_SCHEMA.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} for exact head ([0-9a-f]{40})\\.$`,
  ).exec(body);
  const commitSha = review?.commitSha;
  return match && SHA_PATTERN.test(commitSha ?? "") && match[1] === commitSha
    ? commitSha
    : null;
}

function reviewEnvelopeMatches({
  actor,
  body,
  inlineRootCount,
  reviewCommitSha,
}) {
  if (
    typeof body !== "string" ||
    body.length === 0 ||
    body.length > REVIEW_ENVELOPE_BODY_LIMIT
  ) {
    return false;
  }
  if (actor.login === "cursor") {
    if (!body.startsWith("<!-- BUGBOT_REVIEW -->")) return false;
    const stated = /found ([0-9]+) potential issues?\./.exec(body);
    return Boolean(stated) && Number(stated[1]) === inlineRootCount;
  }
  if (actor.login === "chatgpt-codex-connector") {
    if (body.startsWith("Codex Review: Didn't find any major issues.")) {
      return inlineRootCount === 0;
    }
    if (body.startsWith(`\n${CODEX_REVIEW_HEADING}\n`)) {
      const reviewedCommit =
        /^\n### 💡 Codex Review\n\nHere are some automated review suggestions for this pull request\.\n\n\*\*Reviewed commit:\*\* `([0-9a-f]{10})`\n/.exec(
          body,
        );
      return (
        inlineRootCount > 0 &&
        reviewedCommit?.[1] === reviewCommitSha.slice(0, 10)
      );
    }
    return /^Codex Review:(?: |\n)/.test(body) && inlineRootCount > 0;
  }
  if (actor.login === "claude") {
    return (
      /^(?:## |### )?(?:Claude )?Code Review\b/.test(body) &&
      inlineRootCount > 0
    );
  }
  return false;
}

export function classifyDependabotFeedback({
  headSha,
  issueComments = [],
  reviews = [],
  threadPagesTruncated = false,
  threads = [],
} = {}) {
  exactSha(headSha, "Feedback head SHA");
  const blockers = [];
  const addBlocker = ({ body = "", id, reason, surface }) => {
    blockers.push(
      boundedFeedbackBlocker({
        bodyDigest: feedbackBodyDigest(body),
        id,
        reason,
        surface,
      }),
    );
  };
  let actionableThreadCount = 0;
  let unresolvedThreads = 0;
  let unrepliedThreads = 0;
  let currentProcessorApprovalCount = 0;
  let historicalProcessorApprovalCount = 0;
  let dismissedProcessorApprovalCount = 0;
  const currentProcessorApprovalIds = [];
  const actionableThreads = [];
  const remediationCandidates = [];

  const reviewsById = new Map();
  for (const review of reviews) {
    const key = String(review?.id ?? "");
    if (!reviewsById.has(key)) reviewsById.set(key, []);
    reviewsById.get(key).push(review);
  }
  const botInlineRootCounts = new Map();
  for (const thread of threads) {
    for (const comment of thread?.comments ?? []) {
      const actor = feedbackActor(comment?.actor);
      if (
        comment?.replyToId == null &&
        actor.type === "Bot" &&
        ACTIONABLE_REVIEW_BOTS.has(actor.login)
      ) {
        const key = String(comment?.reviewId ?? "");
        botInlineRootCounts.set(key, (botInlineRootCounts.get(key) ?? 0) + 1);
      }
    }
  }
  const acceptedReviewEnvelopes = new Set();

  if (threadPagesTruncated) {
    addBlocker({
      id: "review-thread-pagination",
      reason: "feedback-thread-pagination-cap-exceeded",
      surface: "thread",
    });
  }

  for (const review of reviews) {
    const actor = feedbackActor(review?.actor);
    if (malformedFeedbackActor(actor)) {
      addBlocker({
        body: review?.body,
        id: review?.id ?? "unknown-review",
        reason: "malformed-feedback-actor",
        surface: "review",
      });
      continue;
    }
    if (actor.type === "User") {
      if (
        trustedHuman(actor) &&
        review?.commitSha === headSha &&
        String(review?.state ?? "").toUpperCase() === "COMMENTED" &&
        String(review?.body ?? "").trim().length > 0
      ) {
        addBlocker({
          body: review.body,
          id: review.id,
          reason: "maintainer-top-level-review-feedback",
          surface: "review",
        });
      }
      continue;
    }
    const body = String(review?.body ?? "");
    const state = String(review?.state ?? "").toUpperCase();
    if (
      actor.login === "github-actions" &&
      (state === "APPROVED" || state === "DISMISSED")
    ) {
      const approvalCommitSha = processorApprovalBinding(review);
      if (approvalCommitSha) {
        if (state === "DISMISSED") {
          dismissedProcessorApprovalCount += 1;
        } else if (approvalCommitSha === headSha) {
          currentProcessorApprovalCount += 1;
          if (
            Number.isSafeInteger(review.id) &&
            review.id > 0 &&
            currentProcessorApprovalIds.length < FEEDBACK_BLOCKER_LIMIT
          ) {
            currentProcessorApprovalIds.push(review.id);
          }
        } else {
          historicalProcessorApprovalCount += 1;
        }
        continue;
      }
    }
    const reviewId = String(review?.id ?? "");
    const inlineRootCount = botInlineRootCounts.get(reviewId) ?? 0;
    if (
      state === "COMMENTED" &&
      SHA_PATTERN.test(review?.commitSha ?? "") &&
      ACTIONABLE_REVIEW_BOTS.has(actor.login) &&
      reviewEnvelopeMatches({
        actor,
        body,
        inlineRootCount,
        reviewCommitSha: review?.commitSha,
      })
    ) {
      acceptedReviewEnvelopes.add(reviewId);
      continue;
    }
    addBlocker({
      body,
      id: review?.id ?? "unknown-review",
      reason: "unknown-review-bot-feedback",
      surface: "review",
    });
  }

  for (const thread of threads) {
    const threadId = thread?.id ?? "unknown-thread";
    if (thread?.commentsTruncated === true) {
      addBlocker({
        id: threadId,
        reason: "feedback-thread-comments-cap-exceeded",
        surface: "thread",
      });
      continue;
    }
    const comments = Array.isArray(thread?.comments) ? thread.comments : [];
    for (const comment of comments) {
      const actor = feedbackActor(comment?.actor);
      if (malformedFeedbackActor(actor)) {
        addBlocker({
          body: comment?.body,
          id: comment?.id ?? threadId,
          reason: "malformed-feedback-actor",
          surface: "thread-comment",
        });
      } else if (
        actor.type === "Bot" &&
        !ACTIONABLE_REVIEW_BOTS.has(actor.login) &&
        !(
          actor.login === "github-actions" &&
          comment?.replyToId != null &&
          processorRemediationReply(comment?.body, headSha, threadId) !== null
        )
      ) {
        addBlocker({
          body: comment?.body,
          id: comment?.id ?? threadId,
          reason: "unknown-review-bot-feedback",
          surface: "thread-comment",
        });
      }
    }
    const roots = comments.filter((comment) => comment?.replyToId == null);
    if (roots.length !== 1) {
      addBlocker({
        id: threadId,
        reason: "malformed-review-thread",
        surface: "thread",
      });
      continue;
    }
    const root = roots[0];
    const rootActor = feedbackActor(root.actor);
    const actionable =
      trustedHuman(rootActor) ||
      (rootActor.type === "Bot" && ACTIONABLE_REVIEW_BOTS.has(rootActor.login));
    if (!actionable) continue;
    let trustedBotEnvelope = false;
    if (rootActor.type === "Bot") {
      const reviewId = String(root.reviewId ?? "");
      const parentReviews = reviewsById.get(reviewId) ?? [];
      const parent = parentReviews[0];
      const parentActor = feedbackActor(parent?.actor);
      trustedBotEnvelope =
        parentReviews.length === 1 &&
        acceptedReviewEnvelopes.has(reviewId) &&
        parentActor.type === "Bot" &&
        parentActor.login === rootActor.login &&
        parent?.commitSha === root.reviewCommitSha &&
        SHA_PATTERN.test(root.reviewCommitSha ?? "");
      if (!trustedBotEnvelope) {
        addBlocker({
          body: root.body,
          id: threadId,
          reason: "invalid-actionable-review-envelope",
          surface: "thread",
        });
      }
    }
    const unresolved = thread?.resolved !== true;
    if (unresolved) {
      unresolvedThreads += 1;
      addBlocker({
        body: root.body,
        id: threadId,
        reason: "unresolved-review-feedback",
        surface: "thread",
      });
    }
    const reviewHeadBound = SHA_PATTERN.test(root.reviewCommitSha ?? "");
    if (!reviewHeadBound) {
      addBlocker({
        body: root.body,
        id: threadId,
        reason: "missing-review-head-binding",
        surface: "thread",
      });
    }
    const resolvedHistorical =
      thread?.resolved === true &&
      reviewHeadBound &&
      root.reviewCommitSha !== headSha;
    let hasRequiredReply = resolvedHistorical;
    if (reviewHeadBound && !resolvedHistorical) {
      hasRequiredReply = comments.some((reply) => {
        const actor = feedbackActor(reply?.actor);
        const remediation =
          actor.type === "Bot" && actor.login === "github-actions"
            ? processorRemediationReply(reply?.body, headSha, threadId)
            : null;
        if (
          remediation &&
          String(reply?.replyToId ?? "") === String(root.id) &&
          String(reply?.createdAt ?? "") > String(root.createdAt ?? "")
        ) {
          remediationCandidates.push({
            ...remediation,
            rootCommentId: root.id,
            threadId: String(threadId),
          });
        }
        return (
          String(reply?.replyToId ?? "") === String(root.id) &&
          String(reply?.createdAt ?? "") > String(root.createdAt ?? "") &&
          trustedHuman(actor) &&
          directMaintainerReply(String(reply?.body ?? ""), headSha)
        );
      });
      if (!hasRequiredReply) {
        unrepliedThreads += 1;
        addBlocker({
          body: root.body,
          id: threadId,
          reason: "unreplied-review-feedback",
          surface: "thread",
        });
      }
    }
    const trustedBotNeedsAction =
      trustedBotEnvelope && (unresolved || !hasRequiredReply);
    if (!trustedBotEnvelope || trustedBotNeedsAction) {
      actionableThreadCount += 1;
    }
    if (trustedBotNeedsAction) {
      actionableThreads.push(
        boundedActionableThread({ root, thread, trustedBotEnvelope }),
      );
    }
  }

  for (const comment of issueComments) {
    const actor = feedbackActor(comment?.actor);
    if (malformedFeedbackActor(actor)) {
      addBlocker({
        body: comment?.body,
        id: comment?.id ?? "unknown-issue-comment",
        reason: "malformed-feedback-actor",
        surface: "issue-comment",
      });
      continue;
    }
    if (actor.type === "User") {
      if (trustedHuman(actor)) {
        addBlocker({
          body: comment?.body,
          id: comment.id,
          reason: "maintainer-issue-comment",
          surface: "issue-comment",
        });
      }
      continue;
    }
    const body = String(comment?.body ?? "");
    const informational =
      body.length <= REVIEW_ENVELOPE_BODY_LIMIT &&
      ((actor.login === "github-actions" &&
        body.startsWith("<!-- vercel-preview-journal:v2 -->") &&
        body.includes("**No reviewer action is required.**")) ||
        (actor.login === "argos-ci" &&
          body.startsWith(
            "**The latest updates on your projects.** Learn more about [Argos notifications ↗︎](https://argos-ci.com/docs/learn/review-workflow/pull-request-comments)",
          )) ||
        (actor.login === "vercel" && body.startsWith("[vc]: ")) ||
        (actor.login === "chatgpt-codex-connector" &&
          body.startsWith("Codex Review: Didn't find any major issues.")));
    if (!informational) {
      addBlocker({
        body,
        id: comment?.id ?? "unknown-issue-comment",
        reason: "unknown-issue-comment-bot-feedback",
        surface: "issue-comment",
      });
    }
  }

  const reasons = [...new Set(blockers.map(({ reason }) => reason))];
  return {
    actionableThreadCount,
    actionableThreads: actionableThreads.slice(0, FEEDBACK_BLOCKER_LIMIT),
    blockerCount: blockers.length,
    blockers: blockers.slice(0, FEEDBACK_BLOCKER_LIMIT),
    complete: !reasons.some((reason) =>
      [
        "feedback-thread-comments-cap-exceeded",
        "feedback-thread-pagination-cap-exceeded",
        "malformed-feedback-actor",
        "malformed-review-thread",
        "missing-review-head-binding",
        "invalid-actionable-review-envelope",
      ].includes(reason),
    ),
    currentProcessorApprovalCount,
    currentProcessorApprovalIds,
    dismissedProcessorApprovalCount,
    historicalProcessorApprovalCount,
    issueCommentCount: issueComments.length,
    reasons,
    remediationCandidates: remediationCandidates.slice(
      0,
      FEEDBACK_BLOCKER_LIMIT,
    ),
    reviewCount: reviews.length,
    threadCount: threads.length,
    unresolvedThreads,
    unrepliedThreads,
  };
}

function normalizeForcePushEvent(event) {
  const actorId = Number(event?.actorId ?? 0);
  const createdAt = String(event?.createdAt ?? "");
  const eventId = String(event?.eventId ?? "");
  const headRef = String(event?.headRef ?? "");
  return {
    actorId: Number.isSafeInteger(actorId) && actorId > 0 ? actorId : null,
    actorLogin:
      typeof event?.actorLogin === "string"
        ? event.actorLogin.toLowerCase()
        : null,
    actorType: String(event?.actorType ?? "") || null,
    afterSha: SHA_PATTERN.test(event?.afterSha ?? "") ? event.afterSha : null,
    beforeSha: SHA_PATTERN.test(event?.beforeSha ?? "")
      ? event.beforeSha
      : null,
    createdAt:
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(createdAt) &&
      Number.isFinite(Date.parse(createdAt))
        ? createdAt
        : null,
    eventId: eventId.length > 0 && eventId.length <= 200 ? eventId : null,
    headRef: headRef.length > 0 && headRef.length <= 300 ? headRef : null,
  };
}

function evaluateForcePushGeneration({
  feedback,
  generationSeedCommit,
  generationSeedHeadSha,
  generationSeedTrusted,
  pullRequest,
}) {
  const normalizedPullRequest = normalizePullRequest(pullRequest);
  const rawEvents = Array.isArray(feedback.forcePushEvents)
    ? feedback.forcePushEvents.slice(0, DURABLE_EVENT_EVIDENCE_LIMIT)
    : [];
  const events = rawEvents.map(normalizeForcePushEvent);
  const eventCount = Number(feedback.forcePushEventCount);
  const observed =
    feedback.forcePushed === true ||
    (Number.isSafeInteger(eventCount) && eventCount > 0) ||
    events.length > 0;
  if (!observed) {
    return {
      eventDigest: canonicalDigest([]),
      events,
      eventsComplete: feedback.forcePushEventsComplete !== false,
      kind: "none",
      reasons: [],
      veto: false,
    };
  }

  const exactEventCount =
    feedback.forcePushed === true &&
    feedback.forcePushEventsComplete === true &&
    Number.isSafeInteger(eventCount) &&
    eventCount > 0 &&
    eventCount <= DURABLE_EVENT_EVIDENCE_LIMIT &&
    eventCount === events.length;
  const eventIds = new Set();
  let previousEvent = null;
  let exactEvents = exactEventCount;
  const expectedRef = `refs/heads/${normalizedPullRequest.headRef}`;
  for (const event of events) {
    const ordered =
      previousEvent === null ||
      (event.createdAt !== null &&
        previousEvent.createdAt !== null &&
        Date.parse(event.createdAt) > Date.parse(previousEvent.createdAt));
    const continuous =
      previousEvent === null || previousEvent.afterSha === event.beforeSha;
    const exactActor =
      event.actorId === DEPENDABOT_USER_ID &&
      event.actorLogin === "dependabot" &&
      event.actorType === "Bot";
    const exactEvent =
      event.eventId !== null &&
      !eventIds.has(event.eventId) &&
      event.createdAt !== null &&
      event.beforeSha !== null &&
      event.afterSha !== null &&
      event.beforeSha !== event.afterSha &&
      event.headRef === expectedRef &&
      exactActor &&
      ordered &&
      continuous;
    exactEvents &&= exactEvent;
    if (event.eventId !== null) eventIds.add(event.eventId);
    previousEvent = event;
  }
  const chainShas =
    events.length === 0
      ? []
      : [events[0].beforeSha, ...events.map(({ afterSha }) => afterSha)];
  exactEvents &&= new Set(chainShas).size === events.length + 1;

  const requiredCommitShas = new Set(
    events.flatMap(({ afterSha, beforeSha }) => [beforeSha, afterSha]),
  );
  requiredCommitShas.delete(null);
  const commitEvidence = Array.isArray(feedback.forcePushCommits)
    ? feedback.forcePushCommits.map(normalizedCommitEvidence)
    : [];
  const commitsBySha = new Map();
  let exactCommits = commitEvidence.length === requiredCommitShas.size;
  for (const commit of commitEvidence) {
    if (
      commitsBySha.has(commit.sha) ||
      !commitMatchesNativeDependabot(commit)
    ) {
      exactCommits = false;
    }
    commitsBySha.set(commit.sha, commit);
  }
  exactCommits &&= [...requiredCommitShas].every((sha) =>
    commitsBySha.has(sha),
  );

  const exactPullRequestAuthor =
    normalizedPullRequest.authorId === DEPENDABOT_USER_ID &&
    normalizedPullRequest.authorLogin === DEPENDABOT_LOGIN &&
    normalizedPullRequest.authorType === "Bot";
  const exactSeed =
    generationSeedTrusted === true &&
    SHA_PATTERN.test(generationSeedHeadSha ?? "") &&
    generationSeedCommit?.sha === generationSeedHeadSha &&
    commitMatchesNativeDependabot(generationSeedCommit) &&
    events.at(-1)?.afterSha === generationSeedHeadSha &&
    commitsBySha.has(generationSeedHeadSha);
  const native =
    exactEvents && exactCommits && exactPullRequestAuthor && exactSeed;
  const reasons = [];
  if (!exactEventCount) reasons.push("incomplete-force-push-event-census");
  if (!exactEvents) reasons.push("invalid-force-push-event-chain");
  if (!exactCommits) reasons.push("invalid-force-push-commit-census");
  if (!exactPullRequestAuthor) reasons.push("invalid-force-push-pr-author");
  if (!exactSeed) {
    reasons.push("invalid-force-push-generation-seed");
    if (generationSeedTrusted !== true) {
      reasons.push("untrusted-force-push-generation-seed");
    }
    if (generationSeedCommit?.sha !== generationSeedHeadSha) {
      reasons.push("force-push-generation-seed-sha-mismatch");
    }
    if (!commitMatchesNativeDependabot(generationSeedCommit)) {
      reasons.push("invalid-force-push-generation-seed-commit");
    }
    if (events.at(-1)?.afterSha !== generationSeedHeadSha) {
      reasons.push("force-push-generation-head-mismatch");
    }
    if (!commitsBySha.has(generationSeedHeadSha)) {
      reasons.push("force-push-generation-seed-evidence-missing");
    }
  }
  return {
    eventDigest: canonicalDigest(events),
    events,
    eventsComplete: exactEventCount,
    kind: native ? "native" : "veto",
    reasons,
    veto: !native,
  };
}

export function evaluateFeedbackGate({
  feedback = {},
  generationSeedCommit = null,
  generationSeedHeadSha = null,
  generationSeedTrusted = false,
  pullRequest = {},
  repairAttempts = null,
} = {}) {
  const normalizedPullRequest = normalizePullRequest(pullRequest);
  const forcePushGeneration = evaluateForcePushGeneration({
    feedback,
    generationSeedCommit,
    generationSeedHeadSha,
    generationSeedTrusted,
    pullRequest,
  });
  const labels = normalizeLabels([
    ...(pullRequest.labels ?? []),
    ...(feedback.labels ?? []),
  ]);
  const vetoLabels = labels.filter((label) => VETO_LABELS.has(label));
  const unresolvedThreads = Number(feedback.unresolvedThreads ?? 0);
  const rawUnrepliedThreads = Number(feedback.unrepliedThreads ?? 0);
  const currentProcessorApprovalCount = Number(
    feedback.currentProcessorApprovalCount ?? 0,
  );
  const currentProcessorApprovalIds = Array.isArray(
    feedback.currentProcessorApprovalIds,
  )
    ? feedback.currentProcessorApprovalIds.map(Number)
    : [];
  const currentProcessorApprovalInventoryValid =
    Number.isSafeInteger(currentProcessorApprovalCount) &&
    currentProcessorApprovalCount >= 0 &&
    Array.isArray(feedback.currentProcessorApprovalIds ?? []) &&
    currentProcessorApprovalIds.length === currentProcessorApprovalCount &&
    currentProcessorApprovalIds.every(
      (approvalId) => Number.isSafeInteger(approvalId) && approvalId > 0,
    ) &&
    new Set(currentProcessorApprovalIds).size ===
      currentProcessorApprovalIds.length;
  const latestAppliedRepair = repairAttempts?.latestAppliedRepair;
  const packetThreadById = new Map(
    (latestAppliedRepair?.packet?.feedbackThreads ?? []).map((thread) => [
      String(thread.threadId),
      thread,
    ]),
  );
  const trustedRemediationThreads = new Set(
    (Array.isArray(feedback.remediationCandidates)
      ? feedback.remediationCandidates
      : []
    )
      .filter((candidate) => {
        const packetThread = packetThreadById.get(String(candidate?.threadId));
        return (
          latestAppliedRepair?.receipt !== null &&
          latestAppliedRepair?.receipt !== undefined &&
          candidate?.packetDigest === latestAppliedRepair.packetDigest &&
          candidate?.pullRequestNumber === normalizedPullRequest.number &&
          candidate?.headSha === normalizedPullRequest.headSha &&
          packetThread?.commentId === candidate?.rootCommentId &&
          candidate?.threadDigest ===
            feedbackBodyDigest(String(candidate?.threadId))
        );
      })
      .map(({ threadId }) => String(threadId)),
  );
  const unrepliedThreads =
    Number.isInteger(rawUnrepliedThreads) && rawUnrepliedThreads >= 0
      ? Math.max(0, rawUnrepliedThreads - trustedRemediationThreads.size)
      : rawUnrepliedThreads;
  const reviewDecision = String(
    feedback.reviewDecision ?? pullRequest.reviewDecision ?? "",
  ).toUpperCase();
  const forcePushActors = [
    ...new Set(
      (Array.isArray(feedback.forcePushActors)
        ? feedback.forcePushActors
        : []
      ).map((login) =>
        (normalizeLogin(login) || "unknown-actor").slice(0, 100),
      ),
    ),
  ]
    .sort()
    .slice(0, DURABLE_EVENT_EVIDENCE_LIMIT);
  const forcePushCommitIds = [
    ...new Set(
      (Array.isArray(feedback.forcePushCommitIds)
        ? feedback.forcePushCommitIds
        : []
      ).filter((commitId) => SHA_PATTERN.test(commitId ?? "")),
    ),
  ]
    .sort()
    .slice(0, DURABLE_EVENT_EVIDENCE_LIMIT);
  const reasons = (
    Array.isArray(feedback.reasons) ? feedback.reasons : []
  ).filter(
    (reason) => reason !== "unreplied-review-feedback" || unrepliedThreads > 0,
  );
  if (feedback.complete === false) reasons.unshift("feedback-incomplete");
  if (!Number.isInteger(unresolvedThreads) || unresolvedThreads < 0) {
    reasons.push("invalid-unresolved-thread-count");
  } else if (unresolvedThreads > 0) {
    reasons.push("unresolved-review-feedback");
  }
  if (!Number.isInteger(unrepliedThreads) || unrepliedThreads < 0) {
    reasons.push("invalid-unreplied-thread-count");
  } else if (unrepliedThreads > 0) {
    reasons.push("unreplied-review-feedback");
  }
  if (!currentProcessorApprovalInventoryValid) {
    reasons.push("invalid-current-processor-approval-inventory");
  }
  if (reviewDecision === "CHANGES_REQUESTED") {
    reasons.push("changes-requested");
  }
  if (
    feedback.veto === true ||
    (feedback.maintainerVeto === true &&
      feedback.humanClosed !== true &&
      feedback.humanReopened !== true &&
      feedback.forcePushed !== true)
  ) {
    reasons.push("explicit-maintainer-veto");
  }
  if (feedback.humanClosed === true) {
    reasons.push("human-closed-pull-request");
  }
  if (feedback.humanReopened === true) {
    reasons.push("human-reopened-pull-request");
  }
  if (forcePushGeneration.veto) {
    reasons.push("pull-request-history-force-pushed");
  }
  if (vetoLabels.length > 0) reasons.push("veto-label-present");
  const uniqueReasons = [...new Set(reasons)];
  const rawActionableThreads = Array.isArray(feedback.actionableThreads)
    ? feedback.actionableThreads.slice(0, FEEDBACK_BLOCKER_LIMIT)
    : [];
  const resolvedTrustedRemediationThreadIds = new Set(
    rawActionableThreads
      .filter((thread) => {
        const threadId = String(thread?.threadId ?? "");
        const packetThread = packetThreadById.get(threadId);
        return (
          thread?.resolved === true &&
          thread?.trustedBotEnvelope === true &&
          trustedRemediationThreads.has(threadId) &&
          packetThread?.commentId === thread.rootCommentId &&
          packetThread?.digest === thread.bodyDigest
        );
      })
      .map(({ threadId }) => String(threadId)),
  );
  const actionableThreads = rawActionableThreads.filter(
    ({ threadId }) =>
      !resolvedTrustedRemediationThreadIds.has(String(threadId)),
  );
  const rawActionableThreadCount = Number(feedback.actionableThreadCount ?? 0);
  const actionableThreadCount =
    Number.isSafeInteger(rawActionableThreadCount) &&
    rawActionableThreadCount >= resolvedTrustedRemediationThreadIds.size
      ? rawActionableThreadCount - resolvedTrustedRemediationThreadIds.size
      : rawActionableThreadCount;
  const repairableReasonSet = new Set([
    "unreplied-review-feedback",
    "unresolved-review-feedback",
  ]);
  const repairable =
    uniqueReasons.length > 0 &&
    uniqueReasons.every((reason) => repairableReasonSet.has(reason)) &&
    actionableThreads.length > 0 &&
    actionableThreads.length === actionableThreadCount &&
    actionableThreads.every(
      (thread) =>
        thread?.trustedBotEnvelope === true &&
        typeof thread.threadId === "string" &&
        thread.threadId.length > 0 &&
        Number.isSafeInteger(thread.rootCommentId) &&
        thread.rootCommentId > 0 &&
        SHA_PATTERN.test(thread.reviewCommitSha ?? "") &&
        /^[0-9a-f]{64}$/.test(thread.bodyDigest ?? ""),
    );
  return {
    actionableThreadCount,
    actionableThreads,
    autoMergeEnabled: feedback.autoMergeEnabled === true,
    blockers: Array.isArray(feedback.blockers) ? feedback.blockers : [],
    clear: uniqueReasons.length === 0,
    currentProcessorApprovalCount,
    currentProcessorApprovalIds,
    dismissedProcessorApprovalCount: Number(
      feedback.dismissedProcessorApprovalCount ?? 0,
    ),
    digest: /^[0-9a-f]{64}$/.test(feedback.digest ?? "")
      ? feedback.digest
      : canonicalDigest({
          actionableThreads,
          blockers: Array.isArray(feedback.blockers) ? feedback.blockers : [],
          reasons: uniqueReasons,
        }),
    forcePushActors,
    forcePushCommitIds,
    forcePushEventDigest: forcePushGeneration.eventDigest,
    forcePushEventCount:
      Number.isSafeInteger(feedback.forcePushEventCount) &&
      feedback.forcePushEventCount >= 0
        ? feedback.forcePushEventCount
        : null,
    forcePushEvents: forcePushGeneration.events,
    forcePushEventsComplete: forcePushGeneration.eventsComplete,
    forcePushGenerationKind: forcePushGeneration.kind,
    forcePushGenerationReasons: forcePushGeneration.reasons,
    forcePushVeto: forcePushGeneration.veto,
    forcePushed: feedback.forcePushed === true,
    humanClosed: feedback.humanClosed === true,
    humanReopened: feedback.humanReopened === true,
    historicalProcessorApprovalCount: Number(
      feedback.historicalProcessorApprovalCount ?? 0,
    ),
    reasons: uniqueReasons,
    repairable,
    reviewDecision: reviewDecision || null,
    mergeStateStatus:
      String(
        feedback.mergeStateStatus ?? pullRequest.mergeStateStatus ?? "",
      ).toUpperCase() || null,
    mergeable:
      typeof (feedback.mergeable ?? pullRequest.mergeable) === "boolean"
        ? (feedback.mergeable ?? pullRequest.mergeable)
        : null,
    unresolvedThreads,
    unrepliedThreads,
    trustedRemediationThreads: [...trustedRemediationThreads].sort(),
    vetoLabels,
  };
}

function evaluateRepairAttemptGate({
  checks = [],
  commits = [],
  currentBaseSha,
  explicitRepairAttempt,
  headRef,
  headSha,
  mergeBaseSha,
  prepareActor = null,
  pullRequestNumber: pullRequestNumberValue,
  repairHistoryChecks,
  repository,
}) {
  const hasLineageHistory = repairHistoryChecks !== undefined;
  const reasons = [];
  const commitList = Array.isArray(commits) ? commits : [];
  const rawLineageHeadShas = commitList.map((commit) => commit?.sha);
  const lineageHeadShas = [...new Set(rawLineageHeadShas)];
  if (
    lineageHeadShas.length !== rawLineageHeadShas.length ||
    rawLineageHeadShas.some((sha) => !SHA_PATTERN.test(sha ?? ""))
  ) {
    reasons.push("repair-lineage-commit-shas-malformed");
  }
  const lineageHeadShaSet = new Set(lineageHeadShas);
  if (hasLineageHistory && !Array.isArray(repairHistoryChecks)) {
    reasons.push("repair-attempt-history-malformed");
  }
  if (hasLineageHistory && !lineageHeadShaSet.has(headSha)) {
    reasons.push("repair-history-current-head-not-in-lineage");
  }
  const unfilteredHistoryChecks = (
    hasLineageHistory
      ? Array.isArray(repairHistoryChecks)
        ? repairHistoryChecks
        : []
      : checks
  ).map((check) => normalizeCheck(check, hasLineageHistory ? null : headSha));
  const knownReceiptNames = new Set([
    PROCESSOR_CHECK_NAME,
    REFRESH_CHECK_NAME,
    REPAIR_CHECK_NAME,
  ]);
  if (
    hasLineageHistory &&
    unfilteredHistoryChecks.some((check) => !knownReceiptNames.has(check.name))
  ) {
    reasons.push("unexpected-repair-history-check-name");
  }
  const historyChecks = hasLineageHistory
    ? unfilteredHistoryChecks
    : unfilteredHistoryChecks.filter((check) =>
        knownReceiptNames.has(check.name),
      );
  const processorReceiptsByHead = new Map(
    lineageHeadShas.map((sha) => [sha, []]),
  );
  const refreshReceiptsByHead = new Map(
    lineageHeadShas.map((sha) => [sha, []]),
  );
  const repairReceiptsByHead = new Map(lineageHeadShas.map((sha) => [sha, []]));
  const seenReceiptIds = new Set();
  const currentHeadRefreshRequests = [];
  const actorMatchesConfiguration = (receipt) => {
    if (!prepareActor) return true;
    return (
      receipt.prepareAppSlug === prepareActor.appSlug &&
      receipt.prepareBotId === prepareActor.botId &&
      receipt.prepareBotLogin === prepareActor.botLogin
    );
  };
  for (const check of historyChecks) {
    if (!SHA_PATTERN.test(check.headSha ?? "")) {
      reasons.push("malformed-preparation-receipt-head");
      continue;
    }
    if (
      (hasLineageHistory && !lineageHeadShaSet.has(check.headSha)) ||
      (!hasLineageHistory && check.headSha !== headSha)
    ) {
      reasons.push("preparation-receipt-outside-lineage");
      continue;
    }
    if (
      check.name === PROCESSOR_CHECK_NAME &&
      PROCESSOR_REPAIR_RECEIPT_PATTERN.exec(
        String(check.externalId ?? ""),
      )?.[5] === "false"
    ) {
      const status = parseDependabotProcessorStatus(check, repository);
      if (
        !status ||
        status.pullRequestNumber !== pullRequestNumberValue ||
        status.headSha !== check.headSha
      ) {
        reasons.push("malformed-processor-status");
      }
      continue;
    }
    if (seenReceiptIds.has(check.id)) {
      reasons.push("duplicate-preparation-receipt-id");
      continue;
    }
    seenReceiptIds.add(check.id);
    if (check.name === PROCESSOR_CHECK_NAME) {
      const parsed = parseDependabotProcessorReceipt(check, repository);
      if (
        !parsed ||
        parsed.pullRequestNumber !== pullRequestNumberValue ||
        parsed.headSha !== check.headSha ||
        (parsed.packetIssued && parsed.mode === "observe")
      ) {
        reasons.push("malformed-processor-packet-receipt");
      } else {
        processorReceiptsByHead.get(check.headSha)?.push(parsed);
      }
      continue;
    }
    if (check.name === REFRESH_CHECK_NAME) {
      const parsed = parseDependabotRefreshReceipt(check, repository);
      const external = REFRESH_RECEIPT_PATTERN.exec(
        String(check.externalId ?? ""),
      );
      const claimsCurrentHeadRequest =
        check.headSha === headSha && external?.[3] === "requested";
      if (claimsCurrentHeadRequest) {
        currentHeadRefreshRequests.push({ check, parsed });
      }
      if (
        !parsed ||
        parsed.receipt.pullRequestNumber !== pullRequestNumberValue ||
        parsed.receipt.headRef !== headRef ||
        !actorMatchesConfiguration(parsed.receipt)
      ) {
        if (!claimsCurrentHeadRequest) {
          reasons.push("malformed-refresh-receipt");
        }
      } else {
        refreshReceiptsByHead.get(check.headSha)?.push(parsed);
      }
      continue;
    }
    if (check.name === REPAIR_CHECK_NAME) {
      const parsed = parseDependabotRepairReceipt(check, repository);
      if (
        !parsed ||
        parsed.receipt.pullRequestNumber !== pullRequestNumberValue ||
        parsed.receipt.headRef !== headRef ||
        !actorMatchesConfiguration(parsed.receipt)
      ) {
        reasons.push("malformed-repair-receipt");
      } else {
        repairReceiptsByHead.get(check.headSha)?.push(parsed);
      }
    }
  }
  let consumedAttempts = 0;
  let refreshCommitCount = 0;
  let authenticatedRepairCommitCount = 0;
  let manualRepairCommitCount = 0;
  let currentHeadPacketIssued = false;
  let issuedAttemptCount = 0;
  let latestAppliedRepair = null;
  let pendingRefreshCompletion = null;
  let pendingRefreshRequest = null;
  let prepareLineageValid = true;
  let preparationActor = null;
  const operationDigests = [];
  const protectedRuntimeOperations = [];
  const bindPreparationActor = (receipt) => {
    const actor = {
      appSlug: receipt.prepareAppSlug,
      botId: receipt.prepareBotId,
      botLogin: receipt.prepareBotLogin,
    };
    if (
      preparationActor &&
      stableJson(preparationActor) !== stableJson(actor)
    ) {
      reasons.push("preparation-actor-changed");
    } else {
      preparationActor = actor;
    }
  };
  for (let index = 1; index < commitList.length; index += 1) {
    const parentCommit = commitList[index - 1];
    const commit = commitList[index];
    const parentHeadSha = parentCommit.sha;
    const commitHeadSha = commit.sha;
    const parentProcessorPackets = (
      processorReceiptsByHead.get(parentHeadSha) ?? []
    ).filter(({ packetIssued }) => packetIssued);
    const refreshCompletions = (
      refreshReceiptsByHead.get(commitHeadSha) ?? []
    ).filter(({ receipt }) => receipt.state === "completed");
    const repairCompletions = repairReceiptsByHead.get(commitHeadSha) ?? [];
    if (refreshCompletions.length > 1 || repairCompletions.length > 1) {
      reasons.push("ambiguous-preparation-transition-receipt");
      continue;
    }
    if (refreshCompletions.length === 1 && repairCompletions.length === 1) {
      reasons.push("conflicting-preparation-transition-receipts");
      continue;
    }
    const [refreshCompletion] = refreshCompletions;
    const matchingRequests = (
      refreshReceiptsByHead.get(parentHeadSha) ?? []
    ).filter(
      ({ receipt }) =>
        receipt.state === "requested" &&
        receipt.parentHeadSha === parentHeadSha,
    );
    const selectedRequest = [...matchingRequests]
      .sort((left, right) => left.check.id - right.check.id)
      .at(-1);
    if (refreshCompletion) {
      const completed = refreshCompletion.receipt;
      const request =
        selectedRequest?.check.id === completed.requestCheckId &&
        canonicalDigest(selectedRequest.receipt) === completed.requestDigest
          ? selectedRequest
          : null;
      const parents = commitParentShas(commit);
      const parentSet = new Set(parents);
      if (
        !request ||
        completed.parentHeadSha !== parentHeadSha ||
        completed.headSha !== commitHeadSha ||
        completed.previousBaseSha !== request.receipt.previousBaseSha ||
        completed.prepareAppSlug !== request.receipt.prepareAppSlug ||
        completed.prepareBotId !== request.receipt.prepareBotId ||
        completed.prepareBotLogin !== request.receipt.prepareBotLogin ||
        parents.length !== 2 ||
        parentSet.size !== 2 ||
        parents[0] !== parentHeadSha ||
        parents[1] !== completed.baseSha ||
        !commitMatchesAuthenticatedRefresh(commit, completed)
      ) {
        reasons.push("invalid-refresh-transition");
        continue;
      }
      refreshCommitCount += 1;
      bindPreparationActor(completed);
      operationDigests.push(canonicalDigest(completed));
      continue;
    }
    const [repairCompletion] = repairCompletions;
    if (repairCompletion) {
      const completed = repairCompletion.receipt;
      const processorReceipt = parentProcessorPackets.find(
        ({ attempt, check, packetDigest }) =>
          attempt === completed.attempt &&
          check.id === completed.processorCheckId &&
          packetDigest === completed.packetDigest,
      );
      const parents = commitParentShas(commit);
      const protectedRuntimeOperation =
        processorReceipt?.packet?.schema ===
        DEPENDABOT_PROTECTED_RUNTIME_REPAIR_PACKET_SCHEMA
          ? processorReceipt.packet.operation
          : null;
      if (
        !processorReceipt ||
        (protectedRuntimeOperation !== null &&
          !validVercelCliRuntimeOperation(protectedRuntimeOperation)) ||
        completed.parentHeadSha !== parentHeadSha ||
        completed.headSha !== commitHeadSha ||
        completed.attempt !== consumedAttempts + 1 ||
        parents.length !== 1 ||
        parents[0] !== parentHeadSha ||
        !commitMatchesPrepareBot(commit, completed) ||
        !commitHasValidVerification(commit)
      ) {
        reasons.push("invalid-repair-transition");
        continue;
      }
      consumedAttempts += 1;
      authenticatedRepairCommitCount += 1;
      bindPreparationActor(completed);
      const operationDigest = canonicalDigest(completed);
      operationDigests.push(operationDigest);
      if (protectedRuntimeOperation !== null) {
        protectedRuntimeOperations.push({
          operation: protectedRuntimeOperation,
          operationDigest,
          packetDigest: processorReceipt.packetDigest,
        });
      }
      latestAppliedRepair = {
        packet: processorReceipt.packet,
        packetDigest: processorReceipt.packetDigest,
        receipt: completed,
      };
      continue;
    }
    if (selectedRequest && index === commitList.length - 1) {
      const { check, receipt } = selectedRequest;
      const parents = commitParentShas(commit);
      const parentSet = new Set(parents);
      const appliedBaseSha = parents[1] ?? null;
      if (
        parents.length === 2 &&
        parentSet.size === 2 &&
        parents[0] === parentHeadSha &&
        (appliedBaseSha === currentBaseSha ||
          appliedBaseSha === mergeBaseSha) &&
        commitMatchesAuthenticatedRefresh(commit, receipt)
      ) {
        pendingRefreshCompletion = {
          appliedBaseSha,
          headSha: commitHeadSha,
          requestCheckId: check.id,
          requestDigest: canonicalDigest(receipt),
          requestReceipt: receipt,
        };
        bindPreparationActor(receipt);
        continue;
      }
    }
    const expectedAttempt = consumedAttempts + 1;
    const legacyPacket = parentProcessorPackets.find(
      ({ attempt }) => attempt === expectedAttempt,
    );
    if (legacyPacket) {
      consumedAttempts += 1;
      manualRepairCommitCount += 1;
      prepareLineageValid = false;
      latestAppliedRepair = {
        packet: legacyPacket.packet,
        packetDigest: legacyPacket.packetDigest,
        receipt: null,
      };
    } else {
      reasons.push("preparation-lineage-commit-without-typed-receipt");
    }
  }
  for (const [index, lineageHeadSha] of lineageHeadShas.entries()) {
    const receipts = processorReceiptsByHead.get(lineageHeadSha) ?? [];
    const statedAttempts = new Set(receipts.map(({ attempt }) => attempt));
    if (
      statedAttempts.size > 1 ||
      [...statedAttempts].some(
        (attempt) =>
          !Number.isSafeInteger(attempt) || attempt < 1 || attempt > 2,
      )
    ) {
      reasons.push("ambiguous-repair-attempt-history");
    }
    const packetAttempts = new Set(
      receipts
        .filter(({ packetIssued }) => packetIssued)
        .map(({ attempt }) => attempt),
    );
    if (packetAttempts.size > 1) {
      reasons.push("ambiguous-repair-attempt-history");
    }
    const isCurrentHead = index === lineageHeadShas.length - 1;
    if (isCurrentHead) {
      const invalidRequestId = currentHeadRefreshRequests.some(
        ({ check }) => !Number.isSafeInteger(check.id) || check.id < 1,
      );
      const newestRequest = invalidRequestId
        ? null
        : [...currentHeadRefreshRequests]
            .sort((left, right) => left.check.id - right.check.id)
            .at(-1);
      if (invalidRequestId || (newestRequest && !newestRequest.parsed)) {
        reasons.push("malformed-current-refresh-request");
      } else if (newestRequest) {
        const { check, receipt } = newestRequest.parsed;
        if (
          receipt.baseSha === currentBaseSha &&
          receipt.previousBaseSha === mergeBaseSha
        ) {
          pendingRefreshRequest = {
            requestCheckId: check.id,
            requestDigest: canonicalDigest(receipt),
            requestReceipt: receipt,
          };
        }
      }
    }
    if (packetAttempts.size === 1) {
      issuedAttemptCount += 1;
      if (isCurrentHead) {
        if (packetAttempts.has(consumedAttempts + 1)) {
          currentHeadPacketIssued = receipts.some(
            ({ attempt, packetCanonical, packetIssued }) =>
              packetIssued &&
              packetCanonical &&
              attempt === consumedAttempts + 1,
          );
        } else {
          reasons.push("current-head-packet-attempt-mismatch");
        }
      }
    }
  }
  if (!hasLineageHistory && lineageHeadShas.length > 1) {
    reasons.push("repair-lineage-history-required");
  }
  const derivedRepairAttempt = consumedAttempts + 1;
  let repairAttempt = derivedRepairAttempt;
  if (explicitRepairAttempt !== undefined) {
    invariant(
      Number.isSafeInteger(explicitRepairAttempt) && explicitRepairAttempt >= 1,
      "Explicit repairAttempt must be a positive safe integer",
    );
    invariant(
      explicitRepairAttempt === derivedRepairAttempt,
      "Explicit repairAttempt does not match reachable-lineage processor receipts",
    );
    repairAttempt = explicitRepairAttempt;
  }
  const packet = {
    attemptLimit: 2,
    consumedAttempts,
    currentAttempt: repairAttempt,
    currentHeadPacketIssued,
    historySource: hasLineageHistory
      ? "lineage-checks"
      : "current-checks-fallback",
    issuedAttemptCount,
    latestAppliedRepair,
    lineageCommitCount: lineageHeadShas.length,
    manualRepairCommitCount,
    operationDigests,
    pendingRefreshCompletion,
    pendingRefreshRequest,
    preparationActor,
    preparationKind:
      refreshCommitCount + authenticatedRepairCommitCount === 0
        ? "native"
        : "prepared",
    prepareLineageValid: reasons.length === 0 && prepareLineageValid,
    protectedRuntimeOperations,
    refreshCommitCount,
    reasons: [...new Set(reasons)],
    receiptCheckCount: seenReceiptIds.size,
    repairCommitCount: authenticatedRepairCommitCount + manualRepairCommitCount,
    authenticatedRepairCommitCount,
    repairLineageValid: reasons.length === 0,
    valid: reasons.length === 0,
  };
  return packet;
}

function protectedRuntimeFeedbackMatchesOperation({
  feedback,
  headSha,
  operation,
}) {
  if (feedback?.clear === true) return true;
  if (
    feedback?.repairable !== true ||
    !validVercelCliRuntimeOperation(operation) ||
    !SHA_PATTERN.test(headSha ?? "")
  ) {
    return false;
  }
  const actionableThreads = Array.isArray(feedback.actionableThreads)
    ? feedback.actionableThreads
    : [];
  const allowedReviewCommits = new Set([headSha, operation.sourceSeedHeadSha]);
  return (
    actionableThreads.length > 0 &&
    actionableThreads.every(
      ({ path, protectedRuntimeFinding, reviewCommitSha, source }) =>
        source === "cursor" &&
        path === "package.json" &&
        allowedReviewCommits.has(reviewCommitSha) &&
        exactObjectKeys(protectedRuntimeFinding, [
          "fromVersion",
          "kind",
          "targetVersion",
        ]) &&
        protectedRuntimeFinding.kind === operation.kind &&
        protectedRuntimeFinding.fromVersion === operation.fromVersion &&
        protectedRuntimeFinding.targetVersion === operation.targetVersion,
    )
  );
}

function recommendedDisposition({
  base,
  checks,
  feedback,
  headSha,
  identity,
  mode,
  protectedRuntimeOperation,
  repairAttempts,
  risk,
}) {
  if (!identity.valid) return "rejected-identity";
  const preparing = mode === "prepare";
  if (!feedback.clear && !(preparing && feedback.repairable)) {
    return "manual-veto-or-feedback";
  }
  if (preparing) {
    if (!risk.preparable || !identity.prepareAuthority) return "manual-review";
    if (repairAttempts.pendingRefreshCompletion) {
      return "refresh-receipt-required";
    }
    if (repairAttempts.pendingRefreshRequest) return "refresh-pending";
    if (!base.current) return "refresh-required";
  } else {
    if (!base.current) return "waiting-base-update";
    if (!risk.autoApprovable) return "manual-review";
  }
  if (
    preparing &&
    protectedRuntimeOperation !== null &&
    protectedRuntimeOperation.eligible !== true
  ) {
    return "manual-repair-required";
  }
  if (checks.missing.length > 0 || checks.pending.length > 0) {
    return "waiting-checks";
  }
  if (checks.state === "pending") return "waiting-checks";
  let branchFailures = [];
  if (checks.state === "failing") {
    const retryFailures = checks.failures.filter(
      ({ attribution }) =>
        attribution === "unknown" || attribution === "non-deterministic",
    );
    if (retryFailures.length > 0) return "waiting-retry";
    branchFailures = checks.failures.filter(
      ({ attribution }) => attribution === "branch",
    );
    if (branchFailures.length === 0) return "waiting-baseline";
  }
  if (preparing && protectedRuntimeOperation !== null) {
    if (protectedRuntimeOperation.satisfied !== true) {
      if (
        feedback.repairable &&
        !protectedRuntimeFeedbackMatchesOperation({
          feedback,
          headSha,
          operation: protectedRuntimeOperation.operation,
        })
      ) {
        return "manual-repair-required";
      }
      if (!repairAttempts.valid || repairAttempts.currentAttempt > 2) {
        return "manual-repair-escalated";
      }
      if (repairAttempts.currentHeadPacketIssued) return "repair-pending";
      return "repair-required";
    }
  }
  if (branchFailures.length > 0) {
    if (
      preparing &&
      protectedRuntimeOperation?.satisfied === true &&
      !onlyClaudeReviewFailures(checks)
    ) {
      return "manual-repair-required";
    }
    if (repairTouchesForbiddenPath({ checks, feedback })) {
      return "manual-repair-required";
    }
    if (!repairAttempts.valid || repairAttempts.currentAttempt > 2) {
      return "manual-repair-escalated";
    }
    if (repairAttempts.currentHeadPacketIssued) return "repair-pending";
    return "repair-required";
  }
  if (preparing && feedback.repairable) {
    if (repairTouchesForbiddenPath({ checks, feedback })) {
      return "manual-repair-required";
    }
    const packetThreads = new Set(
      (repairAttempts.latestAppliedRepair?.packet?.feedbackThreads ?? []).map(
        ({ threadId }) => threadId,
      ),
    );
    const remediationReady =
      packetThreads.size > 0 &&
      feedback.actionableThreads.every(({ threadId }) =>
        packetThreads.has(threadId),
      );
    if (remediationReady) return "feedback-remediation-required";
    if (!repairAttempts.valid || repairAttempts.currentAttempt > 2) {
      return "manual-repair-escalated";
    }
    if (repairAttempts.currentHeadPacketIssued) return "repair-pending";
    return "repair-required";
  }
  if (preparing) return "prepare-candidate";
  if (!identity.automaticAuthority) return "manual-review";
  if (mode === "assist") return "ready-for-human-review";
  return "eligible-observed";
}

function autonomousRepairPathForbidden(path) {
  return (
    typeof path !== "string" ||
    path.length === 0 ||
    AUTONOMOUS_REPAIR_FORBIDDEN_PATH_PATTERN.test(path) ||
    hardDeniedRepairPath(path)
  );
}

function onlyClaudeReviewFailures(checks) {
  return (checks.failures ?? []).every(({ id }) => id === "claude-review");
}

function repairTouchesForbiddenPath({ checks = {}, feedback = {} }) {
  return [
    ...(checks.failures ?? []).flatMap(({ findings = [] }) =>
      findings.map(({ path }) => path),
    ),
    ...(feedback.actionableThreads ?? []).map(({ path }) => path),
  ].some((path) => autonomousRepairPathForbidden(path));
}

function genericRepairPathPermitted(path) {
  return (
    typeof path === "string" &&
    path.length > 0 &&
    !autonomousRepairPathForbidden(path) &&
    (new Set(["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"]).has(
      path,
    ) ||
      ["apps/", "packages/", "patches/"].some((prefix) =>
        path.startsWith(prefix),
      ))
  );
}

function hasBoundProtectedRuntimeProof(evaluation) {
  const operationState = evaluation.protectedRuntimeOperation;
  const attempts = evaluation.repairAttempts;
  const proof = operationState?.proof;
  return (
    operationState?.eligible === true &&
    operationState.satisfied === true &&
    operationState.stateMatches === true &&
    validVercelCliRuntimeOperation(operationState.operation) &&
    evaluation.repairAttempt === 2 &&
    attempts?.valid === true &&
    attempts.currentAttempt === 2 &&
    attempts.prepareLineageValid === true &&
    attempts.repairLineageValid === true &&
    exactObjectKeys(proof, ["operation", "operationDigest", "packetDigest"]) &&
    validVercelCliRuntimeOperation(proof.operation) &&
    stableJson(proof.operation) === stableJson(operationState.operation) &&
    /^[0-9a-f]{64}$/.test(proof.operationDigest ?? "") &&
    /^[0-9a-f]{64}$/.test(proof.packetDigest ?? "") &&
    (attempts.protectedRuntimeOperations ?? []).some(
      (candidate) => stableJson(candidate) === stableJson(proof),
    )
  );
}

function canCarryBoundProtectedRuntimePaths({
  changedPaths,
  evaluation,
  evidencePaths,
  forbiddenChangedPaths,
}) {
  const requiredPaths = new Set(
    evaluation.protectedRuntimeOperation?.operation?.requiredPaths ?? [],
  );
  const changedPathSet = new Set(changedPaths);
  return (
    forbiddenChangedPaths.length > 0 &&
    forbiddenChangedPaths.every((path) => requiredPaths.has(path)) &&
    onlyClaudeReviewFailures(evaluation.checks) &&
    evidencePaths.length > 0 &&
    evidencePaths.length <= 8 &&
    evidencePaths.every(
      (path) => changedPathSet.has(path) && genericRepairPathPermitted(path),
    ) &&
    hasBoundProtectedRuntimeProof(evaluation)
  );
}

export function createDependabotRepairPacket(evaluation) {
  if (
    evaluation.mode !== "prepare" ||
    evaluation.disposition !== "repair-required"
  ) {
    return null;
  }
  const protectedRuntimeOperation =
    evaluation.protectedRuntimeOperation?.eligible === true &&
    evaluation.protectedRuntimeOperation?.satisfied !== true
      ? evaluation.protectedRuntimeOperation.operation
      : null;
  const isProtectedRuntimeSync = protectedRuntimeOperation !== null;
  const feedbackEligible =
    evaluation.feedback?.clear === true ||
    evaluation.feedback?.repairable === true;
  const changedPaths = Array.isArray(evaluation.changedPaths)
    ? evaluation.changedPaths
    : [];
  const forbiddenChangedPaths = changedPaths.filter((path) =>
    autonomousRepairPathForbidden(path),
  );
  const forbiddenRepairEvidence = repairTouchesForbiddenPath({
    checks: evaluation.checks,
    feedback: evaluation.feedback,
  });
  if (
    evaluation.identity?.valid !== true ||
    evaluation.identity?.prepareAuthority !== true ||
    evaluation.risk?.preparable !== true ||
    !feedbackEligible ||
    evaluation.base?.current !== true ||
    evaluation.repairAttempts?.valid !== true ||
    evaluation.repairAttempt > 2 ||
    (!isProtectedRuntimeSync && forbiddenRepairEvidence) ||
    (isProtectedRuntimeSync &&
      !protectedRuntimeFeedbackMatchesOperation({
        feedback: evaluation.feedback,
        headSha: evaluation.headSha,
        operation: protectedRuntimeOperation,
      })) ||
    evaluation.checks.missing.length > 0 ||
    evaluation.checks.pending.length > 0 ||
    evaluation.checks.failures.some(
      ({ attribution }) =>
        attribution === "unknown" || attribution === "non-deterministic",
    )
  ) {
    return null;
  }
  const branchFailures = evaluation.checks.failures
    .filter(({ attribution }) => attribution === "branch")
    .map(({ attribution, id, name }) => {
      const result = evaluation.checks.policy.find(
        (policyResult) => policyResult.id === id,
      );
      return {
        attribution,
        detailsUrl: result?.check?.detailsUrl ?? null,
        id,
        name,
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
  const findings = evaluation.checks.failures
    .filter(({ attribution }) => attribution === "branch")
    .flatMap((failure) =>
      (failure.findings ?? []).map((finding) => {
        const policyResult = evaluation.checks.policy.find(
          ({ id }) => id === failure.id,
        );
        return {
          checkId: Number.isSafeInteger(policyResult?.check?.id)
            ? policyResult.check.id
            : null,
          digest: canonicalDigest({
            line: finding.line,
            path: finding.path,
            summary: finding.summary,
            title: finding.title,
          }),
          line: finding.line,
          path: finding.path,
          source: "claude",
          sourceId: finding.id,
          summary: finding.summary,
          title: finding.title,
        };
      }),
    )
    .slice(0, 20);
  const feedbackThreads = (evaluation.feedback?.actionableThreads ?? [])
    .filter(
      (thread) =>
        typeof thread.path === "string" &&
        thread.path.length > 0 &&
        !autonomousRepairPathForbidden(thread.path) &&
        Number.isSafeInteger(thread.rootCommentId) &&
        thread.rootCommentId > 0 &&
        SHA_PATTERN.test(thread.reviewCommitSha ?? "") &&
        new Set(["claude", "codex", "cursor"]).has(thread.source),
    )
    .map((thread) => ({
      commentId: thread.rootCommentId,
      commitSha: thread.reviewCommitSha,
      digest: thread.bodyDigest,
      line: thread.line,
      path: thread.path,
      source: thread.source,
      threadId: thread.threadId,
    }))
    .slice(0, 20);
  const evidencePaths = [
    ...new Set([
      ...findings.map(({ path }) => path),
      ...feedbackThreads.map(({ path }) => path),
    ]),
  ].sort((left, right) => left.localeCompare(right));
  const carryBoundProtectedRuntimePaths =
    !isProtectedRuntimeSync &&
    canCarryBoundProtectedRuntimePaths({
      changedPaths,
      evaluation,
      evidencePaths,
      forbiddenChangedPaths,
    });
  if (
    !isProtectedRuntimeSync &&
    branchFailures.length === 0 &&
    feedbackThreads.length === 0
  ) {
    return null;
  }
  if (
    !isProtectedRuntimeSync &&
    forbiddenChangedPaths.length > 0 &&
    !carryBoundProtectedRuntimePaths
  ) {
    return null;
  }
  const isAction = evaluation.risk.packageEcosystem === "github-actions";
  const limits = isProtectedRuntimeSync
    ? {
        maxAddedLines: 600,
        maxBytes: 64 * 1024,
        maxChanges: 160,
        maxDeletedLines: 600,
        maxFiles: 5,
      }
    : isAction
      ? {
          maxAddedLines: 250,
          maxBytes: 64 * 1024,
          maxChanges: 8,
          maxDeletedLines: 250,
          maxFiles: 6,
        }
      : {
          maxAddedLines: 600,
          maxBytes: 64 * 1024,
          maxChanges: 16,
          maxDeletedLines: 600,
          maxFiles: carryBoundProtectedRuntimePaths ? evidencePaths.length : 8,
        };
  const workflowContext = evaluation.workflowContext ?? {};
  const allExpectedBlobs = Array.isArray(evaluation.expectedBlobs)
    ? evaluation.expectedBlobs
    : [];
  const evidencePathSet = new Set(evidencePaths);
  const expectedBlobs = carryBoundProtectedRuntimePaths
    ? allExpectedBlobs.filter(({ path }) => evidencePathSet.has(path))
    : allExpectedBlobs;
  if (
    !Number.isSafeInteger(workflowContext.workflowRunId) ||
    workflowContext.workflowRunId < 1 ||
    !Number.isSafeInteger(workflowContext.workflowRunAttempt) ||
    workflowContext.workflowRunAttempt < 1 ||
    !SHA_PATTERN.test(workflowContext.workflowSha ?? "") ||
    expectedBlobs.length < 1 ||
    expectedBlobs.length > 100 ||
    (carryBoundProtectedRuntimePaths &&
      stableJson(expectedBlobs.map(({ path }) => path)) !==
        stableJson(evidencePaths)) ||
    (isProtectedRuntimeSync &&
      stableJson(expectedBlobs.map(({ path }) => path)) !==
        stableJson(VERCEL_CLI_RUNTIME_INPUT_PATHS)) ||
    expectedBlobs.some(
      ({ mode, path, sha, type }) =>
        typeof path !== "string" ||
        path.length === 0 ||
        !SHA_PATTERN.test(sha ?? "") ||
        !new Set(["100644", "100755"]).has(mode) ||
        type !== "blob",
    )
  ) {
    return null;
  }
  const packet = {
    attemptLimit: 2,
    attemptNumber: evaluation.repairAttempt,
    automatic: true,
    baseRef: evaluation.baseRef,
    baseSha: evaluation.baseSha,
    changedPaths: evaluation.changedPaths,
    dependencyGroup: evaluation.dependencyGroup,
    dependencyNames: evaluation.risk.dependencyNames,
    escalation: "manual-review",
    expectedBlobs,
    failures: branchFailures,
    feedbackThreads,
    findings,
    forbiddenPaths: [
      ".github/**",
      "**/auth/**",
      "**/deploy/**",
      "**/deployment/**",
      "**/policy/**",
      ...(isProtectedRuntimeSync ? [] : ["**/runtime/**"]),
      ...(isProtectedRuntimeSync ? [] : ["scripts/vercel-cli-runtime/**"]),
      "**/security/**",
      "docs/vercel-deployments.md",
      "scripts/vercel-main-*.mjs",
    ],
    headSha: evaluation.headSha,
    headRef: evaluation.headRef,
    limits,
    mode: evaluation.mode,
    packageEcosystem: evaluation.risk.packageEcosystem,
    permittedPaths: isProtectedRuntimeSync
      ? [...VERCEL_CLI_RUNTIME_REQUIRED_PATHS]
      : carryBoundProtectedRuntimePaths
        ? evidencePaths
        : isAction
          ? []
          : [
              "package.json",
              "pnpm-lock.yaml",
              "pnpm-workspace.yaml",
              "apps/**",
              "packages/**",
              "patches/**",
            ],
    pullRequestNumber: evaluation.pullRequestNumber,
    preparable: true,
    repository: evaluation.repository,
    requiredGateIds: CHECK_POLICY_DEFINITIONS.map(({ id }) => id),
    requireExactHead: true,
    requireHumanApproval: false,
    riskTier: evaluation.risk.tier,
    schema: isProtectedRuntimeSync
      ? DEPENDABOT_PROTECTED_RUNTIME_REPAIR_PACKET_SCHEMA
      : DEPENDABOT_REPAIR_PACKET_SCHEMA,
    updateType: isProtectedRuntimeSync
      ? protectedRuntimeOperation.updateType
      : evaluation.risk.updateType,
    validationCommands: isAction
      ? ["pnpm ci:action-pins:test", "pnpm quality:budgets:test"]
      : [
          "pnpm install --frozen-lockfile",
          "pnpm quality:budgets:test",
          "pnpm quality:coverage",
          "pnpm build",
          "pnpm quality:bundle:check",
        ],
    workflowRunAttempt: workflowContext.workflowRunAttempt,
    workflowRunId: workflowContext.workflowRunId,
    workflowSha: workflowContext.workflowSha,
  };
  if (isProtectedRuntimeSync) packet.operation = protectedRuntimeOperation;
  try {
    validateProcessorRepairPacket(packet);
    return canonicalJson(packet).length <= RECEIPT_OUTPUT_LIMIT ? packet : null;
  } catch {
    return null;
  }
}

export function evaluateDependabotPullRequest(snapshot, options = {}) {
  const repository = repositoryName(options.repository ?? snapshot.repository);
  const mode = normalizeProcessorMode(options.mode ?? snapshot.mode);
  const pullRequest = normalizePullRequest(snapshot.pullRequest ?? snapshot);
  const expectedHeadSha =
    snapshot.expectedHeadSha ?? snapshot.headSha ?? pullRequest.headSha;
  const parsedMetadata = parseDependabotMetadata({
    body: pullRequest.body,
    files: pullRequest.files,
    headRef: pullRequest.headRef,
  });
  const metadata = snapshot.metadata?.immutableEvidence
    ? { ...snapshot.metadata }
    : {
        ...parsedMetadata,
        ...(snapshot.metadata ?? {}),
      };
  if (metadata.dependencyNames === undefined) {
    metadata.dependencyNames = parsedMetadata.dependencyNames;
  }
  const base = evaluateCurrentBaseGate({
    ancestry: snapshot.baseAncestry,
    baselineSha: snapshot.baseline?.sha ?? snapshot.baselineSha ?? null,
    pullRequest,
  });
  const repairAttempts = evaluateRepairAttemptGate({
    checks: snapshot.checks ?? [],
    commits: snapshot.commits ?? [],
    currentBaseSha: base.currentBaseSha,
    explicitRepairAttempt: snapshot.repairAttempt,
    headRef: pullRequest.headRef,
    headSha: pullRequest.headSha,
    mergeBaseSha: base.mergeBaseSha,
    prepareActor: snapshot.prepareActor ?? null,
    pullRequestNumber: pullRequest.number,
    repairHistoryChecks: snapshot.repairHistoryChecks,
    repository,
  });
  const structuralIdentity = validateDependabotPullRequestIdentity({
    commits: snapshot.commits ?? [],
    expectedHeadSha,
    metadata,
    pullRequest: snapshot.pullRequest ?? snapshot,
    repairAttempts,
    repository,
  });
  const risk = classifyDependabotRisk(metadata);
  const checks = SHA_PATTERN.test(pullRequest.headSha ?? "")
    ? evaluateDependabotChecks({
        baselineChecks:
          snapshot.baseline?.checks ?? snapshot.baselineChecks ?? [],
        baselineSha: snapshot.baseline?.sha ?? snapshot.baselineSha ?? null,
        checks: snapshot.checks ?? [],
        headSha: pullRequest.headSha,
        plannerDecisions:
          snapshot.plannerDecisions ??
          derivePlannerDecisions(pullRequest.files),
        pullRequestNumber: pullRequest.number,
        repository,
      })
    : {
        baselineSha: snapshot.baseline?.sha ?? snapshot.baselineSha ?? null,
        failures: [],
        headSha: pullRequest.headSha,
        missing: CHECK_POLICY_DEFINITIONS.map(({ id }) => id),
        pending: [],
        policy: [],
        state: "pending",
      };
  const feedback = evaluateFeedbackGate({
    feedback: snapshot.feedback,
    generationSeedCommit: (snapshot.commits ?? [])[0] ?? null,
    generationSeedHeadSha: structuralIdentity.automaticSeedHeadSha,
    generationSeedTrusted:
      metadata.immutableEvidence?.seedCommitTrusted === true &&
      metadata.immutableEvidence?.seedCommitSha ===
        structuralIdentity.automaticSeedHeadSha,
    pullRequest: snapshot.pullRequest ?? snapshot,
    repairAttempts,
  });
  const protectedRuntimeOperation = evaluateProtectedRuntimeOperation({
    metadata,
    protectedRuntime: snapshot.protectedRuntime ?? null,
    repairAttempts,
  });
  const identity = feedback.forcePushVeto
    ? {
        ...structuralIdentity,
        automaticAuthority: false,
        automaticAuthorityReasons: ["pull-request-history-force-pushed"],
        prepareAuthority: false,
      }
    : structuralIdentity;
  const disposition = recommendedDisposition({
    base,
    checks,
    feedback,
    headSha: pullRequest.headSha,
    identity,
    mode,
    protectedRuntimeOperation,
    repairAttempts,
    risk,
  });
  const expectedBlobSource = Array.isArray(snapshot.expectedBlobs)
    ? snapshot.expectedBlobs
    : pullRequest.files;
  const evaluation = {
    base,
    baseRef: pullRequest.baseRef,
    baseSha: pullRequest.baseSha,
    changedPaths: pullRequest.files
      .map((file) => (typeof file === "string" ? file : file?.filename))
      .filter(Boolean)
      .sort(),
    dependencies: (metadata.dependencies ?? []).map((dependency) => ({
      from: dependency.from,
      name: dependency.name,
      to: dependency.to,
      updateType: dependency.updateType,
    })),
    expectedBlobs: expectedBlobSource
      .map((file) => ({
        mode: typeof file === "string" ? null : (file?.mode ?? null),
        path: typeof file === "string" ? file : (file?.path ?? file?.filename),
        sha: typeof file === "string" ? null : (file?.sha ?? null),
        type: typeof file === "string" ? null : (file?.type ?? null),
      }))
      .filter(({ path }) => Boolean(path))
      .sort((left, right) => left.path.localeCompare(right.path)),
    checks,
    disposition,
    feedback,
    headSha: pullRequest.headSha,
    headRef: pullRequest.headRef,
    identity,
    dependencyGroup: metadata.dependencyGroup ?? null,
    mode,
    protectedRuntime: snapshot.protectedRuntime ?? null,
    protectedRuntimeOperation,
    pullRequestNumber: pullRequest.number,
    repository,
    repairAttempt: repairAttempts.currentAttempt,
    repairAttempts,
    risk,
    schema: DEPENDABOT_PROCESSOR_SCHEMA,
    workflowContext:
      options.workflowContext ?? snapshot.workflowContext ?? null,
  };
  const repairPacket = createDependabotRepairPacket(evaluation);
  if (
    evaluation.mode === "prepare" &&
    evaluation.disposition === "repair-required" &&
    repairPacket === null
  ) {
    evaluation.disposition = "manual-repair-required";
  }
  return { ...evaluation, repairPacket };
}

function summarizeEvaluations(evaluations) {
  const byDisposition = {};
  for (const evaluation of evaluations) {
    byDisposition[evaluation.disposition] =
      (byDisposition[evaluation.disposition] ?? 0) + 1;
  }
  return {
    byDisposition,
    prepareCandidates: evaluations.filter(
      ({ disposition }) => disposition === "prepare-candidate",
    ).length,
    total: evaluations.length,
  };
}

function outstandingAutoMergeState(input, evaluations) {
  const explicit = input.outstandingAutoMergeRequests;
  const requests = Array.isArray(explicit)
    ? explicit
    : evaluations
        .filter(({ feedback }) => feedback.autoMergeEnabled)
        .map(({ headSha, pullRequestNumber: number }) => ({
          headSha,
          nodeId: null,
          pullRequestNumber: number,
        }));
  const normalized = [];
  const reasons = [];
  if (explicit !== undefined && !Array.isArray(explicit)) {
    reasons.push("outstanding-auto-merge-list-malformed");
  }
  for (const request of requests) {
    const number = Number(request?.pullRequestNumber ?? request?.number);
    const headSha = request?.headSha;
    const nodeId = request?.nodeId ?? request?.pullRequestNodeId ?? null;
    if (
      !Number.isSafeInteger(number) ||
      number < 1 ||
      !SHA_PATTERN.test(headSha ?? "") ||
      (Array.isArray(explicit) &&
        (typeof nodeId !== "string" ||
          nodeId.length === 0 ||
          nodeId.length > 512 ||
          /\s/.test(nodeId)))
    ) {
      reasons.push("outstanding-auto-merge-request-malformed");
      continue;
    }
    normalized.push({ headSha, nodeId, pullRequestNumber: number });
  }
  const unique = new Set(
    normalized.map(
      ({ headSha, pullRequestNumber: number }) => `${number}:${headSha}`,
    ),
  );
  if (normalized.length > 1 || unique.size !== normalized.length) {
    reasons.push("multiple-outstanding-auto-merge-requests");
  }
  return {
    ambiguous: reasons.length > 0,
    reasons: [...new Set(reasons)],
    requests: normalized,
  };
}

export function evaluateDependabotSweep(input) {
  const repository = repositoryName(input.repository);
  const mode = normalizeProcessorMode(input.mode);
  const evaluations = (input.pullRequests ?? [])
    .map((snapshot) =>
      evaluateDependabotPullRequest(snapshot, {
        mode,
        repository,
        workflowContext: input.workflowContext ?? null,
      }),
    )
    .sort((left, right) => left.pullRequestNumber - right.pullRequestNumber);
  const baselineSnapshots = (input.pullRequests ?? []).map((snapshot) => ({
    checks: snapshot.baseline?.checks ?? snapshot.baselineChecks ?? [],
    sha: snapshot.baseline?.sha ?? snapshot.baselineSha ?? null,
  }));
  const outstandingAutoMerge = outstandingAutoMergeState(input, evaluations);
  const baselineShas = [
    ...new Set(baselineSnapshots.map(({ sha }) => sha).filter(Boolean)),
  ];
  let serialization = {
    check: null,
    currentMainSha: baselineShas[0] ?? null,
    outstandingAutoMerge,
    ready: false,
    reason:
      baselineShas.length === 1
        ? "post-merge-receipt-missing"
        : "current-main-baseline-ambiguous",
  };
  if (baselineShas.length === 1) {
    const currentMainSha = baselineShas[0];
    const matchingSnapshots = baselineSnapshots.filter(
      ({ sha }) => sha === currentMainSha,
    );
    const receipt = selectLatestExactHeadCheck(
      matchingSnapshots.flatMap(({ checks }) => checks),
      currentMainSha,
      POST_MERGE_CHECK_DEFINITION,
    );
    const source = trustedCheckSource(
      receipt,
      currentMainSha,
      POST_MERGE_CHECK_DEFINITION,
      repository,
    );
    const ready = source.trusted && resultState(receipt) === "passing";
    serialization = {
      check: receipt
        ? {
            conclusion: receipt.conclusion,
            headSha: receipt.headSha,
            name: receipt.name,
            runAttempt: receipt.runAttempt,
            runId: receipt.runId,
          }
        : null,
      currentMainSha,
      outstandingAutoMerge,
      ready,
      reason: ready
        ? "exact-main-post-merge-receipt-passed"
        : source.trusted
          ? "post-merge-receipt-not-passing"
          : source.reason,
    };
  }
  const laneEligible =
    mode === "prepare"
      ? evaluations.filter(({ disposition }) =>
          PREPARE_LANE_DISPOSITIONS.has(disposition),
        )
      : [];
  const durablePreparationIncumbents =
    mode === "prepare"
      ? evaluations.filter((result) => {
          if (TERMINAL_PREPARATION_DISPOSITIONS.has(result.disposition)) {
            return false;
          }
          const attempts = result.repairAttempts;
          return (
            attempts?.valid === true &&
            (attempts.pendingRefreshRequest !== null ||
              attempts.pendingRefreshCompletion !== null ||
              attempts.currentHeadPacketIssued === true ||
              (attempts.preparationKind === "prepared" &&
                attempts.prepareLineageValid === true))
          );
        })
      : [];
  const laneParticipants = [
    ...new Set([...laneEligible, ...durablePreparationIncumbents]),
  ];
  const snapshotForResult = (result) =>
    (input.pullRequests ?? []).find((snapshot) => {
      const pullRequest = normalizePullRequest(
        snapshot.pullRequest ?? snapshot,
      );
      return (
        pullRequest.number === result.pullRequestNumber &&
        pullRequest.headSha === result.headSha
      );
    });
  const activeAuthorities =
    mode === "prepare" &&
    serialization.ready &&
    !outstandingAutoMerge.ambiguous &&
    outstandingAutoMerge.requests.length === 0
      ? evaluations
          .map((result) => ({
            approval: activeAllClearAuthority({
              repository,
              result,
              serialization,
              snapshot: snapshotForResult(result),
            }),
            result,
          }))
          .filter(({ approval }) => approval !== null)
      : [];
  let prepareCandidate = null;
  if (
    mode === "prepare" &&
    (outstandingAutoMerge.ambiguous || outstandingAutoMerge.requests.length > 0)
  ) {
    serialization = {
      ...serialization,
      outstandingAutoMerge,
      ready: false,
      reason: outstandingAutoMerge.ambiguous
        ? "outstanding-auto-merge-ambiguous"
        : "outstanding-native-auto-merge-request",
    };
    for (const evaluation of laneParticipants) {
      evaluation.disposition = "waiting-auto-merge-removal";
      evaluation.repairPacket = null;
    }
  } else if (mode === "prepare" && activeAuthorities.length > 1) {
    serialization = {
      ...serialization,
      ready: false,
      reason: "multiple-active-all-clear-authorities",
    };
    for (const evaluation of laneParticipants) {
      evaluation.disposition = "waiting-prepare-serialization";
      evaluation.repairPacket = null;
    }
  } else if (
    mode === "prepare" &&
    activeAuthorities.length === 0 &&
    durablePreparationIncumbents.length > 1
  ) {
    serialization = {
      ...serialization,
      ready: false,
      reason: "multiple-preparation-incumbents",
    };
    for (const evaluation of laneParticipants) {
      evaluation.disposition = "waiting-prepare-serialization";
      evaluation.repairPacket = null;
    }
  } else if (mode === "prepare" && !serialization.ready) {
    for (const evaluation of laneParticipants) {
      evaluation.disposition = "waiting-post-merge-verification";
      evaluation.repairPacket = null;
    }
  } else if (mode === "prepare" && laneParticipants.length > 0) {
    const selected =
      activeAuthorities[0]?.result ??
      durablePreparationIncumbents[0] ??
      laneEligible[0];
    prepareCandidate = {
      disposition: selected.disposition,
      headSha: selected.headSha,
      pullRequestNumber: selected.pullRequestNumber,
    };
    serialization = {
      ...serialization,
      selectedDisposition: selected.disposition,
      selectedHeadSha: selected.headSha,
      selectedPullRequestNumber: selected.pullRequestNumber,
      ...(activeAuthorities.length === 1
        ? { activeAllClearApprovalId: activeAuthorities[0].approval.approvalId }
        : {}),
    };
    for (const evaluation of laneParticipants.filter(
      (item) => item !== selected,
    )) {
      evaluation.disposition = "waiting-prepare-serialization";
      evaluation.repairPacket = null;
    }
  }
  return {
    evaluations,
    mergeCandidate: null,
    mode,
    prepareCandidate,
    repository,
    schema: DEPENDABOT_PROCESSOR_SCHEMA,
    serialization,
    summary: summarizeEvaluations(evaluations),
  };
}

function vercelOutcomeFromEvidence(vercel) {
  return (
    vercel?.outcome ??
    vercel?.terminalOutcome ??
    vercel?.terminalReceipt?.outcome ??
    vercel?.receipt?.outcome ??
    null
  );
}

function vercelShaFromEvidence(vercel) {
  return (
    vercel?.deploySha ??
    vercel?.sha ??
    vercel?.terminalReceipt?.deploySha ??
    vercel?.terminalReceipt?.release?.sha ??
    vercel?.receipt?.deploySha ??
    null
  );
}

function noAffectedTargets(vercel) {
  const targets =
    vercel?.affectedTargets ??
    vercel?.plan?.affectedTargets ??
    vercel?.terminalReceipt?.affectedTargets;
  return (
    vercel?.affected === false ||
    vercel?.affectedTargetCount === 0 ||
    (Array.isArray(targets) && targets.length === 0)
  );
}

export function verifyPostMergeOutcome({
  expectedMergeSha,
  mainChecks = [],
  mergeSha,
  repository,
  vercel,
}) {
  const reasons = [];
  let verifiedRepository = repository;
  try {
    verifiedRepository = repositoryName(repository);
  } catch {
    reasons.push("invalid-repository");
  }
  let expectedSha;
  try {
    expectedSha = exactSha(expectedMergeSha, "Expected merge SHA");
  } catch {
    expectedSha = expectedMergeSha;
    reasons.push("invalid-expected-merge-sha");
  }
  if (!SHA_PATTERN.test(mergeSha ?? "")) {
    reasons.push("invalid-observed-merge-sha");
  } else if (mergeSha !== expectedSha) {
    reasons.push("merge-sha-mismatch");
  }

  let ciCheck = null;
  if (SHA_PATTERN.test(expectedSha ?? "")) {
    ciCheck = selectLatestExactHeadCheck(
      mainChecks,
      expectedSha,
      CHECK_POLICY_DEFINITIONS.find(({ id }) => id === "ci"),
    );
  }
  if (resultState(ciCheck) !== "passing") {
    reasons.push("main-ci-not-successful-for-exact-merge-sha");
  } else if (
    !trustedCheckSource(
      ciCheck,
      expectedSha,
      CHECK_POLICY_DEFINITIONS.find(({ id }) => id === "ci"),
      verifiedRepository,
    ).trusted
  ) {
    reasons.push("main-ci-source-not-trusted");
  }

  const vercelOutcome = vercelOutcomeFromEvidence(vercel);
  const vercelSha = vercelShaFromEvidence(vercel);
  if (vercelSha !== expectedSha) reasons.push("vercel-deploy-sha-mismatch");
  if (vercel?.terminal !== true || vercel?.status === "in_progress") {
    reasons.push("vercel-outcome-is-not-terminal");
  }
  if (vercelOutcome === "recovered") {
    reasons.push("vercel-release-was-recovered");
  } else if (String(vercelOutcome).includes("superseded")) {
    reasons.push("vercel-release-was-superseded");
  } else if (
    vercelOutcome === "active-committed" ||
    vercelOutcome === "current-release-verified"
  ) {
    // These are the only affected-release success outcomes.
  } else if (vercelOutcome === "no-target" && noAffectedTargets(vercel)) {
    // An exact no-target plan is a terminal success without a deployment.
  } else {
    reasons.push("vercel-terminal-outcome-not-accepted");
  }

  return {
    ci: {
      conclusion: ciCheck?.conclusion ?? null,
      name: ciCheck?.name ?? null,
      sha: ciCheck?.headSha ?? null,
    },
    expectedMergeSha,
    mergeSha,
    reasons,
    repository: verifiedRepository,
    schema: DEPENDABOT_POST_MERGE_SCHEMA,
    vercel: {
      outcome: vercelOutcome,
      sha: vercelSha,
    },
    verified: reasons.length === 0,
  };
}

function splitRepository(repository) {
  const [owner, name] = repositoryName(repository).split("/");
  return { name, owner };
}

function workflowActionsRunUrl(repository, workflowRunId) {
  invariant(
    Number.isSafeInteger(workflowRunId) && workflowRunId > 0,
    "Authority check workflow run ID must be a positive safe integer",
  );
  return `https://github.com/${repositoryName(repository)}/actions/runs/${workflowRunId}`;
}

export function requireStablePullRequestSnapshot(initial, final, number) {
  const identity = (pullRequest) => {
    const normalized = normalizePullRequest(pullRequest);
    const draft = pullRequest?.draft ?? pullRequest?.isDraft;
    return {
      authorLogin: normalized.authorLogin,
      baseRef: normalized.baseRef,
      baseRepository: normalized.baseRepository,
      baseSha: normalized.baseSha,
      headRef: normalized.headRef,
      headRepository: normalized.headRepository,
      headSha: normalized.headSha,
      isCrossRepository: normalized.isCrossRepository,
      isDraft: typeof draft === "boolean" ? draft : null,
      nodeId: normalized.nodeId,
      number: normalized.number,
      state: normalized.state,
      updatedAt: pullRequest?.updated_at ?? pullRequest?.updatedAt ?? null,
    };
  };
  const initialIdentity = identity(initial);
  const finalIdentity = identity(final);
  const complete =
    Number.isSafeInteger(initialIdentity.number) &&
    initialIdentity.number > 0 &&
    typeof initialIdentity.nodeId === "string" &&
    initialIdentity.nodeId.length > 0 &&
    initialIdentity.state.length > 0 &&
    initialIdentity.authorLogin.length > 0 &&
    initialIdentity.isDraft !== null &&
    typeof initialIdentity.isCrossRepository === "boolean" &&
    typeof initialIdentity.updatedAt === "string" &&
    initialIdentity.updatedAt.length > 0 &&
    typeof initialIdentity.baseRef === "string" &&
    initialIdentity.baseRef.length > 0 &&
    typeof initialIdentity.baseRepository === "string" &&
    initialIdentity.baseRepository.length > 0 &&
    SHA_PATTERN.test(initialIdentity.baseSha ?? "") &&
    typeof initialIdentity.headRef === "string" &&
    initialIdentity.headRef.length > 0 &&
    typeof initialIdentity.headRepository === "string" &&
    initialIdentity.headRepository.length > 0 &&
    SHA_PATTERN.test(initialIdentity.headSha ?? "");
  const stable =
    complete && stableJson(initialIdentity) === stableJson(finalIdentity);
  snapshotInvariant(
    stable,
    `PR #${number} changed while its exact-head snapshot was collected`,
  );
}

function requirePostApprovalPullRequestSnapshot(initial, final, number) {
  const initialUpdatedAt = initial?.updated_at ?? initial?.updatedAt;
  const finalUpdatedAt = final?.updated_at ?? final?.updatedAt;
  const initialTimestamp = Date.parse(initialUpdatedAt ?? "");
  const finalTimestamp = Date.parse(finalUpdatedAt ?? "");
  invariant(
    Number.isFinite(initialTimestamp) &&
      Number.isFinite(finalTimestamp) &&
      finalTimestamp >= initialTimestamp,
    `PR #${number} update token regressed after approval`,
  );
  requireStablePullRequestSnapshot(
    { ...initial, updatedAt: finalUpdatedAt, updated_at: finalUpdatedAt },
    final,
    number,
  );
}

export function requireStableFeedbackSnapshot(initial, final, number) {
  const stable =
    typeof initial?.digest === "string" &&
    initial.digest.length === 64 &&
    initial.digest === final?.digest &&
    typeof initial?.updatedAt === "string" &&
    initial.updatedAt === final?.updatedAt &&
    initial.headSha === final?.headSha;
  snapshotInvariant(
    stable,
    `PR #${number} feedback changed while its exact-head snapshot was collected`,
  );
}

function linkHasNext(link) {
  return /<[^>]+>;\s*rel="next"/.test(link ?? "");
}

export function createLiveGitHubAdapter({
  apiUrl = process.env.GITHUB_API_URL ?? "https://api.github.com",
  fetchImpl = globalThis.fetch,
  graphqlUrl = process.env.GITHUB_GRAPHQL_URL ??
    "https://api.github.com/graphql",
  token = process.env.DEPENDABOT_PROCESSOR_GITHUB_TOKEN ??
    process.env.GITHUB_TOKEN,
  phase = "finalize",
  prepareAppSlug = process.env.DEPENDABOT_PROCESSOR_PREPARE_APP_SLUG,
  prepareBotId = Number(process.env.DEPENDABOT_PROCESSOR_PREPARE_BOT_ID),
  prepareBotLogin = process.env.DEPENDABOT_PROCESSOR_PREPARE_BOT_LOGIN,
  repairToken = process.env.DEPENDABOT_PROCESSOR_REPAIR_TOKEN,
} = {}) {
  invariant(
    typeof fetchImpl === "function",
    "A fetch implementation is required",
  );
  invariant(
    typeof token === "string" && token.length > 0,
    "GitHub token is required",
  );
  invariant(PROCESSOR_PHASES.has(phase), "Processor phase must be explicit");
  if (phase !== "mutate") {
    invariant(
      typeof repairToken !== "string" || repairToken.length === 0,
      `${phase} phase must not receive a Dependabot repair token`,
    );
  }

  const prepareActor = {
    appSlug: prepareAppSlug,
    botId: prepareBotId,
    botLogin: normalizeLogin(prepareBotLogin),
  };
  const requireRepairCredential = () => {
    invariant(
      phase === "mutate",
      "Branch mutation is available only in mutate phase",
    );
    invariant(
      typeof repairToken === "string" && repairToken.length > 0,
      "A dedicated Dependabot repair token is required for mutate phase",
    );
    invariant(
      repairToken !== token,
      "The Dependabot repair token must be distinct from the workflow GitHub token",
    );
    invariant(
      validPrepareActor({
        prepareAppSlug: prepareActor.appSlug,
        prepareBotId: prepareActor.botId,
        prepareBotLogin: prepareActor.botLogin,
      }),
      "Trusted Dependabot prepare bot identity is required for mutate phase",
    );
    return repairToken;
  };

  const request = async (method, path, { body, accept } = {}) => {
    const response = await fetchImpl(`${apiUrl}${path}`, {
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: {
        Accept: accept ?? "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "mento-dependabot-processor",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      method,
    });
    if (!response.ok) {
      const text = await response.text();
      const error = new Error(
        `GitHub ${method} ${path} failed with ${response.status}: ${text.slice(0, 500)}`,
      );
      error.status = response.status;
      throw error;
    }
    return {
      data: response.status === 204 ? null : await response.json(),
      link: response.headers.get("link"),
    };
  };

  const requestWithRepairCredential = async (method, path, { body } = {}) => {
    const credential = requireRepairCredential();
    const response = await fetchImpl(`${apiUrl}${path}`, {
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${credential}`,
        "Content-Type": "application/json",
        "User-Agent": "mento-dependabot-prepare-mutation",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      method,
    });
    if (!response.ok) {
      const responseText = await response.text();
      throw new Error(
        `GitHub prepare mutation ${method} ${path} failed with ${response.status}: ${responseText.slice(0, 500)}`,
      );
    }
    return {
      data: response.status === 204 ? null : await response.json(),
      link: response.headers.get("link"),
    };
  };

  const paginate = async (path) => {
    const items = [];
    let page = 1;
    while (page <= 20) {
      const separator = path.includes("?") ? "&" : "?";
      const response = await request(
        "GET",
        `${path}${separator}per_page=100&page=${page}`,
      );
      invariant(Array.isArray(response.data), `Expected a list from ${path}`);
      items.push(...response.data);
      if (response.data.length < 100 && !linkHasNext(response.link)) break;
      page += 1;
    }
    invariant(page <= 20, `GitHub pagination limit exceeded for ${path}`);
    return items;
  };

  const graphql = async (query, variables) => {
    const response = await fetchImpl(graphqlUrl, {
      body: JSON.stringify({ query, variables }),
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "mento-dependabot-processor",
      },
      method: "POST",
    });
    const payload = await response.json();
    if (!response.ok || payload.errors) {
      throw new Error(
        `GitHub GraphQL request failed: ${JSON.stringify(payload.errors ?? payload).slice(0, 1_000)}`,
      );
    }
    return payload.data;
  };

  const workflowRunCache = new Map();
  const forcePushCommitEvidenceCache = new Map();
  const normalizeWorkflowRunSource = (data) => ({
    runDisplayTitle: data.display_title,
    runHeadBranch: data.head_branch,
    runConclusion:
      typeof data.conclusion === "string"
        ? data.conclusion.toLowerCase()
        : null,
    sourceRepository: data.repository?.full_name,
    runAttempt: data.run_attempt,
    runHeadSha: data.head_sha ?? null,
    runId: data.id,
    runStatus:
      typeof data.status === "string" ? data.status.toLowerCase() : null,
    workflowEvent: data.event,
    workflowPath: String(data.path ?? "").replace(/@.*$/, ""),
  });
  const readWorkflowRunSource = (repository, runId, runAttempt = null) => {
    const path =
      runAttempt === null
        ? `/repos/${repository}/actions/runs/${runId}`
        : `/repos/${repository}/actions/runs/${runId}/attempts/${runAttempt}`;
    return request("GET", path).then(({ data }) =>
      normalizeWorkflowRunSource(data),
    );
  };
  const cachedWorkflowRunSource = (
    repository,
    runId,
    runAttempt = null,
    { fresh = false } = {},
  ) => {
    if (fresh) return readWorkflowRunSource(repository, runId, runAttempt);
    const cacheKey = `${repository}:${runId}:${runAttempt ?? "latest"}`;
    if (!workflowRunCache.has(cacheKey)) {
      workflowRunCache.set(
        cacheKey,
        readWorkflowRunSource(repository, runId, runAttempt),
      );
    }
    return workflowRunCache.get(cacheKey);
  };
  const cachedForcePushCommitEvidence = (repository, sha) => {
    const cacheKey = `${repository}:${exactSha(sha)}`;
    if (!forcePushCommitEvidenceCache.has(cacheKey)) {
      forcePushCommitEvidenceCache.set(
        cacheKey,
        request("GET", `/repos/${repository}/commits/${sha}`).then(({ data }) =>
          normalizedCommitEvidence(data),
        ),
      );
    }
    return forcePushCommitEvidenceCache.get(cacheKey);
  };

  const getChecks = async (repository, sha) => {
    exactSha(sha);
    const receiptRunIdentity = (check) => {
      const pattern =
        check.name === PROCESSOR_CHECK_NAME
          ? PROCESSOR_REPAIR_RECEIPT_PATTERN
          : check.name === REFRESH_CHECK_NAME
            ? REFRESH_RECEIPT_PATTERN
            : check.name === REPAIR_CHECK_NAME
              ? REPAIR_RECEIPT_PATTERN
              : check.name === ALL_CLEAR_CHECK_NAME
                ? ALL_CLEAR_RECEIPT_PATTERN
                : check.name === POST_MERGE_CHECK_NAME
                  ? POST_MERGE_EXTERNAL_ID_PATTERN
                  : check.name === "claude-review"
                    ? CLAUDE_REVIEW_EXTERNAL_ID_PATTERN
                    : null;
      const external = pattern?.exec(String(check.externalId ?? ""));
      if (!external) return null;
      if (check.name === POST_MERGE_CHECK_NAME) {
        return { runAttempt: Number(external[2]), runId: Number(external[1]) };
      }
      if (check.name === "claude-review") {
        return { runAttempt: Number(external[4]), runId: Number(external[3]) };
      }
      return {
        runAttempt: Number(external.at(-1)),
        runId: Number(external.at(-2)),
      };
    };
    const workflowRunSource = async (
      url,
      check = {},
      { fresh = false } = {},
    ) => {
      const match = /\/actions\/runs\/([1-9][0-9]*)/.exec(String(url ?? ""));
      const externalReceipt = receiptRunIdentity(check);
      const exactReceiptSelfUrl =
        externalReceipt !== null &&
        Number.isSafeInteger(check.id) &&
        check.id > 0 &&
        url === `https://github.com/${repository}/runs/${check.id}`;
      if (!match && !exactReceiptSelfUrl) return null;
      const runId = Number(match?.[1] ?? externalReceipt?.runId);
      if (!Number.isSafeInteger(runId) || runId < 1) return null;
      const latest = await cachedWorkflowRunSource(repository, runId, null, {
        fresh,
      });
      const recordedAttempt =
        externalReceipt?.runId === runId &&
        Number.isSafeInteger(externalReceipt.runAttempt) &&
        externalReceipt.runAttempt > 0
          ? externalReceipt.runAttempt
          : null;
      if (recordedAttempt === null || latest.runAttempt === recordedAttempt) {
        return latest;
      }
      const recorded = await cachedWorkflowRunSource(
        repository,
        runId,
        recordedAttempt,
      );
      invariant(
        recorded.runId === runId && recorded.runAttempt === recordedAttempt,
        `GitHub workflow run ${runId} attempt ${recordedAttempt} response is invalid`,
      );
      return recorded;
    };
    const rawCheckRuns = [];
    let page = 1;
    while (page <= 20) {
      const response = await request(
        "GET",
        `/repos/${repository}/commits/${sha}/check-runs?filter=all&per_page=100&page=${page}`,
      );
      const runs = response.data?.check_runs;
      invariant(Array.isArray(runs), "GitHub check-runs response is invalid");
      rawCheckRuns.push(...runs);
      if (runs.length < 100) break;
      page += 1;
    }
    invariant(page <= 20, "GitHub check-run pagination limit exceeded");
    const newestPostMergeCheck = selectLatestExactHeadCheck(
      rawCheckRuns,
      sha,
      POST_MERGE_CHECK_DEFINITION,
    );
    const enrichCheckRun = async (run) => {
      const isPostMergeCheck = run.name === POST_MERGE_CHECK_NAME;
      const isSelectedPostMergeCheck =
        isPostMergeCheck &&
        run.head_sha === sha &&
        Number(run.id) === newestPostMergeCheck?.id;
      const requiresWorkflowSource = checkNameRequiresWorkflowSource(
        run.name,
        "check",
      );
      const source =
        requiresWorkflowSource &&
        (!isPostMergeCheck || isSelectedPostMergeCheck)
          ? await workflowRunSource(
              run.details_url,
              {
                externalId: run.external_id,
                id: Number(run.id),
                name: run.name,
              },
              {
                fresh: isSelectedPostMergeCheck,
              },
            )
          : null;
      return {
        ...source,
        appId: run.app?.id,
        completedAt: run.completed_at,
        conclusion: run.conclusion,
        detailsUrl: run.details_url,
        externalId: run.external_id,
        headSha: run.head_sha,
        id: run.id,
        name: run.name,
        outputSummary: run.output?.summary ?? null,
        outputText: run.output?.text ?? null,
        startedAt: run.started_at,
        status: run.status,
        kind: "check",
      };
    };
    const mapWithSourceResolutionLimit = async (items, mapper) => {
      const resolved = [];
      for (
        let index = 0;
        index < items.length;
        index += CHECK_SOURCE_RESOLUTION_CONCURRENCY
      ) {
        resolved.push(
          ...(await Promise.all(
            items
              .slice(index, index + CHECK_SOURCE_RESOLUTION_CONCURRENCY)
              .map(mapper),
          )),
        );
      }
      return resolved;
    };
    const checkRuns = await mapWithSourceResolutionLimit(
      rawCheckRuns,
      enrichCheckRun,
    );
    const statuses = await paginate(
      `/repos/${repository}/commits/${sha}/statuses`,
    );
    return [
      ...checkRuns,
      ...(await mapWithSourceResolutionLimit(statuses, async (status) => ({
        ...(checkNameRequiresWorkflowSource(status.context, "status")
          ? await workflowRunSource(status.target_url)
          : null),
        creatorLogin: status.creator?.login,
        conclusion: status.state,
        description: status.description,
        detailsUrl: status.target_url,
        headSha: sha,
        id: status.id,
        name: status.context,
        kind: "status",
        status: PENDING_STATUSES.has(status.state) ? status.state : "completed",
        updatedAt: status.updated_at,
      }))),
    ];
  };

  const getProcessorChecks = async (repository, sha) => {
    exactSha(sha);
    return (await getChecks(repository, sha)).filter(
      ({ kind, name }) =>
        kind === "check" &&
        new Set([
          PROCESSOR_CHECK_NAME,
          REFRESH_CHECK_NAME,
          REPAIR_CHECK_NAME,
        ]).has(name),
    );
  };

  const getFeedback = async (repository, number) => {
    const { name, owner } = splitRepository(repository);
    const query = `
      query DependabotProcessorFeedback($owner: String!, $name: String!, $number: Int!, $after: String) {
        repository(owner: $owner, name: $name) {
          pullRequest(number: $number) {
            id
            headRefOid
            updatedAt
            isDraft
            mergeable
            mergeStateStatus
            reviewDecision
            autoMergeRequest { enabledAt }
            reviewThreads(first: 100, after: $after) {
              nodes {
                id
                isResolved
                isOutdated
                line
                path
                comments(first: 100) {
                  totalCount
                  nodes {
                    databaseId
                    author { __typename login }
                    authorAssociation
                    body
                    createdAt
                    replyTo { databaseId }
                    pullRequestReview {
                      databaseId
                      commit { oid }
                    }
                  }
                  pageInfo { hasNextPage }
                }
              }
              pageInfo { hasNextPage endCursor }
            }
          }
        }
      }
    `;
    let after = null;
    let pullRequest = null;
    const threads = [];
    let threadPagesTruncated = false;
    let threadQueryHead = null;
    let threadQueryUpdatedAt = null;
    for (let page = 0; page < REVIEW_THREAD_PAGE_LIMIT; page += 1) {
      const data = await graphql(query, { after, name, number, owner });
      pullRequest = data.repository?.pullRequest;
      invariant(pullRequest, `PR #${number} was not found`);
      if (threadQueryHead === null) {
        threadQueryHead = pullRequest.headRefOid;
        threadQueryUpdatedAt = pullRequest.updatedAt;
      } else {
        snapshotInvariant(
          pullRequest.headRefOid === threadQueryHead &&
            pullRequest.updatedAt === threadQueryUpdatedAt,
          `PR #${number} feedback changed during thread pagination`,
        );
      }
      invariant(
        Array.isArray(pullRequest.reviewThreads?.nodes),
        "GitHub review thread response is invalid",
      );
      threads.push(
        ...pullRequest.reviewThreads.nodes.map((thread) => {
          const comments = thread?.comments?.nodes;
          invariant(
            Array.isArray(comments),
            "GitHub review thread comments response is invalid",
          );
          const totalCount = Number(thread.comments.totalCount);
          const commentsTruncated =
            !Number.isInteger(totalCount) ||
            totalCount < 0 ||
            totalCount > REVIEW_THREAD_COMMENT_LIMIT ||
            totalCount !== comments.length ||
            thread.comments.pageInfo?.hasNextPage === true;
          return {
            comments: comments.map((comment) => ({
              actor: {
                association: comment.authorAssociation,
                login: comment.author?.login,
                type: comment.author?.__typename,
              },
              body: comment.body,
              createdAt: comment.createdAt,
              id: comment.databaseId,
              replyToId: comment.replyTo?.databaseId ?? null,
              reviewCommitSha: comment.pullRequestReview?.commit?.oid ?? null,
              reviewId: comment.pullRequestReview?.databaseId ?? null,
            })),
            commentsTruncated,
            id: thread.id,
            line:
              Number.isSafeInteger(thread.line) && thread.line > 0
                ? thread.line
                : null,
            outdated: thread.isOutdated === true,
            path: typeof thread.path === "string" ? thread.path : null,
            resolved: thread.isResolved === true,
          };
        }),
      );
      if (!pullRequest.reviewThreads.pageInfo.hasNextPage) break;
      if (page === REVIEW_THREAD_PAGE_LIMIT - 1) {
        threadPagesTruncated = true;
        break;
      }
      after = pullRequest.reviewThreads.pageInfo.endCursor;
    }
    const [rawReviews, rawIssueComments] = await Promise.all([
      paginate(`/repos/${repository}/pulls/${number}/reviews`),
      paginate(`/repos/${repository}/issues/${number}/comments`),
    ]);
    const reviews = rawReviews.map((review) => ({
      actor: {
        association: review.author_association,
        login: review.user?.login,
        type: review.user?.type,
      },
      body: review.body,
      commitSha: review.commit_id,
      id: review.id,
      state: review.state,
    }));
    const issueComments = rawIssueComments.map((comment) => ({
      actor: {
        association: comment.author_association,
        login: comment.user?.login,
        type: comment.user?.type,
      },
      body: comment.body,
      createdAt: comment.created_at,
      id: comment.id,
      updatedAt: comment.updated_at,
    }));
    const classification = classifyDependabotFeedback({
      headSha: pullRequest.headRefOid,
      issueComments,
      reviews,
      threadPagesTruncated,
      threads,
    });
    const digest = feedbackBodyDigest(
      stableJson({
        autoMergeEnabled: Boolean(pullRequest.autoMergeRequest),
        headSha: pullRequest.headRefOid,
        issueComments: issueComments.map((comment) => ({
          ...comment,
          body: feedbackBodyDigest(comment.body),
        })),
        reviewDecision: pullRequest.reviewDecision,
        reviews: reviews.map((review) => ({
          ...review,
          body: feedbackBodyDigest(review.body),
        })),
        threadPagesTruncated,
        threads: threads.map((thread) => ({
          ...thread,
          comments: thread.comments.map((comment) => ({
            ...comment,
            body: feedbackBodyDigest(comment.body),
          })),
        })),
        updatedAt: pullRequest.updatedAt,
      }),
    );
    return {
      ...classification,
      autoMergeEnabled: Boolean(pullRequest.autoMergeRequest),
      digest,
      headSha: pullRequest.headRefOid,
      isDraft: pullRequest.isDraft,
      mergeable:
        pullRequest.mergeable === "MERGEABLE"
          ? true
          : pullRequest.mergeable === "CONFLICTING"
            ? false
            : null,
      mergeStateStatus: pullRequest.mergeStateStatus,
      nodeId: pullRequest.id,
      reviewDecision: pullRequest.reviewDecision,
      updatedAt: pullRequest.updatedAt,
    };
  };

  const getPullRequest = async (repository, number) => {
    const response = await request(
      "GET",
      `/repos/${repository}/pulls/${number}`,
    );
    return response.data;
  };

  const getCurrentBaseAncestry = async ({ baseRef, headSha, repository }) => {
    const currentBase = await request(
      "GET",
      `/repos/${repository}/commits/${encodeURIComponent(baseRef)}`,
    );
    const currentBaseSha = exactSha(currentBase.data.sha, "Current base SHA");
    const comparison = await request(
      "GET",
      `/repos/${repository}/compare/${currentBaseSha}...${exactSha(headSha, "Compared head SHA")}`,
    );
    const aheadBy = Number(comparison.data?.ahead_by);
    const behindBy = Number(comparison.data?.behind_by);
    const baseCommitSha = comparison.data?.base_commit?.sha ?? null;
    const mergeBaseSha = comparison.data?.merge_base_commit?.sha ?? null;
    const status = String(comparison.data?.status ?? "").toLowerCase();
    invariant(
      Number.isSafeInteger(aheadBy) &&
        aheadBy >= 0 &&
        Number.isSafeInteger(behindBy) &&
        behindBy >= 0 &&
        SHA_PATTERN.test(baseCommitSha ?? "") &&
        SHA_PATTERN.test(mergeBaseSha ?? "") &&
        new Set(["ahead", "behind", "diverged", "identical"]).has(status),
      "GitHub base comparison response is invalid",
    );
    return {
      aheadBy,
      baseCommitSha,
      behindBy,
      currentBaseIsAncestor:
        baseCommitSha === currentBaseSha &&
        mergeBaseSha === currentBaseSha &&
        behindBy === 0 &&
        new Set(["ahead", "identical"]).has(status),
      currentBaseSha,
      headSha,
      mergeBaseSha,
      status,
    };
  };

  const getHumanCloseEvidence = async (repository, number) => {
    const { name, owner } = splitRepository(repository);
    const forcePushQuery = `
      query DependabotForcePushHistory($owner: String!, $name: String!, $number: Int!, $limit: Int!) {
        repository(owner: $owner, name: $name) {
          pullRequest(number: $number) {
            timelineItems(first: $limit, itemTypes: [HEAD_REF_FORCE_PUSHED_EVENT]) {
              nodes {
                ... on HeadRefForcePushedEvent {
                  id
                  createdAt
                  actor {
                    __typename
                    login
                    ... on Bot { databaseId }
                  }
                  beforeCommit { oid }
                  afterCommit { oid }
                  ref { name prefix }
                }
              }
              pageInfo { hasNextPage }
            }
          }
        }
      }
    `;
    const [events, forcePushData] = await Promise.all([
      paginate(`/repos/${repository}/issues/${number}/events`),
      graphql(forcePushQuery, {
        limit: DURABLE_EVENT_EVIDENCE_LIMIT,
        name,
        number,
        owner,
      }),
    ]);
    const actorsForEvent = (eventName) =>
      events
        .filter(
          (event) =>
            event?.event === eventName &&
            normalizeLogin(event?.actor?.login) !== DEPENDABOT_LOGIN,
        )
        .map((event) => normalizeLogin(event?.actor?.login) || "unknown-actor")
        .filter((login, index, logins) => logins.indexOf(login) === index)
        .sort();
    const humanCloseActors = actorsForEvent("closed");
    const humanReopenActors = actorsForEvent("reopened");
    const timeline =
      forcePushData.repository?.pullRequest?.timelineItems ?? null;
    invariant(
      timeline !== null &&
        Array.isArray(timeline.nodes) &&
        typeof timeline.pageInfo?.hasNextPage === "boolean",
      "GitHub force-push timeline response is invalid",
    );
    const forcePushEvents = timeline.nodes.map((event) => ({
      actorId:
        Number.isSafeInteger(event?.actor?.databaseId) &&
        event.actor.databaseId > 0
          ? event.actor.databaseId
          : null,
      actorLogin:
        typeof event?.actor?.login === "string"
          ? event.actor.login.toLowerCase()
          : null,
      actorType: String(event?.actor?.__typename ?? "") || null,
      afterSha: SHA_PATTERN.test(event?.afterCommit?.oid ?? "")
        ? event.afterCommit.oid
        : null,
      beforeSha: SHA_PATTERN.test(event?.beforeCommit?.oid ?? "")
        ? event.beforeCommit.oid
        : null,
      createdAt: String(event?.createdAt ?? "") || null,
      eventId: String(event?.id ?? "") || null,
      headRef:
        typeof event?.ref?.prefix === "string" &&
        typeof event?.ref?.name === "string"
          ? `${event.ref.prefix}${event.ref.name}`
          : null,
    }));
    const forcePushEventsComplete =
      timeline.pageInfo.hasNextPage === false &&
      forcePushEvents.length <= DURABLE_EVENT_EVIDENCE_LIMIT;
    const forcePushEventCount =
      forcePushEvents.length + (timeline.pageInfo.hasNextPage ? 1 : 0);
    const forcePushActors = [
      ...new Set(
        forcePushEvents.map((event) =>
          (normalizeLogin(event.actorLogin) || "unknown-actor").slice(0, 100),
        ),
      ),
    ]
      .sort()
      .slice(0, DURABLE_EVENT_EVIDENCE_LIMIT);
    const forcePushCommitIds = [
      ...new Set(
        forcePushEvents
          .map((event) => event.afterSha)
          .filter((commitId) => SHA_PATTERN.test(commitId ?? "")),
      ),
    ]
      .sort()
      .slice(0, DURABLE_EVENT_EVIDENCE_LIMIT);
    const nativeCommitShas = [
      ...new Set(
        forcePushEvents.flatMap(({ afterSha, beforeSha }) => [
          beforeSha,
          afterSha,
        ]),
      ),
    ].filter((sha) => SHA_PATTERN.test(sha ?? ""));
    const forcePushActorsExact = forcePushEvents.every(
      ({ actorId, actorLogin, actorType }) =>
        actorId === DEPENDABOT_USER_ID &&
        actorLogin === "dependabot" &&
        actorType === "Bot",
    );
    const forcePushCommits = [];
    if (
      forcePushEventsComplete &&
      forcePushEvents.length > 0 &&
      forcePushActorsExact &&
      nativeCommitShas.length <= DURABLE_EVENT_EVIDENCE_LIMIT + 1
    ) {
      for (
        let index = 0;
        index < nativeCommitShas.length;
        index += CHECK_SOURCE_RESOLUTION_CONCURRENCY
      ) {
        const batch = await Promise.all(
          nativeCommitShas
            .slice(index, index + CHECK_SOURCE_RESOLUTION_CONCURRENCY)
            .map((sha) => cachedForcePushCommitEvidence(repository, sha)),
        );
        forcePushCommits.push(...batch);
      }
      forcePushCommits.sort((left, right) =>
        String(left.sha).localeCompare(String(right.sha)),
      );
    }
    return {
      forcePushActors,
      forcePushCommitIds,
      forcePushCommits,
      forcePushEventCount,
      forcePushEvents,
      forcePushEventsComplete,
      forcePushed: forcePushEventCount > 0,
      humanCloseActors,
      humanClosed: humanCloseActors.length > 0,
      humanIntervened:
        humanCloseActors.length > 0 || humanReopenActors.length > 0,
      humanReopenActors,
      humanReopened: humanReopenActors.length > 0,
    };
  };

  const listOpenDependabotPullRequests = async (repository) => {
    const pulls = (
      await paginate(`/repos/${repository}/pulls?state=open`)
    ).filter(
      (pullRequest) =>
        normalizeLogin(pullRequest.user?.login) === DEPENDABOT_LOGIN,
    );
    invariant(
      pulls.length <= PROCESSOR_APPROVAL_PULL_LIMIT,
      "Repository-wide processor approval PR limit exceeded",
    );
    const normalized = pulls
      .map((pullRequest) => ({
        headSha: exactSha(
          pullRequest.head?.sha,
          "Repository-wide approval PR head SHA",
        ),
        nodeId: pullRequest.node_id,
        pullRequestNumber: pullRequestNumber(pullRequest.number),
        updatedAt: pullRequest.updated_at,
      }))
      .sort((left, right) => left.pullRequestNumber - right.pullRequestNumber);
    invariant(
      normalized.every(
        ({ nodeId, updatedAt }) =>
          typeof nodeId === "string" &&
          nodeId.length > 0 &&
          typeof updatedAt === "string" &&
          updatedAt.length > 0,
      ) &&
        new Set(normalized.map(({ pullRequestNumber: number }) => number))
          .size === normalized.length,
      "Repository-wide processor approval PR evidence is invalid",
    );
    return normalized;
  };

  const collectOutstandingDependabotProcessorApprovals = async (repository) => {
    const initialPullRequests =
      await listOpenDependabotPullRequests(repository);
    const approvals = [];
    const seenReviewIds = new Set();
    for (
      let index = 0;
      index < initialPullRequests.length;
      index += PROCESSOR_APPROVAL_SCAN_CONCURRENCY
    ) {
      const scans = await Promise.all(
        initialPullRequests
          .slice(index, index + PROCESSOR_APPROVAL_SCAN_CONCURRENCY)
          .map(async (summary) => {
            const number = summary.pullRequestNumber;
            const initial = await getPullRequest(repository, number);
            snapshotInvariant(
              normalizeLogin(initial.user?.login) === DEPENDABOT_LOGIN &&
                initial.state === "open" &&
                initial.node_id === summary.nodeId &&
                initial.head?.sha === summary.headSha &&
                initial.updated_at === summary.updatedAt,
              `PR #${number} changed before repository-wide approval collection`,
            );
            const reviews = await paginate(
              `/repos/${repository}/pulls/${number}/reviews`,
            );
            invariant(
              reviews.length < PROCESSOR_APPROVAL_REVIEW_LIMIT,
              `PR #${number} processor approval review limit exceeded`,
            );
            const final = await getPullRequest(repository, number);
            requireStablePullRequestSnapshot(initial, final, number);
            return { headSha: final.head.sha, number, reviews };
          }),
      );
      for (const { headSha, number, reviews } of scans) {
        for (const review of reviews) {
          const reviewId = review?.id;
          const state = String(review?.state ?? "").toUpperCase();
          const actorLogin = normalizeFeedbackLogin(review?.user?.login);
          const actorType = review?.user?.type;
          invariant(
            Number.isSafeInteger(reviewId) &&
              reviewId > 0 &&
              !seenReviewIds.has(reviewId) &&
              actorLogin.length > 0 &&
              actorLogin.length <= 100 &&
              (actorType === "Bot" || actorType === "User") &&
              SHA_PATTERN.test(review?.commit_id ?? "") &&
              PULL_REQUEST_REVIEW_STATES.has(state) &&
              (review?.body === null || typeof review?.body === "string"),
            `PR #${number} review evidence is malformed`,
          );
          seenReviewIds.add(reviewId);
          const body = review.body ?? "";
          const approved = state === "APPROVED";
          const claimsProcessor = body.includes(DEPENDABOT_PROCESSOR_SCHEMA);
          if (!approved && !claimsProcessor) continue;
          if (approved) {
            invariant(
              actorLogin !== "github-actions" || actorType === "Bot",
              `PR #${number} approved review evidence is malformed`,
            );
          }
          const actionsApproval =
            approved &&
            actorLogin === "github-actions" &&
            review.commit_id === headSha;
          if (!actionsApproval && !claimsProcessor) continue;
          const binding = processorApprovalBinding({
            body,
            commitSha: review?.commit_id,
          });
          invariant(
            body.length <= REVIEW_ENVELOPE_BODY_LIMIT &&
              actorLogin === "github-actions" &&
              actorType === "Bot" &&
              binding !== null &&
              (state === "APPROVED" || state === "DISMISSED"),
            `PR #${number} processor approval evidence is malformed`,
          );
          if (state === "APPROVED" && binding === headSha) {
            approvals.push({
              approvalId: reviewId,
              headSha,
              pullRequestNumber: number,
            });
            invariant(
              approvals.length <= PROCESSOR_APPROVAL_RESULT_LIMIT,
              "Repository-wide processor approval result limit exceeded",
            );
          }
        }
      }
    }
    const finalPullRequests = await listOpenDependabotPullRequests(repository);
    snapshotInvariant(
      stableJson(initialPullRequests) === stableJson(finalPullRequests),
      "Repository-wide processor approval PR set changed during collection",
    );
    return approvals.sort(
      (left, right) =>
        left.pullRequestNumber - right.pullRequestNumber ||
        left.approvalId - right.approvalId,
    );
  };

  const getOutstandingDependabotProcessorApprovals = async (repository) => {
    for (
      let attempt = 1;
      attempt <= PROCESSOR_APPROVAL_SNAPSHOT_ATTEMPTS;
      attempt += 1
    ) {
      try {
        return await collectOutstandingDependabotProcessorApprovals(repository);
      } catch (error) {
        if (
          !(error instanceof PullRequestSnapshotChangedError) ||
          attempt === PROCESSOR_APPROVAL_SNAPSHOT_ATTEMPTS
        ) {
          throw error;
        }
      }
    }
    throw new Error("Repository-wide processor approval collection exhausted");
  };

  const getOutstandingDependabotAutoMergeRequests = async (repository) => {
    const { name, owner } = splitRepository(repository);
    const query = `
      query DependabotProcessorAutoMergeRequests($owner: String!, $name: String!, $after: String) {
        repository(owner: $owner, name: $name) {
          pullRequests(states: OPEN, first: 100, after: $after, orderBy: {field: CREATED_AT, direction: ASC}) {
            nodes {
              id
              number
              headRefOid
              author { login }
              autoMergeRequest {
                enabledAt
              }
            }
            pageInfo { hasNextPage endCursor }
          }
        }
      }
    `;
    const requests = [];
    let after = null;
    for (let page = 0; page < 20; page += 1) {
      const data = await graphql(query, { after, name, owner });
      const connection = data.repository?.pullRequests;
      invariant(
        Array.isArray(connection?.nodes),
        "GitHub auto-merge request response is invalid",
      );
      for (const pullRequest of connection.nodes) {
        if (
          normalizeLogin(pullRequest.author?.login) === DEPENDABOT_LOGIN &&
          pullRequest.autoMergeRequest
        ) {
          requests.push({
            enabledAt: pullRequest.autoMergeRequest.enabledAt,
            headSha: pullRequest.headRefOid,
            nodeId: pullRequest.id,
            pullRequestNumber: pullRequest.number,
          });
        }
      }
      if (!connection.pageInfo?.hasNextPage) return requests;
      after = connection.pageInfo.endCursor;
      invariant(
        typeof after === "string" && after.length > 0,
        "GitHub auto-merge pagination cursor is invalid",
      );
    }
    throw new Error("GitHub auto-merge request pagination limit exceeded");
  };

  const getExpectedBlobs = async (repository, headSha, paths) => {
    const response = await request(
      "GET",
      `/repos/${repository}/git/trees/${exactSha(headSha)}?recursive=1`,
    );
    invariant(
      response.data?.truncated === false && Array.isArray(response.data?.tree),
      "GitHub head tree response is incomplete",
    );
    const byPath = new Map();
    for (const entry of response.data.tree) {
      if (byPath.has(entry.path)) {
        throw new Error("GitHub head tree contains duplicate paths");
      }
      byPath.set(entry.path, entry);
    }
    return paths.map((value) => {
      const path = typeof value === "string" ? value : value?.filename;
      const entry = byPath.get(path);
      return {
        mode: entry?.mode ?? null,
        path,
        sha: entry?.sha ?? null,
        type: entry?.type ?? null,
      };
    });
  };

  const getBoundJsonBlob = async (repository, expectedBlob) => {
    snapshotInvariant(
      expectedBlob?.type === "blob" &&
        expectedBlob.mode === "100644" &&
        SHA_PATTERN.test(expectedBlob.sha ?? ""),
      `Protected runtime input ${expectedBlob?.path ?? "unknown"} is missing from the exact head`,
    );
    const response = await request(
      "GET",
      `/repos/${repository}/git/blobs/${expectedBlob.sha}`,
    );
    const data = response.data;
    snapshotInvariant(
      data?.encoding === "base64" &&
        typeof data.content === "string" &&
        Number.isSafeInteger(data.size) &&
        data.size >= 0 &&
        data.size <= PROTECTED_RUNTIME_BLOB_LIMIT,
      `Protected runtime input ${expectedBlob.path} exceeds its bounded Git blob contract`,
    );
    const decoded = Buffer.from(data.content.replaceAll(/\s/g, ""), "base64");
    snapshotInvariant(
      decoded.length === data.size,
      `Protected runtime input ${expectedBlob.path} has inconsistent Git blob bytes`,
    );
    try {
      const value = JSON.parse(decoded.toString("utf8"));
      snapshotInvariant(
        value !== null && typeof value === "object" && !Array.isArray(value),
        `Protected runtime input ${expectedBlob.path} is not a JSON object`,
      );
      return value;
    } catch (error) {
      if (error instanceof PullRequestSnapshotChangedError) throw error;
      throw new PullRequestSnapshotChangedError(
        `Protected runtime input ${expectedBlob.path} is not valid JSON`,
      );
    }
  };

  const getProtectedRuntimeSnapshot = async (repository, expectedBlobs) => {
    const byPath = new Map(
      expectedBlobs.map((expectedBlob) => [expectedBlob.path, expectedBlob]),
    );
    const completeInputSet =
      byPath.size === VERCEL_CLI_RUNTIME_INPUT_PATHS.length &&
      VERCEL_CLI_RUNTIME_INPUT_PATHS.every((path) => {
        const expectedBlob = byPath.get(path);
        return (
          expectedBlob?.type === "blob" &&
          expectedBlob.mode === "100644" &&
          SHA_PATTERN.test(expectedBlob.sha ?? "")
        );
      });
    if (!completeInputSet) return null;
    const [rootPackage, runtimePackage, contract] = await Promise.all([
      getBoundJsonBlob(repository, byPath.get("package.json")),
      getBoundJsonBlob(
        repository,
        byPath.get("scripts/vercel-cli-runtime/package.json"),
      ),
      getBoundJsonBlob(
        repository,
        byPath.get("scripts/vercel-cli-runtime/contract.json"),
      ),
    ]);
    return {
      contractSchema: contract.schema ?? null,
      contractVersion: contract.vercelVersion ?? null,
      pnpmVersion:
        /^pnpm@(.+)$/.exec(String(rootPackage.packageManager ?? ""))?.[1] ??
        null,
      rootVersion: rootPackage.devDependencies?.vercel ?? null,
      runtimeVersion: runtimePackage.dependencies?.vercel ?? null,
    };
  };

  const collectPullRequestSnapshot = async (repository, number) => {
    const raw = await getPullRequest(repository, number);
    const [files, commits, initialFeedback] = await Promise.all([
      paginate(`/repos/${repository}/pulls/${number}/files`),
      paginate(`/repos/${repository}/pulls/${number}/commits`),
      getFeedback(repository, number),
    ]);
    const headSha = exactSha(raw.head.sha, "PR head SHA");
    snapshotInvariant(
      initialFeedback.headSha === headSha,
      `PR #${number} changed while feedback was collected`,
    );
    const preliminaryMetadata = deriveImmutableDependabotMetadata({
      commits,
      files,
      headRef: raw.head.ref,
      headSha,
    });
    const protectedRuntimeCandidate =
      vercelCliRuntimeOperationFromMetadata(preliminaryMetadata);
    const expectedBlobPaths =
      protectedRuntimeCandidate?.eligible === true
        ? VERCEL_CLI_RUNTIME_INPUT_PATHS
        : files;
    const [baseAncestry, expectedBlobs] = await Promise.all([
      getCurrentBaseAncestry({
        baseRef: raw.base.ref,
        headSha,
        repository,
      }),
      getExpectedBlobs(repository, headSha, expectedBlobPaths),
    ]);
    const collectionBase = evaluateCurrentBaseGate({
      ancestry: baseAncestry,
      baselineSha: baseAncestry.currentBaseSha,
      pullRequest: normalizePullRequest(raw),
    });
    const protectedRuntime =
      protectedRuntimeCandidate?.eligible === true && collectionBase.current
        ? await getProtectedRuntimeSnapshot(repository, expectedBlobs)
        : null;
    const baselineSha = baseAncestry.currentBaseSha;
    const commitHeadShas = [
      ...new Set(
        commits.map((commit) => exactSha(commit?.sha, "PR lineage commit SHA")),
      ),
    ];
    const commitsByHeadSha = new Map(
      commits.map((commit) => [commit.sha, commit]),
    );
    const lineageCommits = commitHeadShas.map((commitHeadSha) =>
      commitsByHeadSha.get(commitHeadSha),
    );
    invariant(
      commitHeadShas.length <= REPAIR_LINEAGE_COMMIT_LIMIT,
      "Dependabot repair lineage commit limit exceeded",
    );
    const repairHistoryCheckPages = [];
    const collectRepairHistory = async () => {
      for (
        let index = 0;
        index < commitHeadShas.length;
        index += REPAIR_LINEAGE_CHECK_CONCURRENCY
      ) {
        repairHistoryCheckPages.push(
          ...(await Promise.all(
            commitHeadShas
              .slice(index, index + REPAIR_LINEAGE_CHECK_CONCURRENCY)
              .map((commitHeadSha) =>
                getProcessorChecks(repository, commitHeadSha),
              ),
          )),
        );
      }
    };
    const [checks, baselineChecks] = await Promise.all([
      getChecks(repository, headSha),
      getChecks(repository, baselineSha),
      collectRepairHistory(),
    ]);
    const humanCloseEvidence = await getHumanCloseEvidence(repository, number);
    const feedback = await getFeedback(repository, number);
    requireStableFeedbackSnapshot(initialFeedback, feedback, number);
    const finalRaw = await getPullRequest(repository, number);
    requireStablePullRequestSnapshot(raw, finalRaw, number);
    const pullRequest = {
      author: {
        id: finalRaw.user?.id ?? null,
        login: finalRaw.user?.login,
        type: finalRaw.user?.type,
      },
      base: {
        ref: finalRaw.base.ref,
        repo: { fullName: finalRaw.base.repo?.full_name },
        sha: finalRaw.base.sha,
      },
      body: finalRaw.body ?? "",
      draft: finalRaw.draft,
      files: files.map((file) => {
        const expectedBlob = expectedBlobs.find(
          ({ path }) => path === file.filename,
        );
        return {
          additions: file.additions,
          changes: file.changes,
          deletions: file.deletions,
          filename: file.filename,
          mode: expectedBlob?.mode ?? null,
          sha: expectedBlob?.sha ?? null,
          status: file.status,
          type: expectedBlob?.type ?? null,
        };
      }),
      head: {
        ref: finalRaw.head.ref,
        repo: { fullName: finalRaw.head.repo?.full_name },
        sha: headSha,
      },
      isCrossRepository:
        finalRaw.head.repo?.full_name !== finalRaw.base.repo?.full_name,
      labels: finalRaw.labels,
      mergeable: feedback.mergeable ?? finalRaw.mergeable ?? null,
      mergeStateStatus:
        feedback.mergeStateStatus ?? finalRaw.mergeable_state ?? null,
      merge_commit_sha: finalRaw.merge_commit_sha,
      merged: finalRaw.merged,
      node_id: feedback.nodeId ?? finalRaw.node_id,
      number: finalRaw.number,
      reviewDecision: feedback.reviewDecision ?? null,
      state: finalRaw.state,
      title: finalRaw.title,
      updated_at: finalRaw.updated_at,
    };
    const metadata = preliminaryMetadata;
    return {
      baseAncestry,
      baseline: { checks: baselineChecks, sha: baselineSha },
      checks,
      commits: lineageCommits.map(normalizedCommitEvidence),
      expectedBlobs,
      expectedHeadSha: headSha,
      feedback: {
        actionableThreadCount: feedback.actionableThreadCount,
        actionableThreads: feedback.actionableThreads,
        autoMergeEnabled: feedback.autoMergeEnabled,
        blockerCount: feedback.blockerCount,
        blockers: feedback.blockers,
        complete: feedback.complete,
        currentProcessorApprovalCount: feedback.currentProcessorApprovalCount,
        currentProcessorApprovalIds: feedback.currentProcessorApprovalIds,
        digest: feedback.digest,
        dismissedProcessorApprovalCount:
          feedback.dismissedProcessorApprovalCount,
        forcePushActors: humanCloseEvidence.forcePushActors,
        forcePushCommitIds: humanCloseEvidence.forcePushCommitIds,
        forcePushCommits: humanCloseEvidence.forcePushCommits,
        forcePushEventCount: humanCloseEvidence.forcePushEventCount,
        forcePushEvents: humanCloseEvidence.forcePushEvents,
        forcePushEventsComplete: humanCloseEvidence.forcePushEventsComplete,
        forcePushed: humanCloseEvidence.forcePushed,
        humanCloseActors: humanCloseEvidence.humanCloseActors,
        humanClosed: humanCloseEvidence.humanClosed,
        humanIntervened: humanCloseEvidence.humanIntervened,
        humanReopenActors: humanCloseEvidence.humanReopenActors,
        humanReopened: humanCloseEvidence.humanReopened,
        historicalProcessorApprovalCount:
          feedback.historicalProcessorApprovalCount,
        issueCommentCount: feedback.issueCommentCount,
        labels: normalizeLabels(finalRaw.labels),
        maintainerVeto:
          humanCloseEvidence.humanIntervened || humanCloseEvidence.forcePushed,
        mergeable: feedback.mergeable,
        mergeStateStatus: feedback.mergeStateStatus,
        remediationCandidates: feedback.remediationCandidates,
        reasons: feedback.reasons,
        reviewDecision: feedback.reviewDecision,
        reviewCount: feedback.reviewCount,
        threadCount: feedback.threadCount,
        unresolvedThreads: feedback.unresolvedThreads,
        unrepliedThreads: feedback.unrepliedThreads,
        updatedAt: feedback.updatedAt,
      },
      metadata,
      protectedRuntime,
      prepareActor: validPrepareActor({
        prepareAppSlug: prepareActor.appSlug,
        prepareBotId: prepareActor.botId,
        prepareBotLogin: prepareActor.botLogin,
      })
        ? prepareActor
        : null,
      pullRequest,
      repairHistoryChecks: repairHistoryCheckPages.flat(),
      repository,
    };
  };

  const disablePullRequestAutoMerge = async ({
    headSha,
    nodeId,
    pullRequestNumber: number,
    repository,
  }) => {
    invariant(
      phase === "finalize",
      "Auto-merge cleanup requires finalize phase",
    );
    exactSha(headSha);
    pullRequestNumber(number);
    invariant(
      typeof nodeId === "string" &&
        nodeId.length > 0 &&
        nodeId.length <= 512 &&
        !/\s/.test(nodeId),
      "Pull request node ID is required to disable auto-merge",
    );
    const current = await getPullRequest(repository, number);
    invariant(current.state === "open", `PR #${number} is no longer open`);
    invariant(
      current.head?.sha === headSha,
      `PR #${number} head changed before auto-merge disable`,
    );
    invariant(
      current.node_id === nodeId,
      `PR #${number} node changed before auto-merge disable`,
    );
    const globalRequests =
      await getOutstandingDependabotAutoMergeRequests(repository);
    const globalState = outstandingAutoMergeState(
      { outstandingAutoMergeRequests: globalRequests },
      [],
    );
    invariant(
      !globalState.ambiguous &&
        globalState.requests.length === 1 &&
        globalState.requests[0].pullRequestNumber === number &&
        globalState.requests[0].headSha === headSha &&
        globalState.requests[0].nodeId === nodeId,
      `PR #${number} is not the current single repository auto-merge request`,
    );
    const mutation = `
      mutation DependabotProcessorDisableAutoMerge($pullRequestId: ID!) {
        disablePullRequestAutoMerge(input: {pullRequestId: $pullRequestId}) {
          pullRequest {
            id
            number
            state
            headRefOid
            autoMergeRequest { enabledAt }
          }
        }
      }
    `;
    const data = await graphql(mutation, { pullRequestId: nodeId });
    const disabled = data.disablePullRequestAutoMerge?.pullRequest;
    invariant(
      disabled?.id === nodeId &&
        disabled.number === number &&
        disabled.state === "OPEN" &&
        disabled.headRefOid === headSha &&
        disabled.autoMergeRequest == null,
      `PR #${number} changed while auto-merge was disabled`,
    );
    return { headSha, nodeId, pullRequestNumber: number };
  };

  const dismissPullRequestApproval = async ({
    approvalId,
    pullRequestNumber: number,
    repository,
  }) => {
    invariant(phase === "finalize", "Approval cleanup requires finalize phase");
    pullRequestNumber(number);
    invariant(
      Number.isSafeInteger(approvalId) && approvalId > 0,
      "Processor approval review ID must be a positive safe integer",
    );
    const current = await getPullRequest(repository, number);
    if (String(current.state ?? "").toLowerCase() !== "open") {
      return { dismissed: false, id: approvalId, state: current.state ?? null };
    }
    const reviewPath = `/repos/${repository}/pulls/${number}/reviews/${approvalId}`;
    const requireProcessorReview = (review) => {
      const state = String(review?.state ?? "").toUpperCase();
      const binding = processorApprovalBinding({
        body: review?.body,
        commitSha: review?.commit_id,
      });
      invariant(
        review?.id === approvalId &&
          normalizeFeedbackLogin(review?.user?.login) === "github-actions" &&
          review?.user?.type === "Bot" &&
          binding !== null &&
          (state === "APPROVED" || state === "DISMISSED"),
        `PR #${number} processor approval review is invalid`,
      );
      return state;
    };
    const initialReview = await request("GET", reviewPath);
    if (requireProcessorReview(initialReview.data) === "DISMISSED") {
      return { dismissed: true, id: approvalId, state: "DISMISSED" };
    }
    let response;
    try {
      response = await request("PUT", `${reviewPath}/dismissals`, {
        body: {
          event: "DISMISS",
          message:
            "Dependabot processor withdrew this approval after exact-snapshot revalidation failed.",
        },
      });
    } catch (error) {
      if (error?.status !== 404 && error?.status !== 422) throw error;
      const finalReview = await request("GET", reviewPath);
      invariant(
        requireProcessorReview(finalReview.data) === "DISMISSED",
        `PR #${number} processor approval remained active after dismissal conflict`,
      );
      return { dismissed: true, id: approvalId, state: "DISMISSED" };
    }
    invariant(
      requireProcessorReview(response.data) === "DISMISSED",
      `PR #${number} processor approval dismissal response is invalid`,
    );
    return { dismissed: true, id: approvalId, state: "DISMISSED" };
  };

  const publishCompletedCheck = async ({
    conclusion,
    detailsUrl,
    externalId,
    headSha,
    name,
    output,
    repository,
  }) => {
    invariant(
      detailsUrl === null || typeof detailsUrl === "string",
      `${name} publication requires an explicit authority URL or null`,
    );
    const response = await request("POST", `/repos/${repository}/check-runs`, {
      body: {
        conclusion,
        ...(detailsUrl === null ? {} : { details_url: detailsUrl }),
        external_id: externalId,
        head_sha: exactSha(headSha),
        name,
        output,
        status: "completed",
      },
    });
    invariant(
      Number.isSafeInteger(response.data?.id) && response.data.id > 0,
      `${name} publication did not return a check ID`,
    );
    return { id: response.data.id, url: response.data.html_url };
  };

  const capabilities = {
    approvePullRequest: async ({
      approvalSnapshot,
      headSha,
      pullRequestNumber: number,
      repository,
    }) => {
      invariant(phase === "finalize", "Approval requires finalize phase");
      const expected = approvalSnapshot?.pullRequest;
      invariant(expected, `PR #${number} approval snapshot is required`);
      invariant(
        expected.number === number && expected.head?.sha === headSha,
        `PR #${number} approval snapshot does not match the candidate`,
      );
      invariant(
        approvalSnapshot.feedback?.currentProcessorApprovalCount === 0 &&
          Array.isArray(
            approvalSnapshot.feedback?.currentProcessorApprovalIds,
          ) &&
          approvalSnapshot.feedback.currentProcessorApprovalIds.length === 0,
        `PR #${number} already has a current processor approval`,
      );
      const current = await getPullRequest(repository, number);
      requireStablePullRequestSnapshot(expected, current, number);
      invariant(current.state === "open", `PR #${number} is no longer open`);
      const response = await request(
        "POST",
        `/repos/${repository}/pulls/${number}/reviews`,
        {
          body: {
            body: `Approved by ${DEPENDABOT_PROCESSOR_SCHEMA} for exact head ${headSha}.`,
            commit_id: headSha,
            event: "APPROVE",
          },
        },
      );
      const approvalId = response.data?.id;
      invariant(
        Number.isSafeInteger(approvalId) && approvalId > 0,
        `PR #${number} approval response is missing a valid review ID`,
      );
      try {
        invariant(
          String(response.data?.state ?? "").toUpperCase() === "APPROVED" &&
            response.data?.commit_id === headSha,
          `PR #${number} approval response is invalid`,
        );
        const postflight = await getPullRequest(repository, number);
        requirePostApprovalPullRequestSnapshot(expected, postflight, number);
        return {
          id: approvalId,
          state: "APPROVED",
          updatedAt: postflight.updated_at ?? postflight.updatedAt,
        };
      } catch (error) {
        try {
          await dismissPullRequestApproval({
            approvalId,
            pullRequestNumber: number,
            repository,
          });
        } catch (dismissalError) {
          throw new AggregateError(
            [error, dismissalError],
            `PR #${number} approval revalidation and dismissal both failed`,
          );
        }
        throw error;
      }
    },
    collectPullRequestSnapshot,
    disablePullRequestAutoMerge,
    dismissPullRequestApproval,
    getChecks,
    getFeedback,
    getHumanCloseEvidence,
    getCurrentBaseAncestry,
    getOutstandingDependabotAutoMergeRequests,
    getOutstandingDependabotProcessorApprovals,
    getProcessorChecks,
    getOpenDependabotPullRequestNumbers: async (repository) => {
      const pulls = await paginate(`/repos/${repository}/pulls?state=open`);
      return pulls
        .filter(
          (pullRequest) =>
            normalizeLogin(pullRequest.user?.login) === DEPENDABOT_LOGIN,
        )
        .map(({ number }) => number)
        .sort((left, right) => left - right);
    },
    getPullRequest,
    publishProcessorCheck: async ({
      disposition,
      headSha,
      mode,
      pullRequestNumber: number,
      repairAttempt,
      repairPacket,
      repository,
      workflowContext,
    }) => {
      invariant(
        phase === "finalize",
        "Processor checks require finalize phase",
      );
      exactSha(headSha);
      pullRequestNumber(number);
      invariant(
        PROCESSOR_MODES.has(mode),
        "Processor check mode must be explicit",
      );
      invariant(
        Number.isSafeInteger(repairAttempt) && repairAttempt >= 1,
        "Processor check repair attempt must be a positive safe integer",
      );
      invariant(
        mode !== "observe" || repairPacket === null,
        "Observe processor checks cannot issue repair packets",
      );
      invariant(
        workflowContext !== null &&
          typeof workflowContext === "object" &&
          Object.hasOwn(workflowContext, "workflowRunId"),
        "Processor check publication requires an explicit workflow run ID",
      );
      const context = normalizeWorkflowContext(workflowContext);
      const packetIssued = repairPacket !== null;
      const packetText = packetIssued ? canonicalJson(repairPacket) : null;
      if (packetIssued) {
        invariant(
          repairPacket.workflowRunId === context.workflowRunId &&
            repairPacket.workflowRunAttempt === context.workflowRunAttempt &&
            repairPacket.workflowSha === context.workflowSha,
          "Repair packet workflow identity changed before publication",
        );
      }
      const packetDigest = packetIssued ? rawDigest(packetText) : "none";
      return publishCompletedCheck({
        conclusion:
          !packetIssued && SAFE_PROCESSOR_CHECK_DISPOSITIONS.has(disposition)
            ? "neutral"
            : "failure",
        detailsUrl: workflowActionsRunUrl(repository, context.workflowRunId),
        externalId: `${DEPENDABOT_PROCESSOR_SCHEMA}:pr=${number}:head=${headSha}:mode=${mode}:repair=${repairAttempt}:packet=${packetIssued}:digest=${packetDigest}:run=${context.workflowRunId}:attempt=${context.workflowRunAttempt}`,
        headSha,
        name: PROCESSOR_CHECK_NAME,
        output: {
          summary: `Disposition: ${disposition}`,
          text: packetText ?? undefined,
          title: `Dependabot processor: ${disposition}`,
        },
        repository,
      });
    },
    publishRefreshReceipt: async ({ receipt, repository }) => {
      invariant(
        (phase === "request" && receipt?.state === "requested") ||
          (phase === "finalize" && receipt?.state === "completed"),
        "Refresh receipt state is not authorized in this phase",
      );
      invariant(
        receipt?.schema === DEPENDABOT_REFRESH_SCHEMA &&
          receipt.repository === repository &&
          validPrepareActor(receipt),
        "Refresh receipt is invalid",
      );
      const headSha =
        receipt.state === "requested" ? receipt.parentHeadSha : receipt.headSha;
      const digest = canonicalDigest(receipt);
      return publishCompletedCheck({
        conclusion: "success",
        detailsUrl: workflowActionsRunUrl(repository, receipt.workflowRunId),
        externalId: `${DEPENDABOT_REFRESH_SCHEMA}:pr=${receipt.pullRequestNumber}:head=${headSha}:state=${receipt.state}:digest=${digest}:run=${receipt.workflowRunId}:attempt=${receipt.workflowRunAttempt}`,
        headSha,
        name: REFRESH_CHECK_NAME,
        output: {
          summary: `Refresh ${receipt.state}`,
          text: stableJson(receipt),
          title: `Dependabot refresh: ${receipt.state}`,
        },
        repository,
      });
    },
    publishAllClear: async ({ receipt, repository }) => {
      invariant(phase === "finalize", "ALL CLEAR requires finalize phase");
      invariant(
        receipt?.schema === DEPENDABOT_ALL_CLEAR_SCHEMA &&
          receipt.repository === repository &&
          validPreparationSummary(receipt.preparation),
        "ALL CLEAR receipt is invalid",
      );
      const digest = canonicalDigest(receipt);
      return publishCompletedCheck({
        conclusion: "success",
        detailsUrl: workflowActionsRunUrl(repository, receipt.workflowRunId),
        externalId: `${DEPENDABOT_ALL_CLEAR_SCHEMA}:pr=${receipt.pullRequestNumber}:head=${receipt.headSha}:base=${receipt.baseSha}:digest=${digest}:run=${receipt.workflowRunId}:attempt=${receipt.workflowRunAttempt}`,
        headSha: receipt.headSha,
        name: ALL_CLEAR_CHECK_NAME,
        output: {
          summary: "Exact-head preparation is complete. Human action: Merge.",
          text: stableJson(receipt),
          title: "Dependabot ALL CLEAR",
        },
        repository,
      });
    },
    publishAllClearInvalidation: async ({
      blocking = true,
      headSha,
      pullRequestNumber: number,
      repository,
    }) => {
      invariant(
        phase === "finalize",
        "ALL CLEAR invalidation requires finalize phase",
      );
      invariant(
        typeof blocking === "boolean",
        "ALL CLEAR invalidation type is invalid",
      );
      return publishCompletedCheck({
        conclusion: blocking ? "failure" : "neutral",
        detailsUrl: null,
        externalId: `dependabot-all-clear-${blocking ? "invalidated" : "tombstone"}:v1:pr=${pullRequestNumber(number)}:head=${exactSha(headSha)}`,
        headSha,
        name: ALL_CLEAR_CHECK_NAME,
        output: {
          summary: blocking
            ? "Reconciliation invalidated prior preparation authority."
            : "No processor approval remains. Preparation authority is absent.",
          title: blocking
            ? "Dependabot ALL CLEAR invalidated"
            : "Dependabot ALL CLEAR authority absent",
        },
        repository,
      });
    },
    replyToReviewComment: async ({
      body,
      commentId,
      pullRequestNumber: number,
      repository,
    }) => {
      invariant(
        phase === "finalize",
        "Review remediation requires finalize phase",
      );
      const response = await request(
        "POST",
        `/repos/${repository}/pulls/${pullRequestNumber(number)}/comments/${commentId}/replies`,
        { body: { body } },
      );
      return { id: response.data?.id };
    },
    requestPullRequestUpdateBranch: async ({
      expectedBaseSha,
      expectedHeadSha,
      expectedPreviousBaseSha,
      pullRequestNumber: number,
      repository,
    }) => {
      const currentBaseSha = exactSha(
        expectedBaseSha,
        "Expected current base SHA",
      );
      const headSha = exactSha(expectedHeadSha, "Expected head SHA");
      const previousBaseSha = exactSha(
        expectedPreviousBaseSha,
        "Expected previous base SHA",
      );
      invariant(
        currentBaseSha !== previousBaseSha,
        "Refresh requires distinct previous and current bases",
      );
      const current = await getPullRequest(
        repository,
        pullRequestNumber(number),
      );
      invariant(
        current.state === "open" &&
          current.head?.repo?.full_name === repository &&
          current.head?.sha === headSha &&
          current.base?.ref === "main" &&
          current.base?.repo?.full_name === repository &&
          current.base?.sha === previousBaseSha,
        `PR #${number} changed before update-branch`,
      );
      const mainReference = await request(
        "GET",
        `/repos/${repository}/git/ref/heads/main`,
      );
      invariant(
        mainReference.data?.ref === "refs/heads/main" &&
          mainReference.data?.object?.type === "commit" &&
          mainReference.data.object.sha === currentBaseSha,
        "main changed before update-branch",
      );
      const response = await requestWithRepairCredential(
        "PUT",
        `/repos/${repository}/pulls/${number}/update-branch`,
        { body: { expected_head_sha: headSha } },
      );
      return { message: response.data?.message ?? null };
    },
    waitForRefreshSuccessor: () =>
      new Promise((resolveDelay) => {
        setTimeout(resolveDelay, REFRESH_SUCCESSOR_POLL_INTERVAL_MS);
      }),
    resolveReviewThread: async ({ threadId }) => {
      invariant(
        phase === "finalize",
        "Review remediation requires finalize phase",
      );
      const mutation = `
        mutation DependabotResolveReviewThread($threadId: ID!) {
          resolveReviewThread(input: {threadId: $threadId}) {
            thread { id isResolved }
          }
        }
      `;
      const data = await graphql(mutation, { threadId });
      invariant(
        data.resolveReviewThread?.thread?.id === threadId &&
          data.resolveReviewThread.thread.isResolved === true,
        "Review thread resolution response is invalid",
      );
      return { resolved: true, threadId };
    },
    prepareActor,
  };
  if (phase === "request") {
    return {
      collectPullRequestSnapshot: capabilities.collectPullRequestSnapshot,
      getOpenDependabotPullRequestNumbers:
        capabilities.getOpenDependabotPullRequestNumbers,
      getOutstandingDependabotAutoMergeRequests:
        capabilities.getOutstandingDependabotAutoMergeRequests,
      prepareActor: capabilities.prepareActor,
      publishRefreshReceipt: capabilities.publishRefreshReceipt,
    };
  }
  if (phase === "mutate") {
    return {
      collectPullRequestSnapshot: capabilities.collectPullRequestSnapshot,
      getOpenDependabotPullRequestNumbers:
        capabilities.getOpenDependabotPullRequestNumbers,
      getOutstandingDependabotAutoMergeRequests:
        capabilities.getOutstandingDependabotAutoMergeRequests,
      prepareActor: capabilities.prepareActor,
      requestPullRequestUpdateBranch:
        capabilities.requestPullRequestUpdateBranch,
      waitForRefreshSuccessor: capabilities.waitForRefreshSuccessor,
    };
  }
  const finalizeCapabilities = { ...capabilities };
  delete finalizeCapabilities.requestPullRequestUpdateBranch;
  delete finalizeCapabilities.waitForRefreshSuccessor;
  return finalizeCapabilities;
}

async function collectSweepInput({
  adapter,
  expectedHeadSha = null,
  mode,
  pullRequestNumbers,
  repository,
  workflowContext = null,
}) {
  const targeted = pullRequestNumbers !== "all";
  const requestedNumbers = targeted
    ? [...new Set(pullRequestNumbers.map(pullRequestNumber))].sort(
        (left, right) => left - right,
      )
    : null;
  invariant(
    !targeted || requestedNumbers.length > 0,
    "PR number list cannot be empty",
  );
  let expectedTargetNumber = null;
  if (expectedHeadSha !== null) {
    exactSha(expectedHeadSha, "Expected intake head SHA");
    invariant(
      targeted && requestedNumbers.length === 1,
      "--expected-head-sha requires exactly one requested pull request",
    );
    [expectedTargetNumber] = requestedNumbers;
  }
  const expandPrepareLane = mode === "prepare" && targeted;
  const collectedNumbers =
    !targeted || expandPrepareLane
      ? await adapter.getOpenDependabotPullRequestNumbers(repository)
      : requestedNumbers;
  const numbers = [...new Set(collectedNumbers.map(pullRequestNumber))].sort(
    (left, right) => left - right,
  );
  invariant(
    numbers.length <= PROCESSOR_APPROVAL_PULL_LIMIT &&
      numbers.length === collectedNumbers.length,
    "Open Dependabot PR collection is incomplete or ambiguous",
  );
  if (expandPrepareLane) {
    invariant(
      requestedNumbers.every((number) => numbers.includes(number)),
      "Requested Dependabot PR is not open",
    );
  }
  invariant(
    typeof adapter.getOutstandingDependabotAutoMergeRequests === "function",
    "Live sweeps require repository-wide auto-merge visibility",
  );
  const outstandingAutoMergeRequests =
    await adapter.getOutstandingDependabotAutoMergeRequests(repository);
  const pullRequests = [];
  for (const number of numbers) {
    const snapshot = await adapter.collectPullRequestSnapshot(
      repository,
      pullRequestNumber(number),
    );
    if (number === expectedTargetNumber) {
      snapshot.expectedHeadSha = expectedHeadSha;
    }
    pullRequests.push(snapshot);
  }
  return {
    mode,
    outstandingAutoMergeRequests,
    pullRequests,
    repository,
    workflowContext,
  };
}

function normalizeApprovalInventory(inventory) {
  invariant(
    Array.isArray(inventory) &&
      inventory.length <= PROCESSOR_APPROVAL_RESULT_LIMIT,
    "Repository-wide processor approval inventory is incomplete",
  );
  const normalized = inventory.map((approval) => ({
    approvalId: approval?.approvalId,
    headSha: approval?.headSha,
    pullRequestNumber: approval?.pullRequestNumber,
  }));
  invariant(
    normalized.every(
      ({ approvalId, headSha, pullRequestNumber: number }) =>
        Number.isSafeInteger(approvalId) &&
        approvalId > 0 &&
        SHA_PATTERN.test(headSha ?? "") &&
        Number.isSafeInteger(number) &&
        number > 0,
    ) &&
      new Set(normalized.map(({ approvalId }) => approvalId)).size ===
        normalized.length,
    "Repository-wide processor approval inventory is malformed",
  );
  return normalized.sort(
    (left, right) =>
      left.pullRequestNumber - right.pullRequestNumber ||
      left.approvalId - right.approvalId,
  );
}

function evaluationForCandidate(evaluation) {
  const candidate = evaluation.prepareCandidate;
  if (!candidate) return null;
  return (
    evaluation.evaluations.find(
      ({ headSha, pullRequestNumber: number }) =>
        number === candidate.pullRequestNumber && headSha === candidate.headSha,
    ) ?? null
  );
}

function preparationSummary(result) {
  const attempts = result.repairAttempts;
  const protectedRuntimeOperations = [
    ...(attempts.protectedRuntimeOperations ?? []),
  ];
  const common = {
    kind: attempts.preparationKind,
    operationDigests: [...attempts.operationDigests],
    ...(protectedRuntimeOperations.length > 0
      ? { protectedRuntimeOperations }
      : {}),
    refreshCount: attempts.refreshCommitCount,
    repairCount: attempts.authenticatedRepairCommitCount,
    seedHeadSha: result.identity.automaticSeedHeadSha,
  };
  if (common.kind === "native") return common;
  invariant(
    attempts.preparationActor !== null,
    "Prepared lineage is missing its authenticated actor",
  );
  return {
    ...common,
    prepareAppSlug: attempts.preparationActor.appSlug,
    prepareBotId: attempts.preparationActor.botId,
    prepareBotLogin: attempts.preparationActor.botLogin,
  };
}

function checksDigest(result) {
  return canonicalDigest({
    baselineSha: result.checks.baselineSha,
    headSha: result.headSha,
    policy: result.checks.policy,
  });
}

function allClearReceiptMatchesResult({
  approval,
  receipt,
  result,
  serialization,
}) {
  if (!result || !receipt) return false;
  return (
    serialization.ready === true &&
    result.disposition === "prepare-candidate" &&
    result.base.current === true &&
    result.checks.state === "passing" &&
    result.checks.missing.length === 0 &&
    result.checks.pending.length === 0 &&
    result.feedback.clear === true &&
    result.feedback.autoMergeEnabled === false &&
    result.feedback.currentProcessorApprovalCount === 1 &&
    result.feedback.currentProcessorApprovalIds.length === 1 &&
    result.feedback.currentProcessorApprovalIds[0] === approval.approvalId &&
    result.feedback.mergeable === true &&
    result.feedback.mergeStateStatus === "CLEAN" &&
    result.feedback.reviewDecision === "APPROVED" &&
    receipt.pullRequestNumber === approval.pullRequestNumber &&
    receipt.processorApprovalId === approval.approvalId &&
    receipt.headSha === approval.headSha &&
    receipt.baseSha === result.base.currentBaseSha &&
    receipt.checksDigest === checksDigest(result) &&
    receipt.feedbackDigest === result.feedback.digest &&
    receipt.riskTier === result.risk.tier &&
    receipt.updateType === result.risk.updateType &&
    stableJson(receipt.preparation) === stableJson(preparationSummary(result))
  );
}

function allClearReceiptMatches({ approval, evaluation, receipt }) {
  const result = evaluationForCandidate(evaluation);
  if (
    !result ||
    evaluation.prepareCandidate?.disposition !== "prepare-candidate"
  ) {
    return false;
  }
  return allClearReceiptMatchesResult({
    approval,
    receipt,
    result,
    serialization: evaluation.serialization,
  });
}

function activeAllClearAuthority({
  repository,
  result,
  serialization,
  snapshot,
}) {
  if (
    result.feedback.currentProcessorApprovalCount !== 1 ||
    result.feedback.currentProcessorApprovalIds.length !== 1
  ) {
    return null;
  }
  const approval = {
    approvalId: result.feedback.currentProcessorApprovalIds[0],
    headSha: result.headSha,
    pullRequestNumber: result.pullRequestNumber,
  };
  const newest = newestExactHeadAllClear(snapshot, result.headSha);
  const parsed =
    !newest.malformed && newest.check
      ? parseDependabotAllClearReceipt(newest.check, repository)
      : null;
  if (!parsed) return null;
  try {
    return allClearReceiptMatchesResult({
      approval,
      receipt: parsed.receipt,
      result,
      serialization,
    })
      ? approval
      : null;
  } catch {
    return null;
  }
}

function newestExactHeadAllClear(snapshot, headSha) {
  const candidates = (snapshot?.checks ?? [])
    .map((check) => normalizeCheck(check))
    .filter(
      (check) =>
        check.name === ALL_CLEAR_CHECK_NAME && check.headSha === headSha,
    );
  if (candidates.length === 0) return { check: null, malformed: false };
  const positive = candidates.filter(
    ({ id }) => Number.isSafeInteger(id) && id > 0,
  );
  const uniqueIds = new Set(positive.map(({ id }) => id));
  return {
    check:
      [...positive].sort((left, right) => left.id - right.id).at(-1) ?? null,
    malformed:
      positive.length !== candidates.length ||
      uniqueIds.size !== positive.length,
  };
}

function newestExactHeadProcessorCheck(snapshot, headSha) {
  const candidates = (snapshot?.checks ?? [])
    .map((check) => normalizeCheck(check))
    .filter(
      (check) =>
        check.name === PROCESSOR_CHECK_NAME && check.headSha === headSha,
    );
  if (candidates.length === 0) return { check: null, malformed: false };
  const positive = candidates.filter(
    ({ id }) => Number.isSafeInteger(id) && id > 0,
  );
  return {
    check:
      [...positive].sort((left, right) => left.id - right.id).at(-1) ?? null,
    malformed:
      positive.length !== candidates.length ||
      new Set(positive.map(({ id }) => id)).size !== positive.length,
  };
}

function processorCheckAlreadyPublished({ evaluation, result, snapshot }) {
  if (result.disposition === "repair-pending") return true;
  const newest = newestExactHeadProcessorCheck(snapshot, result.headSha);
  if (newest.malformed || !newest.check) return false;
  const parsed = parseDependabotProcessorReceipt(
    newest.check,
    evaluation.repository,
  );
  if (!parsed) return false;
  const packetIssued = result.repairPacket !== null;
  const packetDigest = packetIssued
    ? rawDigest(canonicalJson(result.repairPacket))
    : null;
  return (
    parsed.pullRequestNumber === result.pullRequestNumber &&
    parsed.headSha === result.headSha &&
    parsed.mode === evaluation.mode &&
    parsed.attempt === result.repairAttempt &&
    parsed.packetIssued === packetIssued &&
    parsed.packetDigest === packetDigest &&
    parsed.check.outputSummary === `Disposition: ${result.disposition}`
  );
}

function isExactAllClearInvalidation(check, pullRequestNumberValue, headSha) {
  return (
    check !== null &&
    check.appId === GITHUB_ACTIONS_APP_ID &&
    check.status === "completed" &&
    ((check.conclusion === "failure" &&
      check.externalId ===
        `dependabot-all-clear-invalidated:v1:pr=${pullRequestNumberValue}:head=${headSha}`) ||
      (check.conclusion === "neutral" &&
        check.externalId ===
          `dependabot-all-clear-tombstone:v1:pr=${pullRequestNumberValue}:head=${headSha}`))
  );
}

function isExactBlockingAllClearInvalidation(
  check,
  pullRequestNumberValue,
  headSha,
) {
  return (
    check !== null &&
    check.appId === GITHUB_ACTIONS_APP_ID &&
    check.status === "completed" &&
    check.conclusion === "failure" &&
    check.externalId ===
      `dependabot-all-clear-invalidated:v1:pr=${pullRequestNumberValue}:head=${headSha}`
  );
}

function isExactNeutralAllClearTombstone(
  check,
  pullRequestNumberValue,
  headSha,
) {
  return (
    check !== null &&
    check.appId === GITHUB_ACTIONS_APP_ID &&
    check.status === "completed" &&
    check.conclusion === "neutral" &&
    check.externalId ===
      `dependabot-all-clear-tombstone:v1:pr=${pullRequestNumberValue}:head=${headSha}`
  );
}

function hasCurrentTrustedAllClear({ approval, collected, evaluation }) {
  const snapshot = (collected.pullRequests ?? []).find((candidateSnapshot) => {
    const pullRequest = normalizePullRequest(
      candidateSnapshot.pullRequest ?? candidateSnapshot,
    );
    return (
      pullRequest.number === approval.pullRequestNumber &&
      pullRequest.headSha === approval.headSha
    );
  });
  const newest = newestExactHeadAllClear(snapshot, approval.headSha);
  const parsed =
    !newest.malformed && newest.check
      ? parseDependabotAllClearReceipt(newest.check, evaluation.repository)
      : null;
  return (
    parsed !== null &&
    allClearReceiptMatches({
      approval,
      evaluation,
      receipt: parsed.receipt,
    })
  );
}

function exactRefreshSuccessor(snapshot, expected) {
  const pullRequest = normalizePullRequest(snapshot.pullRequest ?? snapshot);
  const commits = Array.isArray(snapshot.commits) ? snapshot.commits : [];
  const generationSeedCommit = commits[0] ?? null;
  const generationSeedHeadSha = generationSeedCommit?.sha ?? null;
  const forcePushGeneration = evaluateForcePushGeneration({
    feedback: snapshot.feedback ?? {},
    generationSeedCommit,
    generationSeedHeadSha,
    generationSeedTrusted:
      snapshot.metadata?.immutableEvidence?.seedCommitTrusted === true &&
      snapshot.metadata?.immutableEvidence?.seedCommitSha ===
        generationSeedHeadSha,
    pullRequest: snapshot.pullRequest ?? snapshot,
  });
  invariant(
    pullRequest.number === expected.pullRequestNumber &&
      pullRequest.headRef === expected.headRef &&
      pullRequest.headRepository === expected.repository &&
      pullRequest.baseRepository === expected.repository &&
      pullRequest.baseRef === "main" &&
      SHA_PATTERN.test(pullRequest.baseSha ?? "") &&
      forcePushGeneration.veto !== true,
    `PR #${expected.pullRequestNumber} changed outside the requested refresh`,
  );
  if (pullRequest.headSha === expected.parentHeadSha) return null;
  invariant(
    commits.length >= 2 &&
      commits.at(-2)?.sha === expected.parentHeadSha &&
      commits.at(-1)?.sha === pullRequest.headSha,
    `PR #${expected.pullRequestNumber} refresh has intervening commits`,
  );
  const parents = commitParentShas(commits.at(-1));
  const appliedBaseSha = parents[1] ?? null;
  const baseAncestry = snapshot.baseAncestry ?? {};
  invariant(
    parents.length === 2 &&
      new Set(parents).size === 2 &&
      parents[0] === expected.parentHeadSha &&
      (appliedBaseSha === baseAncestry.currentBaseSha ||
        appliedBaseSha === baseAncestry.mergeBaseSha) &&
      commitMatchesAuthenticatedRefresh(
        commits.at(-1),
        expected.requestReceipt ?? expected,
      ),
    `PR #${expected.pullRequestNumber} refresh commit parents are invalid`,
  );
  return { appliedBaseSha, headSha: pullRequest.headSha };
}

async function recollectSelectedSweep({ adapter, collected, workflowContext }) {
  const pullRequests = [];
  for (const snapshot of collected.pullRequests ?? []) {
    const selected = normalizePullRequest(snapshot.pullRequest ?? snapshot);
    const refreshed = await adapter.collectPullRequestSnapshot(
      collected.repository,
      selected.number,
    );
    refreshed.expectedHeadSha = snapshot.expectedHeadSha ?? selected.headSha;
    pullRequests.push(refreshed);
  }
  return {
    ...collected,
    outstandingAutoMergeRequests:
      await adapter.getOutstandingDependabotAutoMergeRequests(
        collected.repository,
      ),
    pullRequests,
    workflowContext,
  };
}

async function rollbackDependabotAuthority({
  adapter,
  evaluation,
  invalidationTargets = [],
  observedApprovals = [],
}) {
  const cleanupErrors = [];
  const repository = evaluation.repository;
  const blockingInvalidations = new Set();
  const publishBlockingInvalidation = async ({
    headSha,
    pullRequestNumber: number,
  }) => {
    const key = `${number}:${headSha}`;
    if (blockingInvalidations.has(key)) return;
    try {
      invariant(
        typeof adapter.publishAllClearInvalidation === "function",
        "Dependabot authority rollback requires invalidation capability",
      );
      await adapter.publishAllClearInvalidation({
        blocking: true,
        headSha,
        pullRequestNumber: number,
        repository,
      });
      blockingInvalidations.add(key);
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError);
    }
  };

  const cleanupApprovals = new Map();
  const rememberApproval = (approval) => {
    const normalized = normalizeApprovalInventory([approval])[0];
    cleanupApprovals.set(normalized.approvalId, normalized);
  };
  for (const approval of observedApprovals) rememberApproval(approval);
  for (const candidate of evaluation.evaluations ?? []) {
    for (const approvalId of candidate.feedback.currentProcessorApprovalIds ??
      []) {
      rememberApproval({
        approvalId,
        headSha: candidate.headSha,
        pullRequestNumber: candidate.pullRequestNumber,
      });
    }
  }
  for (const target of invalidationTargets) {
    await publishBlockingInvalidation(target);
  }

  const dismissedApprovals = new Set();
  const dismissObservedApprovals = async (approvals) => {
    for (const approval of approvals) {
      await publishBlockingInvalidation(approval);
      if (dismissedApprovals.has(approval.approvalId)) continue;
      try {
        invariant(
          typeof adapter.dismissPullRequestApproval === "function",
          "Dependabot authority rollback requires approval dismissal capability",
        );
        await adapter.dismissPullRequestApproval({
          approvalId: approval.approvalId,
          pullRequestNumber: approval.pullRequestNumber,
          repository,
        });
        dismissedApprovals.add(approval.approvalId);
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError);
      }
    }
  };
  await dismissObservedApprovals(cleanupApprovals.values());

  const disableObservedAutoMerge = async (observed) => {
    for (const request of observed.requests) {
      await publishBlockingInvalidation(request);
    }
    invariant(
      !observed.ambiguous,
      `Repository auto-merge evidence remained ambiguous during Dependabot authority rollback: ${observed.reasons.join(",")}`,
    );
    if (observed.requests.length === 0) return;
    const [request] = observed.requests;
    invariant(
      typeof adapter.disablePullRequestAutoMerge === "function",
      "Dependabot authority rollback requires auto-merge cleanup capability",
    );
    await adapter.disablePullRequestAutoMerge({
      headSha: request.headSha,
      nodeId: request.nodeId,
      pullRequestNumber: request.pullRequestNumber,
      repository,
    });
  };
  try {
    await disableObservedAutoMerge(
      evaluation.serialization.outstandingAutoMerge,
    );
  } catch (cleanupError) {
    cleanupErrors.push(cleanupError);
  }

  let emptyInventoryRounds = 0;
  let cleanupProven = false;
  for (
    let attempt = 0;
    attempt < RECOVERY_ROLLBACK_INVENTORY_ATTEMPTS;
    attempt += 1
  ) {
    let autoMergeEmpty = false;
    let approvalsEmpty = false;
    let roundComplete = true;
    try {
      const autoMerge = outstandingAutoMergeState(
        {
          outstandingAutoMergeRequests:
            await adapter.getOutstandingDependabotAutoMergeRequests(repository),
        },
        [],
      );
      autoMergeEmpty = !autoMerge.ambiguous && autoMerge.requests.length === 0;
      if (!autoMergeEmpty) await disableObservedAutoMerge(autoMerge);
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError);
      roundComplete = false;
    }
    try {
      const approvals = normalizeApprovalInventory(
        await adapter.getOutstandingDependabotProcessorApprovals(repository),
      );
      approvalsEmpty = approvals.length === 0;
      if (!approvalsEmpty) await dismissObservedApprovals(approvals);
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError);
      roundComplete = false;
    }
    if (roundComplete && autoMergeEmpty && approvalsEmpty) {
      emptyInventoryRounds += 1;
      if (emptyInventoryRounds === RECOVERY_ROLLBACK_EMPTY_CONFIRMATIONS) {
        cleanupProven = true;
        break;
      }
    } else {
      emptyInventoryRounds = 0;
    }
  }
  if (!cleanupProven) {
    cleanupErrors.push(
      new Error(
        "Dependabot merge authority was not proven absent after bounded rollback",
      ),
    );
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(
      cleanupErrors,
      "Dependabot authority rollback failed",
    );
  }
}

async function processRequestPhase({ adapter, evaluation, workflowContext }) {
  invariant(
    evaluation.mode === "prepare",
    "Request phase requires prepare mode",
  );
  invariant(
    typeof adapter.publishRefreshReceipt === "function" &&
      typeof adapter.requestPullRequestUpdateBranch !== "function" &&
      typeof adapter.publishProcessorCheck !== "function" &&
      typeof adapter.approvePullRequest !== "function",
    "Request adapter exposes an unsafe capability set",
  );
  const mutations = [];
  const result = evaluationForCandidate(evaluation);
  if (!result || result.disposition !== "refresh-required") {
    return { ...evaluation, mutations, phase: "request" };
  }
  const actor = adapter.prepareActor;
  invariant(
    actor &&
      validPrepareActor({
        prepareAppSlug: actor.appSlug,
        prepareBotId: actor.botId,
        prepareBotLogin: actor.botLogin,
      }),
    "Request phase is missing trusted prepare bot identity",
  );
  invariant(
    SHA_PATTERN.test(result.baseSha ?? "") &&
      SHA_PATTERN.test(result.base.currentBaseSha ?? "") &&
      SHA_PATTERN.test(result.base.mergeBaseSha ?? "") &&
      result.baseSha === result.base.mergeBaseSha &&
      result.base.currentBaseSha !== result.base.mergeBaseSha,
    "Refresh request does not bind the recorded old base and distinct current base",
  );
  const receipt = {
    baseSha: result.base.currentBaseSha,
    headRef: result.headRef,
    headSha: null,
    parentHeadSha: result.headSha,
    prepareAppSlug: actor.appSlug,
    prepareBotId: actor.botId,
    prepareBotLogin: actor.botLogin,
    previousBaseSha: result.baseSha,
    pullRequestNumber: result.pullRequestNumber,
    repository: evaluation.repository,
    schema: DEPENDABOT_REFRESH_SCHEMA,
    state: "requested",
    ...workflowContext,
  };
  const published = await adapter.publishRefreshReceipt({
    receipt,
    repository: evaluation.repository,
  });
  mutations.push({
    headSha: result.headSha,
    kind: "refresh-requested",
    pullRequestNumber: result.pullRequestNumber,
    requestCheckId: published.id,
    requestDigest: canonicalDigest(receipt),
  });
  return { ...evaluation, mutations, phase: "request" };
}

async function processMutatePhase({ adapter, evaluation }) {
  invariant(
    evaluation.mode === "prepare",
    "Mutate phase requires prepare mode",
  );
  invariant(
    typeof adapter.requestPullRequestUpdateBranch === "function" &&
      typeof adapter.collectPullRequestSnapshot === "function" &&
      typeof adapter.publishRefreshReceipt !== "function" &&
      typeof adapter.publishProcessorCheck !== "function" &&
      typeof adapter.approvePullRequest !== "function" &&
      typeof adapter.publishAllClear !== "function" &&
      typeof adapter.publishAllClearInvalidation !== "function" &&
      typeof adapter.dismissPullRequestApproval !== "function" &&
      typeof adapter.disablePullRequestAutoMerge !== "function" &&
      typeof adapter.replyToReviewComment !== "function" &&
      typeof adapter.resolveReviewThread !== "function",
    "Mutate adapter exposes an unsafe capability set",
  );
  const mutations = [];
  const result = evaluationForCandidate(evaluation);
  if (!result || result.disposition !== "refresh-pending") {
    return { ...evaluation, mutations, phase: "mutate" };
  }
  const pending = result.repairAttempts.pendingRefreshRequest;
  invariant(
    pending &&
      pending.requestReceipt.parentHeadSha === result.headSha &&
      pending.requestReceipt.baseSha === result.base.currentBaseSha &&
      pending.requestReceipt.previousBaseSha === result.baseSha &&
      pending.requestReceipt.previousBaseSha === result.base.mergeBaseSha,
    "Mutate phase lacks an exact trusted current-head Refresh request",
  );
  await adapter.requestPullRequestUpdateBranch({
    expectedBaseSha: pending.requestReceipt.baseSha,
    expectedHeadSha: result.headSha,
    expectedPreviousBaseSha: pending.requestReceipt.previousBaseSha,
    pullRequestNumber: result.pullRequestNumber,
    repository: evaluation.repository,
  });
  let successorHeadSha = null;
  const expected = {
    ...pending.requestReceipt,
    repository: evaluation.repository,
    requestReceipt: pending.requestReceipt,
  };
  let snapshotRaceAttempts = 0;
  for (let stablePolls = 0; stablePolls < REFRESH_SUCCESSOR_POLL_ATTEMPTS; ) {
    let snapshot;
    try {
      snapshot = await adapter.collectPullRequestSnapshot(
        evaluation.repository,
        result.pullRequestNumber,
      );
    } catch (error) {
      if (!(error instanceof PullRequestSnapshotChangedError)) {
        throw error;
      }
      snapshotRaceAttempts += 1;
      if (snapshotRaceAttempts === REFRESH_SNAPSHOT_RACE_ATTEMPTS) throw error;
      if (typeof adapter.waitForRefreshSuccessor === "function") {
        await adapter.waitForRefreshSuccessor();
      }
      continue;
    }
    stablePolls += 1;
    const successor = exactRefreshSuccessor(snapshot, expected);
    successorHeadSha = successor?.headSha ?? null;
    if (successor !== null) break;
    if (
      stablePolls < REFRESH_SUCCESSOR_POLL_ATTEMPTS &&
      typeof adapter.waitForRefreshSuccessor === "function"
    ) {
      await adapter.waitForRefreshSuccessor();
    }
  }
  mutations.push({
    headSha: result.headSha,
    kind: "refresh-update-requested",
    pullRequestNumber: result.pullRequestNumber,
    requestCheckId: pending.requestCheckId,
    requestDigest: pending.requestDigest,
    successorHeadSha,
  });
  return { ...evaluation, mutations, phase: "mutate" };
}

async function processFinalizePhase({
  adapter,
  collected: initialCollected,
  evaluation: initialEvaluation,
  publishChecks,
  workflowContext,
}) {
  invariant(
    typeof adapter.requestPullRequestUpdateBranch !== "function",
    "Finalize adapter exposes branch mutation capability",
  );
  let collected = initialCollected;
  let evaluation = initialEvaluation;
  const mutations = [];
  const canReconcileApprovals =
    typeof adapter.getOutstandingDependabotProcessorApprovals === "function";
  const authorityAddingFinalize =
    publishChecks || evaluation.mode === "prepare";
  invariant(
    !authorityAddingFinalize || canReconcileApprovals,
    "Authority-adding finalize requires global processor approval visibility",
  );
  let approvals = canReconcileApprovals
    ? normalizeApprovalInventory(
        await adapter.getOutstandingDependabotProcessorApprovals(
          evaluation.repository,
        ),
      )
    : [];

  if (evaluation.mode === "prepare" && approvals.length === 1) {
    const [activeApproval] = approvals;
    const alreadyCollected = (collected.pullRequests ?? []).some((snapshot) => {
      const pullRequest = normalizePullRequest(
        snapshot.pullRequest ?? snapshot,
      );
      return (
        pullRequest.number === activeApproval.pullRequestNumber &&
        pullRequest.headSha === activeApproval.headSha
      );
    });
    if (!alreadyCollected) {
      invariant(
        typeof adapter.collectPullRequestSnapshot === "function" &&
          typeof adapter.getOutstandingDependabotAutoMergeRequests ===
            "function",
        "Active ALL CLEAR reconciliation requires exact PR collection",
      );
      const activeSnapshot = await adapter.collectPullRequestSnapshot(
        evaluation.repository,
        activeApproval.pullRequestNumber,
      );
      const activePullRequest = normalizePullRequest(
        activeSnapshot.pullRequest ?? activeSnapshot,
      );
      invariant(
        activePullRequest.number === activeApproval.pullRequestNumber &&
          activePullRequest.headSha === activeApproval.headSha,
        "Repository-wide processor approval changed before ALL CLEAR collection",
      );
      activeSnapshot.expectedHeadSha = activeApproval.headSha;
      collected = {
        ...collected,
        outstandingAutoMergeRequests:
          await adapter.getOutstandingDependabotAutoMergeRequests(
            evaluation.repository,
          ),
        pullRequests: [...(collected.pullRequests ?? []), activeSnapshot],
        workflowContext,
      };
      evaluation = evaluateDependabotSweep(collected);
    }
  }

  if (
    evaluation.mode === "prepare" &&
    approvals.length === 1 &&
    hasCurrentTrustedAllClear({
      approval: approvals[0],
      collected,
      evaluation,
    })
  ) {
    const confirmationApprovals = normalizeApprovalInventory(
      await adapter.getOutstandingDependabotProcessorApprovals(
        evaluation.repository,
      ),
    );
    const sameApproval =
      confirmationApprovals.length === 1 &&
      stableJson(confirmationApprovals[0]) === stableJson(approvals[0]);
    if (sameApproval) {
      collected = await recollectSelectedSweep({
        adapter,
        collected,
        workflowContext,
      });
      evaluation = evaluateDependabotSweep(collected);
      if (
        hasCurrentTrustedAllClear({
          approval: confirmationApprovals[0],
          collected,
          evaluation,
        })
      ) {
        return {
          ...evaluation,
          mutations,
          phase: "finalize",
          processing: { enabled: true, reason: "already-all-clear" },
        };
      }
    }
    approvals = confirmationApprovals;
  }

  const blockingInvalidations = new Map();
  const rememberBlockingInvalidation = ({
    headSha,
    pullRequestNumber: number,
  }) => {
    blockingInvalidations.set(`${number}:${headSha}`, {
      headSha,
      pullRequestNumber: number,
    });
  };
  const invalidate = async ({ headSha, pullRequestNumber: number }) => {
    const key = `${number}:${headSha}`;
    if (blockingInvalidations.has(key)) return;
    invariant(
      typeof adapter.publishAllClearInvalidation === "function",
      "ALL CLEAR cleanup requires a finalize invalidation publisher",
    );
    await adapter.publishAllClearInvalidation({
      headSha,
      pullRequestNumber: number,
      repository: evaluation.repository,
    });
    rememberBlockingInvalidation({
      headSha,
      pullRequestNumber: number,
    });
    mutations.push({
      headSha,
      kind: "all-clear-invalidated",
      pullRequestNumber: number,
    });
  };
  for (const snapshot of collected.pullRequests ?? []) {
    const pullRequest = normalizePullRequest(snapshot.pullRequest ?? snapshot);
    const newestAllClear = newestExactHeadAllClear(
      snapshot,
      pullRequest.headSha,
    );
    const blockingInvalidation =
      !newestAllClear.malformed &&
      isExactBlockingAllClearInvalidation(
        newestAllClear.check,
        pullRequest.number,
        pullRequest.headSha,
      );
    const neutralTombstone =
      !newestAllClear.malformed &&
      isExactNeutralAllClearTombstone(
        newestAllClear.check,
        pullRequest.number,
        pullRequest.headSha,
      );
    const alreadyInvalidated =
      !newestAllClear.malformed &&
      isExactAllClearInvalidation(
        newestAllClear.check,
        pullRequest.number,
        pullRequest.headSha,
      );
    if (blockingInvalidation) {
      rememberBlockingInvalidation({
        headSha: pullRequest.headSha,
        pullRequestNumber: pullRequest.number,
      });
    }
    if (
      neutralTombstone ||
      newestAllClear.malformed ||
      (newestAllClear.check !== null && !alreadyInvalidated)
    ) {
      await invalidate({
        headSha: pullRequest.headSha,
        pullRequestNumber: pullRequest.number,
      });
    }
  }
  if (approvals.length > 0) {
    invariant(
      typeof adapter.dismissPullRequestApproval === "function",
      "Approval reconciliation requires finalize dismissal capability",
    );
    for (const approval of approvals) {
      await invalidate(approval);
      await adapter.dismissPullRequestApproval({
        approvalId: approval.approvalId,
        pullRequestNumber: approval.pullRequestNumber,
        repository: evaluation.repository,
      });
      mutations.push({
        headSha: approval.headSha,
        kind: "approval-dismissed",
        pullRequestNumber: approval.pullRequestNumber,
      });
    }
  }
  if (authorityAddingFinalize) {
    approvals = normalizeApprovalInventory(
      await adapter.getOutstandingDependabotProcessorApprovals(
        evaluation.repository,
      ),
    );
    invariant(
      approvals.length === 0,
      "Repository-wide processor approvals changed during reconciliation",
    );
  }
  if (authorityAddingFinalize || blockingInvalidations.size > 0) {
    collected = await recollectSelectedSweep({
      adapter,
      collected,
      workflowContext,
    });
    evaluation = evaluateDependabotSweep(collected);
  }

  const autoMerge = evaluation.serialization.outstandingAutoMerge;
  invariant(
    !autoMerge.ambiguous,
    `Repository auto-merge evidence is ambiguous: ${autoMerge.reasons.join(",")}`,
  );
  if (autoMerge.requests.length === 1) {
    invariant(
      typeof adapter.disablePullRequestAutoMerge === "function",
      "Native auto-merge cleanup requires finalize capability",
    );
    const [request] = autoMerge.requests;
    await adapter.disablePullRequestAutoMerge({
      headSha: request.headSha,
      nodeId: request.nodeId,
      pullRequestNumber: request.pullRequestNumber,
      repository: evaluation.repository,
    });
    mutations.push({
      headSha: request.headSha,
      kind: "auto-merge-disabled",
      pullRequestNumber: request.pullRequestNumber,
    });
    return { ...evaluation, mutations, phase: "finalize" };
  }

  if (evaluation.mode === "prepare" && blockingInvalidations.size > 0) {
    const recoveryTargets = [];
    for (const snapshot of collected.pullRequests ?? []) {
      const pullRequest = normalizePullRequest(
        snapshot.pullRequest ?? snapshot,
      );
      const target = blockingInvalidations.get(
        `${pullRequest.number}:${pullRequest.headSha}`,
      );
      if (!target) continue;
      const newestAllClear = newestExactHeadAllClear(
        snapshot,
        pullRequest.headSha,
      );
      invariant(
        !newestAllClear.malformed &&
          isExactBlockingAllClearInvalidation(
            newestAllClear.check,
            pullRequest.number,
            pullRequest.headSha,
          ),
        `PR #${pullRequest.number} ALL CLEAR invalidation changed before recovery`,
      );
      recoveryTargets.push(target);
    }
    if (recoveryTargets.length > 0) {
      const requireBlockedRecoveryState = (currentEvaluation) => {
        const outstandingAutoMerge =
          currentEvaluation.serialization.outstandingAutoMerge;
        invariant(
          outstandingAutoMerge.ambiguous === false &&
            outstandingAutoMerge.requests.length === 0,
          "ALL CLEAR recovery requires no repository auto-merge authority",
        );
        for (const target of recoveryTargets) {
          const current = (currentEvaluation.evaluations ?? []).find(
            (candidate) =>
              candidate.pullRequestNumber === target.pullRequestNumber &&
              candidate.headSha === target.headSha,
          );
          invariant(
            current &&
              current.feedback.autoMergeEnabled === false &&
              current.feedback.currentProcessorApprovalCount === 0 &&
              current.feedback.currentProcessorApprovalIds.length === 0 &&
              current.feedback.reviewDecision === "REVIEW_REQUIRED" &&
              current.feedback.mergeStateStatus === "BLOCKED",
            `PR #${target.pullRequestNumber} retained merge authority during ALL CLEAR recovery`,
          );
        }
      };
      approvals = normalizeApprovalInventory(
        await adapter.getOutstandingDependabotProcessorApprovals(
          evaluation.repository,
        ),
      );
      invariant(
        approvals.length === 0,
        "Repository-wide processor approvals changed before ALL CLEAR recovery",
      );
      requireBlockedRecoveryState(evaluation);
      const attempted = [];
      const recovered = [];
      try {
        for (const target of recoveryTargets) {
          attempted.push(target);
          const published = await adapter.publishAllClearInvalidation({
            blocking: false,
            headSha: target.headSha,
            pullRequestNumber: target.pullRequestNumber,
            repository: evaluation.repository,
          });
          invariant(
            Number.isSafeInteger(published?.id) && published.id > 0,
            `PR #${target.pullRequestNumber} ALL CLEAR tombstone response is invalid`,
          );
          recovered.push({ ...target, tombstoneCheckId: published.id });
          mutations.push({
            checkId: published.id,
            headSha: target.headSha,
            kind: "all-clear-tombstoned",
            pullRequestNumber: target.pullRequestNumber,
          });
        }
        collected = await recollectSelectedSweep({
          adapter,
          collected,
          workflowContext,
        });
        evaluation = evaluateDependabotSweep(collected);
        approvals = normalizeApprovalInventory(
          await adapter.getOutstandingDependabotProcessorApprovals(
            evaluation.repository,
          ),
        );
        invariant(
          approvals.length === 0,
          "Repository-wide processor approvals changed during ALL CLEAR recovery",
        );
        requireBlockedRecoveryState(evaluation);
        for (const target of recovered) {
          const snapshot = (collected.pullRequests ?? []).find((candidate) => {
            const pullRequest = normalizePullRequest(
              candidate.pullRequest ?? candidate,
            );
            return (
              pullRequest.number === target.pullRequestNumber &&
              pullRequest.headSha === target.headSha
            );
          });
          const newestAllClear = newestExactHeadAllClear(
            snapshot,
            target.headSha,
          );
          invariant(
            !newestAllClear.malformed &&
              newestAllClear.check?.id === target.tombstoneCheckId &&
              isExactNeutralAllClearTombstone(
                newestAllClear.check,
                target.pullRequestNumber,
                target.headSha,
              ),
            `PR #${target.pullRequestNumber} ALL CLEAR recovery was not observed`,
          );
        }
      } catch (error) {
        try {
          await rollbackDependabotAuthority({
            adapter,
            evaluation,
            invalidationTargets: attempted,
            observedApprovals: approvals,
          });
        } catch (cleanupError) {
          throw new AggregateError(
            [error, cleanupError],
            "ALL CLEAR recovery and rollback failed",
          );
        }
        throw error;
      }
    }
  }

  const reconciledCandidate = evaluationForCandidate(evaluation);
  if (reconciledCandidate?.disposition === "refresh-receipt-required") {
    invariant(
      typeof adapter.publishRefreshReceipt === "function",
      "Finalize phase lacks completed Refresh receipt capability",
    );
    const pending = reconciledCandidate.repairAttempts.pendingRefreshCompletion;
    invariant(pending, "Refresh completion evidence is missing");
    const receipt = {
      ...pending.requestReceipt,
      baseSha: pending.appliedBaseSha,
      headSha: reconciledCandidate.headSha,
      requestCheckId: pending.requestCheckId,
      requestDigest: pending.requestDigest,
      state: "completed",
      ...workflowContext,
    };
    await adapter.publishRefreshReceipt({
      receipt,
      repository: evaluation.repository,
    });
    mutations.push({
      headSha: reconciledCandidate.headSha,
      kind: "refresh-completed",
      pullRequestNumber: reconciledCandidate.pullRequestNumber,
    });
    return { ...evaluation, mutations, phase: "finalize" };
  }

  if (publishChecks) {
    invariant(
      typeof adapter.publishProcessorCheck === "function",
      "Finalize check publication capability is missing",
    );
    for (const result of evaluation.evaluations) {
      const snapshot = (collected.pullRequests ?? []).find((candidate) => {
        const pullRequest = normalizePullRequest(
          candidate.pullRequest ?? candidate,
        );
        return (
          pullRequest.number === result.pullRequestNumber &&
          pullRequest.headSha === result.headSha
        );
      });
      if (processorCheckAlreadyPublished({ evaluation, result, snapshot })) {
        continue;
      }
      const published = await adapter.publishProcessorCheck({
        disposition: result.disposition,
        headSha: result.headSha,
        mode: evaluation.mode,
        pullRequestNumber: result.pullRequestNumber,
        repairAttempt: result.repairAttempt,
        repairPacket: result.repairPacket,
        repository: evaluation.repository,
        workflowContext,
      });
      mutations.push({
        checkId: published.id,
        headSha: result.headSha,
        kind:
          result.repairPacket === null
            ? "processor-check-published"
            : "repair-packet-published",
        packetDigest:
          result.repairPacket === null
            ? null
            : rawDigest(canonicalJson(result.repairPacket)),
        pullRequestNumber: result.pullRequestNumber,
      });
    }
  }

  const result = evaluationForCandidate(evaluation);
  if (evaluation.mode !== "prepare" || !result) {
    return { ...evaluation, mutations, phase: "finalize" };
  }
  if (result.disposition === "feedback-remediation-required") {
    const appliedRepair = result.repairAttempts.latestAppliedRepair;
    invariant(
      appliedRepair?.receipt && appliedRepair.packetDigest,
      "Feedback remediation is missing typed repair lineage",
    );
    invariant(
      typeof adapter.replyToReviewComment === "function" &&
        typeof adapter.resolveReviewThread === "function",
      "Feedback remediation capability is missing",
    );
    for (const thread of result.feedback.actionableThreads) {
      const packetThread = appliedRepair.packet.feedbackThreads.find(
        ({ threadId }) => threadId === thread.threadId,
      );
      invariant(
        packetThread &&
          packetThread.commentId === thread.rootCommentId &&
          packetThread.digest === thread.bodyDigest,
        "Feedback remediation thread changed after repair",
      );
      const alreadyReplied = result.feedback.trustedRemediationThreads.includes(
        thread.threadId,
      );
      if (!alreadyReplied) {
        const body = `Fixed in ${result.headSha.slice(0, 12)} — Addressed by authenticated Dependabot preparation.\n\n<!-- dependabot-remediation:v1 pr=${result.pullRequestNumber} head=${result.headSha} thread=${feedbackBodyDigest(thread.threadId)} packet=${appliedRepair.packetDigest} -->`;
        await adapter.replyToReviewComment({
          body,
          commentId: thread.rootCommentId,
          pullRequestNumber: result.pullRequestNumber,
          repository: evaluation.repository,
        });
      }
      await adapter.resolveReviewThread({ threadId: thread.threadId });
      mutations.push({
        headSha: result.headSha,
        kind: alreadyReplied
          ? "feedback-resolution-retried"
          : "feedback-remediated",
        pullRequestNumber: result.pullRequestNumber,
        threadId: thread.threadId,
      });
    }
    return { ...evaluation, mutations, phase: "finalize" };
  }
  if (result.disposition !== "prepare-candidate") {
    return { ...evaluation, mutations, phase: "finalize" };
  }
  invariant(
    publishChecks &&
      typeof adapter.approvePullRequest === "function" &&
      typeof adapter.publishAllClear === "function" &&
      typeof adapter.dismissPullRequestApproval === "function",
    "Prepare finalization requires bounded approval and ALL CLEAR capabilities",
  );
  let approval = null;
  let approvalAttempted = false;
  let authorityEvaluation = evaluation;
  let postApprovalInventory = [];
  try {
    const approvalSnapshot = (collected.pullRequests ?? []).find((snapshot) => {
      const pullRequest = normalizePullRequest(
        snapshot.pullRequest ?? snapshot,
      );
      return (
        pullRequest.number === result.pullRequestNumber &&
        pullRequest.headSha === result.headSha
      );
    });
    invariant(approvalSnapshot, "Prepare candidate snapshot is missing");
    approvalAttempted = true;
    approval = await adapter.approvePullRequest({
      approvalSnapshot,
      headSha: result.headSha,
      pullRequestNumber: result.pullRequestNumber,
      repository: evaluation.repository,
    });
    invariant(
      Number.isSafeInteger(approval?.id) &&
        approval.id > 0 &&
        String(approval.state ?? "").toUpperCase() === "APPROVED",
      "Processor approval response is invalid",
    );
    mutations.push({
      approvalId: approval.id,
      headSha: result.headSha,
      kind: "approved",
      pullRequestNumber: result.pullRequestNumber,
    });
    const postApprovalSnapshot = await adapter.collectPullRequestSnapshot(
      evaluation.repository,
      result.pullRequestNumber,
    );
    postApprovalSnapshot.expectedHeadSha = result.headSha;
    const postApproval = evaluateDependabotSweep({
      mode: "prepare",
      outstandingAutoMergeRequests:
        await adapter.getOutstandingDependabotAutoMergeRequests(
          evaluation.repository,
        ),
      pullRequests: [postApprovalSnapshot],
      repository: evaluation.repository,
      workflowContext,
    });
    authorityEvaluation = postApproval;
    const admitted = evaluationForCandidate(postApproval);
    const admissionEvidence = {
      approvalId: approval.id,
      autoMergeEnabled: admitted?.feedback.autoMergeEnabled ?? null,
      baseCurrent: admitted?.base.current ?? null,
      checkState: admitted?.checks.state ?? null,
      disposition: admitted?.disposition ?? null,
      feedbackClear: admitted?.feedback.clear ?? null,
      headSha: admitted?.headSha ?? null,
      mergeable: admitted?.feedback.mergeable ?? null,
      mergeStateStatus: admitted?.feedback.mergeStateStatus ?? null,
      missingChecks: admitted?.checks.missing ?? null,
      pendingChecks: admitted?.checks.pending ?? null,
      processorApprovalCount:
        admitted?.feedback.currentProcessorApprovalCount ?? null,
      processorApprovalIds:
        admitted?.feedback.currentProcessorApprovalIds ?? null,
      reviewDecision: admitted?.feedback.reviewDecision ?? null,
    };
    invariant(
      admitted &&
        admitted.disposition === "prepare-candidate" &&
        admitted.headSha === result.headSha &&
        admitted.base.current === true &&
        admitted.checks.state === "passing" &&
        admitted.checks.missing.length === 0 &&
        admitted.checks.pending.length === 0 &&
        admitted.feedback.clear === true &&
        admitted.feedback.autoMergeEnabled === false &&
        admitted.feedback.currentProcessorApprovalCount === 1 &&
        admitted.feedback.currentProcessorApprovalIds.length === 1 &&
        admitted.feedback.currentProcessorApprovalIds[0] === approval.id &&
        admitted.feedback.mergeable === true &&
        admitted.feedback.mergeStateStatus === "CLEAN" &&
        admitted.feedback.reviewDecision === "APPROVED",
      `PR #${result.pullRequestNumber} failed final ruleset admission: ${stableJson(admissionEvidence)}`,
    );
    postApprovalInventory = normalizeApprovalInventory(
      await adapter.getOutstandingDependabotProcessorApprovals(
        evaluation.repository,
      ),
    );
    invariant(
      postApprovalInventory.length === 1 &&
        postApprovalInventory[0].approvalId === approval.id &&
        postApprovalInventory[0].pullRequestNumber ===
          admitted.pullRequestNumber &&
        postApprovalInventory[0].headSha === admitted.headSha,
      "Repository-wide processor approval inventory changed before ALL CLEAR",
    );
    const receipt = {
      autoMergeEnabled: false,
      baseSha: admitted.base.currentBaseSha,
      checksDigest: checksDigest(admitted),
      feedbackDigest: admitted.feedback.digest,
      headRef: admitted.headRef,
      headSha: admitted.headSha,
      humanAction: "merge",
      mergeAuthorizedByAutomation: false,
      mergeStateStatus: "CLEAN",
      mergeable: true,
      preparation: preparationSummary(admitted),
      processorApprovalId: approval.id,
      pullRequestNumber: admitted.pullRequestNumber,
      repository: evaluation.repository,
      reviewDecision: "APPROVED",
      riskTier: admitted.risk.tier,
      schema: DEPENDABOT_ALL_CLEAR_SCHEMA,
      updateType: admitted.risk.updateType,
      ...workflowContext,
    };
    const published = await adapter.publishAllClear({
      receipt,
      repository: evaluation.repository,
    });
    mutations.push({
      approvalId: approval.id,
      checkId: published.id,
      headSha: admitted.headSha,
      kind: "all-clear-published",
      pullRequestNumber: admitted.pullRequestNumber,
    });
    return { ...postApproval, mutations, phase: "finalize" };
  } catch (error) {
    if (approvalAttempted) {
      const observedApprovals = [...postApprovalInventory];
      if (Number.isSafeInteger(approval?.id) && approval.id > 0) {
        observedApprovals.push({
          approvalId: approval.id,
          headSha: result.headSha,
          pullRequestNumber: result.pullRequestNumber,
        });
      }
      try {
        await rollbackDependabotAuthority({
          adapter,
          evaluation: authorityEvaluation,
          invalidationTargets: [
            {
              headSha: result.headSha,
              pullRequestNumber: result.pullRequestNumber,
            },
          ],
          observedApprovals,
        });
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          `PR #${result.pullRequestNumber} finalization and cleanup failed`,
        );
      }
    }
    throw error;
  }
}

export async function processDependabotSweep({
  adapter,
  expectedHeadSha = null,
  input,
  mode,
  phase: requestedPhase,
  pullRequestNumbers = "all",
  publishChecks = false,
  repository,
  workflowContext: requestedWorkflowContext = null,
}) {
  invariant(adapter, "A GitHub adapter is required for processing");
  const phase = normalizeProcessorPhase(requestedPhase);
  const normalizedMode = normalizeProcessorMode(mode ?? input?.mode);
  const needsWorkflowContext =
    phase === "mutate" || publishChecks || normalizedMode === "prepare";
  const workflowContext = needsWorkflowContext
    ? normalizeWorkflowContext(
        requestedWorkflowContext ?? input?.workflowContext ?? {},
      )
    : null;
  let collected =
    input ??
    (await collectSweepInput({
      adapter,
      expectedHeadSha,
      mode: normalizedMode,
      pullRequestNumbers,
      repository: repositoryName(repository),
      workflowContext,
    }));
  collected = {
    ...collected,
    mode: normalizedMode,
    workflowContext: workflowContext ?? collected.workflowContext ?? null,
  };
  const evaluation = evaluateDependabotSweep(collected);
  if (phase === "request") {
    return processRequestPhase({ adapter, evaluation, workflowContext });
  }
  if (phase === "mutate") {
    return processMutatePhase({ adapter, evaluation });
  }
  return processFinalizePhase({
    adapter,
    collected,
    evaluation,
    publishChecks,
    workflowContext,
  });
}

function parsePullRequestNumbers(value) {
  if (value === undefined || value === null || value === "all") return "all";
  const values = String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map(pullRequestNumber);
  invariant(values.length > 0, "PR number list cannot be empty");
  return [...new Set(values)].sort((left, right) => left - right);
}

function parseCliArguments(rawArguments) {
  const arguments_ = [...rawArguments];
  if (arguments_[0] === "--") arguments_.shift();
  const command = arguments_.shift();
  if (command === "help" || command === "--help" || command === "-h") {
    return { command: "help", options: {} };
  }
  invariant(
    command === "evaluate" || command === "process",
    "Command must be evaluate or process",
  );
  const options = {};
  const allowedOptions = new Set([
    "expected-head-sha",
    "input",
    "live",
    "mode",
    "phase",
    "pr-numbers",
    "publish-checks",
    "repo",
  ]);
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--") continue;
    if (argument === "--help" || argument === "-h") {
      return { command: "help", options: {} };
    }
    if (argument === "--live" || argument === "--publish-checks") {
      options[argument.slice(2)] = true;
      continue;
    }
    invariant(argument.startsWith("--"), `Unexpected argument: ${argument}`);
    invariant(
      allowedOptions.has(argument.slice(2)),
      `Unsupported option: ${argument}`,
    );
    const value = arguments_[index + 1];
    invariant(
      value !== undefined && value !== "--",
      `${argument} requires a value`,
    );
    options[argument.slice(2)] = value;
    index += 1;
  }
  return { command, options };
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, stableValue(child)]),
    );
  }
  return value;
}

export function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function loadInput(path) {
  const text = readFileSync(path === "-" ? 0 : path, "utf8");
  return JSON.parse(text);
}

function filterInputPullRequests(input, pullRequestNumbers) {
  if (pullRequestNumbers === "all") return input;
  const selected = new Set(pullRequestNumbers);
  return {
    ...input,
    pullRequests: (input.pullRequests ?? []).filter((snapshot) =>
      selected.has(
        pullRequestNumber((snapshot.pullRequest ?? snapshot).number),
      ),
    ),
  };
}

async function runCli() {
  const { command, options } = parseCliArguments(process.argv.slice(2));
  if (command === "help") {
    process.stdout.write(`${DEPENDABOT_PROCESSOR_HELP}\n`);
    return;
  }
  const requestedMode = options.mode ?? process.env.DEPENDABOT_PROCESSOR_MODE;
  const phase = normalizeProcessorPhase(
    options.phase ?? process.env.DEPENDABOT_PROCESSOR_PREPARE_PHASE,
  );
  const repository =
    options.repo ??
    process.env.GITHUB_REPOSITORY ??
    process.env.DEPENDABOT_REPOSITORY;
  const pullRequestNumbers = parsePullRequestNumbers(
    options["pr-numbers"] ?? process.env.DEPENDABOT_PR_NUMBERS,
  );
  const expectedHeadSha =
    options["expected-head-sha"] ??
    process.env.DEPENDABOT_EXPECTED_HEAD_SHA ??
    null;

  let result;
  if (options.live) {
    const mode = normalizeProcessorMode(requestedMode);
    const workflowContext = normalizeWorkflowContext();
    const adapter = createLiveGitHubAdapter({
      phase: command === "process" ? phase : "finalize",
    });
    const input = await collectSweepInput({
      adapter,
      expectedHeadSha,
      mode,
      pullRequestNumbers,
      repository: repositoryName(repository),
      workflowContext,
    });
    result =
      command === "process"
        ? await processDependabotSweep({
            adapter,
            input,
            phase,
            publishChecks: Boolean(options["publish-checks"]),
            workflowContext,
          })
        : evaluateDependabotSweep(input);
  } else {
    invariant(options.input, "Pure JSON mode requires --input <path|->");
    let input = loadInput(options.input);
    if (repository) input = { ...input, repository };
    input = {
      ...input,
      mode: normalizeProcessorMode(requestedMode ?? input.mode),
    };
    input = filterInputPullRequests(input, pullRequestNumbers);
    if (expectedHeadSha !== null) {
      exactSha(expectedHeadSha, "Expected intake head SHA");
      invariant(
        input.pullRequests?.length === 1,
        "--expected-head-sha requires exactly one pull request",
      );
      input.pullRequests[0] = {
        ...input.pullRequests[0],
        expectedHeadSha,
      };
    }
    result = evaluateDependabotSweep(input);
    if (command === "process") {
      result = {
        ...result,
        mutations: [],
        phase,
        processing: {
          enabled: false,
          reason: "live-or-injected-adapter-required",
        },
      };
    }
  }
  process.stdout.write(`${stableJson(result)}\n`);
}

function isCliEntrypoint() {
  return (
    process.argv[1] !== undefined &&
    fileURLToPath(import.meta.url) === resolve(process.argv[1])
  );
}

if (isCliEntrypoint()) {
  runCli().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
