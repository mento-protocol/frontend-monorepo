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
const intakePath = ".github/workflows/vercel-preview-intake.yml";
const workerPath = ".github/workflows/vercel-preview-worker.yml";

const controller = workflow(controllerPath);
const intake = workflow(intakePath);
const worker = workflow(workerPath);

function permissionWrites(job) {
  return Object.entries(job.permissions ?? {}).some(
    ([, access]) => access === "write",
  );
}

function controllerTitleReceiptRequired({
  action = "opened",
  author = "trusted-author",
  headRef = "feature/preview-controller",
  baseChanged = false,
} = {}) {
  // GitHub Actions string comparisons and startsWith() are case-insensitive.
  const normalizedAuthor = author.toLowerCase();
  const normalizedHeadRef = headRef.toLowerCase();
  return (
    normalizedAuthor !== "dependabot[bot]" &&
    normalizedHeadRef !== "dependabot" &&
    !normalizedHeadRef.startsWith("dependabot/") &&
    (action !== "edited" || baseChanged)
  );
}

function queuedStateConcurrency(prExpression) {
  return {
    group: `vercel-preview-state-pr-${prExpression}`,
    "cancel-in-progress": false,
    queue: "max",
  };
}

const serializedControllerMutations = [
  ["receipt-event", "${{ needs.snapshot-event.outputs.pr_number }}"],
  ["reconcile-event", "${{ needs.receipt-event.outputs.pr_number }}"],
  ["receipt-bootstrap", "${{ needs.snapshot-bootstrap.outputs.pr_number }}"],
  ["reconcile-bootstrap", "${{ needs.receipt-bootstrap.outputs.pr_number }}"],
  ["reconcile-request", "${{ needs.validate-request.outputs.pr_number }}"],
  [
    "publish-dependabot-unsupported",
    "${{ needs.identify-dependabot-intake.outputs.pr_number }}",
  ],
  [
    "recover-worker-result",
    "${{ needs.identify-worker-result.outputs.pr_number }}",
  ],
];

test("controller has only the three specified recovery-aware triggers", () => {
  assert.deepEqual(Object.keys(controller.on), [
    "pull_request_target",
    "repository_dispatch",
    "workflow_run",
  ]);
  assert.deepEqual(controller.on.pull_request_target.types, [
    "opened",
    "edited",
    "synchronize",
    "reopened",
    "closed",
  ]);
  assert.deepEqual(controller.on.workflow_run, {
    workflows: ["Vercel Preview Worker", "Vercel Preview Intake"],
    types: ["completed"],
  });
  assert.deepEqual(controller.on.repository_dispatch.types, [
    "vercel-preview-bootstrap",
    "vercel-preview-reconcile",
  ]);
  assert.deepEqual(controller.permissions, {});
  assert.equal(
    controller["run-name"],
    [
      "${{ github.event_name == 'pull_request_target' &&",
      "format('Vercel preview controller event | id={0} | number={1} | pr={2} | sha={3} | before={4} | action={5} | receipt={6}', github.run_id, github.run_number, github.event.pull_request.number, github.event.pull_request.head.sha, github.event.action == 'synchronize' && github.event.before || 'none', github.event.action, github.event.pull_request.user.login != 'dependabot[bot]' && github.event.pull_request.head.ref != 'dependabot' && !startsWith(github.event.pull_request.head.ref, 'dependabot/') && (github.event.action != 'edited' || github.event.changes.base != null)) ||",
      "format('Vercel Preview Controller | event={0} | id={1}', github.event_name, github.run_id) }}",
    ].join(" "),
  );
  assert.match(
    controller.jobs["snapshot-event"].if,
    /action != 'edited'.*changes\.base != null/,
  );
  const raw = read(controllerPath);
  assert.match(raw, /runNumber:\s*context\.runNumber/);
  assert.doesNotMatch(raw, /workflow_dispatch|\binputs\./);
});

test("controller run title marks exactly the receipt-producing PR events", () => {
  const cases = [
    ["Dependabot author", { author: "dependabot[bot]" }, false],
    ["exact Dependabot ref", { headRef: "dependabot" }, false],
    ["Dependabot ref prefix", { headRef: "dependabot/npm/pnpm" }, false],
    [
      "mixed-case Dependabot ref prefix",
      { headRef: "Dependabot/npm/pnpm" },
      false,
    ],
    ["trusted branch", {}, true],
    ["fork branch", { headRef: "contributor/change" }, true],
    ["unsupported ref", { headRef: "refs/change" }, true],
    ["unrelated edit", { action: "edited" }, false],
    ["base edit", { action: "edited", baseChanged: true }, true],
  ];
  for (const [label, inputs, expected] of cases) {
    assert.equal(controllerTitleReceiptRequired(inputs), expected, label);
  }
});

test("controller mode is canonical and reaches every reconciliation call", () => {
  assert.deepEqual(Object.keys(controller.env), [
    "VERCEL_PREVIEW_CONTROLLER_MODE",
  ]);
  assert.ok(
    ["active", "observe-only"].includes(
      controller.env.VERCEL_PREVIEW_CONTROLLER_MODE,
    ),
    "controller mode must be active or observe-only",
  );
  for (const [jobName, job] of Object.entries(controller.jobs)) {
    const step = job.steps?.find((candidate) =>
      String(candidate.with?.script ?? "").includes("reconcilePreview"),
    );
    if (!step) continue;
    assert.equal(
      step.env.CONTROLLER_MODE,
      "${{ env.VERCEL_PREVIEW_CONTROLLER_MODE }}",
      `${jobName} must receive the version-controlled controller mode`,
    );
    assert.match(
      step.with.script,
      /controllerMode:\s*process\.env\.CONTROLLER_MODE/,
      `${jobName} must pass the controller mode to reconciliation`,
    );
  }
});

test("controller guards every target with the canonical immutable ownership map", () => {
  const implementation = read("scripts/vercel-preview-controller.mjs");
  assert.match(implementation, /repos\.getContent/);
  assert.match(
    implementation,
    /function previewOwnerAtSha[\s\S]+previewTargetConfig\(target\)[\s\S]+path:\s*targetConfiguration\.vercelConfigurationPath,\s*ref:\s*immutableSha/s,
  );
  assert.match(
    implementation,
    /function candidatePreviewOwners[\s\S]+PREVIEW_TARGETS[\s\S]+previewOwnerAtSha\(github, context, target, normalized\.headSha\)/,
  );
  assert.match(
    implementation,
    /function assertWorkflowOwnershipMap[\s\S]+PREVIEW_TARGET_CONFIG\[target\]\.ownershipMode[\s\S]+previewOwnerAtSha\(github, context, target, workflowSha\)/,
  );
  assert.match(
    implementation,
    /for \(const target of PREVIEW_TARGETS\)[\s\S]+reconcileNoDispatchIntents/,
  );
  assert.match(
    implementation,
    /validateWorkerDispatch[\s\S]+previewOwnerAtSha[\s\S]+target,[\s\S]+normalizedPull\.headSha[\s\S]+previewOwnerAtSha\(github, context, target, sha\)/,
  );
  assert.doesNotMatch(
    implementation,
    /uiPreviewOwnerAtSha|UI_PREVIEW_OWNER|UI_VERCEL_CONFIGURATION_PATH/,
  );
});

test("automatic preview runtime has no v1 journal or worker compatibility path", () => {
  const runtime = [
    read("scripts/vercel-preview-controller.mjs"),
    read("scripts/vercel-prebuilt-workflow.mjs"),
    read("scripts/github-deployment.mjs"),
    read(controllerPath),
    read(workerPath),
  ].join("\n");

  assert.match(runtime, /vercel-preview-journal:v2/);
  assert.match(runtime, /vercel-preview-controller:v2/);
  assert.match(runtime, /mento-vercel-prebuilt\/v2/);
  assert.match(runtime, /preview-controller:v2/);
  assert.doesNotMatch(
    runtime,
    /vercel-preview-journal:v1|vercel-preview-controller:v1|mento-vercel-prebuilt\/v1|preview-controller:v1/,
  );
});

test("Dependabot intake is credentialless and trusted follow-up alone can write status", () => {
  assert.equal(intake.name, "Vercel Preview Intake");
  assert.deepEqual(intake.on, {
    pull_request_target: {
      types: ["opened", "edited", "synchronize", "reopened", "closed"],
    },
  });
  assert.deepEqual(intake.permissions, { contents: "read" });
  assert.match(intake["run-name"], /pr=.*sha=.*action=/);
  const intakeJob = intake.jobs["validate-dependabot-metadata"];
  assert.match(intakeJob.if, /dependabot\[bot\].*dependabot\//s);
  assert.equal(Object.hasOwn(intakeJob, "permissions"), false);
  assert.equal(intakeJob.steps.length, 1);
  assert.equal(Object.hasOwn(intakeJob.steps[0], "uses"), false);
  const intakeRaw = read(intakePath);
  assert.doesNotMatch(
    intakeRaw,
    /secrets\.|github\.token|GITHUB_TOKEN|actions\/checkout|actions\/upload-artifact|actions\/download-artifact|pnpm|npm|node /,
  );

  const receipt = controller.jobs["receipt-event"];
  assert.equal(
    controller.jobs["snapshot-event"].outputs.trust,
    "${{ steps.snapshot.outputs.trust }}",
  );
  assert.match(receipt.if, /outputs\.trust != 'dependabot'/);

  const identify = controller.jobs["identify-dependabot-intake"];
  assert.deepEqual(identify.permissions, { contents: "read" });
  assert.match(
    identify.if,
    /workflow_run\.path == '\.github\/workflows\/vercel-preview-intake\.yml'/,
  );
  assert.match(
    identify.if,
    /workflow_run\.path == '\.github\/workflows\/vercel-preview-intake\.yml@main'/,
  );
  assert.doesNotMatch(identify.if, /workflow_run\.name/);
  assert.match(identify.if, /workflow_run\.conclusion == 'success'/);
  assert.match(JSON.stringify(identify), /validateDependabotIntakeWorkflowRun/);
  const publish = controller.jobs["publish-dependabot-unsupported"];
  assert.equal(publish.needs, "identify-dependabot-intake");
  assert.deepEqual(publish.permissions, {
    contents: "read",
    "pull-requests": "read",
    statuses: "write",
  });
  assert.match(
    publish.concurrency.group,
    /identify-dependabot-intake\.outputs\.pr_number/,
  );
  assert.match(JSON.stringify(publish), /publishDependabotUnsupported/);
  assert.doesNotMatch(
    JSON.stringify(publish),
    /actions\/download-artifact|pull_request\.head\.sha|secrets\./,
  );
});

test("repository requests are default-branch-bound and validated before writes", () => {
  const validation = controller.jobs["validate-request"];
  assert.equal(validation.if, "github.event_name == 'repository_dispatch'");
  assert.deepEqual(validation.permissions, { contents: "read" });
  assert.deepEqual(validation.outputs, {
    operation: "${{ steps.request.outputs.operation }}",
    pr_number: "${{ steps.request.outputs.pr_number }}",
  });
  const checkout = validation.steps.find((step) =>
    String(step.uses ?? "").startsWith("actions/checkout@"),
  );
  assert.ok(checkout);
  assert.equal(checkout.with.ref, "${{ github.workflow_sha }}");
  assert.equal(checkout.with["persist-credentials"], false);
  assert.match(JSON.stringify(validation), /writeRepositoryDispatchOutputs/);
  assert.doesNotMatch(JSON.stringify(validation), /secrets\.|client_payload/);

  const bootstrap = controller.jobs["snapshot-bootstrap"];
  assert.equal(bootstrap.needs, "validate-request");
  assert.equal(
    bootstrap.if,
    "needs.validate-request.outputs.operation == 'bootstrap'",
  );
  assert.match(
    JSON.stringify(bootstrap),
    /needs\.validate-request\.outputs\.pr_number/,
  );

  const reconcile = controller.jobs["reconcile-request"];
  assert.equal(reconcile.needs, "validate-request");
  assert.equal(
    reconcile.if,
    "needs.validate-request.outputs.operation == 'reconcile'",
  );
  assert.match(
    reconcile.concurrency.group,
    /needs\.validate-request\.outputs\.pr_number/,
  );
  assert.match(
    JSON.stringify(reconcile),
    /needs\.validate-request\.outputs\.pr_number/,
  );
});

test("planner materializes only trusted-base code without shared caches", () => {
  for (const jobName of ["plan-event", "plan-bootstrap"]) {
    const job = controller.jobs[jobName];
    assert.deepEqual(job.permissions, { contents: "read" });
    const raw = JSON.stringify(job);
    assert.match(raw, /trusted_base_sha/);
    const checkout = job.steps.find((step) =>
      String(step.uses ?? "").startsWith("actions/checkout@"),
    );
    assert.ok(checkout);
    assert.equal(checkout.with.ref, "${{ github.workflow_sha }}");
    assert.equal(checkout.with["fetch-depth"], 0);
    assert.equal(checkout.with["persist-credentials"], false);

    const materialize = job.steps.find(
      (step) =>
        step.name ===
        "Materialize exact trusted base and fetch candidate object",
    );
    assert.ok(materialize);
    assert.equal(materialize.env.WORKFLOW_SHA, "${{ github.workflow_sha }}");
    assert.match(
      materialize.env.TRUSTED_BASE_SHA,
      /^\$\{\{ needs\.(?:snapshot-event|snapshot-bootstrap)\.outputs\.trusted_base_sha \}\}$/,
    );
    const ancestryCheck = materialize.run.indexOf(
      'merge-base --is-ancestor "$TRUSTED_BASE_SHA" "$WORKFLOW_SHA"',
    );
    const baseCheckout = materialize.run.indexOf(
      'checkout --detach "$TRUSTED_BASE_SHA"',
    );
    const candidateFetch = materialize.run.indexOf(
      'fetch --force --no-tags origin "$HEAD_SHA"',
    );
    assert.ok(ancestryCheck >= 0, `${jobName} must prove trusted ancestry`);
    assert.ok(
      ancestryCheck < baseCheckout,
      `${jobName} must prove ancestry before materializing planner code`,
    );
    assert.ok(
      baseCheckout < candidateFetch,
      `${jobName} must materialize trusted code before fetching the candidate`,
    );
    assert.doesNotMatch(materialize.run, /checkout[^\n]*HEAD_SHA/);

    const nodeSetup = job.steps.find((step) =>
      String(step.uses ?? "").startsWith("actions/setup-node@"),
    );
    assert.ok(nodeSetup);
    assert.equal(Object.hasOwn(nodeSetup.with, "cache"), false);
    assert.equal(Object.hasOwn(nodeSetup.with, "cache-dependency-path"), false);
    assert.doesNotMatch(raw, /actions\/cache|cache-dependency-path/);
    assert.match(raw, /pnpm install --ignore-scripts --frozen-lockfile/);
    assert.match(raw, /plan-vercel-deployments\.mjs/);
    assert.doesNotMatch(raw, /secrets\.|VERCEL_TOKEN|TURBO_TOKEN/);
  }
});

test("all preview journal and status mutations share queued cross-workflow serialization", () => {
  const receiptExpected = {
    actions: "read",
    contents: "read",
    "pull-requests": "write",
    statuses: "write",
  };
  const eventReceipt = controller.jobs["receipt-event"];
  assert.deepEqual(eventReceipt.permissions, receiptExpected);
  assert.match(JSON.stringify(eventReceipt), /recordEventReceipt/);

  const bootstrapReceipt = controller.jobs["receipt-bootstrap"];
  assert.deepEqual(bootstrapReceipt.permissions, receiptExpected);
  assert.match(JSON.stringify(bootstrapReceipt), /recordEventReceipt/);
  for (const [jobName, prExpression] of serializedControllerMutations) {
    assert.deepEqual(
      controller.jobs[jobName].concurrency,
      queuedStateConcurrency(prExpression),
      `${jobName} must serialize every PR journal or status mutation`,
    );
  }
  assert.deepEqual(
    worker.jobs["record-worker-evidence"].concurrency,
    queuedStateConcurrency("${{ inputs.pull_request_number }}"),
  );
  assert.doesNotMatch(
    read(controllerPath),
    /vercel-preview-controller-pr-/,
    "legacy workflow-local state groups would not serialize worker evidence",
  );
});

test("read-only preview jobs stay outside the PR state lock", () => {
  for (const jobName of [
    "validate-request",
    "snapshot-event",
    "plan-event",
    "snapshot-bootstrap",
    "plan-bootstrap",
    "identify-dependabot-intake",
    "identify-worker-result",
  ]) {
    assert.equal(
      Object.hasOwn(controller.jobs[jobName], "concurrency"),
      false,
      `${jobName} must not hold the state lock while doing read-only work`,
    );
  }
});

test("worker build concurrency stays independent and only evidence takes the state lock", () => {
  assert.deepEqual(worker.concurrency, {
    group:
      "vercel-preview-worker-pr-${{ inputs.pull_request_number }}-${{ inputs.target }}",
    "cancel-in-progress": false,
  });
  assert.equal(Object.hasOwn(worker.concurrency, "queue"), false);
  for (const [jobName, job] of Object.entries(worker.jobs)) {
    if (jobName === "record-worker-evidence") continue;
    assert.equal(
      Object.hasOwn(job, "concurrency"),
      false,
      `${jobName} must not hold the PR state lock during build or smoke work`,
    );
  }
});

test("event receipts explicitly gate whether reconciliation is required", () => {
  const planner = controller.jobs["plan-event"];
  const receipt = controller.jobs["receipt-event"];
  const reconcile = controller.jobs["reconcile-event"];

  assert.equal(
    planner.if,
    "needs.snapshot-event.outputs.plan_required == 'true'",
  );
  assert.deepEqual(receipt.needs, ["snapshot-event", "plan-event"]);
  assert.match(receipt.if, /^always\(\) &&/);
  assert.equal(
    receipt.outputs.reconcile_required,
    "${{ steps.receipt.outputs.reconcile_required }}",
  );
  assert.equal(reconcile.needs, "receipt-event");
  assert.equal(
    reconcile.if,
    "always() && needs.receipt-event.result == 'success' && needs.receipt-event.outputs.reconcile_required == 'true'",
  );
});

test("closed bootstrap reconciliation survives an intentionally skipped planner", () => {
  const planner = controller.jobs["plan-bootstrap"];
  const receipt = controller.jobs["receipt-bootstrap"];
  const reconcile = controller.jobs["reconcile-bootstrap"];

  assert.equal(
    planner.if,
    "needs.snapshot-bootstrap.outputs.plan_required == 'true'",
  );
  assert.deepEqual(receipt.needs, ["snapshot-bootstrap", "plan-bootstrap"]);
  assert.equal(
    receipt.if,
    "always() && needs.snapshot-bootstrap.result == 'success'",
  );
  assert.equal(reconcile.needs, "receipt-bootstrap");
  assert.equal(
    reconcile.if,
    "always() && needs.receipt-bootstrap.result == 'success'",
  );
  assert.equal(Object.hasOwn(receipt.permissions, "deployments"), false);
  assert.match(JSON.stringify(receipt), /recordEventReceipt/);
  assert.doesNotMatch(
    JSON.stringify(receipt),
    /recoverWorkerResult|createDeployment|createDeploymentStatus/,
  );
  assert.match(JSON.stringify(reconcile), /reconcilePreview/);
  assert.doesNotMatch(JSON.stringify(reconcile), /recoverWorkerResult/);
  assert.deepEqual(controller.on.repository_dispatch.types, [
    "vercel-preview-bootstrap",
    "vercel-preview-reconcile",
  ]);
});

test("every PR comment writer uses the pull-request resource permission", () => {
  const controllerCommentWriters = [
    ["receipt-event", "recordEventReceipt"],
    ["reconcile-event", "reconcilePreview"],
    ["receipt-bootstrap", "recordEventReceipt"],
    ["reconcile-bootstrap", "reconcilePreview"],
    ["reconcile-request", "reconcilePreview"],
    ["recover-worker-result", "recoverWorkerResult"],
  ];
  for (const [jobName, entrypoint] of controllerCommentWriters) {
    const job = controller.jobs[jobName];
    assert.match(JSON.stringify(job), new RegExp(entrypoint));
    assert.equal(job.permissions["pull-requests"], "write");
    assert.equal(Object.hasOwn(job.permissions, "issues"), false);
  }

  const workerEvidence = worker.jobs["record-worker-evidence"];
  assert.match(JSON.stringify(workerEvidence), /recordWorkerEvidence/);
  assert.equal(workerEvidence.permissions["pull-requests"], "write");
  assert.equal(Object.hasOwn(workerEvidence.permissions, "issues"), false);
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
    /VERCEL_TOKEN|TURBO_TOKEN|TURBO_REMOTE_CACHE_SIGNATURE_KEY/,
  );
});

test("only reconciliation steps receive the dedicated worker dispatch credential", () => {
  const reconciliationJobs = [
    "reconcile-event",
    "reconcile-bootstrap",
    "reconcile-request",
    "recover-worker-result",
  ];
  const secretExpression =
    "${{ env.VERCEL_PREVIEW_CONTROLLER_MODE == 'active' && secrets.GH_PREVIEW_WORKFLOW_DISPATCH_TOKEN || '' }}";
  const raw = read(controllerPath);
  const secretNames = [...raw.matchAll(/secrets\.([A-Z0-9_]+)/g)].map(
    ([, name]) => name,
  );
  assert.deepEqual(
    secretNames,
    Array(4).fill("GH_PREVIEW_WORKFLOW_DISPATCH_TOKEN"),
  );

  for (const [jobName, job] of Object.entries(controller.jobs)) {
    for (const step of job.steps ?? []) {
      const hasDispatchSecret = Object.values(step.env ?? {}).includes(
        secretExpression,
      );
      if (!hasDispatchSecret) continue;
      assert.ok(
        reconciliationJobs.includes(jobName),
        `${jobName} must not receive the worker dispatch credential`,
      );
      assert.equal(step.env.WORKER_DISPATCH_TOKEN, secretExpression);
      assert.equal(
        step.env.CONTROLLER_MODE,
        "${{ env.VERCEL_PREVIEW_CONTROLLER_MODE }}",
      );
      assert.equal(Object.hasOwn(step.with ?? {}, "github-token"), false);
      assert.match(
        step.with.script,
        /getOctokit\(process\.env\.WORKER_DISPATCH_TOKEN\)/,
      );
      assert.match(step.with.script, /workerDispatchGithub,/);
      assert.match(
        step.with.script,
        /controllerMode:\s*process\.env\.CONTROLLER_MODE/,
      );
    }
  }

  for (const jobName of reconciliationJobs) {
    const step = controller.jobs[jobName].steps.find((candidate) =>
      String(candidate.with?.script ?? "").includes("reconcilePreview"),
    );
    assert.ok(step, `${jobName} must invoke reconciliation`);
    assert.equal(step.env.WORKER_DISPATCH_TOKEN, secretExpression);
  }

  for (const path of [workerPath, ".github/workflows/_vercel-prebuilt.yml"]) {
    assert.doesNotMatch(
      read(path),
      /GH_PREVIEW_WORKFLOW_DISPATCH_TOKEN|WORKER_DISPATCH_TOKEN/,
    );
  }
});

test("every controller reconciliation binds selections to its immutable workflow SHA", () => {
  const reconciliationJobs = Object.entries(controller.jobs).filter(([, job]) =>
    JSON.stringify(job).includes("reconcilePreview"),
  );
  assert.deepEqual(
    reconciliationJobs.map(([jobName]) => jobName),
    [
      "reconcile-event",
      "reconcile-bootstrap",
      "reconcile-request",
      "recover-worker-result",
    ],
  );
  for (const [jobName, job] of reconciliationJobs) {
    assert.equal(
      job.permissions.deployments,
      "write",
      `${jobName} may recover a completed worker by creating or terminalizing its Deployment`,
    );
    const step = job.steps.find((candidate) =>
      String(candidate.with?.script ?? "").includes("reconcilePreview"),
    );
    assert.ok(step, `${jobName} must invoke reconcilePreview`);
    assert.equal(step.env.WORKFLOW_SHA, "${{ github.workflow_sha }}");
    assert.match(
      step.with.script,
      /workflowSha:\s*process\.env\.WORKFLOW_SHA/,
      `${jobName} must pass the immutable workflow SHA to reconciliation`,
    );
  }
});

test("worker is dispatch-only with strict identity inputs and four literal callers", () => {
  assert.deepEqual(Object.keys(worker.on), ["workflow_dispatch"]);
  assert.deepEqual(Object.keys(worker.on.workflow_dispatch.inputs), [
    "pull_request_number",
    "target",
    "commit_sha",
    "git_branch",
    "controller_key",
    "controller_key_digest",
    "expected_workflow_sha",
    "epoch_anchor_run_id",
    "reconciliation_basis_digest",
    "selection_receipt_run_id",
  ]);
  assert.match(worker["run-name"], /pr=.*target=.*sha=.*key=/);
  assert.deepEqual(worker.permissions, {});
  assert.equal(worker.concurrency["cancel-in-progress"], false);

  const mappings = {
    app: ["app.mento.org", "apps/app.mento.org", "APP"],
    governance: [
      "governance.mento.org",
      "apps/governance.mento.org",
      "GOVERNANCE",
    ],
    reserve: ["reserve.mento.org", "apps/reserve.mento.org", "RESERVE"],
    ui: ["ui.mento.org", "apps/ui.mento.org", "UI"],
  };
  assert.deepEqual(
    Object.keys(worker.jobs).filter((name) => name.startsWith("deploy-")),
    [
      "deploy-app-preview",
      "deploy-governance-preview",
      "deploy-reserve-preview",
      "deploy-ui-preview",
    ],
  );
  for (const [
    target,
    [workspacePackage, root, projectSuffix],
  ] of Object.entries(mappings)) {
    const caller = worker.jobs[`deploy-${target}-preview`];
    assert.equal(caller.uses, "./.github/workflows/_vercel-prebuilt.yml");
    assert.equal(caller.with.logical_target, target);
    assert.equal(caller.with.workspace_package, workspacePackage);
    assert.equal(caller.with.expected_root_directory, root);
    assert.equal(
      caller.with.vercel_project_id,
      `\${{ vars.VERCEL_PROJECT_ID_${projectSuffix} }}`,
    );
    assert.equal(
      caller.with.github_environment,
      `preview/${target}/pr-\${{ inputs.pull_request_number }}`,
    );
    assert.equal(caller.with.provenance, "preview-controller:v2");
    assert.match(caller.if, new RegExp(`inputs\\.target == '${target}'`));
    assert.deepEqual(Object.keys(caller.secrets), [
      ...(target === "governance" ? ["etherscan_api_key"] : []),
      "turbo_remote_cache_signature_key",
      "turbo_token",
      "vercel_token",
    ]);
    assert.doesNotMatch(JSON.stringify(caller), /secrets:\s*inherit|SENTRY/);
  }
  const raw = read(workerPath);
  assert.doesNotMatch(raw, /\bmatrix\b|secrets:\s*inherit|SENTRY/);
  assert.equal((raw.match(/secrets\.ETHERSCAN_API_KEY/g) ?? []).length, 2);
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
  const validationStep = validation.steps.find((candidate) =>
    String(candidate.with?.script ?? "").includes("validateWorkerDispatch"),
  );
  assert.ok(validationStep);
  assert.equal(
    validationStep.env.ACTUAL_WORKFLOW_SHA,
    "${{ github.workflow_sha }}",
  );
  assert.equal(
    validationStep.env.EXPECTED_WORKFLOW_SHA,
    "${{ inputs.expected_workflow_sha }}",
  );
  assert.match(
    validationStep.with.script,
    /workflowSha:\s*process\.env\.ACTUAL_WORKFLOW_SHA/,
  );
  assert.match(
    validationStep.with.script,
    /expected_workflow_sha:\s*process\.env\.EXPECTED_WORKFLOW_SHA/,
  );

  const projectSuffixByTarget = {
    app: "APP",
    governance: "GOVERNANCE",
    reserve: "RESERVE",
    ui: "UI",
  };
  for (const [target, projectSuffix] of Object.entries(projectSuffixByTarget)) {
    const preflight = worker.jobs[`validate-${target}-prerequisites`];
    assert.deepEqual(preflight.permissions, {});
    assert.equal(preflight.needs, "validate-controller-ownership");
    assert.match(
      JSON.stringify(preflight),
      /Missing required repository names/,
    );
    assert.match(preflight.if, new RegExp(`inputs\\.target == '${target}'`));
    assert.equal(Object.hasOwn(preflight, "uses"), false);
    const preflightRaw = JSON.stringify(preflight);
    if (target === "governance") {
      assert.match(preflightRaw, /ETHERSCAN_API_KEY/);
    } else {
      assert.doesNotMatch(preflightRaw, /ETHERSCAN_API_KEY/);
    }

    const caller = worker.jobs[`deploy-${target}-preview`];
    assert.deepEqual(caller.needs, [
      "validate-controller-ownership",
      `validate-${target}-prerequisites`,
    ]);
    assert.deepEqual(caller.permissions, {
      contents: "read",
      deployments: "write",
    });
    assert.doesNotMatch(
      JSON.stringify(caller.permissions),
      /issues|actions|statuses|pull-requests/,
    );

    const resumedSmoke = worker.jobs[`resume-${target}-smoke`];
    assert.deepEqual(resumedSmoke.permissions, { contents: "read" });
    assert.equal(
      resumedSmoke.uses,
      "./.github/workflows/_vercel-preview-smoke.yml",
    );
    assert.equal(Object.hasOwn(resumedSmoke, "steps"), false);
    assert.equal(Object.hasOwn(resumedSmoke, "secrets"), false);
    assert.doesNotMatch(
      JSON.stringify(resumedSmoke),
      /secrets\.|VERCEL_TOKEN|TURBO_TOKEN|TURBO_REMOTE_CACHE_SIGNATURE_KEY|ETHERSCAN_API_KEY|SENTRY/,
    );
    assert.equal(resumedSmoke.with.logical_target, target);
    assert.equal(resumedSmoke.with.verification_mode, "controller");
    assert.equal(
      resumedSmoke.with.verification_key,
      "${{ inputs.controller_key }}",
    );
    assert.equal(
      resumedSmoke.with.deployment_url,
      "${{ needs.validate-controller-ownership.outputs.vercel_deployment_url }}",
    );
    assert.equal(
      resumedSmoke.with.github_deployment_id,
      "${{ needs.validate-controller-ownership.outputs.github_deployment_id }}",
    );
    assert.equal(
      resumedSmoke.with.vercel_deployment_id,
      "${{ needs.validate-controller-ownership.outputs.vercel_deployment_id }}",
    );
    assert.equal(
      resumedSmoke.with.next_deployment_id,
      "${{ needs.validate-controller-ownership.outputs.next_deployment_id }}",
    );
    assert.equal(
      resumedSmoke.with.expected_project_id,
      `\${{ vars.VERCEL_PROJECT_ID_${projectSuffix} }}`,
    );
    assert.equal(
      resumedSmoke.with.metadata_project_id,
      `\${{ vars.VERCEL_PROJECT_ID_${projectSuffix} }}`,
    );
  }

  const evidence = worker.jobs["record-worker-evidence"];
  assert.match(JSON.stringify(evidence), /recordWorkerEvidence/);
  assert.doesNotMatch(JSON.stringify(evidence), /secrets\./);
  const evidenceStep = evidence.steps.find((candidate) =>
    String(candidate.with?.script ?? "").includes("recordWorkerEvidence"),
  );
  assert.ok(evidenceStep);
  assert.equal(
    evidenceStep.env.ACTUAL_WORKFLOW_SHA,
    "${{ github.workflow_sha }}",
  );
  assert.equal(
    evidenceStep.env.EXPECTED_WORKFLOW_SHA,
    "${{ inputs.expected_workflow_sha }}",
  );
  assert.match(
    evidenceStep.with.script,
    /workflowSha:\s*process\.env\.ACTUAL_WORKFLOW_SHA/,
  );
  assert.match(
    evidenceStep.with.script,
    /expected_workflow_sha:\s*process\.env\.EXPECTED_WORKFLOW_SHA/,
  );
});

test("Statuses API owns the reserved name and no workflow job shadows it", () => {
  for (const parsed of [controller, intake, worker]) {
    for (const job of Object.values(parsed.jobs)) {
      assert.notEqual(job.name, "Vercel Preview");
    }
  }
  const implementation = read("scripts/vercel-preview-controller.mjs");
  assert.match(implementation, /PREVIEW_STATUS_CONTEXT = "Vercel Preview"/);
  assert.match(implementation, /createCommitStatus/);
});

test("completed-worker recovery is authoritative for missing and orphaned Deployments", () => {
  const identify = controller.jobs["identify-worker-result"];
  assert.match(
    identify.if,
    /workflow_run\.path == '\.github\/workflows\/vercel-preview-worker\.yml'/,
  );
  assert.match(
    identify.if,
    /workflow_run\.path == '\.github\/workflows\/vercel-preview-worker\.yml@main'/,
  );
  assert.doesNotMatch(identify.if, /workflow_run\.name/);
  const recovery = controller.jobs["recover-worker-result"];
  assert.deepEqual(recovery.permissions, {
    actions: "write",
    contents: "read",
    deployments: "write",
    "pull-requests": "write",
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

test("preview controller, intake, and worker remain outside operational failure issues", () => {
  const notifier = read(".github/workflows/ci-failure-notifier.yml");
  assert.doesNotMatch(notifier, /Vercel Preview Controller/);
  assert.doesNotMatch(notifier, /Vercel Preview Intake/);
  assert.doesNotMatch(notifier, /Vercel Preview Worker/);
  assert.doesNotMatch(
    notifier,
    /vercel-preview-(?:controller|intake|worker)\.yml/,
  );
});

test("automatic workflow creates no implicit or Vercel-owned Deployment", () => {
  const raw = `${read(controllerPath)}\n${read(workerPath)}`;
  assert.doesNotMatch(raw, /githubDeployment=1|secrets:\s*inherit/);
  for (const job of Object.values(worker.jobs)) {
    assert.equal(Object.hasOwn(job, "environment"), false);
  }
  for (const target of ["app", "governance", "reserve", "ui"]) {
    assert.match(
      worker.jobs[`deploy-${target}-preview`].with.deployment_idempotency_key,
      /inputs\.controller_key/,
    );
  }
});

test("runbook covers v2 migration, four-target canaries, cutover, and exact rollback", () => {
  const docs = read("docs/vercel-deployments.md");
  for (const expected of [
    "vercel-preview-bootstrap",
    "vercel-preview-reconcile",
    "/dispatches",
    "Clean v1-to-v2 journal migration",
    "no v1 reader, writer, importer, deleter",
    "vercel-preview-journal:v2",
    "app`, `governance`, `reserve`, and `ui",
    "without changing any Vercel project configuration",
    "Four-target v2 activation canary and later ownership cutovers",
    "single PR that affects multiple targets",
    "scripts/vercel-preview-targets.mjs",
    "Perform those later cutovers strictly in the order",
    "App may not cut over until Governance",
    "leave all later targets in shadow mode",
    "Reserve Vercel Git cutover",
    "Independent Reserve rollback",
    "Governance Vercel Git cutover",
    "Reserve evidence must not be reused as proof",
    "target-local acceptance matrix",
    "Independent Governance rollback",
    "Do not call Governance cut over, begin the App cutover",
    "App, Reserve, and UI keep their GitHub preview owners",
    "App Vercel Git cutover",
    "evidence must not be reused as proof for App",
    "App target-local acceptance matrix",
    "Independent App rollback",
    "Governance, Reserve, and UI keep their GitHub preview owners",
    "App `main` and `v2` still deploy natively",
    "custom `v3` behavior",
    "Do not change `VERCEL_PREVIEW_CONTROLLER_MODE`",
    "live cutover matrix and the post-merge canary",
    "UI rollback is target-local",
    "Keep `VERCEL_PREVIEW_CONTROLLER_MODE` set to `active`",
    "intentionally deferred stale PR",
    "shadow activation",
    "Phase A canary evidence template",
    "repository browser protocol",
    "UI Vercel Git cutover (Phase B)",
    '"**": false',
    '"main": true',
    '"dependabot/**": false',
    "immutable 40-character SHAs",
    "at most eight concurrent run-detail requests",
    "96 title requests",
    "selected historical event is rechecked",
    "own SHA after PR-lineage proof",
    "dispatch-disabled-intent-without-worker",
    "native-owned-selection-without-github-worker",
    "Draining GitHub preview before native ownership",
    "proves only the controller's owner selection",
    "native Vercel deployment/status",
    "stale Phase B branch",
    "vercel-preview-controller.yml",
    "vercel-preview-worker.yml",
    "vercel-preview-intake.yml",
    "queued requested waiting pending in_progress",
    "terminal-active legacy case",
    "current `active` slots only",
    "does not search for a worker",
    "complete quiescent admission",
    "defers active-capacity checkpointing",
    "admission cursor remains pinned to the bootstrap",
    "later controller run appears at the Actions frontier",
    "centralized journal-write barrier",
    "only a terminal closed-and-drained state clears it",
    "later PR event fails before admission refresh",
    "distinct reconciliation run is rejected",
    "exactly two operator steps",
    "gh api --paginate",
    "set -euo pipefail",
    "SHA",
  ]) {
    assert.match(
      docs,
      new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  }

  const normalizedDocs = docs.replace(/\s+/g, " ");
  const orderedOwnershipCutovers = [
    "### Reserve Vercel Git cutover",
    "Do not call Reserve cut over, begin the Governance cutover",
    "### Governance Vercel Git cutover",
    "Do not call Governance cut over, begin the App cutover",
    "#### Independent Governance rollback",
    "### App Vercel Git cutover",
    "Do not call App cut over or close the rollout item",
    "#### Independent App rollback",
  ];
  let previousOwnershipIndex = -1;
  for (const marker of orderedOwnershipCutovers) {
    const currentIndex = normalizedDocs.indexOf(marker);
    assert.ok(currentIndex >= 0, `runbook must contain ${marker}`);
    assert.ok(
      currentIndex > previousOwnershipIndex,
      `runbook must order ${marker} after the previous cutover step`,
    );
    previousOwnershipIndex = currentIndex;
  }

  const orderedAdmissionCutover = [
    "### Global admission-cursor cutover",
    "Merge the precursor that adds strict numbered event/inert run names",
    "Update enforcement PR #586",
    "Drain controller, worker, intake, and controller-callback activity",
    "Merge #586 only after that quiescence proof",
    "Its close event may",
    "dispatch exactly one closed",
    "`repository_dispatch` run ID, run number, strict title",
    "journal is terminal-closed",
    "same run's reconciliation job finish",
    "Do not send a second distinct closed bootstrap",
    "Freeze further pull-request lifecycle mutations",
    "Inventory every other open canonical v2 journal without an admission cursor",
    "bootstrap every inventoried journal immediately",
    "Do not resume pushes, retargets, reopens, or closes until every bootstrap is proven",
    "delayed controller event at or below the authenticated reset floor",
    "A receipt above the floor is never silently ignored",
  ];
  let previousIndex = -1;
  for (const marker of orderedAdmissionCutover) {
    const currentIndex = normalizedDocs.indexOf(marker);
    assert.ok(currentIndex >= 0, `runbook must contain ${marker}`);
    assert.ok(
      currentIndex > previousIndex,
      `runbook must order ${marker} after the previous cutover step`,
    );
    previousIndex = currentIndex;
  }

  assert.doesNotMatch(
    docs,
    /gh workflow run vercel-preview-controller|operation=(?:bootstrap|reconcile)|gh run list --workflow.*--limit/,
  );
});
