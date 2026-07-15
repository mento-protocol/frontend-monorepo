#!/usr/bin/env node

/* eslint-disable turbo/no-undeclared-env-vars -- GitHub Actions supplies these controller-only values outside Turbo tasks. */

import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { resolve, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  assertPrebuiltDeploymentId,
  generateVercelDeploymentId,
} from "./vercel-prebuilt.mjs";

export const PILOT_TARGET = {
  logicalTarget: "ui",
  workspacePackage: "ui.mento.org",
  expectedRootDirectory: "apps/ui.mento.org",
  githubEnvironment: "vercel-preview-ui",
  vercelEnvironment: "preview",
  vercelTarget: "preview",
  deploymentMode: "preview",
};

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const VERCEL_DEPLOYMENT_ID_PATTERN = /^dpl_[A-Za-z0-9]+$/;
const UPLOAD_LOOKUP_ATTEMPTS = 3;
const UPLOAD_LOOKUP_DELAY_MS = 1_000;
const UPLOAD_LOOKUP_WINDOW_MS = 45 * 60 * 1_000;
const TRUSTED_CALLER_WORKFLOW = {
  "manual-pilot":
    "mento-protocol/frontend-monorepo/.github/workflows/vercel-prebuilt-pilot.yml@refs/heads/main",
  "preview-controller:v1":
    "mento-protocol/frontend-monorepo/.github/workflows/vercel-preview-worker.yml@refs/heads/main",
};
function requiredText(value, label, { maximum = 2_048 } = {}) {
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

export function validateExactSha(value) {
  if (typeof value !== "string" || !SHA_PATTERN.test(value)) {
    throw new Error("Commit SHA must be an immutable lowercase 40-digit SHA");
  }
  return value;
}

export function validateGitBranch(branch, run = spawnSync) {
  requiredText(branch, "Git branch");
  if (
    branch.startsWith("-") ||
    branch.startsWith("refs/") ||
    branch.trim() !== branch
  ) {
    throw new Error("Git branch is option-like or contains surrounding space");
  }
  const result = run("git", ["check-ref-format", "--branch", branch], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0)
    throw new Error("Git branch is not a valid branch ref");
  return branch;
}

function validateAutomaticPreviewIdentity(values) {
  const pr = String(values.pullRequestNumber ?? "");
  if (!/^[1-9][0-9]{0,9}$/.test(pr)) {
    throw new Error(
      "Automatic previews require a positive pull request number",
    );
  }
  if (values.githubEnvironment !== `preview/ui/pr-${pr}`) {
    throw new Error(
      "Automatic preview environment does not match the pull request",
    );
  }
  if (values.provenance !== "preview-controller:v1") {
    throw new Error("Automatic preview provenance is invalid");
  }
  if (
    values.idempotencyKey !==
    `vercel-preview:v1:pr:${pr}:target:ui:sha:${values.commitSha}`
  ) {
    throw new Error("Automatic preview idempotency key is invalid");
  }
}

function validatePrebuiltContract(values) {
  validateExactSha(values.commitSha);
  validateGitBranch(values.gitBranch);
  if (values.gitBranch.startsWith("dependabot/")) {
    throw new Error("Dependabot branches cannot receive preview credentials");
  }

  const expected = {
    logicalTarget: values.logicalTarget,
    workspacePackage: values.workspacePackage,
    expectedRootDirectory: values.expectedRootDirectory,
    vercelEnvironment: values.vercelEnvironment,
    vercelTarget: values.vercelTarget,
    deploymentMode: values.deploymentMode,
  };
  for (const [name, actual] of Object.entries(expected)) {
    if (actual !== PILOT_TARGET[name]) {
      throw new Error(
        `The UI prebuilt workflow requires ${name}=${PILOT_TARGET[name]}`,
      );
    }
  }
  if (values.deployPermitted !== "true" && values.deployPermitted !== true) {
    throw new Error("The caller did not permit this deployment");
  }
  if (values.githubRepository !== "mento-protocol/frontend-monorepo") {
    throw new Error(
      "The pilot may run only in mento-protocol/frontend-monorepo",
    );
  }
  if (values.githubEnvironment === PILOT_TARGET.githubEnvironment) {
    if (values.provenance !== "manual-pilot") {
      throw new Error("The manual pilot provenance is invalid");
    }
  } else {
    validateAutomaticPreviewIdentity(values);
  }
  if (values.githubRef !== "refs/heads/main") {
    throw new Error("The UI prebuilt workflow must be dispatched from main");
  }
  if (values.githubWorkflowRef !== TRUSTED_CALLER_WORKFLOW[values.provenance]) {
    throw new Error("The UI prebuilt caller is not the trusted main workflow");
  }
  requiredText(values.vercelOrgId, "Vercel organization ID");
  requiredText(values.vercelProjectId, "Vercel project ID");
  requiredText(values.idempotencyKey, "Deployment idempotency key");
  requiredText(values.workflowRunUrl, "Workflow run URL");
  return values;
}

// Keep the original public name while the manual pilot remains a supported caller.
export function validatePilotContract(values) {
  return validatePrebuiltContract(values);
}

function git(repoRoot, arguments_, run = spawnSync) {
  return run("git", ["-C", repoRoot, ...arguments_], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function requireGitSuccess(result, message) {
  if (result.status !== 0) throw new Error(message);
  return result.stdout.trim();
}

function remoteMatchesRepository(remoteUrl, repository) {
  const escaped = repository.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `^(?:https://github\\.com/|git@github\\.com:|ssh://git@github\\.com/)?${escaped}(?:\\.git)?/?$`,
  ).test(remoteUrl);
}

export function validateSourceCheckout({
  repoRoot,
  commitSha,
  gitBranch,
  githubRepository,
  run = spawnSync,
}) {
  const sha = validateExactSha(commitSha);
  const branch = validateGitBranch(gitBranch, run);
  const head = requireGitSuccess(
    git(repoRoot, ["rev-parse", "--verify", "HEAD^{commit}"], run),
    "Unable to resolve the checked-out commit",
  );
  if (head !== sha)
    throw new Error("Checked-out HEAD does not match commit_sha");

  const remote = requireGitSuccess(
    git(repoRoot, ["remote", "get-url", "origin"], run),
    "Unable to resolve the origin remote",
  );
  if (!remoteMatchesRepository(remote, githubRepository)) {
    throw new Error("Origin is not the expected same-repository GitHub remote");
  }

  requireGitSuccess(
    git(
      repoRoot,
      [
        "fetch",
        "--force",
        "--no-tags",
        "origin",
        `refs/heads/${branch}:refs/remotes/origin/${branch}`,
      ],
      run,
    ),
    "The requested same-repository branch does not exist",
  );
  requireGitSuccess(
    git(
      repoRoot,
      ["merge-base", "--is-ancestor", sha, `refs/remotes/origin/${branch}`],
      run,
    ),
    "commit_sha is not reachable from git_branch",
  );
  return { commitSha: head, gitBranch: branch };
}

export function buildVercelPullArguments({ gitBranch, projectId }) {
  validateGitBranch(gitBranch);
  return [
    "pull",
    "--yes",
    "--environment",
    "preview",
    "--git-branch",
    gitBranch,
    "--project",
    requiredText(projectId, "Vercel project ID"),
  ];
}

export function buildVercelBuildArguments({ projectId }) {
  return [
    "build",
    "--yes",
    "--target",
    "preview",
    "--project",
    requiredText(projectId, "Vercel project ID"),
  ];
}

export function buildVercelDeployArguments({
  projectId,
  commitSha,
  gitBranch,
  idempotencyKey,
}) {
  const sha = validateExactSha(commitSha);
  const branch = validateGitBranch(gitBranch);
  const controllerKey = requiredText(
    idempotencyKey,
    "Deployment idempotency key",
    { maximum: 255 },
  );
  const arguments_ = [
    "deploy",
    "--prebuilt",
    "--target",
    "preview",
    "--archive=tgz",
    "--format=json",
    "--yes",
    "--project",
    requiredText(projectId, "Vercel project ID"),
    "--meta",
    "githubCommitOrg=mento-protocol",
    "--meta",
    "githubCommitRepo=frontend-monorepo",
    "--meta",
    `githubCommitSha=${sha}`,
    "--meta",
    `githubCommitRef=${branch}`,
    "--meta",
    `mentoControllerKey=${controllerKey}`,
  ];
  assertSafeVercelArguments(arguments_);
  return arguments_;
}

export function buildVercelInspectArguments(deploymentUrl, vercelOrgId) {
  return [
    "inspect",
    immutableVercelUrl(deploymentUrl),
    "--wait",
    "--timeout",
    "5m",
    "--format=json",
    "--scope",
    requiredText(vercelOrgId, "Vercel organization ID"),
  ];
}

export function assertSafeVercelArguments(arguments_) {
  if (arguments_[0] === "promote") {
    throw new Error("Forbidden Vercel CLI command: promote");
  }
  for (const [index, argument] of arguments_.entries()) {
    if (argument === "--prod" || argument.startsWith("--prod=")) {
      throw new Error("Forbidden Vercel CLI flag: --prod");
    }
    if (argument === "--token" || argument.startsWith("--token=")) {
      throw new Error(
        "Vercel tokens must be passed only through the environment",
      );
    }
    const metadata =
      argument === "--meta"
        ? arguments_[index + 1]
        : argument.startsWith("--meta=")
          ? argument.slice("--meta=".length)
          : undefined;
    if (metadata?.split("=", 1)[0] === "githubDeployment") {
      throw new Error("Forbidden Vercel metadata key: githubDeployment");
    }
  }
  return arguments_;
}

function assertPlainDirectory(path, label) {
  if (!existsSync(path)) return;
  const entry = lstatSync(path);
  if (entry.isSymbolicLink() || !entry.isDirectory()) {
    throw new Error(`${label} must be a real directory`);
  }
}

function assertPlainFile(path, label) {
  if (!existsSync(path)) return;
  const entry = lstatSync(path);
  if (entry.isSymbolicLink() || !entry.isFile()) {
    throw new Error(`${label} must be a regular file`);
  }
}

export function materializeVercelRepoLink({
  repoRoot,
  expectedRootDirectory,
  vercelOrgId,
  vercelProjectId,
}) {
  requiredText(repoRoot, "Source path");
  if (expectedRootDirectory !== PILOT_TARGET.expectedRootDirectory) {
    throw new Error("The repo link must target the UI project Root Directory");
  }
  const link = {
    remoteName: "origin",
    projects: [
      {
        id: requiredText(vercelProjectId, "Vercel project ID"),
        directory: expectedRootDirectory,
        orgId: requiredText(vercelOrgId, "Vercel organization ID"),
      },
    ],
  };
  const vercelDirectory = join(repoRoot, ".vercel");
  assertPlainDirectory(vercelDirectory, "Repo-level Vercel state");
  mkdirSync(vercelDirectory, { recursive: true });
  const linkPath = join(vercelDirectory, "repo.json");
  assertPlainFile(linkPath, "Repo-level Vercel link");
  writeFileSync(linkPath, `${JSON.stringify(link, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  return link;
}

export function environmentForVercelCli(environment) {
  const cliEnvironment = { ...environment };
  // CLI 56.2.0 gives these variables precedence over repo.json and would lose
  // the monorepo Root Directory mapping. The controller has already validated
  // the IDs and materialized them in the trusted repo link.
  delete cliEnvironment.VERCEL_ORG_ID;
  delete cliEnvironment.VERCEL_PROJECT_ID;
  return cliEnvironment;
}

function immutableVercelUrl(value) {
  const withProtocol = value?.startsWith("http") ? value : `https://${value}`;
  let parsed;
  try {
    parsed = new URL(withProtocol);
  } catch {
    throw new Error("Vercel returned an invalid deployment URL");
  }
  if (
    parsed.protocol !== "https:" ||
    !parsed.hostname.endsWith(".vercel.app") ||
    parsed.username ||
    parsed.password
  ) {
    throw new Error("Vercel returned a non-immutable or non-HTTPS preview URL");
  }
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

export function parseVercelDeploymentJson(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Vercel deploy returned invalid JSON");
  }
  if (parsed?.status && parsed.status !== "ok") {
    throw new Error("Vercel deploy did not report a successful upload");
  }
  const deployment = parsed?.deployment ?? parsed;
  if (
    !deployment ||
    !VERCEL_DEPLOYMENT_ID_PATTERN.test(String(deployment.id ?? ""))
  ) {
    throw new Error("Vercel deploy returned no valid deployment ID");
  }
  return {
    deploymentId: deployment.id,
    deploymentUrl: immutableVercelUrl(deployment.url),
    readyState: deployment.readyState,
    target: deployment.target,
  };
}

function uploadMetadata({ commitSha, gitBranch, idempotencyKey }) {
  return {
    githubCommitOrg: "mento-protocol",
    githubCommitRepo: "frontend-monorepo",
    githubCommitSha: validateExactSha(commitSha),
    githubCommitRef: validateGitBranch(gitBranch),
    mentoControllerKey: requiredText(
      idempotencyKey,
      "Deployment idempotency key",
      { maximum: 255 },
    ),
  };
}

function uploadLookupWindow(startedAtMs, nowMs) {
  const started = Number(startedAtMs);
  const now = Number(nowMs);
  if (
    !Number.isSafeInteger(started) ||
    !Number.isSafeInteger(now) ||
    started <= 0 ||
    now <= 0 ||
    started > now + 60_000 ||
    now - started > UPLOAD_LOOKUP_WINDOW_MS
  ) {
    throw new Error("Vercel upload lookup window is invalid or unbounded");
  }
  return {
    since: Math.max(0, started - 60_000),
    until: now + 60_000,
  };
}

export function buildVercelDeploymentLookupUrl({
  projectId,
  vercelOrgId,
  commitSha,
  gitBranch,
  idempotencyKey,
  startedAtMs,
  nowMs = Date.now(),
}) {
  const metadata = uploadMetadata({ commitSha, gitBranch, idempotencyKey });
  const window = uploadLookupWindow(startedAtMs, nowMs);
  const query = new URLSearchParams({
    projectId: requiredText(projectId, "Vercel project ID"),
    teamId: requiredText(vercelOrgId, "Vercel organization ID"),
    target: "preview",
    limit: "2",
    since: String(window.since),
    until: String(window.until),
  });
  for (const [name, value] of Object.entries(metadata)) {
    query.set(`meta-${name}`, value);
  }
  return `https://api.vercel.com/v6/deployments?${query}`;
}

export function parseVercelDeploymentLookup(
  raw,
  {
    projectId,
    commitSha,
    gitBranch,
    idempotencyKey,
    startedAtMs,
    nowMs = Date.now(),
  },
) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Vercel deployment lookup returned invalid JSON");
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    !Array.isArray(parsed.deployments) ||
    parsed.deployments.length > 2
  ) {
    throw new Error("Vercel deployment lookup response is malformed");
  }
  const metadata = uploadMetadata({ commitSha, gitBranch, idempotencyKey });
  const window = uploadLookupWindow(startedAtMs, nowMs);
  return parsed.deployments.map((deployment) => {
    if (
      !deployment ||
      typeof deployment !== "object" ||
      Array.isArray(deployment) ||
      deployment.projectId !== projectId ||
      !Number.isSafeInteger(deployment.createdAt) ||
      deployment.createdAt < window.since ||
      deployment.createdAt > window.until ||
      (deployment.target !== null &&
        deployment.target !== undefined &&
        deployment.target !== "preview") ||
      !deployment.meta ||
      typeof deployment.meta !== "object" ||
      Object.entries(metadata).some(
        ([name, value]) => deployment.meta[name] !== value,
      )
    ) {
      throw new Error(
        "Vercel deployment lookup result does not match the exact upload tuple",
      );
    }
    return parseVercelDeploymentJson(
      JSON.stringify({
        id: deployment.id,
        url: deployment.url,
        readyState: deployment.readyState,
        target: "preview",
      }),
    );
  });
}

async function boundedUploadLookup({ lookup, waitForRetry }) {
  for (let attempt = 0; attempt < UPLOAD_LOOKUP_ATTEMPTS; attempt += 1) {
    const matches = normalizeUploadLookupMatches(await lookup());
    if (!Array.isArray(matches) || matches.length > 2) {
      throw new Error("Vercel deployment lookup is indeterminate");
    }
    if (matches.length > 0) return matches;
    if (attempt < UPLOAD_LOOKUP_ATTEMPTS - 1) {
      await waitForRetry(UPLOAD_LOOKUP_DELAY_MS);
    }
  }
  return [];
}

function normalizeUploadLookupMatches(matches) {
  if (!Array.isArray(matches) || matches.length > 2) {
    throw new Error("Vercel deployment lookup is indeterminate");
  }
  return matches.map((match) =>
    parseVercelDeploymentJson(
      JSON.stringify({
        id: match?.deploymentId,
        url: match?.deploymentUrl,
        readyState: match?.readyState,
        target: match?.target,
      }),
    ),
  );
}

async function collectRetriedUploadObservations({ lookup, waitForRetry }) {
  const observations = [];
  for (let attempt = 0; attempt < UPLOAD_LOOKUP_ATTEMPTS; attempt += 1) {
    observations.push(normalizeUploadLookupMatches(await lookup()));
    if (attempt < UPLOAD_LOOKUP_ATTEMPTS - 1) {
      await waitForRetry(UPLOAD_LOOKUP_DELAY_MS);
    }
  }
  return observations;
}

function reconcileRetriedUpload(reported, observations) {
  const identities = new Map();
  let becameVisible = false;
  let disappearedAfterVisibility = false;
  for (const matches of observations) {
    if (matches.length === 0) {
      if (becameVisible) disappearedAfterVisibility = true;
      continue;
    }
    becameVisible = true;
    for (const match of matches) {
      identities.set(`${match.deploymentId}\n${match.deploymentUrl}`, match);
    }
  }
  if (identities.size > 1) {
    throw new Error(
      "Retried Vercel upload converged on multiple deployment identities",
    );
  }
  if (disappearedAfterVisibility) {
    throw new Error(
      "Retried Vercel upload lookup did not converge monotonically",
    );
  }
  if (identities.size !== 1) {
    throw new Error(
      "Retried Vercel upload has no uniquely matching deployment",
    );
  }
  if (!reported) {
    throw new Error("Retried Vercel upload result is indeterminate");
  }
  const [matched] = identities.values();
  if (
    reported.deploymentId !== matched.deploymentId ||
    reported.deploymentUrl !== matched.deploymentUrl
  ) {
    throw new Error(
      "Retried upload conflicts with the converged Vercel deployment",
    );
  }
  return matched;
}

export async function deployWithAmbiguityRecovery({
  runUpload,
  lookup,
  waitForRetry = (milliseconds) =>
    new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds)),
}) {
  for (let uploadAttempt = 0; uploadAttempt < 2; uploadAttempt += 1) {
    let execution;
    try {
      execution = await runUpload();
    } catch {
      execution = { status: null, stdout: "" };
    }
    let reported = null;
    if (execution?.status === 0) {
      try {
        reported = parseVercelDeploymentJson(execution.stdout);
      } catch {
        reported = null;
      }
    }
    if (reported && uploadAttempt === 0) return reported;

    if (uploadAttempt === 1) {
      const observations = await collectRetriedUploadObservations({
        lookup,
        waitForRetry,
      });
      return reconcileRetriedUpload(reported, observations);
    }

    const matches = await boundedUploadLookup({ lookup, waitForRetry });
    if (matches.length > 1) {
      throw new Error("Multiple Vercel deployments match one controller key");
    }
    if (matches.length === 1) return matches[0];
  }
  throw new Error("Vercel upload reconciliation did not converge");
}

export async function queryVercelDeployments({
  token,
  fetchImplementation = fetch,
  ...lookup
}) {
  const response = await fetchImplementation(
    buildVercelDeploymentLookupUrl(lookup),
    {
      headers: {
        authorization: `Bearer ${requiredText(token, "Vercel token")}`,
      },
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!response?.ok) {
    throw new Error("Vercel deployment lookup request failed");
  }
  const raw = await response.text();
  if (raw.length > 1_000_000) {
    throw new Error("Vercel deployment lookup response is too large");
  }
  return parseVercelDeploymentLookup(raw, lookup);
}

export function assertVercelInspection(raw, { deploymentId, deploymentUrl }) {
  let inspection;
  try {
    inspection = JSON.parse(raw);
  } catch {
    throw new Error("Vercel inspect returned invalid JSON");
  }
  if (
    inspection.id !== deploymentId ||
    immutableVercelUrl(inspection.url) !== immutableVercelUrl(deploymentUrl) ||
    inspection.readyState !== "READY" ||
    inspection.target !== "preview"
  ) {
    throw new Error(
      "Vercel inspection does not match the expected ready preview",
    );
  }
  return inspection;
}

export function assertPulledProject({
  repoRoot,
  expectedRootDirectory,
  vercelOrgId,
  vercelProjectId,
}) {
  const repoLinkPath = join(repoRoot, ".vercel", "repo.json");
  const settingsPath = join(
    repoRoot,
    expectedRootDirectory,
    ".vercel",
    "project.json",
  );
  let repoLink;
  let project;
  try {
    repoLink = JSON.parse(readFileSync(repoLinkPath, "utf8"));
    project = JSON.parse(readFileSync(settingsPath, "utf8"));
  } catch {
    throw new Error("Vercel pull did not materialize valid project settings");
  }
  const linkedProject = repoLink.projects?.[0];
  if (
    repoLink.remoteName !== "origin" ||
    repoLink.projects?.length !== 1 ||
    linkedProject?.orgId !== vercelOrgId ||
    linkedProject?.id !== vercelProjectId ||
    linkedProject?.directory !== expectedRootDirectory ||
    project.settings?.rootDirectory !== expectedRootDirectory
  ) {
    throw new Error(
      "Pulled Vercel project mapping does not match the UI target",
    );
  }
  return project;
}

export function assertPrebuiltOutput({
  repoRoot,
  expectedRootDirectory,
  deploymentId,
}) {
  const outputDirectory = join(
    repoRoot,
    expectedRootDirectory,
    ".vercel",
    "output",
  );
  const configPath = join(outputDirectory, "config.json");
  if (!statSync(configPath).isFile()) {
    throw new Error("Prebuilt output config is not a file");
  }
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  if (config.version !== 3) {
    throw new Error("Prebuilt output is not Build Output API version 3");
  }
  let buildRecord;
  try {
    buildRecord = JSON.parse(
      readFileSync(join(outputDirectory, "builds.json"), "utf8"),
    );
  } catch {
    throw new Error("Prebuilt output is missing its Vercel CLI build record");
  }
  if (buildRecord.target !== "preview" || buildRecord.cliVersion !== "56.2.0") {
    throw new Error(
      "Prebuilt output target or pinned Vercel CLI version is invalid",
    );
  }
  assertPrebuiltDeploymentId(outputDirectory, deploymentId);
  return outputDirectory;
}

function requireHeader(response, name, expected) {
  const value = response.headers.get(name);
  if (
    expected instanceof RegExp
      ? !expected.test(value ?? "")
      : value !== expected
  ) {
    throw new Error(`Preview response has an invalid ${name} header`);
  }
}

function successfulText(response, body, label) {
  if (!response.ok)
    throw new Error(`${label} returned HTTP ${response.status}`);
  if (typeof body !== "string") {
    throw new Error(`${label} returned an invalid body`);
  }
  return body;
}

async function fetchWithTimeout({
  fetchImplementation,
  url,
  options,
  bodyType,
  label,
  timeoutMs,
}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    throw new Error("Preview smoke request timeout is invalid");
  }
  const controller = new AbortController();
  let timeout;
  try {
    const request = (async () => {
      const response = await fetchImplementation(url, {
        ...options,
        signal: controller.signal,
      });
      if (!response.ok) return { response, body: undefined };
      const body =
        bodyType === "text"
          ? await response.text()
          : await response.arrayBuffer();
      return { response, body };
    })();
    return await Promise.race([
      request,
      new Promise((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new Error(`${label} timed out`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

export async function smokeUiPreview({
  deploymentUrl,
  deploymentId,
  fetchImplementation = fetch,
  requestTimeoutMs = 15_000,
}) {
  const baseUrl = immutableVercelUrl(deploymentUrl);
  const { response: mainResponse, body: mainBody } = await fetchWithTimeout({
    fetchImplementation,
    url: baseUrl,
    options: { redirect: "follow" },
    bodyType: "text",
    label: "UI preview",
    timeoutMs: requestTimeoutMs,
  });
  const html = successfulText(mainResponse, mainBody, "UI preview");
  if (!html.includes("Basic Components")) {
    throw new Error("UI preview did not render the Basic Components page");
  }
  if (!html.includes(`data-dpl-id="${deploymentId}"`)) {
    throw new Error(
      "UI preview HTML does not carry the expected build deployment ID",
    );
  }
  requireHeader(
    mainResponse,
    "content-security-policy",
    "frame-ancestors 'none'",
  );
  requireHeader(mainResponse, "x-frame-options", "DENY");
  requireHeader(mainResponse, "x-content-type-options", "nosniff");
  requireHeader(
    mainResponse,
    "content-security-policy-report-only",
    /https:\/\/vercel\.live/,
  );

  const { response: navigationResponse, body: navigationBody } =
    await fetchWithTimeout({
      fetchImplementation,
      url: new URL("/form-components", baseUrl),
      options: { redirect: "follow" },
      bodyType: "text",
      label: "UI preview navigation",
      timeoutMs: requestTimeoutMs,
    });
  const navigationHtml = successfulText(
    navigationResponse,
    navigationBody,
    "UI preview navigation",
  );
  if (!navigationHtml.includes("Form Components")) {
    throw new Error("UI preview primary navigation destination did not render");
  }

  const assets = [
    ...html.matchAll(/(?:src|href)="([^" ]*\/_next\/static\/[^" ]+)"/g),
  ].map((match) => match[1].replaceAll("&amp;", "&"));
  const representatives = [".js", ".css", ".woff2"].map((extension) =>
    assets.find((asset) =>
      new URL(asset, baseUrl).pathname.endsWith(extension),
    ),
  );
  if (representatives.some((asset) => asset === undefined)) {
    throw new Error(
      "UI preview HTML is missing script, stylesheet, or font assets",
    );
  }
  for (const asset of representatives) {
    const { response } = await fetchWithTimeout({
      fetchImplementation,
      url: new URL(asset, baseUrl),
      options: { redirect: "follow" },
      bodyType: "bytes",
      label: "UI preview static asset",
      timeoutMs: requestTimeoutMs,
    });
    if (!response.ok) {
      throw new Error(
        `UI preview static asset returned HTTP ${response.status}`,
      );
    }
  }
  return {
    deploymentUrl: baseUrl,
    deploymentId,
    checkedAssets: representatives.length,
  };
}

function output(name, value) {
  if (!process.env.GITHUB_OUTPUT) throw new Error("GITHUB_OUTPUT is required");
  appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

function contractFromEnvironment() {
  return {
    logicalTarget: process.env.LOGICAL_TARGET,
    workspacePackage: process.env.WORKSPACE_PACKAGE,
    expectedRootDirectory: process.env.EXPECTED_ROOT_DIRECTORY,
    githubEnvironment: process.env.GITHUB_DEPLOYMENT_ENVIRONMENT,
    vercelEnvironment: process.env.VERCEL_ENVIRONMENT,
    vercelTarget: process.env.VERCEL_TARGET,
    deploymentMode: process.env.DEPLOYMENT_MODE,
    deployPermitted: process.env.DEPLOY_PERMITTED,
    commitSha: process.env.DEPLOY_SHA,
    gitBranch: process.env.GIT_BRANCH,
    vercelOrgId: process.env.VERCEL_ORG_ID,
    vercelProjectId: process.env.VERCEL_PROJECT_ID,
    idempotencyKey: process.env.DEPLOYMENT_IDEMPOTENCY_KEY,
    pullRequestNumber: process.env.PULL_REQUEST_NUMBER,
    provenance: process.env.DEPLOYMENT_PROVENANCE,
    workflowRunUrl: process.env.WORKFLOW_RUN_URL,
    githubRepository: process.env.GITHUB_REPOSITORY,
    githubRef: process.env.GITHUB_EVENT_REF,
    githubWorkflowRef: process.env.GITHUB_WORKFLOW_DEFINITION,
  };
}

function requiredEnvironment(names) {
  for (const name of names) requiredText(process.env[name], name);
}

function executeVercel(arguments_, { capture = false } = {}) {
  assertSafeVercelArguments(arguments_);
  requiredEnvironment(["VERCEL_TOKEN", "VERCEL_ORG_ID", "VERCEL_PROJECT_ID"]);
  return spawnSync("pnpm", ["exec", "vercel", ...arguments_], {
    cwd: process.env.SOURCE_PATH,
    env: environmentForVercelCli(process.env),
    encoding: "utf8",
    stdio: capture
      ? ["ignore", "pipe", "inherit"]
      : ["inherit", "inherit", "inherit"],
  });
}

function runVercel(arguments_, { capture = false } = {}) {
  const result = executeVercel(arguments_, { capture });
  if (result.status !== 0) {
    throw new Error(`Pinned Vercel CLI command failed: ${arguments_[0]}`);
  }
  return capture ? result.stdout : "";
}

function prepareFromEnvironment() {
  validatePrebuiltContract(contractFromEnvironment());
  const deploymentId = generateVercelDeploymentId({
    target: process.env.LOGICAL_TARGET,
    commitSha: process.env.DEPLOY_SHA,
    runId: process.env.GITHUB_RUN_ID,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT,
  });
  output("checked_out_sha", process.env.DEPLOY_SHA);
  output("next_deployment_id", deploymentId);
  output("started_at_ms", String(Date.now()));
}

function validateSourceFromEnvironment() {
  const result = validateSourceCheckout({
    repoRoot: process.env.SOURCE_PATH,
    commitSha: process.env.DEPLOY_SHA,
    gitBranch: process.env.GIT_BRANCH,
    githubRepository: process.env.GITHUB_REPOSITORY,
  });
  output("checked_out_sha", result.commitSha);
}

function pullFromEnvironment() {
  runVercel(
    buildVercelPullArguments({
      gitBranch: process.env.GIT_BRANCH,
      projectId: process.env.VERCEL_PROJECT_ID,
    }),
  );
}

function prepareLinkFromEnvironment() {
  materializeVercelRepoLink({
    repoRoot: process.env.SOURCE_PATH,
    expectedRootDirectory: process.env.EXPECTED_ROOT_DIRECTORY,
    vercelOrgId: process.env.VERCEL_ORG_ID,
    vercelProjectId: process.env.VERCEL_PROJECT_ID,
  });
}

function validatePullFromEnvironment() {
  assertPulledProject({
    repoRoot: process.env.SOURCE_PATH,
    expectedRootDirectory: process.env.EXPECTED_ROOT_DIRECTORY,
    vercelOrgId: process.env.VERCEL_ORG_ID,
    vercelProjectId: process.env.VERCEL_PROJECT_ID,
  });
}

function buildFromEnvironment() {
  requiredEnvironment([
    "TURBO_TEAM",
    "TURBO_TOKEN",
    "TURBO_REMOTE_CACHE_SIGNATURE_KEY",
    "MENTO_NEXT_DEPLOYMENT_ID",
  ]);
  const started = Date.now();
  runVercel(
    buildVercelBuildArguments({ projectId: process.env.VERCEL_PROJECT_ID }),
  );
  output("build_duration_ms", String(Date.now() - started));
}

function assertOutputFromEnvironment() {
  assertPrebuiltOutput({
    repoRoot: process.env.SOURCE_PATH,
    expectedRootDirectory: process.env.EXPECTED_ROOT_DIRECTORY,
    deploymentId: process.env.MENTO_NEXT_DEPLOYMENT_ID,
  });
}

async function deployFromEnvironment() {
  const started = Date.now();
  requiredEnvironment([
    "DEPLOYMENT_IDEMPOTENCY_KEY",
    "STARTED_AT_MS",
    "VERCEL_TOKEN",
    "VERCEL_ORG_ID",
    "VERCEL_PROJECT_ID",
  ]);
  const lookup = {
    projectId: process.env.VERCEL_PROJECT_ID,
    vercelOrgId: process.env.VERCEL_ORG_ID,
    commitSha: process.env.DEPLOY_SHA,
    gitBranch: process.env.GIT_BRANCH,
    idempotencyKey: process.env.DEPLOYMENT_IDEMPOTENCY_KEY,
    startedAtMs: process.env.STARTED_AT_MS,
  };
  const arguments_ = buildVercelDeployArguments({
    projectId: lookup.projectId,
    commitSha: lookup.commitSha,
    gitBranch: lookup.gitBranch,
    idempotencyKey: lookup.idempotencyKey,
  });
  const deployment = await deployWithAmbiguityRecovery({
    runUpload: async () => {
      const result = executeVercel(arguments_, { capture: true });
      return { status: result.status, stdout: result.stdout ?? "" };
    },
    lookup: () =>
      queryVercelDeployments({
        ...lookup,
        token: process.env.VERCEL_TOKEN,
      }),
  });
  output("vercel_deployment_id", deployment.deploymentId);
  output("vercel_deployment_url", deployment.deploymentUrl);
  output("deploy_duration_ms", String(Date.now() - started));
}

function verifyFromEnvironment() {
  const raw = runVercel(
    buildVercelInspectArguments(
      process.env.VERCEL_DEPLOYMENT_URL,
      process.env.VERCEL_ORG_ID,
    ),
    { capture: true },
  );
  assertVercelInspection(raw, {
    deploymentId: process.env.VERCEL_DEPLOYMENT_ID,
    deploymentUrl: process.env.VERCEL_DEPLOYMENT_URL,
  });
  output("verified_deployment_id", process.env.VERCEL_DEPLOYMENT_ID);
  output(
    "verified_deployment_url",
    immutableVercelUrl(process.env.VERCEL_DEPLOYMENT_URL),
  );
}

async function smokeFromEnvironment() {
  if (!/^[1-9][0-9]*$/.test(process.env.GITHUB_DEPLOYMENT_ID ?? "")) {
    throw new Error("Smoke requires the canonical GitHub Deployment ID");
  }
  const result = await smokeUiPreview({
    deploymentUrl: process.env.VERCEL_DEPLOYMENT_URL,
    deploymentId: process.env.MENTO_NEXT_DEPLOYMENT_ID,
  });
  output("smoke_deployment_url", result.deploymentUrl);
  output("smoke_deployment_id", process.env.VERCEL_DEPLOYMENT_ID);
  output("smoke_github_deployment_id", process.env.GITHUB_DEPLOYMENT_ID);
  output("smoke_commit_sha", process.env.DEPLOY_SHA);
}

function totalFromEnvironment() {
  if (!/^[0-9]+$/.test(process.env.STARTED_AT_MS ?? "")) {
    throw new Error("Workflow start time is invalid");
  }
  output(
    "total_duration_ms",
    String(Date.now() - Number(process.env.STARTED_AT_MS)),
  );
}

function isCliEntrypoint() {
  return (
    process.argv[1] !== undefined &&
    fileURLToPath(import.meta.url) === resolve(process.argv[1])
  );
}

if (isCliEntrypoint()) {
  const command = process.argv[2];
  if (command === "prepare") prepareFromEnvironment();
  else if (command === "validate-source") validateSourceFromEnvironment();
  else if (command === "prepare-link") prepareLinkFromEnvironment();
  else if (command === "pull") pullFromEnvironment();
  else if (command === "validate-pull") validatePullFromEnvironment();
  else if (command === "build") buildFromEnvironment();
  else if (command === "assert-output") assertOutputFromEnvironment();
  else if (command === "deploy") await deployFromEnvironment();
  else if (command === "verify") verifyFromEnvironment();
  else if (command === "smoke") await smokeFromEnvironment();
  else if (command === "total") totalFromEnvironment();
  else {
    throw new Error(
      "Usage: vercel-prebuilt-workflow.mjs prepare|validate-source|prepare-link|pull|validate-pull|build|assert-output|deploy|verify|smoke|total",
    );
  }
}
