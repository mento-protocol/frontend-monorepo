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

const workflowPath = ".github/workflows/vercel-main-deployment.yml";
const workflowSource = readFileSync(
  new URL(`../${workflowPath}`, import.meta.url),
  "utf8",
);
const workflow = parse(workflowSource);
const forwardActionPath =
  ".github/actions/vercel-main-active-transition/action.yml";
const forwardActionSource = readFileSync(
  new URL(`../${forwardActionPath}`, import.meta.url),
  "utf8",
);
const forwardAction = parse(forwardActionSource);
const recoveryActionPath =
  ".github/actions/vercel-main-active-recovery-transition/action.yml";
const recoveryActionSource = readFileSync(
  new URL(`../${recoveryActionPath}`, import.meta.url),
  "utf8",
);
const recoveryAction = parse(recoveryActionSource);
const deploymentDocs = readFileSync(
  new URL("../docs/vercel-deployments.md", import.meta.url),
  "utf8",
);
const pnpmInstallAction = parse(
  readFileSync(
    new URL("../.github/actions/pnpm-install/action.yml", import.meta.url),
    "utf8",
  ),
);

const CHECKOUT = "actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0";
const UPLOAD =
  "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a";
const DOWNLOAD =
  "actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093";
const ORDINARY = Object.freeze({
  governance: Object.freeze({
    project: "${{ vars.VERCEL_PROJECT_ID_GOVERNANCE }}",
    root: "apps/governance.mento.org",
  }),
  reserve: Object.freeze({
    project: "${{ vars.VERCEL_PROJECT_ID_RESERVE }}",
    root: "apps/reserve.mento.org",
  }),
  ui: Object.freeze({
    project: "${{ vars.VERCEL_PROJECT_ID_UI }}",
    root: "apps/ui.mento.org",
  }),
});

function step(jobName, name) {
  const result = workflow.jobs[jobName].steps.find(
    (item) => item.name === name,
  );
  assert.ok(result, `missing ${jobName} step: ${name}`);
  return result;
}

function stepIncluding(jobName, text) {
  const result = workflow.jobs[jobName].steps.find((item) =>
    item.run?.includes(text),
  );
  assert.ok(result, `missing ${jobName} command: ${text}`);
  return result;
}

function stepsUsing(value, action) {
  return value.filter((item) => item.uses === action);
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

test("active workflow keeps the exact eight-job graph and trusted admission gate", () => {
  assert.equal(workflow.name, "Vercel Main Deployment");
  assert.equal(workflow.env.VERCEL_MAIN_MODE, "active");
  assert.deepEqual(JSON.parse(workflow.env.MAIN_OWNERSHIP_MODE_JSON), {
    app: "github",
    governance: "github",
    reserve: "github",
    ui: "github",
  });
  assert.deepEqual(Object.keys(workflow.jobs), [
    "wait-for-ci",
    "plan-main-deployments",
    "stage-governance",
    "stage-reserve",
    "stage-ui",
    "activate-and-verify",
    "recover-main-deployment",
    "result",
  ]);
  assert.deepEqual(workflow.permissions, { contents: "read", actions: "read" });
  assert.deepEqual(workflow.concurrency, {
    group: "vercel-main-deployment",
    "cancel-in-progress": false,
    queue: "single",
  });
  assert.equal(
    step("wait-for-ci", "Verify exact successful upstream attempt").env
      .GITHUB_TOKEN,
    "${{ github.token }}",
  );
  assert.equal(
    stepsUsing(workflow.jobs["wait-for-ci"].steps, CHECKOUT).length,
    2,
  );
});

test("workflow_run admission, trusted checkouts, credential boundaries, and protected environments stay literal", () => {
  assert.deepEqual(workflow.on, {
    workflow_run: {
      workflows: ["CI/CD"],
      types: ["completed"],
      branches: ["main"],
    },
  });
  const admission = workflow.jobs["wait-for-ci"];
  assert.equal(
    admission.if,
    "github.event.workflow_run.event == 'push' && github.event.workflow_run.head_branch == 'main' && github.event.workflow_run.conclusion == 'success'",
  );
  assert.equal(
    admission.env.DEPLOY_SHA,
    "${{ github.event.workflow_run.head_sha }}",
  );
  assert.equal(admission.environment, undefined);
  assert.doesNotMatch(workflowSource, /\bgithub\.sha\b/);
  assert.doesNotMatch(workflowSource, /deployments:\s*write/);
  assert.doesNotMatch(workflowSource, /name:\s*Production\b/);
  assert.doesNotMatch(workflowSource, /secrets:\s*inherit/);
  assert.doesNotMatch(workflowSource, /secrets\[[^\]]+\]/);

  const admissionCheckouts = stepsUsing(admission.steps, CHECKOUT);
  assert.deepEqual(
    admissionCheckouts.map((item) => item.with),
    [
      {
        "fetch-depth": 1,
        "persist-credentials": false,
        ref: "${{ github.workflow_sha }}",
      },
      {
        "fetch-depth": 0,
        path: "source",
        "persist-credentials": false,
        ref: "${{ github.event.workflow_run.head_sha }}",
      },
    ],
  );
  const context = stepIncluding("wait-for-ci", "validate-context");
  const receipt = stepIncluding(
    "wait-for-ci",
    "vercel-main-ci-attempt.mjs verify",
  );
  const sourceProof = stepIncluding("wait-for-ci", "validate-source");
  assert.ok(
    admission.steps.indexOf(context) < admission.steps.indexOf(receipt),
  );
  assert.ok(
    admission.steps.indexOf(receipt) < admission.steps.indexOf(sourceProof),
  );
  assert.match(sourceProof.run, /fetch --no-tags origin \+refs\/heads\/main/);

  for (const [jobName, job] of Object.entries(workflow.jobs)) {
    if (job.environment !== undefined) {
      assert.deepEqual(job.environment, {
        name: "vercel-cli-production",
        deployment: false,
      });
    }
    for (const checkout of stepsUsing(job.steps, CHECKOUT)) {
      assert.equal(checkout.with["persist-credentials"], false, jobName);
    }
  }
  for (const jobName of [
    "plan-main-deployments",
    "stage-governance",
    "stage-reserve",
    "stage-ui",
    "activate-and-verify",
    "recover-main-deployment",
  ]) {
    const checkouts = stepsUsing(workflow.jobs[jobName].steps, CHECKOUT);
    assert.ok(
      checkouts.some(
        (item) =>
          item.with.path === "source" &&
          item.with.ref === "${{ needs.wait-for-ci.outputs.deploy_sha }}" &&
          item.with["fetch-depth"] === 0,
      ),
      `${jobName} exact source checkout`,
    );
    assert.ok(
      checkouts.some(
        (item) =>
          item.with.path === undefined &&
          item.with.ref === "${{ needs.wait-for-ci.outputs.deploy_sha }}",
      ),
      `${jobName} trusted controller checkout`,
    );
    assert.match(
      stepIncluding(jobName, "validate-source").run,
      /fetch --no-tags origin \+refs\/heads\/main/,
      `${jobName} source proof`,
    );
  }

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
    const job = workflow.jobs[path[1]];
    assert.deepEqual(job.environment, {
      name: "vercel-cli-production",
      deployment: false,
    });
  }
});

test("planner isolation disables lifecycle scripts and pnpmfile hooks before credentials", () => {
  const planner = workflow.jobs["plan-main-deployments"];
  const runtime = step(
    "plan-main-deployments",
    "Install exact main planner runtime",
  );
  const planning = step(
    "plan-main-deployments",
    "Capture tolerant main planning state",
  );
  assert.equal(runtime.uses, "./.github/actions/pnpm-install");
  assert.deepEqual(runtime.with, {
    "working-directory": "source",
    "ignore-scripts": "true",
  });
  assert.equal(runtime.env, undefined);
  assert.ok(planner.steps.indexOf(runtime) < planner.steps.indexOf(planning));
  const isolatedInstall = pnpmInstallAction.runs.steps.find(
    (entry) =>
      entry.name ===
      "Install dependencies without lifecycle scripts or pnpmfile hooks",
  );
  assert.equal(isolatedInstall.if, "inputs.ignore-scripts == 'true'");
  assert.match(
    isolatedInstall.run,
    /pnpm install --frozen-lockfile --ignore-scripts --ignore-pnpmfile/,
  );
});

test("ordinary stage contracts bind one literal project, trusted source, build, and upload path", () => {
  for (const [target, contract] of Object.entries(ORDINARY)) {
    const jobName = `stage-${target}`;
    const job = workflow.jobs[jobName];
    assert.deepEqual(job.needs, ["wait-for-ci", "plan-main-deployments"]);
    assert.equal(
      job.if,
      `contains(fromJSON(needs.plan-main-deployments.outputs.targets), '${target}')`,
    );
    assert.equal(job.env.LOGICAL_TARGET, target);
    assert.equal(job.env.VERCEL_PROJECT_ID, contract.project);
    const build = job.steps.find(
      (item) => item.uses === "./.github/actions/vercel-candidate-build",
    );
    assert.ok(build, `${target} candidate build`);
    assert.equal(build.with["logical-target"], target);
    assert.equal(build.with["expected-root-directory"], contract.root);
    assert.equal(build.with["vercel-project-id"], contract.project);
    assert.equal(build.env.VERCEL_ENV, "production");
    assert.equal(build.env.VERCEL_TARGET_ENV, "production");
    const deploy = stepIncluding(jobName, "deploy --expected");
    assert.equal(
      deploy.env.SOURCE_PATH,
      "${{ steps.runtime.outputs.upload-source-path }}",
    );
    assert.match(deploy.run, /TRUSTED_POST_BUILD_PATH/);
    assert.match(
      stepIncluding(jobName, "assert-generated-aliases").run,
      new RegExp(`assert-generated-aliases --target ${target}`),
    );
    const cleanup = job.steps.at(-1);
    assert.equal(cleanup.if, "${{ always() }}");
    assert.equal(cleanup.with.operation, "cleanup");
    assert.equal(cleanup.with["logical-target"], target);
  }
});

test("active coordinator uses the reducer and statically unrolls every forward turn", () => {
  const coordinator = workflow.jobs["activate-and-verify"];
  assert.deepEqual(coordinator.needs, [
    "wait-for-ci",
    "plan-main-deployments",
    "stage-governance",
    "stage-reserve",
    "stage-ui",
  ]);
  assert.equal(
    step("activate-and-verify", "Create the durable active journal").id,
    "active-initialize",
  );
  assert.equal(
    step("activate-and-verify", "Upload the prepared active journal").uses,
    UPLOAD,
  );
  for (const name of [
    "Advance Governance promotion through durable active transitions",
    "Advance Reserve promotion through durable active transitions",
    "Advance UI promotion through durable active transitions",
    "Advance App v3 deployment through durable active transitions",
    "Advance App public alias through durable active transitions",
    "Advance App generated alias through durable active transitions",
  ]) {
    assert.equal(
      step("activate-and-verify", name).uses,
      "./.github/actions/vercel-main-active-transition",
    );
  }
  assert.equal(
    step("activate-and-verify", "Upload the committed active journal").uses,
    UPLOAD,
  );
  assert.doesNotMatch(workflowSource, /run-shadow|recover-shadow/);
});

test("forward transition checkpoints and reverifies a discovered App candidate before recovery", () => {
  assert.equal(stepsUsing(forwardAction.runs.steps, UPLOAD).length, 4);
  assert.match(forwardActionSource, /active-event-dispatch/);
  assert.match(forwardActionSource, /active-event-authorize/);
  assert.match(forwardActionSource, /active-event-command-returned/);
  assert.match(forwardActionSource, /active-event-verify/);
  assert.match(forwardActionSource, /active-journal-receipt/);
  assert.match(forwardActionSource, /active-journal-history/);
  assert.match(forwardActionSource, /vercel-main-active-cli\.mjs/);
  assert.doesNotMatch(
    forwardActionSource,
    /\bvercel\s+(?:promote|rollback|alias|deploy)\b/,
  );
  assert.doesNotMatch(forwardActionSource, /\bfor\s+\w+\s+in\b|\bwhile\s+\[/);
  const dispatchGuard = forwardAction.runs.steps.find(
    (item) => item.name === "Require one expected forward dispatch result",
  );
  assert.ok(dispatchGuard);
  assert.match(dispatchGuard.run, /await-final-proof/);
  assert.match(dispatchGuard.run, /collect-final-proof/);
  assert.match(dispatchGuard.run, /exit 1/);
  const verificationGuard = forwardAction.runs.steps.find(
    (item) => item.name === "Require the durable verified transition",
  );
  assert.ok(verificationGuard);
  assert.match(verificationGuard.run, /dispatch\|recover\|verify/);
  const reverify = forwardAction.runs.steps.find(
    (item) => item.name === "Independently reverify a discovered App candidate",
  );
  assert.ok(reverify);
  assert.match(reverify.if, /after_upload_action == 'verify'/);
  assert.match(reverify.run, /app-candidate-expectation/);
  assert.match(reverify.run, /active-event-verify-app/);
  assert.match(reverify.run, /run-active/);
  const reverifyGuard = forwardAction.runs.steps.find(
    (item) => item.name === "Require the durable reverified App transition",
  );
  assert.ok(reverifyGuard);
  assert.match(reverifyGuard.run, /AFTER_UPLOAD_ACTION" = recover/);
  for (const name of [
    "Upload the durable reverified App snapshot",
    "Checkpoint the uploaded reverified App snapshot",
  ]) {
    assert.ok(
      forwardAction.runs.steps.some((item) => item.name === name),
      `missing ${name}`,
    );
  }
  for (const name of [
    "Upload the durable started snapshot",
    "Recheck freshness and authorize the one command",
    "Execute only the durably authorized Vercel command",
    "Persist the command-returned snapshot",
    "Independently verify the resulting mapping",
  ]) {
    const actionStep = forwardAction.runs.steps.find(
      (item) => item.name === name,
    );
    assert.ok(actionStep, `missing forward action step: ${name}`);
    assert.match(actionStep.if, /steps\./);
  }
  const maximumJournalArtifacts = 1 + 6 * 3 + 1 + 1;
  assert.equal(maximumJournalArtifacts, 21);
  assert.match(deploymentDocs, /at most 21 journal artifacts/);
  assert.match(deploymentDocs, /no-journal final-proof transition/);
});

test("finalization proves public serving, active census, mappings, and committed history", () => {
  const finalization = step(
    "activate-and-verify",
    "Finalize active state, public smokes, and duplicate census",
  );
  assert.match(finalization.run, /active-public-smokes/);
  assert.match(finalization.run, /active-state-spec/);
  assert.match(finalization.run, /active-proof/);
  assert.match(finalization.run, /active-event-finalize/);
  for (const target of ["App", "Governance", "Reserve", "UI"]) {
    assert.ok(
      workflow.jobs["activate-and-verify"].steps.some((item) =>
        item.name?.includes(`selected ${target} public`),
      ),
    );
  }
});

test("recovery derives identity and downloads every named snapshot without merging", () => {
  const recovery = workflow.jobs["recover-main-deployment"];
  const recoveryTurns = recovery.steps.filter((item) =>
    item.name?.startsWith("Reverse recovery turn "),
  );
  const finalRecovery = step(
    "recover-main-deployment",
    "Finalize reverse recovery after all bounded turns",
  );
  const recoveryInvocations = [...recoveryTurns, finalRecovery];
  const configuredRecoveryInvocations = stepsUsing(
    recovery.steps,
    "./.github/actions/vercel-main-active-recovery-transition",
  );
  const recoveryTimeoutOverheadMinutes = 10;
  const identity = step(
    "recover-main-deployment",
    "Derive exact active journal identity without coordinator outputs",
  );
  assert.match(identity.run, /active-journal-identity/);
  const download = step(
    "recover-main-deployment",
    "Download every exact active journal snapshot without merging",
  );
  assert.equal(download.uses, DOWNLOAD);
  assert.equal(download.with["merge-multiple"], false);
  assert.match(download.with.pattern, /artifact_prefix/);
  assert.match(
    step(
      "recover-main-deployment",
      "Validate the highest exact active journal history",
    ).run,
    /active-journal-history/,
  );
  assert.equal(recovery.if, "${{ always() }}");
  assert.deepEqual(MAIN_LEGACY_REQUIRED_ALIAS_TOPOLOGY, [
    "appmentoorg-git-v2-mentolabs.vercel.app",
    "appmentoorg-mentolabs.vercel.app",
    "appmentoorg.vercel.app",
    "v2-app.mento.org",
  ]);
  assert.deepEqual(MAIN_DURABLE_LEGACY_RECOVERY_ALIASES, ["v2-app.mento.org"]);
  assert.equal(
    MAIN_ACTIVE_MAX_RECOVERY_TRANSITIONS,
    MAIN_ORDINARY_TARGETS.length +
      MAIN_ACTIVE_APP_ALIASES.length +
      MAIN_DURABLE_LEGACY_RECOVERY_ALIASES.length,
  );
  assert.equal(recoveryTurns.length, MAIN_ACTIVE_MAX_RECOVERY_TRANSITIONS);
  for (const [index, recoveryTurn] of recoveryTurns.entries()) {
    assert.equal(recoveryTurn.name, `Reverse recovery turn ${index + 1}`);
    assert.equal(
      recoveryTurn.uses,
      "./.github/actions/vercel-main-active-recovery-transition",
    );
    assert.equal(recoveryTurn.with.slot, String(index + 1));
  }
  assert.equal(
    finalRecovery.uses,
    "./.github/actions/vercel-main-active-recovery-transition",
  );
  assert.equal(finalRecovery.with.slot, "final");
  assert.deepEqual(configuredRecoveryInvocations, recoveryInvocations);
  assert.equal(stepsUsing(recoveryAction.runs.steps, UPLOAD).length, 3);
  assert.match(recoveryActionSource, /active-recovery-event-dispatch/);
  assert.match(recoveryActionSource, /active-recovery-event-authorize/);
  assert.match(recoveryActionSource, /active-recovery-event-verify/);
  assert.match(recoveryActionSource, /vercel-main-active-cli\.mjs/);
  assert.doesNotMatch(
    recoveryActionSource,
    /\bvercel\s+(?:promote|rollback|alias|deploy)\b/,
  );
  assert.equal(
    recovery["timeout-minutes"],
    Math.ceil(
      (recoveryInvocations.length * MAIN_ACTIVE_COMMAND_TIMEOUT_MS) / 60_000,
    ) + recoveryTimeoutOverheadMinutes,
  );
});

test("recovery discovers an exact App candidate only after mapped App movement and otherwise preserves manual intervention", () => {
  const preflight = step(
    "recover-main-deployment",
    "Materialize active recovery history and assess App candidate discovery",
  );
  assert.equal(preflight.id, "recovery-preflight");
  assert.match(preflight.run, /active-app-candidate-matches-none/);
  assert.match(preflight.run, /plan-active-recovery/);
  const expectation = step(
    "recover-main-deployment",
    "Materialize exact App recovery candidate expectation",
  );
  assert.match(expectation.if, /app-candidate-ambiguous-after-mapping-moved/);
  assert.match(expectation.run, /app-candidate-expectation/);
  const discovery = step(
    "recover-main-deployment",
    "Discover one exact moved App recovery candidate",
  );
  assert.equal(discovery["continue-on-error"], true);
  assert.match(discovery.run, /vercel-deployment-state\.mjs app-candidate/);
  assert.match(discovery.run, /main-recovery-app-expectation/);
  const matches = step(
    "recover-main-deployment",
    "Materialize exact App recovery candidate matches",
  );
  assert.match(matches.run, /recovery-app-candidate\.outcome/);
  assert.match(matches.run, /active-app-candidate-matches-one/);
  assert.match(matches.run, /active-app-candidate-matches-none/);
  const finalPlan = step(
    "recover-main-deployment",
    "Materialize exact active recovery plan",
  );
  assert.equal(finalPlan.id, "recovery-plan");
  assert.match(finalPlan.run, /main-recovery-app-matches/);
  const initializedCheckpoint = step(
    "recover-main-deployment",
    "Checkpoint initialized active recovery journal",
  );
  assert.equal(initializedCheckpoint.id, "recovery-initialize-checkpoint");
  assert.match(initializedCheckpoint.run, /current-journal\.json/);
  const reinitialize = step(
    "recover-main-deployment",
    "Initialize recovery after checkpointing discovered App candidate",
  );
  assert.equal(reinitialize.id, "recovery-reinitialize");
  assert.match(reinitialize.if, /after_upload_action == 'initialize'/);
  assert.match(reinitialize.run, /active-recovery-event-initialize/);
  assert.match(reinitialize.run, /run-active-recovery/);
  assert.equal(
    step(
      "recover-main-deployment",
      "Upload reinitialized active recovery journal",
    ).uses,
    UPLOAD,
  );
  assert.equal(
    step(
      "recover-main-deployment",
      "Checkpoint reinitialized active recovery journal",
    ).id,
    "recovery-reinitialize-checkpoint",
  );
  for (const name of [
    "Reverse recovery turn 1",
    "Reverse recovery turn 2",
    "Reverse recovery turn 3",
    "Reverse recovery turn 4",
    "Reverse recovery turn 5",
    "Reverse recovery turn 6",
    "Finalize reverse recovery after all bounded turns",
    "Read the terminal durable recovery status",
  ]) {
    const recoveryStep = step("recover-main-deployment", name);
    assert.match(recoveryStep.if, /recovery-initialize-checkpoint/);
    assert.match(recoveryStep.if, /recovery-reinitialize-checkpoint/);
  }
});

test("result uses the active final sentinel and fails only after evidence publication", () => {
  const sentinel = step("result", "Enforce one active final result");
  assert.match(sentinel.run, /final-active/);
  assert.equal(sentinel["continue-on-error"], true);
  const artifact = step("result", "Upload canonical redacted PR-A evidence");
  assert.equal(artifact.uses, UPLOAD);
  assert.equal(
    step(
      "result",
      "Download every active journal snapshot for failure evidence",
    ).with["merge-multiple"],
    false,
  );
  assert.match(
    step("result", "Write active safe-noop audit evidence").run,
    /active-failure-evidence/,
  );
  assert.match(
    step("result", "Write canonical active failure evidence").run,
    /active-failure-evidence/,
  );
  assert.match(
    step("result", "Write canonical active failure evidence").run,
    /PUBLIC_SERVING_MUTATION_COMMANDS=12/,
  );
  const fail = step("result", "Fail after publishing an unsafe final result");
  assert.match(fail.run, /exit 1/);
});

test("root workflow keeps Vercel mutations inside reviewed composite adapters", () => {
  const rootRuns = Object.values(workflow.jobs)
    .flatMap((job) => job.steps)
    .map((item) => item.run ?? "")
    .join("\n");
  assert.doesNotMatch(
    rootRuns,
    /\bvercel\s+(?:promote|rollback|alias\s+set|deploy)\b/i,
  );
  assert.doesNotMatch(workflowSource, /--token\b/);
  assert.doesNotMatch(workflowSource, /\.vercel\/output/);
});
