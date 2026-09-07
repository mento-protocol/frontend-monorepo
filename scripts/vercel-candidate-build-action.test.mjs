// Structural pins for the shared staged-candidate composite actions.
//
// `.github/actions/vercel-candidate-build` and
// `.github/actions/vercel-protected-runtime` build and upload every production
// candidate for the automatic `Vercel Main Deployment` workflow. These pins
// moved here when the manual production-shadow pilot workflow was retired; the
// invariants they cover belong to the live pipeline, not to the pilot.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parse } from "yaml";

import { PINNED_VERCEL_CLI_VERSION } from "./vercel-cli-runtime-contract.mjs";

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
  const isolatedInstall = action.runs.steps.find(
    (step) =>
      step.name ===
      "Install dependencies without lifecycle scripts or pnpmfile hooks",
  );
  assert.equal(
    isolatedInstall["working-directory"],
    "${{ inputs.working-directory }}",
  );
  for (const name of [
    "GITHUB_ENV",
    "GITHUB_OUTPUT",
    "GITHUB_PATH",
    "GITHUB_STATE",
    "GITHUB_STEP_SUMMARY",
  ]) {
    assert.match(isolatedInstall.run, new RegExp(`-u ${name}`));
  }
  assert.match(isolatedInstall.run, /--ignore-scripts --ignore-pnpmfile/);
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
  assert.equal(
    vercelCliRuntimePackage.dependencies.vercel,
    PINNED_VERCEL_CLI_VERSION,
  );
  assert.ok(
    Object.entries(vercelCliRuntimePackage.dependencies)
      .filter(([name]) => name !== "vercel")
      .every(
        ([name, version]) =>
          name.startsWith("@vercel/") &&
          /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/.test(
            version,
          ),
      ),
  );
  assert.equal(rootPackage.devDependencies.vercel, PINNED_VERCEL_CLI_VERSION);
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
  assert.doesNotMatch(runtimeBlock, /brace-expansion@2\.1\.2\.patch/);
  assert.match(
    runtimeBlock,
    /for immutable_file in "\$\{immutable_files\[@\]\}"/,
  );
  assert.match(runtimeBlock, /stat -c %h "\$immutable_file"\)" != 1/);
  assert.match(runtimeBlock, /stat -c %a "\$immutable_file"\)" != 444/);
  assert.match(runtimeBlock, /stat -c %h "\$installed_file"\)" != 1/);
  assert.match(
    runtimeBlock,
    /"\$\("\$node_bin" "\$vercel_cli" --version\)" = "\$pinned_vercel_version"/,
  );
  assert.match(runtimeBlock, /vercel-cli-runtime\/contract\.json/);
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

test("candidate install and build resolve the same isolated pnpm store", () => {
  const install = candidateAction.runs.steps.find(
    (step) => step.name === "Install frozen dependencies as candidate",
  );
  const build = candidateAction.runs.steps.find(
    (step) => step.name === "Build prebuilt output as candidate",
  );
  assert.ok(install);
  assert.ok(build);

  for (const step of [install, build]) {
    assert.match(step.run, /HOME="\$CANDIDATE_HOME_PATH"/);
    assert.match(step.run, /TMPDIR="\$CANDIDATE_HOME_PATH\/tmp"/);
    assert.match(step.run, /XDG_CACHE_HOME="\$CANDIDATE_HOME_PATH\/cache"/);
    assert.match(step.run, /XDG_CONFIG_HOME="\$CANDIDATE_HOME_PATH\/config"/);
    assert.match(step.run, /XDG_DATA_HOME="\$CANDIDATE_HOME_PATH\/data"/);
  }

  assert.match(
    install.run,
    /"\$PNPM_BIN" --dir "\$CANDIDATE_SOURCE_PATH" install \\\n\s+--frozen-lockfile \\\n\s+--ignore-scripts \\\n\s+2>&1\n/,
  );
  assert.doesNotMatch(
    candidateActionSource,
    /--store-dir|PNPM_HOME|PNPM_STORE/,
  );
  assert.doesNotMatch(
    candidateActionSource,
    /\$CANDIDATE_HOME_PATH\/pnpm-store/,
  );

  const isolation = candidateAction.runs.steps.find(
    (step) => step.name === "Prepare isolated exact-SHA candidate source",
  );
  assert.match(
    isolation.run,
    /"\$CANDIDATE_HOME_PATH\/data" \\\n\s+"\$CANDIDATE_HOME_PATH\/tmp"\n/,
  );
  assert.match(
    isolation.run,
    /"\$CANDIDATE_HOME_PATH\/data" \\\n\s+"\$CANDIDATE_HOME_PATH\/tmp"; do\n/,
  );
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

test("candidate builds are standalone and external references fail before handoff", () => {
  const build = candidateAction.runs.steps.find(
    (step) => step.name === "Build prebuilt output as candidate",
  );
  assert.match(
    build.run,
    /app\|governance\|reserve\|ui\) build_arguments=\(build --yes --standalone --prod --project "\$VERCEL_PROJECT_ID"\)/,
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

test("candidate build action validates inputs and builds without a Vercel token", () => {
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
  assert.match(
    candidateBuild.run,
    optionalShellEnvironmentAssignment("ETHERSCAN_API_KEY"),
  );
  assert.match(
    candidateBuild.run,
    optionalShellEnvironmentAssignment("SENTRY_AUTH_TOKEN"),
  );
  assert.doesNotMatch(candidateActionSource, /VERCEL_TOKEN/);
});

test("every target binds the exact deployment SHA into its runtime and cache", () => {
  for (const target of ["app", "governance", "reserve", "ui"]) {
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
