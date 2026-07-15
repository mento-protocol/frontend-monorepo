import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { parse } from "yaml";

function read(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

function workflow(relativePath) {
  return parse(read(relativePath));
}

const controllerPath = ".github/workflows/vercel-preview-controller.yml";
const workerPath = ".github/workflows/vercel-preview-worker.yml";

const controller = workflow(controllerPath);
const worker = workflow(workerPath);

function permissionWrites(job) {
  return Object.entries(job.permissions ?? {}).some(
    ([, access]) => access === "write",
  );
}

test("controller has only the three specified recovery-aware triggers", () => {
  assert.deepEqual(Object.keys(controller.on), [
    "pull_request_target",
    "workflow_run",
    "workflow_dispatch",
  ]);
  assert.deepEqual(controller.on.pull_request_target.types, [
    "opened",
    "synchronize",
    "reopened",
    "closed",
  ]);
  assert.deepEqual(controller.on.workflow_run, {
    workflows: ["Vercel Preview Worker"],
    types: ["completed"],
  });
  assert.deepEqual(controller.on.workflow_dispatch.inputs.operation.options, [
    "reconcile",
    "bootstrap",
  ]);
  assert.deepEqual(controller.permissions, {});
});

test("planner executes only immutable trusted-base code with a read token", () => {
  for (const jobName of ["plan-event", "plan-bootstrap"]) {
    const job = controller.jobs[jobName];
    assert.deepEqual(job.permissions, { contents: "read" });
    const raw = JSON.stringify(job);
    assert.match(raw, /trusted_base_sha/);
    assert.match(raw, /fetch-depth.*0/);
    assert.match(raw, /persist-credentials.*false/);
    assert.match(raw, /pnpm install --ignore-scripts --frozen-lockfile/);
    assert.match(raw, /plan-vercel-deployments\.mjs/);
    assert.doesNotMatch(raw, /secrets\.|VERCEL_TOKEN|TURBO_TOKEN/);
  }
});

test("immutable receipt writers are durable and outside lossy reconciliation concurrency", () => {
  const expected = {
    contents: "read",
    issues: "write",
    "pull-requests": "read",
    statuses: "write",
  };
  for (const jobName of ["receipt-event", "receipt-bootstrap"]) {
    const job = controller.jobs[jobName];
    assert.deepEqual(job.permissions, expected);
    assert.equal(Object.hasOwn(job, "concurrency"), false);
    assert.match(JSON.stringify(job), /recordEventReceipt/);
  }
  for (const jobName of [
    "reconcile-event",
    "reconcile-bootstrap",
    "reconcile-manual",
    "recover-worker-result",
  ]) {
    assert.match(
      controller.jobs[jobName].concurrency.group,
      /^vercel-preview-controller-pr-/,
    );
    assert.equal(
      controller.jobs[jobName].concurrency["cancel-in-progress"],
      false,
    );
  }
});

test("every controller write-token job checks out only trusted workflow code", () => {
  for (const [jobName, job] of Object.entries(controller.jobs)) {
    if (!permissionWrites(job)) continue;
    const checkout = job.steps?.find((step) =>
      String(step.uses ?? "").startsWith("actions/checkout@"),
    );
    assert.ok(checkout, `${jobName} must check out trusted controller code`);
    assert.equal(checkout.with.ref, "${{ github.workflow_sha }}");
    assert.equal(checkout.with["persist-credentials"], false);
    assert.doesNotMatch(JSON.stringify(job), /pull_request\.head\.sha/);
  }
  assert.doesNotMatch(
    read(controllerPath),
    /secrets\.|VERCEL_TOKEN|TURBO_TOKEN|TURBO_REMOTE_CACHE_SIGNATURE_KEY/,
  );
});

test("worker is dispatch-only with strict identity inputs and one literal UI caller", () => {
  assert.deepEqual(Object.keys(worker.on), ["workflow_dispatch"]);
  assert.deepEqual(Object.keys(worker.on.workflow_dispatch.inputs), [
    "pull_request_number",
    "target",
    "commit_sha",
    "git_branch",
    "controller_key",
    "controller_key_digest",
    "epoch_anchor_run_id",
    "reconciliation_basis_digest",
    "selection_receipt_run_id",
  ]);
  assert.match(worker["run-name"], /pr=.*target=.*sha=.*key=/);
  assert.deepEqual(worker.permissions, {});
  assert.equal(worker.concurrency["cancel-in-progress"], false);

  const callers = Object.values(worker.jobs).filter((job) => job.uses);
  assert.equal(callers.length, 1);
  const caller = callers[0];
  assert.equal(caller.uses, "./.github/workflows/_vercel-prebuilt.yml");
  assert.equal(caller.with.logical_target, "ui");
  assert.equal(caller.with.workspace_package, "ui.mento.org");
  assert.equal(
    caller.with.vercel_project_id,
    "${{ vars.VERCEL_PROJECT_ID_UI }}",
  );
  assert.equal(
    caller.with.github_environment,
    "preview/ui/pr-${{ inputs.pull_request_number }}",
  );
  assert.deepEqual(Object.keys(caller.secrets), [
    "turbo_remote_cache_signature_key",
    "turbo_token",
    "vercel_token",
  ]);
  assert.doesNotMatch(
    JSON.stringify(caller),
    /secrets:\s*inherit|VERCEL_PROJECT_ID_(?!UI)/,
  );
});

test("worker credentials are unreachable until trusted validation and named preflight pass", () => {
  const validation = worker.jobs["validate-controller-ownership"];
  assert.deepEqual(validation.permissions, {
    contents: "read",
    deployments: "read",
    issues: "read",
    "pull-requests": "read",
  });
  assert.doesNotMatch(JSON.stringify(validation), /secrets\./);

  const preflight = worker.jobs["validate-preview-prerequisites"];
  assert.deepEqual(preflight.permissions, {});
  assert.equal(preflight.needs, "validate-controller-ownership");
  assert.match(JSON.stringify(preflight), /Missing required repository names/);
  assert.equal(Object.hasOwn(preflight, "uses"), false);

  const caller = worker.jobs["deploy-ui-preview"];
  assert.deepEqual(caller.needs, [
    "validate-controller-ownership",
    "validate-preview-prerequisites",
  ]);
  assert.deepEqual(caller.permissions, {
    contents: "read",
    deployments: "write",
  });
  assert.doesNotMatch(
    JSON.stringify(caller.permissions),
    /issues|actions|statuses|pull-requests/,
  );

  const resumedSmoke = worker.jobs["resume-ui-smoke"];
  assert.deepEqual(resumedSmoke.permissions, { contents: "read" });
  assert.doesNotMatch(
    JSON.stringify(resumedSmoke),
    /secrets\.|VERCEL_TOKEN|TURBO_TOKEN|TURBO_REMOTE_CACHE_SIGNATURE_KEY/,
  );
  assert.match(
    JSON.stringify(resumedSmoke),
    /vercel-prebuilt-workflow\.mjs.*smoke/,
  );
  assert.equal(resumedSmoke["runs-on"], "ubuntu-latest");
  const resumeSteps = resumedSmoke.steps;
  const resumeCheckout = resumeSteps[0];
  assert.equal(resumeCheckout.with.path, "controller");
  assert.equal(resumeCheckout.with.ref, "${{ github.workflow_sha }}");
  assert.equal(resumeCheckout.with["persist-credentials"], false);
  const resumeInstall = resumeSteps.find(
    ({ name }) => name === "Install trusted browser smoke dependencies",
  );
  assert.equal(resumeInstall["working-directory"], "controller");
  assert.equal(resumeInstall.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD, "1");
  assert.match(resumeInstall.run, /--frozen-lockfile/);
  assert.match(resumeInstall.run, /--ignore-scripts/);
  const resumeBrowser = resumeSteps.find(
    ({ name }) => name === "Re-run browser interaction in system Chrome",
  );
  assert.match(
    resumeBrowser.run,
    /apps\/ui\.mento\.org\/e2e\/vercel-preview-browser-smoke\.mjs/,
  );
  assert.equal(
    resumeBrowser.env.DEPLOYMENT_IDEMPOTENCY_KEY,
    "${{ inputs.controller_key }}",
  );
  assert.ok(
    resumeSteps.indexOf(resumeInstall) < resumeSteps.indexOf(resumeBrowser),
  );

  const evidence = worker.jobs["record-worker-evidence"];
  assert.match(JSON.stringify(evidence), /recordWorkerEvidence/);
  assert.doesNotMatch(JSON.stringify(evidence), /secrets\./);
});

test("Statuses API owns the reserved name and no workflow job shadows it", () => {
  for (const parsed of [controller, worker]) {
    for (const job of Object.values(parsed.jobs)) {
      assert.notEqual(job.name, "Vercel Preview");
    }
  }
  const implementation = read("scripts/vercel-preview-controller.mjs");
  assert.match(implementation, /PREVIEW_STATUS_CONTEXT = "Vercel Preview"/);
  assert.match(implementation, /createCommitStatus/);
});

test("completed-worker recovery is authoritative for missing and orphaned Deployments", () => {
  const recovery = controller.jobs["recover-worker-result"];
  assert.deepEqual(recovery.permissions, {
    actions: "write",
    contents: "read",
    deployments: "write",
    issues: "write",
    "pull-requests": "read",
    statuses: "write",
  });
  assert.match(JSON.stringify(recovery), /recoverWorkerResult/);
  assert.match(JSON.stringify(recovery), /reconcilePreview/);
  const implementation = read("scripts/vercel-preview-controller.mjs");
  for (const conclusion of ["success", "failure", "cancelled"]) {
    assert.match(implementation, new RegExp(conclusion));
  }
  assert.match(implementation, /createRecoveryDeployment/);
  assert.match(implementation, /terminalizeDeployment/);
});

test("controller and worker remain intentionally outside operational failure issues", () => {
  const notifier = read(".github/workflows/ci-failure-notifier.yml");
  assert.doesNotMatch(notifier, /Vercel Preview Controller/);
  assert.doesNotMatch(notifier, /Vercel Preview Worker/);
  assert.doesNotMatch(notifier, /vercel-preview-(?:controller|worker)\.yml/);
});

test("automatic workflow creates no implicit or Vercel-owned Deployment", () => {
  const raw = `${read(controllerPath)}\n${read(workerPath)}`;
  assert.doesNotMatch(raw, /githubDeployment=1|secrets:\s*inherit/);
  for (const job of Object.values(worker.jobs)) {
    assert.equal(Object.hasOwn(job, "environment"), false);
  }
  assert.match(
    worker.jobs["deploy-ui-preview"].with.deployment_idempotency_key,
    /inputs\.controller_key/,
  );
});

test("runbook covers bootstrap, canaries, browser proof, separate cutover, and exact rollback", () => {
  const docs = read("docs/vercel-deployments.md");
  for (const expected of [
    "operation=bootstrap",
    "operation=reconcile",
    "Phase A canary evidence template",
    "repository browser protocol",
    "UI Vercel Git cutover (Phase B)",
    '"**": false',
    '"main": true',
    '"dependabot/**": false',
    "SHA",
  ]) {
    assert.match(
      docs,
      new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  }
});
