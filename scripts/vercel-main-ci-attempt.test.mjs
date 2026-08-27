import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  admitMainCiAttempt,
  admitMainCiAttemptFromEnvironment,
  formatMainCiAttemptSummary,
  MAIN_DEPLOYMENT_ADMISSIBLE_ACTIONS,
  MAIN_DEPLOYMENT_REPOSITORY,
  mainDeploymentGateJobName,
  requireMainCiSuccess,
  requireMainCiSuccessFromEnvironment,
  validateMainCiWorkflowRunEvent,
  verifyMainCiAttempt,
} from "./vercel-main-ci-attempt.mjs";

const TOKEN = "github-token-fixture";
const OWN_RUN_ID = 70000000001;
const SIBLING_RUN_ID = 70000000002;
const DEPLOYMENT_RUNS_PATH = `/repos/${MAIN_DEPLOYMENT_REPOSITORY}/actions/workflows/${encodeURIComponent(
  ".github/workflows/vercel-main-deployment.yml",
)}/runs`;
const attemptCli = fileURLToPath(
  new URL("./vercel-main-ci-attempt.mjs", import.meta.url),
);
const fixtureDirectory = new URL(
  "./fixtures/vercel-main-ci-attempt/",
  import.meta.url,
);

function loadFixture(name) {
  return JSON.parse(readFileSync(new URL(name, fixtureDirectory), "utf8"));
}

function successFixture() {
  return loadFixture("success-first-attempt.json");
}

function requestedFixture() {
  return loadFixture("requested-first-attempt.json");
}

function deploymentRun(overrides = {}) {
  const id = overrides.id ?? SIBLING_RUN_ID;
  return {
    id,
    name: "Vercel Main Deployment",
    display_title: "Vercel Main Deployment",
    path: ".github/workflows/vercel-main-deployment.yml",
    event: "workflow_run",
    head_branch: "main",
    head_sha: "0123456789abcdef0123456789abcdef01234567",
    status: "completed",
    conclusion: "success",
    url: `https://api.github.com/repos/${MAIN_DEPLOYMENT_REPOSITORY}/actions/runs/${id}`,
    html_url: `https://github.com/${MAIN_DEPLOYMENT_REPOSITORY}/actions/runs/${id}`,
    ...overrides,
  };
}

function gateJob(overrides = {}) {
  return {
    id: 80000000001,
    run_id: SIBLING_RUN_ID,
    name: mainDeploymentGateJobName(40000000001, 1),
    status: "completed",
    conclusion: "success",
    ...overrides,
  };
}

function listing(items, key) {
  return { total_count: items.length, [key]: items };
}

function rerunFixture() {
  return loadFixture("success-rerun-attempt.json");
}

function priorAttemptFixture() {
  const description = loadFixture("prior-attempt-confusion.json");
  const fixture = rerunFixture();
  Object.assign(fixture.job_pages[0].jobs[0], description.job_overrides);
  return fixture;
}

function paginationFixture() {
  const description = loadFixture("pagination.json");
  const fixture = successFixture();
  const jobs = fixture.job_pages[0].jobs;
  fixture.job_pages = description.job_pages.map((page) => ({
    total_count: page.total_count,
    jobs: page.job_indexes.map((index) => jobs[index]),
  }));
  return fixture;
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function textResponse(value, contentType = "application/json") {
  return new Response(value, {
    status: 200,
    headers: { "content-type": contentType },
  });
}

function fakeGitHubApi(fixture, { intercept } = {}) {
  const calls = [];
  const runId = fixture.event.workflow_run.id;
  const runAttempt = fixture.event.workflow_run.run_attempt;
  const runPath = `/repos/${MAIN_DEPLOYMENT_REPOSITORY}/actions/runs/${runId}`;
  const jobsPath = `${runPath}/attempts/${runAttempt}/jobs`;
  const siblingJobsPath = `/repos/${MAIN_DEPLOYMENT_REPOSITORY}/actions/runs/${SIBLING_RUN_ID}/jobs`;

  const fetchImplementation = async (input, options) => {
    const url = new URL(input);
    calls.push({ options, url });
    const intercepted = await intercept?.({
      call: calls.length,
      options,
      url,
    });
    if (intercepted !== undefined) return intercepted;
    if (url.pathname === runPath && url.search === "") {
      return jsonResponse(fixture.run);
    }
    if (url.pathname === jobsPath) {
      assert.equal(url.searchParams.get("per_page"), "100");
      const page = Number(url.searchParams.get("page"));
      return fixture.job_pages[page - 1]
        ? jsonResponse(fixture.job_pages[page - 1])
        : jsonResponse({ message: "Not Found" }, 404);
    }
    if (url.pathname === DEPLOYMENT_RUNS_PATH) {
      return fixture.deployment_runs
        ? jsonResponse(fixture.deployment_runs)
        : jsonResponse(listing([], "workflow_runs"));
    }
    if (url.pathname === siblingJobsPath) {
      return fixture.sibling_jobs
        ? jsonResponse(fixture.sibling_jobs)
        : jsonResponse({ message: "Not Found" }, 404);
    }
    return jsonResponse({ message: "Not Found" }, 404);
  };

  return {
    calls,
    fetchImplementation,
    jobsPath,
    runPath,
    siblingJobsPath,
  };
}

function admissionOptions(fixture, fetchImplementation, additional = {}) {
  return {
    eventPayload: fixture.event,
    deploySha: fixture.event.workflow_run.head_sha,
    token: TOKEN,
    ownRunId: OWN_RUN_ID,
    fetchImplementation,
    sleepImplementation: async () => {},
    ...additional,
  };
}

function gateOptions(fixture, fetchImplementation, additional = {}) {
  return {
    eventPayload: fixture.event,
    deploySha: fixture.event.workflow_run.head_sha,
    upstreamRunId: fixture.event.workflow_run.id,
    upstreamRunAttempt: fixture.event.workflow_run.run_attempt,
    token: TOKEN,
    fetchImplementation,
    sleepImplementation: async () => {},
    ...additional,
  };
}

function verificationOptions(fixture, fetchImplementation, additional = {}) {
  return {
    eventPayload: fixture.event,
    deploySha: fixture.event.workflow_run.head_sha,
    token: TOKEN,
    fetchImplementation,
    sleepImplementation: async () => {},
    ...additional,
  };
}

test("verifies a first-attempt CI run and emits only canonical evidence", async () => {
  const fixture = successFixture();
  const api = fakeGitHubApi(fixture);
  const result = await verifyMainCiAttempt(
    verificationOptions(fixture, api.fetchImplementation),
  );

  assert.deepEqual(result, {
    build_and_test_job_id: 90000000002,
    build_and_test_job_url:
      "https://github.com/mento-protocol/frontend-monorepo/actions/runs/40000000001/job/90000000002",
    deploy_sha: "0123456789abcdef0123456789abcdef01234567",
    upstream_run_attempt: 1,
    upstream_run_id: 40000000001,
    upstream_run_url:
      "https://github.com/mento-protocol/frontend-monorepo/actions/runs/40000000001/attempts/1",
  });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(api.calls.length, 2);
  for (const { options, url } of api.calls) {
    assert.equal(url.origin, "https://api.github.com");
    assert.equal(options.method, "GET");
    assert.equal(options.redirect, "error");
    assert.equal(options.headers.Authorization, `Bearer ${TOKEN}`);
  }
});

test("verifies a rerun only through the attempt-specific jobs endpoint", async () => {
  const fixture = rerunFixture();
  const api = fakeGitHubApi(fixture);
  const result = await verifyMainCiAttempt(
    verificationOptions(fixture, api.fetchImplementation),
  );

  assert.equal(result.upstream_run_attempt, 2);
  assert.equal(
    result.upstream_run_url,
    "https://github.com/mento-protocol/frontend-monorepo/actions/runs/40000000002/attempts/2",
  );
  const jobCalls = api.calls.filter(({ url }) =>
    url.pathname.endsWith("/jobs"),
  );
  assert.equal(jobCalls.length, 1);
  assert.equal(
    jobCalls[0].url.pathname,
    "/repos/mento-protocol/frontend-monorepo/actions/runs/40000000002/attempts/2/jobs",
  );
  assert.equal(
    api.calls.some(({ url }) =>
      url.pathname.endsWith("/actions/runs/40000000002/jobs"),
    ),
    false,
  );
});

test("rejects a prior-attempt sentinel returned for a rerun", async () => {
  const fixture = priorAttemptFixture();
  const api = fakeGitHubApi(fixture);
  await assert.rejects(
    verifyMainCiAttempt(verificationOptions(fixture, api.fetchImplementation)),
    /job run attempt mismatch/,
  );
});

test("authenticates the completed event before making API requests", async () => {
  const scenarios = loadFixture("negative-scenarios.json");
  const mutations = {
    "wrong-workflow-path": (fixture, scenario) => {
      fixture.event.workflow_run[scenario.property] = scenario.value;
    },
    "wrong-repository": (fixture, scenario) => {
      fixture.event.repository[scenario.property] = scenario.value;
    },
    "wrong-sha": (fixture, scenario) => {
      fixture.event.workflow_run[scenario.property] = scenario.value;
    },
    "wrong-branch": (fixture, scenario) => {
      fixture.event.workflow_run[scenario.property] = scenario.value;
    },
    "wrong-event": (fixture, scenario) => {
      fixture.event.workflow_run[scenario.property] = scenario.value;
    },
    "wrong-conclusion": (fixture, scenario) => {
      fixture.event.workflow_run[scenario.property] = scenario.value;
    },
  };

  for (const [name, mutate] of Object.entries(mutations)) {
    const fixture = successFixture();
    mutate(fixture, scenarios[name]);
    let calls = 0;
    await assert.rejects(
      verifyMainCiAttempt({
        ...verificationOptions(fixture, async () => {
          calls += 1;
          throw new Error("unexpected fetch");
        }),
        deploySha: successFixture().event.workflow_run.head_sha,
      }),
      /mismatch/,
      name,
    );
    assert.equal(calls, 0, name);
  }

  const malformedSha = successFixture();
  assert.throws(
    () =>
      validateMainCiWorkflowRunEvent({
        eventPayload: malformedSha.event,
        deploySha: "ABCDEF",
      }),
    /immutable lowercase 40-character SHA/,
  );

  // The widened allowlist still admits exactly two activity types.
  assert.deepEqual(MAIN_DEPLOYMENT_ADMISSIBLE_ACTIONS, [
    "requested",
    "completed",
  ]);
  const unknownAction = loadFixture("negative-scenarios.json")[
    "unknown-action"
  ];
  for (const action of [unknownAction.value, "in_progress", "deleted", ""]) {
    const fixture = successFixture();
    fixture.event.action = action;
    assert.throws(
      () =>
        validateMainCiWorkflowRunEvent({
          eventPayload: fixture.event,
          deploySha: fixture.event.workflow_run.head_sha,
          allowedActions: MAIN_DEPLOYMENT_ADMISSIBLE_ACTIONS,
        }),
      /GitHub event action/,
      String(action),
    );
  }
  // `requested` stays inadmissible for the terminal verifier's default.
  assert.throws(
    () =>
      validateMainCiWorkflowRunEvent({
        eventPayload: requestedFixture().event,
        deploySha: requestedFixture().event.workflow_run.head_sha,
      }),
    /GitHub event action is not admissible/,
  );
});

test("admits a requested delivery without claiming the CI verdict", async () => {
  const fixture = requestedFixture();
  const api = fakeGitHubApi(fixture);
  const result = await admitMainCiAttempt(
    admissionOptions(fixture, api.fetchImplementation),
  );

  assert.deepEqual(result, {
    admission_mode: "early",
    deploy_mode: "deploy",
    deploy_sha: "0123456789abcdef0123456789abcdef01234567",
    duplicate_of_run_url: "",
    upstream_run_attempt: 1,
    upstream_run_id: 40000000001,
    upstream_run_url:
      "https://github.com/mento-protocol/frontend-monorepo/actions/runs/40000000001/attempts/1",
  });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(api.calls.length, 1);
  assert.equal(api.calls[0].url.pathname, api.runPath);
  assert.equal(
    api.calls.some(({ url }) => url.pathname === DEPLOYMENT_RUNS_PATH),
    false,
    "a requested delivery never probes for a duplicate sibling",
  );
});

test("early admission never waits for the sentinel job record", async () => {
  // `.github/workflows/ci.yml` gives the `Build and Test` sentinel
  // `needs: [changes, build, test-workspaces, test-vercel, static]`, and GitHub
  // creates a job record
  // only once a job's `needs` resolve. A `requested` delivery admits within
  // seconds of the run starting, minutes before that record exists, so reading
  // the attempt's jobs at all would make every early run fail closed and erase
  // the overlap the delivery exists for. `require-ci-success` owns it instead.
  const fixture = requestedFixture();
  assert.equal(
    fixture.job_pages[0].jobs.some((job) => job.name === "Build and Test"),
    false,
    "the requested fixture must reproduce a run without its sentinel record",
  );
  const api = fakeGitHubApi(fixture, {
    intercept: ({ url }) => {
      assert.notEqual(
        url.pathname,
        api.jobsPath,
        "early admission must not read the attempt jobs endpoint",
      );
      return undefined;
    },
  });
  const result = await admitMainCiAttempt(
    admissionOptions(fixture, api.fetchImplementation),
  );
  assert.equal(result.admission_mode, "early");
  assert.equal(result.build_and_test_job_id, undefined);
  assert.equal(result.build_and_test_job_url, undefined);
});

test("requiring the CI verdict mints no gate marker of its own", () => {
  // `require-success` runs in three places: the gate job itself, and in-job
  // inside `restore-inherited-release` and `prepare-release`, which trade the
  // gate `needs` edge for an in-job step so they can overlap CI. The
  // duplicate-run probe matches a job NAME produced only by
  // `mainDeploymentGateJobName`, and requires exactly one such job in the
  // sibling attempt. `requireMainCiSuccess` must therefore never touch that
  // helper: it is a pure attempt-verdict function, so a second invocation
  // cannot create a competing marker or perturb `decideMainCiDeployMode`.
  const source = readFileSync(
    new URL("./vercel-main-ci-attempt.mjs", import.meta.url),
    "utf8",
  );
  const start = source.indexOf("export async function requireMainCiSuccess");
  assert.ok(start > 0, "requireMainCiSuccess must remain an exported function");
  const body = source.slice(start);
  const end = body.indexOf("\n}\n");
  assert.ok(end > 0, "requireMainCiSuccess body terminator not found");
  assert.doesNotMatch(
    body.slice(0, end + 3),
    /mainDeploymentGateJobName|MAIN_DEPLOYMENT_GATE/,
    "the CI verdict may not derive or publish the gate job marker",
  );
});

test("rejects a requested delivery whose attempt already concluded", async () => {
  for (const overrides of [
    { conclusion: "success", status: "completed" },
    { conclusion: "failure", status: "completed" },
    { conclusion: null, status: "completed" },
    { conclusion: "success", status: "in_progress" },
  ]) {
    const fixture = requestedFixture();
    Object.assign(fixture.event.workflow_run, overrides);
    let calls = 0;
    await assert.rejects(
      admitMainCiAttempt(
        admissionOptions(fixture, async () => {
          calls += 1;
          throw new Error("unexpected fetch");
        }),
      ),
      /GitHub event workflow run (?:status|conclusion) mismatch/,
      JSON.stringify(overrides),
    );
    assert.equal(calls, 0, JSON.stringify(overrides));
  }

  for (const overrides of [
    { conclusion: "success", status: "completed" },
    { conclusion: "failure", status: "in_progress" },
  ]) {
    const fixture = requestedFixture();
    Object.assign(fixture.run, overrides);
    const api = fakeGitHubApi(fixture);
    await assert.rejects(
      admitMainCiAttempt(admissionOptions(fixture, api.fetchImplementation)),
      /GitHub API workflow run (?:status|conclusion) mismatch/,
      JSON.stringify(overrides),
    );
    assert.equal(api.calls.length, 1, JSON.stringify(overrides));
  }
});

test("a completed delivery is a no-op only against a sibling that succeeded after its gate", async () => {
  const cases = [
    {
      name: "no sibling",
      deployment_runs: listing([], "workflow_runs"),
      expected: "deploy",
    },
    {
      name: "only this run",
      deployment_runs: listing(
        [deploymentRun({ id: OWN_RUN_ID })],
        "workflow_runs",
      ),
      expected: "deploy",
    },
    {
      name: "two siblings",
      deployment_runs: listing(
        [deploymentRun(), deploymentRun({ id: 70000000003 })],
        "workflow_runs",
      ),
      sibling_jobs: listing([gateJob()], "jobs"),
      expected: "deploy",
    },
    {
      name: "gate job bound to another upstream attempt",
      deployment_runs: listing([deploymentRun()], "workflow_runs"),
      sibling_jobs: listing(
        [gateJob({ name: mainDeploymentGateJobName(40000000001, 2) })],
        "jobs",
      ),
      expected: "deploy",
    },
    {
      name: "gate job bound to another upstream run",
      deployment_runs: listing([deploymentRun()], "workflow_runs"),
      sibling_jobs: listing(
        [gateJob({ name: mainDeploymentGateJobName(40000000009, 1) })],
        "jobs",
      ),
      expected: "deploy",
    },
    {
      name: "gate job run ID mismatch",
      deployment_runs: listing([deploymentRun()], "workflow_runs"),
      sibling_jobs: listing([gateJob({ run_id: 70000000009 })], "jobs"),
      expected: "deploy",
    },
    {
      name: "wrong workflow path",
      deployment_runs: listing(
        [deploymentRun({ path: ".github/workflows/ci.yml" })],
        "workflow_runs",
      ),
      sibling_jobs: listing([gateJob()], "jobs"),
      expected: "deploy",
    },
    {
      name: "wrong event",
      deployment_runs: listing(
        [deploymentRun({ event: "push" })],
        "workflow_runs",
      ),
      sibling_jobs: listing([gateJob()], "jobs"),
      expected: "deploy",
    },
    {
      name: "wrong head branch",
      deployment_runs: listing(
        [deploymentRun({ head_branch: "feature" })],
        "workflow_runs",
      ),
      sibling_jobs: listing([gateJob()], "jobs"),
      expected: "deploy",
    },
    {
      name: "wrong head SHA",
      deployment_runs: listing(
        [deploymentRun({ head_sha: "f".repeat(40) })],
        "workflow_runs",
      ),
      sibling_jobs: listing([gateJob()], "jobs"),
      expected: "deploy",
    },
    {
      name: "forged web URL",
      deployment_runs: listing(
        [deploymentRun({ html_url: "https://attacker.example/run" })],
        "workflow_runs",
      ),
      sibling_jobs: listing([gateJob()], "jobs"),
      expected: "deploy",
    },
    {
      // A sibling that passed the gate and then failed in preplan, planning,
      // a stage, or activation left `main` undeployed. Deduplicating against
      // its gate job alone would turn that failure into a green no-op and
      // clear the managed CI-failure issue for the newest run on the commit.
      name: "sibling run failed after passing its gate",
      deployment_runs: listing(
        [deploymentRun({ conclusion: "failure" })],
        "workflow_runs",
      ),
      sibling_jobs: listing([gateJob()], "jobs"),
      expected: "deploy",
    },
    {
      name: "sibling run cancelled after passing its gate",
      deployment_runs: listing(
        [deploymentRun({ conclusion: "cancelled" })],
        "workflow_runs",
      ),
      sibling_jobs: listing([gateJob()], "jobs"),
      expected: "deploy",
    },
    {
      name: "sibling run not terminal",
      deployment_runs: listing(
        [deploymentRun({ conclusion: null, status: "in_progress" })],
        "workflow_runs",
      ),
      sibling_jobs: listing([gateJob()], "jobs"),
      expected: "deploy",
    },
    {
      name: "sibling run conclusion absent",
      deployment_runs: listing(
        [deploymentRun({ conclusion: undefined, status: "completed" })],
        "workflow_runs",
      ),
      sibling_jobs: listing([gateJob()], "jobs"),
      expected: "deploy",
    },
    {
      name: "gate job missing",
      deployment_runs: listing([deploymentRun()], "workflow_runs"),
      sibling_jobs: listing(
        [gateJob({ name: "Admit exact upstream CI attempt" })],
        "jobs",
      ),
      expected: "deploy",
    },
    {
      name: "gate job failed",
      deployment_runs: listing([deploymentRun()], "workflow_runs"),
      sibling_jobs: listing([gateJob({ conclusion: "failure" })], "jobs"),
      expected: "deploy",
    },
    {
      name: "gate job still running",
      deployment_runs: listing([deploymentRun()], "workflow_runs"),
      sibling_jobs: listing(
        [gateJob({ conclusion: null, status: "in_progress" })],
        "jobs",
      ),
      expected: "deploy",
    },
    {
      name: "duplicated gate job",
      deployment_runs: listing([deploymentRun()], "workflow_runs"),
      sibling_jobs: listing([gateJob(), gateJob({ id: 80000000002 })], "jobs"),
      expected: "deploy",
    },
    {
      name: "oversized listing",
      deployment_runs: { total_count: 101, workflow_runs: [deploymentRun()] },
      sibling_jobs: listing([gateJob()], "jobs"),
      expected: "deploy",
    },
    {
      name: "sibling jobs unavailable",
      deployment_runs: listing([deploymentRun()], "workflow_runs"),
      expected: "deploy",
    },
    {
      name: "exact gate-passed sibling that succeeded",
      deployment_runs: listing([deploymentRun()], "workflow_runs"),
      sibling_jobs: listing(
        [
          gateJob({ id: 80000000003, name: "Admit exact upstream CI attempt" }),
          gateJob(),
        ],
        "jobs",
      ),
      expected: "already-deployed",
    },
  ];

  for (const scenario of cases) {
    const fixture = successFixture();
    fixture.deployment_runs = scenario.deployment_runs;
    if (scenario.sibling_jobs) fixture.sibling_jobs = scenario.sibling_jobs;
    const api = fakeGitHubApi(fixture);
    const result = await admitMainCiAttempt(
      admissionOptions(fixture, api.fetchImplementation),
    );
    assert.equal(result.admission_mode, "verified", scenario.name);
    assert.equal(result.deploy_mode, scenario.expected, scenario.name);
    assert.equal(
      result.duplicate_of_run_url,
      scenario.expected === "already-deployed"
        ? `https://github.com/${MAIN_DEPLOYMENT_REPOSITORY}/actions/runs/${SIBLING_RUN_ID}`
        : "",
      scenario.name,
    );
  }

  const failing = successFixture();
  failing.deployment_runs = listing([deploymentRun()], "workflow_runs");
  const failingApi = fakeGitHubApi(failing, {
    intercept: ({ url }) =>
      url.pathname === DEPLOYMENT_RUNS_PATH
        ? jsonResponse({ message: "server error" }, 500)
        : undefined,
  });
  const result = await admitMainCiAttempt(
    admissionOptions(failing, failingApi.fetchImplementation),
  );
  assert.equal(result.deploy_mode, "deploy", "an API failure still deploys");
});

test("the success gate polls the exact attempt and derives the sentinel", async () => {
  const pending = requestedFixture();
  const completed = successFixture();
  let runReads = 0;
  const sleeps = [];
  const api = fakeGitHubApi(pending, {
    intercept: ({ url }) => {
      if (url.pathname.endsWith("/jobs")) {
        return jsonResponse(completed.job_pages[0]);
      }
      if (url.pathname !== api.runPath || url.search !== "") return undefined;
      runReads += 1;
      return runReads < 3
        ? jsonResponse(pending.run)
        : jsonResponse(completed.run);
    },
  });
  const result = await requireMainCiSuccess(
    gateOptions(pending, api.fetchImplementation, {
      awaitIntervalMs: 1_000,
      sleepImplementation: async (milliseconds) => sleeps.push(milliseconds),
    }),
  );
  assert.equal(runReads, 3);
  assert.deepEqual(sleeps, [1_000, 1_000]);
  assert.deepEqual(result, {
    build_and_test_job_id: 90000000002,
    build_and_test_job_url:
      "https://github.com/mento-protocol/frontend-monorepo/actions/runs/40000000001/job/90000000002",
    deploy_sha: "0123456789abcdef0123456789abcdef01234567",
    upstream_run_attempt: 1,
    upstream_run_id: 40000000001,
    upstream_run_url:
      "https://github.com/mento-protocol/frontend-monorepo/actions/runs/40000000001/attempts/1",
  });
  assert.equal(Object.isFrozen(result), true);
});

test("the success gate refuses every non-success terminal conclusion at once", async () => {
  for (const conclusion of ["failure", "cancelled", "timed_out", "skipped"]) {
    const fixture = requestedFixture();
    const terminal = successFixture();
    terminal.run.conclusion = conclusion;
    const sleeps = [];
    const api = fakeGitHubApi(fixture, {
      intercept: ({ url }) =>
        url.pathname === api.runPath && url.search === ""
          ? jsonResponse(terminal.run)
          : undefined,
    });
    await assert.rejects(
      requireMainCiSuccess(
        gateOptions(fixture, api.fetchImplementation, {
          sleepImplementation: async (milliseconds) =>
            sleeps.push(milliseconds),
        }),
      ),
      /GitHub API workflow run conclusion mismatch/,
      conclusion,
    );
    assert.deepEqual(sleeps, [], conclusion);
    assert.equal(
      api.calls.filter(({ url }) => url.pathname.endsWith("/jobs")).length,
      0,
      conclusion,
    );
  }
});

test("the success gate fails closed on an unsuccessful sentinel job", async () => {
  const unfinished = successFixture();
  Object.assign(unfinished.job_pages[0].jobs[1], {
    conclusion: null,
    status: "in_progress",
  });
  await assert.rejects(
    requireMainCiSuccess(
      gateOptions(unfinished, fakeGitHubApi(unfinished).fetchImplementation),
    ),
    /did not complete successfully/,
  );
});

test("the success gate rejects an admitted identity that contradicts the event", async () => {
  const fixture = successFixture();
  for (const overrides of [
    { upstreamRunId: 40000000009 },
    { upstreamRunAttempt: 2 },
    { deploySha: "f".repeat(40) },
    { upstreamRunId: "40000000001" },
  ]) {
    let calls = 0;
    await assert.rejects(
      requireMainCiSuccess(
        gateOptions(
          fixture,
          async () => {
            calls += 1;
            throw new Error("unexpected fetch");
          },
          overrides,
        ),
      ),
      /mismatch|positive safe integer/,
      JSON.stringify(overrides),
    );
    assert.equal(calls, 0, JSON.stringify(overrides));
  }
});

test("the success gate bounds its await and honours external cancellation", async () => {
  const fixture = requestedFixture();
  const sleeps = [];
  const api = fakeGitHubApi(fixture);
  await assert.rejects(
    requireMainCiSuccess(
      gateOptions(fixture, api.fetchImplementation, {
        awaitIntervalMs: 30_000,
        awaitTimeoutMs: 60_000,
        sleepImplementation: async (milliseconds) => sleeps.push(milliseconds),
      }),
    ),
    /did not complete within its bounded await/,
  );
  assert.deepEqual(sleeps, [30_000]);

  const wallClock = fakeGitHubApi(requestedFixture());
  let clock = 0;
  await assert.rejects(
    requireMainCiSuccess(
      gateOptions(fixture, wallClock.fetchImplementation, {
        awaitIntervalMs: 1_000,
        awaitTimeoutMs: 60_000,
        nowImplementation: () => {
          clock += 45_000;
          return clock;
        },
        sleepImplementation: async () => {},
      }),
    ),
    /did not complete within its bounded await/,
  );

  const cancelled = new AbortController();
  const cancelledApi = fakeGitHubApi(requestedFixture());
  await assert.rejects(
    requireMainCiSuccess(
      gateOptions(fixture, cancelledApi.fetchImplementation, {
        awaitIntervalMs: 1_000,
        signal: cancelled.signal,
        sleepImplementation: async () => cancelled.abort(),
      }),
    ),
    /cancelled/,
  );
});

test("rejects every API run-record identity mismatch", async () => {
  const cases = [
    ["name", "Other workflow"],
    ["path", ".github/workflows/other.yml"],
    ["event", "workflow_dispatch"],
    ["head_branch", "feature"],
    ["head_sha", "f".repeat(40)],
    ["status", "in_progress"],
    ["conclusion", "cancelled"],
    ["run_attempt", 2],
    ["id", 40000000009],
    [
      "url",
      "https://api.github.com/repos/mento-protocol/frontend-monorepo/actions/runs/40000000009",
    ],
    [
      "html_url",
      "https://github.com/mento-protocol/frontend-monorepo/actions/runs/40000000009",
    ],
  ];

  for (const [property, value] of cases) {
    const fixture = successFixture();
    fixture.run[property] = value;
    const api = fakeGitHubApi(fixture);
    await assert.rejects(
      verifyMainCiAttempt(
        verificationOptions(fixture, api.fetchImplementation),
      ),
      /mismatch/,
      property,
    );
    assert.equal(api.calls.length, 1, property);
  }

  for (const repositoryProperty of ["repository", "head_repository"]) {
    const fixture = successFixture();
    fixture.run[repositoryProperty].full_name = "attacker/frontend-monorepo";
    const api = fakeGitHubApi(fixture);
    await assert.rejects(
      verifyMainCiAttempt(
        verificationOptions(fixture, api.fetchImplementation),
      ),
      /full name mismatch/,
      repositoryProperty,
    );
  }
});

test("requires exactly one literal successful Build and Test sentinel", async () => {
  const scenarios = loadFixture("negative-scenarios.json");

  const duplicate = successFixture();
  duplicate.job_pages[0].jobs[0].name = scenarios["duplicate-sentinel"].value;
  await assert.rejects(
    verifyMainCiAttempt(
      verificationOptions(
        duplicate,
        fakeGitHubApi(duplicate).fetchImplementation,
      ),
    ),
    /exactly one literal Build and Test/,
  );

  const missing = successFixture();
  missing.job_pages[0].jobs[1].name = scenarios["missing-sentinel"].value;
  await assert.rejects(
    verifyMainCiAttempt(
      verificationOptions(missing, fakeGitHubApi(missing).fetchImplementation),
    ),
    /exactly one literal Build and Test/,
  );

  for (const [status, conclusion] of [
    ["completed", "failure"],
    ["completed", "cancelled"],
    ["in_progress", null],
  ]) {
    const fixture = successFixture();
    Object.assign(fixture.job_pages[0].jobs[1], {
      status,
      conclusion,
    });
    await assert.rejects(
      verifyMainCiAttempt(
        verificationOptions(
          fixture,
          fakeGitHubApi(fixture).fetchImplementation,
        ),
      ),
      /did not complete successfully/,
      `${status}/${conclusion}`,
    );
  }
});

test("validates every job as part of the exact attempt response", async () => {
  const cases = [
    ["run_id", 40000000009],
    ["run_attempt", 2],
    ["workflow_name", "Other workflow"],
    ["head_branch", "feature"],
    ["head_sha", "f".repeat(40)],
    [
      "run_url",
      "https://api.github.com/repos/mento-protocol/frontend-monorepo/actions/runs/40000000009",
    ],
    [
      "url",
      "https://api.github.com/repos/mento-protocol/frontend-monorepo/actions/jobs/90000000009",
    ],
    [
      "html_url",
      "https://github.com/mento-protocol/frontend-monorepo/actions/runs/40000000001/job/90000000009",
    ],
  ];
  for (const [property, value] of cases) {
    const fixture = successFixture();
    fixture.job_pages[0].jobs[0][property] = value;
    const api = fakeGitHubApi(fixture);
    await assert.rejects(
      verifyMainCiAttempt(
        verificationOptions(fixture, api.fetchImplementation),
      ),
      /mismatch/,
      property,
    );
  }
});

test("paginates the complete attempt-specific job list", async () => {
  const fixture = paginationFixture();
  const api = fakeGitHubApi(fixture);
  const result = await verifyMainCiAttempt(
    verificationOptions(fixture, api.fetchImplementation),
  );

  assert.equal(result.build_and_test_job_id, 90000000002);
  assert.deepEqual(
    api.calls
      .filter(({ url }) => url.pathname.endsWith("/jobs"))
      .map(({ url }) => url.searchParams.get("page")),
    ["1", "2"],
  );
});

test("fails closed on incomplete, inconsistent, duplicate, or unbounded pagination", async () => {
  const malformedPages = [
    {
      name: "early empty page",
      mutate(fixture) {
        fixture.job_pages = [
          { total_count: 2, jobs: [fixture.job_pages[0].jobs[0]] },
          { total_count: 2, jobs: [] },
        ];
      },
      pattern: /ended before total_count/,
    },
    {
      name: "changing total",
      mutate(fixture) {
        fixture.job_pages = [
          { total_count: 2, jobs: [fixture.job_pages[0].jobs[0]] },
          { total_count: 3, jobs: [fixture.job_pages[0].jobs[1]] },
        ];
      },
      pattern: /total changed/,
    },
    {
      name: "duplicate job ID",
      mutate(fixture) {
        fixture.job_pages = [
          { total_count: 2, jobs: [fixture.job_pages[0].jobs[0]] },
          { total_count: 2, jobs: [fixture.job_pages[0].jobs[0]] },
        ];
      },
      pattern: /duplicate job ID/,
    },
    {
      name: "unbounded total",
      mutate(fixture) {
        fixture.job_pages[0].total_count = 1_001;
      },
      pattern: /1000-job bound/,
    },
    {
      name: "malformed total",
      mutate(fixture) {
        fixture.job_pages[0].total_count = "2";
      },
      pattern: /non-negative safe integer/,
    },
  ];

  for (const scenario of malformedPages) {
    const fixture = successFixture();
    scenario.mutate(fixture);
    const api = fakeGitHubApi(fixture);
    await assert.rejects(
      verifyMainCiAttempt(
        verificationOptions(fixture, api.fetchImplementation),
      ),
      scenario.pattern,
      scenario.name,
    );
  }
});

test("retries transient API failures with a bounded delay", async () => {
  const fixture = successFixture();
  const sleeps = [];
  let runRequests = 0;
  const api = fakeGitHubApi(fixture, {
    intercept: ({ url }) => {
      if (url.pathname === api.runPath) {
        runRequests += 1;
        if (runRequests === 1) {
          return jsonResponse({ message: "server error" }, 500);
        }
      }
      return undefined;
    },
  });
  await verifyMainCiAttempt({
    ...verificationOptions(fixture, api.fetchImplementation),
    retryDelayMs: 17,
    sleepImplementation: async (milliseconds) => sleeps.push(milliseconds),
  });
  assert.equal(runRequests, 2);
  assert.deepEqual(sleeps, [17]);
});

test("stops after bounded retries on an API failure", async () => {
  const fixture = successFixture();
  const scenarios = loadFixture("negative-scenarios.json");
  assert.equal(scenarios["api-failure"].fault, "http-500");
  const sleeps = [];
  const api = fakeGitHubApi(fixture, {
    intercept: () => jsonResponse({ message: "server error" }, 500),
  });
  await assert.rejects(
    verifyMainCiAttempt({
      ...verificationOptions(fixture, api.fetchImplementation),
      requestAttempts: 3,
      retryDelayMs: 7,
      sleepImplementation: async (milliseconds) => sleeps.push(milliseconds),
    }),
    /after 3 bounded attempts.*HTTP 500/,
  );
  assert.equal(api.calls.length, 3);
  assert.deepEqual(sleeps, [7, 7]);

  const forbidden = fakeGitHubApi(fixture, {
    intercept: () => jsonResponse({ message: "forbidden" }, 403),
  });
  await assert.rejects(
    verifyMainCiAttempt(
      verificationOptions(fixture, forbidden.fetchImplementation),
    ),
    /HTTP 403/,
  );
  assert.equal(forbidden.calls.length, 1);
});

test("bounds request timeouts and retries without hanging", async () => {
  const fixture = successFixture();
  const scenarios = loadFixture("negative-scenarios.json");
  assert.equal(scenarios.timeout.fault, "timeout");
  let calls = 0;
  const fetchImplementation = (_input, { signal }) => {
    calls += 1;
    return new Promise((_resolve, reject) => {
      signal.addEventListener(
        "abort",
        () => reject(new DOMException("aborted", "AbortError")),
        { once: true },
      );
    });
  };
  await assert.rejects(
    verifyMainCiAttempt({
      ...verificationOptions(fixture, fetchImplementation),
      requestAttempts: 2,
      requestTimeoutMs: 2,
    }),
    /after 2 bounded attempts.*request timeout/,
  );
  assert.equal(calls, 2);
});

test("external cancellation stops immediately without retry", async () => {
  const fixture = successFixture();
  const scenarios = loadFixture("negative-scenarios.json");
  assert.equal(scenarios.cancellation.fault, "abort");

  const alreadyCancelled = new AbortController();
  alreadyCancelled.abort();
  let calls = 0;
  await assert.rejects(
    verifyMainCiAttempt({
      ...verificationOptions(fixture, async () => {
        calls += 1;
        throw new Error("unexpected fetch");
      }),
      signal: alreadyCancelled.signal,
    }),
    /cancelled/,
  );
  assert.equal(calls, 0);

  const duringRequest = new AbortController();
  const fetchImplementation = async () => {
    calls += 1;
    duringRequest.abort();
    throw new DOMException("aborted", "AbortError");
  };
  await assert.rejects(
    verifyMainCiAttempt({
      ...verificationOptions(fixture, fetchImplementation),
      signal: duringRequest.signal,
    }),
    /cancelled/,
  );
  assert.equal(calls, 1);
});

test("rejects malformed API response envelopes without exposing bodies", async () => {
  const fixture = successFixture();
  const scenarios = loadFixture("negative-scenarios.json");
  assert.equal(scenarios["malformed-response"].fault, "invalid-json");

  const responses = [
    {
      name: "invalid JSON",
      response: textResponse("{"),
      pattern: /invalid JSON/,
    },
    {
      name: "wrong content type",
      response: textResponse("{}", "text/html"),
      pattern: /non-JSON/,
    },
    {
      name: "non-object run",
      response: jsonResponse([]),
      pattern: /plain object/,
    },
    {
      name: "oversized declared body",
      response: new Response("{}", {
        status: 200,
        headers: {
          "content-type": "application/json",
          "content-length": String(4 * 1024 * 1024 + 1),
        },
      }),
      pattern: /size limit/,
    },
  ];

  for (const scenario of responses) {
    const api = fakeGitHubApi(fixture, {
      intercept: ({ url }) =>
        url.pathname ===
        `/repos/${MAIN_DEPLOYMENT_REPOSITORY}/actions/runs/40000000001`
          ? scenario.response
          : undefined,
    });
    await assert.rejects(
      verifyMainCiAttempt(
        verificationOptions(fixture, api.fetchImplementation),
      ),
      scenario.pattern,
      scenario.name,
    );
  }

  const malformedJobs = successFixture();
  malformedJobs.job_pages[0] = {
    total_count: 1,
    jobs: "not-an-array",
  };
  await assert.rejects(
    verifyMainCiAttempt(
      verificationOptions(
        malformedJobs,
        fakeGitHubApi(malformedJobs).fetchImplementation,
      ),
    ),
    /jobs page 1 is malformed/,
  );
});

test("rejects unsafe API configuration before fetching", async () => {
  const fixture = successFixture();
  let calls = 0;
  const fetchImplementation = async () => {
    calls += 1;
    throw new Error("unexpected fetch");
  };
  for (const options of [
    { token: "" },
    { token: "bad token" },
    { apiUrl: "https://example.com" },
    { apiUrl: "https://api.github.com/repos" },
    { requestAttempts: 0 },
    { requestAttempts: 5 },
    { requestTimeoutMs: 0 },
    { retryDelayMs: 5_001 },
  ]) {
    await assert.rejects(
      verifyMainCiAttempt({
        ...verificationOptions(fixture, fetchImplementation),
        ...options,
      }),
      /GITHUB_TOKEN|GITHUB_API_URL|bounded policy/,
    );
  }
  assert.equal(calls, 0);
});

function withEnvironmentFiles(fixture, run) {
  const directory = mkdtempSync(join(tmpdir(), "main-ci-attempt-"));
  const eventPath = join(directory, "event.json");
  const outputPath = join(directory, "output");
  const summaryPath = join(directory, "summary");
  writeFileSync(eventPath, JSON.stringify(fixture.event));
  writeFileSync(outputPath, "");
  writeFileSync(summaryPath, "");
  return Promise.resolve(run({ eventPath, outputPath, summaryPath })).finally(
    () => rmSync(directory, { recursive: true, force: true }),
  );
}

test("environment admission writes only canonical outputs and summary evidence", async () => {
  const fixture = successFixture();
  fixture.deployment_runs = listing([deploymentRun()], "workflow_runs");
  fixture.sibling_jobs = listing([gateJob()], "jobs");
  const api = fakeGitHubApi(fixture);
  await withEnvironmentFiles(
    fixture,
    async ({ eventPath, outputPath, summaryPath }) => {
      const result = await admitMainCiAttemptFromEnvironment({
        values: {
          DEPLOY_SHA: fixture.event.workflow_run.head_sha,
          GITHUB_API_URL: "https://api.github.com",
          GITHUB_EVENT_PATH: eventPath,
          GITHUB_OUTPUT: outputPath,
          GITHUB_RUN_ID: String(OWN_RUN_ID),
          GITHUB_STEP_SUMMARY: summaryPath,
          GITHUB_TOKEN: TOKEN,
        },
        fetchImplementation: api.fetchImplementation,
        sleepImplementation: async () => {},
      });

      assert.deepEqual(Object.keys(result).sort(), [
        "admission_mode",
        "deploy_mode",
        "deploy_sha",
        "duplicate_of_run_url",
        "upstream_run_attempt",
        "upstream_run_id",
        "upstream_run_url",
      ]);
      const outputs = readFileSync(outputPath, "utf8");
      const summary = readFileSync(summaryPath, "utf8");
      for (const [name, value] of Object.entries(result)) {
        assert.match(outputs, new RegExp(`^${name}=${value}$`, "m"));
      }
      assert.equal(outputs.includes(TOKEN), false);
      assert.equal(summary, formatMainCiAttemptSummary(result));
      assert.equal(
        summary,
        [
          "### Admitted the exact completed upstream CI attempt",
          "",
          `- Upstream run attempt: \`${result.upstream_run_attempt}\``,
          `- Upstream run URL: ${result.upstream_run_url}`,
          `- DEPLOY_SHA: \`${result.deploy_sha}\``,
          "- Admission mode: `verified`",
          "- Deploy mode: `already-deployed`",
          `- Deduplicated by: ${result.duplicate_of_run_url}`,
          "",
        ].join("\n"),
      );
      assert.doesNotMatch(
        summary,
        /Upstream run ID|Build and Test job ID|Build and Test job URL/,
      );
      assert.equal(summary.includes(TOKEN), false);
    },
  );

  const early = requestedFixture();
  const earlyApi = fakeGitHubApi(early);
  await withEnvironmentFiles(
    early,
    async ({ eventPath, outputPath, summaryPath }) => {
      const result = await admitMainCiAttemptFromEnvironment({
        values: {
          DEPLOY_SHA: early.event.workflow_run.head_sha,
          GITHUB_EVENT_PATH: eventPath,
          GITHUB_OUTPUT: outputPath,
          GITHUB_RUN_ID: String(OWN_RUN_ID),
          GITHUB_STEP_SUMMARY: summaryPath,
          GITHUB_TOKEN: TOKEN,
        },
        fetchImplementation: earlyApi.fetchImplementation,
        sleepImplementation: async () => {},
      });
      assert.equal(result.admission_mode, "early");
      assert.equal(result.deploy_mode, "deploy");
      assert.match(
        readFileSync(summaryPath, "utf8"),
        /^### Admitted upstream CI attempt before its verdict$/m,
      );
      assert.match(
        readFileSync(outputPath, "utf8"),
        /^duplicate_of_run_url=$/m,
      );
    },
  );

  const missingRunId = successFixture();
  await withEnvironmentFiles(
    missingRunId,
    async ({ eventPath, outputPath }) => {
      await assert.rejects(
        admitMainCiAttemptFromEnvironment({
          values: {
            DEPLOY_SHA: missingRunId.event.workflow_run.head_sha,
            GITHUB_EVENT_PATH: eventPath,
            GITHUB_OUTPUT: outputPath,
            GITHUB_TOKEN: TOKEN,
          },
          fetchImplementation: fakeGitHubApi(missingRunId).fetchImplementation,
          sleepImplementation: async () => {},
        }),
        /GITHUB_RUN_ID must be a bounded positive integer/,
      );
    },
  );
});

test("environment success gate re-emits the canonical verified evidence", async () => {
  const fixture = successFixture();
  const api = fakeGitHubApi(fixture);
  await withEnvironmentFiles(
    fixture,
    async ({ eventPath, outputPath, summaryPath }) => {
      const result = await requireMainCiSuccessFromEnvironment({
        values: {
          DEPLOY_SHA: fixture.event.workflow_run.head_sha,
          GITHUB_EVENT_PATH: eventPath,
          GITHUB_OUTPUT: outputPath,
          GITHUB_STEP_SUMMARY: summaryPath,
          GITHUB_TOKEN: TOKEN,
          UPSTREAM_RUN_ATTEMPT: "1",
          UPSTREAM_RUN_ID: "40000000001",
        },
        fetchImplementation: api.fetchImplementation,
        sleepImplementation: async () => {},
      });
      assert.deepEqual(Object.keys(result).sort(), [
        "build_and_test_job_id",
        "build_and_test_job_url",
        "deploy_sha",
        "upstream_run_attempt",
        "upstream_run_id",
        "upstream_run_url",
      ]);
      assert.equal(
        readFileSync(summaryPath, "utf8"),
        [
          "### Verified upstream CI attempt",
          "",
          `- Upstream run attempt: \`${result.upstream_run_attempt}\``,
          `- Upstream run URL: ${result.upstream_run_url}`,
          `- Build and Test job URL: ${result.build_and_test_job_url}`,
          `- DEPLOY_SHA: \`${result.deploy_sha}\``,
          "",
        ].join("\n"),
      );
      assert.equal(readFileSync(outputPath, "utf8").includes(TOKEN), false);
      // The gate is the only producer of the sentinel evidence downstream jobs
      // consume, so it must publish it as a job output.
      assert.match(
        readFileSync(outputPath, "utf8"),
        new RegExp(
          `^build_and_test_job_url=${result.build_and_test_job_url}$`,
          "m",
        ),
      );
    },
  );

  for (const missing of ["UPSTREAM_RUN_ATTEMPT", "UPSTREAM_RUN_ID"]) {
    const values = {
      DEPLOY_SHA: fixture.event.workflow_run.head_sha,
      GITHUB_TOKEN: TOKEN,
      UPSTREAM_RUN_ATTEMPT: "1",
      UPSTREAM_RUN_ID: "40000000001",
    };
    delete values[missing];
    await withEnvironmentFiles(
      fixture,
      async ({ eventPath, outputPath }) =>
        await assert.rejects(
          requireMainCiSuccessFromEnvironment({
            values: {
              ...values,
              GITHUB_EVENT_PATH: eventPath,
              GITHUB_OUTPUT: outputPath,
            },
            fetchImplementation: fakeGitHubApi(fixture).fetchImplementation,
            sleepImplementation: async () => {},
          }),
          new RegExp(`${missing} must be a bounded positive integer`),
          missing,
        ),
    );
  }
});

test("the CLI exposes exactly the admit and require-success modes", () => {
  for (const argv of [
    [],
    ["verify"],
    ["admit", "extra"],
    ["Admit"],
    ["gate"],
  ]) {
    const result = spawnSync(process.execPath, [attemptCli, ...argv], {
      encoding: "utf8",
      env: {},
    });
    assert.notEqual(result.status, 0, argv.join(" "));
    assert.match(
      result.stderr,
      /Usage: vercel-main-ci-attempt\.mjs admit\|require-success/,
      argv.join(" "),
    );
  }
});

test("the gate job marker stays a bounded exact attempt identity", () => {
  assert.equal(
    mainDeploymentGateJobName(40000000001, 1),
    "Require the exact successful CI attempt for upstream 40000000001 attempt 1",
  );
  // GitHub truncates displayed job names beyond 100 characters, which would
  // break the exact duplicate-run match.
  assert.ok(mainDeploymentGateJobName(99999999999999, 99).length <= 100);
});
