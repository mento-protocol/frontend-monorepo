import assert from "node:assert/strict";
import { test } from "node:test";

import {
  capExcerpt,
  collectFailureEvidence,
  extractErrorContext,
  extractOsvFindings,
  failureBody,
  reconcileCiFailureIssue,
  sanitizeLogLines,
} from "./ci-failure-issue.mjs";

const ESC = "\x1B";

/** One runner log line: ISO timestamp, a space, then the raw text. */
function logLine(text, seconds = 42) {
  return `2026-09-01T19:55:${String(seconds).padStart(2, "0")}.4230490Z ${text}`;
}

/**
 * A trimmed copy of a real `osv-scanner / osv-scan` job log, including the
 * `docker run` line whose `ACTIONS_RUNTIME_TOKEN` the secret guard must drop.
 */
const OSV_JOB_LOG = [
  logLine("##[group]Run google/osv-scanner-action/osv-reporter-action@v2.5.1"),
  logLine(`${ESC}[36;1m--fail-on-vuln=true${ESC}[0m`),
  logLine("##[endgroup]"),
  logLine(
    '##[command]/usr/bin/docker run --name osv --rm -e "ACTIONS_RUNTIME_TOKEN" -e "ACTIONS_CACHE_URL" ghcr.io/google/osv-scanner-action:v2.5.1',
  ),
  logLine("Warning: --output has been deprecated in favor of --output-files"),
  logLine(""),
  logLine(
    "Total 1 package affected by 1 known vulnerability (0 Critical, 1 High, 0 Medium, 0 Low, 0 Unknown) from 1 ecosystem.",
  ),
  logLine("1 vulnerability can be fixed."),
  logLine(""),
  logLine(
    "+-------------------------------------+------+-----------+---------+---------+---------------+--------------------------------------------+",
  ),
  logLine(
    "| OSV URL                             | CVSS | ECOSYSTEM | PACKAGE | VERSION | FIXED VERSION | SOURCE                                     |",
  ),
  logLine(
    "+-------------------------------------+------+-----------+---------+---------+---------------+--------------------------------------------+",
  ),
  logLine(
    "| https://osv.dev/GHSA-vx52-2968-3vc6 | 7.4  | npm       | pnpm    | 10.34.4 | 10.34.5       | scripts/vercel-pnpm-runtime/pnpm-lock.yaml |",
  ),
  logLine(
    "+-------------------------------------+------+-----------+---------+---------+---------------+--------------------------------------------+",
  ),
  logLine("Post job cleanup."),
  logLine("Cleaning up orphan processes"),
].join("\n");

/** A trimmed copy of a real `catalog version-skew` job log. */
const SKEW_JOB_LOG = [
  logLine("ok accepts TanStack catalog-backed override pairs"),
  logLine(""),
  logLine("49 passed, 0 failed"),
  logLine("##[group]Run node scripts/version-skew-check.mjs"),
  logLine(`${ESC}[36;1mnode scripts/version-skew-check.mjs${ESC}[0m`),
  logLine("##[endgroup]"),
  logLine(
    'error: package.json pnpm.overrides.@tanstack/react-query is "5.90.16" - conflicts with catalog "5.102.5"',
  ),
  logLine("##[error]Process completed with exit code 1."),
  logLine("Post job cleanup."),
].join("\n");

/** Sentinel payload for a download that never completes on its own. */
const NEVER_RESOLVES = Symbol("never-resolves");

function failedJob(overrides = {}) {
  return {
    id: 900_001,
    name: "osv-scanner (trusted pnpm runtime) / osv-scan",
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

function harness({
  run = workflowRun(),
  issues = [],
  latestRuns,
  runPages,
  jobs = [],
  jobLogs = {},
  listJobsError,
} = {}) {
  const calls = {
    create: [],
    update: [],
    listRuns: 0,
    listIssues: 0,
    listJobs: 0,
    logs: [],
    signals: [],
  };
  function listWorkflowRuns() {}
  function listForRepo() {}
  function listJobsForWorkflowRun() {}
  const paginate = async (method, parameters) => {
    if (method === listJobsForWorkflowRun) {
      calls.listJobs += 1;
      calls.jobsRunId = parameters.run_id;
      assert.equal(parameters.filter, "all");
      assert.equal(parameters.per_page, 100);
      if (listJobsError) throw listJobsError;
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
        downloadJobLogsForWorkflowRun: async (parameters) => {
          calls.logs.push(parameters.job_id);
          calls.signals.push(parameters.request?.signal);
          const payload = jobLogs[parameters.job_id];
          if (payload === undefined) {
            throw Object.assign(new Error("Not Found"), { status: 404 });
          }
          if (payload instanceof Error) throw payload;
          // A download that only ever ends when its caller aborts it.
          if (payload === NEVER_RESOLVES) {
            return new Promise((_resolve, reject) => {
              parameters.request.signal.addEventListener("abort", () =>
                reject(parameters.request.signal.reason),
              );
            });
          }
          return { data: payload };
        },
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

test("sanitizing strips runner timestamps and ANSI colouring", () => {
  const lines = sanitizeLogLines(
    [
      logLine(`${ESC}[36;1mnode scripts/version-skew-check.mjs${ESC}[0m`),
      logLine("##[endgroup]"),
      logLine("plain output"),
    ].join("\n"),
  );

  assert.deepEqual(lines, [
    "node scripts/version-skew-check.mjs",
    "plain output",
  ]);
  assert.ok(lines.every((line) => !line.includes(ESC)));
  assert.ok(lines.every((line) => !/^\d{4}-\d{2}-\d{2}T/.test(line)));
});

test("sanitizing redacts every line that could carry a credential", () => {
  const lines = sanitizeLogLines(
    [
      logLine("safe leading line"),
      logLine('docker run -e "ACTIONS_RUNTIME_TOKEN" -e "HOME" image'),
      logLine("Authorization: Bearer abcdef"),
      logLine("export GH_PASSWORD=hunter2"),
      logLine("ghp_0123456789abcdefghijklmnopqrstuvwxyz"),
      logLine("-----BEGIN OPENSSH PRIVATE KEY-----"),
      logLine("safe trailing line"),
    ].join("\n"),
  );

  assert.deepEqual(lines, [
    "safe leading line",
    "[redacted: line matched the secret guard]",
    "safe trailing line",
  ]);
  for (const forbidden of [
    "ACTIONS_RUNTIME_TOKEN",
    "hunter2",
    "ghp_",
    "BEGIN",
  ]) {
    assert.ok(
      !lines.join("\n").includes(forbidden),
      `${forbidden} must never reach the issue body`,
    );
  }
});

test("the credential guard runs before a long line is shortened", () => {
  // The keyword sits past the 500-character cap while a credential-shaped value
  // sits before it. Shortening first would drop the keyword and publish the
  // value, so the guard must see the whole stripped line.
  const credential = "AKIAIOSFODNN7EXAMPLE";
  const raw = `${credential} ${"filler ".repeat(120)} authorization=1`;
  assert.ok(
    raw.indexOf("authorization") > 500,
    "the keyword must be past the cap",
  );

  const lines = sanitizeLogLines(logLine(raw));

  assert.deepEqual(lines, ["[redacted: line matched the secret guard]"]);
  assert.ok(!lines.join("\n").includes(credential));
});

test("sanitizing caps a single runaway line", () => {
  const [line] = sanitizeLogLines(logLine("x".repeat(5_000)));

  assert.equal(line.length, 501);
  assert.ok(line.endsWith("…"));
});

test("the OSV findings table is extracted with its header and headline", () => {
  const findings = extractOsvFindings(sanitizeLogLines(OSV_JOB_LOG));

  assert.match(
    findings[0],
    /^Total 1 package affected by 1 known vulnerability/,
  );
  assert.ok(findings.some((line) => /\| OSV URL /.test(line)));
  assert.ok(
    findings.some((line) =>
      line.startsWith("| https://osv.dev/GHSA-vx52-2968-3vc6 |"),
    ),
  );
  assert.ok(findings.some((line) => line.includes("10.34.5")));
  assert.ok(
    findings.every((line) => !line.includes("Post job cleanup")),
    "unrelated log noise must stay out of the table excerpt",
  );
});

test("a log without OSV findings yields no findings table", () => {
  assert.deepEqual(extractOsvFindings(sanitizeLogLines(SKEW_JOB_LOG)), []);
  assert.deepEqual(
    extractOsvFindings(["+----+", "| NAME |", "+----+"]),
    [],
    "a table with no osv.dev row is not a findings table",
  );
});

test("error context keeps the lines leading up to each error annotation", () => {
  const excerpt = extractErrorContext(sanitizeLogLines(SKEW_JOB_LOG), {
    contextLines: 3,
  });

  assert.match(
    excerpt.at(-1),
    /##\[error\]Process completed with exit code 1\./,
  );
  assert.ok(
    excerpt.some((line) => line.includes("conflicts with catalog")),
    "the real error line must survive",
  );
  assert.ok(
    excerpt.every((line) => !line.includes("Post job cleanup")),
    "context stops at the annotation, not at the end of the log",
  );
});

test("error context falls back to the log tail without an annotation", () => {
  const lines = Array.from({ length: 30 }, (_, index) => `line ${index}`);

  assert.deepEqual(extractErrorContext(lines, { maxLines: 4 }), [
    "line 26",
    "line 27",
    "line 28",
    "line 29",
  ]);
});

test("error context elides the gap between separated annotations", () => {
  const lines = [
    "##[error]first",
    ...Array.from({ length: 20 }, (_, index) => `filler ${index}`),
    "##[error]second",
  ];
  const excerpt = extractErrorContext(lines, { contextLines: 1 });

  assert.deepEqual(excerpt, [
    "##[error]first",
    "[…]",
    "filler 19",
    "##[error]second",
  ]);
});

test("capping a head-kept excerpt marks the truncation at the end", () => {
  const capped = capExcerpt(
    Array.from({ length: 10 }, (_, index) => `row ${index}`),
    { keep: "head", maxLines: 3, maxBytes: 4_096 },
  );

  assert.deepEqual(capped, [
    "row 0",
    "row 1",
    "row 2",
    "[… 7 more log lines truncated]",
  ]);
});

test("capping a tail-kept excerpt marks the truncation at the start", () => {
  const capped = capExcerpt(
    Array.from({ length: 10 }, (_, index) => `row ${index}`),
    { keep: "tail", maxLines: 2, maxBytes: 4_096 },
  );

  assert.deepEqual(capped, [
    "[… 8 more log lines truncated]",
    "row 8",
    "row 9",
  ]);
});

test("capping enforces the byte budget as well as the line budget", () => {
  const capped = capExcerpt(
    Array.from({ length: 20 }, () => "y".repeat(50)),
    { keep: "head", maxLines: 20, maxBytes: 200 },
  );
  const payload = capped.slice(0, -1).join("\n");

  assert.ok(byteLengthOf(payload) <= 200 - 64, payload.length.toString());
  assert.match(capped.at(-1), /^\[… \d+ more log lines truncated\]$/);
});

function byteLengthOf(text) {
  return new TextEncoder().encode(text).length;
}

test("failed-job evidence carries the OSV findings table into the issue", async () => {
  const job = failedJob();
  const { github, context, calls } = harness({
    jobs: [job, { id: 900_002, name: "passing job", conclusion: "success" }],
    jobLogs: { [job.id]: OSV_JOB_LOG },
  });
  const result = await reconcileCiFailureIssue({ github, context });

  assert.deepEqual(result, { action: "opened", issueNumber: 91 });
  const body = calls.create[0].body;
  assert.equal(calls.listJobs, 1);
  assert.deepEqual(calls.logs, [job.id], "only failed jobs are fetched");
  assert.match(body, /^## What failed$/m);
  assert.match(
    body,
    /### \[osv-scanner \(trusted pnpm runtime\) \/ osv-scan\]/,
  );
  assert.match(body, /Failed step: `Fail on newly introduced vulnerabilities`/);
  assert.match(body, /\| https:\/\/osv\.dev\/GHSA-vx52-2968-3vc6 \| 7\.4 /);
  assert.ok(!body.includes("ACTIONS_RUNTIME_TOKEN"));
  assert.match(body, /managed-ci-failure:77:push:main/);
});

test("a non-OSV failure reports the lines around its error annotation", async () => {
  const job = failedJob({
    id: 900_003,
    name: "catalog version-skew",
    steps: [{ name: "catalog version-skew check", conclusion: "failure" }],
  });
  const { github, context, calls } = harness({
    jobs: [job],
    jobLogs: { [job.id]: SKEW_JOB_LOG },
  });
  await reconcileCiFailureIssue({ github, context });

  const body = calls.create[0].body;
  assert.match(body, /Failed step: `catalog version-skew check`/);
  assert.match(body, /conflicts with catalog "5\.102\.5"/);
  assert.match(body, /##\[error\]Process completed with exit code 1\./);
});

test("a structured job summary is preferred over downloading the log", async () => {
  const job = failedJob({
    output: { summary: "### Budget exceeded\napp.mento.org: 412 kB > 400 kB" },
  });
  const { github, context, calls } = harness({
    jobs: [job],
    jobLogs: { [job.id]: OSV_JOB_LOG },
  });
  await reconcileCiFailureIssue({ github, context });

  assert.deepEqual(
    calls.logs,
    [],
    "no log is downloaded when a summary exists",
  );
  assert.match(calls.create[0].body, /app\.mento\.org: 412 kB > 400 kB/);
});

test("a failed log download degrades to a note instead of failing", async () => {
  const job = failedJob();
  const { github, context, calls } = harness({ jobs: [job], jobLogs: {} });
  const result = await reconcileCiFailureIssue({ github, context });

  assert.deepEqual(result, { action: "opened", issueNumber: 91 });
  assert.match(calls.create[0].body, /_\(log excerpt unavailable: HTTP 404\)_/);
  assert.match(calls.create[0].body, /Failed step: `Fail on newly introduced/);
  assert.match(calls.create[0].body, /managed-ci-failure:77:push:main/);
});

test("an unreadable log payload degrades instead of failing", async () => {
  const job = failedJob();
  const { github, context, calls } = harness({
    jobs: [job],
    jobLogs: { [job.id]: { unexpected: "shape" } },
  });
  const result = await reconcileCiFailureIssue({ github, context });

  assert.equal(result.action, "opened");
  assert.match(calls.create[0].body, /log excerpt unavailable: the job log/);
});

test("a job log delivered as bytes is decoded", async () => {
  const job = failedJob();
  const { github, context, calls } = harness({
    jobs: [job],
    jobLogs: { [job.id]: new TextEncoder().encode(OSV_JOB_LOG) },
  });
  await reconcileCiFailureIssue({ github, context });

  assert.match(calls.create[0].body, /GHSA-vx52-2968-3vc6/);
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

test("a degradation reason that looks like a credential is withheld", async () => {
  const { github, context, calls } = harness({
    listJobsError: new Error("bad credentials for token ghp_abcdefghijklmnop"),
  });
  await reconcileCiFailureIssue({ github, context });

  assert.match(calls.create[0].body, /job list unavailable: redacted error/);
  assert.ok(!calls.create[0].body.includes("ghp_abcdefghijklmnop"));
});

test("a run with no failed job still produces a stable body", async () => {
  const { github, context, calls } = harness({
    jobs: [{ id: 1, name: "passing job", conclusion: "success" }],
  });
  const result = await reconcileCiFailureIssue({ github, context });

  assert.deepEqual(result, { action: "opened", issueNumber: 91 });
  assert.deepEqual(calls.logs, []);
  assert.match(calls.create[0].body, /^## What failed$/m);
  assert.match(
    calls.create[0].body,
    /_No failed job was reported for this run/,
  );
  assert.match(calls.create[0].body, /managed-ci-failure:77:push:main/);
});

test("only the first ten failed jobs are excerpted and the rest are counted", async () => {
  const jobs = Array.from({ length: 13 }, (_, index) =>
    failedJob({ id: 910_000 + index, name: `failed job ${index}` }),
  );
  const jobLogs = Object.fromEntries(
    jobs.map((job) => [job.id, SKEW_JOB_LOG.repeat(20)]),
  );
  const { github, context, calls } = harness({ jobs, jobLogs });
  await reconcileCiFailureIssue({ github, context });

  const body = calls.create[0].body;
  assert.equal(calls.logs.length, 10);
  assert.match(body, /_3 further failed jobs are not listed here\._/);
  assert.ok(
    byteLengthOf(body) <= 60 * 1024,
    `body must stay under the issue limit, got ${byteLengthOf(body)}`,
  );
  assert.match(body, /managed-ci-failure:77:push:main/);
});

test("the assembled body drops whole excerpts before exceeding the size limit", () => {
  const run = workflowRun();
  const evidence = {
    jobs: Array.from({ length: 40 }, (_, index) => ({
      name: `failed job ${index}`,
      failedStep: "run",
      source: "log",
      lines: Array.from({ length: 40 }, () => "z".repeat(100)),
    })),
  };
  const body = failureBody(run, "main", managedMarker(), evidence);

  assert.ok(
    byteLengthOf(body) <= 60 * 1024,
    `body must stay under the size limit, got ${byteLengthOf(body)}`,
  );
  assert.match(
    body,
    /_Excerpts for \d+ further failed jobs were dropped to keep this issue under GitHub's size limit\._/,
  );
  assert.match(body, /^## What failed$/m);
  assert.equal(body.trimEnd().split("\n").at(-1), managedMarker());
});

test("a log excerpt containing a code fence cannot break out of its block", () => {
  const body = failureBody(workflowRun(), "main", managedMarker(), {
    jobs: [
      {
        name: "markdown job",
        source: "log",
        lines: ["```", "pretend markdown", "```"],
      },
    ],
  });

  assert.match(body, /^````text$/m);
  assert.equal(body.trimEnd().split("\n").at(-1), managedMarker());
});

test("a stalled log download is aborted and degrades within the deadline", async () => {
  const job = failedJob();
  const { github, calls } = harness({
    jobs: [job],
    jobLogs: { [job.id]: NEVER_RESOLVES },
  });
  const startedAt = Date.now();
  const evidence = await collectFailureEvidence(
    github,
    { owner: "mento-protocol", repo: "frontend-monorepo" },
    workflowRun(),
    undefined,
    { deadlineMs: 60 },
  );
  const elapsed = Date.now() - startedAt;

  assert.equal(calls.logs.length, 1);
  assert.ok(
    calls.signals[0] instanceof AbortSignal,
    "the download must carry an abort signal",
  );
  assert.equal(evidence.jobs.length, 1);
  assert.match(evidence.jobs[0].note, /^log excerpt unavailable: /);
  assert.ok(
    elapsed < 5_000,
    `a stalled download must not hold the job, took ${elapsed}ms`,
  );

  // The degraded evidence still produces a complete, marker-keyed body.
  const body = failureBody(workflowRun(), "main", managedMarker(), evidence);
  assert.match(body, /_\(log excerpt unavailable: /);
  assert.equal(body.trimEnd().split("\n").at(-1), managedMarker());
});

test("only the tail of an oversized job log is decoded", async () => {
  const job = failedJob();
  // An OSV table at the head, past the 2 MiB cap, and an error annotation at
  // the tail. Decoding the whole log would let the head win and report the
  // findings table; the cap must leave only the tail's error context.
  const filler = `${"n".repeat(200)}\n`.repeat(20_000);
  const oversized = `${OSV_JOB_LOG}\n${filler}${SKEW_JOB_LOG}`;
  assert.ok(filler.length > 2 * 1024 * 1024, "the fixture must exceed the cap");

  const { github, context, calls } = harness({
    jobs: [job],
    jobLogs: { [job.id]: new TextEncoder().encode(oversized) },
  });
  await reconcileCiFailureIssue({ github, context });

  const body = calls.create[0].body;
  assert.match(body, /##\[error\]Process completed with exit code 1\./);
  assert.ok(
    !body.includes("GHSA-vx52-2968-3vc6"),
    "content past the byte cap must never be decoded",
  );
});

test("evidence comes from the reconciled attempt, not the newest one", async () => {
  const staleAttempt = workflowRun({ id: 4_242, run_attempt: 1 });
  const firstAttemptJob = failedJob({
    id: 700_001,
    name: "attempt 1 job",
    run_attempt: 1,
  });
  const rerunJob = failedJob({
    id: 700_002,
    name: "attempt 2 job",
    run_attempt: 2,
  });
  const { github, context, calls } = harness({
    run: staleAttempt,
    latestRuns: [staleAttempt],
    jobs: [rerunJob, firstAttemptJob],
    jobLogs: {
      [firstAttemptJob.id]: OSV_JOB_LOG,
      [rerunJob.id]: SKEW_JOB_LOG,
    },
  });
  const result = await reconcileCiFailureIssue({ github, context });

  assert.deepEqual(result, { action: "opened", issueNumber: 91 });
  assert.deepEqual(calls.logs, [firstAttemptJob.id]);
  assert.match(calls.create[0].body, /attempt 1 job/);
  assert.doesNotMatch(calls.create[0].body, /attempt 2 job/);
});

test("a job list without attempt numbers is still reported", async () => {
  const job = failedJob();
  delete job.run_attempt;
  const { github, context, calls } = harness({
    run: workflowRun({ run_attempt: 3 }),
    jobs: [job],
    jobLogs: { [job.id]: OSV_JOB_LOG },
  });
  await reconcileCiFailureIssue({ github, context });

  assert.match(calls.create[0].body, /GHSA-vx52-2968-3vc6/);
});

test("the evidence collector stops downloading logs past its deadline", async () => {
  const job = failedJob();
  const { github, calls } = harness({
    jobs: [job],
    jobLogs: { [job.id]: OSV_JOB_LOG },
  });
  const evidence = await collectFailureEvidence(
    github,
    { owner: "mento-protocol", repo: "frontend-monorepo" },
    workflowRun(),
    undefined,
    { deadlineMs: -1 },
  );

  assert.deepEqual(calls.logs, [], "no log is downloaded past the deadline");
  assert.equal(evidence.jobs.length, 1);
  assert.equal(
    evidence.jobs[0].note,
    "log excerpt unavailable: the evidence deadline passed",
  );
  assert.equal(
    evidence.jobs[0].failedStep,
    "Fail on newly introduced vulnerabilities",
  );
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
