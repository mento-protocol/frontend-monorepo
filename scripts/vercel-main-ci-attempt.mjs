#!/usr/bin/env node

import { Buffer } from "node:buffer";
import { appendFileSync, readFileSync } from "node:fs";
import process from "node:process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const MAIN_DEPLOYMENT_REPOSITORY = "mento-protocol/frontend-monorepo";
const MAIN_DEPLOYMENT_UPSTREAM_WORKFLOW = "CI/CD";
const MAIN_DEPLOYMENT_UPSTREAM_WORKFLOW_PATH = ".github/workflows/ci.yml";
const MAIN_DEPLOYMENT_SENTINEL_JOB = "Build and Test";
const MAIN_DEPLOYMENT_WORKFLOW_PATH =
  ".github/workflows/vercel-main-deployment.yml";

/** Admissible `workflow_run` activity types for the main deployment workflow. */
export const MAIN_DEPLOYMENT_ADMISSIBLE_ACTIONS = Object.freeze([
  "requested",
  "completed",
]);

const GITHUB_API_ORIGIN = "https://api.github.com";
const GITHUB_WEB_ORIGIN = "https://github.com";
const GITHUB_API_VERSION = "2022-11-28";
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const MAX_EVENT_BYTES = 1024 * 1024;
const MAX_API_RESPONSE_BYTES = 4 * 1024 * 1024;
const JOBS_PER_PAGE = 100;
const MAX_JOB_PAGES = 10;
const MAX_JOBS = JOBS_PER_PAGE * MAX_JOB_PAGES;
const MAX_SIBLING_RUNS = 100;
const MAX_GATE_JOB_NAME_LENGTH = 100;
const DEFAULT_REQUEST_ATTEMPTS = 3;
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_RETRY_DELAY_MS = 250;
const DEFAULT_AWAIT_INTERVAL_MS = 5_000;
const DEFAULT_AWAIT_TIMEOUT_MS = 1_800_000;
const RETRYABLE_HTTP_STATUSES = new Set([408, 429]);

/**
 * Literal name of the credential-free exact-attempt CI success gate job.
 *
 * The upstream attempt is bound into the job name deliberately: it is the only
 * durable, queryable proof that a given deployment run already passed the CI
 * verdict for that exact attempt, because a `workflow_run` run object names no
 * triggering run. A workflow-level `run-name` would carry the same marker, but
 * GitHub then also replaces the run's REST `name` field with it, which would
 * break `.github/workflows/ci-failure-notifier.yml` and
 * `scripts/ci-failure-issue.mjs`; both identify this workflow by that field.
 */
export function mainDeploymentGateJobName(runId, runAttempt) {
  return `Require the exact successful CI attempt for upstream ${runId} attempt ${runAttempt}`;
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

function exactString(value, expected, label) {
  invariant(
    typeof value === "string" && value === expected,
    `${label} mismatch`,
  );
  return value;
}

function boundedString(value, label, maximum = 255) {
  invariant(
    typeof value === "string" &&
      value.length > 0 &&
      value.length <= maximum &&
      ![...value].some((character) => {
        const codePoint = character.codePointAt(0);
        return codePoint <= 31 || codePoint === 127;
      }),
    `${label} is missing or invalid`,
  );
  return value;
}

function positiveInteger(value, label) {
  invariant(
    Number.isSafeInteger(value) && value > 0,
    `${label} must be a positive safe integer`,
  );
  return value;
}

function nonNegativeInteger(value, label) {
  invariant(
    Number.isSafeInteger(value) && value >= 0,
    `${label} must be a non-negative safe integer`,
  );
  return value;
}

function exactSha(value, label = "DEPLOY_SHA") {
  invariant(
    typeof value === "string" && SHA_PATTERN.test(value),
    `${label} must be an immutable lowercase 40-character SHA`,
  );
  return value;
}

function repositoryObject(value, label) {
  const repository = plainObject(value, label);
  exactString(
    repository.full_name,
    MAIN_DEPLOYMENT_REPOSITORY,
    `${label} full name`,
  );
  return repository;
}

function canonicalRunApiUrl(runId) {
  return `${GITHUB_API_ORIGIN}/repos/${MAIN_DEPLOYMENT_REPOSITORY}/actions/runs/${runId}`;
}

function canonicalRunWebUrl(runId) {
  return `${GITHUB_WEB_ORIGIN}/${MAIN_DEPLOYMENT_REPOSITORY}/actions/runs/${runId}`;
}

function canonicalAttemptWebUrl(runId, runAttempt) {
  return `${canonicalRunWebUrl(runId)}/attempts/${runAttempt}`;
}

function canonicalJobApiUrl(jobId) {
  return `${GITHUB_API_ORIGIN}/repos/${MAIN_DEPLOYMENT_REPOSITORY}/actions/jobs/${jobId}`;
}

function canonicalJobWebUrl(runId, jobId) {
  return `${canonicalRunWebUrl(runId)}/job/${jobId}`;
}

function validateRunIdentityCore(run, { deploySha, runId, runAttempt, label }) {
  positiveInteger(run.id, `${label} ID`);
  invariant(run.id === runId, `${label} ID mismatch`);
  positiveInteger(run.run_attempt, `${label} attempt`);
  invariant(run.run_attempt === runAttempt, `${label} attempt mismatch`);
  exactString(run.name, MAIN_DEPLOYMENT_UPSTREAM_WORKFLOW, `${label} name`);
  exactString(
    run.path,
    MAIN_DEPLOYMENT_UPSTREAM_WORKFLOW_PATH,
    `${label} path`,
  );
  exactString(run.event, "push", `${label} event`);
  exactString(run.head_branch, "main", `${label} head branch`);
  invariant(
    exactSha(run.head_sha, `${label} head SHA`) === deploySha,
    `${label} head SHA mismatch`,
  );
  repositoryObject(run.repository, `${label} repository`);
  repositoryObject(run.head_repository, `${label} head repository`);
  exactString(run.url, canonicalRunApiUrl(runId), `${label} API URL`);
  exactString(run.html_url, canonicalRunWebUrl(runId), `${label} web URL`);
}

function assertTerminalSuccess(run, label) {
  exactString(run.status, "completed", `${label} status`);
  exactString(run.conclusion, "success", `${label} conclusion`);
}

function assertNonTerminal(run, label) {
  invariant(
    run.conclusion === null,
    `${label} conclusion mismatch: a requested attempt cannot have concluded`,
  );
  invariant(
    boundedString(run.status, `${label} status`, 32) !== "completed",
    `${label} status mismatch: a requested attempt cannot be completed`,
  );
}

function validateRunIdentity(run, expected) {
  validateRunIdentityCore(run, expected);
  assertTerminalSuccess(run, expected.label);
}

/**
 * Authenticate the workflow_run event before making any API request.
 *
 * `allowedActions` defaults to the terminal `completed` delivery. Admission
 * widens it to the `requested` delivery, which must still carry the exact
 * upstream identity but must not have concluded.
 *
 * @param {{
 *   eventPayload: unknown,
 *   deploySha: string,
 *   allowedActions?: readonly string[],
 * }} options
 */
export function validateMainCiWorkflowRunEvent({
  eventPayload,
  deploySha,
  allowedActions = ["completed"],
}) {
  const expectedSha = exactSha(deploySha);
  const payload = plainObject(eventPayload, "GitHub event payload");
  const action = boundedString(payload.action, "GitHub event action", 32);
  invariant(
    allowedActions.includes(action),
    "GitHub event action is not admissible",
  );
  repositoryObject(payload.repository, "GitHub event repository");

  const run = plainObject(payload.workflow_run, "GitHub event workflow run");
  const runId = positiveInteger(run.id, "GitHub event workflow run ID");
  const runAttempt = positiveInteger(
    run.run_attempt,
    "GitHub event workflow run attempt",
  );
  const label = "GitHub event workflow run";
  validateRunIdentityCore(run, {
    deploySha: expectedSha,
    runId,
    runAttempt,
    label,
  });
  if (action === "completed") {
    assertTerminalSuccess(run, label);
  } else {
    assertNonTerminal(run, label);
  }

  return {
    action,
    deploySha: expectedSha,
    runAttempt,
    runId,
  };
}

function validateMainCiRunRecord(rawRun, expected) {
  const run = plainObject(rawRun, "GitHub API workflow run");
  validateRunIdentity(run, {
    ...expected,
    label: "GitHub API workflow run",
  });
  return run;
}

function validateMainCiJob(rawJob, expected) {
  const job = plainObject(rawJob, "GitHub API workflow job");
  const jobId = positiveInteger(job.id, "GitHub API workflow job ID");
  invariant(
    positiveInteger(job.run_id, "GitHub API workflow job run ID") ===
      expected.runId,
    "GitHub API workflow job run ID mismatch",
  );
  invariant(
    positiveInteger(job.run_attempt, "GitHub API workflow job run attempt") ===
      expected.runAttempt,
    "GitHub API workflow job run attempt mismatch",
  );
  exactString(
    job.workflow_name,
    MAIN_DEPLOYMENT_UPSTREAM_WORKFLOW,
    "GitHub API workflow job workflow name",
  );
  exactString(job.head_branch, "main", "GitHub API workflow job head branch");
  invariant(
    exactSha(job.head_sha, "GitHub API workflow job head SHA") ===
      expected.deploySha,
    "GitHub API workflow job head SHA mismatch",
  );
  const name = boundedString(job.name, "GitHub API workflow job name");
  exactString(
    job.run_url,
    canonicalRunApiUrl(expected.runId),
    "GitHub API workflow job run URL",
  );
  exactString(
    job.url,
    canonicalJobApiUrl(jobId),
    "GitHub API workflow job API URL",
  );
  exactString(
    job.html_url,
    canonicalJobWebUrl(expected.runId, jobId),
    "GitHub API workflow job web URL",
  );
  boundedString(job.status, "GitHub API workflow job status", 32);
  invariant(
    job.conclusion === null ||
      (typeof job.conclusion === "string" && job.conclusion.length <= 32),
    "GitHub API workflow job conclusion is invalid",
  );
  return {
    conclusion: job.conclusion,
    id: jobId,
    name,
    status: job.status,
  };
}

function validateApiBase(apiUrl) {
  let parsed;
  try {
    parsed = new URL(apiUrl);
  } catch {
    throw new Error("GITHUB_API_URL is invalid");
  }
  invariant(
    parsed.origin === GITHUB_API_ORIGIN &&
      (parsed.pathname === "" || parsed.pathname === "/") &&
      parsed.search === "" &&
      parsed.hash === "" &&
      parsed.username === "" &&
      parsed.password === "",
    "GITHUB_API_URL must be the canonical public GitHub API origin",
  );
  return GITHUB_API_ORIGIN;
}

function validateToken(token) {
  invariant(
    typeof token === "string" &&
      token.length > 0 &&
      token.length <= 2_048 &&
      !/\s/.test(token),
    "GITHUB_TOKEN is missing or invalid",
  );
  return token;
}

function boundedPolicyInteger(value, label, minimum, maximum) {
  invariant(
    Number.isSafeInteger(value) && value >= minimum && value <= maximum,
    `${label} is outside its bounded policy`,
  );
  return value;
}

function retryableStatus(status) {
  return RETRYABLE_HTTP_STATUSES.has(status) || status >= 500;
}

function requestHeaders(token) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "User-Agent": "mento-vercel-main-ci-attempt",
    "X-GitHub-Api-Version": GITHUB_API_VERSION,
  };
}

class RetryableGitHubApiError extends Error {
  constructor(reason) {
    super(reason);
    this.name = "RetryableGitHubApiError";
    this.reason = reason;
  }
}

async function pause(milliseconds, sleepImplementation) {
  await sleepImplementation(milliseconds);
}

function defaultSleep(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function requestJson(
  path,
  {
    apiUrl,
    fetchImplementation,
    token,
    signal,
    requestAttempts,
    requestTimeoutMs,
    retryDelayMs,
    sleepImplementation,
  },
) {
  const url = new URL(path, `${apiUrl}/`);
  let finalReason = "network failure";

  for (let attempt = 1; attempt <= requestAttempts; attempt += 1) {
    if (signal?.aborted) {
      throw new Error("GitHub API verification was cancelled");
    }

    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, requestTimeoutMs);
    const cancel = () => controller.abort(signal.reason);
    signal?.addEventListener("abort", cancel, { once: true });

    try {
      const response = await fetchImplementation(url, {
        method: "GET",
        redirect: "error",
        headers: requestHeaders(token),
        signal: controller.signal,
      });

      if (!response?.ok) {
        const status = Number(response?.status);
        if (!Number.isInteger(status) || status < 100 || status > 599) {
          throw new Error("GitHub API returned an invalid HTTP response");
        }
        finalReason = `HTTP ${status}`;
        if (!retryableStatus(status)) {
          throw new Error(
            `GitHub API request failed: GET ${url.pathname} (${finalReason})`,
          );
        }
        throw new RetryableGitHubApiError(finalReason);
      }

      const contentType = response.headers?.get?.("content-type");
      invariant(
        typeof contentType === "string" &&
          /^(?:application\/json|application\/vnd\.github\+json)(?:;|$)/i.test(
            contentType,
          ),
        `GitHub API returned a non-JSON response for ${url.pathname}`,
      );
      const declaredLength = response.headers?.get?.("content-length");
      if (declaredLength !== null && declaredLength !== undefined) {
        invariant(
          /^[0-9]+$/.test(declaredLength) &&
            Number(declaredLength) <= MAX_API_RESPONSE_BYTES,
          `GitHub API response exceeded its size limit for ${url.pathname}`,
        );
      }
      const text = await response.text();
      invariant(
        Buffer.byteLength(text) <= MAX_API_RESPONSE_BYTES,
        `GitHub API response exceeded its size limit for ${url.pathname}`,
      );
      try {
        return JSON.parse(text);
      } catch {
        throw new Error(`GitHub API returned invalid JSON for ${url.pathname}`);
      }
    } catch (error) {
      if (signal?.aborted) {
        throw new Error("GitHub API verification was cancelled");
      }
      if (error instanceof RetryableGitHubApiError) {
        finalReason = error.reason;
      } else if (
        error instanceof Error &&
        /GitHub API (?:request failed|returned|response exceeded)/.test(
          error.message,
        )
      ) {
        throw error;
      } else {
        finalReason = timedOut ? "request timeout" : "network failure";
      }
      if (attempt === requestAttempts) {
        break;
      }
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", cancel);
    }

    await pause(retryDelayMs, sleepImplementation);
  }

  throw new Error(
    `GitHub API request failed after ${requestAttempts} bounded attempts: GET ${url.pathname} (${finalReason})`,
  );
}

async function listMainCiAttemptJobs(expected, requestOptions) {
  const jobs = [];
  const seenJobIds = new Set();
  let expectedTotal = null;

  for (let page = 1; page <= MAX_JOB_PAGES; page += 1) {
    const payload = plainObject(
      await requestJson(
        `/repos/${MAIN_DEPLOYMENT_REPOSITORY}/actions/runs/${expected.runId}/attempts/${expected.runAttempt}/jobs?per_page=${JOBS_PER_PAGE}&page=${page}`,
        requestOptions,
      ),
      `GitHub API workflow jobs page ${page}`,
    );
    const totalCount = nonNegativeInteger(
      payload.total_count,
      `GitHub API workflow jobs page ${page} total count`,
    );
    invariant(
      totalCount <= MAX_JOBS,
      `GitHub API workflow jobs exceeded the ${MAX_JOBS}-job bound`,
    );
    if (expectedTotal === null) expectedTotal = totalCount;
    invariant(
      totalCount === expectedTotal,
      "GitHub API workflow jobs total changed during pagination",
    );
    invariant(
      Array.isArray(payload.jobs) && payload.jobs.length <= JOBS_PER_PAGE,
      `GitHub API workflow jobs page ${page} is malformed`,
    );
    invariant(
      payload.jobs.length > 0 || jobs.length === expectedTotal,
      "GitHub API workflow jobs pagination ended before total_count",
    );

    for (const rawJob of payload.jobs) {
      const job = validateMainCiJob(rawJob, expected);
      invariant(
        !seenJobIds.has(job.id),
        "GitHub API workflow jobs contained a duplicate job ID",
      );
      seenJobIds.add(job.id);
      jobs.push(job);
      invariant(
        jobs.length <= expectedTotal,
        "GitHub API workflow jobs exceeded total_count",
      );
    }
    if (jobs.length === expectedTotal) return jobs;
  }

  throw new Error(
    `GitHub API workflow jobs pagination exceeded the ${MAX_JOB_PAGES}-page bound`,
  );
}

function resolveRequestOptions({
  apiUrl,
  fetchImplementation,
  token,
  signal,
  requestAttempts,
  requestTimeoutMs,
  retryDelayMs,
  sleepImplementation,
}) {
  invariant(
    typeof fetchImplementation === "function",
    "fetchImplementation must be a function",
  );
  invariant(
    typeof sleepImplementation === "function",
    "sleepImplementation must be a function",
  );
  return {
    apiUrl: validateApiBase(apiUrl),
    fetchImplementation,
    token: validateToken(token),
    signal,
    requestAttempts: boundedPolicyInteger(
      requestAttempts,
      "GitHub API request attempts",
      1,
      4,
    ),
    requestTimeoutMs: boundedPolicyInteger(
      requestTimeoutMs,
      "GitHub API request timeout",
      1,
      30_000,
    ),
    retryDelayMs: boundedPolicyInteger(
      retryDelayMs,
      "GitHub API retry delay",
      0,
      5_000,
    ),
    sleepImplementation,
  };
}

const SENTINEL_COUNT_MESSAGE = `Expected exactly one literal ${MAIN_DEPLOYMENT_SENTINEL_JOB} job in the exact upstream attempt`;

function requireExactlyOneSentinel(jobs) {
  const sentinels = jobs.filter(
    (job) => job.name === MAIN_DEPLOYMENT_SENTINEL_JOB,
  );
  invariant(sentinels.length === 1, SENTINEL_COUNT_MESSAGE);
  return sentinels[0];
}

function canonicalAttemptIdentity(expected) {
  return {
    deploy_sha: expected.deploySha,
    upstream_run_attempt: expected.runAttempt,
    upstream_run_id: expected.runId,
    upstream_run_url: canonicalAttemptWebUrl(
      expected.runId,
      expected.runAttempt,
    ),
  };
}

function canonicalAttemptEvidence(expected, sentinel) {
  return {
    build_and_test_job_id: sentinel.id,
    build_and_test_job_url: canonicalJobWebUrl(expected.runId, sentinel.id),
    ...canonicalAttemptIdentity(expected),
  };
}

async function verifyTerminalAttempt(expected, requestOptions) {
  const run = await requestJson(
    `/repos/${MAIN_DEPLOYMENT_REPOSITORY}/actions/runs/${expected.runId}`,
    requestOptions,
  );
  validateMainCiRunRecord(run, expected);

  const sentinel = requireExactlyOneSentinel(
    await listMainCiAttemptJobs(expected, requestOptions),
  );
  invariant(
    sentinel.status === "completed" && sentinel.conclusion === "success",
    `${MAIN_DEPLOYMENT_SENTINEL_JOB} did not complete successfully in the exact upstream attempt`,
  );
  return sentinel;
}

/**
 * Verify the exact successful CI/CD attempt that triggered a main deployment.
 * Only canonical identifiers, URLs, the attempt number, and DEPLOY_SHA leave
 * this trust boundary.
 *
 * @param {{
 *   eventPayload: unknown,
 *   deploySha: string,
 *   token: string,
 *   apiUrl?: string,
 *   fetchImplementation?: typeof fetch,
 *   sleepImplementation?: (milliseconds: number) => Promise<void>,
 *   signal?: AbortSignal,
 *   requestAttempts?: number,
 *   requestTimeoutMs?: number,
 *   retryDelayMs?: number,
 * }} options
 */
export async function verifyMainCiAttempt({
  eventPayload,
  deploySha,
  token,
  apiUrl = GITHUB_API_ORIGIN,
  fetchImplementation = fetch,
  sleepImplementation = defaultSleep,
  signal,
  requestAttempts = DEFAULT_REQUEST_ATTEMPTS,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
}) {
  const expected = validateMainCiWorkflowRunEvent({
    eventPayload,
    deploySha,
  });
  const requestOptions = resolveRequestOptions({
    apiUrl,
    fetchImplementation,
    token,
    signal,
    requestAttempts,
    requestTimeoutMs,
    retryDelayMs,
    sleepImplementation,
  });

  const sentinel = await verifyTerminalAttempt(expected, requestOptions);
  return Object.freeze(canonicalAttemptEvidence(expected, sentinel));
}

/**
 * Admit an upstream attempt that has not produced its verdict yet.
 *
 * Only the exact run identity is asserted. The attempt's jobs are deliberately
 * not read: `.github/workflows/ci.yml` gives the `Build and Test` sentinel
 * `needs: [changes, build, test, static]`, and GitHub creates a job record only
 * once a job's `needs` resolve, so the sentinel does not exist until CI is
 * seconds from finishing. Waiting for it here would erase the whole point of
 * the early delivery. `require-ci-success` owns that record.
 */
async function admitEarlyAttempt(expected, requestOptions) {
  const run = await requestJson(
    `/repos/${MAIN_DEPLOYMENT_REPOSITORY}/actions/runs/${expected.runId}`,
    requestOptions,
  );
  const record = plainObject(run, "GitHub API workflow run");
  validateRunIdentityCore(record, {
    ...expected,
    label: "GitHub API workflow run",
  });
  assertNonTerminal(record, "GitHub API workflow run");
}

function validateSiblingDeploymentRun(rawRun, { deploySha, ownRunId }) {
  const run = plainObject(rawRun, "GitHub API deployment run");
  const id = positiveInteger(run.id, "GitHub API deployment run ID");
  if (id === ownRunId) return undefined;
  if (
    run.path !== MAIN_DEPLOYMENT_WORKFLOW_PATH ||
    run.event !== "workflow_run" ||
    run.head_branch !== "main" ||
    run.head_sha !== deploySha ||
    run.url !== canonicalRunApiUrl(id) ||
    run.html_url !== canonicalRunWebUrl(id)
  ) {
    return undefined;
  }
  return {
    // A gate job that concluded `success` proves only that the sibling reached
    // the CI verdict, not that it finished the release. `queue: single` holds
    // this delivery until the sibling leaves the queue, so the sibling is
    // already terminal here and its own conclusion is the honest signal.
    succeeded: run.status === "completed" && run.conclusion === "success",
    id,
    url: canonicalRunWebUrl(id),
  };
}

async function siblingPassedTheSuccessGate(siblingId, marker, requestOptions) {
  const payload = plainObject(
    await requestJson(
      `/repos/${MAIN_DEPLOYMENT_REPOSITORY}/actions/runs/${siblingId}/jobs?filter=latest&per_page=${MAX_SIBLING_RUNS}`,
      requestOptions,
    ),
    "GitHub API deployment run jobs",
  );
  const totalCount = nonNegativeInteger(
    payload.total_count,
    "GitHub API deployment run jobs total count",
  );
  invariant(
    totalCount <= MAX_SIBLING_RUNS &&
      Array.isArray(payload.jobs) &&
      payload.jobs.length === totalCount,
    "GitHub API deployment run jobs listing is malformed or unbounded",
  );
  const gates = [];
  for (const rawJob of payload.jobs) {
    const job = plainObject(rawJob, "GitHub API deployment run job");
    if (
      boundedString(job.name, "GitHub API deployment run job name") !== marker
    ) {
      continue;
    }
    invariant(
      positiveInteger(job.run_id, "GitHub API deployment run job run ID") ===
        siblingId,
      "GitHub API deployment run job run ID mismatch",
    );
    gates.push({
      conclusion: job.conclusion,
      status: boundedString(
        job.status,
        "GitHub API deployment run job status",
        32,
      ),
    });
  }
  return (
    gates.length === 1 &&
    gates[0].status === "completed" &&
    gates[0].conclusion === "success"
  );
}

/**
 * Decide whether a `completed` delivery must deploy or is a duplicate of a
 * deployment run that already succeeded after passing the exact-attempt CI
 * success gate.
 *
 * Every ambiguity resolves to `deploy`: a redundant run is serialized by the
 * single deployment queue and routed by the stable release manifest to the
 * journal-free `current-release-verified` route, while refusing to deploy can
 * strand `main`.
 */
async function decideMainCiDeployMode({
  deploySha,
  runId,
  runAttempt,
  ownRunId,
  requestOptions,
}) {
  try {
    positiveInteger(ownRunId, "GITHUB_RUN_ID");
    const marker = boundedString(
      mainDeploymentGateJobName(runId, runAttempt),
      "Vercel main deployment gate job name",
      MAX_GATE_JOB_NAME_LENGTH,
    );
    const payload = plainObject(
      await requestJson(
        `/repos/${MAIN_DEPLOYMENT_REPOSITORY}/actions/workflows/${encodeURIComponent(
          MAIN_DEPLOYMENT_WORKFLOW_PATH,
        )}/runs?head_sha=${deploySha}&event=workflow_run&per_page=${MAX_SIBLING_RUNS}`,
        requestOptions,
      ),
      "GitHub API deployment runs",
    );
    const totalCount = nonNegativeInteger(
      payload.total_count,
      "GitHub API deployment runs total count",
    );
    invariant(
      totalCount <= MAX_SIBLING_RUNS &&
        Array.isArray(payload.workflow_runs) &&
        payload.workflow_runs.length === totalCount,
      "GitHub API deployment runs listing is malformed or unbounded",
    );
    const siblings = payload.workflow_runs
      .map((rawRun) =>
        validateSiblingDeploymentRun(rawRun, { deploySha, ownRunId }),
      )
      .filter((sibling) => sibling !== undefined);
    if (
      siblings.length === 1 &&
      siblings[0].succeeded &&
      (await siblingPassedTheSuccessGate(
        siblings[0].id,
        marker,
        requestOptions,
      ))
    ) {
      return {
        deployMode: "already-deployed",
        duplicateOfRunUrl: siblings[0].url,
      };
    }
  } catch {
    return { deployMode: "deploy", duplicateOfRunUrl: "" };
  }
  return { deployMode: "deploy", duplicateOfRunUrl: "" };
}

/**
 * Admit a `requested` or `completed` upstream delivery.
 *
 * A `requested` delivery admits the exact non-terminal attempt so read-only
 * planning can overlap CI; the separate `require-success` gate owns the verdict
 * and the exact `Build and Test` job record. A `completed` delivery keeps the
 * full terminal verification and additionally reports whether a sibling run
 * already deployed this exact attempt. Both deliveries publish the same
 * identity-only evidence.
 *
 * @param {{
 *   eventPayload: unknown,
 *   deploySha: string,
 *   token: string,
 *   ownRunId?: number,
 *   apiUrl?: string,
 *   fetchImplementation?: typeof fetch,
 *   sleepImplementation?: (milliseconds: number) => Promise<void>,
 *   signal?: AbortSignal,
 *   requestAttempts?: number,
 *   requestTimeoutMs?: number,
 *   retryDelayMs?: number,
 * }} options
 */
export async function admitMainCiAttempt({
  eventPayload,
  deploySha,
  token,
  ownRunId,
  apiUrl = GITHUB_API_ORIGIN,
  fetchImplementation = fetch,
  sleepImplementation = defaultSleep,
  signal,
  requestAttempts = DEFAULT_REQUEST_ATTEMPTS,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
}) {
  const expected = validateMainCiWorkflowRunEvent({
    eventPayload,
    deploySha,
    allowedActions: MAIN_DEPLOYMENT_ADMISSIBLE_ACTIONS,
  });
  const requestOptions = resolveRequestOptions({
    apiUrl,
    fetchImplementation,
    token,
    signal,
    requestAttempts,
    requestTimeoutMs,
    retryDelayMs,
    sleepImplementation,
  });

  if (expected.action === "requested") {
    await admitEarlyAttempt(expected, requestOptions);
    return Object.freeze({
      admission_mode: "early",
      ...canonicalAttemptIdentity(expected),
      deploy_mode: "deploy",
      duplicate_of_run_url: "",
    });
  }

  await verifyTerminalAttempt(expected, requestOptions);
  const { deployMode, duplicateOfRunUrl } = await decideMainCiDeployMode({
    deploySha: expected.deploySha,
    ownRunId,
    runAttempt: expected.runAttempt,
    runId: expected.runId,
    requestOptions,
  });
  return Object.freeze({
    admission_mode: "verified",
    ...canonicalAttemptIdentity(expected),
    deploy_mode: deployMode,
    duplicate_of_run_url: duplicateOfRunUrl,
  });
}

/**
 * Require the exact admitted upstream attempt to have completed successfully.
 *
 * This is the credential-free gate every public mutation waits for. It polls
 * only the exact run, re-asserts the admitted identity against the event
 * payload, and derives the exact `Build and Test` job the release plan then
 * carries. The sentinel is derived here rather than at admission because the
 * `requested` delivery runs before GitHub has created that job record.
 *
 * @param {{
 *   eventPayload: unknown,
 *   deploySha: string,
 *   upstreamRunId: number,
 *   upstreamRunAttempt: number,
 *   token: string,
 *   apiUrl?: string,
 *   fetchImplementation?: typeof fetch,
 *   sleepImplementation?: (milliseconds: number) => Promise<void>,
 *   nowImplementation?: () => number,
 *   signal?: AbortSignal,
 *   requestAttempts?: number,
 *   requestTimeoutMs?: number,
 *   retryDelayMs?: number,
 *   awaitIntervalMs?: number,
 *   awaitTimeoutMs?: number,
 * }} options
 */
export async function requireMainCiSuccess({
  eventPayload,
  deploySha,
  upstreamRunId,
  upstreamRunAttempt,
  token,
  apiUrl = GITHUB_API_ORIGIN,
  fetchImplementation = fetch,
  sleepImplementation = defaultSleep,
  nowImplementation = Date.now,
  signal,
  requestAttempts = DEFAULT_REQUEST_ATTEMPTS,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
  awaitIntervalMs = DEFAULT_AWAIT_INTERVAL_MS,
  awaitTimeoutMs = DEFAULT_AWAIT_TIMEOUT_MS,
}) {
  invariant(
    typeof nowImplementation === "function",
    "nowImplementation must be a function",
  );
  const expected = validateMainCiWorkflowRunEvent({
    eventPayload,
    deploySha,
    allowedActions: MAIN_DEPLOYMENT_ADMISSIBLE_ACTIONS,
  });
  invariant(
    positiveInteger(upstreamRunId, "UPSTREAM_RUN_ID") === expected.runId,
    "UPSTREAM_RUN_ID mismatch",
  );
  invariant(
    positiveInteger(upstreamRunAttempt, "UPSTREAM_RUN_ATTEMPT") ===
      expected.runAttempt,
    "UPSTREAM_RUN_ATTEMPT mismatch",
  );
  const requestOptions = resolveRequestOptions({
    apiUrl,
    fetchImplementation,
    token,
    signal,
    requestAttempts,
    requestTimeoutMs,
    retryDelayMs,
    sleepImplementation,
  });
  const intervalMs = boundedPolicyInteger(
    awaitIntervalMs,
    "GitHub API await interval",
    1_000,
    30_000,
  );
  const timeoutMs = boundedPolicyInteger(
    awaitTimeoutMs,
    "GitHub API await timeout",
    60_000,
    2_400_000,
  );
  const maxPolls = Math.max(1, Math.floor(timeoutMs / intervalMs));
  const startedAt = nowImplementation();

  for (let poll = 1; ; poll += 1) {
    const record = plainObject(
      await requestJson(
        `/repos/${MAIN_DEPLOYMENT_REPOSITORY}/actions/runs/${expected.runId}`,
        requestOptions,
      ),
      "GitHub API workflow run",
    );
    validateRunIdentityCore(record, {
      ...expected,
      label: "GitHub API workflow run",
    });
    if (
      boundedString(record.status, "GitHub API workflow run status", 32) ===
      "completed"
    ) {
      assertTerminalSuccess(record, "GitHub API workflow run");
      break;
    }
    assertNonTerminal(record, "GitHub API workflow run");
    invariant(
      poll < maxPolls && nowImplementation() - startedAt < timeoutMs,
      "The exact upstream CI attempt did not complete within its bounded await",
    );
    await pause(intervalMs, sleepImplementation);
  }

  const sentinel = requireExactlyOneSentinel(
    await listMainCiAttemptJobs(expected, requestOptions),
  );
  invariant(
    sentinel.status === "completed" && sentinel.conclusion === "success",
    `${MAIN_DEPLOYMENT_SENTINEL_JOB} did not complete successfully in the exact upstream attempt`,
  );

  return Object.freeze(canonicalAttemptEvidence(expected, sentinel));
}

const ADMISSION_HEADINGS = {
  early: "### Admitted upstream CI attempt before its verdict",
  verified: "### Admitted the exact completed upstream CI attempt",
};

export function formatMainCiAttemptSummary(result) {
  const admission = result.admission_mode;
  const lines = [
    ADMISSION_HEADINGS[admission] ?? "### Verified upstream CI attempt",
    "",
    `- Upstream run attempt: \`${result.upstream_run_attempt}\``,
    `- Upstream run URL: ${result.upstream_run_url}`,
  ];
  // Only the gate derives the sentinel; admission never carries it.
  if (result.build_and_test_job_url !== undefined) {
    lines.push(`- Build and Test job URL: ${result.build_and_test_job_url}`);
  }
  lines.push(`- DEPLOY_SHA: \`${result.deploy_sha}\``);
  if (admission !== undefined) {
    lines.push(`- Admission mode: \`${admission}\``);
    lines.push(`- Deploy mode: \`${result.deploy_mode}\``);
    if (result.duplicate_of_run_url) {
      lines.push(`- Deduplicated by: ${result.duplicate_of_run_url}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

function appendOutputs(path, result) {
  for (const [name, value] of Object.entries(result)) {
    appendFileSync(path, `${name}=${value}\n`);
  }
}

function readEventPayload(path) {
  const raw = readFileSync(path);
  invariant(
    raw.byteLength <= MAX_EVENT_BYTES,
    "GITHUB_EVENT_PATH exceeded its size limit",
  );
  try {
    return JSON.parse(raw.toString("utf8"));
  } catch {
    throw new Error("GITHUB_EVENT_PATH contained invalid JSON");
  }
}

function environmentInteger(value, label) {
  invariant(
    typeof value === "string" && /^[0-9]{1,15}$/.test(value),
    `${label} must be a bounded positive integer`,
  );
  return positiveInteger(Number(value), label);
}

function publishResult(values, result) {
  const outputPath = boundedString(
    values.GITHUB_OUTPUT,
    "GITHUB_OUTPUT",
    4_096,
  );
  appendOutputs(outputPath, result);
  if (values.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      boundedString(values.GITHUB_STEP_SUMMARY, "GITHUB_STEP_SUMMARY", 4_096),
      formatMainCiAttemptSummary(result),
    );
  }
  return result;
}

function environmentEventPayload(values) {
  return readEventPayload(
    boundedString(values.GITHUB_EVENT_PATH, "GITHUB_EVENT_PATH", 4_096),
  );
}

export async function admitMainCiAttemptFromEnvironment({
  values = process.env,
  fetchImplementation = fetch,
  sleepImplementation = defaultSleep,
  signal,
} = {}) {
  return publishResult(
    values,
    await admitMainCiAttempt({
      eventPayload: environmentEventPayload(values),
      deploySha: values.DEPLOY_SHA,
      token: values.GITHUB_TOKEN,
      ownRunId: environmentInteger(values.GITHUB_RUN_ID, "GITHUB_RUN_ID"),
      apiUrl: values.GITHUB_API_URL ?? GITHUB_API_ORIGIN,
      fetchImplementation,
      sleepImplementation,
      signal,
    }),
  );
}

export async function requireMainCiSuccessFromEnvironment({
  values = process.env,
  fetchImplementation = fetch,
  sleepImplementation = defaultSleep,
  nowImplementation = Date.now,
  signal,
} = {}) {
  return publishResult(
    values,
    await requireMainCiSuccess({
      eventPayload: environmentEventPayload(values),
      deploySha: values.DEPLOY_SHA,
      upstreamRunId: environmentInteger(
        values.UPSTREAM_RUN_ID,
        "UPSTREAM_RUN_ID",
      ),
      upstreamRunAttempt: environmentInteger(
        values.UPSTREAM_RUN_ATTEMPT,
        "UPSTREAM_RUN_ATTEMPT",
      ),
      token: values.GITHUB_TOKEN,
      apiUrl: values.GITHUB_API_URL ?? GITHUB_API_ORIGIN,
      fetchImplementation,
      sleepImplementation,
      nowImplementation,
      signal,
    }),
  );
}

function isCliEntrypoint() {
  return (
    process.argv[1] !== undefined &&
    fileURLToPath(import.meta.url) === resolve(process.argv[1])
  );
}

if (isCliEntrypoint()) {
  const mode = process.argv[2];
  if (
    process.argv.length !== 3 ||
    (mode !== "admit" && mode !== "require-success")
  ) {
    throw new Error("Usage: vercel-main-ci-attempt.mjs admit|require-success");
  }
  if (mode === "admit") {
    await admitMainCiAttemptFromEnvironment();
    process.stdout.write("Admitted exact upstream CI attempt\n");
  } else {
    await requireMainCiSuccessFromEnvironment();
    process.stdout.write("Required exact successful upstream CI attempt\n");
  }
}
