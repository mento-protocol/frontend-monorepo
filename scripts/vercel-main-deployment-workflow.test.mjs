import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parse } from "yaml";

const workflowPath = ".github/workflows/vercel-main-deployment.yml";
const workflowSource = readFileSync(
  new URL(`../${workflowPath}`, import.meta.url),
  "utf8",
);
const workflow = parse(workflowSource);
const candidateActionSource = readFileSync(
  new URL(
    "../.github/actions/vercel-candidate-build/action.yml",
    import.meta.url,
  ),
  "utf8",
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
    sentry: true,
    etherscan: true,
  }),
  reserve: Object.freeze({
    project: "${{ vars.VERCEL_PROJECT_ID_RESERVE }}",
    root: "apps/reserve.mento.org",
    sentry: true,
    etherscan: false,
  }),
  ui: Object.freeze({
    project: "${{ vars.VERCEL_PROJECT_ID_UI }}",
    root: "apps/ui.mento.org",
    sentry: false,
    etherscan: false,
  }),
});

function stepNamed(jobName, name) {
  const step = workflow.jobs[jobName].steps.find((item) => item.name === name);
  assert.ok(step, `missing ${jobName} step: ${name}`);
  return step;
}

function stepIncluding(jobName, text) {
  const step = workflow.jobs[jobName].steps.find((item) =>
    item.run?.includes(text),
  );
  assert.ok(step, `missing ${jobName} command: ${text}`);
  return step;
}

function allStrings(value, output = []) {
  if (typeof value === "string") output.push(value);
  if (Array.isArray(value)) value.forEach((item) => allStrings(item, output));
  if (value && typeof value === "object") {
    Object.values(value).forEach((item) => allStrings(item, output));
  }
  return output;
}

test("workflow_run gate, permissions, mode, queue, and DAG are literal", () => {
  assert.equal(workflow.name, "Vercel Main Deployment");
  assert.deepEqual(workflow.on, {
    workflow_run: {
      workflows: ["CI/CD"],
      types: ["completed"],
      branches: ["main"],
    },
  });
  assert.deepEqual(workflow.permissions, {
    contents: "read",
    actions: "read",
  });
  assert.deepEqual(workflow.concurrency, {
    group: "vercel-main-deployment",
    "cancel-in-progress": false,
    queue: "single",
  });
  assert.equal(workflow.env.VERCEL_MAIN_MODE, "shadow");
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
  assert.equal(workflow.jobs.result.name, "Vercel Main Deployment");
  assert.equal(workflow.jobs.result.environment, undefined);
  for (const [jobName, job] of Object.entries(workflow.jobs)) {
    if (job.environment === undefined) continue;
    assert.deepEqual(
      job.environment,
      {
        name: "vercel-cli-production",
        deployment: false,
      },
      `${jobName} environment`,
    );
  }
  assert.doesNotMatch(workflowSource, /name:\s*Production\b/);
  assert.doesNotMatch(workflowSource, /deployments:\s*write/);
  assert.doesNotMatch(workflowSource, /\bgithub\.sha\b/);
});

test("upstream receipt binds the exact successful attempt before credentials", () => {
  const job = workflow.jobs["wait-for-ci"];
  assert.equal(
    job.if,
    "github.event.workflow_run.event == 'push' && github.event.workflow_run.head_branch == 'main' && github.event.workflow_run.conclusion == 'success'",
  );
  assert.equal(job.env.DEPLOY_SHA, "${{ github.event.workflow_run.head_sha }}");
  assert.equal(job.environment, undefined);
  const checkouts = job.steps.filter((step) => step.uses === CHECKOUT);
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
    ref: "${{ github.event.workflow_run.head_sha }}",
  });
  const context = stepIncluding("wait-for-ci", "validate-context");
  const receipt = stepIncluding(
    "wait-for-ci",
    "vercel-main-ci-attempt.mjs verify",
  );
  const source = stepIncluding("wait-for-ci", "validate-source");
  assert.ok(job.steps.indexOf(context) < job.steps.indexOf(receipt));
  assert.ok(job.steps.indexOf(receipt) < job.steps.indexOf(checkouts[1]));
  assert.ok(job.steps.indexOf(checkouts[1]) < job.steps.indexOf(source));
  assert.equal(receipt.env.GITHUB_TOKEN, "${{ github.token }}");
  assert.match(source.run, /fetch --no-tags origin \+refs\/heads\/main/);
});

test("planner captures tolerant main evidence and strict legacy rollback state", () => {
  const job = workflow.jobs["plan-main-deployments"];
  assert.deepEqual(job.needs, ["wait-for-ci"]);
  assert.deepEqual(job.environment, {
    name: "vercel-cli-production",
    deployment: false,
  });
  assert.equal(
    job.env.DEPLOY_SHA,
    "${{ needs.wait-for-ci.outputs.deploy_sha }}",
  );
  assert.equal(
    job.env.UPSTREAM_RUN_ATTEMPT,
    "${{ needs.wait-for-ci.outputs.upstream_run_attempt }}",
  );
  assert.equal(job.outputs.plan, "${{ steps.plan.outputs.plan }}");
  assert.equal(job.outputs.targets, "${{ steps.plan.outputs.targets }}");
  const planning = stepIncluding("plan-main-deployments", "planning-snapshot");
  const legacy = stepIncluding("plan-main-deployments", "snapshot --spec");
  const select = stepIncluding(
    "plan-main-deployments",
    "vercel-main-deployment.mjs plan",
  );
  const health = stepNamed(
    "plan-main-deployments",
    "Verify reviewed public aliases are healthy",
  );
  assert.equal(
    planning.env.VERCEL_TOKEN,
    "${{ secrets.VERCEL_TOKEN_PRODUCTION }}",
  );
  assert.equal(
    legacy.env.VERCEL_TOKEN,
    "${{ secrets.VERCEL_TOKEN_PRODUCTION }}",
  );
  assert.match(select.run, /--planning-snapshot/);
  assert.match(select.run, /--legacy-snapshot/);
  assert.match(health.run, /health --spec "\$RUNNER_TEMP\/main-spec\.json"/);
  assert.match(health.run, /health --spec "\$RUNNER_TEMP\/legacy-spec\.json"/);
  assert.ok(job.steps.indexOf(health) < job.steps.indexOf(select));
  assert.match(
    stepIncluding("plan-main-deployments", "validate-source").run,
    /fetch --no-tags origin/,
  );
});

test("each ordinary lane visibly binds one literal project, build, deploy, smoke, and handoff contract", () => {
  for (const [target, contract] of Object.entries(ORDINARY)) {
    const name = `stage-${target}`;
    const job = workflow.jobs[name];
    assert.deepEqual(job.needs, ["wait-for-ci", "plan-main-deployments"]);
    assert.equal(
      job.if,
      `contains(fromJSON(needs.plan-main-deployments.outputs.targets), '${target}')`,
    );
    assert.deepEqual(job.environment, {
      name: "vercel-cli-production",
      deployment: false,
    });
    assert.equal(job.env.LOGICAL_TARGET, target);
    assert.equal(job.env.VERCEL_PROJECT_ID, contract.project);
    assert.equal(job.outputs.handoff, "${{ steps.handoff.outputs.result }}");

    const checkouts = job.steps.filter((step) => step.uses === CHECKOUT);
    assert.equal(checkouts.length, 3);
    assert.deepEqual(checkouts[0].with, {
      "fetch-depth": 1,
      "persist-credentials": false,
      ref: "${{ needs.wait-for-ci.outputs.deploy_sha }}",
    });
    assert.equal(checkouts[1].with.path, "source");
    assert.equal(checkouts[1].with["fetch-depth"], 0);
    assert.equal(checkouts[2].with.path, "trusted-after-build");
    assert.equal(checkouts[2].with["fetch-depth"], 1);

    const pull = stepIncluding(name, "vercel-production-shadow.mjs pull");
    assert.equal(
      pull.env.VERCEL_TOKEN,
      "${{ secrets.VERCEL_TOKEN_PRODUCTION }}",
    );
    assert.equal(pull.env.VERCEL_PROJECT_ID, undefined);
    const project = stepIncluding(name, "vercel-deployment-state.mjs project");
    assert.match(
      project.run,
      new RegExp(`--project-name ${target}\\.mento\\.org`),
    );
    assert.match(project.run, new RegExp(`--root-directory ${contract.root}`));

    const build = job.steps.find(
      (step) => step.uses === "./.github/actions/vercel-candidate-build",
    );
    assert.ok(build);
    assert.equal(build.with["logical-target"], target);
    assert.equal(build.with["expected-root-directory"], contract.root);
    assert.equal(build.with["vercel-project-id"], contract.project);
    assert.equal(build.env.VERCEL_ENV, "production");
    assert.equal(build.env.VERCEL_TARGET_ENV, "production");
    assert.equal(build.env.NEXT_PUBLIC_VERCEL_ENV, "production");
    assert.equal(build.env.TURBO_TOKEN, "${{ secrets.TURBO_TOKEN }}");
    assert.equal(
      build.env.TURBO_REMOTE_CACHE_SIGNATURE_KEY,
      "${{ secrets.TURBO_REMOTE_CACHE_SIGNATURE_KEY }}",
    );
    assert.equal(
      Object.hasOwn(build.env, "SENTRY_AUTH_TOKEN"),
      contract.sentry,
    );
    assert.equal(
      Object.hasOwn(build.env, "ETHERSCAN_API_KEY"),
      contract.etherscan,
    );

    const deploy = stepIncluding(name, "deploy --expected");
    assert.equal(
      deploy.env.VERCEL_TOKEN,
      "${{ secrets.VERCEL_TOKEN_PRODUCTION }}",
    );
    assert.equal(
      deploy.env.SOURCE_PATH,
      "${{ steps.runtime.outputs.upload-source-path }}",
    );
    assert.match(deploy.run, /TRUSTED_POST_BUILD_PATH/);
    const state = stepIncluding(name, "deployment --expected");
    assert.match(
      state.run,
      new RegExp(`assert-generated-aliases --target ${target}`),
    );

    const smoke = stepIncluding(name, "playwright.production-shadow.config.ts");
    assert.equal(smoke["working-directory"], "trusted-after-build");
    assert.equal(smoke.env.PRODUCTION_SHADOW_TARGET, target);
    assert.equal(
      smoke.env.PRODUCTION_SHADOW_URL,
      "${{ steps.deploy.outputs.vercel_deployment_url }}",
    );
    const finalInspection = stepNamed(
      name,
      `Re-inspect every protected mapping after ${
        target === "ui" ? "UI" : target
      } smoke`,
    );
    const handoff = stepIncluding(name, "stage-result");
    assert.ok(job.steps.indexOf(smoke) < job.steps.indexOf(finalInspection));
    assert.ok(job.steps.indexOf(finalInspection) < job.steps.indexOf(handoff));
    assert.equal(handoff.id, "handoff");
    assert.equal(handoff.env.IMMUTABLE_SMOKE_PASSED, "true");
    assert.equal(handoff.env.PROTECTED_MAPPINGS_UNCHANGED, "true");
    assert.match(
      handoff.run,
      new RegExp(`--state "\\$RUNNER_TEMP/${target}-state\\.json"`),
    );

    const cleanup = job.steps.at(-1);
    assert.equal(cleanup.if, "${{ always() }}");
    assert.equal(cleanup.with.operation, "cleanup");
    assert.equal(cleanup.with["logical-target"], target);
  }
});

test("coordinator revalidates, builds App only, durably journals, and stays mutation-free", () => {
  const name = "activate-and-verify";
  const job = workflow.jobs[name];
  assert.equal(job.if, "${{ always() }}");
  assert.deepEqual(job.needs, [
    "wait-for-ci",
    "plan-main-deployments",
    "stage-governance",
    "stage-reserve",
    "stage-ui",
  ]);
  assert.deepEqual(job.environment, {
    name: "vercel-cli-production",
    deployment: false,
  });
  const validate = stepIncluding(name, "validate-stages");
  const freshness = stepIncluding(name, " freshness");
  const revalidate = stepNamed(
    name,
    "Re-inspect every protected mapping before App preparation",
  );
  const appRuntime = stepNamed(name, "Prepare protected App build runtime");
  assert.ok(job.steps.indexOf(validate) < job.steps.indexOf(freshness));
  assert.ok(job.steps.indexOf(freshness) < job.steps.indexOf(revalidate));
  assert.ok(job.steps.indexOf(revalidate) < job.steps.indexOf(appRuntime));
  assert.match(appRuntime.if, /contains\(fromJSON/);

  const appBuild = job.steps.find(
    (step) => step.name === "Build App custom-v3 candidate without deployment",
  );
  assert.equal(appBuild.uses, "./.github/actions/vercel-candidate-build");
  assert.equal(appBuild.with["logical-target"], "app");
  assert.equal(
    appBuild.with["vercel-project-id"],
    "${{ vars.VERCEL_PROJECT_ID_APP }}",
  );
  assert.equal(appBuild.env.VERCEL_ENV, "preview");
  assert.equal(appBuild.env.VERCEL_TARGET_ENV, "v3");
  assert.equal(Object.hasOwn(appBuild.env, "SENTRY_AUTH_TOKEN"), false);
  assert.match(
    candidateActionSource,
    /SENTRY_AUTH_TOKEN="\$\{SENTRY_AUTH_TOKEN:-\}"/,
  );
  const restore = stepNamed(
    name,
    "Restore fresh trusted transaction controller",
  );
  const proof = stepIncluding(name, "app-build-proof");
  const journal = stepIncluding(name, "prepare-journal");
  const upload = job.steps.find((step) => step.id === "journal-upload");
  const shadow = stepIncluding(name, "run-shadow");
  assert.ok(job.steps.indexOf(appBuild) < job.steps.indexOf(restore));
  assert.ok(job.steps.indexOf(restore) < job.steps.indexOf(proof));
  assert.ok(job.steps.indexOf(proof) < job.steps.indexOf(journal));
  assert.ok(job.steps.indexOf(journal) < job.steps.indexOf(upload));
  assert.ok(job.steps.indexOf(upload) < job.steps.indexOf(shadow));
  assert.equal(upload.uses, UPLOAD);
  assert.equal(upload.with.name, "${{ steps.journal.outputs.artifact_name }}");
  assert.equal(upload.with["retention-days"], 7);
  assert.equal(upload.with["if-no-files-found"], "error");
  assert.equal(
    shadow.env.JOURNAL_ARTIFACT_ID,
    "${{ steps.journal-upload.outputs.artifact-id }}",
  );
  assert.equal(
    shadow.env.JOURNAL_ARTIFACT_NAME,
    "${{ steps.journal.outputs.artifact_name }}",
  );
  const cleanup = job.steps.at(-1);
  assert.equal(cleanup.if, "${{ always() }}");
  assert.equal(cleanup.with["logical-target"], "app");
});

test("runner-failure recovery derives the exact artifact and final result is fail-closed", () => {
  const recovery = workflow.jobs["recover-main-deployment"];
  assert.equal(recovery.if, "${{ always() }}");
  assert.deepEqual(recovery.environment, {
    name: "vercel-cli-production",
    deployment: false,
  });
  const derived = stepIncluding("recover-main-deployment", "journal-name");
  const download = recovery.steps.find(
    (step) => step.id === "journal-download",
  );
  const recover = stepIncluding("recover-main-deployment", "recover-shadow");
  assert.ok(recovery.steps.indexOf(derived) < recovery.steps.indexOf(download));
  assert.ok(recovery.steps.indexOf(download) < recovery.steps.indexOf(recover));
  assert.equal(download.uses, DOWNLOAD);
  assert.equal(download["continue-on-error"], true);
  assert.equal(
    download.with.name,
    "${{ steps.journal-name.outputs.artifact_name }}",
  );
  assert.doesNotMatch(download.with.name, /activate-and-verify/);

  const finalJob = workflow.jobs.result;
  assert.equal(finalJob.if, "${{ always() }}");
  assert.deepEqual(finalJob.needs, [
    "wait-for-ci",
    "plan-main-deployments",
    "stage-governance",
    "stage-reserve",
    "stage-ui",
    "activate-and-verify",
    "recover-main-deployment",
  ]);
  const checkout = finalJob.steps.find(
    (step) => step.name === "Check out trusted final controller",
  );
  assert.equal(checkout.if, "${{ always() }}");
  assert.equal(checkout.with.ref, "${{ github.workflow_sha }}");
  const sentinel = stepIncluding("result", "vercel-main-deployment.mjs final");
  assert.equal(sentinel.id, "final-verdict");
  assert.equal(sentinel.if, "${{ always() }}");
  assert.equal(sentinel["continue-on-error"], true);
  assert.equal(
    sentinel.env.COORDINATOR_RESULT,
    "${{ needs.activate-and-verify.result }}",
  );
  assert.equal(
    sentinel.env.RECOVERY_RESULT,
    "${{ needs.recover-main-deployment.result }}",
  );
  const evidence = stepIncluding(
    "result",
    "vercel-main-deployment.mjs evidence",
  );
  assert.equal(evidence.id, "success-evidence");
  assert.equal(
    evidence.if,
    "${{ always() && steps.final-verdict.outcome == 'success' }}",
  );
  assert.ok(
    finalJob.steps.indexOf(sentinel) < finalJob.steps.indexOf(evidence),
  );
  for (const target of ["GOVERNANCE", "RESERVE", "UI"]) {
    assert.match(evidence.env[`EVIDENCE_${target}_HANDOFF`], /needs\.stage-/);
    assert.match(
      evidence.env[`EVIDENCE_${target}_BUILD_DURATION_MS`],
      /outputs\.build_duration_ms/,
    );
    assert.match(
      evidence.env[`EVIDENCE_${target}_DEPLOY_DURATION_MS`],
      /outputs\.deploy_duration_ms/,
    );
    assert.match(
      evidence.env[`EVIDENCE_${target}_TOTAL_DURATION_MS`],
      /outputs\.total_duration_ms/,
    );
    assert.match(
      evidence.env[`EVIDENCE_${target}_TURBO_CACHE_HITS`],
      /outputs\.turbo_cache_hits/,
    );
    assert.match(
      evidence.env[`EVIDENCE_${target}_TURBO_CACHE_MISSES`],
      /outputs\.turbo_cache_misses/,
    );
  }
  assert.equal(
    evidence.env.COORDINATOR_OUTCOME,
    "${{ needs.activate-and-verify.outputs.outcome }}",
  );
  assert.equal(
    evidence.env.JOURNAL_ARTIFACT_ID,
    "${{ needs.activate-and-verify.outputs.artifact_id }}",
  );
  assert.equal(
    evidence.env.RECOVERY_OUTCOME,
    "${{ needs.recover-main-deployment.outputs.outcome }}",
  );
  const failureEvidence = stepIncluding(
    "result",
    "vercel-main-deployment.mjs failure-evidence",
  );
  assert.equal(failureEvidence.id, "failure-evidence");
  assert.equal(
    failureEvidence.if,
    "${{ always() && steps.final-verdict.outcome != 'success' }}",
  );
  assert.equal(
    failureEvidence.env.EVENT_HEAD_SHA,
    "${{ github.event.workflow_run.head_sha }}",
  );
  assert.equal(
    failureEvidence.env.GITHUB_WORKFLOW_SHA,
    "${{ github.workflow_sha }}",
  );
  assert.equal(
    failureEvidence.env.WAIT_FOR_CI_RESULT,
    "${{ needs.wait-for-ci.result }}",
  );
  assert.equal(
    failureEvidence.env.RECOVERY_RESULT,
    "${{ needs.recover-main-deployment.result }}",
  );
  const artifact = finalJob.steps.find(
    (step) => step.name === "Upload canonical redacted PR-A evidence",
  );
  assert.ok(
    finalJob.steps.indexOf(evidence) < finalJob.steps.indexOf(artifact),
  );
  assert.ok(
    finalJob.steps.indexOf(failureEvidence) < finalJob.steps.indexOf(artifact),
  );
  assert.equal(artifact.if, "${{ always() }}");
  assert.equal(artifact.uses, UPLOAD);
  assert.equal(artifact.with["if-no-files-found"], "error");
  assert.equal(artifact.with["retention-days"], 14);
  assert.equal(
    artifact.with.path,
    "${{ runner.temp }}/vercel-main-evidence.json",
  );
  const terminalFailure = finalJob.steps.find(
    (step) => step.name === "Fail after publishing an unsafe final result",
  );
  assert.ok(
    finalJob.steps.indexOf(artifact) < finalJob.steps.indexOf(terminalFailure),
  );
  assert.equal(
    terminalFailure.if,
    "${{ always() && steps.final-verdict.outcome != 'success' }}",
  );
  assert.match(terminalFailure.run, /exit 1/);
  assert.equal(
    finalJob.steps.some(
      (step) =>
        step.name === "Fail when the trusted gate or planner did not succeed",
    ),
    false,
  );
});

test("existing workflow test command owns every main-deployment regression", () => {
  const rootPackage = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  const command = rootPackage.scripts["vercel:workflow:test"];
  for (const file of [
    "scripts/vercel-main-ci-attempt.test.mjs",
    "scripts/vercel-main-plan.test.mjs",
    "scripts/vercel-main-transaction.test.mjs",
    "scripts/vercel-main-runtime.test.mjs",
    "scripts/vercel-main-deployment.test.mjs",
    "scripts/vercel-main-deployment-workflow.test.mjs",
  ]) {
    assert.match(command, new RegExp(file.replaceAll(".", "\\.")));
  }
  assert.equal(rootPackage.scripts["vercel:main:test"], undefined);
});

test("shadow workflow contains no reachable public mutation or sensitive artifact path", () => {
  const strings = allStrings(workflow).join("\n");
  assert.doesNotMatch(strings, /\bvercel\s+promote\b/i);
  assert.doesNotMatch(strings, /\bvercel\s+rollback\b/i);
  assert.doesNotMatch(strings, /\bvercel\s+alias\s+set\b/i);
  assert.doesNotMatch(strings, /\bvercel\s+deploy\b[^\n]*--target[ =]v3\b/i);
  assert.doesNotMatch(strings, /--token\b/);
  assert.doesNotMatch(strings, /\.vercel\/output/);
  assert.doesNotMatch(workflowSource, /secrets:\s*inherit/);
  assert.doesNotMatch(workflowSource, /secrets\[[^\]]+\]/);
  assert.doesNotMatch(workflowSource, /\$\{\{\s*inputs\.(?:target|project)/);
  for (const [jobName, job] of Object.entries(workflow.jobs)) {
    for (const step of job.steps) {
      if (step.uses?.startsWith("actions/checkout@")) {
        assert.equal(step.uses, CHECKOUT, `${jobName} checkout pin`);
      }
      if (step.uses?.startsWith("actions/upload-artifact@")) {
        assert.equal(step.uses, UPLOAD, `${jobName} upload pin`);
      }
      if (step.uses?.startsWith("actions/download-artifact@")) {
        assert.equal(step.uses, DOWNLOAD, `${jobName} download pin`);
      }
    }
  }
});

test("production and build secrets stay in their exact literal step allowlist", () => {
  const references = [];
  const walk = (value, path = []) => {
    if (typeof value === "string") {
      if (value.includes("secrets.")) references.push({ path, value });
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, [...path, index]));
      return;
    }
    if (value && typeof value === "object") {
      for (const [key, item] of Object.entries(value)) {
        walk(item, [...path, key]);
      }
    }
  };
  walk(workflow);
  const actual = [];
  for (const { path, value } of references) {
    assert.equal(path.length, 6, `forbidden secret path ${path.join(".")}`);
    assert.equal(path[0], "jobs", `forbidden secret path ${path.join(".")}`);
    const jobName = path[1];
    assert.equal(path[2], "steps", `forbidden secret path ${path.join(".")}`);
    const stepIndex = path[3];
    assert.equal(
      Number.isSafeInteger(stepIndex),
      true,
      `forbidden secret path ${path.join(".")}`,
    );
    assert.equal(path[4], "env", `forbidden secret path ${path.join(".")}`);
    const envKey = path[5];
    const match = value.match(/^\$\{\{ secrets\.([A-Z0-9_]+) \}\}$/);
    assert.ok(match, `forbidden secret expression ${path.join(".")}`);
    const step = workflow.jobs[jobName].steps[stepIndex];
    actual.push({
      job: jobName,
      step: step.name,
      envKey,
      secretName: match[1],
    });
  }
  const expected = new Map([
    [
      "VERCEL_TOKEN_PRODUCTION",
      [
        "plan-main-deployments/Capture tolerant main planning state",
        "plan-main-deployments/Capture strict legacy rollback state",
        "stage-governance/Pull governance production configuration",
        "stage-governance/Validate governance project and Root Directory",
        "stage-governance/Upload governance candidate without public custom domains",
        "stage-governance/Verify governance candidate identity and generated aliases",
        "stage-governance/Revalidate protected mappings and rollback state",
        "stage-governance/Re-inspect every protected mapping after governance smoke",
        "stage-reserve/Pull reserve production configuration",
        "stage-reserve/Validate reserve project and Root Directory",
        "stage-reserve/Upload reserve candidate without public custom domains",
        "stage-reserve/Verify reserve candidate identity and generated aliases",
        "stage-reserve/Revalidate protected mappings and rollback state",
        "stage-reserve/Re-inspect every protected mapping after reserve smoke",
        "stage-ui/Pull UI production configuration",
        "stage-ui/Validate UI project and Root Directory",
        "stage-ui/Upload UI candidate without public custom domains",
        "stage-ui/Verify UI candidate identity and generated aliases",
        "stage-ui/Revalidate protected mappings and rollback state",
        "stage-ui/Re-inspect every protected mapping after UI smoke",
        "activate-and-verify/Re-inspect every protected mapping before App preparation",
        "activate-and-verify/Pull App custom-v3 configuration",
        "activate-and-verify/Validate App custom-v3 project and Root Directory",
      ],
    ],
    [
      "ETHERSCAN_API_KEY",
      ["stage-governance/Build exact governance production candidate"],
    ],
    [
      "SENTRY_AUTH_TOKEN",
      [
        "stage-governance/Build exact governance production candidate",
        "stage-reserve/Build exact reserve production candidate",
      ],
    ],
    [
      "TURBO_REMOTE_CACHE_SIGNATURE_KEY",
      [
        "stage-governance/Build exact governance production candidate",
        "stage-reserve/Build exact reserve production candidate",
        "stage-ui/Build exact UI production candidate",
        "activate-and-verify/Build App custom-v3 candidate without deployment",
      ],
    ],
    [
      "TURBO_TOKEN",
      [
        "stage-governance/Build exact governance production candidate",
        "stage-reserve/Build exact reserve production candidate",
        "stage-ui/Build exact UI production candidate",
        "activate-and-verify/Build App custom-v3 candidate without deployment",
      ],
    ],
  ]);
  const expectedEntries = [...expected].flatMap(([secretName, sites]) =>
    sites.map((site) => {
      const [job, step] = site.split("/");
      return {
        job,
        step,
        envKey:
          secretName === "VERCEL_TOKEN_PRODUCTION"
            ? "VERCEL_TOKEN"
            : secretName,
        secretName,
      };
    }),
  );
  const bySite = (left, right) =>
    `${left.job}/${left.step}/${left.envKey}/${left.secretName}`.localeCompare(
      `${right.job}/${right.step}/${right.envKey}/${right.secretName}`,
    );
  assert.deepEqual(actual.toSorted(bySite), expectedEntries.toSorted(bySite));
  for (const [jobName, job] of Object.entries(workflow.jobs)) {
    if (
      !job.steps.some((step) =>
        Object.values(step.env ?? {}).some((value) =>
          String(value).includes("secrets."),
        ),
      )
    ) {
      continue;
    }
    assert.deepEqual(
      job.environment,
      {
        name: "vercel-cli-production",
        deployment: false,
      },
      `${jobName} secret-bearing environment`,
    );
  }
});
