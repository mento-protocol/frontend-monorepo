import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import process from "node:process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  getVercelBuildRequirements,
  parseVercelPulledEnvironment,
  serializeVercelPulledEnvironment,
} from "./vercel-build-environment.mjs";
import {
  assertPrebuiltOutput,
  assertPrebuiltReadyForUpload,
  assertPulledProject,
  assertSafeVercelArguments,
  assertMaterializedVercelBuildEnvironment,
  assertVercelPullStaging,
  assertVercelInspection,
  buildVercelBuildArguments,
  buildVercelDeploymentLookupUrl,
  buildVercelDeployArguments,
  buildVercelInspectArguments,
  buildVercelPullArguments,
  deployWithAmbiguityRecovery,
  environmentForVercelCli,
  materializeExactGitTree,
  materializeVercelBuildEnvironment,
  materializeVercelRepoLink,
  parseVercelDeploymentLookup,
  parseVercelDeploymentJson,
  PILOT_TARGET,
  PREBUILT_TARGETS,
  prepareVercelPullStaging,
  queryVercelDeployments,
  stageVercelPullForCandidate,
  stageTrustedPnpmBootstrapManifest,
  stageTrustedPnpmLauncher,
  stageTrustedPnpmRuntimeManifest,
  stageTrustedRuntime,
  trustedPnpmInstallLayout,
  trustedVercelCliPath,
  validateExactSha,
  validateGitBranch,
  validatePilotContract,
  validateSourceCheckout,
  withValidatedPrebuiltUpload,
} from "./vercel-prebuilt-workflow.mjs";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const DEPLOYMENT_ID = "m-ui-0123456789abcdef012";
const DEPLOYMENT_URL = "https://ui-pilot-abc.vercel.app";
const REPOSITORY_ROOT = fileURLToPath(new URL("..", import.meta.url));
const BUILD_ENVIRONMENT_SCRIPT = fileURLToPath(
  new URL("./vercel-build-environment.mjs", import.meta.url),
);

function checkUiPreviewEnvironment(projectDirectory) {
  return execFileSync(
    process.execPath,
    [
      BUILD_ENVIRONMENT_SCRIPT,
      "check",
      "--target",
      "ui",
      "--environment",
      "preview",
      "--project-directory",
      projectDirectory,
    ],
    {
      cwd: REPOSITORY_ROOT,
      encoding: "utf8",
      env: {
        CI: "1",
        NEXT_PUBLIC_VERCEL_ENV: "preview",
        VERCEL: "1",
        VERCEL_ENV: "preview",
        VERCEL_TARGET_ENV: "preview",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
}

function uploadFixture(logicalTarget = "ui") {
  const target = PREBUILT_TARGETS[logicalTarget];
  const deploymentId =
    logicalTarget === "ui"
      ? DEPLOYMENT_ID
      : `m-${logicalTarget}-${"0".repeat(32)}`.slice(0, 32);
  const repoRoot = mkdtempSync(
    join(tmpdir(), `vercel-upload-${logicalTarget}-`),
  );
  const vercelOrgId = "team_example";
  const vercelProjectId = `prj_${logicalTarget}`;
  const projectState = join(repoRoot, target.expectedRootDirectory, ".vercel");
  const outputDirectory = join(projectState, "output");
  mkdirSync(outputDirectory, { recursive: true });
  materializeVercelRepoLink({
    repoRoot,
    expectedRootDirectory: target.expectedRootDirectory,
    vercelOrgId,
    vercelProjectId,
  });
  writeFileSync(
    join(projectState, "project.json"),
    JSON.stringify({
      orgId: vercelOrgId,
      projectId: vercelProjectId,
      settings: { rootDirectory: target.expectedRootDirectory },
    }),
  );
  writeFileSync(
    join(outputDirectory, "config.json"),
    JSON.stringify({ version: 3, deploymentId }),
  );
  writeFileSync(
    join(outputDirectory, "builds.json"),
    JSON.stringify({ target: "preview", cliVersion: "56.2.0" }),
  );
  mkdirSync(join(outputDirectory, "static", "nested"), { recursive: true });
  writeFileSync(join(outputDirectory, "static", "nested", "asset.js"), "ok");
  writeFileSync(
    `${repoRoot}.provenance.json`,
    JSON.stringify({ commitSha: SHA }),
    { mode: 0o600 },
  );
  return {
    repoRoot,
    projectState,
    outputDirectory,
    options: {
      repoRoot,
      logicalTarget,
      expectedRootDirectory: target.expectedRootDirectory,
      vercelOrgId,
      vercelProjectId,
      deploymentId,
      commitSha: SHA,
    },
    cleanup() {
      rmSync(repoRoot, { force: true, recursive: true });
      rmSync(`${repoRoot}.provenance.json`, { force: true });
    },
  };
}

function writeFunctionConfig(functionDirectory, extra = {}) {
  mkdirSync(functionDirectory, { recursive: true });
  writeFileSync(
    join(functionDirectory, ".vc-config.json"),
    JSON.stringify({
      runtime: "nodejs22.x",
      handler: "index.js",
      ...extra,
    }),
  );
}
const CONTROLLER_KEY = `vercel-preview:v1:pr:519:target:ui:sha:${SHA}`;
const LOOKUP_STARTED_AT = 1_720_000_000_000;
const LOOKUP_NOW = LOOKUP_STARTED_AT + 60_000;

function pilotContract(overrides = {}) {
  return {
    ...PILOT_TARGET,
    deployPermitted: true,
    commitSha: SHA,
    gitBranch: "feature/ui-pilot",
    vercelOrgId: "team_example",
    vercelProjectId: "prj_example",
    idempotencyKey: `vercel-pilot:v1:ui:sha:${SHA}:run:1:attempt:1`,
    pullRequestNumber: "",
    provenance: "manual-pilot",
    workflowRunUrl:
      "https://github.com/mento-protocol/frontend-monorepo/actions/runs/1",
    githubRepository: "mento-protocol/frontend-monorepo",
    githubRef: "refs/heads/main",
    githubWorkflowRef:
      "mento-protocol/frontend-monorepo/.github/workflows/vercel-prebuilt-pilot.yml@refs/heads/main",
    ...overrides,
  };
}

function defaultPulledEnvironment(logicalTarget) {
  return Object.fromEntries(
    getVercelBuildRequirements(logicalTarget, "preview")
      .filter((item) => item.ciClassification === "vercel-pull")
      .map((item) => [
        item.name,
        item.allowEmpty ? "" : `${item.name}-fixture`,
      ]),
  );
}

function pulledStagingFixture(
  logicalTarget = "ui",
  pulledEnvironment = defaultPulledEnvironment(logicalTarget),
) {
  const isolationRoot = realpathSync(
    mkdtempSync(join(tmpdir(), "vercel-pull-runner-")),
  );
  const stagingRoot = join(isolationRoot, "mento-vercel-pull-staging");
  const materializationRoot = join(
    isolationRoot,
    "mento-vercel-build-environment",
  );
  const candidateRoot = join(isolationRoot, "mento-vercel-candidate-source");
  const vercelOrgId = "team_example";
  const vercelProjectId = `prj_${logicalTarget}`;
  const expectedRootDirectory =
    PREBUILT_TARGETS[logicalTarget].expectedRootDirectory;
  chmodSync(isolationRoot, 0o711);
  prepareVercelPullStaging({
    isolationRoot,
    stagingRoot,
    expectedRootDirectory,
    vercelOrgId,
    vercelProjectId,
  });
  const appState = join(stagingRoot, expectedRootDirectory, ".vercel");
  mkdirSync(appState, { mode: 0o700 });
  writeFileSync(
    join(appState, "project.json"),
    JSON.stringify({ settings: { rootDirectory: expectedRootDirectory } }),
    { mode: 0o600 },
  );
  writeFileSync(
    join(appState, ".env.preview.local"),
    `${Object.entries(pulledEnvironment)
      .map(([name, value]) => `${name}=${value}`)
      .join("\n")}\n`,
    { mode: 0o600 },
  );
  return {
    isolationRoot,
    stagingRoot,
    materializationRoot,
    candidateRoot,
    appState,
    expectedRootDirectory,
    vercelOrgId,
    vercelProjectId,
    options: {
      isolationRoot,
      stagingRoot,
      materializationRoot,
      expectedRootDirectory,
      logicalTarget,
      vercelOrgId,
      vercelProjectId,
    },
    cleanup() {
      rmSync(isolationRoot, { force: true, recursive: true });
    },
  };
}

function materializeFixture(fixture) {
  return materializeVercelBuildEnvironment({
    ...fixture.options,
    expectedUid: process.getuid(),
    expectedGid: process.getgid(),
  });
}

test("pilot contract accepts only the UI preview mapping and exact SHA", () => {
  assert.deepEqual(validatePilotContract(pilotContract()), pilotContract());
  assert.throws(
    () =>
      validatePilotContract(
        pilotContract({
          ...PREBUILT_TARGETS.app,
          githubEnvironment: PILOT_TARGET.githubEnvironment,
        }),
      ),
    /manual pilot is restricted to the UI target/,
  );
  for (const overrides of [
    { logicalTarget: "app" },
    { deploymentMode: "staged-production" },
    { vercelTarget: "production" },
    { commitSha: "main" },
    { gitBranch: "dependabot/npm_and_yarn/example-1.0.0" },
    { deployPermitted: false },
    { githubRepository: "someone/fork" },
    { githubRef: "refs/heads/feature/ui-pilot" },
    {
      githubWorkflowRef:
        "mento-protocol/frontend-monorepo/.github/workflows/vercel-prebuilt-pilot.yml@refs/heads/feature",
    },
  ]) {
    assert.throws(() => validatePilotContract(pilotContract(overrides)));
  }
});

test("automatic preview contract binds PR, environment, provenance, and exact SHA", () => {
  const automatic = pilotContract({
    githubEnvironment: "preview/ui/pr-519",
    idempotencyKey: `vercel-preview:v1:pr:519:target:ui:sha:${SHA}`,
    pullRequestNumber: "519",
    provenance: "preview-controller:v2",
    githubWorkflowRef:
      "mento-protocol/frontend-monorepo/.github/workflows/vercel-preview-worker.yml@refs/heads/main",
  });
  assert.deepEqual(validatePilotContract(automatic), automatic);
  for (const overrides of [
    { githubEnvironment: "preview/ui/pr-520" },
    { idempotencyKey: `vercel-preview:v1:pr:520:target:ui:sha:${SHA}` },
    { pullRequestNumber: "520" },
    { provenance: "manual-pilot" },
    {
      githubWorkflowRef:
        "mento-protocol/frontend-monorepo/.github/workflows/vercel-prebuilt-pilot.yml@refs/heads/main",
    },
  ]) {
    assert.throws(() => validatePilotContract({ ...automatic, ...overrides }));
  }
});

test("automatic preview contract accepts only the four literal target mappings", () => {
  assert.deepEqual(Object.keys(PREBUILT_TARGETS), [
    "app",
    "governance",
    "reserve",
    "ui",
  ]);
  for (const target of Object.values(PREBUILT_TARGETS)) {
    const automatic = pilotContract({
      ...target,
      githubEnvironment: `preview/${target.logicalTarget}/pr-519`,
      idempotencyKey: `vercel-preview:v1:pr:519:target:${target.logicalTarget}:sha:${SHA}`,
      pullRequestNumber: "519",
      provenance: "preview-controller:v2",
      githubWorkflowRef:
        "mento-protocol/frontend-monorepo/.github/workflows/vercel-preview-worker.yml@refs/heads/main",
    });
    assert.deepEqual(validatePilotContract(automatic), automatic);

    const wrongTarget =
      target.logicalTarget === "ui"
        ? PREBUILT_TARGETS.app
        : PREBUILT_TARGETS.ui;
    for (const mismatched of [
      { workspacePackage: wrongTarget.workspacePackage },
      { expectedRootDirectory: wrongTarget.expectedRootDirectory },
      { githubEnvironment: `preview/${wrongTarget.logicalTarget}/pr-519` },
      {
        idempotencyKey: `vercel-preview:v1:pr:519:target:${wrongTarget.logicalTarget}:sha:${SHA}`,
      },
    ]) {
      assert.throws(() =>
        validatePilotContract({ ...automatic, ...mismatched }),
      );
    }
  }
  for (const logicalTarget of ["unknown", "__proto__", "constructor"]) {
    assert.throws(() =>
      validatePilotContract(
        pilotContract({
          logicalTarget,
          provenance: "preview-controller:v2",
        }),
      ),
    );
  }
});

test("branch and SHA validation rejects mutable, option-like, and control input", () => {
  assert.equal(validateExactSha(SHA), SHA);
  assert.equal(validateGitBranch("feature/ui-pilot"), "feature/ui-pilot");
  for (const branch of ["-main", " main", "main\nother", "refs/heads/main"]) {
    assert.throws(() => validateGitBranch(branch));
  }
  for (const sha of ["main", SHA.toUpperCase(), SHA.slice(1), "0".repeat(64)]) {
    assert.throws(() => validateExactSha(sha));
  }
});

test("source validation proves exact HEAD is reachable from the same-repo branch", () => {
  const directory = mkdtempSync(join(tmpdir(), "vercel-source-"));
  const remote = join(directory, "remote.git");
  const source = join(directory, "source");
  try {
    execFileSync("git", ["init", "--bare", remote]);
    execFileSync("git", ["init", "-b", "main", source]);
    execFileSync("git", [
      "-C",
      source,
      "config",
      "user.email",
      "ci@example.com",
    ]);
    execFileSync("git", ["-C", source, "config", "user.name", "CI"]);
    writeFileSync(join(source, "fixture.txt"), "main\n");
    execFileSync("git", ["-C", source, "add", "fixture.txt"]);
    execFileSync("git", ["-C", source, "commit", "-m", "fixture"]);
    execFileSync("git", ["-C", source, "remote", "add", "origin", remote]);
    execFileSync("git", ["-C", source, "push", "origin", "main"]);
    const sha = execFileSync("git", ["-C", source, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();

    assert.deepEqual(
      validateSourceCheckout({
        repoRoot: source,
        commitSha: sha,
        gitBranch: "main",
        githubRepository: remote,
      }),
      { commitSha: sha, gitBranch: "main" },
    );
    const mismatchedSha = `${sha.startsWith("0") ? "1" : "0"}${sha.slice(1)}`;
    assert.throws(
      () =>
        validateSourceCheckout({
          repoRoot: source,
          commitSha: mismatchedSha,
          gitBranch: "main",
          githubRepository: remote,
        }),
      /HEAD does not match/,
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("source validation rejects a commit not reachable from the supplied branch", () => {
  const directory = mkdtempSync(join(tmpdir(), "vercel-source-"));
  const remote = join(directory, "remote.git");
  const source = join(directory, "source");
  try {
    execFileSync("git", ["init", "--bare", remote]);
    execFileSync("git", ["init", "-b", "main", source]);
    execFileSync("git", [
      "-C",
      source,
      "config",
      "user.email",
      "ci@example.com",
    ]);
    execFileSync("git", ["-C", source, "config", "user.name", "CI"]);
    writeFileSync(join(source, "fixture.txt"), "main\n");
    execFileSync("git", ["-C", source, "add", "fixture.txt"]);
    execFileSync("git", ["-C", source, "commit", "-m", "main"]);
    execFileSync("git", ["-C", source, "remote", "add", "origin", remote]);
    execFileSync("git", ["-C", source, "push", "origin", "main"]);
    execFileSync("git", ["-C", source, "switch", "--orphan", "other"]);
    writeFileSync(join(source, "fixture.txt"), "other\n");
    execFileSync("git", ["-C", source, "add", "fixture.txt"]);
    execFileSync("git", ["-C", source, "commit", "-m", "other"]);
    const sha = execFileSync("git", ["-C", source, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();

    assert.throws(
      () =>
        validateSourceCheckout({
          repoRoot: source,
          commitSha: sha,
          gitBranch: "main",
          githubRepository: remote,
        }),
      /not reachable/,
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("pinned CLI arguments preserve preview branch and exact commit metadata", () => {
  assert.deepEqual(
    buildVercelPullArguments({
      gitBranch: "feature/ui-pilot",
      projectId: "prj_example",
    }),
    [
      "pull",
      "--yes",
      "--environment",
      "preview",
      "--git-branch",
      "feature/ui-pilot",
      "--project",
      "prj_example",
    ],
  );
  assert.deepEqual(buildVercelBuildArguments({ projectId: "prj_example" }), [
    "build",
    "--yes",
    "--standalone",
    "--target",
    "preview",
    "--project",
    "prj_example",
  ]);
  const deploy = buildVercelDeployArguments({
    projectId: "prj_example",
    commitSha: SHA,
    gitBranch: "feature/ui-pilot",
    idempotencyKey: CONTROLLER_KEY,
  });
  assert.deepEqual(deploy, [
    "deploy",
    "--prebuilt",
    "--target",
    "preview",
    "--archive=tgz",
    "--format=json",
    "--yes",
    "--project",
    "prj_example",
    "--meta",
    "githubCommitOrg=mento-protocol",
    "--meta",
    "githubCommitRepo=frontend-monorepo",
    "--meta",
    `githubCommitSha=${SHA}`,
    "--meta",
    "githubCommitRef=feature/ui-pilot",
    "--meta",
    `mentoControllerKey=${CONTROLLER_KEY}`,
  ]);
  assert.doesNotMatch(deploy.join(" "), /githubDeployment=1|--prod|promote/);
  assert.throws(
    () => assertSafeVercelArguments(["deploy", "--meta", "githubDeployment=1"]),
    /Forbidden/,
  );
  assert.throws(
    () => assertSafeVercelArguments(["deploy", "--token=secret"]),
    /environment/,
  );
  assert.doesNotThrow(() =>
    assertSafeVercelArguments([
      "deploy",
      "--meta",
      "githubCommitRef=feature/promote---prod-copy",
    ]),
  );
  assert.deepEqual(
    buildVercelInspectArguments(DEPLOYMENT_URL, "team_example"),
    [
      "inspect",
      DEPLOYMENT_URL,
      "--wait",
      "--timeout",
      "5m",
      "--format=json",
      "--scope",
      "team_example",
    ],
  );
});

test("deploy and inspect JSON retain one immutable URL and Vercel ID", () => {
  const expected = {
    deploymentId: "dpl_Abc123",
    deploymentUrl: DEPLOYMENT_URL,
    readyState: "BUILDING",
    target: "preview",
  };
  assert.deepEqual(
    parseVercelDeploymentJson(
      JSON.stringify({
        status: "ok",
        deployment: {
          id: expected.deploymentId,
          url: expected.deploymentUrl,
          readyState: expected.readyState,
          target: expected.target,
        },
      }),
    ),
    expected,
  );
  assert.deepEqual(
    parseVercelDeploymentJson(
      JSON.stringify({
        id: expected.deploymentId,
        url: expected.deploymentUrl,
        readyState: expected.readyState,
        target: expected.target,
      }),
    ),
    expected,
  );
  assert.equal(
    assertVercelInspection(
      JSON.stringify({
        id: expected.deploymentId,
        url: expected.deploymentUrl,
        readyState: "READY",
        target: "preview",
      }),
      expected,
    ).readyState,
    "READY",
  );
  assert.throws(
    () =>
      assertVercelInspection(
        JSON.stringify({
          id: expected.deploymentId,
          url: expected.deploymentUrl,
          readyState: "ERROR",
          target: "preview",
        }),
        expected,
      ),
    /does not match/,
  );
});

function lookupDeployment(overrides = {}) {
  return {
    uid: "dpl_Abc123",
    url: DEPLOYMENT_URL,
    projectId: "prj_example",
    createdAt: String(LOOKUP_STARTED_AT + 30_000),
    readyState: "BUILDING",
    target: null,
    meta: {
      githubCommitOrg: "mento-protocol",
      githubCommitRepo: "frontend-monorepo",
      githubCommitSha: SHA,
      githubCommitRef: "feature/ui-pilot",
      mentoControllerKey: CONTROLLER_KEY,
    },
    ...overrides,
  };
}

function lookupOptions() {
  return {
    projectId: "prj_example",
    vercelOrgId: "team_example",
    commitSha: SHA,
    gitBranch: "feature/ui-pilot",
    idempotencyKey: CONTROLLER_KEY,
    startedAtMs: LOOKUP_STARTED_AT,
    nowMs: LOOKUP_NOW,
  };
}

test("ambiguous upload lookup uses supported filters and validates the exact metadata tuple client-side", () => {
  const url = new URL(buildVercelDeploymentLookupUrl(lookupOptions()));
  assert.equal(url.origin, "https://api.vercel.com");
  assert.equal(url.pathname, "/v7/deployments");
  assert.equal(url.searchParams.get("projectId"), "prj_example");
  assert.equal(url.searchParams.get("teamId"), "team_example");
  assert.equal(url.searchParams.get("target"), "preview");
  assert.equal(url.searchParams.get("branch"), "feature/ui-pilot");
  assert.equal(url.searchParams.get("sha"), SHA);
  assert.equal(url.searchParams.get("limit"), "100");
  assert.deepEqual([...url.searchParams.keys()].sort(), [
    "branch",
    "limit",
    "projectId",
    "sha",
    "since",
    "target",
    "teamId",
    "until",
  ]);
  assert.deepEqual(
    parseVercelDeploymentLookup(
      JSON.stringify({
        deployments: [
          ...Array.from({ length: 5 }, (_, index) =>
            lookupDeployment({
              uid: `dpl_Other${index}`,
              url: `ui-other-${index}.vercel.app`,
              meta: {
                ...lookupDeployment().meta,
                mentoControllerKey: `${CONTROLLER_KEY}-other-${index}`,
              },
            }),
          ),
          lookupDeployment(),
        ],
      }),
      lookupOptions(),
    ),
    [
      {
        deploymentId: "dpl_Abc123",
        deploymentUrl: DEPLOYMENT_URL,
        readyState: "BUILDING",
        target: "preview",
      },
    ],
  );
  assert.deepEqual(
    parseVercelDeploymentLookup(
      JSON.stringify({
        deployments: [
          {
            ...lookupDeployment(),
            meta: {
              ...lookupDeployment().meta,
              mentoControllerKey: `${CONTROLLER_KEY}-other`,
            },
          },
        ],
      }),
      lookupOptions(),
    ),
    [],
  );
});

test("deployment lookup retries an exact incomplete row until its immutable URL exists", async () => {
  const incomplete = parseVercelDeploymentLookup(
    JSON.stringify({
      deployments: [lookupDeployment({ url: null })],
    }),
    lookupOptions(),
  )[0];
  assert.deepEqual(incomplete, {
    deploymentId: "dpl_Abc123",
    deploymentUrl: null,
    readyState: "BUILDING",
    target: "preview",
    incomplete: true,
  });

  const complete = parseVercelDeploymentLookup(
    JSON.stringify({ deployments: [lookupDeployment()] }),
    lookupOptions(),
  )[0];
  let uploadCalls = 0;
  let lookupCalls = 0;
  const result = await deployWithAmbiguityRecovery({
    runUpload: async () => {
      uploadCalls += 1;
      return { status: 1, stdout: "" };
    },
    lookup: async () => {
      lookupCalls += 1;
      return lookupCalls < 3 ? [incomplete] : [complete];
    },
    waitForRetry: async () => {},
  });
  assert.deepEqual(result, complete);
  assert.equal(uploadCalls, 1);
  assert.equal(lookupCalls, 3);
});

test("a persistently incomplete exact deployment fails closed without another upload", async () => {
  const [incomplete] = parseVercelDeploymentLookup(
    JSON.stringify({ deployments: [lookupDeployment({ url: null })] }),
    lookupOptions(),
  );
  let uploadCalls = 0;
  let lookupCalls = 0;
  await assert.rejects(
    deployWithAmbiguityRecovery({
      runUpload: async () => {
        uploadCalls += 1;
        return { status: 1, stdout: "" };
      },
      lookup: async () => {
        lookupCalls += 1;
        return [incomplete];
      },
      waitForRetry: async () => {},
    }),
    /remained incomplete or disappeared/,
  );
  assert.equal(uploadCalls, 1);
  assert.equal(lookupCalls, 3);
});

test("complete and incomplete rows for one exact tuple fail closed as duplicates", async () => {
  const matches = parseVercelDeploymentLookup(
    JSON.stringify({
      deployments: [lookupDeployment(), lookupDeployment({ url: null })],
    }),
    lookupOptions(),
  );
  let uploadCalls = 0;
  await assert.rejects(
    deployWithAmbiguityRecovery({
      runUpload: async () => {
        uploadCalls += 1;
        return { status: 1, stdout: "" };
      },
      lookup: async () => matches,
      waitForRetry: async () => {},
    }),
    /Multiple Vercel deployments match one controller key/,
  );
  assert.equal(uploadCalls, 1);
});

test("deployment lookup fails closed rather than silently ignoring another result page", () => {
  for (const pagination of [
    { next: String(LOOKUP_NOW - 1) },
    null,
    "malformed",
    [],
  ]) {
    assert.throws(
      () =>
        parseVercelDeploymentLookup(
          JSON.stringify({
            pagination,
            deployments: [lookupDeployment()],
          }),
          lookupOptions(),
        ),
      /response is malformed/,
    );
  }
});

test("deployment lookup accepts Vercel uid and bounded millisecond timestamps only", () => {
  const expected = {
    deploymentId: "dpl_Abc123",
    deploymentUrl: DEPLOYMENT_URL,
    readyState: "BUILDING",
    target: "preview",
  };
  for (const createdAt of [
    String(LOOKUP_STARTED_AT + 30_000),
    LOOKUP_STARTED_AT + 30_000,
  ]) {
    assert.deepEqual(
      parseVercelDeploymentLookup(
        JSON.stringify({ deployments: [lookupDeployment({ createdAt })] }),
        lookupOptions(),
      ),
      [expected],
    );
  }

  for (const createdAt of [
    "",
    `0${LOOKUP_STARTED_AT + 30_000}`,
    ` ${LOOKUP_STARTED_AT + 30_000}`,
    `${LOOKUP_STARTED_AT + 30_000}.0`,
    "1e12",
    "9007199254740992",
    String(LOOKUP_STARTED_AT - 60_001),
    String(LOOKUP_NOW + 60_001),
    Number.MAX_SAFE_INTEGER + 1,
    null,
    true,
    undefined,
  ]) {
    assert.throws(
      () =>
        parseVercelDeploymentLookup(
          JSON.stringify({ deployments: [lookupDeployment({ createdAt })] }),
          lookupOptions(),
        ),
      /exact upload tuple/,
    );
  }

  assert.throws(
    () =>
      parseVercelDeploymentLookup(
        JSON.stringify({
          deployments: [
            {
              ...lookupDeployment({ uid: undefined }),
              id: "dpl_Abc123",
            },
          ],
        }),
        lookupOptions(),
      ),
    /no valid deployment ID/,
  );
  for (const uid of ["", "dpl_bad-id", 123, null]) {
    assert.throws(
      () =>
        parseVercelDeploymentLookup(
          JSON.stringify({ deployments: [lookupDeployment({ uid })] }),
          lookupOptions(),
        ),
      /no valid deployment ID/,
    );
  }
});

test("credentialed lookup keeps its token out of the bounded request URL", async () => {
  let request;
  const matches = await queryVercelDeployments({
    ...lookupOptions(),
    token: "fixture-token",
    fetchImplementation: async (url, options) => {
      request = { url, options };
      return new Response(
        JSON.stringify({ deployments: [lookupDeployment()] }),
      );
    },
  });
  assert.equal(matches.length, 1);
  assert.doesNotMatch(request.url, /fixture-token/);
  assert.equal(request.options.headers.authorization, "Bearer fixture-token");
  assert.ok(request.options.signal instanceof AbortSignal);
});

test("ambiguous upload requery absorbs one delayed eventual match without retrying", async () => {
  const expected = parseVercelDeploymentLookup(
    JSON.stringify({ deployments: [lookupDeployment()] }),
    lookupOptions(),
  )[0];
  let uploadCalls = 0;
  let lookupCalls = 0;
  const waits = [];
  const result = await deployWithAmbiguityRecovery({
    runUpload: async () => {
      uploadCalls += 1;
      return { status: 1, stdout: "" };
    },
    lookup: async () => {
      lookupCalls += 1;
      return lookupCalls === 3 ? [expected] : [];
    },
    waitForRetry: async (milliseconds) => waits.push(milliseconds),
  });
  assert.deepEqual(result, expected);
  assert.equal(uploadCalls, 1);
  assert.equal(lookupCalls, 3);
  assert.deepEqual(waits, [1_000, 1_000]);
});

function successfulUpload(deployment) {
  return {
    status: 0,
    stdout: JSON.stringify({
      id: deployment.deploymentId,
      url: deployment.deploymentUrl,
      readyState: deployment.readyState,
      target: deployment.target,
    }),
  };
}

test("persistent zero-match proof retries once and accepts one stable matching identity", async () => {
  const expected = parseVercelDeploymentLookup(
    JSON.stringify({ deployments: [lookupDeployment()] }),
    lookupOptions(),
  )[0];
  let uploadCalls = 0;
  let lookupCalls = 0;
  const result = await deployWithAmbiguityRecovery({
    runUpload: async () => {
      uploadCalls += 1;
      return uploadCalls === 1
        ? { status: 1, stdout: "" }
        : successfulUpload(expected);
    },
    lookup: async () => {
      lookupCalls += 1;
      return lookupCalls <= 3 ? [] : [expected];
    },
    waitForRetry: async () => {},
  });
  assert.deepEqual(result, expected);
  assert.equal(uploadCalls, 2);
  assert.equal(lookupCalls, 6);
});

test("post-retry convergence catches a delayed first-upload identity", async () => {
  const delayedFirst = parseVercelDeploymentLookup(
    JSON.stringify({ deployments: [lookupDeployment()] }),
    lookupOptions(),
  )[0];
  const retry = {
    ...delayedFirst,
    deploymentId: "dpl_Other456",
    deploymentUrl: "https://ui-other-456.vercel.app",
  };
  let uploadCalls = 0;
  let lookupCalls = 0;
  await assert.rejects(
    deployWithAmbiguityRecovery({
      runUpload: async () => {
        uploadCalls += 1;
        return uploadCalls === 1
          ? { status: 1, stdout: "" }
          : successfulUpload(retry);
      },
      lookup: async () => {
        lookupCalls += 1;
        if (lookupCalls <= 3) return [];
        return lookupCalls === 4 ? [retry] : [delayedFirst, retry];
      },
      waitForRetry: async () => {},
    }),
    /multiple deployment identities/,
  );
  assert.equal(uploadCalls, 2);
  assert.equal(lookupCalls, 6);
});

test("post-retry convergence fails closed on reordered deployment visibility", async () => {
  const first = parseVercelDeploymentLookup(
    JSON.stringify({ deployments: [lookupDeployment()] }),
    lookupOptions(),
  )[0];
  const retry = {
    ...first,
    deploymentId: "dpl_Retry456",
    deploymentUrl: "https://ui-retry-456.vercel.app",
  };
  let uploadCalls = 0;
  let lookupCalls = 0;
  await assert.rejects(
    deployWithAmbiguityRecovery({
      runUpload: async () => {
        uploadCalls += 1;
        return uploadCalls === 1
          ? { status: 1, stdout: "" }
          : successfulUpload(retry);
      },
      lookup: async () => {
        lookupCalls += 1;
        if (lookupCalls <= 3) return [];
        return lookupCalls === 5 ? [first] : [retry];
      },
      waitForRetry: async () => {},
    }),
    /multiple deployment identities/,
  );
  assert.equal(uploadCalls, 2);
  assert.equal(lookupCalls, 6);
});

test("post-retry convergence fails closed when the deployment stays invisible", async () => {
  const retry = parseVercelDeploymentLookup(
    JSON.stringify({ deployments: [lookupDeployment()] }),
    lookupOptions(),
  )[0];
  let uploadCalls = 0;
  let lookupCalls = 0;
  await assert.rejects(
    deployWithAmbiguityRecovery({
      runUpload: async () => {
        uploadCalls += 1;
        return uploadCalls === 1
          ? { status: 1, stdout: "" }
          : successfulUpload(retry);
      },
      lookup: async () => {
        lookupCalls += 1;
        return [];
      },
      waitForRetry: async () => {},
    }),
    /no uniquely matching deployment/,
  );
  assert.equal(uploadCalls, 2);
  assert.equal(lookupCalls, 6);
});

test("Vercel CLI receives the repo link instead of ID variables that override it", () => {
  assert.deepEqual(
    environmentForVercelCli(
      {
        BASH_ENV: "/tmp/candidate-bash-env",
        CI: "1",
        GITHUB_ENV: "/tmp/github-env",
        GITHUB_OUTPUT: "/tmp/github-output",
        GITHUB_PATH: "/tmp/github-path",
        NODE_OPTIONS: "--require=/tmp/candidate.cjs",
        PATH: "/trusted/bin:/usr/bin:/bin",
        RUNNER_TEMP: "/tmp/runner",
        VERCEL_ORG_ID: "team_example",
        VERCEL_PROJECT_ID: "prj_example",
        VERCEL_TOKEN: "fixture-token",
      },
      ["VERCEL_ORG_ID", "VERCEL_PROJECT_ID", "VERCEL_TOKEN"],
    ),
    {
      CI: "1",
      PATH: "/trusted/bin:/usr/bin:/bin",
      VERCEL_TOKEN: "fixture-token",
    },
  );
});

test("Vercel pull staging is a fresh exact isolation-root tree", () => {
  const fixture = pulledStagingFixture();
  try {
    assert.equal(
      assertVercelPullStaging(fixture.options).settings.rootDirectory,
      fixture.expectedRootDirectory,
    );
    assert.equal(lstatSync(fixture.stagingRoot).mode & 0o777, 0o700);
    assert.equal(
      lstatSync(join(fixture.stagingRoot, ".vercel", "repo.json")).mode & 0o777,
      0o600,
    );
    assert.throws(
      () => prepareVercelPullStaging(fixture.options),
      /must be fresh/,
    );
    assert.throws(
      () =>
        prepareVercelPullStaging({
          ...fixture.options,
          stagingRoot: join(fixture.isolationRoot, "candidate-selected"),
        }),
      /expected isolation-root child/,
    );
  } finally {
    fixture.cleanup();
  }
});

test("one-way materialization preserves raw source and emits only the canonical exact allowlist", () => {
  const sensitiveSentinel = "raw-sensitive-sentinel";
  const unknownSentinel = "raw-unknown-sentinel";
  const pulledEnvironment = {
    NEXT_PUBLIC_SENTRY_DSN_SWAP: "",
    NEXT_PUBLIC_STORAGE_URL:
      "https://storage.example/path?a=b#fragment with spaces",
    NEXT_PUBLIC_WALLET_CONNECT_ID: String.raw`wallet\\identifier`,
    SENTRY_AUTH_TOKEN: sensitiveSentinel,
    ETHERSCAN_API_KEY: sensitiveSentinel,
    UNKNOWN_VARIABLE: unknownSentinel,
  };
  const fixture = pulledStagingFixture("app", pulledEnvironment);
  const sourcePath = join(fixture.appState, ".env.preview.local");
  const sourceRaw = serializeVercelPulledEnvironment(pulledEnvironment);
  writeFileSync(sourcePath, sourceRaw, { mode: 0o600 });
  const sourceBefore = lstatSync(sourcePath);
  try {
    const result = materializeFixture(fixture);
    const sourceAfter = lstatSync(sourcePath);
    assert.equal(readFileSync(sourcePath, "utf8"), sourceRaw);
    for (const name of [
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
      assert.equal(sourceAfter[name], sourceBefore[name], name);
    }
    assert.equal(lstatSync(fixture.materializationRoot).mode & 0o777, 0o700);
    assert.equal(lstatSync(result.environmentPath).mode & 0o777, 0o600);
    assert.equal(lstatSync(result.environmentPath).nlink, 1);
    const materializedRaw = readFileSync(result.environmentPath, "utf8");
    assert.deepEqual(parseVercelPulledEnvironment(materializedRaw), {
      NEXT_PUBLIC_SENTRY_DSN_SWAP: "",
      NEXT_PUBLIC_STORAGE_URL:
        "https://storage.example/path?a=b#fragment with spaces",
      NEXT_PUBLIC_WALLET_CONNECT_ID: String.raw`wallet\\identifier`,
    });
    assert.doesNotMatch(materializedRaw, new RegExp(sensitiveSentinel));
    assert.doesNotMatch(materializedRaw, new RegExp(unknownSentinel));
    assert.deepEqual(
      assertMaterializedVercelBuildEnvironment({
        ...fixture.options,
        expectedUid: process.getuid(),
        expectedGid: process.getgid(),
      }),
      result,
    );
    mkdirSync(join(fixture.candidateRoot, fixture.expectedRootDirectory), {
      recursive: true,
    });
    stageVercelPullForCandidate({
      ...fixture.options,
      candidateRoot: fixture.candidateRoot,
      buildUid: process.getuid(),
      buildGid: process.getgid(),
      runnerUid: process.getuid(),
      runnerGid: process.getgid(),
    });
    const candidateEnvironment = readFileSync(
      join(
        fixture.candidateRoot,
        fixture.expectedRootDirectory,
        ".vercel",
        ".env.preview.local",
      ),
      "utf8",
    );
    assert.equal(candidateEnvironment, materializedRaw);
    assert.doesNotMatch(candidateEnvironment, new RegExp(sensitiveSentinel));
    assert.doesNotMatch(candidateEnvironment, new RegExp(unknownSentinel));
    const destinationBeforeRetry = readFileSync(result.environmentPath);
    assert.throws(() => materializeFixture(fixture), /must be fresh/);
    assert.deepEqual(
      readFileSync(result.environmentPath),
      destinationBeforeRetry,
    );
  } finally {
    fixture.cleanup();
  }
});

test("Governance materialization never requires or carries pulled explorer credentials", () => {
  const pulledEnvironment = defaultPulledEnvironment("governance");
  pulledEnvironment.ETHERSCAN_API_KEY = "pulled-explorer-sentinel";
  pulledEnvironment.SENTRY_AUTH_TOKEN = "pulled-sentry-sentinel";
  const fixture = pulledStagingFixture("governance", pulledEnvironment);
  try {
    const { environmentPath } = materializeFixture(fixture);
    const materialized = parseVercelPulledEnvironment(
      readFileSync(environmentPath, "utf8"),
    );
    assert.equal(Object.hasOwn(materialized, "ETHERSCAN_API_KEY"), false);
    assert.equal(Object.hasOwn(materialized, "SENTRY_AUTH_TOKEN"), false);
    assert.deepEqual(
      Object.keys(materialized).sort(),
      Object.keys(defaultPulledEnvironment("governance")).sort(),
    );
  } finally {
    fixture.cleanup();
  }
});

test("build-environment materialization rejects unsafe source and destination filesystem state", () => {
  const sourceMutations = [
    {
      name: "source symlink swap",
      mutate: (fixture) => {
        const source = join(fixture.appState, ".env.preview.local");
        const outside = join(fixture.isolationRoot, "outside-source");
        writeFileSync(outside, readFileSync(source), { mode: 0o600 });
        rmSync(source);
        symlinkSync(outside, source);
      },
    },
    {
      name: "source hardlink swap",
      mutate: (fixture) => {
        const source = join(fixture.appState, ".env.preview.local");
        const outside = join(fixture.isolationRoot, "outside-source");
        writeFileSync(outside, readFileSync(source), { mode: 0o600 });
        rmSync(source);
        linkSync(outside, source);
      },
    },
    {
      name: "source mode",
      mutate: (fixture) =>
        chmodSync(join(fixture.appState, ".env.preview.local"), 0o640),
    },
    {
      name: "source oversize",
      mutate: (fixture) =>
        truncateSync(
          join(fixture.appState, ".env.preview.local"),
          16 * 1_024 * 1_024 + 1,
        ),
    },
    {
      name: "source invalid UTF-8",
      mutate: (fixture) =>
        writeFileSync(
          join(fixture.appState, ".env.preview.local"),
          Buffer.from([0xff, 0xfe]),
          { mode: 0o600 },
        ),
    },
    {
      name: "source empty",
      mutate: (fixture) =>
        writeFileSync(join(fixture.appState, ".env.preview.local"), "", {
          mode: 0o600,
        }),
    },
    {
      name: "source controlled value",
      mutate: (fixture) =>
        writeFileSync(
          join(fixture.appState, ".env.preview.local"),
          "NEXT_PUBLIC_STORAGE_URL=value\u0000sentinel\n",
          { mode: 0o600 },
        ),
    },
  ];
  for (const mutation of sourceMutations) {
    const fixture = pulledStagingFixture();
    try {
      mutation.mutate(fixture);
      assert.throws(
        () => materializeFixture(fixture),
        undefined,
        mutation.name,
      );
      assert.equal(existsSync(fixture.materializationRoot), false);
    } finally {
      fixture.cleanup();
    }
  }

  for (const destinationType of ["directory", "symlink"]) {
    const fixture = pulledStagingFixture();
    const outside = join(fixture.isolationRoot, "outside-destination");
    try {
      if (destinationType === "directory") {
        mkdirSync(fixture.materializationRoot, { mode: 0o700 });
        writeFileSync(
          join(fixture.materializationRoot, "sentinel"),
          "do-not-overwrite",
          { mode: 0o600 },
        );
      } else {
        mkdirSync(outside, { mode: 0o700 });
        symlinkSync(outside, fixture.materializationRoot);
      }
      assert.throws(() => materializeFixture(fixture), /must be fresh/);
      if (destinationType === "directory") {
        assert.equal(
          readFileSync(join(fixture.materializationRoot, "sentinel"), "utf8"),
          "do-not-overwrite",
        );
      }
    } finally {
      fixture.cleanup();
    }
  }

  const containment = pulledStagingFixture();
  try {
    assert.throws(() =>
      materializeVercelBuildEnvironment({
        ...containment.options,
        materializationRoot: join(
          containment.isolationRoot,
          "attacker-selected-environment",
        ),
      }),
    );
  } finally {
    containment.cleanup();
  }
});

test("materialized state is fail-closed after raw or derived tampering", () => {
  for (const tamper of ["raw-value", "derived-symlink", "derived-hardlink"]) {
    const fixture = pulledStagingFixture();
    try {
      const result = materializeFixture(fixture);
      if (tamper === "raw-value") {
        writeFileSync(
          join(fixture.appState, ".env.preview.local"),
          "NEXT_PUBLIC_STORAGE_URL=changed-after-materialization\n",
          { mode: 0o600 },
        );
      } else {
        const outside = join(fixture.isolationRoot, `outside-${tamper}`);
        writeFileSync(outside, readFileSync(result.environmentPath), {
          mode: 0o600,
        });
        rmSync(result.environmentPath);
        if (tamper === "derived-symlink") {
          symlinkSync(outside, result.environmentPath);
        } else {
          linkSync(outside, result.environmentPath);
        }
      }
      assert.throws(() =>
        assertMaterializedVercelBuildEnvironment({
          ...fixture.options,
          expectedUid: process.getuid(),
          expectedGid: process.getgid(),
        }),
      );
    } finally {
      fixture.cleanup();
    }
  }
});

test("UI preview environment validation reads only trusted pull staging", () => {
  const fixture = pulledStagingFixture();
  try {
    const canonicalProject = join(
      fixture.isolationRoot,
      "source",
      fixture.expectedRootDirectory,
    );
    mkdirSync(canonicalProject, { recursive: true });
    assert.throws(() => checkUiPreviewEnvironment(canonicalProject));

    const stagingProject = join(
      fixture.stagingRoot,
      fixture.expectedRootDirectory,
    );
    const stagingEnvironment = join(
      stagingProject,
      ".vercel",
      ".env.preview.local",
    );
    assert.equal(lstatSync(stagingEnvironment).mode & 0o777, 0o600);
    assert.match(
      checkUiPreviewEnvironment(stagingProject),
      /verified for ui\/preview/,
    );

    const candidateProject = join(
      fixture.candidateRoot,
      fixture.expectedRootDirectory,
    );
    mkdirSync(candidateProject, { recursive: true });
    materializeFixture(fixture);
    stageVercelPullForCandidate({
      ...fixture.options,
      candidateRoot: fixture.candidateRoot,
      buildUid: process.getuid(),
      buildGid: process.getgid(),
      runnerUid: process.getuid(),
      runnerGid: process.getgid(),
    });
    const candidateEnvironment = join(
      candidateProject,
      ".vercel",
      ".env.preview.local",
    );
    assert.equal(lstatSync(candidateEnvironment).mode & 0o777, 0o600);
    chmodSync(candidateEnvironment, 0o000);
    if (process.getuid() !== 0) {
      assert.throws(() => checkUiPreviewEnvironment(candidateProject));
    }
  } finally {
    fixture.cleanup();
  }
});

test("Vercel pull staging rejects links, hardlinks, special files, and unsafe state", () => {
  const mutations = [
    {
      name: "repo link symlink",
      mutate: (fixture) => {
        const path = join(fixture.stagingRoot, ".vercel", "repo.json");
        const outside = join(fixture.isolationRoot, "outside-repo.json");
        writeFileSync(outside, "untouched");
        rmSync(path);
        symlinkSync(outside, path);
      },
    },
    {
      name: "app Vercel directory symlink",
      mutate: (fixture) => {
        const outside = join(fixture.isolationRoot, "outside-state");
        mkdirSync(outside);
        rmSync(fixture.appState, { recursive: true });
        symlinkSync(outside, fixture.appState);
      },
    },
    ...["project.json", ".env.preview.local"].map((name) => ({
      name: `${name} symlink`,
      mutate: (fixture) => {
        const path = join(fixture.appState, name);
        const outside = join(fixture.isolationRoot, `outside-${name}`);
        writeFileSync(outside, "untouched");
        rmSync(path);
        symlinkSync(outside, path);
      },
    })),
    {
      name: "hard-linked settings",
      mutate: (fixture) => {
        const environmentPath = join(fixture.appState, ".env.preview.local");
        rmSync(environmentPath);
        linkSync(join(fixture.appState, "project.json"), environmentPath);
      },
    },
    {
      name: "FIFO settings",
      mutate: (fixture) => {
        const environmentPath = join(fixture.appState, ".env.preview.local");
        rmSync(environmentPath);
        execFileSync("mkfifo", [environmentPath]);
      },
    },
    {
      name: "unexpected file",
      mutate: (fixture) =>
        writeFileSync(join(fixture.appState, "candidate.txt"), "unsafe", {
          mode: 0o600,
        }),
    },
    {
      name: "group-writable settings",
      mutate: (fixture) =>
        chmodSync(join(fixture.appState, "project.json"), 0o620),
    },
  ];
  for (const mutation of mutations) {
    const fixture = pulledStagingFixture();
    try {
      mutation.mutate(fixture);
      assert.throws(
        () => assertVercelPullStaging(fixture.options),
        undefined,
        mutation.name,
      );
    } finally {
      fixture.cleanup();
    }
  }

  const ownership = pulledStagingFixture();
  try {
    assert.throws(() =>
      assertVercelPullStaging({
        ...ownership.options,
        expectedUid: process.getuid() + 1,
        expectedGid: process.getgid(),
      }),
    );
  } finally {
    ownership.cleanup();
  }
});

test("candidate Vercel links cannot redirect trusted pulled-state copies", () => {
  const mutations = [
    {
      name: "repo .vercel",
      prepare: ({ candidateRoot, outsideDirectory }) =>
        symlinkSync(outsideDirectory, join(candidateRoot, ".vercel")),
    },
    {
      name: "app .vercel",
      prepare: ({ appRoot, outsideDirectory }) =>
        symlinkSync(outsideDirectory, join(appRoot, ".vercel")),
    },
    ...["project.json", ".env.preview.local"].map((name) => ({
      name,
      prepare: ({ appRoot, sentinelPath }) => {
        const state = join(appRoot, ".vercel");
        mkdirSync(state);
        symlinkSync(sentinelPath, join(state, name));
      },
    })),
  ];
  for (const mutation of mutations) {
    const fixture = pulledStagingFixture();
    try {
      const appRoot = join(
        fixture.candidateRoot,
        fixture.expectedRootDirectory,
      );
      mkdirSync(appRoot, { recursive: true });
      const outsideDirectory = join(
        fixture.isolationRoot,
        "trusted-controller",
      );
      const sentinelPath = join(outsideDirectory, "sentinel.txt");
      mkdirSync(outsideDirectory);
      writeFileSync(sentinelPath, "untouched", { mode: 0o600 });
      mutation.prepare({
        candidateRoot: fixture.candidateRoot,
        appRoot,
        outsideDirectory,
        sentinelPath,
      });
      materializeFixture(fixture);

      assert.equal(
        stageVercelPullForCandidate({
          ...fixture.options,
          candidateRoot: fixture.candidateRoot,
          buildUid: process.getuid(),
          buildGid: process.getgid(),
          runnerUid: process.getuid(),
          runnerGid: process.getgid(),
        }).settings.rootDirectory,
        fixture.expectedRootDirectory,
        mutation.name,
      );
      assert.equal(readFileSync(sentinelPath, "utf8"), "untouched");
      for (const path of [
        join(fixture.candidateRoot, ".vercel", "repo.json"),
        join(appRoot, ".vercel", "project.json"),
        join(appRoot, ".vercel", ".env.preview.local"),
      ]) {
        assert.equal(lstatSync(path).isFile(), true, mutation.name);
        assert.equal(lstatSync(path).isSymbolicLink(), false, mutation.name);
        assert.equal(lstatSync(path).mode & 0o777, 0o600, mutation.name);
      }
    } finally {
      fixture.cleanup();
    }
  }
});

test("candidate staging rejects a source root that escapes the isolation root", () => {
  const fixture = pulledStagingFixture();
  const outside = mkdtempSync(join(tmpdir(), "vercel-candidate-outside-"));
  try {
    mkdirSync(join(outside, fixture.expectedRootDirectory), {
      recursive: true,
    });
    symlinkSync(outside, fixture.candidateRoot);
    materializeFixture(fixture);
    assert.throws(() =>
      stageVercelPullForCandidate({
        ...fixture.options,
        candidateRoot: fixture.candidateRoot,
        buildUid: process.getuid(),
        buildGid: process.getgid(),
        runnerUid: process.getuid(),
        runnerGid: process.getgid(),
      }),
    );
  } finally {
    rmSync(outside, { force: true, recursive: true });
    fixture.cleanup();
  }
});

test("candidate staging rejects source components with the wrong owner", () => {
  const fixture = pulledStagingFixture();
  try {
    mkdirSync(join(fixture.candidateRoot, fixture.expectedRootDirectory), {
      recursive: true,
    });
    materializeFixture(fixture);
    assert.throws(() =>
      stageVercelPullForCandidate({
        ...fixture.options,
        candidateRoot: fixture.candidateRoot,
        buildUid: process.getuid() + 1,
        buildGid: process.getgid(),
        runnerUid: process.getuid(),
        runnerGid: process.getgid(),
      }),
    );
  } finally {
    fixture.cleanup();
  }
});

test("trusted runtime copies hosted Node and the authenticated Linux pnpm bootstrap into independent protected files", () => {
  const sourceRoot = mkdtempSync(join(tmpdir(), "vercel-runtime-source-"));
  const isolationRoot = realpathSync(
    mkdtempSync(join(tmpdir(), "vercel-runtime-runner-")),
  );
  const toolsRoot = join(isolationRoot, "mento-vercel-trusted-tools");
  const pnpmRoot = join(isolationRoot, "mento-vercel-pnpm-bootstrap");
  const nodeSource = join(sourceRoot, "node");
  const pnpmPackageRoot = join(pnpmRoot, "node_modules", "@pnpm", "linux-x64");
  const pnpmExecutable = join(pnpmPackageRoot, "pnpm");
  const nodeContents = "#!/bin/sh\necho node\n";
  const pnpmExecutableContents = [
    "#!/bin/sh",
    'if [ "$1" = "--version" ]; then',
    '  echo "10.34.4"',
    "else",
    '  echo "pnpm"',
    "fi",
    "",
  ].join("\n");
  const expectedPnpmSha256 = createHash("sha256")
    .update(pnpmExecutableContents)
    .digest("hex");
  try {
    chmodSync(sourceRoot, 0o777);
    chmodSync(isolationRoot, 0o711);
    writeFileSync(nodeSource, nodeContents, { mode: 0o777 });
    mkdirSync(pnpmPackageRoot, { recursive: true });
    for (const file of ["package.json", "package-lock.json"]) {
      copyFileSync(
        join(REPOSITORY_ROOT, "scripts", "vercel-pnpm-bootstrap", file),
        join(pnpmRoot, file),
      );
      chmodSync(join(pnpmRoot, file), 0o444);
    }
    writeFileSync(
      join(pnpmPackageRoot, "package.json"),
      JSON.stringify({
        name: "@pnpm/linux-x64",
        version: "10.34.4",
        scripts: {},
        bin: { pnpm: "pnpm" },
        os: ["linux"],
        cpu: ["x64"],
      }),
      { mode: 0o444 },
    );
    writeFileSync(pnpmExecutable, pnpmExecutableContents, { mode: 0o555 });
    chmodSync(pnpmRoot, 0o755);
    assert.equal(lstatSync(pnpmExecutable).nlink, 1);

    const staged = stageTrustedRuntime({
      isolationRoot,
      toolsRoot,
      nodeSource,
      pnpmRoot,
      expectedPnpmSha256,
    });
    const canonicalToolsRoot = join(
      realpathSync(isolationRoot),
      "mento-vercel-trusted-tools",
    );
    assert.deepEqual(staged, {
      binDirectory: join(canonicalToolsRoot, "bin"),
      bootstrapBinDirectory: join(canonicalToolsRoot, "bootstrap-bin"),
      nodePath: join(canonicalToolsRoot, "bin", "node"),
      pnpmBootstrapPath: join(canonicalToolsRoot, "bootstrap-bin", "pnpm"),
    });
    for (const path of [
      canonicalToolsRoot,
      staged.binDirectory,
      staged.bootstrapBinDirectory,
    ]) {
      const entry = lstatSync(path);
      assert.equal(entry.isDirectory(), true);
      assert.equal(entry.isSymbolicLink(), false);
      assert.equal(entry.uid, process.getuid());
      assert.equal(entry.gid, process.getgid());
      assert.equal(entry.mode & 0o777, 0o755);
    }
    for (const path of [staged.nodePath, staged.pnpmBootstrapPath]) {
      const entry = lstatSync(path);
      assert.equal(entry.isFile(), true);
      assert.equal(entry.isSymbolicLink(), false);
      assert.equal(entry.uid, process.getuid());
      assert.equal(entry.gid, process.getgid());
      assert.equal(entry.mode & 0o777, 0o555);
      assert.equal(entry.nlink, 1);
      assert.equal(realpathSync(path), path);
    }

    writeFileSync(nodeSource, "replaced node\n");
    chmodSync(pnpmExecutable, 0o755);
    writeFileSync(pnpmExecutable, "replaced pnpm executable\n");
    assert.equal(readFileSync(staged.nodePath, "utf8"), nodeContents);
    assert.equal(
      readFileSync(staged.pnpmBootstrapPath, "utf8"),
      pnpmExecutableContents,
    );
    assert.equal(
      execFileSync(staged.pnpmBootstrapPath, ["--version"], {
        encoding: "utf8",
      }).trim(),
      "10.34.4",
    );
    assert.throws(
      () =>
        stageTrustedRuntime({
          isolationRoot,
          toolsRoot,
          nodeSource,
          pnpmRoot,
          expectedPnpmSha256,
        }),
      /destination must be fresh/,
    );

    rmSync(toolsRoot, { force: true, recursive: true });
    symlinkSync(sourceRoot, toolsRoot);
    assert.throws(
      () =>
        stageTrustedRuntime({
          isolationRoot,
          toolsRoot,
          nodeSource,
          pnpmRoot,
          expectedPnpmSha256,
        }),
      /destination must be fresh/,
    );
    rmSync(toolsRoot, { force: true });
    chmodSync(isolationRoot, 0o777);
    assert.throws(
      () =>
        stageTrustedRuntime({
          isolationRoot,
          toolsRoot,
          nodeSource,
          pnpmRoot,
          expectedPnpmSha256,
        }),
      /Vercel isolation root is not protected/,
    );
  } finally {
    rmSync(sourceRoot, { force: true, recursive: true });
    rmSync(isolationRoot, { force: true, recursive: true });
  }
});

test("trusted pnpm bootstrap manifest and npm lock are exact before network installation", () => {
  const fixtureRoot = realpathSync(
    mkdtempSync(join(tmpdir(), "vercel-pnpm-bootstrap-")),
  );
  const controllerRoot = join(fixtureRoot, "controller");
  const sourceRoot = join(controllerRoot, "scripts", "vercel-pnpm-bootstrap");
  const isolationRoot = join(fixtureRoot, "isolation-root");
  const bootstrapRoot = join(isolationRoot, "mento-vercel-pnpm-bootstrap");
  try {
    mkdirSync(sourceRoot, { recursive: true });
    mkdirSync(isolationRoot, { mode: 0o711 });
    for (const file of ["package.json", "package-lock.json"]) {
      copyFileSync(
        join(REPOSITORY_ROOT, "scripts", "vercel-pnpm-bootstrap", file),
        join(sourceRoot, file),
      );
      chmodSync(join(sourceRoot, file), 0o444);
    }
    for (const path of [
      controllerRoot,
      join(controllerRoot, "scripts"),
      sourceRoot,
    ]) {
      chmodSync(path, 0o755);
    }

    assert.equal(
      stageTrustedPnpmBootstrapManifest({
        controllerRoot,
        isolationRoot,
        bootstrapRoot,
      }),
      join(realpathSync(isolationRoot), "mento-vercel-pnpm-bootstrap"),
    );
    assert.equal(lstatSync(bootstrapRoot).mode & 0o777, 0o700);
    for (const file of ["package.json", "package-lock.json"]) {
      const source = join(sourceRoot, file);
      const destination = join(bootstrapRoot, file);
      assert.equal(lstatSync(destination).mode & 0o777, 0o444);
      assert.notEqual(lstatSync(source).ino, lstatSync(destination).ino);
      assert.equal(
        readFileSync(destination, "utf8"),
        readFileSync(source, "utf8"),
      );
    }
    assert.throws(
      () =>
        stageTrustedPnpmBootstrapManifest({
          controllerRoot,
          isolationRoot,
          bootstrapRoot,
        }),
      /destination must be fresh/,
    );

    rmSync(bootstrapRoot, { force: true, recursive: true });
    const packagePath = join(sourceRoot, "package.json");
    chmodSync(packagePath, 0o644);
    const packageMetadata = JSON.parse(readFileSync(packagePath, "utf8"));
    packageMetadata.scripts = { prepare: "echo unsafe" };
    writeFileSync(packagePath, `${JSON.stringify(packageMetadata, null, 2)}\n`);
    chmodSync(packagePath, 0o444);
    assert.throws(
      () =>
        stageTrustedPnpmBootstrapManifest({
          controllerRoot,
          isolationRoot,
          bootstrapRoot,
        }),
      /manifest is not exact/,
    );

    chmodSync(packagePath, 0o644);
    copyFileSync(
      join(REPOSITORY_ROOT, "scripts", "vercel-pnpm-bootstrap", "package.json"),
      packagePath,
    );
    chmodSync(packagePath, 0o444);
    const lockPath = join(sourceRoot, "package-lock.json");
    chmodSync(lockPath, 0o644);
    writeFileSync(
      lockPath,
      readFileSync(lockPath, "utf8").replace(
        "registry.npmjs.org",
        "registry.example.invalid",
      ),
    );
    chmodSync(lockPath, 0o444);
    assert.throws(
      () =>
        stageTrustedPnpmBootstrapManifest({
          controllerRoot,
          isolationRoot,
          bootstrapRoot,
        }),
      /lockfile is not exact/,
    );
  } finally {
    rmSync(fixtureRoot, { force: true, recursive: true });
  }
});

test("trusted pnpm runtime manifest and lockfile are exact before copying outside the checkout", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "vercel-pnpm-runtime-"));
  const controllerRoot = join(fixtureRoot, "controller");
  const sourceRoot = join(controllerRoot, "scripts", "vercel-pnpm-runtime");
  const toolsRoot = join(fixtureRoot, "trusted-tools");
  try {
    mkdirSync(sourceRoot, { recursive: true });
    mkdirSync(toolsRoot, { mode: 0o755 });
    for (const file of ["package.json", "pnpm-lock.yaml"]) {
      copyFileSync(
        join(REPOSITORY_ROOT, "scripts", "vercel-pnpm-runtime", file),
        join(sourceRoot, file),
      );
      chmodSync(join(sourceRoot, file), 0o444);
    }
    for (const path of [
      controllerRoot,
      join(controllerRoot, "scripts"),
      sourceRoot,
      toolsRoot,
    ]) {
      chmodSync(path, 0o755);
    }

    const runtimeRoot = stageTrustedPnpmRuntimeManifest({
      controllerRoot,
      toolsRoot,
    });
    assert.equal(runtimeRoot, join(realpathSync(toolsRoot), "pnpm-runtime"));
    for (const file of ["package.json", "pnpm-lock.yaml"]) {
      const destination = join(runtimeRoot, file);
      const entry = lstatSync(destination);
      assert.equal(entry.isFile(), true);
      assert.equal(entry.isSymbolicLink(), false);
      assert.equal(entry.uid, process.getuid());
      assert.equal(entry.gid, process.getgid());
      assert.equal(entry.mode & 0o777, 0o444);
      assert.equal(entry.nlink, 1);
      assert.equal(
        readFileSync(destination, "utf8"),
        readFileSync(join(sourceRoot, file), "utf8"),
      );
    }
    assert.throws(
      () => stageTrustedPnpmRuntimeManifest({ controllerRoot, toolsRoot }),
      /destination must be fresh/,
    );

    rmSync(runtimeRoot, { force: true, recursive: true });
    const lockfilePath = join(sourceRoot, "pnpm-lock.yaml");
    const originalLockfile = readFileSync(lockfilePath, "utf8");
    const lockfileMutations = [
      [
        "changed integrity",
        originalLockfile.replace("sha512-h2i+VSAK", "sha512-i2i+VSAK"),
      ],
      [
        "custom tarball",
        originalLockfile.replace(
          "resolution: {integrity:",
          "resolution: {tarball: https://packages.example/pnpm.tgz, integrity:",
        ),
      ],
      [
        "extra importer",
        originalLockfile.replace(
          "importers:\n\n  .:",
          "importers:\n\n  injected:\n    dependencies: {}\n\n  .:",
        ),
      ],
      [
        "extra package",
        originalLockfile.replace(
          "packages:\n\n  pnpm@10.34.4:",
          "packages:\n\n  injected@1.0.0:\n    resolution: {integrity: sha512-injected}\n\n  pnpm@10.34.4:",
        ),
      ],
      [
        "extra snapshot",
        originalLockfile.replace(
          "snapshots:\n\n  pnpm@10.34.4:",
          "snapshots:\n\n  injected@1.0.0: {}\n\n  pnpm@10.34.4:",
        ),
      ],
    ];
    for (const [name, mutatedLockfile] of lockfileMutations) {
      assert.notEqual(mutatedLockfile, originalLockfile, name);
      chmodSync(lockfilePath, 0o644);
      writeFileSync(lockfilePath, mutatedLockfile);
      chmodSync(lockfilePath, 0o444);
      assert.throws(
        () => stageTrustedPnpmRuntimeManifest({ controllerRoot, toolsRoot }),
        /lockfile is not exact/,
        name,
      );
      assert.equal(existsSync(runtimeRoot), false, name);
    }
    chmodSync(lockfilePath, 0o644);
    writeFileSync(lockfilePath, originalLockfile);
    chmodSync(lockfilePath, 0o444);

    const manifestPath = join(sourceRoot, "package.json");
    const manifestMutations = [
      {
        name: "@mento-protocol/vercel-pnpm-runtime",
        version: "0.0.0",
        private: true,
        description:
          "Isolated pnpm runtime for candidate-controlled Vercel builds",
        dependencies: { pnpm: "10.34.3" },
      },
      {
        name: "@mento-protocol/vercel-pnpm-runtime",
        version: "0.0.0",
        private: true,
        description:
          "Isolated pnpm runtime for candidate-controlled Vercel builds",
        dependencies: { injected: "1.0.0", pnpm: "10.34.4" },
      },
      {
        name: "@mento-protocol/vercel-pnpm-runtime",
        version: "0.0.0",
        private: true,
        description:
          "Isolated pnpm runtime for candidate-controlled Vercel builds",
        dependencies: { pnpm: "10.34.4" },
        pnpm: { overrides: { pnpm: "10.34.3" } },
      },
      {
        name: "@mento-protocol/vercel-pnpm-runtime",
        version: "0.0.0",
        private: true,
        description:
          "Isolated pnpm runtime for candidate-controlled Vercel builds",
        dependencies: { pnpm: "10.34.4" },
        packageManager: "pnpm@10.34.4",
      },
    ];
    for (const packageMetadata of manifestMutations) {
      chmodSync(manifestPath, 0o644);
      writeFileSync(manifestPath, JSON.stringify(packageMetadata));
      chmodSync(manifestPath, 0o444);
      assert.throws(
        () => stageTrustedPnpmRuntimeManifest({ controllerRoot, toolsRoot }),
        /manifest is not exact/,
      );
      assert.equal(existsSync(runtimeRoot), false);
    }
  } finally {
    rmSync(fixtureRoot, { force: true, recursive: true });
  }
});

test("trusted candidate pnpm launcher uses the lockfile-pinned JavaScript package through protected Node", () => {
  const toolsRoot = mkdtempSync(join(tmpdir(), "vercel-pnpm-launcher-"));
  const binDirectory = join(toolsRoot, "bin");
  const runtimeRoot = join(toolsRoot, "pnpm-runtime");
  const packageRoot = join(runtimeRoot, "node_modules", "pnpm");
  const cliPath = join(packageRoot, "bin", "pnpm.cjs");
  const nodePath = join(binDirectory, "node");
  try {
    mkdirSync(binDirectory, { recursive: true });
    mkdirSync(dirname(cliPath), { recursive: true });
    writeFileSync(nodePath, ["#!/bin/sh", 'exec /bin/sh "$@"', ""].join("\n"), {
      mode: 0o555,
    });
    writeFileSync(
      join(packageRoot, "package.json"),
      JSON.stringify({ name: "pnpm", version: "10.34.4" }),
      { mode: 0o444 },
    );
    writeFileSync(
      cliPath,
      [
        "#!/bin/sh",
        'if [ "$1" = "--version" ]; then',
        '  [ "$npm_config_manage_package_manager_versions" = "false" ] || exit 3',
        '  [ "$npm_config_package_manager_strict_version" = "false" ] || exit 4',
        '  echo "10.34.4"',
        "else",
        "  exit 2",
        "fi",
        "",
      ].join("\n"),
      { mode: 0o444 },
    );
    for (const path of [
      toolsRoot,
      binDirectory,
      runtimeRoot,
      join(runtimeRoot, "node_modules"),
      packageRoot,
      dirname(cliPath),
    ]) {
      chmodSync(path, 0o755);
    }

    const launcherPath = stageTrustedPnpmLauncher({ toolsRoot });
    assert.equal(launcherPath, join(realpathSync(toolsRoot), "bin", "pnpm"));
    const launcher = lstatSync(launcherPath);
    assert.equal(launcher.isFile(), true);
    assert.equal(launcher.isSymbolicLink(), false);
    assert.equal(launcher.uid, process.getuid());
    assert.equal(launcher.gid, process.getgid());
    assert.equal(launcher.mode & 0o777, 0o555);
    assert.equal(launcher.nlink, 1);
    const launcherText = readFileSync(launcherPath, "utf8");
    assert.match(
      launcherText,
      /pnpm-runtime\/node_modules\/pnpm\/bin\/pnpm\.cjs/,
    );
    assert.match(
      launcherText,
      /npm_config_manage_package_manager_versions=false/,
    );
    assert.match(
      launcherText,
      /unset NPM_CONFIG_MANAGE_PACKAGE_MANAGER_VERSIONS NPM_CONFIG_PACKAGE_MANAGER_STRICT_VERSION/,
    );
    assert.match(
      launcherText,
      /npm_config_package_manager_strict_version=false/,
    );
    assert.equal(
      execFileSync(launcherPath, ["--version"], {
        encoding: "utf8",
      }).trim(),
      "10.34.4",
    );
    assert.throws(
      () => stageTrustedPnpmLauncher({ toolsRoot }),
      /destination must be fresh/,
    );

    rmSync(launcherPath);
    chmodSync(join(packageRoot, "package.json"), 0o644);
    writeFileSync(
      join(packageRoot, "package.json"),
      JSON.stringify({ name: "pnpm", version: "10.34.3" }),
      { mode: 0o444 },
    );
    chmodSync(join(packageRoot, "package.json"), 0o444);
    assert.throws(
      () => stageTrustedPnpmLauncher({ toolsRoot }),
      /does not match the pinned release/,
    );
  } finally {
    rmSync(toolsRoot, { force: true, recursive: true });
  }
});

test("trusted runtime rejects missing, malformed, digest-drifted, and hardlinked pnpm bootstrap targets", () => {
  const isolationRoot = realpathSync(
    mkdtempSync(join(tmpdir(), "vercel-runtime-runner-")),
  );
  const toolsRoot = join(isolationRoot, "mento-vercel-trusted-tools");
  const pnpmRoot = join(isolationRoot, "mento-vercel-pnpm-bootstrap");
  const nodeSource = join(isolationRoot, "node");
  const pnpmExecutable = join(
    pnpmRoot,
    "node_modules",
    "@pnpm",
    "linux-x64",
    "pnpm",
  );
  const pnpmPackageJson = join(dirname(pnpmExecutable), "package.json");
  const executableContents = "#!/bin/sh\necho 10.34.4\n";
  const expectedPnpmSha256 = createHash("sha256")
    .update(executableContents)
    .digest("hex");
  const stage = (digest = expectedPnpmSha256) =>
    stageTrustedRuntime({
      isolationRoot,
      toolsRoot,
      nodeSource,
      pnpmRoot,
      expectedPnpmSha256: digest,
    });
  try {
    chmodSync(isolationRoot, 0o711);
    writeFileSync(nodeSource, "#!/bin/sh\necho node\n", { mode: 0o555 });
    mkdirSync(pnpmRoot, { recursive: true });
    for (const file of ["package.json", "package-lock.json"]) {
      copyFileSync(
        join(REPOSITORY_ROOT, "scripts", "vercel-pnpm-bootstrap", file),
        join(pnpmRoot, file),
      );
      chmodSync(join(pnpmRoot, file), 0o444);
    }
    chmodSync(pnpmRoot, 0o755);

    assert.throws(stage);

    mkdirSync(dirname(pnpmExecutable), { recursive: true });
    writeFileSync(
      pnpmPackageJson,
      JSON.stringify({
        name: "@pnpm/linux-x64",
        version: "10.25.0",
        scripts: {},
        bin: { pnpm: "pnpm" },
        os: ["linux"],
        cpu: ["x64"],
      }),
      { mode: 0o444 },
    );
    writeFileSync(pnpmExecutable, executableContents, {
      mode: 0o555,
    });
    assert.throws(stage, /package is not exact/);

    chmodSync(pnpmPackageJson, 0o644);
    writeFileSync(
      pnpmPackageJson,
      JSON.stringify({
        name: "@pnpm/linux-x64",
        version: "10.34.4",
        scripts: {},
        bin: { pnpm: "pnpm" },
        os: ["linux"],
        cpu: ["x64"],
      }),
    );
    chmodSync(pnpmPackageJson, 0o444);
    assert.throws(() => stage("0".repeat(64)), /executable digest is invalid/);

    const hardlinkSource = join(isolationRoot, "hardlinked-pnpm");
    chmodSync(pnpmExecutable, 0o755);
    rmSync(pnpmExecutable);
    writeFileSync(hardlinkSource, executableContents, { mode: 0o555 });
    linkSync(hardlinkSource, pnpmExecutable);
    assert.equal(lstatSync(pnpmExecutable).nlink, 2);
    assert.throws(stage, /runner-owned/);
  } finally {
    rmSync(isolationRoot, { force: true, recursive: true });
  }
});

test("trusted runtime rejects a pnpm bootstrap package link outside its fixed root", () => {
  const isolationRoot = realpathSync(
    mkdtempSync(join(tmpdir(), "vercel-runtime-runner-")),
  );
  const outsideRoot = mkdtempSync(join(tmpdir(), "vercel-runtime-outside-"));
  const toolsRoot = join(isolationRoot, "mento-vercel-trusted-tools");
  const pnpmRoot = join(isolationRoot, "mento-vercel-pnpm-bootstrap");
  const nodeSource = join(isolationRoot, "node");
  const packageLink = join(pnpmRoot, "node_modules", "@pnpm", "linux-x64");
  try {
    chmodSync(isolationRoot, 0o711);
    writeFileSync(nodeSource, "#!/bin/sh\necho node\n", { mode: 0o555 });
    mkdirSync(dirname(packageLink), { recursive: true });
    for (const file of ["package.json", "package-lock.json"]) {
      copyFileSync(
        join(REPOSITORY_ROOT, "scripts", "vercel-pnpm-bootstrap", file),
        join(pnpmRoot, file),
      );
      chmodSync(join(pnpmRoot, file), 0o444);
    }
    writeFileSync(
      join(outsideRoot, "package.json"),
      JSON.stringify({
        name: "@pnpm/linux-x64",
        version: "10.34.4",
        scripts: {},
        bin: { pnpm: "pnpm" },
        os: ["linux"],
        cpu: ["x64"],
      }),
      { mode: 0o444 },
    );
    writeFileSync(join(outsideRoot, "pnpm"), "#!/bin/sh\necho 10.34.4\n", {
      mode: 0o555,
    });
    symlinkSync(outsideRoot, packageLink);
    chmodSync(pnpmRoot, 0o755);

    assert.throws(
      () =>
        stageTrustedRuntime({
          isolationRoot,
          toolsRoot,
          nodeSource,
          pnpmRoot,
        }),
      /escaped its protected root/,
    );
  } finally {
    rmSync(outsideRoot, { force: true, recursive: true });
    rmSync(isolationRoot, { force: true, recursive: true });
  }
});

test("trusted Vercel CLI must be exact-versioned and runner-protected", () => {
  const toolsPath = mkdtempSync(join(tmpdir(), "vercel-tools-"));
  const packagePath = join(toolsPath, "node_modules", "vercel");
  const cliPath = join(packagePath, "dist", "index.js");
  try {
    mkdirSync(join(packagePath, "dist"), { recursive: true });
    writeFileSync(cliPath, "export {};\n");
    writeFileSync(
      join(packagePath, "package.json"),
      JSON.stringify({ version: "56.2.0" }),
    );
    assert.equal(trustedVercelCliPath(toolsPath), realpathSync(cliPath));

    writeFileSync(
      join(packagePath, "package.json"),
      JSON.stringify({ version: "56.2.1" }),
    );
    assert.throws(() => trustedVercelCliPath(toolsPath), /pinned release/);
    writeFileSync(
      join(packagePath, "package.json"),
      JSON.stringify({ version: "56.2.0" }),
    );

    chmodSync(toolsPath, 0o777);
    assert.throws(() => trustedVercelCliPath(toolsPath), /runner-owned/);
  } finally {
    rmSync(toolsPath, { force: true, recursive: true });
  }
});

test(
  "pinned pnpm materializes and executes Vercel 56.2.0 offline in the protected relative layout",
  { timeout: 120_000 },
  () => {
    const fixtureRoot = mkdtempSync(
      join(dirname(REPOSITORY_ROOT), ".vercel-tools-layout-"),
    );
    const controllerRoot = join(fixtureRoot, "controller");
    const toolsRoot = join(fixtureRoot, "trusted-tools");
    const archivePath = join(fixtureRoot, "controller.tar");
    try {
      mkdirSync(controllerRoot, { mode: 0o755 });
      mkdirSync(toolsRoot, { mode: 0o755 });
      execFileSync("git", [
        "-C",
        REPOSITORY_ROOT,
        "archive",
        "--format=tar",
        `--output=${archivePath}`,
        "HEAD",
      ]);
      execFileSync("tar", ["-xf", archivePath, "-C", controllerRoot]);
      for (const file of ["package.json", "pnpm-lock.yaml"]) {
        copyFileSync(join(REPOSITORY_ROOT, file), join(controllerRoot, file));
      }

      const layout = trustedPnpmInstallLayout({ controllerRoot, toolsRoot });
      assert.equal(
        resolve(controllerRoot, layout.modulesDir),
        join(toolsRoot, "node_modules"),
      );
      assert.equal(isAbsolute(layout.modulesDir), false);
      assert.equal(layout.virtualStoreDir, join(layout.modulesDir, ".pnpm"));
      assert.equal(
        execFileSync("pnpm", ["--version"], { encoding: "utf8" }).trim(),
        "10.34.4",
      );

      execFileSync(
        "pnpm",
        [
          "--dir",
          controllerRoot,
          "--filter",
          "frontend-monorepo",
          "install",
          "--frozen-lockfile",
          "--ignore-scripts",
          "--modules-dir",
          layout.modulesDir,
          "--package-import-method",
          "copy",
          "--virtual-store-dir",
          layout.virtualStoreDir,
          "--offline",
        ],
        {
          encoding: "utf8",
          env: { ...process.env, CI: "true" },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      execFileSync("chmod", ["-R", "a+rX,go-w", toolsRoot]);

      const cliPath = trustedVercelCliPath(toolsRoot);
      const pathFromTools = relative(realpathSync(toolsRoot), cliPath);
      assert.notEqual(pathFromTools, "");
      assert.equal(pathFromTools === "..", false);
      assert.equal(pathFromTools.startsWith(`..${sep}`), false);
      assert.equal(
        execFileSync(process.execPath, [cliPath, "--version"], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        }).trim(),
        "56.2.0",
      );
      assert.equal(
        JSON.parse(
          readFileSync(resolve(cliPath, "..", "..", "package.json"), "utf8"),
        ).version,
        "56.2.0",
      );
    } finally {
      rmSync(fixtureRoot, { force: true, recursive: true });
    }
  },
);

test("raw Git-object materialization bypasses archive and checkout filters", () => {
  const repository = mkdtempSync(join(tmpdir(), "vercel-raw-source-"));
  const isolationRoot = realpathSync(
    mkdtempSync(join(tmpdir(), "vercel-raw-runner-")),
  );
  const candidate = join(isolationRoot, "mento-vercel-candidate-source");
  const checkoutCandidate = mkdtempSync(
    join(tmpdir(), "vercel-filtered-candidate-"),
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
      [
        "checkout-index",
        "--all",
        "--force",
        `--prefix=${checkoutCandidate}${sep}`,
      ],
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
    assert.throws(
      () => lstatSync(join(candidate, ".git")),
      (error) => error?.code === "ENOENT",
    );
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
  const repository = mkdtempSync(join(tmpdir(), "vercel-gitlink-source-"));
  const isolationRoot = realpathSync(
    mkdtempSync(join(tmpdir(), "vercel-gitlink-runner-")),
  );
  const candidate = join(isolationRoot, "mento-vercel-candidate-source");
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
    assert.throws(
      () => lstatSync(candidate),
      (error) => error?.code === "ENOENT",
    );
  } finally {
    rmSync(repository, { force: true, recursive: true });
    rmSync(isolationRoot, { force: true, recursive: true });
  }
});

test("candidate execution is UID-isolated and hands upload to runner-owned state", () => {
  const raw = readFileSync(
    new URL("../.github/workflows/_vercel-prebuilt.yml", import.meta.url),
    "utf8",
  );
  assert.match(raw, /\/usr\/bin\/setpriv/g);
  assert.match(raw, /--clear-groups/g);
  assert.match(raw, /--no-new-privs/g);
  assert.match(raw, /\/usr\/bin\/env -i/g);
  assert.match(raw, /\/usr\/bin\/pkill -KILL -u "\$BUILD_UID"/g);
  assert.match(raw, /\/usr\/bin\/pgrep -u "\$BUILD_UID"/g);
  assert.match(raw, /Create immutable runner-owned upload handoff/);
  assert.match(raw, /mento-vercel-upload-source/);
  assert.match(raw, /mento-vercel-pnpm-bootstrap/);
  assert.doesNotMatch(raw, /\$\{\{ runner\.temp \}\}\/mento-vercel-/);
  assert.doesNotMatch(raw, /\$RUNNER_TEMP/);
  assert.doesNotMatch(raw, /\bsetfacl\b/);
  assert.doesNotMatch(raw, /chmod[^\n]*(?:\$HOME|\/home\/runner)/);
  assert.doesNotMatch(raw, /standalone: true/);
  assert.match(
    raw,
    /EXPECTED_PNPM_LINUX_X64_SHA256: e02c01738ce850754cf00111fd97bec24de550e1e963690486f02d9dae1a2193/,
  );
  const pnpmBootstrapBlock = raw.slice(
    raw.indexOf("- name: Stage and authenticate pinned pnpm bootstrap"),
    raw.indexOf("- name: Prove authenticated pnpm path before cache restore"),
  );
  assert.match(pnpmBootstrapBlock, /uname -s/);
  assert.match(pnpmBootstrapBlock, /uname -m/);
  assert.match(pnpmBootstrapBlock, /stage-pnpm-bootstrap/);
  assert.match(pnpmBootstrapBlock, /npm_cli" ci/);
  assert.match(pnpmBootstrapBlock, /--ignore-scripts/);
  assert.match(pnpmBootstrapBlock, /stage-runtime/);
  assert.match(pnpmBootstrapBlock, /\/usr\/bin\/sha256sum "\$pnpm_bootstrap"/);
  assert.ok(
    pnpmBootstrapBlock.indexOf('/usr/bin/sha256sum "$pnpm_bootstrap"') <
      pnpmBootstrapBlock.indexOf('"$pnpm_bootstrap" --version'),
  );
  assert.match(raw, /userdel mento-vercel-build/);
  assert.match(raw, /node_modules\/vercel\/dist\/index\.js/);
  assert.match(raw, /candidate_can_write/);
  const runtimeRootBlock = raw.slice(
    raw.indexOf("- name: Create protected cross-identity runtime root"),
    raw.indexOf("- name: Stage and authenticate pinned pnpm bootstrap"),
  );
  assert.match(
    raw,
    /VERCEL_RUNTIME_ROOT: \/var\/lib\/mento-vercel-runtime-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/,
  );
  assert.match(
    raw,
    /VERCEL_ISOLATION_ROOT: \/var\/lib\/mento-vercel-runtime-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}\/work/,
  );
  assert.match(
    runtimeRootBlock,
    /for protected_ancestor in \/ \/var \/var\/lib/,
  );
  assert.match(runtimeRootBlock, /-o root \\\n\s+-g root \\\n\s+-m 0711/);
  assert.match(
    runtimeRootBlock,
    /-o "\$\(\/usr\/bin\/id -u\)" \\\n\s+-g "\$\(\/usr\/bin\/id -g\)" \\\n\s+-m 0711/,
  );
  assert.match(runtimeRootBlock, /\/bin\/chmod 0400 "\$VERCEL_RUNTIME_MARKER"/);
  assert.ok(
    runtimeRootBlock.indexOf('/bin/chmod 0400 "$VERCEL_RUNTIME_MARKER"') <
      runtimeRootBlock.indexOf("VERCEL_RUNTIME_ROOT_READY=1"),
  );
  for (const protectedPath of [
    "/var/lib",
    "VERCEL_RUNTIME_ROOT",
    "VERCEL_RUNTIME_MARKER",
    "VERCEL_ISOLATION_ROOT",
    "GITHUB_WORKSPACE/controller",
    "SOURCE_PATH/.git",
    "SOURCE_PATH/node_modules",
    "SOURCE_PATH/package.json",
    "SOURCE_PATH/pnpm-lock.yaml",
    "TRUSTED_VERCEL_TOOLS_PATH",
    "trusted_bin_dir",
    "bootstrap_bin_dir",
    "node_bin",
    "pnpm_bootstrap",
    "trusted_pnpm_store_parent",
    "trusted_pnpm_store",
    "pnpm_runtime_root",
    "pnpm_bin",
  ]) {
    assert.match(raw, new RegExp(protectedPath.replace("/", "\\/")));
  }
  assert.doesNotMatch(raw, /sudo\s+(?:-[^\s]+\s+)*-u\s+(?:nobody|65534)/);

  const isolationBlock = raw.slice(
    raw.indexOf(
      "- name: Prepare isolated exact-SHA source and protected Vercel CLI",
    ),
    raw.indexOf("- name: Install frozen dependencies"),
  );
  assert.match(
    isolationBlock,
    /"\$pnpm_bootstrap" --dir "\$GITHUB_WORKSPACE\/controller" --filter frontend-monorepo install/,
  );
  assert.match(isolationBlock, /--frozen-lockfile/);
  assert.match(isolationBlock, /--ignore-scripts/);
  assert.match(isolationBlock, /--package-import-method copy/);
  assert.doesNotMatch(isolationBlock, /PNPM_ACTION_DEST|PNPM_BIN_DEST/);
  assert.doesNotMatch(isolationBlock, /\bstage-runtime\b/);
  assert.match(isolationBlock, /pnpm_bootstrap="\$bootstrap_bin_dir\/pnpm"/);
  assert.match(isolationBlock, /trusted_pnpm_store=.*store path --silent/);
  assert.match(isolationBlock, /\/usr\/bin\/sha256sum "\$pnpm_bootstrap"/);
  assert.match(
    isolationBlock,
    /vercel-prebuilt-workflow\.mjs" \\\n\s+stage-pnpm-runtime/,
  );
  assert.match(
    isolationBlock,
    /"\$pnpm_bootstrap" --dir "\$pnpm_runtime_root" install/,
  );
  assert.match(isolationBlock, /--ignore-workspace/);
  assert.match(
    isolationBlock,
    /vercel-prebuilt-workflow\.mjs" \\\n\s+stage-pnpm-launcher/,
  );
  assert.match(
    isolationBlock,
    /Protected pnpm copy does not match the pinned release/,
  );
  assert.match(
    isolationBlock,
    /Protected pnpm launcher does not match the pinned release/,
  );
  assert.match(
    isolationBlock,
    /Protected runtime binary is not an independent runner-owned file/,
  );
  assert.match(
    isolationBlock,
    /Protected runtime root is not the authenticated fixed directory/,
  );
  assert.match(
    isolationBlock,
    /if \[ "\$build_uid" = "\$\(id -u\)" \] \|\| \[ "\$build_gid" = "\$\(id -g\)" \]; then\n\s+echo "Dedicated candidate identity overlaps the runner identity"/,
  );
  assert.match(isolationBlock, /trusted-install-modules-dir/);
  assert.match(isolationBlock, /--modules-dir "\$trusted_modules_dir"/);
  const isolationRootValidationIndex = isolationBlock.indexOf(
    'stat -c %a "$VERCEL_ISOLATION_ROOT"',
  );
  const protectedStoreIndex = isolationBlock.indexOf(
    'trusted_pnpm_store="$("$pnpm_bootstrap" store path --silent)"',
  );
  const protectedPnpmRuntimeIndex =
    isolationBlock.indexOf("stage-pnpm-runtime");
  const protectedLauncherIndex = isolationBlock.indexOf("stage-pnpm-launcher");
  const protectedPathLoopIndex = isolationBlock.indexOf(
    "for protected_path in \\",
  );
  const isolationRootProtectionIndex = isolationBlock.indexOf(
    '"$VERCEL_ISOLATION_ROOT" \\',
    protectedPathLoopIndex,
  );
  const candidateRuntimeProbeIndex = isolationBlock.indexOf(
    "candidate_pnpm_version",
  );
  const trustedPathIndex = isolationBlock.indexOf(
    `printf '%s\\n' "$trusted_bin_dir" >> "$GITHUB_PATH"`,
  );
  const materializeIndex = isolationBlock.indexOf("materialize-source");
  assert.notEqual(isolationRootValidationIndex, -1);
  assert.ok(protectedStoreIndex > isolationRootValidationIndex);
  assert.ok(protectedPnpmRuntimeIndex > protectedStoreIndex);
  assert.ok(protectedLauncherIndex > protectedPnpmRuntimeIndex);
  assert.ok(protectedPathLoopIndex > protectedLauncherIndex);
  assert.ok(isolationRootProtectionIndex > protectedPathLoopIndex);
  assert.ok(candidateRuntimeProbeIndex > isolationRootProtectionIndex);
  assert.ok(trustedPathIndex > candidateRuntimeProbeIndex);
  assert.ok(materializeIndex > trustedPathIndex);
  assert.match(
    isolationBlock,
    /--virtual-store-dir "\$trusted_modules_dir\/\.pnpm"/,
  );
  assert.match(isolationBlock, /"\$node_bin" "\$vercel_cli" --version/);
  assert.doesNotMatch(
    isolationBlock,
    /--modules-dir "\$TRUSTED_VERCEL_TOOLS_PATH/,
  );
  assert.doesNotMatch(isolationBlock, /--no-frozen-lockfile/);
  assert.doesNotMatch(isolationBlock, /"dependencies":\{"vercel":"56\.2\.0"\}/);
  const assertExactSourceMaterialization = (block) => {
    const markers = [
      '/usr/bin/git -C "$SOURCE_PATH" write-tree',
      '/usr/bin/git -C "$SOURCE_PATH" rev-parse "$DEPLOY_SHA^{tree}"',
      'if [ "$source_tree" != "$expected_tree" ]; then',
      "materialize-source",
      '-R --no-dereference "$build_uid:$build_gid"',
    ];
    let previous = -1;
    for (const marker of markers) {
      const index = block.indexOf(marker);
      assert.notEqual(index, -1, `missing exact-source marker: ${marker}`);
      assert.ok(
        index > previous,
        `out-of-order exact-source marker: ${marker}`,
      );
      previous = index;
    }
    assert.match(
      block,
      /"\$GITHUB_WORKSPACE\/controller\/scripts\/vercel-prebuilt-workflow\.mjs" \\\n\s+materialize-source/,
    );
    assert.doesNotMatch(block, /git -C "\$SOURCE_PATH" archive/);
    assert.doesNotMatch(block, /git -C "\$SOURCE_PATH" checkout-index/);
    assert.doesNotMatch(block, /get-tar-commit-id/);
  };
  assertExactSourceMaterialization(isolationBlock);
  for (const mutation of [
    isolationBlock.replace("$DEPLOY_SHA^{tree}", "HEAD^{tree}"),
    isolationBlock.replace(
      'if [ "$source_tree" != "$expected_tree" ]; then',
      'if [ "$source_tree" = "$source_tree" ]; then',
    ),
    isolationBlock.replace("materialize-source", "prepare-link"),
    isolationBlock.replace("-R --no-dereference", "-R"),
  ]) {
    assert.notEqual(mutation, isolationBlock);
    assert.throws(() => assertExactSourceMaterialization(mutation));
  }

  const installBlock = raw.slice(
    raw.indexOf("- name: Install frozen dependencies"),
    raw.indexOf("- name: Restore trusted controller after source installation"),
  );
  const buildBlock = raw.slice(
    raw.indexOf("- name: Build the literal target prebuilt output"),
    raw.indexOf("- name: Restore trusted controller after source build"),
  );
  const buildValidationBlock = buildBlock.slice(
    0,
    buildBlock.indexOf('started_at_ms="$(date +%s%3N)"'),
  );
  const installCandidateBlock = installBlock.slice(
    installBlock.indexOf("set +e"),
    installBlock.indexOf("candidate_status=$?"),
  );
  assert.match(installBlock, /"\$pnpm_bin" --version \|/);
  assert.match(installBlock, /\/usr\/bin\/grep -Fxq "10\.34\.4"/);
  assert.match(
    installBlock,
    /Isolated candidate cannot execute the protected pnpm launcher/,
  );
  const buildCandidateBlock = buildBlock.slice(
    buildBlock.indexOf("set +e"),
    buildBlock.indexOf("candidate_status=$?"),
  );
  assert.match(
    buildCandidateBlock,
    /"\$node_bin" "\$vercel_cli" build --yes --standalone --target preview --project "\$VERCEL_PROJECT_ID"/,
  );
  const handoffBlock = raw.slice(
    raw.indexOf("- name: Create immutable runner-owned upload handoff"),
    raw.indexOf("- name: Materialize runner-owned upload project mapping"),
  );
  const candidateOutputValidationBlock = raw.slice(
    raw.indexOf("- name: Assert the literal target prebuilt output"),
    raw.indexOf("- name: Revalidate runner-owned build inputs after the build"),
  );
  const uploadOutputValidationBlock = raw.slice(
    raw.indexOf("- name: Assert immutable runner-owned upload handoff"),
    raw.indexOf("- name: Upload the verified prebuilt output"),
  );
  const pullBlock = raw.slice(
    raw.indexOf("- name: Pull branch-specific preview settings"),
    raw.indexOf("- name: Assert isolated runner-owned Vercel pull result"),
  );
  const stagePullBlock = raw.slice(
    raw.indexOf(
      "- name: Stage project settings and allowlisted environment into candidate source",
    ),
    raw.indexOf(
      "- name: Assert isolated candidate project mapping and environment",
    ),
  );
  const validateCandidatePullBlock = raw.slice(
    raw.indexOf(
      "- name: Assert isolated candidate project mapping and environment",
    ),
    raw.indexOf("- name: Build the literal target prebuilt output"),
  );
  const environmentValidationIndex = raw.indexOf(
    "- name: Validate runner-owned non-Governance preview build variables",
  );
  const stagePullIndex = raw.indexOf(
    "- name: Stage project settings and allowlisted environment into candidate source",
  );
  const environmentValidationBlock = raw.slice(
    environmentValidationIndex,
    stagePullIndex,
  );
  const assertSinglePrivilegedControllerInvocation = (block, command) => {
    const controller =
      '"$GITHUB_WORKSPACE/controller/scripts/vercel-prebuilt-workflow.mjs"';
    const lines = block.split("\n");
    const controllerLines = lines
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => line.includes(controller));
    assert.equal(
      controllerLines.length,
      1,
      `${command} must have exactly one trusted controller invocation`,
    );
    const controllerIndex = controllerLines[0].index;
    assert.equal(lines[controllerIndex + 1]?.trim(), command);
    const privilegedIndex = lines.findIndex(
      (line, index) =>
        index < controllerIndex &&
        line.includes("sudo --non-interactive /usr/bin/env -i"),
    );
    assert.notEqual(
      privilegedIndex,
      -1,
      `${command} must start from a privileged clean environment`,
    );
    for (let index = privilegedIndex; index <= controllerIndex; index += 1) {
      assert.ok(
        lines[index].trimEnd().endsWith("\\"),
        `${command} must remain in one privileged continued command`,
      );
    }
  };
  assert.match(
    pullBlock,
    /SOURCE_PATH: \$\{\{ env\.VERCEL_ISOLATION_ROOT \}\}\/mento-vercel-pull-staging/,
  );
  assert.doesNotMatch(pullBlock, /github\.workspace.*source/);
  assertSinglePrivilegedControllerInvocation(stagePullBlock, "stage-pull");
  assert.doesNotMatch(stagePullBlock, /\/bin\/cp|canonical_state/);
  assertSinglePrivilegedControllerInvocation(
    validateCandidatePullBlock,
    "validate-candidate-pull",
  );
  assert.match(validateCandidatePullBlock, /BUILD_UID="\$BUILD_UID"/);
  assert.match(validateCandidatePullBlock, /PULL_STAGING_UID="\$\(id -u\)"/);
  assert.doesNotMatch(validateCandidatePullBlock, /\svalidate-pull\s*$/m);
  assertSinglePrivilegedControllerInvocation(buildValidationBlock, "build");
  assert.match(buildValidationBlock, /PULL_STAGING_UID="\$\(id -u\)"/);
  assert.doesNotMatch(
    buildValidationBlock,
    /\n\s+node "\$GITHUB_WORKSPACE\/controller\/scripts\/vercel-prebuilt-workflow\.mjs" build/,
  );
  assertSinglePrivilegedControllerInvocation(
    candidateOutputValidationBlock,
    "assert-output",
  );
  for (const [block, command] of [
    [stagePullBlock, "stage-pull"],
    [validateCandidatePullBlock, "validate-candidate-pull"],
    [buildValidationBlock, "build"],
    [candidateOutputValidationBlock, "assert-output"],
  ]) {
    const withoutPrivilege = block.replace(
      "sudo --non-interactive /usr/bin/env -i",
      "/usr/bin/env -i",
    );
    assert.notEqual(withoutPrivilege, block);
    assert.throws(
      () =>
        assertSinglePrivilegedControllerInvocation(withoutPrivilege, command),
      /privileged clean environment/,
    );
    assert.throws(
      () =>
        assertSinglePrivilegedControllerInvocation(
          `${block}\nnode "$GITHUB_WORKSPACE/controller/scripts/vercel-prebuilt-workflow.mjs" ${command}\n`,
          command,
        ),
      /exactly one trusted controller invocation/,
    );
  }
  assert.match(
    candidateOutputValidationBlock,
    /EXPECTED_PROVENANCE_UID="\$\(id -u\)"/,
  );
  assert.doesNotMatch(
    candidateOutputValidationBlock,
    /run: node .*vercel-prebuilt-workflow\.mjs" assert-output/,
  );
  assert.equal(
    uploadOutputValidationBlock.match(/vercel-prebuilt-workflow\.mjs/g)?.length,
    1,
  );
  assert.match(
    uploadOutputValidationBlock,
    /run: node .*vercel-prebuilt-workflow\.mjs" assert-output/,
  );
  assert.doesNotMatch(
    uploadOutputValidationBlock,
    /sudo --non-interactive \/usr\/bin\/env -i/,
  );
  assert.ok(
    raw.indexOf("- name: Assert isolated runner-owned Vercel pull result") <
      environmentValidationIndex,
  );
  const materializationIndex = raw.indexOf(
    "- name: Materialize exact allowlisted preview build environment",
  );
  const materializedAssertionIndex = raw.indexOf(
    "- name: Assert isolated allowlisted preview build environment",
  );
  assert.ok(
    raw.indexOf("- name: Assert isolated runner-owned Vercel pull result") <
      materializationIndex,
  );
  assert.ok(materializationIndex < materializedAssertionIndex);
  assert.ok(materializedAssertionIndex < environmentValidationIndex);
  assert.ok(environmentValidationIndex < stagePullIndex);
  assert.equal(raw.match(/vercel-build-environment\.mjs/g)?.length, 2);
  assert.match(
    environmentValidationBlock,
    /BUILD_ENVIRONMENT_PATH: \$\{\{ env\.VERCEL_ISOLATION_ROOT \}\}\/mento-vercel-build-environment/,
  );
  assert.match(
    environmentValidationBlock,
    /check --target "\$LOGICAL_TARGET" --environment preview/,
  );
  assert.match(
    environmentValidationBlock,
    /--project-directory "\$BUILD_ENVIRONMENT_PATH"/,
  );
  assert.doesNotMatch(environmentValidationBlock, /ETHERSCAN_API_KEY/);
  assert.doesNotMatch(environmentValidationBlock, /SENTRY_AUTH_TOKEN/);
  assert.match(
    buildBlock,
    /vercel-build-environment\.mjs" \\\n\s+check --target "\$LOGICAL_TARGET" --environment preview \\\n\s+--project-directory "\$BUILD_ENVIRONMENT_PATH"/,
  );
  assert.match(
    buildBlock,
    /BUILD_ENVIRONMENT_PATH: \$\{\{ env\.VERCEL_ISOLATION_ROOT \}\}\/mento-vercel-build-environment/,
  );
  assert.doesNotMatch(
    buildBlock,
    /--project-directory "\$SOURCE_PATH\/\$EXPECTED_ROOT_DIRECTORY"/,
  );
  assert.doesNotMatch(environmentValidationBlock, /working-directory: source/);
  assert.doesNotMatch(
    environmentValidationBlock,
    /mento-vercel-candidate-source/,
  );
  const materializationBlock = raw.slice(
    materializationIndex,
    materializedAssertionIndex,
  );
  assert.match(materializationBlock, /materialize-build-environment/);
  assert.match(
    materializationBlock,
    /pgrep -u "\$BUILD_UID"[\s\S]*materialize-build-environment[\s\S]*pgrep -u "\$BUILD_UID"/,
  );
  assert.match(stagePullBlock, /BUILD_ENVIRONMENT_PATH=/);
  assert.match(stagePullBlock, /LOGICAL_TARGET=/);
  assert.match(
    handoffBlock,
    /\/bin\/cp -R \\\n\s+--no-dereference \\\n\s+--preserve=mode,timestamps/,
  );
  assert.match(handoffBlock, /\/bin\/chown \\\n\s+-R \\\n\s+--no-dereference/);
  for (const block of [installBlock, buildBlock]) {
    assert.match(block, /\/usr\/bin\/env -i/);
    assert.match(block, /::stop-commands::\$command_token/);
    assert.match(block, /echo "::\$command_token::"/);
    assert.match(
      block,
      /candidate_status=\$\?\n\s+set -e\n\s+terminate_candidate\n\s+echo "::\$command_token::"/,
    );
    assert.match(block, /--reuid="\$BUILD_UID"/);
    assert.match(block, /--regid="\$BUILD_GID"/);
  }
  for (const block of [installCandidateBlock, buildCandidateBlock]) {
    for (const name of [
      "BASH_ENV",
      "GITHUB_ENV",
      "GITHUB_OUTPUT",
      "GITHUB_PATH",
      "GITHUB_STEP_SUMMARY",
      "NODE_OPTIONS",
      "RUNNER_TEMP",
      "VERCEL_ISOLATION_ROOT",
      "VERCEL_RUNTIME_MARKER",
      "VERCEL_RUNTIME_ROOT",
      "VERCEL_RUNTIME_ROOT_READY",
    ]) {
      assert.doesNotMatch(block, new RegExp(`\\n\\s+${name}=`));
    }
  }
  assert.match(installBlock, /XDG_DATA_HOME="\$CANDIDATE_HOME_PATH\/data"/);
  assert.doesNotMatch(installBlock, /--store-dir|PNPM_STORE/);
  assert.doesNotMatch(buildBlock, /\n\s+VERCEL_TOKEN:/);
  assert.doesNotMatch(buildBlock, /\n\s+VERCEL_TOKEN=/);
  assert.doesNotMatch(handoffBlock, /userdel|groupdel/);
  assert.match(handoffBlock, /--one-file-system/);
  assert.match(
    handoffBlock,
    /BUILD_ENVIRONMENT_PATH[^\n]*mento-vercel-build-environment/,
  );
  assert.match(
    handoffBlock,
    /"\$BUILD_ENVIRONMENT_PATH" != "\$VERCEL_ISOLATION_ROOT\/mento-vercel-build-environment"/,
  );
  const cleanupBlock = raw.slice(
    raw.indexOf("- name: Remove isolated build and upload state"),
    raw.indexOf("\n  smoke:"),
  );
  assert.match(cleanupBlock, /VERCEL_RUNTIME_ROOT_READY:-/);
  assert.match(cleanupBlock, /Unproven protected runtime root exists/);
  assert.match(cleanupBlock, /CANDIDATE_IDENTITY_READY:-/);
  assert.match(cleanupBlock, /CANDIDATE_IDENTITY_UID/);
  assert.match(cleanupBlock, /CANDIDATE_IDENTITY_GID/);
  assert.match(cleanupBlock, /assert_expected_path/g);
  assert.match(
    cleanupBlock,
    /"\$BUILD_ENVIRONMENT_PATH" \\\n\s+"\$VERCEL_ISOLATION_ROOT\/mento-vercel-build-environment"/,
  );
  assert.match(
    cleanupBlock,
    /-- \\\n\s+"\$BUILD_ENVIRONMENT_PATH" \\\n\s+"\$CANDIDATE_HOME_PATH"/,
  );
  assert.doesNotMatch(cleanupBlock, /mento-vercel-\*\)/);
  assert.match(cleanupBlock, /-rf \\\n\s+--one-file-system \\\n\s+--/);
  assert.match(
    cleanupBlock,
    /sudo --non-interactive \/bin\/rmdir "\$VERCEL_ISOLATION_ROOT"/,
  );
  assert.match(
    cleanupBlock,
    /sudo --non-interactive \/bin\/rmdir "\$VERCEL_RUNTIME_ROOT"/,
  );
  assert.match(cleanupBlock, /Protected runtime root survived cleanup/);
  assert.match(cleanupBlock, /Candidate identity survived cleanup/);
  assert.ok(
    cleanupBlock.indexOf('/bin/rmdir "$VERCEL_RUNTIME_ROOT"') <
      cleanupBlock.indexOf("userdel mento-vercel-build"),
  );
  assert.ok(
    buildBlock.indexOf("pkill -KILL -u") <
      buildBlock.indexOf("build_duration_ms="),
  );
  assert.ok(
    raw.indexOf("Assert immutable runner-owned upload handoff") <
      raw.indexOf("Upload the verified prebuilt output"),
  );
});

test("pulled project and prebuilt output bind the configured UI root and build ID", () => {
  const directory = mkdtempSync(join(tmpdir(), "vercel-project-"));
  const projectDirectory = join(directory, "apps", "ui.mento.org", ".vercel");
  const outputDirectory = join(projectDirectory, "output");
  try {
    mkdirSync(outputDirectory, { recursive: true });
    assert.deepEqual(
      materializeVercelRepoLink({
        repoRoot: directory,
        expectedRootDirectory: "apps/ui.mento.org",
        vercelOrgId: "team_example",
        vercelProjectId: "prj_example",
      }),
      {
        remoteName: "origin",
        projects: [
          {
            id: "prj_example",
            directory: "apps/ui.mento.org",
            orgId: "team_example",
          },
        ],
      },
    );
    writeFileSync(
      join(projectDirectory, "project.json"),
      JSON.stringify({
        orgId: "team_example",
        projectId: "prj_example",
        settings: { rootDirectory: "apps/ui.mento.org" },
      }),
    );
    writeFileSync(
      join(outputDirectory, "config.json"),
      JSON.stringify({ version: 3, deploymentId: DEPLOYMENT_ID }),
    );
    writeFileSync(
      join(outputDirectory, "builds.json"),
      JSON.stringify({ target: "preview", cliVersion: "56.2.0" }),
    );
    assert.equal(
      assertPulledProject({
        repoRoot: directory,
        expectedRootDirectory: "apps/ui.mento.org",
        vercelOrgId: "team_example",
        vercelProjectId: "prj_example",
      }).settings.rootDirectory,
      "apps/ui.mento.org",
    );
    assert.equal(
      assertPrebuiltOutput({
        repoRoot: directory,
        expectedRootDirectory: "apps/ui.mento.org",
        deploymentId: DEPLOYMENT_ID,
      }),
      outputDirectory,
    );
    writeFileSync(
      join(directory, ".vercel", "repo.json"),
      JSON.stringify({
        remoteName: "origin",
        projects: [
          {
            id: "prj_other",
            directory: "apps/ui.mento.org",
            orgId: "team_example",
          },
        ],
      }),
    );
    assert.throws(
      () =>
        assertPulledProject({
          repoRoot: directory,
          expectedRootDirectory: "apps/ui.mento.org",
          vercelOrgId: "team_example",
          vercelProjectId: "prj_example",
        }),
      /does not match/,
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("upload guard binds every target to its literal root and project identity", () => {
  for (const logicalTarget of Object.keys(PREBUILT_TARGETS)) {
    const fixture = uploadFixture(logicalTarget);
    try {
      assert.equal(
        assertPrebuiltReadyForUpload(fixture.options),
        fixture.outputDirectory,
      );
      const wrongTarget =
        logicalTarget === "ui" ? PREBUILT_TARGETS.app : PREBUILT_TARGETS.ui;
      assert.throws(
        () =>
          assertPrebuiltReadyForUpload({
            ...fixture.options,
            expectedRootDirectory: wrongTarget.expectedRootDirectory,
          }),
        /target mapping is invalid/,
      );
      assert.throws(
        () =>
          assertPrebuiltReadyForUpload({
            ...fixture.options,
            logicalTarget: wrongTarget.logicalTarget,
          }),
        /target mapping is invalid/,
      );
    } finally {
      fixture.cleanup();
    }
  }
});

test("upload revalidates exact provenance and project mapping immediately", async () => {
  const mutations = [
    {
      name: "missing repo link",
      mutate: ({ repoRoot }) => rmSync(join(repoRoot, ".vercel", "repo.json")),
    },
    {
      name: "wrong remote",
      mutate: ({ repoRoot, options }) =>
        writeFileSync(
          join(repoRoot, ".vercel", "repo.json"),
          JSON.stringify({
            remoteName: "candidate",
            projects: [
              {
                id: options.vercelProjectId,
                directory: options.expectedRootDirectory,
                orgId: options.vercelOrgId,
              },
            ],
          }),
        ),
    },
    ...[
      ["linked org", "orgId", "team_other"],
      ["linked project", "id", "prj_other"],
      ["linked root", "directory", "apps/wrong"],
    ].map(([name, property, value]) => ({
      name: `wrong ${name}`,
      mutate: ({ repoRoot }) => {
        const path = join(repoRoot, ".vercel", "repo.json");
        const link = JSON.parse(readFileSync(path, "utf8"));
        link.projects[0][property] = value;
        writeFileSync(path, JSON.stringify(link));
      },
    })),
    {
      name: "missing project settings",
      mutate: ({ projectState }) => rmSync(join(projectState, "project.json")),
    },
    ...[
      ["project org", "orgId", "team_other"],
      ["project ID", "projectId", "prj_other"],
    ].map(([name, property, value]) => ({
      name: `wrong ${name}`,
      mutate: ({ projectState }) => {
        const path = join(projectState, "project.json");
        const project = JSON.parse(readFileSync(path, "utf8"));
        project[property] = value;
        writeFileSync(path, JSON.stringify(project));
      },
    })),
    {
      name: "wrong project root",
      mutate: ({ projectState }) => {
        const path = join(projectState, "project.json");
        const project = JSON.parse(readFileSync(path, "utf8"));
        project.settings.rootDirectory = "apps/wrong";
        writeFileSync(path, JSON.stringify(project));
      },
    },
    {
      name: "wrong exact-SHA provenance",
      mutate: ({ repoRoot }) =>
        writeFileSync(
          `${repoRoot}.provenance.json`,
          JSON.stringify({ commitSha: `1${SHA.slice(1)}` }),
        ),
    },
  ];

  const valid = uploadFixture();
  let validUploads = 0;
  try {
    assert.equal(
      assertPrebuiltReadyForUpload(valid.options),
      valid.outputDirectory,
    );
    assert.equal(
      await withValidatedPrebuiltUpload(valid.options, async () => {
        validUploads += 1;
        return "uploaded";
      }),
      "uploaded",
    );
    assert.equal(validUploads, 1);
  } finally {
    valid.cleanup();
  }

  for (const mutation of mutations) {
    const fixture = uploadFixture();
    let uploadCalls = 0;
    try {
      mutation.mutate(fixture);
      await assert.rejects(
        withValidatedPrebuiltUpload(fixture.options, async () => {
          uploadCalls += 1;
        }),
        undefined,
        mutation.name,
      );
      assert.equal(uploadCalls, 0, mutation.name);
    } finally {
      fixture.cleanup();
    }
  }
});

test("upload guard accepts contained relative Vercel function symlinks", () => {
  const fixture = uploadFixture();
  try {
    const functionsDirectory = join(fixture.outputDirectory, "functions");
    const parentFunction = join(functionsDirectory, "parent.func");
    const nestedFunctionsDirectory = join(functionsDirectory, "nested");
    writeFunctionConfig(parentFunction);
    mkdirSync(nestedFunctionsDirectory, { recursive: true });
    writeFileSync(join(parentFunction, "index.js"), "export {};\n");
    symlinkSync(
      "../parent.func",
      join(nestedFunctionsDirectory, "prerender.func"),
    );
    assert.equal(
      assertPrebuiltReadyForUpload(fixture.options),
      fixture.outputDirectory,
    );
  } finally {
    fixture.cleanup();
  }
});

test("upload guard accepts contained standalone dependency symlinks", () => {
  const fixture = uploadFixture();
  try {
    const functionDirectory = join(
      fixture.outputDirectory,
      "functions",
      "api.func",
    );
    const packageDirectory = join(
      functionDirectory,
      "node_modules",
      ".pnpm",
      "package@1.0.0",
      "node_modules",
      "package",
    );
    const packageLink = join(functionDirectory, "node_modules", "package");
    writeFunctionConfig(functionDirectory);
    mkdirSync(packageDirectory, { recursive: true });
    writeFileSync(join(packageDirectory, "index.js"), "export {};\n");
    symlinkSync(relative(dirname(packageLink), packageDirectory), packageLink);
    const unusedPackageLinkDirectory = join(
      functionDirectory,
      "node_modules",
      ".pnpm",
      "node_modules",
    );
    mkdirSync(unusedPackageLinkDirectory, { recursive: true });
    symlinkSync(
      "../semver@6.3.1/node_modules/semver",
      join(unusedPackageLinkDirectory, "semver"),
    );
    assert.equal(
      assertPrebuiltReadyForUpload(fixture.options),
      fixture.outputDirectory,
    );
  } finally {
    fixture.cleanup();
  }
});

test("upload guard rejects unsafe links, special nodes, and runner-writable state", () => {
  const mutateCases = [
    {
      name: "absolute symbolic link",
      mutate: ({ outputDirectory }) => {
        const functionsDirectory = join(outputDirectory, "functions");
        mkdirSync(functionsDirectory);
        symlinkSync(
          join(outputDirectory, "static", "nested", "asset.js"),
          join(functionsDirectory, "absolute.func"),
        );
      },
    },
    {
      name: "contained non-function symbolic link",
      mutate: ({ outputDirectory }) =>
        symlinkSync(
          "nested/asset.js",
          join(outputDirectory, "static", "contained"),
        ),
    },
    {
      name: "function symbolic link outside functions",
      mutate: ({ outputDirectory }) => {
        const functionsDirectory = join(outputDirectory, "functions");
        mkdirSync(functionsDirectory);
        mkdirSync(join(outputDirectory, "static", "outside.func"));
        symlinkSync(
          "../static/outside.func",
          join(functionsDirectory, "outside.func"),
        );
      },
    },
    {
      name: "escaping relative symbolic link",
      mutate: ({ outputDirectory }) => {
        const functionsDirectory = join(outputDirectory, "functions");
        mkdirSync(functionsDirectory);
        const path = join(functionsDirectory, "escape.func");
        symlinkSync(relative(dirname(path), "/etc/passwd"), path);
      },
    },
    {
      name: "broken symbolic link",
      mutate: ({ outputDirectory }) => {
        const functionsDirectory = join(outputDirectory, "functions");
        mkdirSync(functionsDirectory);
        symlinkSync("missing.func", join(functionsDirectory, "broken.func"));
      },
    },
    {
      name: "cyclic symbolic link",
      mutate: ({ outputDirectory }) => {
        const functionsDirectory = join(outputDirectory, "functions");
        mkdirSync(functionsDirectory);
        symlinkSync("cycle-b.func", join(functionsDirectory, "cycle-a.func"));
        symlinkSync("cycle-a.func", join(functionsDirectory, "cycle-b.func"));
      },
    },
    {
      name: "function symbolic link to a file",
      mutate: ({ outputDirectory }) => {
        const functionsDirectory = join(outputDirectory, "functions");
        mkdirSync(functionsDirectory);
        writeFileSync(
          join(functionsDirectory, "target.func"),
          "not a directory",
        );
        symlinkSync("target.func", join(functionsDirectory, "file-alias.func"));
      },
    },
    {
      name: "function symbolic link chain",
      mutate: ({ outputDirectory }) => {
        const functionsDirectory = join(outputDirectory, "functions");
        mkdirSync(join(functionsDirectory, "target.func"), { recursive: true });
        symlinkSync("target.func", join(functionsDirectory, "first.func"));
        symlinkSync("first.func", join(functionsDirectory, "second.func"));
      },
    },
    {
      name: "function symbolic link to an ancestor",
      mutate: ({ outputDirectory }) => {
        const nestedDirectory = join(
          outputDirectory,
          "functions",
          "parent.func",
          "nested",
        );
        mkdirSync(nestedDirectory, { recursive: true });
        symlinkSync("..", join(nestedDirectory, "ancestor.func"));
      },
    },
    {
      name: "output-root symbolic link",
      mutate: ({ outputDirectory }) => {
        const functionsDirectory = join(outputDirectory, "functions");
        mkdirSync(functionsDirectory);
        symlinkSync("..", join(functionsDirectory, "root.func"));
      },
    },
    {
      name: "hard link",
      mutate: ({ outputDirectory }) =>
        linkSync(
          join(outputDirectory, "config.json"),
          join(outputDirectory, "static", "hardlink"),
        ),
    },
    {
      name: "external function file map",
      mutate: ({ outputDirectory }) => {
        const functionDirectory = join(
          outputDirectory,
          "functions",
          "api.func",
        );
        writeFunctionConfig(functionDirectory, {
          filePathMap: {
            "node_modules/@opentelemetry/api/context.js":
              "node_modules/.pnpm/@opentelemetry+api@1.9.0/context.js",
          },
        });
      },
    },
    {
      name: "external file map outside functions",
      mutate: ({ outputDirectory }) => {
        writeFileSync(
          join(outputDirectory, "static", ".vc-config.json"),
          JSON.stringify({
            filePathMap: {
              "private.txt": "../../private.txt",
            },
          }),
        );
      },
    },
    {
      name: "linked Vercel config",
      mutate: ({ outputDirectory }) => {
        const staticDirectory = join(outputDirectory, "static");
        writeFileSync(
          join(staticDirectory, "config-target.json"),
          JSON.stringify({ runtime: "nodejs22.x", handler: "index.js" }),
        );
        symlinkSync(
          "config-target.json",
          join(staticDirectory, ".vc-config.json"),
        );
      },
    },
    {
      name: "directory-shaped Vercel config",
      mutate: ({ outputDirectory }) =>
        mkdirSync(join(outputDirectory, "static", ".vc-config.json")),
    },
    {
      name: "oversized Vercel config",
      mutate: ({ outputDirectory }) => {
        const functionDirectory = join(
          outputDirectory,
          "functions",
          "api.func",
        );
        writeFunctionConfig(functionDirectory);
        truncateSync(
          join(functionDirectory, ".vc-config.json"),
          1024 * 1024 + 1,
        );
      },
    },
    {
      name: "oversized output file",
      mutate: ({ outputDirectory }) => {
        const path = join(outputDirectory, "static", "oversized.bin");
        writeFileSync(path, "");
        truncateSync(path, 250 * 1024 * 1024 + 1);
      },
    },
    {
      name: "oversized aggregate output",
      mutate: ({ outputDirectory }) => {
        for (let index = 0; index < 5; index += 1) {
          const path = join(
            outputDirectory,
            "static",
            `aggregate-${index}.bin`,
          );
          writeFileSync(path, "");
          truncateSync(path, 220 * 1024 * 1024);
        }
      },
    },
    {
      name: "absolute standalone dependency symbolic link",
      mutate: ({ outputDirectory }) => {
        const functionDirectory = join(
          outputDirectory,
          "functions",
          "api.func",
        );
        writeFunctionConfig(functionDirectory);
        mkdirSync(join(functionDirectory, "node_modules"), { recursive: true });
        symlinkSync(
          "/etc/passwd",
          join(functionDirectory, "node_modules", "package"),
        );
      },
    },
    {
      name: "escaping standalone dependency symbolic link",
      mutate: ({ outputDirectory }) => {
        const functionDirectory = join(
          outputDirectory,
          "functions",
          "api.func",
        );
        writeFunctionConfig(functionDirectory);
        const packageLink = join(functionDirectory, "node_modules", "package");
        mkdirSync(dirname(packageLink), { recursive: true });
        symlinkSync(
          relative(dirname(packageLink), outputDirectory),
          packageLink,
        );
      },
    },
    {
      name: "chained standalone dependency symbolic link",
      mutate: ({ outputDirectory }) => {
        const packageDirectory = join(
          outputDirectory,
          "functions",
          "api.func",
          "node_modules",
        );
        writeFunctionConfig(dirname(packageDirectory));
        mkdirSync(join(packageDirectory, "target"), { recursive: true });
        symlinkSync("target", join(packageDirectory, "first"));
        symlinkSync("first", join(packageDirectory, "second"));
      },
    },
    {
      name: "broken standalone dependency symbolic link chain",
      mutate: ({ outputDirectory }) => {
        const functionDirectory = join(
          outputDirectory,
          "functions",
          "api.func",
        );
        const packageDirectory = join(functionDirectory, "node_modules");
        writeFunctionConfig(functionDirectory);
        mkdirSync(packageDirectory, { recursive: true });
        symlinkSync("missing", join(packageDirectory, "first"));
        symlinkSync("first/child", join(packageDirectory, "second"));
      },
    },
    {
      name: "existing standalone dependency symbolic link chain",
      mutate: ({ outputDirectory }) => {
        const functionDirectory = join(
          outputDirectory,
          "functions",
          "api.func",
        );
        const packageDirectory = join(functionDirectory, "node_modules");
        writeFunctionConfig(functionDirectory);
        mkdirSync(join(packageDirectory, "target"), { recursive: true });
        symlinkSync("target", join(packageDirectory, "first"));
        symlinkSync("first/missing", join(packageDirectory, "second"));
      },
    },
    {
      name: "standalone dependency symbolic link escapes nearest function",
      mutate: ({ outputDirectory }) => {
        const outerFunction = join(outputDirectory, "functions", "outer.func");
        const innerFunction = join(outerFunction, "inner.func");
        const outerTarget = join(outerFunction, "node_modules", "target");
        const innerLink = join(innerFunction, "node_modules", "package");
        writeFunctionConfig(outerFunction);
        writeFunctionConfig(innerFunction);
        mkdirSync(outerTarget, { recursive: true });
        mkdirSync(dirname(innerLink), { recursive: true });
        symlinkSync(relative(dirname(innerLink), outerTarget), innerLink);
      },
    },
    {
      name: "FIFO",
      mutate: ({ outputDirectory }) =>
        execFileSync("mkfifo", [join(outputDirectory, "static", "pipe")]),
    },
    {
      name: "world-writable directory",
      mutate: ({ outputDirectory }) =>
        chmodSync(join(outputDirectory, "static"), 0o777),
    },
  ];
  for (const mutation of mutateCases) {
    const fixture = uploadFixture();
    try {
      mutation.mutate(fixture);
      assert.throws(
        () => assertPrebuiltReadyForUpload(fixture.options),
        undefined,
        mutation.name,
      );
    } finally {
      fixture.cleanup();
    }
  }
});
