#!/usr/bin/env node

import { createHash } from "node:crypto";

export const PREVIEW_REPOSITORY = "mento-protocol/frontend-monorepo";
const PREVIEW_TARGET = "ui";
const PREVIEW_STATUS_CONTEXT = "Vercel Preview";
export const EVENT_RECEIPT_SCHEMA = "vercel-preview-event-receipt:v1";
const WORKER_EVIDENCE_SCHEMA = "vercel-preview-worker-evidence:v1";
export const RESULT_RECEIPT_SCHEMA = "vercel-preview-worker-result:v1";
export const CONTROLLER_SCHEMA = "vercel-preview-controller:v1";
const WORKER_WORKFLOW = "vercel-preview-worker.yml";
const WORKER_WORKFLOW_NAME = "Vercel Preview Worker";
export const BOOTSTRAP_DISPATCH_EVENT = "vercel-preview-bootstrap";
export const RECONCILE_DISPATCH_EVENT = "vercel-preview-reconcile";
const REPOSITORY_DISPATCH_OPERATIONS = new Map([
  [BOOTSTRAP_DISPATCH_EVENT, "bootstrap"],
  [RECONCILE_DISPATCH_EVENT, "reconcile"],
]);

const EVENT_MARKER_PREFIX = "<!-- vercel-preview-event-receipt:v1:run:";
const EVIDENCE_MARKER_PREFIX = "<!-- vercel-preview-worker-evidence:v1:";
const RESULT_MARKER_PREFIX = "<!-- vercel-preview-worker-result:v1:";
const CONTROLLER_MARKER = "<!-- vercel-preview-controller:v1 -->";
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const LOGIN_PATTERN =
  /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?|[A-Za-z0-9])(?:\[bot\])?$/;
const ALLOWED_EVENT_ACTIONS = new Set([
  "opened",
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
const TERMINAL_STATES = new Set(["success", "failure", "error"]);
const MAX_COMMENTS = 500;
const MAX_RECEIPTS = 200;
const MAX_HISTORY = 40;
const WORKER_RUN_PAGE_SIZE = 100;
const MAX_WORKER_RUN_PAGES = 3;
const UPLOAD_STARTED_DESCRIPTION = "Prebuilt preview upload starting";
const RETIRED_RECOVERY_QUARANTINE = "persisted-attempt-invalid-or-unavailable";

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

function markerBody(marker, value) {
  return `${marker}\n\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\`\n`;
}

function parseMarkerBody(body, marker) {
  invariant(
    typeof body === "string" && body.startsWith(`${marker}\n`),
    "Comment marker mismatch",
  );
  const match = body.match(/\n```json\n([\s\S]+)\n```\n?$/);
  invariant(match, "Controller comment JSON block is missing");
  invariant(match[1].length <= 60_000, "Controller comment JSON is too large");
  return JSON.parse(match[1]);
}

function isTrustedBotComment(comment) {
  return (
    comment?.user?.type === "Bot" &&
    comment?.user?.login === "github-actions[bot]"
  );
}

function classifyTrust({ headRepository, headRef, author }) {
  validatedHeadRef(headRef);
  validatedLogin(author);
  if (
    author === "dependabot[bot]" ||
    headRef === "dependabot" ||
    headRef.startsWith("dependabot/")
  ) {
    return "dependabot";
  }
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

export function snapshotPullRequestEvent(payload, runId) {
  plainObject(payload, "GitHub event payload");
  const action = boundedText(payload.action, "Event action", 32);
  invariant(
    ALLOWED_EVENT_ACTIONS.has(action) && action !== "bootstrap",
    "Unsupported PR action",
  );
  const pull = normalizePullRequest(payload.pull_request);
  const repository = validatedRepository(payload.repository?.full_name);
  const before =
    action === "synchronize" ? exactSha(payload.before, "Before SHA") : null;
  const changeBaseSha = action === "synchronize" ? before : pull.baseSha;
  return {
    schema: EVENT_RECEIPT_SCHEMA,
    repository,
    pr: pull.number,
    event_run_id: exactRunId(runId),
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

function snapshotBootstrapPullRequest(rawPull, runId) {
  const pull = normalizePullRequest(rawPull);
  invariant(pull.state === "open", "Bootstrap requires an open PR");
  return {
    schema: EVENT_RECEIPT_SCHEMA,
    repository: PREVIEW_REPOSITORY,
    pr: pull.number,
    event_run_id: exactRunId(runId),
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
      targets: [PREVIEW_TARGET],
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
  const allowed = ["app", "governance", "reserve", "ui"];
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
    targets: parsed.deployments.includes(PREVIEW_TARGET)
      ? [PREVIEW_TARGET]
      : [],
    reason,
    base: event.change_base_sha,
    head: event.head_sha,
    planner_source_sha: event.trusted_base_sha,
  };
}

function validatePlan(plan, event) {
  plainObject(plan, "Event plan");
  invariant(
    Array.isArray(plan.targets) && plan.targets.length <= 1,
    "Plan targets are invalid",
  );
  invariant(
    plan.targets.every((target) => target === PREVIEW_TARGET),
    "Plan may target only UI",
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
    ["trusted", "fork", "dependabot"].includes(event.trust),
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

export function eventReceiptMarker(runId) {
  return `${EVENT_MARKER_PREFIX}${exactRunId(runId)} -->`;
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

export function controllerKey(prNumber, sha) {
  return `vercel-preview:v1:pr:${pullRequestNumber(prNumber)}:target:${PREVIEW_TARGET}:sha:${exactSha(sha)}`;
}

function controllerKeyDigest(
  key,
  { epochAnchorRunId, basisDigest, selectionReceiptRunId },
) {
  boundedText(key, "Controller key", 255);
  exactRunId(epochAnchorRunId, "Epoch anchor run ID");
  invariant(
    /^[0-9a-f]{64}$/.test(basisDigest),
    "Reconciliation basis digest is invalid",
  );
  exactRunId(selectionReceiptRunId, "Selection receipt run ID");
  return digest(
    {
      key,
      epoch_anchor_run_id: epochAnchorRunId,
      reconciliation_basis_digest: basisDigest,
      selection_receipt_run_id: selectionReceiptRunId,
    },
    24,
  );
}

export function workerRunName({ pr, sha, keyDigest }) {
  return `Vercel preview worker | pr=${pullRequestNumber(pr)} | target=${PREVIEW_TARGET} | sha=${exactSha(sha)} | key=${boundedText(keyDigest, "Key digest", 24)}`;
}

export function parseWorkerRunName(value) {
  const match = String(value ?? "").match(
    /^Vercel preview worker \| pr=([1-9][0-9]{0,9}) \| target=ui \| sha=([0-9a-f]{40}) \| key=([0-9a-f]{24})$/,
  );
  invariant(match, "Worker run name is not strictly parseable");
  return {
    pr: pullRequestNumber(match[1]),
    target: PREVIEW_TARGET,
    sha: exactSha(match[2]),
    keyDigest: match[3],
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
  invariant(result.target === PREVIEW_TARGET, "Worker result target mismatch");
  exactSha(result.sha);
  const expectedKey = controllerKey(result.pr, result.sha);
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
  invariant(
    result.key_digest ===
      controllerKeyDigest(expectedKey, {
        epochAnchorRunId: result.epoch_anchor_run_id,
        basisDigest: result.reconciliation_basis_digest,
        selectionReceiptRunId: result.selection_receipt_run_id,
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

export function resultReceiptMarker(result) {
  const validated = validateWorkerResult(result);
  return `${RESULT_MARKER_PREFIX}${validated.key_digest}:run:${validated.worker_run_id} -->`;
}

function validateWorkerEvidence(value) {
  const evidence = plainObject(value, "Worker evidence");
  invariant(
    evidence.schema === WORKER_EVIDENCE_SCHEMA,
    "Worker evidence schema mismatch",
  );
  validatedRepository(evidence.repository);
  pullRequestNumber(evidence.pr);
  invariant(
    evidence.target === PREVIEW_TARGET,
    "Worker evidence target mismatch",
  );
  exactSha(evidence.sha);
  const expectedKey = controllerKey(evidence.pr, evidence.sha);
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
  invariant(
    evidence.key_digest ===
      controllerKeyDigest(expectedKey, {
        epochAnchorRunId: evidence.epoch_anchor_run_id,
        basisDigest: evidence.reconciliation_basis_digest,
        selectionReceiptRunId: evidence.selection_receipt_run_id,
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

function workerEvidenceMarker(value) {
  const evidence = validateWorkerEvidence(value);
  return `${EVIDENCE_MARKER_PREFIX}${evidence.key_digest}:run:${evidence.worker_run_id} -->`;
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

function persistedEventRunIds(state, results) {
  const runIds = new Set();
  const add = (value) => {
    if (value !== null && value !== undefined) runIds.add(exactRunId(value));
  };
  if (state) {
    add(state.epoch.anchor_run_id);
    add(state.ui?.idle_cursor_receipt_run_id);
    add(state.ui?.latest_desired_receipt_run_id);
    for (const selection of [
      state.ui?.active,
      ...(state.ui?.retired_active ?? []),
      ...(state.ui?.terminal_history ?? []),
    ].filter(Boolean)) {
      add(selection.epoch_anchor_run_id);
      add(selection.selection_receipt_run_id);
    }
  }
  for (const result of results) {
    add(result.epoch_anchor_run_id);
    add(result.selection_receipt_run_id);
  }
  return runIds;
}

function dedupeResults(results) {
  invariant(results.length <= MAX_RECEIPTS, "Too many worker result receipts");
  const byRun = new Map();
  for (const raw of results) {
    const result = validateWorkerResult(raw);
    const key = `${result.controller_key}:${result.worker_run_id}`;
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

function controllerReceiptsDigest(events, results, pr) {
  return digest({
    events: dedupeEvents(events)
      .filter((event) => event.pr === pr)
      .map(semanticEventKey)
      .sort(),
    results: dedupeResults(results)
      .filter((result) => result.pr === pr)
      .map(canonicalJson)
      .sort(),
  });
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

function selectCurrentEpoch(events, pull) {
  const anchors = events
    .filter((event) =>
      ["opened", "reopened", "bootstrap"].includes(event.event_action),
    )
    .filter(
      (event) => event.pr === pull.number && samePullIdentity(event, pull),
    )
    .filter((event) => event.pr_updated_at <= pull.updatedAt)
    .sort((a, b) => b.pr_updated_at.localeCompare(a.pr_updated_at));
  invariant(
    anchors.length > 0,
    "No opened, reopened, or bootstrap anchor receipt exists",
  );

  const candidates = [];
  for (const anchor of anchors) {
    const closures = events.filter(
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
      candidates.push({ anchor, closure, lineage: paths[0] });
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

function resultForSelection(results, anchorRunId, event, selection) {
  return (
    results
      .filter(
        (result) =>
          result.epoch_anchor_run_id === anchorRunId &&
          result.selection_receipt_run_id === event.event_run_id &&
          result.controller_key === controllerKey(result.pr, event.head_sha) &&
          (!selection ||
            result.reconciliation_basis_digest ===
              selection.reconciliation_basis_digest),
      )
      .sort(
        (a, b) =>
          b.worker_run_id - a.worker_run_id ||
          b.worker_run_attempt - a.worker_run_attempt,
      )[0] ?? null
  );
}

function normalizedObservation(observations, key) {
  const value = observations?.[key];
  if (value === undefined) return { worker_runs: null, deployments: null };
  plainObject(value, "Controller observation");
  for (const field of ["worker_runs", "deployments"]) {
    invariant(
      Number.isInteger(value[field]) && value[field] >= 0,
      `Observation ${field} is invalid`,
    );
  }
  return value;
}

function statusDecision({
  event,
  index,
  lineage,
  resultByRun,
  active,
  durableSelectedRuns,
  observations,
  controllerUrl,
}) {
  if (event.trust !== "trusted") {
    return {
      sha: event.head_sha,
      state: "success",
      description: "Preview unsupported for fork or Dependabot PR",
      target_url: controllerUrl,
    };
  }
  const eligible = event.plan.targets.includes(PREVIEW_TARGET);
  const result = resultByRun.get(event.event_run_id);
  if (eligible && result?.state === "success") {
    return {
      sha: event.head_sha,
      state: "success",
      description: "UI preview verified for this exact SHA",
      target_url: result.vercel_deployment_url,
    };
  }
  if (eligible && result?.state === "failure") {
    return {
      sha: event.head_sha,
      state: "failure",
      description: "UI preview build, deploy, or smoke failed",
      target_url: controllerUrl,
    };
  }
  if (eligible && result?.state === "error") {
    const cancelled = result.terminal_reason === "worker-cancelled";
    return {
      sha: event.head_sha,
      state: cancelled ? "failure" : "error",
      description: cancelled
        ? "UI preview worker was cancelled"
        : "UI preview controller or infrastructure error",
      target_url: controllerUrl,
    };
  }
  if (!eligible) {
    const priorRuntime = lineage
      .slice(0, index)
      .findLast((candidate) => candidate.plan.targets.includes(PREVIEW_TARGET));
    if (!priorRuntime) {
      return {
        sha: event.head_sha,
        state: "success",
        description: "No UI runtime impact",
        target_url: controllerUrl,
      };
    }
    const priorResult = resultByRun.get(priorRuntime.event_run_id);
    if (priorResult?.state === "success") {
      return {
        sha: event.head_sha,
        state: "success",
        description: `Runtime-equivalent to ${priorRuntime.head_sha.slice(0, 7)}`,
        target_url: priorResult.vercel_deployment_url,
      };
    }
    if (priorResult?.state === "failure") {
      return {
        sha: event.head_sha,
        state: "failure",
        description: `Runtime preview ${priorRuntime.head_sha.slice(0, 7)} failed`,
        target_url: controllerUrl,
      };
    }
    if (priorResult?.state === "error") {
      const cancelled = priorResult.terminal_reason === "worker-cancelled";
      return {
        sha: event.head_sha,
        state: cancelled ? "failure" : "error",
        description: cancelled
          ? `Runtime preview ${priorRuntime.head_sha.slice(0, 7)} was cancelled`
          : `Runtime preview ${priorRuntime.head_sha.slice(0, 7)} errored`,
        target_url: controllerUrl,
      };
    }
    return {
      sha: event.head_sha,
      state: "pending",
      description: `Waiting for runtime preview ${priorRuntime.head_sha.slice(0, 7)}`,
      target_url: active?.html_url ?? controllerUrl,
    };
  }
  const laterSelection = lineage
    .slice(index + 1)
    .find((candidate) => durableSelectedRuns.has(candidate.event_run_id));
  if (laterSelection) {
    const observation = normalizedObservation(
      observations,
      controllerKey(event.pr, event.head_sha),
    );
    if (observation.worker_runs === 0 && observation.deployments === 0) {
      return {
        sha: event.head_sha,
        state: "success",
        description: `Coalesced to ${laterSelection.head_sha.slice(0, 7)}`,
        target_url: controllerUrl,
      };
    }
  }
  return {
    sha: event.head_sha,
    state: "pending",
    description: "UI preview queued or running",
    target_url: active?.html_url ?? controllerUrl,
  };
}

function validatePersistedDispatch(value, pr, label) {
  const dispatch = plainObject(value, label);
  exactSha(dispatch.sha);
  invariant(
    dispatch.key === controllerKey(pr, dispatch.sha),
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
      }),
    `${label} digest mismatch`,
  );
  return dispatch;
}

function validateActiveDispatch(value, pr, label) {
  const active = validatePersistedDispatch(value, pr, label);
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
    /^[0-9a-f]{64}$/.test(state.receipts_digest),
    "Controller receipt digest is invalid",
  );
  exactRunId(state.epoch?.anchor_run_id, "State epoch anchor run ID");
  invariant(
    /^[0-9a-f]{64}$/.test(state.epoch?.basis_digest),
    "State epoch basis digest is invalid",
  );
  if (state.ui?.idle_cursor_receipt_run_id !== null) {
    exactRunId(
      state.ui.idle_cursor_receipt_run_id,
      "State idle cursor receipt run ID",
    );
  }
  if (state.ui?.active !== null && state.ui?.active !== undefined) {
    const active = validateActiveDispatch(
      state.ui.active,
      pr,
      "Active dispatch",
    );
    invariant(
      active.recovery_quarantine === undefined,
      "Current active dispatch cannot be recovery-quarantined",
    );
  }
  invariant(
    Array.isArray(state.ui?.retired_active ?? []),
    "Retired active selections must be an array",
  );
  invariant(
    (state.ui?.retired_active ?? []).length <= MAX_HISTORY,
    "Too many retired active selections",
  );
  for (const selection of state.ui?.retired_active ?? []) {
    validateActiveDispatch(selection, pr, "Retired active dispatch");
  }
  invariant(
    Array.isArray(state.ui?.terminal_history ?? []) &&
      (state.ui?.terminal_history ?? []).length <= MAX_HISTORY,
    "Terminal history is invalid",
  );
  for (const terminal of state.ui?.terminal_history ?? []) {
    validatePersistedDispatch(terminal, pr, "Terminal selection");
    invariant(
      TERMINAL_STATES.has(terminal.state),
      "Terminal selection state is invalid",
    );
  }
  return state;
}

export function reconcileState({
  events: rawEvents,
  results: rawResults = [],
  observations = {},
  pullRequest: rawPull,
  existingState = null,
  controllerUrl,
}) {
  const pull = normalizePullRequest(rawPull);
  const allResults = dedupeResults(rawResults).filter(
    (result) => result.pr === pull.number,
  );
  const previous = normalizeExistingState(existingState, pull.number);
  const events = dedupeEvents(
    rawEvents,
    persistedEventRunIds(previous, allResults),
  ).filter((event) => event.pr === pull.number);
  const { anchor, closure, lineage } = selectCurrentEpoch(events, pull);
  const epochResults = allResults.filter(
    (result) => result.epoch_anchor_run_id === anchor.event_run_id,
  );
  if (epochResults.length > 0) {
    invariant(
      previous?.epoch?.anchor_run_id === anchor.event_run_id,
      "Current-epoch result exists without persisted epoch ownership",
    );
    const ownedSelections = [
      previous.ui?.active,
      ...(previous.ui?.terminal_history ?? []),
    ].filter(Boolean);
    for (const result of epochResults) {
      invariant(
        ownedSelections.some(
          (selection) =>
            selection.selection_receipt_run_id ===
              result.selection_receipt_run_id &&
            selection.reconciliation_basis_digest ===
              result.reconciliation_basis_digest &&
            selection.key_digest === result.key_digest,
        ),
        "Worker result is not bound to a persisted epoch selection",
      );
    }
  }
  const basisDigest = digest({
    anchor: semanticEventKey(anchor),
    closure: closure ? semanticEventKey(closure) : null,
    lineage: lineage.map(semanticEventKey),
    results: epochResults.map(canonicalJson).sort(),
  });
  const sameEpoch = previous?.epoch?.anchor_run_id === anchor.event_run_id;
  const candidates = lineage.filter((event) =>
    event.plan.targets.includes(PREVIEW_TARGET),
  );
  const candidateByRun = new Map(
    candidates.map((event) => [event.event_run_id, event]),
  );
  const resultByRun = new Map();
  for (const event of candidates) {
    const result = resultForSelection(
      epochResults,
      anchor.event_run_id,
      event,
      sameEpoch &&
        previous?.ui?.active?.selection_receipt_run_id === event.event_run_id
        ? previous.ui.active
        : null,
    );
    if (result) resultByRun.set(event.event_run_id, result);
  }

  let active = null;
  let idleCursor = sameEpoch
    ? (previous.ui?.idle_cursor_receipt_run_id ?? null)
    : null;
  let latestDesired = null;
  let completedActive = null;
  let completedResult = null;
  if (sameEpoch && previous.ui?.active) {
    const previousActive = previous.ui.active;
    const selectedEvent = candidateByRun.get(
      previousActive.selection_receipt_run_id,
    );
    invariant(
      selectedEvent,
      "Active selection receipt is outside current lineage",
    );
    const terminal = resultForSelection(
      epochResults,
      anchor.event_run_id,
      selectedEvent,
      previousActive,
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
      const previousDesiredRun = previous.ui?.latest_desired_receipt_run_id;
      const desired = candidateByRun.get(previousDesiredRun);
      if (
        desired &&
        desired.event_run_id !== completedActive.selection_receipt_run_id &&
        !resultByRun.has(desired.event_run_id)
      ) {
        selected = desired;
      }
      const retriable = new Set([
        "build-failed-retriable",
        "smoke-failed-retriable",
      ]);
      const attemptsForReceipt = epochResults.filter(
        (result) =>
          result.selection_receipt_run_id ===
          completedActive.selection_receipt_run_id,
      ).length;
      if (
        !selected &&
        retriable.has(completedResult?.terminal_reason) &&
        attemptsForReceipt < 2
      ) {
        selected = candidateByRun.get(completedActive.selection_receipt_run_id);
      }
    }
    if (!selected) {
      const cursorIndex = idleCursor
        ? candidates.findIndex((event) => event.event_run_id === idleCursor)
        : -1;
      invariant(
        idleCursor === null || cursorIndex >= 0,
        "Idle cursor is outside current event lineage",
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

  const nextDispatch = selected
    ? (() => {
        const key = controllerKey(pull.number, selected.head_sha);
        return {
          pr: pull.number,
          target: PREVIEW_TARGET,
          sha: selected.head_sha,
          git_ref: selected.head_ref,
          key,
          epoch_anchor_run_id: anchor.event_run_id,
          reconciliation_basis_digest: basisDigest,
          selection_receipt_run_id: selected.event_run_id,
          key_digest: controllerKeyDigest(key, {
            epochAnchorRunId: anchor.event_run_id,
            basisDigest,
            selectionReceiptRunId: selected.event_run_id,
          }),
        };
      })()
    : null;

  const durableSelectedRuns = new Set(
    epochResults.map((result) => result.selection_receipt_run_id),
  );
  if (active) durableSelectedRuns.add(active.selection_receipt_run_id);
  const controllerTargetUrl = optionalHttpsUrl(controllerUrl, "Controller URL");
  const statuses = lineage.map((event, index) =>
    statusDecision({
      event,
      index,
      lineage,
      resultByRun,
      active,
      durableSelectedRuns,
      observations,
      controllerUrl: controllerTargetUrl,
    }),
  );
  const successes = [...resultByRun.entries()]
    .filter(([, result]) => result.state === "success")
    .sort(([runA], [runB]) => {
      const indexA = lineage.findIndex((event) => event.event_run_id === runA);
      const indexB = lineage.findIndex((event) => event.event_run_id === runB);
      return indexB - indexA;
    });
  const lastSuccess = successes[0]?.[1] ?? null;
  const terminalHistory = epochResults
    .sort((a, b) => a.worker_run_id - b.worker_run_id)
    .slice(-MAX_HISTORY)
    .map((result) => ({
      sha: result.sha,
      key: result.controller_key,
      key_digest: result.key_digest,
      epoch_anchor_run_id: result.epoch_anchor_run_id,
      reconciliation_basis_digest: result.reconciliation_basis_digest,
      selection_receipt_run_id: result.selection_receipt_run_id,
      state: result.state,
      worker_run_id: result.worker_run_id,
      github_deployment_id: result.github_deployment_id,
      vercel_deployment_url: result.vercel_deployment_url,
      terminal_reason: result.terminal_reason,
    }));
  const retiredActive = [
    ...(previous?.ui?.retired_active ?? []),
    ...(!sameEpoch && previous?.ui?.active ? [previous.ui.active] : []),
  ]
    .filter(
      (selection, index, values) =>
        values.findIndex(
          (candidate) => candidate.key_digest === selection.key_digest,
        ) === index,
    )
    .slice(-MAX_HISTORY);
  const latestDesiredEvent =
    latestDesired ??
    (sameEpoch
      ? candidateByRun.get(previous.ui?.latest_desired_receipt_run_id)
      : null) ??
    candidates.at(-1) ??
    null;
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
      lineage_digest: digest(lineage.map(semanticEventKey)),
      basis_digest: basisDigest,
    },
    closed: pull.state === "closed",
    receipts_digest: controllerReceiptsDigest(events, allResults, pull.number),
    ui: {
      first_eligible_sha: candidates[0]?.head_sha ?? null,
      latest_desired_sha: latestDesiredEvent?.head_sha ?? null,
      latest_desired_receipt_run_id: latestDesiredEvent?.event_run_id ?? null,
      idle_cursor_receipt_run_id: idleCursor,
      active,
      retired_active: retiredActive,
      last_successful_runtime_sha: lastSuccess?.sha ?? null,
      last_successful_runtime_url: lastSuccess?.vercel_deployment_url ?? null,
      terminal_history: terminalHistory,
    },
    status_decisions: statuses,
  };
  return { state, nextDispatch, lineage, basisDigest };
}

function ownerRepo(context) {
  invariant(
    context?.repo?.owner === "mento-protocol" &&
      context?.repo?.repo === "frontend-monorepo",
    "Unexpected workflow repository",
  );
  return context.repo;
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

function matchingBotComments(comments, marker) {
  return comments.filter(
    (comment) =>
      isTrustedBotComment(comment) &&
      typeof comment.body === "string" &&
      comment.body.startsWith(marker),
  );
}

async function writeImmutableComment({ github, context, pr, marker, value }) {
  const body = markerBody(marker, value);
  const existing = matchingBotComments(
    await listComments(github, context, pr),
    marker,
  );
  invariant(existing.length <= 1, `Duplicate immutable marker ${marker}`);
  if (existing.length === 1) {
    invariant(
      existing[0].body === body,
      `Immutable receipt ${marker} conflicts with existing evidence`,
    );
    return { comment: existing[0], reused: true };
  }
  const { data } = await github.rest.issues.createComment({
    ...ownerRepo(context),
    issue_number: pr,
    body,
  });
  return { comment: data, reused: false };
}

function parseControllerComments(comments) {
  const events = [];
  const workerEvidence = [];
  const results = [];
  for (const comment of comments) {
    if (!isTrustedBotComment(comment) || typeof comment.body !== "string")
      continue;
    if (comment.body.startsWith(EVENT_MARKER_PREFIX)) {
      const marker = comment.body.split("\n", 1)[0];
      events.push(validateEventReceipt(parseMarkerBody(comment.body, marker)));
    } else if (comment.body.startsWith(EVIDENCE_MARKER_PREFIX)) {
      const marker = comment.body.split("\n", 1)[0];
      workerEvidence.push(
        validateWorkerEvidence(parseMarkerBody(comment.body, marker)),
      );
    } else if (comment.body.startsWith(RESULT_MARKER_PREFIX)) {
      const marker = comment.body.split("\n", 1)[0];
      results.push(validateWorkerResult(parseMarkerBody(comment.body, marker)));
    }
  }
  const states = matchingBotComments(comments, CONTROLLER_MARKER);
  invariant(
    states.length <= 1,
    "Multiple bot-owned controller state comments exist",
  );
  const state =
    states.length === 1
      ? parseMarkerBody(states[0].body, CONTROLLER_MARKER)
      : null;
  return {
    events,
    workerEvidence,
    results,
    state,
    stateComment: states[0] ?? null,
  };
}

async function writeControllerState({
  github,
  context,
  pr,
  state,
  stateComment,
}) {
  const body = markerBody(CONTROLLER_MARKER, state);
  let data;
  if (stateComment) {
    ({ data } = await github.rest.issues.updateComment({
      ...ownerRepo(context),
      comment_id: stateComment.id,
      body,
    }));
  } else {
    ({ data } = await github.rest.issues.createComment({
      ...ownerRepo(context),
      issue_number: pr,
      body,
    }));
  }
  const reread = parseControllerComments(
    await listComments(github, context, pr),
  );
  invariant(
    reread.stateComment?.id === data.id && reread.stateComment.body === body,
    "Controller state lost a concurrent update",
  );
  return reread.stateComment;
}

async function pullFromApi(github, context, pr) {
  const { data } = await github.rest.pulls.get({
    ...ownerRepo(context),
    pull_number: pullRequestNumber(pr),
  });
  return data;
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
  const snapshot = snapshotBootstrapPullRequest(pull, context.runId);
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

export function writeEventSnapshotOutputs({ payload, runId, core }) {
  const snapshot = snapshotPullRequestEvent(payload, runId);
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
      : snapshotPullRequestEvent(context.payload, context.runId);
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
  await writeImmutableComment({
    github,
    context,
    pr: receipt.pr,
    marker: eventReceiptMarker(receipt.event_run_id),
    value: receipt,
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
          : "Preview unsupported for fork or Dependabot PR",
      target_url: `https://github.com/${PREVIEW_REPOSITORY}/actions/runs/${context.runId}`,
    });
  }
  core.setOutput("pr_number", String(receipt.pr));
  return receipt;
}

async function postStatusDecisions(
  github,
  context,
  decisions,
  { assertBasis } = {},
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
    await github.rest.repos.createCommitStatus(request);
    if (assertBasis) await assertBasis();
  }
}

async function listWorkerRuns(github, context) {
  const runs = [];
  for (let page = 1; page <= MAX_WORKER_RUN_PAGES; page += 1) {
    const { data } = await github.rest.actions.listWorkflowRuns({
      ...ownerRepo(context),
      workflow_id: WORKER_WORKFLOW,
      event: "workflow_dispatch",
      branch: "main",
      page,
      per_page: WORKER_RUN_PAGE_SIZE,
    });
    invariant(
      Array.isArray(data.workflow_runs) &&
        data.workflow_runs.length <= WORKER_RUN_PAGE_SIZE,
      "Worker run lookup was malformed",
    );
    runs.push(...data.workflow_runs);
    const totalCount = data.total_count;
    if (
      data.workflow_runs.length < WORKER_RUN_PAGE_SIZE ||
      (Number.isSafeInteger(totalCount) && totalCount === runs.length)
    ) {
      return runs;
    }
  }
  throw new Error(
    `Worker run lookup exceeded the bounded ${MAX_WORKER_RUN_PAGES * WORKER_RUN_PAGE_SIZE}-run history`,
  );
}

function matchingWorkerRuns(runs, selected) {
  return runs.filter((run) => {
    try {
      validateWorkerRunIdentity(run, selected);
      return true;
    } catch {
      return false;
    }
  });
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function recoverMatchingWorkerRun(
  github,
  context,
  selected,
  { waitForRetry = wait } = {},
) {
  const pause = waitForRetry ?? wait;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const matches = matchingWorkerRuns(
      await listWorkerRuns(github, context),
      selected,
    );
    invariant(
      matches.length <= 1,
      "Multiple worker runs match one intended controller key",
    );
    if (matches.length === 1) {
      return validateWorkerRunIdentity(matches[0], selected);
    }
    if (attempt < 2) await pause(500);
  }
  return null;
}

export function validateWorkerRunIdentity(run, selected) {
  plainObject(run, "Worker run");
  invariant(run.name === WORKER_WORKFLOW_NAME, "Worker workflow name mismatch");
  invariant(
    run.path === `.github/workflows/${WORKER_WORKFLOW}`,
    "Worker workflow path mismatch",
  );
  invariant(run.event === "workflow_dispatch", "Worker event mismatch");
  invariant(run.head_branch === "main", "Worker default ref mismatch");
  exactSha(run.head_sha, "Worker workflow SHA");
  exactRunAttempt(run.run_attempt ?? 1);
  const parsed = parseWorkerRunName(run.display_title);
  invariant(
    parsed.pr === selected.pr &&
      parsed.sha === selected.sha &&
      parsed.keyDigest === selected.key_digest,
    "Worker run identity does not match selection",
  );
  return {
    workflow_run_id: exactRunId(run.id, "Worker run ID"),
    workflow_sha: run.head_sha,
    workflow_run_attempt: exactRunAttempt(run.run_attempt ?? 1),
    run_url: optionalHttpsUrl(run.url, "Worker API run URL"),
    html_url: optionalHttpsUrl(run.html_url, "Worker HTML run URL"),
    status: boundedText(run.status, "Worker run status", 32),
    conclusion:
      run.conclusion === null
        ? null
        : boundedText(run.conclusion, "Worker run conclusion", 32),
  };
}

async function getValidatedWorkerRun(github, context, runId, selected) {
  const data = await getWorkerRun(github, context, runId, selected);
  return validateWorkerRunIdentity(data, selected);
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

async function dispatchWorker(github, context, selected) {
  const response = await github.request(
    "POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches",
    {
      ...ownerRepo(context),
      workflow_id: WORKER_WORKFLOW,
      ref: "main",
      inputs: {
        pull_request_number: String(selected.pr),
        target: PREVIEW_TARGET,
        commit_sha: selected.sha,
        git_branch: selected.git_ref,
        controller_key: selected.key,
        controller_key_digest: selected.key_digest,
        epoch_anchor_run_id: String(selected.epoch_anchor_run_id),
        reconciliation_basis_digest: selected.reconciliation_basis_digest,
        selection_receipt_run_id: String(selected.selection_receipt_run_id),
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
  return getValidatedWorkerRun(github, context, workflowRunId, selected);
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

async function recordRemovedSelection({ github, context, pr, selection }) {
  const result = validateWorkerResult({
    schema: RESULT_RECEIPT_SCHEMA,
    repository: PREVIEW_REPOSITORY,
    pr,
    target: PREVIEW_TARGET,
    sha: selection.sha,
    controller_key: selection.key,
    key_digest: selection.key_digest,
    epoch_anchor_run_id: selection.epoch_anchor_run_id,
    reconciliation_basis_digest: selection.reconciliation_basis_digest,
    selection_receipt_run_id: selection.selection_receipt_run_id,
    worker_run_id: exactRunId(context.runId, "Controller abort run ID"),
    worker_run_attempt: exactRunAttempt(context.runAttempt ?? 1),
    github_deployment_id: null,
    state: "failure",
    vercel_deployment_id: null,
    next_deployment_id: null,
    vercel_deployment_url: null,
    smoke_result: "not-run",
    terminal_reason: "selection-removed-from-pr",
  });
  await writeImmutableComment({
    github,
    context,
    pr,
    marker: resultReceiptMarker(result),
    value: result,
  });
  return result;
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

async function recoverCompletedOwnedRuns({
  github,
  context,
  core,
  pr,
  parsed,
}) {
  if (!parsed.state) return false;
  const state = structuredClone(normalizeExistingState(parsed.state, pr));
  const currentActive = state.ui?.active;
  const selections = [
    currentActive,
    ...(state.ui?.retired_active ?? []),
  ].filter(Boolean);
  let recovered = false;
  let quarantined = false;
  const quarantineRetiredSelection = (selection) => {
    const retiredIndex = state.ui.retired_active.findIndex(
      (candidate) => candidate.key_digest === selection.key_digest,
    );
    invariant(retiredIndex >= 0, "Retired worker ownership disappeared");
    state.ui.retired_active = [...state.ui.retired_active];
    state.ui.retired_active[retiredIndex] = {
      ...selection,
      recovery_quarantine: RETIRED_RECOVERY_QUARANTINE,
    };
    core.setOutput("retired_recovery_quarantined", "true");
    quarantined = true;
  };
  for (const selection of selections) {
    if (selection.workflow_run_id === null) continue;
    const isCurrentActive = selection === currentActive;
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
        quarantineRetiredSelection(selection);
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
      quarantineRetiredSelection(selection);
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

export async function reconcilePreview({
  github,
  context,
  core,
  prNumber: rawPr,
  waitForRecovery,
}) {
  const pr = pullRequestNumber(rawPr);
  const controllerUrl = `https://github.com/${PREVIEW_REPOSITORY}/actions/runs/${context.runId}`;
  reconcileAttempts: for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const pull = await pullFromApi(github, context, pr);
      const parsed = parseControllerComments(
        await listComments(github, context, pr),
      );
      if (
        await recoverCompletedOwnedRuns({
          github,
          context,
          core,
          pr,
          parsed,
        })
      ) {
        continue reconcileAttempts;
      }
      const preliminary = reconcileState({
        events: parsed.events,
        results: parsed.results,
        pullRequest: pull,
        existingState: parsed.state,
        controllerUrl,
      });
      const observations = await collectCoalescingObservations(
        github,
        context,
        pr,
        preliminary.lineage,
      );
      const reconciled = reconcileState({
        events: parsed.events,
        results: parsed.results,
        observations,
        pullRequest: pull,
        existingState: parsed.state,
        controllerUrl,
      });
      let state = reconciled.state;
      let stateComment = parsed.stateComment;
      const selected =
        reconciled.nextDispatch ??
        (state.ui.active?.dispatch_state === "intended" &&
        state.ui.active.workflow_run_id === null
          ? state.ui.active
          : null);
      if (selected) {
        if (reconciled.nextDispatch) {
          state.ui.active = {
            ...selected,
            dispatch_state: "intended",
            workflow_run_id: null,
            workflow_sha: null,
            workflow_run_attempt: null,
            run_url: null,
            html_url: null,
          };
        }
        stateComment = await writeControllerState({
          github,
          context,
          pr,
          state,
          stateComment,
        });

        const freshPull = await pullFromApi(github, context, pr);
        assertDispatchTrust(freshPull, selected);
        if (
          !(await shaIsStillAssociated(
            github,
            context,
            freshPull,
            selected.sha,
          ))
        ) {
          await recordRemovedSelection({
            github,
            context,
            pr,
            selection: selected,
          });
          continue;
        }
        const freshComments = parseControllerComments(
          await listComments(github, context, pr),
        );
        const ownershipCheck = reconcileState({
          events: freshComments.events,
          results: freshComments.results,
          observations,
          pullRequest: freshPull,
          existingState: freshComments.state,
          controllerUrl,
        });
        invariant(
          ownershipCheck.state.epoch.anchor_run_id ===
            selected.epoch_anchor_run_id &&
            ownershipCheck.state.ui.active?.key_digest ===
              selected.key_digest &&
            ownershipCheck.state.ui.active?.reconciliation_basis_digest ===
              selected.reconciliation_basis_digest,
          "Persisted dispatch ownership changed before credentials",
        );

        const recoveredRun = await recoverMatchingWorkerRun(
          github,
          context,
          selected,
          { waitForRetry: waitForRecovery },
        );
        const runDetails =
          recoveredRun ?? (await dispatchWorker(github, context, selected));
        state = {
          ...ownershipCheck.state,
          ui: {
            ...ownershipCheck.state.ui,
            active: {
              ...ownershipCheck.state.ui.active,
              dispatch_state: "dispatched",
              ...runDetails,
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
        core.setOutput("dispatched_run_id", String(runDetails.workflow_run_id));
      } else {
        stateComment = await writeControllerState({
          github,
          context,
          pr,
          state,
          stateComment,
        });
      }

      const finalPull = await pullFromApi(github, context, pr);
      const finalComments = parseControllerComments(
        await listComments(github, context, pr),
      );
      const finalObservations = await collectCoalescingObservations(
        github,
        context,
        pr,
        reconcileState({
          events: finalComments.events,
          results: finalComments.results,
          pullRequest: finalPull,
          existingState: finalComments.state,
          controllerUrl,
        }).lineage,
      );
      const finalReconciled = reconcileState({
        events: finalComments.events,
        results: finalComments.results,
        observations: finalObservations,
        pullRequest: finalPull,
        existingState: finalComments.state,
        controllerUrl,
      });
      invariant(
        finalReconciled.state.epoch.anchor_run_id ===
          state.epoch.anchor_run_id &&
          finalReconciled.state.epoch.basis_digest === state.epoch.basis_digest,
        "Reconciliation basis changed before status publication",
      );
      state = finalReconciled.state;
      stateComment = await writeControllerState({
        github,
        context,
        pr,
        state,
        stateComment,
      });
      const assertStatusBasis = async () => {
        const confirmed = parseControllerComments(
          await listComments(github, context, pr),
        );
        invariant(
          confirmed.stateComment?.id === stateComment.id &&
            canonicalJson(confirmed.state) === canonicalJson(state),
          "Controller state changed before status publication",
        );
        invariant(
          confirmed.state.receipts_digest ===
            controllerReceiptsDigest(confirmed.events, confirmed.results, pr),
          "Controller receipt set changed before status publication",
        );
      };
      await assertStatusBasis();
      await postStatusDecisions(github, context, state.status_decisions, {
        assertBasis: assertStatusBasis,
      });
      core.setOutput("pr_number", String(pr));
      return state;
    } catch (error) {
      if (
        attempt < 2 &&
        /concurrent update|basis changed|changed before status|receipt set changed|ownership changed/.test(
          error.message,
        )
      ) {
        continue;
      }
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
    }
  }
  throw new Error("Controller state update did not converge");
}

async function loadControllerEvidence(github, context, pr) {
  const parsed = parseControllerComments(
    await listComments(github, context, pr),
  );
  invariant(parsed.state !== null, "Controller state comment does not exist");
  normalizeExistingState(parsed.state, pr);
  return parsed;
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
}) {
  const pr = pullRequestNumber(inputs.pull_request_number);
  invariant(inputs.target === PREVIEW_TARGET, "Worker target must be UI");
  const sha = exactSha(inputs.commit_sha);
  const gitRef = validatedHeadRef(inputs.git_branch);
  const key = boundedText(inputs.controller_key, "Controller key", 255);
  invariant(key === controllerKey(pr, sha), "Worker controller key is invalid");
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
      }),
    "Worker controller key digest is invalid",
  );
  const pull = await pullFromApi(github, context, pr);
  assertDispatchTrust(pull, { git_ref: gitRef });
  invariant(
    await shaIsStillAssociated(github, context, pull, sha),
    "Selected SHA is no longer associated with the PR lineage",
  );
  const evidence = await loadControllerEvidence(github, context, pr);
  const state = evidence.state;
  const active = state.ui?.active;
  invariant(
    active?.key === key &&
      active?.sha === sha &&
      active?.key_digest === keyDigest &&
      active?.epoch_anchor_run_id === epochAnchorRunId &&
      active?.reconciliation_basis_digest === basisDigest &&
      active?.selection_receipt_run_id === selectionReceiptRunId,
    "Controller state does not own this worker key",
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

async function findCanonicalDeployment(github, context, { pr, sha, key }) {
  const environment = `preview/ui/pr-${pr}`;
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
      payload?.idempotency_key === key &&
      payload?.sha === sha &&
      payload?.logical_target === PREVIEW_TARGET
    );
  });
  invariant(
    matches.length <= 1,
    "Multiple canonical GitHub Deployments match one controller key",
  );
  return matches[0] ?? null;
}

async function collectCoalescingObservations(github, context, pr, lineage) {
  const eligible = lineage.filter((event) =>
    event.plan.targets.includes(PREVIEW_TARGET),
  );
  invariant(
    eligible.length <= 25,
    "Too many runtime candidates for bounded coalescing proof",
  );
  const runs = await listWorkerRuns(github, context);
  const observations = {};
  for (const event of eligible) {
    const key = controllerKey(pr, event.head_sha);
    const workerRuns = runs.filter((run) => {
      try {
        const parsed = parseWorkerRunName(run.display_title);
        return parsed.pr === pr && parsed.sha === event.head_sha;
      } catch {
        return false;
      }
    }).length;
    const deployment = await findCanonicalDeployment(github, context, {
      pr,
      sha: event.head_sha,
      key,
    });
    observations[key] = {
      worker_runs: workerRuns,
      deployments: deployment ? 1 : 0,
    };
  }
  return observations;
}

async function createRecoveryDeployment(
  github,
  context,
  parsed,
  selection,
  run,
) {
  const { data } = await github.rest.repos.createDeployment({
    ...ownerRepo(context),
    ref: parsed.sha,
    auto_merge: false,
    required_contexts: [],
    environment: `preview/ui/pr-${parsed.pr}`,
    transient_environment: true,
    production_environment: false,
    description: "Vercel prebuilt UI preview recovery",
    payload: {
      controller_schema: "mento-vercel-prebuilt/v1",
      idempotency_key: selection.key,
      logical_target: PREVIEW_TARGET,
      sha: parsed.sha,
      git_ref: validatedHeadRef(selection.git_ref),
      workflow_run_url: optionalHttpsUrl(run.html_url, "Worker run URL"),
      pull_request_number: parsed.pr,
      provenance: "preview-controller-recovery",
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

function workerOutcomeSelection(inputs) {
  const pr = pullRequestNumber(inputs.pull_request_number);
  invariant(inputs.target === PREVIEW_TARGET, "Worker target must be UI");
  const sha = exactSha(inputs.commit_sha);
  const key = boundedText(inputs.controller_key, "Controller key", 255);
  invariant(key === controllerKey(pr, sha), "Worker controller key is invalid");
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
      }),
    "Worker controller key digest is invalid",
  );
  return {
    pr,
    sha,
    key,
    keyDigest,
    epochAnchorRunId,
    basisDigest,
    selectionReceiptRunId,
  };
}

export async function recordWorkerEvidence({ github, context, core, inputs }) {
  const selection = workerOutcomeSelection(inputs);
  const evidence = await loadControllerEvidence(github, context, selection.pr);
  const ownedSelection = [
    evidence.state.ui?.active,
    ...(evidence.state.ui?.retired_active ?? []),
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
    target: PREVIEW_TARGET,
    sha: selection.sha,
    controller_key: selection.key,
    key_digest: selection.keyDigest,
    epoch_anchor_run_id: selection.epochAnchorRunId,
    reconciliation_basis_digest: selection.basisDigest,
    selection_receipt_run_id: selection.selectionReceiptRunId,
    worker_run_id: runId,
    worker_run_attempt: runAttempt,
    github_deployment_id: Number(deployment.id),
    execution_mode: mode,
    build_completed: buildCompleted,
    vercel_deployment_id: vercelDeploymentId,
    next_deployment_id: nextDeploymentId,
    verified_upload_url: verifiedUploadUrl,
  });
  await writeImmutableComment({
    github,
    context,
    pr: selection.pr,
    marker: workerEvidenceMarker(workerEvidence),
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
  plainObject(workflowRun, "Worker workflow run");
  invariant(
    workflowRun.name === WORKER_WORKFLOW_NAME,
    "Unexpected workflow_run source",
  );
  const parsed = parseWorkerRunName(workflowRun.display_title);
  const runId = exactRunId(workflowRun.id, "Worker run ID");
  const key = controllerKey(parsed.pr, parsed.sha);
  const evidence = await loadControllerEvidence(github, context, parsed.pr);
  const state = evidence.state;
  let currentSelection = state.ui?.active;
  let selection = [currentSelection, ...(state.ui?.retired_active ?? [])].find(
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
    ...(state.ui?.terminal_history ?? []),
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
      { waitForRetry: waitForRecovery },
    );
    invariant(
      uniqueRecoveredRun?.workflow_run_id === runId,
      "Completed intended worker is not the unique recoverable owner",
    );
  }
  const queriedRun = await getValidatedWorkerRun(
    github,
    context,
    runId,
    selection,
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
      state.ui.active = recoveredSelection;
      currentSelection = recoveredSelection;
    } else {
      const retiredIndex = state.ui.retired_active.findIndex(
        (candidate) => candidate.key_digest === selection.key_digest,
      );
      invariant(
        retiredIndex >= 0,
        "Intended retired worker ownership disappeared",
      );
      state.ui.retired_active = [...state.ui.retired_active];
      state.ui.retired_active[retiredIndex] = recoveredSelection;
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
      (conclusion === "success") === (existingResult.state === "success"),
      "Existing worker result conflicts with the completed run conclusion",
    );
    const shouldReconcileCurrentEpoch =
      selection === currentSelection &&
      selection.epoch_anchor_run_id === state.epoch.anchor_run_id;
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
  if (
    conclusion === "success" &&
    status?.state === "success" &&
    status.environment_url
  ) {
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
      !workerEvidence.build_completed &&
      !uploadStarted
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
    target: PREVIEW_TARGET,
    sha: parsed.sha,
    controller_key: key,
    key_digest: parsed.keyDigest,
    epoch_anchor_run_id: selection.epoch_anchor_run_id,
    reconciliation_basis_digest: selection.reconciliation_basis_digest,
    selection_receipt_run_id: selection.selection_receipt_run_id,
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
  await writeImmutableComment({
    github,
    context,
    pr: parsed.pr,
    marker: resultReceiptMarker(result),
    value: result,
  });
  core.setOutput("pr_number", String(parsed.pr));
  core.setOutput("result_state", terminalState);
  const shouldReconcileCurrentEpoch =
    selection === currentSelection &&
    selection.epoch_anchor_run_id === state.epoch.anchor_run_id;
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
  const parsed = parseWorkerRunName(workflowRun.display_title);
  const evidence = await loadControllerEvidence(github, context, parsed.pr);
  const active = evidence.state.ui?.active;
  if (
    active?.sha !== parsed.sha ||
    active?.key_digest !== parsed.keyDigest ||
    active.epoch_anchor_run_id !== evidence.state.epoch.anchor_run_id
  ) {
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
