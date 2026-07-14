#!/usr/bin/env node
/**
 * Materialize only GitHub Actions YAML from an exact pull-request head commit.
 * The trusted pull_request_target job uses this instead of checking out the
 * untrusted head, so PR files can only become inert scanner input.
 */

import { Buffer } from "node:buffer";
import { lstatSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

/* eslint-disable turbo/no-undeclared-env-vars -- CI-only workflow inputs. */

const API_BASE = "https://api.github.com";
const API_VERSION = "2022-11-28";
const OBJECT_SHA = /^[0-9a-f]{40}$/i;
const REPOSITORY = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/;
const MAX_TREE_ENTRIES = 20_000;
const MAX_SELECTED_FILES = 512;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_TOTAL_BYTES = 8 * 1024 * 1024;
const REQUIRED_POLICY_PATHS = new Set([
  ".github/workflows/action-pins.yml",
  ".github/workflows/action-pins-source.yml",
]);
const ACTION_REF_PATH = /(?:^|\/)action\.ya?ml$/;
const WORKFLOW_PATH = /^\.github\/workflows\/.+\.ya?ml$/;
const REPOSITORY_ACTION_PATH = /^\.github\/actions\/.+\.ya?ml$/;

/** @param {unknown} value @param {string} label */
function requireString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

/** @param {string} repository */
export function parseRepository(repository) {
  const value = requireString(repository, "PR_HEAD_REPOSITORY");
  if (value.length > 200) throw new Error("PR_HEAD_REPOSITORY is too long");
  const match = value.match(REPOSITORY);
  if (
    !match ||
    match[1] === "." ||
    match[1] === ".." ||
    match[2] === "." ||
    match[2] === ".."
  ) {
    throw new Error("PR_HEAD_REPOSITORY must be an owner/repository slug");
  }
  return { owner: match[1], repository: match[2] };
}

/** @param {string} sha @param {string} label */
function requireObjectSha(sha, label) {
  const value = requireString(sha, label);
  if (!OBJECT_SHA.test(value)) {
    throw new Error(`${label} must be a full 40-character Git object SHA`);
  }
  return value.toLowerCase();
}

/** @param {unknown} value */
function requireRecord(value) {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("GitHub API returned an invalid JSON object");
  }
  return value;
}

/** @param {string} path */
export function validateTreePath(path) {
  const value = requireString(path, "tree path");
  if (
    Buffer.byteLength(value) > 4096 ||
    value.startsWith("/") ||
    value.includes("\\") ||
    [...value].some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint <= 0x1f || codePoint === 0x7f;
    })
  ) {
    throw new Error(`unsafe Git tree path: ${JSON.stringify(value)}`);
  }

  const segments = value.split("/");
  if (
    segments.some(
      (segment) =>
        segment === "" ||
        segment === "." ||
        segment === ".." ||
        Buffer.byteLength(segment) > 255,
    )
  ) {
    throw new Error(`unsafe Git tree path: ${JSON.stringify(value)}`);
  }
  return value;
}

/** @param {string} path */
function isActionPinInput(path) {
  return (
    WORKFLOW_PATH.test(path) ||
    REPOSITORY_ACTION_PATH.test(path) ||
    ACTION_REF_PATH.test(path)
  );
}

/** @param {unknown} rawEntry */
function validateTreeEntry(rawEntry) {
  const entry = requireRecord(rawEntry);
  const path = validateTreePath(entry.path);
  const type = requireString(entry.type, `tree entry type for ${path}`);
  const mode = requireString(entry.mode, `tree entry mode for ${path}`);
  const sha = requireObjectSha(entry.sha, `tree entry SHA for ${path}`);

  if (type === "tree" && mode === "040000") {
    return { path, type, mode, sha, size: null };
  }
  if (
    type === "blob" &&
    (mode === "100644" || mode === "100755" || mode === "120000")
  ) {
    if (!Number.isSafeInteger(entry.size) || entry.size < 0) {
      throw new Error(
        `tree entry size for ${path} must be a non-negative integer`,
      );
    }
    return { path, type, mode, sha, size: entry.size };
  }
  if (type === "commit" || mode === "160000") {
    if (type !== "commit" || mode !== "160000") {
      throw new Error(
        `unsupported Git tree entry type/mode for ${path}: ${type}/${mode}`,
      );
    }
    return { path, type, mode, sha, size: null };
  }
  throw new Error(
    `unsupported Git tree entry type/mode for ${path}: ${type}/${mode}`,
  );
}

/** @param {unknown} payload @param {string} expectedSha @param {number} expectedSize */
export function decodeBlob(payload, expectedSha, expectedSize) {
  const blob = requireRecord(payload);
  const sha = requireObjectSha(blob.sha, "blob SHA");
  if (sha !== expectedSha)
    throw new Error("GitHub blob SHA did not match the tree entry");
  if (blob.encoding !== "base64")
    throw new Error("GitHub blob encoding was not base64");
  if (blob.size !== expectedSize)
    throw new Error("GitHub blob size did not match the tree entry");

  if (typeof blob.content !== "string") {
    throw new Error("blob content must be a string");
  }
  const content = blob.content;
  const compact = content.replace(/\r?\n/g, "");
  const base64 =
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
  if (!base64.test(compact))
    throw new Error("GitHub blob content was not valid base64");

  const bytes = Buffer.from(compact, "base64");
  if (bytes.length !== expectedSize) {
    throw new Error("Decoded GitHub blob size did not match the tree entry");
  }
  if (bytes.includes(0))
    throw new Error("GitHub Actions YAML must not contain NUL bytes");
  new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  return bytes;
}

/**
 * @param {string} path
 * @param {{ token: string, fetchImpl: typeof fetch }} options
 */
async function requestJson(path, { token, fetchImpl }) {
  const url = new URL(path, API_BASE);
  let response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "mento-action-pin-policy",
        "X-GitHub-Api-Version": API_VERSION,
      },
    });
  } catch (error) {
    throw new Error(
      `GitHub API request failed for ${url.pathname}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!response.ok) {
    throw new Error(
      `GitHub API request failed for ${url.pathname}: HTTP ${response.status}`,
    );
  }
  try {
    return await response.json();
  } catch {
    throw new Error(`GitHub API returned invalid JSON for ${url.pathname}`);
  }
}

/**
 * @param {{ repository: string, commitSha: string, token: string, fetchImpl?: typeof fetch }} options
 */
export async function fetchActionPinFiles({
  repository,
  commitSha,
  token,
  fetchImpl = fetch,
}) {
  const { owner, repository: name } = parseRepository(repository);
  const headSha = requireObjectSha(commitSha, "PR_HEAD_SHA");
  const apiToken = requireString(token, "GITHUB_TOKEN");
  if (/\s/.test(apiToken) || apiToken.length > 2048) {
    throw new Error("GITHUB_TOKEN has an invalid format");
  }
  if (typeof fetchImpl !== "function")
    throw new Error("fetchImpl must be a function");

  const repositoryPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
  const requestOptions = { token: apiToken, fetchImpl };
  const commit = requireRecord(
    await requestJson(
      `${repositoryPath}/git/commits/${headSha}`,
      requestOptions,
    ),
  );
  if (requireObjectSha(commit.sha, "commit response SHA") !== headSha) {
    throw new Error("GitHub commit response did not match PR_HEAD_SHA");
  }
  const treeSha = requireObjectSha(
    requireRecord(commit.tree).sha,
    "commit tree SHA",
  );

  const treeUrl = `${repositoryPath}/git/trees/${treeSha}?recursive=1`;
  const treePayload = requireRecord(await requestJson(treeUrl, requestOptions));
  if (requireObjectSha(treePayload.sha, "tree response SHA") !== treeSha) {
    throw new Error("GitHub tree response did not match the commit tree");
  }
  if (treePayload.truncated !== false) {
    throw new Error(
      "GitHub recursive tree response was truncated or incomplete",
    );
  }
  if (!Array.isArray(treePayload.tree)) {
    throw new Error("GitHub tree response did not include a tree array");
  }
  if (treePayload.tree.length > MAX_TREE_ENTRIES) {
    throw new Error(
      `GitHub tree exceeds the ${MAX_TREE_ENTRIES}-entry policy limit`,
    );
  }

  const seenPaths = new Set();
  const selected = [];
  for (const rawEntry of treePayload.tree) {
    const entry = validateTreeEntry(rawEntry);
    if (seenPaths.has(entry.path))
      throw new Error(`duplicate Git tree path: ${entry.path}`);
    seenPaths.add(entry.path);
    if (!isActionPinInput(entry.path)) continue;
    if (
      entry.type !== "blob" ||
      (entry.mode !== "100644" && entry.mode !== "100755")
    ) {
      throw new Error(
        `action-pin input must be a regular Git blob: ${entry.path}`,
      );
    }
    selected.push(entry);
  }

  for (const requiredPath of REQUIRED_POLICY_PATHS) {
    if (!selected.some((entry) => entry.path === requiredPath)) {
      throw new Error(
        `required action-pin policy workflow is missing: ${requiredPath}`,
      );
    }
  }
  if (selected.length > MAX_SELECTED_FILES) {
    throw new Error(
      `action-pin input exceeds the ${MAX_SELECTED_FILES}-file policy limit`,
    );
  }
  const totalSize = selected.reduce((sum, entry) => {
    if (entry.size > MAX_FILE_BYTES) {
      throw new Error(
        `${entry.path} exceeds the ${MAX_FILE_BYTES}-byte policy limit`,
      );
    }
    return sum + entry.size;
  }, 0);
  if (totalSize > MAX_TOTAL_BYTES) {
    throw new Error(
      `action-pin input exceeds the ${MAX_TOTAL_BYTES}-byte policy limit`,
    );
  }

  selected.sort((left, right) => left.path.localeCompare(right.path));
  const blobs = new Map();
  const files = new Map();
  for (const entry of selected) {
    let bytes = blobs.get(entry.sha);
    if (!bytes) {
      const payload = await requestJson(
        `${repositoryPath}/git/blobs/${entry.sha}`,
        requestOptions,
      );
      bytes = decodeBlob(payload, entry.sha, entry.size);
      blobs.set(entry.sha, bytes);
    } else if (bytes.length !== entry.size) {
      throw new Error(
        `duplicate blob SHA had inconsistent sizes: ${entry.sha}`,
      );
    }
    files.set(entry.path, bytes);
  }
  return { files, repository: `${owner}/${name}`, commitSha: headSha };
}

/**
 * @param {{ repository: string, commitSha: string, token: string, outputDir: string, fetchImpl?: typeof fetch }} options
 */
export async function materializeActionPinFiles(options) {
  const outputDir = requireString(options.outputDir, "ACTION_PIN_OUTPUT_DIR");
  if (
    !isAbsolute(outputDir) ||
    resolve(outputDir) === dirname(resolve(outputDir))
  ) {
    throw new Error("ACTION_PIN_OUTPUT_DIR must be an absolute non-root path");
  }
  try {
    lstatSync(outputDir);
    throw new Error("ACTION_PIN_OUTPUT_DIR must not already exist");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const parent = dirname(outputDir);
  if (!lstatSync(parent).isDirectory()) {
    throw new Error("ACTION_PIN_OUTPUT_DIR parent must be a directory");
  }
  realpathSync(parent);

  const result = await fetchActionPinFiles(options);
  mkdirSync(outputDir, { mode: 0o700 });
  for (const [path, bytes] of result.files) {
    const destination = resolve(outputDir, path);
    const relativePath = relative(outputDir, destination);
    if (
      relativePath === ".." ||
      relativePath.startsWith("../") ||
      isAbsolute(relativePath)
    ) {
      throw new Error(`refused to materialize unsafe path: ${path}`);
    }
    mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
    writeFileSync(destination, bytes, { flag: "wx", mode: 0o600 });
  }
  return { ...result, outputDir };
}

async function runFromEnvironment() {
  const result = await materializeActionPinFiles({
    repository: process.env["PR_HEAD_REPOSITORY"],
    commitSha: process.env["PR_HEAD_SHA"],
    token: process.env["GITHUB_TOKEN"],
    outputDir: process.env["ACTION_PIN_OUTPUT_DIR"],
  });
  console.log(
    `Materialized ${result.files.size} GitHub Actions YAML files from ${result.repository}@${result.commitSha}.`,
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  runFromEnvironment().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
