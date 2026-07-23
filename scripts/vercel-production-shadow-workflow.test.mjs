import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parse } from "yaml";

import { validateVercelBuildCredentialBoundary } from "./vercel-build-environment.mjs";
import {
  buildProductionShadowBuildArguments,
  buildProductionShadowDeployArguments,
  buildProductionShadowPullArguments,
  PRODUCTION_SHADOW_TARGETS,
} from "./vercel-production-shadow.mjs";

const SHA = "0123456789abcdef0123456789abcdef01234567";

const workflowPath = ".github/workflows/vercel-production-shadow.yml";
const workflowSource = readFileSync(
  new URL(`../${workflowPath}`, import.meta.url),
  "utf8",
);
const workflow = parse(workflowSource);

function optionalShellEnvironmentAssignment(name) {
  return new RegExp(`${name}="\\$\\{${name}:-\\}"`);
}
const candidateActionSource = readFileSync(
  new URL(
    "../.github/actions/vercel-candidate-build/action.yml",
    import.meta.url,
  ),
  "utf8",
);
const candidateAction = parse(candidateActionSource);
const protectedRuntimeActionSource = readFileSync(
  new URL(
    "../.github/actions/vercel-protected-runtime/action.yml",
    import.meta.url,
  ),
  "utf8",
);
const protectedRuntimeAction = parse(protectedRuntimeActionSource);
const rootPackage = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const vercelCliRuntimePackage = JSON.parse(
  readFileSync(
    new URL("../scripts/vercel-cli-runtime/package.json", import.meta.url),
    "utf8",
  ),
);

function jobSource(name) {
  const nextJob = /^ {2}[a-z0-9-]+:\n/gm;
  const marker = `  ${name}:\n`;
  const start = workflowSource.indexOf(marker);
  assert.notEqual(start, -1, `missing job ${name}`);
  nextJob.lastIndex = start + marker.length;
  const match = nextJob.exec(workflowSource);
  return workflowSource.slice(start, match?.index ?? workflowSource.length);
}

function allStrings(value, output = []) {
  if (typeof value === "string") output.push(value);
  if (Array.isArray(value)) value.forEach((item) => allStrings(item, output));
  if (value && typeof value === "object") {
    Object.values(value).forEach((item) => allStrings(item, output));
  }
  return output;
}

function stepNamed(jobName, name) {
  const step = workflow.jobs[jobName].steps.find((item) => item.name === name);
  assert.ok(step, `missing ${jobName} step: ${name}`);
  return step;
}

function stepsMatching(jobName, pattern) {
  return workflow.jobs[jobName].steps.filter((step) =>
    pattern.test(step.name ?? ""),
  );
}

test("workflow is manual-only and requires exact deployment identity", () => {
  assert.equal(workflow.name, "Vercel Production Shadow");
  assert.deepEqual(Object.keys(workflow.on), ["workflow_dispatch"]);
  assert.equal(workflow.on.workflow_dispatch.inputs.deploy_sha.required, true);
  assert.equal(
    workflow.on.workflow_dispatch.inputs.app_v3_aliases_json.required,
    true,
  );
  assert.deepEqual(workflow.permissions, { contents: "read" });
  assert.doesNotMatch(workflowSource, /deployments:\s*write/);
  assert.doesNotMatch(workflowSource, /pull_request|deployment_status|push:/);
  assert.equal(
    workflow.jobs.preflight.outputs.deploy_sha,
    "${{ steps.source.outputs.deploy_sha }}",
  );
  assert.equal(
    workflow.jobs.preflight.outputs.started_at_ms,
    "${{ steps.timing.outputs.started_at_ms }}",
  );
  assert.equal(workflow.jobs.preflight.steps[0].id, "timing");
});

test("candidate source cannot replace trusted controllers or runner state", () => {
  for (const name of [
    "preflight",
    "baseline",
    "app",
    "governance",
    "reserve",
    "ui",
  ]) {
    const job = workflow.jobs[name];
    const checkouts = job.steps.filter((step) =>
      step.uses?.startsWith("actions/checkout@"),
    );
    const expectedCheckoutCount = [
      "app",
      "governance",
      "reserve",
      "ui",
    ].includes(name)
      ? 3
      : 2;
    assert.equal(
      checkouts.length,
      expectedCheckoutCount,
      `${name} checkout count`,
    );
    assert.deepEqual(checkouts[0].with, {
      "fetch-depth": 1,
      "persist-credentials": false,
      ref:
        name === "preflight"
          ? "${{ github.workflow_sha }}"
          : "${{ needs.preflight.outputs.deploy_sha }}",
    });
    assert.equal(checkouts[1].with["fetch-depth"], 0);
    assert.equal(checkouts[1].with.path, "source");
    assert.equal(checkouts[1].with["persist-credentials"], false);
    assert.equal(
      checkouts[1].with.ref,
      name === "preflight"
        ? "${{ inputs.deploy_sha }}"
        : "${{ needs.preflight.outputs.deploy_sha }}",
    );
    for (const restored of checkouts.slice(2)) {
      assert.equal(restored.with["fetch-depth"], 1);
      assert.equal(restored.with.path, "trusted-after-build");
      assert.equal(restored.with["persist-credentials"], false);
      assert.equal(
        restored.with.ref,
        "${{ needs.preflight.outputs.deploy_sha }}",
      );
    }

    const validationIndex = job.steps.findIndex((step) =>
      step.run?.includes("vercel-production-shadow.mjs validate-source"),
    );
    const candidateCheckoutIndex = job.steps.indexOf(checkouts[1]);
    assert.ok(validationIndex > candidateCheckoutIndex, `${name} validation`);
    const validation = job.steps[validationIndex].run;
    assert.match(validation, /git -C "\$SOURCE_PATH" fetch/);
    assert.match(
      validation,
      /node scripts\/vercel-production-shadow\.mjs validate-source/,
    );
    assert.equal(
      job.steps[validationIndex].env.GITHUB_WORKFLOW_SHA,
      name === "preflight"
        ? "${{ github.workflow_sha }}"
        : "${{ needs.preflight.outputs.deploy_sha }}",
    );

    for (const [stepIndex, step] of job.steps.entries()) {
      assert.doesNotMatch(
        step.run ?? "",
        /(?:\$SOURCE_PATH|source)\/scripts\//,
      );
      assert.notEqual(step["working-directory"], "source");
      assert.doesNotMatch(step.uses ?? "", /^\.\/source\//);
      const executesCandidate =
        step.uses === "./.github/actions/vercel-candidate-build";
      if (executesCandidate) {
        assert.ok(
          stepIndex > validationIndex,
          `${name} candidate execution must follow validation`,
        );
      }
    }
  }

  const preflight = workflow.jobs.preflight.steps;
  assert.ok(
    preflight.findIndex((step) => step.run?.includes("validate-context")) <
      preflight.findIndex((step) => step.with?.path === "source"),
  );
  for (const name of ["app", "governance", "reserve", "ui"]) {
    const job = workflow.jobs[name];
    const validationIndex = job.steps.findIndex((step) =>
      step.run?.includes("validate-source"),
    );
    const runtimeIndex = job.steps.findIndex(
      (step) => step.uses === "./.github/actions/vercel-protected-runtime",
    );
    const pullIndex = job.steps.findIndex((step) =>
      step.run?.includes("vercel-production-shadow.mjs pull"),
    );
    const installIndex = job.steps.findIndex(
      (step) => step.uses === "./.github/actions/vercel-candidate-build",
    );
    assert.ok(
      validationIndex < runtimeIndex &&
        runtimeIndex < pullIndex &&
        pullIndex < installIndex,
      `${name} validates and pulls runner state before candidate execution`,
    );
    const build = job.steps[installIndex];
    assert.equal(build.id, "build");
    assert.equal(build.with["logical-target"], name);
    assert.equal(
      build.with["candidate-source-path"],
      "${{ steps.runtime.outputs.candidate-source-path }}",
    );
    assert.equal(
      build.with["upload-source-path"],
      "${{ steps.runtime.outputs.upload-source-path }}",
    );
    const restoredAfterBuild = job.steps[installIndex + 1];
    assert.equal(
      restoredAfterBuild.name,
      "Restore trusted controller after candidate build",
    );
    if (name !== "app") {
      assert.equal(restoredAfterBuild.id, "trusted");
    }
    assert.equal(restoredAfterBuild.with.path, "trusted-after-build");
    assert.equal(
      restoredAfterBuild.with.ref,
      "${{ needs.preflight.outputs.deploy_sha }}",
    );
    for (const step of job.steps.slice(installIndex + 1)) {
      assert.doesNotMatch(
        step.run ?? "",
        /node scripts\//,
        `${name} must not reuse the pre-build controller tree`,
      );
    }
  }
  for (const target of ["governance", "reserve", "ui"]) {
    const smoke = workflow.jobs[`smoke-${target}`];
    const checkouts = smoke.steps.filter((step) =>
      step.uses?.startsWith("actions/checkout@"),
    );
    assert.equal(checkouts.length, 1);
    assert.equal(
      checkouts[0].with.ref,
      "${{ needs.preflight.outputs.deploy_sha }}",
    );
    assert.equal(
      smoke.steps.some((step) => step.with?.path === "source"),
      false,
    );
    assert.doesNotMatch(
      jobSource(`smoke-${target}`),
      /source\/node_modules|ln -s/,
    );
    const validation = smoke.steps.find((step) =>
      step.run?.includes("vercel-production-shadow.mjs validate-source"),
    );
    assert.ok(validation, `${target} smoke must revalidate current main`);
    assert.equal(validation.env.SOURCE_PATH, "${{ github.workspace }}");
    assert.match(validation.run, /git fetch --no-tags origin/);
  }
  const finalJob = workflow.jobs["final-alias-comparison"];
  const finalCheckouts = finalJob.steps.filter((step) =>
    step.uses?.startsWith("actions/checkout@"),
  );
  assert.equal(finalCheckouts.length, 1);
  assert.deepEqual(finalCheckouts[0].with, {
    "fetch-depth": 1,
    "persist-credentials": false,
    ref: "${{ needs.preflight.outputs.deploy_sha }}",
  });
  assert.equal(
    finalJob.steps.some((step) => step.with?.path === "source"),
    false,
  );
  assert.equal(
    finalJob.steps.some(
      (step) => step.uses === "./.github/actions/pnpm-install",
    ),
    false,
  );
  const finalValidation = stepNamed(
    "final-alias-comparison",
    "Prove exact final-comparison source",
  );
  assert.equal(finalValidation.id, "source");
  assert.equal(finalValidation.env.SOURCE_PATH, "${{ github.workspace }}");
  assert.match(finalValidation.run, /git fetch --no-tags origin/);
  assert.match(finalValidation.run, /validate-source/);
  const guardedDriftCheck = stepNamed(
    "final-alias-comparison",
    "Fail read-only on final protected alias drift",
  );
  assert.match(guardedDriftCheck.if, /steps\.source\.outcome == 'success'/);
  assert.match(workflowSource, /^env:\n {2}SOURCE_PATH: source$/m);
  assert.match(workflowSource, /TRUSTED_POST_BUILD_PATH: trusted-after-build/);
  assert.doesNotMatch(workflowSource, /node source\//);
});

test("trusted pnpm action installs and caches the fresh smoke tree", () => {
  const action = parse(
    readFileSync(
      new URL("../.github/actions/pnpm-install/action.yml", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(action.inputs["working-directory"].default, ".");
  const setup = action.runs.steps.find((step) =>
    step.uses?.startsWith("actions/setup-node@"),
  );
  assert.equal(
    setup.with["cache-dependency-path"],
    "${{ inputs.working-directory }}/pnpm-lock.yaml",
  );
  const install = action.runs.steps.find((step) =>
    step.run?.includes("pnpm install --frozen-lockfile"),
  );
  assert.equal(install["working-directory"], "${{ inputs.working-directory }}");
  for (const name of [
    "GITHUB_ENV",
    "GITHUB_OUTPUT",
    "GITHUB_PATH",
    "GITHUB_STATE",
    "GITHUB_STEP_SUMMARY",
  ]) {
    assert.match(install.run, new RegExp(`-u ${name}`));
  }
});

test("protected build runtime uses the repository package-manager version", () => {
  const pinnedVersion = rootPackage.packageManager.replace(/^pnpm@/, "");
  assert.doesNotMatch(protectedRuntimeActionSource, /pnpm\/action-setup@/);
  assert.match(
    protectedRuntimeActionSource,
    new RegExp(`pnpm_bootstrap.*--version.*${pinnedVersion}`, "s"),
  );
  assert.match(
    protectedRuntimeActionSource,
    /node_bin="\$TOOLS_PATH\/bin\/node"/,
  );
});

test("protected build runtime installs the exact standalone Vercel CLI without workspace links", () => {
  const runtime = protectedRuntimeAction.runs.steps.find(
    (step) => step.name === "Materialize authenticated protected runtime",
  );
  assert.ok(runtime);
  const runtimeBlock = runtime.run;
  assert.deepEqual(vercelCliRuntimePackage.dependencies, {
    vercel: "56.2.0",
  });
  assert.equal(rootPackage.devDependencies.vercel, "56.2.0");
  assert.deepEqual(
    vercelCliRuntimePackage.pnpm.overrides,
    rootPackage.pnpm.overrides,
  );
  assert.equal(vercelCliRuntimePackage.scripts, undefined);
  assert.doesNotMatch(runtimeBlock, /--filter frontend-monorepo/);
  assert.doesNotMatch(runtimeBlock, /trusted-install-modules-dir/);
  assert.doesNotMatch(
    runtimeBlock,
    /\$TOOLS_PATH\/node_modules\/vercel\/dist\/index\.js/,
  );
  assert.match(runtimeBlock, /stage-vercel-cli-runtime/);
  assert.match(
    runtimeBlock,
    /"\$pnpm_bin" --dir "\$vercel_runtime_root" install \\\n\s+--frozen-lockfile \\\n\s+--ignore-scripts \\\n\s+--ignore-workspace \\\n\s+--package-import-method copy/,
  );
  assert.match(runtimeBlock, /trusted-standalone-vercel-cli-path/);
  assert.match(
    runtimeBlock,
    /\$TOOLS_PATH\/vercel-cli-runtime\/node_modules\/\.pnpm\/.*\/node_modules\/vercel\/dist\/index\.js/,
  );
  assert.match(runtimeBlock, /\$TOOLS_PATH\/vercel-cli-runtime\/package\.json/);
  assert.match(
    runtimeBlock,
    /\$TOOLS_PATH\/vercel-cli-runtime\/pnpm-lock\.yaml/,
  );
  assert.match(runtimeBlock, /stat -c %h "\$immutable_file"\)" != 1/);
  assert.match(runtimeBlock, /stat -c %a "\$immutable_file"\)" != 444/);
  assert.match(runtimeBlock, /stat -c %h "\$installed_file"\)" != 1/);
  assert.match(
    runtimeBlock,
    /"\$\("\$node_bin" "\$vercel_cli" --version\)" = 56\.2\.0/,
  );
  assert.ok(
    runtimeBlock.indexOf("stage-vercel-cli-runtime") <
      runtimeBlock.indexOf('"$pnpm_bin" --dir "$vercel_runtime_root" install'),
  );
  assert.ok(
    runtimeBlock.indexOf('"$pnpm_bin" --dir "$vercel_runtime_root" install') <
      runtimeBlock.indexOf('/usr/bin/find "$TOOLS_PATH" -xdev -type l'),
  );
  assert.doesNotMatch(runtimeBlock, /--lockfile-only|--no-frozen-lockfile/);
});

test("candidate cannot write either standalone Vercel dependency root", () => {
  const isolation = candidateAction.runs.steps.find(
    (step) => step.name === "Prepare isolated exact-SHA candidate source",
  );
  assert.ok(isolation);
  const isolationBlock = isolation.run;
  assert.doesNotMatch(isolationBlock, /"\$TOOLS_PATH\/node_modules"\s*\\/);
  assert.match(
    isolationBlock,
    /"\$TOOLS_PATH\/vercel-cli-runtime\/node_modules"\s*\\/,
  );
  assert.match(
    isolationBlock,
    /"\$TOOLS_PATH\/vercel-cli-runtime\/node_modules\/\.pnpm"\s*\\/,
  );
});

test("each target uses one authenticated run-scoped runtime and always cleans it", () => {
  const expectedRuntimeOutputs = [
    "runtime-root",
    "isolation-root",
    "runtime-marker",
    "tools-path",
    "node-bin",
    "pnpm-bin",
    "vercel-cli",
    "pull-staging-path",
    "build-environment-path",
    "candidate-source-path",
    "provenance-path",
    "candidate-home-path",
    "candidate-identity-marker",
    "build-log-path",
    "upload-source-path",
  ];
  assert.deepEqual(
    Object.keys(protectedRuntimeAction.outputs).sort(),
    expectedRuntimeOutputs.sort(),
  );
  assert.match(
    protectedRuntimeActionSource,
    /\/var\/lib\/mento-vercel-runtime-\$GITHUB_RUN_ID-\$GITHUB_RUN_ATTEMPT-\$LOGICAL_TARGET/,
  );
  assert.doesNotMatch(
    workflowSource,
    /\$\{\{ runner\.temp \}\}\/mento-vercel-production-/,
  );
  assert.doesNotMatch(
    candidateActionSource,
    /\$RUNNER_TEMP\/mento-vercel-production-/,
  );
  assert.doesNotMatch(
    protectedRuntimeActionSource,
    /\$RUNNER_TEMP\/mento-vercel-production-/,
  );

  for (const target of ["app", "governance", "reserve", "ui"]) {
    const steps = workflow.jobs[target].steps;
    const runtimeCalls = steps.filter(
      (step) => step.uses === "./.github/actions/vercel-protected-runtime",
    );
    assert.equal(runtimeCalls.length, 2, `${target} runtime action count`);
    const [prepare, cleanup] = runtimeCalls;
    assert.equal(prepare.id, "runtime");
    assert.deepEqual(prepare.with, {
      operation: "prepare",
      "logical-target": target,
      "controller-path": "${{ github.workspace }}",
      "source-path": "${{ github.workspace }}/source",
    });
    assert.equal(cleanup, steps.at(-1), `${target} cleanup must be job-final`);
    assert.equal(cleanup.if, "${{ always() }}");
    assert.deepEqual(cleanup.with, {
      operation: "cleanup",
      "logical-target": target,
    });

    const targetLabel = target === "ui" ? "UI" : target;
    const preparePull = steps.find(
      (step) =>
        step.name === `Prepare runner-owned ${targetLabel} pull staging`,
    );
    const validatePull = steps.find(
      (step) =>
        step.name === `Validate ${targetLabel} project link and Root Directory`,
    );
    for (const step of [preparePull, validatePull]) {
      assert.equal(
        step.env.VERCEL_ISOLATION_ROOT,
        "${{ steps.runtime.outputs.isolation-root }}",
      );
      assert.equal(
        step.env.PULL_STAGING_PATH,
        "${{ steps.runtime.outputs.pull-staging-path }}",
      );
      assert.equal(
        step.env.SOURCE_PATH,
        "${{ steps.runtime.outputs.pull-staging-path }}",
      );
    }

    const build = steps.find(
      (step) => step.uses === "./.github/actions/vercel-candidate-build",
    );
    for (const name of [
      "runtime-root",
      "isolation-root",
      "runtime-marker",
      "tools-path",
      "build-environment-path",
      "candidate-source-path",
      "candidate-home-path",
      "pull-staging-path",
      "candidate-identity-marker",
      "build-log-path",
      "provenance-path",
      "upload-source-path",
    ]) {
      assert.equal(
        build.with[name],
        `\${{ steps.runtime.outputs.${name} }}`,
        `${target} ${name}`,
      );
    }
    assert.doesNotMatch(
      jobSource(target),
      /\$\{\{ runner\.temp \}\}\/mento-vercel-production-(?:tools|pull-staging|candidate|build-environment|upload-source)/,
    );
  }
});

test("trusted post-candidate commands use only protected runtime Node", () => {
  for (const target of ["app", "governance", "reserve", "ui"]) {
    const steps = workflow.jobs[target].steps;
    const buildIndex = steps.findIndex(
      (step) => step.uses === "./.github/actions/vercel-candidate-build",
    );
    assert.notEqual(buildIndex, -1);
    for (const step of steps.slice(buildIndex + 1)) {
      const run = step.run ?? "";
      if (!run.includes("$TRUSTED_POST_BUILD_PATH/scripts/")) continue;
      assert.match(
        run,
        /\$\{\{ steps\.runtime\.outputs\.node-bin \}\}/,
        `${target} post-candidate command must use protected Node`,
      );
      assert.doesNotMatch(
        run,
        /(?:^|\s)node "\$TRUSTED_POST_BUILD_PATH/,
        `${target} must not fall back to setup-node after candidate execution`,
      );
    }
  }
});

test("protected runtime creation and cleanup authenticate the exact target root", () => {
  const create = protectedRuntimeAction.runs.steps.find(
    (step) => step.name === "Create protected cross-identity runtime root",
  );
  const cleanup = protectedRuntimeAction.runs.steps.find(
    (step) => step.name === "Remove authenticated protected runtime",
  );
  assert.equal(create.if, "${{ inputs.operation == 'prepare' }}");
  assert.equal(cleanup.if, "${{ inputs.operation == 'cleanup' }}");
  for (const step of [create, cleanup]) {
    assert.match(
      step.run,
      /\/var\/lib\/mento-vercel-runtime-\$GITHUB_RUN_ID-\$GITHUB_RUN_ATTEMPT-\$LOGICAL_TARGET/,
    );
    assert.match(
      step.run,
      /GITHUB_RUN_ID:\$GITHUB_RUN_ATTEMPT:\$LOGICAL_TARGET/,
    );
    assert.match(step.run, /for ancestor in \/ \/var \/var\/lib/);
    assert.match(step.run, /stat -c %u/);
    assert.match(step.run, /stat -c %g/);
    assert.match(step.run, /stat -c %a/);
  }
  assert.match(create.run, /-o root -g root -m 0711/);
  assert.match(create.run, /-m 0711[\s\\]+--[\s\\]+"\$ISOLATION_ROOT"/);
  assert.match(create.run, /chmod 0400 "\$RUNTIME_MARKER"/);
  assert.match(create.run, /stat -c %h "\$RUNTIME_MARKER"/);
  assert.match(cleanup.run, /stat -c %h "\$RUNTIME_MARKER"/);
  assert.match(cleanup.run, /failed cleanup authentication/);
  assert.match(cleanup.run, /contains unexpected top-level state/);
  assert.match(cleanup.run, /work root contains unexpected state/);
  assert.match(cleanup.run, /Protected runtime root survived cleanup/);
  assert.doesNotMatch(cleanup.run, /(?:^|\s)node(?:\s|$)/m);
});

test("candidate execution seals command files and rejects hosted tool paths", () => {
  const isolation = candidateAction.runs.steps.find(
    (step) => step.name === "Prepare isolated exact-SHA candidate source",
  );
  const sealIndex = isolation.run.indexOf('/bin/chmod 0700 "$RUNNER_TEMP"');
  const identityIndex = isolation.run.indexOf("/usr/sbin/useradd", sealIndex);
  assert.ok(sealIndex >= 0 && sealIndex < identityIndex);
  assert.match(
    isolation.run,
    /RUNNER_TEMP is not a canonical runner-owned directory/,
  );
  assert.match(isolation.run, /stat -c '%d:%i:%u:%g' "\$RUNNER_TEMP"/);
  assert.match(isolation.run, /stat -c %a "\$RUNNER_TEMP"\)" != 700/);
  assert.match(
    isolation.run,
    /Candidate can traverse protected path: \$RUNNER_TEMP/,
  );
  assert.match(
    isolation.run,
    /\[ "\$NODE_BIN" != "\$TOOLS_PATH\/bin\/node" \]/,
  );
  assert.match(isolation.run, /Candidate runtime must not depend on \/opt/);
  assert.match(
    isolation.run,
    /"\$SOURCE_PATH\/pnpm-lock\.yaml"[\s\\]+"\$PULL_STAGING_PATH"[\s\\]+"\$TOOLS_PATH"/,
  );
  assert.doesNotMatch(
    candidateActionSource,
    /\$RUNNER_TEMP\/mento-vercel-production-/,
  );
});

test("candidate pnpm commands enter an authenticated readable cwd after privilege drop", () => {
  const isolation = candidateAction.runs.steps.find(
    (step) => step.name === "Prepare isolated exact-SHA candidate source",
  );
  const install = candidateAction.runs.steps.find(
    (step) => step.name === "Install frozen dependencies as candidate",
  );
  assert.ok(isolation);
  assert.ok(install);

  const homeCreationIndex = isolation.run.indexOf(
    "sudo --non-interactive /usr/bin/install",
  );
  const probeDefinitionIndex = isolation.run.indexOf("candidate_probe() {");
  assert.ok(
    homeCreationIndex >= 0 && homeCreationIndex < probeDefinitionIndex,
    "candidate home must exist before protected runtime probes",
  );
  assert.match(isolation.run, /for candidate_home_entry in/);
  assert.match(
    isolation.run,
    /sudo --non-interactive \/usr\/bin\/test -d "\$candidate_home_entry"/,
  );
  assert.match(
    isolation.run,
    /stat -c %u "\$candidate_home_entry"\)" != "\$build_uid"/,
  );
  assert.match(
    isolation.run,
    /stat -c %g "\$candidate_home_entry"\)" != "\$build_gid"/,
  );
  assert.match(isolation.run, /stat -c %a "\$candidate_home_entry"\)" != 700/);

  const firstProbeIndex = isolation.run.indexOf(
    'if ! candidate_probe "$NODE_BIN"',
    probeDefinitionIndex,
  );
  assert.ok(
    firstProbeIndex > probeDefinitionIndex,
    "candidate Node probe must remain behind the cwd-pinning wrapper",
  );
  assert.match(isolation.run, /candidate_probe "\$PNPM_BIN" --version/);
  const probeSource = isolation.run.slice(
    probeDefinitionIndex,
    firstProbeIndex,
  );
  const probeSetprivIndex = probeSource.indexOf("/usr/bin/setpriv");
  const probeChdirIndex = probeSource.indexOf(
    '/usr/bin/env --chdir="$CANDIDATE_HOME_PATH" -- "$@"',
  );
  assert.match(probeSource, /HOME="\$CANDIDATE_HOME_PATH"/);
  assert.doesNotMatch(probeSource, /HOME=\/nonexistent/);
  assert.ok(
    probeSetprivIndex >= 0 && probeSetprivIndex < probeChdirIndex,
    "candidate probe must change cwd after dropping privileges",
  );

  const installSetprivIndex = install.run.indexOf("/usr/bin/setpriv");
  const installChdirIndex = install.run.indexOf(
    '/usr/bin/env --chdir="$CANDIDATE_HOME_PATH" --',
  );
  const installPnpmIndex = install.run.indexOf(
    '"$PNPM_BIN" --dir "$CANDIDATE_SOURCE_PATH" install',
  );
  assert.ok(
    installSetprivIndex >= 0 &&
      installSetprivIndex < installChdirIndex &&
      installChdirIndex < installPnpmIndex,
    "candidate install must enter its readable home after dropping privileges",
  );
  assert.doesNotMatch(
    isolation.run,
    /(?:chmod|chown|setfacl)[^\n]*(?:GITHUB_WORKSPACE|CONTROLLER_PATH|SOURCE_PATH)/,
  );
});

test("fresh smoke jobs never reuse candidate dependencies or command files", () => {
  for (const target of ["governance", "reserve", "ui"]) {
    const job = workflow.jobs[`smoke-${target}`];
    const steps = job.steps;
    const installIndex = steps.findIndex(
      (step) => step.uses === "./.github/actions/pnpm-install",
    );
    const chromiumIndex = steps.findIndex((step) =>
      step.run?.includes("playwright install"),
    );
    const smokeIndex = steps.findIndex((step) =>
      step.run?.includes("playwright test"),
    );
    assert.ok(installIndex < chromiumIndex && chromiumIndex < smokeIndex);
    assert.equal(
      steps[0].with.ref,
      "${{ needs.preflight.outputs.deploy_sha }}",
    );
    assert.equal(steps[0].with["persist-credentials"], false);
    assert.doesNotMatch(
      jobSource(`smoke-${target}`),
      /source\/node_modules|ln -s/,
    );
    for (const step of [steps[chromiumIndex], steps[smokeIndex]]) {
      for (const name of [
        "GITHUB_ENV",
        "GITHUB_OUTPUT",
        "GITHUB_PATH",
        "GITHUB_STATE",
        "GITHUB_STEP_SUMMARY",
      ]) {
        assert.match(step.run, new RegExp(`-u ${name}`));
      }
    }
  }
});

test("all credential-bearing jobs use the dedicated non-Deployment environment", () => {
  const credentialJobs = [
    "baseline",
    "app",
    "governance",
    "reserve",
    "ui",
    "final-alias-comparison",
  ];
  const tokenFreeSmokeJobs = ["smoke-governance", "smoke-reserve", "smoke-ui"];
  assert.equal(workflow.jobs.preflight.environment, undefined);
  assert.doesNotMatch(jobSource("preflight"), /secrets\.|vars\./);
  for (const name of credentialJobs) {
    assert.ok(
      workflow.jobs[name].needs.includes("preflight"),
      `${name} must wait for trusted preflight`,
    );
    assert.deepEqual(workflow.jobs[name].environment, {
      name: "vercel-cli-production",
      deployment: false,
    });
    assert.match(jobSource(name), /secrets\./);
  }
  for (const name of tokenFreeSmokeJobs) {
    assert.ok(
      workflow.jobs[name].needs.includes("preflight"),
      `${name} must wait for trusted preflight`,
    );
    assert.equal(workflow.jobs[name].environment, undefined);
    assert.doesNotMatch(jobSource(name), /secrets\./);
  }
  assert.doesNotMatch(workflowSource, /name: Production\b/);
  assert.doesNotMatch(workflowSource, /secrets:\s*inherit/);
  assert.doesNotMatch(workflowSource, /--token\b/);
  assert.doesNotMatch(workflowSource, /githubDeployment/);
  assert.doesNotMatch(workflowSource, /github-deployment|deployments\/\{/i);
});

test("every target build receives the exact-main Git identity tuple", () => {
  const expectedIdentity = {
    VERCEL_GIT_COMMIT_REF: "main",
    VERCEL_GIT_COMMIT_SHA: "${{ needs.preflight.outputs.deploy_sha }}",
    VERCEL_GIT_PROVIDER: "github",
    VERCEL_GIT_REPO_OWNER: "mento-protocol",
    VERCEL_GIT_REPO_SLUG: "frontend-monorepo",
  };
  for (const target of ["app", "governance", "reserve", "ui"]) {
    const build = workflow.jobs[target].steps.find(
      (step) => step.uses === "./.github/actions/vercel-candidate-build",
    );
    assert.ok(build, `missing ${target} candidate build`);
    assert.deepEqual(
      Object.fromEntries(
        Object.keys(expectedIdentity).map((name) => [name, build.env[name]]),
      ),
      expectedIdentity,
    );
  }
});

test("sanitized Vercel build child receives the exact Git identity tuple", () => {
  const build = candidateAction.runs.steps.find(
    (step) => step.name === "Build prebuilt output as candidate",
  );
  assert.ok(build, "missing candidate Vercel build step");
  const cliInvocation =
    '"$NODE_BIN" "$TRUSTED_VERCEL_CLI_PATH" "${build_arguments[@]}"';
  const invocationIndex = build.run.indexOf(cliInvocation);
  assert.notEqual(invocationIndex, -1, "missing pinned Vercel CLI invocation");
  const environmentIndex = build.run.lastIndexOf(
    "sudo --non-interactive /usr/bin/env -i",
    invocationIndex,
  );
  assert.notEqual(
    environmentIndex,
    -1,
    "missing sanitized Vercel CLI environment",
  );
  const child = build.run.slice(
    environmentIndex,
    invocationIndex + cliInvocation.length,
  );
  assert.equal((child.match(/\/usr\/bin\/env -i/g) ?? []).length, 1);
  assert.match(child, /\/usr\/bin\/setpriv/);
  for (const assignment of [
    'VERCEL_GIT_COMMIT_REF="${VERCEL_GIT_COMMIT_REF:-main}"',
    'VERCEL_GIT_COMMIT_SHA="$DEPLOY_SHA"',
    'VERCEL_GIT_PROVIDER="${VERCEL_GIT_PROVIDER:-github}"',
    'VERCEL_GIT_REPO_OWNER="${VERCEL_GIT_REPO_OWNER:-mento-protocol}"',
    'VERCEL_GIT_REPO_SLUG="${VERCEL_GIT_REPO_SLUG:-frontend-monorepo}"',
  ]) {
    assert.ok(
      child.split("\n").some((line) => line.trim() === `${assignment} \\`),
      `sanitized Vercel build child is missing ${assignment.split("=")[0]}`,
    );
  }
});

test("candidate build forces trusted Vercel monorepo support", () => {
  const build = candidateAction.runs.steps.find(
    (step) => step.name === "Build prebuilt output as candidate",
  );
  assert.ok(build, "missing candidate Vercel build step");
  assert.equal(build.env.VERCEL_BUILD_MONOREPO_SUPPORT, "1");
  assert.equal(
    Object.hasOwn(candidateAction.inputs, "vercel-build-monorepo-support"),
    false,
    "candidate callers must not override the trusted constant",
  );

  const cliInvocation =
    '"$NODE_BIN" "$TRUSTED_VERCEL_CLI_PATH" "${build_arguments[@]}"';
  const invocationIndex = build.run.indexOf(cliInvocation);
  assert.notEqual(invocationIndex, -1, "missing pinned Vercel CLI invocation");
  const environmentIndex = build.run.lastIndexOf(
    "sudo --non-interactive /usr/bin/env -i",
    invocationIndex,
  );
  assert.notEqual(
    environmentIndex,
    -1,
    "missing sanitized Vercel CLI environment",
  );
  const child = build.run.slice(
    environmentIndex,
    invocationIndex + cliInvocation.length,
  );
  assert.equal(
    child
      .split("\n")
      .filter(
        (line) =>
          line.trim() ===
          'VERCEL_BUILD_MONOREPO_SUPPORT="$VERCEL_BUILD_MONOREPO_SUPPORT" \\',
      ).length,
    1,
  );
  assert.doesNotMatch(
    child,
    /VERCEL_BUILD_MONOREPO_SUPPORT="\$\{VERCEL_BUILD_MONOREPO_SUPPORT[:-]/,
    "candidate environment must not supply a fallback or override",
  );
});

test("every repo-linked pull validates local and remote project identity before build", () => {
  for (const target of ["app", "governance", "reserve", "ui"]) {
    const targetLabel = target === "ui" ? "UI" : target;
    const validation = stepNamed(
      target,
      `Validate ${targetLabel} project link and Root Directory`,
    );
    const commands = validation.run.split("\n").map((line) => line.trim());
    assert.ok(
      commands.includes(
        '"${{ steps.runtime.outputs.node-bin }}" scripts/vercel-production-shadow.mjs validate-pull-staging',
      ),
      `${target} must validate the exact local repo link`,
    );
    assert.ok(
      commands.includes(
        '"${{ steps.runtime.outputs.node-bin }}" scripts/vercel-deployment-state.mjs project --project-id "$VERCEL_PROJECT_ID" --project-name ' +
          `${target}.mento.org --root-directory apps/${target}.mento.org`,
      ),
      `${target} must validate the literal remote project`,
    );
    assert.equal(
      validation.env.VERCEL_PROJECT_ID,
      `\${{ vars.VERCEL_PROJECT_ID_${target.toUpperCase()} }}`,
    );
    const buildIndex = workflow.jobs[target].steps.findIndex(
      (step) => step.uses === "./.github/actions/vercel-candidate-build",
    );
    assert.ok(
      workflow.jobs[target].steps.indexOf(validation) < buildIndex,
      `${target} project validation must precede candidate execution`,
    );
  }
});

test("ordinary targets use isolated builds, runner-owned handoff, and fresh smoke", () => {
  for (const target of ["governance", "reserve", "ui"]) {
    const source = jobSource(target);
    assert.match(
      source,
      /vercel-production-shadow\.mjs"? prepare-pull-staging/,
    );
    assert.match(source, /vercel-production-shadow\.mjs"? pull/);
    assert.match(
      source,
      /vercel-production-shadow\.mjs"? validate-pull-staging/,
    );
    assert.doesNotMatch(
      source,
      /vercel-production-shadow\.mjs"? assert-output/,
    );
    assert.match(source, /vercel-production-shadow\.mjs"? deploy --expected/);
    assert.match(source, new RegExp(`LOGICAL_TARGET: ${target}`));
    const build = stepNamed(
      target,
      `Build ${target === "ui" ? "UI" : target} production and assert output`,
    );
    assert.equal(build.uses, "./.github/actions/vercel-candidate-build");
    assert.equal(build.with["logical-target"], target);
    assert.equal(
      build.with["expected-root-directory"],
      `apps/${target}.mento.org`,
    );
    assert.equal(
      build.with["candidate-source-path"],
      "${{ steps.runtime.outputs.candidate-source-path }}",
    );
    assert.equal(
      build.with["pull-staging-path"],
      "${{ steps.runtime.outputs.pull-staging-path }}",
    );
    assert.equal(
      build.with["upload-source-path"],
      "${{ steps.runtime.outputs.upload-source-path }}",
    );
    assert.match(source, /vercel-deployment-state\.mjs"? deployment/);
    assert.match(source, /vercel-deployment-state\.mjs"? compare/);
    assert.match(
      source,
      new RegExp(
        `vercel-production-shadow\\.mjs"? assert-generated-aliases --target ${target}`,
      ),
    );
    assert.match(source, /check-versions --repo-root "\$SOURCE_PATH"/);
    assert.doesNotMatch(source, /playwright (?:install|test)/);

    const smokeSource = jobSource(`smoke-${target}`);
    assert.match(smokeSource, /playwright test -c/);
    assert.match(smokeSource, /playwright[\s\S]*install --with-deps chromium/);
    assert.match(smokeSource, /PRODUCTION_SHADOW_EXPECTED_DEPLOYMENT_ID/);
    assert.match(smokeSource, /PRODUCTION_SHADOW_EXPECTED_SHA/);
    assert.equal(workflow.jobs[`smoke-${target}`].needs.includes(target), true);
    const directSmoke = stepNamed(
      `smoke-${target}`,
      `Run direct ${target === "ui" ? "UI" : target} production-shadow smoke`,
    );
    assert.equal(
      directSmoke.env.PRODUCTION_SHADOW_URL,
      `\${{ needs.${target}.outputs.deployment_url }}`,
    );
    assert.equal(
      smokeSource.includes(
        PRODUCTION_SHADOW_TARGETS[target].generatedProjectAlias,
      ),
      false,
      `${target} smoke must use only the immutable deployment URL`,
    );

    const projectId = `prj_${target}123`;
    assert.deepEqual(
      buildProductionShadowPullArguments({ logicalTarget: target, projectId }),
      ["pull", "--yes", "--environment", "production", "--project", projectId],
    );
    assert.deepEqual(
      buildProductionShadowBuildArguments({ logicalTarget: target, projectId }),
      ["build", "--yes", "--standalone", "--prod", "--project", projectId],
    );
    assert.deepEqual(
      buildProductionShadowDeployArguments({
        logicalTarget: target,
        projectId,
        deploySha: SHA,
        transaction: `123-1-${target}`,
      }).slice(0, 9),
      [
        "deploy",
        "--prebuilt",
        "--prod",
        "--skip-domain",
        "--archive=tgz",
        "--format=json",
        "--yes",
        "--project",
        projectId,
      ],
    );
  }
  assert.doesNotMatch(workflowSource, /vercel promote|vercel rollback/);
  assert.deepEqual(workflow.jobs.governance.needs, ["preflight", "baseline"]);
  assert.deepEqual(workflow.jobs.reserve.needs, [
    "preflight",
    "baseline",
    "governance",
    "smoke-governance",
  ]);
  assert.deepEqual(workflow.jobs.ui.needs, [
    "preflight",
    "baseline",
    "governance",
    "reserve",
    "smoke-reserve",
  ]);
});

test("ordinary uploads stop forward mutation after any prior drift failure", () => {
  const sequence = ["governance", "reserve", "ui"];
  for (const [index, target] of sequence.entries()) {
    const steps = workflow.jobs[target].steps;
    const targetLabel = target === "ui" ? "UI" : target;
    const upload = stepNamed(
      target,
      `Upload unchanged ${targetLabel} output without custom production domains`,
    );
    const drift = stepNamed(
      target,
      `Fail read-only on protected alias drift after ${targetLabel} deploy`,
    );
    const proof = stepNamed(
      target,
      "Prove every protected mapping remains unchanged",
    );
    assert.ok(steps.indexOf(upload) < steps.indexOf(drift));
    assert.ok(steps.indexOf(drift) < steps.indexOf(proof));
    assert.equal(
      drift.if,
      "${{ always() && steps.build.outcome == 'success' && steps.trusted.outcome == 'success' }}",
    );
    assert.match(drift.run, /vercel-production-shadow\.mjs" check-aliases/);
    assert.match(proof.run, /vercel-deployment-state\.mjs" compare/);
    assert.equal(workflow.jobs[target].if, undefined);

    if (index === 0) continue;
    const prior = sequence[index - 1];
    assert.ok(workflow.jobs[target].needs.includes(prior));
    assert.ok(workflow.jobs[target].needs.includes(`smoke-${prior}`));
  }
});

test("app Outcome B has no reachable deploy or production command", () => {
  const source = jobSource("app");
  assert.match(source, /vercel-production-shadow\.mjs"? prepare-pull-staging/);
  assert.match(source, /vercel-production-shadow\.mjs"? pull/);
  assert.doesNotMatch(source, /vercel-production-shadow\.mjs"? assert-output/);
  const build = stepNamed("app", "Build app custom v3 and assert output");
  assert.equal(build.uses, "./.github/actions/vercel-candidate-build");
  assert.equal(build.with["logical-target"], "app");
  assert.equal(build.with["expected-root-directory"], "apps/app.mento.org");
  assert.equal(
    build.with["upload-source-path"],
    "${{ steps.runtime.outputs.upload-source-path }}",
  );
  assert.match(source, /NEXT_PUBLIC_VERCEL_ENV: preview/);
  assert.match(source, /VERCEL_ENV: preview/);
  assert.match(source, /VERCEL_TARGET_ENV: v3/);
  assert.doesNotMatch(source, /SENTRY_AUTH_TOKEN:/);
  assert.match(
    candidateActionSource,
    /SENTRY_AUTH_TOKEN="\$\{SENTRY_AUTH_TOKEN:-\}"/,
  );
  assert.match(source, /app-proof/);
  assert.doesNotMatch(
    source,
    /vercel-production-shadow\.mjs"? deploy|--prod|--skip-domain|promote|alias set/,
  );
  assert.deepEqual(
    buildProductionShadowPullArguments({
      logicalTarget: "app",
      projectId: "prj_app123",
    }),
    ["pull", "--yes", "--environment", "v3", "--project", "prj_app123"],
  );
  assert.deepEqual(
    buildProductionShadowBuildArguments({
      logicalTarget: "app",
      projectId: "prj_app123",
    }),
    [
      "build",
      "--yes",
      "--standalone",
      "--target",
      "v3",
      "--project",
      "prj_app123",
    ],
  );
  assert.throws(() =>
    buildProductionShadowDeployArguments({
      logicalTarget: "app",
      projectId: "prj_app123",
      deploySha: SHA,
      transaction: "123-1-app",
    }),
  );
});

test("candidate builds are standalone and external references fail before handoff", () => {
  const build = candidateAction.runs.steps.find(
    (step) => step.name === "Build prebuilt output as candidate",
  );
  assert.match(
    build.run,
    /app\) build_arguments=\(build --yes --standalone --target v3 --project "\$VERCEL_PROJECT_ID"\)/,
  );
  assert.match(
    build.run,
    /governance\|reserve\|ui\) build_arguments=\(build --yes --standalone --prod --project "\$VERCEL_PROJECT_ID"\)/,
  );
  assert.ok(
    build.run.indexOf("validate-candidate-pull") <
      build.run.indexOf("build_arguments="),
  );

  const stagingIndex = candidateAction.runs.steps.findIndex(
    (step) => step.name === "Stage validated runner-owned Vercel settings",
  );
  const buildIndex = candidateAction.runs.steps.findIndex(
    (step) => step.name === "Build prebuilt output as candidate",
  );
  assert.ok(stagingIndex >= 0);
  assert.ok(stagingIndex < buildIndex);
  assert.match(candidateAction.runs.steps[stagingIndex].run, /stage-pull/);
  assert.match(
    candidateAction.runs.steps[stagingIndex].run,
    /pgrep -u "\$BUILD_UID"/,
  );

  const candidateValidationIndex = candidateAction.runs.steps.findIndex(
    (step) => step.name === "Validate candidate-owned prebuilt output",
  );
  const handoffIndex = candidateAction.runs.steps.findIndex(
    (step) => step.name === "Create immutable runner-owned output handoff",
  );
  const uploadValidationIndex = candidateAction.runs.steps.findIndex(
    (step) => step.name === "Assert immutable runner-owned upload handoff",
  );
  assert.ok(candidateValidationIndex >= 0);
  assert.ok(candidateValidationIndex < handoffIndex);
  assert.ok(handoffIndex < uploadValidationIndex);
  assert.match(
    candidateAction.runs.steps[candidateValidationIndex].run,
    /vercel-production-shadow\.mjs" assert-output/,
  );
  assert.match(
    candidateAction.runs.steps[handoffIndex].run,
    /vercel-production-shadow\.mjs"[\s\\]+create-handoff/,
  );
  assert.match(
    candidateAction.runs.steps[uploadValidationIndex].run,
    /vercel-production-shadow\.mjs" assert-output/,
  );
  const cleanup = candidateAction.runs.steps.find(
    (step) => step.name === "Remove candidate execution boundary",
  );
  assert.match(cleanup.run, /mento-vercel-production-build-environment/);
  assert.match(cleanup.run, /"\$BUILD_ENVIRONMENT_PATH"/);
  assert.match(cleanup.run, /"\$PROVENANCE_PATH"/);
  assert.match(
    cleanup.run,
    /upload_provenance_path="\$UPLOAD_SOURCE_PATH\.provenance\.json"/,
  );
  assert.match(cleanup.run, /"\$upload_provenance_path"/);
  assert.doesNotMatch(cleanup.run, /rm[\s\S]{0,300}"\$TOOLS_PATH"/);
  assert.doesNotMatch(cleanup.run, /rm[\s\S]{0,300}"\$UPLOAD_SOURCE_PATH"/);
});

test("build-variable scopes preserve production Sentry behavior", () => {
  const expectedBuildSecrets = {
    app: {},
    governance: {
      ETHERSCAN_API_KEY: "${{ secrets.ETHERSCAN_API_KEY }}",
      SENTRY_AUTH_TOKEN: "${{ secrets.SENTRY_AUTH_TOKEN }}",
    },
    reserve: {
      SENTRY_AUTH_TOKEN: "${{ secrets.SENTRY_AUTH_TOKEN }}",
    },
    ui: {},
  };
  for (const [target, expected] of Object.entries(expectedBuildSecrets)) {
    const buildSteps = stepsMatching(target, /^Build .+ and assert output$/);
    assert.equal(buildSteps.length, 1);
    const [build] = buildSteps;
    assert.equal(build.env.VERCEL_TOKEN, undefined);
    assert.equal(build.env.TURBO_TEAM, "${{ vars.TURBO_TEAM }}");
    assert.equal(build.env.TURBO_TOKEN, "${{ secrets.TURBO_TOKEN }}");
    assert.equal(
      build.env.TURBO_REMOTE_CACHE_SIGNATURE_KEY,
      "${{ secrets.TURBO_REMOTE_CACHE_SIGNATURE_KEY }}",
    );
    assert.equal(build.env.VERCEL_AUTOMATION_BYPASS_SECRET, undefined);
    for (const key of ["SENTRY_AUTH_TOKEN", "ETHERSCAN_API_KEY"]) {
      assert.equal(build.env[key], expected[key]);
      for (const step of workflow.jobs[target].steps) {
        if (step === build) continue;
        assert.notEqual(
          step.env?.[key],
          `\${{ secrets.${key} }}`,
          `${target} ${key} must exist only in its literal build step`,
        );
      }
    }
    assert.equal(build.uses, "./.github/actions/vercel-candidate-build");
    if (target === "app") {
      assert.doesNotThrow(() =>
        validateVercelBuildCredentialBoundary({
          target: "app",
          environment: "v3",
          pulledValues: {},
          explicitValues: build.env,
        }),
      );
    }
  }
  const validation = candidateAction.runs.steps.find(
    (step) => step.name === "Validate runner-owned build inputs",
  );
  assert.match(
    validation.run,
    /vercel-production-shadow\.mjs"[\s\\]+check-build-inputs/,
  );
  assert.match(validation.run, /vercel-build-environment\.mjs/);
  assert.match(
    validation.run,
    /"\$PULL_STAGING_PATH\/\$EXPECTED_ROOT_DIRECTORY"/,
  );
  const install = candidateAction.runs.steps.find(
    (step) => step.name === "Install frozen dependencies as candidate",
  );
  assert.match(install.run, /\/usr\/bin\/env -i/);
  assert.match(
    install.run,
    /"\$PNPM_BIN" --dir "\$CANDIDATE_SOURCE_PATH" install/,
  );
  assert.match(install.run, /--ignore-scripts/);
  const candidateBuild = candidateAction.runs.steps.find(
    (step) => step.name === "Build prebuilt output as candidate",
  );
  assert.match(candidateBuild.run, /\/usr\/bin\/env -i/);
  assert.match(
    candidateBuild.run,
    /SENTRY_AUTH_TOKEN="\$\{SENTRY_AUTH_TOKEN:-\}"/,
  );
  assert.match(
    candidateBuild.run,
    /"\$NODE_BIN" "\$TRUSTED_VERCEL_CLI_PATH" "\$\{build_arguments\[@\]\}"/,
  );
  assert.match(candidateBuild.run, /\/usr\/bin\/tee "\$BUILD_LOG_PATH"/);
  assert.match(candidateBuild.run, /PIPESTATUS/);
  assert.match(candidateBuild.run, /cache-summary --input "\$BUILD_LOG_PATH"/);
  assert.equal(
    candidateAction.outputs.turbo_cache_hits.value,
    "${{ steps.build.outputs.turbo_cache_hits }}",
  );
  assert.equal(
    candidateAction.outputs.turbo_cache_misses.value,
    "${{ steps.build.outputs.turbo_cache_misses }}",
  );
  for (const target of ["app", "governance", "reserve", "ui"]) {
    assert.equal(
      workflow.jobs[target].outputs.turbo_cache_hits,
      "${{ steps.build.outputs.turbo_cache_hits }}",
    );
    assert.equal(
      workflow.jobs[target].outputs.turbo_cache_misses,
      "${{ steps.build.outputs.turbo_cache_misses }}",
    );
  }
  assert.match(
    candidateBuild.run,
    optionalShellEnvironmentAssignment("ETHERSCAN_API_KEY"),
  );
  assert.match(
    candidateBuild.run,
    optionalShellEnvironmentAssignment("SENTRY_AUTH_TOKEN"),
  );
  assert.doesNotMatch(candidateActionSource, /VERCEL_TOKEN/);
  assert.equal(
    (workflowSource.match(/secrets\.SENTRY_AUTH_TOKEN/g) ?? []).length,
    2,
  );
  assert.equal(
    (workflowSource.match(/secrets\.ETHERSCAN_API_KEY/g) ?? []).length,
    1,
  );
});

test("artifacts contain only failure-safe browser diagnostics", () => {
  const uploadSteps = Object.values(workflow.jobs)
    .flatMap((job) => job.steps ?? [])
    .filter((step) => step.uses?.startsWith("actions/upload-artifact@"));
  assert.equal(uploadSteps.length, 3);
  for (const step of uploadSteps) {
    assert.equal(step.if, "failure()");
    assert.equal(step.with.path, "apps/app.mento.org/test-results/");
    assert.equal(step.with["retention-days"], 7);
    assert.doesNotMatch(step.with.path, /\.vercel|\.env/);
  }
  assert.doesNotMatch(
    workflowSource,
    /upload-artifact[\s\S]{0,500}\.vercel\/output/,
  );
});

test("post-candidate evidence files fail closed on preexisting paths", () => {
  for (const name of [
    "app",
    "governance",
    "reserve",
    "ui",
    "final-alias-comparison",
  ]) {
    for (const step of workflow.jobs[name].steps) {
      if ((step.run ?? "").includes("printf ")) {
        assert.match(step.run, /set -o noclobber/);
      }
    }
  }
  for (const path of [
    "../scripts/vercel-production-shadow.mjs",
    "../scripts/vercel-deployment-state.mjs",
  ]) {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    assert.match(source, /constants\.O_EXCL/);
    assert.match(source, /constants\.O_NOFOLLOW/);
  }
});

test("every deploy is immediately checked for drift without automatic repair", () => {
  for (const target of ["governance", "reserve", "ui"]) {
    const steps = workflow.jobs[target].steps;
    const deployIndex = steps.findIndex((step) => step.id === "deploy");
    assert.notEqual(deployIndex, -1);
    const check = steps[deployIndex + 1];
    assert.equal(
      check.name,
      `Fail read-only on protected alias drift after ${target === "ui" ? "UI" : target} deploy`,
    );
    assert.equal(
      check.if,
      "${{ always() && steps.build.outcome == 'success' && steps.trusted.outcome == 'success' }}",
    );
    assert.match(check.run, /check-aliases/);
    assert.doesNotMatch(
      check.run,
      /--baseline|--target|--deployment-id|printf/,
    );
    assert.equal(
      check.env.VERCEL_TOKEN,
      "${{ secrets.VERCEL_TOKEN_PRODUCTION }}",
    );
    const compareIndex = steps.findIndex(
      (step) => step.name === "Prove every protected mapping remains unchanged",
    );
    const stateIndex = steps.findIndex(
      (step) =>
        step.name?.startsWith("Verify ") &&
        step.name.endsWith(
          " deployment provenance, readiness, and generated aliases",
        ),
    );
    assert.ok(deployIndex < deployIndex + 1);
    assert.ok(deployIndex + 1 < compareIndex);
    assert.ok(compareIndex < stateIndex);
    assert.equal(
      steps.some((step) => step.run?.includes("playwright")),
      false,
    );

    const smokeSteps = workflow.jobs[`smoke-${target}`].steps;
    const chromiumIndex = smokeSteps.findIndex((step) =>
      step.run?.includes("playwright install"),
    );
    const smokeIndex = smokeSteps.findIndex((step) =>
      step.run?.includes("playwright test"),
    );
    assert.ok(chromiumIndex < smokeIndex);
  }

  const finalCheck = stepNamed(
    "final-alias-comparison",
    "Fail read-only on final protected alias drift",
  );
  const finalTrustedCheckout = workflow.jobs[
    "final-alias-comparison"
  ].steps.find(({ name }) => name === "Check out trusted workflow controller");
  assert.equal(finalTrustedCheckout.id, "trusted");
  assert.ok(finalTrustedCheckout.uses.startsWith("actions/checkout@"));
  assert.equal(
    finalCheck.if,
    "${{ always() && steps.trusted.outcome == 'success' && steps.source.outcome == 'success' }}",
  );
  assert.match(finalCheck.run, /check-aliases/);
  assert.doesNotMatch(finalCheck.run, /--baseline|--target|printf/);
  assert.deepEqual(Object.keys(finalCheck.env).sort(), [
    "BASELINE_JSON",
    "VERCEL_ORG_ID",
    "VERCEL_TOKEN",
  ]);
  const helperSource = readFileSync(
    new URL("../scripts/vercel-production-shadow.mjs", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(helperSource, /guardProtectedAliases/);
  assert.doesNotMatch(helperSource, /environmentForProtectedAliasRepair/);
  assert.doesNotMatch(helperSource, /\["exec", "vercel", "alias"/);
  assert.doesNotMatch(workflowSource, /vercel-production-shadow\.mjs restore/);
  assert.doesNotMatch(workflowSource, /vercel alias set/);
  assert.doesNotMatch(workflowSource, /guard-aliases|promote|rollback/);
});

test("stable final status job fails closed over literal dependencies", () => {
  const job = workflow.jobs.result;
  assert.equal(job.name, "Vercel Production Shadow");
  assert.equal(job.if, "${{ always() }}");
  assert.deepEqual(job.needs, [
    "preflight",
    "baseline",
    "app",
    "governance",
    "smoke-governance",
    "reserve",
    "smoke-reserve",
    "ui",
    "smoke-ui",
    "final-alias-comparison",
  ]);
  const source = jobSource("result");
  assert.match(source, /if \[\[ "\$result" != "success" \]\]/);
});

test("fresh smoke jobs resolve the Playwright config from the filtered workspace", () => {
  for (const target of ["governance", "reserve", "ui"]) {
    const smoke = workflow.jobs[`smoke-${target}`].steps.find((step) =>
      step.name?.startsWith("Run direct "),
    );
    assert.ok(smoke, `${target} smoke step must exist`);
    assert.match(
      smoke.run,
      /pnpm --filter app\.mento\.org exec playwright test -c playwright\.production-shadow\.config\.ts/,
    );
    assert.doesNotMatch(
      smoke.run,
      /-c apps\/app\.mento\.org\/playwright\.production-shadow\.config\.ts/,
    );
  }
});

test("all external action references remain immutable full SHA pins", () => {
  for (const value of allStrings(workflow)) {
    if (!value.includes("@") || value.startsWith("./")) continue;
    const [action, pin] = value.split("@");
    if (!action.includes("/")) continue;
    assert.match(pin, /^[a-f0-9]{40}$/i, value);
  }
});

test("shadow smoke strips protection headers and disables traces", () => {
  const config = readFileSync(
    new URL(
      "../apps/app.mento.org/playwright.production-shadow.config.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const spec = readFileSync(
    new URL(
      "../apps/app.mento.org/e2e/production-shadow/smoke.spec.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const requestPolicy = readFileSync(
    new URL(
      "../apps/app.mento.org/e2e/production-shadow/request-policy.mjs",
      import.meta.url,
    ),
    "utf8",
  );
  const redirectRegression = readFileSync(
    new URL(
      "../apps/app.mento.org/production-shadow-routing.test.mjs",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(config, /trace: "off"/);
  assert.match(config, /serviceWorkers: "block"/);
  assert.doesNotMatch(config, /extraHTTPHeaders/);
  assert.match(spec, /page\.route\("\*\*\/\*"/);
  assert.match(spec, /fulfillProductionShadowRequest/);
  assert.doesNotMatch(spec, /route\.continue/);
  assert.match(spec, /assertProductionShadowOrigin/);
  assert.match(spec, /framenavigated/);
  assert.match(spec, /frame !== page\.mainFrame\(\)/);
  assert.match(spec, /errors\.origins/);
  assert.match(spec, /X-Frame-Options|x-frame-options/);
  assert.match(spec, /content-security-policy-report-only/);
  assert.match(spec, /requestfailed/);
  assert.match(spec, /page\.on\("response"/);
  assert.match(spec, /response\.status\(\) >= 400/);
  assert.doesNotMatch(
    spec,
    /new URL\((?:request|response)\.url\(\)\)\.origin === origin/,
  );
  assert.doesNotMatch(spec, /startsWith\(origin\)/);
  assert.match(spec, /pageerror/);
  assert.match(spec, /message\.type\(\) === "error"/);
  assert.match(spec, /PRODUCTION_SHADOW_EXPECTED_DEPLOYMENT_ID/);
  assert.match(spec, /PRODUCTION_SHADOW_EXPECTED_SHA|expectedSha/);
  assert.match(workflowSource, /PRODUCTION_SHADOW_EXPECTED_SHA/);
  assert.match(spec, /x-mento-deployment-sha/);
  assert.match(spec, /data-dpl-id/);
  assert.match(spec, /My Voting Power/);
  assert.match(spec, /Supply/);
  assert.match(spec, /Search components/);
  assert.match(requestPolicy, /name\.toLowerCase\(\)/);
  assert.match(requestPolicy, /forbidden protection header/);
  assert.doesNotMatch(requestPolicy, /bypassSecret|fixture-bypass/);
  assert.match(requestPolicy, /route\.fetch/);
  assert.match(requestPolicy, /maxRedirects: 0/);
  assert.match(requestPolicy, /route\.fulfill/);
  assert.match(redirectRegression, /createServer/);
  assert.match(redirectRegression, /chromium\.launch/);
  assert.match(redirectRegression, /received\.source, \[undefined\]/);
  assert.match(redirectRegression, /received\.destination, \[undefined\]/);
  for (const target of ["governance", "reserve", "ui"]) {
    const nextConfig = readFileSync(
      new URL(`../apps/${target}.mento.org/next.config.ts`, import.meta.url),
      "utf8",
    );
    const turbo = JSON.parse(
      readFileSync(
        new URL(`../apps/${target}.mento.org/turbo.json`, import.meta.url),
        "utf8",
      ),
    );
    assert.match(nextConfig, /X-Mento-Deployment-Sha/);
    assert.match(nextConfig, /VERCEL_GIT_COMMIT_SHA/);
    assert.ok(
      turbo.tasks.build.env.includes("VERCEL_GIT_COMMIT_SHA"),
      `${target} build cache identity`,
    );
  }
});
