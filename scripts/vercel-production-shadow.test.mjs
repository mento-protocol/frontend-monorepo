import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  assertEvidenceFiles,
  assertCandidateProductionShadowPull,
  assertFinalJobResults,
  assertMaterializedProductionShadowBuildEnvironment,
  assertProtectedIsolationChild,
  assertProductionShadowBuildInputs,
  assertProductionShadowOutput,
  assertProductionShadowPullStaging,
  assertProductionShadowReadyForUpload,
  assertProtectedAliasesUnchanged,
  assertPulledProductionShadowProject,
  assertRequiredVariableNames,
  assertUnaliasedProductionShadowDeployment,
  assignProductionShadowMaterializationOwnership,
  buildProductionShadowArtifact,
  buildProductionShadowBuildArguments,
  buildProductionShadowDeployArguments,
  buildProductionShadowPullArguments,
  createAppBuildOnlyProof,
  createDeploymentExpectation,
  createProtectedAliasSpec,
  createProductionShadowUploadHandoff,
  environmentForTrustedChild,
  environmentForVercelCli,
  fetchWithOriginBoundRedirects,
  materializeExactGitTree,
  materializeProductionShadowLink,
  parseTurboCacheSummary,
  parseDeployOutput,
  prepareProductionShadowPullStaging,
  PRODUCTION_SHADOW_TARGETS,
  pullProductionShadowProject,
  REQUIRED_BUILD_CACHE_VARIABLE_NAMES,
  runProductionShadowVercel,
  stageProductionShadowPullForCandidate,
  validateDispatchContext,
  validateImmutableMainSource,
  waitForHealthyUrls,
  writePilotSummary,
} from "./vercel-production-shadow.mjs";
import {
  getVercelBuildRequirements,
  parseVercelPulledEnvironment,
  serializeVercelPulledEnvironment,
} from "./vercel-build-environment.mjs";
import {
  assertProductionShadowOrigin,
  productionShadowRequestHeaders,
} from "../apps/app.mento.org/e2e/production-shadow/request-policy.mjs";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const productionShadowScript = fileURLToPath(
  new URL("./vercel-production-shadow.mjs", import.meta.url),
);

function projectIds() {
  return {
    app: "prj_app123",
    governance: "prj_governance123",
    reserve: "prj_reserve123",
    ui: "prj_ui123",
  };
}

function defaultPulledEnvironment(logicalTarget) {
  const environment = PRODUCTION_SHADOW_TARGETS[logicalTarget].pullEnvironment;
  return Object.fromEntries(
    getVercelBuildRequirements(logicalTarget, environment)
      .filter((requirement) => requirement.ciClassification === "vercel-pull")
      .map((requirement) => [
        requirement.name,
        requirement.allowEmpty
          ? ""
          : requirement.name.includes("URL")
            ? `https://${requirement.name.toLowerCase().replaceAll("_", "-")}.example`
            : `fixture-${requirement.name.toLowerCase()}`,
      ]),
  );
}

test("materialized environment ownership is assigned to the runner identity", () => {
  const calls = [];
  assignProductionShadowMaterializationOwnership({
    materializationRoot: "/runner/temp/materialized",
    environmentPath: "/runner/temp/materialized/.vercel/.env.production.local",
    expectedUid: 1_234,
    expectedGid: 5_678,
    changeOwner: (path, uid, gid) => calls.push({ path, uid, gid }),
  });
  assert.deepEqual(calls, [
    { path: "/runner/temp/materialized", uid: 1_234, gid: 5_678 },
    {
      path: "/runner/temp/materialized/.vercel",
      uid: 1_234,
      gid: 5_678,
    },
    {
      path: "/runner/temp/materialized/.vercel/.env.production.local",
      uid: 1_234,
      gid: 5_678,
    },
  ]);
});

test("protected isolation paths require one canonical, owned direct child", () => {
  const container = realpathSync(
    mkdtempSync(join(tmpdir(), "shadow-isolation-contract-")),
  );
  const isolationRoot = join(container, "work");
  const expectedName = "mento-vercel-production-pull-staging";
  const expectedPath = join(isolationRoot, expectedName);
  const uid = process.getuid();
  const gid = process.getgid();
  try {
    mkdirSync(isolationRoot, { mode: 0o711 });
    chmodSync(isolationRoot, 0o711);
    assert.equal(
      assertProtectedIsolationChild({
        isolationRoot,
        path: expectedPath,
        expectedName,
      }),
      expectedPath,
    );

    for (const path of [
      join(container, expectedName),
      join(isolationRoot, "nested", expectedName),
      `${isolationRoot}/nested/../${expectedName}`,
      join(isolationRoot, "wrong-name"),
    ]) {
      assert.throws(
        () =>
          assertProtectedIsolationChild({
            isolationRoot,
            path,
            expectedName,
          }),
        /direct child/,
      );
    }
    assert.throws(
      () =>
        assertProtectedIsolationChild({
          isolationRoot: `${isolationRoot}/.`,
          path: expectedPath,
          expectedName,
        }),
      /lexically canonical/,
    );
    assert.throws(
      () =>
        assertProtectedIsolationChild({
          isolationRoot,
          path: expectedPath,
          expectedName,
          expectedUid: uid + 1,
        }),
      /not protected/,
    );
    assert.throws(
      () =>
        assertProtectedIsolationChild({
          isolationRoot,
          path: expectedPath,
          expectedName,
          expectedGid: gid + 1,
        }),
      /not protected/,
    );
    chmodSync(isolationRoot, 0o700);
    assert.throws(
      () =>
        assertProtectedIsolationChild({
          isolationRoot,
          path: expectedPath,
          expectedName,
        }),
      /not protected/,
    );
    chmodSync(isolationRoot, 0o711);

    const external = join(container, "external");
    mkdirSync(external, { mode: 0o700 });
    symlinkSync(external, expectedPath);
    assert.throws(
      () =>
        assertProtectedIsolationChild({
          isolationRoot,
          path: expectedPath,
          expectedName,
        }),
      /symbolic link/,
    );
    rmSync(expectedPath);

    const linkedRoot = join(container, "linked-work");
    symlinkSync(isolationRoot, linkedRoot);
    assert.throws(
      () =>
        assertProtectedIsolationChild({
          isolationRoot: linkedRoot,
          path: join(linkedRoot, expectedName),
          expectedName,
        }),
      /not protected/,
    );
  } finally {
    rmSync(container, { recursive: true, force: true });
  }
});

test("build-boundary CLI commands use the protected isolation root", () => {
  const script = readFileSync(productionShadowScript, "utf8");
  assert.equal(
    script.match(/isolationRoot:\s*process\.env\.VERCEL_ISOLATION_ROOT/g)
      ?.length,
    6,
  );
  assert.doesNotMatch(
    script,
    /(?:runnerTemp|isolationRoot):\s*process\.env\.RUNNER_TEMP/,
  );
});

test("dispatch context accepts only canonical main and immutable SHA", () => {
  const input = {
    repository: "mento-protocol/frontend-monorepo",
    ref: "refs/heads/main",
    workflowRef:
      "mento-protocol/frontend-monorepo/.github/workflows/vercel-production-shadow.yml@refs/heads/main",
    deploySha: SHA.toUpperCase(),
  };
  assert.equal(validateDispatchContext(input), SHA);
  for (const override of [
    { repository: "fork/frontend-monorepo" },
    { ref: "refs/heads/feature" },
    { workflowRef: input.workflowRef.replace("main", "feature") },
    { deploySha: "main" },
  ]) {
    assert.throws(() => validateDispatchContext({ ...input, ...override }));
  }
});

test("immutable-source validation requires the exact fetched main and HEAD", () => {
  const calls = [];
  const execute = (_command, argumentsList) => {
    calls.push(argumentsList);
    if (argumentsList[2] === "rev-parse") return `${SHA}\n`;
    return "";
  };
  assert.equal(
    validateImmutableMainSource({
      deploySha: SHA,
      workflowSha: SHA,
      sourcePath: "/trusted/source",
      execute,
    }),
    SHA,
  );
  assert.deepEqual(calls, [
    ["-C", "/trusted/source", "cat-file", "-e", `${SHA}^{commit}`],
    [
      "-C",
      "/trusted/source",
      "merge-base",
      "--is-ancestor",
      SHA,
      "refs/remotes/origin/main",
    ],
    ["-C", "/trusted/source", "rev-parse", "refs/remotes/origin/main"],
    ["-C", "/trusted/source", "rev-parse", "HEAD"],
  ]);
  assert.throws(
    () =>
      validateImmutableMainSource({
        deploySha: SHA,
        workflowSha: SHA,
        sourcePath: "/trusted/source",
        execute: (_command, argumentsList) => {
          if (argumentsList.includes("merge-base")) {
            throw new Error("not an ancestor");
          }
          return `${SHA}\n`;
        },
      }),
    /not an ancestor/,
  );
  assert.throws(
    () =>
      validateImmutableMainSource({
        deploySha: SHA,
        workflowSha: SHA,
        sourcePath: "/trusted/source",
        execute: (_command, argumentsList) =>
          argumentsList.at(-1) === "refs/remotes/origin/main"
            ? `${"e".repeat(40)}\n`
            : `${SHA}\n`,
      }),
    /does not match fetched origin\/main/,
  );
  assert.throws(() =>
    validateImmutableMainSource({
      deploySha: SHA,
      workflowSha: SHA,
      sourcePath: "/trusted/source",
      execute: (_command, argumentsList) => {
        if (argumentsList.at(-1) === "refs/remotes/origin/main") {
          return `${SHA}\n`;
        }
        return argumentsList.at(-1) === "HEAD" ? `${"f".repeat(40)}\n` : "";
      },
    }),
  );
});

test("candidate-modified validators remain inert during trusted validation", () => {
  const sourcePath = mkdtempSync(join(tmpdir(), "shadow-candidate-"));
  const candidateScripts = join(sourcePath, "scripts");
  const marker = join(sourcePath, "candidate-controller-ran");
  try {
    mkdirSync(candidateScripts);
    writeFileSync(
      join(candidateScripts, "vercel-production-shadow.mjs"),
      `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(marker)}, "unsafe");`,
    );
    assert.equal(
      validateImmutableMainSource({
        deploySha: SHA,
        workflowSha: SHA,
        sourcePath,
        execute: (_command, argumentsList) =>
          argumentsList[2] === "rev-parse" ? `${SHA}\n` : "",
      }),
      SHA,
    );
    assert.equal(existsSync(marker), false);
  } finally {
    rmSync(sourcePath, { recursive: true, force: true });
  }
});

test("protected spec includes v3, v2, and every ordinary production alias", () => {
  const spec = createProtectedAliasSpec({
    appV3AliasesJson: JSON.stringify([
      "app.mento.org",
      "appmentoorg-env-v3-mentolabs.vercel.app",
    ]),
    projectIds: projectIds(),
  });
  assert.deepEqual(
    spec.map((entry) => entry.alias),
    [
      "app.mento.org",
      "appmentoorg-env-v3-mentolabs.vercel.app",
      "governance.mento.org",
      "reserve.mento.org",
      "ui.mento.org",
      "v2-app.mento.org",
    ],
  );
  assert.equal(
    spec.find((entry) => entry.alias === "app.mento.org").customEnvironmentSlug,
    "v3",
  );
  assert.equal(
    spec.find((entry) => entry.alias === "v2-app.mento.org").git.ref,
    "v2",
  );
  assert.throws(
    () =>
      createProtectedAliasSpec({
        appV3AliasesJson: '["appmentoorg-env-v3-mentolabs.vercel.app"]',
        projectIds: projectIds(),
      }),
    /must exactly match/,
  );
  assert.throws(
    () =>
      createProtectedAliasSpec({
        appV3AliasesJson: '["app.mento.org","v2-app.mento.org"]',
        projectIds: projectIds(),
      }),
    /must exactly match/,
  );
  assert.throws(
    () =>
      createProtectedAliasSpec({
        appV3AliasesJson:
          '["app.mento.org","appmentoorg-env-v3-mentolabs.vercel.app","unexpected.vercel.app"]',
        projectIds: projectIds(),
      }),
    /must exactly match/,
  );
});

test("immutable-source validation binds workflow identity before Git reads", () => {
  let executed = false;
  assert.throws(
    () =>
      validateImmutableMainSource({
        deploySha: SHA,
        workflowSha: "f".repeat(40),
        execute: () => {
          executed = true;
          return "";
        },
      }),
    /GITHUB_WORKFLOW_SHA does not match DEPLOY_SHA/,
  );
  assert.equal(executed, false);
});

test("Turbo cache summary parsing is canonical and fail-closed", () => {
  assert.deepEqual(
    parseTurboCacheSummary("Tasks: 3 successful\nCached: 2 cached, 3 total\n"),
    { hits: 2, misses: 1, total: 3 },
  );
  assert.deepEqual(
    parseTurboCacheSummary("\u001b[32mCached: 0 cached, 4 total\u001b[0m\n"),
    { hits: 0, misses: 4, total: 4 },
  );
  assert.throws(() => parseTurboCacheSummary("Tasks: 3 successful\n"));
  assert.throws(() =>
    parseTurboCacheSummary(
      "Cached: 1 cached, 2 total\nCached: 1 cached, 2 total\n",
    ),
  );
  assert.throws(() => parseTurboCacheSummary("Cached: x cached, 2 total\n"));
  assert.throws(() => parseTurboCacheSummary("Cached: 3 cached, 2 total\n"));
});

test("deploy output parser emits only an immutable ID and URL", () => {
  assert.deepEqual(
    parseDeployOutput({
      status: "ok",
      deployment: {
        id: "dpl_abc123",
        url: "ordinary-immutable.vercel.app",
      },
      env: [{ key: "SECRET", value: "test-value-not-printed" }],
    }),
    {
      deploymentId: "dpl_abc123",
      deploymentUrl: "https://ordinary-immutable.vercel.app",
    },
  );
  assert.throws(() =>
    parseDeployOutput({ id: "dpl_abc123", url: "governance.mento.org" }),
  );
  assert.throws(() =>
    parseDeployOutput({
      status: "error",
      deployment: { id: "dpl_abc123", url: "ordinary.vercel.app" },
    }),
  );
});

test("deployment expectation fixes production provenance and exact SHA", () => {
  assert.deepEqual(
    createDeploymentExpectation({
      deployment: "dpl_abc123",
      deploymentUrl: "https://ordinary-immutable.vercel.app",
      projectId: "prj_governance123",
      projectName: "governance.mento.org",
      sha: SHA.toUpperCase(),
      transaction: "123-1-governance",
    }),
    {
      deployment: "dpl_abc123",
      deploymentUrl: "https://ordinary-immutable.vercel.app",
      projectId: "prj_governance123",
      projectName: "governance.mento.org",
      readyState: "READY",
      target: "production",
      customEnvironmentSlug: null,
      transaction: "123-1-governance",
      git: {
        org: "mento-protocol",
        repo: "frontend-monorepo",
        ref: "main",
        sha: SHA,
      },
    },
  );
});

test("staged production state permits only its immutable deployment hostname", () => {
  const unexpected = JSON.parse(
    readFileSync(
      new URL(
        "./fixtures/vercel-production-shadow/unexpected-alias.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.throws(
    () => assertUnaliasedProductionShadowDeployment(unexpected),
    /unexpected alias/,
  );

  const immutableHostname = new URL(unexpected.deploymentUrl).hostname;
  const unaliased = {
    ...unexpected,
    aliases: [immutableHostname],
  };
  assert.equal(assertUnaliasedProductionShadowDeployment(unaliased), unaliased);
  assert.throws(
    () =>
      assertUnaliasedProductionShadowDeployment({
        ...unaliased,
        aliases: [],
      }),
    /unexpected alias/,
  );
  assert.throws(
    () =>
      assertUnaliasedProductionShadowDeployment({
        ...unaliased,
        alias: "governance.mento.org",
      }),
    /unexpected alias/,
  );
});

test("custom-v3 pull selects the custom target without a preview-only branch override", () => {
  assert.deepEqual(
    buildProductionShadowPullArguments({
      logicalTarget: "app",
      projectId: "prj_app123",
    }),
    ["pull", "--yes", "--environment", "v3", "--project", "prj_app123"],
  );
});

test("production pull selects production without a preview-only branch override", () => {
  for (const target of ["governance", "reserve", "ui"]) {
    assert.deepEqual(
      buildProductionShadowPullArguments({
        logicalTarget: target,
        projectId: `prj_${target}123`,
      }),
      [
        "pull",
        "--yes",
        "--environment",
        "production",
        "--project",
        `prj_${target}123`,
      ],
    );
  }
});

test("pinned CLI build and deploy arguments bind each literal project and target", () => {
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
  for (const target of ["governance", "reserve", "ui"]) {
    assert.deepEqual(
      buildProductionShadowBuildArguments({
        logicalTarget: target,
        projectId: `prj_${target}123`,
      }),
      [
        "build",
        "--yes",
        "--standalone",
        "--prod",
        "--project",
        `prj_${target}123`,
      ],
    );
    const deploy = buildProductionShadowDeployArguments({
      logicalTarget: target,
      projectId: `prj_${target}123`,
      deploySha: SHA,
      transaction: `123-1-${target}`,
    });
    assert.deepEqual(deploy, [
      "deploy",
      "--prebuilt",
      "--prod",
      "--skip-domain",
      "--archive=tgz",
      "--format=json",
      "--yes",
      "--project",
      `prj_${target}123`,
      "--meta",
      "githubCommitOrg=mento-protocol",
      "--meta",
      "githubCommitRepo=frontend-monorepo",
      "--meta",
      "githubCommitRef=main",
      "--meta",
      `githubCommitSha=${SHA}`,
      "--meta",
      `mentoTransaction=123-1-${target}`,
    ]);
    assert.doesNotMatch(deploy.join(" "), /--token|githubDeployment|promote/);
  }
  assert.throws(() =>
    buildProductionShadowDeployArguments({
      logicalTarget: "app",
      projectId: "prj_app123",
      deploySha: SHA,
      transaction: "123-1-app",
    }),
  );
  const mainTransaction = `main-${SHA}-456-2`;
  const mainDeploy = buildProductionShadowDeployArguments({
    logicalTarget: "governance",
    projectId: "prj_governance123",
    deploySha: SHA,
    transaction: mainTransaction,
  });
  assert.match(mainDeploy.join(" "), new RegExp(mainTransaction));
  assert.doesNotMatch(mainDeploy.join(" "), /promote|rollback|alias set/);
});

test("repo-linked settings use exact repo identity for all four targets", () => {
  for (const [target, contract] of Object.entries(PRODUCTION_SHADOW_TARGETS)) {
    const directory = mkdtempSync(join(tmpdir(), `shadow-${target}-`));
    const projectId = `prj_${target}123`;
    const orgId = "team_fixture123";
    const deploymentId = `m-${target}-0123456789abcdef012`;
    const appVercel = join(directory, contract.rootDirectory, ".vercel");
    const output = join(appVercel, "output");
    try {
      assert.deepEqual(
        materializeProductionShadowLink({
          repoRoot: directory,
          logicalTarget: target,
          orgId,
          projectId,
        }),
        {
          remoteName: "origin",
          projects: [
            { id: projectId, directory: contract.rootDirectory, orgId },
          ],
        },
      );
      mkdirSync(output, { recursive: true });
      writeFileSync(
        join(appVercel, "project.json"),
        JSON.stringify({
          settings: { rootDirectory: contract.rootDirectory },
        }),
      );
      writeFileSync(
        join(output, "config.json"),
        JSON.stringify({ version: 3, deploymentId }),
      );
      writeFileSync(
        join(output, "builds.json"),
        JSON.stringify({
          target: target === "app" ? "v3" : "production",
          cliVersion: "56.2.0",
        }),
      );
      assert.deepEqual(
        assertPulledProductionShadowProject({
          repoRoot: directory,
          logicalTarget: target,
          orgId,
          projectId,
        }),
        { settings: { rootDirectory: contract.rootDirectory } },
      );
      assert.equal(
        assertProductionShadowOutput({
          repoRoot: directory,
          logicalTarget: target,
          deploymentId,
        }),
        output,
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

test("runner pull staging, candidate copy, and upload proof reject external references", () => {
  for (const [target, contract] of Object.entries(PRODUCTION_SHADOW_TARGETS)) {
    const isolationRoot = realpathSync(
      mkdtempSync(join(tmpdir(), `shadow-boundary-${target}-`)),
    );
    const stagingRoot = join(
      isolationRoot,
      "mento-vercel-production-pull-staging",
    );
    const candidateRoot = join(
      isolationRoot,
      "mento-vercel-production-candidate-source",
    );
    const uploadRoot = join(
      isolationRoot,
      "mento-vercel-production-upload-source",
    );
    const orgId = "team_fixture123";
    const projectId = `prj_${target}123`;
    const deploymentId = `m-${target}-0123456789abcdef012`;
    try {
      chmodSync(isolationRoot, 0o711);
      prepareProductionShadowPullStaging({
        isolationRoot,
        stagingRoot,
        logicalTarget: target,
        orgId,
        projectId,
      });
      const appState = join(stagingRoot, contract.rootDirectory, ".vercel");
      mkdirSync(appState, { mode: 0o700 });
      writeFileSync(
        join(appState, "project.json"),
        JSON.stringify({
          settings: { rootDirectory: contract.rootDirectory },
        }),
        { mode: 0o600 },
      );
      const pulledValues = defaultPulledEnvironment(target);
      if (target === "app") {
        Object.assign(pulledValues, {
          CHAINALYSIS_API_KEY: "raw-chainalysis-sentinel",
          SENTRY_AUTH_TOKEN: "raw-sentry-sentinel",
          UNKNOWN_VARIABLE: "raw-unknown-sentinel",
        });
      }
      const rawEnvironment = serializeVercelPulledEnvironment(pulledValues);
      const rawEnvironmentPath = join(
        appState,
        `.env.${contract.pullEnvironment}.local`,
      );
      writeFileSync(rawEnvironmentPath, rawEnvironment, { mode: 0o600 });
      const rawEnvironmentBefore = lstatSync(rawEnvironmentPath);
      assert.deepEqual(
        assertProductionShadowPullStaging({
          isolationRoot,
          stagingRoot,
          logicalTarget: target,
          orgId,
          projectId,
        }),
        { settings: { rootDirectory: contract.rootDirectory } },
      );

      mkdirSync(join(candidateRoot, contract.rootDirectory), {
        recursive: true,
        mode: 0o700,
      });
      stageProductionShadowPullForCandidate({
        isolationRoot,
        stagingRoot,
        candidateRoot,
        logicalTarget: target,
        orgId,
        projectId,
        buildUid: process.getuid(),
        buildGid: process.getgid(),
        runnerUid: process.getuid(),
        runnerGid: process.getgid(),
      });
      const rawEnvironmentAfter = lstatSync(rawEnvironmentPath);
      assert.equal(readFileSync(rawEnvironmentPath, "utf8"), rawEnvironment);
      for (const field of [
        "dev",
        "ino",
        "mode",
        "nlink",
        "size",
        "uid",
        "gid",
        "mtimeMs",
        "ctimeMs",
      ]) {
        assert.equal(rawEnvironmentAfter[field], rawEnvironmentBefore[field]);
      }
      const candidateEnvironmentPath = join(
        candidateRoot,
        contract.rootDirectory,
        ".vercel",
        `.env.${contract.pullEnvironment}.local`,
      );
      const candidateEnvironment = readFileSync(
        candidateEnvironmentPath,
        "utf8",
      );
      assert.deepEqual(
        parseVercelPulledEnvironment(candidateEnvironment),
        defaultPulledEnvironment(target),
      );
      for (const forbidden of [
        "CHAINALYSIS_API_KEY",
        "SENTRY_AUTH_TOKEN",
        "UNKNOWN_VARIABLE",
        "raw-chainalysis-sentinel",
        "raw-sentry-sentinel",
        "raw-unknown-sentinel",
      ]) {
        assert.doesNotMatch(candidateEnvironment, new RegExp(forbidden));
      }
      const materializationRoot = join(
        isolationRoot,
        "mento-vercel-production-build-environment",
      );
      const materializedEnvironmentPath = join(
        materializationRoot,
        ".vercel",
        `.env.${contract.pullEnvironment}.local`,
      );
      const materializedEnvironment = readFileSync(
        materializedEnvironmentPath,
        "utf8",
      );
      assert.equal(materializedEnvironment, candidateEnvironment);
      if (target === "app") {
        const pollutedEnvironment = serializeVercelPulledEnvironment({
          ...defaultPulledEnvironment(target),
          UNKNOWN_VARIABLE: "candidate-pollution-sentinel",
        });
        writeFileSync(candidateEnvironmentPath, pollutedEnvironment, {
          mode: 0o600,
        });
        assert.throws(
          () =>
            assertCandidateProductionShadowPull({
              isolationRoot,
              candidateRoot,
              logicalTarget: target,
              orgId,
              projectId,
              buildUid: process.getuid(),
              buildGid: process.getgid(),
              runnerUid: process.getuid(),
              runnerGid: process.getgid(),
            }),
          /canonical exact allowlist/,
        );
        writeFileSync(candidateEnvironmentPath, candidateEnvironment, {
          mode: 0o600,
        });

        writeFileSync(materializedEnvironmentPath, pollutedEnvironment, {
          mode: 0o600,
        });
        assert.throws(
          () =>
            assertMaterializedProductionShadowBuildEnvironment({
              isolationRoot,
              stagingRoot,
              materializationRoot,
              logicalTarget: target,
              orgId,
              projectId,
            }),
          /exact allowlist/,
        );
        writeFileSync(materializedEnvironmentPath, materializedEnvironment, {
          mode: 0o600,
        });
      }
      const output = join(
        candidateRoot,
        contract.rootDirectory,
        ".vercel",
        "output",
      );
      mkdirSync(output, { mode: 0o700 });
      writeFileSync(
        join(output, "config.json"),
        JSON.stringify({ version: 3, deploymentId }),
        { mode: 0o600 },
      );
      writeFileSync(
        join(output, "builds.json"),
        JSON.stringify({
          target: target === "app" ? "v3" : "production",
          cliVersion: "56.2.0",
        }),
        { mode: 0o600 },
      );
      writeFileSync(
        `${candidateRoot}.provenance.json`,
        `${JSON.stringify({ commitSha: SHA })}\n`,
        { mode: 0o600 },
      );
      assert.equal(
        assertProductionShadowReadyForUpload({
          repoRoot: candidateRoot,
          logicalTarget: target,
          orgId,
          projectId,
          deploymentId,
          deploySha: SHA,
        }),
        output,
      );

      if (target === "ui") {
        const functionDirectory = join(output, "functions", "api.func");
        const functionConfig = join(functionDirectory, ".vc-config.json");
        mkdirSync(functionDirectory, { recursive: true, mode: 0o700 });
        writeFileSync(
          functionConfig,
          JSON.stringify({
            runtime: "nodejs22.x",
            handler: "index.js",
            filePathMap: {
              "captured-environment": "../../proc/self/environ",
            },
          }),
          { mode: 0o600 },
        );
        const readyForUpload = () =>
          assertProductionShadowReadyForUpload({
            repoRoot: candidateRoot,
            logicalTarget: target,
            orgId,
            projectId,
            deploymentId,
            deploySha: SHA,
          });
        assert.throws(readyForUpload, /external function file references/);
        assert.throws(
          () =>
            createProductionShadowUploadHandoff({
              isolationRoot,
              stagingRoot,
              candidateRoot,
              uploadRoot,
              logicalTarget: target,
              orgId,
              projectId,
              deploymentId,
              deploySha: SHA,
              buildUid: process.getuid(),
              buildGid: process.getgid(),
              runnerUid: process.getuid(),
              runnerGid: process.getgid(),
            }),
          /external function file references/,
        );
        assert.equal(existsSync(uploadRoot), false);

        writeFileSync(
          functionConfig,
          JSON.stringify({
            runtime: "nodejs22.x",
            handler: "index.js",
            filePathMap: {},
          }),
          { mode: 0o600 },
        );
        assert.equal(readyForUpload(), output);

        writeFileSync(functionConfig, "{", { mode: 0o600 });
        assert.throws(readyForUpload, /invalid function config/);
        writeFileSync(functionConfig, " ".repeat(1_024 * 1_024 + 1), {
          mode: 0o600,
        });
        assert.throws(readyForUpload, /oversized function config/);
      }

      writeFileSync(join(stagingRoot, "candidate-extra"), "unsafe", {
        mode: 0o600,
      });
      assert.throws(
        () =>
          assertProductionShadowPullStaging({
            isolationRoot,
            stagingRoot,
            logicalTarget: target,
            orgId,
            projectId,
          }),
        /unexpected filesystem entry/,
      );
    } finally {
      rmSync(isolationRoot, { recursive: true, force: true });
    }
  }
});

test("Vercel pull inherits a private umask and restores the runner umask", () => {
  const isolationRoot = realpathSync(
    mkdtempSync(join(tmpdir(), "shadow-pull-umask-")),
  );
  const stagingRoot = join(
    isolationRoot,
    "mento-vercel-production-pull-staging",
  );
  const logicalTarget = "ui";
  const contract = PRODUCTION_SHADOW_TARGETS[logicalTarget];
  const orgId = "team_fixture123";
  const projectId = "prj_ui123";
  const priorUmask = process.umask();
  try {
    chmodSync(isolationRoot, 0o711);
    prepareProductionShadowPullStaging({
      isolationRoot,
      stagingRoot,
      logicalTarget,
      orgId,
      projectId,
    });
    const result = pullProductionShadowProject({
      repoRoot: stagingRoot,
      logicalTarget,
      projectId,
      executeVercel: ({ repoRoot, argumentsList }) => {
        assert.equal(process.umask(), 0o077);
        assert.equal(repoRoot, stagingRoot);
        assert.deepEqual(
          argumentsList,
          buildProductionShadowPullArguments({ logicalTarget, projectId }),
        );
        const appState = join(stagingRoot, contract.rootDirectory, ".vercel");
        mkdirSync(appState);
        writeFileSync(
          join(appState, "project.json"),
          JSON.stringify({
            settings: { rootDirectory: contract.rootDirectory },
          }),
        );
        writeFileSync(
          join(appState, `.env.${contract.pullEnvironment}.local`),
          "FIXTURE_ONLY=1\n",
        );
        return "pulled";
      },
    });
    assert.equal(result, "pulled");
    assert.equal(process.umask(), priorUmask);
    assert.deepEqual(
      assertProductionShadowPullStaging({
        isolationRoot,
        stagingRoot,
        logicalTarget,
        orgId,
        projectId,
      }),
      { settings: { rootDirectory: contract.rootDirectory } },
    );
  } finally {
    process.umask(priorUmask);
    rmSync(isolationRoot, { recursive: true, force: true });
  }
});

test("handoff enforces distinct candidate and runner ownership contracts", () => {
  const isolationRoot = realpathSync(
    mkdtempSync(join(tmpdir(), "shadow-handoff-owner-")),
  );
  const stagingRoot = join(
    isolationRoot,
    "mento-vercel-production-pull-staging",
  );
  const candidateRoot = join(
    isolationRoot,
    "mento-vercel-production-candidate-source",
  );
  const uploadRoot = join(
    isolationRoot,
    "mento-vercel-production-upload-source",
  );
  const logicalTarget = "ui";
  const contract = PRODUCTION_SHADOW_TARGETS[logicalTarget];
  const orgId = "team_fixture123";
  const projectId = "prj_ui123";
  const deploymentId = "m-ui-0123456789abcdef012";
  const runnerUid = process.getuid();
  const runnerGid = process.getgid();
  const candidateUid = runnerUid + 10_000;
  const candidateGid = runnerGid + 10_000;
  const ownershipChanges = [];
  const candidateValidations = [];
  try {
    chmodSync(isolationRoot, 0o711);
    prepareProductionShadowPullStaging({
      isolationRoot,
      stagingRoot,
      logicalTarget,
      orgId,
      projectId,
    });
    const stagedAppState = join(stagingRoot, contract.rootDirectory, ".vercel");
    mkdirSync(stagedAppState, { mode: 0o700 });
    writeFileSync(
      join(stagedAppState, "project.json"),
      JSON.stringify({
        settings: { rootDirectory: contract.rootDirectory },
      }),
      { mode: 0o600 },
    );
    writeFileSync(
      join(stagedAppState, `.env.${contract.pullEnvironment}.local`),
      "FIXTURE_ONLY=1\n",
      { mode: 0o600 },
    );
    const candidateOutput = join(
      candidateRoot,
      contract.rootDirectory,
      ".vercel",
      "output",
    );
    mkdirSync(candidateOutput, { mode: 0o700, recursive: true });
    writeFileSync(
      join(candidateOutput, "config.json"),
      JSON.stringify({ version: 3, deploymentId }),
      { mode: 0o600 },
    );
    writeFileSync(
      join(candidateOutput, "builds.json"),
      JSON.stringify({ target: "production", cliVersion: "56.2.0" }),
      { mode: 0o600 },
    );

    const result = createProductionShadowUploadHandoff({
      isolationRoot,
      stagingRoot,
      candidateRoot,
      uploadRoot,
      logicalTarget,
      orgId,
      projectId,
      deploymentId,
      deploySha: SHA,
      buildUid: candidateUid,
      buildGid: candidateGid,
      runnerUid,
      runnerGid,
      changeOwner: (path, uid, gid) => {
        ownershipChanges.push({ path, uid, gid });
      },
      validateCandidate: (values) => {
        candidateValidations.push(values);
      },
      validateMaterialized: () => {},
    });
    assert.notEqual(candidateUid, runnerUid);
    assert.notEqual(candidateGid, runnerGid);
    assert.equal(candidateValidations.length, 1);
    assert.equal(candidateValidations[0].expectedUid, candidateUid);
    assert.equal(candidateValidations[0].expectedGid, candidateGid);
    assert.equal(candidateValidations[0].expectedProvenanceUid, runnerUid);
    assert.ok(ownershipChanges.length >= 8);
    assert.ok(
      ownershipChanges.some(({ path }) => path.endsWith("config.json")),
    );
    assert.ok(
      ownershipChanges.some(({ path }) => path.endsWith(".provenance.json")),
    );
    for (const ownership of ownershipChanges) {
      assert.equal(ownership.uid, runnerUid);
      assert.equal(ownership.gid, runnerGid);
    }
    assert.equal(result.uid, runnerUid);
    assert.equal(result.gid, runnerGid);
    assert.equal(result.sourceRoot, realpathSync(uploadRoot));
  } finally {
    rmSync(isolationRoot, { recursive: true, force: true });
  }
});

test("raw Git-object materialization bypasses archive and checkout filters", () => {
  const repository = mkdtempSync(join(tmpdir(), "shadow-raw-source-"));
  const isolationRoot = realpathSync(
    mkdtempSync(join(tmpdir(), "shadow-raw-isolation-")),
  );
  const candidate = join(
    isolationRoot,
    "mento-vercel-production-candidate-source",
  );
  const checkoutCandidate = mkdtempSync(
    join(tmpdir(), "shadow-filtered-candidate-"),
  );
  try {
    chmodSync(isolationRoot, 0o711);
    execFileSync("git", ["init", "--quiet"], { cwd: repository });
    writeFileSync(
      join(repository, ".gitattributes"),
      [
        "*.txt text eol=crlf ident",
        "ignored.txt export-ignore",
        "substituted.txt export-subst",
        "",
      ].join("\n"),
    );
    writeFileSync(join(repository, "ignored.txt"), "must remain\n");
    writeFileSync(join(repository, "substituted.txt"), "$Format:%H$\n");
    writeFileSync(join(repository, "identity.txt"), "$Id$\n");
    writeFileSync(join(repository, "line-endings.txt"), "one\ntwo\n");
    writeFileSync(join(repository, "executable.sh"), "#!/bin/sh\nexit 0\n");
    chmodSync(join(repository, "executable.sh"), 0o755);
    writeFileSync(join(repository, "plain.txt"), "plain\n");
    chmodSync(join(repository, "plain.txt"), 0o644);
    symlinkSync("ignored.txt", join(repository, "linked.txt"));
    execFileSync("git", ["add", "."], { cwd: repository });
    execFileSync(
      "git",
      [
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.com",
        "commit",
        "--quiet",
        "-m",
        "fixture",
      ],
      { cwd: repository },
    );
    const commitSha = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repository,
      encoding: "utf8",
    }).trim();

    const result = materializeExactGitTree({
      isolationRoot,
      sourceRoot: repository,
      candidateRoot: candidate,
      commitSha,
    });
    assert.equal(result.sourceRoot, realpathSync(candidate));
    assert.ok(result.entries >= 8);
    execFileSync(
      "git",
      ["checkout-index", "--all", "--force", `--prefix=${checkoutCandidate}/`],
      { cwd: repository },
    );
    for (const path of [
      "ignored.txt",
      "substituted.txt",
      "identity.txt",
      "line-endings.txt",
    ]) {
      const blob = execFileSync("git", ["cat-file", "blob", `HEAD:${path}`], {
        cwd: repository,
      });
      assert.deepEqual(readFileSync(join(candidate, path)), blob);
    }
    assert.match(
      readFileSync(join(checkoutCandidate, "identity.txt"), "utf8"),
      /^\$Id: [0-9a-f]{40} \$\r\n$/,
    );
    assert.deepEqual(
      readFileSync(join(checkoutCandidate, "line-endings.txt")),
      Buffer.from("one\r\ntwo\r\n"),
    );
    assert.equal(
      lstatSync(join(candidate, "linked.txt")).isSymbolicLink(),
      true,
    );
    assert.equal(readlinkSync(join(candidate, "linked.txt")), "ignored.txt");
    assert.notEqual(
      lstatSync(join(candidate, "executable.sh")).mode & 0o111,
      0,
    );
    assert.equal(lstatSync(join(candidate, "plain.txt")).mode & 0o111, 0);
    assert.equal(existsSync(join(candidate, ".git")), false);
    assert.throws(
      () =>
        materializeExactGitTree({
          isolationRoot,
          sourceRoot: repository,
          candidateRoot: candidate,
          commitSha,
        }),
      /must be fresh/,
    );
  } finally {
    rmSync(repository, { force: true, recursive: true });
    rmSync(isolationRoot, { force: true, recursive: true });
    rmSync(checkoutCandidate, { force: true, recursive: true });
  }
});

test("raw Git-object materialization rejects gitlinks before writing", () => {
  const repository = mkdtempSync(join(tmpdir(), "shadow-gitlink-source-"));
  const isolationRoot = realpathSync(
    mkdtempSync(join(tmpdir(), "shadow-gitlink-isolation-")),
  );
  const candidate = join(
    isolationRoot,
    "mento-vercel-production-candidate-source",
  );
  try {
    chmodSync(isolationRoot, 0o711);
    execFileSync("git", ["init", "--quiet"], { cwd: repository });
    writeFileSync(join(repository, "plain.txt"), "plain\n");
    execFileSync("git", ["add", "."], { cwd: repository });
    execFileSync(
      "git",
      [
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.com",
        "commit",
        "--quiet",
        "-m",
        "base",
      ],
      { cwd: repository },
    );
    const baseCommit = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repository,
      encoding: "utf8",
    }).trim();
    execFileSync(
      "git",
      ["update-index", "--add", "--cacheinfo", `160000,${baseCommit},vendor`],
      { cwd: repository },
    );
    const tree = execFileSync("git", ["write-tree"], {
      cwd: repository,
      encoding: "utf8",
    }).trim();
    const gitlinkCommit = execFileSync(
      "git",
      [
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.com",
        "commit-tree",
        tree,
        "-p",
        baseCommit,
        "-m",
        "gitlink",
      ],
      { cwd: repository, encoding: "utf8" },
    ).trim();

    assert.throws(
      () =>
        materializeExactGitTree({
          isolationRoot,
          sourceRoot: repository,
          candidateRoot: candidate,
          commitSha: gitlinkCommit,
        }),
      /unsupported entry/,
    );
    assert.equal(existsSync(candidate), false);
  } finally {
    rmSync(repository, { force: true, recursive: true });
    rmSync(isolationRoot, { force: true, recursive: true });
  }
});

test("trusted builds reject every post-build project-link mutation before deploy", () => {
  const updateRepoProject = (directory, update) => {
    const linkPath = join(directory, ".vercel", "repo.json");
    const link = JSON.parse(readFileSync(linkPath, "utf8"));
    update(link.projects[0]);
    writeFileSync(linkPath, JSON.stringify(link));
  };
  const mutations = [
    {
      name: "missing repo link",
      apply: ({ directory }) => rmSync(join(directory, ".vercel", "repo.json")),
      error: /Repo-level Vercel link is missing or malformed/,
    },
    {
      name: "wrong organization",
      apply: ({ directory }) =>
        updateRepoProject(directory, (project) => {
          project.orgId = "team_other123";
        }),
      error: /Repo-level Vercel mapping does not match the literal target/,
    },
    {
      name: "missing organization",
      apply: ({ directory }) =>
        updateRepoProject(directory, (project) => {
          delete project.orgId;
        }),
      error: /Repo-level Vercel mapping does not match the literal target/,
    },
    {
      name: "wrong project",
      apply: ({ directory }) =>
        updateRepoProject(directory, (project) => {
          project.id = "prj_other123";
        }),
      error: /Repo-level Vercel mapping does not match the literal target/,
    },
    {
      name: "missing project",
      apply: ({ directory }) =>
        updateRepoProject(directory, (project) => {
          delete project.id;
        }),
      error: /Repo-level Vercel mapping does not match the literal target/,
    },
    ...[
      ["projectId", "prj_duplicate123"],
      ["orgId", "team_duplicate123"],
      ["projectName", "duplicate.mento.org"],
    ].map(([name, value]) => ({
      name: `standalone ${name}`,
      apply: ({ projectPath, project }) =>
        writeFileSync(
          projectPath,
          JSON.stringify({ ...project, [name]: value }),
        ),
      error: /repo-linked Vercel project file must contain only settings/,
    })),
    {
      name: "wrong Root Directory",
      apply: ({ projectPath, project }) =>
        writeFileSync(
          projectPath,
          JSON.stringify({
            ...project,
            settings: { rootDirectory: "apps/other.mento.org" },
          }),
        ),
      error: /Root Directory does not match the literal target/,
    },
  ];

  for (const [target, contract] of Object.entries(PRODUCTION_SHADOW_TARGETS)) {
    for (const mutation of mutations) {
      const directory = mkdtempSync(
        join(tmpdir(), `shadow-post-build-${target}-`),
      );
      const orgId = "team_fixture123";
      const projectId = `prj_${target}123`;
      const deploymentId = `m-${target}-0123456789abcdef012`;
      const appVercel = join(directory, contract.rootDirectory, ".vercel");
      const output = join(appVercel, "output");
      const projectPath = join(appVercel, "project.json");
      const project = {
        settings: { rootDirectory: contract.rootDirectory },
      };
      const operations = [];
      try {
        materializeProductionShadowLink({
          repoRoot: directory,
          logicalTarget: target,
          orgId,
          projectId,
        });
        mkdirSync(output, { recursive: true });
        writeFileSync(projectPath, JSON.stringify(project));
        writeFileSync(
          join(output, "config.json"),
          JSON.stringify({ version: 3, deploymentId }),
        );
        writeFileSync(
          join(output, "builds.json"),
          JSON.stringify({
            target: target === "app" ? "v3" : "production",
            cliVersion: "56.2.0",
          }),
        );

        assert.throws(
          () => {
            buildProductionShadowArtifact({
              repoRoot: directory,
              logicalTarget: target,
              orgId,
              projectId,
              deploymentId,
              executeVercel: () => {
                operations.push("build");
                mutation.apply({ directory, projectPath, project });
              },
            });
            operations.push("deploy");
          },
          mutation.error,
          `${target}: ${mutation.name}`,
        );
        assert.deepEqual(operations, ["build"], `${target}: ${mutation.name}`);
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    }
  }
});

test("Vercel subprocess keeps credentials in env but strips ID overrides", () => {
  assert.deepEqual(
    environmentForVercelCli({
      CI: "1",
      VERCEL_ORG_ID: "team_fixture123",
      VERCEL_PROJECT_ID: "prj_ui123",
      VERCEL_TOKEN: "fixture-token",
      GITHUB_ENV: "/runner/command/env",
      GITHUB_OUTPUT: "/runner/command/output",
      GITHUB_PATH: "/runner/command/path",
      GITHUB_STATE: "/runner/command/state",
      GITHUB_STEP_SUMMARY: "/runner/command/summary",
    }),
    { CI: "1", VERCEL_TOKEN: "fixture-token" },
  );
  const calls = [];
  assert.equal(
    runProductionShadowVercel({
      repoRoot: "/fixture/repo",
      argumentsList: [
        "build",
        "--yes",
        "--standalone",
        "--prod",
        "--project",
        "prj_ui123",
      ],
      environment: {
        VERCEL_ORG_ID: "team_fixture123",
        VERCEL_PROJECT_ID: "prj_ui123",
        VERCEL_TOKEN: "fixture-token",
        GITHUB_ENV: "/runner/command/env",
        GITHUB_OUTPUT: "/runner/command/output",
        GITHUB_PATH: "/runner/command/path",
        GITHUB_STATE: "/runner/command/state",
        GITHUB_STEP_SUMMARY: "/runner/command/summary",
      },
      captureStdout: true,
      run: (command, argumentsList, options) => {
        calls.push({ command, argumentsList, options });
        return { status: 0, stdout: '{"status":"ok"}' };
      },
    }),
    '{"status":"ok"}',
  );
  assert.equal(calls[0].command, "pnpm");
  assert.deepEqual(calls[0].argumentsList, [
    "exec",
    "vercel",
    "build",
    "--yes",
    "--standalone",
    "--prod",
    "--project",
    "prj_ui123",
  ]);
  assert.deepEqual(calls[0].options.env, { VERCEL_TOKEN: "fixture-token" });
});

test("every target build child denies adversarial command-file PATH poisoning", () => {
  const commandFiles = {
    GITHUB_ENV: "/runner/command/env",
    GITHUB_OUTPUT: "/runner/command/output",
    GITHUB_PATH: "/runner/command/path",
    GITHUB_STATE: "/runner/command/state",
    GITHUB_STEP_SUMMARY: "/runner/command/summary",
  };
  for (const target of Object.keys(PRODUCTION_SHADOW_TARGETS)) {
    const calls = [];
    runProductionShadowVercel({
      repoRoot: "/fixture/repo",
      argumentsList: buildProductionShadowBuildArguments({
        logicalTarget: target,
        projectId: `prj_${target}123`,
      }),
      environment: {
        CI: "1",
        PATH: "/trusted/node:/trusted/pnpm:/usr/bin",
        VERCEL_ORG_ID: "team_fixture123",
        VERCEL_PROJECT_ID: `prj_${target}123`,
        ...commandFiles,
      },
      run: (command, argumentsList, options) => {
        assert.deepEqual(
          Object.keys(commandFiles).filter((name) => name in options.env),
          [],
          `${target} candidate can reach a GitHub command file`,
        );
        calls.push({ command, argumentsList, options });
        return { status: 0 };
      },
    });
    assert.equal(calls.length, 1, target);
    assert.equal(calls[0].command, "pnpm", target);
    assert.deepEqual(calls[0].options.env, {
      CI: "1",
      PATH: "/trusted/node:/trusted/pnpm:/usr/bin",
    });
    assert.deepEqual(
      calls[0].argumentsList.slice(0, 3),
      ["exec", "vercel", "build"],
      target,
    );
  }
});

test("trusted child processes strip GitHub command files", () => {
  assert.deepEqual(
    environmentForTrustedChild({
      VERCEL_ORG_ID: "team_fixture123",
      VERCEL_TOKEN: "fixture-token",
      GITHUB_ENV: "/runner/command/env",
      GITHUB_OUTPUT: "/runner/command/output",
    }),
    {
      VERCEL_ORG_ID: "team_fixture123",
      VERCEL_TOKEN: "fixture-token",
    },
  );
});

test("app proof encodes Outcome B without a reachable deploy", () => {
  const proof = createAppBuildOnlyProof({
    sha: SHA,
    deploymentId: "m-app-example123",
  });
  assert.equal(proof.environment, "v3");
  assert.equal(proof.vercelEnv, "preview");
  assert.equal(proof.sentryAuthToken, "explicit-empty");
  assert.equal(proof.deployReachable, false);
  assert.equal(
    proof.futureActivationCommand,
    "vercel deploy --prebuilt --target=v3 --archive=tgz --format=json",
  );
});

test("canonical output creation refuses candidate-precreated symlinks", () => {
  const directory = mkdtempSync(join(tmpdir(), "shadow-output-"));
  const protectedTarget = join(directory, "protected-target.json");
  const output = join(directory, "app-proof.json");
  try {
    writeFileSync(protectedTarget, "unchanged\n");
    symlinkSync(protectedTarget, output);
    assert.throws(() =>
      execFileSync(
        process.execPath,
        [productionShadowScript, "app-proof", "--output", output],
        {
          env: {
            ...process.env,
            DEPLOY_SHA: SHA,
            MENTO_NEXT_DEPLOYMENT_ID: "m-app-example123",
          },
          stdio: "pipe",
        },
      ),
    );
    assert.equal(readFileSync(protectedTarget, "utf8"), "unchanged\n");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("pilot summary records exact build, staging, and rollback evidence", () => {
  const directory = mkdtempSync(join(tmpdir(), "shadow-summary-"));
  const summaryPath = join(directory, "summary.md");
  const ordinary = (target) => ({
    id: `dpl_${target}123`,
    url: `https://${target}-immutable.vercel.app`,
    buildDurationMs: "100",
    deployDurationMs: "50",
    totalDurationMs: "200",
  });
  try {
    writePilotSummary({
      path: summaryPath,
      sha: SHA,
      runUrl:
        "https://github.com/mento-protocol/frontend-monorepo/actions/runs/123",
      workflowDurationMs: "1000",
      baseline: [
        {
          alias: "app.mento.org",
          deploymentId: "dpl_appv3old123",
          deploymentUrl: "https://app-v3-old.vercel.app",
          customEnvironmentSlug: "v3",
        },
        {
          alias: "appmentoorg-env-v3-mentolabs.vercel.app",
          deploymentId: "dpl_appv3old123",
          deploymentUrl: "https://app-v3-old.vercel.app",
          customEnvironmentSlug: "v3",
        },
        {
          alias: "v2-app.mento.org",
          deploymentId: "dpl_appv2old123",
          deploymentUrl: "https://app-v2-old.vercel.app",
          customEnvironmentSlug: null,
        },
      ],
      app: {
        nextDeploymentId: "m-app-0123456789abcdef012",
        buildDurationMs: "100",
        totalDurationMs: "150",
        cacheHits: "1",
        cacheMisses: "2",
      },
      governance: {
        ...ordinary("governance"),
        cacheHits: "2",
        cacheMisses: "1",
      },
      reserve: { ...ordinary("reserve"), cacheHits: "0", cacheMisses: "3" },
      ui: { ...ordinary("ui"), cacheHits: "3", cacheMisses: "0" },
    });
    const summary = readFileSync(summaryPath, "utf8");
    assert.match(summary, new RegExp(SHA));
    assert.match(summary, /build-only Outcome B/);
    assert.match(summary, /m-app-0123456789abcdef012/);
    assert.match(
      summary,
      /vercel alias set https:\/\/app-v3-old\.vercel\.app app\.mento\.org/,
    );
    assert.match(summary, /dpl_governance123/);
    assert.match(summary, /Whole workflow duration: 1000 ms/);
    assert.match(summary, /2 hit \/ 1 miss/);
    assert.doesNotMatch(summary, /fixture-token|test-value-not-printed/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("fixture variable failures reveal only the fake missing name", () => {
  const secret = "test-value-not-printed";
  assert.equal(
    assertRequiredVariableNames(["REAL_NAME"], { REAL_NAME: secret }),
    1,
  );
  assert.throws(
    () =>
      assertRequiredVariableNames(["REAL_NAME", "FIXTURE_REQUIRED_SECRET"], {
        REAL_NAME: secret,
      }),
    (error) => {
      assert.match(error.message, /FIXTURE_REQUIRED_SECRET/);
      assert.doesNotMatch(error.message, new RegExp(secret));
      return true;
    },
  );
});

test("every shadow build requires the exact remote-cache variable names", () => {
  assert.deepEqual(REQUIRED_BUILD_CACHE_VARIABLE_NAMES, [
    "TURBO_REMOTE_CACHE_SIGNATURE_KEY",
    "TURBO_TEAM",
    "TURBO_TOKEN",
  ]);
  const values = {
    TURBO_REMOTE_CACHE_SIGNATURE_KEY: "signature-never-printed",
    TURBO_TEAM: "fixture-team",
    TURBO_TOKEN: "token-never-printed",
  };
  assert.equal(assertProductionShadowBuildInputs(values), 3);
  for (const missing of REQUIRED_BUILD_CACHE_VARIABLE_NAMES) {
    assert.throws(
      () =>
        assertProductionShadowBuildInputs(
          Object.fromEntries(
            Object.entries(values).filter(([name]) => name !== missing),
          ),
        ),
      (error) => {
        assert.match(error.message, new RegExp(missing));
        assert.doesNotMatch(error.message, /never-printed/);
        return true;
      },
    );
  }
  assert.doesNotThrow(() => assertProductionShadowBuildInputs(values));
});

test("evidence scanner rejects sensitive field names", () => {
  const safe = fileURLToPath(
    new URL(
      "./fixtures/vercel-deployment-state/valid-production.json",
      import.meta.url,
    ),
  );
  const unsafe = fileURLToPath(
    new URL(
      "./fixtures/vercel-deployment-state/sensitive-response.json",
      import.meta.url,
    ),
  );
  assert.doesNotThrow(() => assertEvidenceFiles([safe]));
  assert.throws(() => assertEvidenceFiles([unsafe]), /forbidden/);
});

function protectedAliasBaseline() {
  return [
    {
      alias: "app.mento.org",
      deploymentId: "dpl_appold123",
      deploymentUrl: "https://app-old.vercel.app",
      projectId: "prj_app123",
    },
    {
      alias: "governance.mento.org",
      deploymentId: "dpl_governanceold123",
      deploymentUrl: "https://governance-old.vercel.app",
      projectId: "prj_governance123",
    },
  ];
}

test("protected alias drift fails read-only with canonical operator evidence", async () => {
  const baseline = protectedAliasBaseline();
  const reads = [];
  await assert.rejects(
    () =>
      assertProtectedAliasesUnchanged({
        baseline,
        client: {
          aliasMapping: async (alias) => {
            reads.push(alias);
            if (alias === "governance.mento.org") {
              return {
                alias,
                deploymentId: "dpl_governancenew123",
                deploymentUrl: "https://governance-new.vercel.app",
                projectId: "prj_governance123",
              };
            }
            return {
              alias,
              deploymentId: "dpl_appold123",
              deploymentUrl: "https://app-old.vercel.app",
              projectId: "prj_app123",
            };
          },
        },
      }),
    (error) => {
      assert.match(error.message, /read-only and attempted no repair/);
      assert.match(error.message, /dpl_governanceold123/);
      assert.match(error.message, /governance-old\.vercel\.app/);
      assert.match(error.message, /dpl_governancenew123/);
      assert.match(error.message, /governance-new\.vercel\.app/);
      assert.match(
        error.message,
        /vercel alias set https:\/\/governance-old\.vercel\.app governance\.mento\.org/,
      );
      assert.match(error.message, /confirm there is no concurrent/);
      return true;
    },
  );
  assert.deepEqual(reads, ["app.mento.org", "governance.mento.org"]);
});

test("protected alias check no-ops only for exact ID, URL, and project matches", async () => {
  const baseline = protectedAliasBaseline();
  assert.deepEqual(
    await assertProtectedAliasesUnchanged({
      baseline,
      client: {
        aliasMapping: async (alias) => {
          const state = baseline.find((entry) => entry.alias === alias);
          return { ...state };
        },
      },
    }),
    [],
  );
  await assert.rejects(
    () =>
      assertProtectedAliasesUnchanged({
        baseline,
        client: {
          aliasMapping: async (alias) => {
            const state = baseline.find((entry) => entry.alias === alias);
            return alias === "app.mento.org"
              ? { ...state, projectId: "prj_other123" }
              : { ...state };
          },
        },
      }),
    /Protected alias drift detected/,
  );
});

test("protected alias check propagates unreadable mappings without writes", async () => {
  await assert.rejects(
    () =>
      assertProtectedAliasesUnchanged({
        baseline: protectedAliasBaseline(),
        client: {
          aliasMapping: async () => {
            throw new Error("missing mapping");
          },
        },
      }),
    /missing mapping/,
  );
});

test("bounded health checks pass without logging response bodies", async () => {
  const calls = [];
  await waitForHealthyUrls({
    urls: ["governance.mento.org"],
    attempts: 2,
    delayMs: 0,
    fetchImplementation: async (url, options) => {
      calls.push({ url, options });
      return {
        status: calls.length === 1 ? 503 : 204,
        headers: { get: () => null },
      };
    },
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.headers, undefined);
  assert.equal(calls[0].options.redirect, "manual");
});

test("health checks never follow a cross-origin redirect", async () => {
  const calls = [];
  await assert.rejects(
    () =>
      fetchWithOriginBoundRedirects({
        url: "https://governance-immutable.vercel.app",
        fetchImplementation: async (url, options) => {
          calls.push({ url, options });
          return {
            status: 302,
            headers: { get: () => "https://attacker.example/collect" },
          };
        },
      }),
    /redirected outside its immutable origin/,
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://governance-immutable.vercel.app");
  assert.equal(calls[0].options.headers, undefined);
  assert.equal(calls[0].options.redirect, "manual");
});

test("browser request policy rejects protection headers", () => {
  assert.deepEqual(
    productionShadowRequestHeaders({
      existingHeaders: { Accept: "text/javascript" },
    }),
    { Accept: "text/javascript" },
  );
  for (const name of [
    "x-vercel-protection-bypass",
    "X-Vercel-Protection-Bypass",
  ]) {
    assert.throws(
      () =>
        productionShadowRequestHeaders({
          existingHeaders: { [name]: "must-be-rejected" },
        }),
      /forbidden protection header/,
    );
  }
  assert.equal(
    assertProductionShadowOrigin(
      "https://governance-immutable.vercel.app/path",
      "https://governance-immutable.vercel.app",
    ),
    true,
  );
  assert.throws(() =>
    assertProductionShadowOrigin(
      "https://attacker.example/collect",
      "https://governance-immutable.vercel.app",
    ),
  );
});

test("stable final gate fails skipped, cancelled, or failed dependencies", () => {
  const results = Object.fromEntries(
    [
      "preflight",
      "baseline",
      "app",
      "governance",
      "smokeGovernance",
      "reserve",
      "smokeReserve",
      "ui",
      "smokeUi",
      "finalAliasComparison",
    ].map((name) => [name, "success"]),
  );
  assert.doesNotThrow(() => assertFinalJobResults(results));
  for (const result of ["skipped", "cancelled", "failure"]) {
    assert.throws(() => assertFinalJobResults({ ...results, reserve: result }));
  }
});

test("fixtures are themselves free of accidental credential material", () => {
  for (const path of [
    "./fixtures/vercel-deployment-state/valid-production.json",
    "./fixtures/vercel-production-shadow/unexpected-alias.json",
  ]) {
    const content = readFileSync(new URL(path, import.meta.url), "utf8");
    assert.doesNotMatch(content, /token|secret|authorization/i);
  }
});
