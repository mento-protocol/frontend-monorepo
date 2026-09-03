import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  bodyCarriesMarker,
  collectFailureEvidence,
  failureBody,
  reconcileCiFailureIssue,
  renderField,
} from "./ci-failure-issue.mjs";

function managedMarker(event = "push", targetRef = "main") {
  return `<!-- managed-ci-failure:77:${event}:${encodeURIComponent(targetRef)} -->`;
}

function workflowRun(overrides = {}) {
  const runNumber = overrides.run_number ?? 12;
  return {
    id: 1_000 + runNumber,
    workflow_id: 77,
    name: "Quality Budgets",
    path: ".github/workflows/quality-budgets.yml",
    run_number: runNumber,
    run_attempt: 1,
    html_url:
      "https://github.com/mento-protocol/frontend-monorepo/actions/runs/1234",
    head_branch: "main",
    head_repository: {
      full_name: "mento-protocol/frontend-monorepo",
    },
    event: "push",
    status: "completed",
    conclusion: "failure",
    ...overrides,
  };
}

function mainDeploymentRun(overrides = {}) {
  return workflowRun({
    name: "Vercel Main Deployment",
    path: ".github/workflows/vercel-main-deployment.yml",
    event: "workflow_run",
    ...overrides,
  });
}

function managedIssue(overrides = {}) {
  return {
    number: 42,
    state: "open",
    body: `failure\n\n${managedMarker()}`,
    user: { login: "github-actions[bot]" },
    ...overrides,
  };
}

/**
 * A request that settles only when its caller aborts it. The keep-alive timer
 * is load-bearing: `AbortSignal.timeout()` arms an unref'd timer, so without a
 * ref'd handle of our own the event loop drains while this promise is still
 * pending and node:test cancels the test and everything queued behind it.
 */
function stallUntilAbort(signal) {
  return new Promise((_resolve, reject) => {
    const keepAlive = setTimeout(() => {
      reject(new Error("the abort signal never fired"));
    }, 30_000);
    signal.addEventListener("abort", () => {
      clearTimeout(keepAlive);
      reject(signal.reason);
    });
  });
}

function failedJob(overrides = {}) {
  return {
    id: 900_001,
    name: "osv-scanner SARIF (trusted pnpm runtime) / osv-scan",
    html_url:
      "https://github.com/mento-protocol/frontend-monorepo/actions/runs/1234/job/900001",
    conclusion: "failure",
    steps: [
      { name: "Check out code", conclusion: "success" },
      {
        name: "Fail on newly introduced vulnerabilities",
        conclusion: "failure",
      },
    ],
    ...overrides,
  };
}

function harness({
  run = workflowRun(),
  issues = [],
  latestRuns,
  runPages,
  jobs = [],
  listJobsError,
  listJobsStalls = false,
} = {}) {
  const calls = {
    create: [],
    update: [],
    listRuns: 0,
    listIssues: 0,
    listJobs: 0,
  };
  function listWorkflowRuns() {}
  function listForRepo() {}
  function listJobsForWorkflowRun() {}
  const paginate = async (method, parameters) => {
    if (method === listJobsForWorkflowRun) {
      calls.listJobs += 1;
      calls.jobsRunId = parameters.run_id;
      calls.listSignal = parameters.request?.signal;
      assert.equal(parameters.filter, "all");
      assert.equal(parameters.per_page, 100);
      if (listJobsError) throw listJobsError;
      if (listJobsStalls) return stallUntilAbort(parameters.request.signal);
      return jobs;
    }
    assert.equal(method, listForRepo);
    calls.listIssues += 1;
    assert.equal(parameters.state, "all");
    return issues;
  };
  paginate.iterator = async function* (method, parameters) {
    assert.equal(method, listWorkflowRuns);
    assert.equal(parameters.exclude_pull_requests, true);
    assert.equal(parameters.event, run.event);
    assert.equal(parameters.status, "completed");
    assert.equal(parameters.per_page, 100);
    for (const page of runPages ?? [latestRuns ?? [run]]) {
      calls.listRuns += 1;
      yield { data: page };
    }
  };
  const github = {
    paginate,
    rest: {
      actions: {
        listWorkflowRuns,
        listJobsForWorkflowRun,
      },
      issues: {
        listForRepo,
        create: async (parameters) => {
          calls.create.push(parameters);
          return { data: { number: 91 } };
        },
        update: async (parameters) => {
          calls.update.push(parameters);
          return { data: {} };
        },
      },
    },
  };
  const context = {
    repo: { owner: "mento-protocol", repo: "frontend-monorepo" },
    payload: {
      repository: { default_branch: "main" },
      workflow_run: run,
    },
  };

  return { github, context, calls };
}

test("opens one marker-keyed issue for a default-branch failure", async () => {
  const { github, context, calls } = harness();
  const result = await reconcileCiFailureIssue({ github, context });

  assert.deepEqual(result, { action: "opened", issueNumber: 91 });
  assert.equal(calls.create.length, 1);
  assert.equal(
    calls.create[0].title,
    "CI: Quality Budgets is failing (main; push)",
  );
  assert.match(calls.create[0].body, /managed-ci-failure:77:push:main/);
  assert.match(calls.create[0].body, /run #12, attempt 1/);
  assert.match(calls.create[0].body, /^## What failed$/m);
  // The marker stays the last line so reconciliation keeps finding this issue.
  assert.equal(
    calls.create[0].body.trimEnd().split("\n").at(-1),
    managedMarker(),
  );
});

test("updates and reopens the existing issue instead of adding comments", async () => {
  const existing = managedIssue({
    state: "closed",
    body: `old failure\n\n${managedMarker()}`,
  });
  const { github, context, calls } = harness({ issues: [existing] });
  const result = await reconcileCiFailureIssue({ github, context });

  assert.deepEqual(result, { action: "updated", issueNumber: 42 });
  assert.equal(calls.create.length, 0);
  assert.equal(calls.update[0].state, "open");
  assert.match(calls.update[0].body, /Latest failure/);
});

test("closes an open managed issue after the latest successful run", async () => {
  const run = workflowRun({ conclusion: "success", run_number: 13 });
  const existing = managedIssue();
  const { github, context, calls } = harness({ run, issues: [existing] });
  const result = await reconcileCiFailureIssue({ github, context });

  assert.deepEqual(result, { action: "closed", issueNumber: 42 });
  assert.equal(calls.update[0].state, "closed");
  assert.equal(calls.update[0].state_reason, "completed");
  assert.match(calls.update[0].body, /## Recovery/);
});

test("does not overwrite a human-authored issue that copied the marker", async () => {
  const copiedMarker = managedIssue({
    number: 55,
    user: { login: "external-contributor" },
  });
  const { github, context, calls } = harness({ issues: [copiedMarker] });
  const result = await reconcileCiFailureIssue({ github, context });

  assert.deepEqual(result, { action: "opened", issueNumber: 91 });
  assert.equal(calls.create.length, 1);
  assert.equal(calls.update.length, 0);
});

test("a stale failure callback closes the issue for a newer success", async () => {
  const stale = workflowRun({ run_number: 12 });
  const latest = workflowRun({
    run_number: 13,
    conclusion: "success",
  });
  const { github, context, calls } = harness({
    run: stale,
    issues: [managedIssue()],
    latestRuns: [latest, stale],
  });
  const result = await reconcileCiFailureIssue({ github, context });

  assert.deepEqual(result, { action: "closed", issueNumber: 42 });
  assert.match(calls.update[0].body, /run #13/);
  assert.equal(calls.create.length, 0);
});

test("a stale success callback reopens the issue for a newer failure", async () => {
  const stale = workflowRun({ conclusion: "success", run_number: 12 });
  const latest = workflowRun({ conclusion: "failure", run_number: 13 });
  const { github, context, calls } = harness({
    run: stale,
    issues: [managedIssue({ state: "closed" })],
    latestRuns: [latest, stale],
  });
  const result = await reconcileCiFailureIssue({ github, context });

  assert.deepEqual(result, { action: "updated", issueNumber: 42 });
  assert.equal(calls.update[0].state, "open");
  assert.match(calls.update[0].body, /run #13/);
});

test("a stale failed attempt closes for a successful rerun with the same ID", async () => {
  const stale = workflowRun({ id: 4_242, run_attempt: 1 });
  const latest = workflowRun({
    id: 4_242,
    run_attempt: 2,
    conclusion: "success",
  });
  const { github, context, calls } = harness({
    run: stale,
    issues: [managedIssue()],
    latestRuns: [latest],
  });
  const result = await reconcileCiFailureIssue({ github, context });

  assert.deepEqual(result, { action: "closed", issueNumber: 42 });
  assert.equal(calls.update[0].state, "closed");
  assert.match(calls.update[0].body, /run #12, attempt 2/);
  assert.equal(calls.create.length, 0);
});

test("a stale successful attempt reopens for a failed rerun with the same ID", async () => {
  const stale = workflowRun({
    id: 4_242,
    run_attempt: 1,
    conclusion: "success",
  });
  const latest = workflowRun({ id: 4_242, run_attempt: 2 });
  const { github, context, calls } = harness({
    run: stale,
    issues: [managedIssue({ state: "closed" })],
    latestRuns: [latest],
  });
  const result = await reconcileCiFailureIssue({ github, context });

  assert.deepEqual(result, { action: "updated", issueNumber: 42 });
  assert.equal(calls.update[0].state, "open");
  assert.match(calls.update[0].body, /run #12, attempt 2/);
});

test("neutral runs do not suppress the latest decisive result", async () => {
  const failure = workflowRun({ run_number: 12 });
  const neutral = workflowRun({ conclusion: "cancelled", run_number: 13 });
  const { github, context, calls } = harness({
    run: failure,
    latestRuns: [neutral, failure],
  });
  const result = await reconcileCiFailureIssue({ github, context });

  assert.deepEqual(result, { action: "opened", issueNumber: 91 });
  assert.match(calls.create[0].body, /run #12/);
});

test("handles the current callback when the runs API has not indexed it yet", async () => {
  const current = workflowRun({ run_number: 13 });
  const older = workflowRun({ run_number: 12, conclusion: "success" });
  const { github, context, calls } = harness({
    run: current,
    latestRuns: [older],
  });
  const result = await reconcileCiFailureIssue({ github, context });

  assert.deepEqual(result, { action: "opened", issueNumber: 91 });
  assert.equal(calls.listRuns, 1);
  assert.equal(calls.create.length, 1);
});

test("stops pagination once newest-first results reach the callback", async () => {
  const current = workflowRun({ run_number: 13 });
  const older = workflowRun({ conclusion: "success", run_number: 12 });
  const { github, context, calls } = harness({
    run: current,
    runPages: [[current], [older]],
  });
  const result = await reconcileCiFailureIssue({ github, context });

  assert.deepEqual(result, { action: "opened", issueNumber: 91 });
  assert.equal(calls.listRuns, 1);
});

test("finds a newer decisive run beyond the first API page", async () => {
  const stale = workflowRun({ run_number: 12 });
  const neutralFirstPage = Array.from({ length: 100 }, (_, index) =>
    workflowRun({
      conclusion: "skipped",
      id: 2_000 + index,
      run_number: 300 - index,
    }),
  );
  const latest = workflowRun({
    conclusion: "success",
    id: 9_999,
    run_number: 200,
  });
  const { github, context, calls } = harness({
    run: stale,
    issues: [managedIssue()],
    runPages: [neutralFirstPage, [latest, stale]],
  });
  const result = await reconcileCiFailureIssue({ github, context });

  assert.deepEqual(result, { action: "closed", issueNumber: 42 });
  assert.equal(calls.listRuns, 2);
  assert.match(calls.update[0].body, /run #200/);
});

test("tracks scheduled failures when GitHub omits the head branch", async () => {
  const run = workflowRun({ event: "schedule", head_branch: null });
  const { github, context, calls } = harness({ run });
  const result = await reconcileCiFailureIssue({ github, context });

  assert.deepEqual(result, { action: "opened", issueNumber: 91 });
  assert.equal(
    calls.create[0].title,
    "CI: Quality Budgets is failing (main; schedule)",
  );
  assert.match(calls.create[0].body, /failed for `main`/);
  assert.match(calls.create[0].body, /managed-ci-failure:77:schedule:main/);
});

test("exposes the manual trigger in the incident title", async () => {
  const run = workflowRun({ event: "workflow_dispatch" });
  const { github, context, calls } = harness({ run });
  const result = await reconcileCiFailureIssue({ github, context });

  assert.deepEqual(result, { action: "opened", issueNumber: 91 });
  assert.equal(
    calls.create[0].title,
    "CI: Quality Budgets is failing (main; workflow_dispatch)",
  );
});

test("opens and updates the managed main-deployment workflow_run issue", async () => {
  const firstFailure = mainDeploymentRun({ run_number: 30 });
  const openedHarness = harness({ run: firstFailure });
  const opened = await reconcileCiFailureIssue(openedHarness);
  assert.deepEqual(opened, { action: "opened", issueNumber: 91 });
  assert.equal(
    openedHarness.calls.create[0].title,
    "CI: Vercel Main Deployment is failing (main; workflow_run)",
  );
  assert.match(
    openedHarness.calls.create[0].body,
    /managed-ci-failure:77:workflow_run:main/,
  );

  const repeatedFailure = mainDeploymentRun({ run_number: 31 });
  const existing = managedIssue({
    body: `failure\n\n${managedMarker("workflow_run")}`,
  });
  const updatedHarness = harness({
    run: repeatedFailure,
    issues: [existing],
  });
  const updated = await reconcileCiFailureIssue(updatedHarness);
  assert.deepEqual(updated, { action: "updated", issueNumber: 42 });
  assert.equal(updatedHarness.calls.update[0].state, "open");
  assert.match(updatedHarness.calls.update[0].body, /run #31/);
});

test("a later main-deployment workflow_run success closes only its partition", async () => {
  const success = mainDeploymentRun({
    conclusion: "success",
    run_number: 32,
  });
  const existing = managedIssue({
    body: `failure\n\n${managedMarker("workflow_run")}`,
  });
  const { github, context, calls } = harness({
    run: success,
    issues: [existing],
  });
  const result = await reconcileCiFailureIssue({ github, context });
  assert.deepEqual(result, { action: "closed", issueNumber: 42 });
  assert.equal(calls.update[0].state, "closed");
  assert.match(calls.update[0].body, /run #32/);
});

test("workflow_run monitoring rejects unrelated workflows, wrong branches, and forks", async () => {
  for (const run of [
    workflowRun({ event: "workflow_run", name: "Quality Budgets" }),
    mainDeploymentRun({ head_branch: "feature/example" }),
    mainDeploymentRun({
      head_repository: { full_name: "contributor/frontend-monorepo" },
    }),
  ]) {
    const { github, context, calls } = harness({ run });
    const result = await reconcileCiFailureIssue({ github, context });
    assert.deepEqual(result, { action: "ignored", reason: "untracked-run" });
    assert.equal(calls.listRuns, 0);
    assert.equal(calls.listIssues, 0);
  }
});

test("a cross-event success cannot close a workflow_run failure", async () => {
  const pushSuccess = workflowRun({
    name: "Vercel Main Deployment",
    event: "push",
    conclusion: "success",
    run_number: 33,
  });
  const existing = managedIssue({
    body: `failure\n\n${managedMarker("workflow_run")}`,
  });
  const { github, context, calls } = harness({
    run: pushSuccess,
    issues: [existing],
  });
  const result = await reconcileCiFailureIssue({ github, context });
  assert.deepEqual(result, { action: "ignored", reason: "nothing-to-close" });
  assert.equal(calls.update.length, 0);
});

test("a manual success does not close a scheduled failure issue", async () => {
  const scheduledFailure = workflowRun({
    event: "schedule",
    head_branch: null,
    run_number: 12,
  });
  const manualSuccess = workflowRun({
    event: "workflow_dispatch",
    conclusion: "success",
    run_number: 13,
  });
  const { github, context, calls } = harness({
    run: manualSuccess,
    issues: [managedIssue({ body: `failure\n\n${managedMarker("schedule")}` })],
    latestRuns: [manualSuccess, scheduledFailure],
  });
  const result = await reconcileCiFailureIssue({ github, context });

  assert.deepEqual(result, { action: "ignored", reason: "nothing-to-close" });
  assert.equal(calls.update.length, 0);
  assert.equal(calls.create.length, 0);
});

test("a later scheduled success recovers only the scheduled partition", async () => {
  const staleFailure = workflowRun({
    event: "schedule",
    head_branch: null,
    run_number: 12,
  });
  const scheduledSuccess = workflowRun({
    event: "schedule",
    conclusion: "success",
    run_number: 13,
  });
  const newerManualSuccess = workflowRun({
    event: "workflow_dispatch",
    conclusion: "success",
    run_number: 14,
  });
  const { github, context, calls } = harness({
    run: staleFailure,
    issues: [managedIssue({ body: `failure\n\n${managedMarker("schedule")}` })],
    latestRuns: [newerManualSuccess, scheduledSuccess, staleFailure],
  });
  const result = await reconcileCiFailureIssue({ github, context });

  assert.deepEqual(result, { action: "closed", issueNumber: 42 });
  assert.match(calls.update[0].body, /run #13, attempt 1/);
  assert.doesNotMatch(calls.update[0].body, /run #14/);
});

test("ignores non-operational events, feature runs, and cancelled runs", async () => {
  for (const run of [
    workflowRun({ event: "pull_request" }),
    workflowRun({ event: "repository_dispatch" }),
    workflowRun({ head_branch: "feature/example" }),
    workflowRun({ event: "workflow_dispatch", head_branch: "feature/example" }),
    workflowRun({ conclusion: "cancelled" }),
  ]) {
    const { github, context, calls } = harness({ run });
    const result = await reconcileCiFailureIssue({ github, context });
    assert.equal(result.action, "ignored");
    assert.equal(calls.listIssues, 0);
  }
});

test("tracks release-tag push failures without executing their source", async () => {
  const run = workflowRun({
    name: "Publish UI Package",
    head_branch: null,
  });
  const { github, context, calls } = harness({ run });
  const result = await reconcileCiFailureIssue({ github, context });

  assert.equal(result.action, "opened");
  assert.match(calls.create[0].body, /failed for `release tag`/);
  assert.match(
    calls.create[0].body,
    /managed-ci-failure:77:push:release%20tag/,
  );
});

test("the module reads no job logs on any code path", () => {
  // The posture, pinned on the source: nothing here may reach a log body. A
  // future change that reintroduces log text has to delete this test first.
  const source = readFileSync(
    new URL("./ci-failure-issue.mjs", import.meta.url),
    "utf8",
  );

  for (const forbidden of [
    "downloadJobLogsForWorkflowRun",
    "/logs",
    "fetch(",
    "redirect",
    "getReader",
    "arrayBuffer",
    "TextDecoder",
    "##[error]",
    "osv.dev",
  ]) {
    assert.ok(
      !source.includes(forbidden),
      `${forbidden} must not appear in the notifier source`,
    );
  }
});

test("failed jobs are reported by job and step name only", async () => {
  const job = failedJob();
  const { github, context, calls } = harness({
    jobs: [job, { id: 900_002, name: "passing job", conclusion: "success" }],
  });
  const result = await reconcileCiFailureIssue({ github, context });

  assert.deepEqual(result, { action: "opened", issueNumber: 91 });
  const body = calls.create[0].body;
  assert.equal(calls.listJobs, 1);
  assert.match(body, /^## What failed$/m);
  assert.match(body, /osv-scanner SARIF \(trusted pnpm runtime\) \/ osv-scan/);
  assert.match(body, /failed step: `Fail on newly introduced vulnerabilities`/);
  assert.match(
    body,
    /\(\[job log\]\(https:\/\/github\.com\/[^)]+\/job\/900001\)\)/,
  );
  assert.doesNotMatch(body, /passing job/);
  assert.match(body, /never quotes job log output/);
  assert.match(body, /managed-ci-failure:77:push:main/);
});

test("every failed step of a job is listed", async () => {
  const job = failedJob({
    steps: [
      { name: "first check", conclusion: "failure" },
      { name: "second check", conclusion: "success" },
      { name: "third check", conclusion: "timed_out" },
    ],
  });
  const { github, context, calls } = harness({ jobs: [job] });
  await reconcileCiFailureIssue({ github, context });

  const body = calls.create[0].body;
  assert.match(body, /failed steps: `first check`, `third check`/);
  assert.doesNotMatch(body, /second check/);
});

test("failed steps beyond the cap are counted, not silently dropped", async () => {
  // A job with many failing `if: always()` cleanup steps must not read as a
  // complete list.
  const steps = [
    { name: "passing setup", conclusion: "success" },
    ...Array.from({ length: 12 }, (_, index) => ({
      name: `cleanup ${index}`,
      conclusion: index === 11 ? "timed_out" : "failure",
    })),
  ];
  const { github, context, calls } = harness({ jobs: [failedJob({ steps })] });
  await reconcileCiFailureIssue({ github, context });

  const body = calls.create[0].body;
  const row = body.split("\n").find((line) => line.startsWith("- `"));
  const listed = [...row.matchAll(/`cleanup \d+`/g)];
  assert.equal(listed.length, 10, "the ten-step cap still holds");
  assert.match(row, /, and 2 more failed steps not shown/);
  assert.match(row, /`cleanup 9`/);
  assert.doesNotMatch(row, /`cleanup 10`/);
  assert.doesNotMatch(row, /passing setup/);
});

test("a single omitted failed step is reported in the singular", async () => {
  const steps = Array.from({ length: 11 }, (_, index) => ({
    name: `check ${index}`,
    conclusion: "failure",
  }));
  const { github, context, calls } = harness({ jobs: [failedJob({ steps })] });
  await reconcileCiFailureIssue({ github, context });

  assert.match(calls.create[0].body, /, and 1 more failed step not shown/);
});

test("a job at the cap reports no omission note", async () => {
  const steps = Array.from({ length: 10 }, (_, index) => ({
    name: `check ${index}`,
    conclusion: "failure",
  }));
  const { github, context, calls } = harness({ jobs: [failedJob({ steps })] });
  await reconcileCiFailureIssue({ github, context });

  assert.doesNotMatch(calls.create[0].body, /more failed step/);
});

test("a job with no failed step still names the job", async () => {
  const job = failedJob({ steps: [{ name: "setup", conclusion: "success" }] });
  const { github, context, calls } = harness({ jobs: [job] });
  await reconcileCiFailureIssue({ github, context });

  assert.match(calls.create[0].body, /— no failed step reported/);
});

test("a hostile job or step name cannot forge body structure", async () => {
  const job = failedJob({
    name: `evil\n\n${managedMarker()}\n\n**bold**`,
    steps: [
      {
        name: "`backtick` and [link](http://x) and <b>",
        conclusion: "failure",
      },
    ],
  });
  const { github, context, calls } = harness({ jobs: [job] });
  await reconcileCiFailureIssue({ github, context });

  const body = calls.create[0].body;
  const markerLines = body
    .split("\n")
    .filter((line) => line.trim() === managedMarker());
  assert.equal(markerLines.length, 1, "a name must not forge a marker line");
  assert.equal(body.trimEnd().split("\n").at(-1), managedMarker());
  // Names are quoted, not escaped. A backslash is literal inside a code span,
  // so the delimiter is what holds the name in, and the span is also what
  // keeps emphasis, a mention and an autolink from going live.
  assert.ok(
    body.includes("`evil <!-- managed-ci-failure:77:push:main --> **bold**` —"),
    "a job name stays inside one code span on one line",
  );
  assert.ok(
    body.includes("`` `backtick` and [link](http://x) and <b> ``"),
    "a step name's own backticks cannot close its span",
  );
  assert.ok(!body.includes("\\`"), "a quoted name never carries a backslash");
});

test("a job name cannot smuggle a live mention or autolink into the issue", async () => {
  const job = failedJob({
    name: "notify @mento-protocol/security https://evil.example",
  });
  const { github, context, calls } = harness({ jobs: [job] });
  await reconcileCiFailureIssue({ github, context });

  const body = calls.create[0].body;
  assert.ok(
    body.includes("`notify @mento-protocol/security https://evil.example` —"),
    "the job name is quoted, so its mention and URL stay inert",
  );
  assert.equal(
    body.split("@mento-protocol/security").length - 1,
    1,
    "the mention appears once, inside the code span",
  );
  assert.equal(
    body.split("https://evil.example").length - 1,
    1,
    "the URL appears once, inside the code span",
  );
  assert.ok(
    !body.includes("**notify"),
    "a job name is quoted rather than emphasized",
  );
});

test("a step name's backticks cannot close its code span", async () => {
  const job = failedJob({
    steps: [
      { name: "run a`b", conclusion: "failure" },
      { name: "run ```x```", conclusion: "failure" },
      { name: "```", conclusion: "failure" },
      { name: "line one\nline two", conclusion: "failure" },
    ],
  });
  const { github, context, calls } = harness({ jobs: [job] });
  await reconcileCiFailureIssue({ github, context });

  const body = calls.create[0].body;
  assert.ok(
    body.includes("``run a`b``"),
    "one backtick takes a two-backtick delimiter",
  );
  assert.ok(
    body.includes("```` run ```x``` ````"),
    "a three-backtick run takes a four-backtick delimiter and padding",
  );
  assert.ok(
    body.includes("```` ``` ````"),
    "a name that is only backticks stays inside its span",
  );
  assert.ok(
    body.includes("`line one line two`"),
    "a newline in a step name is collapsed, never emitted",
  );
  assert.ok(!body.includes("\\`"), "a quoted name never carries a backslash");
});

test("a hostile workflow name is quoted in the body and flattened in the title", async () => {
  const run = workflowRun({ name: "Build **bold**\n[link](http://x) @org" });
  const { github, context, calls } = harness({ run });
  await reconcileCiFailureIssue({ github, context });

  const created = calls.create[0];
  assert.equal(
    created.title,
    "CI: Build **bold** [link](http://x) @org is failing (main; push)",
  );
  assert.ok(!created.title.includes("\n"), "a newline never reaches the title");
  assert.ok(
    created.body.includes(
      "The `Build **bold** [link](http://x) @org` workflow failed for",
    ),
    "the workflow name is quoted as code in the body",
  );
  assert.equal(created.body.trimEnd().split("\n").at(-1), managedMarker());
});

test("an over-long name is capped", () => {
  const rendered = renderField("n".repeat(500));

  assert.equal(rendered.length, 201);
  assert.ok(rendered.endsWith("…"));
});

test("a blank name falls back rather than rendering empty", () => {
  assert.equal(renderField("   ", "unnamed job"), "unnamed job");
  assert.equal(renderField(undefined, "unnamed job"), "unnamed job");
});

test("a non-https job URL is not linked", async () => {
  const job = failedJob({ html_url: "javascript:alert(1)" });
  const { github, context, calls } = harness({ jobs: [job] });
  await reconcileCiFailureIssue({ github, context });

  assert.doesNotMatch(calls.create[0].body, /\(\[job log\]\(/);
  assert.doesNotMatch(calls.create[0].body, /javascript:/);
});

test("evidence comes from the reconciled attempt, not the newest one", async () => {
  const staleAttempt = workflowRun({ id: 4_242, run_attempt: 1 });
  const { github, context, calls } = harness({
    run: staleAttempt,
    latestRuns: [staleAttempt],
    jobs: [
      failedJob({ id: 700_002, name: "attempt 2 job", run_attempt: 2 }),
      failedJob({ id: 700_001, name: "attempt 1 job", run_attempt: 1 }),
    ],
  });
  const result = await reconcileCiFailureIssue({ github, context });

  assert.deepEqual(result, { action: "opened", issueNumber: 91 });
  assert.match(calls.create[0].body, /attempt 1 job/);
  assert.doesNotMatch(calls.create[0].body, /attempt 2 job/);
});

test("a job list without attempt numbers is still reported", async () => {
  const job = failedJob();
  delete job.run_attempt;
  const { github, context, calls } = harness({
    run: workflowRun({ run_attempt: 3 }),
    jobs: [job],
  });
  await reconcileCiFailureIssue({ github, context });

  assert.match(calls.create[0].body, /osv-scan/);
});

test("only the first ten failed jobs are listed and the rest are counted", async () => {
  const jobs = Array.from({ length: 13 }, (_, index) =>
    failedJob({ id: 910_000 + index, name: `failed job ${index}` }),
  );
  const { github, context, calls } = harness({ jobs });
  await reconcileCiFailureIssue({ github, context });

  const body = calls.create[0].body;
  assert.match(body, /_3 further failed jobs are not listed here\._/);
  assert.match(body, /failed job 9/);
  assert.doesNotMatch(body, /failed job 10/);
});

test("a failed job list degrades to a note instead of failing", async () => {
  const { github, context, calls } = harness({
    listJobsError: Object.assign(new Error("Server Error"), { status: 500 }),
  });
  const result = await reconcileCiFailureIssue({ github, context });

  assert.deepEqual(result, { action: "opened", issueNumber: 91 });
  assert.match(calls.create[0].body, /_job list unavailable: HTTP 500_/);
  assert.match(calls.create[0].body, /managed-ci-failure:77:push:main/);
});

test("a degradation reason is scanned in full before it is shortened", async () => {
  const value = "AKIAIOSFODNN7EXAMPLE";
  const message = `${value} ${"filler ".repeat(40)} authorization refused`;
  assert.ok(
    message.indexOf("authorization") > 200,
    "the keyword must be past the truncation point",
  );

  const { github, context, calls } = harness({
    listJobsError: new Error(message),
  });
  await reconcileCiFailureIssue({ github, context });

  assert.match(calls.create[0].body, /_job list unavailable: redacted error_/);
  assert.ok(!calls.create[0].body.includes(value));
});

test("a stalled job listing is aborted and degrades to a note", async () => {
  const { github, calls } = harness({ listJobsStalls: true });
  const startedAt = Date.now();
  const evidence = await collectFailureEvidence(
    github,
    { owner: "mento-protocol", repo: "frontend-monorepo" },
    workflowRun(),
    undefined,
    { listDeadlineMs: 60 },
  );
  const elapsed = Date.now() - startedAt;

  assert.ok(
    calls.listSignal instanceof AbortSignal,
    "the job listing must carry an abort signal",
  );
  assert.deepEqual(evidence.jobs, []);
  assert.match(evidence.note, /^job list unavailable: /);
  assert.ok(elapsed < 5_000, `the stalled listing held on for ${elapsed}ms`);

  const body = failureBody(workflowRun(), "main", managedMarker(), evidence);
  assert.match(body, /^## What failed$/m);
  assert.equal(body.trimEnd().split("\n").at(-1), managedMarker());
});

test("a run with no failed job still produces a stable body", async () => {
  const { github, context, calls } = harness({
    jobs: [{ id: 1, name: "passing job", conclusion: "success" }],
  });
  const result = await reconcileCiFailureIssue({ github, context });

  assert.deepEqual(result, { action: "opened", issueNumber: 91 });
  assert.match(calls.create[0].body, /^## What failed$/m);
  assert.match(
    calls.create[0].body,
    /_No failed job was reported for this run/,
  );
  assert.match(calls.create[0].body, /managed-ci-failure:77:push:main/);
});

test("the evidence collector skips a run that exposes no id", async () => {
  const { github } = harness();
  const evidence = await collectFailureEvidence(
    github,
    { owner: "mento-protocol", repo: "frontend-monorepo" },
    { conclusion: "failure" },
  );

  assert.deepEqual(evidence, {
    jobs: [],
    note: "the failed run exposed no job list",
  });
});

test("the assembled body drops rows before exceeding the size limit", () => {
  const evidence = {
    jobs: Array.from({ length: 400 }, (_, index) => ({
      name: `failed job ${index} ${"n".repeat(190)}`,
      url: "https://github.com/mento-protocol/frontend-monorepo/actions/runs/1",
      failedSteps: Array.from(
        { length: 10 },
        (_, step) => `step ${step} ${"s".repeat(180)}`,
      ),
    })),
  };
  const body = failureBody(workflowRun(), "main", managedMarker(), evidence);

  assert.ok(
    new TextEncoder().encode(body).length <= 60 * 1024,
    "the body must stay under the issue size limit",
  );
  assert.match(
    body,
    /_\d+ further failed jobs were dropped to keep this issue under GitHub's size limit\._/,
  );
  assert.equal(body.trimEnd().split("\n").at(-1), managedMarker());
});

test("the marker only routes when it sits on its own line outside a fence", () => {
  const marker = managedMarker();

  assert.ok(bodyCarriesMarker(`text\n${marker}\nmore`, marker));
  assert.ok(
    !bodyCarriesMarker(`text\n   ${marker}   \n`, marker),
    "an indented, padded copy is a quotation, not the sentinel",
  );
  assert.ok(
    !bodyCarriesMarker(`a quoted ${marker} inside a sentence`, marker),
    "a substring must never route an issue",
  );
  assert.ok(
    !bodyCarriesMarker(["```text", marker, "```"].join("\n"), marker),
    "a fenced block must never route an issue",
  );
  assert.ok(
    !bodyCarriesMarker(["~~~", marker, "~~~"].join("\n"), marker),
    "a tilde fence must never route an issue",
  );
  assert.ok(!bodyCarriesMarker(undefined, marker));
});

test("a fence closes only on its own delimiter", () => {
  const marker = managedMarker();

  assert.ok(
    !bodyCarriesMarker(["```", "~~~", marker, "```"].join("\n"), marker),
    "a tilde line must not close a backtick fence",
  );
  assert.ok(
    !bodyCarriesMarker(["~~~", "```", marker, "~~~"].join("\n"), marker),
    "a backtick line must not close a tilde fence",
  );
  assert.ok(
    !bodyCarriesMarker(["````", "```", marker, "````"].join("\n"), marker),
    "a three-backtick line must not close a four-backtick fence",
  );
  assert.ok(
    !bodyCarriesMarker(["`````", "```", marker, "`````"].join("\n"), marker),
    "a shorter line must not close a longer fence",
  );
  assert.ok(
    !bodyCarriesMarker(
      ["```", "``` trailing", marker, "```"].join("\n"),
      marker,
    ),
    "a delimiter carrying trailing text does not close a fence",
  );
  assert.ok(
    !bodyCarriesMarker(["```", marker].join("\n"), marker),
    "an unclosed fence holds to the end of the body",
  );
  assert.ok(
    bodyCarriesMarker(["```", "```", marker].join("\n"), marker),
    "an equal-length fence closes",
  );
  assert.ok(
    bodyCarriesMarker(["```", "`````", marker].join("\n"), marker),
    "a longer closing fence closes",
  );
  assert.ok(
    bodyCarriesMarker(["~~~", "~~~", marker].join("\n"), marker),
    "a tilde fence closes on a tilde line",
  );
  assert.ok(
    bodyCarriesMarker(["   ```", "   ```", marker].join("\n"), marker),
    "three spaces of indentation still fences",
  );
  assert.ok(
    !bodyCarriesMarker(
      ["- quoted", "", "    ```", `    ${marker}`, "    ```"].join("\n"),
      marker,
    ),
    // No longer a fence at all: a four-space line is indented code, so nothing
    // opens. The marker is still refused, by the exact-line rule and by the
    // raw-HTML rule, which is why this case is unaffected by the opener change.
    "an indented marker in a list item is refused without any fence",
  );
  assert.ok(
    !bodyCarriesMarker(["```", "```\u00a0", marker, "```"].join("\n"), marker),
    "a non-breaking space after a delimiter does not close a fence",
  );
  assert.ok(
    !bodyCarriesMarker(["```", "```\u2003", marker, "```"].join("\n"), marker),
    "an em space after a delimiter does not close a fence",
  );
  assert.ok(
    bodyCarriesMarker(["```", "```\t ", marker].join("\n"), marker),
    "a tab and a space after a delimiter still close a fence",
  );
});

test("only an exact root-level line carries the marker", () => {
  const marker = managedMarker();

  assert.ok(bodyCarriesMarker(`text\n${marker}\nmore`, marker));
  assert.ok(
    bodyCarriesMarker(`text\n${marker}\r`, marker),
    "a trailing carriage return is tolerated",
  );
  assert.ok(
    !bodyCarriesMarker(`text\n ${marker}\n`, marker),
    "one leading space makes it a quotation",
  );
  assert.ok(
    !bodyCarriesMarker(`text\n\u00a0${marker}\n`, marker),
    "a leading non-breaking space makes it a quotation",
  );
  assert.ok(
    !bodyCarriesMarker(`text\n${marker} \n`, marker),
    "one trailing space makes it a quotation",
  );
  assert.ok(
    !bodyCarriesMarker(`text\n\t${marker}\n`, marker),
    "a leading tab makes it a quotation",
  );
  assert.ok(
    !bodyCarriesMarker(["- quoted", "", `  ${marker}`].join("\n"), marker),
    "a list-item continuation must not route",
  );
  assert.ok(
    !bodyCarriesMarker(["- quoted", "", `    ${marker}`].join("\n"), marker),
    "a four-space indented code block must not route",
  );
});

test("an indented closing delimiter does not close a fence", () => {
  const marker = managedMarker();

  assert.ok(
    !bodyCarriesMarker(["```", "    ```", marker, "```"].join("\n"), marker),
    "four spaces before a closer leaves the block open",
  );
  assert.ok(
    !bodyCarriesMarker(["```", "\t```", marker, "```"].join("\n"), marker),
    "a tab before a closer leaves the block open",
  );
  assert.ok(
    !bodyCarriesMarker(["```", "\u00a0```", marker, "```"].join("\n"), marker),
    "a non-breaking space before a closer leaves the block open",
  );
  assert.ok(
    bodyCarriesMarker(["```", "   ```", marker].join("\n"), marker),
    "three spaces before a closer still closes",
  );
  assert.ok(
    !bodyCarriesMarker(["    ```", "```", marker, "```"].join("\n"), marker),
    "a four-space delimiter is indented code, so the bare line below it opens",
  );
  assert.ok(
    !bodyCarriesMarker(["\t```", "```", marker, "```"].join("\n"), marker),
    "a tab-indented delimiter is indented code, not an opener",
  );
  assert.ok(
    !bodyCarriesMarker(["\u00a0```", "```", marker, "```"].join("\n"), marker),
    "a delimiter behind a non-breaking space is not an opener",
  );
  assert.ok(
    !bodyCarriesMarker(["    ~~~", "~~~", marker, "~~~"].join("\n"), marker),
    "the tilde form inverts the same way",
  );
  assert.ok(
    !bodyCarriesMarker([" ```", marker, " ```"].join("\n"), marker),
    "one space still opens, so the marker below stays fenced",
  );
  assert.ok(
    !bodyCarriesMarker(["   ```", marker, "   ```"].join("\n"), marker),
    "three spaces still open, so the marker below stays fenced",
  );
});

test("a raw HTML line fails the whole body closed", () => {
  const marker = managedMarker();

  assert.ok(
    !bodyCarriesMarker(["<pre>", marker, "</pre>"].join("\n"), marker),
    "a marker inside <pre> must not route",
  );
  assert.ok(
    !bodyCarriesMarker(["<div>", marker, "</div>"].join("\n"), marker),
    "a marker inside <div> must not route",
  );
  assert.ok(
    !bodyCarriesMarker(["<table>", marker, "</table>"].join("\n"), marker),
    "a marker inside <table> must not route",
  );
  assert.ok(
    !bodyCarriesMarker(["<!-- open", marker, "-->"].join("\n"), marker),
    "a marker inside a comment that spans lines must not route",
  );
  assert.ok(
    !bodyCarriesMarker([marker, "", "  <span>x</span>"].join("\n"), marker),
    "an HTML line after the marker still fails the body closed",
  );
  assert.ok(
    bodyCarriesMarker(["text", marker, "more"].join("\n"), marker),
    "a body whose only < line is the marker still routes",
  );
});

test("a quoted marker in a human issue does not hijack reconciliation", async () => {
  const impostor = {
    number: 77,
    state: "open",
    body: ["Look at this:", "```text", managedMarker(), "```"].join("\n"),
    user: { login: "github-actions[bot]" },
  };
  const { github, context, calls } = harness({ issues: [impostor] });
  const result = await reconcileCiFailureIssue({ github, context });

  assert.deepEqual(result, { action: "opened", issueNumber: 91 });
  assert.equal(calls.update.length, 0);
});

test("a tilde line inside a backtick fence does not expose a quoted marker", async () => {
  const impostor = {
    number: 77,
    state: "open",
    body: ["Look at this:", "```", "~~~", managedMarker(), "```"].join("\n"),
    user: { login: "github-actions[bot]" },
  };
  const { github, context, calls } = harness({ issues: [impostor] });
  const result = await reconcileCiFailureIssue({ github, context });

  assert.deepEqual(result, { action: "opened", issueNumber: 91 });
  assert.equal(calls.update.length, 0);
});

test("an indented fence in a list item does not expose a quoted marker", async () => {
  const impostor = {
    number: 77,
    state: "open",
    body: ["- quoted", "", "    ```", `    ${managedMarker()}`, "    ```"].join(
      "\n",
    ),
    user: { login: "github-actions[bot]" },
  };
  const { github, context, calls } = harness({ issues: [impostor] });
  const result = await reconcileCiFailureIssue({ github, context });

  assert.deepEqual(result, { action: "opened", issueNumber: 91 });
  assert.equal(calls.update.length, 0);
});

test("an indented marker in a list item does not route", async () => {
  const impostor = {
    number: 77,
    state: "open",
    body: ["- quoted", "", `  ${managedMarker()}`].join("\n"),
    user: { login: "github-actions[bot]" },
  };
  const { github, context, calls } = harness({ issues: [impostor] });
  const result = await reconcileCiFailureIssue({ github, context });

  assert.deepEqual(result, { action: "opened", issueNumber: 91 });
  assert.equal(calls.update.length, 0);
});

test("a non-breaking space cannot close a fence holding a marker", async () => {
  const impostor = {
    number: 77,
    state: "open",
    body: ["```", "```\u00a0", managedMarker(), "```"].join("\n"),
    user: { login: "github-actions[bot]" },
  };
  const { github, context, calls } = harness({ issues: [impostor] });
  const result = await reconcileCiFailureIssue({ github, context });

  assert.deepEqual(result, { action: "opened", issueNumber: 91 });
  assert.equal(calls.update.length, 0);
});

test("a marker inside a raw HTML block does not route", async () => {
  const impostor = {
    number: 77,
    state: "open",
    body: ["<pre>", managedMarker(), "</pre>"].join("\n"),
    user: { login: "github-actions[bot]" },
  };
  const { github, context, calls } = harness({ issues: [impostor] });
  const result = await reconcileCiFailureIssue({ github, context });

  assert.deepEqual(result, { action: "opened", issueNumber: 91 });
  assert.equal(calls.update.length, 0);
});

test("a marker under an indented closing delimiter does not route", async () => {
  const impostor = {
    number: 77,
    state: "open",
    body: ["```", "    ```", managedMarker(), "```"].join("\n"),
    user: { login: "github-actions[bot]" },
  };
  const { github, context, calls } = harness({ issues: [impostor] });
  const result = await reconcileCiFailureIssue({ github, context });

  assert.deepEqual(result, { action: "opened", issueNumber: 91 });
  assert.equal(calls.update.length, 0);
});

test("a decoy indented marker fails the body closed", async () => {
  const impostor = managedIssue({
    body: ["failure", "", managedMarker(), "", `  ${managedMarker()}`].join(
      "\n",
    ),
  });
  const { github, context, calls } = harness({ issues: [impostor] });
  const result = await reconcileCiFailureIssue({ github, context });

  assert.deepEqual(result, { action: "opened", issueNumber: 91 });
  assert.equal(calls.update.length, 0);
});

test("recovery cuts at the routed marker, not a later copy", async () => {
  const run = workflowRun({ conclusion: "success", run_number: 13 });
  const existing = managedIssue({
    body: [
      "failure",
      "",
      managedMarker(),
      "",
      "stale tail",
      "",
      managedMarker(),
    ].join("\n"),
  });
  const { github, context, calls } = harness({ run, issues: [existing] });
  const result = await reconcileCiFailureIssue({ github, context });

  assert.deepEqual(result, { action: "closed", issueNumber: 42 });
  const body = calls.update[0].body;
  assert.ok(
    !body.includes("stale tail"),
    "everything after the routed marker is replaced",
  );
  assert.equal(
    body.split("\n").filter((line) => line === managedMarker()).length,
    1,
    "exactly one marker line survives",
  );
  assert.equal(body.trimEnd().split("\n").at(-1), managedMarker());
  assert.match(body, /## Recovery/);
});

test("a generated failure body routes back to itself", async () => {
  const job = failedJob({
    name: `<script>evil</script> ${managedMarker()}`,
    steps: [{ name: "<div> ``` step", conclusion: "failure" }],
  });
  const { github, context, calls } = harness({ jobs: [job] });
  await reconcileCiFailureIssue({ github, context });

  const body = calls.create[0].body;
  assert.ok(
    bodyCarriesMarker(body, managedMarker()),
    "a generated body must route back to itself",
  );
  assert.deepEqual(
    body
      .split("\n")
      .filter((line) => line !== managedMarker() && /^\s*</.test(line)),
    [],
    "no generated line opens with <",
  );
  assert.deepEqual(
    body.split("\n").filter((line) => /^\s*(`{3,}|~{3,})/.test(line)),
    [],
    "no generated line opens a fence",
  );
});

test("a recovery body with a fence-like workflow name still routes", async () => {
  const run = workflowRun({
    conclusion: "success",
    run_number: 13,
    name: "``` odd",
  });
  const { github, context, calls } = harness({
    run,
    issues: [managedIssue()],
  });
  const result = await reconcileCiFailureIssue({ github, context });

  assert.deepEqual(result, { action: "closed", issueNumber: 42 });
  const body = calls.update[0].body;
  assert.ok(
    bodyCarriesMarker(body, managedMarker()),
    "the recovery line must not open a fence above the marker",
  );
});

test("recovery keeps the marker on the last line", async () => {
  const run = workflowRun({ conclusion: "success", run_number: 13 });
  const existing = managedIssue({
    body: ["failure", "", "## What failed", "", managedMarker()].join("\n"),
  });
  const { github, context, calls } = harness({ run, issues: [existing] });
  const result = await reconcileCiFailureIssue({ github, context });

  assert.deepEqual(result, { action: "closed", issueNumber: 42 });
  const body = calls.update[0].body;
  assert.match(body, /## Recovery/);
  assert.equal(body.trimEnd().split("\n").at(-1), managedMarker());
  assert.equal(
    body.split("\n").filter((line) => line.trim() === managedMarker()).length,
    1,
  );
  assert.ok(bodyCarriesMarker(body, managedMarker()));
});

test("a legacy body with the marker above a recovery note still routes", async () => {
  // Issues closed by the previous format carry the marker mid-body.
  const legacy = managedIssue({
    state: "closed",
    body: [
      "old failure",
      "",
      managedMarker(),
      "",
      "## Recovery",
      "",
      "ok",
    ].join("\n"),
  });
  const { github, context, calls } = harness({ issues: [legacy] });
  const result = await reconcileCiFailureIssue({ github, context });

  assert.deepEqual(result, { action: "updated", issueNumber: 42 });
  assert.equal(calls.update[0].state, "open");
});

// --- Structured OSV findings ------------------------------------------------
//
// The findings table is the one place the issue names something a scan found,
// and it exists precisely so nobody has to reach for the job log again. These
// tests hold the line on where it comes from and what it can render.

const OSV_FINDINGS_FILES = [
  "application.json",
  "pnpm-runtime.json",
  "vercel-cli-runtime.json",
  "pnpm-bootstrap.json",
];

function supplyChainRun(overrides = {}) {
  return workflowRun({
    name: "Supply Chain",
    path: ".github/workflows/supply-chain.yml",
    event: "schedule",
    ...overrides,
  });
}

/** One scan document naming `packages`; the rest of the artifact scans clean. */
async function withFindingsArtifact(packages, run) {
  const directory = mkdtempSync(join(tmpdir(), "notifier-findings-"));
  try {
    for (const file of OSV_FINDINGS_FILES) {
      writeFileSync(join(directory, file), '{"results":[]}\n');
    }
    writeFileSync(
      join(directory, "application.json"),
      JSON.stringify({ results: [{ packages }] }),
    );
    // Awaited, so the directory outlives the callback it was made for.
    return await run(directory);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

function vulnerablePackage({
  name = "left-pad",
  version = "1.0.0",
  id = "GHSA-aaaa-bbbb-cccc",
  summary = "Prototype pollution in left-pad",
  fixed = "1.0.1",
} = {}) {
  return {
    package: { name, version, ecosystem: "npm" },
    vulnerabilities: [
      {
        id,
        summary,
        affected: [
          {
            package: { name, ecosystem: "npm" },
            ranges: [{ events: [{ introduced: "0" }, { fixed }] }],
          },
        ],
      },
    ],
  };
}

/**
 * Split one rendered table row into cells the way GFM does: on pipes that are
 * not escaped by a preceding backslash. A field that broke out of its cell
 * shows up here as an extra column.
 */
function tableCells(row) {
  return row
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split(/(?<!\\)\|/);
}

test("the managed issue names the vulnerable package from the findings artifact", async () => {
  const run = supplyChainRun();
  await withFindingsArtifact([vulnerablePackage()], async (directory) => {
    const { github, context, calls } = harness({ run, jobs: [failedJob()] });
    const result = await reconcileCiFailureIssue({
      github,
      context,
      env: {
        OSV_FINDINGS_DIR: directory,
        OSV_FINDINGS_RUN_ID: String(run.id),
      },
    });

    assert.deepEqual(result, { action: "opened", issueNumber: 91 });
    const body = calls.create[0].body;
    assert.match(body, /^## Findings$/m);
    assert.match(
      body,
      /^\| Advisory \| Package \| Installed \| Fixed in \| Lockfile \| Summary \|$/m,
    );
    const row = body
      .split("\n")
      .find((line) => line.includes("GHSA-aaaa-bbbb-cccc"));
    assert.deepEqual(tableCells(row), [
      " `GHSA-aaaa-bbbb-cccc` ",
      " `left-pad` ",
      " `1.0.0` ",
      " `1.0.1` ",
      " `pnpm-lock.yaml` ",
      " `Prototype pollution in left-pad` ",
    ]);
    // The section is additive: the job and step list is still the primary
    // evidence, and the marker still ends the body.
    assert.match(body, /^## What failed$/m);
    assert.equal(
      body.trimEnd().split("\n").at(-1),
      `<!-- managed-ci-failure:77:schedule:main -->`,
    );
  });
});

test("no findings section is rendered for a workflow that uploads no artifact", async () => {
  const { github, context, calls } = harness({ jobs: [failedJob()] });
  const result = await reconcileCiFailureIssue({
    github,
    context,
    env: { OSV_FINDINGS_RUN_ID: "1012" },
  });

  assert.equal(result.action, "opened");
  assert.doesNotMatch(calls.create[0].body, /## Findings/);
  assert.doesNotMatch(calls.create[0].body, /findings table/);
});

test("an unavailable findings artifact degrades to a note, never to log text", async () => {
  const run = supplyChainRun();
  const directory = mkdtempSync(join(tmpdir(), "notifier-findings-empty-"));
  try {
    const { github, context, calls } = harness({ run, jobs: [failedJob()] });
    const result = await reconcileCiFailureIssue({
      github,
      context,
      env: {
        OSV_FINDINGS_DIR: directory,
        OSV_FINDINGS_RUN_ID: String(run.id),
      },
    });

    assert.equal(result.action, "opened");
    const body = calls.create[0].body;
    assert.match(body, /^## Findings$/m);
    assert.match(body, /findings artifact was unavailable/i);
    // The degradation must never become a reason to quote a log.
    assert.doesNotMatch(body, /##\[error\]/);
    assert.match(body, /never quotes job log output/);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("findings downloaded for another run are refused rather than reattributed", async () => {
  // Reconciliation can settle on a later decisive run than the callback run
  // the download step addressed. Rendering one run's advisories under the
  // other's failure would attribute them to a scan that never reported them.
  const run = supplyChainRun();
  await withFindingsArtifact([vulnerablePackage()], async (directory) => {
    const { github, context, calls } = harness({ run, jobs: [failedJob()] });
    const result = await reconcileCiFailureIssue({
      github,
      context,
      env: {
        OSV_FINDINGS_DIR: directory,
        OSV_FINDINGS_RUN_ID: String(run.id + 1),
      },
    });

    assert.equal(result.action, "opened");
    const body = calls.create[0].body;
    assert.match(body, /belongs to a different run/);
    assert.doesNotMatch(body, /GHSA-aaaa-bbbb-cccc/);
    assert.doesNotMatch(body, /left-pad/);
  });
});

test("a pipe in a scanner field cannot break out of its table cell", async () => {
  const run = supplyChainRun();
  await withFindingsArtifact(
    [
      vulnerablePackage({
        summary: "pipe | inside | the summary",
        name: "pipe|package",
      }),
    ],
    async (directory) => {
      const { github, context, calls } = harness({ run, jobs: [failedJob()] });
      await reconcileCiFailureIssue({
        github,
        context,
        env: {
          OSV_FINDINGS_DIR: directory,
          OSV_FINDINGS_RUN_ID: String(run.id),
        },
      });

      const row = calls.create[0].body
        .split("\n")
        .find((line) => line.includes("GHSA-aaaa-bbbb-cccc"));
      // Six columns, still, however many pipes the scanner supplied.
      assert.equal(tableCells(row).length, 6);
      assert.match(row, /pipe\\\|package/);
    },
  );
});

test("a scanner field cannot forge the managed marker or escape its code span", async () => {
  const run = supplyChainRun();
  const marker = "<!-- managed-ci-failure:77:schedule:main -->";
  await withFindingsArtifact(
    [
      vulnerablePackage({
        // A newline plus a copy of the marker: the routing rule is "the marker
        // sits on its own line", so a field that could carry a newline could
        // route a later failure into an issue of its choosing.
        summary: `harmless\n${marker}\n\`\`\`\nand a fence`,
        name: "back`tick",
      }),
    ],
    async (directory) => {
      const { github, context, calls } = harness({ run, jobs: [failedJob()] });
      await reconcileCiFailureIssue({
        github,
        context,
        env: {
          OSV_FINDINGS_DIR: directory,
          OSV_FINDINGS_RUN_ID: String(run.id),
        },
      });

      const body = calls.create[0].body;
      // Exactly one root-level marker line: the notifier's own, last.
      const markerLines = body
        .split("\n")
        .filter((line) => line === marker).length;
      assert.equal(markerLines, 1);
      assert.equal(body.trimEnd().split("\n").at(-1), marker);
      // And the marker the parser routes on is still this issue's own.
      assert.equal(bodyCarriesMarker(body, marker), true);
      // The forged copy survives as flattened text inside the row.
      const row = body
        .split("\n")
        .find((line) => line.includes("GHSA-aaaa-bbbb-cccc"));
      assert.equal(tableCells(row).length, 6);
      assert.match(row, /harmless/);
      // A backtick-bearing package name still renders inside a longer span.
      assert.match(row, /``back`tick``/);
    },
  );
});

test("each degradation note is rendered whole on its own line", () => {
  // Notes are rendered one per line rather than joined into one field. Each
  // rendered field is capped at 200 characters, so a joined run of notes would
  // silently lose the last one — the real notes already come to 197 together.
  const notes = [
    "No findings artifact was uploaded for 1 of 4 scanned lockfiles.",
    "2 findings files were unreadable or not a valid scan result.",
    "7 scanner entries were dropped for failing the expected findings schema.",
  ];

  const body = failureBody(
    supplyChainRun(),
    "main",
    "<!-- managed-ci-failure:77:schedule:main -->",
    { jobs: [] },
    { findings: [], omitted: 0, notes },
  );
  const lines = body.split("\n");

  for (const note of notes) {
    assert.ok(
      lines.includes(`_${note}_`),
      `${note} must be its own italic line`,
    );
  }
  // Nothing was truncated: the cap's ellipsis never appears.
  assert.doesNotMatch(body, /…/);

  // And a single note past the cap is the one that gets shortened, on its own,
  // rather than taking the notes after it down with it.
  const longBody = failureBody(
    supplyChainRun(),
    "main",
    "<!-- managed-ci-failure:77:schedule:main -->",
    { jobs: [] },
    {
      findings: [],
      omitted: 0,
      notes: ["z".repeat(400), "the note after the long one"],
    },
  );
  assert.match(longBody, /…_$/m);
  assert.ok(longBody.split("\n").includes("_the note after the long one_"));
});

test("findings are dropped before failed jobs when the body hits the size cap", () => {
  const run = supplyChainRun();
  const jobs = Array.from({ length: 10 }, (_unused, index) => ({
    name: `job ${index}`,
    url: undefined,
    failedSteps: ["a step"],
    omittedSteps: 0,
  }));
  const findings = Array.from({ length: 25 }, (_unused, index) => ({
    lockfile: "pnpm-lock.yaml",
    id: `GHSA-${String(index).padStart(4, "0")}-bbbb-cccc`,
    packageName: "x".repeat(200),
    version: "1.0.0",
    fixedVersion: "1.0.1",
    summary: "y".repeat(200),
  }));
  const body = failureBody(
    run,
    "main",
    "<!-- managed-ci-failure:77:schedule:main -->",
    { jobs },
    { findings, omitted: 0 },
  );

  assert.ok(Buffer.byteLength(body, "utf8") <= 60 * 1024);
  // Every failed job survived; the supplementary findings gave way first.
  for (const job of jobs) {
    assert.ok(body.includes(job.name), `${job.name} must survive`);
  }
});

test("the findings collector is the only new evidence source", () => {
  // The notifier still reads no log on any code path, and it delegates findings
  // to exactly one audited module rather than to an arbitrary one.
  const source = readFileSync(
    new URL("./ci-failure-issue.mjs", import.meta.url),
    "utf8",
  );
  const imports = [...source.matchAll(/^import .* from "(.+)";$/gm)]
    .map((match) => match[1])
    .filter((specifier) => !specifier.startsWith("node:"));

  assert.deepEqual(imports, ["./osv-findings.mjs"]);
});
