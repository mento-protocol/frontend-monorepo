import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parse } from "yaml";

import {
  MAIN_ACTIVE_APP_ALIASES,
  MAIN_ACTIVE_COMMAND_TIMEOUT_MS,
} from "./vercel-main-active.mjs";
import {
  MAIN_ACTIVE_MAX_RECOVERY_TRANSITIONS,
  MAIN_DURABLE_LEGACY_RECOVERY_ALIASES,
  MAIN_LEGACY_REQUIRED_ALIAS_TOPOLOGY,
  MAIN_ORDINARY_TARGETS,
} from "./vercel-main-deployment.mjs";

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const workflowPath = ".github/workflows/vercel-main-deployment.yml";
const workflowSource = read(workflowPath);
const workflow = parse(workflowSource);
const forwardSource = read(
  ".github/actions/vercel-main-active-transition/action.yml",
);
const forward = parse(forwardSource);
const recoverySource = read(
  ".github/actions/vercel-main-active-recovery-transition/action.yml",
);
const recovery = parse(recoverySource);
const deploymentDocs = read("docs/vercel-deployments.md");
const deploymentSource = read("scripts/vercel-main-deployment.mjs");
const terminalReceiptSource = read("scripts/vercel-main-terminal-receipt.mjs");
const pnpmInstallAction = parse(
  read(".github/actions/pnpm-install/action.yml"),
);

const CHECKOUT = "actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0";
const UPLOAD_PIN =
  "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a";
const DOWNLOAD_PIN =
  "actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093";

function steps(job) {
  return workflow.jobs[job].steps ?? [];
}

function command(job, text) {
  const result = steps(job).find((step) => step.run?.includes(text));
  assert.ok(result, `missing ${job}: ${text}`);
  return result;
}

function named(job, text) {
  const result = steps(job).find((step) => step.name?.includes(text));
  assert.ok(result, `missing ${job} step including: ${text}`);
  return result;
}

function sourceProof(job) {
  return command(job, "fetch --no-tags origin +refs/heads/main");
}

function stepsUsing(value, action) {
  return value.filter((step) => step.uses === action);
}

function checkoutSteps(job) {
  return steps(job).filter((step) => step.uses === CHECKOUT);
}

function stringsWithPaths(value, path = [], output = []) {
  if (typeof value === "string") {
    output.push({ path, value });
  } else if (Array.isArray(value)) {
    value.forEach((item, index) =>
      stringsWithPaths(item, [...path, index], output),
    );
  } else if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, item]) =>
      stringsWithPaths(item, [...path, key], output),
    );
  }
  return output;
}

test("active workflow has the current-attempt release graph", () => {
  assert.equal(workflow.name, "Vercel Main Deployment");
  assert.deepEqual(Object.keys(workflow.jobs), [
    "wait-for-ci",
    "provider-preplan",
    "restore-inherited-release",
    "prepare-release",
    "stage-governance",
    "stage-reserve",
    "stage-ui",
    "activate-and-verify",
    "recover-main-deployment",
    "result",
  ]);
  assert.deepEqual(workflow.permissions, { contents: "read", actions: "read" });
  assert.equal(workflow.env.VERCEL_MAIN_MODE, "active");
  assert.deepEqual(JSON.parse(workflow.env.MAIN_OWNERSHIP_MODE_JSON), {
    app: "github",
    governance: "github",
    reserve: "github",
    ui: "github",
  });
  assert.deepEqual(workflow.concurrency, {
    group: "vercel-main-deployment",
    "cancel-in-progress": false,
    queue: "single",
  });
});

test("workflow admission keeps immutable controller and exact source isolation", () => {
  assert.deepEqual(workflow.on, {
    workflow_run: {
      workflows: ["CI/CD"],
      types: ["completed"],
      branches: ["main"],
    },
  });
  const admission = workflow.jobs["wait-for-ci"];
  assert.match(admission.if, /workflow_run\.conclusion == 'success'/);
  assert.equal(
    command("wait-for-ci", "vercel-main-ci-attempt.mjs verify").env
      .GITHUB_TOKEN,
    "${{ github.token }}",
  );
  const checkouts = steps("wait-for-ci").filter(
    (step) => step.uses === CHECKOUT,
  );
  assert.equal(checkouts.length, 2);
  assert.equal(checkouts[0].with["persist-credentials"], false);
  assert.equal(checkouts[1].with.path, "source");
  assert.equal(
    checkouts[1].with.ref,
    "${{ github.event.workflow_run.head_sha }}",
  );
  assert.match(
    command("wait-for-ci", "validate-source").run,
    /fetch --no-tags origin/,
  );
  assert.doesNotMatch(
    workflowSource,
    /github\.sha|deployments:\s*write|secrets:\s*inherit/,
  );
});

test("provider preplan retries only typed drift with one wholly fresh observation epoch", () => {
  const job = workflow.jobs["provider-preplan"];
  assert.deepEqual(job.needs, ["wait-for-ci"]);
  assert.equal(job["timeout-minutes"], 20);
  assert.deepEqual(job.environment, {
    name: "vercel-cli-production",
    deployment: false,
  });
  const capture = command("provider-preplan", "planning-snapshot");
  assert.match(capture.run, /snapshot --spec .*legacy/);
  assert.match(
    command("provider-preplan", "preplan-discover").run,
    /--planning-snapshot .*--legacy-snapshot/,
  );
  const decision = command("provider-preplan", "preplan-decide");
  assert.equal((decision.run.match(/preplan-decide/g) ?? []).length, 2);
  assert.match(
    decision.run,
    new RegExp(
      `preplan\\.json" \\|\\| status=\\$\\?[\\s\\S]*` +
        `if \\[ "\\$status" -eq 0 \\]; then[\\s\\S]*exit 0[\\s\\S]*` +
        `if \\[ "\\$status" -ne 75 \\]; then[\\s\\S]*` +
        `exit "\\$status"[\\s\\S]*planning-snapshot`,
    ),
  );
  assert.doesNotMatch(decision.run, /\b(?:for|while|until)\b/);
  assert.match(
    decision.run,
    /planning-snapshot[\s\S]*planning-retry\.json[\s\S]*snapshot[\s\S]*legacy-retry\.json[\s\S]*preplan-discover[\s\S]*discovery-retry\.json[\s\S]*preplan-decide[\s\S]*preplan-retry\.json/,
  );
  for (const [retryFile, expectedReferences] of Object.entries({
    "planning-retry.json": 3,
    "legacy-retry.json": 3,
    "discovery-retry.json": 2,
    "preplan-retry.json": 1,
  })) {
    assert.equal(
      (decision.run.match(new RegExp(retryFile.replace(".", "\\."), "g")) ?? [])
        .length,
      expectedReferences,
    );
  }
  assert.equal(
    decision.env.VERCEL_TOKEN,
    "${{ secrets.VERCEL_TOKEN_PRODUCTION }}",
  );
});

test("project ID files are materialized privately before shell redirection", () => {
  const writers = Object.entries(workflow.jobs).flatMap(([jobName, job]) =>
    (job.steps ?? [])
      .filter((step) => step.run?.includes('> "$RUNNER_TEMP/projects.json"'))
      .map((step) => ({ jobName, run: step.run })),
  );

  assert.deepEqual(
    writers.map(({ jobName }) => jobName),
    ["provider-preplan", "prepare-release"],
  );
  for (const { jobName, run } of writers) {
    const privateUmask = run.indexOf("umask 077");
    const projectIdsRedirect = run.indexOf('> "$RUNNER_TEMP/projects.json"');
    assert.notEqual(privateUmask, -1, `${jobName} must set a private umask`);
    assert.ok(
      privateUmask < projectIdsRedirect,
      `${jobName} must set its private umask before writing project IDs`,
    );
  }
});

test("preplan installs the admitted source without lifecycle scripts before protected state access", () => {
  const install = steps("provider-preplan").find(
    (step) => step.uses === "./.github/actions/pnpm-install",
  );
  assert.deepEqual(install.with, {
    "working-directory": "source",
    "ignore-scripts": "true",
  });
  assert.ok(
    steps("provider-preplan").indexOf(install) <
      steps("provider-preplan").indexOf(
        command("provider-preplan", "planning-snapshot"),
      ),
  );
  const isolatedInstall = pnpmInstallAction.runs.steps.find(
    (step) =>
      step.name ===
      "Install dependencies without lifecycle scripts or pnpmfile hooks",
  );
  assert.equal(isolatedInstall.if, "inputs.ignore-scripts == 'true'");
  assert.match(
    isolatedInstall.run,
    /pnpm install --frozen-lockfile --ignore-scripts --ignore-pnpmfile/,
  );
});

test("inherited restoration proves and validates reuse before a durable bounded recovery", () => {
  const jobName = "restore-inherited-release";
  const job = workflow.jobs[jobName];
  const jobSteps = steps(jobName);
  assert.deepEqual(job.needs, ["wait-for-ci", "provider-preplan"]);
  assert.equal(
    job.if,
    "needs.provider-preplan.outputs.decision == 'restore-before-planning'",
  );
  assert.deepEqual(job.environment, {
    name: "vercel-cli-production",
    deployment: false,
  });
  assert.equal(job.outputs.outcome, "${{ steps.outcome.outputs.outcome }}");

  const checkouts = checkoutSteps(jobName);
  assert.equal(checkouts.length, 2);
  assert.deepEqual(checkouts[0].with, {
    "fetch-depth": 1,
    "persist-credentials": false,
    ref: "${{ github.workflow_sha }}",
  });
  assert.deepEqual(checkouts[1].with, {
    "fetch-depth": 0,
    path: "source",
    "persist-credentials": false,
    ref: "${{ needs.wait-for-ci.outputs.deploy_sha }}",
  });
  const proof = sourceProof(jobName);
  assert.equal(
    proof.env.GITHUB_WORKFLOW_SHA,
    "${{ needs.wait-for-ci.outputs.deploy_sha }}",
  );
  const install = named(jobName, "without lifecycle scripts");
  assert.deepEqual(install.with, {
    "working-directory": "source",
    "ignore-scripts": "true",
  });
  const firstProviderAccess = jobSteps.find(
    (step) =>
      step.env?.VERCEL_TOKEN === "${{ secrets.VERCEL_TOKEN_PRODUCTION }}",
  );
  assert.ok(jobSteps.indexOf(proof) < jobSteps.indexOf(install));
  assert.ok(jobSteps.indexOf(install) < jobSteps.indexOf(firstProviderAccess));

  const inherited = command(jobName, "preplan-materialize");
  assert.equal(inherited.id, "inherited");
  assert.match(
    inherited.run,
    /--output "\$RUNNER_TEMP\/inherited-preplan\.json"/,
  );
  const mappingSpecs = named(jobName, "inherited mapping specifications");
  assert.match(mappingSpecs.run, /create-spec --scope main/);
  assert.match(mappingSpecs.run, /create-spec --scope legacy/);

  const strictReceipts = command(jobName, "inherited-candidate-receipts");
  for (const target of ["governance", "reserve", "ui", "app"]) {
    const movedCandidateCondition = `contains(fromJSON(steps.inherited.outputs.inherited_candidate_targets), '${target}')`;
    const intent = command(jobName, `--target ${target}`);
    const preflight = jobSteps.find(
      (step) => step.id === `inherited-${target}-preflight`,
    );
    const finalize = jobSteps.find(
      (step) => step.id === `inherited-${target}-finalize`,
    );
    assert.ok(preflight, `${target} inherited preflight`);
    assert.ok(finalize, `${target} inherited finalization`);
    assert.equal(intent.if, movedCandidateCondition);
    assert.equal(preflight.if, movedCandidateCondition);
    assert.equal(finalize.if, movedCandidateCondition);
    assert.match(intent.run, /inherited-candidate-intent/);
    assert.match(intent.run, /--preplan/);
    assert.match(preflight.run, /candidate-preflight/);
    assert.match(
      finalize.run,
      new RegExp(
        `steps\\.inherited-${target}-preflight\\.outputs\\.action.*= reuse`,
      ),
    );
    const finalizeCommand =
      target === "app" ? "candidate-finalize" : "candidate-finalize-inherited";
    assert.match(
      finalize.run,
      new RegExp(
        `candidate-smoke[\\s\\S]*vercel-main-provider-cli\\.mjs ${finalizeCommand} --intent`,
      ),
    );
    if (target !== "app") {
      assert.doesNotMatch(
        finalize.run,
        /vercel-main-provider-cli\.mjs candidate-finalize --intent/,
      );
    }
    assert.ok(jobSteps.indexOf(intent) < jobSteps.indexOf(preflight));
    assert.ok(jobSteps.indexOf(preflight) < jobSteps.indexOf(finalize));
    assert.ok(jobSteps.indexOf(finalize) < jobSteps.indexOf(strictReceipts));
    assert.equal(
      strictReceipts.env[`${target.toUpperCase()}_RECEIPT`],
      `\${{ steps.inherited-${target}-finalize.outputs.receipt || 'none' }}`,
    );
  }
  assert.match(
    strictReceipts.run,
    /--app "\$APP_RECEIPT" --governance "\$GOVERNANCE_RECEIPT"[\s\S]*--reserve "\$RESERVE_RECEIPT" --ui "\$UI_RECEIPT"/,
  );
  const restoreRuns = jobSteps.map((step) => step.run ?? "").join("\n");
  assert.doesNotMatch(restoreRuns, /\bjq\b|\bpending\b/);
  assert.doesNotMatch(
    restoreRuns,
    /vercel-production-shadow|candidate-metadata|app-build-proof/,
  );
  assert.equal(
    stepsUsing(jobSteps, "./.github/actions/vercel-candidate-build").length,
    0,
  );

  const authoritativeMappings = named(
    jobName,
    "Recapture authoritative inherited mappings",
  );
  assert.match(authoritativeMappings.run, /planning-snapshot/);
  assert.match(authoritativeMappings.run, /snapshot --spec .*legacy-spec/);
  assert.match(authoritativeMappings.run, /canonical-mappings/);
  const journal = command(jobName, "inherited-recovery-journal");
  assert.equal(
    jobSteps.indexOf(authoritativeMappings) + 1,
    jobSteps.indexOf(journal),
  );
  assert.ok(
    jobSteps.indexOf(strictReceipts) < jobSteps.indexOf(authoritativeMappings),
  );
  assert.match(
    journal.run,
    /--preplan[\s\S]*--legacy-snapshot[\s\S]*--current-mappings[\s\S]*--candidate-receipts[\s\S]*--journal-output[\s\S]*--plan-output/,
  );

  const preparedUpload = named(
    jobName,
    "Upload current-attempt recovery journal",
  );
  const preparedCheckpoint = named(
    jobName,
    "Checkpoint inherited recovery journal receipt and history",
  );
  const runtime = named(
    jobName,
    "Prepare protected inherited recovery runtime",
  );
  assert.equal(preparedUpload.uses, UPLOAD_PIN);
  assert.match(preparedCheckpoint.run, /active-journal-history/);
  assert.match(preparedCheckpoint.run, /active-journal-receipt/);
  assert.match(preparedCheckpoint.run, /current-journal\.json/);
  assert.equal(runtime.uses, "./.github/actions/vercel-protected-runtime");
  assert.deepEqual(runtime.with, {
    operation: "prepare",
    "logical-target": "app",
    "controller-path": "${{ github.workspace }}",
    "source-path": "${{ github.workspace }}/source",
  });
  assert.ok(jobSteps.indexOf(journal) < jobSteps.indexOf(preparedUpload));
  assert.ok(
    jobSteps.indexOf(preparedUpload) < jobSteps.indexOf(preparedCheckpoint),
  );
  assert.ok(jobSteps.indexOf(preparedCheckpoint) < jobSteps.indexOf(runtime));

  const initialize = named(
    jobName,
    "Initialize current-attempt inherited recovery",
  );
  const initializedUpload = named(
    jobName,
    "Upload initialized inherited recovery journal",
  );
  const initializedCheckpoint = named(
    jobName,
    "Checkpoint initialized inherited recovery journal",
  );
  assert.match(
    initialize.run,
    /active-recovery-event-initialize[\s\S]*run-active-recovery/,
  );
  assert.equal(initializedUpload.uses, UPLOAD_PIN);
  assert.ok(jobSteps.indexOf(runtime) < jobSteps.indexOf(initialize));
  assert.ok(jobSteps.indexOf(initialize) < jobSteps.indexOf(initializedUpload));
  assert.ok(
    jobSteps.indexOf(initializedUpload) <
      jobSteps.indexOf(initializedCheckpoint),
  );

  const transitions = stepsUsing(
    jobSteps,
    "./.github/actions/vercel-main-active-recovery-transition",
  );
  assert.equal(transitions.length, MAIN_ACTIVE_MAX_RECOVERY_TRANSITIONS + 1);
  assert.deepEqual(
    transitions.map((step) => step.with.slot),
    Array.from(
      { length: MAIN_ACTIVE_MAX_RECOVERY_TRANSITIONS + 1 },
      (_, index) => String(index + 1),
    ),
  );
  for (const transition of transitions) {
    assert.equal(
      transition.env.VERCEL_TOKEN,
      "${{ secrets.VERCEL_TOKEN_PRODUCTION }}",
    );
    assert.equal(
      transition.with["recovery-plan"],
      "${{ runner.temp }}/inherited-recovery-plan.json",
    );
    assert.equal(
      transition.with["vercel-cli"],
      "${{ steps.recovery-runtime.outputs.vercel-cli }}",
    );
  }
  assert.ok(
    jobSteps.indexOf(initializedCheckpoint) < jobSteps.indexOf(transitions[0]),
  );

  const finalHead = named(
    jobName,
    "Read final canonical inherited recovery head",
  );
  const requireRecovered = named(
    jobName,
    "Require recovered current-attempt inherited head",
  );
  const cleanup = named(
    jobName,
    "Remove authenticated inherited recovery runtime",
  );
  const outcome = named(jobName, "Publish recovered inherited outcome");
  assert.match(finalHead.run, /active-journal-history/);
  assert.equal(
    requireRecovered.env.RECOVERED_STATUS,
    "${{ steps.recovered-head.outputs.highest_status }}",
  );
  assert.match(requireRecovered.run, /= recovered/);
  assert.equal(cleanup.with.operation, "cleanup");
  assert.equal(cleanup.with["logical-target"], "app");
  assert.equal(
    outcome.env.RECOVERED_STATUS,
    "${{ steps.recovered-head.outputs.highest_status }}",
  );
  assert.match(outcome.run, /outcome=\$RECOVERED_STATUS/);
  assert.ok(jobSteps.indexOf(transitions.at(-1)) < jobSteps.indexOf(finalHead));
  assert.ok(jobSteps.indexOf(finalHead) < jobSteps.indexOf(requireRecovered));
  assert.ok(jobSteps.indexOf(requireRecovered) < jobSteps.indexOf(cleanup));
  assert.ok(jobSteps.indexOf(cleanup) < jobSteps.indexOf(outcome));
});

test("only inherited ordinary restoration uses inherited candidate finalization", () => {
  const inheritedFinalizers = Object.entries(workflow.jobs).flatMap(
    ([jobName, job]) =>
      (job.steps ?? [])
        .filter((step) =>
          step.run?.includes(
            "vercel-main-provider-cli.mjs candidate-finalize-inherited ",
          ),
        )
        .map((step) => ({ jobName, id: step.id })),
  );
  assert.deepEqual(inheritedFinalizers, [
    {
      jobName: "restore-inherited-release",
      id: "inherited-governance-finalize",
    },
    {
      jobName: "restore-inherited-release",
      id: "inherited-reserve-finalize",
    },
    {
      jobName: "restore-inherited-release",
      id: "inherited-ui-finalize",
    },
  ]);
  assert.doesNotMatch(
    `${forwardSource}\n${recoverySource}`,
    /candidate-finalize-inherited/,
  );
  assert.doesNotMatch(workflowSource, /--alias-topology-mode/);

  for (const target of ["governance", "reserve", "ui"]) {
    const finalize = command(`stage-${target}`, "candidate-finalize");
    assert.match(
      finalize.run,
      /vercel-main-provider-cli\.mjs candidate-finalize --intent/,
    );
    assert.doesNotMatch(finalize.run, /candidate-finalize-inherited/);
  }
  assert.match(
    workflow.jobs["restore-inherited-release"].steps.find(
      (step) => step.id === "inherited-app-finalize",
    ).run,
    /vercel-main-provider-cli\.mjs candidate-finalize --intent/,
  );
  assert.match(
    named("activate-and-verify", "only a reused App candidate").run,
    /vercel-main-provider-cli\.mjs candidate-finalize --intent/,
  );
});

test("release preparation starts only after inherited recovery and replans from fresh state", () => {
  const jobName = "prepare-release";
  const job = workflow.jobs[jobName];
  const jobSteps = steps(jobName);
  assert.deepEqual(job.needs, [
    "wait-for-ci",
    "provider-preplan",
    "restore-inherited-release",
  ]);
  const normalizedCondition = job.if.replace(/\s+/g, " ");
  assert.match(normalizedCondition, /always\(\)/);
  assert.match(normalizedCondition, /needs\.wait-for-ci\.result == 'success'/);
  assert.match(
    normalizedCondition,
    /needs\.provider-preplan\.result == 'success'/,
  );
  assert.match(
    normalizedCondition,
    /needs\.restore-inherited-release\.result == 'skipped'/,
  );
  assert.match(
    normalizedCondition,
    /needs\.restore-inherited-release\.result == 'success' && needs\.restore-inherited-release\.outputs\.outcome == 'recovered'/,
  );
  assert.deepEqual(job.environment, {
    name: "vercel-cli-production",
    deployment: false,
  });
  assert.equal(job.env.MAIN_PREPLAN_HANDOFF, undefined);
  assert.deepEqual(
    Object.fromEntries(
      [
        "DEPLOY_SHA",
        "UPSTREAM_RUN_ID",
        "UPSTREAM_RUN_ATTEMPT",
        "UPSTREAM_RUN_URL",
        "BUILD_AND_TEST_JOB_URL",
      ].map((name) => [name, job.env[name]]),
    ),
    {
      DEPLOY_SHA: "${{ needs.wait-for-ci.outputs.deploy_sha }}",
      UPSTREAM_RUN_ID: "${{ needs.wait-for-ci.outputs.upstream_run_id }}",
      UPSTREAM_RUN_ATTEMPT:
        "${{ needs.wait-for-ci.outputs.upstream_run_attempt }}",
      UPSTREAM_RUN_URL: "${{ needs.wait-for-ci.outputs.upstream_run_url }}",
      BUILD_AND_TEST_JOB_URL:
        "${{ needs.wait-for-ci.outputs.build_and_test_job_url }}",
    },
  );

  const checkouts = checkoutSteps(jobName);
  assert.equal(checkouts.length, 2);
  assert.equal(checkouts[0].with.ref, "${{ github.workflow_sha }}");
  assert.equal(checkouts[0].with["persist-credentials"], false);
  assert.deepEqual(checkouts[1].with, {
    "fetch-depth": 0,
    path: "source",
    "persist-credentials": false,
    ref: "${{ needs.wait-for-ci.outputs.deploy_sha }}",
  });
  const proof = sourceProof(jobName);
  assert.equal(
    proof.env.GITHUB_WORKFLOW_SHA,
    "${{ needs.wait-for-ci.outputs.deploy_sha }}",
  );
  const install = named(jobName, "without lifecycle scripts");
  assert.deepEqual(install.with, {
    "working-directory": "source",
    "ignore-scripts": "true",
  });
  const protectedSteps = jobSteps.filter(
    (step) =>
      step.env?.VERCEL_TOKEN === "${{ secrets.VERCEL_TOKEN_PRODUCTION }}",
  );
  assert.deepEqual(
    protectedSteps.map((step) => step.name),
    [
      "Capture wholly fresh main and full legacy snapshots",
      "Discover a wholly fresh provider candidate census",
      "Decide from the wholly fresh provider census",
    ],
  );
  for (const protectedStep of protectedSteps) {
    assert.equal(protectedStep.env.VERCEL_ORG_ID, "${{ vars.VERCEL_ORG_ID }}");
  }
  assert.ok(jobSteps.indexOf(proof) < jobSteps.indexOf(install));
  assert.ok(jobSteps.indexOf(install) < jobSteps.indexOf(protectedSteps[0]));

  const specs = named(jobName, "fresh release preparation specifications");
  const snapshots = named(
    jobName,
    "wholly fresh main and full legacy snapshots",
  );
  const discovery = command(jobName, "preplan-discover");
  const decision = named(
    jobName,
    "Decide from the wholly fresh provider census",
  );
  const rejectRestore = named(
    jobName,
    "Reject a second inherited restore decision",
  );
  const execution = named(jobName, "Create and encode release execution");
  assert.match(specs.run, /create-spec --scope main/);
  assert.match(specs.run, /create-spec --scope legacy/);
  assert.match(snapshots.run, /planning-snapshot/);
  assert.match(snapshots.run, /snapshot --spec .*legacy-spec/);
  assert.match(
    discovery.run,
    /--planning-snapshot[\s\S]*--legacy-snapshot[\s\S]*--project-ids/,
  );
  assert.match(
    decision.run,
    /preplan-decide[\s\S]*--discovery[\s\S]*--planning-snapshot[\s\S]*--legacy-snapshot/,
  );
  assert.equal(
    rejectRestore.env.DECISION,
    "${{ steps.decide.outputs.decision }}",
  );
  assert.match(rejectRestore.run, /!= restore-before-planning/);
  assert.equal(execution.id, "execution");
  assert.match(
    execution.run,
    /release-cli\.mjs execution[\s\S]*--preplan[\s\S]*--discovery[\s\S]*--planning-snapshot[\s\S]*--legacy-snapshot/,
  );
  assert.ok(jobSteps.indexOf(install) < jobSteps.indexOf(specs));
  assert.ok(jobSteps.indexOf(specs) < jobSteps.indexOf(snapshots));
  assert.ok(jobSteps.indexOf(snapshots) < jobSteps.indexOf(discovery));
  assert.ok(jobSteps.indexOf(discovery) < jobSteps.indexOf(decision));
  assert.ok(jobSteps.indexOf(decision) < jobSteps.indexOf(rejectRestore));
  assert.ok(jobSteps.indexOf(rejectRestore) < jobSteps.indexOf(execution));
});

test("ordinary targets materialize execution and use create-or-reuse provider handoffs", () => {
  for (const target of ["governance", "reserve", "ui"]) {
    const job = `stage-${target}`;
    const stage = workflow.jobs[job];
    assert.equal(stage["timeout-minutes"], 50);
    assert.match(stage.if, /^always\(\)/, `${target} stage status override`);
    assert.match(stage.if, /!cancelled\(\)/, `${target} cancellation guard`);
    assert.match(
      stage.if,
      /needs\.wait-for-ci\.result == 'success'/,
      `${target} exact-CI admission`,
    );
    assert.match(
      stage.if,
      /needs\.prepare-release\.result == 'success'/,
      `${target} release preparation`,
    );
    assert.match(
      stage.if,
      new RegExp(
        `contains\\(fromJSON\\(needs\\.prepare-release\\.outputs\\.targets\\), '${target}'\\)`,
      ),
      `${target} selection`,
    );
    assert.match(
      command(job, "materialize --output").run,
      /release-cli\.mjs materialize/,
    );
    assert.match(
      command(job, `--target ${target}`).run,
      /candidate-intent --execution/,
    );
    assert.match(
      command(job, "candidate-preflight").run,
      /candidate-preflight/,
    );
    const build = steps(job).find((step) =>
      step.name?.includes("Build and upload"),
    );
    assert.equal(build.if, "steps.preflight.outputs.action == 'create'");
    assert.match(command(job, "candidate-smoke").run, /candidate-smoke/);
    assert.match(command(job, "candidate-finalize").run, /candidate-finalize/);
  }
});

test("active coordinator validates stage handoffs and prepares App without deploying", () => {
  const jobName = "activate-and-verify";
  const coordinator = workflow.jobs[jobName];
  const jobSteps = steps(jobName);
  assert.deepEqual(coordinator.needs, [
    "wait-for-ci",
    "prepare-release",
    "stage-governance",
    "stage-reserve",
    "stage-ui",
  ]);
  assert.equal(coordinator["timeout-minutes"], 60);
  assert.deepEqual(coordinator.environment, {
    name: "vercel-cli-production",
    deployment: false,
  });
  const proof = sourceProof(jobName);
  const install = named(jobName, "without lifecycle scripts");
  assert.equal(
    proof.env.GITHUB_WORKFLOW_SHA,
    "${{ needs.wait-for-ci.outputs.deploy_sha }}",
  );
  assert.deepEqual(install.with, {
    "working-directory": "source",
    "ignore-scripts": "true",
  });
  assert.ok(jobSteps.indexOf(proof) < jobSteps.indexOf(install));

  const stageValidation = named(jobName, "literal ordinary stage results");
  for (const target of ["GOVERNANCE", "RESERVE", "UI"]) {
    const dependency = target.toLowerCase();
    assert.equal(
      stageValidation.env[`${target}_RESULT`],
      `\${{ needs.stage-${dependency}.result }}`,
    );
    assert.equal(
      stageValidation.env[`${target}_RECEIPT`],
      `\${{ needs.stage-${dependency}.outputs.receipt || 'none' }}`,
    );
    assert.equal(
      stageValidation.env[`${target}_SELECTED`],
      `\${{ contains(fromJSON(needs.prepare-release.outputs.targets), '${dependency}') }}`,
    );
  }
  assert.match(stageValidation.run, /test "\$result" = success/);
  assert.match(stageValidation.run, /test "\$result" = skipped/);
  assert.match(stageValidation.run, /test "\$receipt" != none/);
  assert.match(stageValidation.run, /test "\$receipt" = none/);

  const freshness = named(jobName, "freshness before App preparation");
  const noTarget = named(jobName, "no-target terminal artifacts");
  const superseded = named(jobName, "superseded terminal artifacts");
  assert.equal(
    freshness.if,
    "needs.prepare-release.outputs.no_target != 'true'",
  );
  assert.equal(
    noTarget.if,
    "needs.prepare-release.outputs.no_target == 'true'",
  );
  assert.equal(superseded.if, "steps.freshness.outputs.status == 'superseded'");
  assert.match(noTarget.run, /terminal-artifacts[\s\S]*--outcome no-target/);
  assert.match(
    superseded.run,
    /terminal-artifacts[\s\S]*--outcome superseded-before-journal/,
  );

  const runtime = named(
    jobName,
    "Prepare protected activation runtime independent of App reuse",
  );
  assert.match(runtime.if, /steps\.freshness\.outputs\.status == 'fresh'/);
  assert.match(
    runtime.if,
    /needs\.prepare-release\.outputs\.has_active_targets == 'true'/,
  );
  assert.match(runtime.if, /outputs\.targets\), 'app'/);
  assert.equal(runtime.uses, "./.github/actions/vercel-protected-runtime");
  assert.equal(runtime.with.operation, "prepare");
  assert.equal(runtime.with["logical-target"], "app");
  assert.match(
    command(jobName, "candidate-intent --execution").run,
    /--target app/,
  );
  const appBuild = named(jobName, "Build exact App custom-v3 output");
  assert.match(
    appBuild.if,
    /steps\.app-preflight\.outputs\.action == 'create'/,
  );
  assert.match(appBuild.if, /outputs\.shadow_targets\), 'app'/);
  assert.equal(appBuild.uses, "./.github/actions/vercel-candidate-build");
  assert.equal(appBuild.with["logical-target"], "app");
  assert.equal(appBuild.with["expected-root-directory"], "apps/app.mento.org");
  assert.match(
    named(jobName, "Prove exact App build before any upload").run,
    /app-build-proof/,
  );
  assert.match(
    named(jobName, "Create App current-attempt build intent").if,
    /outputs\.targets\), 'app'/,
  );
  assert.match(
    named(
      jobName,
      "Preflight an App candidate only when App has activation authority",
    ).if,
    /outputs\.active_targets\), 'app'/,
  );
  const reuseFinalize = named(jobName, "only a reused App candidate");
  assert.equal(
    reuseFinalize.if,
    "steps.app-preflight.outputs.action == 'reuse'",
  );
  assert.match(reuseFinalize.run, /candidate-smoke[\s\S]*candidate-finalize/);
  const strictReceipts = command(jobName, "candidate-receipts");
  assert.match(
    strictReceipts.run,
    /--app[\s\S]*--governance[\s\S]*--reserve[\s\S]*--ui/,
  );
  assert.doesNotMatch(strictReceipts.run, /\bjq\b/);
  const coordinatorRuns = jobSteps.map((step) => step.run ?? "").join("\n");
  assert.doesNotMatch(
    coordinatorRuns,
    /vercel-production-shadow\.mjs deploy --target app/,
  );
  const shadowTerminal = named(jobName, "shadow-only terminal artifacts");
  assert.match(shadowTerminal.if, /has_active_targets != 'true'/);
  assert.match(shadowTerminal.run, /--outcome shadow-prepared/);
  assert.match(shadowTerminal.run, /active-public-smokes/);
  assert.match(shadowTerminal.run, /active-terminal-state-proof/);
  assert.match(
    shadowTerminal.run,
    /--state-proof "\$RUNNER_TEMP\/shadow-terminal-state-proof\.json"/,
  );
  assert.match(shadowTerminal.run, /terminal-artifacts/);
  assert.ok(jobSteps.indexOf(install) < jobSteps.indexOf(stageValidation));
  assert.ok(jobSteps.indexOf(stageValidation) < jobSteps.indexOf(freshness));
  assert.ok(jobSteps.indexOf(freshness) < jobSteps.indexOf(runtime));
  assert.ok(jobSteps.indexOf(runtime) < jobSteps.indexOf(appBuild));
  assert.ok(
    jobSteps.indexOf(appBuild) <
      jobSteps.indexOf(named(jobName, "Prove exact App build")),
  );
  const cleanup = named(jobName, "Remove authenticated App runtime");
  assert.equal(cleanup.if, "${{ always() }}");
  assert.equal(cleanup.uses, "./.github/actions/vercel-protected-runtime");
  assert.deepEqual(cleanup.with, {
    operation: "cleanup",
    "logical-target": "app",
  });
  assert.equal(jobSteps.at(-1), cleanup);
});

test("forward composite binds every reducer turn to execution, barrier, and prepared current journal", () => {
  for (const input of ["execution", "stage-barrier", "prepared-journal"])
    assert.ok(forward.inputs[input]);
  assert.doesNotMatch(
    forwardSource,
    /app-candidate-matches|app-candidate-expectation/,
  );
  for (const text of [
    "active-mapping-spec --execution",
    "run-active --execution",
    "--stage-barrier",
    "--prepared-journal",
  ])
    assert.match(forwardSource, new RegExp(text));
  assert.match(forwardSource, /Upload the durable intent before mutation/);
  assert.match(forwardSource, new RegExp(UPLOAD_PIN));
});

test("forward App v3 deploy atomically adds the provider receipt before aliases can run", () => {
  assert.match(forwardSource, /app_v3_deploy/);
  const appFinalize = forward.runs.steps.find((step) =>
    step.run?.includes("candidate-finalize"),
  );
  assert.ok(
    appFinalize,
    "missing App provider finalization after the authorized deploy",
  );
  assert.match(appFinalize.if, /app_v3_deploy/);
  assert.match(appFinalize.run, /candidate-smoke[\s\S]*candidate-finalize/);
  assert.match(appFinalize.run, /--intent/);
  assert.match(appFinalize.run, /--smoke/);
  const verifyApp = forward.runs.steps.find((step) =>
    step.run?.includes("active-event-verify-app"),
  );
  assert.ok(verifyApp, "missing App-specific post-deploy journal verification");
  assert.match(verifyApp.if, /app_v3_deploy/);
  assert.match(verifyApp.run, /--app-candidate-receipt/);
  assert.match(verifyApp.run, /--app-deployment/);
  assert.match(verifyApp.run, /run-active/);
});

test("recovery is a bounded exact-current-attempt transaction with no cross-attempt authority", () => {
  const recoveryJob = workflow.jobs["recover-main-deployment"];
  assert.deepEqual(recoveryJob.needs, [
    "wait-for-ci",
    "provider-preplan",
    "restore-inherited-release",
    "prepare-release",
    "stage-governance",
    "stage-reserve",
    "stage-ui",
    "activate-and-verify",
  ]);
  assert.match(recoveryJob.if, /^always\(\)/);
  assert.match(recoveryJob.if, /prepare-release\.result == 'success'/);
  assert.match(recoveryJob.if, /activate-and-verify\.result != 'success'/);
  for (const target of ["APP", "GOVERNANCE", "RESERVE", "UI"]) {
    assert.equal(
      recoveryJob.env[`VERCEL_PROJECT_ID_${target}`],
      `\${{ vars.VERCEL_PROJECT_ID_${target} }}`,
    );
  }
  const controller = checkoutSteps("recover-main-deployment").find(
    (step) => step.with.path === undefined,
  );
  const source = checkoutSteps("recover-main-deployment").find(
    (step) => step.with.path === "source",
  );
  assert.equal(controller.with.ref, "${{ github.workflow_sha }}");
  assert.equal(source.with.ref, "${{ needs.wait-for-ci.outputs.deploy_sha }}");
  assert.match(sourceProof("recover-main-deployment").run, /validate-source/);
  assert.deepEqual(
    steps("recover-main-deployment").find(
      (step) => step.uses === "./.github/actions/pnpm-install",
    ).with,
    { "working-directory": "source", "ignore-scripts": "true" },
  );
  const runtime = named(
    "recover-main-deployment",
    "protected recovery runtime",
  );
  assert.equal(runtime.uses, "./.github/actions/vercel-protected-runtime");
  assert.equal(runtime.with.operation, "prepare");
  assert.match(
    command("recover-main-deployment", "check-versions").run,
    /steps\.recovery-runtime\.outputs\.node-bin/,
  );
  const materialize = named(
    "recover-main-deployment",
    "Materialize current execution manifest",
  );
  assert.match(materialize.run, /materialize/);
  assert.match(materialize.run, /manifest\.json/);
  const identity = command(
    "recover-main-deployment",
    "active-journal-identity",
  );
  assert.equal(identity.id, "journal-identity");
  const download = steps("recover-main-deployment").find(
    (step) => step.uses === DOWNLOAD_PIN,
  );
  assert.ok(download, "missing exact current-attempt journal download");
  assert.equal(
    download.with.pattern,
    "${{ steps.journal-identity.outputs.artifact_prefix }}*",
  );
  assert.equal(download.with["run-id"], "${{ github.run_id }}");
  assert.match(download.with.path, /current-attempt-journals/);
  assert.match(
    named("recover-main-deployment", "journal artifact metadata").run,
    /actions\/runs\/\$GITHUB_RUN_ID\/artifacts[\s\S]*ARTIFACT_PREFIX/,
  );
  assert.doesNotMatch(
    workflowSource,
    /prior-attempt-gate|prior[-_]attempt-gate/,
  );
  assert.doesNotMatch(
    steps("recover-main-deployment")
      .map((step) => step.run ?? "")
      .join("\n"),
    /artifact-ids|journal_artifact_ids|prior[-_]attempt/i,
  );
  assert.doesNotMatch(
    steps("recover-main-deployment")
      .map((step) => JSON.stringify(step))
      .join("\n"),
    /\$RUNNER_TEMP\/vercel/,
  );
  assert.doesNotMatch(recoverySource, /app-candidate|app-candidate-matches/);
  assert.ok(!recovery.inputs.execution);
  assert.ok(!recovery.inputs["stage-barrier"]);
  const recoveryMappingSpecCommands = recoverySource
    .split("\n")
    .filter((line) => line.includes("active-recovery-mapping-spec"));
  assert.equal(recoveryMappingSpecCommands.length, 3);
  for (const recoveryMappingSpecCommand of recoveryMappingSpecCommands) {
    assert.match(
      recoveryMappingSpecCommand,
      /--journal-history "\$JOURNAL_DIRECTORY\/current-history\.json"/,
    );
    assert.doesNotMatch(recoveryMappingSpecCommand, /--plan/);
  }
  assert.doesNotMatch(recoverySource, /create-spec --scope main/);
  assert.match(
    command("recover-main-deployment", "plan-active-recovery").run,
    /current-history[\s\S]*recovery-start-mappings/,
  );
  const initialize = named(
    "recover-main-deployment",
    "Initialize durable current-attempt recovery journal",
  );
  assert.match(
    initialize.run,
    /active-recovery-event-initialize[\s\S]*run-active-recovery/,
  );
  assert.ok(
    steps("recover-main-deployment").some(
      (step) =>
        step.name === "Upload initialized recovery journal" &&
        step.uses === UPLOAD_PIN &&
        step.with.path ===
          "${{ runner.temp }}/recovery-initialized-artifact/main-journal.json",
    ),
  );
  assert.match(
    named(
      "recover-main-deployment",
      "Stage initialized recovery journal under its canonical artifact basename",
    ).run,
    /recovery-initialized-journal\.json[\s\S]*main-journal\.json/,
  );
  const transitions = steps("recover-main-deployment").filter(
    (step) =>
      step.uses === "./.github/actions/vercel-main-active-recovery-transition",
  );
  assert.equal(transitions.length, 10);
  assert.deepEqual(
    transitions.map((step) => step.with.slot),
    ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"],
  );
  for (const transition of transitions) {
    assert.equal(
      transition.with["operation-cwd"],
      "${{ github.workspace }}/source",
    );
    assert.equal(
      transition.with["vercel-cli"],
      "${{ steps.recovery-runtime.outputs.vercel-cli }}",
    );
  }
  assert.match(
    named("recover-main-deployment", "recovered or manual terminal").run,
    /recovered[\s\S]*manual_intervention/,
  );
  const preparationFailure = named(
    "recover-main-deployment",
    "preparation failure terminal artifacts",
  );
  assert.match(
    preparationFailure.run,
    /terminal-artifacts[\s\S]*preparation-failed-before-journal/,
  );
  assert.match(
    preparationFailure.run,
    /terminal-stage-results[\s\S]*--app-result[\s\S]*--coordinator-result[\s\S]*preparation-stage-results/,
  );
  assert.doesNotMatch(preparationFailure.run, /vercel-main-stage-results:v1/);
  assert.match(
    command("recover-main-deployment", "active-recovery-state-spec").run,
    /--execution[\s\S]*recovered-history/,
  );
  const canonicalMappings = command(
    "recover-main-deployment",
    "active-recovery-canonical-mappings",
  );
  assert.match(
    canonicalMappings.run,
    /--journal-history[\s\S]*recovered-history[\s\S]*--mappings[\s\S]*recovery-final-mappings-raw[\s\S]*--output[\s\S]*recovery-final-mappings/,
  );
  assert.doesNotMatch(canonicalMappings.run, /jq -n --slurpfile/);
  assert.match(
    command("recover-main-deployment", "active-proof").run,
    /recovery-final-state-spec/,
  );
  assert.match(
    command("recover-main-deployment", "active-recovery-public-smokes").run,
    /--execution[\s\S]*recovery-app-runtime-smoke[\s\S]*recovery-ui-runtime-smoke/,
  );
  assert.match(
    named("recover-main-deployment", "recovered or manual terminal artifacts")
      .run,
    /terminal-artifacts[\s\S]*recovery-final-mappings[\s\S]*recovery-final-legacy/,
  );
  assert.match(
    command("recover-main-deployment", "terminal-evidence-create").run,
    /terminal-evidence-create/,
  );
  assert.match(
    named(
      "recover-main-deployment",
      "Fail after recording recovery terminal evidence",
    ).run,
    /recovered\|manual-intervention\|preparation-failed-before-journal[\s\S]*exit 1/,
  );
  const cleanup = named(
    "recover-main-deployment",
    "Remove authenticated recovery runtime",
  );
  assert.equal(cleanup.if, "${{ always() }}");
  assert.equal(cleanup.uses, "./.github/actions/vercel-protected-runtime");
});

test("terminal verdict restores producer outputs and supports current final attempt", () => {
  const terminal = command("activate-and-verify", "terminal-evidence-create");
  assert.match(terminal.run, /terminal-evidence-create/);
  assert.equal(
    workflow.jobs["activate-and-verify"].outputs.receipt,
    "${{ steps.terminal.outputs.receipt }}",
  );
  assert.equal(
    workflow.jobs["recover-main-deployment"].outputs.evidence,
    "${{ steps.terminal.outputs.evidence }}",
  );
  const result = command("result", "terminal-evidence-restore");
  assert.match(result.run, /terminal-evidence-restore/);
  assert.match(result.run, /RECOVERY_RECEIPT[\s\S]*RECOVERY_EVIDENCE/);
  assert.match(result.run, /COORDINATOR_RECEIPT[\s\S]*COORDINATOR_EVIDENCE/);
  assert.equal(result["continue-on-error"], true);
  assert.doesNotMatch(
    workflow.jobs.result.steps.map((step) => step.uses).join("\n"),
    /download-artifact/,
  );
});

test("credentialed jobs remain bounded and third-party actions stay pinned", () => {
  for (const [name, job] of Object.entries(workflow.jobs)) {
    if (job.environment)
      assert.deepEqual(
        job.environment,
        { name: "vercel-cli-production", deployment: false },
        name,
      );
    for (const checkout of (job.steps ?? []).filter(
      (step) => step.uses === CHECKOUT,
    ))
      assert.equal(checkout.with["persist-credentials"], false, name);
    for (const step of job.steps ?? [])
      if (step.uses?.startsWith("actions/upload-artifact@"))
        assert.equal(step.uses, UPLOAD_PIN);
  }
});

test("secrets are confined to protected step environments", () => {
  const secretReferences = stringsWithPaths(workflow).filter(({ value }) =>
    value.includes("secrets."),
  );
  assert.ok(secretReferences.length > 0);
  for (const { path, value } of secretReferences) {
    assert.equal(path.length, 6, `forbidden secret path ${path.join(".")}`);
    assert.equal(path[0], "jobs");
    assert.equal(path[2], "steps");
    assert.equal(path[4], "env");
    assert.match(value, /^\$\{\{ secrets\.[A-Z0-9_]+ \}\}$/);
    assert.deepEqual(workflow.jobs[path[1]].environment, {
      name: "vercel-cli-production",
      deployment: false,
    });
  }
});

test("every credentialed producer uses the protected Vercel environment", () => {
  for (const name of [
    "provider-preplan",
    "restore-inherited-release",
    "prepare-release",
    "stage-governance",
    "stage-reserve",
    "stage-ui",
    "activate-and-verify",
    "recover-main-deployment",
  ]) {
    assert.deepEqual(workflow.jobs[name].environment, {
      name: "vercel-cli-production",
      deployment: false,
    });
  }
});

test("shadow and no-target paths remain release execution decisions, never terminal downloads", () => {
  assert.match(
    workflow.jobs["stage-governance"].if,
    /contains\(fromJSON\(needs\.prepare-release\.outputs\.targets\)/,
  );
  assert.match(
    workflow.jobs["stage-reserve"].if,
    /contains\(fromJSON\(needs\.prepare-release\.outputs\.targets\)/,
  );
  assert.match(
    workflow.jobs["stage-ui"].if,
    /contains\(fromJSON\(needs\.prepare-release\.outputs\.targets\)/,
  );
  assert.match(
    command("result", "terminal-evidence-restore").run,
    /terminal-evidence-restore/,
  );
});

test("all public mutation paths have bounded timeouts and journal uploads", () => {
  assert.equal(
    (workflow.jobs["activate-and-verify"].steps ?? []).filter(
      (step) => step.uses === "./.github/actions/vercel-main-active-transition",
    ).length,
    6,
  );
  assert.match(forwardSource, /Upload the durable intent before mutation/);
  assert.match(recoverySource, /Upload recovery intent before mutation/);
});

test("every durable current-attempt journal upload has the canonical downloaded basename", () => {
  const groups = [
    ["forward", forward.runs.steps],
    ["recovery", recovery.runs.steps],
    ["inherited", steps("restore-inherited-release")],
    ["activate", steps("activate-and-verify")],
    ["recover-main", steps("recover-main-deployment")],
  ];
  let count = 0;
  for (const [groupName, group] of groups) {
    for (const [index, upload] of group.entries()) {
      if (
        upload.uses !== UPLOAD_PIN ||
        !/journal_artifact_name/.test(String(upload.with?.name ?? ""))
      ) {
        continue;
      }
      count += 1;
      assert.match(
        upload.with.path,
        /-artifact\/main-journal\.json$/,
        `journal upload must stage main-journal.json: ${groupName}/${upload.name}`,
      );
      const artifactDirectory = upload.with.path
        .replace(/\/main-journal\.json$/, "")
        .split("/")
        .at(-1)
        .replace("${{ inputs.slot }}", "$SLOT");
      assert.ok(
        group
          .slice(0, index)
          .some(
            (step) =>
              step.run?.includes(artifactDirectory) &&
              step.run.includes("main-journal.json"),
          ),
        `journal upload must have an isolated staging step: ${groupName}/${upload.name}`,
      );
    }
  }
  assert.equal(count, 12);
});

test("production jobs keep the immutable controller checkout and source jobs use the admitted SHA", () => {
  const controllerJobs = [
    "provider-preplan",
    "restore-inherited-release",
    "prepare-release",
    "stage-governance",
    "stage-reserve",
    "stage-ui",
    "activate-and-verify",
    "recover-main-deployment",
  ];
  for (const job of controllerJobs) {
    const checkouts = checkoutSteps(job);
    assert.ok(
      checkouts.some(
        (step) =>
          step.with.path === undefined &&
          step.with.ref === "${{ github.workflow_sha }}" &&
          step.with["fetch-depth"] === 1,
      ),
      `${job} immutable controller checkout`,
    );
  }
  for (const job of [
    "provider-preplan",
    "prepare-release",
    "stage-governance",
    "stage-reserve",
    "stage-ui",
    "activate-and-verify",
  ]) {
    const checkouts = checkoutSteps(job);
    assert.ok(
      checkouts.some(
        (step) =>
          step.with.path === "source" &&
          step.with.ref === "${{ needs.wait-for-ci.outputs.deploy_sha }}" &&
          step.with["fetch-depth"] === 0,
      ),
      `${job} exact source checkout`,
    );
  }
  sourceProof("provider-preplan");
});

test("provider and release handoffs stay compact job outputs rather than plan JSON", () => {
  for (const [job, outputs] of [
    ["provider-preplan", ["decision", "handoff"]],
    [
      "prepare-release",
      [
        "execution",
        "decision",
        "targets",
        "active_targets",
        "shadow_targets",
        "has_active_targets",
        "no_target",
      ],
    ],
  ]) {
    for (const output of outputs) assert.ok(workflow.jobs[job].outputs[output]);
  }
  assert.doesNotMatch(workflowSource, /\bPLAN_JSON\b/);
  assert.doesNotMatch(workflowSource, /plan-main-deployments/);
  assert.match(
    command("prepare-release", "vercel-main-release-cli.mjs execution").run,
    /--preplan[\s\S]*--discovery[\s\S]*--planning-snapshot[\s\S]*--legacy-snapshot/,
  );
  assert.match(
    named("prepare-release", "Reject a second inherited restore decision").run,
    /restore-before-planning/,
  );
});

test("ordinary candidates emit a current-attempt intent before create and a receipt after fresh smoke", () => {
  for (const target of ["governance", "reserve", "ui"]) {
    const job = `stage-${target}`;
    const intent = command(job, "candidate-intent --execution");
    const preflight = command(job, "candidate-preflight");
    const smoke = command(job, "candidate-smoke");
    const finalize = command(job, "candidate-finalize");
    const create = named(job, "Build and upload");
    assert.equal(create.if, "steps.preflight.outputs.action == 'create'");
    assert.ok(steps(job).indexOf(intent) < steps(job).indexOf(preflight));
    assert.ok(steps(job).indexOf(preflight) < steps(job).indexOf(create));
    assert.ok(steps(job).indexOf(create) < steps(job).indexOf(smoke));
    assert.equal(
      smoke,
      finalize,
      `${target} smoke and finalization stay one fail-closed step`,
    );
    assert.match(smoke.run, /candidate-smoke[\s\S]*candidate-finalize/);
    assert.ok(workflow.jobs[job].outputs.receipt, `${target} receipt output`);
  }
});

test("ordinary stages retain protected runtime isolation and create-only uploads", () => {
  const contracts = {
    governance: {
      project: "${{ vars.VERCEL_PROJECT_ID_GOVERNANCE }}",
      projectName: "governance.mento.org",
      root: "apps/governance.mento.org",
      secrets: ["ETHERSCAN_API_KEY", "SENTRY_AUTH_TOKEN"],
    },
    reserve: {
      project: "${{ vars.VERCEL_PROJECT_ID_RESERVE }}",
      projectName: "reserve.mento.org",
      root: "apps/reserve.mento.org",
      secrets: ["SENTRY_AUTH_TOKEN"],
    },
    ui: {
      project: "${{ vars.VERCEL_PROJECT_ID_UI }}",
      projectName: "ui.mento.org",
      root: "apps/ui.mento.org",
      secrets: [],
    },
  };
  for (const [target, contract] of Object.entries(contracts)) {
    const job = `stage-${target}`;
    const label = target === "ui" ? "UI" : target;
    const jobSteps = steps(job);
    const checkouts = checkoutSteps(job);
    assert.equal(
      workflow.jobs[job].if,
      `always() && !cancelled() && needs.wait-for-ci.result == 'success' && needs.prepare-release.result == 'success' && contains(fromJSON(needs.prepare-release.outputs.targets), '${target}')`,
    );
    assert.equal(workflow.jobs[job].env.VERCEL_TOKEN, undefined);
    assert.ok(
      checkouts.some(
        (step) =>
          step.with.ref === "${{ github.workflow_sha }}" &&
          step.with["persist-credentials"] === false,
      ),
      `${target} trusted controller`,
    );
    assert.ok(
      checkouts.some(
        (step) =>
          step.with.path === "source" &&
          step.with.ref === "${{ needs.wait-for-ci.outputs.deploy_sha }}" &&
          step.with["fetch-depth"] === 0 &&
          step.with["persist-credentials"] === false,
      ),
      `${target} exact source`,
    );
    const proof = sourceProof(job);
    const install = named(job, "without lifecycle scripts");
    assert.equal(install.with["working-directory"], "source");
    assert.equal(install.with["ignore-scripts"], "true");
    assert.ok(jobSteps.indexOf(proof) < jobSteps.indexOf(install));
    const runtime = named(job, `Prepare protected ${label} runtime`);
    assert.equal(runtime.uses, "./.github/actions/vercel-protected-runtime");
    assert.equal(runtime.with.operation, "prepare");
    assert.equal(runtime.with["logical-target"], target);
    assert.match(
      named(job, `Verify pinned ${label} prerequisites`).run,
      /check-versions/,
    );
    assert.match(
      named(job, `Prepare runner-owned ${label} pull staging`).run,
      /prepare-pull-staging/,
    );
    assert.equal(
      named(job, `Pull ${label} production configuration`).env.VERCEL_TOKEN,
      "${{ secrets.VERCEL_TOKEN_PRODUCTION }}",
    );
    const rootCheck = named(
      job,
      `Validate ${label} project and Root Directory`,
    );
    assert.match(
      rootCheck.run,
      new RegExp(`--project-name ${contract.projectName}`),
    );
    assert.match(
      rootCheck.run,
      new RegExp(`--root-directory ${contract.root}`),
    );
    const build = named(job, "Build and upload");
    assert.equal(build.if, "steps.preflight.outputs.action == 'create'");
    assert.equal(
      build.with["next-deployment-id"],
      "${{ steps.intent.outputs.candidate_id }}",
    );
    for (const secret of contract.secrets) {
      assert.equal(build.env[secret], `\${{ secrets.${secret} }}`);
    }
    for (const secret of ["ETHERSCAN_API_KEY", "SENTRY_AUTH_TOKEN"]) {
      if (!contract.secrets.includes(secret)) {
        assert.equal(build.env[secret], undefined);
      }
    }
    const deploy = named(job, "without public custom domains");
    assert.equal(deploy.if, "steps.preflight.outputs.action == 'create'");
    assert.match(
      deploy.run,
      /vercel-production-shadow\.mjs" deploy --candidate-metadata/,
    );
    const candidateMetadata = named(
      job,
      `Materialize ${label} candidate metadata`,
    );
    const candidateMetadataPath = `\\"\\$RUNNER_TEMP/${target}-candidate-metadata\\.json\\"`;
    const deploymentExpectationPath = `\\"\\$RUNNER_TEMP/${target}-deployment-expectation\\.json\\"`;
    assert.match(
      candidateMetadata.run,
      new RegExp(
        `candidate-metadata --intent "\\$RUNNER_TEMP/intent\\.json" --output ${candidateMetadataPath}`,
      ),
    );
    assert.match(
      deploy.run,
      new RegExp(
        `--candidate-metadata ${candidateMetadataPath} --expected ${deploymentExpectationPath}`,
      ),
    );
    assert.doesNotMatch(
      deploy.run,
      new RegExp(`--expected ${candidateMetadataPath}`),
    );
    assert.doesNotMatch(candidateMetadata.run, /deployment-expectation/);
    assert.doesNotMatch(
      JSON.stringify(workflow.jobs[job]),
      new RegExp(`\\$RUNNER_TEMP/${target}-expected\\.json`),
    );
    assert.equal(
      deploy.env.VERCEL_TOKEN,
      "${{ secrets.VERCEL_TOKEN_PRODUCTION }}",
    );
    const intent = command(job, "candidate-intent --execution");
    const preflight = command(job, "candidate-preflight");
    const finalize = command(job, "candidate-finalize");
    const cleanup = named(job, `Remove authenticated ${label} runtime`);
    assert.equal(cleanup.if, "${{ always() }}");
    assert.equal(cleanup.with.operation, "cleanup");
    assert.equal(cleanup.with["logical-target"], target);
    assert.ok(jobSteps.indexOf(install) < jobSteps.indexOf(intent));
    assert.ok(jobSteps.indexOf(intent) < jobSteps.indexOf(runtime));
    assert.ok(jobSteps.indexOf(runtime) < jobSteps.indexOf(rootCheck));
    assert.ok(jobSteps.indexOf(rootCheck) < jobSteps.indexOf(preflight));
    assert.ok(
      jobSteps.indexOf(preflight) < jobSteps.indexOf(candidateMetadata),
    );
    assert.ok(jobSteps.indexOf(candidateMetadata) < jobSteps.indexOf(build));
    assert.ok(jobSteps.indexOf(build) < jobSteps.indexOf(deploy));
    assert.ok(jobSteps.indexOf(deploy) < jobSteps.indexOf(finalize));
    assert.equal(jobSteps.at(-1), cleanup);
    const diagnostics = named(job, "browser diagnostics on failure");
    assert.equal(diagnostics.uses, UPLOAD_PIN);
    assert.doesNotMatch(JSON.stringify(workflow.jobs[job]), /\.vercel\/output/);
  }
});

test("coordinator checkpoints the forward journal before six bounded mutations and commits from final proof", () => {
  const coordinator = "activate-and-verify";
  const jobSteps = steps(coordinator);
  const barrier = command(coordinator, "stage-barrier");
  const journal = command(coordinator, "forward-journal");
  assert.match(barrier.run, /candidate-receipts/);
  assert.match(barrier.run, /app-preparation/);
  assert.match(journal.run, /--execution/);
  assert.match(journal.run, /--current-mappings/);
  assert.match(journal.run, /--candidate-receipts/);
  assert.match(journal.run, /planning-snapshot/);
  assert.match(journal.run, /snapshot --spec .*legacy-spec/);
  assert.match(journal.run, /canonical-mappings[\s\S]*forward-journal/);
  const prepared = named(coordinator, "Checkpoint prepared journal");
  const preparedCheckpoint = named(
    coordinator,
    "Materialize current-attempt prepared journal checkpoint",
  );
  const transitions = stepsUsing(
    jobSteps,
    "./.github/actions/vercel-main-active-transition",
  );
  assert.equal(transitions.length, 6);
  assert.deepEqual(
    transitions.map((step) => step.with.slot),
    ["1", "2", "3", "4", "5", "6"],
  );
  for (const transition of transitions) {
    assert.match(transition.if, /steps\.freshness\.outputs\.status == 'fresh'/);
    assert.match(
      transition.if,
      /needs\.prepare-release\.outputs\.has_active_targets == 'true'/,
    );
    assert.match(
      transition.if,
      /needs\.prepare-release\.outputs\.decision != 'verify-existing-release'/,
    );
    assert.equal(
      transition.with["app-operation-cwd"],
      "${{ steps.app-runtime.outputs.upload-source-path }}",
    );
    assert.equal(
      transition.with["vercel-cli"],
      "${{ steps.app-runtime.outputs.vercel-cli }}",
    );
    assert.equal(
      transition.env.VERCEL_TOKEN,
      "${{ secrets.VERCEL_TOKEN_PRODUCTION }}",
    );
  }
  assert.ok(jobSteps.indexOf(barrier) < jobSteps.indexOf(journal));
  assert.ok(jobSteps.indexOf(journal) < jobSteps.indexOf(prepared));
  assert.ok(jobSteps.indexOf(prepared) < jobSteps.indexOf(preparedCheckpoint));
  for (const transition of transitions) {
    assert.ok(
      jobSteps.indexOf(preparedCheckpoint) < jobSteps.indexOf(transition),
    );
  }
  const chromium = named(
    coordinator,
    "Install trusted Chromium for final public runtime checks",
  );
  assert.match(chromium.if, /steps\.freshness\.outputs\.status == 'fresh'/);
  assert.match(
    chromium.if,
    /needs\.prepare-release\.outputs\.has_active_targets == 'true'/,
  );
  assert.equal(chromium["working-directory"], "source");
  assert.match(
    chromium.run,
    /pnpm --filter app\.mento\.org exec playwright[\s\S]*install --with-deps chromium/,
  );
  const publicUrls = {
    app: "https://app.mento.org/",
    governance: "https://governance.mento.org/",
    reserve: "https://reserve.mento.org/",
    ui: "https://ui.mento.org/",
  };
  const labels = {
    app: "App",
    governance: "Governance",
    reserve: "Reserve",
    ui: "UI",
  };
  const runtimeSmokes = Object.entries(publicUrls).map(
    ([target, publicUrl]) => {
      const smoke = named(
        coordinator,
        `Run selected ${labels[target]} public runtime smoke`,
      );
      assert.match(smoke.if, /steps\.freshness\.outputs\.status == 'fresh'/);
      assert.match(
        smoke.if,
        new RegExp(
          `contains\\(fromJSON\\(needs\\.prepare-release\\.outputs\\.active_targets\\), '${target}'\\)`,
        ),
      );
      assert.equal(smoke["working-directory"], "source");
      assert.deepEqual(smoke.env, {
        DEPLOY_SHA: "${{ needs.wait-for-ci.outputs.deploy_sha }}",
        LOGICAL_TARGET: target,
        PUBLIC_URL: publicUrl,
      });
      assert.match(smoke.run, /node scripts\/vercel-main-runtime\.mjs/);
      assert.doesNotMatch(smoke.run, /vercel-production-shadow\.mjs health/);
      return smoke;
    },
  );
  assert.equal(
    jobSteps.filter((step) =>
      step.run?.includes("node scripts/vercel-main-runtime.mjs"),
    ).length,
    4,
  );
  const publicSmokes = named(
    coordinator,
    "Materialize exact public smoke results",
  );
  assert.match(
    publicSmokes.run,
    /test -s "\$runtime_proof"[\s\S]*printf 'null\\n'/,
  );
  assert.doesNotMatch(publicSmokes.run, /status=passed/);
  assert.doesNotMatch(
    jobSteps.map((step) => step.run ?? "").join("\n"),
    /vercel-production-shadow\.mjs health/,
  );
  const finalProof = named(
    coordinator,
    "fresh final mappings state census and freshness",
  );
  const finalize = command(coordinator, "active-event-finalize");
  const committedUpload = named(
    coordinator,
    "Upload the committed terminal journal",
  );
  const committedCheckpoint = named(
    coordinator,
    "Checkpoint the committed terminal journal",
  );
  const terminalArtifacts = named(
    coordinator,
    "Materialize committed terminal artifacts",
  );
  const terminalHandoff = command(coordinator, "terminal-evidence-create");
  assert.ok(jobSteps.indexOf(transitions.at(-1)) < jobSteps.indexOf(chromium));
  for (const runtimeSmoke of runtimeSmokes) {
    assert.ok(jobSteps.indexOf(chromium) < jobSteps.indexOf(runtimeSmoke));
    assert.ok(jobSteps.indexOf(runtimeSmoke) < jobSteps.indexOf(publicSmokes));
  }
  assert.ok(jobSteps.indexOf(publicSmokes) < jobSteps.indexOf(finalProof));
  assert.match(finalProof.run, /active-freshness/);
  assert.match(finalProof.run, /active-mapping-spec/);
  assert.match(finalProof.run, /current-release-mapping-spec/);
  assert.match(finalProof.run, /alias-mappings/);
  assert.match(finalProof.run, /active-state-spec/);
  assert.match(finalProof.run, /current-release-state-spec/);
  assert.match(finalProof.run, /active-proof/);
  assert.match(finalProof.run, /active-terminal-state-proof/);
  assert.match(finalProof.run, /snapshot --spec .*legacy-spec/);
  assert.match(
    finalize.run,
    /active-event-finalize[\s\S]*run-active[\s\S]*committed-journal/,
  );
  assert.ok(jobSteps.indexOf(finalProof) < jobSteps.indexOf(finalize));
  assert.ok(jobSteps.indexOf(finalize) < jobSteps.indexOf(committedUpload));
  assert.ok(
    jobSteps.indexOf(committedUpload) < jobSteps.indexOf(committedCheckpoint),
  );
  assert.ok(
    jobSteps.indexOf(committedCheckpoint) < jobSteps.indexOf(terminalArtifacts),
  );
  assert.match(
    terminalArtifacts.run,
    /terminal-artifacts[\s\S]*--outcome active-committed/,
  );
  assert.match(
    terminalArtifacts.run,
    /--state-proof "\$RUNNER_TEMP\/terminal-state-proof\.json"/,
  );
  for (const input of [
    "--final-census",
    "--final-mappings",
    "--journal-history",
    "--legacy-v2",
    "--public-smokes",
    "--stage-results",
    "--state-proof",
  ]) {
    assert.match(terminalArtifacts.run, new RegExp(input));
  }
  assert.ok(
    jobSteps.indexOf(terminalArtifacts) < jobSteps.indexOf(terminalHandoff),
  );
  assert.doesNotMatch(
    jobSteps.map((step) => step.run ?? "").join("\n"),
    /vercel-production-shadow\.mjs deploy --target app/,
  );
  assert.doesNotMatch(
    ["stage-governance", "stage-reserve", "stage-ui"]
      .flatMap(steps)
      .map((step) => step.run ?? "")
      .join("\n"),
    /--target=v3/,
  );
});

test("a complete same-release re-verifies current state without a journal or public mutation", () => {
  const coordinator = "activate-and-verify";
  const jobSteps = steps(coordinator);
  const current = named(
    coordinator,
    "Materialize an already-current release terminal without a journal",
  );
  assert.match(current.if, /steps\.freshness\.outputs\.status == 'fresh'/);
  assert.match(
    current.if,
    /needs\.prepare-release\.outputs\.has_active_targets == 'true'/,
  );
  assert.match(
    current.if,
    /needs\.prepare-release\.outputs\.decision == 'verify-existing-release'/,
  );
  assert.match(current.run, /--outcome current-release-verified/);
  assert.match(
    current.run,
    /--journal-history "\$RUNNER_TEMP\/empty-history\.json"/,
  );
  assert.match(
    current.run,
    /--freshness "\$RUNNER_TEMP\/final-freshness\.json"/,
  );
  assert.match(current.run, /--legacy-v2 "\$RUNNER_TEMP\/final-legacy\.json"/);
  assert.match(
    current.run,
    /--public-smokes "\$RUNNER_TEMP\/public-smokes\.json"/,
  );
  assert.match(
    current.run,
    /--final-census "\$RUNNER_TEMP\/terminal-state-proof\.json"/,
  );
  assert.match(
    current.run,
    /--state-proof "\$RUNNER_TEMP\/terminal-state-proof\.json"/,
  );

  const finalProof = named(
    coordinator,
    "fresh final mappings state census and freshness",
  );
  assert.match(
    finalProof.run,
    /verify-existing-release\)[\s\S]*current-release-mapping-spec[\s\S]*current-release-state-spec/,
  );
  assert.match(finalProof.run, /active-terminal-state-proof/);

  const noJournalOrMutationSteps = [
    command(coordinator, "forward-journal"),
    named(coordinator, "Stage prepared journal"),
    named(coordinator, "Checkpoint prepared journal"),
    ...stepsUsing(jobSteps, "./.github/actions/vercel-main-active-transition"),
    named(
      coordinator,
      "Finalize only the canonically proven committed journal",
    ),
    named(coordinator, "Upload the committed terminal journal"),
  ];
  for (const step of noJournalOrMutationSteps) {
    assert.match(
      step.if,
      /needs\.prepare-release\.outputs\.decision != 'verify-existing-release'/,
      step.name ?? step.uses,
    );
  }

  const publicSmokes = named(
    coordinator,
    "Materialize exact public smoke results",
  );
  assert.match(
    publicSmokes.run,
    /--app "\$RUNNER_TEMP\/app-runtime-smoke\.json"/,
  );
  assert.match(
    publicSmokes.run,
    /--governance "\$RUNNER_TEMP\/governance-runtime-smoke\.json"/,
  );
  assert.match(
    publicSmokes.run,
    /--reserve "\$RUNNER_TEMP\/reserve-runtime-smoke\.json"/,
  );
  assert.match(
    publicSmokes.run,
    /--ui "\$RUNNER_TEMP\/ui-runtime-smoke\.json"/,
  );
  assert.match(publicSmokes.run, /printf 'null\\n' > "\$runtime_proof"/);
  assert.doesNotMatch(publicSmokes.run, /status=passed/);
});

test("current-attempt recovery retains journal safety without cross-attempt artifact authority", () => {
  const recoveryJob = workflow.jobs["recover-main-deployment"];
  const identity = command(
    "recover-main-deployment",
    "active-journal-identity",
  );
  const download = steps("recover-main-deployment").find(
    (step) => step.uses === DOWNLOAD_PIN,
  );
  assert.equal(identity.id, "journal-identity");
  assert.equal(
    download.with.pattern,
    "${{ steps.journal-identity.outputs.artifact_prefix }}*",
  );
  assert.equal(download.with["run-id"], "${{ github.run_id }}");
  assert.match(download.with.path, /current-attempt-journals/);
  assert.ok(workflow.jobs["recover-main-deployment"].outputs.receipt);
  assert.ok(workflow.jobs["recover-main-deployment"].outputs.evidence);
  assert.ok(stepsUsing(recovery.runs.steps, UPLOAD_PIN).length > 0);
  assert.doesNotMatch(
    workflowSource,
    /journal_artifact_ids|prior-attempt-gate/,
  );
  assert.match(recoveryJob.if, /activate-and-verify\.result != 'success'/);
  assert.doesNotMatch(
    steps("recover-main-deployment")
      .map((step) => JSON.stringify(step))
      .join("\n"),
    /origin[-_ ]attempt|prior[-_ ]attempt/i,
  );
});

test("result restores the compact handoff then fails closed from the literal final graph", () => {
  for (const producer of ["activate-and-verify", "recover-main-deployment"]) {
    const terminal = command(producer, "terminal-evidence-create");
    assert.match(terminal.run, /terminal-evidence-create/);
    assert.equal(
      workflow.jobs[producer].outputs.receipt,
      "${{ steps.terminal.outputs.receipt }}",
    );
    assert.equal(
      workflow.jobs[producer].outputs.evidence,
      "${{ steps.terminal.outputs.evidence }}",
    );
  }
  const restore = command("result", "terminal-evidence-restore");
  assert.match(restore.run, /--receipt/);
  assert.match(restore.run, /--evidence/);
  assert.match(restore.run, /materialize/);
  assert.equal(restore["continue-on-error"], true);
  assert.equal(
    restore.env.RECOVERY_RECEIPT,
    "${{ needs.recover-main-deployment.outputs.receipt }}",
  );
  assert.equal(
    restore.env.COORDINATOR_RECEIPT,
    "${{ needs.activate-and-verify.outputs.receipt }}",
  );
  assert.doesNotMatch(
    steps("result")
      .map((step) => step.uses ?? "")
      .join("\n"),
    new RegExp(DOWNLOAD_PIN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );
  const finalActive = command("result", "final-active");
  assert.match(finalActive.run, /final-active[\s\S]*--execution/);
  assert.equal(
    finalActive.env.WAIT_FOR_CI_RESULT,
    "${{ needs.wait-for-ci.result }}",
  );
  assert.equal(
    finalActive.env.PLAN_RESULT,
    "${{ needs.prepare-release.result }}",
  );
  assert.equal(
    finalActive.env.STAGE_GOVERNANCE_RESULT,
    "${{ needs.stage-governance.result }}",
  );
  assert.equal(
    finalActive.env.STAGE_RESERVE_RESULT,
    "${{ needs.stage-reserve.result }}",
  );
  assert.equal(finalActive.env.STAGE_UI_RESULT, "${{ needs.stage-ui.result }}");
  assert.equal(
    finalActive.env.COORDINATOR_RESULT,
    "${{ needs.activate-and-verify.result }}",
  );
  assert.equal(
    finalActive.env.RECOVERY_RESULT,
    "${{ needs.recover-main-deployment.result }}",
  );
  assert.equal(
    finalActive.env.RECOVERY_OUTCOME,
    "${{ needs.recover-main-deployment.outputs.outcome || 'not-required' }}",
  );
  const finalSentinel = named(
    "result",
    "Fail after terminal evidence for an unsafe final graph",
  );
  assert.match(
    finalSentinel.run,
    /TERMINAL_RESTORED[\s\S]*FINAL_FAIL_AFTER_EVIDENCE/,
  );
  assert.match(finalSentinel.run, /test "\$FINAL_FAIL_AFTER_EVIDENCE" = false/);
  assert.doesNotMatch(finalSentinel.run, /outcome=recovered/);
  const preExecutionFailure = named(
    "result",
    "Fail closed before release execution exists",
  );
  assert.match(preExecutionFailure.if, /prepare-release\.result != 'success'/);
  assert.match(preExecutionFailure.run, /exit 1/);
  assert.match(
    deploymentSource,
    /terminal-evidence-restore[\s\S]*finalRunAttempt: values\.GITHUB_RUN_ATTEMPT/,
  );
  assert.match(terminalReceiptSource, /producer attempt exceeds final attempt/);
});

test("legacy reducer constants and action pin boundaries stay covered while old artifact admission is gone", () => {
  assert.deepEqual(MAIN_LEGACY_REQUIRED_ALIAS_TOPOLOGY, [
    "appmentoorg-git-v2-mentolabs.vercel.app",
    "appmentoorg-mentolabs.vercel.app",
    "appmentoorg.vercel.app",
    "v2-app.mento.org",
  ]);
  assert.deepEqual(
    MAIN_DURABLE_LEGACY_RECOVERY_ALIASES,
    MAIN_LEGACY_REQUIRED_ALIAS_TOPOLOGY,
  );
  assert.equal(
    MAIN_ACTIVE_MAX_RECOVERY_TRANSITIONS,
    MAIN_ORDINARY_TARGETS.length +
      MAIN_ACTIVE_APP_ALIASES.length +
      MAIN_DURABLE_LEGACY_RECOVERY_ALIASES.length,
  );
  assert.ok(MAIN_ACTIVE_COMMAND_TIMEOUT_MS > 0);
  assert.match(forwardSource, /Upload the durable intent before mutation/);
  assert.match(recoverySource, /Upload recovery intent before mutation/);
  assert.ok(stepsUsing(forward.runs.steps, UPLOAD_PIN).length > 0);
  assert.ok(stepsUsing(recovery.runs.steps, UPLOAD_PIN).length > 0);
  assert.doesNotMatch(
    forwardSource,
    /\bvercel\s+(?:promote|rollback|alias|deploy)\b/,
  );
  assert.doesNotMatch(
    recoverySource,
    /\bvercel\s+(?:promote|rollback|alias|deploy)\b/,
  );
  assert.doesNotMatch(deploymentDocs, /prior-attempt-gate/);
});

test("ordinary build adapters retain literal project and root contracts", () => {
  const expected = {
    governance: [
      "${{ vars.VERCEL_PROJECT_ID_GOVERNANCE }}",
      "apps/governance.mento.org",
    ],
    reserve: [
      "${{ vars.VERCEL_PROJECT_ID_RESERVE }}",
      "apps/reserve.mento.org",
    ],
    ui: ["${{ vars.VERCEL_PROJECT_ID_UI }}", "apps/ui.mento.org"],
  };
  for (const [target, [project, root]] of Object.entries(expected)) {
    const build = steps(`stage-${target}`).find(
      (step) => step.uses === "./.github/actions/vercel-candidate-build",
    );
    assert.equal(build.with["logical-target"], target);
    assert.equal(build.with["expected-root-directory"], root);
    assert.equal(build.with["vercel-project-id"], project);
    assert.equal(
      build.with["deploy-sha"],
      "${{ needs.wait-for-ci.outputs.deploy_sha }}",
    );
  }
});

test("root workflow keeps direct Vercel mutation commands inside reviewed adapters", () => {
  const rootRuns = Object.values(workflow.jobs)
    .flatMap((job) => job.steps ?? [])
    .map((step) => step.run ?? "")
    .join("\n");
  assert.doesNotMatch(
    rootRuns,
    /\bvercel\s+(?:promote|rollback|alias\s+set|deploy)\b/i,
  );
  assert.doesNotMatch(workflowSource, /--token\b/);
  assert.doesNotMatch(workflowSource, /\.vercel\/output/);
});
