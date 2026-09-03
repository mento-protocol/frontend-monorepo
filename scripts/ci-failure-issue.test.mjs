import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
  assert.ok(!body.includes("**bold**"));
  assert.match(body, /\\`backtick\\`/);
  assert.match(body, /\\\[link\\\]/);
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
  assert.ok(bodyCarriesMarker(`text\n   ${marker}   \n`, marker));
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
