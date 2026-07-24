import assert from "node:assert/strict";
import { test } from "node:test";

import { reconcileCiFailureIssue } from "./ci-failure-issue.mjs";

function managedMarker(event = "push", targetRef = "main") {
  return `<!-- managed-ci-failure:77:${event}:${encodeURIComponent(targetRef)} -->`;
}

function workflowRun(overrides = {}) {
  const runNumber = overrides.run_number ?? 12;
  return {
    id: 1_000 + runNumber,
    workflow_id: 77,
    name: "Quality Budgets",
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

function harness({
  run = workflowRun(),
  issues = [],
  latestRuns,
  runPages,
} = {}) {
  const calls = { create: [], update: [], listRuns: 0, listIssues: 0 };
  function listWorkflowRuns() {}
  function listForRepo() {}
  const paginate = async (method, parameters) => {
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

test("ignores pull-request, feature push/dispatch, and cancelled runs", async () => {
  for (const run of [
    workflowRun({ event: "pull_request" }),
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
