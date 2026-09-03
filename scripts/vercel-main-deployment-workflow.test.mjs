import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

import * as mainActive from "./vercel-main-active.mjs";
import {
  MAIN_ACTIVE_COMMAND_TIMEOUT_MS,
  MAIN_ACTIVE_PROMOTABLE_TARGETS,
} from "./vercel-main-active.mjs";
import { mainDeploymentGateJobName } from "./vercel-main-ci-attempt.mjs";
import { MAIN_ACTIVE_MAX_RECOVERY_TRANSITIONS } from "./vercel-main-deployment.mjs";

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
const productionShadowCli = fileURLToPath(
  new URL("./vercel-production-shadow.mjs", import.meta.url),
);
const pnpmInstallAction = parse(
  read(".github/actions/pnpm-install/action.yml"),
);

const CHECKOUT = "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1";
const UPLOAD_PIN =
  "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a";
const DOWNLOAD_PIN =
  "actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c";

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
  // A workflow-level `run-name` would replace this workflow's REST `name`
  // field, which `.github/workflows/ci-failure-notifier.yml` and
  // `scripts/ci-failure-issue.mjs` use to identify it.
  assert.equal(workflow["run-name"], undefined);
  assert.deepEqual(Object.keys(workflow.jobs), [
    "wait-for-ci",
    "require-ci-success",
    "provider-preplan",
    "restore-inherited-release",
    "prepare-release",
    "stage-app",
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
      types: ["requested", "completed"],
      branches: ["main"],
    },
  });
  const admission = workflow.jobs["wait-for-ci"];
  assert.equal(
    admission.if,
    "github.event.workflow_run.event == 'push' && " +
      "github.event.workflow_run.head_branch == 'main' && " +
      "(github.event.action == 'requested' || " +
      "(github.event.action == 'completed' && " +
      "github.event.workflow_run.conclusion == 'success'))",
  );
  // Admission publishes no sentinel evidence: GitHub creates the `Build and
  // Test` job record only once its `needs` resolve, so a `requested` delivery
  // admits minutes before it exists. `require-ci-success` derives it instead.
  assert.deepEqual(admission.outputs, {
    deploy_sha: "${{ steps.ci.outputs.deploy_sha }}",
    upstream_run_id: "${{ steps.ci.outputs.upstream_run_id }}",
    upstream_run_attempt: "${{ steps.ci.outputs.upstream_run_attempt }}",
    upstream_run_url: "${{ steps.ci.outputs.upstream_run_url }}",
    admission_mode: "${{ steps.ci.outputs.admission_mode }}",
    deploy_mode: "${{ steps.ci.outputs.deploy_mode }}",
    duplicate_of_run_url: "${{ steps.ci.outputs.duplicate_of_run_url }}",
  });
  assert.equal(
    admission.env.DEPLOY_SHA,
    "${{ github.event.workflow_run.head_sha }}",
  );
  assert.equal(
    command("wait-for-ci", "vercel-main-ci-attempt.mjs admit").env.GITHUB_TOKEN,
    "${{ github.token }}",
  );
  assert.equal(
    steps("wait-for-ci").some((step) =>
      step.run?.includes("vercel-main-ci-attempt.mjs verify"),
    ),
    false,
    "admission no longer owns the terminal CI verdict",
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
  const sourceProofStep = command("wait-for-ci", "validate-source");
  assert.match(sourceProofStep.run, /fetch --no-tags origin/);
  // Only the deduplicated no-op run may skip the source proof; every run that
  // can reach a provider write still proves it.
  assert.equal(checkouts[1].if, "steps.ci.outputs.deploy_mode == 'deploy'");
  assert.equal(sourceProofStep.if, "steps.ci.outputs.deploy_mode == 'deploy'");
  assert.doesNotMatch(
    workflowSource,
    /github\.sha|deployments:\s*write|secrets:\s*inherit/,
  );
});

const MUTATION_ADAPTERS = [
  "./.github/actions/vercel-main-active-transition",
  "./.github/actions/vercel-main-active-recovery-transition",
  "./.github/actions/vercel-candidate-build",
];

function mutationJobs() {
  return Object.entries(workflow.jobs)
    .filter(([, job]) =>
      (job.steps ?? []).some((step) => MUTATION_ADAPTERS.includes(step.uses)),
    )
    .map(([name]) => name);
}

function transitiveNeeds(jobName, seen = new Set()) {
  for (const dependency of workflow.jobs[jobName].needs ?? []) {
    if (seen.has(dependency)) continue;
    seen.add(dependency);
    transitiveNeeds(dependency, seen);
  }
  return seen;
}

function subcommandsOf(step) {
  return [
    ...String(step.run ?? "").matchAll(
      /node scripts\/([A-Za-z0-9-]+\.mjs) ([a-z0-9-]+)/g,
    ),
  ].map((match) => `${match[1]} ${match[2]}`);
}

// The exact-attempt CI verdict has two placement forms: a `require-ci-success`
// `needs` edge, or this literal step run inside the job itself. The in-job form
// protects only the steps after it, so its index is asserted against every
// credentialed or mutating step in the same job.
const IN_JOB_GATE_RUN =
  "node scripts/vercel-main-ci-attempt.mjs require-success";

// Mutation jobs allowed to substitute an in-job gate for the gate `needs` edge.
// `stage-*`, `activate-and-verify`, and `recover-main-deployment` may never be
// converted to that form.
const IN_JOB_GATED_MUTATORS = ["restore-inherited-release"];

const GATE_NAME_TEMPLATE = mainDeploymentGateJobName("<runId>", "<runAttempt>");
const GATE_NAME_PREFIX = GATE_NAME_TEMPLATE.slice(
  0,
  GATE_NAME_TEMPLATE.indexOf("<runId>"),
);

const MUTATION_REACH =
  /vercel-main-active-transition|vercel-main-active-recovery-transition|vercel-candidate-build|vercel-protected-runtime|vercel-production-shadow\.mjs (?:pull|deploy)|candidate-finalize|promote|--skip-domain/;

function inJobGateIndex(jobName) {
  return steps(jobName).findIndex((step) =>
    String(step.run ?? "").includes(IN_JOB_GATE_RUN),
  );
}

function preGateBoundary(jobName) {
  const gateIndex = inJobGateIndex(jobName);
  return gateIndex === -1 ? steps(jobName).length : gateIndex;
}

function credentialOrMutationIndexes(jobName) {
  return steps(jobName).flatMap((step, index) =>
    /secrets\./.test(JSON.stringify(step)) ||
    MUTATION_ADAPTERS.includes(step.uses ?? "")
      ? [index]
      : [],
  );
}

test("the exact-attempt success gate is credential-free and precedes every provider write", () => {
  const gate = workflow.jobs["require-ci-success"];
  // The exact upstream attempt is bound into the gate job's name; the
  // duplicate-run probe matches that literal.
  assert.equal(
    gate.name,
    mainDeploymentGateJobName(
      "${{ github.event.workflow_run.id }}",
      "${{ github.event.workflow_run.run_attempt }}",
    ),
  );
  assert.deepEqual(gate.needs, ["wait-for-ci"]);
  assert.equal(gate.if, "needs.wait-for-ci.outputs.deploy_mode == 'deploy'");
  assert.equal(gate["timeout-minutes"], 35);
  assert.equal(gate.environment, undefined);
  assert.equal(gate.permissions, undefined);
  assert.deepEqual(gate.env, {
    DEPLOY_SHA: "${{ needs.wait-for-ci.outputs.deploy_sha }}",
    UPSTREAM_RUN_ID: "${{ needs.wait-for-ci.outputs.upstream_run_id }}",
    UPSTREAM_RUN_ATTEMPT:
      "${{ needs.wait-for-ci.outputs.upstream_run_attempt }}",
  });
  // The gate is the earliest job in which the sentinel job record is
  // guaranteed to exist, so it is the sole producer of that evidence.
  assert.deepEqual(gate.outputs, {
    build_and_test_job_url: "${{ steps.gate.outputs.build_and_test_job_url }}",
  });
  assert.equal(command("require-ci-success", "require-success").id, "gate");

  // Every `BUILD_AND_TEST_JOB_URL` binding in the workflow, at whatever scope,
  // with the owning step id when the binding is on a step.
  const sentinelBindings = stringsWithPaths(workflow)
    .filter(({ path }) => path.at(-1) === "BUILD_AND_TEST_JOB_URL")
    .map(({ path, value }) => {
      assert.equal(path[0], "jobs", "the sentinel is never bound above a job");
      const jobName = path[1];
      const scope =
        path[2] === "steps"
          ? (steps(jobName)[path[3]].id ?? `step ${path[3]}`)
          : "job";
      return [jobName, scope, value];
    });
  assert.deepEqual(sentinelBindings, [
    [
      "prepare-release",
      "execution",
      "${{ steps.gate.outputs.build_and_test_job_url }}",
    ],
    [
      "activate-and-verify",
      "job",
      "${{ needs.require-ci-success.outputs.build_and_test_job_url }}",
    ],
    [
      "recover-main-deployment",
      "job",
      "${{ needs.require-ci-success.outputs.build_and_test_job_url }}",
    ],
  ]);

  // Whichever placement form a reader uses, the verdict it cites must already
  // be proven: a gate-job output requires the gate `needs` edge, and an in-job
  // step output requires a `gate` step at a strictly lower index.
  for (const { path, value } of stringsWithPaths(workflow)) {
    if (value.includes("needs.require-ci-success.outputs.")) {
      assert.equal(path[0], "jobs");
      assert.ok(
        (workflow.jobs[path[1]].needs ?? []).includes("require-ci-success"),
        `${path[1]} reads the gate output and must depend on the gate`,
      );
    }
    if (!value.includes("steps.gate.outputs.build_and_test_job_url")) continue;
    assert.equal(path[0], "jobs");
    const jobName = path[1];
    const gateIndex = inJobGateIndex(jobName);
    assert.ok(
      gateIndex >= 0,
      `${jobName} reads an in-job sentinel and must run the gate CLI in-job`,
    );
    assert.equal(steps(jobName)[gateIndex].id, "gate");
    if (path[2] === "steps") {
      assert.ok(
        path[3] > gateIndex,
        `${jobName} may read the in-job sentinel only after its gate step`,
      );
    }
  }

  const gateSteps = steps("require-ci-success");
  assert.equal(gateSteps.length, 3);
  const checkouts = checkoutSteps("require-ci-success");
  assert.equal(checkouts.length, 1);
  assert.deepEqual(checkouts[0].with, {
    "fetch-depth": 1,
    "persist-credentials": false,
    ref: "${{ github.workflow_sha }}",
  });
  assert.deepEqual(
    gateSteps.filter((step) => step.run).map((step) => step.run),
    [
      "node scripts/vercel-main-deployment.mjs validate-context",
      "node scripts/vercel-main-ci-attempt.mjs require-success",
    ],
  );
  assert.equal(
    command("require-ci-success", "require-success").env.GITHUB_TOKEN,
    "${{ github.token }}",
  );
  assert.doesNotMatch(JSON.stringify(gate), /secrets\.|VERCEL_/);
  for (const step of gateSteps) {
    assert.equal(
      MUTATION_ADAPTERS.includes(step.uses ?? ""),
      false,
      "the gate never reaches a mutation adapter",
    );
    assert.equal(
      step.uses === "./.github/actions/pnpm-install",
      false,
      "the gate never installs candidate source",
    );
  }
});

test("the sentinel job record cannot exist while a requested delivery admits", () => {
  // GitHub creates a job record only once that job's `needs` resolve. The
  // upstream sentinel depends on the whole quality fan-out, so it appears
  // seconds before `CI/CD` concludes — minutes after the `requested` delivery
  // admits. Requiring it at admission would make every early run fail closed
  // and would delete the overlap this workflow exists for, so admission must
  // stay clear of the attempt's jobs endpoint.
  const upstream = parse(read(".github/workflows/ci.yml"));
  const sentinel = Object.values(upstream.jobs).filter(
    (job) => job.name === "Build and Test",
  );
  assert.equal(sentinel.length, 1);
  assert.ok(
    (sentinel[0].needs ?? []).length > 0,
    "the sentinel must still depend on other CI jobs",
  );

  const admission = workflow.jobs["wait-for-ci"];
  assert.doesNotMatch(
    JSON.stringify(admission),
    /build_and_test_job/,
    "admission may not publish evidence it cannot observe",
  );
  const attemptSource = read("scripts/vercel-main-ci-attempt.mjs");
  const early = attemptSource.slice(
    attemptSource.indexOf("async function admitEarlyAttempt"),
  );
  assert.doesNotMatch(
    early.slice(0, early.indexOf("\n}\n") + 3),
    /listMainCiAttemptJobs|SENTINEL/,
    "early admission may not read or wait for the attempt's jobs",
  );

  // `require-success` runs in three places. Only the gate job's own record is
  // an artifact of the duplicate-run probe, which matches a job NAME: an in-job
  // step never appears in the attempt's jobs listing, so the two overlapping
  // invocations cannot mint a second gate marker or break the probe's
  // `gates.length === 1` requirement.
  assert.deepEqual(
    Object.keys(workflow.jobs).filter(
      (jobName) => inJobGateIndex(jobName) !== -1,
    ),
    ["require-ci-success", "restore-inherited-release", "prepare-release"],
  );
  assert.deepEqual(
    Object.entries(workflow.jobs)
      .filter(([, job]) => String(job.name ?? "").startsWith(GATE_NAME_PREFIX))
      .map(([jobName]) => jobName),
    ["require-ci-success"],
    "only the gate job may carry the marker the duplicate probe matches",
  );
});

test("every public-mutation job requires the exact-attempt CI success gate", () => {
  const mutators = mutationJobs();
  assert.deepEqual(mutators, [
    "restore-inherited-release",
    "stage-app",
    "stage-governance",
    "stage-reserve",
    "stage-ui",
    "activate-and-verify",
    "recover-main-deployment",
  ]);
  // Only the pinned set may substitute an in-job gate for the gate edge; every
  // other mutator must keep the graph edge.
  assert.deepEqual(
    mutators.filter((jobName) => inJobGateIndex(jobName) !== -1),
    IN_JOB_GATED_MUTATORS,
  );
  for (const jobName of mutators) {
    const job = workflow.jobs[jobName];
    if (IN_JOB_GATED_MUTATORS.includes(jobName)) {
      assert.equal(
        (job.needs ?? []).includes("require-ci-success"),
        false,
        `${jobName} substitutes an in-job gate for the gate edge`,
      );
      const gateIndex = inJobGateIndex(jobName);
      const gateStep = steps(jobName)[gateIndex];
      assert.equal(gateStep.id, "gate");
      assert.equal(gateStep.run, IN_JOB_GATE_RUN);
      assert.deepEqual(gateStep.env, { GITHUB_TOKEN: "${{ github.token }}" });
      assert.doesNotMatch(JSON.stringify(gateStep), /secrets\.|VERCEL_/);
      for (const index of credentialOrMutationIndexes(jobName)) {
        assert.ok(
          gateIndex < index,
          `${jobName} must run its in-job gate before step ${index}`,
        );
      }
      // An in-job gate protects only the steps after it, so implicit
      // needs-success must still bind everything before it.
      assert.doesNotMatch(
        String(job.if ?? ""),
        /always\(\)/,
        `${jobName} must keep implicit needs-success for its pre-gate prefix`,
      );
      continue;
    }
    assert.ok(
      (job.needs ?? []).includes("require-ci-success"),
      `${jobName} must depend on the CI success gate`,
    );
    if (String(job.if ?? "").includes("always()")) {
      // `always()` disables implicit needs-success, so the gate result must be
      // asserted literally.
      assert.match(
        job.if,
        /needs\.require-ci-success\.result == 'success'/,
        `${jobName} overrides implicit needs-success and must assert the gate`,
      );
    }
  }

  // Every job that can start before the gate job concludes, and the
  // credentialed subset of it.
  const preGate = Object.keys(workflow.jobs).filter(
    (jobName) =>
      jobName !== "require-ci-success" &&
      !transitiveNeeds(jobName).has("require-ci-success"),
  );
  assert.deepEqual(preGate, [
    "wait-for-ci",
    "provider-preplan",
    "restore-inherited-release",
    "prepare-release",
  ]);
  assert.deepEqual(
    preGate.filter((jobName) => workflow.jobs[jobName].environment),
    ["provider-preplan", "restore-inherited-release", "prepare-release"],
  );
});

test("pre-gate credentialed jobs execute only read-only provider commands", () => {
  const readOnly = new Set([
    "vercel-main-deployment.mjs validate-context",
    "vercel-main-deployment.mjs validate-source",
    "vercel-main-deployment.mjs create-spec",
    "vercel-deployment-state.mjs planning-snapshot",
    "vercel-deployment-state.mjs snapshot",
    "vercel-main-provider-cli.mjs preplan-discover",
    "vercel-main-provider-cli.mjs preplan-decide",
  ]);
  // The allowlist above never widens. A `secrets.`-bearing pre-gate step is
  // legal only while every node subcommand it runs is on this list, which is
  // why such a step may never be a composite action.
  for (const jobName of [
    "wait-for-ci",
    "provider-preplan",
    "restore-inherited-release",
    "prepare-release",
  ]) {
    const jobSteps = steps(jobName);
    const boundary = preGateBoundary(jobName);
    for (const step of jobSteps.slice(0, boundary)) {
      for (const subcommand of subcommandsOf(step)) {
        assert.ok(
          readOnly.has(subcommand) ||
            subcommand === "vercel-main-ci-attempt.mjs admit",
          `${jobName} may not run ${subcommand} before the CI success gate`,
        );
      }
      assert.equal(
        /secrets\./.test(JSON.stringify(step)) && step.uses !== undefined,
        false,
        `${jobName} may not hand a credential to a composite action before the CI success gate`,
      );
    }
    assert.doesNotMatch(
      JSON.stringify({
        ...workflow.jobs[jobName],
        steps: jobSteps.slice(0, boundary),
      }),
      MUTATION_REACH,
      `${jobName} may not reach a mutation adapter before the CI success gate`,
    );
  }
});

test("provider preplan retries only typed drift with one wholly fresh observation epoch", () => {
  const job = workflow.jobs["provider-preplan"];
  assert.deepEqual(job.needs, ["wait-for-ci"]);
  assert.equal(job.if, "needs.wait-for-ci.outputs.deploy_mode == 'deploy'");
  assert.equal(job["timeout-minutes"], 20);
  assert.deepEqual(job.environment, {
    name: "vercel-cli-production",
    deployment: false,
  });
  const capture = command("provider-preplan", "planning-snapshot");
  assert.match(capture.run, /create-spec --scope main/);
  assert.doesNotMatch(capture.run, /legacy/);
  assert.match(
    command("provider-preplan", "preplan-discover").run,
    /--planning-snapshot .*--project-ids/,
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
    /planning-snapshot[\s\S]*planning-retry\.json[\s\S]*preplan-discover[\s\S]*discovery-retry\.json[\s\S]*preplan-decide[\s\S]*preplan-retry\.json/,
  );
  for (const [retryFile, expectedReferences] of Object.entries({
    "planning-retry.json": 3,
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
    filter: "frontend-monorepo",
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
  assert.equal(pnpmInstallAction.inputs.filter.required, false);
  assert.equal(pnpmInstallAction.inputs.filter.default, "");
  assert.deepEqual(isolatedInstall.env, {
    INSTALL_FILTER: "${{ inputs.filter }}",
  });
  assert.equal(
    isolatedInstall.run,
    [
      "set --",
      'if [ -n "$INSTALL_FILTER" ]; then',
      '  set -- --filter "$INSTALL_FILTER"',
      "fi",
      "env -u GITHUB_ENV -u GITHUB_OUTPUT -u GITHUB_PATH -u GITHUB_STATE \\",
      '  -u GITHUB_STEP_SUMMARY pnpm "$@" install --frozen-lockfile --ignore-scripts --ignore-pnpmfile',
      "",
    ].join("\n"),
  );
  const scriptedInstall = pnpmInstallAction.runs.steps.find(
    (step) => step.name === "Install dependencies",
  );
  assert.equal(scriptedInstall.if, "inputs.ignore-scripts != 'true'");
  assert.deepEqual(scriptedInstall.env, {
    INSTALL_FILTER: "${{ inputs.filter }}",
  });
  assert.equal(
    scriptedInstall.run,
    [
      "set --",
      'if [ -n "$INSTALL_FILTER" ]; then',
      '  set -- --filter "$INSTALL_FILTER"',
      "fi",
      "env -u GITHUB_ENV -u GITHUB_OUTPUT -u GITHUB_PATH -u GITHUB_STATE \\",
      '  -u GITHUB_STEP_SUMMARY pnpm "$@" install --frozen-lockfile',
      "",
    ].join("\n"),
  );
});

test("every workflow install narrows pnpm to the root workspace project", () => {
  const installs = Object.entries(workflow.jobs).flatMap(([jobName, job]) =>
    stepsUsing(job.steps ?? [], "./.github/actions/pnpm-install").map(
      (step) => [jobName, step],
    ),
  );
  assert.equal(installs.length, 9);
  for (const [jobName, install] of installs) {
    assert.equal(install.with.filter, "frontend-monorepo", jobName);
  }
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
  assert.doesNotMatch(
    job.if,
    /always\(\)/,
    "implicit needs-success binds the pre-gate prefix and the in-job gate binds the CI verdict",
  );
  // The in-job gate can consume the CLI's 30-minute bounded await before this
  // job's own recovery budget starts.
  assert.equal(job["timeout-minutes"], 90);
  // This job derives no sentinel and reads none: the only reader of
  // `BUILD_AND_TEST_JOB_URL` is `prepare-release`'s execution step.
  assert.equal(job.env.BUILD_AND_TEST_JOB_URL, undefined);
  assert.deepEqual(job.environment, {
    name: "vercel-cli-production",
    deployment: false,
  });
  assert.equal(job.outputs.outcome, "${{ steps.outcome.outputs.outcome }}");

  // Only the credential-free immutable controller checkout may precede the
  // in-job gate, so the pre-gate surface is trivially read-only.
  assert.equal(jobSteps[0].uses, CHECKOUT);
  assert.equal(jobSteps[0].with.ref, "${{ github.workflow_sha }}");
  assert.equal(inJobGateIndex(jobName), 1);

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
  assert.match(proof.run, /validate-recovery-source/);
  assert.doesNotMatch(proof.run, /\bvalidate-source\b/);
  const install = named(jobName, "without lifecycle scripts");
  assert.deepEqual(install.with, {
    "working-directory": "source",
    "ignore-scripts": "true",
    filter: "frontend-monorepo",
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
  const journalDeploySha = named(
    jobName,
    "Bind inherited journal deployment SHA",
  );
  assert.deepEqual(journalDeploySha.env, {
    INHERITED_JOURNAL_DEPLOY_SHA:
      "${{ steps.inherited.outputs.inherited_journal_deploy_sha }}",
  });
  assert.match(
    journalDeploySha.run,
    /INHERITED_JOURNAL_DEPLOY_SHA" =~ \^\[0-9a-f\]\{40\}\$/,
  );
  assert.match(
    journalDeploySha.run,
    /MAIN_ACTIVE_JOURNAL_DEPLOY_SHA=%s\\n.*INHERITED_JOURNAL_DEPLOY_SHA.*GITHUB_ENV/,
  );
  assert.doesNotMatch(journalDeploySha.run, /(?:^|[^A-Z_])DEPLOY_SHA=/);
  assert.equal(
    jobSteps.indexOf(inherited) + 1,
    jobSteps.indexOf(journalDeploySha),
  );
  const mappingSpecs = named(jobName, "inherited mapping specifications");
  assert.match(mappingSpecs.run, /create-spec --scope main/);
  assert.doesNotMatch(mappingSpecs.run, /legacy/);

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
    // Inherited restoration always finalizes the candidate the reviewed alias
    // currently serves, so every target — App included — proves its protected
    // alias through the served-prior contract, never the candidate contract.
    assert.match(
      finalize.run,
      new RegExp(
        "candidate-smoke[\\s\\S]*vercel-main-provider-cli\\.mjs candidate-finalize-inherited --intent",
      ),
    );
    assert.doesNotMatch(
      finalize.run,
      /vercel-main-provider-cli\.mjs candidate-finalize --intent/,
    );
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
  assert.doesNotMatch(authoritativeMappings.run, /legacy/);
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
    /--preplan[\s\S]*--current-mappings[\s\S]*--candidate-receipts[\s\S]*--journal-output[\s\S]*--plan-output/,
  );
  assert.ok(jobSteps.indexOf(journalDeploySha) < jobSteps.indexOf(journal));

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
  assert.ok(
    jobSteps.indexOf(journalDeploySha) < jobSteps.indexOf(preparedCheckpoint),
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
  // Four mutation slots — one rollback per main target — plus the terminal
  // slot that turns an unrecovered head into a terminal status.
  assert.equal(transitions.length, MAIN_ACTIVE_MAX_RECOVERY_TRANSITIONS + 1);
  assert.deepEqual(
    transitions.map((step) => step.with.slot),
    Array.from(
      { length: MAIN_ACTIVE_MAX_RECOVERY_TRANSITIONS + 1 },
      (_, index) => String(index + 1),
    ),
  );
  assert.deepEqual(
    transitions.map((step) => step.with.slot),
    ["1", "2", "3", "4", "5"],
  );
  assert.equal(
    named(jobName, "Restore terminal inherited transition 5").with.slot,
    "5",
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
  const inheritedHistorySteps = jobSteps.filter((step) =>
    step.run?.includes("active-journal-history"),
  );
  assert.ok(inheritedHistorySteps.length > 0);
  for (const history of inheritedHistorySteps) {
    assert.ok(jobSteps.indexOf(journalDeploySha) < jobSteps.indexOf(history));
  }
  for (const transition of transitions) {
    assert.ok(
      jobSteps.indexOf(journalDeploySha) < jobSteps.indexOf(transition),
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
  for (const [name, otherJob] of Object.entries(workflow.jobs)) {
    if (name === jobName) continue;
    assert.doesNotMatch(
      JSON.stringify(otherJob),
      /MAIN_ACTIVE_JOURNAL_DEPLOY_SHA/,
      `${name} must not override the inherited journal deployment SHA`,
    );
  }
});

test("only inherited restoration uses inherited candidate finalization", () => {
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
    {
      jobName: "restore-inherited-release",
      id: "inherited-app-finalize",
    },
  ]);
  assert.doesNotMatch(
    `${forwardSource}\n${recoverySource}`,
    /candidate-finalize-inherited/,
  );
  assert.doesNotMatch(workflowSource, /--alias-topology-mode/);

  for (const target of ["app", "governance", "reserve", "ui"]) {
    const finalize = command(`stage-${target}`, "candidate-finalize");
    assert.match(
      finalize.run,
      /vercel-main-provider-cli\.mjs candidate-finalize --intent/,
    );
    assert.doesNotMatch(finalize.run, /candidate-finalize-inherited/);
  }
  // A served-prior candidate carries the reviewed protected alias, which the
  // candidate contract forbids, so inherited App restoration cannot re-enter
  // the ordinary `candidate-finalize` path.
  assert.doesNotMatch(
    workflow.jobs["restore-inherited-release"].steps.find(
      (step) => step.id === "inherited-app-finalize",
    ).run,
    /vercel-main-provider-cli\.mjs candidate-finalize --intent/,
  );
  // The coordinator no longer finalizes any candidate: every stage job owns
  // its own smoke and receipt.
  assert.equal(
    steps("activate-and-verify").some((step) =>
      step.run?.includes("candidate-finalize"),
    ),
    false,
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
  // Dropping the gate `needs` edge also dropped the cancellation guard that
  // edge provided, so the condition must assert `!cancelled()` literally.
  assert.match(normalizedCondition, /!cancelled\(\)/);
  assert.match(normalizedCondition, /needs\.wait-for-ci\.result == 'success'/);
  // Every step of this job is read-only, so it takes no gate edge at all; its
  // in-job gate below binds the verdict before the sentinel is consumed.
  assert.doesNotMatch(normalizedCondition, /require-ci-success/);
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
  // The gate is the penultimate step, so the census budget runs first and the
  // CLI's 30-minute bounded await starts after it. The budget must be the sum
  // (25 + 30) or a slow CI attempt dies on GitHub's generic job timeout instead
  // of the CLI's fail-closed bounded-await error.
  assert.equal(job["timeout-minutes"], 55);
  assert.deepEqual(
    Object.fromEntries(
      [
        "DEPLOY_SHA",
        "UPSTREAM_RUN_ID",
        "UPSTREAM_RUN_ATTEMPT",
        "UPSTREAM_RUN_URL",
      ].map((name) => [name, job.env[name]]),
    ),
    {
      DEPLOY_SHA: "${{ needs.wait-for-ci.outputs.deploy_sha }}",
      UPSTREAM_RUN_ID: "${{ needs.wait-for-ci.outputs.upstream_run_id }}",
      UPSTREAM_RUN_ATTEMPT:
        "${{ needs.wait-for-ci.outputs.upstream_run_attempt }}",
      UPSTREAM_RUN_URL: "${{ needs.wait-for-ci.outputs.upstream_run_url }}",
    },
  );
  // A job-level `env:` cannot read `steps.*`, so the sentinel binds on the one
  // step that consumes it.
  assert.equal(job.env.BUILD_AND_TEST_JOB_URL, undefined);

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
    filter: "frontend-monorepo",
  });
  const protectedSteps = jobSteps.filter(
    (step) =>
      step.env?.VERCEL_TOKEN === "${{ secrets.VERCEL_TOKEN_PRODUCTION }}",
  );
  assert.deepEqual(
    protectedSteps.map((step) => step.name),
    [
      "Capture a wholly fresh main snapshot",
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
  const snapshots = named(jobName, "wholly fresh main snapshot");
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
  assert.doesNotMatch(specs.run, /legacy/);
  assert.match(snapshots.run, /planning-snapshot/);
  assert.doesNotMatch(snapshots.run, /legacy/);
  assert.match(discovery.run, /--planning-snapshot[\s\S]*--project-ids/);
  assert.match(
    decision.run,
    /preplan-decide[\s\S]*--discovery[\s\S]*--planning-snapshot/,
  );
  assert.doesNotMatch(decision.run, /legacy/);
  assert.equal(
    rejectRestore.env.DECISION,
    "${{ steps.decide.outputs.decision }}",
  );
  assert.match(rejectRestore.run, /!= restore-before-planning/);
  assert.equal(execution.id, "execution");
  assert.match(
    execution.run,
    /release-cli\.mjs execution[\s\S]*--preplan[\s\S]*--discovery[\s\S]*--planning-snapshot/,
  );
  assert.equal(
    execution.env.BUILD_AND_TEST_JOB_URL,
    "${{ steps.gate.outputs.build_and_test_job_url }}",
  );
  assert.doesNotMatch(JSON.stringify(execution), /secrets\./);
  assert.ok(jobSteps.indexOf(install) < jobSteps.indexOf(specs));
  assert.ok(jobSteps.indexOf(specs) < jobSteps.indexOf(snapshots));
  assert.ok(jobSteps.indexOf(snapshots) < jobSteps.indexOf(discovery));
  assert.ok(jobSteps.indexOf(discovery) < jobSteps.indexOf(decision));
  assert.ok(jobSteps.indexOf(decision) < jobSteps.indexOf(rejectRestore));

  // The gate is the penultimate step: the whole read-only census overlaps CI,
  // the fresh-census check still runs before the verdict, and the single
  // sentinel-consuming step runs after it.
  const gateIndex = inJobGateIndex(jobName);
  assert.equal(gateIndex, jobSteps.length - 2);
  assert.equal(jobSteps[gateIndex].id, "gate");
  assert.equal(jobSteps[gateIndex].run, IN_JOB_GATE_RUN);
  assert.deepEqual(jobSteps[gateIndex].env, {
    GITHUB_TOKEN: "${{ github.token }}",
  });
  assert.ok(jobSteps.indexOf(rejectRestore) < gateIndex);
  assert.equal(jobSteps.indexOf(execution), gateIndex + 1);
});

test("every main target materializes execution and uses create-or-reuse provider handoffs", () => {
  for (const target of ["app", "governance", "reserve", "ui"]) {
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
      /needs\.require-ci-success\.result == 'success'/,
      `${target} exact-CI success gate`,
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

test("App stages its production candidate exactly like every other target", () => {
  const jobName = "stage-app";
  const job = workflow.jobs[jobName];
  const jobSteps = steps(jobName);
  assert.deepEqual(job.needs, [
    "wait-for-ci",
    "require-ci-success",
    "prepare-release",
  ]);
  assert.equal(
    job.if.replace(/\s+/g, " ").trim(),
    "always() && !cancelled() && needs.wait-for-ci.result == 'success' && " +
      "needs.require-ci-success.result == 'success' && " +
      "needs.prepare-release.result == 'success' && " +
      "contains(fromJSON(needs.prepare-release.outputs.targets), 'app')",
  );
  assert.equal(job["timeout-minutes"], 50);
  assert.deepEqual(job.environment, {
    name: "vercel-cli-production",
    deployment: false,
  });
  assert.equal(job.env.LOGICAL_TARGET, "app");
  assert.equal(job.env.VERCEL_TOKEN, undefined);
  // The App stage now hands over a candidate receipt like the ordinary stages;
  // the retired same-run custom-v3 payload handoff has no output left.
  assert.deepEqual(job.outputs, {
    receipt: "${{ steps.finalize.outputs.receipt }}",
    evidence: "${{ steps.terminal.outputs.evidence }}",
  });
  for (const retired of [
    "action",
    "candidate_id",
    "payload_artifact",
    "payload_attempt",
    "payload_bytes",
    "payload_sha256",
  ]) {
    assert.equal(job.outputs[retired], undefined, retired);
  }
  const jobSource = JSON.stringify(job);
  assert.doesNotMatch(jobSource, /app-v3-payload|app-v3-output|--target v3/);
  assert.doesNotMatch(jobSource, /VERCEL_TARGET_ENV.{0,4}v3/);

  const deploy = command(jobName, 'vercel-production-shadow.mjs" deploy');
  assert.equal(deploy.if, "steps.preflight.outputs.action == 'create'");
  assert.match(deploy.run, /--candidate-metadata /);
  assert.match(deploy.run, /--expected /);
  assert.equal(
    deploy.env.SOURCE_PATH,
    "${{ steps.runtime.outputs.upload-source-path }}",
  );
  const finalize = command(jobName, "candidate-finalize");
  assert.match(finalize.run, /candidate-smoke/);
  assert.match(finalize.run, /--preflight /);

  const build = named(jobName, "Build and upload app");
  assert.equal(build.if, "steps.preflight.outputs.action == 'create'");
  assert.equal(build.uses, "./.github/actions/vercel-candidate-build");
  assert.equal(build.with["logical-target"], "app");
  assert.equal(build.with["expected-root-directory"], "apps/app.mento.org");
  assert.equal(
    build.with["vercel-project-id"],
    "${{ vars.VERCEL_PROJECT_ID_APP }}",
  );
  assert.equal(build.env.VERCEL_ENV, "production");
  assert.equal(build.env.VERCEL_TARGET_ENV, "production");
  assert.equal(build.env.NEXT_PUBLIC_VERCEL_ENV, "production");
  assert.equal(build.env.SENTRY_AUTH_TOKEN, "${{ secrets.SENTRY_AUTH_TOKEN }}");
  assert.equal(build.env.ETHERSCAN_API_KEY, undefined);

  const cleanup = named(jobName, "Remove authenticated app runtime");
  assert.equal(cleanup.if, "${{ always() }}");
  assert.deepEqual(cleanup.with, {
    operation: "cleanup",
    "logical-target": "app",
  });
  assert.equal(jobSteps.at(-1), cleanup);
});

test("active coordinator validates stage receipts and never builds or deploys", () => {
  const jobName = "activate-and-verify";
  const coordinator = workflow.jobs[jobName];
  const jobSteps = steps(jobName);
  assert.deepEqual(coordinator.needs, [
    "wait-for-ci",
    "require-ci-success",
    "prepare-release",
    "stage-app",
    "stage-governance",
    "stage-reserve",
    "stage-ui",
  ]);
  assert.equal(
    coordinator.if.replace(/\s+/g, " "),
    "always() && !cancelled() && " +
      "needs.require-ci-success.result == 'success' && " +
      "needs.prepare-release.result == 'success'",
  );
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
    filter: "frontend-monorepo",
  });
  assert.ok(jobSteps.indexOf(proof) < jobSteps.indexOf(install));

  const stageValidation = named(jobName, "Validate literal stage results");
  for (const target of ["APP", "GOVERNANCE", "RESERVE", "UI"]) {
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
  // The App stage hands over a candidate receipt like every other stage; the
  // retired same-run payload identity has no environment left.
  assert.deepEqual(
    Object.fromEntries(
      [
        "APP_ACTION",
        "APP_ACTIVE",
        "APP_PAYLOAD_ATTEMPT",
        "APP_PAYLOAD_SHA256",
      ].map((name) => [name, stageValidation.env[name]]),
    ),
    {
      APP_ACTION: undefined,
      APP_ACTIVE: undefined,
      APP_PAYLOAD_ATTEMPT: undefined,
      APP_PAYLOAD_SHA256: undefined,
    },
  );
  assert.match(stageValidation.run, /validate_stage app /);
  assert.match(stageValidation.run, /test "\$result" = success/);
  assert.match(stageValidation.run, /test "\$receipt" != none/);
  assert.match(stageValidation.run, /test "\$result" = skipped/);
  assert.match(stageValidation.run, /test "\$receipt" = none/);
  // The retired same-run App payload handoff cannot re-enter the coordinator.
  assert.doesNotMatch(
    JSON.stringify(coordinator),
    /payload_sha256|payload_artifact|payload_bytes|payload_attempt|app-v3-payload/,
  );
  const freshness = named(jobName, "freshness before activation");
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

  const runtime = named(jobName, "Prepare protected activation runtime");
  assert.equal(
    runtime.if.replace(/\s+/g, " ").trim(),
    "steps.freshness.outputs.status == 'fresh' && " +
      "needs.prepare-release.outputs.has_active_targets == 'true'",
  );
  assert.equal(runtime.uses, "./.github/actions/vercel-protected-runtime");
  assert.equal(runtime.with.operation, "prepare");
  assert.equal(runtime.with["logical-target"], "app");
  // Every candidate is built and uploaded in its own stage job; the
  // coordinator only promotes and verifies.
  assert.equal(
    jobSteps.some(
      (step) => step.uses === "./.github/actions/vercel-candidate-build",
    ),
    false,
    "the coordinator never builds a candidate",
  );
  assert.equal(
    jobSteps.some((step) => step.run?.includes("candidate-preflight")),
    false,
    "the coordinator never re-runs a candidate preflight",
  );
  assert.equal(
    jobSteps.some((step) => step.run?.includes("candidate-finalize")),
    false,
    "the coordinator never finalizes a candidate",
  );
  assert.equal(
    jobSteps.some((step) => step.run?.includes("app-build-proof")),
    false,
    "the retired App build proof cannot re-enter the coordinator",
  );
  assert.equal(
    jobSteps.some((step) => step.uses === DOWNLOAD_PIN),
    false,
    "the coordinator downloads no same-run payload",
  );
  const strictReceipts = command(jobName, "candidate-receipts");
  assert.match(
    strictReceipts.run,
    /--app[\s\S]*--governance[\s\S]*--reserve[\s\S]*--ui/,
  );
  assert.match(
    strictReceipts.run,
    /--app "\$\{\{ needs\.stage-app\.outputs\.receipt \|\| 'none' \}\}"/,
  );
  assert.doesNotMatch(strictReceipts.run, /\bjq\b/);
  const coordinatorRuns = jobSteps.map((step) => step.run ?? "").join("\n");
  assert.doesNotMatch(coordinatorRuns, /vercel-production-shadow\.mjs deploy/);
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
  assert.ok(jobSteps.indexOf(runtime) < jobSteps.indexOf(strictReceipts));
  const firstTransition = stepsUsing(
    jobSteps,
    "./.github/actions/vercel-main-active-transition",
  )[0];
  assert.ok(
    jobSteps.indexOf(strictReceipts) < jobSteps.indexOf(firstTransition),
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

// The forward composite is uniform: no App-only finalization or second
// verification turn survives the App custom-environment retirement.
test("forward composite has no App-only branch", () => {
  assert.doesNotMatch(forwardSource, /app_v3_deploy/);
  assert.doesNotMatch(forwardSource, /active-event-verify-app/);
  assert.doesNotMatch(forwardSource, /candidate-finalize/);
  assert.doesNotMatch(forwardSource, /app-operation-cwd/);
  assert.equal(
    forward.runs.steps.filter((step) =>
      step.run?.includes("active-event-verify "),
    ).length,
    1,
  );
});
test("recovery is a bounded exact-current-attempt transaction with no cross-attempt authority", () => {
  const recoveryJob = workflow.jobs["recover-main-deployment"];
  assert.deepEqual(recoveryJob.needs, [
    "wait-for-ci",
    "require-ci-success",
    "provider-preplan",
    "restore-inherited-release",
    "prepare-release",
    "stage-app",
    "stage-governance",
    "stage-reserve",
    "stage-ui",
    "activate-and-verify",
  ]);
  assert.match(recoveryJob.if, /^always\(\)/);
  assert.match(recoveryJob.if, /require-ci-success\.result == 'success'/);
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
  assert.match(
    sourceProof("recover-main-deployment").run,
    /validate-recovery-source/,
  );
  assert.doesNotMatch(
    sourceProof("recover-main-deployment").run,
    /\bvalidate-source\b/,
  );
  assert.deepEqual(
    steps("recover-main-deployment").find(
      (step) => step.uses === "./.github/actions/pnpm-install",
    ).with,
    {
      "working-directory": "source",
      "ignore-scripts": "true",
      filter: "frontend-monorepo",
    },
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
  const recoveryMappings = named(
    "recover-main-deployment",
    "Derive and capture full recovery mappings from journal history",
  );
  assert.equal(recoveryMappings.id, "recovery-mappings");
  assert.equal(
    command("recover-main-deployment", "plan-active-recovery").id,
    "recovery-plan",
  );
  const initialize = named(
    "recover-main-deployment",
    "Initialize durable current-attempt recovery journal",
  );
  assert.match(
    initialize.run,
    /active-recovery-event-initialize[\s\S]*run-active-recovery/,
  );
  const classifyRecoveryFailure = named(
    "recover-main-deployment",
    "Classify recovery preparation failure or non-journal result",
  );
  assert.match(classifyRecoveryFailure.if, /always\(\)[\s\S]*!cancelled\(\)/);
  assert.match(
    classifyRecoveryFailure.if,
    /steps\.journal-presence\.outputs\.has_journal == 'true'/,
  );
  assert.match(
    classifyRecoveryFailure.if,
    /steps\.recovery-mappings\.outcome == 'failure'/,
  );
  assert.match(
    classifyRecoveryFailure.if,
    /steps\.recovery-plan\.outcome == 'failure'/,
  );
  assert.match(
    classifyRecoveryFailure.if,
    /steps\.initialize\.outcome == 'failure'/,
  );
  assert.match(
    classifyRecoveryFailure.if,
    /steps\.initialize\.outcome == 'success'[\s\S]*transition_kind == 'recovery-not-required'/,
  );
  assert.match(
    classifyRecoveryFailure.if,
    /steps\.initialize\.outcome == 'success'[\s\S]*transition_kind == 'recovery-ready'/,
  );
  assert.match(
    classifyRecoveryFailure.run,
    /RECOVERY_MAPPINGS_OUTCOME[\s\S]*= failure[\s\S]*RECOVERY_PLAN_OUTCOME[\s\S]*= failure[\s\S]*INITIALIZE_OUTCOME[\s\S]*= failure[\s\S]*outcome=recovery-failed[\s\S]*exit 0/,
  );
  assert.match(
    classifyRecoveryFailure.run,
    /AFTER_UPLOAD_ACTION[\s\S]*none[\s\S]*ARTIFACT_NAME[\s\S]*none[\s\S]*recovery-not-required\)[\s\S]*NEXT_ACTION[\s\S]*fail-after-evidence[\s\S]*HIGHEST_STATUS[\s\S]*recovered\|manual_intervention[\s\S]*current-history\.json[\s\S]*recovered-history\.json[\s\S]*outcome=terminal-bypass[\s\S]*terminal_status=[\s\S]*exit 0[\s\S]*recovery-ready\) test "\$NEXT_ACTION" = dispatch[\s\S]*outcome=recovery-failed/,
  );
  assert.match(
    classifyRecoveryFailure.env.HIGHEST_STATUS,
    /steps\.journal-history\.outputs\.highest_status/,
  );
  assert.doesNotMatch(
    JSON.stringify(classifyRecoveryFailure),
    /VERCEL_(?:ORG_ID|TOKEN)|vercel-main-active-recovery-transition/,
  );
  const initializedJournalSteps = [
    named(
      "recover-main-deployment",
      "Require initialized recovery journal checkpoint",
    ),
    named(
      "recover-main-deployment",
      "Stage initialized recovery journal under its canonical artifact basename",
    ),
    named("recover-main-deployment", "Upload initialized recovery journal"),
    named("recover-main-deployment", "Checkpoint initialized recovery journal"),
    ...steps("recover-main-deployment").filter(
      (step) =>
        step.name?.startsWith("Inspect recovery head") ||
        step.name === "Read final current-attempt recovery head" ||
        step.name ===
          "Require a recovered or manual terminal recovery journal" ||
        step.uses ===
          "./.github/actions/vercel-main-active-recovery-transition",
    ),
  ];
  for (const step of initializedJournalSteps) {
    assert.match(
      step.if,
      /steps\.initialize\.outputs\.transition_kind == 'journal'/,
      step.name ?? step.uses,
    );
  }
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
  // Four mutation slots — one rollback per main target — plus the terminal
  // slot that turns an unrecovered head into a terminal status.
  assert.equal(transitions.length, MAIN_ACTIVE_MAX_RECOVERY_TRANSITIONS + 1);
  assert.deepEqual(
    transitions.map((step) => step.with.slot),
    ["1", "2", "3", "4", "5"],
  );
  assert.equal(
    named("recover-main-deployment", "Restore terminal recovery transition 5")
      .with.slot,
    "5",
  );
  for (const transition of transitions) {
    assert.match(
      transition.if,
      /steps\.initialize\.outputs\.transition_kind == 'journal'/,
      transition.name ?? transition.uses,
    );
    assert.doesNotMatch(
      transition.if,
      /recovery-ready|terminal-bypass/,
      transition.name ?? transition.uses,
    );
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
  const recoveryTerminal = named(
    "recover-main-deployment",
    "Require a recovered or manual terminal recovery journal",
  );
  assert.match(
    recoveryTerminal.if,
    /steps\.recovery-failed\.outputs\.outcome == 'terminal-bypass'/,
  );
  assert.match(
    recoveryTerminal.env.RECOVERY_STATUS,
    /steps\.recovery-failed\.outputs\.terminal_status[\s\S]*steps\.recovered-head\.outputs\.highest_status/,
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
  assert.match(
    preparationFailure.if,
    /steps\.journal-presence\.outputs\.has_journal != 'true'/,
  );
  assert.doesNotMatch(preparationFailure.run, /vercel-main-stage-results:v1/);
  // App stages its own candidate, so every stage result is the literal job
  // result of that stage job. The coordinator result never stands in for the
  // App stage, and nothing re-derives it from the execution projection.
  for (const [variable, job] of [
    ["APP_RESULT", "stage-app"],
    ["GOVERNANCE_RESULT", "stage-governance"],
    ["RESERVE_RESULT", "stage-reserve"],
    ["UI_RESULT", "stage-ui"],
  ]) {
    assert.equal(
      preparationFailure.env[variable],
      `\${{ needs.${job}.result }}`,
    );
    assert.match(
      preparationFailure.run,
      new RegExp(`terminal-stage-results[\\s\\S]*\\$${variable}`),
    );
  }
  assert.equal(
    preparationFailure.env.COORDINATOR_RESULT,
    "${{ needs.activate-and-verify.result }}",
  );
  assert.doesNotMatch(
    preparationFailure.run,
    /--app-result "\$COORDINATOR_RESULT"|app_result=|\bjq\b/,
  );
  assert.ok(
    workflow.jobs["recover-main-deployment"].needs.includes("stage-app"),
  );
  const recoveryFailedTerminal = named(
    "recover-main-deployment",
    "recovery-failed terminal artifacts",
  );
  assert.match(recoveryFailedTerminal.if, /always\(\)[\s\S]*!cancelled\(\)/);
  assert.match(
    recoveryFailedTerminal.if,
    /steps\.recovery-failed\.outputs\.outcome == 'recovery-failed'/,
  );
  assert.doesNotMatch(recoveryFailedTerminal.if, /terminal-bypass/);
  assert.match(recoveryFailedTerminal.run, /set -euo pipefail/);
  assert.match(
    recoveryFailedTerminal.run,
    /install -m 0600 "\$RUNNER_TEMP\/current-attempt-journals\/current-history\.json" "\$RUNNER_TEMP\/recovery-current-history\.json"[\s\S]*terminal-artifacts[\s\S]*--journal-history "\$RUNNER_TEMP\/recovery-current-history\.json"[\s\S]*--outcome recovery-failed/,
  );
  assert.doesNotMatch(
    recoveryFailedTerminal.run,
    /--journal-history "\$RUNNER_TEMP\/current-attempt-journals\/current-history\.json"/,
  );
  assert.match(
    recoveryFailedTerminal.run,
    /--final-census[\s\S]*null\.json[\s\S]*--final-mappings[\s\S]*null\.json[\s\S]*--freshness[\s\S]*null\.json[\s\S]*--public-smokes[\s\S]*null\.json[\s\S]*--stage-results[\s\S]*null\.json[\s\S]*--state-proof[\s\S]*null\.json/,
  );
  assert.match(recoveryFailedTerminal.run, /outcome=recovery-failed/);
  assert.doesNotMatch(
    JSON.stringify(recoveryFailedTerminal),
    /VERCEL_(?:ORG_ID|TOKEN)|vercel-main-active-recovery-transition/,
  );
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
  const recoveryFinalState = command("recover-main-deployment", "active-proof");
  assert.match(recoveryFinalState.run, /recovery-final-state-spec/);
  assert.match(
    recoveryFinalState.run,
    /Vercel deployment state failed category=provider-read-transport/,
  );
  assert.match(
    recoveryFinalState.run,
    /active-census-failure[\s\S]*recovery-final-census-failure/,
  );
  assert.doesNotMatch(recoveryFinalState.run, /cat "\$RUNNER_TEMP/);
  assert.match(
    command("recover-main-deployment", "active-recovery-public-smokes").run,
    /--execution[\s\S]*recovery-app-runtime-smoke[\s\S]*recovery-ui-runtime-smoke/,
  );
  const recoveredTerminal = named(
    "recover-main-deployment",
    "recovered or manual terminal artifacts",
  );
  assert.match(
    recoveredTerminal.run,
    /terminal-artifacts[\s\S]*recovery-final-mappings/,
  );
  assert.match(
    recoveredTerminal.run,
    /recovered-census-unproven[\s\S]*recovery-final-census-failure/,
  );
  assert.match(
    recoveredTerminal.run,
    /else[\s\S]*terminal_outcome="\$TERMINAL_OUTCOME"[\s\S]*final_census="\$RUNNER_TEMP\/recovery-final-state-proof\.json"[\s\S]*state_proof="\$RUNNER_TEMP\/recovery-final-state-proof\.json"/,
  );
  assert.doesNotMatch(
    workflowSource,
    /Require a proven provider state unless recovered proof is preserved separately/,
  );
  assert.match(
    command("recover-main-deployment", "terminal-evidence-create").run,
    /terminal-evidence-create/,
  );
  const recoveredCensusUnprovenMarker = named(
    "recover-main-deployment",
    "Mark recovered census-unproven terminal route",
  );
  assert.match(
    recoveredCensusUnprovenMarker.if,
    /steps\.terminal\.outcome == 'success'/,
  );
  assert.match(
    recoveredCensusUnprovenMarker.if,
    /steps\.recovered-terminal\.outputs\.outcome == 'recovered-census-unproven'/,
  );
  assert.equal(recoveredCensusUnprovenMarker.run, "true");
  assert.match(
    named(
      "recover-main-deployment",
      "Fail after recording recovery terminal evidence",
    ).run,
    /recovered\|recovered-census-unproven\|manual-intervention\|recovery-failed\|preparation-failed-before-journal[\s\S]*exit 1/,
  );
  assert.match(
    named("recover-main-deployment", "Publish recovery outcome").env
      .TERMINAL_OUTCOME,
    /steps\.recovery-failed-terminal\.outputs\.outcome/,
  );
  const recoveryStepNames = steps("recover-main-deployment").map(
    (step) => step.name,
  );
  assert.ok(
    recoveryStepNames.indexOf(
      "Materialize recovery-failed terminal artifacts without a recovery journal",
    ) < recoveryStepNames.indexOf("Publish recovery terminal producer outputs"),
  );
  assert.ok(
    recoveryStepNames.indexOf("Publish recovery terminal producer outputs") <
      recoveryStepNames.indexOf(
        "Fail after recording recovery terminal evidence",
      ),
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
    "stage-app",
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
  assert.equal(workflow.jobs["require-ci-success"].environment, undefined);
  assert.equal(workflow.jobs["wait-for-ci"].environment, undefined);
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
  // Forward slots are exactly one promote per main target. MGP-18 retired the
  // transitional bridge alias set for `app.mento.org`, so there is no extra
  // App-only slot and no alias slot can re-enter here.
  const forwardTransitions = (
    workflow.jobs["activate-and-verify"].steps ?? []
  ).filter(
    (step) => step.uses === "./.github/actions/vercel-main-active-transition",
  );
  assert.equal(
    forwardTransitions.length,
    MAIN_ACTIVE_PROMOTABLE_TARGETS.length,
  );
  assert.equal(forwardTransitions.length, 4);
  for (const transition of forwardTransitions) {
    assert.equal(transition.with.alias, undefined, transition.name);
  }
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
      assert.equal(
        upload.with["retention-days"],
        7,
        `journal upload must use the standard retention: ${groupName}/${upload.name}`,
      );
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
  assert.equal(count, 11);
});

test("production jobs keep the immutable controller checkout and source jobs use the admitted SHA", () => {
  const controllerJobs = [
    "provider-preplan",
    "restore-inherited-release",
    "prepare-release",
    "stage-app",
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
    "stage-app",
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
    /--preplan[\s\S]*--discovery[\s\S]*--planning-snapshot/,
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
    assert.match(
      smoke.run,
      /candidate-smoke[\s\S]*candidate-finalize[\s\S]*--preflight "\$RUNNER_TEMP\/preflight\.json"/,
    );
    assert.ok(workflow.jobs[job].outputs.receipt, `${target} receipt output`);
  }
});

test("every main stage retains protected runtime isolation and create-only uploads", () => {
  const contracts = {
    app: {
      project: "${{ vars.VERCEL_PROJECT_ID_APP }}",
      projectName: "app.mento.org",
      root: "apps/app.mento.org",
      secrets: ["SENTRY_AUTH_TOKEN"],
    },
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
    assert.deepEqual(workflow.jobs[job].needs, [
      "wait-for-ci",
      "require-ci-success",
      "prepare-release",
    ]);
    assert.equal(
      workflow.jobs[job].if,
      `always() && !cancelled() && needs.wait-for-ci.result == 'success' && needs.require-ci-success.result == 'success' && needs.prepare-release.result == 'success' && contains(fromJSON(needs.prepare-release.outputs.targets), '${target}')`,
    );
    assert.equal(workflow.jobs[job].env.LOGICAL_TARGET, target);
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
    assert.equal(install.with.filter, "frontend-monorepo");
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
    assert.equal(diagnostics.with["retention-days"], 7);
    assert.doesNotMatch(JSON.stringify(workflow.jobs[job]), /\.vercel\/output/);
  }
});

test("every main stage job target reaches the production-shadow CLI at runtime", () => {
  const contracts = {
    app: "apps/app.mento.org",
    governance: "apps/governance.mento.org",
    reserve: "apps/reserve.mento.org",
    ui: "apps/ui.mento.org",
  };
  for (const [target, rootDirectory] of Object.entries(contracts)) {
    const isolationRoot = realpathSync(
      mkdtempSync(join(tmpdir(), `vercel-main-stage-${target}-`)),
    );
    const stagingRoot = join(
      isolationRoot,
      "mento-vercel-production-pull-staging",
    );
    const projectId = `prj_${target}123`;
    const orgId = "team_fixture123";
    try {
      chmodSync(isolationRoot, 0o711);
      const result = spawnSync(
        process.execPath,
        [productionShadowCli, "prepare-pull-staging"],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            LOGICAL_TARGET: workflow.jobs[`stage-${target}`].env.LOGICAL_TARGET,
            PULL_STAGING_PATH: stagingRoot,
            VERCEL_ISOLATION_ROOT: isolationRoot,
            VERCEL_ORG_ID: orgId,
            VERCEL_PROJECT_ID: projectId,
          },
        },
      );
      assert.equal(result.status, 0, `${target}: ${result.stderr}`);
      assert.equal(
        result.stdout,
        "Runner-owned Vercel pull staging prepared\n",
      );
      assert.deepEqual(
        JSON.parse(
          readFileSync(join(stagingRoot, ".vercel", "repo.json"), "utf8"),
        ),
        {
          remoteName: "origin",
          projects: [{ id: projectId, directory: rootDirectory, orgId }],
        },
      );
    } finally {
      rmSync(isolationRoot, { recursive: true, force: true });
    }
  }
});

test("coordinator checkpoints the forward journal before four bounded mutations and commits from final proof", () => {
  const coordinator = "activate-and-verify";
  const jobSteps = steps(coordinator);
  const barrier = command(coordinator, "stage-barrier");
  const journal = command(coordinator, "forward-journal");
  assert.match(barrier.run, /candidate-receipts/);
  assert.doesNotMatch(barrier.run, /app-preparation/);
  assert.match(journal.run, /--execution/);
  assert.match(journal.run, /--current-mappings/);
  assert.match(journal.run, /--candidate-receipts/);
  assert.match(journal.run, /planning-snapshot/);
  assert.doesNotMatch(journal.run, /legacy/);
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
  assert.equal(transitions.length, 4);
  assert.equal(transitions.length, MAIN_ACTIVE_PROMOTABLE_TARGETS.length);
  assert.deepEqual(
    transitions.map((step) => step.with.slot),
    ["1", "2", "3", "4"],
  );
  // The retired bridge occupied a fifth forward slot. Neither that step nor an
  // alias-carrying forward slot may return.
  assert.equal(
    jobSteps.find((step) =>
      step.name?.includes("Activate bounded Vercel transition 5"),
    ),
    undefined,
  );
  for (const transition of transitions) {
    assert.equal(transition.with.alias, undefined, transition.name);
    assert.match(transition.if, /steps\.freshness\.outputs\.status == 'fresh'/);
    assert.match(
      transition.if,
      /needs\.prepare-release\.outputs\.has_active_targets == 'true'/,
    );
    assert.match(
      transition.if,
      /needs\.prepare-release\.outputs\.decision != 'verify-existing-release'/,
    );
    assert.equal(transition.with["app-operation-cwd"], undefined);
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
  assert.equal(
    chromium.run,
    "env -u GITHUB_ENV -u GITHUB_OUTPUT -u GITHUB_PATH -u GITHUB_STATE " +
      "-u GITHUB_STEP_SUMMARY pnpm exec playwright install --with-deps chromium",
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
  assert.match(
    finalProof.run,
    /alias-mappings[\s\S]*--output "\$RUNNER_TEMP\/final-mappings-raw\.json"/,
  );
  const canonicalFinalMappings = command(
    coordinator,
    "active-canonical-mappings",
  );
  assert.match(
    canonicalFinalMappings.run,
    /--mapping-spec "\$RUNNER_TEMP\/final-mapping-spec\.json"[\s\S]*--mappings "\$RUNNER_TEMP\/final-mappings-raw\.json"[\s\S]*--output "\$RUNNER_TEMP\/final-mappings\.json"/,
  );
  assert.match(finalProof.run, /active-state-spec/);
  assert.match(finalProof.run, /current-release-state-spec/);
  assert.match(finalProof.run, /active-proof/);
  assert.match(finalProof.run, /active-terminal-state-proof/);
  assert.doesNotMatch(finalProof.run, /legacy/);
  assert.match(
    finalize.run,
    /active-event-finalize[\s\S]*run-active[\s\S]*committed-journal/,
  );
  assert.match(
    finalize.run,
    /active-event-finalize[\s\S]*--current-mappings "\$RUNNER_TEMP\/final-mappings-raw\.json"/,
  );
  assert.doesNotMatch(
    finalize.run,
    /--current-mappings "\$RUNNER_TEMP\/final-mappings\.json"/,
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
  assert.match(
    terminalArtifacts.run,
    /--final-mappings "\$RUNNER_TEMP\/final-mappings\.json"/,
  );
  // The rider census is this job's own planning snapshot, so a promoted
  // target's moved domains are named from an observation, never from a seal.
  assert.match(
    terminalArtifacts.run,
    /--rider-census "\$RUNNER_TEMP\/current-planning\.json"/,
  );
  for (const input of [
    "--final-census",
    "--final-mappings",
    "--journal-history",
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
  assert.doesNotMatch(current.run, /--legacy-v2/);
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
    /--final-mappings "\$RUNNER_TEMP\/final-mappings\.json"/,
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
    finalActive.env.DEPLOY_SHA,
    "${{ needs.wait-for-ci.outputs.deploy_sha }}",
  );
  assert.equal(
    finalActive.env.UPSTREAM_RUN_ID,
    "${{ needs.wait-for-ci.outputs.upstream_run_id }}",
  );
  assert.equal(
    finalActive.env.UPSTREAM_RUN_ATTEMPT,
    "${{ needs.wait-for-ci.outputs.upstream_run_attempt }}",
  );
  assert.equal(
    finalActive.env.WAIT_FOR_CI_RESULT,
    "${{ needs.wait-for-ci.result }}",
  );
  assert.equal(
    finalActive.env.PLAN_RESULT,
    "${{ needs.prepare-release.result }}",
  );
  assert.equal(
    finalActive.env.COORDINATOR_OUTCOME,
    "${{ needs.activate-and-verify.outputs.outcome || needs.recover-main-deployment.outputs.outcome }}",
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
  assert.deepEqual(workflow.jobs.result.needs, [
    "wait-for-ci",
    "require-ci-success",
    "provider-preplan",
    "restore-inherited-release",
    "prepare-release",
    "stage-app",
    "stage-governance",
    "stage-reserve",
    "stage-ui",
    "activate-and-verify",
    "recover-main-deployment",
  ]);
  const noOp = named("result", "Report a deduplicated upstream-attempt no-op");
  assert.equal(
    noOp.if.replace(/\s+/g, " ").trim(),
    "${{ always() && needs.wait-for-ci.outputs.deploy_mode == 'already-deployed' }}",
  );
  assert.equal(
    noOp.env.DUPLICATE_OF_RUN_URL,
    "${{ needs.wait-for-ci.outputs.duplicate_of_run_url }}",
  );
  assert.match(noOp.run, /GITHUB_STEP_SUMMARY/);
  assert.doesNotMatch(noOp.run, /exit 1/);

  const preExecutionFailure = named(
    "result",
    "Fail closed before release execution exists",
  );
  // A failed admission leaves `deploy_mode` empty, and an ungated CI failure
  // leaves it `deploy`; only the proven duplicate no-op may end green.
  assert.equal(
    preExecutionFailure.if.replace(/\s+/g, " ").trim(),
    "${{ always() && needs.prepare-release.result != 'success' && " +
      "needs.wait-for-ci.outputs.deploy_mode != 'already-deployed' }}",
  );
  assert.match(preExecutionFailure.run, /exit 1/);
  assert.match(
    deploymentSource,
    /terminal-evidence-restore[\s\S]*finalRunAttempt: values\.GITHUB_RUN_ATTEMPT/,
  );
  assert.match(terminalReceiptSource, /producer attempt exceeds final attempt/);
});

test("result evaluates the final graph with read-only repository access", () => {
  const result = workflow.jobs.result;
  assert.deepEqual(result.permissions, {
    actions: "read",
    contents: "read",
  });
  assert.doesNotMatch(JSON.stringify(result.steps), /check-runs/u);
});

// MGP-18 retired the legacy App deployment, the App custom `v3` environment,
// and the transitional bridge alias that carried `app.mento.org` between them.
// Recovery now compensates exactly one rollback slot per main target, and no
// workflow step may reference the retired snapshot, spec, alias operation, or
// terminal proof again.
test("reducer constants and action pin boundaries stay covered while the retired legacy path is gone", () => {
  assert.equal(
    MAIN_ACTIVE_MAX_RECOVERY_TRANSITIONS,
    MAIN_ACTIVE_PROMOTABLE_TARGETS.length,
  );
  assert.equal(MAIN_ACTIVE_MAX_RECOVERY_TRANSITIONS, 4);
  // The bridge topology cannot re-enter: its constant and both command
  // builders are gone from the adapter module.
  for (const retired of [
    "MAIN_ACTIVE_APP_BRIDGE_ALIASES",
    "buildMainActiveAppAliasSetCommand",
    "buildMainActiveAppAliasSetSequence",
    "buildMainActiveAppAliasRestoreCommand",
    "buildMainActiveAppAliasRestoreSequence",
  ]) {
    assert.equal(mainActive[retired], undefined, retired);
  }
  assert.doesNotMatch(workflowSource, /app_alias_set|app_alias_restore/);
  assert.doesNotMatch(workflowSource, /appmentoorg-env-v3/);
  // `--target` survives only as this repository's own logical-target flag on
  // first-party CLI subcommands. A Vercel custom-environment selector such as
  // `--target v3` or `--target=production` fails this pin.
  const targetFlags = [...workflowSource.matchAll(/--target[= ](\S+)/g)].map(
    (match) => match[1],
  );
  assert.ok(targetFlags.length > 0);
  for (const value of targetFlags) {
    assert.ok(
      MAIN_ACTIVE_PROMOTABLE_TARGETS.includes(value),
      `--target ${value} is not a reviewed logical target`,
    );
  }
  // The only surviving `alias` token is the read-only state query. An
  // `alias set` step or a re-added alias operation name fails this pin.
  assert.deepEqual(
    [...new Set([...workflowSource.matchAll(/alias[\w-]*/g)].map((m) => m[0]))],
    ["alias-mappings"],
  );
  assert.doesNotMatch(workflowSource, /app_v3_deploy/);
  assert.doesNotMatch(workflowSource, /legacy/i);
  assert.doesNotMatch(workflowSource, /v2-app\.mento\.org/);
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

// A supplied rider census is read immediately by `terminal-artifacts`, so a
// step that passes one must be unreachable unless the file exists. Every
// consumer therefore needs an earlier producer in the same job whose condition
// holds whenever the consumer's does. Getting this wrong fails the terminal
// handoff on a real merge, which is how a visibility-only field could take
// production verification down.
test("every rider census passed to terminal-artifacts has a producer under the same conditions", () => {
  const conjuncts = (step) =>
    typeof step.if === "string"
      ? step.if
          .split("&&")
          .map((part) => part.trim().replace(/\s+/g, " "))
          .filter((part) => part.length > 0)
      : [];
  let consumers = 0;
  for (const jobName of Object.keys(workflow.jobs)) {
    const jobSteps = steps(jobName);
    for (const [index, step] of jobSteps.entries()) {
      const run = step.run ?? "";
      if (!run.includes("terminal-artifacts")) continue;
      const census = run.match(/--rider-census "([^"]+)"/);
      if (census === null) continue;
      consumers += 1;
      const path = census[1];
      const consumerConditions = new Set(conjuncts(step));
      const producer = jobSteps
        .slice(0, index)
        .find(
          (candidate) =>
            (candidate.run ?? "").includes(`--output "${path}"`) &&
            conjuncts(candidate).every((part) => consumerConditions.has(part)),
        );
      assert.ok(
        producer !== undefined,
        `${jobName}: "${step.name}" passes --rider-census ${path} with no earlier producer whose condition is implied by its own`,
      );
    }
  }
  // Guard the guard: if the flag is ever dropped entirely this test must not
  // silently pass on an empty set. One activation consumer and both recovery
  // consumers that can report a started mutation.
  assert.equal(consumers, 3);
});

// The recovery job's two census producers state their condition as the exact
// string their consumer states. That is stronger than the subset rule above:
// the census cannot start running in a case the consumer does not cover, and
// cannot stop running in a case the consumer does.
test("each recovery rider census producer states its consumer's exact condition", () => {
  const jobSteps = steps("recover-main-deployment");
  const pairs = [
    [
      "Census rider domains the failed promote left in place",
      "Materialize recovery-failed terminal artifacts without a recovery journal",
      "$RUNNER_TEMP/recovery-failed-planning.json",
    ],
    [
      "Census rider domains after the compensating rollback",
      "Materialize recovered or manual terminal artifacts",
      "$RUNNER_TEMP/recovered-planning.json",
    ],
  ];
  for (const [producerName, consumerName, path] of pairs) {
    const producer = jobSteps.find((step) => step.name === producerName);
    const consumer = jobSteps.find((step) => step.name === consumerName);
    assert.ok(producer !== undefined, producerName);
    assert.ok(consumer !== undefined, consumerName);
    assert.equal(producer.if, consumer.if);
    assert.ok(jobSteps.indexOf(producer) < jobSteps.indexOf(consumer));
    assert.ok(producer.run.includes(`--output "${path}"`));
    assert.ok(consumer.run.includes(`--rider-census "${path}"`));
    // The same read-only census verb the activation job uses, against this
    // job's own main specification. No mutating verb may appear here.
    assert.match(
      producer.run,
      /node scripts\/vercel-deployment-state\.mjs planning-snapshot --spec "\$RUNNER_TEMP\/main-spec\.json"/,
    );
    assert.equal(
      producer.env.VERCEL_TOKEN,
      "${{ secrets.VERCEL_TOKEN_PRODUCTION }}",
    );
  }
  // The specification both producers read is materialized unconditionally,
  // before either of them can run.
  const spec = jobSteps.find(
    (step) =>
      step.name ===
      "Materialize current execution manifest and recovery specifications",
  );
  assert.match(
    spec.run,
    /create-spec --scope main --output "\$RUNNER_TEMP\/main-spec\.json"/,
  );
  assert.equal(spec.if, undefined);
  for (const [producerName] of pairs) {
    assert.ok(
      jobSteps.indexOf(spec) <
        jobSteps.indexOf(jobSteps.find((step) => step.name === producerName)),
    );
  }
});

// The post-recovery census must observe the state recovery left behind, not the
// state it started from, so every compensation slot precedes it.
test("the post-recovery rider census runs after every compensation slot", () => {
  const jobSteps = steps("recover-main-deployment");
  const census = jobSteps.findIndex(
    (step) =>
      step.name === "Census rider domains after the compensating rollback",
  );
  assert.ok(census > 0);
  const slots = jobSteps.filter((step) =>
    /^Restore (?:bounded|terminal) recovery transition \d$/.test(
      step.name ?? "",
    ),
  );
  assert.equal(slots.length, 5);
  for (const slot of slots) {
    assert.ok(jobSteps.indexOf(slot) < census, slot.name);
  }
  // And inside the protected runtime this job already holds: prepared before,
  // torn down after.
  const prepare = jobSteps.findIndex(
    (step) => step.name === "Prepare protected recovery runtime",
  );
  const cleanup = jobSteps.findIndex(
    (step) => step.name === "Remove authenticated recovery runtime",
  );
  assert.ok(prepare >= 0 && prepare < census);
  assert.ok(cleanup > census);
  // The failed-recovery census shares that boundary.
  const failedCensus = jobSteps.findIndex(
    (step) =>
      step.name === "Census rider domains the failed promote left in place",
  );
  assert.ok(prepare < failedCensus && failedCensus < cleanup);
});

// Riders are informational: no selection, verification, or recovery decision
// reads them. A census read this job cannot complete must therefore degrade to
// a null snapshot — which renders as unknown — instead of taking the terminal
// evidence with it. Anything outside the reader's own failure vocabulary still
// fails the step closed, after the null census is written.
test("a recovery rider census that cannot be read degrades to unknown, not to a lost handoff", () => {
  const jobSteps = steps("recover-main-deployment");
  const producers = jobSteps.filter((step) =>
    (step.name ?? "").startsWith("Census rider domains"),
  );
  assert.equal(producers.length, 2);
  for (const producer of producers) {
    const path = producer.run.match(/--output "([^"]+)"/)[1];
    // Written 0600 so the terminal reader's private-file check accepts it.
    assert.match(producer.run, /umask 077/);
    assert.ok(producer.run.includes(`printf 'null\\n' > "${path}"`));
    for (const category of [
      "provider-read-timeout",
      "provider-read-transport",
      "provider-read-rate-limited",
      "provider-read-http",
      "provider-read-malformed",
      "state-validation-failed",
    ]) {
      assert.ok(
        producer.run.includes(
          `'Vercel deployment state failed category=${category}') ;;`,
        ),
        `${producer.name}: ${category}`,
      );
    }
    // An unrecognized failure still fails the step, but only after the null
    // census exists. The failed-recovery consumer runs under `always()`, so a
    // producer that exited before writing would leave it reading a path that
    // is not there and lose the terminal evidence outright.
    assert.match(producer.run, /\*\) read_outcome=unrecognized ;;/);
    assert.doesNotMatch(producer.run, /\*\) exit 1 ;;/);
    const write = producer.run.indexOf(`printf 'null\\n' > "${path}"`);
    const fail = producer.run.indexOf('test "$read_outcome" = recognized');
    assert.ok(fail > write, producer.name);
  }
});

// `restore-inherited-release` publishes no terminal evidence at all — the
// result job restores only the activation or recovery producer's handoff — so
// it has no rider line to fill in and must not grow a census consumer.
test("the inherited restoration job publishes no terminal evidence and needs no census", () => {
  const jobSteps = steps("restore-inherited-release");
  for (const step of jobSteps) {
    assert.doesNotMatch(step.run ?? "", /terminal-artifacts|--rider-census/);
  }
  assert.deepEqual(
    Object.keys(workflow.jobs["restore-inherited-release"].outputs),
    ["outcome"],
  );
});

test("the journal-free existing-release verification passes no rider census", () => {
  const currentRelease = named(
    "activate-and-verify",
    "already-current release terminal",
  );
  assert.match(currentRelease.if, /decision == 'verify-existing-release'/);
  // That branch never captures a planning snapshot, so it must not claim one.
  assert.doesNotMatch(currentRelease.run, /--rider-census/);
  assert.match(currentRelease.run, /--outcome current-release-verified/);
});
