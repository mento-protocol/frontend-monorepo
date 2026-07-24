import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  formatMainCiAttemptSummary,
  MAIN_DEPLOYMENT_REPOSITORY,
  validateMainCiWorkflowRunEvent,
  verifyMainCiAttempt,
  verifyMainCiAttemptFromEnvironment,
} from "./vercel-main-ci-attempt.mjs";

const TOKEN = "github-token-fixture";
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
    return jsonResponse({ message: "Not Found" }, 404);
  };

  return { calls, fetchImplementation, jobsPath, runPath };
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

test("environment CLI API writes only canonical outputs and summary evidence", async () => {
  const fixture = successFixture();
  const api = fakeGitHubApi(fixture);
  const directory = mkdtempSync(join(tmpdir(), "main-ci-attempt-"));
  const eventPath = join(directory, "event.json");
  const outputPath = join(directory, "output");
  const summaryPath = join(directory, "summary");
  try {
    writeFileSync(eventPath, JSON.stringify(fixture.event));
    writeFileSync(outputPath, "");
    writeFileSync(summaryPath, "");
    const result = await verifyMainCiAttemptFromEnvironment({
      values: {
        DEPLOY_SHA: fixture.event.workflow_run.head_sha,
        GITHUB_API_URL: "https://api.github.com",
        GITHUB_EVENT_PATH: eventPath,
        GITHUB_OUTPUT: outputPath,
        GITHUB_STEP_SUMMARY: summaryPath,
        GITHUB_TOKEN: TOKEN,
      },
      fetchImplementation: api.fetchImplementation,
      sleepImplementation: async () => {},
    });

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
        "### Verified upstream CI attempt",
        "",
        `- Upstream run attempt: \`${result.upstream_run_attempt}\``,
        `- Upstream run URL: ${result.upstream_run_url}`,
        `- Build and Test job URL: ${result.build_and_test_job_url}`,
        `- DEPLOY_SHA: \`${result.deploy_sha}\``,
        "",
      ].join("\n"),
    );
    assert.doesNotMatch(summary, /Upstream run ID|Build and Test job ID/);
    assert.equal(summary.includes(TOKEN), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
