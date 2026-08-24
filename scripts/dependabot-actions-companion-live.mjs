#!/usr/bin/env node

/* eslint-disable turbo/no-undeclared-env-vars -- GitHub Actions supplies the three isolated companion credentials. */

import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { lstat, readdir, readFile, readlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import {
  ACTIONS_COMPANION_INPUT_SCHEMA,
  ACTIONS_COMPANION_STAGED_SCHEMA,
  canonicalJson,
  createOsvActionsCompanionPlan,
  OSV_MIRROR_TEST_PATH,
  OSV_REPORTER_ACTION,
  OSV_SCANNER_ACTION,
  OSV_WORKFLOW_PATH,
  verifyOsvActionsCompanionPlan,
  verifyStagedOsvActionsCompanion,
} from "./dependabot-actions-companion.mjs";
import {
  createLiveGitHubAdapter,
  evaluateFeedbackGate,
  requireStableFeedbackSnapshot,
  requireStablePullRequestSnapshot,
} from "./dependabot-processor.mjs";

export const ACTIONS_COMPANION_LIVE_STAGE_SCHEMA =
  "dependabot-actions-companion-live-stage:v1";
export const ACTIONS_COMPANION_LIVE_OPEN_SCHEMA =
  "dependabot-actions-companion-live-open:v1";
export const ACTIONS_COMPANION_LIVE_CENSUS_SCHEMA =
  "dependabot-actions-companion-live-census:v1";
export const ACTIONS_COMPANION_BASE_VERIFICATION_SCHEMA =
  "dependabot-actions-companion-base-verification:v1";

const API_ROOT = "https://api.github.com";
const REQUIRED_REPOSITORY = "mento-protocol/frontend-monorepo";
const PROCESSOR_CHECK_NAME = "Dependabot Processor";
const PROCESSOR_WORKFLOW_PATH = ".github/workflows/dependabot-process.yml";
const GITHUB_ACTIONS_APP_ID = 15_368;
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const PROCESSOR_RECEIPT_PATTERN =
  /^dependabot-processor:v2:pr=([1-9][0-9]{0,9}):head=([0-9a-f]{40}):mode=prepare:repair=([1-9][0-9]*):packet=false:digest=none:run=([1-9][0-9]*):attempt=([1-9][0-9]*)$/u;
const ACTIONABLE_MANUAL_SUMMARY =
  "Disposition: manual-review. Reason: sensitive-auth-deployment-or-workflow-policy-action. Next action: create a maintainer-authored companion or replacement PR.";
const MAX_PAGES = 20;
const PAGE_SIZE = 100;
const MAX_TREE_ENTRIES = 10_000;
const MAX_CENSUS_BYTES = 256 * 1024 * 1024;
const MAX_CENSUS_RECEIPT_BYTES = 8 * 1024 * 1024;
const MAX_STAGE_RECEIPT_BYTES = 8 * 1024;
const BLOB_READ_CONCURRENCY = 8;

export class ActionsCompanionLiveError extends Error {
  constructor(code, options = {}) {
    super(`Dependabot actions companion live adapter rejected: ${code}`, {
      cause: options.cause,
    });
    this.name = "ActionsCompanionLiveError";
    this.code = code;
    this.status = options.status ?? null;
  }
}

function reject(code, options) {
  throw new ActionsCompanionLiveError(code, options);
}

function plainObject(value, code) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    reject(code);
  }
  return value;
}

function exactKeys(value, expected, code) {
  plainObject(value, code);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (canonicalJson(actual) !== canonicalJson(wanted)) reject(code);
}

function exactSha(value, code) {
  if (!SHA_PATTERN.test(value ?? "")) reject(code);
  return value;
}

function positiveInteger(value, code) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) reject(code);
  return number;
}

function boundedPullRequestNumber(value, code) {
  const number = positiveInteger(value, code);
  if (number > 9_999_999_999) reject(code);
  return number;
}

function prepareAppIdentity({ prepareAppSlug, prepareBotId, prepareBotLogin }) {
  if (
    typeof prepareAppSlug !== "string" ||
    !/^[a-z0-9][a-z0-9-]{0,99}$/u.test(prepareAppSlug)
  ) {
    reject("prepare-app-slug-invalid");
  }
  const id = positiveInteger(prepareBotId, "prepare-bot-id-invalid");
  if (
    typeof prepareBotLogin !== "string" ||
    prepareBotLogin !== `${prepareAppSlug}[bot]`
  ) {
    reject("prepare-bot-login-invalid");
  }
  return { id, login: prepareBotLogin, type: "Bot" };
}

async function resolvePrepareAppBot(readApi, input) {
  const expected = prepareAppIdentity(input);
  const { data } = await readApi.request(
    "GET",
    `/users/${encodeURIComponent(expected.login)}`,
  );
  if (canonicalJson(normalizedActor(data)) !== canonicalJson(expected)) {
    reject("prepare-app-bot-mismatch");
  }
  return expected;
}

function requireActor(actual, expected, code) {
  if (canonicalJson(normalizedActor(actual)) !== canonicalJson(expected)) {
    reject(code);
  }
}

function repositoryName(value) {
  if (!REPOSITORY_PATTERN.test(value ?? "") || value !== REQUIRED_REPOSITORY) {
    reject("repository-invalid");
  }
  return value;
}

function credential(value, code) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 4096 ||
    /[\s\0]/u.test(value)
  ) {
    reject(code);
  }
  return value;
}

function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

function gitBlobSha(value) {
  return createHash("sha1")
    .update(`blob ${value.byteLength}\0`)
    .update(value)
    .digest("hex");
}

function strictUtf8(value, code) {
  const text = value.toString("utf8");
  if (
    !Buffer.from(text, "utf8").equals(value) ||
    text.length === 0 ||
    text.includes("\0") ||
    text.includes("\r")
  ) {
    reject(code);
  }
  return text;
}

function safePath(value, code) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 4096 ||
    value.startsWith("/") ||
    value.endsWith("/") ||
    value.includes("\\") ||
    value.includes("\0") ||
    value
      .split("/")
      .some((part) => part === "" || part === "." || part === "..")
  ) {
    reject(code);
  }
  return value;
}

function pathWithQuery(path, query = {}) {
  const url = new URL(`${API_ROOT}${path}`);
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, String(value));
  }
  return `${url.pathname}${url.search}`;
}

function refPath(branchRef) {
  return `/repos/${REQUIRED_REPOSITORY}/git/ref/${[
    "heads",
    ...branchRef.split("/"),
  ]
    .map(encodeURIComponent)
    .join("/")}`;
}

function companionBranchRef(pullRequestNumber, sourceHeadSha) {
  return (
    `dependabot-companion/osv-pr-${pullRequestNumber}-` +
    sourceHeadSha.slice(0, 12)
  );
}

function companionTitle(pullRequestNumber) {
  return `chore(ci): apply OSV action update from Dependabot #${pullRequestNumber}`;
}

async function terminalCompanionState(
  readApi,
  {
    baseDirectory,
    expectedBaseSha,
    expectedHeadSha,
    prepareBot,
    processorRunAttempt,
    processorRunId,
    pullRequestNumber,
    workflowSha,
  },
) {
  const branchRef = companionBranchRef(pullRequestNumber, expectedHeadSha);
  const title = companionTitle(pullRequestNumber);
  const pulls = await paginate(
    readApi,
    pathWithQuery(`/repos/${REQUIRED_REPOSITORY}/pulls`, {
      base: "main",
      state: "all",
    }),
    "companion-pr-census-invalid",
  );
  const candidates = pulls.filter((pull) => pull?.head?.ref === branchRef);
  if (candidates.length > 1) reject("duplicate-companion-prs");
  if (candidates.length === 0 || candidates[0]?.state === "open") return null;
  const pull = candidates[0];
  if (
    pull?.state !== "closed" ||
    pull?.head?.ref !== branchRef ||
    pull?.head?.repo?.full_name !== REQUIRED_REPOSITORY ||
    !SHA_PATTERN.test(pull?.head?.sha ?? "") ||
    pull?.base?.ref !== "main" ||
    pull?.base?.repo?.full_name !== REQUIRED_REPOSITORY ||
    pull?.title !== title ||
    pull?.draft !== false ||
    pull?.maintainer_can_modify !== false ||
    !Number.isSafeInteger(pull?.number) ||
    pull.number < 1 ||
    pull?.html_url !==
      `https://github.com/${REQUIRED_REPOSITORY}/pull/${pull.number}`
  ) {
    reject("terminal-companion-pr-mismatch");
  }
  requireActor(pull.user, prepareBot, "terminal-companion-author-mismatch");
  const historical = await collectHistoricalTerminalPlan({
    baseDirectory,
    expectedBaseSha,
    expectedHeadSha,
    processorRunAttempt,
    processorRunId,
    pullRequestNumber,
    readApi,
    workflowSha,
  });
  await verifyTerminalCompanionPullRequest(readApi, {
    baseEntries: historical.base.entries,
    input: historical.input,
    plan: historical.plan,
    prepareBot,
    pull,
  });
  const reason = pull.merged_at ? "merged" : "closed-unmerged";
  return {
    branchRef,
    companionPullRequest: {
      headSha: pull.head.sha,
      mergedAt: reason === "merged" ? pull.merged_at : null,
      number: pull.number,
      state: reason,
      url: pull.html_url,
    },
    orchestratorRunAttempt: processorRunAttempt,
    orchestratorRunId: processorRunId,
    processorRunAttempt: historical.processor.runAttempt,
    processorRunId: historical.processor.runId,
    reason,
    sourceHeadSha: expectedHeadSha,
    sourcePullRequestNumber: pullRequestNumber,
    workflowSha,
  };
}

function createApi({ fetchImpl, token }) {
  if (typeof fetchImpl !== "function") reject("fetch-implementation-invalid");
  const bearer = credential(token, "github-token-invalid");
  const request = async (
    method,
    path,
    { body, expected = [200], allow = [] } = {},
  ) => {
    const response = await fetchImpl(`${API_ROOT}${path}`, {
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${bearer}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        "User-Agent": "mento-dependabot-actions-companion",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      method,
      redirect: "error",
    });
    if (allow.includes(response.status)) {
      return { data: null, status: response.status };
    }
    if (!expected.includes(response.status)) {
      reject("github-api-request-failed", { status: response.status });
    }
    let data;
    try {
      data = JSON.parse(await response.text());
    } catch (cause) {
      reject("github-api-response-invalid", { cause });
    }
    return { data, status: response.status };
  };
  return { request };
}

function createProcessorFeedbackAdapter(fetchImpl, readToken) {
  try {
    return createLiveGitHubAdapter({
      apiUrl: API_ROOT,
      fetchImpl,
      graphqlUrl: `${API_ROOT}/graphql`,
      phase: "finalize",
      repairToken: null,
      token: readToken,
    });
  } catch (cause) {
    reject("source-feedback-adapter-invalid", { cause });
  }
}

function pullRequestAuthoritySnapshot(pull) {
  return {
    base: {
      ref: pull?.base?.ref,
      repo: { full_name: pull?.base?.repo?.full_name },
      sha: pull?.base?.sha,
    },
    draft: pull?.draft,
    head: {
      ref: pull?.head?.ref,
      repo: { full_name: pull?.head?.repo?.full_name },
      sha: pull?.head?.sha,
    },
    isCrossRepository:
      pull?.head?.repo?.full_name !== pull?.base?.repo?.full_name,
    node_id: pull?.node_id,
    number: pull?.number,
    state: pull?.state,
    updated_at: pull?.updated_at,
    user: { login: pull?.user?.login },
  };
}

function feedbackAuthoritySnapshot(feedback) {
  return {
    digest: feedback?.digest,
    headSha: feedback?.headSha,
    updatedAt: feedback?.updatedAt,
  };
}

function sourceCommitForFeedback(input) {
  const commit = input?.sourcePullRequest?.commits?.[0];
  return {
    author: commit?.author,
    committer: commit?.committer,
    message: commit?.message,
    parents: commit?.parentShas,
    sha: commit?.sha,
    verificationReason: commit?.verificationReason,
    verified: commit?.verified,
  };
}

function sourceLabels(pull) {
  if (!Array.isArray(pull?.labels)) return null;
  return pull.labels
    .map((label) => (typeof label === "string" ? label : label?.name))
    .sort();
}

function requireClearSourceFeedback({ feedback, gate, input, pull }) {
  const source = input?.sourcePullRequest;
  if (
    feedback?.complete !== true ||
    !DIGEST_PATTERN.test(feedback?.digest ?? "") ||
    feedback?.headSha !== source?.head?.sha ||
    feedback?.isDraft !== false ||
    feedback?.autoMergeEnabled !== false ||
    gate?.clear !== true ||
    gate?.autoMergeEnabled !== false ||
    gate?.currentProcessorApprovalCount !== 0 ||
    !Array.isArray(gate?.currentProcessorApprovalIds) ||
    gate.currentProcessorApprovalIds.length !== 0 ||
    !Array.isArray(gate?.reasons) ||
    gate.reasons.length !== 0 ||
    gate?.forcePushVeto !== false ||
    !Array.isArray(gate?.vetoLabels) ||
    gate.vetoLabels.length !== 0 ||
    pull?.number !== source?.number ||
    pull?.state !== "open" ||
    pull?.draft !== false ||
    pull?.user?.id !== source?.author?.id ||
    pull?.user?.login !== source?.author?.login ||
    pull?.user?.type !== source?.author?.type ||
    pull?.head?.ref !== source?.head?.ref ||
    pull?.head?.sha !== source?.head?.sha ||
    pull?.head?.repo?.full_name !== source?.head?.repository ||
    pull?.base?.ref !== source?.base?.ref ||
    pull?.base?.sha !== source?.base?.sha ||
    pull?.base?.repo?.full_name !== source?.base?.repository ||
    (pull?.auto_merge !== null && pull?.auto_merge !== undefined)
  ) {
    reject("source-feedback-blocked");
  }
}

async function collectSourceFeedbackAuthority({
  expectedAuthority = null,
  feedbackAdapter,
  initialPull,
  input,
}) {
  const number = input?.sourcePullRequest?.number;
  let initialFeedback;
  let humanEvidence;
  let feedback;
  let pull;
  try {
    initialFeedback = await feedbackAdapter.getFeedback(
      REQUIRED_REPOSITORY,
      number,
    );
    humanEvidence = await feedbackAdapter.getHumanCloseEvidence(
      REQUIRED_REPOSITORY,
      number,
      initialFeedback.branchMaintenanceComments,
    );
    feedback = await feedbackAdapter.getFeedback(REQUIRED_REPOSITORY, number);
    pull = await feedbackAdapter.getPullRequest(REQUIRED_REPOSITORY, number);
  } catch (cause) {
    reject("source-feedback-collection-failed", { cause });
  }
  try {
    requireStableFeedbackSnapshot(initialFeedback, feedback, number);
    requireStablePullRequestSnapshot(initialPull, pull, number);
    if (expectedAuthority) {
      requireStableFeedbackSnapshot(
        expectedAuthority.feedback,
        feedback,
        number,
      );
      requireStablePullRequestSnapshot(
        expectedAuthority.pullRequest,
        pull,
        number,
      );
    }
  } catch (cause) {
    reject("source-feedback-changed", { cause });
  }
  let gate;
  try {
    gate = evaluateFeedbackGate({
      feedback: {
        ...feedback,
        ...humanEvidence,
        labels: pull.labels,
        maintainerVeto:
          humanEvidence.humanIntervened || humanEvidence.forcePushed,
      },
      generationSeedCommit: sourceCommitForFeedback(input),
      generationSeedHeadSha: input.sourcePullRequest.head.sha,
      generationSeedTrusted: true,
      pullRequest: pull,
    });
  } catch (cause) {
    reject("source-feedback-invalid", { cause });
  }
  requireClearSourceFeedback({ feedback, gate, input, pull });
  const feedbackSnapshot = feedbackAuthoritySnapshot(feedback);
  const feedbackDigest = sha256Bytes(
    Buffer.from(
      canonicalJson({
        feedback: feedbackSnapshot,
        humanEvidence,
        labels: sourceLabels(pull),
      }),
    ),
  );
  if (
    expectedAuthority &&
    expectedAuthority.feedbackDigest !== feedbackDigest
  ) {
    reject("source-feedback-changed");
  }
  return {
    feedback: feedbackSnapshot,
    feedbackDigest,
    pullRequest: pullRequestAuthoritySnapshot(pull),
  };
}

async function paginate(api, path, code) {
  const results = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const separator = path.includes("?") ? "&" : "?";
    const { data } = await api.request(
      "GET",
      `${path}${separator}per_page=${PAGE_SIZE}&page=${page}`,
    );
    if (!Array.isArray(data)) reject(code);
    results.push(...data);
    if (data.length < PAGE_SIZE) return results;
  }
  reject(code);
}

async function mapConcurrent(values, limit, mapper) {
  const result = [];
  for (let index = 0; index < values.length; index += limit) {
    result.push(
      ...(await Promise.all(values.slice(index, index + limit).map(mapper))),
    );
  }
  return result;
}

function decodeBlob(data, expectedSha, expectedSize) {
  plainObject(data, "git-blob-response-invalid");
  if (
    data.sha !== expectedSha ||
    data.encoding !== "base64" ||
    typeof data.content !== "string"
  ) {
    reject("git-blob-response-invalid");
  }
  const encoded = data.content.replace(/[\r\n]/gu, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/u.test(encoded)) {
    reject("git-blob-response-invalid");
  }
  const bytes = Buffer.from(encoded, "base64");
  if (
    bytes.toString("base64") !== encoded ||
    bytes.byteLength !== expectedSize ||
    data.size !== expectedSize ||
    gitBlobSha(bytes) !== expectedSha
  ) {
    reject("git-blob-response-invalid");
  }
  return bytes;
}

function normalizeRecursiveTree(data, expectedTreeSha, code) {
  plainObject(data, code);
  if (
    data.sha !== expectedTreeSha ||
    data.truncated !== false ||
    !Array.isArray(data.tree) ||
    data.tree.length > MAX_TREE_ENTRIES
  ) {
    reject(code);
  }
  const entries = [];
  const paths = new Set();
  for (const raw of data.tree) {
    plainObject(raw, code);
    const path = safePath(raw.path, code);
    if (paths.has(path)) reject(code);
    paths.add(path);
    if (!new Set(["blob", "commit", "tree"]).has(raw.type)) reject(code);
    const entry = {
      mode: String(raw.mode ?? ""),
      path,
      sha: exactSha(raw.sha, code),
      size: raw.type === "blob" ? Number(raw.size) : null,
      type: raw.type,
    };
    if (
      raw.type === "blob" &&
      (!Number.isSafeInteger(entry.size) || entry.size < 0)
    ) {
      reject(code);
    }
    entries.push(entry);
  }
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

async function commitTreeIdentity(readApi, commitSha, code) {
  const sha = exactSha(commitSha, code);
  const { data: commit } = await readApi.request(
    "GET",
    `/repos/${REQUIRED_REPOSITORY}/git/commits/${sha}`,
  );
  if (commit?.sha !== sha) reject(code);
  const treeSha = exactSha(commit?.tree?.sha, code);
  const { data: tree } = await readApi.request(
    "GET",
    pathWithQuery(`/repos/${REQUIRED_REPOSITORY}/git/trees/${treeSha}`, {
      recursive: 1,
    }),
  );
  const entries = normalizeRecursiveTree(tree, treeSha, code);
  return { commitSha: sha, entries, treeSha };
}

async function currentBaseIdentity(readApi, expected = null) {
  const { data: ref } = await readApi.request(
    "GET",
    `/repos/${REQUIRED_REPOSITORY}/git/ref/heads/main`,
  );
  const commitSha = exactSha(ref?.object?.sha, "current-main-ref-invalid");
  if (ref?.ref !== "refs/heads/main" || ref?.object?.type !== "commit") {
    reject("current-main-ref-invalid");
  }
  if (expected && commitSha !== expected.commitSha) {
    reject("current-main-changed");
  }
  const identity = await commitTreeIdentity(
    readApi,
    commitSha,
    "current-main-commit-invalid",
  );
  if (expected && identity.treeSha !== expected.treeSha) {
    reject("current-main-changed");
  }
  return identity;
}

async function localBaseFiles(baseDirectory, entries) {
  if (typeof baseDirectory !== "string" || baseDirectory.length === 0) {
    reject("base-directory-invalid");
  }
  const root = resolve(baseDirectory);
  const expected = new Map(
    entries
      .filter(({ type }) => type !== "tree")
      .map((entry) => [entry.path, entry]),
  );
  if ([...expected.values()].some(({ type }) => type !== "blob")) {
    reject("base-directory-submodule-unsupported");
  }
  const expectedBytes = [...expected.values()].reduce(
    (total, entry) => total + entry.size,
    0,
  );
  if (
    !Number.isSafeInteger(expectedBytes) ||
    expectedBytes > MAX_CENSUS_BYTES
  ) {
    reject("current-main-census-too-large");
  }
  const discovered = [];
  const walk = async (directory, prefix = "") => {
    let children;
    try {
      children = await readdir(directory, { withFileTypes: true });
    } catch (cause) {
      reject("base-directory-read-failed", { cause });
    }
    for (const child of children.sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      const path = prefix ? `${prefix}/${child.name}` : child.name;
      if (path === ".git") continue;
      safePath(path, "base-directory-path-invalid");
      const absolute = join(directory, child.name);
      let stats;
      try {
        stats = await lstat(absolute);
      } catch (cause) {
        reject("base-directory-read-failed", { cause });
      }
      if (stats.isDirectory()) {
        await walk(absolute, path);
      } else if (stats.isFile() || stats.isSymbolicLink()) {
        discovered.push({
          absolute,
          executable: (stats.mode & 0o111) !== 0,
          path,
          symbolicLink: stats.isSymbolicLink(),
        });
      } else {
        reject("base-directory-entry-invalid");
      }
      if (discovered.length > MAX_TREE_ENTRIES) {
        reject("base-directory-entry-limit-exceeded");
      }
    }
  };
  await walk(root);
  const files = new Map();
  let totalBytes = 0;
  const loaded = await mapConcurrent(
    discovered,
    BLOB_READ_CONCURRENCY,
    async ({ absolute, executable, path, symbolicLink }) => {
      const entry = expected.get(path);
      if (!entry) reject("base-directory-has-untracked-entry");
      if (
        (symbolicLink && entry.mode !== "120000") ||
        (!symbolicLink && !new Set(["100644", "100755"]).has(entry.mode)) ||
        (!symbolicLink && (entry.mode === "100755") !== executable)
      ) {
        reject("base-directory-mode-mismatch");
      }
      let bytes;
      try {
        bytes = symbolicLink
          ? Buffer.from(await readlink(absolute), "utf8")
          : await readFile(absolute);
      } catch (cause) {
        reject("base-directory-read-failed", { cause });
      }
      if (bytes.byteLength !== entry.size || gitBlobSha(bytes) !== entry.sha) {
        reject("base-directory-does-not-match-current-main");
      }
      return [path, bytes];
    },
  );
  for (const [path, bytes] of loaded) {
    totalBytes += bytes.byteLength;
    if (totalBytes > MAX_CENSUS_BYTES) {
      reject("current-main-census-too-large");
    }
    files.set(path, bytes);
  }
  if (files.size !== expected.size) reject("base-directory-is-incomplete");
  return files;
}

async function remoteKnownBaseFiles(readApi, entries) {
  const expected = [OSV_WORKFLOW_PATH, OSV_MIRROR_TEST_PATH].map((path) => {
    const entry = entries.find(
      (candidate) => candidate.path === path && candidate.type === "blob",
    );
    if (!entry) reject("current-main-input-missing");
    return entry;
  });
  return new Map(
    await mapConcurrent(expected, BLOB_READ_CONCURRENCY, async (entry) => {
      const { data } = await readApi.request(
        "GET",
        `/repos/${REQUIRED_REPOSITORY}/git/blobs/${entry.sha}`,
      );
      return [entry.path, decodeBlob(data, entry.sha, entry.size)];
    }),
  );
}

async function currentBaseSnapshot(
  readApi,
  { baseDirectory = null, oldReferenceFiles = null } = {},
) {
  const identity = await currentBaseIdentity(readApi);
  const files = baseDirectory
    ? await localBaseFiles(baseDirectory, identity.entries)
    : await remoteKnownBaseFiles(readApi, identity.entries);
  return { ...identity, files, oldReferenceFiles };
}

async function historicalBaseSnapshot(readApi, baseDirectory, expectedBaseSha) {
  const identity = await commitTreeIdentity(
    readApi,
    expectedBaseSha,
    "historical-base-invalid",
  );
  const files = await localBaseFiles(baseDirectory, identity.entries);
  return { ...identity, files, oldReferenceFiles: null };
}

export async function verifyHistoricalBaseLive({
  baseDirectory,
  expectedBaseSha,
  fetchImpl = globalThis.fetch,
  readToken,
  repository,
}) {
  repositoryName(repository);
  const baseSha = exactSha(expectedBaseSha, "expected-base-sha-invalid");
  const readApi = createApi({ fetchImpl, token: readToken });
  const identity = await historicalBaseSnapshot(
    readApi,
    baseDirectory,
    baseSha,
  );
  const byteCount = [...identity.files.values()].reduce(
    (total, bytes) => total + bytes.byteLength,
    0,
  );
  return {
    baseSha: identity.commitSha,
    byteCount,
    entriesDigest: sha256Bytes(Buffer.from(canonicalJson(identity.entries))),
    entryCount: identity.entries.length,
    repository: REQUIRED_REPOSITORY,
    schema: ACTIONS_COMPANION_BASE_VERIFICATION_SCHEMA,
    treeSha: identity.treeSha,
  };
}

async function revalidateCurrentBaseSnapshot(readApi, expected) {
  const { data: ref } = await readApi.request(
    "GET",
    `/repos/${REQUIRED_REPOSITORY}/git/ref/heads/main`,
  );
  if (
    ref?.ref !== "refs/heads/main" ||
    ref?.object?.type !== "commit" ||
    ref?.object?.sha !== expected.commitSha
  ) {
    reject("current-main-changed");
  }
  const { data: commit } = await readApi.request(
    "GET",
    `/repos/${REQUIRED_REPOSITORY}/git/commits/${expected.commitSha}`,
  );
  if (
    commit?.sha !== expected.commitSha ||
    commit?.tree?.sha !== expected.treeSha
  ) {
    reject("current-main-changed");
  }
  return expected;
}

function exactActionRevision(content, action, code) {
  const escaped = action.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const matches = [
    ...content.matchAll(new RegExp(`${escaped}@([0-9a-f]{40})`, "gu")),
  ];
  if (matches.length !== 1) reject(code);
  return matches[0][1];
}

function occurrences(bytes, needle) {
  let count = 0;
  let offset = 0;
  while (offset <= bytes.byteLength - needle.byteLength) {
    const index = bytes.indexOf(needle, offset);
    if (index < 0) break;
    count += 1;
    offset = index + needle.byteLength;
  }
  return count;
}

function oldReferenceCensus(base, oldSha) {
  const needle = Buffer.from(oldSha, "ascii");
  return [...base.files]
    .map(([path, bytes]) => ({
      contentSha256: sha256Bytes(bytes),
      oldShaOccurrences: occurrences(bytes, needle),
      path,
    }))
    .filter(({ oldShaOccurrences }) => oldShaOccurrences > 0)
    .sort((left, right) => left.path.localeCompare(right.path));
}

function validateOldReferenceFiles(records, code) {
  if (!Array.isArray(records) || records.length !== 2) reject(code);
  const expectedPaths = new Set([OSV_WORKFLOW_PATH, OSV_MIRROR_TEST_PATH]);
  const seen = new Set();
  for (const record of records) {
    exactKeys(record, ["contentSha256", "oldShaOccurrences", "path"], code);
    if (
      !DIGEST_PATTERN.test(record.contentSha256 ?? "") ||
      record.oldShaOccurrences !== 2 ||
      !expectedPaths.has(record.path) ||
      seen.has(record.path)
    ) {
      reject(code);
    }
    seen.add(record.path);
  }
  return [...records].sort((left, right) =>
    left.path.localeCompare(right.path),
  );
}

function censusReceiptCore({
  authority,
  input,
  orchestratorRunAttempt,
  orchestratorRunId,
  plan,
  processorRunAttempt,
  processorRunId,
  sourceHeadSha,
  sourcePullRequestNumber,
  workflowSha,
}) {
  return {
    authority,
    input,
    orchestratorRunAttempt,
    orchestratorRunId,
    plan,
    processorRunAttempt,
    processorRunId,
    repository: REQUIRED_REPOSITORY,
    result: "planned",
    schema: ACTIONS_COMPANION_LIVE_CENSUS_SCHEMA,
    sourceHeadSha,
    sourcePullRequestNumber,
    workflowSha,
  };
}

function createCensusReceipt(input) {
  const core = censusReceiptCore(input);
  const receipt = {
    ...core,
    censusDigest: sha256Bytes(Buffer.from(canonicalJson(core))),
  };
  if (Buffer.byteLength(canonicalJson(receipt)) > MAX_CENSUS_RECEIPT_BYTES) {
    reject("census-receipt-too-large");
  }
  return receipt;
}

function terminalReceiptCore({
  branchRef,
  companionPullRequest,
  orchestratorRunAttempt,
  orchestratorRunId,
  processorRunAttempt,
  processorRunId,
  reason,
  schema,
  sourceHeadSha,
  sourcePullRequestNumber,
  workflowSha,
}) {
  return {
    branchRef,
    companionPullRequest,
    orchestratorRunAttempt,
    orchestratorRunId,
    processorRunAttempt,
    processorRunId,
    reason,
    repository: REQUIRED_REPOSITORY,
    result: "terminal",
    schema,
    sourceHeadSha,
    sourcePullRequestNumber,
    workflowSha,
  };
}

function createTerminalCensusReceipt(input) {
  const core = terminalReceiptCore({
    ...input,
    schema: ACTIONS_COMPANION_LIVE_CENSUS_SCHEMA,
  });
  const receipt = {
    ...core,
    censusDigest: sha256Bytes(Buffer.from(canonicalJson(core))),
  };
  if (Buffer.byteLength(canonicalJson(receipt)) > MAX_STAGE_RECEIPT_BYTES) {
    reject("census-receipt-too-large");
  }
  return receipt;
}

function validateTerminalCompanionPullRequest(value, expected, code) {
  exactKeys(value, ["headSha", "mergedAt", "number", "state", "url"], code);
  if (
    !SHA_PATTERN.test(value.headSha ?? "") ||
    !Number.isSafeInteger(value.number) ||
    value.number < 1 ||
    !new Set(["merged", "closed-unmerged"]).has(value.state) ||
    value.state !== expected.reason ||
    (value.state === "merged"
      ? typeof value.mergedAt !== "string" ||
        Number.isNaN(Date.parse(value.mergedAt))
      : value.mergedAt !== null) ||
    value.url !==
      `https://github.com/${REQUIRED_REPOSITORY}/pull/${value.number}`
  ) {
    reject(code);
  }
}

function validateTerminalCensusReceipt(receipt, expected) {
  exactKeys(
    receipt,
    [
      "branchRef",
      "censusDigest",
      "companionPullRequest",
      "orchestratorRunAttempt",
      "orchestratorRunId",
      "processorRunAttempt",
      "processorRunId",
      "reason",
      "repository",
      "result",
      "schema",
      "sourceHeadSha",
      "sourcePullRequestNumber",
      "workflowSha",
    ],
    "census-terminal-receipt-shape-invalid",
  );
  const { censusDigest, ...core } = receipt;
  if (
    Buffer.byteLength(canonicalJson(receipt)) > MAX_STAGE_RECEIPT_BYTES ||
    receipt.schema !== ACTIONS_COMPANION_LIVE_CENSUS_SCHEMA ||
    receipt.result !== "terminal" ||
    !new Set(["merged", "closed-unmerged"]).has(receipt.reason) ||
    receipt.repository !== expected.repository ||
    receipt.sourcePullRequestNumber !== expected.pullRequestNumber ||
    receipt.sourceHeadSha !== expected.expectedHeadSha ||
    receipt.workflowSha !== expected.workflowSha ||
    receipt.orchestratorRunId !== expected.orchestratorRunId ||
    receipt.orchestratorRunAttempt !== expected.orchestratorRunAttempt ||
    !Number.isSafeInteger(receipt.processorRunId) ||
    receipt.processorRunId < 1 ||
    !Number.isSafeInteger(receipt.processorRunAttempt) ||
    receipt.processorRunAttempt < 1 ||
    receipt.branchRef !==
      companionBranchRef(
        expected.pullRequestNumber,
        expected.expectedHeadSha,
      ) ||
    censusDigest !== sha256Bytes(Buffer.from(canonicalJson(core)))
  ) {
    reject("census-terminal-receipt-invalid");
  }
  validateTerminalCompanionPullRequest(
    receipt.companionPullRequest,
    receipt,
    "census-terminal-pull-request-invalid",
  );
  return receipt;
}

function validateCensusReceipt(receipt, expected) {
  if (receipt?.result === "terminal") {
    return validateTerminalCensusReceipt(receipt, expected);
  }
  exactKeys(
    receipt,
    [
      "authority",
      "censusDigest",
      "input",
      "orchestratorRunAttempt",
      "orchestratorRunId",
      "plan",
      "processorRunAttempt",
      "processorRunId",
      "repository",
      "result",
      "schema",
      "sourceHeadSha",
      "sourcePullRequestNumber",
      "workflowSha",
    ],
    "census-receipt-shape-invalid",
  );
  const core = censusReceiptCore(receipt);
  if (
    Buffer.byteLength(canonicalJson(receipt)) > MAX_CENSUS_RECEIPT_BYTES ||
    receipt.schema !== ACTIONS_COMPANION_LIVE_CENSUS_SCHEMA ||
    receipt.result !== "planned" ||
    receipt.repository !== expected.repository ||
    receipt.sourcePullRequestNumber !== expected.pullRequestNumber ||
    receipt.sourceHeadSha !== expected.expectedHeadSha ||
    receipt.workflowSha !== expected.workflowSha ||
    receipt.orchestratorRunId !== expected.orchestratorRunId ||
    receipt.orchestratorRunAttempt !== expected.orchestratorRunAttempt ||
    !Number.isSafeInteger(receipt.processorRunId) ||
    receipt.processorRunId < 1 ||
    !Number.isSafeInteger(receipt.processorRunAttempt) ||
    receipt.processorRunAttempt < 1 ||
    receipt.censusDigest !== sha256Bytes(Buffer.from(canonicalJson(core)))
  ) {
    reject("census-receipt-invalid");
  }
  plainObject(receipt.authority, "census-authority-invalid");
  plainObject(receipt.input, "census-input-invalid");
  plainObject(receipt.plan, "census-plan-invalid");
  if (
    receipt.input.repository !== REQUIRED_REPOSITORY ||
    receipt.authority.processor?.runId !== receipt.processorRunId ||
    receipt.authority.processor?.runAttempt !== receipt.processorRunAttempt ||
    (expected.expectedBaseSha !== undefined &&
      receipt.input.currentBase?.commitSha !== expected.expectedBaseSha) ||
    receipt.input.sourcePullRequest?.number !== expected.pullRequestNumber ||
    receipt.input.sourcePullRequest?.head?.sha !== expected.expectedHeadSha ||
    !verifyOsvActionsCompanionPlan(receipt.input, receipt.plan).eligible
  ) {
    reject("census-plan-invalid");
  }
  return receipt;
}

export async function censusOsvActionsCompanionLive({
  baseDirectory,
  expectedBaseSha,
  expectedHeadSha,
  fetchImpl = globalThis.fetch,
  prepareAppSlug,
  prepareBotId,
  prepareBotLogin,
  pullRequestNumber,
  processorRunAttempt,
  processorRunId,
  readToken,
  repository,
  workflowSha,
}) {
  repositoryName(repository);
  const number = boundedPullRequestNumber(
    pullRequestNumber,
    "source-pr-number-invalid",
  );
  const runId = positiveInteger(processorRunId, "processor-run-id-invalid");
  const runAttempt = positiveInteger(
    processorRunAttempt,
    "processor-run-attempt-invalid",
  );
  const baseSha = exactSha(expectedBaseSha, "expected-base-sha-invalid");
  const headSha = exactSha(expectedHeadSha, "source-head-sha-invalid");
  const trustedWorkflowSha = exactSha(workflowSha, "workflow-sha-invalid");
  const readApi = createApi({ fetchImpl, token: readToken });
  const prepareBot = await resolvePrepareAppBot(readApi, {
    prepareAppSlug,
    prepareBotId,
    prepareBotLogin,
  });
  const terminal = await terminalCompanionState(readApi, {
    baseDirectory,
    expectedBaseSha: baseSha,
    expectedHeadSha: headSha,
    prepareBot,
    processorRunAttempt: runAttempt,
    processorRunId: runId,
    pullRequestNumber: number,
    workflowSha: trustedWorkflowSha,
  });
  if (terminal) return createTerminalCensusReceipt(terminal);
  const feedbackAdapter = createProcessorFeedbackAdapter(fetchImpl, readToken);
  const collected = await collectLiveState({
    baseDirectory,
    expectedHeadSha: headSha,
    feedbackAdapter,
    pullRequestNumber: number,
    processorRunAttempt: runAttempt,
    processorRunId: runId,
    readApi,
    reusableBase: null,
    workflowSha: trustedWorkflowSha,
  });
  if (collected.base.commitSha !== baseSha) reject("expected-base-sha-changed");
  const plan = createOsvActionsCompanionPlan(collected.input);
  if (!verifyOsvActionsCompanionPlan(collected.input, plan).eligible) {
    reject("companion-plan-invalid");
  }
  await revalidateSealedLiveState(readApi, {
    authority: collected.authority,
    feedbackAdapter,
    input: collected.input,
    plan,
    processorRunAttempt: runAttempt,
    processorRunId: runId,
    workflowSha: trustedWorkflowSha,
  });
  return createCensusReceipt({
    authority: collected.authority,
    input: collected.input,
    orchestratorRunAttempt: runAttempt,
    orchestratorRunId: runId,
    plan,
    processorRunAttempt: collected.authority.processor.runAttempt,
    processorRunId: collected.authority.processor.runId,
    sourceHeadSha: headSha,
    sourcePullRequestNumber: number,
    workflowSha: trustedWorkflowSha,
  });
}

async function sourceHeadIdentity(readApi, headSha) {
  return commitTreeIdentity(readApi, headSha, "source-head-commit-invalid");
}

async function sourceHeadContent(readApi, headSha) {
  const { entries } = await sourceHeadIdentity(readApi, headSha);
  const workflow = entries.find(
    ({ path, type }) => path === OSV_WORKFLOW_PATH && type === "blob",
  );
  if (!workflow) reject("source-head-workflow-missing");
  const { data: blob } = await readApi.request(
    "GET",
    `/repos/${REQUIRED_REPOSITORY}/git/blobs/${workflow.sha}`,
  );
  return strictUtf8(
    decodeBlob(blob, workflow.sha, workflow.size),
    "source-head-workflow-invalid",
  );
}

function normalizedActor(actor) {
  return {
    id: actor?.id ?? null,
    login: actor?.login ?? null,
    type: actor?.type ?? null,
  };
}

function processorApprovalBinding(review) {
  const match =
    /^Approved by dependabot-processor:v2 for exact head ([0-9a-f]{40})\.$/u.exec(
      String(review?.body ?? ""),
    );
  return match && review?.commit_id === match[1] ? match[1] : null;
}

function rejectCurrentProcessorApproval(reviews, headSha) {
  for (const review of reviews) {
    const state = String(review?.state ?? "").toUpperCase();
    const body = String(review?.body ?? "");
    const actor = normalizedActor(review?.user);
    const claimsProcessor = body.includes("dependabot-processor:v2");
    const currentActionsApproval =
      state === "APPROVED" &&
      actor.login === "github-actions[bot]" &&
      review?.commit_id === headSha;
    if (!claimsProcessor && !currentActionsApproval) continue;
    const binding = processorApprovalBinding(review);
    if (
      actor.login !== "github-actions[bot]" ||
      actor.type !== "Bot" ||
      binding === null ||
      !new Set(["APPROVED", "DISMISSED"]).has(state)
    ) {
      reject("processor-approval-evidence-malformed");
    }
    if (state === "APPROVED" && binding === headSha) {
      reject("source-pr-has-current-processor-approval");
    }
  }
}

function dependencyMetadata(message) {
  const rows = [
    ...String(message ?? "").matchAll(
      /^Updates `([^`]+)` from ([0-9a-f]{40}) to ([0-9a-f]{40})$/gmu,
    ),
  ];
  return {
    dependencies: rows.map(([, name, from, to]) => ({ from, name, to })),
    dependencyGroup: "github-actions-manual",
    packageEcosystem: "github-actions",
  };
}

async function trustedProcessorState(
  readApi,
  pullRequestNumber,
  headSha,
  workflowSha,
  expectedRunId,
  expectedRunAttempt,
) {
  const checks = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const { data } = await readApi.request(
      "GET",
      pathWithQuery(
        `/repos/${REQUIRED_REPOSITORY}/commits/${headSha}/check-runs`,
        {
          check_name: PROCESSOR_CHECK_NAME,
          filter: "all",
          page,
          per_page: PAGE_SIZE,
        },
      ),
    );
    if (!Array.isArray(data?.check_runs)) reject("processor-checks-invalid");
    checks.push(...data.check_runs);
    if (data.check_runs.length < PAGE_SIZE) break;
    if (page === MAX_PAGES) reject("processor-checks-invalid");
  }
  const candidates = checks
    .filter(
      (check) =>
        check?.name === PROCESSOR_CHECK_NAME && check?.head_sha === headSha,
    )
    .sort((left, right) => Number(left.id) - Number(right.id));
  if (
    candidates.length === 0 ||
    candidates.some(
      (check) => !Number.isSafeInteger(check.id) || check.id < 1,
    ) ||
    new Set(candidates.map(({ id }) => id)).size !== candidates.length
  ) {
    reject("processor-check-invalid");
  }
  const check = candidates.at(-1);
  const receipt = PROCESSOR_RECEIPT_PATTERN.exec(check.external_id ?? "");
  if (
    !receipt ||
    Number(receipt[1]) !== pullRequestNumber ||
    receipt[2] !== headSha ||
    check.app?.id !== GITHUB_ACTIONS_APP_ID ||
    check.status !== "completed" ||
    check.conclusion !== "failure" ||
    check.output?.summary !== ACTIONABLE_MANUAL_SUMMARY ||
    !new Set([null, "", undefined]).has(check.output?.text)
  ) {
    reject("processor-check-invalid");
  }
  const runId = Number(receipt[4]);
  const runAttempt = Number(receipt[5]);
  if (
    !Number.isSafeInteger(runId) ||
    runId < 1 ||
    !Number.isSafeInteger(runAttempt) ||
    runAttempt < 1
  ) {
    reject("processor-check-invalid");
  }
  const reusableReceipt =
    runId !== expectedRunId || runAttempt !== expectedRunAttempt;
  const runPath = reusableReceipt
    ? `/repos/${REQUIRED_REPOSITORY}/actions/runs/${runId}/attempts/${runAttempt}`
    : `/repos/${REQUIRED_REPOSITORY}/actions/runs/${runId}`;
  const { data: run } = await readApi.request("GET", runPath);
  if (
    run?.id !== runId ||
    run?.run_attempt !== runAttempt ||
    run?.path !== PROCESSOR_WORKFLOW_PATH ||
    run?.head_branch !== "main" ||
    run?.head_sha !== workflowSha ||
    run?.repository?.full_name !== REQUIRED_REPOSITORY ||
    !(
      (runId === expectedRunId &&
        runAttempt === expectedRunAttempt &&
        ((run?.status === "in_progress" && run?.conclusion === null) ||
          (run?.status === "completed" &&
            typeof run?.conclusion === "string"))) ||
      ((runId !== expectedRunId || runAttempt !== expectedRunAttempt) &&
        run?.status === "completed" &&
        typeof run?.conclusion === "string")
    ) ||
    !new Set(["repository_dispatch", "schedule", "workflow_run"]).has(
      run?.event,
    )
  ) {
    reject("processor-run-invalid");
  }
  return {
    checkId: check.id,
    runAttempt,
    runId,
  };
}

async function collectLiveState({
  baseDirectory = null,
  expectedHeadSha,
  feedbackAdapter,
  oldReferenceFiles = null,
  pullRequestNumber,
  processorRunAttempt,
  processorRunId,
  readApi,
  reusableBase,
  workflowSha,
}) {
  const [pullResult, files, commits, reviews] = await Promise.all([
    readApi.request(
      "GET",
      `/repos/${REQUIRED_REPOSITORY}/pulls/${pullRequestNumber}`,
    ),
    paginate(
      readApi,
      `/repos/${REQUIRED_REPOSITORY}/pulls/${pullRequestNumber}/files`,
      "source-files-response-invalid",
    ),
    paginate(
      readApi,
      `/repos/${REQUIRED_REPOSITORY}/pulls/${pullRequestNumber}/commits`,
      "source-commits-response-invalid",
    ),
    paginate(
      readApi,
      `/repos/${REQUIRED_REPOSITORY}/pulls/${pullRequestNumber}/reviews`,
      "source-reviews-response-invalid",
    ),
  ]);
  const pull = plainObject(pullResult.data, "source-pr-response-invalid");
  if (
    pull.number !== pullRequestNumber ||
    pull.head?.sha !== expectedHeadSha ||
    pull.head?.repo?.full_name !== REQUIRED_REPOSITORY ||
    pull.base?.repo?.full_name !== REQUIRED_REPOSITORY
  ) {
    reject("source-pr-identity-changed");
  }
  const base = reusableBase
    ? await revalidateCurrentBaseSnapshot(readApi, reusableBase)
    : await currentBaseSnapshot(readApi, { baseDirectory, oldReferenceFiles });
  if (pull.base?.sha !== base.commitSha || pull.base?.ref !== "main") {
    reject("source-base-is-stale");
  }
  rejectCurrentProcessorApproval(reviews, expectedHeadSha);
  if (pull.auto_merge !== null && pull.auto_merge !== undefined) {
    reject("source-pr-auto-merge-enabled");
  }
  if (files.length !== 1 || commits.length !== 1) {
    reject("source-pr-cardinality-invalid");
  }
  const sourceFile = files[0];
  const sourceCommit = commits[0];
  const baseWorkflowBytes = base.files.get(OSV_WORKFLOW_PATH);
  const mirrorBytes = base.files.get(OSV_MIRROR_TEST_PATH);
  if (!baseWorkflowBytes || !mirrorBytes) reject("current-main-input-missing");
  const baseWorkflow = strictUtf8(
    baseWorkflowBytes,
    "current-main-workflow-invalid",
  );
  const mirrorContent = strictUtf8(mirrorBytes, "current-main-mirror-invalid");
  const scannerRevision = exactActionRevision(
    baseWorkflow,
    OSV_SCANNER_ACTION,
    "current-main-osv-reference-invalid",
  );
  if (
    exactActionRevision(
      baseWorkflow,
      OSV_REPORTER_ACTION,
      "current-main-osv-reference-invalid",
    ) !== scannerRevision
  ) {
    reject("current-main-osv-reference-invalid");
  }
  const sourceContent = await sourceHeadContent(readApi, expectedHeadSha);
  const processor = await trustedProcessorState(
    readApi,
    pullRequestNumber,
    expectedHeadSha,
    workflowSha,
    processorRunId,
    processorRunAttempt,
  );
  const labels = Array.isArray(pull.labels)
    ? pull.labels.map((label) => label?.name)
    : null;
  if (labels === null || labels.some((label) => typeof label !== "string")) {
    reject("source-labels-response-invalid");
  }
  const input = {
    currentBase: {
      commitSha: base.commitSha,
      ref: "main",
      treeSha: base.treeSha,
    },
    mirror: {
      baseContent: mirrorContent,
      path: OSV_MIRROR_TEST_PATH,
    },
    mode: "prepare",
    oldReferenceFiles: validateOldReferenceFiles(
      base.oldReferenceFiles ?? oldReferenceCensus(base, scannerRevision),
      "old-reference-census-invalid",
    ),
    processor: {
      approved: false,
      autoMergeEnabled: false,
      disposition: "manual-review",
    },
    repository: REQUIRED_REPOSITORY,
    schema: ACTIONS_COMPANION_INPUT_SCHEMA,
    sourcePullRequest: {
      author: normalizedActor(pull.user),
      base: {
        ref: pull.base.ref,
        repository: pull.base.repo.full_name,
        sha: pull.base.sha,
      },
      commits: [
        {
          author: normalizedActor(sourceCommit.author),
          committer: normalizedActor(sourceCommit.committer),
          message: sourceCommit.commit?.message,
          parentShas: Array.isArray(sourceCommit.parents)
            ? sourceCommit.parents.map(({ sha: parentSha }) => parentSha)
            : null,
          sha: sourceCommit.sha,
          verificationReason: sourceCommit.commit?.verification?.reason,
          verified: sourceCommit.commit?.verification?.verified,
        },
      ],
      draft: pull.draft,
      files: [
        {
          baseContent: baseWorkflow,
          path: sourceFile.filename,
          previousPath: sourceFile.previous_filename ?? null,
          sourceContent,
          status: sourceFile.status,
        },
      ],
      head: {
        ref: pull.head.ref,
        repository: pull.head.repo.full_name,
        sha: pull.head.sha,
      },
      labels,
      metadata: dependencyMetadata(sourceCommit.commit?.message),
      number: pull.number,
      state: pull.state,
    },
  };
  const feedbackAuthority = await collectSourceFeedbackAuthority({
    feedbackAdapter,
    initialPull: pull,
    input,
  });
  const authority = {
    baseCommitSha: base.commitSha,
    commitSha: sourceCommit.sha,
    feedback: feedbackAuthority.feedback,
    feedbackDigest: feedbackAuthority.feedbackDigest,
    files: files.map(
      ({ filename, previous_filename: previousPath, status }) => ({
        filename,
        previousPath: previousPath ?? null,
        status,
      }),
    ),
    headSha: pull.head.sha,
    labels,
    processor,
    pullRequest: feedbackAuthority.pullRequest,
    pullRequestUpdatedAt: pull.updated_at,
    reviews: reviews.map(({ id, state, submitted_at: submittedAt, user }) => ({
      id,
      state,
      submittedAt,
      user: normalizedActor(user),
    })),
  };
  return { authority, base, input };
}

function requiredBlobEntry(entries, path, code) {
  const entry = entries.find(
    (candidate) => candidate.path === path && candidate.type === "blob",
  );
  if (!entry || entry.mode !== "100644") reject(code);
  return entry;
}

function textBlobBinding(content, entry, code) {
  if (typeof content !== "string") reject(code);
  const bytes = Buffer.from(content, "utf8");
  if (
    bytes.toString("utf8") !== content ||
    bytes.byteLength !== entry.size ||
    gitBlobSha(bytes) !== entry.sha
  ) {
    reject(code);
  }
}

function expectedSourceLeaves(baseEntries, sourceWorkflowEntry) {
  return leafEntries(baseEntries).map((entry) =>
    entry.path === OSV_WORKFLOW_PATH
      ? {
          mode: sourceWorkflowEntry.mode,
          path: sourceWorkflowEntry.path,
          sha: sourceWorkflowEntry.sha,
          type: sourceWorkflowEntry.type,
        }
      : entry,
  );
}

async function collectHistoricalTerminalPlan({
  baseDirectory,
  expectedBaseSha,
  expectedHeadSha,
  processorRunAttempt,
  processorRunId,
  pullRequestNumber,
  readApi,
  workflowSha,
}) {
  const [pullResult, commits, reviews, base, source, processor] =
    await Promise.all([
      readApi.request(
        "GET",
        `/repos/${REQUIRED_REPOSITORY}/pulls/${pullRequestNumber}`,
      ),
      paginate(
        readApi,
        `/repos/${REQUIRED_REPOSITORY}/pulls/${pullRequestNumber}/commits`,
        "source-commits-response-invalid",
      ),
      paginate(
        readApi,
        `/repos/${REQUIRED_REPOSITORY}/pulls/${pullRequestNumber}/reviews`,
        "source-reviews-response-invalid",
      ),
      historicalBaseSnapshot(readApi, baseDirectory, expectedBaseSha),
      sourceHeadIdentity(readApi, expectedHeadSha),
      trustedProcessorState(
        readApi,
        pullRequestNumber,
        expectedHeadSha,
        workflowSha,
        processorRunId,
        processorRunAttempt,
      ),
    ]);
  const pull = plainObject(pullResult.data, "source-pr-response-invalid");
  if (
    pull.number !== pullRequestNumber ||
    pull.state !== "open" ||
    pull.head?.sha !== expectedHeadSha ||
    pull.head?.repo?.full_name !== REQUIRED_REPOSITORY ||
    pull.base?.ref !== "main" ||
    pull.base?.repo?.full_name !== REQUIRED_REPOSITORY ||
    (pull.auto_merge !== null && pull.auto_merge !== undefined) ||
    commits.length !== 1 ||
    source.commitSha !== expectedHeadSha
  ) {
    reject("terminal-source-pr-changed");
  }
  rejectCurrentProcessorApproval(reviews, expectedHeadSha);
  const sourceCommit = commits[0];
  const labels = Array.isArray(pull.labels)
    ? pull.labels.map((label) => label?.name)
    : null;
  if (labels === null || labels.some((label) => typeof label !== "string")) {
    reject("source-labels-response-invalid");
  }
  const baseWorkflowEntry = requiredBlobEntry(
    base.entries,
    OSV_WORKFLOW_PATH,
    "historical-base-workflow-invalid",
  );
  const baseMirrorEntry = requiredBlobEntry(
    base.entries,
    OSV_MIRROR_TEST_PATH,
    "historical-base-mirror-invalid",
  );
  const sourceWorkflowEntry = requiredBlobEntry(
    source.entries,
    OSV_WORKFLOW_PATH,
    "historical-source-workflow-invalid",
  );
  sameCanonical(
    leafEntries(source.entries),
    expectedSourceLeaves(base.entries, sourceWorkflowEntry),
    "historical-source-tree-has-unplanned-changes",
  );
  sameCanonical(
    treeShape(source.entries),
    treeShape(base.entries),
    "historical-source-tree-has-unplanned-changes",
  );
  const baseWorkflow = strictUtf8(
    base.files.get(OSV_WORKFLOW_PATH),
    "historical-base-workflow-invalid",
  );
  const mirrorContent = strictUtf8(
    base.files.get(OSV_MIRROR_TEST_PATH),
    "historical-base-mirror-invalid",
  );
  textBlobBinding(
    baseWorkflow,
    baseWorkflowEntry,
    "historical-base-workflow-invalid",
  );
  textBlobBinding(
    mirrorContent,
    baseMirrorEntry,
    "historical-base-mirror-invalid",
  );
  const { data: sourceBlob } = await readApi.request(
    "GET",
    `/repos/${REQUIRED_REPOSITORY}/git/blobs/${sourceWorkflowEntry.sha}`,
  );
  const sourceContent = strictUtf8(
    decodeBlob(sourceBlob, sourceWorkflowEntry.sha, sourceWorkflowEntry.size),
    "historical-source-workflow-invalid",
  );
  const scannerRevision = exactActionRevision(
    baseWorkflow,
    OSV_SCANNER_ACTION,
    "historical-base-osv-reference-invalid",
  );
  if (
    exactActionRevision(
      baseWorkflow,
      OSV_REPORTER_ACTION,
      "historical-base-osv-reference-invalid",
    ) !== scannerRevision
  ) {
    reject("historical-base-osv-reference-invalid");
  }
  const input = {
    currentBase: {
      commitSha: base.commitSha,
      ref: "main",
      treeSha: base.treeSha,
    },
    mirror: {
      baseContent: mirrorContent,
      path: OSV_MIRROR_TEST_PATH,
    },
    mode: "prepare",
    oldReferenceFiles: validateOldReferenceFiles(
      oldReferenceCensus(base, scannerRevision),
      "old-reference-census-invalid",
    ),
    processor: {
      approved: false,
      autoMergeEnabled: false,
      disposition: "manual-review",
    },
    repository: REQUIRED_REPOSITORY,
    schema: ACTIONS_COMPANION_INPUT_SCHEMA,
    sourcePullRequest: {
      author: normalizedActor(pull.user),
      base: {
        ref: "main",
        repository: REQUIRED_REPOSITORY,
        sha: base.commitSha,
      },
      commits: [
        {
          author: normalizedActor(sourceCommit.author),
          committer: normalizedActor(sourceCommit.committer),
          message: sourceCommit.commit?.message,
          parentShas: Array.isArray(sourceCommit.parents)
            ? sourceCommit.parents.map(({ sha: parentSha }) => parentSha)
            : null,
          sha: sourceCommit.sha,
          verificationReason: sourceCommit.commit?.verification?.reason,
          verified: sourceCommit.commit?.verification?.verified,
        },
      ],
      draft: pull.draft,
      files: [
        {
          baseContent: baseWorkflow,
          path: OSV_WORKFLOW_PATH,
          previousPath: null,
          sourceContent,
          status: "modified",
        },
      ],
      head: {
        ref: pull.head.ref,
        repository: pull.head.repo.full_name,
        sha: pull.head.sha,
      },
      labels,
      metadata: dependencyMetadata(sourceCommit.commit?.message),
      number: pull.number,
      state: pull.state,
    },
  };
  const plan = createOsvActionsCompanionPlan(input);
  if (!verifyOsvActionsCompanionPlan(input, plan).eligible) {
    reject("terminal-companion-plan-invalid");
  }
  return { base, input, plan, processor };
}

async function revalidateSealedLiveState(
  readApi,
  {
    authority,
    feedbackAdapter,
    input,
    plan,
    processorRunAttempt,
    processorRunId,
    workflowSha,
  },
) {
  const pullRequestNumber = input?.sourcePullRequest?.number;
  const expectedHeadSha = input?.sourcePullRequest?.head?.sha;
  const [pullResult, files, commits, reviews, base, source, processor] =
    await Promise.all([
      readApi.request(
        "GET",
        `/repos/${REQUIRED_REPOSITORY}/pulls/${pullRequestNumber}`,
      ),
      paginate(
        readApi,
        `/repos/${REQUIRED_REPOSITORY}/pulls/${pullRequestNumber}/files`,
        "source-files-response-invalid",
      ),
      paginate(
        readApi,
        `/repos/${REQUIRED_REPOSITORY}/pulls/${pullRequestNumber}/commits`,
        "source-commits-response-invalid",
      ),
      paginate(
        readApi,
        `/repos/${REQUIRED_REPOSITORY}/pulls/${pullRequestNumber}/reviews`,
        "source-reviews-response-invalid",
      ),
      currentBaseIdentity(readApi, {
        commitSha: input.currentBase?.commitSha,
        treeSha: input.currentBase?.treeSha,
      }),
      sourceHeadIdentity(readApi, expectedHeadSha),
      trustedProcessorState(
        readApi,
        pullRequestNumber,
        expectedHeadSha,
        workflowSha,
        processorRunId,
        processorRunAttempt,
      ),
    ]);
  const pull = plainObject(pullResult.data, "source-pr-response-invalid");
  if (
    pull.number !== pullRequestNumber ||
    pull.head?.sha !== expectedHeadSha ||
    pull.head?.repo?.full_name !== REQUIRED_REPOSITORY ||
    pull.base?.repo?.full_name !== REQUIRED_REPOSITORY ||
    pull.base?.ref !== "main" ||
    pull.base?.sha !== base.commitSha ||
    (pull.auto_merge !== null && pull.auto_merge !== undefined) ||
    files.length !== 1 ||
    commits.length !== 1
  ) {
    reject("sealed-live-authority-changed");
  }
  rejectCurrentProcessorApproval(reviews, expectedHeadSha);
  if (
    base.commitSha !== input.currentBase?.commitSha ||
    base.treeSha !== input.currentBase?.treeSha ||
    plan.parentCommitSha !== base.commitSha ||
    plan.parentTreeSha !== base.treeSha ||
    source.commitSha !== expectedHeadSha
  ) {
    reject("current-main-changed");
  }
  const baseWorkflowEntry = requiredBlobEntry(
    base.entries,
    OSV_WORKFLOW_PATH,
    "sealed-base-workflow-invalid",
  );
  const baseMirrorEntry = requiredBlobEntry(
    base.entries,
    OSV_MIRROR_TEST_PATH,
    "sealed-base-mirror-invalid",
  );
  const sourceWorkflowEntry = requiredBlobEntry(
    source.entries,
    OSV_WORKFLOW_PATH,
    "sealed-source-workflow-invalid",
  );
  const sealedSourceFile = input.sourcePullRequest?.files?.[0];
  textBlobBinding(
    sealedSourceFile?.baseContent,
    baseWorkflowEntry,
    "sealed-base-workflow-invalid",
  );
  textBlobBinding(
    sealedSourceFile?.sourceContent,
    sourceWorkflowEntry,
    "sealed-source-workflow-invalid",
  );
  textBlobBinding(
    input.mirror?.baseContent,
    baseMirrorEntry,
    "sealed-base-mirror-invalid",
  );
  const sourceFile = files[0];
  const sourceCommit = commits[0];
  const labels = Array.isArray(pull.labels)
    ? pull.labels.map((label) => label?.name)
    : null;
  if (labels === null || labels.some((label) => typeof label !== "string")) {
    reject("source-labels-response-invalid");
  }
  const liveInput = {
    currentBase: {
      commitSha: base.commitSha,
      ref: "main",
      treeSha: base.treeSha,
    },
    mirror: {
      baseContent: input.mirror.baseContent,
      path: OSV_MIRROR_TEST_PATH,
    },
    mode: "prepare",
    oldReferenceFiles: input.oldReferenceFiles,
    processor: {
      approved: false,
      autoMergeEnabled: false,
      disposition: "manual-review",
    },
    repository: REQUIRED_REPOSITORY,
    schema: ACTIONS_COMPANION_INPUT_SCHEMA,
    sourcePullRequest: {
      author: normalizedActor(pull.user),
      base: {
        ref: pull.base.ref,
        repository: pull.base.repo.full_name,
        sha: pull.base.sha,
      },
      commits: [
        {
          author: normalizedActor(sourceCommit.author),
          committer: normalizedActor(sourceCommit.committer),
          message: sourceCommit.commit?.message,
          parentShas: Array.isArray(sourceCommit.parents)
            ? sourceCommit.parents.map(({ sha: parentSha }) => parentSha)
            : null,
          sha: sourceCommit.sha,
          verificationReason: sourceCommit.commit?.verification?.reason,
          verified: sourceCommit.commit?.verification?.verified,
        },
      ],
      draft: pull.draft,
      files: [
        {
          baseContent: sealedSourceFile.baseContent,
          path: sourceFile.filename,
          previousPath: sourceFile.previous_filename ?? null,
          sourceContent: sealedSourceFile.sourceContent,
          status: sourceFile.status,
        },
      ],
      head: {
        ref: pull.head.ref,
        repository: pull.head.repo.full_name,
        sha: pull.head.sha,
      },
      labels,
      metadata: dependencyMetadata(sourceCommit.commit?.message),
      number: pull.number,
      state: pull.state,
    },
  };
  const feedbackAuthority = await collectSourceFeedbackAuthority({
    expectedAuthority: authority,
    feedbackAdapter,
    initialPull: pull,
    input: liveInput,
  });
  const liveAuthority = {
    baseCommitSha: base.commitSha,
    commitSha: sourceCommit.sha,
    feedback: feedbackAuthority.feedback,
    feedbackDigest: feedbackAuthority.feedbackDigest,
    files: files.map(
      ({ filename, previous_filename: previousPath, status }) => ({
        filename,
        previousPath: previousPath ?? null,
        status,
      }),
    ),
    headSha: pull.head.sha,
    labels,
    processor,
    pullRequest: feedbackAuthority.pullRequest,
    pullRequestUpdatedAt: pull.updated_at,
    reviews: reviews.map(({ id, state, submitted_at: submittedAt, user }) => ({
      id,
      state,
      submittedAt,
      user: normalizedActor(user),
    })),
  };
  sameCanonical(input, liveInput, "sealed-live-input-changed");
  sameCanonical(authority, liveAuthority, "sealed-live-authority-changed");
  if (!verifyOsvActionsCompanionPlan(liveInput, plan).eligible) {
    reject("sealed-live-plan-invalid");
  }
  return { authority: liveAuthority, base, input: liveInput, source };
}

function sameCanonical(left, right, code) {
  if (canonicalJson(left) !== canonicalJson(right)) reject(code);
}

function validateCreatedCommit(data, plan, treeSha, expectedCommitSha = null) {
  if (
    !SHA_PATTERN.test(data?.sha ?? "") ||
    (expectedCommitSha !== null && data.sha !== expectedCommitSha) ||
    data?.message !== plan.commitMessage ||
    data?.tree?.sha !== treeSha ||
    !Array.isArray(data?.parents) ||
    data.parents.length !== 1 ||
    data.parents[0]?.sha !== plan.parentCommitSha
  ) {
    reject("staged-commit-response-invalid");
  }
  return data.sha;
}

function leafEntries(entries) {
  return entries
    .filter(({ type }) => type !== "tree")
    .map(({ mode, path, sha, type }) => ({ mode, path, sha, type }));
}

function treeShape(entries) {
  return entries
    .filter(({ type }) => type === "tree")
    .map(({ mode, path, type }) => ({ mode, path, type }));
}

function expectedStagedLeaves(baseEntries, plan) {
  const replacements = new Map(
    plan.edits.map((edit) => [
      edit.path,
      {
        mode: edit.mode,
        path: edit.path,
        sha: edit.resultBlobSha,
        type: "blob",
      },
    ]),
  );
  const result = [];
  for (const entry of leafEntries(baseEntries)) {
    result.push(replacements.get(entry.path) ?? entry);
    replacements.delete(entry.path);
  }
  if (replacements.size > 0) reject("staged-tree-base-path-missing");
  return result.sort((left, right) => left.path.localeCompare(right.path));
}

async function verifyStagedCommitTreeAndBlobs(
  readApi,
  plan,
  staged,
  baseEntries,
) {
  const { data: commit } = await readApi.request(
    "GET",
    `/repos/${REQUIRED_REPOSITORY}/git/commits/${staged.commitSha}`,
  );
  validateCreatedCommit(commit, plan, staged.treeSha, staged.commitSha);
  const { data: tree } = await readApi.request(
    "GET",
    pathWithQuery(`/repos/${REQUIRED_REPOSITORY}/git/trees/${staged.treeSha}`, {
      recursive: 1,
    }),
  );
  const stagedEntries = normalizeRecursiveTree(
    tree,
    staged.treeSha,
    "staged-tree-invalid",
  );
  sameCanonical(
    leafEntries(stagedEntries),
    expectedStagedLeaves(baseEntries, plan),
    "staged-tree-has-unplanned-changes",
  );
  sameCanonical(
    treeShape(stagedEntries),
    treeShape(baseEntries),
    "staged-tree-has-unplanned-changes",
  );
  await mapConcurrent(plan.edits, BLOB_READ_CONCURRENCY, async (edit) => {
    const { data } = await readApi.request(
      "GET",
      `/repos/${REQUIRED_REPOSITORY}/git/blobs/${edit.resultBlobSha}`,
    );
    const bytes = decodeBlob(
      data,
      edit.resultBlobSha,
      Buffer.from(edit.resultContentBase64, "base64").byteLength,
    );
    if (sha256Bytes(bytes) !== edit.resultContentSha256) {
      reject("staged-blob-content-invalid");
    }
  });
}

async function verifyStagedGitObjects(readApi, plan, staged, baseEntries) {
  const { data: ref } = await readApi.request("GET", refPath(plan.branchRef));
  if (
    ref?.ref !== `refs/heads/${plan.branchRef}` ||
    ref?.object?.type !== "commit" ||
    ref?.object?.sha !== staged.commitSha
  ) {
    reject("staged-ref-invalid");
  }
  await verifyStagedCommitTreeAndBlobs(readApi, plan, staged, baseEntries);
}

async function verifyTerminalCompanionPullRequest(
  readApi,
  { baseEntries, input, plan, prepareBot, pull },
) {
  if (
    pull?.state !== "closed" ||
    pull?.draft !== false ||
    pull?.title !== plan.pullRequestTitle ||
    pull?.body !== plan.pullRequestBody ||
    pull?.head?.ref !== plan.branchRef ||
    !SHA_PATTERN.test(pull?.head?.sha ?? "") ||
    pull?.head?.repo?.full_name !== REQUIRED_REPOSITORY ||
    pull?.base?.ref !== "main" ||
    pull?.base?.repo?.full_name !== REQUIRED_REPOSITORY ||
    pull?.maintainer_can_modify !== false ||
    !Number.isSafeInteger(pull?.number) ||
    pull.number < 1 ||
    pull?.html_url !==
      `https://github.com/${REQUIRED_REPOSITORY}/pull/${pull.number}` ||
    (pull.merged_at !== null &&
      pull.merged_at !== undefined &&
      (typeof pull.merged_at !== "string" ||
        Number.isNaN(Date.parse(pull.merged_at))))
  ) {
    reject("terminal-companion-pr-mismatch");
  }
  requireActor(pull.user, prepareBot, "terminal-companion-author-mismatch");
  const { data: commit } = await readApi.request(
    "GET",
    `/repos/${REQUIRED_REPOSITORY}/git/commits/${pull.head.sha}`,
  );
  const treeSha = exactSha(
    commit?.tree?.sha,
    "terminal-companion-commit-mismatch",
  );
  const staged = stagedRecord(plan, { commitSha: pull.head.sha, treeSha });
  if (!verifyStagedOsvActionsCompanion(input, plan, staged).eligible) {
    reject("terminal-companion-staged-record-invalid");
  }
  await verifyStagedCommitTreeAndBlobs(readApi, plan, staged, baseEntries);
  return staged;
}

async function existingStagedBranch(readApi, input, plan, baseEntries) {
  const response = await readApi.request("GET", refPath(plan.branchRef), {
    allow: [404],
  });
  if (response.status === 404) return null;
  const ref = response.data;
  if (
    ref?.ref !== `refs/heads/${plan.branchRef}` ||
    ref?.object?.type !== "commit" ||
    !SHA_PATTERN.test(ref?.object?.sha ?? "")
  ) {
    reject("staged-ref-invalid");
  }
  const { data: commit } = await readApi.request(
    "GET",
    `/repos/${REQUIRED_REPOSITORY}/git/commits/${ref.object.sha}`,
  );
  const treeSha = exactSha(commit?.tree?.sha, "staged-commit-response-invalid");
  validateCreatedCommit(commit, plan, treeSha, ref.object.sha);
  const staged = stagedRecord(plan, {
    commitSha: ref.object.sha,
    treeSha,
  });
  if (!verifyStagedOsvActionsCompanion(input, plan, staged).eligible) {
    reject("staged-record-invalid");
  }
  await verifyStagedGitObjects(readApi, plan, staged, baseEntries);
  return staged;
}

async function stageGitObjects(stageApi, plan) {
  for (const edit of plan.edits) {
    const { data } = await stageApi.request(
      "POST",
      `/repos/${REQUIRED_REPOSITORY}/git/blobs`,
      {
        body: { content: edit.resultContentBase64, encoding: "base64" },
        expected: [201],
      },
    );
    if (data?.sha !== edit.resultBlobSha) reject("staged-blob-sha-mismatch");
  }
  const { data: tree } = await stageApi.request(
    "POST",
    `/repos/${REQUIRED_REPOSITORY}/git/trees`,
    {
      body: {
        base_tree: plan.parentTreeSha,
        tree: plan.edits.map((edit) => ({
          mode: edit.mode,
          path: edit.path,
          sha: edit.resultBlobSha,
          type: "blob",
        })),
      },
      expected: [201],
    },
  );
  const treeSha = exactSha(tree?.sha, "staged-tree-response-invalid");
  const { data: commit } = await stageApi.request(
    "POST",
    `/repos/${REQUIRED_REPOSITORY}/git/commits`,
    {
      body: {
        message: plan.commitMessage,
        parents: [plan.parentCommitSha],
        tree: treeSha,
      },
      expected: [201],
    },
  );
  const commitSha = validateCreatedCommit(commit, plan, treeSha);
  return { commitSha, treeSha };
}

function stagedRecord(plan, created) {
  return {
    branchRef: plan.branchRef,
    commitMessage: plan.commitMessage,
    commitSha: created.commitSha,
    edits: plan.edits.map((edit) => ({
      blobSha: edit.resultBlobSha,
      contentSha256: edit.resultContentSha256,
      mode: edit.mode,
      path: edit.path,
    })),
    parentCommitSha: plan.parentCommitSha,
    parentTreeSha: plan.parentTreeSha,
    planDigest: plan.planDigest,
    repository: plan.repository,
    schema: ACTIONS_COMPANION_STAGED_SCHEMA,
    treeDigest: plan.treeDigest,
    treeSha: created.treeSha,
  };
}

function compactEditBindings(plan) {
  return plan.edits.map((edit) => ({
    blobSha: edit.resultBlobSha,
    contentSha256: edit.resultContentSha256,
    mode: edit.mode,
    path: edit.path,
  }));
}

function createTerminalStageReceipt(input) {
  const receipt = terminalReceiptCore({
    ...input,
    schema: ACTIONS_COMPANION_LIVE_STAGE_SCHEMA,
  });
  if (Buffer.byteLength(canonicalJson(receipt)) > MAX_STAGE_RECEIPT_BYTES) {
    reject("stage-receipt-too-large");
  }
  return receipt;
}

function terminalStateFromPlannedPull(
  plan,
  pull,
  orchestratorRunAttempt,
  orchestratorRunId,
  processorRunAttempt,
  processorRunId,
  workflowSha,
) {
  const reason = pull.merged_at ? "merged" : "closed-unmerged";
  return {
    branchRef: plan.branchRef,
    companionPullRequest: {
      headSha: pull.head.sha,
      mergedAt: reason === "merged" ? pull.merged_at : null,
      number: pull.number,
      state: reason,
      url: pull.html_url,
    },
    orchestratorRunAttempt,
    orchestratorRunId,
    processorRunAttempt,
    processorRunId,
    reason,
    sourceHeadSha: plan.source.headSha,
    sourcePullRequestNumber: plan.source.pullRequestNumber,
    workflowSha,
  };
}

function compactStageReceipt({
  commitSha,
  feedbackDigest,
  input,
  orchestratorRunAttempt,
  orchestratorRunId,
  plan,
  processorRunAttempt,
  processorRunId,
  sourceHeadSha,
  sourcePullRequestNumber,
  treeSha,
  workflowSha,
}) {
  const receipt = {
    branchRef: plan.branchRef,
    commitMessageDigest: sha256Bytes(Buffer.from(plan.commitMessage)),
    commitSha,
    editBindings: compactEditBindings(plan),
    feedbackDigest,
    inputDigest: sha256Bytes(Buffer.from(canonicalJson(input))),
    oldReferenceFiles: validateOldReferenceFiles(
      input.oldReferenceFiles,
      "old-reference-census-invalid",
    ),
    orchestratorRunAttempt,
    orchestratorRunId,
    parentCommitSha: plan.parentCommitSha,
    parentTreeSha: plan.parentTreeSha,
    planDigest: plan.planDigest,
    processorRunAttempt,
    processorRunId,
    repository: REQUIRED_REPOSITORY,
    result: "staged",
    schema: ACTIONS_COMPANION_LIVE_STAGE_SCHEMA,
    sourceHeadSha,
    sourcePullRequestNumber,
    treeDigest: plan.treeDigest,
    treeSha,
    workflowSha,
  };
  if (Buffer.byteLength(canonicalJson(receipt)) > MAX_STAGE_RECEIPT_BYTES) {
    reject("stage-receipt-too-large");
  }
  return receipt;
}

export async function stageOsvActionsCompanionLive({
  baseDirectory,
  censusReceipt,
  expectedBaseSha,
  expectedHeadSha,
  fetchImpl = globalThis.fetch,
  prepareAppSlug,
  prepareBotId,
  prepareBotLogin,
  pullRequestNumber,
  processorRunAttempt,
  processorRunId,
  readToken,
  repository,
  stageToken,
  workflowSha,
}) {
  repositoryName(repository);
  const number = boundedPullRequestNumber(
    pullRequestNumber,
    "source-pr-number-invalid",
  );
  const baseSha = exactSha(expectedBaseSha, "expected-base-sha-invalid");
  const headSha = exactSha(expectedHeadSha, "source-head-sha-invalid");
  const runId = positiveInteger(processorRunId, "processor-run-id-invalid");
  const runAttempt = positiveInteger(
    processorRunAttempt,
    "processor-run-attempt-invalid",
  );
  const trustedWorkflowSha = exactSha(workflowSha, "workflow-sha-invalid");
  const sealed = validateCensusReceipt(censusReceipt, {
    expectedHeadSha: headSha,
    orchestratorRunAttempt: runAttempt,
    orchestratorRunId: runId,
    expectedBaseSha: baseSha,
    pullRequestNumber: number,
    repository: REQUIRED_REPOSITORY,
    workflowSha: trustedWorkflowSha,
  });
  const readApi = createApi({ fetchImpl, token: readToken });
  const prepareBot = await resolvePrepareAppBot(readApi, {
    prepareAppSlug,
    prepareBotId,
    prepareBotLogin,
  });
  const liveTerminal = await terminalCompanionState(readApi, {
    baseDirectory,
    expectedBaseSha: baseSha,
    expectedHeadSha: headSha,
    prepareBot,
    processorRunAttempt: runAttempt,
    processorRunId: runId,
    pullRequestNumber: number,
    workflowSha: trustedWorkflowSha,
  });
  if (sealed.result === "terminal") {
    if (!liveTerminal) reject("terminal-companion-state-changed");
    const expectedTerminal = createTerminalCensusReceipt(liveTerminal);
    sameCanonical(sealed, expectedTerminal, "terminal-companion-state-changed");
    return createTerminalStageReceipt(liveTerminal);
  }
  if (liveTerminal) return createTerminalStageReceipt(liveTerminal);
  const feedbackAdapter = createProcessorFeedbackAdapter(fetchImpl, readToken);
  const collected = await revalidateSealedLiveState(readApi, {
    authority: sealed.authority,
    feedbackAdapter,
    input: sealed.input,
    plan: sealed.plan,
    processorRunAttempt: runAttempt,
    processorRunId: runId,
    workflowSha: trustedWorkflowSha,
  });
  const { plan } = sealed;
  const stageReceiptFor = (staged) =>
    compactStageReceipt({
      commitSha: staged.commitSha,
      feedbackDigest: sealed.authority.feedbackDigest,
      input: sealed.input,
      orchestratorRunAttempt: runAttempt,
      orchestratorRunId: runId,
      plan,
      processorRunAttempt: sealed.authority.processor.runAttempt,
      processorRunId: sealed.authority.processor.runId,
      sourceHeadSha: headSha,
      sourcePullRequestNumber: number,
      treeSha: staged.treeSha,
      workflowSha: trustedWorkflowSha,
    });
  const terminalReceiptFor = (pull) =>
    createTerminalStageReceipt(
      terminalStateFromPlannedPull(
        plan,
        pull,
        runAttempt,
        runId,
        sealed.authority.processor.runAttempt,
        sealed.authority.processor.runId,
        trustedWorkflowSha,
      ),
    );
  const initialPullState = await companionPullRequestCensus(
    readApi,
    plan,
    prepareBot,
  );
  if (
    initialPullState.kind === "merged" ||
    initialPullState.kind === "closed-unmerged"
  ) {
    await verifyTerminalCompanionPullRequest(readApi, {
      baseEntries: collected.base.entries,
      input: sealed.input,
      plan,
      prepareBot,
      pull: initialPullState.pull,
    });
    return terminalReceiptFor(initialPullState.pull);
  }
  const existing = await existingStagedBranch(
    readApi,
    sealed.input,
    plan,
    collected.base.entries,
  );
  if (initialPullState.kind === "open") {
    if (!existing || initialPullState.pull.head.sha !== existing.commitSha) {
      reject("open-companion-pr-head-mismatch");
    }
    validateOpenedPullRequest(
      initialPullState.pull,
      plan,
      existing,
      prepareBot,
    );
    return stageReceiptFor(existing);
  }
  if (existing) return stageReceiptFor(existing);
  const stageApi = createApi({ fetchImpl, token: stageToken });
  const created = await stageGitObjects(stageApi, plan);
  const revalidated = await revalidateSealedLiveState(readApi, {
    authority: sealed.authority,
    feedbackAdapter,
    input: sealed.input,
    plan,
    processorRunAttempt: runAttempt,
    processorRunId: runId,
    workflowSha: trustedWorkflowSha,
  });
  sameCanonical(collected.input, revalidated.input, "live-input-changed");
  const racedPullState = await companionPullRequestCensus(
    readApi,
    plan,
    prepareBot,
  );
  if (
    racedPullState.kind === "merged" ||
    racedPullState.kind === "closed-unmerged"
  ) {
    await verifyTerminalCompanionPullRequest(readApi, {
      baseEntries: collected.base.entries,
      input: sealed.input,
      plan,
      prepareBot,
      pull: racedPullState.pull,
    });
    return terminalReceiptFor(racedPullState.pull);
  }
  const racedBranch = await existingStagedBranch(
    readApi,
    sealed.input,
    plan,
    collected.base.entries,
  );
  if (racedPullState.kind === "open") {
    if (
      !racedBranch ||
      racedPullState.pull.head.sha !== racedBranch.commitSha
    ) {
      reject("open-companion-pr-head-mismatch");
    }
    validateOpenedPullRequest(
      racedPullState.pull,
      plan,
      racedBranch,
      prepareBot,
    );
    return stageReceiptFor(racedBranch);
  }
  if (racedBranch) return stageReceiptFor(racedBranch);
  await collectSourceFeedbackAuthority({
    expectedAuthority: sealed.authority,
    feedbackAdapter,
    initialPull: sealed.authority.pullRequest,
    input: sealed.input,
  });
  const createdRefResult = await stageApi.request(
    "POST",
    `/repos/${REQUIRED_REPOSITORY}/git/refs`,
    {
      body: {
        ref: `refs/heads/${plan.branchRef}`,
        sha: created.commitSha,
      },
      allow: [422],
      expected: [201],
    },
  );
  if (createdRefResult.status === 422) {
    const converged = await existingStagedBranch(
      readApi,
      sealed.input,
      plan,
      collected.base.entries,
    );
    if (!converged) reject("companion-branch-create-raced");
    return stageReceiptFor(converged);
  }
  const createdRef = createdRefResult.data;
  if (
    createdRef?.ref !== `refs/heads/${plan.branchRef}` ||
    createdRef?.object?.type !== "commit" ||
    createdRef?.object?.sha !== created.commitSha
  ) {
    reject("staged-ref-response-invalid");
  }
  const staged = stagedRecord(plan, created);
  const verification = verifyStagedOsvActionsCompanion(
    sealed.input,
    plan,
    staged,
  );
  if (!verification.eligible) reject("staged-record-invalid");
  await verifyStagedGitObjects(readApi, plan, staged, collected.base.entries);
  return stageReceiptFor(staged);
}

function validateStageReceipt(receipt, expected) {
  if (receipt?.result === "terminal") {
    exactKeys(
      receipt,
      [
        "branchRef",
        "companionPullRequest",
        "orchestratorRunAttempt",
        "orchestratorRunId",
        "processorRunAttempt",
        "processorRunId",
        "reason",
        "repository",
        "result",
        "schema",
        "sourceHeadSha",
        "sourcePullRequestNumber",
        "workflowSha",
      ],
      "stage-terminal-receipt-shape-invalid",
    );
    if (
      Buffer.byteLength(canonicalJson(receipt)) > MAX_STAGE_RECEIPT_BYTES ||
      receipt.schema !== ACTIONS_COMPANION_LIVE_STAGE_SCHEMA ||
      receipt.repository !== expected.repository ||
      receipt.sourcePullRequestNumber !== expected.pullRequestNumber ||
      receipt.sourceHeadSha !== expected.expectedHeadSha ||
      receipt.workflowSha !== expected.workflowSha ||
      receipt.orchestratorRunId !== expected.orchestratorRunId ||
      receipt.orchestratorRunAttempt !== expected.orchestratorRunAttempt ||
      !Number.isSafeInteger(receipt.processorRunId) ||
      receipt.processorRunId < 1 ||
      !Number.isSafeInteger(receipt.processorRunAttempt) ||
      receipt.processorRunAttempt < 1 ||
      receipt.branchRef !==
        companionBranchRef(expected.pullRequestNumber, expected.expectedHeadSha)
    ) {
      reject("stage-terminal-receipt-invalid");
    }
    validateTerminalCompanionPullRequest(
      receipt.companionPullRequest,
      receipt,
      "stage-terminal-pull-request-invalid",
    );
    return receipt;
  }
  exactKeys(
    receipt,
    [
      "branchRef",
      "commitMessageDigest",
      "commitSha",
      "editBindings",
      "feedbackDigest",
      "inputDigest",
      "oldReferenceFiles",
      "orchestratorRunAttempt",
      "orchestratorRunId",
      "parentCommitSha",
      "parentTreeSha",
      "planDigest",
      "processorRunAttempt",
      "processorRunId",
      "repository",
      "result",
      "schema",
      "sourceHeadSha",
      "sourcePullRequestNumber",
      "treeDigest",
      "treeSha",
      "workflowSha",
    ],
    "stage-receipt-shape-invalid",
  );
  if (
    Buffer.byteLength(canonicalJson(receipt)) > MAX_STAGE_RECEIPT_BYTES ||
    receipt.schema !== ACTIONS_COMPANION_LIVE_STAGE_SCHEMA ||
    receipt.result !== "staged" ||
    receipt.repository !== expected.repository ||
    receipt.sourcePullRequestNumber !== expected.pullRequestNumber ||
    receipt.sourceHeadSha !== expected.expectedHeadSha ||
    receipt.workflowSha !== expected.workflowSha ||
    receipt.orchestratorRunId !== expected.orchestratorRunId ||
    receipt.orchestratorRunAttempt !== expected.orchestratorRunAttempt ||
    !Number.isSafeInteger(receipt.processorRunId) ||
    receipt.processorRunId < 1 ||
    !Number.isSafeInteger(receipt.processorRunAttempt) ||
    receipt.processorRunAttempt < 1 ||
    !DIGEST_PATTERN.test(receipt.planDigest ?? "") ||
    !DIGEST_PATTERN.test(receipt.feedbackDigest ?? "") ||
    !DIGEST_PATTERN.test(receipt.inputDigest ?? "") ||
    !DIGEST_PATTERN.test(receipt.treeDigest ?? "") ||
    !DIGEST_PATTERN.test(receipt.commitMessageDigest ?? "") ||
    !SHA_PATTERN.test(receipt.commitSha ?? "") ||
    !SHA_PATTERN.test(receipt.treeSha ?? "") ||
    !SHA_PATTERN.test(receipt.parentCommitSha ?? "") ||
    !SHA_PATTERN.test(receipt.parentTreeSha ?? "") ||
    (expected.expectedBaseSha !== undefined &&
      receipt.parentCommitSha !== expected.expectedBaseSha) ||
    !/^dependabot-companion\/osv-pr-[1-9][0-9]{0,9}-[0-9a-f]{12}$/u.test(
      receipt.branchRef ?? "",
    ) ||
    !Array.isArray(receipt.editBindings) ||
    receipt.editBindings.length !== 2
  ) {
    reject("stage-receipt-invalid");
  }
  validateOldReferenceFiles(
    receipt.oldReferenceFiles,
    "stage-receipt-reference-binding-invalid",
  );
  for (const binding of receipt.editBindings) {
    exactKeys(
      binding,
      ["blobSha", "contentSha256", "mode", "path"],
      "stage-receipt-edit-binding-invalid",
    );
    if (
      !SHA_PATTERN.test(binding.blobSha ?? "") ||
      !DIGEST_PATTERN.test(binding.contentSha256 ?? "") ||
      binding.mode !== "100644" ||
      !new Set([OSV_WORKFLOW_PATH, OSV_MIRROR_TEST_PATH]).has(binding.path)
    ) {
      reject("stage-receipt-edit-binding-invalid");
    }
  }
  if (new Set(receipt.editBindings.map(({ path }) => path)).size !== 2) {
    reject("stage-receipt-edit-binding-invalid");
  }
  return receipt;
}

function stagedRecordFromReceipt(plan, receipt) {
  return stagedRecord(plan, {
    commitSha: receipt.commitSha,
    treeSha: receipt.treeSha,
  });
}

function bindStageReceiptToLive(receipt, input, plan, feedbackDigest) {
  const expected = compactStageReceipt({
    commitSha: receipt.commitSha,
    feedbackDigest,
    input,
    orchestratorRunAttempt: receipt.orchestratorRunAttempt,
    orchestratorRunId: receipt.orchestratorRunId,
    plan,
    processorRunAttempt: receipt.processorRunAttempt,
    processorRunId: receipt.processorRunId,
    sourceHeadSha: receipt.sourceHeadSha,
    sourcePullRequestNumber: receipt.sourcePullRequestNumber,
    treeSha: receipt.treeSha,
    workflowSha: receipt.workflowSha,
  });
  sameCanonical(receipt, expected, "stage-receipt-live-binding-mismatch");
  const staged = stagedRecordFromReceipt(plan, receipt);
  if (!verifyStagedOsvActionsCompanion(input, plan, staged).eligible) {
    reject("stage-receipt-verification-invalid");
  }
  return staged;
}

async function companionPullRequestCensus(readApi, plan, prepareBot) {
  const pulls = await paginate(
    readApi,
    pathWithQuery(`/repos/${REQUIRED_REPOSITORY}/pulls`, {
      base: "main",
      state: "all",
    }),
    "companion-pr-census-invalid",
  );
  const planMarker = `Plan digest: \`${plan.planDigest}\``;
  const candidates = pulls.filter(
    (pull) =>
      pull?.head?.ref === plan.branchRef ||
      (typeof pull?.body === "string" && pull.body.includes(planMarker)),
  );
  const numbers = new Set();
  for (const pull of candidates) {
    if (
      !Number.isSafeInteger(pull?.number) ||
      numbers.has(pull.number) ||
      pull.head?.repo?.full_name !== REQUIRED_REPOSITORY ||
      pull.base?.ref !== "main" ||
      pull.base?.repo?.full_name !== REQUIRED_REPOSITORY
    ) {
      reject("companion-pr-census-invalid");
    }
    numbers.add(pull.number);
  }
  if (candidates.length > 1) reject("duplicate-companion-prs");
  if (candidates.length === 0) return { kind: "none", pull: null };
  const existing = candidates[0];
  if (
    existing.head?.ref !== plan.branchRef ||
    existing.head?.repo?.full_name !== REQUIRED_REPOSITORY ||
    existing.base?.ref !== "main" ||
    existing.base?.repo?.full_name !== REQUIRED_REPOSITORY ||
    existing.title !== plan.pullRequestTitle ||
    existing.body !== plan.pullRequestBody ||
    existing.draft !== false ||
    existing.maintainer_can_modify !== false ||
    !SHA_PATTERN.test(existing.head?.sha ?? "") ||
    existing.html_url !==
      `https://github.com/${REQUIRED_REPOSITORY}/pull/${existing.number}`
  ) {
    reject("companion-pr-mismatch");
  }
  requireActor(existing.user, prepareBot, "companion-pr-author-mismatch");
  if (existing.state === "open" && !existing.merged_at) {
    return { kind: "open", pull: existing };
  }
  if (existing.state === "closed" && existing.merged_at) {
    return { kind: "merged", pull: existing };
  }
  if (existing.state === "closed" && !existing.merged_at) {
    return { kind: "closed-unmerged", pull: existing };
  }
  reject("companion-pr-census-invalid");
}

function validateOpenedPullRequest(pull, plan, staged, prepareBot) {
  if (
    !Number.isSafeInteger(pull?.number) ||
    pull.number < 1 ||
    pull.state !== "open" ||
    pull.draft !== false ||
    pull.maintainer_can_modify !== false ||
    pull.title !== plan.pullRequestTitle ||
    pull.body !== plan.pullRequestBody ||
    pull.head?.ref !== plan.branchRef ||
    pull.head?.sha !== staged.commitSha ||
    pull.head?.repo?.full_name !== REQUIRED_REPOSITORY ||
    pull.base?.ref !== "main" ||
    pull.base?.sha !== plan.parentCommitSha ||
    pull.base?.repo?.full_name !== REQUIRED_REPOSITORY ||
    typeof pull.html_url !== "string" ||
    !pull.html_url.startsWith(`https://github.com/${REQUIRED_REPOSITORY}/pull/`)
  ) {
    reject("opened-companion-pr-invalid");
  }
  requireActor(pull.user, prepareBot, "opened-companion-pr-author-mismatch");
}

function openedReceipt(
  plan,
  staged,
  pull,
  result,
  orchestratorRunAttempt,
  orchestratorRunId,
  processorRunAttempt,
  processorRunId,
  workflowSha,
  prepareBot,
) {
  validateOpenedPullRequest(pull, plan, staged, prepareBot);
  return {
    branchRef: plan.branchRef,
    commitSha: staged.commitSha,
    companionPullRequest: {
      baseSha: pull.base.sha,
      draft: false,
      headSha: pull.head.sha,
      number: pull.number,
      state: "open",
      url: pull.html_url,
    },
    orchestratorRunAttempt,
    orchestratorRunId,
    planDigest: plan.planDigest,
    processorRunAttempt,
    processorRunId,
    repository: REQUIRED_REPOSITORY,
    result,
    schema: ACTIONS_COMPANION_LIVE_OPEN_SCHEMA,
    sourceHeadSha: plan.source.headSha,
    sourcePullRequestNumber: plan.source.pullRequestNumber,
    workflowSha,
  };
}

export async function openOsvActionsCompanionLive({
  baseDirectory,
  expectedBaseSha,
  expectedHeadSha,
  fetchImpl = globalThis.fetch,
  openToken,
  prepareAppSlug,
  prepareBotId,
  prepareBotLogin,
  pullRequestNumber,
  processorRunAttempt,
  processorRunId,
  readToken,
  repository,
  stageReceipt,
  workflowSha,
}) {
  repositoryName(repository);
  const number = boundedPullRequestNumber(
    pullRequestNumber,
    "source-pr-number-invalid",
  );
  const baseSha = exactSha(expectedBaseSha, "expected-base-sha-invalid");
  const headSha = exactSha(expectedHeadSha, "source-head-sha-invalid");
  const runId = positiveInteger(processorRunId, "processor-run-id-invalid");
  const runAttempt = positiveInteger(
    processorRunAttempt,
    "processor-run-attempt-invalid",
  );
  const trustedWorkflowSha = exactSha(workflowSha, "workflow-sha-invalid");
  const validatedStage = validateStageReceipt(stageReceipt, {
    expectedHeadSha: headSha,
    expectedBaseSha: baseSha,
    orchestratorRunAttempt: runAttempt,
    orchestratorRunId: runId,
    pullRequestNumber: number,
    repository: REQUIRED_REPOSITORY,
    workflowSha: trustedWorkflowSha,
  });
  const readApi = createApi({ fetchImpl, token: readToken });
  const prepareBot = await resolvePrepareAppBot(readApi, {
    prepareAppSlug,
    prepareBotId,
    prepareBotLogin,
  });
  const liveTerminal = await terminalCompanionState(readApi, {
    baseDirectory,
    expectedBaseSha: baseSha,
    expectedHeadSha: headSha,
    prepareBot,
    processorRunAttempt: runAttempt,
    processorRunId: runId,
    pullRequestNumber: number,
    workflowSha: trustedWorkflowSha,
  });
  if (validatedStage.result === "terminal") {
    if (!liveTerminal) reject("terminal-companion-state-changed");
    const expectedStage = createTerminalStageReceipt(liveTerminal);
    sameCanonical(
      validatedStage,
      expectedStage,
      "terminal-companion-state-changed",
    );
    return terminalReceiptCore({
      ...liveTerminal,
      schema: ACTIONS_COMPANION_LIVE_OPEN_SCHEMA,
    });
  }
  if (liveTerminal) {
    return terminalReceiptCore({
      ...liveTerminal,
      schema: ACTIONS_COMPANION_LIVE_OPEN_SCHEMA,
    });
  }
  const feedbackAdapter = createProcessorFeedbackAdapter(fetchImpl, readToken);
  const collected = await collectLiveState({
    baseDirectory,
    expectedHeadSha: headSha,
    feedbackAdapter,
    oldReferenceFiles: stageReceipt.oldReferenceFiles,
    pullRequestNumber: number,
    processorRunAttempt: runAttempt,
    processorRunId: runId,
    readApi,
    reusableBase: null,
    workflowSha: trustedWorkflowSha,
  });
  if (collected.base.commitSha !== baseSha) reject("expected-base-sha-changed");
  if (
    collected.authority.processor.runId !== stageReceipt.processorRunId ||
    collected.authority.processor.runAttempt !==
      stageReceipt.processorRunAttempt
  ) {
    reject("stage-receipt-processor-binding-mismatch");
  }
  const plan = createOsvActionsCompanionPlan(collected.input);
  const staged = bindStageReceiptToLive(
    stageReceipt,
    collected.input,
    plan,
    collected.authority.feedbackDigest,
  );
  await verifyStagedGitObjects(readApi, plan, staged, collected.base.entries);
  const terminalOpenReceipt = (pull) =>
    terminalReceiptCore({
      ...terminalStateFromPlannedPull(
        plan,
        pull,
        runAttempt,
        runId,
        collected.authority.processor.runAttempt,
        collected.authority.processor.runId,
        trustedWorkflowSha,
      ),
      schema: ACTIONS_COMPANION_LIVE_OPEN_SCHEMA,
    });
  const initialPullState = await companionPullRequestCensus(
    readApi,
    plan,
    prepareBot,
  );
  if (initialPullState.kind === "open") {
    if (initialPullState.pull.head.sha !== staged.commitSha) {
      reject("open-companion-pr-head-mismatch");
    }
    return openedReceipt(
      plan,
      staged,
      initialPullState.pull,
      "already-open",
      runAttempt,
      runId,
      stageReceipt.processorRunAttempt,
      stageReceipt.processorRunId,
      trustedWorkflowSha,
      prepareBot,
    );
  }
  if (
    initialPullState.kind === "merged" ||
    initialPullState.kind === "closed-unmerged"
  ) {
    await verifyTerminalCompanionPullRequest(readApi, {
      baseEntries: collected.base.entries,
      input: collected.input,
      plan,
      prepareBot,
      pull: initialPullState.pull,
    });
    return terminalOpenReceipt(initialPullState.pull);
  }
  const revalidated = await collectLiveState({
    expectedHeadSha: headSha,
    feedbackAdapter,
    pullRequestNumber: number,
    processorRunAttempt: runAttempt,
    processorRunId: runId,
    readApi,
    reusableBase: collected.base,
    workflowSha: trustedWorkflowSha,
  });
  sameCanonical(collected.input, revalidated.input, "live-input-changed");
  sameCanonical(
    collected.authority,
    revalidated.authority,
    "live-authority-changed",
  );
  await verifyStagedGitObjects(readApi, plan, staged, collected.base.entries);
  const revalidatedPullState = await companionPullRequestCensus(
    readApi,
    plan,
    prepareBot,
  );
  if (revalidatedPullState.kind === "open") {
    if (revalidatedPullState.pull.head.sha !== staged.commitSha) {
      reject("open-companion-pr-head-mismatch");
    }
    return openedReceipt(
      plan,
      staged,
      revalidatedPullState.pull,
      "already-open",
      runAttempt,
      runId,
      stageReceipt.processorRunAttempt,
      stageReceipt.processorRunId,
      trustedWorkflowSha,
      prepareBot,
    );
  }
  if (
    revalidatedPullState.kind === "merged" ||
    revalidatedPullState.kind === "closed-unmerged"
  ) {
    await verifyTerminalCompanionPullRequest(readApi, {
      baseEntries: collected.base.entries,
      input: collected.input,
      plan,
      prepareBot,
      pull: revalidatedPullState.pull,
    });
    return terminalOpenReceipt(revalidatedPullState.pull);
  }
  await collectSourceFeedbackAuthority({
    expectedAuthority: collected.authority,
    feedbackAdapter,
    initialPull: collected.authority.pullRequest,
    input: collected.input,
  });
  const openApi = createApi({ fetchImpl, token: openToken });
  const openedResult = await openApi.request(
    "POST",
    `/repos/${REQUIRED_REPOSITORY}/pulls`,
    {
      body: {
        base: "main",
        body: plan.pullRequestBody,
        draft: false,
        head: plan.branchRef,
        maintainer_can_modify: false,
        title: plan.pullRequestTitle,
      },
      allow: [422],
      expected: [201],
    },
  );
  if (openedResult.status === 422) {
    const converged = await companionPullRequestCensus(
      readApi,
      plan,
      prepareBot,
    );
    if (converged.kind === "open") {
      if (converged.pull.head.sha !== staged.commitSha) {
        reject("open-companion-pr-head-mismatch");
      }
      return openedReceipt(
        plan,
        staged,
        converged.pull,
        "already-open",
        runAttempt,
        runId,
        stageReceipt.processorRunAttempt,
        stageReceipt.processorRunId,
        trustedWorkflowSha,
        prepareBot,
      );
    }
    if (converged.kind === "merged" || converged.kind === "closed-unmerged") {
      await verifyTerminalCompanionPullRequest(readApi, {
        baseEntries: collected.base.entries,
        input: collected.input,
        plan,
        prepareBot,
        pull: converged.pull,
      });
      return terminalOpenReceipt(converged.pull);
    }
    reject("companion-pr-create-raced");
  }
  const opened = openedResult.data;
  validateOpenedPullRequest(opened, plan, staged, prepareBot);
  const { data: confirmed } = await readApi.request(
    "GET",
    `/repos/${REQUIRED_REPOSITORY}/pulls/${opened.number}`,
  );
  validateOpenedPullRequest(confirmed, plan, staged, prepareBot);
  if (confirmed.number !== opened.number) reject("opened-companion-pr-invalid");
  return openedReceipt(
    plan,
    staged,
    confirmed,
    "opened",
    runAttempt,
    runId,
    stageReceipt.processorRunAttempt,
    stageReceipt.processorRunId,
    trustedWorkflowSha,
    prepareBot,
  );
}

function argsMap(args) {
  if (args.length % 2 !== 0) reject("arguments-invalid");
  const result = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    if (!name?.startsWith("--") || result.has(name)) {
      reject("arguments-invalid");
    }
    result.set(name, args[index + 1]);
  }
  return result;
}

function exactArgs(args, expected) {
  if (
    canonicalJson([...args.keys()].sort()) !==
    canonicalJson([...expected].sort())
  ) {
    reject("arguments-invalid");
  }
}

function readJson(path, code, maxBytes = MAX_STAGE_RECEIPT_BYTES) {
  const bytes = readFileSync(resolve(path));
  if (bytes.byteLength > maxBytes) reject(code);
  const text = bytes.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(bytes)) reject(code);
  try {
    return JSON.parse(text);
  } catch (cause) {
    reject(code, { cause });
  }
}

function writeJson(path, value) {
  writeFileSync(resolve(path), `${canonicalJson(value)}\n`, { flag: "wx" });
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const args = argsMap(rest);
  if (command === "verify-base") {
    exactArgs(args, ["--base", "--base-dir", "--output", "--repo"]);
    const receipt = await verifyHistoricalBaseLive({
      baseDirectory: args.get("--base-dir"),
      expectedBaseSha: args.get("--base"),
      readToken: process.env.DEPENDABOT_COMPANION_GITHUB_TOKEN,
      repository: args.get("--repo"),
    });
    return writeJson(args.get("--output"), receipt);
  }
  const common = [
    "--base",
    "--base-dir",
    "--head",
    "--output",
    "--pr",
    "--prepare-app-slug",
    "--prepare-bot-id",
    "--prepare-bot-login",
    "--repo",
    "--run-attempt",
    "--run-id",
    "--workflow-sha",
  ];
  if (command === "census") {
    exactArgs(args, common);
    const receipt = await censusOsvActionsCompanionLive({
      baseDirectory: args.get("--base-dir"),
      expectedBaseSha: args.get("--base"),
      expectedHeadSha: args.get("--head"),
      prepareAppSlug: args.get("--prepare-app-slug"),
      prepareBotId: args.get("--prepare-bot-id"),
      prepareBotLogin: args.get("--prepare-bot-login"),
      pullRequestNumber: args.get("--pr"),
      processorRunAttempt: args.get("--run-attempt"),
      processorRunId: args.get("--run-id"),
      readToken: process.env.DEPENDABOT_COMPANION_GITHUB_TOKEN,
      repository: args.get("--repo"),
      workflowSha: args.get("--workflow-sha"),
    });
    return writeJson(args.get("--output"), receipt);
  }
  if (command === "stage") {
    exactArgs(args, [...common, "--census"]);
    const receipt = await stageOsvActionsCompanionLive({
      baseDirectory: args.get("--base-dir"),
      censusReceipt: readJson(
        args.get("--census"),
        "census-receipt-json-invalid",
        MAX_CENSUS_RECEIPT_BYTES,
      ),
      expectedBaseSha: args.get("--base"),
      expectedHeadSha: args.get("--head"),
      prepareAppSlug: args.get("--prepare-app-slug"),
      prepareBotId: args.get("--prepare-bot-id"),
      prepareBotLogin: args.get("--prepare-bot-login"),
      pullRequestNumber: args.get("--pr"),
      processorRunAttempt: args.get("--run-attempt"),
      processorRunId: args.get("--run-id"),
      readToken: process.env.DEPENDABOT_COMPANION_GITHUB_TOKEN,
      repository: args.get("--repo"),
      stageToken: process.env.DEPENDABOT_COMPANION_STAGE_APP_TOKEN,
      workflowSha: args.get("--workflow-sha"),
    });
    return writeJson(args.get("--output"), receipt);
  }
  if (command === "open") {
    exactArgs(args, [...common, "--staged"]);
    const receipt = await openOsvActionsCompanionLive({
      baseDirectory: args.get("--base-dir"),
      expectedBaseSha: args.get("--base"),
      expectedHeadSha: args.get("--head"),
      openToken: process.env.DEPENDABOT_COMPANION_OPEN_APP_TOKEN,
      prepareAppSlug: args.get("--prepare-app-slug"),
      prepareBotId: args.get("--prepare-bot-id"),
      prepareBotLogin: args.get("--prepare-bot-login"),
      pullRequestNumber: args.get("--pr"),
      processorRunAttempt: args.get("--run-attempt"),
      processorRunId: args.get("--run-id"),
      readToken: process.env.DEPENDABOT_COMPANION_GITHUB_TOKEN,
      repository: args.get("--repo"),
      stageReceipt: readJson(
        args.get("--staged"),
        "stage-receipt-json-invalid",
      ),
      workflowSha: args.get("--workflow-sha"),
    });
    return writeJson(args.get("--output"), receipt);
  }
  reject("command-invalid");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
