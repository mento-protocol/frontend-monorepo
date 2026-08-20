import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  GITHUB_SAMPLE_SCHEMA,
  MAIN_CAPTURE_SCHEMA,
  OBSERVATION_AUDIT_SCHEMA,
  OBSERVATION_INTERVAL_SCHEMA,
  OBSERVATION_RELATIVE_ROOT,
  PREVIEW_CAPTURE_SCHEMA,
  assertControllerSyntheticRunBinding,
  assertMainDeployShaBinding,
  assertTerminalSampleCoverage,
  bindUniquePreviewReferences,
  deriveMainTerminalRoute,
  environmentWithoutGhTokens,
  runVercelCostObservation,
  selectLatestTerminalSample,
} from "./vercel-cost-observation.mjs";
import {
  compactPreviewJournal,
  controllerEventRunName,
  createPreviewJournal,
  reconcileState,
  renderPreviewJournalBody,
  selectionReceiptFromDispatch,
  validateWorkerResult,
  workerRunName,
} from "./vercel-preview-controller.mjs";

const FIXTURE_ROOT = new URL(
  "./fixtures/vercel-cost-observation/",
  import.meta.url,
);
const START = "2026-07-29T00:00:00.000Z";
const END = "2026-08-05T00:00:00.000Z";
const CAPTURED_AT = "2026-08-05T00:01:00.000Z";
const INITIALIZED_AT = "2026-07-28T23:50:00.000Z";

const OBSERVATION_CANARY_LAYOUTS = new Map([
  ["app", "../apps/app.mento.org/app/layout.tsx"],
  ["governance", "../apps/governance.mento.org/app/layout.tsx"],
  ["reserve", "../apps/reserve.mento.org/app/layout.tsx"],
  ["ui", "../apps/ui.mento.org/app/layout.tsx"],
]);

test("all deployed roots expose the exact observation event canary", () => {
  for (const [target, relativeLayoutPath] of OBSERVATION_CANARY_LAYOUTS) {
    const source = readFileSync(
      new URL(relativeLayoutPath, import.meta.url),
      "utf8",
    );
    const rootOpeningTag = source.match(/<html\b[^>]*>/s)?.[0];
    const expectedCanary = `523-v1-${target}-10`;
    const canaries = [
      ...source.matchAll(/data-mento-observation-canary="([^"]+)"/g),
    ].map((match) => match[1]);

    assert.ok(rootOpeningTag, `${target} must retain a root html element`);
    assert.match(
      rootOpeningTag,
      new RegExp(`data-mento-observation-canary="${expectedCanary}"`),
    );
    assert.deepEqual(canaries, [expectedCanary]);
  }
});

function fixture(name) {
  return JSON.parse(readFileSync(new URL(name, FIXTURE_ROOT), "utf8"));
}

function workspace() {
  return mkdtempSync(join(tmpdir(), "vercel-cost-observation-"));
}

function output() {
  let value = "";
  return {
    stream: { write: (chunk) => (value += String(chunk)) },
    read: () => value,
  };
}

function commandKey(args) {
  const normalized = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--hostname" && args[index + 1] === "github.com") {
      index += 1;
      continue;
    }
    normalized.push(
      args[index] === "github.com/mento-protocol/frontend-monorepo"
        ? "mento-protocol/frontend-monorepo"
        : args[index],
    );
  }
  return normalized.join(" ");
}

function fakeGh(routes, calls = []) {
  return (args) => {
    calls.push([...args]);
    if (args[0] === "auth" && args[1] === "status") return Buffer.from("");
    const key = commandKey(args);
    let response = routes.get(key);
    if (response === undefined) {
      const prefix = [...routes.keys()].find(
        (candidate) =>
          candidate.endsWith(" --dir") && key.startsWith(`${candidate} `),
      );
      if (prefix) response = routes.get(prefix);
    }
    if (response === undefined) {
      throw new Error(`Unexpected fake gh command: ${key}`);
    }
    if (typeof response === "function") return response(args);
    return Buffer.isBuffer(response)
      ? response
      : Buffer.from(JSON.stringify(response));
  };
}

function addPreviewObservationArtifactRoute(
  routes,
  event,
  journal,
  { available = true } = {},
) {
  const artifactName = `vercel-preview-observation-receipt-v1-${event.event_run_id}`;
  routes.set(
    `api --method GET --paginate --slurp repos/mento-protocol/frontend-monorepo/actions/runs/${event.event_run_id}/artifacts?per_page=100`,
    [
      {
        artifacts: available
          ? [
              {
                id: 90_001,
                name: artifactName,
                expired: false,
                size_in_bytes: 1_024,
              },
            ]
          : [],
      },
    ],
  );
  if (!available) return;
  routes.set(
    `run download ${event.event_run_id} --repo mento-protocol/frontend-monorepo --name ${artifactName} --dir`,
    (args) => {
      const directory = args.at(-1);
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      chmodSync(directory, 0o700);
      writeFileSync(
        join(directory, "preview-observation-receipt.json"),
        `${JSON.stringify(
          {
            schema: "vercel-preview-observation-receipt:v1",
            repository: "mento-protocol/frontend-monorepo",
            pr: journal.pr,
            event_run_id: event.event_run_id,
            journal_revision: journal.revision,
            source_journal_digest: journal.journal_digest,
            journal_digest: journal.journal_digest,
            ...(Object.hasOwn(journal, "admission")
              ? { admission: journal.admission }
              : {}),
            checkpoint: journal.checkpoint,
            receipts: journal.receipts,
            state: journal.state,
          },
          null,
          2,
        )}\n`,
        { mode: 0o600 },
      );
      chmodSync(join(directory, "preview-observation-receipt.json"), 0o600);
      return Buffer.from("");
    },
  );
}

function githubWholeSecondTimestamps(value) {
  if (typeof value === "string") return value.replace(/\.000Z$/, "Z");
  if (Buffer.isBuffer(value)) return value;
  if (Array.isArray(value)) return value.map(githubWholeSecondTimestamps);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        githubWholeSecondTimestamps(entry),
      ]),
    );
  }
  return value;
}

function githubWholeSecondRoutes(routes) {
  return new Map(
    [...routes].map(([key, value]) => [
      key,
      githubWholeSecondTimestamps(value),
    ]),
  );
}

function boundaryRoutes({ openPulls = [], commentsByPr = new Map() } = {}) {
  const workflows = [
    "_vercel-prebuilt.yml",
    "_vercel-preview-smoke.yml",
    "vercel-main-deployment.yml",
    "vercel-preview-controller.yml",
    "vercel-preview-intake.yml",
    "vercel-preview-worker.yml",
  ].map((name, index) => ({
    id: 100 + index,
    name,
    path: `.github/workflows/${name}`,
    state: "active",
    html_url: `https://github.com/mento-protocol/frontend-monorepo/actions/workflows/${name}`,
  }));
  const routes = new Map([
    [
      "api --method GET repos/mento-protocol/frontend-monorepo",
      { private: false, visibility: "public" },
    ],
    [
      "api --method GET repos/mento-protocol/frontend-monorepo/git/ref/heads/main",
      { object: { sha: "a".repeat(40) } },
    ],
    [
      "api --method GET --paginate --slurp repos/mento-protocol/frontend-monorepo/actions/workflows?per_page=100",
      [{ workflows }],
    ],
    [
      "api --method GET --paginate --slurp repos/mento-protocol/frontend-monorepo/pulls?state=open&per_page=100",
      [openPulls],
    ],
  ]);
  for (const pull of openPulls) {
    routes.set(
      `api --method GET --paginate --slurp repos/mento-protocol/frontend-monorepo/issues/${pull.number}/comments?per_page=100`,
      [commentsByPr.get(pull.number) ?? []],
    );
    routes.set(
      `api --method GET repos/mento-protocol/frontend-monorepo/pulls/${pull.number}`,
      pull,
    );
  }
  for (const status of [
    "requested",
    "waiting",
    "pending",
    "queued",
    "in_progress",
  ]) {
    routes.set(
      `api --method GET --paginate --slurp repos/mento-protocol/frontend-monorepo/actions/runs?status=${status}&per_page=100`,
      [{ workflow_runs: [] }],
    );
  }
  return routes;
}

const OBSERVED_WORKFLOW_FILES = [
  "vercel-preview-controller.yml",
  "vercel-preview-intake.yml",
  "vercel-preview-worker.yml",
  "vercel-main-deployment.yml",
];

function githubSampleRoutes({
  runs = [],
  preStartRuns = [],
  jobsByRun = new Map(),
  startBoundaryRunStates = [],
  sampleFixture = fixture("github-sample.json"),
} = {}) {
  const routes = new Map([
    [
      "api --method GET repos/mento-protocol/frontend-monorepo",
      sampleFixture.repository,
    ],
    [
      "api --method GET --paginate --slurp repos/mento-protocol/frontend-monorepo/actions/caches?per_page=100",
      [sampleFixture.caches],
    ],
    [
      "api --method GET --paginate --slurp repos/mento-protocol/frontend-monorepo/actions/artifacts?per_page=100",
      [sampleFixture.artifacts],
    ],
  ]);
  for (const run of [...startBoundaryRunStates, ...preStartRuns]) {
    routes.set(
      `api --method GET repos/mento-protocol/frontend-monorepo/actions/runs/${run.id}`,
      run,
    );
  }
  const addWorkflowShardRoutes = (shardRuns, fromUtc, throughUtc) => {
    for (
      let dayStart = Date.parse(fromUtc);
      dayStart < Date.parse(throughUtc);
      dayStart += 86_400_000
    ) {
      const end = Math.min(dayStart + 86_400_000, Date.parse(throughUtc));
      const startUtc = new Date(dayStart).toISOString();
      const endInclusive = new Date(end - 1).toISOString();
      for (const workflow of OBSERVED_WORKFLOW_FILES) {
        const path = `.github/workflows/${workflow}`;
        const matchingRuns = shardRuns.filter(
          (run) =>
            String(run.path).split("@")[0] === path &&
            Date.parse(run.created_at) >= dayStart &&
            Date.parse(run.created_at) < end,
        );
        routes.set(
          `api --method GET --paginate --slurp repos/mento-protocol/frontend-monorepo/actions/workflows/${workflow}/runs?per_page=100&created=${encodeURIComponent(`${startUtc}..${endInclusive}`)}`,
          [{ total_count: matchingRuns.length, workflow_runs: matchingRuns }],
        );
      }
    }
  };
  addWorkflowShardRoutes(preStartRuns, INITIALIZED_AT, START);
  addWorkflowShardRoutes(runs, START, END);
  for (const run of runs) {
    routes.set(
      `api --method GET --paginate --slurp repos/mento-protocol/frontend-monorepo/actions/runs/${run.id}/jobs?filter=all&per_page=100`,
      [{ jobs: jobsByRun.get(String(run.id)) ?? [] }],
    );
  }
  return routes;
}

function runInit(cwd, overrides = {}) {
  const sink = output();
  const result = runVercelCostObservation({
    argv: [
      "init",
      "--start",
      overrides.start ?? START,
      "--end",
      overrides.end ?? END,
    ],
    cwd,
    now: overrides.now ?? (() => new Date(INITIALIZED_AT)),
    gh: overrides.gh ?? fakeGh(boundaryRoutes()),
    stdout: sink.stream,
  });
  return { result, stdout: sink.read() };
}

function observationRoot(cwd) {
  return join(cwd, OBSERVATION_RELATIVE_ROOT);
}

function assertPrivateTree(path) {
  const stats = lstatSync(path);
  if (stats.isDirectory()) {
    assert.equal(stats.isSymbolicLink(), false);
    assert.equal(stats.mode & 0o777, 0o700);
    for (const name of readdirSync(path)) {
      assertPrivateTree(join(path, name));
    }
    return;
  }
  assert.equal(stats.isFile(), true);
  assert.equal(stats.isSymbolicLink(), false);
  assert.equal(stats.nlink, 1);
  assert.equal(stats.mode & 0o777, 0o600);
}

function canonicalBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function digestBytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function writeSealedCapture(directory, capture) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const captureBytes = canonicalBytes(capture);
  writeFileSync(join(directory, "capture.json"), captureBytes, {
    mode: 0o600,
  });
  const captureSha256 = digestBytes(captureBytes);
  const seal = {
    schema: "vercel-cost-capture-seal:v2",
    captureSchema: capture.schema,
    captureSha256,
    payloadFiles: capture.files,
    treeSha256: digestBytes(
      canonicalBytes({
        captureSha256,
        payloadFiles: capture.files,
      }),
    ),
  };
  writeFileSync(join(directory, "seal.json"), canonicalBytes(seal), {
    mode: 0o600,
  });
}

function seedAuditEligiblePreviewCaptures(cwd, count = 10) {
  const previewRoot = join(observationRoot(cwd), "preview");
  mkdirSync(previewRoot, { recursive: true, mode: 0o700 });
  chmodSync(previewRoot, 0o700);
  for (let index = 0; index < count; index += 1) {
    const eventRunId = String(70_000 + index);
    writeSealedCapture(join(previewRoot, eventRunId), {
      schema: PREVIEW_CAPTURE_SCHEMA,
      repository: "mento-protocol/frontend-monorepo",
      pr: 8_000 + index,
      eventRunId,
      capturedAtUtc: CAPTURED_AT,
      eventTimestampUtc: `2026-07-29T${String(index).padStart(2, "0")}:00:00.000Z`,
      eventAction: "opened",
      headSha: String(index).repeat(40),
      trust: "trusted",
      plan: {
        targets: ["ui"],
        reason: "affected-packages",
        base: "a".repeat(40),
        head: String(index).repeat(40),
        planner_source_sha: "a".repeat(40),
      },
      canonicalDerivedFacts: {
        eligibleTrustedDeployedCodePush: true,
        statusDecision: {
          state: "success",
          target_url: `https://ui-${index}.vercel.app`,
        },
        finalSentinel: {
          updatedAtUtc: `2026-07-29T${String(index).padStart(2, "0")}:10:00.000Z`,
        },
        capturedWorkers: [],
        capturedControllerSyntheticRuns: [],
        githubDeploymentTerminalStatuses: [],
        evidenceComplete: true,
      },
      unresolvedProviderFields: [],
      files: [],
    });
  }
}

function pullFromEvent(event) {
  return {
    number: event.pr,
    state: event.pr_state,
    updated_at: event.pr_updated_at,
    closed_at: event.pr_closed_at,
    base: { sha: event.trusted_base_sha, ref: event.base_ref },
    head: {
      sha: event.head_sha,
      ref: event.head_ref,
      repo: { full_name: event.head_repository },
    },
    user: { login: event.pr_author },
  };
}

function reconcileEvent(event, options = {}) {
  return reconcileState({
    events: options.events ?? [event],
    results: options.results ?? [],
    selections: options.selections ?? [],
    pullRequest: pullFromEvent(event),
    existingState: options.existingState ?? null,
    controllerUrl: `https://github.com/mento-protocol/frontend-monorepo/actions/runs/${event.event_run_id}`,
    expectedWorkflowSha: event.trusted_base_sha,
  });
}

function previewJournalFixture(event, mode, events = [event]) {
  if (mode === "pending") {
    return { journal: createPreviewJournal({ pr: event.pr, events }) };
  }
  const initial = reconcileEvent(event, { events });
  if (event.plan.targets.length === 0) {
    return {
      journal: createPreviewJournal({
        pr: event.pr,
        events,
        state: initial.state,
      }),
    };
  }
  assert.equal(event.plan.targets.length, 1);
  const dispatch = initial.nextDispatches[0];
  const workerRunId = 8_001;
  const active = {
    ...dispatch,
    dispatch_started_at: "2026-07-29T01:00:10.000Z",
    dispatch_state: "dispatched",
    workflow_run_id: workerRunId,
    workflow_sha: dispatch.expected_workflow_sha,
    workflow_run_attempt: 1,
    run_url: `https://api.github.com/repos/mento-protocol/frontend-monorepo/actions/runs/${workerRunId}`,
    html_url: `https://github.com/mento-protocol/frontend-monorepo/actions/runs/${workerRunId}`,
  };
  const persisted = structuredClone(initial.state);
  persisted.targets[dispatch.target].active = active;
  const selection = selectionReceiptFromDispatch(active);
  const result = validateWorkerResult({
    schema: "vercel-preview-worker-result:v2",
    repository: "mento-protocol/frontend-monorepo",
    pr: selection.pr,
    target: selection.target,
    sha: selection.sha,
    controller_key: selection.key,
    key_digest: selection.key_digest,
    epoch_anchor_run_id: selection.epoch_anchor_run_id,
    reconciliation_basis_digest: selection.reconciliation_basis_digest,
    selection_receipt_run_id: selection.selection_receipt_run_id,
    expected_workflow_sha: selection.expected_workflow_sha,
    worker_run_id: workerRunId,
    worker_run_attempt: 1,
    github_deployment_id: 7_001,
    state: "success",
    vercel_deployment_id: "dpl_fixture",
    next_deployment_id: "m-ui-fixture",
    vercel_deployment_url: "https://ui-observation-fixture.vercel.app",
    smoke_result: "passed",
    terminal_reason: "verified",
  });
  const workerEvidence = {
    schema: "vercel-preview-worker-evidence:v2",
    repository: "mento-protocol/frontend-monorepo",
    pr: selection.pr,
    target: selection.target,
    sha: selection.sha,
    controller_key: selection.key,
    key_digest: selection.key_digest,
    epoch_anchor_run_id: selection.epoch_anchor_run_id,
    reconciliation_basis_digest: selection.reconciliation_basis_digest,
    selection_receipt_run_id: selection.selection_receipt_run_id,
    expected_workflow_sha: selection.expected_workflow_sha,
    worker_run_id: workerRunId,
    worker_run_attempt: 1,
    github_deployment_id: 7_001,
    execution_mode: "build",
    build_completed: true,
    vercel_deployment_id: "dpl_fixture",
    next_deployment_id: "m-ui-fixture",
    verified_upload_url: "https://ui-observation-fixture.vercel.app",
  };
  const settled = reconcileEvent(event, {
    events,
    existingState: persisted,
    selections: [selection],
    results: [result],
  });
  return {
    journal: createPreviewJournal({
      pr: event.pr,
      events,
      selections: [selection],
      workerEvidence: mode === "missing-evidence" ? [] : [workerEvidence],
      results: [result],
      state: settled.state,
    }),
    selection,
    result,
    workerEvidence,
  };
}

function reselectedPreviewJournalFixture(event) {
  assert.deepEqual(event.plan.targets, ["ui"]);
  const initial = reconcileEvent(event);
  const firstDispatch = initial.nextDispatches[0];
  const firstActive = {
    ...firstDispatch,
    dispatch_started_at: "2026-07-29T01:00:10.000Z",
    dispatch_state: "intended",
    workflow_run_id: null,
    workflow_sha: null,
    workflow_run_attempt: null,
    run_url: null,
    html_url: null,
  };
  const firstState = structuredClone(initial.state);
  firstState.targets.ui.active = firstActive;
  const firstSelection = selectionReceiptFromDispatch(firstActive);
  const upgradeResult = validateWorkerResult({
    schema: "vercel-preview-worker-result:v2",
    repository: "mento-protocol/frontend-monorepo",
    pr: firstSelection.pr,
    target: firstSelection.target,
    sha: firstSelection.sha,
    controller_key: firstSelection.key,
    key_digest: firstSelection.key_digest,
    epoch_anchor_run_id: firstSelection.epoch_anchor_run_id,
    reconciliation_basis_digest: firstSelection.reconciliation_basis_digest,
    selection_receipt_run_id: firstSelection.selection_receipt_run_id,
    expected_workflow_sha: firstSelection.expected_workflow_sha,
    worker_run_id: 9_004,
    worker_run_attempt: 1,
    github_deployment_id: null,
    state: "error",
    vercel_deployment_id: null,
    next_deployment_id: null,
    vercel_deployment_url: null,
    smoke_result: "not-run",
    terminal_reason: "controller-workflow-upgraded-before-dispatch",
  });
  const replacementWorkflowSha = "d".repeat(40);
  const reselected = reconcileState({
    events: [event],
    results: [upgradeResult],
    selections: [firstSelection],
    pullRequest: pullFromEvent(event),
    existingState: firstState,
    controllerUrl: `https://github.com/mento-protocol/frontend-monorepo/actions/runs/${event.event_run_id}`,
    expectedWorkflowSha: replacementWorkflowSha,
  });
  assert.equal(reselected.nextDispatches.length, 1);
  const replacementDispatch = reselected.nextDispatches[0];
  assert.equal(
    replacementDispatch.expected_workflow_sha,
    replacementWorkflowSha,
  );
  const replacementActive = {
    ...replacementDispatch,
    dispatch_started_at: "2026-07-29T01:01:10.000Z",
    dispatch_state: "dispatched",
    workflow_run_id: 9_005,
    workflow_sha: replacementWorkflowSha,
    workflow_run_attempt: 1,
    run_url:
      "https://api.github.com/repos/mento-protocol/frontend-monorepo/actions/runs/9005",
    html_url:
      "https://github.com/mento-protocol/frontend-monorepo/actions/runs/9005",
  };
  const replacementState = structuredClone(reselected.state);
  replacementState.targets.ui.active = replacementActive;
  const replacementSelection = selectionReceiptFromDispatch(replacementActive);
  const replacementResult = validateWorkerResult({
    schema: "vercel-preview-worker-result:v2",
    repository: "mento-protocol/frontend-monorepo",
    pr: replacementSelection.pr,
    target: replacementSelection.target,
    sha: replacementSelection.sha,
    controller_key: replacementSelection.key,
    key_digest: replacementSelection.key_digest,
    epoch_anchor_run_id: replacementSelection.epoch_anchor_run_id,
    reconciliation_basis_digest:
      replacementSelection.reconciliation_basis_digest,
    selection_receipt_run_id: replacementSelection.selection_receipt_run_id,
    expected_workflow_sha: replacementSelection.expected_workflow_sha,
    worker_run_id: 9_005,
    worker_run_attempt: 1,
    github_deployment_id: 7_102,
    state: "success",
    vercel_deployment_id: "dpl_reselected",
    next_deployment_id: "m-ui-reselected",
    vercel_deployment_url: "https://ui-reselected-fixture.vercel.app",
    smoke_result: "passed",
    terminal_reason: "verified",
  });
  const replacementEvidence = {
    schema: "vercel-preview-worker-evidence:v2",
    repository: "mento-protocol/frontend-monorepo",
    pr: replacementSelection.pr,
    target: replacementSelection.target,
    sha: replacementSelection.sha,
    controller_key: replacementSelection.key,
    key_digest: replacementSelection.key_digest,
    epoch_anchor_run_id: replacementSelection.epoch_anchor_run_id,
    reconciliation_basis_digest:
      replacementSelection.reconciliation_basis_digest,
    selection_receipt_run_id: replacementSelection.selection_receipt_run_id,
    expected_workflow_sha: replacementSelection.expected_workflow_sha,
    worker_run_id: 9_005,
    worker_run_attempt: 1,
    github_deployment_id: 7_102,
    execution_mode: "build",
    build_completed: true,
    vercel_deployment_id: "dpl_reselected",
    next_deployment_id: "m-ui-reselected",
    verified_upload_url: "https://ui-reselected-fixture.vercel.app",
  };
  const settled = reconcileState({
    events: [event],
    results: [upgradeResult, replacementResult],
    selections: [firstSelection, replacementSelection],
    pullRequest: pullFromEvent(event),
    existingState: replacementState,
    controllerUrl: `https://github.com/mento-protocol/frontend-monorepo/actions/runs/${event.event_run_id}`,
    expectedWorkflowSha: replacementWorkflowSha,
  });
  return {
    journal: createPreviewJournal({
      pr: event.pr,
      events: [event],
      selections: [firstSelection, replacementSelection],
      workerEvidence: [replacementEvidence],
      results: [upgradeResult, replacementResult],
      state: settled.state,
    }),
    firstSelection,
    replacementSelection,
    upgradeResult,
    replacementResult,
    replacementEvidence,
    replacementWorkflowSha,
  };
}

function previewRoutes(
  event = fixture("preview-event.json"),
  { mode = "complete", events = [event], observationArtifact = false } = {},
) {
  const fixtureState = previewJournalFixture(event, mode, events);
  const { journal } = fixtureState;
  const journalComment = {
    id: 301,
    html_url:
      "https://github.com/mento-protocol/frontend-monorepo/pull/700#issuecomment-301",
    user: { type: "Bot", login: "github-actions[bot]" },
    body: renderPreviewJournalBody(journal),
  };
  const run = {
    id: event.event_run_id,
    run_number: event.event_run_number,
    run_attempt: 1,
    name: "Vercel Preview Controller",
    path: ".github/workflows/vercel-preview-controller.yml",
    event: "pull_request_target",
    status: "completed",
    conclusion: "success",
    created_at: "2026-07-29T01:00:01.000Z",
    updated_at: "2026-07-29T01:04:00.000Z",
    head_branch: event.head_ref,
    head_sha: event.head_sha,
    head_repository: {
      full_name: event.head_repository,
      url: `https://api.github.com/repos/${event.head_repository}`,
    },
    repository: { full_name: "mento-protocol/frontend-monorepo" },
    pull_requests: [],
    html_url: `https://github.com/mento-protocol/frontend-monorepo/actions/runs/${event.event_run_id}`,
    display_title: controllerEventRunName({
      runId: event.event_run_id,
      runNumber: event.event_run_number,
      pr: event.pr,
      sha: event.head_sha,
      before: event.before_sha,
      action: event.event_action,
      receiptRequired: true,
    }),
  };
  const status = {
    id: 401,
    context: "Vercel Preview",
    state: "success",
    target_url: new URL(
      journal.state?.status_decisions.find(
        (decision) => decision.sha === event.head_sha,
      )?.target_url ?? run.html_url,
    ).toString(),
    created_at: "2026-07-29T01:04:00.000Z",
    updated_at: "2026-07-29T01:04:00.000Z",
    creator: { type: "Bot", login: "github-actions[bot]" },
  };
  const routes = new Map([
    [
      "api --method GET repos/mento-protocol/frontend-monorepo/pulls/700",
      {
        number: 700,
        base: {
          repo: { full_name: "mento-protocol/frontend-monorepo" },
        },
      },
    ],
    [
      "api --method GET --paginate --slurp repos/mento-protocol/frontend-monorepo/issues/700/comments?per_page=100",
      [[journalComment]],
    ],
    [
      `api --method GET repos/mento-protocol/frontend-monorepo/actions/runs/${event.event_run_id}`,
      run,
    ],
    [
      `api --method GET --paginate --slurp repos/mento-protocol/frontend-monorepo/commits/${event.head_sha}/statuses?per_page=100`,
      [[status]],
    ],
    [
      `api --method GET --paginate --slurp repos/mento-protocol/frontend-monorepo/deployments?sha=${event.head_sha}&per_page=100`,
      [
        fixtureState.selection
          ? [
              {
                id: 7_001,
                sha: fixtureState.selection.sha,
                ref: fixtureState.selection.sha,
                environment: `preview/${fixtureState.selection.target}/pr-${event.pr}`,
                payload: {
                  controller_schema: "mento-vercel-prebuilt/v2",
                  idempotency_key: fixtureState.selection.key,
                  sha: fixtureState.selection.sha,
                  logical_target: fixtureState.selection.target,
                  pull_request_number: event.pr,
                  provenance: "preview-controller:v2",
                },
              },
            ]
          : [],
      ],
    ],
  ]);
  if (fixtureState.selection) {
    routes.set(
      "api --method GET --paginate --slurp repos/mento-protocol/frontend-monorepo/deployments/7001/statuses?per_page=100",
      [
        [
          {
            id: 7_002,
            state: "success",
            log_url:
              "https://github.com/mento-protocol/frontend-monorepo/actions/runs/8001",
            environment_url: "https://ui-observation-fixture.vercel.app/",
            created_at: "2026-07-29T01:03:00.000Z",
            creator: { type: "Bot", login: "github-actions[bot]" },
          },
        ],
      ],
    );
    routes.set(
      "api --method GET repos/mento-protocol/frontend-monorepo/actions/runs/8001/attempts/1",
      {
        id: 8_001,
        run_attempt: 1,
        name: "Vercel Preview Worker",
        path: ".github/workflows/vercel-preview-worker.yml",
        event: "workflow_dispatch",
        status: "completed",
        conclusion: "success",
        created_at: "2026-07-29T01:00:20.000Z",
        updated_at: "2026-07-29T01:03:00.000Z",
        head_branch: "main",
        head_sha: fixtureState.selection.expected_workflow_sha,
        html_url:
          "https://github.com/mento-protocol/frontend-monorepo/actions/runs/8001",
        display_title: workerRunName({
          pr: event.pr,
          target: fixtureState.selection.target,
          sha: fixtureState.selection.sha,
          keyDigest: fixtureState.selection.key_digest,
        }),
      },
    );
    routes.set(
      "api --method GET --paginate --slurp repos/mento-protocol/frontend-monorepo/actions/runs/8001/attempts/1/jobs?filter=all&per_page=100",
      [{ jobs: [] }],
    );
    routes.set(
      "run view 8001 --repo mento-protocol/frontend-monorepo --attempt 1 --log",
      Buffer.from("fixture preview worker log\n"),
    );
  }
  addPreviewObservationArtifactRoute(routes, event, journal, {
    available: observationArtifact,
  });
  return routes;
}

function reselectedPreviewRoutes(
  event = {
    ...fixture("preview-event.json"),
    plan: {
      targets: ["ui"],
      reason: "affected-packages",
      base: "a".repeat(40),
      head: "b".repeat(40),
      planner_source_sha: "a".repeat(40),
    },
  },
) {
  const fixtureState = reselectedPreviewJournalFixture(event);
  const routes = previewRoutes(event);
  routes.set(
    "api --method GET --paginate --slurp repos/mento-protocol/frontend-monorepo/issues/700/comments?per_page=100",
    [
      [
        {
          id: 301,
          html_url:
            "https://github.com/mento-protocol/frontend-monorepo/pull/700#issuecomment-301",
          user: { type: "Bot", login: "github-actions[bot]" },
          body: renderPreviewJournalBody(fixtureState.journal),
        },
      ],
    ],
  );
  const decision = fixtureState.journal.state.status_decisions.find(
    (entry) => entry.sha === event.head_sha,
  );
  routes.set(
    `api --method GET --paginate --slurp repos/mento-protocol/frontend-monorepo/commits/${event.head_sha}/statuses?per_page=100`,
    [
      [
        {
          id: 402,
          context: "Vercel Preview",
          state: decision.state,
          target_url: new URL(decision.target_url).toString(),
          created_at: "2026-07-29T01:04:00.000Z",
          updated_at: "2026-07-29T01:04:00.000Z",
          creator: { type: "Bot", login: "github-actions[bot]" },
        },
      ],
    ],
  );
  routes.set(
    `api --method GET --paginate --slurp repos/mento-protocol/frontend-monorepo/deployments?sha=${event.head_sha}&per_page=100`,
    [
      [
        {
          id: 7_102,
          sha: fixtureState.replacementSelection.sha,
          ref: fixtureState.replacementSelection.sha,
          environment: `preview/ui/pr-${event.pr}`,
          payload: {
            controller_schema: "mento-vercel-prebuilt/v2",
            idempotency_key: fixtureState.replacementSelection.key,
            sha: fixtureState.replacementSelection.sha,
            logical_target: "ui",
            pull_request_number: event.pr,
            provenance: "preview-controller:v2",
          },
        },
      ],
    ],
  );
  routes.set(
    "api --method GET --paginate --slurp repos/mento-protocol/frontend-monorepo/deployments/7102/statuses?per_page=100",
    [
      [
        {
          id: 7_103,
          state: "success",
          log_url:
            "https://github.com/mento-protocol/frontend-monorepo/actions/runs/9005",
          environment_url: "https://ui-reselected-fixture.vercel.app",
          created_at: "2026-07-29T01:03:00.000Z",
          creator: { type: "Bot", login: "github-actions[bot]" },
        },
      ],
    ],
  );
  routes.set(
    "api --method GET repos/mento-protocol/frontend-monorepo/actions/runs/9004/attempts/1",
    {
      id: 9_004,
      run_attempt: 1,
      name: "Vercel Preview Controller",
      path: ".github/workflows/vercel-preview-controller.yml",
      event: "workflow_run",
      status: "completed",
      conclusion: "failure",
      created_at: "2026-07-29T01:00:30.000Z",
      updated_at: "2026-07-29T01:01:00.000Z",
      head_branch: "main",
      head_sha: fixtureState.replacementWorkflowSha,
      html_url:
        "https://github.com/mento-protocol/frontend-monorepo/actions/runs/9004",
      display_title: "Vercel Preview Controller",
    },
  );
  routes.set(
    "api --method GET --paginate --slurp repos/mento-protocol/frontend-monorepo/actions/runs/9004/attempts/1/jobs?filter=all&per_page=100",
    [{ jobs: [] }],
  );
  routes.set(
    "run view 9004 --repo mento-protocol/frontend-monorepo --attempt 1 --log",
    Buffer.from("fixture controller upgrade log\n"),
  );
  routes.set(
    "api --method GET repos/mento-protocol/frontend-monorepo/actions/runs/9005/attempts/1",
    {
      id: 9_005,
      run_attempt: 1,
      name: "Vercel Preview Worker",
      path: ".github/workflows/vercel-preview-worker.yml",
      event: "workflow_dispatch",
      status: "completed",
      conclusion: "success",
      created_at: "2026-07-29T01:01:20.000Z",
      updated_at: "2026-07-29T01:03:00.000Z",
      head_branch: "main",
      head_sha: fixtureState.replacementWorkflowSha,
      html_url:
        "https://github.com/mento-protocol/frontend-monorepo/actions/runs/9005",
      display_title: workerRunName({
        pr: event.pr,
        target: "ui",
        sha: event.head_sha,
        keyDigest: fixtureState.replacementSelection.key_digest,
      }),
    },
  );
  routes.set(
    "api --method GET --paginate --slurp repos/mento-protocol/frontend-monorepo/actions/runs/9005/attempts/1/jobs?filter=all&per_page=100",
    [{ jobs: [] }],
  );
  routes.set(
    "run view 9005 --repo mento-protocol/frontend-monorepo --attempt 1 --log",
    Buffer.from("fixture replacement worker log\n"),
  );
  addPreviewObservationArtifactRoute(routes, event, fixtureState.journal);
  return { routes, fixtureState };
}

test("init creates an idempotent private interval and rejects conflicts", () => {
  const cwd = workspace();
  const first = runInit(cwd);
  assert.equal(first.result.exitCode, 0);
  assert.equal(JSON.parse(first.stdout).command, "init");
  const intervalPath = join(observationRoot(cwd), "interval.json");
  const interval = JSON.parse(readFileSync(intervalPath, "utf8"));
  assert.equal(interval.schema, OBSERVATION_INTERVAL_SCHEMA);
  assert.equal(interval.startUtc, START);
  assert.equal(interval.endUtcExclusive, END);
  const boundary = JSON.parse(
    readFileSync(join(observationRoot(cwd), "boundary", "start.json"), "utf8"),
  );
  assert.equal(boundary.repositoryVisibility.publicAtCapture, true);
  assert.equal(
    Object.hasOwn(boundary.repositoryVisibility, "publicAtBoundary"),
    false,
  );
  assertPrivateTree(observationRoot(cwd));

  assert.doesNotThrow(() => runInit(cwd));
  assert.throws(
    () =>
      runInit(cwd, {
        start: "2026-07-30T00:00:00.000Z",
        end: "2026-08-06T00:00:00.000Z",
      }),
    /start conflicts/,
  );
});

test("init accepts exactly one leading pnpm script separator", () => {
  const cwd = workspace();
  const sink = output();
  const result = runVercelCostObservation({
    argv: ["--", "init", "--start", START, "--end", END],
    cwd,
    now: () => new Date(INITIALIZED_AT),
    gh: fakeGh(boundaryRoutes()),
    stdout: sink.stream,
  });

  assert.equal(result.exitCode, 0);
  assert.equal(JSON.parse(sink.read()).command, "init");
  assert.equal(
    JSON.parse(
      readFileSync(join(observationRoot(cwd), "interval.json"), "utf8"),
    ).startUtc,
    START,
  );
  assert.throws(
    () =>
      runVercelCostObservation({
        argv: ["--", "--", "init", "--start", START, "--end", END],
        cwd: workspace(),
        now: () => new Date(INITIALIZED_AT),
        gh: fakeGh(boundaryRoutes()),
        stdout: output().stream,
      }),
    /Observation command is unsupported/,
  );
});

test("init leaves no boundary evidence when capture finishes after start", () => {
  const cwd = workspace();
  let nowCalls = 0;
  assert.throws(
    () =>
      runInit(cwd, {
        now: () =>
          new Date(
            nowCalls++ === 0 ? INITIALIZED_AT : "2026-07-29T00:00:00.001Z",
          ),
      }),
    /crossed its start boundary/,
  );
  assert.equal(
    existsSync(join(observationRoot(cwd), "boundary", "start.json")),
    false,
  );
  assert.equal(existsSync(join(observationRoot(cwd), "interval.json")), false);
});

test("init retries when an open PR head changes during journal capture", () => {
  const cwd = workspace();
  const pull = {
    number: 700,
    head: { sha: "a".repeat(40) },
    updated_at: "2026-07-28T23:30:00.000Z",
  };
  const routes = boundaryRoutes({ openPulls: [pull] });
  routes.set(
    "api --method GET repos/mento-protocol/frontend-monorepo/pulls/700",
    { ...pull, head: { sha: "b".repeat(40) } },
  );
  assert.throws(
    () => runInit(cwd, { gh: fakeGh(routes) }),
    /head changed while recording its journal/,
  );
  assert.equal(
    existsSync(join(observationRoot(cwd), "boundary", "start.json")),
    false,
  );
});

test("init canonicalizes GitHub REST whole-second timestamps", () => {
  const cwd = workspace();
  const pull = {
    number: 700,
    head: { sha: "a".repeat(40) },
    updated_at: "2026-07-28T23:30:00Z",
  };

  runInit(cwd, {
    gh: fakeGh(boundaryRoutes({ openPulls: [pull] })),
  });

  const boundary = JSON.parse(
    readFileSync(join(observationRoot(cwd), "boundary", "start.json"), "utf8"),
  );
  assert.equal(
    boundary.openPullRequestJournals[0].updatedAtUtc,
    "2026-07-28T23:30:00.000Z",
  );
});

test("init accepts only the controller's two canonical admission orderings", () => {
  const pull = {
    number: 700,
    head: { sha: "a".repeat(40) },
    updated_at: "2026-07-28T23:30:00Z",
  };
  const canonical = createPreviewJournal({
    pr: pull.number,
    admission: {
      schema: "vercel-preview-controller-admission:v1",
      workflow_id: 100,
      through_run_id: 200,
      through_run_number: 300,
    },
  });
  const { admission, ...withoutAdmission } = canonical;
  const admissionLast = { ...withoutAdmission, admission };
  const comment = {
    id: 400,
    user: { type: "Bot", login: "github-actions[bot]" },
    body: renderPreviewJournalBody(admissionLast),
  };
  const commentsByPr = new Map([[pull.number, [comment]]]);
  const acceptedWorkspace = workspace();

  runInit(acceptedWorkspace, {
    gh: fakeGh(boundaryRoutes({ openPulls: [pull], commentsByPr })),
  });

  const boundary = JSON.parse(
    readFileSync(
      join(observationRoot(acceptedWorkspace), "boundary", "start.json"),
      "utf8",
    ),
  );
  assert.equal(
    boundary.openPullRequestJournals[0].journal.digest,
    canonical.journal_digest,
  );

  const { schema, ...withoutSchema } = admissionLast;
  const unsupportedOrderComment = {
    ...comment,
    body: renderPreviewJournalBody({ ...withoutSchema, schema }),
  };
  assert.throws(
    () =>
      runInit(workspace(), {
        gh: fakeGh(
          boundaryRoutes({
            openPulls: [pull],
            commentsByPr: new Map([[pull.number, [unsupportedOrderComment]]]),
          }),
        ),
      }),
    /Preview journal is not canonical/,
  );
});

test("init recovers when the start boundary exists without its commit marker", () => {
  const cwd = workspace();
  runInit(cwd);
  const root = observationRoot(cwd);
  const boundaryPath = join(root, "boundary", "start.json");
  const intervalPath = join(root, "interval.json");
  const boundaryBytes = readFileSync(boundaryPath);
  unlinkSync(intervalPath);

  const recovered = runInit(cwd, {
    now: () => new Date("2026-07-28T23:59:00.000Z"),
    gh: () => {
      throw new Error("init recovery must not recapture the boundary");
    },
  });

  assert.equal(recovered.result.exitCode, 0);
  assert.deepEqual(readFileSync(boundaryPath), boundaryBytes);
  assert.equal(
    JSON.parse(readFileSync(intervalPath, "utf8")).schema,
    OBSERVATION_INTERVAL_SCHEMA,
  );
  assertPrivateTree(root);
});

test("interval digest rejects an edited start-boundary authority record", () => {
  const cwd = workspace();
  runInit(cwd);
  const boundaryPath = join(observationRoot(cwd), "boundary", "start.json");
  const boundary = JSON.parse(readFileSync(boundaryPath, "utf8"));
  boundary.currentMainSha = "f".repeat(40);
  writeFileSync(boundaryPath, `${JSON.stringify(boundary, null, 2)}\n`, {
    mode: 0o600,
  });

  assert.throws(
    () =>
      runVercelCostObservation({
        argv: ["sample-github"],
        cwd,
        now: () => new Date(CAPTURED_AT),
        gh: fakeGh(new Map()),
        stdout: output().stream,
      }),
    /start boundary conflicts with its interval digest/,
  );
});

test("interval rejects canonical start and initial-end edits that conflict with its boundary", () => {
  for (const mutation of [
    { startUtc: "2026-07-30T00:00:00.000Z" },
    { endUtcExclusive: "2026-08-06T00:00:00.000Z" },
  ]) {
    const cwd = workspace();
    runInit(cwd);
    const intervalPath = join(observationRoot(cwd), "interval.json");
    const interval = JSON.parse(readFileSync(intervalPath, "utf8"));
    Object.assign(interval, mutation);
    writeFileSync(intervalPath, `${JSON.stringify(interval, null, 2)}\n`, {
      mode: 0o600,
    });
    assert.throws(
      () =>
        runVercelCostObservation({
          argv: ["sample-github"],
          cwd,
          now: () => new Date(CAPTURED_AT),
          gh: fakeGh(new Map()),
          stdout: output().stream,
        }),
      /interval boundaries conflict with its start boundary/,
    );
  }
});

test("a dead root operation lock is recovered before the next mutation", () => {
  const cwd = workspace();
  runInit(cwd);
  const lockDirectory = join(observationRoot(cwd), ".operation-lock");
  mkdirSync(lockDirectory, { mode: 0o700 });
  chmodSync(lockDirectory, 0o700);
  writeFileSync(
    join(lockDirectory, "owner.json"),
    `${JSON.stringify(
      {
        schema: "vercel-cost-observation-operation-lock:v2",
        pid: 99_999_999,
        nonce: "a".repeat(24),
        command: "sample-github",
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );

  assert.doesNotThrow(() =>
    runInit(cwd, {
      gh: () => {
        throw new Error("idempotent init must not recapture");
      },
    }),
  );
  assert.equal(existsSync(lockDirectory), false);
});

test("init rejects a symlinked private observation root", () => {
  const cwd = workspace();
  const evidence = join(cwd, ".vercel-cost-evidence");
  const outside = workspace();
  mkdirSync(evidence, { mode: 0o700 });
  chmodSync(evidence, 0o700);
  symlinkSync(outside, join(evidence, "github-observation-v2"));
  assert.throws(() => runInit(cwd), /must be a real directory/);
});

test("init rejects a backdated start before writing interval evidence", () => {
  const cwd = workspace();
  assert.throws(
    () =>
      runInit(cwd, {
        now: () => new Date("2026-07-29T00:00:00.001Z"),
      }),
    /no later than its start boundary/,
  );
  assert.equal(existsSync(join(observationRoot(cwd), "interval.json")), false);
  assert.equal(
    existsSync(join(observationRoot(cwd), "boundary", "start.json")),
    false,
  );
});

test("init appends a monotonic hash-chained end extension", () => {
  const cwd = workspace();
  runInit(cwd);
  const extendedEnd = "2026-08-06T00:00:00.000Z";
  const extension = runInit(cwd, {
    end: extendedEnd,
    now: () => new Date("2026-08-05T00:05:00.000Z"),
    gh: fakeGh(new Map()),
  });
  assert.equal(extension.result.result.endUtcExclusive, extendedEnd);
  assert.equal(
    readdirSync(join(observationRoot(cwd), "interval-extensions")).length,
    1,
  );
  assert.doesNotThrow(() =>
    runInit(cwd, {
      end: extendedEnd,
      now: () => new Date("2026-08-05T00:06:00.000Z"),
      gh: fakeGh(new Map()),
    }),
  );
  assert.throws(
    () =>
      runInit(cwd, {
        end: END,
        now: () => new Date("2026-08-05T00:07:00.000Z"),
        gh: fakeGh(new Map()),
      }),
    /cannot shrink/,
  );
});

test("interval rejects a canonical terminal extension end that misses its filename", () => {
  const cwd = workspace();
  runInit(cwd);
  const extendedEnd = "2026-08-06T00:00:00.000Z";
  runInit(cwd, {
    end: extendedEnd,
    now: () => new Date("2026-08-05T00:05:00.000Z"),
    gh: fakeGh(new Map()),
  });
  const extensionRoot = join(observationRoot(cwd), "interval-extensions");
  const extensionPath = join(extensionRoot, readdirSync(extensionRoot)[0]);
  const extension = JSON.parse(readFileSync(extensionPath, "utf8"));
  extension.endUtcExclusive = "2026-08-07T00:00:00.000Z";
  writeFileSync(extensionPath, `${JSON.stringify(extension, null, 2)}\n`, {
    mode: 0o600,
  });
  assert.throws(
    () =>
      runVercelCostObservation({
        argv: ["sample-github"],
        cwd,
        now: () => new Date(CAPTURED_AT),
        gh: fakeGh(new Map()),
        stdout: output().stream,
      }),
    /extension filename conflicts with its end/,
  );
});

test("gh subprocess environment reads and forwards only its explicit safe allowlist", () => {
  const values = {
    PATH: "/fixture/bin",
    HOME: "/fixture/home",
    LANG: "C.UTF-8",
    GH_TOKEN: "do-not-read",
    GITHUB_TOKEN: "do-not-read",
    GH_ENTERPRISE_TOKEN: "do-not-read",
    GITHUB_ENTERPRISE_TOKEN: "do-not-read",
    GH_HOST: "example.invalid",
    OP_SERVICE_ACCOUNT_TOKEN: "do-not-read",
    VERCEL_TOKEN: "do-not-read",
    AWS_SECRET_ACCESS_KEY: "do-not-read",
  };
  const environment = new Proxy(values, {
    get(target, property, receiver) {
      if (
        [
          "GH_TOKEN",
          "GITHUB_TOKEN",
          "GH_ENTERPRISE_TOKEN",
          "GITHUB_ENTERPRISE_TOKEN",
          "GH_HOST",
          "OP_SERVICE_ACCOUNT_TOKEN",
          "VERCEL_TOKEN",
          "AWS_SECRET_ACCESS_KEY",
        ].includes(String(property))
      ) {
        throw new Error(
          `secret environment value was read: ${String(property)}`,
        );
      }
      return Reflect.get(target, property, receiver);
    },
  });
  const sanitized = environmentWithoutGhTokens(environment);
  assert.deepEqual(sanitized, {
    PATH: "/fixture/bin",
    HOME: "/fixture/home",
    LANG: "C.UTF-8",
  });
});

test("capture-preview freezes the canonical v2 journal and raw GitHub facts", () => {
  const cwd = workspace();
  runInit(cwd);
  const calls = [];
  const sink = output();
  const result = runVercelCostObservation({
    argv: ["capture-preview", "--pr", "700", "--event-run-id", "9001"],
    cwd,
    now: () => new Date(CAPTURED_AT),
    gh: fakeGh(previewRoutes(), calls),
    stdout: sink.stream,
  });
  assert.equal(result.exitCode, 0);
  const publicOutput = JSON.parse(sink.read());
  assert.deepEqual(Object.keys(publicOutput).sort(), [
    "command",
    "eventRunId",
    "evidenceComplete",
    "path",
    "schema",
    "status",
  ]);
  const directory = join(observationRoot(cwd), "preview", "9001");
  const capture = JSON.parse(
    readFileSync(join(directory, "capture.json"), "utf8"),
  );
  assert.equal(capture.schema, PREVIEW_CAPTURE_SCHEMA);
  assert.equal(capture.eventRunId, "9001");
  assert.equal(
    capture.canonicalDerivedFacts.journalSchema,
    "vercel-preview-journal:v2",
  );
  assert.equal(
    capture.canonicalDerivedFacts.eligibleTrustedDeployedCodePush,
    false,
  );
  assert.equal(capture.canonicalDerivedFacts.evidenceComplete, true);
  assert.deepEqual(capture.unresolvedProviderFields, [
    "vercelDeploymentCensus",
    "nativeDuplicateClassification",
    "buildCpuMinutes",
  ]);
  assert.equal(
    capture.canonicalDerivedFacts.observationReceiptSource,
    "live-journal",
  );
  assert.ok(
    capture.files.some((file) => file.path === "raw/journal-comment.json"),
  );
  assert.equal(
    capture.files.some((file) =>
      file.path.startsWith("raw/observation-receipt"),
    ),
    false,
  );
  assert.equal(
    calls.some(
      (args) =>
        args[0] === "api" &&
        args.some((value) => String(value).includes("/artifacts?per_page=100")),
    ),
    true,
  );
  assertPrivateTree(directory);
  assert.ok(calls.some((args) => args[0] === "auth"));
  assert.ok(
    calls
      .filter((args) => args[0] === "api")
      .every((args) => args[1] === "--hostname" && args[2] === "github.com"),
  );
  assert.ok(
    calls
      .filter((args) => args.includes("--repo"))
      .every(
        (args) =>
          args[args.indexOf("--repo") + 1] ===
          "github.com/mento-protocol/frontend-monorepo",
      ),
  );
});

test("capture-preview rejects a conflicting optional commit-status SHA", () => {
  const cwd = workspace();
  runInit(cwd);
  const event = fixture("preview-event.json");
  const routes = previewRoutes(event);
  const statusPages = routes.get(
    `api --method GET --paginate --slurp repos/mento-protocol/frontend-monorepo/commits/${event.head_sha}/statuses?per_page=100`,
  );
  statusPages[0][0].sha = "c".repeat(40);

  assert.throws(
    () =>
      runVercelCostObservation({
        argv: ["capture-preview", "--pr", "700", "--event-run-id", "9001"],
        cwd,
        now: () => new Date(CAPTURED_AT),
        gh: fakeGh(routes),
        stdout: output().stream,
      }),
    /Preview terminal status does not match the bot-owned controller decision/,
  );
  assert.equal(
    existsSync(join(observationRoot(cwd), "preview", "9001")),
    false,
  );
});

test("capture-preview rejects a deployment URL path mismatch", () => {
  const cwd = workspace();
  runInit(cwd);
  const sourceEvent = fixture("preview-event.json");
  const event = {
    ...sourceEvent,
    plan: {
      ...sourceEvent.plan,
      targets: ["ui"],
      reason: "affected-packages",
    },
  };
  const routes = previewRoutes(event);
  const statusPages = routes.get(
    "api --method GET --paginate --slurp repos/mento-protocol/frontend-monorepo/deployments/7001/statuses?per_page=100",
  );
  statusPages[0][0].environment_url =
    "https://ui-observation-fixture.vercel.app/another-path";

  assert.throws(
    () =>
      runVercelCostObservation({
        argv: ["capture-preview", "--pr", "700", "--event-run-id", "9001"],
        cwd,
        now: () => new Date(CAPTURED_AT),
        gh: fakeGh(routes),
        stdout: output().stream,
      }),
    /GitHub Deployment terminal status is missing or ambiguous/,
  );
  assert.equal(
    existsSync(join(observationRoot(cwd), "preview", "9001")),
    false,
  );
});

test("capture-preview normalizes whole-second GitHub REST timestamps", () => {
  const cwd = workspace();
  runInit(cwd);
  const result = runVercelCostObservation({
    argv: ["capture-preview", "--pr", "700", "--event-run-id", "9001"],
    cwd,
    now: () => new Date(CAPTURED_AT),
    gh: fakeGh(githubWholeSecondRoutes(previewRoutes())),
    stdout: output().stream,
  });

  assert.equal(result.exitCode, 0);
  const directory = join(observationRoot(cwd), "preview", "9001");
  const capture = JSON.parse(
    readFileSync(join(directory, "capture.json"), "utf8"),
  );
  const controllerRun = JSON.parse(
    readFileSync(join(directory, "raw", "controller-run.json"), "utf8"),
  );
  assert.equal(capture.eventTimestampUtc, "2026-07-29T01:00:01.000Z");
  assert.equal(controllerRun.created_at, "2026-07-29T01:00:01.000Z");
  assert.equal(controllerRun.updated_at, "2026-07-29T01:04:00.000Z");
});

test("capture-preview accepts a controller event for a non-main base", () => {
  const cwd = workspace();
  runInit(cwd);
  const event = {
    ...fixture("preview-event.json"),
    base_ref: "release/observation-fixture",
  };
  const result = runVercelCostObservation({
    argv: ["capture-preview", "--pr", "700", "--event-run-id", "9001"],
    cwd,
    now: () => new Date(CAPTURED_AT),
    gh: fakeGh(previewRoutes(event)),
    stdout: output().stream,
  });
  assert.equal(result.exitCode, 0);
});

test("capture-preview keeps boundary facts selection-bound", () => {
  const cwd = workspace();
  runInit(cwd);
  const sourceEvent = fixture("preview-event.json");
  const event = {
    ...sourceEvent,
    plan: {
      ...sourceEvent.plan,
      targets: ["ui"],
      reason: "affected-packages",
    },
  };
  const routes = previewRoutes(event);
  const deploymentPages = routes.get(
    `api --method GET --paginate --slurp repos/mento-protocol/frontend-monorepo/deployments?sha=${event.head_sha}&per_page=100`,
  );
  deploymentPages[0].push({
    id: 7_991,
    sha: event.head_sha,
    ref: event.head_sha,
    environment: `preview/ui/pr-${event.pr}`,
    payload: { provenance: "unrelated-same-sha-deployment" },
  });
  routes.set(
    "api --method GET --paginate --slurp repos/mento-protocol/frontend-monorepo/deployments/7991/statuses?per_page=100",
    [
      [
        {
          id: 7_992,
          state: "inactive",
          log_url: null,
          environment_url: null,
          created_at: "2026-08-05T00:00:30.000Z",
          creator: { type: "Bot", login: "github-actions[bot]" },
        },
      ],
    ],
  );
  const result = runVercelCostObservation({
    argv: ["capture-preview", "--pr", "700", "--event-run-id", "9001"],
    cwd,
    now: () => new Date(CAPTURED_AT),
    gh: fakeGh(routes),
    stdout: output().stream,
  });
  assert.equal(result.exitCode, 0);
  const capture = JSON.parse(
    readFileSync(
      join(observationRoot(cwd), "preview", "9001", "capture.json"),
      "utf8",
    ),
  );
  const rawDeployments = JSON.parse(
    readFileSync(
      join(observationRoot(cwd), "preview", "9001", "raw", "deployments.json"),
      "utf8",
    ),
  );
  assert.deepEqual(
    rawDeployments.map(({ deployment }) => String(deployment.id)),
    ["7001", "7991"],
  );
  assert.equal(rawDeployments[1].statuses[0].state, "inactive");
  assert.deepEqual(capture.canonicalDerivedFacts.githubDeploymentIds, ["7001"]);
  assert.deepEqual(
    capture.canonicalDerivedFacts.githubDeploymentTerminalStatuses.map(
      ({ statusId, createdAtUtc }) => ({ statusId, createdAtUtc }),
    ),
    [
      {
        statusId: "7002",
        createdAtUtc: "2026-07-29T01:03:00.000Z",
      },
    ],
  );

  seedAuditEligiblePreviewCaptures(cwd, 9);
  const controllerRun = routes.get(
    "api --method GET repos/mento-protocol/frontend-monorepo/actions/runs/9001",
  );
  const workerRun = routes.get(
    "api --method GET repos/mento-protocol/frontend-monorepo/actions/runs/8001/attempts/1",
  );
  runVercelCostObservation({
    argv: ["sample-github"],
    cwd,
    now: () => new Date(CAPTURED_AT),
    gh: fakeGh(githubSampleRoutes({ runs: [controllerRun, workerRun] })),
    stdout: output().stream,
  });
  const auditResult = runVercelCostObservation({
    argv: ["audit", "--end", END],
    cwd,
    now: () => new Date(CAPTURED_AT),
    gh: () => {
      throw new Error("audit must remain offline");
    },
    stdout: output().stream,
  });
  assert.equal(auditResult.exitCode, 1);
  const audit = JSON.parse(
    readFileSync(join(observationRoot(cwd), "audit.json"), "utf8"),
  );
  assert.deepEqual(audit.inventory.endBoundaryStraddlerIds, []);
  assert.equal(audit.gaps.includes("end-boundary-work-not-drained"), false);
});

test("capture-preview validates a controller-upgrade reselection chain", () => {
  const cwd = workspace();
  runInit(cwd);
  const { routes, fixtureState } = reselectedPreviewRoutes();
  const result = runVercelCostObservation({
    argv: ["capture-preview", "--pr", "700", "--event-run-id", "9001"],
    cwd,
    now: () => new Date(CAPTURED_AT),
    gh: fakeGh(routes),
    stdout: output().stream,
  });
  assert.equal(result.exitCode, 0);
  const capture = JSON.parse(
    readFileSync(
      join(observationRoot(cwd), "preview", "9001", "capture.json"),
      "utf8",
    ),
  );
  assert.deepEqual(capture.canonicalDerivedFacts.selectionKeys, [
    fixtureState.firstSelection.key_digest,
    fixtureState.replacementSelection.key_digest,
  ]);
  assert.deepEqual(capture.canonicalDerivedFacts.currentSelectionKeys, [
    fixtureState.replacementSelection.key_digest,
  ]);
  assert.equal(
    capture.canonicalDerivedFacts.capturedControllerSyntheticRuns[0]
      .terminalReason,
    "controller-workflow-upgraded-before-dispatch",
  );
  assert.equal(capture.canonicalDerivedFacts.capturedWorkers.length, 1);
});

test("a later controller event can remove a selection after the trusted base advances", () => {
  const event = {
    ...fixture("preview-event.json"),
    event_run_id: 9_006,
    event_run_number: 506,
    event_action: "closed",
    trusted_base_sha: "d".repeat(40),
    base_ref: "main",
  };
  const selection = {
    target: "ui",
    sha: "b".repeat(40),
    expected_workflow_sha: "a".repeat(40),
  };
  assert.equal(
    assertControllerSyntheticRunBinding({
      rawRun: {
        id: 9_006,
        run_number: event.event_run_number,
        name: "Vercel Preview Controller",
        path: ".github/workflows/vercel-preview-controller.yml",
        event: "pull_request_target",
        head_branch: event.head_ref,
        head_sha: event.head_sha,
        head_repository: {
          full_name: event.head_repository,
          url: `https://api.github.com/repos/${event.head_repository}`,
        },
        repository: { full_name: "mento-protocol/frontend-monorepo" },
        pull_requests: [],
        status: "completed",
        conclusion: "success",
        created_at: "2026-07-29T01:00:01.000Z",
        display_title: controllerEventRunName({
          runId: event.event_run_id,
          runNumber: event.event_run_number,
          pr: event.pr,
          sha: event.head_sha,
          before: event.before_sha,
          action: event.event_action,
          receiptRequired: true,
        }),
      },
      bindings: [
        {
          selection,
          result: { terminal_reason: "selection-removed-from-pr" },
        },
      ],
      selections: [selection],
      journal: { receipts: { events: [event] } },
    }),
    true,
  );
});

test("a real worker run cannot be reused across preview selection keys", () => {
  const reference = (keyDigest, kind = "worker") => ({
    kind,
    runId: "9005",
    attempt: 1,
    selection: { key_digest: keyDigest },
    result: { terminal_reason: "verified" },
  });
  assert.throws(
    () =>
      bindUniquePreviewReferences([
        reference("a".repeat(24)),
        reference("b".repeat(24)),
      ]),
    /worker run is reused across selection keys/,
  );
  assert.equal(
    bindUniquePreviewReferences([
      reference("a".repeat(24), "controller-synthetic"),
      reference("b".repeat(24), "controller-synthetic"),
    ])[0].bindings.length,
    2,
  );
});

test("capture-preview rejects a controller run on another candidate SHA", () => {
  const cwd = workspace();
  runInit(cwd);
  const routes = previewRoutes();
  const controllerRun = routes.get(
    "api --method GET repos/mento-protocol/frontend-monorepo/actions/runs/9001",
  );
  controllerRun.head_sha = "c".repeat(40);
  assert.throws(
    () =>
      runVercelCostObservation({
        argv: ["capture-preview", "--pr", "700", "--event-run-id", "9001"],
        cwd,
        now: () => new Date(CAPTURED_AT),
        gh: fakeGh(routes),
        stdout: output().stream,
      }),
    /Controller event head SHA mismatch/,
  );
});

test("capture-preview rejects a controller run on another candidate ref", () => {
  const cwd = workspace();
  runInit(cwd);
  const routes = previewRoutes();
  const controllerRun = routes.get(
    "api --method GET repos/mento-protocol/frontend-monorepo/actions/runs/9001",
  );
  controllerRun.head_branch = "feature/another-candidate";
  assert.throws(
    () =>
      runVercelCostObservation({
        argv: ["capture-preview", "--pr", "700", "--event-run-id", "9001"],
        cwd,
        now: () => new Date(CAPTURED_AT),
        gh: fakeGh(routes),
        stdout: output().stream,
      }),
    /conflicts with its event receipt/,
  );
});

test("capture-preview removes a dead stage after recovering an atomic hard-link prefix", () => {
  const cwd = workspace();
  runInit(cwd);
  const root = observationRoot(cwd);
  const staleStage = join(root, ".stage-preview-orphan-99999999-aaaaaaaaaaaa");
  const outside = workspace();
  const outsideFile = join(outside, "must-survive.txt");
  writeFileSync(outsideFile, "outside\n", { mode: 0o600 });
  mkdirSync(staleStage, { mode: 0o700 });
  chmodSync(staleStage, 0o700);
  const finalPath = join(staleStage, "fact.json");
  writeFileSync(finalPath, "{}\n", { mode: 0o600 });
  chmodSync(finalPath, 0o600);
  linkSync(
    finalPath,
    join(staleStage, ".atomic-write-fact.json--99999999-bbbbbbbbbbbb.tmp"),
  );
  symlinkSync(outside, join(staleStage, "outside-link"));
  const fifoPath = join(staleStage, "interrupted-download.fifo");
  execFileSync("mkfifo", [fifoPath]);
  assert.equal(lstatSync(finalPath).nlink, 2);

  runVercelCostObservation({
    argv: ["capture-preview", "--pr", "700", "--event-run-id", "9001"],
    cwd,
    now: () => new Date(CAPTURED_AT),
    gh: fakeGh(previewRoutes()),
    stdout: output().stream,
  });

  assert.equal(existsSync(staleStage), false);
  assert.equal(readFileSync(outsideFile, "utf8"), "outside\n");
});

test("capture-preview leaves no append-only capture while reconciliation is pending", () => {
  const cwd = workspace();
  runInit(cwd);
  assert.throws(
    () =>
      runVercelCostObservation({
        argv: ["capture-preview", "--pr", "700", "--event-run-id", "9001"],
        cwd,
        now: () => new Date(CAPTURED_AT),
        gh: fakeGh(previewRoutes(undefined, { mode: "pending" })),
        stdout: output().stream,
      }),
    /not terminal; retry/,
  );
  assert.equal(
    existsSync(join(observationRoot(cwd), "preview", "9001")),
    false,
  );
});

test("capture-preview recovers a compacted event from its immutable Actions artifact", () => {
  const cwd = workspace();
  runInit(cwd);
  const event = fixture("preview-event.json");
  const routes = previewRoutes(event, { observationArtifact: true });
  const compacted = compactPreviewJournal(
    previewJournalFixture(event, "complete").journal,
  );
  assert.equal(compacted.receipts.events.length, 0);
  routes.set(
    "api --method GET --paginate --slurp repos/mento-protocol/frontend-monorepo/issues/700/comments?per_page=100",
    [
      [
        {
          id: 301,
          user: { type: "Bot", login: "github-actions[bot]" },
          body: renderPreviewJournalBody(compacted),
        },
      ],
    ],
  );
  const result = runVercelCostObservation({
    argv: ["capture-preview", "--pr", "700", "--event-run-id", "9001"],
    cwd,
    now: () => new Date(CAPTURED_AT),
    gh: fakeGh(routes),
    stdout: output().stream,
  });
  assert.equal(result.exitCode, 0);
  const directory = join(observationRoot(cwd), "preview", "9001");
  const capture = JSON.parse(
    readFileSync(join(directory, "capture.json"), "utf8"),
  );
  assert.equal(
    capture.canonicalDerivedFacts.observationReceiptSource,
    "actions-artifact",
  );
  assert.ok(
    capture.files.some(
      (file) => file.path === "raw/observation-receipt-artifact.json",
    ),
  );
  assert.ok(
    capture.files.some((file) => file.path === "raw/observation-receipt.json"),
  );
});

test("capture-preview prefers an immutable artifact when a later push leaves the event live", () => {
  const cwd = workspace();
  runInit(cwd);
  const event = {
    ...fixture("preview-event.json"),
    plan: {
      targets: ["ui"],
      reason: "affected-packages",
      base: "a".repeat(40),
      head: "b".repeat(40),
      planner_source_sha: "a".repeat(40),
    },
  };
  const settled = previewJournalFixture(event, "complete");
  const laterEvent = {
    ...event,
    event_run_id: 9_003,
    event_run_number: 503,
    event_action: "synchronize",
    pr_updated_at: "2026-07-29T02:00:00.000Z",
    before_sha: event.head_sha,
    change_base_sha: event.head_sha,
    head_sha: "c".repeat(40),
    plan: {
      ...event.plan,
      base: event.head_sha,
      head: "c".repeat(40),
    },
  };
  const advanced = reconcileState({
    events: [event, laterEvent],
    results: settled.journal.receipts.results,
    selections: settled.journal.receipts.selections,
    pullRequest: pullFromEvent(laterEvent),
    existingState: settled.journal.state,
    controllerUrl:
      "https://github.com/mento-protocol/frontend-monorepo/actions/runs/9003",
    expectedWorkflowSha: laterEvent.trusted_base_sha,
  });
  assert.equal(advanced.nextDispatches.length, 1);
  assert.equal(
    advanced.state.targets.ui.latest_desired_sha,
    laterEvent.head_sha,
  );
  const retainedLiveJournal = createPreviewJournal({
    pr: event.pr,
    events: [event, laterEvent],
    selections: settled.journal.receipts.selections,
    workerEvidence: settled.journal.receipts.worker_evidence,
    results: settled.journal.receipts.results,
    state: advanced.state,
  });
  assert.ok(
    retainedLiveJournal.receipts.events.some(
      (candidate) => candidate.event_run_id === event.event_run_id,
    ),
  );

  const routes = previewRoutes(event, { observationArtifact: true });
  routes.set(
    "api --method GET --paginate --slurp repos/mento-protocol/frontend-monorepo/issues/700/comments?per_page=100",
    [
      [
        {
          id: 301,
          user: { type: "Bot", login: "github-actions[bot]" },
          body: renderPreviewJournalBody(retainedLiveJournal),
        },
      ],
    ],
  );
  const result = runVercelCostObservation({
    argv: ["capture-preview", "--pr", "700", "--event-run-id", "9001"],
    cwd,
    now: () => new Date(CAPTURED_AT),
    gh: fakeGh(routes),
    stdout: output().stream,
  });

  assert.equal(result.exitCode, 0);
  const directory = join(observationRoot(cwd), "preview", "9001");
  const capture = JSON.parse(
    readFileSync(join(directory, "capture.json"), "utf8"),
  );
  assert.equal(
    capture.canonicalDerivedFacts.observationReceiptSource,
    "actions-artifact",
  );
  assert.ok(
    capture.files.some(
      (file) => file.path === "raw/observation-receipt-artifact.json",
    ),
  );
  assert.ok(
    capture.files.some((file) => file.path === "raw/observation-receipt.json"),
  );
});

test("capture-preview fails closed when a compacted event has no retained artifact", () => {
  const cwd = workspace();
  runInit(cwd);
  const event = fixture("preview-event.json");
  const routes = previewRoutes(event);
  const compacted = compactPreviewJournal(
    previewJournalFixture(event, "complete").journal,
  );
  routes.set(
    "api --method GET --paginate --slurp repos/mento-protocol/frontend-monorepo/issues/700/comments?per_page=100",
    [
      [
        {
          id: 301,
          user: { type: "Bot", login: "github-actions[bot]" },
          body: renderPreviewJournalBody(compacted),
        },
      ],
    ],
  );
  const artifactName = "vercel-preview-observation-receipt-v1-9001";
  routes.set(
    "api --method GET --paginate --slurp repos/mento-protocol/frontend-monorepo/actions/runs/9001/artifacts?per_page=100",
    [{ artifacts: [] }],
  );
  routes.delete(
    `run download 9001 --repo mento-protocol/frontend-monorepo --name ${artifactName} --dir`,
  );
  assert.throws(
    () =>
      runVercelCostObservation({
        argv: ["capture-preview", "--pr", "700", "--event-run-id", "9001"],
        cwd,
        now: () => new Date(CAPTURED_AT),
        gh: fakeGh(routes),
        stdout: output().stream,
      }),
    /receipt artifact is missing or ambiguous/,
  );
  assert.equal(
    existsSync(join(observationRoot(cwd), "preview", "9001")),
    false,
  );
});

test("capture-preview rejects a terminal selection missing worker evidence", () => {
  const cwd = workspace();
  runInit(cwd);
  const event = {
    ...fixture("preview-event.json"),
    event_run_id: 9003,
    event_run_number: 503,
    plan: {
      targets: ["ui"],
      reason: "affected-packages",
      base: "a".repeat(40),
      head: "b".repeat(40),
      planner_source_sha: "a".repeat(40),
    },
  };
  assert.throws(
    () =>
      runVercelCostObservation({
        argv: ["capture-preview", "--pr", "700", "--event-run-id", "9003"],
        cwd,
        now: () => new Date(CAPTURED_AT),
        gh: fakeGh(previewRoutes(event, { mode: "missing-evidence" })),
        stdout: output().stream,
      }),
    /evidence\/result pairs are incomplete/,
  );
  assert.equal(
    existsSync(join(observationRoot(cwd), "preview", "9003")),
    false,
  );
});

test("capture-preview is append-only and detects raw-file conflicts", () => {
  const cwd = workspace();
  runInit(cwd);
  runVercelCostObservation({
    argv: ["capture-preview", "--pr", "700", "--event-run-id", "9001"],
    cwd,
    now: () => new Date(CAPTURED_AT),
    gh: fakeGh(previewRoutes()),
    stdout: output().stream,
  });
  const pullPath = join(
    observationRoot(cwd),
    "preview",
    "9001",
    "raw",
    "pull.json",
  );
  writeFileSync(pullPath, "{}\n", { mode: 0o600 });
  chmodSync(pullPath, 0o600);
  assert.throws(
    () =>
      runVercelCostObservation({
        argv: ["capture-preview", "--pr", "700", "--event-run-id", "9001"],
        cwd,
        now: () => new Date(CAPTURED_AT),
        gh: fakeGh(new Map()),
        stdout: output().stream,
      }),
    /extra, missing, or unlisted/,
  );
});

test("capture seal rejects an unlisted extra file", () => {
  const cwd = workspace();
  runInit(cwd);
  runVercelCostObservation({
    argv: ["capture-preview", "--pr", "700", "--event-run-id", "9001"],
    cwd,
    now: () => new Date(CAPTURED_AT),
    gh: fakeGh(previewRoutes()),
    stdout: output().stream,
  });
  const directory = join(observationRoot(cwd), "preview", "9001");
  writeFileSync(join(directory, "extra.json"), "{}\n", {
    mode: 0o600,
  });
  assert.throws(
    () =>
      runVercelCostObservation({
        argv: ["capture-preview", "--pr", "700", "--event-run-id", "9001"],
        cwd,
        now: () => new Date(CAPTURED_AT),
        gh: fakeGh(new Map()),
        stdout: output().stream,
      }),
    /extra, missing, or unlisted/,
  );
});

test("boundary state makes a carried PR synchronize its first eligible in-window opportunity", () => {
  const cwd = workspace();
  const priorEvent = {
    ...fixture("preview-event.json"),
    event_run_id: 8999,
    event_run_number: 499,
    pr_updated_at: "2026-07-28T23:30:00.000Z",
    head_sha: "a".repeat(40),
    plan: {
      targets: [],
      reason: "non-runtime-only",
      base: "a".repeat(40),
      head: "a".repeat(40),
      planner_source_sha: "a".repeat(40),
    },
  };
  const priorJournal = createPreviewJournal({
    pr: priorEvent.pr,
    events: [priorEvent],
  });
  const priorComment = {
    id: 299,
    user: { type: "Bot", login: "github-actions[bot]" },
    body: renderPreviewJournalBody(priorJournal),
  };
  const openPull = {
    number: 700,
    head: { sha: priorEvent.head_sha },
    updated_at: "2026-07-28T23:30:00.000Z",
  };
  runInit(cwd, {
    gh: fakeGh(
      boundaryRoutes({
        openPulls: [openPull],
        commentsByPr: new Map([[700, [priorComment]]]),
      }),
    ),
  });
  const boundary = JSON.parse(
    readFileSync(join(observationRoot(cwd), "boundary", "start.json"), "utf8"),
  );
  assert.equal(boundary.openPullRequestJournals[0].journal.revision, 1);
  assert.equal(
    boundary.openPullRequestJournals[0].journal.digest,
    priorJournal.journal_digest,
  );

  const event = {
    ...fixture("preview-event.json"),
    event_run_id: 9002,
    event_run_number: 502,
    event_action: "synchronize",
    pr_updated_at: "2026-07-29T02:00:00.000Z",
    before_sha: "a".repeat(40),
    change_base_sha: "a".repeat(40),
    plan: {
      targets: ["ui"],
      reason: "affected-packages",
      base: "a".repeat(40),
      head: "b".repeat(40),
      planner_source_sha: "a".repeat(40),
    },
  };
  const routes = previewRoutes(event, { events: [priorEvent, event] });
  runVercelCostObservation({
    argv: ["capture-preview", "--pr", "700", "--event-run-id", "9002"],
    cwd,
    now: () => new Date(CAPTURED_AT),
    gh: fakeGh(routes),
    stdout: output().stream,
  });
  const capture = JSON.parse(
    readFileSync(
      join(observationRoot(cwd), "preview", "9002", "capture.json"),
      "utf8",
    ),
  );
  assert.equal(capture.beforeSha, "a".repeat(40));
  const controllerRun = routes.get(
    "api --method GET repos/mento-protocol/frontend-monorepo/actions/runs/9002",
  );
  const sampleRoutes = githubSampleRoutes({
    runs: [controllerRun],
    jobsByRun: new Map([
      [
        "9002",
        [
          {
            id: 9300,
            run_attempt: 1,
            name: "Persist immutable PR event receipt",
            status: "completed",
            conclusion: "success",
            labels: ["ubuntu-latest"],
            started_at: "2026-07-29T02:00:10.000Z",
            completed_at: "2026-07-29T02:01:00.000Z",
          },
        ],
      ],
    ]),
  });
  runVercelCostObservation({
    argv: ["sample-github"],
    cwd,
    now: () => new Date(CAPTURED_AT),
    gh: fakeGh(sampleRoutes),
    stdout: output().stream,
  });
  seedAuditEligiblePreviewCaptures(cwd, 9);
  runVercelCostObservation({
    argv: ["audit", "--end", END],
    cwd,
    now: () => new Date(CAPTURED_AT),
    gh: fakeGh(new Map()),
    stdout: output().stream,
  });
  const audit = JSON.parse(
    readFileSync(join(observationRoot(cwd), "audit.json"), "utf8"),
  );
  assert.equal(audit.derived.eligibleFirstPreviewOpportunities, 10);
  const carriedOpportunity = audit.derived.firstPreviewOpportunities.find(
    (opportunity) => opportunity.pr === 700,
  );
  assert.equal(carriedOpportunity.eventAction, "synchronize");
  assert.equal(carriedOpportunity.carriedOpenAtBoundary, true);
  assert.equal(carriedOpportunity.carriedBoundaryHeadProof, true);
  assert.deepEqual(audit.derived.ambiguousFirstOpportunityPrs, []);
});

test("a carried PR excludes a synchronize receipt whose before SHA misses its boundary head", () => {
  const cwd = workspace();
  const priorEvent = {
    ...fixture("preview-event.json"),
    event_run_id: 8999,
    event_run_number: 499,
    pr_updated_at: "2026-07-28T23:30:00.000Z",
    head_sha: "a".repeat(40),
    plan: {
      targets: [],
      reason: "non-runtime-only",
      base: "a".repeat(40),
      head: "a".repeat(40),
      planner_source_sha: "a".repeat(40),
    },
  };
  const priorJournal = createPreviewJournal({
    pr: priorEvent.pr,
    events: [priorEvent],
  });
  runInit(cwd, {
    gh: fakeGh(
      boundaryRoutes({
        openPulls: [
          {
            number: 700,
            head: { sha: "c".repeat(40) },
            updated_at: "2026-07-28T23:40:00.000Z",
          },
        ],
        commentsByPr: new Map([
          [
            700,
            [
              {
                id: 299,
                user: { type: "Bot", login: "github-actions[bot]" },
                body: renderPreviewJournalBody(priorJournal),
              },
            ],
          ],
        ]),
      }),
    ),
  });
  const boundary = JSON.parse(
    readFileSync(join(observationRoot(cwd), "boundary", "start.json"), "utf8"),
  );
  assert.equal(
    boundary.openPullRequestJournals[0].preBoundaryEligiblePushEvidence,
    "unknown",
  );
  const event = {
    ...fixture("preview-event.json"),
    event_run_id: 9002,
    event_run_number: 502,
    event_action: "synchronize",
    pr_updated_at: "2026-07-29T02:00:00.000Z",
    before_sha: "a".repeat(40),
    change_base_sha: "a".repeat(40),
    plan: {
      targets: ["ui"],
      reason: "affected-packages",
      base: "a".repeat(40),
      head: "b".repeat(40),
      planner_source_sha: "a".repeat(40),
    },
  };
  const routes = previewRoutes(event, { events: [priorEvent, event] });
  runVercelCostObservation({
    argv: ["capture-preview", "--pr", "700", "--event-run-id", "9002"],
    cwd,
    now: () => new Date(CAPTURED_AT),
    gh: fakeGh(routes),
    stdout: output().stream,
  });
  const controllerRun = routes.get(
    "api --method GET repos/mento-protocol/frontend-monorepo/actions/runs/9002",
  );
  runVercelCostObservation({
    argv: ["sample-github"],
    cwd,
    now: () => new Date(CAPTURED_AT),
    gh: fakeGh(
      githubSampleRoutes({
        runs: [controllerRun],
        jobsByRun: new Map([
          [
            "9002",
            [
              {
                id: 9300,
                run_attempt: 1,
                name: "Persist immutable PR event receipt",
                status: "completed",
                conclusion: "success",
                labels: ["ubuntu-latest"],
                started_at: "2026-07-29T02:00:10.000Z",
                completed_at: "2026-07-29T02:01:00.000Z",
              },
            ],
          ],
        ]),
      }),
    ),
    stdout: output().stream,
  });
  seedAuditEligiblePreviewCaptures(cwd, 9);
  assert.throws(
    () =>
      runVercelCostObservation({
        argv: ["audit", "--end", END],
        cwd,
        now: () => new Date(CAPTURED_AT),
        gh: fakeGh(new Map()),
        stdout: output().stream,
      }),
    /ambiguous-first-preview-opportunities/,
  );
  assert.equal(existsSync(join(observationRoot(cwd), "audit.json")), false);
});

test("a drained pre-start controller receipt excludes a carried PR first preview", () => {
  const cwd = workspace();
  const priorEvent = {
    ...fixture("preview-event.json"),
    event_run_id: 8999,
    event_run_number: 499,
    pr_updated_at: "2026-07-28T23:30:00.000Z",
    head_sha: "a".repeat(40),
    plan: {
      targets: [],
      reason: "non-runtime-only",
      base: "a".repeat(40),
      head: "a".repeat(40),
      planner_source_sha: "a".repeat(40),
    },
  };
  const priorJournal = createPreviewJournal({
    pr: priorEvent.pr,
    events: [priorEvent],
  });
  runInit(cwd, {
    gh: fakeGh(
      boundaryRoutes({
        openPulls: [
          {
            number: 700,
            head: { sha: "a".repeat(40) },
            updated_at: "2026-07-28T23:30:00.000Z",
          },
        ],
        commentsByPr: new Map([
          [
            700,
            [
              {
                id: 299,
                user: { type: "Bot", login: "github-actions[bot]" },
                body: renderPreviewJournalBody(priorJournal),
              },
            ],
          ],
        ]),
      }),
    ),
  });
  const event = {
    ...fixture("preview-event.json"),
    event_run_id: 9002,
    event_run_number: 502,
    event_action: "synchronize",
    pr_updated_at: "2026-07-29T02:00:00.000Z",
    before_sha: "a".repeat(40),
    change_base_sha: "a".repeat(40),
    plan: {
      targets: ["ui"],
      reason: "affected-packages",
      base: "a".repeat(40),
      head: "b".repeat(40),
      planner_source_sha: "a".repeat(40),
    },
  };
  const routes = previewRoutes(event, { events: [priorEvent, event] });
  runVercelCostObservation({
    argv: ["capture-preview", "--pr", "700", "--event-run-id", "9002"],
    cwd,
    now: () => new Date(CAPTURED_AT),
    gh: fakeGh(routes),
    stdout: output().stream,
  });
  const controllerRun = routes.get(
    "api --method GET repos/mento-protocol/frontend-monorepo/actions/runs/9002",
  );
  const preStartControllerRun = {
    id: 8998,
    run_attempt: 1,
    path: ".github/workflows/vercel-preview-controller.yml",
    event: "pull_request_target",
    status: "completed",
    conclusion: "success",
    created_at: "2026-07-28T23:55:00.000Z",
    updated_at: "2026-07-28T23:58:00.000Z",
    head_sha: "a".repeat(40),
    head_branch: "main",
    display_title: controllerEventRunName({
      runId: 8998,
      runNumber: 498,
      pr: 700,
      sha: "a".repeat(40),
      action: "opened",
      receiptRequired: true,
    }),
    html_url:
      "https://github.com/mento-protocol/frontend-monorepo/actions/runs/8998",
  };
  runVercelCostObservation({
    argv: ["sample-github"],
    cwd,
    now: () => new Date(CAPTURED_AT),
    gh: fakeGh(
      githubSampleRoutes({
        runs: [controllerRun],
        preStartRuns: [preStartControllerRun],
        jobsByRun: new Map([
          [
            "9002",
            [
              {
                id: 9300,
                run_attempt: 1,
                name: "Persist immutable PR event receipt",
                status: "completed",
                conclusion: "success",
                labels: ["ubuntu-latest"],
                started_at: "2026-07-29T02:00:10.000Z",
                completed_at: "2026-07-29T02:01:00.000Z",
              },
            ],
          ],
        ]),
      }),
    ),
    stdout: output().stream,
  });
  seedAuditEligiblePreviewCaptures(cwd, 9);
  assert.throws(
    () =>
      runVercelCostObservation({
        argv: ["audit", "--end", END],
        cwd,
        now: () => new Date(CAPTURED_AT),
        gh: fakeGh(new Map()),
        stdout: output().stream,
      }),
    /ambiguous-first-preview-opportunities/,
  );
});

test("capture-main normalizes whole-second GitHub timestamps and records every attempt", () => {
  const cwd = workspace();
  runInit(cwd);
  const run = {
    id: 9100,
    run_attempt: 1,
    name: "Vercel Main Deployment",
    path: ".github/workflows/vercel-main-deployment.yml",
    event: "workflow_run",
    status: "completed",
    conclusion: "success",
    created_at: "2026-07-30T02:00:00Z",
    updated_at: "2026-07-30T02:12:00Z",
    head_branch: "main",
    head_sha: "c".repeat(40),
    html_url:
      "https://github.com/mento-protocol/frontend-monorepo/actions/runs/9100",
  };
  const job = {
    id: 9200,
    run_attempt: 1,
    name: "Vercel Main Deployment",
    status: "completed",
    conclusion: "success",
    labels: ["ubuntu-latest"],
    started_at: "2026-07-30T02:00:30.000Z",
    completed_at: "2026-07-30T02:11:30.000Z",
    steps: [
      {
        name: "Materialize no-target terminal artifacts without a journal",
        status: "completed",
        conclusion: "success",
      },
    ],
  };
  const upstreamRun = {
    id: 9090,
    run_attempt: 1,
    name: "CI/CD",
    path: ".github/workflows/ci.yml",
    event: "push",
    status: "completed",
    conclusion: "success",
    created_at: "2026-07-30T01:40:00Z",
    updated_at: "2026-07-30T01:59:00Z",
    head_branch: "main",
    head_sha: "c".repeat(40),
    html_url:
      "https://github.com/mento-protocol/frontend-monorepo/actions/runs/9090",
  };
  const routes = new Map([
    [
      "api --method GET repos/mento-protocol/frontend-monorepo/actions/runs/9100",
      run,
    ],
    [
      "api --method GET --paginate --slurp repos/mento-protocol/frontend-monorepo/actions/runs/9100/attempts/1/jobs?filter=all&per_page=100",
      [{ jobs: [job] }],
    ],
    [
      "run view 9100 --repo mento-protocol/frontend-monorepo --attempt 1 --log",
      Buffer.from("fixture main log\n"),
    ],
    [
      "api --method GET --paginate --slurp repos/mento-protocol/frontend-monorepo/actions/runs/9100/artifacts?per_page=100",
      [{ artifacts: [] }],
    ],
    [
      `api --method GET --paginate --slurp repos/mento-protocol/frontend-monorepo/actions/workflows/ci.yml/runs?branch=main&event=push&status=success&head_sha=${"c".repeat(40)}&per_page=100`,
      [{ workflow_runs: [upstreamRun] }],
    ],
    [
      "api --method GET repos/mento-protocol/frontend-monorepo/actions/runs/9090",
      upstreamRun,
    ],
  ]);
  const result = runVercelCostObservation({
    argv: ["capture-main", "--run-id", "9100"],
    cwd,
    now: () => new Date(CAPTURED_AT),
    gh: fakeGh(routes),
    stdout: output().stream,
  });
  assert.equal(result.exitCode, 0);
  const directory = join(observationRoot(cwd), "main", "9100", "attempt-1");
  const capture = JSON.parse(
    readFileSync(join(directory, "capture.json"), "utf8"),
  );
  const storedRun = JSON.parse(
    readFileSync(join(directory, "raw", "run.json"), "utf8"),
  );
  assert.equal(capture.schema, MAIN_CAPTURE_SCHEMA);
  assert.equal(capture.eventTimestampUtc, "2026-07-30T02:00:00.000Z");
  assert.equal(capture.runCompletedAtUtc, "2026-07-30T02:12:00.000Z");
  assert.equal(storedRun.created_at, "2026-07-30T02:00:00.000Z");
  assert.equal(storedRun.updated_at, "2026-07-30T02:12:00.000Z");
  assert.equal(capture.canonicalDerivedFacts.jobCount, 1);
  assert.equal(
    capture.canonicalDerivedFacts.terminalRoute.outcome,
    "no-target",
  );
  assert.equal(capture.canonicalDerivedFacts.githubEvidenceComplete, true);
  assert.deepEqual(capture.unresolvedProviderFields, [
    "publicRuntimeShaByTarget",
    "activeDuplicateDeploymentCensus",
    "legacyV2Health",
    "vercelDeploymentCensus",
    "buildCpuMinutes",
  ]);
  assert.equal(
    capture.canonicalDerivedFacts.terminalEvidenceV3.validated,
    false,
  );
  const probes = JSON.parse(
    readFileSync(join(directory, "probes.json"), "utf8"),
  );
  assert.equal(probes.complete, false);
  assertPrivateTree(directory);

  run.run_attempt = 2;
  run.updated_at = "2026-07-30T02:20:00Z";
  routes.set(
    "api --method GET --paginate --slurp repos/mento-protocol/frontend-monorepo/actions/runs/9100/attempts/2/jobs?filter=all&per_page=100",
    [
      {
        jobs: [
          {
            ...job,
            id: 9201,
            run_attempt: 2,
            started_at: "2026-07-30T02:13:00.000Z",
            completed_at: "2026-07-30T02:19:00.000Z",
          },
        ],
      },
    ],
  );
  routes.set(
    "run view 9100 --repo mento-protocol/frontend-monorepo --attempt 2 --log",
    Buffer.from("fixture main rerun log\n"),
  );
  const rerun = runVercelCostObservation({
    argv: ["capture-main", "--run-id", "9100"],
    cwd,
    now: () => new Date(CAPTURED_AT),
    gh: fakeGh(routes),
    stdout: output().stream,
  });
  assert.equal(rerun.result.attemptsCaptured, 2);
  assertPrivateTree(join(observationRoot(cwd), "main", "9100", "attempt-1"));
  assertPrivateTree(join(observationRoot(cwd), "main", "9100", "attempt-2"));
});

test("main terminal routes are mutually exclusive and bind required journal states", () => {
  const jobsFor = (...names) => [
    {
      steps: names.map((name) => ({
        name,
        status: "completed",
        conclusion: "success",
      })),
    },
  ];
  for (const [step, outcome] of [
    ["Materialize no-target terminal artifacts without a journal", "no-target"],
    [
      "Materialize superseded terminal artifacts without a journal",
      "superseded-before-journal",
    ],
    [
      "Materialize an already-current release terminal without a journal",
      "current-release-verified",
    ],
  ]) {
    const route = deriveMainTerminalRoute({
      jobs: jobsFor(step),
      journalHistories: [],
    });
    assert.equal(route.complete, true);
    assert.equal(route.outcome, outcome);
  }

  const recovered = deriveMainTerminalRoute({
    jobs: jobsFor("Materialize recovered or manual terminal artifacts"),
    journalHistories: [
      {
        transactionId: `main-${"d".repeat(32)}`,
        highestSequence: 7,
        highestStatus: "recovered",
      },
    ],
  });
  assert.equal(recovered.complete, true);
  assert.equal(recovered.outcome, "recovered");

  const recoveredCensusUnproven = deriveMainTerminalRoute({
    jobs: jobsFor(
      "Materialize recovered or manual terminal artifacts",
      "Mark recovered census-unproven terminal route",
    ),
    journalHistories: [
      {
        transactionId: `main-${"e".repeat(32)}`,
        highestSequence: 8,
        highestStatus: "recovered",
      },
    ],
  });
  assert.equal(recoveredCensusUnproven.complete, true);
  assert.equal(recoveredCensusUnproven.outcome, "recovered-census-unproven");

  const conflictingMarker = deriveMainTerminalRoute({
    jobs: jobsFor(
      "Materialize recovered or manual terminal artifacts",
      "Mark recovered census-unproven terminal route",
    ),
    journalHistories: [
      {
        transactionId: `main-${"f".repeat(32)}`,
        highestSequence: 9,
        highestStatus: "manual_intervention",
      },
    ],
  });
  assert.equal(conflictingMarker.complete, false);
  assert.equal(
    conflictingMarker.reason,
    "recovered-census-unproven-marker-conflict",
  );

  const missingCommittedJournal = deriveMainTerminalRoute({
    jobs: jobsFor("Materialize committed terminal artifacts"),
    journalHistories: [],
  });
  assert.equal(missingCommittedJournal.complete, false);
  assert.equal(missingCommittedJournal.reason, "committed-journal-missing");

  const ambiguous = deriveMainTerminalRoute({
    jobs: jobsFor(
      "Materialize no-target terminal artifacts without a journal",
      "Materialize superseded terminal artifacts without a journal",
    ),
    journalHistories: [],
  });
  assert.equal(ambiguous.complete, false);
  assert.equal(ambiguous.reason, "terminal-route-step-ambiguous");
});

test("main journal deploy SHA must match the workflow deployment SHA", () => {
  assert.equal(
    assertMainDeployShaBinding("a".repeat(40), "a".repeat(40)),
    "a".repeat(40),
  );
  assert.throws(
    () => assertMainDeployShaBinding("a".repeat(40), "b".repeat(40)),
    /does not match the workflow deployment SHA/,
  );
});

test("terminal sample coverage rejects omitted, duplicate, and extra boundary evidence", () => {
  const interval = { startUtc: START, endUtcExclusive: END };
  const startBoundary = {
    recordedAtUtc: INITIALIZED_AT,
    inFlightRuns: [{ id: "1" }],
  };
  const requiredWorkflowPaths = [
    ".github/workflows/vercel-preview-controller.yml",
  ];
  const completeUtcDayStarts = [
    "2026-07-29T00:00:00.000Z",
    "2026-07-30T00:00:00.000Z",
    "2026-07-31T00:00:00.000Z",
    "2026-08-01T00:00:00.000Z",
    "2026-08-02T00:00:00.000Z",
    "2026-08-03T00:00:00.000Z",
    "2026-08-04T00:00:00.000Z",
  ];
  const sample = {
    schema: GITHUB_SAMPLE_SCHEMA,
    capturedAtUtc: CAPTURED_AT,
    sampledThroughUtc: END,
    startBoundaryRunCoverage: {
      schema: "vercel-cost-start-boundary-run-coverage:v1",
      recordedAtUtc: INITIALIZED_AT,
      startUtc: START,
      complete: true,
      initialInFlightRunIds: ["1"],
      discoveredPreStartRunIds: ["2"],
      trackedRunIds: ["1", "2"],
    },
    startBoundaryRunStates: [
      { id: "1", createdAtUtc: "2026-07-28T23:40:00.000Z" },
      { id: "2", createdAtUtc: "2026-07-28T23:55:00.000Z" },
    ],
    runJobCoverage: {
      schema: "vercel-cost-github-run-job-coverage:v2",
      startUtc: START,
      endUtcExclusive: END,
      complete: true,
      workflowPaths: requiredWorkflowPaths,
      completeUtcDayStarts,
    },
  };
  const validate = (candidate) =>
    assertTerminalSampleCoverage({
      sample: candidate,
      startBoundary,
      interval,
      requiredWorkflowPaths,
    });
  assert.doesNotThrow(() => validate(sample));

  const badEarlier = structuredClone(sample);
  badEarlier.capturedAtUtc = "2026-08-05T00:00:00.000Z";
  badEarlier.startBoundaryRunCoverage.trackedRunIds = ["1"];
  const { latestSample: repairedLatest, terminalSamples } =
    selectLatestTerminalSample([badEarlier, sample], END);
  assert.equal(repairedLatest, sample);
  assert.equal(terminalSamples.length, 2);
  assert.doesNotThrow(() => validate(repairedLatest));

  const badLatest = structuredClone(badEarlier);
  badLatest.capturedAtUtc = "2026-08-05T00:02:00.000Z";
  const { latestSample: invalidLatest } = selectLatestTerminalSample(
    [sample, badLatest],
    END,
  );
  assert.throws(
    () => validate(invalidLatest),
    /does not match the expected IDs/,
  );

  const omitted = structuredClone(sample);
  omitted.startBoundaryRunCoverage.trackedRunIds = ["1"];
  assert.throws(() => validate(omitted), /does not match the expected IDs/);

  const duplicate = structuredClone(sample);
  duplicate.startBoundaryRunCoverage.trackedRunIds = ["1", "2", "2"];
  assert.throws(() => validate(duplicate), /must not contain duplicate IDs/);

  const extra = structuredClone(sample);
  extra.startBoundaryRunCoverage.trackedRunIds = ["1", "2", "3"];
  extra.startBoundaryRunStates.push({
    id: "3",
    createdAtUtc: "2026-07-28T23:56:00.000Z",
  });
  assert.throws(() => validate(extra), /does not match the expected IDs/);

  const coverageMismatch = structuredClone(sample);
  coverageMismatch.runJobCoverage.completeUtcDayStarts = [];
  assert.throws(
    () => validate(coverageMismatch),
    /run\/job coverage conflicts/,
  );
});

test("sample-github records visibility, runner labels, caches, and artifacts", () => {
  const cwd = workspace();
  runInit(cwd);
  const routes = githubSampleRoutes();
  const result = runVercelCostObservation({
    argv: ["sample-github"],
    cwd,
    now: () => new Date(CAPTURED_AT),
    gh: fakeGh(routes),
    stdout: output().stream,
  });
  assert.equal(result.exitCode, 0);
  const sampleName = readdirSync(join(observationRoot(cwd), "samples"))[0];
  const sample = JSON.parse(
    readFileSync(
      join(observationRoot(cwd), "samples", sampleName, "capture.json"),
      "utf8",
    ),
  );
  assert.equal(sample.schema, GITHUB_SAMPLE_SCHEMA);
  assert.equal(sample.repositoryVisibility.publicAtSample, true);
  assert.equal(sample.runJobCoverage.completeUtcDayStarts.length, 7);
  assert.equal(sample.runJobCoverage.endUtcExclusive, END);
  assert.equal(sample.cacheSnapshot.totalBytes, 1024);
  assert.equal(sample.artifactSnapshot.totalBytes, 2048);
  assertPrivateTree(join(observationRoot(cwd), "samples", sampleName));
});

test("sample-github accepts an init recorded exactly at the start boundary", () => {
  const cwd = workspace();
  runInit(cwd, { now: () => new Date(START) });
  runVercelCostObservation({
    argv: ["sample-github"],
    cwd,
    now: () => new Date(CAPTURED_AT),
    gh: fakeGh(githubSampleRoutes()),
    stdout: output().stream,
  });
  const sampleName = readdirSync(join(observationRoot(cwd), "samples"))[0];
  const sample = JSON.parse(
    readFileSync(
      join(observationRoot(cwd), "samples", sampleName, "capture.json"),
      "utf8",
    ),
  );
  assert.equal(sample.startBoundaryRunCoverage.recordedAtUtc, START);
  assert.deepEqual(
    sample.startBoundaryRunCoverage.discoveredPreStartRunIds,
    [],
  );
  assert.deepEqual(sample.startBoundaryRunStates, []);
});

test("audit rejects a GitHub sample whose sealed payload was edited", () => {
  const cwd = workspace();
  runInit(cwd);
  runVercelCostObservation({
    argv: ["sample-github"],
    cwd,
    now: () => new Date(CAPTURED_AT),
    gh: fakeGh(githubSampleRoutes()),
    stdout: output().stream,
  });
  const sampleName = readdirSync(join(observationRoot(cwd), "samples"))[0];
  const samplePath = join(
    observationRoot(cwd),
    "samples",
    sampleName,
    "capture.json",
  );
  const sample = JSON.parse(readFileSync(samplePath, "utf8"));
  sample.repositoryVisibility.publicAtSample = false;
  writeFileSync(samplePath, `${JSON.stringify(sample, null, 2)}\n`, {
    mode: 0o600,
  });

  assert.throws(
    () =>
      runVercelCostObservation({
        argv: ["audit", "--end", END],
        cwd,
        now: () => new Date(CAPTURED_AT),
        gh: () => {
          throw new Error("audit must remain offline");
        },
        stdout: output().stream,
      }),
    /seal does not match capture.json/,
  );
  assert.equal(existsSync(join(observationRoot(cwd), "freeze.json")), false);
  assert.doesNotThrow(() =>
    runVercelCostObservation({
      argv: ["sample-github"],
      cwd,
      now: () => new Date("2026-08-05T00:02:00.000Z"),
      gh: fakeGh(githubSampleRoutes()),
      stdout: output().stream,
    }),
  );
});

test("sample-github excludes an exact end-boundary run", () => {
  const cwd = workspace();
  runInit(cwd);
  const routes = githubSampleRoutes();
  const finalDayKey =
    "api --method GET --paginate --slurp repos/mento-protocol/frontend-monorepo/actions/workflows/vercel-preview-controller.yml/runs?per_page=100&created=2026-08-04T00%3A00%3A00.000Z..2026-08-04T23%3A59%3A59.999Z";
  routes.set(finalDayKey, [
    {
      total_count: 1,
      workflow_runs: [
        {
          id: 99_001,
          run_attempt: 1,
          path: ".github/workflows/vercel-preview-controller.yml",
          event: "pull_request_target",
          status: "completed",
          conclusion: "success",
          created_at: END,
          updated_at: END,
          head_sha: "a".repeat(40),
          head_branch: "main",
          display_title: "boundary fixture",
          html_url:
            "https://github.com/mento-protocol/frontend-monorepo/actions/runs/99001",
        },
      ],
    },
  ]);
  runVercelCostObservation({
    argv: ["sample-github"],
    cwd,
    now: () => new Date(CAPTURED_AT),
    gh: fakeGh(routes),
    stdout: output().stream,
  });
  const sampleName = readdirSync(join(observationRoot(cwd), "samples"))[0];
  const sample = JSON.parse(
    readFileSync(
      join(observationRoot(cwd), "samples", sampleName, "capture.json"),
      "utf8",
    ),
  );
  assert.deepEqual(sample.workflowRuns, []);
  assert.deepEqual(sample.runnerJobs, []);
});

test("sample-github rejects truncated daily and over-cap hourly shards", () => {
  const dailyKey =
    "api --method GET --paginate --slurp repos/mento-protocol/frontend-monorepo/actions/workflows/vercel-preview-controller.yml/runs?per_page=100&created=2026-07-29T00%3A00%3A00.000Z..2026-07-29T23%3A59%3A59.999Z";
  {
    const cwd = workspace();
    runInit(cwd);
    const routes = githubSampleRoutes();
    routes.set(dailyKey, [{ total_count: 1, workflow_runs: [] }]);
    assert.throws(
      () =>
        runVercelCostObservation({
          argv: ["sample-github"],
          cwd,
          now: () => new Date(CAPTURED_AT),
          gh: fakeGh(routes),
          stdout: output().stream,
        }),
      /shard is truncated/,
    );
  }
  {
    const cwd = workspace();
    runInit(cwd);
    const routes = githubSampleRoutes();
    routes.set(dailyKey, [{ total_count: 1_001, workflow_runs: [] }]);
    routes.set(
      "api --method GET --paginate --slurp repos/mento-protocol/frontend-monorepo/actions/workflows/vercel-preview-controller.yml/runs?per_page=100&created=2026-07-29T00%3A00%3A00.000Z..2026-07-29T00%3A59%3A59.999Z",
      [{ total_count: 1_001, workflow_runs: [] }],
    );
    assert.throws(
      () =>
        runVercelCostObservation({
          argv: ["sample-github"],
          cwd,
          now: () => new Date(CAPTURED_AT),
          gh: fakeGh(routes),
          stdout: output().stream,
        }),
      /hourly shard exceeds/,
    );
  }
});

test("audit writes a deterministic incomplete analyzer fragment and fails closed", () => {
  const cwd = workspace();
  runInit(cwd);
  seedAuditEligiblePreviewCaptures(cwd);
  const routes = githubSampleRoutes();
  runVercelCostObservation({
    argv: ["sample-github"],
    cwd,
    now: () => new Date(CAPTURED_AT),
    gh: fakeGh(routes),
    stdout: output().stream,
  });
  const sink = output();
  const result = runVercelCostObservation({
    argv: ["audit", "--end", END],
    cwd,
    now: () => new Date(CAPTURED_AT),
    gh: fakeGh(new Map()),
    stdout: sink.stream,
  });
  assert.equal(result.exitCode, 1);
  const audit = JSON.parse(
    readFileSync(join(observationRoot(cwd), "audit.json"), "utf8"),
  );
  assert.equal(audit.schema, OBSERVATION_AUDIT_SCHEMA);
  assert.equal(audit.pass, false);
  assert.equal(audit.analyzerFragmentComplete, false);
  assert.deepEqual(audit.inventory.missingGithubRunJobCoverageDays, []);
  assert.equal(
    audit.gaps.includes("missing-github-run-job-coverage-days"),
    false,
  );
  assert.ok(
    audit.gaps.includes("manual-provider-and-closeout-evidence-unresolved"),
  );
  const fragment = JSON.parse(
    readFileSync(
      join(
        observationRoot(cwd),
        "analyzer-postcutover-fragment.incomplete.json",
      ),
      "utf8",
    ),
  );
  assert.equal(fragment.complete, false);
  assert.equal(fragment.targets, null);
  assert.equal(
    JSON.parse(readFileSync(join(observationRoot(cwd), "freeze.json"), "utf8"))
      .schema,
    "vercel-cost-observation-freeze:v2",
  );
  assert.throws(
    () =>
      runVercelCostObservation({
        argv: ["sample-github"],
        cwd,
        now: () => new Date("2026-08-05T00:02:00.000Z"),
        gh: () => {
          throw new Error("frozen collection must reject before gh");
        },
        stdout: output().stream,
      }),
    /Observation is frozen/,
  );
  assert.throws(
    () =>
      runVercelCostObservation({
        argv: ["audit", "--end", END],
        cwd,
        now: () => new Date(CAPTURED_AT),
        gh: fakeGh(new Map()),
        stdout: output().stream,
      }),
    /audit already exists/,
  );
});

test("audit recovers when its deterministic fragment exists without the commit marker", () => {
  const cwd = workspace();
  runInit(cwd);
  seedAuditEligiblePreviewCaptures(cwd);
  runVercelCostObservation({
    argv: ["sample-github"],
    cwd,
    now: () => new Date(CAPTURED_AT),
    gh: fakeGh(githubSampleRoutes()),
    stdout: output().stream,
  });
  runVercelCostObservation({
    argv: ["audit", "--end", END],
    cwd,
    now: () => new Date(CAPTURED_AT),
    gh: () => {
      throw new Error("audit must remain offline");
    },
    stdout: output().stream,
  });
  const root = observationRoot(cwd);
  const auditPath = join(root, "audit.json");
  const fragmentPath = join(
    root,
    "analyzer-postcutover-fragment.incomplete.json",
  );
  const fragmentBytes = readFileSync(fragmentPath);
  unlinkSync(auditPath);

  const recovered = runVercelCostObservation({
    argv: ["audit", "--end", END],
    cwd,
    now: () => new Date("2026-08-05T00:02:00.000Z"),
    gh: () => {
      throw new Error("audit recovery must remain offline");
    },
    stdout: output().stream,
  });

  assert.equal(recovered.exitCode, 1);
  assert.deepEqual(readFileSync(fragmentPath), fragmentBytes);
  assert.equal(
    JSON.parse(readFileSync(auditPath, "utf8")).schema,
    OBSERVATION_AUDIT_SCHEMA,
  );
  assertPrivateTree(root);
});

test("audit rejects an early closeout without writing either output", () => {
  const cwd = workspace();
  runInit(cwd);
  assert.throws(
    () =>
      runVercelCostObservation({
        argv: ["audit", "--end", END],
        cwd,
        now: () => new Date("2026-08-04T23:59:59.999Z"),
        gh: () => {
          throw new Error("audit must remain offline");
        },
        stdout: output().stream,
      }),
    /cannot run before the interval ends/,
  );
  assert.equal(existsSync(join(observationRoot(cwd), "audit.json")), false);
  assert.equal(
    existsSync(
      join(
        observationRoot(cwd),
        "analyzer-postcutover-fragment.incomplete.json",
      ),
    ),
    false,
  );
});

test("audit reports explicit start and end boundary straddlers", () => {
  const cwd = workspace();
  const boundary = boundaryRoutes();
  const startRun = {
    id: 98_001,
    run_attempt: 1,
    path: ".github/workflows/vercel-preview-worker.yml",
    event: "workflow_dispatch",
    status: "requested",
    conclusion: null,
    created_at: "2026-07-28T23:59:00.000Z",
    updated_at: "2026-07-28T23:59:00.000Z",
    head_sha: "a".repeat(40),
    head_branch: "main",
    display_title: "boundary in-flight fixture",
    html_url:
      "https://github.com/mento-protocol/frontend-monorepo/actions/runs/98001",
  };
  boundary.set(
    "api --method GET --paginate --slurp repos/mento-protocol/frontend-monorepo/actions/runs?status=requested&per_page=100",
    [
      {
        workflow_runs: [startRun],
      },
    ],
  );
  runInit(cwd, { gh: fakeGh(boundary) });
  const endRun = {
    id: 98_002,
    run_attempt: 1,
    path: ".github/workflows/vercel-main-deployment.yml",
    event: "workflow_run",
    status: "completed",
    conclusion: "success",
    created_at: "2026-08-04T23:00:00.000Z",
    updated_at: "2026-08-05T00:01:00.000Z",
    head_sha: "b".repeat(40),
    head_branch: "main",
    display_title: "end straddler fixture",
    html_url:
      "https://github.com/mento-protocol/frontend-monorepo/actions/runs/98002",
  };
  const sampleRoutes = githubSampleRoutes({
    runs: [endRun],
    startBoundaryRunStates: [
      {
        ...startRun,
        status: "completed",
        conclusion: "success",
        updated_at: "2026-07-29T00:00:30.000Z",
      },
    ],
    jobsByRun: new Map([
      [
        "98002",
        [
          {
            id: 98_003,
            run_attempt: 1,
            name: "straddling job",
            status: "completed",
            conclusion: "success",
            labels: ["ubuntu-latest"],
            started_at: "2026-08-04T23:05:00.000Z",
            completed_at: "2026-08-05T00:00:30.000Z",
          },
        ],
      ],
    ]),
  });
  runVercelCostObservation({
    argv: ["sample-github"],
    cwd,
    now: () => new Date("2026-08-05T00:01:30.000Z"),
    gh: fakeGh(sampleRoutes),
    stdout: output().stream,
  });
  assert.throws(
    () =>
      runVercelCostObservation({
        argv: ["audit", "--end", END],
        cwd,
        now: () => new Date("2026-08-05T00:02:00.000Z"),
        gh: () => {
          throw new Error("audit must remain offline");
        },
        stdout: output().stream,
      }),
    /end-boundary-work-not-drained.*start-boundary-work-not-drained|start-boundary-work-not-drained.*end-boundary-work-not-drained/,
  );
  assert.equal(existsSync(join(observationRoot(cwd), "freeze.json")), false);
  assert.equal(existsSync(join(observationRoot(cwd), "audit.json")), false);
});

test("a start-boundary run completed before start clears on the terminal sample", () => {
  const cwd = workspace();
  const startRun = {
    id: 98_101,
    run_attempt: 1,
    path: ".github/workflows/vercel-preview-worker.yml",
    event: "workflow_dispatch",
    status: "requested",
    conclusion: null,
    created_at: "2026-07-28T23:50:00.000Z",
    updated_at: "2026-07-28T23:50:00.000Z",
    head_sha: "c".repeat(40),
    head_branch: "main",
    display_title: "pre-start drain fixture",
    html_url:
      "https://github.com/mento-protocol/frontend-monorepo/actions/runs/98101",
  };
  const boundary = boundaryRoutes();
  boundary.set(
    "api --method GET --paginate --slurp repos/mento-protocol/frontend-monorepo/actions/runs?status=requested&per_page=100",
    [{ workflow_runs: [startRun] }],
  );
  runInit(cwd, { gh: fakeGh(boundary) });
  seedAuditEligiblePreviewCaptures(cwd);
  const drained = {
    ...startRun,
    status: "completed",
    conclusion: "success",
    updated_at: "2026-07-28T23:55:00.000Z",
  };
  const discoveredAndDrained = {
    id: 98_102,
    run_attempt: 1,
    path: ".github/workflows/vercel-preview-controller.yml",
    event: "pull_request_target",
    status: "completed",
    conclusion: "success",
    created_at: "2026-07-28T23:55:00.000Z",
    updated_at: "2026-07-28T23:58:00.000Z",
    head_sha: "d".repeat(40),
    head_branch: "main",
    display_title: "post-init pre-start drain fixture",
    html_url:
      "https://github.com/mento-protocol/frontend-monorepo/actions/runs/98102",
  };
  runVercelCostObservation({
    argv: ["sample-github"],
    cwd,
    now: () => new Date(CAPTURED_AT),
    gh: fakeGh(
      githubSampleRoutes({
        preStartRuns: [discoveredAndDrained],
        startBoundaryRunStates: [drained],
      }),
    ),
    stdout: output().stream,
  });
  runVercelCostObservation({
    argv: ["audit", "--end", END],
    cwd,
    now: () => new Date(CAPTURED_AT),
    gh: () => {
      throw new Error("audit must remain offline");
    },
    stdout: output().stream,
  });
  const audit = JSON.parse(
    readFileSync(join(observationRoot(cwd), "audit.json"), "utf8"),
  );
  assert.deepEqual(audit.inventory.startBoundaryStraddlerIds, []);
  assert.deepEqual(
    audit.inventory.startBoundaryRunStates.map((run) => run.id),
    ["98101", "98102"],
  );
  assert.equal(
    audit.inventory.startBoundaryRunStates[0].updatedAtUtc,
    "2026-07-28T23:55:00.000Z",
  );
  assert.equal(audit.gaps.includes("start-boundary-work-not-drained"), false);
});

test("a post-init pre-start workflow run that crosses start fails the boundary drain", () => {
  const cwd = workspace();
  runInit(cwd);
  const crossingRun = {
    id: 98_201,
    run_attempt: 1,
    path: ".github/workflows/vercel-preview-controller.yml",
    event: "pull_request_target",
    status: "completed",
    conclusion: "success",
    created_at: "2026-07-28T23:55:00.000Z",
    updated_at: "2026-07-29T00:00:01.000Z",
    head_sha: "e".repeat(40),
    head_branch: "main",
    display_title: "post-init start crossing fixture",
    html_url:
      "https://github.com/mento-protocol/frontend-monorepo/actions/runs/98201",
  };
  runVercelCostObservation({
    argv: ["sample-github"],
    cwd,
    now: () => new Date(CAPTURED_AT),
    gh: fakeGh(githubSampleRoutes({ preStartRuns: [crossingRun] })),
    stdout: output().stream,
  });
  const sampleName = readdirSync(join(observationRoot(cwd), "samples"))[0];
  const sample = JSON.parse(
    readFileSync(
      join(observationRoot(cwd), "samples", sampleName, "capture.json"),
      "utf8",
    ),
  );
  assert.deepEqual(sample.startBoundaryRunCoverage.discoveredPreStartRunIds, [
    "98201",
  ]);
  assert.deepEqual(sample.startBoundaryRunCoverage.initialInFlightRunIds, []);
  assert.deepEqual(sample.workflowRuns, []);
  assert.throws(
    () =>
      runVercelCostObservation({
        argv: ["audit", "--end", END],
        cwd,
        now: () => new Date(CAPTURED_AT),
        gh: () => {
          throw new Error("audit must remain offline");
        },
        stdout: output().stream,
      }),
    /start-boundary-work-not-drained/,
  );
  assert.equal(existsSync(join(observationRoot(cwd), "audit.json")), false);
});

test("audit does not classify an unstarted skipped job as an unknown runner", () => {
  const cwd = workspace();
  runInit(cwd);
  const run = {
    id: 98_301,
    run_attempt: 1,
    path: ".github/workflows/vercel-main-deployment.yml",
    event: "workflow_run",
    status: "completed",
    conclusion: "success",
    created_at: "2026-07-30T02:00:00.000Z",
    updated_at: "2026-07-30T02:01:00.000Z",
    head_sha: "f".repeat(40),
    head_branch: "main",
    display_title: "skipped runner-label fixture",
    html_url:
      "https://github.com/mento-protocol/frontend-monorepo/actions/runs/98301",
  };
  runVercelCostObservation({
    argv: ["sample-github"],
    cwd,
    now: () => new Date(CAPTURED_AT),
    gh: fakeGh(
      githubSampleRoutes({
        runs: [run],
        jobsByRun: new Map([
          [
            "98301",
            [
              {
                id: 98_302,
                run_attempt: 1,
                name: "conditionally skipped job",
                status: "completed",
                conclusion: "skipped",
                labels: [],
                started_at: null,
                completed_at: null,
              },
            ],
          ],
        ]),
      }),
    ),
    stdout: output().stream,
  });
  assert.throws(
    () =>
      runVercelCostObservation({
        argv: ["audit", "--end", END],
        cwd,
        now: () => new Date(CAPTURED_AT),
        gh: () => {
          throw new Error("audit must remain offline");
        },
        stdout: output().stream,
      }),
    (error) => {
      assert.match(error.message, /missing-main-captures/);
      assert.doesNotMatch(error.message, /unknown-runner-labels/);
      return true;
    },
  );
});
