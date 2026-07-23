#!/usr/bin/env node

/* eslint-disable turbo/no-undeclared-env-vars -- This direct Actions controller does not run through Turbo. */

import { Buffer } from "node:buffer";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  chownSync,
  closeSync,
  cpSync,
  copyFileSync,
  constants,
  existsSync,
  fchmodSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import process from "node:process";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";

import { assertPrebuiltDeploymentId } from "./vercel-prebuilt.mjs";
import {
  parseVercelPulledEnvironment,
  selectVercelPulledEnvironment,
  serializeVercelPulledEnvironment,
} from "./vercel-build-environment.mjs";
import {
  assertCanonicalOutput,
  canonicalizeDeploymentUrl,
  canonicalizeHostname,
  captureAliasMappings,
  VercelStateClient,
} from "./vercel-deployment-state.mjs";

const SHA_PATTERN = /^[A-Fa-f0-9]{40}$/;
const DEPLOYMENT_ID_PATTERN = /^dpl_[A-Za-z0-9]+$/;
const EXPECTED_WORKFLOW_REF =
  "mento-protocol/frontend-monorepo/.github/workflows/vercel-production-shadow.yml@refs/heads/main";
const REVIEWED_APP_V3_ALIASES = Object.freeze([
  "app.mento.org",
  "appmentoorg-env-v3-mentolabs.vercel.app",
]);
const FORBIDDEN_EVIDENCE_PATTERN =
  /protectionBypass|buildEnv|VERCEL_TOKEN|SENTRY_AUTH_TOKEN|ETHERSCAN_API_KEY|authorization|cookie/i;
const PULL_STAGING_DIRECTORY = "mento-vercel-production-pull-staging";
const BUILD_ENVIRONMENT_DIRECTORY = "mento-vercel-production-build-environment";
const CANDIDATE_SOURCE_DIRECTORY = "mento-vercel-production-candidate-source";
const UPLOAD_SOURCE_DIRECTORY = "mento-vercel-production-upload-source";
const EXPLICIT_EMPTY = "explicit-empty";
const MAX_SOURCE_ENTRIES = 20_000;
const MAX_SOURCE_PATH_BYTES = 4_096;
const MAX_SOURCE_BLOB_BYTES = 32 * 1_024 * 1_024;
const MAX_SOURCE_TREE_BYTES = 16 * 1_024 * 1_024;
const MAX_SOURCE_TOTAL_BYTES = 128 * 1_024 * 1_024;
const MAX_PULLED_ENVIRONMENT_BYTES = 16 * 1_024 * 1_024;
const MAX_MATERIALIZED_ENVIRONMENT_BYTES = 1_024 * 1_024;
const MAX_PREBUILT_CONFIG_BYTES = 1_024 * 1_024;
const VERCEL_CLI_ENVIRONMENT_NAMES = Object.freeze([
  "CI",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "LANG",
  "LC_ALL",
  "NODE_EXTRA_CA_CERTS",
  "NO_PROXY",
  "PATH",
  "SSL_CERT_FILE",
  "VERCEL_TOKEN",
]);

export const PRODUCTION_SHADOW_TARGETS = {
  app: {
    projectName: "app.mento.org",
    rootDirectory: "apps/app.mento.org",
    pullEnvironment: "v3",
    buildArguments: ["build", "--yes", "--standalone", "--target", "v3"],
    deployArguments: null,
  },
  governance: {
    projectName: "governance.mento.org",
    rootDirectory: "apps/governance.mento.org",
    pullEnvironment: "production",
    buildArguments: ["build", "--yes", "--standalone", "--prod"],
    deployArguments: [
      "deploy",
      "--prebuilt",
      "--prod",
      "--skip-domain",
      "--archive=tgz",
      "--format=json",
      "--yes",
    ],
  },
  reserve: {
    projectName: "reserve.mento.org",
    rootDirectory: "apps/reserve.mento.org",
    pullEnvironment: "production",
    buildArguments: ["build", "--yes", "--standalone", "--prod"],
    deployArguments: [
      "deploy",
      "--prebuilt",
      "--prod",
      "--skip-domain",
      "--archive=tgz",
      "--format=json",
      "--yes",
    ],
  },
  ui: {
    projectName: "ui.mento.org",
    rootDirectory: "apps/ui.mento.org",
    pullEnvironment: "production",
    buildArguments: ["build", "--yes", "--standalone", "--prod"],
    deployArguments: [
      "deploy",
      "--prebuilt",
      "--prod",
      "--skip-domain",
      "--archive=tgz",
      "--format=json",
      "--yes",
    ],
  },
};

function requireString(value, label, pattern) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} is required`);
  }
  if (pattern && !pattern.test(value)) {
    throw new Error(`${label} is malformed`);
  }
  return value;
}

function requireIdentifier(value, label) {
  return requireString(value, label, /^[A-Za-z0-9._-]+$/);
}

function targetContract(logicalTarget) {
  if (!Object.hasOwn(PRODUCTION_SHADOW_TARGETS, logicalTarget)) {
    throw new Error(
      `Unknown production-shadow target: ${String(logicalTarget)}`,
    );
  }
  return PRODUCTION_SHADOW_TARGETS[logicalTarget];
}

function numericIdentity(value, label) {
  const numeric = typeof value === "string" ? Number(value) : value;
  if (!Number.isSafeInteger(numeric) || numeric < 0) {
    throw new Error(`${label} is invalid`);
  }
  return numeric;
}

function hasControlCharacters(value) {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint <= 31 || codePoint === 127;
  });
}

function optionalEntry(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

function pulledEnvironmentFile(logicalTarget) {
  return `.env.${targetContract(logicalTarget).pullEnvironment}.local`;
}

function expectedPullTree(logicalTarget) {
  const rootDirectory = targetContract(logicalTarget).rootDirectory;
  const entries = [
    ["", { type: "directory" }],
    [".vercel", { type: "directory" }],
    [join(".vercel", "repo.json"), { type: "file", maximumSize: 64 * 1_024 }],
  ];
  let current = "";
  for (const component of rootDirectory.split("/")) {
    current = join(current, component);
    entries.push([current, { type: "directory" }]);
  }
  const appState = join(rootDirectory, ".vercel");
  entries.push(
    [appState, { type: "directory" }],
    [
      join(appState, "project.json"),
      { type: "file", maximumSize: 256 * 1_024 },
    ],
    [
      join(appState, pulledEnvironmentFile(logicalTarget)),
      { type: "file", maximumSize: MAX_PULLED_ENVIRONMENT_BYTES },
    ],
  );
  return entries;
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
  const resolvedRoot = resolve(root);
  const resolvedFilePath = resolve(filePath);
  const canonicalRoot = realpathSync(resolvedRoot);
  const canonicalFilePath = realpathSync(resolvedFilePath);
  const lexicalRelativePath = relative(resolvedRoot, resolvedFilePath);
  if (
    lexicalRelativePath === "" ||
    lexicalRelativePath === ".." ||
    lexicalRelativePath.startsWith(`..${sep}`) ||
    isAbsolute(lexicalRelativePath) ||
    canonicalFilePath !== join(canonicalRoot, lexicalRelativePath)
  ) {
    throw new Error(`${label} escapes its protected root`);
  }
  const beforeEntry = lstatSync(resolvedFilePath);
  assertProtectedEnvironmentEntry(beforeEntry, {
    expectedUid,
    expectedGid,
    label,
  });
  if (typeof constants.O_NOFOLLOW !== "number") {
    throw new Error(`${label} cannot be opened without following links`);
  }
  const descriptor = openSync(
    resolvedFilePath,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  const beforeIdentity = protectedFileIdentity(beforeEntry);
  let bytes;
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
  const afterPathEntry = lstatSync(resolvedFilePath);
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

function deriveProductionShadowBuildEnvironment({ logicalTarget, raw }) {
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
  } catch {
    throw new Error("Vercel-pulled build environment is not valid UTF-8");
  }
  const contract = targetContract(logicalTarget);
  const values = selectVercelPulledEnvironment({
    target: logicalTarget,
    environment: contract.pullEnvironment,
    pulledValues: parseVercelPulledEnvironment(text),
  });
  return {
    serialized: serializeVercelPulledEnvironment(values),
    values,
  };
}

export function assertProtectedIsolationChild({
  isolationRoot,
  path,
  expectedName,
  expectedUid = process.getuid?.(),
  expectedGid = process.getgid?.(),
}) {
  requireString(isolationRoot, "Vercel isolation root");
  requireString(path, "Isolated path");
  requireIdentifier(expectedName, "Expected isolated path name");
  if (!isAbsolute(isolationRoot) || !isAbsolute(path)) {
    throw new Error("Protected isolation paths must be absolute");
  }
  const uid = numericIdentity(expectedUid, "Expected isolation owner UID");
  const gid = numericIdentity(expectedGid, "Expected isolation owner GID");
  const lexicalIsolationRoot = resolve(isolationRoot);
  if (lexicalIsolationRoot !== isolationRoot) {
    throw new Error("Vercel isolation root is not lexically canonical");
  }
  const isolationEntry = lstatSync(isolationRoot);
  if (
    isolationEntry.isSymbolicLink() ||
    !isolationEntry.isDirectory() ||
    isolationEntry.uid !== uid ||
    isolationEntry.gid !== gid ||
    (isolationEntry.mode & 0o7777) !== 0o711
  ) {
    throw new Error("Vercel isolation root is not protected");
  }
  const canonicalIsolationRoot = realpathSync(isolationRoot);
  if (canonicalIsolationRoot !== isolationRoot) {
    throw new Error("Vercel isolation root is not canonically stable");
  }
  const expectedPath = join(canonicalIsolationRoot, expectedName);
  if (path !== expectedPath || basename(path) !== expectedName) {
    throw new Error(
      "Isolated path is not the expected protected-isolation direct child",
    );
  }
  if (
    dirname(path) !== canonicalIsolationRoot ||
    realpathSync(dirname(path)) !== canonicalIsolationRoot
  ) {
    throw new Error("Isolated path parent escaped the Vercel isolation root");
  }
  const pathEntry = optionalEntry(path);
  if (pathEntry?.isSymbolicLink()) {
    throw new Error("Isolated path must not be a symbolic link");
  }
  if (pathEntry && realpathSync(path) !== expectedPath) {
    throw new Error("Isolated path is not canonically stable");
  }
  return expectedPath;
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
  argumentsList,
  { input, maximumOutput, run = spawnSync },
) {
  const result = run(
    "/usr/bin/git",
    ["--no-pager", "--no-replace-objects", "-C", repoRoot, ...argumentsList],
    {
      encoding: null,
      env: rawGitEnvironment(),
      input,
      maxBuffer: maximumOutput,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  if (result.error || result.status !== 0 || !Buffer.isBuffer(result.stdout)) {
    throw new Error(`Unable to read exact Git ${argumentsList[0]} objects`);
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
    { input, maximumOutput: MAX_SOURCE_TREE_BYTES, run },
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
  const sha = requireString(commitSha, "Commit SHA", SHA_PATTERN).toLowerCase();
  requireString(sourceRoot, "Exact Git source path");
  if (sourceRoot.length > MAX_SOURCE_PATH_BYTES) {
    throw new Error("Exact Git source path is too long");
  }
  const canonicalSourceRoot = realpathSync(sourceRoot);
  const sourceEntry = lstatSync(canonicalSourceRoot);
  if (!sourceEntry.isDirectory()) {
    throw new Error("Exact Git source must be a real directory");
  }
  const canonicalCandidateRoot = assertProtectedIsolationChild({
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
    if (typeof constants.O_NOFOLLOW !== "number") {
      throw new Error("This platform cannot safely materialize Git blobs");
    }
    const descriptor = openSync(
      destination,
      constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW |
        constants.O_WRONLY,
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
      if (!entry.isFile() || entry.nlink !== 1) {
        throw new Error(`${label} contains a non-regular or hard-linked file`);
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

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(resolve(path), "utf8"));
  } catch {
    throw new Error(`${label} is missing or malformed`);
  }
}

function readEnvironmentJson(name, label) {
  try {
    return JSON.parse(requireString(process.env[name], name));
  } catch {
    throw new Error(`${label} is missing or malformed`);
  }
}

function writePrivateJson(path, value) {
  const resolved = resolve(path);
  const descriptor = openSync(
    resolved,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    writeFileSync(descriptor, `${JSON.stringify(value)}\n`);
    fchmodSync(descriptor, 0o600);
  } finally {
    closeSync(descriptor);
  }
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

function appendOutput(name, value, outputPath = process.env.GITHUB_OUTPUT) {
  if (typeof outputPath !== "string" || outputPath.length === 0) return;
  if (!/^[a-z_]+$/.test(name) || /[\r\n]/.test(value)) {
    throw new Error("GitHub output is malformed");
  }
  writeFileSync(outputPath, `${name}=${value}\n`, { flag: "a" });
}

export function validateDispatchContext({
  repository,
  ref,
  workflowRef,
  deploySha,
}) {
  if (repository !== "mento-protocol/frontend-monorepo") {
    throw new Error("Production shadow runs only in the canonical repository");
  }
  if (ref !== "refs/heads/main") {
    throw new Error("Production shadow must be dispatched from main");
  }
  if (workflowRef !== EXPECTED_WORKFLOW_REF) {
    throw new Error("Production shadow workflow must come from main");
  }
  return requireString(deploySha, "deploy_sha", SHA_PATTERN).toLowerCase();
}

export function validateImmutableMainSource({
  deploySha,
  workflowSha,
  sourcePath = process.cwd(),
  execute = execFileSync,
}) {
  const normalizedSha = requireString(
    deploySha,
    "DEPLOY_SHA",
    SHA_PATTERN,
  ).toLowerCase();
  const normalizedWorkflowSha = requireString(
    workflowSha,
    "GITHUB_WORKFLOW_SHA",
    SHA_PATTERN,
  ).toLowerCase();
  if (normalizedWorkflowSha !== normalizedSha) {
    throw new Error("GITHUB_WORKFLOW_SHA does not match DEPLOY_SHA");
  }
  const run = (argumentsList) =>
    execute("git", ["-C", resolve(sourcePath), ...argumentsList], {
      encoding: "utf8",
      stdio: "pipe",
    })
      .trim()
      .toLowerCase();
  run(["cat-file", "-e", `${normalizedSha}^{commit}`]);
  run([
    "merge-base",
    "--is-ancestor",
    normalizedSha,
    "refs/remotes/origin/main",
  ]);
  const fetchedMain = run(["rev-parse", "refs/remotes/origin/main"]);
  if (fetchedMain !== normalizedSha) {
    throw new Error("DEPLOY_SHA does not match fetched origin/main");
  }
  const head = run(["rev-parse", "HEAD"]);
  if (head !== normalizedSha) {
    throw new Error("Checked-out HEAD does not match DEPLOY_SHA");
  }
  return normalizedSha;
}

export function parseTurboCacheSummary(log) {
  if (typeof log !== "string") {
    throw new Error("Turbo build log must be a string");
  }
  const normalizedLog = stripVTControlCharacters(log);
  const cacheLines = normalizedLog
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("Cached:"));
  if (cacheLines.length !== 1) {
    throw new Error("Build log must contain exactly one Turbo cache summary");
  }
  const match = /^Cached:\s+([0-9]+) cached,\s+([0-9]+) total$/.exec(
    cacheLines[0],
  );
  if (!match) {
    throw new Error("Turbo cache summary is malformed");
  }
  const hits = Number.parseInt(match[1], 10);
  const total = Number.parseInt(match[2], 10);
  if (
    !Number.isSafeInteger(hits) ||
    !Number.isSafeInteger(total) ||
    hits > total
  ) {
    throw new Error("Turbo cache summary values are invalid");
  }
  return { hits, misses: total - hits, total };
}

function trustedSourcePath() {
  return resolve(requireString(process.env.SOURCE_PATH, "SOURCE_PATH"));
}

function expectedGit(ref) {
  return {
    org: "mento-protocol",
    repo: "frontend-monorepo",
    ref,
  };
}

export function createProtectedAliasSpec({ appV3AliasesJson, projectIds }) {
  let appAliases;
  try {
    appAliases = JSON.parse(appV3AliasesJson);
  } catch {
    throw new Error("APP_V3_ALIASES_JSON must be valid JSON");
  }
  if (!Array.isArray(appAliases) || appAliases.length === 0) {
    throw new Error("APP_V3_ALIASES_JSON must be a non-empty array");
  }
  const normalizedAppAliases = appAliases.map(canonicalizeHostname);
  if (new Set(normalizedAppAliases).size !== normalizedAppAliases.length) {
    throw new Error("The reviewed v3 alias list contains duplicates");
  }
  const sortedAppAliases = normalizedAppAliases.toSorted();
  if (
    sortedAppAliases.length !== REVIEWED_APP_V3_ALIASES.length ||
    sortedAppAliases.some(
      (alias, index) => alias !== REVIEWED_APP_V3_ALIASES[index],
    )
  ) {
    throw new Error(
      "The reviewed v3 alias list must exactly match app.mento.org and appmentoorg-env-v3-mentolabs.vercel.app",
    );
  }

  const appProjectId = requireString(projectIds.app, "App project ID");
  const entries = sortedAppAliases.map((alias) => ({
    alias,
    projectId: appProjectId,
    projectName: "app.mento.org",
    target: null,
    customEnvironmentSlug: "v3",
    git: expectedGit("main"),
  }));
  entries.push({
    alias: "v2-app.mento.org",
    projectId: appProjectId,
    projectName: "app.mento.org",
    target: "production",
    customEnvironmentSlug: null,
    git: expectedGit("v2"),
  });
  for (const target of ["governance", "reserve", "ui"]) {
    entries.push({
      alias: `${target}.mento.org`,
      projectId: requireString(projectIds[target], `${target} project ID`),
      projectName: `${target}.mento.org`,
      target: "production",
      customEnvironmentSlug: null,
      git: expectedGit("main"),
    });
  }
  return entries.sort((left, right) => left.alias.localeCompare(right.alias));
}

export function materializeProductionShadowLink({
  repoRoot,
  logicalTarget,
  orgId,
  projectId,
}) {
  const contract = targetContract(logicalTarget);
  const link = {
    remoteName: "origin",
    projects: [
      {
        id: requireIdentifier(projectId, "Vercel project ID"),
        directory: contract.rootDirectory,
        orgId: requireIdentifier(orgId, "Vercel organization ID"),
      },
    ],
  };
  const vercelDirectory = join(resolve(repoRoot), ".vercel");
  assertPlainDirectory(vercelDirectory, "Repo-level Vercel state");
  mkdirSync(vercelDirectory, { recursive: true });
  const linkPath = join(vercelDirectory, "repo.json");
  assertPlainFile(linkPath, "Repo-level Vercel link");
  writePrivateJson(linkPath, link);
  return link;
}

export function prepareProductionShadowPullStaging({
  isolationRoot,
  stagingRoot,
  logicalTarget,
  orgId,
  projectId,
}) {
  const contract = targetContract(logicalTarget);
  const canonicalStagingRoot = assertProtectedIsolationChild({
    isolationRoot,
    path: stagingRoot,
    expectedName: PULL_STAGING_DIRECTORY,
  });
  if (existsSync(canonicalStagingRoot)) {
    throw new Error("Production-shadow pull staging must be fresh");
  }
  mkdirSync(canonicalStagingRoot, { mode: 0o700 });
  let current = canonicalStagingRoot;
  for (const component of contract.rootDirectory.split("/")) {
    current = join(current, component);
    mkdirSync(current, { mode: 0o700 });
  }
  materializeProductionShadowLink({
    repoRoot: canonicalStagingRoot,
    logicalTarget,
    orgId,
    projectId,
  });
  chmodSync(join(canonicalStagingRoot, ".vercel"), 0o700);
  chmodSync(join(canonicalStagingRoot, ".vercel", "repo.json"), 0o600);
  return canonicalStagingRoot;
}

export function assertProductionShadowPullStaging({
  isolationRoot,
  stagingRoot,
  logicalTarget,
  orgId,
  projectId,
  expectedUid = process.getuid?.(),
  expectedGid = process.getgid?.(),
}) {
  const canonicalStagingRoot = assertProtectedIsolationChild({
    isolationRoot,
    path: stagingRoot,
    expectedName: PULL_STAGING_DIRECTORY,
    expectedUid,
    expectedGid,
  });
  if (realpathSync(stagingRoot) !== canonicalStagingRoot) {
    throw new Error(
      "Production-shadow pull staging escaped the Vercel isolation root",
    );
  }
  assertExactFilesystemTree(
    canonicalStagingRoot,
    expectedPullTree(logicalTarget),
    {
      expectedUid,
      expectedGid,
      label: "Production-shadow pull staging",
    },
  );
  return assertPulledProductionShadowProject({
    repoRoot: canonicalStagingRoot,
    logicalTarget,
    orgId,
    projectId,
  });
}

function materializedProductionShadowEnvironmentEntries(logicalTarget) {
  return [
    ["", { type: "directory" }],
    [".vercel", { type: "directory" }],
    [
      join(".vercel", pulledEnvironmentFile(logicalTarget)),
      { type: "file", maximumSize: MAX_MATERIALIZED_ENVIRONMENT_BYTES },
    ],
  ];
}

function inspectMaterializedProductionShadowBuildEnvironment({
  isolationRoot,
  stagingRoot,
  materializationRoot,
  logicalTarget,
  orgId,
  projectId,
  expectedUid = process.getuid?.(),
  expectedGid = process.getgid?.(),
}) {
  const uid = numericIdentity(expectedUid, "Expected runner UID");
  const gid = numericIdentity(expectedGid, "Expected runner GID");
  assertProductionShadowPullStaging({
    isolationRoot,
    stagingRoot,
    logicalTarget,
    orgId,
    projectId,
    expectedUid: uid,
    expectedGid: gid,
  });
  const canonicalMaterializationRoot = assertProtectedIsolationChild({
    isolationRoot,
    path: materializationRoot,
    expectedName: BUILD_ENVIRONMENT_DIRECTORY,
    expectedUid: uid,
    expectedGid: gid,
  });
  if (realpathSync(materializationRoot) !== canonicalMaterializationRoot) {
    throw new Error(
      "Materialized production-shadow build environment escaped the Vercel isolation root",
    );
  }
  assertExactFilesystemTree(
    canonicalMaterializationRoot,
    materializedProductionShadowEnvironmentEntries(logicalTarget),
    {
      expectedUid: uid,
      expectedGid: gid,
      label: "Materialized production-shadow build environment",
    },
  );
  for (const path of [
    canonicalMaterializationRoot,
    join(canonicalMaterializationRoot, ".vercel"),
  ]) {
    if ((lstatSync(path).mode & 0o777) !== 0o700) {
      throw new Error(
        "Materialized production-shadow environment directory is not private",
      );
    }
  }
  const contract = targetContract(logicalTarget);
  const environmentFile = pulledEnvironmentFile(logicalTarget);
  const sourceSnapshot = readProtectedEnvironmentFile({
    root: stagingRoot,
    filePath: join(
      stagingRoot,
      contract.rootDirectory,
      ".vercel",
      environmentFile,
    ),
    expectedUid: uid,
    expectedGid: gid,
    label: "Vercel-pulled production-shadow build environment",
  });
  const expected = deriveProductionShadowBuildEnvironment({
    logicalTarget,
    raw: sourceSnapshot.bytes,
  });
  const environmentPath = join(
    canonicalMaterializationRoot,
    ".vercel",
    environmentFile,
  );
  const materialized = readProtectedEnvironmentFile({
    root: canonicalMaterializationRoot,
    filePath: environmentPath,
    expectedUid: uid,
    expectedGid: gid,
    label: "Materialized production-shadow build environment",
  });
  if (!materialized.bytes.equals(Buffer.from(expected.serialized, "utf8"))) {
    throw new Error(
      "Materialized production-shadow build environment is not the exact allowlist",
    );
  }
  return {
    checked: Object.keys(expected.values).length,
    environmentPath,
    sourceSnapshot,
  };
}

export function materializeProductionShadowBuildEnvironment({
  isolationRoot,
  stagingRoot,
  materializationRoot = join(
    resolve(isolationRoot),
    BUILD_ENVIRONMENT_DIRECTORY,
  ),
  logicalTarget,
  orgId,
  projectId,
  expectedUid = process.getuid?.(),
  expectedGid = process.getgid?.(),
}) {
  const uid = numericIdentity(expectedUid, "Expected runner UID");
  const gid = numericIdentity(expectedGid, "Expected runner GID");
  assertProductionShadowPullStaging({
    isolationRoot,
    stagingRoot,
    logicalTarget,
    orgId,
    projectId,
    expectedUid: uid,
    expectedGid: gid,
  });
  const canonicalMaterializationRoot = assertProtectedIsolationChild({
    isolationRoot,
    path: materializationRoot,
    expectedName: BUILD_ENVIRONMENT_DIRECTORY,
    expectedUid: uid,
    expectedGid: gid,
  });
  if (optionalEntry(canonicalMaterializationRoot)) {
    throw new Error(
      "Materialized production-shadow build environment must be fresh",
    );
  }
  const contract = targetContract(logicalTarget);
  const environmentFile = pulledEnvironmentFile(logicalTarget);
  const sourceBefore = readProtectedEnvironmentFile({
    root: stagingRoot,
    filePath: join(
      stagingRoot,
      contract.rootDirectory,
      ".vercel",
      environmentFile,
    ),
    expectedUid: uid,
    expectedGid: gid,
    label: "Vercel-pulled production-shadow build environment",
  });
  const derived = deriveProductionShadowBuildEnvironment({
    logicalTarget,
    raw: sourceBefore.bytes,
  });

  mkdirSync(canonicalMaterializationRoot, { mode: 0o700 });
  chmodSync(canonicalMaterializationRoot, 0o700);
  const vercelDirectory = join(canonicalMaterializationRoot, ".vercel");
  mkdirSync(vercelDirectory, { mode: 0o700 });
  chmodSync(vercelDirectory, 0o700);
  const environmentPath = join(vercelDirectory, environmentFile);
  if (typeof constants.O_NOFOLLOW !== "number") {
    throw new Error(
      "Materialized production-shadow environment cannot be created safely",
    );
  }
  const descriptor = openSync(
    environmentPath,
    constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW |
      constants.O_WRONLY,
    0o600,
  );
  try {
    writeFileSync(descriptor, derived.serialized, { encoding: "utf8" });
    fchmodSync(descriptor, 0o600);
  } finally {
    closeSync(descriptor);
  }
  assignProductionShadowMaterializationOwnership({
    materializationRoot: canonicalMaterializationRoot,
    environmentPath,
    expectedUid: uid,
    expectedGid: gid,
  });
  chmodSync(canonicalMaterializationRoot, 0o700);
  chmodSync(vercelDirectory, 0o700);
  chmodSync(environmentPath, 0o600);

  const inspected = inspectMaterializedProductionShadowBuildEnvironment({
    isolationRoot,
    stagingRoot,
    materializationRoot: canonicalMaterializationRoot,
    logicalTarget,
    orgId,
    projectId,
    expectedUid: uid,
    expectedGid: gid,
  });
  assertSameProtectedSource(sourceBefore, inspected.sourceSnapshot);
  return {
    checked: inspected.checked,
    environmentPath: inspected.environmentPath,
    materializationRoot: canonicalMaterializationRoot,
  };
}

export function assertMaterializedProductionShadowBuildEnvironment(options) {
  const inspected =
    inspectMaterializedProductionShadowBuildEnvironment(options);
  return {
    checked: inspected.checked,
    environmentPath: inspected.environmentPath,
  };
}

export function assignProductionShadowMaterializationOwnership({
  materializationRoot,
  environmentPath,
  expectedUid,
  expectedGid,
  changeOwner = chownSync,
}) {
  const uid = numericIdentity(expectedUid, "Expected runner UID");
  const gid = numericIdentity(expectedGid, "Expected runner GID");
  for (const path of [
    materializationRoot,
    join(materializationRoot, ".vercel"),
    environmentPath,
  ]) {
    changeOwner(path, uid, gid);
  }
}

function assertCandidateRootComponents({
  isolationRoot,
  candidateRoot,
  logicalTarget,
  buildUid,
  buildGid,
  runnerUid,
  runnerGid,
}) {
  const contract = targetContract(logicalTarget);
  const canonicalCandidateRoot = assertProtectedIsolationChild({
    isolationRoot,
    path: candidateRoot,
    expectedName: CANDIDATE_SOURCE_DIRECTORY,
    expectedUid: runnerUid,
    expectedGid: runnerGid,
  });
  if (realpathSync(candidateRoot) !== canonicalCandidateRoot) {
    throw new Error("Candidate source escaped the Vercel isolation root");
  }
  let current = canonicalCandidateRoot;
  for (const [path, label] of [
    [canonicalCandidateRoot, "Candidate source"],
    ...contract.rootDirectory.split("/").map((component) => {
      current = join(current, component);
      return [current, "Candidate Root Directory"];
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

export function assertCandidateProductionShadowPull({
  isolationRoot,
  candidateRoot,
  logicalTarget,
  orgId,
  projectId,
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
    logicalTarget,
    buildUid: candidateUid,
    buildGid: candidateGid,
    runnerUid: trustedUid,
    runnerGid: trustedGid,
  });
  const contract = targetContract(logicalTarget);
  const expected = expectedPullTree(logicalTarget);
  for (const stateRoot of [
    ".vercel",
    join(contract.rootDirectory, ".vercel"),
  ]) {
    const stateEntries = expected
      .filter(
        ([path]) => path === stateRoot || path.startsWith(`${stateRoot}${sep}`),
      )
      .map(([path, specification]) => [
        relative(stateRoot, path),
        specification,
      ]);
    assertExactFilesystemTree(
      join(canonicalCandidateRoot, stateRoot),
      stateEntries,
      {
        expectedUid: candidateUid,
        expectedGid: candidateGid,
        label: "Candidate Vercel state",
      },
    );
  }
  const candidateEnvironment = readProtectedEnvironmentFile({
    root: canonicalCandidateRoot,
    filePath: join(
      canonicalCandidateRoot,
      contract.rootDirectory,
      ".vercel",
      pulledEnvironmentFile(logicalTarget),
    ),
    expectedUid: candidateUid,
    expectedGid: candidateGid,
    label: "Candidate production-shadow build environment",
  });
  const expectedEnvironment = deriveProductionShadowBuildEnvironment({
    logicalTarget,
    raw: candidateEnvironment.bytes,
  });
  if (
    !candidateEnvironment.bytes.equals(
      Buffer.from(expectedEnvironment.serialized, "utf8"),
    )
  ) {
    throw new Error(
      "Candidate production-shadow build environment is not the canonical exact allowlist",
    );
  }
  return assertPulledProductionShadowProject({
    repoRoot: canonicalCandidateRoot,
    logicalTarget,
    orgId,
    projectId,
  });
}

export function stageProductionShadowPullForCandidate({
  isolationRoot,
  stagingRoot,
  candidateRoot,
  logicalTarget,
  orgId,
  projectId,
  buildUid,
  buildGid,
  runnerUid,
  runnerGid,
}) {
  const candidateUid = numericIdentity(buildUid, "Candidate build UID");
  const candidateGid = numericIdentity(buildGid, "Candidate build GID");
  const trustedUid = numericIdentity(runnerUid, "Runner UID");
  const trustedGid = numericIdentity(runnerGid, "Runner GID");
  const materializationRoot = join(
    resolve(isolationRoot),
    BUILD_ENVIRONMENT_DIRECTORY,
  );
  const materializedEnvironment = materializeProductionShadowBuildEnvironment({
    isolationRoot,
    stagingRoot,
    materializationRoot,
    logicalTarget,
    orgId,
    projectId,
    expectedUid: trustedUid,
    expectedGid: trustedGid,
  });
  const canonicalCandidateRoot = assertCandidateRootComponents({
    isolationRoot,
    candidateRoot,
    logicalTarget,
    buildUid: candidateUid,
    buildGid: candidateGid,
    runnerUid: trustedUid,
    runnerGid: trustedGid,
  });
  const contract = targetContract(logicalTarget);
  for (const path of [
    join(canonicalCandidateRoot, ".vercel"),
    join(canonicalCandidateRoot, contract.rootDirectory, ".vercel"),
  ]) {
    rmSync(path, { force: true, recursive: true });
    mkdirSync(path, { mode: 0o700 });
    chownSync(path, candidateUid, candidateGid);
    chmodSync(path, 0o700);
  }
  for (const relativePath of [
    join(".vercel", "repo.json"),
    join(contract.rootDirectory, ".vercel", "project.json"),
  ]) {
    const destination = join(canonicalCandidateRoot, relativePath);
    copyFileSync(
      join(stagingRoot, relativePath),
      destination,
      constants.COPYFILE_EXCL,
    );
    chownSync(destination, candidateUid, candidateGid);
    chmodSync(destination, 0o600);
  }
  const candidateEnvironmentPath = join(
    canonicalCandidateRoot,
    contract.rootDirectory,
    ".vercel",
    pulledEnvironmentFile(logicalTarget),
  );
  copyFileSync(
    materializedEnvironment.environmentPath,
    candidateEnvironmentPath,
    constants.COPYFILE_EXCL,
  );
  chownSync(candidateEnvironmentPath, candidateUid, candidateGid);
  chmodSync(candidateEnvironmentPath, 0o600);
  const candidateProject = assertCandidateProductionShadowPull({
    isolationRoot,
    candidateRoot: canonicalCandidateRoot,
    logicalTarget,
    orgId,
    projectId,
    buildUid: candidateUid,
    buildGid: candidateGid,
    runnerUid: trustedUid,
    runnerGid: trustedGid,
  });
  assertMaterializedProductionShadowBuildEnvironment({
    isolationRoot,
    stagingRoot,
    materializationRoot,
    logicalTarget,
    orgId,
    projectId,
    expectedUid: trustedUid,
    expectedGid: trustedGid,
  });
  return candidateProject;
}

const GITHUB_COMMAND_FILE_NAMES = [
  "GITHUB_ENV",
  "GITHUB_OUTPUT",
  "GITHUB_PATH",
  "GITHUB_STATE",
  "GITHUB_STEP_SUMMARY",
];

export function environmentForTrustedChild(environment) {
  const cliEnvironment = { ...environment };
  for (const name of GITHUB_COMMAND_FILE_NAMES) {
    delete cliEnvironment[name];
  }
  return cliEnvironment;
}

export function environmentForVercelCli(environment) {
  const cliEnvironment = {};
  for (const name of VERCEL_CLI_ENVIRONMENT_NAMES) {
    const value = environment[name];
    if (value === undefined || value === "") continue;
    cliEnvironment[name] = requireString(value, name);
  }
  return cliEnvironment;
}

export function buildProductionShadowPullArguments({
  logicalTarget,
  projectId,
}) {
  const contract = targetContract(logicalTarget);
  // Pinned Vercel CLI accepts a Git branch only for preview pulls. Production
  // and custom-environment selection is carried entirely by --environment;
  // exact-main provenance is supplied separately to build and deploy.
  return [
    "pull",
    "--yes",
    "--environment",
    contract.pullEnvironment,
    "--project",
    requireIdentifier(projectId, "Vercel project ID"),
  ];
}

export function buildProductionShadowBuildArguments({
  logicalTarget,
  projectId,
}) {
  const contract = targetContract(logicalTarget);
  return [
    ...contract.buildArguments,
    "--project",
    requireIdentifier(projectId, "Vercel project ID"),
  ];
}

function assertSafeProductionShadowArguments(argumentsList) {
  for (const [index, argument] of argumentsList.entries()) {
    if (argument === "--token" || argument.startsWith("--token=")) {
      throw new Error(
        "Vercel tokens must be passed only through the environment",
      );
    }
    const metadata =
      argument === "--meta"
        ? argumentsList[index + 1]
        : argument.startsWith("--meta=")
          ? argument.slice("--meta=".length)
          : undefined;
    if (metadata?.split("=", 1)[0] === "githubDeployment") {
      throw new Error("Forbidden Vercel metadata key: githubDeployment");
    }
  }
  if (["promote", "alias"].includes(argumentsList[0])) {
    throw new Error("Forbidden normal-path Vercel mutation command");
  }
  return argumentsList;
}

export function buildProductionShadowDeployArguments({
  logicalTarget,
  projectId,
  deploySha,
  transaction,
}) {
  const contract = targetContract(logicalTarget);
  if (contract.deployArguments === null) {
    throw new Error("The app v3 target is build-only in the production shadow");
  }
  const sha = requireString(
    deploySha,
    "Deployment SHA",
    SHA_PATTERN,
  ).toLowerCase();
  const safeTransaction = requireString(
    transaction,
    "Production-shadow transaction",
    /^(?:[1-9][0-9]*-[1-9][0-9]*-(?:governance|reserve|ui)|main-[0-9a-f]{40}-[1-9][0-9]*-[1-9][0-9]*)$/,
  );
  if (
    !safeTransaction.startsWith("main-") &&
    !safeTransaction.endsWith(`-${logicalTarget}`)
  ) {
    throw new Error("Production-shadow transaction target is inconsistent");
  }
  return assertSafeProductionShadowArguments([
    ...contract.deployArguments,
    "--project",
    requireIdentifier(projectId, "Vercel project ID"),
    "--meta",
    "githubCommitOrg=mento-protocol",
    "--meta",
    "githubCommitRepo=frontend-monorepo",
    "--meta",
    "githubCommitRef=main",
    "--meta",
    `githubCommitSha=${sha}`,
    "--meta",
    `mentoTransaction=${safeTransaction}`,
  ]);
}

export function assertPulledProductionShadowProject({
  repoRoot,
  logicalTarget,
  orgId,
  projectId,
}) {
  const contract = targetContract(logicalTarget);
  const expectedLink = {
    remoteName: "origin",
    projects: [
      {
        id: requireIdentifier(projectId, "Vercel project ID"),
        directory: contract.rootDirectory,
        orgId: requireIdentifier(orgId, "Vercel organization ID"),
      },
    ],
  };
  const root = resolve(repoRoot);
  const repoLinkPath = join(root, ".vercel", "repo.json");
  const appVercelDirectory = join(root, contract.rootDirectory, ".vercel");
  const projectPath = join(appVercelDirectory, "project.json");
  assertPlainDirectory(join(root, ".vercel"), "Repo-level Vercel state");
  assertPlainFile(repoLinkPath, "Repo-level Vercel link");
  assertPlainDirectory(appVercelDirectory, "App-root Vercel state");
  assertPlainFile(projectPath, "Pulled app-root Vercel project settings");
  const repoLink = readJson(repoLinkPath, "Repo-level Vercel link");
  const project = readJson(
    projectPath,
    "Pulled app-root Vercel project settings",
  );
  if (JSON.stringify(repoLink) !== JSON.stringify(expectedLink)) {
    throw new Error(
      "Repo-level Vercel mapping does not match the literal target",
    );
  }
  if (project.settings?.rootDirectory !== contract.rootDirectory) {
    throw new Error(
      "Pulled Vercel Root Directory does not match the literal target",
    );
  }
  if (
    Object.keys(project).length !== 1 ||
    !Object.hasOwn(project, "settings")
  ) {
    throw new Error(
      "Pulled repo-linked Vercel project file must contain only settings",
    );
  }
  return project;
}

export function assertProductionShadowOutput({
  repoRoot,
  logicalTarget,
  deploymentId,
  expectedUid = process.getuid?.(),
  expectedGid = process.getgid?.(),
}) {
  const contract = targetContract(logicalTarget);
  const outputDirectory = join(
    resolve(repoRoot),
    contract.rootDirectory,
    ".vercel",
    "output",
  );
  const configPath = join(outputDirectory, "config.json");
  const buildsPath = join(outputDirectory, "builds.json");
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
    } else if (
      !entry.isFile() ||
      (uid === process.getuid?.() && entry.nlink !== 1)
    ) {
      throw new Error("Prebuilt output contains a special or hard-linked file");
    } else {
      assertStandaloneVercelConfig(path, entry);
    }
  }
  if (!lstatSync(configPath).isFile() || !lstatSync(buildsPath).isFile()) {
    throw new Error("Prebuilt app-root output is missing a required file");
  }
  const config = readJson(configPath, "Prebuilt output config");
  const buildRecord = readJson(buildsPath, "Vercel CLI build record");
  const expectedTarget = logicalTarget === "app" ? "v3" : "production";
  if (config.version !== 3) {
    throw new Error("Prebuilt output is not Build Output API version 3");
  }
  if (
    buildRecord.target !== expectedTarget ||
    buildRecord.cliVersion !== "56.2.0"
  ) {
    throw new Error("Prebuilt output target or Vercel CLI version is invalid");
  }
  assertPrebuiltDeploymentId(outputDirectory, deploymentId);
  return outputDirectory;
}

function assertProductionShadowProvenance({
  repoRoot,
  deploySha,
  expectedUid = process.getuid?.(),
}) {
  const path = `${resolve(repoRoot)}.provenance.json`;
  const uid = numericIdentity(expectedUid, "Expected provenance UID");
  let provenance;
  try {
    const entry = lstatSync(path);
    if (
      entry.isSymbolicLink() ||
      !entry.isFile() ||
      entry.uid !== uid ||
      entry.nlink !== 1 ||
      (entry.mode & 0o022) !== 0
    ) {
      throw new Error("unsafe provenance file");
    }
    provenance = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(
      "Production-shadow source provenance is missing or invalid",
    );
  }
  const sha = requireString(
    deploySha,
    "Deployment SHA",
    SHA_PATTERN,
  ).toLowerCase();
  if (
    !provenance ||
    typeof provenance !== "object" ||
    Array.isArray(provenance) ||
    Object.keys(provenance).length !== 1 ||
    provenance.commitSha !== sha
  ) {
    throw new Error(
      "Production-shadow source provenance does not match DEPLOY_SHA",
    );
  }
  return provenance;
}

function assertOwnedMappingFile(path, uid, gid, label) {
  const entry = lstatSync(path);
  if (
    entry.isSymbolicLink() ||
    !entry.isFile() ||
    entry.uid !== uid ||
    entry.gid !== gid ||
    entry.nlink !== 1 ||
    (entry.mode & 0o077) !== 0
  ) {
    throw new Error(`${label} has unsafe ownership or permissions`);
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

export function assertProductionShadowReadyForUpload({
  repoRoot,
  logicalTarget,
  orgId,
  projectId,
  deploymentId,
  deploySha,
  expectedUid = process.getuid?.(),
  expectedGid = process.getgid?.(),
  expectedProvenanceUid = process.getuid?.(),
}) {
  const uid = numericIdentity(expectedUid, "Expected output UID");
  const gid = numericIdentity(expectedGid, "Expected output GID");
  const root = resolve(repoRoot);
  const contract = targetContract(logicalTarget);
  assertProductionShadowProvenance({
    repoRoot: root,
    deploySha,
    expectedUid: expectedProvenanceUid,
  });
  assertOwnedMappingFile(
    join(root, ".vercel", "repo.json"),
    uid,
    gid,
    "Repo-level Vercel link",
  );
  assertOwnedMappingFile(
    join(root, contract.rootDirectory, ".vercel", "project.json"),
    uid,
    gid,
    "App-root Vercel project settings",
  );
  assertPulledProductionShadowProject({
    repoRoot: root,
    logicalTarget,
    orgId,
    projectId,
  });
  return assertProductionShadowOutput({
    repoRoot: root,
    logicalTarget,
    deploymentId,
    expectedUid: uid,
    expectedGid: gid,
  });
}

function normalizeRunnerOwnedHandoffTree(
  root,
  uid,
  gid,
  {
    changeMode = chmodSync,
    changeOwner = chownSync,
    inspect = lstatSync,
    list = readdirSync,
  } = {},
) {
  const pending = [root];
  let entries = 0;
  while (pending.length > 0) {
    const path = pending.pop();
    const entry = inspect(path);
    entries += 1;
    if (entries > 250_000) {
      throw new Error("Upload handoff contains too many filesystem entries");
    }
    if (entry.isSymbolicLink()) {
      throw new Error("Upload handoff contains a symbolic link");
    }
    if (entry.isDirectory()) {
      changeOwner(path, uid, gid);
      changeMode(path, 0o755);
      for (const child of list(path)) pending.push(join(path, child));
      continue;
    }
    if (!entry.isFile() || entry.nlink !== 1) {
      throw new Error("Upload handoff contains a special or hard-linked file");
    }
    changeOwner(path, uid, gid);
    changeMode(path, (entry.mode & 0o111) === 0 ? 0o644 : 0o755);
  }
}

export function createProductionShadowUploadHandoff({
  isolationRoot,
  stagingRoot,
  candidateRoot,
  uploadRoot,
  logicalTarget,
  orgId,
  projectId,
  deploymentId,
  deploySha,
  buildUid,
  buildGid,
  runnerUid,
  runnerGid,
  copyTree = cpSync,
  changeMode = chmodSync,
  changeOwner = chownSync,
  inspect = lstatSync,
  list = readdirSync,
  validateCandidate = assertProductionShadowReadyForUpload,
  validateMaterialized = assertMaterializedProductionShadowBuildEnvironment,
  validateStaging = assertProductionShadowPullStaging,
  validateUpload = assertProductionShadowReadyForUpload,
}) {
  const candidateUid = numericIdentity(buildUid, "Candidate build UID");
  const candidateGid = numericIdentity(buildGid, "Candidate build GID");
  const trustedUid = numericIdentity(runnerUid, "Runner UID");
  const trustedGid = numericIdentity(runnerGid, "Runner GID");
  const contract = targetContract(logicalTarget);
  const canonicalCandidateRoot = assertProtectedIsolationChild({
    isolationRoot,
    path: candidateRoot,
    expectedName: CANDIDATE_SOURCE_DIRECTORY,
    expectedUid: trustedUid,
    expectedGid: trustedGid,
  });
  if (realpathSync(candidateRoot) !== canonicalCandidateRoot) {
    throw new Error(
      "Candidate upload source escaped the Vercel isolation root",
    );
  }
  validateStaging({
    isolationRoot,
    stagingRoot,
    logicalTarget,
    orgId,
    projectId,
    expectedUid: trustedUid,
    expectedGid: trustedGid,
  });
  validateMaterialized({
    isolationRoot,
    stagingRoot,
    materializationRoot: join(
      resolve(isolationRoot),
      BUILD_ENVIRONMENT_DIRECTORY,
    ),
    logicalTarget,
    orgId,
    projectId,
    expectedUid: trustedUid,
    expectedGid: trustedGid,
  });
  validateCandidate({
    repoRoot: canonicalCandidateRoot,
    logicalTarget,
    orgId,
    projectId,
    deploymentId,
    deploySha,
    expectedUid: candidateUid,
    expectedGid: candidateGid,
    expectedProvenanceUid: trustedUid,
  });
  const canonicalUploadRoot = assertProtectedIsolationChild({
    isolationRoot,
    path: uploadRoot,
    expectedName: UPLOAD_SOURCE_DIRECTORY,
    expectedUid: trustedUid,
    expectedGid: trustedGid,
  });
  if (optionalEntry(canonicalUploadRoot)) {
    throw new Error("Production-shadow upload handoff must be fresh");
  }

  const uploadAppState = join(
    canonicalUploadRoot,
    contract.rootDirectory,
    ".vercel",
  );
  mkdirSync(join(canonicalUploadRoot, ".vercel"), {
    mode: 0o755,
    recursive: true,
  });
  mkdirSync(uploadAppState, { mode: 0o755, recursive: true });
  copyTree(
    join(canonicalCandidateRoot, contract.rootDirectory, ".vercel", "output"),
    join(uploadAppState, "output"),
    {
      dereference: false,
      errorOnExist: true,
      force: false,
      preserveTimestamps: true,
      recursive: true,
    },
  );
  for (const relativePath of [
    join(".vercel", "repo.json"),
    join(contract.rootDirectory, ".vercel", "project.json"),
  ]) {
    copyFileSync(
      join(stagingRoot, relativePath),
      join(canonicalUploadRoot, relativePath),
      constants.COPYFILE_EXCL,
    );
  }
  normalizeRunnerOwnedHandoffTree(canonicalUploadRoot, trustedUid, trustedGid, {
    changeMode,
    changeOwner,
    inspect,
    list,
  });
  for (const relativePath of [
    join(".vercel", "repo.json"),
    join(contract.rootDirectory, ".vercel", "project.json"),
  ]) {
    changeMode(join(canonicalUploadRoot, relativePath), 0o600);
  }
  const provenancePath = `${canonicalUploadRoot}.provenance.json`;
  writePrivateJson(provenancePath, {
    commitSha: requireString(
      deploySha,
      "Deployment SHA",
      SHA_PATTERN,
    ).toLowerCase(),
  });
  changeOwner(provenancePath, trustedUid, trustedGid);
  changeMode(provenancePath, 0o600);

  validateUpload({
    repoRoot: canonicalUploadRoot,
    logicalTarget,
    orgId,
    projectId,
    deploymentId,
    deploySha,
    expectedUid: trustedUid,
    expectedGid: trustedGid,
    expectedProvenanceUid: trustedUid,
  });
  return {
    sourceRoot: canonicalUploadRoot,
    uid: trustedUid,
    gid: trustedGid,
  };
}

export function runProductionShadowVercel({
  repoRoot,
  argumentsList,
  environment = process.env,
  captureStdout = false,
  run = spawnSync,
}) {
  assertSafeProductionShadowArguments(argumentsList);
  const nodeBin = environment.TRUSTED_NODE_PATH;
  const vercelCli = environment.TRUSTED_VERCEL_CLI_PATH;
  if ((nodeBin === undefined) !== (vercelCli === undefined)) {
    throw new Error("Protected Vercel runtime paths must be provided together");
  }
  if (
    nodeBin !== undefined &&
    (!isAbsolute(nodeBin) || !isAbsolute(vercelCli))
  ) {
    throw new Error("Protected Vercel runtime paths must be absolute");
  }
  const command = nodeBin ?? "pnpm";
  const commandArguments = nodeBin
    ? [vercelCli, ...argumentsList]
    : ["exec", "vercel", ...argumentsList];
  const result = run(command, commandArguments, {
    cwd: resolve(repoRoot),
    encoding: "utf8",
    env: environmentForVercelCli(environment),
    stdio: captureStdout ? ["ignore", "pipe", "inherit"] : "inherit",
  });
  if (result.error || result.status !== 0) {
    throw new Error("Pinned Vercel CLI command failed");
  }
  return captureStdout ? result.stdout : "";
}

export function pullProductionShadowProject({
  repoRoot,
  logicalTarget,
  projectId,
  environment = process.env,
  executeVercel = runProductionShadowVercel,
}) {
  const previousUmask = process.umask(0o077);
  try {
    return executeVercel({
      repoRoot,
      argumentsList: buildProductionShadowPullArguments({
        logicalTarget,
        projectId,
      }),
      environment,
    });
  } finally {
    process.umask(previousUmask);
  }
}

export function buildProductionShadowArtifact({
  repoRoot,
  logicalTarget,
  orgId,
  projectId,
  deploymentId,
  environment = process.env,
  executeVercel = runProductionShadowVercel,
}) {
  executeVercel({
    repoRoot,
    argumentsList: buildProductionShadowBuildArguments({
      logicalTarget,
      projectId,
    }),
    environment,
  });
  // The candidate build can mutate either Vercel link after the pre-build
  // validation. Revalidate the exact trusted mapping before accepting output
  // or allowing the workflow to advance to a deploy step.
  assertPulledProductionShadowProject({
    repoRoot,
    logicalTarget,
    orgId,
    projectId,
  });
  return assertProductionShadowOutput({
    repoRoot,
    logicalTarget,
    deploymentId,
  });
}

export function parseDeployOutput(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Vercel deploy output is malformed");
  }
  if (raw.status !== undefined && raw.status !== "ok") {
    throw new Error("Vercel deploy did not report a successful upload");
  }
  const deployment = raw.deployment ?? raw;
  if (
    !deployment ||
    typeof deployment !== "object" ||
    Array.isArray(deployment)
  ) {
    throw new Error("Vercel deploy output is malformed");
  }
  const deploymentId = deployment.id ?? deployment.deploymentId;
  const deploymentUrl = deployment.url ?? deployment.deploymentUrl;
  requireString(deploymentId, "Vercel deployment ID", DEPLOYMENT_ID_PATTERN);
  return {
    deploymentId,
    deploymentUrl: canonicalizeDeploymentUrl(deploymentUrl),
  };
}

export function createDeploymentExpectation({
  deployment,
  deploymentUrl,
  projectId,
  projectName,
  sha,
  transaction,
  target = "production",
  customEnvironmentSlug = null,
}) {
  return {
    deployment: requireString(
      deployment,
      "Vercel deployment ID",
      DEPLOYMENT_ID_PATTERN,
    ),
    deploymentUrl: canonicalizeDeploymentUrl(deploymentUrl),
    projectId: requireString(projectId, "Vercel project ID"),
    projectName: requireString(projectName, "Vercel project name"),
    readyState: "READY",
    target,
    customEnvironmentSlug,
    transaction: requireString(
      transaction,
      "Workflow transaction",
      /^(?:[1-9][0-9]*-[1-9][0-9]*-(?:governance|reserve|ui)|main-[0-9a-f]{40}-[1-9][0-9]*-[1-9][0-9]*)$/,
    ),
    git: {
      ...expectedGit("main"),
      sha: requireString(sha, "Deployment SHA", SHA_PATTERN).toLowerCase(),
    },
  };
}

export function assertUnaliasedProductionShadowDeployment(state) {
  assertCanonicalOutput(state);
  if (Array.isArray(state)) {
    throw new Error(
      "Staged deployment state must describe exactly one deployment",
    );
  }
  const immutableHostname = new URL(state.deploymentUrl).hostname;
  if (
    state.alias !== immutableHostname ||
    JSON.stringify(state.aliases) !== JSON.stringify([immutableHostname])
  ) {
    throw new Error(
      "Staged production deployment received an unexpected alias",
    );
  }
  return state;
}

export function createAppBuildOnlyProof({ sha, deploymentId }) {
  const normalizedSha = requireString(
    sha,
    "Deployment SHA",
    SHA_PATTERN,
  ).toLowerCase();
  return {
    target: "app",
    sha: normalizedSha,
    environment: "v3",
    vercelEnv: "preview",
    vercelTargetEnv: "v3",
    nextPublicVercelEnv: "preview",
    nextDeploymentId: requireString(deploymentId, "Next deployment ID"),
    sentryAuthToken: EXPLICIT_EMPTY,
    deployReachable: false,
    futureActivationCommand:
      "vercel deploy --prebuilt --target=v3 --archive=tgz --format=json",
    futureMetadata: [
      "githubCommitOrg=mento-protocol",
      "githubCommitRepo=frontend-monorepo",
      "githubCommitRef=main",
      `githubCommitSha=${normalizedSha}`,
      "mentoTransaction=<run_id>-<run_attempt>-app",
    ],
  };
}

export function writePilotSummary({
  path,
  baseline,
  sha,
  runUrl,
  workflowDurationMs,
  app,
  governance,
  reserve,
  ui,
}) {
  const normalizedSha = requireString(
    sha,
    "Deployment SHA",
    SHA_PATTERN,
  ).toLowerCase();
  const v3States = baseline
    .filter((state) => state.customEnvironmentSlug === "v3")
    .sort((left, right) => left.alias.localeCompare(right.alias));
  const legacy = baseline.find((state) => state.alias === "v2-app.mento.org");
  if (v3States.length === 0 || !legacy) {
    throw new Error("Pilot baseline is missing app v3 or legacy v2 state");
  }
  if (new Set(v3States.map((state) => state.deploymentId)).size !== 1) {
    throw new Error("Pilot baseline has divergent app-v3 deployments");
  }
  const checkedDeployment = (value, label) => ({
    id: requireString(
      value.id,
      `${label} deployment ID`,
      DEPLOYMENT_ID_PATTERN,
    ),
    url: canonicalizeDeploymentUrl(value.url),
    buildDurationMs: requireString(
      value.buildDurationMs,
      `${label} build duration`,
      /^[0-9]+$/,
    ),
    deployDurationMs: requireString(
      value.deployDurationMs,
      `${label} deploy duration`,
      /^[0-9]+$/,
    ),
    totalDurationMs: requireString(
      value.totalDurationMs,
      `${label} total duration`,
      /^[0-9]+$/,
    ),
    cacheHits: requireString(
      value.cacheHits,
      `${label} Turbo cache hits`,
      /^[0-9]+$/,
    ),
    cacheMisses: requireString(
      value.cacheMisses,
      `${label} Turbo cache misses`,
      /^[0-9]+$/,
    ),
  });
  const deployments = {
    governance: checkedDeployment(governance, "Governance"),
    reserve: checkedDeployment(reserve, "Reserve"),
    ui: checkedDeployment(ui, "UI"),
  };
  const appBuildDuration = requireString(
    app.buildDurationMs,
    "App build duration",
    /^[0-9]+$/,
  );
  const appTotalDuration = requireString(
    app.totalDurationMs,
    "App total duration",
    /^[0-9]+$/,
  );
  const appDeploymentId = requireString(
    app.nextDeploymentId,
    "App Next deployment ID",
  );
  const appCacheHits = requireString(
    app.cacheHits,
    "App Turbo cache hits",
    /^[0-9]+$/,
  );
  const appCacheMisses = requireString(
    app.cacheMisses,
    "App Turbo cache misses",
    /^[0-9]+$/,
  );
  const totalWorkflowDuration = requireString(
    workflowDurationMs,
    "Whole workflow duration",
    /^[0-9]+$/,
  );
  const lines = [
    "### Production-shadow pilot evidence",
    "",
    `- Workflow run: ${requireString(runUrl, "Workflow run URL")}`,
    `- Exact deployment SHA: \`${normalizedSha}\``,
    `- Whole workflow duration: ${totalWorkflowDuration} ms`,
    "- Pinned Vercel CLI: `56.2.0`",
    "- Project Root Directories verified: `apps/app.mento.org`, `apps/governance.mento.org`, `apps/reserve.mento.org`, `apps/ui.mento.org`",
    "",
    "| Target | Build target | Deployment ID / URL | Runtime/browser | Protected mappings | Turbo cache | Timing | Result |",
    "|---|---|---|---|---|---|---|---|",
    `| app | v3 | build-only Outcome B (Next ID \`${appDeploymentId}\`) | deferred by design | app/v2 unchanged | ${appCacheHits} hit / ${appCacheMisses} miss | build ${appBuildDuration} ms; job ${appTotalDuration} ms | pass |`,
    `| governance | production | \`${deployments.governance.id}\` / ${deployments.governance.url} | pass | unchanged | ${deployments.governance.cacheHits} hit / ${deployments.governance.cacheMisses} miss | build ${deployments.governance.buildDurationMs} ms; deploy ${deployments.governance.deployDurationMs} ms; job ${deployments.governance.totalDurationMs} ms | pass |`,
    `| reserve | production | \`${deployments.reserve.id}\` / ${deployments.reserve.url} | pass | unchanged | ${deployments.reserve.cacheHits} hit / ${deployments.reserve.cacheMisses} miss | build ${deployments.reserve.buildDurationMs} ms; deploy ${deployments.reserve.deployDurationMs} ms; job ${deployments.reserve.totalDurationMs} ms | pass |`,
    `| ui | production | \`${deployments.ui.id}\` / ${deployments.ui.url} | pass | unchanged | ${deployments.ui.cacheHits} hit / ${deployments.ui.cacheMisses} miss | build ${deployments.ui.buildDurationMs} ms; deploy ${deployments.ui.deployDurationMs} ms; job ${deployments.ui.totalDurationMs} ms | pass |`,
    `| legacy app | v2 production | \`${legacy.deploymentId}\` / ${canonicalizeDeploymentUrl(legacy.deploymentUrl)} | public health pass | unchanged | n/a | n/a | pass |`,
    "",
    `- Reviewed app-v3 aliases: ${v3States.map((state) => `\`${state.alias}\``).join(", ")}`,
    `- Captured prior app-v3 deployment: \`${v3States[0].deploymentId}\` / ${canonicalizeDeploymentUrl(v3States[0].deploymentUrl)}`,
    "- Copy-safe app-v3 rollback commands:",
    ...v3States.map(
      (state) =>
        `  - \`vercel alias set ${canonicalizeDeploymentUrl(state.deploymentUrl)} ${state.alias}\``,
    ),
    "- Real required-variable names passed preflight; the synthetic `FIXTURE_REQUIRED_SECRET` failure is covered by the offline primitive suite.",
    "- Turbo cache hit/miss counts are parsed fail-closed from each build's single canonical summary; the original summaries remain in the build logs.",
    "- No raw Vercel response, pulled environment, `.vercel/output`, credential, or protection-bypass value was uploaded.",
    "",
  ];
  writeFileSync(resolve(path), lines.join("\n"), { flag: "a" });
}

export function assertEvidenceFiles(files) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error("Evidence file list must be non-empty");
  }
  for (const path of files) {
    const evidence = readFileSync(resolve(path), "utf8");
    if (FORBIDDEN_EVIDENCE_PATTERN.test(evidence)) {
      throw new Error("Evidence contains a forbidden sensitive field name");
    }
  }
}

export function assertRequiredVariableNames(names, values = process.env) {
  if (!Array.isArray(names) || names.length === 0) {
    throw new Error("Required variable-name list must be non-empty");
  }
  const missing = names
    .map((name) =>
      requireString(name, "Required variable name", /^[A-Z0-9_]+$/),
    )
    .filter((name) => values[name] === undefined || values[name] === "")
    .sort();
  if (missing.length > 0) {
    throw new Error(`Missing required variables: ${missing.join(", ")}`);
  }
  return names.length;
}

export const REQUIRED_BUILD_CACHE_VARIABLE_NAMES = Object.freeze([
  "TURBO_REMOTE_CACHE_SIGNATURE_KEY",
  "TURBO_TEAM",
  "TURBO_TOKEN",
]);

export function assertProductionShadowBuildInputs(values = process.env) {
  return assertRequiredVariableNames(
    REQUIRED_BUILD_CACHE_VARIABLE_NAMES,
    values,
  );
}

export async function assertProtectedAliasesUnchanged({ baseline, client }) {
  if (!Array.isArray(baseline) || baseline.length === 0) {
    throw new Error("Protected alias baseline is malformed");
  }
  const baselineByAlias = new Map();
  for (const state of baseline) {
    const alias = canonicalizeHostname(state.alias);
    if (baselineByAlias.has(alias)) {
      throw new Error("Protected alias baseline contains duplicates");
    }
    baselineByAlias.set(alias, {
      alias,
      deploymentId: requireString(
        state.deploymentId,
        "Baseline deployment ID",
        DEPLOYMENT_ID_PATTERN,
      ),
      deploymentUrl: canonicalizeDeploymentUrl(state.deploymentUrl),
      projectId: requireIdentifier(state.projectId, "Baseline project ID"),
    });
  }
  const current = await captureAliasMappings(client, [
    ...baselineByAlias.keys(),
  ]);
  const drift = current.filter((mapping) => {
    const before = baselineByAlias.get(mapping.alias);
    return (
      before.deploymentId !== mapping.deploymentId ||
      before.deploymentUrl !== mapping.deploymentUrl ||
      before.projectId !== mapping.projectId
    );
  });
  if (drift.length === 0) return [];

  const evidence = drift.map((mapping) => {
    const before = baselineByAlias.get(mapping.alias);
    return {
      alias: mapping.alias,
      before: {
        deploymentId: before.deploymentId,
        deploymentUrl: before.deploymentUrl,
      },
      current: {
        deploymentId: mapping.deploymentId,
        deploymentUrl: mapping.deploymentUrl,
      },
      restoreCommand: `vercel alias set ${before.deploymentUrl} ${mapping.alias}`,
    };
  });
  throw new Error(
    [
      "Protected alias drift detected; the shadow pilot is read-only and attempted no repair.",
      `Canonical drift: ${JSON.stringify(evidence)}`,
      "Operator recovery: stop forward work; confirm there is no concurrent or intentional activation; re-resolve every alias and require it to still match the canonical current ID/URL above; only then run the listed restore command manually; finally capture and compare the full protected snapshot again.",
    ].join(" "),
  );
}

export function assertFinalJobResults(results) {
  const required = [
    "preflight",
    "baseline",
    "app",
    "governance",
    "smokeGovernance",
    "reserve",
    "smokeReserve",
    "ui",
    "smokeUi",
    "finalAliasComparison",
  ];
  for (const name of required) {
    if (results[name] !== "success") {
      throw new Error(
        `Required production-shadow job did not succeed: ${name}`,
      );
    }
  }
}

export async function fetchWithOriginBoundRedirects({
  url,
  signal,
  fetchImplementation = fetch,
  maximumRedirects = 5,
}) {
  const allowedOrigin = new URL(url).origin;
  let currentUrl = url;
  for (
    let redirectCount = 0;
    redirectCount <= maximumRedirects;
    redirectCount += 1
  ) {
    const response = await fetchImplementation(currentUrl, {
      redirect: "manual",
      signal,
    });
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers?.get("location");
    if (!location || redirectCount === maximumRedirects) {
      throw new Error("Protected host returned an invalid redirect");
    }
    const nextUrl = new URL(location, currentUrl);
    if (nextUrl.origin !== allowedOrigin) {
      throw new Error("Protected host redirected outside its immutable origin");
    }
    currentUrl = nextUrl.toString();
  }
  throw new Error("Protected host exceeded its redirect limit");
}

export async function waitForHealthyUrls({
  urls,
  attempts = 4,
  delayMs = 2_000,
  fetchImplementation = fetch,
}) {
  if (!Array.isArray(urls) || urls.length === 0) {
    throw new Error("Health-check URL list must be non-empty");
  }
  await Promise.all(
    urls.map(async (value) => {
      const hostname = canonicalizeHostname(value);
      const url = `https://${hostname}`;
      let healthy = false;
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15_000);
        try {
          const response = await fetchWithOriginBoundRedirects({
            url,
            signal: controller.signal,
            fetchImplementation,
          });
          if (response.status >= 200 && response.status < 300) {
            healthy = true;
            break;
          }
        } catch {
          // Retry only; response bodies and errors are intentionally not logged.
        } finally {
          clearTimeout(timeout);
        }
        if (attempt < attempts) {
          await new Promise((resolveDelay) =>
            setTimeout(resolveDelay, delayMs),
          );
        }
      }
      if (!healthy)
        throw new Error(`Protected hostname is not healthy: ${hostname}`);
    }),
  );
}

function parseArguments(argv) {
  const options = {};
  for (let index = 1; index < argv.length; index += 1) {
    if (!argv[index].startsWith("--")) continue;
    options[argv[index].slice(2)] = argv[index + 1];
    index += 1;
  }
  return { command: argv[0], options };
}

function isCliEntrypoint() {
  return (
    process.argv[1] !== undefined &&
    fileURLToPath(import.meta.url) === resolve(process.argv[1])
  );
}

if (isCliEntrypoint()) {
  const { command, options } = parseArguments(process.argv.slice(2));
  if (command === "validate-context") {
    const sha = validateDispatchContext({
      repository: process.env.GITHUB_REPOSITORY,
      ref: process.env.GITHUB_REF,
      workflowRef: process.env.GITHUB_WORKFLOW_REF,
      deploySha: process.env.DEPLOY_SHA,
    });
    appendOutput("deploy_sha", sha);
    process.stdout.write("Production-shadow dispatch context verified\n");
  } else if (command === "validate-source") {
    const sha = validateImmutableMainSource({
      deploySha: process.env.DEPLOY_SHA,
      workflowSha: process.env.GITHUB_WORKFLOW_SHA,
      sourcePath: trustedSourcePath(),
    });
    appendOutput("deploy_sha", sha);
    process.stdout.write("Immutable main source verified\n");
  } else if (command === "create-spec") {
    writePrivateJson(
      options.output,
      createProtectedAliasSpec({
        appV3AliasesJson: process.env.APP_V3_ALIASES_JSON,
        projectIds: {
          app: process.env.VERCEL_PROJECT_ID_APP,
          governance: process.env.VERCEL_PROJECT_ID_GOVERNANCE,
          reserve: process.env.VERCEL_PROJECT_ID_RESERVE,
          ui: process.env.VERCEL_PROJECT_ID_UI,
        },
      }),
    );
    process.stdout.write("Protected alias specification written\n");
  } else if (command === "prepare-link") {
    materializeProductionShadowLink({
      repoRoot: trustedSourcePath(),
      logicalTarget: process.env.LOGICAL_TARGET,
      orgId: process.env.VERCEL_ORG_ID,
      projectId: process.env.VERCEL_PROJECT_ID,
    });
    process.stdout.write("Trusted monorepo Vercel mapping written\n");
  } else if (command === "prepare-pull-staging") {
    prepareProductionShadowPullStaging({
      isolationRoot: process.env.VERCEL_ISOLATION_ROOT,
      stagingRoot: process.env.PULL_STAGING_PATH,
      logicalTarget: process.env.LOGICAL_TARGET,
      orgId: process.env.VERCEL_ORG_ID,
      projectId: process.env.VERCEL_PROJECT_ID,
    });
    process.stdout.write("Runner-owned Vercel pull staging prepared\n");
  } else if (command === "pull") {
    pullProductionShadowProject({
      repoRoot: trustedSourcePath(),
      logicalTarget: process.env.LOGICAL_TARGET,
      projectId: process.env.VERCEL_PROJECT_ID,
    });
    process.stdout.write("Target Vercel configuration pulled\n");
  } else if (command === "materialize-source") {
    materializeExactGitTree({
      isolationRoot: process.env.VERCEL_ISOLATION_ROOT,
      sourceRoot: process.env.SOURCE_PATH,
      candidateRoot: process.env.CANDIDATE_SOURCE_PATH,
      commitSha: process.env.DEPLOY_SHA,
    });
    process.stdout.write("Exact Git source materialized without filters\n");
  } else if (command === "validate-pull-staging") {
    assertProductionShadowPullStaging({
      isolationRoot: process.env.VERCEL_ISOLATION_ROOT,
      stagingRoot: process.env.PULL_STAGING_PATH,
      logicalTarget: process.env.LOGICAL_TARGET,
      orgId: process.env.VERCEL_ORG_ID,
      projectId: process.env.VERCEL_PROJECT_ID,
    });
    process.stdout.write("Runner-owned Vercel pull staging verified\n");
  } else if (command === "stage-pull") {
    stageProductionShadowPullForCandidate({
      isolationRoot: process.env.VERCEL_ISOLATION_ROOT,
      stagingRoot: process.env.PULL_STAGING_PATH,
      candidateRoot: process.env.CANDIDATE_SOURCE_PATH,
      logicalTarget: process.env.LOGICAL_TARGET,
      orgId: process.env.VERCEL_ORG_ID,
      projectId: process.env.VERCEL_PROJECT_ID,
      buildUid: process.env.BUILD_UID,
      buildGid: process.env.BUILD_GID,
      runnerUid: process.env.PULL_STAGING_UID,
      runnerGid: process.env.PULL_STAGING_GID,
    });
    process.stdout.write("Runner-owned Vercel settings staged for candidate\n");
  } else if (command === "validate-candidate-pull") {
    assertCandidateProductionShadowPull({
      isolationRoot: process.env.VERCEL_ISOLATION_ROOT,
      candidateRoot: process.env.CANDIDATE_SOURCE_PATH,
      logicalTarget: process.env.LOGICAL_TARGET,
      orgId: process.env.VERCEL_ORG_ID,
      projectId: process.env.VERCEL_PROJECT_ID,
      buildUid: process.env.BUILD_UID,
      buildGid: process.env.BUILD_GID,
      runnerUid: process.env.PULL_STAGING_UID,
      runnerGid: process.env.PULL_STAGING_GID,
    });
    process.stdout.write("Candidate Vercel settings verified as root\n");
  } else if (command === "validate-pull") {
    assertPulledProductionShadowProject({
      repoRoot: trustedSourcePath(),
      logicalTarget: process.env.LOGICAL_TARGET,
      orgId: process.env.VERCEL_ORG_ID,
      projectId: process.env.VERCEL_PROJECT_ID,
    });
    process.stdout.write("Pulled app-root Vercel project mapping verified\n");
  } else if (command === "check-build-inputs") {
    assertProductionShadowBuildInputs();
    process.stdout.write("Required build input names verified\n");
  } else if (command === "build") {
    assertProductionShadowBuildInputs();
    const startedAt = Date.now();
    const repoRoot = trustedSourcePath();
    const logicalTarget = process.env.LOGICAL_TARGET;
    buildProductionShadowArtifact({
      repoRoot,
      logicalTarget,
      orgId: process.env.VERCEL_ORG_ID,
      projectId: process.env.VERCEL_PROJECT_ID,
      deploymentId: process.env.MENTO_NEXT_DEPLOYMENT_ID,
    });
    appendOutput("build_duration_ms", String(Date.now() - startedAt));
    process.stdout.write("Target prebuilt output created and verified\n");
  } else if (command === "create-handoff") {
    createProductionShadowUploadHandoff({
      isolationRoot: process.env.VERCEL_ISOLATION_ROOT,
      stagingRoot: process.env.PULL_STAGING_PATH,
      candidateRoot: process.env.CANDIDATE_SOURCE_PATH,
      uploadRoot: process.env.UPLOAD_SOURCE_PATH,
      logicalTarget: process.env.LOGICAL_TARGET,
      orgId: process.env.VERCEL_ORG_ID,
      projectId: process.env.VERCEL_PROJECT_ID,
      deploymentId: process.env.MENTO_NEXT_DEPLOYMENT_ID,
      deploySha: process.env.DEPLOY_SHA,
      buildUid: process.env.BUILD_UID,
      buildGid: process.env.BUILD_GID,
      runnerUid: process.env.RUNNER_UID,
      runnerGid: process.env.RUNNER_GID,
    });
    process.stdout.write("Immutable runner-owned upload handoff created\n");
  } else if (command === "assert-output") {
    assertProductionShadowReadyForUpload({
      repoRoot: trustedSourcePath(),
      logicalTarget: process.env.LOGICAL_TARGET,
      orgId: process.env.VERCEL_ORG_ID,
      projectId: process.env.VERCEL_PROJECT_ID,
      deploymentId: process.env.MENTO_NEXT_DEPLOYMENT_ID,
      deploySha: process.env.DEPLOY_SHA,
      expectedUid: process.env.EXPECTED_OUTPUT_UID,
      expectedGid: process.env.EXPECTED_OUTPUT_GID,
      expectedProvenanceUid: process.env.EXPECTED_PROVENANCE_UID,
    });
    process.stdout.write("Production-shadow upload handoff verified\n");
  } else if (command === "deploy") {
    const logicalTarget = process.env.LOGICAL_TARGET;
    const transaction = `${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}-${logicalTarget}`;
    const startedAt = Date.now();
    const raw = runProductionShadowVercel({
      repoRoot: trustedSourcePath(),
      argumentsList: buildProductionShadowDeployArguments({
        logicalTarget,
        projectId: process.env.VERCEL_PROJECT_ID,
        deploySha: process.env.DEPLOY_SHA,
        transaction,
      }),
      captureStdout: true,
    });
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("Vercel deploy output is malformed");
    }
    const result = parseDeployOutput(parsed);
    appendOutput("vercel_deployment_id", result.deploymentId);
    appendOutput("vercel_deployment_url", result.deploymentUrl);
    appendOutput("deploy_duration_ms", String(Date.now() - startedAt));
    writePrivateJson(
      options.expected,
      createDeploymentExpectation({
        deployment: result.deploymentId,
        deploymentUrl: result.deploymentUrl,
        projectId: process.env.VERCEL_PROJECT_ID,
        projectName: targetContract(logicalTarget).projectName,
        sha: process.env.DEPLOY_SHA,
        transaction,
      }),
    );
    process.stdout.write("Canonical deployment identity written\n");
  } else if (command === "app-proof") {
    writePrivateJson(
      options.output,
      createAppBuildOnlyProof({
        sha: process.env.DEPLOY_SHA,
        deploymentId: process.env.MENTO_NEXT_DEPLOYMENT_ID,
      }),
    );
    process.stdout.write("App v3 build-only Outcome B verified\n");
  } else if (command === "assert-unaliased") {
    assertUnaliasedProductionShadowDeployment(
      readJson(options.input, "Staged deployment state"),
    );
    process.stdout.write("Staged production deployment is unaliased\n");
  } else if (command === "evidence") {
    assertEvidenceFiles(readJson(options.files, "Evidence file list"));
    process.stdout.write("Canonical evidence scan passed\n");
  } else if (command === "check-aliases") {
    await assertProtectedAliasesUnchanged({
      baseline: options.baseline
        ? readJson(options.baseline, "Baseline snapshot")
        : readEnvironmentJson("BASELINE_JSON", "Baseline snapshot"),
      client: new VercelStateClient({
        token: process.env.VERCEL_TOKEN,
        teamId: process.env.VERCEL_ORG_ID,
      }),
    });
    process.stdout.write("Protected alias mappings remain unchanged\n");
  } else if (command === "final") {
    assertFinalJobResults(JSON.parse(process.env.JOB_RESULTS_JSON ?? "{}"));
    process.stdout.write("All production-shadow jobs succeeded\n");
  } else if (command === "emit-output") {
    const value = JSON.stringify(readJson(options.input, "Canonical output"));
    appendOutput(options.name, value);
    process.stdout.write("Canonical GitHub output written\n");
  } else if (command === "cache-summary") {
    const cache = parseTurboCacheSummary(
      readFileSync(resolve(options.input), "utf8"),
    );
    appendOutput("turbo_cache_hits", String(cache.hits));
    appendOutput("turbo_cache_misses", String(cache.misses));
    process.stdout.write("Canonical Turbo cache summary verified\n");
  } else if (command === "summary") {
    writePilotSummary({
      path: process.env.GITHUB_STEP_SUMMARY,
      baseline: JSON.parse(process.env.BASELINE_JSON ?? "[]"),
      sha: process.env.DEPLOY_SHA,
      runUrl: process.env.WORKFLOW_RUN_URL,
      workflowDurationMs: process.env.WORKFLOW_DURATION_MS,
      app: {
        nextDeploymentId: process.env.APP_NEXT_DEPLOYMENT_ID,
        buildDurationMs: process.env.APP_BUILD_DURATION_MS,
        totalDurationMs: process.env.APP_TOTAL_DURATION_MS,
        cacheHits: process.env.APP_TURBO_CACHE_HITS,
        cacheMisses: process.env.APP_TURBO_CACHE_MISSES,
      },
      governance: {
        id: process.env.GOVERNANCE_DEPLOYMENT_ID,
        url: process.env.GOVERNANCE_DEPLOYMENT_URL,
        buildDurationMs: process.env.GOVERNANCE_BUILD_DURATION_MS,
        deployDurationMs: process.env.GOVERNANCE_DEPLOY_DURATION_MS,
        totalDurationMs: process.env.GOVERNANCE_TOTAL_DURATION_MS,
        cacheHits: process.env.GOVERNANCE_TURBO_CACHE_HITS,
        cacheMisses: process.env.GOVERNANCE_TURBO_CACHE_MISSES,
      },
      reserve: {
        id: process.env.RESERVE_DEPLOYMENT_ID,
        url: process.env.RESERVE_DEPLOYMENT_URL,
        buildDurationMs: process.env.RESERVE_BUILD_DURATION_MS,
        deployDurationMs: process.env.RESERVE_DEPLOY_DURATION_MS,
        totalDurationMs: process.env.RESERVE_TOTAL_DURATION_MS,
        cacheHits: process.env.RESERVE_TURBO_CACHE_HITS,
        cacheMisses: process.env.RESERVE_TURBO_CACHE_MISSES,
      },
      ui: {
        id: process.env.UI_DEPLOYMENT_ID,
        url: process.env.UI_DEPLOYMENT_URL,
        buildDurationMs: process.env.UI_BUILD_DURATION_MS,
        deployDurationMs: process.env.UI_DEPLOY_DURATION_MS,
        totalDurationMs: process.env.UI_TOTAL_DURATION_MS,
        cacheHits: process.env.UI_TURBO_CACHE_HITS,
        cacheMisses: process.env.UI_TURBO_CACHE_MISSES,
      },
    });
    process.stdout.write("Production-shadow pilot summary written\n");
  } else if (command === "health") {
    const urls = options.spec
      ? readJson(options.spec, "Protected alias specification").map(
          (entry) => entry.alias,
        )
      : options.url
        ? [options.url]
        : JSON.parse(process.env.HEALTH_URLS_JSON ?? "[]");
    await waitForHealthyUrls({
      urls,
    });
    process.stdout.write("Protected host health checks passed\n");
  } else {
    throw new Error(
      "Usage: vercel-production-shadow.mjs validate-context|validate-source|create-spec|prepare-link|prepare-pull-staging|pull|materialize-source|validate-pull-staging|stage-pull|validate-candidate-pull|validate-pull|check-build-inputs|build|create-handoff|assert-output|deploy|app-proof|assert-unaliased|evidence|check-aliases|final|emit-output|cache-summary|summary|health",
    );
  }
}
