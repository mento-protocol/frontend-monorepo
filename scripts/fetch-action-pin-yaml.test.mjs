#!/usr/bin/env node
/** Fixture tests for scripts/fetch-action-pin-yaml.mjs. */

import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import {
  decodeBlob,
  fetchActionPinFiles,
  materializeActionPinFiles,
  parseRepository,
  validateTreePath,
} from "./fetch-action-pin-yaml.mjs";

const HEAD_SHA = "a".repeat(40);
const TREE_SHA = "b".repeat(40);
const TOKEN = "github-test-token";
const REQUIRED_CONTENT = new Map([
  [".github/workflows/action-pins.yml", "name: GitHub Actions Policy\n"],
  [
    ".github/workflows/action-pins-source.yml",
    "name: GitHub Actions Policy Source\n",
  ],
]);
const tests = [];

/** @param {string} name @param {() => void | Promise<void>} run */
function test(name, run) {
  tests.push({ name, run });
}

/** @param {number} index */
function objectSha(index) {
  return index.toString(16).padStart(40, "0");
}

/** @param {string} path @param {string | Buffer} content @param {number} index */
function blobEntry(path, content, index) {
  const bytes = Buffer.from(content);
  return {
    entry: {
      path,
      mode: "100644",
      type: "blob",
      sha: objectSha(index),
      size: bytes.length,
    },
    payload: {
      sha: objectSha(index),
      size: bytes.length,
      encoding: "base64",
      content: bytes.toString("base64"),
    },
  };
}

/** @param {Array<{ path: string, content: string | Buffer }>} extras */
function repositoryFixture(extras = []) {
  const files = [
    ...[...REQUIRED_CONTENT].map(([path, content]) => ({ path, content })),
    ...extras,
  ].map(({ path, content }, index) => blobEntry(path, content, index + 1));
  return {
    entries: files.map(({ entry }) => entry),
    blobs: new Map(files.map(({ entry, payload }) => [entry.sha, payload])),
  };
}

/** @param {unknown} value @param {number} [status] */
function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * @param {{
 *   entries?: unknown[],
 *   blobs?: Map<string, unknown>,
 *   commit?: unknown,
 *   tree?: unknown,
 *   intercept?: (url: URL, options: RequestInit) => Response | undefined,
 * }} fixture
 */
function fakeGitHubApi(fixture = {}) {
  const base = repositoryFixture();
  const entries = fixture.entries ?? base.entries;
  const blobs = fixture.blobs ?? base.blobs;
  const calls = [];
  const fetchImpl = async (input, options) => {
    const url = new URL(input);
    calls.push({ url, options });
    const intercepted = fixture.intercept?.(url, options);
    if (intercepted) return intercepted;

    if (url.pathname.endsWith(`/git/commits/${HEAD_SHA}`)) {
      return jsonResponse(
        fixture.commit ?? { sha: HEAD_SHA, tree: { sha: TREE_SHA } },
      );
    }
    if (url.pathname.endsWith(`/git/trees/${TREE_SHA}`)) {
      return jsonResponse(
        fixture.tree ?? { sha: TREE_SHA, truncated: false, tree: entries },
      );
    }
    const blobSha = url.pathname.match(/\/git\/blobs\/([0-9a-f]{40})$/)?.[1];
    if (blobSha && blobs.has(blobSha)) return jsonResponse(blobs.get(blobSha));
    return jsonResponse({ message: "Not Found" }, 404);
  };
  return { calls, fetchImpl };
}

/** @param {typeof fetch} fetchImpl */
function fetchOptions(fetchImpl) {
  return {
    repository: "fork-owner/frontend-monorepo-fork",
    commitSha: HEAD_SHA,
    token: TOKEN,
    fetchImpl,
  };
}

test("materializes only allowlisted YAML from an exact fork head", async () => {
  const fixture = repositoryFixture([
    { path: ".github/workflows/ci.yaml", content: "jobs: {}\n" },
    { path: ".github/actions/setup/action.yml", content: "runs: {}\n" },
    { path: "tools/custom/action.yaml", content: "runs: {}\n" },
    { path: ".github/actions/setup/script.js", content: "throw 1;\n" },
    { path: "README.md", content: "ignored\n" },
  ]);
  const api = fakeGitHubApi(fixture);
  const parent = mkdtempSync(join(tmpdir(), "action-pin-fetch-pass-"));
  const outputDir = join(parent, "pr-head");
  try {
    const result = await materializeActionPinFiles({
      ...fetchOptions(api.fetchImpl),
      outputDir,
    });

    assert.deepEqual(
      [...result.files.keys()],
      [
        ".github/actions/setup/action.yml",
        ".github/workflows/action-pins-source.yml",
        ".github/workflows/action-pins.yml",
        ".github/workflows/ci.yaml",
        "tools/custom/action.yaml",
      ],
    );
    assert.equal(
      readFileSync(join(outputDir, ".github/workflows/ci.yaml"), "utf8"),
      "jobs: {}\n",
    );
    assert.equal(existsSync(join(outputDir, "README.md")), false);
    assert.equal(
      existsSync(join(outputDir, ".github/actions/setup/script.js")),
      false,
    );
    assert.equal(statSync(outputDir).mode & 0o777, 0o700);
    assert.equal(api.calls[0].url.host, "api.github.com");
    assert.equal(
      api.calls[0].url.pathname,
      `/repos/fork-owner/frontend-monorepo-fork/git/commits/${HEAD_SHA}`,
    );
    for (const { url, options } of api.calls) {
      assert.equal(url.host, "api.github.com");
      assert.equal(options.redirect, "error");
      assert.equal(options.headers.Authorization, `Bearer ${TOKEN}`);
    }
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("rejects malformed repository, SHA, and token inputs before fetching", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    throw new Error("unexpected fetch");
  };

  for (const options of [
    { repository: "owner/../repo", commitSha: HEAD_SHA, token: TOKEN },
    { repository: "owner/repo", commitSha: "main", token: TOKEN },
    { repository: "owner/repo", commitSha: HEAD_SHA, token: "bad token" },
  ]) {
    await assert.rejects(
      fetchActionPinFiles({ ...options, fetchImpl }),
      /PR_HEAD_REPOSITORY|PR_HEAD_SHA|GITHUB_TOKEN/,
    );
  }
  assert.equal(calls, 0);
  assert.deepEqual(parseRepository("fork-owner/repo.name"), {
    owner: "fork-owner",
    repository: "repo.name",
  });
});

test("rejects commit and tree identity mismatches", async () => {
  const wrongCommit = fakeGitHubApi({
    commit: { sha: "c".repeat(40), tree: { sha: TREE_SHA } },
  });
  await assert.rejects(
    fetchActionPinFiles(fetchOptions(wrongCommit.fetchImpl)),
    /commit response did not match/,
  );

  const wrongTree = fakeGitHubApi({
    tree: { sha: "c".repeat(40), truncated: false, tree: [] },
  });
  await assert.rejects(
    fetchActionPinFiles(fetchOptions(wrongTree.fetchImpl)),
    /tree response did not match/,
  );
});

test("fails closed when the recursive tree is truncated", async () => {
  const api = fakeGitHubApi({
    tree: { sha: TREE_SHA, truncated: true, tree: [] },
  });
  await assert.rejects(
    fetchActionPinFiles(fetchOptions(api.fetchImpl)),
    /truncated or incomplete/,
  );
});

test("rejects unsafe and duplicate Git tree paths", async () => {
  for (const path of [
    "../action.yml",
    "/action.yml",
    "a\\action.yml",
    "a//action.yml",
  ]) {
    assert.throws(() => validateTreePath(path), /unsafe Git tree path/);
  }

  const fixture = repositoryFixture();
  const api = fakeGitHubApi({
    entries: [...fixture.entries, fixture.entries[0]],
    blobs: fixture.blobs,
  });
  await assert.rejects(
    fetchActionPinFiles(fetchOptions(api.fetchImpl)),
    /duplicate Git tree path/,
  );
});

test("ignores unrelated links but rejects selected symlinks and submodules", async () => {
  const fixture = repositoryFixture();
  const unrelatedEntries = [
    ...fixture.entries,
    {
      path: "docs/latest",
      mode: "120000",
      type: "blob",
      sha: objectSha(90),
      size: 6,
    },
    {
      path: "vendor/docs",
      mode: "160000",
      type: "commit",
      sha: objectSha(91),
    },
  ];
  const unrelated = fakeGitHubApi({
    entries: unrelatedEntries,
    blobs: fixture.blobs,
  });
  const result = await fetchActionPinFiles(fetchOptions(unrelated.fetchImpl));
  assert.equal(result.files.size, 2);

  for (const unsafeEntry of [
    {
      path: ".github/actions/evil/action.yml",
      mode: "120000",
      type: "blob",
      sha: objectSha(92),
      size: 9,
    },
    {
      path: "vendor/action.yaml",
      mode: "160000",
      type: "commit",
      sha: objectSha(93),
    },
  ]) {
    const api = fakeGitHubApi({
      entries: [...fixture.entries, unsafeEntry],
      blobs: fixture.blobs,
    });
    await assert.rejects(
      fetchActionPinFiles(fetchOptions(api.fetchImpl)),
      /must be a regular Git blob/,
    );
  }
});

test("requires both policy workflows and enforces selected-file size limits", async () => {
  const fixture = repositoryFixture();
  const missing = fakeGitHubApi({
    entries: fixture.entries.slice(1),
    blobs: fixture.blobs,
  });
  await assert.rejects(
    fetchActionPinFiles(fetchOptions(missing.fetchImpl)),
    /required action-pin policy workflow is missing/,
  );

  const oversized = {
    ...fixture.entries[0],
    path: ".github/workflows/oversized.yml",
    sha: objectSha(99),
    size: 1024 * 1024 + 1,
  };
  const tooLarge = fakeGitHubApi({
    entries: [...fixture.entries, oversized],
    blobs: fixture.blobs,
  });
  await assert.rejects(
    fetchActionPinFiles(fetchOptions(tooLarge.fetchImpl)),
    /exceeds the 1048576-byte policy limit/,
  );
});

test("fails closed on GitHub API errors and malformed JSON", async () => {
  const denied = fakeGitHubApi({
    intercept: (url) =>
      url.pathname.includes("/git/commits/")
        ? jsonResponse({ message: "denied" }, 403)
        : undefined,
  });
  await assert.rejects(
    fetchActionPinFiles(fetchOptions(denied.fetchImpl)),
    /HTTP 403/,
  );

  const malformed = fakeGitHubApi({
    intercept: (url) =>
      url.pathname.includes("/git/commits/")
        ? new Response("not json", { status: 200 })
        : undefined,
  });
  await assert.rejects(
    fetchActionPinFiles(fetchOptions(malformed.fetchImpl)),
    /invalid JSON/,
  );
});

test("rejects inconsistent and malformed blob payloads", () => {
  const bytes = Buffer.from("name: workflow\n");
  const sha = objectSha(100);
  const valid = {
    sha,
    size: bytes.length,
    encoding: "base64",
    content: bytes.toString("base64"),
  };
  assert.deepEqual(decodeBlob(valid, sha, bytes.length), bytes);

  for (const [payload, error] of [
    [{ ...valid, sha: objectSha(101) }, /did not match the tree entry/],
    [{ ...valid, size: bytes.length + 1 }, /size did not match/],
    [{ ...valid, encoding: "utf-8" }, /encoding was not base64/],
    [{ ...valid, content: "***" }, /not valid base64/],
    [
      {
        ...valid,
        size: 2,
        content: Buffer.from([0xc3, 0x28]).toString("base64"),
      },
      /encoded data was not valid|valid for encoding/,
    ],
    [
      {
        ...valid,
        size: 3,
        content: Buffer.from([97, 0, 98]).toString("base64"),
      },
      /must not contain NUL bytes/,
    ],
  ]) {
    assert.throws(() => decodeBlob(payload, sha, payload.size), error);
  }
});

test("does not create output when a blob cannot be verified", async () => {
  const fixture = repositoryFixture();
  const corruptBlobs = new Map(fixture.blobs);
  const first = fixture.entries[0];
  corruptBlobs.set(first.sha, {
    ...corruptBlobs.get(first.sha),
    content: "***",
  });
  const api = fakeGitHubApi({ entries: fixture.entries, blobs: corruptBlobs });
  const parent = mkdtempSync(join(tmpdir(), "action-pin-fetch-fail-"));
  const outputDir = join(parent, "pr-head");
  try {
    await assert.rejects(
      materializeActionPinFiles({
        ...fetchOptions(api.fetchImpl),
        outputDir,
      }),
      /not valid base64/,
    );
    assert.equal(existsSync(outputDir), false);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("requires a fresh absolute output directory", async () => {
  const api = fakeGitHubApi();
  await assert.rejects(
    materializeActionPinFiles({
      ...fetchOptions(api.fetchImpl),
      outputDir: "relative/pr-head",
    }),
    /absolute non-root path/,
  );
  assert.equal(api.calls.length, 0);

  const parent = mkdtempSync(join(tmpdir(), "action-pin-fetch-existing-"));
  const outputDir = join(parent, "pr-head");
  mkdirSync(outputDir);
  try {
    await assert.rejects(
      materializeActionPinFiles({
        ...fetchOptions(api.fetchImpl),
        outputDir,
      }),
      /must not already exist/,
    );
    assert.equal(api.calls.length, 0);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

let failures = 0;
for (const { name, run } of tests) {
  try {
    await run();
    console.log(`ok - ${name}`);
  } catch (error) {
    failures++;
    console.error(`not ok - ${name}`);
    console.error(error instanceof Error ? error.stack : String(error));
  }
}

if (failures > 0) process.exit(1);

console.log(`\n${tests.length} action-pin REST materializer tests passed.`);
