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
const PREPARE_APP_SLUG = "dependabot-companion-prepare";
const PREPARE_BOT_ID = 91_840;
const PREPARE_BOT_LOGIN = `${PREPARE_APP_SLUG}[bot]`;
const PREPARE_BOT = {
  id: PREPARE_BOT_ID,
  login: PREPARE_BOT_LOGIN,
  type: "Bot",
};
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
  baseSha = BASE_SHA,
  branchRef,
  body = "",
  headSha = STAGED_COMMIT_SHA,
  merged = false,
  number = 900,
  state = "open",
  title = "",
  user = PREPARE_BOT,
}) {
  return {
    base: {
      ref: "main",
      repo: { full_name: REPOSITORY },
      sha: baseSha,
    },
    head: {
      ref: branchRef,
      repo: { full_name: REPOSITORY },
      sha: headSha,
    },
    body,
    draft: false,
    html_url: `https://github.com/${REPOSITORY}/pull/${number}`,
    maintainer_can_modify: false,
    merged_at: merged ? "2026-08-24T12:00:00Z" : null,
    number,
    state,
    title,
    user,
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
    blobResponses: new Map(),
    calls: [],
    companionCensusReads: 0,
    censusPulls: [],
    forcePushEvents: [],
    issueComments: [],
    lateIssueCommentAtCompanionCensus: null,
    lateThreadAtCompanionCensus: null,
    currentMainSha: BASE_SHA,
    mainRefReads: 0,
    moveMainAtRead: null,
    openedPull: null,
    processorExactRunAttempt: 1,
    processorExactRunHttpStatus: 200,
    processorLatestRunAttempt: 1,
    processorSummary:
      "Disposition: manual-review. Reason: sensitive-auth-deployment-or-workflow-policy-action. Next action: create a maintainer-authored companion or replacement PR.",
    processorRunConclusion: null,
    processorRunEvent: "workflow_run",
    processorRunStatus: "in_progress",
    pullCreateRaces: false,
    refCreateRaces: false,
    reviewThreads: [],
    sourceReviews: [],
    prepareBot: structuredClone(PREPARE_BOT),
    stagedCommitSha: STAGED_COMMIT_SHA,
    stagedCommitMessage: null,
    stagedCommitParentSha: BASE_SHA,
    stagedCommitTreeSha: STAGED_TREE_SHA,
    stagedEntries,
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
  state.headEntries = headEntries;
  state.sourceCommit = sourceCommit;
  const processorRun = (runAttempt) => ({
    conclusion: state.processorRunConclusion,
    event: state.processorRunEvent,
    head_branch: "main",
    head_sha: WORKFLOW_SHA,
    id: PROCESSOR_RUN_ID,
    path: ".github/workflows/dependabot-process.yml",
    repository: { full_name: REPOSITORY },
    run_attempt: runAttempt,
    status: state.processorRunStatus,
  });

  const fetchImpl = async (url, options = {}) => {
    const parsed = new URL(url);
    const method = options.method ?? "GET";
    const body = options.body === undefined ? null : JSON.parse(options.body);
    const authorization = options.headers?.Authorization;
    state.calls.push({ authorization, body, method, url: parsed });
    const path = parsed.pathname;

    if (
      method === "GET" &&
      path === `/users/${encodeURIComponent(PREPARE_BOT_LOGIN)}`
    ) {
      return json(state.prepareBot);
    }

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
      return json([state.sourceCommit]);
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
        object: {
          sha: moved ? OTHER_SHA : state.currentMainSha,
          type: "commit",
        },
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
      return json({
        sha: HEAD_TREE_SHA,
        tree: state.headEntries,
        truncated: false,
      });
    }
    if (method === "GET" && path.includes(`/git/blobs/`)) {
      const sha = path.split("/").at(-1);
      if (state.blobResponses.has(sha)) {
        return json(state.blobResponses.get(sha));
      }
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
      path ===
        `/repos/${REPOSITORY}/actions/runs/${PROCESSOR_RUN_ID}/attempts/1`
    ) {
      if (state.processorExactRunHttpStatus !== 200) {
        return json(
          { message: "Processor run attempt unavailable" },
          state.processorExactRunHttpStatus,
        );
      }
      return json(processorRun(state.processorExactRunAttempt));
    }
    if (
      method === "GET" &&
      path === `/repos/${REPOSITORY}/actions/runs/${PROCESSOR_RUN_ID}`
    ) {
      return json(processorRun(state.processorLatestRunAttempt));
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
        message: state.stagedCommitMessage ?? stageCommitCall.body.message,
        parents: [{ sha: state.stagedCommitParentSha }],
        sha: state.stagedCommitSha,
        tree: { sha: state.stagedCommitTreeSha },
      });
    }
    if (
      method === "GET" &&
      path === `/repos/${REPOSITORY}/git/trees/${STAGED_TREE_SHA}`
    ) {
      return json({
        sha: STAGED_TREE_SHA,
        tree: state.stagedEntries,
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
        maintainer_can_modify: body.maintainer_can_modify,
        number: 841,
        state: "open",
        title: body.title,
        user: PREPARE_BOT,
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
    expectedBaseSha: BASE_SHA,
    expectedHeadSha: HEAD_SHA,
    fetchImpl: fixture.fetchImpl,
    prepareAppSlug: PREPARE_APP_SLUG,
    prepareBotId: PREPARE_BOT_ID,
    prepareBotLogin: PREPARE_BOT_LOGIN,
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
    baseDirectory: fixture.baseDirectory,
    censusReceipt: censusReceipt ?? (await census(fixture)),
    expectedBaseSha: BASE_SHA,
    expectedHeadSha: HEAD_SHA,
    fetchImpl: fixture.fetchImpl,
    prepareAppSlug: PREPARE_APP_SLUG,
    prepareBotId: PREPARE_BOT_ID,
    prepareBotLogin: PREPARE_BOT_LOGIN,
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
    baseDirectory: fixture.baseDirectory,
    expectedBaseSha: BASE_SHA,
    expectedHeadSha: HEAD_SHA,
    fetchImpl: fixture.fetchImpl,
    openToken: OPEN_TOKEN,
    prepareAppSlug: PREPARE_APP_SLUG,
    prepareBotId: PREPARE_BOT_ID,
    prepareBotLogin: PREPARE_BOT_LOGIN,
    pullRequestNumber: 840,
    processorRunAttempt: 1,
    processorRunId: PROCESSOR_RUN_ID,
    readToken: READ_TOKEN,
    repository: REPOSITORY,
    stageReceipt,
    workflowSha: WORKFLOW_SHA,
  });
}

async function closedCompanionFixture({ merged = true } = {}) {
  const fixture = liveFixture();
  const sealed = await census(fixture);
  const staged = await stage(fixture, sealed);
  const pull = existingPull({
    body: sealed.plan.pullRequestBody,
    branchRef: staged.branchRef,
    merged,
    state: "closed",
    title: sealed.plan.pullRequestTitle,
  });
  fixture.state.censusPulls = [pull];
  return { fixture, pull, sealed, staged };
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
    fixture.state.companionCensusReads + 3;
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

test("reuses a completed Processor receipt from an earlier attempt of the same run", async () => {
  const fixture = liveFixture();
  fixture.state.processorLatestRunAttempt = 2;
  fixture.state.processorRunConclusion = "success";
  fixture.state.processorRunStatus = "completed";

  const sealed = await census(fixture, { processorRunAttempt: 2 });
  assert.equal(sealed.orchestratorRunAttempt, 2);
  assert.equal(sealed.processorRunId, PROCESSOR_RUN_ID);
  assert.equal(sealed.processorRunAttempt, 1);
  assert.equal(
    fixture.state.calls.some(
      ({ method, url }) =>
        method === "GET" &&
        url.pathname ===
          `/repos/${REPOSITORY}/actions/runs/${PROCESSOR_RUN_ID}/attempts/1`,
    ),
    true,
  );
  assert.equal(
    fixture.state.calls.some(
      ({ method, url }) =>
        method === "GET" &&
        url.pathname ===
          `/repos/${REPOSITORY}/actions/runs/${PROCESSOR_RUN_ID}`,
    ),
    false,
  );
});

test("exact Processor attempt lookup fails closed on mismatch or fetch failure", async () => {
  const mismatchFixture = liveFixture();
  mismatchFixture.state.processorExactRunAttempt = 2;
  await assert.rejects(
    census(mismatchFixture, { processorRunAttempt: 2 }),
    (error) => {
      assert.equal(error.code, "processor-run-invalid");
      return true;
    },
  );
  assert.equal(mismatchFixture.state.calls.some(isRepositoryMutation), false);

  const fetchFailureFixture = liveFixture();
  fetchFailureFixture.state.processorExactRunHttpStatus = 500;
  await assert.rejects(
    census(fetchFailureFixture, { processorRunAttempt: 2 }),
    (error) => {
      assert.equal(error.code, "github-api-request-failed");
      return true;
    },
  );
  assert.equal(
    fetchFailureFixture.state.calls.some(isRepositoryMutation),
    false,
  );
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

test("terminal convergence uses the historical base after main moves and the branch disappears", async () => {
  const { fixture, pull, sealed, staged } = await closedCompanionFixture();
  fixture.state.branchCreated = false;
  fixture.state.currentMainSha = OTHER_SHA;
  pull.base.sha = OTHER_SHA;
  const mainRefReads = fixture.state.mainRefReads;
  const mutations = fixture.state.calls.filter(isRepositoryMutation).length;
  const terminalCallsStart = fixture.state.calls.length;

  const plannedStageTerminal = await stage(fixture, sealed);
  assert.equal(plannedStageTerminal.result, "terminal");
  const plannedOpenTerminal = await open(fixture, staged);
  assert.equal(plannedOpenTerminal.result, "terminal");

  const terminalCensus = await census(fixture);
  const terminalStage = await stage(fixture, terminalCensus);
  const terminalOpen = await open(fixture, terminalStage);
  assert.equal(terminalCensus.reason, "merged");
  assert.equal(terminalStage.reason, "merged");
  assert.equal(terminalOpen.reason, "merged");
  assert.equal(fixture.state.mainRefReads, mainRefReads);
  assert.equal(
    fixture.state.calls.filter(isRepositoryMutation).length,
    mutations,
  );
  assert.equal(
    fixture.state.calls
      .slice(terminalCallsStart)
      .every(({ authorization }) => authorization === `Bearer ${READ_TOKEN}`),
    true,
  );
});

test("terminal convergence authenticates the Prepare App bot", async () => {
  const actors = [
    { id: PREPARE_BOT_ID + 1, login: PREPARE_BOT_LOGIN, type: "Bot" },
    { id: PREPARE_BOT_ID, login: "attacker[bot]", type: "Bot" },
    { id: PREPARE_BOT_ID, login: PREPARE_BOT_LOGIN, type: "User" },
  ];
  for (const actor of actors) {
    const prepared = await closedCompanionFixture();
    prepared.pull.user = actor;
    await assert.rejects(census(prepared.fixture), (error) => {
      assert.equal(error instanceof ActionsCompanionLiveError, true);
      assert.equal(error.code, "terminal-companion-author-mismatch");
      return true;
    });
  }

  const fixture = liveFixture();
  fixture.state.prepareBot.id += 1;
  await assert.rejects(census(fixture), (error) => {
    assert.equal(error.code, "prepare-app-bot-mismatch");
    return true;
  });
});

test("terminal convergence rejects a source commit or tree outside the historical plan", async () => {
  const parentAttack = await closedCompanionFixture();
  parentAttack.fixture.state.sourceCommit.parents = [{ sha: OTHER_SHA }];
  await assert.rejects(census(parentAttack.fixture), (error) => {
    assert.equal(error.name, "CompanionRejection");
    assert.equal(error.reason, "source-commit-parent-mismatch");
    return true;
  });

  const treeAttack = await closedCompanionFixture();
  treeAttack.fixture.state.headEntries = [
    ...treeAttack.fixture.state.headEntries,
    treeEntry("attacker-source.txt", "unplanned source content\n"),
  ];
  await assert.rejects(census(treeAttack.fixture), (error) => {
    assert.equal(error.code, "historical-source-tree-has-unplanned-changes");
    return true;
  });
});

test("terminal convergence rejects an incomplete or stale historical checkout", async () => {
  const incomplete = await closedCompanionFixture();
  rmSync(join(incomplete.fixture.baseDirectory, "README.md"));
  await assert.rejects(census(incomplete.fixture), (error) => {
    assert.equal(error.code, "base-directory-is-incomplete");
    return true;
  });

  const stale = await closedCompanionFixture();
  writeFileSync(join(stale.fixture.baseDirectory, "README.md"), "stale\n");
  await assert.rejects(census(stale.fixture), (error) => {
    assert.equal(error.code, "base-directory-does-not-match-current-main");
    return true;
  });
});

test("terminal convergence rejects a forged companion commit, tree, or blob", async () => {
  const commitIdentityAttack = await closedCompanionFixture();
  commitIdentityAttack.fixture.state.stagedCommitSha = OTHER_SHA;
  await assert.rejects(census(commitIdentityAttack.fixture), (error) => {
    assert.equal(error.code, "staged-commit-response-invalid");
    return true;
  });

  const commitParentAttack = await closedCompanionFixture();
  commitParentAttack.fixture.state.stagedCommitParentSha = OTHER_SHA;
  await assert.rejects(census(commitParentAttack.fixture), (error) => {
    assert.equal(error.code, "staged-commit-response-invalid");
    return true;
  });

  const commitMessageAttack = await closedCompanionFixture();
  commitMessageAttack.fixture.state.stagedCommitMessage = [
    "attacker-controlled commit",
    "",
    `Source-PR: #840`,
    `Source-Head: ${HEAD_SHA}`,
    `Companion-Plan: ${commitMessageAttack.sealed.plan.planDigest}`,
  ].join("\n");
  await assert.rejects(census(commitMessageAttack.fixture), (error) => {
    assert.equal(error.code, "staged-commit-response-invalid");
    return true;
  });

  const treeAttack = await closedCompanionFixture();
  treeAttack.fixture.state.stagedEntries = [
    ...treeAttack.fixture.state.stagedEntries,
    treeEntry("attacker-companion.txt", "unplanned companion content\n"),
  ];
  await assert.rejects(census(treeAttack.fixture), (error) => {
    assert.equal(error.code, "staged-tree-has-unplanned-changes");
    return true;
  });

  const emptyTreeAttack = await closedCompanionFixture();
  emptyTreeAttack.fixture.state.stagedEntries = [
    ...emptyTreeAttack.fixture.state.stagedEntries,
    {
      mode: "040000",
      path: "attacker-empty-tree",
      sha: OTHER_SHA,
      type: "tree",
    },
  ];
  await assert.rejects(census(emptyTreeAttack.fixture), (error) => {
    assert.equal(error.code, "staged-tree-has-unplanned-changes");
    return true;
  });

  for (const editIndex of [0, 1]) {
    const blobAttack = await closedCompanionFixture();
    const edit = blobAttack.sealed.plan.edits[editIndex];
    const forged = blobResponse(`forged result content ${editIndex}\n`);
    forged.sha = edit.resultBlobSha;
    blobAttack.fixture.state.blobResponses.set(edit.resultBlobSha, forged);
    await assert.rejects(census(blobAttack.fixture), (error) => {
      assert.equal(error.code, "git-blob-response-invalid");
      return true;
    });
  }
});

test("terminal stage and open repeat exact object verification", async () => {
  const stageAttack = await closedCompanionFixture();
  const terminalCensus = await census(stageAttack.fixture);
  stageAttack.fixture.state.stagedEntries = [
    ...stageAttack.fixture.state.stagedEntries,
    treeEntry("late-stage-attack.txt", "late attack\n"),
  ];
  await assert.rejects(stage(stageAttack.fixture, terminalCensus), (error) => {
    assert.equal(error.code, "staged-tree-has-unplanned-changes");
    return true;
  });

  const openAttack = await closedCompanionFixture();
  const openCensus = await census(openAttack.fixture);
  const terminalStage = await stage(openAttack.fixture, openCensus);
  openAttack.fixture.state.stagedCommitMessage = "late open attack";
  await assert.rejects(open(openAttack.fixture, terminalStage), (error) => {
    assert.equal(error.code, "staged-commit-response-invalid");
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
