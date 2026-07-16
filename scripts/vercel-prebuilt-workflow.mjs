#!/usr/bin/env node

/* eslint-disable turbo/no-undeclared-env-vars -- GitHub Actions supplies these controller-only values outside Turbo tasks. */

import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  chmodSync,
  chownSync,
  closeSync,
  constants as fsConstants,
  copyFileSync,
  existsSync,
  fchmodSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
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
const CANDIDATE_SOURCE_DIRECTORY = "mento-vercel-candidate-source";
const PULLED_ENVIRONMENT_FILE = ".env.preview.local";
const MAX_SOURCE_ENTRIES = 20_000;
const MAX_SOURCE_PATH_BYTES = 4_096;
const MAX_SOURCE_BLOB_BYTES = 32 * 1_024 * 1_024;
const MAX_SOURCE_TREE_BYTES = 16 * 1_024 * 1_024;
const MAX_SOURCE_TOTAL_BYTES = 128 * 1_024 * 1_024;
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
  if (values.githubRef !== "refs/heads/main") {
    throw new Error("The pilot workflow must be dispatched from main");
  }
  if (
    values.githubWorkflowRef !==
    "mento-protocol/frontend-monorepo/.github/workflows/vercel-prebuilt-pilot.yml@refs/heads/main"
  ) {
    throw new Error("The pilot caller must be the trusted main workflow");
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

function optionalEntry(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

function pilotRootDirectory(value) {
  requiredText(value, "Expected Root Directory");
  if (
    value !== PILOT_TARGET.expectedRootDirectory ||
    isAbsolute(value) ||
    value === ".." ||
    value.startsWith(`..${sep}`)
  ) {
    throw new Error("Expected Root Directory is not the UI pilot root");
  }
  return value;
}

function assertRunnerTempChild({
  runnerTemp,
  path,
  expectedName,
  expectedUid = process.getuid?.(),
  expectedGid = process.getgid?.(),
}) {
  requiredText(runnerTemp, "Runner temporary directory");
  requiredText(path, "Isolated path");
  if (!isAbsolute(runnerTemp) || !isAbsolute(path)) {
    throw new Error("Runner isolation paths must be absolute");
  }
  const uid = numericIdentity(expectedUid, "Expected runner UID");
  const gid = numericIdentity(expectedGid, "Expected runner GID");
  const realRunnerTemp = realpathSync(runnerTemp);
  const runnerEntry = lstatSync(realRunnerTemp);
  if (
    runnerEntry.isSymbolicLink() ||
    !runnerEntry.isDirectory() ||
    runnerEntry.uid !== uid ||
    runnerEntry.gid !== gid ||
    (runnerEntry.mode & 0o7022) !== 0
  ) {
    throw new Error("Runner temporary directory is not protected");
  }
  if (
    basename(path) !== expectedName ||
    realpathSync(dirname(path)) !== realRunnerTemp
  ) {
    throw new Error("Isolated path is not the expected RUNNER_TEMP child");
  }
  return join(realRunnerTemp, expectedName);
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
  runnerTemp,
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
  const canonicalCandidateRoot = assertRunnerTempChild({
    runnerTemp,
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
  pilotRootDirectory(expectedRootDirectory);
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
  runnerTemp,
  stagingRoot,
  expectedRootDirectory,
  vercelOrgId,
  vercelProjectId,
}) {
  pilotRootDirectory(expectedRootDirectory);
  const canonicalStagingRoot = assertRunnerTempChild({
    runnerTemp,
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
  runnerTemp,
  stagingRoot,
  expectedRootDirectory,
  vercelOrgId,
  vercelProjectId,
  expectedUid = process.getuid?.(),
  expectedGid = process.getgid?.(),
}) {
  pilotRootDirectory(expectedRootDirectory);
  const canonicalStagingRoot = assertRunnerTempChild({
    runnerTemp,
    path: stagingRoot,
    expectedName: PULL_STAGING_DIRECTORY,
    expectedUid,
    expectedGid,
  });
  if (realpathSync(stagingRoot) !== canonicalStagingRoot) {
    throw new Error("Vercel pull staging resolves outside RUNNER_TEMP");
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

function assertCandidateRootComponents({
  runnerTemp,
  candidateRoot,
  expectedRootDirectory,
  buildUid,
  buildGid,
  runnerUid,
  runnerGid,
}) {
  const canonicalCandidateRoot = assertRunnerTempChild({
    runnerTemp,
    path: candidateRoot,
    expectedName: CANDIDATE_SOURCE_DIRECTORY,
    expectedUid: runnerUid,
    expectedGid: runnerGid,
  });
  if (realpathSync(candidateRoot) !== canonicalCandidateRoot) {
    throw new Error("Candidate source resolves outside RUNNER_TEMP");
  }
  let current = canonicalCandidateRoot;
  for (const [path, label] of [
    [canonicalCandidateRoot, "Candidate source"],
    ...expectedRootDirectory.split("/").map((component) => {
      current = join(current, component);
      return [current, "Candidate UI Root Directory"];
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
  runnerTemp,
  candidateRoot,
  expectedRootDirectory,
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
    runnerTemp,
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
  return assertPulledProject({
    repoRoot: canonicalCandidateRoot,
    expectedRootDirectory,
    vercelOrgId,
    vercelProjectId,
  });
}

export function stageVercelPullForCandidate({
  runnerTemp,
  stagingRoot,
  candidateRoot,
  expectedRootDirectory,
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
  assertVercelPullStaging({
    runnerTemp,
    stagingRoot,
    expectedRootDirectory,
    vercelOrgId,
    vercelProjectId,
    expectedUid: trustedUid,
    expectedGid: trustedGid,
  });
  const canonicalCandidateRoot = assertCandidateRootComponents({
    runnerTemp,
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
    [
      join(expectedRootDirectory, ".vercel", PULLED_ENVIRONMENT_FILE),
      join(expectedRootDirectory, ".vercel", PULLED_ENVIRONMENT_FILE),
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
  return assertCandidateVercelPull({
    runnerTemp,
    candidateRoot: canonicalCandidateRoot,
    expectedRootDirectory,
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

export function trustedPnpmInstallLayout({ controllerRoot, toolsRoot }) {
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
  pilotRootDirectory(expectedRootDirectory);
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
      [targetRoot, "UI Root Directory", true],
      [join(targetRoot, ".vercel"), "UI Vercel state", true],
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
      "Pulled Vercel project mapping does not match the UI target",
    );
  }
  return project;
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

function assertSafeOutputTree(
  outputDirectory,
  { expectedUid = process.getuid?.(), expectedGid = process.getgid?.() } = {},
) {
  const uid = numericIdentity(expectedUid, "Expected output UID");
  const gid = numericIdentity(expectedGid, "Expected output GID");
  const pending = [outputDirectory];
  let entries = 0;
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
    if (
      uid === process.getuid?.() &&
      ((entry.mode & 0o022) !== 0 || (entry.mode & 0o7000) !== 0)
    ) {
      throw new Error("Runner-owned prebuilt output has unsafe permissions");
    }
    if (entry.isSymbolicLink()) {
      throw new Error("Prebuilt output contains a symbolic link");
    }
    if (entry.isDirectory()) {
      for (const child of readdirSync(path)) pending.push(join(path, child));
      continue;
    }
    if (!entry.isFile()) {
      throw new Error("Prebuilt output contains a special filesystem node");
    }
    if (uid === process.getuid?.() && entry.nlink !== 1) {
      throw new Error("Prebuilt output contains a hard-linked file");
    }
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
  if (
    logicalTarget !== PILOT_TARGET.logicalTarget ||
    expectedRootDirectory !== PILOT_TARGET.expectedRootDirectory
  ) {
    throw new Error("Prebuilt upload is not the UI pilot target");
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
    workflowRunUrl: process.env.WORKFLOW_RUN_URL,
    githubRepository: process.env.GITHUB_REPOSITORY,
    githubRef: process.env.GITHUB_EVENT_REF,
    githubWorkflowRef: process.env.GITHUB_WORKFLOW_DEFINITION,
  };
}

function requiredEnvironment(names) {
  for (const name of names) requiredText(process.env[name], name);
}

function runVercel(arguments_, { capture = false } = {}) {
  assertSafeVercelArguments(arguments_);
  requiredEnvironment([
    "TRUSTED_VERCEL_TOOLS_PATH",
    "VERCEL_TOKEN",
    "VERCEL_ORG_ID",
    "VERCEL_PROJECT_ID",
  ]);
  const cliPath = trustedVercelCliPath(process.env.TRUSTED_VERCEL_TOOLS_PATH);
  const result = spawnSync(process.execPath, [cliPath, ...arguments_], {
    cwd: process.env.SOURCE_PATH,
    env: environmentForVercelCli(process.env, ["VERCEL_TOKEN"]),
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

function materializeSourceFromEnvironment() {
  materializeExactGitTree({
    runnerTemp: process.env.RUNNER_TEMP,
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
    runnerTemp: process.env.RUNNER_TEMP,
    stagingRoot: process.env.PULL_STAGING_PATH,
    expectedRootDirectory: process.env.EXPECTED_ROOT_DIRECTORY,
    vercelOrgId: process.env.VERCEL_ORG_ID,
    vercelProjectId: process.env.VERCEL_PROJECT_ID,
  });
}

function validatePullStagingFromEnvironment() {
  assertVercelPullStaging({
    runnerTemp: process.env.RUNNER_TEMP,
    stagingRoot: process.env.PULL_STAGING_PATH,
    expectedRootDirectory: process.env.EXPECTED_ROOT_DIRECTORY,
    vercelOrgId: process.env.VERCEL_ORG_ID,
    vercelProjectId: process.env.VERCEL_PROJECT_ID,
    expectedUid: process.env.PULL_STAGING_UID ?? process.getuid?.(),
    expectedGid: process.env.PULL_STAGING_GID ?? process.getgid?.(),
  });
}

function stagePullFromEnvironment() {
  stageVercelPullForCandidate({
    runnerTemp: process.env.RUNNER_TEMP,
    stagingRoot: process.env.PULL_STAGING_PATH,
    candidateRoot: process.env.CANDIDATE_SOURCE_PATH,
    expectedRootDirectory: process.env.EXPECTED_ROOT_DIRECTORY,
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
    runnerTemp: process.env.RUNNER_TEMP,
    candidateRoot: process.env.CANDIDATE_SOURCE_PATH,
    expectedRootDirectory: process.env.EXPECTED_ROOT_DIRECTORY,
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
    "PULL_STAGING_GID",
    "PULL_STAGING_UID",
    "RUNNER_TEMP",
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
  assertCandidateProvenance(
    process.env.SOURCE_PATH,
    process.env.DEPLOY_SHA,
    process.env.PULL_STAGING_UID,
  );
  assertCandidateVercelPull({
    runnerTemp: process.env.RUNNER_TEMP,
    candidateRoot: process.env.SOURCE_PATH,
    expectedRootDirectory: process.env.EXPECTED_ROOT_DIRECTORY,
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
  const arguments_ = buildVercelDeployArguments({
    projectId: process.env.VERCEL_PROJECT_ID,
    commitSha: process.env.DEPLOY_SHA,
    gitBranch: process.env.GIT_BRANCH,
  });
  const raw = await withValidatedPrebuiltUpload(
    {
      repoRoot: process.env.SOURCE_PATH,
      logicalTarget: process.env.LOGICAL_TARGET,
      expectedRootDirectory: process.env.EXPECTED_ROOT_DIRECTORY,
      vercelOrgId: process.env.VERCEL_ORG_ID,
      vercelProjectId: process.env.VERCEL_PROJECT_ID,
      deploymentId: process.env.MENTO_NEXT_DEPLOYMENT_ID,
      commitSha: process.env.DEPLOY_SHA,
    },
    async () => runVercel(arguments_, { capture: true }),
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
  else if (command === "materialize-source") materializeSourceFromEnvironment();
  else if (command === "prepare-link") prepareLinkFromEnvironment();
  else if (command === "prepare-pull-staging")
    preparePullStagingFromEnvironment();
  else if (command === "pull") pullFromEnvironment();
  else if (command === "validate-pull") validatePullFromEnvironment();
  else if (command === "validate-pull-staging")
    validatePullStagingFromEnvironment();
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
  else if (command === "smoke") await smokeFromEnvironment();
  else if (command === "total") totalFromEnvironment();
  else {
    throw new Error(
      "Usage: vercel-prebuilt-workflow.mjs prepare|validate-source|materialize-source|prepare-link|prepare-pull-staging|pull|validate-pull|validate-pull-staging|stage-pull|validate-candidate-pull|build|assert-output|trusted-install-modules-dir|deploy|verify|smoke|total",
    );
  }
}
