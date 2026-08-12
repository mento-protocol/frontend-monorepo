#!/usr/bin/env node

import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  closeSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  assertMainTransactionJournal,
  assertMainTransactionJournalHistory,
  mainTransactionJournalArtifactName,
} from "./vercel-main-transaction.mjs";
import {
  PREVIEW_JOURNAL_MARKER,
  PREVIEW_JOURNAL_SCHEMA,
  PREVIEW_OBSERVATION_RECEIPT_SCHEMA,
  PREVIEW_REPOSITORY,
  controllerEventRunName,
  createPreviewJournal,
  parseWorkerRunName,
  renderPreviewJournalBody,
  validateEventReceipt,
  validatePreviewObservationReceipt,
  previewObservationArtifactName,
  selectPreviewObservationArtifact,
  isSupportedControllerSyntheticPreviewResult,
} from "./vercel-preview-controller.mjs";

export const OBSERVATION_REPOSITORY = PREVIEW_REPOSITORY;
export const OBSERVATION_RELATIVE_ROOT =
  ".vercel-cost-evidence/github-observation-v2";
export const OBSERVATION_INTERVAL_SCHEMA =
  "vercel-cost-github-observation-interval:v2";
const OBSERVATION_INTERVAL_EXTENSION_SCHEMA =
  "vercel-cost-github-observation-interval-extension:v2";
export const PREVIEW_CAPTURE_SCHEMA =
  "vercel-cost-preview-observation-capture:v2";
export const MAIN_CAPTURE_SCHEMA = "vercel-cost-main-observation-capture:v2";
export const GITHUB_SAMPLE_SCHEMA = "vercel-cost-github-sample:v2";
export const OBSERVATION_AUDIT_SCHEMA = "vercel-cost-observation-audit:v2";
export const ANALYZER_FRAGMENT_SCHEMA =
  "vercel-cost-analyzer-postcutover-fragment:v3";
const CAPTURE_SEAL_SCHEMA = "vercel-cost-capture-seal:v2";
const START_BOUNDARY_RUN_COVERAGE_SCHEMA =
  "vercel-cost-start-boundary-run-coverage:v1";
const OBSERVATION_FREEZE_SCHEMA = "vercel-cost-observation-freeze:v2";
const GITHUB_HOST = "github.com";
const GITHUB_REPOSITORY = `${GITHUB_HOST}/${OBSERVATION_REPOSITORY}`;

const PREVIEW_WORKFLOW_PATHS = new Set([
  ".github/workflows/vercel-preview-controller.yml",
  ".github/workflows/vercel-preview-intake.yml",
  ".github/workflows/vercel-preview-worker.yml",
]);
const MAIN_WORKFLOW_PATH = ".github/workflows/vercel-main-deployment.yml";
const OBSERVED_WORKFLOW_PATHS = new Set([
  ...PREVIEW_WORKFLOW_PATHS,
  MAIN_WORKFLOW_PATH,
]);
const BOUNDARY_WORKFLOW_PATHS = new Set([
  ...OBSERVED_WORKFLOW_PATHS,
  ".github/workflows/_vercel-prebuilt.yml",
  ".github/workflows/_vercel-preview-smoke.yml",
]);
const TERMINAL_RUN_CONCLUSIONS = new Set([
  "success",
  "failure",
  "cancelled",
  "skipped",
  "timed_out",
  "action_required",
  "neutral",
  "stale",
  "startup_failure",
]);
const STANDARD_RUNNER_LABELS = new Set([
  "ubuntu-latest",
  "ubuntu-24.04",
  "ubuntu-22.04",
  "ubuntu-20.04",
  "windows-latest",
  "windows-2025",
  "windows-2022",
  "windows-2019",
  "macos-latest",
  "macos-15",
  "macos-14",
  "macos-13",
]);
const SHA_PATTERN = /^[a-f0-9]{40}$/;
const POSITIVE_ID_PATTERN = /^[1-9][0-9]*$/;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const JOURNAL_ARTIFACT_PATTERN =
  /^vercel-main-journal-main-[a-f0-9]{32}-[0-9]{6}$/;
const MAX_GH_OUTPUT_BYTES = 64 * 1024 * 1024;

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

function positiveId(value, label) {
  const text = String(value);
  invariant(POSITIVE_ID_PATTERN.test(text), `${label} must be a positive ID`);
  return text;
}

function exactSha(value, label) {
  invariant(
    typeof value === "string" && SHA_PATTERN.test(value),
    `${label} must be a lowercase 40-character SHA`,
  );
  return value;
}

function exactUtc(value, label) {
  invariant(typeof value === "string", `${label} must be an ISO UTC timestamp`);
  const milliseconds = Date.parse(value);
  invariant(Number.isFinite(milliseconds), `${label} is not a timestamp`);
  const canonical = new Date(milliseconds).toISOString();
  invariant(canonical === value, `${label} must be canonical ISO UTC`);
  return canonical;
}

function githubUtc(value, label) {
  invariant(typeof value === "string", `${label} must be an ISO UTC timestamp`);
  invariant(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value),
    `${label} must be a canonical GitHub ISO UTC timestamp`,
  );
  const milliseconds = Date.parse(value);
  invariant(Number.isFinite(milliseconds), `${label} is not a timestamp`);
  const canonical = new Date(milliseconds).toISOString();
  invariant(
    canonical === value || canonical.replace(/\.000Z$/, "Z") === value,
    `${label} must be a canonical GitHub ISO UTC timestamp`,
  );
  return canonical;
}

function utcBoundary(value, label) {
  const canonical = exactUtc(value, label);
  invariant(
    canonical.endsWith("T00:00:00.000Z"),
    `${label} must be a complete UTC-day boundary`,
  );
  return canonical;
}

function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function isWithin(parent, child, { allowEqual = false } = {}) {
  const path = relative(parent, child);
  return (
    (allowEqual && path === "") ||
    (path !== "" && path !== ".." && !path.startsWith(`..${sep}`))
  );
}

function modeOf(path) {
  return lstatSync(path).mode & 0o777;
}

function assertPrivateDirectory(path, root, label) {
  const stats = lstatSync(path);
  invariant(
    stats.isDirectory() && !stats.isSymbolicLink(),
    `${label} must be a real directory`,
  );
  const canonical = realpathSync(path);
  invariant(
    canonical === resolve(path) &&
      isWithin(root, canonical, { allowEqual: canonical === root }),
    `${label} escapes the private observation root`,
  );
  invariant(modeOf(path) === 0o700, `${label} must use mode 0700`);
  return canonical;
}

function ensureDirectory(path, root) {
  const absolute = resolve(path);
  invariant(
    isWithin(root, absolute, { allowEqual: absolute === root }),
    "Observation directory escapes the private root",
  );
  if (existsSync(absolute)) {
    assertPrivateDirectory(absolute, root, "Observation directory");
    return absolute;
  }
  const parent = dirname(absolute);
  if (parent !== absolute) ensureDirectory(parent, root);
  mkdirSync(absolute, { mode: 0o700 });
  chmodSync(absolute, 0o700);
  fsyncDirectory(absolute);
  fsyncDirectory(parent);
  return assertPrivateDirectory(absolute, root, "Observation directory");
}

function observationPaths(cwd) {
  const workspace = realpathSync(resolve(cwd));
  const lexicalEvidenceRoot = join(workspace, ".vercel-cost-evidence");
  if (!existsSync(lexicalEvidenceRoot)) {
    mkdirSync(lexicalEvidenceRoot, { mode: 0o700 });
    chmodSync(lexicalEvidenceRoot, 0o700);
    fsyncDirectory(lexicalEvidenceRoot);
    fsyncDirectory(workspace);
  }
  const evidenceRoot = assertPrivateDirectory(
    lexicalEvidenceRoot,
    workspace,
    "Private evidence directory",
  );
  const root = join(evidenceRoot, "github-observation-v2");
  if (!existsSync(root)) {
    mkdirSync(root, { mode: 0o700 });
    chmodSync(root, 0o700);
    fsyncDirectory(root);
    fsyncDirectory(evidenceRoot);
  }
  assertPrivateDirectory(root, evidenceRoot, "GitHub observation directory");
  return { workspace, evidenceRoot, root };
}

function assertPrivateFile(path, root, label) {
  const stats = lstatSync(path);
  invariant(
    stats.isFile() && !stats.isSymbolicLink() && stats.nlink === 1,
    `${label} must be a single-link regular file`,
  );
  invariant(modeOf(path) === 0o600, `${label} must use mode 0600`);
  const canonical = realpathSync(path);
  invariant(
    canonical === resolve(path) && isWithin(root, canonical),
    `${label} escapes the private observation root`,
  );
  return stats;
}

function writePrivateFile(path, bytes, root) {
  const directory = ensureDirectory(dirname(path), root);
  assertPrivateDirectory(directory, root, "Observation file parent");
  recoverAtomicPublication(path, root);
  const temporaryPath = join(
    directory,
    `${atomicTemporaryPrefix(path)}${process.pid}-${randomBytes(6).toString("hex")}.tmp`,
  );
  const descriptor = openSync(temporaryPath, "wx", 0o600);
  try {
    writeFileSync(descriptor, bytes);
    chmodSync(temporaryPath, 0o600);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  try {
    linkSync(temporaryPath, path);
    unlinkSync(temporaryPath);
    fsyncDirectory(directory);
  } catch (error) {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
    throw error;
  }
  assertPrivateFile(path, root, "Observation file");
}

function atomicTemporaryPrefix(path) {
  return `.atomic-write-${encodeURIComponent(basename(path))}--`;
}

function fsyncDirectory(directory) {
  const descriptor = openSync(directory, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function recoverAtomicPublication(path, root) {
  const directory = dirname(path);
  if (!existsSync(directory)) return;
  assertPrivateDirectory(directory, root, "Atomic publication directory");
  const prefix = atomicTemporaryPrefix(path);
  let changed = false;
  for (const name of readdirSync(directory)) {
    if (!name.startsWith(prefix) || !name.endsWith(".tmp")) continue;
    const temporaryPath = join(directory, name);
    const stats = lstatSync(temporaryPath);
    invariant(
      stats.isFile() && !stats.isSymbolicLink(),
      "Atomic publication staging entry is unsafe",
    );
    unlinkSync(temporaryPath);
    changed = true;
  }
  if (changed) fsyncDirectory(directory);
}

function recoverAtomicDirectory(directory, root) {
  if (!existsSync(directory)) return;
  assertPrivateDirectory(directory, root, "Atomic publication directory");
  for (const name of readdirSync(directory)) {
    const match = /^\.atomic-write-(.+)--[1-9][0-9]*-[a-f0-9]{12}\.tmp$/.exec(
      name,
    );
    if (!match) continue;
    let finalName;
    try {
      finalName = decodeURIComponent(match[1]);
    } catch {
      throw new Error("Atomic publication staging name is malformed");
    }
    invariant(
      basename(finalName) === finalName,
      "Atomic publication staging name escapes its directory",
    );
    recoverAtomicPublication(join(directory, finalName), root);
  }
}

function writePrivateJson(path, value, root) {
  writePrivateFile(path, canonicalJson(value), root);
}

function readPrivateJson(path, root, label) {
  recoverAtomicPublication(path, root);
  assertPrivateFile(path, root, label);
  let value;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
  return value;
}

function listPrivateFiles(directory, root, prefix = "") {
  assertPrivateDirectory(directory, root, "Observation manifest directory");
  recoverAtomicDirectory(directory, root);
  const records = [];
  for (const name of readdirSync(directory).sort()) {
    const path = join(directory, name);
    const relativePath = prefix ? `${prefix}/${name}` : name;
    const stats = lstatSync(path);
    invariant(!stats.isSymbolicLink(), "Observation manifest rejects symlinks");
    if (stats.isDirectory()) {
      records.push(...listPrivateFiles(path, root, relativePath));
      continue;
    }
    assertPrivateFile(path, root, "Observation manifest file");
    const bytes = readFileSync(path);
    records.push({
      path: relativePath,
      sha256: sha256(bytes),
      bytes: bytes.length,
    });
  }
  return records;
}

function verifyCaptureDirectory(directory, root, schema, identity) {
  assertPrivateDirectory(directory, root, "Existing capture directory");
  const capturePath = join(directory, "capture.json");
  const sealPath = join(directory, "seal.json");
  const capture = readPrivateJson(capturePath, root, "Existing capture");
  const seal = readPrivateJson(sealPath, root, "Existing capture seal");
  invariant(capture.schema === schema, "Existing capture schema conflicts");
  for (const [key, value] of Object.entries(identity)) {
    invariant(
      String(capture[key]) === String(value),
      `Existing capture ${key} conflicts`,
    );
  }
  invariant(
    Array.isArray(capture.files),
    "Existing capture manifest is absent",
  );
  invariant(
    seal.schema === CAPTURE_SEAL_SCHEMA &&
      seal.captureSchema === schema &&
      DIGEST_PATTERN.test(seal.captureSha256) &&
      DIGEST_PATTERN.test(seal.treeSha256) &&
      Array.isArray(seal.payloadFiles),
    "Existing capture seal is malformed",
  );
  const captureBytes = readFileSync(capturePath);
  invariant(
    captureBytes.equals(Buffer.from(canonicalJson(capture))) &&
      sha256(captureBytes) === seal.captureSha256,
    "Existing capture seal does not match capture.json",
  );
  invariant(
    JSON.stringify(seal.payloadFiles) === JSON.stringify(capture.files),
    "Existing capture seal payload manifest conflicts",
  );
  const expectedTreeSha256 = sha256(
    canonicalJson({
      captureSha256: seal.captureSha256,
      payloadFiles: seal.payloadFiles,
    }),
  );
  invariant(
    seal.treeSha256 === expectedTreeSha256,
    "Existing capture tree seal conflicts",
  );
  const actualPayloadFiles = listPrivateFiles(directory, root).filter(
    (record) => record.path !== "capture.json" && record.path !== "seal.json",
  );
  invariant(
    JSON.stringify(actualPayloadFiles) === JSON.stringify(capture.files),
    "Existing capture tree has extra, missing, or unlisted files",
  );
  for (const record of capture.files) {
    plainObject(record, "Existing capture file");
    invariant(
      typeof record.path === "string" &&
        DIGEST_PATTERN.test(record.sha256) &&
        Number.isSafeInteger(record.bytes) &&
        record.bytes >= 0,
      "Existing capture file manifest is malformed",
    );
    const path = resolve(directory, record.path);
    invariant(isWithin(directory, path), "Existing capture path escapes");
    assertPrivateFile(path, root, "Existing capture file");
    const bytes = readFileSync(path);
    invariant(
      bytes.length === record.bytes && sha256(bytes) === record.sha256,
      `Existing capture file conflicts: ${record.path}`,
    );
  }
  return capture;
}

function stageCapture(root, prefix, build) {
  recoverStaleCaptureStages(root);
  const stage = join(
    root,
    `.stage-${prefix}-${process.pid}-${randomBytes(6).toString("hex")}`,
  );
  ensureDirectory(stage, root);
  try {
    const result = build(stage);
    invariant(
      !existsSync(stage),
      "Capture staging directory was not published or removed",
    );
    return result;
  } catch (error) {
    if (existsSync(stage)) {
      removeCaptureStage(stage, root);
      fsyncDirectory(root);
    }
    throw error;
  }
}

function removeCaptureStage(stage, root) {
  assertPrivateDirectory(stage, root, "Capture staging directory");
  const rootDevice = lstatSync(root).dev;
  const removeEntry = (path) => {
    const stats = lstatSync(path);
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      unlinkSync(path);
      return;
    }
    const canonical = realpathSync(path);
    invariant(
      canonical === resolve(path) && isWithin(root, canonical),
      "Capture staging entry escapes the private observation root",
    );
    invariant(
      stats.dev === rootDevice,
      "Capture staging directory crosses a filesystem boundary",
    );
    for (const name of readdirSync(path)) removeEntry(join(path, name));
    rmdirSync(path);
  };
  removeEntry(stage);
}

function assertSafeRemovableStageTree(path, root) {
  const stats = lstatSync(path);
  invariant(!stats.isSymbolicLink(), "Capture staging tree rejects symlinks");
  const canonical = realpathSync(path);
  invariant(
    canonical === resolve(path) && isWithin(root, canonical),
    "Capture staging entry escapes the private observation root",
  );
  if (stats.isDirectory()) {
    if (modeOf(path) === 0o700) recoverAtomicDirectory(path, root);
    for (const name of readdirSync(path)) {
      assertSafeRemovableStageTree(join(path, name), root);
    }
    return;
  }
  invariant(stats.isFile(), "Capture staging entry is not removable");
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    if (error?.code === "EPERM") return true;
    throw error;
  }
}

function recoverStaleCaptureStages(root) {
  assertPrivateDirectory(root, dirname(root), "Observation root");
  let changed = false;
  for (const name of readdirSync(root)) {
    if (!name.startsWith(".stage-")) continue;
    const match = /^\.stage-[A-Za-z0-9.-]+-([1-9][0-9]*)-[a-f0-9]{12}$/.exec(
      name,
    );
    invariant(match, "Capture staging directory name is malformed");
    const stage = join(root, name);
    removeCaptureStage(stage, root);
    changed = true;
  }
  if (changed) fsyncDirectory(root);
}

function recoverOperationLock(root) {
  const lockDirectory = join(root, ".operation-lock");
  if (!existsSync(lockDirectory)) return;
  assertPrivateDirectory(lockDirectory, root, "Observation operation lock");
  const ownerPath = join(lockDirectory, "owner.json");
  const lockAgeMilliseconds = Date.now() - lstatSync(lockDirectory).mtimeMs;
  if (!existsSync(ownerPath)) {
    const entries = readdirSync(lockDirectory);
    invariant(
      entries.length === 0,
      "Observation operation lock has no owner but contains unexpected state",
    );
    if (lockAgeMilliseconds >= 5_000) {
      rmSync(lockDirectory, { recursive: true, force: true });
      fsyncDirectory(root);
      return;
    }
    throw new Error(
      "Observation operation lock is initializing; retry after the active process exits",
    );
  }
  assertPrivateFile(ownerPath, root, "Observation operation lock owner");
  let owner;
  try {
    owner = JSON.parse(readFileSync(ownerPath, "utf8"));
  } catch {
    if (lockAgeMilliseconds >= 5_000) {
      assertSafeRemovableStageTree(lockDirectory, root);
      rmSync(lockDirectory, { recursive: true, force: true });
      fsyncDirectory(root);
      return;
    }
    throw new Error("Observation operation lock owner is initializing; retry");
  }
  const ownerValid =
    owner.schema === "vercel-cost-observation-operation-lock:v2" &&
    Number.isSafeInteger(owner.pid) &&
    owner.pid > 0 &&
    typeof owner.nonce === "string" &&
    /^[a-f0-9]{24}$/.test(owner.nonce);
  if (!ownerValid) {
    if (lockAgeMilliseconds >= 5_000) {
      assertSafeRemovableStageTree(lockDirectory, root);
      rmSync(lockDirectory, { recursive: true, force: true });
      fsyncDirectory(root);
      return;
    }
    throw new Error("Observation operation lock owner is malformed");
  }
  if (processIsAlive(owner.pid)) {
    throw new Error(
      `Observation operation is already active in process ${owner.pid}`,
    );
  }
  assertSafeRemovableStageTree(lockDirectory, root);
  rmSync(lockDirectory, { recursive: true, force: true });
  fsyncDirectory(root);
}

function acquireOperationLock(root, command) {
  recoverOperationLock(root);
  const lockDirectory = join(root, ".operation-lock");
  try {
    mkdirSync(lockDirectory, { mode: 0o700 });
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error("Observation operation lock was acquired concurrently");
    }
    throw error;
  }
  chmodSync(lockDirectory, 0o700);
  fsyncDirectory(lockDirectory);
  fsyncDirectory(root);
  const nonce = randomBytes(12).toString("hex");
  const ownerPath = join(lockDirectory, "owner.json");
  const ownerDescriptor = openSync(ownerPath, "wx", 0o600);
  try {
    writeFileSync(
      ownerDescriptor,
      canonicalJson({
        schema: "vercel-cost-observation-operation-lock:v2",
        pid: process.pid,
        nonce,
        command,
      }),
    );
    chmodSync(ownerPath, 0o600);
    fsyncSync(ownerDescriptor);
  } finally {
    closeSync(ownerDescriptor);
  }
  fsyncDirectory(lockDirectory);
  return () => {
    const owner = readPrivateJson(
      join(lockDirectory, "owner.json"),
      root,
      "Observation operation lock owner",
    );
    invariant(
      owner.pid === process.pid && owner.nonce === nonce,
      "Observation operation lock ownership changed",
    );
    assertSafeRemovableStageTree(lockDirectory, root);
    rmSync(lockDirectory, { recursive: true, force: true });
    fsyncDirectory(root);
  };
}

function assertObservationMutable(root) {
  invariant(
    !existsSync(join(root, "freeze.json")) &&
      !existsSync(join(root, "audit.json")),
    "Observation is frozen; no further collection or interval changes are allowed",
  );
}

function freezeObservation(root, interval, endUtcExclusive, frozenAtUtc) {
  const freezePath = join(root, "freeze.json");
  const freeze = {
    schema: OBSERVATION_FREEZE_SCHEMA,
    repository: OBSERVATION_REPOSITORY,
    startUtc: interval.startUtc,
    endUtcExclusive,
    intervalChainHeadSha256: interval.extensionChainHeadSha256,
    frozenAtUtc,
  };
  if (existsSync(freezePath)) {
    const existing = readPrivateJson(
      freezePath,
      root,
      "Observation freeze marker",
    );
    invariant(
      existing.schema === freeze.schema &&
        existing.repository === freeze.repository &&
        existing.startUtc === freeze.startUtc &&
        existing.endUtcExclusive === freeze.endUtcExclusive &&
        existing.intervalChainHeadSha256 === freeze.intervalChainHeadSha256,
      "Observation freeze marker conflicts with the requested audit",
    );
    return existing;
  }
  writePrivateJson(freezePath, freeze, root);
  return freeze;
}

function publishCapture({ root, stage, destination, capture }) {
  capture.files = listPrivateFiles(stage, root);
  sealCaptureDirectory(stage, capture, root);
  invariant(
    !existsSync(destination),
    "Capture destination appeared concurrently",
  );
  ensureDirectory(dirname(destination), root);
  renameSync(stage, destination);
  fsyncDirectory(dirname(destination));
  if (dirname(stage) !== dirname(destination)) fsyncDirectory(dirname(stage));
  assertPrivateDirectory(destination, root, "Published capture directory");
  return capture;
}

function sealCaptureDirectory(directory, capture, root) {
  const captureBytes = Buffer.from(canonicalJson(capture));
  writePrivateFile(join(directory, "capture.json"), captureBytes, root);
  const captureSha256 = sha256(captureBytes);
  writePrivateJson(
    join(directory, "seal.json"),
    {
      schema: CAPTURE_SEAL_SCHEMA,
      captureSchema: capture.schema,
      captureSha256,
      payloadFiles: capture.files,
      treeSha256: sha256(
        canonicalJson({
          captureSha256,
          payloadFiles: capture.files,
        }),
      ),
    },
    root,
  );
}

function sanitizeGhError(stderr) {
  const text = String(stderr ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);
  return text ? text.slice(0, 300) : "gh command failed";
}

export function defaultGh(args, { cwd = process.cwd() } = {}) {
  invariant(
    Array.isArray(args) && args.length > 0,
    "gh arguments are required",
  );
  invariant(
    !args.some((argument) => /token|authorization/i.test(String(argument))),
    "The observation collector does not accept credential arguments",
  );
  const result = spawnSync("gh", args, {
    cwd,
    encoding: null,
    env: environmentWithoutGhTokens(process.env),
    maxBuffer: MAX_GH_OUTPUT_BYTES,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error)
    throw new Error(`gh execution failed: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`gh request failed: ${sanitizeGhError(result.stderr)}`);
  }
  return Buffer.from(result.stdout ?? []);
}

export function environmentWithoutGhTokens(environment) {
  const sanitized = {};
  for (const key of [
    "PATH",
    "HOME",
    "XDG_CONFIG_HOME",
    "GH_CONFIG_DIR",
    "TMPDIR",
    "TMP",
    "TEMP",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
  ]) {
    const value = environment[key];
    if (typeof value === "string" && value.length > 0) sanitized[key] = value;
  }
  return sanitized;
}

function ghBytes(dependencies, args) {
  const value = dependencies.gh(args, { cwd: dependencies.cwd });
  return Buffer.isBuffer(value) ? value : Buffer.from(String(value ?? ""));
}

function ghJson(dependencies, args, label) {
  const bytes = ghBytes(dependencies, args);
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`${label} did not return valid JSON`);
  }
  return value;
}

function apiJson(dependencies, endpoint, label, { paginate = false } = {}) {
  const args = ["api", "--hostname", GITHUB_HOST, "--method", "GET"];
  if (paginate) args.push("--paginate", "--slurp");
  args.push(endpoint);
  return ghJson(dependencies, args, label);
}

function paginatedCollection(value, key, label) {
  invariant(Array.isArray(value), `${label} pagination is malformed`);
  const pages = value.length === 0 ? [] : value;
  if (pages.every(Array.isArray)) return pages.flat();
  return pages.flatMap((page) => {
    const object = plainObject(page, `${label} page`);
    invariant(Array.isArray(object[key]), `${label} page is malformed`);
    return object[key];
  });
}

function authenticateGh(dependencies) {
  ghBytes(dependencies, ["auth", "status", "--hostname", GITHUB_HOST]);
}

function workflowPath(run) {
  return String(run?.path ?? "").split("@")[0];
}

function terminalRun(run, expectedPath, label) {
  plainObject(run, label);
  positiveId(run.id, `${label} ID`);
  invariant(
    workflowPath(run) === expectedPath,
    `${label} workflow is unexpected`,
  );
  invariant(run.status === "completed", `${label} is not complete`);
  invariant(
    TERMINAL_RUN_CONCLUSIONS.has(run.conclusion),
    `${label} conclusion is not terminal`,
  );
  const createdAtUtc = githubUtc(run.created_at, `${label} creation time`);
  const updatedAtUtc = githubUtc(run.updated_at, `${label} update time`);
  positiveId(run.run_attempt, `${label} attempt`);
  return {
    ...run,
    created_at: createdAtUtc,
    updated_at: updatedAtUtc,
  };
}

function withinInterval(timestamp, interval) {
  const value = Date.parse(exactUtc(timestamp, "Observed event timestamp"));
  return (
    value >= Date.parse(interval.startUtc) &&
    value < Date.parse(interval.endUtcExclusive)
  );
}

function readInterval(root) {
  const intervalPath = join(root, "interval.json");
  const interval = readPrivateJson(intervalPath, root, "Observation interval");
  plainObject(interval, "Observation interval");
  invariant(
    interval.schema === OBSERVATION_INTERVAL_SCHEMA &&
      interval.repository === OBSERVATION_REPOSITORY &&
      DIGEST_PATTERN.test(interval.boundarySha256),
    "Observation interval identity is unsupported",
  );
  const intervalBytes = readFileSync(intervalPath);
  invariant(
    intervalBytes.equals(Buffer.from(canonicalJson(interval))),
    "Observation interval is not canonical JSON",
  );
  const boundaryPath = join(root, "boundary", "start.json");
  recoverAtomicPublication(boundaryPath, root);
  assertPrivateFile(boundaryPath, root, "Observation start boundary");
  const boundaryBytes = readFileSync(boundaryPath);
  let boundary;
  try {
    boundary = JSON.parse(boundaryBytes.toString("utf8"));
  } catch {
    throw new Error("Observation start boundary is not valid JSON");
  }
  invariant(
    boundaryBytes.equals(Buffer.from(canonicalJson(boundary))) &&
      sha256(boundaryBytes) === interval.boundarySha256,
    "Observation start boundary conflicts with its interval digest",
  );
  invariant(
    boundary.schema === "vercel-cost-observation-boundary:v2" &&
      boundary.repository === OBSERVATION_REPOSITORY &&
      boundary.timestampUtc === interval.startUtc &&
      boundary.endUtcExclusive === interval.endUtcExclusive,
    "Observation interval boundaries conflict with its start boundary",
  );
  utcBoundary(interval.startUtc, "Observation start");
  utcBoundary(interval.endUtcExclusive, "Observation end");
  invariant(
    Date.parse(interval.endUtcExclusive) - Date.parse(interval.startUtc) >=
      7 * 24 * 60 * 60 * 1000,
    "Observation interval is shorter than seven complete UTC days",
  );
  const extensionRoot = join(root, "interval-extensions");
  let effectiveEndUtcExclusive = interval.endUtcExclusive;
  let extensionChainHeadSha256 = sha256(intervalBytes);
  const extensionRecords = [];
  if (existsSync(extensionRoot)) {
    assertPrivateDirectory(
      extensionRoot,
      root,
      "Observation interval extensions",
    );
    recoverAtomicDirectory(extensionRoot, root);
    for (const name of readdirSync(extensionRoot).sort()) {
      const path = join(extensionRoot, name);
      invariant(
        lstatSync(path).isFile() && /^.+\.json$/.test(name),
        "Observation interval extension entry is malformed",
      );
      const record = readPrivateJson(
        path,
        root,
        "Observation interval extension",
      );
      invariant(
        record.schema === OBSERVATION_INTERVAL_EXTENSION_SCHEMA &&
          record.repository === OBSERVATION_REPOSITORY &&
          record.startUtc === interval.startUtc &&
          DIGEST_PATTERN.test(record.previousRecordSha256),
        "Observation interval extension identity conflicts",
      );
      utcBoundary(record.previousEndUtcExclusive, "Extension previous end");
      utcBoundary(record.endUtcExclusive, "Extension end");
      exactUtc(record.createdAtUtc, "Extension creation time");
      invariant(
        name === `${record.endUtcExclusive.replaceAll(":", "-")}.json`,
        "Observation interval extension filename conflicts with its end",
      );
      const bytes = readFileSync(path);
      invariant(
        bytes.equals(Buffer.from(canonicalJson(record))),
        "Observation interval extension is not canonical JSON",
      );
      extensionRecords.push({ record, sha256: sha256(bytes) });
    }
    extensionRecords.sort(
      (left, right) =>
        Date.parse(left.record.endUtcExclusive) -
        Date.parse(right.record.endUtcExclusive),
    );
    for (const { record, sha256: recordSha256 } of extensionRecords) {
      invariant(
        record.previousEndUtcExclusive === effectiveEndUtcExclusive &&
          record.previousRecordSha256 === extensionChainHeadSha256 &&
          Date.parse(record.endUtcExclusive) >
            Date.parse(effectiveEndUtcExclusive),
        "Observation interval extensions are not a monotonic chain",
      );
      effectiveEndUtcExclusive = record.endUtcExclusive;
      extensionChainHeadSha256 = recordSha256;
    }
  }
  return {
    ...interval,
    initialEndUtcExclusive: interval.endUtcExclusive,
    endUtcExclusive: effectiveEndUtcExclusive,
    extensionCount: extensionRecords.length,
    extensionChainHeadSha256,
  };
}

function parsePreviewJournalComment(comment, pr) {
  plainObject(comment, "Preview journal comment");
  invariant(
    comment.user?.type === "Bot" &&
      comment.user?.login === "github-actions[bot]",
    "Preview journal owner is not the GitHub Actions bot",
  );
  invariant(
    typeof comment.body === "string" &&
      comment.body.startsWith(PREVIEW_JOURNAL_MARKER),
    "Preview journal marker is absent",
  );
  const match = comment.body.match(
    /\n<details>\n<summary>Show machine-readable preview automation record<\/summary>\n\n```json\n([\s\S]+)\n```\n\n<\/details>\n$/,
  );
  invariant(match, "Preview journal JSON block is malformed");
  let parsed;
  try {
    parsed = JSON.parse(match[1]);
  } catch {
    throw new Error("Preview journal JSON is malformed");
  }
  invariant(
    parsed.schema === PREVIEW_JOURNAL_SCHEMA &&
      parsed.repository === OBSERVATION_REPOSITORY &&
      parsed.pr === Number(pr),
    "Preview journal identity is unsupported",
  );
  const canonical = createPreviewJournal({
    pr: parsed.pr,
    revision: parsed.revision,
    checkpoint: parsed.checkpoint,
    events: parsed.receipts?.events,
    selections: parsed.receipts?.selections,
    workerEvidence: parsed.receipts?.worker_evidence,
    results: parsed.receipts?.results,
    state: parsed.state,
    ...(Object.hasOwn(parsed, "admission")
      ? { admission: parsed.admission }
      : {}),
  });
  const canonicalCandidates = [canonical];
  if (Object.hasOwn(canonical, "admission")) {
    const { admission, ...withoutAdmission } = canonical;
    canonicalCandidates.push({ ...withoutAdmission, admission });
  }
  invariant(
    canonicalCandidates.some(
      (candidate) =>
        JSON.stringify(parsed) === JSON.stringify(candidate) &&
        comment.body === renderPreviewJournalBody(candidate),
    ),
    "Preview journal is not canonical",
  );
  return canonical;
}

function eventReceiptFromJournal(
  journal,
  eventRunId,
  { allowMissing = false } = {},
) {
  const candidates = journal.receipts.events.filter(
    (event) => String(event.event_run_id) === String(eventRunId),
  );
  invariant(candidates.length <= 1, "Preview event receipt is ambiguous");
  if (candidates.length === 0) {
    invariant(
      allowMissing,
      "Preview event must remain in the live journal receipts",
    );
    return null;
  }
  return validateEventReceipt(candidates[0]);
}

function previewObservationArtifact(
  dependencies,
  controllerRunId,
  root,
  { required = true } = {},
) {
  const artifactName = previewObservationArtifactName(controllerRunId);
  const artifacts = paginatedCollection(
    apiJson(
      dependencies,
      `repos/${OBSERVATION_REPOSITORY}/actions/runs/${controllerRunId}/artifacts?per_page=100`,
      "Preview observation artifacts",
      { paginate: true },
    ),
    "artifacts",
    "Preview observation artifacts",
  );
  const artifact = selectPreviewObservationArtifact(artifacts, controllerRunId);
  if (artifact === null) {
    invariant(
      !required,
      "Preview observation receipt artifact is missing or ambiguous",
    );
    return null;
  }
  const directory = join(
    root,
    `.stage-observation-receipt-${controllerRunId}-${process.pid}-${randomBytes(6).toString("hex")}`,
  );
  invariant(!existsSync(directory), "Preview observation receipt stage exists");
  try {
    downloadArtifact(dependencies, controllerRunId, artifactName, directory);
    assertPrivateDirectory(
      directory,
      root,
      "Preview observation artifact directory",
    );
    const entries = readdirSync(directory);
    invariant(
      entries.length === 1 && entries[0] === "preview-observation-receipt.json",
      "Preview observation artifact contents are invalid",
    );
    const path = join(directory, entries[0]);
    const stats = lstatSync(path);
    invariant(
      stats.isFile() && !stats.isSymbolicLink() && stats.nlink === 1,
      "Preview observation receipt must be a regular file",
    );
    chmodSync(path, 0o600);
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      throw new Error("Preview observation receipt is not valid JSON");
    }
    invariant(
      parsed.schema === PREVIEW_OBSERVATION_RECEIPT_SCHEMA,
      "Preview observation receipt schema mismatch",
    );
    return {
      artifact,
      receipt: validatePreviewObservationReceipt(parsed),
    };
  } finally {
    if (existsSync(directory)) removeCaptureStage(directory, root);
  }
}

function eventSelections(journal, eventRunId) {
  return journal.receipts.selections.filter(
    (selection) =>
      String(selection.selection_receipt_run_id) === String(eventRunId) ||
      selection.coalesced_receipt_run_ids.some(
        (runId) => String(runId) === String(eventRunId),
      ),
  );
}

function statusDecisionForEvent(journal, event) {
  const candidates = (journal.state?.status_decisions ?? []).filter(
    (decision) => decision.sha === event.head_sha,
  );
  invariant(
    candidates.length <= 1,
    "Preview status decision is ambiguous for the event SHA",
  );
  return candidates[0] ?? null;
}

function writeRawJson(stage, relativePath, value, root) {
  writePrivateJson(join(stage, relativePath), value, root);
}

function writeRawText(stage, relativePath, value, root) {
  writePrivateFile(join(stage, relativePath), value, root);
}

function fetchAttempt(dependencies, runId, attempt, label) {
  return apiJson(
    dependencies,
    `repos/${OBSERVATION_REPOSITORY}/actions/runs/${runId}/attempts/${attempt}`,
    `${label} attempt`,
  );
}

function fetchAttemptJobs(dependencies, runId, attempt, label) {
  return paginatedCollection(
    apiJson(
      dependencies,
      `repos/${OBSERVATION_REPOSITORY}/actions/runs/${runId}/attempts/${attempt}/jobs?filter=all&per_page=100`,
      `${label} jobs`,
      { paginate: true },
    ),
    "jobs",
    `${label} jobs`,
  );
}

function fetchAttemptLogs(dependencies, runId, attempt) {
  return ghBytes(dependencies, [
    "run",
    "view",
    String(runId),
    "--repo",
    GITHUB_REPOSITORY,
    "--attempt",
    String(attempt),
    "--log",
  ]);
}

function relevantWorkerReferences(journal, selections) {
  const keys = new Set(selections.map((selection) => selection.key_digest));
  const evidence = journal.receipts.worker_evidence.filter((entry) =>
    keys.has(entry.key_digest),
  );
  const results = journal.receipts.results.filter((entry) =>
    keys.has(entry.key_digest),
  );
  const references = new Map();
  for (const entry of [...evidence, ...results]) {
    const key = String(entry.worker_run_id);
    const previous = references.get(key);
    const attempt = Number(entry.worker_run_attempt);
    invariant(
      !previous || previous.attempt === attempt,
      "Preview worker attempt evidence conflicts",
    );
    references.set(key, { runId: key, attempt });
  }
  return { evidence, results, references: [...references.values()] };
}

function latestSentinelStatus(statuses) {
  return (
    [...statuses]
      .filter((status) => status.context === "Vercel Preview")
      .sort(
        (left, right) =>
          Date.parse(right.updated_at ?? right.created_at) -
          Date.parse(left.updated_at ?? left.created_at),
      )[0] ?? null
  );
}

function deploymentCapture(deployments) {
  return deployments.map(({ deployment, statuses }) => ({
    deployment,
    statuses,
  }));
}

function preBoundaryEligiblePushEvidence(journal, boundaryHeadSha) {
  if (journal === null) return "unknown";
  const representedEvents = [
    ...journal.receipts.events,
    ...(journal.checkpoint ? [journal.checkpoint.event] : []),
  ];
  const hasEligibleEvent = representedEvents.some(
    (event) =>
      event.trust === "trusted" &&
      ["opened", "synchronize"].includes(event.event_action) &&
      event.plan.targets.length > 0,
  );
  const checkpointHasEligibleTarget =
    journal.checkpoint !== null &&
    Object.values(journal.checkpoint.targets).some(
      (target) => target.first_eligible_sha !== null,
    );
  if (hasEligibleEvent || checkpointHasEligibleTarget) return "present";
  const hasCompleteAnchor =
    journal.checkpoint !== null ||
    journal.receipts.events.some((event) =>
      ["opened", "reopened", "bootstrap"].includes(event.event_action),
    );
  const representsBoundaryHead = representedEvents.some(
    (event) => event.head_sha === boundaryHeadSha,
  );
  return hasCompleteAnchor && representsBoundaryHead ? "none" : "unknown";
}

function receiptMatchesSelection(receipt, selection) {
  return (
    receipt.pr === selection.pr &&
    receipt.target === selection.target &&
    receipt.sha === selection.sha &&
    (receipt.controller_key ?? receipt.key) === selection.key &&
    receipt.key_digest === selection.key_digest &&
    receipt.epoch_anchor_run_id === selection.epoch_anchor_run_id &&
    receipt.reconciliation_basis_digest ===
      selection.reconciliation_basis_digest &&
    receipt.selection_receipt_run_id === selection.selection_receipt_run_id &&
    receipt.expected_workflow_sha === selection.expected_workflow_sha
  );
}

function parsedDeploymentPayload(value) {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value;
  }
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return parsed !== null &&
      typeof parsed === "object" &&
      !Array.isArray(parsed)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function validatePreviewDeployment({
  deployment,
  statuses,
  selection,
  evidence,
  result,
}) {
  invariant(
    String(deployment.id) === String(result.github_deployment_id) &&
      String(evidence.github_deployment_id) ===
        String(result.github_deployment_id),
    "Preview worker receipts do not bind one GitHub Deployment",
  );
  const payload = parsedDeploymentPayload(deployment.payload);
  invariant(
    deployment.sha === selection.sha &&
      deployment.ref === selection.sha &&
      deployment.environment ===
        `preview/${selection.target}/pr-${selection.pr}` &&
      payload?.controller_schema === "mento-vercel-prebuilt/v2" &&
      payload.idempotency_key === selection.key &&
      payload.sha === selection.sha &&
      payload.logical_target === selection.target &&
      payload.pull_request_number === selection.pr &&
      payload.provenance === "preview-controller:v2",
    "GitHub Deployment does not match its preview selection",
  );
  const matchingStatuses = statuses.filter((status) => {
    const runIdMatch = String(status.log_url ?? "").match(
      /\/actions\/runs\/([1-9][0-9]*)(?:\/attempts\/([1-9][0-9]*))?(?:\/|$)/,
    );
    return (
      runIdMatch?.[1] === String(result.worker_run_id) &&
      (runIdMatch[2] === undefined ||
        Number(runIdMatch[2]) === Number(result.worker_run_attempt)) &&
      status.state === result.state &&
      (result.state !== "success" ||
        status.environment_url === result.vercel_deployment_url) &&
      status.creator?.type === "Bot" &&
      status.creator?.login === "github-actions[bot]"
    );
  });
  invariant(
    matchingStatuses.length === 1,
    "GitHub Deployment terminal status is missing or ambiguous",
  );
  return matchingStatuses[0];
}

function validateTerminalPreviewReceipts({
  journal,
  event,
  selections,
  worker,
  decision,
  sentinel,
  controllerRun,
  deploymentsWithStatuses,
}) {
  invariant(
    decision !== null &&
      ["success", "failure", "error"].includes(decision.state),
    "Preview evidence is not terminal; retry after controller reconciliation",
  );
  invariant(
    sentinel !== null &&
      sentinel.sha === event.head_sha &&
      sentinel.state === decision.state &&
      sentinel.target_url === decision.target_url &&
      sentinel.creator?.type === "Bot" &&
      sentinel.creator?.login === "github-actions[bot]",
    "Preview terminal status does not match the bot-owned controller decision",
  );
  const plannedTargets = [...event.plan.targets].sort();
  const selectedTargets = [
    ...new Set(selections.map((selection) => selection.target)),
  ].sort();
  invariant(
    JSON.stringify(selectedTargets) === JSON.stringify(plannedTargets),
    "Preview selection coverage does not match every planned target",
  );
  const currentSelections = [];
  for (const target of plannedTargets) {
    const targetSelections = selections.filter(
      (selection) => selection.target === target,
    );
    const targetState = journalTargetStateForValidation(
      journal,
      event,
      target,
      targetSelections,
      worker.results,
    );
    currentSelections.push(targetState);
  }
  if (plannedTargets.length === 0) {
    invariant(
      decision.target_url === controllerRun.html_url,
      "No-target preview decision must point to its controller run",
    );
  } else if (decision.state === "success") {
    invariant(
      worker.results.some(
        (result) =>
          result.state === "success" &&
          result.vercel_deployment_url === decision.target_url,
      ),
      "Successful preview decision URL lacks matching deployment evidence",
    );
  } else {
    invariant(
      worker.results.some(
        (result) =>
          decision.target_url ===
          `https://github.com/${OBSERVATION_REPOSITORY}/actions/runs/${result.worker_run_id}`,
      ),
      "Failed preview decision URL lacks matching worker evidence",
    );
  }
  const deploymentsById = new Map(
    deploymentsWithStatuses.map((item) => [String(item.deployment.id), item]),
  );
  const references = [];
  const validatedDeploymentStatuses = [];
  for (const selection of selections) {
    const evidence = worker.evidence.filter(
      (entry) => entry.key_digest === selection.key_digest,
    );
    const results = worker.results.filter(
      (entry) => entry.key_digest === selection.key_digest,
    );
    invariant(
      evidence.every((entry) => receiptMatchesSelection(entry, selection)) &&
        results.every((entry) => receiptMatchesSelection(entry, selection)) &&
        results.length > 0,
      "Preview selection receipts are incomplete or conflict; retry capture",
    );
    const evidenceByRunAttempt = new Map();
    for (const entry of evidence) {
      const key = `${entry.worker_run_id}:${entry.worker_run_attempt}`;
      invariant(
        !evidenceByRunAttempt.has(key),
        "Preview worker evidence is ambiguous",
      );
      evidenceByRunAttempt.set(key, entry);
    }
    const resultByRunAttempt = new Map();
    for (const entry of results) {
      const key = `${entry.worker_run_id}:${entry.worker_run_attempt}`;
      invariant(
        !resultByRunAttempt.has(key),
        "Preview worker result is ambiguous",
      );
      resultByRunAttempt.set(key, entry);
    }
    const syntheticResults = results.filter(
      (result) => result.github_deployment_id === null,
    );
    if (syntheticResults.length > 0) {
      invariant(
        syntheticResults.length === 1 &&
          results.length === 1 &&
          evidence.length === 0 &&
          isSupportedControllerSyntheticPreviewResult(syntheticResults[0]),
        "Preview controller synthetic result is unsupported",
      );
      references.push({
        kind: "controller-synthetic",
        runId: String(syntheticResults[0].worker_run_id),
        attempt: Number(syntheticResults[0].worker_run_attempt),
        selection,
        result: syntheticResults[0],
      });
      continue;
    }
    invariant(
      evidenceByRunAttempt.size === resultByRunAttempt.size &&
        [...evidenceByRunAttempt.keys()].every((key) =>
          resultByRunAttempt.has(key),
        ),
      "Preview worker evidence/result pairs are incomplete; retry capture",
    );
    for (const [key, result] of resultByRunAttempt) {
      const receipt = evidenceByRunAttempt.get(key);
      const deployment = deploymentsById.get(
        String(result.github_deployment_id),
      );
      invariant(
        deployment !== undefined,
        "Preview result GitHub Deployment is missing",
      );
      const status = validatePreviewDeployment({
        ...deployment,
        selection,
        evidence: receipt,
        result,
      });
      validatedDeploymentStatuses.push({
        deploymentId: String(deployment.deployment.id),
        status,
      });
      references.push({
        kind: "worker",
        runId: String(result.worker_run_id),
        attempt: Number(result.worker_run_attempt),
        selection,
        evidence: receipt,
        result,
      });
    }
  }
  const uniqueReferences = bindUniquePreviewReferences(references);
  invariant(
    uniqueReferences.length === worker.references.length,
    "Preview worker references include unbound receipts",
  );
  const uniqueDeploymentStatuses = new Map();
  for (const pair of validatedDeploymentStatuses) {
    const statusId = positiveId(pair.status.id, "Preview deployment status ID");
    const prior = uniqueDeploymentStatuses.get(statusId);
    invariant(
      prior === undefined ||
        (prior.deploymentId === pair.deploymentId &&
          canonicalJson(prior.status) === canonicalJson(pair.status)),
      "Preview deployment terminal status conflicts across selection receipts",
    );
    uniqueDeploymentStatuses.set(statusId, pair);
  }
  return {
    references: uniqueReferences,
    currentSelections,
    validatedDeploymentStatuses: [...uniqueDeploymentStatuses.values()],
  };
}

export function bindUniquePreviewReferences(references) {
  const uniqueReferences = new Map();
  for (const reference of references) {
    const key = `${reference.runId}:${reference.attempt}`;
    const prior = uniqueReferences.get(key);
    invariant(
      prior === undefined || prior.kind === reference.kind,
      "Preview run is both worker and controller evidence",
    );
    if (prior === undefined) {
      uniqueReferences.set(key, {
        ...reference,
        bindings: [
          {
            selection: reference.selection,
            result: reference.result,
          },
        ],
      });
      continue;
    }
    invariant(
      reference.kind === "controller-synthetic" ||
        prior.selection.key_digest === reference.selection.key_digest,
      "Preview worker run is reused across selection keys",
    );
    prior.bindings.push({
      selection: reference.selection,
      result: reference.result,
    });
  }
  return [...uniqueReferences.values()];
}

function journalTargetStateForValidation(
  journal,
  event,
  target,
  selections,
  results,
) {
  invariant(
    selections.length > 0,
    `Preview target ${target} has no selection chain`,
  );
  const selectionByKey = new Map(
    selections.map((selection) => [selection.key_digest, selection]),
  );
  invariant(
    selectionByKey.size === selections.length,
    `Preview target ${target} selection chain contains duplicate keys`,
  );
  const targetState = journal.state?.targets?.[target];
  invariant(
    targetState !== undefined && Array.isArray(targetState.terminal_history),
    `Preview target ${target} terminal state is missing`,
  );
  const relevantTerminals = targetState.terminal_history.filter((entry) =>
    selectionByKey.has(entry.key_digest),
  );
  const relevantResults = results.filter((result) =>
    selectionByKey.has(result.key_digest),
  );
  invariant(
    relevantTerminals.length === relevantResults.length &&
      relevantResults.every(
        (result) =>
          relevantTerminals.filter(
            (entry) =>
              entry.key_digest === result.key_digest &&
              String(entry.worker_run_id) === String(result.worker_run_id) &&
              entry.sha === result.sha &&
              entry.expected_workflow_sha === result.expected_workflow_sha &&
              entry.state === result.state &&
              entry.github_deployment_id === result.github_deployment_id &&
              entry.vercel_deployment_url === result.vercel_deployment_url &&
              entry.terminal_reason === result.terminal_reason,
          ).length === 1,
      ),
    `Preview target ${target} terminal history does not bind its full result chain`,
  );
  const terminal = relevantTerminals.at(-1);
  invariant(
    terminal !== undefined &&
      targetState.active === null &&
      terminal.sha === targetState.latest_desired_sha,
    `Preview target ${target} has no current terminal selection`,
  );
  const currentSelections = selections.filter(
    (selection) => selection.key_digest === terminal.key_digest,
  );
  invariant(
    currentSelections.length === 1 &&
      (currentSelections[0].selection_receipt_run_id === event.event_run_id ||
        currentSelections[0].coalesced_receipt_run_ids.includes(
          event.event_run_id,
        )),
    `Preview target ${target} terminal selection does not cover the event`,
  );
  return currentSelections[0];
}

export function assertControllerSyntheticRunBinding({
  rawRun,
  bindings,
  selections,
  journal,
}) {
  const matchingEvents = journal.receipts.events.filter(
    (event) => String(event.event_run_id) === String(rawRun.id),
  );
  invariant(
    matchingEvents.length <= 1,
    "Preview controller synthetic run matches multiple event receipts",
  );
  if (matchingEvents.length === 1) {
    const event = matchingEvents[0];
    invariant(
      rawRun.event === "pull_request_target" &&
        rawRun.head_branch === event.base_ref &&
        rawRun.head_sha === event.trusted_base_sha &&
        rawRun.display_title ===
          controllerEventRunName({
            runId: event.event_run_id,
            runNumber: event.event_run_number,
            pr: event.pr,
            sha: event.head_sha,
            before: event.before_sha,
            action: event.event_action,
            receiptRequired: true,
          }),
      "Preview controller synthetic run conflicts with its event receipt",
    );
    return true;
  }
  invariant(
    rawRun.event === "workflow_run" &&
      bindings.every(
        ({ selection, result }) =>
          result.terminal_reason ===
            "controller-workflow-upgraded-before-dispatch" &&
          selections.some(
            (candidate) =>
              candidate.target === selection.target &&
              candidate.sha === selection.sha &&
              candidate.selection_receipt_run_id ===
                selection.selection_receipt_run_id &&
              candidate.key_digest !== selection.key_digest &&
              candidate.expected_workflow_sha === rawRun.head_sha,
          ),
      ),
    "Preview controller synthetic run lacks an event or upgrade replacement binding",
  );
  return true;
}

function captureStartBoundary(
  dependencies,
  startUtc,
  endUtcExclusive,
  recordedAtUtc,
) {
  authenticateGh(dependencies);
  const repository = apiJson(
    dependencies,
    `repos/${OBSERVATION_REPOSITORY}`,
    "Boundary repository",
  );
  invariant(
    repository.private === false && repository.visibility === "public",
    "Observation repository must be public at the start boundary",
  );
  const mainReference = apiJson(
    dependencies,
    `repos/${OBSERVATION_REPOSITORY}/git/ref/heads/main`,
    "Boundary main reference",
  );
  const currentMainSha = exactSha(
    mainReference.object?.sha,
    "Boundary main SHA",
  );
  const workflows = paginatedCollection(
    apiJson(
      dependencies,
      `repos/${OBSERVATION_REPOSITORY}/actions/workflows?per_page=100`,
      "Boundary workflow inventory",
      { paginate: true },
    ),
    "workflows",
    "Boundary workflow inventory",
  )
    .filter((workflow) => BOUNDARY_WORKFLOW_PATHS.has(workflow.path))
    .map((workflow) => ({
      id: positiveId(workflow.id, "Boundary workflow ID"),
      name: workflow.name,
      path: workflow.path,
      state: workflow.state,
      htmlUrl: workflow.html_url,
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const missingWorkflowPaths = [...BOUNDARY_WORKFLOW_PATHS]
    .filter((path) => !workflows.some((workflow) => workflow.path === path))
    .sort();
  invariant(
    missingWorkflowPaths.length === 0,
    `Boundary workflow inventory is incomplete: ${missingWorkflowPaths.join(", ")}`,
  );
  const openPulls = paginatedCollection(
    apiJson(
      dependencies,
      `repos/${OBSERVATION_REPOSITORY}/pulls?state=open&per_page=100`,
      "Boundary open pull requests",
      { paginate: true },
    ),
    "pulls",
    "Boundary open pull requests",
  );
  const openPullRequestJournals = [];
  for (const pull of openPulls) {
    const pr = positiveId(pull.number, "Boundary pull request number");
    const comments = paginatedCollection(
      apiJson(
        dependencies,
        `repos/${OBSERVATION_REPOSITORY}/issues/${pr}/comments?per_page=100`,
        "Boundary pull request comments",
        { paginate: true },
      ),
      "comments",
      "Boundary pull request comments",
    );
    const matches = comments.filter(
      (comment) =>
        comment.user?.type === "Bot" &&
        comment.user?.login === "github-actions[bot]" &&
        typeof comment.body === "string" &&
        comment.body.startsWith(PREVIEW_JOURNAL_MARKER),
    );
    invariant(
      matches.length <= 1,
      `Boundary PR ${pr} has multiple bot-owned preview journals`,
    );
    const journal =
      matches.length === 0 ? null : parsePreviewJournalComment(matches[0], pr);
    const headSha = exactSha(pull.head?.sha, `Boundary PR ${pr} head SHA`);
    const recheckedPull = apiJson(
      dependencies,
      `repos/${OBSERVATION_REPOSITORY}/pulls/${pr}`,
      "Boundary pull request recheck",
    );
    invariant(
      recheckedPull.number === Number(pr) &&
        exactSha(
          recheckedPull.head?.sha,
          `Boundary PR ${pr} rechecked head SHA`,
        ) === headSha,
      `Boundary PR ${pr} head changed while recording its journal; retry initialization`,
    );
    openPullRequestJournals.push({
      pr: Number(pr),
      headSha,
      updatedAtUtc: githubUtc(pull.updated_at, `Boundary PR ${pr} update time`),
      preBoundaryEligiblePushEvidence: preBoundaryEligiblePushEvidence(
        journal,
        headSha,
      ),
      journal:
        journal === null
          ? null
          : {
              commentId: positiveId(
                matches[0].id,
                `Boundary PR ${pr} journal comment ID`,
              ),
              schema: journal.schema,
              revision: journal.revision,
              digest: journal.journal_digest,
              epochAnchorRunId:
                journal.state?.epoch?.anchor_run_id === undefined
                  ? null
                  : String(journal.state.epoch.anchor_run_id),
            },
    });
  }
  openPullRequestJournals.sort((left, right) => left.pr - right.pr);
  const pendingStatuses = [
    "requested",
    "waiting",
    "pending",
    "queued",
    "in_progress",
  ];
  const inFlightById = new Map();
  for (const status of pendingStatuses) {
    const runs = paginatedCollection(
      apiJson(
        dependencies,
        `repos/${OBSERVATION_REPOSITORY}/actions/runs?status=${status}&per_page=100`,
        `Boundary ${status} runs`,
        { paginate: true },
      ),
      "workflow_runs",
      `Boundary ${status} runs`,
    );
    for (const run of relevantWorkflowRuns(runs)) {
      inFlightById.set(String(run.id), compactRun(run));
    }
  }
  const completedAtUtc = exactUtc(
    dependencies.now().toISOString(),
    "Observation boundary completion time",
  );
  invariant(
    Date.parse(completedAtUtc) <= Date.parse(startUtc),
    "Observation initialization crossed its start boundary; retry with a later start",
  );
  return {
    schema: "vercel-cost-observation-boundary:v2",
    repository: OBSERVATION_REPOSITORY,
    boundary: "start",
    timestampUtc: startUtc,
    endUtcExclusive,
    recordedAtUtc,
    source: "github-api-through-logged-in-gh",
    repositoryVisibility: {
      private: repository.private,
      visibility: repository.visibility,
      publicAtCapture: true,
    },
    currentMainSha,
    workflows,
    openPullRequestJournals,
    inFlightRuns: [...inFlightById.values()].sort(
      (left, right) => Number(left.id) - Number(right.id),
    ),
    providerFieldsResolved: false,
  };
}

function initializeObservation({ root, start, end, now, dependencies }) {
  const startUtc = utcBoundary(start, "Observation start");
  const endUtcExclusive = utcBoundary(end, "Observation end");
  invariant(
    Date.parse(endUtcExclusive) - Date.parse(startUtc) >=
      7 * 24 * 60 * 60 * 1000,
    "Observation interval must contain at least seven complete UTC days",
  );
  const intervalPath = join(root, "interval.json");
  const boundaryPath = join(root, "boundary", "start.json");
  if (existsSync(intervalPath)) {
    const existing = readInterval(root);
    invariant(
      existing.startUtc === startUtc,
      "Existing observation start conflicts",
    );
    invariant(
      existsSync(boundaryPath),
      "Completed observation initialization is missing its start boundary",
    );
    const boundary = readPrivateJson(
      boundaryPath,
      root,
      "Existing observation start boundary",
    );
    invariant(
      boundary.schema === "vercel-cost-observation-boundary:v2" &&
        boundary.timestampUtc === startUtc &&
        boundary.endUtcExclusive === existing.initialEndUtcExclusive &&
        Date.parse(boundary.recordedAtUtc) <= Date.parse(startUtc),
      "Existing observation start boundary conflicts",
    );
    if (endUtcExclusive === existing.endUtcExclusive) return existing;
    invariant(
      Date.parse(endUtcExclusive) > Date.parse(existing.endUtcExclusive),
      "Observation interval cannot shrink or replay a non-current end",
    );
    invariant(
      !existsSync(join(root, "audit.json")),
      "Audited observation interval cannot be extended",
    );
    const extensionTime = exactUtc(
      now().toISOString(),
      "Observation extension time",
    );
    invariant(
      Date.parse(extensionTime) <= Date.parse(endUtcExclusive),
      "Observation interval cannot be extended to an end in the past",
    );
    const extension = {
      schema: OBSERVATION_INTERVAL_EXTENSION_SCHEMA,
      repository: OBSERVATION_REPOSITORY,
      startUtc,
      previousEndUtcExclusive: existing.endUtcExclusive,
      previousRecordSha256: existing.extensionChainHeadSha256,
      endUtcExclusive,
      createdAtUtc: extensionTime,
      reason: "observation-threshold-or-boundary-drain-extension",
    };
    const extensionPath = join(
      root,
      "interval-extensions",
      `${endUtcExclusive.replaceAll(":", "-")}.json`,
    );
    invariant(
      !existsSync(extensionPath),
      "Observation interval extension record conflicts",
    );
    writePrivateJson(extensionPath, extension, root);
    return readInterval(root);
  }
  let boundary;
  if (existsSync(boundaryPath)) {
    boundary = readPrivateJson(
      boundaryPath,
      root,
      "Partial observation start boundary",
    );
    invariant(
      boundary.schema === "vercel-cost-observation-boundary:v2" &&
        boundary.timestampUtc === startUtc &&
        boundary.endUtcExclusive === endUtcExclusive &&
        Date.parse(boundary.recordedAtUtc) <= Date.parse(startUtc),
      "Partial observation start boundary conflicts",
    );
  } else {
    const initializationTime = exactUtc(
      now().toISOString(),
      "Observation initialization time",
    );
    invariant(
      Date.parse(initializationTime) <= Date.parse(startUtc),
      "Observation must be initialized no later than its start boundary",
    );
    boundary = captureStartBoundary(
      dependencies,
      startUtc,
      endUtcExclusive,
      initializationTime,
    );
    writePrivateJson(boundaryPath, boundary, root);
  }
  const createdAtUtc = boundary.recordedAtUtc;
  const interval = {
    schema: OBSERVATION_INTERVAL_SCHEMA,
    repository: OBSERVATION_REPOSITORY,
    startUtc,
    endUtcExclusive,
    createdAtUtc,
    boundarySha256: sha256(readFileSync(boundaryPath)),
    intervalSemantics: "half-open-complete-utc-days",
    privateRoot: OBSERVATION_RELATIVE_ROOT,
    cutoverProvenance: {
      complete: false,
      reason: "operator-must-bind-approved-cutover-evidence",
    },
  };
  // interval.json is the commit marker. A crash after the immutable boundary
  // write is recoverable because this object derives only from that boundary.
  writePrivateJson(intervalPath, interval, root);
  return interval;
}

function capturePreview({ root, pr, eventRunId, dependencies }) {
  const interval = readInterval(root);
  const prNumber = positiveId(pr, "Pull request number");
  const controllerRunId = positiveId(eventRunId, "Event run ID");
  const destination = join(root, "preview", controllerRunId);
  if (existsSync(destination)) {
    return verifyCaptureDirectory(destination, root, PREVIEW_CAPTURE_SCHEMA, {
      pr: Number(prNumber),
      eventRunId: controllerRunId,
    });
  }

  return stageCapture(root, `preview-${controllerRunId}`, (stage) => {
    const pull = apiJson(
      dependencies,
      `repos/${OBSERVATION_REPOSITORY}/pulls/${prNumber}`,
      "Pull request",
    );
    invariant(
      pull.number === Number(prNumber) &&
        pull.base?.repo?.full_name === OBSERVATION_REPOSITORY,
      "Pull request repository identity is unsupported",
    );
    const comments = paginatedCollection(
      apiJson(
        dependencies,
        `repos/${OBSERVATION_REPOSITORY}/issues/${prNumber}/comments?per_page=100`,
        "Pull request comments",
        { paginate: true },
      ),
      "comments",
      "Pull request comments",
    );
    const journalComments = comments.filter(
      (comment) =>
        comment.user?.type === "Bot" &&
        comment.user?.login === "github-actions[bot]" &&
        typeof comment.body === "string" &&
        comment.body.startsWith(PREVIEW_JOURNAL_MARKER),
    );
    invariant(
      journalComments.length === 1,
      "Expected exactly one bot-owned preview journal",
    );
    const journalComment = journalComments[0];
    const liveJournal = parsePreviewJournalComment(journalComment, prNumber);
    const liveEvent = eventReceiptFromJournal(liveJournal, controllerRunId, {
      allowMissing: true,
    });
    const immutable = previewObservationArtifact(
      { ...dependencies, root },
      controllerRunId,
      root,
      { required: liveEvent === null },
    );
    const journal =
      immutable === null
        ? liveJournal
        : createPreviewJournal({
            pr: immutable.receipt.pr,
            revision: immutable.receipt.journal_revision,
            checkpoint: immutable.receipt.checkpoint,
            events: immutable.receipt.receipts.events,
            selections: immutable.receipt.receipts.selections,
            workerEvidence: immutable.receipt.receipts.worker_evidence,
            results: immutable.receipt.receipts.results,
            state: immutable.receipt.state,
            ...(Object.hasOwn(immutable.receipt, "admission")
              ? { admission: immutable.receipt.admission }
              : {}),
          });
    const event = eventReceiptFromJournal(journal, controllerRunId);
    if (immutable !== null) {
      invariant(
        immutable.receipt.pr === Number(prNumber) &&
          String(immutable.receipt.event_run_id) === controllerRunId,
        "Immutable preview observation receipt identity does not match",
      );
    }
    invariant(
      event.pr === Number(prNumber),
      "Preview event receipt PR does not match",
    );
    const controllerRun = terminalRun(
      apiJson(
        dependencies,
        `repos/${OBSERVATION_REPOSITORY}/actions/runs/${controllerRunId}`,
        "Preview controller run",
      ),
      ".github/workflows/vercel-preview-controller.yml",
      "Preview controller run",
    );
    invariant(
      controllerRun.event === "pull_request_target" &&
        String(controllerRun.id) === controllerRunId &&
        controllerRun.head_branch === event.base_ref &&
        controllerRun.head_sha === event.trusted_base_sha,
      "Preview controller run is not the immutable PR event run",
    );
    const expectedTitle = controllerEventRunName({
      runId: controllerRunId,
      runNumber: event.event_run_number ?? controllerRun.run_number,
      pr: event.pr,
      sha: event.head_sha,
      before: event.before_sha,
      action: event.event_action,
      receiptRequired: true,
    });
    invariant(
      controllerRun.display_title === expectedTitle,
      "Preview controller run title does not match the event receipt",
    );
    invariant(
      withinInterval(controllerRun.created_at, interval),
      "Preview event is outside the observation interval",
    );

    const statuses = paginatedCollection(
      apiJson(
        dependencies,
        `repos/${OBSERVATION_REPOSITORY}/commits/${event.head_sha}/statuses?per_page=100`,
        "Preview commit statuses",
        { paginate: true },
      ),
      "statuses",
      "Preview commit statuses",
    );
    const deployments = paginatedCollection(
      apiJson(
        dependencies,
        `repos/${OBSERVATION_REPOSITORY}/deployments?sha=${event.head_sha}&per_page=100`,
        "Preview deployments",
        { paginate: true },
      ),
      "deployments",
      "Preview deployments",
    );
    const deploymentsWithStatuses = deployments.map((deployment) => ({
      deployment,
      statuses: paginatedCollection(
        apiJson(
          dependencies,
          `repos/${OBSERVATION_REPOSITORY}/deployments/${deployment.id}/statuses?per_page=100`,
          "Preview deployment statuses",
          { paginate: true },
        ),
        "statuses",
        "Preview deployment statuses",
      ),
    }));
    const selections = eventSelections(journal, controllerRunId);
    const worker = relevantWorkerReferences(journal, selections);
    const decision = statusDecisionForEvent(journal, event);
    const sentinel = latestSentinelStatus(statuses);
    const {
      references: validatedReferences,
      currentSelections,
      validatedDeploymentStatuses,
    } = validateTerminalPreviewReceipts({
      journal,
      event,
      selections,
      worker,
      decision,
      sentinel,
      controllerRun,
      deploymentsWithStatuses,
    });
    const capturedWorkers = [];
    const capturedControllerSyntheticRuns = [];

    for (const reference of validatedReferences) {
      const expectedPath =
        reference.kind === "worker"
          ? ".github/workflows/vercel-preview-worker.yml"
          : ".github/workflows/vercel-preview-controller.yml";
      const rawRun = terminalRun(
        fetchAttempt(
          dependencies,
          reference.runId,
          reference.attempt,
          "Preview referenced run",
        ),
        expectedPath,
        "Preview referenced run",
      );
      invariant(
        String(rawRun.id) === reference.runId &&
          Number(rawRun.run_attempt) === reference.attempt &&
          SHA_PATTERN.test(rawRun.head_sha),
        "Preview referenced run identity conflicts with its receipt",
      );
      if (reference.kind === "worker") {
        invariant(
          rawRun.head_sha === reference.selection.expected_workflow_sha,
          "Preview worker run head conflicts with its selection",
        );
      } else {
        assertControllerSyntheticRunBinding({
          rawRun,
          bindings: reference.bindings,
          selections,
          journal,
        });
      }
      let parsedTitle = null;
      if (reference.kind === "worker") {
        parsedTitle = parseWorkerRunName(rawRun.display_title);
        invariant(
          parsedTitle.pr === Number(prNumber) &&
            parsedTitle.target === reference.selection.target &&
            parsedTitle.sha === reference.selection.sha &&
            parsedTitle.keyDigest === reference.selection.key_digest,
          "Preview worker run title conflicts with its selection",
        );
      }
      const jobs = fetchAttemptJobs(
        dependencies,
        reference.runId,
        reference.attempt,
        "Preview worker",
      );
      const logs = fetchAttemptLogs(
        dependencies,
        reference.runId,
        reference.attempt,
      );
      const prefix =
        reference.kind === "worker"
          ? `workers/${reference.runId}/attempt-${reference.attempt}`
          : `controller-synthetic/${reference.runId}/attempt-${reference.attempt}`;
      writeRawJson(stage, `${prefix}/run.json`, rawRun, root);
      writeRawJson(stage, `${prefix}/jobs.json`, jobs, root);
      writeRawText(stage, `${prefix}/logs/run.log`, logs, root);
      if (reference.kind === "worker") {
        capturedWorkers.push({
          runId: reference.runId,
          attempt: reference.attempt,
          target: parsedTitle.target,
          sha: parsedTitle.sha,
          keyDigest: parsedTitle.keyDigest,
          conclusion: rawRun.conclusion,
          completedAtUtc: githubUtc(
            rawRun.updated_at,
            "Preview worker completion time",
          ),
        });
      } else {
        capturedControllerSyntheticRuns.push({
          runId: reference.runId,
          attempt: reference.attempt,
          terminalReason: reference.result.terminal_reason,
          conclusion: rawRun.conclusion,
          completedAtUtc: githubUtc(
            rawRun.updated_at,
            "Preview controller synthetic completion time",
          ),
        });
      }
    }

    writeRawJson(stage, "raw/pull.json", pull, root);
    writeRawJson(stage, "raw/journal-comment.json", journalComment, root);
    if (immutable !== null) {
      writeRawJson(
        stage,
        "raw/observation-receipt-artifact.json",
        immutable.artifact,
        root,
      );
      writeRawJson(
        stage,
        "raw/observation-receipt.json",
        immutable.receipt,
        root,
      );
    }
    writeRawJson(stage, "raw/statuses.json", statuses, root);
    writeRawJson(
      stage,
      "raw/deployments.json",
      deploymentCapture(deploymentsWithStatuses),
      root,
    );
    writeRawJson(stage, "raw/controller-run.json", controllerRun, root);

    const eligibleTrustedDeployedCodePush =
      event.trust === "trusted" &&
      ["opened", "synchronize"].includes(event.event_action) &&
      event.plan.targets.length > 0;
    const evidenceComplete = true;
    const capture = {
      schema: PREVIEW_CAPTURE_SCHEMA,
      repository: OBSERVATION_REPOSITORY,
      pr: Number(prNumber),
      eventRunId: controllerRunId,
      capturedAtUtc: exactUtc(
        dependencies.now().toISOString(),
        "Preview capture time",
      ),
      eventTimestampUtc: githubUtc(
        controllerRun.created_at,
        "Preview event time",
      ),
      eventAction: event.event_action,
      headSha: event.head_sha,
      beforeSha: event.before_sha,
      trust: event.trust,
      plan: event.plan,
      canonicalDerivedFacts: {
        eligibleTrustedDeployedCodePush,
        observationReceiptSource:
          immutable === null ? "live-journal" : "actions-artifact",
        journalSchema: journal.schema,
        journalRevision: journal.revision,
        journalCommentId: positiveId(
          journalComment.id,
          "Preview journal comment ID",
        ),
        statusDecision: decision,
        finalSentinel: sentinel
          ? {
              id: positiveId(sentinel.id, "Preview status ID"),
              state: sentinel.state,
              targetUrl: sentinel.target_url ?? null,
              updatedAtUtc: githubUtc(
                sentinel.updated_at ?? sentinel.created_at,
                "Preview status update time",
              ),
            }
          : null,
        selectionKeys: selections.map((selection) => selection.key_digest),
        currentSelectionKeys: currentSelections.map(
          (selection) => selection.key_digest,
        ),
        workerEvidenceRunIds: worker.evidence.map((entry) =>
          String(entry.worker_run_id),
        ),
        workerResultRunIds: worker.results.map((entry) =>
          String(entry.worker_run_id),
        ),
        capturedWorkers,
        capturedControllerSyntheticRuns,
        githubDeploymentIds: [
          ...new Set(
            validatedDeploymentStatuses.map(({ deploymentId }) => deploymentId),
          ),
        ],
        githubDeploymentTerminalStatuses: validatedDeploymentStatuses.map(
          ({ deploymentId, status }) => ({
            deploymentId,
            statusId: positiveId(status.id, "Preview deployment status ID"),
            state: status.state,
            createdAtUtc: githubUtc(
              status.created_at,
              "Preview deployment status time",
            ),
          }),
        ),
        evidenceComplete,
      },
      unresolvedProviderFields: [
        "vercelDeploymentCensus",
        "nativeDuplicateClassification",
        "buildCpuMinutes",
      ],
      files: [],
    };
    return publishCapture({ root, stage, destination, capture });
  });
}

function downloadArtifact(dependencies, runId, name, directory) {
  ensureDirectory(directory, dependencies.root);
  ghBytes(dependencies, [
    "run",
    "download",
    String(runId),
    "--repo",
    GITHUB_REPOSITORY,
    "--name",
    name,
    "--dir",
    directory,
  ]);
}

function validateDownloadedJournal(directory, root) {
  assertPrivateDirectory(directory, root, "Downloaded journal directory");
  const entries = readdirSync(directory);
  invariant(
    entries.length === 1 && entries[0] === "main-journal.json",
    "Downloaded journal artifact must contain one main-journal.json",
  );
  const path = join(directory, "main-journal.json");
  const stats = lstatSync(path);
  invariant(
    stats.isFile() && !stats.isSymbolicLink() && stats.nlink === 1,
    "Downloaded main journal must be a regular file",
  );
  chmodSync(path, 0o600);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error("Downloaded main journal is not valid JSON");
  }
  const journal = assertMainTransactionJournal(parsed);
  invariant(
    mainTransactionJournalArtifactName(journal) === basename(directory),
    "Downloaded main journal name conflicts with its identity",
  );
  return journal;
}

function copyPrivateFile(source, destination, root) {
  const bytes = readFileSync(source);
  writePrivateFile(destination, bytes, root);
}

const MAIN_TERMINAL_ROUTE_STEPS = new Map([
  [
    "Materialize no-target terminal artifacts without a journal",
    { outcome: "no-target", journalStatus: null },
  ],
  [
    "Materialize superseded terminal artifacts without a journal",
    { outcome: "superseded-before-journal", journalStatus: null },
  ],
  [
    "Materialize shadow-only terminal artifacts without a journal",
    { outcome: "shadow-prepared", journalStatus: null },
  ],
  [
    "Materialize committed terminal artifacts",
    { outcome: "active-committed", journalStatus: "committed" },
  ],
  [
    "Materialize an already-current release terminal without a journal",
    { outcome: "current-release-verified", journalStatus: null },
  ],
  [
    "Materialize recovery-failed terminal artifacts without a recovery journal",
    { outcome: "recovery-failed", journalStatus: null },
  ],
  [
    "Materialize preparation failure terminal artifacts without a journal",
    {
      outcome: "preparation-failed-before-journal",
      journalStatus: null,
    },
  ],
  [
    "Materialize recovered or manual terminal artifacts",
    { outcome: null, journalStatus: "recovered-or-manual" },
  ],
]);

export function deriveMainTerminalRoute({ jobs, journalHistories }) {
  invariant(Array.isArray(jobs), "Main terminal route jobs are malformed");
  invariant(
    Array.isArray(journalHistories),
    "Main terminal route journal histories are malformed",
  );
  const completedSteps = jobs.flatMap((job) =>
    (Array.isArray(job.steps) ? job.steps : [])
      .filter(
        (step) =>
          step.status === "completed" &&
          step.conclusion === "success" &&
          MAIN_TERMINAL_ROUTE_STEPS.has(step.name),
      )
      .map((step) => step.name),
  );
  const uniqueSteps = [...new Set(completedSteps)];
  if (uniqueSteps.length !== 1) {
    return {
      complete: false,
      outcome: null,
      terminalStep: null,
      journalBinding: null,
      reason:
        uniqueSteps.length === 0
          ? "terminal-route-step-missing"
          : "terminal-route-step-ambiguous",
      observedTerminalSteps: uniqueSteps.sort(),
    };
  }
  const terminalStep = uniqueSteps[0];
  const contract = MAIN_TERMINAL_ROUTE_STEPS.get(terminalStep);
  let outcome = contract.outcome;
  let journalBinding = null;
  if (contract.journalStatus === "committed") {
    const matches = journalHistories.filter(
      (history) => history.highestStatus === "committed",
    );
    if (matches.length !== 1) {
      return {
        complete: false,
        outcome,
        terminalStep,
        journalBinding: null,
        reason:
          matches.length === 0
            ? "committed-journal-missing"
            : "committed-journal-ambiguous",
        observedTerminalSteps: uniqueSteps,
      };
    }
    journalBinding = {
      transactionId: matches[0].transactionId,
      highestSequence: matches[0].highestSequence,
      highestStatus: matches[0].highestStatus,
    };
  } else if (contract.journalStatus === "recovered-or-manual") {
    const matches = journalHistories.filter((history) =>
      ["recovered", "manual_intervention"].includes(history.highestStatus),
    );
    if (matches.length !== 1) {
      return {
        complete: false,
        outcome: null,
        terminalStep,
        journalBinding: null,
        reason:
          matches.length === 0
            ? "recovery-terminal-journal-missing"
            : "recovery-terminal-journal-ambiguous",
        observedTerminalSteps: uniqueSteps,
      };
    }
    outcome =
      matches[0].highestStatus === "recovered"
        ? "recovered"
        : "manual-intervention";
    journalBinding = {
      transactionId: matches[0].transactionId,
      highestSequence: matches[0].highestSequence,
      highestStatus: matches[0].highestStatus,
    };
  }
  return {
    complete: true,
    outcome,
    terminalStep,
    journalBinding,
    reason: null,
    observedTerminalSteps: uniqueSteps,
  };
}

export function assertMainDeployShaBinding(deploySha, workflowDeploySha) {
  const workflowSha = exactSha(
    workflowDeploySha,
    "Main workflow deployment SHA",
  );
  if (deploySha === null) return null;
  const journalSha = exactSha(deploySha, "Main journal deploy SHA");
  invariant(
    journalSha === workflowSha,
    "Main journal deploy SHA does not match the workflow deployment SHA",
  );
  return journalSha;
}

function captureMain({ root, runId, dependencies }) {
  const interval = readInterval(root);
  const mainRunId = positiveId(runId, "Main run ID");
  const currentRun = terminalRun(
    apiJson(
      dependencies,
      `repos/${OBSERVATION_REPOSITORY}/actions/runs/${mainRunId}`,
      "Main deployment run",
    ),
    MAIN_WORKFLOW_PATH,
    "Main deployment run",
  );
  invariant(
    currentRun.event === "workflow_run" &&
      String(currentRun.id) === mainRunId &&
      currentRun.head_branch === "main",
    "Main deployment run identity is unsupported",
  );
  invariant(
    withinInterval(currentRun.created_at, interval),
    "Main deployment run is outside the observation interval",
  );
  const currentAttempt = Number(
    positiveId(currentRun.run_attempt, "Main current attempt"),
  );
  const mainRoot = join(root, "main", mainRunId);
  const existingCaptures = [];
  if (existsSync(mainRoot)) {
    assertPrivateDirectory(mainRoot, root, "Existing main run capture");
    const entries = readdirSync(mainRoot);
    const attemptNumbers = entries
      .map((name) => {
        const path = join(mainRoot, name);
        const stats = lstatSync(path);
        invariant(
          stats.isDirectory() && !stats.isSymbolicLink(),
          "Main run capture contains an unexpected entry",
        );
        const match = /^attempt-([1-9][0-9]*)$/.exec(name);
        invariant(match, "Main run attempt directory name is malformed");
        return Number(match[1]);
      })
      .sort((left, right) => left - right);
    invariant(
      attemptNumbers.every((attempt, index) => attempt === index + 1),
      "Existing main run attempts are not a contiguous prefix",
    );
    invariant(
      attemptNumbers.length <= currentAttempt,
      "Existing main run capture is ahead of GitHub",
    );
    for (const attempt of attemptNumbers) {
      existingCaptures.push(
        verifyCaptureDirectory(
          join(mainRoot, `attempt-${attempt}`),
          root,
          MAIN_CAPTURE_SCHEMA,
          { runId: mainRunId, runAttempt: attempt },
        ),
      );
    }
  }
  if (existingCaptures.length === currentAttempt) return existingCaptures;
  const firstMissingAttempt = existingCaptures.length + 1;

  return stageCapture(root, `main-${mainRunId}`, (stage) => {
    const attempts = [];
    for (
      let attempt = firstMissingAttempt;
      attempt <= currentAttempt;
      attempt += 1
    ) {
      const run = terminalRun(
        attempt === currentAttempt
          ? currentRun
          : fetchAttempt(dependencies, mainRunId, attempt, "Main run"),
        MAIN_WORKFLOW_PATH,
        `Main run attempt ${attempt}`,
      );
      invariant(
        Number(run.run_attempt) === attempt,
        "Main attempt endpoint returned another attempt",
      );
      attempts.push({
        attempt,
        run,
        jobs: fetchAttemptJobs(dependencies, mainRunId, attempt, "Main run"),
        logs: fetchAttemptLogs(dependencies, mainRunId, attempt),
      });
    }
    const artifacts = paginatedCollection(
      apiJson(
        dependencies,
        `repos/${OBSERVATION_REPOSITORY}/actions/runs/${mainRunId}/artifacts?per_page=100`,
        "Main run artifacts",
        { paginate: true },
      ),
      "artifacts",
      "Main run artifacts",
    );
    const journalArtifacts = artifacts.filter((artifact) =>
      JOURNAL_ARTIFACT_PATTERN.test(String(artifact.name)),
    );
    const downloadedJournals = [];
    const downloadRoot = join(stage, ".downloads");
    ensureDirectory(downloadRoot, root);
    for (const artifact of journalArtifacts) {
      invariant(
        artifact.expired === false,
        `Main journal artifact expired before capture: ${artifact.name}`,
      );
      const directory = join(downloadRoot, artifact.name);
      ensureDirectory(directory, root);
      downloadArtifact(dependencies, mainRunId, artifact.name, directory);
      const journal = validateDownloadedJournal(directory, root);
      invariant(
        String(journal.runId) === mainRunId &&
          Number(journal.runAttempt) >= 1 &&
          Number(journal.runAttempt) <= currentAttempt,
        "Main journal belongs to another run or attempt",
      );
      downloadedJournals.push({ artifact, journal, directory });
    }
    const histories = [];
    const byIdentity = new Map();
    for (const item of downloadedJournals) {
      const key = `${item.journal.runAttempt}:${item.journal.transactionId}`;
      const group = byIdentity.get(key) ?? [];
      group.push(item);
      byIdentity.set(key, group);
    }
    for (const group of byIdentity.values()) {
      const sample = group[0].journal;
      const canonical = assertMainTransactionJournalHistory(
        group.map(({ journal }) => journal),
        {
          repository: OBSERVATION_REPOSITORY,
          deploySha: sample.deploySha,
          runId: mainRunId,
          runAttempt: sample.runAttempt,
          transactionId: sample.transactionId,
          mode: sample.mode,
        },
      );
      histories.push({
        runAttempt: Number(sample.runAttempt),
        transactionId: sample.transactionId,
        deploySha: sample.deploySha,
        upstreamRunId: String(sample.release.upstreamRunId),
        highestSequence: canonical.at(-1).sequence,
        highestStatus: canonical.at(-1).status,
        artifactNames: canonical.map(mainTransactionJournalArtifactName),
      });
    }
    const deployShas = new Set(histories.map((history) => history.deploySha));
    const upstreamRunIds = new Set(
      histories.map((history) => history.upstreamRunId),
    );
    invariant(
      deployShas.size <= 1 && upstreamRunIds.size <= 1,
      "Main journal histories conflict on release identity",
    );
    let deploySha = [...deployShas][0] ?? null;
    let upstreamRunId = [...upstreamRunIds][0] ?? null;
    let upstreamCorrelation =
      upstreamRunId === null
        ? {
            status: "unresolved",
            method: "unique-successful-ci-run-for-main-run-head-sha",
            candidateRunIds: [],
          }
        : {
            status: "resolved",
            method: "validated-main-journal-release",
            candidateRunIds: [upstreamRunId],
          };
    if (upstreamRunId === null) {
      const candidateRuns = paginatedCollection(
        apiJson(
          dependencies,
          `repos/${OBSERVATION_REPOSITORY}/actions/workflows/ci.yml/runs?branch=main&event=push&status=success&head_sha=${currentRun.head_sha}&per_page=100`,
          "Candidate upstream CI runs",
          { paginate: true },
        ),
        "workflow_runs",
        "Candidate upstream CI runs",
      ).filter(
        (run) =>
          run.name === "CI/CD" &&
          workflowPath(run) === ".github/workflows/ci.yml" &&
          run.event === "push" &&
          run.head_branch === "main" &&
          run.status === "completed" &&
          run.conclusion === "success" &&
          run.head_sha === currentRun.head_sha &&
          Date.parse(run.updated_at) <= Date.parse(currentRun.created_at),
      );
      upstreamCorrelation = {
        status: candidateRuns.length === 1 ? "resolved" : "unresolved",
        method: "unique-successful-ci-run-for-main-run-head-sha",
        candidateRunIds: candidateRuns.map((run) => String(run.id)).sort(),
      };
      if (candidateRuns.length === 1) {
        upstreamRunId = String(candidateRuns[0].id);
        deploySha = exactSha(
          candidateRuns[0].head_sha,
          "Correlated deploy SHA",
        );
      }
    }
    assertMainDeployShaBinding(deploySha, currentRun.head_sha);
    const upstreamRun =
      upstreamRunId === null
        ? null
        : terminalRun(
            apiJson(
              dependencies,
              `repos/${OBSERVATION_REPOSITORY}/actions/runs/${upstreamRunId}`,
              "Upstream CI run",
            ),
            ".github/workflows/ci.yml",
            "Upstream CI run",
          );
    if (upstreamRun) {
      invariant(
        upstreamRun.name === "CI/CD" &&
          upstreamRun.event === "push" &&
          upstreamRun.head_branch === "main" &&
          upstreamRun.conclusion === "success" &&
          upstreamRun.head_sha === deploySha,
        "Upstream CI run conflicts with main journal release identity",
      );
    }

    const captures = [];
    for (const attemptData of attempts) {
      const attemptStage = join(stage, `attempt-${attemptData.attempt}`);
      ensureDirectory(attemptStage, root);
      writeRawJson(attemptStage, "raw/run.json", attemptData.run, root);
      writeRawJson(attemptStage, "raw/jobs.json", attemptData.jobs, root);
      writeRawJson(attemptStage, "raw/artifacts.json", artifacts, root);
      writeRawJson(attemptStage, "raw/upstream-ci-run.json", upstreamRun, root);
      writeRawText(attemptStage, "logs/run.log", attemptData.logs, root);
      const attemptJournals = downloadedJournals.filter(
        ({ journal }) => Number(journal.runAttempt) === attemptData.attempt,
      );
      for (const item of attemptJournals) {
        copyPrivateFile(
          join(item.directory, "main-journal.json"),
          join(
            attemptStage,
            "journals",
            item.artifact.name,
            "main-journal.json",
          ),
          root,
        );
      }
      const attemptHistories = histories.filter(
        (history) => history.runAttempt === attemptData.attempt,
      );
      const terminalRoute = deriveMainTerminalRoute({
        jobs: attemptData.jobs,
        journalHistories: attemptHistories,
      });
      const resultJobs = attemptData.jobs.filter(
        (job) => job.name === "Vercel Main Deployment",
      );
      const resultJob =
        resultJobs.length === 1
          ? {
              id: String(resultJobs[0].id),
              status: resultJobs[0].status,
              conclusion: resultJobs[0].conclusion,
            }
          : null;
      const resultJobComplete =
        resultJob !== null &&
        resultJob.status === "completed" &&
        TERMINAL_RUN_CONCLUSIONS.has(resultJob.conclusion);
      const jobDurationMilliseconds = attemptData.jobs.reduce((total, job) => {
        if (!job.started_at || !job.completed_at) return total;
        return (
          total + (Date.parse(job.completed_at) - Date.parse(job.started_at))
        );
      }, 0);
      const runnerLabels = [
        ...new Set(
          attemptData.jobs.flatMap((job) =>
            Array.isArray(job.labels) ? job.labels : [],
          ),
        ),
      ].sort();
      writeRawJson(
        attemptStage,
        "probes.json",
        {
          schema: "vercel-cost-main-provider-probes:v2",
          repository: OBSERVATION_REPOSITORY,
          runId: mainRunId,
          runAttempt: attemptData.attempt,
          deploySha,
          complete: false,
          publicRuntimeShaByTarget: null,
          activeDuplicateDeploymentCensus: null,
          legacyV2Health: null,
          reason:
            "provider and public-runtime probes are outside the credential-free gh collector boundary",
        },
        root,
      );
      const capture = {
        schema: MAIN_CAPTURE_SCHEMA,
        repository: OBSERVATION_REPOSITORY,
        runId: mainRunId,
        runAttempt: attemptData.attempt,
        capturedAtUtc: exactUtc(
          dependencies.now().toISOString(),
          "Main capture time",
        ),
        eventTimestampUtc: githubUtc(
          attemptData.run.created_at,
          "Main run event time",
        ),
        runCompletedAtUtc: githubUtc(
          attemptData.run.updated_at,
          "Main run completion time",
        ),
        conclusion: attemptData.run.conclusion,
        deploySha,
        upstreamRunId,
        canonicalDerivedFacts: {
          jobCount: attemptData.jobs.length,
          jobDurationMilliseconds,
          runnerLabels,
          journalHistories: attemptHistories,
          journalHistoriesValidated: true,
          terminalRoute,
          resultJob,
          upstreamCorrelation,
          terminalEvidenceV3: {
            schema: "vercel-main-terminal-evidence:v3",
            available: false,
            validated: false,
            reason:
              "GitHub REST does not expose job outputs or step-summary payloads",
          },
          githubEvidenceComplete:
            attemptData.run.status === "completed" &&
            upstreamCorrelation.status === "resolved",
          releaseTerminalEvidenceComplete:
            terminalRoute.complete && resultJobComplete,
        },
        unresolvedProviderFields: [
          "publicRuntimeShaByTarget",
          "activeDuplicateDeploymentCensus",
          "legacyV2Health",
          "vercelDeploymentCensus",
          "buildCpuMinutes",
        ],
        files: [],
      };
      capture.files = listPrivateFiles(attemptStage, root);
      sealCaptureDirectory(attemptStage, capture, root);
      captures.push(capture);
    }
    rmSync(downloadRoot, { recursive: true, force: true });
    const publishRun = terminalRun(
      apiJson(
        dependencies,
        `repos/${OBSERVATION_REPOSITORY}/actions/runs/${mainRunId}`,
        "Main deployment run publish recheck",
      ),
      MAIN_WORKFLOW_PATH,
      "Main deployment run publish recheck",
    );
    invariant(
      Number(publishRun.run_attempt) === currentAttempt &&
        publishRun.head_sha === currentRun.head_sha &&
        publishRun.conclusion === currentRun.conclusion &&
        publishRun.updated_at === currentRun.updated_at,
      "Main deployment run changed before capture publication; retry",
    );
    ensureDirectory(mainRoot, root);
    for (
      let attempt = firstMissingAttempt;
      attempt <= currentAttempt;
      attempt += 1
    ) {
      const destination = join(mainRoot, `attempt-${attempt}`);
      invariant(
        !existsSync(destination),
        "Main attempt capture appeared concurrently",
      );
      renameSync(join(stage, `attempt-${attempt}`), destination);
      fsyncDirectory(mainRoot);
      fsyncDirectory(stage);
      assertPrivateDirectory(destination, root, "Published main attempt");
    }
    rmSync(stage, { recursive: true, force: true });
    fsyncDirectory(root);
    return [...existingCaptures, ...captures];
  });
}

function relevantWorkflowRuns(allRuns) {
  return allRuns.filter((run) =>
    OBSERVED_WORKFLOW_PATHS.has(workflowPath(run)),
  );
}

function compactRun(run) {
  return {
    id: positiveId(run.id, "Workflow run ID"),
    runAttempt: Number(positiveId(run.run_attempt, "Workflow run attempt")),
    path: workflowPath(run),
    event: run.event,
    status: run.status,
    conclusion: run.conclusion,
    createdAtUtc: githubUtc(run.created_at, "Workflow run creation time"),
    updatedAtUtc: githubUtc(run.updated_at, "Workflow run update time"),
    headSha:
      typeof run.head_sha === "string" && SHA_PATTERN.test(run.head_sha)
        ? run.head_sha
        : null,
    headBranch: run.head_branch ?? null,
    displayTitle: run.display_title ?? null,
    htmlUrl: run.html_url,
  };
}

function queryWorkflowRunShard(
  dependencies,
  workflowPathValue,
  startUtc,
  endUtcExclusive,
) {
  invariant(
    Date.parse(startUtc) < Date.parse(endUtcExclusive),
    "Workflow run shard must be non-empty",
  );
  const inclusiveEnd = new Date(Date.parse(endUtcExclusive) - 1).toISOString();
  const createdQuery = encodeURIComponent(`${startUtc}..${inclusiveEnd}`);
  const workflow = basename(workflowPathValue);
  const pages = apiJson(
    dependencies,
    `repos/${OBSERVATION_REPOSITORY}/actions/workflows/${workflow}/runs?per_page=100&created=${createdQuery}`,
    "Observation workflow run shard",
    { paginate: true },
  );
  invariant(
    Array.isArray(pages) && pages.length > 0,
    "Observation workflow run shard pagination is malformed",
  );
  const counts = new Set(
    pages.map((page) => {
      plainObject(page, "Observation workflow run shard page");
      invariant(
        Number.isSafeInteger(page.total_count) && page.total_count >= 0,
        "Observation workflow run shard total_count is missing",
      );
      return page.total_count;
    }),
  );
  invariant(
    counts.size === 1,
    "Observation workflow run shard total_count conflicts",
  );
  const totalCount = [...counts][0];
  const runs = paginatedCollection(
    pages,
    "workflow_runs",
    "Observation workflow run shard",
  );
  if (totalCount <= 1_000) {
    invariant(
      runs.length === totalCount,
      "Observation workflow run shard is truncated",
    );
  }
  return { totalCount, runs };
}

function utcShards(startUtc, endUtcExclusive, sizeMilliseconds) {
  const shards = [];
  for (
    let cursor = Date.parse(startUtc);
    cursor < Date.parse(endUtcExclusive);
    cursor += sizeMilliseconds
  ) {
    shards.push({
      startUtc: new Date(cursor).toISOString(),
      endUtcExclusive: new Date(
        Math.min(cursor + sizeMilliseconds, Date.parse(endUtcExclusive)),
      ).toISOString(),
    });
  }
  return shards;
}

function collectWorkflowRuns(dependencies, range) {
  const start = Date.parse(range.startUtc);
  const end = Date.parse(range.endUtcExclusive);
  invariant(
    Number.isFinite(start) && Number.isFinite(end) && start <= end,
    "Observation workflow run collection range is invalid or inverted",
  );
  if (start === end) return [];
  const byId = new Map();
  const addRun = (rawRun, expectedPath, shard) => {
    const run = compactRun(rawRun);
    invariant(
      run.path === expectedPath,
      "Observation workflow run belongs to another workflow",
    );
    if (
      Date.parse(run.createdAtUtc) < Date.parse(range.startUtc) ||
      Date.parse(run.createdAtUtc) >= Date.parse(range.endUtcExclusive)
    ) {
      return;
    }
    invariant(
      Date.parse(run.createdAtUtc) >= Date.parse(shard.startUtc) &&
        Date.parse(run.createdAtUtc) < Date.parse(shard.endUtcExclusive) &&
        Date.parse(run.createdAtUtc) < Date.parse(range.endUtcExclusive),
      "Observation workflow run falls outside its half-open shard",
    );
    const prior = byId.get(run.id);
    invariant(
      prior === undefined || canonicalJson(prior) === canonicalJson(run),
      "Observation workflow run identity conflicts across shards",
    );
    byId.set(run.id, run);
  };
  for (const workflowPathValue of OBSERVED_WORKFLOW_PATHS) {
    for (const day of utcShards(
      range.startUtc,
      range.endUtcExclusive,
      24 * 60 * 60 * 1_000,
    )) {
      const daily = queryWorkflowRunShard(
        dependencies,
        workflowPathValue,
        day.startUtc,
        day.endUtcExclusive,
      );
      if (daily.totalCount <= 1_000) {
        for (const run of daily.runs) {
          addRun(run, workflowPathValue, day);
        }
        continue;
      }
      let hourlyTotalCount = 0;
      for (const hour of utcShards(
        day.startUtc,
        day.endUtcExclusive,
        60 * 60 * 1_000,
      )) {
        const hourly = queryWorkflowRunShard(
          dependencies,
          workflowPathValue,
          hour.startUtc,
          hour.endUtcExclusive,
        );
        invariant(
          hourly.totalCount <= 1_000,
          "Observation workflow hourly shard exceeds GitHub's 1,000-run cap",
        );
        hourlyTotalCount += hourly.totalCount;
        for (const run of hourly.runs) {
          addRun(run, workflowPathValue, hour);
        }
      }
      invariant(
        hourlyTotalCount === daily.totalCount,
        "Observation workflow hourly shards do not reconcile to the daily total",
      );
    }
  }
  return [...byId.values()].sort(
    (left, right) =>
      Date.parse(left.createdAtUtc) - Date.parse(right.createdAtUtc) ||
      Number(left.id) - Number(right.id),
  );
}

function exactUniqueIds(values, label) {
  invariant(Array.isArray(values), `${label} must be an array`);
  const ids = values.map((value) => positiveId(value, label));
  invariant(
    new Set(ids).size === ids.length,
    `${label} must not contain duplicate IDs`,
  );
  return ids.sort();
}

function exactIdSet(values, expected, label) {
  invariant(
    canonicalJson(exactUniqueIds(values, label)) ===
      canonicalJson(exactUniqueIds(expected, `${label} expected`)),
    `${label} does not match the expected IDs`,
  );
}

export function assertTerminalSampleCoverage({
  sample,
  startBoundary,
  interval,
  requiredWorkflowPaths,
}) {
  plainObject(sample, "Terminal GitHub sample");
  plainObject(startBoundary, "Terminal sample start boundary");
  plainObject(interval, "Terminal sample interval");
  const coverage = plainObject(
    sample.startBoundaryRunCoverage,
    "Terminal sample boundary coverage",
  );
  invariant(
    coverage.schema === START_BOUNDARY_RUN_COVERAGE_SCHEMA &&
      coverage.complete === true &&
      coverage.recordedAtUtc === startBoundary.recordedAtUtc &&
      coverage.startUtc === interval.startUtc,
    "Terminal sample boundary coverage conflicts",
  );
  const initialIds = startBoundary.inFlightRuns.map((run) => run.id);
  exactIdSet(
    coverage.initialInFlightRunIds,
    initialIds,
    "Terminal sample initial in-flight IDs",
  );
  const discoveredIds = exactUniqueIds(
    coverage.discoveredPreStartRunIds,
    "Terminal sample discovered pre-start IDs",
  );
  const trackedIds = exactUniqueIds(
    coverage.trackedRunIds,
    "Terminal sample tracked boundary IDs",
  );
  exactIdSet(
    trackedIds,
    [...new Set([...initialIds, ...discoveredIds])],
    "Terminal sample tracked boundary IDs",
  );
  invariant(
    Array.isArray(sample.startBoundaryRunStates),
    "Terminal sample boundary run states must be an array",
  );
  const stateIds = exactUniqueIds(
    sample.startBoundaryRunStates.map((run) => {
      plainObject(run, "Terminal sample boundary run state");
      invariant(
        Date.parse(exactUtc(run.createdAtUtc, "Boundary run creation time")) <
          Date.parse(interval.startUtc),
        "Terminal sample boundary run was not created before the start",
      );
      return run.id;
    }),
    "Terminal sample boundary run state IDs",
  );
  exactIdSet(
    trackedIds,
    stateIds,
    "Terminal sample tracked boundary state IDs",
  );
  const runJobCoverage = plainObject(
    sample.runJobCoverage,
    "Terminal sample run/job coverage",
  );
  const expectedWorkflowPaths = [...requiredWorkflowPaths].sort();
  const expectedCompleteDays = utcShards(
    interval.startUtc,
    interval.endUtcExclusive,
    24 * 60 * 60 * 1_000,
  ).map((day) => day.startUtc);
  invariant(
    runJobCoverage.schema === "vercel-cost-github-run-job-coverage:v2" &&
      runJobCoverage.complete === true &&
      runJobCoverage.startUtc === interval.startUtc &&
      runJobCoverage.endUtcExclusive === interval.endUtcExclusive &&
      canonicalJson(runJobCoverage.workflowPaths) ===
        canonicalJson(expectedWorkflowPaths) &&
      canonicalJson(runJobCoverage.completeUtcDayStarts) ===
        canonicalJson(expectedCompleteDays),
    "Terminal sample run/job coverage conflicts",
  );
}

export function selectLatestTerminalSample(samples, endUtcExclusive) {
  const terminalSamples = samples.filter(
    (sample) =>
      sample.schema === GITHUB_SAMPLE_SCHEMA &&
      Date.parse(sample.capturedAtUtc) >= Date.parse(endUtcExclusive) &&
      sample.sampledThroughUtc === endUtcExclusive &&
      sample.runJobCoverage?.schema ===
        "vercel-cost-github-run-job-coverage:v2" &&
      sample.runJobCoverage.complete === true &&
      sample.runJobCoverage.endUtcExclusive === endUtcExclusive,
  );
  return {
    terminalSamples,
    latestSample: [...terminalSamples].sort(
      (left, right) =>
        Date.parse(right.capturedAtUtc) - Date.parse(left.capturedAtUtc),
    )[0],
  };
}

function discoveredPreStartControllerPrs(sample) {
  const discoveredIds = new Set(
    sample.startBoundaryRunCoverage.discoveredPreStartRunIds.map(String),
  );
  const prs = new Set();
  for (const run of sample.startBoundaryRunStates) {
    if (
      !discoveredIds.has(String(run.id)) ||
      run.path !== ".github/workflows/vercel-preview-controller.yml" ||
      run.event !== "pull_request_target"
    ) {
      continue;
    }
    const match = String(run.displayTitle ?? "").match(
      /^Vercel preview controller event \| id=[1-9][0-9]* \| number=[1-9][0-9]* \| pr=([1-9][0-9]{0,9}) \| sha=[0-9a-f]{40} \| before=(?:none|[0-9a-f]{40}) \| action=(opened|synchronize) \| receipt=true$/,
    );
    if (match) prs.add(Number(match[1]));
  }
  return prs;
}

function sampleGithub({ root, dependencies }) {
  const interval = readInterval(root);
  const startBoundary = readPrivateJson(
    join(root, "boundary", "start.json"),
    root,
    "Observation start boundary",
  );
  invariant(
    startBoundary.schema === "vercel-cost-observation-boundary:v2" &&
      startBoundary.timestampUtc === interval.startUtc,
    "Observation start boundary conflicts with the interval",
  );
  const capturedAtUtc = exactUtc(
    dependencies.now().toISOString(),
    "GitHub sample time",
  );
  invariant(
    Date.parse(capturedAtUtc) >= Date.parse(interval.startUtc),
    "GitHub sampling cannot precede the observation interval",
  );
  const sampledThroughUtc =
    Date.parse(capturedAtUtc) < Date.parse(interval.endUtcExclusive)
      ? capturedAtUtc
      : interval.endUtcExclusive;
  const timestampName = capturedAtUtc.replaceAll(":", "-");
  const destination = join(root, "samples", timestampName);
  const repository = apiJson(
    dependencies,
    `repos/${OBSERVATION_REPOSITORY}`,
    "Repository visibility",
  );
  const boundaryDiscoveryRuns = collectWorkflowRuns(dependencies, {
    startUtc: startBoundary.recordedAtUtc,
    endUtcExclusive: interval.startUtc,
  });
  const trackedStartBoundaryRuns = new Map(
    startBoundary.inFlightRuns.map((run) => [String(run.id), run]),
  );
  for (const run of boundaryDiscoveryRuns) {
    const prior = trackedStartBoundaryRuns.get(String(run.id));
    if (prior) {
      invariant(
        prior.id === run.id &&
          prior.path === run.path &&
          prior.createdAtUtc === run.createdAtUtc &&
          prior.headSha === run.headSha,
        "Start-boundary workflow run identity conflicts across discovery sources",
      );
      continue;
    }
    trackedStartBoundaryRuns.set(String(run.id), run);
  }
  const startBoundaryRunStates = [...trackedStartBoundaryRuns.values()]
    .sort((left, right) => Number(left.id) - Number(right.id))
    .map((initialRun) => {
      const current = compactRun(
        apiJson(
          dependencies,
          `repos/${OBSERVATION_REPOSITORY}/actions/runs/${initialRun.id}`,
          "Start-boundary workflow run",
        ),
      );
      invariant(
        current.id === initialRun.id &&
          current.path === initialRun.path &&
          current.createdAtUtc === initialRun.createdAtUtc &&
          current.headSha === initialRun.headSha,
        "Start-boundary workflow run identity changed",
      );
      return current;
    });
  const relevantRuns = collectWorkflowRuns(dependencies, {
    startUtc: interval.startUtc,
    endUtcExclusive: sampledThroughUtc,
  });
  const jobs = [];
  for (const run of relevantRuns) {
    const runJobs = paginatedCollection(
      apiJson(
        dependencies,
        `repos/${OBSERVATION_REPOSITORY}/actions/runs/${run.id}/jobs?filter=all&per_page=100`,
        "Observation run jobs",
        { paginate: true },
      ),
      "jobs",
      "Observation run jobs",
    );
    for (const job of runJobs) {
      jobs.push({
        runId: String(run.id),
        runAttempt: Number(job.run_attempt ?? run.runAttempt),
        jobId: String(job.id),
        name: job.name,
        status: job.status,
        conclusion: job.conclusion,
        labels: Array.isArray(job.labels) ? [...job.labels].sort() : [],
        startedAtUtc: job.started_at,
        completedAtUtc: job.completed_at,
      });
    }
  }
  const caches = paginatedCollection(
    apiJson(
      dependencies,
      `repos/${OBSERVATION_REPOSITORY}/actions/caches?per_page=100`,
      "Actions caches",
      { paginate: true },
    ),
    "actions_caches",
    "Actions caches",
  );
  const artifacts = paginatedCollection(
    apiJson(
      dependencies,
      `repos/${OBSERVATION_REPOSITORY}/actions/artifacts?per_page=100`,
      "Actions artifacts",
      { paginate: true },
    ),
    "artifacts",
    "Actions artifacts",
  );
  const sample = {
    schema: GITHUB_SAMPLE_SCHEMA,
    repository: OBSERVATION_REPOSITORY,
    capturedAtUtc,
    sampledThroughUtc,
    repositoryVisibility: {
      private: repository.private,
      visibility: repository.visibility,
      publicAtSample:
        repository.private === false && repository.visibility === "public",
    },
    runJobCoverage: {
      schema: "vercel-cost-github-run-job-coverage:v2",
      startUtc: interval.startUtc,
      endUtcExclusive: sampledThroughUtc,
      completeUtcDayStarts: utcShards(
        interval.startUtc,
        sampledThroughUtc,
        24 * 60 * 60 * 1_000,
      )
        .filter(
          (shard) =>
            Date.parse(shard.endUtcExclusive) - Date.parse(shard.startUtc) ===
            24 * 60 * 60 * 1_000,
        )
        .map((shard) => shard.startUtc),
      workflowPaths: [...OBSERVED_WORKFLOW_PATHS].sort(),
      complete: true,
    },
    startBoundaryRunCoverage: {
      schema: START_BOUNDARY_RUN_COVERAGE_SCHEMA,
      recordedAtUtc: startBoundary.recordedAtUtc,
      startUtc: interval.startUtc,
      complete: true,
      initialInFlightRunIds: startBoundary.inFlightRuns
        .map((run) => String(run.id))
        .sort(),
      discoveredPreStartRunIds: boundaryDiscoveryRuns
        .map((run) => String(run.id))
        .sort(),
      trackedRunIds: [...trackedStartBoundaryRuns.keys()].sort(),
    },
    startBoundaryRunStates,
    workflowRuns: relevantRuns,
    pendingRunIds: relevantRuns
      .filter((run) => run.status !== "completed")
      .map((run) => String(run.id)),
    runnerJobs: jobs,
    cacheSnapshot: {
      entryCount: caches.length,
      totalBytes: caches.reduce(
        (total, cache) => total + Number(cache.size_in_bytes ?? 0),
        0,
      ),
      entries: caches.map((cache) => ({
        id: String(cache.id),
        ref: cache.ref,
        key: cache.key,
        sizeBytes: Number(cache.size_in_bytes),
        createdAtUtc: cache.created_at,
        lastAccessedAtUtc: cache.last_accessed_at,
      })),
    },
    artifactSnapshot: {
      entryCount: artifacts.length,
      totalBytes: artifacts.reduce(
        (total, artifact) => total + Number(artifact.size_in_bytes ?? 0),
        0,
      ),
      entries: artifacts.map((artifact) => ({
        id: String(artifact.id),
        name: artifact.name,
        sizeBytes: Number(artifact.size_in_bytes),
        expired: artifact.expired,
        createdAtUtc: artifact.created_at,
        expiresAtUtc: artifact.expires_at,
        workflowRunId: String(artifact.workflow_run?.id ?? ""),
      })),
    },
    authoritativeBillingFieldsResolved: false,
    files: [],
  };
  if (existsSync(destination)) {
    const existing = verifyCaptureDirectory(
      destination,
      root,
      GITHUB_SAMPLE_SCHEMA,
      { capturedAtUtc },
    );
    invariant(
      canonicalJson(existing) === canonicalJson(sample),
      "Existing GitHub sample conflicts",
    );
    return existing;
  }
  return stageCapture(root, `sample-${timestampName}`, (stage) =>
    publishCapture({ root, stage, destination, capture: sample }),
  );
}

function directories(path, root) {
  if (!existsSync(path)) return [];
  assertPrivateDirectory(path, root, "Observation collection directory");
  return readdirSync(path)
    .map((name) => {
      const candidate = join(path, name);
      const stats = lstatSync(candidate);
      invariant(
        stats.isDirectory() && !stats.isSymbolicLink(),
        "Observation collection accepts only directories",
      );
      return name;
    })
    .sort();
}

function auditObservation({ root, end, now }) {
  const interval = readInterval(root);
  const startBoundary = readPrivateJson(
    join(root, "boundary", "start.json"),
    root,
    "Observation start boundary",
  );
  invariant(
    startBoundary.schema === "vercel-cost-observation-boundary:v2" &&
      startBoundary.timestampUtc === interval.startUtc,
    "Observation start boundary conflicts with the interval",
  );
  const endUtcExclusive = utcBoundary(end, "Audit end");
  invariant(
    endUtcExclusive === interval.endUtcExclusive,
    "Audit end conflicts with the initialized interval",
  );
  const generatedAtUtc = exactUtc(now().toISOString(), "Audit generation time");
  invariant(
    Date.parse(generatedAtUtc) >= Date.parse(endUtcExclusive),
    "Observation audit cannot run before the interval ends",
  );
  const auditPath = join(root, "audit.json");
  const fragmentPath = join(
    root,
    "analyzer-postcutover-fragment.incomplete.json",
  );
  invariant(
    !existsSync(auditPath),
    "Observation audit already exists; append-only evidence cannot be replaced",
  );
  recoverStaleCaptureStages(root);
  const previewCaptures = directories(join(root, "preview"), root).map((name) =>
    verifyCaptureDirectory(
      join(root, "preview", name),
      root,
      PREVIEW_CAPTURE_SCHEMA,
      { eventRunId: name },
    ),
  );
  const mainCaptures = [];
  for (const runId of directories(join(root, "main"), root)) {
    for (const attemptName of directories(join(root, "main", runId), root)) {
      const match = /^attempt-([1-9][0-9]*)$/.exec(attemptName);
      invariant(match, "Main attempt directory name is malformed");
      mainCaptures.push(
        verifyCaptureDirectory(
          join(root, "main", runId, attemptName),
          root,
          MAIN_CAPTURE_SCHEMA,
          { runId, runAttempt: Number(match[1]) },
        ),
      );
    }
  }
  const sampleRoot = join(root, "samples");
  const samples = directories(sampleRoot, root).map((name) =>
    verifyCaptureDirectory(
      join(sampleRoot, name),
      root,
      GITHUB_SAMPLE_SCHEMA,
      {},
    ),
  );
  const requiredWorkflowPaths = [...OBSERVED_WORKFLOW_PATHS].sort();
  const { terminalSamples, latestSample } = selectLatestTerminalSample(
    samples,
    endUtcExclusive,
  );
  if (latestSample) {
    assertTerminalSampleCoverage({
      sample: latestSample,
      startBoundary,
      interval,
      requiredWorkflowPaths,
    });
  }
  const gaps = [];
  const observationDays = utcShards(
    interval.startUtc,
    endUtcExclusive,
    24 * 60 * 60 * 1_000,
  );
  const missingGithubRunJobCoverageDays = observationDays
    .filter(
      (day) =>
        !samples.some((sample) => {
          const coverage = sample.runJobCoverage;
          return (
            sample.schema === GITHUB_SAMPLE_SCHEMA &&
            coverage?.schema === "vercel-cost-github-run-job-coverage:v2" &&
            coverage.complete === true &&
            coverage.startUtc === interval.startUtc &&
            Date.parse(coverage.endUtcExclusive) >=
              Date.parse(day.endUtcExclusive) &&
            JSON.stringify(coverage.workflowPaths) ===
              JSON.stringify(requiredWorkflowPaths) &&
            coverage.completeUtcDayStarts?.includes(day.startUtc)
          );
        }),
    )
    .map((day) => day.startUtc.slice(0, 10));
  if (!latestSample) {
    gaps.push("missing-terminal-github-sample");
  }
  if (missingGithubRunJobCoverageDays.length > 0) {
    gaps.push("missing-github-run-job-coverage-days");
  }
  const startBoundaryStraddlerIds = (latestSample?.startBoundaryRunStates ?? [])
    .filter(
      (run) =>
        Date.parse(run.createdAtUtc) < Date.parse(interval.startUtc) &&
        (run.status !== "completed" ||
          Date.parse(run.updatedAtUtc) >= Date.parse(interval.startUtc)),
    )
    .map((run) => `run:${run.id}`)
    .sort();
  if (startBoundaryStraddlerIds.length > 0) {
    gaps.push("start-boundary-work-not-drained");
  }
  const endBoundaryStraddlerIds = new Set();
  for (const run of latestSample?.workflowRuns ?? []) {
    if (
      withinInterval(run.createdAtUtc, interval) &&
      (run.status !== "completed" ||
        Date.parse(run.updatedAtUtc) >= Date.parse(endUtcExclusive))
    ) {
      endBoundaryStraddlerIds.add(`run:${run.id}`);
    }
  }
  for (const job of latestSample?.runnerJobs ?? []) {
    if (
      job.startedAtUtc &&
      Date.parse(job.startedAtUtc) < Date.parse(endUtcExclusive) &&
      (!job.completedAtUtc ||
        Date.parse(job.completedAtUtc) >= Date.parse(endUtcExclusive))
    ) {
      endBoundaryStraddlerIds.add(`job:${job.jobId}`);
    }
  }
  for (const capture of previewCaptures) {
    if (
      Date.parse(
        capture.canonicalDerivedFacts.finalSentinel?.updatedAtUtc ?? 0,
      ) >= Date.parse(endUtcExclusive)
    ) {
      endBoundaryStraddlerIds.add(`preview-event:${capture.eventRunId}`);
    }
    for (const workerRun of [
      ...capture.canonicalDerivedFacts.capturedWorkers,
      ...capture.canonicalDerivedFacts.capturedControllerSyntheticRuns,
    ]) {
      if (Date.parse(workerRun.completedAtUtc) >= Date.parse(endUtcExclusive)) {
        endBoundaryStraddlerIds.add(`run:${workerRun.runId}`);
      }
    }
    for (const status of capture.canonicalDerivedFacts
      .githubDeploymentTerminalStatuses) {
      if (Date.parse(status.createdAtUtc) >= Date.parse(endUtcExclusive)) {
        endBoundaryStraddlerIds.add(`deployment-status:${status.statusId}`);
      }
    }
  }
  for (const capture of mainCaptures) {
    if (Date.parse(capture.runCompletedAtUtc) >= Date.parse(endUtcExclusive)) {
      endBoundaryStraddlerIds.add(
        `main-run:${capture.runId}:attempt-${capture.runAttempt}`,
      );
    }
  }
  const sortedEndBoundaryStraddlerIds = [...endBoundaryStraddlerIds].sort();
  if (sortedEndBoundaryStraddlerIds.length > 0) {
    gaps.push("end-boundary-work-not-drained");
  }
  const inventoryRuns = latestSample?.workflowRuns ?? [];
  const requiredPreviewRunIds = inventoryRuns
    .filter((run) => {
      if (
        run.path !== ".github/workflows/vercel-preview-controller.yml" ||
        run.event !== "pull_request_target"
      ) {
        return false;
      }
      const title = String(run.displayTitle ?? "");
      return (
        /\| action=(opened|synchronize) \| receipt=true$/.test(title) &&
        withinInterval(run.createdAtUtc, interval)
      );
    })
    .map((run) => run.id);
  const requiredMainRunIds = inventoryRuns
    .filter(
      (run) =>
        run.path === MAIN_WORKFLOW_PATH &&
        run.event === "workflow_run" &&
        withinInterval(run.createdAtUtc, interval),
    )
    .map((run) => run.id);
  const previewByRun = new Map(
    previewCaptures.map((capture) => [capture.eventRunId, capture]),
  );
  const mainAttemptsByRun = new Map();
  for (const capture of mainCaptures) {
    const attempts = mainAttemptsByRun.get(capture.runId) ?? [];
    attempts.push(capture);
    mainAttemptsByRun.set(capture.runId, attempts);
  }
  const missingPreviewRunIds = requiredPreviewRunIds.filter(
    (runId) => !previewByRun.has(runId),
  );
  const missingMainRunIds = requiredMainRunIds.filter(
    (runId) => !mainAttemptsByRun.has(runId),
  );
  const incompleteMainAttemptRunIds = inventoryRuns
    .filter((run) => requiredMainRunIds.includes(run.id))
    .filter((run) => {
      const attempts = [...(mainAttemptsByRun.get(run.id) ?? [])]
        .map((capture) => capture.runAttempt)
        .sort((left, right) => left - right);
      return (
        attempts.length !== run.runAttempt ||
        attempts.some((attempt, index) => attempt !== index + 1)
      );
    })
    .map((run) => run.id);
  const mainAttemptTerminalAnomalies = mainCaptures
    .filter(
      (capture) =>
        !capture.canonicalDerivedFacts.releaseTerminalEvidenceComplete,
    )
    .map((capture) => ({
      runId: capture.runId,
      runAttempt: capture.runAttempt,
      conclusion: capture.conclusion,
      terminalRouteReason:
        capture.canonicalDerivedFacts.terminalRoute.reason ?? null,
    }));
  if (missingPreviewRunIds.length > 0) gaps.push("missing-preview-captures");
  if (missingMainRunIds.length > 0) gaps.push("missing-main-captures");
  if (incompleteMainAttemptRunIds.length > 0) {
    gaps.push("incomplete-main-attempt-captures");
  }
  if (
    previewCaptures.some(
      (capture) => !capture.canonicalDerivedFacts.evidenceComplete,
    )
  ) {
    gaps.push("incomplete-preview-evidence");
  }
  if (
    mainCaptures.some(
      (capture) => !capture.canonicalDerivedFacts.githubEvidenceComplete,
    )
  ) {
    gaps.push("incomplete-main-github-evidence");
  }
  const relevantJobs = latestSample?.runnerJobs ?? [];
  const unknownRunnerJobs = relevantJobs
    .filter(
      (job) =>
        (job.startedAtUtc || job.completedAtUtc) &&
        (job.labels.length === 0 ||
          !job.labels.some((label) => STANDARD_RUNNER_LABELS.has(label))),
    )
    .map((job) => job.jobId);
  if (unknownRunnerJobs.length > 0) gaps.push("unknown-runner-labels");
  if (
    samples.length === 0 ||
    samples.some((sample) => !sample.repositoryVisibility?.publicAtSample)
  ) {
    gaps.push("repository-visibility-sample-incomplete");
  }
  const eligiblePreviewCaptures = previewCaptures.filter(
    (capture) => capture.canonicalDerivedFacts.eligibleTrustedDeployedCodePush,
  );
  const capturesByPr = new Map();
  for (const capture of previewCaptures) {
    const values = capturesByPr.get(capture.pr) ?? [];
    values.push(capture);
    capturesByPr.set(capture.pr, values);
  }
  for (const values of capturesByPr.values()) {
    values.sort(
      (left, right) =>
        Date.parse(left.eventTimestampUtc) -
          Date.parse(right.eventTimestampUtc) ||
        Number(left.eventRunId) - Number(right.eventRunId),
    );
  }
  const boundaryOpenPrs = new Map(
    startBoundary.openPullRequestJournals.map((entry) => [entry.pr, entry]),
  );
  const preStartControllerPrs = latestSample
    ? discoveredPreStartControllerPrs(latestSample)
    : new Set();
  const firstPreviewOpportunities = [];
  const ambiguousFirstOpportunityPrs = [];
  const excludedCarriedOpenPrs = [];
  for (const [pr, captures] of capturesByPr) {
    const firstEligible = captures.find(
      (capture) =>
        capture.canonicalDerivedFacts.eligibleTrustedDeployedCodePush,
    );
    if (!firstEligible) continue;
    const boundaryEntry = boundaryOpenPrs.get(pr);
    if (boundaryEntry && preStartControllerPrs.has(pr)) {
      excludedCarriedOpenPrs.push({
        pr,
        reason: "pre-start-controller-receipt-proves-post-snapshot-activity",
      });
      ambiguousFirstOpportunityPrs.push(pr);
      continue;
    }
    if (
      boundaryEntry &&
      boundaryEntry.preBoundaryEligiblePushEvidence !== "none"
    ) {
      excludedCarriedOpenPrs.push({
        pr,
        reason:
          boundaryEntry.preBoundaryEligiblePushEvidence === "present"
            ? "eligible-push-existed-before-window"
            : "boundary-cannot-prove-no-eligible-push",
      });
      if (boundaryEntry.preBoundaryEligiblePushEvidence === "unknown") {
        ambiguousFirstOpportunityPrs.push(pr);
      }
      continue;
    }
    if (
      boundaryEntry &&
      (firstEligible.eventAction !== "synchronize" ||
        firstEligible.beforeSha !== boundaryEntry.headSha)
    ) {
      excludedCarriedOpenPrs.push({
        pr,
        reason:
          firstEligible.eventAction === "synchronize"
            ? "boundary-head-does-not-match-first-synchronize-before-sha"
            : "first-eligible-event-after-boundary-is-not-synchronize",
      });
      ambiguousFirstOpportunityPrs.push(pr);
      continue;
    }
    const eventsBefore = captures.filter(
      (capture) =>
        Date.parse(capture.eventTimestampUtc) <
          Date.parse(firstEligible.eventTimestampUtc) ||
        (capture.eventTimestampUtc === firstEligible.eventTimestampUtc &&
          Number(capture.eventRunId) < Number(firstEligible.eventRunId)),
    );
    const lifecycleKnown =
      firstEligible.eventAction === "opened" ||
      boundaryEntry?.preBoundaryEligiblePushEvidence === "none" ||
      eventsBefore.some((capture) => capture.eventAction === "opened");
    if (!lifecycleKnown) ambiguousFirstOpportunityPrs.push(pr);
    firstPreviewOpportunities.push({
      pr,
      eventRunId: firstEligible.eventRunId,
      eventAction: firstEligible.eventAction,
      carriedOpenAtBoundary: boundaryEntry !== undefined,
      carriedBoundaryHeadProof: boundaryEntry !== undefined,
      lifecycleKnown,
      passed:
        firstEligible.canonicalDerivedFacts.statusDecision?.state === "success",
    });
  }
  if (ambiguousFirstOpportunityPrs.length > 0) {
    gaps.push("ambiguous-first-preview-opportunities");
  }
  const eligibleFirstPreviewOpportunities = firstPreviewOpportunities.length;
  const eligibleFirstPreviews = firstPreviewOpportunities.filter(
    (opportunity) => opportunity.passed,
  ).length;
  if (eligiblePreviewCaptures.length < 10) {
    gaps.push("fewer-than-ten-trusted-deployed-code-pr-pushes");
  }
  if (eligibleFirstPreviewOpportunities === 0) {
    gaps.push("missing-first-preview-opportunity");
  }
  const preflightGaps = [...new Set(gaps)].sort();
  invariant(
    preflightGaps.length === 0,
    `Observation audit preflight gaps: ${preflightGaps.join(", ")}`,
  );
  const intervalDays =
    (Date.parse(endUtcExclusive) - Date.parse(interval.startUtc)) /
    (24 * 60 * 60 * 1000);
  const unresolved = [
    "cutoverProvenance",
    "providerDeploymentCensus",
    "vercelFocusBilling",
    "githubAuthoritativeRunnerMinutes",
    "githubArtifactAndCacheGbHours",
    "repositoryPublicForEntireInterval",
    "mainTerminalEvidenceV3",
    "mainPublicRuntimeAndLegacyV2Probes",
    "burstFirstPlusLatestExercise",
    "rollbackProcedureVerification",
  ];
  gaps.push("manual-provider-and-closeout-evidence-unresolved");
  const uniqueGaps = [...new Set(gaps)].sort();
  const audit = {
    schema: OBSERVATION_AUDIT_SCHEMA,
    repository: OBSERVATION_REPOSITORY,
    startUtc: interval.startUtc,
    endUtcExclusive,
    generatedAtUtc,
    completeUtcDays: intervalDays,
    inventory: {
      terminalGithubSampleCount: terminalSamples.length,
      supersededTerminalGithubSampleCapturedAtUtc: terminalSamples
        .filter((sample) => sample !== latestSample)
        .map((sample) => sample.capturedAtUtc)
        .sort(),
      missingGithubRunJobCoverageDays,
      startBoundaryStraddlerIds,
      startBoundaryRunStates: latestSample?.startBoundaryRunStates ?? [],
      endBoundaryStraddlerIds: sortedEndBoundaryStraddlerIds,
      requiredPreviewRunIds,
      capturedPreviewRunIds: previewCaptures.map(
        (capture) => capture.eventRunId,
      ),
      missingPreviewRunIds,
      requiredMainRunIds,
      capturedMainRunIds: [...mainAttemptsByRun.keys()],
      missingMainRunIds,
      incompleteMainAttemptRunIds,
      mainAttemptTerminalAnomalies,
      capturedMainAttemptCount: mainCaptures.length,
    },
    derived: {
      trustedDeployedCodePrPushes: eligiblePreviewCaptures.length,
      eligibleFirstPreviewOpportunities,
      eligibleFirstPreviews,
      firstPreviewOpportunities,
      ambiguousFirstOpportunityPrs,
      excludedCarriedOpenPrs,
      allSampledRepositoryVisibilityPublic:
        samples.length > 0 &&
        samples.every((sample) => sample.repositoryVisibility?.publicAtSample),
      observedUnknownRunnerJobIds: unknownRunnerJobs,
      mainAttemptTerminalAnomalyCount: mainAttemptTerminalAnomalies.length,
    },
    unresolved,
    gaps: uniqueGaps,
    analyzerFragmentComplete: false,
    pass: false,
  };
  const fragment = {
    schema: ANALYZER_FRAGMENT_SCHEMA,
    repository: OBSERVATION_REPOSITORY,
    period: {
      startUtc: interval.startUtc,
      endUtcExclusive,
      billingIngestionComplete: null,
      invoiceFinal: null,
    },
    trustedDeployedCodePrPushes: eligiblePreviewCaptures.length,
    eligibleFirstPreviewOpportunities,
    eligibleFirstPreviews,
    smokeOrE2eCheckOpportunities: null,
    smokeOrE2eChecksCompleted: null,
    burstFirstPlusLatestCheckOpportunities: null,
    burstFirstPlusLatestChecksCompleted: null,
    mainDeploymentObservationsCompleted: null,
    mainDeploymentObservationFailures: null,
    legacyV2HealthCheckOpportunities: null,
    legacyV2HealthChecksCompleted: null,
    standardRunnerMinutes: null,
    largerRunnerMinutes: null,
    artifactGbHours: null,
    cacheGbHours: null,
    repositoryPublicForEntireInterval: null,
    targets: null,
    deploymentCensus: null,
    complete: false,
    unresolved,
  };
  const fragmentExists = existsSync(fragmentPath);
  if (fragmentExists) {
    const existingFragment = readPrivateJson(
      fragmentPath,
      root,
      "Partial analyzer fragment",
    );
    invariant(
      canonicalJson(existingFragment) === canonicalJson(fragment),
      "Partial analyzer fragment conflicts",
    );
  }
  freezeObservation(root, interval, endUtcExclusive, generatedAtUtc);
  if (!fragmentExists) {
    writePrivateJson(fragmentPath, fragment, root);
  }
  // audit.json is the commit marker for the deterministic fragment above.
  writePrivateJson(auditPath, audit, root);
  return audit;
}

function parseArguments(argv) {
  invariant(Array.isArray(argv), "Observation command is required");
  const normalizedArgv = argv[0] === "--" ? argv.slice(1) : argv;
  invariant(normalizedArgv.length > 0, "Observation command is required");
  const [command, ...rest] = normalizedArgv;
  invariant(
    [
      "init",
      "capture-preview",
      "capture-main",
      "sample-github",
      "audit",
    ].includes(command),
    "Observation command is unsupported",
  );
  const options = {};
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index];
    const value = rest[index + 1];
    invariant(
      typeof flag === "string" &&
        /^--[a-z-]+$/.test(flag) &&
        value !== undefined,
      "Observation options must be --name value pairs",
    );
    const key = flag.slice(2);
    invariant(!Object.hasOwn(options, key), `Duplicate option: ${flag}`);
    options[key] = value;
  }
  const expected = {
    init: ["end", "start"],
    "capture-preview": ["event-run-id", "pr"],
    "capture-main": ["run-id"],
    "sample-github": [],
    audit: ["end"],
  }[command];
  invariant(
    JSON.stringify(Object.keys(options).sort()) === JSON.stringify(expected),
    `Invalid options for ${command}`,
  );
  return { command, options };
}

function publicResult(command, relativePath, facts = {}) {
  return {
    schema: "vercel-cost-observation-command-result:v2",
    command,
    status: "captured",
    path: relativePath,
    ...facts,
  };
}

export function runVercelCostObservation({
  argv = process.argv.slice(2),
  cwd = process.cwd(),
  now = () => new Date(),
  gh = defaultGh,
  stdout = process.stdout,
} = {}) {
  const { command, options } = parseArguments(argv);
  const paths = observationPaths(cwd);
  const dependencies = { cwd, now, gh, root: paths.root };
  const releaseOperationLock = acquireOperationLock(paths.root, command);
  try {
    if (command !== "audit") assertObservationMutable(paths.root);
    let result;
    let exitCode = 0;
    if (command === "init") {
      const interval = initializeObservation({
        root: paths.root,
        start: options.start,
        end: options.end,
        now,
        dependencies,
      });
      result = publicResult(
        command,
        `${OBSERVATION_RELATIVE_ROOT}/interval.json`,
        {
          startUtc: interval.startUtc,
          endUtcExclusive: interval.endUtcExclusive,
        },
      );
    } else {
      if (command !== "audit") authenticateGh(dependencies);
      if (command === "capture-preview") {
        const capture = capturePreview({
          root: paths.root,
          pr: options.pr,
          eventRunId: options["event-run-id"],
          dependencies,
        });
        result = publicResult(
          command,
          `${OBSERVATION_RELATIVE_ROOT}/preview/${capture.eventRunId}/capture.json`,
          {
            eventRunId: capture.eventRunId,
            evidenceComplete: capture.canonicalDerivedFacts.evidenceComplete,
          },
        );
      } else if (command === "capture-main") {
        const captures = captureMain({
          root: paths.root,
          runId: options["run-id"],
          dependencies,
        });
        result = publicResult(
          command,
          `${OBSERVATION_RELATIVE_ROOT}/main/${options["run-id"]}`,
          {
            runId: String(options["run-id"]),
            attemptsCaptured: captures.length,
          },
        );
      } else if (command === "sample-github") {
        const sample = sampleGithub({ root: paths.root, dependencies });
        result = publicResult(command, `${OBSERVATION_RELATIVE_ROOT}/samples`, {
          capturedAtUtc: sample.capturedAtUtc,
          relevantRunCount: sample.workflowRuns.length,
        });
      } else {
        const audit = auditObservation({
          root: paths.root,
          end: options.end,
          now,
        });
        exitCode = audit.pass ? 0 : 1;
        result = publicResult(
          command,
          `${OBSERVATION_RELATIVE_ROOT}/audit.json`,
          {
            pass: audit.pass,
            gapCount: audit.gaps.length,
            analyzerFragmentComplete: audit.analyzerFragmentComplete,
          },
        );
      }
    }
    stdout.write(`${JSON.stringify(result)}\n`);
    return { exitCode, result };
  } finally {
    releaseOperationLock();
  }
}

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) {
  try {
    const outcome = runVercelCostObservation();
    process.exitCode = outcome.exitCode;
  } catch (error) {
    process.stderr.write(
      `Vercel cost observation failed: ${
        error instanceof Error ? error.message : String(error)
      }\n`,
    );
    process.exitCode = 1;
  }
}
