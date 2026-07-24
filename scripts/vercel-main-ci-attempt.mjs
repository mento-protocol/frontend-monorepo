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

const GITHUB_API_ORIGIN = "https://api.github.com";
const GITHUB_WEB_ORIGIN = "https://github.com";
const GITHUB_API_VERSION = "2022-11-28";
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const MAX_EVENT_BYTES = 1024 * 1024;
const MAX_API_RESPONSE_BYTES = 4 * 1024 * 1024;
const JOBS_PER_PAGE = 100;
const MAX_JOB_PAGES = 10;
const MAX_JOBS = JOBS_PER_PAGE * MAX_JOB_PAGES;
const DEFAULT_REQUEST_ATTEMPTS = 3;
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_RETRY_DELAY_MS = 250;
const RETRYABLE_HTTP_STATUSES = new Set([408, 429]);

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

function validateRunIdentity(run, { deploySha, runId, runAttempt, label }) {
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
  exactString(run.status, "completed", `${label} status`);
  exactString(run.conclusion, "success", `${label} conclusion`);
  repositoryObject(run.repository, `${label} repository`);
  repositoryObject(run.head_repository, `${label} head repository`);
  exactString(run.url, canonicalRunApiUrl(runId), `${label} API URL`);
  exactString(run.html_url, canonicalRunWebUrl(runId), `${label} web URL`);
}

/**
 * Authenticate the workflow_run event before making any API request.
 *
 * @param {{ eventPayload: unknown, deploySha: string }} options
 */
export function validateMainCiWorkflowRunEvent({ eventPayload, deploySha }) {
  const expectedSha = exactSha(deploySha);
  const payload = plainObject(eventPayload, "GitHub event payload");
  exactString(payload.action, "completed", "GitHub event action");
  repositoryObject(payload.repository, "GitHub event repository");

  const run = plainObject(payload.workflow_run, "GitHub event workflow run");
  const runId = positiveInteger(run.id, "GitHub event workflow run ID");
  const runAttempt = positiveInteger(
    run.run_attempt,
    "GitHub event workflow run attempt",
  );
  validateRunIdentity(run, {
    deploySha: expectedSha,
    runId,
    runAttempt,
    label: "GitHub event workflow run",
  });

  return {
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
  invariant(
    typeof fetchImplementation === "function",
    "fetchImplementation must be a function",
  );
  invariant(
    typeof sleepImplementation === "function",
    "sleepImplementation must be a function",
  );
  const expected = validateMainCiWorkflowRunEvent({
    eventPayload,
    deploySha,
  });
  const requestOptions = {
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

  const run = await requestJson(
    `/repos/${MAIN_DEPLOYMENT_REPOSITORY}/actions/runs/${expected.runId}`,
    requestOptions,
  );
  validateMainCiRunRecord(run, expected);

  const jobs = await listMainCiAttemptJobs(expected, requestOptions);
  const sentinels = jobs.filter(
    (job) => job.name === MAIN_DEPLOYMENT_SENTINEL_JOB,
  );
  invariant(
    sentinels.length === 1,
    `Expected exactly one literal ${MAIN_DEPLOYMENT_SENTINEL_JOB} job in the exact upstream attempt`,
  );
  const [sentinel] = sentinels;
  invariant(
    sentinel.status === "completed" && sentinel.conclusion === "success",
    `${MAIN_DEPLOYMENT_SENTINEL_JOB} did not complete successfully in the exact upstream attempt`,
  );

  return Object.freeze({
    build_and_test_job_id: sentinel.id,
    build_and_test_job_url: canonicalJobWebUrl(expected.runId, sentinel.id),
    deploy_sha: expected.deploySha,
    upstream_run_attempt: expected.runAttempt,
    upstream_run_id: expected.runId,
    upstream_run_url: canonicalAttemptWebUrl(
      expected.runId,
      expected.runAttempt,
    ),
  });
}

export function formatMainCiAttemptSummary(result) {
  return [
    "### Verified upstream CI attempt",
    "",
    `- Upstream run ID: \`${result.upstream_run_id}\``,
    `- Upstream run attempt: \`${result.upstream_run_attempt}\``,
    `- Upstream run URL: ${result.upstream_run_url}`,
    `- Build and Test job ID: \`${result.build_and_test_job_id}\``,
    `- Build and Test job URL: ${result.build_and_test_job_url}`,
    `- DEPLOY_SHA: \`${result.deploy_sha}\``,
    "",
  ].join("\n");
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

export async function verifyMainCiAttemptFromEnvironment({
  values = process.env,
  fetchImplementation = fetch,
  sleepImplementation = defaultSleep,
  signal,
} = {}) {
  const eventPath = boundedString(
    values.GITHUB_EVENT_PATH,
    "GITHUB_EVENT_PATH",
    4_096,
  );
  const result = await verifyMainCiAttempt({
    eventPayload: readEventPayload(eventPath),
    deploySha: values.DEPLOY_SHA,
    token: values.GITHUB_TOKEN,
    apiUrl: values.GITHUB_API_URL ?? GITHUB_API_ORIGIN,
    fetchImplementation,
    sleepImplementation,
    signal,
  });
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

function isCliEntrypoint() {
  return (
    process.argv[1] !== undefined &&
    fileURLToPath(import.meta.url) === resolve(process.argv[1])
  );
}

if (isCliEntrypoint()) {
  if (process.argv[2] !== "verify" || process.argv.length !== 3) {
    throw new Error("Usage: vercel-main-ci-attempt.mjs verify");
  }
  await verifyMainCiAttemptFromEnvironment();
  process.stdout.write("Verified exact upstream CI attempt\n");
}
