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

export function validatePilotContract(values) {
  validateExactSha(values.commitSha);
  validateGitBranch(values.gitBranch);
  if (values.gitBranch.startsWith("dependabot/")) {
    throw new Error("Dependabot branches cannot receive preview credentials");
  }

  const expected = {
    logicalTarget: values.logicalTarget,
    workspacePackage: values.workspacePackage,
    expectedRootDirectory: values.expectedRootDirectory,
    githubEnvironment: values.githubEnvironment,
    vercelEnvironment: values.vercelEnvironment,
    vercelTarget: values.vercelTarget,
    deploymentMode: values.deploymentMode,
  };
  for (const [name, actual] of Object.entries(expected)) {
    if (actual !== PILOT_TARGET[name]) {
      throw new Error(
        `The manual pilot requires ${name}=${PILOT_TARGET[name]}`,
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
  requiredText(values.vercelOrgId, "Vercel organization ID");
  requiredText(values.vercelProjectId, "Vercel project ID");
  requiredText(values.idempotencyKey, "Deployment idempotency key");
  requiredText(values.workflowRunUrl, "Workflow run URL");
  return values;
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
}) {
  const sha = validateExactSha(commitSha);
  const branch = validateGitBranch(gitBranch);
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

async function successfulText(response, label) {
  if (!response.ok)
    throw new Error(`${label} returned HTTP ${response.status}`);
  return response.text();
}

export async function smokeUiPreview({
  deploymentUrl,
  deploymentId,
  fetchImplementation = fetch,
}) {
  const baseUrl = immutableVercelUrl(deploymentUrl);
  const mainResponse = await fetchImplementation(baseUrl, {
    redirect: "follow",
  });
  const html = await successfulText(mainResponse, "UI preview");
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

  const navigationResponse = await fetchImplementation(
    new URL("/form-components", baseUrl),
    { redirect: "follow" },
  );
  const navigationHtml = await successfulText(
    navigationResponse,
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
    const response = await fetchImplementation(new URL(asset, baseUrl), {
      redirect: "follow",
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
    workflowRunUrl: process.env.WORKFLOW_RUN_URL,
    githubRepository: process.env.GITHUB_REPOSITORY,
  };
}

function requiredEnvironment(names) {
  for (const name of names) requiredText(process.env[name], name);
}

function runVercel(arguments_, { capture = false } = {}) {
  assertSafeVercelArguments(arguments_);
  requiredEnvironment(["VERCEL_TOKEN", "VERCEL_ORG_ID", "VERCEL_PROJECT_ID"]);
  const result = spawnSync("pnpm", ["exec", "vercel", ...arguments_], {
    cwd: process.env.SOURCE_PATH,
    env: environmentForVercelCli(process.env),
    encoding: "utf8",
    stdio: capture
      ? ["ignore", "pipe", "inherit"]
      : ["inherit", "inherit", "inherit"],
  });
  if (result.status !== 0) {
    throw new Error(`Pinned Vercel CLI command failed: ${arguments_[0]}`);
  }
  return capture ? result.stdout : "";
}

function prepareFromEnvironment() {
  validatePilotContract(contractFromEnvironment());
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

function deployFromEnvironment() {
  const started = Date.now();
  const raw = runVercel(
    buildVercelDeployArguments({
      projectId: process.env.VERCEL_PROJECT_ID,
      commitSha: process.env.DEPLOY_SHA,
      gitBranch: process.env.GIT_BRANCH,
    }),
    { capture: true },
  );
  const deployment = parseVercelDeploymentJson(raw);
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
  else if (command === "deploy") deployFromEnvironment();
  else if (command === "verify") verifyFromEnvironment();
  else if (command === "smoke") await smokeFromEnvironment();
  else if (command === "total") totalFromEnvironment();
  else {
    throw new Error(
      "Usage: vercel-prebuilt-workflow.mjs prepare|validate-source|prepare-link|pull|validate-pull|build|assert-output|deploy|verify|smoke|total",
    );
  }
}
