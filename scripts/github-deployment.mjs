#!/usr/bin/env node

/* eslint-disable turbo/no-undeclared-env-vars -- GitHub Actions supplies these controller-only values outside Turbo tasks. */

import { appendFileSync } from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const CONTROLLER_SCHEMA = "mento-vercel-prebuilt/v1";
const DEPLOYMENT_STATES = [
  "queued",
  "in_progress",
  "success",
  "failure",
  "error",
];

const SHA_PATTERN = /^[0-9a-f]{40}$/;

function requiredText(value, label, { maximum = 255 } = {}) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum ||
    hasControlCharacters(value)
  ) {
    throw new Error(`${label} is missing or invalid`);
  }
  return value;
}

function hasControlCharacters(value) {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint <= 31 || codePoint === 127;
  });
}

function exactSha(value) {
  if (typeof value !== "string" || !SHA_PATTERN.test(value)) {
    throw new Error("Commit SHA must be an immutable lowercase 40-digit SHA");
  }
  return value;
}

function httpsUrl(value, label) {
  requiredText(value, label, { maximum: 2_048 });
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be an HTTPS URL`);
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new Error(`${label} must be an HTTPS URL without credentials`);
  }
  return parsed.toString();
}

function optionalPullRequestNumber(value) {
  if (value === undefined || value === null || value === "") return undefined;
  if (!/^[1-9][0-9]*$/.test(String(value))) {
    throw new Error("Pull request number must be a positive integer");
  }
  return Number(value);
}

function buildDeploymentPayload({
  idempotencyKey,
  logicalTarget,
  sha,
  gitRef,
  workflowRunUrl,
  pullRequestNumber,
  provenance,
}) {
  const payload = {
    controller_schema: CONTROLLER_SCHEMA,
    idempotency_key: requiredText(idempotencyKey, "Idempotency key"),
    logical_target: requiredText(logicalTarget, "Logical target", {
      maximum: 64,
    }),
    sha: exactSha(sha),
    git_ref: requiredText(gitRef, "Git ref"),
    workflow_run_url: httpsUrl(workflowRunUrl, "Workflow run URL"),
  };
  const prNumber = optionalPullRequestNumber(pullRequestNumber);
  if (prNumber !== undefined) payload.pull_request_number = prNumber;
  if (provenance !== undefined && provenance !== "") {
    payload.provenance = requiredText(provenance, "Provenance");
  }
  return payload;
}

export function buildCreateDeploymentRequest(options) {
  const environment = requiredText(
    options.environment,
    "Deployment environment",
  );
  return {
    ref: exactSha(options.sha),
    auto_merge: false,
    required_contexts: [],
    environment,
    transient_environment: true,
    production_environment: false,
    description: `Vercel prebuilt ${requiredText(
      options.logicalTarget,
      "Logical target",
      { maximum: 64 },
    )} preview`,
    payload: buildDeploymentPayload(options),
  };
}

function parsedPayload(value) {
  if (value && typeof value === "object") return value;
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function deploymentMatches(deployment, request) {
  const payload = parsedPayload(deployment?.payload);
  return (
    deployment?.sha === request.ref &&
    deployment?.environment === request.environment &&
    payload?.controller_schema === request.payload.controller_schema &&
    payload?.idempotency_key === request.payload.idempotency_key &&
    payload?.logical_target === request.payload.logical_target &&
    payload?.sha === request.payload.sha
  );
}

async function listEveryPage(api, { path, query }) {
  const results = [];
  for (let page = 1; ; page += 1) {
    const response = await api({
      method: "GET",
      path,
      query: page === 1 ? query : { ...query, page: String(page) },
    });
    if (!Array.isArray(response)) {
      throw new Error("GitHub paginated lookup returned an invalid response");
    }
    results.push(...response);
    if (response.length < Number(query.per_page)) return results;
  }
}

export async function ensureGitHubDeployment({ request, api }) {
  const existing = await listEveryPage(api, {
    path: "/deployments",
    query: {
      sha: request.ref,
      environment: request.environment,
      per_page: "100",
    },
  });
  const match = existing.find((deployment) =>
    deploymentMatches(deployment, request),
  );
  if (match) {
    return { deploymentId: String(match.id), reused: true };
  }

  const created = await api({
    method: "POST",
    path: "/deployments",
    body: request,
  });
  if (!created?.id) {
    throw new Error("GitHub deployment creation returned no deployment ID");
  }
  return { deploymentId: String(created.id), reused: false };
}

export function buildStatusRequest({
  state,
  environmentUrl,
  logUrl,
  description,
}) {
  if (!DEPLOYMENT_STATES.includes(state)) {
    throw new Error(`Unsupported GitHub deployment state: ${String(state)}`);
  }
  const request = {
    state,
    log_url: httpsUrl(logUrl, "Actions log URL"),
    description: requiredText(description, "Status description", {
      maximum: 140,
    }),
    auto_inactive: false,
  };
  if (environmentUrl) {
    request.environment_url = httpsUrl(
      environmentUrl,
      "Deployment environment URL",
    );
  }
  if (state === "success" && !request.environment_url) {
    throw new Error(
      "A successful deployment status requires an environment URL",
    );
  }
  if (state !== "success" && environmentUrl) {
    throw new Error("Only a successful status may publish an environment URL");
  }
  return request;
}

function statusMatches(status, request) {
  return (
    status?.state === request.state &&
    (status?.environment_url ?? null) === (request.environment_url ?? null) &&
    (status?.log_url ?? null) === request.log_url &&
    status?.description === request.description
  );
}

export async function ensureGitHubDeploymentStatus({
  deploymentId,
  request,
  api,
}) {
  if (!/^[1-9][0-9]*$/.test(String(deploymentId))) {
    throw new Error("GitHub deployment ID must be a positive integer");
  }
  const path = `/deployments/${deploymentId}/statuses`;
  const existing = await listEveryPage(api, {
    path,
    query: { per_page: "100" },
  });
  const match = existing.find((status) => statusMatches(status, request));
  if (match) return { statusId: String(match.id), reused: true };

  const created = await api({ method: "POST", path, body: request });
  if (!created?.id) {
    throw new Error("GitHub deployment status creation returned no status ID");
  }
  return { statusId: String(created.id), reused: false };
}

export function selectFinalDeploymentState({
  jobStatus,
  buildOutcome,
  deployOutcome,
  smokeOutcome,
}) {
  if (
    [buildOutcome, deployOutcome, smokeOutcome].some(
      (outcome) => outcome === "failure",
    )
  ) {
    return "failure";
  }
  if (jobStatus === "success") {
    throw new Error(
      "A successful job must post success after smoke, not finalize",
    );
  }
  return "error";
}

export function selectWorkflowDeploymentState({ prebuiltResult, smokeResult }) {
  const allowed = new Set(["success", "failure", "cancelled", "skipped"]);
  if (!allowed.has(prebuiltResult) || !allowed.has(smokeResult)) {
    throw new Error("Reusable workflow job result is invalid");
  }
  if (prebuiltResult === "success" && smokeResult === "success") {
    return "success";
  }
  if (prebuiltResult === "failure" || smokeResult === "failure") {
    return "failure";
  }
  return "error";
}

function createGitHubApi({
  token,
  apiUrl,
  repository,
  fetchImplementation = fetch,
}) {
  requiredText(token, "GitHub token", { maximum: 16_384 });
  const [owner, repo, ...extra] = requiredText(
    repository,
    "GitHub repository",
  ).split("/");
  if (!owner || !repo || extra.length > 0) {
    throw new Error("GitHub repository must be owner/name");
  }
  const baseUrl = new URL(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
    `${requiredText(apiUrl, "GitHub API URL")}/`,
  );

  return async ({ method, path, query, body }) => {
    const url = new URL(`${baseUrl.pathname}${path}`, baseUrl);
    for (const [name, value] of Object.entries(query ?? {})) {
      url.searchParams.set(name, value);
    }
    const response = await fetchImplementation(url, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) {
      throw new Error(
        `GitHub API ${method} ${path} failed (${response.status})`,
      );
    }
    return response.json();
  };
}

function appendOutput(name, value) {
  const output = process.env.GITHUB_OUTPUT;
  if (!output) throw new Error("GITHUB_OUTPUT is required");
  appendFileSync(output, `${name}=${value}\n`);
}

function environment(name) {
  return process.env[name];
}

function apiFromEnvironment() {
  return createGitHubApi({
    token: environment("GITHUB_TOKEN"),
    apiUrl: environment("GITHUB_API_URL") ?? "https://api.github.com",
    repository: environment("GITHUB_REPOSITORY"),
  });
}

async function ensureFromEnvironment() {
  const request = buildCreateDeploymentRequest({
    idempotencyKey: environment("DEPLOYMENT_IDEMPOTENCY_KEY"),
    logicalTarget: environment("LOGICAL_TARGET"),
    sha: environment("DEPLOY_SHA"),
    gitRef: environment("GIT_BRANCH"),
    workflowRunUrl: environment("WORKFLOW_RUN_URL"),
    pullRequestNumber: environment("PULL_REQUEST_NUMBER"),
    provenance: environment("DEPLOYMENT_PROVENANCE"),
    environment: environment("GITHUB_DEPLOYMENT_ENVIRONMENT"),
  });
  const result = await ensureGitHubDeployment({
    request,
    api: apiFromEnvironment(),
  });
  appendOutput("github_deployment_id", result.deploymentId);
  appendOutput("github_deployment_reused", String(result.reused));
}

function statusDescription(state) {
  const descriptions = {
    queued: "Prebuilt preview queued",
    in_progress: "Prebuilt preview build and verification running",
    success: "Prebuilt preview verified",
    failure: "Prebuilt preview build, deploy, or smoke failed",
    error: "Prebuilt preview controller or infrastructure error",
  };
  return descriptions[state];
}

async function statusFromEnvironment(stateOverride) {
  const state = stateOverride ?? environment("GITHUB_DEPLOYMENT_STATE");
  const request = buildStatusRequest({
    state,
    environmentUrl:
      state === "success" ? environment("VERCEL_DEPLOYMENT_URL") : undefined,
    logUrl: environment("WORKFLOW_RUN_URL"),
    description: statusDescription(state),
  });
  await ensureGitHubDeploymentStatus({
    deploymentId: environment("GITHUB_DEPLOYMENT_ID"),
    request,
    api: apiFromEnvironment(),
  });
  appendOutput("github_deployment_state", state);
}

async function finalizeFromEnvironment() {
  const state = selectFinalDeploymentState({
    jobStatus: environment("JOB_STATUS"),
    buildOutcome: environment("BUILD_OUTCOME"),
    deployOutcome: environment("DEPLOY_OUTCOME"),
    smokeOutcome: environment("SMOKE_OUTCOME"),
  });
  await statusFromEnvironment(state);
}

async function completeFromEnvironment() {
  const state = selectWorkflowDeploymentState({
    prebuiltResult: environment("PREBUILT_RESULT"),
    smokeResult: environment("SMOKE_RESULT"),
  });
  if (!/^[1-9][0-9]*$/.test(environment("GITHUB_DEPLOYMENT_ID") ?? "")) {
    appendOutput("github_deployment_state", "error");
    return;
  }
  await statusFromEnvironment(state);
  if (state === "success") {
    appendOutput(
      "verified_deployment_url",
      httpsUrl(environment("VERCEL_DEPLOYMENT_URL"), "Deployment URL"),
    );
  }
}

function isCliEntrypoint() {
  return (
    process.argv[1] !== undefined &&
    fileURLToPath(import.meta.url) === resolve(process.argv[1])
  );
}

if (isCliEntrypoint()) {
  const command = process.argv[2];
  if (command === "ensure") {
    await ensureFromEnvironment();
  } else if (command === "status") {
    await statusFromEnvironment();
  } else if (command === "finalize") {
    await finalizeFromEnvironment();
  } else if (command === "complete") {
    await completeFromEnvironment();
  } else {
    throw new Error(
      "Usage: github-deployment.mjs ensure|status|finalize|complete",
    );
  }
}
