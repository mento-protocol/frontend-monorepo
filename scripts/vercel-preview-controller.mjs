#!/usr/bin/env node

import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

import {
  PREVIEW_OWNERSHIP_MODES,
  PREVIEW_TARGET_CONFIG,
  PREVIEW_TARGETS,
  previewTarget,
  previewTargetConfig,
} from "./vercel-preview-targets.mjs";

export const PREVIEW_REPOSITORY = "mento-protocol/frontend-monorepo";
const PREVIEW_STATUS_CONTEXT = "Vercel Preview";
const PREVIEW_INITIALIZATION_STATUS_CONTEXT = "Vercel Preview Journal v2";
const VERCEL_CONFIGURATION_MAX_BYTES = 2_048;
const PREVIEW_OWNER_GITHUB = "github-actions";
const PREVIEW_OWNER_NATIVE = "native-vercel";
const PREBUILT_DEPLOYMENT_SCHEMA = "mento-vercel-prebuilt/v2";
const PREVIEW_CONTROLLER_PROVENANCE = "preview-controller:v2";
export const EVENT_RECEIPT_SCHEMA = "vercel-preview-event-receipt:v2";
const WORKER_EVIDENCE_SCHEMA = "vercel-preview-worker-evidence:v2";
export const RESULT_RECEIPT_SCHEMA = "vercel-preview-worker-result:v2";
export const SELECTION_RECEIPT_SCHEMA = "vercel-preview-selection:v2";
export const CONTROLLER_SCHEMA = "vercel-preview-controller:v2";
export const PREVIEW_JOURNAL_SCHEMA = "vercel-preview-journal:v2";
export const PREVIEW_JOURNAL_MARKER = "<!-- vercel-preview-journal:v2 -->";
const PREVIEW_CHECKPOINT_SCHEMA = "vercel-preview-checkpoint:v2";
const WORKER_WORKFLOW = "vercel-preview-worker.yml";
const WORKER_WORKFLOW_NAME = "Vercel Preview Worker";
const INTAKE_WORKFLOW = "vercel-preview-intake.yml";
const INTAKE_WORKFLOW_NAME = "Vercel Preview Intake";
export const BOOTSTRAP_DISPATCH_EVENT = "vercel-preview-bootstrap";
export const RECONCILE_DISPATCH_EVENT = "vercel-preview-reconcile";
const REPOSITORY_DISPATCH_OPERATIONS = new Map([
  [BOOTSTRAP_DISPATCH_EVENT, "bootstrap"],
  [RECONCILE_DISPATCH_EVENT, "reconcile"],
]);

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const LOGIN_PATTERN =
  /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?|[A-Za-z0-9])(?:\[bot\])?$/;
const ALLOWED_EVENT_ACTIONS = new Set([
  "opened",
  "edited",
  "synchronize",
  "reopened",
  "closed",
  "bootstrap",
]);
const ALLOWED_PLAN_REASONS = new Set([
  "affected-packages",
  "non-runtime-only",
  "global-build-input",
  "invalid-commits",
  "diff-failed",
  "empty-diff",
  "turbo-planning-failed",
  "planner-job-failed",
  "unsupported-trust-boundary",
  "closed",
]);
const PREVIEW_CONTROLLER_MODES = new Set(["active", "observe-only"]);
const TERMINAL_STATES = new Set(["success", "failure", "error"]);
const RETRIABLE_TERMINAL_REASONS = new Set([
  "build-failed-retriable",
  "smoke-failed-retriable",
]);
const MAX_COMMENTS = 500;
const MAX_RECEIPTS = 200;
const MAX_HISTORY = 40;
// Recovery drains every retained slot in one pass, then ownership flips and
// terminal receipts need a small fixed number of rereads before publication.
const MAX_RECONCILIATION_PROGRESS_PASSES = MAX_HISTORY + 4;
const MAX_SERIALIZED_UPDATE_ATTEMPTS = 3;
const MAX_JOURNAL_BYTES = 60_000;
const ACTIVE_CHECKPOINT_BYTES = 40_000;
const WORKER_RUN_PAGE_SIZE = 100;
const MAX_WORKER_RUN_PAGES = 3;
const WORKER_RUN_VISIBILITY_ATTEMPTS = 3;
const WORKER_RUN_VISIBILITY_RETRY_MS = 500;
const WORKER_RUN_TITLE_RETRY_DELAY_BUDGET_MS = 30_000;
const WORKER_RUN_TITLE_RETRY_MS = 1_000;
const WORKER_RUN_TITLE_OBSERVATIONS =
  1 + WORKER_RUN_TITLE_RETRY_DELAY_BUDGET_MS / WORKER_RUN_TITLE_RETRY_MS;
const WORKER_RUN_NAME_PARSE_ERROR = "Worker run name is not strictly parseable";
const WORKER_RECOVERY_BEFORE_MS = 2 * 60 * 1_000;
const WORKER_RECOVERY_AFTER_MS = 15 * 60 * 1_000;
const UPLOAD_STARTED_DESCRIPTION = "Prebuilt preview upload starting";
const RETIRED_RECOVERY_QUARANTINE = "persisted-attempt-invalid-or-unavailable";
const NO_DISPATCH_ORPHAN_REASON = "dispatch-disabled-intent-without-worker";
const NATIVE_OWNED_SELECTION_REASON =
  "native-owned-selection-without-github-worker";
const CHECKPOINTED_TERMINAL_REASON = "checkpointed-terminal-status";
const OBSERVE_ONLY_STATUS_DESCRIPTION =
  "GitHub preview dispatch is observe-only";
const OWNERSHIP_DRAINING_STATUS_DESCRIPTION =
  "Draining GitHub preview before native ownership";
const CONTROLLER_RUN_URL_PATTERN =
  /^https:\/\/github\.com\/mento-protocol\/frontend-monorepo\/actions\/runs\/[1-9][0-9]*$/;
const SELECTION_SCOPED_CONTROLLER_RESULT_REASONS = new Set([
  NO_DISPATCH_ORPHAN_REASON,
  NATIVE_OWNED_SELECTION_REASON,
]);
const COMMENT_EXPLANATION = [
  "**No reviewer action is required.**",
  "This repository builds pull request previews in GitHub Actions and deploys them to Vercel.",
  "This record lets the preview automation handle overlapping pushes and recover safely from retries.",
  "[How previews work](https://github.com/mento-protocol/frontend-monorepo/blob/main/docs/vercel-deployments.md#event-status-and-batching-contract).",
].join(" ");
const COMMENT_DETAILS_SUMMARY =
  "Show machine-readable preview automation record";

class WorkerWorkflowShaMismatchError extends Error {
  constructor({ runId, actualWorkflowSha, expectedWorkflowSha }) {
    super("Worker workflow SHA does not match controller-authorized SHA");
    this.name = "WorkerWorkflowShaMismatchError";
    this.runId = runId;
    this.actualWorkflowSha = actualWorkflowSha;
    this.expectedWorkflowSha = expectedWorkflowSha;
  }
}

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function plainObject(value, label) {
  invariant(
    value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype,
    `${label} must be a plain object`,
  );
  return value;
}

function boundedText(value, label, maximum = 255) {
  const containsControlCharacter =
    typeof value === "string" &&
    [...value].some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint <= 31 || codePoint === 127;
    });
  invariant(
    typeof value === "string" &&
      value.length > 0 &&
      value.length <= maximum &&
      !containsControlCharacter,
    `${label} is missing or invalid`,
  );
  return value;
}

function exactSha(value, label = "Commit SHA") {
  invariant(
    typeof value === "string" && SHA_PATTERN.test(value),
    `${label} must be an immutable lowercase 40-character SHA`,
  );
  return value;
}

function previewControllerMode(value) {
  invariant(
    PREVIEW_CONTROLLER_MODES.has(value),
    "Preview controller mode must be active or observe-only",
  );
  return value;
}

function pullRequestNumber(value) {
  const text = String(value ?? "");
  invariant(/^[1-9][0-9]{0,9}$/.test(text), "PR number must be positive");
  return Number(text);
}

function validatedLogin(value, label = "PR author") {
  boundedText(value, label, 64);
  invariant(LOGIN_PATTERN.test(value), `${label} is invalid`);
  return value;
}

function validatedHeadRef(value) {
  boundedText(value, "PR head ref", 255);
  invariant(
    !value.startsWith("-") &&
      !value.startsWith("/") &&
      !value.endsWith("/") &&
      !value.endsWith(".") &&
      !value.endsWith(".lock") &&
      !value.includes("..") &&
      !value.includes("//") &&
      !value.includes("@{") &&
      !/[~^:?*[\\\s]/.test(value),
    "PR head ref is invalid",
  );
  return value;
}

function validatedWorkerHeadRef(value) {
  const headRef = validatedHeadRef(value);
  invariant(
    !headRef.startsWith("refs/"),
    "PR head ref is not supported by the prebuilt worker",
  );
  return headRef;
}

function validatedRepository(value, label = "Repository") {
  invariant(
    value === PREVIEW_REPOSITORY,
    `${label} is not the expected repository`,
  );
  return value;
}

function exactRunId(value, label = "Workflow run ID") {
  const text = String(value ?? "");
  invariant(/^[1-9][0-9]{0,19}$/.test(text), `${label} is invalid`);
  return Number(text);
}

function exactRunAttempt(value) {
  const text = String(value ?? "");
  invariant(/^[1-9][0-9]{0,5}$/.test(text), "Workflow run attempt is invalid");
  return Number(text);
}

function exactTimestamp(value) {
  boundedText(value, "Event timestamp", 64);
  const date = new Date(value);
  invariant(!Number.isNaN(date.valueOf()), "Event timestamp is invalid");
  return date.toISOString();
}

function optionalTimestamp(value, label) {
  if (value === undefined || value === null) return null;
  boundedText(value, label, 64);
  const date = new Date(value);
  invariant(!Number.isNaN(date.valueOf()), `${label} is invalid`);
  return date.toISOString();
}

function optionalHttpsUrl(value, label) {
  if (value === undefined || value === null || value === "") return null;
  boundedText(value, label, 2_048);
  const url = new URL(value);
  invariant(
    url.protocol === "https:" && !url.username && !url.password,
    `${label} must be an HTTPS URL without credentials`,
  );
  url.hash = "";
  return url.toString();
}

function immutableVercelUrl(value) {
  const url = optionalHttpsUrl(value, "Vercel deployment URL");
  if (url === null) return null;
  const parsed = new URL(url);
  invariant(
    parsed.hostname.endsWith(".vercel.app"),
    "Vercel deployment URL must be an immutable vercel.app URL",
  );
  return parsed.toString().replace(/\/$/, "");
}

function optionalNextDeploymentId(value) {
  if (value === undefined || value === null || value === "") return null;
  boundedText(value, "Next.js deployment ID", 32);
  invariant(
    /^[A-Za-z0-9_-]+$/.test(value) && !value.startsWith("dpl_"),
    "Next.js deployment ID is invalid",
  );
  return value;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(value, length = 64) {
  return createHash("sha256")
    .update(canonicalJson(value))
    .digest("hex")
    .slice(0, length);
}

function reviewerOutcomeUrl(value, target, outcome) {
  const targetState = value.state?.targets?.[target];
  if (!targetState) return null;
  if (["deployed", "runtime-equivalent"].includes(outcome)) {
    return targetState.last_successful_runtime_url ?? null;
  }
  if (outcome === "pending") return targetState.active?.html_url ?? null;
  if (!["failed", "error"].includes(outcome)) return null;
  const terminal = [...targetState.terminal_history]
    .reverse()
    .find(
      (candidate) =>
        candidate.sha === targetState.latest_desired_sha &&
        (outcome === "failed"
          ? candidate.state === "failure" ||
            (candidate.state === "error" &&
              candidate.terminal_reason === "worker-cancelled")
          : candidate.state === "error" &&
            candidate.terminal_reason !== "worker-cancelled"),
    );
  return terminalResultUrl(terminal, null);
}

function reviewerOutcomeSummary(value) {
  const latestDecision = value.state?.status_decisions?.at(-1) ?? null;
  const rows = PREVIEW_TARGETS.map((target) => {
    const outcome =
      latestDecision?.targets?.[target] ?? "awaiting reconciliation";
    const url = reviewerOutcomeUrl(value, target, outcome);
    return `| \`${target}\` | \`${outcome}\`${url ? ` ([open](${url}))` : ""} |`;
  });
  return [
    "**Preview outcomes**",
    "",
    "| Target | Outcome |",
    "| --- | --- |",
    ...rows,
  ].join("\n");
}

export function renderPreviewJournalBody(value) {
  const reviewerSummary = reviewerOutcomeSummary(value);
  const body = `${PREVIEW_JOURNAL_MARKER}\n\n${COMMENT_EXPLANATION}\n\n${reviewerSummary}\n\n<details>\n<summary>${COMMENT_DETAILS_SUMMARY}</summary>\n\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\`\n\n</details>\n`;
  invariant(
    Buffer.byteLength(body, "utf8") <= MAX_JOURNAL_BYTES,
    "Preview journal comment is too large",
  );
  return body;
}

function parseJournalBody(body) {
  invariant(typeof body === "string", "Preview journal body is missing");
  invariant(
    Buffer.byteLength(body, "utf8") <= MAX_JOURNAL_BYTES,
    "Preview journal comment is too large",
  );
  const prefix = `${PREVIEW_JOURNAL_MARKER}\n\n${COMMENT_EXPLANATION}\n\n`;
  const jsonPrefix = `\n\n<details>\n<summary>${COMMENT_DETAILS_SUMMARY}</summary>\n\n\`\`\`json\n`;
  const suffix = "\n```\n\n</details>\n";
  const jsonPrefixIndex = body.indexOf(jsonPrefix, prefix.length);
  invariant(
    body.startsWith(prefix) &&
      jsonPrefixIndex > prefix.length &&
      body.indexOf(jsonPrefix, jsonPrefixIndex + 1) === -1 &&
      body.endsWith(suffix),
    "Preview journal JSON block is missing",
  );
  return JSON.parse(
    body.slice(jsonPrefixIndex + jsonPrefix.length, -suffix.length),
  );
}

function isTrustedGitHubActionsBot(actor) {
  return actor?.type === "Bot" && actor?.login === "github-actions[bot]";
}

function isTrustedBotComment(comment) {
  return isTrustedGitHubActionsBot(comment?.user);
}

function classifyTrust({ headRepository, headRef, author }) {
  validatedHeadRef(headRef);
  validatedLogin(author);
  const normalizedAuthor = author.toLowerCase();
  const normalizedHeadRef = headRef.toLowerCase();
  if (
    normalizedAuthor === "dependabot[bot]" ||
    normalizedHeadRef === "dependabot" ||
    normalizedHeadRef.startsWith("dependabot/")
  ) {
    return "dependabot";
  }
  if (headRef.startsWith("refs/")) return "unsupported-ref";
  return headRepository === PREVIEW_REPOSITORY ? "trusted" : "fork";
}

function normalizePullRequest(raw) {
  plainObject(raw, "Pull request");
  const headRepository = boundedText(
    raw.head?.repo?.full_name,
    "PR head repository",
    255,
  );
  const headRef = validatedHeadRef(raw.head?.ref);
  const author = validatedLogin(raw.user?.login);
  const state = boundedText(raw.state, "PR state", 16);
  invariant(state === "open" || state === "closed", "PR state is invalid");
  return {
    number: pullRequestNumber(raw.number),
    state,
    baseSha: exactSha(raw.base?.sha, "Trusted base SHA"),
    headSha: exactSha(raw.head?.sha, "Head SHA"),
    headRef,
    headRepository,
    author,
    trust: classifyTrust({ headRepository, headRef, author }),
    updatedAt: exactTimestamp(raw.updated_at),
    closedAt: optionalTimestamp(raw.closed_at, "PR closed timestamp"),
  };
}

function representedPullRequest(events, checkpoint = null) {
  const represented = [
    ...events,
    ...(checkpoint?.event ? [checkpoint.event] : []),
  ].map((event) => validateEventReceipt(event));
  invariant(
    represented.length > 0,
    "Preview receipt graph has no represented pull",
  );
  const latestUpdatedAt = represented
    .map((event) => event.pr_updated_at)
    .sort()
    .at(-1);
  const latest = represented.filter(
    (event) => event.pr_updated_at === latestUpdatedAt,
  );
  const snapshots = new Map();
  for (const event of latest) {
    const snapshot = {
      number: event.pr,
      state: event.pr_state,
      baseSha: event.trusted_base_sha,
      headSha: event.head_sha,
      headRef: event.head_ref,
      headRepository: event.head_repository,
      author: event.pr_author,
      trust: event.trust,
      updatedAt: event.pr_updated_at,
      closedAt: event.pr_closed_at,
    };
    snapshots.set(canonicalJson(snapshot), snapshot);
  }
  invariant(
    snapshots.size === 1,
    "Latest represented pull request state is ambiguous",
  );
  return [...snapshots.values()][0];
}

export function snapshotPullRequestEvent(payload, runId, runNumber = null) {
  plainObject(payload, "GitHub event payload");
  const action = boundedText(payload.action, "Event action", 32);
  invariant(
    ALLOWED_EVENT_ACTIONS.has(action) && action !== "bootstrap",
    "Unsupported PR action",
  );
  const pull = normalizePullRequest(payload.pull_request);
  const repository = validatedRepository(payload.repository?.full_name);
  if (action === "edited") {
    plainObject(payload.changes, "Edited PR changes");
    plainObject(payload.changes.base, "Edited PR base change");
  }
  const before =
    action === "synchronize" ? exactSha(payload.before, "Before SHA") : null;
  const changeBaseSha = action === "synchronize" ? before : pull.baseSha;
  return {
    schema: EVENT_RECEIPT_SCHEMA,
    repository,
    pr: pull.number,
    event_run_id: exactRunId(runId),
    ...(runNumber === null
      ? {}
      : { event_run_number: exactRunId(runNumber, "Event run number") }),
    event_action: action,
    pr_state: pull.state,
    pr_updated_at: pull.updatedAt,
    pr_closed_at: pull.closedAt,
    trusted_base_sha: pull.baseSha,
    change_base_sha: changeBaseSha,
    head_sha: pull.headSha,
    before_sha: before,
    head_ref: pull.headRef,
    head_repository: pull.headRepository,
    pr_author: pull.author,
    trust: pull.trust,
  };
}

function snapshotBootstrapPullRequest(rawPull, runId, runNumber = null) {
  const pull = normalizePullRequest(rawPull);
  invariant(pull.state === "open", "Bootstrap requires an open PR");
  return {
    schema: EVENT_RECEIPT_SCHEMA,
    repository: PREVIEW_REPOSITORY,
    pr: pull.number,
    event_run_id: exactRunId(runId),
    ...(runNumber === null
      ? {}
      : { event_run_number: exactRunId(runNumber, "Event run number") }),
    event_action: "bootstrap",
    pr_state: pull.state,
    pr_updated_at: pull.updatedAt,
    pr_closed_at: pull.closedAt,
    trusted_base_sha: pull.baseSha,
    change_base_sha: pull.baseSha,
    head_sha: pull.headSha,
    before_sha: null,
    head_ref: pull.headRef,
    head_repository: pull.headRepository,
    pr_author: pull.author,
    trust: pull.trust,
  };
}

export function normalizePlannerResult(
  raw,
  snapshot,
  plannerOutcome = "success",
) {
  const event = validateEventReceipt(
    { ...snapshot, plan: undefined },
    { requirePlan: false },
  );
  if (event.event_action === "closed") {
    return {
      targets: [],
      reason: "closed",
      base: event.change_base_sha,
      head: event.head_sha,
      planner_source_sha: event.trusted_base_sha,
    };
  }
  if (event.trust !== "trusted") {
    return {
      targets: [],
      reason: "unsupported-trust-boundary",
      base: event.change_base_sha,
      head: event.head_sha,
      planner_source_sha: event.trusted_base_sha,
    };
  }
  if (
    plannerOutcome !== "success" ||
    raw === undefined ||
    raw === null ||
    raw === ""
  ) {
    return {
      targets: [...PREVIEW_TARGETS],
      reason: "planner-job-failed",
      base: event.change_base_sha,
      head: event.head_sha,
      planner_source_sha: event.trusted_base_sha,
    };
  }
  const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  plainObject(parsed, "Planner result");
  invariant(
    Array.isArray(parsed.deployments),
    "Planner deployments must be an array",
  );
  const allowed = PREVIEW_TARGETS;
  invariant(
    parsed.deployments.length <= allowed.length,
    "Planner returned too many targets",
  );
  invariant(
    parsed.deployments.every(
      (target, index) =>
        allowed.includes(target) &&
        (index === 0 ||
          allowed.indexOf(target) >
            allowed.indexOf(parsed.deployments[index - 1])),
    ),
    "Planner targets are malformed or unordered",
  );
  const reason = boundedText(parsed.reason, "Planner reason", 64);
  invariant(ALLOWED_PLAN_REASONS.has(reason), "Planner reason is not allowed");
  invariant(
    exactSha(parsed.base, "Planner base SHA") === event.change_base_sha,
    "Planner base SHA does not match event",
  );
  invariant(
    exactSha(parsed.head, "Planner head SHA") === event.head_sha,
    "Planner head SHA does not match event",
  );
  return {
    targets: [...parsed.deployments],
    reason,
    base: event.change_base_sha,
    head: event.head_sha,
    planner_source_sha: event.trusted_base_sha,
  };
}

function validatePlan(plan, event) {
  plainObject(plan, "Event plan");
  invariant(
    Array.isArray(plan.targets) &&
      plan.targets.length <= PREVIEW_TARGETS.length,
    "Plan targets are invalid",
  );
  invariant(
    plan.targets.every(
      (target, index) =>
        PREVIEW_TARGETS.includes(target) &&
        (index === 0 ||
          PREVIEW_TARGETS.indexOf(target) >
            PREVIEW_TARGETS.indexOf(plan.targets[index - 1])),
    ),
    "Plan targets are malformed or unordered",
  );
  invariant(
    ALLOWED_PLAN_REASONS.has(boundedText(plan.reason, "Plan reason", 64)),
    "Plan reason is invalid",
  );
  invariant(
    exactSha(plan.base, "Plan base") === event.change_base_sha,
    "Plan base mismatch",
  );
  invariant(
    exactSha(plan.head, "Plan head") === event.head_sha,
    "Plan head mismatch",
  );
  invariant(
    exactSha(plan.planner_source_sha, "Planner source") ===
      event.trusted_base_sha,
    "Planner source mismatch",
  );
  if (event.trust !== "trusted" || event.event_action === "closed") {
    invariant(
      plan.targets.length === 0,
      "Unsupported or closed events cannot target a worker",
    );
  }
  return plan;
}

export function validateEventReceipt(value, { requirePlan = true } = {}) {
  const event = plainObject(value, "Event receipt");
  invariant(
    event.schema === EVENT_RECEIPT_SCHEMA,
    "Event receipt schema mismatch",
  );
  validatedRepository(event.repository);
  pullRequestNumber(event.pr);
  exactRunId(event.event_run_id, "Event run ID");
  if (event.event_run_number !== undefined) {
    exactRunId(event.event_run_number, "Event run number");
  }
  invariant(
    ALLOWED_EVENT_ACTIONS.has(event.event_action),
    "Event receipt action is invalid",
  );
  invariant(
    event.pr_state === "open" || event.pr_state === "closed",
    "Event PR state is invalid",
  );
  exactTimestamp(event.pr_updated_at);
  optionalTimestamp(event.pr_closed_at, "Event PR closed timestamp");
  exactSha(event.trusted_base_sha, "Trusted base SHA");
  exactSha(event.change_base_sha, "Change base SHA");
  exactSha(event.head_sha, "Head SHA");
  if (event.before_sha !== null) exactSha(event.before_sha, "Before SHA");
  validatedHeadRef(event.head_ref);
  boundedText(event.head_repository, "Head repository", 255);
  validatedLogin(event.pr_author);
  invariant(
    ["trusted", "fork", "dependabot", "unsupported-ref"].includes(event.trust),
    "Event trust is invalid",
  );
  invariant(
    event.trust ===
      classifyTrust({
        headRepository: event.head_repository,
        headRef: event.head_ref,
        author: event.pr_author,
      }),
    "Event trust classification mismatch",
  );
  if (event.event_action === "synchronize") {
    invariant(
      event.before_sha === event.change_base_sha,
      "Synchronize receipt must plan before -> head",
    );
  } else {
    invariant(
      event.before_sha === null,
      "Only synchronize receipts may have before SHA",
    );
  }
  if (event.event_action === "closed") {
    invariant(
      event.pr_state === "closed" && event.pr_closed_at !== null,
      "Closed event requires closed lifecycle evidence",
    );
  } else {
    invariant(
      event.pr_state === "open" && event.pr_closed_at === null,
      "Open lifecycle event has inconsistent closed evidence",
    );
  }
  if (requirePlan) validatePlan(event.plan, event);
  return event;
}

function semanticEventKey(event) {
  const receipt = validateEventReceipt(event);
  return canonicalJson({
    action: receipt.event_action,
    pr_state: receipt.pr_state,
    pr_updated_at: receipt.pr_updated_at,
    pr_closed_at: receipt.pr_closed_at,
    trusted_base_sha: receipt.trusted_base_sha,
    change_base_sha: receipt.change_base_sha,
    before_sha: receipt.before_sha,
    head_sha: receipt.head_sha,
    head_ref: receipt.head_ref,
    head_repository: receipt.head_repository,
    pr_author: receipt.pr_author,
    trust: receipt.trust,
    plan: receipt.plan,
  });
}

function anchorAliasKey(event) {
  const receipt = validateEventReceipt(event);
  return canonicalJson({
    pr_state: receipt.pr_state,
    pr_updated_at: receipt.pr_updated_at,
    pr_closed_at: receipt.pr_closed_at,
    trusted_base_sha: receipt.trusted_base_sha,
    change_base_sha: receipt.change_base_sha,
    before_sha: receipt.before_sha,
    head_sha: receipt.head_sha,
    head_ref: receipt.head_ref,
    head_repository: receipt.head_repository,
    pr_author: receipt.pr_author,
    trust: receipt.trust,
    plan: receipt.plan,
  });
}

export function controllerKey(prNumber, sha, target) {
  const logicalTarget = previewTarget(target);
  return `vercel-preview:v1:pr:${pullRequestNumber(prNumber)}:target:${logicalTarget}:sha:${exactSha(sha)}`;
}

function controllerKeyDigest(
  key,
  { epochAnchorRunId, basisDigest, selectionReceiptRunId, expectedWorkflowSha },
) {
  boundedText(key, "Controller key", 255);
  exactRunId(epochAnchorRunId, "Epoch anchor run ID");
  invariant(
    /^[0-9a-f]{64}$/.test(basisDigest),
    "Reconciliation basis digest is invalid",
  );
  exactRunId(selectionReceiptRunId, "Selection receipt run ID");
  exactSha(expectedWorkflowSha, "Expected worker workflow SHA");
  return digest(
    {
      key,
      epoch_anchor_run_id: epochAnchorRunId,
      reconciliation_basis_digest: basisDigest,
      selection_receipt_run_id: selectionReceiptRunId,
      expected_workflow_sha: expectedWorkflowSha,
    },
    24,
  );
}

function validateSelectionReceipt(value) {
  const selection = plainObject(value, "Preview selection receipt");
  invariant(
    selection.schema === SELECTION_RECEIPT_SCHEMA,
    "Preview selection receipt schema mismatch",
  );
  validatedRepository(selection.repository);
  const pr = pullRequestNumber(selection.pr);
  const target = previewTarget(selection.target, "Preview selection target");
  const sha = exactSha(selection.sha);
  const key = controllerKey(pr, sha, target);
  invariant(selection.key === key, "Preview selection key mismatch");
  const epochAnchorRunId = exactRunId(
    selection.epoch_anchor_run_id,
    "Preview selection epoch anchor run ID",
  );
  invariant(
    /^[0-9a-f]{64}$/.test(selection.reconciliation_basis_digest),
    "Preview selection reconciliation basis digest is invalid",
  );
  const selectionReceiptRunId = exactRunId(
    selection.selection_receipt_run_id,
    "Preview selection event receipt run ID",
  );
  const expectedWorkflowSha = exactSha(
    selection.expected_workflow_sha,
    "Preview selection expected workflow SHA",
  );
  invariant(
    selection.key_digest ===
      controllerKeyDigest(key, {
        epochAnchorRunId,
        basisDigest: selection.reconciliation_basis_digest,
        selectionReceiptRunId,
        expectedWorkflowSha,
      }),
    "Preview selection digest mismatch",
  );
  invariant(
    Array.isArray(selection.coalesced_receipt_run_ids) &&
      selection.coalesced_receipt_run_ids.length <= MAX_RECEIPTS,
    "Preview selection coalescing evidence is invalid",
  );
  const coalesced = new Set();
  for (const runId of selection.coalesced_receipt_run_ids) {
    const exact = exactRunId(runId, "Coalesced event receipt run ID");
    invariant(
      exact !== selectionReceiptRunId && !coalesced.has(exact),
      "Preview selection coalescing evidence is duplicated or self-referential",
    );
    coalesced.add(exact);
  }
  return selection;
}

export function selectionReceiptFromDispatch(selection) {
  const dispatch = validateActiveDispatch(
    selection,
    selection.pr,
    "Persisted selection dispatch",
  );
  return validateSelectionReceipt({
    schema: SELECTION_RECEIPT_SCHEMA,
    repository: PREVIEW_REPOSITORY,
    pr: dispatch.pr,
    target: dispatch.target,
    sha: dispatch.sha,
    key: dispatch.key,
    key_digest: dispatch.key_digest,
    epoch_anchor_run_id: dispatch.epoch_anchor_run_id,
    reconciliation_basis_digest: dispatch.reconciliation_basis_digest,
    selection_receipt_run_id: dispatch.selection_receipt_run_id,
    expected_workflow_sha: dispatch.expected_workflow_sha,
    coalesced_receipt_run_ids: dispatch.coalesced_receipt_run_ids,
  });
}

export function workerRunName({ pr, target, sha, keyDigest }) {
  return `Vercel preview worker | pr=${pullRequestNumber(pr)} | target=${previewTarget(target)} | sha=${exactSha(sha)} | key=${boundedText(keyDigest, "Key digest", 24)}`;
}

export function dependabotIntakeRunName({ pr, sha, action }) {
  const eventAction = boundedText(action, "Dependabot intake action", 32);
  invariant(
    ALLOWED_EVENT_ACTIONS.has(eventAction) && eventAction !== "bootstrap",
    "Dependabot intake action is invalid",
  );
  return `Vercel preview intake | pr=${pullRequestNumber(pr)} | sha=${exactSha(sha)} | action=${eventAction}`;
}

function parseDependabotIntakeRunName(value) {
  boundedText(value, "Dependabot intake run name", 255);
  const match = value.match(
    /^Vercel preview intake \| pr=([1-9][0-9]{0,9}) \| sha=([0-9a-f]{40}) \| action=([a-z]+)$/,
  );
  invariant(match, "Dependabot intake run name is malformed");
  const action = boundedText(match[3], "Dependabot intake action", 32);
  invariant(
    ALLOWED_EVENT_ACTIONS.has(action) && action !== "bootstrap",
    "Dependabot intake action is invalid",
  );
  return {
    pr: pullRequestNumber(match[1]),
    sha: exactSha(match[2]),
    action,
  };
}

export function parseWorkerRunName(value) {
  const match = String(value ?? "").match(
    /^Vercel preview worker \| pr=([1-9][0-9]{0,9}) \| target=(app|governance|reserve|ui) \| sha=([0-9a-f]{40}) \| key=([0-9a-f]{24})$/,
  );
  invariant(match, WORKER_RUN_NAME_PARSE_ERROR);
  return {
    pr: pullRequestNumber(match[1]),
    target: previewTarget(match[2], "Worker run target"),
    sha: exactSha(match[3]),
    keyDigest: match[4],
  };
}

export function validateWorkerResult(value) {
  const result = plainObject(value, "Worker result");
  invariant(
    result.schema === RESULT_RECEIPT_SCHEMA,
    "Worker result schema mismatch",
  );
  validatedRepository(result.repository);
  pullRequestNumber(result.pr);
  const target = previewTarget(result.target, "Worker result target");
  exactSha(result.sha);
  const expectedKey = controllerKey(result.pr, result.sha, target);
  invariant(
    result.controller_key === expectedKey,
    "Worker result controller key mismatch",
  );
  exactRunId(result.epoch_anchor_run_id, "Result epoch anchor run ID");
  invariant(
    /^[0-9a-f]{64}$/.test(result.reconciliation_basis_digest),
    "Result reconciliation basis digest is invalid",
  );
  exactRunId(
    result.selection_receipt_run_id,
    "Result selection receipt run ID",
  );
  exactSha(result.expected_workflow_sha, "Result expected workflow SHA");
  invariant(
    result.key_digest ===
      controllerKeyDigest(expectedKey, {
        epochAnchorRunId: result.epoch_anchor_run_id,
        basisDigest: result.reconciliation_basis_digest,
        selectionReceiptRunId: result.selection_receipt_run_id,
        expectedWorkflowSha: result.expected_workflow_sha,
      }),
    "Worker result key digest mismatch",
  );
  exactRunId(result.worker_run_id, "Worker run ID");
  exactRunAttempt(result.worker_run_attempt);
  if (result.github_deployment_id !== null)
    exactRunId(result.github_deployment_id, "GitHub Deployment ID");
  invariant(
    TERMINAL_STATES.has(result.state),
    "Worker result state is not terminal",
  );
  if (result.vercel_deployment_id !== null)
    boundedText(result.vercel_deployment_id, "Vercel deployment ID", 128);
  optionalNextDeploymentId(result.next_deployment_id);
  const url = immutableVercelUrl(result.vercel_deployment_url);
  invariant(
    ["passed", "failed", "not-run"].includes(result.smoke_result),
    "Smoke result is invalid",
  );
  boundedText(result.terminal_reason, "Terminal reason", 128);
  if (result.state === "success") {
    invariant(
      result.github_deployment_id !== null &&
        url !== null &&
        result.smoke_result === "passed",
      "Successful result requires verified deployment evidence",
    );
  }
  return result;
}

function validateWorkerEvidence(value) {
  const evidence = plainObject(value, "Worker evidence");
  invariant(
    evidence.schema === WORKER_EVIDENCE_SCHEMA,
    "Worker evidence schema mismatch",
  );
  validatedRepository(evidence.repository);
  pullRequestNumber(evidence.pr);
  const target = previewTarget(evidence.target, "Worker evidence target");
  exactSha(evidence.sha);
  const expectedKey = controllerKey(evidence.pr, evidence.sha, target);
  invariant(
    evidence.controller_key === expectedKey,
    "Worker evidence controller key mismatch",
  );
  exactRunId(evidence.epoch_anchor_run_id);
  invariant(
    /^[0-9a-f]{64}$/.test(evidence.reconciliation_basis_digest),
    "Worker evidence basis digest is invalid",
  );
  exactRunId(evidence.selection_receipt_run_id);
  exactSha(evidence.expected_workflow_sha, "Evidence expected workflow SHA");
  invariant(
    evidence.key_digest ===
      controllerKeyDigest(expectedKey, {
        epochAnchorRunId: evidence.epoch_anchor_run_id,
        basisDigest: evidence.reconciliation_basis_digest,
        selectionReceiptRunId: evidence.selection_receipt_run_id,
        expectedWorkflowSha: evidence.expected_workflow_sha,
      }),
    "Worker evidence key digest mismatch",
  );
  exactRunId(evidence.worker_run_id);
  exactRunAttempt(evidence.worker_run_attempt);
  exactRunId(evidence.github_deployment_id, "GitHub Deployment ID");
  invariant(
    ["build", "build-retry", "resume-smoke", "reuse-success"].includes(
      evidence.execution_mode,
    ),
    "Worker evidence execution mode is invalid",
  );
  invariant(
    typeof evidence.build_completed === "boolean",
    "Worker evidence build flag is invalid",
  );
  if (evidence.vercel_deployment_id !== null) {
    boundedText(evidence.vercel_deployment_id, "Vercel deployment ID", 128);
  }
  optionalNextDeploymentId(evidence.next_deployment_id);
  immutableVercelUrl(evidence.verified_upload_url);
  return evidence;
}

function dedupeEvents(events, preferredRunIds = new Set()) {
  invariant(events.length <= MAX_RECEIPTS, "Too many event receipts");
  const byRun = new Map();
  const semantic = new Map();
  for (const raw of events) {
    const event = validateEventReceipt(raw);
    const priorRun = byRun.get(event.event_run_id);
    if (priorRun) {
      invariant(
        canonicalJson(priorRun) === canonicalJson(event),
        "One event run ID has conflicting immutable receipts",
      );
      continue;
    }
    byRun.set(event.event_run_id, event);
    const key = semanticEventKey(event);
    const previous = semantic.get(key);
    if (!previous) {
      semantic.set(key, event);
      continue;
    }
    const previousIsPreferred = preferredRunIds.has(previous.event_run_id);
    const eventIsPreferred = preferredRunIds.has(event.event_run_id);
    invariant(
      !(previousIsPreferred && eventIsPreferred),
      "Semantic duplicate receipts have conflicting persisted ownership",
    );
    if (
      eventIsPreferred ||
      (!previousIsPreferred && event.event_run_id < previous.event_run_id)
    ) {
      semantic.set(key, event);
    }
  }
  return [...semantic.values()];
}

function persistedEventRunIds(state, results, selections) {
  const runIds = new Set();
  const add = (value) => {
    if (value !== null && value !== undefined) runIds.add(exactRunId(value));
  };
  if (state) {
    add(state.epoch.anchor_run_id);
    for (const target of PREVIEW_TARGETS) {
      const targetState = state.targets[target];
      add(targetState.idle_cursor_receipt_run_id);
      add(targetState.latest_desired_receipt_run_id);
      for (const selection of [
        targetState.active,
        ...targetState.retired_active,
        ...targetState.terminal_history,
      ].filter(Boolean)) {
        add(selection.epoch_anchor_run_id);
        add(selection.selection_receipt_run_id);
      }
    }
  }
  for (const result of results) {
    add(result.epoch_anchor_run_id);
    add(result.selection_receipt_run_id);
  }
  for (const selection of selections) {
    add(selection.epoch_anchor_run_id);
    add(selection.selection_receipt_run_id);
    for (const runId of selection.coalesced_receipt_run_ids) add(runId);
  }
  return runIds;
}

function dedupeResults(results) {
  invariant(results.length <= MAX_RECEIPTS, "Too many worker result receipts");
  const byRun = new Map();
  for (const raw of results) {
    const result = validateWorkerResult(raw);
    // One no-dispatch controller run may retire same-SHA selections from
    // multiple epochs. Those synthetic receipts are selection-scoped; every
    // other controller or real-worker result keeps the stricter run owner.
    const runOwner = SELECTION_SCOPED_CONTROLLER_RESULT_REASONS.has(
      result.terminal_reason,
    )
      ? result.key_digest
      : result.controller_key;
    const key = `${runOwner}:${result.worker_run_id}`;
    const previous = byRun.get(key);
    if (previous)
      invariant(
        canonicalJson(previous) === canonicalJson(result),
        "Conflicting worker result receipts",
      );
    byRun.set(key, result);
  }
  return [...byRun.values()];
}

function dedupeSelectionReceipts(selections) {
  invariant(
    selections.length <= MAX_RECEIPTS,
    "Too many preview selection receipts",
  );
  const byKey = new Map();
  for (const raw of selections) {
    const selection = validateSelectionReceipt(raw);
    const previous = byKey.get(selection.key_digest);
    if (previous)
      invariant(
        canonicalJson(previous) === canonicalJson(selection),
        "Conflicting preview selection receipts",
      );
    byKey.set(selection.key_digest, selection);
  }
  return [...byKey.values()];
}

function controllerReceiptsDigest(
  events,
  results,
  selections,
  pr,
  checkpoint = null,
) {
  const receiptDigest = {
    events: dedupeEvents(events)
      .filter((event) => event.pr === pr)
      .map(semanticEventKey)
      .sort(),
    results: dedupeResults(results)
      .filter((result) => result.pr === pr)
      .map(canonicalJson)
      .sort(),
    selections: dedupeSelectionReceipts(selections)
      .filter((selection) => selection.pr === pr)
      .map(canonicalJson)
      .sort(),
  };
  return checkpoint
    ? digest({
        checkpoint_digest: checkpoint.cumulative_receipts_digest,
        receipts: receiptDigest,
      })
    : digest(receiptDigest);
}

function eventInstanceId(event) {
  return `run:${exactRunId(event.event_run_id)}`;
}

function samePullIdentity(event, pullOrAnchor) {
  const headRef = pullOrAnchor.headRef ?? pullOrAnchor.head_ref;
  const headRepository =
    pullOrAnchor.headRepository ?? pullOrAnchor.head_repository;
  const author = pullOrAnchor.author ?? pullOrAnchor.pr_author;
  const trust = pullOrAnchor.trust;
  return (
    event.head_ref === headRef &&
    event.head_repository === headRepository &&
    event.pr_author === author &&
    event.trust === trust
  );
}

function findLineagePaths(anchor, events, pull, epochClosedAt) {
  const lower = anchor.pr_updated_at;
  const upper = epochClosedAt ?? pull.updatedAt;
  const edges = events.filter(
    (event) =>
      event.event_action === "synchronize" &&
      samePullIdentity(event, anchor) &&
      event.pr_updated_at >= lower &&
      event.pr_updated_at <= upper,
  );
  const paths = [];
  const visit = (sha, path, used) => {
    invariant(
      path.length <= MAX_RECEIPTS,
      "Event transition graph is cyclic or too large",
    );
    const outgoing = edges.filter(
      (edge) =>
        edge.change_base_sha === sha && !used.has(eventInstanceId(edge)),
    );
    if (sha === pull.headSha && outgoing.length === 0) {
      paths.push(path);
      invariant(paths.length <= 2, "Ambiguous event lineage");
      return;
    }
    for (const edge of outgoing) {
      const edgeId = eventInstanceId(edge);
      visit(edge.head_sha, [...path, edge], new Set([...used, edgeId]));
    }
  };
  visit(anchor.head_sha, [anchor], new Set());
  return paths;
}

function selectCurrentEpoch(events, pull, checkpoint = null) {
  const checkpointEvent = checkpoint?.event ?? null;
  const anchorCandidates = [
    ...events.filter((event) =>
      ["opened", "edited", "reopened", "bootstrap"].includes(
        event.event_action,
      ),
    ),
    ...(checkpointEvent ? [checkpointEvent] : []),
  ]
    .filter(
      (event) => event.pr === pull.number && samePullIdentity(event, pull),
    )
    .filter((event) => event.pr_updated_at <= pull.updatedAt);
  const nonBootstrapAnchorKeys = new Set(
    anchorCandidates
      .filter((event) => event.event_action !== "bootstrap")
      .map(anchorAliasKey),
  );
  const anchors = anchorCandidates
    .filter(
      (event) =>
        event.event_action !== "bootstrap" ||
        !nonBootstrapAnchorKeys.has(anchorAliasKey(event)),
    )
    .sort((a, b) => b.pr_updated_at.localeCompare(a.pr_updated_at));
  invariant(
    anchors.length > 0,
    "No opened, edited, reopened, or bootstrap anchor receipt exists",
  );

  const candidates = [];
  for (const anchor of anchors) {
    const closures = [
      ...events,
      ...(checkpointEvent ? [checkpointEvent] : []),
    ].filter(
      (event) =>
        event.event_action === "closed" &&
        event.pr === pull.number &&
        samePullIdentity(event, anchor) &&
        event.pr_updated_at >= anchor.pr_updated_at &&
        event.pr_closed_at !== null,
    );
    let closure = null;
    if (pull.state === "closed") {
      const matching = closures.filter(
        (event) => event.pr_closed_at === pull.closedAt,
      );
      invariant(matching.length <= 1, "Current closure lifecycle is ambiguous");
      if (matching.length === 0) continue;
      [closure] = matching;
    }
    const paths = findLineagePaths(
      anchor,
      events,
      pull,
      closure?.pr_updated_at ?? null,
    );
    invariant(
      paths.length <= 1,
      "Ambiguous event lineage reaches current head",
    );
    if (paths.length === 1) {
      candidates.push({
        anchor,
        closure,
        lineage: paths[0],
        checkpoint:
          checkpointEvent?.event_run_id === anchor.event_run_id
            ? checkpoint
            : null,
      });
      if (
        anchors[1]?.pr_updated_at !== anchor.pr_updated_at &&
        candidates.length === 1
      ) {
        break;
      }
    }
  }
  invariant(
    candidates.length === 1,
    "Current PR epoch is missing or ambiguous",
  );
  return candidates[0];
}

function resultForSelection(results, anchorRunId, event, selection, target) {
  const logicalTarget = previewTarget(target);
  return (
    results
      .filter(
        (result) =>
          result.target === logicalTarget &&
          result.epoch_anchor_run_id === anchorRunId &&
          result.selection_receipt_run_id === event.event_run_id &&
          result.controller_key ===
            controllerKey(result.pr, event.head_sha, logicalTarget) &&
          (!selection ||
            (result.reconciliation_basis_digest ===
              selection.reconciliation_basis_digest &&
              result.key_digest === selection.key_digest &&
              result.expected_workflow_sha ===
                selection.expected_workflow_sha)),
      )
      .sort(
        (a, b) =>
          b.worker_run_id - a.worker_run_id ||
          b.worker_run_attempt - a.worker_run_attempt,
      )[0] ?? null
  );
}

function nativeOwnedStatusDescription(target) {
  return `${previewTarget(target)}: native Vercel owns preview`;
}

function statusFromCheckpointRuntime({
  target,
  runtimeEvent,
  checkpointStatus,
  controllerUrl,
}) {
  if (isNativeOwnedCheckpointStatus(checkpointStatus, runtimeEvent, target)) {
    return {
      state: "success",
      outcome: "native-owned",
      description: nativeOwnedStatusDescription(target),
      target_url: controllerUrl,
    };
  }
  if (checkpointStatus.state === "success") {
    return {
      state: "success",
      outcome: "runtime-equivalent",
      description: `${target}: runtime-equivalent to ${runtimeEvent.head_sha.slice(0, 7)}`,
      target_url: checkpointStatus.target_url,
    };
  }
  if (checkpointStatus.state === "failure") {
    const cancelled = checkpointStatus.description.includes("cancelled");
    return {
      state: "failure",
      outcome: "failed",
      description: cancelled
        ? `${target}: runtime ${runtimeEvent.head_sha.slice(0, 7)} cancelled`
        : `${target}: runtime ${runtimeEvent.head_sha.slice(0, 7)} failed`,
      target_url: checkpointStatus.target_url ?? controllerUrl,
    };
  }
  if (checkpointStatus.state === "pending") {
    return {
      state: "pending",
      outcome: "pending",
      description: `${target}: waiting for ${runtimeEvent.head_sha.slice(0, 7)}`,
      target_url: checkpointStatus.target_url ?? controllerUrl,
    };
  }
  return {
    state: "error",
    outcome: "error",
    description: `${target}: runtime ${runtimeEvent.head_sha.slice(0, 7)} errored`,
    target_url: checkpointStatus.target_url ?? controllerUrl,
  };
}

function isControllerRunStatusDecision(status, state, description) {
  return (
    status?.state === state &&
    status.description === description &&
    CONTROLLER_RUN_URL_PATTERN.test(status.target_url ?? "")
  );
}

function isNativeOwnedStatusDecision(status, target) {
  return isControllerRunStatusDecision(
    status,
    "success",
    nativeOwnedStatusDescription(target),
  );
}

function isNativeOwnedCheckpointStatus(status, event, target) {
  return (
    isNativeOwnedStatusDecision(status, target) &&
    event.trust === "trusted" &&
    event.pr_state === "open"
  );
}

function targetStatusDecision({
  target,
  event,
  index,
  lineage,
  resultByRun,
  active,
  coalescedToByRun,
  controllerUrl,
  checkpointStatus,
  checkpointBaselineStatus,
  checkpointRuntimeEvent,
}) {
  if (checkpointStatus) return structuredClone(checkpointStatus);
  if (event.trust !== "trusted") {
    return {
      state: "success",
      outcome: "unsupported trust boundary",
      description: `${target}: unsupported trust boundary`,
      target_url: controllerUrl,
    };
  }
  const eligible = event.plan.targets.includes(target);
  const result = resultByRun.get(event.event_run_id);
  if (eligible && result?.terminal_reason === NATIVE_OWNED_SELECTION_REASON) {
    return {
      state: "success",
      outcome: "native-owned",
      description: nativeOwnedStatusDescription(target),
      target_url: controllerUrl,
    };
  }
  if (eligible && result?.state === "success") {
    return {
      state: "success",
      outcome: "deployed",
      description: `${target}: deployed and smoke verified`,
      target_url: result.vercel_deployment_url,
    };
  }
  if (eligible && result?.state === "failure") {
    return {
      state: "failure",
      outcome: "failed",
      description: `${target}: build, deploy, or smoke failed`,
      target_url: terminalResultUrl(result, controllerUrl),
    };
  }
  if (eligible && result?.state === "error") {
    const cancelled = result.terminal_reason === "worker-cancelled";
    return {
      state: cancelled ? "failure" : "error",
      outcome: cancelled ? "failed" : "error",
      description: cancelled
        ? `${target}: worker cancelled`
        : `${target}: controller or infrastructure error`,
      target_url: terminalResultUrl(result, controllerUrl),
    };
  }
  if (!eligible) {
    const priorRuntime = lineage
      .slice(0, index)
      .findLast((candidate) => candidate.plan.targets.includes(target));
    if (!priorRuntime) {
      if (checkpointBaselineStatus && checkpointRuntimeEvent) {
        return statusFromCheckpointRuntime({
          target,
          runtimeEvent: checkpointRuntimeEvent,
          checkpointStatus: checkpointBaselineStatus,
          controllerUrl,
        });
      }
      return {
        state: "success",
        outcome: "not affected",
        description: `${target}: not affected`,
        target_url: controllerUrl,
      };
    }
    if (
      checkpointBaselineStatus &&
      checkpointRuntimeEvent?.event_run_id === priorRuntime.event_run_id
    ) {
      return statusFromCheckpointRuntime({
        target,
        runtimeEvent: priorRuntime,
        checkpointStatus: checkpointBaselineStatus,
        controllerUrl,
      });
    }
    const priorResult = resultByRun.get(priorRuntime.event_run_id);
    if (priorResult?.terminal_reason === NATIVE_OWNED_SELECTION_REASON) {
      return {
        state: "success",
        outcome: "native-owned",
        description: nativeOwnedStatusDescription(target),
        target_url: controllerUrl,
      };
    }
    if (priorResult?.state === "success") {
      return {
        state: "success",
        outcome: "runtime-equivalent",
        description: `${target}: runtime-equivalent to ${priorRuntime.head_sha.slice(0, 7)}`,
        target_url: priorResult.vercel_deployment_url,
      };
    }
    if (priorResult?.state === "failure") {
      return {
        state: "failure",
        outcome: "failed",
        description: `${target}: runtime ${priorRuntime.head_sha.slice(0, 7)} failed`,
        target_url: terminalResultUrl(priorResult, controllerUrl),
      };
    }
    if (priorResult?.state === "error") {
      const cancelled = priorResult.terminal_reason === "worker-cancelled";
      return {
        state: cancelled ? "failure" : "error",
        outcome: cancelled ? "failed" : "error",
        description: cancelled
          ? `${target}: runtime ${priorRuntime.head_sha.slice(0, 7)} cancelled`
          : `${target}: runtime ${priorRuntime.head_sha.slice(0, 7)} errored`,
        target_url: terminalResultUrl(priorResult, controllerUrl),
      };
    }
    return {
      state: "pending",
      outcome: "pending",
      description: `${target}: waiting for ${priorRuntime.head_sha.slice(0, 7)}`,
      target_url: active?.html_url ?? controllerUrl,
    };
  }
  const coalescedTo = coalescedToByRun.get(event.event_run_id);
  if (coalescedTo) {
    return {
      state: "success",
      outcome: "coalesced",
      description: `${target}: coalesced to ${coalescedTo.head_sha.slice(0, 7)}`,
      target_url: controllerUrl,
    };
  }
  return {
    state: "pending",
    outcome: "pending",
    description: `${target}: queued or running`,
    target_url: active?.html_url ?? controllerUrl,
  };
}

function aggregateStatusDecision(event, targetDecisions, controllerUrl) {
  const decisions = PREVIEW_TARGETS.map((target) => targetDecisions[target]);
  const state = decisions.some((decision) => decision.state === "error")
    ? "error"
    : decisions.some((decision) => decision.state === "failure")
      ? "failure"
      : decisions.some((decision) => decision.state === "pending")
        ? "pending"
        : "success";
  const targets = Object.fromEntries(
    PREVIEW_TARGETS.map((target) => [target, targetDecisions[target].outcome]),
  );
  const compactOutcome = (outcome) =>
    ({
      "runtime-equivalent": "equivalent",
      "not affected": "none",
      "native-owned": "native",
      "unsupported trust boundary": "unsupported",
    })[outcome] ?? outcome;
  const description = PREVIEW_TARGETS.map(
    (target) => `${target}=${compactOutcome(targets[target])}`,
  ).join("; ");
  invariant(description.length <= 140, "Aggregate status summary is too long");
  const stateDecisions = decisions.filter(
    (decision) => decision.state === state,
  );
  const priority =
    stateDecisions.find(
      (decision) =>
        decision.target_url !== controllerUrl &&
        ["deployed", "runtime-equivalent"].includes(decision.outcome),
    ) ??
    stateDecisions.find((decision) => decision.target_url !== controllerUrl) ??
    stateDecisions.find((decision) =>
      ["deployed", "runtime-equivalent"].includes(decision.outcome),
    ) ??
    stateDecisions[0];
  return {
    sha: event.head_sha,
    state,
    description,
    target_url: priority?.target_url ?? controllerUrl,
    targets,
  };
}

function terminalResultUrl(result, controllerUrl) {
  if (result?.vercel_deployment_url) {
    return immutableVercelUrl(result.vercel_deployment_url);
  }
  if (result?.worker_run_id) {
    return `https://github.com/${PREVIEW_REPOSITORY}/actions/runs/${exactRunId(
      result.worker_run_id,
      "Terminal worker run ID",
    )}`;
  }
  return controllerUrl;
}

function preserveSettledControllerTarget(
  decision,
  previousBySha,
  controllerUrl,
) {
  const previous = previousBySha.get(decision.sha);
  if (
    TERMINAL_STATES.has(decision.state) &&
    decision.target_url === controllerUrl &&
    previous?.state === decision.state &&
    previous.description === decision.description
  ) {
    return {
      ...decision,
      target_url: previous.target_url,
    };
  }
  return decision;
}

function statusFromPendingRuntimeResult({
  target,
  runtimeEvent,
  result,
  controllerUrl,
}) {
  return targetStatusDecision({
    target,
    event: runtimeEvent,
    index: 0,
    lineage: [runtimeEvent],
    resultByRun: new Map([[runtimeEvent.event_run_id, result]]),
    active: null,
    coalescedToByRun: new Map(),
    controllerUrl,
    checkpointStatus: null,
    checkpointBaselineStatus: null,
    checkpointRuntimeEvent: null,
  });
}

function validatePersistedDispatch(value, pr, label) {
  const dispatch = plainObject(value, label);
  const target = previewTarget(dispatch.target, `${label} target`);
  exactSha(dispatch.sha);
  exactSha(dispatch.expected_workflow_sha, `${label} expected workflow SHA`);
  invariant(
    dispatch.key === controllerKey(pr, dispatch.sha, target),
    `${label} key mismatch`,
  );
  exactRunId(dispatch.epoch_anchor_run_id, `${label} epoch anchor run ID`);
  exactRunId(
    dispatch.selection_receipt_run_id,
    `${label} selection receipt run ID`,
  );
  invariant(
    /^[0-9a-f]{64}$/.test(dispatch.reconciliation_basis_digest),
    `${label} reconciliation basis digest is invalid`,
  );
  invariant(
    dispatch.key_digest ===
      controllerKeyDigest(dispatch.key, {
        epochAnchorRunId: dispatch.epoch_anchor_run_id,
        basisDigest: dispatch.reconciliation_basis_digest,
        selectionReceiptRunId: dispatch.selection_receipt_run_id,
        expectedWorkflowSha: dispatch.expected_workflow_sha,
      }),
    `${label} digest mismatch`,
  );
  return dispatch;
}

function validateActiveDispatch(value, pr, label) {
  const active = validatePersistedDispatch(value, pr, label);
  exactTimestamp(active.dispatch_started_at);
  invariant(
    Array.isArray(active.coalesced_receipt_run_ids) &&
      active.coalesced_receipt_run_ids.length <= MAX_RECEIPTS,
    `${label} coalescing evidence is invalid`,
  );
  const coalesced = new Set();
  for (const runId of active.coalesced_receipt_run_ids) {
    const exact = exactRunId(runId, `${label} coalesced event receipt run ID`);
    invariant(
      exact !== active.selection_receipt_run_id && !coalesced.has(exact),
      `${label} coalescing evidence is duplicated or self-referential`,
    );
    coalesced.add(exact);
  }
  invariant(
    ["intended", "dispatched"].includes(active.dispatch_state),
    `${label} state is invalid`,
  );
  invariant(
    (active.dispatch_state === "intended") ===
      (active.workflow_run_id === null),
    `${label} state and workflow ownership disagree`,
  );
  if (active.workflow_run_id !== null) {
    exactRunId(active.workflow_run_id, `${label} workflow run ID`);
    exactSha(active.workflow_sha, `${label} worker workflow SHA`);
    invariant(
      active.workflow_sha === active.expected_workflow_sha,
      `${label} worker workflow SHA does not match its authorized SHA`,
    );
    exactRunAttempt(active.workflow_run_attempt);
  } else {
    invariant(
      active.workflow_sha === null && active.workflow_run_attempt === null,
      `${label} has partial workflow ownership`,
    );
  }
  optionalHttpsUrl(active.run_url, `${label} API run URL`);
  optionalHttpsUrl(active.html_url, `${label} HTML run URL`);
  if (active.recovery_quarantine !== undefined) {
    invariant(
      active.recovery_quarantine === RETIRED_RECOVERY_QUARANTINE,
      `${label} recovery quarantine is invalid`,
    );
  }
  return active;
}

function normalizeExistingState(value, pr) {
  if (value === null || value === undefined) return null;
  const state = plainObject(value, "Controller state");
  invariant(
    state.schema === CONTROLLER_SCHEMA,
    "Controller state schema mismatch",
  );
  validatedRepository(state.repository);
  invariant(pullRequestNumber(state.pr) === pr, "Controller state PR mismatch");
  invariant(
    typeof state.closed === "boolean",
    "Controller closed flag is invalid",
  );
  invariant(
    /^[0-9a-f]{64}$/.test(state.receipts_digest),
    "Controller receipt digest is invalid",
  );
  exactRunId(state.epoch?.anchor_run_id, "State epoch anchor run ID");
  exactRunId(state.epoch?.tail_receipt_run_id, "State epoch tail run ID");
  invariant(
    /^[0-9a-f]{64}$/.test(state.epoch?.basis_digest),
    "State epoch basis digest is invalid",
  );
  const targets = plainObject(state.targets, "Controller target states");
  invariant(
    Object.keys(targets).sort().join(",") ===
      [...PREVIEW_TARGETS].sort().join(","),
    "Controller target state keys are invalid",
  );
  for (const target of PREVIEW_TARGETS) {
    const targetState = plainObject(
      targets[target],
      `${target} controller state`,
    );
    for (const [name, sha] of [
      ["first eligible", targetState.first_eligible_sha],
      ["latest desired", targetState.latest_desired_sha],
      ["last successful runtime", targetState.last_successful_runtime_sha],
    ]) {
      if (sha !== null) exactSha(sha, `${target} ${name} SHA`);
    }
    if (targetState.latest_desired_receipt_run_id !== null) {
      exactRunId(
        targetState.latest_desired_receipt_run_id,
        `${target} latest desired receipt run ID`,
      );
    }
    if (targetState.idle_cursor_receipt_run_id !== null) {
      exactRunId(
        targetState.idle_cursor_receipt_run_id,
        `${target} idle cursor receipt run ID`,
      );
    }
    optionalHttpsUrl(
      targetState.last_successful_runtime_url,
      `${target} last successful runtime URL`,
    );
    invariant(
      (targetState.last_successful_runtime_sha === null) ===
        (targetState.last_successful_runtime_url === null),
      `${target} last successful runtime is incomplete`,
    );
    if (targetState.active !== null) {
      const active = validateActiveDispatch(
        targetState.active,
        pr,
        `${target} active dispatch`,
      );
      invariant(
        active.target === target && active.recovery_quarantine === undefined,
        `${target} current active dispatch is invalid`,
      );
    }
    invariant(
      Array.isArray(targetState.retired_active) &&
        targetState.retired_active.length <= MAX_HISTORY,
      `${target} retired active selections are invalid`,
    );
    for (const selection of targetState.retired_active) {
      const retired = validateActiveDispatch(
        selection,
        pr,
        `${target} retired active dispatch`,
      );
      invariant(retired.target === target, `${target} retired target mismatch`);
    }
    invariant(
      Array.isArray(targetState.terminal_history) &&
        targetState.terminal_history.length <= MAX_HISTORY,
      `${target} terminal history is invalid`,
    );
    for (const terminal of targetState.terminal_history) {
      const persisted = validatePersistedDispatch(
        terminal,
        pr,
        `${target} terminal selection`,
      );
      invariant(
        persisted.target === target && TERMINAL_STATES.has(terminal.state),
        `${target} terminal selection is invalid`,
      );
    }
    const terminalResultKeys = new Set();
    invariant(
      Array.isArray(targetState.terminal_result_key_digests) &&
        targetState.terminal_result_key_digests.length <= MAX_RECEIPTS,
      `${target} terminal result ownership is invalid`,
    );
    for (const keyDigest of targetState.terminal_result_key_digests) {
      invariant(
        typeof keyDigest === "string" && /^[0-9a-f]{24}$/.test(keyDigest),
        `${target} terminal result ownership key is invalid`,
      );
      invariant(
        !terminalResultKeys.has(keyDigest),
        `${target} terminal result ownership contains duplicates`,
      );
      terminalResultKeys.add(keyDigest);
    }
  }
  invariant(
    Array.isArray(state.status_decisions) &&
      state.status_decisions.length <= MAX_RECEIPTS,
    "Controller status decisions are invalid",
  );
  for (const decision of state.status_decisions) {
    exactSha(decision.sha, "Controller status SHA");
    invariant(
      ["pending", "success", "failure", "error"].includes(decision.state),
      "Controller status state is invalid",
    );
    boundedText(decision.description, "Controller status description", 140);
    optionalHttpsUrl(decision.target_url, "Controller status URL");
    const outcomes = plainObject(
      decision.targets,
      "Controller target status outcomes",
    );
    invariant(
      Object.keys(outcomes).sort().join(",") ===
        [...PREVIEW_TARGETS].sort().join(","),
      "Controller target status outcome keys are invalid",
    );
    for (const outcome of Object.values(outcomes)) {
      invariant(
        [
          "deployed",
          "runtime-equivalent",
          "not affected",
          "native-owned",
          "coalesced",
          "unsupported trust boundary",
          "pending",
          "failed",
          "error",
        ].includes(outcome),
        "Controller target status outcome is invalid",
      );
    }
  }
  return state;
}

export function reconcileState({
  events: rawEvents,
  results: rawResults = [],
  selections: rawSelections = [],
  pullRequest: rawPull,
  existingState = null,
  checkpoint: rawCheckpoint = null,
  controllerUrl,
  expectedWorkflowSha: rawExpectedWorkflowSha,
}) {
  const expectedWorkflowSha = exactSha(
    rawExpectedWorkflowSha,
    "Controller workflow SHA",
  );
  const pull = normalizePullRequest(rawPull);
  const checkpoint =
    rawCheckpoint === null
      ? null
      : validatePreviewCheckpoint(rawCheckpoint, pull.number);
  const allResults = dedupeResults(rawResults).filter(
    (result) => result.pr === pull.number,
  );
  const allSelections = dedupeSelectionReceipts(rawSelections).filter(
    (selection) => selection.pr === pull.number,
  );
  const previous = normalizeExistingState(existingState, pull.number);
  const events = dedupeEvents(
    rawEvents,
    persistedEventRunIds(previous, allResults, allSelections),
  ).filter((event) => event.pr === pull.number);
  const {
    anchor,
    closure,
    lineage,
    checkpoint: selectedCheckpoint,
  } = selectCurrentEpoch(events, pull, checkpoint);
  const epochResults = allResults.filter(
    (result) => result.epoch_anchor_run_id === anchor.event_run_id,
  );
  const epochSelections = allSelections.filter(
    (selection) => selection.epoch_anchor_run_id === anchor.event_run_id,
  );
  if (epochResults.length > 0) {
    invariant(
      previous?.epoch?.anchor_run_id === anchor.event_run_id,
      "Current-epoch result exists without persisted epoch ownership",
    );
    for (const result of epochResults) {
      const targetState = previous.targets[result.target];
      const ownedKeyDigests = new Set([
        targetState.active?.key_digest,
        ...targetState.retired_active.map((owner) => owner.key_digest),
        ...targetState.terminal_result_key_digests,
      ]);
      invariant(
        ownedKeyDigests.has(result.key_digest),
        "Worker result is not bound to a persisted epoch selection",
      );
    }
  }
  const basisDigest = digest({
    checkpoint_digest: selectedCheckpoint?.cumulative_receipts_digest ?? null,
    anchor: semanticEventKey(anchor),
    closure: closure ? semanticEventKey(closure) : null,
    lineage: lineage.map(semanticEventKey),
    results: epochResults.map(canonicalJson).sort(),
  });
  const sameEpoch = previous?.epoch?.anchor_run_id === anchor.event_run_id;
  const controllerTargetUrl = optionalHttpsUrl(controllerUrl, "Controller URL");
  const targetStates = {};
  const targetStatuses = {};
  const nextDispatches = [];

  for (const target of PREVIEW_TARGETS) {
    const previousTarget = previous?.targets[target] ?? null;
    const checkpointTarget = selectedCheckpoint?.targets[target] ?? null;
    const targetResults = epochResults.filter(
      (result) => result.target === target,
    );
    const targetSelections = epochSelections.filter(
      (selection) => selection.target === target,
    );
    const priorOwners = [
      previousTarget?.active,
      ...(previousTarget?.retired_active ?? []),
      ...(previousTarget?.terminal_history ?? []),
    ].filter(Boolean);
    const pendingOwnerKey = checkpointTarget?.pending_owner_key_digest ?? null;
    const pendingOwnerSelection = pendingOwnerKey
      ? (allSelections.find(
          (selection) => selection.key_digest === pendingOwnerKey,
        ) ?? null)
      : null;
    const pendingOwner = pendingOwnerKey
      ? (priorOwners.find((owner) => owner.key_digest === pendingOwnerKey) ??
        pendingOwnerSelection ??
        null)
      : null;
    invariant(
      pendingOwnerKey === null || pendingOwner?.target === target,
      `${target} checkpoint pending owner is not persisted`,
    );
    const pendingOwnerResult = pendingOwner
      ? ([...allResults]
          .filter(
            (result) =>
              result.target === target &&
              result.key_digest === pendingOwner.key_digest &&
              result.epoch_anchor_run_id === pendingOwner.epoch_anchor_run_id &&
              result.selection_receipt_run_id ===
                pendingOwner.selection_receipt_run_id,
          )
          .sort(
            (a, b) =>
              b.worker_run_id - a.worker_run_id ||
              b.worker_run_attempt - a.worker_run_attempt,
          )[0] ?? null)
      : null;
    const liveCandidates = lineage.filter((event) =>
      event.plan.targets.includes(target),
    );
    const checkpointRuntimeEvent =
      checkpointTarget?.latest_runtime_event ?? null;
    const checkpointOwnerEvent = checkpointTarget?.pending_owner_event ?? null;
    const candidates = [
      checkpointOwnerEvent,
      checkpointRuntimeEvent,
      ...liveCandidates,
    ]
      .filter(Boolean)
      .filter(
        (event, index, values) =>
          values.findIndex(
            (candidate) => candidate.event_run_id === event.event_run_id,
          ) === index,
      );
    const candidateByRun = new Map(
      candidates.map((event) => [event.event_run_id, event]),
    );
    const ownerByKeyDigest = new Map(
      priorOwners.map((owner) => [owner.key_digest, owner]),
    );
    for (const result of targetResults) {
      if (!ownerByKeyDigest.has(result.key_digest)) {
        ownerByKeyDigest.set(result.key_digest, {
          pr: result.pr,
          target,
          sha: result.sha,
          key: result.controller_key,
          key_digest: result.key_digest,
          epoch_anchor_run_id: result.epoch_anchor_run_id,
          reconciliation_basis_digest: result.reconciliation_basis_digest,
          selection_receipt_run_id: result.selection_receipt_run_id,
          expected_workflow_sha: result.expected_workflow_sha,
        });
      }
    }
    for (const selection of targetSelections) {
      const selectedEvent = candidateByRun.get(
        selection.selection_receipt_run_id,
      );
      invariant(
        selectedEvent &&
          selectedEvent.head_sha === selection.sha &&
          selection.key === controllerKey(pull.number, selection.sha, target),
        `${target} selection is outside current eligible lineage`,
      );
      const owner = ownerByKeyDigest.get(selection.key_digest);
      invariant(
        owner &&
          owner.target === target &&
          owner.sha === selection.sha &&
          owner.key === selection.key &&
          owner.epoch_anchor_run_id === selection.epoch_anchor_run_id &&
          owner.reconciliation_basis_digest ===
            selection.reconciliation_basis_digest &&
          owner.selection_receipt_run_id ===
            selection.selection_receipt_run_id &&
          owner.expected_workflow_sha === selection.expected_workflow_sha,
        `${target} selection is not bound to persisted ownership`,
      );
    }
    const resultByRun = new Map();
    for (const event of candidates) {
      const result = resultForSelection(
        targetResults,
        anchor.event_run_id,
        event,
        sameEpoch &&
          previousTarget?.active?.selection_receipt_run_id ===
            event.event_run_id
          ? previousTarget.active
          : null,
        target,
      );
      if (result) resultByRun.set(event.event_run_id, result);
    }
    if (
      checkpointTarget &&
      checkpointRuntimeEvent &&
      TERMINAL_STATES.has(checkpointTarget.status.state)
    ) {
      resultByRun.set(checkpointRuntimeEvent.event_run_id, {
        state: checkpointTarget.status.state,
        sha: checkpointRuntimeEvent.head_sha,
        vercel_deployment_url:
          checkpointTarget.status.state === "success"
            ? checkpointTarget.status.target_url
            : null,
        worker_run_id:
          checkpointTarget.status.state === "success"
            ? null
            : workflowRunIdFromUrl(checkpointTarget.status.target_url),
        terminal_reason: isNativeOwnedCheckpointStatus(
          checkpointTarget.status,
          selectedCheckpoint.event,
          target,
        )
          ? NATIVE_OWNED_SELECTION_REASON
          : CHECKPOINTED_TERMINAL_REASON,
      });
    }
    if (
      checkpointOwnerEvent &&
      pendingOwner &&
      pendingOwnerResult &&
      checkpointOwnerEvent.head_sha === pendingOwner.sha &&
      (!RETRIABLE_TERMINAL_REASONS.has(pendingOwnerResult.terminal_reason) ||
        checkpointTarget.pending_owner_attempt_count >= 2) &&
      !resultByRun.has(checkpointOwnerEvent.event_run_id)
    ) {
      resultByRun.set(checkpointOwnerEvent.event_run_id, pendingOwnerResult);
    }
    const selectedRunIds = new Set(
      targetSelections.map((selection) => selection.selection_receipt_run_id),
    );
    const coalescedToByRun = new Map();
    for (const selection of targetSelections) {
      const selectedEvent = candidateByRun.get(
        selection.selection_receipt_run_id,
      );
      const selectedIndex = candidates.findIndex(
        (event) => event.event_run_id === selectedEvent.event_run_id,
      );
      for (const coalescedRunId of selection.coalesced_receipt_run_ids) {
        const coalescedIndex = candidates.findIndex(
          (event) => event.event_run_id === coalescedRunId,
        );
        invariant(
          coalescedIndex >= 0 &&
            coalescedIndex < selectedIndex &&
            !resultByRun.has(coalescedRunId) &&
            !selectedRunIds.has(coalescedRunId),
          `${target} coalescing evidence contradicts durable ownership`,
        );
        const prior = coalescedToByRun.get(coalescedRunId);
        invariant(
          !prior || prior.event_run_id === selectedEvent.event_run_id,
          `${target} event has conflicting coalescing evidence`,
        );
        coalescedToByRun.set(coalescedRunId, selectedEvent);
      }
    }

    let active = null;
    let idleCursor = sameEpoch
      ? (previousTarget?.idle_cursor_receipt_run_id ?? null)
      : null;
    let latestDesired = null;
    let completedActive = null;
    let completedResult = null;
    if (sameEpoch && previousTarget?.active) {
      const previousActive = previousTarget.active;
      const selectedEvent = candidateByRun.get(
        previousActive.selection_receipt_run_id,
      );
      invariant(selectedEvent, `${target} active selection left the lineage`);
      const terminal = resultForSelection(
        targetResults,
        anchor.event_run_id,
        selectedEvent,
        previousActive,
        target,
      );
      if (terminal) {
        completedActive = previousActive;
        completedResult = terminal;
        idleCursor = previousActive.selection_receipt_run_id;
      } else {
        active = { ...previousActive };
        const activeIndex = candidates.findIndex(
          (event) =>
            event.event_run_id === previousActive.selection_receipt_run_id,
        );
        latestDesired = candidates.slice(activeIndex).at(-1) ?? selectedEvent;
      }
    }

    let selected = null;
    if (!active && pull.state === "open" && pull.trust === "trusted") {
      if (completedActive) {
        const desired = candidateByRun.get(
          previousTarget?.latest_desired_receipt_run_id,
        );
        if (
          desired &&
          desired.event_run_id !== completedActive.selection_receipt_run_id &&
          !resultByRun.has(desired.event_run_id)
        ) {
          selected = desired;
        }
        const inheritedAttempts =
          pendingOwner?.selection_receipt_run_id ===
          completedActive.selection_receipt_run_id
            ? checkpointTarget.pending_owner_attempt_count -
              Number(pendingOwner.key_digest === completedActive.key_digest)
            : 0;
        const attemptsForReceipt =
          inheritedAttempts +
          targetResults.filter(
            (result) =>
              result.selection_receipt_run_id ===
                completedActive.selection_receipt_run_id &&
              result.terminal_reason !==
                "controller-workflow-upgraded-before-dispatch",
          ).length;
        if (
          !selected &&
          RETRIABLE_TERMINAL_REASONS.has(completedResult?.terminal_reason) &&
          attemptsForReceipt < 2
        ) {
          selected = candidateByRun.get(
            completedActive.selection_receipt_run_id,
          );
        }
        if (
          !selected &&
          completedResult?.terminal_reason ===
            "controller-workflow-upgraded-before-dispatch" &&
          completedResult.expected_workflow_sha !== expectedWorkflowSha
        ) {
          selected = candidateByRun.get(
            completedActive.selection_receipt_run_id,
          );
        }
      }
      if (!selected) {
        const cursorIndex = idleCursor
          ? candidates.findIndex((event) => event.event_run_id === idleCursor)
          : -1;
        invariant(
          idleCursor === null || cursorIndex >= 0,
          `${target} idle cursor is outside current lineage`,
        );
        const unprocessed = candidates
          .slice(cursorIndex + 1)
          .filter((event) => !resultByRun.has(event.event_run_id));
        selected = unprocessed[0] ?? null;
        latestDesired = unprocessed.at(-1) ?? null;
      } else {
        const selectedIndex = candidates.findIndex(
          (event) => event.event_run_id === selected.event_run_id,
        );
        latestDesired = candidates.slice(selectedIndex).at(-1) ?? selected;
      }
    }
    if (pendingOwnerResult && !active) {
      const desired = candidates.at(-1) ?? null;
      if (desired && !resultByRun.has(desired.event_run_id)) {
        selected = desired;
        latestDesired = desired;
      }
    }
    if (pendingOwner && !pendingOwnerResult) selected = null;

    if (selected) {
      const key = controllerKey(pull.number, selected.head_sha, target);
      const selectedIndex = candidates.findIndex(
        (event) => event.event_run_id === selected.event_run_id,
      );
      const completedIndex = completedActive
        ? candidates.findIndex(
            (event) =>
              event.event_run_id === completedActive.selection_receipt_run_id,
          )
        : -1;
      const coalescingStartIndex = pendingOwnerResult ? 0 : completedIndex + 1;
      const coalescedReceiptRunIds = candidates
        .slice(coalescingStartIndex, selectedIndex)
        .filter(
          (event) =>
            !resultByRun.has(event.event_run_id) &&
            !selectedRunIds.has(event.event_run_id),
        )
        .map((event) => event.event_run_id);
      nextDispatches.push({
        pr: pull.number,
        target,
        sha: selected.head_sha,
        git_ref: selected.head_ref,
        key,
        epoch_anchor_run_id: anchor.event_run_id,
        reconciliation_basis_digest: basisDigest,
        selection_receipt_run_id: selected.event_run_id,
        expected_workflow_sha: expectedWorkflowSha,
        coalesced_receipt_run_ids: coalescedReceiptRunIds,
        key_digest: controllerKeyDigest(key, {
          epochAnchorRunId: anchor.event_run_id,
          basisDigest,
          selectionReceiptRunId: selected.event_run_id,
          expectedWorkflowSha,
        }),
      });
    }

    let effectiveCheckpointStatus = checkpointTarget?.status ?? null;
    const checkpointPendingEvent =
      checkpointOwnerEvent ?? checkpointRuntimeEvent;
    const pendingRuntimeResult = checkpointPendingEvent
      ? resultByRun.get(checkpointPendingEvent.event_run_id)
      : null;
    if (checkpointTarget && checkpointPendingEvent && pendingRuntimeResult) {
      effectiveCheckpointStatus = statusFromPendingRuntimeResult({
        target,
        runtimeEvent: checkpointPendingEvent,
        result: pendingRuntimeResult,
        controllerUrl: controllerTargetUrl,
      });
    } else if (
      checkpointTarget &&
      pendingOwnerResult &&
      pull.state === "closed"
    ) {
      effectiveCheckpointStatus = {
        state: "success",
        outcome: "not affected",
        description: `${target}: no preview required for closed PR`,
        target_url: controllerTargetUrl,
      };
    } else if (effectiveCheckpointStatus?.state === "pending" && active) {
      effectiveCheckpointStatus = {
        ...effectiveCheckpointStatus,
        target_url: active.html_url ?? controllerTargetUrl,
      };
    }
    targetStatuses[target] = lineage.map((event, index) =>
      targetStatusDecision({
        target,
        event,
        index,
        lineage,
        resultByRun,
        active,
        coalescedToByRun,
        controllerUrl: controllerTargetUrl,
        checkpointStatus:
          selectedCheckpoint?.event.event_run_id === event.event_run_id
            ? effectiveCheckpointStatus
            : null,
        checkpointBaselineStatus: effectiveCheckpointStatus,
        checkpointRuntimeEvent,
      }),
    );

    const successes = [...resultByRun.entries()]
      .filter(
        ([, result]) =>
          result.state === "success" && result.schema === RESULT_RECEIPT_SCHEMA,
      )
      .sort(([runA], [runB]) => {
        const indexA = candidates.findIndex(
          (event) => event.event_run_id === runA,
        );
        const indexB = candidates.findIndex(
          (event) => event.event_run_id === runB,
        );
        return indexB - indexA;
      });
    const lastSuccess = successes[0]?.[1] ?? null;
    const terminalHistory = targetResults
      .sort((a, b) => a.worker_run_id - b.worker_run_id)
      .slice(-MAX_HISTORY)
      .map((result) => ({
        target,
        sha: result.sha,
        key: result.controller_key,
        key_digest: result.key_digest,
        epoch_anchor_run_id: result.epoch_anchor_run_id,
        reconciliation_basis_digest: result.reconciliation_basis_digest,
        selection_receipt_run_id: result.selection_receipt_run_id,
        expected_workflow_sha: result.expected_workflow_sha,
        state: result.state,
        worker_run_id: result.worker_run_id,
        github_deployment_id: result.github_deployment_id,
        vercel_deployment_url: result.vercel_deployment_url,
        terminal_reason: result.terminal_reason,
      }));
    const allResultKeys = new Set(
      allResults.map((result) => result.key_digest),
    );
    const retiredActive = [
      ...(previousTarget?.retired_active ?? []),
      ...(!sameEpoch && previousTarget?.active ? [previousTarget.active] : []),
    ]
      .filter(
        (selection, index, values) =>
          values.findIndex(
            (candidate) => candidate.key_digest === selection.key_digest,
          ) === index,
      )
      .filter((selection) => !allResultKeys.has(selection.key_digest));
    invariant(
      retiredActive.length <= MAX_HISTORY,
      `${target} has too many unfinished retired workers`,
    );
    const latestDesiredEvent =
      latestDesired ??
      (sameEpoch
        ? candidateByRun.get(previousTarget?.latest_desired_receipt_run_id)
        : null) ??
      candidates.at(-1) ??
      null;
    targetStates[target] = {
      first_eligible_sha:
        checkpointTarget?.first_eligible_sha ??
        (sameEpoch ? previousTarget?.first_eligible_sha : null) ??
        candidates[0]?.head_sha ??
        null,
      latest_desired_sha: latestDesiredEvent?.head_sha ?? null,
      latest_desired_receipt_run_id: latestDesiredEvent?.event_run_id ?? null,
      idle_cursor_receipt_run_id: idleCursor,
      active,
      retired_active: retiredActive,
      last_successful_runtime_sha:
        lastSuccess?.sha ?? previousTarget?.last_successful_runtime_sha ?? null,
      last_successful_runtime_url:
        lastSuccess?.vercel_deployment_url ??
        previousTarget?.last_successful_runtime_url ??
        null,
      terminal_result_key_digests: [
        ...new Set(targetResults.map((result) => result.key_digest)),
      ],
      terminal_history: terminalHistory,
    };
  }

  const previousStatusBySha = new Map(
    (previous?.status_decisions ?? []).map((decision) => [
      decision.sha,
      decision,
    ]),
  );
  const statuses = lineage.map((event, index) =>
    preserveSettledControllerTarget(
      aggregateStatusDecision(
        event,
        Object.fromEntries(
          PREVIEW_TARGETS.map((target) => [
            target,
            targetStatuses[target][index],
          ]),
        ),
        controllerTargetUrl,
      ),
      previousStatusBySha,
      controllerTargetUrl,
    ),
  );
  const state = {
    schema: CONTROLLER_SCHEMA,
    repository: PREVIEW_REPOSITORY,
    pr: pull.number,
    epoch: {
      anchor_run_id: anchor.event_run_id,
      anchor_action: anchor.event_action,
      anchor_pr_updated_at: anchor.pr_updated_at,
      anchor_head_sha: anchor.head_sha,
      anchor_head_ref: anchor.head_ref,
      closed_at: closure?.pr_closed_at ?? null,
      tail_receipt_run_id: (closure ?? lineage.at(-1)).event_run_id,
      lineage_digest: digest(lineage.map(semanticEventKey)),
      basis_digest: basisDigest,
    },
    closed: pull.state === "closed",
    receipts_digest: controllerReceiptsDigest(
      events,
      allResults,
      allSelections,
      pull.number,
      checkpoint,
    ),
    targets: targetStates,
    status_decisions: statuses,
  };
  return { state, nextDispatches, lineage, basisDigest };
}

function ownerRepo(context) {
  invariant(
    context?.repo?.owner === "mento-protocol" &&
      context?.repo?.repo === "frontend-monorepo",
    "Unexpected workflow repository",
  );
  return context.repo;
}

async function previewOwnerAtSha(github, context, target, sha) {
  const targetConfiguration = previewTargetConfig(target);
  const immutableSha = exactSha(
    sha,
    `Candidate ${target} Vercel configuration SHA`,
  );
  const { data } = await github.rest.repos.getContent({
    ...ownerRepo(context),
    path: targetConfiguration.vercelConfigurationPath,
    ref: immutableSha,
  });
  const file = plainObject(data, `Candidate ${target} Vercel configuration`);
  invariant(
    file.type === "file" &&
      file.path === targetConfiguration.vercelConfigurationPath,
    `Candidate ${target} Vercel configuration is not the expected file`,
  );
  invariant(
    file.encoding === "base64" &&
      Number.isSafeInteger(file.size) &&
      file.size > 0 &&
      file.size <= VERCEL_CONFIGURATION_MAX_BYTES,
    `Candidate ${target} Vercel configuration metadata is invalid`,
  );
  invariant(
    typeof file.content === "string" &&
      file.content.length > 0 &&
      file.content.length <=
        Math.ceil(VERCEL_CONFIGURATION_MAX_BYTES / 3) * 4 + 128 &&
      /^[A-Za-z0-9+/=\r\n]+$/.test(file.content),
    `Candidate ${target} Vercel configuration encoding is invalid`,
  );
  const encoded = file.content.replace(/[\r\n]/g, "");
  const bytes = Buffer.from(encoded, "base64");
  invariant(
    bytes.length === file.size && bytes.toString("base64") === encoded,
    `Candidate ${target} Vercel configuration encoding is invalid`,
  );
  const text = bytes.toString("utf8");
  invariant(
    Buffer.from(text, "utf8").equals(bytes),
    `Candidate ${target} Vercel configuration is not valid UTF-8`,
  );
  let configuration;
  try {
    configuration = JSON.parse(text);
  } catch {
    throw new Error(`Candidate ${target} Vercel configuration is malformed`);
  }
  plainObject(configuration, `Candidate ${target} Vercel configuration`);
  const candidate = canonicalJson(configuration);
  if (
    candidate === canonicalJson(targetConfiguration.githubVercelConfiguration)
  ) {
    return PREVIEW_OWNER_GITHUB;
  }
  if (
    candidate === canonicalJson(targetConfiguration.nativeVercelConfiguration)
  ) {
    return PREVIEW_OWNER_NATIVE;
  }
  throw new Error(`Candidate ${target} Vercel configuration is not recognized`);
}

async function candidatePreviewOwners(github, context, pull) {
  const normalized = normalizePullRequest(pull);
  if (normalized.state !== "open" || normalized.trust !== "trusted") {
    return Object.fromEntries(PREVIEW_TARGETS.map((target) => [target, null]));
  }
  return Object.fromEntries(
    await Promise.all(
      PREVIEW_TARGETS.map(async (target) => [
        target,
        await previewOwnerAtSha(github, context, target, normalized.headSha),
      ]),
    ),
  );
}

async function assertWorkflowOwnershipMap(github, context, workflowSha) {
  for (const target of PREVIEW_TARGETS) {
    const expected =
      PREVIEW_TARGET_CONFIG[target].ownershipMode ===
      PREVIEW_OWNERSHIP_MODES.GITHUB
        ? PREVIEW_OWNER_GITHUB
        : PREVIEW_OWNER_NATIVE;
    invariant(
      (await previewOwnerAtSha(github, context, target, workflowSha)) ===
        expected,
      `${target} workflow ownership map disagrees with its immutable Vercel configuration`,
    );
  }
}

function githubPreviewDispatchAllowed(target, previewOwner) {
  const configuration = previewTargetConfig(target);
  invariant(
    previewOwner === PREVIEW_OWNER_GITHUB ||
      previewOwner === PREVIEW_OWNER_NATIVE,
    `${target} preview ownership is invalid`,
  );
  return (
    configuration.ownershipMode === PREVIEW_OWNERSHIP_MODES.SHADOW ||
    previewOwner === PREVIEW_OWNER_GITHUB
  );
}

async function listComments(github, context, pr) {
  const comments = await github.paginate(github.rest.issues.listComments, {
    ...ownerRepo(context),
    issue_number: pullRequestNumber(pr),
    per_page: 100,
  });
  invariant(
    comments.length <= MAX_COMMENTS,
    "Too many PR comments for bounded reconciliation",
  );
  return comments;
}

function previewInitializationStatusContext(pr) {
  return `${PREVIEW_INITIALIZATION_STATUS_CONTEXT} / PR #${pullRequestNumber(pr)}`;
}

async function assertPreviewJournalIsUninitialized(github, context, receipt) {
  const initializationContext = previewInitializationStatusContext(receipt.pr);
  const refs = [receipt.change_base_sha, receipt.head_sha].filter(
    (value, index, values) => value && values.indexOf(value) === index,
  );
  for (const ref of refs) {
    const statuses = await github.paginate(
      github.rest.repos.listCommitStatusesForRef,
      {
        ...ownerRepo(context),
        ref: exactSha(ref),
        per_page: 100,
      },
    );
    invariant(
      statuses.length <= MAX_RECEIPTS,
      "Too many commit statuses to prove journal initialization",
    );
    invariant(
      !statuses.some(
        (status) =>
          status.context === initializationContext &&
          status.state === "success",
      ),
      "Preview journal is missing after external initialization evidence",
    );
  }
}

async function ensurePreviewInitializationWitness({
  github,
  context,
  receipt,
  targetUrl,
}) {
  const ref = exactSha(receipt.head_sha);
  const initializationContext = previewInitializationStatusContext(receipt.pr);
  const statuses = await github.paginate(
    github.rest.repos.listCommitStatusesForRef,
    {
      ...ownerRepo(context),
      ref,
      per_page: 100,
    },
  );
  invariant(
    statuses.length <= MAX_RECEIPTS,
    "Too many commit statuses to ensure journal initialization",
  );
  if (
    statuses.some(
      (status) =>
        status.context === initializationContext && status.state === "success",
    )
  ) {
    return;
  }
  await github.rest.repos.createCommitStatus({
    ...ownerRepo(context),
    sha: ref,
    state: "success",
    context: initializationContext,
    description: "Preview journal initialized",
    target_url: targetUrl,
  });
}

function receiptSetDigest({ events, selections, worker_evidence, results }) {
  return digest({
    events: events.map(canonicalJson).sort(),
    selections: selections.map(canonicalJson).sort(),
    worker_evidence: worker_evidence.map(canonicalJson).sort(),
    results: results.map(canonicalJson).sort(),
  });
}

function previewJournalDigest(receipts, state, checkpoint = null) {
  return digest({
    checkpoint,
    receipts_digest: receiptSetDigest(receipts),
    state,
  });
}

function validateCheckpointStatus(value, target) {
  const status = plainObject(value, `${target} checkpoint status`);
  invariant(
    Object.keys(status).sort().join(",") ===
      "description,outcome,state,target_url",
    "Preview checkpoint status fields are invalid",
  );
  invariant(
    ["pending", "success", "failure", "error"].includes(status.state),
    "Preview checkpoint status state is invalid",
  );
  invariant(
    [
      "deployed",
      "runtime-equivalent",
      "not affected",
      "native-owned",
      "coalesced",
      "unsupported trust boundary",
      "pending",
      "failed",
      "error",
    ].includes(status.outcome),
    "Preview checkpoint status outcome is invalid",
  );
  boundedText(status.description, "Preview checkpoint status description", 140);
  optionalHttpsUrl(status.target_url, "Preview checkpoint status URL");
  return status;
}

function validatePreviewCheckpoint(value, expectedPr) {
  if (value === null) return null;
  const checkpoint = plainObject(value, "Preview checkpoint");
  invariant(
    Object.keys(checkpoint).sort().join(",") ===
      "cumulative_receipts_digest,event,pruned_receipt_counts,schema,sequence,targets,through_event_run_id",
    "Preview checkpoint fields are invalid",
  );
  invariant(
    checkpoint.schema === PREVIEW_CHECKPOINT_SCHEMA,
    "Preview checkpoint schema mismatch",
  );
  invariant(
    Number.isSafeInteger(checkpoint.sequence) && checkpoint.sequence >= 1,
    "Preview checkpoint sequence is invalid",
  );
  invariant(
    /^[0-9a-f]{64}$/.test(checkpoint.cumulative_receipts_digest),
    "Preview checkpoint digest is invalid",
  );
  const counts = plainObject(
    checkpoint.pruned_receipt_counts,
    "Preview checkpoint receipt counts",
  );
  invariant(
    Object.keys(counts).sort().join(",") ===
      "events,results,selections,worker_evidence",
    "Preview checkpoint receipt count fields are invalid",
  );
  for (const count of Object.values(counts)) {
    invariant(
      Number.isSafeInteger(count) && count >= 0,
      "Preview checkpoint receipt count is invalid",
    );
  }
  const event = validateEventReceipt(checkpoint.event);
  invariant(
    event.pr === pullRequestNumber(expectedPr),
    "Preview checkpoint PR mismatch",
  );
  invariant(
    checkpoint.through_event_run_id === event.event_run_id,
    "Preview checkpoint event identity mismatch",
  );
  const targets = plainObject(checkpoint.targets, "Preview checkpoint targets");
  invariant(
    Object.keys(targets).sort().join(",") ===
      [...PREVIEW_TARGETS].sort().join(","),
    "Preview checkpoint target keys are invalid",
  );
  for (const target of PREVIEW_TARGETS) {
    const targetCheckpoint = plainObject(
      targets[target],
      `${target} preview checkpoint`,
    );
    invariant(
      Object.keys(targetCheckpoint).sort().join(",") ===
        "first_eligible_sha,last_successful_runtime_sha,last_successful_runtime_url,latest_desired_sha,latest_runtime_event,pending_owner_attempt_count,pending_owner_event,pending_owner_key_digest,status",
      `${target} preview checkpoint fields are invalid`,
    );
    for (const [name, sha] of [
      ["first eligible", targetCheckpoint.first_eligible_sha],
      ["latest desired", targetCheckpoint.latest_desired_sha],
      ["last successful runtime", targetCheckpoint.last_successful_runtime_sha],
    ]) {
      if (sha !== null) exactSha(sha, `${target} checkpoint ${name} SHA`);
    }
    optionalHttpsUrl(
      targetCheckpoint.last_successful_runtime_url,
      `${target} checkpoint last successful runtime URL`,
    );
    invariant(
      (targetCheckpoint.last_successful_runtime_sha === null) ===
        (targetCheckpoint.last_successful_runtime_url === null),
      `${target} checkpoint last successful runtime is incomplete`,
    );
    const status = validateCheckpointStatus(targetCheckpoint.status, target);
    if (status.outcome === "native-owned") {
      invariant(
        isNativeOwnedCheckpointStatus(status, event, target),
        `${target} checkpoint native ownership status is invalid`,
      );
    }
    const latestRuntimeEvent =
      targetCheckpoint.latest_runtime_event === null
        ? null
        : validateEventReceipt(targetCheckpoint.latest_runtime_event);
    invariant(
      !latestRuntimeEvent ||
        (latestRuntimeEvent.pr === event.pr &&
          latestRuntimeEvent.plan.targets.includes(target)),
      `${target} checkpoint latest runtime event is invalid`,
    );
    const pendingOwnerEvent =
      targetCheckpoint.pending_owner_event === null
        ? null
        : validateEventReceipt(targetCheckpoint.pending_owner_event);
    invariant(
      !pendingOwnerEvent ||
        (pendingOwnerEvent.pr === event.pr &&
          pendingOwnerEvent.plan.targets.includes(target)),
      `${target} checkpoint pending owner event is invalid`,
    );
    if (targetCheckpoint.pending_owner_key_digest === null) {
      invariant(
        targetCheckpoint.pending_owner_attempt_count === 0 &&
          pendingOwnerEvent === null,
        `${target} checkpoint has attempt evidence without an owner`,
      );
    } else {
      invariant(
        /^[0-9a-f]{24}$/.test(targetCheckpoint.pending_owner_key_digest),
        `${target} checkpoint pending owner is invalid`,
      );
      invariant(
        Number.isSafeInteger(targetCheckpoint.pending_owner_attempt_count) &&
          targetCheckpoint.pending_owner_attempt_count >= 1 &&
          targetCheckpoint.pending_owner_attempt_count <= 2,
        `${target} checkpoint pending owner attempt count is invalid`,
      );
      invariant(
        pendingOwnerEvent && status.state === "pending",
        `${target} checkpoint pending owner has no pending runtime`,
      );
    }
    invariant(
      status.state !== "pending" || latestRuntimeEvent || pendingOwnerEvent,
      `${target} checkpoint pending status has no runtime event`,
    );
  }
  return checkpoint;
}

function validateWorkerEvidenceSet(values, pr) {
  invariant(
    Array.isArray(values) && values.length <= MAX_RECEIPTS,
    "Worker evidence set is invalid",
  );
  const identities = new Map();
  for (const raw of values) {
    const value = validateWorkerEvidence(raw);
    invariant(value.pr === pr, "Worker evidence PR mismatch");
    const identity = `${value.key_digest}:${value.worker_run_id}`;
    invariant(!identities.has(identity), "Duplicate worker evidence entries");
    identities.set(identity, value);
  }
  return values;
}

function validateJournalReceiptSet(
  values,
  { maximumMessage, validate, identity },
) {
  invariant(Array.isArray(values), maximumMessage);
  invariant(values.length <= MAX_RECEIPTS, maximumMessage);
  const identities = new Set();
  for (const raw of values) {
    const value = validate(raw);
    const key = identity(value);
    invariant(
      !identities.has(key),
      `Duplicate ${maximumMessage.toLowerCase()}`,
    );
    identities.add(key);
  }
  return values;
}

function sameAttemptBinding(receipt, selection) {
  return (
    receipt.pr === selection.pr &&
    receipt.target === selection.target &&
    receipt.sha === selection.sha &&
    receipt.controller_key === selection.key &&
    receipt.key_digest === selection.key_digest &&
    receipt.epoch_anchor_run_id === selection.epoch_anchor_run_id &&
    receipt.reconciliation_basis_digest ===
      selection.reconciliation_basis_digest &&
    receipt.selection_receipt_run_id === selection.selection_receipt_run_id &&
    receipt.expected_workflow_sha === selection.expected_workflow_sha
  );
}

function validatePreviewJournal(value, expectedPr) {
  const journal = plainObject(value, "Preview journal");
  invariant(
    journal.schema === PREVIEW_JOURNAL_SCHEMA,
    "Preview journal schema mismatch",
  );
  invariant(
    Object.keys(journal).sort().join(",") ===
      "checkpoint,journal_digest,pr,receipts,repository,revision,schema,state",
    "Preview journal fields are invalid",
  );
  validatedRepository(journal.repository);
  const pr = pullRequestNumber(journal.pr);
  invariant(
    pr === pullRequestNumber(expectedPr),
    "Preview journal PR mismatch",
  );
  invariant(
    Number.isSafeInteger(journal.revision) && journal.revision >= 1,
    "Preview journal revision is invalid",
  );
  const checkpoint = validatePreviewCheckpoint(journal.checkpoint, pr);
  const receipts = plainObject(journal.receipts, "Preview journal receipts");
  invariant(
    Object.keys(receipts).sort().join(",") ===
      "events,results,selections,worker_evidence",
    "Preview journal receipt fields are invalid",
  );
  const events = validateJournalReceiptSet(receipts.events, {
    maximumMessage: "Journal events are invalid",
    validate: validateEventReceipt,
    identity: (event) => String(event.event_run_id),
  });
  const selections = validateJournalReceiptSet(receipts.selections, {
    maximumMessage: "Journal selections are invalid",
    validate: validateSelectionReceipt,
    identity: (selection) => selection.key_digest,
  });
  const results = validateJournalReceiptSet(receipts.results, {
    maximumMessage: "Journal results are invalid",
    validate: validateWorkerResult,
    identity: (result) => `${result.key_digest}:${result.worker_run_id}`,
  });
  validateWorkerEvidenceSet(receipts.worker_evidence, pr);
  invariant(
    events.every((event) => event.pr === pr),
    "Journal event PR mismatch",
  );
  invariant(
    !checkpoint ||
      !events.some(
        (event) => event.event_run_id === checkpoint.through_event_run_id,
      ),
    "Preview checkpoint event is duplicated in live receipts",
  );
  invariant(
    !checkpoint ||
      !events.some(
        (event) =>
          semanticEventKey(event) === semanticEventKey(checkpoint.event),
      ),
    "Preview checkpoint event has a semantic duplicate in live receipts",
  );
  invariant(
    selections.every((selection) => selection.pr === pr),
    "Journal selection PR mismatch",
  );
  invariant(
    results.every((result) => result.pr === pr),
    "Journal result PR mismatch",
  );
  for (const receipt of [...receipts.worker_evidence, ...receipts.results]) {
    const selection = receipts.selections.find(
      (candidate) => candidate.key_digest === receipt.key_digest,
    );
    invariant(
      selection && sameAttemptBinding(receipt, selection),
      "Journal worker receipt has no matching selection",
    );
  }
  for (const evidence of receipts.worker_evidence) {
    const result = receipts.results.find(
      (candidate) =>
        candidate.key_digest === evidence.key_digest &&
        candidate.worker_run_id === evidence.worker_run_id,
    );
    invariant(
      !result || result.worker_run_attempt === evidence.worker_run_attempt,
      "Journal worker evidence and result attempts conflict",
    );
  }
  if (journal.state !== null) {
    const state = normalizeExistingState(journal.state, pr);
    for (const target of PREVIEW_TARGETS) {
      for (const dispatch of [
        state.targets[target].active,
        ...state.targets[target].retired_active,
      ].filter(Boolean)) {
        invariant(
          receipts.selections.some(
            (selection) =>
              selection.target === target &&
              selection.key_digest === dispatch.key_digest &&
              selection.selection_receipt_run_id ===
                dispatch.selection_receipt_run_id,
          ),
          "Journal state dispatch has no matching selection",
        );
      }
    }
  }
  invariant(
    typeof journal.journal_digest === "string" &&
      /^[0-9a-f]{64}$/.test(journal.journal_digest) &&
      journal.journal_digest ===
        previewJournalDigest(receipts, journal.state, checkpoint),
    "Preview journal digest mismatch",
  );
  renderPreviewJournalBody(journal);
  return journal;
}

export function createPreviewJournal({
  pr: rawPr,
  revision = 1,
  checkpoint = null,
  events = [],
  selections = [],
  workerEvidence = [],
  results = [],
  state = null,
} = {}) {
  const pr = pullRequestNumber(rawPr);
  const receipts = {
    events: structuredClone(events),
    selections: structuredClone(selections),
    worker_evidence: structuredClone(workerEvidence),
    results: structuredClone(results),
  };
  return validatePreviewJournal(
    {
      schema: PREVIEW_JOURNAL_SCHEMA,
      repository: PREVIEW_REPOSITORY,
      pr,
      revision,
      checkpoint: checkpoint === null ? null : structuredClone(checkpoint),
      journal_digest: previewJournalDigest(receipts, state, checkpoint),
      receipts,
      state: state === null ? null : structuredClone(state),
    },
    pr,
  );
}

function emptyReceiptCounts() {
  return { events: 0, selections: 0, worker_evidence: 0, results: 0 };
}

function checkpointBaselineState(state, checkpoint) {
  const event = checkpoint.event;
  const targetStatuses = Object.fromEntries(
    PREVIEW_TARGETS.map((target) => [
      target,
      checkpoint.targets[target].status,
    ]),
  );
  return {
    schema: CONTROLLER_SCHEMA,
    repository: PREVIEW_REPOSITORY,
    pr: event.pr,
    epoch: {
      anchor_run_id: event.event_run_id,
      anchor_action: event.event_action,
      anchor_pr_updated_at: event.pr_updated_at,
      anchor_head_sha: event.head_sha,
      anchor_head_ref: event.head_ref,
      closed_at: state.closed ? event.pr_closed_at : null,
      tail_receipt_run_id: event.event_run_id,
      lineage_digest: digest([semanticEventKey(event)]),
      basis_digest: digest({
        checkpoint_digest: checkpoint.cumulative_receipts_digest,
        anchor: semanticEventKey(event),
        closure: state.closed ? semanticEventKey(event) : null,
        lineage: [semanticEventKey(event)],
        results: [],
      }),
    },
    closed: state.closed,
    receipts_digest: controllerReceiptsDigest([], [], [], event.pr, checkpoint),
    targets: Object.fromEntries(
      PREVIEW_TARGETS.map((target) => {
        const targetCheckpoint = checkpoint.targets[target];
        const runtimeEvent = targetCheckpoint.latest_runtime_event;
        return [
          target,
          {
            first_eligible_sha: targetCheckpoint.first_eligible_sha,
            latest_desired_sha: targetCheckpoint.latest_desired_sha,
            latest_desired_receipt_run_id: runtimeEvent?.event_run_id ?? null,
            idle_cursor_receipt_run_id: runtimeEvent?.event_run_id ?? null,
            active: null,
            retired_active: [],
            last_successful_runtime_sha:
              targetCheckpoint.last_successful_runtime_sha,
            last_successful_runtime_url:
              targetCheckpoint.last_successful_runtime_url,
            terminal_result_key_digests: [],
            terminal_history: [],
          },
        ];
      }),
    ),
    status_decisions: [aggregateStatusDecision(event, targetStatuses, null)],
  };
}

function outcomeState(outcome) {
  if (outcome === "pending") return "pending";
  if (outcome === "failed") return "failure";
  if (outcome === "error") return "error";
  return "success";
}

function checkpointTargetStatus({
  target,
  targetState,
  aggregate,
  pending,
  priorStatus,
}) {
  const outcome = pending
    ? "pending"
    : (aggregate?.targets?.[target] ??
      (targetState.last_successful_runtime_sha
        ? "runtime-equivalent"
        : "not affected"));
  const state = outcomeState(outcome);
  const terminal = [...targetState.terminal_history]
    .reverse()
    .find(
      (candidate) =>
        candidate.sha === targetState.latest_desired_sha &&
        (state === "failure"
          ? candidate.state === "failure" ||
            (candidate.state === "error" &&
              candidate.terminal_reason === "worker-cancelled")
          : state === "error"
            ? candidate.state === "error" &&
              candidate.terminal_reason !== "worker-cancelled"
            : false),
    );
  const nativeTerminal = [...targetState.terminal_history]
    .reverse()
    .find(
      (candidate) =>
        candidate.sha === targetState.latest_desired_sha &&
        candidate.terminal_reason === NATIVE_OWNED_SELECTION_REASON,
    );
  const nativeControllerUrl =
    (CONTROLLER_RUN_URL_PATTERN.test(aggregate?.target_url ?? "")
      ? aggregate.target_url
      : null) ??
    terminalResultUrl(nativeTerminal, null) ??
    (priorStatus?.outcome === "native-owned" &&
    CONTROLLER_RUN_URL_PATTERN.test(priorStatus.target_url ?? "")
      ? priorStatus.target_url
      : null);
  const targetUrl =
    outcome === "native-owned"
      ? nativeControllerUrl
      : outcome === "deployed" || outcome === "runtime-equivalent"
        ? targetState.last_successful_runtime_url
        : state === "pending"
          ? (targetState.active?.html_url ??
            (priorStatus?.state === "pending" ? priorStatus.target_url : null))
          : state === "failure" || state === "error"
            ? (terminalResultUrl(terminal, null) ??
              (priorStatus?.outcome === outcome
                ? priorStatus.target_url
                : null))
            : priorStatus?.outcome === outcome
              ? priorStatus.target_url
              : null;
  return {
    state,
    outcome,
    description:
      outcome === "native-owned"
        ? nativeOwnedStatusDescription(target)
        : `${target}: ${outcome}`,
    target_url: targetUrl,
  };
}

function runtimeEventForTarget(lineage, checkpoint, target) {
  return (
    [...lineage]
      .reverse()
      .find((event) => event.plan.targets.includes(target)) ??
    checkpoint?.targets[target].latest_runtime_event ??
    null
  );
}

function assertCheckpointableReceipts(
  receipts,
  allResults,
  exemptKeyDigests = new Set(),
) {
  const resultIdentities = new Set(
    allResults.map((result) => `${result.key_digest}:${result.worker_run_id}`),
  );
  invariant(
    receipts.worker_evidence.every(
      (evidence) =>
        exemptKeyDigests.has(evidence.key_digest) ||
        resultIdentities.has(
          `${evidence.key_digest}:${evidence.worker_run_id}`,
        ),
    ),
    "Preview journal cannot checkpoint unfinished worker evidence",
  );
  invariant(
    receipts.selections.every(
      (selection) =>
        exemptKeyDigests.has(selection.key_digest) ||
        allResults.some((result) => result.key_digest === selection.key_digest),
    ),
    "Preview journal cannot checkpoint unfinished selections",
  );
}

export function compactPreviewJournal(value, { pullRequest = null } = {}) {
  const journal = validatePreviewJournal(value, value.pr);
  if (journal.state === null) return journal;
  const state = normalizeExistingState(journal.state, journal.pr);
  const terminalKeys = new Set(
    journal.receipts.results.map((result) => result.key_digest),
  );
  let stateChanged = false;
  for (const target of PREVIEW_TARGETS) {
    const pendingKey =
      journal.checkpoint?.targets[target].pending_owner_key_digest ?? null;
    const unresolved = state.targets[target].retired_active.filter(
      (selection) =>
        selection.key_digest === pendingKey ||
        !terminalKeys.has(selection.key_digest),
    );
    if (unresolved.length !== state.targets[target].retired_active.length) {
      state.targets[target].retired_active = unresolved;
      stateChanged = true;
    }
  }
  if (stateChanged) {
    journal.state = structuredClone(state);
    journal.journal_digest = previewJournalDigest(
      journal.receipts,
      journal.state,
      journal.checkpoint,
    );
  }
  const receiptCount = Object.values(journal.receipts).reduce(
    (total, receipts) => total + receipts.length,
    0,
  );
  if (receiptCount === 0) return journal;
  const hasInFlightOwnership = PREVIEW_TARGETS.some(
    (target) =>
      state.targets[target].active !== null ||
      state.targets[target].retired_active.some(isLiveRetiredPreviewOwnership),
  );
  if (
    hasInFlightOwnership &&
    Buffer.byteLength(renderPreviewJournalBody(journal), "utf8") <
      ACTIVE_CHECKPOINT_BYTES
  ) {
    return journal;
  }
  if (pullRequest !== null) {
    invariant(
      normalizePullRequest(pullRequest).number === journal.pr,
      "Capacity checkpoint PR mismatch",
    );
  }
  const pull = representedPullRequest(
    journal.receipts.events,
    journal.checkpoint,
  );
  const { closure, lineage } = selectCurrentEpoch(
    journal.receipts.events,
    pull,
    journal.checkpoint,
  );
  const tailEvent = closure ?? lineage.at(-1) ?? null;
  invariant(tailEvent, "Preview checkpoint tail event is missing");
  invariant(
    !state.closed ||
      (tailEvent.event_action === "closed" &&
        tailEvent.pr_closed_at === state.epoch.closed_at),
    "Preview checkpoint closure does not match persisted lifecycle state",
  );
  const aggregate = [...state.status_decisions]
    .reverse()
    .find((decision) => decision.sha === tailEvent.head_sha);
  const quarantinedKeys = new Set(
    PREVIEW_TARGETS.flatMap((target) =>
      state.targets[target].retired_active
        .filter((selection) => !isLiveRetiredPreviewOwnership(selection))
        .map((selection) => selection.key_digest),
    ),
  );
  if (!hasInFlightOwnership) {
    invariant(aggregate, "Preview checkpoint tail status is missing");
    invariant(
      aggregate.state !== "pending",
      "Preview journal cannot checkpoint a pending tail status",
    );
    assertCheckpointableReceipts(
      journal.receipts,
      journal.receipts.results,
      quarantinedKeys,
    );
  }

  const checkpointTargets = {};
  const protectedKeys = new Set();
  for (const target of PREVIEW_TARGETS) {
    const targetState = state.targets[target];
    const priorTarget = journal.checkpoint?.targets[target] ?? null;
    const liveRetired = targetState.retired_active.filter(
      isLiveRetiredPreviewOwnership,
    );
    const pendingOwner =
      targetState.active ??
      liveRetired.find(
        (selection) =>
          selection.key_digest === priorTarget?.pending_owner_key_digest,
      ) ??
      liveRetired[0] ??
      null;
    for (const selection of [targetState.active, ...liveRetired].filter(
      Boolean,
    )) {
      protectedKeys.add(selection.key_digest);
    }
    const latestRuntimeEvent = runtimeEventForTarget(
      lineage,
      journal.checkpoint,
      target,
    );
    const pendingOwnerEvent = pendingOwner
      ? (lineage.find(
          (event) =>
            event.event_run_id === pendingOwner.selection_receipt_run_id,
        ) ??
        [
          priorTarget?.pending_owner_event,
          priorTarget?.latest_runtime_event,
        ].find(
          (event) =>
            event?.event_run_id === pendingOwner.selection_receipt_run_id,
        ) ??
        null)
      : null;
    invariant(
      !pendingOwner || pendingOwnerEvent,
      `${target} checkpoint pending owner event is missing`,
    );
    const samePendingReceipt =
      pendingOwner &&
      priorTarget?.pending_owner_event?.event_run_id ===
        pendingOwner.selection_receipt_run_id;
    const pendingOwnerAttemptCount = pendingOwner
      ? samePendingReceipt
        ? (priorTarget.pending_owner_attempt_count ?? 0) +
          Number(
            priorTarget.pending_owner_key_digest !== pendingOwner.key_digest,
          )
        : 1 +
          targetState.terminal_history.filter(
            (terminal) =>
              terminal.selection_receipt_run_id ===
                pendingOwner.selection_receipt_run_id &&
              terminal.terminal_reason !==
                "controller-workflow-upgraded-before-dispatch",
          ).length
      : 0;
    invariant(
      pendingOwnerAttemptCount <= 2,
      `${target} runtime retry budget is already exhausted`,
    );
    const pending = Boolean(
      pendingOwner ||
      (!aggregate && latestRuntimeEvent) ||
      aggregate?.targets?.[target] === "pending",
    );
    checkpointTargets[target] = {
      first_eligible_sha:
        targetState.first_eligible_sha ?? latestRuntimeEvent?.head_sha ?? null,
      latest_desired_sha: targetState.latest_desired_sha,
      last_successful_runtime_sha: targetState.last_successful_runtime_sha,
      last_successful_runtime_url: targetState.last_successful_runtime_url,
      status: checkpointTargetStatus({
        target,
        targetState,
        aggregate,
        pending,
        priorStatus: priorTarget?.status ?? null,
      }),
      pending_owner_key_digest: pendingOwner?.key_digest ?? null,
      pending_owner_attempt_count: pendingOwnerAttemptCount,
      pending_owner_event:
        pendingOwnerEvent === null ? null : structuredClone(pendingOwnerEvent),
      latest_runtime_event:
        latestRuntimeEvent === null
          ? null
          : structuredClone(latestRuntimeEvent),
    };
  }

  const retainedReceipts = hasInFlightOwnership
    ? {
        events: [],
        selections: journal.receipts.selections.filter((selection) =>
          protectedKeys.has(selection.key_digest),
        ),
        worker_evidence: journal.receipts.worker_evidence.filter((evidence) =>
          protectedKeys.has(evidence.key_digest),
        ),
        results: journal.receipts.results.filter((result) =>
          protectedKeys.has(result.key_digest),
        ),
      }
    : { events: [], selections: [], worker_evidence: [], results: [] };
  const prunedReceipts = {
    events: journal.receipts.events,
    selections: journal.receipts.selections.filter(
      (selection) => !protectedKeys.has(selection.key_digest),
    ),
    worker_evidence: journal.receipts.worker_evidence.filter(
      (evidence) => !protectedKeys.has(evidence.key_digest),
    ),
    results: journal.receipts.results.filter(
      (result) => !protectedKeys.has(result.key_digest),
    ),
  };
  assertCheckpointableReceipts(
    prunedReceipts,
    journal.receipts.results,
    quarantinedKeys,
  );
  const prunedCount = Object.values(prunedReceipts).reduce(
    (total, receipts) => total + receipts.length,
    0,
  );
  if (hasInFlightOwnership && prunedCount === 0) return journal;
  const previousCounts =
    journal.checkpoint?.pruned_receipt_counts ?? emptyReceiptCounts();
  const prunedReceiptCounts = Object.fromEntries(
    Object.entries(previousCounts).map(([name, count]) => [
      name,
      count + prunedReceipts[name].length,
    ]),
  );
  const checkpoint = {
    schema: PREVIEW_CHECKPOINT_SCHEMA,
    sequence: (journal.checkpoint?.sequence ?? 0) + 1,
    through_event_run_id: tailEvent.event_run_id,
    cumulative_receipts_digest: digest({
      previous: journal.checkpoint?.cumulative_receipts_digest ?? null,
      receipts: receiptSetDigest(prunedReceipts),
      state: digest(state),
    }),
    pruned_receipt_counts: prunedReceiptCounts,
    event: structuredClone(tailEvent),
    targets: checkpointTargets,
  };
  journal.checkpoint = checkpoint;
  journal.receipts = retainedReceipts;
  if (!hasInFlightOwnership) {
    journal.state = checkpointBaselineState(state, checkpoint);
  }
  journal.journal_digest = previewJournalDigest(
    journal.receipts,
    journal.state,
    checkpoint,
  );
  return validatePreviewJournal(journal, journal.pr);
}

function journalRecords(journal, journalComment) {
  return {
    events: journal.receipts.events,
    workerEvidence: journal.receipts.worker_evidence,
    results: journal.receipts.results,
    selections: journal.receipts.selections,
    state: journal.state,
    checkpoint: journal.checkpoint,
    stateComment: journalComment,
    journal,
    journalComment,
  };
}

function parsePreviewJournalComments(
  comments,
  pr,
  { allowMissing = false } = {},
) {
  const matches = comments.filter(
    (comment) =>
      isTrustedBotComment(comment) &&
      typeof comment.body === "string" &&
      comment.body.startsWith(PREVIEW_JOURNAL_MARKER),
  );
  invariant(matches.length <= 1, "Multiple bot-owned preview journals exist");
  if (matches.length === 0) {
    invariant(allowMissing, "Preview journal comment does not exist");
    return null;
  }
  const journal = validatePreviewJournal(parseJournalBody(matches[0].body), pr);
  invariant(
    matches[0].body === renderPreviewJournalBody(journal),
    "Preview journal body is not canonical",
  );
  return journalRecords(journal, matches[0]);
}

async function loadPreviewJournal(
  github,
  context,
  pr,
  { allowMissing = false } = {},
) {
  return parsePreviewJournalComments(
    await listComments(github, context, pr),
    pr,
    { allowMissing },
  );
}

async function mutatePreviewJournal({
  github,
  context,
  pr: rawPr,
  allowCreate = false,
  assertCanCreate,
  expectedComment = null,
  mutate,
}) {
  const pr = pullRequestNumber(rawPr);
  const loaded = await loadPreviewJournal(github, context, pr, {
    allowMissing: allowCreate,
  });
  if (expectedComment && loaded) {
    invariant(
      loaded.journalComment.id === expectedComment.id,
      "Preview journal identity changed",
    );
  }
  if (!loaded && assertCanCreate) await assertCanCreate();
  const current = loaded?.journal ?? createPreviewJournal({ pr, revision: 1 });
  const candidate = structuredClone(current);
  mutate(candidate);
  candidate.journal_digest = previewJournalDigest(
    candidate.receipts,
    candidate.state,
    candidate.checkpoint,
  );
  const changed =
    canonicalJson({ ...candidate, revision: 0 }) !==
    canonicalJson({ ...current, revision: 0 });
  if (!changed && loaded) return { ...loaded, created: false };
  candidate.revision = loaded ? current.revision + 1 : 1;
  const journal = validatePreviewJournal(candidate, pr);
  const body = renderPreviewJournalBody(journal);
  let data;
  if (loaded) {
    ({ data } = await github.rest.issues.updateComment({
      ...ownerRepo(context),
      comment_id: loaded.journalComment.id,
      body,
    }));
  } else {
    invariant(allowCreate, "Preview journal creation is not allowed");
    ({ data } = await github.rest.issues.createComment({
      ...ownerRepo(context),
      issue_number: pr,
      body,
    }));
  }
  const reread = await loadPreviewJournal(github, context, pr);
  invariant(
    reread.journalComment.id === data.id &&
      reread.journalComment.body === body &&
      reread.journal.revision === journal.revision &&
      reread.journal.journal_digest === journal.journal_digest,
    "Preview journal lost a serialized update",
  );
  return { ...reread, created: !loaded };
}

const RECEIPT_COLLECTION = {
  event: {
    name: "events",
    validate: validateEventReceipt,
    identity: (value) => String(value.event_run_id),
  },
  selection: {
    name: "selections",
    validate: validateSelectionReceipt,
    identity: (value) => value.key_digest,
  },
  workerEvidence: {
    name: "worker_evidence",
    validate: validateWorkerEvidence,
    identity: (value) => `${value.key_digest}:${value.worker_run_id}`,
  },
  result: {
    name: "results",
    validate: validateWorkerResult,
    identity: (value) => `${value.key_digest}:${value.worker_run_id}`,
  },
};

async function appendJournalReceipt({
  github,
  context,
  pr,
  pullRequest = null,
  kind,
  value: rawValue,
  allowCreate = false,
  assertCanCreate,
}) {
  const definition = RECEIPT_COLLECTION[kind];
  invariant(definition, "Preview journal receipt kind is invalid");
  const value = definition.validate(rawValue);
  invariant(value.pr === pullRequestNumber(pr), "Preview receipt PR mismatch");
  return mutatePreviewJournal({
    github,
    context,
    pr,
    allowCreate,
    assertCanCreate,
    mutate(journal) {
      const identity = definition.identity(value);
      const existing = journal.receipts[definition.name].find(
        (entry) => definition.identity(definition.validate(entry)) === identity,
      );
      invariant(
        !existing || canonicalJson(existing) === canonicalJson(value),
        `Conflicting ${kind} receipt in preview journal`,
      );
      if (existing) return;
      let compactAfterAppend = false;
      if (kind === "event" && journal.state !== null) {
        const state = normalizeExistingState(journal.state, journal.pr);
        const liveReceiptsAreRepresented =
          state.receipts_digest ===
          controllerReceiptsDigest(
            journal.receipts.events,
            journal.receipts.results,
            journal.receipts.selections,
            journal.pr,
            journal.checkpoint,
          );
        const terminalKeys = new Set(
          journal.receipts.results.map((result) => result.key_digest),
        );
        const hasUnfinishedOwnership = PREVIEW_TARGETS.some((target) => {
          const targetState = state.targets[target];
          const pendingKey =
            journal.checkpoint?.targets[target].pending_owner_key_digest ??
            null;
          return (
            targetState.active !== null ||
            targetState.retired_active.some(
              (selection) =>
                selection.key_digest === pendingKey ||
                !terminalKeys.has(selection.key_digest),
            )
          );
        });
        if (hasUnfinishedOwnership) {
          compactAfterAppend = true;
        } else if (liveReceiptsAreRepresented) {
          compactPreviewJournal(journal);
        }
      }
      const checkpointEntry =
        kind === "event" && journal.checkpoint
          ? journal.checkpoint.event
          : null;
      if (
        checkpointEntry &&
        definition.identity(checkpointEntry) === identity
      ) {
        invariant(
          canonicalJson(checkpointEntry) === canonicalJson(value),
          "Conflicting event receipt at preview checkpoint",
        );
        return;
      }
      if (
        checkpointEntry &&
        semanticEventKey(checkpointEntry) === semanticEventKey(value)
      ) {
        return;
      }
      const entries = journal.receipts[definition.name];
      entries.push(structuredClone(value));
      if (compactAfterAppend) {
        journal.journal_digest = previewJournalDigest(
          journal.receipts,
          journal.state,
          journal.checkpoint,
        );
        compactPreviewJournal(journal, { pullRequest });
      }
    },
  });
}

async function writeControllerState({
  github,
  context,
  pr,
  state,
  stateComment,
}) {
  const updated = await mutatePreviewJournal({
    github,
    context,
    pr,
    expectedComment: stateComment,
    mutate(journal) {
      journal.state = structuredClone(state);
    },
  });
  return updated.journalComment;
}

async function writeControllerIntents({
  github,
  context,
  pr,
  state,
  selections,
  stateComment,
}) {
  const receipts = selections.map(validateSelectionReceipt);
  invariant(
    new Set(receipts.map((receipt) => receipt.key_digest)).size ===
      receipts.length,
    "Controller intents contain duplicate selections",
  );
  const updated = await mutatePreviewJournal({
    github,
    context,
    pr,
    expectedComment: stateComment,
    mutate(journal) {
      journal.state = structuredClone(state);
      for (const receipt of receipts) {
        const existing = journal.receipts.selections.find(
          (candidate) => candidate.key_digest === receipt.key_digest,
        );
        invariant(
          !existing || canonicalJson(existing) === canonicalJson(receipt),
          "Conflicting selection receipt in preview journal",
        );
        if (!existing) {
          journal.receipts.selections.push(structuredClone(receipt));
        }
      }
    },
  });
  return updated.journalComment;
}

async function pullFromApi(github, context, pr) {
  const { data } = await github.rest.pulls.get({
    ...ownerRepo(context),
    pull_number: pullRequestNumber(pr),
  });
  return data;
}

export function validateDependabotIntakeWorkflowRun(rawRun) {
  const run = plainObject(rawRun, "Dependabot intake workflow run");
  const displayTitle = boundedText(
    run.display_title,
    "Dependabot intake display title",
  );
  const parsed = parseDependabotIntakeRunName(displayTitle);
  const workflowName = boundedText(run.name, "Dependabot intake workflow name");
  invariant(
    workflowName === INTAKE_WORKFLOW_NAME || workflowName === displayTitle,
    "Dependabot intake workflow name mismatch",
  );
  const workflowPath = `.github/workflows/${INTAKE_WORKFLOW}`;
  invariant(
    run.path === workflowPath || run.path === `${workflowPath}@main`,
    "Dependabot intake workflow path mismatch",
  );
  invariant(
    run.event === "pull_request_target",
    "Dependabot intake event mismatch",
  );
  const runHeadRef = validatedHeadRef(run.head_branch);
  const runHeadSha = exactSha(run.head_sha, "Dependabot intake head SHA");
  invariant(runHeadSha === parsed.sha, "Dependabot intake head SHA mismatch");
  const runHeadRepository = plainObject(
    run.head_repository,
    "Dependabot intake head repository",
  );
  const runHeadRepositoryName = boundedText(
    runHeadRepository.full_name,
    "Dependabot intake head repository name",
  );
  const runHeadRepositoryUrl = optionalHttpsUrl(
    runHeadRepository.url,
    "Dependabot intake head repository URL",
  );
  invariant(
    runHeadRepositoryUrl ===
      `https://api.github.com/repos/${runHeadRepositoryName}`,
    "Dependabot intake head repository mismatch",
  );
  invariant(
    Array.isArray(run.pull_requests) &&
      run.pull_requests.length <= 1 &&
      (run.pull_requests.length === 1 || parsed.action === "closed"),
    "Dependabot intake PR linkage mismatch",
  );
  if (run.pull_requests.length === 1) {
    const linkedPull = plainObject(
      run.pull_requests[0],
      "Dependabot intake linked PR",
    );
    const linkedHead = plainObject(
      linkedPull.head,
      "Dependabot intake linked PR head",
    );
    const linkedHeadRepository = plainObject(
      linkedHead.repo,
      "Dependabot intake linked PR head repository",
    );
    const linkedBase = plainObject(
      linkedPull.base,
      "Dependabot intake linked PR base",
    );
    const linkedBaseRepository = plainObject(
      linkedBase.repo,
      "Dependabot intake linked PR base repository",
    );
    const linkedHeadRef = validatedHeadRef(linkedHead.ref);
    const linkedHeadSha = exactSha(
      linkedHead.sha,
      "Dependabot intake linked PR head SHA",
    );
    invariant(
      pullRequestNumber(linkedPull.number) === parsed.pr &&
        optionalHttpsUrl(linkedPull.url, "Dependabot intake linked PR URL") ===
          `https://api.github.com/repos/${PREVIEW_REPOSITORY}/pulls/${parsed.pr}`,
      "Dependabot intake linked PR identity mismatch",
    );
    invariant(
      runHeadRef === linkedHeadRef,
      "Dependabot intake head ref mismatch",
    );
    invariant(
      runHeadSha === linkedHeadSha,
      "Dependabot intake head SHA mismatch",
    );
    invariant(
      optionalHttpsUrl(
        linkedHeadRepository.url,
        "Dependabot intake linked PR head repository URL",
      ) === runHeadRepositoryUrl,
      "Dependabot intake linked PR head repository mismatch",
    );
    invariant(
      linkedBase.ref === "main" &&
        optionalHttpsUrl(
          linkedBaseRepository.url,
          "Dependabot intake linked PR base repository URL",
        ) === `https://api.github.com/repos/${PREVIEW_REPOSITORY}`,
      "Dependabot intake default-branch trust mismatch",
    );
    exactSha(linkedBase.sha, "Dependabot intake trusted base SHA");
  }
  exactRunId(run.id, "Dependabot intake workflow run ID");
  invariant(
    run.status === "completed" && run.conclusion === "success",
    "Dependabot intake workflow did not complete successfully",
  );
  validatedRepository(
    run.repository?.full_name,
    "Dependabot intake workflow repository",
  );
  return parsed;
}

export async function publishDependabotUnsupported({
  github,
  context,
  core,
  workflowRun = context.payload?.workflow_run,
}) {
  const parsed = validateDependabotIntakeWorkflowRun(workflowRun);
  const pull = normalizePullRequest(
    await pullFromApi(github, context, parsed.pr),
  );
  const current =
    parsed.action !== "closed" &&
    pull.state === "open" &&
    pull.headSha === parsed.sha &&
    pull.trust === "dependabot";
  core.setOutput("pr_number", String(parsed.pr));
  core.setOutput("head_sha", parsed.sha);
  if (!current) {
    core.setOutput("status_published", "false");
    return null;
  }
  const targetUrl = optionalHttpsUrl(
    workflowRun.html_url,
    "Dependabot intake workflow URL",
  );
  await github.rest.repos.createCommitStatus({
    ...ownerRepo(context),
    sha: parsed.sha,
    state: "success",
    context: PREVIEW_STATUS_CONTEXT,
    description: "Preview disabled for Dependabot PR",
    ...(targetUrl ? { target_url: targetUrl } : {}),
  });
  core.setOutput("status_published", "true");
  return parsed;
}

export function validateRepositoryDispatch(payload) {
  plainObject(payload, "Repository dispatch payload");
  validatedRepository(payload.repository?.full_name);
  const action = boundedText(payload.action, "Repository dispatch action", 100);
  const operation = REPOSITORY_DISPATCH_OPERATIONS.get(action);
  invariant(operation, "Repository dispatch action is not allowed");
  const clientPayload = plainObject(
    payload.client_payload,
    "Repository dispatch client payload",
  );
  const keys = Object.keys(clientPayload);
  invariant(
    keys.length === 1 && keys[0] === "pr_number",
    "Repository dispatch client payload must contain only pr_number",
  );
  return {
    operation,
    pr_number: pullRequestNumber(clientPayload.pr_number),
  };
}

export function writeRepositoryDispatchOutputs({ payload, core }) {
  const request = validateRepositoryDispatch(payload);
  core.setOutput("operation", request.operation);
  core.setOutput("pr_number", String(request.pr_number));
  return request;
}

export async function prepareBootstrap({
  github,
  context,
  core,
  prNumber: rawPr,
}) {
  const pull = await pullFromApi(github, context, rawPr);
  const snapshot = snapshotBootstrapPullRequest(
    pull,
    context.runId,
    context.runNumber ?? null,
  );
  core.setOutput("snapshot", JSON.stringify(snapshot));
  for (const [name, value] of Object.entries({
    pr_number: snapshot.pr,
    trusted_base_sha: snapshot.trusted_base_sha,
    change_base_sha: snapshot.change_base_sha,
    head_sha: snapshot.head_sha,
    trust: snapshot.trust,
    plan_required: snapshot.trust === "trusted",
  }))
    core.setOutput(name, String(value));
  return snapshot;
}

export function writeEventSnapshotOutputs({ payload, runId, runNumber, core }) {
  const snapshot = snapshotPullRequestEvent(payload, runId, runNumber);
  core.setOutput("snapshot", JSON.stringify(snapshot));
  for (const [name, value] of Object.entries({
    pr_number: snapshot.pr,
    trusted_base_sha: snapshot.trusted_base_sha,
    change_base_sha: snapshot.change_base_sha,
    head_sha: snapshot.head_sha,
    trust: snapshot.trust,
    plan_required:
      snapshot.trust === "trusted" && snapshot.event_action !== "closed",
  }))
    core.setOutput(name, String(value));
  return snapshot;
}

export async function recordEventReceipt({
  github,
  context,
  core,
  snapshotRaw,
  planRaw,
  plannerOutcome = "success",
}) {
  let snapshot;
  try {
    snapshot = snapshotRaw
      ? JSON.parse(snapshotRaw)
      : snapshotPullRequestEvent(
          context.payload,
          context.runId,
          context.runNumber ?? null,
        );
  } catch (error) {
    const fallback = context.payload?.pull_request?.head?.sha;
    if (SHA_PATTERN.test(fallback ?? "")) {
      await github.rest.repos.createCommitStatus({
        ...ownerRepo(context),
        sha: fallback,
        state: "error",
        context: PREVIEW_STATUS_CONTEXT,
        description: "Preview event validation failed",
        target_url: `https://github.com/${PREVIEW_REPOSITORY}/actions/runs/${context.runId}`,
      });
    }
    throw error;
  }
  const validatedSnapshot = validateEventReceipt(
    { ...snapshot, plan: undefined },
    { requirePlan: false },
  );
  let plan;
  try {
    plan = normalizePlannerResult(planRaw, validatedSnapshot, plannerOutcome);
  } catch (error) {
    if (
      validatedSnapshot.trust !== "trusted" ||
      validatedSnapshot.event_action === "closed"
    ) {
      throw error;
    }
    plan = normalizePlannerResult(null, validatedSnapshot, "failure");
    core.setOutput("planner_output_invalid", "true");
  }
  const receipt = validateEventReceipt({ ...validatedSnapshot, plan });
  const firstAttempt = exactRunAttempt(context.runAttempt ?? 1) === 1;
  const operatorBootstrap = receipt.event_action === "bootstrap";
  const currentBefore = normalizePullRequest(
    await pullFromApi(github, context, receipt.pr),
  );
  if (
    receipt.event_action === "closed" ||
    currentBefore.state === "closed" ||
    firstAttempt
  ) {
    const existing = await loadPreviewJournal(github, context, receipt.pr, {
      allowMissing: true,
    });
    if (!existing) {
      if (!operatorBootstrap) {
        await assertPreviewJournalIsUninitialized(github, context, receipt);
      }
      if (
        receipt.event_action === "closed" ||
        currentBefore.state === "closed"
      ) {
        core.setOutput("pr_number", String(receipt.pr));
        core.setOutput("reconcile_required", "false");
        return receipt;
      }
    }
  }
  await appendJournalReceipt({
    github,
    context,
    pr: receipt.pr,
    pullRequest: currentBefore,
    kind: "event",
    value: receipt,
    allowCreate: firstAttempt,
    assertCanCreate:
      firstAttempt && !operatorBootstrap
        ? () => assertPreviewJournalIsUninitialized(github, context, receipt)
        : undefined,
  });
  const controllerRunUrl = `https://github.com/${PREVIEW_REPOSITORY}/actions/runs/${context.runId}`;
  await ensurePreviewInitializationWitness({
    github,
    context,
    receipt,
    targetUrl: controllerRunUrl,
  });
  const current = normalizePullRequest(
    await pullFromApi(github, context, receipt.pr),
  );
  const stillCurrent =
    current.headSha === receipt.head_sha &&
    current.headRef === receipt.head_ref &&
    current.headRepository === receipt.head_repository &&
    current.author === receipt.pr_author &&
    current.state === receipt.pr_state &&
    current.updatedAt === receipt.pr_updated_at &&
    current.closedAt === receipt.pr_closed_at;
  if (stillCurrent && receipt.event_action !== "closed") {
    await github.rest.repos.createCommitStatus({
      ...ownerRepo(context),
      sha: receipt.head_sha,
      state: receipt.trust === "trusted" ? "pending" : "success",
      context: PREVIEW_STATUS_CONTEXT,
      description:
        receipt.trust === "trusted"
          ? "Preview event durably recorded"
          : "Preview unsupported for this PR source",
      target_url: controllerRunUrl,
    });
  }
  core.setOutput("pr_number", String(receipt.pr));
  core.setOutput("reconcile_required", "true");
  return receipt;
}

async function postStatusDecisions(
  github,
  context,
  decisions,
  { assertBasis, suppressExactReplay = false } = {},
) {
  const latestBySha = new Map(
    decisions.map((decision) => [decision.sha, decision]),
  );
  for (const decision of latestBySha.values()) {
    if (assertBasis) await assertBasis();
    const request = {
      ...ownerRepo(context),
      sha: exactSha(decision.sha),
      state: decision.state,
      context: PREVIEW_STATUS_CONTEXT,
      description: boundedText(decision.description, "Status description", 140),
    };
    if (decision.target_url)
      request.target_url = optionalHttpsUrl(
        decision.target_url,
        "Status target URL",
      );
    if (suppressExactReplay) {
      let latest = null;
      try {
        const { data: statuses } =
          await github.rest.repos.listCommitStatusesForRef({
            ...ownerRepo(context),
            ref: request.sha,
            per_page: 100,
          });
        // GitHub returns commit statuses newest first. Only an exact latest
        // witness may suppress a replay; a missing first-page match writes
        // conservatively instead of relying on an unbounded history scan.
        if (Array.isArray(statuses)) {
          latest = statuses.find(
            (status) => status.context === PREVIEW_STATUS_CONTEXT,
          );
        }
      } catch {
        // This lookup is only a duplicate-write optimization. A transient read
        // failure must not replace settled preview truth with a controller error.
      }
      if (
        isTrustedGitHubActionsBot(latest?.creator) &&
        latest?.state === request.state &&
        latest.description === request.description &&
        (latest.target_url ?? null) === (request.target_url ?? null)
      ) {
        if (assertBasis) await assertBasis();
        continue;
      }
    }
    if (assertBasis) await assertBasis();
    await github.rest.repos.createCommitStatus(request);
    if (assertBasis) await assertBasis();
  }
}

function workerRecoveryWindow(selected) {
  const dispatchStartedAt = new Date(
    exactTimestamp(selected.dispatch_started_at),
  );
  const start = new Date(
    dispatchStartedAt.valueOf() - WORKER_RECOVERY_BEFORE_MS,
  ).toISOString();
  const end = new Date(
    dispatchStartedAt.valueOf() + WORKER_RECOVERY_AFTER_MS,
  ).toISOString();
  return { start, end, created: `${start}..${end}` };
}

async function listWorkerRuns(github, context, selected) {
  const window = workerRecoveryWindow(selected);
  const runs = [];
  for (let page = 1; page <= MAX_WORKER_RUN_PAGES; page += 1) {
    const { data } = await github.rest.actions.listWorkflowRuns({
      ...ownerRepo(context),
      workflow_id: WORKER_WORKFLOW,
      event: "workflow_dispatch",
      branch: "main",
      created: window.created,
      page,
      per_page: WORKER_RUN_PAGE_SIZE,
    });
    invariant(
      Array.isArray(data.workflow_runs) &&
        data.workflow_runs.length <= WORKER_RUN_PAGE_SIZE,
      "Worker run lookup was malformed",
    );
    for (const run of data.workflow_runs) {
      const createdAt = exactTimestamp(run.created_at);
      invariant(
        createdAt >= window.start && createdAt <= window.end,
        "Worker run lookup escaped its dispatch-time proof window",
      );
      runs.push(run);
    }
    const totalCount = data.total_count;
    invariant(
      Number.isSafeInteger(totalCount) && totalCount >= runs.length,
      "Worker run lookup total count was malformed",
    );
    if (totalCount === runs.length) return runs;
    invariant(
      data.workflow_runs.length === WORKER_RUN_PAGE_SIZE,
      "Worker run lookup pagination was incomplete inside its proof window",
    );
  }
  throw new Error(
    `Worker run lookup exceeded the bounded ${MAX_WORKER_RUN_PAGES * WORKER_RUN_PAGE_SIZE}-run dispatch-time proof window`,
  );
}

function classifyWorkerRuns(
  runs,
  selected,
  { ignoreWorkflowShaMismatch = false } = {},
) {
  const matches = [];
  const pendingTitleRunIds = [];
  const settledRunIds = [];
  for (const run of runs) {
    let parsed;
    try {
      parsed = parseWorkerRunName(run.display_title);
    } catch (error) {
      let workflowSha;
      try {
        workflowSha = exactSha(run.head_sha, "Worker workflow SHA");
      } catch {
        throw error;
      }
      if (workflowSha !== selected.expected_workflow_sha) {
        try {
          settledRunIds.push(exactRunId(run.id, "Worker run ID"));
        } catch {
          // An unrelated malformed list entry cannot settle a known run ID.
        }
        continue;
      }
      if (run.display_title !== WORKER_WORKFLOW_NAME) throw error;
      const { details } = validateWorkerRunEnvelope(run, selected);
      pendingTitleRunIds.push(details.workflow_run_id);
      continue;
    }
    if (
      parsed.pr !== selected.pr ||
      parsed.target !== selected.target ||
      parsed.sha !== selected.sha ||
      parsed.keyDigest !== selected.key_digest
    ) {
      try {
        settledRunIds.push(exactRunId(run.id, "Worker run ID"));
      } catch {
        // Strictly named unrelated runs do not own this selection.
      }
      continue;
    }
    try {
      const details = validateWorkerRunIdentity(run, selected);
      matches.push(details);
      settledRunIds.push(details.workflow_run_id);
    } catch (error) {
      if (
        ignoreWorkflowShaMismatch &&
        error instanceof WorkerWorkflowShaMismatchError
      ) {
        try {
          settledRunIds.push(exactRunId(run.id, "Worker run ID"));
        } catch {
          // The mismatched run cannot own this selection.
        }
        continue;
      }
      throw error;
    }
  }
  return { matches, pendingTitleRunIds, settledRunIds };
}

function mergeWorkerRecoveryObservation(recovery, observation) {
  for (const details of observation.matches) {
    recovery.matches.set(details.workflow_run_id, details);
  }
  invariant(
    recovery.matches.size <= 1,
    "Multiple worker runs match one intended controller key",
  );
  for (const runId of observation.settledRunIds) {
    recovery.pendingTitleRunIds.delete(runId);
  }
  for (const runId of observation.pendingTitleRunIds) {
    if (!recovery.matches.has(runId)) {
      recovery.pendingTitleRunIds.add(runId);
    }
  }
}

function recoveredWorkerRun(recovery) {
  return recovery.matches.values().next().value ?? null;
}

async function waitForPendingWorkerTitles({
  github,
  context,
  selected,
  initialObservation,
  pause,
  ignoreWorkflowShaMismatch,
}) {
  const recovery = {
    matches: new Map(),
    pendingTitleRunIds: new Set(),
  };
  mergeWorkerRecoveryObservation(recovery, initialObservation);
  for (
    let observation = 0;
    observation < WORKER_RUN_TITLE_OBSERVATIONS;
    observation += 1
  ) {
    if (recovery.pendingTitleRunIds.size === 0) {
      return recoveredWorkerRun(recovery);
    }
    if (observation === WORKER_RUN_TITLE_OBSERVATIONS - 1) break;
    await pause(WORKER_RUN_TITLE_RETRY_MS);
    mergeWorkerRecoveryObservation(
      recovery,
      classifyWorkerRuns(
        await listWorkerRuns(github, context, selected),
        selected,
        { ignoreWorkflowShaMismatch },
      ),
    );
    for (const runId of [...recovery.pendingTitleRunIds]) {
      mergeWorkerRecoveryObservation(
        recovery,
        classifyWorkerRuns(
          [await getWorkerRun(github, context, runId, selected)],
          selected,
          { ignoreWorkflowShaMismatch },
        ),
      );
    }
  }
  throw new Error(WORKER_RUN_NAME_PARSE_ERROR);
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function recoverMatchingWorkerRun(
  github,
  context,
  selected,
  { waitForRetry = wait, ignoreWorkflowShaMismatch = false } = {},
) {
  const pause = waitForRetry ?? wait;
  for (
    let attempt = 0;
    attempt < WORKER_RUN_VISIBILITY_ATTEMPTS;
    attempt += 1
  ) {
    const observation = classifyWorkerRuns(
      await listWorkerRuns(github, context, selected),
      selected,
      { ignoreWorkflowShaMismatch },
    );
    invariant(
      observation.matches.length <= 1,
      "Multiple worker runs match one intended controller key",
    );
    if (observation.pendingTitleRunIds.length > 0) {
      return waitForPendingWorkerTitles({
        github,
        context,
        selected,
        initialObservation: observation,
        pause,
        ignoreWorkflowShaMismatch,
      });
    }
    if (observation.matches.length === 1) {
      return observation.matches[0];
    }
    if (attempt < WORKER_RUN_VISIBILITY_ATTEMPTS - 1) {
      await pause(WORKER_RUN_VISIBILITY_RETRY_MS);
    }
  }
  return null;
}

function validateWorkerRunSource(run) {
  plainObject(run, "Worker run");
  const displayTitle = boundedText(
    run.display_title,
    "Worker run display title",
  );
  const workflowName = boundedText(run.name, "Worker workflow name");
  invariant(
    workflowName === WORKER_WORKFLOW_NAME || workflowName === displayTitle,
    "Worker workflow name mismatch",
  );
  const workflowPath = `.github/workflows/${WORKER_WORKFLOW}`;
  invariant(
    run.path === workflowPath || run.path === `${workflowPath}@main`,
    "Worker workflow path mismatch",
  );
  invariant(run.event === "workflow_dispatch", "Worker event mismatch");
  invariant(run.head_branch === "main", "Worker default ref mismatch");
  const workflowSha = exactSha(run.head_sha, "Worker workflow SHA");
  const workflowRunId = exactRunId(run.id, "Worker run ID");
  validatedRepository(run.repository?.full_name, "Worker workflow repository");
  return { displayTitle, workflowRunId, workflowSha };
}

function validateWorkerRunEnvelope(run, selected) {
  const { displayTitle, workflowRunId, workflowSha } =
    validateWorkerRunSource(run);
  const runAttempt = exactRunAttempt(run.run_attempt ?? 1);
  const runUrl = optionalHttpsUrl(run.url, "Worker API run URL");
  const htmlUrl = optionalHttpsUrl(run.html_url, "Worker HTML run URL");
  const status = boundedText(run.status, "Worker run status", 32);
  const conclusion =
    run.conclusion === null
      ? null
      : boundedText(run.conclusion, "Worker run conclusion", 32);
  if (workflowSha !== selected.expected_workflow_sha) {
    throw new WorkerWorkflowShaMismatchError({
      runId: workflowRunId,
      actualWorkflowSha: workflowSha,
      expectedWorkflowSha: selected.expected_workflow_sha,
    });
  }
  return {
    displayTitle,
    details: {
      workflow_run_id: workflowRunId,
      workflow_sha: workflowSha,
      workflow_run_attempt: runAttempt,
      run_url: runUrl,
      html_url: htmlUrl,
      status,
      conclusion,
    },
  };
}

export function validateWorkerRunIdentity(run, selected) {
  const { displayTitle, details } = validateWorkerRunEnvelope(run, selected);
  const parsed = parseWorkerRunName(displayTitle);
  invariant(
    parsed.pr === selected.pr &&
      parsed.target === selected.target &&
      parsed.sha === selected.sha &&
      parsed.keyDigest === selected.key_digest,
    "Worker run identity does not match selection",
  );
  return details;
}

async function getValidatedWorkerRun(
  github,
  context,
  runId,
  selected,
  { waitForRetry = wait } = {},
) {
  const pause = waitForRetry ?? wait;
  let pendingTitleError;
  for (
    let observation = 0;
    observation < WORKER_RUN_TITLE_OBSERVATIONS;
    observation += 1
  ) {
    const data = await getWorkerRun(github, context, runId, selected);
    const { displayTitle } = validateWorkerRunEnvelope(data, selected);
    if (displayTitle !== WORKER_WORKFLOW_NAME) {
      return validateWorkerRunIdentity(data, selected);
    }
    pendingTitleError = new Error(WORKER_RUN_NAME_PARSE_ERROR);
    if (observation < WORKER_RUN_TITLE_OBSERVATIONS - 1) {
      await pause(WORKER_RUN_TITLE_RETRY_MS);
    }
  }
  throw pendingTitleError;
}

async function getWorkerRun(github, context, runId, selected) {
  const request = {
    ...ownerRepo(context),
    run_id: exactRunId(runId),
  };
  const response =
    selected.workflow_run_attempt === null ||
    selected.workflow_run_attempt === undefined
      ? await github.rest.actions.getWorkflowRun(request)
      : await github.request(
          "GET /repos/{owner}/{repo}/actions/runs/{run_id}/attempts/{attempt_number}",
          {
            ...request,
            attempt_number: exactRunAttempt(selected.workflow_run_attempt),
            headers: { "X-GitHub-Api-Version": "2026-03-10" },
          },
        );
  return response.data;
}

async function dispatchWorker(
  github,
  workerDispatchGithub,
  context,
  selected,
  { controllerMode, waitForRunDetails = wait } = {},
) {
  invariant(
    controllerMode === "active",
    "Worker dispatch is disabled by preview controller mode",
  );
  invariant(
    workerDispatchGithub !== null && workerDispatchGithub !== undefined,
    "Worker dispatch credential is unavailable",
  );
  const response = await workerDispatchGithub.request(
    "POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches",
    {
      ...ownerRepo(context),
      workflow_id: WORKER_WORKFLOW,
      ref: "main",
      inputs: {
        pull_request_number: String(selected.pr),
        target: selected.target,
        commit_sha: selected.sha,
        git_branch: selected.git_ref,
        controller_key: selected.key,
        controller_key_digest: selected.key_digest,
        epoch_anchor_run_id: String(selected.epoch_anchor_run_id),
        reconciliation_basis_digest: selected.reconciliation_basis_digest,
        selection_receipt_run_id: String(selected.selection_receipt_run_id),
        expected_workflow_sha: selected.expected_workflow_sha,
      },
      return_run_details: true,
      headers: { "X-GitHub-Api-Version": "2026-03-10" },
    },
  );
  invariant(
    response.status === 200,
    "Worker dispatch did not return durable run details",
  );
  const data = plainObject(response.data, "Worker dispatch response");
  const workflowRunId = exactRunId(
    data.workflow_run_id ?? data.id,
    "Dispatched workflow run ID",
  );
  return getValidatedWorkerRun(github, context, workflowRunId, selected, {
    waitForRetry: waitForRunDetails,
  });
}

async function shaIsStillAssociated(github, context, pull, sha) {
  if (pull.head.sha === sha) return true;
  const commits = await github.paginate(github.rest.pulls.listCommits, {
    ...ownerRepo(context),
    pull_number: pull.number,
    per_page: 100,
  });
  invariant(
    commits.length < 250,
    "PR commit list reached GitHub's ambiguity limit",
  );
  return commits.some((commit) => commit.sha === sha);
}

async function recordControllerTerminalResult({
  github,
  context,
  pr,
  selection,
  state,
  terminalReason,
  runIdLabel,
}) {
  const result = validateWorkerResult({
    schema: RESULT_RECEIPT_SCHEMA,
    repository: PREVIEW_REPOSITORY,
    pr,
    target: selection.target,
    sha: selection.sha,
    controller_key: selection.key,
    key_digest: selection.key_digest,
    epoch_anchor_run_id: selection.epoch_anchor_run_id,
    reconciliation_basis_digest: selection.reconciliation_basis_digest,
    selection_receipt_run_id: selection.selection_receipt_run_id,
    expected_workflow_sha: selection.expected_workflow_sha,
    worker_run_id: exactRunId(context.runId, runIdLabel),
    worker_run_attempt: exactRunAttempt(context.runAttempt ?? 1),
    github_deployment_id: null,
    state,
    vercel_deployment_id: null,
    next_deployment_id: null,
    vercel_deployment_url: null,
    smoke_result: "not-run",
    terminal_reason: terminalReason,
  });
  await appendJournalReceipt({
    github,
    context,
    pr,
    kind: "result",
    value: result,
  });
  return result;
}

function recordRemovedSelection({ github, context, pr, selection }) {
  return recordControllerTerminalResult({
    github,
    context,
    pr,
    selection,
    state: "failure",
    terminalReason: "selection-removed-from-pr",
    runIdLabel: "Controller abort run ID",
  });
}

function recordSupersededIntent({ github, context, pr, selection }) {
  return recordControllerTerminalResult({
    github,
    context,
    pr,
    selection,
    state: "error",
    terminalReason: "controller-workflow-upgraded-before-dispatch",
    runIdLabel: "Controller upgrade run ID",
  });
}

function recordNoDispatchIntentWithoutWorker({
  github,
  context,
  pr,
  selection,
  terminalReason = NO_DISPATCH_ORPHAN_REASON,
}) {
  return recordControllerTerminalResult({
    github,
    context,
    pr,
    selection,
    state: "error",
    terminalReason,
    runIdLabel: "Controller retirement run ID",
  });
}

async function reconcileNoDispatchIntents({
  github,
  context,
  core,
  pr,
  state,
  stateComment,
  waitForRecovery,
  nativeOwnedSelectionKeyDigests = new Set(),
  selectionKeyDigests = null,
}) {
  const candidates = [];
  for (const target of PREVIEW_TARGETS) {
    const targetState = state.targets[target];
    if (
      targetState.active?.dispatch_state === "intended" &&
      targetState.active.workflow_run_id === null
    ) {
      if (
        selectionKeyDigests === null ||
        selectionKeyDigests.has(targetState.active.key_digest)
      ) {
        candidates.push({
          slot: "active",
          target,
          selection: targetState.active,
        });
      }
    }
    for (const selection of targetState.retired_active) {
      if (
        selection.dispatch_state === "intended" &&
        selection.workflow_run_id === null
      ) {
        if (
          selectionKeyDigests === null ||
          selectionKeyDigests.has(selection.key_digest)
        ) {
          candidates.push({ slot: "retired", target, selection });
        }
      }
    }
  }
  if (candidates.length === 0) return false;

  const observations = [];
  for (const candidate of candidates) {
    observations.push({
      ...candidate,
      recoveredRun: await recoverMatchingWorkerRun(
        github,
        context,
        candidate.selection,
        { waitForRetry: waitForRecovery },
      ),
    });
  }

  const recoveredState = structuredClone(state);
  const attached = [];
  let retiredWithoutWorker = false;
  for (const { slot, target, selection, recoveredRun } of observations) {
    if (!recoveredRun) {
      await recordNoDispatchIntentWithoutWorker({
        github,
        context,
        pr,
        selection,
        terminalReason: nativeOwnedSelectionKeyDigests.has(selection.key_digest)
          ? NATIVE_OWNED_SELECTION_REASON
          : NO_DISPATCH_ORPHAN_REASON,
      });
      retiredWithoutWorker = true;
      continue;
    }
    const recoveredSelection = {
      ...selection,
      dispatch_state: "dispatched",
      ...recoveredRun,
    };
    if (slot === "active") {
      invariant(
        recoveredState.targets[target].active?.key_digest ===
          selection.key_digest,
        "Active no-dispatch intent changed before recovery",
      );
      recoveredState.targets[target].active = recoveredSelection;
    } else {
      const retiredIndex = recoveredState.targets[
        target
      ].retired_active.findIndex(
        (candidate) => candidate.key_digest === selection.key_digest,
      );
      invariant(retiredIndex >= 0, "Retired no-dispatch intent disappeared");
      recoveredState.targets[target].retired_active[retiredIndex] =
        recoveredSelection;
    }
    attached.push({ recoveredRun, recoveredSelection });
  }

  if (retiredWithoutWorker) {
    core.setOutput("retired_undispatched_intent", "true");
  }
  if (attached.length > 0) {
    await writeControllerState({
      github,
      context,
      pr,
      state: recoveredState,
      stateComment,
    });
    core.setOutput(
      "recovered_intended_run_id",
      String(attached.at(-1).recoveredRun.workflow_run_id),
    );
  }
  for (const { recoveredRun, recoveredSelection } of attached) {
    if (recoveredRun.status !== "completed") continue;
    const workflowRun = await getWorkerRun(
      github,
      context,
      recoveredRun.workflow_run_id,
      recoveredSelection,
    );
    await recoverWorkerResult({
      github,
      context,
      core,
      workflowRun,
      waitForRecovery,
    });
  }
  return true;
}

function assertDispatchTrust(pull, selected) {
  const normalized = normalizePullRequest(pull);
  invariant(normalized.state === "open", "PR closed before worker dispatch");
  invariant(
    normalized.trust === "trusted",
    "PR trust boundary changed before worker dispatch",
  );
  invariant(
    normalized.headRef === selected.git_ref,
    "PR head ref changed before worker dispatch",
  );
  return normalized;
}

async function refreshDispatchOwnership({
  github,
  context,
  pr,
  selected,
  controllerUrl,
  workflowSha,
}) {
  const pull = await pullFromApi(github, context, pr);
  if (normalizePullRequest(pull).state !== "open") {
    return { outcome: "closed" };
  }
  const normalized = assertDispatchTrust(pull, selected);
  const target = previewTarget(selected.target, "Selected preview target");
  const currentPreviewOwner = await previewOwnerAtSha(
    github,
    context,
    target,
    normalized.headSha,
  );
  if (!githubPreviewDispatchAllowed(target, currentPreviewOwner)) {
    return {
      outcome: "current-head-native",
      currentPull: normalized,
      currentPreviewOwner,
      selectedPreviewOwner: null,
    };
  }
  if (!(await shaIsStillAssociated(github, context, pull, selected.sha))) {
    return { outcome: "removed" };
  }
  const selectedPreviewOwner =
    selected.sha === normalized.headSha
      ? currentPreviewOwner
      : await previewOwnerAtSha(github, context, target, selected.sha);
  if (!githubPreviewDispatchAllowed(target, selectedPreviewOwner)) {
    return {
      outcome: "selected-native",
      currentPull: normalized,
      currentPreviewOwner,
      selectedPreviewOwner,
    };
  }
  const comments = await loadPreviewJournal(github, context, pr);
  const ownershipCheck = reconcileState({
    events: comments.events,
    results: comments.results,
    selections: comments.selections,
    pullRequest: pull,
    existingState: comments.state,
    checkpoint: comments.checkpoint,
    controllerUrl,
    expectedWorkflowSha: workflowSha,
  });
  invariant(
    ownershipCheck.state.epoch.anchor_run_id === selected.epoch_anchor_run_id &&
      ownershipCheck.state.targets[target].active?.key_digest ===
        selected.key_digest &&
      ownershipCheck.state.targets[target].active
        ?.reconciliation_basis_digest ===
        selected.reconciliation_basis_digest &&
      ownershipCheck.state.targets[target].active?.dispatch_state ===
        "intended" &&
      ownershipCheck.state.targets[target].active?.workflow_run_id === null,
    "Persisted dispatch ownership changed before credentials",
  );
  return {
    outcome: "owned",
    currentPull: normalized,
    currentPreviewOwner,
    selectedPreviewOwner,
    ownershipCheck,
  };
}

function refreshedSelectionIsNativeOwned(selection, refreshed) {
  if (refreshed.outcome === "selected-native") {
    return refreshed.selectedPreviewOwner === PREVIEW_OWNER_NATIVE;
  }
  return (
    refreshed.outcome === "current-head-native" &&
    refreshed.currentPreviewOwner === PREVIEW_OWNER_NATIVE &&
    selection.sha === refreshed.currentPull.headSha
  );
}

async function recoverCompletedOwnedRuns({
  github,
  context,
  core,
  pr,
  parsed,
}) {
  if (!parsed.state) return false;
  const state = structuredClone(normalizeExistingState(parsed.state, pr));
  const selections = PREVIEW_TARGETS.flatMap((target) => [
    ...(state.targets[target].active
      ? [
          {
            target,
            selection: state.targets[target].active,
            isCurrentActive: true,
          },
        ]
      : []),
    ...state.targets[target].retired_active.map((selection) => ({
      target,
      selection,
      isCurrentActive: false,
    })),
  ]);
  let recovered = false;
  let quarantined = false;
  const quarantineRetiredSelection = (target, selection) => {
    const retiredIndex = state.targets[target].retired_active.findIndex(
      (candidate) => candidate.key_digest === selection.key_digest,
    );
    invariant(retiredIndex >= 0, "Retired worker ownership disappeared");
    state.targets[target].retired_active = [
      ...state.targets[target].retired_active,
    ];
    state.targets[target].retired_active[retiredIndex] = {
      ...selection,
      recovery_quarantine: RETIRED_RECOVERY_QUARANTINE,
    };
    core.setOutput("retired_recovery_quarantined", "true");
    quarantined = true;
  };
  for (const { target, selection, isCurrentActive } of selections) {
    if (selection.workflow_run_id === null) continue;
    if (!isCurrentActive && selection.recovery_quarantine) continue;
    const alreadyRecorded = parsed.results.some(
      (result) =>
        result.worker_run_id === selection.workflow_run_id &&
        result.key_digest === selection.key_digest,
    );
    if (alreadyRecorded) continue;
    let workflowRun;
    try {
      workflowRun = await getWorkerRun(
        github,
        context,
        selection.workflow_run_id,
        selection,
      );
    } catch (error) {
      if (isCurrentActive) throw error;
      if (error?.status === 404 || error?.response?.status === 404) {
        quarantineRetiredSelection(target, selection);
      } else {
        core.setOutput("retired_recovery_retryable", "true");
      }
      continue;
    }
    let queried;
    try {
      queried = validateWorkerRunIdentity(workflowRun, selection);
    } catch (error) {
      if (isCurrentActive) throw error;
      quarantineRetiredSelection(target, selection);
      continue;
    }
    if (queried.status !== "completed") continue;
    try {
      await recoverWorkerResult({ github, context, core, workflowRun });
      recovered = true;
    } catch (error) {
      if (isCurrentActive) throw error;
      core.setOutput("retired_recovery_retryable", "true");
    }
  }
  if (quarantined) {
    try {
      await writeControllerState({
        github,
        context,
        pr,
        state,
        stateComment: parsed.stateComment,
      });
      return true;
    } catch {
      core.setOutput("retired_recovery_retryable", "true");
      return recovered;
    }
  }
  return recovered;
}

function isLiveRetiredPreviewOwnership(selection) {
  return selection.recovery_quarantine === undefined;
}

function hasLiveGitHubPreviewOwnership(state, target) {
  const targetState = state.targets[previewTarget(target)];
  return (
    targetState.active !== null ||
    targetState.retired_active.some(isLiveRetiredPreviewOwnership)
  );
}

function undispatchedIntentKeyDigests(state, target) {
  const targetState = state.targets[previewTarget(target)];
  return [targetState.active, ...targetState.retired_active]
    .filter(
      (selection) =>
        selection?.dispatch_state === "intended" &&
        selection.workflow_run_id === null,
    )
    .map((selection) => selection.key_digest);
}

function overrideNativeHeadOwnership({
  state,
  previousState,
  pull,
  previewOwners,
  controllerMode,
  controllerUrl,
}) {
  const index = state.status_decisions.findLastIndex(
    (decision) => decision.sha === pull.headSha,
  );
  invariant(index >= 0, "Current-head no-dispatch status decision is missing");
  const targets = {
    ...state.status_decisions[index].targets,
  };
  let nativeOwnershipChanged = false;
  let nativeOwnershipApplied = false;
  for (const target of PREVIEW_TARGETS) {
    if (
      PREVIEW_TARGET_CONFIG[target].ownershipMode !==
        PREVIEW_OWNERSHIP_MODES.GITHUB ||
      previewOwners[target] !== PREVIEW_OWNER_NATIVE
    ) {
      continue;
    }
    nativeOwnershipApplied = true;
    const nativeOutcome = hasLiveGitHubPreviewOwnership(state, target)
      ? "pending"
      : "native-owned";
    nativeOwnershipChanged ||= targets[target] !== nativeOutcome;
    targets[target] = nativeOutcome;
  }
  if (controllerMode !== "observe-only" && !nativeOwnershipApplied) {
    return structuredClone(state.status_decisions[index]);
  }
  const values = Object.values(targets);
  const desiredState = values.includes("error")
    ? "error"
    : values.includes("failed")
      ? "failure"
      : values.includes("pending")
        ? "pending"
        : "success";
  const compactOutcome = (outcome) =>
    ({
      "runtime-equivalent": "equivalent",
      "not affected": "none",
      "native-owned": "native",
      "unsupported trust boundary": "unsupported",
    })[outcome] ?? outcome;
  let description = PREVIEW_TARGETS.map(
    (target) => `${target}=${compactOutcome(targets[target])}`,
  ).join("; ");
  const ownershipDraining = PREVIEW_TARGETS.some(
    (target) =>
      PREVIEW_TARGET_CONFIG[target].ownershipMode ===
        PREVIEW_OWNERSHIP_MODES.GITHUB &&
      previewOwners[target] === PREVIEW_OWNER_NATIVE &&
      hasLiveGitHubPreviewOwnership(state, target),
  );
  if (controllerMode === "observe-only") {
    invariant(
      PREVIEW_TARGETS.every(
        (target) => previewOwners[target] !== PREVIEW_OWNER_GITHUB,
      ),
      "Observe-only controller leaves a candidate preview ownerless",
    );
    description = ownershipDraining
      ? OWNERSHIP_DRAINING_STATUS_DESCRIPTION
      : OBSERVE_ONLY_STATUS_DESCRIPTION;
  }
  const desired = {
    sha: pull.headSha,
    state:
      controllerMode === "observe-only"
        ? ownershipDraining
          ? "pending"
          : "success"
        : desiredState,
    description,
    target_url:
      controllerMode === "observe-only" || nativeOwnershipChanged
        ? controllerUrl
        : state.status_decisions[index].target_url,
    targets,
  };
  const previous = (previousState?.status_decisions ?? []).findLast(
    (decision) => decision.sha === pull.headSha,
  );
  state.status_decisions[index] = isControllerRunStatusDecision(
    previous,
    desired.state,
    desired.description,
  )
    ? { ...desired, target_url: previous.target_url }
    : desired;
  return structuredClone(state.status_decisions[index]);
}

export async function reconcilePreview({
  github,
  workerDispatchGithub = null,
  context,
  core,
  controllerMode: rawControllerMode,
  prNumber: rawPr,
  workflowSha: rawWorkflowSha,
  waitForRecovery,
  now = () => new Date().toISOString(),
  progressPassLimit: rawProgressPassLimit = MAX_RECONCILIATION_PROGRESS_PASSES,
}) {
  const pr = pullRequestNumber(rawPr);
  const controllerMode = previewControllerMode(rawControllerMode);
  const workflowSha = exactSha(rawWorkflowSha, "Controller workflow SHA");
  invariant(
    Number.isSafeInteger(rawProgressPassLimit) &&
      rawProgressPassLimit >= 0 &&
      rawProgressPassLimit <= MAX_RECONCILIATION_PROGRESS_PASSES,
    "Controller progress pass limit is invalid",
  );
  const controllerUrl = `https://github.com/${PREVIEW_REPOSITORY}/actions/runs/${context.runId}`;
  const dispatchedRunIds = [];
  let serializedUpdateAttempts = 1;
  let deterministicProgressPasses = 0;
  let ownershipMapValidated = false;
  const failClosed = async (error) => {
    const pull = await pullFromApi(github, context, pr);
    const headSha = exactSha(pull.head.sha);
    await github.rest.repos.createCommitStatus({
      ...ownerRepo(context),
      sha: headSha,
      state: "error",
      context: PREVIEW_STATUS_CONTEXT,
      description: "Preview controller state is invalid or ambiguous",
      target_url: controllerUrl,
    });
    throw error;
  };
  const recordDeterministicProgress = () => {
    deterministicProgressPasses += 1;
    invariant(
      deterministicProgressPasses <= rawProgressPassLimit,
      "Controller state update did not converge",
    );
  };

  reconcileAttempts: while (true) {
    try {
      if (!ownershipMapValidated) {
        await assertWorkflowOwnershipMap(github, context, workflowSha);
        ownershipMapValidated = true;
      }
      const pull = await pullFromApi(github, context, pr);
      const currentPull = normalizePullRequest(pull);
      const previewOwners = await candidatePreviewOwners(github, context, pull);
      if (controllerMode === "observe-only") {
        invariant(
          PREVIEW_TARGETS.every(
            (target) => previewOwners[target] !== PREVIEW_OWNER_GITHUB,
          ),
          "Observe-only controller leaves a candidate preview ownerless",
        );
      }
      const parsed = await loadPreviewJournal(github, context, pr);
      const stateBeforeReconciliation =
        parsed.state === null ? null : canonicalJson(parsed.state);
      if (
        await recoverCompletedOwnedRuns({
          github,
          context,
          core,
          pr,
          parsed,
        })
      ) {
        recordDeterministicProgress();
        continue reconcileAttempts;
      }
      const reconciled = reconcileState({
        events: parsed.events,
        results: parsed.results,
        selections: parsed.selections,
        pullRequest: pull,
        existingState: parsed.state,
        checkpoint: parsed.checkpoint,
        controllerUrl,
        expectedWorkflowSha: workflowSha,
      });
      let state = reconciled.state;
      let stateComment = parsed.stateComment;

      if (controllerMode === "observe-only") {
        if (
          await reconcileNoDispatchIntents({
            github,
            context,
            core,
            pr,
            state,
            stateComment,
            waitForRecovery,
          })
        ) {
          recordDeterministicProgress();
          continue reconcileAttempts;
        }
        let headDecision = null;
        if (currentPull.state === "open") {
          headDecision = overrideNativeHeadOwnership({
            state,
            previousState: parsed.state,
            pull: currentPull,
            previewOwners,
            controllerMode,
            controllerUrl,
          });
        }
        stateComment = await writeControllerState({
          github,
          context,
          pr,
          state,
          stateComment,
        });
        if (headDecision) {
          await github.rest.repos.createCommitStatus({
            ...ownerRepo(context),
            sha: headDecision.sha,
            state: headDecision.state,
            context: PREVIEW_STATUS_CONTEXT,
            description: headDecision.description,
            target_url: headDecision.target_url,
          });
          if (
            headDecision.state === "pending" &&
            headDecision.description === OWNERSHIP_DRAINING_STATUS_DESCRIPTION
          ) {
            core.setOutput("preview_ownership_draining", "true");
          }
        }
        core.setOutput("controller_mode", controllerMode);
        core.setOutput("preview_owners", JSON.stringify(previewOwners));
        core.setOutput("dispatch_skipped", "true");
        core.setOutput("pr_number", String(pr));
        return state;
      }

      const selected = [];
      if (!state.closed) {
        for (const dispatch of reconciled.nextDispatches) {
          const intended = {
            ...dispatch,
            dispatch_started_at: exactTimestamp(now()),
            dispatch_state: "intended",
            workflow_run_id: null,
            workflow_sha: null,
            workflow_run_attempt: null,
            run_url: null,
            html_url: null,
          };
          state.targets[dispatch.target].active = intended;
          selected.push(intended);
        }
        for (const target of PREVIEW_TARGETS) {
          const active = state.targets[target].active;
          if (
            active?.dispatch_state === "intended" &&
            active.workflow_run_id === null &&
            !selected.some(
              (candidate) => candidate.key_digest === active.key_digest,
            )
          ) {
            selected.push(active);
          }
        }
      }
      if (selected.length > 0) {
        stateComment = await writeControllerIntents({
          github,
          context,
          pr,
          state,
          selections: selected.map(selectionReceiptFromDispatch),
          stateComment,
        });
      } else {
        stateComment = await writeControllerState({
          github,
          context,
          pr,
          state,
          stateComment,
        });
      }

      const nativeSelectionKeys = new Set();
      const noDispatchSelectionKeys = new Set();
      for (const selection of selected) {
        const refreshed = await refreshDispatchOwnership({
          github,
          context,
          pr,
          selected: selection,
          controllerUrl,
          workflowSha,
        });
        if (refreshed.outcome === "closed") {
          core.setOutput("dispatch_skipped_closed", "true");
          return state;
        }
        if (refreshed.outcome === "removed") {
          await recordRemovedSelection({
            github,
            context,
            pr,
            selection,
          });
          recordDeterministicProgress();
          continue reconcileAttempts;
        }
        if (
          refreshed.outcome === "current-head-native" ||
          refreshed.outcome === "selected-native"
        ) {
          for (const keyDigest of undispatchedIntentKeyDigests(
            state,
            selection.target,
          )) {
            noDispatchSelectionKeys.add(keyDigest);
          }
          if (refreshedSelectionIsNativeOwned(selection, refreshed)) {
            nativeSelectionKeys.add(selection.key_digest);
          }
        }
      }
      if (noDispatchSelectionKeys.size > 0) {
        invariant(
          await reconcileNoDispatchIntents({
            github,
            context,
            core,
            pr,
            state,
            stateComment,
            waitForRecovery,
            nativeOwnedSelectionKeyDigests: nativeSelectionKeys,
            selectionKeyDigests: noDispatchSelectionKeys,
          }),
          "Native-owned selection did not retain its durable intent",
        );
        recordDeterministicProgress();
        continue reconcileAttempts;
      }

      let restartReconciliation = false;
      for (const selection of selected) {
        let recoveredRun;
        try {
          recoveredRun = await recoverMatchingWorkerRun(
            github,
            context,
            selection,
            {
              waitForRetry: waitForRecovery,
              ignoreWorkflowShaMismatch:
                selection.expected_workflow_sha !== workflowSha,
            },
          );
        } catch (error) {
          if (error instanceof WorkerWorkflowShaMismatchError) {
            await recordSupersededIntent({
              github,
              context,
              pr,
              selection,
            });
          }
          throw error;
        }
        const refreshed = await refreshDispatchOwnership({
          github,
          context,
          pr,
          selected: selection,
          controllerUrl,
          workflowSha,
        });
        if (refreshed.outcome === "closed") {
          core.setOutput("dispatch_skipped_closed", "true");
          return state;
        }
        if (refreshed.outcome === "removed") {
          await recordRemovedSelection({
            github,
            context,
            pr,
            selection,
          });
          restartReconciliation = true;
          break;
        }
        if (
          refreshed.outcome === "current-head-native" ||
          refreshed.outcome === "selected-native"
        ) {
          const selectionKeys = new Set(
            undispatchedIntentKeyDigests(state, selection.target),
          );
          const nativeSelectionKeys = refreshedSelectionIsNativeOwned(
            selection,
            refreshed,
          )
            ? new Set([selection.key_digest])
            : new Set();
          invariant(
            await reconcileNoDispatchIntents({
              github,
              context,
              core,
              pr,
              state,
              stateComment,
              waitForRecovery,
              nativeOwnedSelectionKeyDigests: nativeSelectionKeys,
              selectionKeyDigests: selectionKeys,
            }),
            "Racing native-owned selection lost durable intent",
          );
          restartReconciliation = true;
          break;
        }
        if (!recoveredRun && selection.expected_workflow_sha !== workflowSha) {
          await recordSupersededIntent({
            github,
            context,
            pr,
            selection,
          });
          restartReconciliation = true;
          break;
        }
        let runDetails = recoveredRun;
        if (!runDetails) {
          try {
            runDetails = await dispatchWorker(
              github,
              workerDispatchGithub,
              context,
              selection,
              { controllerMode, waitForRunDetails: waitForRecovery },
            );
          } catch (error) {
            if (error instanceof WorkerWorkflowShaMismatchError) {
              await recordSupersededIntent({
                github,
                context,
                pr,
                selection,
              });
            }
            throw error;
          }
        }
        state = {
          ...refreshed.ownershipCheck.state,
          targets: {
            ...refreshed.ownershipCheck.state.targets,
            [selection.target]: {
              ...refreshed.ownershipCheck.state.targets[selection.target],
              active: {
                ...refreshed.ownershipCheck.state.targets[selection.target]
                  .active,
                dispatch_state: "dispatched",
                ...runDetails,
              },
            },
          },
        };
        stateComment = await writeControllerState({
          github,
          context,
          pr,
          state,
          stateComment,
        });
        dispatchedRunIds.push(runDetails.workflow_run_id);
      }
      if (restartReconciliation) {
        recordDeterministicProgress();
        continue reconcileAttempts;
      }
      core.setOutput("dispatched_run_ids", JSON.stringify(dispatchedRunIds));

      const finalPull = await pullFromApi(github, context, pr);
      const finalCurrentPull = normalizePullRequest(finalPull);
      const finalOwners = await candidatePreviewOwners(
        github,
        context,
        finalPull,
      );
      const finalComments = await loadPreviewJournal(github, context, pr);
      const finalReconciled = reconcileState({
        events: finalComments.events,
        results: finalComments.results,
        selections: finalComments.selections,
        pullRequest: finalPull,
        existingState: finalComments.state,
        checkpoint: finalComments.checkpoint,
        controllerUrl,
        expectedWorkflowSha: workflowSha,
      });
      invariant(
        finalReconciled.state.epoch.anchor_run_id ===
          state.epoch.anchor_run_id &&
          finalReconciled.state.epoch.basis_digest === state.epoch.basis_digest,
        "Reconciliation basis changed before status publication",
      );
      state = finalReconciled.state;
      if (finalCurrentPull.state === "open") {
        overrideNativeHeadOwnership({
          state,
          previousState: finalComments.state,
          pull: finalCurrentPull,
          previewOwners: finalOwners,
          controllerMode,
          controllerUrl,
        });
      }
      stateComment = await writeControllerState({
        github,
        context,
        pr,
        state,
        stateComment,
      });
      const readStatusBasis = async () => {
        const confirmed = await loadPreviewJournal(github, context, pr);
        invariant(
          confirmed.stateComment?.id === stateComment.id &&
            canonicalJson(confirmed.state) === canonicalJson(state),
          "Controller state changed before status publication",
        );
        invariant(
          confirmed.state.receipts_digest ===
            controllerReceiptsDigest(
              confirmed.events,
              confirmed.results,
              confirmed.selections,
              pr,
              confirmed.checkpoint,
            ),
          "Controller receipt set changed before status publication",
        );
        return confirmed;
      };
      const assertStatusBasis = async () => {
        await readStatusBasis();
      };
      await assertStatusBasis();
      await postStatusDecisions(github, context, state.status_decisions, {
        assertBasis: assertStatusBasis,
        suppressExactReplay:
          stateBeforeReconciliation !== null &&
          stateBeforeReconciliation === canonicalJson(state),
      });
      core.setOutput("preview_owners", JSON.stringify(finalOwners));
      core.setOutput("pr_number", String(pr));
      return state;
    } catch (error) {
      if (
        serializedUpdateAttempts < MAX_SERIALIZED_UPDATE_ATTEMPTS &&
        /serialized update|identity changed|basis changed|changed before status|receipt set changed|ownership changed/.test(
          error.message,
        )
      ) {
        serializedUpdateAttempts += 1;
        continue;
      }
      return failClosed(error);
    }
  }
}

async function loadControllerEvidence(github, context, pr) {
  const parsed = await loadPreviewJournal(github, context, pr);
  invariant(parsed.state !== null, "Preview journal state does not exist");
  normalizeExistingState(parsed.state, pr);
  return parsed;
}

function workerResultAffectsCurrentReconciliation({
  evidence,
  state,
  selection,
  currentSelection,
}) {
  const target = previewTarget(selection.target, "Worker result target");
  return (
    (selection === currentSelection &&
      selection.epoch_anchor_run_id === state.epoch.anchor_run_id) ||
    evidence.checkpoint?.targets[target].pending_owner_key_digest ===
      selection.key_digest
  );
}

async function foldCompletedRetiredOwner({
  github,
  context,
  evidence,
  state,
  selection,
}) {
  const target = previewTarget(selection.target, "Completed worker target");
  const targetState = state.targets[target];
  if (
    evidence.checkpoint?.targets[target].pending_owner_key_digest ===
      selection.key_digest ||
    targetState.active?.key_digest === selection.key_digest
  ) {
    return;
  }
  const retained = targetState.retired_active.filter(
    (candidate) => candidate.key_digest !== selection.key_digest,
  );
  if (retained.length === targetState.retired_active.length) return;
  targetState.retired_active = retained;
  await writeControllerState({
    github,
    context,
    pr: selection.pr,
    state,
    stateComment: evidence.stateComment,
  });
}

function workflowRunIdFromUrl(value) {
  if (typeof value !== "string") return null;
  const match = value.match(/\/actions\/runs\/([1-9][0-9]{0,19})(?:\/|$)/);
  return match ? exactRunId(match[1], "Workflow run URL ID") : null;
}

function evidenceForDeploymentStatus({
  evidence,
  deploymentId,
  status,
  currentKeyDigest,
  currentRunId,
}) {
  const candidates = evidence.workerEvidence.filter(
    (item) =>
      item.github_deployment_id === deploymentId &&
      item.worker_run_id !== currentRunId,
  );
  const statusRunId = workflowRunIdFromUrl(status?.log_url);
  if (statusRunId !== null) {
    const matches = candidates.filter(
      (item) => item.worker_run_id === statusRunId,
    );
    invariant(
      matches.length <= 1,
      "Deployment status matches multiple worker evidence receipts",
    );
    if (matches.length === 1) return matches[0];
  }
  const sameSelection = candidates.filter(
    (item) => item.key_digest === currentKeyDigest,
  );
  invariant(
    sameSelection.length <= 1,
    "Current selection has ambiguous worker evidence",
  );
  if (sameSelection.length === 1) return sameSelection[0];
  invariant(
    candidates.length <= 1,
    "Canonical Deployment has ambiguous prior worker evidence",
  );
  return candidates[0] ?? null;
}

function resultForDeploymentStatus({
  evidence,
  deploymentId,
  status,
  currentKeyDigest,
  currentRunId,
}) {
  const candidates = evidence.results.filter(
    (result) =>
      result.github_deployment_id === deploymentId &&
      result.worker_run_id !== currentRunId,
  );
  const statusRunId = workflowRunIdFromUrl(status?.log_url);
  if (statusRunId !== null) {
    const match = candidates.find(
      (result) => result.worker_run_id === statusRunId,
    );
    if (match) return match;
  }
  const sameSelection = candidates
    .filter((result) => result.key_digest === currentKeyDigest)
    .sort((a, b) => b.worker_run_id - a.worker_run_id);
  if (sameSelection.length > 0) return sameSelection[0];
  invariant(
    candidates.length <= 1,
    "Canonical Deployment has ambiguous prior worker results",
  );
  return candidates[0] ?? null;
}

function setBuildDecision(core, executionMode) {
  core.setOutput("should_deploy", "true");
  core.setOutput("should_resume_smoke", "false");
  core.setOutput("execution_mode", executionMode);
  return {
    shouldDeploy: true,
    duplicate: false,
    ...(executionMode === "build-retry" ? { retryBuild: true } : {}),
  };
}

function setSmokeResumeDecision(core, deployment, source) {
  const url = immutableVercelUrl(
    source.vercel_deployment_url ?? source.verified_upload_url,
  );
  const vercelDeploymentId = boundedText(
    source.vercel_deployment_id,
    "Vercel deployment ID",
    128,
  );
  const nextDeploymentId = optionalNextDeploymentId(source.next_deployment_id);
  invariant(
    url && vercelDeploymentId && nextDeploymentId,
    "Smoke resume evidence is incomplete",
  );
  core.setOutput("should_deploy", "false");
  core.setOutput("should_resume_smoke", "true");
  core.setOutput("execution_mode", "resume-smoke");
  core.setOutput("github_deployment_id", String(deployment.id));
  core.setOutput("vercel_deployment_url", url);
  core.setOutput("vercel_deployment_id", vercelDeploymentId);
  core.setOutput("next_deployment_id", nextDeploymentId);
  return { shouldDeploy: false, duplicate: false, resumeSmoke: true };
}

export async function validateWorkerDispatch({
  github,
  context,
  core,
  inputs,
  workflowSha: rawWorkflowSha,
}) {
  const expectedWorkflowSha = exactSha(
    inputs.expected_workflow_sha,
    "Expected worker workflow SHA",
  );
  const workflowSha = exactSha(rawWorkflowSha, "Actual worker workflow SHA");
  invariant(
    workflowSha === expectedWorkflowSha,
    "Actual worker workflow SHA does not match controller-authorized SHA",
  );
  const pr = pullRequestNumber(inputs.pull_request_number);
  const target = previewTarget(inputs.target, "Worker target");
  const sha = exactSha(inputs.commit_sha);
  const gitRef = validatedWorkerHeadRef(inputs.git_branch);
  const key = boundedText(inputs.controller_key, "Controller key", 255);
  invariant(
    key === controllerKey(pr, sha, target),
    "Worker controller key is invalid",
  );
  const epochAnchorRunId = exactRunId(
    inputs.epoch_anchor_run_id,
    "Worker epoch anchor run ID",
  );
  const basisDigest = boundedText(
    inputs.reconciliation_basis_digest,
    "Worker reconciliation basis digest",
    64,
  );
  invariant(
    /^[0-9a-f]{64}$/.test(basisDigest),
    "Worker reconciliation basis digest is invalid",
  );
  const selectionReceiptRunId = exactRunId(
    inputs.selection_receipt_run_id,
    "Worker selection receipt run ID",
  );
  const keyDigest = boundedText(
    inputs.controller_key_digest,
    "Controller key digest",
    24,
  );
  invariant(
    keyDigest ===
      controllerKeyDigest(key, {
        epochAnchorRunId,
        basisDigest,
        selectionReceiptRunId,
        expectedWorkflowSha,
      }),
    "Worker controller key digest is invalid",
  );
  const pull = await pullFromApi(github, context, pr);
  const normalizedPull = assertDispatchTrust(pull, { git_ref: gitRef });
  invariant(
    await shaIsStillAssociated(github, context, pull, sha),
    "Selected SHA is no longer associated with the PR lineage",
  );
  const currentPreviewOwner = await previewOwnerAtSha(
    github,
    context,
    target,
    normalizedPull.headSha,
  );
  invariant(
    githubPreviewDispatchAllowed(target, currentPreviewOwner),
    `GitHub preview worker is not allowed for the current ${target} configuration`,
  );
  const selectedPreviewOwner =
    sha === normalizedPull.headSha
      ? currentPreviewOwner
      : await previewOwnerAtSha(github, context, target, sha);
  invariant(
    githubPreviewDispatchAllowed(target, selectedPreviewOwner),
    `GitHub preview worker is not allowed for the selected ${target} configuration`,
  );
  const evidence = await loadControllerEvidence(github, context, pr);
  const state = evidence.state;
  const active = state.targets[target]?.active;
  const selectionReceipt = evidence.selections.find(
    (selection) => selection.key_digest === keyDigest,
  );
  invariant(
    active?.key === key &&
      active?.sha === sha &&
      active?.key_digest === keyDigest &&
      active?.epoch_anchor_run_id === epochAnchorRunId &&
      active?.reconciliation_basis_digest === basisDigest &&
      active?.selection_receipt_run_id === selectionReceiptRunId &&
      active?.expected_workflow_sha === expectedWorkflowSha,
    "Controller state does not own this worker key",
  );
  invariant(
    selectionReceipt &&
      selectionReceipt.target === target &&
      selectionReceipt.sha === sha &&
      selectionReceipt.epoch_anchor_run_id === epochAnchorRunId &&
      selectionReceipt.reconciliation_basis_digest === basisDigest &&
      selectionReceipt.selection_receipt_run_id === selectionReceiptRunId &&
      selectionReceipt.expected_workflow_sha === expectedWorkflowSha,
    "Immutable selection receipt does not own this worker key",
  );
  const thisRun = exactRunId(context.runId);
  const thisRunAttempt = exactRunAttempt(context.runAttempt ?? 1);
  if (active.workflow_run_id !== null && active.workflow_run_id !== thisRun) {
    core.setOutput("should_deploy", "false");
    core.setOutput("should_resume_smoke", "false");
    core.setOutput("execution_mode", "duplicate-owner");
    core.setOutput("duplicate_owner_run_id", String(active.workflow_run_id));
    return { shouldDeploy: false, duplicate: true };
  }
  if (active.workflow_run_id === thisRun) {
    invariant(
      active.workflow_run_attempt === thisRunAttempt,
      "Worker rerun attempt does not own the persisted dispatch",
    );
  }
  invariant(
    active.dispatch_state === "intended" ||
      active.dispatch_state === "dispatched",
    "Controller dispatch is not active",
  );
  const deployment = await findCanonicalDeployment(github, context, {
    pr,
    sha,
    key,
    target,
  });
  if (deployment) {
    const statuses = await deploymentStatusHistory(
      github,
      context,
      deployment.id,
    );
    const status = statuses[0] ?? null;
    if (status?.state === "success" && status.environment_url) {
      immutableVercelUrl(status.environment_url);
      core.setOutput("should_deploy", "false");
      core.setOutput("should_resume_smoke", "false");
      core.setOutput("execution_mode", "reuse-success");
      core.setOutput("reused_deployment_id", String(deployment.id));
      return { shouldDeploy: false, duplicate: false, reused: true };
    }
    const priorResult = resultForDeploymentStatus({
      evidence,
      deploymentId: Number(deployment.id),
      status,
      currentKeyDigest: keyDigest,
      currentRunId: thisRun,
    });
    const priorEvidence = evidenceForDeploymentStatus({
      evidence,
      deploymentId: Number(deployment.id),
      status,
      currentKeyDigest: keyDigest,
      currentRunId: thisRun,
    });
    const uploadStarted = statuses.some(
      (candidate) => candidate.description === UPLOAD_STARTED_DESCRIPTION,
    );
    const priorResultIsCurrentSelection =
      priorResult?.epoch_anchor_run_id === epochAnchorRunId &&
      priorResult?.selection_receipt_run_id === selectionReceiptRunId;
    const priorEvidenceIsCurrentSelection =
      priorEvidence?.epoch_anchor_run_id === epochAnchorRunId &&
      priorEvidence?.selection_receipt_run_id === selectionReceiptRunId;
    if (
      status?.state !== "success" &&
      ((priorResult?.vercel_deployment_url &&
        priorResult.vercel_deployment_id &&
        priorResult.next_deployment_id) ||
        (priorEvidence?.verified_upload_url &&
          priorEvidence.vercel_deployment_id &&
          priorEvidence.next_deployment_id))
    ) {
      return setSmokeResumeDecision(
        core,
        deployment,
        priorResult?.vercel_deployment_url ? priorResult : priorEvidence,
      );
    }
    if (
      priorResult?.terminal_reason === "build-failed-retriable" &&
      priorResultIsCurrentSelection &&
      status?.state === "failure" &&
      !uploadStarted
    ) {
      return setBuildDecision(core, "build-retry");
    }
    if (
      !uploadStarted &&
      (!priorEvidence ||
        (!priorEvidence.build_completed &&
          priorEvidence.vercel_deployment_id === null &&
          priorEvidence.verified_upload_url === null))
    ) {
      return setBuildDecision(
        core,
        priorEvidenceIsCurrentSelection ? "build-retry" : "build",
      );
    }
    throw new Error(
      "Canonical deployment exists without a safe terminal resume decision",
    );
  }
  core.setOutput("controller_key", key);
  return setBuildDecision(core, "build");
}

function deploymentPayload(value) {
  if (value && typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

async function findCanonicalDeployment(
  github,
  context,
  { pr, sha, key, target: rawTarget },
) {
  const target = previewTarget(rawTarget, "Deployment target");
  const environment = `preview/${target}/pr-${pr}`;
  const deployments = await github.paginate(github.rest.repos.listDeployments, {
    ...ownerRepo(context),
    sha,
    environment,
    per_page: 100,
  });
  const matches = deployments.filter((deployment) => {
    const payload = deploymentPayload(deployment.payload);
    return (
      deployment.ref === sha &&
      deployment.environment === environment &&
      payload?.controller_schema === PREBUILT_DEPLOYMENT_SCHEMA &&
      payload?.idempotency_key === key &&
      payload?.sha === sha &&
      payload?.logical_target === target &&
      payload?.provenance === PREVIEW_CONTROLLER_PROVENANCE
    );
  });
  invariant(
    matches.length <= 1,
    "Multiple canonical GitHub Deployments match one controller key",
  );
  return matches[0] ?? null;
}

async function createRecoveryDeployment(
  github,
  context,
  parsed,
  selection,
  run,
) {
  const target = previewTarget(parsed.target, "Recovery deployment target");
  const { data } = await github.rest.repos.createDeployment({
    ...ownerRepo(context),
    ref: parsed.sha,
    auto_merge: false,
    required_contexts: [],
    environment: `preview/${target}/pr-${parsed.pr}`,
    transient_environment: true,
    production_environment: false,
    description: `Vercel prebuilt ${target} preview recovery`,
    payload: {
      controller_schema: PREBUILT_DEPLOYMENT_SCHEMA,
      idempotency_key: selection.key,
      logical_target: target,
      sha: parsed.sha,
      git_ref: validatedWorkerHeadRef(selection.git_ref),
      workflow_run_url: optionalHttpsUrl(run.html_url, "Worker run URL"),
      pull_request_number: parsed.pr,
      provenance: PREVIEW_CONTROLLER_PROVENANCE,
    },
  });
  return data;
}

async function deploymentStatusHistory(github, context, deploymentId) {
  const { data } = await github.rest.repos.listDeploymentStatuses({
    ...ownerRepo(context),
    deployment_id: deploymentId,
    per_page: 100,
  });
  invariant(
    Array.isArray(data),
    "GitHub Deployment statuses response is malformed",
  );
  return data;
}

async function terminalizeDeployment(
  github,
  context,
  deploymentId,
  state,
  runUrl,
) {
  const request = {
    ...ownerRepo(context),
    deployment_id: deploymentId,
    state,
    log_url: runUrl,
    description:
      state === "failure"
        ? "Prebuilt preview build, deploy, or smoke failed"
        : "Prebuilt preview controller or infrastructure error",
  };
  const { data } = await github.rest.repos.createDeploymentStatus(request);
  return data;
}

function workerOutcomeSelection(inputs, rawWorkflowSha) {
  const expectedWorkflowSha = exactSha(
    inputs.expected_workflow_sha,
    "Expected worker workflow SHA",
  );
  const workflowSha = exactSha(rawWorkflowSha, "Actual worker workflow SHA");
  invariant(
    workflowSha === expectedWorkflowSha,
    "Actual worker workflow SHA does not match controller-authorized SHA",
  );
  const pr = pullRequestNumber(inputs.pull_request_number);
  const target = previewTarget(inputs.target, "Worker target");
  const sha = exactSha(inputs.commit_sha);
  const key = boundedText(inputs.controller_key, "Controller key", 255);
  invariant(
    key === controllerKey(pr, sha, target),
    "Worker controller key is invalid",
  );
  const epochAnchorRunId = exactRunId(inputs.epoch_anchor_run_id);
  const basisDigest = boundedText(
    inputs.reconciliation_basis_digest,
    "Worker reconciliation basis digest",
    64,
  );
  invariant(
    /^[0-9a-f]{64}$/.test(basisDigest),
    "Worker basis digest is invalid",
  );
  const selectionReceiptRunId = exactRunId(inputs.selection_receipt_run_id);
  const keyDigest = boundedText(
    inputs.controller_key_digest,
    "Controller key digest",
    24,
  );
  invariant(
    keyDigest ===
      controllerKeyDigest(key, {
        epochAnchorRunId,
        basisDigest,
        selectionReceiptRunId,
        expectedWorkflowSha,
      }),
    "Worker controller key digest is invalid",
  );
  return {
    pr,
    target,
    sha,
    key,
    keyDigest,
    epochAnchorRunId,
    basisDigest,
    selectionReceiptRunId,
    expectedWorkflowSha,
  };
}

export async function recordWorkerEvidence({
  github,
  context,
  core,
  inputs,
  workflowSha,
}) {
  const selection = workerOutcomeSelection(inputs, workflowSha);
  const evidence = await loadControllerEvidence(github, context, selection.pr);
  const targetState = evidence.state.targets[selection.target];
  const ownedSelection = [
    targetState.active,
    ...targetState.retired_active,
  ].find(
    (candidate) =>
      candidate?.key === selection.key &&
      candidate?.key_digest === selection.keyDigest,
  );
  const runId = exactRunId(context.runId);
  const runAttempt = exactRunAttempt(context.runAttempt ?? 1);
  invariant(
    ownedSelection?.epoch_anchor_run_id === selection.epochAnchorRunId &&
      ownedSelection?.reconciliation_basis_digest === selection.basisDigest &&
      ownedSelection?.selection_receipt_run_id ===
        selection.selectionReceiptRunId &&
      ownedSelection?.expected_workflow_sha === selection.expectedWorkflowSha &&
      (ownedSelection.workflow_run_id === null ||
        (ownedSelection.workflow_run_id === runId &&
          ownedSelection.workflow_run_attempt === runAttempt)),
    "Controller state does not own this worker outcome",
  );
  const existing = evidence.workerEvidence.find(
    (item) =>
      item.worker_run_id === runId && item.key_digest === selection.keyDigest,
  );
  if (existing) return existing;
  const deployment = await findCanonicalDeployment(github, context, {
    pr: selection.pr,
    sha: selection.sha,
    key: selection.key,
    target: selection.target,
  });
  if (!deployment) {
    core.setOutput("evidence_deferred_to_recovery", "true");
    return null;
  }
  const mode = boundedText(inputs.execution_mode, "Worker execution mode", 32);
  invariant(
    ["build", "build-retry", "resume-smoke", "reuse-success"].includes(mode),
    "Worker execution mode is invalid",
  );
  const verifiedUploadUrl = immutableVercelUrl(inputs.verified_upload_url);
  const vercelDeploymentId =
    inputs.vercel_deployment_id === undefined ||
    inputs.vercel_deployment_id === null ||
    inputs.vercel_deployment_id === ""
      ? null
      : boundedText(inputs.vercel_deployment_id, "Vercel deployment ID", 128);
  const nextDeploymentId = optionalNextDeploymentId(inputs.next_deployment_id);
  const buildCompleted = /^[1-9][0-9]*$/.test(
    String(inputs.build_duration_ms ?? ""),
  );
  if (mode === "resume-smoke") {
    invariant(
      verifiedUploadUrl && vercelDeploymentId && nextDeploymentId,
      "Smoke resume evidence is incomplete",
    );
  }
  const workerEvidence = validateWorkerEvidence({
    schema: WORKER_EVIDENCE_SCHEMA,
    repository: PREVIEW_REPOSITORY,
    pr: selection.pr,
    target: selection.target,
    sha: selection.sha,
    controller_key: selection.key,
    key_digest: selection.keyDigest,
    epoch_anchor_run_id: selection.epochAnchorRunId,
    reconciliation_basis_digest: selection.basisDigest,
    selection_receipt_run_id: selection.selectionReceiptRunId,
    expected_workflow_sha: selection.expectedWorkflowSha,
    worker_run_id: runId,
    worker_run_attempt: runAttempt,
    github_deployment_id: Number(deployment.id),
    execution_mode: mode,
    build_completed: buildCompleted,
    vercel_deployment_id: vercelDeploymentId,
    next_deployment_id: nextDeploymentId,
    verified_upload_url: verifiedUploadUrl,
  });
  await appendJournalReceipt({
    github,
    context,
    pr: selection.pr,
    kind: "workerEvidence",
    value: workerEvidence,
  });
  core.setOutput("worker_evidence_recorded", "true");
  return workerEvidence;
}

export async function recoverWorkerResult({
  github,
  context,
  core,
  workflowRun = context.payload.workflow_run,
  waitForRecovery,
}) {
  const { displayTitle, workflowRunId: runId } =
    validateWorkerRunSource(workflowRun);
  const parsed = parseWorkerRunName(displayTitle);
  const key = controllerKey(parsed.pr, parsed.sha, parsed.target);
  const evidence = await loadControllerEvidence(github, context, parsed.pr);
  const state = evidence.state;
  const targetState = state.targets[parsed.target];
  let currentSelection = targetState.active;
  let selection = [currentSelection, ...targetState.retired_active].find(
    (candidate) =>
      candidate?.key === key && candidate?.key_digest === parsed.keyDigest,
  );
  if (
    !selection ||
    (selection.workflow_run_id !== null && selection.workflow_run_id !== runId)
  ) {
    core.setOutput("pr_number", String(parsed.pr));
    core.setOutput("ignored_non_owner", "true");
    return null;
  }
  const currentEpochOwnsSameKey = [
    currentSelection,
    ...targetState.terminal_history,
    ...evidence.results,
  ]
    .filter(Boolean)
    .some(
      (candidate) =>
        (candidate.key ?? candidate.controller_key) === key &&
        candidate.epoch_anchor_run_id === state.epoch.anchor_run_id,
    );
  const newerSameKeyOwnsDeployment =
    selection.epoch_anchor_run_id !== state.epoch.anchor_run_id &&
    currentEpochOwnsSameKey;
  if (selection.workflow_run_id === null) {
    const uniqueRecoveredRun = await recoverMatchingWorkerRun(
      github,
      context,
      selection,
      {
        waitForRetry: waitForRecovery,
        ignoreWorkflowShaMismatch: true,
      },
    );
    if (uniqueRecoveredRun) {
      invariant(
        uniqueRecoveredRun.workflow_run_id === runId,
        "Completed intended worker is not the unique recoverable owner",
      );
    } else {
      try {
        validateWorkerRunIdentity(workflowRun, selection);
      } catch (error) {
        if (!(error instanceof WorkerWorkflowShaMismatchError)) throw error;
        const supersededResult =
          evidence.results.find(
            (result) =>
              result.key_digest === selection.key_digest &&
              result.terminal_reason ===
                "controller-workflow-upgraded-before-dispatch",
          ) ??
          (await recordSupersededIntent({
            github,
            context,
            pr: parsed.pr,
            selection,
          }));
        const shouldReconcileCurrentEpoch =
          workerResultAffectsCurrentReconciliation({
            evidence,
            state,
            selection,
            currentSelection,
          });
        if (!shouldReconcileCurrentEpoch) {
          await foldCompletedRetiredOwner({
            github,
            context,
            evidence,
            state,
            selection,
          });
        }
        core.setOutput("pr_number", String(parsed.pr));
        core.setOutput("result_state", supersededResult.state);
        core.setOutput(
          "should_reconcile_current_epoch",
          String(shouldReconcileCurrentEpoch),
        );
        return {
          ...supersededResult,
          should_reconcile_current_epoch: shouldReconcileCurrentEpoch,
        };
      }
      throw new Error(
        "Completed intended worker is not the unique recoverable owner",
      );
    }
  }
  const queriedRun = await getValidatedWorkerRun(
    github,
    context,
    runId,
    selection,
    { waitForRetry: waitForRecovery },
  );
  if (selection.workflow_run_id === null) {
    invariant(
      selection.dispatch_state === "intended" &&
        selection.workflow_sha === null &&
        selection.workflow_run_attempt === null,
      "Intended worker ownership is partially persisted",
    );
    const recoveredSelection = {
      ...selection,
      dispatch_state: "dispatched",
      ...queriedRun,
    };
    if (selection === currentSelection) {
      targetState.active = recoveredSelection;
      currentSelection = recoveredSelection;
    } else {
      const retiredIndex = targetState.retired_active.findIndex(
        (candidate) => candidate.key_digest === selection.key_digest,
      );
      invariant(
        retiredIndex >= 0,
        "Intended retired worker ownership disappeared",
      );
      targetState.retired_active = [...targetState.retired_active];
      targetState.retired_active[retiredIndex] = recoveredSelection;
    }
    await writeControllerState({
      github,
      context,
      pr: parsed.pr,
      state,
      stateComment: evidence.stateComment,
    });
    selection = recoveredSelection;
    core.setOutput("recovered_intended_run_id", String(runId));
  }
  invariant(
    queriedRun.workflow_sha === selection.workflow_sha &&
      queriedRun.workflow_run_attempt === selection.workflow_run_attempt,
    "Completed worker run no longer matches persisted ownership",
  );
  const runAttempt = queriedRun.workflow_run_attempt;
  let deployment = await findCanonicalDeployment(github, context, {
    pr: parsed.pr,
    sha: parsed.sha,
    key,
    target: parsed.target,
  });
  invariant(queriedRun.status === "completed", "Worker run is not completed");
  const conclusion = boundedText(
    queriedRun.conclusion,
    "Worker conclusion",
    32,
  );
  invariant(
    [
      "success",
      "failure",
      "cancelled",
      "timed_out",
      "startup_failure",
      "action_required",
      "stale",
    ].includes(conclusion),
    "Worker conclusion is unsupported",
  );
  const existingResult = evidence.results.find(
    (result) =>
      result.worker_run_id === runId && result.key_digest === parsed.keyDigest,
  );
  const workerEvidence = evidence.workerEvidence.find(
    (item) =>
      item.worker_run_id === runId && item.key_digest === parsed.keyDigest,
  );
  if (deployment && newerSameKeyOwnsDeployment) {
    const payloadRunId = workflowRunIdFromUrl(
      deploymentPayload(deployment.payload)?.workflow_run_url,
    );
    const ownsDeployment =
      payloadRunId === runId ||
      workerEvidence?.github_deployment_id === Number(deployment.id) ||
      existingResult?.github_deployment_id === Number(deployment.id);
    if (!ownsDeployment) deployment = null;
  }
  if (existingResult) {
    invariant(
      (existingResult.github_deployment_id === null &&
        newerSameKeyOwnsDeployment) ||
        (deployment &&
          existingResult.github_deployment_id === Number(deployment.id)),
      "Existing worker result no longer matches its canonical Deployment",
    );
    invariant(
      conclusion !== "success" || existingResult.state === "success",
      "Existing worker result conflicts with the completed run conclusion",
    );
    const shouldReconcileCurrentEpoch =
      workerResultAffectsCurrentReconciliation({
        evidence,
        state,
        selection,
        currentSelection,
      });
    if (!shouldReconcileCurrentEpoch) {
      await foldCompletedRetiredOwner({
        github,
        context,
        evidence,
        state,
        selection,
      });
    }
    core.setOutput("pr_number", String(parsed.pr));
    core.setOutput("result_state", existingResult.state);
    core.setOutput(
      "should_reconcile_current_epoch",
      String(shouldReconcileCurrentEpoch),
    );
    return {
      ...existingResult,
      should_reconcile_current_epoch: shouldReconcileCurrentEpoch,
    };
  }
  if (!deployment && !newerSameKeyOwnsDeployment) {
    deployment = await createRecoveryDeployment(
      github,
      context,
      parsed,
      selection,
      workflowRun,
    );
  }
  const statusHistory = deployment
    ? await deploymentStatusHistory(github, context, deployment.id)
    : [];
  const selectionStatusHistory = newerSameKeyOwnsDeployment
    ? statusHistory.filter(
        (candidate) => workflowRunIdFromUrl(candidate.log_url) === runId,
      )
    : statusHistory;
  let status = selectionStatusHistory[0] ?? null;
  const uploadStarted = selectionStatusHistory.some(
    (candidate) => candidate.description === UPLOAD_STARTED_DESCRIPTION,
  );
  if (workerEvidence) {
    invariant(
      deployment &&
        workerEvidence.github_deployment_id === Number(deployment.id),
      "Worker evidence does not match the canonical Deployment",
    );
  }
  let terminalState;
  let terminalReason;
  let resultUrl = null;
  const vercelDeploymentId = workerEvidence?.vercel_deployment_id ?? null;
  const nextDeploymentId = workerEvidence?.next_deployment_id ?? null;
  let smokeResult = "not-run";
  if (status?.state === "success" && status.environment_url) {
    terminalState = "success";
    terminalReason = "verified";
    resultUrl = immutableVercelUrl(status.environment_url);
    smokeResult = "passed";
  } else if (conclusion === "failure") {
    const uploaded =
      workerEvidence?.verified_upload_url &&
      workerEvidence.vercel_deployment_id &&
      workerEvidence.next_deployment_id;
    if (uploaded) {
      terminalState = "failure";
      terminalReason =
        workerEvidence.execution_mode === "build"
          ? "smoke-failed-retriable"
          : "smoke-failed-final";
      resultUrl = immutableVercelUrl(workerEvidence.verified_upload_url);
      smokeResult = "failed";
    } else if (
      workerEvidence &&
      !uploadStarted &&
      workerEvidence.vercel_deployment_id === null &&
      workerEvidence.verified_upload_url === null
    ) {
      terminalState = "failure";
      terminalReason =
        workerEvidence.execution_mode === "build"
          ? "build-failed-retriable"
          : "build-failed-final";
    } else if (workerEvidence) {
      terminalState = "error";
      terminalReason = workerEvidence.vercel_deployment_id
        ? "verification-ambiguous"
        : "upload-ambiguous";
    } else {
      terminalState = "failure";
      terminalReason =
        status?.state === "failure"
          ? "worker-failure"
          : "worker-failure-recovered";
      smokeResult = "failed";
    }
  } else {
    terminalState = "error";
    terminalReason =
      conclusion === "success"
        ? "missing-success-evidence"
        : `worker-${conclusion}`;
  }
  if (
    !newerSameKeyOwnsDeployment &&
    deployment &&
    (status?.state !== terminalState ||
      (terminalState === "success" && !status.environment_url))
  ) {
    status = await terminalizeDeployment(
      github,
      context,
      deployment.id,
      terminalState === "success" ? "error" : terminalState,
      optionalHttpsUrl(workflowRun.html_url, "Worker run URL"),
    );
    if (terminalState === "success") {
      terminalState = "error";
      terminalReason = "missing-success-evidence";
    }
  }
  if (terminalState === "success") {
    resultUrl = immutableVercelUrl(status.environment_url);
  }
  const result = validateWorkerResult({
    schema: RESULT_RECEIPT_SCHEMA,
    repository: PREVIEW_REPOSITORY,
    pr: parsed.pr,
    target: parsed.target,
    sha: parsed.sha,
    controller_key: key,
    key_digest: parsed.keyDigest,
    epoch_anchor_run_id: selection.epoch_anchor_run_id,
    reconciliation_basis_digest: selection.reconciliation_basis_digest,
    selection_receipt_run_id: selection.selection_receipt_run_id,
    expected_workflow_sha: selection.expected_workflow_sha,
    worker_run_id: runId,
    worker_run_attempt: runAttempt,
    github_deployment_id: deployment ? Number(deployment.id) : null,
    state: terminalState,
    vercel_deployment_id:
      vercelDeploymentId ??
      deploymentPayload(deployment?.payload)?.vercel_deployment_id ??
      null,
    next_deployment_id: nextDeploymentId,
    vercel_deployment_url: resultUrl,
    smoke_result: smokeResult,
    terminal_reason: terminalReason,
  });
  await appendJournalReceipt({
    github,
    context,
    pr: parsed.pr,
    kind: "result",
    value: result,
  });
  core.setOutput("pr_number", String(parsed.pr));
  core.setOutput("result_state", terminalState);
  const shouldReconcileCurrentEpoch = workerResultAffectsCurrentReconciliation({
    evidence,
    state,
    selection,
    currentSelection,
  });
  if (!shouldReconcileCurrentEpoch) {
    await foldCompletedRetiredOwner({
      github,
      context,
      evidence,
      state,
      selection,
    });
  }
  core.setOutput(
    "should_reconcile_current_epoch",
    String(shouldReconcileCurrentEpoch),
  );
  return {
    ...result,
    should_reconcile_current_epoch: shouldReconcileCurrentEpoch,
  };
}

export async function postWorkerRecoveryError({
  github,
  context,
  workflowRun = context.payload.workflow_run,
}) {
  let parsed;
  try {
    const { displayTitle } = validateWorkerRunSource(workflowRun);
    parsed = parseWorkerRunName(displayTitle);
  } catch {
    return false;
  }
  const evidence = await loadControllerEvidence(github, context, parsed.pr);
  const active = evidence.state.targets[parsed.target]?.active;
  if (
    active?.sha !== parsed.sha ||
    active?.key_digest !== parsed.keyDigest ||
    active.epoch_anchor_run_id !== evidence.state.epoch.anchor_run_id
  ) {
    return false;
  }
  try {
    validateWorkerRunIdentity(workflowRun, active);
  } catch {
    return false;
  }
  await github.rest.repos.createCommitStatus({
    ...ownerRepo(context),
    sha: parsed.sha,
    state: "error",
    context: PREVIEW_STATUS_CONTEXT,
    description: "Preview worker recovery is invalid or ambiguous",
    target_url: optionalHttpsUrl(workflowRun.html_url, "Worker run URL"),
  });
  return true;
}
