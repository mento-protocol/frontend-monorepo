import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildCreateDeploymentRequest,
  buildStatusRequest,
  ensureGitHubDeployment,
  ensureGitHubDeploymentStatus,
  selectFinalDeploymentState,
  selectWorkflowDeploymentState,
} from "./github-deployment.mjs";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const RUN_URL =
  "https://github.com/mento-protocol/frontend-monorepo/actions/runs/123/attempts/1";

function deploymentRequest(overrides = {}) {
  return buildCreateDeploymentRequest({
    idempotencyKey: `vercel-pilot:v1:ui:sha:${SHA}:run:123:attempt:1`,
    logicalTarget: "ui",
    sha: SHA,
    gitRef: "feature/ui-pilot",
    workflowRunUrl: RUN_URL,
    pullRequestNumber: "518",
    provenance: "manual-pilot",
    environment: "vercel-preview-ui",
    ...overrides,
  });
}

test("create request is exact-SHA, transient, non-production, and secretless", () => {
  const request = deploymentRequest();
  assert.deepEqual(request, {
    ref: SHA,
    auto_merge: false,
    required_contexts: [],
    environment: "vercel-preview-ui",
    transient_environment: true,
    production_environment: false,
    description: "Vercel prebuilt ui preview",
    payload: {
      controller_schema: "mento-vercel-prebuilt/v1",
      idempotency_key: `vercel-pilot:v1:ui:sha:${SHA}:run:123:attempt:1`,
      logical_target: "ui",
      sha: SHA,
      git_ref: "feature/ui-pilot",
      workflow_run_url: RUN_URL,
      pull_request_number: 518,
      provenance: "manual-pilot",
    },
  });
  assert.doesNotMatch(
    JSON.stringify(request),
    /token|secret|authorization|bypass/i,
  );
  assert.throws(
    () => deploymentRequest({ sha: "main" }),
    /immutable lowercase 40-digit SHA/,
  );
  assert.throws(
    () => deploymentRequest({ workflowRunUrl: "http://github.com/run/1" }),
    /HTTPS URL/,
  );
});

test("same idempotency identity reuses one GitHub Deployment", async () => {
  const request = deploymentRequest();
  const calls = [];
  const existing = {
    id: 91,
    sha: SHA,
    environment: request.environment,
    payload: request.payload,
  };
  const api = async (call) => {
    calls.push(call);
    return call.method === "GET" ? [existing] : { id: 92 };
  };
  assert.deepEqual(await ensureGitHubDeployment({ request, api }), {
    deploymentId: "91",
    reused: true,
  });
  assert.deepEqual(calls, [
    {
      method: "GET",
      path: "/deployments",
      query: {
        sha: SHA,
        environment: "vercel-preview-ui",
        per_page: "100",
      },
    },
  ]);
});

test("a distinct run-attempt idempotency key creates a new Deployment", async () => {
  const previous = deploymentRequest();
  const request = deploymentRequest({
    idempotencyKey: `vercel-pilot:v1:ui:sha:${SHA}:run:123:attempt:2`,
  });
  const calls = [];
  const api = async (call) => {
    calls.push(call);
    if (call.method === "GET") {
      return [
        {
          id: 91,
          sha: SHA,
          environment: previous.environment,
          payload: JSON.stringify(previous.payload),
        },
      ];
    }
    return { id: 92 };
  };
  assert.deepEqual(await ensureGitHubDeployment({ request, api }), {
    deploymentId: "92",
    reused: false,
  });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1], {
    method: "POST",
    path: "/deployments",
    body: request,
  });
});

test("idempotency lookup follows every same-SHA Deployment page", async () => {
  const request = deploymentRequest();
  const calls = [];
  const api = async (call) => {
    calls.push(call);
    if (call.method === "POST") throw new Error("must not create a duplicate");
    if (call.query.page === "2") {
      return [
        {
          id: 191,
          sha: SHA,
          environment: request.environment,
          payload: request.payload,
        },
      ];
    }
    return Array.from({ length: 100 }, (_, index) => ({
      id: index + 1,
      sha: SHA,
      environment: request.environment,
      payload: { ...request.payload, idempotency_key: `different-${index}` },
    }));
  };
  assert.deepEqual(await ensureGitHubDeployment({ request, api }), {
    deploymentId: "191",
    reused: true,
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].query.page, "2");
});

test("status requests require smoke URL evidence before success", () => {
  assert.deepEqual(
    buildStatusRequest({
      state: "success",
      environmentUrl: "https://ui-pilot-abc.vercel.app",
      logUrl: RUN_URL,
      description: "Prebuilt preview verified",
    }),
    {
      state: "success",
      environment_url: "https://ui-pilot-abc.vercel.app/",
      log_url: RUN_URL,
      description: "Prebuilt preview verified",
      auto_inactive: false,
    },
  );
  assert.throws(
    () =>
      buildStatusRequest({
        state: "success",
        logUrl: RUN_URL,
        description: "Prebuilt preview verified",
      }),
    /requires an environment URL/,
  );
  assert.throws(
    () =>
      buildStatusRequest({
        state: "failure",
        environmentUrl: "https://ui-pilot-abc.vercel.app",
        logUrl: RUN_URL,
        description: "failed",
      }),
    /Only a successful status/,
  );
  assert.throws(
    () =>
      buildStatusRequest({
        state: "success",
        environmentUrl: "http://ui-pilot-abc.vercel.app",
        logUrl: RUN_URL,
        description: "Prebuilt preview verified",
      }),
    /HTTPS URL/,
  );
});

test("status writes are idempotent for a deployment lifecycle", async () => {
  const request = buildStatusRequest({
    state: "in_progress",
    logUrl: RUN_URL,
    description: "Prebuilt preview build and verification running",
  });
  let posts = 0;
  const existing = {
    id: 11,
    state: request.state,
    log_url: request.log_url,
    environment_url: null,
    description: request.description,
  };
  const api = async ({ method }) => {
    if (method === "GET") return [existing];
    posts += 1;
    return { id: 12 };
  };
  assert.deepEqual(
    await ensureGitHubDeploymentStatus({
      deploymentId: "91",
      request,
      api,
    }),
    { statusId: "11", reused: true },
  );
  assert.equal(posts, 0);
});

test("finalizer maps build/deploy/smoke failures to failure and infrastructure to error", () => {
  for (const failingOutcome of [
    "buildOutcome",
    "deployOutcome",
    "smokeOutcome",
  ]) {
    assert.equal(
      selectFinalDeploymentState({
        jobStatus: "failure",
        buildOutcome: "success",
        deployOutcome: "success",
        smokeOutcome: "success",
        [failingOutcome]: "failure",
      }),
      "failure",
    );
  }
  assert.equal(
    selectFinalDeploymentState({
      jobStatus: "cancelled",
      buildOutcome: "success",
      deployOutcome: "skipped",
      smokeOutcome: "skipped",
    }),
    "error",
  );
  assert.equal(
    selectFinalDeploymentState({
      jobStatus: "failure",
      buildOutcome: "skipped",
      deployOutcome: "skipped",
      smokeOutcome: "skipped",
    }),
    "error",
  );
});

test("cross-job finalization follows build and smoke truth only", () => {
  assert.equal(
    selectWorkflowDeploymentState({
      prebuiltResult: "success",
      smokeResult: "success",
    }),
    "success",
  );
  for (const [prebuiltResult, smokeResult] of [
    ["failure", "skipped"],
    ["success", "failure"],
  ]) {
    assert.equal(
      selectWorkflowDeploymentState({ prebuiltResult, smokeResult }),
      "failure",
    );
  }
  for (const [prebuiltResult, smokeResult] of [
    ["cancelled", "skipped"],
    ["success", "cancelled"],
    ["skipped", "skipped"],
  ]) {
    assert.equal(
      selectWorkflowDeploymentState({ prebuiltResult, smokeResult }),
      "error",
    );
  }
  assert.throws(
    () =>
      selectWorkflowDeploymentState({
        prebuiltResult: "success",
        smokeResult: "unknown",
      }),
    /job result is invalid/,
  );
});
