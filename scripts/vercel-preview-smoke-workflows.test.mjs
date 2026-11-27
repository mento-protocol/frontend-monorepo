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

const reusablePath = ".github/workflows/_vercel-preview-smoke.yml";
const adapterPath = ".github/workflows/preview-smoke.yml";

test("reusable preview smoke is workflow_call-only, secretless, and target-bound", () => {
  const reusable = workflow(reusablePath);
  assert.deepEqual(Object.keys(reusable.on), ["workflow_call"]);
  assert.equal(Object.hasOwn(reusable.on.workflow_call, "secrets"), false);
  assert.deepEqual(reusable.permissions, {});
  const inputs = reusable.on.workflow_call.inputs;
  for (const name of [
    "logical_target",
    "deployment_url",
    "expected_sha",
    "github_deployment_id",
    "verification_mode",
    "verification_key",
    "metadata_logical_target",
    "metadata_target",
    "metadata_repository",
    "metadata_ref",
    "metadata_sha",
    "metadata_url",
  ]) {
    assert.equal(inputs[name].required, true, `${name} must be required`);
  }
  assert.deepEqual(Object.keys(reusable.jobs), ["smoke"]);
  const smoke = reusable.jobs.smoke;
  assert.deepEqual(smoke.permissions, { contents: "read" });
  assert.equal(
    smoke.container.image,
    "mcr.microsoft.com/playwright:v1.65.1-noble",
  );
  assert.equal(Object.hasOwn(smoke, "environment"), false);
  assert.match(
    smoke.outputs.artifact_identity,
    /steps\.tuple\.outputs\.artifact_identity/,
  );
  const diagnostics = smoke.steps.find(
    ({ name }) =>
      name === "Upload target-bound Playwright artifacts on failure",
  );
  assert.ok(diagnostics);
  assert.equal(diagnostics.if, "failure()");
  assert.equal(diagnostics.with["retention-days"], 7);
  assert.doesNotMatch(
    read(reusablePath),
    /secrets\.|github\.token|GITHUB_TOKEN|VERCEL_TOKEN|TURBO_TOKEN|SENTRY_AUTH_TOKEN|ETHERSCAN_API_KEY/,
  );
});

test("reusable smoke validates metadata before common and target-specific browser checks", () => {
  const smoke = workflow(reusablePath).jobs.smoke;
  const names = smoke.steps.map(({ name }) => name);
  const checkout = smoke.steps[0];
  assert.equal(checkout.with.ref, "${{ github.workflow_sha }}");
  assert.equal(checkout.with["persist-credentials"], false);
  const install = smoke.steps.find(({ name }) =>
    name.startsWith("Install trusted smoke"),
  );
  assert.equal(install.uses, "./.github/actions/pnpm-install");
  assert.equal(install.with["ignore-scripts"], "true");
  assert.equal(install.with.filter, "frontend-monorepo");
  assert.ok(
    names.indexOf("Validate the complete credential-free deployment tuple") <
      names.indexOf(
        "Run common HTTP, header, build-ID, and representative-asset smoke",
      ),
  );
  assert.ok(
    names.indexOf(
      "Run common HTTP, header, build-ID, and representative-asset smoke",
    ) < names.indexOf("Exercise App wallet list and team-preview mock wallet"),
  );
  const wallet = smoke.steps.find(({ name }) =>
    name.startsWith("Exercise App"),
  );
  assert.equal(wallet.if, "inputs.logical_target == 'app'");
  assert.equal(
    wallet.run,
    "pnpm exec playwright test --config apps/app.mento.org/playwright.preview.config.ts",
  );
  const genericBrowser = smoke.steps.find(({ name }) =>
    name.startsWith("Run App or Reserve"),
  );
  // App and Reserve are the only targets (ADR 0018), so the generic browser
  // smoke runs unconditionally and no UI-specific browser step remains.
  assert.equal(Object.hasOwn(genericBrowser, "if"), false);
  assert.match(
    genericBrowser.run,
    /scripts\/vercel-preview-browser-smoke\.mjs/,
  );
  assert.equal(
    smoke.steps.some(({ name }) => name.startsWith("Run UI deployment")),
    false,
  );
  assert.doesNotMatch(
    read(reusablePath),
    /logical_target [!=]= 'ui'|apps\/ui\.mento\.org/,
  );

  const walletSpec = read("apps/app.mento.org/e2e/preview/smoke.spec.ts");
  for (const monitoredEvent of [
    "pageerror",
    "console",
    "requestfailed",
    "response",
  ]) {
    assert.match(walletSpec, new RegExp(`page\\.on\\("${monitoredEvent}"`));
  }
  assert.match(walletSpec, /test\.afterEach/);
});

test("both automatic build and resume paths use the single reusable smoke", () => {
  const prebuilt = workflow(".github/workflows/_vercel-prebuilt.yml");
  const worker = workflow(".github/workflows/vercel-preview-worker.yml");
  const buildSmoke = prebuilt.jobs.smoke;
  const resumeSmokes = ["app", "reserve"].map(
    (target) => worker.jobs[`resume-${target}-smoke`],
  );
  for (const smoke of [buildSmoke, ...resumeSmokes]) {
    assert.equal(smoke.uses, "./.github/workflows/_vercel-preview-smoke.yml");
    assert.equal(Object.hasOwn(smoke, "steps"), false);
    assert.equal(Object.hasOwn(smoke, "secrets"), false);
    for (const tupleField of [
      "logical_target",
      "deployment_url",
      "expected_sha",
      "github_deployment_id",
      "verification_mode",
      "verification_key",
      "metadata_logical_target",
      "metadata_target",
      "metadata_repository",
      "metadata_ref",
      "metadata_sha",
      "metadata_url",
      "pull_request_number",
      "vercel_deployment_id",
      "next_deployment_id",
      "expected_project_id",
      "metadata_project_id",
    ]) {
      assert.ok(
        Object.hasOwn(smoke.with, tupleField),
        `${tupleField} must cross the trusted smoke seam`,
      );
    }
  }
  assert.equal(buildSmoke.with.logical_target, "${{ inputs.logical_target }}");
  assert.deepEqual(
    resumeSmokes.map(({ with: inputs }) => inputs.logical_target),
    ["app", "reserve"],
  );
  for (const resumeSmoke of resumeSmokes) {
    assert.equal(resumeSmoke.with.verification_mode, "controller");
  }

  const prebuiltCallers = Object.entries(worker.jobs).filter(
    ([, job]) => job.uses === "./.github/workflows/_vercel-prebuilt.yml",
  );
  assert.deepEqual(
    prebuiltCallers.map(([name, job]) => [name, job.with.logical_target]),
    [
      ["deploy-app-preview", "app"],
      ["deploy-reserve-preview", "reserve"],
    ],
  );
  assert.equal(Object.hasOwn(worker.jobs, "resume-ui-smoke"), false);
  assert.doesNotMatch(
    `${read(".github/workflows/_vercel-prebuilt.yml")}\n${read(
      ".github/workflows/vercel-preview-worker.yml",
    )}\n${read("scripts/vercel-prebuilt-workflow.mjs")}`,
    /vercel-prebuilt-workflow\.mjs["']?\s+smoke\b|smokeUiPreview|smokeFromEnvironment/,
  );
});

test("native adapter always classifies and runs full App smoke without lookup or dedupe", () => {
  const adapter = workflow(adapterPath);
  assert.deepEqual(adapter.on, { deployment_status: null });
  assert.deepEqual(adapter.permissions, {});
  assert.equal(Object.hasOwn(adapter, "concurrency"), false);
  assert.deepEqual(Object.keys(adapter.jobs), [
    "classify",
    "smoke-app",
    "record-native-result",
  ]);
  const classify = adapter.jobs.classify;
  assert.equal(Object.hasOwn(classify, "if"), false);
  assert.deepEqual(classify.permissions, { contents: "read" });
  assert.equal(classify.steps[0].with.ref, "${{ github.workflow_sha }}");
  assert.equal(classify.steps[0].with["persist-credentials"], false);
  assert.match(JSON.stringify(classify), /classify-native/);

  for (const [jobName, target] of [["smoke-app", "app"]]) {
    const job = adapter.jobs[jobName];
    assert.equal(job.uses, "./.github/workflows/_vercel-preview-smoke.yml");
    assert.equal(job.with.logical_target, target);
    assert.match(job.if, new RegExp(`logical_target == '${target}'`));
    assert.equal(
      Object.hasOwn(job, "concurrency"),
      false,
      "every qualifying event must retain its own full smoke run",
    );
  }
  const raw = read(adapterPath);
  assert.doesNotMatch(raw, /smoke-governance|GOVERNANCE_RESULT/);
  assert.doesNotMatch(
    raw,
    /matrix|concurrency|secrets\.|github\.token|GITHUB_TOKEN|VERCEL_TOKEN|TURBO_TOKEN/,
  );
  assert.doesNotMatch(
    raw,
    /listDeploymentStatuses|github\.rest\.repos\.getDeployment|github\.request\(|gh api|curl/i,
  );
});

test("native adapter records only run-bound terminal evidence and never uses it to skip smoke", () => {
  const finalizer = workflow(adapterPath).jobs["record-native-result"];
  assert.match(finalizer.if, /always\(\).*eligible == 'true'/);
  assert.deepEqual(finalizer.permissions, { deployments: "write" });
  const script = finalizer.steps[0].with.script;
  assert.match(script, /createDeploymentStatus/);
  assert.match(script, /context\.runId/);
  assert.doesNotMatch(
    script,
    /listDeploymentStatuses|github\.rest\.repos\.getDeployment|github\.request\(/,
  );
});
