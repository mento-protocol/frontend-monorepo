import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { test } from "node:test";

import {
  BOOTSTRAP_DISPATCH_EVENT,
  CONTROLLER_SCHEMA,
  EVENT_RECEIPT_SCHEMA,
  PREVIEW_JOURNAL_MARKER,
  PREVIEW_JOURNAL_SCHEMA,
  PREVIEW_REPOSITORY,
  RECONCILE_DISPATCH_EVENT,
  RESULT_RECEIPT_SCHEMA,
  SELECTION_RECEIPT_SCHEMA,
  compactPreviewJournal,
  controllerKey,
  createPreviewJournal,
  dependabotIntakeRunName,
  normalizePlannerResult,
  parseWorkerRunName,
  publishDependabotUnsupported,
  postWorkerRecoveryError,
  prepareBootstrap,
  recordEventReceipt,
  recordWorkerEvidence as recordWorkerEvidenceImplementation,
  reconcilePreview as reconcilePreviewImplementation,
  reconcileState,
  recoverWorkerResult,
  selectionReceiptFromDispatch,
  snapshotPullRequestEvent,
  validateEventReceipt,
  validateDependabotIntakeWorkflowRun,
  validateRepositoryDispatch,
  validateWorkerDispatch as validateWorkerDispatchImplementation,
  validateWorkerRunIdentity,
  validateWorkerResult,
  workerRunName,
  writeEventSnapshotOutputs,
  writeRepositoryDispatchOutputs,
} from "./vercel-preview-controller.mjs";
import { validateGitBranch } from "./vercel-prebuilt-workflow.mjs";
import {
  PREVIEW_TARGET_CONFIG,
  PREVIEW_TARGETS,
} from "./vercel-preview-targets.mjs";

const CONTROLLER_URL =
  "https://github.com/mento-protocol/frontend-monorepo/actions/runs/999";
const SHA = Object.fromEntries(
  ["A", "B", "C", "D", "E"].map((name, index) => [
    name,
    (index + 1).toString(16).repeat(40),
  ]),
);
const UI_VERCEL_CONFIGURATION_PATH = "apps/ui.mento.org/vercel.json";
const GITHUB_OWNED_UI_VERCEL_CONFIGURATION = {
  $schema: "https://openapi.vercel.sh/vercel.json",
  git: { deploymentEnabled: { "**": false, main: true } },
};
const NATIVE_OWNED_UI_VERCEL_CONFIGURATION = {
  $schema: "https://openapi.vercel.sh/vercel.json",
  git: { deploymentEnabled: { "dependabot/**": false } },
};
const workerDispatchClients = new WeakMap();

function reconcilePreview(options) {
  const workerDispatchGithub = Object.hasOwn(options, "workerDispatchGithub")
    ? options.workerDispatchGithub
    : workerDispatchClients.get(options.github);
  return reconcilePreviewImplementation({
    controllerMode: "active",
    workflowSha: SHA.E,
    now: () => timestamp(0),
    workerDispatchGithub,
    ...options,
  });
}

function validateWorkerDispatch(options) {
  return validateWorkerDispatchImplementation({
    workflowSha: SHA.E,
    ...options,
  });
}

function recordWorkerEvidence(options) {
  return recordWorkerEvidenceImplementation({
    workflowSha: SHA.E,
    ...options,
  });
}

function timestamp(second) {
  return `2026-07-15T10:00:${String(second).padStart(2, "0")}.000Z`;
}

function pull({
  number = 519,
  head = SHA.A,
  base = SHA.E,
  ref = "feature/preview-controller",
  repository = PREVIEW_REPOSITORY,
  author = "trusted-author",
  state = "open",
  updated = timestamp(1),
  closed = state === "closed" ? updated : null,
} = {}) {
  return {
    number,
    state,
    updated_at: updated,
    closed_at: closed,
    base: { sha: base },
    head: { sha: head, ref, repo: { full_name: repository } },
    user: { login: author },
  };
}

function event({
  run,
  action,
  head,
  before = null,
  runtime = true,
  targets = runtime ? ["ui"] : [],
  updated,
  state = action === "closed" ? "closed" : "open",
  closed = action === "closed" ? updated : null,
  repository = PREVIEW_REPOSITORY,
  author = "trusted-author",
  ref = "feature/preview-controller",
} = {}) {
  const pr = pull({
    head,
    ref,
    repository,
    author,
    state,
    updated,
    closed,
  });
  const snapshot = snapshotPullRequestEvent(
    {
      action,
      before,
      repository: { full_name: PREVIEW_REPOSITORY },
      pull_request: pr,
    },
    run,
  );
  const rawPlan =
    targets.length > 0
      ? {
          deployments: targets,
          base: snapshot.change_base_sha,
          head: snapshot.head_sha,
          reason: "affected-packages",
        }
      : {
          deployments: [],
          base: snapshot.change_base_sha,
          head: snapshot.head_sha,
          reason: "non-runtime-only",
        };
  return validateEventReceipt({
    ...snapshot,
    plan: normalizePlannerResult(rawPlan, snapshot),
  });
}

function eventRecordInputs(receipt) {
  const snapshot = structuredClone(receipt);
  delete snapshot.plan;
  return {
    snapshotRaw: JSON.stringify(snapshot),
    planRaw: JSON.stringify({
      deployments: receipt.plan.targets,
      base: receipt.plan.base,
      head: receipt.plan.head,
      reason: receipt.plan.reason,
    }),
    plannerOutcome: "success",
  };
}

function persistDispatch(reconciled, runId = 8_000) {
  assert.ok(reconciled.nextDispatch, "fixture must have a dispatch");
  return {
    ...structuredClone(reconciled.state),
    targets: {
      ...structuredClone(reconciled.state.targets),
      ui: {
        ...structuredClone(reconciled.state.targets.ui),
        active: {
          ...structuredClone(reconciled.nextDispatch),
          dispatch_started_at: timestamp(0),
          dispatch_state: "dispatched",
          workflow_run_id: runId,
          workflow_sha: reconciled.nextDispatch.expected_workflow_sha,
          workflow_run_attempt: 1,
          run_url: `https://api.github.com/repos/mento-protocol/frontend-monorepo/actions/runs/${runId}`,
          html_url: `https://github.com/mento-protocol/frontend-monorepo/actions/runs/${runId}`,
        },
      },
    },
  };
}

function persistIntent(reconciled) {
  assert.ok(reconciled.nextDispatch, "fixture must have a dispatch");
  return {
    ...structuredClone(reconciled.state),
    targets: {
      ...structuredClone(reconciled.state.targets),
      ui: {
        ...structuredClone(reconciled.state.targets.ui),
        active: {
          ...structuredClone(reconciled.nextDispatch),
          dispatch_started_at: timestamp(0),
          dispatch_state: "intended",
          workflow_run_id: null,
          workflow_sha: null,
          workflow_run_attempt: null,
          run_url: null,
          html_url: null,
        },
      },
    },
  };
}

function persistAllIntents(reconciled) {
  const state = structuredClone(reconciled.state);
  for (const dispatch of reconciled.nextDispatches) {
    state.targets[dispatch.target].active = {
      ...structuredClone(dispatch),
      dispatch_started_at: timestamp(0),
      dispatch_state: "intended",
      workflow_run_id: null,
      workflow_sha: null,
      workflow_run_attempt: null,
      run_url: null,
      html_url: null,
    };
  }
  return state;
}

function result(
  dispatch,
  {
    runId = 8_000,
    state = "success",
    reason = state === "success" ? "verified" : "worker-failure",
    vercelDeploymentUrl = state === "success"
      ? `https://${dispatch.target}-${runId}.vercel.app`
      : null,
  } = {},
) {
  return validateWorkerResult({
    schema: RESULT_RECEIPT_SCHEMA,
    repository: PREVIEW_REPOSITORY,
    pr: dispatch.pr,
    target: dispatch.target,
    sha: dispatch.sha,
    controller_key: dispatch.key,
    key_digest: dispatch.key_digest,
    epoch_anchor_run_id: dispatch.epoch_anchor_run_id,
    reconciliation_basis_digest: dispatch.reconciliation_basis_digest,
    selection_receipt_run_id: dispatch.selection_receipt_run_id,
    expected_workflow_sha: dispatch.expected_workflow_sha,
    worker_run_id: runId,
    worker_run_attempt: 1,
    github_deployment_id: 9_000 + runId,
    state,
    vercel_deployment_id: state === "success" ? `dpl_${runId}` : null,
    next_deployment_id:
      state === "success" ? `m-${dispatch.target}-${runId}` : null,
    vercel_deployment_url: vercelDeploymentUrl,
    smoke_result: state === "success" ? "passed" : "failed",
    terminal_reason: reason,
  });
}

function controllerResult(
  dispatch,
  {
    runId = 7_000,
    reason = "native-owned-selection-without-github-worker",
  } = {},
) {
  return validateWorkerResult({
    schema: RESULT_RECEIPT_SCHEMA,
    repository: PREVIEW_REPOSITORY,
    pr: dispatch.pr,
    target: dispatch.target,
    sha: dispatch.sha,
    controller_key: dispatch.key,
    key_digest: dispatch.key_digest,
    epoch_anchor_run_id: dispatch.epoch_anchor_run_id,
    reconciliation_basis_digest: dispatch.reconciliation_basis_digest,
    selection_receipt_run_id: dispatch.selection_receipt_run_id,
    expected_workflow_sha: dispatch.expected_workflow_sha,
    worker_run_id: runId,
    worker_run_attempt: 1,
    github_deployment_id: null,
    state: "error",
    vercel_deployment_id: null,
    next_deployment_id: null,
    vercel_deployment_url: null,
    smoke_result: "not-run",
    terminal_reason: reason,
  });
}

function reconcile({
  events,
  results = [],
  pullRequest,
  existingState = null,
  selections = [],
  checkpoint = null,
  expectedWorkflowSha = SHA.E,
}) {
  const reconciled = reconcileState({
    events,
    results,
    pullRequest,
    existingState,
    selections,
    checkpoint,
    controllerUrl: CONTROLLER_URL,
    expectedWorkflowSha,
  });
  return {
    ...reconciled,
    nextDispatch:
      reconciled.nextDispatches.find(({ target }) => target === "ui") ?? null,
  };
}

test("trusted snapshot entrypoints emit bounded event and bootstrap outputs", async () => {
  const outputs = new Map();
  const core = {
    setOutput(name, value) {
      outputs.set(name, value);
    },
  };
  const openedPull = pull({ head: SHA.A, updated: timestamp(1) });
  const eventSnapshot = writeEventSnapshotOutputs({
    payload: {
      action: "opened",
      repository: { full_name: PREVIEW_REPOSITORY },
      pull_request: openedPull,
    },
    runId: 1,
    core,
  });
  assert.equal(eventSnapshot.event_action, "opened");
  assert.equal(outputs.get("pr_number"), "519");
  assert.equal(outputs.get("head_sha"), SHA.A);
  assert.equal(outputs.get("plan_required"), "true");
  assert.deepEqual(JSON.parse(outputs.get("snapshot")), eventSnapshot);

  outputs.clear();
  const github = {
    rest: {
      pulls: {
        async get(request) {
          assert.deepEqual(request, {
            owner: "mento-protocol",
            repo: "frontend-monorepo",
            pull_number: 519,
          });
          return { data: openedPull };
        },
      },
    },
  };
  const bootstrapSnapshot = await prepareBootstrap({
    github,
    context: {
      repo: { owner: "mento-protocol", repo: "frontend-monorepo" },
      runId: 2,
    },
    core,
    prNumber: "519",
  });
  assert.equal(bootstrapSnapshot.event_action, "bootstrap");
  assert.equal(outputs.get("trusted_base_sha"), SHA.E);
  assert.equal(outputs.get("change_base_sha"), SHA.E);
  assert.deepEqual(JSON.parse(outputs.get("snapshot")), bootstrapSnapshot);
});

test("repository dispatch accepts only one validated PR number and two operations", () => {
  const outputs = new Map();
  const core = {
    setOutput(name, value) {
      outputs.set(name, value);
    },
  };
  const payload = (action, clientPayload = { pr_number: 519 }) => ({
    action,
    repository: { full_name: PREVIEW_REPOSITORY },
    client_payload: clientPayload,
  });

  for (const [action, operation] of [
    [BOOTSTRAP_DISPATCH_EVENT, "bootstrap"],
    [RECONCILE_DISPATCH_EVENT, "reconcile"],
  ]) {
    outputs.clear();
    assert.deepEqual(
      writeRepositoryDispatchOutputs({ payload: payload(action), core }),
      { operation, pr_number: 519 },
    );
    assert.equal(outputs.get("operation"), operation);
    assert.equal(outputs.get("pr_number"), "519");
  }

  assert.throws(
    () => validateRepositoryDispatch(payload("vercel-preview-unknown")),
    /action is not allowed/,
  );
  assert.throws(
    () =>
      validateRepositoryDispatch(
        payload(BOOTSTRAP_DISPATCH_EVENT, {
          pr_number: 519,
          ref: "feature/attacker-selected-workflow",
        }),
      ),
    /must contain only pr_number/,
  );
  assert.throws(
    () =>
      validateRepositoryDispatch(
        payload(RECONCILE_DISPATCH_EVENT, { pr_number: "0" }),
      ),
    /PR number must be positive/,
  );
  assert.throws(
    () =>
      validateRepositoryDispatch({
        ...payload(BOOTSTRAP_DISPATCH_EVENT),
        repository: { full_name: "fork/frontend-monorepo" },
      }),
    /not the expected repository/,
  );
});

test("receipt schema distinguishes lifecycle fields and synchronize before -> head", () => {
  const opened = event({
    run: 1,
    action: "opened",
    head: SHA.A,
    updated: timestamp(1),
  });
  const synchronized = event({
    run: 2,
    action: "synchronize",
    before: SHA.A,
    head: SHA.B,
    updated: timestamp(2),
  });
  assert.equal(opened.schema, EVENT_RECEIPT_SCHEMA);
  assert.equal(opened.pr_state, "open");
  assert.equal(opened.pr_updated_at, timestamp(1));
  assert.equal(opened.pr_closed_at, null);
  assert.equal(synchronized.change_base_sha, SHA.A);
  assert.equal(synchronized.plan.base, SHA.A);
  assert.equal(synchronized.plan.head, SHA.B);
  assert.equal(synchronized.plan.planner_source_sha, SHA.E);
});

test("v2 is the only internal journal and controller schema while external keys stay v1", () => {
  assert.equal(CONTROLLER_SCHEMA, "vercel-preview-controller:v2");
  assert.equal(EVENT_RECEIPT_SCHEMA, "vercel-preview-event-receipt:v2");
  assert.equal(RESULT_RECEIPT_SCHEMA, "vercel-preview-worker-result:v2");
  assert.equal(SELECTION_RECEIPT_SCHEMA, "vercel-preview-selection:v2");
  assert.equal(PREVIEW_JOURNAL_SCHEMA, "vercel-preview-journal:v2");
  assert.equal(PREVIEW_JOURNAL_MARKER, "<!-- vercel-preview-journal:v2 -->");
  assert.equal(
    controllerKey(519, SHA.A, "reserve"),
    `vercel-preview:v1:pr:519:target:reserve:sha:${SHA.A}`,
  );
  assert.throws(() => controllerKey(519, SHA.A), /target is invalid/);
  assert.throws(
    () =>
      validateEventReceipt({
        ...event({
          run: 9,
          action: "opened",
          head: SHA.A,
          updated: timestamp(1),
        }),
        schema: "vercel-preview-event-receipt:v1",
      }),
    /schema mismatch/,
  );
});

test("planner preserves canonical four-target order and fails closed to all targets", () => {
  const receipt = event({
    run: 10,
    action: "opened",
    head: SHA.A,
    updated: timestamp(1),
    targets: [],
  });
  const snapshot = structuredClone(receipt);
  delete snapshot.plan;
  assert.deepEqual(
    normalizePlannerResult("", snapshot, "failure").targets,
    PREVIEW_TARGETS,
  );
  assert.throws(
    () =>
      normalizePlannerResult(
        {
          deployments: ["ui", "app"],
          base: snapshot.change_base_sha,
          head: snapshot.head_sha,
          reason: "affected-packages",
        },
        snapshot,
      ),
    /malformed or unordered/,
  );
});

test("one affected event selects four independent workers in stable order", () => {
  const opened = event({
    run: 11,
    action: "opened",
    head: SHA.A,
    updated: timestamp(1),
    targets: PREVIEW_TARGETS,
  });
  const reconciled = reconcile({
    events: [opened],
    pullRequest: pull({ head: SHA.A, updated: timestamp(1) }),
  });
  assert.deepEqual(
    reconciled.nextDispatches.map(({ target }) => target),
    PREVIEW_TARGETS,
  );
  assert.deepEqual(reconciled.state.status_decisions[0].targets, {
    app: "pending",
    governance: "pending",
    reserve: "pending",
    ui: "pending",
  });
  for (const target of PREVIEW_TARGETS) {
    assert.equal(reconciled.state.targets[target].first_eligible_sha, SHA.A);
    assert.equal(reconciled.state.targets[target].latest_desired_sha, SHA.A);
  }
});

test("one target completion advances independently while other workers remain active", () => {
  const opened = event({
    run: 12,
    action: "opened",
    head: SHA.A,
    updated: timestamp(1),
    targets: PREVIEW_TARGETS,
  });
  const appUpdate = event({
    run: 13,
    action: "synchronize",
    before: SHA.A,
    head: SHA.B,
    updated: timestamp(2),
    targets: ["app"],
  });
  const initial = reconcile({
    events: [opened, appUpdate],
    pullRequest: pull({ head: SHA.B, updated: timestamp(2) }),
  });
  const persisted = persistAllIntents(initial);
  const selections = PREVIEW_TARGETS.map((target) =>
    selectionReceiptFromDispatch(persisted.targets[target].active),
  );
  const appDispatch = initial.nextDispatches.find(
    ({ target }) => target === "app",
  );
  const advanced = reconcile({
    events: [opened, appUpdate],
    results: [result(appDispatch, { runId: 8_012 })],
    selections,
    pullRequest: pull({ head: SHA.B, updated: timestamp(2) }),
    existingState: persisted,
  });
  assert.deepEqual(
    advanced.nextDispatches.map(({ target, sha }) => [target, sha]),
    [["app", SHA.B]],
  );
  for (const target of ["governance", "reserve", "ui"]) {
    assert.equal(advanced.state.targets[target].active.sha, SHA.A);
  }
  assert.equal(advanced.state.status_decisions.at(-1).targets.app, "pending");
});

test("base retarget edits snapshot the new trusted base and reject unrelated edits", () => {
  const retargetedPull = pull({
    head: SHA.A,
    base: SHA.D,
    updated: timestamp(2),
  });
  const snapshot = snapshotPullRequestEvent(
    {
      action: "edited",
      changes: { base: { ref: { from: "main" } } },
      repository: { full_name: PREVIEW_REPOSITORY },
      pull_request: retargetedPull,
    },
    3,
  );
  const receipt = validateEventReceipt({
    ...snapshot,
    plan: normalizePlannerResult(
      {
        deployments: ["ui"],
        base: SHA.D,
        head: SHA.A,
        reason: "affected-packages",
      },
      snapshot,
    ),
  });
  assert.equal(receipt.event_action, "edited");
  assert.equal(receipt.trusted_base_sha, SHA.D);
  assert.equal(receipt.change_base_sha, SHA.D);
  assert.equal(receipt.before_sha, null);

  assert.throws(
    () =>
      snapshotPullRequestEvent(
        {
          action: "edited",
          changes: { title: { from: "old title" } },
          repository: { full_name: PREVIEW_REPOSITORY },
          pull_request: retargetedPull,
        },
        4,
      ),
    /Edited PR base change/,
  );
});

test("base retarget starts a new same-head epoch and replans its runtime impact", () => {
  const opened = event({
    run: 5,
    action: "opened",
    head: SHA.A,
    runtime: false,
    updated: timestamp(1),
  });
  const initial = reconcile({
    events: [opened],
    pullRequest: pull({ head: SHA.A, updated: timestamp(1) }),
  });
  assert.equal(initial.nextDispatch, null);
  assert.match(initial.state.status_decisions[0].description, /ui=none/);

  const editedSnapshot = snapshotPullRequestEvent(
    {
      action: "edited",
      changes: { base: { ref: { from: "main" } } },
      repository: { full_name: PREVIEW_REPOSITORY },
      pull_request: pull({
        head: SHA.A,
        base: SHA.D,
        updated: timestamp(2),
      }),
    },
    6,
  );
  const edited = validateEventReceipt({
    ...editedSnapshot,
    plan: normalizePlannerResult(
      {
        deployments: ["ui"],
        base: SHA.D,
        head: SHA.A,
        reason: "affected-packages",
      },
      editedSnapshot,
    ),
  });
  const retargeted = reconcile({
    events: [opened, edited],
    pullRequest: pull({
      head: SHA.A,
      base: SHA.D,
      updated: timestamp(2),
    }),
    existingState: initial.state,
  });
  assert.equal(retargeted.state.epoch.anchor_run_id, 6);
  assert.equal(retargeted.nextDispatch.selection_receipt_run_id, 6);
  assert.equal(retargeted.nextDispatch.sha, SHA.A);
  assert.equal(retargeted.state.status_decisions.at(-1).state, "pending");
});

test("bootstrap aliases an existing identical lifecycle anchor", () => {
  const opened = event({
    run: 7,
    action: "opened",
    head: SHA.A,
    updated: timestamp(1),
  });
  const bootstrap = validateEventReceipt({
    ...structuredClone(opened),
    event_run_id: 8,
    event_action: "bootstrap",
  });
  const reconciled = reconcile({
    events: [bootstrap, opened],
    pullRequest: pull({ head: SHA.A, updated: timestamp(1) }),
  });
  assert.equal(reconciled.state.epoch.anchor_run_id, 7);
  assert.equal(reconciled.nextDispatch.selection_receipt_run_id, 7);
  assert.deepEqual(
    reconciled.lineage.map((receipt) => receipt.event_run_id),
    [7],
  );
});

test("synchronize can reconcile before opened without changing lineage order", () => {
  const opened = event({
    run: 10,
    action: "opened",
    head: SHA.A,
    updated: timestamp(1),
  });
  const synchronized = event({
    run: 11,
    action: "synchronize",
    before: SHA.A,
    head: SHA.B,
    updated: timestamp(2),
  });
  assert.throws(
    () =>
      reconcile({
        events: [synchronized],
        pullRequest: pull({ head: SHA.B, updated: timestamp(2) }),
      }),
    /anchor receipt/,
  );
  const ordered = reconcile({
    events: [synchronized, opened],
    pullRequest: pull({ head: SHA.B, updated: timestamp(2) }),
  });
  assert.deepEqual(
    ordered.lineage.map(({ head_sha }) => head_sha),
    [SHA.A, SHA.B],
  );
  assert.equal(ordered.nextDispatch.sha, SHA.A);
  assert.equal(ordered.state.targets.ui.latest_desired_sha, SHA.B);
});

test("first active survives a burst and terminal completion advances newest only", () => {
  const events = [
    event({ run: 20, action: "opened", head: SHA.A, updated: timestamp(1) }),
    event({
      run: 21,
      action: "synchronize",
      before: SHA.A,
      head: SHA.B,
      updated: timestamp(2),
    }),
    event({
      run: 22,
      action: "synchronize",
      before: SHA.B,
      head: SHA.C,
      updated: timestamp(3),
    }),
  ];
  const first = reconcile({
    events,
    pullRequest: pull({ head: SHA.C, updated: timestamp(3) }),
  });
  assert.equal(first.nextDispatch.sha, SHA.A);
  assert.equal(first.state.targets.ui.latest_desired_sha, SHA.C);
  const activeState = persistDispatch(first);
  const whileActive = reconcile({
    events,
    pullRequest: pull({ head: SHA.C, updated: timestamp(3) }),
    existingState: activeState,
  });
  assert.equal(whileActive.nextDispatch, null);
  assert.equal(whileActive.state.targets.ui.active.sha, SHA.A);
  const completed = reconcile({
    events,
    results: [result(first.nextDispatch)],
    pullRequest: pull({ head: SHA.C, updated: timestamp(3) }),
    existingState: activeState,
  });
  assert.equal(completed.nextDispatch.sha, SHA.C);
  assert.notEqual(completed.nextDispatch.sha, SHA.B);
});

test("a fresh idle burst selects its first SHA and retains only latest", () => {
  const opened = event({
    run: 30,
    action: "opened",
    head: SHA.A,
    updated: timestamp(1),
  });
  const first = reconcile({
    events: [opened],
    pullRequest: pull({ head: SHA.A, updated: timestamp(1) }),
  });
  const active = persistDispatch(first, 8_030);
  const idle = reconcile({
    events: [opened],
    results: [result(first.nextDispatch, { runId: 8_030 })],
    pullRequest: pull({ head: SHA.A, updated: timestamp(1) }),
    existingState: active,
  });
  assert.equal(idle.nextDispatch, null);
  assert.equal(idle.state.targets.ui.idle_cursor_receipt_run_id, 30);

  const runtimeB = event({
    run: 31,
    action: "synchronize",
    before: SHA.A,
    head: SHA.B,
    updated: timestamp(2),
  });
  const runtimeC = event({
    run: 32,
    action: "synchronize",
    before: SHA.B,
    head: SHA.C,
    updated: timestamp(3),
  });
  const burst = reconcile({
    events: [opened, runtimeC, runtimeB],
    results: [result(first.nextDispatch, { runId: 8_030 })],
    pullRequest: pull({ head: SHA.C, updated: timestamp(3) }),
    existingState: idle.state,
  });
  assert.equal(burst.nextDispatch.sha, SHA.B);
  assert.equal(burst.state.targets.ui.latest_desired_sha, SHA.C);
});

test("docs-only states never dispatch and reuse the last verified runtime", () => {
  const docsA = event({
    run: 40,
    action: "opened",
    head: SHA.A,
    runtime: false,
    updated: timestamp(1),
  });
  const noRuntime = reconcile({
    events: [docsA],
    pullRequest: pull({ head: SHA.A, updated: timestamp(1) }),
  });
  assert.equal(noRuntime.nextDispatch, null);
  assert.equal(noRuntime.state.status_decisions[0].state, "success");
  assert.match(noRuntime.state.status_decisions[0].description, /ui=none/);

  const runtimeB = event({
    run: 41,
    action: "synchronize",
    before: SHA.A,
    head: SHA.B,
    updated: timestamp(2),
  });
  const docsC = event({
    run: 42,
    action: "synchronize",
    before: SHA.B,
    head: SHA.C,
    runtime: false,
    updated: timestamp(3),
  });
  const selected = reconcile({
    events: [docsA, runtimeB, docsC],
    pullRequest: pull({ head: SHA.C, updated: timestamp(3) }),
  });
  assert.equal(selected.nextDispatch.sha, SHA.B);
  const active = persistDispatch(selected, 8_041);
  const pending = reconcile({
    events: [docsA, runtimeB, docsC],
    pullRequest: pull({ head: SHA.C, updated: timestamp(3) }),
    existingState: active,
  });
  assert.equal(pending.state.status_decisions.at(-1).state, "pending");
  const completed = reconcile({
    events: [docsA, runtimeB, docsC],
    results: [result(selected.nextDispatch, { runId: 8_041 })],
    pullRequest: pull({ head: SHA.C, updated: timestamp(3) }),
    existingState: active,
  });
  const docsStatus = completed.state.status_decisions.at(-1);
  assert.equal(docsStatus.state, "success");
  assert.match(docsStatus.description, /ui=equivalent/);

  const failed = reconcile({
    events: [docsA, runtimeB, docsC],
    results: [
      result(selected.nextDispatch, {
        runId: 8_041,
        state: "failure",
        reason: "build-failed-final",
      }),
    ],
    pullRequest: pull({ head: SHA.C, updated: timestamp(3) }),
    existingState: active,
  });
  const failedDocsStatus = failed.state.status_decisions.at(-1);
  assert.equal(failed.nextDispatch, null);
  assert.equal(failedDocsStatus.state, "failure");
  assert.equal(failedDocsStatus.targets.ui, "failed");

  const cancelled = reconcile({
    events: [docsA, runtimeB, docsC],
    results: [
      result(selected.nextDispatch, {
        runId: 8_041,
        state: "error",
        reason: "worker-cancelled",
      }),
    ],
    pullRequest: pull({ head: SHA.C, updated: timestamp(3) }),
    existingState: active,
  });
  const cancelledDocsStatus = cancelled.state.status_decisions.at(-1);
  assert.equal(cancelledDocsStatus.state, "failure");
  assert.equal(cancelledDocsStatus.targets.ui, "failed");
});

test("coalescing needs an immutable later selection receipt", () => {
  const events = [
    event({ run: 50, action: "opened", head: SHA.A, updated: timestamp(1) }),
    event({
      run: 51,
      action: "synchronize",
      before: SHA.A,
      head: SHA.B,
      updated: timestamp(2),
    }),
    event({
      run: 52,
      action: "synchronize",
      before: SHA.B,
      head: SHA.C,
      updated: timestamp(3),
    }),
  ];
  const first = reconcile({
    events,
    pullRequest: pull({ head: SHA.C, updated: timestamp(3) }),
  });
  const activeA = persistDispatch(first, 8_050);
  const afterA = reconcile({
    events,
    results: [result(first.nextDispatch, { runId: 8_050 })],
    pullRequest: pull({ head: SHA.C, updated: timestamp(3) }),
    existingState: activeA,
  });
  const intendedC = persistIntent(afterA);
  const withoutProof = reconcile({
    events,
    results: [result(first.nextDispatch, { runId: 8_050 })],
    pullRequest: pull({ head: SHA.C, updated: timestamp(3) }),
    existingState: intendedC,
  });
  assert.equal(withoutProof.state.status_decisions[1].state, "pending");
  const coalescingProof = selectionReceiptFromDispatch(
    intendedC.targets.ui.active,
  );
  assert.deepEqual(coalescingProof.coalesced_receipt_run_ids, [51]);
  const withProof = reconcile({
    events,
    results: [result(first.nextDispatch, { runId: 8_050 })],
    pullRequest: pull({ head: SHA.C, updated: timestamp(3) }),
    existingState: intendedC,
    selections: [coalescingProof],
  });
  assert.equal(withProof.state.status_decisions[1].state, "success");
  assert.match(withProof.state.status_decisions[1].description, /ui=coalesced/);
});

test("more than 25 pushes converge from first preview to latest with compact proof", () => {
  const shas = Array.from({ length: 31 }, (_, index) =>
    (index + 16).toString(16).padStart(40, "0"),
  );
  const events = [
    event({
      run: 500,
      action: "opened",
      head: shas[0],
      updated: timestamp(1),
    }),
  ];
  for (let index = 1; index < shas.length; index += 1) {
    events.push(
      event({
        run: 500 + index,
        action: "synchronize",
        before: shas[index - 1],
        head: shas[index],
        updated: timestamp(index + 1),
      }),
    );
  }
  const pullRequest = pull({
    head: shas.at(-1),
    updated: timestamp(shas.length),
  });
  const first = reconcile({ events, pullRequest });
  assert.equal(first.nextDispatch.sha, shas[0]);
  const active = persistDispatch(first, 8_500);
  const latest = reconcile({
    events,
    results: [result(first.nextDispatch, { runId: 8_500 })],
    pullRequest,
    existingState: active,
  });
  assert.equal(latest.nextDispatch.sha, shas.at(-1));
  assert.equal(latest.nextDispatch.coalesced_receipt_run_ids.length, 29);
  const intendedLatest = persistIntent(latest);
  const proof = selectionReceiptFromDispatch(intendedLatest.targets.ui.active);
  assert.equal(proof.schema, SELECTION_RECEIPT_SCHEMA);
  const converged = reconcile({
    events,
    results: [result(first.nextDispatch, { runId: 8_500 })],
    selections: [proof],
    pullRequest,
    existingState: intendedLatest,
  });
  assert.equal(
    converged.state.status_decisions.filter(
      ({ targets }) => targets.ui === "coalesced",
    ).length,
    29,
  );
  assert.equal(converged.state.status_decisions.at(-1).state, "pending");
});

test("close and same-SHA reopen form distinct epochs; old result cannot advance", () => {
  const opened = event({
    run: 60,
    action: "opened",
    head: SHA.A,
    updated: timestamp(1),
  });
  const first = reconcile({
    events: [opened],
    pullRequest: pull({ head: SHA.A, updated: timestamp(1) }),
  });
  const activeOld = persistDispatch(first, 8_060);
  const closed = event({
    run: 61,
    action: "closed",
    head: SHA.A,
    updated: timestamp(2),
  });
  const closedState = reconcile({
    events: [opened, closed],
    pullRequest: pull({
      head: SHA.A,
      state: "closed",
      updated: timestamp(2),
      closed: timestamp(2),
    }),
    existingState: activeOld,
  });
  assert.equal(closedState.state.closed, true);
  assert.equal(closedState.nextDispatch, null);

  const reopened = event({
    run: 62,
    action: "reopened",
    head: SHA.A,
    updated: timestamp(3),
  });
  const current = reconcile({
    events: [closed, reopened, opened],
    results: [result(first.nextDispatch, { runId: 8_060 })],
    pullRequest: pull({ head: SHA.A, updated: timestamp(3) }),
    existingState: closedState.state,
  });
  assert.equal(current.state.epoch.anchor_run_id, 62);
  assert.equal(current.nextDispatch.sha, SHA.A);
  assert.equal(current.nextDispatch.epoch_anchor_run_id, 62);
  assert.notEqual(
    current.nextDispatch.key_digest,
    first.nextDispatch.key_digest,
  );
});

test("transition instances survive a force-reset SHA revisit", () => {
  const openedA = event({
    run: 70,
    action: "opened",
    head: SHA.A,
    updated: timestamp(1),
  });
  const toB = event({
    run: 71,
    action: "synchronize",
    before: SHA.A,
    head: SHA.B,
    updated: timestamp(2),
  });
  const resetA = event({
    run: 72,
    action: "synchronize",
    before: SHA.B,
    head: SHA.A,
    updated: timestamp(3),
  });
  const state = reconcile({
    events: [resetA, openedA, toB],
    pullRequest: pull({ head: SHA.A, updated: timestamp(3) }),
  });
  assert.deepEqual(
    state.lineage.map(({ event_run_id, head_sha }) => [event_run_id, head_sha]),
    [
      [70, SHA.A],
      [71, SHA.B],
      [72, SHA.A],
    ],
  );
  assert.equal(state.nextDispatch.selection_receipt_run_id, 70);
  assert.equal(state.state.targets.ui.latest_desired_receipt_run_id, 72);
});

test("ambiguous repeated transitions fail closed without inferring scheduler order", () => {
  const openedA = event({
    run: 74,
    action: "opened",
    head: SHA.A,
    updated: timestamp(1),
  });
  const firstB = event({
    run: 75,
    action: "synchronize",
    before: SHA.A,
    head: SHA.B,
    updated: timestamp(2),
  });
  const resetA = event({
    run: 76,
    action: "synchronize",
    before: SHA.B,
    head: SHA.A,
    updated: timestamp(3),
  });
  const secondB = event({
    run: 77,
    action: "synchronize",
    before: SHA.A,
    head: SHA.B,
    updated: timestamp(4),
  });
  assert.throws(
    () =>
      reconcile({
        events: [secondB, openedA, resetA, firstB],
        pullRequest: pull({ head: SHA.B, updated: timestamp(4) }),
      }),
    /Ambiguous event lineage/,
  );
});

test("semantic duplicates collapse but conflicting immutable run IDs fail closed", () => {
  const opened = event({
    run: 80,
    action: "opened",
    head: SHA.A,
    updated: timestamp(1),
  });
  const duplicate = { ...structuredClone(opened), event_run_id: 81 };
  const state = reconcile({
    events: [duplicate, opened],
    pullRequest: pull({ head: SHA.A, updated: timestamp(1) }),
  });
  assert.equal(state.lineage.length, 1);
  assert.equal(state.nextDispatch.selection_receipt_run_id, 80);
  const conflicting = structuredClone(opened);
  conflicting.head_sha = SHA.B;
  conflicting.plan.head = SHA.B;
  assert.throws(
    () =>
      reconcile({
        events: [opened, conflicting],
        pullRequest: pull({ head: SHA.A, updated: timestamp(1) }),
      }),
    /conflicting immutable receipts/,
  );
});

test("a delayed lower-run duplicate preserves the persisted opened epoch anchor", () => {
  const opened = event({
    run: 81,
    action: "opened",
    head: SHA.A,
    runtime: false,
    updated: timestamp(1),
  });
  const initial = reconcile({
    events: [opened],
    pullRequest: pull({ head: SHA.A, updated: timestamp(1) }),
  });
  const delayedDuplicate = { ...structuredClone(opened), event_run_id: 80 };
  const current = reconcile({
    events: [delayedDuplicate, opened],
    pullRequest: pull({ head: SHA.A, updated: timestamp(1) }),
    existingState: initial.state,
  });
  assert.equal(current.lineage.length, 1);
  assert.equal(current.state.epoch.anchor_run_id, 81);
  assert.equal(current.lineage[0].event_run_id, 81);
  assert.equal(current.nextDispatch, null);
});

test("a delayed lower-run duplicate preserves the persisted active selection receipt", () => {
  const opened = event({
    run: 70,
    action: "opened",
    head: SHA.A,
    runtime: false,
    updated: timestamp(1),
  });
  const selected = event({
    run: 81,
    action: "synchronize",
    before: SHA.A,
    head: SHA.B,
    updated: timestamp(2),
  });
  const initial = reconcile({
    events: [opened, selected],
    pullRequest: pull({ head: SHA.B, updated: timestamp(2) }),
  });
  assert.equal(initial.nextDispatch.selection_receipt_run_id, 81);
  const active = persistDispatch(initial);
  const delayedDuplicate = { ...structuredClone(selected), event_run_id: 80 };
  const current = reconcile({
    events: [delayedDuplicate, selected, opened],
    pullRequest: pull({ head: SHA.B, updated: timestamp(2) }),
    existingState: active,
  });
  assert.equal(current.lineage.length, 2);
  assert.equal(current.state.epoch.anchor_run_id, 70);
  assert.equal(current.lineage[1].event_run_id, 81);
  assert.equal(current.state.targets.ui.active.selection_receipt_run_id, 81);
  assert.equal(
    current.state.targets.ui.active.key_digest,
    active.targets.ui.active.key_digest,
  );
  assert.equal(current.state.targets.ui.active.workflow_run_id, 8_000);
  assert.equal(current.nextDispatch, null);
});

test("semantic aliases with conflicting persisted representatives fail closed", () => {
  const opened = event({
    run: 70,
    action: "opened",
    head: SHA.A,
    runtime: false,
    updated: timestamp(1),
  });
  const selected = event({
    run: 81,
    action: "synchronize",
    before: SHA.A,
    head: SHA.B,
    updated: timestamp(2),
  });
  const delayedDuplicate = { ...structuredClone(selected), event_run_id: 80 };
  const initial = reconcile({
    events: [opened, selected],
    pullRequest: pull({ head: SHA.B, updated: timestamp(2) }),
  });
  const conflicting = persistDispatch(initial);
  conflicting.targets.ui.latest_desired_receipt_run_id = 80;
  assert.throws(
    () =>
      reconcile({
        events: [opened, selected, delayedDuplicate],
        pullRequest: pull({ head: SHA.B, updated: timestamp(2) }),
        existingState: conflicting,
      }),
    /conflicting persisted ownership/,
  );
});

test("fork and Dependabot events succeed unsupported without dispatch", () => {
  for (const unsupported of [
    event({
      run: 90,
      action: "opened",
      head: SHA.A,
      updated: timestamp(1),
      repository: "someone/fork",
    }),
    event({
      run: 91,
      action: "opened",
      head: SHA.A,
      updated: timestamp(1),
      author: "dependabot[bot]",
      ref: "dependabot/npm/pnpm",
    }),
  ]) {
    const state = reconcile({
      events: [unsupported],
      pullRequest: pull({
        head: SHA.A,
        updated: timestamp(1),
        repository: unsupported.head_repository,
        author: unsupported.pr_author,
        ref: unsupported.head_ref,
      }),
    });
    assert.equal(state.nextDispatch, null);
    assert.equal(state.state.status_decisions[0].state, "success");
    assert.match(state.state.status_decisions[0].description, /unsupported/i);
  }
});

test("controller and prebuilt worker agree that refs/* head names are unsupported", () => {
  assert.throws(() => validateGitBranch("refs/foo"), /option-like/);
  const unsupported = event({
    run: 92,
    action: "opened",
    head: SHA.A,
    updated: timestamp(1),
    ref: "refs/foo",
  });
  assert.equal(unsupported.trust, "unsupported-ref");
  assert.deepEqual(unsupported.plan.targets, []);
  const reconciled = reconcile({
    events: [unsupported],
    pullRequest: pull({
      head: SHA.A,
      updated: timestamp(1),
      ref: "refs/foo",
    }),
  });
  assert.equal(reconciled.nextDispatch, null);
  assert.equal(reconciled.state.status_decisions[0].state, "success");
  assert.match(
    reconciled.state.status_decisions[0].description,
    /unsupported/i,
  );
});

test("current-epoch results must be bound to persisted active selection", () => {
  const opened = event({
    run: 100,
    action: "opened",
    head: SHA.A,
    updated: timestamp(1),
  });
  const selected = reconcile({
    events: [opened],
    pullRequest: pull({ head: SHA.A, updated: timestamp(1) }),
  });
  assert.throws(
    () =>
      reconcile({
        events: [opened],
        results: [result(selected.nextDispatch, { runId: 8_100 })],
        pullRequest: pull({ head: SHA.A, updated: timestamp(1) }),
      }),
    /without persisted epoch ownership/,
  );
});

test("controller state schema is explicit and bounded", () => {
  const opened = event({
    run: 110,
    action: "opened",
    head: SHA.A,
    updated: timestamp(1),
  });
  const state = reconcile({
    events: [opened],
    pullRequest: pull({ head: SHA.A, updated: timestamp(1) }),
  });
  assert.equal(state.nextDispatch.expected_workflow_sha, SHA.E);
  assert.match(state.nextDispatch.key_digest, /^[0-9a-f]{24}$/);
  const persisted = persistDispatch(state);
  assert.deepEqual(persisted.targets.ui.terminal_result_key_digests, []);
  assert.equal(persisted.targets.ui.active.expected_workflow_sha, SHA.E);
  assert.equal(persisted.targets.ui.active.workflow_sha, SHA.E);
  const missingStateWorkflowSha = structuredClone(persisted);
  delete missingStateWorkflowSha.targets.ui.active.expected_workflow_sha;
  assert.throws(
    () =>
      reconcile({
        events: [opened],
        pullRequest: pull({ head: SHA.A, updated: timestamp(1) }),
        existingState: missingStateWorkflowSha,
      }),
    /expected workflow SHA/,
  );
  const missingTerminalOwnership = structuredClone(persisted);
  delete missingTerminalOwnership.targets.ui.terminal_result_key_digests;
  assert.throws(
    () =>
      reconcile({
        events: [opened],
        pullRequest: pull({ head: SHA.A, updated: timestamp(1) }),
        existingState: missingTerminalOwnership,
      }),
    /ui terminal result ownership/,
  );
  for (const malformedOwnership of [
    null,
    ["not-a-key-digest"],
    [
      persisted.targets.ui.active.key_digest,
      persisted.targets.ui.active.key_digest,
    ],
  ]) {
    const malformedState = structuredClone(persisted);
    malformedState.targets.ui.terminal_result_key_digests = malformedOwnership;
    assert.throws(
      () =>
        reconcile({
          events: [opened],
          pullRequest: pull({ head: SHA.A, updated: timestamp(1) }),
          existingState: malformedState,
        }),
      /ui terminal result ownership/,
    );
  }
  const validResult = result(state.nextDispatch);
  const missingWorkflowSha = structuredClone(validResult);
  delete missingWorkflowSha.expected_workflow_sha;
  assert.throws(
    () => validateWorkerResult(missingWorkflowSha),
    /expected workflow SHA/,
  );
  const stateValue = state.state;
  assert.equal(stateValue.schema, CONTROLLER_SCHEMA);
  assert.match(stateValue.receipts_digest, /^[0-9a-f]{64}$/);
  assert.match(stateValue.epoch.basis_digest, /^[0-9a-f]{64}$/);
  assert.ok(JSON.stringify(stateValue).length < 20_000);
});

test("compact terminal ownership survives more results than rendered history", () => {
  const events = [];
  const results = [];
  let existingState = null;
  let priorSha = null;
  let currentPull;

  for (let index = 0; index < 41; index += 1) {
    const head = (index + 10).toString(16).padStart(40, "0");
    const receipt = event({
      run: 500 + index,
      action: index === 0 ? "opened" : "synchronize",
      head,
      before: priorSha,
      updated: timestamp(index + 1),
    });
    events.push(receipt);
    currentPull = pull({ head, updated: timestamp(index + 1) });
    const selected = reconcile({
      events,
      results,
      pullRequest: currentPull,
      existingState,
    });
    assert.equal(selected.nextDispatch.selection_receipt_run_id, 500 + index);
    const runId = 20_000 + index;
    const active = persistDispatch(selected, runId);
    results.push(result(selected.nextDispatch, { runId }));
    existingState = reconcile({
      events,
      results,
      pullRequest: currentPull,
      existingState: active,
    }).state;
    priorSha = head;
  }

  assert.equal(existingState.targets.ui.terminal_history.length, 40);
  assert.equal(existingState.targets.ui.terminal_result_key_digests.length, 41);
  assert.doesNotThrow(() =>
    reconcile({
      events,
      results,
      pullRequest: currentPull,
      existingState,
    }),
  );
});

test("terminal checkpoints bound one journal across fifty sequential previews", () => {
  let journal = null;
  let priorSha = null;
  let maximumBytes = 0;

  for (let index = 0; index < 50; index += 1) {
    if (journal) journal = compactPreviewJournal(journal);
    const head = (index + 100).toString(16).padStart(40, "0");
    const receipt = event({
      run: 1_000 + index,
      action: index === 0 ? "opened" : "synchronize",
      head,
      before: priorSha,
      updated: timestamp(index + 1),
    });
    const events = [...(journal?.receipts.events ?? []), receipt];
    const currentPull = pull({ head, updated: timestamp(index + 1) });
    const selected = reconcile({
      events,
      pullRequest: currentPull,
      existingState: journal?.state ?? null,
      checkpoint: journal?.checkpoint ?? null,
    });
    assert.equal(selected.nextDispatch.selection_receipt_run_id, 1_000 + index);
    const active = persistDispatch(selected, 30_000 + index);
    const selection = selectionReceiptFromDispatch(active.targets.ui.active);
    const terminal = result(selected.nextDispatch, { runId: 30_000 + index });
    const completed = reconcile({
      events,
      results: [terminal],
      selections: [selection],
      pullRequest: currentPull,
      existingState: active,
      checkpoint: journal?.checkpoint ?? null,
    });
    journal = createPreviewJournal({
      pr: 519,
      checkpoint: journal?.checkpoint ?? null,
      events,
      selections: [selection],
      results: [terminal],
      state: completed.state,
    });
    maximumBytes = Math.max(
      maximumBytes,
      Buffer.byteLength(previewJournalBody(journal), "utf8"),
    );
    priorSha = head;
  }

  assert.equal(journal.checkpoint.sequence, 49);
  assert.deepEqual(journal.checkpoint.pruned_receipt_counts, {
    events: 49,
    selections: 49,
    worker_evidence: 0,
    results: 49,
  });
  assert.ok(maximumBytes < 16_000, `maximum journal size was ${maximumBytes}`);

  const compacted = compactPreviewJournal(journal);
  const docsHead = "f".repeat(40);
  const docsEvent = event({
    run: 1_050,
    action: "synchronize",
    head: docsHead,
    before: priorSha,
    runtime: false,
    updated: timestamp(51),
  });
  const docsState = reconcile({
    events: [docsEvent],
    pullRequest: pull({ head: docsHead, updated: timestamp(51) }),
    existingState: compacted.state,
    checkpoint: compacted.checkpoint,
  });
  assert.equal(docsState.nextDispatch, null);
  assert.match(
    docsState.state.status_decisions.at(-1).description,
    /ui=equivalent/,
  );

  const delayedEvent = event({
    run: 1_051,
    action: "synchronize",
    head: SHA.A,
    before: SHA.B,
    updated: timestamp(2),
  });
  const delayedState = reconcile({
    events: [delayedEvent],
    pullRequest: pull({ head: priorSha, updated: timestamp(50) }),
    existingState: compacted.state,
    checkpoint: compacted.checkpoint,
  });
  const foldedDelayedReceipt = compactPreviewJournal(
    createPreviewJournal({
      pr: 519,
      checkpoint: compacted.checkpoint,
      events: [delayedEvent],
      state: delayedState.state,
    }),
  );
  assert.equal(
    foldedDelayedReceipt.checkpoint.through_event_run_id,
    compacted.checkpoint.through_event_run_id,
  );
  assert.equal(
    foldedDelayedReceipt.checkpoint.pruned_receipt_counts.events,
    51,
  );
  assert.deepEqual(foldedDelayedReceipt.receipts.events, []);
});

test("capacity checkpoints keep a long overlapping push burst recoverable", () => {
  const openedHead = (100).toString(16).padStart(40, "0");
  const opened = event({
    run: 1_700,
    action: "opened",
    head: openedHead,
    updated: timestamp(1),
  });
  let currentPull = pull({ head: openedHead, updated: timestamp(1) });
  const first = reconcile({ events: [opened], pullRequest: currentPull });
  let state = persistDispatch(first, 40_000);
  let journal = createPreviewJournal({
    pr: 519,
    events: [opened],
    selections: [selectionReceiptFromDispatch(state.targets.ui.active)],
    state,
  });
  let priorHead = openedHead;
  let maximumBytes = Buffer.byteLength(previewJournalBody(journal), "utf8");
  let additionalDispatches = 0;

  for (let index = 1; index < 50; index += 1) {
    journal = compactPreviewJournal(journal, { pullRequest: currentPull });
    const head = (100 + index).toString(16).padStart(40, "0");
    const receipt = event({
      run: 1_700 + index,
      action: "synchronize",
      before: priorHead,
      head,
      updated: timestamp(index + 1),
    });
    const events = [...journal.receipts.events, receipt];
    currentPull = pull({ head, updated: timestamp(index + 1) });
    const reconciled = reconcile({
      events,
      results: journal.receipts.results,
      selections: journal.receipts.selections,
      pullRequest: currentPull,
      existingState: journal.state,
      checkpoint: journal.checkpoint,
    });
    state = reconciled.state;
    const selections = [...journal.receipts.selections];
    if (reconciled.nextDispatch) {
      additionalDispatches += 1;
      state = persistDispatch(reconciled, 40_000 + index);
      selections.push(selectionReceiptFromDispatch(state.targets.ui.active));
    }
    journal = createPreviewJournal({
      pr: 519,
      checkpoint: journal.checkpoint,
      events,
      selections,
      workerEvidence: journal.receipts.worker_evidence,
      results: journal.receipts.results,
      state,
    });
    maximumBytes = Math.max(
      maximumBytes,
      Buffer.byteLength(previewJournalBody(journal), "utf8"),
    );
    priorHead = head;
  }

  assert.ok(journal.checkpoint.sequence >= 1);
  assert.equal(additionalDispatches, 0);
  assert.ok(journal.receipts.events.length < 50);
  assert.equal(journal.state.targets.ui.latest_desired_sha, priorHead);
  assert.ok(maximumBytes < 60_000, `maximum journal size was ${maximumBytes}`);
  assert.equal(
    journal.receipts.selections.length,
    Number(journal.state.targets.ui.active !== null) +
      journal.state.targets.ui.retired_active.length,
  );
  assert.equal(journal.checkpoint.targets.ui.status.state, "pending");

  const docsHead = (150).toString(16).padStart(40, "0");
  const docsReceipt = event({
    run: 1_750,
    action: "synchronize",
    before: priorHead,
    head: docsHead,
    runtime: false,
    updated: timestamp(51),
  });
  const docsState = reconcile({
    events: [...journal.receipts.events, docsReceipt],
    results: journal.receipts.results,
    selections: journal.receipts.selections,
    pullRequest: pull({ head: docsHead, updated: timestamp(51) }),
    existingState: journal.state,
    checkpoint: journal.checkpoint,
  });
  assert.equal(docsState.state.status_decisions.at(-1).state, "pending");
  assert.match(
    docsState.state.status_decisions.at(-1).description,
    /ui=pending/,
  );
});

test("capacity checkpoints preserve the newest queued runtime before reconciliation", () => {
  const openedHead = (200).toString(16).padStart(40, "0");
  const opened = event({
    run: 1_800,
    action: "opened",
    head: openedHead,
    updated: timestamp(1),
  });
  let currentPull = pull({ head: openedHead, updated: timestamp(1) });
  const first = reconcile({ events: [opened], pullRequest: currentPull });
  const active = persistDispatch(first, 41_000);
  const selection = selectionReceiptFromDispatch(active.targets.ui.active);
  let journal = createPreviewJournal({
    pr: 519,
    events: [opened],
    selections: [selection],
    state: active,
  });
  let priorHead = openedHead;

  for (let index = 1; index < 48; index += 1) {
    journal = compactPreviewJournal(journal, { pullRequest: currentPull });
    const head = (200 + index).toString(16).padStart(40, "0");
    const receipt = event({
      run: 1_800 + index,
      action: "synchronize",
      before: priorHead,
      head,
      updated: timestamp(index + 1),
    });
    currentPull = pull({ head, updated: timestamp(index + 1) });
    journal = createPreviewJournal({
      pr: 519,
      checkpoint: journal.checkpoint,
      events: [...journal.receipts.events, receipt],
      selections: journal.receipts.selections,
      workerEvidence: journal.receipts.worker_evidence,
      results: journal.receipts.results,
      state: journal.state,
    });
    priorHead = head;
  }

  assert.ok(journal.checkpoint);
  assert.equal(
    journal.checkpoint.targets.ui.pending_owner_key_digest,
    active.targets.ui.active.key_digest,
  );
  assert.ok(Buffer.byteLength(previewJournalBody(journal), "utf8") < 60_000);
  const waiting = reconcile({
    events: journal.receipts.events,
    results: journal.receipts.results,
    selections: journal.receipts.selections,
    pullRequest: currentPull,
    existingState: journal.state,
    checkpoint: journal.checkpoint,
  });
  assert.equal(waiting.nextDispatch, null);
  assert.equal(waiting.state.epoch.tail_receipt_run_id, 1_847);
  assert.equal(waiting.state.targets.ui.latest_desired_sha, priorHead);
  assert.equal(waiting.state.status_decisions.at(-1).state, "pending");

  const afterOriginal = reconcile({
    events: journal.receipts.events,
    results: [result(first.nextDispatch, { runId: 41_000 })],
    selections: journal.receipts.selections,
    pullRequest: currentPull,
    existingState: waiting.state,
    checkpoint: journal.checkpoint,
  });
  assert.equal(afterOriginal.nextDispatch.sha, priorHead);
  assert.equal(afterOriginal.nextDispatch.selection_receipt_run_id, 1_847);

  const latestActive = persistDispatch(afterOriginal, 41_001);
  const latestSelection = selectionReceiptFromDispatch(
    latestActive.targets.ui.active,
  );
  const latestResult = result(afterOriginal.nextDispatch, { runId: 41_001 });
  const finished = reconcile({
    events: journal.receipts.events,
    results: [result(first.nextDispatch, { runId: 41_000 }), latestResult],
    selections: [...journal.receipts.selections, latestSelection],
    pullRequest: currentPull,
    existingState: latestActive,
    checkpoint: journal.checkpoint,
  });
  assert.equal(finished.nextDispatch, null);
  assert.equal(finished.state.status_decisions.at(-1).state, "success");
  assert.equal(finished.state.targets.ui.retired_active.length, 0);
  assert.doesNotThrow(() =>
    reconcile({
      events: journal.receipts.events,
      results: [result(first.nextDispatch, { runId: 41_000 }), latestResult],
      selections: [...journal.receipts.selections, latestSelection],
      pullRequest: currentPull,
      existingState: finished.state,
      checkpoint: journal.checkpoint,
    }),
  );
});

test("capacity checkpointing uses the latest represented receipt when the live PR is ahead", () => {
  const openedHead = (260).toString(16).padStart(40, "0");
  const opened = event({
    run: 1_860,
    action: "opened",
    head: openedHead,
    updated: timestamp(1),
  });
  const representedEvents = [opened];
  const first = reconcile({
    events: representedEvents,
    pullRequest: pull({ head: openedHead, updated: timestamp(1) }),
  });
  const active = persistDispatch(first, 41_500);
  const selection = selectionReceiptFromDispatch(active.targets.ui.active);
  let journal = createPreviewJournal({
    pr: 519,
    events: representedEvents,
    selections: [selection],
    state: active,
  });
  let representedHead = openedHead;
  let index = 1;
  while (Buffer.byteLength(previewJournalBody(journal), "utf8") < 41_000) {
    const head = (260 + index).toString(16).padStart(40, "0");
    representedEvents.push(
      event({
        run: 1_860 + index,
        action: "synchronize",
        before: representedHead,
        head,
        updated: timestamp(index + 1),
      }),
    );
    representedHead = head;
    index += 1;
    journal = createPreviewJournal({
      pr: 519,
      events: representedEvents,
      selections: [selection],
      state: active,
    });
  }
  assert.ok(Buffer.byteLength(previewJournalBody(journal), "utf8") < 60_000);

  const liveAhead = pull({
    head: "e".repeat(40),
    updated: timestamp(index + 1),
  });
  const compacted = compactPreviewJournal(journal, {
    pullRequest: liveAhead,
  });
  assert.equal(compacted.checkpoint.event.head_sha, representedHead);
  assert.equal(compacted.checkpoint.targets.ui.status.state, "pending");
  assert.doesNotThrow(() =>
    reconcile({
      events: compacted.receipts.events,
      selections: compacted.receipts.selections,
      pullRequest: pull({
        head: representedHead,
        updated: timestamp(index),
      }),
      existingState: compacted.state,
      checkpoint: compacted.checkpoint,
    }),
  );
});

test("terminal checkpoint folds quarantined retired ownership into bounded audit evidence", () => {
  const setup = sameShaReopenState();
  const currentResult = result(setup.current.nextDispatch, { runId: 8_001 });
  const selections = [
    selectionReceiptFromDispatch(
      setup.currentState.targets.ui.retired_active[0],
    ),
    selectionReceiptFromDispatch(setup.currentState.targets.ui.active),
  ];
  const events = [...setup.events];
  let priorHead = SHA.A;
  let currentPull = setup.pullRequest;
  let journal = null;

  for (let index = 1; index <= 45; index += 1) {
    const head = (900 + index).toString(16).padStart(40, "0");
    events.push(
      event({
        run: 2_100 + index,
        action: "synchronize",
        before: priorHead,
        head,
        runtime: false,
        updated: timestamp(index + 3),
      }),
    );
    currentPull = pull({ head, updated: timestamp(index + 3) });
    const terminal = reconcile({
      events,
      results: [currentResult],
      selections,
      pullRequest: currentPull,
      existingState: setup.currentState,
    });
    assert.equal(terminal.state.targets.ui.active, null);
    assert.equal(terminal.state.targets.ui.retired_active.length, 1);
    const quarantinedState = structuredClone(terminal.state);
    quarantinedState.targets.ui.retired_active[0] = {
      ...quarantinedState.targets.ui.retired_active[0],
      recovery_quarantine: "persisted-attempt-invalid-or-unavailable",
    };
    journal = createPreviewJournal({
      pr: 519,
      events,
      selections,
      results: [currentResult],
      state: quarantinedState,
    });
    priorHead = head;
    if (Buffer.byteLength(previewJournalBody(journal), "utf8") >= 41_000) {
      break;
    }
  }

  const originalBytes = Buffer.byteLength(previewJournalBody(journal), "utf8");
  assert.ok(originalBytes >= 41_000, `journal was only ${originalBytes} bytes`);
  assert.ok(originalBytes < 60_000, `journal was ${originalBytes} bytes`);

  const compacted = compactPreviewJournal(journal, {
    pullRequest: currentPull,
  });
  assert.equal(compacted.checkpoint.targets.ui.pending_owner_key_digest, null);
  assert.equal(compacted.checkpoint.targets.ui.pending_owner_event, null);
  assert.equal(compacted.checkpoint.targets.ui.status.state, "success");
  assert.match(
    compacted.checkpoint.cumulative_receipts_digest,
    /^[0-9a-f]{64}$/,
  );
  assert.deepEqual(compacted.checkpoint.pruned_receipt_counts, {
    events: events.length,
    selections: 2,
    worker_evidence: 0,
    results: 1,
  });
  assert.deepEqual(compacted.receipts, {
    events: [],
    selections: [],
    worker_evidence: [],
    results: [],
  });
  assert.equal(compacted.state.targets.ui.retired_active.length, 0);
  assert.ok(
    Buffer.byteLength(previewJournalBody(compacted), "utf8") < originalBytes,
  );
  assert.doesNotThrow(() =>
    reconcile({
      events: compacted.receipts.events,
      results: compacted.receipts.results,
      selections: compacted.receipts.selections,
      pullRequest: currentPull,
      existingState: compacted.state,
      checkpoint: compacted.checkpoint,
    }),
  );
});

test("a terminal pending owner resolves a docs-only capacity checkpoint", async () => {
  const openedHead = (300).toString(16).padStart(40, "0");
  const opened = event({
    run: 1_900,
    action: "opened",
    head: openedHead,
    updated: timestamp(1),
  });
  const firstPull = pull({ head: openedHead, updated: timestamp(1) });
  const first = reconcile({ events: [opened], pullRequest: firstPull });
  const active = persistDispatch(first, 42_000);
  const selection = selectionReceiptFromDispatch(active.targets.ui.active);
  const events = [opened];
  let priorHead = openedHead;
  let currentPull = firstPull;
  let pending = null;
  let candidateJournal = null;

  for (let index = 1; index <= 38; index += 1) {
    const head = (300 + index).toString(16).padStart(40, "0");
    events.push(
      event({
        run: 1_900 + index,
        action: "synchronize",
        before: priorHead,
        head,
        runtime: false,
        updated: timestamp(index + 1),
      }),
    );
    priorHead = head;
    currentPull = pull({ head: priorHead, updated: timestamp(index + 1) });
    pending = reconcile({
      events,
      selections: [selection],
      pullRequest: currentPull,
      existingState: active,
    });
    candidateJournal = createPreviewJournal({
      pr: 519,
      events,
      selections: [selection],
      state: pending.state,
    });
    const candidateBytes = Buffer.byteLength(
      previewJournalBody(candidateJournal),
      "utf8",
    );
    if (candidateBytes >= 41_000) {
      assert.ok(candidateBytes < 60_000);
      break;
    }
  }
  assert.ok(pending);
  assert.ok(candidateJournal);
  assert.ok(
    Buffer.byteLength(previewJournalBody(candidateJournal), "utf8") >= 41_000,
  );
  const compacted = compactPreviewJournal(candidateJournal, {
    pullRequest: currentPull,
  });
  assert.equal(compacted.checkpoint.targets.ui.status.state, "pending");
  assert.equal(
    compacted.checkpoint.targets.ui.pending_owner_event.event_run_id,
    opened.event_run_id,
  );

  const postCheckpoint = reconcile({
    events: compacted.receipts.events,
    selections: compacted.receipts.selections,
    pullRequest: currentPull,
    existingState: compacted.state,
    checkpoint: compacted.checkpoint,
  });
  assert.equal(postCheckpoint.nextDispatch, null);
  const completedResult = result(first.nextDispatch, { runId: 42_000 });
  const completed = reconcile({
    events: compacted.receipts.events,
    results: [completedResult],
    selections: compacted.receipts.selections,
    pullRequest: currentPull,
    existingState: postCheckpoint.state,
    checkpoint: compacted.checkpoint,
  });
  const decision = completed.state.status_decisions.at(-1);
  assert.equal(completed.nextDispatch, null);
  assert.equal(decision.state, "success");
  assert.equal(decision.targets.ui, "deployed");
  assert.equal(decision.target_url, "https://ui-42000.vercel.app");
  assert.equal(completed.state.targets.ui.active, null);
  assert.equal(completed.state.targets.ui.retired_active.length, 0);
  assert.doesNotThrow(() =>
    reconcile({
      events: compacted.receipts.events,
      results: [completedResult],
      selections: compacted.receipts.selections,
      pullRequest: currentPull,
      existingState: completed.state,
      checkpoint: compacted.checkpoint,
    }),
  );

  const completedRun = workerRun(first.nextDispatch, {
    id: 42_000,
    status: "completed",
    conclusion: "success",
  });
  const callbackFixture = fakeGitHub({
    pullRequest: currentPull,
    comments: [
      journalComment({
        checkpoint: compacted.checkpoint,
        events: compacted.receipts.events,
        selections: compacted.receipts.selections,
        state: postCheckpoint.state,
      }),
    ],
    runs: [completedRun],
    deployments: [
      {
        id: 9_200,
        ref: openedHead,
        sha: openedHead,
        environment: "preview/ui/pr-519",
        payload: {
          ...canonicalDeploymentBinding(),
          idempotency_key: first.nextDispatch.key,
          sha: openedHead,
          logical_target: "ui",
          workflow_run_url:
            "https://github.com/mento-protocol/frontend-monorepo/actions/runs/42000/attempts/1",
        },
      },
    ],
    deploymentStatuses: new Map([
      [
        9_200,
        [
          {
            state: "success",
            environment_url: "https://ui-42000.vercel.app",
            log_url:
              "https://github.com/mento-protocol/frontend-monorepo/actions/runs/42000/attempts/1",
          },
        ],
      ],
    ]),
  });
  const callback = await recoverWorkerResult({
    github: callbackFixture.github,
    context: fakeContext({ workflowRun: completedRun }),
    core: fakeCore(),
  });
  assert.equal(callback.should_reconcile_current_epoch, true);

  const terminal = compactPreviewJournal(
    createPreviewJournal({
      pr: 519,
      checkpoint: compacted.checkpoint,
      events: compacted.receipts.events,
      selections: compacted.receipts.selections,
      results: [completedResult],
      state: completed.state,
    }),
  );
  assert.equal(terminal.checkpoint.targets.ui.status.state, "success");
  assert.equal(terminal.checkpoint.event.head_sha, priorHead);
  assert.equal(terminal.checkpoint.targets.ui.pending_owner_key_digest, null);
  assert.equal(terminal.checkpoint.targets.ui.pending_owner_event, null);
  assert.deepEqual(terminal.receipts, {
    events: [],
    selections: [],
    worker_evidence: [],
    results: [],
  });
});

test("a capacity checkpoint carries the original attempt into the retry budget", () => {
  const openedHead = (350).toString(16).padStart(40, "0");
  const opened = event({
    run: 1_950,
    action: "opened",
    head: openedHead,
    updated: timestamp(1),
  });
  const events = [opened];
  const firstPull = pull({ head: openedHead, updated: timestamp(1) });
  const first = reconcile({ events, pullRequest: firstPull });
  const active = persistDispatch(first, 43_000);
  const firstSelection = selectionReceiptFromDispatch(active.targets.ui.active);
  let priorHead = openedHead;
  let currentPull = firstPull;
  let pending = null;
  let candidateJournal = null;
  for (let index = 1; index <= 38; index += 1) {
    const head = (350 + index).toString(16).padStart(40, "0");
    events.push(
      event({
        run: 1_950 + index,
        action: "synchronize",
        before: priorHead,
        head,
        runtime: false,
        updated: timestamp(index + 1),
      }),
    );
    priorHead = head;
    currentPull = pull({ head: priorHead, updated: timestamp(index + 1) });
    pending = reconcile({
      events,
      selections: [firstSelection],
      pullRequest: currentPull,
      existingState: active,
    });
    candidateJournal = createPreviewJournal({
      pr: 519,
      events,
      selections: [firstSelection],
      state: pending.state,
    });
    const candidateBytes = Buffer.byteLength(
      previewJournalBody(candidateJournal),
      "utf8",
    );
    if (candidateBytes >= 41_000) {
      assert.ok(candidateBytes < 60_000);
      break;
    }
  }
  assert.ok(pending);
  assert.ok(candidateJournal);
  assert.ok(
    Buffer.byteLength(previewJournalBody(candidateJournal), "utf8") >= 41_000,
  );
  const compacted = compactPreviewJournal(candidateJournal, {
    pullRequest: currentPull,
  });
  assert.equal(compacted.checkpoint.targets.ui.pending_owner_attempt_count, 1);
  const waiting = reconcile({
    events: compacted.receipts.events,
    selections: compacted.receipts.selections,
    pullRequest: currentPull,
    existingState: compacted.state,
    checkpoint: compacted.checkpoint,
  });
  const firstFailure = result(first.nextDispatch, {
    runId: 43_000,
    state: "failure",
    reason: "build-failed-retriable",
  });
  const retry = reconcile({
    events: compacted.receipts.events,
    results: [firstFailure],
    selections: compacted.receipts.selections,
    pullRequest: currentPull,
    existingState: waiting.state,
    checkpoint: compacted.checkpoint,
  });
  assert.equal(
    retry.nextDispatch.selection_receipt_run_id,
    opened.event_run_id,
  );
  const retryActive = persistDispatch(retry, 43_001);
  const retrySelection = selectionReceiptFromDispatch(
    retryActive.targets.ui.active,
  );
  const retryFailure = result(retry.nextDispatch, {
    runId: 43_001,
    state: "failure",
    reason: "build-failed-retriable",
  });
  const exhausted = reconcile({
    events: compacted.receipts.events,
    results: [firstFailure, retryFailure],
    selections: [...compacted.receipts.selections, retrySelection],
    pullRequest: currentPull,
    existingState: retryActive,
    checkpoint: compacted.checkpoint,
  });
  assert.equal(exhausted.nextDispatch, null);
  assert.equal(exhausted.state.status_decisions.at(-1).state, "failure");
});

function unfinishedEpochs(count) {
  const events = [];
  const selections = [];
  let state = null;
  let currentPull = null;

  for (let index = 0; index < count; index += 1) {
    const head = (500 + index).toString(16).padStart(40, "0");
    const receipt = event({
      run: 2_100 + index,
      action: index === 0 ? "opened" : "reopened",
      head,
      updated: timestamp(index + 1),
    });
    events.push(receipt);
    currentPull = pull({ head, updated: timestamp(index + 1) });
    const reconciled = reconcile({
      events,
      selections,
      pullRequest: currentPull,
      existingState: state,
    });
    state = persistDispatch(reconciled, 50_000 + index);
    selections.push(selectionReceiptFromDispatch(state.targets.ui.active));
  }
  return { events, selections, state, currentPull };
}

test("terminalized retired owners are folded before the history limit", () => {
  const setup = unfinishedEpochs(41);
  assert.equal(setup.state.targets.ui.retired_active.length, 40);
  const oldest = setup.state.targets.ui.retired_active[0];
  const terminal = result(oldest, { runId: oldest.workflow_run_id });
  const completed = reconcile({
    events: setup.events,
    results: [terminal],
    selections: setup.selections,
    pullRequest: setup.currentPull,
    existingState: setup.state,
  });
  assert.equal(completed.state.targets.ui.retired_active.length, 39);
  assert.equal(
    completed.state.targets.ui.retired_active.some(
      (selection) => selection.key_digest === oldest.key_digest,
    ),
    false,
  );
  assert.equal(
    completed.state.targets.ui.active.key_digest,
    setup.state.targets.ui.active.key_digest,
  );

  const nextHead = (541).toString(16).padStart(40, "0");
  const nextEvent = event({
    run: 2_141,
    action: "reopened",
    head: nextHead,
    updated: timestamp(42),
  });
  const next = reconcile({
    events: [...setup.events, nextEvent],
    results: [terminal],
    selections: setup.selections,
    pullRequest: pull({ head: nextHead, updated: timestamp(42) }),
    existingState: completed.state,
  });
  const persisted = persistDispatch(next, 50_041);
  assert.equal(persisted.targets.ui.retired_active.length, 40);
  assert.equal(
    persisted.targets.ui.retired_active.some(
      (selection) => selection.key_digest === oldest.key_digest,
    ),
    false,
  );
});

test("more than forty unfinished retired owners fail closed", () => {
  const setup = unfinishedEpochs(41);
  const ownershipBefore = new Set([
    setup.state.targets.ui.active.key_digest,
    ...setup.state.targets.ui.retired_active.map(({ key_digest: key }) => key),
  ]);
  const nextHead = (541).toString(16).padStart(40, "0");
  const nextEvent = event({
    run: 2_141,
    action: "reopened",
    head: nextHead,
    updated: timestamp(42),
  });

  assert.throws(
    () =>
      reconcile({
        events: [...setup.events, nextEvent],
        selections: setup.selections,
        pullRequest: pull({ head: nextHead, updated: timestamp(42) }),
        existingState: setup.state,
      }),
    /ui has too many unfinished retired workers/,
  );
  assert.deepEqual(
    new Set([
      setup.state.targets.ui.active.key_digest,
      ...setup.state.targets.ui.retired_active.map(
        ({ key_digest: key }) => key,
      ),
    ]),
    ownershipBefore,
  );
});

test("docs-only checkpoint tails preserve prior runtime terminal semantics", () => {
  const terminalCases = [
    {
      state: "success",
      reason: "verified",
      expectedState: "success",
      expectedOutcome: "runtime-equivalent",
    },
    {
      state: "failure",
      reason: "worker-failure",
      expectedState: "failure",
      expectedOutcome: "failed",
    },
    {
      state: "error",
      reason: "worker-failure",
      expectedState: "error",
      expectedOutcome: "error",
    },
    {
      state: "error",
      reason: "worker-cancelled",
      expectedState: "failure",
      expectedOutcome: "failed",
    },
  ];

  for (const [index, terminalCase] of terminalCases.entries()) {
    const runtime = event({
      run: 1_100 + index,
      action: "opened",
      head: SHA.A,
      updated: timestamp(1),
    });
    const selected = reconcile({
      events: [runtime],
      pullRequest: pull({ head: SHA.A, updated: timestamp(1) }),
    });
    const workerRunId = 31_000 + index;
    const active = persistDispatch(selected, workerRunId);
    const selection = selectionReceiptFromDispatch(active.targets.ui.active);
    const terminal = result(selected.nextDispatch, {
      runId: workerRunId,
      state: terminalCase.state,
      reason: terminalCase.reason,
    });
    const completed = reconcile({
      events: [runtime],
      results: [terminal],
      selections: [selection],
      pullRequest: pull({ head: SHA.A, updated: timestamp(1) }),
      existingState: active,
    });
    let journal = compactPreviewJournal(
      createPreviewJournal({
        pr: 519,
        events: [runtime],
        selections: [selection],
        results: [terminal],
        state: completed.state,
      }),
    );

    const firstDocs = event({
      run: 1_200 + index,
      action: "synchronize",
      before: SHA.A,
      head: SHA.B,
      runtime: false,
      updated: timestamp(2),
    });
    if (terminalCase.state === "success") {
      const baselineWithoutBuildEvidence = structuredClone(journal.state);
      baselineWithoutBuildEvidence.targets.ui.last_successful_runtime_sha =
        null;
      baselineWithoutBuildEvidence.targets.ui.last_successful_runtime_url =
        null;
      const syntheticReplay = reconcile({
        events: [firstDocs],
        pullRequest: pull({ head: SHA.B, updated: timestamp(2) }),
        existingState: baselineWithoutBuildEvidence,
        checkpoint: journal.checkpoint,
      });
      assert.match(
        syntheticReplay.state.status_decisions.at(-1).description,
        /ui=equivalent/,
      );
      assert.equal(
        syntheticReplay.state.targets.ui.last_successful_runtime_sha,
        null,
      );
      assert.equal(
        syntheticReplay.state.targets.ui.last_successful_runtime_url,
        null,
      );
    }
    const firstDocsState = reconcile({
      events: [firstDocs],
      pullRequest: pull({ head: SHA.B, updated: timestamp(2) }),
      existingState: journal.state,
      checkpoint: journal.checkpoint,
    });
    journal = compactPreviewJournal(
      createPreviewJournal({
        pr: 519,
        checkpoint: journal.checkpoint,
        events: [firstDocs],
        state: firstDocsState.state,
      }),
    );
    assert.equal(
      journal.checkpoint.through_event_run_id,
      firstDocs.event_run_id,
    );

    const secondDocs = event({
      run: 1_300 + index,
      action: "synchronize",
      before: SHA.B,
      head: SHA.C,
      runtime: false,
      updated: timestamp(3),
    });
    const secondDocsState = reconcile({
      events: [secondDocs],
      pullRequest: pull({ head: SHA.C, updated: timestamp(3) }),
      existingState: journal.state,
      checkpoint: journal.checkpoint,
    });
    const decision = secondDocsState.state.status_decisions.at(-1);
    assert.equal(secondDocsState.nextDispatch, null);
    assert.equal(decision.sha, SHA.C);
    assert.equal(decision.state, terminalCase.expectedState);
    assert.equal(decision.targets.ui, terminalCase.expectedOutcome);
    assert.equal(
      decision.target_url,
      terminalCase.state === "success"
        ? `https://ui-${workerRunId}.vercel.app`
        : `https://github.com/${PREVIEW_REPOSITORY}/actions/runs/${workerRunId}`,
    );
  }

  const initialDocs = event({
    run: 1_400,
    action: "opened",
    head: SHA.A,
    runtime: false,
    updated: timestamp(1),
  });
  const initialDocsState = reconcile({
    events: [initialDocs],
    pullRequest: pull({ head: SHA.A, updated: timestamp(1) }),
  });
  const initialDocsJournal = compactPreviewJournal(
    createPreviewJournal({
      pr: 519,
      events: [initialDocs],
      state: initialDocsState.state,
    }),
  );
  const laterDocs = event({
    run: 1_401,
    action: "synchronize",
    before: SHA.A,
    head: SHA.B,
    runtime: false,
    updated: timestamp(2),
  });
  const laterDocsState = reconcile({
    events: [laterDocs],
    pullRequest: pull({ head: SHA.B, updated: timestamp(2) }),
    existingState: initialDocsJournal.state,
    checkpoint: initialDocsJournal.checkpoint,
  });
  assert.equal(
    laterDocsState.state.status_decisions.at(-1).description,
    "app=none; governance=none; reserve=none; ui=none",
  );
});

test("closed checkpoints retain matching closure across late events and reopen", () => {
  const opened = event({
    run: 1_500,
    action: "opened",
    head: SHA.A,
    runtime: false,
    updated: timestamp(1),
  });
  const openState = reconcile({
    events: [opened],
    pullRequest: pull({ head: SHA.A, updated: timestamp(1) }),
  });
  const closed = event({
    run: 1_501,
    action: "closed",
    head: SHA.A,
    updated: timestamp(2),
  });
  const closedPull = pull({
    head: SHA.A,
    state: "closed",
    updated: timestamp(2),
    closed: timestamp(2),
  });
  const closedState = reconcile({
    events: [opened, closed],
    pullRequest: closedPull,
    existingState: openState.state,
  });
  let journal = compactPreviewJournal(
    createPreviewJournal({
      pr: 519,
      events: [opened, closed],
      state: closedState.state,
    }),
  );
  assert.equal(journal.checkpoint.event.event_action, "closed");
  assert.equal(journal.checkpoint.through_event_run_id, closed.event_run_id);
  assert.equal(journal.state.epoch.closed_at, timestamp(2));

  const delayed = event({
    run: 1_502,
    action: "synchronize",
    before: SHA.B,
    head: SHA.A,
    runtime: false,
    updated: timestamp(1),
  });
  const delayedState = reconcile({
    events: [delayed],
    pullRequest: closedPull,
    existingState: journal.state,
    checkpoint: journal.checkpoint,
  });
  assert.equal(delayedState.state.closed, true);
  journal = compactPreviewJournal(
    createPreviewJournal({
      pr: 519,
      checkpoint: journal.checkpoint,
      events: [delayed],
      state: delayedState.state,
    }),
  );
  assert.equal(journal.checkpoint.event.event_action, "closed");
  assert.equal(journal.state.epoch.closed_at, timestamp(2));

  const reopened = event({
    run: 1_503,
    action: "reopened",
    head: SHA.A,
    runtime: false,
    updated: timestamp(3),
  });
  const reopenedState = reconcile({
    events: [reopened],
    pullRequest: pull({ head: SHA.A, updated: timestamp(3) }),
    existingState: journal.state,
    checkpoint: journal.checkpoint,
  });
  assert.equal(reopenedState.state.closed, false);
  assert.equal(reopenedState.state.epoch.anchor_run_id, reopened.event_run_id);
  assert.equal(reopenedState.nextDispatch, null);
});

const expectedCommentExplanation = [
  "**No reviewer action is required.**",
  "This repository builds pull request previews in GitHub Actions and deploys them to Vercel.",
  "This record lets the preview automation handle overlapping pushes and recover safely from retries.",
  "[How previews work](https://github.com/mento-protocol/frontend-monorepo/blob/main/docs/vercel-deployments.md#event-status-and-batching-contract).",
].join(" ");

function previewJournalBody(value) {
  return `${PREVIEW_JOURNAL_MARKER}\n\n${expectedCommentExplanation}\n\n<details>\n<summary>Show machine-readable preview automation record</summary>\n\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\`\n\n</details>\n`;
}

function journalFromComment(comment) {
  const match = comment.body.match(
    /\n```json\n([\s\S]+)\n```\n\n<\/details>\n$/,
  );
  assert.ok(match, "fixture must contain one canonical preview journal");
  return JSON.parse(match[1]);
}

function journalComment(
  {
    pr = 519,
    revision = 1,
    checkpoint = null,
    events = [],
    selections = [],
    workerEvidence = [],
    results = [],
    state = null,
  } = {},
  id = 1,
) {
  const journal = createPreviewJournal({
    pr,
    revision,
    checkpoint,
    events,
    selections,
    workerEvidence,
    results,
    state,
  });
  return {
    id,
    user: { type: "Bot", login: "github-actions[bot]" },
    body: previewJournalBody(journal),
  };
}

function journalWithState(
  events,
  state,
  {
    revision = 1,
    selections = state
      ? PREVIEW_TARGETS.flatMap((target) =>
          state.targets[target]?.active
            ? [selectionReceiptFromDispatch(state.targets[target].active)]
            : [],
        )
      : [],
    workerEvidence = [],
    results = [],
  } = {},
  id = 1,
) {
  return journalComment(
    { revision, events, selections, workerEvidence, results, state },
    id,
  );
}

function oldReceiptComment(marker, value, id = 99) {
  return {
    id,
    user: { type: "Bot", login: "github-actions[bot]" },
    body: `${marker}\n\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\`\n`,
  };
}

function canonicalDeploymentBinding() {
  return {
    controller_schema: "mento-vercel-prebuilt/v2",
    provenance: "preview-controller:v2",
  };
}

function workerRun(
  selection,
  {
    id = 8_000,
    attempt = 1,
    status = "queued",
    conclusion = null,
    workflowSha = selection.expected_workflow_sha,
    createdAt = timestamp(1),
  } = {},
) {
  return {
    id,
    name: "Vercel Preview Worker",
    path: ".github/workflows/vercel-preview-worker.yml@main",
    event: "workflow_dispatch",
    head_branch: "main",
    head_sha: workflowSha,
    run_attempt: attempt,
    display_title: workerRunName({
      pr: selection.pr,
      target: selection.target,
      sha: selection.sha,
      keyDigest: selection.key_digest,
    }),
    url: `https://api.github.com/repos/mento-protocol/frontend-monorepo/actions/runs/${id}`,
    html_url: `https://github.com/mento-protocol/frontend-monorepo/actions/runs/${id}`,
    status,
    conclusion,
    created_at: createdAt,
    repository: { full_name: PREVIEW_REPOSITORY },
  };
}

function dependabotIntakeRun({
  pr = 519,
  sha = SHA.A,
  action = "opened",
  headRef = "dependabot/npm/pnpm",
  headRepository = PREVIEW_REPOSITORY,
  baseRef = "main",
  baseRepository = PREVIEW_REPOSITORY,
  ...overrides
} = {}) {
  const [, headRepositoryName] = headRepository.split("/");
  const [, baseRepositoryName] = baseRepository.split("/");
  return {
    id: 7_500,
    name: "Vercel Preview Intake",
    path: ".github/workflows/vercel-preview-intake.yml@main",
    event: "pull_request_target",
    head_branch: headRef,
    head_sha: sha,
    head_repository: {
      full_name: headRepository,
      url: `https://api.github.com/repos/${headRepository}`,
    },
    status: "completed",
    conclusion: "success",
    repository: { full_name: PREVIEW_REPOSITORY },
    pull_requests: [
      {
        number: pr,
        url: `https://api.github.com/repos/${PREVIEW_REPOSITORY}/pulls/${pr}`,
        head: {
          ref: headRef,
          sha,
          repo: {
            name: headRepositoryName,
            url: `https://api.github.com/repos/${headRepository}`,
          },
        },
        base: {
          ref: baseRef,
          sha: SHA.E,
          repo: {
            name: baseRepositoryName,
            url: `https://api.github.com/repos/${baseRepository}`,
          },
        },
      },
    ],
    display_title: dependabotIntakeRunName({ pr, sha, action }),
    html_url:
      "https://github.com/mento-protocol/frontend-monorepo/actions/runs/7500",
    ...overrides,
  };
}

function workerInputs(selection) {
  return {
    pull_request_number: String(selection.pr),
    target: selection.target,
    commit_sha: selection.sha,
    git_branch: selection.git_ref,
    controller_key: selection.key,
    controller_key_digest: selection.key_digest,
    expected_workflow_sha: selection.expected_workflow_sha,
    epoch_anchor_run_id: String(selection.epoch_anchor_run_id),
    reconciliation_basis_digest: selection.reconciliation_basis_digest,
    selection_receipt_run_id: String(selection.selection_receipt_run_id),
  };
}

function sameShaReopenState() {
  const opened = event({
    run: 160,
    action: "opened",
    head: SHA.A,
    updated: timestamp(1),
  });
  const old = reconcile({
    events: [opened],
    pullRequest: pull({ head: SHA.A, updated: timestamp(1) }),
  });
  const oldDispatched = persistDispatch(old, 8_000);
  const closed = event({
    run: 161,
    action: "closed",
    head: SHA.A,
    updated: timestamp(2),
  });
  const closedState = reconcile({
    events: [opened, closed],
    pullRequest: pull({
      head: SHA.A,
      state: "closed",
      updated: timestamp(2),
      closed: timestamp(2),
    }),
    existingState: oldDispatched,
  });
  const reopened = event({
    run: 162,
    action: "reopened",
    head: SHA.A,
    updated: timestamp(3),
  });
  const current = reconcile({
    events: [opened, closed, reopened],
    pullRequest: pull({ head: SHA.A, updated: timestamp(3) }),
    existingState: closedState.state,
  });
  return {
    events: [opened, closed, reopened],
    old,
    current,
    currentState: persistDispatch(current, 8_001),
    pullRequest: pull({ head: SHA.A, updated: timestamp(3) }),
  };
}

function sameShaReopenIntentState() {
  const opened = event({
    run: 160,
    action: "opened",
    head: SHA.A,
    updated: timestamp(1),
  });
  const old = reconcile({
    events: [opened],
    pullRequest: pull({ head: SHA.A, updated: timestamp(1) }),
  });
  const oldIntended = persistIntent(old);
  const closed = event({
    run: 161,
    action: "closed",
    head: SHA.A,
    updated: timestamp(2),
  });
  const closedState = reconcile({
    events: [opened, closed],
    pullRequest: pull({
      head: SHA.A,
      state: "closed",
      updated: timestamp(2),
      closed: timestamp(2),
    }),
    existingState: oldIntended,
  });
  const reopened = event({
    run: 162,
    action: "reopened",
    head: SHA.A,
    updated: timestamp(3),
  });
  const current = reconcile({
    events: [opened, closed, reopened],
    pullRequest: pull({ head: SHA.A, updated: timestamp(3) }),
    existingState: closedState.state,
  });
  assert.equal(current.state.targets.ui.active, null);
  assert.equal(current.state.targets.ui.retired_active.length, 1);
  assert.equal(
    current.state.targets.ui.retired_active[0].dispatch_state,
    "intended",
  );
  return {
    events: [opened, closed, reopened],
    old,
    current,
    pullRequest: pull({ head: SHA.A, updated: timestamp(3) }),
  };
}

function fakeGitHub({
  pullRequest,
  comments: initialComments,
  runs: initialRuns = [],
  dispatchedWorkflowSha,
  workerRunTotalCount,
  workflowRunAttemptFailures = [],
  updateCommentFailures = [],
  lostSerializedUpdateFailures = 0,
  updateCommentFailureIds = [],
  pullCommits = [pullRequest.head.sha],
  deployments: initialDeployments = [],
  deploymentStatuses = new Map(),
  existingCommitStatuses = new Map(),
  commitStatusListFailures = [],
  commitStatusFailures = [],
  workflowRunDisplayTitles = [],
  workflowRunListDisplayTitles = [],
  workflowRunListRunIds = [],
  pullRequests = [],
  beforeListComments,
  beforeListCommitStatuses,
  uiVercelConfiguration = GITHUB_OWNED_UI_VERCEL_CONFIGURATION,
  uiVercelConfigurations = [],
  uiVercelConfigurationsByRef = new Map(),
  uiVercelContentResponse,
  uiVercelContentErrorStatus,
} = {}) {
  const comments = structuredClone(initialComments);
  const runs = structuredClone(initialRuns);
  const deployments = structuredClone(initialDeployments);
  const statuses = new Map(
    [...deploymentStatuses.entries()].map(([key, value]) => [
      String(key),
      structuredClone(value),
    ]),
  );
  const commitStatuses = [];
  const commitStatusHistory = new Map(
    [...existingCommitStatuses.entries()].map(([key, value]) => [
      String(key),
      structuredClone(value),
    ]),
  );
  const commentUpdates = [];
  const lostSerializedUpdates = [];
  const dispatches = [];
  const createdDeploymentStatuses = [];
  const workflowRunAttemptRequests = [];
  const workflowRunListRequests = [];
  const workflowRunRequests = [];
  const primaryRequests = [];
  const workerDispatchRequests = [];
  const contentRequests = [];
  const transientDisplayTitles = [...workflowRunDisplayTitles];
  const transientListDisplayTitles = [...workflowRunListDisplayTitles];
  const transientListRunIds = [...workflowRunListRunIds];
  const transientPullRequests = [...pullRequests];
  const transientUiVercelConfigurations = [...uiVercelConfigurations];
  const configurationsByRef = new Map(uiVercelConfigurationsByRef);
  const attemptFailures = [...workflowRunAttemptFailures];
  const commentUpdateFailures = [...updateCommentFailures];
  let lostSerializedUpdateFailureCount = lostSerializedUpdateFailures;
  const commitStatusListFailureQueue = [...commitStatusListFailures];
  const commitStatusFailureQueue = [...commitStatusFailures];
  const commentUpdateFailureIds = new Set(updateCommentFailureIds);
  let nextCommentId = 100;
  let nextDeploymentId = 9_000;
  let listCommentRequests = 0;
  let listCommitStatusRequests = 0;
  let deploymentLookupCallCount = 0;
  const listComments = async () => {};
  const listCommits = async () => {};
  const listDeployments = async () => {};
  const listCommitStatusesForRef = async ({ ref, per_page = 100 }) => {
    listCommitStatusRequests += 1;
    beforeListCommitStatuses?.({
      requestCount: listCommitStatusRequests,
      comments,
    });
    const failureStatus = commitStatusListFailureQueue.shift();
    if (failureStatus) {
      const error = new Error("fixture commit status read failed");
      error.status = failureStatus;
      throw error;
    }
    return {
      data: structuredClone(
        (commitStatusHistory.get(String(ref)) ?? []).slice(0, per_page),
      ),
    };
  };
  const github = {
    rest: {
      issues: {
        listComments,
        createComment: async ({ body }) => {
          const data = {
            id: nextCommentId++,
            user: { type: "Bot", login: "github-actions[bot]" },
            body,
          };
          comments.push(data);
          return { data };
        },
        updateComment: async ({ comment_id, body }) => {
          if (commentUpdateFailureIds.delete(comment_id)) {
            const error = new Error("fixture targeted comment update failed");
            error.status = 503;
            throw error;
          }
          const failureStatus = commentUpdateFailures.shift();
          if (failureStatus) {
            const error = new Error("fixture comment update failed");
            error.status = failureStatus;
            throw error;
          }
          const comment = comments.find(({ id }) => id === comment_id);
          assert.ok(comment, "fixture update must target an existing comment");
          const previousBody = comment.body;
          commentUpdates.push({ comment_id, body });
          comment.body = body;
          if (lostSerializedUpdateFailureCount > 0) {
            lostSerializedUpdateFailureCount -= 1;
            lostSerializedUpdates.push(comment_id);
            comment.body = previousBody;
          }
          return { data: comment };
        },
      },
      pulls: {
        get: async () => ({
          data: structuredClone(transientPullRequests.shift() ?? pullRequest),
        }),
        listCommits,
      },
      actions: {
        listWorkflowRuns: async (request) => {
          const { created, page = 1, per_page = 100 } = request;
          workflowRunListRequests.push(structuredClone(request));
          const [start, end] = String(created ?? "..").split("..");
          const timeFiltered = runs.filter(
            (run) =>
              (!start || run.created_at >= start) &&
              (!end || run.created_at <= end),
          );
          const listedRunIds = transientListRunIds.shift();
          const filtered =
            listedRunIds === undefined
              ? timeFiltered
              : timeFiltered.filter((run) => listedRunIds.includes(run.id));
          const displayTitles = transientListDisplayTitles.shift();
          const pageRuns = filtered.slice(
            (page - 1) * per_page,
            page * per_page,
          );
          return {
            data: {
              total_count: workerRunTotalCount ?? filtered.length,
              workflow_runs: structuredClone(
                pageRuns.map((run, index) => ({
                  ...run,
                  ...(displayTitles?.[index] === undefined
                    ? {}
                    : { display_title: displayTitles[index] }),
                })),
              ),
            },
          };
        },
        getWorkflowRun: async ({ run_id }) => {
          const data = runs.find(({ id }) => id === run_id);
          assert.ok(data, `fixture run ${run_id} must exist`);
          workflowRunRequests.push(run_id);
          const displayTitle = transientDisplayTitles.shift();
          return {
            data: structuredClone({
              ...data,
              ...(displayTitle === undefined
                ? {}
                : { display_title: displayTitle }),
            }),
          };
        },
      },
      repos: {
        getContent: async (request) => {
          contentRequests.push(structuredClone(request));
          const target = PREVIEW_TARGETS.find(
            (candidate) =>
              PREVIEW_TARGET_CONFIG[candidate].vercelConfigurationPath ===
              request.path,
          );
          assert.ok(
            target,
            "fixture content request must target Vercel config",
          );
          if (target !== "ui") {
            const configuration =
              PREVIEW_TARGET_CONFIG[target].nativeVercelConfiguration;
            const text = `${JSON.stringify(configuration, null, 2)}\n`;
            const content = Buffer.from(text, "utf8");
            return {
              data: {
                type: "file",
                path: request.path,
                encoding: "base64",
                size: content.length,
                content: content.toString("base64"),
              },
            };
          }
          if (uiVercelContentErrorStatus) {
            const error = new Error("fixture repository content read failed");
            error.status = uiVercelContentErrorStatus;
            throw error;
          }
          if (uiVercelContentResponse !== undefined) {
            return { data: structuredClone(uiVercelContentResponse) };
          }
          const configuration =
            (configurationsByRef.has(request.ref)
              ? configurationsByRef.get(request.ref)
              : request.ref === SHA.E
                ? GITHUB_OWNED_UI_VERCEL_CONFIGURATION
                : transientUiVercelConfigurations.length > 0
                  ? transientUiVercelConfigurations.shift()
                  : uiVercelConfiguration) ?? uiVercelConfiguration;
          const text =
            typeof configuration === "string"
              ? configuration
              : `${JSON.stringify(configuration, null, 2)}\n`;
          const content = Buffer.from(text, "utf8");
          return {
            data: {
              type: "file",
              path: request.path,
              encoding: "base64",
              size: content.length,
              content: content.toString("base64"),
            },
          };
        },
        listDeployments,
        listCommitStatusesForRef,
        createCommitStatus: async (request) => {
          const failureStatus = commitStatusFailureQueue.shift();
          if (failureStatus) {
            const error = new Error("fixture commit status write failed");
            error.status = failureStatus;
            throw error;
          }
          commitStatuses.push(structuredClone(request));
          commitStatusHistory.set(String(request.sha), [
            structuredClone(request),
            ...(commitStatusHistory.get(String(request.sha)) ?? []),
          ]);
          return { data: { id: commitStatuses.length } };
        },
        createDeployment: async (request) => {
          const data = {
            id: nextDeploymentId++,
            sha: request.ref,
            ref: request.ref,
            environment: request.environment,
            payload: structuredClone(request.payload),
          };
          deployments.push(data);
          return { data };
        },
        listDeploymentStatuses: async ({ deployment_id }) => ({
          data: structuredClone(statuses.get(String(deployment_id)) ?? []),
        }),
        createDeploymentStatus: async (request) => {
          const data = {
            id: 10_000 + createdDeploymentStatuses.length,
            ...request,
          };
          createdDeploymentStatuses.push(structuredClone(data));
          const key = String(request.deployment_id);
          statuses.set(key, [data, ...(statuses.get(key) ?? [])]);
          return { data };
        },
      },
    },
    paginate: async (method, request = {}) => {
      if (method === listComments) {
        listCommentRequests += 1;
        beforeListComments?.({ requestCount: listCommentRequests, comments });
        return structuredClone(comments);
      }
      if (method === listCommits) {
        return pullCommits.map((sha) => ({ sha }));
      }
      if (method === listDeployments) {
        deploymentLookupCallCount += 1;
        return structuredClone(deployments);
      }
      if (method === listCommitStatusesForRef) {
        return structuredClone(
          commitStatusHistory.get(String(request.ref)) ?? [],
        );
      }
      throw new Error("Unexpected fixture pagination method");
    },
    request: async (route, request) => {
      primaryRequests.push({ route, request: structuredClone(request) });
      if (
        route ===
        "GET /repos/{owner}/{repo}/actions/runs/{run_id}/attempts/{attempt_number}"
      ) {
        assert.equal(request.headers["X-GitHub-Api-Version"], "2026-03-10");
        workflowRunAttemptRequests.push({
          run_id: request.run_id,
          attempt_number: request.attempt_number,
        });
        const failureStatus = attemptFailures.shift();
        if (failureStatus) {
          const error = new Error("fixture workflow attempt request failed");
          error.status = failureStatus;
          throw error;
        }
        const data = runs.find(
          ({ id, run_attempt: runAttempt = 1 }) =>
            id === request.run_id && runAttempt === request.attempt_number,
        );
        if (!data) {
          const error = new Error(
            `fixture run ${request.run_id} attempt ${request.attempt_number} does not exist`,
          );
          error.status = 404;
          throw error;
        }
        return { status: 200, data: structuredClone(data) };
      }
      throw new Error(`Unexpected primary-client request: ${route}`);
    },
  };
  const workerDispatchGithub = {
    request: async (route, request) => {
      workerDispatchRequests.push({
        route,
        request: structuredClone(request),
      });
      assert.equal(
        route,
        "POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches",
      );
      assert.equal(request.ref, "main");
      assert.equal(request.return_run_details, true);
      assert.equal(request.headers["X-GitHub-Api-Version"], "2026-03-10");
      const id = 8_000 + dispatches.length;
      const selection = {
        pr: Number(request.inputs.pull_request_number),
        target: request.inputs.target,
        sha: request.inputs.commit_sha,
        key_digest: request.inputs.controller_key_digest,
        expected_workflow_sha: request.inputs.expected_workflow_sha,
      };
      const run = workerRun(selection, {
        id,
        workflowSha: dispatchedWorkflowSha ?? selection.expected_workflow_sha,
      });
      runs.push(run);
      dispatches.push(structuredClone(request));
      return { status: 200, data: { workflow_run_id: id } };
    },
  };
  workerDispatchClients.set(github, workerDispatchGithub);
  return {
    github,
    workerDispatchGithub,
    comments,
    runs,
    deployments,
    statuses,
    commitStatuses,
    commentUpdates,
    lostSerializedUpdates,
    dispatches,
    createdDeploymentStatuses,
    workflowRunAttemptRequests,
    workflowRunListRequests,
    workflowRunRequests,
    primaryRequests,
    workerDispatchRequests,
    contentRequests,
    get deploymentLookupCallCount() {
      return deploymentLookupCallCount;
    },
  };
}

function fakeContext({
  runId = 7_000,
  runAttempt = 1,
  workflowRun: completedRun,
} = {}) {
  return {
    runId,
    runAttempt,
    repo: { owner: "mento-protocol", repo: "frontend-monorepo" },
    payload: completedRun ? { workflow_run: completedRun } : {},
  };
}

function fakeCore() {
  const outputs = new Map();
  return {
    outputs,
    setOutput(name, value) {
      outputs.set(name, String(value));
    },
  };
}

function previewCommitStatuses(decisions) {
  const statuses = new Map();
  for (const decision of decisions) {
    statuses.set(decision.sha, [
      {
        context: "Vercel Preview",
        state: decision.state,
        description: decision.description,
        target_url: new URL(decision.target_url).toString(),
        creator: { type: "Bot", login: "github-actions[bot]" },
      },
    ]);
  }
  return statuses;
}

function nativeUiAggregateStatus(sha, runId) {
  return {
    sha,
    state: "success",
    description: "app=none; governance=none; reserve=none; ui=native",
    target_url: `https://github.com/${PREVIEW_REPOSITORY}/actions/runs/${runId}`,
    targets: {
      app: "not affected",
      governance: "not affected",
      reserve: "not affected",
      ui: "native-owned",
    },
  };
}

async function assertSettledReplayIsIdempotent({
  events,
  pullRequest,
  state,
  selections = [],
  results = [],
  runId,
}) {
  const comment = journalComment({
    revision: 7,
    events,
    selections,
    results,
    state,
  });
  const before = journalFromComment(comment);
  const fixture = fakeGitHub({
    pullRequest,
    comments: [comment],
    existingCommitStatuses: previewCommitStatuses(state.status_decisions),
  });

  await reconcilePreview({
    github: fixture.github,
    context: fakeContext({ runId }),
    core: fakeCore(),
    prNumber: pullRequest.number,
  });

  assert.deepEqual(journalFromComment(fixture.comments[0]), before);
  assert.equal(fixture.commentUpdates.length, 0);
  assert.equal(
    fixture.commitStatuses.length,
    0,
    JSON.stringify(fixture.commitStatuses),
  );
  assert.equal(fixture.dispatches.length, 0);
}

test("settled reconcile replays preserve journal and status intent across terminal outcomes", async () => {
  const runtimeCases = [
    {
      state: "success",
      reason: "verified",
      expectedTarget: (workerRunId) => `https://ui-${workerRunId}.vercel.app`,
    },
    {
      state: "failure",
      reason: "build-failed-final",
      expectedTarget: (workerRunId) =>
        `https://github.com/${PREVIEW_REPOSITORY}/actions/runs/${workerRunId}`,
    },
    {
      state: "failure",
      reason: "smoke-failed-final",
      vercelDeploymentUrl: "https://smoke-failure.vercel.app",
      expectedTarget: () => "https://smoke-failure.vercel.app",
    },
    {
      state: "error",
      reason: "worker_timed_out",
      expectedTarget: (workerRunId) =>
        `https://github.com/${PREVIEW_REPOSITORY}/actions/runs/${workerRunId}`,
    },
  ];
  let runId = 7_100;
  for (const terminal of runtimeCases) {
    const opened = event({
      run: runId,
      action: "opened",
      head: SHA.A,
      updated: timestamp(1),
    });
    const pullRequest = pull({ head: SHA.A, updated: timestamp(1) });
    const selected = reconcile({ events: [opened], pullRequest });
    const active = persistDispatch(selected, runId + 1);
    const selection = selectionReceiptFromDispatch(active.targets.ui.active);
    const terminalResult = result(selected.nextDispatch, {
      runId: runId + 1,
      ...terminal,
    });
    const state = reconcile({
      events: [opened],
      results: [terminalResult],
      selections: [selection],
      pullRequest,
      existingState: active,
    }).state;
    assert.equal(
      state.status_decisions[0].target_url,
      terminal.expectedTarget(runId + 1),
    );

    await assertSettledReplayIsIdempotent({
      events: [opened],
      pullRequest,
      state,
      selections: [selection],
      results: [terminalResult],
      runId: runId + 2,
    });
    runId += 10;
  }

  const docs = event({
    run: 7_200,
    action: "opened",
    head: SHA.B,
    runtime: false,
    updated: timestamp(1),
  });
  const docsPull = pull({ head: SHA.B, updated: timestamp(1) });
  await assertSettledReplayIsIdempotent({
    events: [docs],
    pullRequest: docsPull,
    state: reconcile({ events: [docs], pullRequest: docsPull }).state,
    runId: 7_201,
  });

  const unsupported = event({
    run: 7_210,
    action: "opened",
    head: SHA.C,
    repository: "fork/frontend-monorepo",
    author: "fork-author",
    updated: timestamp(1),
  });
  const unsupportedPull = pull({
    head: SHA.C,
    repository: "fork/frontend-monorepo",
    author: "fork-author",
    updated: timestamp(1),
  });
  await assertSettledReplayIsIdempotent({
    events: [unsupported],
    pullRequest: unsupportedPull,
    state: reconcile({
      events: [unsupported],
      pullRequest: unsupportedPull,
    }).state,
    runId: 7_211,
  });

  const burst = [
    event({ run: 7_220, action: "opened", head: SHA.A, updated: timestamp(1) }),
    event({
      run: 7_221,
      action: "synchronize",
      before: SHA.A,
      head: SHA.B,
      updated: timestamp(2),
    }),
    event({
      run: 7_222,
      action: "synchronize",
      before: SHA.B,
      head: SHA.C,
      updated: timestamp(3),
    }),
  ];
  const burstPull = pull({ head: SHA.C, updated: timestamp(3) });
  const selectedA = reconcile({ events: burst, pullRequest: burstPull });
  const activeA = persistDispatch(selectedA, 7_223);
  const selectionA = selectionReceiptFromDispatch(activeA.targets.ui.active);
  const resultA = result(selectedA.nextDispatch, { runId: 7_223 });
  const selectedC = reconcile({
    events: burst,
    results: [resultA],
    selections: [selectionA],
    pullRequest: burstPull,
    existingState: activeA,
  });
  const activeC = persistDispatch(selectedC, 7_224);
  const selectionC = selectionReceiptFromDispatch(activeC.targets.ui.active);
  const resultC = result(selectedC.nextDispatch, { runId: 7_224 });
  const burstState = reconcile({
    events: burst,
    results: [resultA, resultC],
    selections: [selectionA, selectionC],
    pullRequest: burstPull,
    existingState: activeC,
  }).state;
  assert.match(burstState.status_decisions[1].description, /ui=coalesced/);
  await assertSettledReplayIsIdempotent({
    events: burst,
    pullRequest: burstPull,
    state: burstState,
    selections: [selectionA, selectionC],
    results: [resultA, resultC],
    runId: 7_225,
  });
});

test("settled replay suppression uses only the latest bounded status witness", async () => {
  const docs = event({
    run: 7_260,
    action: "opened",
    head: SHA.D,
    runtime: false,
    updated: timestamp(1),
  });
  const pullRequest = pull({ head: SHA.D, updated: timestamp(1) });
  const state = reconcile({ events: [docs], pullRequest }).state;
  const comment = journalComment({ events: [docs], state });
  const exactStatus = previewCommitStatuses(state.status_decisions).get(
    SHA.D,
  )[0];
  const noise = Array.from({ length: 100 }, (_, index) => ({
    context: `Unrelated check ${index}`,
    state: "success",
    description: "Unrelated status",
    target_url: null,
  }));

  const lastRealisticStatusFixture = fakeGitHub({
    pullRequest,
    comments: [comment],
    existingCommitStatuses: new Map([
      [SHA.D, [...noise.slice(0, 99), exactStatus]],
    ]),
  });
  await reconcilePreview({
    github: lastRealisticStatusFixture.github,
    context: fakeContext({ runId: 7_261 }),
    core: fakeCore(),
    prNumber: 519,
  });
  assert.equal(lastRealisticStatusFixture.commentUpdates.length, 0);
  assert.equal(lastRealisticStatusFixture.commitStatuses.length, 0);

  const newerMismatchFixture = fakeGitHub({
    pullRequest,
    comments: [comment],
    existingCommitStatuses: new Map([
      [
        SHA.D,
        [
          { ...exactStatus, description: "Stale external description" },
          exactStatus,
        ],
      ],
    ]),
  });
  await reconcilePreview({
    github: newerMismatchFixture.github,
    context: fakeContext({ runId: 7_262 }),
    core: fakeCore(),
    prNumber: 519,
  });
  assert.equal(newerMismatchFixture.commentUpdates.length, 0);
  assert.equal(newerMismatchFixture.commitStatuses.length, 1);

  const foreignCreatorFixture = fakeGitHub({
    pullRequest,
    comments: [comment],
    existingCommitStatuses: new Map([
      [
        SHA.D,
        [
          {
            ...exactStatus,
            creator: { type: "User", login: "foreign-maintainer" },
          },
        ],
      ],
    ]),
  });
  await reconcilePreview({
    github: foreignCreatorFixture.github,
    context: fakeContext({ runId: 7_263 }),
    core: fakeCore(),
    prNumber: 519,
  });
  assert.equal(foreignCreatorFixture.commentUpdates.length, 0);
  assert.equal(foreignCreatorFixture.commitStatuses.length, 1);

  const beyondBoundFixture = fakeGitHub({
    pullRequest,
    comments: [comment],
    existingCommitStatuses: new Map([[SHA.D, [...noise, exactStatus]]]),
  });
  await reconcilePreview({
    github: beyondBoundFixture.github,
    context: fakeContext({ runId: 7_264 }),
    core: fakeCore(),
    prNumber: 519,
  });
  assert.equal(beyondBoundFixture.commentUpdates.length, 0);
  assert.equal(beyondBoundFixture.commitStatuses.length, 1);

  const racedState = structuredClone(state);
  racedState.status_decisions[0].target_url =
    "https://github.com/mento-protocol/frontend-monorepo/actions/runs/7265";
  const racedComment = journalComment({
    revision: 8,
    events: [docs],
    state: racedState,
  });
  const basisRaceFixture = fakeGitHub({
    pullRequest,
    comments: [comment],
    existingCommitStatuses: new Map([
      [SHA.D, [{ ...exactStatus, description: "Stale external description" }]],
    ]),
    beforeListCommitStatuses: ({ requestCount, comments }) => {
      if (requestCount === 1) comments[0].body = racedComment.body;
    },
  });
  const stateAfterRace = await reconcilePreview({
    github: basisRaceFixture.github,
    context: fakeContext({ runId: 7_265 }),
    core: fakeCore(),
    prNumber: 519,
  });
  assert.equal(basisRaceFixture.commitStatuses.length, 1);
  assert.equal(
    basisRaceFixture.commitStatuses[0].target_url,
    racedState.status_decisions[0].target_url,
  );
  assert.deepEqual(stateAfterRace, racedState);
});

test("reconcile still publishes genuine terminal changes and repairs a missing status witness", async () => {
  const opened = event({
    run: 7_300,
    action: "opened",
    head: SHA.A,
    updated: timestamp(1),
  });
  const pullRequest = pull({ head: SHA.A, updated: timestamp(1) });
  const selected = reconcile({ events: [opened], pullRequest });
  const active = persistDispatch(selected, 7_301);
  const selection = selectionReceiptFromDispatch(active.targets.ui.active);
  const terminalResult = result(selected.nextDispatch, {
    runId: 7_301,
    state: "failure",
    reason: "build-failed-final",
  });
  const pendingComment = journalWithState([opened], active, {
    selections: [selection],
    results: [terminalResult],
  });
  const pendingFixture = fakeGitHub({
    pullRequest,
    comments: [pendingComment],
    existingCommitStatuses: previewCommitStatuses(active.status_decisions),
  });

  const terminalState = await reconcilePreview({
    github: pendingFixture.github,
    context: fakeContext({ runId: 7_302 }),
    core: fakeCore(),
    prNumber: 519,
  });
  assert.equal(terminalState.status_decisions[0].state, "failure");
  assert.equal(pendingFixture.commentUpdates.length, 1);
  assert.equal(pendingFixture.commitStatuses.length, 1);
  assert.equal(pendingFixture.commitStatuses[0].state, "failure");

  const controllerTargetState = structuredClone(terminalState);
  controllerTargetState.status_decisions[0].target_url = CONTROLLER_URL;
  const controllerTargetComment = journalComment({
    events: [opened],
    selections: [selection],
    results: [terminalResult],
    state: controllerTargetState,
  });
  const changedCanonicalTargetFixture = fakeGitHub({
    pullRequest,
    comments: [controllerTargetComment],
    existingCommitStatuses: previewCommitStatuses(
      controllerTargetState.status_decisions,
    ),
  });
  const migratedTargetState = await reconcilePreview({
    github: changedCanonicalTargetFixture.github,
    context: fakeContext({ runId: 7_303 }),
    core: fakeCore(),
    prNumber: 519,
  });
  assert.equal(changedCanonicalTargetFixture.commentUpdates.length, 1);
  assert.equal(changedCanonicalTargetFixture.commitStatuses.length, 1);
  assert.equal(
    migratedTargetState.status_decisions[0].target_url,
    `https://github.com/${PREVIEW_REPOSITORY}/actions/runs/7301`,
  );
  assert.equal(
    changedCanonicalTargetFixture.commitStatuses[0].target_url,
    migratedTargetState.status_decisions[0].target_url,
  );

  const settledComment = journalComment({
    events: [opened],
    selections: [selection],
    results: [terminalResult],
    state: terminalState,
  });
  const readFailureFixture = fakeGitHub({
    pullRequest,
    comments: [settledComment],
    existingCommitStatuses: previewCommitStatuses(
      terminalState.status_decisions,
    ),
    commitStatusListFailures: [503],
  });
  const stateAfterReadFailure = await reconcilePreview({
    github: readFailureFixture.github,
    context: fakeContext({ runId: 7_304 }),
    core: fakeCore(),
    prNumber: 519,
  });
  assert.deepEqual(stateAfterReadFailure, terminalState);
  assert.equal(readFailureFixture.commentUpdates.length, 0);
  assert.equal(readFailureFixture.commitStatuses.length, 1);
  assert.equal(readFailureFixture.commitStatuses[0].state, "failure");
  assert.equal(
    readFailureFixture.commitStatuses[0].description,
    terminalState.status_decisions[0].description,
  );
  assert.equal(
    readFailureFixture.commitStatuses[0].target_url,
    terminalState.status_decisions[0].target_url,
  );

  const missingWitnessFixture = fakeGitHub({
    pullRequest,
    comments: [settledComment],
  });
  await reconcilePreview({
    github: missingWitnessFixture.github,
    context: fakeContext({ runId: 7_305 }),
    core: fakeCore(),
    prNumber: 519,
  });
  assert.equal(missingWitnessFixture.commentUpdates.length, 0);
  assert.equal(missingWitnessFixture.commitStatuses.length, 1);
  assert.equal(missingWitnessFixture.commitStatuses[0].state, "failure");

  const changedTargetStatuses = previewCommitStatuses(
    terminalState.status_decisions,
  );
  changedTargetStatuses.get(SHA.A)[0].target_url =
    "https://github.com/mento-protocol/frontend-monorepo/actions/runs/999";
  const changedTargetFixture = fakeGitHub({
    pullRequest,
    comments: [settledComment],
    existingCommitStatuses: changedTargetStatuses,
  });
  await reconcilePreview({
    github: changedTargetFixture.github,
    context: fakeContext({ runId: 7_306 }),
    core: fakeCore(),
    prNumber: 519,
  });
  assert.equal(changedTargetFixture.commentUpdates.length, 0);
  assert.equal(changedTargetFixture.commitStatuses.length, 1);
  assert.equal(
    changedTargetFixture.commitStatuses[0].target_url,
    terminalState.status_decisions[0].target_url,
  );
});

test("malformed successful planner output is recorded as fail-closed UI impact", async () => {
  const opened = event({
    run: 119,
    action: "opened",
    head: SHA.A,
    updated: timestamp(1),
  });
  const snapshot = structuredClone(opened);
  delete snapshot.plan;
  const pullRequest = pull({ head: SHA.A, updated: timestamp(1) });
  const fixture = fakeGitHub({ pullRequest, comments: [] });
  const core = fakeCore();
  const receipt = await recordEventReceipt({
    github: fixture.github,
    context: fakeContext({ runId: 119 }),
    core,
    snapshotRaw: JSON.stringify(snapshot),
    planRaw: '{"deployments":["ui"],"base":"wrong"}',
    plannerOutcome: "success",
  });
  assert.deepEqual(receipt.plan.targets, PREVIEW_TARGETS);
  assert.equal(receipt.plan.reason, "planner-job-failed");
  assert.equal(receipt.plan.base, SHA.E);
  assert.equal(receipt.plan.head, SHA.A);
  assert.equal(core.outputs.get("planner_output_invalid"), "true");
  assert.match(
    fixture.comments[0].body,
    /\*\*No reviewer action is required\.\*\*/,
  );
  assert.match(fixture.comments[0].body, /<details>/);
  assert.match(
    fixture.comments[0].body,
    /<summary>Show machine-readable preview automation record<\/summary>/,
  );
  assert.match(fixture.comments[0].body, /<\/details>\n$/);
  assert.match(fixture.comments[0].body, /"reason": "planner-job-failed"/);
  const journal = journalFromComment(fixture.comments[0]);
  assert.equal(journal.schema, PREVIEW_JOURNAL_SCHEMA);
  assert.deepEqual(journal.receipts.events, [receipt]);
  assert.deepEqual(journal.receipts.selections, []);
  assert.deepEqual(journal.receipts.worker_evidence, []);
  assert.deepEqual(journal.receipts.results, []);
  assert.equal(fixture.commitStatuses.at(-1).state, "pending");
});

test("closed event receipt keeps one stable idempotent journal and publishes no preview status", async () => {
  const opened = event({
    run: 119,
    action: "opened",
    head: SHA.A,
    updated: timestamp(1),
  });
  const closed = event({
    run: 120,
    action: "closed",
    head: SHA.A,
    updated: timestamp(2),
  });
  const snapshot = structuredClone(closed);
  delete snapshot.plan;
  const pullRequest = pull({
    head: SHA.A,
    state: "closed",
    updated: timestamp(2),
    closed: timestamp(2),
  });
  const fixture = fakeGitHub({
    pullRequest,
    comments: [journalComment({ events: [opened] })],
  });
  const core = fakeCore();
  const options = {
    github: fixture.github,
    context: fakeContext({ runId: 120 }),
    core,
    snapshotRaw: JSON.stringify(snapshot),
    planRaw: "",
    plannerOutcome: "skipped",
  };

  const first = await recordEventReceipt(options);
  const second = await recordEventReceipt(options);

  assert.equal(first.plan.reason, "closed");
  assert.deepEqual(second, first);
  assert.equal(core.outputs.get("pr_number"), "519");
  assert.equal(core.outputs.get("reconcile_required"), "true");
  assert.equal(fixture.comments.length, 1);
  assert.equal(fixture.comments[0].id, 1);
  assert.equal(fixture.commentUpdates.length, 1);
  assert.match(fixture.comments[0].body, /"event_action": "closed"/);
  assert.equal(journalFromComment(fixture.comments[0]).revision, 2);
  assert.deepEqual(
    fixture.commitStatuses.map(({ context, state }) => ({ context, state })),
    [{ context: "Vercel Preview Journal v2 / PR #519", state: "success" }],
  );

  const malformedComment = journalComment({ events: [opened, first] });
  malformedComment.body = malformedComment.body.replace(
    "Show machine-readable preview automation record",
    "Unexpected summary",
  );
  const malformedFixture = fakeGitHub({
    pullRequest,
    comments: [malformedComment],
  });
  await assert.rejects(
    reconcilePreview({
      github: malformedFixture.github,
      context: fakeContext({ runId: 120 }),
      core: fakeCore(),
      prNumber: 519,
    }),
    /Preview journal JSON block is missing/,
  );
});

test("closed event without an initialized journal is inert", async () => {
  const closed = event({
    run: 120,
    action: "closed",
    head: SHA.A,
    updated: timestamp(2),
  });
  const fixture = fakeGitHub({
    pullRequest: pull({
      head: SHA.A,
      state: "closed",
      updated: timestamp(2),
      closed: timestamp(2),
    }),
    comments: [],
  });
  const core = fakeCore();

  const first = await recordEventReceipt({
    github: fixture.github,
    context: fakeContext({ runId: 120 }),
    core,
    ...eventRecordInputs(closed),
  });
  const rerun = await recordEventReceipt({
    github: fixture.github,
    context: fakeContext({ runId: 120, runAttempt: 2 }),
    core,
    ...eventRecordInputs(closed),
  });

  assert.deepEqual(first, closed);
  assert.deepEqual(rerun, closed);
  assert.equal(core.outputs.get("pr_number"), "519");
  assert.equal(core.outputs.get("reconcile_required"), "false");
  assert.equal(fixture.comments.length, 0);
  assert.equal(fixture.commitStatuses.length, 0);
});

test("a missing close fails closed when its head proves prior journal initialization", async () => {
  const closed = event({
    run: 220,
    action: "closed",
    head: SHA.A,
    updated: timestamp(2),
  });
  const fixture = fakeGitHub({
    pullRequest: pull({
      head: SHA.A,
      state: "closed",
      updated: timestamp(2),
      closed: timestamp(2),
    }),
    comments: [],
    existingCommitStatuses: new Map([
      [
        SHA.A,
        [
          {
            context: "Vercel Preview Journal v2 / PR #519",
            state: "success",
          },
        ],
      ],
    ]),
  });
  const core = fakeCore();

  await assert.rejects(
    recordEventReceipt({
      github: fixture.github,
      context: fakeContext({ runId: 220 }),
      core,
      ...eventRecordInputs(closed),
    }),
    /missing after external initialization evidence/,
  );

  assert.equal(core.outputs.has("reconcile_required"), false);
  assert.equal(fixture.comments.length, 0);
  assert.equal(fixture.commitStatuses.length, 0);
});

test("initialization witnesses advance with every head and block recreation after deletion", async () => {
  const opened = event({
    run: 201,
    action: "opened",
    head: SHA.A,
    updated: timestamp(1),
  });
  const second = event({
    run: 202,
    action: "synchronize",
    before: SHA.A,
    head: SHA.B,
    updated: timestamp(2),
  });
  const third = event({
    run: 203,
    action: "synchronize",
    before: SHA.B,
    head: SHA.C,
    updated: timestamp(3),
  });
  const fixture = fakeGitHub({
    pullRequest: pull({ head: SHA.C, updated: timestamp(3) }),
    pullRequests: [
      pull({ head: SHA.A, updated: timestamp(1) }),
      pull({ head: SHA.A, updated: timestamp(1) }),
      pull({ head: SHA.B, updated: timestamp(2) }),
      pull({ head: SHA.B, updated: timestamp(2) }),
    ],
    comments: [],
  });

  await recordEventReceipt({
    github: fixture.github,
    context: fakeContext({ runId: 201 }),
    core: fakeCore(),
    ...eventRecordInputs(opened),
  });
  await recordEventReceipt({
    github: fixture.github,
    context: fakeContext({ runId: 202 }),
    core: fakeCore(),
    ...eventRecordInputs(second),
  });

  assert.deepEqual(
    fixture.commitStatuses
      .filter(
        ({ context }) => context === "Vercel Preview Journal v2 / PR #519",
      )
      .map(({ sha }) => sha),
    [SHA.A, SHA.B],
  );
  assert.deepEqual(
    journalFromComment(fixture.comments[0]).receipts.events.map(
      ({ event_run_id: runId }) => runId,
    ),
    [201, 202],
  );

  fixture.comments.splice(0);
  await assert.rejects(
    recordEventReceipt({
      github: fixture.github,
      context: fakeContext({ runId: 203 }),
      core: fakeCore(),
      ...eventRecordInputs(third),
    }),
    /missing after external initialization evidence/,
  );
  assert.equal(fixture.comments.length, 0);
  assert.equal(
    fixture.commitStatuses.some(({ sha }) => sha === SHA.C),
    false,
  );
});

test("a rerun repairs a witness after its first status write fails", async () => {
  const opened = event({
    run: 211,
    action: "opened",
    head: SHA.A,
    updated: timestamp(1),
  });
  const fixture = fakeGitHub({
    pullRequest: pull({ head: SHA.A, updated: timestamp(1) }),
    comments: [],
    commitStatusFailures: [503],
  });

  await assert.rejects(
    recordEventReceipt({
      github: fixture.github,
      context: fakeContext({ runId: 211 }),
      core: fakeCore(),
      ...eventRecordInputs(opened),
    }),
    /fixture commit status write failed/,
  );
  assert.equal(fixture.comments.length, 1);
  assert.equal(journalFromComment(fixture.comments[0]).revision, 1);
  assert.equal(fixture.commitStatuses.length, 0);

  const core = fakeCore();
  await recordEventReceipt({
    github: fixture.github,
    context: fakeContext({ runId: 211, runAttempt: 2 }),
    core,
    ...eventRecordInputs(opened),
  });

  assert.equal(journalFromComment(fixture.comments[0]).revision, 1);
  assert.equal(fixture.commentUpdates.length, 0);
  assert.deepEqual(
    fixture.commitStatuses.map(({ context, state }) => ({ context, state })),
    [
      { context: "Vercel Preview Journal v2 / PR #519", state: "success" },
      { context: "Vercel Preview", state: "pending" },
    ],
  );
  assert.equal(core.outputs.get("reconcile_required"), "true");
});

test("stale non-closed events remain inert after an empty-journal close wins", async () => {
  const cases = [
    {
      delayed: event({
        run: 231,
        action: "opened",
        head: SHA.A,
        updated: timestamp(1),
      }),
      closed: event({
        run: 232,
        action: "closed",
        head: SHA.A,
        updated: timestamp(2),
      }),
      current: pull({
        head: SHA.A,
        state: "closed",
        updated: timestamp(2),
        closed: timestamp(2),
      }),
    },
    {
      delayed: event({
        run: 241,
        action: "synchronize",
        before: SHA.A,
        head: SHA.B,
        updated: timestamp(2),
      }),
      closed: event({
        run: 242,
        action: "closed",
        head: SHA.B,
        updated: timestamp(3),
      }),
      current: pull({
        head: SHA.B,
        state: "closed",
        updated: timestamp(3),
        closed: timestamp(3),
      }),
    },
  ];

  for (const { delayed, closed, current } of cases) {
    const fixture = fakeGitHub({ pullRequest: current, comments: [] });
    const closeCore = fakeCore();
    await recordEventReceipt({
      github: fixture.github,
      context: fakeContext({ runId: closed.event_run_id }),
      core: closeCore,
      ...eventRecordInputs(closed),
    });
    assert.equal(closeCore.outputs.get("reconcile_required"), "false");

    const delayedCore = fakeCore();
    const recorded = await recordEventReceipt({
      github: fixture.github,
      context: fakeContext({ runId: delayed.event_run_id }),
      core: delayedCore,
      ...eventRecordInputs(delayed),
    });
    assert.deepEqual(recorded, delayed);
    assert.equal(delayedCore.outputs.get("reconcile_required"), "false");
    assert.equal(fixture.comments.length, 0);
    assert.equal(fixture.commentUpdates.length, 0);
    assert.equal(fixture.commitStatuses.length, 0);
    assert.equal(fixture.dispatches.length, 0);
  }
});

test("the first receipt after a terminal checkpoint remains live for reconciliation", async () => {
  const opened = event({
    run: 250,
    action: "opened",
    head: SHA.A,
    updated: timestamp(1),
  });
  const firstPull = pull({ head: SHA.A, updated: timestamp(1) });
  const selected = reconcile({ events: [opened], pullRequest: firstPull });
  const active = persistDispatch(selected, 60_000);
  const selection = selectionReceiptFromDispatch(active.targets.ui.active);
  const terminalResult = result(selected.nextDispatch, { runId: 60_000 });
  const terminalState = reconcile({
    events: [opened],
    results: [terminalResult],
    selections: [selection],
    pullRequest: firstPull,
    existingState: active,
  }).state;
  const checkpointed = compactPreviewJournal(
    createPreviewJournal({
      pr: 519,
      events: [opened],
      selections: [selection],
      results: [terminalResult],
      state: terminalState,
    }),
  );
  const docs = event({
    run: 251,
    action: "synchronize",
    before: SHA.A,
    head: SHA.B,
    runtime: false,
    updated: timestamp(2),
  });
  const fixture = fakeGitHub({
    pullRequest: pull({ head: SHA.B, updated: timestamp(2) }),
    comments: [
      journalComment({
        checkpoint: checkpointed.checkpoint,
        state: checkpointed.state,
      }),
    ],
  });

  await recordEventReceipt({
    github: fixture.github,
    context: fakeContext({ runId: 251 }),
    core: fakeCore(),
    ...eventRecordInputs(docs),
  });
  const persisted = journalFromComment(fixture.comments[0]);
  assert.equal(persisted.checkpoint.through_event_run_id, opened.event_run_id);
  assert.deepEqual(persisted.receipts.events, [docs]);

  const reconciled = await reconcilePreview({
    github: fixture.github,
    context: fakeContext({ runId: 252 }),
    core: fakeCore(),
    prNumber: 519,
  });
  assert.equal(reconciled.epoch.tail_receipt_run_id, docs.event_run_id);
  assert.equal(reconciled.status_decisions.at(-1).state, "success");
});

test("queued receipts after a terminal checkpoint preserve every transition", async () => {
  const opened = event({
    run: 260,
    action: "opened",
    head: SHA.A,
    updated: timestamp(1),
  });
  const firstPull = pull({ head: SHA.A, updated: timestamp(1) });
  const selected = reconcile({ events: [opened], pullRequest: firstPull });
  const active = persistDispatch(selected, 61_000);
  const selection = selectionReceiptFromDispatch(active.targets.ui.active);
  const terminalResult = result(selected.nextDispatch, { runId: 61_000 });
  const terminalState = reconcile({
    events: [opened],
    results: [terminalResult],
    selections: [selection],
    pullRequest: firstPull,
    existingState: active,
  }).state;
  const checkpointed = compactPreviewJournal(
    createPreviewJournal({
      pr: 519,
      events: [opened],
      selections: [selection],
      results: [terminalResult],
      state: terminalState,
    }),
  );
  const docsB = event({
    run: 261,
    action: "synchronize",
    before: SHA.A,
    head: SHA.B,
    runtime: false,
    updated: timestamp(2),
  });
  const docsC = event({
    run: 262,
    action: "synchronize",
    before: SHA.B,
    head: SHA.C,
    runtime: false,
    updated: timestamp(3),
  });
  const pullB = pull({ head: SHA.B, updated: timestamp(2) });
  const pullC = pull({ head: SHA.C, updated: timestamp(3) });
  const fixture = fakeGitHub({
    pullRequest: pullC,
    pullRequests: [pullB, pullB, pullC, pullC],
    comments: [
      journalComment({
        checkpoint: checkpointed.checkpoint,
        state: checkpointed.state,
      }),
    ],
  });

  await recordEventReceipt({
    github: fixture.github,
    context: fakeContext({ runId: docsB.event_run_id }),
    core: fakeCore(),
    ...eventRecordInputs(docsB),
  });
  await recordEventReceipt({
    github: fixture.github,
    context: fakeContext({ runId: docsC.event_run_id }),
    core: fakeCore(),
    ...eventRecordInputs(docsC),
  });
  const persisted = journalFromComment(fixture.comments[0]);
  assert.equal(persisted.checkpoint.through_event_run_id, opened.event_run_id);
  assert.deepEqual(persisted.receipts.events, [docsB, docsC]);

  const reconciled = await reconcilePreview({
    github: fixture.github,
    context: fakeContext({ runId: 263 }),
    core: fakeCore(),
    prNumber: 519,
  });
  assert.equal(reconciled.epoch.tail_receipt_run_id, docsC.event_run_id);
  assert.equal(reconciled.status_decisions.at(-1).state, "success");
});

test("semantic aliases of checkpointed lifecycle tails are idempotent", async () => {
  const checkpointCases = [];
  for (const [index, action] of ["opened", "reopened", "bootstrap"].entries()) {
    const opened = event({
      run: 1_600 + index,
      action: "opened",
      head: SHA.A,
      runtime: false,
      updated: timestamp(1),
    });
    const tail =
      action === "opened"
        ? opened
        : validateEventReceipt({
            ...structuredClone(opened),
            event_action: action,
          });
    const currentPull = pull({ head: SHA.A, updated: timestamp(1) });
    const state = reconcile({
      events: [tail],
      pullRequest: currentPull,
    }).state;
    checkpointCases.push({ action, events: [tail], currentPull, state });
  }

  const openedForClose = event({
    run: 1_610,
    action: "opened",
    head: SHA.A,
    runtime: false,
    updated: timestamp(1),
  });
  const closed = event({
    run: 1_611,
    action: "closed",
    head: SHA.A,
    updated: timestamp(2),
  });
  const closedPull = pull({
    head: SHA.A,
    state: "closed",
    updated: timestamp(2),
    closed: timestamp(2),
  });
  checkpointCases.push({
    action: "closed",
    events: [openedForClose, closed],
    currentPull: closedPull,
    state: reconcile({
      events: [openedForClose, closed],
      pullRequest: closedPull,
    }).state,
  });

  let openedCheckpoint;
  for (const checkpointCase of checkpointCases) {
    const checkpointed = compactPreviewJournal(
      createPreviewJournal({
        pr: 519,
        events: checkpointCase.events,
        state: checkpointCase.state,
      }),
    );
    const duplicate = {
      ...structuredClone(checkpointed.checkpoint.event),
      event_run_id: checkpointed.checkpoint.event.event_run_id + 100,
    };
    const fixture = fakeGitHub({
      pullRequest: checkpointCase.currentPull,
      comments: [
        journalComment({
          checkpoint: checkpointed.checkpoint,
          state: checkpointed.state,
        }),
      ],
    });
    await recordEventReceipt({
      github: fixture.github,
      context: fakeContext({ runId: duplicate.event_run_id }),
      core: fakeCore(),
      ...eventRecordInputs(duplicate),
    });
    const persisted = journalFromComment(fixture.comments[0]);
    assert.equal(
      persisted.checkpoint.through_event_run_id,
      checkpointed.checkpoint.through_event_run_id,
      checkpointCase.action,
    );
    assert.deepEqual(persisted.receipts.events, [], checkpointCase.action);
    assert.equal(fixture.commentUpdates.length, 0, checkpointCase.action);
    assert.throws(
      () =>
        createPreviewJournal({
          pr: 519,
          checkpoint: checkpointed.checkpoint,
          events: [duplicate],
          state: checkpointed.state,
        }),
      /semantic duplicate in live receipts/,
      checkpointCase.action,
    );
    if (checkpointCase.action === "opened") {
      openedCheckpoint = { checkpointed, fixture };
    }
  }

  const conflicting = structuredClone(
    openedCheckpoint.checkpointed.checkpoint.event,
  );
  conflicting.head_sha = SHA.B;
  conflicting.plan.head = SHA.B;
  await assert.rejects(
    recordEventReceipt({
      github: openedCheckpoint.fixture.github,
      context: fakeContext({ runId: conflicting.event_run_id }),
      core: fakeCore(),
      ...eventRecordInputs(conflicting),
    }),
    /Conflicting event receipt at preview checkpoint/,
  );
  assert.equal(openedCheckpoint.fixture.commentUpdates.length, 0);

  const semanticReplay = {
    ...structuredClone(openedCheckpoint.checkpointed.checkpoint.event),
    event_run_id:
      openedCheckpoint.checkpointed.checkpoint.event.event_run_id + 200,
  };
  const liveConflict = event({
    run: semanticReplay.event_run_id,
    action: "synchronize",
    before: SHA.A,
    head: SHA.B,
    updated: timestamp(2),
  });
  const liveConflictFixture = fakeGitHub({
    pullRequest: pull({ head: SHA.B, updated: timestamp(2) }),
    comments: [
      journalComment({
        checkpoint: openedCheckpoint.checkpointed.checkpoint,
        events: [liveConflict],
        state: openedCheckpoint.checkpointed.state,
      }),
    ],
  });
  await assert.rejects(
    recordEventReceipt({
      github: liveConflictFixture.github,
      context: fakeContext({ runId: semanticReplay.event_run_id }),
      core: fakeCore(),
      ...eventRecordInputs(semanticReplay),
    }),
    /Conflicting event receipt in preview journal/,
  );
  assert.equal(liveConflictFixture.commentUpdates.length, 0);
});

test("a first-attempt synchronize can initialize only without durable status evidence", async () => {
  const synchronize = event({
    run: 121,
    action: "synchronize",
    before: SHA.B,
    head: SHA.A,
    updated: timestamp(2),
  });
  const opened = event({
    run: 122,
    action: "opened",
    head: SHA.B,
    updated: timestamp(1),
  });

  const fresh = fakeGitHub({
    pullRequest: pull({
      head: synchronize.head_sha,
      updated: synchronize.pr_updated_at,
    }),
    comments: [],
  });
  await recordEventReceipt({
    github: fresh.github,
    context: fakeContext({ runId: 121 }),
    core: fakeCore(),
    ...eventRecordInputs(synchronize),
  });
  assert.deepEqual(journalFromComment(fresh.comments[0]).receipts.events, [
    synchronize,
  ]);
  assert.deepEqual(
    fresh.commitStatuses.slice(0, 2).map(({ context, state }) => ({
      context,
      state,
    })),
    [
      { context: "Vercel Preview Journal v2 / PR #519", state: "success" },
      { context: "Vercel Preview", state: "pending" },
    ],
  );
  assert.equal(
    fresh.commitStatuses[0].description,
    "Preview journal initialized",
  );
  assert.equal(fresh.commitStatuses.at(-1).state, "pending");
  await recordEventReceipt({
    github: fresh.github,
    context: fakeContext({ runId: 122 }),
    core: fakeCore(),
    ...eventRecordInputs(opened),
  });
  assert.deepEqual(
    journalFromComment(fresh.comments[0]).receipts.events.map(
      ({ event_run_id: runId }) => runId,
    ),
    [121, 122],
  );
  const recovered = await reconcilePreview({
    github: fresh.github,
    context: fakeContext({ runId: 123 }),
    core: fakeCore(),
    prNumber: 519,
  });
  assert.equal(recovered.targets.ui.active.selection_receipt_run_id, 121);

  const rerun = fakeGitHub({
    pullRequest: pull({ head: opened.head_sha, updated: opened.pr_updated_at }),
    comments: [],
  });
  await assert.rejects(
    recordEventReceipt({
      github: rerun.github,
      context: fakeContext({ runId: 122, runAttempt: 2 }),
      core: fakeCore(),
      ...eventRecordInputs(opened),
    }),
    /Preview journal comment does not exist/,
  );

  const reusedBase = fakeGitHub({
    pullRequest: pull({
      head: synchronize.head_sha,
      updated: synchronize.pr_updated_at,
    }),
    comments: [],
    existingCommitStatuses: new Map([
      [
        synchronize.change_base_sha,
        [
          {
            context: "Vercel Preview Journal v2 / PR #518",
            state: "success",
          },
        ],
      ],
    ]),
  });
  await recordEventReceipt({
    github: reusedBase.github,
    context: fakeContext({ runId: 121 }),
    core: fakeCore(),
    ...eventRecordInputs(synchronize),
  });
  assert.deepEqual(journalFromComment(reusedBase.comments[0]).receipts.events, [
    synchronize,
  ]);

  const initialized = fakeGitHub({
    pullRequest: pull({
      head: synchronize.head_sha,
      updated: synchronize.pr_updated_at,
    }),
    comments: [],
    existingCommitStatuses: new Map([
      [
        synchronize.change_base_sha,
        [
          {
            context: "Vercel Preview Journal v2 / PR #519",
            state: "success",
          },
        ],
      ],
    ]),
  });
  await assert.rejects(
    recordEventReceipt({
      github: initialized.github,
      context: fakeContext({ runId: 121 }),
      core: fakeCore(),
      ...eventRecordInputs(synchronize),
    }),
    /missing after external initialization evidence/,
  );
  assert.equal(initialized.comments.length, 0);
});

test("conflicting event transitions cannot replace an immutable journal receipt", async () => {
  const opened = event({
    run: 130,
    action: "opened",
    head: SHA.A,
    updated: timestamp(1),
  });
  const conflicting = event({
    run: 130,
    action: "synchronize",
    before: SHA.B,
    head: SHA.A,
    updated: timestamp(1),
  });
  const fixture = fakeGitHub({
    pullRequest: pull({ head: SHA.A, updated: timestamp(1) }),
    comments: [journalComment({ events: [conflicting] })],
  });

  await assert.rejects(
    recordEventReceipt({
      github: fixture.github,
      context: fakeContext({ runId: 130 }),
      core: fakeCore(),
      ...eventRecordInputs(opened),
    }),
    /Conflicting event receipt in preview journal/,
  );

  assert.equal(fixture.comments.length, 1);
  assert.deepEqual(journalFromComment(fixture.comments[0]).receipts.events, [
    conflicting,
  ]);
  assert.equal(fixture.commentUpdates.length, 0);
});

test("duplicate bot-owned preview journals fail closed", async () => {
  const opened = event({
    run: 131,
    action: "opened",
    head: SHA.A,
    updated: timestamp(1),
  });
  const fixture = fakeGitHub({
    pullRequest: pull({ head: SHA.A, updated: timestamp(1) }),
    comments: [
      journalComment({ events: [opened] }, 1),
      journalComment({ events: [opened] }, 2),
    ],
  });

  await assert.rejects(
    reconcilePreview({
      github: fixture.github,
      context: fakeContext(),
      core: fakeCore(),
      prNumber: 519,
    }),
    /Multiple bot-owned preview journals exist/,
  );
  assert.equal(fixture.commentUpdates.length, 0);
});

test("malformed and oversized preview journals fail closed without mutation", async () => {
  const opened = event({
    run: 132,
    action: "opened",
    head: SHA.A,
    updated: timestamp(1),
  });
  const malformed = journalComment({ events: [opened] });
  const malformedValue = journalFromComment(malformed);
  malformedValue.journal_digest = "0".repeat(64);
  malformed.body = previewJournalBody(malformedValue);
  const oversized = {
    id: 2,
    user: { type: "Bot", login: "github-actions[bot]" },
    body: `${PREVIEW_JOURNAL_MARKER}\n${"x".repeat(70_000)}`,
  };
  const noncanonical = journalComment({ events: [opened] });
  noncanonical.body = noncanonical.body.replace(
    '  "schema": "vercel-preview-journal:v2",',
    '    "schema": "vercel-preview-journal:v2",',
  );

  for (const [comment, message] of [
    [malformed, /Preview journal digest mismatch/],
    [oversized, /Preview journal comment is too large/],
    [noncanonical, /Preview journal body is not canonical/],
  ]) {
    const fixture = fakeGitHub({
      pullRequest: pull({ head: SHA.A, updated: timestamp(1) }),
      comments: [comment],
    });
    await assert.rejects(
      reconcilePreview({
        github: fixture.github,
        context: fakeContext(),
        core: fakeCore(),
        prNumber: 519,
      }),
      message,
    );
    assert.equal(fixture.commentUpdates.length, 0);
  }
});

test("pre-cutover receipt comments are ignored when the canonical journal is created", async () => {
  const opened = event({
    run: 133,
    action: "opened",
    head: SHA.A,
    updated: timestamp(1),
  });
  const oldComment = oldReceiptComment(
    "<!-- vercel-preview-event-receipt:v1:run:133 -->",
    opened,
  );
  const fixture = fakeGitHub({
    pullRequest: pull({ head: SHA.A, updated: timestamp(1) }),
    comments: [oldComment],
  });

  await recordEventReceipt({
    github: fixture.github,
    context: fakeContext({ runId: 133 }),
    core: fakeCore(),
    ...eventRecordInputs(opened),
  });

  assert.equal(fixture.comments.length, 2);
  assert.deepEqual(fixture.comments[0], oldComment);
  assert.equal(
    fixture.comments.filter(({ body }) =>
      body.startsWith(PREVIEW_JOURNAL_MARKER),
    ).length,
    1,
  );
  assert.deepEqual(journalFromComment(fixture.comments[1]).receipts.events, [
    opened,
  ]);
});

test("closed reconciliation preserves an unbound intent without dispatching it", async () => {
  const opened = event({
    run: 119,
    action: "opened",
    head: SHA.A,
    updated: timestamp(1),
  });
  const openedPull = pull({ head: SHA.A, updated: timestamp(1) });
  const selected = reconcile({
    events: [opened],
    pullRequest: openedPull,
  });
  const intended = persistIntent(selected);
  const closed = event({
    run: 120,
    action: "closed",
    head: SHA.A,
    updated: timestamp(2),
  });
  const pullRequest = pull({
    head: SHA.A,
    state: "closed",
    updated: timestamp(2),
    closed: timestamp(2),
  });
  const fixture = fakeGitHub({
    pullRequest,
    comments: [
      journalComment({
        events: [opened, closed],
        selections: [selectionReceiptFromDispatch(intended.targets.ui.active)],
        state: intended,
      }),
    ],
  });

  const state = await reconcilePreview({
    github: fixture.github,
    context: fakeContext({ runId: 120 }),
    core: fakeCore(),
    prNumber: 519,
  });

  assert.equal(state.closed, true);
  assert.equal(state.epoch.closed_at, timestamp(2));
  assert.equal(fixture.dispatches.length, 0);
  assert.equal(fixture.workflowRunListRequests.length, 0);
  assert.equal(fixture.workflowRunRequests.length, 0);
  assert.equal(
    fixture.commitStatuses.some(({ state: status }) => status === "error"),
    false,
  );
  assert.equal(fixture.comments.length, 1);
  const journal = journalFromComment(fixture.comments[0]);
  assert.equal(journal.schema, PREVIEW_JOURNAL_SCHEMA);
  assert.equal(journal.state.closed, true);
});

test("trusted workflow_run follow-up binds the candidate PR ref and publishes Dependabot unsupported status only for the exact current head", async () => {
  const workflowRun = dependabotIntakeRun();
  assert.equal(workflowRun.head_branch, "dependabot/npm/pnpm");
  assert.equal(workflowRun.head_sha, SHA.A);
  assert.equal(workflowRun.pull_requests[0].base.ref, "main");
  assert.deepEqual(validateDependabotIntakeWorkflowRun(workflowRun), {
    pr: 519,
    sha: SHA.A,
    action: "opened",
  });
  assert.deepEqual(
    validateDependabotIntakeWorkflowRun({
      ...workflowRun,
      name: workflowRun.display_title,
    }),
    {
      pr: 519,
      sha: SHA.A,
      action: "opened",
    },
  );
  const dependabotPull = pull({
    head: SHA.A,
    updated: timestamp(1),
    author: "dependabot[bot]",
    ref: "dependabot/npm/pnpm",
  });
  const exact = fakeGitHub({ pullRequest: dependabotPull, comments: [] });
  const exactCore = fakeCore();
  const published = await publishDependabotUnsupported({
    github: exact.github,
    context: fakeContext({ workflowRun }),
    core: exactCore,
  });
  assert.deepEqual(published, { pr: 519, sha: SHA.A, action: "opened" });
  assert.equal(exact.commitStatuses.length, 1);
  assert.deepEqual(
    {
      sha: exact.commitStatuses[0].sha,
      state: exact.commitStatuses[0].state,
      context: exact.commitStatuses[0].context,
      description: exact.commitStatuses[0].description,
    },
    {
      sha: SHA.A,
      state: "success",
      context: "Vercel Preview",
      description: "Preview disabled for Dependabot PR",
    },
  );
  assert.equal(exactCore.outputs.get("status_published"), "true");

  for (const currentPull of [
    pull({
      head: SHA.B,
      updated: timestamp(2),
      author: "dependabot[bot]",
      ref: "dependabot/npm/pnpm",
    }),
    pull({ head: SHA.A, updated: timestamp(1) }),
  ]) {
    const stale = fakeGitHub({ pullRequest: currentPull, comments: [] });
    const staleCore = fakeCore();
    assert.equal(
      await publishDependabotUnsupported({
        github: stale.github,
        context: fakeContext({ workflowRun }),
        core: staleCore,
      }),
      null,
    );
    assert.equal(stale.commitStatuses.length, 0);
    assert.equal(staleCore.outputs.get("status_published"), "false");
  }
});

test("closed Dependabot intake without a GitHub PR association stays write-inert", async () => {
  const workflowRun = dependabotIntakeRun({
    action: "closed",
    pull_requests: [],
  });
  assert.deepEqual(validateDependabotIntakeWorkflowRun(workflowRun), {
    pr: 519,
    sha: SHA.A,
    action: "closed",
  });
  const fixture = fakeGitHub({
    pullRequest: pull({
      head: SHA.A,
      state: "closed",
      author: "dependabot[bot]",
      ref: "dependabot/npm/pnpm",
      updated: timestamp(2),
    }),
    comments: [],
  });
  const core = fakeCore();
  assert.equal(
    await publishDependabotUnsupported({
      github: fixture.github,
      context: fakeContext({ workflowRun }),
      core,
    }),
    null,
  );
  assert.equal(fixture.commitStatuses.length, 0);
  assert.equal(core.outputs.get("status_published"), "false");
});

test("malformed Dependabot intake identity fails before any status write", async () => {
  const mismatchedHeadRef = dependabotIntakeRun();
  mismatchedHeadRef.pull_requests[0].head.ref = "dependabot/npm/other";
  const mismatchedLinkedHeadSha = dependabotIntakeRun();
  mismatchedLinkedHeadSha.pull_requests[0].head.sha = SHA.B;
  const mismatchedLinkedPull = dependabotIntakeRun();
  mismatchedLinkedPull.pull_requests[0].number = 520;
  const mismatchedLinkedPullUrl = dependabotIntakeRun();
  mismatchedLinkedPullUrl.pull_requests[0].url =
    "https://api.github.com/repos/attacker/example/pulls/519";
  const mismatchedLinkedHeadRepository = dependabotIntakeRun();
  mismatchedLinkedHeadRepository.pull_requests[0].head.repo.url =
    "https://api.github.com/repos/attacker/example";
  const multipleLinkedPulls = dependabotIntakeRun();
  multipleLinkedPulls.pull_requests.push(
    structuredClone(multipleLinkedPulls.pull_requests[0]),
  );
  const closedWithConflictingLink = dependabotIntakeRun({ action: "closed" });
  closedWithConflictingLink.pull_requests[0].head.sha = SHA.B;
  for (const workflowRun of [
    dependabotIntakeRun({ name: "Vercel Preview Worker" }),
    dependabotIntakeRun({
      path: ".github/workflows/vercel-preview-intake.yml@feature",
    }),
    dependabotIntakeRun({
      display_title: `Vercel preview intake | pr=519 | sha=${SHA.A} | action=bogus`,
    }),
    dependabotIntakeRun({
      repository: { full_name: "attacker/example" },
    }),
    dependabotIntakeRun({ head_sha: SHA.B }),
    dependabotIntakeRun({ pull_requests: [] }),
    mismatchedHeadRef,
    mismatchedLinkedHeadSha,
    mismatchedLinkedPull,
    mismatchedLinkedPullUrl,
    mismatchedLinkedHeadRepository,
    multipleLinkedPulls,
    dependabotIntakeRun({ baseRef: "feature/untrusted-base" }),
    dependabotIntakeRun({ baseRepository: "attacker/example" }),
    closedWithConflictingLink,
  ]) {
    const fixture = fakeGitHub({
      pullRequest: pull({
        head: SHA.A,
        updated: timestamp(1),
        author: "dependabot[bot]",
        ref: "dependabot/npm/pnpm",
      }),
      comments: [],
    });
    await assert.rejects(
      publishDependabotUnsupported({
        github: fixture.github,
        context: fakeContext({ workflowRun }),
        core: fakeCore(),
      }),
      /Dependabot intake/,
    );
    assert.equal(fixture.commitStatuses.length, 0);
  }
});

test("strict worker identity uses display_title plus workflow path, ref, SHA, and attempt", () => {
  const opened = event({
    run: 120,
    action: "opened",
    head: SHA.A,
    updated: timestamp(1),
  });
  const selection = reconcile({
    events: [opened],
    pullRequest: pull({ head: SHA.A, updated: timestamp(1) }),
  }).nextDispatch;
  const run = workerRun(selection);
  assert.deepEqual(parseWorkerRunName(run.display_title), {
    pr: selection.pr,
    target: "ui",
    sha: selection.sha,
    keyDigest: selection.key_digest,
  });
  assert.equal(
    validateWorkerRunIdentity(run, selection).workflow_run_id,
    8_000,
  );
  assert.equal(
    validateWorkerRunIdentity(
      { ...run, path: ".github/workflows/vercel-preview-worker.yml" },
      selection,
    ).workflow_run_id,
    8_000,
  );
  assert.equal(
    validateWorkerRunIdentity({ ...run, name: run.display_title }, selection)
      .workflow_run_id,
    8_000,
  );
  for (const override of [
    { display_title: "Vercel Preview Worker" },
    { name: "Another Workflow" },
    { path: ".github/workflows/vercel-preview-worker.yml@feature" },
    { path: ".github/workflows/other.yml@main" },
    { event: "push" },
    { head_branch: "feature" },
    { head_sha: SHA.D },
    { run_attempt: 0 },
    { repository: { full_name: "attacker/example" } },
  ]) {
    assert.throws(() =>
      validateWorkerRunIdentity({ ...run, ...override }, selection),
    );
  }
});

test("worker preflight rejects expected A versus actual B before any API access", async () => {
  const opened = event({
    run: 120,
    action: "opened",
    head: SHA.A,
    updated: timestamp(1),
  });
  const pullRequest = pull({ head: SHA.A, updated: timestamp(1) });
  const authorizedA = reconcile({
    events: [opened],
    pullRequest,
    expectedWorkflowSha: SHA.A,
  }).nextDispatch;
  const authorizedB = reconcile({
    events: [opened],
    pullRequest,
    expectedWorkflowSha: SHA.B,
  }).nextDispatch;
  assert.notEqual(authorizedA.key_digest, authorizedB.key_digest);

  let apiCalls = 0;
  const github = {
    rest: {
      pulls: {
        async get() {
          apiCalls += 1;
          throw new Error("worker preflight reached GitHub unexpectedly");
        },
      },
    },
  };
  await assert.rejects(
    validateWorkerDispatch({
      github,
      context: fakeContext({ runId: 8_000 }),
      core: fakeCore(),
      inputs: workerInputs(authorizedA),
      workflowSha: SHA.B,
    }),
    /Actual worker workflow SHA does not match controller-authorized SHA/,
  );
  assert.equal(apiCalls, 0);
});

test("worker preflight permits GitHub canaries for every native-owned shadow target", async () => {
  for (const [index, target] of ["app", "governance", "reserve"].entries()) {
    const opened = event({
      run: 116 + index,
      action: "opened",
      head: SHA.A,
      updated: timestamp(1),
      targets: [target],
    });
    const pullRequest = pull({ head: SHA.A, updated: timestamp(1) });
    const selected = reconcile({ events: [opened], pullRequest });
    const dispatch = selected.nextDispatches.find(
      (candidate) => candidate.target === target,
    );
    assert.ok(dispatch);
    const intended = persistAllIntents(selected);
    const fixture = fakeGitHub({
      pullRequest,
      comments: [journalWithState([opened], intended)],
    });
    const core = fakeCore();

    const decision = await validateWorkerDispatch({
      github: fixture.github,
      context: fakeContext({ runId: 8_000 + index }),
      core,
      inputs: workerInputs(dispatch),
    });

    assert.equal(decision.shouldDeploy, true);
    assert.equal(core.outputs.get("should_deploy"), "true");
    assert.equal(fixture.deploymentLookupCallCount, 1);
    assert.deepEqual(
      fixture.contentRequests.map(({ path, ref }) => [path, ref]),
      [[PREVIEW_TARGET_CONFIG[target].vercelConfigurationPath, SHA.A]],
    );
  }
});

test("worker preflight rechecks the immutable selected SHA ownership before deployment work", async () => {
  const opened = event({
    run: 120,
    action: "opened",
    head: SHA.A,
    updated: timestamp(1),
  });
  const synchronized = event({
    run: 121,
    action: "synchronize",
    before: SHA.A,
    head: SHA.B,
    updated: timestamp(2),
  });
  const pullRequest = pull({ head: SHA.B, updated: timestamp(2) });
  const selected = reconcile({
    events: [opened, synchronized],
    pullRequest,
  });
  assert.equal(selected.nextDispatch.sha, SHA.A);
  const intended = persistIntent(selected);
  const fixture = fakeGitHub({
    pullRequest,
    pullCommits: [SHA.A, SHA.B],
    comments: [journalWithState([opened, synchronized], intended)],
    uiVercelConfigurationsByRef: new Map([
      [SHA.A, NATIVE_OWNED_UI_VERCEL_CONFIGURATION],
      [SHA.B, GITHUB_OWNED_UI_VERCEL_CONFIGURATION],
    ]),
  });
  const core = fakeCore();

  await assert.rejects(
    validateWorkerDispatch({
      github: fixture.github,
      context: fakeContext({ runId: 8_000 }),
      core,
      inputs: workerInputs(selected.nextDispatch),
    }),
    /not allowed for the selected ui configuration/,
  );

  assert.deepEqual(
    fixture.contentRequests.map(({ ref }) => ref),
    [SHA.B, SHA.A],
  );
  assert.equal(fixture.deployments.length, 0);
  assert.equal(core.outputs.has("should_deploy"), false);
  assert.equal(fixture.deploymentLookupCallCount, 0);
});

test("worker preflight rejects native-owned current head before deployment lookup", async () => {
  const opened = event({
    run: 120,
    action: "opened",
    head: SHA.A,
    updated: timestamp(1),
  });
  const synchronized = event({
    run: 121,
    action: "synchronize",
    before: SHA.A,
    head: SHA.B,
    updated: timestamp(2),
  });
  const pullRequest = pull({ head: SHA.B, updated: timestamp(2) });
  const selected = reconcile({
    events: [opened, synchronized],
    pullRequest,
  });
  assert.equal(selected.nextDispatch.sha, SHA.A);
  const intended = persistIntent(selected);
  const fixture = fakeGitHub({
    pullRequest,
    pullCommits: [SHA.A, SHA.B],
    comments: [journalWithState([opened, synchronized], intended)],
    uiVercelConfigurationsByRef: new Map([
      [SHA.A, GITHUB_OWNED_UI_VERCEL_CONFIGURATION],
      [SHA.B, NATIVE_OWNED_UI_VERCEL_CONFIGURATION],
    ]),
  });
  const core = fakeCore();

  await assert.rejects(
    validateWorkerDispatch({
      github: fixture.github,
      context: fakeContext({ runId: 8_000 }),
      core,
      inputs: workerInputs(selected.nextDispatch),
    }),
    /not allowed for the current ui configuration/,
  );

  assert.deepEqual(
    fixture.contentRequests.map(({ ref }) => ref),
    [SHA.B],
  );
  assert.equal(fixture.deploymentLookupCallCount, 0);
  assert.equal(fixture.deployments.length, 0);
  assert.equal(core.outputs.has("should_deploy"), false);
});

test("durable dispatch persists intent and waits for the exact run title to materialize", async () => {
  const opened = event({
    run: 121,
    action: "opened",
    head: SHA.A,
    updated: timestamp(1),
  });
  const pullRequest = pull({ head: SHA.A, updated: timestamp(1) });
  const fixture = fakeGitHub({
    pullRequest,
    comments: [journalComment({ events: [opened] })],
    workflowRunDisplayTitles: Array(10).fill("Vercel Preview Worker"),
  });
  const core = fakeCore();
  const waits = [];
  const state = await reconcilePreview({
    github: fixture.github,
    context: fakeContext(),
    core,
    prNumber: 519,
    waitForRecovery: async (milliseconds) => waits.push(milliseconds),
  });
  assert.equal(fixture.dispatches.length, 1);
  assert.equal(fixture.workerDispatchRequests.length, 1);
  assert.equal(
    fixture.workerDispatchRequests[0].route,
    "POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches",
  );
  assert.equal(
    fixture.primaryRequests.some(({ route }) => route.includes("/dispatches")),
    false,
  );
  assert.equal(state.targets.ui.active.dispatch_state, "dispatched");
  assert.equal(state.targets.ui.active.workflow_run_id, 8_000);
  assert.equal(state.targets.ui.active.workflow_sha, SHA.E);
  assert.deepEqual(waits, [500, 500, ...Array(10).fill(1_000)]);
  assert.deepEqual(fixture.workflowRunRequests, Array(11).fill(8_000));
  assert.equal(core.outputs.get("dispatched_run_ids"), "[8000]");
  assert.equal(fixture.commitStatuses.at(-1).context, "Vercel Preview");
  assert.equal(fixture.commitStatuses.at(-1).sha, SHA.A);
  assert.equal(fixture.comments.length, 1);
  assert.ok(
    fixture.commentUpdates.every(
      ({ comment_id: commentId }) => commentId === fixture.comments[0].id,
    ),
  );
  const journal = journalFromComment(fixture.comments[0]);
  assert.deepEqual(journal.receipts.events, [opened]);
  assert.equal(journal.receipts.selections.length, 1);
  assert.equal(journal.state.targets.ui.active.dispatch_state, "dispatched");
  const uiConfigurationRefs = fixture.contentRequests
    .filter(({ path }) => path === UI_VERCEL_CONFIGURATION_PATH)
    .map(({ ref }) => ref);
  assert.ok(uiConfigurationRefs.length >= 3);
  assert.deepEqual(new Set(uiConfigurationRefs), new Set([SHA.E, SHA.A]));
});

test("a native-owned receipt followed by a GitHub-owned head retires A and dispatches only B", async () => {
  const opened = event({
    run: 121,
    action: "opened",
    head: SHA.A,
    updated: timestamp(1),
  });
  const synchronized = event({
    run: 122,
    action: "synchronize",
    before: SHA.A,
    head: SHA.B,
    updated: timestamp(2),
  });
  const fixture = fakeGitHub({
    pullRequest: pull({ head: SHA.B, updated: timestamp(2) }),
    pullCommits: [SHA.A, SHA.B],
    comments: [journalComment({ events: [opened, synchronized] })],
    uiVercelConfigurationsByRef: new Map([
      [SHA.A, NATIVE_OWNED_UI_VERCEL_CONFIGURATION],
      [SHA.B, GITHUB_OWNED_UI_VERCEL_CONFIGURATION],
    ]),
  });

  const state = await reconcilePreview({
    github: fixture.github,
    context: fakeContext(),
    core: fakeCore(),
    prNumber: 519,
    waitForRecovery: async () => {},
  });

  assert.equal(fixture.dispatches.length, 1);
  assert.equal(fixture.workerDispatchRequests.length, 1);
  assert.equal(fixture.dispatches[0].inputs.commit_sha, SHA.B);
  assert.equal(state.targets.ui.active.sha, SHA.B);
  assert.equal(state.targets.ui.active.dispatch_state, "dispatched");
  const journal = journalFromComment(fixture.comments[0]);
  assert.equal(journal.receipts.results.length, 1);
  assert.equal(journal.receipts.results[0].sha, SHA.A);
  assert.equal(
    journal.receipts.results[0].terminal_reason,
    "native-owned-selection-without-github-worker",
  );
  assert.equal(
    state.status_decisions.find(({ sha }) => sha === SHA.A).state,
    "success",
  );
  assert.ok(fixture.contentRequests.some(({ ref }) => ref === SHA.A));
  assert.ok(fixture.contentRequests.some(({ ref }) => ref === SHA.B));
});

test("native A through docs-only C stays native until only GitHub-owned B dispatches", async () => {
  const opened = event({
    run: 121,
    action: "opened",
    head: SHA.A,
    updated: timestamp(1),
  });
  const docsOnly = event({
    run: 122,
    action: "synchronize",
    before: SHA.A,
    head: SHA.C,
    runtime: false,
    updated: timestamp(2),
  });
  const synchronized = event({
    run: 123,
    action: "synchronize",
    before: SHA.C,
    head: SHA.B,
    updated: timestamp(3),
  });
  const fixture = fakeGitHub({
    pullRequest: pull({ head: SHA.B, updated: timestamp(3) }),
    pullCommits: [SHA.A, SHA.C, SHA.B],
    comments: [journalComment({ events: [opened, docsOnly, synchronized] })],
    uiVercelConfigurationsByRef: new Map([
      [SHA.A, NATIVE_OWNED_UI_VERCEL_CONFIGURATION],
      [SHA.B, GITHUB_OWNED_UI_VERCEL_CONFIGURATION],
    ]),
  });

  const state = await reconcilePreview({
    github: fixture.github,
    context: fakeContext(),
    core: fakeCore(),
    prNumber: 519,
    waitForRecovery: async () => {},
  });

  assert.equal(fixture.dispatches.length, 1);
  assert.equal(fixture.workerDispatchRequests.length, 1);
  assert.equal(fixture.dispatches[0].inputs.commit_sha, SHA.B);
  assert.equal(state.targets.ui.active.sha, SHA.B);
  assert.equal(state.targets.ui.active.dispatch_state, "dispatched");
  assert.equal(state.targets.ui.last_successful_runtime_sha, null);
  assert.equal(state.targets.ui.last_successful_runtime_url, null);
  const statusBySha = new Map(
    state.status_decisions.map((status) => [status.sha, status]),
  );
  for (const sha of [SHA.A, SHA.C]) {
    assert.deepEqual(statusBySha.get(sha), nativeUiAggregateStatus(sha, 7_000));
  }
  assert.equal(statusBySha.get(SHA.B).state, "pending");
  const journal = journalFromComment(fixture.comments[0]);
  assert.equal(journal.receipts.results.length, 1);
  assert.equal(journal.receipts.results[0].sha, SHA.A);
  assert.equal(journal.receipts.results[0].state, "error");
  assert.equal(
    journal.receipts.results[0].terminal_reason,
    "native-owned-selection-without-github-worker",
  );
});

test("sequential native ownership checkpoints through docs-only C before only GitHub-owned B dispatches", async () => {
  const opened = event({
    run: 124,
    action: "opened",
    head: SHA.A,
    updated: timestamp(1),
  });
  const docsOnly = event({
    run: 125,
    action: "synchronize",
    before: SHA.A,
    head: SHA.C,
    runtime: false,
    updated: timestamp(2),
  });
  const synchronized = event({
    run: 126,
    action: "synchronize",
    before: SHA.C,
    head: SHA.B,
    updated: timestamp(3),
  });
  const pullA = pull({ head: SHA.A, updated: timestamp(1) });
  const pullC = pull({ head: SHA.C, updated: timestamp(2) });
  const fixture = fakeGitHub({
    pullRequest: pullC,
    pullRequests: [pullA, pullA, pullA, pullA],
    pullCommits: [SHA.A, SHA.C],
    comments: [journalComment({ events: [opened] })],
    uiVercelConfigurationsByRef: new Map([
      [SHA.A, NATIVE_OWNED_UI_VERCEL_CONFIGURATION],
      [SHA.C, NATIVE_OWNED_UI_VERCEL_CONFIGURATION],
    ]),
  });

  const nativeA = await reconcilePreview({
    github: fixture.github,
    context: fakeContext({ runId: 7_001 }),
    core: fakeCore(),
    prNumber: 519,
    waitForRecovery: async () => {},
  });
  assert.equal(fixture.dispatches.length, 0);
  assert.equal(fixture.deployments.length, 0);
  assert.equal(nativeA.targets.ui.last_successful_runtime_sha, null);
  assert.equal(nativeA.targets.ui.last_successful_runtime_url, null);
  assert.deepEqual(nativeA.status_decisions, [
    nativeUiAggregateStatus(SHA.A, 7_001),
  ]);
  const externalNativeA = fixture.commitStatuses.at(-1);
  assert.deepEqual(
    {
      sha: externalNativeA.sha,
      state: externalNativeA.state,
      description: externalNativeA.description,
      target_url: externalNativeA.target_url,
    },
    {
      sha: nativeA.status_decisions[0].sha,
      state: nativeA.status_decisions[0].state,
      description: nativeA.status_decisions[0].description,
      target_url: nativeA.status_decisions[0].target_url,
    },
  );

  await recordEventReceipt({
    github: fixture.github,
    context: fakeContext({ runId: docsOnly.event_run_id }),
    core: fakeCore(),
    ...eventRecordInputs(docsOnly),
  });
  let journal = journalFromComment(fixture.comments[0]);
  assert.equal(journal.checkpoint.event.head_sha, SHA.A);
  assert.equal(journal.checkpoint.targets.ui.status.state, "success");
  assert.equal(
    journal.checkpoint.targets.ui.status.description,
    "ui: native Vercel owns preview",
  );
  assert.deepEqual(journal.receipts.events, [docsOnly]);
  for (const status of [
    { ...journal.checkpoint.targets.ui.status, state: "failure" },
    {
      ...journal.checkpoint.targets.ui.status,
      target_url: "https://example.com/actions/runs/7001",
    },
  ]) {
    assert.throws(
      () =>
        createPreviewJournal({
          pr: 519,
          revision: journal.revision,
          checkpoint: {
            ...journal.checkpoint,
            targets: {
              ...journal.checkpoint.targets,
              ui: { ...journal.checkpoint.targets.ui, status },
            },
          },
          events: journal.receipts.events,
          selections: journal.receipts.selections,
          workerEvidence: journal.receipts.worker_evidence,
          results: journal.receipts.results,
          state: journal.state,
        }),
      /ui checkpoint native ownership status is invalid/,
    );
  }
  assert.throws(
    () =>
      createPreviewJournal({
        pr: 519,
        revision: journal.revision,
        checkpoint: {
          ...journal.checkpoint,
          targets: {
            ...journal.checkpoint.targets,
            ui: {
              ...journal.checkpoint.targets.ui,
              status: {
                ...journal.checkpoint.targets.ui.status,
                description: "Draining GitHub preview before native ownership",
              },
            },
          },
        },
        events: journal.receipts.events,
        selections: journal.receipts.selections,
        workerEvidence: journal.receipts.worker_evidence,
        results: journal.receipts.results,
        state: journal.state,
      }),
    /ui checkpoint native ownership status is invalid/,
  );

  const nativeC = await reconcilePreview({
    github: fixture.github,
    context: fakeContext({ runId: 7_002 }),
    core: fakeCore(),
    prNumber: 519,
    waitForRecovery: async () => {},
  });
  assert.equal(fixture.dispatches.length, 0);
  assert.equal(fixture.deployments.length, 0);
  assert.equal(nativeC.targets.ui.last_successful_runtime_sha, null);
  assert.equal(nativeC.targets.ui.last_successful_runtime_url, null);
  assert.deepEqual(
    nativeC.status_decisions.at(-1),
    nativeUiAggregateStatus(SHA.C, 7_002),
  );

  journal = journalFromComment(fixture.comments[0]);
  const pullB = pull({ head: SHA.B, updated: timestamp(3) });
  const githubFixture = fakeGitHub({
    pullRequest: pullB,
    pullCommits: [SHA.A, SHA.C, SHA.B],
    comments: [
      journalComment({
        revision: journal.revision,
        checkpoint: journal.checkpoint,
        events: journal.receipts.events,
        selections: journal.receipts.selections,
        workerEvidence: journal.receipts.worker_evidence,
        results: journal.receipts.results,
        state: journal.state,
      }),
    ],
    uiVercelConfigurationsByRef: new Map([
      [SHA.B, GITHUB_OWNED_UI_VERCEL_CONFIGURATION],
    ]),
  });
  await recordEventReceipt({
    github: githubFixture.github,
    context: fakeContext({ runId: synchronized.event_run_id }),
    core: fakeCore(),
    ...eventRecordInputs(synchronized),
  });
  const beforeGitHubReconcile = journalFromComment(githubFixture.comments[0]);
  assert.equal(beforeGitHubReconcile.checkpoint.event.head_sha, SHA.C);
  assert.equal(
    beforeGitHubReconcile.checkpoint.targets.ui.status.state,
    "success",
  );
  assert.equal(
    beforeGitHubReconcile.checkpoint.targets.ui.status.description,
    "ui: native Vercel owns preview",
  );
  assert.deepEqual(beforeGitHubReconcile.receipts.events, [synchronized]);
  assert.equal(
    beforeGitHubReconcile.state.targets.ui.last_successful_runtime_sha,
    null,
  );
  assert.equal(
    beforeGitHubReconcile.state.targets.ui.last_successful_runtime_url,
    null,
  );
  const githubB = await reconcilePreview({
    github: githubFixture.github,
    context: fakeContext({ runId: 7_003 }),
    core: fakeCore(),
    prNumber: 519,
    waitForRecovery: async () => {},
  });
  assert.equal(githubFixture.dispatches.length, 1);
  assert.equal(githubFixture.workerDispatchRequests.length, 1);
  assert.equal(githubFixture.dispatches[0].inputs.commit_sha, SHA.B);
  assert.equal(githubFixture.deployments.length, 0);
  assert.equal(githubB.targets.ui.active.sha, SHA.B);
  assert.equal(githubB.targets.ui.last_successful_runtime_sha, null);
  assert.equal(githubB.targets.ui.last_successful_runtime_url, null);
  assert.deepEqual(githubB.status_decisions, [
    nativeUiAggregateStatus(SHA.C, 7_002),
    {
      sha: SHA.B,
      state: "pending",
      description: "app=none; governance=none; reserve=none; ui=pending",
      target_url: githubB.targets.ui.active.html_url,
      targets: {
        app: "not affected",
        governance: "not affected",
        reserve: "not affected",
        ui: "pending",
      },
    },
  ]);
  const finalJournal = journalFromComment(githubFixture.comments[0]);
  assert.equal(finalJournal.receipts.results.length, 0);
});

test("native no-dispatch status selects the latest current-head decision after a force-reset SHA revisit", async () => {
  const opened = event({
    run: 127,
    action: "opened",
    head: SHA.A,
    updated: timestamp(1),
  });
  const synchronizedB = event({
    run: 128,
    action: "synchronize",
    before: SHA.A,
    head: SHA.B,
    updated: timestamp(2),
  });
  const synchronizedA = event({
    run: 129,
    action: "synchronize",
    before: SHA.B,
    head: SHA.A,
    updated: timestamp(3),
  });
  const fixture = fakeGitHub({
    pullRequest: pull({ head: SHA.A, updated: timestamp(3) }),
    pullCommits: [SHA.A, SHA.B],
    comments: [
      journalComment({ events: [opened, synchronizedB, synchronizedA] }),
    ],
    uiVercelConfigurationsByRef: new Map([
      [SHA.A, NATIVE_OWNED_UI_VERCEL_CONFIGURATION],
    ]),
  });

  const state = await reconcilePreview({
    github: fixture.github,
    context: fakeContext({ runId: 7_004 }),
    core: fakeCore(),
    prNumber: 519,
    waitForRecovery: async () => {},
  });

  assert.equal(fixture.dispatches.length, 0);
  assert.equal(fixture.deployments.length, 0);
  const repeatedHeadDecisions = state.status_decisions.filter(
    ({ sha }) => sha === SHA.A,
  );
  assert.equal(repeatedHeadDecisions.length, 2);
  assert.deepEqual(
    repeatedHeadDecisions[1],
    nativeUiAggregateStatus(SHA.A, 7_004),
  );
  assert.deepEqual(
    fixture.commitStatuses.filter(({ sha }) => sha === SHA.A).at(-1)
      .description,
    repeatedHeadDecisions[1].description,
  );
});

test("generic no-dispatch retirement does not claim native ownership of a GitHub-owned SHA", () => {
  const opened = event({
    run: 121,
    action: "opened",
    head: SHA.A,
    updated: timestamp(1),
  });
  const synchronized = event({
    run: 122,
    action: "synchronize",
    before: SHA.A,
    head: SHA.B,
    updated: timestamp(2),
  });
  const pullRequest = pull({ head: SHA.B, updated: timestamp(2) });
  const selected = reconcile({ events: [opened, synchronized], pullRequest });
  const intended = persistIntent(selected);
  const retired = result(selected.nextDispatch, {
    runId: 7_000,
    state: "error",
    reason: "dispatch-disabled-intent-without-worker",
  });

  const advanced = reconcile({
    events: [opened, synchronized],
    results: [retired],
    selections: [selectionReceiptFromDispatch(intended.targets.ui.active)],
    pullRequest,
    existingState: intended,
  });

  const statusA = advanced.state.status_decisions.find(
    ({ sha }) => sha === SHA.A,
  );
  assert.equal(statusA.state, "error");
  assert.equal(statusA.targets.ui, "error");
  assert.equal(
    statusA.description,
    "app=none; governance=none; reserve=none; ui=error",
  );
  assert.doesNotMatch(statusA.description, /Native Vercel/);
});

test("selected-native retirement keeps unrelated retired GitHub ownership generic", async () => {
  const oldOpened = event({
    run: 110,
    action: "opened",
    head: SHA.C,
    updated: timestamp(1),
  });
  const old = reconcile({
    events: [oldOpened],
    pullRequest: pull({ head: SHA.C, updated: timestamp(1) }),
  });
  const oldIntended = persistIntent(old);
  const closed = event({
    run: 111,
    action: "closed",
    head: SHA.C,
    updated: timestamp(2),
  });
  const closedState = reconcile({
    events: [oldOpened, closed],
    pullRequest: pull({
      head: SHA.C,
      state: "closed",
      updated: timestamp(2),
      closed: timestamp(2),
    }),
    existingState: oldIntended,
  });
  const reopened = event({
    run: 112,
    action: "reopened",
    head: SHA.A,
    updated: timestamp(3),
  });
  const synchronized = event({
    run: 113,
    action: "synchronize",
    before: SHA.A,
    head: SHA.B,
    updated: timestamp(4),
  });
  const events = [oldOpened, closed, reopened, synchronized];
  const pullRequest = pull({ head: SHA.B, updated: timestamp(4) });
  const selected = reconcile({
    events,
    pullRequest,
    existingState: closedState.state,
  });
  assert.equal(selected.nextDispatch.sha, SHA.A);
  assert.equal(selected.state.targets.ui.retired_active[0].sha, SHA.C);
  const intended = persistIntent(selected);
  const fixture = fakeGitHub({
    pullRequest,
    pullCommits: [SHA.C, SHA.A, SHA.B],
    comments: [
      journalWithState(events, intended, {
        selections: [
          selectionReceiptFromDispatch(intended.targets.ui.retired_active[0]),
          selectionReceiptFromDispatch(intended.targets.ui.active),
        ],
      }),
    ],
    uiVercelConfigurationsByRef: new Map([
      [SHA.C, GITHUB_OWNED_UI_VERCEL_CONFIGURATION],
      [SHA.A, NATIVE_OWNED_UI_VERCEL_CONFIGURATION],
      [SHA.B, GITHUB_OWNED_UI_VERCEL_CONFIGURATION],
    ]),
  });

  const state = await reconcilePreview({
    github: fixture.github,
    context: fakeContext(),
    core: fakeCore(),
    prNumber: 519,
    waitForRecovery: async () => {},
  });

  assert.equal(fixture.dispatches.length, 1);
  assert.equal(fixture.dispatches[0].inputs.commit_sha, SHA.B);
  assert.equal(state.targets.ui.active.sha, SHA.B);
  const resultsBySha = new Map(
    journalFromComment(fixture.comments[0]).receipts.results.map((entry) => [
      entry.sha,
      entry.terminal_reason,
    ]),
  );
  assert.equal(
    resultsBySha.get(SHA.A),
    "native-owned-selection-without-github-worker",
  );
  assert.equal(
    resultsBySha.get(SHA.C),
    "dispatch-disabled-intent-without-worker",
  );
});

test("a native-owned historical receipt attaches its crash-window worker instead of dispatching a duplicate", async () => {
  const opened = event({
    run: 121,
    action: "opened",
    head: SHA.A,
    updated: timestamp(1),
  });
  const synchronized = event({
    run: 122,
    action: "synchronize",
    before: SHA.A,
    head: SHA.B,
    updated: timestamp(2),
  });
  const pullRequest = pull({ head: SHA.B, updated: timestamp(2) });
  const selected = reconcile({ events: [opened, synchronized], pullRequest });
  assert.equal(selected.nextDispatch.sha, SHA.A);
  const fixture = fakeGitHub({
    pullRequest,
    pullCommits: [SHA.A, SHA.B],
    comments: [journalComment({ events: [opened, synchronized] })],
    runs: [workerRun(selected.nextDispatch, { status: "in_progress" })],
    uiVercelConfigurationsByRef: new Map([
      [SHA.A, NATIVE_OWNED_UI_VERCEL_CONFIGURATION],
      [SHA.B, GITHUB_OWNED_UI_VERCEL_CONFIGURATION],
    ]),
  });
  const core = fakeCore();

  const state = await reconcilePreview({
    github: fixture.github,
    context: fakeContext(),
    core,
    prNumber: 519,
    waitForRecovery: async () => {},
  });

  assert.equal(fixture.dispatches.length, 0);
  assert.equal(fixture.workerDispatchRequests.length, 0);
  assert.equal(core.outputs.get("recovered_intended_run_id"), "8000");
  assert.equal(state.targets.ui.active.sha, SHA.A);
  assert.equal(state.targets.ui.active.dispatch_state, "dispatched");
  assert.equal(state.targets.ui.active.workflow_run_id, 8_000);
  assert.equal(
    journalFromComment(fixture.comments[0]).receipts.results.length,
    0,
  );
});

for (const [name, configuration, message] of [
  ["malformed", "{\n", /configuration is malformed/],
  [
    "unknown",
    { git: { deploymentEnabled: { "feature/**": false } } },
    /configuration is not recognized/,
  ],
]) {
  test(`${name} selected-SHA ownership fails closed before an A to B dispatch`, async () => {
    const opened = event({
      run: 121,
      action: "opened",
      head: SHA.A,
      updated: timestamp(1),
    });
    const synchronized = event({
      run: 122,
      action: "synchronize",
      before: SHA.A,
      head: SHA.B,
      updated: timestamp(2),
    });
    const fixture = fakeGitHub({
      pullRequest: pull({ head: SHA.B, updated: timestamp(2) }),
      pullCommits: [SHA.A, SHA.B],
      comments: [journalComment({ events: [opened, synchronized] })],
      uiVercelConfigurationsByRef: new Map([
        [SHA.A, configuration],
        [SHA.B, GITHUB_OWNED_UI_VERCEL_CONFIGURATION],
      ]),
    });

    await assert.rejects(
      reconcilePreview({
        github: fixture.github,
        context: fakeContext(),
        core: fakeCore(),
        prNumber: 519,
        waitForRecovery: async () => {},
      }),
      message,
    );

    assert.equal(fixture.dispatches.length, 0);
    assert.equal(fixture.workerDispatchRequests.length, 0);
    assert.equal(fixture.commitStatuses.at(-1).state, "error");
    assert.deepEqual(
      new Set(fixture.contentRequests.map(({ ref }) => ref)),
      new Set([SHA.E, SHA.A, SHA.B]),
    );
  });
}

test("a GitHub-owned receipt followed by a native-owned head never dispatches the stale receipt", async () => {
  const opened = event({
    run: 121,
    action: "opened",
    head: SHA.A,
    updated: timestamp(1),
  });
  const synchronized = event({
    run: 122,
    action: "synchronize",
    before: SHA.A,
    head: SHA.B,
    updated: timestamp(2),
  });
  const fixture = fakeGitHub({
    pullRequest: pull({ head: SHA.B, updated: timestamp(2) }),
    pullCommits: [SHA.A, SHA.B],
    comments: [journalComment({ events: [opened, synchronized] })],
    uiVercelConfigurationsByRef: new Map([
      [SHA.A, GITHUB_OWNED_UI_VERCEL_CONFIGURATION],
      [SHA.B, NATIVE_OWNED_UI_VERCEL_CONFIGURATION],
    ]),
  });

  const state = await reconcilePreview({
    github: fixture.github,
    workerDispatchGithub: null,
    context: fakeContext(),
    core: fakeCore(),
    prNumber: 519,
  });

  assert.equal(fixture.dispatches.length, 0);
  assert.equal(fixture.workerDispatchRequests.length, 0);
  assert.equal(state.targets.ui.active, null);
  const uiConfigurationRefs = fixture.contentRequests
    .filter(({ path }) => path === UI_VERCEL_CONFIGURATION_PATH)
    .map(({ ref }) => ref);
  assert.ok(uiConfigurationRefs.includes(SHA.B));
  assert.equal(uiConfigurationRefs.includes(SHA.A), false);
  assert.equal(fixture.commitStatuses.at(-1).state, "success");
  assert.equal(
    fixture.commitStatuses.at(-1).description,
    "app=none; governance=none; reserve=none; ui=native",
  );
});

test("active controller defers an exact native-config rollback head without a dispatch credential", async () => {
  const opened = event({
    run: 121,
    action: "opened",
    head: SHA.A,
    updated: timestamp(1),
  });
  const fixture = fakeGitHub({
    pullRequest: pull({ head: SHA.A, updated: timestamp(1) }),
    comments: [journalComment({ events: [opened] })],
    uiVercelConfiguration: NATIVE_OWNED_UI_VERCEL_CONFIGURATION,
  });
  const core = fakeCore();

  const state = await reconcilePreview({
    github: fixture.github,
    workerDispatchGithub: null,
    context: fakeContext(),
    core,
    prNumber: 519,
  });

  assert.equal(state.targets.ui.active, null);
  assert.equal(state.targets.ui.latest_desired_sha, SHA.A);
  assert.equal(fixture.dispatches.length, 0);
  assert.equal(fixture.workerDispatchRequests.length, 0);
  assert.deepEqual(
    new Set(
      fixture.contentRequests
        .filter(({ path }) => path === UI_VERCEL_CONFIGURATION_PATH)
        .map(({ ref }) => ref),
    ),
    new Set([SHA.E, SHA.A]),
  );
  assert.equal(fixture.commitStatuses.at(-1).state, "success");
  assert.equal(
    fixture.commitStatuses.at(-1).description,
    "app=none; governance=none; reserve=none; ui=native",
  );
  assert.equal(
    fixture.commitStatuses.at(-1).target_url,
    "https://github.com/mento-protocol/frontend-monorepo/actions/runs/7000",
  );
  assert.equal(
    JSON.parse(core.outputs.get("preview_owners")).ui,
    "native-vercel",
  );
  assert.equal(core.outputs.get("dispatched_run_ids"), "[]");
});

test("active controller rechecks exact-head ownership after recovery and blocks a racing native cutover", async () => {
  const opened = event({
    run: 121,
    action: "opened",
    head: SHA.A,
    updated: timestamp(1),
  });
  const fixture = fakeGitHub({
    pullRequest: pull({ head: SHA.A, updated: timestamp(1) }),
    comments: [journalComment({ events: [opened] })],
    uiVercelConfiguration: NATIVE_OWNED_UI_VERCEL_CONFIGURATION,
    uiVercelConfigurations: [
      GITHUB_OWNED_UI_VERCEL_CONFIGURATION,
      GITHUB_OWNED_UI_VERCEL_CONFIGURATION,
      NATIVE_OWNED_UI_VERCEL_CONFIGURATION,
    ],
  });
  const waits = [];

  const state = await reconcilePreview({
    github: fixture.github,
    context: fakeContext(),
    core: fakeCore(),
    prNumber: 519,
    waitForRecovery: async (milliseconds) => waits.push(milliseconds),
  });

  assert.equal(fixture.dispatches.length, 0);
  assert.equal(fixture.workerDispatchRequests.length, 0);
  assert.equal(state.targets.ui.active, null);
  assert.equal(
    state.targets.ui.terminal_history.at(-1).terminal_reason,
    "native-owned-selection-without-github-worker",
  );
  assert.deepEqual(
    new Set(
      fixture.contentRequests
        .filter(({ path }) => path === UI_VERCEL_CONFIGURATION_PATH)
        .map(({ ref }) => ref),
    ),
    new Set([SHA.E, SHA.A]),
  );
  assert.deepEqual(waits, [500, 500, 500, 500]);
  assert.equal(fixture.commitStatuses.at(-1).state, "success");
  assert.equal(
    fixture.commitStatuses.at(-1).description,
    "app=none; governance=none; reserve=none; ui=native",
  );
});

test("active controller settles a completed crash-window worker after a racing native cutover", async () => {
  const opened = event({
    run: 121,
    action: "opened",
    head: SHA.A,
    updated: timestamp(1),
  });
  const pullRequest = pull({ head: SHA.A, updated: timestamp(1) });
  const selected = reconcile({ events: [opened], pullRequest });
  const completed = workerRun(selected.nextDispatch, {
    status: "completed",
    conclusion: "cancelled",
  });
  const fixture = fakeGitHub({
    pullRequest,
    comments: [journalComment({ events: [opened] })],
    runs: [completed],
    uiVercelConfiguration: NATIVE_OWNED_UI_VERCEL_CONFIGURATION,
    uiVercelConfigurations: [
      GITHUB_OWNED_UI_VERCEL_CONFIGURATION,
      GITHUB_OWNED_UI_VERCEL_CONFIGURATION,
      NATIVE_OWNED_UI_VERCEL_CONFIGURATION,
    ],
  });
  const core = fakeCore();

  const state = await reconcilePreview({
    github: fixture.github,
    context: fakeContext({ runId: 7_001 }),
    core,
    prNumber: 519,
    waitForRecovery: async () => {},
  });

  assert.equal(fixture.dispatches.length, 0);
  assert.equal(fixture.workerDispatchRequests.length, 0);
  assert.equal(core.outputs.get("recovered_intended_run_id"), "8000");
  assert.equal(state.targets.ui.active, null);
  assert.equal(
    state.targets.ui.terminal_history.at(-1).terminal_reason,
    "worker-cancelled",
  );
  const journal = journalFromComment(fixture.comments[0]);
  assert.equal(journal.receipts.results.length, 1);
  assert.equal(journal.receipts.results[0].worker_run_id, 8_000);
  assert.equal(journal.state.targets.ui.active, null);
  assert.equal(fixture.commitStatuses.at(-1).state, "success");
  assert.equal(
    fixture.commitStatuses.at(-1).description,
    "app=none; governance=none; reserve=none; ui=native",
  );
});

test("native cutover progress converges independently from a serialized update retry", async () => {
  const opened = event({
    run: 121,
    action: "opened",
    head: SHA.A,
    updated: timestamp(1),
  });
  const runtimeB = event({
    run: 122,
    action: "synchronize",
    before: SHA.A,
    head: SHA.B,
    updated: timestamp(2),
  });
  const pullRequest = pull({ head: SHA.B, updated: timestamp(2) });
  const selectedA = reconcile({
    events: [opened],
    pullRequest: pull({ head: SHA.A, updated: timestamp(1) }),
  });
  const pendingB = reconcile({
    events: [opened, runtimeB],
    pullRequest,
    existingState: persistDispatch(selectedA, 8_000),
  });
  assert.equal(pendingB.state.targets.ui.active.sha, SHA.A);
  assert.equal(pendingB.state.targets.ui.latest_desired_sha, SHA.B);
  const completedA = workerRun(selectedA.nextDispatch, {
    status: "completed",
    conclusion: "cancelled",
  });
  const fixture = fakeGitHub({
    pullRequest,
    comments: [
      journalWithState([opened, runtimeB], pendingB.state, {
        selections: [
          selectionReceiptFromDispatch(pendingB.state.targets.ui.active),
        ],
      }),
    ],
    runs: [completedA],
    lostSerializedUpdateFailures: 1,
    uiVercelConfiguration: NATIVE_OWNED_UI_VERCEL_CONFIGURATION,
    uiVercelConfigurations: [
      GITHUB_OWNED_UI_VERCEL_CONFIGURATION,
      GITHUB_OWNED_UI_VERCEL_CONFIGURATION,
      GITHUB_OWNED_UI_VERCEL_CONFIGURATION,
      NATIVE_OWNED_UI_VERCEL_CONFIGURATION,
    ],
  });

  const state = await reconcilePreview({
    github: fixture.github,
    context: fakeContext({ runId: 7_001 }),
    core: fakeCore(),
    prNumber: 519,
    waitForRecovery: async () => {},
    progressPassLimit: 3,
  });

  assert.equal(fixture.dispatches.length, 0);
  assert.equal(fixture.workerDispatchRequests.length, 0);
  assert.deepEqual(fixture.lostSerializedUpdates, [1]);
  assert.equal(state.targets.ui.active, null);
  assert.equal(state.targets.ui.latest_desired_sha, SHA.B);
  assert.ok(
    state.targets.ui.terminal_history.some(
      ({ sha, terminal_reason: terminalReason }) =>
        sha === SHA.B &&
        terminalReason === "native-owned-selection-without-github-worker",
    ),
  );
  const journal = journalFromComment(fixture.comments[0]);
  assert.deepEqual(
    journal.receipts.results.map(
      ({ worker_run_id: workerRunId }) => workerRunId,
    ),
    [8_000, 7_001],
  );
  assert.equal(fixture.commitStatuses.at(-1).state, "success");
  assert.equal(
    fixture.commitStatuses.at(-1).description,
    "app=none; governance=none; reserve=none; ui=native",
  );
});

test("exhausted deterministic progress posts a fail-closed preview status", async () => {
  const opened = event({
    run: 121,
    action: "opened",
    head: SHA.A,
    updated: timestamp(1),
  });
  const pullRequest = pull({ head: SHA.A, updated: timestamp(1) });
  const selected = reconcile({ events: [opened], pullRequest });
  const fixture = fakeGitHub({
    pullRequest,
    comments: [journalWithState([opened], persistIntent(selected))],
    uiVercelConfiguration: NATIVE_OWNED_UI_VERCEL_CONFIGURATION,
  });

  await assert.rejects(
    reconcilePreview({
      github: fixture.github,
      workerDispatchGithub: null,
      context: fakeContext({ runId: 7_001 }),
      core: fakeCore(),
      prNumber: 519,
      waitForRecovery: async () => {},
      progressPassLimit: 0,
    }),
    /Controller state update did not converge/,
  );

  assert.equal(fixture.dispatches.length, 0);
  assert.equal(fixture.workerDispatchRequests.length, 0);
  assert.equal(fixture.commitStatuses.at(-1).state, "error");
  assert.equal(
    fixture.commitStatuses.at(-1).description,
    "Preview controller state is invalid or ambiguous",
  );
  assert.equal(
    journalFromComment(fixture.comments[0]).receipts.results.at(-1)
      .terminal_reason,
    "native-owned-selection-without-github-worker",
  );
});

test("observe-only controller fails closed for a stale GitHub-owned Phase B head", async () => {
  const opened = event({
    run: 121,
    action: "opened",
    head: SHA.A,
    updated: timestamp(1),
  });
  const fixture = fakeGitHub({
    pullRequest: pull({ head: SHA.A, updated: timestamp(1) }),
    comments: [journalComment({ events: [opened] })],
  });

  await assert.rejects(
    reconcilePreview({
      github: fixture.github,
      workerDispatchGithub: null,
      controllerMode: "observe-only",
      context: fakeContext(),
      core: fakeCore(),
      prNumber: 519,
    }),
    /leaves a candidate preview ownerless/,
  );

  assert.equal(fixture.dispatches.length, 0);
  assert.equal(fixture.workerDispatchRequests.length, 0);
  assert.equal(fixture.commentUpdates.length, 0);
  assert.equal(fixture.commitStatuses.at(-1).state, "error");
});

for (const [name, contentOptions, message] of [
  [
    "missing",
    { uiVercelContentErrorStatus: 404 },
    /fixture repository content read failed/,
  ],
  ["malformed", { uiVercelConfiguration: "{" }, /is malformed/],
  [
    "oversized",
    {
      uiVercelContentResponse: {
        type: "file",
        path: UI_VERCEL_CONFIGURATION_PATH,
        encoding: "base64",
        size: 2_049,
        content: Buffer.alloc(2_049).toString("base64"),
      },
    },
    /metadata is invalid/,
  ],
  [
    "unknown",
    { uiVercelConfiguration: { git: { deploymentEnabled: true } } },
    /is not recognized/,
  ],
]) {
  test(`candidate UI ownership ${name} fails closed before credentials or journal mutation`, async () => {
    const opened = event({
      run: 121,
      action: "opened",
      head: SHA.A,
      updated: timestamp(1),
    });
    const fixture = fakeGitHub({
      pullRequest: pull({ head: SHA.A, updated: timestamp(1) }),
      comments: [journalComment({ events: [opened] })],
      ...contentOptions,
    });

    await assert.rejects(
      reconcilePreview({
        github: fixture.github,
        workerDispatchGithub: null,
        context: fakeContext(),
        core: fakeCore(),
        prNumber: 519,
      }),
      message,
    );

    assert.equal(fixture.dispatches.length, 0);
    assert.equal(fixture.workerDispatchRequests.length, 0);
    assert.equal(fixture.commentUpdates.length, 0);
    assert.equal(fixture.commitStatuses.at(-1).state, "error");
  });
}

test("observe-only controller mode records status without creating dispatch intent", async () => {
  const opened = event({
    run: 121,
    action: "opened",
    head: SHA.A,
    updated: timestamp(1),
  });
  const fixture = fakeGitHub({
    pullRequest: pull({ head: SHA.A, updated: timestamp(1) }),
    comments: [journalComment({ events: [opened] })],
    uiVercelConfiguration: NATIVE_OWNED_UI_VERCEL_CONFIGURATION,
  });
  const core = fakeCore();

  const state = await reconcilePreview({
    github: fixture.github,
    controllerMode: "observe-only",
    context: fakeContext(),
    core,
    prNumber: 519,
  });

  assert.equal(state.targets.ui.active, null);
  assert.equal(state.targets.ui.latest_desired_sha, SHA.A);
  assert.equal(fixture.dispatches.length, 0);
  assert.equal(fixture.workerDispatchRequests.length, 0);
  assert.equal(fixture.commentUpdates.length, 1);
  assert.equal(
    journalFromComment(fixture.comments[0]).state.targets.ui.active,
    null,
  );
  assert.equal(
    journalFromComment(fixture.comments[0]).state.targets.ui.latest_desired_sha,
    SHA.A,
  );
  assert.deepEqual(
    fixture.commitStatuses.map(({ sha, state, context, description }) => ({
      sha,
      state,
      context,
      description,
    })),
    [
      {
        sha: SHA.A,
        state: "success",
        context: "Vercel Preview",
        description: "GitHub preview dispatch is observe-only",
      },
    ],
  );
  assert.equal(core.outputs.get("controller_mode"), "observe-only");
  assert.equal(core.outputs.get("dispatch_skipped"), "true");
  assert.equal(core.outputs.get("pr_number"), "519");
});

test("observe-only mode recovers completed work and reconstructs state without dispatching the newest SHA", async () => {
  const opened = event({
    run: 121,
    action: "opened",
    head: SHA.A,
    updated: timestamp(1),
  });
  const runtimeB = event({
    run: 122,
    action: "synchronize",
    before: SHA.A,
    head: SHA.B,
    updated: timestamp(2),
  });
  const pullRequest = pull({ head: SHA.B, updated: timestamp(2) });
  const selected = reconcile({
    events: [opened],
    pullRequest: pull({ head: SHA.A, updated: timestamp(1) }),
  });
  const dispatched = persistDispatch(selected, 8_000);
  const completed = workerRun(selected.nextDispatch, {
    status: "completed",
    conclusion: "cancelled",
  });
  completed.name = completed.display_title;
  const fixture = fakeGitHub({
    pullRequest,
    comments: [journalWithState([opened, runtimeB], dispatched)],
    runs: [completed],
    uiVercelConfiguration: NATIVE_OWNED_UI_VERCEL_CONFIGURATION,
  });
  const core = fakeCore();

  const state = await reconcilePreview({
    github: fixture.github,
    controllerMode: "observe-only",
    context: fakeContext({ runId: 7_001 }),
    core,
    prNumber: 519,
    waitForRecovery: async () => {},
  });

  assert.equal(fixture.dispatches.length, 0);
  assert.equal(fixture.workerDispatchRequests.length, 0);
  assert.equal(state.targets.ui.active, null);
  assert.equal(state.targets.ui.latest_desired_sha, SHA.B);
  assert.equal(
    state.targets.ui.terminal_history.at(-1).terminal_reason,
    "worker-cancelled",
  );
  const journal = journalFromComment(fixture.comments[0]);
  assert.equal(journal.receipts.results.length, 1);
  assert.equal(journal.state.targets.ui.active, null);
  assert.equal(journal.state.targets.ui.latest_desired_sha, SHA.B);
  assert.equal(fixture.createdDeploymentStatuses.at(-1).state, "error");
  assert.deepEqual(
    fixture.commitStatuses.map(({ sha, state: statusState, description }) => ({
      sha,
      state: statusState,
      description,
    })),
    [
      {
        sha: SHA.B,
        state: "success",
        description: "GitHub preview dispatch is observe-only",
      },
    ],
  );
  assert.equal(core.outputs.get("controller_mode"), "observe-only");
  assert.equal(core.outputs.get("dispatch_skipped"), "true");
});

test("observe-only mode attaches and terminalizes a completed crash-window worker", async () => {
  const opened = event({
    run: 121,
    action: "opened",
    head: SHA.A,
    updated: timestamp(1),
  });
  const pullRequest = pull({ head: SHA.A, updated: timestamp(1) });
  const selected = reconcile({ events: [opened], pullRequest });
  const intended = persistIntent(selected);
  const completed = workerRun(selected.nextDispatch, {
    status: "completed",
    conclusion: "cancelled",
  });
  const fixture = fakeGitHub({
    pullRequest,
    comments: [journalWithState([opened], intended)],
    runs: [completed],
    uiVercelConfiguration: NATIVE_OWNED_UI_VERCEL_CONFIGURATION,
  });
  const core = fakeCore();

  const state = await reconcilePreview({
    github: fixture.github,
    workerDispatchGithub: null,
    controllerMode: "observe-only",
    context: fakeContext({ runId: 7_001 }),
    core,
    prNumber: 519,
    waitForRecovery: async () => {},
  });

  assert.equal(fixture.dispatches.length, 0);
  assert.equal(fixture.workerDispatchRequests.length, 0);
  assert.equal(core.outputs.get("recovered_intended_run_id"), "8000");
  assert.equal(state.targets.ui.active, null);
  assert.equal(
    state.targets.ui.terminal_history.at(-1).terminal_reason,
    "worker-cancelled",
  );
  const journal = journalFromComment(fixture.comments[0]);
  assert.equal(journal.receipts.results.length, 1);
  assert.equal(journal.receipts.results[0].worker_run_id, 8_000);
  assert.equal(journal.state.targets.ui.active, null);
  assert.equal(fixture.commitStatuses.at(-1).state, "success");
  assert.equal(
    fixture.commitStatuses.at(-1).description,
    "GitHub preview dispatch is observe-only",
  );
});

test("observe-only mode durably attaches an in-progress crash-window worker and stays pending", async () => {
  const opened = event({
    run: 121,
    action: "opened",
    head: SHA.A,
    updated: timestamp(1),
  });
  const pullRequest = pull({ head: SHA.A, updated: timestamp(1) });
  const selected = reconcile({ events: [opened], pullRequest });
  const intended = persistIntent(selected);
  const queued = workerRun(selected.nextDispatch, { status: "in_progress" });
  const fixture = fakeGitHub({
    pullRequest,
    comments: [journalWithState([opened], intended)],
    runs: [queued],
    uiVercelConfiguration: NATIVE_OWNED_UI_VERCEL_CONFIGURATION,
  });
  const core = fakeCore();

  const state = await reconcilePreview({
    github: fixture.github,
    workerDispatchGithub: null,
    controllerMode: "observe-only",
    context: fakeContext({ runId: 7_001 }),
    core,
    prNumber: 519,
    waitForRecovery: async () => {},
  });

  assert.equal(fixture.dispatches.length, 0);
  assert.equal(fixture.workerDispatchRequests.length, 0);
  assert.equal(state.targets.ui.active.dispatch_state, "dispatched");
  assert.equal(state.targets.ui.active.workflow_run_id, 8_000);
  const journal = journalFromComment(fixture.comments[0]);
  assert.equal(journal.state.targets.ui.active.workflow_run_id, 8_000);
  assert.equal(journal.receipts.results.length, 0);
  assert.deepEqual(journal.state.status_decisions.at(-1), {
    sha: SHA.A,
    state: "pending",
    description: "Draining GitHub preview before native ownership",
    target_url:
      "https://github.com/mento-protocol/frontend-monorepo/actions/runs/7001",
    targets: {
      app: "not affected",
      governance: "not affected",
      reserve: "not affected",
      ui: "pending",
    },
  });
  assert.equal(fixture.commitStatuses.at(-1).state, "pending");
  assert.equal(
    fixture.commitStatuses.at(-1).description,
    "Draining GitHub preview before native ownership",
  );
  assert.equal(
    fixture.commitStatuses.at(-1).target_url,
    "https://github.com/mento-protocol/frontend-monorepo/actions/runs/7001",
  );
  assert.equal(core.outputs.get("preview_ownership_draining"), "true");
});

test("observe-only mode durably retires a crash-window intent with no worker and does not rediscover it", async () => {
  const opened = event({
    run: 121,
    action: "opened",
    head: SHA.A,
    updated: timestamp(1),
  });
  const pullRequest = pull({ head: SHA.A, updated: timestamp(1) });
  const selected = reconcile({ events: [opened], pullRequest });
  const intended = persistIntent(selected);
  const fixture = fakeGitHub({
    pullRequest,
    comments: [journalWithState([opened], intended)],
    uiVercelConfiguration: NATIVE_OWNED_UI_VERCEL_CONFIGURATION,
  });
  const core = fakeCore();
  const waits = [];

  const state = await reconcilePreview({
    github: fixture.github,
    workerDispatchGithub: null,
    controllerMode: "observe-only",
    context: fakeContext({ runId: 7_001 }),
    core,
    prNumber: 519,
    waitForRecovery: async (milliseconds) => waits.push(milliseconds),
  });

  assert.equal(fixture.dispatches.length, 0);
  assert.equal(fixture.workerDispatchRequests.length, 0);
  assert.deepEqual(waits, [500, 500]);
  assert.equal(fixture.workflowRunListRequests.length, 3);
  assert.equal(core.outputs.get("retired_undispatched_intent"), "true");
  assert.equal(state.targets.ui.active, null);
  assert.equal(
    state.targets.ui.terminal_history.at(-1).terminal_reason,
    "dispatch-disabled-intent-without-worker",
  );
  let journal = journalFromComment(fixture.comments[0]);
  assert.equal(journal.receipts.results.length, 1);
  assert.equal(
    journal.receipts.results[0].terminal_reason,
    "dispatch-disabled-intent-without-worker",
  );
  assert.equal(journal.state.targets.ui.active, null);
  assert.equal(fixture.commitStatuses.at(-1).state, "success");

  fixture.comments[0].body = journalWithState(
    [opened],
    intended,
    {
      revision: journal.revision + 1,
      results: journal.receipts.results,
    },
    fixture.comments[0].id,
  ).body;
  const lookupCount = fixture.workflowRunListRequests.length;
  await reconcilePreview({
    github: fixture.github,
    workerDispatchGithub: null,
    controllerMode: "observe-only",
    context: fakeContext({ runId: 7_002 }),
    core: fakeCore(),
    prNumber: 519,
    waitForRecovery: async () => {},
  });
  journal = journalFromComment(fixture.comments[0]);
  assert.equal(fixture.workflowRunListRequests.length, lookupCount);
  assert.equal(journal.receipts.results.length, 1);
  assert.equal(journal.state.targets.ui.active, null);
});

test("observe-only mode retires a reopened epoch's intended worker slot when no worker exists", async () => {
  const setup = sameShaReopenIntentState();
  const fixture = fakeGitHub({
    pullRequest: setup.pullRequest,
    comments: [
      journalWithState(setup.events, setup.current.state, {
        selections: [
          selectionReceiptFromDispatch(
            setup.current.state.targets.ui.retired_active[0],
          ),
        ],
      }),
    ],
    uiVercelConfiguration: NATIVE_OWNED_UI_VERCEL_CONFIGURATION,
  });
  const core = fakeCore();
  const waits = [];

  const state = await reconcilePreview({
    github: fixture.github,
    workerDispatchGithub: null,
    controllerMode: "observe-only",
    context: fakeContext({ runId: 7_001 }),
    core,
    prNumber: 519,
    waitForRecovery: async (milliseconds) => waits.push(milliseconds),
  });

  assert.equal(fixture.dispatches.length, 0);
  assert.equal(fixture.workerDispatchRequests.length, 0);
  assert.deepEqual(waits, [500, 500]);
  assert.equal(fixture.workflowRunListRequests.length, 3);
  assert.equal(core.outputs.get("retired_undispatched_intent"), "true");
  assert.equal(state.targets.ui.active, null);
  assert.equal(state.targets.ui.retired_active.length, 0);
  const journal = journalFromComment(fixture.comments[0]);
  assert.equal(journal.receipts.results.length, 1);
  assert.equal(
    journal.receipts.results[0].key_digest,
    setup.old.nextDispatch.key_digest,
  );
  assert.equal(journal.state.targets.ui.retired_active.length, 0);
  assert.equal(fixture.commitStatuses.at(-1).state, "success");
  assert.equal(
    fixture.commitStatuses.at(-1).description,
    "GitHub preview dispatch is observe-only",
  );
});

test("observe-only mode retires same-SHA active and reopened-epoch intents without result collisions", async () => {
  const setup = sameShaReopenIntentState();
  const currentIntended = persistIntent(setup.current);
  const retiredSelection = currentIntended.targets.ui.retired_active[0];
  const activeSelection = currentIntended.targets.ui.active;
  assert.equal(retiredSelection.key, activeSelection.key);
  assert.notEqual(retiredSelection.key_digest, activeSelection.key_digest);
  const fixture = fakeGitHub({
    pullRequest: setup.pullRequest,
    comments: [
      journalWithState(setup.events, currentIntended, {
        selections: [
          selectionReceiptFromDispatch(retiredSelection),
          selectionReceiptFromDispatch(activeSelection),
        ],
      }),
    ],
    uiVercelConfiguration: NATIVE_OWNED_UI_VERCEL_CONFIGURATION,
  });
  const core = fakeCore();
  const waits = [];

  const state = await reconcilePreview({
    github: fixture.github,
    workerDispatchGithub: null,
    controllerMode: "observe-only",
    context: fakeContext({ runId: 7_001 }),
    core,
    prNumber: 519,
    waitForRecovery: async (milliseconds) => waits.push(milliseconds),
  });

  assert.equal(fixture.dispatches.length, 0);
  assert.equal(fixture.workerDispatchRequests.length, 0);
  assert.deepEqual(waits, [500, 500, 500, 500]);
  assert.equal(fixture.workflowRunListRequests.length, 6);
  assert.equal(state.targets.ui.active, null);
  assert.equal(state.targets.ui.retired_active.length, 0);
  const journal = journalFromComment(fixture.comments[0]);
  assert.equal(journal.receipts.results.length, 2);
  assert.ok(
    journal.receipts.results.every(
      ({ worker_run_id: workerRunId }) => workerRunId === 7_001,
    ),
  );
  assert.equal(
    new Set(journal.receipts.results.map(({ key_digest }) => key_digest)).size,
    2,
  );
  assert.equal(journal.state.targets.ui.active, null);
  assert.equal(journal.state.targets.ui.retired_active.length, 0);
  assert.equal(fixture.commitStatuses.at(-1).state, "success");
  assert.equal(
    fixture.commitStatuses.at(-1).description,
    "GitHub preview dispatch is observe-only",
  );
});

test("same-SHA native-owned receipts stay distinct across epoch selection digests", () => {
  const setup = sameShaReopenIntentState();
  const intended = persistIntent(setup.current);
  const retiredSelection = intended.targets.ui.retired_active[0];
  const activeSelection = intended.targets.ui.active;
  assert.equal(retiredSelection.sha, activeSelection.sha);
  assert.equal(retiredSelection.key, activeSelection.key);
  assert.notEqual(
    retiredSelection.epoch_anchor_run_id,
    activeSelection.epoch_anchor_run_id,
  );
  assert.notEqual(
    retiredSelection.reconciliation_basis_digest,
    activeSelection.reconciliation_basis_digest,
  );
  assert.notEqual(retiredSelection.key_digest, activeSelection.key_digest);

  const nativeResults = [retiredSelection, activeSelection].map((selection) =>
    controllerResult(selection, { runId: 7_001 }),
  );
  const selections = [retiredSelection, activeSelection].map((selection) =>
    selectionReceiptFromDispatch(selection),
  );
  const reconciled = reconcile({
    events: setup.events,
    results: nativeResults,
    selections,
    pullRequest: setup.pullRequest,
    existingState: intended,
  });

  assert.equal(reconciled.nextDispatch, null);
  assert.equal(reconciled.state.targets.ui.active, null);
  assert.deepEqual(reconciled.state.targets.ui.retired_active, []);
  assert.equal(reconciled.state.targets.ui.last_successful_runtime_sha, null);
  assert.equal(reconciled.state.targets.ui.last_successful_runtime_url, null);
  assert.deepEqual(reconciled.state.targets.ui.terminal_result_key_digests, [
    activeSelection.key_digest,
  ]);
  assert.equal(reconciled.state.status_decisions[0].state, "success");
  assert.equal(
    reconciled.state.status_decisions[0].description,
    "app=none; governance=none; reserve=none; ui=native",
  );

  const journal = createPreviewJournal({
    pr: 519,
    events: setup.events,
    selections,
    results: nativeResults,
    state: reconciled.state,
  });
  assert.equal(journal.receipts.results.length, 2);
  assert.equal(
    new Set(journal.receipts.results.map(({ key_digest }) => key_digest)).size,
    2,
  );
  assert.deepEqual(
    new Set(journal.receipts.results.map(({ worker_run_id }) => worker_run_id)),
    new Set([7_001]),
  );
});

test("no-dispatch retirement stays authoritative over an earlier real worker result on replay", async () => {
  const opened = event({
    run: 121,
    action: "opened",
    head: SHA.A,
    updated: timestamp(1),
  });
  const pullRequest = pull({ head: SHA.A, updated: timestamp(1) });
  const first = reconcile({ events: [opened], pullRequest });
  const firstDispatched = persistDispatch(first, 8_000);
  const firstFailure = result(first.nextDispatch, {
    runId: 8_000,
    state: "failure",
    reason: "build-failed-retriable",
  });
  const firstSelection = selectionReceiptFromDispatch(
    firstDispatched.targets.ui.active,
  );
  const retry = reconcile({
    events: [opened],
    results: [firstFailure],
    pullRequest,
    existingState: firstDispatched,
    selections: [firstSelection],
  });
  const retryIntended = persistIntent(retry);
  const retrySelection = selectionReceiptFromDispatch(
    retryIntended.targets.ui.active,
  );
  assert.equal(
    retrySelection.selection_receipt_run_id,
    firstSelection.selection_receipt_run_id,
  );
  assert.notEqual(retrySelection.key_digest, firstSelection.key_digest);
  const fixture = fakeGitHub({
    pullRequest,
    comments: [
      journalWithState([opened], retryIntended, {
        selections: [firstSelection, retrySelection],
        results: [firstFailure],
      }),
    ],
    uiVercelConfiguration: NATIVE_OWNED_UI_VERCEL_CONFIGURATION,
  });

  const retired = await reconcilePreview({
    github: fixture.github,
    workerDispatchGithub: null,
    controllerMode: "observe-only",
    context: fakeContext({ runId: 9_000 }),
    core: fakeCore(),
    prNumber: 519,
    waitForRecovery: async () => {},
  });

  assert.equal(retired.targets.ui.active, null);
  assert.equal(
    retired.targets.ui.terminal_history.at(-1).terminal_reason,
    "dispatch-disabled-intent-without-worker",
  );
  let journal = journalFromComment(fixture.comments[0]);
  assert.equal(journal.receipts.results.length, 2);
  assert.equal(
    journal.receipts.results.find(
      ({ terminal_reason: terminalReason }) =>
        terminalReason === "dispatch-disabled-intent-without-worker",
    ).worker_run_id,
    9_000,
  );

  const replayed = await reconcilePreview({
    github: fixture.github,
    workerDispatchGithub: null,
    controllerMode: "observe-only",
    context: fakeContext({ runId: 9_001 }),
    core: fakeCore(),
    prNumber: 519,
    waitForRecovery: async () => {},
  });

  assert.equal(replayed.targets.ui.active, null);
  assert.equal(
    replayed.targets.ui.terminal_history.at(-1).terminal_reason,
    "dispatch-disabled-intent-without-worker",
  );
  journal = journalFromComment(fixture.comments[0]);
  assert.equal(journal.receipts.results.length, 2);
  assert.equal(
    journal.state.targets.ui.terminal_history.at(-1).terminal_reason,
    "dispatch-disabled-intent-without-worker",
  );
  assert.equal(fixture.commitStatuses.at(-1).state, "success");
  assert.equal(
    fixture.commitStatuses.at(-1).description,
    "GitHub preview dispatch is observe-only",
  );
});

test("observe-only mode attaches a reopened epoch's matching worker in its retired slot", async () => {
  const setup = sameShaReopenIntentState();
  const queued = workerRun(setup.current.state.targets.ui.retired_active[0], {
    status: "in_progress",
  });
  const fixture = fakeGitHub({
    pullRequest: setup.pullRequest,
    comments: [
      journalWithState(setup.events, setup.current.state, {
        selections: [
          selectionReceiptFromDispatch(
            setup.current.state.targets.ui.retired_active[0],
          ),
        ],
      }),
    ],
    runs: [queued],
    uiVercelConfiguration: NATIVE_OWNED_UI_VERCEL_CONFIGURATION,
  });
  const core = fakeCore();

  const state = await reconcilePreview({
    github: fixture.github,
    workerDispatchGithub: null,
    controllerMode: "observe-only",
    context: fakeContext({ runId: 7_001 }),
    core,
    prNumber: 519,
    waitForRecovery: async () => {},
  });

  assert.equal(fixture.dispatches.length, 0);
  assert.equal(fixture.workerDispatchRequests.length, 0);
  assert.equal(core.outputs.get("recovered_intended_run_id"), "8000");
  assert.equal(state.targets.ui.active, null);
  assert.equal(state.targets.ui.retired_active.length, 1);
  assert.equal(state.targets.ui.retired_active[0].dispatch_state, "dispatched");
  assert.equal(state.targets.ui.retired_active[0].workflow_run_id, 8_000);
  const journal = journalFromComment(fixture.comments[0]);
  assert.equal(journal.receipts.results.length, 0);
  assert.equal(journal.state.targets.ui.active, null);
  assert.equal(
    journal.state.targets.ui.retired_active[0].workflow_run_id,
    8_000,
  );
  assert.equal(fixture.commitStatuses.at(-1).state, "pending");
  assert.equal(
    fixture.commitStatuses.at(-1).description,
    "Draining GitHub preview before native ownership",
  );
});

test("observe-only mode fails closed when multiple workers match one crash-window intent", async () => {
  const opened = event({
    run: 121,
    action: "opened",
    head: SHA.A,
    updated: timestamp(1),
  });
  const pullRequest = pull({ head: SHA.A, updated: timestamp(1) });
  const selected = reconcile({ events: [opened], pullRequest });
  const intended = persistIntent(selected);
  const fixture = fakeGitHub({
    pullRequest,
    comments: [journalWithState([opened], intended)],
    runs: [
      workerRun(selected.nextDispatch, { id: 8_000 }),
      workerRun(selected.nextDispatch, { id: 8_001 }),
    ],
    uiVercelConfiguration: NATIVE_OWNED_UI_VERCEL_CONFIGURATION,
  });

  await assert.rejects(
    reconcilePreview({
      github: fixture.github,
      workerDispatchGithub: null,
      controllerMode: "observe-only",
      context: fakeContext({ runId: 7_001 }),
      core: fakeCore(),
      prNumber: 519,
      waitForRecovery: async () => {},
    }),
    /Multiple worker runs match one intended controller key/,
  );

  assert.equal(fixture.dispatches.length, 0);
  assert.equal(fixture.workerDispatchRequests.length, 0);
  assert.equal(fixture.commentUpdates.length, 0);
  assert.equal(
    journalFromComment(fixture.comments[0]).state.targets.ui.active
      .dispatch_state,
    "intended",
  );
  assert.equal(fixture.commitStatuses.at(-1).state, "error");
});

test("controller mode is explicit and rejects unknown values before API access", async () => {
  let apiCalls = 0;
  const github = {
    rest: {
      pulls: {
        get: async () => {
          apiCalls += 1;
          return { data: pull() };
        },
      },
    },
  };

  await assert.rejects(
    reconcilePreview({
      github,
      controllerMode: "shadow",
      context: fakeContext(),
      core: fakeCore(),
      prNumber: 519,
    }),
    /Preview controller mode must be active or observe-only/,
  );
  assert.equal(apiCalls, 0);
});

test("a missing worker dispatch credential fails closed only when a new dispatch is required", async () => {
  const opened = event({
    run: 120,
    action: "opened",
    head: SHA.A,
    updated: timestamp(1),
  });
  const fixture = fakeGitHub({
    pullRequest: pull({ head: SHA.A, updated: timestamp(1) }),
    comments: [journalComment({ events: [opened] })],
  });

  await assert.rejects(
    reconcilePreview({
      github: fixture.github,
      workerDispatchGithub: null,
      context: fakeContext(),
      core: fakeCore(),
      prNumber: 519,
      waitForRecovery: async () => {},
    }),
    /Worker dispatch credential is unavailable/,
  );

  assert.equal(fixture.dispatches.length, 0);
  assert.equal(fixture.workerDispatchRequests.length, 0);
  assert.equal(
    fixture.primaryRequests.some(({ route }) => route.includes("/dispatches")),
    false,
  );
  assert.equal(fixture.commitStatuses.at(-1).state, "error");
  const journal = journalFromComment(fixture.comments[0]);
  assert.equal(journal.receipts.selections.length, 1);
  assert.equal(journal.state.targets.ui.active.dispatch_state, "intended");
  assert.equal(journal.state.targets.ui.active.workflow_run_id, null);
});

test("durable dispatch fails closed when the exact run title never materializes", async () => {
  const opened = event({
    run: 121,
    action: "opened",
    head: SHA.A,
    updated: timestamp(1),
  });
  const fixture = fakeGitHub({
    pullRequest: pull({ head: SHA.A, updated: timestamp(1) }),
    comments: [journalComment({ events: [opened] })],
    workflowRunDisplayTitles: Array(31).fill("Vercel Preview Worker"),
  });
  const waits = [];

  await assert.rejects(
    reconcilePreview({
      github: fixture.github,
      context: fakeContext(),
      core: fakeCore(),
      prNumber: 519,
      waitForRecovery: async (milliseconds) => waits.push(milliseconds),
    }),
    /Worker run name is not strictly parseable/,
  );
  assert.deepEqual(waits, [500, 500, ...Array(30).fill(1_000)]);
  assert.deepEqual(fixture.workflowRunRequests, Array(31).fill(8_000));
  assert.equal(fixture.commitStatuses.at(-1).state, "error");
});

test("recovery rechecks PR openness immediately before dispatch", async () => {
  const opened = event({
    run: 121,
    action: "opened",
    head: SHA.A,
    updated: timestamp(1),
  });
  const openPull = pull({ head: SHA.A, updated: timestamp(1) });
  const closedPull = pull({
    head: SHA.A,
    state: "closed",
    updated: timestamp(2),
    closed: timestamp(2),
  });
  const fixture = fakeGitHub({
    pullRequest: closedPull,
    pullRequests: [openPull, openPull, closedPull],
    comments: [journalComment({ events: [opened] })],
  });
  const core = fakeCore();
  const waits = [];

  const state = await reconcilePreview({
    github: fixture.github,
    context: fakeContext(),
    core,
    prNumber: 519,
    waitForRecovery: async (milliseconds) => waits.push(milliseconds),
  });

  assert.equal(state.targets.ui.active.dispatch_state, "intended");
  assert.equal(fixture.dispatches.length, 0);
  assert.deepEqual(waits, [500, 500]);
  assert.equal(core.outputs.get("dispatch_skipped_closed"), "true");
  assert.equal(fixture.commitStatuses.length, 0);
});

test("recovery reuses an intent rebound while it waits for run visibility", async () => {
  const opened = event({
    run: 121,
    action: "opened",
    head: SHA.A,
    updated: timestamp(1),
  });
  const pullRequest = pull({ head: SHA.A, updated: timestamp(1) });
  const selected = reconcile({
    events: [opened],
    pullRequest,
  });
  const intended = persistIntent(selected);
  const fixture = fakeGitHub({
    pullRequest,
    comments: [
      journalComment({
        events: [opened],
        selections: [selectionReceiptFromDispatch(intended.targets.ui.active)],
        state: intended,
      }),
    ],
    runs: [workerRun(selected.nextDispatch)],
    workflowRunListRunIds: [[], [], []],
  });
  let rebound = false;

  const state = await reconcilePreview({
    github: fixture.github,
    context: fakeContext(),
    core: fakeCore(),
    prNumber: 519,
    waitForRecovery: async () => {
      if (rebound) return;
      rebound = true;
      const comment = fixture.comments.find(({ body }) =>
        body.startsWith(PREVIEW_JOURNAL_MARKER),
      );
      comment.body = journalComment(
        {
          revision: 2,
          events: [opened],
          selections: [
            selectionReceiptFromDispatch(intended.targets.ui.active),
          ],
          state: persistDispatch(selected, 8_000),
        },
        comment.id,
      ).body;
    },
  });

  assert.equal(state.targets.ui.active.dispatch_state, "dispatched");
  assert.equal(state.targets.ui.active.workflow_run_id, 8_000);
  assert.equal(fixture.dispatches.length, 0);
  assert.equal(fixture.commitStatuses.at(-1).state, "pending");
});

test("a dispatch racing a main advance is terminalized and automatically reselected", async () => {
  const opened = event({
    run: 121,
    action: "opened",
    head: SHA.A,
    updated: timestamp(1),
  });
  const pullRequest = pull({ head: SHA.A, updated: timestamp(1) });
  const fixture = fakeGitHub({
    pullRequest,
    comments: [journalComment({ events: [opened] })],
    dispatchedWorkflowSha: SHA.B,
  });

  await assert.rejects(
    reconcilePreview({
      github: fixture.github,
      context: fakeContext(),
      core: fakeCore(),
      prNumber: 519,
      workflowSha: SHA.A,
      waitForRecovery: async () => {},
    }),
    /Worker workflow SHA does not match controller-authorized SHA/,
  );
  assert.equal(fixture.dispatches.length, 1);
  assert.equal(fixture.dispatches[0].inputs.expected_workflow_sha, SHA.A);
  assert.ok(
    fixture.comments.some(
      ({ body }) =>
        body.includes('"dispatch_state": "intended"') &&
        body.includes(`"expected_workflow_sha": "${SHA.A}"`),
    ),
  );
  assert.ok(
    fixture.comments.some(({ body }) =>
      body.includes(
        '"terminal_reason": "controller-workflow-upgraded-before-dispatch"',
      ),
    ),
  );
  assert.equal(fixture.commitStatuses.at(-1).state, "error");

  fixture.runs[0].status = "completed";
  fixture.runs[0].conclusion = "failure";
  const callbackCore = fakeCore();
  const callbackResult = await recoverWorkerResult({
    github: fixture.github,
    context: fakeContext({
      runId: 7_001,
      workflowRun: fixture.runs[0],
    }),
    core: callbackCore,
    waitForRecovery: async () => {},
  });
  assert.equal(
    callbackResult.terminal_reason,
    "controller-workflow-upgraded-before-dispatch",
  );
  assert.equal(callbackResult.should_reconcile_current_epoch, true);
  assert.equal(callbackCore.outputs.get("result_state"), "error");

  const recoveredState = await reconcilePreview({
    github: fixture.github,
    context: fakeContext({ runId: 7_001 }),
    core: fakeCore(),
    prNumber: 519,
    workflowSha: SHA.B,
    waitForRecovery: async () => {},
  });
  assert.equal(fixture.dispatches.length, 2);
  assert.equal(fixture.dispatches[1].inputs.expected_workflow_sha, SHA.B);
  assert.notEqual(
    fixture.dispatches[1].inputs.controller_key_digest,
    fixture.dispatches[0].inputs.controller_key_digest,
  );
  assert.equal(recoveredState.targets.ui.active.expected_workflow_sha, SHA.B);
  assert.equal(recoveredState.targets.ui.active.dispatch_state, "dispatched");
  assert.equal(recoveredState.targets.ui.active.workflow_run_id, 8_001);
});

test("intended dispatch recovery attaches exactly one run and fails closed on ambiguity", async () => {
  const opened = event({
    run: 122,
    action: "opened",
    head: SHA.A,
    updated: timestamp(1),
  });
  const pullRequest = pull({ head: SHA.A, updated: timestamp(1) });
  const selected = reconcile({
    events: [opened],
    pullRequest,
  });
  const intended = persistIntent(selected);
  const listedRun = workerRun(selected.nextDispatch);
  const existingRun = { ...listedRun, name: listedRun.display_title };
  const recovered = fakeGitHub({
    pullRequest,
    comments: [journalWithState([opened], intended)],
    runs: [existingRun],
  });
  const state = await reconcilePreview({
    github: recovered.github,
    workerDispatchGithub: null,
    context: fakeContext(),
    core: fakeCore(),
    prNumber: 519,
    waitForRecovery: async () => {},
  });
  assert.equal(recovered.dispatches.length, 0);
  assert.equal(recovered.workerDispatchRequests.length, 0);
  assert.equal(state.targets.ui.active.workflow_run_id, existingRun.id);

  const ambiguous = fakeGitHub({
    pullRequest,
    comments: [journalWithState([opened], intended)],
    runs: [existingRun, workerRun(selected.nextDispatch, { id: 8_001 })],
  });
  await assert.rejects(
    reconcilePreview({
      github: ambiguous.github,
      context: fakeContext(),
      core: fakeCore(),
      prNumber: 519,
      waitForRecovery: async () => {},
    }),
    /Multiple worker runs/,
  );
  assert.equal(ambiguous.dispatches.length, 0);
  assert.equal(ambiguous.commitStatuses.at(-1).state, "error");
});

test("intended recovery waits for a default-title run without redispatching", async () => {
  const opened = event({
    run: 122,
    action: "opened",
    head: SHA.A,
    updated: timestamp(1),
  });
  const pullRequest = pull({ head: SHA.A, updated: timestamp(1) });
  const selected = reconcile({
    events: [opened],
    pullRequest,
  });
  const intended = persistIntent(selected);
  const existingRun = workerRun(selected.nextDispatch);
  const fixture = fakeGitHub({
    pullRequest,
    comments: [journalWithState([opened], intended)],
    runs: [existingRun],
    workflowRunListDisplayTitles: Array.from({ length: 10 }, () => [
      "Vercel Preview Worker",
    ]),
    workflowRunDisplayTitles: Array(9).fill("Vercel Preview Worker"),
  });
  const waits = [];

  const state = await reconcilePreview({
    github: fixture.github,
    context: fakeContext(),
    core: fakeCore(),
    prNumber: 519,
    waitForRecovery: async (milliseconds) => waits.push(milliseconds),
  });

  assert.equal(fixture.dispatches.length, 0);
  assert.equal(state.targets.ui.active.workflow_run_id, existingRun.id);
  assert.deepEqual(waits, Array(10).fill(1_000));
  assert.equal(fixture.workflowRunListRequests.length, 11);
  assert.equal(fixture.workflowRunRequests.length, 9);
});

test("intended recovery fails closed while a default-title run remains unresolved", async () => {
  const opened = event({
    run: 122,
    action: "opened",
    head: SHA.A,
    updated: timestamp(1),
  });
  const pullRequest = pull({ head: SHA.A, updated: timestamp(1) });
  const selected = reconcile({
    events: [opened],
    pullRequest,
  });
  const intended = persistIntent(selected);
  const fixture = fakeGitHub({
    pullRequest,
    comments: [journalWithState([opened], intended)],
    runs: [workerRun(selected.nextDispatch)],
    workflowRunListDisplayTitles: Array.from({ length: 31 }, () => [
      "Vercel Preview Worker",
    ]),
    workflowRunDisplayTitles: Array(30).fill("Vercel Preview Worker"),
  });
  const waits = [];

  await assert.rejects(
    reconcilePreview({
      github: fixture.github,
      context: fakeContext(),
      core: fakeCore(),
      prNumber: 519,
      waitForRecovery: async (milliseconds) => waits.push(milliseconds),
    }),
    /Worker run name is not strictly parseable/,
  );

  assert.equal(fixture.dispatches.length, 0);
  assert.deepEqual(waits, Array(30).fill(1_000));
  assert.equal(fixture.workflowRunListRequests.length, 31);
  assert.equal(fixture.workflowRunRequests.length, 30);
  assert.equal(fixture.commitStatuses.at(-1).state, "error");
});

test("intended recovery keeps re-querying a default-title run missing from later lists", async () => {
  const opened = event({
    run: 122,
    action: "opened",
    head: SHA.A,
    updated: timestamp(1),
  });
  const pullRequest = pull({ head: SHA.A, updated: timestamp(1) });
  const selected = reconcile({
    events: [opened],
    pullRequest,
  });
  const intended = persistIntent(selected);
  const fixture = fakeGitHub({
    pullRequest,
    comments: [journalWithState([opened], intended)],
    runs: [workerRun(selected.nextDispatch)],
    workflowRunListDisplayTitles: [["Vercel Preview Worker"]],
    workflowRunListRunIds: [[8_000], ...Array.from({ length: 30 }, () => [])],
    workflowRunDisplayTitles: Array(30).fill("Vercel Preview Worker"),
  });
  const waits = [];

  await assert.rejects(
    reconcilePreview({
      github: fixture.github,
      context: fakeContext(),
      core: fakeCore(),
      prNumber: 519,
      waitForRecovery: async (milliseconds) => waits.push(milliseconds),
    }),
    /Worker run name is not strictly parseable/,
  );

  assert.equal(fixture.dispatches.length, 0);
  assert.deepEqual(waits, Array(30).fill(1_000));
  assert.equal(fixture.workflowRunListRequests.length, 31);
  assert.equal(fixture.workflowRunRequests.length, 30);
  assert.equal(fixture.commitStatuses.at(-1).state, "error");
});

test("intended recovery rejects a second owner materializing from a default title", async () => {
  const opened = event({
    run: 122,
    action: "opened",
    head: SHA.A,
    updated: timestamp(1),
  });
  const pullRequest = pull({ head: SHA.A, updated: timestamp(1) });
  const selected = reconcile({
    events: [opened],
    pullRequest,
  });
  const intended = persistIntent(selected);
  const firstRun = workerRun(selected.nextDispatch);
  const secondRun = workerRun(selected.nextDispatch, { id: 8_001 });
  const fixture = fakeGitHub({
    pullRequest,
    comments: [journalWithState([opened], intended)],
    runs: [firstRun, secondRun],
    workflowRunListDisplayTitles: [
      [firstRun.display_title, "Vercel Preview Worker"],
    ],
  });
  const waits = [];

  await assert.rejects(
    reconcilePreview({
      github: fixture.github,
      context: fakeContext(),
      core: fakeCore(),
      prNumber: 519,
      waitForRecovery: async (milliseconds) => waits.push(milliseconds),
    }),
    /Multiple worker runs/,
  );

  assert.equal(fixture.dispatches.length, 0);
  assert.deepEqual(waits, [1_000]);
  assert.equal(fixture.workflowRunListRequests.length, 2);
  assert.equal(fixture.commitStatuses.at(-1).state, "error");
});

test("intended recovery attaches one exact owner after a default title settles unrelated", async () => {
  const opened = event({
    run: 122,
    action: "opened",
    head: SHA.A,
    updated: timestamp(1),
  });
  const pullRequest = pull({ head: SHA.A, updated: timestamp(1) });
  const selected = reconcile({
    events: [opened],
    pullRequest,
  });
  const intended = persistIntent(selected);
  const exactRun = workerRun(selected.nextDispatch);
  const unrelatedRun = workerRun(
    { ...selected.nextDispatch, sha: SHA.B },
    { id: 8_001 },
  );
  const fixture = fakeGitHub({
    pullRequest,
    comments: [journalWithState([opened], intended)],
    runs: [exactRun, unrelatedRun],
    workflowRunListDisplayTitles: [
      [exactRun.display_title, "Vercel Preview Worker"],
    ],
  });
  const waits = [];

  const state = await reconcilePreview({
    github: fixture.github,
    context: fakeContext(),
    core: fakeCore(),
    prNumber: 519,
    waitForRecovery: async (milliseconds) => waits.push(milliseconds),
  });

  assert.equal(fixture.dispatches.length, 0);
  assert.equal(state.targets.ui.active.workflow_run_id, exactRun.id);
  assert.deepEqual(waits, [1_000]);
  assert.equal(fixture.workflowRunListRequests.length, 2);
});

test("intended recovery rejects a malformed candidate title without retrying", async () => {
  const opened = event({
    run: 122,
    action: "opened",
    head: SHA.A,
    updated: timestamp(1),
  });
  const pullRequest = pull({ head: SHA.A, updated: timestamp(1) });
  const selected = reconcile({
    events: [opened],
    pullRequest,
  });
  const intended = persistIntent(selected);
  const malformedRun = {
    ...workerRun(selected.nextDispatch),
    display_title: "Vercel preview worker malformed",
  };
  const fixture = fakeGitHub({
    pullRequest,
    comments: [journalWithState([opened], intended)],
    runs: [malformedRun],
  });
  const waits = [];

  await assert.rejects(
    reconcilePreview({
      github: fixture.github,
      context: fakeContext(),
      core: fakeCore(),
      prNumber: 519,
      waitForRecovery: async (milliseconds) => waits.push(milliseconds),
    }),
    /Worker run name is not strictly parseable/,
  );

  assert.equal(fixture.dispatches.length, 0);
  assert.deepEqual(waits, []);
  assert.equal(fixture.workflowRunListRequests.length, 1);
  assert.equal(fixture.commitStatuses.at(-1).state, "error");
});

test("intended recovery ignores wrong-SHA artifacts and reselects stale intents", async () => {
  const opened = event({
    run: 122,
    action: "opened",
    head: SHA.A,
    updated: timestamp(1),
  });
  const pullRequest = pull({ head: SHA.A, updated: timestamp(1) });
  const authorized = reconcile({
    events: [opened],
    pullRequest,
    expectedWorkflowSha: SHA.A,
  });
  const intended = persistIntent(authorized);

  const conflictingRun = fakeGitHub({
    pullRequest,
    comments: [journalWithState([opened], intended)],
    runs: [
      workerRun(authorized.nextDispatch, {
        id: 8_100,
        workflowSha: SHA.B,
      }),
    ],
  });
  const conflictingRecoveredState = await reconcilePreview({
    github: conflictingRun.github,
    context: fakeContext(),
    core: fakeCore(),
    prNumber: 519,
    workflowSha: SHA.B,
    waitForRecovery: async () => {},
  });
  assert.equal(conflictingRun.dispatches.length, 1);
  assert.equal(
    conflictingRun.dispatches[0].inputs.expected_workflow_sha,
    SHA.B,
  );
  assert.equal(
    conflictingRecoveredState.targets.ui.active.expected_workflow_sha,
    SHA.B,
  );
  assert.equal(
    conflictingRecoveredState.targets.ui.active.workflow_run_id,
    8_000,
  );
  assert.ok(
    conflictingRun.comments.some(({ body }) =>
      body.includes(
        '"terminal_reason": "controller-workflow-upgraded-before-dispatch"',
      ),
    ),
  );

  const mainAdvancedBeforeDispatch = fakeGitHub({
    pullRequest,
    comments: [journalWithState([opened], intended)],
  });
  const recoveredState = await reconcilePreview({
    github: mainAdvancedBeforeDispatch.github,
    context: fakeContext(),
    core: fakeCore(),
    prNumber: 519,
    workflowSha: SHA.B,
    waitForRecovery: async () => {},
  });
  assert.equal(mainAdvancedBeforeDispatch.dispatches.length, 1);
  assert.equal(
    mainAdvancedBeforeDispatch.dispatches[0].inputs.expected_workflow_sha,
    SHA.B,
  );
  assert.equal(recoveredState.targets.ui.active.expected_workflow_sha, SHA.B);
  assert.equal(recoveredState.targets.ui.active.dispatch_state, "dispatched");
  assert.ok(
    mainAdvancedBeforeDispatch.comments.some(
      ({ body }) =>
        body.includes(
          '"terminal_reason": "controller-workflow-upgraded-before-dispatch"',
        ) && body.includes(`"expected_workflow_sha": "${SHA.A}"`),
    ),
  );
  assert.equal(
    mainAdvancedBeforeDispatch.commitStatuses.at(-1).state,
    "pending",
  );
});

test("controller-upgrade terminalization does not consume a real worker retry", () => {
  const opened = event({
    run: 122,
    action: "opened",
    head: SHA.A,
    updated: timestamp(1),
  });
  const pullRequest = pull({ head: SHA.A, updated: timestamp(1) });
  const authorizedA = reconcile({
    events: [opened],
    pullRequest,
    expectedWorkflowSha: SHA.A,
  });
  const intendedA = persistIntent(authorizedA);
  const upgradeResult = result(authorizedA.nextDispatch, {
    runId: 7_000,
    state: "error",
    reason: "controller-workflow-upgraded-before-dispatch",
  });
  const selectedB = reconcile({
    events: [opened],
    results: [upgradeResult],
    pullRequest,
    existingState: intendedA,
    expectedWorkflowSha: SHA.B,
  });
  assert.equal(selectedB.nextDispatch.expected_workflow_sha, SHA.B);

  const dispatchedB = persistDispatch(selectedB, 8_000);
  const firstRealFailure = result(selectedB.nextDispatch, {
    runId: 8_000,
    state: "failure",
    reason: "build-failed-retriable",
  });
  const retry = reconcile({
    events: [opened],
    results: [upgradeResult, firstRealFailure],
    pullRequest,
    existingState: dispatchedB,
    expectedWorkflowSha: SHA.B,
  });
  assert.equal(retry.nextDispatch.sha, SHA.A);
  assert.equal(retry.nextDispatch.expected_workflow_sha, SHA.B);
  assert.notEqual(
    retry.nextDispatch.key_digest,
    selectedB.nextDispatch.key_digest,
  );
});

test("intended recovery paginates its time window and ignores more than 300 older runs", async () => {
  const opened = event({
    run: 122,
    action: "opened",
    head: SHA.A,
    updated: timestamp(1),
  });
  const pullRequest = pull({ head: SHA.A, updated: timestamp(1) });
  const selected = reconcile({ events: [opened], pullRequest });
  const intended = persistIntent(selected);
  const decoys = Array.from({ length: 100 }, (_, index) =>
    workerRun({ ...selected.nextDispatch, sha: SHA.B }, { id: 9_000 + index }),
  );
  const matchOnSecondPage = workerRun(selected.nextDispatch, { id: 8_000 });
  const paginated = fakeGitHub({
    pullRequest,
    comments: [journalWithState([opened], intended)],
    runs: [...decoys, matchOnSecondPage],
  });
  const state = await reconcilePreview({
    github: paginated.github,
    context: fakeContext(),
    core: fakeCore(),
    prNumber: 519,
    waitForRecovery: async () => {},
  });
  assert.equal(paginated.dispatches.length, 0);
  assert.equal(state.targets.ui.active.workflow_run_id, 8_000);

  const olderHistory = Array.from({ length: 350 }, (_, index) =>
    workerRun(
      { ...selected.nextDispatch, sha: SHA.B },
      { id: 10_000 + index, createdAt: "2026-07-14T10:00:01.000Z" },
    ),
  );
  const bounded = fakeGitHub({
    pullRequest,
    comments: [journalWithState([opened], intended)],
    runs: [...olderHistory, matchOnSecondPage],
  });
  const boundedState = await reconcilePreview({
    github: bounded.github,
    context: fakeContext(),
    core: fakeCore(),
    prNumber: 519,
    waitForRecovery: async () => {},
  });
  assert.equal(bounded.dispatches.length, 0);
  assert.equal(boundedState.targets.ui.active.workflow_run_id, 8_000);
  assert.equal(
    bounded.workflowRunListRequests[0].created,
    `${timestamp(0).replace("10:00:00", "09:58:00")}..${timestamp(0).replace("10:00:00", "10:15:00")}`,
  );
});

test("manual reconcile recovers a completed REST-named worker when its callback was missed", async () => {
  const opened = event({
    run: 122,
    action: "opened",
    head: SHA.A,
    updated: timestamp(1),
  });
  const pullRequest = pull({ head: SHA.A, updated: timestamp(1) });
  const selected = reconcile({ events: [opened], pullRequest });
  const dispatched = persistDispatch(selected, 8_000);
  const completed = workerRun(selected.nextDispatch, {
    status: "completed",
    conclusion: "cancelled",
  });
  completed.name = completed.display_title;
  const fixture = fakeGitHub({
    pullRequest,
    comments: [journalWithState([opened], dispatched)],
    runs: [completed],
  });
  const state = await reconcilePreview({
    github: fixture.github,
    context: fakeContext({ runId: 7_001 }),
    core: fakeCore(),
    prNumber: 519,
    waitForRecovery: async () => {},
  });
  assert.equal(fixture.dispatches.length, 0);
  assert.equal(state.targets.ui.active, null);
  assert.equal(
    state.targets.ui.terminal_history.at(-1).terminal_reason,
    "worker-cancelled",
  );
  assert.equal(fixture.commitStatuses.at(-1).sha, SHA.A);
  assert.equal(fixture.commitStatuses.at(-1).state, "failure");
  assert.equal(fixture.createdDeploymentStatuses.at(-1).state, "error");
});

test("a force-pushed-away active selection is aborted before credentials and newest lineage is promoted", async () => {
  const opened = event({
    run: 122,
    action: "opened",
    head: SHA.A,
    updated: timestamp(1),
  });
  const runtimeB = event({
    run: 123,
    action: "synchronize",
    before: SHA.A,
    head: SHA.B,
    updated: timestamp(2),
  });
  const runtimeC = event({
    run: 124,
    action: "synchronize",
    before: SHA.B,
    head: SHA.C,
    updated: timestamp(3),
  });
  const initial = reconcile({
    events: [opened],
    pullRequest: pull({ head: SHA.A, updated: timestamp(1) }),
  });
  const pullRequest = pull({ head: SHA.C, updated: timestamp(3) });
  const fixture = fakeGitHub({
    pullRequest,
    comments: [
      journalWithState([opened, runtimeB, runtimeC], persistIntent(initial)),
    ],
    pullCommits: [SHA.C],
  });
  const state = await reconcilePreview({
    github: fixture.github,
    context: fakeContext({ runId: 7_002 }),
    core: fakeCore(),
    prNumber: 519,
    waitForRecovery: async () => {},
  });
  assert.equal(fixture.dispatches.length, 1);
  assert.equal(fixture.dispatches[0].inputs.commit_sha, SHA.C);
  assert.equal(state.targets.ui.active.sha, SHA.C);
  assert.ok(
    fixture.comments.some(({ body }) =>
      body.includes('"terminal_reason": "selection-removed-from-pr"'),
    ),
  );
  assert.ok(
    fixture.commitStatuses.some(
      ({ sha, state: statusState }) =>
        sha === SHA.A && statusState === "failure",
    ),
  );
});

test("cancelled worker before Deployment creation gets one canonical error Deployment and result receipt", async () => {
  const opened = event({
    run: 123,
    action: "opened",
    head: SHA.A,
    updated: timestamp(1),
  });
  const pullRequest = pull({ head: SHA.A, updated: timestamp(1) });
  const selected = reconcile({ events: [opened], pullRequest });
  const dispatched = persistDispatch(selected, 8_000);
  const completed = workerRun(selected.nextDispatch, {
    status: "completed",
    conclusion: "cancelled",
  });
  const fixture = fakeGitHub({
    pullRequest,
    comments: [journalWithState([opened], dispatched)],
    runs: [completed],
  });
  const result = await recoverWorkerResult({
    github: fixture.github,
    context: fakeContext({ workflowRun: completed }),
    core: fakeCore(),
  });
  assert.equal(result.state, "error");
  assert.equal(result.terminal_reason, "worker-cancelled");
  assert.equal(fixture.deployments.length, 1);
  assert.equal(fixture.deployments[0].ref, SHA.A);
  assert.equal(fixture.deployments[0].environment, "preview/ui/pr-519");
  assert.equal(fixture.createdDeploymentStatuses.length, 1);
  assert.equal(fixture.createdDeploymentStatuses[0].state, "error");
  assert.equal(fixture.comments.length, 1);
  assert.equal(
    journalFromComment(fixture.comments[0]).receipts.results.length,
    1,
  );
});

test("completed callback durably binds an intended dispatch after a controller crash", async () => {
  const opened = event({
    run: 123,
    action: "opened",
    head: SHA.A,
    updated: timestamp(1),
  });
  const pullRequest = pull({ head: SHA.A, updated: timestamp(1) });
  const selected = reconcile({ events: [opened], pullRequest });
  const intended = persistIntent(selected);
  const completed = workerRun(selected.nextDispatch, {
    status: "completed",
    conclusion: "cancelled",
  });
  const fixture = fakeGitHub({
    pullRequest,
    comments: [journalWithState([opened], intended)],
    runs: [completed],
    workflowRunDisplayTitles: ["Vercel Preview Worker"],
  });
  const core = fakeCore();
  const waits = [];
  const outcome = await recoverWorkerResult({
    github: fixture.github,
    context: fakeContext({ workflowRun: completed }),
    core,
    waitForRecovery: async (milliseconds) => waits.push(milliseconds),
  });
  assert.equal(outcome.terminal_reason, "worker-cancelled");
  assert.equal(core.outputs.get("recovered_intended_run_id"), "8000");
  assert.deepEqual(waits, [1_000]);
  assert.deepEqual(fixture.workflowRunRequests, [8_000, 8_000]);
  const controllerState = fixture.comments.find(({ body }) =>
    body.startsWith(PREVIEW_JOURNAL_MARKER),
  );
  assert.match(controllerState.body, /"dispatch_state": "dispatched"/);
  assert.match(controllerState.body, /"workflow_run_id": 8000/);
  assert.match(controllerState.body, new RegExp(`"workflow_sha": "${SHA.E}"`));
});

test("completed intended callback fails closed unless its run is the unique recoverable owner", async () => {
  const opened = event({
    run: 123,
    action: "opened",
    head: SHA.A,
    updated: timestamp(1),
  });
  const pullRequest = pull({ head: SHA.A, updated: timestamp(1) });
  const selected = reconcile({ events: [opened], pullRequest });
  const intended = persistIntent(selected);
  const completed = workerRun(selected.nextDispatch, {
    id: 8_000,
    status: "completed",
    conclusion: "cancelled",
  });
  for (const runs of [
    [],
    [completed, workerRun(selected.nextDispatch, { id: 8_001 })],
  ]) {
    const fixture = fakeGitHub({
      pullRequest,
      comments: [journalWithState([opened], intended)],
      runs,
    });
    await assert.rejects(
      recoverWorkerResult({
        github: fixture.github,
        context: fakeContext({ workflowRun: completed }),
        core: fakeCore(),
        waitForRecovery: async () => {},
      }),
      /unique recoverable owner|Multiple worker runs/,
    );
    assert.equal(fixture.deployments.length, 0);
    assert.equal(
      journalFromComment(fixture.comments[0]).receipts.results.length,
      0,
    );
  }
});

test("worker recovery errors fail the current exact SHA status closed without overwriting a newer epoch", async () => {
  const opened = event({
    run: 123,
    action: "opened",
    head: SHA.A,
    updated: timestamp(1),
  });
  const pullRequest = pull({ head: SHA.A, updated: timestamp(1) });
  const selected = reconcile({ events: [opened], pullRequest });
  const dispatched = persistDispatch(selected, 8_000);
  const completed = workerRun(selected.nextDispatch, {
    status: "completed",
    conclusion: "failure",
  });
  const fixture = fakeGitHub({
    pullRequest,
    comments: [journalWithState([opened], dispatched)],
    runs: [completed],
  });
  assert.equal(
    await postWorkerRecoveryError({
      github: fixture.github,
      context: fakeContext({ workflowRun: completed }),
    }),
    true,
  );
  assert.deepEqual(fixture.commitStatuses.at(-1), {
    owner: "mento-protocol",
    repo: "frontend-monorepo",
    sha: SHA.A,
    state: "error",
    context: "Vercel Preview",
    description: "Preview worker recovery is invalid or ambiguous",
    target_url:
      "https://github.com/mento-protocol/frontend-monorepo/actions/runs/8000",
  });

  for (const invalidRun of [
    { ...completed, name: "Another Workflow" },
    {
      ...completed,
      path: ".github/workflows/vercel-preview-worker.yml@feature",
    },
    { ...completed, event: "push" },
    { ...completed, head_branch: "feature" },
    { ...completed, head_sha: SHA.B },
    { ...completed, repository: { full_name: "attacker/example" } },
  ]) {
    assert.equal(
      await postWorkerRecoveryError({
        github: fixture.github,
        context: fakeContext({ workflowRun: invalidRun }),
      }),
      false,
    );
  }
  assert.equal(fixture.commitStatuses.length, 1);

  const staleRun = workerRun(
    { ...selected.nextDispatch, sha: SHA.B },
    { id: 8_001, status: "completed", conclusion: "failure" },
  );
  assert.equal(
    await postWorkerRecoveryError({
      github: fixture.github,
      context: fakeContext({ workflowRun: staleRun }),
    }),
    false,
  );
  assert.equal(fixture.commitStatuses.length, 1);
});

test("same-SHA reopened epoch resumes verified old upload evidence before its callback and old callback cannot corrupt new success", async () => {
  const setup = sameShaReopenState();
  const oldCompleted = workerRun(setup.old.nextDispatch, {
    id: 8_000,
    status: "completed",
    conclusion: "failure",
  });
  const newQueued = workerRun(setup.current.nextDispatch, { id: 8_001 });
  const canonical = {
    id: 9_000,
    ref: SHA.A,
    sha: SHA.A,
    environment: "preview/ui/pr-519",
    payload: {
      ...canonicalDeploymentBinding(),
      idempotency_key: setup.old.nextDispatch.key,
      sha: SHA.A,
      logical_target: "ui",
      workflow_run_url:
        "https://github.com/mento-protocol/frontend-monorepo/actions/runs/8000/attempts/1",
    },
  };
  const fixture = fakeGitHub({
    pullRequest: setup.pullRequest,
    comments: [
      journalWithState(setup.events, setup.currentState, {
        selections: [
          selectionReceiptFromDispatch(
            setup.currentState.targets.ui.retired_active[0],
          ),
          selectionReceiptFromDispatch(setup.currentState.targets.ui.active),
        ],
      }),
    ],
    runs: [oldCompleted, newQueued],
    deployments: [canonical],
    deploymentStatuses: new Map([
      [
        9_000,
        [
          {
            state: "failure",
            environment_url: null,
            log_url:
              "https://github.com/mento-protocol/frontend-monorepo/actions/runs/8000/attempts/1",
          },
        ],
      ],
    ]),
  });
  await recordWorkerEvidence({
    github: fixture.github,
    context: fakeContext({ runId: 8_000 }),
    core: fakeCore(),
    inputs: {
      ...workerInputs(setup.old.nextDispatch),
      execution_mode: "build",
      build_duration_ms: "1234",
      verified_upload_url: "https://ui-old-epoch.vercel.app",
      vercel_deployment_id: "dpl_OldEpoch",
      next_deployment_id: "m-ui-old-epoch",
    },
  });

  const validationCore = fakeCore();
  const decision = await validateWorkerDispatch({
    github: fixture.github,
    context: fakeContext({ runId: 8_001 }),
    core: validationCore,
    inputs: workerInputs(setup.current.nextDispatch),
  });
  assert.deepEqual(decision, {
    shouldDeploy: false,
    duplicate: false,
    resumeSmoke: true,
  });
  assert.equal(validationCore.outputs.get("should_resume_smoke"), "true");
  assert.equal(
    validationCore.outputs.get("vercel_deployment_url"),
    "https://ui-old-epoch.vercel.app",
  );

  fixture.statuses.set("9000", [
    {
      state: "success",
      environment_url: "https://ui-new-epoch.vercel.app",
      log_url:
        "https://github.com/mento-protocol/frontend-monorepo/actions/runs/8001/attempts/1",
    },
  ]);
  const controllerStateBefore = structuredClone(
    journalFromComment(fixture.comments[0]).state,
  );
  const recoveryCore = fakeCore();
  const oldResult = await recoverWorkerResult({
    github: fixture.github,
    context: fakeContext({ workflowRun: oldCompleted }),
    core: recoveryCore,
  });
  assert.equal(oldResult.state, "failure");
  assert.equal(oldResult.should_reconcile_current_epoch, false);
  assert.equal(
    recoveryCore.outputs.get("should_reconcile_current_epoch"),
    "false",
  );
  assert.equal(fixture.createdDeploymentStatuses.length, 0);
  assert.equal(fixture.statuses.get("9000")[0].state, "success");
  const journal = journalFromComment(fixture.comments[0]);
  assert.deepEqual(journal.state, {
    ...controllerStateBefore,
    targets: {
      ...controllerStateBefore.targets,
      ui: { ...controllerStateBefore.targets.ui, retired_active: [] },
    },
  });
  assert.equal(journal.receipts.worker_evidence.length, 1);
  assert.equal(journal.receipts.results.length, 1);
});

test("delayed old-epoch cancellation cannot claim or terminalize a same-SHA Deployment created by the reopened epoch", async () => {
  const setup = sameShaReopenState();
  const oldCompleted = workerRun(setup.old.nextDispatch, {
    id: 8_000,
    status: "completed",
    conclusion: "cancelled",
  });
  const fixture = fakeGitHub({
    pullRequest: setup.pullRequest,
    comments: [
      journalWithState(setup.events, setup.currentState, {
        selections: [
          selectionReceiptFromDispatch(
            setup.currentState.targets.ui.retired_active[0],
          ),
          selectionReceiptFromDispatch(setup.currentState.targets.ui.active),
        ],
      }),
    ],
    runs: [oldCompleted, workerRun(setup.current.nextDispatch, { id: 8_001 })],
    deployments: [
      {
        id: 9_000,
        ref: SHA.A,
        sha: SHA.A,
        environment: "preview/ui/pr-519",
        payload: {
          ...canonicalDeploymentBinding(),
          idempotency_key: setup.current.nextDispatch.key,
          sha: SHA.A,
          logical_target: "ui",
          workflow_run_url:
            "https://github.com/mento-protocol/frontend-monorepo/actions/runs/8001/attempts/1",
        },
      },
    ],
    deploymentStatuses: new Map([
      [
        9_000,
        [
          {
            state: "success",
            environment_url: "https://ui-new-owner.vercel.app",
            log_url:
              "https://github.com/mento-protocol/frontend-monorepo/actions/runs/8001/attempts/1",
          },
        ],
      ],
    ]),
  });
  const outcome = await recoverWorkerResult({
    github: fixture.github,
    context: fakeContext({ workflowRun: oldCompleted }),
    core: fakeCore(),
  });
  assert.equal(outcome.terminal_reason, "worker-cancelled");
  assert.equal(outcome.github_deployment_id, null);
  assert.equal(outcome.should_reconcile_current_epoch, false);
  assert.equal(fixture.createdDeploymentStatuses.length, 0);
  assert.equal(fixture.statuses.get("9000")[0].state, "success");
});

test("terminal reopened same-SHA ownership survives a delayed old-epoch callback", async () => {
  const setup = sameShaReopenState();
  const oldQueued = workerRun(setup.old.nextDispatch, { id: 8_000 });
  const currentCompleted = workerRun(setup.current.nextDispatch, {
    id: 8_001,
    status: "completed",
    conclusion: "success",
  });
  const canonical = {
    id: 9_000,
    ref: SHA.A,
    sha: SHA.A,
    environment: "preview/ui/pr-519",
    payload: {
      ...canonicalDeploymentBinding(),
      idempotency_key: setup.current.nextDispatch.key,
      sha: SHA.A,
      logical_target: "ui",
      workflow_run_url:
        "https://github.com/mento-protocol/frontend-monorepo/actions/runs/8001/attempts/1",
    },
  };
  const fixture = fakeGitHub({
    pullRequest: setup.pullRequest,
    comments: [
      journalWithState(setup.events, setup.currentState, {
        selections: [
          selectionReceiptFromDispatch(
            setup.currentState.targets.ui.retired_active[0],
          ),
          selectionReceiptFromDispatch(setup.currentState.targets.ui.active),
        ],
      }),
    ],
    runs: [oldQueued, currentCompleted],
    deployments: [canonical],
    deploymentStatuses: new Map([
      [
        9_000,
        [
          {
            state: "success",
            environment_url: "https://ui-current-terminal.vercel.app",
            log_url:
              "https://github.com/mento-protocol/frontend-monorepo/actions/runs/8001/attempts/1",
          },
        ],
      ],
    ]),
  });

  const currentResult = await recoverWorkerResult({
    github: fixture.github,
    context: fakeContext({ workflowRun: currentCompleted }),
    core: fakeCore(),
  });
  assert.equal(currentResult.state, "success");
  const terminalState = await reconcilePreview({
    github: fixture.github,
    context: fakeContext({ runId: 7_001 }),
    core: fakeCore(),
    prNumber: 519,
    waitForRecovery: async () => {},
  });
  assert.equal(terminalState.targets.ui.active, null);
  assert.equal(
    terminalState.targets.ui.terminal_history.at(-1).key_digest,
    setup.current.nextDispatch.key_digest,
  );

  Object.assign(
    fixture.runs.find(({ id }) => id === 8_000),
    {
      status: "completed",
      conclusion: "cancelled",
    },
  );
  const controllerStateBefore = structuredClone(
    journalFromComment(fixture.comments[0]).state,
  );
  const oldResult = await recoverWorkerResult({
    github: fixture.github,
    context: fakeContext({ workflowRun: fixture.runs[0] }),
    core: fakeCore(),
  });
  assert.equal(oldResult.terminal_reason, "worker-cancelled");
  assert.equal(oldResult.github_deployment_id, null);
  assert.equal(oldResult.should_reconcile_current_epoch, false);
  assert.equal(fixture.createdDeploymentStatuses.length, 0);
  assert.equal(fixture.statuses.get("9000")[0].state, "success");
  const journal = journalFromComment(fixture.comments[0]);
  assert.deepEqual(journal.state, {
    ...controllerStateBefore,
    targets: {
      ...controllerStateBefore.targets,
      ui: { ...controllerStateBefore.targets.ui, retired_active: [] },
    },
  });
  assert.equal(journal.receipts.results.length, 2);
});

test("quarantined retired recovery cannot block native preview ownership", async () => {
  const setup = sameShaReopenState();
  const currentResult = result(setup.current.nextDispatch, { runId: 8_001 });
  const terminalState = reconcile({
    events: setup.events,
    results: [currentResult],
    pullRequest: setup.pullRequest,
    existingState: setup.currentState,
  }).state;
  assert.equal(terminalState.targets.ui.active, null);
  assert.equal(
    terminalState.targets.ui.terminal_history.at(-1).key_digest,
    setup.current.nextDispatch.key_digest,
  );
  const oldLatestAttempt = workerRun(setup.old.nextDispatch, {
    id: 8_000,
    attempt: 2,
    status: "completed",
    conclusion: "failure",
  });
  const fixture = fakeGitHub({
    pullRequest: setup.pullRequest,
    comments: [
      journalWithState(setup.events, terminalState, {
        results: [currentResult],
        selections: [
          selectionReceiptFromDispatch(
            setup.currentState.targets.ui.retired_active[0],
          ),
          selectionReceiptFromDispatch(setup.currentState.targets.ui.active),
        ],
      }),
    ],
    runs: [oldLatestAttempt],
    uiVercelConfiguration: NATIVE_OWNED_UI_VERCEL_CONFIGURATION,
  });

  const reconciled = await reconcilePreview({
    github: fixture.github,
    context: fakeContext({ runId: 7_001 }),
    core: fakeCore(),
    prNumber: 519,
    waitForRecovery: async () => {},
  });
  assert.equal(reconciled.targets.ui.active, null);
  assert.equal(
    reconciled.targets.ui.terminal_history.at(-1).key_digest,
    setup.current.nextDispatch.key_digest,
  );
  assert.equal(
    reconciled.targets.ui.retired_active.at(-1).recovery_quarantine,
    "persisted-attempt-invalid-or-unavailable",
  );
  assert.equal(
    fixture.commitStatuses.some(({ state }) => state === "error"),
    false,
  );
  assert.equal(fixture.commitStatuses.at(-1).state, "success");
  assert.equal(
    fixture.commitStatuses.at(-1).description,
    "app=none; governance=none; reserve=none; ui=native",
  );
  assert.deepEqual(fixture.workflowRunAttemptRequests, [
    { run_id: 8_000, attempt_number: 1 },
  ]);

  await reconcilePreview({
    github: fixture.github,
    context: fakeContext({ runId: 7_002 }),
    core: fakeCore(),
    prNumber: 519,
    waitForRecovery: async () => {},
  });
  assert.equal(fixture.workflowRunAttemptRequests.length, 1);
  assert.equal(
    fixture.commitStatuses.some(({ state }) => state === "error"),
    false,
  );
  assert.equal(fixture.commitStatuses.at(-1).state, "success");
  assert.equal(
    fixture.commitStatuses.at(-1).description,
    "app=none; governance=none; reserve=none; ui=native",
  );
});

test("transient retired recovery failures remain retryable and never poison the current epoch", async () => {
  const setup = sameShaReopenState();
  const currentResult = result(setup.current.nextDispatch, { runId: 8_001 });
  const terminalState = reconcile({
    events: setup.events,
    results: [currentResult],
    pullRequest: setup.pullRequest,
    existingState: setup.currentState,
  }).state;
  const oldCompleted = workerRun(setup.old.nextDispatch, {
    id: 8_000,
    status: "completed",
    conclusion: "failure",
  });
  const fixture = fakeGitHub({
    pullRequest: setup.pullRequest,
    comments: [
      journalWithState(setup.events, terminalState, {
        results: [currentResult],
        selections: [
          selectionReceiptFromDispatch(
            setup.currentState.targets.ui.retired_active[0],
          ),
          selectionReceiptFromDispatch(setup.currentState.targets.ui.active),
        ],
      }),
    ],
    runs: [oldCompleted],
    workflowRunAttemptFailures: [503],
  });

  const firstCore = fakeCore();
  const first = await reconcilePreview({
    github: fixture.github,
    context: fakeContext({ runId: 7_001 }),
    core: firstCore,
    prNumber: 519,
    waitForRecovery: async () => {},
  });
  assert.equal(first.targets.ui.active, null);
  assert.equal(
    first.targets.ui.retired_active.at(-1).recovery_quarantine,
    undefined,
  );
  assert.equal(firstCore.outputs.get("retired_recovery_retryable"), "true");
  assert.equal(
    fixture.commitStatuses.some(({ state }) => state === "error"),
    false,
  );

  const second = await reconcilePreview({
    github: fixture.github,
    context: fakeContext({ runId: 7_002 }),
    core: fakeCore(),
    prNumber: 519,
    waitForRecovery: async () => {},
  });
  assert.equal(second.targets.ui.active, null);
  assert.equal(
    second.targets.ui.terminal_history.at(-1).key_digest,
    setup.current.nextDispatch.key_digest,
  );
  assert.equal(
    fixture.commitStatuses.some(({ state }) => state === "error"),
    false,
  );
  assert.equal(fixture.workflowRunAttemptRequests.length, 3);
  assert.ok(
    journalFromComment(fixture.comments[0]).receipts.results.some(
      ({ worker_run_id: workerRunId }) => workerRunId === 8_000,
    ),
  );
});

test("transient quarantine persistence failure remains retryable without a current-head error", async () => {
  const setup = sameShaReopenState();
  const currentResult = result(setup.current.nextDispatch, { runId: 8_001 });
  const terminalState = reconcile({
    events: setup.events,
    results: [currentResult],
    pullRequest: setup.pullRequest,
    existingState: setup.currentState,
  }).state;
  const oldLatestAttempt = workerRun(setup.old.nextDispatch, {
    id: 8_000,
    attempt: 2,
    status: "completed",
    conclusion: "failure",
  });
  const fixture = fakeGitHub({
    pullRequest: setup.pullRequest,
    comments: [
      journalWithState(setup.events, terminalState, {
        results: [currentResult],
        selections: [
          selectionReceiptFromDispatch(
            setup.currentState.targets.ui.retired_active[0],
          ),
          selectionReceiptFromDispatch(setup.currentState.targets.ui.active),
        ],
      }),
    ],
    runs: [oldLatestAttempt],
    updateCommentFailures: [503],
  });

  const firstCore = fakeCore();
  const first = await reconcilePreview({
    github: fixture.github,
    context: fakeContext({ runId: 7_001 }),
    core: firstCore,
    prNumber: 519,
    waitForRecovery: async () => {},
  });
  assert.equal(
    first.targets.ui.retired_active.at(-1).recovery_quarantine,
    undefined,
  );
  assert.equal(firstCore.outputs.get("retired_recovery_retryable"), "true");
  assert.equal(
    fixture.commitStatuses.some(({ state }) => state === "error"),
    false,
  );

  const second = await reconcilePreview({
    github: fixture.github,
    context: fakeContext({ runId: 7_002 }),
    core: fakeCore(),
    prNumber: 519,
    waitForRecovery: async () => {},
  });
  assert.equal(
    second.targets.ui.retired_active.at(-1).recovery_quarantine,
    "persisted-attempt-invalid-or-unavailable",
  );
  assert.equal(
    fixture.commitStatuses.some(({ state }) => state === "error"),
    false,
  );
  assert.deepEqual(fixture.workflowRunAttemptRequests, [
    { run_id: 8_000, attempt_number: 1 },
    { run_id: 8_000, attempt_number: 1 },
  ]);
});

test("delayed old-epoch success reads only its own same-SHA Deployment status history", async () => {
  const setup = sameShaReopenState();
  const oldCompleted = workerRun(setup.old.nextDispatch, {
    id: 8_000,
    status: "completed",
    conclusion: "success",
  });
  const fixture = fakeGitHub({
    pullRequest: setup.pullRequest,
    comments: [
      journalWithState(setup.events, setup.currentState, {
        selections: [
          selectionReceiptFromDispatch(
            setup.currentState.targets.ui.retired_active[0],
          ),
          selectionReceiptFromDispatch(setup.currentState.targets.ui.active),
        ],
      }),
    ],
    runs: [oldCompleted, workerRun(setup.current.nextDispatch, { id: 8_001 })],
    deployments: [
      {
        id: 9_000,
        ref: SHA.A,
        sha: SHA.A,
        environment: "preview/ui/pr-519",
        payload: {
          ...canonicalDeploymentBinding(),
          idempotency_key: setup.old.nextDispatch.key,
          sha: SHA.A,
          logical_target: "ui",
          workflow_run_url:
            "https://github.com/mento-protocol/frontend-monorepo/actions/runs/8000/attempts/1",
        },
      },
    ],
    deploymentStatuses: new Map([
      [
        9_000,
        [
          {
            state: "failure",
            environment_url: null,
            log_url:
              "https://github.com/mento-protocol/frontend-monorepo/actions/runs/8001/attempts/1",
          },
          {
            state: "success",
            environment_url: "https://ui-old-success.vercel.app",
            log_url:
              "https://github.com/mento-protocol/frontend-monorepo/actions/runs/8000/attempts/1",
          },
        ],
      ],
    ]),
  });
  const outcome = await recoverWorkerResult({
    github: fixture.github,
    context: fakeContext({ workflowRun: oldCompleted }),
    core: fakeCore(),
  });
  assert.equal(outcome.state, "success");
  assert.equal(
    outcome.vercel_deployment_url,
    "https://ui-old-success.vercel.app",
  );
  assert.equal(outcome.should_reconcile_current_epoch, false);
  assert.equal(fixture.createdDeploymentStatuses.length, 0);
  assert.equal(fixture.statuses.get("9000")[0].state, "failure");
});

test("duplicate worker absorbs an existing verified canonical Deployment without Vercel work", async () => {
  const opened = event({
    run: 124,
    action: "opened",
    head: SHA.A,
    updated: timestamp(1),
  });
  const pullRequest = pull({ head: SHA.A, updated: timestamp(1) });
  const selected = reconcile({ events: [opened], pullRequest });
  const dispatched = persistDispatch(selected, 8_000);
  const canonical = {
    id: 9_000,
    ref: SHA.A,
    sha: SHA.A,
    environment: "preview/ui/pr-519",
    payload: {
      ...canonicalDeploymentBinding(),
      idempotency_key: selected.nextDispatch.key,
      sha: SHA.A,
      logical_target: "ui",
    },
  };
  const fixture = fakeGitHub({
    pullRequest,
    comments: [journalWithState([opened], dispatched)],
    runs: [workerRun(selected.nextDispatch)],
    deployments: [canonical],
    deploymentStatuses: new Map([
      [
        9_000,
        [
          {
            state: "success",
            environment_url: "https://ui-verified.vercel.app",
          },
        ],
      ],
    ]),
  });
  const core = fakeCore();
  const outcome = await validateWorkerDispatch({
    github: fixture.github,
    context: fakeContext({ runId: 8_000 }),
    core,
    inputs: {
      pull_request_number: "519",
      target: "ui",
      commit_sha: SHA.A,
      git_branch: selected.nextDispatch.git_ref,
      controller_key: selected.nextDispatch.key,
      controller_key_digest: selected.nextDispatch.key_digest,
      expected_workflow_sha: selected.nextDispatch.expected_workflow_sha,
      epoch_anchor_run_id: String(selected.nextDispatch.epoch_anchor_run_id),
      reconciliation_basis_digest:
        selected.nextDispatch.reconciliation_basis_digest,
      selection_receipt_run_id: String(
        selected.nextDispatch.selection_receipt_run_id,
      ),
    },
  });
  assert.deepEqual(outcome, {
    shouldDeploy: false,
    duplicate: false,
    reused: true,
  });
  assert.equal(core.outputs.get("should_deploy"), "false");
  assert.equal(core.outputs.get("reused_deployment_id"), "9000");
});

test("verified deployment success survives a later evidence persistence failure", async () => {
  const opened = event({
    run: 124,
    action: "opened",
    head: SHA.A,
    updated: timestamp(1),
  });
  const pullRequest = pull({ head: SHA.A, updated: timestamp(1) });
  const selected = reconcile({ events: [opened], pullRequest });
  const dispatched = persistDispatch(selected, 8_000);
  const completed = workerRun(selected.nextDispatch, {
    status: "completed",
    conclusion: "failure",
  });
  const canonical = {
    id: 9_000,
    ref: SHA.A,
    sha: SHA.A,
    environment: "preview/ui/pr-519",
    payload: {
      ...canonicalDeploymentBinding(),
      idempotency_key: selected.nextDispatch.key,
      sha: SHA.A,
      logical_target: "ui",
    },
  };
  const fixture = fakeGitHub({
    pullRequest,
    comments: [journalWithState([opened], dispatched)],
    runs: [completed],
    deployments: [canonical],
    deploymentStatuses: new Map([
      [
        9_000,
        [
          {
            state: "success",
            environment_url: "https://ui-verified-before-evidence.vercel.app",
            log_url:
              "https://github.com/mento-protocol/frontend-monorepo/actions/runs/8000/attempts/1",
          },
        ],
      ],
    ]),
  });

  const outcome = await recoverWorkerResult({
    github: fixture.github,
    context: fakeContext({ workflowRun: completed }),
    core: fakeCore(),
  });

  assert.equal(outcome.state, "success");
  assert.equal(outcome.terminal_reason, "verified");
  assert.equal(outcome.smoke_result, "passed");
  assert.equal(
    outcome.vercel_deployment_url,
    "https://ui-verified-before-evidence.vercel.app",
  );
  assert.equal(fixture.createdDeploymentStatuses.length, 0);
  assert.equal(fixture.statuses.get("9000")[0].state, "success");
  const journalAfterResult = journalFromComment(fixture.comments[0]);
  assert.equal(journalAfterResult.revision, 2);
  const {
    should_reconcile_current_epoch: shouldReconcileCurrentEpoch,
    ...persistedOutcome
  } = outcome;
  assert.equal(shouldReconcileCurrentEpoch, true);
  assert.deepEqual(journalAfterResult.receipts.results, [persistedOutcome]);
  const updatesAfterResult = fixture.commentUpdates.length;

  const repeated = await recoverWorkerResult({
    github: fixture.github,
    context: fakeContext({ workflowRun: completed }),
    core: fakeCore(),
  });
  assert.equal(repeated.state, "success");
  assert.equal(
    repeated.vercel_deployment_url,
    "https://ui-verified-before-evidence.vercel.app",
  );
  assert.equal(fixture.createdDeploymentStatuses.length, 0);
  assert.equal(fixture.commentUpdates.length, updatesAfterResult);
  assert.deepEqual(journalFromComment(fixture.comments[0]), journalAfterResult);
});

test("a rerun attempt cannot reuse persisted first-attempt worker ownership", async () => {
  const opened = event({
    run: 124,
    action: "opened",
    head: SHA.A,
    updated: timestamp(1),
  });
  const pullRequest = pull({ head: SHA.A, updated: timestamp(1) });
  const selected = reconcile({ events: [opened], pullRequest });
  const dispatched = persistDispatch(selected, 8_000);
  const fixture = fakeGitHub({
    pullRequest,
    comments: [journalWithState([opened], dispatched)],
    runs: [workerRun(selected.nextDispatch)],
  });
  await assert.rejects(
    validateWorkerDispatch({
      github: fixture.github,
      context: fakeContext({ runId: 8_000, runAttempt: 2 }),
      core: fakeCore(),
      inputs: workerInputs(selected.nextDispatch),
    }),
    /rerun attempt does not own/,
  );
  assert.equal(fixture.deployments.length, 0);
});

test("smoke failure records immutable upload evidence and the one retry resumes smoke without upload", async () => {
  const opened = event({
    run: 125,
    action: "opened",
    head: SHA.A,
    updated: timestamp(1),
  });
  const pullRequest = pull({ head: SHA.A, updated: timestamp(1) });
  const selected = reconcile({ events: [opened], pullRequest });
  const dispatched = persistDispatch(selected, 8_000);
  const canonical = {
    id: 9_000,
    ref: SHA.A,
    sha: SHA.A,
    environment: "preview/ui/pr-519",
    payload: {
      ...canonicalDeploymentBinding(),
      idempotency_key: selected.nextDispatch.key,
      sha: SHA.A,
      logical_target: "ui",
    },
  };
  const fixture = fakeGitHub({
    pullRequest,
    comments: [journalWithState([opened], dispatched)],
    runs: [
      workerRun(selected.nextDispatch, {
        status: "completed",
        conclusion: "failure",
      }),
    ],
    deployments: [canonical],
    deploymentStatuses: new Map([
      [9_000, [{ state: "failure", environment_url: null }]],
    ]),
  });
  const stableCommentId = fixture.comments[0].id;
  const evidenceInputs = {
    pull_request_number: "519",
    target: "ui",
    commit_sha: SHA.A,
    controller_key: selected.nextDispatch.key,
    controller_key_digest: selected.nextDispatch.key_digest,
    expected_workflow_sha: selected.nextDispatch.expected_workflow_sha,
    epoch_anchor_run_id: String(selected.nextDispatch.epoch_anchor_run_id),
    reconciliation_basis_digest:
      selected.nextDispatch.reconciliation_basis_digest,
    selection_receipt_run_id: String(
      selected.nextDispatch.selection_receipt_run_id,
    ),
    execution_mode: "build",
    build_duration_ms: "1234",
    verified_upload_url: "https://ui-smoke-retry.vercel.app",
    vercel_deployment_id: "dpl_SmokeRetry",
    next_deployment_id: "m-ui-smoke-retry",
  };
  const workerEvidence = await recordWorkerEvidence({
    github: fixture.github,
    context: fakeContext({ runId: 8_000 }),
    core: fakeCore(),
    inputs: evidenceInputs,
  });
  assert.equal(workerEvidence.execution_mode, "build");
  assert.equal(workerEvidence.build_completed, true);
  const journalAfterEvidence = journalFromComment(fixture.comments[0]);
  assert.equal(fixture.comments.length, 1);
  assert.equal(fixture.comments[0].id, stableCommentId);
  assert.equal(journalAfterEvidence.revision, 2);
  assert.deepEqual(journalAfterEvidence.receipts.worker_evidence, [
    workerEvidence,
  ]);
  assert.deepEqual(journalAfterEvidence.receipts.results, []);
  const updatesAfterEvidence = fixture.commentUpdates.length;
  assert.deepEqual(
    await recordWorkerEvidence({
      github: fixture.github,
      context: fakeContext({ runId: 8_000 }),
      core: fakeCore(),
      inputs: evidenceInputs,
    }),
    workerEvidence,
  );
  assert.equal(fixture.commentUpdates.length, updatesAfterEvidence);
  assert.deepEqual(
    journalFromComment(fixture.comments[0]),
    journalAfterEvidence,
  );
  const completed = fixture.runs[0];
  const outcome = await recoverWorkerResult({
    github: fixture.github,
    context: fakeContext({ workflowRun: completed }),
    core: fakeCore(),
  });
  assert.equal(outcome.state, "failure");
  assert.equal(outcome.terminal_reason, "smoke-failed-retriable");
  assert.equal(
    outcome.vercel_deployment_url,
    "https://ui-smoke-retry.vercel.app",
  );
  const journalAfterOutcome = journalFromComment(fixture.comments[0]);
  assert.equal(fixture.comments.length, 1);
  assert.equal(fixture.comments[0].id, stableCommentId);
  assert.equal(journalAfterOutcome.revision, 3);
  assert.deepEqual(journalAfterOutcome.receipts.worker_evidence, [
    workerEvidence,
  ]);
  const {
    should_reconcile_current_epoch: shouldReconcileCurrentEpoch,
    ...persistedOutcome
  } = outcome;
  assert.equal(shouldReconcileCurrentEpoch, true);
  assert.deepEqual(journalAfterOutcome.receipts.results, [persistedOutcome]);

  const retry = reconcile({
    events: [opened],
    results: [outcome],
    pullRequest,
    existingState: dispatched,
  });
  assert.equal(retry.nextDispatch.sha, SHA.A);
  assert.notEqual(
    retry.nextDispatch.key_digest,
    selected.nextDispatch.key_digest,
  );
  const retryState = persistDispatch(retry, 8_001);
  const firstJournal = journalFromComment(fixture.comments[0]);
  const resumeFixture = fakeGitHub({
    pullRequest,
    comments: [
      journalWithState([opened], retryState, {
        selections: [
          selectionReceiptFromDispatch(dispatched.targets.ui.active),
          selectionReceiptFromDispatch(retryState.targets.ui.active),
        ],
        workerEvidence: firstJournal.receipts.worker_evidence,
        results: firstJournal.receipts.results,
      }),
    ],
    runs: [workerRun(retry.nextDispatch, { id: 8_001 })],
    deployments: [canonical],
    deploymentStatuses: new Map([
      [9_000, [{ state: "failure", environment_url: null }]],
    ]),
  });
  const core = fakeCore();
  const decision = await validateWorkerDispatch({
    github: resumeFixture.github,
    context: fakeContext({ runId: 8_001 }),
    core,
    inputs: {
      pull_request_number: "519",
      target: "ui",
      commit_sha: SHA.A,
      git_branch: retry.nextDispatch.git_ref,
      controller_key: retry.nextDispatch.key,
      controller_key_digest: retry.nextDispatch.key_digest,
      expected_workflow_sha: retry.nextDispatch.expected_workflow_sha,
      epoch_anchor_run_id: String(retry.nextDispatch.epoch_anchor_run_id),
      reconciliation_basis_digest:
        retry.nextDispatch.reconciliation_basis_digest,
      selection_receipt_run_id: String(
        retry.nextDispatch.selection_receipt_run_id,
      ),
    },
  });
  assert.deepEqual(decision, {
    shouldDeploy: false,
    duplicate: false,
    resumeSmoke: true,
  });
  assert.equal(core.outputs.get("should_resume_smoke"), "true");
  assert.equal(
    core.outputs.get("vercel_deployment_url"),
    "https://ui-smoke-retry.vercel.app",
  );
});

test("failure after the durable upload boundary fails closed without a rebuild retry", async () => {
  const opened = event({
    run: 126,
    action: "opened",
    head: SHA.A,
    updated: timestamp(1),
  });
  const pullRequest = pull({ head: SHA.A, updated: timestamp(1) });
  const selected = reconcile({ events: [opened], pullRequest });
  const dispatched = persistDispatch(selected, 8_000);
  const canonical = {
    id: 9_000,
    ref: SHA.A,
    sha: SHA.A,
    environment: "preview/ui/pr-519",
    payload: {
      ...canonicalDeploymentBinding(),
      idempotency_key: selected.nextDispatch.key,
      sha: SHA.A,
      logical_target: "ui",
    },
  };
  const completed = workerRun(selected.nextDispatch, {
    status: "completed",
    conclusion: "failure",
  });
  const fixture = fakeGitHub({
    pullRequest,
    comments: [journalWithState([opened], dispatched)],
    runs: [completed],
    deployments: [canonical],
    deploymentStatuses: new Map([
      [
        9_000,
        [
          {
            state: "in_progress",
            description: "Prebuilt preview upload starting",
            environment_url: null,
          },
        ],
      ],
    ]),
  });
  await recordWorkerEvidence({
    github: fixture.github,
    context: fakeContext({ runId: 8_000 }),
    core: fakeCore(),
    inputs: {
      pull_request_number: "519",
      target: "ui",
      commit_sha: SHA.A,
      controller_key: selected.nextDispatch.key,
      controller_key_digest: selected.nextDispatch.key_digest,
      expected_workflow_sha: selected.nextDispatch.expected_workflow_sha,
      epoch_anchor_run_id: String(selected.nextDispatch.epoch_anchor_run_id),
      reconciliation_basis_digest:
        selected.nextDispatch.reconciliation_basis_digest,
      selection_receipt_run_id: String(
        selected.nextDispatch.selection_receipt_run_id,
      ),
      execution_mode: "build",
      build_duration_ms: "",
      verified_upload_url: "",
      vercel_deployment_id: "",
      next_deployment_id: "",
    },
  });
  const outcome = await recoverWorkerResult({
    github: fixture.github,
    context: fakeContext({ workflowRun: completed }),
    core: fakeCore(),
  });
  assert.equal(outcome.state, "error");
  assert.equal(outcome.terminal_reason, "upload-ambiguous");
  const reconciled = reconcile({
    events: [opened],
    results: [outcome],
    pullRequest,
    existingState: dispatched,
  });
  assert.equal(reconciled.nextDispatch, null);
  assert.equal(reconciled.state.status_decisions.at(-1).state, "error");
});

test("completed build failure before the upload boundary gets one rebuild retry", async () => {
  const opened = event({
    run: 126,
    action: "opened",
    head: SHA.A,
    updated: timestamp(1),
  });
  const pullRequest = pull({ head: SHA.A, updated: timestamp(1) });
  const selected = reconcile({ events: [opened], pullRequest });
  const dispatched = persistDispatch(selected, 8_000);
  const completed = workerRun(selected.nextDispatch, {
    status: "completed",
    conclusion: "failure",
  });
  const canonical = {
    id: 9_000,
    ref: SHA.A,
    sha: SHA.A,
    environment: "preview/ui/pr-519",
    payload: {
      ...canonicalDeploymentBinding(),
      idempotency_key: selected.nextDispatch.key,
      sha: SHA.A,
      logical_target: "ui",
    },
  };
  const fixture = fakeGitHub({
    pullRequest,
    comments: [journalWithState([opened], dispatched)],
    runs: [completed],
    deployments: [canonical],
    deploymentStatuses: new Map([
      [9_000, [{ state: "failure", environment_url: null }]],
    ]),
  });
  const workerEvidence = await recordWorkerEvidence({
    github: fixture.github,
    context: fakeContext({ runId: 8_000 }),
    core: fakeCore(),
    inputs: {
      ...workerInputs(selected.nextDispatch),
      execution_mode: "build",
      build_duration_ms: "1234",
      verified_upload_url: "",
      vercel_deployment_id: "",
      next_deployment_id: "m-ui-pre-upload-failure",
    },
  });
  assert.equal(workerEvidence.build_completed, true);
  assert.equal(workerEvidence.verified_upload_url, null);
  assert.equal(workerEvidence.vercel_deployment_id, null);

  const outcome = await recoverWorkerResult({
    github: fixture.github,
    context: fakeContext({ workflowRun: completed }),
    core: fakeCore(),
  });
  assert.equal(outcome.state, "failure");
  assert.equal(outcome.terminal_reason, "build-failed-retriable");

  const retry = reconcile({
    events: [opened],
    results: [outcome],
    pullRequest,
    existingState: dispatched,
  });
  assert.equal(retry.nextDispatch.sha, SHA.A);
  const retryState = persistDispatch(retry, 8_001);
  const firstJournal = journalFromComment(fixture.comments[0]);
  const retryFixture = fakeGitHub({
    pullRequest,
    comments: [
      journalWithState([opened], retryState, {
        selections: [
          selectionReceiptFromDispatch(dispatched.targets.ui.active),
          selectionReceiptFromDispatch(retryState.targets.ui.active),
        ],
        workerEvidence: firstJournal.receipts.worker_evidence,
        results: firstJournal.receipts.results,
      }),
    ],
    runs: [workerRun(retry.nextDispatch, { id: 8_001 })],
    deployments: [canonical],
    deploymentStatuses: new Map([
      [9_000, [{ state: "failure", environment_url: null }]],
    ]),
  });
  const core = fakeCore();
  const decision = await validateWorkerDispatch({
    github: retryFixture.github,
    context: fakeContext({ runId: 8_001 }),
    core,
    inputs: workerInputs(retry.nextDispatch),
  });
  assert.deepEqual(decision, {
    shouldDeploy: true,
    duplicate: false,
    retryBuild: true,
  });
  assert.equal(core.outputs.get("execution_mode"), "build-retry");
});

test("build failure gets at most one serialized rebuild retry", () => {
  const opened = event({
    run: 126,
    action: "opened",
    head: SHA.A,
    updated: timestamp(1),
  });
  const pullRequest = pull({ head: SHA.A, updated: timestamp(1) });
  const first = reconcile({ events: [opened], pullRequest });
  const firstState = persistDispatch(first, 8_000);
  const firstFailure = result(first.nextDispatch, {
    runId: 8_000,
    state: "failure",
    reason: "build-failed-retriable",
  });
  const retry = reconcile({
    events: [opened],
    results: [firstFailure],
    pullRequest,
    existingState: firstState,
  });
  assert.equal(retry.nextDispatch.sha, SHA.A);
  const retryState = persistDispatch(retry, 8_001);
  const retryFailure = result(retry.nextDispatch, {
    runId: 8_001,
    state: "failure",
    reason: "build-failed-retriable",
  });
  const terminal = reconcile({
    events: [opened],
    results: [firstFailure, retryFailure],
    pullRequest,
    existingState: retryState,
  });
  assert.equal(terminal.nextDispatch, null);
  assert.equal(terminal.state.status_decisions[0].state, "failure");
});
