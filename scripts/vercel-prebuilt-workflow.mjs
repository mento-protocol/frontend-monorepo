#!/usr/bin/env node

/* eslint-disable turbo/no-undeclared-env-vars -- GitHub Actions supplies these controller-only values outside Turbo tasks. */

import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  chmodSync,
  chownSync,
  closeSync,
  constants as fsConstants,
  copyFileSync,
  existsSync,
  fchmodSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readlinkSync,
  readSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  assertPrebuiltDeploymentId,
  generateVercelDeploymentId,
} from "./vercel-prebuilt.mjs";
import {
  assertVercelCliRuntimeContract,
  PINNED_VERCEL_CLI_VERSION,
} from "./vercel-cli-runtime-contract.mjs";
import {
  parseVercelPulledEnvironment,
  selectVercelPulledEnvironment,
  serializeVercelPulledEnvironment,
} from "./vercel-build-environment.mjs";
import {
  sharpRuntimePlatform,
  SHARP_RUNTIME_VERSION,
} from "./next-sharp-output-tracing.mjs";
import { PREVIEW_TARGET_CONFIG } from "./vercel-preview-targets.mjs";

export const PREBUILT_TARGETS = Object.freeze(
  Object.fromEntries(
    Object.entries(PREVIEW_TARGET_CONFIG).map(([target, configuration]) => [
      target,
      Object.freeze({
        logicalTarget: configuration.logicalTarget,
        workspacePackage: configuration.workspacePackage,
        expectedRootDirectory: configuration.expectedRootDirectory,
      }),
    ]),
  ),
);

// Preserve the Phase A manual pilot contract while the reusable internals are
// prepared for the four literal automatic-preview callers.
export const PILOT_TARGET = Object.freeze({
  ...PREBUILT_TARGETS.ui,
  githubEnvironment: "vercel-preview-ui",
  vercelEnvironment: "preview",
  vercelTarget: "preview",
  deploymentMode: "preview",
});

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const VERCEL_DEPLOYMENT_ID_PATTERN = /^dpl_[A-Za-z0-9]+$/;
const MAX_PREBUILT_CONFIG_BYTES = 1024 * 1024;
const MAX_PREBUILT_FILE_BYTES = 250 * 1024 * 1024;
const MAX_PREBUILT_TOTAL_BYTES = 1024 * 1024 * 1024;
const LIBVIPS_SHARED_LIBRARY_PATTERN =
  /^libvips-cpp(?:\.[0-9.]+)?\.(?:dylib|so)(?:\.[0-9.]+)?$/;
const VERCEL_CLI_BASE_ENVIRONMENT = [
  "CI",
  "FORCE_COLOR",
  "HOME",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "LANG",
  "LC_ALL",
  "NODE_EXTRA_CA_CERTS",
  "NO_PROXY",
  "PATH",
  "SSL_CERT_FILE",
  "TERM",
  "TMPDIR",
  "TZ",
  "http_proxy",
  "https_proxy",
  "no_proxy",
];
const PULL_STAGING_DIRECTORY = "mento-vercel-pull-staging";
const BUILD_ENVIRONMENT_DIRECTORY = "mento-vercel-build-environment";
const CANDIDATE_SOURCE_DIRECTORY = "mento-vercel-candidate-source";
const TRUSTED_TOOLS_DIRECTORY = "mento-vercel-trusted-tools";
const PNPM_BOOTSTRAP_DIRECTORY = "mento-vercel-pnpm-bootstrap";
const PNPM_RUNTIME_DIRECTORY = "pnpm-runtime";
const VERCEL_CLI_RUNTIME_DIRECTORY = "vercel-cli-runtime";
const PINNED_PNPM_VERSION = "10.34.4";
const PINNED_PNPM_BOOTSTRAP_LOCKFILE_SHA256 =
  "1f8083495d03d348edb41b529f266807173860558b346128ae63f29f2f331c4d";
const PINNED_PNPM_LINUX_X64_RESOLVED =
  "https://registry.npmjs.org/@pnpm/linux-x64/-/linux-x64-10.34.4.tgz";
const PINNED_PNPM_LINUX_X64_INTEGRITY =
  "sha512-6gsJT9HUs1kBsJANC5SEJNRGAMzjGMKgxEtCvPLYd7NIktbh1GH5Ktcu7nLYcbxX8SirCHHzhZiMolW0mvzoqA==";
const PINNED_PNPM_LINUX_X64_SHA256 =
  "e02c01738ce850754cf00111fd97bec24de550e1e963690486f02d9dae1a2193";
// Exact bytes of the one-importer JavaScript runtime lockfile. This pins the
// package identity, absence of custom tarball resolution, and sha512 integrity
// before the authenticated bootstrap installs anything from it.
const PINNED_PNPM_RUNTIME_LOCKFILE_SHA256 =
  "c0dbb0f05ade0e4a8db501e5eb25ebe3c2f2794feed1caec2cf4df6c4583715a";
const PULLED_ENVIRONMENT_FILE = ".env.preview.local";
const MAX_PULLED_ENVIRONMENT_BYTES = 16 * 1_024 * 1_024;
const MAX_SOURCE_ENTRIES = 20_000;
const MAX_SOURCE_PATH_BYTES = 4_096;
const MAX_SOURCE_BLOB_BYTES = 32 * 1_024 * 1_024;
const MAX_SOURCE_TREE_BYTES = 16 * 1_024 * 1_024;
const MAX_SOURCE_TOTAL_BYTES = 128 * 1_024 * 1_024;
const UPLOAD_LOOKUP_ATTEMPTS = 3;
const UPLOAD_LOOKUP_DELAY_MS = 1_000;
const UPLOAD_LOOKUP_WINDOW_MS = 45 * 60 * 1_000;
const TRUSTED_CALLER_WORKFLOW = {
  "manual-pilot":
    "mento-protocol/frontend-monorepo/.github/workflows/vercel-prebuilt-pilot.yml@refs/heads/main",
  "preview-controller:v2":
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

function hasExactObjectKeys(value, expectedKeys) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const actualKeys = Object.keys(value).sort();
  return (
    actualKeys.length === expectedKeys.length &&
    expectedKeys
      .toSorted()
      .every((expectedKey, index) => actualKeys[index] === expectedKey)
  );
}

function prebuiltTarget(logicalTarget) {
  if (
    typeof logicalTarget !== "string" ||
    !Object.hasOwn(PREBUILT_TARGETS, logicalTarget)
  ) {
    throw new Error("The prebuilt workflow target is invalid");
  }
  return PREBUILT_TARGETS[logicalTarget];
}

function validatePrebuiltTargetMapping({
  logicalTarget,
  workspacePackage,
  expectedRootDirectory,
}) {
  const target = prebuiltTarget(logicalTarget);
  for (const [name, actual] of Object.entries({
    workspacePackage,
    expectedRootDirectory,
  })) {
    if (actual !== target[name]) {
      throw new Error(
        `The ${target.logicalTarget} prebuilt workflow requires ${name}=${target[name]}`,
      );
    }
  }
  return target;
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
  prebuiltTarget(values.logicalTarget);
  const pr = String(values.pullRequestNumber ?? "");
  if (!/^[1-9][0-9]{0,9}$/.test(pr)) {
    throw new Error(
      "Automatic previews require a positive pull request number",
    );
  }
  if (values.githubEnvironment !== `preview/${values.logicalTarget}/pr-${pr}`) {
    throw new Error(
      "Automatic preview environment does not match the pull request",
    );
  }
  if (values.provenance !== "preview-controller:v2") {
    throw new Error("Automatic preview provenance is invalid");
  }
  if (
    values.idempotencyKey !==
    `vercel-preview:v1:pr:${pr}:target:${values.logicalTarget}:sha:${values.commitSha}`
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

  const target = validatePrebuiltTargetMapping(values);
  for (const [name, actual] of Object.entries({
    vercelEnvironment: values.vercelEnvironment,
    vercelTarget: values.vercelTarget,
    deploymentMode: values.deploymentMode,
  })) {
    if (actual !== "preview") {
      throw new Error(`The preview prebuilt workflow requires ${name}=preview`);
    }
  }
  if (values.deployPermitted !== "true" && values.deployPermitted !== true) {
    throw new Error("The caller did not permit this deployment");
  }
  if (values.githubRepository !== "mento-protocol/frontend-monorepo") {
    throw new Error(
      "The prebuilt workflow may run only in mento-protocol/frontend-monorepo",
    );
  }
  if (values.provenance === "manual-pilot") {
    if (
      target.logicalTarget !== "ui" ||
      values.githubEnvironment !== PILOT_TARGET.githubEnvironment
    ) {
      throw new Error("The manual pilot is restricted to the UI target");
    }
  } else {
    validateAutomaticPreviewIdentity(values);
  }
  if (values.githubRef !== "refs/heads/main") {
    throw new Error("The prebuilt workflow must be dispatched from main");
  }
  if (values.githubWorkflowRef !== TRUSTED_CALLER_WORKFLOW[values.provenance]) {
    throw new Error("The prebuilt caller is not the trusted main workflow");
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
    "--standalone",
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

function optionalEntry(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

function targetRootDirectory(value) {
  requiredText(value, "Expected Root Directory");
  if (
    !Object.values(PREBUILT_TARGETS).some(
      (target) => target.expectedRootDirectory === value,
    ) ||
    isAbsolute(value) ||
    value === ".." ||
    value.startsWith(`..${sep}`)
  ) {
    throw new Error(
      "Expected Root Directory is not a fixed Vercel target root",
    );
  }
  return value;
}

function assertIsolationRootChild({
  isolationRoot,
  path,
  expectedName,
  expectedUid = process.getuid?.(),
  expectedGid = process.getgid?.(),
}) {
  requiredText(isolationRoot, "Vercel isolation root");
  requiredText(path, "Isolated path");
  if (!isAbsolute(isolationRoot) || !isAbsolute(path)) {
    throw new Error("Vercel isolation paths must be absolute");
  }
  const uid = numericIdentity(expectedUid, "Expected runner UID");
  const gid = numericIdentity(expectedGid, "Expected runner GID");
  const realIsolationRoot = realpathSync(isolationRoot);
  const isolationEntry = lstatSync(isolationRoot);
  if (
    realIsolationRoot !== isolationRoot ||
    isolationEntry.isSymbolicLink() ||
    !isolationEntry.isDirectory() ||
    isolationEntry.uid !== uid ||
    isolationEntry.gid !== gid ||
    (isolationEntry.mode & 0o7777) !== 0o711
  ) {
    throw new Error("Vercel isolation root is not protected");
  }
  if (
    basename(path) !== expectedName ||
    realpathSync(dirname(path)) !== realIsolationRoot
  ) {
    throw new Error("Isolated path is not the expected isolation-root child");
  }
  return join(realIsolationRoot, expectedName);
}

function rawGitEnvironment() {
  return {
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_NO_LAZY_FETCH: "1",
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_TERMINAL_PROMPT: "0",
    HOME: "/nonexistent",
    LANG: "C",
    LC_ALL: "C",
    PATH: "/usr/bin:/bin",
  };
}

function rawGit(
  repoRoot,
  arguments_,
  { input, maximumOutput, run = spawnSync },
) {
  const result = run(
    "/usr/bin/git",
    ["--no-pager", "--no-replace-objects", "-C", repoRoot, ...arguments_],
    {
      encoding: null,
      env: rawGitEnvironment(),
      input,
      maxBuffer: maximumOutput,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  if (result.error || result.status !== 0 || !Buffer.isBuffer(result.stdout)) {
    throw new Error(`Unable to read exact Git ${arguments_[0]} objects`);
  }
  return result.stdout;
}

function decodeGitPath(pathBytes) {
  if (pathBytes.length === 0 || pathBytes.length > MAX_SOURCE_PATH_BYTES) {
    throw new Error("Exact Git tree contains an invalid path length");
  }
  let path;
  try {
    path = new TextDecoder("utf-8", { fatal: true }).decode(pathBytes);
  } catch {
    throw new Error("Exact Git tree contains a non-UTF-8 path");
  }
  const components = path.split("/");
  if (
    isAbsolute(path) ||
    components.some(
      (component) =>
        component.length === 0 ||
        component === "." ||
        component === ".." ||
        component.toLowerCase() === ".git" ||
        hasControlCharacters(component),
    )
  ) {
    throw new Error("Exact Git tree contains an unsafe path");
  }
  return { components, path };
}

function parseExactGitTree(rawTree) {
  const entries = [];
  const paths = new Set();
  let offset = 0;
  while (offset < rawTree.length) {
    const end = rawTree.indexOf(0, offset);
    if (end === -1) {
      throw new Error("Exact Git tree is not NUL terminated");
    }
    const record = rawTree.subarray(offset, end);
    const separator = record.indexOf(0x09);
    if (separator === -1) {
      throw new Error("Exact Git tree entry has invalid metadata");
    }
    const metadata = record.subarray(0, separator).toString("ascii");
    const match = /^(\d{6}) ([a-z]+) ([0-9a-f]{40})$/.exec(metadata);
    if (!match) {
      throw new Error("Exact Git tree entry has invalid metadata");
    }
    const [, mode, type, oid] = match;
    if (
      type !== "blob" ||
      (mode !== "100644" && mode !== "100755" && mode !== "120000")
    ) {
      throw new Error("Exact Git tree contains an unsupported entry");
    }
    const { components, path } = decodeGitPath(record.subarray(separator + 1));
    if (paths.has(path)) {
      throw new Error("Exact Git tree contains a duplicate path");
    }
    paths.add(path);
    entries.push({ components, mode, oid, path });
    if (entries.length > MAX_SOURCE_ENTRIES) {
      throw new Error("Exact Git tree contains too many entries");
    }
    offset = end + 1;
  }
  return entries;
}

function loadRawGitBlobs(repoRoot, entries, run) {
  const objectIds = [...new Set(entries.map(({ oid }) => oid))];
  if (objectIds.length === 0) return new Map();
  const input = Buffer.from(`${objectIds.join("\n")}\n`, "ascii");
  const rawSizes = rawGit(
    repoRoot,
    ["cat-file", "--batch-check=%(objectname) %(objecttype) %(objectsize)"],
    {
      input,
      maximumOutput: MAX_SOURCE_TREE_BYTES,
      run,
    },
  );
  const sizeLines = rawSizes.toString("ascii").split("\n");
  if (sizeLines.at(-1) !== "") {
    throw new Error("Raw Git blob size response is not newline terminated");
  }
  sizeLines.pop();
  if (sizeLines.length !== objectIds.length) {
    throw new Error("Raw Git blob size response is incomplete");
  }
  const sizes = new Map();
  for (const [index, line] of sizeLines.entries()) {
    const match = /^([0-9a-f]{40}) blob ([0-9]+)$/.exec(line);
    const expectedOid = objectIds[index];
    if (!match || match[1] !== expectedOid) {
      throw new Error("Exact Git tree references a non-blob object");
    }
    const size = Number(match[2]);
    if (!Number.isSafeInteger(size) || size > MAX_SOURCE_BLOB_BYTES) {
      throw new Error("Exact Git tree contains an oversized blob");
    }
    sizes.set(expectedOid, size);
  }
  let totalBytes = 0;
  for (const { oid } of entries) {
    totalBytes += sizes.get(oid);
    if (totalBytes > MAX_SOURCE_TOTAL_BYTES) {
      throw new Error("Exact Git tree exceeds the source byte limit");
    }
  }

  const rawBlobs = rawGit(repoRoot, ["cat-file", "--batch"], {
    input,
    maximumOutput: MAX_SOURCE_TOTAL_BYTES + MAX_SOURCE_TREE_BYTES,
    run,
  });
  const blobs = new Map();
  let offset = 0;
  for (const expectedOid of objectIds) {
    const headerEnd = rawBlobs.indexOf(0x0a, offset);
    if (headerEnd === -1) {
      throw new Error("Raw Git blob response is missing a header");
    }
    const header = rawBlobs.subarray(offset, headerEnd).toString("ascii");
    const match = /^([0-9a-f]{40}) blob ([0-9]+)$/.exec(header);
    const expectedSize = sizes.get(expectedOid);
    if (
      !match ||
      match[1] !== expectedOid ||
      Number(match[2]) !== expectedSize
    ) {
      throw new Error("Raw Git blob response does not match the exact tree");
    }
    const bodyStart = headerEnd + 1;
    const bodyEnd = bodyStart + expectedSize;
    if (bodyEnd >= rawBlobs.length || rawBlobs[bodyEnd] !== 0x0a) {
      throw new Error("Raw Git blob response is truncated");
    }
    blobs.set(expectedOid, Buffer.from(rawBlobs.subarray(bodyStart, bodyEnd)));
    offset = bodyEnd + 1;
  }
  if (offset !== rawBlobs.length) {
    throw new Error("Raw Git blob response contains trailing data");
  }
  return blobs;
}

function ensureMaterializedParent(root, components) {
  let current = root;
  for (const component of components.slice(0, -1)) {
    current = join(current, component);
    const entry = optionalEntry(current);
    if (entry) {
      if (entry.isSymbolicLink() || !entry.isDirectory()) {
        throw new Error("Exact Git tree has a non-directory path component");
      }
      continue;
    }
    mkdirSync(current, { mode: 0o755 });
    chmodSync(current, 0o755);
  }
}

export function materializeExactGitTree({
  isolationRoot,
  sourceRoot,
  candidateRoot,
  commitSha,
  expectedUid = process.getuid?.(),
  expectedGid = process.getgid?.(),
  run = spawnSync,
}) {
  const sha = validateExactSha(commitSha);
  requiredText(sourceRoot, "Exact Git source path", {
    maximum: MAX_SOURCE_PATH_BYTES,
  });
  const canonicalSourceRoot = realpathSync(sourceRoot);
  const sourceEntry = lstatSync(canonicalSourceRoot);
  if (!sourceEntry.isDirectory()) {
    throw new Error("Exact Git source must be a real directory");
  }
  const canonicalCandidateRoot = assertIsolationRootChild({
    isolationRoot,
    path: candidateRoot,
    expectedName: CANDIDATE_SOURCE_DIRECTORY,
    expectedUid,
    expectedGid,
  });
  if (optionalEntry(canonicalCandidateRoot)) {
    throw new Error("Candidate source path must be fresh");
  }
  const rawTree = rawGit(
    canonicalSourceRoot,
    ["ls-tree", "-r", "-z", "--full-tree", sha],
    { maximumOutput: MAX_SOURCE_TREE_BYTES, run },
  );
  const entries = parseExactGitTree(rawTree);
  const blobs = loadRawGitBlobs(canonicalSourceRoot, entries, run);

  mkdirSync(canonicalCandidateRoot, { mode: 0o755 });
  chmodSync(canonicalCandidateRoot, 0o755);
  for (const entry of entries) {
    ensureMaterializedParent(canonicalCandidateRoot, entry.components);
    const destination = join(canonicalCandidateRoot, ...entry.components);
    if (optionalEntry(destination)) {
      throw new Error("Exact Git tree contains a filesystem collision");
    }
    const blob = blobs.get(entry.oid);
    if (!blob) throw new Error("Exact Git tree blob was not loaded");
    if (entry.mode === "120000") {
      if (
        blob.length === 0 ||
        blob.length > MAX_SOURCE_PATH_BYTES ||
        blob.includes(0)
      ) {
        throw new Error("Exact Git tree contains an invalid symbolic link");
      }
      symlinkSync(blob, destination);
      continue;
    }
    if (typeof fsConstants.O_NOFOLLOW !== "number") {
      throw new Error("This platform cannot safely materialize Git blobs");
    }
    const descriptor = openSync(
      destination,
      fsConstants.O_CREAT |
        fsConstants.O_EXCL |
        fsConstants.O_NOFOLLOW |
        fsConstants.O_WRONLY,
      0o600,
    );
    try {
      writeFileSync(descriptor, blob);
      fchmodSync(descriptor, entry.mode === "100755" ? 0o755 : 0o644);
    } finally {
      closeSync(descriptor);
    }
  }
  return {
    bytes: entries.reduce((total, { oid }) => total + blobs.get(oid).length, 0),
    entries: entries.length,
    sourceRoot: canonicalCandidateRoot,
  };
}

function assertExactFilesystemTree(
  root,
  expectedEntries,
  { expectedUid = process.getuid?.(), expectedGid = process.getgid?.(), label },
) {
  const uid = numericIdentity(expectedUid, `Expected ${label} UID`);
  const gid = numericIdentity(expectedGid, `Expected ${label} GID`);
  const expected = new Map(expectedEntries);
  const seen = new Set();
  const pending = [root];
  while (pending.length > 0) {
    const path = pending.pop();
    const relativePath = relative(root, path);
    const specification = expected.get(relativePath);
    if (!specification) {
      throw new Error(`${label} contains an unexpected filesystem entry`);
    }
    const entry = lstatSync(path);
    if (entry.uid !== uid || entry.gid !== gid || (entry.mode & 0o7077) !== 0) {
      throw new Error(`${label} contains unsafe ownership or permissions`);
    }
    if (entry.isSymbolicLink()) {
      throw new Error(`${label} contains a symbolic link`);
    }
    if (specification.type === "directory") {
      if (!entry.isDirectory()) {
        throw new Error(`${label} contains a non-directory component`);
      }
      for (const child of readdirSync(path)) pending.push(join(path, child));
    } else {
      if (!entry.isFile()) {
        throw new Error(`${label} contains a special filesystem node`);
      }
      if (entry.nlink !== 1) {
        throw new Error(`${label} contains a hard-linked file`);
      }
      if (entry.size > specification.maximumSize) {
        throw new Error(`${label} contains an oversized file`);
      }
    }
    seen.add(relativePath);
  }
  if (seen.size !== expected.size) {
    throw new Error(`${label} is missing a required filesystem entry`);
  }
  return root;
}

export function materializeVercelRepoLink({
  repoRoot,
  expectedRootDirectory,
  vercelOrgId,
  vercelProjectId,
}) {
  requiredText(repoRoot, "Source path");
  targetRootDirectory(expectedRootDirectory);
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

function pulledStateEntries(expectedRootDirectory) {
  return [
    ["", { type: "directory" }],
    [".vercel", { type: "directory" }],
    [join(".vercel", "repo.json"), { type: "file", maximumSize: 64 * 1_024 }],
    ["apps", { type: "directory" }],
    [expectedRootDirectory, { type: "directory" }],
    [join(expectedRootDirectory, ".vercel"), { type: "directory" }],
    [
      join(expectedRootDirectory, ".vercel", "project.json"),
      { type: "file", maximumSize: 256 * 1_024 },
    ],
    [
      join(expectedRootDirectory, ".vercel", PULLED_ENVIRONMENT_FILE),
      { type: "file", maximumSize: 16 * 1_024 * 1_024 },
    ],
  ];
}

function assertExactPulledConfiguration({
  repoRoot,
  expectedRootDirectory,
  expectedUid,
  expectedGid,
  label,
}) {
  const stateEntries = pulledStateEntries(expectedRootDirectory);
  const repoStateEntries = stateEntries
    .filter(([path]) => path === ".vercel" || path.startsWith(`.vercel${sep}`))
    .map(([path, specification]) => [relative(".vercel", path), specification]);
  const appStateRoot = join(expectedRootDirectory, ".vercel");
  const appStateEntries = stateEntries
    .filter(
      ([path]) =>
        path === appStateRoot || path.startsWith(`${appStateRoot}${sep}`),
    )
    .map(([path, specification]) => [
      relative(appStateRoot, path),
      specification,
    ]);
  assertExactFilesystemTree(join(repoRoot, ".vercel"), repoStateEntries, {
    expectedUid,
    expectedGid,
    label,
  });
  assertExactFilesystemTree(join(repoRoot, appStateRoot), appStateEntries, {
    expectedUid,
    expectedGid,
    label,
  });
}

export function prepareVercelPullStaging({
  isolationRoot,
  stagingRoot,
  expectedRootDirectory,
  vercelOrgId,
  vercelProjectId,
}) {
  targetRootDirectory(expectedRootDirectory);
  const canonicalStagingRoot = assertIsolationRootChild({
    isolationRoot,
    path: stagingRoot,
    expectedName: PULL_STAGING_DIRECTORY,
  });
  if (optionalEntry(canonicalStagingRoot)) {
    throw new Error("Vercel pull staging must be fresh");
  }
  mkdirSync(canonicalStagingRoot, { mode: 0o700 });
  let current = canonicalStagingRoot;
  for (const component of expectedRootDirectory.split("/")) {
    current = join(current, component);
    mkdirSync(current, { mode: 0o700 });
  }
  const link = materializeVercelRepoLink({
    repoRoot: canonicalStagingRoot,
    expectedRootDirectory,
    vercelOrgId,
    vercelProjectId,
  });
  chmodSync(join(canonicalStagingRoot, ".vercel"), 0o700);
  chmodSync(join(canonicalStagingRoot, ".vercel", "repo.json"), 0o600);
  return link;
}

export function assertVercelPullStaging({
  isolationRoot,
  stagingRoot,
  expectedRootDirectory,
  vercelOrgId,
  vercelProjectId,
  expectedUid = process.getuid?.(),
  expectedGid = process.getgid?.(),
}) {
  targetRootDirectory(expectedRootDirectory);
  const canonicalStagingRoot = assertIsolationRootChild({
    isolationRoot,
    path: stagingRoot,
    expectedName: PULL_STAGING_DIRECTORY,
    expectedUid,
    expectedGid,
  });
  if (realpathSync(stagingRoot) !== canonicalStagingRoot) {
    throw new Error("Vercel pull staging resolves outside the isolation root");
  }
  assertExactFilesystemTree(
    canonicalStagingRoot,
    pulledStateEntries(expectedRootDirectory),
    {
      expectedUid,
      expectedGid,
      label: "Vercel pull staging",
    },
  );
  return assertPulledProject({
    repoRoot: canonicalStagingRoot,
    expectedRootDirectory,
    vercelOrgId,
    vercelProjectId,
  });
}

function protectedFileIdentity(entry) {
  return {
    ctimeMs: entry.ctimeMs,
    dev: entry.dev,
    gid: entry.gid,
    ino: entry.ino,
    mode: entry.mode,
    mtimeMs: entry.mtimeMs,
    nlink: entry.nlink,
    size: entry.size,
    uid: entry.uid,
  };
}

function sameProtectedFileIdentity(left, right) {
  return Object.keys(left).every((name) => left[name] === right[name]);
}

function assertProtectedEnvironmentEntry(
  entry,
  { expectedUid, expectedGid, label },
) {
  if (
    entry.isSymbolicLink() ||
    !entry.isFile() ||
    entry.uid !== expectedUid ||
    entry.gid !== expectedGid ||
    (entry.mode & 0o777) !== 0o600 ||
    entry.nlink !== 1 ||
    entry.size > MAX_PULLED_ENVIRONMENT_BYTES
  ) {
    throw new Error(`${label} has unsafe filesystem metadata`);
  }
}

function readProtectedEnvironmentFile({
  root,
  filePath,
  expectedUid,
  expectedGid,
  label,
}) {
  const canonicalRoot = realpathSync(root);
  const canonicalFilePath = realpathSync(filePath);
  if (
    canonicalFilePath !== filePath ||
    !isStrictDescendant(canonicalRoot, canonicalFilePath)
  ) {
    throw new Error(`${label} escapes its protected root`);
  }
  const beforeEntry = lstatSync(filePath);
  assertProtectedEnvironmentEntry(beforeEntry, {
    expectedUid,
    expectedGid,
    label,
  });
  if (typeof fsConstants.O_NOFOLLOW !== "number") {
    throw new Error(`${label} cannot be opened without following links`);
  }
  const descriptor = openSync(
    filePath,
    fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
  );
  let bytes;
  const beforeIdentity = protectedFileIdentity(beforeEntry);
  try {
    const openedEntry = fstatSync(descriptor);
    assertProtectedEnvironmentEntry(openedEntry, {
      expectedUid,
      expectedGid,
      label,
    });
    if (
      !sameProtectedFileIdentity(
        beforeIdentity,
        protectedFileIdentity(openedEntry),
      )
    ) {
      throw new Error(`${label} changed before it was opened`);
    }
    bytes = Buffer.alloc(openedEntry.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(
        descriptor,
        bytes,
        offset,
        bytes.length - offset,
        offset,
      );
      if (count === 0) throw new Error(`${label} was truncated while reading`);
      offset += count;
    }
    const afterReadEntry = fstatSync(descriptor);
    if (
      !sameProtectedFileIdentity(
        beforeIdentity,
        protectedFileIdentity(afterReadEntry),
      )
    ) {
      throw new Error(`${label} changed while it was read`);
    }
  } finally {
    closeSync(descriptor);
  }
  const afterPathEntry = lstatSync(filePath);
  if (
    !sameProtectedFileIdentity(
      beforeIdentity,
      protectedFileIdentity(afterPathEntry),
    )
  ) {
    throw new Error(`${label} changed after it was read`);
  }
  return { bytes, identity: beforeIdentity };
}

function assertSameProtectedSource(before, after) {
  if (
    !sameProtectedFileIdentity(before.identity, after.identity) ||
    !before.bytes.equals(after.bytes)
  ) {
    throw new Error(
      "Vercel-pulled build environment changed during materialization",
    );
  }
}

function deriveVercelBuildEnvironment({ target, environment, raw }) {
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
  } catch {
    throw new Error("Vercel-pulled build environment is not valid UTF-8");
  }
  const values = selectVercelPulledEnvironment({
    target,
    environment,
    pulledValues: parseVercelPulledEnvironment(text),
  });
  return {
    serialized: serializeVercelPulledEnvironment(values),
    values,
  };
}

function materializedEnvironmentEntries() {
  return [
    ["", { type: "directory" }],
    [".vercel", { type: "directory" }],
    [
      join(".vercel", PULLED_ENVIRONMENT_FILE),
      { type: "file", maximumSize: MAX_PULLED_ENVIRONMENT_BYTES },
    ],
  ];
}

function inspectMaterializedVercelBuildEnvironment({
  isolationRoot,
  stagingRoot,
  materializationRoot,
  expectedRootDirectory,
  logicalTarget,
  environment = "preview",
  vercelOrgId,
  vercelProjectId,
  expectedUid,
  expectedGid,
}) {
  const uid = numericIdentity(expectedUid, "Expected runner UID");
  const gid = numericIdentity(expectedGid, "Expected runner GID");
  assertVercelPullStaging({
    isolationRoot,
    stagingRoot,
    expectedRootDirectory,
    vercelOrgId,
    vercelProjectId,
    expectedUid: uid,
    expectedGid: gid,
  });
  validatePrebuiltTargetMapping({
    logicalTarget,
    workspacePackage: PREBUILT_TARGETS[logicalTarget]?.workspacePackage,
    expectedRootDirectory,
  });
  const canonicalMaterializationRoot = assertIsolationRootChild({
    isolationRoot,
    path: materializationRoot,
    expectedName: BUILD_ENVIRONMENT_DIRECTORY,
    expectedUid: uid,
    expectedGid: gid,
  });
  if (realpathSync(materializationRoot) !== canonicalMaterializationRoot) {
    throw new Error("Materialized Vercel build environment escaped isolation");
  }
  assertExactFilesystemTree(
    canonicalMaterializationRoot,
    materializedEnvironmentEntries(),
    {
      expectedUid: uid,
      expectedGid: gid,
      label: "Materialized Vercel build environment",
    },
  );
  for (const path of [
    canonicalMaterializationRoot,
    join(canonicalMaterializationRoot, ".vercel"),
  ]) {
    if ((lstatSync(path).mode & 0o777) !== 0o700) {
      throw new Error(
        "Materialized Vercel build environment directory is not private",
      );
    }
  }
  const sourcePath = join(
    stagingRoot,
    expectedRootDirectory,
    ".vercel",
    PULLED_ENVIRONMENT_FILE,
  );
  const sourceSnapshot = readProtectedEnvironmentFile({
    root: stagingRoot,
    filePath: sourcePath,
    expectedUid: uid,
    expectedGid: gid,
    label: "Vercel-pulled build environment",
  });
  const expected = deriveVercelBuildEnvironment({
    target: logicalTarget,
    environment,
    raw: sourceSnapshot.bytes,
  });
  const environmentPath = join(
    canonicalMaterializationRoot,
    ".vercel",
    PULLED_ENVIRONMENT_FILE,
  );
  const materialized = readProtectedEnvironmentFile({
    root: canonicalMaterializationRoot,
    filePath: environmentPath,
    expectedUid: uid,
    expectedGid: gid,
    label: "Materialized Vercel build environment",
  });
  if (!materialized.bytes.equals(Buffer.from(expected.serialized, "utf8"))) {
    throw new Error(
      "Materialized Vercel build environment does not match the exact allowlist",
    );
  }
  return {
    checked: Object.keys(expected.values).length,
    environmentPath,
    sourceSnapshot,
  };
}

export function materializeVercelBuildEnvironment({
  isolationRoot,
  stagingRoot,
  materializationRoot,
  expectedRootDirectory,
  logicalTarget,
  environment = "preview",
  vercelOrgId,
  vercelProjectId,
  expectedUid = process.getuid?.(),
  expectedGid = process.getgid?.(),
}) {
  const uid = numericIdentity(expectedUid, "Expected runner UID");
  const gid = numericIdentity(expectedGid, "Expected runner GID");
  assertVercelPullStaging({
    isolationRoot,
    stagingRoot,
    expectedRootDirectory,
    vercelOrgId,
    vercelProjectId,
    expectedUid: uid,
    expectedGid: gid,
  });
  validatePrebuiltTargetMapping({
    logicalTarget,
    workspacePackage: PREBUILT_TARGETS[logicalTarget]?.workspacePackage,
    expectedRootDirectory,
  });
  const canonicalMaterializationRoot = assertIsolationRootChild({
    isolationRoot,
    path: materializationRoot,
    expectedName: BUILD_ENVIRONMENT_DIRECTORY,
    expectedUid: uid,
    expectedGid: gid,
  });
  if (optionalEntry(canonicalMaterializationRoot)) {
    throw new Error("Materialized Vercel build environment must be fresh");
  }
  const sourcePath = join(
    stagingRoot,
    expectedRootDirectory,
    ".vercel",
    PULLED_ENVIRONMENT_FILE,
  );
  const sourceBefore = readProtectedEnvironmentFile({
    root: stagingRoot,
    filePath: sourcePath,
    expectedUid: uid,
    expectedGid: gid,
    label: "Vercel-pulled build environment",
  });
  const derived = deriveVercelBuildEnvironment({
    target: logicalTarget,
    environment,
    raw: sourceBefore.bytes,
  });

  mkdirSync(canonicalMaterializationRoot, { mode: 0o700 });
  chmodSync(canonicalMaterializationRoot, 0o700);
  const vercelDirectory = join(canonicalMaterializationRoot, ".vercel");
  mkdirSync(vercelDirectory, { mode: 0o700 });
  chmodSync(vercelDirectory, 0o700);
  const environmentPath = join(vercelDirectory, PULLED_ENVIRONMENT_FILE);
  if (typeof fsConstants.O_NOFOLLOW !== "number") {
    throw new Error(
      "Materialized Vercel build environment cannot be created safely",
    );
  }
  const descriptor = openSync(
    environmentPath,
    fsConstants.O_CREAT |
      fsConstants.O_EXCL |
      fsConstants.O_NOFOLLOW |
      fsConstants.O_WRONLY,
    0o600,
  );
  try {
    writeFileSync(descriptor, derived.serialized, { encoding: "utf8" });
    fchmodSync(descriptor, 0o600);
  } finally {
    closeSync(descriptor);
  }

  const inspected = inspectMaterializedVercelBuildEnvironment({
    isolationRoot,
    stagingRoot,
    materializationRoot: canonicalMaterializationRoot,
    expectedRootDirectory,
    logicalTarget,
    environment,
    vercelOrgId,
    vercelProjectId,
    expectedUid: uid,
    expectedGid: gid,
  });
  assertSameProtectedSource(sourceBefore, inspected.sourceSnapshot);
  return {
    checked: inspected.checked,
    environmentPath: inspected.environmentPath,
  };
}

export function assertMaterializedVercelBuildEnvironment(options) {
  const inspected = inspectMaterializedVercelBuildEnvironment(options);
  return {
    checked: inspected.checked,
    environmentPath: inspected.environmentPath,
  };
}

function assertCandidateRootComponents({
  isolationRoot,
  candidateRoot,
  expectedRootDirectory,
  buildUid,
  buildGid,
  runnerUid,
  runnerGid,
}) {
  const canonicalCandidateRoot = assertIsolationRootChild({
    isolationRoot,
    path: candidateRoot,
    expectedName: CANDIDATE_SOURCE_DIRECTORY,
    expectedUid: runnerUid,
    expectedGid: runnerGid,
  });
  if (realpathSync(candidateRoot) !== canonicalCandidateRoot) {
    throw new Error("Candidate source resolves outside the isolation root");
  }
  let current = canonicalCandidateRoot;
  for (const [path, label] of [
    [canonicalCandidateRoot, "Candidate source"],
    ...expectedRootDirectory.split("/").map((component) => {
      current = join(current, component);
      return [current, "Candidate target Root Directory"];
    }),
  ]) {
    const entry = lstatSync(path);
    if (
      entry.isSymbolicLink() ||
      !entry.isDirectory() ||
      entry.uid !== buildUid ||
      entry.gid !== buildGid
    ) {
      throw new Error(`${label} contains an unsafe path component`);
    }
  }
  return canonicalCandidateRoot;
}

function assertCandidateVercelPull({
  isolationRoot,
  candidateRoot,
  expectedRootDirectory,
  logicalTarget,
  environment,
  vercelOrgId,
  vercelProjectId,
  buildUid,
  buildGid,
  runnerUid,
  runnerGid,
}) {
  const candidateUid = numericIdentity(buildUid, "Candidate build UID");
  const candidateGid = numericIdentity(buildGid, "Candidate build GID");
  const trustedUid = numericIdentity(runnerUid, "Runner UID");
  const trustedGid = numericIdentity(runnerGid, "Runner GID");
  const canonicalCandidateRoot = assertCandidateRootComponents({
    isolationRoot,
    candidateRoot,
    expectedRootDirectory,
    buildUid: candidateUid,
    buildGid: candidateGid,
    runnerUid: trustedUid,
    runnerGid: trustedGid,
  });
  assertExactPulledConfiguration({
    repoRoot: canonicalCandidateRoot,
    expectedRootDirectory,
    expectedUid: candidateUid,
    expectedGid: candidateGid,
    label: "Candidate Vercel state",
  });
  validatePrebuiltTargetMapping({
    logicalTarget,
    workspacePackage: PREBUILT_TARGETS[logicalTarget]?.workspacePackage,
    expectedRootDirectory,
  });
  const environmentPath = join(
    canonicalCandidateRoot,
    expectedRootDirectory,
    ".vercel",
    PULLED_ENVIRONMENT_FILE,
  );
  const candidateEnvironment = readProtectedEnvironmentFile({
    root: canonicalCandidateRoot,
    filePath: environmentPath,
    expectedUid: candidateUid,
    expectedGid: candidateGid,
    label: "Candidate Vercel build environment",
  });
  const expectedEnvironment = deriveVercelBuildEnvironment({
    target: logicalTarget,
    environment,
    raw: candidateEnvironment.bytes,
  });
  if (
    !candidateEnvironment.bytes.equals(
      Buffer.from(expectedEnvironment.serialized, "utf8"),
    )
  ) {
    throw new Error(
      "Candidate Vercel build environment is not the canonical exact allowlist",
    );
  }
  return assertPulledProject({
    repoRoot: canonicalCandidateRoot,
    expectedRootDirectory,
    vercelOrgId,
    vercelProjectId,
  });
}

export function stageVercelPullForCandidate({
  isolationRoot,
  stagingRoot,
  materializationRoot,
  candidateRoot,
  expectedRootDirectory,
  logicalTarget,
  environment = "preview",
  vercelOrgId,
  vercelProjectId,
  buildUid,
  buildGid,
  runnerUid,
  runnerGid,
}) {
  const candidateUid = numericIdentity(buildUid, "Candidate build UID");
  const candidateGid = numericIdentity(buildGid, "Candidate build GID");
  const trustedUid = numericIdentity(runnerUid, "Runner UID");
  const trustedGid = numericIdentity(runnerGid, "Runner GID");
  const materializedEnvironment = inspectMaterializedVercelBuildEnvironment({
    isolationRoot,
    stagingRoot,
    materializationRoot,
    expectedRootDirectory,
    logicalTarget,
    environment,
    vercelOrgId,
    vercelProjectId,
    expectedUid: trustedUid,
    expectedGid: trustedGid,
  });
  const canonicalCandidateRoot = assertCandidateRootComponents({
    isolationRoot,
    candidateRoot,
    expectedRootDirectory,
    buildUid: candidateUid,
    buildGid: candidateGid,
    runnerUid: trustedUid,
    runnerGid: trustedGid,
  });
  const candidateRepoState = join(canonicalCandidateRoot, ".vercel");
  const candidateAppState = join(
    canonicalCandidateRoot,
    expectedRootDirectory,
    ".vercel",
  );
  for (const path of [candidateRepoState, candidateAppState]) {
    rmSync(path, { force: true, recursive: true });
    mkdirSync(path, { mode: 0o700 });
    chownSync(path, candidateUid, candidateGid);
    chmodSync(path, 0o700);
  }
  const copies = [
    [join(".vercel", "repo.json"), join(".vercel", "repo.json")],
    [
      join(expectedRootDirectory, ".vercel", "project.json"),
      join(expectedRootDirectory, ".vercel", "project.json"),
    ],
  ];
  for (const [sourcePath, destinationPath] of copies) {
    const destination = join(canonicalCandidateRoot, destinationPath);
    copyFileSync(
      join(stagingRoot, sourcePath),
      destination,
      fsConstants.COPYFILE_EXCL,
    );
    chownSync(destination, candidateUid, candidateGid);
    chmodSync(destination, 0o600);
  }
  const candidateEnvironmentPath = join(
    canonicalCandidateRoot,
    expectedRootDirectory,
    ".vercel",
    PULLED_ENVIRONMENT_FILE,
  );
  copyFileSync(
    materializedEnvironment.environmentPath,
    candidateEnvironmentPath,
    fsConstants.COPYFILE_EXCL,
  );
  chownSync(candidateEnvironmentPath, candidateUid, candidateGid);
  chmodSync(candidateEnvironmentPath, 0o600);
  return assertCandidateVercelPull({
    isolationRoot,
    candidateRoot: canonicalCandidateRoot,
    expectedRootDirectory,
    logicalTarget,
    environment,
    vercelOrgId,
    vercelProjectId,
    buildUid: candidateUid,
    buildGid: candidateGid,
    runnerUid: trustedUid,
    runnerGid: trustedGid,
  });
}

export function environmentForVercelCli(environment, allowedNames = []) {
  const cliEnvironment = {};
  for (const name of new Set([
    ...VERCEL_CLI_BASE_ENVIRONMENT,
    ...allowedNames,
  ])) {
    const value = environment[name];
    if (value === undefined || value === "") continue;
    cliEnvironment[name] = requiredText(value, name, { maximum: 32_768 });
  }
  // CLI 56.2.0 gives these variables precedence over repo.json and would lose
  // the monorepo Root Directory mapping. The controller has already validated
  // the IDs and materialized them in the trusted repo link.
  delete cliEnvironment.VERCEL_ORG_ID;
  delete cliEnvironment.VERCEL_PROJECT_ID;
  return cliEnvironment;
}

function assertProtectedRuntimeEntry(
  path,
  { directory, expectedUid, expectedGid, requireSingleLink = true },
) {
  const entry = lstatSync(path);
  if (
    entry.isSymbolicLink() ||
    (directory ? !entry.isDirectory() : !entry.isFile()) ||
    entry.uid !== expectedUid ||
    entry.gid !== expectedGid ||
    (entry.mode & 0o7022) !== 0 ||
    (!directory && requireSingleLink && entry.nlink !== 1)
  ) {
    throw new Error("Protected runtime entry is not runner-owned");
  }
  return entry;
}

function assertProtectedRuntimeDescendant({
  root,
  path,
  directory,
  expectedUid,
  expectedGid,
  requireSingleLink = true,
}) {
  const canonicalRoot = realpathSync(root);
  const canonicalPath = realpathSync(path);
  const pathFromRoot = relative(canonicalRoot, canonicalPath);
  if (
    pathFromRoot === "" ||
    pathFromRoot === ".." ||
    pathFromRoot.startsWith(`..${sep}`) ||
    isAbsolute(pathFromRoot)
  ) {
    throw new Error("Protected runtime source escaped its protected root");
  }
  const entry = assertProtectedRuntimeEntry(canonicalPath, {
    directory,
    expectedUid,
    expectedGid,
    requireSingleLink,
  });
  let parent = dirname(canonicalPath);
  while (parent !== canonicalRoot) {
    assertProtectedRuntimeEntry(parent, {
      directory: true,
      expectedUid,
      expectedGid,
    });
    const nextParent = dirname(parent);
    if (nextParent === parent) {
      throw new Error("Protected runtime source escaped its protected root");
    }
    parent = nextParent;
  }
  return { entry, path: canonicalPath };
}

function validatePinnedPnpmBootstrapFiles({ packageJsonPath, lockfilePath }) {
  const packageMetadata = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  if (
    !hasExactObjectKeys(packageMetadata, [
      "dependencies",
      "description",
      "name",
      "private",
      "version",
    ]) ||
    packageMetadata.name !== "@mento-protocol/vercel-pnpm-bootstrap" ||
    packageMetadata.version !== "0.0.0" ||
    packageMetadata.private !== true ||
    packageMetadata.description !==
      "Integrity-pinned Linux pnpm bootstrap for trusted Vercel builds" ||
    !hasExactObjectKeys(packageMetadata.dependencies, ["@pnpm/linux-x64"]) ||
    packageMetadata.dependencies["@pnpm/linux-x64"] !== PINNED_PNPM_VERSION ||
    packageMetadata.scripts !== undefined ||
    packageMetadata.workspaces !== undefined ||
    packageMetadata.overrides !== undefined
  ) {
    throw new Error("Trusted pnpm bootstrap manifest is not exact");
  }

  const lockfileContents = readFileSync(lockfilePath);
  const lockfileDigest = createHash("sha256")
    .update(lockfileContents)
    .digest("hex");
  if (lockfileDigest !== PINNED_PNPM_BOOTSTRAP_LOCKFILE_SHA256) {
    throw new Error("Trusted pnpm bootstrap lockfile is not exact");
  }
  const lockfile = JSON.parse(lockfileContents.toString("utf8"));
  const rootPackage = lockfile.packages?.[""];
  const pnpmPackage = lockfile.packages?.["node_modules/@pnpm/linux-x64"];
  if (
    !hasExactObjectKeys(lockfile, [
      "lockfileVersion",
      "name",
      "packages",
      "requires",
      "version",
    ]) ||
    lockfile.name !== "@mento-protocol/vercel-pnpm-bootstrap" ||
    lockfile.version !== "0.0.0" ||
    lockfile.lockfileVersion !== 3 ||
    lockfile.requires !== true ||
    !hasExactObjectKeys(lockfile.packages, [
      "",
      "node_modules/@pnpm/linux-x64",
    ]) ||
    !hasExactObjectKeys(rootPackage, ["dependencies", "name", "version"]) ||
    rootPackage.name !== "@mento-protocol/vercel-pnpm-bootstrap" ||
    rootPackage.version !== "0.0.0" ||
    !hasExactObjectKeys(rootPackage.dependencies, ["@pnpm/linux-x64"]) ||
    rootPackage.dependencies["@pnpm/linux-x64"] !== PINNED_PNPM_VERSION ||
    !hasExactObjectKeys(pnpmPackage, [
      "bin",
      "cpu",
      "funding",
      "integrity",
      "license",
      "os",
      "resolved",
      "version",
    ]) ||
    pnpmPackage.version !== PINNED_PNPM_VERSION ||
    pnpmPackage.resolved !== PINNED_PNPM_LINUX_X64_RESOLVED ||
    pnpmPackage.integrity !== PINNED_PNPM_LINUX_X64_INTEGRITY ||
    pnpmPackage.license !== "MIT" ||
    !hasExactObjectKeys(pnpmPackage.bin, ["pnpm"]) ||
    pnpmPackage.bin.pnpm !== "pnpm" ||
    JSON.stringify(pnpmPackage.os) !== '["linux"]' ||
    JSON.stringify(pnpmPackage.cpu) !== '["x64"]' ||
    !hasExactObjectKeys(pnpmPackage.funding, ["url"]) ||
    pnpmPackage.funding.url !== "https://opencollective.com/pnpm"
  ) {
    throw new Error("Trusted pnpm bootstrap lockfile structure is invalid");
  }
}

export function stageTrustedPnpmBootstrapManifest({
  controllerRoot,
  isolationRoot,
  bootstrapRoot,
  expectedUid = process.getuid?.(),
  expectedGid = process.getgid?.(),
}) {
  requiredText(controllerRoot, "Trusted controller path");
  if (!isAbsolute(controllerRoot)) {
    throw new Error("Trusted controller path must be absolute");
  }
  const uid = numericIdentity(expectedUid, "Expected runner UID");
  const gid = numericIdentity(expectedGid, "Expected runner GID");
  const canonicalControllerRoot = realpathSync(controllerRoot);
  assertProtectedRuntimeEntry(canonicalControllerRoot, {
    directory: true,
    expectedUid: uid,
    expectedGid: gid,
  });
  const sourceRoot = join(
    canonicalControllerRoot,
    "scripts",
    "vercel-pnpm-bootstrap",
  );
  assertProtectedRuntimeDescendant({
    root: canonicalControllerRoot,
    path: sourceRoot,
    directory: true,
    expectedUid: uid,
    expectedGid: gid,
  });
  const sourcePackageJson = assertProtectedRuntimeDescendant({
    root: canonicalControllerRoot,
    path: join(sourceRoot, "package.json"),
    directory: false,
    expectedUid: uid,
    expectedGid: gid,
  });
  const sourceLockfile = assertProtectedRuntimeDescendant({
    root: canonicalControllerRoot,
    path: join(sourceRoot, "package-lock.json"),
    directory: false,
    expectedUid: uid,
    expectedGid: gid,
  });
  validatePinnedPnpmBootstrapFiles({
    packageJsonPath: sourcePackageJson.path,
    lockfilePath: sourceLockfile.path,
  });

  const canonicalBootstrapRoot = assertIsolationRootChild({
    isolationRoot,
    path: bootstrapRoot,
    expectedName: PNPM_BOOTSTRAP_DIRECTORY,
    expectedUid: uid,
    expectedGid: gid,
  });
  if (optionalEntry(canonicalBootstrapRoot)) {
    throw new Error("Trusted pnpm bootstrap destination must be fresh");
  }

  let created = false;
  try {
    mkdirSync(canonicalBootstrapRoot, { mode: 0o700 });
    created = true;
    chmodSync(canonicalBootstrapRoot, 0o700);
    assertProtectedRuntimeEntry(canonicalBootstrapRoot, {
      directory: true,
      expectedUid: uid,
      expectedGid: gid,
    });
    for (const [name, source] of [
      ["package.json", sourcePackageJson],
      ["package-lock.json", sourceLockfile],
    ]) {
      const destination = join(canonicalBootstrapRoot, name);
      copyFileSync(source.path, destination, fsConstants.COPYFILE_EXCL);
      chmodSync(destination, 0o444);
      const destinationEntry = assertProtectedRuntimeEntry(destination, {
        directory: false,
        expectedUid: uid,
        expectedGid: gid,
      });
      if (
        realpathSync(destination) !== destination ||
        (destinationEntry.dev === source.entry.dev &&
          destinationEntry.ino === source.entry.ino)
      ) {
        throw new Error("Trusted pnpm bootstrap copy is not independent");
      }
    }
    validatePinnedPnpmBootstrapFiles({
      packageJsonPath: join(canonicalBootstrapRoot, "package.json"),
      lockfilePath: join(canonicalBootstrapRoot, "package-lock.json"),
    });
    return canonicalBootstrapRoot;
  } catch (error) {
    if (created) {
      rmSync(canonicalBootstrapRoot, { force: true, recursive: true });
    }
    throw error;
  }
}

function resolvePinnedPnpmBootstrapExecutable({
  isolationRoot,
  pnpmRoot,
  expectedUid = process.getuid?.(),
  expectedGid = process.getgid?.(),
  expectedPnpmSha256 = PINNED_PNPM_LINUX_X64_SHA256,
}) {
  const uid = numericIdentity(expectedUid, "Expected runner UID");
  const gid = numericIdentity(expectedGid, "Expected runner GID");
  const canonicalPnpmRoot = assertIsolationRootChild({
    isolationRoot,
    path: pnpmRoot,
    expectedName: PNPM_BOOTSTRAP_DIRECTORY,
    expectedUid: uid,
    expectedGid: gid,
  });
  assertProtectedRuntimeEntry(canonicalPnpmRoot, {
    directory: true,
    expectedUid: uid,
    expectedGid: gid,
  });
  const stagedPackageJson = assertProtectedRuntimeDescendant({
    root: canonicalPnpmRoot,
    path: join(canonicalPnpmRoot, "package.json"),
    directory: false,
    expectedUid: uid,
    expectedGid: gid,
  });
  const stagedLockfile = assertProtectedRuntimeDescendant({
    root: canonicalPnpmRoot,
    path: join(canonicalPnpmRoot, "package-lock.json"),
    directory: false,
    expectedUid: uid,
    expectedGid: gid,
  });
  validatePinnedPnpmBootstrapFiles({
    packageJsonPath: stagedPackageJson.path,
    lockfilePath: stagedLockfile.path,
  });

  const packageRoot = join(
    canonicalPnpmRoot,
    "node_modules",
    "@pnpm",
    "linux-x64",
  );
  assertProtectedRuntimeDescendant({
    root: canonicalPnpmRoot,
    path: packageRoot,
    directory: true,
    expectedUid: uid,
    expectedGid: gid,
  });
  const packageJson = assertProtectedRuntimeDescendant({
    root: canonicalPnpmRoot,
    path: join(packageRoot, "package.json"),
    directory: false,
    expectedUid: uid,
    expectedGid: gid,
  });
  const executablePath = join(packageRoot, "pnpm");
  if (
    lstatSync(executablePath).isSymbolicLink() ||
    realpathSync(executablePath) !== executablePath
  ) {
    throw new Error("Pinned pnpm bootstrap executable is not a real file");
  }
  const executable = assertProtectedRuntimeDescendant({
    root: canonicalPnpmRoot,
    path: executablePath,
    directory: false,
    expectedUid: uid,
    expectedGid: gid,
  });
  const installedMetadata = JSON.parse(readFileSync(packageJson.path, "utf8"));
  if (
    installedMetadata.name !== "@pnpm/linux-x64" ||
    installedMetadata.version !== PINNED_PNPM_VERSION ||
    !hasExactObjectKeys(installedMetadata.scripts, []) ||
    !hasExactObjectKeys(installedMetadata.bin, ["pnpm"]) ||
    installedMetadata.bin.pnpm !== "pnpm" ||
    JSON.stringify(installedMetadata.os) !== '["linux"]' ||
    JSON.stringify(installedMetadata.cpu) !== '["x64"]' ||
    (executable.entry.mode & 0o111) === 0
  ) {
    throw new Error("Pinned pnpm bootstrap package is not exact");
  }
  const executableDigest = createHash("sha256")
    .update(readFileSync(executable.path))
    .digest("hex");
  if (executableDigest !== expectedPnpmSha256) {
    throw new Error("Pinned pnpm bootstrap executable digest is invalid");
  }
  return executable.path;
}

export function stageTrustedRuntime({
  isolationRoot,
  toolsRoot,
  nodeSource,
  pnpmRoot,
  expectedUid = process.getuid?.(),
  expectedGid = process.getgid?.(),
  expectedPnpmSha256 = PINNED_PNPM_LINUX_X64_SHA256,
}) {
  const uid = numericIdentity(expectedUid, "Expected runner UID");
  const gid = numericIdentity(expectedGid, "Expected runner GID");
  const canonicalToolsRoot = assertIsolationRootChild({
    isolationRoot,
    path: toolsRoot,
    expectedName: TRUSTED_TOOLS_DIRECTORY,
    expectedUid: uid,
    expectedGid: gid,
  });
  if (optionalEntry(canonicalToolsRoot)) {
    throw new Error("Protected runtime destination must be fresh");
  }

  const pnpmExecutable = resolvePinnedPnpmBootstrapExecutable({
    isolationRoot,
    pnpmRoot,
    expectedUid: uid,
    expectedGid: gid,
    expectedPnpmSha256,
  });
  const sources = [
    {
      destinationDirectory: "bin",
      destinationName: "node",
      source: nodeSource,
    },
    {
      destinationDirectory: "bootstrap-bin",
      destinationName: "pnpm",
      source: pnpmExecutable,
    },
  ].map(({ destinationDirectory, destinationName, source }) => {
    const name =
      destinationName === "pnpm" ? "pnpm bootstrap" : destinationName;
    requiredText(source, `Protected ${name} source`);
    if (!isAbsolute(source)) {
      throw new Error(`Protected ${name} source must be absolute`);
    }
    const canonicalSource = realpathSync(source);
    const sourceEntry = lstatSync(canonicalSource);
    if (!sourceEntry.isFile()) {
      throw new Error(`Protected ${name} source must be a regular file`);
    }
    return {
      destinationDirectory,
      destinationName,
      source: canonicalSource,
      sourceEntry,
    };
  });

  let created = false;
  try {
    mkdirSync(canonicalToolsRoot, { mode: 0o755 });
    created = true;
    chmodSync(canonicalToolsRoot, 0o755);
    const binDirectory = join(canonicalToolsRoot, "bin");
    const bootstrapBinDirectory = join(canonicalToolsRoot, "bootstrap-bin");
    for (const directory of [binDirectory, bootstrapBinDirectory]) {
      mkdirSync(directory, { mode: 0o755 });
      chmodSync(directory, 0o755);
    }
    assertProtectedRuntimeEntry(canonicalToolsRoot, {
      directory: true,
      expectedUid: uid,
      expectedGid: gid,
    });
    for (const directory of [binDirectory, bootstrapBinDirectory]) {
      assertProtectedRuntimeEntry(directory, {
        directory: true,
        expectedUid: uid,
        expectedGid: gid,
      });
    }

    const staged = {};
    for (const {
      destinationDirectory,
      destinationName,
      source,
      sourceEntry,
    } of sources) {
      const destination = join(
        canonicalToolsRoot,
        destinationDirectory,
        destinationName,
      );
      copyFileSync(source, destination, fsConstants.COPYFILE_EXCL);
      chmodSync(destination, 0o555);
      const destinationEntry = assertProtectedRuntimeEntry(destination, {
        directory: false,
        expectedUid: uid,
        expectedGid: gid,
      });
      if (
        realpathSync(destination) !== destination ||
        (destinationEntry.dev === sourceEntry.dev &&
          destinationEntry.ino === sourceEntry.ino)
      ) {
        throw new Error("Protected runtime copy is not independent");
      }
      staged[destinationName] = destination;
    }
    const stagedPnpmDigest = createHash("sha256")
      .update(readFileSync(staged.pnpm))
      .digest("hex");
    if (stagedPnpmDigest !== expectedPnpmSha256) {
      throw new Error("Protected pnpm bootstrap copy digest is invalid");
    }
    return {
      binDirectory,
      bootstrapBinDirectory,
      nodePath: staged.node,
      pnpmBootstrapPath: staged.pnpm,
    };
  } catch (error) {
    if (created) rmSync(canonicalToolsRoot, { force: true, recursive: true });
    throw error;
  }
}

export function stageTrustedPnpmRuntimeManifest({ controllerRoot, toolsRoot }) {
  requiredText(controllerRoot, "Trusted controller path");
  requiredText(toolsRoot, "Trusted Vercel tools path");
  if (!isAbsolute(controllerRoot) || !isAbsolute(toolsRoot)) {
    throw new Error("Trusted pnpm runtime paths must be absolute");
  }

  const currentUid = process.getuid?.();
  const currentGid = process.getgid?.();
  if (currentUid === undefined || currentGid === undefined) {
    throw new Error("Trusted pnpm runtime requires a POSIX identity");
  }
  const canonicalControllerRoot = realpathSync(controllerRoot);
  const canonicalToolsRoot = realpathSync(toolsRoot);
  assertProtectedRuntimeEntry(canonicalControllerRoot, {
    directory: true,
    expectedUid: currentUid,
    expectedGid: currentGid,
  });
  assertProtectedRuntimeEntry(canonicalToolsRoot, {
    directory: true,
    expectedUid: currentUid,
    expectedGid: currentGid,
  });
  const toolsFromController = relative(
    canonicalControllerRoot,
    canonicalToolsRoot,
  );
  if (
    toolsFromController !== ".." &&
    !toolsFromController.startsWith(`..${sep}`)
  ) {
    throw new Error("Trusted pnpm runtime must be outside the checkout");
  }

  const sourceRoot = join(
    canonicalControllerRoot,
    "scripts",
    "vercel-pnpm-runtime",
  );
  assertProtectedRuntimeDescendant({
    root: canonicalControllerRoot,
    path: sourceRoot,
    directory: true,
    expectedUid: currentUid,
    expectedGid: currentGid,
  });
  const sourcePackageJson = assertProtectedRuntimeDescendant({
    root: canonicalControllerRoot,
    path: join(sourceRoot, "package.json"),
    directory: false,
    expectedUid: currentUid,
    expectedGid: currentGid,
  });
  const sourceLockfile = assertProtectedRuntimeDescendant({
    root: canonicalControllerRoot,
    path: join(sourceRoot, "pnpm-lock.yaml"),
    directory: false,
    expectedUid: currentUid,
    expectedGid: currentGid,
  });
  const packageMetadata = JSON.parse(
    readFileSync(sourcePackageJson.path, "utf8"),
  );
  if (
    !hasExactObjectKeys(packageMetadata, [
      "dependencies",
      "description",
      "name",
      "private",
      "version",
    ]) ||
    packageMetadata.name !== "@mento-protocol/vercel-pnpm-runtime" ||
    packageMetadata.version !== "0.0.0" ||
    packageMetadata.private !== true ||
    packageMetadata.description !==
      "Isolated pnpm runtime for candidate-controlled Vercel builds" ||
    !hasExactObjectKeys(packageMetadata.dependencies, ["pnpm"]) ||
    packageMetadata.dependencies?.pnpm !== PINNED_PNPM_VERSION ||
    packageMetadata.scripts !== undefined
  ) {
    throw new Error("Trusted pnpm runtime manifest is not exact");
  }
  const sourceLockfileContents = readFileSync(sourceLockfile.path);
  const sourceLockfileDigest = createHash("sha256")
    .update(sourceLockfileContents)
    .digest("hex");
  if (sourceLockfileDigest !== PINNED_PNPM_RUNTIME_LOCKFILE_SHA256) {
    throw new Error("Trusted pnpm runtime lockfile is not exact");
  }

  const runtimeRoot = join(canonicalToolsRoot, PNPM_RUNTIME_DIRECTORY);
  if (optionalEntry(runtimeRoot)) {
    throw new Error("Trusted pnpm runtime destination must be fresh");
  }
  let created = false;
  try {
    mkdirSync(runtimeRoot, { mode: 0o755 });
    created = true;
    chmodSync(runtimeRoot, 0o755);
    assertProtectedRuntimeEntry(runtimeRoot, {
      directory: true,
      expectedUid: currentUid,
      expectedGid: currentGid,
    });
    for (const [name, source] of [
      ["package.json", sourcePackageJson],
      ["pnpm-lock.yaml", sourceLockfile],
    ]) {
      const destination = join(runtimeRoot, name);
      copyFileSync(source.path, destination, fsConstants.COPYFILE_EXCL);
      chmodSync(destination, 0o444);
      const destinationEntry = assertProtectedRuntimeEntry(destination, {
        directory: false,
        expectedUid: currentUid,
        expectedGid: currentGid,
      });
      if (
        realpathSync(destination) !== destination ||
        (destinationEntry.dev === source.entry.dev &&
          destinationEntry.ino === source.entry.ino)
      ) {
        throw new Error("Trusted pnpm runtime copy is not independent");
      }
    }
    return runtimeRoot;
  } catch (error) {
    if (created) rmSync(runtimeRoot, { force: true, recursive: true });
    throw error;
  }
}

function validatePinnedVercelCliRuntimeFiles({
  rootPackageJsonPath,
  packageJsonPath,
  lockfilePath,
}) {
  return assertVercelCliRuntimeContract({
    rootPackageJsonPath,
    packageJsonPath,
    lockfilePath,
  });
}

export function stageTrustedVercelCliRuntimeManifest({
  controllerRoot,
  toolsRoot,
}) {
  requiredText(controllerRoot, "Trusted controller path");
  requiredText(toolsRoot, "Trusted Vercel tools path");
  if (!isAbsolute(controllerRoot) || !isAbsolute(toolsRoot)) {
    throw new Error("Trusted Vercel CLI runtime paths must be absolute");
  }

  const currentUid = process.getuid?.();
  const currentGid = process.getgid?.();
  if (currentUid === undefined || currentGid === undefined) {
    throw new Error("Trusted Vercel CLI runtime requires a POSIX identity");
  }
  const canonicalControllerRoot = realpathSync(controllerRoot);
  const canonicalToolsRoot = realpathSync(toolsRoot);
  assertProtectedRuntimeEntry(canonicalControllerRoot, {
    directory: true,
    expectedUid: currentUid,
    expectedGid: currentGid,
  });
  assertProtectedRuntimeEntry(canonicalToolsRoot, {
    directory: true,
    expectedUid: currentUid,
    expectedGid: currentGid,
  });
  const toolsFromController = relative(
    canonicalControllerRoot,
    canonicalToolsRoot,
  );
  if (
    toolsFromController !== ".." &&
    !toolsFromController.startsWith(`..${sep}`)
  ) {
    throw new Error("Trusted Vercel CLI runtime must be outside the checkout");
  }

  const rootPackageJson = assertProtectedRuntimeDescendant({
    root: canonicalControllerRoot,
    path: join(canonicalControllerRoot, "package.json"),
    directory: false,
    expectedUid: currentUid,
    expectedGid: currentGid,
  });
  const sourceRoot = join(
    canonicalControllerRoot,
    "scripts",
    VERCEL_CLI_RUNTIME_DIRECTORY,
  );
  assertProtectedRuntimeDescendant({
    root: canonicalControllerRoot,
    path: sourceRoot,
    directory: true,
    expectedUid: currentUid,
    expectedGid: currentGid,
  });
  const sourcePackageJson = assertProtectedRuntimeDescendant({
    root: canonicalControllerRoot,
    path: join(sourceRoot, "package.json"),
    directory: false,
    expectedUid: currentUid,
    expectedGid: currentGid,
  });
  const sourceLockfile = assertProtectedRuntimeDescendant({
    root: canonicalControllerRoot,
    path: join(sourceRoot, "pnpm-lock.yaml"),
    directory: false,
    expectedUid: currentUid,
    expectedGid: currentGid,
  });
  validatePinnedVercelCliRuntimeFiles({
    rootPackageJsonPath: rootPackageJson.path,
    packageJsonPath: sourcePackageJson.path,
    lockfilePath: sourceLockfile.path,
  });

  const runtimeRoot = join(canonicalToolsRoot, VERCEL_CLI_RUNTIME_DIRECTORY);
  if (optionalEntry(runtimeRoot)) {
    throw new Error("Trusted Vercel CLI runtime destination must be fresh");
  }
  let created = false;
  try {
    mkdirSync(runtimeRoot, { mode: 0o755 });
    created = true;
    chmodSync(runtimeRoot, 0o755);
    assertProtectedRuntimeEntry(runtimeRoot, {
      directory: true,
      expectedUid: currentUid,
      expectedGid: currentGid,
    });
    for (const [name, source] of [
      ["package.json", sourcePackageJson],
      ["pnpm-lock.yaml", sourceLockfile],
    ]) {
      const destination = join(runtimeRoot, name);
      copyFileSync(source.path, destination, fsConstants.COPYFILE_EXCL);
      chmodSync(destination, 0o444);
      const destinationEntry = assertProtectedRuntimeEntry(destination, {
        directory: false,
        expectedUid: currentUid,
        expectedGid: currentGid,
      });
      if (
        realpathSync(destination) !== destination ||
        (destinationEntry.dev === source.entry.dev &&
          destinationEntry.ino === source.entry.ino)
      ) {
        throw new Error("Trusted Vercel CLI runtime copy is not independent");
      }
    }
    validatePinnedVercelCliRuntimeFiles({
      rootPackageJsonPath: rootPackageJson.path,
      packageJsonPath: join(runtimeRoot, "package.json"),
      lockfilePath: join(runtimeRoot, "pnpm-lock.yaml"),
    });
    return runtimeRoot;
  } catch (error) {
    if (created) rmSync(runtimeRoot, { force: true, recursive: true });
    throw error;
  }
}

export function trustedStandaloneVercelCliPath({ controllerRoot, toolsRoot }) {
  requiredText(controllerRoot, "Trusted controller path");
  requiredText(toolsRoot, "Trusted Vercel tools path");
  if (!isAbsolute(controllerRoot) || !isAbsolute(toolsRoot)) {
    throw new Error("Trusted Vercel CLI paths must be absolute");
  }

  const currentUid = process.getuid?.();
  const currentGid = process.getgid?.();
  if (currentUid === undefined || currentGid === undefined) {
    throw new Error("Trusted Vercel CLI requires a POSIX identity");
  }
  const canonicalControllerRoot = realpathSync(controllerRoot);
  const canonicalToolsRoot = realpathSync(toolsRoot);
  assertProtectedRuntimeEntry(canonicalControllerRoot, {
    directory: true,
    expectedUid: currentUid,
    expectedGid: currentGid,
  });
  assertProtectedRuntimeEntry(canonicalToolsRoot, {
    directory: true,
    expectedUid: currentUid,
    expectedGid: currentGid,
  });
  const toolsFromController = relative(
    canonicalControllerRoot,
    canonicalToolsRoot,
  );
  if (
    toolsFromController !== ".." &&
    !toolsFromController.startsWith(`..${sep}`)
  ) {
    throw new Error("Trusted Vercel CLI tools must be outside the checkout");
  }

  const rootPackageJson = assertProtectedRuntimeDescendant({
    root: canonicalControllerRoot,
    path: join(canonicalControllerRoot, "package.json"),
    directory: false,
    expectedUid: currentUid,
    expectedGid: currentGid,
  });
  const runtimeRoot = join(canonicalToolsRoot, VERCEL_CLI_RUNTIME_DIRECTORY);
  assertProtectedRuntimeDescendant({
    root: canonicalToolsRoot,
    path: runtimeRoot,
    directory: true,
    expectedUid: currentUid,
    expectedGid: currentGid,
  });
  const runtimePackageJson = assertProtectedRuntimeDescendant({
    root: canonicalToolsRoot,
    path: join(runtimeRoot, "package.json"),
    directory: false,
    expectedUid: currentUid,
    expectedGid: currentGid,
  });
  const runtimeLockfile = assertProtectedRuntimeDescendant({
    root: canonicalToolsRoot,
    path: join(runtimeRoot, "pnpm-lock.yaml"),
    directory: false,
    expectedUid: currentUid,
    expectedGid: currentGid,
  });
  if (
    (runtimePackageJson.entry.mode & 0o777) !== 0o444 ||
    (runtimeLockfile.entry.mode & 0o777) !== 0o444
  ) {
    throw new Error("Trusted Vercel CLI runtime contract is writable");
  }
  validatePinnedVercelCliRuntimeFiles({
    rootPackageJsonPath: rootPackageJson.path,
    packageJsonPath: runtimePackageJson.path,
    lockfilePath: runtimeLockfile.path,
  });

  const virtualStoreRoot = join(runtimeRoot, "node_modules", ".pnpm");
  assertProtectedRuntimeDescendant({
    root: canonicalToolsRoot,
    path: virtualStoreRoot,
    directory: true,
    expectedUid: currentUid,
    expectedGid: currentGid,
  });
  const packageLinkPath = join(runtimeRoot, "node_modules", "vercel");
  const packageLink = lstatSync(packageLinkPath);
  const packageLinkTarget = readlinkSync(packageLinkPath);
  const canonicalPackageRoot = realpathSync(packageLinkPath);
  const packageFromVirtualStore = relative(
    realpathSync(virtualStoreRoot),
    canonicalPackageRoot,
  );
  if (
    !packageLink.isSymbolicLink() ||
    packageLink.uid !== currentUid ||
    packageLink.gid !== currentGid ||
    packageLink.nlink !== 1 ||
    isAbsolute(packageLinkTarget) ||
    hasControlCharacters(packageLinkTarget) ||
    packageLinkTarget !==
      relative(dirname(packageLinkPath), canonicalPackageRoot) ||
    !/^vercel@56\.2\.0(?:_[^/]+)?\/node_modules\/vercel$/u.test(
      packageFromVirtualStore,
    )
  ) {
    throw new Error("Trusted Vercel CLI package link is not exact");
  }
  assertProtectedRuntimeDescendant({
    root: canonicalToolsRoot,
    path: canonicalPackageRoot,
    directory: true,
    expectedUid: currentUid,
    expectedGid: currentGid,
  });

  const installedPackageJsonPath = join(canonicalPackageRoot, "package.json");
  const cliPath = join(canonicalPackageRoot, "dist", "index.js");
  for (const path of [installedPackageJsonPath, cliPath]) {
    if (lstatSync(path).isSymbolicLink() || realpathSync(path) !== path) {
      throw new Error("Trusted Vercel CLI path is not a real file");
    }
  }
  const installedPackageJson = assertProtectedRuntimeDescendant({
    root: canonicalToolsRoot,
    path: installedPackageJsonPath,
    directory: false,
    expectedUid: currentUid,
    expectedGid: currentGid,
  });
  const cli = assertProtectedRuntimeDescendant({
    root: canonicalToolsRoot,
    path: cliPath,
    directory: false,
    expectedUid: currentUid,
    expectedGid: currentGid,
  });
  const installedPackageMetadata = JSON.parse(
    readFileSync(installedPackageJson.path, "utf8"),
  );
  if (
    installedPackageMetadata.name !== "vercel" ||
    installedPackageMetadata.version !== PINNED_VERCEL_CLI_VERSION ||
    !cli.entry.isFile()
  ) {
    throw new Error("Trusted Vercel CLI is not the pinned release");
  }
  return cli.path;
}

export function stageTrustedPnpmLauncher({ toolsRoot }) {
  requiredText(toolsRoot, "Trusted Vercel tools path");
  if (!isAbsolute(toolsRoot)) {
    throw new Error("Trusted Vercel tools path must be absolute");
  }
  const canonicalToolsRoot = realpathSync(toolsRoot);
  const currentUid = process.getuid?.();
  const currentGid = process.getgid?.();
  if (currentUid === undefined || currentGid === undefined) {
    throw new Error("Trusted pnpm launcher requires a POSIX identity");
  }
  assertProtectedRuntimeEntry(canonicalToolsRoot, {
    directory: true,
    expectedUid: currentUid,
    expectedGid: currentGid,
  });

  const binDirectory = join(canonicalToolsRoot, "bin");
  const nodePath = join(binDirectory, "node");
  assertProtectedRuntimeDescendant({
    root: canonicalToolsRoot,
    path: binDirectory,
    directory: true,
    expectedUid: currentUid,
    expectedGid: currentGid,
  });
  assertProtectedRuntimeDescendant({
    root: canonicalToolsRoot,
    path: nodePath,
    directory: false,
    expectedUid: currentUid,
    expectedGid: currentGid,
    requireSingleLink: true,
  });

  const pnpmPackageRoot = join(
    canonicalToolsRoot,
    PNPM_RUNTIME_DIRECTORY,
    "node_modules",
    "pnpm",
  );
  const packageJsonPath = join(pnpmPackageRoot, "package.json");
  const cliPath = join(pnpmPackageRoot, "bin", "pnpm.cjs");
  const packageJson = assertProtectedRuntimeDescendant({
    root: canonicalToolsRoot,
    path: packageJsonPath,
    directory: false,
    expectedUid: currentUid,
    expectedGid: currentGid,
    requireSingleLink: true,
  });
  const cli = assertProtectedRuntimeDescendant({
    root: canonicalToolsRoot,
    path: cliPath,
    directory: false,
    expectedUid: currentUid,
    expectedGid: currentGid,
    requireSingleLink: true,
  });
  const packageMetadata = JSON.parse(readFileSync(packageJson.path, "utf8"));
  if (
    packageMetadata.name !== "pnpm" ||
    packageMetadata.version !== PINNED_PNPM_VERSION ||
    !cli.entry.isFile()
  ) {
    throw new Error("Trusted pnpm package does not match the pinned release");
  }

  const launcherPath = join(binDirectory, "pnpm");
  if (optionalEntry(launcherPath)) {
    throw new Error("Trusted pnpm launcher destination must be fresh");
  }
  writeFileSync(
    launcherPath,
    [
      "#!/bin/sh",
      "basedir=${0%/*}",
      "unset NPM_CONFIG_MANAGE_PACKAGE_MANAGER_VERSIONS NPM_CONFIG_PACKAGE_MANAGER_STRICT_VERSION",
      "export npm_config_manage_package_manager_versions=false",
      "export npm_config_package_manager_strict_version=false",
      'exec "$basedir/node" "$basedir/../pnpm-runtime/node_modules/pnpm/bin/pnpm.cjs" "$@"',
      "",
    ].join("\n"),
    { flag: "wx", mode: 0o555 },
  );
  chmodSync(launcherPath, 0o555);
  const launcher = assertProtectedRuntimeDescendant({
    root: canonicalToolsRoot,
    path: launcherPath,
    directory: false,
    expectedUid: currentUid,
    expectedGid: currentGid,
    requireSingleLink: true,
  });
  if (realpathSync(launcher.path) !== launcher.path) {
    throw new Error("Trusted pnpm launcher is not independent");
  }
  return launcher.path;
}

function trustedPnpmInstallLayout({ controllerRoot, toolsRoot }) {
  requiredText(controllerRoot, "Trusted controller path");
  requiredText(toolsRoot, "Trusted Vercel tools path");
  if (!isAbsolute(controllerRoot) || !isAbsolute(toolsRoot)) {
    throw new Error("Trusted pnpm install paths must be absolute");
  }

  const realControllerRoot = realpathSync(controllerRoot);
  const realToolsRoot = realpathSync(toolsRoot);
  const controllerEntry = lstatSync(realControllerRoot);
  const toolsEntry = lstatSync(realToolsRoot);
  const currentUid = process.getuid?.();
  if (
    currentUid === undefined ||
    controllerEntry.isSymbolicLink() ||
    !controllerEntry.isDirectory() ||
    controllerEntry.uid !== currentUid ||
    (controllerEntry.mode & 0o022) !== 0 ||
    toolsEntry.isSymbolicLink() ||
    !toolsEntry.isDirectory() ||
    toolsEntry.uid !== currentUid ||
    (toolsEntry.mode & 0o022) !== 0
  ) {
    throw new Error("Trusted pnpm install roots are not runner-protected");
  }

  const toolsFromController = relative(realControllerRoot, realToolsRoot);
  if (
    toolsFromController !== ".." &&
    !toolsFromController.startsWith(`..${sep}`)
  ) {
    throw new Error("Trusted Vercel tools must be outside the checkout");
  }

  const modulesPath = join(realToolsRoot, "node_modules");
  const modulesDir = relative(realControllerRoot, modulesPath);
  if (
    modulesDir === "" ||
    isAbsolute(modulesDir) ||
    hasControlCharacters(modulesDir) ||
    resolve(realControllerRoot, modulesDir) !== modulesPath
  ) {
    throw new Error("Trusted pnpm modules path is invalid");
  }
  return {
    modulesDir,
    virtualStoreDir: join(modulesDir, ".pnpm"),
  };
}

export function trustedVercelCliPath(toolsPath) {
  requiredText(toolsPath, "Trusted Vercel tools path");
  if (!isAbsolute(toolsPath)) {
    throw new Error("Trusted Vercel tools path must be absolute");
  }
  const toolsEntry = lstatSync(toolsPath);
  const currentUid = process.getuid?.();
  if (
    toolsEntry.isSymbolicLink() ||
    !toolsEntry.isDirectory() ||
    currentUid === undefined ||
    toolsEntry.uid !== currentUid ||
    (toolsEntry.mode & 0o022) !== 0
  ) {
    throw new Error("Trusted Vercel tools directory is not runner-owned");
  }

  const realToolsPath = realpathSync(toolsPath);
  const cliPath = realpathSync(
    join(toolsPath, "node_modules", "vercel", "dist", "index.js"),
  );
  const pathFromTools = relative(realToolsPath, cliPath);
  if (
    pathFromTools === "" ||
    pathFromTools === ".." ||
    pathFromTools.startsWith(`..${sep}`) ||
    isAbsolute(pathFromTools)
  ) {
    throw new Error("Trusted Vercel CLI resolves outside its tools directory");
  }
  const cliEntry = lstatSync(cliPath);
  if (
    cliEntry.isSymbolicLink() ||
    !cliEntry.isFile() ||
    cliEntry.uid !== currentUid ||
    (cliEntry.mode & 0o022) !== 0
  ) {
    throw new Error("Trusted Vercel CLI is not a protected runner-owned file");
  }
  const packagePath = resolve(cliPath, "..", "..", "package.json");
  const packageEntry = lstatSync(packagePath);
  if (
    packageEntry.isSymbolicLink() ||
    !packageEntry.isFile() ||
    packageEntry.uid !== currentUid ||
    (packageEntry.mode & 0o022) !== 0 ||
    JSON.parse(readFileSync(packagePath, "utf8")).version !== "56.2.0"
  ) {
    throw new Error("Trusted Vercel CLI version is not the pinned release");
  }
  return cliPath;
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
    branch: metadata.githubCommitRef,
    sha: metadata.githubCommitSha,
    limit: "100",
    since: String(window.since),
    until: String(window.until),
  });
  return `https://api.vercel.com/v7/deployments?${query}`;
}

function normalizeVercelLookupCreatedAt(value) {
  const timestamp =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^[1-9][0-9]{0,15}$/.test(value)
        ? Number(value)
        : Number.NaN;
  return Number.isSafeInteger(timestamp) && timestamp > 0 ? timestamp : null;
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
  const pagination = parsed?.pagination;
  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    !Array.isArray(parsed.deployments) ||
    parsed.deployments.length > 100 ||
    (pagination !== undefined &&
      (pagination === null ||
        typeof pagination !== "object" ||
        Array.isArray(pagination))) ||
    (pagination?.next !== undefined && pagination.next !== null)
  ) {
    throw new Error("Vercel deployment lookup response is malformed");
  }
  const metadata = uploadMetadata({ commitSha, gitBranch, idempotencyKey });
  const window = uploadLookupWindow(startedAtMs, nowMs);
  return parsed.deployments.flatMap((deployment) => {
    if (
      !deployment ||
      typeof deployment !== "object" ||
      Array.isArray(deployment)
    ) {
      throw new Error("Vercel deployment lookup response is malformed");
    }
    const hasExactMetadata =
      deployment.meta &&
      typeof deployment.meta === "object" &&
      !Array.isArray(deployment.meta) &&
      Object.entries(metadata).every(
        ([name, value]) => deployment.meta[name] === value,
      );
    if (!hasExactMetadata) return [];

    const createdAt = normalizeVercelLookupCreatedAt(deployment?.createdAt);
    if (
      deployment.projectId !== projectId ||
      createdAt === null ||
      createdAt < window.since ||
      createdAt > window.until ||
      (deployment.target !== null &&
        deployment.target !== undefined &&
        deployment.target !== "preview")
    ) {
      throw new Error(
        "Vercel deployment lookup result does not match the exact upload tuple",
      );
    }
    if (!VERCEL_DEPLOYMENT_ID_PATTERN.test(String(deployment.uid ?? ""))) {
      throw new Error("Vercel deploy returned no valid deployment ID");
    }
    if (deployment.url === null) {
      return [
        {
          deploymentId: deployment.uid,
          deploymentUrl: null,
          readyState: deployment.readyState,
          target: "preview",
          incomplete: true,
        },
      ];
    }
    return [
      parseVercelDeploymentJson(
        JSON.stringify({
          id: deployment.uid,
          url: deployment.url,
          readyState: deployment.readyState,
          target: "preview",
        }),
      ),
    ];
  });
}

async function boundedUploadLookup({ lookup, waitForRetry }) {
  const incompleteDeploymentIds = new Set();
  for (let attempt = 0; attempt < UPLOAD_LOOKUP_ATTEMPTS; attempt += 1) {
    const matches = normalizeUploadLookupMatches(await lookup());
    if (!Array.isArray(matches) || matches.length > 2) {
      throw new Error("Vercel deployment lookup is indeterminate");
    }
    if (matches.length > 1) {
      throw new Error("Multiple Vercel deployments match one controller key");
    }
    if (matches.length === 1) {
      const [match] = matches;
      if (match.incomplete) {
        incompleteDeploymentIds.add(match.deploymentId);
        if (incompleteDeploymentIds.size > 1) {
          throw new Error(
            "Multiple Vercel deployments match one controller key",
          );
        }
      } else {
        if (
          incompleteDeploymentIds.size === 1 &&
          !incompleteDeploymentIds.has(match.deploymentId)
        ) {
          throw new Error(
            "Multiple Vercel deployments match one controller key",
          );
        }
        return matches;
      }
    }
    if (attempt < UPLOAD_LOOKUP_ATTEMPTS - 1) {
      await waitForRetry(UPLOAD_LOOKUP_DELAY_MS);
    }
  }
  if (incompleteDeploymentIds.size > 0) {
    throw new Error(
      "Exact Vercel deployment remained incomplete or disappeared during lookup",
    );
  }
  return [];
}

function normalizeUploadLookupMatches(matches) {
  if (!Array.isArray(matches) || matches.length > 2) {
    throw new Error("Vercel deployment lookup is indeterminate");
  }
  return matches.map((match) => {
    if (match?.incomplete === true) {
      if (
        !VERCEL_DEPLOYMENT_ID_PATTERN.test(String(match.deploymentId ?? "")) ||
        match.deploymentUrl !== null ||
        match.target !== "preview"
      ) {
        throw new Error("Vercel deployment lookup is indeterminate");
      }
      return {
        deploymentId: match.deploymentId,
        deploymentUrl: null,
        readyState: match.readyState,
        target: "preview",
        incomplete: true,
      };
    }
    return parseVercelDeploymentJson(
      JSON.stringify({
        id: match?.deploymentId,
        url: match?.deploymentUrl,
        readyState: match?.readyState,
        target: match?.target,
      }),
    );
  });
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
  const deploymentIds = new Set();
  let becameVisible = false;
  let becameComplete = false;
  let disappearedAfterVisibility = false;
  let regressedAfterCompletion = false;
  for (const matches of observations) {
    if (matches.length === 0) {
      if (becameVisible) disappearedAfterVisibility = true;
      continue;
    }
    if (matches.length > 1) {
      throw new Error(
        "Retried Vercel upload converged on multiple deployment identities",
      );
    }
    becameVisible = true;
    for (const match of matches) {
      deploymentIds.add(match.deploymentId);
      if (match.incomplete) {
        if (becameComplete) regressedAfterCompletion = true;
        continue;
      }
      becameComplete = true;
      identities.set(`${match.deploymentId}\n${match.deploymentUrl}`, match);
    }
  }
  if (deploymentIds.size > 1 || identities.size > 1) {
    throw new Error(
      "Retried Vercel upload converged on multiple deployment identities",
    );
  }
  if (disappearedAfterVisibility || regressedAfterCompletion) {
    throw new Error(
      "Retried Vercel upload lookup did not converge monotonically",
    );
  }
  if (deploymentIds.size === 1 && identities.size === 0) {
    throw new Error(
      "Retried Vercel upload remained incomplete without an immutable URL",
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
  requiredText(repoRoot, "Source path");
  targetRootDirectory(expectedRootDirectory);
  const realRepoRoot = realpathSync(repoRoot);
  const targetRoot = join(repoRoot, expectedRootDirectory);
  const pathFromRepo = relative(realRepoRoot, realpathSync(targetRoot));
  if (
    pathFromRepo === "" ||
    pathFromRepo === ".." ||
    pathFromRepo.startsWith(`..${sep}`) ||
    isAbsolute(pathFromRepo)
  ) {
    throw new Error("Expected Root Directory escapes the source path");
  }
  const repoLinkPath = join(repoRoot, ".vercel", "repo.json");
  const settingsPath = join(targetRoot, ".vercel", "project.json");
  let repoLink;
  let project;
  try {
    for (const [path, label, directory] of [
      [repoRoot, "Source path", true],
      [join(repoRoot, ".vercel"), "Repo-level Vercel state", true],
      [repoLinkPath, "Repo-level Vercel link", false],
      [targetRoot, "Target Root Directory", true],
      [join(targetRoot, ".vercel"), "Target Vercel state", true],
      [settingsPath, "Pulled Vercel project settings", false],
    ]) {
      const entry = lstatSync(path);
      if (
        entry.isSymbolicLink() ||
        (directory ? !entry.isDirectory() : !entry.isFile())
      ) {
        throw new Error(`${label} has an unsafe filesystem type`);
      }
    }
    repoLink = JSON.parse(readFileSync(repoLinkPath, "utf8"));
    project = JSON.parse(readFileSync(settingsPath, "utf8"));
  } catch {
    throw new Error("Vercel pull did not materialize valid project settings");
  }
  const linkedProject = repoLink.projects?.[0];
  const projectHasNoIdentity =
    project.orgId === undefined && project.projectId === undefined;
  const projectHasExactIdentity =
    project.orgId === vercelOrgId && project.projectId === vercelProjectId;
  if (
    repoLink.remoteName !== "origin" ||
    repoLink.projects?.length !== 1 ||
    linkedProject?.orgId !== vercelOrgId ||
    linkedProject?.id !== vercelProjectId ||
    linkedProject?.directory !== expectedRootDirectory ||
    (!projectHasNoIdentity && !projectHasExactIdentity) ||
    project.settings?.rootDirectory !== expectedRootDirectory
  ) {
    throw new Error(
      "Pulled Vercel project mapping does not match the selected target",
    );
  }
  return project;
}

export function assertSharpPrebuiltArtifacts(
  outputDirectory,
  { runtimePlatform = sharpRuntimePlatform() } = {},
) {
  const functionsDirectory = join(outputDirectory, "functions");
  const pending = [];
  const artifactsByFunction = new Map();
  const validatedFunctions = new Set();

  try {
    const functionsEntry = lstatSync(functionsDirectory);
    if (!functionsEntry.isSymbolicLink() && functionsEntry.isDirectory()) {
      pending.push(functionsDirectory);
    }
  } catch {
    // A static-only or malformed output cannot satisfy the Sharp runtime guard.
  }

  while (pending.length > 0) {
    const path = pending.pop();
    const entry = lstatSync(path);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      for (const child of readdirSync(path)) {
        pending.push(join(path, child));
      }
      continue;
    }
    if (!entry.isFile()) continue;

    const sourceParts = relative(outputDirectory, path).split(sep);
    const functionDirectory = findPhysicalFunctionDirectory(
      outputDirectory,
      sourceParts,
    );
    if (functionDirectory === undefined) continue;
    if (!validatedFunctions.has(functionDirectory)) {
      const configPath = join(functionDirectory, ".vc-config.json");
      assertStandaloneVercelConfig(configPath, lstatSync(configPath));
      validatedFunctions.add(functionDirectory);
    }

    let artifacts = artifactsByFunction.get(functionDirectory);
    if (!artifacts) {
      artifacts = {
        nativeAddon: undefined,
        sharedLibraries: [],
        versionsManifests: [],
      };
      artifactsByFunction.set(functionDirectory, artifacts);
    }

    if (
      basename(path) ===
      `sharp-${runtimePlatform}-${SHARP_RUNTIME_VERSION}.node`
    ) {
      artifacts.nativeAddon = path;
    }
    if (LIBVIPS_SHARED_LIBRARY_PATTERN.test(basename(path))) {
      artifacts.sharedLibraries.push(path);
    }
    if (basename(path) === "versions.json" && path.includes("sharp-libvips-")) {
      try {
        if (JSON.parse(readFileSync(path, "utf8")).vips === "8.18.3") {
          artifacts.versionsManifests.push(path);
        }
      } catch {
        // The exact artifact checks below fail closed.
      }
    }
  }

  for (const artifacts of artifactsByFunction.values()) {
    if (!artifacts.nativeAddon) continue;
    if (runtimePlatform.startsWith("win32-")) {
      return { nativeAddon: artifacts.nativeAddon };
    }
    const packageSegment = `sharp-libvips-${runtimePlatform}`;
    const sharedLibrary = artifacts.sharedLibraries.find((path) =>
      path.includes(packageSegment),
    );
    const versionsManifest = artifacts.versionsManifests.find((path) =>
      path.includes(packageSegment),
    );
    if (sharedLibrary && versionsManifest) {
      return {
        nativeAddon: artifacts.nativeAddon,
        sharedLibrary,
        versionsManifest,
      };
    }
  }

  throw new Error(
    `Prebuilt output is missing sharp ${SHARP_RUNTIME_VERSION}'s ${runtimePlatform} native addon or its matching libvips 8.18.3 runtime`,
  );
}

export function assertPrebuiltOutput({
  repoRoot,
  expectedRootDirectory,
  deploymentId,
  expectedUid = process.getuid?.(),
  expectedGid = process.getgid?.(),
}) {
  const outputDirectory = join(
    repoRoot,
    expectedRootDirectory,
    ".vercel",
    "output",
  );
  const configPath = join(outputDirectory, "config.json");
  assertSafeOutputTree(outputDirectory, { expectedUid, expectedGid });
  assertSharpPrebuiltArtifacts(outputDirectory);
  const configEntry = lstatSync(configPath);
  if (configEntry.isSymbolicLink() || !configEntry.isFile()) {
    throw new Error("Prebuilt output config is not a regular file");
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

function numericIdentity(value, label) {
  const numeric = typeof value === "string" ? Number(value) : value;
  if (!Number.isSafeInteger(numeric) || numeric < 0) {
    throw new Error(`${label} is invalid`);
  }
  return numeric;
}

function isStrictDescendant(root, path) {
  const pathFromRoot = relative(root, path);
  return (
    pathFromRoot !== "" &&
    pathFromRoot !== ".." &&
    !pathFromRoot.startsWith(`..${sep}`) &&
    !isAbsolute(pathFromRoot)
  );
}

function findPhysicalFunctionDirectory(outputDirectory, sourceParts) {
  for (let index = sourceParts.length - 2; index > 0; index -= 1) {
    if (!sourceParts[index].endsWith(".func")) continue;
    const functionDirectory = join(
      outputDirectory,
      ...sourceParts.slice(0, index + 1),
    );
    try {
      const functionEntry = lstatSync(functionDirectory);
      const configEntry = lstatSync(join(functionDirectory, ".vc-config.json"));
      if (
        !functionEntry.isSymbolicLink() &&
        functionEntry.isDirectory() &&
        !configEntry.isSymbolicLink() &&
        configEntry.isFile()
      ) {
        return functionDirectory;
      }
    } catch {
      // A route directory may itself end in .func without being a function.
    }
  }
  return undefined;
}

function assertContainedFunctionDependencyLink(
  physicalFunctionDirectory,
  path,
  lexicalTarget,
) {
  let canonicalFunctionDirectory;
  try {
    canonicalFunctionDirectory = realpathSync(physicalFunctionDirectory);
  } catch {
    throw new Error("Prebuilt function symbolic link target is invalid");
  }
  const lexicalTargetFromFunction = relative(
    physicalFunctionDirectory,
    lexicalTarget,
  );
  if (
    !isStrictDescendant(physicalFunctionDirectory, lexicalTarget) ||
    isStrictDescendant(lexicalTarget, path) ||
    isStrictDescendant(path, lexicalTarget)
  ) {
    throw new Error("Prebuilt function symbolic link escaped its scope");
  }
  const targetParts = lexicalTargetFromFunction.split(sep);
  let current = physicalFunctionDirectory;
  let targetEntry;
  for (const [index, part] of targetParts.entries()) {
    current = join(current, part);
    try {
      targetEntry = lstatSync(current);
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw new Error("Prebuilt function symbolic link target is invalid");
    }
    const final = index === targetParts.length - 1;
    if (
      targetEntry.isSymbolicLink() ||
      (final
        ? !targetEntry.isDirectory() && !targetEntry.isFile()
        : !targetEntry.isDirectory())
    ) {
      throw new Error("Prebuilt function symbolic link escaped its scope");
    }
  }
  let canonicalTarget;
  try {
    canonicalTarget = realpathSync(lexicalTarget);
  } catch {
    throw new Error("Prebuilt function symbolic link target is invalid");
  }
  if (
    relative(canonicalFunctionDirectory, canonicalTarget) !==
    lexicalTargetFromFunction
  ) {
    throw new Error("Prebuilt function symbolic link escaped its scope");
  }
}

function assertSafeOutputSymlink(
  outputDirectory,
  canonicalOutputDirectory,
  path,
) {
  if (basename(path) === ".vc-config.json") {
    throw new Error("Prebuilt output contains a linked Vercel function config");
  }
  const target = readlinkSync(path);
  const functionsDirectory = join(outputDirectory, "functions");
  const sourceFromRoot = relative(outputDirectory, path);
  const sourceParts = sourceFromRoot.split(sep);
  const physicalFunctionDirectory = findPhysicalFunctionDirectory(
    outputDirectory,
    sourceParts,
  );
  if (
    target.length === 0 ||
    Buffer.byteLength(target, "utf8") > 4_096 ||
    hasControlCharacters(target) ||
    isAbsolute(target) ||
    !isStrictDescendant(outputDirectory, path) ||
    !sourceFromRoot.startsWith(`functions${sep}`) ||
    (!physicalFunctionDirectory && !sourceFromRoot.endsWith(".func"))
  ) {
    throw new Error("Prebuilt output contains an unsupported symbolic link");
  }
  const lexicalTarget = resolve(dirname(path), target);
  if (physicalFunctionDirectory) {
    assertContainedFunctionDependencyLink(
      physicalFunctionDirectory,
      path,
      lexicalTarget,
    );
    return;
  }
  const lexicalTargetFromRoot = relative(outputDirectory, lexicalTarget);
  if (
    !isStrictDescendant(functionsDirectory, lexicalTarget) ||
    !lexicalTargetFromRoot.endsWith(".func") ||
    isStrictDescendant(lexicalTarget, path)
  ) {
    throw new Error("Prebuilt output symbolic link target escaped its scope");
  }
  let canonicalTarget;
  let targetConfigEntry;
  let targetEntry;
  try {
    canonicalTarget = realpathSync(lexicalTarget);
    targetEntry = lstatSync(lexicalTarget);
    targetConfigEntry = lstatSync(join(lexicalTarget, ".vc-config.json"));
  } catch {
    throw new Error("Prebuilt output symbolic link target is invalid");
  }
  if (
    !targetEntry.isDirectory() ||
    targetConfigEntry.isSymbolicLink() ||
    !targetConfigEntry.isFile()
  ) {
    throw new Error(
      "Prebuilt output symbolic link target is not a function directory",
    );
  }
  if (
    relative(canonicalOutputDirectory, canonicalTarget) !==
    lexicalTargetFromRoot
  ) {
    throw new Error("Prebuilt output symbolic link target escaped its root");
  }
}

function assertStandaloneVercelConfig(path, entry) {
  if (basename(path) !== ".vc-config.json") return;
  if (entry.size > MAX_PREBUILT_CONFIG_BYTES) {
    throw new Error("Prebuilt output contains an oversized function config");
  }
  let config;
  try {
    config = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error("Prebuilt output contains an invalid function config");
  }
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error("Prebuilt output contains an invalid function config");
  }
  if (!Object.hasOwn(config, "filePathMap")) return;
  const { filePathMap } = config;
  if (
    !filePathMap ||
    typeof filePathMap !== "object" ||
    Array.isArray(filePathMap) ||
    Object.keys(filePathMap).length > 0
  ) {
    throw new Error(
      "Prebuilt output contains external function file references",
    );
  }
}

function assertSafeOutputTree(
  outputDirectory,
  { expectedUid = process.getuid?.(), expectedGid = process.getgid?.() } = {},
) {
  const uid = numericIdentity(expectedUid, "Expected output UID");
  const gid = numericIdentity(expectedGid, "Expected output GID");
  const canonicalOutputDirectory = realpathSync(outputDirectory);
  const pending = [outputDirectory];
  let entries = 0;
  let totalBytes = 0;
  while (pending.length > 0) {
    const path = pending.pop();
    const entry = lstatSync(path);
    entries += 1;
    if (entries > 250_000) {
      throw new Error("Prebuilt output contains too many filesystem entries");
    }
    if (entry.uid !== uid || entry.gid !== gid) {
      throw new Error(
        "Prebuilt output contains an entry with unsafe ownership",
      );
    }
    const symbolicLink = entry.isSymbolicLink();
    if (
      basename(path) === ".vc-config.json" &&
      (symbolicLink || !entry.isFile())
    ) {
      throw new Error("Prebuilt output contains an invalid function config");
    }
    if (!entry.isDirectory()) {
      if (!Number.isSafeInteger(entry.size) || entry.size < 0) {
        throw new Error("Prebuilt output contains an invalid entry size");
      }
      totalBytes += entry.size;
      if (
        !Number.isSafeInteger(totalBytes) ||
        totalBytes > MAX_PREBUILT_TOTAL_BYTES
      ) {
        throw new Error("Prebuilt output exceeds its total size limit");
      }
    }
    if (
      uid === process.getuid?.() &&
      !symbolicLink &&
      ((entry.mode & 0o022) !== 0 || (entry.mode & 0o7000) !== 0)
    ) {
      throw new Error("Runner-owned prebuilt output has unsafe permissions");
    }
    if (symbolicLink) {
      assertSafeOutputSymlink(outputDirectory, canonicalOutputDirectory, path);
      continue;
    }
    if (entry.isDirectory()) {
      for (const child of readdirSync(path)) pending.push(join(path, child));
      continue;
    }
    if (!entry.isFile()) {
      throw new Error("Prebuilt output contains a special filesystem node");
    }
    if (entry.size > MAX_PREBUILT_FILE_BYTES) {
      throw new Error("Prebuilt output contains an oversized file");
    }
    if (uid === process.getuid?.() && entry.nlink !== 1) {
      throw new Error("Prebuilt output contains a hard-linked file");
    }
    assertStandaloneVercelConfig(path, entry);
  }
  return outputDirectory;
}

function assertCandidateProvenance(
  repoRoot,
  commitSha,
  expectedUid = process.getuid?.(),
) {
  const provenancePath = `${repoRoot}.provenance.json`;
  const provenanceUid = numericIdentity(
    expectedUid,
    "Expected provenance owner UID",
  );
  let provenance;
  try {
    const entry = lstatSync(provenancePath);
    if (
      entry.isSymbolicLink() ||
      !entry.isFile() ||
      entry.uid !== provenanceUid ||
      (entry.mode & 0o022) !== 0
    ) {
      throw new Error("unsafe provenance file");
    }
    provenance = JSON.parse(readFileSync(provenancePath, "utf8"));
  } catch {
    throw new Error("Prebuilt source provenance is missing or invalid");
  }
  const sha = validateExactSha(commitSha);
  if (
    !provenance ||
    typeof provenance !== "object" ||
    Array.isArray(provenance) ||
    Object.keys(provenance).length !== 1 ||
    provenance.commitSha !== sha
  ) {
    throw new Error("Prebuilt source provenance does not match the exact SHA");
  }
  return provenance;
}

export function assertPrebuiltReadyForUpload({
  repoRoot,
  logicalTarget,
  expectedRootDirectory,
  vercelOrgId,
  vercelProjectId,
  deploymentId,
  commitSha,
  expectedUid = process.getuid?.(),
  expectedGid = process.getgid?.(),
  expectedProvenanceUid = process.getuid?.(),
}) {
  const target = prebuiltTarget(logicalTarget);
  if (expectedRootDirectory !== target.expectedRootDirectory) {
    throw new Error("Prebuilt upload target mapping is invalid");
  }
  assertCandidateProvenance(repoRoot, commitSha, expectedProvenanceUid);
  assertPulledProject({
    repoRoot,
    expectedRootDirectory,
    vercelOrgId,
    vercelProjectId,
  });
  return assertPrebuiltOutput({
    repoRoot,
    expectedRootDirectory,
    deploymentId,
    expectedUid,
    expectedGid,
  });
}

export async function withValidatedPrebuiltUpload(options, upload) {
  if (typeof upload !== "function") {
    throw new Error("Prebuilt upload callback is invalid");
  }
  assertPrebuiltReadyForUpload(options);
  return upload();
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
  requiredEnvironment([
    "TRUSTED_VERCEL_TOOLS_PATH",
    "VERCEL_TOKEN",
    "VERCEL_ORG_ID",
    "VERCEL_PROJECT_ID",
  ]);
  const cliPath = trustedVercelCliPath(process.env.TRUSTED_VERCEL_TOOLS_PATH);
  return spawnSync(process.execPath, [cliPath, ...arguments_], {
    cwd: process.env.SOURCE_PATH,
    env: environmentForVercelCli(process.env, ["VERCEL_TOKEN"]),
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

function materializeSourceFromEnvironment() {
  materializeExactGitTree({
    isolationRoot: process.env.VERCEL_ISOLATION_ROOT,
    sourceRoot: process.env.SOURCE_PATH,
    candidateRoot: process.env.CANDIDATE_SOURCE_PATH,
    commitSha: process.env.DEPLOY_SHA,
  });
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

function preparePullStagingFromEnvironment() {
  prepareVercelPullStaging({
    isolationRoot: process.env.VERCEL_ISOLATION_ROOT,
    stagingRoot: process.env.PULL_STAGING_PATH,
    expectedRootDirectory: process.env.EXPECTED_ROOT_DIRECTORY,
    vercelOrgId: process.env.VERCEL_ORG_ID,
    vercelProjectId: process.env.VERCEL_PROJECT_ID,
  });
}

function validatePullStagingFromEnvironment() {
  assertVercelPullStaging({
    isolationRoot: process.env.VERCEL_ISOLATION_ROOT,
    stagingRoot: process.env.PULL_STAGING_PATH,
    expectedRootDirectory: process.env.EXPECTED_ROOT_DIRECTORY,
    vercelOrgId: process.env.VERCEL_ORG_ID,
    vercelProjectId: process.env.VERCEL_PROJECT_ID,
    expectedUid: process.env.PULL_STAGING_UID ?? process.getuid?.(),
    expectedGid: process.env.PULL_STAGING_GID ?? process.getgid?.(),
  });
}

function materializeBuildEnvironmentFromEnvironment() {
  materializeVercelBuildEnvironment({
    isolationRoot: process.env.VERCEL_ISOLATION_ROOT,
    stagingRoot: process.env.PULL_STAGING_PATH,
    materializationRoot: process.env.BUILD_ENVIRONMENT_PATH,
    expectedRootDirectory: process.env.EXPECTED_ROOT_DIRECTORY,
    logicalTarget: process.env.LOGICAL_TARGET,
    environment: "preview",
    vercelOrgId: process.env.VERCEL_ORG_ID,
    vercelProjectId: process.env.VERCEL_PROJECT_ID,
    expectedUid: process.env.PULL_STAGING_UID ?? process.getuid?.(),
    expectedGid: process.env.PULL_STAGING_GID ?? process.getgid?.(),
  });
}

function validateMaterializedBuildEnvironmentFromEnvironment() {
  assertMaterializedVercelBuildEnvironment({
    isolationRoot: process.env.VERCEL_ISOLATION_ROOT,
    stagingRoot: process.env.PULL_STAGING_PATH,
    materializationRoot: process.env.BUILD_ENVIRONMENT_PATH,
    expectedRootDirectory: process.env.EXPECTED_ROOT_DIRECTORY,
    logicalTarget: process.env.LOGICAL_TARGET,
    environment: "preview",
    vercelOrgId: process.env.VERCEL_ORG_ID,
    vercelProjectId: process.env.VERCEL_PROJECT_ID,
    expectedUid: process.env.PULL_STAGING_UID ?? process.getuid?.(),
    expectedGid: process.env.PULL_STAGING_GID ?? process.getgid?.(),
  });
}

function stagePullFromEnvironment() {
  stageVercelPullForCandidate({
    isolationRoot: process.env.VERCEL_ISOLATION_ROOT,
    stagingRoot: process.env.PULL_STAGING_PATH,
    materializationRoot: process.env.BUILD_ENVIRONMENT_PATH,
    candidateRoot: process.env.CANDIDATE_SOURCE_PATH,
    expectedRootDirectory: process.env.EXPECTED_ROOT_DIRECTORY,
    logicalTarget: process.env.LOGICAL_TARGET,
    environment: "preview",
    vercelOrgId: process.env.VERCEL_ORG_ID,
    vercelProjectId: process.env.VERCEL_PROJECT_ID,
    buildUid: process.env.BUILD_UID,
    buildGid: process.env.BUILD_GID,
    runnerUid: process.env.PULL_STAGING_UID,
    runnerGid: process.env.PULL_STAGING_GID,
  });
}

function validateCandidatePullFromEnvironment() {
  assertCandidateVercelPull({
    isolationRoot: process.env.VERCEL_ISOLATION_ROOT,
    candidateRoot: process.env.CANDIDATE_SOURCE_PATH,
    expectedRootDirectory: process.env.EXPECTED_ROOT_DIRECTORY,
    logicalTarget: process.env.LOGICAL_TARGET,
    environment: "preview",
    vercelOrgId: process.env.VERCEL_ORG_ID,
    vercelProjectId: process.env.VERCEL_PROJECT_ID,
    buildUid: process.env.BUILD_UID,
    buildGid: process.env.BUILD_GID,
    runnerUid: process.env.PULL_STAGING_UID,
    runnerGid: process.env.PULL_STAGING_GID,
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
    "BUILD_GID",
    "BUILD_UID",
    "DEPLOY_SHA",
    "EXPECTED_ROOT_DIRECTORY",
    "LOGICAL_TARGET",
    "PULL_STAGING_GID",
    "PULL_STAGING_UID",
    "VERCEL_ISOLATION_ROOT",
    "SOURCE_PATH",
    "TURBO_TEAM",
    "TURBO_TOKEN",
    "TURBO_REMOTE_CACHE_SIGNATURE_KEY",
    "MENTO_NEXT_DEPLOYMENT_ID",
    "VERCEL_GIT_COMMIT_SHA",
    "VERCEL_ORG_ID",
    "VERCEL_PROJECT_ID",
  ]);
  if (process.env.VERCEL_GIT_COMMIT_SHA !== process.env.DEPLOY_SHA) {
    throw new Error("Build commit metadata does not match the exact SHA");
  }
  validatePrebuiltTargetMapping({
    logicalTarget: process.env.LOGICAL_TARGET,
    workspacePackage:
      PREBUILT_TARGETS[process.env.LOGICAL_TARGET]?.workspacePackage,
    expectedRootDirectory: process.env.EXPECTED_ROOT_DIRECTORY,
  });
  if (process.env.SENTRY_AUTH_TOKEN !== undefined) {
    throw new Error("Preview build cannot receive SENTRY_AUTH_TOKEN");
  }
  if (process.env.LOGICAL_TARGET === "governance") {
    requiredText(process.env.ETHERSCAN_API_KEY, "ETHERSCAN_API_KEY");
  } else if ((process.env.ETHERSCAN_API_KEY ?? "") !== "") {
    throw new Error(
      "Only the governance preview build can receive ETHERSCAN_API_KEY",
    );
  }
  assertCandidateProvenance(
    process.env.SOURCE_PATH,
    process.env.DEPLOY_SHA,
    process.env.PULL_STAGING_UID,
  );
  assertCandidateVercelPull({
    isolationRoot: process.env.VERCEL_ISOLATION_ROOT,
    candidateRoot: process.env.SOURCE_PATH,
    expectedRootDirectory: process.env.EXPECTED_ROOT_DIRECTORY,
    logicalTarget: process.env.LOGICAL_TARGET,
    environment: "preview",
    vercelOrgId: process.env.VERCEL_ORG_ID,
    vercelProjectId: process.env.VERCEL_PROJECT_ID,
    buildUid: process.env.BUILD_UID,
    buildGid: process.env.BUILD_GID,
    runnerUid: process.env.PULL_STAGING_UID,
    runnerGid: process.env.PULL_STAGING_GID,
  });
}

function assertOutputFromEnvironment() {
  assertPrebuiltReadyForUpload({
    repoRoot: process.env.SOURCE_PATH,
    logicalTarget: process.env.LOGICAL_TARGET,
    expectedRootDirectory: process.env.EXPECTED_ROOT_DIRECTORY,
    vercelOrgId: process.env.VERCEL_ORG_ID,
    vercelProjectId: process.env.VERCEL_PROJECT_ID,
    deploymentId: process.env.MENTO_NEXT_DEPLOYMENT_ID,
    commitSha: process.env.DEPLOY_SHA,
    expectedUid: process.env.EXPECTED_OUTPUT_UID,
    expectedGid: process.env.EXPECTED_OUTPUT_GID,
    expectedProvenanceUid:
      process.env.EXPECTED_PROVENANCE_UID ?? process.getuid?.(),
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
  const deployment = await withValidatedPrebuiltUpload(
    {
      repoRoot: process.env.SOURCE_PATH,
      logicalTarget: process.env.LOGICAL_TARGET,
      expectedRootDirectory: process.env.EXPECTED_ROOT_DIRECTORY,
      vercelOrgId: process.env.VERCEL_ORG_ID,
      vercelProjectId: process.env.VERCEL_PROJECT_ID,
      deploymentId: process.env.MENTO_NEXT_DEPLOYMENT_ID,
      commitSha: process.env.DEPLOY_SHA,
    },
    () =>
      deployWithAmbiguityRecovery({
        runUpload: async () => {
          const result = executeVercel(arguments_, { capture: true });
          return { status: result.status, stdout: result.stdout ?? "" };
        },
        lookup: () =>
          queryVercelDeployments({
            ...lookup,
            token: process.env.VERCEL_TOKEN,
          }),
      }),
  );
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

function totalFromEnvironment() {
  if (!/^[0-9]+$/.test(process.env.STARTED_AT_MS ?? "")) {
    throw new Error("Workflow start time is invalid");
  }
  output(
    "total_duration_ms",
    String(Date.now() - Number(process.env.STARTED_AT_MS)),
  );
}

function stageTrustedRuntimeFromEnvironment() {
  stageTrustedRuntime({
    isolationRoot: process.env.VERCEL_ISOLATION_ROOT,
    toolsRoot: process.env.TRUSTED_VERCEL_TOOLS_PATH,
    nodeSource: process.env.NODE_SOURCE_PATH,
    pnpmRoot: process.env.PNPM_BOOTSTRAP_PATH,
  });
}

function stageTrustedPnpmBootstrapManifestFromEnvironment() {
  process.stdout.write(
    `${stageTrustedPnpmBootstrapManifest({
      controllerRoot: process.env.CONTROLLER_PATH,
      isolationRoot: process.env.VERCEL_ISOLATION_ROOT,
      bootstrapRoot: process.env.PNPM_BOOTSTRAP_PATH,
    })}\n`,
  );
}

function stageTrustedPnpmRuntimeManifestFromEnvironment() {
  process.stdout.write(
    `${stageTrustedPnpmRuntimeManifest({
      controllerRoot: process.env.CONTROLLER_PATH,
      toolsRoot: process.env.TRUSTED_VERCEL_TOOLS_PATH,
    })}\n`,
  );
}

function stageTrustedVercelCliRuntimeManifestFromEnvironment() {
  process.stdout.write(
    `${stageTrustedVercelCliRuntimeManifest({
      controllerRoot: process.env.CONTROLLER_PATH,
      toolsRoot: process.env.TRUSTED_VERCEL_TOOLS_PATH,
    })}\n`,
  );
}

function stageTrustedPnpmLauncherFromEnvironment() {
  process.stdout.write(
    `${stageTrustedPnpmLauncher({
      toolsRoot: process.env.TRUSTED_VERCEL_TOOLS_PATH,
    })}\n`,
  );
}

function trustedStandaloneVercelCliPathFromEnvironment() {
  process.stdout.write(
    `${trustedStandaloneVercelCliPath({
      controllerRoot: process.env.CONTROLLER_PATH,
      toolsRoot: process.env.TRUSTED_VERCEL_TOOLS_PATH,
    })}\n`,
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
  else if (command === "materialize-source") materializeSourceFromEnvironment();
  else if (command === "stage-pnpm-bootstrap")
    stageTrustedPnpmBootstrapManifestFromEnvironment();
  else if (command === "stage-runtime") stageTrustedRuntimeFromEnvironment();
  else if (command === "stage-pnpm-runtime")
    stageTrustedPnpmRuntimeManifestFromEnvironment();
  else if (command === "stage-vercel-cli-runtime")
    stageTrustedVercelCliRuntimeManifestFromEnvironment();
  else if (command === "stage-pnpm-launcher")
    stageTrustedPnpmLauncherFromEnvironment();
  else if (command === "trusted-standalone-vercel-cli-path")
    trustedStandaloneVercelCliPathFromEnvironment();
  else if (command === "prepare-link") prepareLinkFromEnvironment();
  else if (command === "prepare-pull-staging")
    preparePullStagingFromEnvironment();
  else if (command === "pull") pullFromEnvironment();
  else if (command === "validate-pull") validatePullFromEnvironment();
  else if (command === "validate-pull-staging")
    validatePullStagingFromEnvironment();
  else if (command === "materialize-build-environment")
    materializeBuildEnvironmentFromEnvironment();
  else if (command === "validate-materialized-build-environment")
    validateMaterializedBuildEnvironmentFromEnvironment();
  else if (command === "stage-pull") stagePullFromEnvironment();
  else if (command === "validate-candidate-pull")
    validateCandidatePullFromEnvironment();
  else if (command === "build") buildFromEnvironment();
  else if (command === "assert-output") assertOutputFromEnvironment();
  else if (command === "trusted-install-modules-dir") {
    const layout = trustedPnpmInstallLayout({
      controllerRoot: process.env.CONTROLLER_PATH,
      toolsRoot: process.env.TRUSTED_VERCEL_TOOLS_PATH,
    });
    process.stdout.write(`${layout.modulesDir}\n`);
  } else if (command === "deploy") await deployFromEnvironment();
  else if (command === "verify") verifyFromEnvironment();
  else if (command === "total") totalFromEnvironment();
  else {
    throw new Error(
      "Usage: vercel-prebuilt-workflow.mjs prepare|validate-source|materialize-source|stage-runtime|stage-pnpm-bootstrap|stage-pnpm-runtime|stage-vercel-cli-runtime|stage-pnpm-launcher|trusted-standalone-vercel-cli-path|prepare-link|prepare-pull-staging|pull|validate-pull|validate-pull-staging|materialize-build-environment|validate-materialized-build-environment|stage-pull|validate-candidate-pull|build|assert-output|trusted-install-modules-dir|deploy|verify|total",
    );
  }
}
