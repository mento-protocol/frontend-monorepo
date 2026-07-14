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

const reusablePath = ".github/workflows/_vercel-prebuilt.yml";
const pilotPath = ".github/workflows/vercel-prebuilt-pilot.yml";

test("manual pilot exposes only the three UI-only deployment selectors", () => {
  const pilot = workflow(pilotPath);
  assert.deepEqual(Object.keys(pilot.on), ["workflow_dispatch"]);
  assert.deepEqual(Object.keys(pilot.on.workflow_dispatch.inputs), [
    "target",
    "commit_sha",
    "git_branch",
  ]);
  assert.deepEqual(pilot.on.workflow_dispatch.inputs.target.options, ["ui"]);
  assert.equal(pilot.on.workflow_dispatch.inputs.target.default, "ui");
  assert.equal(pilot.on.workflow_dispatch.inputs.commit_sha.required, true);
  assert.equal(pilot.on.workflow_dispatch.inputs.git_branch.required, true);
  assert.equal(
    pilot.jobs["deploy-ui-preview"].with.logical_target,
    "${{ inputs.target }}",
  );
  assert.equal(
    pilot.jobs["deploy-ui-preview"].with.expected_root_directory,
    "apps/ui.mento.org",
  );
  assert.equal(pilot.jobs["deploy-ui-preview"].with.deployment_mode, "preview");
  assert.equal(pilot.jobs["deploy-ui-preview"].with.vercel_target, "preview");
  assert.equal(
    pilot.jobs["deploy-ui-preview"].with.vercel_environment,
    "preview",
  );
});

test("caller and worker have only contents-read and deployments-write permissions", () => {
  const expected = { contents: "read", deployments: "write" };
  const pilot = workflow(pilotPath);
  const reusable = workflow(reusablePath);
  assert.deepEqual(pilot.permissions, expected);
  assert.deepEqual(pilot.jobs["deploy-ui-preview"].permissions, expected);
  assert.deepEqual(reusable.permissions, expected);
  assert.deepEqual(reusable.jobs.prebuilt.permissions, expected);
  assert.equal(Object.hasOwn(reusable.jobs.prebuilt, "environment"), false);
});

test("reusable workflow declares exact inputs, explicit secrets, and evidence outputs", () => {
  const reusable = workflow(reusablePath);
  const call = reusable.on.workflow_call;
  for (const input of [
    "logical_target",
    "workspace_package",
    "expected_root_directory",
    "vercel_org_id",
    "vercel_project_id",
    "vercel_environment",
    "vercel_target",
    "commit_sha",
    "git_branch",
    "deployment_mode",
    "deploy_permitted",
    "github_environment",
    "deployment_idempotency_key",
    "turbo_team",
  ]) {
    assert.equal(
      call.inputs[input].required,
      true,
      `${input} must be required`,
    );
  }
  assert.deepEqual(Object.keys(call.secrets), [
    "vercel_token",
    "turbo_token",
    "turbo_remote_cache_signature_key",
    "vercel_automation_bypass_secret",
  ]);
  assert.deepEqual(Object.keys(call.outputs), [
    "deployment_url",
    "vercel_deployment_id",
    "github_deployment_id",
    "final_state",
    "commit_sha",
    "logical_target",
    "build_duration_ms",
    "deploy_duration_ms",
    "total_duration_ms",
  ]);
  assert.doesNotMatch(read(pilotPath), /secrets:\s*inherit/);
});

test("pilot maps only preview credentials and never exposes a production path", () => {
  const raw = read(pilotPath);
  assert.match(raw, /VERCEL_TOKEN_PREVIEW/);
  assert.match(raw, /VERCEL_PROJECT_ID_UI/);
  assert.match(raw, /VERCEL_AUTOMATION_BYPASS_SECRET/);
  assert.doesNotMatch(raw, /VERCEL_TOKEN_PRODUCTION|vercel-cli-production/);
  assert.doesNotMatch(raw, /--prod|\bpromote\b|production_environment/);
  assert.doesNotMatch(raw, /pull_request(?:_target)?:|\bpush:|\bschedule:/);
});

test("exact source, build, and upload remain in one standard-runner job", () => {
  const reusable = workflow(reusablePath);
  assert.deepEqual(Object.keys(reusable.jobs), ["prebuilt"]);
  const job = reusable.jobs.prebuilt;
  assert.equal(job["runs-on"], "ubuntu-latest");
  assert.equal(job["timeout-minutes"], 30);
  const names = job.steps.map((step) => step.name);
  assert.ok(
    names.indexOf("Check out exact deployment source and full history") <
      names.indexOf("Build and assert the UI prebuilt output"),
  );
  assert.ok(
    names.indexOf("Materialize trusted repo-level UI project mapping") <
      names.indexOf("Pull branch-specific UI preview settings"),
  );
  assert.ok(
    names.indexOf("Build and assert the UI prebuilt output") <
      names.indexOf("Upload the verified prebuilt output"),
  );
  assert.doesNotMatch(
    read(reusablePath),
    /actions\/upload-artifact|\.vercel\/output.*artifact/,
  );
});

test("monorepo-root CLI execution and app-root env validation use one mapping", () => {
  const raw = read(reusablePath);
  assert.match(raw, /SOURCE_PATH: \$\{\{ github\.workspace \}\}\/source/);
  assert.match(raw, /--project-directory apps\/ui\.mento\.org/);
  assert.match(raw, /working-directory: source/);
  assert.doesNotMatch(
    raw,
    /working-directory: (?:source\/)?apps\/ui\.mento\.org/,
  );
});

test("success follows direct smoke and the always finalizer closes orphaned records", () => {
  const reusable = workflow(reusablePath);
  const steps = reusable.jobs.prebuilt.steps;
  const smokeIndex = steps.findIndex(
    ({ name }) => name === "Verify and smoke the immutable preview",
  );
  const successIndex = steps.findIndex(
    ({ name }) => name === "Mark GitHub Deployment successful after smoke",
  );
  const finalizer = steps.find(
    ({ name }) => name === "Close a non-terminal GitHub Deployment",
  );
  assert.ok(smokeIndex >= 0 && successIndex > smokeIndex);
  assert.match(steps[smokeIndex].run, / verify\n.* smoke/s);
  assert.match(
    steps[successIndex].env.VERCEL_DEPLOYMENT_URL,
    /steps\.smoke\.outputs\.smoke_deployment_url/,
  );
  assert.match(finalizer.if, /always\(\)/);
  assert.match(finalizer.run, /github-deployment\.mjs" finalize/);
  assert.equal(
    steps[smokeIndex].env.GITHUB_DEPLOYMENT_ID,
    steps[successIndex].env.GITHUB_DEPLOYMENT_ID,
  );
  assert.match(
    reusable.jobs.prebuilt.outputs.github_deployment_id,
    /steps\.create\.outputs\.github_deployment_id/,
  );
});

test("workflow restores signed Turbo cache and immutable Vercel build metadata", () => {
  const raw = read(reusablePath);
  for (const value of [
    "TURBO_TEAM",
    "TURBO_TOKEN",
    "TURBO_REMOTE_CACHE_SIGNATURE_KEY",
    "MENTO_NEXT_DEPLOYMENT_ID",
    "VERCEL_GIT_COMMIT_SHA",
    "VERCEL_GIT_COMMIT_REF",
    "VERCEL_GIT_REPO_OWNER",
    "VERCEL_GIT_REPO_SLUG",
    "NEXT_PUBLIC_VERCEL_ENV",
    "VERCEL_TARGET_ENV",
  ]) {
    assert.match(raw, new RegExp(`${value}:`), `${value} must be explicit`);
  }
  assert.doesNotMatch(raw, /githubDeployment=1/);
  assert.doesNotMatch(raw, /--token/);
});

test("manual pilot is intentionally absent from operational failure notifications", () => {
  const notifier = read(".github/workflows/ci-failure-notifier.yml");
  assert.doesNotMatch(notifier, /Vercel Prebuilt Pilot/);
});

test("runbook records GITHUB_TOKEN non-recursion and the no-PAT direct-smoke rule", () => {
  const docs = read("docs/vercel-deployments.md");
  assert.match(docs, /GITHUB_TOKEN/);
  assert.match(docs, /does not\s+trigger another workflow run/);
  assert.match(docs, /Do not add a PAT/);
  assert.match(docs, /workflow_dispatch/);
});
