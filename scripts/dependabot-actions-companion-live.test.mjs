import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { after } from "node:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  ACTIONS_COMPANION_LIVE_OPEN_SCHEMA,
  ACTIONS_COMPANION_LIVE_CENSUS_SCHEMA,
  ACTIONS_COMPANION_LIVE_STAGE_SCHEMA,
  ActionsCompanionLiveError,
  censusOsvActionsCompanionLive,
  openOsvActionsCompanionLive,
  stageOsvActionsCompanionLive,
} from "./dependabot-actions-companion-live.mjs";
import {
  OSV_MIRROR_TEST_PATH,
  OSV_REPORTER_ACTION,
  OSV_SCANNER_ACTION,
  OSV_WORKFLOW_PATH,
} from "./dependabot-actions-companion.mjs";

const SCRIPT_PATH = fileURLToPath(
  new URL("./dependabot-actions-companion-live.mjs", import.meta.url),
);
const REPOSITORY = "mento-protocol/frontend-monorepo";
const FROM_SHA = "a".repeat(40);
const TO_SHA = "b".repeat(40);
const BASE_SHA = "c".repeat(40);
const BASE_TREE_SHA = "d".repeat(40);
const HEAD_SHA = "e".repeat(40);
const HEAD_TREE_SHA = "f".repeat(40);
const STAGED_TREE_SHA = "1".repeat(40);
const STAGED_COMMIT_SHA = "2".repeat(40);
const WORKFLOW_SHA = "3".repeat(40);
const OTHER_SHA = "4".repeat(40);
const READ_TOKEN = "read-token";
const STAGE_TOKEN = "stage-token";
const OPEN_TOKEN = "open-token";
const PROCESSOR_RUN_ID = 32_720_811_102;
const TEMP_DIRECTORIES = [];

after(() => {
  for (const directory of TEMP_DIRECTORIES) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function gitBlobSha(value) {
  const bytes = Buffer.from(value, "utf8");
  return createHash("sha1")
    .update(`blob ${bytes.byteLength}\0`)
    .update(bytes)
    .digest("hex");
}

function baseWorkflow() {
  return [
    "name: OSV Scanner (read-only)",
    "jobs:",
    "  scan:",
    "    steps:",
    `      - uses: ${OSV_SCANNER_ACTION}@${FROM_SHA} # v2.5.1`,
    `      - uses: ${OSV_REPORTER_ACTION}@${FROM_SHA} # v2.5.1`,
    "",
  ].join("\n");
}

function sourceWorkflow() {
  return baseWorkflow().replaceAll(FROM_SHA, TO_SHA);
}

function mirrorTest() {
  return [
    `const scanner = "${OSV_SCANNER_ACTION}@${FROM_SHA}";`,
    `const reporter = "${OSV_REPORTER_ACTION}@${FROM_SHA}";`,
    "assert.equal(scan.uses, scanner);",
    "assert.equal(report.uses, reporter);",
    "",
  ].join("\n");
}

function mirrorResult() {
  return mirrorTest().replaceAll(FROM_SHA, TO_SHA);
}

function sourceMessage() {
  return [
    "chore(ci): bump the github-actions-manual group across 1 directory with 2 updates",
    "",
    "Bumps the github-actions-manual group with 2 updates in the / directory.",
    "",
    `Updates \`${OSV_SCANNER_ACTION}\` from ${FROM_SHA} to ${TO_SHA}`,
    `Updates \`${OSV_REPORTER_ACTION}\` from ${FROM_SHA} to ${TO_SHA}`,
    "",
  ].join("\n");
}

function blobResponse(content) {
  const bytes = Buffer.from(content, "utf8");
  return {
    content: bytes.toString("base64"),
    encoding: "base64",
    sha: gitBlobSha(content),
    size: bytes.byteLength,
  };
}

function treeEntry(path, content, mode = "100644") {
  return {
    mode,
    path,
    sha: gitBlobSha(content),
    size: Buffer.byteLength(content),
    type: "blob",
  };
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status });
}

function isRepositoryMutation({ method, url }) {
  return method !== "GET" && url.pathname !== "/graphql";
}

function maintainerIssueComment() {
  return {
    author_association: "MEMBER",
    body: "Do not proceed with this update.",
    created_at: "2026-08-24T10:02:00Z",
    id: 7_001,
    updated_at: "2026-08-24T10:02:00Z",
    user: { id: 70, login: "maintainer", type: "User" },
  };
}

function unresolvedReviewThread() {
  return {
    comments: {
      nodes: [
        {
          author: { __typename: "User", login: "maintainer" },
          authorAssociation: "MEMBER",
          body: "Please verify this pin before staging.",
          createdAt: "2026-08-24T10:02:00Z",
          databaseId: 7_002,
          pullRequestReview: {
            commit: { oid: HEAD_SHA },
            databaseId: 7_003,
          },
          replyTo: null,
        },
      ],
      pageInfo: { hasNextPage: false },
      totalCount: 1,
    },
    id: "PRRT_late_feedback",
    isOutdated: false,
    isResolved: false,
    line: 1,
    path: OSV_WORKFLOW_PATH,
  };
}

function existingPull({
  branchRef,
  body = "",
  headSha = STAGED_COMMIT_SHA,
  merged = false,
  number = 900,
  state = "open",
  title = "",
}) {
  return {
    base: {
      ref: "main",
      repo: { full_name: REPOSITORY },
      sha: BASE_SHA,
    },
    head: {
      ref: branchRef,
      repo: { full_name: REPOSITORY },
      sha: headSha,
    },
    body,
    draft: false,
    html_url: `https://github.com/${REPOSITORY}/pull/${number}`,
    merged_at: merged ? "2026-08-24T12:00:00Z" : null,
    number,
    state,
    title,
  };
}

function liveFixture() {
  const workflow = baseWorkflow();
  const source = sourceWorkflow();
  const mirror = mirrorTest();
  const readme = "repository fixture\n";
  const executable = "#!/bin/sh\nexit 0\n";
  const linkTarget = "../README.md";
  const fillerFiles = Array.from({ length: 250 }, (_, index) => ({
    content: `large synthetic tree entry ${index}\n`,
    path: `fixtures/large/file-${String(index).padStart(3, "0")}.txt`,
  }));
  const baseFiles = [
    ...fillerFiles,
    { content: linkTarget, mode: "120000", path: "fixtures/readme-link" },
    { content: executable, mode: "100755", path: "scripts/live-fixture.sh" },
    { content: workflow, path: OSV_WORKFLOW_PATH },
    { content: mirror, path: OSV_MIRROR_TEST_PATH },
    { content: readme, path: "README.md" },
  ];
  const baseEntries = baseFiles
    .map(({ content, mode, path }) => treeEntry(path, content, mode))
    .sort((left, right) => left.path.localeCompare(right.path));
  const headEntries = baseEntries.map((entry) =>
    entry.path === OSV_WORKFLOW_PATH
      ? treeEntry(OSV_WORKFLOW_PATH, source)
      : entry,
  );
  const stagedEntries = baseEntries.map((entry) => {
    if (entry.path === OSV_WORKFLOW_PATH) {
      return treeEntry(OSV_WORKFLOW_PATH, source);
    }
    if (entry.path === OSV_MIRROR_TEST_PATH) {
      return treeEntry(OSV_MIRROR_TEST_PATH, mirrorResult());
    }
    return entry;
  });
  const contentBySha = new Map(
    [...baseFiles.map(({ content }) => content), source, mirrorResult()].map(
      (content) => [gitBlobSha(content), content],
    ),
  );
  const baseDirectory = mkdtempSync(
    join(tmpdir(), "dependabot-actions-companion-base-"),
  );
  TEMP_DIRECTORIES.push(baseDirectory);
  for (const { content, mode = "100644", path } of baseFiles) {
    const absolute = join(baseDirectory, path);
    mkdirSync(dirname(absolute), { recursive: true });
    if (mode === "120000") {
      symlinkSync(content, absolute);
    } else {
      writeFileSync(absolute, content);
      chmodSync(absolute, mode === "100755" ? 0o755 : 0o644);
    }
  }
  const state = {
    branchCreated: false,
    calls: [],
    companionCensusReads: 0,
    censusPulls: [],
    forcePushEvents: [],
    issueComments: [],
    lateIssueCommentAtCompanionCensus: null,
    lateThreadAtCompanionCensus: null,
    mainRefReads: 0,
    moveMainAtRead: null,
    openedPull: null,
    processorSummary:
      "Disposition: manual-review. Reason: sensitive-auth-deployment-or-workflow-policy-action. Next action: create a maintainer-authored companion or replacement PR.",
    processorRunConclusion: null,
    processorRunEvent: "workflow_run",
    processorRunStatus: "in_progress",
    pullCreateRaces: false,
    refCreateRaces: false,
    reviewThreads: [],
    sourceReviews: [],
  };

  const sourcePull = () => ({
    auto_merge: null,
    base: {
      ref: "main",
      repo: { full_name: REPOSITORY },
      sha: BASE_SHA,
    },
    body: "Dependabot source",
    draft: false,
    head: {
      ref: "dependabot/github_actions/github-actions-manual-a7528f0b61",
      repo: { full_name: REPOSITORY },
      sha: HEAD_SHA,
    },
    labels: [],
    node_id: "PR_kwDO_companion_source",
    number: 840,
    state: "open",
    updated_at: "2026-08-24T10:00:00Z",
    user: { id: 49_699_333, login: "dependabot[bot]", type: "Bot" },
  });
  const sourceCommit = {
    author: { id: 49_699_333, login: "dependabot[bot]", type: "Bot" },
    commit: {
      message: sourceMessage(),
      verification: { reason: "valid", verified: true },
    },
    committer: { id: 19_864_447, login: "web-flow", type: "User" },
    parents: [{ sha: BASE_SHA }],
    sha: HEAD_SHA,
  };

  const fetchImpl = async (url, options = {}) => {
    const parsed = new URL(url);
    const method = options.method ?? "GET";
    const body = options.body === undefined ? null : JSON.parse(options.body);
    const authorization = options.headers?.Authorization;
    state.calls.push({ authorization, body, method, url: parsed });
    const path = parsed.pathname;

    if (method === "POST" && path === "/graphql") {
      if (body?.query?.includes("DependabotProcessorFeedback")) {
        return json({
          data: {
            repository: {
              pullRequest: {
                autoMergeRequest: null,
                headRefOid: HEAD_SHA,
                id: "PR_kwDO_companion_source",
                isDraft: false,
                mergeable: "MERGEABLE",
                mergeStateStatus: "CLEAN",
                reviewDecision: null,
                reviewThreads: {
                  nodes: state.reviewThreads,
                  pageInfo: { endCursor: null, hasNextPage: false },
                },
                updatedAt: "2026-08-24T10:00:00Z",
              },
            },
          },
        });
      }
      if (body?.query?.includes("DependabotForcePushHistory")) {
        return json({
          data: {
            repository: {
              pullRequest: {
                timelineItems: {
                  nodes: state.forcePushEvents,
                  pageInfo: { hasNextPage: false },
                },
              },
            },
          },
        });
      }
    }

    if (method === "GET" && path === `/repos/${REPOSITORY}/pulls/840`) {
      return json(sourcePull());
    }
    if (method === "GET" && path === `/repos/${REPOSITORY}/pulls/840/files`) {
      return json([
        {
          filename: OSV_WORKFLOW_PATH,
          previous_filename: undefined,
          status: "modified",
        },
      ]);
    }
    if (method === "GET" && path === `/repos/${REPOSITORY}/pulls/840/commits`) {
      return json([sourceCommit]);
    }
    if (method === "GET" && path === `/repos/${REPOSITORY}/pulls/840/reviews`) {
      return json(state.sourceReviews);
    }
    if (
      method === "GET" &&
      path === `/repos/${REPOSITORY}/issues/840/comments`
    ) {
      return json(state.issueComments);
    }
    if (method === "GET" && path === `/repos/${REPOSITORY}/issues/840/events`) {
      return json([]);
    }
    if (
      method === "GET" &&
      path === `/repos/${REPOSITORY}/git/ref/heads/main`
    ) {
      state.mainRefReads += 1;
      const moved = state.moveMainAtRead === state.mainRefReads;
      return json({
        object: { sha: moved ? OTHER_SHA : BASE_SHA, type: "commit" },
        ref: "refs/heads/main",
      });
    }
    if (
      method === "GET" &&
      path === `/repos/${REPOSITORY}/git/commits/${BASE_SHA}`
    ) {
      return json({ sha: BASE_SHA, tree: { sha: BASE_TREE_SHA } });
    }
    if (
      method === "GET" &&
      path === `/repos/${REPOSITORY}/git/trees/${BASE_TREE_SHA}`
    ) {
      return json({ sha: BASE_TREE_SHA, tree: baseEntries, truncated: false });
    }
    if (
      method === "GET" &&
      path === `/repos/${REPOSITORY}/git/commits/${HEAD_SHA}`
    ) {
      return json({ sha: HEAD_SHA, tree: { sha: HEAD_TREE_SHA } });
    }
    if (
      method === "GET" &&
      path === `/repos/${REPOSITORY}/git/trees/${HEAD_TREE_SHA}`
    ) {
      return json({ sha: HEAD_TREE_SHA, tree: headEntries, truncated: false });
    }
    if (method === "GET" && path.includes(`/git/blobs/`)) {
      const sha = path.split("/").at(-1);
      const content = contentBySha.get(sha);
      if (content === undefined) return json({ message: "Not Found" }, 404);
      return json(blobResponse(content));
    }
    if (
      method === "GET" &&
      path === `/repos/${REPOSITORY}/commits/${HEAD_SHA}/check-runs`
    ) {
      return json({
        check_runs: [
          {
            app: { id: 15_368 },
            conclusion: "failure",
            external_id: `dependabot-processor:v2:pr=840:head=${HEAD_SHA}:mode=prepare:repair=1:packet=false:digest=none:run=${PROCESSOR_RUN_ID}:attempt=1`,
            head_sha: HEAD_SHA,
            id: 84_001,
            name: "Dependabot Processor",
            output: {
              summary: state.processorSummary,
              text: null,
            },
            status: "completed",
          },
        ],
        total_count: 1,
      });
    }
    if (
      method === "GET" &&
      path === `/repos/${REPOSITORY}/actions/runs/${PROCESSOR_RUN_ID}`
    ) {
      return json({
        conclusion: state.processorRunConclusion,
        event: state.processorRunEvent,
        head_branch: "main",
        head_sha: WORKFLOW_SHA,
        id: PROCESSOR_RUN_ID,
        path: ".github/workflows/dependabot-process.yml",
        repository: { full_name: REPOSITORY },
        run_attempt: 1,
        status: state.processorRunStatus,
      });
    }

    const companionRefPrefix = `/repos/${REPOSITORY}/git/ref/heads/dependabot-companion/`;
    if (method === "GET" && path.startsWith(companionRefPrefix)) {
      if (!state.branchCreated) return json({ message: "Not Found" }, 404);
      const branchRef = decodeURIComponent(
        path.slice(companionRefPrefix.length),
      );
      return json({
        object: { sha: STAGED_COMMIT_SHA, type: "commit" },
        ref: `refs/heads/dependabot-companion/${branchRef}`,
      });
    }
    if (method === "POST" && path === `/repos/${REPOSITORY}/git/blobs`) {
      const content = Buffer.from(body.content, "base64").toString("utf8");
      return json({ sha: gitBlobSha(content) }, 201);
    }
    if (method === "POST" && path === `/repos/${REPOSITORY}/git/trees`) {
      return json({ sha: STAGED_TREE_SHA, tree: body.tree }, 201);
    }
    if (method === "POST" && path === `/repos/${REPOSITORY}/git/commits`) {
      return json(
        {
          message: body.message,
          parents: [{ sha: BASE_SHA }],
          sha: STAGED_COMMIT_SHA,
          tree: { sha: STAGED_TREE_SHA },
        },
        201,
      );
    }
    if (method === "POST" && path === `/repos/${REPOSITORY}/git/refs`) {
      if (state.refCreateRaces) {
        state.branchCreated = true;
        return json({ message: "Reference exists" }, 422);
      }
      if (state.branchCreated)
        return json({ message: "Reference exists" }, 422);
      state.branchCreated = true;
      return json(
        {
          object: { sha: STAGED_COMMIT_SHA, type: "commit" },
          ref: body.ref,
        },
        201,
      );
    }
    if (
      method === "GET" &&
      path === `/repos/${REPOSITORY}/git/commits/${STAGED_COMMIT_SHA}`
    ) {
      const stageCommitCall = state.calls.find(
        (call) =>
          call.method === "POST" &&
          call.url.pathname === `/repos/${REPOSITORY}/git/commits`,
      );
      return json({
        message: stageCommitCall.body.message,
        parents: [{ sha: BASE_SHA }],
        sha: STAGED_COMMIT_SHA,
        tree: { sha: STAGED_TREE_SHA },
      });
    }
    if (
      method === "GET" &&
      path === `/repos/${REPOSITORY}/git/trees/${STAGED_TREE_SHA}`
    ) {
      return json({
        sha: STAGED_TREE_SHA,
        tree: stagedEntries,
        truncated: false,
      });
    }
    if (method === "GET" && path === `/repos/${REPOSITORY}/pulls`) {
      state.companionCensusReads += 1;
      if (
        state.lateIssueCommentAtCompanionCensus === state.companionCensusReads
      ) {
        state.issueComments = [maintainerIssueComment()];
        state.lateIssueCommentAtCompanionCensus = null;
      }
      if (state.lateThreadAtCompanionCensus === state.companionCensusReads) {
        state.reviewThreads = [unresolvedReviewThread()];
        state.lateThreadAtCompanionCensus = null;
      }
      return json(state.censusPulls);
    }
    if (method === "POST" && path === `/repos/${REPOSITORY}/pulls`) {
      state.openedPull = {
        base: {
          ref: "main",
          repo: { full_name: REPOSITORY },
          sha: BASE_SHA,
        },
        body: body.body,
        draft: body.draft,
        head: {
          ref: body.head,
          repo: { full_name: REPOSITORY },
          sha: STAGED_COMMIT_SHA,
        },
        html_url: `https://github.com/${REPOSITORY}/pull/841`,
        number: 841,
        state: "open",
        title: body.title,
      };
      if (state.pullCreateRaces) {
        state.censusPulls = [state.openedPull];
        return json({ message: "Pull request exists" }, 422);
      }
      return json(state.openedPull, 201);
    }
    if (method === "GET" && path === `/repos/${REPOSITORY}/pulls/841`) {
      return json(state.openedPull);
    }
    return json({ message: `Unhandled ${method} ${path}` }, 500);
  };

  return { baseDirectory, fetchImpl, state };
}

async function census(fixture, overrides = {}) {
  return censusOsvActionsCompanionLive({
    baseDirectory: fixture.baseDirectory,
    expectedHeadSha: HEAD_SHA,
    fetchImpl: fixture.fetchImpl,
    pullRequestNumber: 840,
    processorRunAttempt: 1,
    processorRunId: PROCESSOR_RUN_ID,
    readToken: READ_TOKEN,
    repository: REPOSITORY,
    workflowSha: WORKFLOW_SHA,
    ...overrides,
  });
}

async function stage(fixture, censusReceipt = null) {
  return stageOsvActionsCompanionLive({
    censusReceipt: censusReceipt ?? (await census(fixture)),
    expectedHeadSha: HEAD_SHA,
    fetchImpl: fixture.fetchImpl,
    pullRequestNumber: 840,
    processorRunAttempt: 1,
    processorRunId: PROCESSOR_RUN_ID,
    readToken: READ_TOKEN,
    repository: REPOSITORY,
    stageToken: STAGE_TOKEN,
    workflowSha: WORKFLOW_SHA,
  });
}

async function open(fixture, stageReceipt) {
  return openOsvActionsCompanionLive({
    expectedHeadSha: HEAD_SHA,
    fetchImpl: fixture.fetchImpl,
    openToken: OPEN_TOKEN,
    pullRequestNumber: 840,
    processorRunAttempt: 1,
    processorRunId: PROCESSOR_RUN_ID,
    readToken: READ_TOKEN,
    repository: REPOSITORY,
    stageReceipt,
    workflowSha: WORKFLOW_SHA,
  });
}

test("stages and opens the #840 OSV companion with an 11-digit run ID and isolated authorities", async () => {
  const fixture = liveFixture();
  const sealed = await census(fixture);
  assert.equal(sealed.schema, ACTIONS_COMPANION_LIVE_CENSUS_SCHEMA);
  assert.equal(sealed.orchestratorRunId, PROCESSOR_RUN_ID);
  assert.equal(String(sealed.orchestratorRunId).length, 11);
  assert.equal(sealed.input.currentBase.commitSha, BASE_SHA);
  assert.equal(sealed.plan.source.pullRequestNumber, 840);
  assert.equal(
    Buffer.byteLength(JSON.stringify(sealed)) < 8 * 1024 * 1024,
    true,
  );
  const staged = await stage(fixture, sealed);
  assert.equal(staged.schema, ACTIONS_COMPANION_LIVE_STAGE_SCHEMA);
  assert.equal(staged.sourcePullRequestNumber, 840);
  assert.equal(staged.sourceHeadSha, HEAD_SHA);
  assert.equal(staged.commitSha, STAGED_COMMIT_SHA);
  assert.equal(staged.treeSha, STAGED_TREE_SHA);
  assert.equal(Buffer.byteLength(JSON.stringify(staged)) < 4 * 1024, true);
  assert.deepEqual(
    Object.keys(staged).sort(),
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
    ].sort(),
  );
  assert.deepEqual(
    staged.editBindings.map(({ path: bindingPath }) => bindingPath),
    [OSV_WORKFLOW_PATH, OSV_MIRROR_TEST_PATH],
  );
  assert.deepEqual(
    staged.oldReferenceFiles.map(({ path: bindingPath }) => bindingPath),
    [OSV_WORKFLOW_PATH, OSV_MIRROR_TEST_PATH],
  );

  const opened = await open(fixture, staged);
  assert.equal(opened.schema, ACTIONS_COMPANION_LIVE_OPEN_SCHEMA);
  assert.deepEqual(opened.companionPullRequest, {
    baseSha: BASE_SHA,
    draft: false,
    headSha: STAGED_COMMIT_SHA,
    number: 841,
    state: "open",
    url: `https://github.com/${REPOSITORY}/pull/841`,
  });

  const mutations = fixture.state.calls.filter(isRepositoryMutation);
  assert.deepEqual(
    mutations.map(({ method, url }) => `${method} ${url.pathname}`),
    [
      `POST /repos/${REPOSITORY}/git/blobs`,
      `POST /repos/${REPOSITORY}/git/blobs`,
      `POST /repos/${REPOSITORY}/git/trees`,
      `POST /repos/${REPOSITORY}/git/commits`,
      `POST /repos/${REPOSITORY}/git/refs`,
      `POST /repos/${REPOSITORY}/pulls`,
    ],
  );
  for (const call of fixture.state.calls) {
    const expectedToken =
      call.method === "GET" || call.url.pathname === "/graphql"
        ? READ_TOKEN
        : call.url.pathname === `/repos/${REPOSITORY}/pulls`
          ? OPEN_TOKEN
          : STAGE_TOKEN;
    assert.equal(call.authorization, `Bearer ${expectedToken}`);
  }
  const refMutation = mutations.find(({ url }) =>
    url.pathname.endsWith("/git/refs"),
  );
  assert.match(refMutation.body.ref, /^refs\/heads\/dependabot-companion\//u);
  assert.doesNotMatch(refMutation.body.ref, /^refs\/heads\/dependabot\//u);
  const pullMutation = mutations.at(-1);
  assert.equal(pullMutation.body.draft, false);
  assert.equal(pullMutation.body.maintainer_can_modify, false);
  const blobReads = fixture.state.calls.filter(
    ({ method, url }) =>
      method === "GET" && url.pathname.includes("/git/blobs/"),
  );
  assert.equal(blobReads.length < 16, true);
  const fillerShas = new Set(
    Array.from({ length: 250 }, (_, index) =>
      gitBlobSha(`large synthetic tree entry ${index}\n`),
    ),
  );
  assert.equal(
    blobReads.some(({ url }) => fillerShas.has(url.pathname.split("/").at(-1))),
    false,
  );
});

test("a current-main race leaves no branch ref or pull request", async () => {
  const fixture = liveFixture();
  const sealed = await census(fixture);
  fixture.state.moveMainAtRead = fixture.state.mainRefReads + 2;
  await assert.rejects(stage(fixture, sealed), (error) => {
    assert.equal(error instanceof ActionsCompanionLiveError, true);
    assert.equal(error.code, "current-main-changed");
    return true;
  });
  assert.equal(
    fixture.state.calls.some(
      ({ method, url }) =>
        method === "POST" && url.pathname.endsWith("/git/refs"),
    ),
    false,
  );
  assert.equal(
    fixture.state.calls.some(
      ({ method, url }) => method === "POST" && url.pathname.endsWith("/pulls"),
    ),
    false,
  );
});

test("a late maintainer issue-comment veto prevents the branch ref write", async () => {
  const fixture = liveFixture();
  const sealed = await census(fixture);
  fixture.state.lateIssueCommentAtCompanionCensus =
    fixture.state.companionCensusReads + 2;
  await assert.rejects(stage(fixture, sealed), (error) => {
    assert.equal(error instanceof ActionsCompanionLiveError, true);
    assert.equal(error.code, "source-feedback-changed");
    return true;
  });
  assert.equal(
    fixture.state.calls.some(
      ({ method, url }) =>
        method === "POST" && url.pathname.endsWith("/git/refs"),
    ),
    false,
  );
});

test("a late unresolved review thread prevents the pull request write", async () => {
  const fixture = liveFixture();
  const staged = await stage(fixture);
  fixture.state.lateThreadAtCompanionCensus =
    fixture.state.companionCensusReads + 2;
  await assert.rejects(open(fixture, staged), (error) => {
    assert.equal(error instanceof ActionsCompanionLiveError, true);
    assert.equal(error.code, "source-feedback-changed");
    return true;
  });
  assert.equal(
    fixture.state.calls.some(
      ({ method, url }) => method === "POST" && url.pathname.endsWith("/pulls"),
    ),
    false,
  );
});

test("census rejects extra local files before any write credential is used", async () => {
  const fixture = liveFixture();
  writeFileSync(join(fixture.baseDirectory, "unexpected-local-file.txt"), "x");
  await assert.rejects(census(fixture), (error) => {
    assert.equal(error.code, "base-directory-has-untracked-entry");
    return true;
  });
  assert.equal(fixture.state.calls.some(isRepositoryMutation), false);
});

test("legacy generic manual-review checks cannot authorize staging", async () => {
  const fixture = liveFixture();
  fixture.state.processorSummary = "Disposition: manual-review";
  await assert.rejects(stage(fixture), (error) => {
    assert.equal(error instanceof ActionsCompanionLiveError, true);
    assert.equal(error.code, "processor-check-invalid");
    return true;
  });
  assert.equal(fixture.state.calls.some(isRepositoryMutation), false);
});

test("same-run authority accepts human approval and rejects processor approval", async () => {
  const humanFixture = liveFixture();
  humanFixture.state.sourceReviews = [
    {
      author_association: "MEMBER",
      body: "Approved by a maintainer",
      commit_id: HEAD_SHA,
      id: 70,
      state: "APPROVED",
      submitted_at: "2026-08-24T10:01:00Z",
      user: { id: 70, login: "maintainer", type: "User" },
    },
  ];
  const sealed = await census(humanFixture);
  assert.equal(sealed.processorRunId, PROCESSOR_RUN_ID);
  assert.equal(sealed.processorRunAttempt, 1);

  const processorFixture = liveFixture();
  processorFixture.state.sourceReviews = [
    {
      author_association: "NONE",
      body: `Approved by dependabot-processor:v2 for exact head ${HEAD_SHA}.`,
      commit_id: HEAD_SHA,
      id: 71,
      state: "APPROVED",
      submitted_at: "2026-08-24T10:01:00Z",
      user: { id: 15_368, login: "github-actions[bot]", type: "Bot" },
    },
  ];
  await assert.rejects(census(processorFixture), (error) => {
    assert.equal(error.code, "source-pr-has-current-processor-approval");
    return true;
  });

  const wrongAttemptFixture = liveFixture();
  await assert.rejects(
    census(wrongAttemptFixture, { processorRunAttempt: 2 }),
    (error) => {
      assert.equal(error.code, "processor-run-invalid");
      return true;
    },
  );
  assert.equal(
    wrongAttemptFixture.state.calls.some(isRepositoryMutation),
    false,
  );

  const priorScheduleFixture = liveFixture();
  priorScheduleFixture.state.processorRunConclusion = "success";
  priorScheduleFixture.state.processorRunEvent = "schedule";
  priorScheduleFixture.state.processorRunStatus = "completed";
  const prior = await census(priorScheduleFixture, {
    processorRunAttempt: 3,
    processorRunId: 9_000,
  });
  assert.equal(prior.orchestratorRunId, 9_000);
  assert.equal(prior.orchestratorRunAttempt, 3);
  assert.equal(prior.processorRunId, PROCESSOR_RUN_ID);
  assert.equal(prior.processorRunAttempt, 1);
});

test("open rejects compact receipt tampering before using PR authority", async () => {
  const cases = [
    {
      expected: "stage-receipt-live-binding-mismatch",
      mutate: (receipt) => (receipt.inputDigest = "9".repeat(64)),
    },
    {
      expected: "stage-receipt-live-binding-mismatch",
      mutate: (receipt) => (receipt.planDigest = "9".repeat(64)),
    },
    {
      expected: "stage-receipt-live-binding-mismatch",
      mutate: (receipt) => (receipt.feedbackDigest = "9".repeat(64)),
    },
    {
      expected: "stage-receipt-live-binding-mismatch",
      mutate: (receipt) => (receipt.editBindings[0].blobSha = "9".repeat(40)),
    },
    {
      expected: "staged-ref-invalid",
      mutate: (receipt) => (receipt.commitSha = "9".repeat(40)),
    },
  ];
  for (const testCase of cases) {
    const fixture = liveFixture();
    const staged = await stage(fixture);
    const tampered = structuredClone(staged);
    testCase.mutate(tampered);
    await assert.rejects(open(fixture, tampered), (error) => {
      assert.equal(error instanceof ActionsCompanionLiveError, true);
      assert.equal(error.code, testCase.expected);
      return true;
    });
    assert.equal(
      fixture.state.calls.some(
        ({ authorization, method, url }) =>
          method === "POST" &&
          url.pathname.endsWith("/pulls") &&
          authorization === `Bearer ${OPEN_TOKEN}`,
      ),
      false,
      testCase.expected,
    );
  }
});

test("exact staged and open states converge without duplicate writes", async () => {
  const fixture = liveFixture();
  const sealed = await census(fixture);
  const staged = await stage(fixture, sealed);
  const mutationsAfterStage =
    fixture.state.calls.filter(isRepositoryMutation).length;
  assert.deepEqual(await stage(fixture, sealed), staged);
  assert.equal(
    fixture.state.calls.filter(isRepositoryMutation).length,
    mutationsAfterStage,
  );
  const opened = await open(fixture, staged);
  fixture.state.censusPulls = [fixture.state.openedPull];
  const mutationsAfterOpen =
    fixture.state.calls.filter(isRepositoryMutation).length;
  const converged = await open(fixture, staged);
  assert.equal(converged.result, "already-open");
  assert.deepEqual(converged.companionPullRequest, opened.companionPullRequest);
  assert.equal(
    fixture.state.calls.filter(isRepositoryMutation).length,
    mutationsAfterOpen,
  );
});

test("exact ref and pull-request creation races converge", async () => {
  const fixture = liveFixture();
  const sealed = await census(fixture);
  fixture.state.refCreateRaces = true;
  const staged = await stage(fixture, sealed);
  assert.equal(staged.result, "staged");
  fixture.state.pullCreateRaces = true;
  const opened = await open(fixture, staged);
  assert.equal(opened.result, "already-open");
  assert.equal(opened.companionPullRequest.number, 841);
});

test("closed companions become bounded terminal no-ops and mismatches fail closed", async () => {
  for (const merged of [false, true]) {
    const fixture = liveFixture();
    const sealed = await census(fixture);
    const staged = await stage(fixture, sealed);
    fixture.state.censusPulls = [
      existingPull({
        body: sealed.plan.pullRequestBody,
        branchRef: staged.branchRef,
        merged,
        state: "closed",
        title: sealed.plan.pullRequestTitle,
      }),
    ];
    const mutations = fixture.state.calls.filter(isRepositoryMutation).length;
    const terminalCensus = await census(fixture);
    assert.equal(terminalCensus.result, "terminal");
    assert.equal(terminalCensus.reason, merged ? "merged" : "closed-unmerged");
    const terminalStage = await stage(fixture, terminalCensus);
    assert.equal(terminalStage.result, "terminal");
    assert.equal(
      fixture.state.calls.filter(isRepositoryMutation).length,
      mutations,
    );
  }

  const duplicateFixture = liveFixture();
  const sealed = await census(duplicateFixture);
  duplicateFixture.state.censusPulls = [
    existingPull({
      body: sealed.plan.pullRequestBody,
      branchRef: sealed.plan.branchRef,
      number: 900,
      title: sealed.plan.pullRequestTitle,
    }),
    existingPull({
      body: sealed.plan.pullRequestBody,
      branchRef: sealed.plan.branchRef,
      number: 901,
      title: sealed.plan.pullRequestTitle,
    }),
  ];
  await assert.rejects(census(duplicateFixture), (error) => {
    assert.equal(error.code, "duplicate-companion-prs");
    return true;
  });

  const mismatchFixture = liveFixture();
  const mismatchSealed = await census(mismatchFixture);
  mismatchFixture.state.censusPulls = [
    existingPull({
      body: "mismatched body",
      branchRef: mismatchSealed.plan.branchRef,
      state: "closed",
      title: mismatchSealed.plan.pullRequestTitle,
    }),
  ];
  await assert.rejects(census(mismatchFixture), (error) => {
    assert.equal(error.code, "terminal-companion-pr-mismatch");
    return true;
  });
});

test("adapter source has built-in dependencies and no forbidden mutation surface", () => {
  const source = readFileSync(SCRIPT_PATH, "utf8");
  const imports = [...source.matchAll(/from\s+"([^"]+)"/gu)].map(
    ([, specifier]) => specifier,
  );
  assert.equal(
    imports.every(
      (specifier) =>
        specifier.startsWith("node:") || specifier.startsWith("./"),
    ),
    true,
  );
  assert.doesNotMatch(source, /node:child_process|\bspawn\b|\bexecFile\b/u);
  assert.doesNotMatch(source, /\bcheckout\b|\bgh\s+(?:api|pr)\b/u);
  assert.doesNotMatch(source, /DEPENDABOT_COMPANION_APP_TOKEN/u);
  assert.match(source, /DEPENDABOT_COMPANION_STAGE_APP_TOKEN/u);
  assert.match(source, /DEPENDABOT_COMPANION_OPEN_APP_TOKEN/u);
});
