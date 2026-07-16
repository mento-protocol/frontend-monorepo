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
  assert.match(
    pilot.jobs["deploy-ui-preview"].if,
    /github\.ref == 'refs\/heads\/main'/,
  );
  assert.match(
    pilot.jobs["deploy-ui-preview"].if,
    /vercel-prebuilt-pilot\.yml@refs\/heads\/main/,
  );
  assert.equal(
    pilot.jobs["deploy-ui-preview"].uses,
    "./.github/workflows/_vercel-prebuilt.yml",
  );
});

test("build, smoke, and finalizer jobs keep separate least-privilege tokens", () => {
  const deploymentWriter = { contents: "read", deployments: "write" };
  const pilot = workflow(pilotPath);
  const reusable = workflow(reusablePath);
  assert.deepEqual(pilot.permissions, deploymentWriter);
  assert.deepEqual(
    pilot.jobs["deploy-ui-preview"].permissions,
    deploymentWriter,
  );
  assert.deepEqual(reusable.permissions, {});
  assert.deepEqual(reusable.jobs.prebuilt.permissions, deploymentWriter);
  assert.deepEqual(reusable.jobs.smoke.permissions, { contents: "read" });
  assert.deepEqual(reusable.jobs.finalize.permissions, deploymentWriter);
  for (const job of Object.values(reusable.jobs)) {
    assert.equal(Object.hasOwn(job, "environment"), false);
  }
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
  ]);
  assert.deepEqual(Object.keys(call.outputs), [
    "deployment_url",
    "verified_upload_url",
    "vercel_deployment_id",
    "github_deployment_id",
    "final_state",
    "commit_sha",
    "logical_target",
    "next_deployment_id",
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
  assert.doesNotMatch(raw, /VERCEL_AUTOMATION_BYPASS_SECRET|bypass/i);
  assert.doesNotMatch(raw, /VERCEL_TOKEN_PRODUCTION|vercel-cli-production/);
  assert.doesNotMatch(raw, /--prod|\bpromote\b|production_environment/);
  assert.doesNotMatch(raw, /pull_request(?:_target)?:|\bpush:|\bschedule:/);
});

test("exact source, build, and upload remain in one standard-runner job", () => {
  const reusable = workflow(reusablePath);
  assert.deepEqual(Object.keys(reusable.jobs), [
    "prebuilt",
    "smoke",
    "finalize",
  ]);
  const job = reusable.jobs.prebuilt;
  assert.equal(job["runs-on"], "ubuntu-latest");
  assert.equal(job["timeout-minutes"], 30);
  const names = job.steps.map((step) => step.name);
  assert.ok(
    names.indexOf("Check out exact deployment source and full history") <
      names.indexOf("Build the UI prebuilt output"),
  );
  assert.ok(
    names.indexOf("Prepare fresh runner-owned Vercel pull staging") <
      names.indexOf("Pull branch-specific UI preview settings"),
  );
  assert.ok(
    names.indexOf("Build the UI prebuilt output") <
      names.indexOf("Upload the verified prebuilt output"),
  );
  assert.ok(
    names.indexOf("Assert the UI prebuilt output") <
      names.indexOf("Mark the durable upload-attempt boundary") &&
      names.indexOf("Mark the durable upload-attempt boundary") <
        names.indexOf("Upload the verified prebuilt output"),
  );
  const uploadBoundary = job.steps.find(
    ({ name }) => name === "Mark the durable upload-attempt boundary",
  );
  assert.equal(
    uploadBoundary.env.GITHUB_DEPLOYMENT_DESCRIPTION,
    "Prebuilt preview upload starting",
  );
  const upload = job.steps.find(
    ({ name }) => name === "Upload the verified prebuilt output",
  );
  assert.equal(
    upload.env.DEPLOYMENT_IDEMPOTENCY_KEY,
    "${{ inputs.deployment_idempotency_key }}",
  );
  assert.equal(
    upload.env.STARTED_AT_MS,
    "${{ steps.prepare.outputs.started_at_ms }}",
  );
  assert.match(
    upload.run,
    /controller\/scripts\/vercel-prebuilt-workflow\.mjs/,
  );
  assert.doesNotMatch(
    read(reusablePath),
    /actions\/upload-artifact|\.vercel\/output.*artifact/,
  );
});

test("prebuilt separates trusted standalone bootstrap from candidate JavaScript pnpm", () => {
  const reusable = workflow(reusablePath);
  const supplyChain = workflow(".github/workflows/supply-chain.yml");
  const trunk = workflow(".trunk/trunk.yaml");
  const steps = reusable.jobs.prebuilt.steps;
  const names = steps.map(({ name }) => name);
  const manifest = JSON.parse(read("package.json"));
  const runtimeManifest = JSON.parse(
    read("scripts/vercel-pnpm-runtime/package.json"),
  );
  const runtimeLock = parse(read("scripts/vercel-pnpm-runtime/pnpm-lock.yaml"));
  const rootOsvConfig = read("osv-scanner.toml");
  const runtimeOsvConfig = read("scripts/vercel-pnpm-runtime/osv-scanner.toml");
  const pnpmSetup = steps.find(({ name }) => name === "Set up pinned pnpm");
  const nodeSetup = steps.find(
    ({ name }) => name === "Set up pinned Node.js and pnpm cache",
  );
  const isolation = steps.find(
    ({ name }) =>
      name === "Prepare isolated exact-SHA source and protected Vercel CLI",
  );
  const install = steps.find(
    ({ name }) => name === "Install frozen dependencies",
  );

  assert.equal(manifest.devDependencies.pnpm, undefined);
  assert.equal(manifest.packageManager, "pnpm@10.34.4");
  assert.deepEqual(runtimeManifest.dependencies, { pnpm: "10.34.4" });
  assert.deepEqual(Object.keys(runtimeLock.packages), ["pnpm@10.34.4"]);
  assert.deepEqual(Object.keys(runtimeLock.snapshots), ["pnpm@10.34.4"]);
  assert.equal(runtimeLock.importers["."].dependencies.pnpm.version, "10.34.4");
  assert.doesNotMatch(rootOsvConfig, /GHSA-gj8w-mvpf-x27x/);
  assert.match(
    supplyChain.jobs.osv.with["scan-args"],
    /--config=osv-scanner\.toml[\s\S]*--lockfile=pnpm-lock\.yaml/,
  );
  assert.doesNotMatch(
    supplyChain.jobs.osv.with["scan-args"],
    /vercel-pnpm-runtime/,
  );
  assert.match(
    supplyChain.jobs["osv-pnpm-runtime"].with["scan-args"],
    /--config=scripts\/vercel-pnpm-runtime\/osv-scanner\.toml[\s\S]*--lockfile=scripts\/vercel-pnpm-runtime\/pnpm-lock\.yaml/,
  );
  assert.match(runtimeOsvConfig, /GHSA-gj8w-mvpf-x27x/);
  assert.match(runtimeOsvConfig, /ignoreUntil = 2026-08-16T00:00:00Z/);
  assert.match(
    supplyChain.jobs["lockfile-lint"].steps.at(-1).run,
    /LOCKFILE_LINT_ROOT=scripts\/vercel-pnpm-runtime/,
  );
  const trunkOsvIgnore = trunk.lint.ignore.find(({ linters }) =>
    linters.includes("osv-scanner"),
  );
  assert.deepEqual(trunkOsvIgnore.paths, [
    "pnpm-lock.yaml",
    "scripts/vercel-pnpm-runtime/pnpm-lock.yaml",
  ]);
  assert.equal(pnpmSetup.with.dest, "${{ runner.temp }}/mento-pnpm-tools");
  assert.equal(pnpmSetup.with.standalone, true);
  assert.equal(pnpmSetup.with.version, "10.34.4");
  assert.equal(pnpmSetup.id, "pnpm");
  assert.deepEqual(
    nodeSetup.with["cache-dependency-path"].trim().split(/\s+/),
    [
      "controller/pnpm-lock.yaml",
      "controller/scripts/vercel-pnpm-runtime/pnpm-lock.yaml",
    ],
  );
  assert.equal(
    isolation.env.PNPM_ACTION_DEST,
    "${{ runner.temp }}/mento-pnpm-tools",
  );
  assert.equal(
    isolation.env.PNPM_BIN_DEST,
    "${{ steps.pnpm.outputs.bin_dest }}",
  );
  assert.match(
    isolation.run,
    /if \[ "\$\(realpath "\$PNPM_BIN_DEST"\)" != "\$PNPM_ACTION_DEST\/node_modules\/\.bin\/bin" \]; then/,
  );
  assert.match(
    isolation.run,
    /setup_pnpm_bin="\$\(realpath "\$PNPM_BIN_DEST\/pnpm"\)"/,
  );
  assert.doesNotMatch(isolation.run, /command -v pnpm/);
  assert.match(isolation.run, /NODE_SOURCE_PATH="\$setup_node_bin" \\/);
  assert.match(isolation.run, /PNPM_SOURCE_PATH="\$setup_pnpm_bin" \\/);
  assert.match(
    isolation.run,
    /controller\/scripts\/vercel-prebuilt-workflow\.mjs" \\\n\s+stage-runtime/,
  );
  assert.match(
    isolation.run,
    /controller\/scripts\/vercel-prebuilt-workflow\.mjs" \\\n\s+stage-pnpm-runtime/,
  );
  assert.match(
    isolation.run,
    /"\$pnpm_bootstrap" --dir "\$pnpm_runtime_root" install \\/,
  );
  assert.match(isolation.run, /--ignore-workspace/);
  assert.match(
    isolation.run,
    /printf '%s\\n' "\$trusted_bin_dir" >> "\$GITHUB_PATH"/,
  );
  assert.match(isolation.run, /"\$PNPM_ACTION_DEST" \\/);
  assert.match(isolation.run, /"\$TRUSTED_VERCEL_TOOLS_PATH" \\/);
  assert.match(isolation.run, /"\$trusted_bin_dir" \\/);
  assert.match(isolation.run, /"\$node_bin" \\/);
  assert.match(
    isolation.run,
    /pnpm_bootstrap="\$trusted_bin_dir\/pnpm-bootstrap"/,
  );
  assert.match(
    isolation.run,
    /Protected runtime directory is not cross-identity readable/,
  );
  assert.match(isolation.run, /\[ "\$mode" != "555" \]/);
  assert.match(
    isolation.run,
    /controller\/scripts\/vercel-prebuilt-workflow\.mjs" \\\n\s+stage-pnpm-launcher/,
  );
  assert.match(isolation.run, /"\$pnpm_bootstrap" \\/);
  assert.match(isolation.run, /"\$pnpm_bin"; do/);
  assert.match(install.run, /\/usr\/bin\/setpriv/);
  assert.match(install.run, /NPM_CONFIG_MANAGE_PACKAGE_MANAGER_VERSIONS=false/);
  assert.match(install.run, /NPM_CONFIG_PACKAGE_MANAGER_STRICT_VERSION=false/);
  assert.match(install.run, /"\$pnpm_bin" --version \|/);
  assert.match(install.run, /\/usr\/bin\/grep -Fxq "10\.34\.4"/);
  assert.ok(
    names.indexOf("Set up pinned Node.js and pnpm cache") <
      names.indexOf(
        "Prepare isolated exact-SHA source and protected Vercel CLI",
      ),
  );
  assert.ok(
    names.indexOf(
      "Prepare isolated exact-SHA source and protected Vercel CLI",
    ) < names.indexOf("Install frozen dependencies"),
  );
});

test("main-only controller is restored after every candidate-code phase", () => {
  const pilot = workflow(pilotPath);
  const reusable = workflow(reusablePath);
  const steps = reusable.jobs.prebuilt.steps;
  const names = steps.map(({ name }) => name);
  assert.match(pilot.jobs["deploy-ui-preview"].if, /refs\/heads\/main/);
  const controllerCheckouts = steps.filter(
    ({ uses, with: options }) =>
      uses?.startsWith("actions/checkout@") && options?.path === "controller",
  );
  assert.equal(controllerCheckouts.length, 3);
  for (const checkout of controllerCheckouts) {
    assert.equal(checkout.with.ref, "${{ github.workflow_sha }}");
    assert.equal(checkout.with["persist-credentials"], false);
  }
  const install = steps.find(
    ({ name }) => name === "Install frozen dependencies",
  );
  assert.match(install.run, /--ignore-scripts/);
  assert.ok(
    names.indexOf("Install frozen dependencies") <
      names.indexOf("Restore trusted controller after source installation"),
  );
  assert.ok(
    names.indexOf("Restore trusted controller after source installation") <
      names.indexOf("Verify pinned Vercel prerequisites"),
  );
  const versionCheck = steps.find(
    ({ name }) => name === "Verify pinned Vercel prerequisites",
  );
  assert.match(
    versionCheck.run,
    /controller\/scripts\/vercel-prebuilt\.mjs" check-versions/,
  );
  const contract = steps.find(
    ({ name }) =>
      name === "Validate pilot contract and prepare immutable build identity",
  );
  assert.equal(contract.env.GITHUB_EVENT_REF, "${{ github.ref }}");
  assert.equal(
    contract.env.GITHUB_WORKFLOW_DEFINITION,
    "${{ github.workflow_ref }}",
  );
  assert.ok(
    names.indexOf("Build the UI prebuilt output") <
      names.indexOf("Restore trusted controller after source build"),
  );
  assert.ok(
    names.indexOf("Restore trusted controller after source build") <
      names.indexOf("Assert the UI prebuilt output"),
  );
  assert.ok(
    names.indexOf("Assert the UI prebuilt output") <
      names.indexOf("Upload the verified prebuilt output"),
  );
});

test("monorepo CLI and trusted env validation use their exact roots", () => {
  const reusable = workflow(reusablePath);
  const steps = reusable.jobs.prebuilt.steps;
  const names = steps.map(({ name }) => name);
  const sourceValidation = steps.find(
    ({ name }) =>
      name === "Validate same-repository branch reachability and exact HEAD",
  );
  const prerequisites = steps.find(
    ({ name }) => name === "Verify pinned Vercel prerequisites",
  );
  const environmentValidation = steps.find(
    ({ name }) => name === "Validate runner-owned UI preview build variables",
  );

  assert.equal(
    sourceValidation.env.SOURCE_PATH,
    "${{ github.workspace }}/source",
  );
  assert.equal(prerequisites["working-directory"], "source");
  assert.equal(environmentValidation["working-directory"], undefined);
  assert.equal(
    environmentValidation.env.PULL_STAGING_PATH,
    "${{ runner.temp }}/mento-vercel-pull-staging",
  );
  assert.match(
    environmentValidation.run,
    /--project-directory "\$PULL_STAGING_PATH\/apps\/ui\.mento\.org"/,
  );
  assert.deepEqual(
    steps.filter(({ run }) =>
      run?.includes("scripts/vercel-build-environment.mjs"),
    ),
    [environmentValidation],
  );
  assert.ok(
    names.indexOf("Assert isolated runner-owned Vercel pull result") <
      names.indexOf("Validate runner-owned UI preview build variables"),
  );
  assert.ok(
    names.indexOf("Validate runner-owned UI preview build variables") <
      names.indexOf("Stage trusted UI project settings into candidate source"),
  );
});

test("uncredentialed smoke gates the always-run trusted lifecycle finalizer", () => {
  const reusable = workflow(reusablePath);
  const smoke = reusable.jobs.smoke;
  const finalize = reusable.jobs.finalize;
  assert.equal(smoke.needs, "prebuilt");
  assert.equal(smoke["runs-on"], "ubuntu-latest");
  assert.match(smoke.if, /needs\.prebuilt\.result == 'success'/);
  assert.deepEqual(finalize.needs, ["prebuilt", "smoke"]);
  assert.equal(finalize.if, "always()");
  assert.deepEqual(
    smoke.steps.map(({ name }) => name),
    [
      "Check out trusted smoke controller only",
      "Smoke immutable UI preview without deployment credentials",
      "Set up pinned pnpm for trusted browser smoke",
      "Set up pinned Node.js and trusted pnpm cache",
      "Install trusted browser smoke dependencies",
      "Interact with immutable UI preview in system Chrome",
    ],
  );
  const smokeStep = smoke.steps[1];
  assert.match(smokeStep.run, /vercel-prebuilt-workflow\.mjs" smoke/);
  const install = smoke.steps.find(
    ({ name }) => name === "Install trusted browser smoke dependencies",
  );
  assert.equal(install["working-directory"], "controller");
  assert.equal(install.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD, "1");
  assert.match(install.run, /--frozen-lockfile/);
  assert.match(install.run, /--ignore-scripts/);
  assert.match(install.run, /--filter ui\.mento\.org\.\.\./);
  const smokeCheckout = smoke.steps[0];
  assert.equal(smokeCheckout.with.path, "controller");
  assert.equal(smokeCheckout.with.ref, "${{ github.workflow_sha }}");
  assert.equal(smokeCheckout.with["persist-credentials"], false);
  assert.equal(
    smoke.steps.some((step) => step.with?.path === "source"),
    false,
  );
  const nodeSetup = smoke.steps.find(
    ({ name }) => name === "Set up pinned Node.js and trusted pnpm cache",
  );
  assert.equal(
    nodeSetup.with["cache-dependency-path"],
    "controller/pnpm-lock.yaml",
  );
  const browserSmoke = smoke.steps.find(
    ({ name }) =>
      name === "Interact with immutable UI preview in system Chrome",
  );
  assert.match(
    browserSmoke.run,
    /apps\/ui\.mento\.org\/e2e\/vercel-preview-browser-smoke\.mjs/,
  );
  assert.doesNotMatch(browserSmoke.run, /playwright install/);
  assert.equal(
    browserSmoke.env.DEPLOYMENT_IDEMPOTENCY_KEY,
    "${{ inputs.deployment_idempotency_key }}",
  );
  assert.ok(smoke.steps.indexOf(smokeStep) < smoke.steps.indexOf(browserSmoke));
  assert.doesNotMatch(
    JSON.stringify(smoke),
    /VERCEL_TOKEN|TURBO_TOKEN|TURBO_REMOTE_CACHE_SIGNATURE_KEY|BYPASS|secrets\./i,
  );
  const complete = finalize.steps.find(
    ({ name }) => name === "Post truthful terminal GitHub Deployment state",
  );
  assert.match(complete.run, /github-deployment\.mjs" complete/);
  assert.match(complete.env.VERCEL_DEPLOYMENT_URL, /needs\.smoke\.outputs/);
  assert.match(complete.env.PREBUILT_RESULT, /needs\.prebuilt\.result/);
  assert.match(complete.env.SMOKE_RESULT, /needs\.smoke\.result/);
  assert.match(
    reusable.jobs.prebuilt.outputs.github_deployment_id,
    /steps\.create\.outputs\.github_deployment_id/,
  );
});

test("public deployment URL exists only after smoke-backed success", () => {
  const reusable = workflow(reusablePath);
  assert.equal(
    reusable.on.workflow_call.outputs.deployment_url.value,
    "${{ jobs.finalize.outputs.deployment_url }}",
  );
  assert.equal(
    reusable.jobs.finalize.outputs.deployment_url,
    "${{ steps.complete.outputs.verified_deployment_url }}",
  );
  assert.doesNotMatch(
    reusable.on.workflow_call.outputs.deployment_url.value,
    /jobs\.prebuilt|\|\|/,
  );
  assert.doesNotMatch(
    JSON.stringify(reusable.jobs.prebuilt.outputs),
    /deployment_url.*\|\|/,
  );
});

test("best-effort metrics cannot override verified lifecycle truth", () => {
  const reusable = workflow(reusablePath);
  const steps = reusable.jobs.finalize.steps;
  const total = steps.find(
    ({ name }) => name === "Measure total controller duration (best effort)",
  );
  const complete = steps.find(
    ({ name }) => name === "Post truthful terminal GitHub Deployment state",
  );
  const evidence = steps.find(
    ({ name }) => name === "Record comparison evidence (best effort)",
  );
  assert.equal(total["continue-on-error"], true);
  assert.equal(evidence["continue-on-error"], true);
  assert.equal(Object.hasOwn(complete, "continue-on-error"), false);
  assert.match(
    evidence.if,
    /steps\.complete\.outputs\.github_deployment_state == 'success'/,
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
