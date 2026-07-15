import assert from "node:assert/strict";
import { test } from "node:test";

import {
  BOOTSTRAP_DISPATCH_EVENT,
  CONTROLLER_SCHEMA,
  EVENT_RECEIPT_SCHEMA,
  PREVIEW_REPOSITORY,
  RECONCILE_DISPATCH_EVENT,
  RESULT_RECEIPT_SCHEMA,
  controllerKey,
  eventReceiptMarker,
  normalizePlannerResult,
  parseWorkerRunName,
  postWorkerRecoveryError,
  prepareBootstrap,
  recordEventReceipt,
  recordWorkerEvidence,
  reconcilePreview,
  reconcileState,
  recoverWorkerResult,
  resultReceiptMarker,
  snapshotPullRequestEvent,
  validateEventReceipt,
  validateRepositoryDispatch,
  validateWorkerDispatch,
  validateWorkerRunIdentity,
  validateWorkerResult,
  workerRunName,
  writeEventSnapshotOutputs,
  writeRepositoryDispatchOutputs,
} from "./vercel-preview-controller.mjs";

const CONTROLLER_URL =
  "https://github.com/mento-protocol/frontend-monorepo/actions/runs/999";
const SHA = Object.fromEntries(
  ["A", "B", "C", "D", "E"].map((name, index) => [
    name,
    (index + 1).toString(16).repeat(40),
  ]),
);

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
  const rawPlan = runtime
    ? {
        deployments: ["ui"],
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

function persistDispatch(reconciled, runId = 8_000) {
  assert.ok(reconciled.nextDispatch, "fixture must have a dispatch");
  return {
    ...structuredClone(reconciled.state),
    ui: {
      ...structuredClone(reconciled.state.ui),
      active: {
        ...structuredClone(reconciled.nextDispatch),
        dispatch_state: "dispatched",
        workflow_run_id: runId,
        workflow_sha: SHA.E,
        workflow_run_attempt: 1,
        run_url: `https://api.github.com/repos/mento-protocol/frontend-monorepo/actions/runs/${runId}`,
        html_url: `https://github.com/mento-protocol/frontend-monorepo/actions/runs/${runId}`,
      },
    },
  };
}

function persistIntent(reconciled) {
  assert.ok(reconciled.nextDispatch, "fixture must have a dispatch");
  return {
    ...structuredClone(reconciled.state),
    ui: {
      ...structuredClone(reconciled.state.ui),
      active: {
        ...structuredClone(reconciled.nextDispatch),
        dispatch_state: "intended",
        workflow_run_id: null,
        workflow_sha: null,
        workflow_run_attempt: null,
        run_url: null,
        html_url: null,
      },
    },
  };
}

function result(
  dispatch,
  {
    runId = 8_000,
    state = "success",
    reason = state === "success" ? "verified" : "worker-failure",
  } = {},
) {
  return validateWorkerResult({
    schema: RESULT_RECEIPT_SCHEMA,
    repository: PREVIEW_REPOSITORY,
    pr: dispatch.pr,
    target: "ui",
    sha: dispatch.sha,
    controller_key: dispatch.key,
    key_digest: dispatch.key_digest,
    epoch_anchor_run_id: dispatch.epoch_anchor_run_id,
    reconciliation_basis_digest: dispatch.reconciliation_basis_digest,
    selection_receipt_run_id: dispatch.selection_receipt_run_id,
    worker_run_id: runId,
    worker_run_attempt: 1,
    github_deployment_id: 9_000 + runId,
    state,
    vercel_deployment_id: state === "success" ? `dpl_${runId}` : null,
    next_deployment_id: state === "success" ? `m-ui-${runId}` : null,
    vercel_deployment_url:
      state === "success" ? `https://ui-${runId}.vercel.app` : null,
    smoke_result: state === "success" ? "passed" : "failed",
    terminal_reason: reason,
  });
}

function reconcile({
  events,
  results = [],
  pullRequest,
  existingState = null,
  observations = {},
}) {
  return reconcileState({
    events,
    results,
    pullRequest,
    existingState,
    observations,
    controllerUrl: CONTROLLER_URL,
  });
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
  assert.equal(ordered.state.ui.latest_desired_sha, SHA.B);
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
  assert.equal(first.state.ui.latest_desired_sha, SHA.C);
  const activeState = persistDispatch(first);
  const whileActive = reconcile({
    events,
    pullRequest: pull({ head: SHA.C, updated: timestamp(3) }),
    existingState: activeState,
  });
  assert.equal(whileActive.nextDispatch, null);
  assert.equal(whileActive.state.ui.active.sha, SHA.A);
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
  assert.equal(idle.state.ui.idle_cursor_receipt_run_id, 30);

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
  assert.equal(burst.state.ui.latest_desired_sha, SHA.C);
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
  assert.match(
    noRuntime.state.status_decisions[0].description,
    /No UI runtime/,
  );

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
  assert.match(docsStatus.description, /Runtime-equivalent/);

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
  assert.match(failedDocsStatus.description, /Runtime preview .* failed/);

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
  assert.match(cancelledDocsStatus.description, /was cancelled/);
});

test("coalescing needs durable later selection and zero worker/deployment proof", () => {
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
  const intendedC = persistDispatch(afterA, 8_052);
  const withoutProof = reconcile({
    events,
    results: [result(first.nextDispatch, { runId: 8_050 })],
    pullRequest: pull({ head: SHA.C, updated: timestamp(3) }),
    existingState: intendedC,
  });
  assert.equal(withoutProof.state.status_decisions[1].state, "pending");
  const withProof = reconcile({
    events,
    results: [result(first.nextDispatch, { runId: 8_050 })],
    pullRequest: pull({ head: SHA.C, updated: timestamp(3) }),
    existingState: intendedC,
    observations: {
      [controllerKey(519, SHA.B)]: { worker_runs: 0, deployments: 0 },
    },
  });
  assert.equal(withProof.state.status_decisions[1].state, "success");
  assert.match(withProof.state.status_decisions[1].description, /Coalesced/);
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
  assert.equal(state.state.ui.latest_desired_receipt_run_id, 72);
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
  assert.equal(current.state.ui.active.selection_receipt_run_id, 81);
  assert.equal(current.state.ui.active.key_digest, active.ui.active.key_digest);
  assert.equal(current.state.ui.active.workflow_run_id, 8_000);
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
  conflicting.ui.latest_desired_receipt_run_id = 80;
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
  }).state;
  assert.equal(state.schema, CONTROLLER_SCHEMA);
  assert.match(state.receipts_digest, /^[0-9a-f]{64}$/);
  assert.match(state.epoch.basis_digest, /^[0-9a-f]{64}$/);
  assert.ok(JSON.stringify(state).length < 20_000);
});

function commentBody(marker, value) {
  return `${marker}\n\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\`\n`;
}

function eventComment(value, id = 1) {
  return {
    id,
    user: { type: "Bot", login: "github-actions[bot]" },
    body: commentBody(eventReceiptMarker(value.event_run_id), value),
  };
}

function stateComment(value, id = 2) {
  return {
    id,
    user: { type: "Bot", login: "github-actions[bot]" },
    body: commentBody("<!-- vercel-preview-controller:v1 -->", value),
  };
}

function resultComment(value, id = 3) {
  return {
    id,
    user: { type: "Bot", login: "github-actions[bot]" },
    body: commentBody(resultReceiptMarker(value), value),
  };
}

function workerRun(
  selection,
  { id = 8_000, attempt = 1, status = "queued", conclusion = null } = {},
) {
  return {
    id,
    name: "Vercel Preview Worker",
    path: ".github/workflows/vercel-preview-worker.yml",
    event: "workflow_dispatch",
    head_branch: "main",
    head_sha: SHA.E,
    run_attempt: attempt,
    display_title: workerRunName({
      pr: selection.pr,
      sha: selection.sha,
      keyDigest: selection.key_digest,
    }),
    url: `https://api.github.com/repos/mento-protocol/frontend-monorepo/actions/runs/${id}`,
    html_url: `https://github.com/mento-protocol/frontend-monorepo/actions/runs/${id}`,
    status,
    conclusion,
  };
}

function workerInputs(selection) {
  return {
    pull_request_number: String(selection.pr),
    target: "ui",
    commit_sha: selection.sha,
    git_branch: selection.git_ref,
    controller_key: selection.key,
    controller_key_digest: selection.key_digest,
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

function fakeGitHub({
  pullRequest,
  comments: initialComments,
  runs: initialRuns = [],
  workerRunTotalCount,
  workflowRunAttemptFailures = [],
  updateCommentFailures = [],
  pullCommits = [pullRequest.head.sha],
  deployments: initialDeployments = [],
  deploymentStatuses = new Map(),
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
  const dispatches = [];
  const createdDeploymentStatuses = [];
  const workflowRunAttemptRequests = [];
  const attemptFailures = [...workflowRunAttemptFailures];
  const commentUpdateFailures = [...updateCommentFailures];
  let nextCommentId = 100;
  let nextDeploymentId = 9_000;
  const listComments = async () => {};
  const listCommits = async () => {};
  const listDeployments = async () => {};
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
          const failureStatus = commentUpdateFailures.shift();
          if (failureStatus) {
            const error = new Error("fixture comment update failed");
            error.status = failureStatus;
            throw error;
          }
          const comment = comments.find(({ id }) => id === comment_id);
          assert.ok(comment, "fixture update must target an existing comment");
          comment.body = body;
          return { data: comment };
        },
      },
      pulls: {
        get: async () => ({ data: structuredClone(pullRequest) }),
        listCommits,
      },
      actions: {
        listWorkflowRuns: async ({ page = 1, per_page = 100 }) => ({
          data: {
            total_count: workerRunTotalCount ?? runs.length,
            workflow_runs: structuredClone(
              runs.slice((page - 1) * per_page, page * per_page),
            ),
          },
        }),
        getWorkflowRun: async ({ run_id }) => {
          const data = runs.find(({ id }) => id === run_id);
          assert.ok(data, `fixture run ${run_id} must exist`);
          return { data: structuredClone(data) };
        },
      },
      repos: {
        listDeployments,
        createCommitStatus: async (request) => {
          commitStatuses.push(structuredClone(request));
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
    paginate: async (method) => {
      if (method === listComments) return structuredClone(comments);
      if (method === listCommits) {
        return pullCommits.map((sha) => ({ sha }));
      }
      if (method === listDeployments) return structuredClone(deployments);
      throw new Error("Unexpected fixture pagination method");
    },
    request: async (route, request) => {
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
        sha: request.inputs.commit_sha,
        key_digest: request.inputs.controller_key_digest,
      };
      const run = workerRun(selection, { id });
      runs.push(run);
      dispatches.push(structuredClone(request));
      return { status: 200, data: { workflow_run_id: id } };
    },
  };
  return {
    github,
    comments,
    runs,
    deployments,
    statuses,
    commitStatuses,
    dispatches,
    createdDeploymentStatuses,
    workflowRunAttemptRequests,
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
  assert.deepEqual(receipt.plan.targets, ["ui"]);
  assert.equal(receipt.plan.reason, "planner-job-failed");
  assert.equal(receipt.plan.base, SHA.E);
  assert.equal(receipt.plan.head, SHA.A);
  assert.equal(core.outputs.get("planner_output_invalid"), "true");
  assert.match(fixture.comments[0].body, /"reason": "planner-job-failed"/);
  assert.equal(fixture.commitStatuses.at(-1).state, "pending");
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
  for (const override of [
    { display_title: "Vercel Preview Worker" },
    { path: ".github/workflows/other.yml" },
    { event: "push" },
    { head_branch: "feature" },
    { run_attempt: 0 },
  ]) {
    assert.throws(() =>
      validateWorkerRunIdentity({ ...run, ...override }, selection),
    );
  }
});

test("durable dispatch persists intent, requires HTTP 200 run details, and re-queries the exact run", async () => {
  const opened = event({
    run: 121,
    action: "opened",
    head: SHA.A,
    updated: timestamp(1),
  });
  const pullRequest = pull({ head: SHA.A, updated: timestamp(1) });
  const fixture = fakeGitHub({
    pullRequest,
    comments: [eventComment(opened)],
  });
  const core = fakeCore();
  const state = await reconcilePreview({
    github: fixture.github,
    context: fakeContext(),
    core,
    prNumber: 519,
    waitForRecovery: async () => {},
  });
  assert.equal(fixture.dispatches.length, 1);
  assert.equal(state.ui.active.dispatch_state, "dispatched");
  assert.equal(state.ui.active.workflow_run_id, 8_000);
  assert.equal(state.ui.active.workflow_sha, SHA.E);
  assert.equal(core.outputs.get("dispatched_run_id"), "8000");
  assert.equal(fixture.commitStatuses.at(-1).context, "Vercel Preview");
  assert.equal(fixture.commitStatuses.at(-1).sha, SHA.A);
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
  const intended = {
    ...structuredClone(selected.state),
    ui: {
      ...structuredClone(selected.state.ui),
      active: {
        ...structuredClone(selected.nextDispatch),
        dispatch_state: "intended",
        workflow_run_id: null,
        workflow_sha: null,
        workflow_run_attempt: null,
        run_url: null,
        html_url: null,
      },
    },
  };
  const existingRun = workerRun(selected.nextDispatch);
  const recovered = fakeGitHub({
    pullRequest,
    comments: [eventComment(opened), stateComment(intended)],
    runs: [existingRun],
  });
  const state = await reconcilePreview({
    github: recovered.github,
    context: fakeContext(),
    core: fakeCore(),
    prNumber: 519,
    waitForRecovery: async () => {},
  });
  assert.equal(recovered.dispatches.length, 0);
  assert.equal(state.ui.active.workflow_run_id, existingRun.id);

  const ambiguous = fakeGitHub({
    pullRequest,
    comments: [eventComment(opened), stateComment(intended)],
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

test("intended dispatch recovery paginates recent worker runs and fails closed beyond its proof bound", async () => {
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
    comments: [eventComment(opened), stateComment(intended)],
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
  assert.equal(state.ui.active.workflow_run_id, 8_000);

  const bounded = fakeGitHub({
    pullRequest,
    comments: [eventComment(opened), stateComment(intended)],
    runs: Array.from({ length: 300 }, (_, index) =>
      workerRun(
        { ...selected.nextDispatch, sha: SHA.B },
        { id: 10_000 + index },
      ),
    ),
    workerRunTotalCount: 301,
  });
  await assert.rejects(
    reconcilePreview({
      github: bounded.github,
      context: fakeContext(),
      core: fakeCore(),
      prNumber: 519,
      waitForRecovery: async () => {},
    }),
    /bounded 300-run history/,
  );
  assert.equal(bounded.dispatches.length, 0);
  assert.equal(bounded.commitStatuses.at(-1).state, "error");
});

test("manual reconcile recovers a completed dispatched worker when its callback was missed", async () => {
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
  const fixture = fakeGitHub({
    pullRequest,
    comments: [eventComment(opened), stateComment(dispatched)],
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
  assert.equal(state.ui.active, null);
  assert.equal(
    state.ui.terminal_history.at(-1).terminal_reason,
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
      eventComment(opened, 1),
      eventComment(runtimeB, 2),
      eventComment(runtimeC, 3),
      stateComment(persistIntent(initial), 4),
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
  assert.equal(state.ui.active.sha, SHA.C);
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
    comments: [eventComment(opened), stateComment(dispatched)],
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
  assert.ok(
    fixture.comments.some(({ body }) =>
      body.startsWith("<!-- vercel-preview-worker-result:v1:"),
    ),
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
    comments: [eventComment(opened), stateComment(intended)],
    runs: [completed],
  });
  const core = fakeCore();
  const outcome = await recoverWorkerResult({
    github: fixture.github,
    context: fakeContext({ workflowRun: completed }),
    core,
  });
  assert.equal(outcome.terminal_reason, "worker-cancelled");
  assert.equal(core.outputs.get("recovered_intended_run_id"), "8000");
  const controllerState = fixture.comments.find(({ body }) =>
    body.startsWith("<!-- vercel-preview-controller:v1 -->"),
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
      comments: [eventComment(opened), stateComment(intended)],
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
      fixture.comments.filter(({ body }) =>
        body.startsWith("<!-- vercel-preview-worker-result:v1:"),
      ).length,
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
    comments: [eventComment(opened), stateComment(dispatched)],
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
      ...setup.events.map((item, index) => eventComment(item, index + 1)),
      stateComment(setup.currentState, 10),
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
  const controllerBodyBefore = fixture.comments.find(({ body }) =>
    body.startsWith("<!-- vercel-preview-controller:v1 -->"),
  ).body;
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
  assert.equal(
    fixture.comments.find(({ body }) =>
      body.startsWith("<!-- vercel-preview-controller:v1 -->"),
    ).body,
    controllerBodyBefore,
  );
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
      ...setup.events.map((item, index) => eventComment(item, index + 1)),
      stateComment(setup.currentState, 10),
    ],
    runs: [oldCompleted, workerRun(setup.current.nextDispatch, { id: 8_001 })],
    deployments: [
      {
        id: 9_000,
        ref: SHA.A,
        sha: SHA.A,
        environment: "preview/ui/pr-519",
        payload: {
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
      ...setup.events.map((item, index) => eventComment(item, index + 1)),
      stateComment(setup.currentState, 10),
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
  assert.equal(terminalState.ui.active, null);
  assert.equal(
    terminalState.ui.terminal_history.at(-1).key_digest,
    setup.current.nextDispatch.key_digest,
  );

  Object.assign(
    fixture.runs.find(({ id }) => id === 8_000),
    {
      status: "completed",
      conclusion: "cancelled",
    },
  );
  const controllerBodyBefore = fixture.comments.find(({ body }) =>
    body.startsWith("<!-- vercel-preview-controller:v1 -->"),
  ).body;
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
  assert.equal(
    fixture.comments.find(({ body }) =>
      body.startsWith("<!-- vercel-preview-controller:v1 -->"),
    ).body,
    controllerBodyBefore,
  );
});

test("retired attempt recovery errors are quarantined without poisoning the current epoch", async () => {
  const setup = sameShaReopenState();
  const currentResult = result(setup.current.nextDispatch, { runId: 8_001 });
  const terminalState = reconcile({
    events: setup.events,
    results: [currentResult],
    pullRequest: setup.pullRequest,
    existingState: setup.currentState,
  }).state;
  assert.equal(terminalState.ui.active, null);
  assert.equal(
    terminalState.ui.terminal_history.at(-1).key_digest,
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
      ...setup.events.map((item, index) => eventComment(item, index + 1)),
      resultComment(currentResult, 9),
      stateComment(terminalState, 10),
    ],
    runs: [oldLatestAttempt],
  });

  const reconciled = await reconcilePreview({
    github: fixture.github,
    context: fakeContext({ runId: 7_001 }),
    core: fakeCore(),
    prNumber: 519,
    waitForRecovery: async () => {},
  });
  assert.equal(reconciled.ui.active, null);
  assert.equal(
    reconciled.ui.terminal_history.at(-1).key_digest,
    setup.current.nextDispatch.key_digest,
  );
  assert.equal(
    reconciled.ui.retired_active.at(-1).recovery_quarantine,
    "persisted-attempt-invalid-or-unavailable",
  );
  assert.equal(
    fixture.commitStatuses.some(({ state }) => state === "error"),
    false,
  );
  assert.equal(fixture.commitStatuses.at(-1).state, "success");
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
      ...setup.events.map((item, index) => eventComment(item, index + 1)),
      resultComment(currentResult, 9),
      stateComment(terminalState, 10),
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
  assert.equal(first.ui.active, null);
  assert.equal(first.ui.retired_active.at(-1).recovery_quarantine, undefined);
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
  assert.equal(second.ui.active, null);
  assert.equal(
    second.ui.terminal_history.at(-1).key_digest,
    setup.current.nextDispatch.key_digest,
  );
  assert.equal(
    fixture.commitStatuses.some(({ state }) => state === "error"),
    false,
  );
  assert.equal(fixture.workflowRunAttemptRequests.length, 3);
  assert.ok(
    fixture.comments.some(
      ({ body }) =>
        body.startsWith("<!-- vercel-preview-worker-result:v1:") &&
        body.includes('"worker_run_id": 8000'),
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
      ...setup.events.map((item, index) => eventComment(item, index + 1)),
      resultComment(currentResult, 9),
      stateComment(terminalState, 10),
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
  assert.equal(first.ui.retired_active.at(-1).recovery_quarantine, undefined);
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
    second.ui.retired_active.at(-1).recovery_quarantine,
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
      ...setup.events.map((item, index) => eventComment(item, index + 1)),
      stateComment(setup.currentState, 10),
    ],
    runs: [oldCompleted, workerRun(setup.current.nextDispatch, { id: 8_001 })],
    deployments: [
      {
        id: 9_000,
        ref: SHA.A,
        sha: SHA.A,
        environment: "preview/ui/pr-519",
        payload: {
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
      idempotency_key: selected.nextDispatch.key,
      sha: SHA.A,
      logical_target: "ui",
    },
  };
  const fixture = fakeGitHub({
    pullRequest,
    comments: [eventComment(opened), stateComment(dispatched)],
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
      idempotency_key: selected.nextDispatch.key,
      sha: SHA.A,
      logical_target: "ui",
    },
  };
  const fixture = fakeGitHub({
    pullRequest,
    comments: [eventComment(opened), stateComment(dispatched)],
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
    comments: [eventComment(opened), stateComment(dispatched)],
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
      idempotency_key: selected.nextDispatch.key,
      sha: SHA.A,
      logical_target: "ui",
    },
  };
  const fixture = fakeGitHub({
    pullRequest,
    comments: [eventComment(opened), stateComment(dispatched)],
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
  const workerEvidence = await recordWorkerEvidence({
    github: fixture.github,
    context: fakeContext({ runId: 8_000 }),
    core: fakeCore(),
    inputs: {
      pull_request_number: "519",
      target: "ui",
      commit_sha: SHA.A,
      controller_key: selected.nextDispatch.key,
      controller_key_digest: selected.nextDispatch.key_digest,
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
    },
  });
  assert.equal(workerEvidence.execution_mode, "build");
  assert.equal(workerEvidence.build_completed, true);
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
  const resultReceipt = fixture.comments.find(({ body }) =>
    body.startsWith("<!-- vercel-preview-worker-result:v1:"),
  );
  const resumeFixture = fakeGitHub({
    pullRequest,
    comments: [eventComment(opened), stateComment(retryState), resultReceipt],
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
    comments: [eventComment(opened), stateComment(dispatched)],
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
      idempotency_key: selected.nextDispatch.key,
      sha: SHA.A,
      logical_target: "ui",
    },
  };
  const fixture = fakeGitHub({
    pullRequest,
    comments: [eventComment(opened), stateComment(dispatched)],
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
  const durableEvidence = fixture.comments.filter(
    ({ body }) =>
      body.startsWith("<!-- vercel-preview-worker-evidence:v1:") ||
      body.startsWith("<!-- vercel-preview-worker-result:v1:"),
  );
  const retryFixture = fakeGitHub({
    pullRequest,
    comments: [
      eventComment(opened),
      ...durableEvidence,
      stateComment(retryState),
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
